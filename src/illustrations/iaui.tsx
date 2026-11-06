/** Piezas comunes de las ilustraciones del curso de IA. */
import React from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { AxSpec, FigSpec, Series } from '@/lib/figure';
import { courseColor, courseColor2 } from '@/ui/courseColors';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';

export { Stepper, Pill, Explain, Toggle, Zone } from './awsui';
export { Frame, Chips } from './common';
export { Tabs, Tag } from './pyui';

/** Colores del curso según el tema activo. Llamar siempre dentro de un render. */
export const iaHue = () => ({ a: courseColor('ia'), b: courseColor2('ia') });

/** Barra horizontal con etiqueta y valor (0–1). */
export function Meter({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T v="tiny" color={colors.dim}>{label}</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={color}>{suffix ?? `${Math.round(v * 100)} %`}</T>
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.line, overflow: 'hidden' }}>
        <View style={{ width: `${v * 100}%`, height: '100%', backgroundColor: color, borderRadius: 5 }} />
      </View>
    </View>
  );
}

/** Aviso lateral. */
export function Callout({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={{ borderLeftWidth: 4, borderLeftColor: color ?? iaHue().a, paddingLeft: 12, paddingVertical: 4 }}>
      <T v="small" color={colors.text}>{children}</T>
    </Animated.View>
  );
}

/** Fila «etiqueta: valor». */
export function Row({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5, width: 76 }} color={color ?? colors.dim}>{label}</T>
      <T v="small" color={colors.text} style={{ flex: 1 }}>{children}</T>
    </View>
  );
}

export const Card2 = ({ children, color }: { children: React.ReactNode; color: string }) => (
  <View style={{ borderWidth: 1.5, borderColor: color, backgroundColor: color + '14', borderRadius: radius.md, padding: 10, gap: 6 }}>{children}</View>
);

// ───────────────────────── figuras como datos ─────────────────────────

/** Ejes con valores por defecto. */
export function axes(series: Series[], o: Partial<AxSpec> = {}): AxSpec {
  return {
    pos: [0, 0, 1, 1], title: '', xlabel: '', ylabel: '', xlim: null, ylim: null, grid: true, legend: false, equal: false, off: false,
    xscale: 'linear', yscale: 'linear', xticks: null, xticklabels: null, yticks: null, yticklabels: null, series, ...o,
  };
}

/** JSON de una figura de un solo eje, listo para `<FigureView json={…} />`. */
export function figJson(ax: AxSpec | AxSpec[], o: { w?: number; h?: number; title?: string } = {}): string {
  const f: FigSpec = { w: o.w ?? 6, h: o.h ?? 3.4, title: o.title ?? '', axes: Array.isArray(ax) ? ax : [ax] };
  return JSON.stringify(f);
}
