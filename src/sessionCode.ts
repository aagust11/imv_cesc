export const SESSION_CODE_PATTERN = /^[A-Z0-9]{6}$/;
export const normalizeSessionCode = (value: string) => value.trim().toUpperCase();
export function generateSessionCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  while (code.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const byte of bytes) {
      if (byte < Math.floor(256 / alphabet.length) * alphabet.length) code += alphabet[byte % alphabet.length];
      if (code.length === 6) break;
    }
  }
  return code;
}
