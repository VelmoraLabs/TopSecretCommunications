-- Inventario de solo lectura. Ejecutar como postgres después de la migración
-- 20261031000000_diplomatic_notifications_dashboard.sql. Nueve filas en true.
select 'Destino de avisos de notas y comunicados' as componente, exists(
 select 1 from pg_constraint where conrelid=to_regclass('public.stc_notifications')
 and conname='stc_notifications_target_kind_check'
 and position('diplomatic_note' in pg_get_constraintdef(oid))>0
) as correcto
union all select 'Trigger de publicación',exists(
 select 1 from pg_trigger where tgrelid=to_regclass('public.stc_diplomatic_note_audit')
 and tgname='stc_notify_diplomatic_note' and not tgisinternal and tgenabled='O'
)
union all select 'Evento de notas y comunicados reconocido',coalesce(
 position('communique_shared' in pg_get_functiondef(to_regprocedure(
 'stc_private.notify_profile(uuid,text,text,uuid,uuid,text)')))>0,false)
union all select 'Contexto privado de la nota o comunicado',coalesce(
 position('diplomatic_note' in pg_get_functiondef(to_regprocedure(
 'stc_private.capture_notification_context(uuid,boolean)')))>0,false)
union all select 'Proyección comprueba acceso actual',coalesce(
 position('diplomatic_note_visible' in pg_get_functiondef(to_regprocedure(
 'stc_private.notification_item(uuid)')))>0,false)
union all select 'Dashboard integra notas y comunicados y cargas',coalesce(
 position('pending_diplomatic' in pg_get_functiondef(to_regprocedure('public.stc_dashboard()')))>0
 and position('diplomatic_total' in pg_get_functiondef(to_regprocedure('public.stc_dashboard()')))>0,false)
union all select 'Trigger sin ejecución de clientes',coalesce(
 not has_function_privilege('authenticated',to_regprocedure('stc_private.notify_diplomatic_note_event()'),'EXECUTE')
 and not has_function_privilege('service_role',to_regprocedure('stc_private.notify_diplomatic_note_event()'),'EXECUTE'),false)
union all select 'Resumen reservado a sesión autenticada',coalesce(
 has_function_privilege('authenticated',to_regprocedure('public.stc_dashboard()'),'EXECUTE')
 and not has_function_privilege('anon',to_regprocedure('public.stc_dashboard()'),'EXECUTE'),false)
union all select 'Trigger de expedientes conservado',exists(
 select 1 from pg_trigger where tgrelid=to_regclass('public.stc_personnel_file_audit')
 and tgname='stc_notify_personnel_file' and not tgisinternal and tgenabled='O'
);
