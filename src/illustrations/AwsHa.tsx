import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, Stepper, Toggle, awsHue } from './awsui';

const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, opacity: disabled ? 0.4 : 1 }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

// ───────────────────────── el camino de una petición por el balanceador ─────────────────────────

interface Srv {
  id: string;
  zone: string;
  up: boolean;
}

export function ElbFlow() {
  const [servers, setServers] = useState<Srv[]>([
    { id: 'web-a', zone: 'zona A', up: true },
    { id: 'web-b', zone: 'zona B', up: true },
    { id: 'web-c', zone: 'zona B', up: true },
  ]);
  const [sent, setSent] = useState<Record<string, number>>({});
  const [lastKey, setLastKey] = useState(0);
  const [lost, setLost] = useState(0);
  const { a } = awsHue();
  const healthy = servers.filter((s) => s.up);
  const total = Object.values(sent).reduce((x, y) => x + y, 0);
  const send = () => {
    if (!healthy.length) {
      setLost((n) => n + 6);
      setLastKey((k) => k + 1);
      return;
    }
    const next = { ...sent };
    for (let i = 0; i < 6; i++) {
      const s = healthy[(total + i) % healthy.length];
      next[s.id] = (next[s.id] ?? 0) + 1;
    }
    setSent(next);
    setLastKey((k) => k + 1);
  };
  const toggle = (id: string) => {
    setServers((l) => l.map((s) => (s.id === id ? { ...s, up: !s.up } : s)));
    setSent({});
    setLost(0);
  };
  const max = Math.max(1, ...Object.values(sent));
  return (
    <Frame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill text="👤 Usuarios" color={colors.cyan} />
        <T color={colors.dim}>→</T>
        <Pill text="⚖️ ALB · HTTP:80" color={a} solid />
        <T color={colors.dim}>→</T>
        <Pill text="🎯 web-tg" color={colors.violet} />
      </View>
      <T v="label" color={colors.dim}>Toca un servidor para romperlo o repararlo</T>
      {servers.map((s) => {
        const c = s.up ? colors.green : colors.rose;
        const n = sent[s.id] ?? 0;
        return (
          <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${s.id}: ${s.up ? 'sano, pulsa para romperlo' : 'caído, pulsa para repararlo'}`} onPress={() => { tap(); toggle(s.id); }} style={{ borderWidth: 1.5, borderColor: c, backgroundColor: c + '1F', borderRadius: radius.sm, padding: 10, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.text}>{s.up ? '✓' : '✖'} {s.id}</T>
              <T v="tiny" color={colors.dim} style={{ flex: 1 }}>{s.zone}</T>
              <T v="tiny" bold color={c}>{s.up ? 'healthy' : 'unhealthy'}</T>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' }}>
              <View style={{ width: `${(n / max) * 100}%`, height: '100%', backgroundColor: c }} />
            </View>
            <T v="tiny" color={colors.dim}>{n} petición{n === 1 ? '' : 'es'} atendida{n === 1 ? '' : 's'}</T>
          </Pressable>
        );
      })}
      <Btn label="📨 Enviar 6 peticiones" onPress={send} color={a} />
      <Explain k={`${lastKey}${healthy.length}`} title={!healthy.length ? '503: no hay destinos sanos' : healthy.length === servers.length ? 'Reparto por turnos' : `${healthy.length} de ${servers.length} sanos`} color={!healthy.length ? colors.rose : healthy.length === servers.length ? colors.green : colors.amber}>
        {!healthy.length ? `El balanceador no tiene a quién enviar la petición y responde 503 (${lost} perdidas).` : healthy.length === servers.length ? 'Cada petición va al siguiente servidor de la lista: el trabajo se reparte a partes iguales.' : 'El balanceador ha dejado de enviar tráfico a los servidores no sanos: los usuarios no notan nada mientras quede alguno sano.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── Auto Scaling ─────────────────────────

const CAP = 120; // peticiones/s que sostiene una instancia al 100 % de CPU

export function AsgScale() {
  const [load, setLoad] = useState(200);
  const [mode, setMode] = useState<'fixed' | 'auto'>('auto');
  const { a } = awsHue();
  const MIN = 2;
  const MAX = 6;
  const target = 50;
  const n = mode === 'fixed' ? MIN : Math.max(MIN, Math.min(MAX, Math.ceil(load / (CAP * (target / 100)))));
  const cpu = Math.min(100, Math.round((load / (n * CAP)) * 100));
  const color = cpu > 85 ? colors.rose : cpu > target + 10 ? colors.amber : colors.green;
  const dropped = mode === 'fixed' && load > MIN * CAP ? Math.round(((load - MIN * CAP) / load) * 100) : 0;
  return (
    <Frame>
      <Tabs color={a} value={mode} onChange={setMode} items={[{ id: 'fixed', label: 'Capacidad fija (2)' }, { id: 'auto', label: 'Auto Scaling (2–6, CPU 50 %)' }]} />
      <Stepper label="Peticiones por segundo" value={load} min={0} max={1000} step={100} onChange={setLoad} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {Array.from({ length: n }).map((_, i) => (
          <Animated.View key={i} entering={FadeIn.duration(250)} style={{ width: 52, height: 52, borderRadius: radius.sm, borderWidth: 2, borderColor: color, backgroundColor: color + '33', alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{cpu}%</T>
            <T v="tiny" color={colors.dim}>i-{i + 1}</T>
          </Animated.View>
        ))}
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T v="tiny" color={colors.dim}>CPU media</T>
          <T v="tiny" color={colors.dim}>objetivo {target} %</T>
        </View>
        <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.line, overflow: 'hidden' }}>
          <View style={{ width: `${cpu}%`, height: '100%', backgroundColor: color }} />
          <View style={{ position: 'absolute', left: `${target}%`, top: 0, bottom: 0, width: 2, backgroundColor: colors.text }} />
        </View>
      </View>
      <Explain k={`${mode}${n}${cpu}`} title={mode === 'fixed' ? (dropped ? `Saturado: se pierde el ${dropped} % del tráfico` : 'Cabe, pero sin margen') : `${n} instancia${n === 1 ? '' : 's'} para mantener ${target} %`} color={mode === 'fixed' && dropped ? colors.rose : colors.green}>
        {mode === 'fixed' ? (dropped ? 'Con dos instancias no cabe esta carga: la CPU llega al 100 % y las peticiones se encolan o fallan.' : 'Dos instancias bastan ahora, pero cualquier pico las saturaría. Y de noche pagas igual.') : n === MAX && load > MAX * CAP * 0.5 ? 'El grupo ha llegado a su máximo (6): ahí tienes tu tope de gasto. Si hace falta más, súbelo.' : 'El grupo calcula cuántas instancias hacen falta (carga ÷ capacidad útil) y lanza o retira las necesarias. Subir es rápido; bajar espera unos 15 minutos.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── puntos únicos de fallo ─────────────────────────

export function Spof() {
  const [asg, setAsg] = useState(false);
  const [db, setDb] = useState(false);
  const [lb, setLb] = useState(true);
  const [nat, setNat] = useState(false);
  const [down, setDown] = useState(false);
  const { a } = awsHue();
  const parts = [
    { key: 'ALB en 2 zonas', ok: lb, label: 'Entrada' },
    { key: 'Servidores en 2 zonas', ok: asg, label: 'Aplicación' },
    { key: 'RDS Multi-AZ', ok: db, label: 'Base de datos' },
    { key: 'NAT en cada zona', ok: nat, label: 'Salida a internet' },
  ];
  const alive = (ok: boolean) => !down || ok;
  const verdict = parts.every((p) => alive(p.ok));
  const broken = parts.filter((p) => !alive(p.ok));
  const zone = (name: string, isDown: boolean) => (
    <View style={{ flex: 1, gap: 6, padding: 8, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: isDown ? colors.rose : colors.line, backgroundColor: isDown ? colors.rose + '14' : 'transparent' }}>
      <T v="tiny" color={isDown ? colors.rose : colors.dim}>{name}{isDown ? ' · caída 💥' : ''}</T>
      {parts.map((p) => {
        const here = name === 'Zona A' || p.ok;
        if (!here) return null;
        return <Pill key={p.label} text={p.label} color={isDown ? colors.rose : colors.green} dim={isDown} size={11} />;
      })}
    </View>
  );
  return (
    <Frame>
      <Toggle label="Balanceador en 2 zonas" on={lb} set={setLb} good="on" />
      <Toggle label="Grupo de Auto Scaling en 2 zonas (mínimo 2)" on={asg} set={setAsg} good="on" />
      <Toggle label="Base de datos RDS Multi-AZ" on={db} set={setDb} good="on" />
      <Toggle label="Un NAT gateway por zona" on={nat} set={setNat} good="on" />
      <Btn label={down ? '↺ Recuperar la zona A' : '💥 Tumbar la zona A'} onPress={() => setDown(!down)} color={down ? colors.green : colors.rose} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {zone('Zona A', down)}
        {zone('Zona B', false)}
      </View>
      <Explain k={`${down}${verdict}${broken.length}`} title={!down ? 'Todo funciona… por ahora' : verdict ? 'La aplicación sobrevive' : 'La aplicación se cae'} color={!down ? a : verdict ? colors.green : colors.rose}>
        {!down ? 'Con todas las piezas en una sola zona, el día a día funciona. El problema aparece cuando cae la zona: pulsa el botón.' : verdict ? 'Cada capa tenía una réplica en la otra zona: los usuarios siguen siendo atendidos mientras AWS repone lo perdido.' : `Se caen: ${broken.map((p) => p.label.toLowerCase()).join(', ')}. Son puntos únicos de fallo: repártelos en otra zona.`}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── políticas de Route 53 ─────────────────────────

type Policy = 'simple' | 'weighted' | 'latency' | 'failover' | 'geo';
type Where = 'ES' | 'US' | 'JP';

const WHERE: Record<Where, { label: string; ip: string; ie: number; va: number }> = {
  ES: { label: '🇪🇸 España', ip: '203.0.113.25', ie: 30, va: 90 },
  US: { label: '🇺🇸 EE. UU.', ip: '198.51.100.10', ie: 85, va: 25 },
  JP: { label: '🇯🇵 Japón', ip: '192.0.2.50', ie: 220, va: 150 },
};

export function R53Policies() {
  const [policy, setPolicy] = useState<Policy>('latency');
  const [where, setWhere] = useState<Where>('ES');
  const [vaUp, setVaUp] = useState(true);
  const [ieUp, setIeUp] = useState(true);
  const { a } = awsHue();
  const w = WHERE[where];
  const res = useMemo(() => {
    const both = !vaUp && !ieUp;
    const pick = (cands: ('VA' | 'IE')[]): { to: string; note: string } => {
      const ok = cands.filter((c) => (c === 'VA' ? vaUp : ieUp));
      const list = ok.length ? ok : cands;
      return { to: list.map((x) => (x === 'VA' ? 'Virginia' : 'Irlanda')).join(' + '), note: '' };
    };
    if (policy === 'simple') return { to: 'Virginia', note: 'Un solo registro: siempre la misma respuesta, esté sano o no.' };
    if (policy === 'weighted') {
      if (vaUp && ieUp) return { to: '90 % Virginia · 10 % Irlanda', note: 'Cada consulta se reparte según los pesos (despliegue canario).' };
      return { ...pick(['VA', 'IE']), note: both ? 'Sin ninguno sano, Route 53 contesta con todos.' : 'Un destino no sano deja de recibir tráfico y el otro se queda con todo.' };
    }
    if (policy === 'latency') {
      const best: 'VA' | 'IE' = w.ie <= w.va ? 'IE' : 'VA';
      const cands: ('VA' | 'IE')[] = best === 'IE' ? ['IE', 'VA'] : ['VA', 'IE'];
      const first = cands.find((c) => (c === 'VA' ? vaUp : ieUp)) ?? cands[0];
      return { to: first === 'VA' ? 'Virginia' : 'Irlanda', note: `Desde ${w.label}: Irlanda ≈ ${w.ie} ms, Virginia ≈ ${w.va} ms.${first !== best ? ' La más cercana no está sana: contesta la otra.' : ''}` };
    }
    if (policy === 'failover') {
      if (vaUp) return { to: 'Virginia (principal)', note: 'Mientras el principal esté sano, contesta siempre con él.' };
      return { to: ieUp ? 'Irlanda (secundario)' : 'Virginia (todo caído)', note: ieUp ? 'El principal cayó (tras 3 fallos de comprobación) y Route 53 pasa al secundario.' : 'Con los dos caídos contesta con el principal.' };
    }
    const eu = where === 'ES';
    const target = eu ? 'IE' : 'VA';
    const alive = target === 'VA' ? vaUp : ieUp;
    return { to: alive ? (eu ? 'Irlanda' : 'Virginia') : 'Sin respuesta', note: eu ? 'Hay un registro para el continente EU → Irlanda.' : 'Cualquier otro lugar cae en el registro «por defecto» → Virginia.' };
  }, [policy, vaUp, ieUp, where, w]);
  return (
    <Frame>
      <Tabs color={a} value={policy} onChange={setPolicy} items={[{ id: 'simple', label: 'Simple' }, { id: 'weighted', label: 'Ponderada' }, { id: 'latency', label: 'Latencia' }, { id: 'failover', label: 'Failover' }, { id: 'geo', label: 'Geolocalización' }]} />
      <T v="label" color={colors.dim}>¿Desde dónde pregunta el usuario?</T>
      <Tabs color={colors.cyan} value={where} onChange={setWhere} items={(Object.keys(WHERE) as Where[]).map((k) => ({ id: k, label: WHERE[k].label }))} />
      <Toggle label="🇺🇸 Virginia (us-east-1) sana" on={vaUp} set={setVaUp} good="on" />
      <Toggle label="🇮🇪 Irlanda (eu-west-1) sana" on={ieUp} set={setIeUp} good="on" />
      <View style={{ borderWidth: 2, borderColor: a, borderRadius: radius.md, padding: 12, backgroundColor: a + '1F', gap: 4 }}>
        <T v="tiny" color={colors.dim}>dig www.tienda.test desde {w.ip}</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 15 }} color={colors.text}>→ {res.to}</T>
      </View>
      <Explain k={`${policy}${where}${vaUp}${ieUp}`} title="Por qué" color={a}>{res.note}</Explain>
    </Frame>
  );
}

// ───────────────────────── CloudFront: caché, versiones e invalidación ─────────────────────────

interface Log {
  v: number;
  hit: boolean;
}

export function CloudfrontFlow() {
  const [origin, setOrigin] = useState(1);
  const [cached, setCached] = useState<number | null>(null);
  const [age, setAge] = useState(0);
  const [log, setLog] = useState<Log[]>([]);
  const { a } = awsHue();
  const TTL = 24;
  const request = () => {
    const fresh = cached !== null && age < TTL;
    if (fresh) setLog((l) => [{ v: cached!, hit: true }, ...l].slice(0, 5));
    else {
      setCached(origin);
      setAge(0);
      setLog((l) => [{ v: origin, hit: false }, ...l].slice(0, 5));
    }
  };
  const stale = cached !== null && cached !== origin && age < TTL;
  return (
    <Frame>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, padding: 10, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.cyan, backgroundColor: colors.cyan + '1A', gap: 2 }}>
          <T v="tiny" color={colors.dim}>🌍 Borde (caché)</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={colors.text}>{cached === null || age >= TTL ? 'vacía' : `index v${cached}`}</T>
          <T v="tiny" color={colors.dim}>{cached === null || age >= TTL ? ' ' : `hace ${age} h · TTL ${TTL} h`}</T>
        </View>
        <View style={{ flex: 1, padding: 10, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.green, backgroundColor: colors.green + '1A', gap: 2 }}>
          <T v="tiny" color={colors.dim}>🪣 Origen (S3)</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={colors.text}>index v{origin}</T>
          <T v="tiny" color={colors.dim}> </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Btn label="🌐 Pedir la portada" onPress={request} color={a} />
        <Btn label="⬆️ Subir v2 a S3" onPress={() => setOrigin((o) => o + 1)} color={colors.green} />
        <Btn label="🧹 Invalidar /index.html" onPress={() => setCached(null)} color={colors.amber} />
        <Btn label="⏩ Pasar 12 h" onPress={() => setAge((x) => x + 12)} color={colors.violet} disabled={cached === null} />
      </View>
      <View style={{ gap: 4 }}>
        {log.length === 0 ? <T v="tiny" color={colors.dim}>Pide la portada para empezar.</T> : log.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pill text={l.hit ? 'Hit' : 'Miss'} color={l.hit ? colors.green : colors.amber} size={11} />
            <T v="tiny" color={colors.text}>el usuario ve la versión {l.v}{l.v !== origin ? ' (¡desfasada!)' : ''}</T>
          </View>
        ))}
      </View>
      <Explain k={`${origin}${cached}${age}${log.length}`} title={stale ? 'Caché desfasada' : 'X-Cache'} color={stale ? colors.rose : a}>
        {stale ? 'El origen ya tiene la v2, pero cada borde sigue sirviendo su copia hasta que caduque el TTL. Invalida la ruta para forzar que se recargue.' : 'La primera petición es un Miss (va al origen y se guarda); las siguientes, un Hit servido desde el borde.'}
      </Explain>
      <Note min={28}>Mejor que invalidar: ponerle versión al nombre del archivo (app.v2.js).</Note>
    </Frame>
  );
}
