import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { SqlCell } from '@/content/types';
import { newSqlSession } from '@/lib/sqlrun';
import type { SqlSetup } from '@/sqlengine/judge';
import type { SqlSession } from '@/sqlengine/session';
import type { ResultSet, SqlError } from '@/sqlengine/types';
import { Button } from './Button';
import { PyCode } from './PyCode';
import { Inline } from './RichText';
import { SqlResult } from './SqlResult';
import { SqlSchemaPanel } from './SqlSchemaPanel';
import { T } from './Text';
import { colors, darkColors, radius } from './theme';

interface Done {
  cell: SqlCell;
  results: ResultSet[];
  error?: SqlError;
  /** Texto de la sentencia que falló (para señalar la posición del error). */
  failedSql?: string;
  offset: number;
}

/** Sentencias de SQL que se ejecutan una a una sobre una base de datos de ejemplo; cada una enseña su resultado real. */
export function SqlDemoView({ cells, setup, intro, stats, onComplete }: { cells: SqlCell[]; setup: SqlSetup; intro?: string; stats?: boolean; onComplete?: () => void }) {
  const [done, setDone] = useState<Done[]>([]);
  const [running, setRunning] = useState(false);
  // la base de datos de la demo: las sentencias se van acumulando sobre ella
  const sess = useMemo<SqlSession>(() => newSqlSession(setup), [cells, setup]); // eslint-disable-line react-hooks/exhaustive-deps -- cambia con las celdas
  const idxRef = useRef(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const ys = useRef<number[]>([]);
  const finished = done.length >= cells.length;

  useEffect(() => {
    idxRef.current = 0;
    ys.current = [];
    setDone([]);
  }, [sess]);

  useEffect(() => {
    if (finished) onComplete?.();
  }, [finished, onComplete]);

  const runNext = useCallback(() => {
    const at = idxRef.current;
    if (at >= cells.length) return;
    setRunning(true);
    const cell = cells[at];
    const out = sess.exec(cell.sql);
    idxRef.current = at + 1;
    setDone((d) => [...d, { cell, results: out.results, error: out.error?.error, failedSql: out.error?.sql, offset: out.error?.offset ?? 0 }]);
    setRunning(false);
    // se muestra el principio del resultado nuevo (si es muy alto, no se pierden las cabeceras de la tabla)
    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, (ys.current[at] ?? 0) - 6), animated: true }), 120);
  }, [cells, sess]);

  const runAll = useCallback(async () => {
    while (idxRef.current < cells.length) {
      runNext();
      await new Promise((r) => setTimeout(r, 300));
    }
  }, [cells.length, runNext]);

  return (
    <View style={{ gap: 14 }}>
      {intro ? <Inline text={intro} /> : null}
      <View style={{ backgroundColor: darkColors.termBg, borderRadius: radius.lg, borderWidth: 1, borderColor: darkColors.line, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: darkColors.bg2, borderBottomWidth: 1, borderBottomColor: darkColors.line }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <View key={c} style={{ width: 10, height: 10, borderRadius: 5, marginRight: 6, backgroundColor: c }} />
          ))}
          <T v="tiny" color={darkColors.faint} style={{ marginLeft: 10 }}>demo · sql · base «{setup.db}»</T>
        </View>
        <ScrollView ref={scroll} style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 12, gap: 16 }} nestedScrollEnabled>
          {done.map((d, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(220)} style={{ gap: 8 }} onLayout={(e) => { ys.current[i] = e.nativeEvent.layout.y; }}>
              <PyCode code={d.cell.sql} lang="sql" flush />
              {d.results.map((r, k) => (
                <SqlResult key={k} result={r} showStats={!!stats} />
              ))}
              {d.error ? (
                <SqlResult error={d.error} script={d.failedSql} />
              ) : null}
              {d.cell.note ? (
                <View style={{ marginTop: 2, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: darkColors.cyan }}>
                  <T v="small" color={darkColors.cyan}>→ {d.cell.note}</T>
                </View>
              ) : null}
            </Animated.View>
          ))}
          {done.length === 0 && <T v="small" color={darkColors.faint}>Pulsa «Ejecutar» para ver la primera sentencia…</T>}
        </ScrollView>
      </View>
      {!finished ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label={done.length === 0 ? '▶  Ejecutar' : '▶  Siguiente sentencia'} onPress={runNext} disabled={running} kind="accent" />
          </View>
          {done.length < cells.length - 1 && <Button small full={false} style={{ alignSelf: 'center' }} label="Todo" onPress={runAll} disabled={running} kind="secondary" />}
        </View>
      ) : (
        <T v="small" color={colors.green} center>✓ Demostración completa</T>
      )}
      <SqlSchemaPanel session={sess} refresh={done.length} />
    </View>
  );
}
