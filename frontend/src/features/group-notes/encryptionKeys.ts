import { apiRequest } from '../../lib/api'

export interface EncryptionKey {
  id: string
  profile_id: string
  label: string
  public_base64: string
  fingerprint: string
  state: 'pending' | 'active' | 'retired'
  created_at: string
  activated_at: string | null
  retired_at: string | null
}
export interface GeneratedEncryptionKey {
  key: EncryptionKey
  private_base64: string
}
export interface PrivateKeyFile {
  format: 'stc-encryption-private-key'
  version: 1
  purpose: 'group-note-share-custody'
  profile_id: string
  key_id: string
  fingerprint: string
  private_base64: string
}
const endpoint = '/api/v1/encryption-keys'
export const getEncryptionKeys = (signal?: AbortSignal) =>
  apiRequest<{ items: EncryptionKey[] }>(endpoint, { signal })
export const generateEncryptionKey = (label: string, password: string) =>
  apiRequest<GeneratedEncryptionKey>(endpoint, {
    method: 'POST',
    body: JSON.stringify({ label: label.trim(), password }),
  })
export const activateEncryptionKey = (
  id: string,
  privateKey: string,
  password: string,
) =>
  apiRequest<EncryptionKey>(`${endpoint}/${id}/activate`, {
    method: 'POST',
    body: JSON.stringify({ private_key_base64: privateKey, password }),
  })
export const retireEncryptionKey = (id: string) =>
  apiRequest<void>(`${endpoint}/${id}/retire`, { method: 'POST' })
export function privateKeyData(
  generated: GeneratedEncryptionKey,
): PrivateKeyFile {
  return {
    format: 'stc-encryption-private-key',
    version: 1,
    purpose: 'group-note-share-custody',
    profile_id: generated.key.profile_id,
    key_id: generated.key.id,
    fingerprint: generated.key.fingerprint,
    private_base64: generated.private_base64,
  }
}
export async function readPrivateKey(
  file: File,
  expected: {
    profile_id: string
    id: string
    fingerprint: string
  },
): Promise<PrivateKeyFile> {
  if (file.size > 32 * 1024)
    throw new Error(
      'La clave supera los 32 KiB. Selecciona el archivo de cifrado correcto.',
    )
  let value: unknown
  try {
    value = JSON.parse(await file.text()) as unknown
  } catch {
    throw new Error(
      'Selecciona el archivo .stckey.json de tu clave de cifrado.',
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('El archivo de clave no es válido.')
  const data = value as Record<string, unknown>
  if (
    data.format !== 'stc-encryption-private-key' ||
    data.version !== 1 ||
    data.purpose !== 'group-note-share-custody'
  )
    throw new Error(
      'Selecciona una clave de cifrado de notas, no una clave de firma.',
    )
  if (
    data.profile_id !== expected.profile_id ||
    data.key_id !== expected.id ||
    data.fingerprint !== expected.fingerprint
  )
    throw new Error(
      'Esta clave pertenece a otro perfil o a otra generación. Selecciona la clave indicada.',
    )
  if (
    typeof data.private_base64 !== 'string' ||
    !data.private_base64.length ||
    data.private_base64.length > 16384 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data.private_base64)
  )
    throw new Error('El contenido de la clave cifrada no es válido.')
  return data as unknown as PrivateKeyFile
}
