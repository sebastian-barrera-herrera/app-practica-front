import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { KeyboardSafe } from './KeyboardSafe';
import { Mascot, type Mood } from './Mascot';
import { Screen } from './Screen';
import { T } from './Text';
import { colors } from './theme';

/** Marco común de las pantallas de cuenta: mascota, título y contenido con teclado. */
export function AuthShell({ title, subtitle, mood = 'happy', back = true, children }: { title: string; subtitle?: string; mood?: Mood; back?: boolean; children: React.ReactNode }) {
  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardSafe>
        <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 18, paddingVertical: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {back ? (
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} hitSlop={12} accessibilityLabel="Volver" style={{ alignSelf: 'flex-start' }}>
              <T style={{ fontSize: 24 }} color={colors.dim}>←</T>
            </Pressable>
          ) : null}
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Mascot size={96} mood={mood} />
            <T v="h1" center>{title}</T>
            {subtitle ? <T center color={colors.dim}>{subtitle}</T> : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardSafe>
    </Screen>
  );
}
