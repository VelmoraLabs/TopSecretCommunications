import { Component, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import './route-boundary.css'

export default class RouteBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed)
      return (
        <section className="route-feedback" role="alert">
          <h2>No se pudo cargar esta sección</h2>
          <p>Comprueba tu conexión y vuelve a intentarlo.</p>
          <Button onClick={() => window.location.reload()}>
            Recargar página
          </Button>
        </section>
      )
    return (
      <Suspense
        fallback={
          <div className="route-feedback" role="status" aria-busy="true">
            Cargando sección…
          </div>
        }
      >
        {this.props.children}
      </Suspense>
    )
  }
}
