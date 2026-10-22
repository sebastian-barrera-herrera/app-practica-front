import { inStringOrComment, namesInCode, SNIPPETS, suggest, wordAt } from '../pycomplete';

const at = (code: string) => {
  const c = code.indexOf('|');
  const text = code.replace('|', '');
  return { text, cursor: c };
};
const labels = (code: string, max?: number) => {
  const { text, cursor } = at(code);
  return suggest(text, cursor, max).items.map((i) => i.label);
};

describe('autocompletado de Python', () => {
  test('palabra antes del cursor', () => {
    expect(wordAt('print(nom', 9)).toEqual({ start: 6, prefix: 'nom', afterDot: false });
    expect(wordAt('texto.up', 8)).toEqual({ start: 6, prefix: 'up', afterDot: true });
    expect(wordAt('x = ', 4).prefix).toBe('');
  });

  test('sugiere las variables que ya escribiste, antes que las funciones de Python', () => {
    const l = labels('nombre = "Ana"\nprint(nom|');
    expect(l[0]).toBe('nombre');
    // la variable se usa tal cual (sin paréntesis)
    const { text, cursor } = at('nombre = "Ana"\nprint(nom|');
    expect(suggest(text, cursor).items[0]).toMatchObject({ insert: 'nombre', kind: 'var' });
  });

  test('prefijos de funciones integradas: print() deja el cursor entre los paréntesis', () => {
    const { text, cursor } = at('pri|');
    const [first] = suggest(text, cursor).items;
    expect(first).toMatchObject({ label: 'print', insert: 'print()', caret: 6, kind: 'bi' });
    // aunque ya esté escrito entero, ofrece cerrar con paréntesis
    const full = at('print|');
    expect(suggest(full.text, full.cursor).items[0].insert).toBe('print()');
  });

  test('palabras clave con su espacio o dos puntos', () => {
    const { text, cursor } = at('el|');
    const items = suggest(text, cursor).items;
    expect(items.find((i) => i.label === 'else')?.insert).toBe('else:');
    expect(items.find((i) => i.label === 'elif')?.insert).toBe('elif ');
  });

  test('funciones definidas por el usuario: con o sin argumentos', () => {
    const code = 'def saluda(nombre):\n    pass\ndef hola():\n    pass\nsal|';
    const { text, cursor } = at(code);
    expect(suggest(text, cursor).items[0]).toMatchObject({ label: 'saluda', insert: 'saluda()', caret: 7, kind: 'fn' });
    const h = at(code.replace('sal|', 'ho|'));
    expect(suggest(h.text, h.cursor).items[0]).toMatchObject({ label: 'hola', insert: 'hola()', caret: 6 });
  });

  test('tras un punto, métodos habituales', () => {
    const l = labels('texto = "a"\ntexto.up|');
    expect(l).toEqual(['upper', 'update']);
    const all = labels('lista.|');
    expect(all).toContain('append');
    const { text, cursor } = at('t.up|');
    expect(suggest(text, cursor).items[0]).toMatchObject({ insert: 'upper()', caret: 7 });
  });

  test('no sugiere dentro de textos ni comentarios, ni sin nada escrito, ni con números', () => {
    expect(labels('print("hola pri|')).toEqual([]);
    expect(labels('# pri|')).toEqual([]);
    expect(labels('x = |')).toEqual([]);
    expect(labels('x = 12|')).toEqual([]);
    expect(inStringOrComment('print("abc")', 12)).toBe(false);
  });

  test('lo que se está escribiendo no se sugiere a sí mismo y no se repite', () => {
    // tu variable va primero y sin repetirse; las palabras clave que empiezan igual vienen después
    expect(labels('contador = 0\ncont|')).toEqual(['contador', 'continue']);
    expect(labels('qwe = 1\nqwe = 2\nqw|')).toEqual(['qwe']);
    // lo que estás escribiendo no cuenta como nombre existente
    expect(labels('xyzw|')).toEqual([]);
  });

  test('máximo de sugerencias y lista de atajos', () => {
    expect(labels('s|', 3).length).toBeLessThanOrEqual(3);
    expect(SNIPPETS[0].label).toBe('print()');
    for (const s of SNIPPETS) expect(s.caret ?? s.insert.length).toBeLessThanOrEqual(s.insert.length);
  });

  test('nombres del código: el más reciente primero', () => {
    expect(namesInCode('a1 = 1\nb2 = 2\na1 = 3').map((n) => n.name)).toEqual(['a1', 'b2']);
  });
});
