import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../auth/auth'
import { DocumentMessage } from '../documents/DocumentForms'
import { errorMessage } from '../documents/memoranda'
import { downloadJson } from '../documents/specialNotes'
import { getOwnShare } from './groupNotes'
import type { NoteDetail } from './groupNotes'

/** Respaldo opcional: la aportación usa el sobre asignado que conserva el servidor. */
export default function OwnSharePanel({
  detail,
  onBusyChange,
}: {
  detail: NoteDetail
  onBusyChange: (value: boolean) => void
}) {
  const auth = useAuth()
  const assigned = detail.participants.find(
    (p) => p.profile_id === auth.access?.profile.id,
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  if (!assigned?.encryption_key_id) return null
  async function download() {
    if (busy || !assigned) return
    setBusy(true)
    onBusyChange(true)
    setError('')
    try {
      downloadJson(
        await getOwnShare(detail.note.id),
        `${detail.note.id}-fragmento-${assigned.share_index}.stcshare.json`,
      )
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  return (
    <details className="flow-details">
      <summary>Respaldo de mi fragmento y detalles técnicos (opcional)</summary>
      <p>
        Tu fragmento {assigned.share_index} de {detail.note.participant_count}{' '}
        está almacenado cifrado. La aplicación lo obtiene al autorizar tu
        aportación; no necesitas descargarlo ni volver a subirlo.
      </p>
      <p className="memo-note">
        Esta copia es un respaldo cifrado. No reemplaza tu clave privada y no
        reconstruye por sí sola el documento.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void download()}>
        <Download size={17} />
        {busy ? 'Preparando respaldo…' : 'Descargar respaldo cifrado'}
      </Button>
      {error && <DocumentMessage text={error} />}
      <p className="memo-note">
        Identificador de la clave original: {assigned.encryption_key_id}
      </p>
      <p className="memo-fingerprint">{assigned.encryption_fingerprint}</p>
    </details>
  )
}
