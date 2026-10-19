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

/** Selector de curso (Linux / Python). Cambia el curso activo de Ruta, Practicar y Laboratorio. */
export function CourseSwitcher() {
  const active = useGame((s) => s.active);
  const courses = useGame((s) => s.courses);
  const setActive = useGame((s) => s.setActive);
  return (
    <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="tablist">
      {COURSE_LIST.map((c) => {
        const on = c.id === active;
        const col = courseColor(c.id);
        const p = pct(c, courses[c.id].lessons);
        return (
          <Pressable
            key={c.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Curso ${c.name}, ${p} % completado`}
            onPress={() => {
              if (!on) {
                select();
                setActive(c.id as CourseId);
              }
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: on ? col : colors.line,
              backgroundColor: on ? col + '22' : colors.card,
              opacity: on ? 1 : 0.8,
            }}
          >
            <T style={{ fontSize: 26 }}>{c.emoji}</T>
            <View style={{ flex: 1 }}>
              <T v="h3" color={on ? col : colors.text}>{c.name}</T>
              <T v="tiny" color={colors.dim}>{c.worlds.length ? `${p} % completado` : 'Próximamente'}</T>
            </View>
          </Pressable>
        );
      })}
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

