import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { select, tap } from '@/lib/haptics';
import { OnDark, T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';

export function Frame({ title, children, style }: { title?: string; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 12, overflow: 'hidden' }, style]}>
      {title ? <T v="label" color={colors.dim}>{title}</T> : null}
      {children}
    </View>
  );
}

export const palette = {
  get you() { return colors.mint; },
  get term() { return colors.cyan; },
  get shell() { return colors.violet; },
  get kernel() { return colors.amber; },
  get hw() { return colors.rose; },
  get file() { return colors.dim; },
  get dir() { return colors.cyan; },
};

/** Caja de código con fuente monoespaciada. */
export function MonoBox({ children, color = colors.termText, size = 14 }: { children: React.ReactNode; color?: string; size?: number }) {
  return (
    <View style={{ backgroundColor: colors.termBg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.line }}>
      <OnDark>
        <T style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size + 6 }} color={color}>{children}</T>
      </OnDark>
    </View>
  );
}

/** Pie explicativo de una ilustración. */
export function Caption({ children, color = colors.cyan }: { children: React.ReactNode; color?: string }) {
  return <T v="small" color={color}>{children}</T>;
}

export function Chips<V extends string>({ items, value, onChange, color = colors.mint }: { items: { id: V; label: string }[]; value: V; onChange: (v: V) => void; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable key={it.id} onPress={() => { select(); onChange(it.id); }} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: on ? color : color + '1F', borderWidth: 1, borderColor: on ? color : color + '55' }}>
            <T v="tiny" bold color={on ? '#04120D' : color} style={{ fontFamily: fonts.monoBold }}>{it.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Texto con segmentos tocables (estilo «anatomía»). */
export interface Part {
  t: string;
  color: string;
  title: string;
  desc: string;
}
export function TapParts({ parts, size = 18, prefix }: { parts: Part[]; size?: number; prefix?: string }) {
  const [sel, setSel] = useState(0);
  const p = parts[sel];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ backgroundColor: colors.termBg, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line }}>
        <OnDark>
        {prefix ? <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.faint}>{prefix}</T> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {parts.map((x, i) => (
            <Pressable key={i} onPress={() => { tap(); setSel(i); }}>
              <T style={{ fontFamily: sel === i ? fonts.monoBold : fonts.mono, fontSize: size, backgroundColor: sel === i ? x.color + '33' : 'transparent', textDecorationLine: sel === i ? 'underline' : 'none' }} color={x.color}>{x.t}</T>
            </Pressable>
          ))}
        </View>
        </OnDark>
      </View>
      <Animated.View key={sel} entering={FadeIn.duration(220)} style={{ borderLeftWidth: 4, borderLeftColor: p.color, paddingLeft: 12, gap: 2 }}>
        <T v="h3" color={p.color}>{p.title}</T>
        <T v="small" color={colors.text}>{p.desc}</T>
      </Animated.View>
    </View>
  );
}

/** Líneas de código tocables, una por fila (para scripts). */
export function TapLines({ parts, size = 13 }: { parts: Part[]; size?: number }) {
  const [sel, setSel] = useState(0);
  const p = parts[sel];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ backgroundColor: colors.termBg, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line }}>
        <OnDark>
        {parts.map((x, i) => (
          <Pressable key={i} onPress={() => { tap(); setSel(i); }} style={{ flexDirection: 'row', paddingHorizontal: 10, backgroundColor: sel === i ? x.color + '26' : 'transparent', borderLeftWidth: 3, borderLeftColor: sel === i ? x.color : 'transparent' }}>
            <T style={{ fontFamily: fonts.mono, fontSize: size - 2, width: 20 }} color={colors.faint}>{i + 1}</T>
            <T style={{ fontFamily: sel === i ? fonts.monoBold : fonts.mono, fontSize: size, flex: 1 }} color={x.color}>{x.t}</T>
          </Pressable>
        ))}
        </OnDark>
      </View>
      <Animated.View key={sel} entering={FadeIn.duration(220)} style={{ borderLeftWidth: 4, borderLeftColor: p.color, paddingLeft: 12, gap: 2 }}>
        <T v="h3" color={p.color}>{p.title}</T>
        <T v="small" color={colors.text}>{p.desc}</T>
      </Animated.View>
    </View>
  );
}

// ───────────────────────── pasos y reproducción ─────────────────────────

export function useStepper(count: number, autoMs = 2400) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setI((x) => (x + 1) % count), autoMs);
    return () => clearInterval(id);
  }, [auto, count, autoMs]);
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(count - 1, n))), [count]);
  return { i, go, auto, setAuto };
}

export function StepControls({ i, n, go, auto, setAuto }: { i: number; n: number; go: (n: number) => void; auto: boolean; setAuto: (b: boolean) => void }) {
  const btn = (label: string, onPress: () => void, disabled?: boolean, wide?: boolean) => (
    <Pressable disabled={disabled} onPress={() => { tap(); onPress(); }} style={{ minWidth: wide ? 84 : 44, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <T bold color={colors.text}>{label}</T>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {btn('◀', () => go(i - 1), i === 0)}
      <View style={{ flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center' }}>
        {Array.from({ length: n }).map((_, k) => (
          <Pressable key={k} onPress={() => go(k)} hitSlop={6}>
            <View style={{ width: k === i ? 18 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? colors.mint : colors.line }} />
          </Pressable>
        ))}
      </View>
      {btn(auto ? '⏸' : '▶ Auto', () => setAuto(!auto), false, !auto)}
      {btn('▶', () => go(i + 1), i === n - 1)}
    </View>
  );
}

// ───────────────────────── diagrama de flujo con paquetes ─────────────────────────

export interface FlowNode {
  id: string;
  label: string;
  emoji?: string;
  sub?: string;
  /** Posición del centro, en % del ancho y alto. */
  x: number;
  y: number;
  color?: string;
}
export interface FlowStep {
  text: string;
  /** Paquete que viaja de un nodo a otro. */
  from?: string;
  to?: string;
  packet?: string;
  active?: string[];
}

/**
 * Nodos + aristas + pasos. En cada paso se resaltan los nodos activos y un «paquete» viaja entre dos nodos.
 */
export function FlowDiagram({ title, nodes, edges, steps, height = 230, nodeW = 92, autoMs = 2600 }: { title?: string; nodes: FlowNode[]; edges: [string, string][]; steps: FlowStep[]; height?: number; nodeW?: number; autoMs?: number }) {
  const { i, go, auto, setAuto } = useStepper(steps.length, autoMs);
  const [W, setW] = useState(300);
  const step = steps[i];
  const byId = useRef(new Map<string, FlowNode>()).current;
  byId.clear();
  nodes.forEach((n) => byId.set(n.id, n));
  const center = (id: string) => {
    const n = byId.get(id)!;
    return { x: (n.x / 100) * W, y: (n.y / 100) * height };
  };
  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const po = useSharedValue(0);
  useEffect(() => {
    if (step.from && step.to && byId.has(step.from) && byId.has(step.to)) {
      const a = center(step.from);
      const b = center(step.to);
      px.value = a.x;
      py.value = a.y;
      po.value = withSequence(withTiming(1, { duration: 150 }));
      px.value = withTiming(b.x, { duration: 950, easing: Easing.inOut(Easing.cubic) });
      py.value = withTiming(b.y, { duration: 950, easing: Easing.inOut(Easing.cubic) });
    } else {
      po.value = withTiming(0, { duration: 150 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, W]);
  const packetStyle = useAnimatedStyle(() => ({ opacity: po.value, transform: [{ translateX: px.value - 40 }, { translateY: py.value - 13 }] }));
  const activeSet = new Set(step.active ?? [step.from, step.to].filter(Boolean) as string[]);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return (
    <Frame title={title}>
      <View onLayout={onLayout} style={{ height }}>
        <Svg width={W} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
          {edges.map(([a, b]) => {
            const A = center(a);
            const B = center(b);
            const hot = (step.from === a && step.to === b) || (step.from === b && step.to === a);
            return <Line key={a + b} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={hot ? colors.mint : colors.line} strokeWidth={hot ? 3 : 2} strokeDasharray={hot ? undefined : '5 5'} />;
          })}
        </Svg>
        {nodes.map((n) => {
          const c = center(n.id);
          const on = activeSet.has(n.id);
          const col = n.color ?? colors.cyan;
          return (
            <View key={n.id} style={{ position: 'absolute', left: c.x - nodeW / 2, top: c.y - 30, width: nodeW, height: 60, borderRadius: 14, borderWidth: on ? 2.5 : 1.5, borderColor: on ? col : colors.line, backgroundColor: on ? col + '24' : colors.card2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              {n.emoji ? <T style={{ fontSize: 18, lineHeight: 22 }}>{n.emoji}</T> : null}
              <T v="tiny" bold color={on ? col : colors.dim} numberOfLines={1} style={{ fontSize: 11 }}>{n.label}</T>
              {n.sub ? <T v="tiny" color={colors.faint} numberOfLines={1} style={{ fontSize: 9, lineHeight: 11 }}>{n.sub}</T> : null}
            </View>
          );
        })}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 80, height: 26, borderRadius: 13, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' }, packetStyle]}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 10 }} color="#2A1A00" numberOfLines={1}>{step.packet ?? ''}</T>
        </Animated.View>
      </View>
      <Animated.View key={i} entering={FadeIn.duration(220)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', minHeight: 48 }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
          <T v="tiny" bold color="#04120D">{i + 1}</T>
        </View>
        <T v="small" color={colors.text} style={{ flex: 1 }}>{step.text}</T>
      </Animated.View>
      <StepControls i={i} n={steps.length} go={go} auto={auto} setAuto={setAuto} />
    </Frame>
  );
}
