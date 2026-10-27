/**
 * Un intérprete de shell mínimo y síncrono para las compilaciones de CodeBuild: variables, `&&`/`||`/`;`, tuberías, redirecciones,
 * `$(…)`, `if`/`for`, las órdenes de archivos más comunes, `aws`, `python3`, `pytest` y `pip`.
 * Corre sobre un sistema de archivos en memoria y con la cuenta de AWS compartida, y avanza el reloj de la cuenta.
 */
import { makeZip, zipFiles } from '../engine/commands/archive';
import { PySession } from '../pyengine/session';
import { runAwsSync } from './cli';
import type { AwsIO, LocalFile } from './registry';
import type { Account } from './types';

export interface ShellOpts {
  acct: Account;
  files: Map<string, string>;
  vars: Record<string, string>;
  cwd: string;
  /** Escribe una línea en el registro de la compilación. */
  log: (line: string) => void;
}

interface Result {
  code: number;
  out: string;
}

class Exit extends Error {
  constructor(public code: number) {
    super('exit');
  }
}

const norm = (p: string): string => {
  const out: string[] = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return '/' + out.join('/');
};

// ───────────────────────── análisis léxico ─────────────────────────

/** Divide un texto por operadores de nivel superior (fuera de comillas, `$(…)` y llaves). */
function splitTop(text: string, ops: string[]): { part: string; op: string }[] {
  const out: { part: string; op: string }[] = [];
  let cur = '';
  let q = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') cur += text[++i] ?? '';
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === '\\') {
      cur += c + (text[++i] ?? '');
      continue;
    }
    if (c === '$' && text[i + 1] === '(') {
      depth++;
      cur += '$(';
      i++;
      continue;
    }
    if (c === '(' ) depth++;
    if (c === ')' && depth > 0) depth--;
    if (depth === 0) {
      const hit = ops.find((o) => text.startsWith(o, i) && !(o === '|' && (text[i + 1] === '|' || text[i - 1] === '|')) && !(o === '&' && (text[i + 1] === '&' || text[i - 1] === '&' || text[i - 1] === '>' || text[i + 1] === '>')) && !(o === '>' && text[i - 1] === '2'));
      if (hit) {
        out.push({ part: cur, op: hit });
        cur = '';
        i += hit.length - 1;
        continue;
      }
    }
    cur += c;
  }
  out.push({ part: cur, op: '' });
  return out;
}

/** Palabras crudas (con sus comillas) separadas por espacios de nivel superior. */
function rawWords(text: string): string[] {
  const words: string[] = [];
  let cur = '';
  let q = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') cur += text[++i] ?? '';
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '\\') cur += c + (text[++i] ?? '');
    else if (c === '$' && text[i + 1] === '(') {
      depth++;
      cur += '$(';
      i++;
    } else if (c === ')' && depth > 0) {
      depth--;
      cur += c;
    } else if (/\s/.test(c) && depth === 0) {
      if (cur) words.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

type Node = { k: 'cmd'; text: string } | { k: 'if'; branches: { cond: Node[]; body: Node[] }[]; other: Node[] } | { k: 'for'; v: string; words: string; body: Node[] };

/** Convierte un guion en un árbol: órdenes sueltas y bloques `if` / `for`. */
function parseScript(script: string): Node[] {
  const units: string[] = [];
  for (const line of script.split('\n')) {
    for (const { part } of splitTop(line, [';'])) {
      const t = part.trim();
      if (t && !t.startsWith('#')) units.push(t);
    }
  }
  const expanded: string[] = [];
  for (const u of units) {
    const m = /^(then|else|do)\s+(.+)$/.exec(u);
    if (m) expanded.push(m[1], m[2]);
    else if (/^(elif)\s/.test(u) || /^(if)\s/.test(u) || /^(for)\s/.test(u)) expanded.push(u);
    else expanded.push(u);
  }
  let i = 0;
  const block = (stop: string[]): Node[] => {
    const nodes: Node[] = [];
    while (i < expanded.length && !stop.some((s) => expanded[i] === s || expanded[i].startsWith(s + ' '))) {
      const u = expanded[i++];
      if (u.startsWith('if ')) {
        const branches: { cond: Node[]; body: Node[] }[] = [];
        let other: Node[] = [];
        let cond: Node[] = [{ k: 'cmd', text: u.slice(3) }];
        for (;;) {
          if (expanded[i] !== 'then') throw new Error('syntax error: se esperaba «then»');
          i++;
          const body = block(['elif', 'else', 'fi']);
          branches.push({ cond, body });
          const nx = expanded[i++];
          if (nx === 'fi') break;
          if (nx === 'else') {
            other = block(['fi']);
            i++;
            break;
          }
          if (nx?.startsWith('elif ')) cond = [{ k: 'cmd', text: nx.slice(5) }];
          else throw new Error('syntax error: se esperaba «fi»');
        }
        nodes.push({ k: 'if', branches, other });
      } else if (u.startsWith('for ')) {
        const m = /^for\s+(\w+)\s+in\s+(.*)$/.exec(u);
        if (!m) throw new Error('syntax error en «for»');
        if (expanded[i] !== 'do') throw new Error('syntax error: se esperaba «do»');
        i++;
        const body = block(['done']);
        i++;
        nodes.push({ k: 'for', v: m[1], words: m[2], body });
      } else nodes.push({ k: 'cmd', text: u });
    }
    return nodes;
  };
  return block([]);
}

// ───────────────────────── el intérprete ─────────────────────────

export class MiniShell {
  vars: Record<string, string>;
  cwd: string;
  files: Map<string, string>;
  acct: Account;
  status = 0;
  private logFn: (l: string) => void;
  private depth = 0;

  constructor(o: ShellOpts) {
    this.vars = { ...o.vars };
    this.cwd = o.cwd;
    this.files = o.files;
    this.acct = o.acct;
    this.logFn = o.log;
  }

  abs(p: string): string {
    return norm(p.startsWith('/') ? p : `${this.cwd}/${p}`);
  }

  /** Ejecuta un guion (una orden de la compilación, que puede tener varias líneas). Devuelve el código de salida. */
  run(script: string): number {
    try {
      const nodes = parseScript(script);
      this.exec(nodes);
    } catch (e) {
      if (e instanceof Exit) return (this.status = e.code);
      if (e instanceof Error && e.message.startsWith('syntax error')) {
        this.emit(`bash: ${e.message}`);
        return (this.status = 2);
      }
      throw e;
    }
    return this.status;
  }

  private emit(text: string) {
    for (const l of text.replace(/\n$/, '').split('\n')) this.logFn(l);
  }

  private exec(nodes: Node[]): void {
    for (const n of nodes) {
      if (n.k === 'cmd') this.status = this.list(n.text, false).code;
      else if (n.k === 'if') {
        let done = false;
        for (const b of n.branches) {
          this.exec(b.cond);
          if (this.status === 0) {
            this.exec(b.body);
            done = true;
            break;
          }
        }
        if (!done) {
          this.status = 0;
          this.exec(n.other);
        }
      } else {
        for (const w of this.fields(n.words)) {
          this.vars[n.v] = w;
          this.exec(n.body);
        }
      }
    }
  }

  /** Lista de órdenes unidas por `&&` y `||`. `capture` = guarda la salida en vez de registrarla. */
  private list(text: string, capture: boolean): Result {
    const parts = splitTop(text, ['&&', '||']);
    let out = '';
    let code = 0;
    let skip = false;
    let prevOp = '';
    for (const { part, op } of parts) {
      const run = prevOp === '' || (prevOp === '&&' ? code === 0 : code !== 0);
      if (run && part.trim()) {
        const r = this.pipeline(part.trim(), capture);
        code = r.code;
        out += r.out;
      }
      prevOp = op;
      void skip;
    }
    return { code, out };
  }

  private pipeline(text: string, capture: boolean): Result {
    const stages = splitTop(text, ['|']).map((s) => s.part.trim());
    let input = '';
    let code = 0;
    for (let i = 0; i < stages.length; i++) {
      const last = i === stages.length - 1;
      const r = this.simple(stages[i], input, capture || !last);
      code = r.code;
      input = r.out;
      if (last) return { code, out: capture ? r.out : '' };
    }
    return { code, out: '' };
  }

  // ───────────── expansión ─────────────

  private lookup(name: string): string {
    if (name === '?') return String(this.status);
    if (name === 'PWD') return this.cwd;
    return this.vars[name] ?? '';
  }

  /** Expande una palabra cruda: variables, `$(…)`, comillas y (sin comillas) separación en campos. */
  private expandWord(raw: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let has = false;
    const push = () => {
      if (has) fields.push(cur);
      cur = '';
      has = false;
    };
    let q = '';
    const sub = (value: string, quoted: boolean) => {
      if (quoted) {
        cur += value;
        has = true;
        return;
      }
      const ws = value.split(/\s+/);
      ws.forEach((w, k) => {
        if (k > 0) push();
        if (w) {
          cur += w;
          has = true;
        }
      });
    };
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q === "'") {
        if (c === "'") q = '';
        else cur += c;
        continue;
      }
      if (c === '\\') {
        const n = raw[++i] ?? '';
        cur += q === '"' && !'"\\$`'.includes(n) ? '\\' + n : n;
        has = true;
        continue;
      }
      if (c === '"' && q === '"') {
        q = '';
        continue;
      }
      if (c === '"' && !q) {
        q = '"';
        has = true;
        continue;
      }
      if (c === "'" && !q) {
        q = "'";
        has = true;
        continue;
      }
      if (c === '$') {
        if (raw[i + 1] === '(') {
          let d = 1;
          let j = i + 2;
          while (j < raw.length && d > 0) {
            if (raw[j] === '(') d++;
            else if (raw[j] === ')') d--;
            j++;
          }
          const inner = raw.slice(i + 2, j - 1);
          sub(this.capture(inner), !!q);
          i = j - 1;
          continue;
        }
        if (raw[i + 1] === '{') {
          const j = raw.indexOf('}', i);
          const body = raw.slice(i + 2, j);
          const m = /^([A-Za-z_]\w*|\?)(?::?([-=+?])(.*))?$/.exec(body);
          let v = m ? this.lookup(m[1]) : '';
          if (m?.[2] === '-' && !v) v = m[3] ?? '';
          sub(v, !!q);
          i = j;
          continue;
        }
        const m = /^[A-Za-z_]\w*|^\?/.exec(raw.slice(i + 1));
        if (m) {
          sub(this.lookup(m[0]), !!q);
          i += m[0].length;
          continue;
        }
      }
      if (c === '`' && !q) {
        const j = raw.indexOf('`', i + 1);
        sub(this.capture(raw.slice(i + 1, j)), false);
        i = j;
        continue;
      }
      cur += c;
      has = true;
    }
    push();
    return fields.length ? fields : has ? [''] : [];
  }

  private fields(text: string): string[] {
    return rawWords(text).flatMap((w) => this.expandWord(w));
  }

  private capture(script: string): string {
    const saved = this.status;
    const r = this.list(script, true);
    this.status = saved;
    return r.out.replace(/\n+$/, '');
  }

  /** Archivos que casan con un patrón con `*` o `?` (por segmentos). */
  private glob(pattern: string): string[] {
    if (!/[*?]/.test(pattern)) return [pattern];
    const re = new RegExp('^' + norm(this.abs(pattern)).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
    const hits = [...this.files.keys()].filter((f) => re.test(f)).map((f) => (pattern.startsWith('/') ? f : f.slice(this.cwd.length === 1 ? 1 : this.cwd.length + 1)));
    return hits.length ? hits.sort() : [pattern];
  }

  // ───────────── una orden ─────────────

  private simple(text: string, stdin: string, capture: boolean): Result {
    const raws = rawWords(text);
    // redirecciones
    let stdout: { file: string; append: boolean } | null = null;
    let stderrToOut = false;
    let discardErr = false;
    const words: string[] = [];
    for (let i = 0; i < raws.length; i++) {
      const w = raws[i];
      let m: RegExpExecArray | null;
      if (w === '2>&1') stderrToOut = true;
      else if ((m = /^(?:1?>>?|&>>?)(.*)$/.exec(w))) {
        const append = w.startsWith('>>') || w.startsWith('1>>') || w.startsWith('&>>');
        const target = m[1] ? m[1] : raws[++i];
        stdout = { file: this.expandWord(target ?? '')[0] ?? '', append };
        if (w.startsWith('&>')) stderrToOut = true;
      } else if ((m = /^2>>?(.*)$/.exec(w))) {
        const target = m[1] ? m[1] : raws[++i];
        const f = this.expandWord(target ?? '')[0] ?? '';
        if (f === '/dev/null') discardErr = true;
        else stderrToOut = false;
      } else words.push(w);
    }
    // asignaciones previas `A=b cmd`
    const assigns: [string, string][] = [];
    while (words.length && /^[A-Za-z_]\w*=/.test(words[0])) {
      const w = words.shift()!;
      const eq = w.indexOf('=');
      assigns.push([w.slice(0, eq), this.expandWord(w.slice(eq + 1)).join(' ')]);
    }
    if (!words.length) {
      for (const [k, v] of assigns) this.vars[k] = v;
      return { code: 0, out: '' };
    }
    const argv = words.flatMap((w) => this.expandWord(w)).flatMap((a, i) => (i > 0 && !a.startsWith('-') ? this.glob(a) : [a]));
    const saved = { ...this.vars };
    for (const [k, v] of assigns) this.vars[k] = v;
    let r: Result;
    try {
      r = this.command(argv, stdin, discardErr);
    } finally {
      if (assigns.length) for (const [k] of assigns) if (k in saved) this.vars[k] = saved[k];
      else delete this.vars[k];
    }
    void stderrToOut;
    if (stdout) {
      const path = this.abs(stdout.file);
      if (path === '/dev/null') return { code: r.code, out: '' };
      this.files.set(path, (stdout.append ? (this.files.get(path) ?? '') : '') + r.out);
      return { code: r.code, out: '' };
    }
    if (!capture && r.out) this.emit(r.out);
    return { code: r.code, out: r.out };
  }

  private fail(code: number, msg: string): Result {
    return { code, out: msg.endsWith('\n') ? msg : msg + '\n' };
  }

  private readFile(p: string): string | null {
    return this.files.get(this.abs(p)) ?? null;
  }

  private isDir(p: string): boolean {
    const a = this.abs(p);
    if (a === '/') return true;
    return [...this.files.keys()].some((f) => f.startsWith(a + '/'));
  }

  private under(dir: string): string[] {
    const a = this.abs(dir);
    return [...this.files.keys()].filter((f) => f.startsWith(a === '/' ? '/' : a + '/')).sort();
  }

  private command(argv: string[], stdin: string, quietErr: boolean): Result {
    const [name, ...a] = argv;
    const ok = (out = ''): Result => ({ code: 0, out });
    switch (name) {
      case 'echo': {
        const n = a[0] === '-n';
        const args = n || a[0] === '-e' ? a.slice(1) : a;
        const t = args.join(' ');
        return ok((a[0] === '-e' ? t.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : t) + (n ? '' : '\n'));
      }
      case 'printf': {
        let i = 0;
        const t = (a[0] ?? '').replace(/%[sd]/g, () => a[++i] ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        return ok(t);
      }
      case 'true':
      case ':':
        return ok();
      case 'false':
        return { code: 1, out: '' };
      case 'exit':
        throw new Exit(a[0] ? Number(a[0]) : this.status);
      case 'cd': {
        const t = this.abs(a[0] ?? '/root');
        if (!this.isDir(t)) return this.fail(1, `bash: cd: ${a[0]}: No such file or directory`);
        this.cwd = t;
        return ok();
      }
      case 'pwd':
        return ok(this.cwd + '\n');
      case 'export':
      case 'declare': {
        for (const x of a) {
          const eq = x.indexOf('=');
          if (eq > 0) this.vars[x.slice(0, eq)] = x.slice(eq + 1);
        }
        return ok();
      }
      case 'set':
      case 'chmod':
      case 'umask':
      case 'hash':
        return ok();
      case 'unset':
        for (const x of a) delete this.vars[x];
        return ok();
      case 'env':
      case 'printenv':
        return ok(Object.entries(this.vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
      case 'sleep':
        this.acct.clock += Math.round(Number(a[0] ?? 0) * 1000);
        return ok();
      case 'date': {
        const d = new Date(this.acct.clock);
        const f = a.find((x) => x.startsWith('+'));
        const p2 = (n: number) => String(n).padStart(2, '0');
        if (!f) return ok(d.toUTCString().replace('GMT', 'UTC') + '\n');
        return ok(f.slice(1).replace(/%Y/g, String(d.getUTCFullYear())).replace(/%m/g, p2(d.getUTCMonth() + 1)).replace(/%d/g, p2(d.getUTCDate())).replace(/%H/g, p2(d.getUTCHours())).replace(/%M/g, p2(d.getUTCMinutes())).replace(/%S/g, p2(d.getUTCSeconds())).replace(/%s/g, String(Math.floor(this.acct.clock / 1000))) + '\n');
      }
      case '[':
      case 'test':
        return this.test(name === '[' ? a.slice(0, -1) : a);
      case 'mkdir': {
        for (const x of a.filter((y) => !y.startsWith('-'))) this.files.set(this.abs(x) + '/.keep', '');
        return ok();
      }
      case 'touch': {
        for (const x of a) if (!this.files.has(this.abs(x))) this.files.set(this.abs(x), '');
        return ok();
      }
      case 'ls': {
        const t = a.find((x) => !x.startsWith('-')) ?? '.';
        const abs = this.abs(t);
        if (this.files.has(abs)) return ok(t + '\n');
        if (!this.isDir(t)) return quietErr ? { code: 2, out: '' } : this.fail(2, `ls: cannot access '${t}': No such file or directory`);
        const prefix = abs === '/' ? '/' : abs + '/';
        const names = new Set(this.under(t).map((f) => f.slice(prefix.length).split('/')[0]).filter((n) => n !== '.keep'));
        return ok([...names].sort().join('\n') + (names.size ? '\n' : ''));
      }
      case 'cat': {
        if (!a.length) return ok(stdin);
        let out = '';
        for (const f of a) {
          const c = this.readFile(f);
          if (c === null) return this.fail(1, `cat: ${f}: No such file or directory`);
          out += c;
        }
        return ok(out);
      }
      case 'head':
      case 'tail': {
        const nIdx = a.indexOf('-n');
        const n = nIdx >= 0 ? Number(a[nIdx + 1]) : 10;
        const file = a.find((x, i) => !x.startsWith('-') && i !== nIdx + 1);
        const text = file ? (this.readFile(file) ?? '') : stdin;
        const lines = text.replace(/\n$/, '').split('\n');
        return ok((name === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n') + '\n');
      }
      case 'wc': {
        const text = a.find((x) => !x.startsWith('-')) ? (this.readFile(a.find((x) => !x.startsWith('-'))!) ?? '') : stdin;
        return ok(String(text ? text.replace(/\n$/, '').split('\n').length : 0) + '\n');
      }
      case 'grep': {
        const flags = a.filter((x) => x.startsWith('-')).join('');
        const rest = a.filter((x) => !x.startsWith('-'));
        const pat = new RegExp(rest[0] ?? '', flags.includes('i') ? 'i' : '');
        const text = rest[1] ? (this.readFile(rest[1]) ?? '') : stdin;
        const hits = text.replace(/\n$/, '').split('\n').filter((l) => pat.test(l) !== flags.includes('v'));
        return { code: hits.length && hits[0] !== '' ? 0 : 1, out: flags.includes('q') || !hits.length ? '' : hits.join('\n') + '\n' };
      }
      case 'cp':
      case 'mv': {
        const rec = a.some((x) => x.startsWith('-') && x.includes('r'));
        const paths = a.filter((x) => !x.startsWith('-'));
        const dest = paths.pop();
        if (!dest || !paths.length) return this.fail(1, `${name}: missing file operand`);
        const destDir = this.isDir(dest) || paths.length > 1;
        for (const s of paths) {
          if (this.isDir(s)) {
            if (!rec && name === 'cp') return this.fail(1, `cp: -r not specified; omitting directory '${s}'`);
            const base = this.abs(s);
            for (const f of this.under(s)) {
              const to = this.abs(dest) + (this.isDir(dest) ? '/' + base.split('/').pop() : '') + f.slice(base.length);
              this.files.set(to, this.files.get(f)!);
              if (name === 'mv') this.files.delete(f);
            }
          } else {
            const c = this.readFile(s);
            if (c === null) return this.fail(1, `${name}: cannot stat '${s}': No such file or directory`);
            this.files.set(destDir ? `${this.abs(dest)}/${s.split('/').pop()}` : this.abs(dest), c);
            if (name === 'mv') this.files.delete(this.abs(s));
          }
        }
        return ok();
      }
      case 'rm': {
        for (const x of a.filter((y) => !y.startsWith('-'))) {
          if (this.isDir(x)) for (const f of this.under(x)) this.files.delete(f);
          else if (!this.files.delete(this.abs(x)) && !a.some((y) => y.startsWith('-') && y.includes('f'))) return this.fail(1, `rm: cannot remove '${x}': No such file or directory`);
        }
        return ok();
      }
      case 'zip': {
        const paths = a.filter((x) => !x.startsWith('-'));
        const out = paths.shift();
        if (!out) return this.fail(1, 'zip error: Nothing to do!');
        const entries: Record<string, string> = {};
        for (const p of paths) {
          if (this.isDir(p)) {
            const base = this.abs(p);
            for (const f of this.under(p)) if (!f.endsWith('/.keep')) entries[(p === '.' ? '' : p.replace(/\/$/, '') + '/') + f.slice(base.length + 1)] = this.files.get(f)!;
          } else {
            const c = this.readFile(p);
            if (c === null) return this.fail(12, `\tzip warning: name not matched: ${p}\n\nzip error: Nothing to do! (${out})`);
            entries[p.replace(/^\.\//, '')] = c;
          }
        }
        this.files.set(this.abs(out.endsWith('.zip') ? out : out + '.zip'), makeZip(entries));
        return ok(a.some((x) => x.startsWith('-') && x.includes('q')) ? '' : Object.keys(entries).map((e) => `  adding: ${e} (deflated 10%)`).join('\n') + '\n');
      }
      case 'unzip': {
        const i = a.indexOf('-d');
        const dest = i >= 0 ? a[i + 1] : '.';
        const file = a.find((x, k) => !x.startsWith('-') && k !== i + 1);
        const z = file ? this.readFile(file) : null;
        const entries = z ? zipFiles(z) : null;
        if (!entries) return this.fail(9, `unzip:  cannot find or open ${file}, ${file}.zip or ${file}.ZIP.`);
        for (const [p, c] of Object.entries(entries)) this.files.set(this.abs(`${dest}/${p}`), c);
        return ok(a.some((x) => x.startsWith('-') && x.includes('q')) ? '' : `Archive:  ${file}\n`);
      }
      case 'basename':
        return ok((a[0] ?? '').split('/').pop() + '\n');
      case 'dirname':
        return ok((a[0] ?? '').split('/').slice(0, -1).join('/') || '.' + '\n');
      case 'sh':
      case 'bash':
      case 'source':
      case '.': {
        const f = a.find((x) => !x.startsWith('-'));
        const text = f ? this.readFile(f) : null;
        if (text === null) return this.fail(127, `${name}: ${f}: No such file or directory`);
        this.run(text);
        return { code: this.status, out: '' };
      }
      case 'aws':
        return this.aws(a);
      case 'python':
      case 'python3':
        return this.python(a);
      case 'pytest':
        return this.pytest(a);
      case 'pip':
      case 'pip3':
        return this.pip(a);
      default:
        if (name.startsWith('./') || name.startsWith('/')) {
          const text = this.readFile(name);
          if (text !== null) {
            this.run(text);
            return { code: this.status, out: '' };
          }
        }
        return this.fail(127, `bash: ${name}: command not found`);
    }
  }

  private test(a: string[]): Result {
    const r = (b: boolean): Result => ({ code: b ? 0 : 1, out: '' });
    if (a[0] === '!') return r(this.test(a.slice(1)).code !== 0);
    if (a.length === 1) return r(a[0] !== '');
    if (a.length === 2) {
      switch (a[0]) {
        case '-z':
          return r(a[1] === '');
        case '-n':
          return r(a[1] !== '');
        case '-f':
          return r(this.files.has(this.abs(a[1])));
        case '-d':
          return r(this.isDir(a[1]));
        case '-e':
          return r(this.files.has(this.abs(a[1])) || this.isDir(a[1]));
      }
    }
    if (a.length === 3) {
      const [x, op, y] = a;
      switch (op) {
        case '=':
        case '==':
          return r(x === y);
        case '!=':
          return r(x !== y);
        case '-eq':
          return r(Number(x) === Number(y));
        case '-ne':
          return r(Number(x) !== Number(y));
        case '-lt':
          return r(Number(x) < Number(y));
        case '-gt':
          return r(Number(x) > Number(y));
      }
    }
    return { code: 2, out: 'bash: test: syntax error\n' };
  }

  // ───────────── aws, python, pytest, pip ─────────────

  private io(): AwsIO {
    const files = this.files;
    const abs = (p: string) => this.abs(p);
    return {
      acct: this.acct,
      env: this.vars,
      home: '/root',
      cwd: this.cwd,
      readFile: (p) => files.get(abs(p)) ?? null,
      writeFile: (p, c) => (files.set(abs(p), c), true),
      removeFile: (p) => void files.delete(abs(p)),
      listFiles: (d) => {
        const dir = abs(d).replace(/\/$/, '') + '/';
        const l: LocalFile[] = [...files.entries()].filter(([k]) => k.startsWith(dir) && !k.endsWith('/.keep')).map(([k, v]) => ({ rel: k.slice(dir.length), content: v, mtime: this.acct.clock, size: v.length }));
        return l.length ? l : null;
      },
      isDir: (p) => this.isDir(p),
      size: (p) => files.get(abs(p))?.length ?? null,
      abs,
      stdin: null,
      cols: 120,
    };
  }

  private aws(args: string[]): Result {
    const r = runAwsSync(args, this.io());
    this.vars.AWS_LAST = '';
    return { code: r.code, out: r.stdout + (r.stderr ? r.stderr : '') };
  }

  private session(): PySession {
    const files: Record<string, string> = {};
    const base = this.cwd === '/' ? '/' : this.cwd + '/';
    for (const [k, v] of this.files) if (k.startsWith(base) && !k.endsWith('/.keep')) files[k.slice(base.length)] = v;
    return new PySession({ files, cwd: this.cwd, now: this.acct.clock, seed: 7, maxSteps: 5_000_000 });
  }

  private python(a: string[]): Result {
    if (a[0] === '--version' || a[0] === '-V') return { code: 0, out: 'Python 3.12.3\n' };
    if (a[0] === '-m' && a[1] === 'pytest') return this.pytest(a.slice(2));
    if (a[0] === '-m' && a[1] === 'pip') return this.pip(a.slice(2));
    let src: string | null;
    let name = '<string>';
    if (a[0] === '-c') src = a[1] ?? '';
    else {
      name = a[0] ?? '';
      src = this.readFile(name);
      if (src === null) return { code: 2, out: `python3: can't open file '${this.abs(name)}': [Errno 2] No such file or directory\n` };
    }
    const r = this.session().runSync(src, { filename: name });
    return { code: r.ok ? 0 : 1, out: r.stdout + r.stderr };
  }

  private pytest(a: string[]): Result {
    const base = this.cwd === '/' ? '/' : this.cwd + '/';
    const rel = [...this.files.keys()].filter((k) => k.startsWith(base) && !k.endsWith('/.keep')).map((k) => k.slice(base.length));
    const wanted = a.filter((x) => !x.startsWith('-'));
    const tests = rel.filter((f) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f) && (!wanted.length || wanted.some((w) => f === w.split('::')[0] || f.startsWith(w.replace(/\/?$/, '/')))));
    let out = `============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-8.1.1, pluggy-1.4.0\nrootdir: ${this.cwd}\n`;
    if (!tests.length) return { code: 5, out: out + 'collected 0 items\n\n============================ no tests ran in 0.01s =============================\n' };
    const mods = tests.map((f) => f.replace(/\.py$/, '').replace(/\//g, '.'));
    const driver = `import sys, json
sys.path.insert(0, '.')
__res = []
for __m in ${JSON.stringify(mods)}:
    try:
        __mod = __import__(__m)
        for __p in __m.split('.')[1:]:
            __mod = getattr(__mod, __p)
    except BaseException as __e:
        __res.append([__m, '<import>', 'ImportError while importing test module: ' + repr(__e)])
        continue
    for __n in list(__mod.__dict__.keys()):
        if __n.startswith('test'):
            __f = getattr(__mod, __n)
            if callable(__f):
                try:
                    __f()
                    __res.append([__m, __n, None])
                except BaseException as __e:
                    __res.append([__m, __n, repr(__e)])
print('@@RESULTS@@' + json.dumps(__res))
`;
    const r = this.session().runSync(driver, { filename: 'pytest_driver.py' });
    const m = /@@RESULTS@@(.*)/.exec(r.stdout);
    if (!r.ok || !m) return { code: 2, out: out + r.stdout.replace(/@@RESULTS@@.*/, '') + r.stderr };
    const res = JSON.parse(m[1]) as [string, string, string | null][];
    out += `collected ${res.length} items\n\n`;
    tests.forEach((f, k) => {
      out += `${f} ${res.filter((x) => x[0] === mods[k]).map((x) => (x[2] === null ? '.' : 'F')).join('')}\n`;
    });
    const bad = res.filter((x) => x[2] !== null);
    if (bad.length) {
      out += '\n=================================== FAILURES ===================================\n';
      for (const [mod, n, msg] of bad) out += `___________________________________ ${n} ___________________________________\n\n${mod.replace(/\./g, '/')}.py: ${msg}\n\n`;
      out += '=========================== short test summary info ============================\n';
      for (const [mod, n, msg] of bad) out += `FAILED ${mod.replace(/\./g, '/')}.py::${n} - ${msg}\n`;
    }
    out += `========================= ${bad.length ? `${bad.length} failed, ` : ''}${res.length - bad.length} passed in 0.02s =========================\n`;
    return { code: bad.length ? 1 : 0, out };
  }

  private pip(a: string[]): Result {
    if (a[0] !== 'install') return { code: a.length ? 1 : 0, out: 'Usage: pip install <package> | -r requirements.txt\n' };
    let pkgs: string[] = [];
    const rIdx = a.indexOf('-r');
    if (rIdx >= 0) {
      const text = this.readFile(a[rIdx + 1] ?? '');
      if (text === null) return { code: 1, out: `ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${a[rIdx + 1]}'\n` };
      pkgs = text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
    } else pkgs = a.slice(1).filter((x) => !x.startsWith('-'));
    const names = pkgs.map((p) => p.split(/[=<>~[]/)[0]);
    this.acct.clock += 2000 * names.length;
    let out = names.map((n) => `Collecting ${n}\n  Downloading ${n}-1.0.0-py3-none-any.whl (50 kB)\n`).join('');
    out += names.length ? `Installing collected packages: ${names.join(', ')}\nSuccessfully installed ${names.map((n) => n + '-1.0.0').join(' ')}\n` : 'Requirement already satisfied\n';
    return { code: 0, out };
  }
}
