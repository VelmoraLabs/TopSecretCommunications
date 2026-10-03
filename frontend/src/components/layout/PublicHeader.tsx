import { ArrowUpRight } from 'lucide-react'
import Brand from './Brand'
import { ButtonLink } from '../ui/Button'
export default function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <Brand light />
        <nav aria-label="Navegación principal">
          <a className="header-section-link" href="#proteccion">
            La plataforma
          </a>
          <ButtonLink to="/login" variant="light">
            Acceder <ArrowUpRight size={16} />
          </ButtonLink>
        </nav>
      </div>
    </header>
  )
}
