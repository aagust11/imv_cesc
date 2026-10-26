// Real deployed HTTPS service; synthetic data only, always closes its test room.
import assert from 'node:assert/strict';
import {transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
const {code:source}=await transform(await readFile(new URL('../src/mailboxCrypto.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {createKeys,sharedKey,seal,unseal}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const base=process.env.VITE_RELAY_URL || 'https://cesc-https-relay.wittygrove17.chatgpt.site';
const owner=crypto.randomUUID(),code=crypto.randomUUID().replace(/-/g,'').slice(0,6).toUpperCase();
const path='/v1/rooms/'+code;
async function call(path,method='GET',body,token){const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw Error(`${response.status}: ${data.error}`);return data}
const teacher=await createKeys(),publicKey=await crypto.subtle.exportKey('jwk',teacher.publicKey);
try{
 await call(path,'PUT',{publicKey},owner);
 await assert.rejects(call(path+'/poll','POST',{},crypto.randomUUID()));
 const requests=await Promise.all(Array.from({length:30},async(_,i)=>{
  const student=await createKeys(),id=crypto.randomUUID(),secret=crypto.randomUUID();
  const discovered=await call(path);
  const key=await sharedKey(student.privateKey,discovered.publicKey);
  const expected={type:'sync',studentName:`Prova ${i}`,answers:{1:['Dada sintètica']}};
  const packet={...await seal(key,expected,`${code}:${id}:request`),publicKey:await crypto.subtle.exportKey('jwk',student.publicKey)};
  await call(path+'/requests','POST',{id,secret,packet});
  return {id,secret,key,expected};
 }));
 const queued=await call(path+'/poll','POST',{},owner);
 assert.equal(queued.messages.length,30);
 for(const message of queued.messages){
  const request=requests.find(r=>r.id===message.id);
  const key=await sharedKey(teacher.privateKey,message.packet.publicKey);
  assert.deepEqual(await unseal(key,message.packet,`${code}:${message.id}:request`),request.expected);
  await assert.rejects(unseal(key,message.packet,`${code}:another:request`));
  const packet=await seal(key,{ok:true,received:message.id},`${code}:${message.id}:reply`);
  await call(path+'/reply','POST',{id:message.id,packet},owner);
 }
 await Promise.all(requests.map(async request=>{
  const result=await call(path+'/requests/'+request.id,'GET',undefined,request.secret);
  assert.deepEqual(await unseal(request.key,result.packet,`${code}:${request.id}:reply`),{ok:true,received:request.id});
 }));
 assert.equal((await call(path+'/poll','POST',{},owner)).messages.length,0);
 console.log('PASS: deployed HTTPS/D1 relay, 30 encrypted requests, protected poll, authenticated encrypted receipts');
}finally{await call(path,'DELETE',undefined,owner)}
process.exit(0);
