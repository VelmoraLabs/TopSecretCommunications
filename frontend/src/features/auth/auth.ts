import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../../lib/supabase'

export type RoleCode = 'admin' | 'ambassador' | 'staff' | 'member'
export const roleNames: Record<RoleCode, string> = {
  admin: 'Administrador',
  ambassador: 'Embajador',
  staff: 'Personal autorizado',
  member: 'Miembro',
}
export interface AccessProfile {
  id: string
  auth_user_id: string
  email: string
  display_name: string
  role_code: RoleCode
  is_active: boolean
}
export interface Access {
  profile: AccessProfile
  permissions: string[]
}
export type AuthStatus =
  'loading' | 'signed-out' | 'ready' | 'denied' | 'error'
export interface AuthState {
  status: AuthStatus
  session: Session | null
  access: Access | null
  message: string
}
export interface AuthValue extends AuthState {
  refreshAccess: () => Promise<void>
  signOut: () => Promise<void>
  hasPermission: (permission: string) => boolean
}
export const AuthContext = createContext<AuthValue | null>(null)
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider no está disponible.')
  return value
}

const destinations = new Set([
  '/dashboard',
  '/notificaciones',
  '/documentos',
  '/expedientes',
  '/notas-diplomaticas',
  '/notas-especiales',
  '/administracion',
  '/grupos',
  '/claves',
])
const returnKey = 'stc.auth.returnTo'
export function safeDestination(value: unknown): string {
  return typeof value === 'string' && destinations.has(value)
    ? value
    : '/dashboard'
}
export async function signInWithGoogle(destination: string) {
  sessionStorage.setItem(returnKey, safeDestination(destination))
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('/auth/callback', window.location.origin).href,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error)
    throw new Error(
      'No se pudo iniciar el acceso con Google. Inténtalo de nuevo.',
    )
}
export function consumeDestination(): string {
  const destination = safeDestination(sessionStorage.getItem(returnKey))
  sessionStorage.removeItem(returnKey)
  return destination
}

// React StrictMode puede repetir el efecto. Un código OAuth se canjea una sola vez.
let callback: { code: string; promise: Promise<void> } | undefined
export function completeGoogleCallback(code: string): Promise<void> {
  if (callback?.code === code) return callback.promise
  const promise = getSupabase()
    .auth.exchangeCodeForSession(code)
    .then(({ error }) => {
      if (error)
        throw new Error(
          'No se pudo completar el acceso. Comprueba tu cuenta autorizada e inténtalo de nuevo.',
        )
    })
  callback = { code, promise }
  return promise
}
