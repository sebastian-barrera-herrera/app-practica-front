/**
 * Terminal: sesión interactiva sobre un Shell. Gestiona entrada de teclado
 * (líneas, Ctrl+C/Z/D), salida en streaming, historial, trabajos y autocompletado.
 */
import './commands';
import { stripAnsi } from './format';
import { isIncomplete } from './parser';
import { REGISTRY, type IO, type Stdin } from './registry';
import { ExitEx, Runtime, Shell, ShellError, SignalEx, SHELL_BUILTINS, TimeoutEx, type Job } from './shell';
import { VFS } from './vfs';
import { applyFiles, createWorld, LAB_FILES, type World, type WorldOptions } from './world';
import { collate } from './vfs';
import { basename } from './path';

export interface Chunk {
  s: string;
  err: boolean;
}

export interface RunRecord {
  line: string;
  stdout: string;
  stderr: string;
  status: number;
  /** Comandos individuales ejecutados (incluye los de pipes y subshells). */
  commands: string[];
  at: number;
}

class TermStdin implements Stdin {
  isTTY = true;
  private queue: string[] = [];
  private waiter: { resolve: (v: string | null) => void; reject: (e: unknown) => void } | null = null;
  private eof = false;

  push(line: string) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve(line);
    } else this.queue.push(line);
  }

  closeInput() {
    this.eof = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve(null);
    }
  }

  interrupt(sig: 'INT' | 'TSTP') {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(new SignalEx(sig));
    }
  }

  get waiting() {
    return this.waiter !== null;
  }

  readLine(): Promise<string | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.eof) {
      this.eof = false;
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  async readAll(): Promise<string> {
    let out = '';
    for (;;) {
      const l = await this.readLine();
      if (l === null) break;
      out += l + '\n';
    }
    return out;
  }
}

export interface TerminalOptions extends WorldOptions {
  cols?: number;
  /** Mundo ya creado (en lugar de crear uno nuevo). */
  world?: World;
}

export class Terminal {
  world: World;
  shell: Shell;
  rt: Runtime;
  /** Pila de sesiones: la última es la activa. Se usa con ssh. */
  private sessions: { shell: Shell; label: string; world: World }[] = [];
  history: string[] = [];
  busy = false;
  ended = false;
  runs: RunRecord[] = [];
  /** Se invoca por cada trozo de salida (streaming). */
  onOutput: (c: Chunk) => void = () => {};
  onBusy: (busy: boolean) => void = () => {};
  onSession: () => void = () => {};
  private stdin = new TermStdin();
  private capture: Chunk[] | null = null;
  private baseOptions: TerminalOptions;
  private initFiles: boolean;

  constructor(opts: TerminalOptions = {}) {
    this.baseOptions = opts;
    this.initFiles = true;
    this.world = opts.world ?? createWorld(opts);
    this.shell = this.world.shell;
    this.rt = this.world.rt;
    this.rt.cols = opts.cols ?? 40;
    this.rt.termWrite = (s, err) => this.emit(s, err);
    this.sessions = [{ shell: this.shell, label: 'local', world: this.world }];
    this.sourceBashrc();
    this.history = [...this.shell.history];
  }

  private sourceBashrc() {
    try {
      const rc = this.shell.fs.readFile(`${this.shell.home()}/.bashrc`, null);
      for (const m of rc.matchAll(/^alias\s+(\w+)='([^']*)'/gm)) this.shell.aliases.set(m[1], m[2]);
      for (const m of rc.matchAll(/^export\s+(\w+)=(.*)$/gm)) this.shell.setVar(m[1], m[2].replace(/^["']|["']$/g, ''), true);
    } catch {
      /* sin bashrc */
    }
  }

  get fs(): VFS {
    return this.shell.fs;
  }

  get sys() {
    return this.world.sys;
  }

  setCols(n: number) {
    this.rt.cols = n;
    for (const s of this.sessions) s.world.rt.cols = n;
  }

  prompt(): string {
    return this.shell.promptString();
  }

  /** Etiqueta de sesión remota activa, si la hay. */
  get remoteLabel(): string | null {
    return this.sessions.length > 1 ? this.sessions[this.sessions.length - 1].label : null;
  }

  isIncomplete(text: string): boolean {
    return isIncomplete(text);
  }

  private emit(s: string, err: boolean) {
    if (!s) return;
    if (this.capture) this.capture.push({ s, err });
    this.onOutput({ s, err });
  }

  // ───────────────────────── ejecución ─────────────────────────

  /** Expansión de historial (!!, !$, !n, !cadena). Devuelve null si no hay. */
  private expandHistory(line: string): string | null {
    if (!/!/.test(line)) return null;
    let changed = false;
    // fuera de comillas simples
    let out = '';
    let inSingle = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'") inSingle = !inSingle;
      if (ch === '!' && !inSingle && i + 1 < line.length && !/[\s=]/.test(line[i + 1])) {
        const rest = line.slice(i + 1);
        const h = this.history;
        let m: RegExpExecArray | null;
        if (rest.startsWith('!')) {
          out += h[h.length - 1] ?? '';
          i += 1;
          changed = true;
          continue;
        }
        if (rest.startsWith('$')) {
          const last = (h[h.length - 1] ?? '').trim().split(/\s+/);
          out += last[last.length - 1] ?? '';
          i += 1;
          changed = true;
          continue;
        }
        if ((m = /^(-?\d+)/.exec(rest))) {
          const n = parseInt(m[1], 10);
          out += (n < 0 ? h[h.length + n] : h[n - 1]) ?? '';
          i += m[1].length;
          changed = true;
          continue;
        }
        if ((m = /^([A-Za-z_./-][\w./-]*)/.exec(rest))) {
          const found = [...h].reverse().find((x) => x.startsWith(m![1]));
          if (found) {
            out += found;
            i += m[1].length;
            changed = true;
            continue;
          }
          this.emit(`bash: !${m[1]}: event not found\n`, true);
          return '';
        }
      }
      out += ch;
    }
    return changed ? out : null;
  }

  /** Ejecuta una línea completa (o entrega la línea como entrada si hay un comando esperándola). */
  async run(line: string, opts: { silent?: boolean } = {}): Promise<RunRecord | null> {
    if (this.ended) return null;
    if (this.busy) {
      this.stdin.push(line);
      return null;
    }
    const raw = line;
    let text = line;
    const expanded = this.expandHistory(text);
    if (expanded !== null) {
      if (expanded === '') return null;
      text = expanded;
      this.emit(text + '\n', false);
    }
    if (text.trim() === '') return null;
    if (!raw.startsWith(' ')) {
      this.history.push(text);
      this.shell.history.push(text);
    }
    this.busy = true;
    this.onBusy(true);
    this.stdin = new TermStdin();
    const startLog = this.sys.commandLog.length;
    const rec: RunRecord = { line: text, stdout: '', stderr: '', status: 0, commands: [], at: this.sys.clock.now };
    const io: IO = {
      stdin: this.stdin,
      out: (s) => {
        rec.stdout += s;
        this.emit(s, false);
      },
      err: (s) => {
        rec.stderr += s;
        this.emit(s, true);
      },
      tty: true,
    };
    let status = 0;
    try {
      status = await this.shell.runLine(text, io);
    } catch (e) {
      status = this.handleThrown(e, text, rec);
    }
    this.shell.lastStatus = status;
    rec.status = status;
    rec.commands = this.sys.commandLog.slice(startLog);
    // trabajos terminados
    for (const c of this.shell.reapJobs()) this.emit(c.s, c.err);
    // tiempo virtual
    this.sys.clock.now += 1000;
    // sesión remota solicitada por ssh
    if (this.rt.pendingSession) {
      const ps = this.rt.pendingSession;
      this.rt.pendingSession = null;
      this.pushSession(ps);
    }
    this.rt.signal = null;
    this.rt.steps = 0;
    this.busy = false;
    this.runs.push({ ...rec, stdout: stripAnsi(rec.stdout), stderr: stripAnsi(rec.stderr) });
    if (this.runs.length > 200) this.runs.splice(0, this.runs.length - 200);
    this.onBusy(false);
    void opts;
    return rec;
  }

  private handleThrown(e: unknown, text: string, rec: RunRecord): number {
    if (e instanceof ExitEx) {
      return this.handleExit(e.code);
    }
    if (e instanceof SignalEx) {
      if (e.sig === 'INT') return 130;
      // Ctrl+Z: el comando queda detenido como trabajo
      const sh = this.shell;
      const proc = this.sys.spawn(sh.user, text, { ppid: sh.pid, tty: 'pts/0', state: 'T' });
      const job: Job = {
        id: this.rt.nextJobId++,
        pid: proc.pid,
        text,
        state: 'stopped',
        startedAt: this.sys.clock.now,
        endsAt: this.sys.clock.now,
        remainingMs: e.remainingMs || undefined,
        buf: [],
        status: 0,
        resumeLine: text,
      };
      this.rt.jobs.push(job);
      this.emit(`\n[${job.id}]${sh.jobMark(job)}  Stopped`.padEnd(32) + text + '\n', true);
      return 148;
    }
    if (e instanceof TimeoutEx) return 124;
    if (e instanceof ShellError) {
      rec.stderr += `bash: ${e.message}\n`;
      this.emit(`bash: ${e.message}\n`, true);
      return e.code;
    }
    const msg = e instanceof Error ? e.message : String(e);
    this.emit(`bash: error interno del simulador: ${msg}\n`, true);
    return 1;
  }

  private handleExit(code: number): number {
    const sh = this.shell;
    if (sh.userStack.length) {
      const prev = sh.userStack.pop()!;
      sh.setUser(prev);
      const cwd = sh.savedCwd.pop();
      if (cwd) {
        sh.cwd = cwd;
        sh.setVar('PWD', cwd, true);
      }
      return code;
    }
    if (this.sessions.length > 1) {
      const s = this.sessions.pop()!;
      this.shell = this.sessions[this.sessions.length - 1].shell;
      this.world = this.sessions[this.sessions.length - 1].world;
      this.rt = this.world.rt;
      this.emit(`logout\nConnection to ${s.label.split('@').pop()} closed.\n`, false);
      this.onSession();
      return code;
    }
    this.emit('logout\n', false);
    this.ended = true;
    return code;
  }

  private pushSession(ps: { shell: Shell; host: string; user: string }) {
    this.sessions.push({ shell: ps.shell, label: `${ps.user}@${ps.host}`, world: this.sessions[this.sessions.length - 1].world });
    // el mundo remoto está dentro de sys.remotes; buscamos el correspondiente por shell
    for (const w of this.world.sys.remotes.values() as Iterable<World>) {
      if (w.shell.sys === ps.shell.sys) this.sessions[this.sessions.length - 1].world = w;
    }
    const top = this.sessions[this.sessions.length - 1];
    top.world.rt.cols = this.rt.cols;
    top.world.rt.termWrite = this.rt.termWrite;
    top.world.rt.editor = this.rt.editor;
    this.shell = ps.shell;
    this.world = top.world;
    this.rt = top.world.rt;
    this.onSession();
  }

  /** Ejecuta y devuelve la salida (útil en tests y ejercicios automáticos). */
  async exec(line: string): Promise<{ out: string; err: string; text: string; status: number }> {
    const chunks: Chunk[] = [];
    this.capture = chunks;
    // los comandos escritos mientras está ocupado se entregan como entrada
    const rec = await this.run(line);
    this.capture = null;
    const out = chunks.filter((c) => !c.err).map((c) => c.s).join('');
    const err = chunks.filter((c) => c.err).map((c) => c.s).join('');
    return { out: stripAnsi(out), err: stripAnsi(err), text: stripAnsi(chunks.map((c) => c.s).join('')), status: rec?.status ?? 0 };
  }

  /** Teclas especiales: Ctrl+C, Ctrl+Z, Ctrl+D. */
  signal(sig: 'INT' | 'TSTP' | 'EOF') {
    if (!this.busy) return;
    if (sig === 'EOF') {
      this.stdin.closeInput();
      return;
    }
    if (sig === 'INT') this.emit('^C\n', false);
    if (sig === 'TSTP') this.emit('^Z', false);
    this.rt.raise(sig);
    this.stdin.interrupt(sig);
  }

  get waitingForInput(): boolean {
    return this.busy && this.stdin.waiting;
  }

  /** Sustituye el editor integrado (nano/vim) por una función de la UI. */
  setEditor(fn: Runtime['editor']) {
    this.rt.editor = fn;
    for (const s of this.sessions) s.world.rt.editor = fn;
  }

  // ───────────────────────── autocompletado ─────────────────────────

  complete(line: string): { start: number; options: string[] } {
    const m = /(?:^|[\s|;&(])([^\s|;&()]*)$/.exec(line);
    const word = m ? m[1] : '';
    const start = line.length - word.length;
    const before = line.slice(0, start).trim();
    const isCommand = before === '' || /[|;&(]$/.test(before) || /^(sudo|time|xargs|nohup|watch|env)$/.test(before.split(/\s+/).pop() ?? '') && before.split(/\s+/).length <= 2;
    const sh = this.shell;
    let options: string[] = [];
    if (word.startsWith('$')) {
      const prefix = word.slice(1);
      options = [...sh.vars.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => '$' + k);
      return { start, options };
    }
    if (isCommand && !word.includes('/')) {
      const set = new Set<string>();
      for (const a of sh.aliases.keys()) set.add(a);
      for (const f of sh.funcs.keys()) set.add(f);
      for (const b of SHELL_BUILTINS) if (REGISTRY.has(b)) set.add(b);
      for (const dir of (sh.getVar('PATH') ?? '').split(':')) {
        try {
          for (const n of sh.fs.readdir(dir, sh.cred)) {
            const node = sh.fs.stat(`${dir}/${n}`, sh.cred);
            if (node && node.kind === 'file' && node.mode & 0o111) set.add(n);
          }
        } catch {
          /* directorio inexistente */
        }
      }
      options = [...set].filter((n) => n.startsWith(word)).sort(collate);
      return { start, options };
    }
    // rutas
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const filePart = slash >= 0 ? word.slice(slash + 1) : word;
    const dirAbs = dirPart === '' ? sh.cwd : sh.abs(dirPart);
    const cmdName = before.split(/\s+/)[0];
    const onlyDirs = ['cd', 'pushd', 'rmdir'].includes(cmdName);
    try {
      for (const n of sh.fs.readdir(dirAbs, sh.cred)) {
        if (!n.startsWith(filePart)) continue;
        if (n.startsWith('.') && !filePart.startsWith('.')) continue;
        const node = sh.fs.stat(dirAbs.replace(/\/$/, '') + '/' + n, sh.cred);
        const isDir = node?.kind === 'dir';
        if (onlyDirs && !isDir) continue;
        options.push(dirPart + n + (isDir ? '/' : ''));
      }
    } catch {
      /* sin permiso */
    }
    return { start, options: options.sort(collate) };
  }

  // ───────────────────────── estado ─────────────────────────

  /** Ruta (con ~) para mostrar en la cabecera. */
  displayCwd(): string {
    const home = this.shell.home();
    return this.shell.cwd === home ? '~' : this.shell.cwd.startsWith(home + '/') ? '~' + this.shell.cwd.slice(home.length) : this.shell.cwd;
  }

  /** Reinicia el mundo (vuelve a empezar con las mismas opciones). */
  reset() {
    const t = new Terminal({ ...this.baseOptions, world: undefined });
    this.world = t.world;
    this.shell = t.shell;
    this.rt = t.rt;
    this.sessions = [{ shell: this.shell, label: 'local', world: this.world }];
    this.history = [...this.shell.history];
    this.runs = [];
    this.ended = false;
    this.busy = false;
    this.rt.termWrite = (s, err) => this.emit(s, err);
    this.rt.cols = this.baseOptions.cols ?? 40;
    this.sourceBashrc();
  }

  /** Último registro de ejecución. */
  get last(): RunRecord | undefined {
    return this.runs[this.runs.length - 1];
  }

  // ───────────────────────── persistencia ─────────────────────────

  snapshot(): unknown {
    const sys = this.world.sys;
    const sh = this.shell;
    return {
      v: 1,
      fs: this.world.fs.toJSON(),
      cwd: sh.cwd,
      user: sh.user,
      history: this.history.slice(-300),
      aliases: [...sh.aliases],
      env: sh.exportedEnv().filter(([k]) => !['HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'OLDPWD', 'PATH', 'LANG', 'TERM'].includes(k)),
      umask: sh.umask,
      clock: sys.clock.now,
      users: [...sys.users.values()],
      groups: [...sys.groups.values()].map((g) => ({ ...g, members: [...g.members] })),
      packages: [...sys.packages.values()].filter((p) => p.installed).map((p) => p.name),
      services: [...sys.services.values()],
      crontabs: [...sys.crontabs],
      hostname: sys.hostname,
    };
  }
}

export function restoreTerminal(snap: any, opts: TerminalOptions = {}): Terminal {
  const t = new Terminal({ ...opts, lab: false });
  if (!snap || snap.v !== 1) return t;
  try {
    const w = t.world;
    const fs = VFS.fromJSON(snap.fs, w.sys.clock);
    w.fs = fs;
    w.shell.fs = fs;
    w.sys.clock.now = snap.clock ?? w.sys.clock.now;
    w.sys.users.clear();
    for (const u of snap.users) w.sys.users.set(u.name, u);
    w.sys.groups.clear();
    for (const g of snap.groups) w.sys.groups.set(g.name, { ...g, members: new Set(g.members) });
    for (const p of w.sys.packages.values()) p.installed = snap.packages.includes(p.name);
    w.sys.services.clear();
    for (const s of snap.services) w.sys.services.set(s.name, s);
    w.sys.crontabs = new Map(snap.crontabs);
    w.sys.hostname = snap.hostname ?? w.sys.hostname;
    w.shell.setUser(snap.user);
    w.shell.cwd = fs.isDir(snap.cwd) ? snap.cwd : w.shell.home();
    w.shell.setVar('PWD', w.shell.cwd, true);
    w.shell.aliases = new Map(snap.aliases);
    for (const [k, v] of snap.env) w.shell.setVar(k, v, true);
    w.shell.umask = snap.umask ?? 0o022;
    t.history = snap.history ?? [];
    w.shell.history = [...t.history];
  } catch {
    return new Terminal({ ...opts, lab: false });
  }
  return t;
}

export { applyFiles, LAB_FILES, basename };
