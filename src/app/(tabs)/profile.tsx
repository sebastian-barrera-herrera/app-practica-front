import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LEVELS, WORLDS } from '@/content';
import { ACHIEVEMENTS } from '@/game/achievements';
import { useGame } from '@/game/store';
import { dayKey, streakAlive } from '@/game/streak';
import { levelProgress } from '@/game/xp';
import { Card } from '@/ui/Card';
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

/** Últimas 12 semanas de actividad (XP por día), estilo GitHub. */
function Heatmap({ dailyXp, goal }: { dailyXp: Record<string, number>; goal: number }) {
  const weeks = 12;
  const cells = useMemo(() => {
    const out: { key: string; xp: number; future: boolean }[][] = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7; // lunes = 0
    const start = new Date(today);
    start.setDate(today.getDate() - dow - (weeks - 1) * 7);
    for (let w = 0; w < weeks; w++) {
      const col: { key: string; xp: number; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + d);
        const key = dayKey(day.getTime());
        col.push({ key, xp: dailyXp[key] ?? 0, future: day.getTime() > today.getTime() + 43200000 });
      }
      out.push(col);
    }
    return out;
  }, [dailyXp]);
  const shade = (xp: number) => (xp <= 0 ? colors.card2 : xp < goal * 0.5 ? '#0F5B49' : xp < goal ? '#14966F' : colors.mint);
  return (
    <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'center' }}>
      {cells.map((col, i) => (
        <View key={i} style={{ gap: 4 }}>
          {col.map((c) => (
            <View key={c.key} style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: c.future ? 'transparent' : shade(c.xp) }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function Profile() {
  const s = useGame();
  const now = Date.now();
  const lp = levelProgress(s.xp);
  const alive = streakAlive(s.streak, now);
  const lessonsDone = Object.values(s.lessons).filter((l) => l.done).length;
  const totalLessons = WORLDS.reduce((n, w) => n + w.lessons.length, 0);
  const stars = Object.values(s.lessons).reduce((n, l) => n + l.stars, 0);
  const acc = s.stats.questions ? Math.round((s.stats.correct / s.stats.questions) * 100) : 0;
  const list = useMemo(() => ACHIEVEMENTS(WORLDS), []);
  const unlocked = list.filter((a) => s.achievements[a.id]);
  const recent = [...unlocked].sort((a, b) => (s.achievements[b.id] ?? 0) - (s.achievements[a.id] ?? 0)).slice(0, 8);
  const certs = LEVELS.map((l) => ({ l, passed: !!s.exams[`cert-${l.id}`]?.passed }));

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8 }}>
          <Mascot size={92} mood={alive ? 'cool' : 'think'} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h1">{s.settings.name || 'Aprendiz'}</T>
            <T color={colors.violet} bold>Nivel {lp.level} · {lp.title}</T>
            <T v="tiny" color={colors.dim}>{s.xp.toLocaleString('es')} XP en total</T>
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
          <Stat emoji="🔥" value={s.streak.current} label={`Racha · mejor ${s.streak.best}`} color={alive ? colors.orange : colors.faint} />
          <Stat emoji="🛡️" value={s.streak.freezes} label="Escudos de racha" color={colors.cyan} />
          <Stat emoji="📘" value={`${lessonsDone}/${totalLessons}`} label="Lecciones" color={colors.mint} />
          <Stat emoji="⭐" value={stars} label="Estrellas" color={colors.amber} />
          <Stat emoji="🎯" value={`${acc} %`} label={`Acierto · ${s.stats.questions} preguntas`} color={colors.green} />
          <Stat emoji="⌨️" value={s.stats.commands} label="Comandos ejecutados" color={colors.violet} />
        </View>

        <Card>
          <T v="h3" style={{ marginBottom: 10 }}>Actividad · 12 semanas</T>
          <Heatmap dailyXp={s.dailyXp} goal={s.settings.dailyGoal} />
        </Card>

        <Card>
          <T v="h3" style={{ marginBottom: 10 }}>Certificaciones</T>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {certs.map(({ l, passed }) => (
              <View key={l.id} style={{ alignItems: 'center', gap: 4, opacity: passed ? 1 : 0.35 }}>
                <T style={{ fontSize: 40 }}>{l.id === 'basico' ? '🥉' : l.id === 'intermedio' ? '🥈' : '🥇'}</T>
                <T v="tiny" bold color={passed ? l.color : colors.faint}>{l.title.replace('Nivel ', '')}</T>
              </View>
            ))}
          </View>
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
      </ScrollView>
    </Screen>
  );
}
