import { Terminal, type TerminalOptions } from '../terminal';

export function mk(opts: TerminalOptions = {}): Terminal {
  return new Terminal({ instant: true, cols: 80, ...opts });
}

export async function sh(t: Terminal, line: string) {
  return t.exec(line);
}

/** Ejecuta varias líneas y devuelve el resultado de la última. */
export async function seq(t: Terminal, ...lines: string[]) {
  let last = { out: '', err: '', text: '', status: 0 };
  for (const l of lines) last = await t.exec(l);
  return last;
}

export async function out(t: Terminal, line: string) {
  return (await t.exec(line)).out;
}
