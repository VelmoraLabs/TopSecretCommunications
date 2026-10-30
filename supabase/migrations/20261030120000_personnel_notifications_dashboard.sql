-- Expedientes: avisos transaccionales y resumen autorizado. Aplicar una sola vez
-- DESPUÉS de 20261030000000_personnel_files.sql. Conserva datos y formatos cifrados.
begin;
do $$ begin
 if to_regclass('public.stc_personnel_files') is null
 or to_regprocedure('stc_private.notification_item(uuid)') is null then
  raise exception 'Instala las diez migraciones anteriores antes de este bloque.';
 end if;
end; $$;

alter table public.stc_notifications drop constraint stc_notifications_target_kind_check;
alter table public.stc_notifications add constraint stc_notifications_target_kind_check
 check(target_kind in ('group','document','note','recovery','keys','account','personnel_file'));

create or replace function stc_private.notify_profile(
 p_recipient uuid,p_event text,p_kind text,p_target uuid,p_related uuid,p_source text
) returns void language plpgsql security definer set search_path='' as $$
declare v_title text; v_body text; v_category text;
begin
 case p_event
 when 'group_added' then v_category:='groups';v_title:='Te agregaron a un grupo';v_body:='Consulta tu equipo y el papel que tienes asignado.';
 when 'group_role_changed' then v_category:='groups';v_title:='Cambió tu papel en un grupo';v_body:='Revisa tu asignación actual como responsable o integrante.';
 when 'group_removed' then v_category:='groups';v_title:='Terminó tu pertenencia a un grupo';v_body:='Tu asignación actual cambió. Los destinatarios de documentos anteriores se conservan.';
 when 'group_archived' then v_category:='groups';v_title:='Se archivó uno de tus grupos';v_body:='No se crearán notas nuevas para ese grupo mientras esté archivado.';
 when 'group_reactivated' then v_category:='groups';v_title:='Se reactivó uno de tus grupos';v_body:='El equipo vuelve a estar disponible para operaciones nuevas.';
 when 'document_shared' then v_category:='documents';v_title:='Te compartieron un documento';v_body:='El documento enviado está disponible para tu cuenta.';
 when 'approval_requested' then v_category:='documents';v_title:='Tienes un documento por aprobar';v_body:='El emisor solicita tu revisión y firma institucional.';
 when 'document_approved' then v_category:='documents';v_title:='Tu documento recibió aprobación';v_body:='Revisa el documento y completa su envío a los destinatarios.';
 when 'personnel_file_shared' then v_category:='documents';v_title:='Te compartieron un expediente de personal';v_body:='El expediente cifrado está disponible para tu cuenta. Recupéralo con tu clave privada de cifrado original.';
 when 'note_shared' then v_category:='documents';v_title:='Tienes una nueva nota especial';v_body:='La nota está cifrada y formas parte de sus participantes originales.';
 when 'recovery_requested' then v_category:='recovery';v_title:='Solicitan tu aportación';v_body:='Revisa quién solicita recuperar la nota y decide si autorizas usar tu fragmento cifrado.';
 when 'recovery_ready' then v_category:='recovery';v_title:='Tu recuperación está lista';v_body:='Se reunieron todas las aportaciones. Abre la solicitud para recuperar el documento.';
 when 'recovery_completed' then v_category:='recovery';v_title:='Se completó una recuperación';v_body:='La recuperación fue completada para la cuenta solicitante.';
 when 'recovery_cancelled' then v_category:='recovery';v_title:='Se canceló una recuperación';v_body:='La solicitud se cerró. La nota y los fragmentos originales se conservan.';
 when 'recovery_rejected' then v_category:='recovery';v_title:='Se rechazó una recuperación';v_body:='Un participante rechazó la solicitud y esta se cerró para todos.';
 when 'recovery_expired' then v_category:='recovery';v_title:='Venció una recuperación';v_body:='Terminó el plazo de la solicitud. No se entregará el documento mediante esa solicitud.';
 when 'profile_changed' then v_category:='account';v_title:='Se actualizó tu acceso';v_body:='La administración modificó tu rol o el estado de tu perfil. Tus permisos actuales se comprueban en cada operación.';
 when 'encryption_key_activated' then v_category:='account';v_title:='Clave de cifrado activada';v_body:='Se utilizará para expedientes, notas y solicitudes nuevos. Conserva las privadas anteriores para sus asignaciones históricas.';
 when 'encryption_key_retired' then v_category:='account';v_title:='Se retiró una clave de cifrado';v_body:='No recibirá asignaciones nuevas. Conserva su archivo privado para los expedientes y notas anteriores.';
 when 'signing_key_retired' then v_category:='account';v_title:='Se retiró una clave de firma';v_body:='No podrá crear firmas nuevas. Las firmas anteriores conservan su información de verificación.';
 else raise exception 'Tipo de notificación no válido.';
 end case;
 if p_recipient is null then return; end if;
 insert into public.stc_notifications(recipient_id,category,event_type,target_kind,target_id,related_id,title,body,source)
 values(p_recipient,v_category,p_event,p_kind,p_target,p_related,v_title,v_body,p_source)
 on conflict(recipient_id,source) do nothing;
end; $$;

create or replace function stc_private.capture_notification_context(p_id uuid,p_backfilled boolean default false)
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
 when 'personnel_file' then select f.title into subject from public.stc_personnel_files f where f.id=n.target_id;
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

create or replace function stc_private.notification_item(p_id uuid)
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
 when 'personnel_file' then stc_private.personnel_file_visible(n.recipient_id,n.target_id)
  and exists(select 1 from public.stc_personnel_files f where f.id=n.target_id and f.state='ready')
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
  when 'personnel_file_shared' then title:='Te compartieron el expediente «'||c.subject||'»';
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


-- Solo la publicación confirmada avisa. Reservas, descargas y cancelaciones no
-- anuncian archivos disponibles. El creador ya conoce su propia publicación.
create function stc_private.notify_personnel_file_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare person record;
begin
 if new.action='published' and exists(
  select 1 from public.stc_personnel_files f where f.id=new.document_id and f.state='ready'
 ) then
  for person in select r.profile_id from public.stc_personnel_file_recipients r
   join public.stc_personnel_files f on f.id=r.document_id
   where r.document_id=new.document_id and r.profile_id<>f.created_by
   and stc_private.doc_permission(r.profile_id,'documents.read_assigned') loop
   perform stc_private.notify_profile(person.profile_id,'personnel_file_shared',
    'personnel_file',new.document_id,null,'personnel:'||new.id);
  end loop;
 end if;
 return new;
end; $$;
create trigger stc_notify_personnel_file after insert on public.stc_personnel_file_audit
 for each row execute function stc_private.notify_personnel_file_event();



create or replace function public.stc_dashboard()
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
 personnel as materialized(select f.*,p.display_name creator_name from public.stc_personnel_files f
  join public.profiles p on p.id=f.created_by where f.state='ready' and stc_private.personnel_file_reader(f.id)),
 personnel_preparations as materialized(select f.* from public.stc_personnel_files f
  where f.state='staging' and f.created_by=actor and stc_private.has_permission('documents.create') and stc_private.personnel_file_reader(f.id)),
 pending_documents as materialized(select item from available where (item->>'can_sign')::boolean or (item->>'can_request_approval')::boolean or (item->>'can_send')::boolean),
 pending_recoveries as materialized(select * from recoveries where (item->>'can_contribute')::boolean or (item->>'can_recover')::boolean),
 recent as (
  select (item->>'id')::uuid id,'document'::text target_kind,(item->>'id')::uuid target_id,null::uuid related_id,item->>'title' title,
  item->>'category' category,case item->>'workflow_state' when 'draft' then 'Borrador' when 'pending_approval' then 'En aprobación' when 'ready_to_send' then 'Listo para enviar' when 'sent' then 'Enviado' else 'Flujo anterior' end status,
  'Documento · '||(item->>'creator_name') subtitle,coalesce((item->>'updated_at')::timestamptz,(item->>'created_at')::timestamptz) occurred_at from available
  union all select id,'note',id,null,title,'especial','Cifrada · acceso conjunto','Nota especial · '||group_name,ready_at from notes
  union all select id,'personnel_file',id,null,title,'expediente','Cifrado · acceso individual',
   'Expediente de personal · '||creator_name,ready_at from personnel
 ), pending as (
  select (item->>'id')::uuid id,'document'::text target_kind,(item->>'id')::uuid target_id,null::uuid related_id,item->>'title' title,item->>'category' category,
  case when (item->>'can_sign')::boolean then 'Firma pendiente' when (item->>'can_request_approval')::boolean then 'Solicitar aprobación' else 'Completar envío' end status,
  'Documento · '||(item->>'creator_name') subtitle,coalesce((item->>'updated_at')::timestamptz,(item->>'created_at')::timestamptz) occurred_at from pending_documents
  union all select id,'recovery',id,note_id,title,'especial',case when (item->>'can_contribute')::boolean then 'Tu aportación está pendiente' else 'Lista para recuperar' end,
  'Recuperación · '||group_name,created_at from pending_recoveries
  union all select id,'note',id,null,title,'especial','Preparación pendiente','Nota especial · '||group_name,created_at from preparations
  union all select id,'personnel_file',id,null,title,'expediente','Carga incompleta',
   'Expediente de personal · Revisar o cancelar',created_at from personnel_preparations
 ), recent_page as(select * from recent order by occurred_at desc,target_kind,id limit 6),
 pending_page as(select * from pending order by occurred_at desc,target_kind,id limit 6)
 select jsonb_build_object(
 'stats',jsonb_build_object('documents_total',(select count(*) from available)+(select count(*) from notes)+(select count(*) from personnel),
  'personnel_total',(select count(*) from personnel),'pending_personnel',(select count(*) from personnel_preparations),
  'notes_total',(select count(*) from notes),'signed_total',(select count(*) from available where item->>'signature_state'='signed'),
  'pending_total',(select count(*) from pending),'pending_documents',(select count(*) from pending_documents),
  'pending_recoveries',(select count(*) from pending_recoveries),'pending_notes',(select count(*) from preparations)),
 'category_counts',(select jsonb_object_agg(code,(select count(*) from available where item->>'category'=code)+case when code='expediente' then (select count(*) from personnel) else 0 end) from unnest(array['memorandum','expediente','nota','especial','acuerdo']) code),
 'recent',coalesce((select jsonb_agg(to_jsonb(recent_page) order by occurred_at desc,target_kind,id) from recent_page),'[]'::jsonb),
 'pending',coalesce((select jsonb_agg(to_jsonb(pending_page) order by occurred_at desc,target_kind,id) from pending_page),'[]'::jsonb),
 'updated_at',statement_timestamp()));
end; $$;
-- CREATE OR REPLACE conserva grants previos; las funciones privadas nuevas se cierran.
revoke all on function stc_private.notify_personnel_file_event(),
 stc_private.notify_profile(uuid,text,text,uuid,uuid,text),
 stc_private.capture_notification_context(uuid,boolean),stc_private.notification_item(uuid)
 from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.stc_dashboard() from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.stc_dashboard() to authenticated;
-- No se reemiten avisos de publicaciones anteriores; sí entran al dashboard.
notify pgrst,'reload schema';
commit;
