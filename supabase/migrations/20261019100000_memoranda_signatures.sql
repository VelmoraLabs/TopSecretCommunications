-- Requiere las migraciones de acceso y grupos. Ejecutar una vez como postgres.
begin;
create table public.stc_signing_keys (
 id uuid primary key, profile_id uuid not null references public.profiles(id),
 label text not null check(length(label) between 1 and 80 and label !~ '[[:cntrl:]]'),
 public_base64 text not null check(length(public_base64) between 300 and 2048),
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(id,profile_id), unique(profile_id,fingerprint)
);
create index stc_signing_keys_profile_idx on public.stc_signing_keys(profile_id,created_at desc);
create table public.stc_documents (
 id uuid primary key, title text not null check(length(btrim(title)) between 1 and 160 and title !~ '[[:cntrl:]]'),
 category text not null check(category in ('memorandum','expediente','nota','especial','acuerdo')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.stc_document_versions (
 id uuid primary key, document_id uuid not null references public.stc_documents(id),
 version_number integer not null check(version_number>0),
 filename text not null check(length(filename) between 1 and 180 and filename !~ '[[:cntrl:]/\\]'),
 media_type text not null check(length(media_type) between 1 and 120 and media_type !~ '[[:cntrl:]]'),
 size integer not null check(size between 0 and 5242880), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'staging' check(state in ('staging','ready','failed')),
 created_at timestamptz not null default now(), ready_at timestamptz,
 unique(document_id,version_number)
);
create table public.stc_document_recipients (
 document_id uuid not null references public.stc_documents(id),
 profile_id uuid not null references public.profiles(id), can_sign boolean not null default false,
 primary key(document_id,profile_id)
);
create index stc_document_recipients_profile_idx on public.stc_document_recipients(profile_id,document_id);
create table public.stc_document_signatures (
 id uuid primary key, version_id uuid not null references public.stc_document_versions(id),
 signer_profile_id uuid not null references public.profiles(id), key_id uuid not null,
 signature_base64 text not null check(length(signature_base64)=344 and signature_base64 ~ '^[A-Za-z0-9+/]+==$'),
 created_at timestamptz not null default now(), unique(version_id,signer_profile_id),
 foreign key(key_id,signer_profile_id) references public.stc_signing_keys(id,profile_id)
);
create table public.stc_document_audit (
 id bigint generated always as identity primary key,
 document_id uuid references public.stc_documents(id), actor_profile_id uuid not null references public.profiles(id),
 action text not null check(action in ('key_generated','key_retired','upload_started','upload_ready','upload_failed','document_signed')),
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index stc_document_audit_document_idx on public.stc_document_audit(document_id,created_at desc);

create function stc_private.doc_permission(actor uuid, permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.role_permissions rp on rp.role_code=p.role_code
 where p.id=actor and p.is_active and p.auth_user_id is not null and rp.permission_code=permission);
$$;
create function stc_private.doc_access(actor uuid, target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_permission(actor,'documents.read_assigned') and exists(
 select 1 from public.stc_document_recipients r where r.document_id=target and r.profile_id=actor) and exists(select 1 from public.stc_document_versions v where v.document_id=target and v.state='ready');
$$;
create function stc_private.doc_reader(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_access(stc_private.current_profile_id(),target);
$$;
create function stc_private.doc_summary(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'title',d.title,'category',d.category,'creator_name',p.display_name,
 'created_at',d.created_at,'updated_at',coalesce((select max(s.created_at) from public.stc_document_signatures s where s.version_id=v.id),v.ready_at),
 'version_id',v.id,'version_number',v.version_number,
 'recipient_count',(select count(*) from public.stc_document_recipients r where r.document_id=d.id),
 'signer_count',(select count(*) from public.stc_document_recipients r where r.document_id=d.id and r.can_sign),
 'signature_count',(select count(*) from public.stc_document_signatures s where s.version_id=v.id),
 'signature_state',case when not exists(select 1 from public.stc_document_recipients r where r.document_id=d.id and r.can_sign
   and not exists(select 1 from public.stc_document_signatures s where s.version_id=v.id and s.signer_profile_id=r.profile_id)) then 'signed'
   when exists(select 1 from public.stc_document_signatures s where s.version_id=v.id) then 'partial' else 'pending' end,
 'can_sign',stc_private.doc_permission(stc_private.current_profile_id(),'documents.sign') and exists(
   select 1 from public.stc_document_recipients r where r.document_id=d.id and r.profile_id=stc_private.current_profile_id() and r.can_sign)
   and not exists(select 1 from public.stc_document_signatures s where s.version_id=v.id and s.signer_profile_id=stc_private.current_profile_id())
 ) from public.stc_documents d join public.profiles p on p.id=d.created_by
 join lateral(select * from public.stc_document_versions x where x.document_id=d.id and x.state='ready' order by version_number desc limit 1) v on true
 where d.id=target and stc_private.doc_reader(d.id);
$$;
create function public.list_stc_documents(p_search text default '',p_category text default 'all',p_state text default 'all',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.read_assigned') then raise exception 'Acceso denegado.' using errcode='PD403'; end if;
 if p_search is null or length(p_search)>80 or p_category is null or p_category not in ('all','memorandum','expediente','nota','especial','acuerdo')
 or p_state is null or p_state not in ('all','pending','signed') or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000
 then raise exception 'Consulta inválida.' using errcode='PD422'; end if;
 return(with visible as(select stc_private.doc_summary(id) as item from public.stc_documents where stc_private.doc_reader(id)),
 available as(select item from visible where item is not null), filtered as(select item from available
 where (p_category='all' or item->>'category'=p_category) and position(lower(btrim(p_search)) in lower(item->>'title'))>0
 and (p_state='all' or (p_state='signed')=(item->>'signature_state'='signed'))),
 page as(select item from filtered order by item->>'updated_at' desc,item->>'id' limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(item order by item->>'updated_at' desc,item->>'id') from page),'[]'::jsonb),
 'total',(select count(*) from filtered),'signed_total',(select count(*) from available where item->>'signature_state'='signed'),'pending_total',(select count(*) from available where item->>'signature_state'<>'signed'),'limit',p_limit,'offset',p_offset,'category_counts',
 (select jsonb_object_agg(c,(select count(*) from available where item->>'category'=c)) from unnest(array['memorandum','expediente','nota','especial','acuerdo']) c)));
end; $$;
create function public.get_stc_document(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare summary jsonb; v_version_id uuid;
begin
 summary:=stc_private.doc_summary(p_document_id);
 if summary is null then raise exception 'Documento no disponible.' using errcode='PD404'; end if;
 v_version_id:=(summary->>'version_id')::uuid;
 return jsonb_build_object('document',summary,'version',(select jsonb_build_object('id',v.id,'version_number',v.version_number,
 'filename',v.filename,'media_type',v.media_type,'size',v.size,'sha256',v.sha256) from public.stc_document_versions v where v.id=v_version_id),
 'participants',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'email',p.email,'can_sign',r.can_sign,'is_active',p.is_active)
 order by r.can_sign desc,p.display_name,p.id) from public.stc_document_recipients r join public.profiles p on p.id=r.profile_id where r.document_id=p_document_id),'[]'::jsonb),
 'signatures',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'signer_id',s.signer_profile_id,'signer_name',p.display_name,
 'key_id',k.id,'public_base64',k.public_base64,'fingerprint',k.fingerprint,'key_is_active',k.is_active,
 'signature_base64',s.signature_base64,'created_at',s.created_at) order by s.created_at,s.id)
 from public.stc_document_signatures s join public.stc_signing_keys k on k.id=s.key_id join public.profiles p on p.id=s.signer_profile_id
 where s.version_id=v_version_id),'[]'::jsonb));
end; $$;
create function public.list_document_candidates(p_search text default '',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.create') then raise exception 'Sin permiso.' using errcode='PD403'; end if;
 if p_search is null or length(p_search)>80 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000
 then raise exception 'Consulta inválida.' using errcode='PD422'; end if;
 return(with eligible as(select p.* from public.profiles p where p.is_active and (position(lower(btrim(p_search)) in lower(p.display_name))>0 or position(lower(btrim(p_search)) in p.email)>0)),
 page as(select * from eligible order by display_name,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'email',p.email,'role_code',p.role_code,
 'can_sign',exists(select 1 from public.role_permissions rp where rp.role_code=p.role_code and rp.permission_code='documents.sign')) order by p.display_name,p.id) from page p),'[]'::jsonb),
 'total',(select count(*) from eligible),'limit',p_limit,'offset',p_offset));
end; $$;
create function public.list_own_signing_keys()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if stc_private.current_profile_id() is null then raise exception 'Sin acceso.' using errcode='PD403'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'label',k.label,'public_base64',k.public_base64,
 'fingerprint',k.fingerprint,'is_active',k.is_active,'created_at',k.created_at) order by k.created_at desc,k.id)
 from public.stc_signing_keys k where k.profile_id=stc_private.current_profile_id()),'[]'::jsonb));
end; $$;
create function public.retire_signing_key(p_key_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if stc_private.current_profile_id() is null then raise exception 'Sin acceso.' using errcode='PD403'; end if;
 update public.stc_signing_keys set is_active=false where id=p_key_id and profile_id=stc_private.current_profile_id() and is_active;
 if not found then raise exception 'Clave no disponible.' using errcode='PD404'; end if;
 insert into public.stc_document_audit(actor_profile_id,action,details) values(stc_private.current_profile_id(),'key_retired',jsonb_build_object('key_id',p_key_id));
end; $$;

-- Estas funciones NO son ejecutables con JWT de usuario. Solo el backend puede confirmar hechos criptográficos.
create function public.server_register_signing_key(p_actor uuid,p_key_id uuid,p_label text,p_public_base64 text,p_fingerprint text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.sign') then raise exception 'Sin permiso de firma.' using errcode='PD403'; end if;
 if (select count(*) from public.stc_signing_keys where profile_id=p_actor and is_active)>=10 then raise exception 'Máximo de claves activas.' using errcode='PD409'; end if;
 insert into public.stc_signing_keys(id,profile_id,label,public_base64,fingerprint) values(p_key_id,p_actor,p_label,p_public_base64,p_fingerprint);
 insert into public.stc_document_audit(actor_profile_id,action,details) values(p_actor,'key_generated',jsonb_build_object('key_id',p_key_id,'fingerprint',p_fingerprint));
end; $$;
create function public.server_begin_memorandum(p_actor uuid,p_document_id uuid,p_version_id uuid,p_title text,p_filename text,p_media_type text,p_size integer,p_sha256 text,p_recipients jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; target uuid; signers integer:=0;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.create') then raise exception 'Sin permiso.' using errcode='PD403'; end if;
 if jsonb_typeof(p_recipients) is distinct from 'array' then raise exception 'Destinatarios inválidos.' using errcode='PD422'; end if;
 if jsonb_array_length(p_recipients) not between 1 and 255 then raise exception 'Cantidad inválida.' using errcode='PD422'; end if;
 insert into public.stc_documents(id,title,category,created_by) values(p_document_id,p_title,'memorandum',p_actor);
 insert into public.stc_document_versions(id,document_id,version_number,filename,media_type,size,sha256) values(p_version_id,p_document_id,1,p_filename,p_media_type,p_size,p_sha256);
 for item in select value from jsonb_array_elements(p_recipients) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'profile_id') is distinct from 'string'
  or jsonb_typeof(item->'can_sign') is distinct from 'boolean' or (select count(*) from jsonb_object_keys(item))<>2 then raise exception 'Destinatario inválido.' using errcode='PD422'; end if;
  begin target:=(item->>'profile_id')::uuid; exception when invalid_text_representation then raise exception 'Perfil inválido.' using errcode='PD422'; end;
  if not exists(select 1 from public.profiles where id=target and is_active) or exists(select 1 from public.stc_document_recipients where document_id=p_document_id and profile_id=target)
  then raise exception 'Perfil inactivo o duplicado.' using errcode='PD422'; end if;
  if (item->>'can_sign')::boolean then
   if not exists(select 1 from public.profiles p join public.role_permissions rp on rp.role_code=p.role_code where p.id=target and rp.permission_code='documents.sign')
   then raise exception 'Firmante sin permiso.' using errcode='PD422'; end if;
   signers:=signers+1;
  end if;
  insert into public.stc_document_recipients values(p_document_id,target,(item->>'can_sign')::boolean);
 end loop;
 if signers=0 then raise exception 'Designa un firmante.' using errcode='PD422'; end if;
 insert into public.stc_document_recipients values(p_document_id,p_actor,false) on conflict do nothing;
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details) values(p_document_id,p_actor,'upload_started',jsonb_build_object('version_id',p_version_id));
end; $$;
create function public.server_complete_memorandum(p_actor uuid,p_document_id uuid,p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.create') then raise exception 'Sin permiso.' using errcode='PD403'; end if;
 if not exists(select 1 from public.stc_documents where id=p_document_id and created_by=p_actor) then raise exception 'Documento no disponible.' using errcode='PD404'; end if;
 if exists(select 1 from public.stc_document_versions where id=p_version_id and document_id=p_document_id and state='ready') then return; end if;
 update public.stc_document_versions set state='ready',ready_at=statement_timestamp() where id=p_version_id and document_id=p_document_id and state='staging';
 if not found then raise exception 'Versión no disponible.' using errcode='PD409'; end if;
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details) values(p_document_id,p_actor,'upload_ready',jsonb_build_object('version_id',p_version_id));
end; $$;
create function public.server_abort_memorandum(p_actor uuid,p_document_id uuid,p_version_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not exists(select 1 from public.stc_documents where id=p_document_id and created_by=p_actor) then return false; end if;
 update public.stc_document_versions set state='failed' where id=p_version_id and document_id=p_document_id and state='staging';
 if not found then return false; end if;
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details) values(p_document_id,p_actor,'upload_failed',jsonb_build_object('version_id',p_version_id));
 return true;
end; $$;
create function public.server_commit_document_signature(p_actor uuid,p_document_id uuid,p_version_id uuid,p_key_id uuid,p_signature_id uuid,p_sha256 text,p_signature_base64 text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_access(p_actor,p_document_id) or not stc_private.doc_permission(p_actor,'documents.sign')
 or not exists(select 1 from public.stc_document_recipients where document_id=p_document_id and profile_id=p_actor and can_sign)
 then raise exception 'Sin permiso de firma sobre el documento.' using errcode='PD403'; end if;
 if not exists(select 1 from public.stc_signing_keys where id=p_key_id and profile_id=p_actor and is_active)
 or not exists(select 1 from public.stc_document_versions where id=p_version_id and document_id=p_document_id and state='ready' and sha256=p_sha256)
 or exists(select 1 from public.stc_document_signatures where version_id=p_version_id and signer_profile_id=p_actor)
 then raise exception 'Versión, firma o clave cambiaron.' using errcode='PD409'; end if;
 insert into public.stc_document_signatures values(p_signature_id,p_version_id,p_actor,p_key_id,p_signature_base64,statement_timestamp());
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details) values(p_document_id,p_actor,'document_signed',jsonb_build_object('version_id',p_version_id,'signature_id',p_signature_id,'key_id',p_key_id));
end; $$;

-- Lecturas con RLS y escrituras exclusivamente mediante las RPC autorizadas.
do $$ declare t text; begin
 foreach t in array array['stc_signing_keys','stc_documents','stc_document_versions','stc_document_recipients','stc_document_signatures','stc_document_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end; $$;
revoke all on sequence public.stc_document_audit_id_seq from public,anon,authenticated,service_role;
create policy stc_keys_read on public.stc_signing_keys for select to authenticated using(profile_id=stc_private.current_profile_id());
create policy stc_documents_read on public.stc_documents for select to authenticated using(stc_private.doc_reader(id));
create policy stc_versions_read on public.stc_document_versions for select to authenticated using(state='ready' and stc_private.doc_reader(document_id));
create policy stc_recipients_read on public.stc_document_recipients for select to authenticated using(stc_private.doc_reader(document_id));
create policy stc_signatures_read on public.stc_document_signatures for select to authenticated using(exists(select 1 from public.stc_document_versions v where v.id=version_id and stc_private.doc_reader(v.document_id)));
create policy stc_document_audit_read on public.stc_document_audit for select to authenticated using(stc_private.doc_reader(document_id) or (document_id is null and actor_profile_id=stc_private.current_profile_id()));
revoke all on function stc_private.doc_permission(uuid,text),stc_private.doc_access(uuid,uuid),stc_private.doc_reader(uuid),stc_private.doc_summary(uuid)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function stc_private.doc_reader(uuid),stc_private.current_profile_id() to authenticated;
revoke all on function public.list_stc_documents(text,text,text,integer,integer),public.get_stc_document(uuid),public.list_document_candidates(text,integer,integer),public.list_own_signing_keys(),public.retire_signing_key(uuid)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.list_stc_documents(text,text,text,integer,integer),public.get_stc_document(uuid),public.list_document_candidates(text,integer,integer),public.list_own_signing_keys(),public.retire_signing_key(uuid) to authenticated;
revoke all on function public.server_register_signing_key(uuid,uuid,text,text,text),public.server_begin_memorandum(uuid,uuid,uuid,text,text,text,integer,text,jsonb),public.server_complete_memorandum(uuid,uuid,uuid),public.server_abort_memorandum(uuid,uuid,uuid),public.server_commit_document_signature(uuid,uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.server_register_signing_key(uuid,uuid,text,text,text),public.server_begin_memorandum(uuid,uuid,uuid,text,text,text,integer,text,jsonb),public.server_complete_memorandum(uuid,uuid,uuid),public.server_abort_memorandum(uuid,uuid,uuid),public.server_commit_document_signature(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
grant usage on schema public to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('stc-documents','stc-documents',false,5242880) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='stc-documents' and not public and file_size_limit=5242880)
 then raise exception 'El bucket stc-documents ya existe con otra configuración. Revisa antes de continuar.'; end if;
end; $$;
-- Restrictivas: una política amplia anterior de otro bucket no abre este contenido.
create policy stc_documents_storage_select on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'stc-documents');
create policy stc_documents_storage_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'stc-documents');
create policy stc_documents_storage_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'stc-documents') with check(bucket_id<>'stc-documents');
create policy stc_documents_storage_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'stc-documents');
comment on table public.stc_document_recipients is 'Asignaciones por documento. No dependen de cambios posteriores en grupos.';
comment on table public.stc_signing_keys is 'Solo claves públicas inmutables; nunca claves privadas ni contraseñas.';
comment on table public.stc_document_signatures is 'Confirmadas por el backend después de comprobar RSA-PSS; vinculadas a versión y clave originales.';
notify pgrst,'reload schema';
commit;
