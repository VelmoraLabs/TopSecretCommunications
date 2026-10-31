import { apiRequest } from '../../lib/api'
import {
  documentFileError,
  passwordError,
  textError,
} from '../../lib/validation'
import { fileBase64 } from '../documents/memoranda'
import { readPrivateKey } from '../group-notes/encryptionKeys'
import { entityId } from '../notifications/notifications'

export interface PersonnelFile {
  id: string
  version_id: string
  created_by: string
  title: string
  filename: string
  media_type: string
  size: number
  state: 'staging' | 'ready' | 'cancelled'
  created_at: string
  ready_at: string | null
}
export interface PersonnelParticipant {
  profile_id: string
  display_name: string
  email: string
  key_id: string
  fingerprint: string
  is_active: boolean
}
export interface PersonnelDetail {
  file: PersonnelFile
  participants: PersonnelParticipant[]
}
export interface PersonnelPage {
  items: PersonnelFile[]
  total: number
  limit: number
  offset: number
}
export interface PersonnelDownload {
  filename: string
  media_type: string
  size: number
  content_base64: string
}
export const personnelStates = {
  staging: 'Carga incompleta',
  ready: 'Disponible',
  cancelled: 'Carga cancelada',
}
const endpoint = '/api/v1/personnel-files'
function fileEndpoint(id: string) {
  if (!entityId(id))
    throw new Error('El identificador del expediente no es válido.')
  return `${endpoint}/${id}`
}
export function getPersonnelFiles(
  search = '',
  offset = 0,
  signal?: AbortSignal,
  limit = 20,
) {
  const params = new URLSearchParams({
    search: search.trim(),
    offset: String(offset),
    limit: String(limit),
  })
  return apiRequest<PersonnelPage>(`${endpoint}?${params}`, { signal })
}
export const getPersonnelFile = (id: string, signal?: AbortSignal) =>
  apiRequest<PersonnelDetail>(fileEndpoint(id), { signal })
export const cancelPersonnelFile = (id: string) =>
  apiRequest<PersonnelDetail>(`${fileEndpoint(id)}/cancel`, {
    method: 'POST',
  })

/** Las identidades son asignaciones; claves, actor e IDs los resuelve el servidor. */
export async function createPersonnelFile(
  title: string,
  file: File,
  recipients: string[],
) {
  const issue =
    textError(title, 'el título del expediente', 160) ||
    documentFileError(file)
  if (issue) throw new Error(issue)
  if (
    !recipients.length ||
    recipients.length > 255 ||
    new Set(recipients).size !== recipients.length ||
    recipients.some((id) => !entityId(id))
  )
    throw new Error('Selecciona entre 1 y 255 destinatarios distintos.')
  return apiRequest<PersonnelDetail>(endpoint, {
    method: 'POST',
    // No se reintenta una creación por un fallo de red: antes se consulta la lista.
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      title: title.trim(),
      filename: file.name,
      media_type: file.type || 'application/octet-stream',
      content_base64: await fileBase64(file),
      recipients: recipients.map((profile_id) => ({ profile_id })),
    }),
  })
}

/** Comprueba el respaldo original, incluso si su clave ya se retiró para altas nuevas. */
export async function openPersonnelFile(
  detail: PersonnelDetail,
  profileId: string,
  file: File,
  password: string,
) {
  const path = fileEndpoint(detail.file.id)
  const assigned = detail.participants.find(
    (person) => person.profile_id === profileId,
  )
  if (detail.file.state !== 'ready' || !assigned || !assigned.is_active)
    throw new Error('Este expediente no está disponible para tu cuenta.')
  const issue = passwordError(password)
  if (issue) throw new Error(issue)
  const key = await readPrivateKey(file, {
    profile_id: profileId,
    id: assigned.key_id,
    fingerprint: assigned.fingerprint,
  })
  return apiRequest<PersonnelDownload>(`${path}/file`, {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      version_id: detail.file.version_id,
      key_id: assigned.key_id,
      private_key_base64: key.private_base64,
      password,
    }),
  })
}

export function personnelSize(size: number) {
  return size < 1024
    ? `${size} bytes`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / (1024 * 1024)).toFixed(1)} MiB`
}
