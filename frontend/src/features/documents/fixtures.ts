import type { DocumentRecord } from './types'

// Datos ficticios exclusivamente para revisar el diseño. No representan documentos reales.
export const exampleDocuments: DocumentRecord[] = [
  {
    id: 'MEM-2026-025',
    title: 'Circular de protocolo institucional',
    category: 'memorandum',
    status: 'awaiting-signature',
    office: 'Oficina del embajador',
    recipientCount: 4,
    updatedAt: '2026-10-03',
    description:
      'Ejemplo de un memorándum preparado para su revisión y firma institucional.',
    encrypted: false,
    signatureVerified: false,
  },
  {
    id: 'NDE-2026-003',
    title: 'Nota de sesión reservada',
    category: 'especial',
    status: 'joint-access',
    office: 'Coordinación diplomática',
    recipientCount: 4,
    updatedAt: '2026-10-03',
    description:
      'Ejemplo de una nota especial cuyo acceso requiere la participación conjunta de los destinatarios designados.',
    encrypted: true,
    signatureVerified: false,
  },
  {
    id: 'ND-2026-012',
    title: 'Comunicado de representación',
    category: 'nota',
    status: 'encrypted',
    office: 'Área de comunicaciones',
    recipientCount: 5,
    updatedAt: '2026-10-02',
    description:
      'Ejemplo de una comunicación diplomática destinada a un grupo específico, con firma y cifrado.',
    encrypted: true,
    signatureVerified: true,
  },
  {
    id: 'MEM-2026-024',
    title: 'Memorándum de coordinación',
    category: 'memorandum',
    status: 'signed',
    office: 'Oficina del embajador',
    recipientCount: 3,
    updatedAt: '2026-10-02',
    description:
      'Ejemplo de un documento institucional con una firma digital registrada.',
    encrypted: false,
    signatureVerified: true,
  },
  {
    id: 'ND-2026-011',
    title: 'Acuerdo de cooperación bilateral',
    category: 'nota',
    status: 'encrypted',
    office: 'Coordinación diplomática',
    recipientCount: 3,
    updatedAt: '2026-10-01',
    description:
      'Ejemplo de una nota diplomática protegida para los destinatarios designados.',
    encrypted: true,
    signatureVerified: true,
  },
  {
    id: 'EXP-2026-014',
    title: 'Expediente de personal · 014',
    category: 'expediente',
    status: 'encrypted',
    office: 'Administración de personal',
    recipientCount: 2,
    updatedAt: '2026-09-30',
    description:
      'Ejemplo de un expediente con acceso limitado al personal autorizado.',
    encrypted: true,
    signatureVerified: false,
  },
]
