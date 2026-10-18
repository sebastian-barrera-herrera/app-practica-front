import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { tap } from '@/lib/haptics';
import { colors, radius, shadow } from './theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onPress?: () => void;
  accent?: string;
  pad?: number;
  elevated?: boolean;
}

export function Card({ children, style, onPress, accent, pad = 16, elevated }: Props) {
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: pad,
    borderWidth: 1,
    borderColor: accent ? accent + '66' : colors.line,
    ...(elevated ? (shadow as ViewStyle) : null),
  };
  if (onPress)
    return (
      <Pressable
        onPress={() => {
          tap();
          onPress();
        }}
        style={({ pressed }) => [base, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }, style as ViewStyle]}
      >
        {children}
      </Pressable>
    );
  return <View style={[base, style as ViewStyle]}>{children}</View>;
}
