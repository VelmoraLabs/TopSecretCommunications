import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Ejecuta los helpers reales y el lector de respaldos; sustituye solo el transporte.
const dataUrl = (source) =>
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const transport = dataUrl(
  'export async function apiRequest(path, options = {}) { return globalThis.personnelTestTransport(path, options) }',
)
const modules = new Map()
async function compile(path) {
  if (path.endsWith('/lib/api.ts')) return transport
  if (modules.has(path)) return modules.get(path)
  let source = ts.transpileModule(await readFile(new URL(path), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)]
  for (const [, specifier] of imports) {
    if (!specifier.startsWith('.'))
      throw new Error('Unexpected dependency: ' + specifier)
    const dependency = await compile(new URL(specifier + '.ts', path).href)
    source = source
      .replace(`from '${specifier}'`, `from '${dependency}'`)
      .replace(`from "${specifier}"`, `from '${dependency}'`)
  }
  const url = dataUrl(source)
  modules.set(path, url)
  return url
}
const api = await import(
  await compile(
    new URL(
      '../src/features/personnel-files/personnelFiles.ts',
      import.meta.url,
    ).href,
  )
)
const creator = '10000000-0000-4000-8000-000000000001'
const recipient = '10000000-0000-4000-8000-000000000002'
const id = '20000000-0000-4000-8000-000000000001'
const version = '30000000-0000-4000-8000-000000000001'
const keyId = '40000000-0000-4000-8000-000000000001'
const detail = {
  file: { id, version_id: version, state: 'ready', created_by: creator },
  participants: [
    {
      profile_id: creator,
      key_id: keyId,
      fingerprint: 'a'.repeat(64),
      is_active: true,
    },
  ],
}
const key = {
  format: 'stc-encryption-private-key',
  version: 1,
  purpose: 'group-note-share-custody',
  profile_id: creator,
  key_id: keyId,
  fingerprint: 'a'.repeat(64),
  private_base64: 'QUJDRA==',
}
const privateFile = (value = key) =>
  new File([JSON.stringify(value)], 'original.stckey.json')
const document = new File(
  [Uint8Array.from([0, 255, 128, 65])],
  'archivo.bin',
)
const password = ' contraseña original ' // No se recortan los secretos.
let calls
function capture(value = { ok: true }) {
  calls = []
  globalThis.personnelTestTransport = async (path, options) => {
    calls.push({ path, options })
    return value
  }
}

test('el listado codifica búsqueda Unicode y conserva paginación y cancelación', async () => {
  capture()
  const controller = new AbortController()
  await api.getPersonnelFiles(' Área & personal ', 20, controller.signal)
  const url = new URL(calls[0].path, 'http://localhost')
  assert.equal(url.pathname, '/api/v1/personnel-files')
  assert.equal(url.searchParams.get('search'), 'Área & personal')
  assert.equal(url.searchParams.get('offset'), '20')
  assert.equal(url.searchParams.get('limit'), '20')
  assert.equal(calls[0].options.signal, controller.signal)
})
test('el listado devuelve su total global incluso al pedir un solo elemento', async () => {
  capture({ items: [], total: 125, offset: 0, limit: 1 })
  const result = await api.getPersonnelFiles('', 0, undefined, 1)
  assert.equal(
    new URL(calls[0].path, 'http://localhost').searchParams.get('limit'),
    '1',
  )
  assert.equal(result.total, 125)
})
test('la creación preserva bytes binarios y envía asignaciones, sin actor ni claves de cliente', async () => {
  capture()
  await api.createPersonnelFile(' Expediente ', document, [recipient])
  const { path, options } = calls[0]
  assert.equal(path, '/api/v1/personnel-files')
  assert.equal(options.method, 'POST')
  assert.ok(options.signal instanceof AbortSignal)
  assert.deepEqual(JSON.parse(options.body), {
    title: 'Expediente',
    filename: 'archivo.bin',
    media_type: 'application/octet-stream',
    content_base64: 'AP+AQQ==',
    recipients: [{ profile_id: recipient }],
  })
})
test('se permite crear un expediente con el creador seleccionado una sola vez', async () => {
  capture()
  await api.createPersonnelFile('Personal', new File([], 'vacio.txt'), [
    creator,
  ])
  assert.deepEqual(JSON.parse(calls[0].options.body).recipients, [
    { profile_id: creator },
  ])
  assert.equal(JSON.parse(calls[0].options.body).content_base64, '')
})
test('títulos y archivos inválidos fallan antes de enviar contenido', async () => {
  capture()
  await assert.rejects(
    api.createPersonnelFile(' ', document, [recipient]),
    /título/,
  )
  await assert.rejects(
    api.createPersonnelFile('X', new File(['x'], '../fuera.txt'), [
      recipient,
    ]),
    /rutas/,
  )
  await assert.rejects(
    api.createPersonnelFile(
      'X',
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.bin'),
      [recipient],
    ),
    /5 MiB/,
  )
  assert.equal(calls.length, 0)
})
test('las asignaciones vacías, duplicadas, excesivas o con rutas no llegan al servidor', async () => {
  capture()
  for (const recipients of [
    [],
    [recipient, recipient],
    Array(256).fill(recipient),
    ['../cancel'],
  ])
    await assert.rejects(
      api.createPersonnelFile('X', document, recipients),
      /destinatarios distintos/,
    )
  assert.equal(calls.length, 0)
})
test('la apertura usa exclusivamente la clave original asignada y la versión del expediente', async () => {
  capture()
  await api.openPersonnelFile(detail, creator, privateFile(), password)
  const { path, options } = calls[0]
  assert.equal(path, `/api/v1/personnel-files/${id}/file`)
  assert.equal(options.method, 'POST')
  assert.ok(!path.includes(password) && !path.includes(key.private_base64))
  assert.deepEqual(JSON.parse(options.body), {
    version_id: version,
    key_id: keyId,
    private_key_base64: key.private_base64,
    password,
  })
})
test('las claves de otra persona, generación o huella se rechazan antes de la petición', async () => {
  capture()
  for (const field of ['profile_id', 'key_id', 'fingerprint'])
    await assert.rejects(
      api.openPersonnelFile(
        detail,
        creator,
        privateFile({ ...key, [field]: 'otra' }),
        password,
      ),
      /otro perfil|generación/,
    )
  assert.equal(calls.length, 0)
})
test('no se confunde una clave de firma con el respaldo de cifrado histórico', async () => {
  capture()
  await assert.rejects(
    api.openPersonnelFile(
      detail,
      creator,
      privateFile({ ...key, purpose: 'signing' }),
      password,
    ),
    /clave de firma/,
  )
  await assert.rejects(
    api.openPersonnelFile(
      detail,
      creator,
      new File(['%%%'], 'firma.txt'),
      password,
    ),
    /stckey/,
  )
  assert.equal(calls.length, 0)
})
test('una clave nueva activa no se consulta ni reemplaza la original al recuperar', async () => {
  capture()
  await api.openPersonnelFile(detail, creator, privateFile(), password)
  assert.equal(calls.length, 1)
  assert.equal(JSON.parse(calls[0].options.body).key_id, keyId)
})
test('una cuenta ajena o inactiva y cargas no publicadas no solicitan el original', async () => {
  capture()
  await assert.rejects(
    api.openPersonnelFile(detail, recipient, privateFile(), password),
    /no está disponible/,
  )
  await assert.rejects(
    api.openPersonnelFile(
      {
        ...detail,
        participants: [{ ...detail.participants[0], is_active: false }],
      },
      creator,
      privateFile(),
      password,
    ),
    /no está disponible/,
  )
  for (const state of ['staging', 'cancelled'])
    await assert.rejects(
      api.openPersonnelFile(
        { ...detail, file: { ...detail.file, state } },
        creator,
        privateFile(),
        password,
      ),
      /no está disponible/,
    )
  assert.equal(calls.length, 0)
})
test('contraseñas inválidas y respaldos excesivos fallan sin transmitirlos', async () => {
  capture()
  await assert.rejects(
    api.openPersonnelFile(detail, creator, privateFile(), 'corta'),
    /12 caracteres/,
  )
  await assert.rejects(
    api.openPersonnelFile(
      detail,
      creator,
      new File(['A'.repeat(32769)], 'grande.json'),
      password,
    ),
    /32 KiB/,
  )
  assert.equal(calls.length, 0)
})
test('consulta y cancelación usan UUID locales; no admiten segmentos de URL arbitrarios', async () => {
  capture()
  await api.getPersonnelFile(id)
  await api.cancelPersonnelFile(id)
  assert.equal(calls[0].path, `/api/v1/personnel-files/${id}`)
  assert.equal(calls[1].path, `/api/v1/personnel-files/${id}/cancel`)
  assert.equal(calls[1].options.method, 'POST')
  assert.throws(() => api.getPersonnelFile('../memoranda'), /identificador/)
  assert.throws(
    () => api.cancelPersonnelFile('https://ejemplo.com'),
    /identificador/,
  )
  assert.equal(calls.length, 2)
})
test('los errores del servidor no provocan reintentos automáticos de creación o apertura', async () => {
  let count = 0
  globalThis.personnelTestTransport = async () => {
    count++
    throw new Error('Acceso revocado')
  }
  await assert.rejects(
    api.createPersonnelFile('X', document, [recipient]),
    /Acceso revocado/,
  )
  await assert.rejects(
    api.openPersonnelFile(detail, creator, privateFile(), password),
    /Acceso revocado/,
  )
  assert.equal(count, 2)
})
