import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import PublicHeader from '../../components/layout/PublicHeader'
import Brand from '../../components/layout/Brand'
import { ButtonLink } from '../../components/ui/Button'
import { categories } from '../../features/documents/documentPresentation'
import './landing.css'

function ProductPreview() {
  return (
    <div className="product-preview">
      <div className="preview-top">
        <span className="preview-logo">
          <ShieldCheck size={17} />
          Top Secret
        </span>
        <span className="preview-demo">VISTA DE EJEMPLO</span>
        <span className="preview-avatar">UE</span>
      </div>
      <div className="preview-body">
        <div className="preview-heading">
          <div>
            <span>TU ESPACIO DOCUMENTAL</span>
            <h2>Todo bajo control.</h2>
          </div>
          <span className="preview-check">
            <Check size={18} />
          </span>
        </div>
        <div className="preview-metrics">
          <div>
            <span>Documentos</span>
            <strong>
              06<small>en tu espacio</small>
            </strong>
          </div>
          <div>
            <span>Categorías</span>
            <strong>
              04<small>formas de protección</small>
            </strong>
          </div>
        </div>
        <p className="preview-label">DOCUMENTOS RECIENTES</p>
        {[
          {
            icon: FileCheck2,
            title: 'Memorándum de coordinación',
            label: 'Firma digital',
            tone: 'green',
          },
          {
            icon: LockKeyhole,
            title: 'Acuerdo de cooperación bilateral',
            label: 'Cifrado',
            tone: 'blue',
          },
          {
            icon: UsersRound,
            title: 'Nota de sesión reservada',
            label: 'Acceso conjunto',
            tone: 'purple',
          },
        ].map(({ icon: Icon, title, label, tone }) => (
          <div className="preview-document" key={title}>
            <span
              className={`preview-document-icon preview-document-icon--${tone}`}
            >
              <Icon size={18} />
            </span>
            <div>
              <strong>{title}</strong>
              <small>{label}</small>
            </div>
            <ArrowUpRight size={16} />
          </div>
        ))}
      </div>
      <div className="preview-bottom">
        <span className="preview-dot" />
        Una protección para cada documento
        <LockKeyhole size={14} />
      </div>
    </div>
  )
}
export default function LandingPage() {
  return (
    <div className="landing-page">
      <a className="skip-link" href="#landing-content">
        Saltar al contenido
      </a>
      <PublicHeader />
      <main id="landing-content">
        <section className="landing-hero">
          <div className="hero-orbit" aria-hidden="true" />
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="hero-eyebrow">
                <span />
                GESTIÓN DOCUMENTAL DIPLOMÁTICA
              </p>
              <h1>
                La información
                <br />
                sensible, en
                <br />
                <span>buenas manos.</span>
              </h1>
              <p className="hero-description">
                Protege tus documentos, define sus destinatarios y coordina el
                acceso desde un solo espacio.
              </p>
              <div className="hero-actions">
                <ButtonLink to="/dashboard" variant="light">
                  Explorar plataforma <ArrowRight size={18} />
                </ButtonLink>
                <ButtonLink to="/login" variant="ghost">
                  Ir al acceso <ArrowUpRight size={18} />
                </ButtonLink>
              </div>
              <div className="hero-principles">
                <span>
                  <ShieldCheck size={16} />
                  Confidencialidad
                </span>
                <span>
                  <FileCheck2 size={16} />
                  Integridad
                </span>
                <span>
                  <UsersRound size={16} />
                  Colaboración
                </span>
              </div>
            </div>
            <div className="hero-product">
              <div className="hero-product-caption">
                <span />
                DISEÑADO PARA LO QUE IMPORTA
              </div>
              <ProductPreview />
              <div className="hero-floating-note">
                <span>
                  <LockKeyhole size={18} />
                </span>
                <div>
                  <strong>El acceso correcto.</strong>
                  <small>Para cada destinatario.</small>
                </div>
                <Check size={17} />
              </div>
            </div>
          </div>
          <div className="hero-foot">
            <span>TOP SECRET COMMUNICATIONS</span>
            <span>Información cuidada. Comunicación clara.</span>
            <span>01 / PLATAFORMA</span>
          </div>
        </section>
        <section className="protection-section" id="proteccion">
          <div className="section-heading">
            <div>
              <p className="eyebrow">UN ESPACIO. CUATRO PROPÓSITOS.</p>
              <h2>
                La protección empieza
                <br />
                por el tipo de documento.
              </h2>
            </div>
            <p>
              Cada comunicación tiene una responsabilidad.
              <br />
              La plataforma organiza su protección desde el origen.
            </p>
          </div>
          <div className="protection-grid">
            {Object.entries(categories).map(([key, category], index) => {
              const Icon = category.icon
              const descriptions: Record<string, string> = {
                memorandum:
                  'Comunicaciones institucionales con una firma digital para verificar su origen.',
                expediente:
                  'Información de personal protegida para sus destinatarios designados.',
                nota: 'Comunicaciones diplomáticas con firma digital y contenido cifrado.',
                especial:
                  'Información que requiere la participación conjunta para habilitar su acceso.',
              }
              return (
                <article className="protection-card" key={key}>
                  <div className="protection-card-top">
                    <span
                      className={`document-icon document-icon--${category.tone}`}
                    >
                      <Icon size={23} />
                    </span>
                    <span>0{index + 1}</span>
                  </div>
                  <h3>{category.label}</h3>
                  <p>{descriptions[key]}</p>
                  <span className="protection-caption">
                    {category.protection}
                    <ArrowUpRight size={16} />
                  </span>
                </article>
              )
            })}
          </div>
          <div className="landing-invitation">
            <div>
              <p className="eyebrow">PRIMER VISTAZO</p>
              <h2>Conoce tu espacio de trabajo.</h2>
              <p>Explora las pantallas con documentos de ejemplo.</p>
            </div>
            <ButtonLink to="/dashboard">
              Ver dashboard <ArrowRight size={18} />
            </ButtonLink>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <p>
          Desarrollado por VelmoraLabs <span>·</span> ESCOM 2026
        </p>
        <span>Top Secret Communications</span>
      </footer>
    </div>
  )
}
