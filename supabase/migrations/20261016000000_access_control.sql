-- STC: perfiles autorizados, permisos y vinculación con Supabase Auth.
-- Ejecutar una sola vez, con el rol postgres, en el proyecto de STC.
begin;

create schema if not exists stc_private;
revoke all on schema stc_private from public, anon, authenticated;
grant usage on schema stc_private to authenticated;

create table public.roles (
    code text primary key,
    name text not null
);

create table public.permissions (
    code text primary key,
    description text not null
);

create table public.role_permissions (
    role_code text not null references public.roles(code),
    permission_code text not null references public.permissions(code),
    primary key (role_code, permission_code)
);

-- Un perfil pendiente ya representa un alta autorizada; no requiere contraseña.
create table public.profiles (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid unique references auth.users(id) on delete set null,
    email text not null unique,
    display_name text not null,
    role_code text not null references public.roles(code),
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profiles_email_valid check (
        email = lower(btrim(email)) and length(email) <= 254
        and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
    constraint profiles_name_valid check (
        display_name = btrim(display_name)
        and length(display_name) between 1 and 120
        and display_name !~ '[[:cntrl:]]'
    )
);

create table public.access_audit (
    id bigint generated always as identity primary key,
    profile_id uuid not null,
    actor_user_id uuid,
    action text not null check (action in ('authorized', 'updated', 'identity_linked')),
    old_values jsonb,
    new_values jsonb not null,
    created_at timestamptz not null default now()
);
create index access_audit_profile_created_idx
    on public.access_audit(profile_id, created_at desc);
create index profiles_role_active_idx on public.profiles(role_code, is_active);

insert into public.roles(code, name) values
    ('admin', 'Administrador'),
    ('ambassador', 'Embajador'),
    ('staff', 'Personal autorizado'),
    ('member', 'Miembro');

insert into public.permissions(code, description) values
    ('profiles.manage', 'Autorizar perfiles y modificar sus roles y estado'),
    ('documents.create', 'Crear documentos sujetos a su política de acceso'),
    ('documents.read_assigned', 'Consultar documentos asignados explícitamente'),
    ('documents.sign', 'Firmar documentos cuando el flujo lo permita'),
    ('recovery.request', 'Solicitar recuperación de notas de su grupo'),
    ('recovery.contribute', 'Aportar su fragmento a una sesión de su grupo');

insert into public.role_permissions(role_code, permission_code)
select r.code, p.code from public.roles r cross join public.permissions p
where p.code in ('documents.read_assigned', 'recovery.request', 'recovery.contribute');
insert into public.role_permissions(role_code, permission_code) values
    ('admin', 'profiles.manage'),
    ('admin', 'documents.create'),
    ('ambassador', 'documents.create'),
    ('ambassador', 'documents.sign'),
    ('staff', 'documents.create');

-- Helpers sin parámetros de identidad: siempre consultan al usuario del JWT.
create function stc_private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.profiles p
        where p.auth_user_id = (select auth.uid()) and p.is_active
    );
$$;

create function stc_private.has_permission(permission_code text)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.profiles p
        join public.role_permissions rp on rp.role_code = p.role_code
        where p.auth_user_id = (select auth.uid()) and p.is_active
          and rp.permission_code = $1
    );
$$;

create function stc_private.touch_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at := statement_timestamp();
    return new;
end;
$$;
create trigger profiles_touch before update on public.profiles
    for each row execute function stc_private.touch_profile();

create function stc_private.audit_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    previous jsonb;
    operation text := 'authorized';
begin
    if tg_op = 'UPDATE' then
        previous := to_jsonb(old);
        operation := case when old.auth_user_id is null and new.auth_user_id is not null
            then 'identity_linked' else 'updated' end;
    end if;
    insert into public.access_audit(profile_id, actor_user_id, action, old_values, new_values)
    values (new.id, auth.uid(), operation, previous, to_jsonb(new));
    return new;
end;
$$;
create trigger profiles_audit after insert or update on public.profiles
    for each row execute function stc_private.audit_profile();

-- El hook se registra después en Authentication > Auth Hooks.
-- SECURITY INVOKER: Auth recibe únicamente lectura de las columnas necesarias.
create function public.stc_before_user_created(event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
    if event -> 'user' -> 'app_metadata' ->> 'provider' = 'google'
       and exists (
           select 1 from public.profiles p
           where p.email = lower(btrim(event -> 'user' ->> 'email'))
             and p.is_active and p.auth_user_id is null
       ) then
        return '{}'::jsonb;
    end if;
    return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403,
        'message', 'Acceso no autorizado. Contacta al administrador.'
    ));
end;
$$;

-- También se comprueba al insertar: evita altas sin perfil si se omite el hook.
create function stc_private.link_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    profile_id uuid;
begin
    if new.raw_app_meta_data ->> 'provider' is distinct from 'google' then
        raise exception 'STC requiere autenticación con Google.' using errcode = '42501';
    end if;
    select p.id into profile_id from public.profiles p
    where p.email = lower(btrim(new.email))
      and p.is_active and p.auth_user_id is null
    for update;
    if profile_id is null then
        raise exception 'Acceso no autorizado. Contacta al administrador.'
            using errcode = '42501';
    end if;
    update public.profiles set auth_user_id = new.id where id = profile_id;
    return new;
end;
$$;
create trigger stc_auth_user_created after insert on auth.users
    for each row execute function stc_private.link_auth_user();

create function public.current_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    result jsonb;
begin
    select jsonb_build_object(
        'profile', jsonb_build_object('id', p.id, 'auth_user_id', p.auth_user_id,
            'email', p.email, 'display_name', p.display_name,
            'role_code', p.role_code, 'is_active', p.is_active),
        'permissions', coalesce((
            select jsonb_agg(rp.permission_code order by rp.permission_code)
            from public.role_permissions rp where rp.role_code = p.role_code
        ), '[]'::jsonb)
    ) into result from public.profiles p
    where p.auth_user_id = (select auth.uid()) and p.is_active;
    if result is null then
        raise exception 'El perfil no está autorizado o está desactivado.'
            using errcode = '42501';
    end if;
    return result;
end;
$$;

create function public.authorize_profile(
    p_email text, p_display_name text, p_role_code text default 'staff'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    profile_id uuid;
begin
    -- Compartido con update_profile: serializa cambios administrativos de acceso.
    perform pg_advisory_xact_lock(20261016, 1);
    if not stc_private.has_permission('profiles.manage') then
        raise exception 'No tienes permiso para administrar perfiles.' using errcode = '42501';
    end if;
    insert into public.profiles(email, display_name, role_code, created_by)
    values (lower(btrim(p_email)), btrim(p_display_name), p_role_code, auth.uid())
    returning id into profile_id;
    return profile_id;
end;
$$;

create function public.update_profile(
    p_profile_id uuid, p_display_name text, p_role_code text, p_is_active boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
    target public.profiles%rowtype;
begin
    perform pg_advisory_xact_lock(20261016, 1);
    if not stc_private.has_permission('profiles.manage') then
        raise exception 'No tienes permiso para administrar perfiles.' using errcode = '42501';
    end if;
    select * into target from public.profiles where id = p_profile_id for update;
    if not found then
        raise exception 'El perfil no existe.' using errcode = 'P0002';
    end if;
    if target.role_code = 'admin' and target.is_active and target.auth_user_id is not null
       and (p_role_code is distinct from 'admin' or p_is_active is distinct from true)
       and not exists (
           select 1 from public.profiles p where p.id <> target.id
             and p.role_code = 'admin' and p.is_active and p.auth_user_id is not null
       ) then
        raise exception 'Debe permanecer un administrador activo que ya haya iniciado sesión.'
            using errcode = '23514';
    end if;
    update public.profiles set display_name = btrim(p_display_name),
        role_code = p_role_code, is_active = p_is_active
    where id = target.id;
end;
$$;

-- Grants y RLS son necesarios incluso si la exposición automática está apagada.
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.access_audit enable row level security;

revoke all on public.roles, public.permissions, public.role_permissions,
    public.profiles, public.access_audit from public, anon, authenticated, service_role;
revoke all on sequence public.access_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.roles, public.permissions, public.role_permissions,
    public.profiles, public.access_audit to authenticated;

grant select (email, is_active, auth_user_id) on public.profiles to supabase_auth_admin;
create policy profiles_auth_hook on public.profiles for select
    to supabase_auth_admin using (true);
create policy roles_read on public.roles for select to authenticated
    using ((select stc_private.is_active_user()));
create policy permissions_read on public.permissions for select to authenticated
    using ((select stc_private.is_active_user()));
create policy role_permissions_read on public.role_permissions for select to authenticated
    using ((select stc_private.is_active_user()));
create policy profiles_read on public.profiles for select to authenticated using (
    (auth_user_id = (select auth.uid()) and is_active)
    or (select stc_private.has_permission('profiles.manage'))
);
create policy access_audit_read on public.access_audit for select to authenticated
    using ((select stc_private.has_permission('profiles.manage')));

-- Ningún cliente puede escribir directamente tablas ni cambiar el catálogo.
revoke all on function stc_private.is_active_user(), stc_private.has_permission(text),
    stc_private.touch_profile(), stc_private.audit_profile(), stc_private.link_auth_user()
    from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function stc_private.is_active_user(), stc_private.has_permission(text)
    to authenticated;
revoke all on function public.current_access(), public.authorize_profile(text, text, text),
    public.update_profile(uuid, text, text, boolean), public.stc_before_user_created(jsonb)
    from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.current_access(), public.authorize_profile(text, text, text),
    public.update_profile(uuid, text, text, boolean) to authenticated;
grant usage on schema public to authenticated, supabase_auth_admin;
grant execute on function public.stc_before_user_created(jsonb) to supabase_auth_admin;

comment on table public.profiles is
    'Altas previas y perfiles STC. auth_user_id se vincula al primer login Google autorizado.';
comment on function public.current_access() is
    'Consulta permisos actuales en BD; no confía en roles de user_metadata ni en claims antiguos.';
comment on table public.role_permissions is
    'Capacidades generales. No sustituyen la asignación de documentos ni la membresía del grupo.';

notify pgrst, 'reload schema';
commit;
