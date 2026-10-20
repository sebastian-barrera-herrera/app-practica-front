import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { celebrate } from '@/lib/haptics';
import { colors } from './theme';

const palette = () => [colors.mint, colors.cyan, colors.amber, colors.rose, colors.violet, colors.orange];

function Piece({ i, w, h }: { i: number; w: number; h: number }) {
  const t = useSharedValue(0);
  const cfg = useMemo(() => {
    const pal = palette();
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    return { x: r(1) * w, drift: (r(2) - 0.5) * 120, delay: r(3) * 500, dur: 1800 + r(4) * 1400, size: 6 + r(5) * 8, color: pal[i % pal.length], rot: (r(6) - 0.5) * 900 };
  }, [i, w]);
  useEffect(() => {
    t.value = withDelay(cfg.delay, withTiming(1, { duration: cfg.dur, easing: Easing.in(Easing.quad) }));
  }, [cfg, t]);
  const a = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, (t.value - 0.8) * 5),
    transform: [{ translateX: cfg.drift * t.value }, { translateY: -40 + (h + 60) * t.value }, { rotate: `${cfg.rot * t.value}deg` }],
  }));
  return <Animated.View style={[{ position: 'absolute', left: cfg.x, top: 0, width: cfg.size, height: cfg.size * 1.6, borderRadius: 2, backgroundColor: cfg.color }, a]} />;
}

export function Confetti({ count = 46 }: { count?: number }) {
  const { width, height } = Dimensions.get('window');
  // el confeti viene siempre con una vibración de celebración
  useEffect(() => {
    celebrate();
  }, []);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => (
        <Piece key={i} i={i} w={width} h={height} />
      ))}
    </View>
  );
}
