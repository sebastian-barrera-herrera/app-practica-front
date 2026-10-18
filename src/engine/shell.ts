/**
 * Intérprete de shell (async): expansiones, pipes, redirecciones, control de
 * flujo, funciones, jobs y señales. Los comandos viven en ./commands/*.
 */
import { ArithError, evalArith } from './arith';
import { shellQuote } from './format';
import {
  type Assign,
  type Node,
  ParseError,
  type Redir,
  type Word,
  parse,
} from './parser';
import {
  BufferStdin,
  type Ctx,
  EMPTY_STDIN,
  type IO,
  REGISTRY,
  type Stdin,
  UsageError,
  type CommandDef,
} from './registry';
import { expandBraces, globMatch, globToRegex, hasGlobChars } from './regex';
import { basename, dirname, join, normalize, resolve } from './path';
import type { System } from './sys';
import { collate, type Cred, FsError, type VFS } from './vfs';
import { evalTest, type TestTok } from './testexpr';
import { helpText } from './help';

// ───────────────────────── excepciones de control ─────────────────────────

export class SignalEx extends Error {
  sig: 'INT' | 'TSTP';
  remainingMs: number;
  constructor(sig: 'INT' | 'TSTP', remainingMs = 0) {
    super(sig);
    this.sig = sig;
    this.remainingMs = remainingMs;
  }
}
export class TimeoutEx extends Error {}
export class BreakEx {
  constructor(public n: number) {}
}
export class ContinueEx {
  constructor(public n: number) {}
}
export class ReturnEx {
  constructor(public code: number) {}
}
export class ExitEx {
  constructor(public code: number) {}
}
/** Error de shell que aborta el comando actual (muestra mensaje y status). */
export class ShellError extends Error {
  code: number;
  constructor(msg: string, code = 1) {
    super(msg);
    this.code = code;
  }
}

// ───────────────────────── runtime compartido ─────────────────────────

export interface Job {
  id: number;
  pid: number;
  text: string;
  state: 'running' | 'stopped' | 'done' | 'killed';
  startedAt: number;
  endsAt: number;
  remainingMs?: number;
  buf: { s: string; err: boolean }[];
  status: number;
  /** Para jobs detenidos desde primer plano: línea a relanzar con fg. */
  resumeLine?: string;
  reported?: boolean;
}

export class Runtime {
  /** ms reales por cada ms virtual de espera (0 = instantáneo). */
  timeScale = 0.1;
  signal: 'INT' | 'TSTP' | null = null;
  private sleepers = new Set<(sig: 'INT' | 'TSTP') => void>();
  steps = 0;
  maxSteps = 200000;
  cols = 40;
  jobs: Job[] = [];
  nextJobId = 1;
  lastBgPid = 0;
  seed = 20260314;
  /** Salida directa a la terminal (para volcado de trabajos en segundo plano). */
  termWrite: ((s: string, err: boolean) => void) | null = null;
  /** Sesión remota solicitada por ssh: la terminal cambia de shell al terminar el comando. */
  pendingSession: { shell: Shell; host: string; user: string } | null = null;
  /** Límite de tiempo virtual (para `timeout`). */
  deadline: number | null = null;
  /** Editor de texto integrado (nano/vim). Devuelve el nuevo contenido o null si se cancela. */
  editor: ((path: string, content: string, name: string) => Promise<string | null>) | null = null;

  raise(sig: 'INT' | 'TSTP') {
    this.signal = sig;
    for (const w of [...this.sleepers]) w(sig);
  }

  consume(): 'INT' | 'TSTP' | null {
    const s = this.signal;
    this.signal = null;
    return s;
  }

  random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Espera `virtualMs` de tiempo virtual (interrumpible). */
  async sleep(sys: System, virtualMs: number): Promise<void> {
    if (this.deadline !== null && sys.clock.now + virtualMs > this.deadline) {
      await this.sleepRaw(sys, Math.max(0, this.deadline - sys.clock.now));
      throw new TimeoutEx('timeout');
    }
    return this.sleepRaw(sys, virtualMs);
  }

  private async sleepRaw(sys: System, virtualMs: number): Promise<void> {
    if (this.signal) throw new SignalEx(this.consume()!, virtualMs);
    const real = virtualMs * this.timeScale;
    if (real < 1) {
      sys.clock.now += virtualMs;
      await Promise.resolve();
      return;
    }
    const start = Date.now();
    await new Promise<void>((resolveP, reject) => {
      const t = setTimeout(() => {
        this.sleepers.delete(w);
        resolveP();
      }, real);
      const w = (sig: 'INT' | 'TSTP') => {
        clearTimeout(t);
        this.sleepers.delete(w);
        const el = Math.min(virtualMs, (Date.now() - start) / this.timeScale);
        sys.clock.now += el;
        this.consume();
        reject(new SignalEx(sig, virtualMs - el));
      };
      this.sleepers.add(w);
    });
    sys.clock.now += virtualMs;
  }

  async yieldNow() {
    await new Promise<void>((r) => setTimeout(r, 0));
    if (this.signal) throw new SignalEx(this.consume()!);
  }
}

// ───────────────────────── variables ─────────────────────────

export interface Var {
  value: string;
  exported: boolean;
  readonly?: boolean;
  arr?: string[];
}

interface Seg {
  s: string;
  q: boolean;
}

export const SHELL_BUILTINS = new Set([
  'cd', 'echo', 'printf', 'pwd', 'export', 'unset', 'set', 'shift', 'source', '.', 'eval',
  'exit', 'return', 'break', 'continue', 'read', 'test', '[', 'true', 'false', ':', 'alias',
  'unalias', 'type', 'command', 'local', 'declare', 'typeset', 'readonly', 'let', 'history',
  'jobs', 'fg', 'bg', 'wait', 'kill', 'umask', 'pushd', 'popd', 'dirs', 'help', 'exec', 'trap',
  'hash', 'builtin', 'getopts', 'times', 'enable', 'logout', 'disown', 'suspend',
]);

export class Shell {
  sys: System;
  fs: VFS;
  rt: Runtime;
  cwd: string;
  vars = new Map<string, Var>();
  aliases = new Map<string, string>();
  funcs = new Map<string, Node>();
  positional: string[] = [];
  scriptName = 'bash';
  lastStatus = 0;
  user: string;
  userStack: string[] = [];
  savedCwd: string[] = [];
  pid: number;
  startTime: number;
  bg = false;
  bgJob: Job | null = null;
  localStack: Map<string, Var | undefined>[] = [];
  history: string[] = [];
  io!: IO;
  opts = new Set<string>();
  dirStack: string[] = [];
  noAlias = new Set<string>();
  funcDepth = 0;
  umask = 0o022;
  interactive = true;
  traps = new Map<string, string>();
  hashTable = new Map<string, string>();

  constructor(sys: System, fs: VFS, rt: Runtime, user = 'alumno') {
    this.sys = sys;
    this.fs = fs;
    this.rt = rt;
    this.user = user;
    this.pid = sys.nextPid++;
    this.startTime = sys.clock.now;
    const u = sys.user(user);
    this.cwd = u?.home ?? '/';
    this.initEnv();
  }

  private initEnv() {
    const u = this.sys.user(this.user);
    const home = u?.home ?? '/';
    const set = (k: string, v: string, exported = true) =>
      this.vars.set(k, { value: v, exported });
    set('HOME', home);
    set('USER', this.user);
    set('LOGNAME', this.user);
    set('SHELL', u?.shell ?? '/bin/bash');
    set(
      'PATH',
      this.user === 'root'
        ? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        : `${home}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    );
    set('PWD', this.cwd);
    set('OLDPWD', this.cwd);
    set('LANG', 'en_US.UTF-8');
    set('TERM', 'xterm-256color');
    set('EDITOR', 'nano');
    set('HOSTNAME', this.sys.hostname, false);
    set('IFS', ' \t\n', false);
    set('HISTSIZE', '1000', false);
    set(
      'PS1',
      '\\[\\e[01;32m\\]\\u@\\h\\[\\e[00m\\]:\\[\\e[01;34m\\]\\w\\[\\e[00m\\]\\$ ',
      false,
    );
    set('PS2', '> ', false);
  }

  get cred(): Cred {
    return this.sys.cred(this.user);
  }

  /** Copia para ejecutar un proceso hijo (script o bash -c): solo hereda las variables exportadas. */
  forkExec(): Shell {
    const c = this.clone();
    for (const [k, v] of [...c.vars]) if (!v.exported) c.vars.delete(k);
    c.aliases.clear();
    c.funcs.clear();
    c.vars.set('IFS', { value: ' \t\n', exported: false });
    return c;
  }

  clone(): Shell {
    const c = Object.create(Shell.prototype) as Shell;
    Object.assign(c, this);
    c.vars = new Map([...this.vars].map(([k, v]) => [k, { ...v, arr: v.arr ? [...v.arr] : undefined }]));
    c.aliases = new Map(this.aliases);
    c.funcs = new Map(this.funcs);
    c.positional = [...this.positional];
    c.localStack = [];
    c.opts = new Set(this.opts);
    c.dirStack = [...this.dirStack];
    c.userStack = [...this.userStack];
    c.savedCwd = [...this.savedCwd];
    c.noAlias = new Set(this.noAlias);
    c.traps = new Map(this.traps);
    c.hashTable = new Map(this.hashTable);
    return c;
  }

  // ───────────────────────── variables ─────────────────────────

  getVar(name: string): string | undefined {
    const v = this.vars.get(name);
    if (v) return v.arr ? (v.arr[0] ?? '') : v.value;
    return undefined;
  }

  env(name: string, dflt = ''): string {
    return this.getVar(name) ?? dflt;
  }

  setVar(name: string, value: string, exported?: boolean) {
    const cur = this.vars.get(name);
    if (cur?.readonly) throw new ShellError(`${name}: readonly variable`);
    this.vars.set(name, {
      value,
      exported: exported ?? cur?.exported ?? false,
      readonly: cur?.readonly,
    });
  }

  setArray(name: string, arr: string[], exported?: boolean) {
    const cur = this.vars.get(name);
    if (cur?.readonly) throw new ShellError(`${name}: readonly variable`);
    this.vars.set(name, { value: arr[0] ?? '', exported: exported ?? cur?.exported ?? false, arr });
  }

  unsetVar(name: string) {
    const cur = this.vars.get(name);
    if (cur?.readonly) throw new ShellError(`${name}: cannot unset: readonly variable`);
    this.vars.delete(name);
  }

  declareLocal(name: string) {
    const frame = this.localStack[this.localStack.length - 1];
    if (!frame) return false;
    if (!frame.has(name)) {
      const cur = this.vars.get(name);
      frame.set(name, cur ? { ...cur, arr: cur.arr ? [...cur.arr] : undefined } : undefined);
    }
    return true;
  }

  exportedEnv(): [string, string][] {
    const out: [string, string][] = [];
    for (const [k, v] of this.vars) if (v.exported) out.push([k, v.arr ? (v.arr[0] ?? '') : v.value]);
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  home(): string {
    return this.getVar('HOME') ?? this.sys.user(this.user)?.home ?? '/';
  }

  abs(p: string): string {
    if (p === '~') return this.home();
    if (p.startsWith('~/')) return resolve(this.home(), p.slice(2));
    return resolve(this.cwd, p);
  }

  setCwd(abs: string) {
    const old = this.cwd;
    this.cwd = abs;
    this.setVar('OLDPWD', old, true);
    this.setVar('PWD', abs, true);
  }

  setUser(name: string) {
    this.user = name;
    const u = this.sys.user(name);
    const home = u?.home ?? '/';
    this.setVar('USER', name, true);
    this.setVar('LOGNAME', name, true);
    this.setVar('HOME', home, true);
    if (name === 'root') {
      this.setVar('PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', true);
    } else {
      this.setVar(
        'PATH',
        `${home}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
        true,
      );
    }
  }

  // ───────────────────────── prompt ─────────────────────────

  promptString(ps = 'PS1'): string {
    const tpl = this.getVar(ps) ?? '$ ';
    const home = this.home();
    const w = this.cwd === home ? '~' : this.cwd.startsWith(home + '/') ? '~' + this.cwd.slice(home.length) : this.cwd;
    const d = new Date(this.sys.clock.now);
    const pad = (n: number) => String(n).padStart(2, '0');
    return tpl.replace(/\\(.)/g, (_m, ch: string) => {
      switch (ch) {
        case 'u': return this.user;
        case 'h': return this.sys.hostname;
        case 'H': return this.sys.hostname;
        case 'w': return w;
        case 'W': return this.cwd === '/' ? '/' : this.cwd === home ? '~' : basename(this.cwd);
        case '$': return this.user === 'root' ? '#' : '$';
        case 'n': return '\n';
        case 't': return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
        case 'T': return `${pad(d.getUTCHours() % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
        case '@': return `${pad(d.getUTCHours() % 12 || 12)}:${pad(d.getUTCMinutes())} ${d.getUTCHours() < 12 ? 'AM' : 'PM'}`;
        case 'd': return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + pad(d.getUTCDate());
        case 'e': return '\x1b';
        case '[': case ']': return '';
        case '\\': return '\\';
        case 's': return 'bash';
        case 'j': return String(this.rt.jobs.filter((j) => j.state !== 'done').length);
        default: return '\\' + ch;
      }
    });
  }

  // ───────────────────────── parámetros ─────────────────────────

  private lookupParam(base: string, sub: string | null): string | string[] | undefined {
    if (sub !== null) {
      const v = this.vars.get(base);
      if (sub === '@' || sub === '*') {
        if (!v) return undefined;
        return v.arr ? [...v.arr] : [v.value];
      }
      const idx = this.arith(sub);
      if (!v) return undefined;
      if (v.arr) return v.arr[idx < 0 ? v.arr.length + idx : idx];
      return idx === 0 ? v.value : undefined;
    }
    switch (base) {
      case '?': return String(this.lastStatus);
      case '$': return String(this.pid);
      case '!': return this.rt.lastBgPid ? String(this.rt.lastBgPid) : '';
      case '#': return String(this.positional.length);
      case '@': case '*': return [...this.positional];
      case '0': return this.scriptName;
      case '-': return [...this.opts].join('') || 'hB';
      case 'RANDOM': return String(Math.floor(this.rt.random() * 32768));
      case 'SECONDS': return String(Math.floor((this.sys.clock.now - this.startTime) / 1000));
      case 'LINENO': return '1';
      case 'UID': case 'EUID': return String(this.sys.user(this.user)?.uid ?? 0);
      case 'PPID': return '1';
      case 'BASHPID': return String(this.pid);
      case 'HOSTNAME': return this.sys.hostname;
    }
    if (/^[0-9]+$/.test(base)) return this.positional[parseInt(base, 10) - 1];
    const v = this.vars.get(base);
    if (!v) return undefined;
    return v.arr ? (v.arr[0] ?? '') : v.value;
  }

  arith(expr: string): number {
    try {
      return evalArith(expr, {
        get: (n) => {
          const raw = this.lookupParam(n, null);
          const v = Array.isArray(raw) ? raw[0] : raw;
          if (v === undefined || v === '') return 0;
          if (/^-?\d+$/.test(v)) return parseInt(v, 10);
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && v !== n) return this.arith(v);
          return 0;
        },
        set: (n, val) => this.setVar(n, String(val)),
      });
    } catch (e) {
      if (e instanceof ArithError) throw new ShellError(e.message);
      throw e;
    }
  }

  private async paramValue(
    p: { name: string; op?: string; arg?: Word },
  ): Promise<string | string[]> {
    const { op, arg } = p;
    let base = p.name;
    let sub: string | null = null;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\[(.*)\]$/.exec(p.name);
    if (m) {
      base = m[1];
      sub = m[2];
    }
    if (op === '!indirect') {
      const target = this.getVar(base);
      return target === undefined ? '' : (this.getVar(target) ?? '');
    }
    if (op === '!keys') {
      const v = this.vars.get(base);
      return v?.arr ? v.arr.map((_x, i) => String(i)) : v ? ['0'] : [];
    }
    let raw = this.lookupParam(base, sub);
    if (op === '#len') {
      if (Array.isArray(raw)) return String(raw.length);
      return String((raw ?? '').length);
    }
    const isList = Array.isArray(raw);
    const unset = raw === undefined || (isList && (raw as string[]).length === 0);
    const asStr = isList ? (raw as string[]).join(' ') : ((raw as string | undefined) ?? '');
    if (!op) {
      if (unset && this.opts.has('u') && !/^[?@*#$!\-0]$/.test(base))
        throw new ShellError(`${p.name}: unbound variable`);
      return raw === undefined ? '' : (raw as string | string[]);
    }
    const argStr = async () => (arg ? await this.expandString(arg) : '');
    switch (op) {
      case ':-': return unset || asStr === '' ? await argStr() : (raw as string | string[]);
      case '-': return unset ? await argStr() : (raw as string | string[]);
      case ':=': case '=': {
        if (unset || (op === ':=' && asStr === '')) {
          const v = await argStr();
          if (!/^[0-9@*#?$!-]/.test(base)) this.setVar(base, v);
          return v;
        }
        return raw as string | string[];
      }
      case ':?': case '?': {
        if (unset || (op === ':?' && asStr === '')) {
          const msg = (await argStr()) || 'parameter null or not set';
          throw new ShellError(`${base}: ${msg}`);
        }
        return raw as string | string[];
      }
      case ':+': return !unset && asStr !== '' ? await argStr() : '';
      case '+': return !unset ? await argStr() : '';
    }
    // operaciones sobre cadena (se aplican a cada elemento si es lista)
    const apply = async (s: string): Promise<string> => {
      switch (op) {
        case '#': case '##': {
          const pat = await argStr();
          const re = globToRegex(pat);
          const src = re.source.slice(1, -1);
          for (let i = op === '#' ? 0 : s.length; op === '#' ? i <= s.length : i >= 0; op === '#' ? i++ : i--) {
            if (new RegExp('^' + src + '$', 's').test(s.slice(0, i))) return s.slice(i);
          }
          return s;
        }
        case '%': case '%%': {
          const pat = await argStr();
          const src = globToRegex(pat).source.slice(1, -1);
          for (let i = op === '%' ? s.length : 0; op === '%' ? i >= 0 : i <= s.length; op === '%' ? i-- : i++) {
            if (new RegExp('^' + src + '$', 's').test(s.slice(i))) return s.slice(0, i);
          }
          return s;
        }
        case '/': case '//': case '/#': case '/%': {
          const text = await argStr();
          let pat = text;
          let rep = '';
          const slash = findUnescaped(text, '/');
          if (slash >= 0) {
            pat = text.slice(0, slash);
            rep = text.slice(slash + 1);
          }
          if (pat === '') return s;
          let src = globToRegex(pat).source.slice(1, -1);
          if (op === '/#') src = '^(?:' + src + ')';
          if (op === '/%') src = '(?:' + src + ')$';
          const re = new RegExp(src, op === '//' ? 'gs' : 's');
          return s.replace(re, () => rep);
        }
        case '^^': return s.toUpperCase();
        case '^': return s.charAt(0).toUpperCase() + s.slice(1);
        case ',,': return s.toLowerCase();
        case ',': return s.charAt(0).toLowerCase() + s.slice(1);
        case ':offset': {
          const spec = await argStr();
          const [offS, lenS] = splitOnce(spec, ':');
          let off = this.arith(offS.trim() || '0');
          if (off < 0) off = Math.max(0, s.length + off);
          if (lenS === undefined) return s.slice(off);
          let len = this.arith(lenS.trim() || '0');
          if (len < 0) return s.slice(off, Math.max(off, s.length + len));
          return s.slice(off, off + len);
        }
      }
      return s;
    };
    if (isList && (op === ':offset')) {
      const spec = await argStr();
      const [offS, lenS] = splitOnce(spec, ':');
      const lst = raw as string[];
      let off = this.arith(offS.trim() || '0');
      if (off < 0) off = Math.max(0, lst.length + off);
      return lenS === undefined ? lst.slice(off) : lst.slice(off, off + this.arith(lenS.trim() || '0'));
    }
    if (isList) {
      const out: string[] = [];
      for (const e of raw as string[]) out.push(await apply(e));
      return out;
    }
    return apply(asStr);
  }

  // ───────────────────────── expansión de palabras ─────────────────────────

  /** Ejecuta `src` en una subshell y devuelve su salida tal cual. */
  async captureSub(src: string): Promise<string> {
    let node: Node;
    try {
      node = parse(src);
    } catch (e) {
      if (e instanceof ParseError) throw new ShellError(`syntax error in command substitution: ${e.message}`);
      throw e;
    }
    const sub = this.clone();
    let buf = '';
    const io: IO = {
      stdin: this.io?.stdin ?? EMPTY_STDIN(),
      out: (s) => (buf += s),
      err: this.io?.err ?? (() => {}),
      tty: false,
    };
    try {
      this.lastStatus = await sub.execNode(node, io);
    } catch (e) {
      if (e instanceof ExitEx) this.lastStatus = e.code;
      else throw e;
    }
    return buf;
  }

  private psubSeq = 0;
  private psubFiles: string[] = [];

  /** <( cmd ): vuelca la salida en /dev/fd/N y devuelve esa ruta. Se borra al terminar la línea. */
  async procSub(src: string): Promise<string> {
    const text = await this.captureSub(src);
    const path = `/dev/fd/${63 - (this.psubSeq++ % 30)}`;
    this.fs.mkdirp('/dev/fd', 0o755, null);
    this.fs.writeFile(path, text, { cred: null });
    this.psubFiles.push(path);
    return path;
  }

  async cmdSub(src: string): Promise<string> {
    return (await this.captureSub(src)).replace(/\n+$/, '');
  }

  private expandBracesInWord(word: Word): Word[] {
    // solo si hay '{' en algún lit
    if (!word.some((p) => p.t === 'lit' && p.s.includes('{'))) return [word];
    const others: Word = [];
    let str = '';
    for (const p of word) {
      if (p.t === 'lit') str += p.s;
      else {
        str += String.fromCharCode(0xe000 + others.length);
        others.push(p);
      }
    }
    const alts = expandBraces(str);
    if (alts.length === 1 && alts[0] === str) return [word];
    return alts.map((a) => {
      const parts: Word = [];
      let lit = '';
      for (const ch of a) {
        const code = ch.charCodeAt(0);
        if (code >= 0xe000 && code < 0xe000 + others.length) {
          if (lit) {
            parts.push({ t: 'lit', s: lit });
            lit = '';
          }
          parts.push(others[code - 0xe000]);
        } else lit += ch;
      }
      if (lit) parts.push({ t: 'lit', s: lit });
      return parts;
    });
  }

  private ifs(): string {
    return this.getVar('IFS') ?? ' \t\n';
  }

  /** Expande una palabra a campos (con separación, llaves y glob opcional). */
  private async expandToFieldSegs(word: Word, split: boolean): Promise<Seg[][]> {
    const fields: Seg[][] = [];
    let cur: Seg[] = [];
    let force = false;
    const finish = () => {
      if (cur.length && (force || cur.some((s) => s.s !== ''))) fields.push(cur);
      else if (force) fields.push(cur.length ? cur : [{ s: '', q: true }]);
      cur = [];
      force = false;
    };
    const ifs = this.ifs();
    const pushSplittable = (text: string) => {
      if (!split || ifs === '') {
        cur.push({ s: text, q: !split });
        return;
      }
      let i = 0;
      while (i < text.length) {
        if (ifs.includes(text[i])) {
          let j = i;
          while (j < text.length && ifs.includes(text[j])) j++;
          finish();
          i = j;
        } else {
          let j = i;
          while (j < text.length && !ifs.includes(text[j])) j++;
          cur.push({ s: text.slice(i, j), q: false });
          i = j;
        }
      }
    };
    const pushQuoted = (s: string) => {
      cur.push({ s, q: true });
      force = true;
    };

    for (const part of word) {
      switch (part.t) {
        case 'lit':
          cur.push({ s: part.s, q: !split });
          break;
        case 'sq':
          pushQuoted(part.s);
          break;
        case 'tilde': {
          if (part.user === '') cur.push({ s: this.home(), q: true });
          else {
            const u = this.sys.user(part.user);
            cur.push({ s: u ? u.home : '~' + part.user, q: true });
          }
          break;
        }
        case 'param': {
          const v = await this.paramValue(part);
          if (Array.isArray(v)) {
            v.forEach((el, i) => {
              if (i > 0) finish();
              pushSplittable(el);
            });
          } else pushSplittable(v);
          break;
        }
        case 'cmd':
          pushSplittable(await this.cmdSub(part.src));
          break;
        case 'psub':
          pushQuoted(await this.procSub(part.src));
          break;
        case 'arith':
          pushSplittable(String(this.arith(await this.expandString([{ t: 'lit', s: part.expr }]))));
          break;
        case 'arr':
          cur.push({ s: '()', q: true });
          break;
        case 'dq': {
          if (part.parts.length === 0) force = true;
          for (const q of part.parts) {
            if (q.t === 'lit') pushQuoted(q.s);
            else if (q.t === 'param') {
              const v = await this.paramValue(q);
              if (Array.isArray(v)) {
                const isStar = /^(\*|.*\[\*\])$/.test(q.name) && !q.op;
                if (isStar) pushQuoted(v.join(ifs[0] ?? ' '));
                else if (!split) pushQuoted(v.join(' '));
                else
                  v.forEach((el, i) => {
                    if (i > 0) finish();
                    pushQuoted(el);
                  });
              } else pushQuoted(v);
            } else if (q.t === 'cmd') pushQuoted(await this.cmdSub(q.src));
            else if (q.t === 'arith')
              pushQuoted(String(this.arith(await this.expandString([{ t: 'lit', s: q.expr }]))));
          }
          break;
        }
      }
    }
    finish();
    return fields;
  }

  /** Expande a una sola cadena (sin separación ni glob). */
  async expandString(word: Word): Promise<string> {
    const fields = await this.expandToFieldSegs(word, false);
    return fields.map((f) => f.map((s) => s.s).join('')).join(' ');
  }

  /** Patrón glob con las partes entrecomilladas escapadas (para case, [[ ]]). */
  async expandPattern(word: Word): Promise<string> {
    const esc = (s: string) => s.replace(/[\\*?[\]]/g, '\\$&');
    let out = '';
    for (const part of word) {
      if (part.t === 'lit') out += part.s;
      else if (part.t === 'sq') out += esc(part.s);
      else if (part.t === 'dq') {
        for (const q of part.parts) {
          if (q.t === 'lit') out += esc(q.s);
          else out += esc(await this.expandString([{ t: 'dq', parts: [q] }]));
        }
      } else out += await this.expandString([part]);
    }
    return out;
  }

  /** Expande una lista de palabras a argv (llaves, vars, separación, glob). */
  async expandFields(words: Word[]): Promise<string[]> {
    const out: string[] = [];
    for (const w of words) {
      for (const variant of this.expandBracesInWord(w)) {
        const fields = await this.expandToFieldSegs(variant, true);
        for (const f of fields) {
          const hasGlob = f.some((s) => !s.q && hasGlobChars(s.s));
          if (!hasGlob) {
            out.push(f.map((s) => s.s).join(''));
            continue;
          }
          const pat = f.map((s) => (s.q ? s.s.replace(/[\\*?[\]]/g, '\\$&') : s.s)).join('');
          const matches = this.globExpand(pat);
          if (matches.length) out.push(...matches);
          else out.push(f.map((s) => s.s).join(''));
        }
      }
    }
    return out;
  }

  globExpand(pattern: string): string[] {
    const isAbs = pattern.startsWith('/');
    const trailingSlash = pattern.length > 1 && pattern.endsWith('/');
    const comps = pattern.split('/').filter((c) => c !== '');
    let bases: string[] = [isAbs ? '/' : ''];
    for (let k = 0; k < comps.length; k++) {
      const comp = comps[k];
      const next: string[] = [];
      const hasGlob = hasGlobChars(comp.replace(/\\./g, ''));
      for (const b of bases) {
        const dirAbs = b === '' ? this.cwd : b.startsWith('/') ? b : resolve(this.cwd, b);
        if (!hasGlob) {
          const lit = comp.replace(/\\(.)/g, '$1');
          const p = b === '' ? lit : b === '/' ? '/' + lit : b + '/' + lit;
          if (this.fs.lstat(resolve(this.cwd, p), this.cred)) next.push(p);
          continue;
        }
        let names: string[] = [];
        try {
          names = this.fs.readdir(dirAbs, this.cred);
        } catch {
          continue;
        }
        const re = globToRegex(comp);
        for (const n of names) {
          if (n.startsWith('.') && !comp.startsWith('.')) continue;
          if (re.test(n)) next.push(b === '' ? n : b === '/' ? '/' + n : b + '/' + n);
        }
      }
      bases = next;
      if (!bases.length) return [];
    }
    let res = bases.filter((p) => this.fs.lstat(resolve(this.cwd, p), this.cred));
    if (trailingSlash) {
      res = res.filter((p) => this.fs.isDir(resolve(this.cwd, p))).map((p) => p + '/');
    }
    return res.sort((a, b) => collate(a, b));
  }

  // ───────────────────────── ejecución ─────────────────────────

  private async stepCheck() {
    if (++this.rt.steps > this.rt.maxSteps) {
      this.rt.steps = 0;
      throw new ShellError('ejecución abortada: demasiados pasos (¿bucle infinito?)', 1);
    }
    if (this.rt.steps % 64 === 0) await this.rt.yieldNow();
    else if (this.rt.signal) throw new SignalEx(this.rt.consume()!);
  }

  /** Ejecuta texto fuente completo. */
  async runLine(src: string, io: IO): Promise<number> {
    let node: Node;
    try {
      node = parse(src);
    } catch (e) {
      if (e instanceof ParseError) {
        io.err(`bash: ${e.message}\n`);
        this.lastStatus = 2;
        return 2;
      }
      throw e;
    }
    this.io = io;
    try {
      return await this.execNode(node, io);
    } finally {
      for (const f of this.psubFiles.splice(0)) {
        try {
          this.fs.unlink(f, null);
        } catch {
          /* ya no existe */
        }
      }
    }
  }

  async execNode(node: Node, io: IO): Promise<number> {
    this.io = io;
    await this.stepCheck();
    try {
      const st = await this.execNodeInner(node, io);
      this.lastStatus = st;
      return st;
    } catch (e) {
      if (e instanceof ShellError) {
        io.err(`bash: ${e.message}\n`);
        this.lastStatus = e.code;
        return e.code;
      }
      throw e;
    }
  }

  private async execNodeInner(node: Node, io: IO): Promise<number> {
    switch (node.type) {
      case 'list': {
        let st = 0;
        for (const item of node.items) {
          if (item.bg) st = await this.runBackground(item.cmd, item.text, io);
          else st = await this.execNode(item.cmd, io);
          this.lastStatus = st;
          if (this.opts.has('e') && st !== 0 && item.cmd.type !== 'andor' && item.cmd.type !== 'if')
            throw new ExitEx(st);
        }
        return st;
      }
      case 'andor': {
        let st = await this.execNode(node.first, io);
        for (const r of node.rest) {
          if (r.op === '&&' ? st === 0 : st !== 0) st = await this.execNode(r.p, io);
        }
        return st;
      }
      case 'pipeline':
        return this.execPipeline(node, io);
      case 'simple':
        return this.execSimple(node, io);
      case 'if': {
        return this.withRedirs(node.redirs, io, async (io2) => {
          for (const c of node.conds) {
            const cs = await this.execNode(c.cond, io2);
            if (cs === 0) return this.execNode(c.body, io2);
          }
          if (node.else) return this.execNode(node.else, io2);
          return 0;
        });
      }
      case 'for': {
        return this.withRedirs(node.redirs, io, async (io2) => {
          const items = node.words ? await this.expandFields(node.words) : [...this.positional];
          let st = 0;
          for (const it of items) {
            this.setVar(node.name, it);
            try {
              st = await this.execNode(node.body, io2);
            } catch (e) {
              if (e instanceof BreakEx) {
                if (e.n > 1) throw new BreakEx(e.n - 1);
                break;
              }
              if (e instanceof ContinueEx) {
                if (e.n > 1) throw new ContinueEx(e.n - 1);
                continue;
              }
              throw e;
            }
          }
          return st;
        });
      }
      case 'cfor': {
        return this.withRedirs(node.redirs, io, async (io2) => {
          let st = 0;
          if (node.init.trim()) this.arith(node.init);
          while (!node.cond.trim() || this.arith(node.cond) !== 0) {
            try {
              st = await this.execNode(node.body, io2);
            } catch (e) {
              if (e instanceof BreakEx) {
                if (e.n > 1) throw new BreakEx(e.n - 1);
                break;
              }
              if (e instanceof ContinueEx) {
                if (e.n > 1) {
                  throw new ContinueEx(e.n - 1);
                }
              } else throw e;
            }
            if (node.step.trim()) this.arith(node.step);
            await this.stepCheck();
          }
          return st;
        });
      }
      case 'while': {
        return this.withRedirs(node.redirs, io, async (io2) => {
          let st = 0;
          for (;;) {
            const cs = await this.execNode(node.cond, io2);
            if (node.until ? cs === 0 : cs !== 0) break;
            try {
              st = await this.execNode(node.body, io2);
            } catch (e) {
              if (e instanceof BreakEx) {
                if (e.n > 1) throw new BreakEx(e.n - 1);
                break;
              }
              if (e instanceof ContinueEx) {
                if (e.n > 1) throw new ContinueEx(e.n - 1);
                continue;
              }
              throw e;
            }
          }
          return st;
        });
      }
      case 'case': {
        return this.withRedirs(node.redirs, io, async (io2) => {
          const w = await this.expandString(node.word);
          for (const cl of node.clauses) {
            for (const pw of cl.patterns) {
              const pat = await this.expandPattern(pw);
              if (globMatch(pat, w)) return this.execNode(cl.body, io2);
            }
          }
          return 0;
        });
      }
      case 'group': {
        return this.withRedirs(node.redirs, io, async (io2) => {
          if (node.subshell) {
            const sub = this.clone();
            try {
              return await sub.execNode(node.body, io2);
            } catch (e) {
              if (e instanceof ExitEx) return e.code;
              throw e;
            }
          }
          return this.execNode(node.body, io2);
        });
      }
      case 'func':
        this.funcs.set(node.name, node.body);
        return 0;
      case 'arith': {
        return this.withRedirs(node.redirs, io, async () => {
          const expr = await this.expandString([{ t: 'lit', s: node.expr }]);
          return this.arith(expr) !== 0 ? 0 : 1;
        });
      }
      case 'dbracket': {
        return this.withRedirs(node.redirs, io, async () => {
          const toks: TestTok[] = [];
          for (const w of node.words) {
            const s = await this.expandString(w);
            const pat = await this.expandPattern(w);
            toks.push({ s, pat });
          }
          return evalTest(this, toks, true);
        });
      }
    }
  }

  // ───────────────────────── pipelines ─────────────────────────

  private async execPipeline(node: Extract<Node, { type: 'pipeline' }>, io: IO): Promise<number> {
    let data = '';
    let st = 0;
    const n = node.cmds.length;
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      let buf = '';
      const stageIo: IO = {
        stdin: i === 0 ? io.stdin : new BufferStdin(data),
        out: last ? io.out : (s) => (buf += s),
        err: io.err,
        tty: last ? io.tty : false,
      };
      const sub = n > 1 ? this.clone() : this;
      try {
        st = await sub.execNode(node.cmds[i], stageIo);
      } catch (e) {
        if (e instanceof ExitEx) st = e.code;
        else throw e;
      }
      statuses.push(st);
      data = buf;
    }
    if (this.opts.has('pipefail')) st = [...statuses].reverse().find((s) => s !== 0) ?? 0;
    return node.negate ? (st === 0 ? 1 : 0) : st;
  }

  // ───────────────────────── redirecciones ─────────────────────────

  private async withRedirs(
    redirs: Redir[],
    io: IO,
    fn: (io: IO) => Promise<number>,
  ): Promise<number> {
    if (!redirs.length) return fn(io);
    const r = await this.applyRedirs(redirs, io);
    if (!r) return 1;
    return fn(r);
  }

  private fileSink(abs: string, append: boolean, display: string, io: IO): ((s: string) => void) | null {
    if (abs === '/dev/null') return () => {};
    if (abs === '/dev/stdout') return io.out;
    if (abs === '/dev/stderr') return io.err;
    if (abs === '/dev/tty') return this.rt.termWrite ? (s) => this.rt.termWrite!(s, false) : io.out;
    try {
      const ex = this.fs.stat(abs, this.cred);
      if (ex && ex.kind === 'dir') throw new FsError('EISDIR', abs);
      this.fs.writeFile(abs, '', { append, cred: this.cred, mode: 0o666 & ~this.umask });
    } catch (e) {
      io.err(`bash: ${display}: ${(e as Error).message}\n`);
      return null;
    }
    return (s) => {
      try {
        this.fs.writeFile(abs, s, { append: true, cred: this.cred });
      } catch {
        /* ignore */
      }
    };
  }

  async applyRedirs(redirs: Redir[], io: IO): Promise<IO | null> {
    let stdin = io.stdin;
    let out = io.out;
    let err = io.err;
    let tty = io.tty;
    for (const r of redirs) {
      const fd = r.fd ?? (r.op.startsWith('<') ? 0 : 1);
      if (r.op === '<<') {
        const h = r.heredoc!;
        const body = h.quoted ? h.body : await this.expandHeredoc(h.body);
        stdin = new BufferStdin(body);
        continue;
      }
      const target = await this.expandString(r.target);
      if (r.op === '<<<') {
        stdin = new BufferStdin(target + '\n');
        continue;
      }
      if (r.op === '<') {
        const abs = this.abs(target);
        try {
          const node = this.fs.lookup(abs, this.cred);
          if (node.kind === 'dir') throw new FsError('EISDIR', abs);
          stdin = new BufferStdin(abs === '/dev/null' ? '' : this.fs.readFile(abs, this.cred));
        } catch (e) {
          io.err(`bash: ${target}: ${(e as Error).message}\n`);
          return null;
        }
        continue;
      }
      if (r.op === '>&' || r.op === '<&') {
        if (/^[0-9]+$/.test(target)) {
          const t = parseInt(target, 10);
          const src = t === 2 ? err : t === 1 ? out : () => {};
          if (fd === 1) out = src;
          else if (fd === 2) err = src;
          if (fd === 1 && t === 2) tty = false;
          continue;
        }
        if (target === '-') {
          if (fd === 1) out = () => {};
          else if (fd === 2) err = () => {};
          continue;
        }
        // >& archivo  ==  &> archivo
        const sink = this.fileSink(this.abs(target), false, target, io);
        if (!sink) return null;
        out = sink;
        err = sink;
        tty = false;
        continue;
      }
      if (r.op === '&>' || r.op === '&>>') {
        const sink = this.fileSink(this.abs(target), r.op === '&>>', target, io);
        if (!sink) return null;
        out = sink;
        err = sink;
        tty = false;
        continue;
      }
      // > >> >|
      const sink = this.fileSink(this.abs(target), r.op === '>>', target, io);
      if (!sink) return null;
      if (fd === 1) {
        out = sink;
        tty = false;
      } else if (fd === 2) err = sink;
    }
    return { stdin, out, err, tty };
  }

  private async expandHeredoc(body: string): Promise<string> {
    return this.expandString(lexDqBody(body));
  }

  // ───────────────────────── comandos simples ─────────────────────────

  private async applyAssign(a: Assign) {
    const valueWord = a.value;
    if (valueWord.length === 1 && valueWord[0].t === 'arr') {
      const items = await this.expandFields(valueWord[0].words);
      if (a.append) {
        const cur = this.vars.get(a.name);
        this.setArray(a.name, [...(cur?.arr ?? (cur ? [cur.value] : [])), ...items]);
      } else this.setArray(a.name, items);
      return;
    }
    const val = await this.expandString(valueWord);
    if (a.sub !== null) {
      const cur = this.vars.get(a.name);
      const arr = cur?.arr ? [...cur.arr] : cur ? [cur.value] : [];
      const idx = this.arith(a.sub);
      while (arr.length < idx) arr.push('');
      arr[idx] = a.append ? (arr[idx] ?? '') + val : val;
      this.setArray(a.name, arr);
      return;
    }
    if (a.append) {
      const cur = this.vars.get(a.name);
      if (cur?.arr) {
        const arr = [...cur.arr];
        arr[0] = (arr[0] ?? '') + val;
        this.setArray(a.name, arr);
      } else this.setVar(a.name, (cur?.value ?? '') + val);
      return;
    }
    const cur = this.vars.get(a.name);
    if (cur?.arr) {
      const arr = [...cur.arr];
      arr[0] = val;
      this.setArray(a.name, arr);
    } else this.setVar(a.name, val);
  }

  private async execSimple(node: Extract<Node, { type: 'simple' }>, io: IO): Promise<number> {
    let argv: string[];
    try {
      argv = await this.expandFields(node.words);
    } catch (e) {
      if (e instanceof ShellError) {
        io.err(`bash: ${e.message}\n`);
        return e.code;
      }
      throw e;
    }
    if (argv.length === 0) {
      try {
        for (const a of node.assigns) await this.applyAssign(a);
      } catch (e) {
        if (e instanceof ShellError) {
          io.err(`bash: ${e.message}\n`);
          return e.code;
        }
        throw e;
      }
      if (node.redirs.length) {
        const r = await this.applyRedirs(node.redirs, io);
        if (!r) return 1;
      }
      return 0;
    }
    let target: Shell = this;
    if (node.assigns.length) {
      target = this.clone();
      for (const a of node.assigns) {
        const val = await this.expandString(a.value);
        target.setVar(a.name, val, true);
      }
    }
    const io2 = node.redirs.length ? await this.applyRedirs(node.redirs, io) : io;
    if (!io2) return 1;
    if (this.opts.has('x')) io.err(`+ ${argv.map(shellQuote).join(' ')}\n`);
    target.io = io2;
    try {
      return await target.dispatch(argv, io2, node.line);
    } catch (e) {
      if (e instanceof ShellError) {
        io2.err(`bash: ${e.message}\n`);
        return e.code;
      }
      throw e;
    }
  }

  // ───────────────────────── despacho ─────────────────────────

  /** Busca un ejecutable en PATH (el VFS) y devuelve su ruta y definición. */
  findInPath(name: string): { path: string; def?: CommandDef } | null {
    const path = this.getVar('PATH') ?? '/usr/bin:/bin';
    for (const dir of path.split(':')) {
      if (!dir) continue;
      const p = (dir.startsWith('/') ? dir : resolve(this.cwd, dir)) + '/' + name;
      const n = this.fs.stat(p, this.cred);
      if (n && n.kind === 'file' && (n.mode & 0o111) !== 0) {
        const m = /^\x7fELF[^@]*@@([^\s@]+)@@/.exec(n.content);
        if (m) {
          const def = REGISTRY.get(m[1]);
          if (def) return { path: p, def };
        }
        return { path: p };
      }
    }
    return null;
  }

  resolveCommand(
    name: string,
  ): { kind: 'alias' | 'function' | 'builtin' | 'file' | 'none'; path?: string; def?: CommandDef } {
    if (this.aliases.has(name)) return { kind: 'alias' };
    if (this.funcs.has(name)) return { kind: 'function' };
    if (SHELL_BUILTINS.has(name) && REGISTRY.has(name)) return { kind: 'builtin', def: REGISTRY.get(name) };
    const f = this.findInPath(name);
    if (f) return { kind: 'file', path: f.path, def: f.def };
    return { kind: 'none' };
  }

  makeCtx(name: string, args: string[], io: IO, def?: CommandDef): Ctx {
    const sh = this;
    return {
      name,
      args,
      sh,
      fs: this.fs,
      cred: this.cred,
      stdin: io.stdin,
      io,
      tty: io.tty,
      cols: this.rt.cols,
      out: io.out,
      err: io.err,
      abs: (p) => sh.abs(p),
      fail(msg, code = 1) {
        io.err(`${name}: ${msg}\n`);
        return code;
      },
      fsfail(e, path) {
        io.err(`${name}: ${path}: ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      },
    };
  }

  async dispatch(argv: string[], io: IO, text?: string): Promise<number> {
    const name = argv[0];
    const args = argv.slice(1);
    this.sys.commandLog.push(argv.join(' '));

    // alias
    if (this.aliases.has(name) && !this.noAlias.has(name)) {
      const line = [this.aliases.get(name)!, ...args.map(shellQuote)].join(' ');
      const sub = this.clone();
      sub.noAlias.add(name);
      return sub.runLine(line, io);
    }
    // función
    if (this.funcs.has(name)) return this.callFunction(name, args, io);

    // ruta explícita
    if (name.includes('/')) return this.runPath(name, args, io);

    // builtin del shell
    if (SHELL_BUILTINS.has(name)) {
      const def = REGISTRY.get(name);
      if (def) return this.runDef(def, name, args, io);
    }
    const f = this.findInPath(name);
    if (f) {
      if (f.def) return this.runDef(f.def, name, args, io);
      return this.runScriptFile(f.path, name, args, io);
    }
    return this.notFound(name, io);
  }

  notFound(name: string, io: IO): number {
    const def = REGISTRY.get(name);
    if (def?.package && !this.sys.pkgInstalled(def.package)) {
      io.err(
        `Command '${name}' not found, but can be installed with:\n\nsudo apt install ${def.package}\n`,
      );
    } else io.err(`${name}: command not found\n`);
    return 127;
  }

  async runDef(def: CommandDef, name: string, args: string[], io: IO): Promise<number> {
    if (!def.noHelp && args.includes('--help')) {
      io.out(helpText(def));
      return 0;
    }
    const ctx = this.makeCtx(name, args, io, def);
    try {
      const r = await def.run(ctx);
      return typeof r === 'number' ? r : 0;
    } catch (e) {
      if (e instanceof UsageError) {
        if (e.message) io.err(e.message + '\n');
        return e.code;
      }
      if (e instanceof SignalEx && e.sig === 'INT') throw e;
      throw e;
    }
  }

  private async callFunction(name: string, args: string[], io: IO): Promise<number> {
    const body = this.funcs.get(name)!;
    if (this.funcDepth > 100) {
      io.err(`bash: ${name}: maximum function nesting level exceeded\n`);
      return 1;
    }
    const savedPos = this.positional;
    this.positional = args;
    const frame = new Map<string, Var | undefined>();
    this.localStack.push(frame);
    this.funcDepth++;
    try {
      return await this.execNode(body, io);
    } catch (e) {
      if (e instanceof ReturnEx) return e.code;
      throw e;
    } finally {
      this.funcDepth--;
      this.localStack.pop();
      this.positional = savedPos;
      for (const [k, v] of frame) {
        if (v === undefined) this.vars.delete(k);
        else this.vars.set(k, v);
      }
    }
  }

  private async runPath(name: string, args: string[], io: IO): Promise<number> {
    const abs = this.abs(name);
    let node;
    try {
      node = this.fs.walk(abs, { cred: this.cred }).node;
    } catch (e) {
      io.err(`bash: ${name}: ${(e as Error).message}\n`);
      return e instanceof FsError && e.code === 'EACCES' ? 126 : 127;
    }
    if (!node) {
      io.err(`bash: ${name}: No such file or directory\n`);
      return 127;
    }
    if (node.kind === 'dir') {
      io.err(`bash: ${name}: Is a directory\n`);
      return 126;
    }
    if (!this.fs.can(node, this.cred, 'x')) {
      io.err(`bash: ${name}: Permission denied\n`);
      return 126;
    }
    const m = /^\x7fELF[^@]*@@([^\s@]+)@@/.exec(node.content);
    if (m && REGISTRY.has(m[1])) return this.runDef(REGISTRY.get(m[1])!, basename(name), args, io);
    return this.runScriptFile(abs, name, args, io);
  }

  async runScriptFile(abs: string, name: string, args: string[], io: IO): Promise<number> {
    let content: string;
    try {
      content = this.fs.readFile(abs, this.cred);
    } catch (e) {
      io.err(`bash: ${name}: ${(e as Error).message}\n`);
      return 126;
    }
    if (content.startsWith('\x7fELF')) {
      io.err(`bash: ${name}: cannot execute binary file\n`);
      return 126;
    }
    const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(content);
    if (m) {
      const interp = basename(m[1] === '/usr/bin/env' && m[2] ? m[2] : m[1]);
      if (!['bash', 'sh', 'dash', 'zsh', 'ksh'].includes(interp)) {
        io.err(`bash: ${name}: ${m[1]}: bad interpreter: No such file or directory\n`);
        return 126;
      }
    }
    return this.runScript(content, name, args, io);
  }

  async runScript(content: string, name: string, args: string[], io: IO): Promise<number> {
    const sub = this.forkExec();
    sub.positional = args;
    sub.scriptName = name;
    sub.interactive = false;
    sub.funcDepth = 0;
    try {
      const node = parse(content);
      return await sub.execNode(node, { ...io, tty: io.tty });
    } catch (e) {
      if (e instanceof ExitEx) return e.code;
      if (e instanceof ReturnEx) return e.code;
      if (e instanceof ParseError) {
        io.err(`${name}: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
  }

  /** Ejecuta un argv ya expandido (xargs, find -exec, sudo, env, time…). */
  async runArgv(argv: string[], io: IO): Promise<number> {
    if (argv.length === 0) return 0;
    return this.dispatch(argv, io);
  }

  // ───────────────────────── segundo plano ─────────────────────────

  private async runBackground(node: Node, text: string, io: IO): Promise<number> {
    const sub = this.clone();
    sub.bg = true;
    const buf: { s: string; err: boolean }[] = [];
    const proc = this.sys.spawn(this.user, text.replace(/\s*&$/, ''), {
      ppid: this.pid,
      tty: 'pts/0',
    });
    const job: Job = {
      id: this.rt.nextJobId++,
      pid: proc.pid,
      text: text.replace(/\s*&$/, ''),
      state: 'running',
      startedAt: this.sys.clock.now,
      endsAt: this.sys.clock.now,
      buf,
      status: 0,
    };
    sub.bgJob = job;
    this.rt.jobs.push(job);
    this.rt.lastBgPid = proc.pid;
    io.err(`[${job.id}] ${proc.pid}\n`);
    const bgIo: IO = {
      stdin: EMPTY_STDIN(),
      out: (s) => buf.push({ s, err: false }),
      err: (s) => buf.push({ s, err: true }),
      tty: false,
    };
    try {
      job.status = await sub.execNode(node, bgIo);
    } catch (e) {
      if (e instanceof ExitEx) job.status = e.code;
      else if (!(e instanceof SignalEx)) throw e;
    }
    return 0;
  }

  /** Marca terminados los jobs cuyo tiempo virtual pasó y devuelve texto a mostrar. */
  reapJobs(): { s: string; err: boolean }[] {
    const out: { s: string; err: boolean }[] = [];
    const now = this.sys.clock.now;
    const jobs = this.rt.jobs;
    for (const j of [...jobs]) {
      if (j.state === 'running' && j.endsAt === Infinity && j.buf.length) out.push(...j.buf.splice(0));
      if (j.state === 'running' && now >= j.endsAt) {
        j.state = 'done';
        this.sys.killProc(j.pid);
        out.push(...j.buf);
        const mark = this.jobMark(j);
        out.push({
          s: `[${j.id}]${mark}  ${j.status === 0 ? 'Done' : 'Exit ' + j.status}`.padEnd(30) + j.text + '\n',
          err: true,
        });
        jobs.splice(jobs.indexOf(j), 1);
      } else if (j.state === 'killed') {
        const mark = this.jobMark(j);
        out.push({ s: `[${j.id}]${mark}  Terminated`.padEnd(30) + j.text + '\n', err: true });
        jobs.splice(jobs.indexOf(j), 1);
      }
    }
    return out;
  }

  jobMark(j: Job): string {
    const live = this.rt.jobs.filter((x) => x.state !== 'done');
    const last = live[live.length - 1];
    const prev = live[live.length - 2];
    return j === last ? '+' : j === prev ? '-' : ' ';
  }

  findJob(spec: string | undefined): Job | undefined {
    const live = this.rt.jobs.filter((x) => x.state !== 'done');
    if (!spec || spec === '%' || spec === '%%' || spec === '%+') return live[live.length - 1];
    if (spec === '%-') return live[live.length - 2];
    const m = /^%?(\d+)$/.exec(spec);
    if (m) return live.find((j) => j.id === parseInt(m[1], 10));
    if (spec.startsWith('%?')) return live.find((j) => j.text.includes(spec.slice(2)));
    if (spec.startsWith('%')) return live.find((j) => j.text.startsWith(spec.slice(1)));
    return undefined;
  }

  // ───────────────────────── utilidades ─────────────────────────

  /** Espera de tiempo virtual: en segundo plano solo acumula duración del trabajo. */
  async sleep(ms: number): Promise<void> {
    if (this.bg && this.bgJob) {
      this.bgJob.endsAt += ms;
      if (this.bgJob.endsAt - this.bgJob.startedAt > 3600000) {
        this.bgJob.endsAt = Infinity;
        if (this.bgJob.buf.length > 200) this.bgJob.buf.splice(0, this.bgJob.buf.length - 200);
        throw new ExitEx(0);
      }
      return;
    }
    return this.rt.sleep(this.sys, ms);
  }

  /** Captura la salida de ejecutar `line` (útil para tests y comandos). */
  async capture(line: string, stdin: Stdin = EMPTY_STDIN()): Promise<{ out: string; err: string; status: number }> {
    let out = '';
    let err = '';
    const st = await this.runLine(line, {
      stdin,
      out: (s) => (out += s),
      err: (s) => (err += s),
      tty: false,
    });
    return { out, err, status: st };
  }
}

function findUnescaped(s: string, ch: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === ch) return i;
  }
  return -1;
}

function splitOnce(s: string, ch: string): [string, string | undefined] {
  const i = s.indexOf(ch);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

/** Convierte el cuerpo de un heredoc sin comillas en una Word (como dentro de ""). */
function lexDqBody(body: string): Word {
  const parts: Word = [];
  let lit = '';
  const flush = () => {
    if (lit) {
      parts.push({ t: 'sq', s: lit });
      lit = '';
    }
  };
  const dq: import('./parser').DqPart[] = [];
  const flushDq = () => {
    if (lit) {
      dq.push({ t: 'lit', s: lit });
      lit = '';
    }
  };
  void flush;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\' && '$`\\'.includes(body[i + 1] ?? '')) {
      lit += body[i + 1];
      i += 2;
      continue;
    }
    if (c === '$' && body[i + 1] === '(' ) {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '(') depth++;
        else if (body[j] === ')') depth--;
        j++;
      }
      flushDq();
      if (body[i + 2] === '(') {
        dq.push({ t: 'arith', expr: body.slice(i + 3, j - 2) });
      } else dq.push({ t: 'cmd', src: body.slice(i + 2, j - 1) });
      i = j;
      continue;
    }
    if (c === '$' && body[i + 1] === '{') {
      const e = body.indexOf('}', i);
      if (e > 0) {
        flushDq();
        const inner = body.slice(i + 2, e);
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/.exec(inner);
        if (m) dq.push({ t: 'param', name: m[1], op: m[2] !== undefined ? ':-' : undefined, arg: m[2] !== undefined ? [{ t: 'lit', s: m[2] }] : undefined });
        else dq.push({ t: 'lit', s: '${' + inner + '}' });
        i = e + 1;
        continue;
      }
    }
    if (c === '$' && /[A-Za-z_]/.test(body[i + 1] ?? '')) {
      let j = i + 1;
      while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) j++;
      flushDq();
      dq.push({ t: 'param', name: body.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (c === '$' && /[0-9?@*#$!]/.test(body[i + 1] ?? '')) {
      flushDq();
      dq.push({ t: 'param', name: body[i + 1] });
      i += 2;
      continue;
    }
    lit += c;
    i++;
  }
  flushDq();
  return [{ t: 'dq', parts: dq }];
}

export { dirname, join, normalize };
