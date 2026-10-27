import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64')
let source=ts.transpileModule(await readFile(new URL('../src/features/group-notes/recoveries.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText
source=source.replace(/['"]\.\.\/\.\.\/lib\/api['"]/g,JSON.stringify(url('export async function apiRequest(path,options){return {path,options}}')))
const {createRecovery,contributeRecovery,downloadRecovery,closeRecovery,recoveryKey}=await import(url(source))
test('crear vincula nota, identificador idempotente, motivo y plazo sin elegir participantes',async()=>{
 const r=await createRecovery('nota','solicitud',' Consultar acuerdo ',60)
 assert.equal(r.path,'/api/v1/group-notes/nota/recoveries')
 assert.deepEqual(JSON.parse(r.options.body),{request_id:'solicitud',reason:'Consultar acuerdo',duration_minutes:60})
})
test('aportar autoriza explícitamente esta solicitud, no envía fragmentos elegidos por el cliente',async()=>{
 const r=await contributeRecovery('solicitud','privada-cifrada','contraseña')
 assert.equal(r.path,'/api/v1/note-recoveries/solicitud/contribute')
 assert.deepEqual(JSON.parse(r.options.body),{private_key_base64:'privada-cifrada',password:'contraseña',approve:true})
})
test('descifrar y aportar son acciones distintas',async()=>{
 const r=await downloadRecovery('solicitud','privada-cifrada','contraseña')
 assert.equal(r.path,'/api/v1/note-recoveries/solicitud/recover')
 assert.equal(Object.hasOwn(JSON.parse(r.options.body),'approve'),false)
})
test('aportar usa clave histórica y recuperar usa la clave fijada en la solicitud',()=>{
 const detail={requester_key:{id:'nueva',profile_id:'usuario',fingerprint:'huella-nueva'}}
 const old=[{profile_id:'usuario',encryption_key_id:'anterior',encryption_fingerprint:'huella-anterior'}]
 assert.equal(recoveryKey(detail,old,'usuario','contribute').id,'anterior')
 assert.equal(recoveryKey(detail,old,'usuario','recover').id,'nueva')
 assert.throws(()=>recoveryKey(detail,old,'ajeno','contribute'),/No tienes una clave/)
})
test('rechazar y cancelar se dirigen a la solicitud elegida',async()=>{
 assert.equal((await closeRecovery('solicitud','reject')).path,'/api/v1/note-recoveries/solicitud/reject')
 assert.equal((await closeRecovery('solicitud','cancel')).path,'/api/v1/note-recoveries/solicitud/cancel')
})
