import { StyleSheet } from 'react-native';
import { minLineHeight, T } from '../Text';
import { fonts } from '../theme';

type Variant = 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'mono' | 'label';
const flat = (el: unknown) => StyleSheet.flatten((el as { props: { style: object } }).props.style) as { fontSize: number; lineHeight: number };
const render = (props: Parameters<typeof T>[0]) => flat(T(props));

describe('altura de línea (no recortar texto ni emojis en Android)', () => {
  test('todas las variantes dejan holgura sobre la altura del glifo (Nunito ≈ 1,36 em)', () => {
    const all: Variant[] = ['title', 'h1', 'h2', 'h3', 'body', 'small', 'tiny', 'mono', 'label'];
    for (const v of all) {
      const s = render({ v, children: 'x' });
      expect(s.lineHeight / s.fontSize).toBeGreaterThanOrEqual(v === 'mono' ? 1.32 : 1.36);
    }
  });

  test('un emoji grande (fontSize sin lineHeight) recibe una altura de línea suficiente', () => {
    for (const size of [22, 26, 30, 34, 46, 64]) {
      const s = render({ style: { fontSize: size }, children: '⭐' });
      expect(s.lineHeight).toBeGreaterThanOrEqual(minLineHeight(size));
      expect(s.lineHeight / size).toBeGreaterThanOrEqual(1.36);
    }
  });

  test('una altura de línea demasiado corta se corrige; una correcta se respeta', () => {
    expect(render({ style: { fontSize: 9, lineHeight: 10 }, children: 'x' }).lineHeight).toBeGreaterThanOrEqual(minLineHeight(9));
    expect(render({ style: { fontSize: 13, lineHeight: 20 }, children: 'x' }).lineHeight).toBe(20);
    expect(render({ style: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 }, children: 'x' }).lineHeight).toBe(18);
  });
});
