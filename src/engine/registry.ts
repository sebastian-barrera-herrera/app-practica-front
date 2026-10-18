/** Tipos de comandos, registro global y parser de opciones. */
import type { Shell } from './shell';
import type { VFS, Cred } from './vfs';
import { FsError } from './vfs';

export interface Stdin {
  isTTY: boolean;
  /** Lee todo hasta EOF. */
  readAll(): Promise<string>;
  /** Lee una línea (sin '\n'); null en EOF. */
  readLine(): Promise<string | null>;
}

export class BufferStdin implements Stdin {
  isTTY = false;
  private pos = 0;
  constructor(private data: string) {}
  async readAll() {
    const d = this.data.slice(this.pos);
    this.pos = this.data.length;
    return d;
  }
  async readLine() {
    if (this.pos >= this.data.length) return null;
    let e = this.data.indexOf('\n', this.pos);
    if (e < 0) e = this.data.length;
    const line = this.data.slice(this.pos, e);
    this.pos = Math.min(e + 1, this.data.length);
    return line;
  }
}

export interface IO {
  stdin: Stdin;
  out: (s: string) => void;
  err: (s: string) => void;
  /** La salida estándar es la terminal (sin pipe ni redirección). */
  tty: boolean;
}

export const EMPTY_STDIN: () => Stdin = () => new BufferStdin('');

export type Category =
  | 'navegacion'
  | 'archivos'
  | 'texto'
  | 'busqueda'
  | 'permisos'
  | 'usuarios'
  | 'procesos'
  | 'sistema'
  | 'redes'
  | 'paquetes'
  | 'compresion'
  | 'scripting'
  | 'ayuda';

export interface Ctx {
  name: string;
  args: string[];
  sh: Shell;
  fs: VFS;
  cred: Cred;
  stdin: Stdin;
  /** E/S completa del comando (para reenviar a subcomandos: sudo, xargs, find -exec…). */
  io: IO;
  /** La salida estándar va directamente a la terminal (no hay pipe ni redirección). */
  tty: boolean;
  cols: number;
  out(s: string): void;
  err(s: string): void;
  /** Ruta absoluta respecto al directorio actual. */
  abs(p: string): string;
  /** Escribe "nombre: mensaje" en stderr y devuelve `code`. */
  fail(msg: string, code?: number): number;
  /** Escribe "nombre: ruta: error del VFS" y devuelve 1. */
  fsfail(e: unknown, path: string): number;
}

export type CmdFn = (c: Ctx) => number | void | Promise<number | void>;

export interface CommandMeta {
  summary: string;
  usage?: string;
  category: Category;
  options?: [string, string][];
  examples?: [string, string][];
  /** Paquete apt que lo instala (si no está instalado, "command not found"). */
  package?: string;
  /** Vive en /usr/sbin */
  sbin?: boolean;
  /** Es un builtin del shell (no existe como archivo en /usr/bin). */
  builtin?: boolean;
  /** No interceptar --help */
  noHelp?: boolean;
  /** Nivel orientativo 1 (básico) a 4 (experto) para la biblioteca. */
  level?: 1 | 2 | 3 | 4;
}

export interface CommandDef extends CommandMeta {
  name: string;
  run: CmdFn;
}

export const REGISTRY = new Map<string, CommandDef>();

export function defineCommand(name: string | string[], meta: CommandMeta, run: CmdFn) {
  const names = Array.isArray(name) ? name : [name];
  for (const n of names) {
    REGISTRY.set(n, { name: n, ...meta, run });
  }
}

export class UsageError extends Error {
  code: number;
  constructor(msg: string, code = 1) {
    super(msg);
    this.code = code;
  }
}

// ───────────────────────── parser de opciones ─────────────────────────

export interface OptSpec {
  /** Letras que son banderas booleanas. */
  flags?: string;
  /** Letras que reciben un valor. */
  values?: string;
  /** Opciones largas → letra equivalente ('--human-readable': 'h'). */
  long?: Record<string, string>;
  /** Acepta -5 como -n 5 (head, tail). */
  numeric?: boolean;
  /** Parar en el primer operando (sudo, env, xargs, nohup...). */
  stopAtOperand?: boolean;
  /** Las opciones desconocidas se pasan como operandos en vez de error. */
  lenient?: boolean;
}

export class Opts {
  flags = new Set<string>();
  vals = new Map<string, string[]>();
  rest: string[] = [];
  numeric: string | null = null;
  /** Orden en que aparecieron las opciones (para -e/-f múltiples, etc.). */
  order: [string, string | true][] = [];

  has(k: string): boolean {
    return this.flags.has(k);
  }
  val(k: string): string | undefined {
    const v = this.vals.get(k);
    return v ? v[v.length - 1] : undefined;
  }
  all(k: string): string[] {
    return this.vals.get(k) ?? [];
  }
}

export function parseOpts(c: Pick<Ctx, 'name'>, args: string[], spec: OptSpec): Opts {
  const o = new Opts();
  const flags = spec.flags ?? '';
  const values = spec.values ?? '';
  const long = spec.long ?? {};
  const setFlag = (k: string) => {
    o.flags.add(k);
    o.order.push([k, true]);
  };
  const setVal = (k: string, v: string) => {
    const list = o.vals.get(k) ?? [];
    list.push(v);
    o.vals.set(k, list);
    o.order.push([k, v]);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      o.rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(0, eq) : a;
      const inline = eq > 0 ? a.slice(eq + 1) : undefined;
      let short = long[key];
      if (short === undefined) {
        // prefijo único
        const cands = Object.keys(long).filter((k) => k.startsWith(key));
        if (cands.length === 1) short = long[cands[0]];
      }
      if (short === undefined) {
        if (spec.lenient) {
          o.rest.push(a);
          continue;
        }
        throw new UsageError(
          `${c.name}: unrecognized option '${key}'\nTry '${c.name} --help' for more information.`,
          key === '--help' ? 0 : 1,
        );
      }
      if (values.includes(short)) {
        if (inline !== undefined) setVal(short, inline);
        else if (i + 1 < args.length) setVal(short, args[++i]);
        else throw new UsageError(`${c.name}: option '${key}' requires an argument\nTry '${c.name} --help' for more information.`);
      } else setFlag(short);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !(spec.numeric && /^-\d+$/.test(a) && false)) {
      if (spec.numeric && /^-\d+$/.test(a)) {
        o.numeric = a.slice(1);
        continue;
      }
      let consumedAll = true;
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (values.includes(ch)) {
          const restOfArg = a.slice(j + 1);
          if (restOfArg) setVal(ch, restOfArg);
          else if (i + 1 < args.length) setVal(ch, args[++i]);
          else throw new UsageError(`${c.name}: option requires an argument -- '${ch}'\nTry '${c.name} --help' for more information.`);
          break;
        } else if (flags.includes(ch)) {
          setFlag(ch);
        } else if (spec.numeric && /\d/.test(ch)) {
          o.numeric = (o.numeric ?? '') + ch;
        } else {
          if (spec.lenient) {
            consumedAll = false;
            break;
          }
          throw new UsageError(
            `${c.name}: invalid option -- '${ch}'\nTry '${c.name} --help' for more information.`,
          );
        }
      }
      if (!consumedAll) o.rest.push(a);
      continue;
    }
    if (spec.stopAtOperand) {
      o.rest.push(...args.slice(i));
      break;
    }
    o.rest.push(a);
  }
  return o;
}

export function fsMessage(e: unknown): string {
  if (e instanceof FsError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Mensaje de error estilo coreutils: "ls: cannot access 'x': No such file or directory". */
export function errnoText(e: unknown): string {
  return fsMessage(e);
}
