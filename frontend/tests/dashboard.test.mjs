import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const url = (s) =>
  'data:text/javascript;base64,' + Buffer.from(s).toString('base64')
const transpile = async (path) =>
  ts.transpileModule(
    await readFile(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
    },
  ).outputText
const api = url(
  'export async function apiRequest(path,options){return {path,options}}',
)
const notifications = (
  await transpile('../src/features/notifications/notifications.ts')
).replace(/['"]\.\.\/\.\.\/lib\/api['"]/g, JSON.stringify(api))
const source = (await transpile('../src/features/dashboard/dashboard.ts'))
  .replace(/['"]\.\.\/\.\.\/lib\/api['"]/g, JSON.stringify(api))
  .replace(
    /['"]\.\.\/notifications\/notifications['"]/g,
    JSON.stringify(url(notifications)),
  )
const { getDashboard, dashboardTarget } = await import(url(source))
const id = '10000000-0000-4000-8000-000000000001',
  note = '20000000-0000-4000-8000-000000000001'
test('dashboard solicita un resumen autorizado completo, sin escoger destinatario', async () => {
  const result = await getDashboard()
  assert.equal(result.path, '/api/v1/dashboard')
  assert.equal(result.options.body, undefined)
})
test('recientes y pendientes abren el módulo y recurso correspondientes', () => {
  assert.equal(
    dashboardTarget({ target_kind: 'document', target_id: id }),
    `/documentos?documento=${id}`,
  )
  assert.equal(
    dashboardTarget({ target_kind: 'note', target_id: note }),
    `/notas-especiales?nota=${note}`,
  )
  assert.equal(
    dashboardTarget({
      target_kind: 'recovery',
      target_id: id,
      related_id: note,
    }),
    `/notas-especiales?nota=${note}&solicitud=${id}`,
  )
})
test('dashboard rechaza referencias externas o incompletas al construir enlaces', () => {
  assert.equal(
    dashboardTarget({
      target_kind: 'note',
      target_id: 'https://otro.test',
    }),
    '/notas-especiales',
  )
  assert.equal(
    dashboardTarget({
      target_kind: 'document',
      target_id: id + '&admin=true',
    }),
    '/documentos',
  )
  assert.equal(
    dashboardTarget({
      target_kind: 'recovery',
      target_id: id,
      related_id: null,
    }),
    '/notas-especiales',
  )
})
test('recientes y cargas incompletas de expedientes abren su detalle propio', () => {
  assert.equal(
    dashboardTarget({ target_kind: 'personnel_file', target_id: id }),
    `/expedientes?expediente=${id}`,
  )
})
test('referencias de expedientes inválidas vuelven al listado sin parámetros ajenos', () => {
  for (const target_id of [
    null,
    'https://otro.test',
    id + '&admin=true',
    '../documentos',
  ])
    assert.equal(
      dashboardTarget({ target_kind: 'personnel_file', target_id }),
      '/expedientes',
    )
})
