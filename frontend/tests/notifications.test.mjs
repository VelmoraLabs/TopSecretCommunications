import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const url = (s) =>
  'data:text/javascript;base64,' + Buffer.from(s).toString('base64')
let source = ts.transpileModule(
  await readFile(
    new URL(
      '../src/features/notifications/notifications.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  },
).outputText
source = source.replace(
  /['"]\.\.\/\.\.\/lib\/api['"]/g,
  JSON.stringify(
    url(
      'export async function apiRequest(path,options){return {path,options}}',
    ),
  ),
)
const {
  entityId,
  notificationTarget,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = await import(url(source))
const id = '10000000-0000-4000-8000-000000000001',
  note = '20000000-0000-4000-8000-000000000001'
test('avisos navegan a rutas locales y a la solicitud exacta', () => {
  assert.equal(
    notificationTarget({
      target_kind: 'recovery',
      target_id: id,
      related_id: note,
    }),
    `/notas-especiales?nota=${note}&solicitud=${id}`,
  )
  assert.equal(
    notificationTarget({ target_kind: 'document', target_id: id }),
    `/documentos?documento=${id}`,
  )
  assert.equal(
    notificationTarget({ target_kind: 'group', target_id: id }),
    `/grupos?grupo=${id}`,
  )
  assert.equal(
    notificationTarget({ target_kind: 'note', target_id: note }),
    `/notas-especiales?nota=${note}`,
  )
})
test('referencias inválidas no permiten URLs externas ni parámetros adicionales', () => {
  for (const value of [
    'https://otro.test',
    '//otro.test',
    'javascript:alert(1)',
    id + '&admin=true',
  ]) {
    assert.equal(entityId(value), null)
    assert.equal(
      notificationTarget({ target_kind: 'document', target_id: value }),
      '/documentos',
    )
  }
  assert.equal(notificationTarget({ target_kind: 'keys' }), '/claves')
  assert.equal(notificationTarget({ target_kind: 'account' }), '/dashboard')
})
test('bandeja usa filtros y paginación sin elegir destinatario', async () => {
  const r = await listNotifications('unread', 'groups', 20, 5)
  const query = new URL(r.path, 'http://localhost').searchParams
  assert.equal(query.get('state'), 'unread')
  assert.equal(query.get('category'), 'groups')
  assert.equal(query.get('offset'), '20')
  assert.equal(query.get('limit'), '5')
  assert.equal(query.has('recipient_id'), false)
})
test('leer un aviso solo marca lectura; no aporta ni firma', async () => {
  const r = await markNotificationRead(id)
  assert.equal(r.path, `/api/v1/notifications/${id}/read`)
  assert.equal(r.options.method, 'POST')
  assert.equal(r.options.body, undefined)
})
test('marcar todas conserva el corte de lectura del servidor', async () => {
  const before = '2026-10-26T18:00:00Z',
    r = await markAllNotificationsRead(before)
  assert.equal(r.path, '/api/v1/notifications/read-all')
  assert.deepEqual(JSON.parse(r.options.body), { before })
})
test('el aviso de expediente dirige al documento exacto en el módulo de cifrado', () => {
  assert.equal(
    notificationTarget({ target_kind: 'personnel_file', target_id: id }),
    `/expedientes?expediente=${id}`,
  )
})
test('avisos de expedientes no aceptan URL externa ni inyección de parámetros', () => {
  for (const target_id of [
    null,
    'https://otro.test',
    id + '&admin=true',
    '../documentos',
  ])
    assert.equal(
      notificationTarget({ target_kind: 'personnel_file', target_id }),
      '/expedientes',
    )
})
test('el enlace de un error abre las opciones plegadas antes de enfocar el campo', async () => {
  let code = ts.transpileModule(
    await readFile(
      new URL('../src/lib/useFormValidation.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
    },
  ).outputText
  code = code.replace(
    /import[^;]+from ['"]react['"];?/,
    'const useId=()=>"test",useState=()=>{};',
  )
  const originalDocument = globalThis.document,
    originalDetails = globalThis.HTMLDetailsElement
  class Details {
    open = false
    parentElement = null
  }
  const outer = new Details(),
    inner = new Details()
  inner.parentElement = outer
  let focused = false
  const field = {
    parentElement: inner,
    focus: () => {
      focused = true
    },
  }
  globalThis.document = {
    getElementById: (id) => (id === 'private-name' ? field : null),
  }
  globalThis.HTMLDetailsElement = Details
  try {
    const { focusField } = await import(url(code))
    focusField('private-name')
    assert(outer.open && inner.open && focused)
    assert.doesNotThrow(() => focusField('missing'))
  } finally {
    globalThis.document = originalDocument
    globalThis.HTMLDetailsElement = originalDetails
  }
})

test('avisos de notas y comunicados abren el documento exacto sin ejecutar su descarga', () => {
  for (const event_type of ['diplomatic_note_shared', 'communique_shared'])
    assert.equal(
      notificationTarget({
        target_kind: 'diplomatic_note',
        target_id: id,
        event_type,
      }),
      `/notas-diplomaticas?nota=${id}`,
    )
})
test('avisos de notas diplomáticas no aceptan URLs externas ni inyección de parámetros', () => {
  for (const target_id of [
    null,
    'https://otro.test',
    id + '&solicitud=otra',
    '../documentos',
    id + '#otro',
  ])
    assert.equal(
      notificationTarget({ target_kind: 'diplomatic_note', target_id }),
      '/notas-diplomaticas',
    )
})
