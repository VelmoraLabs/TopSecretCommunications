import type { GeneratedKey } from './memoranda'

export const SIGNING_BACKUP_MAX_SIZE = 32 * 1024
const PRIVATE_MAX_SIZE = 16384
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fingerprint = /^[0-9a-f]{64}$/

export interface SigningPrivateKeyFile {
  format: 'stc-signing-private-key'
  version: 1
  purpose: 'document-signing'
  profile_id: string
  key_id: string
  fingerprint: string
  private_base64: string
}

export interface SigningKeyReference {
  id: string
  fingerprint: string
  profile_id?: string
}

function canonicalPrivate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > PRIVATE_MAX_SIZE ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('La privada de firma no contiene Base64 válido.')
  try {
    if (btoa(atob(value)) !== value) throw new Error('Base64 no canónico')
  } catch {
    throw new Error('La privada de firma no contiene Base64 válido.')
  }
  return value
}

export function signingPrivateFilename(keyId: string): string {
  return `firma-${keyId}.stckey.json`
}

/** El contenedor añade identidad; el PKCS#8 cifrado se conserva sin cambios. */
export function signingPrivateKeyData(
  generated: GeneratedKey,
  profileId: string,
): SigningPrivateKeyFile {
  if (
    !uuid.test(profileId) ||
    !uuid.test(generated.key.id) ||
    !fingerprint.test(generated.key.fingerprint)
  )
    throw new Error('No se pudo identificar la llave de firma y su perfil.')
  return {
    format: 'stc-signing-private-key',
    version: 1,
    purpose: 'document-signing',
    profile_id: profileId,
    key_id: generated.key.id,
    fingerprint: generated.key.fingerprint,
    private_base64: canonicalPrivate(generated.private_base64),
  }
}

export function signingFileError(file: File | null): string {
  if (!file)
    return 'Selecciona tu privada de firma cifrada (.stckey.json o .txt anterior).'
  if (!file.size) return 'El archivo de la llave de firma está vacío.'
  if (file.size > SIGNING_BACKUP_MAX_SIZE) return 'El respaldo de firma supera los 32 KiB.'
  return ''
}

/** Devuelve solo el PKCS#8 cifrado que ya acepta la API, nunca el JSON completo. */
export async function readSigningPrivateFile(
  file: File,
  expected: SigningKeyReference,
): Promise<string> {
  const issue = signingFileError(file)
  if (issue) throw new Error(issue)
  const text = (await file.text()).trim()
  if (
    file.name.toLowerCase().endsWith('.json') ||
    text.startsWith('{') ||
    text.startsWith('[')
  ) {
    let value: unknown
    try {
      value = JSON.parse(text) as unknown
    } catch {
      throw new Error('El respaldo de firma no contiene JSON válido.')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('El respaldo de firma no es válido.')
    const data = value as Record<string, unknown>
    const fields = [
      'format', 'version', 'purpose', 'profile_id', 'key_id',
      'fingerprint', 'private_base64',
    ]
    if (
      data.format !== 'stc-signing-private-key' ||
      data.version !== 1 ||
      data.purpose !== 'document-signing'
    )
      throw new Error('Selecciona un respaldo de firma RSA-PSS, no una llave de cifrado.')
    if (
      Object.keys(data).length !== fields.length ||
      !fields.every((field) => Object.hasOwn(data, field))
    )
      throw new Error('El respaldo de firma está incompleto o contiene campos no admitidos.')
    if (
      typeof data.profile_id !== 'string' ||
      !uuid.test(data.profile_id) ||
      typeof data.key_id !== 'string' ||
      !uuid.test(data.key_id) ||
      typeof data.fingerprint !== 'string' ||
      !fingerprint.test(data.fingerprint)
    )
      throw new Error('Los identificadores del respaldo de firma no son válidos.')
    if (
      data.key_id !== expected.id ||
      data.fingerprint !== expected.fingerprint ||
      (expected.profile_id !== undefined && data.profile_id !== expected.profile_id)
    )
      throw new Error('El respaldo pertenece a otro perfil o a otra llave de firma. Selecciona la llave registrada indicada.')
    return canonicalPrivate(data.private_base64)
  }
  // Compatibilidad: los respaldos antiguos contienen únicamente Base64 en texto.
  if (file.size > PRIVATE_MAX_SIZE)
    throw new Error('La privada de firma anterior supera los 16 KiB.')
  return canonicalPrivate(text)
}
