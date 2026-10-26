import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect, useMemo, useRef } from 'react';
import { AppState, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initAuth, useAuth } from '@/cloud/auth';
import { startAutoSync } from '@/cloud/sync';
import { dayKey } from '@/game/streak';
import { useResumeReady } from '@/game/resume';
import { useGame, useHydrated } from '@/game/store';
import { setHaptics } from '@/lib/haptics';
import { installNotificationRouting, rescheduleAll, setNotificationRouterReady, setupNotifications } from '@/lib/notify';
import { setSfxEnabled } from '@/lib/sfx';
import { StudyClock } from '@/lib/studyClock';
import { EditorHost } from '@/ui/EditorHost';
import { ToastHost } from '@/ui/Toast';
import { applyTheme, colors, type ThemeName } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, JetBrainsMono_400Regular, JetBrainsMono_700Bold });
  const hydrated = useHydrated();
  const authStatus = useAuth((s) => s.status);
  const onboarded = useGame((s) => s.settings.onboarded);
  const pref = useGame((s) => s.settings.theme);
  const haptics = useGame((s) => s.settings.haptics);
  const hapticsTouch = useGame((s) => s.settings.hapticsTouch);
  const sfxOn = useGame((s) => s.settings.sfx);
  const system = useColorScheme();

  // tema: se aplica ANTES de pintar y la raíz se vuelve a montar al cambiarlo
  const mode: ThemeName = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
  applyTheme(mode);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [mode]);
  useEffect(() => setHaptics(haptics, hapticsTouch), [haptics, hapticsTouch]);
  useEffect(() => setSfxEnabled(sfxOn), [sfxOn]);

  // cuenta: recupera la sesión guardada
  useEffect(() => {
    void initAuth();
  }, []);

  const resumeReady = useResumeReady();
  const ready = fontsLoaded && hydrated && resumeReady && authStatus !== 'loading';
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  // notificaciones: categorías (botones) y enrutado de toques
  useEffect(() => {
    void setupNotifications();
    return installNotificationRouting();
  }, []);
  const inApp = ready && authStatus === 'in' && onboarded;
  useEffect(() => {
    setNotificationRouterReady(inApp);
    return () => setNotificationRouterReady(false);
  }, [inApp]);

  // sincronización con la nube
  useEffect(() => (hydrated ? startAutoSync() : undefined), [hydrated]);

  useNotificationScheduler(inApp);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider key={mode}>
      <StudyClock>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Protected guard={authStatus === 'in' && onboarded}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="lesson/[id]" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="session/[mode]" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="go/[course]" options={{ animation: 'fade' }} />
            <Stack.Screen name="settings" />
            <Stack.Screen name="courses" />
            <Stack.Screen name="levels" />
            <Stack.Screen name="shop" />
            <Stack.Screen name="avatar" />
            <Stack.Screen name="achievements" />
            <Stack.Screen name="library/index" />
            <Stack.Screen name="library/[cmd]" />
          </Stack.Protected>
          <Stack.Protected guard={authStatus === 'in' && !onboarded}>
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={authStatus !== 'in'}>
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
        <EditorHost />
        <ToastHost />
      </StudyClock>
    </SafeAreaProvider>
  );
}

/** Reprograma los avisos cuando cambia algo que los afecta (con retardo) y al pasar la app a segundo plano. */
function useNotificationScheduler(active: boolean) {
  const reminders = useGame((s) => s.settings.reminders);
  const surpriseEnabled = useGame((s) => s.settings.surpriseEnabled);
  const perWeek = useGame((s) => s.settings.surprisePerWeek);
  const winStart = useGame((s) => s.settings.windowStart);
  const winEnd = useGame((s) => s.settings.windowEnd);
  const surpriseSound = useGame((s) => s.settings.surpriseSound);
  const goalMinutes = useGame((s) => s.settings.goalMinutes);
  const courseOn = useGame((s) => s.settings.courseOn);
  const name = useGame((s) => s.settings.name);
  const goalDays = useGame((s) => s.goalDays);
  const streakDay = useGame((s) => s.streak.lastDay);
  const lessonsDone = useGame((s) => Object.keys(s.courses.linux.lessons).length + Object.keys(s.courses.python.lessons).length);
  const today = dayKey(Date.now());
  const goalToday = (goalDays[today] ?? []).join(',');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = useMemo(
    () => JSON.stringify([reminders, surpriseEnabled, perWeek, winStart, winEnd, surpriseSound, goalMinutes, courseOn, name, goalToday, streakDay, lessonsDone, today]),
    [reminders, surpriseEnabled, perWeek, winStart, winEnd, surpriseSound, goalMinutes, courseOn, name, goalToday, streakDay, lessonsDone, today],
  );

  useEffect(() => {
    if (!active) return undefined;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void rescheduleAll(useGame.getState()), 2500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, key]);

  useEffect(() => {
    if (!active) return undefined;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') void rescheduleAll(useGame.getState());
    });
    return () => sub.remove();
  }, [active]);
}
