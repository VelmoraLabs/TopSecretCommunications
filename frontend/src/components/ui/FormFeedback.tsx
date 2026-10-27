import { CircleAlert, CircleCheck } from 'lucide-react'
import { focusField } from '../../lib/useFormValidation'

export function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p className="field-error" id={`${id}-error`}>
      <CircleAlert size={15} aria-hidden="true" />
      {error}
    </p>
  ) : (
    <span id={`${id}-error`} hidden />
  )
}

/** Visible reasons for a disabled action; each reason leads to its control. */
export default function FormFeedback({
  issues,
  busy = false,
}: {
  issues: { id: string; message: string }[]
  busy?: boolean
}) {
  return (
    <div
      className={`form-readiness ${!issues.length ? 'form-readiness--ready' : ''}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {busy ? (
        <p role="status">Procesando… Espera a que termine la operación.</p>
      ) : issues.length ? (
        <>
          <strong>Para continuar:</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  aria-controls={issue.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => focusField(issue.id)}
                >
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          <CircleCheck size={16} aria-hidden="true" />
          Todo listo para continuar.
        </p>
      )}
    </div>
  )
}
