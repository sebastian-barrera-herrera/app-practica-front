import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useGame } from '@/game/store';
import { cancelSurprises, ensurePermission, scheduleSurprises } from '@/lib/notify';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';

function Row({ title, desc, right }: { title: string; desc?: string; right: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <T v="h3">{title}</T>
        {desc ? <T v="small" color={colors.dim}>{desc}</T> : null}
      </View>
      {right}
    </View>
  );
}

const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.mint, false: colors.card2 }} thumbColor={colors.white} />
);

const Options = <V extends number>({ value, options, onChange, fmt }: { value: V; options: V[]; onChange: (v: V) => void; fmt?: (v: V) => string }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
    {options.map((o) => (
      <Chip key={o} label={fmt ? fmt(o) : String(o)} active={value === o} onPress={() => onChange(o)} />
    ))}
  </View>
);

export default function Settings() {
  const st = useGame((s) => s.settings);
  const set = useGame((s) => s.setSettings);
  const [confirmReset, setConfirmReset] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const applySchedule = async (enabled: boolean, perWeek: number, from: number, to: number) => {
    if (!enabled) {
      await cancelSurprises();
      setNote(null);
      return;
    }
    if (Platform.OS === 'web') {
      setNote('Los avisos solo funcionan en el móvil. En la app te ofreceré un examen sorpresa al abrirla.');
      return;
    }
    const ok = await ensurePermission();
    if (!ok) {
      set({ surpriseEnabled: false });
      setNote('No hay permiso de notificaciones. Actívalo en los ajustes del sistema para recibir avisos.');
      return;
    }
    const n = await scheduleSurprises(perWeek, from, to);
    setNote(`${n} aviso${n === 1 ? '' : 's'} programado${n === 1 ? '' : 's'} para los próximos 7 días.`);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="h1">Ajustes</T>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
        <Card>
          <T v="h3">Tu nombre</T>
          <TextInput
            value={st.name}
            onChangeText={(name) => set({ name: name.slice(0, 24) })}
            placeholder="Aprendiz"
            placeholderTextColor={colors.faint}
            style={{ marginTop: 8, backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, fontFamily: fonts.bold, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10 }}
          />
        </Card>

        <Card>
          <T v="h3">Meta diaria</T>
          <T v="small" color={colors.dim}>XP que quieres ganar cada día para mantener la racha.</T>
          <Options value={st.dailyGoal} options={[30, 50, 100, 150]} fmt={(v) => `${v} XP`} onChange={(dailyGoal) => set({ dailyGoal })} />
        </Card>

        <Card>
          <View style={{ gap: 14 }}>
            <Row title="Vibración" desc="Respuesta háptica al tocar y al acertar" right={<Toggle value={st.haptics} onChange={(haptics) => set({ haptics })} />} />
            <View style={{ height: 1, backgroundColor: colors.line }} />
            <Row title="Desbloquear todo" desc="Salta la progresión y abre todas las zonas y exámenes" right={<Toggle value={st.unlockAll} onChange={(unlockAll) => set({ unlockAll })} />} />
          </View>
        </Card>

        <Card accent={st.surpriseEnabled ? colors.rose : undefined}>
          <Row
            title="🎯 Exámenes sorpresa"
            desc="Avisos a horas aleatorias con 5 preguntas rápidas de lo ya aprendido"
            right={
              <Toggle
                value={st.surpriseEnabled}
                onChange={(v) => {
                  set({ surpriseEnabled: v });
                  void applySchedule(v, st.surprisePerWeek, st.windowStart, st.windowEnd);
                }}
              />
            }
          />
          {st.surpriseEnabled && (
            <View style={{ marginTop: 12, gap: 10 }}>
              <View>
                <T v="small" bold>Por semana</T>
                <Options
                  value={st.surprisePerWeek}
                  options={[2, 4, 7]}
                  onChange={(surprisePerWeek) => {
                    set({ surprisePerWeek });
                    void applySchedule(true, surprisePerWeek, st.windowStart, st.windowEnd);
                  }}
                />
              </View>
              <View>
                <T v="small" bold>Franja horaria</T>
                <Options
                  value={st.windowStart * 100 + st.windowEnd}
                  options={[1021, 818, 1222, 1823]}
                  fmt={(v) => `${Math.floor(v / 100)}:00–${v % 100}:00`}
                  onChange={(v) => {
                    const windowStart = Math.floor(v / 100);
                    const windowEnd = v % 100;
                    set({ windowStart, windowEnd });
                    void applySchedule(true, st.surprisePerWeek, windowStart, windowEnd);
                  }}
                />
              </View>
              {note ? <T v="tiny" color={colors.amber}>{note}</T> : null}
            </View>
          )}
          {!st.surpriseEnabled && note ? <T v="tiny" color={colors.amber} style={{ marginTop: 8 }}>{note}</T> : null}
        </Card>

        <Card>
          <T v="h3">Zona de peligro</T>
          <T v="small" color={colors.dim} style={{ marginBottom: 10 }}>Borra tu progreso, XP, racha, logros y el laboratorio. No se puede deshacer.</T>
          <Button label="Borrar todo mi progreso" kind="danger" small onPress={() => setConfirmReset(true)} />
        </Card>

        <T v="tiny" center color={colors.faint}>Linux Dojo · todo el contenido es offline · v1.0</T>
      </ScrollView>
      <ConfirmModal
        visible={confirmReset}
        title="¿Empezar de cero?"
        message="Perderás todo tu progreso. Esta acción no se puede deshacer."
        confirmLabel="Sí, borrar todo"
        danger
        onConfirm={() => {
          void cancelSurprises();
          useGame.getState().resetAll();
          setConfirmReset(false);
          router.replace('/onboarding');
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </Screen>
  );
}
