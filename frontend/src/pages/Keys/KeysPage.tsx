import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Download,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import EncryptionKeysPanel from '../../features/group-notes/EncryptionKeysPanel'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import TextField from '../../components/ui/TextField'
import { useAuth } from '../../features/auth/auth'
import { DocumentMessage } from '../../features/documents/DocumentForms'
import {
  errorMessage,
  generateKey,
  getKeys,
  retireKey,
  saveFile,
} from '../../features/documents/memoranda'
import type {
  GeneratedKey,
  SigningKey,
} from '../../features/documents/memoranda'
import FormFeedback from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import {
  filenameError,
  passwordError,
  textError,
} from '../../lib/validation'
import '../../features/documents/memoranda.css'

export default function KeysPage() {
  const auth = useAuth(),
    [keys, setKeys] = useState<SigningKey[]>([])
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [creating, setCreating] = useState(false),
    [retiring, setRetiring] = useState<SigningKey | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void getKeys(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setKeys(page.items)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  async function retire() {
    if (!retiring) return
    setBusy(true)
    setError('')
    try {
      await retireKey(retiring.id)
      setRetiring(null)
      setRevision((n) => n + 1)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CLAVES PERSONALES"
        title="Mis claves"
        description="Prepara tus claves personales una vez y utilízalas según la operación."
        action={
          auth.hasPermission('documents.sign') && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              Generar claves de firma
            </Button>
          )
        }
      />
      <div className="key-purpose-grid">
        <div>
          <strong>Abrir mis archivos cifrados</strong>
          <p>
            Tu par RSA-OAEP permite recuperar la clave de tus expedientes y
            abrir tus fragmentos de notas especiales.
          </p>
        </div>
        <div>
          <strong>Firmar documentos</strong>
          <p>
            Tu par RSA-PSS identifica las firmas que realizas. Los
            destinatarios las verifican con la pública registrada.
          </p>
        </div>
        <div>
          <strong>Cifrar cada documento</strong>
          <p>
            La aplicación genera una clave AES nueva por archivo. En los
            expedientes la protege para cada destinatario con RSA-OAEP; en
            las notas especiales la divide con Shamir.
          </p>
        </div>
      </div>
      <EncryptionKeysPanel />
      <section className="memo-intro">
        <span>
          <KeyRound size={29} />
        </span>
        <div>
          <p className="eyebrow">TU FIRMA, BAJO TU CUSTODIA</p>
          <h2>Una identidad verificable.</h2>
          <p>
            La clave pública identifica tus firmas. La privada se descarga
            cifrada y permanece bajo tu custodia.
          </p>
        </div>
      </section>
      {!auth.hasPermission('documents.sign') && (
        <p className="memo-note">
          Tu rol actual permite consultar tus claves anteriores, pero no
          generar nuevas claves de firma.
        </p>
      )}
      {error && <DocumentMessage text={error} />}
      <Card className="memo-key-directory">
        {loading ? (
          <p className="memo-loading">
            <LoaderCircle className="access-spinner" size={18} />
            Consultando claves…
          </p>
        ) : keys.length === 0 ? (
          <div className="memo-empty">
            <KeyRound size={35} />
            <h2>Todavía no tienes claves registradas</h2>
            <p>
              Cuando tengas permiso de firma, genera un par para comenzar.
            </p>
          </div>
        ) : (
          keys.map((key) => (
            <article className="memo-key" key={key.id}>
              <div>
                <h3>{key.label}</h3>
                <Badge tone={key.is_active ? 'green' : 'neutral'}>
                  {key.is_active ? 'Activa' : 'Retirada'}
                </Badge>
              </div>
              <p className="memo-note">
                RSA-2048 · SHA-256 · Creada el{' '}
                {new Date(key.created_at).toLocaleDateString('es-MX')}
              </p>
              <details className="flow-details">
                <summary>Huella y clave pública de firma</summary>
                <p className="memo-fingerprint">{key.fingerprint}</p>
                <div className="memo-actions memo-actions--start">
                  <Button
                    variant="outline"
                    onClick={() =>
                      saveFile(
                        `clave-publica-${key.fingerprint.slice(0, 12)}.txt`,
                        key.public_base64 + '\n',
                      )
                    }
                  >
                    <Download size={16} />
                    Descargar pública
                  </Button>
                </div>
              </details>
              <div className="memo-actions memo-actions--start">
                {key.is_active && (
                  <Button variant="ghost" onClick={() => setRetiring(key)}>
                    Retirar clave
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </Card>
      <p className="memo-note">
        <ShieldCheck size={18} />
        Retirar una clave impide nuevas firmas con ella. Las firmas
        anteriores conservan su clave pública y pueden seguir verificándose.
      </p>
      {creating && (
        <KeyForm
          onClose={() => setCreating(false)}
          onCreated={() => setRevision((n) => n + 1)}
        />
      )}
      {retiring && (
        <Modal
          open
          busy={busy}
          title="Retirar clave de firma"
          onClose={() => {
            if (!busy) setRetiring(null)
          }}
        >
          <p>
            ¿Quieres retirar <strong>{retiring.label}</strong> para nuevas
            firmas?
          </p>
          <p className="memo-note">
            Las firmas ya registradas y su clave pública se conservarán.
          </p>
          <div className="memo-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRetiring(null)}
            >
              Cancelar
            </Button>
            <Button disabled={busy} onClick={() => void retire()}>
              {busy ? 'Retirando…' : 'Retirar clave'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function KeyForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [label, setLabel] = useState('Mi clave de firma'),
    [privateName, setPrivateName] = useState('clave-privada.txt'),
    [publicName, setPublicName] = useState('clave-publica.txt')
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [generated, setGenerated] = useState<GeneratedKey | null>(null)
  const validation = useFormValidation({
    label: textError(label, 'un nombre para identificar la clave', 80),
    privateName: filenameError(privateName),
    publicName:
      filenameError(publicName) ||
      (privateName.trim().toLocaleLowerCase() ===
      publicName.trim().toLocaleLowerCase()
        ? 'Usa nombres distintos para los archivos público y privado.'
        : ''),
    password: passwordError(password),
    confirmation: !confirmation
      ? 'Confirma la contraseña de la clave privada.'
      : confirmation !== password
        ? 'Las contraseñas no coinciden. Vuelve a escribir la confirmación.'
        : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !validation.check()) return
    setBusy(true)
    setError('')
    try {
      if (password !== confirmation)
        throw new Error('Las contraseñas no coinciden.')
      const result = await generateKey({
        label: label.trim(),
        password,
        private_filename: privateName.trim(),
        public_filename: publicName.trim(),
      })
      setPassword('')
      setConfirmation('')
      setGenerated(result)
      onCreated()
    } catch (error) {
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
        generated ? 'Guarda tus claves de firma' : 'Generar claves RSA-PSS'
      }
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {generated ? (
        <div className="memo-form">
          <DocumentMessage
            success
            text="Tu clave pública quedó vinculada a tu perfil."
          />
          <p className="memo-note">
            Guarda tu clave privada cifrada: la necesitarás para firmar. La
            pública ya está registrada y su descarga es opcional. La
            plataforma no conserva la privada ni su contraseña.
          </p>
          <div className="memo-key-downloads">
            <Button
              onClick={() =>
                saveFile(
                  generated.private_filename,
                  generated.private_base64 + '\n',
                )
              }
            >
              <Download size={17} />
              Descargar privada cifrada
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                saveFile(
                  generated.public_filename,
                  generated.key.public_base64 + '\n',
                )
              }
            >
              <Download size={17} />
              Descargar pública
            </Button>
          </div>
          <p className="memo-fingerprint">{generated.key.fingerprint}</p>
          <div className="memo-actions">
            <Button onClick={onClose}>Terminar</Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          aria-busy={busy}
          className="memo-form"
          onSubmit={(event) => void submit(event)}
        >
          <TextField
            {...validation.field('label')}
            label="Nombre para identificar la clave"
            value={label}
            required
            maxLength={80}
            disabled={busy}
            onChange={(event) => setLabel(event.target.value)}
          />
          <details className="flow-details">
            <summary>Personalizar nombres de archivos (opcional)</summary>
            <TextField
              {...validation.field('privateName')}
              label="Nombre del archivo privado"
              value={privateName}
              required
              maxLength={180}
              disabled={busy}
              onChange={(event) => setPrivateName(event.target.value)}
            />
            <TextField
              {...validation.field('publicName')}
              label="Nombre del archivo público"
              value={publicName}
              required
              maxLength={180}
              disabled={busy}
              onChange={(event) => setPublicName(event.target.value)}
            />
          </details>
          <TextField
            {...validation.field('password')}
            label="Contraseña de la clave privada"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            hint="Usa al menos 12 caracteres. La necesitarás para firmar."
          />
          <TextField
            {...validation.field('confirmation')}
            label="Confirmar contraseña"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <FormFeedback issues={validation.issues} busy={busy} />
          {error && <DocumentMessage text={error} />}
          <div className="memo-actions">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !validation.valid}>
              {busy ? 'Generando claves…' : 'Generar y preparar descarga'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
