import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useGame } from '@/game/store';
import { select } from '@/lib/haptics';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Mascot, type Mood } from '@/ui/Mascot';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';

const GOALS = [
  { xp: 30, title: 'Tranquilo', desc: '≈ 1 lección al día', emoji: '🌱' },
  { xp: 50, title: 'Constante', desc: '≈ 2 lecciones al día', emoji: '🔥' },
  { xp: 100, title: 'Intenso', desc: '≈ 4 lecciones al día', emoji: '🚀' },
];

const STARTS = [
  { id: 'zero', title: 'Empiezo desde cero', desc: 'Voy paso a paso: cada zona se desbloquea al terminar la anterior.', emoji: '🥋' },
  { id: 'open', title: 'Ya sé algo', desc: 'Todo desbloqueado desde el inicio para saltar a lo que quiera.', emoji: '🧭' },
];

const STEPS = 4;

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState(50);
  const [start, setStart] = useState<'zero' | 'open'>('zero');

  const mood: Mood = step === 0 ? 'cheer' : step === 1 ? 'happy' : step === 2 ? 'think' : 'cool';

  const finish = () => {
    useGame.getState().setSettings({ name: name.trim().slice(0, 24), dailyGoal: goal, unlockAll: start === 'open', onboarded: true });
    router.replace('/(tabs)');
  };

  const next = () => (step < STEPS - 1 ? setStep(step + 1) : finish());

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 6, paddingTop: 12 }}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? colors.mint : colors.card2 }} />
          ))}
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 18, paddingVertical: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center' }}>
            <Mascot size={step === 0 ? 150 : 110} mood={mood} />
          </View>

          {step === 0 && (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={{ gap: 14 }}>
              <T v="title" center>Linux Dojo</T>
              <T center color={colors.dim}>
                Soy Pingüi, tu sensei. Aquí aprenderás Linux de verdad: desde <T bold color={colors.mint}>ls</T> y <T bold color={colors.mint}>cd</T> hasta
                permisos, redes, servicios y scripting.
              </T>
              <Card>
                <View style={{ gap: 10 }}>
                  {[
                    ['🗺️', 'Una ruta guiada por zonas, con lecciones cortas'],
                    ['⌨️', 'Una terminal simulada para practicar sin miedo a romper nada'],
                    ['🧠', 'Repasos espaciados, pruebas rápidas y exámenes sorpresa'],
                    ['🏅', 'XP, niveles, rachas y logros para no soltarlo'],
                  ].map(([e, t]) => (
                    <View key={t} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                      <T style={{ fontSize: 22 }}>{e}</T>
                      <T v="small" style={{ flex: 1 }}>{t}</T>
                    </View>
                  ))}
                </View>
              </Card>
              <T v="tiny" center color={colors.faint}>Todo funciona sin conexión. Nada sale de tu teléfono.</T>
            </Animated.View>
          )}

          {step === 1 && (
            <Animated.View entering={FadeInDown} style={{ gap: 14 }}>
              <T v="h1" center>¿Cómo te llamo?</T>
              <T center color={colors.dim}>Será tu nombre en el dojo (y en el prompt de tu terminal).</T>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Tu nombre o apodo"
                placeholderTextColor={colors.faint}
                maxLength={24}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={next}
                style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 2, borderColor: name ? colors.mint : colors.line, color: colors.text, fontFamily: fonts.bold, fontSize: 20, paddingHorizontal: 18, paddingVertical: 14, textAlign: 'center' }}
              />
              <T v="tiny" center color={colors.faint}>Puedes dejarlo en blanco.</T>
            </Animated.View>
          )}

          {step === 2 && (
            <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
              <T v="h1" center>Tu meta diaria</T>
              <T center color={colors.dim}>Cumplirla cada día mantiene viva tu racha 🔥</T>
              {GOALS.map((g) => (
                <Pressable key={g.xp} onPress={() => { select(); setGoal(g.xp); }}>
                  <Card accent={goal === g.xp ? colors.mint : undefined} style={goal === g.xp ? { backgroundColor: colors.mintSoft } : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <T style={{ fontSize: 30 }}>{g.emoji}</T>
                      <View style={{ flex: 1 }}>
                        <T v="h3">{g.title}</T>
                        <T v="small" color={colors.dim}>{g.desc}</T>
                      </View>
                      <T v="h3" color={colors.amber}>{g.xp} XP</T>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </Animated.View>
          )}

          {step === 3 && (
            <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
              <T v="h1" center>¿Por dónde empiezas?</T>
              {STARTS.map((s) => (
                <Pressable key={s.id} onPress={() => { select(); setStart(s.id as 'zero' | 'open'); }}>
                  <Card accent={start === s.id ? colors.mint : undefined} style={start === s.id ? { backgroundColor: colors.mintSoft } : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <T style={{ fontSize: 30 }}>{s.emoji}</T>
                      <View style={{ flex: 1 }}>
                        <T v="h3">{s.title}</T>
                        <T v="small" color={colors.dim}>{s.desc}</T>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
              <T v="tiny" center color={colors.faint}>Lo puedes cambiar luego en Ajustes.</T>
            </Animated.View>
          )}
        </ScrollView>

        <View style={{ gap: 6, paddingBottom: 10 }}>
          <Button label={step === 0 ? '¡Vamos!' : step === STEPS - 1 ? 'Entrar al dojo' : 'Continuar'} onPress={next} />
          {step > 0 && <Button label="Atrás" kind="ghost" small onPress={() => setStep(step - 1)} />}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
