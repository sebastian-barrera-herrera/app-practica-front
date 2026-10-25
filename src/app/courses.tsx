import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { allChallenges, COURSE_LIST, type CourseDef } from '@/content';
import { allQuestions } from '@/content/pool';
import { courseHasProgress } from '@/game/root';
import { useGame } from '@/game/store';
import { minutesLabel } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { courseColor } from '@/ui/courseColors';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, ink } from '@/ui/theme';

function CourseCard({ c, index, lastOne, onAsk }: { c: CourseDef; index: number; lastOne: boolean; onAsk: (c: CourseDef) => void }) {
  const root = useGame();
  const col = courseColor(c.id);
  const sel = !!root.settings.courseOn[c.id];
  const soon = c.worlds.length === 0;
  const done = c.lessons.filter((l) => root.courses[c.id].lessons[l.id]?.done).length;
  const started = courseHasProgress(root, c.id);
  const minutes = root.settings.goalMinutes[c.id];
  return (
    <Animated.View entering={FadeInDown.delay(index * 70).duration(280)}>
      <Card accent={sel ? col : undefined} style={sel ? { backgroundColor: col + '14' } : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: col + '26', borderWidth: 1.5, borderColor: col, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontSize: 32 }}>{c.emoji}</T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T v="h2" color={sel ? ink(col) : colors.text}>{c.name}</T>
              {sel ? <Chip label="En mis cursos" color={col} active /> : null}
              {soon ? <Chip label="Próximamente" color={colors.amber} /> : null}
            </View>
            <T v="small" color={colors.dim}>{c.tagline}</T>
          </View>
        </View>

        {soon ? (
          <T v="small" color={colors.dim} style={{ marginTop: 12 }}>Estamos preparando las lecciones de este curso. En cuanto esté listo podrás añadirlo.</T>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <Chip label={`🗺️ ${c.worlds.length} zonas`} color={col} dim />
              <Chip label={`📘 ${c.lessons.length} lecciones`} color={col} dim />
              <Chip label={`🎯 ${allQuestions(c.id).length} preguntas`} color={col} dim />
              <Chip label={`${c.lab.emoji} ${allChallenges(c.id).length} ${c.nouns.challenges}`} color={col} dim />
            </View>
            <T v="tiny" color={colors.faint} style={{ marginTop: 8 }}>
              {c.levels.map((l) => `${l.emoji} ${l.title.replace('Nivel ', '')}`).join('  ·  ')}
            </T>
            {started ? (
              <View style={{ marginTop: 10, gap: 4 }}>
                <ProgressBar value={c.lessons.length ? done / c.lessons.length : 0} color={col} height={8} />
                <T v="tiny" color={colors.dim}>{done}/{c.lessons.length} lecciones completadas</T>
              </View>
            ) : null}
            {sel ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <T v="small" bold>Meta diaria: {minutesLabel(minutes)}</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <Chip key={m} label={minutesLabel(m)} color={col} active={minutes === m} onPress={() => useGame.getState().setSettings({ goalMinutes: { ...root.settings.goalMinutes, [c.id]: m } })} />
                  ))}
                </View>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {sel ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Ir al curso"
                      color={col}
                      onPress={() => {
                        useGame.getState().setActive(c.id);
                        router.replace('/(tabs)/roadmap');
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Quitar" kind="ghost" disabled={lastOne} onPress={() => onAsk(c)} />
                  </View>
                </>
              ) : (
                <View style={{ flex: 1 }}>
                  <Button
                    label={started ? 'Volver a añadir' : 'Añadir a mis cursos'}
                    color={col}
                    onPress={() => {
                      const g = useGame.getState();
                      g.setCourseOn(c.id, true);
                      g.setActive(c.id);
                    }}
                  />
                </View>
              )}
            </View>
            {sel && lastOne ? <T v="tiny" color={colors.faint} style={{ marginTop: 6 }}>Es tu único curso: añade otro antes de quitarlo.</T> : null}
          </>
        )}
      </Card>
    </Animated.View>
  );
}

/** Catálogo de cursos: el alumno decide cuáles estudia. Quitar uno no borra su progreso. */
export default function Courses() {
  const on = useGame((s) => s.settings.courseOn);
  const [ask, setAsk] = useState<CourseDef | null>(null);
  const mine = COURSE_LIST.filter((c) => on[c.id]).length;
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Cursos</T>
          <T v="tiny" color={colors.dim}>Tú decides qué aprender · sigues {mine} de {COURSE_LIST.length}</T>
        </View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
        <T v="small" color={colors.dim}>
          Añade solo los que quieras. Cada curso tiene su ruta, su laboratorio, su meta diaria y su progreso. Si quitas uno, deja de aparecer y de contar para tus metas, pero tu progreso se guarda por si vuelves.
        </T>
        {COURSE_LIST.map((c, i) => (
          <CourseCard key={c.id} c={c} index={i} lastOne={mine <= 1 && !!on[c.id]} onAsk={setAsk} />
        ))}
      </ScrollView>
      <ConfirmModal
        visible={!!ask}
        title={`¿Quitar ${ask?.name ?? ''} de tus cursos?`}
        message="Dejará de aparecer y de contar para tus metas y avisos. Tu progreso se conserva: si lo vuelves a añadir, sigues donde lo dejaste."
        confirmLabel="Quitar curso"
        cancelLabel="Mantenerlo"
        danger
        onConfirm={() => {
          if (ask) useGame.getState().setCourseOn(ask.id, false);
          setAsk(null);
        }}
        onCancel={() => setAsk(null)}
      />
    </Screen>
  );
}
