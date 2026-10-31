import { apiRequest } from '../../lib/api'
import {
  documentFileError,
  passwordError,
  textError,
} from '../../lib/validation'
import { fileBase64 } from '../documents/memoranda'
import type { SigningKey } from '../documents/memoranda'
import { readPrivateKey } from '../group-notes/encryptionKeys'
import { entityId } from '../notifications/notifications'
import type {
  PersonnelFile,
  PersonnelParticipant,
} from '../personnel-files/personnelFiles'
export {
  personnelSize as diplomaticSize,
  personnelStates as diplomaticStates,
} from '../personnel-files/personnelFiles'

export type NoteKind = 'diplomatic_note' | 'communique'
export type NoteFilter = NoteKind | 'all'
export const noteKinds: Record<NoteKind, string> = {
  diplomatic_note: 'Nota diplomática',
  communique: 'Comunicado',
}
export interface DiplomaticNote extends PersonnelFile {
  kind: NoteKind
  signing_key_id: string
}
export interface DiplomaticDetail {
  file: DiplomaticNote
  participants: PersonnelParticipant[]
  signer: {
    profile_id: string
    display_name: string
    key_id: string
    fingerprint: string
    is_active: boolean
  }
}
export interface DiplomaticPage {
  items: DiplomaticNote[]
  total: number
  limit: number
  offset: number
}
export interface DiplomaticDownload {
  filename: string
  media_type: string
  size: number
  content_base64: string
  document_id: string
  version_id: string
  issuer_id: string
  signing_key_id: string
  signing_fingerprint: string
  verification: 'signature-and-integrity'
}
const endpoint = '/api/v1/diplomatic-notes'
function noteEndpoint(id: string) {
  if (!entityId(id))
    throw new Error('El identificador de la nota no es válido.')
  return `${endpoint}/${id}`
}
export function getDiplomaticNotes(
  search = '',
  kind: NoteFilter = 'all',
  offset = 0,
  signal?: AbortSignal,
  limit = 20,
) {
  if (
    !['all', 'diplomatic_note', 'communique'].includes(kind) ||
    search.trim().length > 80 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error(
      'Revisa los filtros y la página de notas y comunicados.',
    )
  const params = new URLSearchParams({
    search: search.trim(),
    kind,
    offset: String(offset),
    limit: String(limit),
  })
  return apiRequest<DiplomaticPage>(`${endpoint}?${params}`, { signal })
}
export const getDiplomaticNote = (id: string, signal?: AbortSignal) =>
  apiRequest<DiplomaticDetail>(noteEndpoint(id), { signal })
export const cancelDiplomaticNote = (id: string) =>
  apiRequest<DiplomaticDetail>(`${noteEndpoint(id)}/cancel`, {
    method: 'POST',
  })

export function signingFileError(file: File | null): string {
  if (!file) return 'Selecciona tu privada de firma cifrada (.txt).'
  if (!file.size) return 'El archivo de la clave de firma está vacío.'
  if (file.size > 16384) return 'La privada de firma supera los 16 KiB.'
  return ''
}
export async function readSigningPrivateFile(file: File) {
  const issue = signingFileError(file)
  if (issue) throw new Error(issue)
  const value = (await file.text()).trim()
  if (
    !value ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error(
      'Selecciona la privada de firma en Base64 (.txt), no el respaldo de cifrado .stckey.json.',
    )
  try {
    if (btoa(atob(value)) !== value) throw new Error('Base64 no canónico')
  } catch {
    throw new Error('El archivo de firma no contiene Base64 válido.')
  }
  return value
}
export async function createDiplomaticNote(
  kind: NoteKind,
  title: string,
  file: File,
  recipients: string[],
  signingKey: SigningKey,
  privateFile: File,
  password: string,
) {
  const issue =
    textError(title, 'el título del documento', 160) ||
    documentFileError(file) ||
    passwordError(password)
  if (issue) throw new Error(issue)
  if (!['diplomatic_note', 'communique'].includes(kind))
    throw new Error('Selecciona nota diplomática o comunicado.')
  if (
    !recipients.length ||
    recipients.length > 255 ||
    new Set(recipients).size !== recipients.length ||
    recipients.some((id) => !entityId(id))
  )
    throw new Error('Selecciona entre 1 y 255 destinatarios distintos.')
  if (!signingKey.is_active || !entityId(signingKey.id))
    throw new Error('Selecciona una clave de firma activa de tu cuenta.')
  const privateKey = await readSigningPrivateFile(privateFile)
  return apiRequest<DiplomaticDetail>(
    endpoint,
    {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        kind,
        title: title.trim(),
        filename: file.name,
        media_type: file.type || 'application/octet-stream',
        content_base64: await fileBase64(file),
        recipients: recipients.map((profile_id) => ({ profile_id })),
        signing_key_id: signingKey.id,
        private_key_base64: privateKey,
        password,
      }),
    },
    false,
  )
}
export async function openDiplomaticNote(
  detail: DiplomaticDetail,
  profileId: string,
  file: File,
  password: string,
) {
  const path = noteEndpoint(detail.file.id)
  const assigned = detail.participants.find(
    (p) => p.profile_id === profileId,
  )
  if (detail.file.state !== 'ready' || !assigned?.is_active)
    throw new Error('Este documento no está disponible para tu cuenta.')
  const issue = passwordError(password)
  if (issue) throw new Error(issue)
  const key = await readPrivateKey(file, {
    profile_id: profileId,
    id: assigned.key_id,
    fingerprint: assigned.fingerprint,
  })
  const result = await apiRequest<DiplomaticDownload>(
    `${path}/file`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        version_id: detail.file.version_id,
        key_id: assigned.key_id,
        private_key_base64: key.private_base64,
        password,
      }),
    },
    false,
  )
  // No mostrar una verificación de otro documento ni guardar respuestas incompletas.
  if (
    !result ||
    result.verification !== 'signature-and-integrity' ||
    result.document_id !== detail.file.id ||
    result.version_id !== detail.file.version_id ||
    result.issuer_id !== detail.file.created_by ||
    result.signing_key_id !== detail.file.signing_key_id ||
    result.signing_key_id !== detail.signer.key_id ||
    result.signing_fingerprint !== detail.signer.fingerprint ||
    result.filename !== detail.file.filename ||
    result.media_type !== detail.file.media_type ||
    result.size !== detail.file.size ||
    typeof result.content_base64 !== 'string'
  )
    throw new Error(
      'La recuperación no coincide con el documento y la firma originales. Actualiza el detalle.',
    )
  try {
    const decoded = atob(result.content_base64)
    if (
      decoded.length !== result.size ||
      btoa(decoded) !== result.content_base64
    )
      throw new Error('Contenido inválido')
  } catch {
    throw new Error(
      'El archivo recuperado está incompleto o tiene un formato inválido.',
    )
  }
  return result
}
