import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAuth } from '@/cloud/auth';
import { useSync } from '@/cloud/sync';
import { COURSE_LIST, type CourseDef } from '@/content';
import type { CourseId } from '@/content/types';
import { nextLesson } from '@/game/progress';
import { dayComplete, enabledCourses, flat, goalSeconds, goalStreak, studySeconds } from '@/game/root';
import { reviewSession, shouldOfferSurprise } from '@/game/sessions';
import { useGame } from '@/game/store';
import { dayKey, streakAlive } from '@/game/streak';
import { levelProgress } from '@/game/xp';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { courseColor } from '@/ui/courseColors';
import { GoalRing } from '@/ui/GoalRing';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

function greeting(h: number) {
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

function SyncDot() {
  const phase = useSync((s) => s.phase);
  const offline = useAuth((s) => s.offline);
  const label = phase === 'syncing' ? 'Sincronizando…' : phase === 'error' ? 'Error al sincronizar' : phase === 'offline' || offline ? 'Sin conexión' : 'En la nube';
  const col = phase === 'error' ? colors.rose : phase === 'offline' || offline ? colors.amber : phase === 'syncing' ? colors.cyan : colors.green;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} accessibilityLabel={`Estado de sincronización: ${label}`}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
      <T v="tiny" color={colors.dim}>{label}</T>
    </View>
  );
}

/** Minutos de práctica de los últimos 7 días, apilados por curso, con la línea de la meta total. */
function WeekBars() {
  const study = useGame((s) => s.study);
  const settings = useGame((s) => s.settings);
  const days = useMemo(() => {
    const out: { key: string; label: string; by: Record<CourseId, number> }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      out.push({ key, label: ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()], by: { linux: (study.linux[key] ?? 0) / 60, python: (study.python[key] ?? 0) / 60 } });
    }
    return out;
  }, [study]);
  const goal = COURSE_LIST.reduce((n, c) => n + (settings.courseOn[c.id] ? settings.goalMinutes[c.id] : 0), 0) || 60;
  const max = Math.max(goal, ...days.map((d) => d.by.linux + d.by.python), 30);
  const H = 90;
  const todayKey = dayKey(Date.now());
  return (
    <View>
      <View style={{ height: H, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: (goal / max) * H, borderTopWidth: 1, borderColor: colors.amber, borderStyle: 'dashed', opacity: 0.8 }} />
        {days.map((d) => (
          <View key={d.key} style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
            <View style={{ width: '70%', borderRadius: 6, overflow: 'hidden', backgroundColor: colors.card2, minHeight: 4 }}>
              <View style={{ height: (d.by.python / max) * H, backgroundColor: courseColor('python') }} />
              <View style={{ height: (d.by.linux / max) * H, backgroundColor: courseColor('linux') }} />
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {days.map((d) => (
          <T key={d.key} v="tiny" center color={d.key === todayKey ? colors.text : colors.faint} style={{ flex: 1 }} bold={d.key === todayKey}>{d.label}</T>
        ))}
      </View>
      <T v="tiny" color={colors.amber} style={{ marginTop: 6 }}>- - Meta total: {goal} min</T>
    </View>
  );
}

function CourseNext({ course }: { course: CourseDef }) {
  const root = useGame();
  const s = flat(root, course.id);
  const col = courseColor(course.id);
  const next = nextLesson(s, course.worlds);
  const done = course.lessons.filter((l) => s.lessons[l.id]?.done).length;
  const rev = reviewSession(s, Date.now(), course);
  const lesson = next ? next.world.lessons[next.lessonIndex] : null;
  const started = done > 0;
  return (
    <Card accent={col}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: col + '26', borderWidth: 1.5, borderColor: col, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontSize: 26 }}>{course.emoji}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T v="tiny" bold color={col}>{course.name.toUpperCase()} · {done}/{course.lessons.length} LECCIONES</T>
          {course.worlds.length === 0 ? (
            <T v="h3">Próximamente</T>
          ) : lesson ? (
            <T v="h3" numberOfLines={2}>{started ? 'Sigue con: ' : 'Empieza con: '}{lesson.emoji} {lesson.title}</T>
          ) : (
            <T v="h3">¡Ruta completa! 🎉</T>
          )}
        </View>
      </View>
      {course.lessons.length > 0 && <ProgressBar value={done / course.lessons.length} color={col} height={8} style={{ marginTop: 10 }} />}
      {course.worlds.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1.4 }}>
            <Button
              label={lesson ? (started ? 'Continuar' : 'Empezar') : 'Practicar'}
              color={col}
              onPress={() => {
                if (lesson) router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } });
                else {
                  useGame.getState().setActive(course.id);
                  router.push('/(tabs)/practice');
                }
              }}
            />
          </View>
          {started && rev.due > 0 && (
            <View style={{ flex: 1 }}>
              <Button label={`Repasar ${rev.due}`} kind="secondary" onPress={() => router.push({ pathname: '/session/[mode]', params: { mode: 'review', course: course.id } })} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

export default function Today() {
  const root = useGame();
  const now = Date.now();
  const today = dayKey(now);
  const name = root.settings.name.split(' ')[0];
  const lp = levelProgress(root.xp);
  const alive = streakAlive(root.streak, now);
  const on = enabledCourses(root);
  const gs = goalStreak(root, now);
  const complete = dayComplete(root, today);
  const totalDone = on.reduce((n, c) => n + Math.min(studySeconds(root, c, today), goalSeconds(root, c)), 0);
  const totalGoal = on.reduce((n, c) => n + goalSeconds(root, c), 0);
  const surpriseCourse = COURSE_LIST.find((c) => root.settings.courseOn[c.id] && c.worlds.length > 0 && shouldOfferSurprise(flat(root, c.id), now));

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 14 }}>
        {/* saludo */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="small" color={colors.dim}>{greeting(new Date(now).getHours())}{name ? `, ${name}` : ''} 👋</T>
            <T v="h1">Tu día en Dev Dojo</T>
            <SyncDot />
          </View>
          <Pressable onPress={() => router.push('/(tabs)/profile')} accessibilityLabel={`Racha de ${root.streak.current} días`} style={{ alignItems: 'center' }}>
            <T style={{ fontSize: 24, opacity: alive ? 1 : 0.35 }}>🔥</T>
            <T v="tiny" bold color={alive ? colors.orange : colors.faint}>{root.streak.current}</T>
          </Pressable>
        </View>

        {surpriseCourse && (
          <Animated.View entering={FadeInDown.duration(260)}>
            <Card accent={colors.rose} onPress={() => router.push({ pathname: '/session/[mode]', params: { mode: 'surprise', course: surpriseCourse.id } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <T style={{ fontSize: 30 }}>🎯</T>
                <View style={{ flex: 1 }}>
                  <T v="h3">¡Examen sorpresa de {surpriseCourse.name}!</T>
                  <T v="small" color={colors.dim}>5 preguntas rápidas de lo que ya aprendiste</T>
                </View>
                <T color={colors.rose} bold>YA ›</T>
              </View>
            </Card>
          </Animated.View>
        )}

        {/* metas de hoy */}
        <Card elevated accent={complete ? colors.green : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T v="h2">Metas de hoy</T>
            <T v="small" bold color={complete ? colors.green : colors.amber}>
              {complete ? '¡Todo cumplido! 🏆' : on.length ? `${fmt(totalDone)} de ${fmt(totalGoal)}` : 'Sin cursos activos'}
            </T>
          </View>
          {on.length === 0 ? (
            <T v="small" color={colors.dim} style={{ marginTop: 8 }}>Activa al menos un curso en Ajustes ▸ Metas para fijar tu tiempo diario.</T>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 14 }}>
              {on.map((c) => {
                const def = COURSE_LIST.find((x) => x.id === c)!;
                const sec = studySeconds(root, c, today);
                const goal = goalSeconds(root, c);
                const col = courseColor(c);
                return (
                  <Pressable
                    key={c}
                    onPress={() => {
                      useGame.getState().setActive(c);
                      router.push('/(tabs)/roadmap');
                    }}
                    accessibilityLabel={`${def.name}: ${Math.floor(sec / 60)} de ${Math.floor(goal / 60)} minutos`}
                    style={{ alignItems: 'center', gap: 6 }}
                  >
                    <GoalRing value={sec / goal} size={96} stroke={9} color={col}>
                      <T style={{ fontSize: 26 }}>{def.emoji}</T>
                    </GoalRing>
                    <T v="h3" color={col}>{def.name}</T>
                    <T v="small" color={sec >= goal ? colors.green : colors.dim}>
                      {sec >= goal ? '¡Meta cumplida!' : `${Math.floor(sec / 60)} / ${Math.floor(goal / 60)} min`}
                    </T>
                  </Pressable>
                );
              })}
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, padding: 10, borderRadius: radius.md, backgroundColor: colors.card2 }}>
            <T style={{ fontSize: 20 }}>🏆</T>
            <T v="small" style={{ flex: 1 }} color={colors.dim}>
              Racha de metas: <T v="small" bold color={gs.current > 0 ? colors.amber : colors.faint}>{gs.current} día{gs.current === 1 ? '' : 's'}</T>
              {gs.best > gs.current ? ` · mejor ${gs.best}` : ''}
            </T>
            <T v="tiny" color={colors.faint}>Nv. {lp.level}</T>
          </View>
          <T v="tiny" color={colors.faint} style={{ marginTop: 8 }}>
            Solo cuenta el tiempo en que practicas de verdad (lecciones, repasos, laboratorio).
          </T>
        </Card>

        {/* seguir aprendiendo */}
        <T v="label" color={colors.dim} style={{ marginTop: 4 }}>Sigue aprendiendo</T>
        {COURSE_LIST.map((c, i) => (
          <Animated.View key={c.id} entering={FadeInDown.delay(60 * i).duration(260)} style={{ opacity: root.settings.courseOn[c.id] ? 1 : 0.7 }}>
            <CourseNext course={c} />
          </Animated.View>
        ))}

        {/* semana */}
        <Card>
          <T v="h3" style={{ marginBottom: 10 }}>Tu semana</T>
          <WeekBars />
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
            {COURSE_LIST.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: courseColor(c.id) }} />
                <T v="tiny" color={colors.dim}>{c.name}</T>
              </View>
            ))}
          </View>
        </Card>

        {!complete && on.length > 0 && (
          <View style={{ alignItems: 'center', gap: 4, paddingVertical: 8 }}>
            <Mascot size={70} mood="think" />
            <T v="small" center color={colors.dim}>«Un poco cada día gana a mucho de vez en cuando.» — Pingüi</T>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
