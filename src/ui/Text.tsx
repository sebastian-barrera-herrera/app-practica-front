import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts, monoFallback } from './theme';

type Variant = 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'mono' | 'label';

const variants: Record<Variant, TextStyle> = {
  title: { fontFamily: fonts.black, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
  h1: { fontFamily: fonts.black, fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  h3: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.semi, fontSize: 14, lineHeight: 20 },
  tiny: { fontFamily: fonts.semi, fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.black, fontSize: 12, lineHeight: 16, letterSpacing: 1, textTransform: 'uppercase' },
};

export interface TProps extends TextProps {
  v?: Variant;
  color?: string;
  center?: boolean;
  bold?: boolean;
}

export function T({ v = 'body', color = colors.text, center, bold, style, ...rest }: TProps) {
  return (
    <RNText
      {...rest}
      style={[
        variants[v],
        v === 'mono' && !rest.children ? null : null,
        { color },
        center && { textAlign: 'center' },
        bold && { fontFamily: v === 'mono' ? fonts.monoBold : fonts.bold },
        style,
      ]}
    />
  );
}

export const Mono = ({ style, ...p }: TextProps) => <RNText {...p} style={[{ fontFamily: fonts.mono || monoFallback, color: colors.termText, fontSize: 13, lineHeight: 19 }, style]} />;
