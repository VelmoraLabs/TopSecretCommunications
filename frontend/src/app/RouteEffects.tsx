import { useEffect } from 'react'
import { useLocation } from 'react-router'

const titles: Record<string, string> = {
  '/': 'Inicio',
  '/login': 'Acceso',
  '/dashboard': 'Dashboard',
  '/documentos': 'Documentos',
  '/notas-especiales': 'Notas especiales',
  '/auth/callback': 'Verificando acceso',
  '/administracion': 'Perfiles y permisos',
  '/grupos': 'Grupos e integrantes',
  '/claves': 'Mis claves',
}

export default function RouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${titles[pathname] ?? 'Página no encontrada'} · Top Secret Communications`
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}
