-- Expedientes individuales AES-GCM + RSA-OAEP. Aplicar una vez después de
-- 20261026180000_dashboard_notification_context.sql. No modifica flujos previos.
begin;

do $$ begin
 if to_regclass('public.stc_encryption_keys') is null
 or to_regprocedure('public.stc_dashboard()') is null then
  raise exception 'Aplica las nueve migraciones anteriores antes de expedientes.';
 end if;
 if not exists(select 1 from storage.buckets
 where id='stc-documents' and not public and file_size_limit=5242880) then
  raise exception 'Se requiere el bucket privado stc-documents de 5 MiB.';
 end if;
end; $$;

create table public.stc_personnel_files (
 id uuid primary key,
 version_id uuid not null unique,
 created_by uuid not null references public.profiles(id),
 title text not null check(title=btrim(title) and length(title) between 1 and 160 and title !~ '[[:cntrl:]]'),
 filename text not null check(filename=btrim(filename) and filename not in ('.','..')
   and length(filename) between 1 and 180 and filename !~ '[[:cntrl:]/\\]'),
 media_type text not null check(length(media_type) between 1 and 120 and media_type !~ '[^ -~]'),
 size integer not null check(size between 0 and 5242880),
 state text not null default 'staging' check(state in ('staging','ready','cancelled')),
 created_at timestamptz not null default statement_timestamp(),
 ready_at timestamptz,
 check((state='ready')=(ready_at is not null))
);
create table public.stc_personnel_file_recipients (
 document_id uuid not null references public.stc_personnel_files(id),
 profile_id uuid not null references public.profiles(id),
 key_id uuid not null,
 primary key(document_id,profile_id),
 foreign key(key_id,profile_id) references public.stc_encryption_keys(id,profile_id)
);
create index stc_personnel_recipients_profile on public.stc_personnel_file_recipients(profile_id,document_id);
create index stc_personnel_files_recent on public.stc_personnel_files(created_at desc,id);
create table public.stc_personnel_file_audit (
 id bigint generated always as identity primary key,
 document_id uuid not null references public.stc_personnel_files(id),
 actor_profile_id uuid not null references public.profiles(id),
 action text not null check(action in ('reserved','published','cancelled','downloaded')),
 created_at timestamptz not null default statement_timestamp()
);
create index stc_personnel_audit_document on public.stc_personnel_file_audit(document_id,id);
create table stc_private.personnel_file_material (
 document_id uuid primary key references public.stc_personnel_files(id),
 header jsonb not null check(jsonb_typeof(header)='object'),
 nonce_base64 text not null check(length(nonce_base64)=16),
 tag_base64 text not null check(length(tag_base64)=24),
 ciphertext_sha256 text not null check(ciphertext_sha256 ~ '^[0-9a-f]{64}$')
);

create function stc_private.personnel_file_visible(actor uuid,target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_permission(actor,'documents.read_assigned') and exists(
  select 1 from public.stc_personnel_files f
  join public.stc_personnel_file_recipients r on r.document_id=f.id
  where f.id=target and r.profile_id=actor and (f.state='ready' or f.created_by=actor)
 );
$$;
create function stc_private.personnel_file_reader(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.personnel_file_visible(stc_private.current_profile_id(),target);
$$;
create function stc_private.personnel_file_detail(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('file',to_jsonb(f),'participants',(
  select jsonb_agg(jsonb_build_object('profile_id',p.id,'display_name',p.display_name,
   'email',p.email,'key_id',r.key_id,'fingerprint',k.fingerprint,'is_active',p.is_active)
   order by p.id)
  from public.stc_personnel_file_recipients r
  join public.profiles p on p.id=r.profile_id
  join public.stc_encryption_keys k on k.id=r.key_id
  where r.document_id=f.id
 )) from public.stc_personnel_files f where f.id=target;
$$;
create function stc_private.personnel_b64_valid(value text,expected integer)
returns boolean language plpgsql immutable set search_path='' as $$
declare decoded_bytes bytea;
begin
 if value is null or length(value)>344 then return false; end if;
 decoded_bytes:=decode(value,'base64');
 return octet_length(decoded_bytes)=expected
  and replace(encode(decoded_bytes,'base64'),E'\n','')=value;
exception when invalid_parameter_value then return false;
end; $$;

create function public.get_personnel_file(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.personnel_file_reader(p_document_id) then
  raise exception 'Expediente no disponible.' using errcode='PF404';
 end if;
 return stc_private.personnel_file_detail(p_document_id);
end; $$;
create function public.list_personnel_files(p_search text default '',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.read_assigned') then
  raise exception 'Sin permiso.' using errcode='PF403';
 end if;
 if p_search is null or length(p_search)>80 or p_limit is null or p_limit not between 1 and 100
 or p_offset is null or p_offset not between 0 and 100000 then
  raise exception 'Consulta inválida.' using errcode='PF422';
 end if;
 return(with visible as(
  select f.* from public.stc_personnel_files f where stc_private.personnel_file_reader(f.id)
   and position(lower(btrim(p_search)) in lower(f.title))>0
 ), page as(select * from visible order by created_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id) from page p),'[]'::jsonb),
 'total',(select count(*) from visible),'limit',p_limit,'offset',p_offset));
end; $$;

create function public.server_begin_personnel_file(
 p_actor uuid,p_document_id uuid,p_version_id uuid,p_title text,p_filename text,
 p_media_type text,p_size integer,p_recipients jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]:=array[]::uuid[]; e jsonb;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.create')
 or not stc_private.doc_permission(p_actor,'documents.read_assigned') then
  raise exception 'Sin permiso.' using errcode='PF403';
 end if;
 if p_document_id is null or p_version_id is null
 or p_title is null or p_title<>btrim(p_title) or length(p_title) not between 1 and 160 or p_title ~ '[[:cntrl:]]'
 or p_filename is null or p_filename<>btrim(p_filename) or p_filename in ('.','..')
 or length(p_filename) not between 1 and 180 or p_filename ~ '[[:cntrl:]/\\]'
 or p_media_type is null or length(p_media_type) not between 1 and 120 or p_media_type ~ '[^ -~]'
 or p_size is null or p_size not between 0 and 5242880
 or jsonb_typeof(p_recipients) is distinct from 'array' then
  raise exception 'Datos inválidos.' using errcode='PF422';
 end if;
 if jsonb_array_length(p_recipients) not between 1 and 255 then
  raise exception 'Selecciona de 1 a 255 destinatarios.' using errcode='PF422';
 end if;
 for e in select value from jsonb_array_elements(p_recipients) loop
  if jsonb_typeof(e) is distinct from 'object' or (e-'profile_id')<>'{}'::jsonb
  or coalesce(e->>'profile_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'Destinatario inválido.' using errcode='PF422';
  end if;
  if (e->>'profile_id')::uuid=any(ids) then
   raise exception 'Destinatarios repetidos.' using errcode='PF422';
  end if;
  ids:=array_append(ids,(e->>'profile_id')::uuid);
 end loop;
 if not p_actor=any(ids) then ids:=array_append(ids,p_actor); end if;
 if exists(select 1 from unnest(ids) i where not stc_private.doc_permission(i,'documents.read_assigned')) then
  raise exception 'Destinatario inactivo o sin acceso.' using errcode='PF422';
 end if;
 if exists(select 1 from unnest(ids) i where not exists(
  select 1 from public.stc_encryption_keys k where k.profile_id=i and k.state='active')) then
  raise exception 'Cada destinatario y el creador necesitan una clave activa.' using errcode='PF428';
 end if;
 if exists(select 1 from public.stc_personnel_files where id=p_document_id or version_id=p_version_id) then
  raise exception 'Identificador ya utilizado.' using errcode='PF409';
 end if;
 insert into public.stc_personnel_files(id,version_id,created_by,title,filename,media_type,size)
 values(p_document_id,p_version_id,p_actor,p_title,p_filename,p_media_type,p_size);
 insert into public.stc_personnel_file_recipients(document_id,profile_id,key_id)
 select p_document_id,k.profile_id,k.id from public.stc_encryption_keys k
 where k.profile_id=any(ids) and k.state='active';
 insert into public.stc_personnel_file_audit(document_id,actor_profile_id,action) values(p_document_id,p_actor,'reserved');
 return jsonb_build_object('detail',stc_private.personnel_file_detail(p_document_id),'keys',(
  select jsonb_agg(to_jsonb(k) order by k.profile_id)
  from public.stc_personnel_file_recipients r join public.stc_encryption_keys k on k.id=r.key_id
  where r.document_id=p_document_id));
end; $$;

create function public.server_commit_personnel_file(
 p_actor uuid,p_document_id uuid,p_version_id uuid,p_header jsonb,
 p_nonce_base64 text,p_tag_base64 text,p_ciphertext_sha256 text
) returns void language plpgsql security definer set search_path='' as $$
declare f public.stc_personnel_files%rowtype; r record; e jsonb; idx integer:=0;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.create')
 or not stc_private.doc_permission(p_actor,'documents.read_assigned') then
  raise exception 'Sin permiso.' using errcode='PF403';
 end if;
 select * into f from public.stc_personnel_files
 where id=p_document_id and created_by=p_actor and version_id=p_version_id for update;
 if not found then raise exception 'Expediente no disponible.' using errcode='PF404'; end if;
 -- La misma publicación puede repetirse tras perder una respuesta.
 if f.state='ready' and exists(select 1 from stc_private.personnel_file_material m
 where m.document_id=f.id and m.header=p_header and m.nonce_base64=p_nonce_base64
 and m.tag_base64=p_tag_base64 and m.ciphertext_sha256=p_ciphertext_sha256) then return; end if;
 if f.state<>'staging' then raise exception 'Estado distinto.' using errcode='PF409'; end if;
 if exists(select 1 from public.stc_personnel_file_recipients x
 join public.stc_encryption_keys k on k.id=x.key_id
 where x.document_id=f.id and (k.state<>'active' or not stc_private.doc_permission(x.profile_id,'documents.read_assigned'))) then
  raise exception 'Cambió una cuenta o su clave.' using errcode='PF409';
 end if;
 if jsonb_typeof(p_header) is distinct from 'object'
 or (p_header-'envelopes') is distinct from jsonb_build_object(
  'format','stc-personnel-file','format_version',1,'algorithm','A256GCM+RSA-OAEP-256',
  'document_id',f.id,'version_id',f.version_id,'created_by',f.created_by,'title',f.title,
  'filename',f.filename,'media_type',f.media_type,'size',f.size)
 or jsonb_typeof(p_header->'envelopes') is distinct from 'array'
 or not stc_private.personnel_b64_valid(p_nonce_base64,12)
 or not stc_private.personnel_b64_valid(p_tag_base64,16)
 or coalesce(p_ciphertext_sha256,'') !~ '^[0-9a-f]{64}$' then
  raise exception 'Cabecera inválida.' using errcode='PF422';
 end if;
 if jsonb_array_length(p_header->'envelopes')<>(select count(*) from public.stc_personnel_file_recipients where document_id=f.id) then
  raise exception 'Sobres incompletos.' using errcode='PF422';
 end if;
 for r in select x.profile_id,x.key_id,k.fingerprint
 from public.stc_personnel_file_recipients x join public.stc_encryption_keys k on k.id=x.key_id
 where x.document_id=f.id order by x.profile_id loop
  e:=p_header->'envelopes'->idx; idx:=idx+1;
  if jsonb_typeof(e) is distinct from 'object'
  or (e-'wrapped_key_base64') is distinct from jsonb_build_object(
   'profile_id',r.profile_id,'key_id',r.key_id,'fingerprint',r.fingerprint)
  or not stc_private.personnel_b64_valid(e->>'wrapped_key_base64',256) then
   raise exception 'Sobre incompatible.' using errcode='PF422';
  end if;
 end loop;
 insert into stc_private.personnel_file_material values(f.id,p_header,p_nonce_base64,p_tag_base64,p_ciphertext_sha256);
 update public.stc_personnel_files set state='ready',ready_at=statement_timestamp() where id=f.id;
 insert into public.stc_personnel_file_audit(document_id,actor_profile_id,action) values(f.id,p_actor,'published');
end; $$;

create function public.server_cancel_personnel_file(p_actor uuid,p_document_id uuid,p_version_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare f public.stc_personnel_files%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into f from public.stc_personnel_files
 where id=p_document_id and created_by=p_actor and version_id=p_version_id for update;
 if not found or f.state='ready' then return false; end if;
 if f.state='staging' then
  update public.stc_personnel_files set state='cancelled' where id=f.id;
  insert into public.stc_personnel_file_audit(document_id,actor_profile_id,action) values(f.id,p_actor,'cancelled');
 end if;
 return true;
end; $$;
create function public.server_personnel_file_material(p_actor uuid,p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not stc_private.personnel_file_visible(p_actor,p_document_id)
 or not exists(select 1 from public.stc_personnel_files where id=p_document_id and state='ready') then
  raise exception 'Expediente no disponible.' using errcode='PF404';
 end if;
 select jsonb_build_object('detail',stc_private.personnel_file_detail(f.id),'header',m.header,
 'nonce_base64',m.nonce_base64,'tag_base64',m.tag_base64,'ciphertext_sha256',m.ciphertext_sha256)
 into result from public.stc_personnel_files f join stc_private.personnel_file_material m on m.document_id=f.id
 where f.id=p_document_id;
 if result is null then raise exception 'Material no disponible.' using errcode='PF404'; end if;
 return result;
end; $$;
create function public.server_complete_personnel_download(
 p_actor uuid,p_document_id uuid,p_version_id uuid,p_ciphertext_sha256 text
) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.personnel_file_visible(p_actor,p_document_id) then
  raise exception 'Expediente no disponible.' using errcode='PF404';
 end if;
 if not exists(select 1 from public.stc_personnel_files f
 join stc_private.personnel_file_material m on m.document_id=f.id
 where f.id=p_document_id and f.version_id=p_version_id and f.state='ready'
 and m.ciphertext_sha256=p_ciphertext_sha256) then
  raise exception 'Cambió la versión.' using errcode='PF409';
 end if;
 insert into public.stc_personnel_file_audit(document_id,actor_profile_id,action)
 values(p_document_id,p_actor,'downloaded');
end; $$;

-- Clientes: solo metadatos autorizados. Ni service_role lee material por tabla.
do $$ declare t text; begin
 foreach t in array array['stc_personnel_files','stc_personnel_file_recipients','stc_personnel_file_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role,supabase_auth_admin',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end; $$;
alter table stc_private.personnel_file_material enable row level security;
revoke all on stc_private.personnel_file_material,public.stc_personnel_file_audit_id_seq
 from public,anon,authenticated,service_role,supabase_auth_admin;
create policy stc_personnel_read on public.stc_personnel_files for select to authenticated
 using(stc_private.personnel_file_reader(id));
create policy stc_personnel_recipients_read on public.stc_personnel_file_recipients for select to authenticated
 using(stc_private.personnel_file_reader(document_id));
create policy stc_personnel_audit_read on public.stc_personnel_file_audit for select to authenticated
 using(actor_profile_id=stc_private.current_profile_id() and stc_private.personnel_file_reader(document_id));
revoke all on function stc_private.personnel_file_visible(uuid,uuid),stc_private.personnel_file_reader(uuid),
 stc_private.personnel_file_detail(uuid),stc_private.personnel_b64_valid(text,integer)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function stc_private.personnel_file_reader(uuid) to authenticated;
revoke all on function public.get_personnel_file(uuid),public.list_personnel_files(text,integer,integer)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.get_personnel_file(uuid),public.list_personnel_files(text,integer,integer) to authenticated;
revoke all on function public.server_begin_personnel_file(uuid,uuid,uuid,text,text,text,integer,jsonb),
 public.server_commit_personnel_file(uuid,uuid,uuid,jsonb,text,text,text),
 public.server_cancel_personnel_file(uuid,uuid,uuid),public.server_personnel_file_material(uuid,uuid),
 public.server_complete_personnel_download(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.server_begin_personnel_file(uuid,uuid,uuid,text,text,text,integer,jsonb),
 public.server_commit_personnel_file(uuid,uuid,uuid,jsonb,text,text,text),
 public.server_cancel_personnel_file(uuid,uuid,uuid),public.server_personnel_file_material(uuid,uuid),
 public.server_complete_personnel_download(uuid,uuid,uuid,text) to service_role;
comment on table stc_private.personnel_file_material is
 'Cabecera autenticada y sobres RSA-OAEP. Sin AES en claro, originales, privadas ni contraseñas.';
notify pgrst,'reload schema';
commit;
