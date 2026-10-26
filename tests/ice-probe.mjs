import {chromium} from '@playwright/test';
import {createServer} from 'vite';
delete process.env.VITE_TURN_TLS_ONLY;
const vite=await createServer({server:{port:15176,host:'127.0.0.1'}});await vite.listen();
const browser=await chromium.launch({args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:15176');
 const result=await page.evaluate(async()=>{
  const {defaultIceServers}=await import('/src/peerNetwork.ts');
  const pc=new RTCPeerConnection({iceServers:await defaultIceServers(),iceTransportPolicy:'relay'});
  const result={candidates:[],errors:[]};
  pc.onicecandidate=e=>{if(e.candidate)result.candidates.push({type:e.candidate.type,protocol:e.candidate.protocol,relayProtocol:e.candidate.relayProtocol,url:e.url})};
  pc.onicecandidateerror=e=>result.errors.push({url:e.url,code:e.errorCode,text:e.errorText});
  pc.createDataChannel('probe');await pc.setLocalDescription(await pc.createOffer());
  await new Promise(resolve=>setTimeout(resolve,18000));pc.close();return result;
 });
 console.log('TURN candidate diagnostics (no credentials):',JSON.stringify(result));
}finally{await browser.close();await vite.close()}
