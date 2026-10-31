import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  FileLock2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useSearchParams } from 'react-router'
import Badge from '../../components/ui/Badge'
import { Button, ButtonLink } from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import PageHeader from '../../components/ui/PageHeader'
import TextField from '../../components/ui/TextField'
import { useAuth } from '../../features/auth/auth'
import {
  DocumentMessage,
  DocumentPagination,
} from '../../features/documents/DocumentForms'
import { formatDocumentDate } from '../../features/documents/documentPresentation'
import { errorMessage } from '../../features/documents/memoranda'
import { entityId } from '../../features/notifications/notifications'
import DiplomaticCreateForm from '../../features/diplomatic-notes/DiplomaticCreateForm'
import DiplomaticDetail from '../../features/diplomatic-notes/DiplomaticDetail'
import {
  getDiplomaticNotes,
  diplomaticSize,
  diplomaticStates,
  noteKinds,
} from '../../features/diplomatic-notes/diplomaticNotes'
import type {
  DiplomaticPage,
  NoteFilter,
} from '../../features/diplomatic-notes/diplomaticNotes'
import '../Documents/documents-page.css'
import '../../features/documents/components/documents.css'
import '../../features/documents/memoranda.css'
import '../PersonnelFiles/personnel-files.css'
import './diplomatic-notes.css'

export default function DiplomaticNotesPage() {
  const auth = useAuth()
  return auth.hasPermission('documents.read_assigned') ? (
    <DiplomaticNotesWorkspace />
  ) : (
    <section className="access-status-card" role="alert">
      <h1>No tienes permiso para consultar notas y comunicados</h1>
      <p>Tu cuenta necesita permiso de lectura de documentos asignados.</p>
      <ButtonLink to="/dashboard">Volver a mi espacio</ButtonLink>
    </section>
  )
}

function DiplomaticNotesWorkspace() {
  const auth = useAuth(),
    [params, setParams] = useSearchParams()
  const selected = entityId(params.get('nota'))
  const kind: NoteFilter =
    params.get('tipo') === 'communique'
      ? 'communique'
      : params.get('tipo') === 'diplomatic_note'
        ? 'diplomatic_note'
        : 'all'
  const [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0)
  const [page, setPage] = useState<DiplomaticPage | null>(null)
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void getDiplomaticNotes(query, kind, offset, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setPage(result)
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setPage(null)
            setError(errorMessage(error))
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
  }, [query, kind, offset, revision])
  function refresh() {
    setLoading(true)
    setRevision((n) => n + 1)
  }
  function select(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('nota', id)
    else next.delete('nota')
    setParams(next, { replace: !id })
  }
  return (
    <>
      <PageHeader
        eyebrow="COMUNICACIONES PROTEGIDAS"
        title="Notas y comunicados"
        description="Emite notas y comunicados firmados y cifrados. Cada destinatario recupera su archivo de forma independiente."
        action={
          auth.hasPermission('documents.create') &&
          auth.hasPermission('documents.sign') && (
            <Button
              onClick={() => {
                setNotice('')
                setCreating(true)
              }}
            >
              <Plus size={17} /> Nueva nota o comunicado
            </Button>
          )
        }
      />
      <section className="memo-intro">
        <span>
          <FileLock2 size={30} />
        </span>
        <div>
          <p className="eyebrow">Firma RSA-PSS · cifrado AES-GCM</p>
          <h2>Tu firma, su acceso. Una comunicación protegida.</h2>
          <p>
            Para emitir, necesitas una clave de firma y una de cifrado. Para
            recibir, prepara tu clave de cifrado. Al recuperar, la
            aplicación comprueba la firma del emisor y la integridad del
            documento.
          </p>
          <ButtonLink to="/claves" variant="ghost">
            Revisar Mis claves
          </ButtonLink>
        </div>
      </section>
      {notice && <DocumentMessage success text={notice} />}
      <Card className="documents-card personnel-card diplomatic-card">
        <div className="documents-toolbar">
          <TextField
            label="Buscar notas y comunicados"
            icon={Search}
            type="search"
            maxLength={80}
            placeholder="Buscar por título…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setOffset(0)
              setLoading(true)
            }}
          />
          <label className="field diplomatic-type-filter">
            <span className="field-label">Tipo de documento</span>
            <select
              aria-label="Tipo de documento"
              value={kind}
              onChange={(event) => {
                const next = new URLSearchParams(params)
                if (event.target.value === 'all') next.delete('tipo')
                else next.set('tipo', event.target.value)
                setParams(next, { replace: true })
                setOffset(0)
                setLoading(true)
              }}
            >
              <option value="all">Todos los tipos</option>
              <option value="diplomatic_note">Notas diplomáticas</option>
              <option value="communique">Comunicados</option>
            </select>
          </label>
          <Button variant="outline" disabled={loading} onClick={refresh}>
            <RefreshCw size={17} /> Actualizar
          </Button>
        </div>
        <div className="documents-result-bar">
          <p role="status">
            {loading
              ? 'Consultando notas y comunicados…'
              : error
                ? 'Listado no disponible'
                : page?.total === 1
                  ? '1 documento encontrado'
                  : `${page?.total ?? 0} documentos encontrados`}
          </p>
          {query && (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery('')
                setOffset(0)
                setLoading(true)
              }}
            >
              Limpiar búsqueda
            </Button>
          )}
        </div>
        {error ? (
          <div className="personnel-list-message">
            <DocumentMessage text={error} />
            <Button variant="outline" onClick={refresh}>
              Reintentar consulta
            </Button>
          </div>
        ) : loading ? (
          <p className="memo-loading">Preparando tu listado…</p>
        ) : page?.items.length ? (
          <div className="document-table-wrap">
            <table className="document-table">
              <caption className="sr-only">
                Documentos autorizados y estado de sus cargas
              </caption>
              <thead>
                <tr>
                  <th scope="col">DOCUMENTO</th>
                  <th scope="col">ESTADO</th>
                  <th scope="col" className="document-date">
                    CREADO
                  </th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="document-identity">
                        <span className="document-icon document-icon--blue">
                          <FileLock2 size={21} />
                        </span>
                        <div>
                          <button
                            type="button"
                            className="document-title"
                            onClick={() => select(file.id)}
                          >
                            {file.title}
                          </button>
                          <p>
                            {noteKinds[file.kind]} · {file.filename} ·{' '}
                            {diplomaticSize(file.size)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          file.state === 'ready'
                            ? 'green'
                            : file.state === 'staging'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {diplomaticStates[file.state]}
                      </Badge>
                    </td>
                    <td className="document-date">
                      <time dateTime={file.created_at}>
                        {formatDocumentDate(file.created_at)}
                      </time>
                    </td>
                    <td className="document-action">
                      <Button
                        variant="ghost"
                        aria-label={`Ver ${file.title}`}
                        onClick={() => select(file.id)}
                      >
                        <ArrowUpRight size={19} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="memo-empty">
            <FileLock2 size={35} />
            <h2>No hay notas y comunicados en esta vista</h2>
            <p>
              {query || kind !== 'all'
                ? 'Prueba otro título o selecciona todos los tipos.'
                : 'Crea uno o espera a que te asignen un documento. Las cargas incompletas solo son visibles para su creador.'}
            </p>
          </div>
        )}
        <DocumentPagination
          offset={offset}
          total={page?.total ?? 0}
          loading={loading || Boolean(error)}
          onChange={(value) => {
            setOffset(value)
            setLoading(true)
          }}
        />
      </Card>
      <p className="documents-help">
        El acceso requiere asignación explícita, incluso para
        administradores. Conserva la clave privada original y su contraseña
        para las notas y los comunicados históricos.
      </p>
      {creating && (
        <DiplomaticCreateForm
          onClose={() => {
            setCreating(false)
            refresh()
          }}
          onUncertain={refresh}
          onSaved={(detail) => {
            setCreating(false)
            setQuery('')
            setOffset(0)
            const next = new URLSearchParams()
            next.set('nota', detail.file.id)
            setParams(next)
            refresh()
            setNotice(
              'Documento firmado, cifrado y disponible para sus destinatarios.',
            )
          }}
        />
      )}
      {selected && (
        <DiplomaticDetail
          key={selected}
          id={selected}
          onClose={() => select(null)}
          onChanged={refresh}
        />
      )}
    </>
  )
}
