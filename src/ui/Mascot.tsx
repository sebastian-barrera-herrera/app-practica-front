import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';

export type Mood = 'happy' | 'think' | 'cheer' | 'oops' | 'cool';

/** Pingüi, el sensei del dojo. */
export function Mascot({ size = 120, mood = 'happy', bob = true }: { size?: number; mood?: Mood; bob?: boolean }) {
  const y = useSharedValue(0);
  const blink = useSharedValue(1);
  useEffect(() => {
    if (bob) y.value = withRepeat(withSequence(withTiming(-5, { duration: 900, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })), -1);
    blink.value = withRepeat(withSequence(withDelay(2600, withTiming(0.1, { duration: 90 })), withTiming(1, { duration: 110 })), -1);
  }, [bob, y, blink]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));
  void eyeStyle;
  const cheer = mood === 'cheer';
  const oops = mood === 'oops';
  return (
    <Animated.View style={[{ width: size, height: size }, a]}>
      <Svg width={size} height={size} viewBox="0 0 160 160">
        {/* sombra */}
        <Ellipse cx="80" cy="152" rx="44" ry="6" fill="rgba(0,0,0,0.3)" />
        {/* alas */}
        <G rotation={cheer ? -35 : 18} origin="38, 92"><Ellipse cx="36" cy="100" rx="10" ry="28" fill="#17224A" /></G>
        <G rotation={cheer ? 35 : -18} origin="122, 92"><Ellipse cx="124" cy="100" rx="10" ry="28" fill="#17224A" /></G>
        {/* cuerpo */}
        <Ellipse cx="80" cy="98" rx="46" ry="50" fill="#1E2A55" />
        <Ellipse cx="80" cy="106" rx="31" ry="38" fill="#F4F7FF" />
        {/* prompt en la barriga */}
        <SvgText x="80" y="116" fontSize="22" fontWeight="bold" fill="#0E8F70" textAnchor="middle" fontFamily="monospace">{'>_'}</SvgText>
        {/* cabeza */}
        <Circle cx="80" cy="54" r="34" fill="#1E2A55" />
        <Ellipse cx="80" cy="60" rx="24" ry="20" fill="#F4F7FF" />
        {/* cinta del dojo */}
        <Path d="M46 40 Q80 22 114 40 L114 49 Q80 31 46 49 Z" fill="#FB7185" />
        <Path d="M112 42 L128 36 L124 46 L134 52 L118 50 Z" fill="#FB7185" />
        {/* ojos */}
        {oops ? (
          <>
            <Path d="M60 52 L70 58 M70 52 L60 58" stroke="#0B1020" strokeWidth="3" strokeLinecap="round" />
            <Path d="M90 52 L100 58 M100 52 L90 58" stroke="#0B1020" strokeWidth="3" strokeLinecap="round" />
          </>
        ) : mood === 'cool' ? (
          <Path d="M56 50 H104 V58 Q104 64 98 64 H88 Q82 64 82 58 H78 Q78 64 72 64 H62 Q56 64 56 58 Z" fill="#0B1020" />
        ) : (
          <>
            <Ellipse cx="68" cy="55" rx="6" ry="7" fill="#fff" />
            <Ellipse cx="92" cy="55" rx="6" ry="7" fill="#fff" />
            <Circle cx={mood === 'think' ? 70 : 69} cy={mood === 'think' ? 53 : 56} r="3.2" fill="#0B1020" />
            <Circle cx={mood === 'think' ? 94 : 93} cy={mood === 'think' ? 53 : 56} r="3.2" fill="#0B1020" />
            <Circle cx="70" cy="54" r="1" fill="#fff" />
            <Circle cx="94" cy="54" r="1" fill="#fff" />
          </>
        )}
        {mood === 'think' && <Path d="M86 44 Q94 40 100 44" stroke="#0B1020" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
        {/* mejillas */}
        <Circle cx="58" cy="66" r="4.5" fill="#FB7185" opacity="0.45" />
        <Circle cx="102" cy="66" r="4.5" fill="#FB7185" opacity="0.45" />
        {/* pico */}
        <Path d="M71 63 Q80 57 89 63 Q80 76 71 63 Z" fill="#FBBF24" />
        {mood === 'happy' || mood === 'cheer' || mood === 'cool' ? <Path d="M74 68 Q80 74 86 68" stroke="#B7791F" strokeWidth="2" fill="none" strokeLinecap="round" /> : null}
        {oops && <Path d="M74 71 Q80 66 86 71" stroke="#B7791F" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {/* pies */}
        <Ellipse cx="62" cy="146" rx="15" ry="6" fill="#FBBF24" />
        <Ellipse cx="98" cy="146" rx="15" ry="6" fill="#FBBF24" />
        {cheer && (
          <>
            <Rect x="8" y="26" width="6" height="6" fill="#22D3A6" rotation="20" origin="11, 29" />
            <Rect x="146" y="34" width="6" height="6" fill="#FBBF24" rotation="-20" origin="149, 37" />
            <Circle cx="22" cy="60" r="3" fill="#38BDF8" />
            <Circle cx="140" cy="68" r="3" fill="#FB7185" />
          </>
        )}
      </Svg>
    </Animated.View>
  );
}
