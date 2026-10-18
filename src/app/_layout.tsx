import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { useFonts } from 'expo-font';
import { Redirect, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useGame, useHydrated } from '@/game/store';
import { setHaptics } from '@/lib/haptics';
import { installNotificationRouting } from '@/lib/notify';
import { EditorHost } from '@/ui/EditorHost';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, JetBrainsMono_400Regular, JetBrainsMono_700Bold });
  const hydrated = useHydrated();
  const onboarded = useGame((s) => s.settings.onboarded);
  const haptics = useGame((s) => s.settings.haptics);
  const pathname = usePathname();

  useEffect(() => {
    setHaptics(haptics);
  }, [haptics]);

  useEffect(() => {
    if (fontsLoaded && hydrated) SplashScreen.hide();
  }, [fontsLoaded, hydrated]);

  useEffect(() => installNotificationRouting(), []);

  if (!fontsLoaded || !hydrated) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!onboarded && pathname !== '/onboarding') return <Redirect href="/onboarding" />;

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="lesson/[id]" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="session/[mode]" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
      </Stack>
      <EditorHost />
    </>
  );
}
