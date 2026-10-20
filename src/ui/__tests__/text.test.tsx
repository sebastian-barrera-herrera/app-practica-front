import { StyleSheet } from 'react-native';
import { minLineHeight, textStyle } from '../Text';
import { applyTheme, colors, darkColors, fonts, lightColors, termInk } from '../theme';

type Variant = 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'mono' | 'label';
const render = (props: Parameters<typeof textStyle>[0]) => StyleSheet.flatten(textStyle(props)) as { fontSize: number; lineHeight: number; color: string };

describe('altura de línea (no recortar texto ni emojis en Android)', () => {
  test('todas las variantes dejan holgura sobre la altura del glifo (Nunito ≈ 1,36 em)', () => {
    const all: Variant[] = ['title', 'h1', 'h2', 'h3', 'body', 'small', 'tiny', 'mono', 'label'];
    for (const v of all) {
      const s = render({ v });
      expect(s.lineHeight / s.fontSize).toBeGreaterThanOrEqual(v === 'mono' ? 1.32 : 1.36);
    }
  });

  test('un emoji grande (fontSize sin lineHeight) recibe una altura de línea suficiente', () => {
    for (const size of [22, 26, 30, 34, 46, 64]) {
      const s = render({ style: { fontSize: size } });
      expect(s.lineHeight).toBeGreaterThanOrEqual(minLineHeight(size));
      expect(s.lineHeight / size).toBeGreaterThanOrEqual(1.36);
    }
  });

  test('una altura de línea demasiado corta se corrige; una correcta se respeta', () => {
    expect(render({ style: { fontSize: 9, lineHeight: 10 } }).lineHeight).toBeGreaterThanOrEqual(minLineHeight(9));
    expect(render({ style: { fontSize: 13, lineHeight: 20 } }).lineHeight).toBe(20);
    expect(render({ style: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 } }).lineHeight).toBe(18);
  });
});

describe('texto sobre paneles de terminal (siempre oscuros)', () => {
  afterEach(() => applyTheme('dark'));

  test('en el tema claro, los colores de la paleta pasan a su equivalente oscuro', () => {
    applyTheme('light');
    expect(termInk(lightColors.mint)).toBe(darkColors.mint);
    expect(termInk(lightColors.text)).toBe(darkColors.text);
    expect(termInk(lightColors.dim)).toBe(darkColors.dim);
    expect(termInk(lightColors.amber + '33')).toBe(darkColors.amber + '33');
    // lo que no es de la paleta (blanco, negro, colores sueltos) no se toca
    expect(termInk('#FFFFFF')).toBe('#FFFFFF');
    expect(termInk('#123456')).toBe('#123456');
  });

  test('en el tema oscuro no cambia nada', () => {
    applyTheme('dark');
    expect(termInk(darkColors.mint)).toBe(darkColors.mint);
    expect(termInk(lightColors.mint)).toBe(lightColors.mint);
  });

  test('`T` dentro de un panel usa el color oscuro, tanto con `color` como con `style.color`', () => {
    applyTheme('light');
    expect(render({ color: colors.text, onDark: true }).color).toBe(darkColors.text);
    expect(render({ color: colors.dim, onDark: false }).color).toBe(lightColors.dim);
    expect(render({ style: { color: lightColors.rose }, onDark: true }).color).toBe(darkColors.rose);
  });
});
