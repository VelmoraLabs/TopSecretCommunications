import { useState } from 'react'
import { Grid2X2, List, Search, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import TextField from '../../components/ui/TextField'
import { Button } from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { categories } from '../../features/documents/documentPresentation'
import { exampleDocuments } from '../../features/documents/fixtures'
import type {
  DocumentCategory,
  DocumentRecord,
} from '../../features/documents/types'
import DocumentList from '../../features/documents/components/DocumentList'
import DocumentDetail from '../../features/documents/components/DocumentDetail'
import './documents-page.css'

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
export default function DocumentsPage() {
  const [params, setParams] = useSearchParams()
  const rawCategory = params.get('tipo')
  const category =
    rawCategory && Object.hasOwn(categories, rawCategory)
      ? (rawCategory as DocumentCategory)
      : 'all'
  const pending = params.get('estado') === 'pendiente'
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [selected, setSelected] = useState<DocumentRecord | null>(null)
  const documents = exampleDocuments
    .filter(
      (document) =>
        (category === 'all' || document.category === category) &&
        (!pending ||
          ['awaiting-signature', 'joint-access'].includes(document.status)) &&
        normalize(
          `${document.title} ${document.id} ${document.office} ${categories[document.category].label}`,
        ).includes(normalize(query)),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.title.localeCompare(b.title, 'es')
        : b.updatedAt.localeCompare(a.updatedAt),
    )
  function reset() {
    setParams({})
    setQuery('')
    setSort('recent')
  }
  function setCategory(value: string) {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete('tipo')
    else next.set('tipo', value)
    setParams(next)
  }
  return (
    <>
      <PageHeader
        eyebrow="ESPACIO DE TRABAJO"
        title="Documentos"
        description="Encuentra cada comunicación y conoce su estado de protección."
        action={
          <Badge tone="neutral">
            {exampleDocuments.length} documentos de ejemplo
          </Badge>
        }
      />
      <Card className="documents-card">
        <div className="documents-toolbar">
          <TextField
            label="Buscar documentos"
            hideLabel
            icon={Search}
            type="search"
            placeholder="Buscar por nombre, folio o área…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="documents-toolbar-actions">
            <label className="sort-control">
              <SlidersHorizontal size={16} />
              <span className="sr-only">Ordenar documentos</span>
              <select
                aria-label="Ordenar documentos"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="recent">Más recientes</option>
                <option value="name">Nombre A–Z</option>
              </select>
            </label>
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
            onClick={() => setCategory('all')}
          >
            Todos <span>{exampleDocuments.length}</span>
          </button>
          {Object.entries(categories).map(([key, item]) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              className={category === key ? 'is-active' : ''}
              onClick={() => setCategory(key)}
            >
              {item.shortLabel}
              <span>
                {exampleDocuments.filter((d) => d.category === key).length}
              </span>
            </button>
          ))}
        </div>
        <div className="documents-result-bar">
          <p role="status">
            {documents.length}{' '}
            {documents.length === 1
              ? 'documento encontrado'
              : 'documentos encontrados'}
            {pending && <Badge tone="amber">Por atender</Badge>}
          </p>
          {(query || category !== 'all' || pending) && (
            <Button variant="ghost" onClick={reset}>
              Limpiar filtros
            </Button>
          )}
        </div>
        {documents.length ? (
          <DocumentList
            documents={documents}
            onSelect={setSelected}
            view={view}
          />
        ) : (
          <EmptyState onReset={reset} />
        )}
      </Card>
      <p className="documents-help">
        Los documentos, sus destinatarios y estados son datos de ejemplo para
        revisar el diseño.
      </p>
      <DocumentDetail document={selected} onClose={() => setSelected(null)} />
    </>
  )
}
