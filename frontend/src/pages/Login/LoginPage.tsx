import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Info,
  LockKeyhole,
  Mail,
} from 'lucide-react'
import { Link } from 'react-router'
import AuthLayout from '../../components/layout/AuthLayout'
import Brand from '../../components/layout/Brand'
import TextField from '../../components/ui/TextField'
import { Button, ButtonLink } from '../../components/ui/Button'
import './login.css'

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState('')
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(
      'El inicio de sesión todavía no está habilitado. Puedes explorar el dashboard de ejemplo.',
    )
  }
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
          <p>Accede a tu espacio de trabajo institucional.</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <TextField
            label="Correo institucional"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="tu.nombre@institucion.edu.mx"
            icon={Mail}
            required
          />
          <TextField
            label="Contraseña"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Ingresa tu contraseña"
            icon={LockKeyhole}
            required
            endAdornment={
              <button
                type="button"
                className="icon-button"
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            }
          />
          <div className="login-options">
            <label>
              <input type="checkbox" name="remember" />
              Recordar mi acceso
            </label>
            <button
              type="button"
              onClick={() =>
                setNotice(
                  'La recuperación de contraseña se habilitará con la autenticación institucional.',
                )
              }
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <Button type="submit" className="login-submit">
            Iniciar sesión <ArrowRight size={18} />
          </Button>
        </form>
        {notice && (
          <p className="info-note login-notice" role="status">
            <Info size={18} />
            <span>{notice}</span>
          </p>
        )}
        <div className="login-divider">
          <span>PRIMER VISTAZO A LA PLATAFORMA</span>
        </div>
        <ButtonLink to="/dashboard" variant="outline" className="login-demo">
          Ver dashboard de ejemplo <ArrowUpRightIcon />
        </ButtonLink>
        <p className="login-footnote">
          Vista de diseño. La autenticación se habilitará en la siguiente
          integración.
        </p>
        <p className="login-copyright">
          Top Secret Communications · VelmoraLabs
        </p>
      </div>
    </AuthLayout>
  )
}
function ArrowUpRightIcon() {
  return <ArrowRight size={17} className="diagonal-arrow" />
}
