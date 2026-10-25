import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { CourseDef } from '@/content';
import type { WorldDef } from '@/content/types';
import { lessonDone, lessonUnlocked, nextLesson, openedBySkip, worldComplete, worldProgress, worldUnlocked } from '@/game/progress';
import { lessonResumeLabel, useResume } from '@/game/resume';
import { useCourse } from '@/game/store';
import { CourseHeader, CourseSwitcher } from '@/ui/CourseSwitcher';
import { courseColor } from '@/ui/courseColors';
import { tap, warn } from '@/lib/haptics';
import { Card } from '@/ui/Card';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { colors, ink, radius, makeStyles } from '@/ui/theme';

function Pulse({ color, children }: { color: string; children: React.ReactNode }) {
  const s = useSharedValue(1);
  React.useEffect(() => {
    s.value = withRepeat(withSequence(withTiming(1.12, { duration: 800, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) })), -1);
  }, [s]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 2 - s.value }));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 86, height: 86, borderRadius: 43, backgroundColor: color + '44' }, a]} />
      {children}
    </View>
  );
}

function Node({ emoji, state, color, title, stars, onPress, offset, delay, hint }: { emoji: string; state: 'locked' | 'open' | 'done'; color: string; title: string; stars?: number; onPress: () => void; offset: number; delay: number; hint?: string }) {
  const circle = (
    <View style={[styles.node, state === 'locked' && { backgroundColor: colors.card2, borderColor: colors.line }, state === 'open' && { backgroundColor: color, borderColor: '#ffffff55' }, state === 'done' && { backgroundColor: color + '33', borderColor: color }]}>
      <T style={{ fontSize: 30, opacity: state === 'locked' ? 0.4 : 1 }}>{state === 'locked' ? '🔒' : emoji}</T>
    </View>
  );
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(300)} style={{ alignItems: 'center', transform: [{ translateX: offset }], marginVertical: 8 }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {state === 'open' ? <Pulse color={color}>{circle}</Pulse> : circle}
      </Pressable>
      {state === 'done' && stars ? <T style={{ fontSize: 12, marginTop: 2 }}>{'⭐'.repeat(stars)}</T> : null}
      <T v="tiny" bold center color={state === 'locked' ? colors.faint : colors.text} style={{ marginTop: 4, maxWidth: 130 }}>{title}</T>
      {hint ? <T v="tiny" bold center color={ink(color)}>▶ {hint}</T> : null}
    </Animated.View>
  );
}

function WorldSection({ w, wi, course }: { w: WorldDef; wi: number; course: CourseDef }) {
  const { s } = useCourse(course.id);
  const WORLDS = course.worlds;
  const unlocked = worldUnlocked(s, WORLDS, wi);
  const prog = worldProgress(s, w);
  const complete = worldComplete(s, w);
  const exam = s.exams[`exam-${w.id}`];
  const resumes = useResume((r) => r.lessons);
  // las pruebas de la zona se abren al completarla o al abrir la zona con un examen de salto
  const testsOpen = complete || s.settings.unlockAll || wi <= s.skipTo;
  const bySkip = openedBySkip(s, WORLDS, wi);
  return (
    <View style={{ marginBottom: 12 }}>
      <Card accent={w.color} style={{ opacity: unlocked ? 1 : 0.6 }} onPress={() => (unlocked ? undefined : warn())}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={[styles.worldEmoji, { backgroundColor: w.color + '22', borderColor: w.color }]}>
            <T style={{ fontSize: 30 }}>{w.emoji}</T>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <T v="tiny" color={ink(w.color)} bold>ZONA {w.index}</T>
            <T v="h2">{w.title}</T>
            <T v="small" color={colors.dim}>{w.subtitle}</T>
          </View>
        </View>
        <View style={{ marginTop: 12, gap: 4 }}>
          <ProgressBar value={prog.pct} color={w.color} height={8} />
          <T v="tiny" color={colors.dim}>{prog.done}/{prog.total} lecciones{exam?.passed ? ' · 📝 examen aprobado' : ''}</T>
        </View>
        {bySkip ? <T v="tiny" bold color={colors.amber} style={{ marginTop: 6 }}>⚡ Abierta con un examen de salto</T> : null}
      </Card>
      {!unlocked && wi > 0 ? (
        <Card accent={colors.amber} style={{ marginTop: 8 }}>
          <T v="small" color={colors.dim}>🔒 Termina la zona anterior… o demuestra que ya lo sabes y salta directo.</T>
          <Button
            style={{ marginTop: 10 }}
            label="⚡ Examen de salto"
            kind="secondary"
            small
            onPress={() => router.push({ pathname: '/session/[mode]', params: { mode: `skip-${w.id}`, course: course.id } })}
          />
        </Card>
      ) : null}
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        {w.lessons.map((l, li) => {
          const done = lessonDone(s, l.id);
          const open = lessonUnlocked(s, WORLDS, wi, li);
          const state = done ? 'done' : open ? 'open' : 'locked';
          return (
            <Node
              key={l.id}
              emoji={l.emoji}
              title={l.title}
              state={state}
              color={w.color}
              stars={s.lessons[l.id]?.stars}
              hint={done ? undefined : lessonResumeLabel(resumes[l.id], l.steps.length)}
              delay={li * 50}
              offset={Math.sin(li * 1.15) * 54}
              onPress={() => {
                if (state === 'locked') {
                  warn();
                  return;
                }
                tap();
                router.push({ pathname: '/lesson/[id]', params: { id: l.id } });
              }}
            />
          );
        })}
        {w.boss && (
          <Node
            emoji="🥋"
            title="Misión final"
            state={!testsOpen ? 'locked' : s.challenges[w.boss.id]?.solved ? 'done' : 'open'}
            color={colors.rose}
            stars={s.challenges[w.boss.id]?.solved ? 3 : undefined}
            delay={w.lessons.length * 50}
            offset={Math.sin(w.lessons.length * 1.15) * 54}
            onPress={() => (testsOpen ? router.push({ pathname: '/session/[mode]', params: { mode: `boss-${w.id}`, course: course.id } }) : warn())}
          />
        )}
        <Node
          emoji="📝"
          title="Examen de la zona"
          state={!testsOpen ? 'locked' : exam?.passed ? 'done' : 'open'}
          color={colors.violet}
          stars={exam?.passed ? (exam.best >= 0.95 ? 3 : exam.best >= 0.85 ? 2 : 1) : undefined}
          delay={(w.lessons.length + 1) * 50}
          offset={Math.sin((w.lessons.length + 1) * 1.15) * 54}
          onPress={() => (testsOpen ? router.push({ pathname: '/session/[mode]', params: { mode: `exam-${w.id}`, course: course.id } }) : warn())}
        />
      </View>
    </View>
  );
}

export default function Roadmap() {
  const { s, course } = useCourse();
  const col = courseColor(course.id);
  const WORLDS = course.worlds;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo depende de las lecciones completadas
  const next = useMemo(() => nextLesson(s, WORLDS), [s.lessons, course.id]);
  const resumes = useResume((r) => r.lessons);
  const nextLes = next ? next.world.lessons[next.lessonIndex] : null;
  const where = nextLes ? lessonResumeLabel(resumes[nextLes.id], nextLes.steps.length) : undefined;
  const total = WORLDS.reduce((n, w) => n + w.lessons.length, 0);
  const doneCount = WORLDS.reduce((n, w) => n + w.lessons.filter((l) => s.lessons[l.id]?.done).length, 0);
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 16 }}>
        <View style={{ paddingTop: 8, gap: 12 }}>
          <CourseSwitcher />
          <CourseHeader course={course} title={`Ruta de ${course.name}`} subtitle={course.tagline} />
        </View>
        {WORLDS.length === 0 ? (
          <Card accent={col}>
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
              <Mascot size={110} mood="think" />
              <T v="h2">Ruta de {course.name} en camino</T>
              <T center color={colors.dim}>Estamos terminando las lecciones de este curso. Mientras tanto puedes seguir con el otro.</T>
            </View>
          </Card>
        ) : (
          <Card accent={col} elevated>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Mascot size={86} mood={next ? 'happy' : 'cheer'} />
              <View style={{ flex: 1, gap: 6 }}>
                {next ? (
                  <>
                    <T v="tiny" color={col} bold>{where ? `RETOMA DONDE QUEDASTE · ${where.toUpperCase()}` : 'CONTINÚA TU RUTA'}</T>
                    <T v="h3">{next.world.lessons[next.lessonIndex].emoji} {next.world.lessons[next.lessonIndex].title}</T>
                    <T v="tiny" color={colors.dim}>{doneCount}/{total} lecciones · ~{next.world.lessons[next.lessonIndex].minutes} min</T>
                  </>
                ) : (
                  <>
                    <T v="h3">¡Ruta completa! 🎉</T>
                    <T v="small" color={colors.dim}>Repasa, practica en el laboratorio o prepara las certificaciones.</T>
                  </>
                )}
              </View>
            </View>
            {next && (
              <Button
                style={{ marginTop: 12 }}
                color={col}
                label={where ? 'Retomar lección' : 'Empezar lección'}
                onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: next.world.lessons[next.lessonIndex].id } })}
              />
            )}
          </Card>
        )}
        {WORLDS.length > 0 &&
          course.levels.map((lv) => (
            <View key={lv.id} style={{ gap: 12 }}>
              <View style={[styles.levelBar, { borderColor: lv.color + '66', backgroundColor: lv.color + '14' }]}>
                <T style={{ fontSize: 22 }}>{lv.emoji}</T>
                <View style={{ flex: 1 }}>
                  <T v="h3" color={ink(lv.color)}>{lv.title}</T>
                  <T v="tiny" color={colors.dim}>{lv.subtitle}</T>
                </View>
              </View>
              {WORLDS.map((w, wi) => (w.level === lv.id ? <WorldSection key={w.id} w={w} wi={wi} course={course} /> : null))}
              {!WORLDS.some((w) => w.level === lv.id) && (
                <Card>
                  <T v="small" color={colors.dim}>Próximamente: más zonas en este nivel.</T>
                </Card>
              )}
            </View>
          ))}
      </ScrollView>
    </Screen>
  );
}

const styles = makeStyles(() => ({
  node: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderBottomWidth: 6 },
  worldEmoji: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  levelBar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, borderWidth: 1 },
}));
