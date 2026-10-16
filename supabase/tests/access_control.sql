-- Pruebas de permisos para una BD de prueba VACÍA tras aplicar la migración.
-- No usar como configuración. Los fixtures y helpers se revierten al terminar.
begin;
do $$
begin
    if exists (select 1 from public.profiles) then
        raise exception 'Ejecuta estas pruebas en una BD aislada sin perfiles reales.';
    end if;
end;
$$;

create temporary table stc_test_marker(id integer);
create function pg_temp.assert_true(condition boolean, label text)
returns text language plpgsql as $$
begin
    if condition is distinct from true then raise exception 'FAIL: %', label; end if;
    return 'ok - ' || label;
end;
$$;
create function pg_temp.expect_error(statement text, expected_code text, label text)
returns text language plpgsql as $$
declare actual_code text;
begin
    begin
        execute statement;
    exception when others then
        get stacked diagnostics actual_code = returned_sqlstate;
        if actual_code <> expected_code then
            raise exception 'FAIL: % (SQLSTATE %, se esperaba %)', label, actual_code, expected_code;
        end if;
        return 'ok - ' || label;
    end;
    raise exception 'FAIL: % (no se rechazó la operación)', label;
end;
$$;
do $$
begin
    execute format('grant usage on schema %I to anon, authenticated, supabase_auth_admin',
        pg_my_temp_schema()::regnamespace::text);
end;
$$;

insert into public.profiles(email, display_name, role_code, is_active) values
    ('admin@example.test', 'STC TEST Admin', 'admin', true),
    ('staff@example.test', 'STC TEST Staff', 'staff', true),
    ('member@example.test', 'STC TEST Member', 'member', true),
    ('disabled@example.test', 'STC TEST Disabled', 'member', false),
    ('pending-admin@example.test', 'STC TEST Pending', 'admin', true),
    ('ambassador@example.test', 'STC TEST Ambassador', 'ambassador', true);

select pg_temp.assert_true((select count(*) = 4 from public.roles), 'cuatro roles');
select pg_temp.assert_true((select count(*) = 6 from public.permissions), 'seis permisos');
select pg_temp.assert_true((select count(*) = 17 from public.role_permissions), 'matriz de permisos');
select pg_temp.assert_true((select count(*) = 5 from pg_tables where schemaname = 'public'
    and tablename in ('roles','permissions','role_permissions','profiles','access_audit') and rowsecurity),
    'RLS en todas las tablas');
select pg_temp.assert_true(not has_function_privilege('authenticated',
    'stc_private.link_auth_user()', 'EXECUTE'), 'trigger no invocable por clientes');

set local role supabase_auth_admin;
select pg_temp.assert_true(public.stc_before_user_created(
    '{"user":{"email":" AMBASSADOR@EXAMPLE.TEST ","app_metadata":{"provider":"google"}}}'
) = '{}'::jsonb, 'hook permite Google autorizado y normaliza correo');
select pg_temp.assert_true(public.stc_before_user_created(
    '{"user":{"email":"unknown@example.test","app_metadata":{"provider":"google"}}}'
) #>> '{error,http_code}' = '403', 'hook bloquea desconocidos');
select pg_temp.assert_true(public.stc_before_user_created(
    '{"user":{"email":"disabled@example.test","app_metadata":{"provider":"google"}}}'
) #>> '{error,http_code}' = '403', 'hook bloquea desactivados');
select pg_temp.assert_true(public.stc_before_user_created(
    '{"user":{"email":"ambassador@example.test","app_metadata":{"provider":"email"}}}'
) #>> '{error,http_code}' = '403', 'hook bloquea proveedor distinto de Google');
select pg_temp.assert_true(public.stc_before_user_created('{}') #>> '{error,http_code}' = '403',
    'hook deniega datos incompletos');
select pg_temp.expect_error('select display_name from public.profiles', '42501',
    'Auth solo tiene lectura de las columnas necesarias');
reset role;

insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values
    ('11111111-1111-4111-8111-111111111111', 'admin@example.test', '{"provider":"google"}', '{}', now()),
    ('22222222-2222-4222-8222-222222222222', 'staff@example.test', '{"provider":"google"}',
        '{"role_code":"admin","permissions":["profiles.manage"]}', now()),
    ('33333333-3333-4333-8333-333333333333', 'member@example.test', '{"provider":"google"}', '{}', now());
select pg_temp.assert_true((select count(*) = 3 from public.profiles where auth_user_id is not null),
    'primer login vincula únicamente el perfil preautorizado');
select pg_temp.expect_error($q$insert into auth.users(id,email,raw_app_meta_data)
    values ('99999999-9999-4999-8999-999999999999','unknown@example.test','{"provider":"google"}')$q$,
    '42501', 'trigger bloquea desconocidos aunque no se haya configurado el hook');
select pg_temp.expect_error($q$insert into auth.users(id,email,raw_app_meta_data)
    values ('99999999-9999-4999-8999-999999999999','disabled@example.test','{"provider":"google"}')$q$,
    '42501', 'trigger bloquea desactivados');
select pg_temp.expect_error($q$insert into auth.users(id,email,raw_app_meta_data)
    values ('99999999-9999-4999-8999-999999999999','ambassador@example.test','{"provider":"email"}')$q$,
    '42501', 'trigger exige proveedor Google');

set local role supabase_auth_admin;
select pg_temp.assert_true(public.stc_before_user_created(
    '{"user":{"email":"admin@example.test","app_metadata":{"provider":"google"}}}'
) #>> '{error,http_code}' = '403', 'hook no permite reasignar un perfil vinculado');
reset role;

set local role anon;
select pg_temp.expect_error('select * from public.profiles', '42501', 'anónimo no lee perfiles');
select pg_temp.expect_error('select public.current_access()', '42501', 'anónimo no consulta sesión');
select pg_temp.expect_error($q$select public.authorize_profile('x@example.test','X','admin')$q$,
    '42501', 'anónimo no autoriza perfiles');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222", "role_code":"admin"}', true);
select pg_temp.assert_true((select count(*) = 1 from public.profiles), 'personal solo ve su perfil');
select pg_temp.assert_true(public.current_access() #>> '{profile,role_code}' = 'staff',
    'metadatos y claims de rol no elevan privilegios');
select pg_temp.assert_true(not (public.current_access() -> 'permissions' ? 'profiles.manage'),
    'permiso administrativo no se deriva del cliente');
select pg_temp.assert_true((select count(*) = 0 from public.access_audit), 'auditoría solo administrativa');
select pg_temp.assert_true((select count(*) = 4 from public.roles), 'usuario activo consulta catálogo');
select pg_temp.expect_error($q$update public.profiles set role_code='admin'$q$, '42501',
    'escritura directa de roles denegada');
select pg_temp.expect_error($q$select public.authorize_profile('x@example.test','X','admin')$q$,
    '42501', 'personal no da altas');
select pg_temp.expect_error($q$select public.update_profile(
    (select id from public.profiles), 'Staff','admin',true)$q$, '42501', 'personal no cambia su rol por RPC');
select pg_temp.expect_error($q$select public.stc_before_user_created('{}')$q$, '42501',
    'hook no expuesto a usuarios autenticados');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
select pg_temp.assert_true((select count(*) = 6 from public.profiles), 'admin ve perfiles pendientes y desactivados');
select pg_temp.assert_true(public.current_access() -> 'permissions' ? 'profiles.manage', 'admin tiene permiso de gestión');
select pg_temp.assert_true(public.authorize_profile(' NEW@EXAMPLE.TEST ', ' Nueva persona ', 'staff') is not null,
    'admin crea alta normalizada');
select pg_temp.expect_error($q$select public.authorize_profile('new@example.test','Duplicado','admin')$q$,
    '23505', 'alta duplicada no modifica el rol existente');
select pg_temp.expect_error($q$select public.authorize_profile('invalid','Inválido','staff')$q$,
    '23514', 'correo inválido rechazado');
select pg_temp.expect_error($q$select public.authorize_profile('bad-role@example.test','Rol','superadmin')$q$,
    '23503', 'rol inexistente rechazado');
select pg_temp.expect_error($q$select public.update_profile(
    (select id from public.profiles where email='admin@example.test'),'Admin','member',true)$q$,
    '23514', 'último admin vinculado no puede perder el rol aunque haya otro pendiente');
select pg_temp.expect_error($q$select public.update_profile(
    (select id from public.profiles where email='admin@example.test'),'Admin','admin',false)$q$,
    '23514', 'último admin vinculado no puede desactivarse');
select public.update_profile((select id from public.profiles where email='staff@example.test'),
    'STC TEST Staff', 'staff', false);
select pg_temp.assert_true((select count(*) > 0 from public.access_audit where action = 'updated'),
    'cambios de acceso auditados');
select pg_temp.expect_error('delete from public.access_audit', '42501', 'admin no borra auditoría por API');
select pg_temp.expect_error($q$insert into public.role_permissions values ('member','profiles.manage')$q$,
    '42501', 'catálogo de permisos no editable por clientes');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role_code":"admin"}', true);
select pg_temp.assert_true((select count(*) = 0 from public.profiles), 'perfil desactivado pierde lectura aun con JWT vigente');
select pg_temp.assert_true((select count(*) = 0 from public.roles), 'perfil desactivado pierde acceso al catálogo');
select pg_temp.expect_error('select public.current_access()', '42501', 'perfil desactivado pierde acceso a RPC');
select pg_temp.expect_error($q$select public.authorize_profile('x@example.test','X','admin')$q$,
    '42501', 'perfil desactivado no obtiene privilegios por claims');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
select pg_temp.assert_true((select count(*) = 0 from public.profiles), 'identidad sin perfil no ve datos');
select pg_temp.expect_error('select public.current_access()', '42501', 'identidad sin perfil no tiene acceso');
reset role;

-- Un segundo admin debe completar el primer login antes de sustituir al primero.
insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values
    ('55555555-5555-4555-8555-555555555555','pending-admin@example.test','{"provider":"google"}',now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
select public.update_profile((select id from public.profiles where email='admin@example.test'),
    'STC TEST Admin','member',true);
select pg_temp.assert_true(not (public.current_access() -> 'permissions' ? 'profiles.manage'),
    'cambio de rol tiene efecto sin renovar JWT');
select pg_temp.expect_error($q$select public.authorize_profile('x@example.test','X','admin')$q$,
    '42501', 'admin degradado pierde gestión inmediatamente');
reset role;

rollback;
