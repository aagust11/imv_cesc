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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection', '--force-webrtc-ip-handling-policy=default'] });
const errors = [];
try {
  const adminContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  for (const page of [admin, student]) { page.on('pageerror', e => errors.push(e.message)); }
  await admin.goto('http://127.0.0.1:15173');
  await admin.evaluate(() => {
    localStorage.setItem('cesc_admin_token', 'session-verified-token-insmollet');
    localStorage.setItem('cesc_projects_local', JSON.stringify([{
      id: 'test', title: 'Grup prova', createdAt: new Date().toISOString(),
      students: ['Alumne A', 'Alumne B'], questions: [{id: 1, text: 'Pregunta', description: 'Prova'}],
      allowSelfIdentification: true, responses: {}
    }]));
  });
  await admin.reload();
  await admin.getByRole('button', { name: 'Accés Administració', exact: true }).click();
  await admin.locator('#admin-session-code').fill('AB1234');
  await admin.getByRole('button', { name: 'Obre a respostes d’alumnes', exact: true }).click();
  await admin.getByText('Connectat · rebent respostes', { exact: true }).waitFor();
  const session = await admin.evaluate(() => JSON.parse(localStorage.getItem('cesc_active_session_local')));

  await student.goto('http://127.0.0.1:15173');
  assert.equal(await student.evaluate(() => localStorage.getItem('cesc_projects_local')), null);
  const joined = await student.evaluate(async () => {
    const {sendToAdmin} = await import('/src/liveSession.ts');
    return sendToAdmin('AB1234', { type: 'join' });
  });
  assert.equal(joined.title, 'Grup prova');
  assert.equal(joined.responses, undefined);
  const payload = { type: 'sync', sessionId: session.sessionId, studentSessionId: 'student_1', studentName: 'Alumne A', answers: {1: ['Alumne B']} };
  const send = data => student.evaluate(async payload => {
    const {sendToAdmin} = await import('/src/liveSession.ts');
    return sendToAdmin('AB1234', payload);
  }, data);
  assert.equal((await send(payload)).success, true);
  await admin.waitForFunction(() => JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses.student_1);
  assert.deepEqual(await admin.evaluate(() => JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses.student_1.answers), {1: ['Alumne B']});
  await send(payload);
  assert.equal(await admin.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).length), 1);
  await assert.rejects(send({...payload, answers: {1: ['Persona aliena']}}));
  await assert.rejects(send({...payload, sessionId: 'old-session'}));
  console.log('PASS: separate browser storage, WebRTC delivery, ACK, validation, idempotency and session isolation');

  // Coded student UI joins through the same transport, never through teacher localStorage.
  await student.getByRole('button', {name: 'Contestar Qüestionari', exact: true}).click();
  await student.locator('#form-student-join input').fill('ab1234');
  await student.getByRole('button', {name: "Entra a l'aula", exact: true}).click();
  await student.getByText('Grup prova', {exact: true}).first().waitFor();
  console.log('PASS: alphanumeric student UI joins teacher session from isolated device');

  await admin.reload();
  await admin.getByRole('button', { name: 'Accés Administració', exact: true }).click();
  await admin.getByText('Connectat · rebent respostes', {exact: true}).waitFor({timeout: 30000});
  assert.equal((await send({...payload, answers: {1: []}})).success, true);
  console.log('PASS: administration reload resumes same session and accepts answers');

  // Thirty submissions over short-lived channels, simulating a class answering concurrently.
  await Promise.all(Array.from({length: 30}, (_, i) => send({...payload, studentSessionId: `parallel_${i}`})));
  assert.equal(await admin.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cesc_projects_local'))[0].responses).length), 31);
  console.log('PASS: 30 concurrent answer submissions are all persisted');

  await admin.getByRole('button', { name: 'Tancar sessió de respostes', exact: true }).click();
  await assert.rejects(send(payload));
  assert.equal(await admin.evaluate(() => localStorage.getItem('cesc_active_session_local')), null);
  console.log('PASS: closed session rejects submissions');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
  await vite.close();
  signalling?.close();
}
