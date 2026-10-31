-- Solo lectura. Puede ejecutarse sobre el proyecto compartido después de migrar.
select 'Tabla de notas y comunicados' as componente,
 to_regclass('public.stc_diplomatic_notes') is not null as correcto
union all select 'Destinatarios originales',to_regclass('public.stc_diplomatic_note_recipients') is not null
union all select 'Auditoría',to_regclass('public.stc_diplomatic_note_audit') is not null
union all select 'Material privado',to_regclass('stc_private.diplomatic_note_material') is not null
union all select 'RLS en cuatro tablas',(
 select count(*)=4 from pg_tables where rowsecurity and (
 (schemaname='public' and tablename in ('stc_diplomatic_notes','stc_diplomatic_note_recipients','stc_diplomatic_note_audit'))
 or (schemaname='stc_private' and tablename='diplomatic_note_material')))
union all select 'RPC de consulta',
 to_regprocedure('public.get_diplomatic_note(uuid)') is not null
 and to_regprocedure('public.list_diplomatic_notes(text,text,integer,integer)') is not null
union all select 'Cinco RPC de servidor',(
 select bool_and(to_regprocedure(signature) is not null) from unnest(array[
 'public.server_begin_diplomatic_note(uuid,uuid,uuid,text,text,text,integer,jsonb,text,uuid)',
 'public.server_commit_diplomatic_note(uuid,uuid,uuid,jsonb,text,text,text,text)',
 'public.server_cancel_diplomatic_note(uuid,uuid,uuid)',
 'public.server_diplomatic_note_material(uuid,uuid)',
 'public.server_complete_diplomatic_download(uuid,uuid,uuid,text)']) signature)
union all select 'JWT sin ejecución de RPC de servidor',coalesce((
 select bool_and(not has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')) from unnest(array[
 'public.server_begin_diplomatic_note(uuid,uuid,uuid,text,text,text,integer,jsonb,text,uuid)',
 'public.server_commit_diplomatic_note(uuid,uuid,uuid,jsonb,text,text,text,text)',
 'public.server_cancel_diplomatic_note(uuid,uuid,uuid)',
 'public.server_diplomatic_note_material(uuid,uuid)',
 'public.server_complete_diplomatic_download(uuid,uuid,uuid,text)']) signature),false)
union all select 'Material sin lectura directa',coalesce(
 not has_table_privilege('authenticated',to_regclass('stc_private.diplomatic_note_material'),'SELECT')
 and not has_table_privilege('service_role',to_regclass('stc_private.diplomatic_note_material'),'SELECT'),false)
union all select 'Anónimo sin lectura de notas',coalesce(
 not has_table_privilege('anon',to_regclass('public.stc_diplomatic_notes'),'SELECT'),false)
union all select 'Bucket privado de 5 MiB',exists(
 select 1 from storage.buckets where id='stc-documents' and not public and file_size_limit=5242880)
union all select 'Clave de firma vinculada al emisor',exists(select 1 from pg_constraint
 where conrelid='public.stc_diplomatic_notes'::regclass and contype='f'
 and confrelid='public.stc_signing_keys'::regclass)
union all select 'Snapshot de firma reservado al servidor',not has_function_privilege('authenticated',
 'stc_private.diplomatic_signing_key(uuid)','EXECUTE');
