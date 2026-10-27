import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const api = moduleUrl('export async function apiRequest(path, options) { return {path, options} }')
const files = moduleUrl("export async function fileBase64(file) { return Buffer.from(await file.arrayBuffer()).toString('base64') }")
let portable = compile(await readFile(new URL('../src/features/documents/specialNotes.ts', import.meta.url), 'utf8'))
portable = portable.replace(/['"]\.\.\/\.\.\/lib\/api['"]/g, JSON.stringify(api))
let source = compile(await readFile(new URL('../src/features/group-notes/groupNotes.ts', import.meta.url), 'utf8'))
source = source.replace(/['"]\.\.\/\.\.\/lib\/api['"]/g, JSON.stringify(api)).replace(/['"]\.\.\/documents\/memoranda['"]/g, JSON.stringify(files)).replace(/['"]\.\.\/documents\/specialNotes['"]/g, JSON.stringify(moduleUrl(portable)))
const { groupProblem, readBackup, createNote } = await import(moduleUrl(source))
// Formato histórico: únicamente para probar la lectura de resguardos existentes.
const backupData = created => ({format:'stc-group-note-backup',version:1,note_id:created.detail.note.id,group_name:created.detail.note.group_name,participants:created.detail.participants,package:created.package,shares:created.shares,backup_receipt:created.backup_receipt})
const noteId = '40000000-0000-4000-8000-000000000001'
const people = ['10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003']
function fixture() {
  const participants = people.map((profile_id, i) => ({ profile_id, share_index: i + 1, display_name: `Persona ${i + 1}`, email: `person${i}@example.test`, group_role: 'member' }))
  const pkg = { format: 'stc-special-note', version: 1, algorithm: 'AES-256-GCM+Shamir', document_id: '0123456789abcdef0123456789abcdef', filename: 'nota.txt', media_type: 'text/plain', size: 0, share_count: 2, threshold: 2, access_mode: 'all-members', nonce_base64: 'AAAAAAAAAAAAAAAA', tag_base64: 'AAAAAAAAAAAAAAAAAAAAAA==', ciphertext_base64: '' }
  const shares = participants.map((p) => ({ profile_id: p.profile_id, share_index: p.share_index, share: JSON.stringify({ version: 1, set_id: pkg.document_id, threshold: 2, share_count: 2, secret_size: 32, x: p.share_index, y: '42' }) }))
  return { detail: { note: { id: noteId, group_name: 'Grupo' }, participants, package_header: { ...pkg, ciphertext_base64: undefined } }, package: pkg, shares, backup_receipt: 'a'.repeat(43) }
}
const asFile = (value) => new File([JSON.stringify(value)], 'nota.stcbackup.json', { type: 'application/json' })
test('grupos vacíos, demasiado grandes o con perfiles inactivos no se omiten silenciosamente', () => {
  assert.ok(groupProblem(null))
  assert.ok(groupProblem({ members: [] }))
  assert.ok(groupProblem({ members: Array.from({ length: 21 }, () => ({ is_active: true, encryption_ready: true })) }))
  assert.ok(groupProblem({ members: [{ is_active: true, encryption_ready: true }, { is_active: false }] }))
  assert.equal(groupProblem({ members: [{ is_active: true, encryption_ready: true }, { is_active: true, encryption_ready: true }] }), '')
  assert.match(groupProblem({members:[{is_active:true,encryption_ready:true},{display_name:'Camila',is_active:true,encryption_ready:false}]}), /Camila/)
})
test('el resguardo conserva asignaciones y puede reimportarse tras cerrar la página', async () => {
  const original = fixture(), data = backupData(original)
  const loaded = await readBackup(asFile(data), original.detail)
  assert.equal(loaded.noteId, noteId)
  assert.equal(loaded.receipt, original.backup_receipt)
  assert.deepEqual(loaded.shares, original.shares.map((p) => p.share))
  assert.deepEqual(loaded.package, original.package)
})
test('JSON inválido y resguardos incompletos ofrecen un error corregible', async () => {
  await assert.rejects(readBackup(new File(['{'], 'invalido.json')), /JSON válido/)
  await assert.rejects(readBackup(asFile({})), /resguardo completo/)
  const data = backupData(fixture()); data.shares.pop()
  await assert.rejects(readBackup(asFile(data)), /resguardo completo|corresponde/)
})
test('el resguardo de otra nota no confirma la seleccionada', async () => {
  const original = fixture(), data = backupData(original); data.note_id = '40000000-0000-4000-8000-000000000002'
  await assert.rejects(readBackup(asFile(data), original.detail), /otra nota/)
})
test('asignaciones repetidas, reordenadas o ajenas al snapshot son rechazadas', async () => {
  const original = fixture()
  let data = backupData(fixture()); data.shares[1].profile_id = people[0]
  await assert.rejects(readBackup(asFile(data), original.detail), /asignaciones/)
  data = backupData(fixture()); data.shares.reverse()
  await assert.rejects(readBackup(asFile(data), original.detail), /asignaciones/)
  data = backupData(fixture()); data.participants[0].profile_id = 'otra-persona'
  await assert.rejects(readBackup(asFile(data), original.detail), /participantes/)
})
test('fragmentos de otro conjunto y paquete distinto no pasan la validación estructural', async () => {
  const original = fixture(), data = backupData(original)
  const share = JSON.parse(data.shares[0].share); share.set_id = 'f'.repeat(32); data.shares[0].share = JSON.stringify(share)
  await assert.rejects(readBackup(asFile(data), original.detail), /pertenezcan/)
  const different = backupData(fixture()); different.package.document_id = 'f'.repeat(32)
  await assert.rejects(readBackup(asFile(different), original.detail), /corresponde/)
})
test('solicitud fija grupo y versión; no permite que el cliente elija el umbral', async () => {
  const result = await createNote(noteId, { id: 'grupo', version: 4 }, ' Nota ', new File(['original'], 'nota.txt', { type: 'text/plain' }))
  const payload = JSON.parse(result.options.body)
  assert.equal(payload.group_version, 4)
  assert.equal(payload.group_id, 'grupo')
  assert.equal(payload.request_id, noteId)
  assert.equal(payload.title, 'Nota')
  assert.equal(Buffer.from(payload.content_base64, 'base64').toString(), 'original')
  assert.equal(Object.hasOwn(payload, 'threshold'), false)
  assert.equal(Object.hasOwn(payload, 'participants'), false)
})
