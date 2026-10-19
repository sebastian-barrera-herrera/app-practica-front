import { Link, router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { completeSignIn, login } from '@/cloud/auth';
import { Button } from '@/ui/Button';
import { AuthShell } from '@/ui/AuthShell';
import { TextField, type InputRef } from '@/ui/TextField';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'login' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pass = useRef<InputRef>(null);

  const valid = EMAIL.test(email.trim()) && password.length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setError(null);
    setBusy('login');
    try {
      await login({ email, password });
      setBusy('sync');
      await completeSignIn();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : 'No pudimos iniciar sesión.');
    }
  };

  return (
    <AuthShell title="¡Qué bueno verte!" subtitle="Entra para recuperar tu progreso en cualquier dispositivo." mood="happy">
      <View style={{ gap: 14 }}>
        <TextField
          label="Correo"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => pass.current?.focus()}
          placeholder="tu@correo.com"
        />
        <TextField
          ref={pass}
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          password
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          placeholder="Tu contraseña"
        />
        {error ? <T v="small" color={colors.rose} accessibilityRole="alert">{error}</T> : null}
        <Button label={busy === 'sync' ? 'Trayendo tu progreso…' : busy ? 'Entrando…' : 'Entrar'} disabled={!valid || !!busy} onPress={submit} />
        <Link href="/forgot" asChild>
          <T v="small" center bold color={colors.mint} onPress={() => router.push('/forgot')}>¿Olvidaste tu contraseña?</T>
        </Link>
        <T v="small" center color={colors.dim}>
          ¿Primera vez por aquí? <T v="small" bold color={colors.mint} onPress={() => router.replace('/register')}>Crea tu cuenta</T>
        </T>
      </View>
    </AuthShell>
  );
}
