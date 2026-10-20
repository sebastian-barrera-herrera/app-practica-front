import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { OnDark, T } from '@/ui/Text';
import { colors, fonts } from '@/ui/theme';
import { Frame } from './common';

const PARTS = [
  { t: 'alumno', get color() { return colors.mint; }, title: 'Usuario', desc: 'La persona con la que trabajas. Cambia si usas su o sudo.' },
  { t: '@', get color() { return colors.faint; }, title: 'Arroba', desc: 'Separa el usuario del equipo: «usuario en equipo».' },
  { t: 'dojo', get color() { return colors.mint; }, title: 'Equipo (hostname)', desc: 'El nombre de esta máquina. Muy útil cuando te conectas a varios servidores.' },
  { t: ':', get color() { return colors.faint; }, title: 'Dos puntos', desc: 'Separa el equipo de la carpeta actual.' },
  { t: '~/proyectos', get color() { return colors.cyan; }, title: 'Carpeta actual', desc: '~ es tu carpeta personal. Aquí estás dentro de «proyectos».' },
  { t: '$', get color() { return colors.amber; }, title: 'Símbolo de prompt', desc: '$ = usuario normal. Si ves # eres root (¡cuidado!).' },
  { t: ' ls', get color() { return colors.text; }, title: 'Comando', desc: 'Lo que quieres ejecutar. Siempre es la primera palabra.' },
  { t: ' -l', get color() { return colors.violet; }, title: 'Opción', desc: 'Modifica el comportamiento. Suelen empezar por guion.' },
  { t: ' /etc', get color() { return colors.rose; }, title: 'Argumento', desc: 'Sobre qué actúa el comando: un archivo, una carpeta, un texto…' },
];

export function TerminalAnatomy() {
  const [sel, setSel] = useState(0);
  const p = PARTS[sel];
  return (
    <Frame title="Toca cada parte">
      <View style={{ backgroundColor: colors.termBg, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line }}>
        <OnDark>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PARTS.map((x, i) => (
            <Pressable key={i} onPress={() => { tap(); setSel(i); }}>
              <T style={{ fontFamily: sel === i ? fonts.monoBold : fonts.mono, fontSize: 18, backgroundColor: sel === i ? x.color + '33' : 'transparent', textDecorationLine: sel === i ? 'underline' : 'none' }} color={x.color}>{x.t}</T>
            </Pressable>
          ))}
        </View>
        </OnDark>
      </View>
      <Animated.View key={sel} entering={FadeIn.duration(220)} style={{ borderLeftWidth: 4, borderLeftColor: p.color, paddingLeft: 12, gap: 2 }}>
        <T v="h3" color={p.color}>{p.title}</T>
        <T v="small" color={colors.text}>{p.desc}</T>
      </Animated.View>
    </Frame>
  );
}
