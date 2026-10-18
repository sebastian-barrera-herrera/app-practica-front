import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { WORLDS } from '@/content';
import { ACHIEVEMENTS } from '@/game/achievements';
import { useGame } from '@/game/store';
import { Card } from '@/ui/Card';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

export default function Achievements() {
  const s = useGame();
  const list = useMemo(() => {
    const all = ACHIEVEMENTS(WORLDS);
    const ctx = { worlds: WORLDS, levels: [] };
    return all
      .map((a) => ({ a, at: s.achievements[a.id], p: s.achievements[a.id] ? 1 : a.progress ? Math.min(1, a.progress(s, ctx)) : 0 }))
      .sort((x, y) => (x.at ? 0 : 1) - (y.at ? 0 : 1) || (y.at ?? 0) - (x.at ?? 0) || y.p - x.p);
  }, [s.achievements, s.lessons, s.stats, s.xp, s.streak, s.exams]);
  const got = list.filter((x) => x.at).length;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Logros</T>
          <T v="tiny" color={colors.dim}>{got} de {list.length} desbloqueados</T>
        </View>
      </View>
      <ProgressBar value={got / Math.max(1, list.length)} color={colors.amber} height={10} style={{ marginBottom: 12 }} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.a.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 30 }}
        renderItem={({ item: { a, at, p } }) => (
          <Card pad={12} accent={at ? colors.amber : undefined} style={{ opacity: at ? 1 : 0.8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: at ? colors.amber + '22' : colors.card2, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ fontSize: 28, opacity: at ? 1 : 0.35 }}>{at ? a.emoji : '🔒'}</T>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="h3">{a.title}</T>
                <T v="small" color={colors.dim}>{a.desc}</T>
                {!at && a.progress ? <ProgressBar value={p} color={colors.cyan} height={6} style={{ marginTop: 4 }} /> : null}
                {at ? <T v="tiny" color={colors.faint}>{new Date(at).toLocaleDateString('es')}</T> : null}
              </View>
              <T v="small" bold color={at ? colors.amber : colors.faint}>+{a.xp} XP</T>
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
