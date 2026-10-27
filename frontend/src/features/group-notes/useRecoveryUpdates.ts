import { useEffect, useState } from 'react'
import { getSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth'

/** Los eventos solo invalidan metadatos. La API vuelve a autorizar cada lectura. */
export function useRecoveryUpdates(noteId: string, refresh: () => void) {
  const [live, setLive] = useState(false)
  const auth = useAuth()
  const token = auth.session?.access_token
  useEffect(() => {
    const supabase = getSupabase()
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (active) refresh()
      }, 150)
    }
    if (token) void supabase.realtime.setAuth(token)
    const channel = supabase
      .channel(`note-recoveries-${noteId}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stc_note_recoveries',
          filter: `note_id=eq.${noteId}`,
        },
        update,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'stc_note_recoveries',
          filter: `note_id=eq.${noteId}`,
        },
        update,
      )
      .subscribe((status) => {
        if (active) {
          setLive(status === 'SUBSCRIBED')
          if (status === 'SUBSCRIBED') update()
        }
      })
    // También concilia vencimientos y cambios perdidos durante una desconexión.
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') update()
    }, 5000)
    const visibility = () => {
      if (document.visibilityState !== 'hidden') update()
    }
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', visibility)
      void supabase.removeChannel(channel)
    }
  }, [noteId, refresh, token])
  return live
}
