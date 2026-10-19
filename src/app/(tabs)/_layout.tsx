import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { select } from '@/lib/haptics';
import { courseDef } from '@/content';
import { useGame } from '@/game/store';
import { courseColor } from '@/ui/courseColors';
import { T } from '@/ui/Text';
import { colors, makeStyles } from '@/ui/theme';

/** Pestañas que dependen del curso activo llevan su color y, el laboratorio, su nombre. */
const TABS: Record<string, { label: string; emoji: string; course?: boolean }> = {
  today: { label: 'Hoy', emoji: '🏠' },
  roadmap: { label: 'Ruta', emoji: '🗺️', course: true },
  practice: { label: 'Practicar', emoji: '🥋', course: true },
  lab: { label: 'Lab', emoji: '🧪', course: true },
  profile: { label: 'Perfil', emoji: '🏅' },
};

function TabItem({ focused, label, emoji, onPress, accent }: { focused: boolean; label: string; emoji: string; onPress: () => void; accent: string }) {
  const a = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(focused ? 1.15 : 1, { damping: 12 }) }, { translateY: withSpring(focused ? -2 : 0) }] }));
  return (
    <Pressable onPress={onPress} style={styles.item} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }}>
      <Animated.View style={a}>
        <T style={{ fontSize: 24, opacity: focused ? 1 : 0.55 }}>{emoji}</T>
      </Animated.View>
      <T v="tiny" bold color={focused ? accent : colors.faint}>{label}</T>
      {focused && <View style={[styles.dot, { backgroundColor: accent }]} />}
    </Pressable>
  );
}

function DojoTabBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  const active = useGame((s) => s.active);
  const course = courseDef(active);
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((r, i) => {
        const meta = TABS[r.name];
        if (!meta) return null;
        const focused = state.index === i;
        const lab = r.name === 'lab';
        return (
          <TabItem
            key={r.key}
            focused={focused}
            label={lab ? course.lab.title : meta.label}
            emoji={lab ? course.lab.emoji : meta.emoji}
            accent={meta.course ? courseColor(active) : colors.mint}
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
      <Tabs.Screen name="today" />
      <Tabs.Screen name="roadmap" />
      <Tabs.Screen name="practice" />
      <Tabs.Screen name="lab" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = makeStyles(() => ({
  bar: { flexDirection: 'row', backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mint, marginTop: 1 },
}));
