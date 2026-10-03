import type { ReactNode } from 'react'
import { Fingerprint, LockKeyhole, UsersRound } from 'lucide-react'
import Brand from './Brand'
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-brand-panel">
        <Brand light />
        <div className="auth-brand-copy">
          <p className="eyebrow">COMUNICACIÓN CON CONFIANZA</p>
          <h1>
            Cada documento.
            <br />
            Cada destinatario.
            <br />
            <span>El acceso correcto.</span>
          </h1>
          <p>
            Un espacio para la información que requiere atención, cuidado y una
            protección a su medida.
          </p>
          <div className="auth-principles">
            {[
              {
                icon: LockKeyhole,
                title: 'Confidencialidad',
                text: 'Información para sus destinatarios.',
              },
              {
                icon: Fingerprint,
                title: 'Integridad',
                text: 'Documentos con origen verificable.',
              },
              {
                icon: UsersRound,
                title: 'Colaboración',
                text: 'Acceso conjunto cuando se requiere.',
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <span>
                  <Icon size={20} />
                </span>
                <p>
                  <strong>{title}</strong>
                  {text}
                </p>
              </div>
            ))}
          </div>
        </div>
        <p className="auth-brand-footer">
          VelmoraLabs <span>ESCOM · 2026</span>
        </p>
      </section>
      <section className="auth-form-panel">{children}</section>
    </main>
  )
}
