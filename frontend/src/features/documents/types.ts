export type DocumentCategory =
  'memorandum' | 'expediente' | 'nota' | 'especial' | 'acuerdo'
export type DocumentStatus =
  | 'draft'
  | 'pending-approval'
  | 'ready-to-send'
  | 'sent'
  | 'legacy'
  | 'signed'
  | 'encrypted'
  | 'awaiting-signature'
  | 'joint-access'
  | 'partially-signed'
export interface DocumentRecord {
  id: string
  folio?: string
  title: string
  category: DocumentCategory
  status: DocumentStatus
  office: string
  recipientCount: number
  updatedAt: string
  description: string
  encrypted: boolean
  signatureVerified: boolean
}
