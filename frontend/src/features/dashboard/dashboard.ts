import { apiRequest } from '../../lib/api'
import type { DocumentCategory } from '../documents/types'
import { entityId } from '../notifications/notifications'

export interface DashboardEntry {
  id: string
  target_kind:
    'document' | 'note' | 'recovery' | 'personnel_file' | 'diplomatic_note'
  target_id: string
  related_id: string | null
  title: string
  category: DocumentCategory
  status: string
  subtitle: string
  occurred_at: string
}
export interface Dashboard {
  stats: {
    documents_total: number
    notes_total: number
    diplomatic_total: number
    personnel_total: number
    signed_total: number
    pending_total: number
    pending_documents: number
    pending_recoveries: number
    pending_notes: number
    pending_diplomatic: number
    pending_personnel: number
  }
  category_counts: Record<DocumentCategory, number>
  recent: DashboardEntry[]
  pending: DashboardEntry[]
  updated_at: string
}
export const getDashboard = (signal?: AbortSignal) =>
  apiRequest<Dashboard>('/api/v1/dashboard', { signal })

export function dashboardTarget(item: DashboardEntry) {
  const id = entityId(item.target_id),
    note = entityId(item.related_id)
  if (item.target_kind === 'document')
    return id ? `/documentos?documento=${id}` : '/documentos'
  if (item.target_kind === 'personnel_file')
    return id ? `/expedientes?expediente=${id}` : '/expedientes'
  if (item.target_kind === 'diplomatic_note')
    return id ? `/notas-diplomaticas?nota=${id}` : '/notas-diplomaticas'
  if (item.target_kind === 'recovery' && id && note)
    return `/notas-especiales?nota=${note}&solicitud=${id}`
  return id && item.target_kind === 'note'
    ? `/notas-especiales?nota=${id}`
    : '/notas-especiales'
}
