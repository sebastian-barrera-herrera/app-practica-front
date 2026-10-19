import { highlightPython, highlightRepl, isReplTranscript } from '../pyhighlight';

const kinds = (src: string) => highlightPython(src)[0].filter((t) => t.k !== 'text' || t.s.trim()).map((t) => `${t.k}:${t.s}`);

describe('resaltado de Python', () => {
  test('palabras clave, números, cadenas, comentarios y definiciones', () => {
    expect(kinds("def saluda(n):")).toEqual(['kw:def', 'fn:saluda', 'op:(', 'text:n', 'op:)', 'op::']);
    expect(kinds('x = 3.5  # hola')).toEqual(['text:x', 'op:=', 'num:3.5', 'com:# hola']);
    expect(kinds("print(f'hola {n}')")).toEqual(['bi:print', 'op:(', "str:f'hola {n}'", 'op:)']);
    expect(kinds('class Perro(Animal):')[0]).toBe('kw:class');
    expect(kinds('class Perro(Animal):')[1]).toBe('cls:Perro');
    expect(kinds('@staticmethod')).toEqual(['dec:@staticmethod']);
  });

  test('cadenas triples multilínea se reparten por líneas', () => {
    const lines = highlightPython('x = """a\nb"""\ny = 1');
    expect(lines).toHaveLength(3);
    expect(lines[0].some((t) => t.k === 'str' && t.s === '"""a')).toBe(true);
    expect(lines[1][0]).toEqual({ k: 'str', s: 'b"""' });
    expect(lines[2].some((t) => t.k === 'num')).toBe(true);
  });

  test('no pierde ni añade caracteres', () => {
    const src = "for i in range(3):\n    print(i ** 2, 0x1F, 1_000, 'it\\'s')  # fin\n";
    const joined = highlightPython(src).map((l) => l.map((t) => t.s).join('')).join('\n');
    expect(joined).toBe(src);
  });

  test('transcripciones de REPL', () => {
    const src = '>>> 2 + 3\n5\n>>> for i in x:\n...     print(i)';
    expect(isReplTranscript(src)).toBe(true);
    const l = highlightRepl(src);
    expect(l[0][0].k).toBe('prompt');
    expect(l[1]).toEqual([{ k: 'out', s: '5' }]);
    expect(l[3][0].k).toBe('prompt');
  });
});
