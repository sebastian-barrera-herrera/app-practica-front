import { Stack } from 'expo-router';
import React from 'react';
import { colors } from '@/ui/theme';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}
