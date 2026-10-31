-- Solo una BD aislada sin perfiles. Las pruebas y sus datos terminan en rollback.
begin;
do $$ begin if exists(select 1 from public.profiles) then
 raise exception 'Usa una BD aislada sin datos reales.'; end if; end; $$;
create function pg_temp.assert_true(condition boolean,label text) returns text language plpgsql as $$ begin
 if condition is distinct from true then raise exception 'FAIL: %',label; end if; return 'ok - '||label; end; $$;
create function pg_temp.expect_error(statement text,expected text,label text) returns text language plpgsql as $$ declare code text; begin
 begin execute statement; exception when others then get stacked diagnostics code=returned_sqlstate;
 if code<>expected then raise exception 'FAIL: % (%, esperado %)',label,code,expected; end if; return 'ok - '||label; end;
 raise exception 'FAIL: % (sin error)',label; end; $$;
do $$ begin execute format('grant usage on schema %I to anon,authenticated,service_role',pg_my_temp_schema()::regnamespace::text); end; $$;
insert into public.profiles(id,email,display_name,role_code) values
 ('10000000-0000-4000-8000-000000000001','admin@personnel.test','Administrador ajeno','admin'),
 ('10000000-0000-4000-8000-000000000002','owner@personnel.test','Creador','staff'),
 ('10000000-0000-4000-8000-000000000003','recipient@personnel.test','Destinatario','member'),
 ('10000000-0000-4000-8000-000000000004','no-key@personnel.test','Sin clave','member'),
 ('10000000-0000-4000-8000-000000000005','unlinked@personnel.test','Sin vincular','member');
insert into auth.users(id,email,raw_app_meta_data)
 select replace(id::text,'10000000','20000000')::uuid,email,'{"provider":"google"}'
 from public.profiles where id<>'10000000-0000-4000-8000-000000000005';
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','Protección',repeat('A',392),repeat('a',64));
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003','Protección',repeat('B',392),repeat('b',64));
select public.server_activate_encryption_key(profile_id,id) from public.stc_encryption_keys;
create function pg_temp.file_id(n integer) returns uuid language sql immutable as $$
 select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.version_id(n integer) returns uuid language sql immutable as $$
 select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.reserve(n integer,recipients jsonb default '[{"profile_id":"10000000-0000-4000-8000-000000000003"}]')
returns jsonb language sql as $$
 select public.server_begin_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(n),pg_temp.version_id(n),
 'Expediente de prueba','expediente.txt','text/plain',12,recipients); $$;
-- Material sintético para contratos SQL. El cifrado real se prueba con Python.
create function pg_temp.header(n integer) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('format','stc-personnel-file','format_version',1,'algorithm','A256GCM+RSA-OAEP-256',
 'document_id',f.id,'version_id',f.version_id,'created_by',f.created_by,'title',f.title,
 'filename',f.filename,'media_type',f.media_type,'size',f.size,'envelopes',(
 select jsonb_agg(jsonb_build_object('profile_id',r.profile_id,'key_id',r.key_id,'fingerprint',k.fingerprint,
 'wrapped_key_base64',repeat('A',342)||'==') order by r.profile_id)
 from public.stc_personnel_file_recipients r join public.stc_encryption_keys k on k.id=r.key_id where r.document_id=f.id))
 from public.stc_personnel_files f where f.id=pg_temp.file_id(n); $$;
create function pg_temp.publish(n integer,header jsonb default null) returns void language sql as $$
 select public.server_commit_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(n),pg_temp.version_id(n),
 coalesce(header,pg_temp.header(n)),repeat('A',16),repeat('A',22)||'==',repeat('a',64)); $$;

-- Las primitivas criptográficas se prueban en Python; aquí se verifican eventos,
-- transacciones, proyección autorizada y conteos globales de los expedientes.
select pg_temp.reserve(1);
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='personnel_file_shared'),'reserva no avisa de un archivo disponible');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,pending_personnel}')::int=1,'carga incompleta es pendiente de su creador');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,pending_total}')::int=1,'pendiente propio entra al total');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,personnel_total}')::int=0,'preparación no infla expedientes disponibles');
select pg_temp.assert_true(public.stc_dashboard()#>>'{pending,0,target_kind}'='personnel_file','carga pendiente dirige al módulo de expedientes');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,pending_personnel}')::int=0,'destinatario no ve pendiente de otro creador');
select pg_temp.assert_true(jsonb_array_length(public.stc_dashboard()->'recent')=0,'destinatario no ve preparación en recientes');
select pg_temp.expect_error('select pg_temp.publish(1,''{}'')','PF422','publicación inválida se revierte');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='personnel_file_shared'),'fallo de publicación no emite aviso');
select pg_temp.publish(1);
select pg_temp.publish(1);
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='personnel_file_shared'),'publicación y reintento emiten un solo aviso');
select pg_temp.assert_true((select bool_and(recipient_id='10000000-0000-4000-8000-000000000003') from public.stc_notifications where event_type='personnel_file_shared'),'solo destinatario original recibe el aviso');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='personnel_file_shared' and recipient_id='10000000-0000-4000-8000-000000000002'),'creador no recibe aviso de sí mismo');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where title like '%Expediente de prueba%' or body like '%expediente.txt%'),'tabla publicada en Realtime no expone títulos ni nombres de archivo');
select pg_temp.assert_true((select c.subject='Expediente de prueba' from stc_private.notification_context c join public.stc_notifications n on n.id=c.notification_id where n.event_type='personnel_file_shared'),'título capturado en contexto privado');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,documents_total}')::int=1,'total documental incorpora expediente publicado');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,personnel_total}')::int=1,'contador propio de expedientes');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,signed_total}')::int=0,'expediente cifrado no se cuenta como firmado');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,notes_total}')::int=0,'expediente no se cuenta como nota especial');
select pg_temp.assert_true((public.stc_dashboard()#>>'{category_counts,expediente}')::int=1,'categoría cuenta expedientes autorizados');
select pg_temp.assert_true(public.stc_dashboard()#>>'{recent,0,target_kind}'='personnel_file','reciente conserva tipo de expediente');
select pg_temp.assert_true(public.stc_dashboard()#>>'{recent,0,target_id}'=pg_temp.file_id(1)::text,'reciente dirige al UUID exacto');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,pending_total}')::int=0,'disponible no implica una firma o recuperación pendiente');
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','documents')->'items') n where n->>'target_kind'='personnel_file' and n->>'title'='Te compartieron el expediente «Expediente de prueba»' and n->>'target_id'=pg_temp.file_id(1)::text),'bandeja identifica expediente y enlace exacto');
select pg_temp.expect_error($q$select stc_private.notify_profile('10000000-0000-4000-8000-000000000003','personnel_file_shared','personnel_file',pg_temp.file_id(1),null,'forged')$q$,'42501','JWT no puede fabricar avisos');
select public.read_stc_notification((select id from public.stc_notifications where event_type='personnel_file_shared'));
reset role;
create temporary table notice_memory as select id,created_at,read_at from public.stc_notifications where event_type='personnel_file_shared';
select public.server_complete_personnel_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),repeat('a',64));
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='personnel_file_shared'),'descargar no reemite aviso');
select pg_temp.reserve(2);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,documents_total}')::int=1,'pendientes no se suman a disponibles');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,pending_personnel}')::int=1,'creador ve segunda carga incompleta');
select public.server_cancel_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(2),pg_temp.version_id(2));
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,pending_personnel}')::int=0,'cancelación retira pendiente');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,personnel_total}')::int=1,'cancelada no se cuenta como disponible');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where target_kind='personnel_file' and target_id=pg_temp.file_id(2)),'cancelación no anuncia expediente compartido');
select pg_temp.reserve(3,'[{"profile_id":"10000000-0000-4000-8000-000000000002"}]');
select pg_temp.publish(3);
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='personnel_file_shared'),'expediente propio no envía avisos a nadie más');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,personnel_total}')::int=2,'creador ve dos expedientes propios disponibles');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,documents_total}')::int=0,'administrador ajeno no cuenta expedientes de otros');
select pg_temp.assert_true(jsonb_array_length(public.stc_dashboard()->'recent')=0,'administrador ajeno no recibe recientes de otros');
select pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','documents')->'items') n where n->>'target_kind'='personnel_file'),'administrador ajeno no recibe avisos de otros');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
delete from public.role_permissions where role_code='member' and permission_code='documents.read_assigned';
select pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','documents')->'items') n where n->>'title' like '%Expediente de prueba%'),'retirar permiso enmascara título histórico');
select pg_temp.expect_error('select public.stc_dashboard()','DA403','dashboard vuelve a comprobar permiso actual');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications n join notice_memory m using(id) where n.created_at<>m.created_at or n.read_at is distinct from m.read_at),'enmascarar conserva UUID fecha y lectura');
insert into public.role_permissions values('member','documents.read_assigned');
select public.retire_encryption_key('60000000-0000-4000-8000-000000000003');
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,personnel_total}')::int=1,'retirar clave no oculta expedientes históricos');
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','documents')->'items') n where n->>'title'='Te compartieron el expediente «Expediente de prueba»'),'clave retirada conserva contexto autorizado');
-- Más registros que la página: ningún contador se deduce del límite de seis.
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000099','Nueva',repeat('C',392),repeat('c',64));
select public.server_activate_encryption_key('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000099');
do $$ declare i integer;begin for i in 4..25 loop perform pg_temp.reserve(i);perform pg_temp.publish(i);end loop;end; $$;
select pg_temp.assert_true((public.stc_dashboard()#>>'{stats,personnel_total}')::int=23,'contador incluye más de veinte expedientes');
select pg_temp.assert_true(jsonb_array_length(public.stc_dashboard()->'recent')=6,'recientes limitados a seis sin alterar total');
select pg_temp.assert_true((public.stc_dashboard()#>>'{category_counts,expediente}')::int=23,'categoría usa total completo');
-- La generación de avisos comparte transacción con la publicación.
select pg_temp.reserve(30);
create function pg_temp.fail_notice() returns trigger language plpgsql as $$begin if new.event_type='personnel_file_shared' then raise exception 'fallo simulado' using errcode='P0001';end if;return new;end;$$;
create trigger test_fail_notice before insert on public.stc_notifications for each row execute function pg_temp.fail_notice();
select pg_temp.expect_error('select pg_temp.publish(30)','P0001','fallo de aviso revierte publicación');
select pg_temp.assert_true((select state='staging' from public.stc_personnel_files where id=pg_temp.file_id(30)),'no queda publicado a medias');
select pg_temp.assert_true(not exists(select 1 from stc_private.personnel_file_material where document_id=pg_temp.file_id(30)),'rollback conserva ausencia de material');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where target_id=pg_temp.file_id(30)),'rollback no deja aviso parcial');
drop trigger test_fail_notice on public.stc_notifications;
select pg_temp.publish(30);
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='personnel_file_shared' and target_id=pg_temp.file_id(30)),'reintento posterior publica y avisa una vez');
rollback;
