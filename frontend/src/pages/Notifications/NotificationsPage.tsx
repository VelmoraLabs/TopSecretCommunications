import { useEffect, useState } from 'react'
import { CheckCheck, RefreshCw } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import {
  DocumentMessage,
  DocumentPagination,
} from '../../features/documents/DocumentForms'
import { errorMessage } from '../../features/documents/memoranda'
import NotificationList from '../../features/notifications/NotificationList'
import { useNotifications } from '../../features/notifications/notificationContext'
import {
  listNotifications,
  notificationCategories,
} from '../../features/notifications/notifications'
import type { NotificationPage } from '../../features/notifications/notifications'

export default function NotificationsPage() {
  const { revision, refresh, readAll, live } = useNotifications()
  const [state, setState] = useState('all'),
    [category, setCategory] = useState('all'),
    [offset, setOffset] = useState(0)
  const [page, setPage] = useState<NotificationPage | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void listNotifications(state, category, offset, 20, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          if (offset && !result.items.length) {
            setOffset(0)
            return
          }
          setPage(result)
          setError('')
          setLoading(false)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error))
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [state, category, offset, revision])
  async function markAll() {
    if (!page || busy) return
    setBusy(true)
    setError('')
    try {
      await readAll(page.snapshot_at)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="TU BANDEJA"
        title="Notificaciones"
        description="Entérate de asignaciones, documentos y solicitudes que requieren tu atención."
      />
      <Card className="notifications-card">
        <div className="notifications-toolbar">
          <label className="field">
            <span className="field-label">Mostrar</span>
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value)
                setOffset(0)
                setLoading(true)
              }}
            >
              <option value="all">Todas</option>
              <option value="unread">Sin leer</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Categoría</span>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                setOffset(0)
                setLoading(true)
              }}
            >
              <option value="all">Todo el sistema</option>
              {Object.entries(notificationCategories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={refresh}
          >
            <RefreshCw size={17} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            disabled={loading || busy || !page?.unread_count}
            onClick={() => void markAll()}
          >
            <CheckCheck size={17} />
            {busy ? 'Guardando…' : 'Marcar todas como leídas'}
          </Button>
        </div>
        <p className="memo-note">
          {page ? `${page.unread_count} sin leer. ` : ''}Leer no significa
          aportar, aprobar o firmar.{' '}
          {live
            ? 'Actualizaciones en vivo.'
            : 'Actualización automática cada 10 segundos mientras esta pestaña esté visible.'}
        </p>
        {error && <DocumentMessage text={error} />}
        {loading ? (
          <p role="status">Consultando notificaciones…</p>
        ) : page?.items.length ? (
          <NotificationList items={page.items} />
        ) : (
          !error && (
            <div className="notifications-empty">
              <h2>No hay avisos en esta vista</h2>
              <p>
                Cuando tengas nuevas asignaciones o solicitudes aparecerán aquí,
                aunque no estuvieras conectado.
              </p>
            </div>
          )
        )}
        <DocumentPagination
          offset={offset}
          total={page?.total ?? 0}
          loading={loading || busy}
          onChange={(value) => {
            setOffset(value)
            setLoading(true)
          }}
        />
      </Card>
    </>
  )
}
