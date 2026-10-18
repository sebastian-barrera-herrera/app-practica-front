import { cmdMatches, normalizeCmd, seededShuffle } from '../cmdnorm';

test('normaliza espacios, comillas y cúmulos de flags', () => {
  expect(normalizeCmd('  ls   -la  ')).toBe(normalizeCmd('ls -al'));
  expect(normalizeCmd('ls -l -a')).toBe(normalizeCmd('ls -al'));
  expect(normalizeCmd("echo 'hola'")).toBe('echo "hola"');
  expect(normalizeCmd("echo 'a b'")).toBe("echo 'a b'");
  expect(normalizeCmd('head -n 5 f')).toBe('head -n 5 f');
  expect(normalizeCmd('sudo ls -la')).toBe(normalizeCmd('sudo ls -a -l'));
  // tar no se reordena: el orden de las letras importa
  expect(normalizeCmd('tar -czf a.tgz d')).not.toBe(normalizeCmd('tar -cfz a.tgz d'));
});

test('cmdMatches', () => {
  expect(cmdMatches('ls -al', ['ls -la'])).toBe(true);
  expect(cmdMatches('cd ..', ['cd ..'])).toBe(true);
  expect(cmdMatches('cd', ['cd ..'])).toBe(false);
  expect(cmdMatches('grep foo f', [], '^grep (-i|-in|-ni) foo f$')).toBe(false);
  expect(cmdMatches('grep -in foo f', [], '^grep (-i|-in|-ni) foo f$')).toBe(true);
  expect(cmdMatches('', ['x'])).toBe(false);
});

test('seededShuffle es determinista', () => {
  expect(seededShuffle([1, 2, 3, 4, 5], 'a')).toEqual(seededShuffle([1, 2, 3, 4, 5], 'a'));
  expect(seededShuffle([1, 2, 3, 4, 5], 'a').sort()).toEqual([1, 2, 3, 4, 5]);
});
