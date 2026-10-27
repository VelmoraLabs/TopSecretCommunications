-- Notas de grupo: snapshot inmutable, ciphertext privado y custodia portable explícita.
-- Requiere las cuatro migraciones anteriores. Ejecutar una vez como postgres.
begin;
create table public.stc_group_notes (
 id uuid primary key,
 group_id uuid not null references public.stc_groups(id),
 group_name text not null,
 group_version integer not null check(group_version > 0),
 title text not null check(title=btrim(title) and length(title) between 1 and 160 and title !~ '[[:cntrl:]]'),
 created_by uuid not null references public.profiles(id),
 creator_name text not null,
 filename text not null check(filename=btrim(filename) and length(filename) between 1 and 180 and filename !~ '[[:cntrl:]/\\]'),
 media_type text not null check(length(media_type) between 1 and 120 and media_type !~ '[^ -~]'),
 size integer not null check(size between 0 and 5242880),
 participant_count integer not null check(participant_count between 2 and 20),
 custody_mode text not null default 'portable' check(custody_mode='portable'),
 state text not null default 'staging' check(state in ('staging','awaiting_backup','ready','cancelled')),
 package_header jsonb,
 ciphertext_sha256 text check(ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp(),
 ready_at timestamptz,
 check((state not in ('awaiting_backup','ready')) or (package_header is not null and ciphertext_sha256 is not null)),
 check((state='ready')=(ready_at is not null))
);
create table public.stc_group_note_participants (
 note_id uuid not null references public.stc_group_notes(id),
 profile_id uuid not null references public.profiles(id),
 display_name text not null, email text not null,
 group_role text not null check(group_role in ('manager','member')),
 share_index integer not null check(share_index between 1 and 20),
 primary key(note_id,profile_id), unique(note_id,share_index)
);
create index stc_group_note_participants_profile_idx on public.stc_group_note_participants(profile_id,note_id);
create index stc_group_notes_created_idx on public.stc_group_notes(created_at desc,id);
create table stc_private.group_note_receipts (
 note_id uuid primary key references public.stc_group_notes(id),
 receipt_sha256 text not null check(receipt_sha256 ~ '^[0-9a-f]{64}$')
);
create table public.stc_group_note_audit (
 id bigint generated always as identity primary key,
 note_id uuid not null references public.stc_group_notes(id),
 actor_profile_id uuid not null references public.profiles(id),
 action text not null check(action in ('created','uploaded','backup_confirmed','cancelled')),
 created_at timestamptz not null default statement_timestamp()
);
create index stc_group_note_audit_note_idx on public.stc_group_note_audit(note_id,created_at,id);

create function stc_private.group_note_access(actor uuid,target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_permission(actor,'documents.read_assigned') and exists(
 select 1 from public.stc_group_notes n where n.id=target and (
 (n.created_by=actor) or (n.state='ready' and exists(select 1 from public.stc_group_note_participants p where p.note_id=n.id and p.profile_id=actor))));
$$;
create function stc_private.group_note_reader(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.group_note_access(stc_private.current_profile_id(),target);
$$;
create function stc_private.group_note_summary(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',n.id,'group_id',n.group_id,'group_name',n.group_name,'group_version',n.group_version,
 'title',n.title,'created_by',n.created_by,'creator_name',n.creator_name,'filename',n.filename,'media_type',n.media_type,'size',n.size,
 'participant_count',n.participant_count,'threshold',n.participant_count,'custody_mode',n.custody_mode,'state',n.state,
 'created_at',n.created_at,'ready_at',n.ready_at) from public.stc_group_notes n where n.id=target;
$$;
create function stc_private.group_note_detail(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('note',stc_private.group_note_summary(target),
 'participants',coalesce((select jsonb_agg(jsonb_build_object('profile_id',p.profile_id,'display_name',p.display_name,'email',p.email,
 'group_role',p.group_role,'share_index',p.share_index) order by p.share_index) from public.stc_group_note_participants p where p.note_id=target),'[]'::jsonb),
 'package_header',n.package_header,'ciphertext_sha256',n.ciphertext_sha256)
 from public.stc_group_notes n where n.id=target;
$$;
create function public.list_group_notes(p_search text default '',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.read_assigned') then raise exception 'Sin acceso.' using errcode='PN403'; end if;
 if p_search is null or length(p_search)>80 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000
 then raise exception 'Consulta inválida.' using errcode='PN422'; end if;
 return(with visible as(select n.* from public.stc_group_notes n where stc_private.group_note_reader(n.id)
 and position(lower(btrim(p_search)) in lower(n.title))>0),page as(select * from visible order by created_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(stc_private.group_note_summary(id) order by created_at desc,id) from page),'[]'::jsonb),
 'total',(select count(*) from visible),'limit',p_limit,'offset',p_offset));
end; $$;
create function public.get_group_note(p_note_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.group_note_reader(p_note_id) then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 return stc_private.group_note_detail(p_note_id);
end; $$;
create function public.list_note_groups(p_search text default '',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.create') then raise exception 'Sin permiso.' using errcode='PN403'; end if;
 if p_search is null or length(p_search)>80 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000
 then raise exception 'Consulta inválida.' using errcode='PN422'; end if;
 return(with eligible as(select g.* from public.stc_groups g where g.is_active and exists(
 select 1 from public.stc_group_members m where m.group_id=g.id and m.profile_id=stc_private.current_profile_id() and m.removed_at is null)
 and position(lower(btrim(p_search)) in lower(g.name))>0),page as(select * from eligible order by name,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'version',g.version,
 'members',coalesce((select jsonb_agg(jsonb_build_object('profile_id',p.id,'display_name',p.display_name,'email',p.email,
 'group_role',m.group_role,'is_active',p.is_active) order by p.id) from public.stc_group_members m join public.profiles p on p.id=m.profile_id
 where m.group_id=g.id and m.removed_at is null),'[]'::jsonb)) order by g.name,g.id) from page g),'[]'::jsonb),
 'total',(select count(*) from eligible),'limit',p_limit,'offset',p_offset));
end; $$;

create function public.server_begin_group_note(p_actor uuid,p_note_id uuid,p_group_id uuid,p_expected_version integer,p_title text,p_filename text,p_media_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.stc_groups%rowtype; amount integer;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.create') then raise exception 'Sin permiso.' using errcode='PN403'; end if;
 select * into target from public.stc_groups where id=p_group_id for update;
 if not found or not exists(select 1 from public.stc_group_members where group_id=p_group_id and profile_id=p_actor and removed_at is null)
 then raise exception 'Grupo no disponible.' using errcode='PN404'; end if;
 if not target.is_active or p_expected_version is null or target.version<>p_expected_version then raise exception 'El grupo cambió.' using errcode='PN409'; end if;
 select count(*) into amount from public.stc_group_members where group_id=p_group_id and removed_at is null;
 if amount not between 2 and 20 or exists(select 1 from public.stc_group_members m join public.profiles p on p.id=m.profile_id
 where m.group_id=p_group_id and m.removed_at is null and not p.is_active) then raise exception 'Revisa integrantes activos.' using errcode='PN422'; end if;
 if exists(select 1 from public.stc_group_notes where id=p_note_id) then raise exception 'Solicitud ya utilizada.' using errcode='PN409'; end if;
 insert into public.stc_group_notes(id,group_id,group_name,group_version,title,created_by,creator_name,filename,media_type,size,participant_count)
 values(p_note_id,p_group_id,target.name,target.version,p_title,p_actor,(select display_name from public.profiles where id=p_actor),p_filename,p_media_type,p_size,amount);
 insert into public.stc_group_note_participants(note_id,profile_id,display_name,email,group_role,share_index)
 select p_note_id,p.id,p.display_name,p.email,m.group_role,row_number() over(order by p.id)
 from public.stc_group_members m join public.profiles p on p.id=m.profile_id where m.group_id=p_group_id and m.removed_at is null;
 insert into public.stc_group_note_audit(note_id,actor_profile_id,action) values(p_note_id,p_actor,'created');
 return stc_private.group_note_detail(p_note_id);
end; $$;
create function public.server_upload_group_note(p_actor uuid,p_note_id uuid,p_header jsonb,p_ciphertext_sha256 text,p_receipt_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare n public.stc_group_notes%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into n from public.stc_group_notes where id=p_note_id and created_by=p_actor for update;
 if not found then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 if not stc_private.doc_permission(p_actor,'documents.create') then raise exception 'Sin permiso.' using errcode='PN403'; end if;
 if n.state<>'staging' then raise exception 'Estado de carga distinto.' using errcode='PN409'; end if;
 if jsonb_typeof(p_header) is distinct from 'object' or
 (p_header-array['nonce_base64','tag_base64','document_id']) is distinct from jsonb_build_object(
 'format','stc-special-note','version',1,'algorithm','AES-256-GCM+Shamir','filename',n.filename,'media_type',n.media_type,
 'size',n.size,'share_count',n.participant_count,'threshold',n.participant_count,'access_mode','all-members')
 or coalesce(p_header->>'document_id','') !~ '^[0-9a-f]{32}$'
 or coalesce(p_header->>'nonce_base64','') !~ '^[A-Za-z0-9+/]{16}$'
 or coalesce(p_header->>'tag_base64','') !~ '^[A-Za-z0-9+/]{22}==$'
 or coalesce(p_ciphertext_sha256,'') !~ '^[0-9a-f]{64}$' or coalesce(p_receipt_sha256,'') !~ '^[0-9a-f]{64}$'
 then raise exception 'Cabecera inválida.' using errcode='PN422'; end if;
 update public.stc_group_notes set state='awaiting_backup',package_header=p_header,ciphertext_sha256=p_ciphertext_sha256 where id=p_note_id;
 insert into stc_private.group_note_receipts values(p_note_id,p_receipt_sha256);
 insert into public.stc_group_note_audit(note_id,actor_profile_id,action) values(p_note_id,p_actor,'uploaded');
end; $$;
create function public.server_confirm_group_note(p_actor uuid,p_note_id uuid,p_receipt_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare n public.stc_group_notes%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into n from public.stc_group_notes where id=p_note_id and created_by=p_actor for update;
 if not found then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 if not stc_private.doc_permission(p_actor,'documents.create') then raise exception 'Sin permiso.' using errcode='PN403'; end if;
 if not exists(select 1 from stc_private.group_note_receipts where note_id=p_note_id and receipt_sha256=p_receipt_sha256)
 then raise exception 'Resguardo incorrecto.' using errcode='PN422'; end if;
 if n.state='ready' then return; end if;
 if n.state<>'awaiting_backup' or not exists(select 1 from public.stc_groups g join public.stc_group_members m on m.group_id=g.id
 where g.id=n.group_id and g.is_active and m.profile_id=p_actor and m.removed_at is null)
 or exists(select 1 from public.stc_group_note_participants x join public.profiles p on p.id=x.profile_id where x.note_id=p_note_id and not p.is_active)
 then raise exception 'Revisa grupo y participantes.' using errcode='PN409'; end if;
 update public.stc_group_notes set state='ready',ready_at=statement_timestamp() where id=p_note_id;
 insert into public.stc_group_note_audit(note_id,actor_profile_id,action) values(p_note_id,p_actor,'backup_confirmed');
end; $$;
create function public.server_cancel_group_note(p_actor uuid,p_note_id uuid,p_staging_only boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare n public.stc_group_notes%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not exists(select 1 from public.profiles where id=p_actor and is_active and auth_user_id is not null)
 then raise exception 'Sin acceso.' using errcode='PN403'; end if;
 select * into n from public.stc_group_notes where id=p_note_id and created_by=p_actor for update;
 if not found then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 if n.state='cancelled' then return false; end if;
 if p_staging_only and n.state<>'staging' then return false; end if;
 if n.state='ready' then raise exception 'Nota ya compartida.' using errcode='PN409'; end if;
 update public.stc_group_notes set state='cancelled' where id=p_note_id;
 delete from stc_private.group_note_receipts where note_id=p_note_id;
 insert into public.stc_group_note_audit(note_id,actor_profile_id,action) values(p_note_id,p_actor,'cancelled');
 return true;
end; $$;

-- Ningún JWT de usuario escribe tablas o confirma hechos de cifrado/custodia.
do $$ declare t text; begin
 foreach t in array array['stc_group_notes','stc_group_note_participants','stc_group_note_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role,supabase_auth_admin',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end; $$;
revoke all on stc_private.group_note_receipts from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on sequence public.stc_group_note_audit_id_seq from public,anon,authenticated,service_role,supabase_auth_admin;
create policy stc_group_notes_read on public.stc_group_notes for select to authenticated using(stc_private.group_note_reader(id));
create policy stc_group_note_participants_read on public.stc_group_note_participants for select to authenticated using(stc_private.group_note_reader(note_id));
create policy stc_group_note_audit_read on public.stc_group_note_audit for select to authenticated using(stc_private.group_note_reader(note_id));
revoke all on function stc_private.group_note_access(uuid,uuid),stc_private.group_note_reader(uuid),stc_private.group_note_summary(uuid),stc_private.group_note_detail(uuid) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function stc_private.group_note_reader(uuid) to authenticated;
revoke all on function public.list_group_notes(text,integer,integer),public.get_group_note(uuid),public.list_note_groups(text,integer,integer) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.list_group_notes(text,integer,integer),public.get_group_note(uuid),public.list_note_groups(text,integer,integer) to authenticated;
revoke all on function public.server_begin_group_note(uuid,uuid,uuid,integer,text,text,text,integer),public.server_upload_group_note(uuid,uuid,jsonb,text,text),public.server_confirm_group_note(uuid,uuid,text),public.server_cancel_group_note(uuid,uuid,boolean) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.server_begin_group_note(uuid,uuid,uuid,integer,text,text,text,integer),public.server_upload_group_note(uuid,uuid,jsonb,text,text),public.server_confirm_group_note(uuid,uuid,text),public.server_cancel_group_note(uuid,uuid,boolean) to service_role;
do $$ begin
 if not exists(select 1 from storage.buckets where id='stc-documents' and not public and file_size_limit=5242880)
 then raise exception 'Se requiere el bucket privado stc-documents de la migración de memorándums.'; end if;
end; $$;
comment on table public.stc_group_note_participants is 'Snapshot inmutable; no se recalcula al cambiar el grupo. share_index vincula un fragmento portable a su participante.';
comment on table public.stc_group_notes is 'Solo metadatos y cabecera pública autenticada. Ciphertext en Storage. Nunca plaintext, clave AES o fragmentos.';
notify pgrst,'reload schema';
commit;
