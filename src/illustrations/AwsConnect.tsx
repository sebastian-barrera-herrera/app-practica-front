import React, { useState } from 'react';
import { View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Pill, Stepper, Toggle, awsHue } from './awsui';

const Box = ({ title, ok, children }: { title: string; ok?: boolean; children?: React.ReactNode }) => {
  const c = ok === undefined ? colors.line : ok ? colors.green : colors.rose;
  return (
    <View style={{ borderWidth: 1.5, borderColor: c, backgroundColor: ok === undefined ? 'transparent' : c + '1A', borderRadius: radius.sm, padding: 8, gap: 4 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>{title}</T>
      {children}
    </View>
  );
};

// ───────────────────────── peering frente a Transit Gateway ─────────────────────────

export function PeeringTgw() {
  const [mode, setMode] = useState<'pcx' | 'tgw'>('pcx');
  const [n, setN] = useState(4);
  const [fwd, setFwd] = useState(true);
  const [back, setBack] = useState(false);
  const [sg, setSg] = useState(true);
  const { a } = awsHue();
  const links = mode === 'pcx' ? (n * (n - 1)) / 2 : n;
  const routes = mode === 'pcx' ? n * (n - 1) : n;
  const works = fwd && back && sg;
  const why = !fwd ? 'La VPC de origen no tiene ruta hacia el CIDR de destino: el paquete ni sale.' : !sg ? 'El security group de destino no admite el CIDR de origen.' : !back ? 'El paquete llega, pero la VPC de destino no tiene ruta de vuelta: la respuesta se pierde. Las rutas se declaran en los dos lados.' : 'Ida, vuelta y security group: hay conversación.';
  return (
    <Frame>
      <Tabs color={a} value={mode} onChange={setMode} items={[{ id: 'pcx', label: 'Peering (uno a uno)' }, { id: 'tgw', label: 'Transit Gateway (centro)' }]} />
      <Stepper label="Número de VPC" value={n} min={2} max={10} onChange={setN} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`${links} ${mode === 'pcx' ? 'peerings' : 'adjuntos'}`} color={links > 12 ? colors.rose : a} solid />
        <Pill text={`${routes} rutas de VPC`} color={colors.violet} />
        <Pill text={mode === 'pcx' ? 'no transitivo' : 'transitivo'} color={mode === 'pcx' ? colors.amber : colors.green} />
      </View>
      <T v="label" color={colors.dim}>Prueba un paquete de la VPC A a la VPC B</T>
      <Toggle label="Ruta en A hacia el CIDR de B" on={fwd} set={setFwd} good="on" />
      <Toggle label="Ruta en B hacia el CIDR de A" on={back} set={setBack} good="on" hint="La respuesta también necesita camino" />
      <Toggle label="Security group de B admite el CIDR de A" on={sg} set={setSg} good="on" />
      <Explain k={`${mode}${n}${works}${why}`} title={works ? '✓ Hay conectividad' : '✖ No hay conectividad'} color={works ? colors.green : colors.rose}>
        {why} {mode === 'pcx' ? `Con ${n} VPC necesitas ${links} peerings y A no llega a C pasando por B (no hay enrutamiento transitivo).` : `Con ${n} VPC solo necesitas ${n} adjuntos: cada VPC habla con el centro y las tablas de rutas del Transit Gateway deciden quién ve a quién.`}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── endpoints ─────────────────────────

export function EndpointPaths() {
  const [kind, setKind] = useState<'nat' | 'gw' | 'if'>('gw');
  const [gb, setGb] = useState(200);
  const { a } = awsHue();
  const hourly = kind === 'nat' ? 0.045 : kind === 'if' ? 0.01 : 0;
  const perGb = kind === 'nat' ? 0.045 : kind === 'if' ? 0.01 : 0;
  const month = Math.round((hourly * 730 + perGb * gb) * 100) / 100;
  const text: Record<typeof kind, string> = {
    nat: 'El tráfico sale por el NAT gateway, atraviesa internet (con IP pública) y entra a S3. Pagas por hora y por cada GB que pasa. Cuanto más lees de S3, más pagas.',
    gw: 'Una ruta en la tabla de la subred (lista de prefijos de S3 → vpce-…) manda el tráfico por la red interna de AWS. Gratis, sin NAT y sin salir a internet. Solo para S3 y DynamoDB.',
    if: 'Una interfaz de red con IP privada dentro de tu subred (PrivateLink). Sirve para casi cualquier servicio (SQS, SSM, KMS…) y también entre VPC y cuentas. Se cobra por hora y por GB; el security group manda.',
  };
  return (
    <Frame>
      <Tabs color={a} value={kind} onChange={setKind} items={[{ id: 'nat', label: 'NAT gateway' }, { id: 'gw', label: 'Endpoint de puerta' }, { id: 'if', label: 'Endpoint de interfaz' }]} />
      <View style={{ gap: 6 }}>
        <Box title="🖥️ Servidor en subred privada" />
        <T color={colors.dim}>↓ {kind === 'nat' ? 'NAT → IGW → internet' : kind === 'gw' ? 'ruta pl-… → vpce' : 'ENI privada → PrivateLink'}</T>
        <Box title={kind === 'nat' ? '🌐 Internet público' : '🔒 Red privada de AWS'} ok={kind !== 'nat'}>
          <T v="tiny" color={colors.dim}>{kind === 'nat' ? 'El tráfico sale de tu VPC' : 'El tráfico nunca sale de AWS'}</T>
        </Box>
        <Box title="🪣 S3 / servicio de AWS" />
      </View>
      <Stepper label="GB al mes hacia S3" value={gb} min={0} max={5000} step={100} onChange={setGb} />
      <Explain k={`${kind}${gb}`} title={`≈ ${month.toFixed(2)} $ al mes (ilustrativo)`} color={kind === 'nat' ? colors.amber : colors.green}>
        {text[kind]}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── VPN y Direct Connect ─────────────────────────

export function HybridChooser() {
  const [encrypted, setEncrypted] = useState(true);
  const [fast, setFast] = useState(true);
  const [big, setBig] = useState(false);
  const [steady, setSteady] = useState(false);
  const { a } = awsHue();
  const dx = big || steady;
  const title = dx && encrypted ? 'Direct Connect + VPN (cifrada sobre el enlace)' : dx ? 'Direct Connect' : 'VPN de sitio a sitio';
  const days = dx ? 'semanas (hay que tender el cable)' : 'minutos';
  const why = [
    dx ? 'Un enlace físico dedicado da ancho de banda de 1–100 Gbps y latencia estable, pero tarda semanas en llegar.' : 'La VPN se crea en minutos por internet con IPsec; basta para tráfico moderado.',
    dx && encrypted ? 'Direct Connect no cifra por sí solo: añade una VPN IPsec por encima (o MACsec) si necesitas cifrado.' : '',
    dx && fast ? 'Como lo necesitas hoy, arranca con una VPN y migra cuando llegue el cable (ambas pueden convivir como respaldo).' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Frame>
      <Toggle label="Necesito cifrado en todo el camino" on={encrypted} set={setEncrypted} />
      <Toggle label="Lo necesito funcionando hoy" on={fast} set={setFast} />
      <Toggle label="Mucho volumen (> 1 Gbps)" on={big} set={setBig} />
      <Toggle label="Latencia estable (sin sorpresas de internet)" on={steady} set={setSteady} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`Montaje: ${days}`} color={dx ? colors.amber : colors.green} />
        <Pill text={dx ? 'ancho de banda dedicado' : 'hasta ~1,25 Gbps por túnel'} color={a} />
        <Pill text="2 túneles IPsec" color={colors.violet} dim={dx && !encrypted} />
      </View>
      <Explain k={`${encrypted}${fast}${big}${steady}`} title={title} color={a}>{why}</Explain>
    </Frame>
  );
}

// ───────────────────────── Flow Logs y Reachability Analyzer ─────────────────────────

type Cut = 'ok' | 'route' | 'sg' | 'nacl' | 'back';

const CUTS: Record<Cut, { label: string; flow: string; ra: string; tip: string }> = {
  ok: { label: 'Todo bien', flow: '… 10.0.1.5 10.0.2.9 … 8080 6 … ACCEPT OK', ra: 'NetworkPathFound: true', tip: 'Flow Logs registra ACCEPT y el Reachability Analyzer encuentra el camino.' },
  route: { label: 'Falta la ruta', flow: '(no aparece nada: el paquete nunca llega a la interfaz de destino)', ra: 'NO_ROUTE_TO_DESTINATION · rtb-…', tip: 'Los Flow Logs no ven lo que no llega. El Reachability Analyzer sí detecta la ruta que falta, sin enviar tráfico.' },
  sg: { label: 'SG bloquea', flow: '… 10.0.1.5 10.0.2.9 … 8080 6 … REJECT OK', ra: 'ENI_SG_RULES_MISMATCH · sg-…', tip: 'Un REJECT en Flow Logs sin NACL de por medio apunta al security group (o a la NACL): el analizador te dice a cuál.' },
  nacl: { label: 'NACL bloquea', flow: '… 10.0.1.5 10.0.2.9 … 8080 6 … REJECT OK', ra: 'SUBNET_ACL_RESTRICTION · acl-…', tip: 'Se ve igual que el security group en los Flow Logs. Distínguelos con el analizador, que nombra el componente.' },
  back: { label: 'Sin ruta de vuelta', flow: 'ida: ACCEPT · vuelta: (nada)', ra: 'NetworkPathFound: false (ruta de retorno)', tip: 'La ida se registra como ACCEPT pero la conexión nunca se completa: busca la ruta de vuelta.' },
};

export function FlowReach() {
  const [cut, setCut] = useState<Cut>('sg');
  const { a } = awsHue();
  const c = CUTS[cut];
  return (
    <Frame>
      <T v="label" color={colors.dim}>Rompe una pieza del camino web → app (puerto 8080)</T>
      <Tabs color={a} value={cut} onChange={setCut} items={(Object.keys(CUTS) as Cut[]).map((k) => ({ id: k, label: CUTS[k].label }))} />
      <Box title="📜 Flow Logs (lo que pasó)" ok={cut === 'ok'}>
        <T style={{ fontFamily: fonts.mono, fontSize: 11.5 }} color={colors.text}>{c.flow}</T>
      </Box>
      <Box title="🔍 Reachability Analyzer (lo que dice la configuración)" ok={cut === 'ok'}>
        <T style={{ fontFamily: fonts.mono, fontSize: 11.5 }} color={colors.text}>{c.ra}</T>
      </Box>
      <Explain k={cut} title={cut === 'ok' ? 'Camino sano' : 'Diagnóstico'} color={cut === 'ok' ? colors.green : colors.amber}>{c.tip}</Explain>
    </Frame>
  );
}

// ───────────────────────── bastión frente a Session Manager ─────────────────────────

export function SsmAccess() {
  const [ssh, setSsh] = useState(true);
  const [bastion, setBastion] = useState(true);
  const [role, setRole] = useState(false);
  const [net, setNet] = useState(false);
  const { a } = awsHue();
  const online = role && net;
  const surface = (ssh ? 1 : 0) + (bastion ? 1 : 0);
  const verdict = online && !ssh && !bastion ? 'ideal' : online ? 'mixto' : surface ? 'expuesto' : 'sin acceso';
  const text: Record<string, string> = {
    ideal: 'Sin puerto 22, sin bastión y sin claves SSH que gestionar: entras con IAM, con MFA, y cada sesión queda auditada en CloudTrail (y opcionalmente en S3/CloudWatch Logs).',
    mixto: 'Session Manager funciona, pero aún dejas puertas abiertas que ya no necesitas. Ciérralas.',
    expuesto: 'Todavía dependes de SSH: un puerto abierto, claves que rotar y un bastión que parchear y vigilar.',
    'sin acceso': 'No tienes ninguna forma de entrar. Activa Session Manager (rol + red) antes de cerrar SSH.',
  };
  return (
    <Frame>
      <Toggle label="Puerto 22 abierto en el security group" on={ssh} set={setSsh} good="off" />
      <Toggle label="Servidor bastión en la subred pública" on={bastion} set={setBastion} good="off" />
      <Toggle label="Perfil de instancia con AmazonSSMManagedInstanceCore" on={role} set={setRole} good="on" />
      <Toggle label="Salida de red: NAT o 3 endpoints (ssm, ssmmessages, ec2messages)" on={net} set={setNet} good="on" />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={online ? 'SSM: Online' : 'SSM: sin conexión'} color={online ? colors.green : colors.rose} solid />
        <Pill text={`${surface} puerta${surface === 1 ? '' : 's'} abierta${surface === 1 ? '' : 's'}`} color={surface ? colors.amber : colors.green} />
      </View>
      <Explain k={verdict} title={verdict === 'ideal' ? 'Acceso sin puertos' : verdict === 'mixto' ? 'Casi' : verdict === 'expuesto' ? 'Acceso por SSH' : 'Aislado del todo'} color={verdict === 'ideal' ? a : verdict === 'sin acceso' ? colors.rose : colors.amber}>
        {text[verdict]}
      </Explain>
    </Frame>
  );
}
