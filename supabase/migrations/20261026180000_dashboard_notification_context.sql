-- Requiere las ocho migraciones anteriores. Ejecutar una vez como postgres.
-- Resumen documental y contexto histórico de avisos; no modifica criptografía ni recuperaciones.
begin;

-- Los nombres se guardan fuera de las tablas publicadas en Realtime.
create table stc_private.notification_context (
 notification_id uuid primary key references public.stc_notifications(id) on delete cascade,
 subject text, group_name text, requester_name text,
 backfilled boolean not null default false,
 captured_at timestamptz not null default statement_timestamp()
);
alter table stc_private.notification_context enable row level security;
revoke all on stc_private.notification_context from public,anon,authenticated,service_role,supabase_auth_admin;

create function stc_private.capture_notification_context(p_id uuid,p_backfilled boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare n public.stc_notifications%rowtype; subject text; group_name text; requester_name text;
begin
 select * into n from public.stc_notifications where id=p_id;
 if not found then return; end if;
 case n.target_kind
 when 'group' then
  select g.name into subject from public.stc_groups g where g.id=n.target_id;
  if subject is null and n.source ~ '^group:[0-9]+$' then
   select g.name into subject from public.stc_group_audit a join public.stc_groups g on g.id=a.group_id where n.source='group:'||a.id;
  end if;
 when 'document' then select d.title into subject from public.stc_documents d where d.id=n.target_id;
 when 'note' then select d.title,d.group_name into subject,group_name from public.stc_group_notes d where d.id=n.target_id;
 when 'recovery' then
  select d.title,d.group_name,r.requester_name into subject,group_name,requester_name
  from public.stc_note_recoveries r join public.stc_group_notes d on d.id=r.note_id where r.id=n.target_id;
 when 'keys' then
  select k.label into subject from public.stc_encryption_keys k where k.id=n.target_id and k.profile_id=n.recipient_id;
  if subject is null and n.source ~ '^signing:[0-9]+$' then
   select k.label into subject from public.stc_document_audit a join public.stc_signing_keys k on k.id=(a.details->>'key_id')::uuid
   where n.source='signing:'||a.id and k.profile_id=n.recipient_id;
  end if;
 when 'account' then select r.name into subject from public.profiles p join public.roles r on r.code=p.role_code where p.id=n.recipient_id;
 else null;
 end case;
 insert into stc_private.notification_context(notification_id,subject,group_name,requester_name,backfilled)
 values(n.id,subject,group_name,requester_name,p_backfilled) on conflict(notification_id) do nothing;
end; $$;
create function stc_private.capture_notification_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform stc_private.capture_notification_context(new.id);return new;end; $$;
create trigger stc_capture_notification after insert on public.stc_notifications for each row execute function stc_private.capture_notification_event();

-- En avisos anteriores solo se puede recuperar el nombre que existe al instalar.
select stc_private.capture_notification_context(id,true) from public.stc_notifications;

create function stc_private.notification_item(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n public.stc_notifications%rowtype; c stc_private.notification_context%rowtype;
 title text; body text; visible boolean:=false;
begin
 select * into n from public.stc_notifications where id=p_id and recipient_id=stc_private.current_profile_id();
 if not found then return null; end if;
 select * into c from stc_private.notification_context where notification_id=n.id;
 title:=n.title;body:=n.body;
 -- Los avisos de pertenencia son recibos de la propia cuenta, incluso tras una baja.
 -- Los nombres documentales se enmascaran si ya no hay autorización actual.
 visible:=case n.target_kind
 when 'group' then stc_private.has_permission('groups.read')
 when 'document' then stc_private.doc_access(n.recipient_id,n.target_id)
 when 'note' then stc_private.group_note_access(n.recipient_id,n.target_id)
 when 'recovery' then stc_private.recovery_access(n.recipient_id,n.target_id)
 when 'keys' then true when 'account' then true else false end;
 if visible and c.subject is not null then
  case n.event_type
  when 'group_added' then title:='Te agregaron al grupo «'||c.subject||'»';
  when 'group_role_changed' then title:='Cambió tu papel en «'||c.subject||'»';
  when 'group_removed' then title:='Terminó tu pertenencia a «'||c.subject||'»';
  when 'group_archived' then title:='Se archivó el grupo «'||c.subject||'»';
  when 'group_reactivated' then title:='Se reactivó el grupo «'||c.subject||'»';
  when 'document_shared' then title:='Te compartieron «'||c.subject||'»';
  when 'approval_requested' then title:='Aprobación solicitada: «'||c.subject||'»';
  when 'document_approved' then title:='Documento aprobado: «'||c.subject||'»';
  when 'note_shared' then title:='Nueva nota especial: «'||c.subject||'»';
  when 'recovery_requested' then title:='Solicitud de recuperación de «'||c.subject||'»';
  when 'recovery_ready' then title:='Recuperación lista: «'||c.subject||'»';
  when 'recovery_completed' then title:='Recuperación completada: «'||c.subject||'»';
  when 'recovery_cancelled' then title:='Recuperación cancelada: «'||c.subject||'»';
  when 'recovery_rejected' then title:='Recuperación rechazada: «'||c.subject||'»';
  when 'recovery_expired' then title:='Recuperación vencida: «'||c.subject||'»';
  when 'profile_changed' then body:='Rol registrado al emitir el aviso: '||c.subject||'. '||n.body;
  when 'encryption_key_activated' then title:='Clave activada: «'||c.subject||'»';
  when 'encryption_key_retired' then title:='Clave retirada: «'||c.subject||'»';
  when 'signing_key_retired' then title:='Clave de firma retirada: «'||c.subject||'»';
  else null;
  end case;
  if c.group_name is not null then body:='Grupo: '||c.group_name||'. '||body;end if;
  if c.requester_name is not null then body:='Solicitante: '||c.requester_name||'. '||body;end if;
 end if;
 return jsonb_build_object('id',n.id,'category',n.category,'event_type',n.event_type,'target_kind',n.target_kind,
 'target_id',n.target_id,'related_id',n.related_id,'title',title,'body',body,'created_at',n.created_at,'read_at',n.read_at);
end; $$;
create or replace function public.list_stc_notifications(
 p_state text default 'all',p_category text default 'all',p_limit integer default 20,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id();
begin
 if actor is null then raise exception 'Perfil no disponible.' using errcode='NT403';end if;
 if p_state is null or p_state not in ('all','unread') or p_category is null or p_category not in ('all','groups','documents','recovery','account')
 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
  raise exception 'Consulta inválida.' using errcode='NT422';
 end if;
 return(with visible as(select id,created_at from public.stc_notifications where recipient_id=actor
 and (p_state='all' or read_at is null) and (p_category='all' or category=p_category)),
 page as(select * from visible order by created_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(stc_private.notification_item(id) order by created_at desc,id desc) from page),'[]'::jsonb),
 'total',(select count(*) from visible),'unread_count',(select count(*) from public.stc_notifications where recipient_id=actor and read_at is null),
 'limit',p_limit,'offset',p_offset,'snapshot_at',statement_timestamp()));
end; $$;

-- Resumen completo autorizado: contar antes de limitar recientes/pendientes.
create function public.stc_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id();
begin
 if actor is null or not stc_private.has_permission('documents.read_assigned') then
  raise exception 'Sin acceso al resumen documental.' using errcode='DA403';
 end if;
 return(with documents as materialized(
  select stc_private.doc_summary(d.id) item from public.stc_documents d where stc_private.doc_reader(d.id)
 ), available as materialized(select item from documents where item is not null),
 notes as materialized(select * from public.stc_group_notes n where n.state='ready' and stc_private.group_note_reader(n.id)),
 preparations as materialized(select * from public.stc_group_notes n where n.state in ('staging','awaiting_backup') and n.created_by=actor and stc_private.group_note_reader(n.id)),
 recoveries as materialized(select r.*,n.title,n.group_name,stc_private.recovery_summary(r.id) item
  from public.stc_note_recoveries r join public.stc_group_notes n on n.id=r.note_id
  where r.state in ('pending','ready') and r.expires_at>statement_timestamp() and stc_private.recovery_reader(r.id)),
 pending_documents as materialized(select item from available where (item->>'can_sign')::boolean or (item->>'can_request_approval')::boolean or (item->>'can_send')::boolean),
 pending_recoveries as materialized(select * from recoveries where (item->>'can_contribute')::boolean or (item->>'can_recover')::boolean),
 recent as (
  select (item->>'id')::uuid id,'document'::text target_kind,(item->>'id')::uuid target_id,null::uuid related_id,item->>'title' title,
  item->>'category' category,case item->>'workflow_state' when 'draft' then 'Borrador' when 'pending_approval' then 'En aprobación' when 'ready_to_send' then 'Listo para enviar' when 'sent' then 'Enviado' else 'Flujo anterior' end status,
  'Documento · '||(item->>'creator_name') subtitle,coalesce((item->>'updated_at')::timestamptz,(item->>'created_at')::timestamptz) occurred_at from available
  union all select id,'note',id,null,title,'especial','Cifrada · acceso conjunto','Nota especial · '||group_name,ready_at from notes
 ), pending as (
  select (item->>'id')::uuid id,'document'::text target_kind,(item->>'id')::uuid target_id,null::uuid related_id,item->>'title' title,item->>'category' category,
  case when (item->>'can_sign')::boolean then 'Firma pendiente' when (item->>'can_request_approval')::boolean then 'Solicitar aprobación' else 'Completar envío' end status,
  'Documento · '||(item->>'creator_name') subtitle,coalesce((item->>'updated_at')::timestamptz,(item->>'created_at')::timestamptz) occurred_at from pending_documents
  union all select id,'recovery',id,note_id,title,'especial',case when (item->>'can_contribute')::boolean then 'Tu aportación está pendiente' else 'Lista para recuperar' end,
  'Recuperación · '||group_name,created_at from pending_recoveries
  union all select id,'note',id,null,title,'especial','Preparación pendiente','Nota especial · '||group_name,created_at from preparations
 ), recent_page as(select * from recent order by occurred_at desc,target_kind,id limit 6),
 pending_page as(select * from pending order by occurred_at desc,target_kind,id limit 6)
 select jsonb_build_object(
 'stats',jsonb_build_object('documents_total',(select count(*) from available)+(select count(*) from notes),
  'notes_total',(select count(*) from notes),'signed_total',(select count(*) from available where item->>'signature_state'='signed'),
  'pending_total',(select count(*) from pending),'pending_documents',(select count(*) from pending_documents),
  'pending_recoveries',(select count(*) from pending_recoveries),'pending_notes',(select count(*) from preparations)),
 'category_counts',(select jsonb_object_agg(code,(select count(*) from available where item->>'category'=code)) from unnest(array['memorandum','expediente','nota','especial','acuerdo']) code),
 'recent',coalesce((select jsonb_agg(to_jsonb(recent_page) order by occurred_at desc,target_kind,id) from recent_page),'[]'::jsonb),
 'pending',coalesce((select jsonb_agg(to_jsonb(pending_page) order by occurred_at desc,target_kind,id) from pending_page),'[]'::jsonb),
 'updated_at',statement_timestamp()));
end; $$;

revoke all on function stc_private.capture_notification_context(uuid,boolean),stc_private.capture_notification_event(),stc_private.notification_item(uuid)
 from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.stc_dashboard() from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.stc_dashboard() to authenticated;
comment on table stc_private.notification_context is 'Nombres asociados al evento, inmutables y fuera de Realtime. API vuelve a comprobar acceso documental. Backfill usa nombres disponibles al instalar.';
notify pgrst,'reload schema';
commit;
