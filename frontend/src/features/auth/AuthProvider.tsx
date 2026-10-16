import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../../lib/supabase'
import { apiRequest, ApiError } from '../../lib/api'
import { AuthContext } from './auth'
import type { Access, AuthState } from './auth'

const initial: AuthState = {
  status: 'loading',
  session: null,
  access: null,
  message: '',
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initial)
  const generation = useRef(0)
  const mounted = useRef(false)

  const synchronize = useCallback(async (session: Session | null) => {
    const current = ++generation.current
    if (!mounted.current) return
    if (!session) {
      setState({
        status: 'signed-out',
        session: null,
        access: null,
        message: '',
      })
      return
    }
    setState((previous) => ({
      ...previous,
      session,
      access:
        previous.access?.profile.auth_user_id === session.user.id
          ? previous.access
          : null,
      status:
        previous.status === 'ready' &&
        previous.access?.profile.auth_user_id === session.user.id
          ? 'ready'
          : 'loading',
    }))
    try {
      // Evitar ciclos TOKEN_REFRESHED si los proyectos configurados no coinciden.
      const access = await apiRequest<Access>('/api/v1/auth/me', {}, false)
      if (access.profile.auth_user_id !== session.user.id) {
        throw new ApiError(
          401,
          'session_changed',
          'La sesión cambió. Vuelve a iniciar sesión.',
        )
      }
      if (mounted.current && current === generation.current) {
        setState({ status: 'ready', session, access, message: '' })
      }
    } catch (error) {
      if (!mounted.current || current !== generation.current) return
      setState({
        session,
        access: null,
        status:
          error instanceof ApiError && [401, 403].includes(error.status)
            ? 'denied'
            : 'error',
        message:
          error instanceof Error
            ? error.message
            : 'No se pudo comprobar tu acceso.',
      })
    }
  }, [])

  const refreshAccess = useCallback(async () => {
    const { data, error } = await getSupabase().auth.getSession()
    if (error) throw error
    await synchronize(data.session)
  }, [synchronize])

  useEffect(() => {
    mounted.current = true
    let unsubscribe = () => {}
    let timer: number | undefined
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void refreshAccess().catch(() => {})
    }
    try {
      const { data } = getSupabase().auth.onAuthStateChange(
        (_event, session) => {
          // No esperar llamadas al SDK dentro de su callback de autenticación.
          queueMicrotask(() => {
            if (mounted.current) void synchronize(session)
          })
        },
      )
      unsubscribe = () => data.subscription.unsubscribe()
      timer = window.setInterval(refresh, 60_000)
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', refresh)
    } catch (error) {
      queueMicrotask(() => {
        if (mounted.current)
          setState({
            ...initial,
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'El acceso no está disponible.',
          })
      })
    }
    return () => {
      mounted.current = false
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshAccess, synchronize])

  const signOut = useCallback(async () => {
    const { error } = await getSupabase().auth.signOut({ scope: 'local' })
    if (error)
      throw new Error(
        'No se pudo cerrar la sesión. Comprueba la conexión e inténtalo de nuevo.',
      )
    generation.current++
    setState({
      status: 'signed-out',
      session: null,
      access: null,
      message: '',
    })
    sessionStorage.removeItem('stc.auth.returnTo')
  }, [])

  return (
    <AuthContext.Provider
      value={{
        ...state,
        refreshAccess,
        signOut,
        hasPermission: (permission) =>
          state.status === 'ready' &&
          Boolean(state.access?.permissions.includes(permission)),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
