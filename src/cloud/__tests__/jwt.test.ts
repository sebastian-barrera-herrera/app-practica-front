import { parseJwt } from '../jwt';

/** base64url de un JSON en UTF-8 (sin depender de `Buffer`, que no está en los tipos de la app). */
const b64url = (o: unknown) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(o))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('parseJwt', () => {
  test('lee la caducidad', () => {
    const t = `${b64url({ alg: 'EdDSA' })}.${b64url({ sub: 'u1', name: 'Sebastián ñandú', exp: 1792377481 })}.firma`;
    expect(parseJwt(t)).toEqual({ token: t, exp: 1792377481 });
  });
  test('un token ilegible usa una caducidad corta y no falla', () => {
    const r = parseJwt('basura');
    expect(r.token).toBe('basura');
    expect(r.exp * 1000).toBeGreaterThan(Date.now());
    expect(r.exp * 1000).toBeLessThan(Date.now() + 11 * 60_000);
  });
});
