import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { Button } from '@/ui/Button';
import { OnDark, T } from '@/ui/Text';
import { colors, fonts } from '@/ui/theme';
import { Frame } from './common';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const NODES: Record<string, { x: number; y: number; label: string }> = {
  '/': { x: 150, y: 24, label: '/' },
  '/home': { x: 70, y: 84, label: 'home' },
  '/var': { x: 235, y: 84, label: 'var' },
  '/home/alumno': { x: 70, y: 144, label: 'alumno' },
  '/var/log': { x: 235, y: 144, label: 'log' },
  '/home/alumno/Documents': { x: 22, y: 204, label: 'Documents' },
  '/home/alumno/Pictures': { x: 118, y: 204, label: 'Pictures' },
};
const EDGES: [string, string][] = [['/', '/home'], ['/', '/var'], ['/home', '/home/alumno'], ['/var', '/var/log'], ['/home/alumno', '/home/alumno/Documents'], ['/home/alumno', '/home/alumno/Pictures']];

const STEPS: { cmd: string; to: string; note: string }[] = [
  { cmd: 'cd /var/log', to: '/var/log', note: 'Ruta absoluta: salta directo, desde donde sea.' },
  { cmd: 'cd ..', to: '/var', note: '.. sube un nivel hacia la raíz.' },
  { cmd: 'cd ~', to: '/home/alumno', note: '~ es tu carpeta personal.' },
  { cmd: 'cd Documents', to: '/home/alumno/Documents', note: 'Ruta relativa: se cuenta desde donde estás.' },
  { cmd: 'cd ../Pictures', to: '/home/alumno/Pictures', note: 'Sube y baja a una carpeta vecina.' },
];

export function PathWalk() {
  const [i, setI] = useState(-1);
  const cur = i < 0 ? '/home/alumno' : STEPS[i].to;
  const x = useSharedValue(NODES['/home/alumno'].x);
  const y = useSharedValue(NODES['/home/alumno'].y);
  useEffect(() => {
    x.value = withSpring(NODES[cur].x, { damping: 14, stiffness: 110 });
    y.value = withSpring(NODES[cur].y, { damping: 14, stiffness: 110 });
  }, [cur, x, y]);
  const props = useAnimatedProps(() => ({ cx: x.value, cy: y.value }));
  return (
    <Frame title="Camina por el árbol">
      <Svg width="100%" height={236} viewBox="0 0 300 236">
        {EDGES.map(([a, b]) => (
          <Line key={a + b} x1={NODES[a].x} y1={NODES[a].y + 10} x2={NODES[b].x} y2={NODES[b].y - 10} stroke={colors.line} strokeWidth={2} />
        ))}
        {Object.entries(NODES).map(([p, n]) => (
          <G key={p}>
            <Rect x={n.x - 30} y={n.y - 11} width={60} height={22} rx={7} fill={cur === p ? colors.mint + '33' : colors.card2} stroke={cur === p ? colors.mint : colors.line} strokeWidth={cur === p ? 2 : 1} />
            <SvgText x={n.x} y={n.y + 4} fontSize={n.label.length > 8 ? 9.5 : 11} fontFamily={fonts.monoBold} fill={cur === p ? colors.mint : colors.text} textAnchor="middle">{n.label}</SvgText>
          </G>
        ))}
        <AnimatedCircle animatedProps={props} r={7} fill={colors.amber} stroke="#fff" strokeWidth={1.5} />
      </Svg>
      <View style={{ backgroundColor: colors.termBg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.line }}>
        <OnDark>
          <T style={{ fontFamily: fonts.mono, fontSize: 13 }} color={colors.dim}>$ pwd</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={colors.mint}>{cur}</T>
        </OnDark>
      </View>
      {i >= 0 && <T v="small" color={colors.cyan}>{STEPS[i].note}</T>}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}>
          <Button kind="accent" small label={i + 1 >= STEPS.length ? '↺ Empezar de nuevo' : `▶  ${STEPS[i + 1].cmd}`} onPress={() => setI((n) => (n + 1 >= STEPS.length ? -1 : n + 1))} />
        </View>
      </View>
    </Frame>
  );
}
