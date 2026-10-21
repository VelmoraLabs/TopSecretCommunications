import {
  ChevronRight,
  FolderLock,
  LayoutDashboard,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { NavLink } from 'react-router'
import { useAuth } from '../../features/auth/auth'
export default function AppSidebar({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const auth = useAuth()
  return (
    <div className="sidebar-content">
      <div className="workspace">
        <span className="workspace-icon">
          <ShieldCheck size={20} />
        </span>
        <div>
          <strong>Oficina diplomática</strong>
          <span>Acceso institucional</span>
        </div>
      </div>
      <p className="sidebar-label">ESPACIO DE TRABAJO</p>
      <nav aria-label="Navegación del panel">
        {[
          { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { to: '/documentos', label: 'Documentos', icon: FolderLock },
          { to: '/claves', label: 'Mis claves de firma', icon: KeyRound },
          ...(auth.hasPermission('groups.read')
            ? [
                {
                  to: '/grupos',
                  label: 'Grupos e integrantes',
                  icon: UsersRound,
                },
              ]
            : []),
          {
            to: '/notas-especiales',
            label: 'Notas especiales',
            icon: UsersRound,
          },
          ...(auth.hasPermission('profiles.manage')
            ? [
                {
                  to: '/administracion',
                  label: 'Perfiles y permisos',
                  icon: ShieldCheck,
                },
              ]
            : []),
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
        <span>Información y acceso</span>
      </div>
      <div className="sidebar-footer">
        <span className="sidebar-status" />
        Sesión activa<span>VelmoraLabs · 2026</span>
      </div>
    </div>
  )
}
