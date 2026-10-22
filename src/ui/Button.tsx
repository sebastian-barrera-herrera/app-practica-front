import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from './Text';
import { colors, radius, makeStyles } from './theme';

interface Props {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  icon?: string;
  disabled?: boolean;
  small?: boolean;
  style?: ViewStyle;
  full?: boolean;
  color?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({ label, onPress, kind = 'primary', icon, disabled, small, style, full = true, color }: Props) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const palette = {
    primary: { bg: color ?? colors.mint, fg: '#052018', border: color ?? colors.mintDark },
    accent: { bg: colors.cyan, fg: '#04202E', border: '#1B7DA8' },
    secondary: { bg: colors.card2, fg: colors.text, border: colors.line },
    ghost: { bg: 'transparent', fg: colors.dim, border: 'transparent' },
    danger: { bg: colors.rose, fg: '#2A0610', border: '#B8404F' },
  }[kind];
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPressIn={() => (s.value = withSpring(0.96, { damping: 15, stiffness: 300 }))}
      onPressOut={() => (s.value = withSpring(1, { damping: 12, stiffness: 260 }))}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[
        a,
        styles.base,
        small && styles.small,
        { backgroundColor: palette.bg, borderBottomColor: palette.border, alignSelf: full ? 'stretch' : 'flex-start', opacity: disabled ? 0.45 : 1 },
        kind === 'ghost' && { borderBottomWidth: 0 },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? <T v="h3" style={{ marginRight: 8 }}>{icon}</T> : null}
        {/* una sola línea: si no cabe, la letra se encoge un poco (antes se partía sílaba a sílaba o se cortaba) */}
        <T v={small ? 'small' : 'h3'} color={palette.fg} bold center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ letterSpacing: 0.3, flexShrink: 1 }}>{label}</T>
      </View>
    </AnimatedPressable>
  );
}

const styles = makeStyles(() => ({
  base: { paddingVertical: 14, paddingHorizontal: 20, minHeight: 54, borderRadius: radius.lg, borderBottomWidth: 4, alignItems: 'center', justifyContent: 'center' },
  small: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 40, borderRadius: radius.md, borderBottomWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
}));
