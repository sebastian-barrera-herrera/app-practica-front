/** Piezas comunes de las ilustraciones de SQL: tablas de datos, código SQL resaltado y avisos. */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { highlightSql } from '@/ui/sqlhighlight';
import { sqlTokColor } from '@/ui/sqlcolors';
import { courseColor, courseColor2 } from '@/ui/courseColors';
import { T } from '@/ui/Text';
import { colors, darkColors, fonts, radius } from '@/ui/theme';

/** Colores de acento de SQL según el tema activo. Llamar siempre dentro de un render. */
export const sqlHue = () => ({ a: courseColor('sql'), b: courseColor2('sql') });

export const dk = darkColors;

export type Cell = string | number | null | boolean;

export interface SqlTableProps {
  /** Nombre de la tabla (se pinta como etiqueta). */
  name?: string;
  cols: { name: string; pk?: boolean; fk?: boolean }[];
  rows: Cell[][];
  /** Columnas / filas resaltadas. */
  hiCols?: number[];
  hiRows?: number[];
  /** Celdas resaltadas, como «fila,columna». */
  hiCells?: string[];
  /** Filas que se tachan o atenúan (descartadas). */
  dimRows?: number[];
  dimCols?: number[];
  /** Color del resaltado. */
  color?: string;
  /** Ancho mínimo de columna. */
  colW?: number;
  size?: number;
  onCol?: (c: number) => void;
  onRow?: (r: number) => void;
  onCell?: (r: number, c: number) => void;
  onName?: () => void;
  /** Marcas a la izquierda de cada fila (números, flechas…). */
  rowTags?: Record<number, string>;
}

const show = (v: Cell): string => (v === null ? 'NULL' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

/** Una tabla de datos sobre fondo oscuro, con columnas, filas y celdas que se pueden resaltar o tocar. */
export function SqlTable({ name, cols, rows, hiCols = [], hiRows = [], hiCells = [], dimRows = [], dimCols = [], color, colW = 40, size = 12.5, onCol, onRow, onCell, onName, rowTags }: SqlTableProps) {
  const c = color ?? sqlHue().a;
  const lh = Math.round(size * 1.5);
  // cada columna mide lo que necesita su contenido más largo
  const widths = cols.map((col, ci) => {
    let n = col.name.length + (col.pk || col.fk ? 3 : 0);
    for (const r of rows) n = Math.max(n, show(r[ci]).length);
    return Math.max(colW, Math.ceil(n * size * 0.62) + 18);
  });
  return (
    <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, padding: 8, gap: 6 }}>
      {name ? (
        <Pressable disabled={!onName} onPress={() => { tap(); onName?.(); }} style={{ alignSelf: 'flex-start' }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: size + 1 }} color={dk.cyan}>▦ {name}</T>
        </Pressable>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: dk.line }}>
          <View style={{ flexDirection: 'row' }}>
            {rowTags ? <View style={{ width: 22 }} /> : null}
            {cols.map((col, ci) => {
              const on = hiCols.includes(ci);
              return (
                <Pressable key={ci} disabled={!onCol} onPress={() => { tap(); onCol?.(ci); }} style={{ width: widths[ci], paddingHorizontal: 8, paddingVertical: 5, backgroundColor: on ? c + '55' : dk.card2, borderRightWidth: 1, borderRightColor: dk.line, opacity: dimCols.includes(ci) ? 0.35 : 1 }}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: size, lineHeight: lh }} color={on ? dk.white : dk.mint}>
                    {col.pk ? '🔑 ' : col.fk ? '🔗 ' : ''}
                    {col.name}
                  </T>
                </Pressable>
              );
            })}
          </View>
          {rows.map((r, ri) => {
            const rowOn = hiRows.includes(ri);
            const dim = dimRows.includes(ri);
            return (
              <Pressable key={ri} disabled={!onRow && !onCell} onPress={() => { if (onRow) { tap(); onRow(ri); } }} style={{ flexDirection: 'row', backgroundColor: rowOn ? c + '33' : ri % 2 ? 'rgba(255,255,255,0.03)' : 'transparent', opacity: dim ? 0.3 : 1 }}>
                {rowTags ? (
                  <View style={{ width: 22, alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ fontSize: 10 }} color={c}>{rowTags[ri] ?? ''}</T>
                  </View>
                ) : null}
                {r.map((v, ci) => {
                  const cellOn = hiCells.includes(`${ri},${ci}`) || hiCols.includes(ci);
                  return (
                    <Pressable key={ci} disabled={!onCell} onPress={() => { tap(); onCell?.(ri, ci); }} style={{ width: widths[ci], paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.06)', backgroundColor: cellOn ? c + '33' : 'transparent', opacity: dimCols.includes(ci) ? 0.35 : 1 }}>
                      <T style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: lh, fontStyle: v === null ? 'italic' : 'normal', textAlign: typeof v === 'number' ? 'right' : 'left' }} color={v === null ? dk.faint : typeof v === 'number' ? '#B5CEA8' : dk.termText}>{show(v)}</T>
                    </Pressable>
                  );
                })}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/** Una línea (o varias) de SQL con colores. `active` resalta palabras o trozos concretos. */
export function Sql({ code, size = 12.5, hi, hiColor }: { code: string; size?: number; /** trozos de texto a resaltar */ hi?: string[]; hiColor?: string }) {
  const lines = highlightSql(code);
  const lh = Math.round(size * 1.55);
  const c = hiColor ?? sqlHue().b;
  return (
    <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, paddingHorizontal: 10, paddingVertical: 8 }}>
      {lines.map((line, i) => (
        <T key={i} style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: lh }} color={dk.termText}>
          {line.length
            ? line.map((t, j) => {
                const on = hi?.some((h) => h.toLowerCase() === t.s.trim().toLowerCase());
                return (
                  <T key={j} style={{ fontFamily: t.k === 'kw' || t.k === 'dec' || on ? fonts.monoBold : fonts.mono, fontSize: size, fontStyle: t.k === 'com' ? 'italic' : 'normal', backgroundColor: on ? c + '44' : 'transparent' }} color={sqlTokColor(t)}>{t.s}</T>
                );
              })
            : ' '}
        </T>
      ))}
    </View>
  );
}

/** Aviso con el color de SQL. */
export function Note({ children, color, min }: { children: React.ReactNode; color?: string; min?: number }) {
  const c = color ?? sqlHue().a;
  return (
    <View style={{ borderLeftWidth: 4, borderLeftColor: c, paddingLeft: 12, paddingVertical: 4, minHeight: min }}>
      <T v="small" color={colors.text}>{children}</T>
    </View>
  );
}

/** Explicación que aparece (con transición) cuando cambia `k`. */
export function Explain({ k, title, color, children }: { k: string | number; title: string; color: string; children: React.ReactNode }) {
  return (
    <Animated.View key={k} entering={FadeIn.duration(220)} style={{ borderLeftWidth: 4, borderLeftColor: color, paddingLeft: 12, gap: 2 }}>
      <T v="h3" color={color}>{title}</T>
      <T v="small" color={colors.text}>{children}</T>
    </Animated.View>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <Animated.View entering={ZoomIn.duration(200)} style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color + '33', borderWidth: 1, borderColor: color }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5, lineHeight: 16 }} color={color}>{text}</T>
    </Animated.View>
  );
}
