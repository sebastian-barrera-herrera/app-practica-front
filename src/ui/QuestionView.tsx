import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInDown, ZoomIn } from 'react-native-reanimated';
import { evaluate } from '@/engine/check';
import { Terminal } from '@/engine/terminal';
import type { Question } from '@/content/types';
import { cmdMatches, seededShuffle } from '@/lib/cmdnorm';
import { error as hapticError, select, success as hapticSuccess } from '@/lib/haptics';
import { Button } from './Button';
import { Chip } from './Chip';
import { CodeBlock, Inline } from './RichText';
import { T } from './Text';
import { colors, fonts, radius, makeStyles } from './theme';

export interface Result {
  correct: boolean;
  /** Respuesta del alumno en texto (para repasos). */
  given?: string;
}

interface Props {
  q: Question;
  seed: string;
  /** 'lesson': explica siempre. 'blitz': pasa solo, 'exam': feedback mínimo. */
  mode?: 'lesson' | 'exam' | 'blitz';
  onDone: (r: Result) => void;
  /** Texto del botón final. */
  continueLabel?: string;
}

export function QuestionView({ q, seed, mode = 'lesson', onDone, continueLabel = 'Continuar' }: Props) {
  const [checked, setChecked] = useState<null | Result>(null);
  const [ready, setReady] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [showHint, setShowHint] = useState(false);
  const getAnswerRef = useRef<() => Promise<Result> | Result>(() => ({ correct: false }));

  useEffect(() => {
    setChecked(null);
    setReady(false);
    setShowHint(false);
    setAnswerText('');
  }, [seed]);

  const check = async () => {
    const r = await getAnswerRef.current();
    setChecked(r);
    if (r.correct) hapticSuccess();
    else hapticError();
    if (mode === 'blitz') setTimeout(() => onDone(r), r.correct ? 350 : 900);
  };

  const prompt = (
    <View style={{ gap: 12 }}>
      <Inline text={q.q} size={18} />
      {q.t === 'mc' && q.code ? <CodeBlock lines={q.code.split('\n')} /> : null}
    </View>
  );

  const body = (() => {
    switch (q.t) {
      case 'mc': return <MC q={q} seed={seed} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'multi': return <Multi q={q} seed={seed} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'tf': return <TF q={q} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'cmd': return <Cmd q={q} locked={!!checked} setReady={setReady} getRef={getAnswerRef} showHint={showHint} text={answerText} setText={setAnswerText} onSubmit={() => ready && check()} />;
      case 'order': return <Order q={q} seed={seed} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'match': return <Match q={q} seed={seed} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'fill': return <Fill q={q} seed={seed} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'output': return <Output q={q} seed={seed} locked={!!checked} setReady={setReady} getRef={getAnswerRef} />;
      case 'pycode':
      case 'pyout':
        return null;
    }
  })();

  const correctText = checked && !checked.correct ? describeCorrect(q) : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(260)} key={seed} style={{ gap: 18 }}>
          {prompt}
          {body}
          {q.t === 'cmd' && q.hint && !checked ? (
            <Pressable onPress={() => setShowHint(true)}>
              {showHint ? <T v="small" color={colors.amber}>💡 {q.hint}</T> : <T v="small" color={colors.dim}>¿Necesitas una pista? Toca aquí</T>}
            </Pressable>
          ) : null}
        </Animated.View>
      </ScrollView>
      {mode === 'blitz' ? (
        <View style={{ padding: 16 }}>
          {!checked ? <Button label="Comprobar" disabled={!ready} onPress={check} /> : <T center bold color={checked.correct ? colors.green : colors.rose}>{checked.correct ? '¡Correcto!' : 'Incorrecto'}</T>}
        </View>
      ) : !checked ? (
        <View style={{ padding: 16 }}>
          <Button label="Comprobar" disabled={!ready} onPress={check} />
        </View>
      ) : (
        <Animated.View entering={SlideInDown.duration(260)} style={[styles.feedback, { backgroundColor: checked.correct ? colors.okBg : colors.badBg, borderTopColor: checked.correct ? colors.green : colors.rose }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Animated.View entering={ZoomIn.delay(80)}>
              <T style={{ fontSize: 28 }}>{checked.correct ? '✅' : '❌'}</T>
            </Animated.View>
            <T v="h2" color={checked.correct ? colors.green : colors.rose}>{checked.correct ? '¡Correcto!' : mode === 'exam' ? 'Respuesta registrada' : 'No exactamente'}</T>
          </View>
          {mode !== 'exam' && (
            <Animated.View entering={FadeIn.delay(120)} style={{ gap: 6 }}>
              {correctText ? (
                <T v="small" color={colors.text}>
                  Respuesta correcta: <T v="small" bold color={colors.white} style={{ fontFamily: q.t === 'cmd' || q.t === 'order' ? fonts.monoBold : fonts.bold }}>{correctText}</T>
                </T>
              ) : null}
              <Inline text={q.why} size={15} color={colors.text} />
            </Animated.View>
          )}
          <Button label={continueLabel} onPress={() => onDone(checked)} kind={checked.correct ? 'primary' : 'danger'} />
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

function describeCorrect(q: Question): string | null {
  switch (q.t) {
    case 'mc': return q.options[q.answer];
    case 'multi': return q.answers.map((a) => q.options[a]).join(' · ');
    case 'tf': return q.answer ? 'Verdadero' : 'Falso';
    case 'cmd': return q.answers[0];
    case 'order': return q.answer;
    case 'fill': return q.answers.join(' · ');
    case 'match': return null;
    case 'output': return null;
    case 'pycode': return q.solution;
    case 'pyout': return null;
  }
}

interface SubProps {
  locked: boolean;
  setReady: (b: boolean) => void;
  getRef: React.MutableRefObject<() => Promise<Result> | Result>;
}

// ───────────────────────── opción múltiple ─────────────────────────

function OptionButton({ label, state, onPress, mono }: { label: string; state: 'idle' | 'selected' | 'right' | 'wrong' | 'dim'; onPress: () => void; mono?: boolean }) {
  const bg = { idle: colors.card, selected: colors.cyan + '22', right: colors.green + '22', wrong: colors.rose + '22', dim: colors.card }[state];
  const border = { idle: colors.line, selected: colors.cyan, right: colors.green, wrong: colors.rose, dim: colors.line }[state];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, { backgroundColor: bg, borderColor: border, opacity: state === 'dim' ? 0.55 : pressed ? 0.8 : 1 }]}>
      <T style={mono ? { fontFamily: fonts.mono, fontSize: 14 } : undefined} v={mono ? 'mono' : 'body'} color={colors.text}>{label}</T>
    </Pressable>
  );
}

function MC({ q, seed, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'mc' }>; seed: string }) {
  const order = useMemo(() => seededShuffle(q.options.map((_, i) => i), seed), [q, seed]);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setReady(sel !== null), [sel, setReady]);
  getRef.current = () => ({ correct: sel === q.answer, given: sel !== null ? q.options[sel] : '' });
  const mono = q.options.some((o) => /^[`$/.~\w-]+( |$)/.test(o) && o.length < 28 && /[-/.~]/.test(o)) && q.options.every((o) => o.length < 32);
  return (
    <View style={{ gap: 10 }}>
      {order.map((i) => {
        let st: 'idle' | 'selected' | 'right' | 'wrong' | 'dim' = sel === i ? 'selected' : 'idle';
        if (locked) st = i === q.answer ? 'right' : sel === i ? 'wrong' : 'dim';
        return <OptionButton key={i} label={q.options[i].replace(/`/g, '')} mono={mono} state={st} onPress={() => { if (!locked) { select(); setSel(i); } }} />;
      })}
    </View>
  );
}

function Multi({ q, seed, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'multi' }>; seed: string }) {
  const order = useMemo(() => seededShuffle(q.options.map((_, i) => i), seed), [q, seed]);
  const [sel, setSel] = useState<number[]>([]);
  useEffect(() => setReady(sel.length > 0), [sel, setReady]);
  getRef.current = () => ({ correct: sel.length === q.answers.length && sel.every((s) => q.answers.includes(s)), given: sel.map((s) => q.options[s]).join(', ') });
  return (
    <View style={{ gap: 10 }}>
      <T v="tiny" color={colors.dim}>Selecciona todas las correctas</T>
      {order.map((i) => {
        let st: 'idle' | 'selected' | 'right' | 'wrong' | 'dim' = sel.includes(i) ? 'selected' : 'idle';
        if (locked) st = q.answers.includes(i) ? 'right' : sel.includes(i) ? 'wrong' : 'dim';
        return <OptionButton key={i} label={q.options[i].replace(/`/g, '')} state={st} onPress={() => { if (!locked) { select(); setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i])); } }} />;
      })}
    </View>
  );
}

function TF({ q, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'tf' }> }) {
  const [sel, setSel] = useState<boolean | null>(null);
  useEffect(() => setReady(sel !== null), [sel, setReady]);
  getRef.current = () => ({ correct: sel === q.answer, given: sel === null ? '' : sel ? 'Verdadero' : 'Falso' });
  const mk = (v: boolean) => {
    let st: 'idle' | 'selected' | 'right' | 'wrong' | 'dim' = sel === v ? 'selected' : 'idle';
    if (locked) st = v === q.answer ? 'right' : sel === v ? 'wrong' : 'dim';
    return <OptionButton label={v ? '✔  Verdadero' : '✘  Falso'} state={st} onPress={() => { if (!locked) { select(); setSel(v); } }} />;
  };
  return <View style={{ gap: 10 }}>{mk(true)}{mk(false)}</View>;
}

// ───────────────────────── escribir comando ─────────────────────────

function Cmd({ q, locked, setReady, getRef, text, setText, onSubmit }: SubProps & { q: Extract<Question, { t: 'cmd' }>; showHint: boolean; text: string; setText: (s: string) => void; onSubmit: () => void }) {
  useEffect(() => setReady(text.trim().length > 0), [text, setReady]);
  getRef.current = async () => {
    if (q.check) {
      const t = new Terminal({ instant: true, ...(q.setup ?? {}) });
      await t.exec(text);
      return { correct: evaluate(q.check, t).ok, given: text };
    }
    return { correct: cmdMatches(text, q.answers, q.regex), given: text };
  };
  return (
    <View style={styles.cmdBox}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 16 }} color={colors.mint}>$</T>
      <TextInput
        value={text}
        onChangeText={setText}
        editable={!locked}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        keyboardAppearance="dark"
        selectionColor={colors.mint}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        placeholder="escribe el comando…"
        placeholderTextColor={colors.faint}
        style={styles.cmdInput}
      />
    </View>
  );
}

// ───────────────────────── ordenar ─────────────────────────

function Order({ q, seed, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'order' }>; seed: string }) {
  const pool = useMemo(() => seededShuffle(q.pieces.map((p, i) => ({ p, i })), seed), [q, seed]);
  const [chosen, setChosen] = useState<number[]>([]);
  useEffect(() => setReady(chosen.length === q.pieces.length), [chosen, q, setReady]);
  const built = chosen.map((i) => q.pieces[i]).join(' ');
  getRef.current = () => ({ correct: [q.answer, ...(q.alt ?? [])].includes(built), given: built });
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.slotRow}>
        {chosen.length === 0 && <T v="small" color={colors.faint}>Toca las piezas para construir el comando</T>}
        {chosen.map((i) => (
          <Pressable key={i} onPress={() => !locked && setChosen((c) => c.filter((x) => x !== i))}>
            <View style={[styles.piece, { backgroundColor: colors.cyan + '22', borderColor: colors.cyan }]}>
              <T style={{ fontFamily: fonts.mono, fontSize: 15 }}>{q.pieces[i]}</T>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={styles.pool}>
        {pool.map(({ p, i }) => (
          <Pressable key={i} disabled={chosen.includes(i) || locked} onPress={() => { select(); setChosen((c) => [...c, i]); }}>
            <View style={[styles.piece, chosen.includes(i) && { opacity: 0.2 }]}>
              <T style={{ fontFamily: fonts.mono, fontSize: 15 }}>{p}</T>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ───────────────────────── rellenar huecos ─────────────────────────

function Fill({ q, seed, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'fill' }>; seed: string }) {
  const parts = q.template.split('___');
  const [vals, setVals] = useState<(string | null)[]>(() => q.answers.map(() => null));
  const options = useMemo(() => seededShuffle(q.options, seed), [q, seed]);
  useEffect(() => setReady(vals.every((v) => v !== null)), [vals, setReady]);
  getRef.current = () => ({ correct: vals.every((v, i) => v === q.answers[i]), given: vals.join(' ') });
  const put = (o: string) => {
    const i = vals.findIndex((v) => v === null);
    if (i >= 0) {
      select();
      setVals((v) => v.map((x, k) => (k === i ? o : x)));
    }
  };
  return (
    <View style={{ gap: 18 }}>
      <View style={styles.codeLine}>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <T style={{ fontFamily: fonts.mono, fontSize: 17 }} color={colors.termText}>{p}</T>
            {i < parts.length - 1 && (
              <Pressable onPress={() => !locked && setVals((v) => v.map((x, k) => (k === i ? null : x)))}>
                <View style={[styles.blank, vals[i] !== null && { borderColor: colors.cyan, backgroundColor: colors.cyan + '22' }, locked && { borderColor: vals[i] === q.answers[i] ? colors.green : colors.rose }]}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: 16 }} color={colors.white}>{vals[i] ?? ' '}</T>
                </View>
              </Pressable>
            )}
          </React.Fragment>
        ))}
      </View>
      <View style={styles.pool}>
        {options.map((o) => {
          const used = vals.includes(o) && q.options.filter((x) => x === o).length === 1;
          return (
            <Pressable key={o} disabled={used || locked} onPress={() => put(o)}>
              <View style={[styles.piece, used && { opacity: 0.2 }]}>
                <T style={{ fontFamily: fonts.mono, fontSize: 15 }}>{o}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ───────────────────────── unir pares ─────────────────────────

function Match({ q, seed, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'match' }>; seed: string }) {
  const left = useMemo(() => seededShuffle(q.pairs.map((p, i) => ({ t: p[0], i })), seed + 'L'), [q, seed]);
  const right = useMemo(() => seededShuffle(q.pairs.map((p, i) => ({ t: p[1], i })), seed + 'R'), [q, seed]);
  const [selL, setSelL] = useState<number | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [wrong, setWrong] = useState<{ l: number; r: number } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  useEffect(() => setReady(done.length === q.pairs.length), [done, q, setReady]);
  getRef.current = () => ({ correct: mistakes === 0, given: `${mistakes} fallos` });
  const pickRight = (ri: number) => {
    if (selL === null || locked) return;
    if (selL === ri) {
      select();
      setDone((d) => [...d, ri]);
      setSelL(null);
    } else {
      hapticError();
      setMistakes((m) => m + 1);
      setWrong({ l: selL, r: ri });
      setSelL(null);
      setTimeout(() => setWrong(null), 600);
    }
  };
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1, gap: 8 }}>
        {left.map((l) => {
          const ok = done.includes(l.i);
          return (
            <Pressable key={l.i} disabled={ok} onPress={() => { select(); setSelL(l.i); }}>
              <View style={[styles.matchCell, selL === l.i && { borderColor: colors.cyan, backgroundColor: colors.cyan + '22' }, ok && { borderColor: colors.green, opacity: 0.5 }, wrong?.l === l.i && { borderColor: colors.rose }]}>
                <T v="small" style={{ fontFamily: fonts.mono }}>{l.t}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1.3, gap: 8 }}>
        {right.map((r) => {
          const ok = done.includes(r.i);
          return (
            <Pressable key={r.i} disabled={ok} onPress={() => pickRight(r.i)}>
              <View style={[styles.matchCell, ok && { borderColor: colors.green, opacity: 0.5 }, wrong?.r === r.i && { borderColor: colors.rose }]}>
                <T v="small">{r.t}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ───────────────────────── predecir salida ─────────────────────────

function Output({ q, seed, locked, setReady, getRef }: SubProps & { q: Extract<Question, { t: 'output' }>; seed: string }) {
  const [correct, setCorrect] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const t = new Terminal({ instant: true, ...(q.setup ?? {}) });
      const r = await t.exec(q.cmd);
      if (alive) setCorrect(r.text.trimEnd());
    })();
    return () => {
      alive = false;
    };
  }, [q]);
  const options = useMemo(() => (correct === null ? [] : seededShuffle([correct, ...q.wrong.map((w) => w.trimEnd())], seed)), [correct, q, seed]);
  useEffect(() => setReady(sel !== null), [sel, setReady]);
  getRef.current = () => ({ correct: sel !== null && options[sel] === correct, given: sel !== null ? options[sel] : '' });
  return (
    <View style={{ gap: 12 }}>
      <CodeBlock lines={[`$ ${q.cmd}`]} />
      <View style={{ gap: 10 }}>
        {options.map((o, i) => {
          let st: 'idle' | 'selected' | 'right' | 'wrong' | 'dim' = sel === i ? 'selected' : 'idle';
          if (locked) st = o === correct ? 'right' : sel === i ? 'wrong' : 'dim';
          return <OptionButton key={i} mono label={o || '(sin salida)'} state={st} onPress={() => { if (!locked) { select(); setSel(i); } }} />;
        })}
      </View>
    </View>
  );
}

const styles = makeStyles(() => ({
  option: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 2 },
  feedback: { padding: 16, gap: 12, borderTopWidth: 3 },
  cmdBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 4 },
  cmdInput: { flex: 1, fontFamily: fonts.mono, fontSize: 16, color: colors.white, paddingVertical: 12 },
  slotRow: { minHeight: 64, flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.termBg, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  pool: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  piece: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.card2, borderWidth: 1.5, borderColor: colors.line },
  codeLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: 14, borderRadius: radius.md, backgroundColor: colors.termBg, borderWidth: 1, borderColor: colors.line, gap: 2 },
  blank: { minWidth: 56, minHeight: 34, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.faint, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  matchCell: { minHeight: 54, paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, justifyContent: 'center' },
}));

export { Chip };
