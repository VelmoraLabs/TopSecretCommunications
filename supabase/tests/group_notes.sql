-- Solo BD aislada vacía, con las cinco migraciones aplicadas. Todo se revierte.
begin;
do $$ begin if exists(select 1 from public.profiles) then raise exception 'Usa una BD aislada sin datos reales.'; end if; end; $$;
create function pg_temp.assert_true(condition boolean,label text) returns text language plpgsql as $$ begin
 if condition is distinct from true then raise exception 'FAIL: %',label; end if; return 'ok - '||label; end; $$;
create function pg_temp.expect_error(statement text,expected text,label text) returns text language plpgsql as $$ declare code text; begin
 begin execute statement; exception when others then get stacked diagnostics code=returned_sqlstate;
 if code<>expected then raise exception 'FAIL: % (%, esperado %)',label,code,expected; end if; return 'ok - '||label; end;
 raise exception 'FAIL: % (sin error)',label; end; $$;
do $$ begin execute format('grant usage on schema %I to anon,authenticated,service_role',pg_my_temp_schema()::regnamespace::text); end; $$;
insert into public.profiles(id,email,display_name,role_code) values
 ('10000000-0000-4000-8000-000000000001','admin@notes.test','Admin','admin'),
 ('10000000-0000-4000-8000-000000000002','issuer@notes.test','Emisor','staff'),
 ('10000000-0000-4000-8000-000000000003','member@notes.test','Integrante original','member'),
 ('10000000-0000-4000-8000-000000000004','manager@notes.test','Responsable original','ambassador'),
 ('10000000-0000-4000-8000-000000000005','new@notes.test','Nuevo integrante','member');
insert into auth.users(id,email,raw_app_meta_data) select replace(id::text,'10000000','20000000')::uuid,email,'{"provider":"google"}' from public.profiles;
insert into public.stc_groups(id,name,created_by) values('30000000-0000-4000-8000-000000000001','Grupo original','10000000-0000-4000-8000-000000000001');
insert into public.stc_group_members(group_id,profile_id,group_role) select '30000000-0000-4000-8000-000000000001',id,
 case when id='10000000-0000-4000-8000-000000000004' then 'manager' else 'member' end from public.profiles where id in (
 '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004');
select pg_temp.assert_true((select count(*)=3 from pg_tables where schemaname='public' and tablename in ('stc_group_notes','stc_group_note_participants','stc_group_note_audit') and rowsecurity),'RLS en notas, snapshot y auditoría');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_confirm_group_note(uuid,uuid,text)','EXECUTE'),'JWT no puede confirmar directamente');
select pg_temp.assert_true(not has_table_privilege('service_role','stc_private.group_note_receipts','SELECT'),'recibos no legibles como tabla ni por credencial service_role');
set local role anon;
select pg_temp.expect_error('select public.list_group_notes()','42501','anónimo sin RPC');
select pg_temp.expect_error('select * from public.stc_group_notes','42501','anónimo sin tablas');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((public.list_note_groups()->>'total')::int=0,'administrador ajeno no selecciona grupos para notas');
select pg_temp.expect_error('select * from stc_private.group_note_receipts','42501','usuario sin recibos');
select pg_temp.expect_error($q$select public.server_cancel_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001')$q$,'42501','JWT no cancela por canal servidor');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error('select public.list_note_groups()','PN403','rol integrante sin documents.create no crea');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.list_note_groups()->>'total')::int=1,'emisor integrante encuentra su grupo');
select pg_temp.assert_true(jsonb_array_length(public.list_note_groups()#>'{items,0,members}')=3,'previsualiza a todos sin excluir silenciosamente');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_begin_group_note('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12)$q$,'PN404','admin ajeno tampoco crea por backend');
select pg_temp.expect_error($q$select public.server_begin_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',9,'Nota','nota.txt','text/plain',12)$q$,'PN409','versión obsoleta rechazada');
select public.server_begin_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota original','nota.txt','text/plain',12);
select pg_temp.expect_error($q$select public.server_begin_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12)$q$,'PN409','request_id duplicado no duplica carga');
reset role;
select pg_temp.assert_true((select count(*)=3 from public.stc_group_note_participants),'snapshot conserva tres participantes');
select pg_temp.assert_true((select string_agg(share_index::text,',' order by profile_id)='1,2,3' from public.stc_group_note_participants),'índices estables por perfil');
select pg_temp.assert_true((select count(*)=1 from public.stc_group_note_audit),'fallos no escriben auditorías parciales');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_group_notes()->>'total')::int=0,'integrante no ve preparación sin resguardo');
select pg_temp.expect_error($q$select public.get_group_note('40000000-0000-4000-8000-000000000001')$q$,'PN404','UUID conocido no abre preparación');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.get_group_note('40000000-0000-4000-8000-000000000001')#>>'{note,state}'='staging','emisor consulta carga pendiente');
select pg_temp.expect_error($q$update public.stc_group_notes set title='Alterada'$q$,'42501','snapshot no editable directamente');
select pg_temp.expect_error('delete from public.stc_group_note_participants','42501','participantes no borrables desde navegador');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_confirm_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',repeat('a',64))$q$,'PN422','sin resguardo no se publica');
select pg_temp.expect_error($q$select public.server_upload_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('b',64))$q$,'PN422','cabecera incompleta rechazada');
select public.server_upload_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',
 '{"format":"stc-special-note","version":1,"algorithm":"AES-256-GCM+Shamir","filename":"nota.txt","media_type":"text/plain","size":12,"share_count":3,"threshold":3,"access_mode":"all-members","document_id":"0123456789abcdef0123456789abcdef","nonce_base64":"AAAAAAAAAAAAAAAA","tag_base64":"AAAAAAAAAAAAAAAAAAAAAA=="}',repeat('a',64),repeat('b',64));
select pg_temp.assert_true(not public.server_cancel_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',true),'respuesta de carga perdida no borra ciphertext confirmado');
select pg_temp.expect_error($q$select public.server_confirm_group_note('10000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001',repeat('b',64))$q$,'PN404','otro participante no confirma por el emisor');
select pg_temp.expect_error($q$select public.server_confirm_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',repeat('c',64))$q$,'PN422','recibo de otra nota no confirma');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000003','Integrante original','member',false);
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_confirm_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',repeat('b',64))$q$,'PN409','baja de participante entre creación y publicación bloquea');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000003','Integrante original','member',true);
reset role; set local role service_role;
select public.server_confirm_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',repeat('b',64));
select public.server_confirm_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',repeat('b',64));
select pg_temp.expect_error($q$select public.server_cancel_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001')$q$,'PN409','compartida no se cancela ni se borra');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_group_note_audit where action='backup_confirmed'),'confirmación idempotente con una auditoría');
select pg_temp.assert_true((select ready_at is not null from public.stc_group_notes),'fecha de disponibilidad real');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_group_notes()->>'total')::int=1,'participante original ve nota compartida');
select pg_temp.assert_true((select count(*)=3 from public.stc_group_note_participants),'RLS permite snapshot original');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((public.list_group_notes()->>'total')::int=0,'administrador externo no hereda documentos');
select pg_temp.assert_true((select count(*)=0 from public.stc_group_notes),'RLS impide lectura directa de admin ajeno');
select public.set_stc_group_member('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','member',1);
select public.remove_stc_group_member('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',2);
select public.update_stc_group('30000000-0000-4000-8000-000000000001','Grupo renombrado','',false,3);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000005',true);
select pg_temp.assert_true((public.list_group_notes()->>'total')::int=0,'nuevo integrante no recibe notas anteriores');
select pg_temp.expect_error($q$select public.get_group_note('40000000-0000-4000-8000-000000000001')$q$,'PN404','nuevo integrante no abre por UUID');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(public.get_group_note('40000000-0000-4000-8000-000000000001')#>>'{note,group_name}'='Grupo original','nombre histórico no cambia');
select pg_temp.assert_true(jsonb_array_length(public.get_group_note('40000000-0000-4000-8000-000000000001')->'participants')=3,'retirado conserva asignación documental original');
select pg_temp.assert_true((select count(*)=1 from public.stc_group_notes),'grupo archivado no borra documentos');
reset role;
select pg_temp.assert_true((select not package_header ? 'ciphertext_base64' from public.stc_group_notes),'ciphertext no duplicado en DB');
select pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_name='stc_group_notes' and column_name in ('plaintext','key','shares','backup_receipt')),'sin claves, fragmentos ni originales persistidos');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000003','Integrante original','member',false);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.get_group_note('40000000-0000-4000-8000-000000000001')$q$,'PN404','perfil desactivado pierde acceso incluso a asignación original');
reset role;
rollback;
