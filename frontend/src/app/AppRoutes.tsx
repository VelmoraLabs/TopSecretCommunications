import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import AppLayout from '../components/layout/AppLayout'
import RouteBoundary from '../components/layout/RouteBoundary'
import RouteEffects from './RouteEffects'
import {
  RequirePermission,
  RequireSession,
} from '../features/auth/AccessGate'

const LandingPage = lazy(() => import('../pages/Landing/LandingPage'))
const LoginPage = lazy(() => import('../pages/Login/LoginPage'))
const DashboardPage = lazy(() => import('../pages/Dashboard/DashboardPage'))
const DocumentsPage = lazy(() => import('../pages/Documents/DocumentsPage'))
const NotFoundPage = lazy(() => import('../pages/NotFound/NotFoundPage'))
const SpecialNotesPage = lazy(
  () => import('../pages/SpecialNotes/SpecialNotesPage'),
)
const AuthCallbackPage = lazy(
  () => import('../pages/AuthCallback/AuthCallbackPage'),
)
const AdminPage = lazy(() => import('../pages/Admin/AdminPage'))
const GroupsPage = lazy(() => import('../pages/Groups/GroupsPage'))
const KeysPage = lazy(() => import('../pages/Keys/KeysPage'))
const NotificationsPage = lazy(
  () => import('../pages/Notifications/NotificationsPage'),
)
const PersonnelFilesPage = lazy(
  () => import('../pages/PersonnelFiles/PersonnelFilesPage'),
)
const DiplomaticNotesPage = lazy(
  () => import('../pages/DiplomaticNotes/DiplomaticNotesPage'),
)

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <RouteBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route element={<RequireSession />}>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/notificaciones" element={<NotificationsPage />} />
              <Route path="/documentos" element={<DocumentsPage />} />
              <Route path="/expedientes" element={<PersonnelFilesPage />} />
              <Route
                path="/notas-diplomaticas"
                element={<DiplomaticNotesPage />}
              />
              <Route path="/claves" element={<KeysPage />} />
              <Route
                path="/notas-especiales"
                element={<SpecialNotesPage />}
              />
              <Route element={<RequirePermission permission="groups.read" />}>
                <Route path="/grupos" element={<GroupsPage />} />
              </Route>
              <Route
                element={<RequirePermission permission="profiles.manage" />}
              >
                <Route path="/administracion" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </RouteBoundary>
    </BrowserRouter>
  )
}
