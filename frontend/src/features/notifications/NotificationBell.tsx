import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Link } from 'react-router'
import Modal from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import NotificationList from './NotificationList'
import { useNotifications } from './notificationContext'

export default function NotificationBell() {
  const { page, loading, error, refresh } = useNotifications(),
    [open, setOpen] = useState(false)
  const count = page?.unread_count ?? 0
  return (
    <>
      <button
        type="button"
        className="icon-button notification-bell"
        aria-label={`Notificaciones${count ? `: ${count} sin leer` : ''}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Bell size={21} />
        {count > 0 && (
          <span className="notification-counter" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
        {error && (
          <span
            className="notification-warning"
            aria-label="No se pudo actualizar la bandeja"
          >
            !
          </span>
        )}
      </button>
      {open && (
        <Modal
          open
          title="Notificaciones recientes"
          onClose={() => setOpen(false)}
        >
          <p className="memo-note">
            Leer un aviso no autoriza ni completa la operación pendiente.
          </p>
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button variant="outline" onClick={refresh}>
                Reintentar
              </Button>
            </div>
          )}
          {loading ? (
            <p role="status">Consultando avisos…</p>
          ) : page?.items.length ? (
            <NotificationList
              items={page.items}
              onOpen={() => setOpen(false)}
            />
          ) : (
            !error && <p>No tienes notificaciones todavía.</p>
          )}
          <Link
            className="notification-all"
            to="/notificaciones"
            onClick={() => setOpen(false)}
          >
            Ver todas las notificaciones
          </Link>
        </Modal>
      )}
    </>
  )
}
