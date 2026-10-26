/** Piezas comunes de las ilustraciones de AWS. */
import React from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { courseColor, courseColor2 } from '@/ui/courseColors';
import { T } from '@/ui/Text';
import { colors, darkColors, fonts, radius } from '@/ui/theme';

export const dk = darkColors;

/** Colores de AWS según el tema activo. Llamar siempre dentro de un render. */
export const awsHue = () => ({ a: courseColor('aws'), b: courseColor2('aws') });

/** Etiqueta pequeña de color (un servicio, un estado). */
export function Pill({ text, color, solid, dim, size = 12 }: { text: string; color: string; solid?: boolean; dim?: boolean; size?: number }) {
  return (
    <Animated.View entering={ZoomIn.duration(200)} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: solid ? color : color + '26', borderWidth: 1, borderColor: color, opacity: dim ? 0.35 : 1, alignSelf: 'flex-start' }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: size, lineHeight: size + 5 }} color={solid ? '#0B0B14' : colors.text}>{text}</T>
    </Animated.View>
  );
}

/** Caja con título para agrupar (una región, una cuenta, una VPC…). */
export function Zone({ title, color, children, dashed, dim, style }: { title: string; color: string; children?: React.ReactNode; dashed?: boolean; dim?: boolean; style?: object }) {
  return (
    <View style={[{ borderWidth: 2, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid', borderRadius: radius.md, padding: 8, gap: 6, backgroundColor: color + '12', opacity: dim ? 0.4 : 1 }, style]}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5, lineHeight: 15 }} color={color}>{title}</T>
      {children}
    </View>
  );
}

/** Aviso con el color de AWS. */
export function Note({ children, color, min }: { children: React.ReactNode; color?: string; min?: number }) {
  return (
    <View style={{ borderLeftWidth: 4, borderLeftColor: color ?? awsHue().a, paddingLeft: 12, paddingVertical: 4, minHeight: min }}>
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

/** Una fila de «capa» (para pilas de responsabilidad, etc.). */
export function Layer({ label, owner, color, hint }: { label: string; owner: string; color: string; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: color + '26', borderWidth: 1, borderColor: color }}>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, lineHeight: 17 }} color={colors.text}>{label}</T>
        {hint ? <T v="tiny" color={colors.dim}>{hint}</T> : null}
      </View>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 11 }} color={color}>{owner}</T>
    </View>
  );
}
