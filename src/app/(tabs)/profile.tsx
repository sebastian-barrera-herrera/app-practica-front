import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '@/cloud/auth';
import { signOutAndWipe } from '@/cloud/session';
import { syncNow, useSync } from '@/cloud/sync';
import { COURSE_LIST } from '@/content';
import { allAchievements } from '@/game/achievements';
import { enabledCourses, goalStreak } from '@/game/root';
import { useGame } from '@/game/store';
import { dayKey, streakAlive } from '@/game/streak';
import { levelProgress } from '@/game/xp';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { courseColor } from '@/ui/courseColors';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

function Stat({ emoji, value, label, color = colors.text }: { emoji: string; value: string | number; label: string; color?: string }) {
  return (
    <Card style={{ flex: 1, minWidth: '45%' }} pad={14}>
      <T style={{ fontSize: 22 }}>{emoji}</T>
      <T v="h1" color={color}>{value}</T>
      <T v="tiny" color={colors.dim}>{label}</T>
    </Card>
  );
}

/** Últimas 12 semanas de práctica (minutos por día, ambos cursos), estilo GitHub. */
function Heatmap({ minutes, goal }: { minutes: Record<string, number>; goal: number }) {
  const weeks = 12;
  const cells = useMemo(() => {
    const out: { key: string; min: number; future: boolean }[][] = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7; // lunes = 0
    const start = new Date(today);
    start.setDate(today.getDate() - dow - (weeks - 1) * 7);
    for (let w = 0; w < weeks; w++) {
      const col: { key: string; min: number; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + d);
        const key = dayKey(day.getTime());
        col.push({ key, min: minutes[key] ?? 0, future: day.getTime() > today.getTime() + 43200000 });
      }
      out.push(col);
    }
    return out;
  }, [minutes]);
  const shade = (m: number) => (m <= 0 ? colors.card2 : m < goal * 0.34 ? colors.mint + '55' : m < goal * 0.67 ? colors.mint + '99' : m < goal ? colors.mint + 'CC' : colors.mint);
  return (
    <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'center' }}>
      {cells.map((col, i) => (
        <View key={i} style={{ gap: 4 }}>
          {col.map((c) => (
            <View key={c.key} style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: c.future ? 'transparent' : shade(c.min) }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function Profile() {
  const root = useGame();
  const user = useAuth((a) => a.user);
  const lastSyncAt = useAuth((a) => a.lastSyncAt);
  const phase = useSync((x) => x.phase);
  const syncDetail = useSync((x) => x.detail);
  const [confirmOut, setConfirmOut] = useState<null | 'normal' | 'unsynced'>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const lp = levelProgress(root.xp);
  const alive = streakAlive(root.streak, now);
  const gs = goalStreak(root, now);
  const on = enabledCourses(root);

  const totalSeconds = useMemo(() => COURSE_LIST.reduce((n, c) => n + Object.values(root.study[c.id] ?? {}).reduce((a, b) => a + b, 0), 0), [root.study]);
  const minutesPerDay = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of COURSE_LIST) for (const [d, sec] of Object.entries(root.study[c.id] ?? {})) out[d] = (out[d] ?? 0) + sec / 60;
    return out;
  }, [root.study]);
  const goalTotal = on.reduce((n, c) => n + root.settings.goalMinutes[c], 0) || 60;

  const list = useMemo(() => allAchievements(COURSE_LIST), []);
  const unlocked = list.filter((a) => root.achievements[a.id]);
  const recent = [...unlocked].sort((a, b) => (root.achievements[b.id] ?? 0) - (root.achievements[a.id] ?? 0)).slice(0, 8);
  const hours = totalSeconds / 3600;

  const syncText = phase === 'syncing' ? 'Sincronizando…' : phase === 'error' ? 'No se pudo sincronizar' : phase === 'offline' ? 'Sin conexión (se sincronizará luego)' : lastSyncAt ? `Sincronizado ${ago(now - lastSyncAt)}` : 'Pendiente de sincronizar';

  const signOut = async (force = false) => {
    setBusy(true);
    const r = await signOutAndWipe({ force });
    setBusy(false);
    if (r === 'unsynced') setConfirmOut('unsynced');
    else setConfirmOut(null);
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8 }}>
          <Mascot size={92} mood={alive ? 'cool' : 'think'} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h1" numberOfLines={1}>{root.settings.name || user?.name || 'Aprendiz'}</T>
            <T v="tiny" color={colors.dim} numberOfLines={1}>{user?.email}</T>
            <T color={colors.violet} bold>Nivel {lp.level} · {lp.title}</T>
            <T v="tiny" color={colors.dim}>{root.xp.toLocaleString('es')} XP en total</T>
          </View>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Ajustes" style={{ padding: 8 }}>
            <T style={{ fontSize: 26 }}>⚙️</T>
          </Pressable>
        </View>

        <Card>
          <ProgressBar value={lp.pct} color={colors.cyan} height={12} />
          <T v="tiny" color={colors.dim} style={{ marginTop: 6 }}>{lp.need - lp.into} XP para el nivel {lp.level + 1}</T>
        </Card>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Stat emoji="🔥" value={root.streak.current} label={`Racha · mejor ${root.streak.best}`} color={alive ? colors.orange : colors.faint} />
          <Stat emoji="🏆" value={gs.current} label={`Racha de metas · mejor ${gs.best}`} color={gs.current ? colors.amber : colors.faint} />
          <Stat emoji="⏱️" value={hours >= 10 ? `${Math.round(hours)} h` : `${hours.toFixed(1)} h`} label="Tiempo practicado" color={colors.mint} />
          <Stat emoji="🛡️" value={root.streak.freezes} label="Escudos de racha" color={colors.cyan} />
        </View>

        <T v="label" color={colors.dim}>Por curso</T>
        {COURSE_LIST.map((c) => {
          const s = root.courses[c.id];
          const col = courseColor(c.id);
          const done = Object.values(s.lessons).filter((l) => l.done).length;
          const stars = Object.values(s.lessons).reduce((n, l) => n + l.stars, 0);
          const acc = s.stats.questions ? Math.round((s.stats.correct / s.stats.questions) * 100) : 0;
          const secs = Object.values(root.study[c.id] ?? {}).reduce((a, b) => a + b, 0);
          return (
            <Card
              key={c.id}
              accent={col}
              onPress={() => {
                useGame.getState().setActive(c.id);
                router.push('/(tabs)/roadmap');
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <T style={{ fontSize: 26 }}>{c.emoji}</T>
                <T v="h3" color={col} style={{ flex: 1 }}>{c.name}</T>
                <T v="tiny" color={colors.dim}>{(secs / 3600).toFixed(1)} h</T>
              </View>
              <ProgressBar value={c.lessons.length ? done / c.lessons.length : 0} color={col} height={8} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <T v="small" color={colors.dim}>📘 {done}/{c.lessons.length || '—'} lecciones</T>
                <T v="small" color={colors.dim}>⭐ {stars}</T>
                <T v="small" color={colors.dim}>🎯 {acc} %</T>
                <T v="small" color={colors.dim}>{c.id === 'linux' ? '⌨️' : '🖥️'} {s.stats.challenges}</T>
              </View>
              <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
                {c.levels.map((lv) => (
                  <View key={lv.id} style={{ alignItems: 'center', opacity: s.exams[`cert-${lv.id}`]?.passed ? 1 : 0.3 }}>
                    <T style={{ fontSize: 22 }}>{lv.id === 'basico' ? '🥉' : lv.id === 'intermedio' ? '🥈' : '🥇'}</T>
                  </View>
                ))}
                <T v="tiny" color={colors.faint} style={{ alignSelf: 'center' }}>Certificaciones</T>
              </View>
            </Card>
          );
        })}

        <Card>
          <T v="h3" style={{ marginBottom: 10 }}>Práctica · 12 semanas</T>
          <Heatmap minutes={minutesPerDay} goal={goalTotal} />
          <T v="tiny" color={colors.faint} style={{ marginTop: 8 }} center>Más intenso = más cerca de tu meta diaria de {goalTotal} min</T>
        </Card>

        <Card onPress={() => router.push('/achievements')}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <T v="h3">Logros</T>
            <T v="small" color={colors.mint} bold>{unlocked.length}/{list.length} ›</T>
          </View>
          {recent.length === 0 ? (
            <T v="small" color={colors.dim}>Aún no has desbloqueado ninguno. ¡La primera lección te da uno!</T>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {recent.map((a) => (
                <View key={a.id} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.card2, alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontSize: 26 }}>{a.emoji}</T>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <T v="h3">Tu cuenta</T>
          <T v="small" color={colors.dim} style={{ marginTop: 2 }}>{user?.email}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: phase === 'error' ? colors.rose : phase === 'offline' ? colors.amber : colors.green }} />
            <T v="small" color={colors.dim} style={{ flex: 1 }}>{syncText}</T>
          </View>
          {phase === 'error' && syncDetail ? (
            <T v="tiny" selectable color={colors.rose} style={{ marginTop: 6 }}>Detalle técnico: {syncDetail}</T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <Button label="Sincronizar" kind="secondary" small disabled={phase === 'syncing'} onPress={() => void syncNow()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cerrar sesión" kind="ghost" small onPress={() => setConfirmOut('normal')} />
            </View>
          </View>
        </Card>
      </ScrollView>

      <ConfirmModal
        visible={confirmOut === 'normal'}
        title="¿Cerrar sesión?"
        message="Guardamos tu progreso en la nube y lo quitamos de este dispositivo. Al volver a entrar lo recuperas todo."
        confirmLabel={busy ? 'Sincronizando…' : 'Cerrar sesión'}
        cancelLabel="Cancelar"
        onConfirm={() => void signOut(false)}
        onCancel={() => setConfirmOut(null)}
      />
      <ConfirmModal
        visible={confirmOut === 'unsynced'}
        title="No pudimos sincronizar"
        message="Sin conexión no podemos guardar tus últimos cambios en la nube. Si cierras sesión ahora, podrías perder la práctica reciente."
        confirmLabel="Cerrar sesión igualmente"
        cancelLabel="Esperar a tener internet"
        danger
        onConfirm={() => void signOut(true)}
        onCancel={() => setConfirmOut(null)}
      />
    </Screen>
  );
}

function ago(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

