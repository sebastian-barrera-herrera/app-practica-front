import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { select } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const TABS: Record<string, { label: string; emoji: string }> = {
  index: { label: 'Ruta', emoji: '🗺️' },
  practice: { label: 'Practicar', emoji: '🥋' },
  terminal: { label: 'Terminal', emoji: '⌨️' },
  profile: { label: 'Perfil', emoji: '🏅' },
};

function TabItem({ focused, label, emoji, onPress }: { focused: boolean; label: string; emoji: string; onPress: () => void }) {
  const a = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(focused ? 1.15 : 1, { damping: 12 }) }, { translateY: withSpring(focused ? -2 : 0) }] }));
  return (
    <Pressable onPress={onPress} style={styles.item} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }}>
      <Animated.View style={a}>
        <T style={{ fontSize: 24, opacity: focused ? 1 : 0.55 }}>{emoji}</T>
      </Animated.View>
      <T v="tiny" bold color={focused ? colors.mint : colors.faint}>{label}</T>
      {focused && <View style={styles.dot} />}
    </Pressable>
  );
}

function DojoTabBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((r, i) => {
        const meta = TABS[r.name];
        if (!meta) return null;
        const focused = state.index === i;
        return (
          <TabItem
            key={r.key}
            focused={focused}
            label={meta.label}
            emoji={meta.emoji}
            onPress={() => {
              select();
              if (!focused) navigateToTab(r.key);
            }}
          />
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <DojoTabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="practice" />
      <Tabs.Screen name="terminal" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mint, marginTop: 1 },
});
