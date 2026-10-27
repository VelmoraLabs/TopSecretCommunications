import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileLock2,
  Info,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Upload,
  UsersRound,
} from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import TextField from '../../components/ui/TextField'
import { Button } from '../../components/ui/Button'
import {
  downloadJson,
  downloadRecovered,
  downloadShare,
  formatBytes,
  MAX_PARTICIPANTS,
  protectNote,
  readPackage,
  readShares,
  recoverNote,
  shareIndex,
} from '../../features/documents/specialNotes'
import type {
  NotePackage,
  ProtectionResult,
  RecoveryResult,
} from '../../features/documents/specialNotes'
import './special-notes.css'
import { useAuth } from '../../features/auth/auth'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import { documentFileError } from '../../lib/validation'
import { recoverySharesError } from '../../features/documents/specialNotes'
import { ApiError } from '../../lib/api'
import GroupNotesPanel from '../../features/group-notes/GroupNotesPanel'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.'

export default function SpecialNotesPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const [manual, setManual] = useState(false)
  const canProtect = auth.hasPermission('documents.create')
  const [tab, setTab] = useState<'group' | 'protect' | 'recover'>('group')
  const [file, setFile] = useState<File | null>(null)
  const [count, setCount] = useState(4)
  const [protectedNote, setProtectedNote] = useState<ProtectionResult | null>(
    null,
  )
  const [note, setNote] = useState<NotePackage | null>(null)
  const [shares, setShares] = useState<string[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [recovered, setRecovered] = useState<RecoveryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recoveryHeading = useRef<HTMLHeadingElement>(null)

  const [packageError, setPackageError] = useState('')
  const [sharesError, setSharesError] = useState('')
  const protection = useFormValidation({
    file: documentFileError(file),
    count:
      !Number.isInteger(count) || count < 2 || count > MAX_PARTICIPANTS
        ? 'Elige un número entero entre 2 y 20 participantes.'
        : '',
  })
  const recovery = useFormValidation({
    package:
      packageError ||
      (!note ? 'Carga el paquete cifrado (.stcnote.json).' : ''),
    shares:
      sharesError ||
      (shares.length === 0
        ? 'Carga los archivos de fragmento (.json).'
        : recoverySharesError(
            note,
            selected.map((i) => shares[i]),
          )),
  })
  function switchTab(next: 'group' | 'protect' | 'recover') {
    setTab(next)
    setError('')
  }
  async function protect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !protection.check() || !file) return
    setBusy(true)
    setError('')
    setProtectedNote(null)
    try {
      setProtectedNote(await protectNote(file, count))
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  function useGenerated() {
    if (!protectedNote) return
    setPackageError('')
    setSharesError('')
    setNote(protectedNote.package)
    setShares(protectedNote.shares)
    setSelected(protectedNote.shares.map((_, i) => i))
    setRecovered(null)
    switchTab('recover')
    window.setTimeout(() => recoveryHeading.current?.focus(), 0)
  }
  async function importPackage(file: File) {
    if (busy) return
    setPackageError('')
    setBusy(true)
    setError('')
    setRecovered(null)
    setNote(null)
    try {
      setNote(await readPackage(file))
    } catch (error) {
      setPackageError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function importShares(files: File[]) {
    if (busy) return
    setSharesError('')
    setBusy(true)
    setError('')
    setRecovered(null)
    setShares([])
    setSelected([])
    try {
      const values = await readShares(files)
      setShares(values)
      setSelected(values.map((_, i) => i))
    } catch (error) {
      setSharesError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  function toggle(index: number) {
    setRecovered(null)
    setError('')
    setSelected((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index],
    )
  }
  async function recover() {
    if (busy || !recovery.check() || !note) return
    setBusy(true)
    setError('')
    setRecovered(null)
    try {
      setRecovered(
        await recoverNote(
          note,
          selected.map((i) => shares[i]),
        ),
      )
    } catch (error) {
      const text = errorMessage(error)
      if (
        error instanceof ApiError &&
        [
          'invalid_shares',
          'incompatible_shares',
          'insufficient_shares',
        ].includes(error.code)
      )
        setSharesError(text)
      else if (
        error instanceof ApiError &&
        ['invalid_package', 'invalid_base64'].includes(error.code)
      )
        setPackageError(text)
      else setError(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PROTECCIÓN CONJUNTA"
        title="Notas especiales"
        description="Protege un archivo y recupera su acceso reuniendo los fragmentos necesarios."
        action={
          <Badge tone="purple">
            {tab === 'group' ? 'Archivo de grupo' : 'Flujo portable'}
          </Badge>
        }
      />
      <section className="notes-intro">
        <div className="notes-intro-icon">
          <UsersRound size={31} />
        </div>
        <div>
          <p className="eyebrow">CADA PARTICIPACIÓN CUENTA</p>
          <h2>Un documento. Una clave compartida.</h2>
          <p>
            El archivo se cifra y su clave se divide con Shamir. Los fragmentos
            permiten reconstruirla al reunir el umbral.
          </p>
        </div>
        <span className="notes-intro-tag">
          <ShieldCheck size={17} /> AES-GCM + Shamir
        </span>
      </section>
      <div
        className="notes-tabs"
        role="group"
        aria-label="Operación de nota especial"
      >
        <button
          type="button"
          aria-pressed={tab === 'group'}
          disabled={busy}
          onClick={() => switchTab('group')}
        >
          <UsersRound size={18} />
          Notas del grupo
        </button>
        {(manual || tab !== 'group') && (
          <>
            <button
              type="button"
              aria-pressed={tab === 'protect'}
              disabled={busy || !canProtect}
              onClick={() => switchTab('protect')}
            >
              <FileLock2 size={18} /> Proteger archivo manual
            </button>
            <button
              type="button"
              aria-pressed={tab === 'recover'}
              disabled={busy}
              onClick={() => switchTab('recover')}
            >
              <KeyRound size={18} /> Recuperar archivo manual
            </button>
          </>
        )}
      </div>
      {tab === 'group' && (
        <details
          className="flow-details"
          onToggle={(e) => setManual(e.currentTarget.open)}
        >
          <summary>Herramientas manuales y compatibilidad</summary>
          <p>
            Úsalas solo para paquetes y fragmentos portables. Las notas de grupo
            se recuperan desde su propio detalle.
          </p>
        </details>
      )}
      {params.has('nota') || tab === 'group' ? (
        <GroupNotesPanel
          onRecover={(backup) => {
            setNote(backup.package)
            setShares(backup.shares)
            setSelected(backup.shares.map((_, index) => index))
            setRecovered(null)
            setPackageError('')
            setSharesError('')
            switchTab('recover')
            window.setTimeout(() => recoveryHeading.current?.focus(), 0)
          }}
        />
      ) : (
        <div className="notes-columns" aria-busy={busy}>
          <div className="notes-main">
            {tab === 'protect' && canProtect ? (
              <>
                <Card className="notes-form-card">
                  <div className="notes-section-heading">
                    <span>01</span>
                    <div>
                      <h2>Preparar la protección</h2>
                      <p>
                        Elige el archivo y define el número de fragmentos del
                        grupo.
                      </p>
                    </div>
                  </div>
                  <form
                    noValidate
                    aria-busy={busy}
                    onSubmit={protect}
                    className="notes-form"
                  >
                    <label className="notes-upload">
                      <Upload size={27} />
                      <strong>
                        {file ? file.name : 'Selecciona tu archivo'}
                      </strong>
                      <span>
                        {file
                          ? formatBytes(file.size)
                          : 'PDF, texto, imágenes u otro archivo · hasta 5 MiB'}
                      </span>
                      <input
                        type="file"
                        required={!file}
                        disabled={busy}
                        id={protection.id('file')}
                        aria-invalid={Boolean(
                          (file && documentFileError(file)) ||
                          protection.field('file').error,
                        )}
                        aria-describedby={`${protection.id('file')}-error`}
                        onBlur={protection.field('file').onBlur}
                        aria-label="Archivo que deseas proteger"
                        onChange={(event) => {
                          const next = event.target.files?.[0] ?? null
                          setProtectedNote(null)
                          setError('')
                          setFile(next)
                        }}
                      />
                    </label>
                    <FieldError
                      id={protection.id('file')}
                      error={
                        (file && documentFileError(file)) ||
                        protection.field('file').error
                      }
                    />
                    <div className="notes-policy">
                      <TextField
                        {...protection.field('count')}
                        label="Número de participantes"
                        type="number"
                        min={2}
                        max={MAX_PARTICIPANTS}
                        required
                        disabled={busy}
                        value={count}
                        onChange={(event) => {
                          setCount(Number(event.target.value))
                          setProtectedNote(null)
                        }}
                        hint="Entre 2 y 20 fragmentos, uno por participación."
                      />
                      <div className="notes-policy-info">
                        <ShieldCheck size={20} />
                        <div>
                          <strong>Participación de todo el grupo</strong>
                          <p>
                            Esta nota requiere {count} de {count} fragmentos
                            para reconstruir su clave.
                          </p>
                        </div>
                      </div>
                    </div>
                    <FormFeedback issues={protection.issues} busy={busy} />
                    <div className="notes-form-footer">
                      <Badge tone="purple">
                        {count} de {count} requeridos
                      </Badge>
                      <Button
                        type="submit"
                        disabled={busy || !protection.valid}
                      >
                        {busy ? (
                          <LoaderCircle className="notes-spinner" size={18} />
                        ) : (
                          <ShieldCheck size={18} />
                        )}
                        {busy ? 'Protegiendo…' : 'Proteger y dividir clave'}
                      </Button>
                    </div>
                  </form>
                </Card>
                {protectedNote && (
                  <Card className="notes-result">
                    <div className="notes-success-heading">
                      <CheckCircle2 size={23} />
                      <div>
                        <h2>Archivo protegido</h2>
                        <p>
                          {protectedNote.package.filename} ·{' '}
                          {formatBytes(protectedNote.package.size)}
                        </p>
                      </div>
                    </div>
                    <p>
                      Guarda el paquete cifrado y descarga los fragmentos por
                      separado. Necesitarás {protectedNote.package.threshold} de{' '}
                      {protectedNote.package.share_count} para recuperarlo.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        downloadJson(
                          protectedNote.package,
                          protectedNote.package.filename + '.stcnote.json',
                        )
                      }
                    >
                      <Download size={17} /> Descargar paquete cifrado
                    </Button>
                    <div className="notes-share-grid">
                      {protectedNote.shares.map((share, i) => (
                        <div className="notes-share" key={i}>
                          <span className="notes-share-icon">
                            <KeyRound size={19} />
                          </span>
                          <strong>Fragmento {i + 1}</strong>
                          <span>Participación {i + 1}</span>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              downloadShare(
                                share,
                                protectedNote.package.document_id +
                                  '.fragmento-' +
                                  (i + 1) +
                                  '.json',
                              )
                            }
                          >
                            <Download size={15} /> Descargar
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button onClick={useGenerated}>
                      Preparar recuperación <ArrowRight size={17} />
                    </Button>
                  </Card>
                )}
              </>
            ) : (
              <Card className="notes-form-card">
                <div className="notes-section-heading">
                  <span>02</span>
                  <div>
                    <h2 ref={recoveryHeading} tabIndex={-1}>
                      Reunir y recuperar
                    </h2>
                    <p>
                      Carga el paquete cifrado y aporta los fragmentos de la
                      misma nota.
                    </p>
                  </div>
                </div>
                <div className="notes-form">
                  <div className="notes-import-fields">
                    <label className="notes-file-field">
                      <span>Paquete cifrado (.stcnote.json)</span>
                      <input
                        type="file"
                        id={recovery.id('package')}
                        onBlur={recovery.field('package').onBlur}
                        aria-invalid={Boolean(
                          packageError || recovery.field('package').error,
                        )}
                        aria-describedby={`${recovery.id('package')}-error`}
                        accept=".json"
                        disabled={busy}
                        onChange={(event) => {
                          const chosen = event.target.files?.[0]
                          if (chosen) void importPackage(chosen)
                          event.target.value = ''
                        }}
                      />
                      <FieldError
                        id={recovery.id('package')}
                        error={packageError || recovery.field('package').error}
                      />
                    </label>
                    <label className="notes-file-field">
                      <span>Fragmentos (.json)</span>
                      <input
                        type="file"
                        accept=".json"
                        id={recovery.id('shares')}
                        onBlur={recovery.field('shares').onBlur}
                        aria-invalid={Boolean(
                          sharesError || recovery.field('shares').error,
                        )}
                        aria-describedby={`${recovery.id('shares')}-error`}
                        multiple
                        disabled={busy}
                        onChange={(event) => {
                          const chosen = Array.from(event.target.files ?? [])
                          if (chosen.length) void importShares(chosen)
                          event.target.value = ''
                        }}
                      />
                      <FieldError
                        id={recovery.id('shares')}
                        error={sharesError || recovery.field('shares').error}
                      />
                    </label>
                  </div>
                  {note ? (
                    <div className="notes-loaded">
                      <FileLock2 size={24} />
                      <div>
                        <strong>{note.filename}</strong>
                        <span>
                          Paquete cargado · autenticidad pendiente de verificar
                        </span>
                      </div>
                      <Badge tone="purple">
                        {note.threshold} de {note.share_count}
                      </Badge>
                    </div>
                  ) : (
                    <p className="notes-muted">
                      También puedes utilizar el paquete que acabas de generar
                      con “Preparar recuperación”.
                    </p>
                  )}
                  {shares.length > 0 && (
                    <fieldset className="notes-fragment-list">
                      <legend>Fragmentos que se aportarán</legend>
                      {shares.map((_, index) => (
                        <label className="notes-fragment-option" key={index}>
                          <input
                            type="checkbox"
                            checked={selected.includes(index)}
                            disabled={busy}
                            onChange={() => toggle(index)}
                          />
                          <KeyRound size={17} />
                          <span>Fragmento {shareIndex(shares[index])}</span>
                          <small>
                            {selected.includes(index)
                              ? 'Aportado'
                              : 'Sin aportar'}
                          </small>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <FormFeedback issues={recovery.issues} busy={busy} />
                  <div className="notes-form-footer">
                    <span className="notes-count">
                      {selected.length} fragmentos seleccionados
                    </span>
                    <Button
                      disabled={busy || !recovery.valid}
                      onClick={() => void recover()}
                    >
                      {busy ? (
                        <LoaderCircle className="notes-spinner" size={18} />
                      ) : (
                        <KeyRound size={18} />
                      )}
                      {busy ? 'Verificando…' : 'Reconstruir y recuperar'}
                    </Button>
                  </div>
                  {recovered && (
                    <div className="notes-recovered" role="status">
                      <CheckCircle2 size={27} />
                      <div>
                        <strong>
                          Archivo recuperado e integridad verificada
                        </strong>
                        <p>
                          {recovered.filename} · {formatBytes(recovered.size)}
                        </p>
                        <Button onClick={() => downloadRecovered(recovered)}>
                          <Download size={17} /> Descargar archivo original
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}
            {error && (
              <div className="notes-error" role="alert">
                <Info size={21} />
                <span>{error}</span>
              </div>
            )}
          </div>
          <aside className="notes-aside">
            <Card className="notes-help">
              <span className="notes-help-icon">
                <ShieldCheck size={25} />
              </span>
              <h2>La clave está en la participación.</h2>
              <ol>
                <li>
                  <strong>Cifrar</strong>
                  <span>AES-GCM protege el contenido del archivo.</span>
                </li>
                <li>
                  <strong>Dividir</strong>
                  <span>Shamir genera los fragmentos de su clave.</span>
                </li>
                <li>
                  <strong>Reunir</strong>
                  <span>El umbral permite reconstruir la clave.</span>
                </li>
                <li>
                  <strong>Verificar</strong>
                  <span>
                    La integridad se comprueba antes de recuperar el archivo.
                  </span>
                </li>
              </ol>
            </Card>
            <div className="notes-local-note">
              <Info size={19} />
              <p>
                Flujo portable con archivos reales y sesión autenticada.
                Conserva tus descargas: los resultados se mantienen mientras
                esta página está abierta. La entrega individual de fragmentos y
                la recuperación conjunta entre cuentas se incorporarán en la
                siguiente etapa. Las notas de grupo ya permiten guardar el
                paquete cifrado y conservar sus participantes originales.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
