import { BrowserRouter, Route, Routes } from 'react-router'
import AppLayout from '../components/layout/AppLayout'
import LandingPage from '../pages/Landing/LandingPage'
import LoginPage from '../pages/Login/LoginPage'
import DashboardPage from '../pages/Dashboard/DashboardPage'
import DocumentsPage from '../pages/Documents/DocumentsPage'
import NotFoundPage from '../pages/NotFound/NotFoundPage'
import RouteEffects from './RouteEffects'
import SpecialNotesPage from '../pages/SpecialNotes/SpecialNotesPage'
import AuthCallbackPage from '../pages/AuthCallback/AuthCallbackPage'
import AdminPage from '../pages/Admin/AdminPage'
import GroupsPage from '../pages/Groups/GroupsPage'
import KeysPage from '../pages/Keys/KeysPage'
import NotificationsPage from '../pages/Notifications/NotificationsPage'
import PersonnelFilesPage from '../pages/PersonnelFiles/PersonnelFilesPage'
import {
  RequirePermission,
  RequireSession,
} from '../features/auth/AccessGate'

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <RouteEffects />
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
    </BrowserRouter>
  )
}
