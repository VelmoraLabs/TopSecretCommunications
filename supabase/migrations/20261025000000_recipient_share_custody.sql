-- Requiere las cinco migraciones anteriores. Solo cambia las notas nuevas.
-- Claves públicas por perfil, sobres individuales y publicación atómica.
begin;
create table public.stc_encryption_keys (
 id uuid primary key,
 profile_id uuid not null references public.profiles(id),
 label text not null check(label=btrim(label) and length(label) between 1 and 80 and label !~ '[[:cntrl:]]'),
 public_base64 text not null check(length(public_base64)=392 and public_base64 ~ '^[A-Za-z0-9+/]+$'),
 fingerprint text not null unique check(fingerprint ~ '^[0-9a-f]{64}$'),
 state text not null default 'pending' check(state in ('pending','active','retired')),
 created_at timestamptz not null default statement_timestamp(),
 activated_at timestamptz, retired_at timestamptz,
 unique(id,profile_id),
 check(state<>'pending' or activated_at is null),
 check(state<>'active' or activated_at is not null),
 check((state='retired')=(retired_at is not null))
);
create unique index stc_encryption_one_active on public.stc_encryption_keys(profile_id) where state='active';
create index stc_encryption_keys_profile on public.stc_encryption_keys(profile_id,created_at desc,id);
create table public.stc_encryption_key_audit (
 id bigint generated always as identity primary key,
 key_id uuid not null references public.stc_encryption_keys(id),
 profile_id uuid not null references public.profiles(id),
 action text not null check(action in ('generated','activated','retired')),
 created_at timestamptz not null default statement_timestamp()
);
alter table public.stc_group_notes drop constraint stc_group_notes_custody_mode_check;
alter table public.stc_group_notes add constraint stc_group_notes_custody_mode_check check(custody_mode in ('portable','individual-v1'));
alter table public.stc_group_note_participants add column encryption_key_id uuid;
alter table public.stc_group_note_participants add foreign key(encryption_key_id,profile_id) references public.stc_encryption_keys(id,profile_id);
alter table public.stc_group_note_audit drop constraint stc_group_note_audit_action_check;
alter table public.stc_group_note_audit add constraint stc_group_note_audit_action_check check(action in ('created','uploaded','backup_confirmed','cancelled','shares_distributed'));
create table public.stc_group_note_shares (
 note_id uuid not null,
 profile_id uuid not null,
 envelope jsonb not null check(jsonb_typeof(envelope)='object'),
 created_at timestamptz not null default statement_timestamp(),
 primary key(note_id,profile_id),
 foreign key(note_id,profile_id) references public.stc_group_note_participants(note_id,profile_id)
);

create function public.list_own_encryption_keys()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.read_assigned') then raise exception 'Sin acceso.' using errcode='PK403'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(k) order by created_at desc,id) from public.stc_encryption_keys k where profile_id=stc_private.current_profile_id()),'[]'::jsonb));
end; $$;
create function public.get_own_encryption_key(p_key_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not stc_private.has_permission('documents.read_assigned') then raise exception 'Sin acceso.' using errcode='PK403'; end if;
 select to_jsonb(k) into result from public.stc_encryption_keys k where id=p_key_id and profile_id=stc_private.current_profile_id();
 if result is null then raise exception 'Clave no disponible.' using errcode='PK404'; end if;
 return result;
end; $$;
create function public.server_register_encryption_key(p_actor uuid,p_key_id uuid,p_label text,p_public_base64 text,p_fingerprint text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.read_assigned') then raise exception 'Sin acceso.' using errcode='PK403'; end if;
 if (select count(*) from public.stc_encryption_keys where profile_id=p_actor and state='pending')>=3
 or (select count(*) from public.stc_encryption_keys where profile_id=p_actor)>=100
 then raise exception 'Retira preparaciones pendientes. Máximo 100 claves históricas.' using errcode='PK409'; end if;
 if exists(select 1 from public.stc_signing_keys where fingerprint=p_fingerprint)
 then raise exception 'Usa una clave distinta a las claves de firma.' using errcode='PK422'; end if;
 insert into public.stc_encryption_keys(id,profile_id,label,public_base64,fingerprint) values(p_key_id,p_actor,p_label,p_public_base64,p_fingerprint);
 insert into public.stc_encryption_key_audit(key_id,profile_id,action) values(p_key_id,p_actor,'generated');
end; $$;
create function public.server_activate_encryption_key(p_actor uuid,p_key_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare k public.stc_encryption_keys%rowtype; old_id uuid;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.read_assigned') then raise exception 'Sin acceso.' using errcode='PK403'; end if;
 select * into k from public.stc_encryption_keys where id=p_key_id and profile_id=p_actor for update;
 if not found then raise exception 'Clave no disponible.' using errcode='PK404'; end if;
 if k.state='active' then return; end if;
 if k.state<>'pending' then raise exception 'Una clave retirada no se reactiva.' using errcode='PK409'; end if;
 for old_id in select id from public.stc_encryption_keys where profile_id=p_actor and state='active' loop
  update public.stc_encryption_keys set state='retired',retired_at=statement_timestamp() where id=old_id;
  insert into public.stc_encryption_key_audit(key_id,profile_id,action) values(old_id,p_actor,'retired');
 end loop;
 update public.stc_encryption_keys set state='active',activated_at=statement_timestamp() where id=p_key_id;
 insert into public.stc_encryption_key_audit(key_id,profile_id,action) values(p_key_id,p_actor,'activated');
end; $$;
create function public.retire_encryption_key(p_key_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare k public.stc_encryption_keys%rowtype; actor uuid:=stc_private.current_profile_id();
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.has_permission('documents.read_assigned') then raise exception 'Sin acceso.' using errcode='PK403'; end if;
 select * into k from public.stc_encryption_keys where id=p_key_id and profile_id=actor for update;
 if not found then raise exception 'Clave no disponible.' using errcode='PK404'; end if;
 if k.state='retired' then return; end if;
 update public.stc_encryption_keys set state='retired',retired_at=statement_timestamp() where id=p_key_id;
 insert into public.stc_encryption_key_audit(key_id,profile_id,action) values(p_key_id,actor,'retired');
end; $$;

-- Detalle público: solo identificadores y huellas; no incluye los sobres ajenos.
create or replace function stc_private.group_note_detail(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('note',stc_private.group_note_summary(target),
 'participants',coalesce((select jsonb_agg(jsonb_build_object('profile_id',p.profile_id,'display_name',p.display_name,'email',p.email,
 'group_role',p.group_role,'share_index',p.share_index,'encryption_key_id',p.encryption_key_id,'encryption_fingerprint',k.fingerprint) order by p.share_index)
 from public.stc_group_note_participants p left join public.stc_encryption_keys k on k.id=p.encryption_key_id where p.note_id=target),'[]'::jsonb),
 'package_header',n.package_header,'ciphertext_sha256',n.ciphertext_sha256)
 from public.stc_group_notes n where n.id=target;
$$;
create function public.server_begin_distributed_note(p_actor uuid,p_note_id uuid,p_group_id uuid,p_expected_version integer,p_title text,p_filename text,p_media_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- La función previa toma el mismo bloqueo y valida permiso, pertenencia y versión.
 perform public.server_begin_group_note(p_actor,p_note_id,p_group_id,p_expected_version,p_title,p_filename,p_media_type,p_size);
 if exists(select 1 from public.stc_group_note_participants x join public.profiles p on p.id=x.profile_id
 where x.note_id=p_note_id and (p.auth_user_id is null or not exists(select 1 from public.stc_encryption_keys k where k.profile_id=p.id and k.state='active')))
 then raise exception 'Cada participante debe activar su clave de cifrado.' using errcode='PN428'; end if;
 update public.stc_group_notes set custody_mode='individual-v1' where id=p_note_id;
 update public.stc_group_note_participants x set encryption_key_id=k.id from public.stc_encryption_keys k
 where x.note_id=p_note_id and x.profile_id=k.profile_id and k.state='active';
 return jsonb_build_object('detail',stc_private.group_note_detail(p_note_id),
 'keys',(select jsonb_agg(to_jsonb(k) order by x.share_index) from public.stc_group_note_participants x join public.stc_encryption_keys k on k.id=x.encryption_key_id where x.note_id=p_note_id));
end; $$;
create function public.server_commit_distributed_note(p_actor uuid,p_note_id uuid,p_header jsonb,p_ciphertext_sha256 text,p_envelopes jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare n public.stc_group_notes%rowtype; member_row record; e jsonb; c jsonb;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into n from public.stc_group_notes where id=p_note_id and created_by=p_actor for update;
 if not found then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 if not stc_private.doc_permission(p_actor,'documents.create') then raise exception 'Sin permiso.' using errcode='PN403'; end if;
 -- Reintento de la misma confirmación tras perder una respuesta: sin nuevas escrituras.
 if n.custody_mode='individual-v1' and n.state='ready' and n.package_header=p_header and n.ciphertext_sha256=p_ciphertext_sha256
 and p_envelopes=(select jsonb_agg(s.envelope order by x.share_index) from public.stc_group_note_shares s join public.stc_group_note_participants x using(note_id,profile_id) where s.note_id=p_note_id)
 then return; end if;
 if n.custody_mode<>'individual-v1' or n.state<>'staging' then raise exception 'Estado distinto.' using errcode='PN409'; end if;
 if not exists(select 1 from public.stc_groups g join public.stc_group_members m on m.group_id=g.id where g.id=n.group_id and g.is_active and m.profile_id=p_actor and m.removed_at is null)
 or exists(select 1 from public.stc_group_note_participants x join public.profiles p on p.id=x.profile_id join public.stc_encryption_keys k on k.id=x.encryption_key_id
 where x.note_id=p_note_id and (not p.is_active or p.auth_user_id is null or k.state<>'active'))
 then raise exception 'Revisa grupo, participantes y claves.' using errcode='PN409'; end if;
 if jsonb_typeof(p_header) is distinct from 'object' or
 (p_header-array['nonce_base64','tag_base64','document_id']) is distinct from jsonb_build_object(
 'format','stc-special-note','version',1,'algorithm','AES-256-GCM+Shamir','filename',n.filename,'media_type',n.media_type,
 'size',n.size,'share_count',n.participant_count,'threshold',n.participant_count,'access_mode','all-members')
 or coalesce(p_header->>'document_id','') !~ '^[0-9a-f]{32}$'
 or coalesce(p_header->>'nonce_base64','') !~ '^[A-Za-z0-9+/]{16}$'
 or coalesce(p_header->>'tag_base64','') !~ '^[A-Za-z0-9+/]{22}==$'
 or coalesce(p_ciphertext_sha256,'') !~ '^[0-9a-f]{64}$'
 then raise exception 'Cabecera inválida.' using errcode='PN422'; end if;
 if jsonb_typeof(p_envelopes) is distinct from 'array' then raise exception 'Sobres inválidos.' using errcode='PN422'; end if;
 if jsonb_array_length(p_envelopes)<>n.participant_count then raise exception 'Faltan sobres.' using errcode='PN422'; end if;
 for member_row in select p.*,k.fingerprint from public.stc_group_note_participants p join public.stc_encryption_keys k on k.id=p.encryption_key_id where p.note_id=p_note_id order by p.share_index loop
  e:=p_envelopes->(member_row.share_index-1); c:=e->'context';
  if jsonb_typeof(e) is distinct from 'object' or (e-array['context','wrapped_key_base64','nonce_base64','ciphertext_base64','tag_base64'])<>'{}'::jsonb
  or c is distinct from jsonb_build_object('format','stc-share-envelope','version',1,'algorithm','RSA-OAEP-256+A256GCM',
    'note_id',n.id,'set_id',p_header->>'document_id','recipient_id',member_row.profile_id,'key_id',member_row.encryption_key_id,'fingerprint',member_row.fingerprint,
    'share_index',member_row.share_index,'share_count',n.participant_count,'threshold',n.participant_count)
  or length(coalesce(e->>'wrapped_key_base64',''))<>344
  or coalesce(e->>'wrapped_key_base64','') !~ '^[A-Za-z0-9+/]+==$'
  or coalesce(e->>'nonce_base64','') !~ '^[A-Za-z0-9+/]{16}$'
  or coalesce(e->>'tag_base64','') !~ '^[A-Za-z0-9+/]{22}==$'
  or length(coalesce(e->>'ciphertext_base64','')) not between 4 and 4096
  or coalesce(e->>'ciphertext_base64','') !~ '^[A-Za-z0-9+/]+={0,2}$'
  then raise exception 'Sobre incompatible.' using errcode='PN422'; end if;
  insert into public.stc_group_note_shares(note_id,profile_id,envelope) values(p_note_id,member_row.profile_id,e);
 end loop;
 update public.stc_group_notes set state='ready',ready_at=statement_timestamp(),package_header=p_header,ciphertext_sha256=p_ciphertext_sha256 where id=p_note_id;
 insert into public.stc_group_note_audit(note_id,actor_profile_id,action) values(p_note_id,p_actor,'shares_distributed');
end; $$;
create function public.get_own_note_share(p_note_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not stc_private.group_note_reader(p_note_id) then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 select s.envelope into result from public.stc_group_note_shares s join public.stc_group_notes n on n.id=s.note_id
 where s.note_id=p_note_id and s.profile_id=stc_private.current_profile_id() and n.state='ready' and n.custody_mode='individual-v1';
 if result is null then raise exception 'Fragmento no disponible.' using errcode='PN404'; end if;
 return result;
end; $$;

create or replace function public.list_note_groups(p_search text default '',p_limit integer default 20,p_offset integer default 0)
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
 'group_role',m.group_role,'is_active',p.is_active,'encryption_ready',p.auth_user_id is not null and exists(select 1 from public.stc_encryption_keys k where k.profile_id=p.id and k.state='active')) order by p.id) from public.stc_group_members m join public.profiles p on p.id=m.profile_id
 where m.group_id=g.id and m.removed_at is null),'[]'::jsonb)) order by g.name,g.id) from page g),'[]'::jsonb),
 'total',(select count(*) from eligible),'limit',p_limit,'offset',p_offset));
end; $$;


create or replace function public.server_upload_group_note(p_actor uuid,p_note_id uuid,p_header jsonb,p_ciphertext_sha256 text,p_receipt_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare n public.stc_group_notes%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into n from public.stc_group_notes where id=p_note_id and created_by=p_actor for update;
 if not found then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 if n.custody_mode<>'portable' then raise exception 'Esta nota usa fragmentos individuales.' using errcode='PN409'; end if;
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

create or replace function public.server_confirm_group_note(p_actor uuid,p_note_id uuid,p_receipt_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare n public.stc_group_notes%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into n from public.stc_group_notes where id=p_note_id and created_by=p_actor for update;
 if not found then raise exception 'Nota no disponible.' using errcode='PN404'; end if;
 if n.custody_mode<>'portable' then raise exception 'Esta nota usa fragmentos individuales.' using errcode='PN409'; end if;
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

-- JWT: solo lectura de las claves propias y del único sobre asignado.
do $$ declare t text; begin
 foreach t in array array['stc_encryption_keys','stc_encryption_key_audit','stc_group_note_shares'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role,supabase_auth_admin',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end; $$;
create policy stc_encryption_keys_own on public.stc_encryption_keys for select to authenticated using(profile_id=stc_private.current_profile_id());
create policy stc_encryption_key_audit_own on public.stc_encryption_key_audit for select to authenticated using(profile_id=stc_private.current_profile_id());
create policy stc_note_shares_own on public.stc_group_note_shares for select to authenticated using(profile_id=stc_private.current_profile_id() and stc_private.group_note_reader(note_id));
revoke all on sequence public.stc_encryption_key_audit_id_seq from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.list_own_encryption_keys(),public.get_own_encryption_key(uuid),public.retire_encryption_key(uuid),public.get_own_note_share(uuid) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.list_own_encryption_keys(),public.get_own_encryption_key(uuid),public.retire_encryption_key(uuid),public.get_own_note_share(uuid) to authenticated;
revoke all on function public.server_register_encryption_key(uuid,uuid,text,text,text),public.server_activate_encryption_key(uuid,uuid),public.server_begin_distributed_note(uuid,uuid,uuid,integer,text,text,text,integer),public.server_commit_distributed_note(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.server_register_encryption_key(uuid,uuid,text,text,text),public.server_activate_encryption_key(uuid,uuid),public.server_begin_distributed_note(uuid,uuid,uuid,integer,text,text,text,integer),public.server_commit_distributed_note(uuid,uuid,jsonb,text,jsonb) to service_role;
comment on table public.stc_encryption_keys is 'Solo claves públicas de cifrado. Una activa por perfil. Retirar no elimina la clave histórica ni cambia documentos anteriores.';
comment on table public.stc_group_note_shares is 'Un sobre híbrido cifrado por participante original; nunca fragmentos en claro, privadas ni claves AES.';
notify pgrst,'reload schema';
commit;
