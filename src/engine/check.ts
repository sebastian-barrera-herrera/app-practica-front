/**
 * Comprobaciones declarativas para los retos de terminal: estado del sistema
 * de archivos, salida del último comando, comandos usados, etc.
 */
import type { Terminal } from './terminal';

export type Check =
  | { t: 'cwd'; path: string }
  | { t: 'exists'; path: string; kind?: 'file' | 'dir' | 'link' }
  | { t: 'missing'; path: string }
  | { t: 'content'; path: string; equals?: string; includes?: string | string[]; matches?: string; lines?: number; notIncludes?: string }
  | { t: 'mode'; path: string; mode: string }
  | { t: 'owner'; path: string; user?: string; group?: string }
  | { t: 'link'; path: string; target?: string; hard?: boolean }
  | { t: 'output'; includes?: string | string[]; equals?: string; matches?: string; notIncludes?: string; stderr?: boolean; any?: boolean }
  | { t: 'ran'; matches: string }
  | { t: 'used'; cmd: string; flags?: string[] }
  | { t: 'env'; name: string; value?: string }
  | { t: 'alias'; name: string; value?: string }
  | { t: 'func'; name: string }
  | { t: 'proc'; matches: string; running: boolean }
  | { t: 'job'; state: 'running' | 'stopped' | 'any' }
  | { t: 'pkg'; name: string; installed: boolean }
  | { t: 'service'; name: string; state?: 'active' | 'inactive' | 'failed'; enabled?: boolean }
  | { t: 'user'; name: string; exists: boolean; groups?: string[]; shell?: string }
  | { t: 'group'; name: string; exists: boolean; member?: string }
  | { t: 'whoami'; user: string }
  | { t: 'crontab'; includes: string; user?: string }
  | { t: 'status'; code: number }
  | { t: 'file-count'; dir: string; count: number; cmp?: 'eq' | 'gte' | 'lte' }
  | { t: 'all'; checks: Check[] }
  | { t: 'any'; checks: Check[] }
  | { t: 'not'; check: Check };

// ── constructores cómodos ──
export const cwd = (path: string): Check => ({ t: 'cwd', path });
export const exists = (path: string, kind?: 'file' | 'dir' | 'link'): Check => ({ t: 'exists', path, kind });
export const missing = (path: string): Check => ({ t: 'missing', path });
export const content = (path: string, o: { equals?: string; includes?: string | string[]; matches?: string; lines?: number; notIncludes?: string }): Check => ({ t: 'content', path, ...o });
export const mode = (path: string, m: string): Check => ({ t: 'mode', path, mode: m });
export const owner = (path: string, user?: string, group?: string): Check => ({ t: 'owner', path, user, group });
export const out = (includes: string | string[], o: Partial<Extract<Check, { t: 'output' }>> = {}): Check => ({ t: 'output', includes, ...o });
export const outEq = (equals: string): Check => ({ t: 'output', equals });
export const outRe = (matches: string): Check => ({ t: 'output', matches });
export const ran = (matches: string): Check => ({ t: 'ran', matches });
export const used = (cmd: string, flags?: string[]): Check => ({ t: 'used', cmd, flags });
export const all = (...checks: Check[]): Check => ({ t: 'all', checks });
export const any = (...checks: Check[]): Check => ({ t: 'any', checks });
export const not = (check: Check): Check => ({ t: 'not', check });
export const link = (path: string, target?: string): Check => ({ t: 'link', path, target });
export const envIs = (name: string, value?: string): Check => ({ t: 'env', name, value });
export const aliasIs = (name: string, value?: string): Check => ({ t: 'alias', name, value });
export const pkg = (name: string, installed = true): Check => ({ t: 'pkg', name, installed });
export const service = (name: string, o: { state?: 'active' | 'inactive' | 'failed'; enabled?: boolean }): Check => ({ t: 'service', name, ...o });
export const userExists = (name: string, o: { groups?: string[]; shell?: string } = {}): Check => ({ t: 'user', name, exists: true, ...o });
export const whoami = (user: string): Check => ({ t: 'whoami', user });
export const procRunning = (matches: string, running = true): Check => ({ t: 'proc', matches, running });

export interface CheckResult {
  ok: boolean;
  /** Descripción legible de lo que falta (para pistas automáticas). */
  why?: string;
}

const toArr = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

export function evaluate(check: Check, term: Terminal): CheckResult {
  const fs = term.world.fs;
  const sh = term.shell;
  const sys = term.world.sys;
  const abs = (p: string) => sh.abs(p);
  const fail = (why: string): CheckResult => ({ ok: false, why });
  const ok: CheckResult = { ok: true };
  switch (check.t) {
    case 'cwd': return sh.cwd === abs(check.path) ? ok : fail(`El directorio actual debería ser ${check.path}`);
    case 'exists': {
      const n = check.kind === 'link' ? fs.lstat(abs(check.path)) : fs.stat(abs(check.path));
      if (!n) return fail(`Falta ${check.path}`);
      if (check.kind === 'dir' && n.kind !== 'dir') return fail(`${check.path} debería ser un directorio`);
      if (check.kind === 'file' && n.kind !== 'file') return fail(`${check.path} debería ser un archivo`);
      if (check.kind === 'link' && n.kind !== 'symlink') return fail(`${check.path} debería ser un enlace simbólico`);
      return ok;
    }
    case 'missing': return fs.lstat(abs(check.path)) ? fail(`${check.path} no debería existir`) : ok;
    case 'content': {
      const n = fs.stat(abs(check.path));
      if (!n || n.kind !== 'file') return fail(`Falta el archivo ${check.path}`);
      const text = n.content;
      if (check.equals !== undefined && text !== check.equals && text.trim() !== check.equals.trim()) return fail(`El contenido de ${check.path} no es el esperado`);
      for (const inc of toArr(check.includes)) if (!text.includes(inc)) return fail(`${check.path} debería contener "${inc}"`);
      if (check.notIncludes && text.includes(check.notIncludes)) return fail(`${check.path} no debería contener "${check.notIncludes}"`);
      if (check.matches && !new RegExp(check.matches, 'm').test(text)) return fail(`El contenido de ${check.path} no coincide con lo esperado`);
      if (check.lines !== undefined && (text.match(/\n/g) ?? []).length !== check.lines) return fail(`${check.path} debería tener ${check.lines} líneas`);
      return ok;
    }
    case 'mode': {
      const n = fs.stat(abs(check.path));
      if (!n) return fail(`Falta ${check.path}`);
      return (n.mode & 0o7777).toString(8) === check.mode.replace(/^0+/, '') || (n.mode & 0o777).toString(8) === check.mode ? ok : fail(`Los permisos de ${check.path} deberían ser ${check.mode}`);
    }
    case 'owner': {
      const n = fs.lstat(abs(check.path));
      if (!n) return fail(`Falta ${check.path}`);
      if (check.user && n.uid !== check.user) return fail(`El dueño de ${check.path} debería ser ${check.user}`);
      if (check.group && n.gid !== check.group) return fail(`El grupo de ${check.path} debería ser ${check.group}`);
      return ok;
    }
    case 'link': {
      const n = fs.lstat(abs(check.path));
      if (!n) return fail(`Falta ${check.path}`);
      if (check.hard) return n.nlink > 1 ? ok : fail(`${check.path} debería ser un enlace duro`);
      if (n.kind !== 'symlink') return fail(`${check.path} debería ser un enlace simbólico`);
      if (check.target !== undefined && n.target !== check.target && abs(n.target) !== abs(check.target)) return fail(`El enlace debería apuntar a ${check.target}`);
      return ok;
    }
    case 'output': {
      const last = term.last;
      if (!last) return fail('Ejecuta un comando');
      const text = check.stderr ? last.stderr : last.stdout;
      const t = text.trimEnd();
      if (check.equals !== undefined && t !== check.equals.trimEnd()) return fail('La salida no es la esperada');
      const incs = toArr(check.includes);
      if (incs.length) {
        const hits = incs.filter((i) => text.includes(i));
        if (check.any ? hits.length === 0 : hits.length !== incs.length) return fail('La salida no contiene lo que se pide');
      }
      if (check.notIncludes && text.includes(check.notIncludes)) return fail('La salida contiene algo que no debería');
      if (check.matches && !new RegExp(check.matches, 'm').test(text)) return fail('La salida no coincide con lo esperado');
      return ok;
    }
    case 'ran': {
      const re = new RegExp(check.matches);
      return term.runs.some((r) => re.test(r.line)) ? ok : fail('Aún no has ejecutado el comando pedido');
    }
    case 'used': {
      const hit = term.runs.some((r) =>
        r.commands.some((c) => {
          const parts = c.trim().split(/\s+/);
          if (parts[0] !== check.cmd && !(parts[0] === 'sudo' && parts[1] === check.cmd)) return false;
          if (!check.flags) return true;
          return check.flags.every((f) => parts.slice(1).some((p) => p === f || (f.length === 2 && p.startsWith('-') && !p.startsWith('--') && p.includes(f[1]))));
        }),
      );
      return hit ? ok : fail(`Usa el comando ${check.cmd}${check.flags ? ' con ' + check.flags.join(' ') : ''}`);
    }
    case 'env': {
      const v = sh.vars.get(check.name);
      if (!v) return fail(`Falta la variable ${check.name}`);
      if (check.value !== undefined && v.value !== check.value) return fail(`${check.name} debería valer ${check.value}`);
      return ok;
    }
    case 'alias': {
      const v = sh.aliases.get(check.name);
      if (v === undefined) return fail(`Falta el alias ${check.name}`);
      if (check.value !== undefined && v !== check.value) return fail(`El alias debería ser '${check.value}'`);
      return ok;
    }
    case 'func': return sh.funcs.has(check.name) ? ok : fail(`Falta la función ${check.name}`);
    case 'proc': {
      const re = new RegExp(check.matches);
      const found = [...sys.procs.values()].some((p) => re.test(p.command));
      return found === check.running ? ok : fail(check.running ? `Debería haber un proceso ${check.matches}` : `No debería haber procesos ${check.matches}`);
    }
    case 'job': {
      const jobs = term.world.rt.jobs.filter((j) => j.state !== 'done');
      if (check.state === 'any') return jobs.length ? ok : fail('Debería haber un trabajo en segundo plano');
      return jobs.some((j) => j.state === check.state) ? ok : fail(`Debería haber un trabajo ${check.state}`);
    }
    case 'pkg': return (sys.packages.get(check.name)?.installed ?? false) === check.installed ? ok : fail(`${check.name} debería estar ${check.installed ? 'instalado' : 'desinstalado'}`);
    case 'service': {
      const s = sys.services.get(check.name);
      if (!s) return fail(`No existe el servicio ${check.name}`);
      if (check.state && s.state !== check.state) return fail(`${check.name} debería estar ${check.state}`);
      if (check.enabled !== undefined && s.enabled !== check.enabled) return fail(`${check.name} debería estar ${check.enabled ? 'habilitado' : 'deshabilitado'}`);
      return ok;
    }
    case 'user': {
      const u = sys.users.get(check.name);
      if ((!!u) !== check.exists) return fail(`El usuario ${check.name} ${check.exists ? 'debería existir' : 'no debería existir'}`);
      if (u && check.groups) {
        const g = sys.groupsOf(check.name);
        for (const x of check.groups) if (!g.includes(x)) return fail(`${check.name} debería estar en el grupo ${x}`);
      }
      if (u && check.shell && u.shell !== check.shell) return fail(`La shell de ${check.name} debería ser ${check.shell}`);
      return ok;
    }
    case 'group': {
      const g = sys.groups.get(check.name);
      if ((!!g) !== check.exists) return fail(`El grupo ${check.name} ${check.exists ? 'debería existir' : 'no debería existir'}`);
      if (g && check.member && !g.members.has(check.member)) return fail(`${check.member} debería estar en ${check.name}`);
      return ok;
    }
    case 'whoami': return sh.user === check.user ? ok : fail(`Deberías ser el usuario ${check.user}`);
    case 'crontab': {
      const t = sys.crontabs.get(check.user ?? sh.user);
      return t && t.includes(check.includes) ? ok : fail('Falta la tarea en el crontab');
    }
    case 'status': return term.last?.status === check.code ? ok : fail(`El código de salida debería ser ${check.code}`);
    case 'file-count': {
      let n = 0;
      try {
        n = fs.readdir(abs(check.dir)).length;
      } catch {
        return fail(`Falta ${check.dir}`);
      }
      const cmp = check.cmp ?? 'eq';
      return (cmp === 'eq' ? n === check.count : cmp === 'gte' ? n >= check.count : n <= check.count) ? ok : fail(`${check.dir} debería tener ${check.count} elementos`);
    }
    case 'all': {
      for (const c of check.checks) {
        const r = evaluate(c, term);
        if (!r.ok) return r;
      }
      return ok;
    }
    case 'any': {
      let first: CheckResult | null = null;
      for (const c of check.checks) {
        const r = evaluate(c, term);
        if (r.ok) return ok;
        first = first ?? r;
      }
      return first ?? fail('No se cumple ninguna condición');
    }
    case 'not': {
      const r = evaluate(check.check, term);
      return r.ok ? fail('Hay algo que no debería estar así') : ok;
    }
  }
}
