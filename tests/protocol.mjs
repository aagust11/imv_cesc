import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
const vite = await createServer({server:{port:15174,host:'127.0.0.1'}}); await vite.listen();
const browser = await chromium.launch({args:['--no-sandbox']});
try {
  const page=await browser.newPage(); await page.goto('http://127.0.0.1:15174');
  const result=await page.evaluate(async()=>{
    const {processStudentRequest}=await import('/src/liveSession.ts');
    const project={id:'test',title:'Test',students:['A','B'],questions:[{id:1,text:'Test'}],allowSelfIdentification:true,responses:{}};
    localStorage.setItem('cesc_projects_local',JSON.stringify([project]));
    localStorage.setItem('cesc_active_session_local',JSON.stringify({code:'AB1234',sessionId:'new',project}));
    const request={code:'AB1234',type:'sync',sessionId:'new',studentSessionId:'s1',studentName:'A',answers:{1:['B']}};
    const view=processStudentRequest({type:'join',code:'AB1234'});
    if ('responses' in view) throw Error('Responses leaked');
    processStudentRequest(request); processStudentRequest(request);
    if(Object.keys(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).length!==1) throw Error('Duplicate record');
    for(let i=0;i<30;i++) processStudentRequest({...request,studentSessionId:'s'+i});
    if(Object.keys(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).length!==30) throw Error('Lost record');
    for(const bad of [{...request,sessionId:'old'},{...request,answers:{1:['stranger']}},{...request,code:'WRONG1'},{...request,type:'read-responses'}]) {
      let rejected=false;try{processStudentRequest(bad)}catch{rejected=true}if(!rejected)throw Error('Invalid request accepted');
    }
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(){throw Error('Disk full')};
    let rejected=false;try{processStudentRequest(request)}catch{rejected=true}finally{Storage.prototype.setItem=original}
    if(!rejected)throw Error('False ACK on storage failure');
    localStorage.removeItem('cesc_active_session_local');
    let closed=false;try{processStudentRequest(request)}catch{closed=true}if(!closed)throw Error('Closed session accepted');
    return true;
  });
  assert.equal(result,true); console.log('PASS: student-safe payload, durable receiver writes, idempotency, 30 records, invalid requests, closed session, no ACK on storage failure');
} finally {await browser.close();await vite.close()}
