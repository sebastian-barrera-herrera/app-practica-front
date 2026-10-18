/** Normalización de comandos escritos por el alumno para compararlos con respuestas aceptadas. */

const CLUSTER_OK = new Set(['ls', 'rm', 'cp', 'mv', 'mkdir', 'rmdir', 'grep', 'sort', 'uniq', 'wc', 'cat', 'df', 'du', 'ps', 'touch', 'tree', 'free', 'cut', 'head', 'tail', 'chmod', 'chown', 'less', 'ln', 'kill', 'pwd', 'date', 'uname', 'hostname', 'ping', 'curl', 'wget', 'apt', 'stat', 'file', 'tr', 'xargs', 'diff', 'sed', 'awk', 'find', 'history', 'who', 'id', 'journalctl', 'systemctl', 'ss', 'ip', 'top', 'jobs', 'echo']);

export function normalizeCmd(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return s;
  // comillas simples ≡ dobles cuando no hay variables ni espacios dentro
  s = s.replace(/'([^'"$\s]*)'/g, '"$1"');
  const toks = s.split(' ');
  const cmd = toks[0] === 'sudo' ? toks[1] : toks[0];
  if (!CLUSTER_OK.has(cmd)) return s;
  const out: string[] = [];
  let flags = '';
  const flush = () => {
    if (flags) out.push('-' + [...new Set(flags)].sort().join(''));
    flags = '';
  };
  let afterCmd = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!afterCmd) {
      out.push(t);
      if (t !== 'sudo') afterCmd = true;
      continue;
    }
    if (/^-[a-zA-Z]{1,4}$/.test(t) && !/^-[0-9]+$/.test(t)) {
      // un flag que lleva valor (-n 5, -k 2) se deja tal cual
      const next = toks[i + 1];
      if (/^-[nkdtfsc]$/.test(t) && next !== undefined && !next.startsWith('-')) {
        flush();
        out.push(t);
        continue;
      }
      flags += t.slice(1);
    } else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(' ');
}

export function cmdMatches(input: string, answers: string[], regex?: string): boolean {
  const n = normalizeCmd(input);
  if (!n) return false;
  if (answers.some((a) => normalizeCmd(a) === n)) return true;
  if (regex) {
    try {
      return new RegExp(regex).test(input.trim().replace(/\s+/g, ' '));
    } catch {
      return false;
    }
  }
  return false;
}

/** Barajado determinista (mulberry32) para mantener estables los órdenes de opciones. */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = [...arr];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
