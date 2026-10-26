import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { COURSE_LIST } from '@/content';
import { levelCoins, levelReward } from '@/game/economy';
import { levelWorlds } from '@/game/exams';
import { worldCleared } from '@/game/progress';
import { flat, shownCourses } from '@/game/root';
import { useGame } from '@/game/store';
import { levelProgress, levelRank, xpForLevel } from '@/game/xp';
import { Card } from '@/ui/Card';
import { courseColor } from '@/ui/courseColors';
import { Mascot } from '@/ui/Mascot';
import { ProgressBar } from '@/ui/ProgressBar';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, ink, radius } from '@/ui/theme';

const XP_SOURCES: [string, string][] = [
  ['✅', 'Pregunta acertada a la primera: +5 XP'],
  ['🧩', 'Reto práctico resuelto: +15 XP'],
  ['📘', 'Lección terminada: +5 XP (⭐⭐: +10, ⭐⭐⭐: +20)'],
  ['🔥', 'Combo de 5, 8 o 12 aciertos seguidos: +5, +10 o +15 XP'],
  ['⏱️', 'Cumplir la meta diaria de un curso: +40 XP'],
  ['🔁', 'Terminar un repaso: hasta +40 XP'],
  ['📝', 'Aprobar el examen de una zona: +80 XP'],
  ['🏅', 'Certificaciones: +200, +300 o +450 XP'],
  ['⚡', 'Logros y misiones: XP y monedas extra'],
];

export default function Levels() {
  const root = useGame();
  const lp = levelProgress(root.xp);
  const top = Math.max(12, lp.level + 5);
  const rows = Array.from({ length: top }, (_, i) => i + 1);
  const shown = shownCourses(root);
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Niveles</T>
          <T v="tiny" color={colors.dim}>Tu nivel, tus rangos y las etapas de cada curso</T>
        </View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
        <Card elevated accent={colors.violet}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Mascot size={78} mood="cool" />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="tiny" bold color={colors.violet}>TU NIVEL</T>
              <T v="h1">{lp.emoji} Nivel {lp.level}</T>
              <T bold color={colors.violet}>{lp.title}</T>
            </View>
          </View>
          <ProgressBar value={lp.pct} color={colors.cyan} height={12} style={{ marginTop: 12 }} />
          <T v="small" color={colors.dim} style={{ marginTop: 6 }}>
            {root.xp.toLocaleString('es')} XP en total · te faltan {(lp.need - lp.into).toLocaleString('es')} XP para el nivel {lp.level + 1} ({levelRank(lp.level + 1).emoji} {levelRank(lp.level + 1).title}) y ganarás 🪙 {levelReward(lp.level + 1)}
          </T>
        </Card>

        <Card>
          <T v="h3">Dos clases de «nivel», no las confundas</T>
          <View style={{ gap: 12, marginTop: 10 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <T style={{ fontSize: 26 }}>⭐</T>
              <T v="small" style={{ flex: 1 }}>
                <T v="small" bold>Nivel de jugador</T> (el «Nivel {lp.level}» de tu perfil). Sube con el XP que ganas en <T v="small" bold>todos</T> tus cursos juntos. Cada nivel te da un rango, una insignia y monedas 🪙.
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <T style={{ fontSize: 26 }}>🗺️</T>
              <T v="small" style={{ flex: 1 }}>
                <T v="small" bold>Etapas del curso</T>: cada curso se divide en <T v="small" bold>Básico, Intermedio y Avanzado</T>. Las verás como franjas de color en la pestaña <T v="small" bold>Ruta</T>, y al terminar una etapa puedes sacar su certificación (🥉 🥈 🥇).
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <T style={{ fontSize: 26 }}>🔒</T>
              <T v="small" style={{ flex: 1 }}>
                <T v="small" bold>Cómo se abre una zona</T>: hay que <T v="small" bold>superar la anterior</T>, es decir, terminar sus lecciones, la <T v="small" bold>misión final 🥋</T> y aprobar su <T v="small" bold>examen 📝</T>. Si ya dominas un tema, el <T v="small" bold>examen de salto ⚡</T> te deja entrar sin pasar por todo eso.
              </T>
            </View>
          </View>
        </Card>

        {shown.length > 0 && (
          <Card>
            <T v="h3">Tus etapas por curso</T>
            <View style={{ gap: 14, marginTop: 10 }}>
              {COURSE_LIST.filter((c) => shown.includes(c.id) && c.worlds.length > 0).map((c) => {
                const s = flat(root, c.id);
                const col = courseColor(c.id);
                return (
                  <View key={c.id} style={{ gap: 8 }}>
                    <T v="small" bold color={ink(col)}>{c.emoji} {c.name}</T>
                    {c.levels.map((lv) => {
                      const ws = levelWorlds(c, lv.id);
                      const done = ws.filter((w) => worldCleared(s, w)).length;
                      const cert = s.exams[`cert-${lv.id}`]?.passed;
                      return (
                        <View key={lv.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <T style={{ fontSize: 20 }}>{lv.emoji}</T>
                          <View style={{ flex: 1, gap: 4 }}>
                            <T v="tiny" bold>{lv.title.replace('Nivel ', '')} · {lv.subtitle}</T>
                            <ProgressBar value={ws.length ? done / ws.length : 0} color={lv.color} height={7} />
                          </View>
                          <T v="tiny" color={colors.dim}>{done}/{ws.length} zonas</T>
                          <T style={{ fontSize: 18, opacity: cert ? 1 : 0.25 }}>{lv.id === 'basico' ? '🥉' : lv.id === 'intermedio' ? '🥈' : '🥇'}</T>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        <Card>
          <T v="h3">Cómo ganar XP</T>
          <View style={{ gap: 8, marginTop: 10 }}>
            {XP_SOURCES.map(([e, t]) => (
              <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <T style={{ fontSize: 20 }}>{e}</T>
                <T v="small" style={{ flex: 1 }}>{t}</T>
              </View>
            ))}
          </View>
        </Card>

        <T v="label" color={colors.dim}>Todos los niveles</T>
        {rows.map((n) => {
          const r = levelRank(n);
          const reached = n <= lp.level;
          const current = n === lp.level;
          return (
            <View
              key={n}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: radius.lg,
                borderWidth: current ? 2 : 1,
                borderColor: current ? colors.violet : colors.line,
                backgroundColor: current ? colors.violet + '1A' : colors.card,
                opacity: reached ? 1 : 0.7,
              }}
            >
              <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: reached ? colors.violet + '22' : colors.card2, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ fontSize: 24, opacity: reached ? 1 : 0.4 }}>{reached ? r.emoji : '🔒'}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T v="h3">Nivel {n} · {r.title}{current ? '  ← tú' : ''}</T>
                <T v="tiny" color={colors.dim}>{xpForLevel(n).toLocaleString('es')} XP{n > 1 ? ` · +🪙 ${levelReward(n)} (total 🪙 ${levelCoins(n)})` : ' · punto de partida'}</T>
              </View>
              {reached ? <T color={colors.green} bold>✓</T> : null}
            </View>
          );
        })}
        <T v="tiny" color={colors.faint} center>Tras el nivel 12 sigues siendo «Leyenda» 👑 y los niveles siguen subiendo.</T>
      </ScrollView>
    </Screen>
  );
}
