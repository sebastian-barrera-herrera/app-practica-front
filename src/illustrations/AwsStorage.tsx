import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, awsHue } from './awsui';

// ───────────────────────── clases de almacenamiento ─────────────────────────

type Cls = 'standard' | 'tiering' | 'ia' | 'onezone' | 'glacierir' | 'glacier' | 'deep';

const CLASSES: Record<Cls, { label: string; store: number; fetch: string; speed: number; use: string; min: string; color: () => string }> = {
  standard: { label: 'Standard', store: 100, fetch: 'sin cargo', speed: 0, use: 'Datos de uso frecuente: webs, aplicaciones, análisis.', min: 'sin mínimo', color: () => colors.cyan },
  tiering: { label: 'Intelligent-Tiering', store: 100, fetch: 'sin cargo', speed: 0, use: 'No conoces el patrón de acceso: S3 mueve cada objeto al nivel más barato según su uso (con una pequeña cuota de supervisión).', min: 'sin mínimo', color: () => colors.violet },
  ia: { label: 'Standard-IA', store: 54, fetch: 'cuota por GB', speed: 0, use: 'Acceso poco frecuente, pero cuando hace falta debe ser inmediato (copias, datos antiguos).', min: '30 días · 128 KB', color: () => colors.green },
  onezone: { label: 'One Zone-IA', store: 43, fetch: 'cuota por GB', speed: 0, use: 'Igual que IA pero en una sola zona de disponibilidad: más barata y menos resistente. Para datos que puedes recrear.', min: '30 días · 128 KB', color: () => colors.mint },
  glacierir: { label: 'Glacier Instant', store: 17, fetch: 'cuota alta por GB', speed: 0, use: 'Archivo al que accedes una vez por trimestre, pero lo necesitas en milisegundos.', min: '90 días', color: () => colors.amber },
  glacier: { label: 'Glacier Flexible', store: 16, fetch: 'por restauración', speed: 2, use: 'Archivo que se recupera en minutos u horas (copias, medios).', min: '90 días', color: () => colors.rose },
  deep: { label: 'Glacier Deep Archive', store: 4, fetch: 'por restauración', speed: 3, use: 'El más barato: archivo de años (normativa, histórico). Recuperación en 12-48 horas.', min: '180 días', color: () => colors.violet },
};
const CLASS_ORDER: Cls[] = ['standard', 'tiering', 'ia', 'onezone', 'glacierir', 'glacier', 'deep'];
const SPEED = ['milisegundos', 'segundos-minutos', 'minutos a horas', '12-48 horas'];

export function S3Classes() {
  const [k, setK] = useState<Cls>('ia');
  const info = CLASSES[k];
  const c = info.color();
  return (
    <Frame>
      <T v="label" color={colors.dim}>Precio relativo de guardar un GB al mes (Standard = 100)</T>
      <View style={{ gap: 6 }}>
        {CLASS_ORDER.map((x) => {
          const i = CLASSES[x];
          const on = x === k;
          return (
            <Pressable key={x} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={i.label} onPress={() => { tap(); setK(x); }} style={{ gap: 3, opacity: on ? 1 : 0.65 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={on ? i.color() : colors.dim}>{i.label}</T>
                <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim}>{i.store}</T>
              </View>
              <View style={{ height: 14, borderRadius: 7, backgroundColor: colors.line, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(3, i.store)}%`, height: '100%', backgroundColor: i.color() }} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pill text={`⏱ ${SPEED[info.speed]}`} color={c} />
        <Pill text={`↩ ${info.fetch}`} color={c} />
        <Pill text={`⏳ ${info.min}`} color={c} />
      </View>
      <Explain k={k} title={info.label} color={c}>{info.use}</Explain>
      <Note min={30}>Cuanto más barato guardar, más caro (o lento) recuperar. Los precios son orientativos: mira la calculadora de AWS.</Note>
    </Frame>
  );
}

// ───────────────────────── ¿quién puede leer el objeto? ─────────────────────────

type Who = 'anon' | 'iam' | 'presigned';

export function S3Security() {
  const [who, setWho] = useState<Who>('anon');
  const [bpa, setBpa] = useState(true);
  const [pub, setPub] = useState(true);
  const [iam, setIam] = useState(false);
  const { a } = awsHue();

  const publicWorks = pub && !bpa;
  let ok: boolean;
  let why: string;
  if (who === 'anon') {
    ok = publicWorks;
    why = !pub ? 'Sin credenciales, la política del bucket tendría que permitir a «*». No lo hace.' : bpa ? 'La política pública existe, pero Block Public Access la anula: nadie anónimo entra.' : 'La política del bucket permite GetObject a todo el mundo y BPA no lo bloquea.';
  } else if (who === 'iam') {
    ok = iam || publicWorks;
    why = iam ? 'Tu política de IAM permite s3:GetObject: dentro de la misma cuenta basta con una de las dos partes.' : publicWorks ? 'IAM no lo permite, pero la política pública del bucket sí y BPA no la bloquea.' : 'Ni tu política de IAM ni la del bucket lo permiten: denegado por defecto.';
  } else {
    ok = iam;
    why = iam ? 'La URL prefirmada actúa con los permisos de quien la firmó: él puede leer el objeto, así que funciona (aunque BPA esté activo).' : 'El firmante no tiene permiso de lectura: la URL se genera, pero al usarla da Access Denied.';
  }
  const color = ok ? colors.green : colors.rose;

  const Toggle = ({ label, on, set, good }: { label: string; on: boolean; set: (v: boolean) => void; good: 'on' | 'off' }) => {
    const bad = good === 'on' ? !on : on;
    const c = bad ? colors.amber : colors.green;
    return (
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={() => { tap(); set(!on); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c, backgroundColor: c + '1F' }}>
        <View style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: on ? c : colors.line, justifyContent: 'center', paddingHorizontal: 2 }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
        </View>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, flex: 1 }} color={colors.text}>{label}</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 11 }} color={c}>{on ? 'SÍ' : 'NO'}</T>
      </Pressable>
    );
  };

  return (
    <Frame>
      <T v="label" color={colors.dim}>1 · Quién pide el objeto</T>
      <Tabs
        color={a}
        value={who}
        onChange={setWho}
        items={[
          { id: 'anon', label: 'anónimo (curl)' },
          { id: 'iam', label: 'usuario de la cuenta' },
          { id: 'presigned', label: 'URL prefirmada' },
        ]}
      />
      <T v="label" color={colors.dim}>2 · Configuración del bucket</T>
      <View style={{ gap: 6 }}>
        <Toggle label="Block Public Access activado" on={bpa} set={setBpa} good="on" />
        <Toggle label="Política de bucket: Allow GetObject a «*»" on={pub} set={setPub} good="off" />
        <Toggle label="Política de IAM de tu usuario permite GetObject" on={iam} set={setIam} good="on" />
      </View>
      <View style={{ padding: 10, borderRadius: radius.sm, borderWidth: 1.5, borderColor: color, backgroundColor: color + '1F' }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={color}>{ok ? '✔ 200 OK: se descarga' : '✘ 403 Access Denied'}</T>
      </View>
      <Explain k={`${who}${bpa}${pub}${iam}`} title="Por qué" color={color}>{why}</Explain>
    </Frame>
  );
}
