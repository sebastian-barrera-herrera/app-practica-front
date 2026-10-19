/**
 * Reloj de estudio: cuenta SOLO el tiempo de práctica activa de un curso (lección, sesión, laboratorio).
 * Cuenta mientras: la app está en primer plano, hay un «contexto de estudio» (un curso) y hubo una interacción
 * en los últimos 2 minutos. Acumula en memoria y vuelca a la store cada pocos segundos.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import type { CourseId } from '@/content/types';
import { useGame } from '@/game/store';

const IDLE_MS = 120_000;
const FLUSH_EVERY_S = 10;

let context: CourseId | null = null;
let lastTouch = 0;
let pending = 0;
let foreground = true;
const goalListeners = new Set<(e: { course: CourseId; bonusXp: number; dayDone: boolean }) => void>();

export const getStudyContext = (): CourseId | null => context;
export const markInteraction = () => {
  lastTouch = Date.now();
};
export const onGoalReached = (fn: (e: { course: CourseId; bonusXp: number; dayDone: boolean }) => void) => {
  goalListeners.add(fn);
  return () => {
    goalListeners.delete(fn);
  };
};

function flush() {
  if (!context || pending <= 0) return;
  const secs = pending;
  pending = 0;
  const course = context;
  const r = useGame.getState().addStudy(course, secs);
  if (r.reached) for (const l of goalListeners) l({ course, bonusXp: r.bonusXp, dayDone: r.dayDone });
}

export function setStudyContext(c: CourseId | null) {
  if (c !== context) {
    flush();
    context = c;
    pending = 0;
  }
  if (c) markInteraction();
}

/** Marca esta pantalla como «práctica de <curso>» mientras esté enfocada. */
export function useStudyContext(course: CourseId | null | undefined, enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !course) return undefined;
      setStudyContext(course);
      return () => {
        flush();
        if (context === course) context = null;
      };
    }, [course, enabled]),
  );
}

/** Se monta una vez en la raíz: ticker + captura de interacciones. */
export function StudyClock({ children }: { children: React.ReactNode }) {
  const last = useRef(Date.now());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      foreground = st === 'active';
      if (!foreground) flush();
      last.current = Date.now();
    });
    const id = setInterval(() => {
      const t = Date.now();
      const dt = Math.min(5, (t - last.current) / 1000); // nunca más de 5 s por tic (suspensiones del sistema)
      last.current = t;
      if (!foreground || !context) return;
      if (t - lastTouch > IDLE_MS) return;
      pending += dt;
      if (pending >= FLUSH_EVERY_S) {
        const whole = Math.floor(pending);
        pending -= whole;
        const secs = whole;
        const course = context;
        const r = useGame.getState().addStudy(course, secs);
        if (r.reached) for (const l of goalListeners) l({ course, bonusXp: r.bonusXp, dayDone: r.dayDone });
      }
    }, 1000);
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  const web = { onPointerDown: markInteraction, onKeyDown: markInteraction } as object;
  return (
    <View style={{ flex: 1 }} onTouchStart={markInteraction} {...web}>
      {children}
    </View>
  );
}
