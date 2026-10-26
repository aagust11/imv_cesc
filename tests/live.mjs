import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { PeerServer } from 'peer';
import { createServer } from 'vite';
process.env.VITE_STATIC_MODE = 'true';
process.env.VITE_TRANSPORT ||= 'webrtc';
process.env.VITE_PEER_HOST = '127.0.0.1';
process.env.VITE_PEER_PORT = '19000';
process.env.VITE_PEER_SECURE = 'false';
process.env.VITE_ICE_SERVERS = '[]';
let signalling;
PeerServer({ port: 19000, path: '/' }, server => { signalling = server; });
const vite = await createServer({ server: { port: 15173, host: '127.0.0.1' } });
await vite.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'] });
if (process.env.CESC_BLOCK_WEBRTC === 'true') {
  const createContext=browser.newContext.bind(browser);
  browser.newContext=async(...args)=>{
    const context=await createContext(...args);
    await context.addInitScript(()=>{ window.RTCPeerConnection=class {constructor(){throw new Error('WebRTC deliberately blocked by test');}}; });
    return context;
  };
}
const errors = [];
try {
  const admin = await (await browser.newContext()).newPage();
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  const other = await (await browser.newContext()).newPage();
  for (const page of [admin, student, other]) page.on('pageerror', e => errors.push(e.message));
  await admin.goto('http://127.0.0.1:15173');
  await admin.evaluate(() => {
    localStorage.setItem('cesc_admin_token', 'session-verified-token-insmollet');
    localStorage.setItem('cesc_projects_local', JSON.stringify([{
      id: 'test', title: 'Grup prova', createdAt: new Date().toISOString(),
      students: ['Alumne A', 'Alumne B', ...Array.from({length:30},(_,i)=>`Company ${i}`)],
      questions: [{id: 1, text: 'Pregunta', description: 'Prova'}], allowSelfIdentification: true, responses: {}
    }]));
  });
  await admin.reload();
  await admin.getByRole('button', { name: 'Accés Administració', exact: true }).click();
  await admin.locator('#admin-session-code').fill('AB1234');
  await admin.getByRole('button', { name: 'Obre a respostes d’alumnes', exact: true }).click();
  await admin.getByText('Connectat · rebent respostes', { exact: true }).waitFor();
  const session = await admin.evaluate(() => JSON.parse(localStorage.getItem('cesc_active_session_local')));
  for (const page of [student,other]) await page.goto('http://127.0.0.1:15173');
  await assert.rejects(other.evaluate(async()=>{ const {startHosting}=await import('/src/liveSession.ts');await startHosting('AB1234'); }));
  console.log('PASS: occupied teacher session code is rejected');
  let groupCode='AB1234';
  let liveSessionId=session.sessionId;
  const rpc = (page, payload) => page.evaluate(async ({payload,groupCode}) => {
    const {sendToAdmin} = await import('/src/liveSession.ts');
    return sendToAdmin(groupCode,payload);
  },{payload:{...payload,sessionId:liveSessionId},groupCode});
  await student.getByRole('button', {name: 'Contestar Qüestionari', exact: true}).click();
  await student.locator('#form-student-join input').fill('ab1234');
  await student.getByRole('button', {name: "Entra a l'aula", exact: true}).click();
  await student.getByText('Grup prova', {exact: true}).first().waitFor();
  const begin = student.getByRole('button',{name:'Comença el test',exact:true});
  const background = await begin.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.notEqual(background,'rgba(0, 0, 0, 0)');
  assert.notEqual(background,'rgb(255, 255, 255)');
  await begin.click();
  await student.locator('#student-self-identify-dropdown').click();
  await student.getByText('Alumne A',{exact:true}).click();
  await student.getByRole('button',{name:'Continua cap al test',exact:true}).click();
  await student.locator('#nominacio-select-q1-0').waitFor();
  const rowA=admin.getByRole('row').filter({has:admin.getByRole('cell',{name:'Alumne A',exact:true})});
  await rowA.getByRole('cell',{name:'En curs',exact:true}).waitFor();
  await assert.rejects(rpc(other,{type:'claim',studentName:'Alumne A',deviceId:'another-device-12345'}));
  console.log('PASS: visible blue buttons, student ownership, live In progress state, second device rejected');
  await student.locator('#nominacio-select-q1-0').click();
  await student.getByText('Alumne B',{exact:true}).click();
  await studentContext.setOffline(true);
  const finish=student.getByRole('button',{name:'Revisa abans d’enviar',exact:true});
  assert.notEqual(await finish.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  await finish.click();
  await student.getByRole('heading',{name:'Revisa el qüestionari abans d’enviar-lo'}).waitFor();
  await student.getByRole('button',{name:'Confirma i envia definitivament',exact:true}).click();
  await student.getByRole('heading',{name:'Pendent de confirmació'}).waitFor();
  await studentContext.setOffline(false);
  await student.getByRole('heading',{name:'Qüestionari enregistrat!'}).waitFor({timeout:45000});
  await rowA.getByRole('cell',{name:'Acabat',exact:true}).waitFor();
  const deviceId=await student.evaluate(()=>localStorage.getItem('cesc_device_id'));
  assert.equal((await rpc(student,{type:'claim',studentName:'Alumne A',deviceId})).completed,true);
  console.log('PASS: final delivery retry, live Completed state, finished student cannot start again');

  const claimB=await rpc(other,{type:'claim',studentName:'Alumne B',deviceId:'device-student-b-123'});
  const payloadB={type:'sync',studentName:'Alumne B',deviceId:'device-student-b-123',token:claimB.token,studentSessionId:claimB.studentSessionId,answers:{1:['Alumne A']}};
  await rpc(other,payloadB);
  const rowB=admin.getByRole('row').filter({has:admin.getByRole('cell',{name:'Alumne B',exact:true})});
  await rowB.getByRole('cell',{name:'1 / 1',exact:true}).waitFor();
  assert.equal(await admin.locator('#input-single-student').isDisabled(),true);
  const lastAnswer=await admin.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).find(r=>r.studentName==='Alumne B').lastAnswerAt);
  await admin.evaluate(()=>{
    const projects=JSON.parse(localStorage.getItem('cesc_projects_local'));
    projects[0].participation['Alumne B'].lastSeenAt=new Date(Date.now()-60000).toISOString();
    const session=JSON.parse(localStorage.getItem('cesc_active_session_local'));session.project=projects[0];
    localStorage.setItem('cesc_projects_local',JSON.stringify(projects));localStorage.setItem('cesc_active_session_local',JSON.stringify(session));window.dispatchEvent(new Event('cesc-live-response'));
  });
  await rowB.getByText('Sense comunicació recent (>45 s)',{exact:false}).waitFor();
  await rpc(other,{...payloadB,type:'heartbeat'});
  await rowB.getByText('Comunicació recent',{exact:false}).waitFor();
  assert.equal(await admin.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).find(r=>r.studentName==='Alumne B').lastAnswerAt),lastAnswer);
  console.log('PASS: frozen controls, answer progress, stale communication warning and heartbeat without false answer update');
  assert.deepEqual((await rpc(other,{type:'claim',studentName:'Alumne B',deviceId:'device-student-b-123'})).answers,{1:['Alumne A']});
  await admin.reload();
  await admin.getByRole('button',{name:'Accés Administració',exact:true}).click();
  await admin.getByText('Connectat · rebent respostes',{exact:true}).waitFor({timeout:30000});
  await rpc(other,payloadB);
  await Promise.all(Array.from({length:30},async(_,i)=>{
    const deviceId=`parallel-device-${i}`;
    const studentName=`Company ${i}`;
    const access=await rpc(other,{type:'claim',studentName,deviceId});
    await rpc(other,{type:'sync',studentName,deviceId,token:access.token,studentSessionId:access.studentSessionId,answers:{1:['Alumne A']}});
  }));
  assert.equal(await admin.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).length),32);
  console.log('PASS: same-device resume, administration reload, 30 concurrent students with independent reservations');

  admin.once('dialog',d=>d.accept('Wrong name'));
  const reset=rowA.getByRole('button',{name:'Esborra i permet tornar a contestar',exact:true});
  // Wrong name triggers a second explanatory alert.
  const onAlert=d=>{if(d.type()==='alert')void d.accept()};
  admin.on('dialog',onAlert);
  await reset.click();
  await rowA.getByRole('cell',{name:'Acabat',exact:true}).waitFor();
  admin.once('dialog',d=>d.accept('Alumne A'));
  await reset.click();
  await rowA.getByRole('cell',{name:'No iniciat',exact:true}).waitFor();
  const newAccess=await rpc(other,{type:'claim',studentName:'Alumne A',deviceId:'another-device-12345'});
  assert.deepEqual(newAccess.answers,{});
  assert.equal(newAccess.completed,false);
  await rowA.getByRole('cell',{name:'En curs',exact:true}).waitFor();
  console.log('PASS: exact-name confirmation, individual deletion, reset releases device ownership');
  await admin.getByRole('button',{name:'Tancar sessió de respostes',exact:true}).click();
  await assert.rejects(rpc(other,payloadB));
  assert.equal(await admin.locator('#input-single-student').isDisabled(),false);
  await admin.evaluate(()=>localStorage.setItem('cesc_projects_local',JSON.stringify([{
    id:'private',title:'Grup privat',createdAt:new Date().toISOString(),students:['Alumne privat','Company privat'],
    questions:[{id:1,text:'Primera',description:'Prova'},{id:2,text:'Segona',description:'Prova'}],responses:{},allowSelfIdentification:true,accessMode:'individual',codePrefix:'CE'
  }])));
  await admin.reload();await admin.getByRole('button',{name:'Accés Administració',exact:true}).click();
  await admin.locator('#admin-session-code').fill('AC1234');
  await admin.getByRole('button',{name:'Obre a respostes d’alumnes',exact:true}).click();
  await admin.getByText('Connectat · rebent respostes',{exact:true}).waitFor();
  const privateSession=await admin.evaluate(()=>JSON.parse(localStorage.getItem('cesc_active_session_local')));
  liveSessionId=privateSession.sessionId;groupCode='AC1234';
  const code=privateSession.project.studentCodes['Alumne privat'];
  const downloadEvent=admin.waitForEvent('download');
  await admin.getByRole('button',{name:'Descarrega targetes NOM + CODI per imprimir',exact:true}).click();
  const download=await downloadEvent;
  const html=await readFile(await download.path(),'utf8');assert(html.includes('Alumne privat')&&html.includes(code)&&html.includes('AC1234'));
  await assert.rejects(rpc(other,{type:'claim',studentName:'Alumne privat',deviceId:'private-device-12345'}));
  await student.reload();await student.getByRole('button',{name:'Contestar Qüestionari',exact:true}).click();
  await student.locator('#form-student-join input').fill('AC1234');await student.getByRole('button',{name:"Entra a l'aula",exact:true}).click();
  await student.getByRole('button',{name:'Comença el test',exact:true}).click();
  await student.locator('#individual-student-code').fill(code);await student.getByRole('button',{name:'Continua cap al test',exact:true}).click();
  await student.getByRole('button',{name:'Següent pregunta',exact:true}).click();
  await student.getByRole('button',{name:'Revisa abans d’enviar',exact:true}).click();
  await student.getByText('0 de 2 preguntes amb resposta.',{exact:true}).waitFor();
  await student.getByRole('button',{name:'Revisa pregunta 1',exact:true}).click();
  await student.locator('#nominacio-select-q1-0').click();await student.getByText('Company privat',{exact:true}).click();
  await student.getByRole('button',{name:'Següent pregunta',exact:true}).click();await student.getByRole('button',{name:'Revisa abans d’enviar',exact:true}).click();
  await student.getByText('1 de 2 preguntes amb resposta.',{exact:true}).waitFor();
  await student.getByRole('button',{name:'Confirma i envia definitivament',exact:true}).click();
  await student.getByRole('heading',{name:'Qüestionari enregistrat!'}).waitFor();
  console.log('PASS: private codes reject name bypass, printable name/code download, blank summary, review correction and final submission');
  await admin.getByRole('button',{name:'Tancar sessió de respostes',exact:true}).click();
  assert.deepEqual(errors,[]);
} catch(error) { console.error('Browser errors:',errors); throw error; }
finally { await browser.close(); await vite.close(); signalling?.close(); }
process.exit(0);
