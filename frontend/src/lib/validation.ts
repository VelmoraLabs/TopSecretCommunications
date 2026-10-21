const length = (value: string) => Array.from(value).length
// Reject isolated UTF-16 surrogates while allowing Unicode such as emoji.
const malformed = (value: string) => /[\uD800-\uDFFF]/u.test(value)
const controls = (value: string) =>
  Array.from(value).some(
    (c) => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127,
  )

export function textError(
  value: string,
  label: string,
  maximum: number,
  optional = false,
): string {
  if (!value.trim()) return optional ? '' : `Escribe ${label}.`
  if (length(value) > maximum)
    return `Usa como máximo ${maximum} caracteres en ${label}.`
  if (controls(value) || malformed(value))
    return `Quita los caracteres de control de ${label}.`
  return ''
}

export function passwordError(value: string): string {
  if (length(value) < 12)
    return 'Usa al menos 12 caracteres para la contraseña.'
  if (length(value) > 256 || new TextEncoder().encode(value).length > 1024)
    return 'Usa como máximo 256 caracteres y 1024 bytes para la contraseña.'
  if (value.includes('\0') || malformed(value))
    return 'Quita los caracteres no válidos de la contraseña.'
  return ''
}

export function filenameError(value: string): string {
  return (
    textError(value, 'el nombre del archivo', 180) ||
    (value !== value.trim() ||
    ['.', '..'].includes(value) ||
    /[/\\]/.test(value)
      ? 'Usa un nombre sin rutas ni espacios al principio o al final.'
      : '')
  )
}

export function documentFileError(file: File | null): string {
  if (!file) return 'Selecciona el documento de tu equipo.'
  if (file.size > 5 * 1024 * 1024)
    return 'El archivo supera los 5 MiB. Selecciona uno más pequeño.'
  return filenameError(file.name)
}

export function emailError(value: string): string {
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || value.length > 254
    ? 'Escribe un correo válido, por ejemplo nombre@gmail.com.'
    : ''
}
