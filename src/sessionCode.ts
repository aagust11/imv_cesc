export const SESSION_CODE_PATTERN = /^[A-Z0-9]{6}$/;
export const normalizeSessionCode = (value: string) => value.trim().toUpperCase();
export function generateSessionCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  while (code.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const byte of bytes) {
      if (byte < 252) code += alphabet[byte % alphabet.length];
      if (code.length === 6) break;
    }
  }
  return code;
}
