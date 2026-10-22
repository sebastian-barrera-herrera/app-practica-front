import React from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { CodeLines, Console, StepBar, pyHue, useSteps, type OutLine } from './pyui';

// ───────────────────────── paneles de estado ─────────────────────────

export type Panel =
  | { k: 'vars'; title?: string; items: { name: string; value: string; hot?: boolean; color?: string }[] }
  | { k: 'stack'; title?: string; frames: { name: string; info?: string; hot?: boolean; color?: string }[] }
  | { k: 'cells'; title?: string; cells: { text: string; hot?: boolean; dim?: boolean; color?: string }[]; pointer?: number }
  | { k: 'text'; title?: string; text: string; color?: string };

function PanelTitle({ text }: { text?: string }) {
  return text ? <T v="tiny" bold color={colors.dim} style={{ fontFamily: fonts.monoBold }}>{text}</T> : null;
}

export function PanelView({ p }: { p: Panel }) {
  const box = { backgroundColor: colors.card2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 6 } as const;
  if (p.k === 'vars') {
    return (
      <View style={box}>
        <PanelTitle text={p.title ?? 'Variables'} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 36 }}>
          {p.items.length === 0 ? <T v="small" color={colors.faint}>(vacío)</T> : null}
          {p.items.map((it) => {
            const c = it.color ?? (it.hot ? colors.amber : colors.cyan);
            return (
              <Animated.View key={it.name + it.value} entering={it.hot ? ZoomIn.duration(260) : FadeIn.duration(150)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: it.hot ? 2 : 1, borderColor: c, backgroundColor: c + (it.hot ? '30' : '14'), paddingHorizontal: 9, paddingVertical: 4, gap: 6 }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 18 }} color={c}>{it.name}</T>
                <T style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 }} color={colors.dim}>=</T>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 18 }} color={colors.text}>{it.value}</T>
              </Animated.View>
            );
          })}
        </View>
      </View>
    );
  }
  if (p.k === 'stack') {
    const frames = [...p.frames].reverse();
    return (
      <View style={box}>
        <PanelTitle text={p.title ?? 'Pila de llamadas'} />
        <View style={{ gap: 5, minHeight: 36 }}>
          {frames.length === 0 ? <T v="small" color={colors.faint}>(vacía)</T> : null}
          {frames.map((f, i) => {
            const c = f.color ?? (f.hot ? colors.amber : colors.violet);
            return (
              <Animated.View key={f.name + i + frames.length} entering={FadeIn.duration(200)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, borderWidth: f.hot ? 2 : 1, borderColor: c, backgroundColor: c + (f.hot ? '30' : '16'), paddingHorizontal: 10, paddingVertical: 5 }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 18 }} color={c}>{f.name}</T>
                {f.info ? <T style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 }} color={colors.dim}>{f.info}</T> : null}
              </Animated.View>
            );
          })}
        </View>
      </View>
    );
  }
  if (p.k === 'cells') {
    return (
      <View style={box}>
        <PanelTitle text={p.title} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {p.cells.map((c, i) => {
            const col = c.color ?? (c.hot ? colors.amber : colors.cyan);
            return (
              <View key={i} style={{ alignItems: 'center', gap: 3 }}>
                <View style={{ minWidth: 38, height: 38, paddingHorizontal: 6, borderRadius: 9, borderWidth: c.hot ? 2 : 1, borderColor: col, backgroundColor: col + (c.hot ? '30' : '14'), alignItems: 'center', justifyContent: 'center', opacity: c.dim ? 0.35 : 1 }}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: 14, lineHeight: 19 }} color={colors.text}>{c.text}</T>
                </View>
                <T style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 14, opacity: p.pointer === i ? 1 : 0 }} color={colors.amber}>▲</T>
              </View>
            );
          })}
        </View>
      </View>
    );
  }
  return (
    <View style={[box, { borderLeftWidth: 4, borderLeftColor: p.color ?? colors.violet }]}>
      <PanelTitle text={p.title} />
      <T v="small" color={colors.text}>{p.text}</T>
    </View>
  );
}

// ───────────────────────── recorrido paso a paso ─────────────────────────

export interface WalkStep {
  /** Líneas de código activas (cursor). */
  at?: number | number[];
  note: string;
  panels?: Panel[];
  /** Salida acumulada hasta este paso. */
  out?: OutLine[];
  /** Resaltes extra por línea (p. ej. el color de un error). */
  marks?: Record<number, string>;
  dim?: number[];
  /** Texto breve a la derecha de una línea. */
  notes?: Record<number, string>;
}

/** Código + estado + salida + explicación, con pasos. Es la base de casi todas las ilustraciones del curso de Python. */
export function Walk({ title, lines, steps, color, size = 12, consoleLines = 0 }: { title?: string; lines: string[]; steps: WalkStep[]; color?: string; size?: number; consoleLines?: number }) {
  const hue = pyHue();
  const c = color ?? hue.b;
  const st = useSteps(steps.length, 2600);
  const s = steps[st.i];
  return (
    <Frame title={title}>
      <CodeLines lines={lines} active={s.at} color={c} size={size} marks={s.marks} dim={s.dim} notes={s.notes} />
      {s.panels?.map((p, k) => <PanelView key={k} p={p} />)}
      {consoleLines > 0 ? <Console lines={s.out ?? []} minLines={consoleLines} size={size} title="salida" /> : null}
      <Animated.View key={st.i} entering={FadeIn.duration(220)} style={{ borderLeftWidth: 4, borderLeftColor: c, paddingLeft: 12, minHeight: 58, justifyContent: 'center' }}>
        <T v="small" color={colors.text}>{s.note}</T>
      </Animated.View>
      <StepBar i={st.i} n={steps.length} go={st.go} auto={st.auto} toggle={st.toggle} color={c} hint />
    </Frame>
  );
}
