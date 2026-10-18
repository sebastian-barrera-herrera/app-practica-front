import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { levelProgress } from '@/game/xp';
import { streakAlive } from '@/game/streak';
import { useGame } from '@/game/store';
import { todayXp } from '@/game/progress';
import { ProgressBar } from './ProgressBar';
import { T } from './Text';
import { colors } from './theme';

export function DailyRing({ value, size = 44, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.card2} strokeWidth={5} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={v >= 1 ? colors.green : colors.amber} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      {children}
    </View>
  );
}

export function StatsHeader() {
  const xp = useGame((s) => s.xp);
  const streak = useGame((s) => s.streak);
  const goal = useGame((s) => s.settings.dailyGoal);
  const dailyXp = useGame((s) => s.dailyXp);
  const name = useGame((s) => s.settings.name);
  const now = Date.now();
  const lp = levelProgress(xp);
  const today = todayXp({ dailyXp } as never, now);
  const alive = streakAlive(streak, now);
  return (
    <View style={{ gap: 12, paddingTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="tiny" color={colors.dim}>{name ? `Hola, ${name}` : 'Bienvenido'}</T>
          <T v="h2">Nivel {lp.level} · {lp.title}</T>
        </View>
        <View style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 22, opacity: alive ? 1 : 0.35 }}>🔥</T>
          <T v="tiny" bold color={alive ? colors.orange : colors.faint}>{streak.current}</T>
        </View>
        <DailyRing value={today / goal}>
          <T v="tiny" bold color={colors.amber}>{Math.min(99, today)}</T>
        </DailyRing>
      </View>
      <View>
        <ProgressBar value={lp.pct} color={colors.cyan} height={9} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <T v="tiny" color={colors.dim}>{lp.into} / {lp.need} XP</T>
          <T v="tiny" color={colors.dim}>Meta de hoy: {today}/{goal}</T>
        </View>
      </View>
    </View>
  );
}
