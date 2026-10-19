/** Utilidades para leer un JWT (solo para conocer su caducidad; la verificación la hace el servidor). */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64urlDecode(s: string): string {
  const str = s.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const ch of str) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(escape(out));
  } catch {
    return out;
  }
}

export function parseJwt(token: string): { token: string; exp: number } {
  try {
    const payload = JSON.parse(b64urlDecode(token.split('.')[1]));
    return { token, exp: Number(payload.exp) || Math.floor(Date.now() / 1000) + 600 };
  } catch {
    return { token, exp: Math.floor(Date.now() / 1000) + 600 };
  }
}
