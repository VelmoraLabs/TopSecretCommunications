import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const url = s => 'data:text/javascript;base64,'+Buffer.from(s).toString('base64')
let source = ts.transpileModule(await readFile(new URL('../src/features/group-notes/encryptionKeys.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText
source=source.replace(/['"]\.\.\/\.\.\/lib\/api['"]/g,JSON.stringify(url('export async function apiRequest(path, options) { return {path,options} }')))
const {privateKeyData,readPrivateKey,generateEncryptionKey,activateEncryptionKey}=await import(url(source))
const key={id:'50000000-0000-4000-8000-000000000001',profile_id:'10000000-0000-4000-8000-000000000002',fingerprint:'a'.repeat(64)}
const generated={key,private_base64:'QUJDRA=='}
const file=value=>new File([JSON.stringify(value)],'clave.stckey.json')
test('el respaldo de cifrado identifica propósito, perfil, clave y huella sin contraseña',async()=>{
 const data=privateKeyData(generated)
 assert.equal(data.purpose,'group-note-share-custody')
 assert.equal(Object.hasOwn(data,'password'),false)
 assert.deepEqual(await readPrivateKey(file(data),key),data)
})
test('claves de otro perfil, generación y huella no se confunden',async()=>{
 for(const field of ['profile_id','key_id','fingerprint']) {
   const data={...privateKeyData(generated),[field]:'otro'}
   await assert.rejects(readPrivateKey(file(data),key),/otro perfil|generación/)
 }
})
test('una clave de firma, JSON malformado o formato distinto da un error útil',async()=>{
 await assert.rejects(readPrivateKey(new File(['QUJDRA=='],'firma.txt'),key),/stckey/)
 await assert.rejects(readPrivateKey(file({...privateKeyData(generated),purpose:'signing'}),key),/clave de firma/)
 await assert.rejects(readPrivateKey(file(null),key),/no es válido/)
})
test('archivos excesivos y contenidos privados Base64 inválidos se rechazan',async()=>{
 await assert.rejects(readPrivateKey(new File(['A'.repeat(32769)],'grande.json'),key),/32 KiB/)
 for(const private_base64 of ['', '***', 'A'.repeat(16385)]) await assert.rejects(readPrivateKey(file({...privateKeyData(generated),private_base64}),key),/no es válido/)
})
test('la generación envía solo nombre y contraseña, nunca una identidad elegida por el cliente',async()=>{
 const response=await generateEncryptionKey(' Clave ','clave-segura-123')
 assert.equal(response.path,'/api/v1/encryption-keys')
 assert.deepEqual(JSON.parse(response.options.body),{label:'Clave',password:'clave-segura-123'})
})
test('activar usa el identificador explícito y la privada cifrada seleccionada',async()=>{
 const response=await activateEncryptionKey(key.id,generated.private_base64,'clave-segura-123')
 assert.equal(response.path,`/api/v1/encryption-keys/${key.id}/activate`)
 assert.deepEqual(JSON.parse(response.options.body),{private_key_base64:generated.private_base64,password:'clave-segura-123'})
})
