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
import PersonnelCreateForm from '../../features/personnel-files/PersonnelCreateForm'
import PersonnelDetail from '../../features/personnel-files/PersonnelDetail'
import {
  getPersonnelFiles,
  personnelSize,
  personnelStates,
} from '../../features/personnel-files/personnelFiles'
import type { PersonnelPage } from '../../features/personnel-files/personnelFiles'
import '../Documents/documents-page.css'
import '../../features/documents/components/documents.css'
import '../../features/documents/memoranda.css'
import './personnel-files.css'

export default function PersonnelFilesPage() {
  const auth = useAuth()
  return auth.hasPermission('documents.read_assigned') ? (
    <PersonnelFilesWorkspace />
  ) : (
    <section className="access-status-card" role="alert">
      <h1>No tienes permiso para consultar expedientes</h1>
      <p>Tu cuenta necesita permiso de lectura de documentos asignados.</p>
      <ButtonLink to="/dashboard">Volver a mi espacio</ButtonLink>
    </section>
  )
}

function PersonnelFilesWorkspace() {
  const auth = useAuth(),
    [params, setParams] = useSearchParams()
  const selected = entityId(params.get('expediente'))
  const [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0)
  const [page, setPage] = useState<PersonnelPage | null>(null)
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
      void getPersonnelFiles(query, offset, controller.signal)
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
  }, [query, offset, revision])
  function refresh() {
    setLoading(true)
    setRevision((n) => n + 1)
  }
  function select(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('expediente', id)
    else next.delete('expediente')
    setParams(next, { replace: !id })
  }
  return (
    <>
      <PageHeader
        eyebrow="DOCUMENTOS CONFIDENCIALES"
        title="Expedientes de personal"
        description="Comparte archivos cifrados con personas designadas. Cada una los recupera de forma independiente."
        action={
          auth.hasPermission('documents.create') && (
            <Button
              onClick={() => {
                setNotice('')
                setCreating(true)
              }}
            >
              <Plus size={17} /> Nuevo expediente
            </Button>
          )
        }
      />
      <section className="memo-intro">
        <span>
          <FileLock2 size={30} />
        </span>
        <div>
          <p className="eyebrow">AES-256-GCM + RSA-OAEP</p>
          <h2>Un documento, un acceso para cada persona.</h2>
          <p>
            La aplicación protege el archivo y entrega a cada destinatario
            su propia forma de abrirlo. Prepara y activa tu clave de cifrado
            en Mis claves antes de recibir expedientes nuevos.
          </p>
          <ButtonLink to="/claves" variant="ghost">
            Revisar Mis claves
          </ButtonLink>
        </div>
      </section>
      {notice && <DocumentMessage success text={notice} />}
      <Card className="documents-card personnel-card">
        <div className="documents-toolbar">
          <TextField
            label="Buscar expedientes"
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
          <Button variant="outline" disabled={loading} onClick={refresh}>
            <RefreshCw size={17} /> Actualizar
          </Button>
        </div>
        <div className="documents-result-bar">
          <p role="status">
            {loading
              ? 'Consultando expedientes…'
              : error
                ? 'Listado no disponible'
                : page?.total === 1
                  ? '1 expediente encontrado'
                  : `${page?.total ?? 0} expedientes encontrados`}
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
                Expedientes autorizados y estado de sus cargas
              </caption>
              <thead>
                <tr>
                  <th scope="col">EXPEDIENTE</th>
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
                            {file.filename} · {personnelSize(file.size)}
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
                        {personnelStates[file.state]}
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
            <h2>No hay expedientes en esta vista</h2>
            <p>
              {query
                ? 'Prueba otro título o limpia la búsqueda.'
                : 'Crea uno o espera a que te asignen un expediente. Las cargas incompletas solo son visibles para su creador.'}
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
        para los expedientes históricos.
      </p>
      {creating && (
        <PersonnelCreateForm
          onClose={() => {
            setCreating(false)
            refresh()
          }}
          onUncertain={refresh}
          onSaved={(detail) => {
            setCreating(false)
            setQuery('')
            setOffset(0)
            select(detail.file.id)
            refresh()
            setNotice(
              'Expediente cifrado y disponible para sus destinatarios.',
            )
          }}
        />
      )}
      {selected && (
        <PersonnelDetail
          key={selected}
          id={selected}
          onClose={() => select(null)}
          onChanged={refresh}
        />
      )}
    </>
  )
}
