import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, ZoomIn } from 'react-native-reanimated';
import type { Challenge } from '@/content/types';
import { evaluate } from '@/engine/check';
import { Terminal } from '@/engine/terminal';
import { getDraft, useResume } from '@/game/resume';
import { openEditor } from '@/lib/editorBus';
import { success as hapticSuccess } from '@/lib/haptics';
import { Button } from './Button';
import { Confetti } from './Confetti';
import { CodeBlock, Inline, RichText } from './RichText';
import { echoToTranscript, TerminalView } from './TerminalView';
import { T } from './Text';
import { colors, radius, makeStyles } from './theme';

export interface SolvedInfo {
  commands: number;
  hintsUsed: number;
  usedSolution: boolean;
  ctrlC: boolean;
}

interface Props {
  challenge: Challenge;
  onSolved: (info: SolvedInfo) => void;
  /** Se invoca por cada comando ejecutado (para estadísticas). */
  onRun?: (line: string) => void;
  continueLabel?: string;
  /** Examen: sin pistas ni solución. */
  strict?: boolean;
}

/** Comandos que abren un programa interactivo: no se repiten al reanudar. */
const INTERACTIVE = /^\s*(sudo\s+)?(nano|vi|vim|emacs|less|more|man|top|htop|watch|ssh|read|python3?|bc)\b/;

export function ChallengeView({ challenge, onSolved, onRun, continueLabel = 'Continuar', strict }: Props) {
  const [nonce, setNonce] = useState(0);
  const draftKey = `sh:${challenge.id}`;
  // comandos que el alumno ya había ejecutado en este reto (si salió a la mitad): se repiten en silencio al volver
  const cmds = useRef<string[]>(getDraft<string[]>(draftKey) ?? []);
  const [replaying, setReplaying] = useState(false);
  const term = useMemo(() => {
    const t = new Terminal({ cols: 44, ...(challenge.setup ?? {}) });
    t.setEditor(openEditor);
    return t;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `nonce` reinicia el terminal a propósito
  }, [challenge, nonce]);
  const [hints, setHints] = useState(0);
  const [solution, setSolution] = useState(false);
  const [solved, setSolved] = useState<null | SolvedInfo>(null);
  const [kbd, setKbd] = useState(false);
  const [open, setOpen] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const ctrlC = useRef(false);
  const counted = useRef(0);

  useEffect(() => {
    setHints(0);
    setSolution(false);
    setSolved(null);
    ctrlC.current = false;
    counted.current = 0;
  }, [challenge, nonce]);

  useEffect(() => {
    const lines = nonce === 0 ? cmds.current.filter((l) => !INTERACTIVE.test(l)) : [];
    if (!lines.length) return;
    let alive = true;
    setReplaying(true);
    void (async () => {
      for (const line of lines) {
        if (!alive) return;
        echoToTranscript(term, term.prompt() + line);
        await Promise.race([term.run(line), new Promise((r) => setTimeout(r, 1500))]);
        if (term.busy) term.signal('INT');
      }
      if (alive) setReplaying(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar (o al cambiar de terminal)
  }, [term]);

  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbd(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbd(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const handleRun = useCallback(
    (line: string) => {
      onRun?.(line);
      if (solved) return;
      const r = evaluate(challenge.check, term);
      if (r.ok) {
        hapticSuccess();
        useResume.getState().clearDraft(draftKey);
        const info: SolvedInfo = { commands: term.runs.length, hintsUsed: hints, usedSolution: solution, ctrlC: ctrlC.current };
        setSolved(info);
      } else {
        cmds.current = [...cmds.current, line].slice(-40);
        useResume.getState().setDraft(draftKey, cmds.current);
        if (term.last && term.last.status !== 0 && !term.last.stderr) setMsg(null);
        else setMsg(r.why ?? null);
      }
    },
    [challenge, term, hints, solution, solved, onRun, draftKey],
  );

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
                <CodeBlock lines={challenge.solution.map((s) => (s.startsWith('^') ? `# pulsa Ctrl+${s.slice(1)}` : `$ ${s}`))} />
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
            <Pressable
              style={styles.pill}
              onPress={() => {
                cmds.current = [];
                useResume.getState().clearDraft(draftKey);
                setNonce((n) => n + 1);
              }}
            >
              <T v="tiny" bold color={colors.dim}>↺ Reiniciar</T>
            </Pressable>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <TerminalView
          term={term}
          onRun={handleRun}
          onSignal={(s) => {
            if (s === 'INT') ctrlC.current = true;
          }}
          disabled={!!solved || replaying}
          banner={['\x1b[2mEscribe comandos abajo. Usa las teclas especiales (Tab, ⌃C…) bajo el teclado.\x1b[0m']}
        />
        {msg && !solved && !compact ? (
          <Animated.View entering={FadeIn} style={styles.msg}>
            <T v="tiny" color={colors.dim}>Casi… {msg}</T>
          </Animated.View>
        ) : null}
      </View>
      {solved && (
        <>
          <Confetti count={36} />
          <Animated.View entering={SlideInDown.duration(280)} style={styles.done}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Animated.View entering={ZoomIn.delay(100)}><T style={{ fontSize: 30 }}>🏆</T></Animated.View>
              <View style={{ flex: 1 }}>
                <T v="h2" color={colors.green}>¡Reto superado!</T>
                <T v="tiny" color={colors.dim}>
                  {solved.commands} comando{solved.commands === 1 ? '' : 's'}
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
  msg: { position: 'absolute', top: 6, right: 10, backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  done: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 12, backgroundColor: colors.okBg, borderTopWidth: 3, borderTopColor: colors.green, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
}));
