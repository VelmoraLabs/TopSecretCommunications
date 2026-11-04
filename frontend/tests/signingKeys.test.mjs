import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  constants, createHash, createPrivateKey, createPublicKey,
  generateKeyPairSync, sign, verify,
} from 'node:crypto'
import ts from 'typescript'

const source = ts.transpileModule(
  await readFile(new URL('../src/features/documents/signingKeys.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } },
).outputText
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const password = 'contraseña de prueba 123'
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase: password },
})
const profileId = '10000000-0000-4000-8000-000000000001'
const generated = {
  key: {
    id: '20000000-0000-4000-8000-000000000001',
    fingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
  },
  private_base64: pair.privateKey.toString('base64'),
}
const expected = { ...generated.key, profile_id: profileId }
const data = () => api.signingPrivateKeyData(generated, profileId)
const file = (value) => new File([JSON.stringify(value)], 'firma.stckey.json')

test('firma: el JSON conserva el PKCS8 cifrado y permite firmar y verificar igual que el TXT anterior', async () => {
  const backup = data()
  assert.deepEqual(Object.keys(backup), [
    'format', 'version', 'purpose', 'profile_id', 'key_id', 'fingerprint', 'private_base64',
  ])
  assert.equal(backup.private_base64, generated.private_base64)
  assert.equal(backup.format, 'stc-signing-private-key')
  assert.equal(backup.purpose, 'document-signing')
  const message = Buffer.from([0, 255, 128, 65])
  const publicKey = createPublicKey({ key: pair.publicKey, format: 'der', type: 'spki' })
  for (const input of [file(backup), new File(['  ' + generated.private_base64 + '\n'], 'anterior.txt')]) {
    const encoded = await api.readSigningPrivateFile(input, expected)
    const privateKey = createPrivateKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'pkcs8', passphrase: password })
    const options = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }
    const signature = sign('sha256', message, { ...options, key: privateKey })
    assert.equal(verify('sha256', message, { ...options, key: publicKey }, signature), true)
    assert.equal(verify('sha256', Buffer.from('alterado'), { ...options, key: publicKey }, signature), false)
    assert.throws(() => createPrivateKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'pkcs8', passphrase: 'incorrecta' }))
  }
})

test('firma: otro perfil, generación o huella se rechazan antes de transmitir', async () => {
  for (const change of [
    { profile_id: '30000000-0000-4000-8000-000000000001' },
    { key_id: '30000000-0000-4000-8000-000000000001' },
    { fingerprint: 'a'.repeat(64) },
  ]) await assert.rejects(api.readSigningPrivateFile(file({ ...data(), ...change }), expected), /otro perfil/)
})

test('firma: rechaza respaldo de cifrado, versión desconocida y campos extra o ausentes', async () => {
  for (const change of [
    { format: 'stc-encryption-private-key', purpose: 'group-note-share-custody' },
    { version: 2 },
    { password },
    { key_id: undefined },
    { profile_id: 'inválido' },
    { fingerprint: 'Z'.repeat(64) },
  ]) await assert.rejects(api.readSigningPrivateFile(file({ ...data(), ...change }), expected))
  for (const value of [null, [], 'texto'])
    await assert.rejects(api.readSigningPrivateFile(file(value), expected))
  await assert.rejects(api.readSigningPrivateFile(new File(['{'], 'malformado.json'), expected), /JSON válido/)
  // Renombrar un JSON como TXT no evita validar su propósito.
  await assert.rejects(api.readSigningPrivateFile(new File([JSON.stringify({ ...data(), purpose: 'cifrado' })], 'renombrado.txt'), expected), /RSA-PSS/)
})

test('firma: límites de archivo y Base64 canónico se validan para ambos formatos', async () => {
  assert.match(api.signingFileError(null), /Selecciona/)
  for (const input of [
    new File([], 'vacio.txt'),
    new File(['A'.repeat(32769)], 'grande.json'),
    new File(['A'.repeat(16388)], 'grande.txt'),
  ]) await assert.rejects(api.readSigningPrivateFile(input, expected))
  for (const value of ['', 'AB==', '!!!!', 'A'.repeat(16388)]) {
    await assert.rejects(api.readSigningPrivateFile(file({ ...data(), private_base64: value }), expected), /Base64/)
    await assert.rejects(api.readSigningPrivateFile(new File([value], 'firma.txt'), expected))
  }
})

test('firma: el nombre del respaldo identifica la llave registrada', () => {
  assert.equal(
    api.signingPrivateFilename(generated.key.id),
    `firma-${generated.key.id}.stckey.json`,
  )
})
