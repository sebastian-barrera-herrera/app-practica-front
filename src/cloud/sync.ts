/**
 * Sincronización del progreso con la nube (Neon Data API, tabla `progress` protegida con RLS).
 * Local primero: la app funciona sin conexión y sincroniza en segundo plano cuando hay red.
 * Cada dispositivo fusiona sin perder nada (ver `merge.ts`), así que dos móviles distintos conviven.
 */
import { AppState } from 'react-native';
import { create } from 'zustand';
import { initialRoot, ROOT_VERSION, type RootState } from '@/game/root';
import { useGame } from '@/game/store';
import { getJwt, refreshSession, useAuth } from './auth';
import { API_URL } from './config';
import { CloudError, explain, readJson, request } from './http';
import { joinRoot, mergeRoots, sameProgress, splitRoot, type Parts, type Scope } from './merge';

export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'offline' | 'error';

export const useSync = create<{ phase: SyncPhase; error: string | null }>(() => ({ phase: 'idle', error: null }));
const setPhase = (phase: SyncPhase, error: string | null = null) => useSync.setState({ phase, error });

interface Row {
  scope: Scope;
  data: any;
  client_ts: number;
  updated_at: string;
}

const rootOf = (): RootState => {
  const s = useGame.getState();
  // quita las acciones: solo el estado
  const { xp, streak, dailyXp, achievements, settings, surprise, active, courses, study, goalDays, goalBonus, owner, updatedAt } = s;
  return { xp, streak, dailyXp, achievements, settings, surprise, active, courses, study, goalDays, goalBonus, owner, updatedAt };
};

async function api(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
  const token = await getJwt();
  const { prefer, headers, ...rest } = init;
  return request(`${API_URL}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    timeoutMs: 20000,
  });
}

async function pull(): Promise<Row[]> {
  const res = await api('/progress?select=scope,data,client_ts,updated_at');
  const json = await readJson<Row[] | { message?: string }>(res);
  if (!res.ok || !Array.isArray(json)) throw new CloudError('ERROR', explain(undefined, 'No pudimos leer tu progreso de la nube.', res.status), res.status);
  return json;
}

async function push(root: RootState): Promise<Row[]> {
  const parts = splitRoot(root);
  const body = (Object.keys(parts) as Scope[]).map((scope) => ({ scope, data: { ...parts[scope], _v: ROOT_VERSION }, client_ts: root.updatedAt }));
  const res = await api('/progress?on_conflict=user_id,scope', { method: 'POST', body: JSON.stringify(body), prefer: 'resolution=merge-duplicates,return=representation' });
  const json = await readJson<Row[]>(res);
  if (!res.ok || !Array.isArray(json)) throw new CloudError('ERROR', explain(undefined, 'No pudimos guardar tu progreso en la nube.', res.status), res.status);
  return json;
}

const maxStr = (rows: Row[]) => rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
const maxTs = (rows: Row[]) => rows.reduce((m, r) => Math.max(m, r.client_ts), 0);

function remoteRoot(rows: Row[], owner: string): RootState {
  const parts: Parts = {};
  for (const r of rows) parts[r.scope] = r.data;
  return joinRoot(parts, owner, maxTs(rows));
}

let running: Promise<'ok' | 'offline' | 'error'> | null = null;

/** Sincroniza ahora. Seguro llamarlo varias veces seguidas (las llamadas se encadenan). */
export function syncNow(): Promise<'ok' | 'offline' | 'error'> {
  if (running) return running;
  running = doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync(): Promise<'ok' | 'offline' | 'error'> {
  const auth = useAuth.getState();
  if (!auth.user) return 'ok';
  const userId = auth.user.id;
  setPhase('syncing');
  try {
    let rows: Row[];
    try {
      rows = await pull();
    } catch (e) {
      // sesión caducada ⇒ intentamos renovarla una vez
      if (e instanceof CloudError && (e.code === 'SESSION_EXPIRED' || e.status === 401)) {
        const r = await refreshSession();
        if (r !== 'ok') throw e;
        rows = await pull();
      } else throw e;
    }
    const local = rootOf();
    const sameOwner = local.owner === null || local.owner === userId;
    const mine: RootState = sameOwner ? local : { ...initialRoot(), owner: null };
    const cloudUpdated = maxStr(rows);
    let finalRoot = mine;

    if (rows.length === 0) {
      finalRoot = { ...mine, owner: userId };
      const out = await push(finalRoot);
      useAuth.setState({ lastCloud: maxStr(out), lastPush: finalRoot.updatedAt, lastSyncAt: Date.now() });
    } else if (cloudUpdated !== auth.lastCloud || !sameOwner) {
      const remote = remoteRoot(rows, userId);
      const merged = mergeRoots(mine, remote);
      finalRoot = { ...merged, owner: userId, updatedAt: Math.max(merged.updatedAt, mine.updatedAt, remote.updatedAt) };
      let lastCloud = cloudUpdated;
      if (!sameProgress(finalRoot, remote)) {
        // la copia local aportaba algo: subimos la fusión
        finalRoot = { ...finalRoot, updatedAt: Date.now() };
        lastCloud = maxStr(await push(finalRoot));
      }
      useAuth.setState({ lastCloud, lastPush: finalRoot.updatedAt, lastSyncAt: Date.now() });
    } else if (local.updatedAt > auth.lastPush) {
      finalRoot = { ...local, owner: userId };
      const out = await push(finalRoot);
      useAuth.setState({ lastCloud: maxStr(out), lastPush: finalRoot.updatedAt, lastSyncAt: Date.now() });
    } else {
      useAuth.setState({ lastSyncAt: Date.now() });
    }

    if (finalRoot !== local && (!sameProgress(finalRoot, local) || finalRoot.owner !== local.owner)) {
      const keepSandbox = sameOwner;
      useGame.getState().replaceRoot({
        ...finalRoot,
        courses: keepSandbox ? { linux: { ...finalRoot.courses.linux, sandbox: local.courses.linux.sandbox }, python: { ...finalRoot.courses.python, sandbox: local.courses.python.sandbox } } : finalRoot.courses,
      });
    } else if (local.owner !== userId) {
      useGame.getState().setOwner(userId);
    }
    // el nombre de la cuenta manda sobre el de los ajustes
    const name = useAuth.getState().user?.name;
    if (name && useGame.getState().settings.name !== name) useGame.getState().setSettings({ name });
    setPhase('ok');
    return 'ok';
  } catch (e) {
    if (e instanceof CloudError && e.code === 'OFFLINE') {
      setPhase('offline');
      return 'offline';
    }
    setPhase('error', e instanceof Error ? e.message : 'Error de sincronización');
    return 'error';
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Sincroniza tras cambios (con retardo), al volver a la app y cada pocos minutos. */
export function startAutoSync(): () => void {
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (useAuth.getState().status === 'in') void syncNow();
    }, ms);
  };
  let lastSeen = useGame.getState().updatedAt;
  const unsubGame = useGame.subscribe((s) => {
    if (s.updatedAt !== lastSeen) {
      lastSeen = s.updatedAt;
      schedule(8000);
    }
  });
  const unsubAuth = useAuth.subscribe((s, prev) => {
    if (s.status === 'in' && prev.status !== 'in') schedule(500);
  });
  const sub = AppState.addEventListener('change', (st) => {
    if (st === 'active') schedule(1500);
    else if (useAuth.getState().status === 'in') {
      if (timer) clearTimeout(timer);
      timer = null;
      void syncNow();
    }
  });
  const iv = setInterval(() => {
    if (AppState.currentState === 'active' && useAuth.getState().status === 'in') void syncNow();
  }, 5 * 60_000);
  if (useAuth.getState().status === 'in') schedule(1000);
  return () => {
    unsubGame();
    unsubAuth();
    sub.remove();
    clearInterval(iv);
    if (timer) clearTimeout(timer);
  };
}

/** Tras «borrar mi progreso»: sustituye lo que hay en la nube por el estado local (sin fusionar). */
export async function pushReplace(): Promise<boolean> {
  const auth = useAuth.getState();
  if (!auth.user) return false;
  try {
    const root = { ...rootOf(), owner: auth.user.id, updatedAt: Date.now() };
    const out = await push(root);
    useAuth.setState({ lastCloud: maxStr(out), lastPush: root.updatedAt, lastSyncAt: Date.now() });
    useGame.getState().replaceRoot({ ...useGame.getState(), ...root });
    return true;
  } catch {
    return false;
  }
}
