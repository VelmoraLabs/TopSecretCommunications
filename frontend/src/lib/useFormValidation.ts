import { useId, useState } from 'react'

/** Hace visible el campo si está dentro de opciones avanzadas cerradas. */
export function focusField(id: string) {
  const field = document.getElementById(id)
  for (
    let parent = field?.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
  }
  field?.focus()
}

/** Client guidance only: the API remains responsible for validation and access. */
export function useFormValidation<T extends string>(errors: Record<T, string>) {
  const prefix = useId()
  const [touched, setTouched] = useState<Partial<Record<T, boolean>>>({})
  const id = (field: T) => `${prefix}-${field}`
  const issues = (Object.keys(errors) as T[])
    .filter((field) => errors[field])
    .map((field) => ({ id: id(field), message: errors[field] }))
  const field = (name: T) => ({
    id: id(name),
    error: touched[name] ? errors[name] : '',
    onBlur: () => setTouched((previous) => ({ ...previous, [name]: true })),
  })
  function check() {
    if (!issues.length) return true
    setTouched(
      Object.fromEntries(
        Object.keys(errors).map((name) => [name, true]),
      ) as Record<T, boolean>,
    )
    focusField(issues[0].id)
    return false
  }
  return { id, field, issues, valid: issues.length === 0, check }
}
