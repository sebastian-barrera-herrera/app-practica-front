import { splitReplChunks, withPrompts } from '../pyrepl';

/** Detector mínimo para la prueba: paréntesis sin cerrar o comillas triples abiertas. */
const incomplete = (src: string) => {
  const open = (src.match(/[([{]/g) ?? []).length - (src.match(/[)\]}]/g) ?? []).length;
  const triples = (src.match(/"""/g) ?? []).length % 2 === 1;
  return open > 0 || triples;
};

describe('splitReplChunks', () => {
  test('separa sentencias simples y bloques compuestos', () => {
    const code = 'x = 1\nfor i in range(2):\n    print(i)\nelse:\n    print("fin")\nx + 1';
    expect(splitReplChunks(code, incomplete)).toEqual(['x = 1', 'for i in range(2):\n    print(i)\nelse:\n    print("fin")', 'x + 1']);
  });
  test('no corta expresiones con paréntesis abiertos ni cadenas triples', () => {
    expect(splitReplChunks('suma(1,\n  2)\ny = 3', incomplete)).toEqual(['suma(1,\n  2)', 'y = 3']);
    expect(splitReplChunks('s = """a\nb"""\nprint(s)', incomplete)).toEqual(['s = """a\nb"""', 'print(s)']);
  });
  test('añade los prompts', () => {
    expect(withPrompts('if x:\n    y')).toBe('>>> if x:\n...     y');
  });
});
