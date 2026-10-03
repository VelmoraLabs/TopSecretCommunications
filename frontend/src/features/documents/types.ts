export type DocumentCategory = 'memorandum' | 'expediente' | 'nota' | 'especial'
export type DocumentStatus =
  'signed' | 'encrypted' | 'awaiting-signature' | 'joint-access'
export interface DocumentRecord {
  id: string
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
