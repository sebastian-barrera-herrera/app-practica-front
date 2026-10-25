import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SQL_REF_CATEGORY, sqlRefByName, type SqlRef } from '@/content/sql/reference';
import { useGame } from '@/game/store';
import { newSqlSession } from '@/lib/sqlrun';
import { useStudyContext } from '@/lib/studyClock';
import type { ResultSet, SqlError } from '@/sqlengine/types';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { PyCode } from './PyCode';
import { RichText } from './RichText';
import { Screen } from './Screen';
import { SqlResult } from './SqlResult';
import { T } from './Text';
import { colors, darkColors, fonts, ink, radius } from './theme';

function Example({ db, sql, note }: { db: string; sql: string; note?: string }) {
  const [out, setOut] = useState<null | { results: ResultSet[]; error?: SqlError; sql: string }>(null);
  return (
    <Card pad={12}>
      {note ? <T v="small" color={colors.dim} style={{ marginBottom: 8 }}>{note}</T> : null}
      <PyCode code={sql} lang="sql" />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="▶ Ejecutar"
            small
            kind="accent"
            onPress={() => {
              const r = newSqlSession({ db }).exec(sql);
              setOut({ results: r.results, error: r.error?.error, sql: r.error?.sql ?? sql });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Probar en el editor"
            small
            kind="secondary"
            onPress={() => {
              const g = useGame.getState();
              g.setSandbox('sql', { db, code: sql + '\n', log: [], history: [] });
              g.setActive('sql');
              router.push('/(tabs)/lab');
            }}
          />
        </View>
      </View>
      {out && (
        <View style={{ marginTop: 10, gap: 8, backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: darkColors.line }}>
          {out.results.slice(-3).map((r, i) => (
            <SqlResult key={i} result={r} maxRows={12} showStats={false} />
          ))}
          {out.error ? <SqlResult error={out.error} script={out.sql} /> : null}
        </View>
      )}
    </Card>
  );
}

/** Ficha de la biblioteca de SQL. */
export function SqlRefSheet({ name }: { name: string }) {
  useStudyContext('sql');
  const ref: SqlRef | undefined = useMemo(() => sqlRefByName(name), [name]);
  useEffect(() => {
    if (ref) useGame.getState().bump('sql', { libraryViews: 1 });
  }, [ref]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="tiny" color={colors.dim}>Biblioteca de SQL</T>
      </View>
      {!ref ? (
        <View style={{ gap: 16, paddingTop: 30 }}>
          <T v="h2" center>No encuentro «{name}»</T>
          <Button label="Volver" onPress={() => router.back()} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          <View style={{ gap: 6 }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 28, lineHeight: 36 }} color={ink('#38BDF8')}>{ref.name}</T>
            <T color={colors.dim}>{ref.summary}</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <Chip label={SQL_REF_CATEGORY[ref.category]} color={colors.cyan} />
              <Chip label={ref.kind} color={colors.violet} />
              <Chip label={['', 'Básico', 'Intermedio', 'Avanzado'][ref.level]} color={colors.mint} />
            </View>
          </View>
          <View>
            <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Forma de uso</T>
            <PyCode code={ref.usage} lang="sql" />
          </View>
          {ref.details ? <RichText body={ref.details} size={15} /> : null}
          <T v="label" color={colors.dim}>Ejemplos <T v="tiny" color={colors.faint}>(sobre la base «{ref.db}»)</T></T>
          {ref.examples.map(([sql, note], i) => (
            <Example key={i} db={ref.db} sql={sql} note={note} />
          ))}
          {ref.seeAlso?.length ? (
            <View>
              <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Mira también</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ref.seeAlso.map((s) => (
                  <Chip key={s} label={s} mono color={colors.cyan} onPress={() => router.push({ pathname: '/library/[cmd]', params: { cmd: s, course: 'sql' } })} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
