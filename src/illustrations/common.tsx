import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { T } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

export function Frame({ title, children, style }: { title?: string; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 12, overflow: 'hidden' }, style]}>
      {title ? <T v="label" color={colors.dim}>{title}</T> : null}
      {children}
    </View>
  );
}

export const palette = {
  you: colors.mint,
  term: colors.cyan,
  shell: colors.violet,
  kernel: colors.amber,
  hw: colors.rose,
  file: colors.dim,
  dir: colors.cyan,
};
