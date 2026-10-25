import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { formatValue } from '@/sqlengine/values';
import type { ResultSet, SqlError, Value } from '@/sqlengine/types';
import { OnDark, T } from './Text';
import { darkColors, fonts, radius } from './theme';

const CH = 7.6; // ancho aproximado de un carácter mono de 12,5 px

/** Línea y columna (desde 1) de una posición dentro de un texto. */
export function lineCol(text: string, pos: number): { line: number; col: number; text: string } {
  const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
  const line = before.split('\n').length;
  const ls = before.lastIndexOf('\n') + 1;
  const end = text.indexOf('\n', ls);
  return { line, col: pos - ls + 1, text: text.slice(ls, end < 0 ? undefined : end) };
}

function cellColor(v: Value, type: string): string {
  if (v === null) return darkColors.faint;
  if (typeof v === 'boolean') return darkColors.amber;
  if (typeof v === 'number') return '#B5CEA8';
  if (type === 'date' || type === 'timestamp') return darkColors.cyan;
  return darkColors.termText;
}

/** Un error de SQL: qué pasó, dónde y una pista. */
export function SqlErrorBox({ error, script }: { error: SqlError; script?: string }) {
  const at = script != null && error.pos != null ? lineCol(script, error.pos) : null;
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: 'rgba(255,107,129,0.10)', borderWidth: 1, borderColor: 'rgba(255,107,129,0.5)' }}>
      <OnDark>
        <T v="small" bold color="#FF9AA5">⛔ {error.message}</T>
        {at ? (
          <View style={{ gap: 2 }}>
            <T v="tiny" color={darkColors.faint}>Línea {at.line}, columna {at.col}</T>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: 8 }}>
              <T style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 }} color={darkColors.termText}>{at.text.length > 90 ? `${at.text.slice(0, 90)}…` : at.text}</T>
              <T style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 }} color="#FF9AA5">{`${' '.repeat(Math.min(at.col - 1, 90))}^`}</T>
            </View>
          </View>
        ) : null}
        {error.hint ? <T v="small" color={darkColors.amber}>💡 {error.hint}</T> : null}
      </OnDark>
    </View>
  );
}

/** El resultado de una sentencia: tabla de filas o mensaje de lo que hizo. */
export function SqlResult({ result, error, script, maxRows = 40, showStats = true }: { result?: ResultSet; error?: SqlError; script?: string; maxRows?: number; showStats?: boolean }) {
  const widths = useMemo(() => {
    if (!result?.columns.length) return [];
    return result.columns.map((c, i) => {
      let w = c.name.length;
      for (const r of result.rows.slice(0, maxRows)) w = Math.max(w, formatValue(r[i], c.type).length);
      return Math.max(44, Math.min(230, Math.round(w * CH) + 22));
    });
  }, [result, maxRows]);

  if (error) return <SqlErrorBox error={error} script={script} />;
  if (!result) return null;

  if (!result.columns.length) {
    return (
      <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: 'rgba(34,211,166,0.10)', borderWidth: 1, borderColor: 'rgba(34,211,166,0.45)' }}>
        <T style={{ fontSize: 16 }}>✅</T>
        <T v="small" style={{ flex: 1 }} color={darkColors.termText}>{result.message}</T>
      </View>
    );
  }

  const shown = result.rows.slice(0, maxRows);
  const more = result.rows.length - shown.length;
  const stats = result.stats;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: darkColors.line, overflow: 'hidden', backgroundColor: darkColors.bg2 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
          <View>
            <View style={{ flexDirection: 'row', backgroundColor: darkColors.card2 }}>
              {result.columns.map((c, i) => (
                <View key={i} style={{ width: widths[i], paddingHorizontal: 8, paddingVertical: 6, borderRightWidth: 1, borderRightColor: darkColors.line }}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={darkColors.mint} numberOfLines={1}>{c.name}</T>
                  <T style={{ fontSize: 9.5, lineHeight: 12 }} color={darkColors.faint}>{c.type === 'any' || c.type === 'null' ? '' : c.type}</T>
                </View>
              ))}
            </View>
            {shown.length === 0 ? (
              <View style={{ padding: 12 }}>
                <T v="small" color={darkColors.faint}>(ninguna fila)</T>
              </View>
            ) : (
              shown.map((r, ri) => (
                <View key={ri} style={{ flexDirection: 'row', backgroundColor: ri % 2 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                  {r.map((v, i) => {
                    const t = result.columns[i].type;
                    const right = typeof v === 'number';
                    return (
                      <View key={i} style={{ width: widths[i], paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.05)' }}>
                        <T
                          selectable
                          numberOfLines={2}
                          style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 17, textAlign: right ? 'right' : 'left', fontStyle: v === null ? 'italic' : 'normal' }}
                          color={cellColor(v, t)}
                        >
                          {formatValue(v, t)}
                        </T>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
      <T v="tiny" color={darkColors.faint}>
        {result.rows.length} fila{result.rows.length === 1 ? '' : 's'}
        {more > 0 ? ` (se muestran ${shown.length})` : ''}
        {showStats && stats.rowsRead > 0 ? ` · ${stats.rowsRead} leída${stats.rowsRead === 1 ? '' : 's'} de las tablas${stats.indexes.length ? ` · índice ${stats.indexes.join(', ')}` : ''}` : ''}
      </T>
    </View>
  );
}
