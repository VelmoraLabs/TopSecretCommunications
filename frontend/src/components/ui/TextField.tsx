import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  icon?: LucideIcon
  endAdornment?: ReactNode
  hint?: string
  hideLabel?: boolean
}
export default function TextField({
  label,
  icon: Icon,
  endAdornment,
  hint,
  hideLabel = false,
  id,
  ...props
}: Props) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <div className="field">
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
          aria-describedby={hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {endAdornment}
      </div>
      {hint && (
        <p className="field-hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}
