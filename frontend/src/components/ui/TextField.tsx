import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { FieldError } from './FormFeedback'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  icon?: LucideIcon
  endAdornment?: ReactNode
  error?: string
  hint?: string
  hideLabel?: boolean
}
export default function TextField({
  label,
  icon: Icon,
  endAdornment,
  hint,
  error,
  hideLabel = false,
  id,
  ...props
}: Props) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      <label
        className={hideLabel ? 'sr-only' : 'field-label'}
        htmlFor={inputId}
      >
        {label}
      </label>
      <div className="field-control">
        {Icon && <Icon size={18} aria-hidden="true" />}
        <input
          id={inputId}
          {...props}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={
            [
              props['aria-describedby'],
              hint && `${inputId}-hint`,
              error && `${inputId}-error`,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        {endAdornment}
      </div>
      <FieldError id={inputId} error={error} />
      {hint && (
        <p className="field-hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}
