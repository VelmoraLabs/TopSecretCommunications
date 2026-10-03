import { useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck2,
  FileClock,
  FileLock2,
  FolderClosed,
  Info,
  UsersRound,
} from 'lucide-react'
import { Link } from 'react-router'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import PageHeader from '../../components/ui/PageHeader'
import { ButtonLink } from '../../components/ui/Button'
import { exampleDocuments } from '../../features/documents/fixtures'
import { categories } from '../../features/documents/documentPresentation'
import type { DocumentRecord } from '../../features/documents/types'
import DocumentList from '../../features/documents/components/DocumentList'
import DocumentDetail from '../../features/documents/components/DocumentDetail'
import './dashboard.css'

export default function DashboardPage() {
  const [selected, setSelected] = useState<DocumentRecord | null>(null)
  const stats = [
    {
      label: 'Documentos',
      count: exampleDocuments.length,
      icon: FolderClosed,
      tone: 'purple',
      detail: 'En este espacio de ejemplo',
    },
    {
      label: 'Con cifrado',
      count: exampleDocuments.filter((d) => d.encrypted).length,
      icon: FileLock2,
      tone: 'blue',
      detail: 'Destinatarios designados',
    },
    {
      label: 'Con firma verificada',
      count: exampleDocuments.filter((d) => d.signatureVerified).length,
      icon: FileCheck2,
      tone: 'green',
      detail: 'Estado de ejemplo',
    },
    {
      label: 'Por atender',
      count: exampleDocuments.filter((d) =>
        ['awaiting-signature', 'joint-access'].includes(d.status),
      ).length,
      icon: FileClock,
      tone: 'amber',
      detail: 'Firma o acceso conjunto',
    },
  ]
  return (
    <>
      <PageHeader
        eyebrow="VISTA GENERAL"
        title="Tu espacio documental"
        description="Una mirada a la información y a lo que requiere tu atención."
        action={
          <ButtonLink to="/documentos" variant="outline">
            Ver documentos <ArrowUpRight size={17} />
          </ButtonLink>
        }
      />
      <section className="dashboard-welcome">
        <div>
          <div className="welcome-eyebrow">
            <span />
            TU INFORMACIÓN, EN SU LUGAR
          </div>
          <h2>
            Todo en su lugar.
            <br />
            <span>El acceso, en manos correctas.</span>
          </h2>
          <p>
            Un espacio para organizar, proteger y compartir cada documento con
            sus destinatarios.
          </p>
          <ButtonLink to="/documentos?estado=pendiente" variant="light">
            Revisar pendientes <ArrowRight size={16} />
          </ButtonLink>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <div className="welcome-ring">
            <div className="welcome-shield">
              <FileLock2 size={46} strokeWidth={1.3} />
            </div>
          </div>
          <span className="welcome-float welcome-float--one">
            <Check size={16} />
            Origen verificable
          </span>
          <span className="welcome-float welcome-float--two">
            <UsersRound size={16} />
            Acceso definido
          </span>
        </div>
      </section>
      <div className="stats-grid">
        {stats.map(({ label, count, icon: Icon, tone, detail }) => (
          <Card className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon stat-icon--${tone}`}>
                <Icon size={20} />
              </span>
            </div>
            <strong>{String(count).padStart(2, '0')}</strong>
            <p>{detail}</p>
          </Card>
        ))}
      </div>
      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <Card className="recent-documents">
            <div className="card-heading">
              <div>
                <h2>Documentos recientes</h2>
                <p>Las últimas actualizaciones de tu espacio.</p>
              </div>
              <Link to="/documentos" className="text-link">
                Ver todos <ArrowRight size={16} />
              </Link>
            </div>
            <DocumentList
              documents={exampleDocuments.slice(0, 4)}
              onSelect={setSelected}
            />
          </Card>
          <Card className="category-section">
            <div className="card-heading">
              <div>
                <h2>Explorar por categoría</h2>
                <p>Encuentra cada documento según su propósito.</p>
              </div>
            </div>
            <div className="category-shortcuts">
              {Object.entries(categories).map(([key, category]) => {
                const Icon = category.icon
                return (
                  <Link
                    className="category-shortcut"
                    to={`/documentos?tipo=${key}`}
                    key={key}
                  >
                    <span
                      className={`document-icon document-icon--${category.tone}`}
                    >
                      <Icon size={21} />
                    </span>
                    <div>
                      <strong>{category.shortLabel}</strong>
                      <span>
                        {
                          exampleDocuments.filter((d) => d.category === key)
                            .length
                        }{' '}
                        documentos
                      </span>
                    </div>
                    <ArrowUpRight size={16} />
                  </Link>
                )
              })}
            </div>
          </Card>
        </div>
        <aside className="dashboard-secondary">
          <Card className="activity-card">
            <div className="card-heading">
              <div>
                <h2>Actividad reciente</h2>
                <p>Movimientos de ejemplo.</p>
              </div>
              <span className="activity-dot" />
            </div>
            <div className="activity-list">
              {[
                {
                  icon: FileClock,
                  title: 'Documento listo para revisión',
                  text: 'Circular de protocolo institucional',
                  time: '03 oct · 09:20',
                  tone: 'amber',
                },
                {
                  icon: UsersRound,
                  title: 'Acceso conjunto pendiente',
                  text: 'Nota de sesión reservada',
                  time: '03 oct · 08:45',
                  tone: 'purple',
                },
                {
                  icon: FileCheck2,
                  title: 'Firma digital verificada',
                  text: 'Memorándum de coordinación',
                  time: '02 oct · 16:30',
                  tone: 'green',
                },
              ].map(({ icon: Icon, title, text, time, tone }) => (
                <div className="activity-item" key={title}>
                  <span className={`stat-icon stat-icon--${tone}`}>
                    <Icon size={17} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                    <time>{time}</time>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <section className="joint-access-card">
            <span className="joint-icon">
              <UsersRound size={23} />
            </span>
            <Badge tone="purple">ACCESO CONJUNTO</Badge>
            <h2>La colaboración también protege.</h2>
            <p>
              Las notas especiales requieren reunir la participación prevista de
              sus destinatarios.
            </p>
            <Link to="/documentos?tipo=especial" className="text-link">
              Ver notas especiales <ArrowRight size={16} />
            </Link>
          </section>
          <p className="dashboard-example-note">
            <Info size={15} />
            <span>Los estados y movimientos de esta vista son ficticios.</span>
          </p>
        </aside>
      </div>
      <DocumentDetail document={selected} onClose={() => setSelected(null)} />
    </>
  )
}
