-- SOLO BD de pruebas vacía con las ocho migraciones. Todo se revierte.
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

delete from public.stc_notifications;
select pg_temp.assert_true((select rowsecurity from pg_tables where schemaname='public' and tablename='stc_notifications'),'RLS de notificaciones');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.stc_notifications','INSERT'),'cliente no fabrica avisos');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.stc_notifications','UPDATE'),'cliente no altera destinatario o contenido');
select pg_temp.assert_true(not has_function_privilege('authenticated','stc_private.notify_profile(uuid,text,text,uuid,uuid,text)','EXECUTE'),'emisión es privada');
select pg_temp.assert_true(not has_function_privilege('service_role','stc_private.notify_profile(uuid,text,text,uuid,uuid,text)','EXECUTE'),'no hay API de emisión arbitraria');
select pg_temp.assert_true(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='stc_notifications'),'bandeja publicada en Realtime');
set local role anon;
select pg_temp.expect_error('select public.list_stc_notifications()','42501','anónimo sin RPC de bandeja');
select pg_temp.expect_error('select * from public.stc_notifications','42501','anónimo sin lectura directa');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.create_stc_group('Inválido','', '[{"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"member"},{"profile_id":"10000000-0000-4000-8000-000000000003","group_role":"member"}]')$q$,'PT422','fallo de grupo revierte el evento');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.stc_notifications),'sin avisos de una operación fallida');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.create_stc_group('Equipo notificado','', '[{"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"manager"},{"profile_id":"10000000-0000-4000-8000-000000000003","group_role":"member"},{"profile_id":"10000000-0000-4000-8000-000000000004","group_role":"member"}]');
reset role;
select pg_temp.assert_true((select count(*)=3 from public.stc_notifications where event_type='group_added'),'alta notifica a cada integrante real');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where recipient_id='10000000-0000-4000-8000-000000000001'),'administrador ajeno no recibe avisos del grupo');
create temporary table notification_test_ids as select id as group_id from public.stc_groups where name='Equipo notificado';
grant select on notification_test_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.set_stc_group_member((select group_id from notification_test_ids),'10000000-0000-4000-8000-000000000003','manager',1);
select public.set_stc_group_member((select group_id from notification_test_ids),'10000000-0000-4000-8000-000000000003','manager',2);
select public.remove_stc_group_member((select group_id from notification_test_ids),'10000000-0000-4000-8000-000000000004',3);
select public.update_stc_group((select group_id from notification_test_ids),'Equipo notificado','',false,4);
select public.update_stc_group((select group_id from notification_test_ids),'Equipo notificado','',true,5);
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='group_role_changed'),'rol efectivo notifica una vez; mismo rol no genera ruido');
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='group_removed' and target_id is null),'baja informa sin enlace a grupo retirado');
select pg_temp.assert_true((select count(*)=2 from public.stc_notifications where event_type='group_archived'),'archivado notifica solo integrantes actuales');
select pg_temp.assert_true((select count(*)=2 from public.stc_notifications where event_type='group_reactivated'),'reactivación notifica integrantes');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_stc_notifications()->>'unread_count')::int=4,'contador propio exacto');
select pg_temp.assert_true((select count(*)=4 from public.stc_notifications),'RLS filtra bandeja propia');
select pg_temp.assert_true((public.list_stc_notifications('all','groups',1,0)->>'total')::int=4,'filtro y paginación conservan total');
select pg_temp.assert_true(jsonb_array_length(public.list_stc_notifications('all','groups',1,0)->'items')=1,'límite aplicado');
select pg_temp.assert_true(not ((public.list_stc_notifications()->'items'->0) ? 'source'),'no expone identificador interno de deduplicación por RPC');
select public.read_stc_notification((public.list_stc_notifications()->'items'->0->>'id')::uuid);
select pg_temp.assert_true((public.list_stc_notifications()->>'unread_count')::int=3,'leer reduce contador');
select public.read_stc_notification((public.list_stc_notifications()->'items'->0->>'id')::uuid);
select pg_temp.assert_true((public.list_stc_notifications()->>'unread_count')::int=3,'leer es idempotente');
select pg_temp.expect_error($q$select public.list_stc_notifications('invalid')$q$,'NT422','rechaza estado inválido');
select pg_temp.expect_error($q$select public.list_stc_notifications('all','invalid')$q$,'NT422','rechaza categoría inválida');
select pg_temp.expect_error($q$select public.list_stc_notifications('all','all',0)$q$,'NT422','rechaza límite inválido');
select pg_temp.expect_error($q$select public.read_stc_notification('99999999-0000-4000-8000-000000000001')$q$,'NT404','UUID inexistente no modifica otros avisos');
select pg_temp.expect_error($q$select public.read_all_stc_notifications(statement_timestamp()+interval '1 day')$q$,'NT422','no permite marcar avisos futuros');
select public.read_all_stc_notifications((public.list_stc_notifications()->>'snapshot_at')::timestamptz);
select pg_temp.assert_true((public.list_stc_notifications('unread')->>'total')::int=0,'marcar todas registra lectura');
reset role;
select pg_temp.assert_true(exists(select 1 from public.stc_notifications where recipient_id='10000000-0000-4000-8000-000000000002' and read_at is null),'marcar todas no afecta a otra cuenta');
create temporary table another_notification as select id from public.stc_notifications where recipient_id='10000000-0000-4000-8000-000000000002' limit 1;
grant select on another_notification to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((public.list_stc_notifications()->>'total')::int=0,'admin no ve bandejas ajenas');
select pg_temp.expect_error($q$select public.read_stc_notification((select id from another_notification))$q$,'NT404','admin no puede marcar aviso ajeno');
reset role;
-- Documentos: solo notificar cuando se confirma el evento de negocio.
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
select public.server_begin_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',1,'Segunda nota','nota.txt','text/plain',12);
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='note_shared'),'preparación no genera nota disponible');
select public.server_commit_distributed_note('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',pg_temp.header('40000000-0000-4000-8000-000000000002'),repeat('a',64),pg_temp.envelopes('40000000-0000-4000-8000-000000000002'));
select pg_temp.assert_true((select count(*)=3 from public.stc_notifications where event_type='note_shared'),'nota lista avisa al snapshot original');
-- Eventos de recuperación reales sobre el snapshot preparado arriba.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.create_note_recovery('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Revisar acuerdo',60);
select pg_temp.assert_true((select count(*)=3 from public.stc_notifications where event_type='recovery_requested'),'solicitud avisa a todos los participantes originales');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='recovery_requested' and recipient_id='10000000-0000-4000-8000-000000000001'),'solicitud no avisa al administrador ajeno');
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'));
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='recovery_ready'),'una aportación no anuncia recuperación lista');
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'));
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'));
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='recovery_ready' and recipient_id='10000000-0000-4000-8000-000000000003'),'n/n avisa exclusivamente al solicitante');
select public.server_contribute_note_recovery('10000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001',pg_temp.contribution('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'));
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='recovery_ready'),'reintento no duplica aviso');
select public.close_note_recovery('60000000-0000-4000-8000-000000000001','cancelled');
select pg_temp.assert_true((select count(*)=3 from public.stc_notifications where event_type='recovery_cancelled'),'cierre avisa a los participantes');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where body like '%Revisar acuerdo%' or body like '%0123456789abcdef%'),'avisos no contienen motivo ni material criptográfico');
select pg_temp.assert_true(not exists(select 1 from public.stc_notifications where event_type='contributed'),'no emite un aviso por cada cambio de contador');
-- Los avisos pertenecen a la cuenta incluso después de retirar acceso al grupo;
-- su texto genérico no revela contenido y sus enlaces vuelven a comprobar acceso.
update public.profiles set role_code='staff' where id='10000000-0000-4000-8000-000000000003';
select pg_temp.assert_true((select count(*)=1 from public.stc_notifications where event_type='profile_changed'),'cambio de rol notifica al afectado');
update public.profiles set is_active=false where id='10000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error('select public.list_stc_notifications()','NT403','perfil desactivado no consulta avisos');
select pg_temp.assert_true((select count(*)=0 from public.stc_notifications),'RLS también bloquea perfil desactivado');
reset role;
rollback;
