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

describe('colores del código (paleta de VS Code)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tokColor, PY_COLOR, KEYWORD_CONTROL } = require('../pycolors') as typeof import('../pycolors');
  const first = (src: string) => highlightPython(src)[0].find((t) => t.s.trim() !== '')!;

  test('control de flujo en violeta, el resto de palabras clave en azul', () => {
    expect(tokColor(first('if x: pass'))).toBe(KEYWORD_CONTROL);
    expect(tokColor(first('for i in x: pass'))).toBe(KEYWORD_CONTROL);
    expect(tokColor(first('def f(): pass'))).toBe(PY_COLOR.kw);
    expect(tokColor(first('None'))).toBe(PY_COLOR.kw);
  });

  test('variables en celeste, funciones en amarillo, textos en naranja, números en verde claro', () => {
    expect(tokColor(first('edad = 3'))).toBe(PY_COLOR.text);
    expect(tokColor(first('print(1)'))).toBe(PY_COLOR.bi);
    expect(tokColor(first('mi_funcion(1)'))).toBe(PY_COLOR.fn);
    expect(tokColor(first('"hola"'))).toBe(PY_COLOR.str);
    expect(tokColor(first('42'))).toBe(PY_COLOR.num);
    expect(tokColor(first('# nota'))).toBe(PY_COLOR.com);
  });
});
