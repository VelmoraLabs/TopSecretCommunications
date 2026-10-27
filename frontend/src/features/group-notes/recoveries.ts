import { apiRequest } from '../../lib/api'
import type { RecoveryResult } from '../documents/specialNotes'

export type RecoveryState =
  'pending' | 'ready' | 'completed' | 'cancelled' | 'rejected' | 'expired'
export interface Recovery {
  id: string
  note_id: string
  requester_id: string
  requester_name: string
  reason: string
  state: RecoveryState
  participant_count: number
  contribution_count: number
  created_at: string
  expires_at: string
  completed_at: string | null
  download_until: string | null
  version: number
  can_contribute: boolean
  can_recover: boolean
  can_cancel: boolean
  can_reject: boolean
  blocked: boolean
}
export interface RecoveryDetail {
  recovery: Recovery
  requester_key: {
    id: string
    profile_id: string
    public_base64: string
    fingerprint: string
  }
  participants: {
    profile_id: string
    display_name: string
    share_index: number
    contributed_at: string | null
    rejected_at: string | null
    is_active: boolean
  }[]
}
export interface RecoveryPage {
  items: Recovery[]
  has_open: boolean
  total: number
  limit: number
  offset: number
}
export const recoveryStates: Record<RecoveryState, string> = {
  pending: 'Reuniendo aportaciones',
  ready: 'Lista para recuperar',
  completed: 'Recuperación completada',
  cancelled: 'Cancelada',
  rejected: 'Rechazada',
  expired: 'Vencida',
}
export const listRecoveries = (
  note: string,
  offset = 0,
  signal?: AbortSignal,
) =>
  apiRequest<RecoveryPage>(
    `/api/v1/group-notes/${note}/recoveries?limit=20&offset=${offset}`,
    { signal },
  )
export const getRecovery = (id: string, signal?: AbortSignal) =>
  apiRequest<RecoveryDetail>(`/api/v1/note-recoveries/${id}`, { signal })
export const createRecovery = (
  note: string,
  id: string,
  reason: string,
  duration: number,
) =>
  apiRequest<RecoveryDetail>(`/api/v1/group-notes/${note}/recoveries`, {
    method: 'POST',
    body: JSON.stringify({
      request_id: id,
      reason: reason.trim(),
      duration_minutes: duration,
    }),
  })
export const contributeRecovery = (
  id: string,
  privateKey: string,
  password: string,
) =>
  apiRequest<RecoveryDetail>(`/api/v1/note-recoveries/${id}/contribute`, {
    method: 'POST',
    body: JSON.stringify({
      private_key_base64: privateKey,
      password,
      approve: true,
    }),
  })
export const downloadRecovery = (
  id: string,
  privateKey: string,
  password: string,
) =>
  apiRequest<RecoveryResult>(`/api/v1/note-recoveries/${id}/recover`, {
    method: 'POST',
    body: JSON.stringify({ private_key_base64: privateKey, password }),
  })
export const closeRecovery = (id: string, action: 'cancel' | 'reject') =>
  apiRequest<RecoveryDetail>(`/api/v1/note-recoveries/${id}/${action}`, {
    method: 'POST',
  })
export function recoveryKey(
  detail: RecoveryDetail,
  original: {
    profile_id: string
    encryption_key_id?: string | null
    encryption_fingerprint?: string | null
  }[],
  actor: string,
  operation: 'contribute' | 'recover',
) {
  if (operation === 'recover') return detail.requester_key
  const person = original.find((p) => p.profile_id === actor)
  if (!person?.encryption_key_id || !person.encryption_fingerprint)
    throw new Error('No tienes una clave asignada a esta nota.')
  return {
    id: person.encryption_key_id,
    profile_id: person.profile_id,
    fingerprint: person.encryption_fingerprint,
  }
}
export const recoveryTime = (value: string) =>
  new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
