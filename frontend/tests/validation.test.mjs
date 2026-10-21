import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
// Use the project's compiler; no additional runner or runtime dependency.
const source = await readFile(new URL('../src/lib/validation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const { textError, passwordError, filenameError, documentFileError, emailError } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('required text rejects whitespace, controls and isolated surrogates', () => {
  for (const value of ['', '   ', 'Memo\nOculto', 'Nombre\x7f', '\ud800']) assert.ok(textError(value, 'un nombre', 80))
  assert.equal(textError('Coordinación diplomática 📝', 'un nombre', 80), '')
  assert.equal(textError('', 'un propósito', 500, true), '')
  assert.ok(textError('a'.repeat(81), 'un nombre', 80))
})
test('password boundaries follow Unicode characters and do not trim the secret', () => {
  assert.ok(passwordError('a'.repeat(11)))
  assert.equal(passwordError('a'.repeat(12)), '')
  assert.equal(passwordError('🔑'.repeat(256)), '')
  assert.ok(passwordError('🔑'.repeat(257)))
  assert.equal(passwordError(' '.repeat(12)), '') // Same contract as the backend; no silent transformation.
  assert.ok(passwordError('valid-password\0'))
  assert.ok(passwordError('valid-password\ud800'))
})
test('filenames reject paths, special names and invisible controls', () => {
  for (const value of ['../clave.txt', 'C:\\clave.txt', '.', '..', ' clave.txt', 'clave.txt ', 'clave\n.txt']) assert.ok(filenameError(value))
  assert.equal(filenameError('Informe de cooperación.pdf'), '')
  assert.ok(filenameError('a'.repeat(181)))
})
test('file readiness accepts any document type and enforces the 5 MiB boundary', () => {
  assert.ok(documentFileError(null))
  assert.equal(documentFileError({ name: 'archivo.zip', size: 5 * 1024 * 1024 }), '')
  assert.ok(documentFileError({ name: 'archivo.zip', size: 5 * 1024 * 1024 + 1 }))
  assert.equal(documentFileError({ name: 'vacio.txt', size: 0 }), '')
  assert.ok(documentFileError({ name: '../archivo.txt', size: 1 }))
})
test('profile email gives actionable feedback for malformed addresses', () => {
  for (const value of ['', 'alguien', 'a@@b.com', 'a b@example.com', 'a@local']) assert.ok(emailError(value))
  assert.equal(emailError(' nombre@example.com '), '')
})
