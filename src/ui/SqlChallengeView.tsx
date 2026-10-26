import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, ZoomIn } from 'react-native-reanimated';
import type { SqlChallenge } from '@/content/types';
import { getDraft, useResume } from '@/game/resume';
import { success as hapticSuccess, warn as hapticWarn } from '@/lib/haptics';
import { sfx } from '@/lib/sfx';
import { newSqlSession, schemaOf, sqlJudge } from '@/lib/sqlrun';
import type { JudgeResult } from '@/sqlengine/judge';
import { Button } from './Button';
import type { SolvedInfo } from './ChallengeView';
import { Confetti } from './Confetti';
import { PyCode } from './PyCode';
import { PyEditor } from './PyEditor';
import { Inline, RichText } from './RichText';
import { SolutionCard } from './SolutionCard';
import { SqlResult } from './SqlResult';
import { SqlSchemaPanel } from './SqlSchemaPanel';
import { T } from './Text';
import { colors, darkColors, radius, makeStyles } from './theme';

interface Props {
  challenge: SqlChallenge;
  onSolved: (info: SolvedInfo) => void;
  /** Se invoca por cada ejecución (para estadísticas). */
  onRun?: (sql: string) => void;
  continueLabel?: string;
  /** Examen: sin pistas ni solución. */
  strict?: boolean;
}

const squash = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').replace(/;\s*$/, '').trim().toLowerCase();

/** Reto de SQL: el alumno escribe la consulta; al ejecutarla se corrige comparando lo que devuelve (o cómo queda la base de datos) con la solución. */
export function SqlChallengeView({ challenge, onSolved, onRun, continueLabel = 'Continuar', strict }: Props) {
  const draftKey = `sql:${challenge.id}`;
  const [sql, setSql] = useState(() => getDraft<string>(draftKey) ?? challenge.starter ?? '');
  const [nonce, setNonce] = useState(0);
  const firstRun = useRef(true);
  const [hints, setHints] = useState(0);
  const [solution, setSolution] = useState(false);
  const [solved, setSolved] = useState<null | SolvedInfo>(null);
  const [last, setLast] = useState<JudgeResult | null>(null);
  const [fails, setFails] = useState(0);
  const [open, setOpen] = useState(true);
  const [kbd, setKbd] = useState(false);
  const runs = useRef(0);

  // base de datos de la plantilla: da el esquema para autocompletar y para el explorador de tablas
  const base = useMemo(() => newSqlSession(challenge.setup), [challenge]);
  const schema = useMemo(() => schemaOf(base.db), [base]);

  useEffect(() => {
    if (firstRun.current) firstRun.current = false;
    else {
      setSql(challenge.starter ?? '');
      useResume.getState().clearDraft(draftKey);
    }
    setHints(0);
    setSolution(false);
    setSolved(null);
    setLast(null);
    setFails(0);
    runs.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se reinicia al cambiar de reto o al pulsar «Reiniciar»
  }, [challenge, nonce]);

  // borrador: se guarda al escribir (con una pausa) y al salir
  const latest = useRef({ sql, solved: false });
  latest.current = { sql, solved: !!solved };
  useEffect(() => {
    if (solved) return;
    const t = setTimeout(() => {
      if (sql && sql !== (challenge.starter ?? '')) useResume.getState().setDraft(draftKey, sql);
      else useResume.getState().clearDraft(draftKey);
    }, 500);
    return () => clearTimeout(t);
  }, [sql, solved, challenge.starter, draftKey]);
  useEffect(
    () => () => {
      const { sql: c, solved: done } = latest.current;
      if (!done && c && c !== (challenge.starter ?? '')) useResume.getState().setDraft(draftKey, c);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al desmontar
    [],
  );

  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbd(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbd(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const execute = useCallback(() => {
    if (solved || !sql.trim()) return;
    runs.current += 1;
    onRun?.(sql);
    const r = sqlJudge().judge(() => newSqlSession(challenge.setup), sql, challenge.solution, challenge.check);
    setLast(r);
    if (r.ok) {
      hapticSuccess();
      useResume.getState().clearDraft(draftKey);
      sfx('correct');
      setSolved({ commands: runs.current, hintsUsed: hints, usedSolution: solution, ctrlC: false });
    } else {
      hapticWarn();
      setFails((n) => n + 1);
    }
  }, [solved, sql, onRun, challenge, hints, solution, draftKey]);

  const hintsLeft = challenge.hints.length - hints;
  const compact = kbd;
  const tables = challenge.check.mode === 'state' || challenge.check.mode === 'both' ? challenge.check.tables ?? [] : [];
  const showExpected = !strict && !solved && fails >= 2 && !!last?.expected && !last.error;

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
              <SolutionCard text={challenge.solution} onUse={() => setSql(challenge.solution)}>
                <PyCode code={challenge.solution} lang="sql" selectable />
              </SolutionCard>
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

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: solved ? 300 : 24 }}>
        {!compact && <SqlSchemaPanel db={base.db} />}
        <PyEditor lang="sql" schema={schema} value={sql} onChange={setSql} minHeight={compact ? 120 : 170} placeholder="-- Escribe tu consulta aquí" readOnly={!!solved} />
        <Button label="▶  Ejecutar" kind="accent" disabled={!!solved || !sql.trim()} onPress={execute} />

        {last && (last.error || last.result) ? (
          <Animated.View entering={FadeIn} key={runs.current} style={{ backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 10, gap: 8, borderWidth: 1, borderColor: darkColors.line }}>
            <T v="tiny" color={darkColors.faint}>Resultado de tu consulta</T>
            <SqlResult result={last.result} error={last.error} script={sql} maxRows={30} />
          </Animated.View>
        ) : null}

        {last?.session && tables.length > 0 ? (
          <View style={{ gap: 8 }}>
            {tables.map((t) => {
              const table = last.session!.db.table(t);
              if (!table) return null;
              return (
                <View key={t} style={{ backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 10, gap: 6, borderWidth: 1, borderColor: darkColors.line }}>
                  <T v="tiny" color={darkColors.faint}>Así queda la tabla «{table.name}»</T>
                  <SqlResult result={{ command: 'SELECT', columns: table.cols.map((c) => ({ name: c.name, type: c.type.base })), rows: table.rows.slice(0, 12), affected: 0, message: '', stats: { rowsRead: 0, indexes: [] } }} showStats={false} maxRows={12} />
                </View>
              );
            })}
          </View>
        ) : null}

        {last && !last.ok && !last.error && !solved ? (
          <Animated.View entering={FadeIn} style={styles.msg}>
            <T v="small" color={colors.dim}>Casi… {last.why ?? ''}</T>
          </Animated.View>
        ) : null}

        {showExpected ? (
          <Animated.View entering={FadeIn} style={{ backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 10, gap: 6, borderWidth: 1, borderColor: darkColors.mint + '66' }}>
            <T v="tiny" color={darkColors.mint}>Así debería verse el resultado</T>
            <T selectable style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 12.5, lineHeight: 18 }} color={darkColors.termText}>{last!.expected}</T>
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
            <ScrollView style={{ maxHeight: 150 }}>
              <Inline text={challenge.explain} size={15} />
              {squash(sql) !== squash(challenge.solution) ? (
                <View style={{ marginTop: 8, gap: 4 }}>
                  <T v="tiny" color={colors.dim}>Solución de referencia</T>
                  <PyCode code={challenge.solution} lang="sql" />
                </View>
              ) : null}
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
