import React, { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, Stepper, Toggle, awsHue } from './awsui';

const money = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;

// ───────────────────────── calculadora de costes ─────────────────────────

/** Precios ilustrativos (USD/mes, región us-east-1): los mismos órdenes de magnitud que usa el simulador. */
const UNIT = { vm: 0.0208 * 730, db: 0.034 * 730, s3: 0.023, nat: 0.045 * 730, natGb: 0.045, out: 0.09, ip: 0.005 * 730 };
const NAT_GB_ASSUMED = 100;
const OUT_FREE_GB = 100;

type Key = 'vm' | 'db' | 's3' | 'nat' | 'out' | 'ip';

const INSIGHT: Record<Key, string> = {
  vm: 'Las instancias encendidas las 24 horas son lo que más pesa. Apaga las de desarrollo por la noche o compromete el uso con un Savings Plan.',
  db: 'La base de datos pesa más de lo que parece, sobre todo con Multi-AZ (cuesta el doble porque hay dos servidores).',
  s3: 'El almacenamiento crece solo. Pasa lo poco usado a clases más baratas con reglas de ciclo de vida.',
  nat: 'Un NAT gateway cuesta unos 33 $ al mes solo por existir, más 0,045 $ por GB. Para hablar con S3 desde una subred privada, un endpoint de VPC de tipo gateway es gratis.',
  out: 'La salida de datos a internet es la gran sorpresa de las facturas: la entrada es gratis y los primeros 100 GB al mes también.',
  ip: 'Desde 2024 cada IPv4 pública se cobra por hora, la uses o no. Libera las que no necesites.',
};

export function PriceCalc() {
  const [vm, setVm] = useState(2);
  const [db, setDb] = useState(1);
  const [gb, setGb] = useState(500);
  const [nat, setNat] = useState(1);
  const [out, setOut] = useState(300);
  const [ip, setIp] = useState(2);
  const [multi, setMulti] = useState(false);
  const [plan, setPlan] = useState(false);
  const { a } = awsHue();
  const disc = plan ? 0.7 : 1;
  const rows: { k: Key; label: string; value: number; color: string }[] = [
    { k: 'vm', label: 'Instancias EC2', value: vm * UNIT.vm * disc, color: colors.cyan },
    { k: 'db', label: 'Base de datos RDS', value: db * UNIT.db * (multi ? 2 : 1) * disc, color: colors.violet },
    { k: 's3', label: 'Almacenamiento S3', value: gb * UNIT.s3, color: colors.mint },
    { k: 'nat', label: 'NAT gateway', value: nat * (UNIT.nat + NAT_GB_ASSUMED * UNIT.natGb), color: colors.amber },
    { k: 'out', label: 'Salida a internet', value: Math.max(0, out - OUT_FREE_GB) * UNIT.out, color: colors.rose },
    { k: 'ip', label: 'IPv4 públicas', value: ip * UNIT.ip, color: colors.green },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const top = rows.reduce((m, r) => (r.value > m.value ? r : m), rows[0]);
  return (
    <Frame>
      <Stepper label="Instancias t3.small 24 h" value={vm} max={20} onChange={setVm} />
      <Stepper label="Bases de datos db.t3.small" value={db} max={5} onChange={setDb} />
      <Stepper label="Datos en S3 Estándar" value={gb} max={5000} step={100} unit="GB" onChange={setGb} />
      <Stepper label="NAT gateways (100 GB cada uno)" value={nat} max={4} onChange={setNat} />
      <Stepper label="Datos que salen a internet" value={out} max={2000} step={50} unit="GB" onChange={setOut} />
      <Stepper label="IPv4 públicas" value={ip} max={20} onChange={setIp} />
      <Toggle label="Multi-AZ en las bases de datos" on={multi} set={setMulti} hint="Dos servidores: el doble de precio" />
      <Toggle label="Savings Plan de 1 año (≈ −30 %)" on={plan} set={setPlan} good="on" hint="Solo afecta a EC2 y RDS" />
      <View style={{ gap: 6 }}>
        {rows.map((r) => (
          <View key={r.k} style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="tiny" color={r.k === top.k ? colors.text : colors.dim}>{r.label}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{money(r.value)}</T>
            </View>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.line, overflow: 'hidden' }}>
              <View style={{ width: `${total > 0 ? Math.max(r.value > 0 ? 3 : 0, (r.value / total) * 100) : 0}%`, height: '100%', backgroundColor: r.color, opacity: r.k === top.k ? 1 : 0.6 }} />
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
        <T v="h3" color={colors.text}>Total estimado</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 20 }} color={a}>{money(total)}/mes</T>
      </View>
      {total > 0 ? <Explain k={top.k} title={`Lo que más pesa: ${top.label}`} color={top.color}>{INSIGHT[top.k]}</Explain> : <Note min={30}>Sube alguna cantidad para ver la factura.</Note>}
      <T v="tiny" color={colors.dim}>Precios ilustrativos para razonar: los reales cambian por región y con el tiempo. Usa siempre la calculadora oficial.</T>
    </Frame>
  );
}

// ───────────────────────── planes de soporte ─────────────────────────

type PlanId = 'basic' | 'dev' | 'biz' | 'ramp' | 'ent';

interface Plan {
  name: string;
  cost: string;
  who: string;
  fits: string;
  chat247: boolean;
  advisor: string;
  response: string;
  tam: string;
  color: () => string;
}

const PLANS: Record<PlanId, Plan> = {
  basic: { name: 'Basic', cost: 'Gratis', who: 'Aprender y probar', fits: 'Estás aprendiendo o la cuenta no guarda nada importante.', chat247: false, advisor: 'Comprobaciones básicas de seguridad y límites', response: 'Sin soporte técnico (solo facturación y foros)', tam: 'No', color: () => colors.faint },
  dev: { name: 'Developer', cost: 'Desde ≈ 29 $/mes', who: 'Desarrollo y pruebas', fits: 'Estás construyendo y de vez en cuando necesitas consultar algo por correo, en horario laboral.', chat247: false, advisor: 'Comprobaciones básicas', response: '< 24 h (< 12 h si un sistema está afectado)', tam: 'No', color: () => colors.cyan },
  biz: { name: 'Business', cost: 'Desde ≈ 100 $/mes', who: 'Producción', fits: 'Tu aplicación de producción no puede quedarse sin ayuda a las 3 de la madrugada.', chat247: true, advisor: 'COMPLETO (todas las comprobaciones)', response: '< 1 h si producción está caída', tam: 'No', color: () => colors.green },
  ramp: { name: 'Enterprise On-Ramp', cost: 'Miles de $/mes', who: 'Cargas críticas', fits: 'Varias cargas importantes y quieres un equipo técnico de referencia sin un TAM dedicado.', chat247: true, advisor: 'COMPLETO', response: '< 30 min si lo crítico está caído', tam: 'Pool de gestores técnicos', color: () => colors.amber },
  ent: { name: 'Enterprise', cost: 'Decenas de miles de $/mes', who: 'Misión crítica', fits: 'Tu negocio depende de AWS y necesitas un gestor técnico (TAM) que conozca tu arquitectura.', chat247: true, advisor: 'COMPLETO', response: '< 15 min si lo crítico está caído', tam: 'TAM dedicado', color: () => colors.violet },
};

export function SupportPlans() {
  const [id, setId] = useState<PlanId>('biz');
  const p = PLANS[id];
  const c = p.color();
  const row = (label: string, value: string, ok?: boolean) => (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 13, width: 16 }} color={ok === undefined ? colors.dim : ok ? colors.green : colors.rose}>{ok === undefined ? '•' : ok ? '✓' : '✖'}</T>
      <View style={{ flex: 1 }}>
        <T v="tiny" color={colors.dim}>{label}</T>
        <T v="small" color={colors.text}>{value}</T>
      </View>
    </View>
  );
  return (
    <Frame>
      <T v="label" color={colors.dim}>Elige un plan</T>
      <Tabs color={colors.violet} value={id} onChange={setId} items={(Object.keys(PLANS) as PlanId[]).map((k) => ({ id: k, label: PLANS[k].name }))} />
      <Animated.View key={id} entering={FadeIn.duration(200)} style={{ borderWidth: 2, borderColor: c, borderRadius: radius.md, padding: 12, backgroundColor: c + '1F', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 16 }} color={c}>{p.name}</T>
          <Pill text={p.cost} color={c} />
        </View>
        {row('Atención', p.chat247 ? '24/7 por chat, teléfono y correo' : id === 'dev' ? 'Correo en horario laboral' : 'Sin soporte técnico', p.chat247)}
        {row('Tiempo de respuesta', p.response)}
        {row('Trusted Advisor', p.advisor, p.advisor.startsWith('COMPLETO'))}
        {row('Gestor técnico', p.tam, p.tam !== 'No')}
      </Animated.View>
      <Explain k={id} title={`Ideal para: ${p.who}`} color={c}>{p.fits}</Explain>
      <T v="tiny" color={colors.dim}>Precios y tiempos orientativos: AWS renueva los planes de vez en cuando. Consulta la página oficial antes de decidir.</T>
    </Frame>
  );
}

// ───────────────────────── jerarquía de Organizations ─────────────────────────

const SCPS = [
  { id: 'region', label: 'Sin regiones no aprobadas', where: 'raíz', blocks: 'Lanzar una EC2 en São Paulo', scope: ['prod', 'dev'] },
  { id: 'trail', label: 'No tocar CloudTrail', where: 'OU Producción', blocks: 'Parar CloudTrail', scope: ['prod'] },
  { id: 'big', label: 'Sin instancias enormes', where: 'OU Desarrollo', blocks: 'Lanzar una p4d.24xlarge', scope: ['dev'] },
] as const;

type ScpId = (typeof SCPS)[number]['id'];

const ACCOUNTS = [
  { id: 'admin', name: 'administracion', ou: 'raíz', icon: '🏛️' },
  { id: 'prod', name: 'tienda-prod', ou: 'OU Producción', icon: '🏭' },
  { id: 'dev', name: 'tienda-dev', ou: 'OU Desarrollo', icon: '🧪' },
] as const;

export function OrgTree() {
  const [on, setOn] = useState<Record<ScpId, boolean>>({ region: true, trail: false, big: false });
  const { a } = awsHue();
  const blocked = (acc: string, s: (typeof SCPS)[number]) => acc !== 'admin' && on[s.id] && (s.scope as readonly string[]).includes(acc);
  return (
    <Frame>
      <T v="label" color={colors.dim}>Activa SCP en cada nivel</T>
      {SCPS.map((s) => (
        <Toggle key={s.id} label={s.label} on={on[s.id]} set={(v) => setOn({ ...on, [s.id]: v })} hint={`Se aplica en: ${s.where}`} />
      ))}
      <View style={{ gap: 8 }}>
        <View style={{ borderWidth: 2, borderColor: a, borderRadius: radius.md, padding: 8, backgroundColor: a + '12', gap: 8 }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={a}>🌳 Raíz de la organización</T>
          {ACCOUNTS.map((acc) => (
            <View key={acc.id} style={{ borderWidth: 1.5, borderColor: colors.line, borderStyle: acc.id === 'admin' ? 'solid' : 'dashed', borderRadius: radius.sm, padding: 8, gap: 6, marginLeft: acc.id === 'admin' ? 0 : 12 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{acc.icon} {acc.name} <T v="tiny" color={colors.dim}>({acc.ou})</T></T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {SCPS.map((s) => {
                  const b = blocked(acc.id, s);
                  return <Pill key={s.id} text={`${b ? '✖' : '✓'} ${s.blocks}`} color={b ? colors.rose : colors.green} />;
                })}
              </View>
            </View>
          ))}
        </View>
      </View>
      <Explain k={`${on.region}${on.trail}${on.big}`} title="Cómo se calcula" color={a}>
        Una cuenta hereda las SCP de todos los niveles por encima de ella: la raíz, su OU y la propia cuenta. Para poder hacer algo hace falta que IAM lo permita <T v="small" bold color={colors.text}>y</T> que ninguna SCP lo prohíba. La cuenta de administración queda fuera: las SCP no la limitan.
      </Explain>
    </Frame>
  );
}
