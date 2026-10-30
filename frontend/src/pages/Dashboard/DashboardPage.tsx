import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  FileCheck2,
  FileClock,
  FileLock2,
  FolderClosed,
  Info,
  RefreshCw,
  UsersRound,
} from 'lucide-react'
import { Link } from 'react-router'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import PageHeader from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { errorMessage } from '../../features/documents/memoranda'
import { useAuth } from '../../features/auth/auth'
import { getPersonnelFiles } from '../../features/personnel-files/personnelFiles'
import { DocumentMessage } from '../../features/documents/DocumentForms'
import { categories } from '../../features/documents/documentPresentation'
import { useNotifications } from '../../features/notifications/notificationContext'
import {
  dashboardTarget,
  getDashboard,
} from '../../features/dashboard/dashboard'
import type {
  Dashboard,
  DashboardEntry,
} from '../../features/dashboard/dashboard'
import './dashboard.css'

export default function DashboardPage() {
  const canReadPersonnel = useAuth().hasPermission(
    'documents.read_assigned',
  )
  const { revision, refresh } = useNotifications()
  const [page, setPage] = useState<Dashboard | null>(null),
    [error, setError] = useState('')
  const [personnelTotal, setPersonnelTotal] = useState<number | null>(null)
  const [personnelError, setPersonnelError] = useState('')
  useEffect(() => {
    if (!canReadPersonnel) return
    const controller = new AbortController()
    void getPersonnelFiles('', 0, controller.signal, 1)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPersonnelTotal(result.total)
          setPersonnelError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPersonnelTotal(null)
          setPersonnelError(errorMessage(error))
        }
      })
    return () => controller.abort()
  }, [revision, canReadPersonnel])
  useEffect(() => {
    const controller = new AbortController()
    void getDashboard(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result)
          setError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
    return () => controller.abort()
  }, [revision])
  const stats = [
    {
      label: 'Listado y notas',
      count: page?.stats.documents_total,
      icon: FolderClosed,
      tone: 'purple',
      detail:
        'Listado de firmas y notas especiales; expedientes por separado',
    },
    {
      label: 'Notas especiales',
      count: page?.stats.notes_total,
      icon: UsersRound,
      tone: 'blue',
      detail: 'Notas de grupo compartidas y cifradas',
    },
    {
      label: 'Firmados',
      count: page?.stats.signed_total,
      icon: FileCheck2,
      tone: 'green',
      detail: 'Documentos con todas las firmas previstas',
    },
    {
      label: 'Pendientes',
      count: page?.stats.pending_total,
      icon: FileClock,
      tone: 'amber',
      detail: 'Acciones que requieren tu participación',
    },
  ]
  return (
    <>
      <PageHeader
        eyebrow="VISTA GENERAL"
        title="Tu espacio documental"
        description="Una mirada a la información y a lo que requiere tu atención."
        action={
          <Button
            variant="outline"
            disabled={!page && !error}
            onClick={refresh}
          >
            <RefreshCw size={17} />
            Actualizar resumen
          </Button>
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
            Un espacio para organizar, proteger y compartir cada documento
            con sus destinatarios.
          </p>
          <a href="#dashboard-pending" className="button button--light">
            Revisar pendientes <ArrowRight size={16} />
          </a>
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

      {error && (
        <DocumentMessage
          text={
            page
              ? `${error} Se conserva el último resumen recibido.`
              : error
          }
        />
      )}
      {personnelError && (
        <DocumentMessage
          text={`No se pudo actualizar el conteo de expedientes: ${personnelError}`}
        />
      )}
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
                <h2>Listado documental y notas recientes</h2>
                <p>
                  Firmas y notas especiales. Los expedientes se consultan en
                  su sección.
                </p>
              </div>
            </div>
            {!page ? (
              <p className="dashboard-list-message" role="status">
                {error
                  ? 'No se pudo cargar el resumen.'
                  : 'Consultando documentos y notas…'}
              </p>
            ) : (
              <EntryList
                items={page.recent}
                empty="Todavía no tienes documentos ni notas compartidas."
              />
            )}
          </Card>
          <Card className="category-section">
            <div className="card-heading">
              <div>
                <h2>Explorar por categoría</h2>
                <p>
                  Los conteos corresponden a todos tus registros
                  autorizados.
                </p>
              </div>
            </div>
            <div className="category-shortcuts">
              {Object.entries(categories).map(([key, category]) => {
                const Icon = category.icon,
                  special = key === 'especial',
                  personnel = key === 'expediente',
                  count = personnel
                    ? canReadPersonnel
                      ? (personnelTotal ?? undefined)
                      : undefined
                    : page
                      ? special
                        ? page.stats.notes_total
                        : page.category_counts[
                            key as keyof Dashboard['category_counts']
                          ]
                      : undefined
                return (
                  <Link
                    className="category-shortcut"
                    key={key}
                    to={
                      personnel
                        ? '/expedientes'
                        : special
                          ? '/notas-especiales'
                          : `/documentos?tipo=${key}`
                    }
                  >
                    <span
                      className={`document-icon document-icon--${category.tone}`}
                    >
                      <Icon size={21} />
                    </span>
                    <div>
                      <strong>{category.shortLabel}</strong>
                      <span>
                        {count ?? '—'}{' '}
                        {personnel
                          ? 'expedientes y cargas propias'
                          : special
                            ? count === 1
                              ? 'nota'
                              : 'notas'
                            : count === 1
                              ? 'documento'
                              : 'documentos'}
                      </span>
                    </div>
                    <ArrowRight size={16} />
                  </Link>
                )
              })}
              {Boolean(page?.category_counts.especial) && (
                <Link
                  className="category-shortcut"
                  to="/documentos?tipo=especial"
                >
                  <span className="document-icon document-icon--purple">
                    <FolderClosed size={21} />
                  </span>
                  <div>
                    <strong>Documentos especiales anteriores</strong>
                    <span>
                      {page?.category_counts.especial} documentos del
                      listado documental
                    </span>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              )}
            </div>
          </Card>
        </div>
        <aside className="dashboard-secondary">
          <Card className="activity-card" id="dashboard-pending">
            <div className="card-heading">
              <div>
                <h2>Requieren tu atención</h2>
                <p>Firmas, preparaciones y recuperación colaborativa.</p>
              </div>
            </div>
            {page ? (
              <>
                <EntryList
                  items={page.pending}
                  empty="No tienes acciones pendientes en este momento."
                  compact
                />
                <p className="dashboard-list-message">
                  {page.stats.pending_documents} documentos ·{' '}
                  {page.stats.pending_recoveries} recuperaciones ·{' '}
                  {page.stats.pending_notes} preparaciones.
                  {page.stats.pending_total > 6 &&
                    ' Se muestran las seis acciones más recientes.'}
                </p>
              </>
            ) : (
              <p className="dashboard-list-message">
                {error
                  ? 'Resumen no disponible.'
                  : 'Consultando pendientes…'}
              </p>
            )}
            <div className="dashboard-module-links">
              <Link to="/documentos">Ver documentos</Link>
              {canReadPersonnel && (
                <Link to="/expedientes">Ver expedientes de personal</Link>
              )}
              <Link to="/notas-especiales">Ver notas especiales</Link>
            </div>
          </Card>
          <section className="joint-access-card">
            <span className="joint-icon">
              <UsersRound size={23} />
            </span>
            <Badge tone="purple">ACCESO CONJUNTO</Badge>
            <h2>La colaboración también protege.</h2>
            <p>
              Consulta tus notas cifradas y las solicitudes que requieren a
              sus participantes originales.
            </p>
            <Link to="/notas-especiales" className="text-link">
              Abrir notas especiales <ArrowRight size={16} />
            </Link>
          </section>
          <p className="dashboard-example-note">
            <Info size={15} />
            <span>
              Los totales respetan tus permisos. Las notas cifradas se
              cuentan por separado de las firmas. Los expedientes tienen su
              propio conteo y listado.{' '}
              {page &&
                `Actualizado: ${new Date(page.updated_at).toLocaleTimeString('es-MX')}.`}
            </span>
          </p>
        </aside>
      </div>
    </>
  )
}

function EntryList({
  items,
  empty,
  compact = false,
}: {
  items: DashboardEntry[]
  empty: string
  compact?: boolean
}) {
  if (!items.length)
    return <p className="dashboard-list-message">{empty}</p>
  return (
    <ul className={`dashboard-entry-list ${compact ? 'is-compact' : ''}`}>
      {items.map((item) => {
        const Icon =
          item.target_kind === 'document' ? FileCheck2 : UsersRound
        return (
          <li key={`${item.target_kind}-${item.id}`}>
            <Link to={dashboardTarget(item)} className="dashboard-entry">
              <span className="stat-icon stat-icon--purple">
                <Icon size={19} />
              </span>
              <span className="dashboard-entry-copy">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
                <span>{item.status}</span>
                <time dateTime={item.occurred_at}>
                  {new Date(item.occurred_at).toLocaleDateString('es-MX')}
                </time>
              </span>
              <ArrowRight size={16} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
