import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { Link } from 'react-router'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import { Button } from '../../components/ui/Button'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import {
  documentFileError,
  passwordError,
  textError,
} from '../../lib/validation'
import { ApiError } from '../../lib/api'
import { useAuth } from '../auth/auth'
import {
  DocumentMessage,
  DocumentPagination,
} from '../documents/DocumentForms'
import {
  errorMessage,
  getKeys,
  getRecipients,
} from '../documents/memoranda'
import type { Candidate, Page, SigningKey } from '../documents/memoranda'
import { getEncryptionKeys } from '../group-notes/encryptionKeys'
import {
  createDiplomaticNote,
  noteKinds,
  readSigningPrivateFile,
  signingFileError,
} from './diplomaticNotes'
import type { DiplomaticDetail, NoteKind } from './diplomaticNotes'

export default function DiplomaticCreateForm({
  onClose,
  onSaved,
  onUncertain,
}: {
  onClose: () => void
  onSaved: (detail: DiplomaticDetail) => void
  onUncertain: () => void
}) {
  const auth = useAuth()
  const [title, setTitle] = useState(''),
    [file, setFile] = useState<File | null>(null)
  const [recipients, setRecipients] = useState<Candidate[]>([])
  const [kind, setKind] = useState<NoteKind>('diplomatic_note')
  const [signingKeys, setSigningKeys] = useState<SigningKey[]>([])
  const [signingId, setSigningId] = useState('')
  const [signingLoading, setSigningLoading] = useState(true)
  const [signingError, setSigningError] = useState('')
  const [privateFile, setPrivateFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
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
  const signingKey = signingKeys.find(
    (key) => key.id === signingId && key.is_active,
  )
  useEffect(() => {
    const controller = new AbortController()
    void getKeys(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          const active = result.items.filter((key) => key.is_active)
          setSigningKeys(active)
          setSigningId((previous) =>
            active.some((k) => k.id === previous)
              ? previous
              : (active[0]?.id ?? ''),
          )
          setSigningError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setSigningError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setSigningLoading(false)
      })
    return () => controller.abort()
  }, [revision])
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
    title: textError(title, 'el título del documento', 160),
    file: documentFileError(file),
    recipients: !recipients.length
      ? 'Selecciona al menos un destinatario.'
      : '',
    key: keyLoading
      ? 'Espera la consulta de tu clave.'
      : keyError ||
        (!hasKey ? 'Activa tu clave de cifrado en Mis claves.' : ''),
    signingKey: signingLoading
      ? 'Espera la consulta de tus claves de firma.'
      : signingError ||
        (!signingKey
          ? 'Prepara una clave de firma activa en Mis claves.'
          : ''),
    private: signingFileError(privateFile),
    password: passwordError(password),
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      busy ||
      uncertain ||
      !validation.check() ||
      !file ||
      !privateFile ||
      !signingKey
    )
      return
    setBusy(true)
    setError('')
    try {
      // Validar el respaldo local antes de iniciar una creación sin reenvíos.
      try {
        await readSigningPrivateFile(privateFile)
      } catch (error) {
        setError(errorMessage(error))
        return
      }
      onSaved(
        await createDiplomaticNote(
          kind,
          title,
          file,
          recipients.map((person) => person.id),
          signingKey,
          privateFile,
          password,
        ),
      )
    } catch (error) {
      setError(errorMessage(error))
      // Una respuesta perdida puede ocultar una publicación exitosa. No ofrecer reenvío ciego.
      const unknown =
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500
      setUncertain(unknown)
      if (unknown) onUncertain()
    } finally {
      setPassword('')
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy}
      title="Nueva nota o comunicado"
      onClose={onClose}
    >
      <form
        className="memo-form diplomatic-form"
        noValidate
        aria-busy={busy}
        onSubmit={(event) => void submit(event)}
      >
        <div className="memo-flow-note">
          <strong>
            Tu firma y acceso individual para cada destinatario
          </strong>
          <p>
            Firmarás con tu privada de firma. El archivo se cifrará una vez
            y cada persona lo recuperará con su propia privada de cifrado.
            Tú también conservas acceso.
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
                  : 'Necesitas preparar y activar tu clave de cifrado antes de crear un documento.')}
          </p>
          {!hasKey && !keyLoading && (
            <Link to="/claves">Abrir Mis claves</Link>
          )}
          <Button
            variant="ghost"
            disabled={busy || keyLoading}
            onClick={() => {
              setKeyLoading(true)
              setSigningLoading(true)
              setLoading(true)
              setRevision((n) => n + 1)
            }}
          >
            <RefreshCw size={15} /> Comprobar de nuevo
          </Button>
        </div>
        <label className="field">
          <span className="field-label">Tipo de documento</span>
          <select
            aria-label="Tipo de documento"
            value={kind}
            disabled={busy || uncertain}
            onChange={(event) => setKind(event.target.value as NoteKind)}
          >
            {Object.entries(noteKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <TextField
          {...validation.field('title')}
          label="Título del documento"
          maxLength={160}
          required
          disabled={busy || uncertain}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ej. Nota o comunicado de prueba"
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
        <section
          className="diplomatic-signing-panel"
          aria-label="Firma del emisor"
        >
          <h3>Firma del emisor</h3>
          <p className="memo-note">
            Usa tu privada de firma cifrada en .txt. Tu respaldo de cifrado
            .stckey.json se utiliza al recuperar, no en este paso.
          </p>
          <label className="field">
            <span className="field-label">
              Mi clave de firma registrada
            </span>
            <select
              id={validation.id('signingKey')}
              value={signingId}
              disabled={busy || uncertain || signingLoading}
              onBlur={validation.field('signingKey').onBlur}
              aria-invalid={Boolean(validation.field('signingKey').error)}
              aria-describedby={`${validation.id('signingKey')}-error`}
              onChange={(event) => setSigningId(event.target.value)}
            >
              <option value="">
                {signingLoading
                  ? 'Consultando claves…'
                  : 'Selecciona tu clave de firma'}
              </option>
              {signingKeys.map((key) => (
                <option value={key.id} key={key.id}>
                  {key.label} · {key.fingerprint.slice(0, 12)}…
                </option>
              ))}
            </select>
            <FieldError
              id={validation.id('signingKey')}
              error={validation.field('signingKey').error}
            />
          </label>
          {signingError && <DocumentMessage text={signingError} />}
          {!signingLoading && !signingKeys.length && (
            <Link to="/claves">
              Preparar mi clave de firma en Mis claves
            </Link>
          )}
          {signingKey && (
            <details className="flow-details">
              <summary>Identificar mi clave de firma</summary>
              <p className="memo-fingerprint">{signingKey.fingerprint}</p>
            </details>
          )}
          <label className="field">
            <span className="field-label">
              Mi privada de firma cifrada (.txt)
            </span>
            <input
              id={validation.id('private')}
              type="file"
              accept=".txt,text/plain"
              disabled={busy || uncertain}
              onBlur={validation.field('private').onBlur}
              aria-invalid={Boolean(validation.field('private').error)}
              aria-describedby={`${validation.id('private')}-error`}
              onChange={(event) =>
                setPrivateFile(event.target.files?.[0] ?? null)
              }
            />
            <FieldError
              id={validation.id('private')}
              error={
                (privateFile && signingFileError(privateFile)) ||
                validation.field('private').error
              }
            />
          </label>
          <TextField
            {...validation.field('password')}
            label="Contraseña de mi privada de firma"
            type="password"
            autoComplete="off"
            value={password}
            disabled={busy || uncertain}
            onChange={(event) => setPassword(event.target.value)}
          />
        </section>
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
            otra carga. Si el documento ya aparece disponible, no lo vuelvas
            a crear. Si faltan claves activas, pide a los destinatarios que
            las activen en Mis claves.
          </p>
        )}
        <div className="memo-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {uncertain ? 'Cerrar y revisar listado' : 'Cancelar'}
          </Button>
          {!uncertain && (
            <Button type="submit" disabled={busy || !validation.valid}>
              {busy
                ? 'Firmando, cifrando y guardando…'
                : 'Firmar, cifrar y compartir'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
