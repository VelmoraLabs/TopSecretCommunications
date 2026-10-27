-- Requiere las seis migraciones anteriores. Ejecutar una vez como postgres.
begin;
create table public.stc_note_recoveries (
 id uuid primary key,
 note_id uuid not null references public.stc_group_notes(id),
 requester_id uuid not null references public.profiles(id),
 requester_name text not null,
 requester_key_id uuid not null,
 reason text not null check(reason=btrim(reason) and length(reason) between 1 and 240 and reason !~ '[[:cntrl:]]'),
 duration_minutes integer not null check(duration_minutes between 1 and 1440),
 state text not null default 'pending' check(state in ('pending','ready','completed','cancelled','rejected','expired')),
 participant_count integer not null check(participant_count between 2 and 20),
 contribution_count integer not null default 0 check(contribution_count>=0 and contribution_count<=participant_count),
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null,
 completed_at timestamptz,
 download_until timestamptz,
 version integer not null default 1 check(version>0),
 foreign key(requester_key_id,requester_id) references public.stc_encryption_keys(id,profile_id),
 check((state='completed')=(completed_at is not null)),
 check((state='completed')=(download_until is not null)),
 check(state not in ('ready','completed') or contribution_count=participant_count)
);
create unique index stc_recovery_one_open_note on public.stc_note_recoveries(note_id) where state in ('pending','ready');
create index stc_recovery_note_date on public.stc_note_recoveries(note_id,created_at desc,id);
create table public.stc_note_recovery_participants (
 request_id uuid not null references public.stc_note_recoveries(id),
 profile_id uuid not null references public.profiles(id),
 share_index integer not null check(share_index between 1 and 20),
 contributed_at timestamptz,
 rejected_at timestamptz,
 primary key(request_id,profile_id), unique(request_id,share_index)
);
create table stc_private.note_recovery_contributions (
 request_id uuid not null,
 profile_id uuid not null,
 envelope jsonb not null check(jsonb_typeof(envelope)='object'),
 primary key(request_id,profile_id),
 foreign key(request_id,profile_id) references public.stc_note_recovery_participants(request_id,profile_id)
);
alter table stc_private.note_recovery_contributions enable row level security;
create table public.stc_note_recovery_audit (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.stc_note_recoveries(id),
 actor_profile_id uuid references public.profiles(id),
 action text not null check(action in ('requested','contributed','ready','completed','cancelled','rejected','expired','material_purged')),
 created_at timestamptz not null default statement_timestamp()
);
create index stc_recovery_audit_request on public.stc_note_recovery_audit(request_id,created_at,id);

create function stc_private.recovery_access(actor uuid,target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.doc_permission(actor,'documents.read_assigned') and exists(
 select 1 from public.stc_note_recoveries r join public.stc_group_note_participants p on p.note_id=r.note_id
 where r.id=target and p.profile_id=actor);
$$;
create function stc_private.recovery_reader(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select stc_private.recovery_access(stc_private.current_profile_id(),target);
$$;
create function stc_private.recovery_blocked(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.stc_note_recovery_participants x join public.profiles p on p.id=x.profile_id
 where x.request_id=target and (not p.is_active or p.auth_user_id is null
 or not stc_private.doc_permission(p.id,'documents.read_assigned') or not stc_private.doc_permission(p.id,'recovery.contribute')));
$$;
create function stc_private.purge_recoveries(target_note uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare r record; removed integer:=0; amount integer;
begin
 perform pg_advisory_xact_lock(20261016,1);
 for r in select * from public.stc_note_recoveries where (target_note is null or note_id=target_note) and state in ('pending','ready') and expires_at<=statement_timestamp() for update loop
  update public.stc_note_recoveries set state='expired',version=version+1 where id=r.id;
  insert into public.stc_note_recovery_audit(request_id,action) values(r.id,'expired');
 end loop;
 for r in select * from public.stc_note_recoveries where (target_note is null or note_id=target_note)
 and (state in ('cancelled','rejected','expired') or (state='completed' and download_until<=statement_timestamp()))
 and exists(select 1 from stc_private.note_recovery_contributions c where c.request_id=stc_note_recoveries.id) for update loop
  delete from stc_private.note_recovery_contributions where request_id=r.id;
  get diagnostics amount=row_count;removed:=removed+amount;
  insert into public.stc_note_recovery_audit(request_id,action) values(r.id,'material_purged');
 end loop;
 return removed;
end; $$;
create function stc_private.recovery_summary(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'note_id',r.note_id,'requester_id',r.requester_id,'requester_name',r.requester_name,'reason',r.reason,
 'state',case when r.state in ('pending','ready') and r.expires_at<=statement_timestamp() then 'expired' else r.state end,
 'participant_count',r.participant_count,'contribution_count',r.contribution_count,'created_at',r.created_at,'expires_at',r.expires_at,
 'completed_at',r.completed_at,'download_until',r.download_until,'version',r.version,
 'blocked',stc_private.recovery_blocked(r.id),
 'can_contribute',r.state in ('pending','ready') and r.expires_at>statement_timestamp() and not stc_private.recovery_blocked(r.id)
   and stc_private.has_permission('recovery.contribute') and exists(select 1 from public.stc_note_recovery_participants p where p.request_id=r.id and p.profile_id=stc_private.current_profile_id() and p.contributed_at is null),
 'can_recover',r.requester_id=stc_private.current_profile_id() and stc_private.has_permission('recovery.request') and not stc_private.recovery_blocked(r.id)
   and ((r.state='ready' and r.expires_at>statement_timestamp()) or (r.state='completed' and r.download_until>statement_timestamp())),
 'can_cancel',coalesce(r.requester_id=stc_private.current_profile_id(),false) and r.state in ('pending','ready') and r.expires_at>statement_timestamp(),
 'can_reject',r.state in ('pending','ready') and r.expires_at>statement_timestamp() and stc_private.has_permission('recovery.contribute'))
 from public.stc_note_recoveries r where r.id=target;
$$;
create function stc_private.recovery_detail(target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('recovery',stc_private.recovery_summary(target),
 'requester_key',jsonb_build_object('id',k.id,'profile_id',k.profile_id,'public_base64',k.public_base64,'fingerprint',k.fingerprint),
 'participants',(select jsonb_agg(jsonb_build_object('profile_id',p.profile_id,'display_name',n.display_name,'share_index',p.share_index,
 'contributed_at',p.contributed_at,'rejected_at',p.rejected_at,'is_active',a.is_active) order by p.share_index)
 from public.stc_note_recovery_participants p join public.stc_group_note_participants n on n.note_id=r.note_id and n.profile_id=p.profile_id
 join public.profiles a on a.id=p.profile_id where p.request_id=r.id))
 from public.stc_note_recoveries r join public.stc_encryption_keys k on k.id=r.requester_key_id where r.id=target;
$$;
create function public.create_note_recovery(p_note_id uuid,p_request_id uuid,p_reason text,p_duration_minutes integer default 60)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id(); n public.stc_group_notes%rowtype; old public.stc_note_recoveries%rowtype; key_id uuid;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.has_permission('recovery.request') or not stc_private.has_permission('documents.read_assigned') then raise exception 'Sin permiso.' using errcode='PR403'; end if;
 select * into n from public.stc_group_notes where id=p_note_id and state='ready' and custody_mode='individual-v1';
 if not found or not exists(select 1 from public.stc_group_note_participants where note_id=p_note_id and profile_id=actor)
 then raise exception 'Nota no disponible.' using errcode='PR404'; end if;
 if p_request_id is null or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 1 and 240 or p_reason ~ '[[:cntrl:]]'
 or p_duration_minutes is null or p_duration_minutes not between 1 and 1440 then raise exception 'Solicitud inválida.' using errcode='PR422'; end if;
 perform stc_private.purge_recoveries(p_note_id);
 select * into old from public.stc_note_recoveries where id=p_request_id;
 if found then
  if old.requester_id<>actor or old.note_id<>p_note_id or old.reason<>p_reason or old.duration_minutes<>p_duration_minutes
  then raise exception 'Identificador utilizado.' using errcode='PR409'; end if;
  return stc_private.recovery_detail(old.id);
 end if;
 if exists(select 1 from public.stc_note_recoveries where note_id=p_note_id and state in ('pending','ready'))
 then raise exception 'Ya existe una solicitud abierta.' using errcode='PR409'; end if;
 select id into key_id from public.stc_encryption_keys where profile_id=actor and state='active';
 if key_id is null then raise exception 'Activa una clave de cifrado para recibir las aportaciones.' using errcode='PR428'; end if;
 if exists(select 1 from public.stc_group_note_participants p where p.note_id=p_note_id and
 (not stc_private.doc_permission(p.profile_id,'documents.read_assigned') or not stc_private.doc_permission(p.profile_id,'recovery.contribute')))
 then raise exception 'Hay participantes sin acceso.' using errcode='PR412'; end if;
 insert into public.stc_note_recoveries(id,note_id,requester_id,requester_name,requester_key_id,reason,duration_minutes,participant_count,expires_at)
 values(p_request_id,p_note_id,actor,(select display_name from public.profiles where id=actor),key_id,p_reason,p_duration_minutes,n.participant_count,statement_timestamp()+make_interval(mins=>p_duration_minutes));
 insert into public.stc_note_recovery_participants(request_id,profile_id,share_index)
 select p_request_id,profile_id,share_index from public.stc_group_note_participants where note_id=p_note_id;
 insert into public.stc_note_recovery_audit(request_id,actor_profile_id,action) values(p_request_id,actor,'requested');
 return stc_private.recovery_detail(p_request_id);
end; $$;
create function public.list_note_recoveries(p_note_id uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not stc_private.group_note_reader(p_note_id) then raise exception 'Nota no disponible.' using errcode='PR404'; end if;
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Consulta inválida.' using errcode='PR422'; end if;
 perform stc_private.purge_recoveries(p_note_id);
 return(with eligible as(select * from public.stc_note_recoveries where note_id=p_note_id and stc_private.recovery_reader(id)),
 page as(select * from eligible order by created_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(stc_private.recovery_summary(id) order by created_at desc,id) from page),'[]'::jsonb),
 'has_open',exists(select 1 from eligible where state in ('pending','ready')),'total',(select count(*) from eligible),'limit',p_limit,'offset',p_offset));
end; $$;
create function public.get_note_recovery(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not stc_private.recovery_reader(p_request_id) then raise exception 'Solicitud no disponible.' using errcode='PR404'; end if;
 perform stc_private.purge_recoveries((select note_id from public.stc_note_recoveries where id=p_request_id));
 return stc_private.recovery_detail(p_request_id);
end; $$;
create function public.server_contribute_note_recovery(p_actor uuid,p_request_id uuid,p_envelope jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.stc_note_recoveries%rowtype; k public.stc_encryption_keys%rowtype; member_row public.stc_note_recovery_participants%rowtype; expected jsonb; amount integer;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.recovery_access(p_actor,p_request_id) or not stc_private.doc_permission(p_actor,'recovery.contribute') then raise exception 'Sin acceso.' using errcode='PR404'; end if;
 select * into r from public.stc_note_recoveries where id=p_request_id for update;
 if r.state not in ('pending','ready') or r.expires_at<=statement_timestamp() then raise exception 'Solicitud cerrada.' using errcode='PR410'; end if;
 if stc_private.recovery_blocked(r.id) then raise exception 'Hay participantes sin acceso.' using errcode='PR412'; end if;
 select * into member_row from public.stc_note_recovery_participants where request_id=r.id and profile_id=p_actor;
 select * into k from public.stc_encryption_keys where id=r.requester_key_id;
 expected:=jsonb_build_object('format','stc-share-envelope','version',1,'algorithm','RSA-OAEP-256+A256GCM','purpose','recovery-contribution',
 'request_id',r.id,'note_id',r.note_id,'contributor_id',p_actor,'recipient_id',r.requester_id,'key_id',k.id,'fingerprint',k.fingerprint,
 'set_id',(select package_header->>'document_id' from public.stc_group_notes where id=r.note_id),'share_index',member_row.share_index,'share_count',r.participant_count,'threshold',r.participant_count);
 if jsonb_typeof(p_envelope) is distinct from 'object' or p_envelope->'context' is distinct from expected
 or (p_envelope-array['context','wrapped_key_base64','nonce_base64','ciphertext_base64','tag_base64'])<>'{}'::jsonb
 or length(coalesce(p_envelope->>'wrapped_key_base64',''))<>344 or coalesce(p_envelope->>'wrapped_key_base64','') !~ '^[A-Za-z0-9+/]+==$'
 or coalesce(p_envelope->>'nonce_base64','') !~ '^[A-Za-z0-9+/]{16}$' or coalesce(p_envelope->>'tag_base64','') !~ '^[A-Za-z0-9+/]{22}==$'
 or length(coalesce(p_envelope->>'ciphertext_base64','')) not between 4 and 4096 or coalesce(p_envelope->>'ciphertext_base64','') !~ '^[A-Za-z0-9+/]+={0,2}$'
 then raise exception 'Aportación incompatible.' using errcode='PR422'; end if;
 if member_row.contributed_at is not null then return; end if;
 insert into stc_private.note_recovery_contributions values(r.id,p_actor,p_envelope);
 update public.stc_note_recovery_participants set contributed_at=statement_timestamp() where request_id=r.id and profile_id=p_actor;
 amount:=r.contribution_count+1;
 update public.stc_note_recoveries set contribution_count=amount,state=case when amount=participant_count then 'ready' else 'pending' end,version=version+1 where id=r.id;
 insert into public.stc_note_recovery_audit(request_id,actor_profile_id,action) values(r.id,p_actor,'contributed');
 if amount=r.participant_count then insert into public.stc_note_recovery_audit(request_id,actor_profile_id,action) values(r.id,p_actor,'ready'); end if;
end; $$;
create function public.close_note_recovery(p_request_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=stc_private.current_profile_id(); r public.stc_note_recoveries%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.recovery_reader(p_request_id) then raise exception 'Solicitud no disponible.' using errcode='PR404'; end if;
 select * into r from public.stc_note_recoveries where id=p_request_id for update;
 if p_action not in ('cancelled','rejected') or p_action is null then raise exception 'Acción inválida.' using errcode='PR422'; end if;
 if (p_action='cancelled' and r.requester_id<>actor) or (p_action='rejected' and not stc_private.has_permission('recovery.contribute')) then raise exception 'Sin permiso.' using errcode='PR403'; end if;
 if r.state=p_action then return stc_private.recovery_detail(r.id); end if;
 if r.state not in ('pending','ready') or r.expires_at<=statement_timestamp() then raise exception 'Solicitud cerrada.' using errcode='PR410'; end if;
 update public.stc_note_recoveries set state=p_action,version=version+1 where id=r.id;
 if p_action='rejected' then update public.stc_note_recovery_participants set rejected_at=statement_timestamp() where request_id=r.id and profile_id=actor; end if;
 insert into public.stc_note_recovery_audit(request_id,actor_profile_id,action) values(r.id,actor,p_action);
 perform stc_private.purge_recoveries(r.note_id);
 return stc_private.recovery_detail(r.id);
end; $$;
create function public.server_note_recovery_material(p_actor uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.stc_note_recoveries%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 if not stc_private.recovery_access(p_actor,p_request_id) then raise exception 'Solicitud no disponible.' using errcode='PR404'; end if;
 select * into r from public.stc_note_recoveries where id=p_request_id;
 if r.requester_id<>p_actor or not stc_private.doc_permission(p_actor,'recovery.request') then raise exception 'Solo solicitante.' using errcode='PR403'; end if;
 if not ((r.state='ready' and r.expires_at>statement_timestamp()) or (r.state='completed' and r.download_until>statement_timestamp())) then raise exception 'No está lista o venció.' using errcode='PR410'; end if;
 if stc_private.recovery_blocked(r.id) then raise exception 'Hay participantes sin acceso.' using errcode='PR412'; end if;
 if (select count(*) from stc_private.note_recovery_contributions where request_id=r.id)<>r.participant_count then raise exception 'Material no disponible.' using errcode='PR410'; end if;
 return jsonb_build_object('detail',stc_private.recovery_detail(r.id),'envelopes',(select jsonb_agg(c.envelope order by p.share_index)
 from stc_private.note_recovery_contributions c join public.stc_note_recovery_participants p using(request_id,profile_id) where c.request_id=r.id));
end; $$;
create function public.server_complete_note_recovery(p_actor uuid,p_request_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.stc_note_recoveries%rowtype;
begin
 perform pg_advisory_xact_lock(20261016,1);
 -- Vuelve a verificar plazo, destinatario, participantes y material tras descifrar.
 perform public.server_note_recovery_material(p_actor,p_request_id);
 select * into r from public.stc_note_recoveries where id=p_request_id for update;
 if r.state='completed' then return; end if;
 if p_expected_version is null or r.version<>p_expected_version then raise exception 'Solicitud cambió.' using errcode='PR409'; end if;
 update public.stc_note_recoveries set state='completed',completed_at=statement_timestamp(),download_until=statement_timestamp()+interval '10 minutes',version=version+1 where id=r.id;
 insert into public.stc_note_recovery_audit(request_id,actor_profile_id,action) values(r.id,p_actor,'completed');
end; $$;
create function public.server_cleanup_note_recoveries()
returns integer language sql security definer set search_path='' as $$ select stc_private.purge_recoveries(); $$;

-- Solo metadatos en canales de usuario. Nunca se replica el material cifrado.
do $$ declare t text; begin
 foreach t in array array['stc_note_recoveries','stc_note_recovery_participants','stc_note_recovery_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role,supabase_auth_admin',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end; $$;
create policy stc_recoveries_read on public.stc_note_recoveries for select to authenticated using(stc_private.recovery_reader(id));
create policy stc_recovery_participants_read on public.stc_note_recovery_participants for select to authenticated using(stc_private.recovery_reader(request_id));
create policy stc_recovery_audit_read on public.stc_note_recovery_audit for select to authenticated using(stc_private.recovery_reader(request_id));
revoke all on stc_private.note_recovery_contributions from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on sequence public.stc_note_recovery_audit_id_seq from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function stc_private.recovery_access(uuid,uuid),stc_private.recovery_reader(uuid),stc_private.recovery_blocked(uuid),stc_private.purge_recoveries(uuid),stc_private.recovery_summary(uuid),stc_private.recovery_detail(uuid) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function stc_private.recovery_reader(uuid) to authenticated;
revoke all on function public.create_note_recovery(uuid,uuid,text,integer),public.list_note_recoveries(uuid,integer,integer),public.get_note_recovery(uuid),public.close_note_recovery(uuid,text) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.create_note_recovery(uuid,uuid,text,integer),public.list_note_recoveries(uuid,integer,integer),public.get_note_recovery(uuid),public.close_note_recovery(uuid,text) to authenticated;
revoke all on function public.server_contribute_note_recovery(uuid,uuid,jsonb),public.server_note_recovery_material(uuid,uuid),public.server_complete_note_recovery(uuid,uuid,integer),public.server_cleanup_note_recoveries() from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.server_contribute_note_recovery(uuid,uuid,jsonb),public.server_note_recovery_material(uuid,uuid),public.server_complete_note_recovery(uuid,uuid,integer),public.server_cleanup_note_recoveries() to service_role;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stc_note_recoveries')
 then alter publication supabase_realtime add table public.stc_note_recoveries; end if;
end; $$;
comment on table stc_private.note_recovery_contributions is 'Aportaciones cifradas para la clave del solicitante, vinculadas a solicitud y autor. Borrado en cierre/vencimiento; completadas: 10 minutos de reintento. Nunca plaintext ni privadas.';
notify pgrst,'reload schema';
commit;
