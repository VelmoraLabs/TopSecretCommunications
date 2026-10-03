import { SearchX } from 'lucide-react'
import { Button } from './Button'
export default function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <SearchX size={26} />
      </span>
      <h2>No encontramos documentos</h2>
      <p>Prueba otra búsqueda o restablece los filtros.</p>
      <Button variant="outline" onClick={onReset}>
        Restablecer filtros
      </Button>
    </div>
  )
}
