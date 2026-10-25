import type { CESCProject } from './types';

export function claimStudent(project: CESCProject, message: any) {
  const name = message.studentName;
  if (typeof name !== 'string' || !project.students.includes(name) ||
      typeof message.deviceId !== 'string' || !/^[a-zA-Z0-9_-]{10,100}$/.test(message.deviceId)) {
    throw new Error('Selecciona un alumne vàlid.');
  }
  const existing = Object.hasOwn(project.participation || {}, name) ? project.participation![name] : undefined;
  if (existing && existing.deviceId !== message.deviceId) {
    throw new Error('Aquest alumne ja ha començat en un altre dispositiu. Demana al professorat que en reiniciï la participació.');
  }
  if (!existing && Object.values(project.responses || {}).some(r => r.studentName === name)) {
    throw new Error('Aquest alumne ja té respostes registrades. Administració les ha de reiniciar per permetre un nou accés.');
  }
  const access = existing || {
    deviceId: message.deviceId, studentSessionId: 'stud_' + crypto.randomUUID(),
    token: crypto.randomUUID(), updatedAt: new Date().toISOString(),
  };
  project.participation = { ...project.participation, [name]: access };
  project.responses ||= {};
  project.responses[access.studentSessionId] ||= {
    studentSessionId: access.studentSessionId, studentName: name, answers: {}, updatedAt: access.updatedAt,
  };
  const response = project.responses[access.studentSessionId];
  return { ...access, answers: response.answers, completed: !!response.completedAt };
}

export function resetStudent(project: CESCProject, name: string): CESCProject {
  const participation = { ...project.participation };
  delete participation[name];
  return { ...project, participation, responses: Object.fromEntries(
    Object.entries(project.responses || {}).filter(([, response]) => response.studentName !== name)
  ) };
}
