import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Card } from './Card';
import { Screen } from './Screen';
import { T } from './Text';
import { colors } from './theme';

/** Biblioteca de Python (se sustituye por la referencia completa cuando el curso esté listo). */
export function PyLibrary() {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="h1">Biblioteca de Python</T>
      </View>
      <Card style={{ marginTop: 16 }}>
        <T color={colors.dim}>Muy pronto.</T>
      </Card>
    </Screen>
  );
}
