import { ArrowUpRight, UsersRound } from 'lucide-react'
import Badge from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import {
  categories,
  documentStatuses,
  formatDocumentDate,
} from '../documentPresentation'
import type { DocumentRecord } from '../types'
import './documents.css'

function DocumentIdentity({
  document,
  onSelect,
}: {
  document: DocumentRecord
  onSelect: (document: DocumentRecord) => void
}) {
  const category = categories[document.category]
  const Icon = category.icon
  return (
    <div className="document-identity">
      <span className={`document-icon document-icon--${category.tone}`}>
        <Icon size={21} />
      </span>
      <div>
        <button
          className="document-title"
          type="button"
          onClick={() => onSelect(document)}
        >
          {document.title}
        </button>
        <p>
          {document.id} <span>·</span> {category.label}
        </p>
      </div>
    </div>
  )
}
export default function DocumentList({
  documents,
  onSelect,
  view = 'list',
}: {
  documents: DocumentRecord[]
  onSelect: (document: DocumentRecord) => void
  view?: 'list' | 'grid'
}) {
  if (view === 'grid')
    return (
      <div className="document-grid">
        {documents.map((document) => {
          const status = documentStatuses[document.status]
          return (
            <article className="document-tile" key={document.id}>
              <div className="document-tile-top">
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
                <span>{document.id}</span>
              </div>
              <DocumentIdentity document={document} onSelect={onSelect} />
              <p className="document-summary">{document.description}</p>
              <div className="document-tile-footer">
                <span>
                  <UsersRound size={15} />
                  {document.recipientCount} destinatarios
                </span>
                <Button
                  variant="ghost"
                  onClick={() => onSelect(document)}
                  aria-label={`Ver ${document.title}`}
                >
                  <ArrowUpRight size={19} />
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    )
  return (
    <div className="document-table-wrap">
      <table className="document-table">
        <caption className="sr-only">
          Documentos de ejemplo y sus estados
        </caption>
        <thead>
          <tr>
            <th scope="col">DOCUMENTO</th>
            <th scope="col">ESTADO</th>
            <th className="document-date" scope="col">
              ACTUALIZADO
            </th>
            <th scope="col">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const status = documentStatuses[document.status]
            return (
              <tr key={document.id}>
                <td>
                  <DocumentIdentity document={document} onSelect={onSelect} />
                </td>
                <td>
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                </td>
                <td className="document-date">
                  <time dateTime={document.updatedAt}>
                    {formatDocumentDate(document.updatedAt)}
                  </time>
                </td>
                <td className="document-action">
                  <Button
                    variant="ghost"
                    onClick={() => onSelect(document)}
                    aria-label={`Ver ${document.title}`}
                  >
                    <ArrowUpRight size={19} />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
