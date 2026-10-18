import React from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { Achievement } from '@/game/achievements';
import { Button } from './Button';
import { Card } from './Card';
import { Confetti } from './Confetti';
import { Mascot, type Mood } from './Mascot';
import { T } from './Text';
import { colors } from './theme';

export interface SummaryRow {
  label: string;
  value: string;
  color?: string;
}

export interface Mistake {
  q: string;
  correct?: string | null;
  why: string;
}

export function SessionSummary({ title, subtitle, mood, big, rows, xp, achievements, mistakes, levelUp, confetti, actions }: { title: string; subtitle?: string; mood: Mood; big?: string; rows: SummaryRow[]; xp?: number; achievements?: Achievement[]; mistakes?: Mistake[]; levelUp?: number | null; confetti?: boolean; actions: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost' }[] }) {
  return (
    <View style={{ flex: 1 }}>
      {confetti && <Confetti />}
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
        <Mascot size={120} mood={mood} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <T v="title" center>{title}</T>
          {subtitle ? <T color={colors.dim} center>{subtitle}</T> : null}
        </View>
        {big ? <T style={{ fontSize: 56, lineHeight: 62 }} bold color={colors.mint}>{big}</T> : null}
        <Card style={{ alignSelf: 'stretch' }}>
          <View style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <Animated.View key={i} entering={FadeInDown.delay(150 + i * 80)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="small" color={colors.dim}>{r.label}</T>
                <T v="small" bold color={r.color ?? colors.text}>{r.value}</T>
              </Animated.View>
            ))}
            {xp !== undefined && (
              <>
                <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 4 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T v="h3">XP ganada</T>
                  <T v="h3" color={colors.amber}>+{xp}</T>
                </View>
              </>
            )}
          </View>
        </Card>
        {levelUp ? (
          <Card accent={colors.violet} style={{ alignSelf: 'stretch' }}>
            <T v="h3" color={colors.violet} center>⬆️ ¡Subes al nivel {levelUp}!</T>
          </Card>
        ) : null}
        {achievements && achievements.length > 0 && (
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <T v="label" color={colors.dim}>Logros desbloqueados</T>
            {achievements.map((a) => (
              <Card key={a.id} accent={colors.amber}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <T style={{ fontSize: 28 }}>{a.emoji}</T>
                  <View style={{ flex: 1 }}>
                    <T v="h3">{a.title}</T>
                    <T v="tiny" color={colors.dim}>{a.desc}</T>
                  </View>
                  <T v="small" bold color={colors.amber}>+{a.xp}</T>
                </View>
              </Card>
            ))}
          </View>
        )}
        {mistakes && mistakes.length > 0 && (
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <T v="label" color={colors.dim}>A repasar ({mistakes.length})</T>
            {mistakes.map((m, i) => (
              <Card key={i} accent={colors.rose}>
                <T v="small" bold>{m.q.replace(/`/g, '')}</T>
                {m.correct ? <T v="small" color={colors.green}>✓ {m.correct.replace(/`/g, '')}</T> : null}
                <T v="tiny" color={colors.dim}>{m.why.replace(/`/g, '')}</T>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
      <View style={{ padding: 16, gap: 8 }}>
        {actions.map((a, i) => (
          <Button key={i} label={a.label} kind={a.kind ?? 'primary'} onPress={a.onPress} />
        ))}
      </View>
    </View>
  );
}
