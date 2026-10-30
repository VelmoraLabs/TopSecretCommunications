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

select pg_temp.assert_true((select count(*)=4 from pg_tables where (schemaname='public' and tablename in
 ('stc_personnel_files','stc_personnel_file_recipients','stc_personnel_file_audit') or schemaname='stc_private' and tablename='personnel_file_material') and rowsecurity),'RLS en cuatro tablas nuevas');
select pg_temp.assert_true(not has_table_privilege('service_role','stc_private.personnel_file_material','SELECT'),'material privado sin lectura directa de service_role');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_personnel_file_material(uuid,uuid)','EXECUTE'),'material solo por RPC de servidor');
set local role anon;
select pg_temp.expect_error('select public.list_personnel_files()','42501','anónimo sin RPC');
select pg_temp.expect_error('select * from public.stc_personnel_files','42501','anónimo sin tablas');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error('select pg_temp.reserve(1)','42501','JWT no reserva ni elige un actor por canal servidor');
select pg_temp.expect_error('select * from stc_private.personnel_file_material','42501','JWT no obtiene sobres por tabla');
select pg_temp.expect_error('select stc_private.personnel_file_detail(pg_temp.file_id(1))','42501','JWT no ejecuta helper sin autorización');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_begin_personnel_file('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),'Expediente','file','text/plain',0,'[]')$q$,'PF403','miembro no crea expedientes');
select pg_temp.expect_error('select pg_temp.reserve(1,''[]'')','PF422','exige destinatario');
select pg_temp.expect_error('select pg_temp.reserve(1,''{}'')','PF422','rechaza forma JSON distinta');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"invalido"}]')$q$,'PF422','UUID inválido produce error de contrato');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000003","key_id":"libre"}]')$q$,'PF422','cliente no asigna claves');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000003"},{"profile_id":"10000000-0000-4000-8000-000000000003"}]')$q$,'PF422','destinatarios distintos');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000005"}]')$q$,'PF422','perfil no vinculado no recibe');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000004"}]')$q$,'PF428','sin clave activa no se reserva');
select pg_temp.reserve(1);
select pg_temp.expect_error('select pg_temp.reserve(1)','PF409','identificadores no se reutilizan');
reset role;
select pg_temp.assert_true((select count(*)=2 from public.stc_personnel_file_recipients),'creador y destinatario incluidos una sola vez');
select pg_temp.assert_true((select count(*)=1 from public.stc_personnel_file_audit),'fallos no dejan reservas parciales');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.get_personnel_file(pg_temp.file_id(1))#>>'{file,state}'='staging','creador ve preparación');
select pg_temp.assert_true(not (public.get_personnel_file(pg_temp.file_id(1)) ? 'header'),'detalle no expone sobres');
select pg_temp.expect_error('update public.stc_personnel_files set state=''ready''','42501','sin escritura directa a estados');
select pg_temp.expect_error('delete from public.stc_personnel_file_recipients','42501','sin cambio de destinatarios desde cliente');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_personnel_files()->>'total')::int=0,'destinatario no ve preparación');
select pg_temp.expect_error('select public.get_personnel_file(pg_temp.file_id(1))','PF404','UUID no abre carga pendiente');
reset role; set local role service_role;
select pg_temp.expect_error('select pg_temp.publish(1,''{}'')','PF422','cabecera incompleta no publica');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{title}','"Alterado"'))$q$,'PF422','metadatos no sustituyen reserva');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes}','[]'))$q$,'PF422','faltan sobres');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes,0,key_id}','"60000000-0000-4000-8000-000000000003"'))$q$,'PF422','clave ajena no sustituye snapshot');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes,0,wrapped_key_base64}','"invalido"'))$q$,'PF422','sobre Base64 inválido');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes,0,wrapped_key_base64}',to_jsonb(repeat('!',344))))$q$,'PF422','caracteres Base64 inválidos se rechazan de forma controlada');
select pg_temp.expect_error($q$select public.server_commit_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(1),pg_temp.version_id(1),pg_temp.header(1),repeat('A',16),repeat('A',21)||'B==',repeat('a',64))$q$,'PF422','padding no canónico del tag rechazado');
select pg_temp.expect_error($q$select pg_temp.publish(1,pg_temp.header(1)||'{"extra":"no permitido"}')$q$,'PF422','campos extra de cabecera rechazados');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes}',jsonb_build_array(pg_temp.header(1)#>'{envelopes,1}',pg_temp.header(1)#>'{envelopes,0}')))$q$,'PF422','orden de sobres debe coincidir con AAD canónica');
select pg_temp.publish(1);
select pg_temp.publish(1);
select pg_temp.assert_true(not public.server_cancel_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(1),pg_temp.version_id(1)),'respuesta perdida no cancela archivo publicado');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_personnel_file_audit where action='published'),'publicación idéntica no duplica auditoría');
select pg_temp.assert_true((select count(*)=1 from stc_private.personnel_file_material),'un material privado completo');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_personnel_files()->>'total')::int=1,'destinatario ve expediente listo');
select pg_temp.assert_true((public.list_personnel_files('zzzz')->>'total')::int=0,'filtro por título');
select pg_temp.expect_error('select public.list_personnel_files('''',0,0)','PF422','límites inválidos');
select pg_temp.assert_true((select count(*)=1 from public.stc_personnel_files),'RLS permite asignado');
select pg_temp.assert_true((select count(*)=2 from public.stc_personnel_file_recipients),'lista de destinatarios autorizada sin sobres');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=0 from public.stc_personnel_files),'administrador ajeno no ve expedientes');
select pg_temp.assert_true((select count(*)=0 from public.stc_personnel_file_recipients),'administrador ajeno no ve asignaciones');
select pg_temp.expect_error('select public.get_personnel_file(pg_temp.file_id(1))','PF404','administrador ajeno sin detalle');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_personnel_file_material('10000000-0000-4000-8000-000000000001',pg_temp.file_id(1))$q$,'PF404','canal servidor también rechaza actor ajeno');
select pg_temp.assert_true(public.server_personnel_file_material('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1))#>>'{header,format}'='stc-personnel-file','material accesible solo al autorizado');
select public.server_complete_personnel_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),repeat('a',64));
select pg_temp.expect_error($q$select public.server_complete_personnel_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(2),repeat('a',64))$q$,'PF409','revalida versión antes de entregar');
select pg_temp.reserve(2);
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.retire_encryption_key('60000000-0000-4000-8000-000000000003');
reset role; set local role service_role;
select pg_temp.expect_error('select pg_temp.publish(2)','PF409','retiro durante carga bloquea publicación');
select pg_temp.assert_true(public.server_cancel_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(2),pg_temp.version_id(2)),'cancela reserva fallida');
select pg_temp.assert_true(public.server_cancel_personnel_file('10000000-0000-4000-8000-000000000002',pg_temp.file_id(2),pg_temp.version_id(2)),'repetir limpieza de cancelada es seguro');
select pg_temp.assert_true(public.server_personnel_file_material('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1)) is not null,'retirada conserva apertura histórica');
select pg_temp.publish(1);
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_personnel_file_audit where action='cancelled'),'cancelación idempotente');
select pg_temp.assert_true((select count(*)=1 from stc_private.personnel_file_material),'cancelada nunca obtuvo material');
update public.profiles set is_active=false where id='10000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.stc_personnel_files),'baja bloquea RLS inmediatamente');
select pg_temp.expect_error('select public.list_personnel_files()','PF403','perfil inactivo no lista');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_complete_personnel_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),repeat('a',64))$q$,'PF404','baja durante descifrado impide entrega final');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_personnel_file_audit where action='downloaded'),'descargas rechazadas no crean auditoría de entrega');
select pg_temp.assert_true(not exists(select 1 from information_schema.columns
 where table_name in ('stc_personnel_files','stc_personnel_file_recipients','personnel_file_material')
 and column_name in ('aes_key','password','private_base64','plaintext')),'sin campos para secretos en claro');
rollback;
