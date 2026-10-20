import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInRight } from 'react-native-reanimated';
import { courseDef, lessonById, worldOfLesson } from '@/content';
import type { Step } from '@/content/types';
import { useResume, validLesson, type LessonStats } from '@/game/resume';
import { useGame, type FinishOutcome } from '@/game/store';
import { showToast } from '@/ui/Toast';
import { useStudyContext } from '@/lib/studyClock';
import { AnyChallengeView } from '@/ui/AnyChallenge';
import { CodeLangProvider } from '@/ui/codeLang';
import { courseColor } from '@/ui/courseColors';
import { PyDemoView } from '@/ui/PyDemoView';
import { Illustration } from '@/illustrations';
import { Button } from '@/ui/Button';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { DemoView } from '@/ui/DemoView';
import { LessonSummary } from '@/ui/LessonSummary';
import { ProgressBar } from '@/ui/ProgressBar';
import { QuestionView } from '@/ui/QuestionView';
import { RichText } from '@/ui/RichText';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, makeStyles } from '@/ui/theme';

interface Item {
  key: string;
  step: Step;
  srsId?: string;
  retry?: boolean;
}

/** Cola de pasos: la lección entera o, al reanudar, la guardada (con las repeticiones de lo fallado). */
function buildQueue(lesson: { id: string; steps: Step[] }, keys?: string[]): Item[] {
  const at = (key: string): Item => {
    const i = parseInt(key, 10);
    const step = lesson.steps[i];
    return { key, step, srsId: step.type === 'quiz' ? `${lesson.id}#${i}` : undefined, retry: key.endsWith('-retry') || undefined };
  };
  return (keys ?? lesson.steps.map((_, i) => String(i))).map(at);
}

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = lessonById(id);
  const world = worldOfLesson(id);
  if (!lesson || !world) {
    return (
      <Screen>
        <T>Lección no encontrada</T>
        <Button label="Volver" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <CodeLangProvider course={world.course}>
      <Player key={lesson.id} lessonId={lesson.id} />
    </CodeLangProvider>
  );
}

function Player({ lessonId }: { lessonId: string }) {
  const lesson = lessonById(lessonId)!;
  const world = worldOfLesson(lessonId)!;
  const course = courseDef(world.course);
  const store = useGame;
  useStudyContext(course.id);
  // si el alumno salió a la mitad, se retoma exactamente en el paso donde lo dejó
  const saved = useMemo(() => validLesson(useResume.getState().lessons[lessonId], lesson.steps.length), [lessonId, lesson.steps.length]);
  const [queue, setQueue] = useState<Item[]>(() => buildQueue(lesson, saved?.queue));
  const [pos, setPos] = useState(saved?.pos ?? 0);
  const [outcome, setOutcome] = useState<FinishOutcome | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const stats = useRef<LessonStats>(saved ? { ...saved.stats } : { quizTotal: 0, quizFirstTry: 0, practices: 0, hintsUsed: 0 });
  const total = useMemo(() => queue.length, [queue.length]);

  useEffect(() => {
    if (saved && saved.pos > 0) showToast({ emoji: '▶️', title: 'Retomas donde lo dejaste', body: `Paso ${saved.pos + 1} de ${saved.queue.length}`, color: courseColor(course.id), ms: 2600 });
  }, [saved, course.id]);

  // cada avance se guarda: si sale de la lección o cierra la app, al volver continúa en este mismo paso
  useEffect(() => {
    if (outcome || pos === 0) return;
    useResume.getState().setLesson(lesson.id, { n: lesson.steps.length, queue: queue.map((q) => q.key), pos, stats: { ...stats.current }, ts: Date.now() });
  }, [pos, queue, outcome, lesson]);

  const restart = useCallback(() => {
    useResume.getState().clearLesson(lesson.id);
    stats.current = { quizTotal: 0, quizFirstTry: 0, practices: 0, hintsUsed: 0 };
    setQueue(buildQueue(lesson));
    setPos(0);
    setDemoDone(false);
    setConfirm(false);
  }, [lesson]);

  const finish = useCallback(() => {
    const out = store.getState().finishLesson(course.id, { lessonId: lesson.id, ...stats.current });
    useResume.getState().clearLesson(lesson.id);
    setOutcome(out);
  }, [lesson.id, store, course.id]);

  const next = useCallback(() => {
    setDemoDone(false);
    if (pos + 1 >= queue.length) finish();
    else setPos(pos + 1);
  }, [pos, queue.length, finish]);

  const nextLessonId = useMemo(() => {
    const wi = course.worlds.findIndex((w) => w.id === world.id);
    const li = world.lessons.findIndex((l) => l.id === lesson.id);
    if (li + 1 < world.lessons.length) return world.lessons[li + 1].id;
    return course.worlds[wi + 1]?.lessons[0]?.id ?? null;
  }, [world, lesson.id, course]);

  if (outcome) {
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <LessonSummary
          lesson={lesson}
          outcome={outcome}
          hasNext={!!nextLessonId}
          onNext={() => router.replace({ pathname: '/lesson/[id]', params: { id: nextLessonId! } })}
          onBack={() => router.back()}
        />
      </Screen>
    );
  }

  const item = queue[pos];
  const step = item.step;

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.top}>
        <Pressable onPress={() => setConfirm(true)} hitSlop={12} accessibilityLabel="Salir de la lección">
          <T style={{ fontSize: 22 }} color={colors.dim}>✕</T>
        </Pressable>
        <View style={{ flex: 1 }}>
          <ProgressBar value={pos / total} color={world.color || courseColor(course.id)} height={12} />
        </View>
        <T v="tiny" color={colors.dim}>{pos + 1}/{total}</T>
      </View>
      <Animated.View key={item.key + (item.retry ? 'r' : '')} entering={FadeInRight.duration(260)} style={{ flex: 1 }}>
        {step.type === 'learn' && (
          <StepScroll footer={<Button label="Entendido" onPress={next} />}>
            <View style={{ gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <T style={{ fontSize: 34 }}>{step.emoji ?? '📖'}</T>
                <T v="h1" style={{ flex: 1 }}>{step.title}</T>
              </View>
              <RichText body={step.body} />
            </View>
          </StepScroll>
        )}
        {step.type === 'illustration' && (
          <StepScroll footer={<Button label="Continuar" onPress={next} />}>
            <View style={{ gap: 16 }}>
              {step.title ? <T v="h1">{step.title}</T> : null}
              <Illustration id={step.id} />
              {step.caption ? <T v="small" color={colors.dim} center>{step.caption}</T> : null}
            </View>
          </StepScroll>
        )}
        {step.type === 'demo' && (
          <StepScroll footer={<Button label="Continuar" kind={demoDone ? 'primary' : 'secondary'} onPress={next} />}>
            <View style={{ gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T style={{ fontSize: 30 }}>▶️</T>
                <T v="h1" style={{ flex: 1 }}>{step.title ?? 'Mira cómo funciona'}</T>
              </View>
              <DemoView lines={step.lines} setup={step.setup} intro={step.intro} onComplete={() => setDemoDone(true)} />
            </View>
          </StepScroll>
        )}
        {step.type === 'quiz' && (
          <QuestionView
            q={step.q}
            seed={item.key + (item.retry ? 'r' : '')}
            onDone={(r) => {
              if (!item.retry) {
                stats.current.quizTotal += 1;
                if (r.correct) stats.current.quizFirstTry += 1;
              }
              if (item.srsId && !item.retry) store.getState().answer(course.id, item.srsId, r.correct);
              if (!r.correct && !item.retry) {
                // la repetimos un poco más adelante
                setQueue((q) => {
                  const copy = [...q];
                  const at = Math.min(copy.length, pos + 4);
                  copy.splice(at, 0, { ...item, key: item.key + '-retry', retry: true });
                  return copy;
                });
              }
              next();
            }}
          />
        )}
        {step.type === 'pydemo' && (
          <StepScroll footer={<Button label="Continuar" kind={demoDone ? 'primary' : 'secondary'} onPress={next} />}>
            <View style={{ gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T style={{ fontSize: 30 }}>▶️</T>
                <T v="h1" style={{ flex: 1 }}>{step.title ?? 'Mira cómo funciona'}</T>
              </View>
              <PyDemoView cells={step.cells} setup={step.setup} intro={step.intro} onComplete={() => setDemoDone(true)} />
            </View>
          </StepScroll>
        )}
        {(step.type === 'practice' || step.type === 'pypractice') && (
          <AnyChallengeView
            course={course.id}
            challenge={step.challenge}
            onRun={(line) => {
              const g = store.getState();
              if (course.id === 'linux') g.trackCommands('linux', [line], false);
              else g.bump(course.id, { commands: 1 });
            }}
            onSolved={(info) => {
              stats.current.practices += 1;
              stats.current.hintsUsed += info.hintsUsed + (info.usedSolution ? 2 : 0);
              store.getState().solveChallenge(course.id, step.challenge.id, info.commands);
              if (info.ctrlC) store.getState().bump(course.id, { ctrlC: 1 });
              next();
            }}
          />
        )}
      </Animated.View>
      <ConfirmModal
        visible={confirm}
        title="¿Salir de la lección?"
        message={pos > 0 ? `Tu avance se guarda: al volver retomarás en el paso ${pos + 1} de ${total}.` : 'Aún no has avanzado; podrás empezarla cuando quieras.'}
        confirmLabel="Salir y guardar"
        cancelLabel="Seguir aprendiendo"
        extraLabel={pos > 0 ? 'Empezar de cero' : undefined}
        onExtra={restart}
        onConfirm={() => {
          setConfirm(false);
          router.back();
        }}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}

function StepScroll({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeIn.duration(300)}>{children}</Animated.View>
      </ScrollView>
      <View style={{ padding: 16 }}>{footer}</View>
    </View>
  );
}

const styles = makeStyles(() => ({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
}));
