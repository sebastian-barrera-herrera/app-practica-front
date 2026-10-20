/**
 * Cuentas en la nube con Neon Auth (Better Auth gestionado). Registro, inicio de sesión, recuperación de contraseña
 * con código por correo y gestión del perfil. La sesión se guarda en el almacén seguro; tras el primer inicio de
 * sesión la app funciona sin conexión y se reconecta cuando vuelve internet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AUTH_URL } from './config';
import { brief, CloudError, explain, readJson, request } from './http';
import { parseJwt } from './jwt';
import { loadSession, saveSession, type StoredSession } from './secure';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
}

export type AuthStatus = 'loading' | 'out' | 'in';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** La sesión no se pudo comprobar (sin internet): se usan los datos locales. */
  offline: boolean;
  // contabilidad de sincronización (ver sync.ts)
  lastCloud: string;
  lastPush: number;
  lastSyncAt: number;
}

export const useAuth = create<AuthState>()(
  persist(
    (): AuthState => ({ status: 'loading', user: null, offline: false, lastCloud: '', lastPush: 0, lastSyncAt: 0 }),
    {
      name: 'devdojo-auth-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ user: s.user, lastCloud: s.lastCloud, lastPush: s.lastPush, lastSyncAt: s.lastSyncAt }) as AuthState,
    },
  ),
);

const set = (p: Partial<AuthState>) => useAuth.setState(p);

// ───────────────────────── sesión (token) ─────────────────────────

let session: StoredSession | null = null;
/** Si la plataforma no deja leer la cabecera Set-Cookie, nos apoyamos en el almacén de cookies del sistema. */
let useJar = Platform.OS === 'web';
let jwt: { token: string; exp: number } | null = null;

const credentials = (): RequestCredentials => (useJar ? 'include' : 'omit');

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (!useJar && session) h.Cookie = `${session.name}=${session.value}`;
  return h;
}

function captureCookie(res: Response) {
  if (Platform.OS === 'web') return;
  const raw = res.headers.get('set-cookie');
  const m = raw?.match(/([A-Za-z0-9_.-]*session_token)=([^;,\s]+)/);
  if (m) {
    session = { name: m[1], value: m[2] };
    void saveSession(session);
    useJar = false;
  } else if (!session) {
    useJar = true;
  }
}

async function call(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<{ res: Response; json: any }> {
  const res = await request(`${AUTH_URL}${path}`, {
    method,
    headers: authHeaders(),
    credentials: credentials(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await readJson(res);
  return { res, json };
}

function fail(res: Response, json: any, fallback: string): never {
  throw new CloudError(json?.code ?? 'ERROR', explain(json?.code, fallback, res.status), res.status);
}

const toUser = (u: any): AuthUser => ({ id: u.id, name: u.name ?? '', email: u.email ?? '', emailVerified: !!u.emailVerified });

// ───────────────────────── acciones ─────────────────────────

export async function register(input: { name: string; email: string; password: string }): Promise<AuthUser> {
  const { res, json } = await call('/sign-up/email', { name: input.name.trim(), email: input.email.trim().toLowerCase(), password: input.password });
  if (!res.ok || !json?.user) fail(res, json, 'No pudimos crear la cuenta.');
  captureCookie(res);
  const user = toUser(json.user);
  jwt = null;
  set({ user, offline: false });
  return user;
}

export async function login(input: { email: string; password: string }): Promise<AuthUser> {
  const { res, json } = await call('/sign-in/email', { email: input.email.trim().toLowerCase(), password: input.password });
  if (!res.ok || !json?.user) fail(res, json, 'No pudimos iniciar sesión.');
  captureCookie(res);
  const user = toUser(json.user);
  jwt = null;
  set({ user, offline: false });
  return user;
}

/** Termina el inicio de sesión: trae el progreso de la nube ANTES de entrar en la app (evita parpadeos). */
export async function completeSignIn(): Promise<void> {
  const { syncNow } = await import('./sync');
  try {
    await syncNow();
  } catch {
    /* si falla (sin red), entramos igualmente y se sincronizará después */
  }
  set({ status: 'in', offline: false });
}

export async function logout(): Promise<void> {
  try {
    await call('/sign-out', {});
  } catch {
    /* sin conexión: cerramos igualmente en local */
  }
  session = null;
  jwt = null;
  await saveSession(null);
  set({ status: 'out', user: null, offline: false, lastCloud: '', lastPush: 0, lastSyncAt: 0 });
}

/** Arranque: recupera el token guardado y comprueba la sesión (tolerante a falta de conexión). */
export async function initAuth(): Promise<void> {
  const cached = useAuth.getState().user;
  session = await loadSession();
  if (Platform.OS !== 'web' && !session && cached) useJar = true;
  if (Platform.OS !== 'web' && !session && !cached) {
    set({ status: 'out', user: null });
    return;
  }
  const r = await refreshSession();
  if (r === 'offline') set({ status: cached ? 'in' : 'out', offline: !!cached });
}

/** 'ok' = sesión válida · 'expired' = hay que volver a entrar · 'offline' = no se pudo comprobar. */
export async function refreshSession(): Promise<'ok' | 'expired' | 'offline'> {
  jwt = null; // el token en caché puede ser justo lo que falló: se pide uno nuevo
  try {
    const { res, json } = await call('/get-session', undefined, 'GET');
    if (res.ok && json?.user) {
      const h = res.headers.get('set-auth-jwt');
      if (h) jwt = parseJwt(h);
      set({ status: 'in', user: toUser(json.user), offline: false });
      return 'ok';
    }
    if (res.ok) {
      // respuesta «null»: sin sesión
      session = null;
      jwt = null;
      await saveSession(null);
      set({ status: 'out', user: null, offline: false });
      return 'expired';
    }
    return 'offline';
  } catch {
    return 'offline';
  }
}

/**
 * JWT vigente para la Data API (se renueva solo). Si el servidor no reconoce la sesión con la forma actual de enviarla
 * (cookie guardada a mano o almacén de cookies del sistema), prueba la otra una vez y se queda con la que funcione.
 */
export async function getJwt(): Promise<string> {
  if (jwt && jwt.exp * 1000 - Date.now() > 90_000) return jwt.token;
  const notes: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const mode = useJar ? 'cookies del sistema' : 'cookie guardada';
    const { res, json } = await call('/get-session', undefined, 'GET');
    const h = res.headers.get('set-auth-jwt');
    notes.push(`sesión (${mode}): ${res.ok ? (json?.user ? 'válida' : 'sin sesión') : brief(res, json)}${h ? ', con jwt' : ', sin jwt'}`);
    if (h) {
      jwt = parseJwt(h);
      return h;
    }
    if (res.ok && json?.user) {
      const t = await call('/token', undefined, 'GET');
      const tok = t.json?.token as string | undefined;
      notes.push(`token: ${tok ? 'ok' : brief(t.res, t.json)}`);
      if (tok) {
        jwt = parseJwt(tok);
        return tok;
      }
      throw new CloudError('ERROR', 'No pudimos autenticarte con el servidor.', t.res.status, notes.join(' · '));
    }
    // la sesión no se reconoció: probamos la otra forma de enviarla (solo en el móvil y si hay algo que enviar)
    if (Platform.OS === 'web' || attempt === 1 || (!session && !useJar)) break;
    useJar = !useJar;
  }
  throw new CloudError('SESSION_EXPIRED', explain('SESSION_EXPIRED'), 401, notes.join(' · '));
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { res, json } = await call('/email-otp/request-password-reset', { email: email.trim().toLowerCase() });
  if (!res.ok) fail(res, json, 'No pudimos enviar el código.');
}

export async function resetPassword(input: { email: string; otp: string; password: string }): Promise<void> {
  const { res, json } = await call('/email-otp/reset-password', { email: input.email.trim().toLowerCase(), otp: input.otp.trim(), password: input.password });
  if (!res.ok) fail(res, json, 'No pudimos cambiar la contraseña.');
}

export async function changePassword(input: { current: string; next: string }): Promise<void> {
  const { res, json } = await call('/change-password', { currentPassword: input.current, newPassword: input.next, revokeOtherSessions: false });
  if (!res.ok) fail(res, json, 'No pudimos cambiar la contraseña.');
}

export async function updateName(name: string): Promise<void> {
  const { res, json } = await call('/update-user', { name: name.trim() });
  if (!res.ok) fail(res, json, 'No pudimos guardar el nombre.');
  const u = useAuth.getState().user;
  if (u) set({ user: { ...u, name: name.trim() } });
}
