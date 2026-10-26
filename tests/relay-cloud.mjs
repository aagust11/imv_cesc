// Real hosted relay smoke test; synthetic data only, no database writes.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
process.env.VITE_TRANSPORT='relay';
delete process.env.VITE_RELAY_URL;delete process.env.VITE_RELAY_PUBLISHABLE_KEY;
const vite=await createServer({server:{host:'127.0.0.1',port:15175}});await vite.listen();
const browser=await chromium.launch({args:['--no-sandbox']});
let admin;
try{
 admin=await(await browser.newContext()).newPage();
 const student=await(await browser.newContext()).newPage();
 for(const page of [admin,student]){
  page.on('console',message=>{if(message.type()==='error')console.log('Browser:',message.text())});
  await page.addInitScript(()=>{window.RTCPeerConnection=class{constructor(){throw Error('WebRTC is disabled')}}});
  await page.goto('http://127.0.0.1:15175');
 }
 const code='T'+Math.random().toString(36).slice(2,7).toUpperCase();
 await admin.evaluate(async code=>{
  const project={id:'relay-probe',title:'CESC transport test',students:['Synthetic participant'],questions:[{id:1,text:'Test',description:'Synthetic'}],responses:{},allowSelfIdentification:true};
  localStorage.setItem('cesc_projects_local',JSON.stringify([project]));
  localStorage.setItem('cesc_active_session_local',JSON.stringify({code,sessionId:'cloud-probe',project}));
  const {startHosting}=await import('/src/liveSession.ts');await startHosting(code);
 },code);
 const result=await student.evaluate(async code=>{
  const {sendToAdmin}=await import('/src/liveSession.ts');
  const joined=await sendToAdmin(code,{type:'join'});
  const access=await sendToAdmin(code,{type:'claim',sessionId:joined.sessionId,studentName:'Synthetic participant',deviceId:'synthetic-device-12345'});
  return sendToAdmin(code,{type:'sync',sessionId:joined.sessionId,studentName:'Synthetic participant',deviceId:'synthetic-device-12345',studentSessionId:access.studentSessionId,token:access.token,answers:{1:[]},completed:true});
 },code);
 assert.equal(result.success,true);
 assert.equal(await admin.evaluate(()=>!!Object.values(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses)[0].completedAt),true);
 console.log('PASS: real hosted WSS relay, two isolated browsers, WebRTC disabled, encrypted submission persisted and acknowledged');
}finally{
 if(admin)await admin.evaluate(async()=>{const {stopHosting}=await import('/src/liveSession.ts');stopHosting()}).catch(()=>{});
 await browser.close();await vite.close();
}
