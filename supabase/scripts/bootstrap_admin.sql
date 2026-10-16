-- Ejecutar con postgres desde SQL Editor, después de la migración.
-- Sustituir SOLO los dos valores siguientes antes de ejecutar.
begin;
do $$
declare
    admin_email text := 'TU_CORREO_GOOGLE';
    admin_name text := 'TU_NOMBRE';
    existing_user uuid;
begin
    admin_email := lower(btrim(admin_email));
    admin_name := btrim(admin_name);
    if admin_email = 'tu_correo_google' or admin_name = 'TU_NOMBRE'
       or admin_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'Sustituye TU_CORREO_GOOGLE y TU_NOMBRE antes de ejecutar.';
    end if;
    perform pg_advisory_xact_lock(20261016, 1);
    if exists (select 1 from public.profiles where role_code = 'admin') then
        raise exception 'Ya existe un administrador. Gestiona las siguientes altas con authorize_profile.';
    end if;
    if exists (select 1 from public.profiles where email = admin_email) then
        raise exception 'Ese perfil ya existe. Revisa su estado antes de asignar privilegios.';
    end if;
    select id into existing_user from auth.users
    where lower(btrim(email)) = admin_email and raw_app_meta_data ->> 'provider' = 'google';
    if existing_user is null and exists (
        select 1 from auth.users where lower(btrim(email)) = admin_email
    ) then
        raise exception 'El correo ya existe en Auth con otro proveedor; revisa la identidad antes de continuar.';
    end if;
    insert into public.profiles(email, display_name, role_code, auth_user_id)
    values (admin_email, admin_name, 'admin', existing_user);
end;
$$;
commit;

select email, display_name, role_code, is_active,
    case when auth_user_id is null then 'pendiente de primer login' else 'vinculado' end as state
from public.profiles where role_code = 'admin';
