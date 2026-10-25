import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { PeerServer } from 'peer';
import { createServer } from 'vite';
process.env.VITE_STATIC_MODE = 'true';
process.env.VITE_PEER_HOST = '127.0.0.1';
process.env.VITE_PEER_PORT = '19000';
process.env.VITE_PEER_SECURE = 'false';
process.env.VITE_ICE_SERVERS = '[]';
let signalling;
PeerServer({ port: 19000, path: '/' }, server => { signalling = server; });
const vite = await createServer({ server: { port: 15173, host: '127.0.0.1' } });
await vite.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'] });
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
  const rpc = (page, payload) => page.evaluate(async ({payload}) => {
    const {sendToAdmin} = await import('/src/liveSession.ts');
    return sendToAdmin('AB1234',payload);
  },{payload:{...payload,sessionId:session.sessionId}});
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
  const finish=student.getByRole('button',{name:'Finalitza el test',exact:true});
  assert.notEqual(await finish.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  await finish.click();
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
  assert.deepEqual(errors,[]);
} catch(error) { console.error('Browser errors:',errors); throw error; }
finally { await browser.close(); await vite.close(); signalling?.close(); }
process.exit(0);
