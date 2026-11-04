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
import {
  signingPrivateFilename,
  signingPrivateKeyData,
} from '../../features/documents/signingKeys'
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
        eyebrow="LLAVES PERSONALES"
        title="Mis llaves"
        description="Prepara tus llaves personales una vez y utilízalas según la operación."
        action={
          auth.hasPermission('documents.sign') && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              Generar llaves de firma
            </Button>
          )
        }
      />
      <div className="key-purpose-grid">
        <div>
          <strong>Abrir mis archivos cifrados</strong>
          <p>
            Tu par RSA-OAEP permite abrir tus expedientes, notas
            diplomáticas y comunicados, además de tus fragmentos de notas
            especiales.
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
            La aplicación genera una llave AES nueva por archivo. En
            expedientes, notas y comunicados la protege para cada
            destinatario con RSA-OAEP; en las notas especiales la divide con
            Shamir.
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
            La llave pública identifica tus firmas. La privada se descarga
            cifrada y permanece bajo tu custodia.
          </p>
        </div>
      </section>
      {!auth.hasPermission('documents.sign') && (
        <p className="memo-note">
          Tu rol actual permite consultar tus llaves anteriores, pero no
          generar nuevas llaves de firma.
        </p>
      )}
      {error && <DocumentMessage text={error} />}
      <Card className="memo-key-directory">
        {loading ? (
          <p className="memo-loading">
            <LoaderCircle className="access-spinner" size={18} />
            Consultando llaves…
          </p>
        ) : keys.length === 0 ? (
          <div className="memo-empty">
            <KeyRound size={35} />
            <h2>Todavía no tienes llaves registradas</h2>
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
                <summary>Huella y llave pública de firma</summary>
                <p className="memo-fingerprint">{key.fingerprint}</p>
                <div className="memo-actions memo-actions--start">
                  <Button
                    variant="outline"
                    onClick={() =>
                      saveFile(
                        `llave-publica-${key.fingerprint.slice(0, 12)}.txt`,
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
                    Retirar llave
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </Card>
      <p className="memo-note">
        <ShieldCheck size={18} />
        Retirar una llave impide nuevas firmas con ella. Las firmas
        anteriores conservan su llave pública y pueden seguir verificándose.
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
          title="Retirar llave de firma"
          onClose={() => {
            if (!busy) setRetiring(null)
          }}
        >
          <p>
            ¿Quieres retirar <strong>{retiring.label}</strong> para nuevas
            firmas?
          </p>
          <p className="memo-note">
            Las firmas ya registradas y su llave pública se conservarán.
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
              {busy ? 'Retirando…' : 'Retirar llave'}
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
  const auth = useAuth()
  const [label, setLabel] = useState('Mi llave de firma'),
    [publicName, setPublicName] = useState('llave-publica.txt')
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [generated, setGenerated] = useState<GeneratedKey | null>(null)
  const validation = useFormValidation({
    label: textError(label, 'un nombre para identificar la llave', 80),
    publicName:
      filenameError(publicName) ||
      (publicName.trim().toLocaleLowerCase() === 'llave-firma.stckey.json'
        ? 'Usa nombres distintos para los archivos público y privado.'
        : ''),
    password: passwordError(password),
    confirmation: !confirmation
      ? 'Confirma la contraseña de la llave privada.'
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
        // La API solicita un nombre antes de generar el ID. La descarga usa el ID devuelto.
        private_filename: 'llave-firma.stckey.json',
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
        generated ? 'Guarda tus llaves de firma' : 'Generar llaves RSA-PSS'
      }
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {generated ? (
        <div className="memo-form">
          <DocumentMessage
            success
            text="Tu llave pública quedó vinculada a tu perfil."
          />
          <p className="memo-note">
            Guarda tu respaldo JSON de firma: contiene tu llave privada
            cifrada y los identificadores de tu perfil y llave. La
            pública ya está registrada y su descarga es opcional. La
            plataforma no conserva la privada ni su contraseña.
          </p>
          <div className="memo-key-downloads">
            <Button
              onClick={() =>
                saveFile(
                  signingPrivateFilename(generated.key.id),
                  JSON.stringify(
                    signingPrivateKeyData(generated, auth.access!.profile.id),
                    null,
                    2,
                  ) + '\n',
                  'application/json',
                )
              }
            >
              <Download size={17} />
              Descargar privada cifrada (.stckey.json)
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
            label="Nombre para identificar la llave"
            value={label}
            required
            maxLength={80}
            disabled={busy}
            onChange={(event) => setLabel(event.target.value)}
          />
          <p className="memo-note">
            El respaldo privado se descarga como firma-&lt;id&gt;.stckey.json
            para identificar la llave. Los respaldos anteriores siguen funcionando.
          </p>
          <details className="flow-details">
            <summary>Personalizar nombre del archivo público (opcional)</summary>
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
            label="Contraseña de la llave privada"
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
              {busy ? 'Generando llaves…' : 'Generar y preparar descarga'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
