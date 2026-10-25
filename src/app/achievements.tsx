import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { COURSE_LIST } from '@/content';
import type { CourseId } from '@/content/types';
import { allAchievements } from '@/game/achievements';
import { COURSE_KEYS, flat, shownCourses } from '@/game/root';
import { useGame } from '@/game/store';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { courseColor } from '@/ui/courseColors';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

type Filter = 'all' | 'general' | CourseId;

export default function Achievements() {
  const params = useLocalSearchParams<{ course?: string }>();
  const root = useGame();
  const [filter, setFilter] = useState<Filter>(COURSE_KEYS.includes(params.course as CourseId) ? (params.course as CourseId) : 'all');
  // solo los logros de los cursos que sigue (o ha practicado): no se llena la lista con cursos que no ha elegido
  const shown = useMemo(() => shownCourses(root), [root.settings.courseOn, root.courses, root.study]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const all = allAchievements(COURSE_LIST).filter((a) => (!a.course || shown.includes(a.course)) && (filter === 'all' ? true : filter === 'general' ? !a.course : a.course === filter));
    return all
      .map((a) => ({ a, at: root.achievements[a.id], p: root.achievements[a.id] ? 1 : a.progress ? Math.min(1, a.progress(flat(root, a.course ?? root.active), root)) : 0 }))
      .sort((x, y) => (x.at ? 0 : 1) - (y.at ? 0 : 1) || (y.at ?? 0) - (x.at ?? 0) || y.p - x.p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende solo de las porciones relevantes del estado
  }, [root.achievements, root.courses, root.xp, root.streak, root.goalDays, filter, shown]);
  const got = list.filter((x) => x.at).length;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Logros</T>
          <T v="tiny" color={colors.dim}>{got} de {list.length} desbloqueados</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <Chip label="Todos" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="⭐ General" active={filter === 'general'} color={colors.amber} onPress={() => setFilter('general')} />
        {COURSE_LIST.filter((c) => shown.includes(c.id)).map((c) => (
          <Chip key={c.id} label={`${c.emoji} ${c.name}`} active={filter === c.id} color={courseColor(c.id)} onPress={() => setFilter(c.id)} />
        ))}
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
                {a.course ? <T v="tiny" bold color={courseColor(a.course)}>{COURSE_LIST.find((c) => c.id === a.course)?.name.toUpperCase()}</T> : null}
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
