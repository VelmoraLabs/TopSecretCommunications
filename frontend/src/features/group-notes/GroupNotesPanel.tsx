import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Download,
  FileLock2,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { entityId } from '../notifications/notifications'
import { Button } from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import { documentFileError, textError } from '../../lib/validation'
import { useAuth } from '../auth/auth'
import { DocumentMessage, DocumentPagination } from '../documents/DocumentForms'
import { errorMessage } from '../documents/memoranda'
import { downloadJson, formatBytes } from '../documents/specialNotes'
import {
  cancelNote,
  confirmBackup,
  createNote,
  getNote,
  getPackage,
  groupProblem,
  listNoteGroups,
  listNotes,
  readBackup,
  stateNames,
} from './groupNotes'
import type { NoteBackup, NoteDetail, NoteGroup } from './groupNotes'
import OwnSharePanel from './OwnSharePanel'
import RecoveryPanel from './RecoveryPanel'
import '../documents/memoranda.css'
import './group-notes.css'

export default function GroupNotesPanel({
  onRecover,
}: {
  onRecover: (backup: NoteBackup) => void
}) {
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const linkedNote = entityId(params.get('nota'))
  const [page, setPage] = useState<Awaited<
    ReturnType<typeof listNotes>
  > | null>(null)
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const importValidation = useFormValidation({ file: importError })
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void listNotes(search.trim(), offset, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setPage(result)
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(errorMessage(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [search, offset, revision])
  return (
    <section className="group-notes-panel">
      <div className="group-notes-heading">
        <div>
          <p className="eyebrow">ARCHIVO DEL GRUPO</p>
          <h2>Notas especiales compartidas</h2>
          <p>
            El documento se guarda cifrado. Su grupo y participantes originales
            se conservan.
          </p>
        </div>
        {auth.hasPermission('documents.create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            Nueva nota de grupo
          </Button>
        )}
      </div>
      <div className="info-note">
        <ShieldCheck size={19} />
        <p>
          <strong>Un fragmento por integrante.</strong> La plataforma conserva
          cada fragmento cifrado para su destinatario. Cada persona autoriza su
          aportación con su clave privada; no necesita subir un archivo de
          fragmento.
        </p>
      </div>
      {notice && <DocumentMessage success text={notice} />}
      <Card className="group-notes-card">
        <div className="group-notes-toolbar">
          <TextField
            label="Buscar notas de grupo"
            hideLabel
            icon={Search}
            placeholder="Buscar por título"
            value={search}
            maxLength={80}
            onChange={(e) => {
              setSearch(e.target.value)
              setOffset(0)
            }}
          />
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw size={16} />
            Actualizar
          </Button>
        </div>
        {error && <DocumentMessage text={error} />}
        {loading ? (
          <p className="memo-loading" role="status">
            <LoaderCircle size={17} className="access-spinner" />
            Consultando tus notas…
          </p>
        ) : !page?.items.length && !error ? (
          <div className="empty-state">
            <div className="empty-icon">
              <FileLock2 size={28} />
            </div>
            <h3>
              {search
                ? 'No hay notas con ese título'
                : 'Tu grupo todavía no tiene notas compartidas'}
            </h3>
            <p>
              {search
                ? 'Prueba con otro título.'
                : 'Aquí aparecerán las notas de las que eres participante original y tus preparaciones pendientes.'}
            </p>
          </div>
        ) : (
          <div className="group-note-list">
            {page?.items.map((note) => (
              <button
                className="group-note-item"
                key={note.id}
                onClick={() => setSelected(note.id)}
              >
                <FileLock2 size={23} />
                <span>
                  <strong>{note.title}</strong>
                  <small>
                    {note.group_name} · {note.participant_count} participantes ·{' '}
                    {formatBytes(note.size)}
                  </small>
                  <small>{note.filename}</small>
                </span>
                <Badge
                  tone={
                    note.state === 'ready'
                      ? 'green'
                      : note.state === 'cancelled'
                        ? 'neutral'
                        : 'amber'
                  }
                >
                  {stateNames[note.state]}
                </Badge>
              </button>
            ))}
          </div>
        )}
        <DocumentPagination
          offset={offset}
          total={page?.total ?? 0}
          loading={loading}
          onChange={setOffset}
        />
      </Card>
      <details className="flow-details">
        <summary>Recuperación manual de notas anteriores</summary>
        <Card className="group-notes-card group-note-backup-help">
          <div>
            <h3>¿Tienes el resguardo de una nota?</h3>
            <p>
              Para notas anteriores con custodia manual, importa tu copia para
              preparar la recuperación portable. Contiene todos los fragmentos:
              trátala como información confidencial.
            </p>
          </div>
          <label className="field">
            <span className="field-label">
              Resguardo de nota de grupo (.json)
            </span>
            <input
              type="file"
              accept=".json,application/json"
              id={importValidation.id('file')}
              aria-invalid={Boolean(importError)}
              aria-describedby={`${importValidation.id('file')}-error`}
              disabled={importBusy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (!file) return
                setImportBusy(true)
                setImportError('')
                void readBackup(file)
                  .then(onRecover)
                  .catch((error) => setImportError(errorMessage(error)))
                  .finally(() => setImportBusy(false))
              }}
            />
            <FieldError id={importValidation.id('file')} error={importError} />
          </label>
          {importBusy && <p role="status">Leyendo resguardo…</p>}
        </Card>
      </details>
      {creating && (
        <CreateForm
          onClose={() => setCreating(false)}
          onFailure={() => setRevision((n) => n + 1)}
          onCreated={(result) => {
            setCreating(false)
            setSelected(result.note.id)
            setOffset(0)
            setRevision((n) => n + 1)
            setNotice(
              'Nota cifrada y fragmentos distribuidos a sus participantes originales.',
            )
          }}
        />
      )}
      {(linkedNote || selected) && (
        <NoteDialog
          key={`${linkedNote || selected}-${params.get('solicitud') || ''}`}
          noteId={(linkedNote || selected)!}
          onClose={() => {
            setSelected(null)
            const next = new URLSearchParams(params)
            next.delete('nota')
            next.delete('solicitud')
            setParams(next, { replace: true })
          }}
          onChanged={(detail) => {
            setSelected(detail.note.id)
            setRevision((n) => n + 1)
          }}
        />
      )}
    </section>
  )
}

function CreateForm({
  onClose,
  onCreated,
  onFailure,
}: {
  onClose: () => void
  onCreated: (result: NoteDetail) => void
  onFailure: () => void
}) {
  const [group, setGroup] = useState<NoteGroup | null>(null),
    [title, setTitle] = useState(''),
    [file, setFile] = useState<File | null>(null)
  const [groups, setGroups] = useState<Awaited<
    ReturnType<typeof listNoteGroups>
  > | null>(null)
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false),
    [requestId] = useState(() => crypto.randomUUID())
  const validation = useFormValidation({
    title: textError(title, 'el título de la nota', 160),
    file: documentFileError(file),
    group: groupProblem(group),
  })
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void listNoteGroups(search.trim(), offset, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setGroups(result)
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
  }, [search, offset, revision])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || submitted || !validation.check() || !file || !group) return
    setBusy(true)
    setSubmitted(true)
    setError('')
    try {
      onCreated(await createNote(requestId, group, title, file))
    } catch (error) {
      setError(
        `${errorMessage(error)} Revisa la lista de notas antes de crear otra: la respuesta de la carga pudo perderse.`,
      )
      onFailure()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      title="Nueva nota especial de grupo"
      busy={busy}
      onClose={onClose}
    >
      <form
        className="memo-form"
        noValidate
        aria-busy={busy}
        onSubmit={(e) => void submit(e)}
      >
        <p className="memo-note">
          El archivo se cifra con AES-256-GCM y su clave se divide con Shamir.
          Se requiere un fragmento por cada integrante original, incluyendo tu
          cuenta.
        </p>
        <TextField
          {...validation.field('title')}
          label="Título de la nota"
          value={title}
          required
          maxLength={160}
          disabled={busy || submitted}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Acuerdo reservado de cooperación"
        />
        <label className="field">
          <span className="field-label">Archivo original · hasta 5 MiB</span>
          <input
            id={validation.id('file')}
            type="file"
            required
            disabled={busy || submitted}
            onBlur={validation.field('file').onBlur}
            aria-invalid={Boolean(
              (file && documentFileError(file)) ||
              validation.field('file').error,
            )}
            aria-describedby={`${validation.id('file')}-error`}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
          id={validation.id('group')}
          tabIndex={-1}
          className="validation-target group-note-picker"
        >
          <div className="group-notes-heading">
            <h3>Grupo destinatario</h3>
            <Button
              variant="ghost"
              disabled={busy || loading || submitted}
              onClick={() => {
                setGroup(null)
                setRevision((n) => n + 1)
              }}
            >
              <RefreshCw size={15} />
              Actualizar grupos
            </Button>
          </div>
          <TextField
            label="Buscar entre mis grupos activos"
            value={search}
            maxLength={80}
            disabled={busy || submitted}
            icon={Search}
            onChange={(e) => {
              setSearch(e.target.value)
              setOffset(0)
            }}
          />
          {loading ? (
            <p className="memo-loading" role="status">
              Consultando grupos…
            </p>
          ) : groups?.items.length === 0 ? (
            <p className="memo-note">
              No hay grupos activos disponibles con esta búsqueda. Debes
              pertenecer al grupo para crear su nota.{' '}
              <Link to="/grupos">Consultar grupos e integrantes</Link>.
            </p>
          ) : (
            <div className="group-note-options">
              {groups?.items.map((item) => (
                <Button
                  key={item.id}
                  variant={group?.id === item.id ? 'secondary' : 'outline'}
                  disabled={busy || submitted}
                  aria-pressed={group?.id === item.id}
                  onClick={() => setGroup(item)}
                >
                  <UsersRound size={16} />
                  <span>
                    {item.name} · {item.members.length} integrantes
                  </span>
                  {group?.id === item.id && <span>Seleccionado</span>}
                </Button>
              ))}
            </div>
          )}
          <DocumentPagination
            loading={loading || busy || submitted}
            offset={offset}
            total={groups?.total ?? 0}
            onChange={setOffset}
          />
          {group && (
            <div className="group-note-snapshot">
              <strong>
                {group.name} · {group.members.length} de {group.members.length}{' '}
                fragmentos
              </strong>
              <p>Participantes que se fijarán al crear la nota:</p>
              <ul>
                {group.members.map((person, index) => (
                  <li key={person.profile_id}>
                    <span>
                      {index + 1}. {person.display_name}
                      <small>{person.email}</small>
                    </span>
                    <Badge
                      tone={
                        !person.is_active || !person.encryption_ready
                          ? 'amber'
                          : 'green'
                      }
                    >
                      {!person.is_active
                        ? 'Perfil desactivado'
                        : !person.encryption_ready
                          ? 'Falta clave de cifrado'
                          : 'Clave de cifrado activa'}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p>
                El servidor volverá a comprobar el grupo. Agregar o retirar
                integrantes después no cambia esta nota.
              </p>
            </div>
          )}
        </section>
        <p className="info-note">
          <Info size={17} />
          Cada integrante recibirá su propio fragmento cifrado. Nadie recibirá
          un resguardo con todos los fragmentos. Antes de crear, cada persona
          debe activar su clave en Mis claves.
        </p>
        <FormFeedback issues={validation.issues} busy={busy} />
        {error && <DocumentMessage text={error} />}
        {submitted && !busy && (
          <p className="memo-note">
            Cierra este formulario y pulsa Actualizar en la lista. Si aparece
            una carga pendiente, cancélala antes de volver a crear la nota.
          </p>
        )}
        <div className="memo-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {submitted ? 'Volver a la lista' : 'Cancelar'}
          </Button>
          <Button
            type="submit"
            disabled={busy || submitted || !validation.valid}
          >
            {busy ? 'Cifrando y guardando…' : 'Cifrar y guardar nota'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function NoteDialog({
  noteId,
  onClose,
  onChanged,
}: {
  noteId: string
  onClose: () => void
  onChanged: (detail: NoteDetail) => void
}) {
  const auth = useAuth()
  const [detail, setDetail] = useState<NoteDetail | null>(null),
    [loading, setLoading] = useState(true)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState(''),
    [saved, setSaved] = useState(false),
    [ack, setAck] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [backupError, setBackupError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void getNote(noteId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [noteId])
  const validation = useFormValidation({
    backup:
      !saved || !receipt
        ? 'Descarga y guarda el resguardo, o importa la copia que ya guardaste.'
        : '',
    ack: !ack ? 'Confirma que guardaste el resguardo en un lugar seguro.' : '',
  })
  const owner = detail?.note.created_by === auth.access?.profile.id
  async function act(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="Detalle de nota especial" busy={busy} onClose={onClose}>
      <div className="memo-form">
        {loading && (
          <p className="memo-loading" role="status">
            Consultando nota…
          </p>
        )}
        {error && <DocumentMessage text={error} />}
        {detail && (
          <>
            <div className="detail-badges">
              <Badge
                tone={
                  detail.note.state === 'ready'
                    ? 'green'
                    : detail.note.state === 'cancelled'
                      ? 'neutral'
                      : 'amber'
                }
              >
                {stateNames[detail.note.state]}
              </Badge>
              <Badge tone="purple">
                {detail.note.threshold} de {detail.note.participant_count}
              </Badge>
            </div>
            <h3>{detail.note.title}</h3>
            <p className="memo-note">
              {detail.note.filename} · {formatBytes(detail.note.size)} · Creada
              por {detail.note.creator_name}
            </p>
            <section className="group-note-snapshot">
              <h3>{detail.note.group_name}</h3>
              <p>
                Grupo en su versión {detail.note.group_version}. Estos son los
                participantes originales; sus papeles se muestran como estaban
                al crear la nota.
              </p>
              <ul>
                {detail.participants.map((person) => (
                  <li key={person.profile_id}>
                    <span>
                      {person.share_index}. {person.display_name}
                      <small>{person.email}</small>
                    </span>
                    <Badge tone="neutral">
                      {person.group_role === 'manager'
                        ? 'Responsable'
                        : 'Integrante'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
            {detail.note.custody_mode === 'portable' &&
              detail.note.state === 'awaiting_backup' &&
              owner && (
                <>
                  <div className="info-note">
                    <Info size={18} />
                    <p>
                      El documento ya está cifrado y guardado, pero todavía no
                      está compartido. El resguardo contiene todos los
                      fragmentos; guárdalo fuera de la plataforma antes de
                      continuar.
                    </p>
                  </div>
                  <div
                    id={validation.id('backup')}
                    tabIndex={-1}
                    className="validation-target"
                  >
                    <label className="field">
                      <span className="field-label">
                        O importa tu resguardo guardado (.stcbackup.json)
                      </span>
                      <input
                        type="file"
                        accept=".json,application/json"
                        id={`${validation.id('backup')}-file`}
                        aria-invalid={Boolean(backupError)}
                        aria-describedby={`${validation.id('backup')}-file-error`}
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0]
                          e.currentTarget.value = ''
                          if (!file) return
                          setSaved(false)
                          setBackupError('')
                          setReceipt('')
                          setAck(false)
                          void act(async () => {
                            try {
                              const result = await readBackup(file, detail)
                              setReceipt(result.receipt)
                              setSaved(true)
                            } catch (error) {
                              setBackupError(errorMessage(error))
                            }
                          })
                        }}
                      />
                      <FieldError
                        id={`${validation.id('backup')}-file`}
                        error={backupError}
                      />
                    </label>
                    {
                      <p className="memo-note">
                        Después de cerrar la página los fragmentos solo están en
                        tu archivo de resguardo. Si no lo guardaste, cancela
                        esta preparación y crea otra nota.
                      </p>
                    }
                  </div>
                  <label
                    id={validation.id('ack')}
                    tabIndex={-1}
                    className="group-note-ack"
                  >
                    <input
                      id={`${validation.id('ack')}-input`}
                      type="checkbox"
                      checked={ack}
                      disabled={busy || !saved}
                      onChange={(e) => setAck(e.currentTarget.checked)}
                    />
                    <span>
                      Confirmo que guardé el resguardo completo en un lugar
                      seguro y comprobé que el archivo existe.
                    </span>
                  </label>
                  <FormFeedback issues={validation.issues} busy={busy} />
                  <Button
                    disabled={busy || !validation.valid}
                    onClick={() => {
                      if (!validation.check()) return
                      void act(async () => {
                        const updated = await confirmBackup(noteId, receipt)
                        setDetail(updated)
                        setReceipt('')
                        onChanged(updated)
                      })
                    }}
                  >
                    {busy
                      ? 'Confirmando…'
                      : 'Confirmar resguardo y compartir nota'}
                  </Button>
                </>
              )}
            {detail.note.state === 'staging' && (
              <p className="info-note">
                La carga no se completó. Si la operación sigue abierta, espera a
                que termine. Si se interrumpió, actualiza la lista y cancela
                esta preparación antes de crear otra.
              </p>
            )}
            {detail.note.state === 'ready' && (
              <>
                <DocumentMessage
                  success
                  text="Nota compartida con sus participantes originales. El archivo permanece cifrado; se requieren todos los fragmentos para recuperarlo."
                />
                <details className="flow-details">
                  <summary>Respaldo del documento cifrado (opcional)</summary>
                  <p className="memo-note">
                    La plataforma conserva este paquete. No necesitas
                    descargarlo para la recuperación colaborativa.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        downloadJson(
                          await getPackage(noteId),
                          `${detail.note.filename}.stcnote.json`,
                        ),
                      )
                    }
                  >
                    <Download size={17} />
                    Descargar paquete cifrado
                  </Button>
                </details>
                {detail.note.custody_mode === 'individual-v1' ? (
                  <>
                    <RecoveryPanel note={detail} onBusyChange={setBusy} />
                    <OwnSharePanel detail={detail} onBusyChange={setBusy} />
                  </>
                ) : (
                  <p className="memo-note">
                    Esta nota se creó con custodia manual. Su recuperación
                    conserva el resguardo original con los fragmentos.
                  </p>
                )}
              </>
            )}
            {detail.note.state === 'cancelled' && (
              <p className="memo-note">
                Esta preparación fue cancelada. Sus participantes no recibieron
                acceso al paquete.
              </p>
            )}
            {owner &&
              ['staging', 'awaiting_backup'].includes(detail.note.state) && (
                <div className="group-note-cancel">
                  {cancelConfirm ? (
                    <>
                      <p>
                        ¿Cancelar esta preparación? Ya no podrá compartirse.
                        Puedes crear una nueva con los datos correctos.
                      </p>
                      <div className="memo-actions">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => setCancelConfirm(false)}
                        >
                          Conservar preparación
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await cancelNote(noteId)
                              const updated = await getNote(noteId)
                              setDetail(updated)
                              onChanged(updated)
                            })
                          }
                        >
                          {busy ? 'Cancelando…' : 'Confirmar cancelación'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setCancelConfirm(true)}
                    >
                      Cancelar preparación
                    </Button>
                  )}
                </div>
              )}
          </>
        )}
      </div>
    </Modal>
  )
}
