import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth'
import { errorMessage } from '../documents/memoranda'
import { NotificationContext } from './notificationContext'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications'
import type { NotificationPage } from './notifications'
import './notifications.css'

export default function NotificationProvider({
  children,
}: {
  children: ReactNode
}) {
  const auth = useAuth(),
    profile = auth.access!.profile.id,
    token = auth.session?.access_token
  const [page, setPage] = useState<NotificationPage | null>(null),
    [loading, setLoading] = useState(true)
  const [error, setError] = useState(''),
    [live, setLive] = useState(false),
    [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((n) => n + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    void listNotifications('all', 'all', 0, 5, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result)
          setError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [profile, revision])
  useEffect(() => {
    const client = getSupabase()
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (active) refresh()
      }, 150)
    }
    if (token) void client.realtime.setAuth(token)
    const channel = client
      .channel(`notifications-${profile}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stc_notifications',
          filter: `recipient_id=eq.${profile}`,
        },
        update,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'stc_notifications',
          filter: `recipient_id=eq.${profile}`,
        },
        update,
      )
      .subscribe((status) => {
        if (active) {
          setLive(status === 'SUBSCRIBED')
          if (status === 'SUBSCRIBED') update()
        }
      })
    const visible = () => {
      if (document.visibilityState !== 'hidden') update()
    }
    const interval = setInterval(visible, 10000)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
      void client.removeChannel(channel)
    }
  }, [profile, token, refresh])
  async function read(id: string) {
    try {
      await markNotificationRead(id)
      refresh()
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  async function readAll(before: string) {
    await markAllNotificationsRead(before)
    refresh()
  }
  return (
    <NotificationContext
      value={{ page, loading, error, live, revision, refresh, read, readAll }}
    >
      {children}
    </NotificationContext>
  )
}
