import { Bell, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { useNotifications } from './notificationContext'
import {
  notificationCategories,
  notificationTarget,
  notificationTime,
} from './notifications'
import type { Notification } from './notifications'

export default function NotificationList({
  items,
  onOpen,
}: {
  items: Notification[]
  onOpen?: () => void
}) {
  const { read } = useNotifications()
  return (
    <ul className="notification-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            className={`notification-item ${item.read_at ? '' : 'is-unread'}`}
            to={notificationTarget(item)}
            onClick={() => {
              if (!item.read_at) void read(item.id)
              onOpen?.()
            }}
          >
            <span className="notification-symbol">
              <Bell size={19} />
            </span>
            <span className="notification-copy">
              <small>
                {notificationCategories[item.category]}
                {!item.read_at && ' · Sin leer'}
              </small>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <time dateTime={item.created_at}>
                {notificationTime(item.created_at)}
              </time>
            </span>
            <ChevronRight size={18} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
