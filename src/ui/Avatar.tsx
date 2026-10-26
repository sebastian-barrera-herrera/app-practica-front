import React, { useEffect, useId } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { cosmeticById, resolveLook } from '@/game/cosmetics';
import { defaultLook, type Look } from '@/game/economy';
import { useGame } from '@/game/store';
import { Mascot, type Mood } from './Mascot';

/** Colores de un cosmético para un degradado (si solo hay uno se duplica). */
const stops = (cols: string[] | undefined, fallback: string[]): string[] => {
  const c = cols && cols.length ? cols : fallback;
  return c.length === 1 ? [c[0], c[0]] : c;
};

/**
 * El avatar del perfil: fondo + personaje + accesorio + marco.
 * Sin `look` dibuja el del jugador; con `look` (parcial) se sobrescribe, útil para probar un objeto antes de comprarlo.
 */
export function Avatar({ size = 80, look, mood = 'happy', animated = true }: { size?: number; look?: Partial<Look>; mood?: Mood; animated?: boolean }) {
  const mine = useGame((s) => s.extras);
  const base = resolveLook(mine);
  const L: Look = { ...defaultLook(), ...base, ...look };
  const rid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const av = cosmeticById('avatar', L.avatar) ?? cosmeticById('avatar', 'penguin')!;
  const fr = cosmeticById('frame', L.frame);
  const bgc = cosmeticById('bg', L.bg);
  const ac = cosmeticById('acc', L.acc);
  const fw = Math.max(2.5, size * 0.055);
  const r = size / 2;
  const spin = useSharedValue(0);
  const spinning = !!fr?.spin && animated;
  useEffect(() => {
    if (spinning) spin.value = withRepeat(withTiming(360, { duration: 6000, easing: Easing.linear }), -1);
    else spin.value = 0;
  }, [spinning, spin]);
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const bgStops = stops(bgc?.colors, ['#1E2A55', '#141B3A']);
  const frStops = stops(fr?.colors, []);
  const hasFrame = !!fr && fr.id !== 'none' && frStops.length > 0;
  const gId = `bg${rid}`;
  const fId = `fr${rid}`;
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`Avatar: ${av.name}`} accessibilityRole="image">
      {/* fondo */}
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gId} x1="0" y1="0" x2="1" y2="1">
            {bgStops.map((c, i) => <Stop key={i} offset={bgStops.length === 1 ? 0 : i / (bgStops.length - 1)} stopColor={c} />)}
          </LinearGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r - fw / 2} fill={`url(#${gId})`} />
      </Svg>
      {/* personaje */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: r }}>
        {av.id === 'penguin' ? (
          <View style={{ marginTop: size * 0.04 }}>
            <Mascot size={size * 0.92} mood={mood} bob={false} />
          </View>
        ) : (
          <Text allowFontScaling={false} style={{ fontSize: size * 0.56, lineHeight: size * 0.74, textAlign: 'center', includeFontPadding: false }}>{av.emoji}</Text>
        )}
      </View>
      {/* accesorio */}
      {ac && ac.id !== 'none' ? (
        <Text
          allowFontScaling={false}
          style={{
            position: 'absolute',
            includeFontPadding: false,
            textAlign: 'center',
            fontSize: ac.place === 'corner' ? size * 0.3 : ac.place === 'eyes' ? size * 0.4 : size * 0.38,
            lineHeight: ac.place === 'corner' ? size * 0.4 : size * 0.5,
            ...(ac.place === 'corner' ? { right: -size * 0.02, top: -size * 0.04 } : ac.place === 'eyes' ? { left: 0, right: 0, top: size * 0.27 } : { left: 0, right: 0, top: -size * 0.1 }),
          }}
        >
          {ac.emoji}
        </Text>
      ) : null}
      {/* marco */}
      {hasFrame ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, ring]}>
          <Svg width={size} height={size}>
            <Defs>
              <LinearGradient id={fId} x1="0" y1="0" x2="1" y2="1">
                {frStops.map((c, i) => <Stop key={i} offset={frStops.length === 1 ? 0 : i / (frStops.length - 1)} stopColor={c} />)}
              </LinearGradient>
            </Defs>
            {/* el resplandor se dibuja hacia dentro para que no se recorte en el borde */}
            {fr?.glow ? <Circle cx={r} cy={r} r={r - fw * 1.1} fill="none" stroke={`url(#${fId})`} strokeWidth={fw * 2.2} strokeOpacity={0.3} /> : null}
            <Circle cx={r} cy={r} r={r - fw / 2} fill="none" stroke={`url(#${fId})`} strokeWidth={fw} />
          </Svg>
        </Animated.View>
      ) : (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: r, borderWidth: Math.max(1.5, size * 0.025), borderColor: 'rgba(255,255,255,0.18)' }} />
      )}
    </View>
  );
}
