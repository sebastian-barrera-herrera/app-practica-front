import React, { createContext, useContext } from 'react';
import { StyleSheet, Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts, monoFallback, termInk } from './theme';

type Variant = 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'mono' | 'label';

/**
 * Los `lineHeight` son generosos a propósito: en Android, si la altura de línea es menor que la del glifo
 * (Nunito mide ~1,36 em; los emojis y las tildes de las mayúsculas, más), el texto se dibuja recortado por arriba o por abajo.
 */
const variants: Record<Variant, TextStyle> = {
  title: { fontFamily: fonts.black, fontSize: 32, lineHeight: 44, letterSpacing: -0.5 },
  h1: { fontFamily: fonts.black, fontSize: 26, lineHeight: 36, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 28 },
  h3: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 23 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.semi, fontSize: 14, lineHeight: 21 },
  tiny: { fontFamily: fonts.semi, fontSize: 12, lineHeight: 17 },
  mono: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.black, fontSize: 12, lineHeight: 17, letterSpacing: 1, textTransform: 'uppercase' },
};

/** Altura de línea mínima que no recorta el glifo para un tamaño dado (emojis incluidos). */
export function minLineHeight(fontSize: number, mono = false): number {
  const k = mono ? 1.32 : fontSize >= 24 ? 1.38 : 1.4;
  return Math.ceil(fontSize * k);
}

const OnDarkContext = createContext(false);

/**
 * Marca su contenido como dibujado sobre un fondo de terminal (siempre oscuro): los textos `T` de dentro usan el
 * equivalente del tema oscuro de su color, así que se leen igual en el tema claro. Envuelve el interior de cada panel de terminal.
 */
export function OnDark({ children }: { children: React.ReactNode }) {
  return <OnDarkContext.Provider value>{children}</OnDarkContext.Provider>;
}

export interface TProps extends TextProps {
  v?: Variant;
  color?: string;
  center?: boolean;
  bold?: boolean;
}

/** Estilo final de un texto `T` (función pura: la usan el componente y los tests). */
export function textStyle({ v = 'body', color = colors.text, center, bold, style, onDark = false }: Pick<TProps, 'v' | 'color' | 'center' | 'bold' | 'style'> & { onDark?: boolean }): StyleProp<TextStyle> {
  const base = variants[v];
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  // Si el estilo cambia el tamaño (típico: emojis a 30–46 px) y no fija su propia altura de línea, o la deja corta,
  // se ajusta aquí para que nada quede cortado.
  const fs = flat?.fontSize ?? base.fontSize ?? 16;
  const mono = (flat?.fontFamily ?? base.fontFamily ?? '').toString().toLowerCase().includes('mono');
  const floor = minLineHeight(fs, mono);
  const lh = flat?.lineHeight ?? (flat?.fontSize != null ? 0 : base.lineHeight ?? 0);
  const fix: TextStyle | null = lh < floor && (flat?.fontSize != null || flat?.lineHeight != null) ? { lineHeight: floor } : null;
  return [
    base,
    { color: onDark ? termInk(color) : color },
    center && { textAlign: 'center' },
    bold && { fontFamily: v === 'mono' ? fonts.monoBold : fonts.bold },
    style,
    onDark && typeof flat?.color === 'string' ? { color: termInk(flat.color) } : null,
    fix,
  ];
}

export function T({ v, color, center, bold, style, ...rest }: TProps) {
  const onDark = useContext(OnDarkContext);
  return <RNText {...rest} style={textStyle({ v, color, center, bold, style, onDark })} />;
}

export const Mono = ({ style, ...p }: TextProps) => <RNText {...p} style={[{ fontFamily: fonts.mono || monoFallback, color: colors.termText, fontSize: 13, lineHeight: 19 }, style]} />;
