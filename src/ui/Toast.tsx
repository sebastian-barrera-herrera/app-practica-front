import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { courseDef } from '@/content';
import { success } from '@/lib/haptics';
import { sfx } from '@/lib/sfx';
import { onGoalReached } from '@/lib/studyClock';
import { courseColor } from './courseColors';
import { T } from './Text';
import { colors, radius, shadow } from './theme';

export interface ToastMsg {
  emoji: string;
  title: string;
  body?: string;
  color?: string;
  ms?: number;
}

const listeners = new Set<(t: ToastMsg) => void>();
export const showToast = (t: ToastMsg) => listeners.forEach((l) => l(t));

/** Avisos flotantes (meta cumplida, sincronización…). Se monta una vez en la raíz. */
export function ToastHost() {
  const [t, setT] = useState<(ToastMsg & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let n = 0;
    const show = (m: ToastMsg) => {
      setT({ ...m, id: ++n });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setT(null), m.ms ?? 4200);
    };
    listeners.add(show);
    const off = onGoalReached(({ course, bonusXp, dayDone }) => {
      const c = courseDef(course);
      sfx('goal');
      success();
      show({
        emoji: dayDone ? '🏆' : '🎯',
        title: dayDone ? '¡Metas del día cumplidas!' : `¡Meta de ${c.name} cumplida!`,
        body: `${bonusXp ? `+${bonusXp} XP · ` : ''}${dayDone ? 'Hoy has practicado todo lo que te propusiste.' : 'Sigue con el otro curso para completar el día.'}`,
        color: courseColor(course),
        ms: 5200,
      });
    });
    return () => {
      listeners.delete(show);
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!t) return null;
  const col = t.color ?? colors.mint;
  return (
    <Animated.View
      key={t.id}
      entering={FadeInUp.duration(280)}
      exiting={FadeOutUp.duration(220)}
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 50 }}
    >
      <Pressable onPress={() => setT(null)} accessibilityRole="alert">
        <View style={[{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: col, padding: 14 }, shadow as object]}>
          <T style={{ fontSize: 30 }}>{t.emoji}</T>
          <View style={{ flex: 1 }}>
            <T v="h3">{t.title}</T>
            {t.body ? <T v="small" color={colors.dim}>{t.body}</T> : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
