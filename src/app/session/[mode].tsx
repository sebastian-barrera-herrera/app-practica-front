import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { courseDef, worldById, type CourseDef } from '@/content';
import { FAST_TYPES, questionById, type QItem } from '@/content/pool';
import type { AnyChallenge, CourseId, Question } from '@/content/types';
import { certExam, worldExam, type ExamPlan } from '@/game/exams';
import type { Achievement } from '@/game/achievements';
import { blitzPool, dailyChallenge, reviewSession, surpriseSession } from '@/game/sessions';
import { flat } from '@/game/root';
import { dayKey } from '@/game/streak';
import { RESUME_MAX_AGE, useResume, validExam, validRun } from '@/game/resume';
import { useGame } from '@/game/store';
import { useStudyContext } from '@/lib/studyClock';
import { AnyChallengeView } from '@/ui/AnyChallenge';
import { CodeLangProvider } from '@/ui/codeLang';
import { courseColor } from '@/ui/courseColors';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { QuestionView, type Result } from '@/ui/QuestionView';
import { Screen } from '@/ui/Screen';
import { SessionSummary, type Mistake } from '@/ui/SessionSummary';
import { T } from '@/ui/Text';
import { colors, fonts, makeStyles } from '@/ui/theme';

export default function SessionScreen() {
  const { mode, scope, course: courseParam } = useLocalSearchParams<{ mode: string; scope?: string; course?: string }>();
  const active = useGame((s) => s.active);
  // los exámenes y misiones de una zona saben a qué curso pertenecen; el resto lo indica el parámetro `course`
  const worldCourse = mode?.startsWith('boss-') || mode?.startsWith('exam-') ? worldById(mode.slice(mode.indexOf('-') + 1))?.course : undefined;
  const cid: CourseId = worldCourse ?? (courseParam === 'python' || courseParam === 'linux' ? courseParam : active);
  useStudyContext(cid);
  return (
    <CodeLangProvider course={cid}>
      <SessionRoute mode={mode} scope={scope} course={courseDef(cid)} />
    </CodeLangProvider>
  );
}

function SessionRoute({ mode, scope, course }: { mode: string; scope?: string; course: CourseDef }) {
  if (mode === 'review') return <ReviewRun course={course} />;
  if (mode === 'surprise') return <SurpriseRun course={course} />;
  if (mode === 'blitz') return <BlitzRun course={course} initialScope={scope} />;
  if (mode === 'daily') return <DailyRun course={course} />;
  if (mode?.startsWith('boss-')) return <BossRun course={course} worldId={mode.slice(5)} />;
  if (mode?.startsWith('exam-')) {
    const w = worldById(mode.slice(5));
    if (w) return <ExamRun course={course} resumeKey={mode} planOf={(seed) => worldExam(course, w, seed)} />;
  }
  if (mode?.startsWith('cert-')) return <ExamRun course={course} resumeKey={mode} planOf={(seed) => certExam(course, mode.slice(5) as never, seed)} />;
  return (
    <Screen>
      <T>Sesión no encontrada</T>
      <Button label="Volver" onPress={() => router.back()} />
    </Screen>
  );
}

// ───────────────────────── utilidades ─────────────────────────

function TopBar({ pos, total, color = colors.mint, right, onClose }: { pos: number; total: number; color?: string; right?: React.ReactNode; onClose: () => void }) {
  return (
    <View style={styles.top}>
      <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Salir">
        <T style={{ fontSize: 22 }} color={colors.dim}>✕</T>
      </Pressable>
      <View style={{ flex: 1 }}>
        <ProgressBar value={total ? pos / total : 0} color={color} height={12} />
      </View>
      {right ?? <T v="tiny" color={colors.dim}>{pos}/{total}</T>}
    </View>
  );
}

function useCountdown(seconds: number, running: boolean, onEnd: () => void) {
  const [left, setLeft] = useState(seconds);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    setLeft(seconds);
  }, [seconds]);
  useEffect(() => {
    if (!running || seconds <= 0) return;
    const t = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(t);
          setTimeout(() => endRef.current(), 0);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, seconds]);
  return left;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function correctText(q: Question): string | null {
  switch (q.t) {
    case 'mc': return q.options[q.answer];
    case 'multi': return q.answers.map((a) => q.options[a]).join(' · ');
    case 'tf': return q.answer ? 'Verdadero' : 'Falso';
    case 'cmd': return q.answers[0];
    case 'order': return q.answer;
    case 'fill': return q.answers.join(' · ');
    default: return null;
  }
}

// ───────────────────────── repaso espaciado ─────────────────────────

/** Preguntas guardadas de una sesión interrumpida, si todavía son válidas para este curso. */
function savedItems(key: string, course: CourseDef): QItem[] | null {
  const r = useResume.getState().runs[key];
  if (!r || Date.now() - r.ts > RESUME_MAX_AGE) return null;
  const items = r.ids.map((id) => questionById(id));
  return items.every((x) => !!x && x.course === course.id) ? (items as QItem[]) : null;
}

function QuestionRun({ course, items, title, color, mode, onFinish, srsReview, resumeKey, due }: { course: CourseDef; items: QItem[]; title: string; color?: string; mode: 'lesson' | 'exam'; onFinish: (results: { item: QItem; correct: boolean }[]) => void; srsReview?: boolean; resumeKey: string; due?: number }) {
  // si el alumno salió a la mitad, se retoma en la pregunta donde lo dejó
  const saved = useMemo(() => validRun(useResume.getState().runs[resumeKey], items.map((i) => i.id)), [resumeKey, items]);
  const [pos, setPos] = useState(saved?.pos ?? 0);
  const results = useRef<{ item: QItem; correct: boolean }[]>(saved ? saved.results.map((r, i) => ({ item: items[i], correct: r.correct })) : []);
  const [confirm, setConfirm] = useState(false);
  // un toque doble en «Continuar» no debe contar la misma pregunta dos veces
  const answeredAt = useRef(-1);
  const item = items[pos];
  const save = (next: number) =>
    useResume.getState().setRun(resumeKey, { ids: items.map((i) => i.id), pos: next, results: results.current.map((r) => ({ id: r.item.id, correct: r.correct })), due, ts: Date.now() });
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <TopBar pos={pos} total={items.length} color={color} onClose={() => setConfirm(true)} />
      {item && (
        <QuestionView
          q={item.q}
          seed={`${title}-${pos}`}
          mode={mode}
          continueLabel={pos + 1 >= items.length ? 'Terminar' : 'Continuar'}
          onDone={(r: Result) => {
            if (answeredAt.current === pos) return;
            answeredAt.current = pos;
            useGame.getState().answer(course.id, item.id, r.correct, { review: srsReview });
            results.current.push({ item, correct: r.correct });
            if (pos + 1 >= items.length) {
              useResume.getState().clearRun(resumeKey);
              onFinish(results.current);
            } else {
              save(pos + 1);
              setPos(pos + 1);
            }
          }}
        />
      )}
      <ConfirmModal
        visible={confirm}
        title="¿Salir?"
        message={pos > 0 ? `Tu avance se guarda: al volver seguirás en la pregunta ${pos + 1} de ${items.length}.` : 'Podrás empezar cuando quieras.'}
        confirmLabel="Salir y guardar"
        cancelLabel="Seguir"
        extraLabel={pos > 0 ? 'Empezar de cero' : undefined}
        onExtra={() => {
          useResume.getState().clearRun(resumeKey);
          results.current = [];
          answeredAt.current = -1;
          setPos(0);
          setConfirm(false);
        }}
        onConfirm={() => {
          if (pos > 0) save(pos);
          router.back();
        }}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}

function ReviewRun({ course }: { course: CourseDef }) {
  const plan = useMemo(() => {
    const items = savedItems(`review-${course.id}`, course);
    if (items) return { items, due: useResume.getState().runs[`review-${course.id}`]?.due ?? items.length, fresh: false };
    return reviewSession(flat(useGame.getState(), course.id), Date.now(), course, 10);
  }, [course]);
  const [res, setRes] = useState<null | { xp: number; correct: number; total: number; mistakes: Mistake[]; ach: Achievement[]; levelUp: number | null }>(null);
  if (!plan.items.length) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <Mascot mood="think" size={130} />
          <T v="h1" center>Nada que repasar todavía</T>
          <T color={colors.dim} center>Completa alguna lección y volveré con preguntas para que no olvides lo aprendido.</T>
          <Button label="Volver" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  if (res) {
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <SessionSummary
          title={res.correct === res.total ? '¡Repaso perfecto!' : 'Repaso completado'}
          subtitle="La memoria se entrena como un músculo"
          mood={res.correct === res.total ? 'cheer' : 'happy'}
          big={`${res.correct}/${res.total}`}
          rows={[{ label: 'Preguntas', value: String(res.total) }, { label: 'Aciertos', value: String(res.correct), color: colors.green }, { label: 'Pendientes tras repasar', value: String(Math.max(0, plan.due - res.total)) }]}
          xp={res.xp}
          achievements={res.ach}
          mistakes={res.mistakes}
          levelUp={res.levelUp}
          confetti={res.correct === res.total}
          actions={[{ label: 'Terminar', onPress: () => router.back() }]}
        />
      </Screen>
    );
  }
  return (
    <QuestionRun
      course={course}
      items={plan.items}
      title="Repaso"
      resumeKey={`review-${course.id}`}
      due={plan.due}
      color={courseColor(course.id)}
      mode="lesson"
      srsReview
      onFinish={(r) => {
        const correct = r.filter((x) => x.correct).length;
        const xp = Math.min(40, correct * 3 + 4);
        const g = useGame.getState();
        const a = g.awardXp(course.id, xp);
        const ach = g.checkAchievements();
        setRes({ xp, correct, total: r.length, levelUp: a.levelUp, ach, mistakes: r.filter((x) => !x.correct).map((x) => ({ q: x.item.q.q, correct: correctText(x.item.q), why: x.item.q.why })) });
      }}
    />
  );
}

// ───────────────────────── examen sorpresa ─────────────────────────

function SurpriseRun({ course }: { course: CourseDef }) {
  const resumed = useMemo(() => savedItems(`surprise-${course.id}`, course), [course]);
  const plan = useMemo(() => resumed ?? surpriseSession(flat(useGame.getState(), course.id), Date.now(), course), [course, resumed]);
  const [started, setStarted] = useState(!!resumed);
  const [res, setRes] = useState<null | { xp: number; correct: number; total: number; ach: Achievement[]; mistakes: Mistake[] }>(null);
  useEffect(() => {
    if (!resumed) useGame.getState().markSurprise({ lastShown: Date.now() });
  }, [resumed]);
  if (res)
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <SessionSummary
          title={res.correct >= 4 ? '¡Superado con nota!' : res.correct >= 3 ? '¡Aprobado!' : 'Casi…'}
          subtitle="Examen sorpresa"
          mood={res.correct >= 4 ? 'cool' : res.correct >= 3 ? 'happy' : 'oops'}
          big={`${res.correct}/${res.total}`}
          rows={[{ label: 'Aciertos', value: `${res.correct} de ${res.total}`, color: colors.green }]}
          xp={res.xp}
          achievements={res.ach}
          mistakes={res.mistakes}
          confetti={res.correct >= 4}
          actions={[{ label: 'Terminar', onPress: () => router.back() }]}
        />
      </Screen>
    );
  if (!started)
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <Mascot mood="oops" size={150} />
          <T v="title" center>¡Examen sorpresa de {course.name}! 🥷</T>
          <T color={colors.dim} center>{plan.length} preguntas rápidas de lo que ya aprendiste. Sin pistas. ¿Listo?</T>
          <Button label="Aceptar el reto" onPress={() => setStarted(true)} />
          <Button label="Ahora no" kind="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  return (
    <QuestionRun
      course={course}
      items={plan}
      title="Sorpresa"
      resumeKey={`surprise-${course.id}`}
      color={colors.rose}
      mode="exam"
      onFinish={(r) => {
        const correct = r.filter((x) => x.correct).length;
        const xp = 15 + correct * 6;
        const g = useGame.getState();
        g.awardXp(course.id, xp);
        const ach = g.bump(course.id, { surprises: 1 });
        setRes({ xp, correct, total: r.length, ach, mistakes: r.filter((x) => !x.correct).map((x) => ({ q: x.item.q.q, correct: correctText(x.item.q), why: x.item.q.why })) });
      }}
    />
  );
}

// ───────────────────────── prueba rápida ─────────────────────────

function BlitzRun({ course, initialScope }: { course: CourseDef; initialScope?: string }) {
  const [scope, setScope] = useState<string | null>(initialScope ?? null);
  const [phase, setPhase] = useState<'pick' | 'play' | 'end'>(initialScope ? 'play' : 'pick');
  const pool = useMemo(() => (scope ? blitzPool(flat(useGame.getState(), course.id), scope, course) : []), [scope, course]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [end, setEnd] = useState<null | { xp: number; ach: Achievement[]; record: boolean }>(null);
  const best = useGame((s) => s.courses[course.id].stats.blitzBest);
  const finish = useCallback(() => {
    setPhase('end');
  }, []);
  const left = useCountdown(60, phase === 'play', finish);

  useEffect(() => {
    if (phase === 'end' && !end) {
      const g = useGame.getState();
      const xp = Math.min(80, correct * 3 + (bestCombo >= 5 ? 10 : 0));
      const record = correct > g.courses[course.id].stats.blitzBest;
      g.awardXp(course.id, xp);
      const ach = g.setStat(course.id, 'blitzBest', correct);
      setEnd({ xp, ach, record });
    }
  }, [phase, end, correct, bestCombo, course.id]);

  if (phase === 'pick') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ gap: 16, paddingTop: 12 }}>
          <Pressable onPress={() => router.back()}><T color={colors.dim}>← Volver</T></Pressable>
          <T v="title">⚡ Prueba rápida</T>
          <T color={colors.dim}>60 segundos. Responde todas las que puedas. Los aciertos seguidos suman combo.</T>
          <T v="small" color={colors.dim}>Récord actual: <T v="small" bold color={colors.amber}>{best}</T></T>
          <View style={{ gap: 10 }}>
            <Button label="Lo que has aprendido" onPress={() => { setScope('learned'); setPhase('play'); }} />
            <Button label="Todo el temario" kind="secondary" onPress={() => { setScope('all'); setPhase('play'); }} />
          </View>
          <T v="label" color={colors.dim}>O elige una zona</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {course.worlds.map((w) => (
              <Chip key={w.id} label={`${w.emoji} ${w.title}`} color={w.color} onPress={() => { setScope(w.id); setPhase('play'); }} />
            ))}
          </View>
        </View>
      </Screen>
    );
  }
  if (phase === 'end' && end) {
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <SessionSummary
          title={end.record ? '¡Nuevo récord!' : '¡Tiempo!'}
          subtitle="Prueba rápida"
          mood={correct >= 10 ? 'cool' : 'happy'}
          big={String(correct)}
          rows={[
            { label: 'Aciertos', value: String(correct), color: colors.green },
            { label: 'Fallos', value: String(wrong), color: colors.rose },
            { label: 'Mejor combo', value: `×${bestCombo}`, color: colors.orange },
            { label: 'Puntuación', value: String(score), color: colors.amber },
          ]}
          xp={end.xp}
          achievements={end.ach}
          confetti={end.record || correct >= 10}
          actions={[
            { label: 'Otra vez', onPress: () => { setIdx(0); setCorrect(0); setWrong(0); setCombo(0); setBestCombo(0); setScore(0); setEnd(null); setPhase('play'); } },
            { label: 'Salir', kind: 'ghost', onPress: () => router.back() },
          ]}
        />
      </Screen>
    );
  }
  const item = pool[idx % Math.max(1, pool.length)];
  if (!item) {
    return (
      <Screen><T>No hay preguntas disponibles.</T><Button label="Volver" onPress={() => router.back()} /></Screen>
    );
  }
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>✕</T></Pressable>
        <View style={{ flex: 1 }}>
          <ProgressBar value={left / 60} color={left < 10 ? colors.rose : colors.amber} height={12} />
        </View>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 16 }} color={left < 10 ? colors.rose : colors.amber}>{left}s</T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
        <T v="small" bold color={colors.green}>✓ {correct}</T>
        <T v="small" bold color={colors.orange}>{combo >= 3 ? `🔥 combo ×${combo}` : ''}</T>
        <T v="small" bold color={colors.amber}>★ {score}</T>
      </View>
      <QuestionView
        q={item.q}
        seed={`blitz-${idx}`}
        mode="blitz"
        onDone={(r) => {
          useGame.getState().answer(course.id, item.id, r.correct);
          if (r.correct) {
            const c = combo + 1;
            setCorrect((n) => n + 1);
            setCombo(c);
            setBestCombo((b) => Math.max(b, c));
            setScore((s) => s + 10 + Math.floor(c / 3) * 5);
          } else {
            setWrong((n) => n + 1);
            setCombo(0);
          }
          setIdx((i) => i + 1);
        }}
      />
    </Screen>
  );
}

// ───────────────────────── exámenes y certificaciones ─────────────────────────

function ExamRun({ course, planOf, resumeKey }: { course: CourseDef; planOf: (seed: string) => ExamPlan; resumeKey: string }) {
  const key = `${course.id}:${resumeKey}`;
  // la semilla se guarda con el avance: al reanudar se reconstruye el mismo examen
  const seed = useRef<string>(useResume.getState().exams[key]?.seed ?? String(Date.now()));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- el plan se genera una sola vez por examen
  const plan = useMemo(() => planOf(seed.current), []);
  const saved = useMemo(() => validExam(useResume.getState().exams[key], plan.questions.map((q) => q.id), plan.challenges.length), [key, plan]);
  const [phase, setPhase] = useState<'intro' | 'q' | 'c' | 'end'>(saved ? saved.phase : 'intro');
  const [pos, setPos] = useState(saved?.pos ?? 0);
  const [cpos, setCpos] = useState(saved?.cpos ?? 0);
  const results = useRef<{ item: QItem; correct: boolean }[]>(saved ? saved.results.map((r) => ({ item: plan.questions.find((q) => q.id === r.id)!, correct: r.correct })).filter((r) => !!r.item) : []);
  const solved = useRef(saved?.solved ?? 0);
  const answeredAt = useRef(-1);
  const [confirm, setConfirm] = useState(false);
  const [end, setEnd] = useState<null | { score: number; passed: boolean; xp: number; ach: Achievement[]; levelUp: number | null }>(null);
  const finish = useCallback(() => {
    setPhase('end');
  }, []);
  const left = useCountdown(saved?.left ?? plan.seconds, phase === 'q' || phase === 'c', finish);
  const leftRef = useRef(left);
  leftRef.current = left;
  const totalPts = plan.questions.length + plan.challenges.length * 3;

  // el avance se guarda en cada paso; el reloj se detiene mientras el alumno está fuera
  const persist = useCallback(() => {
    useResume.getState().setExam(key, {
      seed: seed.current,
      qids: plan.questions.map((q) => q.id),
      phase: phase === 'c' ? 'c' : 'q',
      pos,
      cpos,
      results: results.current.map((r) => ({ id: r.item.id, correct: r.correct })),
      solved: solved.current,
      left: plan.seconds > 0 ? Math.max(1, leftRef.current) : 0,
      ts: Date.now(),
    });
  }, [key, plan, phase, pos, cpos]);
  useEffect(() => {
    if (phase === 'q' || phase === 'c') persist();
    else if (phase === 'end') useResume.getState().clearExam(key);
  }, [phase, pos, cpos, persist, key]);

  const exitModal = (
    <ConfirmModal
      visible={confirm}
      title="¿Salir del examen?"
      message="Tu avance se guarda y el reloj se detiene: al volver continuarás donde lo dejaste."
      confirmLabel="Salir y guardar"
      cancelLabel="Seguir"
      extraLabel="Abandonar (no presentado)"
      onExtra={() => {
        useResume.getState().clearExam(key);
        router.back();
      }}
      onConfirm={() => {
        persist();
        router.back();
      }}
      onCancel={() => setConfirm(false)}
    />
  );

  useEffect(() => {
    if (phase !== 'end' || end) return;
    const got = results.current.filter((r) => r.correct).length + solved.current * 3;
    const score = totalPts ? got / totalPts : 0;
    const g = useGame.getState();
    const r = g.recordExam(course.id, plan.id, score, plan.passMark, plan.bonusXp);
    setEnd({ score, passed: r.passed, xp: r.passed ? plan.bonusXp : Math.round(plan.bonusXp * 0.15), ach: r.newAchievements, levelUp: r.levelUp });
  }, [phase, end, plan, totalPts, course.id]);

  if (phase === 'intro') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <T style={{ fontSize: 64 }}>{plan.emoji}</T>
            <T v="title" center>{plan.title}</T>
            <T color={colors.dim} center>{plan.subtitle}</T>
          </View>
          <Card>
            <View style={{ gap: 8 }}>
              <T v="small">⏱  Tiempo: <T v="small" bold>{fmt(plan.seconds)}</T></T>
              <T v="small">🎯  Para aprobar: <T v="small" bold>{Math.round(plan.passMark * 100)} %</T></T>
              <T v="small">🧩  Sin pistas ni explicaciones hasta el final</T>
              <T v="small">💎  Premio: <T v="small" bold color={colors.amber}>+{plan.bonusXp} XP</T></T>
            </View>
          </Card>
          <Button label="Empezar examen" onPress={() => setPhase(plan.questions.length ? 'q' : 'c')} />
          <Button label="Ahora no" kind="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  if (phase === 'end') {
    if (!end) return <Screen><T>Calculando…</T></Screen>;
    const mistakes: Mistake[] = results.current.filter((r) => !r.correct).map((r) => ({ q: r.item.q.q, correct: correctText(r.item.q), why: r.item.q.why }));
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <SessionSummary
          title={end.passed ? '¡Aprobado!' : 'Todavía no'}
          subtitle={plan.title}
          mood={end.passed ? (end.score >= 0.9 ? 'cool' : 'cheer') : 'oops'}
          big={`${Math.round(end.score * 100)} %`}
          rows={[
            { label: 'Nota mínima', value: `${Math.round(plan.passMark * 100)} %` },
            { label: 'Preguntas acertadas', value: `${results.current.filter((r) => r.correct).length}/${plan.questions.length}`, color: colors.green },
            ...(plan.challenges.length ? [{ label: 'Retos superados', value: `${solved.current}/${plan.challenges.length}`, color: colors.cyan }] : []),
            { label: 'Resultado', value: end.passed ? 'APROBADO' : 'NO APROBADO', color: end.passed ? colors.green : colors.rose },
          ]}
          xp={end.xp}
          achievements={end.ach}
          mistakes={mistakes}
          levelUp={end.levelUp}
          confetti={end.passed}
          actions={[
            ...(end.passed ? [] : [{ label: 'Repasar y reintentar', onPress: () => router.replace({ pathname: '/session/[mode]', params: { mode: plan.id, course: course.id } }) }]),
            { label: 'Volver', kind: end.passed ? ('primary' as const) : ('ghost' as const), onPress: () => router.back() },
          ]}
        />
      </Screen>
    );
  }
  const timer = <T style={{ fontFamily: fonts.monoBold, fontSize: 15 }} color={left < 60 ? colors.rose : colors.violet}>{fmt(left)}</T>;
  if (phase === 'q') {
    const item = plan.questions[pos];
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <TopBar pos={pos} total={plan.questions.length + plan.challenges.length} color={plan.color} right={timer} onClose={() => setConfirm(true)} />
        <QuestionView
          q={item.q}
          seed={`exam-${plan.id}-${pos}`}
          mode="exam"
          continueLabel="Siguiente"
          onDone={(r) => {
            if (answeredAt.current === pos) return;
            answeredAt.current = pos;
            useGame.getState().answer(course.id, item.id, r.correct);
            results.current.push({ item, correct: r.correct });
            if (pos + 1 >= plan.questions.length) {
              if (plan.challenges.length) setPhase('c');
              else finish();
            } else setPos(pos + 1);
          }}
        />
        {exitModal}
      </Screen>
    );
  }
  const ch: AnyChallenge = plan.challenges[cpos];
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <TopBar pos={plan.questions.length + cpos} total={plan.questions.length + plan.challenges.length} color={plan.color} right={timer} onClose={() => setConfirm(true)} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
        <Chip label={`Reto práctico ${cpos + 1}/${plan.challenges.length}`} color={colors.violet} />
      </View>
      <AnyChallengeView
        key={ch.id}
        course={course.id}
        challenge={ch}
        strict
        continueLabel={cpos + 1 >= plan.challenges.length ? 'Terminar examen' : 'Siguiente reto'}
        onRun={(line) => trackRun(course.id, line, false)}
        onSolved={() => {
          solved.current += 1;
          if (cpos + 1 >= plan.challenges.length) finish();
          else setCpos(cpos + 1);
        }}
      />
      <View style={{ padding: 10 }}>
        <Button small kind="ghost" label="Saltar este reto" onPress={() => (cpos + 1 >= plan.challenges.length ? finish() : setCpos(cpos + 1))} />
      </View>
      {exitModal}
    </Screen>
  );
}

// ───────────────────────── reto final / reto diario ─────────────────────────

function ChallengeShell({ course, challenge, title, xp, onDone, doneLabel }: { course: CourseDef; challenge: AnyChallenge; title: string; xp: number; onDone: (info: { ach: Achievement[]; levelUp: number | null }) => void; doneLabel: string }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.top}>
        <Pressable onPress={() => setConfirm(true)} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>✕</T></Pressable>
        <T v="h3" style={{ flex: 1 }}>{title}</T>
        <Chip label={`+${xp} XP`} color={colors.amber} />
      </View>
      <AnyChallengeView
        course={course.id}
        challenge={challenge}
        continueLabel={doneLabel}
        onRun={(line) => trackRun(course.id, line, false)}
        onSolved={(info) => {
          const g = useGame.getState();
          g.solveChallenge(course.id, challenge.id, info.commands);
          if (info.ctrlC) g.bump(course.id, { ctrlC: 1 });
          const a = g.awardXp(course.id, Math.max(10, xp - info.hintsUsed * 3 - (info.usedSolution ? 10 : 0)));
          onDone({ ach: g.checkAchievements(), levelUp: a.levelUp });
        }}
      />
      <ConfirmModal visible={confirm} title="¿Salir del reto?" message="Podrás volver cuando quieras." confirmLabel="Salir" cancelLabel="Seguir" onConfirm={() => router.back()} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}

function BossRun({ course, worldId }: { course: CourseDef; worldId: string }) {
  const w = worldById(worldId);
  if (!w?.boss) return <Screen><T>Misión no encontrada</T></Screen>;
  return <ChallengeShell course={course} challenge={w.boss} title={`Misión: ${w.title}`} xp={60} doneLabel="Completar misión" onDone={() => router.back()} />;
}

function DailyRun({ course }: { course: CourseDef }) {
  const d = useMemo(() => dailyChallenge(flat(useGame.getState(), course.id), Date.now(), course), [course]);
  const daily = useGame((s) => s.courses[course.id].daily);
  const already = daily.day === dayKey(Date.now()) && daily.done;
  if (!d) return <Screen><T>Aún no hay retos disponibles en este curso.</T><Button label="Volver" onPress={() => router.back()} /></Screen>;
  return (
    <ChallengeShell
      course={course}
      challenge={d.challenge}
      title={already ? 'Reto del día (repetido)' : 'Reto del día'}
      xp={already ? 10 : 30}
      doneLabel="Terminar"
      onDone={() => {
        const g = useGame.getState();
        if (!already) {
          g.setDaily(course.id, dayKey(Date.now()), true);
          g.bump(course.id, { dailySolved: 1 });
        }
        router.back();
      }}
    />
  );
}

/** Registra una ejecución del alumno (comando en Linux, ejecución de código en Python). */
function trackRun(course: CourseId, line: string, sandbox: boolean) {
  const g = useGame.getState();
  if (course === 'linux') g.trackCommands('linux', [line], sandbox);
  else g.bump(course, { commands: 1, ...(sandbox ? { sandboxCommands: 1 } : {}) });
}

const styles = makeStyles(() => ({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
}));

export { FadeIn, Animated, questionById, FAST_TYPES };
