import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router'
import Brand from './Brand'
import AppSidebar from './AppSidebar'
import Badge from '../ui/Badge'

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawer = useRef<HTMLDialogElement>(null)
  const { pathname } = useLocation()
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
            {pathname === '/documentos' ? 'Documentos' : 'Dashboard'}
          </strong>
        </div>
        <div className="header-actions">
          <Badge tone="neutral">Datos de ejemplo</Badge>
          <details className="account-menu">
            <summary aria-label="Menú de usuario">
              <span className="avatar">UE</span>
              <span className="account-name">
                Usuario de ejemplo<small>Personal autorizado · ejemplo</small>
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="account-dropdown">
              <p>No hay una sesión iniciada.</p>
              <Link to="/login">Ir al acceso</Link>
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
            <span>Datos de ejemplo para revisar la interfaz.</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
