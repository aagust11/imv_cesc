import type { CESCProject } from './types';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const codeLengthForCount = (count: number) => count >= 0.7 * CODE_ALPHABET.length ** 4 ? 8 : 6;
export function ensureStudentCodes(project: CESCProject): CESCProject {
  if (project.accessMode !== 'individual') return project;
  if (new Set(project.students).size !== project.students.length) throw new Error('Hi ha noms repetits. Diferencia’ls abans de generar els codis.');
  const prefix = (project.codePrefix || 'CE').trim().toUpperCase();
  if (prefix.length !== 2 || [...prefix].some(c => !CODE_ALPHABET.includes(c))) throw new Error('El prefix ha de tenir 2 lletres o números, sense 0, O, 1, I ni L.');
  const required = codeLengthForCount(project.students.length);
  // Once extended, retain 8-character codes so existing printed cards stay valid.
  const length = Math.max(required, ...Object.values(project.studentCodes || {}).map(c => c.length)) === 8 ? 8 : 6;
  const codes: Record<string,string> = {};
  const used = new Set<string>();
  for (const name of project.students) {
    let code = project.studentCodes?.[name];
    if (!code || code.length !== length || !code.startsWith(prefix) || [...code].some(c => !CODE_ALPHABET.includes(c)) || used.has(code)) {
      do {
        let suffix = '';
        while (suffix.length < length - 2) {
          for (const n of crypto.getRandomValues(new Uint8Array(16))) {
            if (n < Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length) suffix += CODE_ALPHABET[n % CODE_ALPHABET.length];
            if (suffix.length === length - 2) break;
          }
        }
        code = prefix + suffix;
      } while (used.has(code));
    }
    codes[name] = code; used.add(code);
  }
  return { ...project, codePrefix:prefix, studentCodes:codes };
}

export const configurationSignature = (p: CESCProject) => JSON.stringify({
  title:p.title, students:p.students, questions:p.questions,
  allowSelfIdentification:p.allowSelfIdentification, accessMode:p.accessMode || "shared", codePrefix:p.codePrefix || "CE", studentCodes:p.studentCodes || {},
});
export function configurationIsFrozen(current: CESCProject, updated: CESCProject) {
  return configurationSignature(current) !== configurationSignature(updated);
}
export const answeredQuestions = (p: CESCProject, answers: Record<number,string[]> = {}) =>
  p.questions.filter(q => (answers[q.id] || []).some(name => name.trim().length > 0)).length;

export function studentCodeSheet(project: CESCProject, groupCode?: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const url = location.href.split('#')[0];
  return `<!doctype html><html lang="ca"><meta charset="utf-8"><title>Codis individuals CESC</title>
  <style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#0f172a;margin:0}h1{font-size:20px}button{padding:10px;background:#1d4ed8;color:white;border:0;cursor:pointer}.cards{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.card{border:1px dashed #64748b;padding:6mm;break-inside:avoid}.name{font-size:17px;font-weight:bold}.code{font-size:26px;font-family:monospace;font-weight:bold;letter-spacing:3px;margin:10px 0}p{font-size:12px;overflow-wrap:anywhere}.note{font-size:11px}@media print{button,.screen{display:none}}</style>
  <h1>${esc(project.title)} · Codis individuals</h1><p class="screen">Imprimeix i retalla les targetes. Dona a cada alumne només la seva.</p><button onclick="window.print()">Imprimeix / Desa en PDF</button><p></p><div class="cards">${project.students.map(name => `<div class="card"><div class="name">${esc(name)}</div><p>Codi individual:</p><div class="code">${esc(project.studentCodes?.[name] || '')}</div><p>${esc(url)}</p><p>${groupCode ? `Codi del grup: <strong>${esc(groupCode)}</strong>` : 'Demana al professorat el codi del grup.'}</p><p class="note">Entra al portal d’alumnes amb el codi del grup i després amb aquest codi individual. Conserva’l i no el comparteixis.</p></div>`).join('')}</div></html>`;
}
