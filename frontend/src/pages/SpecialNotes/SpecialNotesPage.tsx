import { useRef, useState } from 'react'
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
  MAX_FILE_SIZE,
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.'

export default function SpecialNotesPage() {
  const auth = useAuth()
  const canProtect = auth.hasPermission('documents.create')
  const [tab, setTab] = useState<'protect' | 'recover'>(
    canProtect ? 'protect' : 'recover',
  )
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

  function switchTab(next: 'protect' | 'recover') {
    setTab(next)
    setError('')
  }
  async function protect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
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
    setNote(protectedNote.package)
    setShares(protectedNote.shares)
    setSelected(protectedNote.shares.map((_, i) => i))
    setRecovered(null)
    switchTab('recover')
    window.setTimeout(() => recoveryHeading.current?.focus(), 0)
  }
  async function importPackage(file: File) {
    setBusy(true)
    setError('')
    setRecovered(null)
    setNote(null)
    try {
      setNote(await readPackage(file))
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function importShares(files: File[]) {
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
      setError(errorMessage(error))
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
    if (!note) return
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
      setError(errorMessage(error))
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
        action={<Badge tone="purple">Flujo portable</Badge>}
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
          aria-pressed={tab === 'protect'}
          disabled={busy || !canProtect}
          onClick={() => switchTab('protect')}
        >
          <FileLock2 size={18} /> Proteger archivo
        </button>
        <button
          type="button"
          aria-pressed={tab === 'recover'}
          disabled={busy}
          onClick={() => switchTab('recover')}
        >
          <KeyRound size={18} /> Recuperar archivo
        </button>
      </div>
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
                <form onSubmit={protect} className="notes-form">
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
                      aria-label="Archivo que deseas proteger"
                      onChange={(event) => {
                        const next = event.target.files?.[0] ?? null
                        setProtectedNote(null)
                        setError('')
                        if (next && next.size > MAX_FILE_SIZE) {
                          setFile(null)
                          setError('El archivo supera el límite de 5 MiB.')
                          event.target.value = ''
                        } else setFile(next)
                      }}
                    />
                  </label>
                  <div className="notes-policy">
                    <TextField
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
                          Esta nota requiere {count} de {count} fragmentos para
                          reconstruir su clave.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="notes-form-footer">
                    <Badge tone="purple">
                      {count} de {count} requeridos
                    </Badge>
                    <Button type="submit" disabled={busy || !file}>
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
                    Carga el paquete cifrado y aporta los fragmentos de la misma
                    nota.
                  </p>
                </div>
              </div>
              <div className="notes-form">
                <div className="notes-import-fields">
                  <label className="notes-file-field">
                    <span>Paquete cifrado (.stcnote.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      disabled={busy}
                      onChange={(event) => {
                        const chosen = event.target.files?.[0]
                        if (chosen) void importPackage(chosen)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <label className="notes-file-field">
                    <span>Fragmentos (.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      multiple
                      disabled={busy}
                      onChange={(event) => {
                        const chosen = Array.from(event.target.files ?? [])
                        if (chosen.length) void importShares(chosen)
                        event.target.value = ''
                      }}
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
                    También puedes utilizar el paquete que acabas de generar con
                    “Preparar recuperación”.
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
                <div className="notes-form-footer">
                  <span className="notes-count">
                    {selected.length} fragmentos seleccionados
                  </span>
                  <Button
                    disabled={busy || !note || selected.length === 0}
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
              Flujo portable con archivos reales y sesión autenticada. Conserva
              tus descargas: los resultados se mantienen mientras esta página
              está abierta. La entrega individual de fragmentos y la
              recuperación conjunta entre usuarios se incorporarán con los
              grupos.
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}
