import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { COURSE_IDS, courseDef } from '@/content';
import type { CourseId } from '@/content/types';
import { flat } from '@/game/root';
import { nextStep, stepRoute } from '@/game/progress';
import { useGame } from '@/game/store';

/**
 * Destino de los recordatorios: lleva a lo siguiente que toca en el curso (lección, misión final o examen) (o a Practicar si ya terminó).
 * Se calcula al abrir, no al programar la notificación, así que siempre es lo que toca ahora.
 */
export default function Go() {
  const { course } = useLocalSearchParams<{ course: string }>();
  const id: CourseId = COURSE_IDS.find((c) => c === course) ?? 'linux';
  const root = useGame.getState();
  const def = courseDef(id);
  React.useEffect(() => {
    useGame.getState().setActive(id);
  }, [id]);
  const next = nextStep(flat(root, id), def.worlds);
  if (!next) return <Redirect href="/(tabs)/practice" />;
  return <Redirect href={stepRoute(next, id)} />;
}
