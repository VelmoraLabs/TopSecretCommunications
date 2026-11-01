/** Terminología de mensajes del sistema; no modifica contratos ni datos guardados. */
export function keyTerminology(message: string): string {
  return message.replace(/(?<!\/)\bclaves?\b/gi, (word) => {
    const replacement = word.toLowerCase() === 'claves' ? 'llaves' : 'llave'
    if (word === word.toUpperCase()) return replacement.toUpperCase()
    return word[0] === word[0].toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement
  })
}

/** El asunto entre comillas pertenece al usuario y conserva su nombre original. */
export function keyNotificationTitle(title: string): string {
  const subject = title.indexOf('«')
  return subject === -1
    ? keyTerminology(title)
    : keyTerminology(title.slice(0, subject)) + title.slice(subject)
}
