import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../../features/auth/auth'
import { documentWorkflows } from '../../features/documents/documentWorkflows'
import PublicHeader from '../../components/layout/PublicHeader'
import Brand from '../../components/layout/Brand'
import { ButtonLink } from '../../components/ui/Button'
import { categories } from '../../features/documents/documentPresentation'
import './landing.css'

function WorkflowOverview() {
  return (
    <div className="product-preview">
      <div className="preview-top">
        <span className="preview-logo">
          <ShieldCheck size={17} /> Top Secret
        </span>
        <span className="preview-scope">FUNCIONES DISPONIBLES</span>
      </div>
      <div className="preview-body">
        <div className="preview-heading">
          <div>
            <span>DEL ARCHIVO A SUS DESTINATARIOS</span>
            <h2>Elige cómo compartir.</h2>
          </div>
        </div>
        <p className="workflow-summary">
          Firma, cifrado y recuperación según el tipo de documento.
        </p>
        {documentWorkflows.map((workflow) => {
          const category = categories[workflow.category]
          const Icon = category.icon
          return (
            <Link
              className="preview-document"
              key={workflow.category}
              to={workflow.destination}
            >
              <span
                className={`preview-document-icon preview-document-icon--${category.tone}`}
              >
                <Icon size={18} />
              </span>
              <div>
                <strong>{workflow.title}</strong>
                <small>{workflow.protection}</small>
              </div>
              <ArrowUpRight size={16} />
            </Link>
          )
        })}
      </div>
      <div className="preview-bottom">
        <LockKeyhole size={14} /> El acceso requiere una cuenta autorizada
      </div>
    </div>
  )
}
export default function LandingPage() {
  const signedIn = useAuth().status === 'ready'
  const destination = signedIn ? '/dashboard' : '/login'
  const accessLabel = signedIn ? 'Abrir mi espacio' : 'Iniciar sesión'
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
                <ButtonLink to={destination} variant="light">
                  {accessLabel} <ArrowRight size={18} />
                </ButtonLink>
                <a className="button button--ghost" href="#proteccion">
                  Conocer las funciones <ArrowRight size={18} />
                </a>
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
              <WorkflowOverview />
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
              Cada comunicación tiene una responsabilidad.{' '}
              <br />
              La plataforma organiza su protección desde el origen.
            </p>
          </div>
          <div className="protection-grid">
            {documentWorkflows.map((workflow, index) => {
              const category = categories[workflow.category]
              const Icon = category.icon
              return (
                <article className="protection-card" key={workflow.category}>
                  <div className="protection-card-top">
                    <span
                      className={`document-icon document-icon--${category.tone}`}
                    >
                      <Icon size={23} />
                    </span>
                    <span>0{index + 1}</span>
                  </div>
                  <h3>{workflow.title}</h3>
                  <p>{workflow.description}</p>
                  <Link
                    className="protection-caption"
                    to={workflow.destination}
                  >
                    {workflow.protection}
                    <ArrowUpRight size={16} />
                  </Link>
                </article>
              )
            })}
          </div>
          <div className="landing-invitation">
            <div>
              <p className="eyebrow">TU CUENTA, TU ESPACIO</p>
              <h2>Continúa con tus documentos.</h2>
              <p>
                Consulta tus archivos asignados, revisa pendientes y administra
                tus llaves.
              </p>
            </div>
            <ButtonLink to={destination}>
              {accessLabel} <ArrowRight size={18} />
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
