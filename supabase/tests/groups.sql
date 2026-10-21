-- Solo en una BD aislada VACÍA con ambas migraciones aplicadas. No es configuración.
-- Fixtures y comprobaciones se revierten por completo al finalizar.
begin;
do $$ begin
    if exists (select 1 from public.profiles) or exists (select 1 from public.stc_groups) then
        raise exception 'Ejecuta estas pruebas en una BD aislada sin datos reales.';
    end if;
end; $$;
create temporary table group_test_ids(id uuid);
create function pg_temp.assert_true(condition boolean, label text)
returns text language plpgsql as $$ begin
    if condition is distinct from true then raise exception 'FAIL: %', label; end if;
    return 'ok - ' || label;
end; $$;
create function pg_temp.expect_error(statement text, expected_code text, label text)
returns text language plpgsql as $$ declare actual_code text; begin
    begin execute statement;
    exception when others then
        get stacked diagnostics actual_code = returned_sqlstate;
        if actual_code <> expected_code then
            raise exception 'FAIL: % (SQLSTATE %, se esperaba %)', label, actual_code, expected_code;
        end if;
        return 'ok - ' || label;
    end;
    raise exception 'FAIL: % (no se rechazó la operación)', label;
end; $$;
do $$ begin
    execute format('grant usage on schema %I to anon, authenticated', pg_my_temp_schema()::regnamespace::text);
end; $$;
grant select, insert on group_test_ids to authenticated;
insert into public.profiles(id,email,display_name,role_code,is_active) values
    ('10000000-0000-4000-8000-000000000001','admin@groups.test','Admin','admin',true),
    ('10000000-0000-4000-8000-000000000002','manager@groups.test','Responsable','staff',true),
    ('10000000-0000-4000-8000-000000000003','member@groups.test','Integrante','member',true),
    ('10000000-0000-4000-8000-000000000004','other@groups.test','Ajeno','ambassador',true),
    ('10000000-0000-4000-8000-000000000005','disabled@groups.test','Inactivo','member',false),
    ('10000000-0000-4000-8000-000000000006','pending@groups.test','Pendiente','member',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at) values
    ('20000000-0000-4000-8000-000000000001','admin@groups.test','{"provider":"google"}','{}',now()),
    ('20000000-0000-4000-8000-000000000002','manager@groups.test','{"provider":"google"}','{}',now()),
    ('20000000-0000-4000-8000-000000000003','member@groups.test','{"provider":"google"}','{}',now()),
    ('20000000-0000-4000-8000-000000000004','other@groups.test','{"provider":"google"}',
        '{"role_code":"admin","permissions":["groups.manage"]}',now());
select pg_temp.assert_true((select count(*) = 3 from pg_tables where schemaname='public'
    and tablename in ('stc_groups','stc_group_members','stc_group_audit') and rowsecurity), 'RLS en tres tablas');
select pg_temp.assert_true(not has_function_privilege('authenticated',
    'stc_private.lock_group(uuid,integer)','EXECUTE'), 'lock privado no invocable');
set local role anon;
select pg_temp.expect_error('select * from public.stc_groups','42501','anónimo sin tablas');
select pg_temp.expect_error('select public.list_stc_groups()','42501','anónimo sin RPC');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.current_access()->'permissions' ? 'groups.manage','admin recibe capacidad general');
select pg_temp.assert_true((public.list_group_candidates()->>'total')::int = 5,'candidatos solo activos, incluye pendientes');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[
    {"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"manager"}]')$q$,
    'PT422','grupo requiere al menos dos');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[
    {"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"member"},
    {"profile_id":"10000000-0000-4000-8000-000000000003","group_role":"member"}]')$q$,
    'PT422','grupo requiere responsable');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[
    {"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"manager"},
    {"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"member"}]')$q$,
    'PT422','sin duplicados');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[
    {"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"manager"},
    {"profile_id":"10000000-0000-4000-8000-000000000005","group_role":"member"}]')$q$,
    'PT422','sin perfiles inactivos');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[1,2]')$q$,
    'PT422','JSON inválido rechazado');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[
    {"profile_id":"incorrecto","group_role":"manager"},
    {"profile_id":"10000000-0000-4000-8000-000000000003","group_role":"member"}]')$q$,
    'PT422','UUID inválido rechazado');
select pg_temp.assert_true((public.list_stc_groups()->>'total')::int=0,'fallos de creación no dejan grupos parciales');
insert into group_test_ids select public.create_stc_group('Comité de prueba','Coordinación', '[
    {"profile_id":"10000000-0000-4000-8000-000000000002","group_role":"manager"},
    {"profile_id":"10000000-0000-4000-8000-000000000003","group_role":"member"}]');
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,member_count}')::int=2,'dos integrantes');
select pg_temp.assert_true(public.get_stc_group((select id from group_test_ids))#>'{group,my_role}' = 'null'::jsonb,'admin no se incorpora automáticamente');
select pg_temp.assert_true((select count(*)=2 from public.stc_group_members),'sin membresía implícita');
select pg_temp.expect_error($q$insert into public.stc_groups(name,created_by) values ('Ilegal','10000000-0000-4000-8000-000000000001')$q$,
    '42501','admin no puede escribir directamente');
select pg_temp.expect_error('delete from public.stc_group_members','42501','sin delete directo');
select pg_temp.expect_error('update public.stc_group_members set group_role=''manager''','42501','sin escalación directa');
select pg_temp.expect_error('delete from public.stc_group_audit','42501','auditoría no editable');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
select pg_temp.assert_true((public.list_stc_groups()->>'total')::int=0,'ajeno sin grupos');
select pg_temp.assert_true((select count(*)=0 from public.stc_groups),'RLS bloquea metadatos ajenos');
select pg_temp.assert_true((select count(*)=0 from public.stc_group_members),'RLS bloquea integrantes ajenos');
select pg_temp.assert_true((select count(*)=0 from public.stc_group_audit),'RLS bloquea auditoría ajena');
select pg_temp.expect_error('select public.get_stc_group((select id from group_test_ids))','PT404','ajeno no enumera detalle');
select pg_temp.expect_error('select public.list_group_candidates()','PT403','ajeno no obtiene directorio');
select pg_temp.expect_error($q$select public.create_stc_group('X','', '[]')$q$,'PT403','metadatos de usuario no dan permisos');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((public.list_stc_groups()->>'total')::int=1,'integrante consulta su grupo');
select pg_temp.assert_true(not (public.get_stc_group((select id from group_test_ids))#>>'{group,can_manage}')::boolean,'integrante sin gestión');
select pg_temp.expect_error('select public.list_group_candidates((select id from group_test_ids))','PT403','integrante sin directorio');
select pg_temp.expect_error($q$select public.set_stc_group_member((select id from group_test_ids),
    '10000000-0000-4000-8000-000000000003','manager',1)$q$,'PT403','integrante no se promueve');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((select count(*)=1 from public.profiles),'responsable no obtiene acceso a toda tabla profiles');
select pg_temp.assert_true((public.list_group_candidates((select id from group_test_ids))->>'total')::int=3,'responsable consulta candidatos sin integrantes actuales');
select pg_temp.expect_error($q$select public.set_stc_group_member((select id from group_test_ids),
    '10000000-0000-4000-8000-000000000002','member',1)$q$,'PT422','no se pierde último responsable activo');
select pg_temp.expect_error($q$select public.remove_stc_group_member((select id from group_test_ids),
    '10000000-0000-4000-8000-000000000003',1)$q$,'PT422','grupo no queda con uno');
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,version}')::int=1,'rechazos revierten versión e integrantes');
select public.set_stc_group_member((select id from group_test_ids),'10000000-0000-4000-8000-000000000004','member',1);
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,version}')::int=2,'cambio incrementa versión');
select pg_temp.expect_error($q$select public.set_stc_group_member((select id from group_test_ids),
    '10000000-0000-4000-8000-000000000006','member',1)$q$,'PT409','edición obsoleta rechazada');
select public.update_stc_group((select id from group_test_ids),'Comité actualizado','Propósito',true,2);
select pg_temp.expect_error($q$select public.update_stc_group((select id from group_test_ids),'X','',false,3)$q$,
    'PT403','responsable no archiva sin permiso general');
select public.remove_stc_group_member((select id from group_test_ids),'10000000-0000-4000-8000-000000000004',3);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
select pg_temp.assert_true((public.list_stc_groups()->>'total')::int=0,'baja retira acceso inmediatamente con mismo JWT');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=4 from public.stc_group_audit),'auditoría solo de operaciones confirmadas');
select public.set_stc_group_member((select id from group_test_ids),'10000000-0000-4000-8000-000000000004','member',4);
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,member_count}')::int=3,'reincorporación sin duplicar');
select public.update_stc_group((select id from group_test_ids),'Comité actualizado','Propósito',false,5);
select pg_temp.assert_true((public.list_stc_groups()->>'total')::int=0,'archivo desaparece de activos');
select pg_temp.assert_true((public.list_stc_groups('','archived')->>'total')::int=1,'archivo conserva grupo');
select pg_temp.expect_error($q$select public.set_stc_group_member((select id from group_test_ids),
    '10000000-0000-4000-8000-000000000006','member',6)$q$,'PT403','archivo bloquea gestión de integrantes');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.list_stc_groups('','archived')->>'total')::int=1,'integrante consulta archivo propio');
select pg_temp.expect_error($q$select public.update_stc_group((select id from group_test_ids),'X','',true,6)$q$,
    'PT403','responsable no reactiva archivo');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_stc_group((select id from group_test_ids),'Comité actualizado','Propósito',true,6);
select public.update_profile('10000000-0000-4000-8000-000000000003','Integrante','member',false);
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,active_member_count}')::int=2,'baja de perfil no borra membresía');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.stc_groups),'perfil desactivado sin acceso RLS');
select pg_temp.expect_error('select public.list_stc_groups()','PT403','perfil desactivado sin RPC');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.update_profile('10000000-0000-4000-8000-000000000002','Responsable','staff',false);
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,member_count}')::int=3,'baja del responsable conserva historial');
select public.set_stc_group_member((select id from group_test_ids),'10000000-0000-4000-8000-000000000004','manager',7);
select pg_temp.assert_true((public.get_stc_group((select id from group_test_ids))#>>'{group,version}')::int=8,'admin repara grupo sin responsable activo');
select pg_temp.assert_true((public.list_stc_groups('%')->>'total')::int=0,'búsqueda literal no interpreta comodines');
select pg_temp.assert_true((public.list_stc_groups('','all',20,20)->>'total')::int=1,'paginación conserva total');
select pg_temp.expect_error('select public.list_stc_groups(null)','PT422','sin parámetros nulos');
select pg_temp.expect_error('select public.list_stc_groups('''',''all'',101,0)','PT422','límite máximo');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.stc_group_members where removed_at is null
    and group_role='manager' and profile_id='10000000-0000-4000-8000-000000000004'),'gestión no cambia rol general');
select pg_temp.assert_true((select role_code='ambassador' from public.profiles
    where id='10000000-0000-4000-8000-000000000004'),'rol general conservado');
rollback;
