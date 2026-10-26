import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAuth } from '@/cloud/auth';
import { useSync } from '@/cloud/sync';
import { COURSE_LIST, type CourseDef } from '@/content';
import type { CourseId } from '@/content/types';
import { balance } from '@/game/economy';
import { missionStates } from '@/game/missions';
import { nextStep, stepRoute } from '@/game/progress';
import { byCourse, dayComplete, enabledCourses, flat, goalSeconds, goalStreak, studySeconds } from '@/game/root';
import { lessonResumeLabel, useResume } from '@/game/resume';
import { reviewSession, shouldOfferSurprise } from '@/game/sessions';
import { useGame } from '@/game/store';
import { dayKey, streakAlive } from '@/game/streak';
import { levelProgress } from '@/game/xp';
import { success } from '@/lib/haptics';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { courseColor } from '@/ui/courseColors';
import { GoalRing } from '@/ui/GoalRing';
import { Avatar } from '@/ui/Avatar';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { showToast } from '@/ui/Toast';
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
  // se pintan los cursos elegidos y los que hayan tenido práctica esta semana
  const days = useMemo(() => {
    const out: { key: string; label: string; by: Record<CourseId, number> }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      out.push({ key, label: ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()], by: byCourse((c) => (study[c]?.[key] ?? 0) / 60) });
    }
    return out;
  }, [study]);
  const shown = COURSE_LIST.filter((c) => settings.courseOn[c.id] || days.some((d) => d.by[c.id] > 0));
  const goal = COURSE_LIST.reduce((n, c) => n + (settings.courseOn[c.id] ? settings.goalMinutes[c.id] : 0), 0) || 60;
  const max = Math.max(goal, ...days.map((d) => shown.reduce((n, c) => n + d.by[c.id], 0)), 30);
  const H = 90;
  const todayKey = dayKey(Date.now());
  return (
    <View>
      <View style={{ height: H, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: (goal / max) * H, borderTopWidth: 1, borderColor: colors.amber, borderStyle: 'dashed', opacity: 0.8 }} />
        {days.map((d) => (
          <View key={d.key} style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
            <View style={{ width: '70%', borderRadius: 6, overflow: 'hidden', backgroundColor: colors.card2, minHeight: 4 }}>
              {[...shown].reverse().map((c) => (
                <View key={c.id} style={{ height: (d.by[c.id] / max) * H, backgroundColor: courseColor(c.id) }} />
              ))}
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
        {shown.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: courseColor(c.id) }} />
            <T v="tiny" color={colors.dim}>{c.name}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Las tres misiones de hoy: se reclaman al terminarlas y dan monedas. */
function Missions() {
  const root = useGame();
  const day = dayKey(Date.now());
  const { list, bonusClaimed, allClaimed } = missionStates(root, day);
  const left = list.filter((x) => !x.claimed).length;
  return (
    <Card accent={allClaimed ? colors.green : colors.amber}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="h2">Misiones de hoy</T>
        <T v="small" bold color={allClaimed ? colors.green : colors.amber}>{allClaimed ? '¡Completadas! 🎉' : `${3 - left}/3`}</T>
      </View>
      <View style={{ gap: 12, marginTop: 12 }}>
        {list.map(({ mission, progress, done, claimed }) => (
          <View key={mission.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: claimed ? 0.55 : 1 }}>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: colors.amber + '22', alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontSize: 22 }}>{claimed ? '✅' : mission.emoji}</T>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <T v="small" bold>{mission.title}</T>
              <ProgressBar value={progress / mission.target} color={done ? colors.green : colors.amber} height={7} />
              <T v="tiny" color={colors.dim}>{progress}/{mission.target} · 🪙 {mission.coins}</T>
            </View>
            {done && !claimed ? (
              <Pressable
                onPress={() => {
                  const coins = useGame.getState().claimMission(mission.id);
                  if (coins > 0) {
                    success();
                    showToast({ emoji: '🪙', title: `+${coins} monedas`, body: coins > mission.coins ? '¡Y el bono por completar las tres misiones!' : mission.title, color: colors.amber, ms: 2600 });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Reclamar ${mission.coins} monedas`}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.amber }}
              >
                <T v="tiny" bold color="#2A1A00">Reclamar</T>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      <T v="tiny" color={colors.faint} style={{ marginTop: 10 }}>
        {bonusClaimed ? 'Bono del día cobrado: +30 🪙' : 'Completa las tres y cobra un bono de +30 🪙.'}
      </T>
    </Card>
  );
}

function CourseNext({ course }: { course: CourseDef }) {
  const root = useGame();
  const s = flat(root, course.id);
  const col = courseColor(course.id);
  const next = nextStep(s, course.worlds);
  const done = course.lessons.filter((l) => s.lessons[l.id]?.done).length;
  const rev = reviewSession(s, Date.now(), course);
  const lesson = next && next.kind === 'lesson' ? next.world.lessons[next.lessonIndex] : null;
  const started = done > 0;
  const resumes = useResume((r) => r.lessons);
  const where = lesson ? lessonResumeLabel(resumes[lesson.id], lesson.steps.length) : undefined;
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
            <>
              <T v="h3" numberOfLines={2}>{where ? 'Retoma: ' : started ? 'Sigue con: ' : 'Empieza con: '}{lesson.emoji} {lesson.title}</T>
              {where ? <T v="tiny" bold color={col}>▶ {where}</T> : null}
            </>
          ) : next ? (
            <>
              <T v="h3" numberOfLines={2}>{next.kind === 'boss' ? '🥋 Misión final' : '📝 Examen'}: {next.world.title}</T>
              <T v="tiny" bold color={col}>{next.kind === 'boss' ? 'Supérala para abrir la siguiente zona' : 'Apruébalo para abrir la siguiente zona'}</T>
            </>
          ) : (
            <T v="h3">¡Ruta completa! 🎉</T>
          )}
        </View>
      </View>
      {course.lessons.length > 0 && <ProgressBar value={done / course.lessons.length} color={col} height={8} style={{ marginTop: 10 }} />}
      {course.worlds.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={lesson ? (where ? 'Retomar' : started ? 'Continuar' : 'Empezar') : next ? (next.kind === 'boss' ? 'Ir a la misión' : 'Ir al examen') : 'Practicar'}
              color={col}
              onPress={() => {
                if (next) {
                  useGame.getState().setActive(course.id);
                  router.push(stepRoute(next, course.id));
                } else {
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
  const coins = balance(root.xp, root.extras);
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
          <Pressable onPress={() => router.push('/avatar')} accessibilityRole="button" accessibilityLabel="Mi avatar">
            <Avatar size={50} animated={false} />
          </Pressable>
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

        {/* nivel y monedas */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => router.push('/levels')} accessibilityRole="button" accessibilityLabel={`Nivel ${lp.level}, ${lp.title}. Ver todos los niveles`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.violet + '88', backgroundColor: colors.violet + '14' }}>
            <T style={{ fontSize: 22 }}>{lp.emoji}</T>
            <View style={{ flex: 1, gap: 4 }}>
              <T v="small" bold color={colors.violet} numberOfLines={1}>Nv. {lp.level} · {lp.title}</T>
              <ProgressBar value={lp.pct} color={colors.cyan} height={6} />
            </View>
          </Pressable>
          <Pressable onPress={() => router.push('/shop')} accessibilityRole="button" accessibilityLabel={`${coins} monedas. Abrir la tienda`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.amber + '88', backgroundColor: colors.amber + '14' }}>
            <T style={{ fontSize: 20 }}>🪙</T>
            <T bold color={colors.amber}>{coins.toLocaleString('es')}</T>
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
            <T v="small" color={colors.dim} style={{ marginTop: 8 }}>Añade un curso en «Cursos» para fijar tu tiempo diario.</T>
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
          </View>
          <T v="tiny" color={colors.faint} style={{ marginTop: 8 }}>
            Solo cuenta el tiempo en que practicas de verdad (lecciones, repasos, laboratorio).
          </T>
        </Card>

        <Missions />

        {/* seguir aprendiendo */}
        <T v="label" color={colors.dim} style={{ marginTop: 4 }}>Sigue aprendiendo</T>
        {COURSE_LIST.filter((c) => root.settings.courseOn[c.id]).map((c, i) => (
          <Animated.View key={c.id} entering={FadeInDown.delay(60 * i).duration(260)}>
            <CourseNext course={c} />
          </Animated.View>
        ))}
        {COURSE_LIST.some((c) => !root.settings.courseOn[c.id] && c.worlds.length > 0) && (
          <Card onPress={() => router.push('/courses')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <T style={{ fontSize: 28 }}>{COURSE_LIST.filter((c) => !root.settings.courseOn[c.id] && c.worlds.length > 0).map((c) => c.emoji).join(' ')}</T>
              <View style={{ flex: 1 }}>
                <T v="h3">Descubre más cursos</T>
                <T v="small" color={colors.dim}>Tú eliges qué aprender: añade otro curso cuando quieras.</T>
              </View>
              <T color={colors.mint} bold>Ver ›</T>
            </View>
          </Card>
        )}

        {/* semana */}
        <Card>
          <T v="h3" style={{ marginBottom: 10 }}>Tu semana</T>
          <WeekBars />
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
