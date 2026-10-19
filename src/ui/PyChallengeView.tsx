import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, ZoomIn } from 'react-native-reanimated';
import type { PyChallenge } from '@/content/types';
import { success as hapticSuccess } from '@/lib/haptics';
import { sfx } from '@/lib/sfx';
import { pyEngine } from '@/lib/pyrun';
import { Button } from './Button';
import type { SolvedInfo } from './ChallengeView';
import { Confetti } from './Confetti';
import { PyCode } from './PyCode';
import { PyEditor } from './PyEditor';
import { PyOutput } from './PyOutput';
import { Inline, RichText } from './RichText';
import { T } from './Text';
import { colors, radius, makeStyles } from './theme';
import { usePyRunner } from './usePyRunner';

interface Props {
  challenge: PyChallenge;
  onSolved: (info: SolvedInfo) => void;
  /** Se invoca por cada ejecución (para estadísticas). */
  onRun?: (code: string) => void;
  continueLabel?: string;
  /** Examen: sin pistas ni solución. */
  strict?: boolean;
}

/** Reto de código: el alumno escribe un programa; al ejecutarlo se comprueba con el intérprete real. */
export function PyChallengeView({ challenge, onSolved, onRun, continueLabel = 'Continuar', strict }: Props) {
  const [code, setCode] = useState(challenge.starter ?? '');
  const [nonce, setNonce] = useState(0);
  const runner = usePyRunner();
  const [hints, setHints] = useState(0);
  const [solution, setSolution] = useState(false);
  const [solved, setSolved] = useState<null | SolvedInfo>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [kbd, setKbd] = useState(false);
  const runs = useRef(0);

  useEffect(() => {
    setCode(challenge.starter ?? '');
    setHints(0);
    setSolution(false);
    setSolved(null);
    setMsg(null);
    runs.current = 0;
    runner.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se reinicia al cambiar de reto o al pulsar «Reiniciar»
  }, [challenge, nonce]);

  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbd(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbd(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const execute = useCallback(async () => {
    if (runner.running || solved || !code.trim()) return;
    runs.current += 1;
    onRun?.(code);
    setMsg(null);
    const { session, result } = await runner.run(code, { setup: challenge.setup });
    const r = pyEngine().evaluate(challenge.check, { session, code });
    if (r.ok) {
      hapticSuccess();
      sfx('correct');
      setSolved({ commands: runs.current, hintsUsed: hints, usedSolution: solution, ctrlC: false });
    } else if (result.timedOut) {
      setMsg('Tu programa tardó demasiado: ¿hay un bucle infinito?');
    } else if (!result.ok && result.error) {
      setMsg(`Hay un error (${result.error.type}). Léelo en la salida: dice en qué línea falló.`);
    } else setMsg(r.why ?? null);
  }, [runner, solved, code, onRun, challenge, hints, solution]);

  const hintsLeft = challenge.hints.length - hints;
  const compact = kbd;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T style={{ fontSize: 18 }}>🎯</T>
          <T v="h3" style={{ flex: 1 }} numberOfLines={compact || !open ? 1 : 3}>{challenge.goal}</T>
          <T color={colors.dim}>{open && !compact ? '▲' : '▼'}</T>
        </Pressable>
        {open && !compact && (
          <Animated.View entering={FadeIn} style={{ gap: 10, marginTop: 8 }}>
            <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <RichText body={challenge.prompt} size={15} />
            </ScrollView>
            {hints > 0 && (
              <View style={styles.hintBox}>
                {challenge.hints.slice(0, hints).map((h, i) => (
                  <Inline key={i} text={`💡 ${h}`} size={14} color={colors.amber} />
                ))}
              </View>
            )}
            {solution && (
              <View style={{ gap: 6 }}>
                <T v="label" color={colors.violet}>Solución</T>
                <PyCode code={challenge.solution} />
              </View>
            )}
          </Animated.View>
        )}
        {!strict && !solved && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable style={[styles.pill, hintsLeft <= 0 && { opacity: 0.4 }]} disabled={hintsLeft <= 0} onPress={() => { setHints((h) => h + 1); setOpen(true); }}>
              <T v="tiny" bold color={colors.amber}>💡 Pista {hints}/{challenge.hints.length}</T>
            </Pressable>
            <Pressable style={[styles.pill, (hintsLeft > 0 || solution) && { opacity: 0.4 }]} disabled={hintsLeft > 0 || solution} onPress={() => { setSolution(true); setOpen(true); }}>
              <T v="tiny" bold color={colors.violet}>👁 Ver solución</T>
            </Pressable>
            <Pressable style={styles.pill} onPress={() => setNonce((n) => n + 1)}>
              <T v="tiny" bold color={colors.dim}>↺ Reiniciar</T>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: solved ? 280 : 24 }}>
        <PyEditor value={code} onChange={setCode} minHeight={compact ? 120 : 180} placeholder="# Escribe tu código aquí" readOnly={!!solved} />
        {challenge.setup?.stdin && challenge.setup.stdin.length > 0 ? (
          <T v="tiny" color={colors.dim}>⌨ Entrada de prueba para input(): {challenge.setup.stdin.map((l) => `«${l}»`).join(' · ')}</T>
        ) : null}
        <Button label={runner.running ? 'Ejecutando…' : '▶  Ejecutar'} kind="accent" disabled={runner.running || !!solved || !code.trim()} onPress={execute} />
        <PyOutput chunks={runner.chunks} running={runner.running} asking={!!runner.request} onSubmitInput={runner.submitInput} onStop={runner.stop} maxHeight={compact ? 110 : 220} />
        {msg && !solved ? (
          <Animated.View entering={FadeIn} style={styles.msg}>
            <T v="small" color={colors.dim}>Casi… {msg}</T>
          </Animated.View>
        ) : null}
      </ScrollView>

      {solved && (
        <>
          <Confetti count={36} />
          <Animated.View entering={SlideInDown.duration(280)} style={styles.done}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Animated.View entering={ZoomIn.delay(100)}><T style={{ fontSize: 30 }}>🏆</T></Animated.View>
              <View style={{ flex: 1 }}>
                <T v="h2" color={colors.green}>¡Reto superado!</T>
                <T v="tiny" color={colors.dim}>
                  {solved.commands} ejecución{solved.commands === 1 ? '' : 'es'}
                  {challenge.par && solved.commands <= challenge.par ? ' · ⚡ eficiente' : ''}
                  {solved.hintsUsed ? ` · ${solved.hintsUsed} pista${solved.hintsUsed > 1 ? 's' : ''}` : ''}
                </T>
              </View>
            </View>
            <ScrollView style={{ maxHeight: 120 }}>
              <Inline text={challenge.explain} size={15} />
            </ScrollView>
            <Button label={continueLabel} onPress={() => onSolved(solved)} />
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = makeStyles(() => ({
  head: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line },
  hintBox: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.amber + '14', borderWidth: 1, borderColor: colors.amber + '55' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line },
  msg: { padding: 10, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  done: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 12, backgroundColor: colors.okBg, borderTopWidth: 3, borderTopColor: colors.green, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
}));
