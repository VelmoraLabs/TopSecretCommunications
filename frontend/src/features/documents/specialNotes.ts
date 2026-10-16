import { apiRequest } from '../../lib/api'

export const MAX_FILE_SIZE = 5 * 1024 * 1024
export const MAX_PACKAGE_SIZE = 8 * 1024 * 1024
export const MAX_PARTICIPANTS = 20

export interface NotePackage {
  format: 'stc-special-note'
  version: 1
  algorithm: 'AES-256-GCM+Shamir'
  document_id: string
  filename: string
  media_type: string
  size: number
  share_count: number
  threshold: number
  access_mode: 'all-members'
  nonce_base64: string
  ciphertext_base64: string
  tag_base64: string
}
export interface ProtectionResult {
  package: NotePackage
  shares: string[]
}
export interface RecoveryResult {
  filename: string
  media_type: string
  size: number
  content_base64: string
}

const endpoint = '/api/v1/documents/special-notes'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(label + ' no contiene JSON válido.', { cause: error })
  }
}

function parsePackage(value: unknown): NotePackage {
  const keys = [
    'format',
    'version',
    'algorithm',
    'document_id',
    'filename',
    'media_type',
    'size',
    'share_count',
    'threshold',
    'access_mode',
    'nonce_base64',
    'ciphertext_base64',
    'tag_base64',
  ]
  if (
    !isRecord(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    value.format !== 'stc-special-note' ||
    value.version !== 1 ||
    value.algorithm !== 'AES-256-GCM+Shamir' ||
    value.access_mode !== 'all-members' ||
    typeof value.document_id !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.document_id) ||
    typeof value.filename !== 'string' ||
    !value.filename.length ||
    value.filename.length > 180 ||
    typeof value.media_type !== 'string' ||
    !value.media_type.length ||
    typeof value.size !== 'number' ||
    !Number.isInteger(value.size) ||
    value.size < 0 ||
    value.size > MAX_FILE_SIZE ||
    typeof value.share_count !== 'number' ||
    !Number.isInteger(value.share_count) ||
    value.share_count < 2 ||
    value.share_count > MAX_PARTICIPANTS ||
    value.threshold !== value.share_count ||
    typeof value.nonce_base64 !== 'string' ||
    value.nonce_base64.length !== 16 ||
    typeof value.tag_base64 !== 'string' ||
    value.tag_base64.length !== 24 ||
    typeof value.ciphertext_base64 !== 'string' ||
    value.ciphertext_base64.length > 4 * Math.ceil(MAX_FILE_SIZE / 3)
  )
    throw new Error(
      'Selecciona un paquete completo de nota especial en formato v1.',
    )
  // El backend comprueba Base64, metadatos y autenticidad; el cliente no cifra.
  return value as unknown as NotePackage
}

function validShare(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  const data = parseJson(value, 'El fragmento')
  return (
    isRecord(data) &&
    data.version === 1 &&
    typeof data.y === 'string' &&
    /^[0-9]+$/.test(data.y) &&
    typeof data.x === 'number' &&
    Number.isInteger(data.x) &&
    data.x >= 1 &&
    data.x <= MAX_PARTICIPANTS &&
    typeof data.set_id === 'string' &&
    /^[0-9a-f]{32}$/.test(data.set_id)
  )
}

export function shareIndex(payload: string): number {
  const data: unknown = JSON.parse(payload)
  if (!isRecord(data) || typeof data.x !== 'number')
    throw new Error('Fragmento inválido.')
  return data.x
}

async function post(operation: string, body: unknown): Promise<unknown> {
  return apiRequest<unknown>(endpoint + '/' + operation, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(file)
  })
}

export async function protectNote(
  file: File,
  shareCount: number,
): Promise<ProtectionResult> {
  if (file.size > MAX_FILE_SIZE) throw new Error('El archivo supera los 5 MiB.')
  if (
    !Number.isInteger(shareCount) ||
    shareCount < 2 ||
    shareCount > MAX_PARTICIPANTS
  )
    throw new Error('Elige entre 2 y 20 participantes.')
  const result = await post('protect', {
    filename: file.name,
    media_type: file.type || 'application/octet-stream',
    content_base64: await fileBase64(file),
    share_count: shareCount,
    threshold: shareCount,
    access_mode: 'all-members',
  })
  if (
    !isRecord(result) ||
    !Array.isArray(result.shares) ||
    result.shares.length !== shareCount ||
    !result.shares.every(validShare)
  )
    throw new Error('El servicio devolvió fragmentos con un formato inválido.')
  return {
    package: parsePackage(result.package),
    shares: result.shares as string[],
  }
}

export async function recoverNote(
  note: NotePackage,
  shares: string[],
): Promise<RecoveryResult> {
  const result = await post('recover', { package: note, shares })
  if (
    !isRecord(result) ||
    typeof result.filename !== 'string' ||
    typeof result.media_type !== 'string' ||
    typeof result.size !== 'number' ||
    result.filename !== note.filename ||
    result.size !== note.size ||
    typeof result.content_base64 !== 'string' ||
    result.content_base64.length > 4 * Math.ceil(MAX_FILE_SIZE / 3)
  )
    throw new Error('El servicio devolvió un archivo con un formato inválido.')
  try {
    if (atob(result.content_base64).length !== result.size)
      throw new Error('Tamaño inválido.')
  } catch (error) {
    throw new Error('No se pudo leer el archivo recuperado.', { cause: error })
  }
  return result as unknown as RecoveryResult
}

export async function readPackage(file: File): Promise<NotePackage> {
  if (file.size > MAX_PACKAGE_SIZE)
    throw new Error('El paquete supera los 8 MiB.')
  return parsePackage(parseJson(await file.text(), 'El paquete'))
}

export async function readShares(files: File[]): Promise<string[]> {
  if (files.length > MAX_PARTICIPANTS)
    throw new Error('Puedes cargar hasta 20 fragmentos.')
  return Promise.all(
    files.map(async (file) => {
      if (file.size > 2048)
        throw new Error('Un fragmento supera el tamaño permitido.')
      const value = await file.text()
      if (!validShare(value))
        throw new Error('El fragmento no tiene el formato esperado.')
      return value
    }),
  )
}

export function downloadJson(value: unknown, filename: string) {
  downloadBlob(
    new Blob([JSON.stringify(value, null, 2) + '\n'], {
      type: 'application/json',
    }),
    filename,
  )
}
export function downloadShare(value: string, filename: string) {
  downloadBlob(new Blob([value], { type: 'application/json' }), filename)
}
export function downloadRecovered(result: RecoveryResult) {
  const bytes = Uint8Array.from(atob(result.content_base64), (c) =>
    c.charCodeAt(0),
  )
  downloadBlob(
    new Blob([bytes.buffer], { type: 'application/octet-stream' }),
    result.filename,
  )
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const formatBytes = (size: number) =>
  size < 1024
    ? size + ' bytes'
    : size < 1024 * 1024
      ? (size / 1024).toFixed(1) + ' KiB'
      : (size / 1024 / 1024).toFixed(1) + ' MiB'
