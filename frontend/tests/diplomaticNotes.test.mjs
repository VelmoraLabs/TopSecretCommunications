import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Helpers reales, incluidos los lectores de privadas; solo el transporte se sustituye.
const dataUrl = (source) =>
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const transport = dataUrl(
  'export async function apiRequest(path, options = {}, retrySession = true) { return globalThis.diplomaticTransport(path, options, retrySession) }',
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
  for (const [, specifier] of [
    ...source.matchAll(/from ['"]([^'"]+)['"]/g),
  ]) {
    assert.ok(specifier.startsWith('.'), specifier)
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
      '../src/features/diplomatic-notes/diplomaticNotes.ts',
      import.meta.url,
    ).href,
  )
)
const issuer = '10000000-0000-4000-8000-000000000001'
const reader = '10000000-0000-4000-8000-000000000002'
const id = '20000000-0000-4000-8000-000000000001'
const version = '30000000-0000-4000-8000-000000000001'
const keyId = '40000000-0000-4000-8000-000000000001'
const signingId = '50000000-0000-4000-8000-000000000001'
const detail = {
  file: {
    id,
    version_id: version,
    state: 'ready',
    created_by: issuer,
    kind: 'diplomatic_note',
    signing_key_id: signingId,
    filename: 'prueba.bin',
    media_type: 'application/octet-stream',
    size: 4,
  },
  participants: [
    {
      profile_id: reader,
      key_id: keyId,
      fingerprint: 'a'.repeat(64),
      is_active: true,
    },
  ],
  signer: {
    profile_id: issuer,
    key_id: signingId,
    fingerprint: 'b'.repeat(64),
    is_active: false,
  },
}
const backup = {
  format: 'stc-encryption-private-key',
  version: 1,
  purpose: 'group-note-share-custody',
  profile_id: reader,
  key_id: keyId,
  fingerprint: 'a'.repeat(64),
  private_base64: 'QUJDRA==',
}
const privateFile = (value = backup) =>
  new File([JSON.stringify(value)], 'original.stckey.json')
const signingKey = {
  id: signingId,
  is_active: true,
  fingerprint: 'b'.repeat(64),
  label: 'Firma',
}
const signingFile = () => new File(['  QUJDRA==\n'], 'firma.txt')
const document = new File(
  [Uint8Array.from([0, 255, 128, 65])],
  'prueba.bin',
)
const password = ' contraseña original '
const download = {
  filename: detail.file.filename,
  media_type: detail.file.media_type,
  size: 4,
  content_base64: 'AP+AQQ==',
  document_id: id,
  version_id: version,
  issuer_id: issuer,
  signing_key_id: signingId,
  signing_fingerprint: 'b'.repeat(64),
  verification: 'signature-and-integrity',
}
let calls
function capture(value = download) {
  calls = []
  globalThis.diplomaticTransport = async (path, options, retrySession) => {
    calls.push({ path, options, retrySession })
    return value
  }
}
const create = (overrides = {}) => {
  const args = {
    kind: 'diplomatic_note',
    title: ' Nota ',
    file: document,
    recipients: [reader],
    signingKey,
    privateFile: signingFile(),
    password,
    ...overrides,
  }
  return api.createDiplomaticNote(
    args.kind,
    args.title,
    args.file,
    args.recipients,
    args.signingKey,
    args.privateFile,
    args.password,
  )
}

test('notas: listado codifica Unicode, tipo y paginación y conserva AbortSignal', async () => {
  capture({ items: [], total: 42, limit: 1, offset: 20 })
  const controller = new AbortController()
  const page = await api.getDiplomaticNotes(
    ' Área & firma ',
    'communique',
    20,
    controller.signal,
    1,
  )
  const url = new URL(calls[0].path, 'http://localhost')
  assert.equal(url.pathname, '/api/v1/diplomatic-notes')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    search: 'Área & firma',
    kind: 'communique',
    offset: '20',
    limit: '1',
  })
  assert.equal(calls[0].options.signal, controller.signal)
  assert.equal(page.total, 42)
})
test('notas: filtros y segmentos arbitrarios se rechazan antes del transporte', () => {
  capture()
  for (const args of [
    ['', 'other'],
    ['x'.repeat(81)],
    ['', 'all', -1],
    ['', 'all', 1.5],
    ['', 'all', 100001],
    ['', 'all', 0, undefined, 101],
  ])
    assert.throws(() => api.getDiplomaticNotes(...args), /filtros/)
  for (const value of [
    '../cancel',
    'https://example.org',
    `${id}?actor=otro`,
    '',
    null,
  ]) {
    assert.throws(() => api.getDiplomaticNote(value), /identificador/)
    assert.throws(() => api.cancelDiplomaticNote(value), /identificador/)
  }
  assert.equal(calls.length, 0)
})
test('notas: consulta y cancelación apuntan al UUID local elegido', async () => {
  capture(detail)
  await api.getDiplomaticNote(id)
  await api.cancelDiplomaticNote(id)
  assert.deepEqual(
    calls.map((c) => c.path),
    [
      `/api/v1/diplomatic-notes/${id}`,
      `/api/v1/diplomatic-notes/${id}/cancel`,
    ],
  )
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(calls[1].options.body, undefined)
})
test('notas: ambos tipos preservan bytes y vinculan firma sin actor ni pública del cliente', async () => {
  for (const kind of ['diplomatic_note', 'communique']) {
    capture(detail)
    await create({ kind })
    assert.equal(calls[0].path, '/api/v1/diplomatic-notes')
    assert.equal(calls[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      kind,
      title: 'Nota',
      filename: 'prueba.bin',
      media_type: 'application/octet-stream',
      content_base64: 'AP+AQQ==',
      recipients: [{ profile_id: reader }],
      signing_key_id: signingId,
      private_key_base64: 'QUJDRA==',
      password,
    })
    assert.equal(calls[0].retrySession, false)
    assert.ok(calls[0].options.signal instanceof AbortSignal)
  }
})
test('notas: el emisor puede seleccionarse una vez y el documento vacío conserva sus bytes', async () => {
  capture()
  await create({ file: new File([], 'vacio.txt'), recipients: [issuer] })
  const body = JSON.parse(calls[0].options.body)
  assert.deepEqual(body.recipients, [{ profile_id: issuer }])
  assert.equal(body.content_base64, '')
})
test('notas: tipo, título, rutas y tamaño inválidos no transmiten contenido', async () => {
  capture()
  for (const overrides of [
    { kind: 'special' },
    { title: '  ' },
    { file: new File(['x'], '../afuera.txt') },
    { file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.bin') },
  ])
    await assert.rejects(create(overrides))
  assert.equal(calls.length, 0)
})
test('notas: destinatarios vacíos, duplicados, excesivos o no UUID no se envían', async () => {
  capture()
  for (const recipients of [
    [],
    [reader, reader],
    Array(256).fill(reader),
    ['../otro'],
  ])
    await assert.rejects(create({ recipients }), /destinatarios distintos/)
  assert.equal(calls.length, 0)
})
test('notas: una clave de firma retirada o referencia inválida impiden crear', async () => {
  capture()
  for (const key of [
    { ...signingKey, is_active: false },
    { ...signingKey, id: '../keys' },
  ])
    await assert.rejects(create({ signingKey: key }), /firma activa/)
  assert.equal(calls.length, 0)
})
test('notas: privada de firma debe ser Base64 canónico y no el respaldo JSON de cifrado', async () => {
  capture()
  assert.match(api.signingFileError(null), /Selecciona/)
  for (const file of [
    new File([], 'vacio.txt'),
    new File(['A'.repeat(16385)], 'grande.txt'),
    privateFile(),
    new File(['!!!!'], 'invalido.txt'),
    new File(['AB=='], 'no-canonico.txt'),
  ])
    await assert.rejects(create({ privateFile: file }))
  assert.equal(calls.length, 0)
})
test('notas: contraseñas cortas o excesivas no se envían y los secretos no se recortan', async () => {
  capture()
  for (const secret of ['corta', 'x'.repeat(257)])
    await assert.rejects(create({ password: secret }), /contraseña/)
  assert.equal(calls.length, 0)
  await create()
  assert.equal(JSON.parse(calls[0].options.body).password, password)
})
test('notas: recuperación usa la clave histórica del destinatario y no consulta una nueva', async () => {
  capture()
  assert.deepEqual(
    await api.openDiplomaticNote(detail, reader, privateFile(), password),
    download,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, `/api/v1/diplomatic-notes/${id}/file`)
  assert.equal(calls[0].retrySession, false)
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    version_id: version,
    key_id: keyId,
    private_key_base64: backup.private_base64,
    password,
  })
  assert.ok(!calls[0].path.includes(password))
  // Una firma histórica sigue verificándose aunque su clave ya esté retirada.
  assert.equal(detail.signer.is_active, false)
})
test('notas: respaldo ajeno, de otra generación o huella falla antes de recuperar', async () => {
  capture()
  for (const change of [
    { profile_id: issuer },
    { key_id: signingId },
    { fingerprint: 'c'.repeat(64) },
  ])
    await assert.rejects(
      api.openDiplomaticNote(
        detail,
        reader,
        privateFile({ ...backup, ...change }),
        password,
      ),
      /otro perfil o a otra generación/,
    )
  assert.equal(calls.length, 0)
})
test('notas: la privada de firma no sustituye al JSON de cifrado', async () => {
  capture()
  await assert.rejects(
    api.openDiplomaticNote(detail, reader, signingFile(), password),
  )
  await assert.rejects(
    api.openDiplomaticNote(
      detail,
      reader,
      new File(['x'.repeat(32769)], 'grande.json'),
      password,
    ),
    /32 KiB/,
  )
  assert.equal(calls.length, 0)
})
test('notas: cuenta ajena o inactiva y documentos incompletos o cancelados no recuperan', async () => {
  capture()
  await assert.rejects(
    api.openDiplomaticNote(detail, issuer, privateFile(), password),
    /no está disponible/,
  )
  for (const state of ['staging', 'cancelled'])
    await assert.rejects(
      api.openDiplomaticNote(
        { ...detail, file: { ...detail.file, state } },
        reader,
        privateFile(),
        password,
      ),
      /no está disponible/,
    )
  await assert.rejects(
    api.openDiplomaticNote(
      {
        ...detail,
        participants: [{ ...detail.participants[0], is_active: false }],
      },
      reader,
      privateFile(),
      password,
    ),
    /no está disponible/,
  )
  assert.equal(calls.length, 0)
})
test('notas: recuperación con contraseña inválida no envía la privada', async () => {
  capture()
  await assert.rejects(
    api.openDiplomaticNote(detail, reader, privateFile(), 'corta'),
    /contraseña/,
  )
  assert.equal(calls.length, 0)
})
test('notas: respuestas sin verificación o de otro documento o firmante no se entregan', async () => {
  for (const changes of [
    { verification: 'unverified' },
    { document_id: signingId },
    { version_id: signingId },
    { issuer_id: reader },
    { signing_key_id: keyId },
    { signing_fingerprint: 'c'.repeat(64) },
    { filename: 'otro.bin' },
    { media_type: 'text/plain' },
    { size: 5 },
    { content_base64: null },
  ]) {
    capture({ ...download, ...changes })
    await assert.rejects(
      api.openDiplomaticNote(detail, reader, privateFile(), password),
      /no coincide/,
    )
  }
})
test('notas: un cuerpo truncado o Base64 inválido no produce un archivo verificado', async () => {
  for (const content_base64 of ['', '!!!!', 'AA==', 'AP+AQR==']) {
    capture({ ...download, content_base64 })
    await assert.rejects(
      api.openDiplomaticNote(detail, reader, privateFile(), password),
      /incompleto/,
    )
  }
})
test('notas: fallos de creación y apertura no provocan reenvíos automáticos', async () => {
  for (const action of [
    () => create(),
    () => api.openDiplomaticNote(detail, reader, privateFile(), password),
  ]) {
    let attempts = 0
    globalThis.diplomaticTransport = async (
      _path,
      _options,
      retrySession,
    ) => {
      attempts++
      assert.equal(retrySession, false)
      throw new Error('Respuesta perdida')
    }
    await assert.rejects(action(), /Respuesta perdida/)
    assert.equal(attempts, 1)
  }
})
