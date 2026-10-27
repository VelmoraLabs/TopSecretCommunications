import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64')
test('actualizaciones solo de metadatos propios; conciliación y cierre de suscripción',async()=>{
 const names=['window','document','setInterval','clearInterval','setTimeout','clearTimeout']
 const original=Object.fromEntries(names.map(k=>[k,globalThis[k]]))
 const events=[],removed=[],listeners=new Map();let cleanup,interval,refreshes=0
 const channel={on(type,filter,callback){events.push({type,filter,callback});return this},subscribe(callback){callback('SUBSCRIBED');return this}}
 globalThis.__recoveryHook={useEffect:fn=>{cleanup=fn()},useState:()=>[false,()=>{}],getSupabase:()=>({channel:()=>channel,realtime:{setAuth:async()=>{}},removeChannel:async c=>removed.push(c)}),useAuth:()=>({session:{access_token:'token-test'}})}
 globalThis.window={addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}
 globalThis.document={visibilityState:'visible',addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}
 globalThis.setInterval=(fn,ms)=>{assert.equal(ms,5000);interval=fn;return 1};globalThis.clearInterval=()=>{}
 globalThis.setTimeout=fn=>{fn();return 1};globalThis.clearTimeout=()=>{}
 try{
 let source=ts.transpileModule(await readFile(new URL('../src/features/group-notes/useRecoveryUpdates.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText
 source=source.replace(/import[^;]+from ['"]react['"];?/,'const {useEffect,useState}=globalThis.__recoveryHook;').replace(/import[^;]+from ['"]\.\.\/\.\.\/lib\/supabase['"];?/,'const {getSupabase}=globalThis.__recoveryHook;').replace(/import[^;]+from ['"]\.\.\/auth\/auth['"];?/,'const {useAuth}=globalThis.__recoveryHook;')
 const {useRecoveryUpdates}=await import(url(source));useRecoveryUpdates('nota-uno',()=>refreshes++)
 assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.filter.event),['INSERT','UPDATE'])
 assert.ok(events.every(e=>e.filter.table==='stc_note_recoveries'&&e.filter.filter==='note_id=eq.nota-uno'))
 const before=refreshes;interval();assert.equal(refreshes,before+1)
 cleanup();assert.deepEqual(removed,[channel]);assert.equal(listeners.size,0)
 const after=refreshes;events[0].callback();assert.equal(refreshes,after)
 }finally{Object.assign(globalThis,original);delete globalThis.__recoveryHook}
})
