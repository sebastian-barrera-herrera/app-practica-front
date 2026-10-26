import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, awsHue } from './awsui';

// ───────────────────────── evaluación de políticas ─────────────────────────

type Req = 's3:GetObject' | 's3:DeleteObject' | 'ec2:RunInstances';
interface Stmt {
  id: 'a' | 'b' | 'c';
  effect: 'Allow' | 'Deny';
  text: string;
  match: (r: Req) => boolean;
}

const STMTS: Stmt[] = [
  { id: 'a', effect: 'Allow', text: 'Allow  s3:*', match: (r) => r.startsWith('s3:') },
  { id: 'b', effect: 'Deny', text: 'Deny  s3:DeleteObject', match: (r) => r === 's3:DeleteObject' },
  { id: 'c', effect: 'Allow', text: 'Allow  ec2:Describe*', match: (r) => r.startsWith('ec2:Describe') },
];

export function PolicyEval() {
  const [req, setReq] = useState<Req>('s3:DeleteObject');
  const [on, setOn] = useState<Record<string, boolean>>({ a: true, b: true, c: true });
  const { a } = awsHue();
  const live = STMTS.filter((s) => on[s.id] && s.match(req));
  const deny = live.find((s) => s.effect === 'Deny');
  const allow = live.find((s) => s.effect === 'Allow');
  const result = deny ? 'explicitDeny' : allow ? 'allowed' : 'implicitDeny';
  const color = result === 'allowed' ? colors.green : result === 'explicitDeny' ? colors.rose : colors.amber;
  const label = result === 'allowed' ? '✔ PERMITIDO' : result === 'explicitDeny' ? '✘ DENEGADO · Deny explícito' : '✘ DENEGADO · por defecto (nadie lo permitió)';
  const why = deny
    ? 'Hay un Deny que coincide: gana siempre, aunque exista algún Allow.'
    : allow
      ? 'No hay ningún Deny que coincida y sí un Allow que coincide: se permite.'
      : 'Ninguna sentencia activa coincide con la petición: IAM deniega por defecto.';
  return (
    <Frame>
      <T v="label" color={colors.dim}>1 · La petición</T>
      <Tabs
        color={a}
        value={req}
        onChange={setReq}
        items={[
          { id: 's3:GetObject', label: 's3:GetObject' },
          { id: 's3:DeleteObject', label: 's3:DeleteObject' },
          { id: 'ec2:RunInstances', label: 'ec2:RunInstances' },
        ]}
      />
      <T v="label" color={colors.dim}>2 · Sentencias de las políticas (toca para activar/desactivar)</T>
      <View style={{ gap: 6 }}>
        {STMTS.map((s) => {
          const active = on[s.id];
          const hit = active && s.match(req);
          const c = s.effect === 'Allow' ? colors.green : colors.rose;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="switch"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${s.text} ${active ? 'activa' : 'desactivada'}`}
              onPress={() => { tap(); setOn({ ...on, [s.id]: !active }); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: hit ? 2 : 1, borderColor: hit ? c : colors.line, backgroundColor: active ? c + '1F' : 'transparent', opacity: active ? 1 : 0.45 }}
            >
              <T style={{ fontSize: 16 }}>{active ? '☑' : '☐'}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13, flex: 1 }} color={colors.text}>{s.text}</T>
              {hit ? <Pill text="coincide" color={c} size={11} /> : null}
            </Pressable>
          );
        })}
      </View>
      <T v="label" color={colors.dim}>3 · La decisión</T>
      <Animated.View key={result + req} entering={FadeIn.duration(220)} style={{ borderWidth: 2, borderColor: color, borderRadius: radius.md, padding: 12, backgroundColor: color + '1F', gap: 4 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={color}>{label}</T>
        <T v="small" color={colors.text}>{why}</T>
      </Animated.View>
      <Note min={30}>Orden mental: ¿hay un Deny que coincida? → ¿hay un Allow que coincida? → si no, denegado.</Note>
    </Frame>
  );
}

// ───────────────────────── asumir un rol ─────────────────────────

const STEPS = [
  { title: '1 · Pides asumir el rol', text: 'Ana ejecuta `aws sts assume-role --role-arn …/Auditor`. La petición va firmada con las credenciales de Ana.', who: 'ana' as const },
  { title: '2 · STS comprueba la confianza', text: 'STS lee la política de confianza del rol Auditor: ¿Ana (o su cuenta) está autorizada a asumirlo? Si no, devuelve AccessDenied.', who: 'sts' as const },
  { title: '3 · Credenciales temporales', text: 'STS devuelve un AccessKeyId (ASIA…), una SecretAccessKey y un SessionToken. Caducan en un tiempo limitado (por defecto 1 hora).', who: 'sts' as const },
  { title: '4 · Actúas como el rol', text: 'Ana usa esas credenciales: para AWS ya no es Ana, es «assumed-role/Auditor/sesión», con los permisos del rol y no los suyos.', who: 'rol' as const },
  { title: '5 · Caducan solas', text: 'Pasado el tiempo, las credenciales dejan de funcionar (ExpiredToken). No hay nada que rotar ni borrar: basta volver a asumir el rol.', who: 'ana' as const },
];

export function StsAssume() {
  const [i, setI] = useState(0);
  const { a } = awsHue();
  const step = STEPS[i];
  const actor = (id: 'ana' | 'sts' | 'rol', emoji: string, name: string) => {
    const on = step.who === id;
    return (
      <View style={{ flex: 1, alignItems: 'center', gap: 4, padding: 8, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? a : colors.line, backgroundColor: on ? a + '22' : 'transparent' }}>
        <T style={{ fontSize: 26 }}>{emoji}</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={on ? colors.text : colors.dim}>{name}</T>
      </View>
    );
  };
  return (
    <Frame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {actor('ana', '🧑', 'Ana')}
        <T color={colors.faint}>{i === 0 ? '➜' : i === 2 ? '⬅' : '·'}</T>
        {actor('sts', '🎫', 'STS')}
        <T color={colors.faint}>{i === 3 ? '➜' : '·'}</T>
        {actor('rol', '🎭', 'Rol Auditor')}
      </View>
      <Explain k={i} title={step.title} color={a}>{step.text}</Explain>
      {i === 2 ? (
        <View style={{ backgroundColor: colors.termBg, borderRadius: radius.sm, padding: 10, borderWidth: 1, borderColor: colors.line }}>
          <T style={{ fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 17 }} color={colors.termText}>{'AccessKeyId     ASIAXXXXXXXXXXXXXXXX\nSecretAccessKey wJalr…\nSessionToken    IQoJb3JpZ2luX2Vj…\nExpiration      +1 h'}</T>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Paso anterior" disabled={i === 0} onPress={() => { tap(); setI(i - 1); }} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, opacity: i === 0 ? 0.4 : 1 }}>
          <T bold color={colors.dim}>◀ Anterior</T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={i === STEPS.length - 1 ? 'Reiniciar' : 'Siguiente paso'} onPress={() => { tap(); setI(i === STEPS.length - 1 ? 0 : i + 1); }} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: a }}>
          <T bold color="#0B0B14">{i === STEPS.length - 1 ? '↺ Reiniciar' : 'Siguiente ▶'}</T>
        </Pressable>
      </View>
    </Frame>
  );
}
