import { JmesError, search } from '../jmespath';
import { renderText, renderYaml, renderTable } from '../render';

const data = {
  Users: [
    { UserName: 'ana', Age: 30, Tags: [{ Key: 'team', Value: 'dev' }], Groups: ['devs', 'admins'] },
    { UserName: 'bob', Age: 25, Tags: [], Groups: ['devs'] },
    { UserName: 'carla', Age: 41, Tags: [{ Key: 'team', Value: 'ops' }], Groups: [] },
  ],
  'odd-key': 5,
  nested: { a: { b: { c: [1, 2, 3, 4, 5] } } },
  words: ['uno', 'dos', 'tres'],
};

const q = (e: string) => search(e, data);

describe('jmespath', () => {
  test('identificadores y subexpresiones', () => {
    expect(q('nested.a.b.c[0]')).toBe(1);
    expect(q('nested.a.x.c')).toBeNull();
    expect(q('"odd-key"')).toBe(5);
    expect(q('missing')).toBeNull();
  });

  test('índices y slices', () => {
    expect(q('nested.a.b.c[-1]')).toBe(5);
    expect(q('nested.a.b.c[1:3]')).toEqual([2, 3]);
    expect(q('nested.a.b.c[::2]')).toEqual([1, 3, 5]);
    expect(q('nested.a.b.c[::-1]')).toEqual([5, 4, 3, 2, 1]);
    expect(q('nested.a.b.c[:2]')).toEqual([1, 2]);
    expect(q('nested.a.b.c[10]')).toBeNull();
  });

  test('proyecciones', () => {
    expect(q('Users[*].UserName')).toEqual(['ana', 'bob', 'carla']);
    expect(q('Users[].UserName')).toEqual(['ana', 'bob', 'carla']);
    expect(q('Users[*].Tags[*].Value')).toEqual([['dev'], [], ['ops']]);
    expect(q('Users[].Tags[].Value')).toEqual(['dev', 'ops']);
    expect(q('nested.*')).toEqual([{ b: { c: [1, 2, 3, 4, 5] } }]);
    expect(q('Users[*].Groups[]')).toEqual(['devs', 'admins', 'devs']);
  });

  test('filtros', () => {
    expect(q("Users[?UserName=='bob'].Age")).toEqual([25]);
    expect(q('Users[?Age>`28`].UserName')).toEqual(['ana', 'carla']);
    expect(q('Users[?Age>`28` && Age<`40`].UserName')).toEqual(['ana']);
    expect(q("Users[?contains(Groups, 'devs')].UserName")).toEqual(['ana', 'bob']);
    expect(q('Users[?Tags[0].Key].UserName')).toEqual(['ana', 'carla']);
    expect(q("Users[?!contains(Groups, 'devs')].UserName")).toEqual(['carla']);
  });

  test('pipe, or, multiselect', () => {
    expect(q('Users[*].UserName | [0]')).toBe('ana');
    expect(q('Users[0].nope || Users[0].UserName')).toBe('ana');
    expect(q('Users[0].[UserName, Age]')).toEqual(['ana', 30]);
    expect(q('Users[*].{nombre: UserName, edad: Age}')).toEqual([
      { nombre: 'ana', edad: 30 },
      { nombre: 'bob', edad: 25 },
      { nombre: 'carla', edad: 41 },
    ]);
    expect(q('Users[?Age>`26`].[UserName]')).toEqual([['ana'], ['carla']]);
  });

  test('literales', () => {
    expect(q("'hola'")).toBe('hola');
    expect(q('`[1, 2]`')).toEqual([1, 2]);
    expect(q('`{"a": 1}`')).toEqual({ a: 1 });
    expect(q('`foo`')).toBe('foo');
  });

  test('funciones', () => {
    expect(q('length(Users)')).toBe(3);
    expect(q('length(words[0])')).toBe(3);
    expect(q('sort(words)')).toEqual(['dos', 'tres', 'uno']);
    expect(q('sort_by(Users, &Age)[].UserName')).toEqual(['bob', 'ana', 'carla']);
    expect(q('max_by(Users, &Age).UserName')).toBe('carla');
    expect(q('min_by(Users, &Age).UserName')).toBe('bob');
    expect(q('max(Users[].Age)')).toBe(41);
    expect(q('sum(Users[].Age)')).toBe(96);
    expect(q('avg(Users[].Age)')).toBe(32);
    expect(q("join(', ', words)")).toBe('uno, dos, tres');
    expect(q('keys(nested)')).toEqual(['a']);
    expect(q("starts_with(words[0], 'un')")).toBe(true);
    expect(q("ends_with(words[0], 'x')")).toBe(false);
    expect(q('to_string(`1`)')).toBe('1');
    expect(q("to_number('7')")).toBe(7);
    expect(q('type(Users)')).toBe('array');
    expect(q('reverse(words)')).toEqual(['tres', 'dos', 'uno']);
    expect(q('not_null(missing, words[0])')).toBe('uno');
    expect(q('map(&Age, Users)')).toEqual([30, 25, 41]);
    expect(q('merge(`{"a":1}`, `{"b":2}`)')).toEqual({ a: 1, b: 2 });
    expect(q('contains(words, `"dos"`)')).toBe(true);
  });

  test('errores', () => {
    expect(() => q('Users[')).toThrow(JmesError);
    expect(() => q('nofn(Users)')).toThrow(/Unknown function/);
    expect(() => q('length(`1`)')).toThrow(/TypeError/);
    expect(() => q('a..b')).toThrow(JmesError);
  });
});

describe('render', () => {
  test('text: lista de diccionarios con identificador', () => {
    const out = renderText({ Users: [{ UserName: 'ana', Arn: 'arn:1', Tags: [] }, { UserName: 'bob', Arn: 'arn:2', Tags: [] }] });
    expect(out).toBe('USERS\tarn:1\tana\nUSERS\tarn:2\tbob\n');
  });

  test('text: listas de escalares y valores sueltos', () => {
    expect(renderText(['a', 'b', 'c'])).toBe('a\tb\tc\n');
    expect(renderText('ana')).toBe('ana\n');
    expect(renderText(null)).toBe('None\n');
    expect(renderText({ Account: '1', Arn: 'x', UserId: 'u' })).toBe('1\tx\tu\n');
    expect(renderText({ A: true, B: false })).toBe('True\tFalse\n');
    expect(renderText({ Ids: ['a', 'b'] })).toBe('IDS\ta\nIDS\tb\n');
  });

  test('yaml', () => {
    expect(renderYaml({ Users: [{ Name: 'ana', Date: '2025-06-15T12:00:00+00:00', N: 3 }], Empty: [] })).toBe("Users:\n- Name: ana\n  Date: '2025-06-15T12:00:00+00:00'\n  N: 3\nEmpty: []\n");
  });

  test('table', () => {
    const t = renderTable({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/ana', UserId: 'AIDAX' }, 'GetCallerIdentity');
    const lines = t.trimEnd().split('\n');
    expect(lines[1]).toMatch(/GetCallerIdentity/);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(t).toContain('123456789012');
  });

  test('table anidada', () => {
    const t = renderTable({ Users: [{ UserName: 'ana', Path: '/' }, { UserName: 'bob', Path: '/' }] }, 'ListUsers');
    const lines = t.trimEnd().split('\n');
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(t).toContain('Users');
    expect(t).toContain('UserName');
  });
});
