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
 ('10000000-0000-4000-8000-000000000001','admin@diplomatic.test','Administrador ajeno','admin'),
 ('10000000-0000-4000-8000-000000000002','owner@diplomatic.test','Creador','staff'),
 ('10000000-0000-4000-8000-000000000003','recipient@diplomatic.test','Destinatario','member'),
 ('10000000-0000-4000-8000-000000000004','no-key@diplomatic.test','Sin clave','member'),
 ('10000000-0000-4000-8000-000000000005','unlinked@diplomatic.test','Sin vincular','member');
insert into auth.users(id,email,raw_app_meta_data)
 select replace(id::text,'10000000','20000000')::uuid,email,'{"provider":"google"}'
 from public.profiles where id<>'10000000-0000-4000-8000-000000000005';
select public.server_register_signing_key('10000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','Firma',repeat('C',392),repeat('c',64));
select public.server_register_signing_key('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','Firma ajena',repeat('D',392),repeat('d',64));
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','Protección',repeat('A',392),repeat('a',64));
select public.server_register_encryption_key('10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003','Protección',repeat('B',392),repeat('b',64));
select public.server_activate_encryption_key(profile_id,id) from public.stc_encryption_keys;
create function pg_temp.file_id(n integer) returns uuid language sql immutable as $$
 select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.version_id(n integer) returns uuid language sql immutable as $$
 select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.reserve(n integer,recipients jsonb default '[{"profile_id":"10000000-0000-4000-8000-000000000003"}]')
returns jsonb language sql as $$
 select public.server_begin_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(n),pg_temp.version_id(n),
 'Nota de prueba','nota.txt','text/plain',12,recipients,'diplomatic_note','70000000-0000-4000-8000-000000000002'); $$;
-- Material sintético para contratos SQL. El cifrado real se prueba con Python.
create function pg_temp.header(n integer) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('format','stc-diplomatic-note','format_version',1,'algorithm','A256GCM+RSA-OAEP-256+RSA-PSS-256',
 'kind',f.kind,'signing_key_id',f.signing_key_id,'signing_fingerprint',(select fingerprint from public.stc_signing_keys where id=f.signing_key_id),
 'document_id',f.id,'version_id',f.version_id,'created_by',f.created_by,'title',f.title,
 'filename',f.filename,'media_type',f.media_type,'size',f.size,'envelopes',(
 select jsonb_agg(jsonb_build_object('profile_id',r.profile_id,'key_id',r.key_id,'fingerprint',k.fingerprint,
 'wrapped_key_base64',repeat('A',342)||'==') order by r.profile_id)
 from public.stc_diplomatic_note_recipients r join public.stc_encryption_keys k on k.id=r.key_id where r.document_id=f.id))
 from public.stc_diplomatic_notes f where f.id=pg_temp.file_id(n); $$;
create function pg_temp.publish(n integer,header jsonb default null) returns void language sql as $$
 select public.server_commit_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(n),pg_temp.version_id(n),
 coalesce(header,pg_temp.header(n)),repeat('A',16),repeat('A',22)||'==',repeat('a',64),repeat('A',342)||'=='); $$;

select pg_temp.assert_true((select count(*)=4 from pg_tables where (schemaname='public' and tablename in
 ('stc_diplomatic_notes','stc_diplomatic_note_recipients','stc_diplomatic_note_audit') or schemaname='stc_private' and tablename='diplomatic_note_material') and rowsecurity),'RLS en cuatro tablas nuevas');
select pg_temp.assert_true(not has_table_privilege('service_role','stc_private.diplomatic_note_material','SELECT'),'material privado sin lectura directa de service_role');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.server_diplomatic_note_material(uuid,uuid)','EXECUTE'),'material solo por RPC de servidor');
set local role anon;
select pg_temp.expect_error('select public.list_diplomatic_notes()','42501','anónimo sin RPC');
select pg_temp.expect_error('select * from public.stc_diplomatic_notes','42501','anónimo sin tablas');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error('select pg_temp.reserve(1)','42501','JWT no reserva ni elige un actor por canal servidor');
select pg_temp.expect_error('select * from stc_private.diplomatic_note_material','42501','JWT no obtiene sobres por tabla');
select pg_temp.expect_error('select stc_private.diplomatic_note_detail(pg_temp.file_id(1))','42501','JWT no ejecuta helper sin autorización');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_begin_diplomatic_note('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),'Nota','file','text/plain',0,'[]','diplomatic_note','70000000-0000-4000-8000-000000000002')$q$,'DN403','miembro no crea notas');
select pg_temp.expect_error('select pg_temp.reserve(1,''[]'')','DN422','exige destinatario');
select pg_temp.expect_error('select pg_temp.reserve(1,''{}'')','DN422','rechaza forma JSON distinta');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"invalido"}]')$q$,'DN422','UUID inválido produce error de contrato');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000003","key_id":"libre"}]')$q$,'DN422','cliente no asigna claves');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000003"},{"profile_id":"10000000-0000-4000-8000-000000000003"}]')$q$,'DN422','destinatarios distintos');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000005"}]')$q$,'DN422','perfil no vinculado no recibe');
select pg_temp.expect_error($q$select pg_temp.reserve(1,'[{"profile_id":"10000000-0000-4000-8000-000000000004"}]')$q$,'DN428','sin clave activa no se reserva');
select pg_temp.reserve(1);
select pg_temp.expect_error('select pg_temp.reserve(1)','DN409','identificadores no se reutilizan');
reset role;
select pg_temp.assert_true((select count(*)=2 from public.stc_diplomatic_note_recipients),'creador y destinatario incluidos una sola vez');
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_note_audit),'fallos no dejan reservas parciales');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.get_diplomatic_note(pg_temp.file_id(1))#>>'{file,state}'='staging','creador ve preparación');
select pg_temp.assert_true(not (public.get_diplomatic_note(pg_temp.file_id(1)) ? 'header'),'detalle no expone sobres');
select pg_temp.expect_error('update public.stc_diplomatic_notes set state=''ready''','42501','sin escritura directa a estados');
select pg_temp.expect_error('delete from public.stc_diplomatic_note_recipients','42501','sin cambio de destinatarios desde cliente');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_diplomatic_notes()->>'total')::int=0,'destinatario no ve preparación');
select pg_temp.expect_error('select public.get_diplomatic_note(pg_temp.file_id(1))','DN404','UUID no abre carga pendiente');
reset role; set local role service_role;
select pg_temp.expect_error('select pg_temp.publish(1,''{}'')','DN422','cabecera incompleta no publica');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{title}','"Alterado"'))$q$,'DN422','metadatos no sustituyen reserva');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes}','[]'))$q$,'DN422','faltan sobres');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes,0,key_id}','"60000000-0000-4000-8000-000000000003"'))$q$,'DN422','clave ajena no sustituye snapshot');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes,0,wrapped_key_base64}','"invalido"'))$q$,'DN422','sobre Base64 inválido');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes,0,wrapped_key_base64}',to_jsonb(repeat('!',344))))$q$,'DN422','caracteres Base64 inválidos se rechazan de forma controlada');
select pg_temp.expect_error($q$select public.server_commit_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(1),pg_temp.version_id(1),pg_temp.header(1),repeat('A',16),repeat('A',21)||'B==',repeat('a',64),repeat('A',342)||'==')$q$,'DN422','padding no canónico del tag rechazado');
select pg_temp.expect_error($q$select pg_temp.publish(1,pg_temp.header(1)||'{"extra":"no permitido"}')$q$,'DN422','campos extra de cabecera rechazados');
select pg_temp.expect_error($q$select pg_temp.publish(1,jsonb_set(pg_temp.header(1),'{envelopes}',jsonb_build_array(pg_temp.header(1)#>'{envelopes,1}',pg_temp.header(1)#>'{envelopes,0}')))$q$,'DN422','orden de sobres debe coincidir con AAD canónica');
select pg_temp.publish(1);
select pg_temp.publish(1);
select pg_temp.assert_true(not public.server_cancel_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(1),pg_temp.version_id(1)),'respuesta perdida no cancela archivo publicado');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_note_audit where action='published'),'publicación idéntica no duplica auditoría');
select pg_temp.assert_true((select count(*)=1 from stc_private.diplomatic_note_material),'un material privado completo');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_diplomatic_notes()->>'total')::int=1,'destinatario ve nota lista');
select pg_temp.assert_true((public.list_diplomatic_notes('zzzz')->>'total')::int=0,'filtro por título');
select pg_temp.expect_error('select public.list_diplomatic_notes('''',''all'',0,0)','DN422','límites inválidos');
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_notes),'RLS permite asignado');
select pg_temp.assert_true((select count(*)=2 from public.stc_diplomatic_note_recipients),'lista de destinatarios autorizada sin sobres');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=0 from public.stc_diplomatic_notes),'administrador ajeno no ve notas');
select pg_temp.assert_true((select count(*)=0 from public.stc_diplomatic_note_recipients),'administrador ajeno no ve asignaciones');
select pg_temp.expect_error('select public.get_diplomatic_note(pg_temp.file_id(1))','DN404','administrador ajeno sin detalle');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_diplomatic_note_material('10000000-0000-4000-8000-000000000001',pg_temp.file_id(1))$q$,'DN404','canal servidor también rechaza actor ajeno');
select pg_temp.assert_true(public.server_diplomatic_note_material('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1))#>>'{header,format}'='stc-diplomatic-note','material accesible solo al autorizado');
select public.server_complete_diplomatic_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),repeat('a',64));
select pg_temp.expect_error($q$select public.server_complete_diplomatic_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(2),repeat('a',64))$q$,'DN409','revalida versión antes de entregar');
select pg_temp.reserve(2);
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.retire_encryption_key('60000000-0000-4000-8000-000000000003');
reset role; set local role service_role;
select pg_temp.expect_error('select pg_temp.publish(2)','DN409','retiro durante carga bloquea publicación');
select pg_temp.assert_true(public.server_cancel_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(2),pg_temp.version_id(2)),'cancela reserva fallida');
select pg_temp.assert_true(public.server_cancel_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(2),pg_temp.version_id(2)),'repetir limpieza de cancelada es seguro');
select pg_temp.assert_true(public.server_diplomatic_note_material('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1)) is not null,'retirada conserva apertura histórica');
select pg_temp.publish(1);
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_note_audit where action='cancelled'),'cancelación idempotente');
select pg_temp.assert_true((select count(*)=1 from stc_private.diplomatic_note_material),'cancelada nunca obtuvo material');
update public.profiles set is_active=false where id='10000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.stc_diplomatic_notes),'baja bloquea RLS inmediatamente');
select pg_temp.expect_error('select public.list_diplomatic_notes()','DN403','perfil inactivo no lista');
reset role; set local role service_role;
select pg_temp.expect_error($q$select public.server_complete_diplomatic_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(1),pg_temp.version_id(1),repeat('a',64))$q$,'DN404','baja durante descifrado impide entrega final');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_note_audit where action='downloaded'),'descargas rechazadas no crean auditoría de entrega');
select pg_temp.assert_true(not exists(select 1 from information_schema.columns
 where table_name in ('stc_diplomatic_notes','stc_diplomatic_note_recipients','diplomatic_note_material')
 and column_name in ('aes_key','password','private_base64','plaintext')),'sin campos para secretos en claro');

-- Casos específicos del vínculo entre firma, tipo y versión.
update public.profiles set is_active=true where id='10000000-0000-4000-8000-000000000003';
update public.stc_encryption_keys set state='active',retired_at=null where id='60000000-0000-4000-8000-000000000003';
create function pg_temp.reserve_signed(n integer,kind text default 'diplomatic_note',signer uuid default '70000000-0000-4000-8000-000000000002')
returns jsonb language sql as $$
 select public.server_begin_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(n),pg_temp.version_id(n),
 'Nota de prueba','nota.txt','text/plain',12,'[{"profile_id":"10000000-0000-4000-8000-000000000003"}]',kind,signer); $$;
set local role service_role;
select pg_temp.expect_error($q$select pg_temp.reserve_signed(3,'especial')$q$,'DN422','tipo especial no entra al flujo individual');
select pg_temp.expect_error($q$select pg_temp.reserve_signed(3,'diplomatic_note','70000000-0000-4000-8000-000000000001')$q$,'DN428','firma ajena no sustituye al emisor');
select pg_temp.expect_error($q$select pg_temp.reserve_signed(3,'diplomatic_note','70000000-0000-4000-8000-000000000099')$q$,'DN428','clave inexistente no crea nota');
select pg_temp.reserve_signed(3,'communique');
select pg_temp.expect_error($q$select pg_temp.publish(3,jsonb_set(pg_temp.header(3),'{kind}','"diplomatic_note"'))$q$,'DN422','tipo firmado coincide con reserva');
select pg_temp.expect_error($q$select pg_temp.publish(3,jsonb_set(pg_temp.header(3),'{signing_key_id}','"70000000-0000-4000-8000-000000000001"'))$q$,'DN422','clave de firma coincide con reserva');
select pg_temp.expect_error($q$select pg_temp.publish(3,jsonb_set(pg_temp.header(3),'{signing_fingerprint}',to_jsonb(repeat('d',64))))$q$,'DN422','huella del emisor no se sustituye');
select pg_temp.expect_error($q$select public.server_commit_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(3),pg_temp.version_id(3),pg_temp.header(3),repeat('A',16),repeat('A',22)||'==',repeat('a',64),'')$q$,'DN422','nota sin firma no se publica');
select pg_temp.expect_error($q$select public.server_commit_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(3),pg_temp.version_id(3),pg_temp.header(3),repeat('A',16),repeat('A',22)||'==',repeat('a',64),repeat('A',341)||'B==')$q$,'DN422','firma Base64 no canónica rechazada');
select pg_temp.publish(3);
select pg_temp.expect_error($q$select public.server_commit_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(3),pg_temp.version_id(3),pg_temp.header(3),repeat('A',16),repeat('A',22)||'==',repeat('a',64),repeat('B',342)||'==')$q$,'DN409','firma publicada no se reemplaza');
select pg_temp.expect_error($q$select public.server_complete_diplomatic_download('10000000-0000-4000-8000-000000000003',pg_temp.file_id(3),pg_temp.version_id(3),repeat('b',64))$q$,'DN409','digest cambiado bloquea entrega final');
select pg_temp.reserve(4,'[{"profile_id":"10000000-0000-4000-8000-000000000002"}]');
select pg_temp.publish(4);
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_note_recipients where document_id=pg_temp.file_id(4)),'emisor seleccionado una sola vez');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_diplomatic_notes('','communique')->>'total')::int=1,'filtra comunicado');
select pg_temp.assert_true((public.list_diplomatic_notes('','diplomatic_note')->>'total')::int=1,'filtra nota y excluye archivo ajeno');
select pg_temp.assert_true((public.list_diplomatic_notes('','all',1,1)->>'total')::int=2 and jsonb_array_length(public.list_diplomatic_notes('','all',1,1)->'items')=1,'paginación conserva total autorizado');
select pg_temp.expect_error($q$select public.list_diplomatic_notes('','especial')$q$,'DN422','consulta rechaza tipo ajeno');
select pg_temp.assert_true(not (public.get_diplomatic_note(pg_temp.file_id(3)) ? 'signature_base64'),'detalle público sin firma privada');
select pg_temp.assert_true(public.get_diplomatic_note(pg_temp.file_id(3))#>>'{signer,profile_id}'='10000000-0000-4000-8000-000000000002','detalle identifica emisor original');
select pg_temp.expect_error('select stc_private.diplomatic_signing_key(''70000000-0000-4000-8000-000000000001'')','42501','JWT no consulta snapshot ajeno de firma');
reset role;
-- La publicación y el material comparten transacción aun si falla auditoría.
select pg_temp.reserve(5);
create function pg_temp.block_diplomatic_publication() returns trigger language plpgsql as $$ begin
 if new.action='published' and new.document_id=pg_temp.file_id(5) then raise exception 'Fallo de auditoría de prueba.'; end if; return new; end; $$;
create trigger test_block_publication before insert on public.stc_diplomatic_note_audit for each row execute function pg_temp.block_diplomatic_publication();
set local role service_role;
select pg_temp.expect_error('select pg_temp.publish(5)','P0001','fallo de auditoría revierte publicación');
reset role;
select pg_temp.assert_true((select state='staging' from public.stc_diplomatic_notes where id=pg_temp.file_id(5)),'fallo conserva preparación');
select pg_temp.assert_true(not exists(select 1 from stc_private.diplomatic_note_material where document_id=pg_temp.file_id(5)),'fallo no deja material parcial');
drop trigger test_block_publication on public.stc_diplomatic_note_audit;
select pg_temp.publish(5);
select pg_temp.reserve(6);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select public.retire_signing_key('70000000-0000-4000-8000-000000000002');
reset role; set local role service_role;
select pg_temp.expect_error('select pg_temp.publish(6)','DN409','retiro de firma durante carga bloquea publicación');
select pg_temp.expect_error('select pg_temp.reserve_signed(7)','DN428','firma retirada no crea notas nuevas');
select pg_temp.assert_true(public.server_diplomatic_note_material('10000000-0000-4000-8000-000000000003',pg_temp.file_id(3))#>>'{signing_key,is_active}'='false','verificación histórica conserva pública retirada');
select pg_temp.publish(3);
select pg_temp.assert_true(public.server_cancel_diplomatic_note('10000000-0000-4000-8000-000000000002',pg_temp.file_id(6),pg_temp.version_id(6)),'cancela preparación con firma retirada');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_diplomatic_note_audit where document_id=pg_temp.file_id(3) and action='published'),'reintento histórico conserva una publicación');
select pg_temp.assert_true(not exists(select 1 from public.stc_documents) and not exists(select 1 from public.stc_personnel_files),'notas no crean copias en catálogo ni expedientes');

rollback;
