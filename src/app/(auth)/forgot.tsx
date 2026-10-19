import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { requestPasswordReset, resetPassword } from '@/cloud/auth';
import { MIN_PASSWORD } from '@/cloud/config';
import { Button } from '@/ui/Button';
import { AuthShell } from '@/ui/AuthShell';
import { TextField, type InputRef } from '@/ui/TextField';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Forgot() {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const pass = useRef<InputRef>(null);

  const send = async () => {
    if (!EMAIL.test(email.trim()) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setStep('code');
      setInfo(`Te enviamos un código a ${email.trim()}. Puede tardar un minuto; revisa también el spam.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos enviar el código.');
    }
    setBusy(false);
  };

  const confirm = async () => {
    if (code.trim().length < 4 || password.length < MIN_PASSWORD || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword({ email, otp: code, password });
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos cambiar la contraseña.');
    }
    setBusy(false);
  };

  if (step === 'done') {
    return (
      <AuthShell title="¡Contraseña cambiada!" subtitle="Ya puedes entrar con tu nueva contraseña." mood="cheer" back={false}>
        <Button label="Ir a iniciar sesión" onPress={() => router.replace('/login')} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Recupera tu contraseña" subtitle={step === 'email' ? 'Escribe tu correo y te mandamos un código de 6 dígitos.' : 'Pon el código que te llegó y elige una contraseña nueva.'} mood="think">
      <View style={{ gap: 14 }}>
        {step === 'email' ? (
          <>
            <TextField label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="go" onSubmitEditing={send} placeholder="tu@correo.com" />
            {error ? <T v="small" color={colors.rose} accessibilityRole="alert">{error}</T> : null}
            <Button label={busy ? 'Enviando…' : 'Enviar código'} disabled={!EMAIL.test(email.trim()) || busy} onPress={send} />
          </>
        ) : (
          <>
            {info ? <T v="small" color={colors.dim}>{info}</T> : null}
            <TextField label="Código" value={code} onChangeText={(v) => setCode(v.replace(/\s/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" returnKeyType="next" onSubmitEditing={() => pass.current?.focus()} placeholder="123456" />
            <TextField ref={pass} label="Contraseña nueva" value={password} onChangeText={setPassword} password autoCapitalize="none" autoComplete="new-password" returnKeyType="go" onSubmitEditing={confirm} placeholder={`Mínimo ${MIN_PASSWORD} caracteres`} error={password.length > 0 && password.length < MIN_PASSWORD ? `Mínimo ${MIN_PASSWORD} caracteres.` : null} />
            {error ? <T v="small" color={colors.rose} accessibilityRole="alert">{error}</T> : null}
            <Button label={busy ? 'Guardando…' : 'Cambiar contraseña'} disabled={code.trim().length < 4 || password.length < MIN_PASSWORD || busy} onPress={confirm} />
            <T v="small" center bold color={colors.mint} onPress={send}>Reenviar código</T>
          </>
        )}
      </View>
    </AuthShell>
  );
}
