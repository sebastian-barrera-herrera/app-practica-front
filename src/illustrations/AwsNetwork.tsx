import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, Toggle, awsHue } from './awsui';

// ───────────────────────── calculadora de CIDR ─────────────────────────

const fmt = (n: number) => n.toLocaleString('es').replace(/ /g, ' ');

export function CidrCalc() {
  const [vpc, setVpc] = useState<16 | 20 | 24>(16);
  const [sub, setSub] = useState<24 | 26 | 28>(24);
  const { a } = awsHue();
  const bits = 32;
  const subnets = sub > vpc ? 2 ** (sub - vpc) : 0;
  const perSubnet = 2 ** (bits - sub);
  const usable = perSubnet - 5;
  const total = 2 ** (bits - vpc);
  const cell = (i: number) => (i < vpc ? colors.cyan : i < sub ? colors.amber : colors.faint);
  return (
    <Frame>
      <T v="label" color={colors.dim}>Tamaño de la VPC</T>
      <Tabs color={a} value={String(vpc) as '16' | '20' | '24'} onChange={(v) => { const n = Number(v) as 16 | 20 | 24; setVpc(n); if (sub <= n) setSub(n === 24 ? 28 : 24); }} items={[{ id: '16', label: '/16' }, { id: '20', label: '/20' }, { id: '24', label: '/24' }]} />
      <T v="label" color={colors.dim}>Tamaño de cada subred</T>
      <Tabs color={a} value={String(sub) as '24' | '26' | '28'} onChange={(v) => { const n = Number(v) as 24 | 26 | 28; if (n > vpc) setSub(n); }} items={[{ id: '24', label: '/24' }, { id: '26', label: '/26' }, { id: '28', label: '/28' }]} />
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 3 }}>
          {Array.from({ length: 32 }, (_, i) => (
            <View key={i} style={{ width: '12.5%', paddingRight: 2 }}>
              <View style={{ height: 14, borderRadius: 3, backgroundColor: cell(i) }} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <Pill text={`red: ${vpc} bits`} color={colors.cyan} />
          <Pill text={`subred: ${Math.max(0, sub - vpc)} bits`} color={colors.amber} />
          <Pill text={`equipos: ${bits - sub} bits`} color={colors.faint} />
        </View>
      </View>
      <Explain k={`${vpc}-${sub}`} title={`10.0.0.0/${vpc} → ${fmt(subnets)} subredes /${sub}`} color={a}>
        La VPC tiene {fmt(total)} direcciones. Cada subred /{sub} tiene {fmt(perSubnet)}; AWS reserva 5, así que quedan {fmt(usable)} utilizables.
      </Explain>
      <Note min={30}>Cada bit que quitas del prefijo duplica el tamaño; cada bit que añades lo divide por la mitad.</Note>
    </Frame>
  );
}

// ───────────────────────── una VPC de dos zonas ─────────────────────────

type Part = 'igw' | 'pub' | 'priv' | 'nat' | 'rtpub' | 'rtpriv';

const PARTS: Record<Part, { title: string; text: string; color: () => string }> = {
  igw: { title: 'Internet gateway', text: 'La puerta de la VPC hacia internet. Gratis y escalable. Solo sirve a las subredes cuya tabla de rutas la usa.', color: () => colors.cyan },
  pub: { title: 'Subred pública (10.0.1.0/24 y 10.0.3.0/24)', text: 'Su tabla de rutas tiene 0.0.0.0/0 → internet gateway. Aquí van los balanceadores, los bastiones y los NAT gateway.', color: () => colors.green },
  priv: { title: 'Subred privada (10.0.2.0/24 y 10.0.4.0/24)', text: 'Sin ruta a la IGW: nadie puede iniciar una conexión hacia estas instancias desde internet. Aquí van aplicaciones y bases de datos.', color: () => colors.violet },
  nat: { title: 'NAT gateway', text: 'Vive en una subred pública con una IP elástica. Deja salir a internet a las instancias privadas (actualizaciones, APIs) sin dejar entrar a nadie.', color: () => colors.amber },
  rtpub: { title: 'Tabla de rutas pública', text: '10.0.0.0/16 → local\n0.0.0.0/0 → igw-…', color: () => colors.green },
  rtpriv: { title: 'Tabla de rutas privada', text: '10.0.0.0/16 → local\n0.0.0.0/0 → nat-…  (o ninguna ruta, si no necesita salir)', color: () => colors.violet },
};

export function VpcLayout() {
  const [sel, setSel] = useState<Part>('pub');
  const { a } = awsHue();
  const box = (id: Part, label: string, sub: string) => {
    const c = PARTS[id].color();
    const on = sel === id;
    return (
      <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => { tap(); setSel(id); }} style={{ flex: 1, minHeight: 56, padding: 8, borderRadius: radius.sm, borderWidth: on ? 2.5 : 1.5, borderColor: c, backgroundColor: c + (on ? '33' : '14'), gap: 2, justifyContent: 'center' }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{label}</T>
        <T v="tiny" color={colors.dim}>{sub}</T>
      </Pressable>
    );
  };
  const info = PARTS[sel];
  return (
    <Frame>
      <Pressable accessibilityRole="button" accessibilityLabel="Internet gateway" accessibilityState={{ selected: sel === 'igw' }} onPress={() => { tap(); setSel('igw'); }} style={{ alignItems: 'center', padding: 8, borderRadius: radius.sm, borderWidth: sel === 'igw' ? 2.5 : 1.5, borderColor: colors.cyan, backgroundColor: colors.cyan + (sel === 'igw' ? '33' : '14') }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>🌍 Internet ⇅ IGW</T>
      </Pressable>
      <View style={{ borderWidth: 2, borderColor: a, borderRadius: radius.md, padding: 8, gap: 8, backgroundColor: a + '10' }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5 }} color={a}>VPC · 10.0.0.0/16</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, gap: 6, padding: 6, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line }}>
            <T v="tiny" color={colors.dim}>us-east-1a</T>
            {box('pub', 'Pública', '10.0.1.0/24')}
            {box('nat', 'NAT', 'en la pública')}
            {box('priv', 'Privada', '10.0.2.0/24')}
          </View>
          <View style={{ flex: 1, gap: 6, padding: 6, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line }}>
            <T v="tiny" color={colors.dim}>us-east-1b</T>
            {box('pub', 'Pública', '10.0.3.0/24')}
            {box('nat', 'NAT', 'uno por zona')}
            {box('priv', 'Privada', '10.0.4.0/24')}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {box('rtpub', 'Rutas públicas', '→ IGW')}
          {box('rtpriv', 'Rutas privadas', '→ NAT')}
        </View>
      </View>
      <Animated.View key={sel} entering={FadeIn.duration(200)} style={{ borderLeftWidth: 4, borderLeftColor: info.color(), paddingLeft: 12, gap: 2 }}>
        <T v="h3" color={info.color()}>{info.title}</T>
        <T v="small" color={colors.text} style={sel === 'rtpub' || sel === 'rtpriv' ? { fontFamily: fonts.mono } : undefined}>{info.text}</T>
      </Animated.View>
    </Frame>
  );
}

// ───────────────────────── ¿llega el paquete? ─────────────────────────

export function PacketTrace() {
  const [igw, setIgw] = useState(true);
  const [route, setRoute] = useState(true);
  const [nacl, setNacl] = useState(true);
  const [sg, setSg] = useState(true);
  const hops = [
    { name: 'Internet gateway conectada', ok: igw, fix: 'Conecta la IGW a la VPC (attach-internet-gateway).' },
    { name: 'Ruta 0.0.0.0/0 → IGW en la subred', ok: route, fix: 'Añade la ruta a la tabla de la subred y asóciala.' },
    { name: 'NACL de la subred permite el 80', ok: nacl, fix: 'Revisa la NACL: reglas por número y puertos efímeros de la respuesta.' },
    { name: 'Security group permite el 80', ok: sg, fix: 'Añade una regla de entrada TCP 80 al security group.' },
  ];
  const fail = hops.findIndex((h) => !h.ok);
  const arrived = fail < 0;
  const color = arrived ? colors.green : colors.rose;
  return (
    <Frame>
      <View style={{ gap: 6 }}>
        <Toggle label="Internet gateway conectada" on={igw} set={setIgw} good="on" />
        <Toggle label="Ruta a la IGW en la subred" on={route} set={setRoute} good="on" />
        <Toggle label="NACL permite el puerto 80" on={nacl} set={setNacl} good="on" />
        <Toggle label="Security group permite el 80" on={sg} set={setSg} good="on" />
      </View>
      <T v="label" color={colors.dim}>El recorrido del paquete</T>
      <View style={{ gap: 4 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>🌍 curl http://IP-pública/</T>
        {hops.map((h, i) => {
          const passed = fail < 0 || i < fail;
          const blocked = i === fail;
          const c = passed ? colors.green : blocked ? colors.rose : colors.faint;
          return (
            <View key={h.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: blocked ? 2 : 1, borderColor: c, backgroundColor: c + (blocked ? '26' : '12'), opacity: !passed && !blocked ? 0.5 : 1 }}>
              <T style={{ fontSize: 15 }}>{passed ? '✅' : blocked ? '⛔' : '·'}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12, flex: 1 }} color={colors.text}>{h.name}</T>
            </View>
          );
        })}
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={arrived ? colors.green : colors.faint}>🖥️ Instancia (httpd escuchando)</T>
      </View>
      <Animated.View key={`${igw}${route}${nacl}${sg}`} entering={FadeIn.duration(200)} style={{ borderWidth: 2, borderColor: color, borderRadius: radius.md, padding: 12, backgroundColor: color + '1F', gap: 4 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 13.5 }} color={color}>{arrived ? '✔ 200 OK: la web responde' : '✘ timeout: curl se queda esperando'}</T>
        <T v="small" color={colors.text}>{arrived ? 'Los cuatro controles permiten el paso y la respuesta vuelve (el security group tiene estado).' : `El paquete se pierde en «${hops[fail].name}». ${hops[fail].fix}`}</T>
      </Animated.View>
      <Note min={30}>Un timeout casi siempre es una regla o una ruta; un «connection refused» significa que el paquete llegó pero nadie escucha.</Note>
    </Frame>
  );
}

// ───────────────────────── con estado frente a sin estado ─────────────────────────

export function SgVsNacl() {
  const [inRule, setInRule] = useState(true);
  const [outRule, setOutRule] = useState(false);
  const { a } = awsHue();
  const row = (label: string, ok: boolean | null, detail: string) => {
    const c = ok === null ? colors.faint : ok ? colors.green : colors.rose;
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: c, backgroundColor: c + '18' }}>
        <T style={{ fontSize: 15 }}>{ok === null ? '·' : ok ? '✅' : '⛔'}</T>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{label}</T>
          <T v="tiny" color={colors.dim}>{detail}</T>
        </View>
      </View>
    );
  };
  return (
    <Frame>
      <Toggle label="Regla de ENTRADA: permitir TCP 80" on={inRule} set={setInRule} good="on" hint="Se aplica igual en el security group y en la NACL" />
      <Toggle label="Regla de SALIDA a puertos 1024-65535" on={outRule} set={setOutRule} good="on" hint="Solo la necesita la NACL: el security group la ignora" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Pill text="Security group" color={a} solid />
          {row('Petición entra', inRule, inRule ? 'La regla de entrada la permite' : 'Sin regla: se deniega')}
          {row('Respuesta sale', inRule ? true : null, inRule ? 'Automática: tiene estado' : '—')}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Pill text="NACL" color={colors.amber} solid />
          {row('Petición entra', inRule, inRule ? 'Regla de entrada permite' : 'Sin regla: se deniega')}
          {row('Respuesta sale', inRule ? outRule : null, inRule ? (outRule ? 'La regla de salida la permite' : 'Falta la regla de salida: se pierde') : '—')}
        </View>
      </View>
      <Note min={30}>Security group: «recuerda» la conexión. NACL: cada paquete es nuevo, hay que permitir ida y vuelta.</Note>
    </Frame>
  );
}

// ───────────────────────── del nombre a la IP ─────────────────────────

type Rec = 'a' | 'cname' | 'alias';

const DNS: Record<Rec, { title: string; lines: string[]; text: string }> = {
  a: { title: 'Registro A', lines: ['www.ejemplo.com   A   203.0.113.10', '→ 203.0.113.10'], text: 'La respuesta es directamente una dirección IPv4.' },
  cname: { title: 'CNAME', lines: ['blog.ejemplo.com  CNAME  www.ejemplo.com', 'www.ejemplo.com   A      203.0.113.10', '→ 203.0.113.10'], text: 'El resolutor sigue la cadena: primero el apodo, luego el nombre real. No vale en el ápice del dominio.' },
  alias: { title: 'Alias de Route 53', lines: ['ejemplo.com   A (alias)  d1234.cloudfront.net', '→ 18.66.12.40  (Route 53 la resuelve por ti)'], text: 'Funciona en el ápice, apunta a un recurso de AWS, sigue sus cambios de IP y no cobra por consulta.' },
};

export function DnsFlow() {
  const [rec, setRec] = useState<Rec>('a');
  const [step, setStep] = useState(0);
  const { a } = awsHue();
  const info = DNS[rec];
  const steps = [
    { who: '💻 Tu navegador', text: '¿Qué IP tiene www.ejemplo.com? Primero mira su propia caché y la del sistema.' },
    { who: '🧭 Resolutor (el de tu proveedor o el de la VPC, 169.254.169.253)', text: 'Si no lo sabe, pregunta por el camino: servidores raíz → «.com» → servidores de nombres de ejemplo.com.' },
    { who: '☁️ Route 53 (zona alojada de ejemplo.com)', text: 'Los servidores NS de tu zona contestan con el registro. Esta es «la verdad» del dominio.' },
    { who: '↩️ Respuesta con TTL', text: 'El resolutor guarda la respuesta durante el TTL (por ejemplo 300 s) y se la da a tu navegador. Hasta que caduque, no vuelve a preguntar.' },
  ];
  return (
    <Frame>
      <Tabs color={a} value={rec} onChange={setRec} items={[{ id: 'a', label: 'A' }, { id: 'cname', label: 'CNAME' }, { id: 'alias', label: 'Alias' }]} />
      <View style={{ gap: 4 }}>
        {steps.map((s, i) => {
          const on = i === step;
          return (
            <Pressable key={s.who} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={s.who} onPress={() => { tap(); setStep(i); }} style={{ padding: 8, borderRadius: radius.sm, borderWidth: on ? 2 : 1, borderColor: on ? a : colors.line, backgroundColor: on ? a + '22' : 'transparent' }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={on ? colors.text : colors.dim}>{i + 1} · {s.who}</T>
              {on ? <T v="small" color={colors.text}>{s.text}</T> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ backgroundColor: colors.termBg, borderRadius: radius.sm, padding: 10, borderWidth: 1, borderColor: colors.line, gap: 2 }}>
        {info.lines.map((l) => (
          <T key={l} style={{ fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 17 }} color={l.startsWith('→') ? colors.green : colors.termText}>{l}</T>
        ))}
      </View>
      <Explain k={rec} title={info.title} color={a}>{info.text}</Explain>
    </Frame>
  );
}
