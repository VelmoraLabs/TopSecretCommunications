// Publicly available workflows. Legacy categories remain in the API contracts.
export const documentWorkflows = [
  {
    category: 'memorandum',
    title: 'Memorándums',
    destination: '/documentos?tipo=memorandum',
    description: 'Prepara un borrador, firma y envía a las personas designadas. Puedes solicitar aprobación del Embajador.',
    protection: 'Firma antes del envío',
  },
  {
    category: 'expediente',
    title: 'Expedientes de personal',
    destination: '/expedientes',
    description: 'Comparte archivos cifrados con destinatarios específicos. Cada persona los abre con su propia llave.',
    protection: 'Acceso individual',
  },
  {
    category: 'nota',
    title: 'Notas y comunicados',
    destination: '/notas-diplomaticas',
    description: 'Firma y cifra una comunicación. Cada destinatario recupera el archivo con verificación de su firma e integridad.',
    protection: 'Firma y cifrado',
  },
  {
    category: 'especial',
    title: 'Notas especiales',
    destination: '/notas-especiales',
    description: 'Distribuye fragmentos entre los integrantes del grupo. Recupera el archivo con las aportaciones de todos.',
    protection: 'Acceso conjunto',
  },
] as const

export function showAgreementCategory(count: number | undefined, selected: string) {
  return Boolean(count && count > 0) || selected === 'acuerdo'
}
