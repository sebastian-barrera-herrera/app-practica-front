/** Parser mínimo de secuencias ANSI SGR → tramos con estilo. */
export interface AnsiSpan {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

const FG: Record<number, string> = { 30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white', 90: 'brightBlack', 91: 'brightRed', 92: 'brightGreen', 93: 'brightYellow', 94: 'brightBlue', 95: 'brightMagenta', 96: 'brightCyan', 97: 'brightWhite' };

export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let cur: Omit<AnsiSpan, 'text'> = {};
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) {
      spans.push({ text: buf, ...cur });
      buf = '';
    }
  };
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\x1b' && input[i + 1] === '[') {
      const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(input.slice(i));
      if (m) {
        i += m[0].length;
        if (m[2] === 'm') {
          flush();
          const codes = m[1] === '' ? [0] : m[1].split(';').map((x) => parseInt(x || '0', 10));
          for (let k = 0; k < codes.length; k++) {
            const c = codes[k];
            if (c === 0) cur = {};
            else if (c === 1) cur = { ...cur, bold: true };
            else if (c === 2) cur = { ...cur, dim: true };
            else if (c === 4) cur = { ...cur, underline: true };
            else if (c === 7) cur = { ...cur, inverse: true };
            else if (c === 22) cur = { ...cur, bold: false, dim: false };
            else if (c === 39) cur = { ...cur, fg: undefined };
            else if (c === 49) cur = { ...cur, bg: undefined };
            else if (FG[c]) cur = { ...cur, fg: FG[c] };
            else if (c >= 40 && c <= 47) cur = { ...cur, bg: FG[c - 10] };
            else if (c >= 100 && c <= 107) cur = { ...cur, bg: FG[c - 10] };
            else if (c === 38 && codes[k + 1] === 5) {
              cur = { ...cur, fg: 'c' + codes[k + 2] };
              k += 2;
            } else if (c === 48 && codes[k + 1] === 5) {
              cur = { ...cur, bg: 'c' + codes[k + 2] };
              k += 2;
            }
          }
        }
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return spans;
}
