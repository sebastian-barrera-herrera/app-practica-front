import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { CourseId, LevelId } from '@/content/types';
import { levelWorlds } from '@/game/exams';
import { worldComplete } from '@/game/progress';
import { learnedQuestions, reviewSession, shouldOfferSurprise } from '@/game/sessions';
import { dayKey } from '@/game/streak';
import { useCourse } from '@/game/store';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { CourseHeader, CourseSwitcher } from '@/ui/CourseSwitcher';
import { courseColor } from '@/ui/courseColors';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

function Tile({ emoji, title, desc, color, badge, onPress, delay = 0 }: { emoji: string; title: string; desc: string; color: string; badge?: string; onPress: () => void; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(260)}>
      <Card accent={color} onPress={onPress}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontSize: 28 }}>{emoji}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T v="h3">{title}</T>
            <T v="small" color={colors.dim}>{desc}</T>
          </View>
          {badge ? <Chip label={badge} color={color} /> : <T color={colors.faint}>›</T>}
        </View>
      </Card>
    </Animated.View>
  );
}

const go = (mode: string, course: CourseId) => router.push({ pathname: '/session/[mode]', params: { mode, course } });

export default function Practice() {
  const { s, course } = useCourse();
  const now = Date.now();
  const col = courseColor(course.id);
  const empty = course.worlds.length === 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo se recalcula cuando cambian las lecciones
  const learned = useMemo(() => (empty ? 0 : learnedQuestions(s, course).length), [s.lessons, course.id]);
  const anyLesson = Object.values(s.lessons).some((l) => l.done);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo se recalcula cuando cambian srs/lecciones
  const rev = useMemo(() => (empty ? { items: [], due: 0, fresh: true } : reviewSession(s, now, course)), [s.srs, s.lessons, course.id]);
  const today = dayKey(now);
  const dailyDone = s.daily.day === today && s.daily.done;
  const surprise = !empty && shouldOfferSurprise(s, now);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
        <View style={{ paddingTop: 8, gap: 12 }}>
          <CourseSwitcher />
          <CourseHeader course={course} title="Practicar" subtitle={`Repasa, mide tu nivel y pon a prueba tus reflejos en ${course.name}.`} />
        </View>

        {empty && (
          <Card accent={col}>
            <T v="small" color={colors.dim}>Las pruebas de {course.name} se activan en cuanto estén listas sus lecciones.</T>
          </Card>
        )}

        {surprise && <Tile emoji="🎯" title="¡Examen sorpresa disponible!" desc="5 preguntas rápidas de lo que ya aprendiste" color={colors.rose} badge="YA" onPress={() => go('surprise', course.id)} />}

        {!empty && !anyLesson && (
          <Card accent={colors.amber}>
            <T v="small" color={colors.amber}>💡 Completa tu primera lección de {course.name} para desbloquear el repaso, el reto diario y las sorpresas.</T>
          </Card>
        )}

        {!empty && (
          <>
            <T v="label" color={colors.dim} style={{ marginTop: 6 }}>Cada día</T>
            <Tile
              emoji="🧠"
              title="Repaso espaciado"
              desc={rev.due > 0 ? `${rev.due} pregunta${rev.due === 1 ? '' : 's'} esperan repaso` : anyLesson ? 'Todo al día · puedes repasar de más' : 'Se activa tras tu primera lección'}
              color={colors.violet}
              badge={rev.due > 0 ? String(rev.due) : undefined}
              delay={40}
              onPress={() => (anyLesson ? go('review', course.id) : router.push('/(tabs)/roadmap'))}
            />
            <Tile
              emoji="🗓️"
              title="Reto diario"
              desc={dailyDone ? 'Hecho hoy ✓ · vuelve mañana' : `Un ${course.nouns.challenge} nuevo cada día`}
              color={colors.orange}
              badge={dailyDone ? '✓' : undefined}
              delay={80}
              onPress={() => (anyLesson ? go('daily', course.id) : router.push('/(tabs)/roadmap'))}
            />
            <Tile emoji="⚡" title="Prueba rápida" desc={`60 segundos, combos y récord (${s.stats.blitzBest})`} color={colors.amber} delay={120} onPress={() => go('blitz', course.id)} />

            <T v="label" color={colors.dim} style={{ marginTop: 10 }}>Exámenes de {course.name}</T>
            <Card>
              <View style={{ gap: 12 }}>
                <T v="small" color={colors.dim}>
                  Cada zona tiene su examen al terminar sus lecciones. Las certificaciones evalúan todo un nivel (75 % para aprobar).
                </T>
                {course.levels.map((lv, i) => {
                  const ws = levelWorlds(course, lv.id as LevelId);
                  const ready = ws.length > 0 && (s.settings.unlockAll || ws.every((w) => worldComplete(s, w)));
                  const rec = s.exams[`cert-${lv.id}`];
                  return (
                    <Animated.View key={lv.id} entering={FadeInDown.delay(160 + i * 40)}>
                      <Card accent={lv.color} pad={12} onPress={ready ? () => go(`cert-${lv.id}`, course.id) : undefined} style={{ opacity: ready ? 1 : 0.55 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <T style={{ fontSize: 26 }}>{lv.id === 'basico' ? '🥉' : lv.id === 'intermedio' ? '🥈' : '🥇'}</T>
                          <View style={{ flex: 1 }}>
                            <T v="h3">Certificación {lv.id === 'basico' ? 'Básica' : lv.id === 'intermedio' ? 'Intermedia' : 'Avanzada'}</T>
                            <T v="tiny" color={colors.dim}>
                              {ws.length === 0 ? 'Próximamente' : ready ? (rec ? `Mejor nota: ${Math.round(rec.best * 100)} %${rec.passed ? ' · aprobada ✓' : ''}` : '24 preguntas + 2 retos · 25 min') : '🔒 Termina todas las zonas del nivel'}
                            </T>
                          </View>
                        </View>
                      </Card>
                    </Animated.View>
                  );
                })}
              </View>
            </Card>
          </>
        )}

        <T v="label" color={colors.dim} style={{ marginTop: 10 }}>Explorar</T>
        <Tile emoji="📚" title={course.nouns.library} desc={course.nouns.libraryBlurb} color={colors.cyan} delay={200} onPress={() => router.push({ pathname: '/library', params: { course: course.id } })} />
        <Tile emoji="🎖️" title="Logros" desc="Tus medallas y lo que te falta por conseguir" color={col} delay={240} onPress={() => router.push({ pathname: '/achievements', params: { course: course.id } })} />

        {!empty && (
          <T v="tiny" center color={colors.faint} style={{ marginTop: 8 }}>
            {learned} preguntas en tu banco de {course.name} · {course.worlds.length} zonas disponibles
          </T>
        )}
      </ScrollView>
    </Screen>
  );
}
