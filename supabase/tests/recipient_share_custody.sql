-- SOLO BD de pruebas vacía con las seis migraciones. Todo se revierte.
-- Los sobres de este SQL son fixtures estructurales; el cifrado real se prueba en Python.
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
select pg_temp.assert_true((select count(*)=3 from pg_tables where schemaname='public' and tablename in ('stc_encryption_keys','stc_encryption_key_audit','stc_group_note_shares') and rowsecurity),'RLS en las tres tablas nuevas');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_activate_encryption_key(uuid,uuid)','EXECUTE'),'JWT no activa sin comprobación backend');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_register_encryption_key(uuid,uuid,text,text,text)','EXECUTE'),'JWT no registra públicas arbitrarias');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_commit_distributed_note(uuid,uuid,jsonb,text,jsonb)','EXECUTE'),'JWT no declara distribución');
set local role anon;
select pg_temp.expect_error('select public.list_own_encryption_keys()','42501','anónimo sin claves');
select pg_temp.expect_error('select * from public.stc_group_note_shares','42501','anónimo sin sobres');
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12)$q$,'PN428','faltan claves: no se crea nota irrecuperable');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.stc_group_notes),'falta de claves revierte nota y snapshot');
set local role service_role;
reset role;
select public.server_register_encryption_key(p.id,replace(p.id::text,'10000000','50000000')::uuid,'Cifrado',repeat('A',392),lpad(row_number() over(order by p.id)::text,64,'0')) from public.profiles p where id<>'10000000-0000-4000-8000-000000000005';
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(jsonb_array_length(public.list_own_encryption_keys()->'items')=1,'integrante consulta solo su clave');
select pg_temp.assert_true((select count(*)=1 from public.stc_encryption_keys),'RLS no filtra otras claves al integrante');
select pg_temp.expect_error($q$select public.get_own_encryption_key('50000000-0000-4000-8000-000000000002')$q$,'PK404','UUID ajeno no expone clave');
select pg_temp.expect_error($q$select public.retire_encryption_key('50000000-0000-4000-8000-000000000002')$q$,'PK404','integrante no retira clave ajena');
select pg_temp.expect_error($q$update public.stc_encryption_keys set state='active'$q$,'42501','sin escritura directa a claves');
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12)$q$,'PN428','clave pendiente no habilita distribución');
reset role;
select public.server_activate_encryption_key(profile_id,id) from public.stc_encryption_keys;
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
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.list_note_groups()#>>'{items,0,members,0,encryption_ready}')::boolean,'selector informa claves activas');
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12)$q$,'PN404','admin ajeno no crea aunque tenga clave');
select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Nota','nota.txt','text/plain',12);
reset role;
select pg_temp.assert_true((select count(*)=3 from public.stc_group_note_participants where encryption_key_id is not null),'snapshot vincula tres claves de destinatarios originales');
select pg_temp.assert_true((select custody_mode='individual-v1' and state='staging' from public.stc_group_notes),'nuevo modo explícito sin alterar portable');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.get_own_note_share('40000000-0000-4000-8000-000000000001')$q$,'PN404','no se entrega fragmento de preparación');
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_upload_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('b',64))$q$,'PN409','no se degrada nota nueva al resguardo manual');
select pg_temp.expect_error($q$select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',pg_temp.header('40000000-0000-4000-8000-000000000001'),repeat('a',64),'[]')$q$,'PN422','no publica sin todos los sobres');
select pg_temp.expect_error($q$select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',pg_temp.header('40000000-0000-4000-8000-000000000001'),repeat('a',64),jsonb_set(pg_temp.envelopes('40000000-0000-4000-8000-000000000001'),'{1,context,share_index}','1'))$q$,'PN422','sobre con índice repetido no se publica');
select pg_temp.expect_error($q$select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',pg_temp.header('40000000-0000-4000-8000-000000000001'),repeat('a',64),jsonb_set(pg_temp.envelopes('40000000-0000-4000-8000-000000000001'),'{0,context,recipient_id}','"10000000-0000-4000-8000-000000000001"'))$q$,'PN422','sobre de otro destinatario no se publica');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.stc_group_note_shares),'fallos revierten sobres parciales');
set local role service_role;
select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',pg_temp.header('40000000-0000-4000-8000-000000000001'),repeat('a',64),pg_temp.envelopes('40000000-0000-4000-8000-000000000001'));
select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',pg_temp.header('40000000-0000-4000-8000-000000000001'),repeat('a',64),pg_temp.envelopes('40000000-0000-4000-8000-000000000001'));
select pg_temp.assert_true(not public.server_cancel_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',true),'respuesta perdida no cancela nota publicada');
reset role;
select pg_temp.assert_true((select count(*)=3 from public.stc_group_note_shares),'un sobre por participante original');
select pg_temp.assert_true((select state='ready' and ready_at is not null from public.stc_group_notes),'publicación con fecha y sobres completos');
select pg_temp.assert_true((select count(*)=1 from public.stc_group_note_audit where action='shares_distributed'),'reintento idéntico no duplica distribución ni auditoría');
select pg_temp.assert_true((select count(*)=0 from stc_private.group_note_receipts),'nota individual no crea recibo manual');
-- Retiro concurrente entre reserva y publicación: todo se revierte.
set local role service_role;
select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',1,'Interrumpida','nota.txt','text/plain',12);
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
select public.retire_encryption_key('50000000-0000-4000-8000-000000000004');
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',pg_temp.header('40000000-0000-4000-8000-000000000002'),repeat('a',64),pg_temp.envelopes('40000000-0000-4000-8000-000000000002'))$q$,'PN409','retiro concurrente de clave impide publicar');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.stc_group_note_shares where note_id='40000000-0000-4000-8000-000000000002'),'retiro concurrente no deja sobres parciales');
set local role service_role;
select pg_temp.assert_true(public.server_cancel_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',true),'preparación fallida puede cancelarse');
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000014','Rotación',repeat('C',392),repeat('c',64));
select public.server_activate_encryption_key('10000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000014');
select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001',1,'Nueva clave','nota.txt','text/plain',12);
reset role;
select pg_temp.assert_true((select encryption_key_id='50000000-0000-4000-8000-000000000014' from public.stc_group_note_participants where note_id='40000000-0000-4000-8000-000000000003' and profile_id='10000000-0000-4000-8000-000000000004'),'nota nueva utiliza la nueva clave activa');
set local role service_role;
select public.server_cancel_group_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003',true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((select count(*)=1 from public.stc_group_note_shares),'creador solo consulta su sobre por RLS');
select pg_temp.assert_true(public.get_own_note_share('40000000-0000-4000-8000-000000000001')#>>'{context,share_index}'='1','emisor recibe solamente índice 1');
select pg_temp.assert_true(not (public.get_group_note('40000000-0000-4000-8000-000000000001') ? 'envelopes'),'detalle no incluye sobres de los demás');
select pg_temp.expect_error('delete from public.stc_group_note_shares','42501','usuario no borra fragmentos');
select pg_temp.expect_error($q$update public.stc_group_note_shares set envelope='{}'$q$,'42501','usuario no sustituye fragmentos');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=1 from public.stc_group_note_shares),'integrante consulta exactamente un sobre');
select pg_temp.assert_true(public.get_own_note_share('40000000-0000-4000-8000-000000000001')#>>'{context,share_index}'='2','integrante recibe solo índice 2');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=0 from public.stc_group_note_shares),'admin ajeno no obtiene sobres por tabla');
select pg_temp.expect_error($q$select public.get_own_note_share('40000000-0000-4000-8000-000000000001')$q$,'PN404','admin ajeno no obtiene sobres por RPC');
select public.set_stc_group_member('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','member',1);
select public.remove_stc_group_member('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',2);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_error($q$select public.get_own_note_share('40000000-0000-4000-8000-000000000001')$q$,'PN404','nuevo integrante no hereda fragmentos anteriores');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(public.get_own_note_share('40000000-0000-4000-8000-000000000001')#>>'{context,recipient_id}'='10000000-0000-4000-8000-000000000003','retirado del grupo conserva asignación original');
select public.retire_encryption_key('50000000-0000-4000-8000-000000000003');
select pg_temp.assert_true(public.get_own_note_share('40000000-0000-4000-8000-000000000001')#>>'{context,key_id}'='50000000-0000-4000-8000-000000000003','retiro no cambia ni oculta fragmento anterior');
reset role;set local role service_role;
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000013','Nueva',repeat('B',392),repeat('a',64));
select public.server_activate_encryption_key('10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000013');
select pg_temp.expect_error($q$select public.server_activate_encryption_key('10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003')$q$,'PK409','clave retirada no se reactiva');
reset role;
select pg_temp.assert_true((select encryption_key_id='50000000-0000-4000-8000-000000000003' from public.stc_group_note_participants where note_id='40000000-0000-4000-8000-000000000001' and profile_id='10000000-0000-4000-8000-000000000003'),'rotación conserva clave histórica de la nota');
select pg_temp.assert_true((select count(*)=1 from public.stc_encryption_keys where profile_id='10000000-0000-4000-8000-000000000003' and state='active'),'solo una clave activa por perfil');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000003','Integrante','member',false);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.get_own_note_share('40000000-0000-4000-8000-000000000001')$q$,'PN404','perfil inactivo no obtiene fragmento');
select pg_temp.assert_true((select count(*)=0 from public.stc_group_note_shares),'RLS también bloquea perfil desactivado');
reset role;
select pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_name='stc_encryption_keys' and column_name in ('private_key','private_base64','password')),'ninguna privada o contraseña persistida');
select pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_name='stc_group_note_shares' and column_name in ('share','y','aes_key')),'ningún fragmento en claro persistido');
-- Evita preparaciones ilimitadas; retirar una pendiente no borra su historial.
set local role service_role;
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000021','Pendiente 1',repeat('A',392),repeat('d',64));
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000022','Pendiente 2',repeat('A',392),repeat('e',64));
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000023','Pendiente 3',repeat('A',392),repeat('f',64));
select pg_temp.expect_error($q$select public.server_register_encryption_key('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000024','Pendiente 4',repeat('A',392),repeat('9',64))$q$,'PK409','máximo de tres preparaciones pendientes');
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.retire_encryption_key('50000000-0000-4000-8000-000000000021');
reset role;set local role service_role;
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000024','Pendiente 4',repeat('A',392),repeat('9',64));
reset role;
select pg_temp.assert_true((select state='retired' from public.stc_encryption_keys where id='50000000-0000-4000-8000-000000000021'),'retiro de pendiente conserva registro');
select pg_temp.assert_true((select count(*)=3 from public.stc_encryption_keys where profile_id='10000000-0000-4000-8000-000000000001' and state='pending'),'retirar pendiente permite preparar reemplazo');
rollback;
