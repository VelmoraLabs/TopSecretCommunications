import { Info } from 'lucide-react'
import Modal from '../../../components/ui/Modal'
import Badge from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import {
  categories,
  documentStatuses,
  formatDocumentDate,
} from '../documentPresentation'
import type { DocumentRecord } from '../types'
export default function DocumentDetail({
  document,
  onClose,
}: {
  document: DocumentRecord | null
  onClose: () => void
}) {
  const category = document ? categories[document.category] : null
  const status = document ? documentStatuses[document.status] : null
  return (
    <Modal
      open={document !== null}
      onClose={onClose}
      title="Detalle del documento"
    >
      {document && category && status && (
        <>
          <div className="detail-badges">
            <Badge tone="neutral">Datos de ejemplo</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="detail-code">{document.id}</p>
          <h3 className="detail-title">{document.title}</h3>
          <p className="detail-description">{document.description}</p>
          <dl className="detail-grid">
            <div>
              <dt>Tipo de documento</dt>
              <dd>{category.label}</dd>
            </div>
            <div>
              <dt>Área responsable</dt>
              <dd>{document.office}</dd>
            </div>
            <div>
              <dt>Actualizado</dt>
              <dd>{formatDocumentDate(document.updatedAt)}</dd>
            </div>
            <div>
              <dt>Destinatarios</dt>
              <dd>{document.recipientCount} personas</dd>
            </div>
            <div className="detail-wide">
              <dt>Protección prevista</dt>
              <dd>{category.protection}</dd>
            </div>
          </dl>
          <p className="info-note">
            <Info size={18} />
            <span>
              Documento ficticio para revisar la interfaz. Las operaciones de
              protección y acceso se habilitarán con la integración.
            </span>
          </p>
          <div className="modal-actions">
            <Button onClick={onClose}>Entendido</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
