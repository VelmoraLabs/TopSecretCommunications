-- Solo lectura. Ejecutar desde SQL Editor con el rol postgres.
select code, name from public.roles order by code;

select r.code as role_code, array_agg(rp.permission_code order by rp.permission_code) as permissions
from public.roles r join public.role_permissions rp on rp.role_code = r.code
group by r.code order by r.code;

select tablename, rowsecurity as rls_enabled from pg_tables
where schemaname = 'public' and tablename in (
    'roles', 'permissions', 'role_permissions', 'profiles', 'access_audit'
) order by tablename;

select email, display_name, role_code, is_active,
    case when auth_user_id is null then 'pendiente de primer login' else 'vinculado' end as state
from public.profiles order by created_at;

select has_table_privilege('anon', 'public.profiles', 'SELECT') as anon_can_read_profiles,
    has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as client_can_update_profiles,
    has_function_privilege('anon', 'public.authorize_profile(text,text,text)', 'EXECUTE')
        as anon_can_authorize,
    has_function_privilege('supabase_auth_admin', 'public.stc_before_user_created(jsonb)', 'EXECUTE')
        as auth_can_call_hook;

select tgname, tgenabled from pg_trigger
where tgrelid = 'auth.users'::regclass and tgname = 'stc_auth_user_created';

-- La selección del hook en el Dashboard NO se registra en estas tablas.
-- Comprobar también Authentication > Auth Hooks > Before User Created.
