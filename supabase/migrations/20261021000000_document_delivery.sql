-- Requiere acceso, grupos y memorándums. Ejecutar una sola vez como postgres.
-- No reinterpreta documentos anteriores como documentos emitidos o enviados.
begin;

insert into public.permissions(code,description)
values ('documents.approve','Aprobar institucionalmente como Embajador un documento asignado');
insert into public.role_permissions(role_code,permission_code) values
 ('admin','documents.sign'),('staff','documents.sign'),('ambassador','documents.approve');

alter table public.stc_documents
 add column delivery_state text not null default 'legacy_shared'
   check(delivery_state in ('legacy_shared','draft','review','sent')),
 add column approver_profile_id uuid references public.profiles(id),
 add column review_requested_at timestamptz,
 add column sent_at timestamptz;
alter table public.stc_documents alter column delivery_state set default 'draft';
alter table public.stc_document_signatures
 add column purpose text not null default 'legacy' check(purpose in ('legacy','issuer','approval'));
alter table public.stc_document_signatures alter column purpose drop default;
alter table public.stc_document_audit drop constraint stc_document_audit_action_check;
alter table public.stc_document_audit add constraint stc_document_audit_action_check
 check(action in ('key_generated','key_retired','upload_started','upload_ready','upload_failed',
                 'document_signed','review_requested','document_sent'));

create function stc_private.doc_is_approver(actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_permission(actor,'documents.approve')
 and stc_private.doc_permission(actor,'documents.sign')
 and exists(select 1 from public.profiles where id=actor and role_code='ambassador');
$$;

create function stc_private.doc_has_signature(target uuid, actor uuid, expected_purpose text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.stc_document_signatures s
 join public.stc_document_versions v on v.id=s.version_id
 where v.document_id=target and v.state='ready' and s.signer_profile_id=actor
 and s.purpose=expected_purpose
 and v.id=(select x.id from public.stc_document_versions x where x.document_id=target
           and x.state='ready' order by x.version_number desc limit 1));
$$;

create or replace function stc_private.doc_access(actor uuid,target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_permission(actor,'documents.read_assigned') and exists(
  select 1 from public.stc_documents d where d.id=target and (
   (d.delivery_state<>'legacy_shared' and d.created_by=actor)
   or (d.delivery_state in ('sent','legacy_shared') and exists(
       select 1 from public.stc_document_recipients r where r.document_id=d.id and r.profile_id=actor))
   or (d.delivery_state='review' and d.approver_profile_id=actor and stc_private.doc_is_approver(actor))
   or (d.delivery_state='sent' and d.approver_profile_id=actor)
  )
 ) and exists(select 1 from public.stc_document_versions v where v.document_id=target and v.state='ready');
$$;

create function stc_private.doc_signing_purpose(actor uuid,target uuid)
returns text language sql stable security definer set search_path='' as $$
 select case
  when d.created_by=actor and stc_private.doc_permission(actor,'documents.create')
       and (d.approver_profile_id is distinct from actor or stc_private.doc_is_approver(actor))
       and not stc_private.doc_has_signature(d.id,actor,'issuer') then 'issuer'
  when d.approver_profile_id=actor and d.created_by<>actor and d.delivery_state='review'
       and stc_private.doc_is_approver(actor) and stc_private.doc_has_signature(d.id,d.created_by,'issuer')
       and not stc_private.doc_has_signature(d.id,actor,'approval') then 'approval'
  else null end
 from public.stc_documents d where d.id=target and d.delivery_state in ('draft','review')
 and stc_private.doc_access(actor,target) and stc_private.doc_permission(actor,'documents.sign');
$$;

create function stc_private.doc_signatures_complete(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_has_signature(d.id,d.created_by,'issuer') and
 (d.approver_profile_id is null
  or d.approver_profile_id=d.created_by
  or stc_private.doc_has_signature(d.id,d.approver_profile_id,'approval'))
 from public.stc_documents d where d.id=target;
$$;

create or replace function stc_private.doc_summary(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'id',d.id,'title',d.title,'category',d.category,'creator_name',p.display_name,'issuer_id',case when d.delivery_state='legacy_shared' then null else d.created_by end,
  'approver_id',d.approver_profile_id,'approver_name',a.display_name,'sent_at',d.sent_at,
  'review_requested_at',d.review_requested_at,'created_at',d.created_at,
  'updated_at',greatest(v.ready_at,d.review_requested_at,d.sent_at,
     (select max(s.created_at) from public.stc_document_signatures s where s.version_id=v.id)),
  'version_id',v.id,'version_number',v.version_number,
  'recipient_count',(select count(*) from public.stc_document_recipients r where r.document_id=d.id),
  'signer_count',case when d.delivery_state='legacy_shared' then
      (select count(*) from public.stc_document_recipients r where r.document_id=d.id and r.can_sign)
      when d.approver_profile_id is not null and d.approver_profile_id<>d.created_by then 2 else 1 end,
  'signature_count',(select count(*) from public.stc_document_signatures s where s.version_id=v.id),
  'signature_state',case
    when d.delivery_state='legacy_shared' and not exists(
      select 1 from public.stc_document_recipients r where r.document_id=d.id and r.can_sign and not exists(
        select 1 from public.stc_document_signatures s where s.version_id=v.id and s.signer_profile_id=r.profile_id)) then 'signed'
    when d.delivery_state<>'legacy_shared' and stc_private.doc_signatures_complete(d.id) then 'signed'
    when exists(select 1 from public.stc_document_signatures s where s.version_id=v.id) then 'partial' else 'pending' end,
  'workflow_state',case when d.delivery_state='legacy_shared' then 'legacy_shared'
    when d.delivery_state='sent' then 'sent'
    when stc_private.doc_signatures_complete(d.id) then 'ready_to_send'
    when d.delivery_state='review' then 'pending_approval' else 'draft' end,
  'signing_purpose',stc_private.doc_signing_purpose(stc_private.current_profile_id(),d.id),
  'can_sign',stc_private.doc_signing_purpose(stc_private.current_profile_id(),d.id) is not null,
  'can_request_approval',d.created_by=stc_private.current_profile_id() and d.delivery_state='draft'
    and d.approver_profile_id is not null and d.approver_profile_id<>d.created_by
    and stc_private.doc_permission(d.created_by,'documents.create') and stc_private.doc_permission(d.created_by,'documents.sign')
    and stc_private.doc_has_signature(d.id,d.created_by,'issuer') and stc_private.doc_is_approver(d.approver_profile_id),
  'can_send',d.created_by=stc_private.current_profile_id() and d.delivery_state in ('draft','review')
    and stc_private.doc_permission(d.created_by,'documents.create') and stc_private.doc_permission(d.created_by,'documents.sign')
    and stc_private.doc_signatures_complete(d.id)
    and (d.approver_profile_id is null or stc_private.doc_is_approver(d.approver_profile_id))
    and not exists(select 1 from public.stc_document_recipients r join public.profiles t on t.id=r.profile_id
       where r.document_id=d.id and not t.is_active)
 ) from public.stc_documents d join public.profiles p on p.id=d.created_by
 left join public.profiles a on a.id=d.approver_profile_id
 join lateral(select * from public.stc_document_versions x where x.document_id=d.id and x.state='ready'
              order by version_number desc limit 1) v on true
 where d.id=target and stc_private.doc_reader(d.id);
$$;

create or replace function public.get_stc_document(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare summary jsonb; v_version_id uuid;
begin
 summary:=stc_private.doc_summary(p_document_id);
 if summary is null then raise exception 'Documento no disponible.' using errcode='PD404'; end if;
 v_version_id:=(summary->>'version_id')::uuid;
 return jsonb_build_object('document',summary,'version',(
   select jsonb_build_object('id',v.id,'version_number',v.version_number,'filename',v.filename,
   'media_type',v.media_type,'size',v.size,'sha256',v.sha256) from public.stc_document_versions v where v.id=v_version_id),
 'participants',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'display_name',p.display_name,'email',p.email,'is_active',p.is_active,
   'is_issuer',d.delivery_state<>'legacy_shared' and p.id=d.created_by,
   'is_approver',coalesce(p.id=d.approver_profile_id,false),'is_recipient',r.profile_id is not null,
   'can_sign',case when d.delivery_state='legacy_shared' then coalesce(r.can_sign,false)
                  else p.id=d.created_by or coalesce(p.id=d.approver_profile_id,false) end)
   order by (p.id=d.created_by) desc,p.display_name,p.id)
   from public.stc_documents d join public.profiles p on
       p.id=d.created_by or p.id=d.approver_profile_id or exists(
         select 1 from public.stc_document_recipients x where x.document_id=d.id and x.profile_id=p.id)
   left join public.stc_document_recipients r on r.document_id=d.id and r.profile_id=p.id
   where d.id=p_document_id),'[]'::jsonb),
 'signatures',coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'signer_id',s.signer_profile_id,'signer_name',p.display_name,'purpose',s.purpose,
   'key_id',k.id,'public_base64',k.public_base64,'fingerprint',k.fingerprint,'key_is_active',k.is_active,
   'signature_base64',s.signature_base64,'created_at',s.created_at) order by s.created_at,s.id)
   from public.stc_document_signatures s join public.stc_signing_keys k on k.id=s.key_id
   join public.profiles p on p.id=s.signer_profile_id where s.version_id=v_version_id),'[]'::jsonb));
end; $$;

create or replace function public.list_stc_documents(p_search text default '',p_category text default 'all',p_state text default 'all',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.read_assigned') then raise exception 'Acceso denegado.' using errcode='PD403'; end if;
 if p_search is null or length(p_search)>80 or p_category is null or p_category not in ('all','memorandum','expediente','nota','especial','acuerdo')
 or p_state is null or p_state not in ('all','pending','signed') or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000
 then raise exception 'Consulta inválida.' using errcode='PD422'; end if;
 return(with visible as(select stc_private.doc_summary(id) as item from public.stc_documents where stc_private.doc_reader(id)),
 available as(select item from visible where item is not null), filtered as(select item from available
 where (p_category='all' or item->>'category'=p_category) and position(lower(btrim(p_search)) in lower(item->>'title'))>0
 and (p_state='all' or (p_state='signed' and item->>'signature_state'='signed') or (p_state='pending' and item->>'workflow_state' in ('draft','pending_approval','ready_to_send')))),
 page as(select item from filtered order by item->>'updated_at' desc,item->>'id' limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(item order by item->>'updated_at' desc,item->>'id') from page),'[]'::jsonb),
 'total',(select count(*) from filtered),'signed_total',(select count(*) from available where item->>'signature_state'='signed'),'pending_total',(select count(*) from available where item->>'workflow_state' in ('draft','pending_approval','ready_to_send')),'limit',p_limit,'offset',p_offset,'category_counts',
 (select jsonb_object_agg(c,(select count(*) from available where item->>'category'=c)) from unnest(array['memorandum','expediente','nota','especial','acuerdo']) c)));
end; $$;

-- Directorio mínimo para elegir al aprobador. El rol general se revalida en cada transición.
create function public.list_document_approvers(p_search text default '',p_limit integer default 10,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not stc_private.has_permission('documents.create') then raise exception 'Sin permiso.' using errcode='PD403'; end if;
 if p_search is null or length(p_search)>80 or p_limit is null or p_limit not between 1 and 100
 or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Consulta inválida.' using errcode='PD422'; end if;
 return(with eligible as(select p.* from public.profiles p where stc_private.doc_is_approver(p.id)
   and (position(lower(btrim(p_search)) in lower(p.display_name))>0 or position(lower(btrim(p_search)) in p.email)>0)),
 page as(select * from eligible order by display_name,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'display_name',p.display_name,'email',p.email,'role_code',p.role_code,'can_sign',true)
   order by p.display_name,p.id) from page p),'[]'::jsonb),
   'total',(select count(*) from eligible),'limit',p_limit,'offset',p_offset));
end; $$;

-- Sustituye la antigua creación con firmantes libres; el emisor es la identidad autenticada.
drop function public.server_begin_memorandum(uuid,uuid,uuid,text,text,text,integer,text,jsonb);
create function public.server_begin_memorandum(
 p_actor uuid,p_document_id uuid,p_version_id uuid,p_title text,p_filename text,p_media_type text,
 p_size integer,p_sha256 text,p_recipients jsonb,p_approver uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; target uuid;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.doc_permission(p_actor,'documents.create') or not stc_private.doc_permission(p_actor,'documents.sign')
 then raise exception 'Sin permiso de emisión.' using errcode='PD403'; end if;
 if p_approver is not null and not stc_private.doc_is_approver(p_approver)
 then raise exception 'Selecciona un Embajador activo y vinculado.' using errcode='PD422'; end if;
 if jsonb_typeof(p_recipients) is distinct from 'array' then raise exception 'Destinatarios inválidos.' using errcode='PD422'; end if;
 if jsonb_array_length(p_recipients) not between 1 and 255 then raise exception 'Cantidad inválida.' using errcode='PD422'; end if;
 insert into public.stc_documents(id,title,category,created_by,approver_profile_id,delivery_state)
 values(p_document_id,p_title,'memorandum',p_actor,p_approver,'draft');
 insert into public.stc_document_versions(id,document_id,version_number,filename,media_type,size,sha256)
 values(p_version_id,p_document_id,1,p_filename,p_media_type,p_size,p_sha256);
 for item in select value from jsonb_array_elements(p_recipients) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'profile_id') is distinct from 'string'
  or (select count(*) from jsonb_object_keys(item))<>1 then raise exception 'Destinatario inválido.' using errcode='PD422'; end if;
  begin target:=(item->>'profile_id')::uuid;
  exception when invalid_text_representation then raise exception 'Perfil inválido.' using errcode='PD422'; end;
  if target=p_actor or not exists(select 1 from public.profiles where id=target and is_active)
  or exists(select 1 from public.stc_document_recipients where document_id=p_document_id and profile_id=target)
  then raise exception 'Perfil inactivo, propio o duplicado.' using errcode='PD422'; end if;
  insert into public.stc_document_recipients(document_id,profile_id,can_sign) values(p_document_id,target,false);
 end loop;
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details)
 values(p_document_id,p_actor,'upload_started',jsonb_build_object('version_id',p_version_id,'approver_id',p_approver));
end; $$;

create or replace function public.server_commit_document_signature(
 p_actor uuid,p_document_id uuid,p_version_id uuid,p_key_id uuid,p_signature_id uuid,p_sha256 text,p_signature_base64 text)
returns void language plpgsql security definer set search_path='' as $$
declare signature_purpose text;
begin
 perform pg_advisory_xact_lock(20261016,1);
 signature_purpose:=stc_private.doc_signing_purpose(p_actor,p_document_id);
 if signature_purpose is null then raise exception 'Sin permiso de firma en esta etapa.' using errcode='PD403'; end if;
 if not exists(select 1 from public.stc_signing_keys where id=p_key_id and profile_id=p_actor and is_active)
 or not exists(select 1 from public.stc_document_versions where id=p_version_id and document_id=p_document_id and state='ready' and sha256=p_sha256
    and id=(select id from public.stc_document_versions where document_id=p_document_id and state='ready' order by version_number desc limit 1))
 or exists(select 1 from public.stc_document_signatures where version_id=p_version_id and signer_profile_id=p_actor)
 then raise exception 'Versión, firma o clave cambiaron.' using errcode='PD409'; end if;
 insert into public.stc_document_signatures(id,version_id,signer_profile_id,key_id,signature_base64,purpose,created_at)
 values(p_signature_id,p_version_id,p_actor,p_key_id,p_signature_base64,signature_purpose,statement_timestamp());
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details)
 values(p_document_id,p_actor,'document_signed',jsonb_build_object('version_id',p_version_id,'signature_id',p_signature_id,'key_id',p_key_id,'purpose',signature_purpose));
end; $$;

-- El backend verifica criptografía antes de invocar estas RPC. El navegador no puede saltarse ese paso.
create function public.server_request_memorandum_review(p_actor uuid,p_document_id uuid,p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.stc_documents%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into d from public.stc_documents where id=p_document_id;
 if not found or d.created_by<>p_actor or not stc_private.doc_access(p_actor,p_document_id)
 then raise exception 'Documento no disponible.' using errcode='PD404'; end if;
 if not stc_private.doc_permission(p_actor,'documents.create') or not stc_private.doc_permission(p_actor,'documents.sign')
 then raise exception 'Sin permiso.' using errcode='PD403'; end if;
 if d.delivery_state not in ('draft','review') or d.approver_profile_id is null or d.approver_profile_id=p_actor
 or not stc_private.doc_is_approver(d.approver_profile_id)
 or not stc_private.doc_has_signature(d.id,p_actor,'issuer')
 or not exists(select 1 from public.stc_document_versions where id=p_version_id and document_id=d.id and state='ready'
    and id=(select id from public.stc_document_versions where document_id=d.id and state='ready' order by version_number desc limit 1))
 then raise exception 'Firma del emisor, versión o aprobador no válidos.' using errcode='PD409'; end if;
 if d.delivery_state='review' then return; end if;
 update public.stc_documents set delivery_state='review',review_requested_at=statement_timestamp() where id=d.id;
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details)
 values(d.id,p_actor,'review_requested',jsonb_build_object('version_id',p_version_id,'approver_id',d.approver_profile_id));
end; $$;

create function public.server_send_memorandum(p_actor uuid,p_document_id uuid,p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.stc_documents%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 select * into d from public.stc_documents where id=p_document_id;
 if not found or d.created_by<>p_actor or not stc_private.doc_access(p_actor,p_document_id)
 then raise exception 'Documento no disponible.' using errcode='PD404'; end if;
 if not stc_private.doc_permission(p_actor,'documents.create') or not stc_private.doc_permission(p_actor,'documents.sign')
 then raise exception 'Sin permiso.' using errcode='PD403'; end if;
 if d.delivery_state='legacy_shared' or not coalesce(stc_private.doc_signatures_complete(d.id),false)
 or (d.approver_profile_id is not null and not stc_private.doc_is_approver(d.approver_profile_id))
 or exists(select 1 from public.stc_document_recipients r join public.profiles p on p.id=r.profile_id where r.document_id=d.id and not p.is_active)
 or not exists(select 1 from public.stc_document_versions where id=p_version_id and document_id=d.id and state='ready'
    and id=(select id from public.stc_document_versions where document_id=d.id and state='ready' order by version_number desc limit 1))
 then raise exception 'Faltan firmas válidas o cambiaron participantes/versión.' using errcode='PD409'; end if;
 if d.delivery_state='sent' then return; end if;
 update public.stc_documents set delivery_state='sent',sent_at=statement_timestamp() where id=d.id;
 insert into public.stc_document_audit(document_id,actor_profile_id,action,details)
 values(d.id,p_actor,'document_sent',jsonb_build_object('version_id',p_version_id));
end; $$;

revoke all on function stc_private.doc_is_approver(uuid),stc_private.doc_has_signature(uuid,uuid,text),
 stc_private.doc_signing_purpose(uuid,uuid),stc_private.doc_signatures_complete(uuid)
 from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.list_document_approvers(text,integer,integer)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.list_document_approvers(text,integer,integer) to authenticated;
revoke all on function public.server_begin_memorandum(uuid,uuid,uuid,text,text,text,integer,text,jsonb,uuid),
 public.server_request_memorandum_review(uuid,uuid,uuid),public.server_send_memorandum(uuid,uuid,uuid)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.server_begin_memorandum(uuid,uuid,uuid,text,text,text,integer,text,jsonb,uuid),
 public.server_request_memorandum_review(uuid,uuid,uuid),public.server_send_memorandum(uuid,uuid,uuid) to service_role;

comment on column public.stc_documents.delivery_state is 'Estado de entrega, separado del estado técnico de carga y de las firmas.';
comment on column public.stc_document_signatures.purpose is 'Emisión, aprobación o firma anterior sin reinterpretación de autoridad.';
notify pgrst,'reload schema';
commit;
