import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const dataUrl = (source) =>
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const transpile = async (path) =>
  ts.transpileModule(
    await readFile(new URL(path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } },
  ).outputText
const terminologyUrl = dataUrl(await transpile('../src/lib/keyTerminology.ts'))
const { keyNotificationTitle, keyTerminology } = await import(terminologyUrl)
const apiSource = (await transpile('../src/lib/api.ts'))
  .replace(/['"]\.\/keyTerminology['"]/g, JSON.stringify(terminologyUrl))
  .replace(
    /['"]\.\/supabase['"]/g,
    JSON.stringify(dataUrl('export function getSupabase(){throw new Error("No se debe consultar la sesión en esta prueba")}')),
  )
const { ApiError } = await import(dataUrl(apiSource))

test('los errores del servidor muestran llave sin alterar status ni código', () => {
  const error = new ApiError(422, 'invalid_key', 'La clave privada no coincide. Revisa tus claves.')
  assert.equal(error.message, 'La llave privada no coincide. Revisa tus llaves.')
  assert.equal(error.status, 422)
  assert.equal(error.code, 'invalid_key')
})

test('los avisos de llaves conservan el nombre histórico escrito por el usuario', () => {
  assert.equal(
    keyNotificationTitle('Clave activada: «Mi clave de cifrado · prueba»'),
    'Llave activada: «Mi clave de cifrado · prueba»',
  )
  assert.equal(keyNotificationTitle('Se retiró una clave de firma'), 'Se retiró una llave de firma')
})

test('la presentación conserva rutas, identificadores y palabras distintas', () => {
  const technical = '/claves VITE_CLAVE_PUBLICA private_key_base64 enclave'
  assert.equal(keyTerminology(technical), technical)
  assert.equal(keyTerminology('CLAVES PERSONALES · Clave pública'), 'LLAVES PERSONALES · Llave pública')
})
