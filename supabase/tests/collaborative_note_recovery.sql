-- SOLO BD de pruebas vacía con las siete migraciones. Todo se revierte.
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
select pg_temp.assert_true((select count(*)=3 from pg_tables where schemaname='public' and tablename in ('stc_note_recoveries','stc_note_recovery_participants','stc_note_recovery_audit') and rowsecurity),'RLS en metadatos de recuperación');
select pg_temp.assert_true((select rowsecurity from pg_tables where schemaname='stc_private' and tablename='note_recovery_contributions'),'RLS también en aportaciones privadas');
select pg_temp.assert_true(not has_table_privilege('service_role','stc_private.note_recovery_contributions','SELECT'),'service_role no consulta material por tabla');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_note_recovery_material(uuid,uuid)','EXECUTE'),'JWT no obtiene todas las aportaciones');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_contribute_note_recovery(uuid,uuid,jsonb)','EXECUTE'),'JWT no declara fragmentos válidos');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_complete_note_recovery(uuid,uuid,integer)','EXECUTE'),'JWT no declara descifrado exitoso');
select pg_temp.assert_true((select count(*)=1 from pg_publication_tables where pubname='supabase_realtime' and tablename='stc_note_recoveries'),'Realtime publica metadatos autorizados');
select pg_temp.assert_true(not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='note_recovery_contributions'),'Realtime nunca publica aportaciones cifradas');
set local role anon;
select pg_temp.expect_error($q$select public.list_note_recoveries('40000000-0000-4000-8000-000000000001')$q$,'42501','anónimo no lista solicitudes');
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Consultar acuerdo',60)$q$,'PR404','administrador ajeno no solicita recuperación');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Consultar acuerdo',0)$q$,'PR422','plazo inválido rechazado');
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Consultar acuerdo',60);
select pg_temp.assert_true(public.get_note_recovery('60000000-0000-4000-8000-000000000001')#>>'{recovery,contribution_count}'='0','solicitante no aporta automáticamente');
select pg_temp.assert_true((public.get_note_recovery('60000000-0000-4000-8000-000000000001')#>>'{recovery,can_contribute}')::boolean,'rol integrante puede aportar');
select pg_temp.assert_true(not (public.get_note_recovery('60000000-0000-4000-8000-000000000001')#>>'{recovery,can_recover}')::boolean,'no descarga antes de reunir a todos');
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Consultar acuerdo',60);
select pg_temp.assert_true((public.list_note_recoveries('40000000-0000-4000-8000-000000000001')->>'total')::int=1,'reintento de creación idempotente');
select pg_temp.expect_error($q$select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','Otra solicitud',60)$q$,'PR409','una sola solicitud abierta por nota');
select pg_temp.expect_error('select * from stc_private.note_recovery_contributions','42501','ni solicitante lee las aportaciones por tabla');
select pg_temp.expect_error($q$update public.stc_note_recoveries set state='ready'$q$,'42501','cliente no cambia estado');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.get_note_recovery('60000000-0000-4000-8000-000000000001')$q$,'PR404','UUID conocido no permite abrir solicitud ajena');
select pg_temp.assert_true((select count(*)=0 from public.stc_note_recoveries),'RLS oculta solicitudes a administrador ajeno');
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_note_recovery_material('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001')$q$,'PR410','backend tampoco recupera sin umbral');
select pg_temp.expect_error($q$select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','{}')$q$,'PR404','actor ajeno no aporta por canal servidor');
select pg_temp.expect_error($q$select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',jsonb_set(pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),'{context,request_id}','"60000000-0000-4000-8000-000000000099"'))$q$,'PR422','fragmento ligado a otra solicitud rechazado');
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'));
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'));
reset role;
select pg_temp.assert_true((select contribution_count=1 from public.stc_note_recoveries),'aportación repetida no cuenta dos veces');
select pg_temp.assert_true((select count(*)=1 from stc_private.note_recovery_contributions),'aportación repetida no duplica material');
select pg_temp.assert_true((select count(*)=1 from public.stc_note_recovery_audit where action='contributed'),'una auditoría por aportación efectiva');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.close_note_recovery('60000000-0000-4000-8000-000000000001','cancelled')$q$,'PR403','solo solicitante cancela');
select pg_temp.assert_true(not (public.get_note_recovery('60000000-0000-4000-8000-000000000001')#>>'{recovery,can_contribute}')::boolean,'UI informa aportación ya realizada');
reset role;set local role service_role;
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'));
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'));
select pg_temp.expect_error($q$select public.server_note_recovery_material('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001')$q$,'PR403','aportante no es destinatario del resultado');
select pg_temp.assert_true(jsonb_array_length(public.server_note_recovery_material('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001')->'envelopes')=3,'solo backend autorizado obtiene los tres sobres');
select pg_temp.expect_error($q$select public.server_complete_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',1)$q$,'PR409','versión obsoleta no completa');
select public.server_complete_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',4);
select public.server_complete_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',4);
reset role;
select pg_temp.assert_true((select state='completed' and download_until=completed_at+interval '10 minutes' from public.stc_note_recoveries),'completa con ventana fija de diez minutos');
select pg_temp.assert_true((select count(*)=1 from public.stc_note_recovery_audit where action='completed'),'reintento no duplica conclusión ni renueva plazo');
set local role service_role;
select pg_temp.assert_true(jsonb_array_length(public.server_note_recovery_material('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001')->'envelopes')=3,'reintento de descarga tiene material dentro del plazo');
reset role;
update public.stc_note_recoveries set download_until=statement_timestamp()-interval '1 second' where id='60000000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.expect_error($q$select public.server_note_recovery_material('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001')$q$,'PR410','no descarga tras ventana de reintento');
select public.server_cleanup_note_recoveries();
reset role;
select pg_temp.assert_true((select count(*)=0 from stc_private.note_recovery_contributions),'limpieza elimina material de descarga vencida');
select pg_temp.assert_true((select state='completed' and contribution_count=3 from public.stc_note_recoveries),'limpieza conserva historial sin secretos');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','Consultar de nuevo',60);
reset role;set local role service_role;
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',pg_temp.contribution('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'));
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
select public.close_note_recovery('60000000-0000-4000-8000-000000000002','rejected');
reset role;
select pg_temp.assert_true((select state='rejected' from public.stc_note_recoveries where id='60000000-0000-4000-8000-000000000002'),'cualquier participante original puede rechazar');
select pg_temp.assert_true((select count(*)=0 from stc_private.note_recovery_contributions),'rechazo elimina aportaciones inmediatamente');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','Cancelar prueba',60);
select public.close_note_recovery('60000000-0000-4000-8000-000000000003','cancelled');
select pg_temp.assert_true(public.get_note_recovery('60000000-0000-4000-8000-000000000003')#>>'{recovery,state}'='cancelled','solicitante cancela su solicitud');
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004','Vencimiento prueba',1);
reset role;set local role service_role;
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000004',pg_temp.contribution('60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002'));
reset role;
update public.stc_note_recoveries set expires_at=statement_timestamp()-interval '1 second' where id='60000000-0000-4000-8000-000000000004';
set local role service_role;
select pg_temp.expect_error($q$select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000004',pg_temp.contribution('60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003'))$q$,'PR410','vence aunque aún no haya corrido limpieza');
select public.server_cleanup_note_recoveries();
reset role;
select pg_temp.assert_true((select state='expired' from public.stc_note_recoveries where id='60000000-0000-4000-8000-000000000004'),'limpieza registra vencimiento');
select pg_temp.assert_true((select count(*)=0 from stc_private.note_recovery_contributions),'limpieza borra aportaciones vencidas');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005','Prueba de baja',60);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000004','Responsable','ambassador',false);
reset role;set local role service_role;
select pg_temp.expect_error($q$select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000005',pg_temp.contribution('60000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002'))$q$,'PR412','baja bloquea recuperación sin reducir n');
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_error($q$select public.get_note_recovery('60000000-0000-4000-8000-000000000005')$q$,'PR404','perfil desactivado no ve solicitud');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000004','Responsable','ambassador',true);
select public.set_stc_group_member('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','member',1);
select public.remove_stc_group_member('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',2);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_error($q$select public.get_note_recovery('60000000-0000-4000-8000-000000000005')$q$,'PR404','nuevo integrante no hereda recuperación histórica');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(public.get_note_recovery('60000000-0000-4000-8000-000000000005')#>>'{recovery,participant_count}'='3','participante original conserva solicitud al salir del grupo');
reset role;
select pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_name='stc_note_recoveries' and column_name in ('private_key','password','aes_key','plaintext')),'solicitudes no contienen secretos');
select pg_temp.assert_true((select count(*)=3 from public.stc_group_note_shares),'cierres y limpieza conservan sobres originales');
rollback;
