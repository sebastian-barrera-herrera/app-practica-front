import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import type { Lesson } from '@/content/types';
import type { FinishOutcome } from '@/game/store';
import { levelReward } from '@/game/economy';
import { levelRank } from '@/game/xp';
import { success } from '@/lib/haptics';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { Confetti } from './Confetti';
import { Mascot } from './Mascot';
import { T } from './Text';
import { colors } from './theme';

export function LessonSummary({ lesson, outcome, hasNext, onNext, onBack }: { lesson: Lesson; outcome: FinishOutcome; hasNext: boolean; onNext: () => void; onBack: () => void }) {
  // con 2 o 3 estrellas vibra el confeti; con 1, un aviso de lección completada
  useEffect(() => {
    if (outcome.stars < 2) success();
  }, [outcome.stars]);
  return (
    <View style={{ flex: 1 }}>
      {outcome.stars >= 2 && <Confetti />}
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
        <Mascot size={130} mood={outcome.stars === 3 ? 'cheer' : outcome.stars === 2 ? 'happy' : 'think'} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <T v="title" center>{outcome.stars === 3 ? '¡Perfecto!' : outcome.stars === 2 ? '¡Muy bien!' : '¡Lección completada!'}</T>
          <T color={colors.dim} center>{lesson.emoji} {lesson.title}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[1, 2, 3].map((n) => (
            <Animated.View key={n} entering={ZoomIn.delay(200 + n * 200).springify()}>
              <T style={{ fontSize: 46, opacity: n <= outcome.stars ? 1 : 0.18 }}>⭐</T>
            </Animated.View>
          ))}
        </View>
        <Card style={{ alignSelf: 'stretch' }}>
          <View style={{ gap: 8 }}>
            {outcome.xp.parts.map((p, i) => (
              <Animated.View key={i} entering={FadeInDown.delay(300 + i * 90)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="small" color={colors.dim}>{p.label}</T>
                <T v="small" bold color={p.xp >= 0 ? colors.green : colors.rose}>{p.xp >= 0 ? '+' : ''}{p.xp} XP</T>
              </Animated.View>
            ))}
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="h3">Total</T>
              <T v="h3" color={colors.amber}>+{outcome.xp.total} XP</T>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="small" color={colors.dim}>Monedas</T>
              <T v="small" bold color={colors.amber}>+🪙 {outcome.coins}</T>
            </View>
            <T v="tiny" color={colors.dim}>Precisión: {Math.round(outcome.accuracy * 100)} %</T>
          </View>
        </Card>
        {outcome.levelUp && (
          <Card accent={colors.violet} style={{ alignSelf: 'stretch' }}>
            <T v="h3" color={colors.violet} center>⬆️ ¡Subes al nivel {outcome.levelUp}!</T>
            <T v="small" color={colors.dim} center>Ahora eres {levelRank(outcome.levelUp).emoji} «{levelRank(outcome.levelUp).title}» · +🪙 {levelReward(outcome.levelUp)}</T>
          </Card>
        )}
        {outcome.streak.current > 0 && (
          <Card accent={colors.orange} style={{ alignSelf: 'stretch' }}>
            <T v="h3" center color={colors.orange}>🔥 Racha: {outcome.streak.current} {outcome.streak.current === 1 ? 'día' : 'días'}</T>
            {outcome.usedFreeze && <T v="small" center color={colors.cyan}>🛡️ Un escudo salvó tu racha</T>}
          </Card>
        )}
        {outcome.newAchievements.length > 0 && (
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <T v="label" color={colors.dim}>Logros desbloqueados</T>
            {outcome.newAchievements.map((a) => (
              <Card key={a.id} accent={colors.amber}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <T style={{ fontSize: 30 }}>{a.emoji}</T>
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
        {lesson.commands.length > 0 && (
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <T v="label" color={colors.dim}>Comandos de esta lección</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {lesson.commands.map((c) => (
                <Chip key={c} label={c} mono color={colors.cyan} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      <View style={{ padding: 16, gap: 8 }}>
        {hasNext && <Button label="Siguiente lección" onPress={onNext} />}
        <Button label="Volver a la ruta" kind={hasNext ? 'ghost' : 'primary'} onPress={onBack} />
      </View>
    </View>
  );
}
