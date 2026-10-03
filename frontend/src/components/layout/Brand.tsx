import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
export default function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="Top Secret Communications, inicio"
      className={`brand ${light ? 'brand--light' : ''}`}
    >
      <span className="brand-symbol">
        <ShieldCheck size={25} strokeWidth={1.8} />
      </span>
      <span className="brand-name">
        Top Secret<span>COMMUNICATIONS</span>
      </span>
    </Link>
  )
}
