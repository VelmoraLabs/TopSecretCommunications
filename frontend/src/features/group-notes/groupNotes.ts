import { apiRequest } from '../../lib/api'
import { fileBase64 } from '../documents/memoranda'
import {
  readPackage,
  readShares,
  recoverySharesError,
} from '../documents/specialNotes'
import type { NotePackage } from '../documents/specialNotes'

export interface Participant {
  profile_id: string
  display_name: string
  email: string
  group_role: 'manager' | 'member'
  share_index: number
  encryption_key_id?: string | null
  encryption_fingerprint?: string | null
}
export interface NoteGroup {
  id: string
  name: string
  version: number
  members: (Omit<Participant, 'share_index'> & {
    is_active: boolean
    encryption_ready: boolean
  })[]
}
export interface GroupNote {
  id: string
  group_id: string
  group_name: string
  group_version: number
  title: string
  created_by: string
  creator_name: string
  filename: string
  media_type: string
  size: number
  participant_count: number
  threshold: number
  custody_mode: 'portable' | 'individual-v1'
  state: 'staging' | 'awaiting_backup' | 'ready' | 'cancelled'
  created_at: string
  ready_at: string | null
}
export interface NoteDetail {
  note: GroupNote
  participants: Participant[]
  package_header: Omit<NotePackage, 'ciphertext_base64'> | null
  ciphertext_sha256: string | null
}
interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
const endpoint = '/api/v1/group-notes'
export const stateNames: Record<GroupNote['state'], string> = {
  staging: 'Carga pendiente',
  awaiting_backup: 'Falta confirmar resguardo',
  ready: 'Compartida',
  cancelled: 'Cancelada',
}
export const listNotes = (
  search: string,
  offset: number,
  signal?: AbortSignal,
) =>
  apiRequest<Page<GroupNote>>(
    `${endpoint}?${new URLSearchParams({ search, offset: String(offset), limit: '20' })}`,
    { signal },
  )
export const listNoteGroups = (
  search: string,
  offset: number,
  signal?: AbortSignal,
) =>
  apiRequest<Page<NoteGroup>>(
    `${endpoint}/groups?${new URLSearchParams({ search, offset: String(offset), limit: '20' })}`,
    { signal },
  )
export const getNote = (id: string, signal?: AbortSignal) =>
  apiRequest<NoteDetail>(`${endpoint}/${id}`, { signal })
export const getPackage = (id: string) =>
  apiRequest<NotePackage>(`${endpoint}/${id}/package`)
export const cancelNote = (id: string) =>
  apiRequest<void>(`${endpoint}/${id}/cancel`, { method: 'POST' })
export const confirmBackup = (id: string, receipt: string) =>
  apiRequest<NoteDetail>(`${endpoint}/${id}/confirm-backup`, {
    method: 'POST',
    body: JSON.stringify({ backup_receipt: receipt }),
  })
export async function createNote(
  id: string,
  group: NoteGroup,
  title: string,
  file: File,
) {
  return apiRequest<NoteDetail>(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      request_id: id,
      group_id: group.id,
      group_version: group.version,
      title: title.trim(),
      filename: file.name,
      media_type: file.type || 'application/octet-stream',
      content_base64: await fileBase64(file),
    }),
  })
}
export function groupProblem(group: NoteGroup | null): string {
  if (!group) return 'Selecciona el grupo destinatario.'
  if (group.members.length < 2 || group.members.length > 20)
    return 'El grupo debe tener entre 2 y 20 integrantes para esta nota.'
  if (group.members.some((person) => !person.is_active))
    return 'El grupo contiene perfiles desactivados. Revisa sus integrantes antes de continuar.'
  const missing = group.members.filter((person) => !person.encryption_ready)
  if (missing.length)
    return `Falta activar la clave de cifrado de: ${missing.map((person) => person.display_name).join(', ')}. Cada persona debe hacerlo desde Mis claves.`
  return ''
}
export interface NoteBackup {
  noteId: string
  package: NotePackage
  shares: string[]
  receipt: string
}
export async function readBackup(
  file: File,
  expected?: NoteDetail,
): Promise<NoteBackup> {
  if (file.size > 8 * 1024 * 1024)
    throw new Error('El resguardo supera los 8 MiB.')
  let value: unknown
  try {
    value = JSON.parse(await file.text()) as unknown
  } catch {
    throw new Error('Selecciona un resguardo JSON válido.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('El resguardo no tiene el formato esperado.')
  const data = value as Record<string, unknown>
  if (
    data.format !== 'stc-group-note-backup' ||
    data.version !== 1 ||
    typeof data.note_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.note_id,
    ) ||
    typeof data.backup_receipt !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.backup_receipt) ||
    !Array.isArray(data.shares) ||
    !Array.isArray(data.participants) ||
    data.shares.length < 2 ||
    data.shares.length > 20
  )
    throw new Error('Selecciona el resguardo completo de una nota de grupo.')
  if (expected && data.note_id !== expected.note.id)
    throw new Error(
      'Este resguardo pertenece a otra nota. Selecciona el archivo correcto.',
    )
  const pkg = await readPackage(
    new File([JSON.stringify(data.package)], 'package.json', {
      type: 'application/json',
    }),
  )
  const parts: string[] = [],
    seen = new Set<string>()
  for (const [index, item] of data.shares.entries()) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.share !== 'string' ||
      typeof item.profile_id !== 'string' ||
      item.share_index !== index + 1 ||
      seen.has(item.profile_id)
    )
      throw new Error('Las asignaciones del resguardo son inválidas.')
    const participant = data.participants[index]
    if (
      !participant ||
      participant.profile_id !== item.profile_id ||
      participant.share_index !== item.share_index ||
      (expected &&
        (expected.participants[index]?.profile_id !== item.profile_id ||
          expected.participants[index]?.share_index !== item.share_index))
    )
      throw new Error(
        'Los participantes del resguardo no corresponden a esta nota.',
      )
    seen.add(item.profile_id)
    parts.push(item.share)
  }
  if (
    data.participants.length !== parts.length ||
    parts.length !== pkg.share_count ||
    (expected &&
      (expected.participants.length !== parts.length ||
        expected.package_header?.document_id !== pkg.document_id))
  )
    throw new Error('El resguardo no corresponde al paquete de esta nota.')
  const shares = await readShares(
    parts.map((part, i) => new File([part], `fragmento-${i + 1}.json`)),
  )
  const error = recoverySharesError(pkg, shares)
  if (error) throw new Error(error)
  return {
    noteId: data.note_id,
    package: pkg,
    shares,
    receipt: data.backup_receipt,
  }
}

export const getOwnShare = (id: string) =>
  apiRequest<unknown>(`${endpoint}/${id}/my-share`)
export const checkOwnShare = (
  id: string,
  privateKey: string,
  password: string,
) =>
  apiRequest<{
    note_id: string
    key_id: string
    share_index: number
    valid: true
  }>(`${endpoint}/${id}/my-share/check`, {
    method: 'POST',
    body: JSON.stringify({ private_key_base64: privateKey, password }),
  })
