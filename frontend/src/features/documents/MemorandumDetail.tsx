import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileSignature,
  LoaderCircle,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { DocumentMessage, MemoSignForm } from './DocumentForms'
import {
  downloadDocument,
  errorMessage,
  fileBase64,
  getDocument,
  saveBase64,
  saveFile,
  verifyFile,
  verifyStored,
  workflowLabels,
  signaturePurposes,
  requestApproval,
  sendDocument,
} from './memoranda'
import type { DocumentDetail, Verification } from './memoranda'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import { documentFileError } from '../../lib/validation'

export default function MemorandumDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null),
    [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [signing, setSigning] = useState(false)
  const [confirmation, setConfirmation] = useState<'send' | 'review' | null>(
    null,
  )
  const [verification, setVerification] = useState<Verification | null>(null),
    [file, setFile] = useState<File | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getDocument(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id])
  const validation = useFormValidation({ file: documentFileError(file) })
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
  async function download() {
    const result = await downloadDocument(id)
    saveBase64(result.filename, result.content_base64)
  }
  function exportSignatures() {
    if (!detail) return
    saveFile(
      detail.version.filename + '.firmas.json',
      JSON.stringify(
        {
          format: 'stc-document-signatures',
          format_version: 2,
          issuer_id: detail.document.issuer_id,
          approver_id: detail.document.approver_id,
          workflow_state: detail.document.workflow_state,
          sent_at: detail.document.sent_at,
          document_id: id,
          version: detail.version,
          algorithm: 'RSA-PSS',
          hash: 'SHA-256',
          mgf: 'MGF1(SHA-256)',
          salt_length: 32,
          signatures: detail.signatures,
        },
        null,
        2,
      ),
      'application/json',
    )
  }
  return (
    <>
      <Modal
        open
        busy={busy}
        title="Detalle del memorándum"
        onClose={() => {
          if (!busy && !signing) onClose()
        }}
      >
        {loading && (
          <p className="memo-loading">
            <LoaderCircle size={18} className="access-spinner" />
            Consultando documento…
          </p>
        )}
        {error && <DocumentMessage text={error} />}
        {detail && (
          <div className="memo-detail">
            <div className="memo-flow-note">
              <strong>{workflowLabels[detail.document.workflow_state]}</strong>
              <p>
                {detail.document.workflow_state === 'legacy_shared'
                  ? 'Documento compartido antes de incorporar el envío explícito. Conserva sus firmas e historial; crea un nuevo borrador para utilizar el flujo de emisión y aprobación.'
                  : detail.document.workflow_state === 'sent'
                    ? 'Envío confirmado. Los destinatarios finales ya tienen acceso a esta versión.'
                    : detail.document.workflow_state === 'pending_approval'
                      ? `La firma del emisor está registrada. Se solicitó la revisión a ${detail.document.approver_name}. Los destinatarios finales todavía no tienen acceso.`
                      : detail.document.workflow_state === 'ready_to_send'
                        ? 'Las firmas previstas están registradas. Falta que el emisor confirme el envío.'
                        : 'Borrador privado. Primero debe firmarlo su emisor; los destinatarios finales no tienen acceso.'}
              </p>
              {detail.document.workflow_state === 'ready_to_send' &&
                detail.document.issuer_id &&
                !detail.document.can_send && (
                  <p>
                    El emisor confirmará el envío. Antes de enviarlo, el
                    aprobador debe conservar su autoridad y los destinatarios
                    deben estar activos.
                  </p>
                )}
              {detail.document.approver_name && (
                <p>
                  Aprobación institucional: {detail.document.approver_name}
                  {detail.document.approver_id === detail.document.issuer_id
                    ? ' · cubierta por la firma del propio emisor Embajador'
                    : ''}
                  .
                </p>
              )}
            </div>
            <div className="detail-badges">
              <Badge
                tone={
                  detail.document.signature_state === 'signed'
                    ? 'green'
                    : 'amber'
                }
              >
                {detail.document.signature_state === 'signed'
                  ? 'Firmas requeridas completas'
                  : `${detail.document.signature_count} de ${detail.document.signer_count} firmas`}
              </Badge>
              <Badge tone="neutral">
                Versión {detail.version.version_number}
              </Badge>
            </div>
            <h3 className="detail-title">{detail.document.title}</h3>
            <p className="memo-note">
              Creado por {detail.document.creator_name}. Destinatarios propios
              de este documento.
            </p>
            <dl className="memo-metadata">
              <div>
                <dt>Archivo</dt>
                <dd>{detail.version.filename}</dd>
              </div>
              <div>
                <dt>Tamaño</dt>
                <dd>
                  {detail.version.size < 1024
                    ? `${detail.version.size} bytes`
                    : `${(detail.version.size / 1024).toFixed(1)} KiB`}
                </dd>
              </div>
              <div className="memo-wide">
                <dt>SHA-256 de la versión original</dt>
                <dd className="memo-fingerprint">{detail.version.sha256}</dd>
              </div>
            </dl>
            <div className="memo-actions memo-actions--start">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setDetail(await getDocument(id))
                    setVerification(null)
                    onChanged()
                  })
                }
              >
                <RefreshCw size={16} />
                Actualizar documento
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act(download)}
              >
                <Download size={16} />
                Descargar archivo
              </Button>
              {detail.document.can_sign && (
                <Button disabled={busy} onClick={() => setSigning(true)}>
                  <FileSignature size={16} />
                  {detail.document.signing_purpose === 'approval'
                    ? 'Firmar aprobación'
                    : 'Firmar emisión'}
                </Button>
              )}
              {detail.document.can_request_approval && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setConfirmation('review')}
                >
                  Solicitar aprobación
                </Button>
              )}
              {detail.document.can_send && (
                <Button disabled={busy} onClick={() => setConfirmation('send')}>
                  Enviar a destinatarios
                </Button>
              )}
            </div>
            <section>
              <h3>Emisión, aprobación y destinatarios</h3>
              <div className="memo-participants">
                {detail.participants.map((person) => (
                  <div key={person.id}>
                    <span>
                      <strong>{person.display_name}</strong>
                      <small>
                        {person.email}
                        {!person.is_active && ' · Perfil desactivado'}
                      </small>
                    </span>
                    <span className="memo-workflow">
                      {person.is_issuer && <Badge tone="purple">Emisor</Badge>}
                      {person.is_approver && (
                        <Badge tone="purple">Embajador aprobador</Badge>
                      )}
                      {person.is_recipient && (
                        <Badge tone="neutral">Destinatario final</Badge>
                      )}
                      {detail.document.workflow_state === 'legacy_shared' &&
                        person.can_sign && (
                          <Badge tone="neutral">Firmante anterior</Badge>
                        )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3>Firmas registradas</h3>
              {detail.signatures.length === 0 ? (
                <p className="memo-note">
                  Todavía no hay firmas para esta versión.
                </p>
              ) : (
                <>
                  <div className="memo-signatures">
                    {detail.signatures.map((signature) => (
                      <div key={signature.id}>
                        <strong>{signature.signer_name}</strong>
                        <Badge tone="purple">
                          {signaturePurposes[signature.purpose]}
                        </Badge>
                        <small>
                          {new Date(signature.created_at).toLocaleString(
                            'es-MX',
                          )}
                          {!signature.key_is_active &&
                            ' · Clave retirada para nuevas firmas'}
                        </small>
                        <span className="memo-fingerprint">
                          {signature.fingerprint}
                        </span>
                        <label className="field">
                          <span className="field-label">Firma en Base64</span>
                          <textarea
                            readOnly
                            rows={3}
                            value={signature.signature_base64}
                            aria-label={`Firma de ${signature.signer_name} en Base64`}
                          />
                        </label>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            saveFile(
                              `clave-publica-${signature.fingerprint.slice(0, 12)}.txt`,
                              signature.public_base64 + '\n',
                            )
                          }
                        >
                          <Download size={15} />
                          Clave pública utilizada
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" onClick={exportSignatures}>
                    <Download size={16} />
                    Descargar firmas asociadas
                  </Button>
                </>
              )}
            </section>
            <section className="memo-verification">
              <h3>
                <ShieldCheck size={19} />
                Comprobar integridad y firmas
              </h3>
              <p className="memo-note">
                Comprueba el archivo almacenado o compara un archivo de tu
                equipo con esta versión y sus firmas.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => setVerification(await verifyStored(id)))
                }
              >
                <CheckCircle2 size={16} />
                Verificar archivo almacenado
              </Button>
              <label className="field">
                <span className="field-label">
                  Archivo de tu equipo para verificar
                </span>
                <input
                  id={validation.id('file')}
                  onBlur={validation.field('file').onBlur}
                  aria-invalid={Boolean(
                    (file && documentFileError(file)) ||
                    validation.field('file').error,
                  )}
                  aria-describedby={`${validation.id('file')}-error`}
                  type="file"
                  disabled={busy}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null)
                    setVerification(null)
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
              <FormFeedback issues={validation.issues} busy={busy} />
              <Button
                variant="outline"
                disabled={busy || !validation.valid}
                onClick={() =>
                  void act(async () => {
                    if (validation.check() && file)
                      setVerification(
                        await verifyFile(
                          id,
                          detail.version.id,
                          await fileBase64(file),
                        ),
                      )
                  })
                }
              >
                Verificar archivo seleccionado
              </Button>
              {busy && (
                <p className="memo-loading" role="status">
                  <LoaderCircle className="access-spinner" size={17} />
                  Procesando…
                </p>
              )}
              {verification && (
                <div className="memo-verification-result">
                  <DocumentMessage
                    success={verification.all_valid}
                    text={
                      !verification.content_matches
                        ? 'El archivo no coincide con la versión registrada. Se detectó una modificación.'
                        : verification.signatures.length === 0
                          ? 'El archivo coincide con la versión registrada, pero todavía no tiene firmas.'
                          : verification.all_valid
                            ? 'El archivo coincide y todas las firmas registradas son válidas.'
                            : 'Una o más firmas no superaron la verificación.'
                    }
                  />
                  {verification.signatures.map((check) => (
                    <p key={check.signature_id}>
                      {check.signer_name}:{' '}
                      <strong>
                        {check.valid ? 'Firma válida' : 'Firma no válida'}
                      </strong>
                    </p>
                  ))}
                  {verification.all_valid &&
                    detail.document.signature_state !== 'signed' && (
                      <p className="memo-note">
                        Aún faltan firmas de otras personas designadas.
                      </p>
                    )}
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>
      {confirmation && detail && (
        <Modal
          open
          busy={busy}
          title={
            confirmation === 'send'
              ? 'Confirmar envío'
              : 'Solicitar aprobación del Embajador'
          }
          onClose={() => {
            if (!busy) setConfirmation(null)
          }}
        >
          <p>
            {confirmation === 'send'
              ? `Se dará acceso a los ${detail.document.recipient_count} destinatarios finales de esta versión. Se verificarán el archivo y sus firmas antes de confirmar.`
              : `Se habilitará la revisión a ${detail.document.approver_name}. Los destinatarios finales seguirán sin acceso.`}
          </p>
          <div className="memo-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const updated = await (
                    confirmation === 'send' ? sendDocument : requestApproval
                  )(id, detail.version.id)
                  setDetail(updated)
                  setVerification(null)
                  setConfirmation(null)
                  onChanged()
                })
              }
            >
              {busy
                ? 'Comprobando…'
                : confirmation === 'send'
                  ? 'Confirmar envío'
                  : 'Confirmar solicitud'}
            </Button>
          </div>
          {error && <DocumentMessage text={error} />}
        </Modal>
      )}
      {signing && detail && (
        <MemoSignForm
          document={detail}
          onClose={() => setSigning(false)}
          onSaved={(updated) => {
            setDetail(updated)
            setSigning(false)
            setVerification(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}
