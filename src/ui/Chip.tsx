import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { tap } from '@/lib/haptics';
import { T } from './Text';
import { colors, ink, radius } from './theme';

export function Chip({ label, color = colors.mint, onPress, active, style, mono, dim }: { label: string; color?: string; onPress?: () => void; active?: boolean; style?: ViewStyle; mono?: boolean; dim?: boolean }) {
  const inner = (
    <View
      style={[
        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active ? color : color + '22', borderWidth: 1, borderColor: color + (active ? 'ff' : '55') },
        style,
      ]}
    >
      <T v="tiny" bold color={active ? '#04120D' : dim ? colors.dim : ink(color)} style={mono ? { fontFamily: 'JetBrainsMono_700Bold' } : undefined}>
        {label}
      </T>
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
    >
      {inner}
    </Pressable>
  );
}
