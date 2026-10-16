import { useState } from 'react'
import { LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Button, ButtonLink } from '../../components/ui/Button'
import { useAuth } from './auth'
import './access.css'

export function AccessStatus({ pending = false }: { pending?: boolean }) {
  const auth = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }
  const loading = pending || auth.status === 'loading'
  return (
    <main className="access-status" id="main-content">
      <div
        className="access-status-card"
        role="status"
        aria-busy={loading || busy}
      >
        <span className="access-status-icon">
          {loading ? (
            <LoaderCircle className="access-spinner" size={27} />
          ) : (
            <LockKeyhole size={27} />
          )}
        </span>
        <h1>
          {loading
            ? 'Preparando tu espacio'
            : auth.status === 'denied'
              ? 'Acceso restringido'
              : 'No pudimos comprobar tu acceso'}
        </h1>
        <p>
          {loading
            ? 'Estamos comprobando tu sesión y tus permisos.'
            : auth.message}
        </p>
        {!loading && (
          <div className="access-status-actions">
            {auth.session ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void act(auth.refreshAccess)}
                >
                  <RefreshCw size={16} /> Reintentar
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(auth.signOut)}
                >
                  Cerrar sesión
                </Button>
              </>
            ) : (
              <ButtonLink to="/login">Ir al acceso</ButtonLink>
            )}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </main>
  )
}

export function RequireSession() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'signed-out')
    return (
      <Navigate to="/login" state={{ returnTo: location.pathname }} replace />
    )
  if (auth.status !== 'ready') return <AccessStatus />
  return <Outlet key={auth.access!.profile.auth_user_id} />
}

export function RequirePermission({ permission }: { permission: string }) {
  const auth = useAuth()
  if (!auth.hasPermission(permission))
    return (
      <section className="access-status-card access-forbidden" role="alert">
        <span className="access-status-icon">
          <LockKeyhole size={27} />
        </span>
        <h1>No tienes permiso para esta sección</h1>
        <p>
          Tu cuenta está activa. Esta sección requiere permisos de
          administración.
        </p>
        <ButtonLink to="/dashboard">Volver a mi espacio</ButtonLink>
      </section>
    )
  return <Outlet />
}
