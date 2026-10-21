import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router'
import Brand from './Brand'
import AppSidebar from './AppSidebar'
import Badge from '../ui/Badge'
import { roleNames, useAuth } from '../../features/auth/auth'

export default function AppLayout() {
  const auth = useAuth()
  const profile = auth.access!.profile
  const initials = profile.display_name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  async function logout() {
    setSigningOut(true)
    setLogoutError('')
    try {
      await auth.signOut()
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : 'No se pudo cerrar la sesión.',
      )
      setSigningOut(false)
    }
  }
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawer = useRef<HTMLDialogElement>(null)
  const { pathname } = useLocation()
  const isSpecialNotes = pathname === '/notas-especiales'
  useEffect(() => {
    const dialog = drawer.current
    if (drawerOpen && !dialog?.open) dialog?.showModal()
    if (!drawerOpen && dialog?.open) dialog.close()
  }, [drawerOpen])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (media.matches) setDrawerOpen(false)
    }
    media.addEventListener('change', closeOnDesktop)
    return () => media.removeEventListener('change', closeOnDesktop)
  }, [])
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>
      <header className="app-header">
        <div className="app-header-brand">
          <button
            type="button"
            className="icon-button mobile-menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={drawerOpen}
            aria-controls="mobile-navigation"
          >
            <Menu size={22} />
          </button>
          <Brand light />
        </div>
        <div className="header-breadcrumb">
          <span>Espacio de trabajo</span>
          <span>/</span>
          <strong>
            {isSpecialNotes
              ? 'Notas especiales'
              : pathname === '/administracion'
                ? 'Perfiles y permisos'
                : pathname === '/grupos'
                  ? 'Grupos e integrantes'
                  : pathname === '/claves'
                    ? 'Mis claves de firma'
                    : pathname === '/documentos'
                      ? 'Documentos'
                      : 'Dashboard'}
          </strong>
        </div>
        <div className="header-actions">
          <Badge tone="neutral">
            {isSpecialNotes ? 'Flujo portable' : 'Sesión activa'}
          </Badge>
          <details className="account-menu">
            <summary aria-label={'Menú de ' + profile.display_name}>
              <span className="avatar">{initials}</span>
              <span className="account-name">
                {profile.display_name}
                <small>{roleNames[profile.role_code]}</small>
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="account-dropdown">
              <p>{profile.email}</p>
              {auth.hasPermission('profiles.manage') && (
                <Link to="/administracion">Administrar perfiles</Link>
              )}
              <button
                type="button"
                disabled={signingOut}
                onClick={() => void logout()}
              >
                {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
              </button>
              {logoutError && <p role="alert">{logoutError}</p>}
              <Link to="/">Volver al inicio</Link>
            </div>
          </details>
        </div>
      </header>
      <aside className="app-sidebar">
        <AppSidebar />
      </aside>
      <dialog
        ref={drawer}
        id="mobile-navigation"
        className="mobile-drawer"
        aria-label="Menú de navegación"
        onCancel={(event) => {
          event.preventDefault()
          setDrawerOpen(false)
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            setDrawerOpen(false)
        }}
      >
        <div className="drawer-title">
          <span>Tu espacio</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar menú"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={22} />
          </button>
        </div>
        <AppSidebar onNavigate={() => setDrawerOpen(false)} />
      </dialog>
      <main id="main-content" tabIndex={-1} className="app-main">
        <div className="app-main-inner">
          <Outlet />
          <footer className="app-footer">
            <span>Top Secret Communications</span>
            <span>
              {isSpecialNotes
                ? 'Archivos reales · sesión autenticada.'
                : pathname === '/administracion'
                  ? 'Perfiles y permisos de tu oficina.'
                  : pathname === '/grupos'
                    ? 'Grupos e integrantes de tu oficina.'
                    : 'Documentos y firmas de tu cuenta.'}
            </span>
          </footer>
        </div>
      </main>
    </div>
  )
}
