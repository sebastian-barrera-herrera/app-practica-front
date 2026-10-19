import React from 'react';
import { useCourse } from '@/game/store';
import { CourseHeader, CourseSwitcher } from './CourseSwitcher';
import { Card } from './Card';
import { Screen } from './Screen';
import { T } from './Text';
import { colors } from './theme';
import { View } from 'react-native';

/** Laboratorio de Python (se sustituye por el editor + REPL cuando el intérprete esté listo). */
export function PyLab() {
  const { course } = useCourse('python');
  return (
    <Screen>
      <View style={{ gap: 12, paddingTop: 8 }}>
        <CourseSwitcher />
        <CourseHeader course={course} title="Editor de Python" />
        <Card>
          <T color={colors.dim}>Muy pronto.</T>
        </Card>
      </View>
    </Screen>
  );
}
