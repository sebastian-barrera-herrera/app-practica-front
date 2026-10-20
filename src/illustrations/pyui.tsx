import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { select, tap } from '@/lib/haptics';
import { courseColor, courseColor2 } from '@/ui/courseColors';
import { highlightPython, type TokKind } from '@/ui/pyhighlight';
import { T } from '@/ui/Text';
import { colors, darkColors, fonts, radius } from '@/ui/theme';

/** Colores de acento de Python (azul / amarillo) según el tema activo. Llamar siempre dentro de un render. */
export const pyHue = () => ({ a: courseColor('python'), b: courseColor2('python') });

/** Paleta fija (la del tema oscuro) para texto sobre las cajas de código, que son oscuras en los dos temas. */
export const dk = darkColors;

/** Texto legible sobre un relleno sólido del color dado. */
export function onColor(bg: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!m) return '#04120D';
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // contraste con el texto casi negro frente al blanco
  return (L + 0.05) / 0.055 >= 1.05 / (L + 0.05) ? '#04120D' : '#FFFFFF';
}

// ───────────────────────── botones y etiquetas ─────────────────────────

export function Btn({ label, onPress, disabled, color, solid, a11y, w, h = 40, grow }: { label: string; onPress: () => void; disabled?: boolean; color?: string; solid?: boolean; a11y?: string; w?: number; h?: number; grow?: boolean }) {
  const c = color ?? colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { tap(); onPress(); }}
      style={{ minWidth: w ?? 44, height: h, paddingHorizontal: 12, borderRadius: 12, backgroundColor: solid ? c : colors.card2, borderWidth: 1, borderColor: solid ? c : colors.line, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1, flexGrow: grow ? 1 : 0 }}
    >
      <T bold color={solid ? onColor(c) : c} style={{ fontSize: 15, lineHeight: 20 }}>{label}</T>
    </Pressable>
  );
}

/** Chips de selección (como `Chips`, pero con texto legible en los dos temas y etiquetas de accesibilidad). */
export function Tabs<V extends string>({ items, value, onChange, color }: { items: { id: V; label: string }[]; value: V; onChange: (v: V) => void; color?: string }) {
  const c = color ?? colors.violet;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            accessibilityRole="button"
            accessibilityLabel={it.label}
            accessibilityState={{ selected: on }}
            onPress={() => { select(); onChange(it.id); }}
            style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? c : c + '1F', borderWidth: 1, borderColor: on ? c : c + '66' }}
          >
            <T v="tiny" bold color={on ? onColor(c) : c} style={{ fontFamily: fonts.monoBold }}>{it.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Tag({ text, color, solid, size = 12 }: { text: string; color: string; solid?: boolean; size?: number }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: solid ? color : color + '24', borderWidth: 1, borderColor: color + (solid ? 'FF' : '66'), alignSelf: 'flex-start' }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: size, lineHeight: size + 5 }} color={solid ? onColor(color) : color}>{text}</T>
    </View>
  );
}

/** Pulso suave para invitar a tocar. */
export function Pulse({ active = true, children, style }: { active?: boolean; children: React.ReactNode; style?: ViewStyle }) {
  const k = useSharedValue(0);
  useEffect(() => {
    if (active) k.value = withRepeat(withSequence(withTiming(1, { duration: 750 }), withTiming(0, { duration: 750 })), -1);
    else k.value = withTiming(0, { duration: 200 });
  }, [active, k]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.07 * k.value }], opacity: 0.8 + 0.2 * k.value }));
  return <Animated.View style={[style, st]}>{children}</Animated.View>;
}

// ───────────────────────── código ─────────────────────────

const TOK: Record<TokKind, string> = {
  kw: '#C792EA', str: '#C3E88D', num: '#F78C6C', com: '#6B7AA8', fn: '#82AAFF', cls: '#FFCB6B', dec: '#FF9AA5', bi: '#5EEAD4', op: '#89DDFF', prompt: '#22D3A6', out: '#A6B6E0', text: darkColors.termText,
};

export function HiLine({ code, size = 12 }: { code: string; size?: number }) {
  const toks = highlightPython(code)[0] ?? [];
  return (
    <T style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: Math.round(size * 1.55) }} color={dk.termText}>
      {toks.length ? toks.map((t, j) => (
        <T key={j} style={{ fontFamily: t.k === 'kw' ? fonts.monoBold : fonts.mono, fontSize: size, fontStyle: t.k === 'com' ? 'italic' : 'normal' }} color={TOK[t.k]}>{t.s}</T>
      )) : ' '}
    </T>
  );
}

/**
 * Código con números de línea y líneas resaltadas (cursor de ejecución). Los colores de resalte son de la paleta oscura
 * porque la caja es oscura en los dos temas.
 */
export function CodeLines({ lines, active, color, size = 12, dim, marks, notes, nums = true }: { lines: string[]; active?: number | number[]; color?: string; size?: number; dim?: number[]; marks?: Record<number, string>; notes?: Record<number, string>; nums?: boolean }) {
  const act = Array.isArray(active) ? active : active === undefined || active < 0 ? [] : [active];
  const c = color ?? dk.amber;
  return (
    <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, paddingVertical: 8, overflow: 'hidden' }}>
      {lines.map((ln, i) => {
        const on = act.includes(i);
        const m = marks?.[i];
        const lc = on ? c : m;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 8, minHeight: Math.round(size * 1.55), backgroundColor: lc ? lc + '26' : 'transparent', borderLeftWidth: 3, borderLeftColor: lc ?? 'transparent', opacity: dim?.includes(i) ? 0.4 : 1 }}>
            {nums ? <T style={{ fontFamily: fonts.mono, fontSize: size - 2, width: 22, textAlign: 'right', marginRight: 8 }} color={dk.faint}>{i + 1}</T> : <View style={{ width: 8 }} />}
            <View style={{ flex: 1 }}><HiLine code={ln} size={size} /></View>
            {notes?.[i] ? <T style={{ fontFamily: fonts.mono, fontSize: size - 1 }} color={lc ?? dk.dim}>{notes[i]}</T> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Líneas de código tocables: cada una se explica debajo. */
export interface CodeTap {
  code: string;
  title: string;
  desc: string;
  color: string;
}
export function TapCode({ lines, size = 12, initial = 0, onSelect }: { lines: CodeTap[]; size?: number; initial?: number; onSelect?: (i: number) => void }) {
  const [sel, setSel] = useState(initial);
  const p = lines[sel];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, paddingVertical: 6, overflow: 'hidden' }}>
        {lines.map((l, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`Línea ${i + 1}: ${l.title}`}
            onPress={() => { tap(); setSel(i); onSelect?.(i); }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: Math.max(30, Math.round(size * 1.55)), paddingRight: 8, backgroundColor: sel === i ? l.color + '2A' : 'transparent', borderLeftWidth: 3, borderLeftColor: sel === i ? l.color : 'transparent' }}
          >
            <T style={{ fontFamily: fonts.mono, fontSize: size - 2, width: 22, textAlign: 'right', marginRight: 8 }} color={dk.faint}>{i + 1}</T>
            <View style={{ flex: 1 }}><HiLine code={l.code} size={size} /></View>
          </Pressable>
        ))}
      </View>
      <Animated.View key={sel} entering={FadeIn.duration(200)} style={{ borderLeftWidth: 4, borderLeftColor: p.color, paddingLeft: 12, gap: 2, minHeight: 64 }}>
        <T v="h3" color={p.color}>{p.title}</T>
        <T v="small" color={colors.text}>{p.desc}</T>
      </Animated.View>
    </View>
  );
}

export interface OutLine {
  t: string;
  c?: string;
}
/** Salida de consola: caja oscura con altura mínima para que no salte el layout. */
export function Console({ lines, minLines = 2, size = 12, title }: { lines: OutLine[]; minLines?: number; size?: number; title?: string }) {
  const lh = Math.round(size * 1.55);
  return (
    <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, paddingHorizontal: 10, paddingVertical: 8, minHeight: minLines * lh + 16 }}>
      {title ? <T style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 14 }} color={dk.faint}>{title}</T> : null}
      {lines.map((l, i) => (
        <Animated.View key={i + l.t} entering={FadeIn.duration(180)}>
          <T style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: lh }} color={l.c ?? dk.termText}>{l.t || ' '}</T>
        </Animated.View>
      ))}
    </View>
  );
}

// ───────────────────────── pasos ─────────────────────────

export function useSteps(n: number, ms = 2200, loop = false) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return undefined;
    const id = setTimeout(() => {
      if (i >= n - 1) {
        if (loop) setI(0);
        else setAuto(false);
      } else setI(i + 1);
    }, ms);
    return () => clearTimeout(id);
  }, [auto, i, n, ms, loop]);
  const go = useCallback((k: number) => { setAuto(false); setI(Math.max(0, Math.min(n - 1, k))); }, [n]);
  const toggle = useCallback(() => {
    setAuto((a) => {
      if (!a && i >= n - 1) setI(0);
      return !a;
    });
  }, [i, n]);
  const reset = useCallback(() => { setAuto(false); setI(0); }, []);
  return { i, go, auto, toggle, reset };
}

/** Barra de pasos: ◀  [progreso]  ▶ Auto  ▶. */
export function StepBar({ i, n, go, auto, toggle, color, hint, label }: { i: number; n: number; go: (k: number) => void; auto: boolean; toggle: () => void; color?: string; hint?: boolean; label?: string }) {
  const c = color ?? pyHue().a;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Btn label="◀" a11y="Paso anterior" onPress={() => go(i - 1)} disabled={i === 0} />
      <View style={{ flex: 1, gap: 4 }}>
        <T v="tiny" bold color={colors.dim} center>{label ?? `Paso ${i + 1} de ${n}`}</T>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
          <View style={{ width: `${((i + 1) / n) * 100}%`, height: 6, backgroundColor: c }} />
        </View>
      </View>
      <Btn label={auto ? '⏸' : '▶ Auto'} a11y={auto ? 'Pausar la reproducción' : 'Reproducir automáticamente'} onPress={toggle} w={auto ? 44 : 84} />
      <Pulse active={!!hint && i === 0 && !auto}>
        <Btn label="▶" a11y="Paso siguiente" onPress={() => go(i + 1)} disabled={i === n - 1} solid color={c} />
      </Pulse>
    </View>
  );
}

// ───────────────────────── control deslizante ─────────────────────────

export function Slider({ min, max, value, onChange, color, label, format }: { min: number; max: number; value: number; onChange: (v: number) => void; color?: string; label: string; format?: (v: number) => string }) {
  const c = color ?? pyHue().a;
  const [w, setW] = useState(240);
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const left = useRef(0);
  const latest = useRef({ w, min, max, value, onChange });
  latest.current = { w, min, max, value, onChange };
  const setFrom = useCallback((pageX: number) => {
    const L = latest.current;
    const k = Math.max(0, Math.min(1, (pageX - left.current - 14) / Math.max(1, L.w - 28)));
    const v = Math.round(L.min + k * (L.max - L.min));
    if (v !== L.value) {
      select();
      L.onChange(v);
    }
  }, []);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const px = e.nativeEvent.pageX;
        ref.current?.measureInWindow((x: number) => {
          left.current = x;
          setFrom(px);
        });
      },
      onPanResponderMove: (_e, g) => setFrom(g.moveX),
    }),
  ).current;
  const k = (value - min) / (max - min);
  const x = 14 + k * (w - 28);
  const dec = () => { if (value > min) { select(); onChange(value - 1); } };
  const inc = () => { if (value < max) { select(); onChange(value + 1); } };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Btn label="−" a11y={`${label}: menos`} onPress={dec} disabled={value <= min} w={40} />
      <View
        ref={ref}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: format ? format(value) : String(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? inc() : dec())}
        style={{ flex: 1, height: 44, justifyContent: 'center' }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={{ height: 8, borderRadius: 4, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line }}>
          <View style={{ width: x, height: 6, borderRadius: 3, backgroundColor: c }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: x - 14, top: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.card, borderWidth: 3, borderColor: c, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 11, lineHeight: 14 }} color={colors.text}>{format ? format(value) : value}</T>
        </View>
      </View>
      <Btn label="+" a11y={`${label}: más`} onPress={inc} disabled={value >= max} w={40} />
    </View>
  );
}

// ───────────────────────── tablero de etiquetas y objetos ─────────────────────────

export const ROW_H = 84;
export type Slot = 'c' | 'u' | 'd';
export interface BoardObj {
  id: string;
  row: number;
  show: boolean;
  kind: string;
  ref: string;
  text?: string;
  items?: string[];
  /** Celda de la lista que acaba de añadirse (se resalta). */
  fresh?: number;
  color: string;
}
export interface BoardLabel {
  name: string;
  color: string;
  at: { row: number; slot: Slot } | null;
}

function labelY(at: { row: number; slot: Slot }): number {
  return at.row * ROW_H + ROW_H / 2 + (at.slot === 'c' ? 0 : at.slot === 'u' ? -17 : 17) - 15;
}

function BoardTag({ lb, objW }: { lb: BoardLabel; objW: number }) {
  const at = lb.at;
  const ty = useSharedValue(at ? labelY(at) : 0);
  const op = useSharedValue(at ? 1 : 0);
  const was = useRef(!!at);
  const key = at ? `${at.row}${at.slot}` : 'x';
  useEffect(() => {
    if (at) {
      const y = labelY(at);
      if (!was.current) {
        ty.value = y - 28;
        op.value = 0;
      }
      ty.value = withSpring(y, { damping: 15, stiffness: 120 });
      op.value = withTiming(1, { duration: 260 });
    } else {
      op.value = withTiming(0, { duration: 200 });
    }
    was.current = !!at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const st = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: ty.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, right: objW, height: 30, flexDirection: 'row', alignItems: 'center' }, st]}>
      <View style={{ minWidth: 46, height: 30, paddingHorizontal: 10, borderTopLeftRadius: 15, borderBottomLeftRadius: 15, borderTopRightRadius: 6, borderBottomRightRadius: 6, backgroundColor: lb.color, alignItems: 'center', justifyContent: 'center' }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 15, lineHeight: 20 }} color={onColor(lb.color)}>{lb.name}</T>
      </View>
      <View style={{ flex: 1, height: 2.5, backgroundColor: lb.color, marginLeft: -1 }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 9, borderTopWidth: 6, borderBottomWidth: 6, borderLeftColor: lb.color, borderTopColor: 'transparent', borderBottomColor: 'transparent', marginRight: 4 }} />
    </Animated.View>
  );
}

/** Objetos a la derecha y etiquetas que apuntan a ellos desde la izquierda. Las etiquetas se mueven con un muelle. */
export function LabelBoard({ rows, objs, labels, objW = 150 }: { rows: number; objs: BoardObj[]; labels: BoardLabel[]; objW?: number }) {
  return (
    <View style={{ height: rows * ROW_H }}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={{ position: 'absolute', left: 0, right: 0, top: r * ROW_H + ROW_H - 1, height: 1, backgroundColor: r === rows - 1 ? 'transparent' : colors.line, opacity: 0.6 }} />
      ))}
      {objs.map((o) => (
        o.show ? (
          <Animated.View key={o.id} entering={ZoomIn.duration(280)} style={{ position: 'absolute', right: 0, width: objW, top: o.row * ROW_H + 8, height: ROW_H - 16, borderRadius: 14, borderWidth: 2, borderColor: o.color, backgroundColor: o.color + '1C', paddingHorizontal: 8, justifyContent: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 14 }} color={colors.dim}>{o.kind}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 11, lineHeight: 14 }} color={colors.dim}>{o.ref}</T>
            </View>
            {o.items ? (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {o.items.map((it, k) => (
                  <Animated.View key={k + it} entering={ZoomIn.duration(300)} style={{ width: 34, height: 34, borderRadius: 8, borderWidth: 2, borderColor: o.fresh === k ? colors.amber : o.color, backgroundColor: o.fresh === k ? colors.amber + '40' : colors.card, alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ fontFamily: fonts.monoBold, fontSize: 15, lineHeight: 20 }} color={colors.text}>{it}</T>
                  </Animated.View>
                ))}
              </View>
            ) : (
              <T style={{ fontFamily: fonts.monoBold, fontSize: 22, lineHeight: 28 }} color={colors.text} numberOfLines={1}>{o.text}</T>
            )}
          </Animated.View>
        ) : null
      ))}
      {labels.map((l) => <BoardTag key={l.name} lb={l} objW={objW} />)}
    </View>
  );
}
