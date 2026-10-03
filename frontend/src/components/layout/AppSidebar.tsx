import {
  ChevronRight,
  FolderLock,
  LayoutDashboard,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'
import { NavLink } from 'react-router'
export default function AppSidebar({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  return (
    <div className="sidebar-content">
      <div className="workspace">
        <span className="workspace-icon">
          <ShieldCheck size={20} />
        </span>
        <div>
          <strong>Oficina diplomática</strong>
          <span>Espacio de ejemplo</span>
        </div>
      </div>
      <p className="sidebar-label">ESPACIO DE TRABAJO</p>
      <nav aria-label="Navegación del panel">
        {[
          { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { to: '/documentos', label: 'Documentos', icon: FolderLock },
        ].map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'is-active' : ''}`
            }
          >
            <Icon size={20} />
            <span>{label}</span>
            <ChevronRight size={16} className="nav-chevron" />
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-note">
        <LockKeyhole size={22} />
        <h2>El acceso tiene un propósito.</h2>
        <p>Organiza la información según su protección y sus destinatarios.</p>
        <span>Diseño de la plataforma</span>
      </div>
      <div className="sidebar-footer">
        <span className="sidebar-status" />
        Vista de ejemplo<span>VelmoraLabs · 2026</span>
      </div>
    </div>
  )
}
