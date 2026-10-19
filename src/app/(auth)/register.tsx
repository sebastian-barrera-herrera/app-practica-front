import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { completeSignIn, register } from '@/cloud/auth';
import { MIN_PASSWORD } from '@/cloud/config';
import { Button } from '@/ui/Button';
import { AuthShell } from '@/ui/AuthShell';
import { TextField, type InputRef } from '@/ui/TextField';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const mail = useRef<InputRef>(null);
  const pass = useRef<InputRef>(null);
  const pass2 = useRef<InputRef>(null);

  const errors = {
    name: name.trim().length < 2 ? 'Escribe tu nombre (mínimo 2 letras).' : null,
    email: !EMAIL.test(email.trim()) ? 'Ese correo no parece válido.' : null,
    password: password.length < MIN_PASSWORD ? `Mínimo ${MIN_PASSWORD} caracteres.` : null,
    again: again !== password ? 'Las contraseñas no coinciden.' : null,
  };
  const valid = !errors.name && !errors.email && !errors.password && !errors.again;

  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setError(null);
    setBusy(true);
    try {
      await register({ name, email, password });
      await completeSignIn();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'No pudimos crear la cuenta.');
    }
  };

  return (
    <AuthShell title="Crea tu cuenta" subtitle="Así Pingüi sabrá cómo llamarte y tu progreso quedará a salvo." mood="cheer">
      <View style={{ gap: 14 }}>
        <TextField label="Tu nombre" value={name} onChangeText={(v) => setName(v.slice(0, 30))} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => mail.current?.focus()} placeholder="Ej. Sebastián" error={touched ? errors.name : null} />
        <TextField ref={mail} label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => pass.current?.focus()} placeholder="tu@correo.com" error={touched ? errors.email : null} hint="Lo usarás para entrar y recuperar tu contraseña." />
        <TextField ref={pass} label="Contraseña" value={password} onChangeText={setPassword} password autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => pass2.current?.focus()} placeholder={`Mínimo ${MIN_PASSWORD} caracteres`} error={touched ? errors.password : null} />
        <TextField ref={pass2} label="Repite la contraseña" value={again} onChangeText={setAgain} password autoCapitalize="none" autoComplete="new-password" returnKeyType="go" onSubmitEditing={submit} placeholder="Otra vez, para evitar errores" error={touched ? errors.again : null} />
        {error ? <T v="small" color={colors.rose} accessibilityRole="alert">{error}</T> : null}
        <Button label={busy ? 'Creando cuenta…' : 'Crear cuenta'} disabled={busy} onPress={submit} />
        <T v="small" center color={colors.dim}>
          ¿Ya tienes cuenta? <T v="small" bold color={colors.mint} onPress={() => router.replace('/login')}>Entra</T>
        </T>
      </View>
    </AuthShell>
  );
}
