import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
const vite=await createServer({server:{port:15174,host:'127.0.0.1'}});await vite.listen();
const browser=await chromium.launch({args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:15174');
 assert.equal(await page.evaluate(async()=>{
  const {processStudentRequest:handle}=await import('/src/liveSession.ts');
  const {resetStudent}=await import('/src/studentAccess.ts');
  const project={id:'test',title:'Test',students:['A','B'],questions:[{id:1,text:'Test'}],allowSelfIdentification:false,responses:{}};
  const save=p=>{localStorage.setItem('cesc_projects_local',JSON.stringify([p]));localStorage.setItem('cesc_active_session_local',JSON.stringify({code:'AB1234',sessionId:'new',project:p}))};save(project);
  const request=m=>handle({code:'AB1234',sessionId:'new',...m});
  const reject=m=>{let rejected=false;try{request(m)}catch{rejected=true}if(!rejected)throw Error('Invalid request accepted')};
  const view=request({type:'join'});if('responses'in view||'participation'in view||!view.allowSelfIdentification)throw Error('Unsafe join');
  const claim={type:'claim',studentName:'A',deviceId:'device_123456789'};
  const access=request(claim);
  reject({...claim,deviceId:'different-device-123'});
  const payload={type:'sync',studentName:'A',deviceId:claim.deviceId,studentSessionId:access.studentSessionId,token:access.token,answers:{1:['B']}};
  request(payload);request(payload);
  if(Object.keys(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).length!==1)throw Error('Duplicate');
  if(JSON.stringify(request(claim).answers)!==JSON.stringify(payload.answers))throw Error('Cannot resume');
  reject({...payload,token:'forged'});reject({...payload,answers:{1:['Stranger']}});
  request({...payload,completed:true});request({...payload,completed:true});
  reject({...payload,answers:{1:[]}});
  const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('Disk full')};
  let failed=false;try{request({type:'claim',studentName:'B',deviceId:'device_b_12345'})}catch{failed=true}finally{Storage.prototype.setItem=original}if(!failed)throw Error('False ACK');
  save(resetStudent(JSON.parse(localStorage.getItem('cesc_projects_local'))[0],'A'));
  reject(payload);
  const fresh=request({...claim,deviceId:'different-device-123'});if(fresh.completed||Object.keys(fresh.answers).length)throw Error('Not reset');
  reject(payload);
  localStorage.removeItem('cesc_active_session_local');reject({...payload,token:fresh.token});
  return true;
 }),true);
 console.log('PASS: one device per student, same-device resume, completed lock, revoked old token, reset releases ownership, no false ACK, safe join');
}finally{await browser.close();await vite.close()}
