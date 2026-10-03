import { ArrowLeft, FileQuestionMark } from 'lucide-react'
import Brand from '../../components/layout/Brand'
import { ButtonLink } from '../../components/ui/Button'
export default function NotFoundPage() {
  return (
    <main className="not-found">
      <Brand />
      <span className="not-found-icon">
        <FileQuestionMark size={38} />
      </span>
      <p className="eyebrow">404 · PÁGINA NO ENCONTRADA</p>
      <h1>Este camino no lleva a un documento.</h1>
      <p>Puedes volver al dashboard para continuar explorando.</p>
      <ButtonLink to="/dashboard">
        <ArrowLeft size={17} />
        Volver al dashboard
      </ButtonLink>
    </main>
  )
}
