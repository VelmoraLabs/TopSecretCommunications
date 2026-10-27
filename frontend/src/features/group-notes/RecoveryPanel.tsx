import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { entityId } from '../notifications/notifications'
import { Download, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import TextField from '../../components/ui/TextField'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { ApiError } from '../../lib/api'
import { useFormValidation } from '../../lib/useFormValidation'
import { passwordError, textError } from '../../lib/validation'
import { useAuth } from '../auth/auth'
import { DocumentMessage, DocumentPagination } from '../documents/DocumentForms'
import { errorMessage } from '../documents/memoranda'
import { downloadRecovered } from '../documents/specialNotes'
import type { NoteDetail } from './groupNotes'
import { readPrivateKey } from './encryptionKeys'
import type { PrivateKeyFile } from './encryptionKeys'
import {
  closeRecovery,
  contributeRecovery,
  createRecovery,
  downloadRecovery,
  getRecovery,
  listRecoveries,
  recoveryKey,
  recoveryStates,
  recoveryTime,
} from './recoveries'
import type { RecoveryDetail, RecoveryPage } from './recoveries'
import { useRecoveryUpdates } from './useRecoveryUpdates'

export default function RecoveryPanel({
  note,
  onBusyChange,
}: {
  note: NoteDetail
  onBusyChange: (value: boolean) => void
}) {
  const auth = useAuth()
  const [params] = useSearchParams()
  const [history, setHistory] = useState(false)
  const [page, setPage] = useState<RecoveryPage | null>(null),
    [selected, setSelected] = useState<string | null>(() =>
      entityId(params.get('solicitud')),
    ),
    [current, setCurrent] = useState<RecoveryDetail | null>(null)
  const [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const refresh = useCallback(() => setRevision((n) => n + 1), [])
  const live = useRecoveryUpdates(note.note.id, refresh)
  const working = (value: boolean) => {
    setBusy(value)
    onBusyChange(value)
  }
  useEffect(() => {
    const controller = new AbortController()
    void listRecoveries(note.note.id, offset, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result)
          const active = result.items.find((item) =>
            ['pending', 'ready'].includes(item.state),
          )
          setSelected(
            (previous) => previous || active?.id || result.items[0]?.id || null,
          )
          setError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [note.note.id, offset, revision])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    void getRecovery(selected, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setCurrent(result)
          setError('')
          if (
            result.recovery.state !== 'pending' ||
            result.participants.some(
              (person) =>
                person.profile_id === auth.access?.profile.id &&
                person.contributed_at,
            )
          )
            setNotice('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setCurrent(null)
          setError(errorMessage(error))
        }
      })
    return () => controller.abort()
  }, [selected, revision, auth.access?.profile.id])
  return (
    <section className="recovery-panel group-note-snapshot">
      <div className="group-notes-heading">
        <div>
          <p className="eyebrow">RECUPERACIÓN COLABORATIVA</p>
          <h3>Recuperar esta nota</h3>
        </div>
        <Button variant="outline" disabled={busy} onClick={refresh}>
          <RefreshCw size={16} />
          Actualizar estado
        </Button>
      </div>
      <p className="memo-note">
        Tu fragmento está almacenado cifrado. Al aportar, la aplicación lo
        obtiene y lo abre con tu clave privada: no necesitas subir el archivo de
        fragmento. Se requieren las aportaciones de todos; solo el solicitante
        recibe el documento.
      </p>
      <p className="memo-note">
        No necesitan estar conectados al mismo tiempo. Recibirás los avisos en
        Notificaciones.
      </p>
      <details className="flow-details">
        <summary>Estado de actualización</summary>
        <p>
          {live
            ? 'Actualizaciones en vivo conectadas.'
            : 'Actualización automática cada 5 segundos mientras la pestaña esté visible.'}
        </p>
      </details>
      {error && <DocumentMessage text={error} />}{' '}
      {notice && <DocumentMessage success text={notice} />}
      {auth.hasPermission('recovery.request') && (
        <Button
          disabled={busy || loading || Boolean(page?.has_open) || creating}
          onClick={() => {
            setCreating(true)
            setNotice('')
          }}
        >
          <UsersRound size={17} />
          Solicitar recuperación
        </Button>
      )}
      {page?.has_open &&
        page.items.some(
          (item) =>
            ['pending', 'ready'].includes(item.state) && item.id !== selected,
        ) && (
          <p className="memo-note">
            Hay una solicitud abierta para esta nota.{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCurrent(null)
                setSelected(
                  page.items.find((item) =>
                    ['pending', 'ready'].includes(item.state),
                  )!.id,
                )
              }}
            >
              Ver solicitud activa
            </button>
          </p>
        )}
      {creating && (
        <CreateForm
          noteId={note.note.id}
          busy={busy}
          working={working}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false)
            setCurrent(result)
            setSelected(result.recovery.id)
            setOffset(0)
            refresh()
            setNotice(
              'Solicitud creada. También debes aportar tu propio fragmento.',
            )
          }}
          onRefresh={refresh}
        />
      )}
      {loading ? (
        <p role="status">Consultando solicitudes…</p>
      ) : !page?.items.length && !error ? (
        <p className="memo-note">Todavía no hay solicitudes para esta nota.</p>
      ) : (
        <details
          className="flow-details"
          open={history}
          onToggle={(e) => setHistory(e.currentTarget.open)}
        >
          <summary>Historial de solicitudes</summary>
          <div className="recovery-list">
            {page?.items.map((item) => (
              <button
                type="button"
                className="recovery-item"
                key={item.id}
                aria-pressed={selected === item.id}
                disabled={busy}
                onClick={() => {
                  setCurrent(null)
                  setSelected(item.id)
                  setNotice('')
                }}
              >
                <span>
                  <strong>{item.requester_name}</strong>
                  <small>{item.reason}</small>
                  <small>
                    {item.contribution_count} de {item.participant_count}{' '}
                    aportaciones
                  </small>
                </span>
                <Badge
                  tone={
                    item.state === 'ready' || item.state === 'completed'
                      ? 'green'
                      : item.state === 'pending'
                        ? 'amber'
                        : 'neutral'
                  }
                >
                  {recoveryStates[item.state]}
                </Badge>
              </button>
            ))}
          </div>
          <DocumentPagination
            loading={loading || busy}
            offset={offset}
            total={page?.total ?? 0}
            onChange={setOffset}
          />
        </details>
      )}
      {selected && !current && !error && (
        <p role="status">Consultando el detalle de la solicitud…</p>
      )}
      {current && (
        <RecoveryActions
          key={current.recovery.id}
          detail={current}
          note={note}
          busy={busy}
          working={working}
          onChanged={(result) => {
            setCurrent(result)
            refresh()
          }}
          onRefresh={refresh}
        />
      )}
    </section>
  )
}

function CreateForm({
  noteId,
  busy,
  working,
  onClose,
  onCreated,
  onRefresh,
}: {
  noteId: string
  busy: boolean
  working: (value: boolean) => void
  onClose: () => void
  onCreated: (result: RecoveryDetail) => void
  onRefresh: () => void
}) {
  const [reason, setReason] = useState(''),
    [duration, setDuration] = useState(60),
    [id] = useState(() => crypto.randomUUID()),
    [submitted, setSubmitted] = useState(false),
    [error, setError] = useState('')
  const validation = useFormValidation({
    reason: textError(reason, 'el motivo de la recuperación', 240),
    duration: ![5, 15, 60, 1440].includes(duration)
      ? 'Selecciona un plazo válido.'
      : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || submitted || !validation.check()) return
    working(true)
    setSubmitted(true)
    setError('')
    try {
      onCreated(await createRecovery(noteId, id, reason, duration))
    } catch (error) {
      setError(
        `${errorMessage(error)} Revisa las solicitudes antes de crear otra.`,
      )
      onRefresh()
    } finally {
      working(false)
    }
  }
  return (
    <form
      className="memo-form recovery-form"
      noValidate
      aria-busy={busy}
      onSubmit={(event) => void submit(event)}
    >
      <h4>Nueva solicitud</h4>
      <TextField
        {...validation.field('reason')}
        label="Motivo de recuperación"
        maxLength={240}
        value={reason}
        disabled={busy || submitted}
        placeholder="Ej. Consultar el acuerdo para la reunión de coordinación"
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="memo-note">
        Plazo predeterminado: 1 hora. Los participantes recibirán una
        notificación.
      </p>
      <details className="flow-details">
        <summary>Cambiar plazo</summary>
        <label className="field">
          <span className="field-label">
            Plazo para reunir las aportaciones
          </span>
          <select
            id={validation.id('duration')}
            value={duration}
            disabled={busy || submitted}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            <option value={5}>5 minutos</option>
            <option value={15}>15 minutos</option>
            <option value={60}>1 hora</option>
            <option value={1440}>24 horas</option>
          </select>
        </label>
      </details>
      <p className="memo-note">
        Todos verán quién solicita el archivo, el motivo y cuándo vence. Nadie
        aporta automáticamente, incluido el solicitante.
      </p>
      <FormFeedback issues={validation.issues} busy={busy} />
      {error && <DocumentMessage text={error} />}
      <div className="memo-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {submitted ? 'Volver a las solicitudes' : 'Cancelar solicitud nueva'}
        </Button>
        <Button type="submit" disabled={busy || submitted || !validation.valid}>
          {busy ? 'Creando…' : 'Crear solicitud'}
        </Button>
      </div>
    </form>
  )
}

function RecoveryActions({
  detail,
  note,
  busy,
  working,
  onChanged,
  onRefresh,
}: {
  detail: RecoveryDetail
  note: NoteDetail
  busy: boolean
  working: (value: boolean) => void
  onChanged: (result: RecoveryDetail) => void
  onRefresh: () => void
}) {
  const auth = useAuth(),
    r = detail.recovery
  const [operation, setOperation] = useState<'contribute' | 'recover' | null>(
      null,
    ),
    [confirm, setConfirm] = useState<'cancel' | 'reject' | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const visibleOperation =
    operation === 'contribute' && r.can_contribute
      ? 'contribute'
      : operation === 'recover' && r.can_recover
        ? 'recover'
        : null
  async function close(action: 'cancel' | 'reject') {
    if (busy) return
    working(true)
    setError('')
    try {
      onChanged(await closeRecovery(r.id, action))
      setConfirm(null)
      setOperation(null)
    } catch (error) {
      setError(errorMessage(error))
      onRefresh()
    } finally {
      working(false)
    }
  }
  return (
    <div className="recovery-detail">
      <h4>Solicitud de {r.requester_name}</h4>
      <p>{r.reason}</p>
      <Badge
        tone={
          r.state === 'ready' || r.state === 'completed'
            ? 'green'
            : r.state === 'pending'
              ? 'amber'
              : 'neutral'
        }
      >
        {recoveryStates[r.state]}
      </Badge>
      <p className="recovery-progress" role="status">
        Han aportado {r.contribution_count} de {r.participant_count} integrantes
      </p>
      <p className="memo-note">
        Plazo para reunir aportaciones: {recoveryTime(r.expires_at)}.
      </p>
      {r.state === 'completed' && r.download_until && (
        <p className="info-note">
          La recuperación se completó. El solicitante puede repetir la descarga
          hasta {recoveryTime(r.download_until)}. Después se eliminan las
          aportaciones temporales.
        </p>
      )}
      <ul className="recovery-people">
        {detail.participants.map((p) => (
          <li key={p.profile_id}>
            <span>
              {p.display_name}
              {p.profile_id === auth.access?.profile.id ? ' (tú)' : ''}
            </span>
            <Badge
              tone={
                !p.is_active
                  ? 'amber'
                  : p.rejected_at
                    ? 'neutral'
                    : p.contributed_at
                      ? 'green'
                      : 'neutral'
              }
            >
              {!p.is_active
                ? 'Perfil desactivado'
                : p.rejected_at
                  ? 'Rechazó'
                  : p.contributed_at
                    ? 'Aportó'
                    : 'Pendiente'}
            </Badge>
          </li>
        ))}
      </ul>
      {r.blocked && (
        <DocumentMessage text="Hay integrantes desactivados o sin permiso para aportar. La recuperación requiere a todos los participantes originales; no se excluye a nadie automáticamente." />
      )}
      {notice && <DocumentMessage success text={notice} />}{' '}
      {error && <DocumentMessage text={error} />}
      <div className="memo-actions memo-actions--start">
        {r.can_contribute && (
          <Button
            disabled={busy}
            onClick={() => {
              setOperation('contribute')
              setNotice('')
              setConfirm(null)
            }}
          >
            <ShieldCheck size={17} />
            Aportar mi fragmento
          </Button>
        )}
        {r.can_recover && (
          <Button
            disabled={busy}
            onClick={() => {
              setOperation('recover')
              setNotice('')
              setConfirm(null)
            }}
          >
            <Download size={17} />
            {r.state === 'completed'
              ? 'Volver a descargar archivo'
              : 'Recuperar archivo'}
          </Button>
        )}
        {r.can_cancel && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setConfirm('cancel')
              setOperation(null)
            }}
          >
            Cancelar recuperación
          </Button>
        )}
        {r.can_reject && !r.can_cancel && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setConfirm('reject')
              setOperation(null)
            }}
          >
            Rechazar recuperación
          </Button>
        )}
      </div>
      {r.state === 'ready' && !r.can_recover && (
        <p className="memo-note">
          Ya se reunieron las aportaciones. Solo {r.requester_name} puede
          recuperar el archivo desde su cuenta.
        </p>
      )}
      {r.state === 'completed' &&
        r.requester_id === auth.access?.profile.id &&
        !r.can_recover &&
        !r.blocked && (
          <p className="memo-note">
            Terminó el plazo de descarga de esta recuperación. Puedes crear una
            solicitud nueva para volver a reunir las autorizaciones.
          </p>
        )}
      {confirm && (
        <div className="info-note recovery-confirm">
          <p>
            {confirm === 'cancel'
              ? '¿Cancelar esta recuperación?'
              : '¿Rechazar esta recuperación para todos?'}{' '}
            Se cerrará esta solicitud y se eliminarán sus aportaciones
            temporales. La nota original y los fragmentos asignados se
            conservan.
          </p>
          <div className="memo-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Conservar solicitud
            </Button>
            <Button disabled={busy} onClick={() => void close(confirm)}>
              {busy
                ? 'Cerrando…'
                : confirm === 'cancel'
                  ? 'Confirmar cancelación de recuperación'
                  : 'Confirmar rechazo de recuperación'}
            </Button>
          </div>
        </div>
      )}
      {visibleOperation && (
        <PrivateOperation
          key={`${r.id}-${visibleOperation}`}
          operation={visibleOperation}
          detail={detail}
          note={note}
          busy={busy}
          working={working}
          onClose={() => setOperation(null)}
          onSuccess={() => {
            setOperation(null)
            setNotice(
              visibleOperation === 'contribute'
                ? 'Tu aportación quedó registrada para esta solicitud.'
                : 'Documento recuperado e integridad verificada. Se inició la descarga.',
            )
            onRefresh()
          }}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

function PrivateOperation({
  operation,
  detail,
  note,
  busy,
  working,
  onClose,
  onSuccess,
  onRefresh,
}: {
  operation: 'contribute' | 'recover'
  detail: RecoveryDetail
  note: NoteDetail
  busy: boolean
  working: (value: boolean) => void
  onClose: () => void
  onSuccess: () => void
  onRefresh: () => void
}) {
  const auth = useAuth(),
    r = detail.recovery
  const expected = recoveryKey(
    detail,
    note.participants,
    auth.access!.profile.id,
    operation,
  )
  const [privateFile, setPrivateFile] = useState<PrivateKeyFile | null>(null),
    [privateFilename, setPrivateFilename] = useState(''),
    [password, setPassword] = useState(''),
    [fileError, setFileError] = useState(''),
    [passwordIssue, setPasswordIssue] = useState(''),
    [reading, setReading] = useState(false),
    [consent, setConsent] = useState(false),
    [error, setError] = useState('')
  const validation = useFormValidation({
    file:
      fileError ||
      (!privateFile ? 'Selecciona la clave privada de cifrado indicada.' : ''),
    password: passwordIssue || passwordError(password),
    consent:
      operation === 'contribute' && !consent
        ? 'Confirma que autorizas esta recuperación para el solicitante.'
        : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || reading || !privateFile || !validation.check()) return
    working(true)
    setError('')
    try {
      if (operation === 'contribute')
        await contributeRecovery(r.id, privateFile.private_base64, password)
      else
        downloadRecovered(
          await downloadRecovery(r.id, privateFile.private_base64, password),
        )
      setPassword('')
      setPrivateFile(null)
      setPrivateFilename('')
      onSuccess()
    } catch (error) {
      setError(errorMessage(error))
      if (
        error instanceof ApiError &&
        error.code === 'invalid_encryption_private_key'
      )
        setPasswordIssue(
          'No se pudo abrir la clave. Revisa su contraseña y el archivo.',
        )
      onRefresh()
    } finally {
      working(false)
    }
  }
  return (
    <form
      className="memo-form recovery-form"
      noValidate
      aria-busy={busy || reading}
      onSubmit={(event) => void submit(event)}
    >
      <h4>
        {operation === 'contribute'
          ? 'Autorizar con mi fragmento'
          : 'Descifrar para mi cuenta'}
      </h4>
      <p className="memo-note">
        {operation === 'contribute'
          ? 'Tu fragmento se obtiene de la base de datos. Usa la clave privada con la que fue protegido para autorizar su apertura, aunque ya esté retirada.'
          : 'Las aportaciones están protegidas para tu cuenta. Usa la clave privada que estaba activa al crear esta solicitud para abrirlas y reconstruir la clave del documento.'}
      </p>
      <p className="memo-note">
        Archivo esperado: {expected.id}.stckey.json. No selecciones una clave de
        firma ni un fragmento.
      </p>
      <details className="flow-details">
        <summary>Huella de la clave requerida</summary>
        <p className="memo-fingerprint">{expected.fingerprint}</p>
      </details>
      <label className="field">
        <span className="field-label">
          Clave privada para{' '}
          {operation === 'contribute' ? 'aportar' : 'recuperar'} (.stckey.json)
        </span>
        <input
          id={validation.id('file')}
          type="file"
          accept=".json,application/json"
          disabled={busy || reading}
          aria-invalid={Boolean(fileError || validation.field('file').error)}
          aria-describedby={`${validation.id('file')}-error`}
          onBlur={validation.field('file').onBlur}
          onChange={(e) => {
            const input = e.currentTarget
            const file = input.files?.[0]
            setPrivateFile(null)
            setPrivateFilename('')
            setFileError('')
            setPasswordIssue('')
            if (!file) return
            setReading(true)
            onBusyReading(true)
            void readPrivateKey(file, expected)
              .then((value) => {
                setPrivateFile(value)
                setPrivateFilename(file.name)
              })
              .catch((error) => {
                input.value = ''
                setFileError(errorMessage(error))
              })
              .finally(() => {
                setReading(false)
                onBusyReading(false)
              })
          }}
        />
        <FieldError
          id={validation.id('file')}
          error={fileError || validation.field('file').error}
        />
      </label>
      {privateFile && (
        <p className="memo-note selected-key-file" role="status">
          Archivo seleccionado: <strong>{privateFilename}</strong>. Formato
          revisado; la clave se comprobará al continuar.
        </p>
      )}
      <TextField
        {...validation.field('password')}
        error={passwordIssue || validation.field('password').error}
        label="Contraseña de tu clave privada"
        type="password"
        autoComplete="current-password"
        value={password}
        disabled={busy || reading}
        onChange={(e) => {
          setPassword(e.target.value)
          setPasswordIssue('')
        }}
      />
      {operation === 'contribute' && (
        <label
          id={validation.id('consent')}
          tabIndex={-1}
          className="group-note-ack"
        >
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || reading}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Autorizo que {r.requester_name} recupere esta nota para el motivo
            indicado en esta solicitud.
          </span>
        </label>
      )}
      <FormFeedback issues={validation.issues} busy={busy || reading} />
      {error && <DocumentMessage text={error} />}
      <div className="memo-actions">
        <Button variant="outline" disabled={busy || reading} onClick={onClose}>
          Cerrar operación
        </Button>
        <Button type="submit" disabled={busy || reading || !validation.valid}>
          {busy
            ? 'Procesando…'
            : operation === 'contribute'
              ? 'Autorizar y aportar mi fragmento'
              : 'Descifrar y descargar archivo'}
        </Button>
      </div>
    </form>
  )
  function onBusyReading(value: boolean) {
    working(value)
  }
}
