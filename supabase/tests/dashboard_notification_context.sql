-- SOLO BD de pruebas vacía con las nueve migraciones. Todo se revierte.
-- Las aportaciones de este SQL son fixtures estructurales; el cifrado real se prueba en Python.
begin;
do $$ begin if exists(select 1 from public.profiles) then raise exception 'Usa una BD de pruebas vacía.'; end if; end; $$;
create function pg_temp.assert_true(value boolean,label text) returns text language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',label; end if; return 'ok - '||label; end; $$;
create function pg_temp.expect_error(statement text,expected text,label text) returns text language plpgsql as $$ declare code text; begin
 begin execute statement; exception when others then get stacked diagnostics code=returned_sqlstate;
 if code<>expected then raise exception 'FAIL: % (%, esperado %)',label,code,expected; end if; return 'ok - '||label; end;
 raise exception 'FAIL: % (sin error)',label; end; $$;
do $$ begin execute format('grant usage on schema %I to anon,authenticated,service_role',pg_my_temp_schema()::regnamespace::text); end; $$;
insert into public.profiles(id,email,display_name,role_code) values
 ('10000000-0000-4000-8000-000000000001','admin@custody.test','Admin','admin'),
 ('10000000-0000-4000-8000-000000000002','issuer@custody.test','Emisor','staff'),
 ('10000000-0000-4000-8000-000000000003','member@custody.test','Integrante','member'),
 ('10000000-0000-4000-8000-000000000004','manager@custody.test','Responsable','ambassador'),
 ('10000000-0000-4000-8000-000000000005','new@custody.test','Nuevo','member');
insert into auth.users(id,email,raw_app_meta_data) select replace(id::text,'10000000','20000000')::uuid,email,'{"provider":"google"}' from public.profiles;
insert into public.stc_groups(id,name,created_by) values('30000000-0000-4000-8000-000000000001','Grupo original','10000000-0000-4000-8000-000000000001');
insert into public.stc_group_members(group_id,profile_id,group_role) select '30000000-0000-4000-8000-000000000001',id,
 case when id='10000000-0000-4000-8000-000000000004' then 'manager' else 'member' end from public.profiles where id in (
 '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004');
select public.server_register_encryption_key(p.id,replace(p.id::text,'10000000','50000000')::uuid,'Cifrado',repeat('A',392),lpad(row_number() over(order by p.id)::text,64,'0')) from public.profiles p;
select public.server_activate_encryption_key(profile_id,id) from public.stc_encryption_keys;
select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12);
create function pg_temp.header(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('format','stc-special-note','version',1,'algorithm','AES-256-GCM+Shamir','filename',n.filename,'media_type',n.media_type,'size',n.size,
 'share_count',n.participant_count,'threshold',n.participant_count,'access_mode','all-members','document_id','0123456789abcdef0123456789abcdef',
 'nonce_base64','AAAAAAAAAAAAAAAA','tag_base64','AAAAAAAAAAAAAAAAAAAAAA==') from public.stc_group_notes n where id=target;
$$;
create function pg_temp.envelopes(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_agg(jsonb_build_object('context',jsonb_build_object('format','stc-share-envelope','version',1,'algorithm','RSA-OAEP-256+A256GCM',
 'note_id',target,'set_id','0123456789abcdef0123456789abcdef','recipient_id',x.profile_id,'key_id',x.encryption_key_id,'fingerprint',k.fingerprint,
 'share_index',x.share_index,'share_count',n.participant_count,'threshold',n.participant_count),
 'wrapped_key_base64',repeat('A',342)||'==','nonce_base64','AAAAAAAAAAAAAAAA','tag_base64','AAAAAAAAAAAAAAAAAAAAAA==','ciphertext_base64','AAAA') order by x.share_index)
 from public.stc_group_note_participants x join public.stc_encryption_keys k on k.id=x.encryption_key_id join public.stc_group_notes n on n.id=x.note_id where x.note_id=target;
$$;
select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',pg_temp.header('40000000-0000-4000-8000-000000000001'),repeat('a',64),pg_temp.envelopes('40000000-0000-4000-8000-000000000001'));
create function pg_temp.contribution(target uuid,actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('context',jsonb_build_object('format','stc-share-envelope','version',1,'algorithm','RSA-OAEP-256+A256GCM','purpose','recovery-contribution',
 'request_id',r.id,'note_id',r.note_id,'contributor_id',actor,'recipient_id',r.requester_id,'key_id',k.id,'fingerprint',k.fingerprint,
 'set_id',n.package_header->>'document_id','share_index',p.share_index,'share_count',r.participant_count,'threshold',r.participant_count),
 'wrapped_key_base64',repeat('A',342)||'==','nonce_base64','AAAAAAAAAAAAAAAA','tag_base64','AAAAAAAAAAAAAAAAAAAAAA==','ciphertext_base64','AAAA')
 from public.stc_note_recoveries r join public.stc_encryption_keys k on k.id=r.requester_key_id join public.stc_group_notes n on n.id=r.note_id
 join public.stc_note_recovery_participants p on p.request_id=r.id and p.profile_id=actor where r.id=target;
$$;

select pg_temp.assert_true((select rowsecurity from pg_tables where schemaname='stc_private' and tablename='notification_context'),'contexto privado con RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','stc_private.notification_context','SELECT'),'JWT no consulta snapshots directamente');
select pg_temp.assert_true(not has_table_privilege('service_role','stc_private.notification_context','SELECT'),'canal de servidor tampoco lee snapshots directamente');
select pg_temp.assert_true(not has_function_privilege('authenticated','stc_private.capture_notification_context(uuid,boolean)','EXECUTE'),'cliente no fabrica contexto histórico');
select pg_temp.assert_true(not exists(select 1 from pg_publication_tables where tablename='notification_context'),'Realtime no publica nombres privados');
set local role anon;
select pg_temp.expect_error('select public.stc_dashboard()','42501','dashboard sin acceso anónimo');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'notes_total')::int=1,'dashboard cuenta nota real de grupo');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'documents_total')::int=1,'total documental incluye la nota');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'signed_total')::int=0,'cifrado no se cuenta como firma');
select pg_temp.assert_true((public.stc_dashboard()->'recent'->0->>'target_kind')='note','reciente de nota conserva tipo y destino');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_total')::int=0,'nota compartida sola no es una tarea pendiente');
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Consultar acuerdo',60);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_recoveries')::int=1,'aportación propia pendiente llega al dashboard');
select pg_temp.assert_true((public.stc_dashboard()->'pending'->0->>'related_id')='40000000-0000-4000-8000-000000000001','pendiente enlaza solicitud y nota exactas');
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.list_stc_notifications()->'items') x where x->>'event_type'='recovery_requested' and x->>'title'='Solicitud de recuperación de «Nota»' and x->>'body' like '%Grupo: Grupo original%' and x->>'body' like '%Solicitante: Integrante%'),'aviso identifica nota, grupo y solicitante');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where title like '%«Nota»%' or body like '%Solicitante: Integrante%'),'nombres no se copian a tabla publicada');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'documents_total')::int=0,'admin ajeno no cuenta documentos de otros');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_total')::int=0,'admin ajeno no cuenta recuperaciones de otros');
reset role;
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'));
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_recoveries')::int=0,'aporte registrado deja de ser acción propia pendiente');
reset role;
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'));
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'));
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_recoveries')::int=1,'n/n habilita tarea de recuperación solo para solicitante');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_recoveries')::int=0,'aportante no recibe tarea de descargar para otra cuenta');
reset role;
select public.server_complete_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',4);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_recoveries')::int=0,'reintento de descarga completada no infla pendientes');
-- Cuentas con más de una página de notas: total antes de limitar recientes.
do $$ declare note_id uuid;i integer;begin
 for i in 1..21 loop
  note_id:=gen_random_uuid();
  perform public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002',note_id,'30000000-0000-4000-8000-000000000001',1,'Nota adicional '||i,'nota.txt','text/plain',12);
  perform public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002',note_id,pg_temp.header(note_id),repeat('a',64),pg_temp.envelopes(note_id));
 end loop;
end; $$;
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'notes_total')::int=22,'cuenta todas las notas, no solo veinte');
select pg_temp.assert_true(jsonb_array_length(public.stc_dashboard()->'recent')=6,'recientes limitados sin alterar total');

select public.server_register_signing_key('10000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','Firma emisor',repeat('A',392),repeat('8',64));
select public.server_register_signing_key('10000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004','Firma embajador',repeat('B',392),repeat('9',64));
select public.server_begin_memorandum('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Documento reservado','memo.pdf','application/pdf',12,repeat('a',64),'[{"profile_id":"10000000-0000-4000-8000-000000000003"}]','10000000-0000-4000-8000-000000000004');
select public.server_complete_memorandum('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='document_shared'),'borrador no avisa a destinatarios finales');
select public.server_commit_document_signature('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001',repeat('a',64),repeat('A',342)||'==');
select public.server_request_memorandum_review('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='approval_requested' and recipient_id='10000000-0000-4000-8000-000000000004'),'revisión avisa solo al aprobador asignado');
select public.server_request_memorandum_review('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='approval_requested'),'reintento de revisión no duplica aviso');
select public.server_commit_document_signature('10000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004',repeat('a',64),repeat('A',342)||'==');
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='document_approved' and recipient_id='10000000-0000-4000-8000-000000000002'),'aprobación avisa al emisor para completar envío');
select public.server_send_memorandum('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select public.server_send_memorandum('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='document_shared' and recipient_id='10000000-0000-4000-8000-000000000003'),'envío avisa solo al destinatario y sin duplicados');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where body like '%Documento reservado%' or body like '%memo.pdf%'),'no guarda títulos ni archivos en el aviso');

select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'documents_total')::int=23,'total combina veintidós notas y un documento');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'notes_total')::int=22,'memorándum no se cuenta como nota');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'signed_total')::int=1,'firmados refleja solo documentos firmados');
select pg_temp.assert_true((public.stc_dashboard()->'category_counts'->>'memorandum')::int=1,'categoría usa total documental real');
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','documents')->'items') x where x->>'event_type'='document_shared' and x->>'title'='Te compartieron «Documento reservado»'),'documento compartido tiene título específico');

select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000099','30000000-0000-4000-8000-000000000001',1,'Preparación','nota.txt','text/plain',12);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_notes')::int=1,'preparación es tarea del creador');
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'notes_total')::int=22,'preparación no publicada no aumenta notas disponibles');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.stc_dashboard()->'stats'->>'pending_notes')::int=0,'preparación no aparece como tarea del destinatario');
-- Un grupo nuevo y un cambio posterior no reescriben el nombre histórico.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.create_stc_group('Grupo histórico','', '[{"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"manager"},{"profile_id":"10000000-0000-4000-8000-000000000003","group_role":"member"}]');
select public.update_stc_group((select id from public.stc_groups where name='Grupo histórico'),'Grupo renombrado','',true,1);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','groups')->'items') x where x->>'title'='Te agregaron al grupo «Grupo histórico»'),'nombre capturado no cambia al renombrar grupo');
-- Backfill idempotente del aviso anterior, sin reemitir ni perder lectura.
create temporary table backfill_notice as select id,created_at,read_at from public.stc_notifications where recipient_id='10000000-0000-4000-8000-000000000003' and event_type='recovery_requested';
select public.read_stc_notification((select id from backfill_notice));
update backfill_notice set read_at=(select n.read_at from public.stc_notifications n where n.id=backfill_notice.id);
delete from stc_private.notification_context where notification_id in(select id from backfill_notice);
select stc_private.capture_notification_context(id,true) from backfill_notice;
select stc_private.capture_notification_context(id,true) from backfill_notice;
select pg_temp.assert_true((select count(*)=1 from stc_private.notification_context where notification_id in(select id from backfill_notice) and backfilled),'backfill captura una sola memoria');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications n join backfill_notice b using(id) where n.created_at<>b.created_at or n.read_at is distinct from b.read_at),'backfill conserva UUID, fecha y lectura');
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','recovery')->'items') x where x->>'event_type'='recovery_requested' and x->>'title'='Solicitud de recuperación de «Nota»'),'aviso anterior enriquecido sin duplicación');
-- Falta de permiso documental enmascara contexto, sin borrar lectura ni historial.
create temporary table dashboard_notice_memory as select id,created_at,read_at from public.stc_notifications where event_type='recovery_requested';
delete from public.role_permissions where role_code='member' and permission_code='documents.read_assigned';
select pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.list_stc_notifications('all','recovery')->'items') x where x->>'title' like '%«Nota»%' or x->>'body' like '%Grupo original%'),'API oculta nombres documentales tras retirar permiso');
select pg_temp.expect_error('select public.stc_dashboard()','DA403','dashboard comprueba permiso actual');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications n join dashboard_notice_memory m using(id) where n.created_at<>m.created_at or n.read_at is distinct from m.read_at),'proyección no altera fecha ni lectura');
rollback;
