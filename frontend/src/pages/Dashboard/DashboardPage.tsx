import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck2,
  FileClock,
  FileLock2,
  FolderClosed,
  Info,
  UsersRound,
} from 'lucide-react'
import { Link } from 'react-router'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import PageHeader from '../../components/ui/PageHeader'
import { ButtonLink } from '../../components/ui/Button'
import {
  documentRecord,
  errorMessage,
  getDocuments,
} from '../../features/documents/memoranda'
import type { DocumentPage } from '../../features/documents/memoranda'
import { DocumentMessage } from '../../features/documents/DocumentForms'
import { categories } from '../../features/documents/documentPresentation'
import DocumentList from '../../features/documents/components/DocumentList'
import MemorandumDetail from '../../features/documents/MemorandumDetail'
import './dashboard.css'

export default function DashboardPage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState<DocumentPage | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void getDocuments('', 'all', 'all', 0, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setPage(value)
          setError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
    return () => controller.abort()
  }, [revision])
  const documents = (page?.items ?? []).map(documentRecord)
  const stats = [
    {
      label: 'Documentos',
      count: page?.total,
      icon: FolderClosed,
      tone: 'purple',
      detail: 'Asignados a tu cuenta',
    },
    {
      label: 'Memorándums',
      count: page?.category_counts.memorandum,
      icon: FileLock2,
      tone: 'blue',
      detail: 'Con destinatarios propios',
    },
    {
      label: 'Firmados',
      count: page?.signed_total,
      icon: FileCheck2,
      tone: 'green',
      detail: 'Con todas las firmas previstas',
    },
    {
      label: 'Pendientes',
      count: page?.pending_total,
      icon: FileClock,
      tone: 'amber',
      detail: 'Preparación, aprobación o envío',
    },
  ]
  return (
    <>
      <PageHeader
        eyebrow="VISTA GENERAL"
        title="Tu espacio documental"
        description="Una mirada a la información y a lo que requiere tu atención."
        action={
          <ButtonLink to="/documentos" variant="outline">
            Ver documentos <ArrowUpRight size={17} />
          </ButtonLink>
        }
      />
      <section className="dashboard-welcome">
        <div>
          <div className="welcome-eyebrow">
            <span />
            TU INFORMACIÓN, EN SU LUGAR
          </div>
          <h2>
            Todo en su lugar.
            <br />
            <span>El acceso, en manos correctas.</span>
          </h2>
          <p>
            Un espacio para organizar, proteger y compartir cada documento con
            sus destinatarios.
          </p>
          <ButtonLink to="/documentos?estado=pendiente" variant="light">
            Revisar pendientes <ArrowRight size={16} />
          </ButtonLink>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <div className="welcome-ring">
            <div className="welcome-shield">
              <FileLock2 size={46} strokeWidth={1.3} />
            </div>
          </div>
          <span className="welcome-float welcome-float--one">
            <Check size={16} />
            Origen verificable
          </span>
          <span className="welcome-float welcome-float--two">
            <UsersRound size={16} />
            Acceso definido
          </span>
        </div>
      </section>
      {error && <DocumentMessage text={error} />}
      <div className="stats-grid">
        {stats.map(({ label, count, icon: Icon, tone, detail }) => (
          <Card className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon stat-icon--${tone}`}>
                <Icon size={20} />
              </span>
            </div>
            <strong>
              {count === undefined ? '—' : String(count).padStart(2, '0')}
            </strong>
            <p>{detail}</p>
          </Card>
        ))}
      </div>
      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <Card className="recent-documents">
            <div className="card-heading">
              <div>
                <h2>Documentos recientes</h2>
                <p>Las últimas actualizaciones de tu espacio.</p>
              </div>
              <Link to="/documentos" className="text-link">
                Ver todos <ArrowRight size={16} />
              </Link>
            </div>
            <DocumentList
              documents={documents.slice(0, 4)}
              onSelect={(document) => setSelected(document.id)}
            />
          </Card>
          <Card className="category-section">
            <div className="card-heading">
              <div>
                <h2>Explorar por categoría</h2>
                <p>Encuentra cada documento según su propósito.</p>
              </div>
            </div>
            <div className="category-shortcuts">
              {Object.entries(categories).map(([key, category]) => {
                const Icon = category.icon
                return (
                  <Link
                    className="category-shortcut"
                    to={`/documentos?tipo=${key}`}
                    key={key}
                  >
                    <span
                      className={`document-icon document-icon--${category.tone}`}
                    >
                      <Icon size={21} />
                    </span>
                    <div>
                      <strong>{category.shortLabel}</strong>
                      <span>
                        {page?.category_counts[
                          key as keyof DocumentPage['category_counts']
                        ] ?? '—'}{' '}
                        documentos
                      </span>
                    </div>
                    <ArrowUpRight size={16} />
                  </Link>
                )
              })}
            </div>
          </Card>
        </div>
        <aside className="dashboard-secondary">
          <Card className="activity-card">
            <div className="card-heading">
              <div>
                <h2>Últimas actualizaciones</h2>
                <p>En tus documentos asignados.</p>
              </div>
            </div>
            <div className="activity-list">
              {documents.length === 0 ? (
                <p className="memo-note">
                  Todavía no tienes documentos registrados.
                </p>
              ) : (
                documents.slice(0, 3).map((document) => (
                  <div className="activity-item" key={document.id}>
                    <span className="stat-icon stat-icon--purple">
                      <FileCheck2 size={17} />
                    </span>
                    <div>
                      <strong>{document.title}</strong>
                      <p>{document.description}</p>
                      <time>
                        {new Date(document.updatedAt).toLocaleDateString(
                          'es-MX',
                        )}
                      </time>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
          <section className="joint-access-card">
            <span className="joint-icon">
              <UsersRound size={23} />
            </span>
            <Badge tone="purple">ACCESO CONJUNTO</Badge>
            <h2>La colaboración también protege.</h2>
            <p>
              Las notas especiales requieren reunir la participación prevista de
              sus destinatarios.
            </p>
            <Link to="/notas-especiales" className="text-link">
              Proteger una nota especial <ArrowRight size={16} />
            </Link>
          </section>
          <p className="dashboard-example-note">
            <Info size={15} />
            <span>
              Los estados corresponden a los documentos autorizados para tu
              cuenta.
            </span>
          </p>
        </aside>
      </div>
      {selected && (
        <MemorandumDetail
          key={selected}
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => setRevision((n) => n + 1)}
        />
      )}
    </>
  )
}
