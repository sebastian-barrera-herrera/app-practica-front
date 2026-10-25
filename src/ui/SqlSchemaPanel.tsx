import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { Database } from '@/sqlengine/catalog';
import { schemaOf } from '@/lib/sqlrun';
import type { SqlSession } from '@/sqlengine/session';
import { SqlResult } from './SqlResult';
import { T } from './Text';
import { colors, fonts, radius } from './theme';

/**
 * Explorador de tablas: qué tablas hay, qué columnas tiene cada una (con su tipo y la clave primaria) y unas filas de ejemplo.
 * Es lo primero que se mira antes de escribir una consulta.
 */
export function SqlSchemaPanel({ session, db, onPick, defaultOpen = false, refresh = 0 }: { session?: SqlSession; db?: Database; onPick?: (name: string) => void; defaultOpen?: boolean; /** cambia cuando la base de datos cambió (para volver a leerla) */ refresh?: number }) {
  const database = db ?? session?.db;
  const [open, setOpen] = useState(defaultOpen);
  const [which, setWhich] = useState<string | null>(null);
  const schema = useMemo(() => (database ? schemaOf(database) : { tables: [] }), [database, open, which, refresh]); // eslint-disable-line react-hooks/exhaustive-deps -- se recalcula al abrir o al cambiar la base de datos
  if (!database || !schema.tables.length) return null;

  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9 }}>
        <T style={{ fontSize: 15 }}>🗂️</T>
        <T v="small" bold style={{ flex: 1 }}>
          Tablas ({schema.tables.length})
          <T v="tiny" color={colors.dim}>  {schema.tables.map((t) => t.name).join(' · ')}</T>
        </T>
        <T color={colors.dim}>{open ? '▲' : '▼'}</T>
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(180)} style={{ gap: 10, padding: 12, paddingTop: 2, borderTopWidth: 1, borderTopColor: colors.line }}>
          {schema.tables.map((t) => {
            const isOpen = which === t.name;
            const table = database.table(t.name);
            return (
              <View key={t.name} style={{ gap: 6 }}>
                <Pressable onPress={() => setWhich(isOpen ? null : t.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={colors.cyan}>{t.name}</T>
                  <T v="tiny" color={colors.dim}>{table ? `${table.rows.length} fila${table.rows.length === 1 ? '' : 's'}` : ''}</T>
                  <View style={{ flex: 1 }} />
                  {onPick ? (
                    <Pressable onPress={() => onPick(t.name)} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line }}>
                      <T v="tiny" bold color={colors.dim}>+ usar</T>
                    </Pressable>
                  ) : null}
                  <T v="tiny" color={colors.dim}>{isOpen ? 'ocultar filas' : 'ver filas'}</T>
                </Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {t.cols.map((c) => (
                    <View key={c.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: c.pk ? colors.amber + '22' : colors.card2, borderWidth: 1, borderColor: c.pk ? colors.amber + '77' : colors.line }}>
                      {c.pk ? <T style={{ fontSize: 10 }}>🔑</T> : null}
                      <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.text}>{c.name}</T>
                      <T style={{ fontFamily: fonts.mono, fontSize: 10 }} color={colors.faint}>{c.type.toLowerCase()}</T>
                    </View>
                  ))}
                </View>
                {isOpen && table ? <Preview db={database} name={t.name} refresh={refresh} /> : null}
              </View>
            );
          })}
        </Animated.View>
      )}
    </View>
  );
}

function Preview({ db, name, refresh }: { db: Database; name: string; refresh: number }) {
  const table = db.table(name);
  const result = useMemo(() => {
    if (!table) return undefined;
    return {
      command: 'SELECT' as const,
      columns: table.cols.map((c) => ({ name: c.name, type: c.type.base })),
      rows: table.rows.slice(0, 5),
      affected: 0,
      message: '',
      stats: { rowsRead: 0, indexes: [] },
    };
  }, [table, name, refresh]); // eslint-disable-line react-hooks/exhaustive-deps -- las filas cambian sin que cambie `table`
  if (!result) return null;
  return (
    <View style={{ backgroundColor: '#0F1923', borderRadius: radius.md, padding: 6 }}>
      <SqlResult result={result} showStats={false} maxRows={5} />
      {table && table.rows.length > 5 ? <T v="tiny" color="#7E8A99" style={{ padding: 4 }}>… y {table.rows.length - 5} más</T> : null}
    </View>
  );
}
