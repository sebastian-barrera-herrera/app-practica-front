import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { changePassword, updateName, useAuth } from '@/cloud/auth';
import { MIN_PASSWORD } from '@/cloud/config';
import { pushReplace } from '@/cloud/sync';
import { COURSE_LIST } from '@/content';
import type { CourseId } from '@/content/types';
import type { SoundId, ThemePref } from '@/game/progress';
import { COURSE_KEYS, goalStreak } from '@/game/root';
import { useGame } from '@/game/store';
import { cancelAllNotifications, ensurePermission, permissionStatus, SOUNDS, sendTestNotification } from '@/lib/notify';
import { previewSound } from '@/lib/sfx';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { courseColor } from '@/ui/courseColors';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { TimePicker } from '@/ui/TimePicker';
import { colors, radius } from '@/ui/theme';

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

const Divider = () => <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />;

const Toggle = ({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) => (
  <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: colors.mint, false: colors.card2 }} thumbColor={colors.white} />
);

function Options<V extends string | number>({ value, options, onChange, fmt, color }: { value: V; options: V[]; onChange: (v: V) => void; fmt?: (v: V) => string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {options.map((o) => (
        <Chip key={String(o)} label={fmt ? fmt(o) : String(o)} active={value === o} color={color} onPress={() => onChange(o)} />
      ))}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <T v="label" color={colors.dim} style={{ marginTop: 8 }}>{children}</T>;
}

const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function SoundPicker({ value, onChange }: { value: SoundId; onChange: (s: SoundId) => void }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      {SOUNDS.map((s) => {
        const on = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => {
              onChange(s.id);
              previewSound(s.id);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.mint : colors.line, backgroundColor: on ? colors.mintSoft : 'transparent' }}
          >
            <T style={{ fontSize: 20 }}>{s.id === 'silencio' ? '🔇' : on ? '🔊' : '🔈'}</T>
            <View style={{ flex: 1 }}>
              <T v="small" bold>{s.label}</T>
              <T v="tiny" color={colors.dim}>{s.desc}</T>
            </View>
            {on ? <T color={colors.mint} bold>✓</T> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Settings() {
  const st = useGame((s) => s.settings);
  const set = useGame((s) => s.setSettings);
  const root = useGame();
  const user = useAuth((a) => a.user);
  const [confirmReset, setConfirmReset] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [perm, setPerm] = useState<string>('undetermined');
  const [timeEdit, setTimeEdit] = useState<{ index: number; value: string } | null>(null);
  const [name, setName] = useState(st.name);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ cur: '', next: '' });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    void permissionStatus().then(setPerm);
  }, []);

  const R = st.reminders;
  const setR = (patch: Partial<typeof R>) => set({ reminders: { ...R, ...patch } });
  const total = COURSE_KEYS.reduce((n, c) => n + (st.courseOn[c] ? st.goalMinutes[c] : 0), 0);
  const gs = goalStreak(root, Date.now());

  const askPermission = async () => {
    if (Platform.OS === 'web') {
      setNote('Los avisos solo funcionan en el móvil.');
      return false;
    }
    const ok = await ensurePermission();
    setPerm(ok ? 'granted' : 'denied');
    if (!ok) setNote('No hay permiso de notificaciones. Actívalo en los ajustes del sistema para recibir avisos.');
    else setNote(null);
    return ok;
  };

  const saveName = async () => {
    const n = name.trim();
    if (n.length < 2) {
      setNameMsg('Escribe al menos 2 letras.');
      return;
    }
    set({ name: n });
    try {
      await updateName(n);
      setNameMsg('Nombre guardado ✓');
    } catch {
      setNameMsg('Guardado aquí. Se actualizará en la nube cuando haya conexión.');
    }
  };

  const savePassword = async () => {
    if (pw.next.length < MIN_PASSWORD) {
      setPwMsg({ ok: false, text: `La nueva contraseña necesita al menos ${MIN_PASSWORD} caracteres.` });
      return;
    }
    try {
      await changePassword({ current: pw.cur, next: pw.next });
      setPwMsg({ ok: true, text: 'Contraseña cambiada ✓' });
      setPw({ cur: '', next: '' });
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo cambiar.' });
    }
  };

  const testNotif = async (kind: 'study' | 'surprise') => {
    const ok = await askPermission();
    if (!ok) return;
    const sent = await sendTestNotification(kind === 'study' ? R.sound : st.surpriseSound, kind, R.vibrate);
    setTestMsg(sent ? 'Te llegará en unos 4 segundos. Sal de la app o bloquea la pantalla para verla con sus botones.' : 'No pudimos programar la prueba.');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="h1">Ajustes</T>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 60 }}>
        {/* ── cuenta ── */}
        <SectionTitle>Cuenta</SectionTitle>
        <Card>
          <TextField label="Tu nombre" value={name} onChangeText={(v) => { setName(v.slice(0, 30)); setNameMsg(null); }} returnKeyType="done" onSubmitEditing={saveName} hint={user?.email} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <Button label="Guardar nombre" small full={false} onPress={saveName} disabled={name.trim() === st.name} />
            {nameMsg ? <T v="tiny" color={colors.dim} style={{ flex: 1 }}>{nameMsg}</T> : null}
          </View>
          <Divider />
          <Pressable onPress={() => { setPwOpen((v) => !v); setPwMsg(null); }} accessibilityRole="button">
            <Row title="Cambiar contraseña" right={<T color={colors.mint} bold>{pwOpen ? '▲' : '▼'}</T>} />
          </Pressable>
          {pwOpen && (
            <View style={{ gap: 12, marginTop: 12 }}>
              <TextField label="Contraseña actual" value={pw.cur} onChangeText={(cur) => setPw({ ...pw, cur })} password autoCapitalize="none" />
              <TextField label="Contraseña nueva" value={pw.next} onChangeText={(next) => setPw({ ...pw, next })} password autoCapitalize="none" hint={`Mínimo ${MIN_PASSWORD} caracteres`} />
              {pwMsg ? <T v="small" color={pwMsg.ok ? colors.green : colors.rose}>{pwMsg.text}</T> : null}
              <Button label="Cambiar contraseña" small onPress={savePassword} disabled={!pw.cur || !pw.next} />
            </View>
          )}
        </Card>

        {/* ── apariencia ── */}
        <SectionTitle>Apariencia</SectionTitle>
        <Card>
          <T v="h3">Tema</T>
          <T v="small" color={colors.dim}>«Sistema» sigue el modo claro u oscuro de tu móvil. La terminal y el editor siempre son oscuros.</T>
          <Options<ThemePref> value={st.theme} options={['system', 'light', 'dark']} fmt={(v) => (v === 'system' ? '📱 Sistema' : v === 'light' ? '☀️ Claro' : '🌙 Oscuro')} onChange={(theme) => set({ theme })} />
        </Card>

        {/* ── metas ── */}
        <SectionTitle>Metas diarias</SectionTitle>
        <Card>
          <T v="small" color={colors.dim}>Tiempo de práctica activa que quieres cumplir cada día. El día cuenta como cumplido cuando alcanzas la meta de todos los cursos activos.</T>
          {COURSE_LIST.map((c) => {
            const col = courseColor(c.id);
            const id = c.id as CourseId;
            return (
              <View key={c.id} style={{ marginTop: 14 }}>
                <Row
                  title={`${c.emoji} ${c.name}`}
                  desc={st.courseOn[id] ? `${st.goalMinutes[id]} min al día` : 'No cuenta para la meta'}
                  right={<Toggle label={`Meta de ${c.name}`} value={st.courseOn[id]} onChange={(v) => set({ courseOn: { ...st.courseOn, [id]: v } })} />}
                />
                {st.courseOn[id] && (
                  <Options value={st.goalMinutes[id]} options={[15, 30, 45, 60, 90, 120]} color={col} fmt={(v) => (v >= 60 ? `${v / 60} h${v % 60 ? ` ${v % 60}` : ''}`.replace(/ $/, '') : `${v} min`)} onChange={(m) => set({ goalMinutes: { ...st.goalMinutes, [id]: m } })} />
                )}
              </View>
            );
          })}
          <Divider />
          <T v="small" bold>Total diario: {total} min · racha de metas: {gs.current} día{gs.current === 1 ? '' : 's'}</T>
        </Card>

        {/* ── recordatorios ── */}
        <SectionTitle>Recordatorios</SectionTitle>
        <Card accent={R.enabled ? colors.mint : undefined}>
          <Row title="⏰ Recordatorios de práctica" desc="Te avisamos para que no se te pase tu hora de estudio. Con botones: Empezar, +30 min u «Hoy no»." right={<Toggle label="Recordatorios" value={R.enabled} onChange={async (enabled) => { if (enabled) await askPermission(); setR({ enabled }); }} />} />
          {perm === 'denied' && <T v="tiny" color={colors.amber} style={{ marginTop: 8 }}>Las notificaciones están bloqueadas en el sistema. Actívalas en Ajustes ▸ Aplicaciones ▸ Dev Dojo.</T>}
          {R.enabled && (
            <View style={{ marginTop: 12 }}>
              <T v="small" bold>¿A qué hora?</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {R.times.map((t, i) => (
                  <View key={`${t}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.mint, backgroundColor: colors.mintSoft }}>
                    <Pressable onPress={() => setTimeEdit({ index: i, value: t })} accessibilityLabel={`Cambiar la hora ${t}`} style={{ paddingVertical: 8, paddingLeft: 14, paddingRight: 8 }}>
                      <T bold color={colors.mint}>{t}</T>
                    </Pressable>
                    <Pressable onPress={() => setR({ times: R.times.filter((_, k) => k !== i) })} hitSlop={6} accessibilityLabel={`Quitar la hora ${t}`} style={{ paddingVertical: 8, paddingRight: 12, paddingLeft: 4 }}>
                      <T color={colors.dim}>✕</T>
                    </Pressable>
                  </View>
                ))}
                {R.times.length < 6 && (
                  <Pressable onPress={() => setTimeEdit({ index: -1, value: '20:00' })} accessibilityLabel="Añadir una hora" style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line }}>
                    <T bold color={colors.dim}>+ Añadir hora</T>
                  </Pressable>
                )}
              </View>
              {R.times.length === 0 && <T v="tiny" color={colors.amber} style={{ marginTop: 6 }}>Añade al menos una hora para recibir recordatorios.</T>}

              <T v="small" bold style={{ marginTop: 14 }}>¿Qué días?</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => setR({ days: R.days.map((v, k) => (k === d ? !v : v)) })}
                    accessibilityRole="checkbox"
                    accessibilityLabel={DAY_NAMES[d]}
                    accessibilityState={{ checked: R.days[d] }}
                    style={{ flex: 1, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: R.days[d] ? colors.mint : colors.card2, borderWidth: 1, borderColor: R.days[d] ? colors.mint : colors.line }}
                  >
                    <T bold color={R.days[d] ? '#04120D' : colors.dim}>{DAYS[d]}</T>
                  </Pressable>
                ))}
              </View>

              <Divider />
              <T v="small" bold>Sonido</T>
              <SoundPicker value={R.sound} onChange={(sound) => setR({ sound })} />
              <Divider />
              <Row title="Vibrar" right={<Toggle label="Vibración del aviso" value={R.vibrate} onChange={(vibrate) => setR({ vibrate })} />} />
              <Divider />
              <Row title="No avisar si ya cumplí" desc="Si hoy ya alcanzaste tus metas, se saltan los avisos restantes." right={<Toggle label="Saltar si ya cumplí" value={R.skipIfDone} onChange={(skipIfDone) => setR({ skipIfDone })} />} />
              <Divider />
              <Row title="«Te echamos de menos»" desc="Un aviso suave si pasan varios días sin entrar." right={<Toggle label="Avisos de regreso" value={R.comeback} onChange={(comeback) => setR({ comeback })} />} />
              <View style={{ marginTop: 14 }}>
                <Button label="🔔 Probar este recordatorio" kind="secondary" small onPress={() => void testNotif('study')} />
              </View>
            </View>
          )}
        </Card>

        {/* ── sorpresas ── */}
        <Card accent={st.surpriseEnabled ? colors.rose : undefined}>
          <Row
            title="🎯 Exámenes sorpresa"
            desc="Avisos a horas aleatorias con 5 preguntas rápidas de lo ya aprendido, alternando tus cursos. Con botones: Responder, +1 h o silenciar."
            right={<Toggle label="Exámenes sorpresa" value={st.surpriseEnabled} onChange={async (v) => { if (v) await askPermission(); set({ surpriseEnabled: v }); }} />}
          />
          {st.surpriseEnabled && (
            <View style={{ marginTop: 12, gap: 12 }}>
              <View>
                <T v="small" bold>Por semana</T>
                <Options value={st.surprisePerWeek} options={[2, 4, 7, 10]} onChange={(surprisePerWeek) => set({ surprisePerWeek })} />
              </View>
              <View>
                <T v="small" bold>Franja horaria</T>
                <Options value={st.windowStart * 100 + st.windowEnd} options={[1021, 818, 1222, 1823]} fmt={(v) => `${Math.floor(v / 100)}:00–${v % 100}:00`} onChange={(v) => set({ windowStart: Math.floor(v / 100), windowEnd: v % 100 })} />
              </View>
              <View>
                <T v="small" bold>Sonido</T>
                <SoundPicker value={st.surpriseSound} onChange={(surpriseSound) => set({ surpriseSound })} />
              </View>
              <Button label="🎯 Probar una sorpresa" kind="secondary" small onPress={() => void testNotif('surprise')} />
            </View>
          )}
        </Card>
        {(note || testMsg) && <T v="small" color={colors.amber}>{note ?? testMsg}</T>}

        {/* ── sonido y vibración ── */}
        <SectionTitle>Sonido y tacto</SectionTitle>
        <Card>
          <Row title="Efectos de sonido" desc="Al acertar, fallar, completar lecciones y cumplir metas" right={<Toggle label="Efectos de sonido" value={st.sfx} onChange={(sfx) => set({ sfx })} />} />
          <Divider />
          <Row title="Vibración al tocar" desc="Respuesta háptica al tocar y al acertar" right={<Toggle label="Vibración" value={st.haptics} onChange={(haptics) => set({ haptics })} />} />
        </Card>

        <SectionTitle>Avanzado</SectionTitle>
        <Card>
          <Row title="Desbloquear todo" desc="Salta la progresión y abre todas las zonas y exámenes" right={<Toggle label="Desbloquear todo" value={st.unlockAll} onChange={(unlockAll) => set({ unlockAll })} />} />
        </Card>

        <Card>
          <T v="h3">Zona de peligro</T>
          <T v="small" color={colors.dim} style={{ marginBottom: 10 }}>Borra tu progreso, XP, racha, logros y laboratorios, también en la nube. Tu cuenta se mantiene.</T>
          <Button label="Borrar todo mi progreso" kind="danger" small onPress={() => setConfirmReset(true)} />
        </Card>

        <T v="tiny" center color={colors.faint}>Dev Dojo · v2.0 · tu progreso se guarda en tu cuenta y funciona sin internet</T>
      </ScrollView>

      <TimePicker
        visible={!!timeEdit}
        value={timeEdit?.value ?? '20:00'}
        title={timeEdit && timeEdit.index >= 0 ? 'Cambiar la hora' : 'Nueva hora de recordatorio'}
        onCancel={() => setTimeEdit(null)}
        onConfirm={(hhmm) => {
          if (timeEdit) {
            const list = timeEdit.index >= 0 ? R.times.map((t, i) => (i === timeEdit.index ? hhmm : t)) : [...R.times, hhmm];
            setR({ times: [...new Set(list)].sort() });
          }
          setTimeEdit(null);
        }}
      />
      <ConfirmModal
        visible={confirmReset}
        title="¿Empezar de cero?"
        message="Perderás todo tu progreso en este y en tus otros dispositivos. Esta acción no se puede deshacer."
        confirmLabel="Sí, borrar todo"
        danger
        onConfirm={async () => {
          setConfirmReset(false);
          await cancelAllNotifications();
          useGame.getState().resetAll();
          await pushReplace();
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </Screen>
  );
}
