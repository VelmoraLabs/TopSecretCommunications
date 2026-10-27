import { apiRequest } from '../../lib/api'
import type { DocumentCategory, DocumentRecord } from './types'

export interface Candidate {
  id: string
  display_name: string
  email: string
  role_code: string
  can_sign: boolean
}
export interface SigningKey {
  id: string
  label: string
  public_base64: string
  fingerprint: string
  is_active: boolean
  created_at: string
}
export interface GeneratedKey {
  key: SigningKey
  private_filename: string
  public_filename: string
  private_base64: string
}
export type WorkflowState =
  'draft' | 'pending_approval' | 'ready_to_send' | 'sent' | 'legacy_shared'
export const workflowLabels: Record<WorkflowState, string> = {
  draft: 'Borrador',
  pending_approval: 'En aprobación',
  ready_to_send: 'Listo para enviar',
  sent: 'Enviado',
  legacy_shared: 'Flujo anterior',
}
export const signaturePurposes = {
  issuer: 'Firma del emisor',
  approval: 'Aprobación del Embajador',
  legacy: 'Firma del flujo anterior',
}

export interface DocumentSummary {
  id: string
  title: string
  category: DocumentCategory
  issuer_id: string | null
  approver_id: string | null
  approver_name: string | null
  workflow_state: WorkflowState
  signing_purpose: 'issuer' | 'approval' | null
  can_request_approval: boolean
  can_send: boolean
  sent_at: string | null
  review_requested_at: string | null
  creator_name: string
  created_at: string
  updated_at: string
  version_id: string
  version_number: number
  recipient_count: number
  signer_count: number
  signature_count: number
  signature_state: 'pending' | 'partial' | 'signed'
  can_sign: boolean
}
export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
export interface DocumentPage extends Page<DocumentSummary> {
  signed_total: number
  pending_total: number
  category_counts: Record<DocumentCategory, number>
}
export interface Signature {
  purpose: keyof typeof signaturePurposes
  id: string
  signer_id: string
  signer_name: string
  key_id: string
  public_base64: string
  fingerprint: string
  key_is_active: boolean
  signature_base64: string
  created_at: string
}
export interface DocumentDetail {
  document: DocumentSummary
  version: {
    id: string
    version_number: number
    filename: string
    media_type: string
    size: number
    sha256: string
  }
  participants: {
    id: string
    display_name: string
    email: string
    can_sign: boolean
    is_issuer: boolean
    is_approver: boolean
    is_recipient: boolean
    is_active: boolean
  }[]
  signatures: Signature[]
}
export interface Verification {
  document_id: string
  version_id: string
  source: 'stored' | 'uploaded'
  content_matches: boolean
  all_valid: boolean
  signatures: {
    signature_id: string
    signer_name: string
    valid: boolean
    key_is_active: boolean
  }[]
}

export function getDocuments(
  search: string,
  category: string,
  state: string,
  offset: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    search,
    state,
    offset: String(offset),
    limit: '20',
  })
  if (category !== 'all') params.set('category', category)
  return apiRequest<DocumentPage>('/api/v1/documents?' + params, { signal })
}
export const getDocument = (id: string, signal?: AbortSignal) =>
  apiRequest<DocumentDetail>('/api/v1/documents/' + id, { signal })
export function getRecipients(
  search: string,
  offset: number,
  signal: AbortSignal,
) {
  return apiRequest<Page<Candidate>>(
    '/api/v1/documents/recipients?' +
      new URLSearchParams({ search, offset: String(offset), limit: '10' }),
    { signal },
  )
}
export function getApprovers(
  search: string,
  offset: number,
  signal: AbortSignal,
) {
  return apiRequest<Page<Candidate>>(
    '/api/v1/documents/approvers?' +
      new URLSearchParams({ search, offset: String(offset), limit: '10' }),
    { signal },
  )
}
export const requestApproval = (id: string, versionId: string) =>
  apiRequest<DocumentDetail>(`/api/v1/documents/${id}/request-approval`, {
    method: 'POST',
    body: JSON.stringify({ version_id: versionId }),
  })
export const sendDocument = (id: string, versionId: string) =>
  apiRequest<DocumentDetail>(`/api/v1/documents/${id}/send`, {
    method: 'POST',
    body: JSON.stringify({ version_id: versionId }),
  })
export const getKeys = (signal?: AbortSignal) =>
  apiRequest<{ items: SigningKey[] }>('/api/v1/signing/keys', { signal })
export const generateKey = (body: {
  label: string
  password: string
  private_filename: string
  public_filename: string
}) =>
  apiRequest<GeneratedKey>('/api/v1/signing/keys', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const retireKey = (id: string) =>
  apiRequest<void>(`/api/v1/signing/keys/${id}/retire`, { method: 'POST' })
export const createMemorandum = (body: {
  title: string
  filename: string
  media_type: string
  content_base64: string
  recipients: { profile_id: string }[]
  approver_id: string | null
}) =>
  apiRequest<DocumentDetail>('/api/v1/documents/memoranda', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const signDocument = (
  id: string,
  body: {
    key_id: string
    version_id: string
    private_key_base64: string
    password: string
  },
) =>
  apiRequest<DocumentDetail>(`/api/v1/documents/${id}/signatures`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const verifyStored = (id: string) =>
  apiRequest<Verification>(`/api/v1/documents/${id}/verification`)
export const verifyFile = (id: string, versionId: string, content: string) =>
  apiRequest<Verification>(`/api/v1/documents/${id}/verification`, {
    method: 'POST',
    body: JSON.stringify({ version_id: versionId, content_base64: content }),
  })
export const downloadDocument = (id: string) =>
  apiRequest<{
    filename: string
    media_type: string
    content_base64: string
    verification: 'integrity' | 'signatures'
  }>(`/api/v1/documents/${id}/file`)

export async function fileBase64(file: File) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error('El archivo supera el límite de 5 MiB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export function saveFile(
  filename: string,
  data: BlobPart,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
export function saveBase64(filename: string, base64: string) {
  saveFile(
    filename,
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
    'application/octet-stream',
  )
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.'

export function documentRecord(doc: DocumentSummary): DocumentRecord {
  const prefix: Record<DocumentCategory, string> = {
    memorandum: 'MEM',
    expediente: 'EXP',
    nota: 'ND',
    especial: 'NDE',
    acuerdo: 'AC',
  }
  return {
    id: doc.id,
    folio: `${prefix[doc.category]}-${doc.id.slice(0, 8).toUpperCase()}`,
    title: doc.title,
    category: doc.category,
    status: (
      {
        draft: 'draft',
        pending_approval: 'pending-approval',
        ready_to_send: 'ready-to-send',
        sent: 'sent',
        legacy_shared: 'legacy',
      } as const
    )[doc.workflow_state],
    office: doc.creator_name,
    recipientCount: doc.recipient_count,
    updatedAt: doc.updated_at,
    description: `${workflowLabels[doc.workflow_state]} · Versión ${doc.version_number} · ${doc.signature_count} de ${doc.signer_count} firmas · ${doc.creator_name}`,
    encrypted: false,
    signatureVerified: false,
  }
}
