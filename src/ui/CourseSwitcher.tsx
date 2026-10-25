import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { COURSE_LIST, type CourseDef } from '@/content';
import type { CourseId } from '@/content/types';
import { useGame } from '@/game/store';
import { select } from '@/lib/haptics';
import { courseColor } from './courseColors';
import { T } from './Text';
import { colors, radius } from './theme';

function pct(course: CourseDef, lessons: Record<string, { done: boolean }>): number {
  const total = course.lessons.length;
  if (!total) return 0;
  return Math.round((course.lessons.filter((l) => lessons[l.id]?.done).length / total) * 100);
}

/**
 * Selector de curso: solo los cursos que el alumno eligió («Mis cursos»). El «＋» abre el catálogo para añadir otros.
 * Cambia el curso activo de Ruta, Practicar y Laboratorio.
 */
export function CourseSwitcher() {
  const active = useGame((s) => s.active);
  const courses = useGame((s) => s.courses);
  const on = useGame((s) => s.settings.courseOn);
  const setActive = useGame((s) => s.setActive);
  const mine = COURSE_LIST.filter((c) => on[c.id]);
  const hasMore = COURSE_LIST.some((c) => !on[c.id]);
  const compact = mine.length >= 3;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
      {mine.map((c) => {
        const sel = c.id === active;
        const col = courseColor(c.id);
        const p = pct(c, courses[c.id].lessons);
        return (
          <Pressable
            key={c.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={`Curso ${c.name}, ${p} % completado`}
            onPress={() => {
              if (!sel) {
                select();
                setActive(c.id as CourseId);
              }
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: compact ? 6 : 10,
              paddingVertical: 10,
              paddingHorizontal: compact ? 8 : 12,
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: sel ? col : colors.line,
              backgroundColor: sel ? col + '22' : colors.card,
              opacity: sel ? 1 : 0.8,
            }}
          >
            <T style={{ fontSize: compact ? 22 : 26 }}>{c.emoji}</T>
            <View style={{ flex: 1 }}>
              <T v="h3" numberOfLines={1} color={sel ? col : colors.text}>{c.name}</T>
              {compact ? null : <T v="tiny" color={colors.dim}>{c.worlds.length ? `${p} % completado` : 'Próximamente'}</T>}
            </View>
          </Pressable>
        );
      })}
      {hasMore && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Añadir otro curso"
          onPress={() => {
            select();
            router.push('/courses');
          }}
          style={{ width: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.card }}
        >
          <T style={{ fontSize: 22 }} color={colors.dim}>＋</T>
        </Pressable>
      )}
    </View>
  );
}

/** Cabecera de pantalla con la identidad del curso (para que nunca se confundan). */
export function CourseHeader({ course, title, subtitle, right }: { course: CourseDef; title: string; subtitle?: string; right?: React.ReactNode }) {
  const col = courseColor(course.id);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: col + '26', borderWidth: 1.5, borderColor: col, alignItems: 'center', justifyContent: 'center' }}>
        <T style={{ fontSize: 24 }}>{course.emoji}</T>
      </View>
      <View style={{ flex: 1 }}>
        <T v="tiny" bold color={col}>{course.name.toUpperCase()}</T>
        <T v="h1" numberOfLines={1}>{title}</T>
        {subtitle ? <T v="tiny" color={colors.dim} numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

