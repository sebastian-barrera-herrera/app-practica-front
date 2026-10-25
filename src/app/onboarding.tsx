import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { COURSE_LIST } from '@/content';
import type { CourseId } from '@/content/types';
import type { SoundId } from '@/game/progress';
import { useGame } from '@/game/store';
import { select } from '@/lib/haptics';
import { minutesLabel } from '@/lib/format';
import { ensurePermission, SOUNDS } from '@/lib/notify';
import { previewSound } from '@/lib/sfx';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { courseColor } from '@/ui/courseColors';
import { Mascot, type Mood } from '@/ui/Mascot';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const STARTS = [
  { id: 'zero', title: 'Empiezo desde cero', desc: 'Voy paso a paso: cada zona se abre al terminar la anterior. Si ya sé algo, puedo saltar con un examen de salto.', emoji: '🥋' },
  { id: 'open', title: 'Quiero verlo todo', desc: 'Todo desbloqueado desde el inicio, sin exámenes de salto.', emoji: '🧭' },
];

const SLOTS = [
  { time: '07:30', label: 'Al despertar', emoji: '🌅' },
  { time: '13:30', label: 'Tras comer', emoji: '🍽️' },
  { time: '17:30', label: 'Tarde', emoji: '🌇' },
  { time: '20:30', label: 'Noche', emoji: '🌙' },
];

const STEPS = 6;

export default function Onboarding() {
  const name = useGame((s) => s.settings.name).split(' ')[0];
  const [step, setStep] = useState(0);
  // nada preseleccionado: el alumno decide qué aprender
  const [on, setOn] = useState<Record<CourseId, boolean>>({ linux: false, python: false, sql: false });
  const [minutes, setMinutes] = useState<Record<CourseId, number>>({ linux: 60, python: 60, sql: 60 });
  const [times, setTimes] = useState<string[]>(['07:30', '20:30']);
  const [sound, setSound] = useState<SoundId>('campana');
  const [start, setStart] = useState<'zero' | 'open'>('zero');
  const [perm, setPerm] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const anyCourse = COURSE_LIST.some((c) => on[c.id] && c.worlds.length > 0);
  const mood: Mood = step === 0 ? 'cheer' : step === 1 ? 'happy' : step === 2 ? 'think' : step === 3 ? 'cool' : step === 4 ? 'happy' : 'cheer';
  const total = COURSE_LIST.reduce((n, c) => n + (on[c.id] ? minutes[c.id] : 0), 0);

  const finish = () => {
    const g = useGame.getState();
    g.setSettings({
      courseOn: on,
      goalMinutes: minutes,
      reminders: { ...g.settings.reminders, enabled: times.length > 0, times: [...times].sort(), sound },
      unlockAll: start === 'open',
      onboarded: true,
    });
    // el curso que se enseña primero es el primero que eligió
    g.setActive(COURSE_LIST.find((c) => on[c.id])?.id ?? 'linux');
    router.replace('/(tabs)/today');
  };

  const canNext = step === 1 ? anyCourse : true;
  const next = () => (step < STEPS - 1 ? setStep(step + 1) : finish());

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', gap: 6, paddingTop: 12 }}>
        {Array.from({ length: STEPS }).map((_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? colors.mint : colors.card2 }} />
        ))}
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 16, paddingVertical: 18 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center' }}>
          <Mascot size={step === 0 ? 140 : 100} mood={mood} />
        </View>

        {step === 0 && (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={{ gap: 14 }}>
            <T v="title" center>¡Hola{name ? `, ${name}` : ''}!</T>
            <T center color={colors.dim}>Soy Pingüi, tu sensei. Vamos a dejar tu dojo a tu medida en menos de un minuto.</T>
            <Card>
              <View style={{ gap: 10 }}>
                {[
                  ['📚', 'Cursos de Linux, Python y SQL, de básico a avanzado: tú eliges cuáles'],
                  ['⏱️', 'Una meta de práctica diaria para crear el hábito'],
                  ['🔔', 'Recordatorios y exámenes sorpresa con botones'],
                  ['🏅', 'XP, niveles, rachas y logros para no soltarlo'],
                ].map(([e, t]) => (
                  <View key={t} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <T style={{ fontSize: 22 }}>{e}</T>
                    <T v="small" style={{ flex: 1 }}>{t}</T>
                  </View>
                ))}
              </View>
            </Card>
          </Animated.View>
        )}

        {step === 1 && (
          <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
            <T v="h1" center>¿Qué quieres practicar?</T>
            <T center color={colors.dim}>Elige uno, varios o todos. Cada curso tiene su propia ruta, su laboratorio y su progreso; no se mezclan, y podrás añadir o quitar cursos cuando quieras.</T>
            {COURSE_LIST.map((c) => {
              const col = courseColor(c.id);
              const sel = on[c.id];
              const soon = c.worlds.length === 0;
              return (
                <Pressable key={c.id} disabled={soon} onPress={() => { select(); setOn({ ...on, [c.id]: !sel }); }} accessibilityRole="checkbox" accessibilityState={{ checked: sel, disabled: soon }} accessibilityLabel={c.name} style={{ opacity: soon ? 0.6 : 1 }}>
                  <Card accent={sel ? col : undefined} style={sel ? { backgroundColor: col + '1A' } : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <T style={{ fontSize: 34 }}>{c.emoji}</T>
                      <View style={{ flex: 1 }}>
                        <T v="h2" color={sel ? col : colors.text}>{c.name}</T>
                        <T v="small" color={colors.dim}>{c.tagline}</T>
                        {soon ? <T v="tiny" bold color={colors.amber}>Próximamente</T> : null}
                      </View>
                      <T style={{ fontSize: 22 }} color={sel ? col : colors.faint}>{sel ? '✔' : '○'}</T>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            {!anyCourse && <T v="small" center color={colors.amber}>Elige al menos un curso para continuar.</T>}
            {anyCourse && <T v="small" center color={colors.dim}>Puedes empezar con uno y añadir los demás más adelante.</T>}
          </Animated.View>
        )}

        {step === 2 && (
          <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
            <T v="h1" center>Tu meta diaria</T>
            <T center color={colors.dim}>¿Cuánto tiempo quieres practicar cada día en cada curso? Solo cuenta el tiempo activo. Con varios cursos, elige una meta que de verdad puedas cumplir.</T>
            {COURSE_LIST.filter((c) => on[c.id]).map((c) => {
              const col = courseColor(c.id);
              return (
                <Card key={c.id} accent={col}>
                  <T v="h3" color={col}>{c.emoji} {c.name}</T>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {[15, 30, 45, 60, 90, 120].map((m) => (
                      <Chip key={m} label={minutesLabel(m)} color={col} active={minutes[c.id] === m} onPress={() => setMinutes({ ...minutes, [c.id]: m })} />
                    ))}
                  </View>
                </Card>
              );
            })}
            <T v="small" center bold color={colors.amber}>Total: {minutesLabel(total)} al día</T>
          </Animated.View>
        )}

        {step === 3 && (
          <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
            <T v="h1" center>¿Cuándo te aviso?</T>
            <T center color={colors.dim}>Elige tus momentos de práctica. Podrás cambiarlos o añadir más horas en Ajustes.</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {SLOTS.map((s) => {
                const sel = times.includes(s.time);
                return (
                  <Pressable key={s.time} style={{ width: '48%' }} onPress={() => { select(); setTimes(sel ? times.filter((t) => t !== s.time) : [...times, s.time]); }} accessibilityRole="checkbox" accessibilityState={{ checked: sel }} accessibilityLabel={`${s.label} ${s.time}`}>
                    <Card accent={sel ? colors.mint : undefined} pad={12} style={sel ? { backgroundColor: colors.mintSoft } : undefined}>
                      <T style={{ fontSize: 26 }}>{s.emoji}</T>
                      <T v="h3">{s.time}</T>
                      <T v="tiny" color={colors.dim}>{s.label}</T>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
            {times.length === 0 && <T v="small" center color={colors.amber}>Sin horas no habrá recordatorios (puedes activarlos luego).</T>}
            <T v="label" color={colors.dim} style={{ marginTop: 6 }}>Sonido del aviso</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SOUNDS.map((s) => (
                <Chip key={s.id} label={`${s.id === 'silencio' ? '🔇' : '🔊'} ${s.label}`} active={sound === s.id} onPress={() => { setSound(s.id); previewSound(s.id); }} />
              ))}
            </View>
          </Animated.View>
        )}

        {step === 4 && (
          <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
            <T v="h1" center>Permiso para avisarte</T>
            <T center color={colors.dim}>Para recordarte tu hora de práctica y mandarte exámenes sorpresa necesito permiso de notificaciones. Las notificaciones traen botones: empezar, aplazar 30 min o «hoy no».</T>
            <Card accent={perm === 'granted' ? colors.green : undefined}>
              <View style={{ gap: 10, alignItems: 'center' }}>
                <T style={{ fontSize: 40 }}>{perm === 'granted' ? '✅' : perm === 'denied' ? '🚫' : '🔔'}</T>
                <T center bold>{perm === 'granted' ? '¡Listo! Te avisaré a tus horas.' : perm === 'denied' ? 'Sin permiso no puedo avisarte, pero la app funciona igual. Puedes activarlo luego en Ajustes.' : 'Toca el botón para activar los avisos'}</T>
                {perm !== 'granted' && (
                  <Button
                    label="Activar notificaciones"
                    onPress={async () => {
                      const ok = await ensurePermission();
                      setPerm(ok ? 'granted' : 'denied');
                    }}
                  />
                )}
              </View>
            </Card>
            <T v="tiny" center color={colors.faint}>Puedes saltarte este paso: seguirás viendo tus metas dentro de la app.</T>
          </Animated.View>
        )}

        {step === 5 && (
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
        <Button label={step === 0 ? '¡Vamos!' : step === STEPS - 1 ? 'Entrar al dojo' : step === 4 && perm === 'unknown' ? 'Ahora no' : 'Continuar'} disabled={!canNext} onPress={next} />
        {step > 0 && <Button label="Atrás" kind="ghost" small onPress={() => setStep(step - 1)} />}
      </View>
    </Screen>
  );
}
