import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';

const LAYERS = [
  { emoji: '🧑', title: 'Tú', sub: 'escribes: ls', get color() { return colors.mint; } },
  { emoji: '🖥️', title: 'Terminal', sub: 'la ventana con teclado y pantalla', get color() { return colors.cyan; } },
  { emoji: '🐚', title: 'Shell (bash)', sub: 'interpreta lo que escribes', get color() { return colors.violet; } },
  { emoji: '🧠', title: 'Kernel (Linux)', sub: 'manda sobre el hardware', get color() { return colors.amber; } },
  { emoji: '💾', title: 'Hardware', sub: 'CPU · memoria · disco', get color() { return colors.rose; } },
];

export function ShellVsKernel() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withSequence(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.quad) })), -1);
  }, [p]);
  const rowH = 62;
  const gap = 10;
  const total = LAYERS.length * rowH + (LAYERS.length - 1) * gap;
  const dot = useAnimatedStyle(() => ({ transform: [{ translateY: p.value * (total - 26) }], opacity: 0.95 }));
  return (
    <Frame title="Las capas de Linux">
      <View style={{ height: total }}>
        <View style={{ gap }}>
          {LAYERS.map((l, i) => (
            <View key={i} style={{ height: rowH, borderRadius: radius.md, borderWidth: 2, borderColor: l.color + '99', backgroundColor: l.color + '14', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12 }}>
              <T style={{ fontSize: 26 }}>{l.emoji}</T>
              <View style={{ flex: 1 }}>
                <T v="h3" color={l.color}>{l.title}</T>
                <T v="tiny" color={colors.dim}>{l.sub}</T>
              </View>
            </View>
          ))}
        </View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 14, top: 0, width: 54, height: 26, borderRadius: 13, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }, dot]}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color="#04120D">ls</T>
        </Animated.View>
      </View>
      <T v="small" color={colors.dim}>La orden baja por las capas y la respuesta sube. Cada capa solo habla con la de al lado.</T>
    </Frame>
  );
}
