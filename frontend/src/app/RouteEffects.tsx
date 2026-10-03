import { useEffect } from 'react'
import { useLocation } from 'react-router'

const titles: Record<string, string> = {
  '/': 'Inicio',
  '/login': 'Acceso',
  '/dashboard': 'Dashboard',
  '/documentos': 'Documentos',
}

export default function RouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${titles[pathname] ?? 'Página no encontrada'} · Top Secret Communications`
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}
