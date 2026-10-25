import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { DATASET_LIST, DATASETS } from '@/content/sql/datasets';
import { SQL_SAMPLES } from '@/content/sql/samples';
import { useCourse, useGame } from '@/game/store';
import { newSqlSession, schemaOf } from '@/lib/sqlrun';
import { useStudyContext } from '@/lib/studyClock';
import type { SqlSession } from '@/sqlengine/session';
import type { ResultSet, SqlError } from '@/sqlengine/types';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { ConfirmModal } from './ConfirmModal';
import { CourseHeader, CourseSwitcher } from './CourseSwitcher';
import { PyEditor } from './PyEditor';
import { Screen } from './Screen';
import { SqlResult } from './SqlResult';
import { SqlSchemaPanel } from './SqlSchemaPanel';
import { T } from './Text';
import { colors, darkColors, radius } from './theme';

interface Saved {
  db?: string;
  code?: string;
  /** Sentencias que cambiaron la base de datos desde que se cargó: al volver a abrir se repiten para dejarla igual. */
  log?: string[];
  history?: string[];
}

const READ_ONLY = new Set(['SELECT', 'EXPLAIN', 'META', 'SET']);
const DEFAULT_CODE = '-- Escribe una consulta y pulsa Ejecutar\nSELECT * FROM productos LIMIT 5;\n';

/** Laboratorio de SQL: una base de datos de ejemplo a elegir, un editor con autocompletado y los resultados en tablas. Todo corre en el móvil. */
export function SqlLab() {
  const { course } = useCourse('sql');
  useStudyContext('sql');
  const saved = (useGame.getState().courses.sql.sandbox ?? {}) as Saved;
  const [dbId, setDbId] = useState(saved.db && DATASETS[saved.db] ? saved.db : 'tienda');
  const [code, setCode] = useState(saved.code ?? DEFAULT_CODE);
  const log = useRef<string[]>(saved.log ?? []);
  const history = useRef<string[]>(saved.history ?? []);
  const session = useRef<SqlSession | null>(null);
  const [version, setVersion] = useState(0);
  const [out, setOut] = useState<null | { results: ResultSet[]; error?: SqlError; sql: string; offset: number }>(null);
  const [samples, setSamples] = useState(false);
  const [confirm, setConfirm] = useState<null | 'reset' | { db: string }>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const build = useCallback((id: string, replay: string[]): SqlSession => {
    const s = newSqlSession({ db: id });
    for (const sql of replay) {
      const r = s.exec(sql);
      if (r.error) break;
    }
    if (s.inTransaction) s.exec('ROLLBACK');
    return s;
  }, []);

  const sess = (): SqlSession => (session.current ??= build(dbId, log.current));
  // la base de datos se prepara al abrir, no al primer clic
  useEffect(() => {
    sess();
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, []);

  const persist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      useGame.getState().setSandbox('sql', { db: dbIdRef.current, code: codeRef.current, log: log.current.slice(-80), history: history.current.slice(-40) } satisfies Saved);
    }, 1200);
  }, []);
  const dbIdRef = useRef(dbId);
  const codeRef = useRef(code);
  dbIdRef.current = dbId;
  codeRef.current = code;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    useGame.getState().setSandbox('sql', { db: dbIdRef.current, code: codeRef.current, log: log.current.slice(-80), history: history.current.slice(-40) } satisfies Saved);
  }, []);

  const run = () => {
    if (!code.trim()) return;
    const s = sess();
    const r = s.exec(code);
    setOut({ results: r.results, error: r.error?.error, sql: r.error?.sql ?? code, offset: r.error?.offset ?? 0 });
    if (r.results.some((x) => !READ_ONLY.has(x.command))) log.current = [...log.current, code].slice(-80);
    history.current = [code, ...history.current.filter((h) => h !== code)].slice(0, 40);
    useGame.getState().bump('sql', { commands: 1, sandboxCommands: 1 });
    setVersion((v) => v + 1);
    persist();
  };

  const resetDb = (id: string) => {
    log.current = [];
    session.current = null;
    setDbId(id);
    dbIdRef.current = id;
    session.current = build(id, []);
    setOut(null);
    setVersion((v) => v + 1);
    persist();
  };

  const schema = useMemo(() => schemaOf(sess().db), [version, dbId]); // eslint-disable-line react-hooks/exhaustive-deps -- cambia con la base de datos

  const changeDb = (id: string) => {
    if (id === dbId) return;
    if (log.current.length) setConfirm({ db: id });
    else resetDb(id);
  };

  const ds = DATASETS[dbId];
  const mine = SQL_SAMPLES.filter((x) => x.db === dbId);
  const others = SQL_SAMPLES.filter((x) => x.db !== dbId);

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 12 }}>
        <CourseSwitcher />
        <CourseHeader course={course} title="Laboratorio de SQL" subtitle="Elige una base de datos y consúltala: puedes romperla, que se reinicia." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
          {DATASET_LIST.map((d) => (
            <Chip key={d.id} label={`${d.emoji} ${d.title}`} active={d.id === dbId} color={colors.cyan} onPress={() => changeDb(d.id)} />
          ))}
        </ScrollView>
        {ds ? <T v="small" color={colors.dim}>{ds.blurb}</T> : null}
        <SqlSchemaPanel db={sess().db} refresh={version} defaultOpen onPick={(name) => setCode((c) => (c.trim() ? `${c.replace(/\s+$/, '')} ${name}` : `SELECT * FROM ${name};\n`))} />
        <PyEditor lang="sql" schema={schema} value={code} onChange={(c) => { setCode(c); persist(); }} minHeight={200} placeholder="-- Escribe tu consulta aquí" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button icon="▶" label="Ejecutar" kind="accent" style={{ paddingHorizontal: 14 }} disabled={!code.trim()} onPress={run} />
          </View>
          <Button small full={false} style={{ alignSelf: 'center' }} label="Ejemplos" kind="secondary" onPress={() => setSamples(true)} />
          <Button small full={false} style={{ alignSelf: 'center' }} label="Vaciar" kind="ghost" onPress={() => { setCode(''); persist(); }} />
        </View>
        {out ? (
          <Animated.View entering={FadeIn} key={version} style={{ gap: 8, backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: darkColors.line }}>
            {out.results.slice(-4).map((r, i) => (
              <SqlResult key={i} result={r} />
            ))}
            {out.results.length > 4 ? <T v="tiny" color={darkColors.faint}>(se muestran los 4 últimos resultados)</T> : null}
            {out.error ? <SqlResult error={out.error} script={out.sql} /> : null}
            {out.results.length === 0 && !out.error ? <T v="small" color={darkColors.faint}>Sin resultados.</T> : null}
          </Animated.View>
        ) : null}
        <Pressable onPress={() => setConfirm('reset')} style={{ alignSelf: 'center', paddingVertical: 8 }}>
          <T v="small" color={colors.dim}>♻️ Dejar la base de datos como al principio</T>
        </Pressable>
      </ScrollView>

      <Modal visible={samples} transparent animationType="fade" onRequestClose={() => setSamples(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(3,6,16,0.75)', justifyContent: 'center', padding: 20 }} onPress={() => setSamples(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line, maxHeight: '88%' }}>
            <T v="h2">Ejemplos y recientes</T>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {history.current.length > 0 && (
                <>
                  <T v="label" color={colors.dim}>Tus últimas consultas</T>
                  {history.current.slice(0, 5).map((h, i) => (
                    <Card key={i} pad={10} onPress={() => { setCode(h); persist(); setSamples(false); }}>
                      <T numberOfLines={2} style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 12 }} color={colors.text}>{h.trim()}</T>
                    </Card>
                  ))}
                </>
              )}
              <T v="label" color={colors.dim}>Ejemplos para «{ds?.title ?? dbId}»</T>
              {mine.map((s) => (
                <SampleCard key={s.id} s={s} onPress={() => { setCode(s.sql); persist(); setSamples(false); }} />
              ))}
              {mine.length === 0 && <T v="small" color={colors.faint}>No hay ejemplos para esta base de datos.</T>}
              {others.length > 0 && <T v="label" color={colors.dim}>De otras bases de datos (cámbiate a ella para ejecutarlos)</T>}
              {others.map((s) => (
                <SampleCard key={s.id} s={s} onPress={() => { changeDb(s.db); setCode(s.sql); setSamples(false); }} />
              ))}
            </ScrollView>
            <Button label="Cerrar" kind="ghost" onPress={() => setSamples(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmModal
        visible={confirm !== null}
        title={confirm === 'reset' ? '¿Dejar la base de datos como al principio?' : '¿Cambiar de base de datos?'}
        message={confirm === 'reset' ? 'Se deshacen los cambios que hiciste (INSERT, UPDATE, CREATE…). Tu progreso no cambia.' : 'Los cambios que hiciste en esta base de datos se perderán. Tu progreso no cambia.'}
        confirmLabel={confirm === 'reset' ? 'Reiniciar' : 'Cambiar'}
        danger
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c === 'reset') resetDb(dbId);
          else if (c) resetDb(c.db);
        }}
        onCancel={() => setConfirm(null)}
      />
    </Screen>
  );
}

function SampleCard({ s, onPress }: { s: (typeof SQL_SAMPLES)[number]; onPress: () => void }) {
  return (
    <Card pad={12} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <T style={{ fontSize: 24 }}>{s.emoji}</T>
        <View style={{ flex: 1 }}>
          <T v="h3">{s.title}</T>
          <T v="tiny" color={colors.dim}>{s.blurb}</T>
        </View>
      </View>
    </Card>
  );
}
