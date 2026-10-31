import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Download, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import { passwordError } from '../../lib/validation'
import { useAuth } from '../auth/auth'
import { DocumentMessage } from '../documents/DocumentForms'
import { formatDocumentDate } from '../documents/documentPresentation'
import { errorMessage, saveBase64 } from '../documents/memoranda'
import {
  cancelDiplomaticNote,
  getDiplomaticNote,
  openDiplomaticNote,
  diplomaticSize,
  diplomaticStates,
  noteKinds,
} from './diplomaticNotes'
import type { DiplomaticDetail as Detail } from './diplomaticNotes'

export default function DiplomaticDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const auth = useAuth()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [password, setPassword] = useState(''),
    [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getDiplomaticNote(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setDetail(value)
          setError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetail(null)
          setError(errorMessage(error))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, revision])
  const assigned = detail?.participants.find(
    (person) => person.profile_id === auth.access?.profile.id,
  )
  const validation = useFormValidation({
    file: !file
      ? 'Selecciona el archivo privado de la clave indicada.'
      : file.size > 32 * 1024
        ? 'El archivo de clave supera los 32 KiB.'
        : '',
    password: passwordError(password),
  })
  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !detail || !file || !auth.access || !validation.check())
      return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await openDiplomaticNote(
        detail,
        auth.access.profile.id,
        file,
        password,
      )
      saveBase64(result.filename, result.content_base64)
      setNotice(
        'Firma del emisor e integridad verificadas. Se inició la descarga del documento.',
      )
      setRecovered(true)
      setFile(null)
      if (input.current) input.current.value = ''
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setPassword('')
      setBusy(false)
    }
  }
  async function cancel() {
    if (busy || !detail) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setDetail(await cancelDiplomaticNote(detail.file.id))
      setConfirmCancel(false)
      setNotice(
        'La carga se canceló y se solicitó la limpieza de su archivo incompleto.',
      )
      onChanged()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  function refresh() {
    setRecovered(false)
    setPassword('')
    setNotice('')
    setFile(null)
    if (input.current) input.current.value = ''
    setLoading(true)
    setConfirmCancel(false)
    setRevision((n) => n + 1)
  }
  return (
    <Modal open busy={busy} title="Nota o comunicado" onClose={onClose}>
      <div className="memo-form">
        {loading ? (
          <p role="status">Consultando documento…</p>
        ) : (
          detail && (
            <>
              <div className="personnel-detail-title">
                <h3>{detail.file.title}</h3>
                <Badge
                  tone={
                    detail.file.state === 'ready'
                      ? 'green'
                      : detail.file.state === 'staging'
                        ? 'amber'
                        : 'neutral'
                  }
                >
                  {diplomaticStates[detail.file.state]}
                </Badge>
              </div>
              <dl className="personnel-metadata">
                <div>
                  <dt>Archivo</dt>
                  <dd>{detail.file.filename}</dd>
                </div>
                <div>
                  <dt>Tamaño</dt>
                  <dd>{diplomaticSize(detail.file.size)}</dd>
                </div>
                <div>
                  <dt>Creado</dt>
                  <dd>{formatDocumentDate(detail.file.created_at)}</dd>
                </div>
                <div>
                  <dt>Protección</dt>
                  <dd>Firma RSA-PSS + AES-GCM y RSA-OAEP</dd>
                </div>
                <div>
                  <dt>Tipo</dt>
                  <dd>{noteKinds[detail.file.kind]}</dd>
                </div>
                <div>
                  <dt>Emisor</dt>
                  <dd>{detail.signer.display_name}</dd>
                </div>
              </dl>
              <section
                className="diplomatic-signing-panel"
                aria-label="Firma del documento"
              >
                <h3>Firma del emisor</h3>
                <p>
                  Firmante registrado:{' '}
                  <strong>{detail.signer.display_name}</strong>
                </p>
                <p className="memo-note">
                  Al recuperar el archivo, la aplicación comprueba la firma
                  y la integridad con la clave original del emisor.
                </p>
                <details className="flow-details">
                  <summary>Identificar la firma original</summary>
                  <p className="memo-note">Clave: {detail.signer.key_id}</p>
                  <p className="memo-fingerprint">
                    {detail.signer.fingerprint}
                  </p>
                  <p className="memo-note">
                    {detail.signer.is_active
                      ? 'Clave de firma vigente.'
                      : 'Clave de firma retirada; sus firmas anteriores conservan la verificación.'}
                  </p>
                </details>
              </section>
              <div className="memo-flow-note">
                <strong>
                  <ShieldCheck size={17} /> Apertura individual
                </strong>
                <p>
                  El archivo se cifra una vez y la clave AES se protege para
                  cada persona. No necesitas aportaciones de otros
                  destinatarios.
                </p>
              </div>
              <section aria-label="Personas con acceso">
                <h3>Personas con acceso · {detail.participants.length}</h3>
                <ul className="personnel-participants">
                  {detail.participants.map((person) => (
                    <li key={person.profile_id}>
                      <div>
                        <strong>
                          {person.display_name}
                          {person.profile_id === auth.access?.profile.id
                            ? ' · Tú'
                            : ''}
                        </strong>
                        <small>{person.email}</small>
                      </div>
                      <span>
                        {person.profile_id === detail.file.created_by
                          ? 'Emisor'
                          : 'Destinatario'}
                        {!person.is_active ? ' · Cuenta inactiva' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              {detail.file.state === 'ready' &&
                assigned?.is_active &&
                !recovered && (
                  <form
                    className="memo-form personnel-open-form"
                    noValidate
                    aria-busy={busy}
                    onSubmit={(event) => void download(event)}
                  >
                    <h3>
                      <KeyRound size={18} /> Recuperar mi documento
                    </h3>
                    <p className="memo-note">
                      Selecciona la clave privada de cifrado original
                      (.stckey.json), no una clave de firma. Aunque hayas
                      activado una clave nueva, este documento conserva la
                      anterior.
                    </p>
                    <details className="flow-details">
                      <summary>Identificar mi clave original</summary>
                      <p className="memo-note">
                        Archivo habitual: {assigned.key_id}.stckey.json
                      </p>
                      <p className="memo-fingerprint">
                        {assigned.fingerprint}
                      </p>
                      <Link to="/claves">Consultar Mis claves</Link>
                    </details>
                    <label className="field">
                      <span className="field-label">
                        Mi clave privada de cifrado
                      </span>
                      <input
                        ref={input}
                        id={validation.id('file')}
                        type="file"
                        accept=".json,application/json"
                        required
                        disabled={busy}
                        onBlur={validation.field('file').onBlur}
                        aria-invalid={Boolean(
                          validation.field('file').error,
                        )}
                        aria-describedby={`${validation.id('file')}-error`}
                        onChange={(event) => {
                          setFile(event.target.files?.[0] ?? null)
                          setError('')
                          setNotice('')
                        }}
                      />
                      <FieldError
                        id={validation.id('file')}
                        error={validation.field('file').error}
                      />
                    </label>
                    <TextField
                      {...validation.field('password')}
                      label="Contraseña de la clave privada"
                      type="password"
                      autoComplete="off"
                      required
                      value={password}
                      disabled={busy}
                      maxLength={256}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setError('')
                      }}
                    />
                    <FormFeedback issues={validation.issues} busy={busy} />
                    <Button
                      type="submit"
                      disabled={busy || !validation.valid}
                    >
                      <Download size={17} />
                      {busy
                        ? 'Verificando y recuperando…'
                        : 'Verificar firma y descargar'}
                    </Button>
                  </form>
                )}
              {detail.file.state !== 'ready' && (
                <p className="memo-note">
                  {detail.file.state === 'staging'
                    ? 'Esta carga no se publicó. Actualiza antes de cancelarla por si otra operación sigue en curso.'
                    : 'Esta carga se canceló. No hay un documento disponible para descargar.'}
                </p>
              )}
              {detail.file.state !== 'ready' &&
                detail.file.created_by === auth.access?.profile.id &&
                auth.hasPermission('documents.create') && (
                  <div className="personnel-cancel">
                    {confirmCancel ? (
                      <>
                        <p>
                          ¿Cancelar esta carga y retirar cualquier archivo
                          incompleto? Si ya se publicó, el servidor
                          conservará el documento.
                        </p>
                        <div className="memo-actions">
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setConfirmCancel(false)}
                          >
                            Volver
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() => void cancel()}
                          >
                            {busy ? 'Procesando…' : 'Confirmar cancelación'}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirmCancel(true)}
                      >
                        {detail.file.state === 'cancelled'
                          ? 'Reintentar limpieza de la carga'
                          : 'Cancelar carga incompleta'}
                      </Button>
                    )}
                  </div>
                )}
            </>
          )
        )}
        {error && <DocumentMessage text={error} />}
        {notice && <DocumentMessage success text={notice} />}
        <div className="memo-actions">
          <Button
            variant="outline"
            disabled={busy || loading}
            onClick={refresh}
          >
            <RefreshCw size={16} /> Actualizar
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
