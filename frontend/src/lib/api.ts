import { getSupabase } from './supabase'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// Solo rutas del mismo origen. Los tokens no se adjuntan a URLs externas.
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  retrySession = true,
): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Ruta de API inválida.')
  const auth = getSupabase().auth
  const { data, error } = await auth.getSession()
  if (error || !data.session)
    throw new ApiError(
      401,
      'authentication_required',
      'Inicia sesión para continuar.',
    )
  let token = data.session.access_token
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (options.body) headers.set('Content-Type', 'application/json')
    let response: Response
    try {
      response = await fetch(path, {
        ...options,
        headers,
        credentials: 'omit',
        cache: 'no-store',
        signal: options.signal ?? AbortSignal.timeout(30_000),
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new ApiError(
        0,
        'network_error',
        'No se pudo contactar al servidor. Comprueba la conexión e inténtalo de nuevo.',
      )
    }
    if (response.status === 401 && attempt === 0 && retrySession) {
      const refreshed = await auth.refreshSession()
      if (refreshed.error || !refreshed.data.session) {
        throw new ApiError(
          401,
          'invalid_session',
          'Tu sesión ha vencido. Vuelve a iniciar sesión.',
        )
      }
      token = refreshed.data.session.access_token
      continue
    }
    if (response.status === 204) return undefined as T
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = body?.detail
      throw new ApiError(
        response.status,
        typeof detail?.code === 'string' ? detail.code : 'request_failed',
        typeof detail?.message === 'string'
          ? detail.message
          : 'No se pudo completar la operación.',
      )
    }
    if (body === null)
      throw new ApiError(
        502,
        'invalid_response',
        'El servidor devolvió una respuesta inválida.',
      )
    return body as T
  }
  throw new ApiError(
    401,
    'invalid_session',
    'Tu sesión ha vencido. Vuelve a iniciar sesión.',
  )
}
