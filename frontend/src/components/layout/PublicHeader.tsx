import { ArrowUpRight } from 'lucide-react'
import { useAuth } from '../../features/auth/auth'
import Brand from './Brand'
import { ButtonLink } from '../ui/Button'
export default function PublicHeader() {
  const signedIn = useAuth().status === 'ready'
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <Brand light />
        <nav aria-label="Navegación principal">
          <a className="header-section-link" href="#proteccion">
            La plataforma
          </a>
          <ButtonLink to={signedIn ? '/dashboard' : '/login'} variant="light">
            {signedIn ? 'Abrir mi espacio' : 'Acceder'} <ArrowUpRight size={16} />
          </ButtonLink>
        </nav>
      </div>
    </header>
  )
}
