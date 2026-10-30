import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { Link } from 'react-router'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import { Button } from '../../components/ui/Button'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import { documentFileError, textError } from '../../lib/validation'
import { useAuth } from '../auth/auth'
import {
  DocumentMessage,
  DocumentPagination,
} from '../documents/DocumentForms'
import { errorMessage, getRecipients } from '../documents/memoranda'
import type { Candidate, Page } from '../documents/memoranda'
import { getEncryptionKeys } from '../group-notes/encryptionKeys'
import { createPersonnelFile } from './personnelFiles'
import type { PersonnelDetail } from './personnelFiles'

export default function PersonnelCreateForm({
  onClose,
  onSaved,
  onUncertain,
}: {
  onClose: () => void
  onSaved: (detail: PersonnelDetail) => void
  onUncertain: () => void
}) {
  const auth = useAuth()
  const [title, setTitle] = useState(''),
    [file, setFile] = useState<File | null>(null)
  const [recipients, setRecipients] = useState<Candidate[]>([])
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page<Candidate> | null>(null)
  const [loading, setLoading] = useState(true),
    [directoryError, setDirectoryError] = useState('')
  const [keyLoading, setKeyLoading] = useState(true),
    [hasKey, setHasKey] = useState(false)
  const [keyError, setKeyError] = useState(''),
    [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void getEncryptionKeys(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setHasKey(
            result.items.some(
              (key) =>
                key.state === 'active' &&
                key.profile_id === auth.access?.profile.id,
            ),
          )
          setKeyError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setKeyError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setKeyLoading(false)
      })
    return () => controller.abort()
  }, [revision, auth.access?.profile.id])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setDirectoryError('')
      void getRecipients(search.trim(), offset, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setPage(result)
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setPage(null)
            setDirectoryError(errorMessage(error))
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
  }, [search, offset, revision])
  const validation = useFormValidation({
    title: textError(title, 'el título del expediente', 160),
    file: documentFileError(file),
    recipients: !recipients.length
      ? 'Selecciona al menos un destinatario.'
      : '',
    key: keyLoading
      ? 'Espera la consulta de tu clave.'
      : keyError ||
        (!hasKey ? 'Activa tu clave de cifrado en Mis claves.' : ''),
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || uncertain || !validation.check() || !file) return
    setBusy(true)
    setError('')
    try {
      onSaved(
        await createPersonnelFile(
          title,
          file,
          recipients.map((person) => person.id),
        ),
      )
    } catch (error) {
      setError(errorMessage(error))
      // Una respuesta perdida puede ocultar una publicación exitosa. No ofrecer reenvío ciego.
      setUncertain(true)
      onUncertain()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy}
      title="Nuevo expediente de personal"
      onClose={onClose}
    >
      <form
        className="memo-form"
        noValidate
        aria-busy={busy}
        onSubmit={(event) => void submit(event)}
      >
        <div className="memo-flow-note">
          <strong>Acceso individual para cada destinatario</strong>
          <p>
            Tú conservas acceso automáticamente. Cada persona podrá
            recuperar el archivo con su propia clave privada de cifrado, sin
            reunir al resto.
          </p>
        </div>
        <div
          id={validation.id('key')}
          tabIndex={-1}
          className="validation-target personnel-key-status"
        >
          <p>
            {keyLoading
              ? 'Consultando tu clave de cifrado…'
              : keyError ||
                (hasKey
                  ? 'Tu cuenta tiene una clave de cifrado activa.'
                  : 'Necesitas preparar y activar tu clave de cifrado antes de crear un expediente.')}
          </p>
          {!hasKey && !keyLoading && (
            <Link to="/claves">Abrir Mis claves</Link>
          )}
          <Button
            variant="ghost"
            disabled={busy || keyLoading}
            onClick={() => {
              setKeyLoading(true)
              setLoading(true)
              setRevision((n) => n + 1)
            }}
          >
            <RefreshCw size={15} /> Comprobar de nuevo
          </Button>
        </div>
        <TextField
          {...validation.field('title')}
          label="Título del expediente"
          maxLength={160}
          required
          disabled={busy || uncertain}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ej. Expediente de personal de prueba"
        />
        <label className="field">
          <span className="field-label">
            Documento original · hasta 5 MiB
          </span>
          <input
            id={validation.id('file')}
            type="file"
            required
            disabled={busy || uncertain}
            onBlur={validation.field('file').onBlur}
            aria-invalid={Boolean(validation.field('file').error)}
            aria-describedby={`${validation.id('file')}-error`}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null
              setFile(next)
              if (next && !title)
                setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 160))
            }}
          />
          <FieldError
            id={validation.id('file')}
            error={
              (file && documentFileError(file)) ||
              validation.field('file').error
            }
          />
        </label>
        <h3
          id={validation.id('recipients')}
          tabIndex={-1}
          className="validation-target"
        >
          Destinatarios · {recipients.length} de 255
        </h3>
        <p className="memo-note">
          Cada destinatario debe tener una cuenta vinculada y una clave de
          cifrado activa. La aplicación comprueba esas condiciones al
          guardar; este directorio muestra perfiles activos, no confirma su
          clave.
        </p>
        <div className="memo-selected">
          {recipients.map((person) => (
            <div key={person.id}>
              <span>
                <strong>{person.display_name}</strong>
                <small>{person.email}</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Quitar a ${person.display_name}`}
                disabled={busy || uncertain}
                onClick={() =>
                  setRecipients((values) =>
                    values.filter((p) => p.id !== person.id),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <TextField
          label="Buscar destinatarios"
          icon={Search}
          maxLength={80}
          value={search}
          disabled={busy || uncertain}
          placeholder="Nombre o correo"
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
            setLoading(true)
          }}
        />
        {directoryError ? (
          <DocumentMessage text={directoryError} />
        ) : loading ? (
          <p role="status">Consultando perfiles…</p>
        ) : (
          <div className="memo-candidate-list">
            {!page?.items.length && (
              <p className="memo-note">
                No hay perfiles con esta búsqueda.
              </p>
            )}
            {page?.items.map((person) => {
              const selected = recipients.some((p) => p.id === person.id)
              return (
                <div className="memo-candidate" key={person.id}>
                  <span>
                    <strong>
                      {person.display_name}
                      {person.id === auth.access?.profile.id ? ' · Tú' : ''}
                    </strong>
                    <small>{person.email}</small>
                  </span>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      uncertain ||
                      selected ||
                      recipients.length >= 255
                    }
                    onClick={() =>
                      setRecipients((values) =>
                        values.some((p) => p.id === person.id)
                          ? values
                          : [...values, person],
                      )
                    }
                  >
                    {selected ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                    {selected ? 'Seleccionado' : 'Seleccionar'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        <DocumentPagination
          offset={offset}
          total={page?.total ?? 0}
          size={10}
          loading={loading || busy || uncertain}
          onChange={(value) => {
            setOffset(value)
            setLoading(true)
          }}
        />
        <FormFeedback issues={validation.issues} busy={busy} />
        {error && <DocumentMessage text={error} />}
        {uncertain && (
          <p className="memo-note">
            Cierra esta ventana y actualiza el listado antes de intentar
            otra carga. Si el expediente ya aparece disponible, no lo
            vuelvas a crear. Si faltan claves activas, pide a los
            destinatarios que las activen en Mis claves.
          </p>
        )}
        <div className="memo-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {uncertain ? 'Cerrar y revisar listado' : 'Cancelar'}
          </Button>
          {!uncertain && (
            <Button type="submit" disabled={busy || !validation.valid}>
              {busy ? 'Cifrando y guardando…' : 'Cifrar y compartir'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
