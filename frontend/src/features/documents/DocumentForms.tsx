import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  LoaderCircle,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth'
import { Button } from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import {
  createMemorandum,
  errorMessage,
  fileBase64,
  getKeys,
  getApprovers,
  getRecipients,
  signDocument,
} from './memoranda'
import type { Candidate, DocumentDetail, Page, SigningKey } from './memoranda'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import {
  documentFileError,
  passwordError,
  textError,
} from '../../lib/validation'
import { ApiError } from '../../lib/api'

export function DocumentMessage({
  text,
  success = false,
}: {
  text: string
  success?: boolean
}) {
  return (
    <div
      className={`memo-message ${success ? 'memo-message--success' : ''}`}
      role={success ? 'status' : 'alert'}
    >
      {success ? <CheckCircle2 size={18} /> : <Info size={18} />}
      <span>{text}</span>
    </div>
  )
}
export function DocumentPagination({
  offset,
  total,
  loading,
  size = 20,
  onChange,
}: {
  offset: number
  total: number
  loading: boolean
  size?: number
  onChange: (n: number) => void
}) {
  return (
    <div className="memo-pagination">
      <span>
        {total
          ? `${Math.min(offset + 1, total)}–${Math.min(offset + size, total)} de ${total}`
          : 'Sin resultados'}
      </span>
      <div>
        <Button
          variant="outline"
          aria-label="Página anterior"
          disabled={loading || offset === 0}
          onClick={() => onChange(Math.max(0, offset - size))}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="outline"
          aria-label="Página siguiente"
          disabled={loading || offset + size >= total}
          onClick={() => onChange(offset + size)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  )
}

function Recipients({
  selected,
  onPick,
  disabled,
  approvers = false,
  excludeId,
}: {
  approvers?: boolean
  excludeId?: string
  selected: string[]
  onPick: (person: Candidate) => void
  disabled: boolean
}) {
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page<Candidate> | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void (approvers ? getApprovers : getRecipients)(
        search.trim(),
        offset,
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setPage(value)
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(errorMessage(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [search, offset, approvers])
  return (
    <div className="memo-recipient-search">
      <TextField
        label={
          approvers ? 'Buscar Embajador aprobador' : 'Buscar destinatarios'
        }
        icon={Search}
        maxLength={80}
        value={search}
        disabled={disabled}
        placeholder="Nombre o correo"
        onChange={(event) => {
          setSearch(event.target.value)
          setOffset(0)
        }}
      />
      {error && <DocumentMessage text={error} />}
      {loading ? (
        <p className="memo-loading">
          <LoaderCircle className="access-spinner" size={17} />
          Consultando perfiles…
        </p>
      ) : (
        <div className="memo-candidate-list">
          {page?.items.length === 0 && (
            <p className="memo-note">
              No hay perfiles disponibles con esta búsqueda.
            </p>
          )}
          {page?.items
            .filter((person) => person.id !== excludeId)
            .map((person) => (
              <div className="memo-candidate" key={person.id}>
                <span>
                  <strong>{person.display_name}</strong>
                  <small>{person.email}</small>
                  <small>
                    {approvers
                      ? 'Embajador · aprobación institucional'
                      : 'Destinatario final · acceso después del envío'}
                  </small>
                </span>
                <Button
                  variant="outline"
                  disabled={disabled || selected.includes(person.id)}
                  onClick={() => onPick(person)}
                >
                  {selected.includes(person.id) ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <Plus size={15} />
                  )}
                  {selected.includes(person.id)
                    ? 'Seleccionado'
                    : 'Seleccionar'}
                </Button>
              </div>
            ))}
        </div>
      )}
      <DocumentPagination
        offset={offset}
        total={page?.total ?? 0}
        size={10}
        loading={loading || disabled}
        onChange={setOffset}
      />
    </div>
  )
}

export function MemoCreateForm({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (document: DocumentDetail) => void
}) {
  const auth = useAuth()
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [approver, setApprover] = useState<Candidate | null>(null)
  const [title, setTitle] = useState(''),
    [file, setFile] = useState<File | null>(null)
  const [recipients, setRecipients] = useState<Candidate[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const validation = useFormValidation({
    title: textError(title, 'el título del documento', 160),
    file: documentFileError(file),
    recipients:
      recipients.length === 0
        ? 'Selecciona al menos un destinatario final.'
        : '',
    approver:
      approvalRequired && !approver
        ? 'Selecciona al Embajador que aprobará el documento.'
        : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !validation.check() || !file) return
    setBusy(true)
    setError('')
    try {
      const document = await createMemorandum({
        title: title.trim(),
        filename: file.name,
        media_type: file.type || 'application/octet-stream',
        content_base64: await fileBase64(file),
        recipients: recipients.map((person) => ({ profile_id: person.id })),
        approver_id: approvalRequired ? (approver?.id ?? null) : null,
      })
      onSaved(document)
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy}
      title="Nuevo memorándum"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        noValidate
        aria-busy={busy}
        className="memo-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="memo-note">
          Tú serás el emisor y firmarás el documento con tu propia clave. Los
          destinatarios finales tendrán acceso únicamente después de que lo
          envíes.
        </p>
        <TextField
          {...validation.field('title')}
          label="Título del documento"
          value={title}
          maxLength={160}
          required
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ej. Memorándum de coordinación institucional"
        />
        <label className="field">
          <span className="field-label">Documento original · hasta 5 MiB</span>
          <input
            id={validation.id('file')}
            onBlur={validation.field('file').onBlur}
            aria-invalid={Boolean(
              validation.field('file').error ||
              (file && documentFileError(file)),
            )}
            aria-describedby={`${validation.id('file')}-error`}
            type="file"
            required
            disabled={busy}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null
              setFile(next)
              setError('')
              if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, ''))
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
        <div className="memo-flow-note">
          <strong>Emisor: {auth.access?.profile.display_name}</strong>
          <p>
            Tu firma acredita la emisión. No necesitas seleccionarte como
            destinatario ni marcar una casilla de firmante.
          </p>
        </div>
        <h3
          id={validation.id('recipients')}
          tabIndex={-1}
          className="validation-target"
        >
          Destinatarios finales
        </h3>
        <p className="memo-note">
          Selecciona al menos una persona. Guardar el borrador no le da acceso
          todavía.
        </p>
        <div className="memo-selected">
          {recipients.map((person) => (
            <div key={person.id}>
              <span>
                <strong>{person.display_name}</strong>
                <small>{person.email}</small>
              </span>
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                aria-label={`Quitar a ${person.display_name}`}
                onClick={() =>
                  setRecipients((values) =>
                    values.filter((r) => r.id !== person.id),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <Recipients
          selected={recipients.map((p) => p.id)}
          excludeId={auth.access?.profile.id}
          disabled={busy || recipients.length >= 255}
          onPick={(person) =>
            setRecipients((values) =>
              values.some((p) => p.id === person.id)
                ? values
                : [...values, person],
            )
          }
        />
        <label className="memo-approval-toggle">
          <input
            type="checkbox"
            checked={approvalRequired}
            disabled={busy}
            onChange={(event) => {
              const checked = event.currentTarget.checked
              setApprovalRequired(checked)
              if (!checked) setApprover(null)
            }}
          />{' '}
          Requiere aprobación institucional del Embajador
        </label>
        {approvalRequired && (
          <section
            id={validation.id('approver')}
            tabIndex={-1}
            className="memo-approval-picker validation-target"
          >
            <p className="memo-note">
              Después de tu firma solicitarás la aprobación. El Embajador
              revisará esa misma versión antes del envío final.
            </p>
            {approver ? (
              <div className="memo-selected">
                <div>
                  <span>
                    <strong>{approver.display_name}</strong>
                    <small>{approver.email}</small>
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    disabled={busy}
                    aria-label="Cambiar aprobador"
                    onClick={() => setApprover(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <Recipients
                approvers
                selected={[]}
                disabled={busy}
                onPick={setApprover}
              />
            )}
            {approver?.id === auth.access?.profile.id && (
              <p className="memo-note">
                Como emisor y Embajador, tu única firma cubrirá emisión y
                aprobación institucional.
              </p>
            )}
          </section>
        )}
        <FormFeedback issues={validation.issues} busy={busy} />
        {error && <DocumentMessage text={error} />}
        <div className="memo-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !validation.valid}>
            {busy ? 'Guardando borrador…' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function MemoSignForm({
  document,
  onClose,
  onSaved,
}: {
  document: DocumentDetail
  onClose: () => void
  onSaved: (document: DocumentDetail) => void
}) {
  const [keys, setKeys] = useState<SigningKey[]>([]),
    [keyId, setKeyId] = useState('')
  const [password, setPassword] = useState(''),
    [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void getKeys(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          const active = page.items.filter((k) => k.is_active)
          setKeys(active)
          setKeyId(active[0]?.id ?? '')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])
  const [credentialError, setCredentialError] = useState('')
  const [fileError, setFileError] = useState('')
  const validation = useFormValidation({
    key: loading
      ? 'Espera a que se consulten tus claves.'
      : !keyId
        ? 'Genera una clave activa en Mis claves de firma.'
        : '',
    file:
      fileError ||
      (!file
        ? 'Selecciona tu archivo de clave privada cifrada (.txt).'
        : file.size > 16384
          ? 'La clave supera los 16 KiB. Selecciona el archivo privado descargado.'
          : file.size === 0
            ? 'El archivo de clave está vacío. Selecciona tu clave privada.'
            : ''),
    password: passwordError(password) || credentialError,
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || loading || !validation.check() || !file) return
    setBusy(true)
    setError('')
    try {
      if (file.size > 16384)
        throw new Error('El archivo de clave supera el tamaño permitido.')
      const privateKey = (await file.text()).trim()
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          privateKey,
        ) ||
        !privateKey
      ) {
        setFileError(
          'El archivo no contiene Base64 válido. Selecciona la clave privada cifrada descargada, sin modificarla.',
        )
        return
      }
      const updated = await signDocument(document.document.id, {
        version_id: document.version.id,
        key_id: keyId,
        password,
        private_key_base64: privateKey,
      })
      setPassword('')
      setFile(null)
      onSaved(updated)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_signing_key') {
        setCredentialError(
          'No se pudo abrir la clave: revisa la contraseña y comprueba que el archivo privado corresponde a la clave registrada.',
        )
        window.setTimeout(
          () =>
            window.document.getElementById(validation.id('password'))?.focus(),
          0,
        )
      }
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy}
      title={
        document.document.signing_purpose === 'approval'
          ? 'Aprobar memorándum'
          : 'Firmar emisión'
      }
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        noValidate
        aria-busy={busy}
        className="memo-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="memo-note">
          Se firmarán los bytes almacenados de{' '}
          <strong>{document.version.filename}</strong>, versión{' '}
          {document.version.version_number}.{' '}
          {document.document.signing_purpose === 'approval'
            ? 'Tu firma registra la aprobación institucional. El backend comprobará también la firma del emisor.'
            : 'Tu firma identifica la emisión de esta versión; guardar o firmar no la entrega a los destinatarios finales.'}
        </p>
        {loading ? (
          <p className="memo-loading">Consultando claves…</p>
        ) : keys.length === 0 ? (
          <p
            id={validation.id('key')}
            tabIndex={-1}
            className="memo-note validation-target"
          >
            Primero genera tus claves en{' '}
            <Link to="/claves">Mis claves de firma</Link>.
          </p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Tu clave registrada</span>
              <select
                id={validation.id('key')}
                className="memo-select"
                value={keyId}
                disabled={busy}
                onChange={(event) => {
                  setKeyId(event.target.value)
                  setCredentialError('')
                }}
              >
                {keys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.label} · {key.fingerprint.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                Archivo de clave privada en Base64
              </span>
              <input
                id={validation.id('file')}
                onBlur={validation.field('file').onBlur}
                aria-invalid={Boolean(
                  fileError ||
                  validation.field('file').error ||
                  (file && file.size > 16384),
                )}
                aria-describedby={`${validation.id('file')}-error`}
                type="file"
                accept=".txt,text/plain"
                required
                disabled={busy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setFileError('')
                  setCredentialError('')
                  setError('')
                }}
              />
              <FieldError
                id={validation.id('file')}
                error={
                  fileError ||
                  (file && file.size > 16384
                    ? 'La clave supera los 16 KiB. Selecciona el archivo privado descargado.'
                    : validation.field('file').error)
                }
              />
            </label>
            <TextField
              {...validation.field('password')}
              error={credentialError || validation.field('password').error}
              hint="Usa la contraseña original de esta clave (de 12 a 256 caracteres)."
              label="Contraseña de la clave privada"
              type="password"
              value={password}
              minLength={12}
              maxLength={256}
              autoComplete="off"
              required
              disabled={busy}
              onChange={(event) => {
                setPassword(event.target.value)
                setCredentialError('')
                setError('')
              }}
            />
            <p className="memo-note">
              La clave privada se utiliza para esta firma y no se almacena en la
              plataforma.
            </p>
          </>
        )}
        <FormFeedback issues={validation.issues} busy={busy || loading} />
        {error && <DocumentMessage text={error} />}
        <div className="memo-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading || busy || !validation.valid}>
            {busy ? 'Firmando…' : 'Firmar documento'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
