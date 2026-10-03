import { BrowserRouter, Route, Routes } from 'react-router'
import AppLayout from '../components/layout/AppLayout'
import LandingPage from '../pages/Landing/LandingPage'
import LoginPage from '../pages/Login/LoginPage'
import DashboardPage from '../pages/Dashboard/DashboardPage'
import DocumentsPage from '../pages/Documents/DocumentsPage'
import NotFoundPage from '../pages/NotFound/NotFoundPage'
import RouteEffects from './RouteEffects'

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/documentos" element={<DocumentsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
