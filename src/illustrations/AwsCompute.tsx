import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, awsHue } from './awsui';

// ───────────────────────── estados de una instancia ─────────────────────────

type St = 'pending' | 'running' | 'stopping' | 'stopped' | 'shutting-down' | 'terminated';

const ST: Record<St, { label: string; paid: boolean; disk: string; ip: string; next: string; text: string; color: () => string }> = {
  pending: { label: 'pending', paid: false, disk: 'se está preparando', ip: 'se asigna', next: 'running', text: 'La instancia está arrancando: AWS le busca hueco y la enciende. Dura unos segundos.', color: () => colors.amber },
  running: { label: 'running', paid: true, disk: 'conectado y en uso', ip: 'pública asignada', next: 'stop → stopping · terminate → shutting-down · reboot (sigue running)', text: 'Encendida y trabajando. Aquí se paga el cómputo (por segundo en Linux, con un mínimo de 60 s).', color: () => colors.green },
  stopping: { label: 'stopping', paid: false, disk: 'se conserva', ip: 'se libera', next: 'stopped', text: 'Se está apagando. Termina en unos segundos.', color: () => colors.amber },
  stopped: { label: 'stopped', paid: false, disk: 'se conserva (EBS se sigue pagando)', ip: 'la IP pública se pierde (la elástica no)', next: 'start → pending · terminate → shutting-down', text: 'Apagada, pero **no borrada**. No pagas el cómputo; sí el almacenamiento EBS. Al arrancarla recibirá otra IP pública.', color: () => colors.cyan },
  'shutting-down': { label: 'shutting-down', paid: false, disk: 'se borra el raíz', ip: 'se libera', next: 'terminated', text: 'Se está eliminando para siempre.', color: () => colors.rose },
  terminated: { label: 'terminated', paid: false, disk: 'borrado (el raíz, por defecto)', ip: 'liberada', next: '— (no hay vuelta atrás)', text: 'Eliminada. Sigue apareciendo en la lista un rato y luego desaparece. No se puede recuperar.', color: () => colors.rose },
};

const ORDER: St[] = ['pending', 'running', 'stopping', 'stopped', 'shutting-down', 'terminated'];

export function Ec2Lifecycle() {
  const [s, setS] = useState<St>('running');
  const { a } = awsHue();
  const info = ST[s];
  const c = info.color();
  return (
    <Frame>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ORDER.map((k) => {
          const on = k === s;
          const col = ST[k].color();
          return (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={k} onPress={() => { tap(); setS(k); }} style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? col : col + '1F', borderWidth: 1.5, borderColor: col }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={on ? '#0B0B14' : colors.text}>{k}</T>
            </Pressable>
          );
        })}
      </View>
      <Explain k={s} title={info.label} color={c}>{info.text.replace(/\*\*/g, '')}</Explain>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <T v="small" color={colors.dim}>¿Pagas cómputo?</T>
          <Pill text={info.paid ? 'SÍ' : 'NO'} color={info.paid ? colors.rose : colors.green} solid />
        </View>
        <T v="small" color={colors.text}>💽 Disco: <T v="small" bold color={colors.text}>{info.disk}</T></T>
        <T v="small" color={colors.text}>🌐 IP: <T v="small" bold color={colors.text}>{info.ip}</T></T>
        <T v="small" color={colors.text}>➡️ Siguiente: <T v="small" bold color={a}>{info.next}</T></T>
      </View>
      <Note min={30}>Parar ≠ terminar. Parar apaga y conserva; terminar elimina para siempre.</Note>
    </Frame>
  );
}

// ───────────────────────── EBS frente a instance store ─────────────────────────

type Act = 'reboot' | 'stop' | 'terminate' | 'hw';
const ACT_TEXT: Record<Act, string> = {
  reboot: 'Reiniciar es como pulsar el botón de reset: el servidor sigue siendo el mismo y nada se pierde.',
  stop: 'Al parar, la instancia puede arrancar luego en **otro servidor físico**: el instance store (disco del servidor viejo) se pierde; los discos EBS siguen ahí.',
  terminate: 'Al terminar, el disco raíz EBS se borra por defecto (DeleteOnTermination = true), pero un volumen de datos adicional se conserva salvo que lo hayas marcado.',
  hw: 'Si el servidor físico falla, EBS (replicado dentro de su zona) sobrevive; el disco local, no.',
};
const KEEP: Record<Act, [boolean, boolean, boolean]> = {
  reboot: [true, true, true],
  stop: [true, true, false],
  terminate: [false, true, false],
  hw: [true, true, false],
};

export function EbsVsStore() {
  const [act, setAct] = useState<Act>('stop');
  const { a } = awsHue();
  const rows = ['Disco raíz (EBS)', 'Volumen de datos (EBS)', 'Instance store (disco local)'];
  return (
    <Frame>
      <Tabs
        color={a}
        value={act}
        onChange={setAct}
        items={[
          { id: 'reboot', label: 'reiniciar' },
          { id: 'stop', label: 'parar y arrancar' },
          { id: 'terminate', label: 'terminar' },
          { id: 'hw', label: 'falla el servidor' },
        ]}
      />
      <View style={{ gap: 6 }}>
        {rows.map((r, i) => {
          const keep = KEEP[act][i];
          const c = keep ? colors.green : colors.rose;
          return (
            <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c, backgroundColor: c + '1F' }}>
              <T style={{ fontSize: 18 }}>{keep ? '✅' : '💥'}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, flex: 1 }} color={colors.text}>{r}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5 }} color={c}>{keep ? 'se conserva' : 'se pierde'}</T>
            </View>
          );
        })}
      </View>
      <Explain k={act} title="Qué pasa" color={a}>{ACT_TEXT[act].replace(/\*\*/g, '')}</Explain>
    </Frame>
  );
}

// ───────────────────────── modelos de compra ─────────────────────────

type Model = 'ondemand' | 'savings' | 'reserved' | 'spot' | 'dedicated';
const MODELS: Record<Model, { label: string; price: number; commit: string; save: string; risk: string; ideal: string; color: () => string }> = {
  ondemand: { label: 'On-Demand', price: 100, commit: 'Ninguno', save: '—', risk: 'Ninguno', ideal: 'Pruebas, cargas impredecibles o cortas', color: () => colors.cyan },
  savings: { label: 'Savings Plans', price: 45, commit: '1 o 3 años de gasto por hora', save: 'hasta ~70 %', risk: 'Pagas el compromiso aunque no lo uses', ideal: 'Base de uso estable 24/7', color: () => colors.green },
  reserved: { label: 'Reservadas', price: 48, commit: '1 o 3 años de un tipo concreto', save: 'hasta ~70 %', risk: 'Menos flexibles que Savings Plans', ideal: 'Servidores estables y conocidos', color: () => colors.mint },
  spot: { label: 'Spot', price: 22, commit: 'Ninguno', save: 'hasta ~90 %', risk: 'AWS puede interrumpirla (aviso de 2 min)', ideal: 'Lotes, renderizado, CI/CD tolerantes a cortes', color: () => colors.amber },
  dedicated: { label: 'Dedicated', price: 130, commit: 'Host físico para ti', save: '—', risk: 'Caro; capacidad que pagas entera', ideal: 'Licencias por socket/core, cumplimiento', color: () => colors.violet },
};
const MODEL_ORDER: Model[] = ['ondemand', 'savings', 'reserved', 'spot', 'dedicated'];

export function PurchaseModels() {
  const [m, setM] = useState<Model>('savings');
  const info = MODELS[m];
  const c = info.color();
  return (
    <Frame>
      <T v="label" color={colors.dim}>Precio relativo por hora (On-Demand = 100)</T>
      <View style={{ gap: 6 }}>
        {MODEL_ORDER.map((k) => {
          const x = MODELS[k];
          const on = k === m;
          return (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={x.label} onPress={() => { tap(); setM(k); }} style={{ gap: 3, opacity: on ? 1 : 0.65 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={on ? x.color() : colors.dim}>{x.label}</T>
              <View style={{ height: 16, borderRadius: 8, backgroundColor: colors.line, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, (x.price / 130) * 100)}%`, height: '100%', backgroundColor: x.color() }} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <Explain k={m} title={info.label} color={c}>
        Compromiso: {info.commit}. Ahorro típico: {info.save}. Riesgo: {info.risk}. Ideal para: {info.ideal}.
      </Explain>
      <Note min={30}>Los porcentajes son orientativos: compruébalos en la calculadora de precios de AWS.</Note>
    </Frame>
  );
}
