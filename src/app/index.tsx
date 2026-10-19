import { Redirect } from 'expo-router';
import React from 'react';
import { useAuth } from '@/cloud/auth';
import { useGame } from '@/game/store';

/** Punto de entrada: según la sesión, lleva a la bienvenida, al asistente inicial o a «Hoy». */
export default function Index() {
  const status = useAuth((s) => s.status);
  const onboarded = useGame((s) => s.settings.onboarded);
  if (status !== 'in') return <Redirect href="/welcome" />;
  return <Redirect href={onboarded ? '/(tabs)/today' : '/onboarding'} />;
}
