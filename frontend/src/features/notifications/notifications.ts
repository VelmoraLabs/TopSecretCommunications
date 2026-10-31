import { apiRequest } from '../../lib/api'

export type NotificationCategory =
  'groups' | 'documents' | 'recovery' | 'account'
export interface Notification {
  id: string
  category: NotificationCategory
  event_type: string
  target_kind:
    | 'group'
    | 'document'
    | 'note'
    | 'recovery'
    | 'keys'
    | 'account'
    | 'personnel_file'
    | 'diplomatic_note'
  target_id: string | null
  related_id: string | null
  title: string
  body: string
  created_at: string
  read_at: string | null
}
export interface NotificationPage {
  items: Notification[]
  total: number
  unread_count: number
  limit: number
  offset: number
  snapshot_at: string
}
export const notificationCategories = {
  groups: 'Grupos',
  documents: 'Documentos',
  recovery: 'Recuperaciones',
  account: 'Mi cuenta',
}
export const entityId = (value: string | null) =>
  value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null

/** Rutas locales predeterminadas. Nunca se navega a una URL enviada en el aviso. */
export function notificationTarget(item: Notification): string {
  const id = entityId(item.target_id),
    note = entityId(item.related_id)
  switch (item.target_kind) {
    case 'group':
      return id ? `/grupos?grupo=${id}` : '/grupos'
    case 'document':
      return id ? `/documentos?documento=${id}` : '/documentos'
    case 'personnel_file':
      return id ? `/expedientes?expediente=${id}` : '/expedientes'
    case 'diplomatic_note':
      return id ? `/notas-diplomaticas?nota=${id}` : '/notas-diplomaticas'
    case 'note':
      return id ? `/notas-especiales?nota=${id}` : '/notas-especiales'
    case 'recovery':
      return id && note
        ? `/notas-especiales?nota=${note}&solicitud=${id}`
        : '/notas-especiales'
    case 'keys':
      return '/claves'
    default:
      return '/dashboard'
  }
}
export const notificationTime = (value: string) =>
  new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
export function listNotifications(
  state = 'all',
  category = 'all',
  offset = 0,
  limit = 20,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    state,
    category,
    offset: String(offset),
    limit: String(limit),
  })
  return apiRequest<NotificationPage>(`/api/v1/notifications?${params}`, {
    signal,
  })
}
export const markNotificationRead = (id: string) =>
  apiRequest<void>(`/api/v1/notifications/${id}/read`, { method: 'POST' })
export const markAllNotificationsRead = (before: string) =>
  apiRequest<void>('/api/v1/notifications/read-all', {
    method: 'POST',
    body: JSON.stringify({ before }),
  })
