import { claimStudent } from './studentAccess';
import type { ActiveSession, CESCProject, StudentResponse } from './types';
import { SESSION_CODE_PATTERN } from './sessionCode';
import { createKeys, sharedKey, seal, unseal } from './mailboxCrypto';
const SESSION_KEY='cesc_active_session_local';
const PROJECTS_KEY='cesc_projects_local';
const notify=(message:string)=>window.dispatchEvent(new CustomEvent('cesc-live-status',{detail:message}));
export const readLiveSession=():ActiveSession|null=>JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
// Deliberately expose only a student-safe view and write-only answer submission.
export function processStudentRequest(message: any) {
  const session = readLiveSession();
  if (!session || message?.code !== session.code) throw new Error('El qüestionari està tancat o el codi no és vàlid.');
  const project = session.project;
  if (message.type === 'join') return {
    code: session.code, title: project.title, students: project.students,
    questions: project.questions, allowSelfIdentification: true,
    sessionId: session.sessionId, accessMode: project.accessMode || "shared",
  };
  const projects: CESCProject[] = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
  const stored = projects.find(p => p.id === project.id);
  if (!stored) throw new Error('El qüestionari ja no existeix.');
  const persist = () => {
    session.project = stored;
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event('cesc-live-response'));
  };
  if (message.type === 'claim') {
    if (message.sessionId !== session.sessionId) throw new Error('Torna a entrar amb el codi de la sessió actual.');
    const access = claimStudent(stored, message);
    persist();
    return access;
  }
  if (message.type !== 'sync' && message.type !== 'heartbeat') throw new Error('Petició no vàlida.');
  if (typeof message.studentSessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(message.studentSessionId) ||
      message.sessionId !== session.sessionId ||
      (message.type === 'sync' && (!message.answers || typeof message.answers !== 'object' || Array.isArray(message.answers)))) {
    throw new Error('Enviament no vàlid. Torna a entrar amb el codi.');
  }
  const name = message.studentName;
  const access = typeof name === 'string' && Object.hasOwn(stored.participation || {}, name) ? stored.participation![name] : undefined;
  if (!access || access.token !== message.token || access.deviceId !== message.deviceId || access.studentSessionId !== message.studentSessionId) {
    throw new Error('Aquest accés no està autoritzat o s’ha reiniciat. Torna a entrar al qüestionari.');
  }
  access.lastSeenAt = new Date().toISOString();
  if (message.type === 'heartbeat') {
    persist();
    return { success: true };
  }
  const answers: Record<number, string[]> = {};
  for (const [key, choices] of Object.entries(message.answers)) {
    if (!project.questions.some(q => String(q.id) === key) || !Array.isArray(choices) || choices.length > 3 ||
        choices.some(v => typeof v !== 'string' || (v !== '' && !project.students.includes(v)))) {
      throw new Error('Les respostes no coincideixen amb el qüestionari.');
    }
    answers[Number(key)] = choices;
  }
  const response: StudentResponse = {
    studentSessionId: message.studentSessionId,
    studentName: name,
    answers, updatedAt: new Date().toISOString(), lastAnswerAt: new Date().toISOString(),
  };
  const previous = stored.responses[response.studentSessionId];
  if (previous?.completedAt) {
    if (!message.completed || JSON.stringify(previous.answers) !== JSON.stringify(answers)) {
      throw new Error('Aquest alumne ja ha acabat. Només administració pot permetre tornar a contestar.');
    }
    return { success: true }; // Lost final ACK can safely be retried.
  }
  if (message.completed === true) response.completedAt = new Date().toISOString();
  stored.responses = { ...stored.responses, [response.studentSessionId]: response };
  access.updatedAt = response.updatedAt;
  persist();
  return { success: true };
}


// Both browsers contact this service with ordinary HTTPS; no WebRTC or WebSocket.
const RELAY = (import.meta.env.VITE_RELAY_URL || 'https://cesc-https-relay.wittygrove17.chatgpt.site').replace(/\/$/,'');
export async function relayRequest(path:string,method='GET',body?:unknown,token?:string) {
  const response=await fetch(`${RELAY}${path}`,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || 'El servei HTTPS no està disponible.');
  return data;
}
export async function diagnoseHttps(){await relayRequest('/health');return 'HTTPS respon. La recepció es confirma quan entra un alumne.';}
type Host={code:string;owner:string;keys:CryptoKeyPair;publicKey:JsonWebKey;stopped:boolean;timer?:ReturnType<typeof setTimeout>;replies:Map<string,unknown>};
let host:Host|null=null;
let opening:Promise<void>|null=null;
let generation=0;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export function stopHosting(closeRoom=false){
  generation++;
  const old=host;host=null;opening=null;
  if(old){old.stopped=true;clearTimeout(old.timer);if(closeRoom)void relayRequest(`/v1/rooms/${old.code}`,'DELETE',undefined,old.owner).catch(()=>{});}
  notify('Sessió tancada');
}
async function hostIdentity(code:string){
  const storageKey=`cesc_https_host_${code}`;
  const raw=sessionStorage.getItem(storageKey);
  if(raw){
    const saved=JSON.parse(raw);
    const privateKey=await crypto.subtle.importKey('jwk',saved.privateKey,{name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
    const publicKey=await crypto.subtle.importKey('jwk',saved.publicKey,{name:'ECDH',namedCurve:'P-256'},true,[]);
    return {owner:saved.owner,publicKey:saved.publicKey,keys:{privateKey,publicKey}};
  }
  const keys=await createKeys();
  const publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey);
  const owner=crypto.randomUUID();
  sessionStorage.setItem(storageKey,JSON.stringify({owner,publicKey,privateKey:await crypto.subtle.exportKey('jwk',keys.privateKey)}));
  return {owner,publicKey,keys};
}
export async function startHosting(code:string):Promise<void>{
  if(!SESSION_CODE_PATTERN.test(code))throw new Error('Codi no vàlid.');
  if(host?.code===code&&!host.stopped)return opening || Promise.resolve();
  stopHosting();
  const current=generation;
  const task=(async()=>{
    const identity=await hostIdentity(code);
    if(current!==generation)throw new Error('Obertura cancel·lada.');
    const active:Host={code,...identity,stopped:false,replies:new Map()};host=active;
    notify('Connectant per HTTPS…');
    await relayRequest(`/v1/rooms/${code}`,'PUT',{publicKey:active.publicKey},active.owner);
    if(current!==generation)return;
    notify('Connectat · rebent respostes');
    const poll=async()=>{
      if(active.stopped)return;
      try{
        const result=await relayRequest(`/v1/rooms/${code}/poll`,'POST',{},active.owner);
        if(active.stopped)return;
        for(const message of result.messages){
          if(active.stopped)break;
          let packet=active.replies.get(message.id);
          if(!packet){
            try{
              const key=await sharedKey(active.keys.privateKey,message.packet.publicKey);
              const raw=await unseal(key,message.packet,`${code}:${message.id}:request`);
              let reply;
              try{reply={ok:true,data:processStudentRequest({...raw,code})};}
              catch(error){reply={ok:false,error:error instanceof Error?error.message:'No s’ha pogut desar.'};}
              packet=await seal(key,reply,`${code}:${message.id}:reply`);
            }catch{
              // An invalid packet cannot block all other students in the queue.
              packet={iv:'invalid',data:'invalid'};
            }
            active.replies.set(message.id,packet);
            if(active.replies.size>1000)active.replies.delete(active.replies.keys().next().value!);
          }
          await relayRequest(`/v1/rooms/${code}/reply`,'POST',{id:message.id,packet},active.owner);
        }
        notify('Connectat · rebent respostes');
      }catch{
        if(!active.stopped){
          notify('Sense comunicació HTTPS · reintentant');
          // A backgrounded browser can outlive the mailbox lease. Reopen with the same identity.
          try{await relayRequest(`/v1/rooms/${code}`,'PUT',{publicKey:active.publicKey},active.owner);}catch{}
        }
      }finally{if(!active.stopped)active.timer=setTimeout(()=>void poll(),1000);}
    };
    active.timer=setTimeout(()=>void poll(),0);
  })();
  opening=task;
  try{await task;}catch(error){if(current===generation){host=null;notify(error instanceof Error?error.message:'Error HTTPS.');}throw error;}
  finally{if(current===generation)opening=null;}
}
export async function sendToAdmin(code:string,payload:object):Promise<any>{
  if(!SESSION_CODE_PATTERN.test(code))throw new Error('Codi no vàlid.');
  const room=await relayRequest(`/v1/rooms/${code}`);
  const keys=await createKeys();
  const key=await sharedKey(keys.privateKey,room.publicKey);
  const id=crypto.randomUUID(),secret=crypto.randomUUID();
  const packet={...await seal(key,payload,`${code}:${id}:request`),publicKey:await crypto.subtle.exportKey('jwk',keys.publicKey)};
  await relayRequest(`/v1/rooms/${code}/requests`,'POST',{id,secret,packet});
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    await delay(1000);
    const result=await relayRequest(`/v1/rooms/${code}/requests/${id}`,'GET',undefined,secret);
    if(result.pending)continue;
    const reply=await unseal(key,result.packet,`${code}:${id}:reply`);
    if(!reply.ok)throw new Error(reply.error);
    return reply.data;
  }
  throw new Error('Administració no ha confirmat la recepció. Mantén la pàgina oberta; es tornarà a intentar.');
}
