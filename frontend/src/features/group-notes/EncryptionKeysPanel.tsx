import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { ApiError } from '../../lib/api'
import { useFormValidation } from '../../lib/useFormValidation'
import { passwordError, textError } from '../../lib/validation'
import { DocumentMessage } from '../documents/DocumentForms'
import { errorMessage, saveFile } from '../documents/memoranda'
import { downloadJson } from '../documents/specialNotes'
import {
  activateEncryptionKey,
  generateEncryptionKey,
  getEncryptionKeys,
  privateKeyData,
  readPrivateKey,
  retireEncryptionKey,
} from './encryptionKeys'
import type {
  EncryptionKey,
  GeneratedEncryptionKey,
  PrivateKeyFile,
} from './encryptionKeys'
import './group-notes.css'

const names = {
  pending: 'Falta activar',
  active: 'Activa',
  retired: 'Retirada',
}
export default function EncryptionKeysPanel() {
  const [keys, setKeys] = useState<EncryptionKey[]>([])
  const [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [setup, setSetup] = useState<EncryptionKey | 'new' | null>(null)
  const [retiring, setRetiring] = useState<EncryptionKey | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void getEncryptionKeys(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setKeys(result.items)
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
  }, [revision])
  return (
    <section className="group-notes-panel encryption-keys-panel">
      <div className="group-notes-heading">
        <div>
          <p className="eyebrow">CLAVES PERSONALES DE CIFRADO</p>
          <h2>Protección de expedientes y fragmentos</h2>
          <p>
            Prepárala una vez para recibir expedientes y aportar fragmentos
            de notas. Se reutiliza mientras esté vigente; no necesitas otra
            por cada archivo.
          </p>
        </div>
        <div className="memo-actions">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setRevision((n) => n + 1)
            }}
          >
            <RefreshCw size={16} />
            Actualizar claves
          </Button>
          <Button
            onClick={() => setSetup('new')}
            disabled={
              keys.filter((k) => k.state === 'pending').length >= 3 ||
              keys.length >= 100
            }
          >
            <Plus size={17} />
            Preparar clave de protección
          </Button>
        </div>
      </div>
      <div className="info-note">
        <ShieldCheck size={20} />
        <p>
          Guarda el archivo privado cifrado y su contraseña por separado. La
          plataforma conserva únicamente la clave pública. Si pierdes una
          clave privada, no podrás abrir los expedientes ni fragmentos
          protegidos con ella.
        </p>
      </div>
      {error && <DocumentMessage text={error} />}
      {notice && <DocumentMessage success text={notice} />}
      <p className="memo-note">
        Si la generación se interrumpe, actualiza la lista. Una preparación
        sin archivo privado debe retirarse; después puedes generar otra.
      </p>
      {keys.filter((k) => k.state === 'pending').length >= 3 && (
        <p className="memo-note">
          Activa o retira una preparación pendiente antes de generar otra.
        </p>
      )}
      <Card className="memo-key-directory">
        {loading ? (
          <p role="status">Consultando claves de cifrado…</p>
        ) : !keys.length ? (
          <div className="memo-empty">
            <KeyRound size={32} />
            <h3>Prepara tu clave para recibir archivos cifrados</h3>
            <p>
              Prepara tu clave privada y guarda su archivo. La activación
              comprueba una sola vez que puedes abrir la copia guardada.
            </p>
          </div>
        ) : (
          keys.map((key) => (
            <article className="memo-key" key={key.id}>
              <div>
                <h3>{key.label}</h3>
                <Badge
                  tone={
                    key.state === 'active'
                      ? 'green'
                      : key.state === 'pending'
                        ? 'amber'
                        : 'neutral'
                  }
                >
                  {names[key.state]}
                </Badge>
              </div>
              <p className="memo-note">
                RSA-OAEP · RSA-2048 · Creada el{' '}
                {new Date(key.created_at).toLocaleDateString('es-MX')}
              </p>
              <details className="flow-details">
                <summary>Huella y clave pública</summary>
                <p className="memo-fingerprint">{key.fingerprint}</p>
                <div className="memo-actions memo-actions--start">
                  <Button
                    variant="outline"
                    onClick={() =>
                      saveFile(
                        `cifrado-publica-${key.fingerprint.slice(0, 12)}.txt`,
                        key.public_base64 + '\n',
                      )
                    }
                  >
                    <Download size={16} />
                    Descargar pública de cifrado
                  </Button>
                </div>
              </details>
              <div className="memo-actions memo-actions--start">
                {key.state === 'pending' && (
                  <Button onClick={() => setSetup(key)}>
                    Activar clave de protección
                  </Button>
                )}
                {key.state !== 'retired' && (
                  <Button variant="ghost" onClick={() => setRetiring(key)}>
                    Retirar clave de protección
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </Card>
      <p className="memo-note">
        Solo una clave activa por perfil. Activar otra retira la anterior
        para expedientes y notas nuevos; conserva todos tus archivos
        privados para los anteriores. Retirarla no revoca los accesos que ya
        recibiste.
      </p>
      {setup && (
        <KeySetup
          initial={setup === 'new' ? null : setup}
          onClose={() => setSetup(null)}
          onChanged={() => setRevision((n) => n + 1)}
          onActivated={() => {
            setSetup(null)
            setNotice(
              'Clave activada. Ya puedes recibir expedientes y fragmentos nuevos.',
            )
            setRevision((n) => n + 1)
          }}
        />
      )}
      {retiring && (
        <Modal
          open
          busy={busy}
          title="Retirar clave de protección"
          onClose={() => setRetiring(null)}
        >
          <div className="memo-form">
            <p>
              ¿Retirar <strong>{retiring.label}</strong> para expedientes y
              notas nuevos?
            </p>
            <p>
              Los expedientes y fragmentos anteriores conservarán esta
              clave. Guarda su archivo privado y contraseña; generar otra no
              los reemplaza.
            </p>
            {error && <DocumentMessage text={error} />}
            <div className="memo-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRetiring(null)}
              >
                Conservar clave
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  setError('')
                  void retireEncryptionKey(retiring.id)
                    .then(() => {
                      setRetiring(null)
                      setRevision((n) => n + 1)
                      setNotice(
                        'Clave retirada para archivos nuevos. Conserva su respaldo histórico.',
                      )
                    })
                    .catch((error) => setError(errorMessage(error)))
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Retirando…' : 'Confirmar retiro'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

function KeySetup({
  initial,
  onClose,
  onChanged,
  onActivated,
}: {
  initial: EncryptionKey | null
  onClose: () => void
  onChanged: () => void
  onActivated: () => void
}) {
  const [generated, setGenerated] = useState<GeneratedEncryptionKey | null>(
    null,
  )
  const key = generated?.key ?? initial
  const [label, setLabel] = useState('Mi clave de cifrado'),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('')
  const [privateFile, setPrivateFile] = useState<PrivateKeyFile | null>(
      null,
    ),
    [privateFilename, setPrivateFilename] = useState(''),
    [fileError, setFileError] = useState('')
  const [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState('')
  const [passwordIssue, setPasswordIssue] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const validation = useFormValidation({
    label: key
      ? ''
      : textError(label, 'un nombre para tu clave de cifrado', 80),
    password: passwordIssue || passwordError(password),
    confirmation: key
      ? ''
      : !confirmation
        ? 'Confirma la contraseña.'
        : confirmation !== password
          ? 'Las contraseñas no coinciden.'
          : '',
    file: key
      ? fileError ||
        (!privateFile
          ? 'Selecciona el archivo privado de esta clave de cifrado.'
          : '')
      : '',
    backup:
      generated && !downloaded
        ? 'Descarga y guarda tu clave privada antes de activarla.'
        : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || reading || !validation.check()) return
    setBusy(true)
    setError('')
    try {
      if (!key) {
        const result = await generateEncryptionKey(label, password)
        setGenerated(result)
        setPassword('')
        setConfirmation('')
        onChanged()
      } else if (privateFile) {
        await activateEncryptionKey(
          key.id,
          privateFile.private_base64,
          password,
        )
        setPassword('')
        setPrivateFile(null)
        onActivated()
      }
    } catch (error) {
      setError(errorMessage(error))
      if (
        error instanceof ApiError &&
        error.code === 'invalid_encryption_private_key'
      )
        setPasswordIssue(
          'Comprueba la contraseña y el archivo privado seleccionado.',
        )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy || reading}
      title={
        key
          ? 'Guardar y activar clave de protección'
          : 'Preparar clave de protección'
      }
      onClose={onClose}
    >
      <form
        className="memo-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-busy={busy || reading}
      >
        {!key ? (
          <>
            <p>
              Esta clave se utiliza para abrir expedientes y fragmentos de
              notas especiales. Es independiente de tus claves de firma.
            </p>
            <TextField
              {...validation.field('label')}
              label="Nombre de la clave de protección"
              maxLength={80}
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
            />
            <TextField
              {...validation.field('password')}
              error={passwordIssue || validation.field('password').error}
              label="Contraseña de la clave privada"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={busy}
              onChange={(e) => {
                setPassword(e.target.value)
                setPasswordIssue('')
              }}
            />
            <TextField
              {...validation.field('confirmation')}
              label="Confirmar contraseña"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              disabled={busy}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </>
        ) : (
          <>
            <p>
              Clave: <strong>{key.label}</strong>
            </p>
            <p className="memo-fingerprint">{key.fingerprint}</p>
            {generated && (
              <div
                id={validation.id('backup')}
                tabIndex={-1}
                className="validation-target"
              >
                <Button
                  variant="outline"
                  disabled={busy || reading}
                  onClick={() => {
                    downloadJson(
                      privateKeyData(generated),
                      `${key.id}.stckey.json`,
                    )
                    setDownloaded(true)
                  }}
                >
                  <Download size={17} />
                  Guardar mi clave privada
                </Button>
                <p className="memo-note">
                  Comprueba que el archivo existe y selecciónalo abajo. La
                  privada cifrada solo se entrega en esta generación.
                </p>
              </div>
            )}
            <label className="field">
              <span className="field-label">
                Mi clave privada (.stckey.json)
              </span>
              <input
                id={validation.id('file')}
                type="file"
                accept=".json,application/json"
                disabled={busy || reading}
                aria-invalid={Boolean(
                  fileError || validation.field('file').error,
                )}
                aria-describedby={`${validation.id('file')}-error`}
                onBlur={validation.field('file').onBlur}
                onChange={(e) => {
                  const input = e.currentTarget
                  const file = input.files?.[0]
                  setPrivateFile(null)
                  setPrivateFilename('')
                  setFileError('')
                  setPasswordIssue('')
                  setError('')
                  if (!file) return
                  setReading(true)
                  void readPrivateKey(file, {
                    profile_id: key.profile_id,
                    id: key.id,
                    fingerprint: key.fingerprint,
                  })
                    .then((value) => {
                      setPrivateFile(value)
                      setPrivateFilename(file.name)
                    })
                    .catch((error) => {
                      input.value = ''
                      setFileError(errorMessage(error))
                    })
                    .finally(() => setReading(false))
                }}
              />
              <FieldError
                id={validation.id('file')}
                error={fileError || validation.field('file').error}
              />
            </label>
            {privateFile && (
              <p className="memo-note selected-key-file" role="status">
                Archivo seleccionado: <strong>{privateFilename}</strong>.
                Falta comprobar la contraseña.
              </p>
            )}
            <TextField
              {...validation.field('password')}
              error={passwordIssue || validation.field('password').error}
              label="Contraseña de la clave privada"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy || reading}
              onChange={(e) => {
                setPassword(e.target.value)
                setPasswordIssue('')
              }}
            />
            <p className="info-note">
              Activar comprueba que puedes abrir el archivo. Si tienes otra
              clave activa, se retirará para archivos nuevos; conserva
              también su respaldo.
            </p>
          </>
        )}
        <FormFeedback issues={validation.issues} busy={busy || reading} />
        {error && <DocumentMessage text={error} />}
        <div className="memo-actions">
          <Button
            variant="outline"
            disabled={busy || reading}
            onClick={onClose}
          >
            {key ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button
            type="submit"
            disabled={busy || reading || !validation.valid}
          >
            {busy
              ? 'Procesando…'
              : key
                ? 'Comprobar archivo y activar'
                : 'Preparar clave de protección'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
