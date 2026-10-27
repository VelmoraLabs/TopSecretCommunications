import { useEffect, useState } from 'react'
import { Grid2X2, List, Plus, RefreshCw, Search } from 'lucide-react'
import { useSearchParams } from 'react-router'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import TextField from '../../components/ui/TextField'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../features/auth/auth'
import { categories } from '../../features/documents/documentPresentation'
import type {
  DocumentCategory,
  DocumentRecord,
} from '../../features/documents/types'
import DocumentList from '../../features/documents/components/DocumentList'
import {
  DocumentMessage,
  DocumentPagination,
  MemoCreateForm,
} from '../../features/documents/DocumentForms'
import MemorandumDetail from '../../features/documents/MemorandumDetail'
import {
  documentRecord,
  errorMessage,
  getDocuments,
} from '../../features/documents/memoranda'
import type { DocumentPage } from '../../features/documents/memoranda'
import { entityId } from '../../features/notifications/notifications'
import './documents-page.css'
import '../../features/documents/memoranda.css'

export default function DocumentsPage() {
  const auth = useAuth(),
    [params, setParams] = useSearchParams()
  const linkedDocument = entityId(params.get('documento'))
  const rawCategory = params.get('tipo'),
    category =
      rawCategory && Object.hasOwn(categories, rawCategory)
        ? (rawCategory as DocumentCategory)
        : 'all'
  const pending = params.get('estado') === 'pendiente'
  const [query, setQuery] = useState(''),
    [view, setView] = useState<'list' | 'grid'>('list'),
    [offset, setOffset] = useState(0)
  const [page, setPage] = useState<DocumentPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void getDocuments(
        query.trim(),
        category,
        pending ? 'pending' : 'all',
        offset,
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setPage(value)
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setError(errorMessage(error))
            setPage(null)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, category, pending, offset, revision])
  const documents: DocumentRecord[] = (page?.items ?? []).map(documentRecord)
  function reset() {
    setParams({})
    setQuery('')
    setOffset(0)
  }
  return (
    <>
      <PageHeader
        eyebrow="ESPACIO DE TRABAJO"
        title="Documentos"
        description="Consulta los documentos que creaste o que fueron asignados a tu cuenta."
        action={
          auth.hasPermission('documents.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              Nuevo memorándum
            </Button>
          )
        }
      />
      <section className="memo-intro">
        <span>
          <Badge tone="purple">RSA-PSS</Badge>
        </span>
        <div>
          <p className="eyebrow">DOCUMENTOS CON DESTINATARIOS PROPIOS</p>
          <h2>Cada firma, sobre el archivo correcto.</h2>
          <p>
            Los memorándums se comparten con personas designadas. El emisor
            firma antes de enviarlos y puede solicitar aprobación del Embajador,
            sin exigir un grupo.
          </p>
        </div>
      </section>
      <Card className="documents-card">
        <div className="documents-toolbar">
          <TextField
            label="Buscar documentos"
            hideLabel
            icon={Search}
            type="search"
            maxLength={80}
            placeholder="Buscar por título…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setOffset(0)
            }}
          />
          <div className="documents-toolbar-actions">
            <Button
              variant="ghost"
              disabled={loading}
              aria-label="Actualizar documentos"
              onClick={() => setRevision((n) => n + 1)}
            >
              <RefreshCw size={18} />
            </Button>
            <div
              className="view-switch"
              role="group"
              aria-label="Vista de documentos"
            >
              <button
                type="button"
                aria-label="Vista de lista"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <List size={19} />
              </button>
              <button
                type="button"
                aria-label="Vista de tarjetas"
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={18} />
              </button>
            </div>
          </div>
        </div>
        <div
          className="category-filters"
          role="group"
          aria-label="Filtrar por categoría"
        >
          <button
            type="button"
            aria-pressed={category === 'all'}
            className={category === 'all' ? 'is-active' : ''}
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete('tipo')
              setParams(next)
              setOffset(0)
            }}
          >
            Todos
            <span>
              {page
                ? Object.values(page.category_counts).reduce((a, b) => a + b, 0)
                : '—'}
            </span>
          </button>
          {Object.entries(categories).map(([key, item]) => (
            <button
              type="button"
              key={key}
              aria-pressed={category === key}
              className={category === key ? 'is-active' : ''}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('tipo', key)
                setParams(next)
                setOffset(0)
              }}
            >
              {item.shortLabel}
              <span>
                {page?.category_counts[key as DocumentCategory] ?? '—'}
              </span>
            </button>
          ))}
        </div>
        <div className="documents-result-bar">
          <p role="status">
            {loading
              ? 'Consultando documentos…'
              : `${page?.total ?? 0} documentos encontrados`}
            {pending && <Badge tone="amber">Pendientes de completar</Badge>}
          </p>
          {(query || category !== 'all' || pending) && (
            <Button variant="ghost" onClick={reset}>
              Limpiar filtros
            </Button>
          )}
        </div>
        {error ? (
          <DocumentMessage text={error} />
        ) : loading ? (
          <p className="memo-loading">Preparando tu espacio documental…</p>
        ) : documents.length ? (
          <DocumentList
            documents={documents}
            onSelect={(document) => setSelected(document.id)}
            view={view}
          />
        ) : (
          <div className="memo-empty">
            <h2>No hay documentos en esta vista</h2>
            <p>
              {category !== 'all' && category !== 'memorandum'
                ? 'Esta categoría está contemplada en el proyecto. Su flujo se integrará en la siguiente etapa.'
                : 'Crea un memorándum o espera a que te asignen uno. También puedes ajustar los filtros.'}
            </p>
          </div>
        )}
        <DocumentPagination
          offset={offset}
          total={page?.total ?? 0}
          loading={loading}
          onChange={setOffset}
        />
      </Card>
      <p className="documents-help">
        Archivo original, versiones y firmas conservan su asociación. Las
        categorías aplican protecciones distintas; el acceso conjunto se reserva
        a las notas especiales.
      </p>
      {creating && (
        <MemoCreateForm
          onClose={() => setCreating(false)}
          onSaved={(document) => {
            setCreating(false)
            setSelected(document.document.id)
            setOffset(0)
            setParams({})
            setQuery('')
            setRevision((n) => n + 1)
          }}
        />
      )}
      {(linkedDocument || selected) && (
        <MemorandumDetail
          key={linkedDocument || selected}
          id={(linkedDocument || selected)!}
          onClose={() => {
            setSelected(null)
            const next = new URLSearchParams(params)
            next.delete('documento')
            setParams(next, { replace: true })
          }}
          onChanged={() => setRevision((n) => n + 1)}
        />
      )}
    </>
  )
}
