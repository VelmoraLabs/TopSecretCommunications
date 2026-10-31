-- Solo lectura. Puede ejecutarse sobre el proyecto compartido después de migrar.
select 'Tabla de expedientes' as componente,
 to_regclass('public.stc_personnel_files') is not null as correcto
union all select 'Destinatarios originales',to_regclass('public.stc_personnel_file_recipients') is not null
union all select 'Auditoría',to_regclass('public.stc_personnel_file_audit') is not null
union all select 'Material privado',to_regclass('stc_private.personnel_file_material') is not null
union all select 'RLS en cuatro tablas',(
 select count(*)=4 from pg_tables where rowsecurity and (
 (schemaname='public' and tablename in ('stc_personnel_files','stc_personnel_file_recipients','stc_personnel_file_audit'))
 or (schemaname='stc_private' and tablename='personnel_file_material')))
union all select 'RPC de consulta',
 to_regprocedure('public.get_personnel_file(uuid)') is not null
 and to_regprocedure('public.list_personnel_files(text,integer,integer)') is not null
union all select 'Cinco RPC de servidor',(
 select bool_and(to_regprocedure(signature) is not null) from unnest(array[
 'public.server_begin_personnel_file(uuid,uuid,uuid,text,text,text,integer,jsonb)',
 'public.server_commit_personnel_file(uuid,uuid,uuid,jsonb,text,text,text)',
 'public.server_cancel_personnel_file(uuid,uuid,uuid)',
 'public.server_personnel_file_material(uuid,uuid)',
 'public.server_complete_personnel_download(uuid,uuid,uuid,text)']) signature)
union all select 'JWT sin ejecución de RPC de servidor',coalesce((
 select bool_and(not has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')) from unnest(array[
 'public.server_begin_personnel_file(uuid,uuid,uuid,text,text,text,integer,jsonb)',
 'public.server_commit_personnel_file(uuid,uuid,uuid,jsonb,text,text,text)',
 'public.server_cancel_personnel_file(uuid,uuid,uuid)',
 'public.server_personnel_file_material(uuid,uuid)',
 'public.server_complete_personnel_download(uuid,uuid,uuid,text)']) signature),false)
union all select 'Material sin lectura directa',coalesce(
 not has_table_privilege('authenticated',to_regclass('stc_private.personnel_file_material'),'SELECT')
 and not has_table_privilege('service_role',to_regclass('stc_private.personnel_file_material'),'SELECT'),false)
union all select 'Anónimo sin lectura de expedientes',coalesce(
 not has_table_privilege('anon',to_regclass('public.stc_personnel_files'),'SELECT'),false)
union all select 'Bucket privado de 5 MiB',exists(
 select 1 from storage.buckets where id='stc-documents' and not public and file_size_limit=5242880);
