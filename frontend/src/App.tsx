import AppRoutes from './app/AppRoutes'
import AuthProvider from './features/auth/AuthProvider'

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
