import assert from 'node:assert/strict';
import {startMailbox} from './mailbox-server.mjs';
const server=await startMailbox(19001);
const call=async(path,method='GET',body,secret)=>{const r=await fetch(`http://127.0.0.1:19001${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(secret?{Authorization:`Bearer ${secret}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
try{
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),secret=crypto.randomUUID(),id=crypto.randomUUID();
 const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);const publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey);
 const room='/v1/rooms/AB1234';
 assert.equal((await call(room,'PUT',{publicKey},owner)).status,200);
 assert.equal((await call(room,'PUT',{publicKey},other)).status,409);
 assert.equal((await call(room+'/poll','POST',{},other)).status,403);
 const packet={publicKey,iv:'test',data:'ciphertext'};
 assert.equal((await call(room+'/requests','POST',{id,secret,packet})).status,202);
 assert.equal((await call(room+'/requests','POST',{id,secret,packet})).status,202);
 assert.equal((await call(room+'/poll','POST',{},owner)).data.messages.length,1);
 assert.equal((await call(room+'/requests/'+id,'GET',undefined,other)).status,404);
 assert.equal((await call(room+'/requests/'+id,'GET',undefined,secret)).data.pending,true);
 assert.equal((await call(room+'/reply','POST',{id,packet},other)).status,403);
 assert.equal((await call(room+'/reply','POST',{id,packet},owner)).status,200);
 assert.deepEqual((await call(room+'/requests/'+id,'GET',undefined,secret)).data.packet,packet);
 assert.equal((await call(room+'/poll','POST',{},owner)).data.messages.length,0);
 server.sqlite.prepare('UPDATE relay_messages SET expires=?').run(Date.now()-1);
 assert.equal((await call(room+'/requests/'+id,'GET',undefined,secret)).status,404);
 assert.equal(server.sqlite.prepare('SELECT count(*) AS n FROM relay_messages').get().n,0);
 assert.equal((await call(room,'DELETE',undefined,other)).status,403);
 assert.equal((await call(room,'DELETE',undefined,owner)).status,200);
 assert.equal((await call(room)).status,404);
 console.log('PASS: mailbox authorization, code collisions, idempotent enqueue, private receipts, expiry, close');
}finally{await server.close()}
