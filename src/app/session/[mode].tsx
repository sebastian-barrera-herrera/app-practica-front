import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { WORLDS, worldById } from '@/content';
import { FAST_TYPES, questionById, type QItem } from '@/content/pool';
import type { Challenge, Question } from '@/content/types';
import { certExam, worldExam, type ExamPlan } from '@/game/exams';
import type { Achievement } from '@/game/achievements';
import { blitzPool, dailyChallenge, reviewSession, surpriseSession } from '@/game/sessions';
import { dayKey } from '@/game/streak';
import { useGame } from '@/game/store';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ChallengeView } from '@/ui/ChallengeView';
import { Chip } from '@/ui/Chip';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { QuestionView, type Result } from '@/ui/QuestionView';
import { Screen } from '@/ui/Screen';
import { SessionSummary, type Mistake } from '@/ui/SessionSummary';
import { T } from '@/ui/Text';
import { colors, fonts } from '@/ui/theme';

export default function SessionScreen() {
  const { mode, scope } = useLocalSearchParams<{ mode: string; scope?: string }>();
  if (mode === 'review') return <ReviewRun />;
  if (mode === 'surprise') return <SurpriseRun />;
  if (mode === 'blitz') return <BlitzRun initialScope={scope} />;
  if (mode === 'daily') return <DailyRun />;
  if (mode?.startsWith('boss-')) return <BossRun worldId={mode.slice(5)} />;
  if (mode?.startsWith('exam-')) {
    const w = worldById(mode.slice(5));
    if (w) return <ExamRun planOf={() => worldExam(w, String(Date.now()))} />;
  }
  if (mode?.startsWith('cert-')) return <ExamRun planOf={() => certExam(mode.slice(5) as never, String(Date.now()))} />;
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

function QuestionRun({ items, title, color, mode, onFinish, srsReview }: { items: QItem[]; title: string; color?: string; mode: 'lesson' | 'exam'; onFinish: (results: { item: QItem; correct: boolean }[]) => void; srsReview?: boolean }) {
  const [pos, setPos] = useState(0);
  const results = useRef<{ item: QItem; correct: boolean }[]>([]);
  const [confirm, setConfirm] = useState(false);
  const item = items[pos];
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
            useGame.getState().answer(item.id, r.correct, { review: srsReview });
            results.current.push({ item, correct: r.correct });
            if (pos + 1 >= items.length) onFinish(results.current);
            else setPos(pos + 1);
          }}
        />
      )}
      <ConfirmModal visible={confirm} title="¿Salir?" message="Se perderá el progreso de esta sesión." confirmLabel="Salir" cancelLabel="Seguir" danger onConfirm={() => router.back()} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}

function ReviewRun() {
  const plan = useMemo(() => reviewSession(useGame.getState(), Date.now(), 10), []);
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
      items={plan.items}
      title="Repaso"
      color={colors.cyan}
      mode="lesson"
      srsReview
      onFinish={(r) => {
        const correct = r.filter((x) => x.correct).length;
        const xp = Math.min(40, correct * 3 + 4);
        const g = useGame.getState();
        const a = g.awardXp(xp);
        const ach = g.checkAchievements();
        setRes({ xp, correct, total: r.length, levelUp: a.levelUp, ach, mistakes: r.filter((x) => !x.correct).map((x) => ({ q: x.item.q.q, correct: correctText(x.item.q), why: x.item.q.why })) });
      }}
    />
  );
}

// ───────────────────────── examen sorpresa ─────────────────────────

function SurpriseRun() {
  const plan = useMemo(() => surpriseSession(useGame.getState(), Date.now()), []);
  const [started, setStarted] = useState(false);
  const [res, setRes] = useState<null | { xp: number; correct: number; total: number; ach: Achievement[]; mistakes: Mistake[] }>(null);
  useEffect(() => {
    useGame.getState().markSurprise({ lastShown: Date.now() });
  }, []);
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
          <T v="title" center>¡Examen sorpresa! 🥷</T>
          <T color={colors.dim} center>{plan.length} preguntas rápidas de lo que ya aprendiste. Sin pistas. ¿Listo?</T>
          <Button label="Aceptar el reto" onPress={() => setStarted(true)} />
          <Button label="Ahora no" kind="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  return (
    <QuestionRun
      items={plan}
      title="Sorpresa"
      color={colors.rose}
      mode="exam"
      onFinish={(r) => {
        const correct = r.filter((x) => x.correct).length;
        const xp = 15 + correct * 6;
        const g = useGame.getState();
        g.awardXp(xp);
        const ach = g.bump({ surprises: 1 });
        setRes({ xp, correct, total: r.length, ach, mistakes: r.filter((x) => !x.correct).map((x) => ({ q: x.item.q.q, correct: correctText(x.item.q), why: x.item.q.why })) });
      }}
    />
  );
}

// ───────────────────────── prueba rápida ─────────────────────────

function BlitzRun({ initialScope }: { initialScope?: string }) {
  const [scope, setScope] = useState<string | null>(initialScope ?? null);
  const [phase, setPhase] = useState<'pick' | 'play' | 'end'>(initialScope ? 'play' : 'pick');
  const pool = useMemo(() => (scope ? blitzPool(useGame.getState(), scope) : []), [scope]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [end, setEnd] = useState<null | { xp: number; ach: Achievement[]; record: boolean }>(null);
  const best = useGame((s) => s.stats.blitzBest);
  const finish = useCallback(() => {
    setPhase('end');
  }, []);
  const left = useCountdown(60, phase === 'play', finish);

  useEffect(() => {
    if (phase === 'end' && !end) {
      const g = useGame.getState();
      const xp = Math.min(80, correct * 3 + (bestCombo >= 5 ? 10 : 0));
      const record = correct > g.stats.blitzBest;
      g.awardXp(xp);
      const ach = g.setStat('blitzBest', correct);
      setEnd({ xp, ach, record });
    }
  }, [phase, end, correct, bestCombo]);

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
            {WORLDS.map((w) => (
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
          useGame.getState().answer(item.id, r.correct);
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

function ExamRun({ planOf }: { planOf: () => ExamPlan }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- el plan se genera una sola vez por examen
  const plan = useMemo(planOf, []);
  const [phase, setPhase] = useState<'intro' | 'q' | 'c' | 'end'>('intro');
  const [pos, setPos] = useState(0);
  const [cpos, setCpos] = useState(0);
  const results = useRef<{ item: QItem; correct: boolean }[]>([]);
  const solved = useRef(0);
  const [confirm, setConfirm] = useState(false);
  const [end, setEnd] = useState<null | { score: number; passed: boolean; xp: number; ach: Achievement[]; levelUp: number | null }>(null);
  const finish = useCallback(() => {
    setPhase('end');
  }, []);
  const left = useCountdown(plan.seconds, phase === 'q' || phase === 'c', finish);
  const totalPts = plan.questions.length + plan.challenges.length * 3;

  useEffect(() => {
    if (phase !== 'end' || end) return;
    const got = results.current.filter((r) => r.correct).length + solved.current * 3;
    const score = totalPts ? got / totalPts : 0;
    const g = useGame.getState();
    const r = g.recordExam(plan.id, score, plan.passMark, plan.bonusXp);
    setEnd({ score, passed: r.passed, xp: r.passed ? plan.bonusXp : Math.round(plan.bonusXp * 0.15), ach: r.newAchievements, levelUp: r.levelUp });
  }, [phase, end, plan, totalPts]);

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
            ...(end.passed ? [] : [{ label: 'Repasar y reintentar', onPress: () => router.replace({ pathname: '/session/[mode]', params: { mode: plan.id.startsWith('cert') ? plan.id : plan.id.replace('exam-', 'exam-') } }) }]),
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
            useGame.getState().answer(item.id, r.correct);
            results.current.push({ item, correct: r.correct });
            if (pos + 1 >= plan.questions.length) {
              if (plan.challenges.length) setPhase('c');
              else finish();
            } else setPos(pos + 1);
          }}
        />
        <ConfirmModal visible={confirm} title="¿Abandonar el examen?" message="Contará como no presentado." confirmLabel="Abandonar" cancelLabel="Seguir" danger onConfirm={() => router.back()} onCancel={() => setConfirm(false)} />
      </Screen>
    );
  }
  const ch: Challenge = plan.challenges[cpos];
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <TopBar pos={plan.questions.length + cpos} total={plan.questions.length + plan.challenges.length} color={plan.color} right={timer} onClose={() => setConfirm(true)} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
        <Chip label={`Reto práctico ${cpos + 1}/${plan.challenges.length}`} color={colors.violet} />
      </View>
      <ChallengeView
        key={ch.id}
        challenge={ch}
        strict
        continueLabel={cpos + 1 >= plan.challenges.length ? 'Terminar examen' : 'Siguiente reto'}
        onRun={(line) => useGame.getState().trackCommands([line], false)}
        onSolved={() => {
          solved.current += 1;
          if (cpos + 1 >= plan.challenges.length) finish();
          else setCpos(cpos + 1);
        }}
      />
      <View style={{ padding: 10 }}>
        <Button small kind="ghost" label="Saltar este reto" onPress={() => (cpos + 1 >= plan.challenges.length ? finish() : setCpos(cpos + 1))} />
      </View>
      <ConfirmModal visible={confirm} title="¿Abandonar el examen?" message="Contará como no presentado." confirmLabel="Abandonar" cancelLabel="Seguir" danger onConfirm={() => router.back()} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}

// ───────────────────────── reto final / reto diario ─────────────────────────

function ChallengeShell({ challenge, title, xp, onDone, doneLabel }: { challenge: Challenge; title: string; xp: number; onDone: (info: { ach: Achievement[]; levelUp: number | null }) => void; doneLabel: string }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.top}>
        <Pressable onPress={() => setConfirm(true)} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>✕</T></Pressable>
        <T v="h3" style={{ flex: 1 }}>{title}</T>
        <Chip label={`+${xp} XP`} color={colors.amber} />
      </View>
      <ChallengeView
        challenge={challenge}
        continueLabel={doneLabel}
        onRun={(line) => useGame.getState().trackCommands([line], false)}
        onSolved={(info) => {
          const g = useGame.getState();
          g.solveChallenge(challenge.id, info.commands);
          if (info.ctrlC) g.bump({ ctrlC: 1 });
          const a = g.awardXp(Math.max(10, xp - info.hintsUsed * 3 - (info.usedSolution ? 10 : 0)));
          onDone({ ach: g.checkAchievements(), levelUp: a.levelUp });
        }}
      />
      <ConfirmModal visible={confirm} title="¿Salir del reto?" message="Podrás volver cuando quieras." confirmLabel="Salir" cancelLabel="Seguir" onConfirm={() => router.back()} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}

function BossRun({ worldId }: { worldId: string }) {
  const w = worldById(worldId);
  if (!w?.boss) return <Screen><T>Misión no encontrada</T></Screen>;
  return <ChallengeShell challenge={w.boss} title={`Misión: ${w.title}`} xp={60} doneLabel="Completar misión" onDone={() => router.back()} />;
}

function DailyRun() {
  const d = useMemo(() => dailyChallenge(useGame.getState(), Date.now()), []);
  const daily = useGame((s) => s.daily);
  const already = daily.day === dayKey(Date.now()) && daily.done;
  return (
    <ChallengeShell
      challenge={d.challenge}
      title={already ? 'Reto del día (repetido)' : 'Reto del día'}
      xp={already ? 10 : 30}
      doneLabel="Terminar"
      onDone={() => {
        const g = useGame.getState();
        if (!already) {
          g.setDaily(dayKey(Date.now()), true);
          g.bump({ dailySolved: 1 });
        }
        router.back();
      }}
    />
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
});

export { FadeIn, Animated, questionById, FAST_TYPES };
