import { peerOptions, reportPeerRoute } from "./peerNetwork";
import { claimStudent } from "./studentAccess";
import Peer, { type DataConnection } from 'peerjs';
import type { ActiveSession, CESCProject, StudentResponse } from './types';
import { SESSION_CODE_PATTERN } from './sessionCode';

const SESSION_KEY = 'cesc_active_session_local';
const PROJECTS_KEY = 'cesc_projects_local';
const peerId = (code: string) => `imv-cesc-v1-${code}`;
let host: Peer | null = null;
let opening: Promise<void> | null = null;
let hostCode = '';
let hostGeneration = 0;
const notify = (message: string) => window.dispatchEvent(new CustomEvent('cesc-live-status', { detail: message }));
export const readLiveSession = (): ActiveSession | null => JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
export function stopHosting() {
  hostGeneration++;
  host?.destroy(); host = null; opening = null; hostCode = '';
  notify('Sessió tancada');
}

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

export async function startHosting(code: string): Promise<void> {
  if (!SESSION_CODE_PATTERN.test(code)) return Promise.reject(new Error('Codi no vàlid.'));
  if (hostCode === code && host && !host.destroyed) {
    if (opening) return opening;
    if (host.open) return Promise.resolve();
    if (host.disconnected) host.reconnect();
    return Promise.reject(new Error('Reconnectant amb el servei de connexió…'));
  }
  stopHosting(); hostCode = code;
  const generation = hostGeneration;
  const configuration=await peerOptions();
  if(generation!==hostGeneration)throw new Error("Obertura cancel·lada.");
  const peer = new Peer(peerId(code), configuration); host = peer;
  notify('Connectant…');
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('No es pot obrir la connexió. Comprova Internet i la xarxa.')); }, 20000);
    peer.on('open', () => { clearTimeout(timer); notify('Connectat · rebent respostes'); resolve(); });
    peer.on('error', (error) => {
      const text = error.type === 'unavailable-id' ? 'Aquest codi ja està en ús en una altra administració. Tria’n un altre.' : 'Error de connexió. Comprova Internet i torna-ho a provar.';
      notify(text); clearTimeout(timer); reject(new Error(text));
    });
    peer.on('disconnected', () => {
      notify('Connexió interrompuda · reconnectant');
      setTimeout(() => { if (generation === hostGeneration && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    peer.on('connection', (connection: DataConnection) => {
      connection.on('error', () => {});
      connection.on('open',()=>void reportPeerRoute(connection));
      connection.on('data', (raw: any) => {
        if (!raw || typeof raw.id !== 'string') return;
        try {
          if (JSON.stringify(raw).length > 100000) throw new Error('Enviament massa gran.');
          const data = processStudentRequest(raw);
          connection.send({ id: raw.id, ok: true, data });
        } catch (error) {
          connection.send({ id: raw.id, ok: false, error: error instanceof Error ? error.message : 'No s’ha pogut desar.' });
        }
      });
    });
  });
  opening = ready;
  void ready.finally(() => { if (generation === hostGeneration) opening = null; }).catch(() => {});
  return ready;
}

// Keep the data channel alive across answers/heartbeats; renegotiate only after a real disconnect.
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
type ClientLink={connection:DataConnection;ready:Promise<DataConnection>;rejectOpen:(error:Error)=>void;pending:Map<string,Pending>};
let studentPeer:Peer|null=null;
let studentPeerReady:Promise<Peer>|null=null;
const clientLinks=new Map<string,ClientLink>();
function failLink(code:string,error:Error){
  const link=clientLinks.get(code);if(!link)return;
  clientLinks.delete(code);link.rejectOpen(error);
  for(const pending of link.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
  link.pending.clear();link.connection.close();
}
async function getStudentPeer():Promise<Peer>{
  if(studentPeerReady&&(!studentPeer||!studentPeer.destroyed))return studentPeerReady;
  studentPeerReady=(async()=>{
    const peer=new Peer(await peerOptions());studentPeer=peer;
    return new Promise<Peer>((resolve,reject)=>{
      const timer=setTimeout(()=>{peer.destroy();reject(new Error('No es pot contactar amb la senyalització WebRTC.'));},20000);
      peer.on('open',()=>{clearTimeout(timer);resolve(peer);});
      peer.on('error',error=>{
        clearTimeout(timer);reject(error);
        for(const code of [...clientLinks.keys()])failLink(code,new Error('No es pot connectar amb administració. Comprova el codi i la consola oberta.'));
        if(peer.destroyed){studentPeer=null;studentPeerReady=null;}
      });
      peer.on('disconnected',()=>{if(!peer.destroyed)setTimeout(()=>{if(peer.disconnected&&!peer.destroyed)peer.reconnect();},1000);});
      peer.on('close',()=>{
        if(studentPeer===peer){studentPeer=null;studentPeerReady=null;}
        for(const code of [...clientLinks.keys()])failLink(code,new Error('Connexió interrompuda. Es tornarà a intentar.'));
      });
    });
  })();
  return studentPeerReady;
}
async function connectionToAdmin(code:string):Promise<DataConnection>{
  const existing=clientLinks.get(code);if(existing)return existing.ready;
  const peer=await getStudentPeer();
  // Another answer may have finished opening the same link while the peer was joining.
  const raced=clientLinks.get(code);if(raced)return raced.ready;
  const connection=peer.connect(peerId(code),{reliable:true,serialization:'json'});
  const link:ClientLink={connection,pending:new Map(),ready:Promise.resolve(connection),rejectOpen:()=>{}};
  clientLinks.set(code,link);
  link.ready=new Promise<DataConnection>((resolve,reject)=>{
    link.rejectOpen=reject;
    const timer=setTimeout(()=>failLink(code,new Error('La xarxa no permet completar WebRTC. Pot caldre un relé TURN accessible per TCP/TLS 443.')),25000);
    connection.on('open',()=>{clearTimeout(timer);void reportPeerRoute(connection);resolve(connection);});
    connection.on('error',()=>{clearTimeout(timer);failLink(code,new Error('Ha fallat la connexió entre els dispositius.'));});
    connection.on('close',()=>{clearTimeout(timer);failLink(code,new Error('Administració ha tancat la connexió.'));});
    connection.on('data',(reply:any)=>{
      const pending=link.pending.get(reply?.id);if(!pending)return;
      clearTimeout(pending.timer);link.pending.delete(reply.id);
      reply.ok?pending.resolve(reply.data):pending.reject(new Error(reply.error));
    });
  });
  return link.ready;
}
export async function sendToAdmin(code:string,payload:object):Promise<any>{
  const connection=await connectionToAdmin(code);
  const link=clientLinks.get(code);
  if(!link||!connection.open)throw new Error('Connexió interrompuda. Es tornarà a intentar.');
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>{
      link.pending.delete(id);
      reject(new Error('Administració no ha confirmat la recepció. Mantén la pàgina oberta.'));
      failLink(code,new Error('La connexió ha caducat. Es tornarà a obrir.'));
    },20000);
    link.pending.set(id,{resolve,reject,timer});
    try{connection.send({...payload,code,id});}
    catch{clearTimeout(timer);link.pending.delete(id);reject(new Error('No s’ha pogut enviar. Es tornarà a intentar.'));failLink(code,new Error('Connexió interrompuda.'));}
  });
}
