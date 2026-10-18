import React, { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { colors } from './theme';

export function ProgressBar({ value, color = colors.mint, height = 10, style, track = colors.card2 }: { value: number; color?: string; height?: number; style?: ViewStyle; track?: string }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, value)), { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [value, w]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={[{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }, style]}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, a]}>
        <View style={{ position: 'absolute', top: 2, left: 6, right: 6, height: height / 4, borderRadius: height, backgroundColor: 'rgba(255,255,255,0.25)' }} />
      </Animated.View>
    </View>
  );
}
