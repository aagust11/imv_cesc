import { claimStudent } from "./studentAccess";
import Peer, { type DataConnection } from 'peerjs';
import type { ActiveSession, CESCProject, StudentResponse } from './types';
import { SESSION_CODE_PATTERN } from './sessionCode';

const SESSION_KEY = 'cesc_active_session_local';
const PROJECTS_KEY = 'cesc_projects_local';
const peerId = (code: string) => `imv-cesc-v1-${code}`;
const options = () => ({
  debug: import.meta.env.VITE_PEER_DEBUG === "true" ? 3 : 0,
  ...(import.meta.env.VITE_PEER_HOST ? {
    host: import.meta.env.VITE_PEER_HOST,
    port: Number(import.meta.env.VITE_PEER_PORT || 443),
    path: import.meta.env.VITE_PEER_PATH || '/',
    secure: import.meta.env.VITE_PEER_SECURE !== 'false',
  } : {}),
  ...(import.meta.env.VITE_ICE_SERVERS ? { config: { iceServers: JSON.parse(import.meta.env.VITE_ICE_SERVERS) } } : {}),
});
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

export function startHosting(code: string): Promise<void> {
  if (!SESSION_CODE_PATTERN.test(code)) return Promise.reject(new Error('Codi no vàlid.'));
  if (hostCode === code && host && !host.destroyed) {
    if (opening) return opening;
    if (host.open) return Promise.resolve();
    if (host.disconnected) host.reconnect();
    return Promise.reject(new Error('Reconnectant amb el servei de connexió…'));
  }
  stopHosting(); hostCode = code;
  const generation = hostGeneration;
  const peer = new Peer(peerId(code), options()); host = peer;
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

// One short-lived connection per request avoids keeping a full class of idle peers connected.
export function sendToAdmin(code: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(options());
    let connection: DataConnection | undefined;
    let finished = false;
    const finish = (error?: Error, data?: any) => {
      if (finished) return; finished = true; clearTimeout(timer);
      connection?.close(); peer.destroy();
      error ? reject(error) : resolve(data);
    };
    const timer = setTimeout(() => finish(new Error('No hi ha confirmació d’administració. Mantén aquesta pàgina oberta; es reintentarà.')), 20000);
    peer.on('error', () => finish(new Error('No es pot connectar amb administració. Comprova el codi i que tingui la consola oberta.')));
    peer.on('open', () => {
      connection = peer.connect(peerId(code), { reliable: true, serialization: 'json' });
      const id = crypto.randomUUID();
      connection.on('open', () => connection!.send({ ...payload, code, id }));
      connection.on('data', (reply: any) => {
        if (reply?.id !== id) return;
        finish(reply.ok ? undefined : new Error(reply.error), reply.data);
      });
      connection.on('error', () => finish(new Error('Connexió interrompuda.')));
      connection.on('close', () => { if (!finished) finish(new Error('Administració ha tancat la connexió.')); });
    });
  });
}
