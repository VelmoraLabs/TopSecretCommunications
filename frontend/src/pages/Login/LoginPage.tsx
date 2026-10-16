import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Info,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router'
import AuthLayout from '../../components/layout/AuthLayout'
import Brand from '../../components/layout/Brand'
import { Button } from '../../components/ui/Button'
import {
  safeDestination,
  signInWithGoogle,
  useAuth,
} from '../../features/auth/auth'
import { AccessStatus } from '../../features/auth/AccessGate'
import { getSupabase } from '../../lib/supabase'
import './login.css'

export default function LoginPage() {
  const auth = useAuth()
  const location = useLocation()
  const destination = safeDestination(location.state?.returnTo)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [configurationError] = useState(() => {
    try {
      getSupabase()
      return ''
    } catch {
      return 'El acceso no está disponible. Contacta al administrador.'
    }
  })
  async function signIn() {
    setBusy(true)
    setNotice('')
    try {
      await signInWithGoogle(destination)
    } catch {
      setNotice(
        'No se pudo iniciar el acceso con Google. Comprueba la conexión e inténtalo de nuevo.',
      )
      setBusy(false)
    }
  }
  if (auth.status === 'ready') return <Navigate to={destination} replace />
  if (auth.session || auth.status === 'loading') return <AccessStatus />
  return (
    <AuthLayout>
      <div className="login-container">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          Volver al inicio
        </Link>
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-heading">
          <span className="login-emblem">
            <LockKeyhole size={25} />
          </span>
          <p className="eyebrow">BIENVENIDO A TU ESPACIO</p>
          <h2>
            Un acceso.
            <br />
            Toda tu información.
          </h2>
          <p>Accede con la cuenta de Google autorizada por tu institución.</p>
        </div>
        <div className="login-google-panel">
          <Button
            variant="outline"
            className="login-google-button"
            disabled={busy || Boolean(configurationError)}
            onClick={() => void signIn()}
          >
            {busy ? (
              <LoaderCircle size={20} className="access-spinner" />
            ) : (
              <GoogleIcon />
            )}
            <span>
              {busy ? 'Conectando con Google…' : 'Continuar con Google'}
            </span>
            <ArrowRight size={18} />
          </Button>
          <div className="login-access-note">
            <ShieldCheck size={21} />
            <p>
              <strong>Acceso autorizado</strong>Tu administrador da de alta tu
              perfil y asigna los permisos de tu cuenta.
            </p>
          </div>
        </div>
        {(notice || configurationError) && (
          <p className="info-note login-notice" role="alert">
            <Info size={18} />
            <span>{configurationError || notice}</span>
          </p>
        )}
        <p className="login-footnote">
          Utiliza la cuenta que tienes registrada. Si necesitas acceso, contacta
          al administrador de tu oficina.
        </p>
        <p className="login-copyright">
          Top Secret Communications · VelmoraLabs
        </p>
      </div>
    </AuthLayout>
  )
}
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.8-3.6 6.1-8.8 6.1-15Z"
      />
      <path
        fill="#34A853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.7-3.6-11.3-8.4H5.9v5.3A20.4 20.4 0 0 0 24 44Z"
      />
      <path
        fill="#FBBC05"
        d="M12.7 27.5a12.1 12.1 0 0 1 0-7V15H5.9a20 20 0 0 0 0 18l6.8-5.5Z"
      />
      <path
        fill="#EA4335"
        d="M24 12.1c3 0 5.7 1 7.8 3.1l5.9-5.9A19.8 19.8 0 0 0 24 4 20.4 20.4 0 0 0 5.9 15l6.8 5.5C14.3 15.7 18.7 12.1 24 12.1Z"
      />
    </svg>
  )
}
