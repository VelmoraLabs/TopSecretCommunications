import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { AccessStatus } from '../../features/auth/AccessGate'
import {
  completeGoogleCallback,
  consumeDestination,
  useAuth,
} from '../../features/auth/auth'
import { ButtonLink } from '../../components/ui/Button'
import '../../features/auth/access.css'

export default function AuthCallbackPage() {
  const auth = useAuth()
  // Conservar los parámetros durante el doble montaje de efectos de StrictMode.
  const [parameters] = useState(() => {
    const values = new URLSearchParams(window.location.search)
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    for (const key of ['error', 'error_code']) {
      if (fragment.has(key)) values.set(key, fragment.get(key)!)
    }
    return values
  })
  const [error, setError] = useState('')
  const [destination, setDestination] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  useEffect(() => {
    let active = true
    const code = parameters.get('code')
    window.history.replaceState(null, '', '/auth/callback')
    async function finish() {
      if (parameters.has('error') || parameters.has('error_code'))
        throw new Error(
          'No se autorizó el acceso. Comprueba que tu cuenta esté dada de alta e inténtalo de nuevo.',
        )
      if (code) await completeGoogleCallback(code)
      if (active) {
        setDestination(consumeDestination())
        setCompleted(true)
      }
    }
    void finish().catch((error) => {
      if (active)
        setError(
          error instanceof Error
            ? error.message
            : 'No se pudo completar el acceso.',
        )
    })
    return () => {
      active = false
    }
  }, [parameters])
  if (completed && auth.status === 'ready')
    return <Navigate to={destination ?? '/dashboard'} replace />
  if (error || (completed && auth.status === 'signed-out'))
    return (
      <main className="access-status">
        <div className="access-status-card" role="alert">
          <h1>No se pudo completar el acceso</h1>
          <p>
            {error ||
              'La sesión no está disponible. Vuelve a iniciar sesión con Google.'}
          </p>
          <div className="access-status-actions">
            <ButtonLink to="/login">Volver al acceso</ButtonLink>
          </div>
        </div>
      </main>
    )
  return <AccessStatus pending={!completed} />
}
