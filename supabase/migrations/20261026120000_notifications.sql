-- Centro de notificaciones. Requiere las siete migraciones anteriores.
-- Ejecutar una vez como postgres. Los avisos se crean en la misma transacción del evento.
begin;

create table public.stc_notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id),
 category text not null check(category in ('groups','documents','recovery','account')),
 event_type text not null check(length(event_type) between 1 and 80),
 target_kind text not null check(target_kind in ('group','document','note','recovery','keys','account')),
 target_id uuid, related_id uuid,
 title text not null check(length(title) between 1 and 160),
 body text not null check(length(body) between 1 and 400),
 source text not null check(length(source) between 1 and 180),
 created_at timestamptz not null default statement_timestamp(),
 read_at timestamptz,
 unique(recipient_id,source)
);
create index stc_notifications_inbox on public.stc_notifications(recipient_id,created_at desc,id desc);
create index stc_notifications_unread on public.stc_notifications(recipient_id,created_at desc,id desc) where read_at is null;

-- Solo mensajes predeterminados: no títulos de documentos, motivos, correos ni secretos.
-- El enlace nunca concede acceso al recurso: cada pantalla vuelve a autorizar su lectura.
create function stc_private.notify_profile(
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
 when 'note_shared' then v_category:='documents';v_title:='Tienes una nueva nota especial';v_body:='La nota está cifrada y formas parte de sus participantes originales.';
 when 'recovery_requested' then v_category:='recovery';v_title:='Solicitan tu aportación';v_body:='Revisa quién solicita recuperar la nota y decide si autorizas usar tu fragmento cifrado.';
 when 'recovery_ready' then v_category:='recovery';v_title:='Tu recuperación está lista';v_body:='Se reunieron todas las aportaciones. Abre la solicitud para recuperar el documento.';
 when 'recovery_completed' then v_category:='recovery';v_title:='Se completó una recuperación';v_body:='La recuperación fue completada para la cuenta solicitante.';
 when 'recovery_cancelled' then v_category:='recovery';v_title:='Se canceló una recuperación';v_body:='La solicitud se cerró. La nota y los fragmentos originales se conservan.';
 when 'recovery_rejected' then v_category:='recovery';v_title:='Se rechazó una recuperación';v_body:='Un participante rechazó la solicitud y esta se cerró para todos.';
 when 'recovery_expired' then v_category:='recovery';v_title:='Venció una recuperación';v_body:='Terminó el plazo de la solicitud. No se entregará el documento mediante esa solicitud.';
 when 'profile_changed' then v_category:='account';v_title:='Se actualizó tu acceso';v_body:='La administración modificó tu rol o el estado de tu perfil. Tus permisos actuales se comprueban en cada operación.';
 when 'encryption_key_activated' then v_category:='account';v_title:='Clave de protección de fragmentos activada';v_body:='Se utilizará para notas y solicitudes nuevas. Conserva las privadas anteriores para sus asignaciones históricas.';
 when 'encryption_key_retired' then v_category:='account';v_title:='Se retiró una clave de protección de fragmentos';v_body:='No recibirá asignaciones nuevas. Conserva su archivo privado para las notas anteriores.';
 when 'signing_key_retired' then v_category:='account';v_title:='Se retiró una clave de firma';v_body:='No podrá crear firmas nuevas. Las firmas anteriores conservan su información de verificación.';
 else raise exception 'Tipo de notificación no válido.';
 end case;
 if p_recipient is null then return; end if;
 insert into public.stc_notifications(recipient_id,category,event_type,target_kind,target_id,related_id,title,body,source)
 values(p_recipient,v_category,p_event,p_kind,p_target,p_related,v_title,v_body,p_source)
 on conflict(recipient_id,source) do nothing;
end; $$;

create function stc_private.notify_group_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare m record; person uuid; event text;
begin
 if new.action='created' then
  for m in select profile_id from public.stc_group_members where group_id=new.group_id and removed_at is null loop
   perform stc_private.notify_profile(m.profile_id,'group_added','group',new.group_id,null,'group:'||new.id);
  end loop;
 elsif new.action='member_set' then
  person:=(new.details->>'profile_id')::uuid;
  if new.details->'old' is null or new.details->'old'='null'::jsonb or new.details->'old'->>'removed_at' is not null then event:='group_added';
  elsif new.details->>'group_role' is distinct from new.details->'old'->>'group_role' then event:='group_role_changed';
  else return new; end if;
  perform stc_private.notify_profile(person,event,'group',new.group_id,null,'group:'||new.id);
 elsif new.action='member_removed' then
  perform stc_private.notify_profile((new.details->>'profile_id')::uuid,'group_removed','group',null,null,'group:'||new.id);
 elsif new.action='updated' and (new.details->>'is_active')::boolean is distinct from (new.details->'old'->>'is_active')::boolean then
  event:=case when (new.details->>'is_active')::boolean then 'group_reactivated' else 'group_archived' end;
  for m in select profile_id from public.stc_group_members where group_id=new.group_id and removed_at is null loop
   perform stc_private.notify_profile(m.profile_id,event,'group',new.group_id,null,'group:'||new.id);
  end loop;
 end if;
 return new;
end; $$;
create trigger stc_notify_group after insert on public.stc_group_audit for each row execute function stc_private.notify_group_event();

create function stc_private.notify_document_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare d public.stc_documents%rowtype; m record;
begin
 if new.action='key_retired' then
  perform stc_private.notify_profile(new.actor_profile_id,'signing_key_retired','keys',null,null,'signing:'||new.id);
  return new;
 end if;
 select * into d from public.stc_documents where id=new.document_id;
 if new.action='review_requested' then
  perform stc_private.notify_profile(d.approver_profile_id,'approval_requested','document',d.id,null,'document:'||d.id||':review');
 elsif new.action='document_signed' and new.details->>'purpose'='approval' then
  perform stc_private.notify_profile(d.created_by,'document_approved','document',d.id,null,'document:'||d.id||':approved');
 elsif new.action='document_sent' then
  for m in select profile_id from public.stc_document_recipients where document_id=d.id and profile_id<>d.created_by loop
   perform stc_private.notify_profile(m.profile_id,'document_shared','document',d.id,null,'document:'||d.id||':sent');
  end loop;
 end if;
 return new;
end; $$;
create trigger stc_notify_document after insert on public.stc_document_audit for each row execute function stc_private.notify_document_event();

create function stc_private.notify_note_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare m record;
begin
 if new.state='ready' and old.state is distinct from new.state then
  for m in select profile_id from public.stc_group_note_participants where note_id=new.id loop
   perform stc_private.notify_profile(m.profile_id,'note_shared','note',new.id,null,'note:'||new.id||':shared');
  end loop;
 end if;
 return new;
end; $$;
create trigger stc_notify_note after update of state on public.stc_group_notes for each row execute function stc_private.notify_note_event();

-- Usa el audit posterior a crear el snapshot: todos los participantes ya existen.
create function stc_private.notify_recovery_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.stc_note_recoveries%rowtype; m record; event text;
begin
 select * into r from public.stc_note_recoveries where id=new.request_id;
 if new.action='ready' then
  perform stc_private.notify_profile(r.requester_id,'recovery_ready','recovery',r.id,r.note_id,'recovery:'||r.id||':ready');
 elsif new.action in ('requested','completed','cancelled','rejected','expired') then
  event:='recovery_'||new.action;
  for m in select profile_id from public.stc_note_recovery_participants where request_id=r.id loop
   perform stc_private.notify_profile(m.profile_id,event,'recovery',r.id,r.note_id,'recovery:'||r.id||':'||new.action);
  end loop;
 end if;
 return new;
end; $$;
create trigger stc_notify_recovery after insert on public.stc_note_recovery_audit for each row execute function stc_private.notify_recovery_event();

create function stc_private.notify_account_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role_code is distinct from new.role_code or old.is_active is distinct from new.is_active then
  perform stc_private.notify_profile(new.id,'profile_changed','account',null,null,'profile:'||gen_random_uuid());
 end if;
 return new;
end; $$;
create trigger stc_notify_account after update of role_code,is_active on public.profiles for each row execute function stc_private.notify_account_event();
create function stc_private.notify_encryption_key_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.action in ('activated','retired') then
  perform stc_private.notify_profile(new.profile_id,'encryption_key_'||new.action,'keys',new.key_id,null,'encryption:'||new.id);
 end if;
 return new;
end; $$;
create trigger stc_notify_encryption_key after insert on public.stc_encryption_key_audit for each row execute function stc_private.notify_encryption_key_event();

create function public.list_stc_notifications(
 p_state text default 'all',p_category text default 'all',p_limit integer default 20,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id();
begin
 if actor is null then raise exception 'Perfil no disponible.' using errcode='NT403'; end if;
 if p_state is null or p_state not in ('all','unread') or p_category is null or p_category not in ('all','groups','documents','recovery','account')
 or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
  raise exception 'Consulta inválida.' using errcode='NT422';
 end if;
 return(with visible as(select id,category,event_type,target_kind,target_id,related_id,title,body,created_at,read_at
 from public.stc_notifications where recipient_id=actor and (p_state='all' or read_at is null) and (p_category='all' or category=p_category)),
 page as(select * from visible order by created_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),
 'total',(select count(*) from visible),'unread_count',(select count(*) from public.stc_notifications where recipient_id=actor and read_at is null),
 'limit',p_limit,'offset',p_offset,'snapshot_at',statement_timestamp()));
end; $$;
create function public.read_stc_notification(p_notification_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id();
begin
 if actor is null then raise exception 'Perfil no disponible.' using errcode='NT403'; end if;
 update public.stc_notifications set read_at=coalesce(read_at,statement_timestamp()) where id=p_notification_id and recipient_id=actor;
 if not found then raise exception 'Notificación no disponible.' using errcode='NT404'; end if;
end; $$;
create function public.read_all_stc_notifications(p_before timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id();
begin
 if actor is null then raise exception 'Perfil no disponible.' using errcode='NT403'; end if;
 if p_before is null or p_before>statement_timestamp() then raise exception 'Fecha inválida.' using errcode='NT422'; end if;
 update public.stc_notifications set read_at=statement_timestamp() where recipient_id=actor and read_at is null and created_at<=p_before;
end; $$;

alter table public.stc_notifications enable row level security;
revoke all on public.stc_notifications from public,anon,authenticated,service_role,supabase_auth_admin;
grant select on public.stc_notifications to authenticated;
create policy stc_notifications_own on public.stc_notifications for select to authenticated using(recipient_id=stc_private.current_profile_id());
-- current_profile_id se usa en políticas nuevas además de las funciones SECURITY DEFINER existentes.
grant execute on function stc_private.current_profile_id() to authenticated;
revoke all on function stc_private.notify_profile(uuid,text,text,uuid,uuid,text),stc_private.notify_group_event(),stc_private.notify_document_event(),
 stc_private.notify_note_event(),stc_private.notify_recovery_event(),stc_private.notify_account_event(),stc_private.notify_encryption_key_event()
 from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.list_stc_notifications(text,text,integer,integer),public.read_stc_notification(uuid),public.read_all_stc_notifications(timestamptz)
 from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.list_stc_notifications(text,text,integer,integer),public.read_stc_notification(uuid),public.read_all_stc_notifications(timestamptz) to authenticated;

-- Recupera tareas pendientes anteriores a instalar el centro. No inventa historial.
do $$ declare r record; m record; d record; begin
 for r in select * from public.stc_note_recoveries where state in ('pending','ready') and expires_at>statement_timestamp() loop
  for m in select profile_id from public.stc_note_recovery_participants where request_id=r.id and contributed_at is null loop
   perform stc_private.notify_profile(m.profile_id,'recovery_requested','recovery',r.id,r.note_id,'recovery:'||r.id||':requested');
  end loop;
  if r.state='ready' then perform stc_private.notify_profile(r.requester_id,'recovery_ready','recovery',r.id,r.note_id,'recovery:'||r.id||':ready'); end if;
 end loop;
 for d in select * from public.stc_documents where delivery_state='review' loop
  if stc_private.doc_has_signature(d.id,d.approver_profile_id,'approval') then
   perform stc_private.notify_profile(d.created_by,'document_approved','document',d.id,null,'document:'||d.id||':approved');
  else perform stc_private.notify_profile(d.approver_profile_id,'approval_requested','document',d.id,null,'document:'||d.id||':review'); end if;
 end loop;
end; $$;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stc_notifications') then
  alter publication supabase_realtime add table public.stc_notifications;
 end if;
end; $$;
comment on table public.stc_notifications is 'Avisos transaccionales por destinatario. Solo texto predeterminado y referencias; nunca documentos, motivos de recuperación, claves o fragmentos. Leer no autoriza ni completa tareas.';
notify pgrst,'reload schema';
commit;
