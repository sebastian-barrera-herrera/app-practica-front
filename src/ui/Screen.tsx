import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardSafe } from './KeyboardSafe';
import { colors } from './theme';

export function Screen({ children, style, edges = ['top'], padded = true }: { children: React.ReactNode; style?: ViewStyle; edges?: ('top' | 'bottom')[]; padded?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg, paddingTop: edges.includes('top') ? insets.top : 0, paddingBottom: edges.includes('bottom') ? insets.bottom : 0, paddingHorizontal: padded ? 16 : 0 }, style]}>
      <StatusBar style="light" />
      <KeyboardSafe>{children}</KeyboardSafe>
    </View>
  );
}
