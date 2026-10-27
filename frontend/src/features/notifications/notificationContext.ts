import { createContext, useContext } from 'react'
import type { NotificationPage } from './notifications'

export interface NotificationState {
  page: NotificationPage | null
  loading: boolean
  error: string
  live: boolean
  revision: number
  refresh: () => void
  read: (id: string) => Promise<void>
  readAll: (before: string) => Promise<void>
}
export const NotificationContext = createContext<NotificationState | null>(null)
export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('La bandeja requiere una sesión activa.')
  return context
}
