-- STC: organización de grupos. Requiere 20261016000000_access_control.sql.
-- Las escrituras pasan por RPC y usan la identidad del JWT, también sin FastAPI.
begin;

insert into public.permissions(code, description) values
    ('groups.read', 'Consultar grupos a los que pertenece el perfil'),
    ('groups.manage', 'Crear, archivar y organizar grupos; no concede acceso a documentos');
insert into public.role_permissions(role_code, permission_code)
select code, 'groups.read' from public.roles;
insert into public.role_permissions values ('admin', 'groups.manage');

create table public.stc_groups (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text not null default '',
    is_active boolean not null default true,
    version integer not null default 1 check (version > 0),
    created_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint stc_groups_name_valid check (
        name = btrim(name) and length(name) between 1 and 100 and name !~ '[[:cntrl:]]'
    ),
    constraint stc_groups_description_valid check (
        description = btrim(description) and length(description) <= 500
        and description !~ '[[:cntrl:]]'
    )
);
create table public.stc_group_members (
    group_id uuid not null references public.stc_groups(id),
    profile_id uuid not null references public.profiles(id),
    group_role text not null check (group_role in ('manager', 'member')),
    joined_at timestamptz not null default now(),
    removed_at timestamptz,
    primary key (group_id, profile_id)
);
create index stc_group_members_profile_idx on public.stc_group_members(profile_id, group_id)
    where removed_at is null;
create index stc_groups_updated_idx on public.stc_groups(updated_at desc, id);
create table public.stc_group_audit (
    id bigint generated always as identity primary key,
    group_id uuid not null references public.stc_groups(id),
    actor_profile_id uuid not null references public.profiles(id),
    action text not null check (action in ('created', 'updated', 'member_set', 'member_removed')),
    details jsonb not null,
    created_at timestamptz not null default now()
);
create index stc_group_audit_group_idx on public.stc_group_audit(group_id, created_at desc);

create function stc_private.current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
    select id from public.profiles where auth_user_id = (select auth.uid()) and is_active;
$$;
create function stc_private.can_view_group(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select stc_private.has_permission('groups.read') and (
        stc_private.has_permission('groups.manage') or exists (
            select 1 from public.stc_group_members m
            where m.group_id = p_group_id and m.profile_id = stc_private.current_profile_id()
              and m.removed_at is null
        )
    );
$$;
create function stc_private.can_manage_group(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select stc_private.has_permission('groups.read') and exists (
        select 1 from public.stc_groups g where g.id = p_group_id and g.is_active and (
            stc_private.has_permission('groups.manage') or exists (
                select 1 from public.stc_group_members m
                where m.group_id = g.id and m.profile_id = stc_private.current_profile_id()
                  and m.group_role = 'manager' and m.removed_at is null
            )
        )
    );
$$;
create function stc_private.group_summary(p_group_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'id', g.id, 'name', g.name, 'description', g.description,
        'is_active', g.is_active, 'version', g.version,
        'created_at', g.created_at, 'updated_at', g.updated_at,
        'member_count', (select count(*) from public.stc_group_members m
            where m.group_id = g.id and m.removed_at is null),
        'active_member_count', (select count(*) from public.stc_group_members m
            join public.profiles p on p.id = m.profile_id
            where m.group_id = g.id and m.removed_at is null and p.is_active),
        'my_role', (select m.group_role from public.stc_group_members m
            where m.group_id = g.id and m.profile_id = stc_private.current_profile_id()
              and m.removed_at is null),
        'can_manage', stc_private.can_manage_group(g.id),
        'can_archive', stc_private.has_permission('groups.manage')
    ) from public.stc_groups g where g.id = p_group_id
      and stc_private.can_view_group(g.id);
$$;

-- Mismo lock que update_profile: una baja de perfil no compite con asignaciones.
-- El lock de fila y expected_version evitan sobrescribir ediciones concurrentes.
create function stc_private.lock_group(p_group_id uuid, p_expected_version integer)
returns public.stc_groups language plpgsql security definer set search_path = '' as $$
declare target public.stc_groups%rowtype;
begin
    perform pg_advisory_xact_lock(20261016, 1);
    select * into target from public.stc_groups where id = p_group_id for update;
    if not found or not stc_private.can_view_group(p_group_id) then
        raise exception 'Grupo no disponible.' using errcode = 'PT404';
    end if;
    if not stc_private.has_permission('groups.manage')
       and not stc_private.can_manage_group(p_group_id) then
        raise exception 'Sin permiso sobre el grupo.' using errcode = 'PT403';
    end if;
    if p_expected_version is null or target.version <> p_expected_version then
        raise exception 'El grupo cambió.' using errcode = 'PT409';
    end if;
    return target;
end;
$$;
create function stc_private.check_group_members(p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare amount bigint;
begin
    select count(*) into amount from public.stc_group_members
    where group_id = p_group_id and removed_at is null;
    if amount not between 2 and 255 or not exists (
        select 1 from public.stc_group_members m join public.profiles p on p.id = m.profile_id
        where m.group_id = p_group_id and m.removed_at is null
          and m.group_role = 'manager' and p.is_active
    ) then
        raise exception 'Se requieren 2 a 255 integrantes y un responsable activo.' using errcode = 'PT422';
    end if;
end;
$$;
create function stc_private.group_input_valid(p_name text, p_description text)
returns boolean language sql immutable set search_path = '' as $$
    select coalesce(length(btrim(p_name)) between 1 and 100
        and p_name !~ '[[:cntrl:]]' and p_description is not null
        and length(btrim(p_description)) <= 500 and p_description !~ '[[:cntrl:]]', false);
$$;

create function public.list_stc_groups(
    p_search text default '', p_state text default 'active',
    p_limit integer default 20, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
    if not stc_private.has_permission('groups.read') then
        raise exception 'Sin acceso a grupos.' using errcode = 'PT403';
    end if;
    if p_search is null or length(p_search) > 80 or p_state is null
       or p_state not in ('all','active','archived') or p_limit is null
       or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
        raise exception 'Consulta inválida.' using errcode = 'PT422';
    end if;
    with visible as (
        select g.* from public.stc_groups g where stc_private.can_view_group(g.id)
          and (p_state = 'all' or g.is_active = (p_state = 'active'))
          and position(lower(btrim(p_search)) in lower(g.name)) > 0
    ), page as (select * from visible order by updated_at desc, id limit p_limit offset p_offset)
    select jsonb_build_object('items', coalesce((select jsonb_agg(stc_private.group_summary(id)
        order by updated_at desc, id) from page), '[]'::jsonb),
        'total', (select count(*) from visible), 'limit', p_limit, 'offset', p_offset) into result;
    return result;
end;
$$;
create function public.get_stc_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare summary jsonb;
begin
    summary := stc_private.group_summary(p_group_id);
    if summary is null then raise exception 'Grupo no disponible.' using errcode = 'PT404'; end if;
    return jsonb_build_object('group', summary, 'members', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'email', p.email,
            'role_code', p.role_code, 'is_active', p.is_active,
            'is_linked', p.auth_user_id is not null, 'group_role', m.group_role, 'joined_at', m.joined_at
        ) order by m.group_role, lower(p.display_name), p.id)
        from public.stc_group_members m join public.profiles p on p.id = m.profile_id
        where m.group_id = p_group_id and m.removed_at is null
    ), '[]'::jsonb));
end;
$$;
create function public.list_group_candidates(
    p_group_id uuid default null, p_search text default '',
    p_limit integer default 20, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    if not stc_private.has_permission('groups.read') or
       (p_group_id is null and not stc_private.has_permission('groups.manage')) or
       (p_group_id is not null and not stc_private.can_manage_group(p_group_id)) then
        raise exception 'Sin permiso para consultar candidatos.' using errcode = 'PT403';
    end if;
    if p_search is null or length(p_search) > 80 or p_limit is null or p_limit not between 1 and 100
       or p_offset is null or p_offset not between 0 and 100000 then
        raise exception 'Consulta inválida.' using errcode = 'PT422';
    end if;
    return (with eligible as (
        select p.* from public.profiles p where p.is_active
          and (position(lower(btrim(p_search)) in lower(p.display_name)) > 0
               or position(lower(btrim(p_search)) in lower(p.email)) > 0)
          and not exists (select 1 from public.stc_group_members m
              where m.group_id = p_group_id and m.profile_id = p.id and m.removed_at is null)
    ), page as (select * from eligible order by lower(display_name), id limit p_limit offset p_offset)
    select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'display_name', display_name, 'email', email, 'role_code', role_code,
        'is_active', is_active, 'is_linked', auth_user_id is not null
    ) order by lower(display_name), id) from page), '[]'::jsonb),
    'total', (select count(*) from eligible), 'limit', p_limit, 'offset', p_offset));
end;
$$;
create function public.create_stc_group(p_name text, p_description text, p_members jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group_id uuid; member jsonb; v_profile_id uuid;
begin
    perform pg_advisory_xact_lock(20261016, 1);
    if not stc_private.has_permission('groups.manage') then
        raise exception 'Sin permiso para crear grupos.' using errcode = 'PT403';
    end if;
    if not stc_private.group_input_valid(p_name, p_description)
       or p_members is null or jsonb_typeof(p_members) <> 'array' then
        raise exception 'Datos inválidos.' using errcode = 'PT422';
    end if;
    if jsonb_array_length(p_members) not between 2 and 255 then
        raise exception 'Cantidad inválida.' using errcode = 'PT422';
    end if;
    insert into public.stc_groups(name, description, created_by)
        values (btrim(p_name), btrim(p_description), stc_private.current_profile_id()) returning id into v_group_id;
    for member in select value from jsonb_array_elements(p_members) loop
        if jsonb_typeof(member) is distinct from 'object'
           or jsonb_typeof(member->'profile_id') is distinct from 'string'
           or member->>'group_role' is null or member->>'group_role' not in ('manager','member')
           or (select count(*) from jsonb_object_keys(member)) <> 2 then
            raise exception 'Integrante inválido.' using errcode = 'PT422';
        end if;
        begin v_profile_id := (member->>'profile_id')::uuid;
        exception when invalid_text_representation then
            raise exception 'Identificador inválido.' using errcode = 'PT422';
        end;
        if not exists (select 1 from public.profiles p where p.id = v_profile_id and p.is_active)
           or exists (select 1 from public.stc_group_members m where m.group_id = v_group_id and m.profile_id = v_profile_id) then
            raise exception 'Perfil inactivo, inexistente o duplicado.' using errcode = 'PT422';
        end if;
        insert into public.stc_group_members(group_id, profile_id, group_role)
            values (v_group_id, v_profile_id, member->>'group_role');
    end loop;
    perform stc_private.check_group_members(v_group_id);
    insert into public.stc_group_audit(group_id, actor_profile_id, action, details)
    values (v_group_id, stc_private.current_profile_id(), 'created',
        jsonb_build_object('name', btrim(p_name), 'description', btrim(p_description), 'members', p_members));
    return v_group_id;
end;
$$;
create function public.update_stc_group(
    p_group_id uuid, p_name text, p_description text, p_is_active boolean, p_expected_version integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.stc_groups%rowtype;
begin
    target := stc_private.lock_group(p_group_id, p_expected_version);
    if not stc_private.group_input_valid(p_name, p_description) or p_is_active is null then
        raise exception 'Datos inválidos.' using errcode = 'PT422';
    end if;
    if p_is_active <> target.is_active and not stc_private.has_permission('groups.manage') then
        raise exception 'Solo la administración puede archivar o reactivar.' using errcode = 'PT403';
    end if;
    if p_is_active and not target.is_active then perform stc_private.check_group_members(p_group_id); end if;
    update public.stc_groups set name = btrim(p_name), description = btrim(p_description),
        is_active = p_is_active, version = version + 1, updated_at = statement_timestamp() where id = p_group_id;
    insert into public.stc_group_audit(group_id, actor_profile_id, action, details)
    values (p_group_id, stc_private.current_profile_id(), 'updated', jsonb_build_object(
        'old', to_jsonb(target), 'name', btrim(p_name), 'description', btrim(p_description), 'is_active', p_is_active));
end;
$$;
create function public.set_stc_group_member(
    p_group_id uuid, p_profile_id uuid, p_group_role text, p_expected_version integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.stc_groups%rowtype; previous jsonb;
begin
    target := stc_private.lock_group(p_group_id, p_expected_version);
    if not target.is_active then raise exception 'Grupo archivado.' using errcode = 'PT403'; end if;
    if p_group_role is null or p_group_role not in ('manager','member') or not exists (
        select 1 from public.profiles where id = p_profile_id and is_active
    ) then raise exception 'Perfil o rol inválido.' using errcode = 'PT422'; end if;
    select to_jsonb(m) into previous from public.stc_group_members m
        where m.group_id = p_group_id and m.profile_id = p_profile_id;
    insert into public.stc_group_members(group_id, profile_id, group_role)
    values (p_group_id, p_profile_id, p_group_role)
    on conflict (group_id, profile_id) do update set group_role = excluded.group_role,
        joined_at = case when public.stc_group_members.removed_at is not null
            then statement_timestamp() else public.stc_group_members.joined_at end, removed_at = null;
    perform stc_private.check_group_members(p_group_id);
    update public.stc_groups set version = version + 1, updated_at = statement_timestamp() where id = p_group_id;
    insert into public.stc_group_audit(group_id, actor_profile_id, action, details)
    values (p_group_id, stc_private.current_profile_id(), 'member_set', jsonb_build_object(
        'profile_id', p_profile_id, 'group_role', p_group_role, 'old', previous));
end;
$$;
create function public.remove_stc_group_member(p_group_id uuid, p_profile_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.stc_groups%rowtype; previous jsonb;
begin
    target := stc_private.lock_group(p_group_id, p_expected_version);
    if not target.is_active then raise exception 'Grupo archivado.' using errcode = 'PT403'; end if;
    select to_jsonb(m) into previous from public.stc_group_members m
        where m.group_id = p_group_id and m.profile_id = p_profile_id and m.removed_at is null;
    if previous is null then raise exception 'Integrante no disponible.' using errcode = 'PT404'; end if;
    update public.stc_group_members set removed_at = statement_timestamp()
        where group_id = p_group_id and profile_id = p_profile_id;
    perform stc_private.check_group_members(p_group_id);
    update public.stc_groups set version = version + 1, updated_at = statement_timestamp() where id = p_group_id;
    insert into public.stc_group_audit(group_id, actor_profile_id, action, details)
    values (p_group_id, stc_private.current_profile_id(), 'member_removed', previous);
end;
$$;

alter table public.stc_groups enable row level security;
alter table public.stc_group_members enable row level security;
alter table public.stc_group_audit enable row level security;
revoke all on public.stc_groups, public.stc_group_members, public.stc_group_audit
    from public, anon, authenticated, service_role;
revoke all on sequence public.stc_group_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.stc_groups, public.stc_group_members, public.stc_group_audit to authenticated;
create policy stc_groups_read on public.stc_groups for select to authenticated
    using (stc_private.can_view_group(id));
create policy stc_group_members_read on public.stc_group_members for select to authenticated
    using (removed_at is null and stc_private.can_view_group(group_id));
create policy stc_group_audit_read on public.stc_group_audit for select to authenticated using (
    stc_private.has_permission('groups.manage') or stc_private.can_manage_group(group_id)
);

revoke all on function stc_private.current_profile_id(), stc_private.can_view_group(uuid),
    stc_private.can_manage_group(uuid), stc_private.group_summary(uuid),
    stc_private.lock_group(uuid, integer), stc_private.check_group_members(uuid),
    stc_private.group_input_valid(text, text)
    from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function stc_private.can_view_group(uuid), stc_private.can_manage_group(uuid)
    to authenticated;
revoke all on function public.list_stc_groups(text, text, integer, integer), public.get_stc_group(uuid),
    public.list_group_candidates(uuid, text, integer, integer), public.create_stc_group(text, text, jsonb),
    public.update_stc_group(uuid, text, text, boolean, integer),
    public.set_stc_group_member(uuid, uuid, text, integer), public.remove_stc_group_member(uuid, uuid, integer)
    from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.list_stc_groups(text, text, integer, integer), public.get_stc_group(uuid),
    public.list_group_candidates(uuid, text, integer, integer), public.create_stc_group(text, text, jsonb),
    public.update_stc_group(uuid, text, text, boolean, integer),
    public.set_stc_group_member(uuid, uuid, text, integer), public.remove_stc_group_member(uuid, uuid, integer)
    to authenticated;

comment on table public.stc_groups is 'Organización y metadatos. No concede acceso a documentos ni fragmentos.';
comment on table public.stc_group_members is 'Membresía actual; los documentos futuros deben congelar sus participantes propios.';
comment on table public.stc_group_audit is 'Historial de cambios de organización, sin claves ni fragmentos.';
notify pgrst, 'reload schema';
commit;
