import { router } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { COURSE_LIST } from '@/content';
import { Button } from '@/ui/Button';
import { courseColor } from '@/ui/courseColors';
import { Mascot } from '@/ui/Mascot';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

export default function Welcome() {
  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 22, paddingVertical: 24 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center', gap: 8 }}>
          <Mascot size={150} mood="cheer" />
          <T v="title" center>Dev Dojo</T>
          <T center color={colors.dim}>Aprende a programar y a dominar la terminal practicando un poco cada día. Con lecciones, retos, repasos y un laboratorio donde puedes probarlo todo.</T>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{ gap: 10 }}>
          {COURSE_LIST.map((c) => {
            const col = courseColor(c.id);
            return (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: col + '88', backgroundColor: col + '14' }}>
                <T style={{ fontSize: 30 }}>{c.emoji}</T>
                <View style={{ flex: 1 }}>
                  <T v="h3" color={col}>{c.name}</T>
                  <T v="tiny" color={colors.dim}>{c.tagline}</T>
                </View>
              </View>
            );
          })}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(240).duration(400)} style={{ gap: 10 }}>
          <Button label="Crear mi cuenta" onPress={() => router.push('/register')} />
          <Button label="Ya tengo cuenta" kind="secondary" onPress={() => router.push('/login')} />
          <T v="tiny" center color={colors.faint}>Tu progreso se guarda en tu cuenta y también funciona sin internet.</T>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}
