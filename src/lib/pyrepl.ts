/** Utilidades para ejecutar bloques de código «como en el intérprete interactivo» (>>>). */

/** Divide un fragmento en sentencias completas (cada una se ejecuta y muestra su eco por separado). */
export function splitReplChunks(code: string, isIncomplete: (src: string) => boolean): string[] {
  const lines = code.replace(/\s+$/, '').split('\n');
  const chunks: string[] = [];
  let cur: string[] = [];
  const complete = (ls: string[]) => !isIncomplete(ls.join('\n') + '\n\n');
  const continues = (l: string) => /^\s/.test(l) || /^(elif|else|except|finally)\b/.test(l) || l.trim() === '' || /^[)\]}]/.test(l);
  for (const l of lines) {
    // un decorador (`@algo`) siempre continúa con la definición que decora
    if (cur.length && !continues(l) && !/^\s*@/.test(cur[cur.length - 1]) && complete(cur)) {
      chunks.push(cur.join('\n'));
      cur = [];
    }
    if (l.trim() === '' && !cur.length) continue;
    cur.push(l);
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

/** Texto de una sentencia con los prompts «>>> » y «... » delante, como se vería en el intérprete. */
export function withPrompts(chunk: string): string {
  return chunk
    .split('\n')
    .map((l, i) => (i === 0 ? '>>> ' : '... ') + l)
    .join('\n');
}
