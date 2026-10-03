import { FileCheck2, FileLock2, Files, UsersRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BadgeTone } from '../../components/ui/Badge'
import type { DocumentCategory, DocumentStatus } from './types'

export const categories: Record<
  DocumentCategory,
  {
    label: string
    shortLabel: string
    icon: LucideIcon
    tone: BadgeTone
    protection: string
  }
> = {
  memorandum: {
    label: 'Memorándum',
    shortLabel: 'Memorándums',
    icon: FileCheck2,
    tone: 'purple',
    protection: 'Firma digital',
  },
  expediente: {
    label: 'Expediente de personal',
    shortLabel: 'Expedientes',
    icon: FileLock2,
    tone: 'blue',
    protection: 'Cifrado para destinatarios',
  },
  nota: {
    label: 'Nota diplomática',
    shortLabel: 'Notas diplomáticas',
    icon: Files,
    tone: 'purple',
    protection: 'Firma y cifrado',
  },
  especial: {
    label: 'Nota diplomática especial',
    shortLabel: 'Notas especiales',
    icon: UsersRound,
    tone: 'green',
    protection: 'Acceso conjunto',
  },
}
export const documentStatuses: Record<
  DocumentStatus,
  { label: string; tone: BadgeTone }
> = {
  signed: { label: 'Firmado', tone: 'green' },
  encrypted: { label: 'Cifrado', tone: 'blue' },
  'awaiting-signature': { label: 'Firma pendiente', tone: 'amber' },
  'joint-access': { label: 'Acceso conjunto', tone: 'purple' },
}
export function formatDocumentDate(date: string) {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}
