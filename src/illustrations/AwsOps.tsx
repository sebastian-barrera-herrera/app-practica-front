import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { select } from '@/lib/haptics';
import { Frame } from './common';
import { Slider, Tabs } from './pyui';
import { Explain, Pill, Stepper, Toggle, awsHue } from './awsui';
import { alarmSummary, alarmTimeline, filterEvents, fleetStatus, logMatches, traceModel, TRAIL_EVENTS, type AlarmState, type MissingData, type TrailEvent } from './awsOpsLogic';

const Mono = ({ children, color, size = 11.5, lines }: { children: React.ReactNode; color?: string; size?: number; lines?: number }) => (
  <T numberOfLines={lines} style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size + 4 }} color={color ?? colors.text}>{children}</T>
);

const Box = ({ title, color, children }: { title: string; color?: string; children?: React.ReactNode }) => {
  const c = color ?? colors.line;
  return (
    <View style={{ borderWidth: 1.5, borderColor: c, backgroundColor: color ? c + '1A' : 'transparent', borderRadius: radius.sm, padding: 8, gap: 3 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, lineHeight: 17 }} color={colors.text}>{title}</T>
      {children}
    </View>
  );
};

// ───────────────────────── cómo decide una alarma ─────────────────────────

const SERIES: (number | null)[] = [180, 210, 190, 950, 200, 220, 900, 940, 960, 210, null, null, null, 230];
const STATE_COLOR: Record<AlarmState, string> = { OK: colors.green, ALARM: colors.rose, INSUFFICIENT_DATA: colors.faint };
const STATE_LETTER: Record<AlarmState, string> = { OK: 'O', ALARM: 'A', INSUFFICIENT_DATA: '?' };
const BAR_H = 84;

export function AlarmEval() {
  const [threshold, setThreshold] = useState(800);
  const [periods, setPeriods] = useState(3);
  const [dp, setDp] = useState(2);
  const [missing, setMissing] = useState<MissingData>('missing');
  const { a } = awsHue();
  const m = Math.min(dp, periods);
  const tl = alarmTimeline(SERIES, { threshold, periods, datapoints: m, missing });
  const sum = alarmSummary(tl);
  const flap = sum.changes >= 6;
  return (
    <Frame>
      <T v="label" color={colors.dim}>{`Umbral: ${threshold} ms (latencia media por minuto)`}</T>
      <Slider min={100} max={1000} value={threshold} onChange={(v) => setThreshold(Math.round(v / 10) * 10)} color={a} label="Umbral" />
      <Stepper label="Periodos que mira (EvaluationPeriods)" value={periods} min={1} max={5} onChange={(v) => { setPeriods(v); setDp((d) => Math.min(d, v)); }} />
      <Stepper label="Cuántos deben incumplir (DatapointsToAlarm)" value={m} min={1} max={periods} onChange={setDp} />
      <T v="label" color={colors.dim}>Datos que faltan (TreatMissingData)</T>
      <Tabs color={a} value={missing} onChange={setMissing} items={[{ id: 'missing', label: 'missing' }, { id: 'notBreaching', label: 'notBreaching' }, { id: 'breaching', label: 'breaching' }, { id: 'ignore', label: 'ignore' }]} />
      <Box title="📈 LatenciaMs · 14 minutos">
        <View style={{ height: BAR_H, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
          {SERIES.map((v, i) => (
            <View key={i} style={{ flex: 1, height: BAR_H, justifyContent: 'flex-end' }}>
              {v === null ? (
                <View style={{ height: 6, borderRadius: 2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.faint }} />
              ) : (
                <View style={{ height: Math.max(3, (v / 1000) * BAR_H), borderRadius: 3, backgroundColor: v > threshold ? colors.rose : colors.green }} />
              )}
            </View>
          ))}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: BAR_H - (threshold / 1000) * BAR_H, height: 2, backgroundColor: colors.amber }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {tl.map((s, i) => (
            <View key={i} style={{ flex: 1, height: 22, borderRadius: 4, backgroundColor: STATE_COLOR[s] + '33', borderWidth: 1, borderColor: STATE_COLOR[s], alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 10.5 }} color={colors.text}>{STATE_LETTER[s]}</T>
            </View>
          ))}
        </View>
        <Mono color={colors.dim} size={10.5}>O = OK · A = ALARM · ? = INSUFFICIENT_DATA · línea ámbar: umbral · punteado: sin datos</Mono>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`minutos en ALARM: ${sum.alarmMinutes}`} color={sum.alarmMinutes ? colors.rose : colors.green} solid />
        <Pill text={`cambios de estado: ${sum.changes}`} color={flap ? colors.amber : a} />
        <Pill text={`final: ${sum.last}`} color={STATE_COLOR[sum.last]} />
      </View>
      <Explain k={`${threshold}${periods}${m}${missing}`} title={flap ? '🔔 Demasiados cambios' : sum.alarmMinutes === 0 ? '😴 Nunca salta' : m === 1 && periods === 1 ? '⚡ Reacciona a cada pico' : '✓ Filtra el pico aislado'} color={flap ? colors.amber : a}>
        {sum.alarmMinutes === 0
          ? 'Con estos ajustes la alarma no llega a saltar: el umbral queda por encima de los datos o pide demasiados periodos seguidos. Revisa si el problema real (los tres minutos por encima de 900 ms) pasaría desapercibido.'
          : m === 1 && periods === 1
            ? 'Con 1 de 1 la alarma salta con cada minuto que supere el umbral, incluido el pico aislado del minuto 4: avisa rápido, pero genera ruido y cada cambio puede ser un aviso.'
            : m < periods
              ? `«${m} de ${periods}»: tolera huecos y picos sueltos, pero sigue saltando cuando el problema se mantiene. Es el ajuste habitual para no despertar a nadie por un solo minuto malo.`
              : `Con ${periods} de ${periods} deben incumplir todos los periodos seguidos: es el más calmado, a costa de avisar más tarde. Mira el efecto de los minutos sin datos (11 a 13) cambiando «TreatMissingData».`}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── patrones de filtro ─────────────────────────

const LOG_LINES = [
  '{"level":"INFO","route":"/api/catalogo","status":200,"latency":120}',
  '{"level":"INFO","route":"/api/pedidos","status":200,"latency":210}',
  '{"level":"ERROR","route":"/api/pedidos","status":500,"latency":5000,"error":"DbTimeout"}',
  '{"level":"INFO","route":"/api/pago","status":200,"latency":340}',
  '{"level":"ERROR","route":"/api/pago","status":502,"latency":380,"error":"PaymentDeclined"}',
  '{"level":"WARN","route":"/api/informes","status":200,"latency":2300}',
  '2026-03-14 11:02:10 ERROR timeout contacting db-prod',
  '2026-03-14 11:02:12 WARN disk 91% on /var',
  '2026-03-14 11:02:13 DEBUG cache hit key=p1',
  '{"level":"INFO","route":"/api/login","status":200,"latency":90}',
];

const PATTERNS: { id: string; pattern: string; why: string }[] = [
  { id: 'e', pattern: 'ERROR', why: 'Un término suelto: cualquier línea que contenga la palabra (sin distinguir dónde). Distingue mayúsculas y minúsculas.' },
  { id: 'or', pattern: '?ERROR ?WARN', why: 'El signo ? delante de cada término significa «alguno de ellos»: ERROR o WARN.' },
  { id: 'not', pattern: 'ERROR -timeout', why: 'Con un guion se excluye: líneas con ERROR que NO contengan «timeout». El guion solo funciona junto a otros términos.' },
  { id: 'q', pattern: '"disk 91%"', why: 'Entre comillas es una frase exacta, con sus espacios y símbolos.' },
  { id: 'j1', pattern: '{ $.status >= 500 }', why: 'Patrón JSON: compara el campo status de cada línea que sea un JSON. Las líneas de texto no coinciden nunca.' },
  { id: 'j2', pattern: '{ $.route = "/api/pago" && $.latency > 300 }', why: 'Se pueden combinar condiciones con && (y) y || (o). Las cadenas van entre comillas dobles.' },
  { id: 'j3', pattern: '{ $.latency > 1000 }', why: 'Una comparación numérica sobre el campo latency: las dos respuestas lentas.' },
];

export function LogFilter() {
  const [sel, setSel] = useState('e');
  const { a } = awsHue();
  const p = PATTERNS.find((x) => x.id === sel)!;
  const hits = LOG_LINES.map((l) => logMatches(p.pattern, l));
  const n = hits.filter(Boolean).length;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Patrón de filtro</T>
      <Tabs color={a} value={sel} onChange={setSel} items={PATTERNS.map((x) => ({ id: x.id, label: x.pattern.length > 22 ? x.pattern.slice(0, 20) + '…' : x.pattern }))} />
      <Box title={`🔎 ${p.pattern}`} color={a}>
        {LOG_LINES.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', opacity: hits[i] ? 1 : 0.4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: hits[i] ? colors.green : colors.line }} />
            <View style={{ flex: 1 }}>
              <Mono size={10.5} lines={2} color={hits[i] ? colors.text : colors.dim}>{l}</Mono>
            </View>
          </View>
        ))}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`coinciden: ${n} de ${LOG_LINES.length}`} color={n ? colors.green : colors.amber} solid />
        <Pill text={`filtro de métricas (valor 1): suma ${n}`} color={a} />
      </View>
      <Explain k={sel} title="Cómo se lee" color={a}>
        {p.why}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── investigar con CloudTrail ─────────────────────────

const USERS = ['todos', 'ana', 'carlos', 'lucia'];

export function AuditTrail() {
  const [user, setUser] = useState('todos');
  const [writeOnly, setWriteOnly] = useState(false);
  const [pick, setPick] = useState<TrailEvent | null>(null);
  const { a } = awsHue();
  const rows = filterEvents(TRAIL_EVENTS, { user: user === 'todos' ? undefined : user, writeOnly });
  const solved = pick?.id === 'e6';
  return (
    <Frame>
      <Box title="🕵️ Caso: alguien abrió el puerto 22 de web-sg a todo internet. Toca el evento que lo hizo." />
      <T v="label" color={colors.dim}>Usuario (AttributeKey=Username)</T>
      <Tabs color={a} value={user} onChange={setUser} items={USERS.map((u) => ({ id: u, label: u }))} />
      <Toggle label="Solo eventos de escritura (los que cambian cosas)" on={writeOnly} set={setWriteOnly} />
      <Box title={`📜 lookup-events · ${rows.length} eventos`}>
        {rows.map((e) => {
          const on = pick?.id === e.id;
          return (
            <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.time} ${e.user} ${e.name}`} onPress={() => { select(); setPick(e); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: on ? a : 'transparent', backgroundColor: on ? a + '22' : 'transparent' }}>
              <Mono size={10.5} color={colors.dim}>{e.time}</Mono>
              <Mono size={10.5} color={colors.violet}>{e.user}</Mono>
              <View style={{ flex: 1 }}>
                <Mono size={10.5} lines={2} color={e.readOnly ? colors.dim : colors.text}>{e.name}</Mono>
              </View>
              {e.error ? <Pill text="denegado" color={colors.rose} size={10} /> : e.readOnly ? <Mono size={10} color={colors.faint}>lectura</Mono> : <Mono size={10} color={colors.amber}>escritura</Mono>}
            </Pressable>
          );
        })}
      </Box>
      {pick ? (
        <Box title={`🔍 ${pick.name}`} color={solved ? colors.green : a}>
          <Mono size={11}>{`userIdentity: ${pick.user}`}</Mono>
          <Mono size={11}>{`eventTime: ${pick.time}   recurso: ${pick.resource}`}</Mono>
          <Mono size={11}>{`sourceIPAddress: ${pick.ip}   userAgent: ${pick.agent}`}</Mono>
          <Mono size={11} color={pick.error ? colors.rose : colors.text}>{pick.error ? `errorCode: ${pick.error}` : 'errorCode: — (funcionó)'}</Mono>
          <Mono size={11} color={colors.dim}>{pick.detail}</Mono>
        </Box>
      ) : null}
      <Explain k={`${pick?.id ?? 'none'}${user}${writeOnly}`} title={solved ? '✅ Caso resuelto' : pick ? 'Sigue buscando' : 'Cómo investigar'} color={solved ? colors.green : a}>
        {solved
          ? 'Fue carlos, a las 13:12, desde 192.0.2.44 con la CLI, y dejó escrito «solo un momento». Siguiente paso: cerrar la regla, etiquetar el grupo y hablar con él para ofrecerle una alternativa (Session Manager) que no necesite el 22.'
          : pick
            ? pick.name === 'AuthorizeSecurityGroupIngress'
              ? 'Esa apertura es del puerto 80 (la web, legítima). Mira los parámetros del otro evento del mismo tipo.'
              : 'Ese evento no abre ningún puerto. Filtra por «escritura» y busca AuthorizeSecurityGroupIngress: hay dos, solo uno es el 22.'
            : 'Filtra por usuario y por escritura para quedarte con lo que cambia cosas. Fíjate también en los eventos denegados: aunque fallen, quedan registrados (un intento de borrar el grupo, por ejemplo).'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── ¿por qué mi instancia no aparece? ─────────────────────────

export function SsmFleet() {
  const [role, setRole] = useState(true);
  const [agent, setAgent] = useState(true);
  const [internet, setInternet] = useState(true);
  const [endpoints, setEndpoints] = useState(false);
  const [ssh, setSsh] = useState(false);
  const { a } = awsHue();
  const st = fleetStatus({ role, agent, internet, endpoints });
  const REASON: Record<string, string> = {
    ok: 'La instancia aparece como nodo administrado (Online): puedes usar Run Command, Session Manager y Patch Manager sin SSH.',
    'no-agent': 'Sin el agente de SSM en marcha no hay nadie que hable con el servicio. Viene instalado en Amazon Linux y Ubuntu recientes; en una AMI propia hay que instalarlo.',
    'no-role': 'La instancia no tiene un rol de instancia con AmazonSSMManagedInstanceCore: el agente no puede registrarse. Se añade con un perfil de instancia, sin reiniciar.',
    'no-network': 'El agente necesita salir a los servicios de SSM por HTTPS: por internet (IP pública o NAT) o con los tres endpoints de VPC (ssm, ssmmessages y ec2messages) con DNS privado.',
  };
  return (
    <Frame>
      <Toggle label="Rol de instancia con AmazonSSMManagedInstanceCore" on={role} set={setRole} good="on" />
      <Toggle label="Agente de SSM instalado y en marcha" on={agent} set={setAgent} good="on" />
      <Toggle label="Salida a internet (IP pública o NAT)" on={internet} set={setInternet} />
      <Toggle label="Endpoints de VPC: ssm, ssmmessages y ec2messages" on={endpoints} set={setEndpoints} />
      <Toggle label="Puerto 22 abierto en el grupo de seguridad" on={ssh} set={setSsh} hint="no influye en nada" />
      <Box title="🖥️ i-0abc… (web-1)" color={st.online ? colors.green : colors.rose}>
        <Mono color={st.online ? colors.green : colors.rose}>{st.online ? '● Online en Systems Manager' : '○ No aparece como nodo administrado'}</Mono>
        <Mono size={10.5} color={colors.dim}>{'$ aws ssm describe-instance-information'}</Mono>
        <Mono size={10.5} color={st.online ? colors.text : colors.dim}>{st.online ? 'i-0abc…  Online  Amazon Linux 2023' : '(la lista no incluye esta instancia)'}</Mono>
        <Mono size={10.5} color={colors.dim}>{'$ aws ssm send-command --instance-ids i-0abc… …'}</Mono>
        <Mono size={10.5} color={st.online ? colors.green : colors.rose}>{st.online ? 'Command … Status: Pending → Success' : 'InvalidInstanceId: Instances not in a valid state'}</Mono>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={st.online ? 'Online' : 'Sin conexión'} color={st.online ? colors.green : colors.rose} solid />
        <Pill text={ssh ? 'puerto 22 abierto (innecesario)' : 'puerto 22 cerrado (mejor)'} color={ssh ? colors.amber : a} />
      </View>
      <Explain k={`${role}${agent}${internet}${endpoints}`} title={st.online ? '✓ Administrada' : '✖ Falta algo'} color={st.online ? colors.green : colors.rose}>
        {REASON[st.reason]}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── mapa y traza de una petición ─────────────────────────

export function TraceMap() {
  const [inv, setInv] = useState(400);
  const [fault, setFault] = useState(false);
  const [retry, setRetry] = useState(false);
  const { a } = awsHue();
  const t = traceModel({ inventarioMs: inv, ddbFault: fault, retry });
  const slowest = t.bottleneck;
  return (
    <Frame>
      <T v="label" color={colors.dim}>{`Tiempo de la función inventario: ${inv} ms`}</T>
      <Slider min={50} max={3000} value={inv} onChange={(v) => setInv(Math.round(v / 10) * 10)} color={a} label="Tiempo de inventario" />
      <Toggle label="DynamoDB devuelve un error" on={fault} set={setFault} />
      <Toggle label="checkout reintenta la llamada a inventario" on={retry} set={setRetry} />
      <Box title={`🧵 Traza de una petición · ${t.total} ms en total`}>
        {t.segs.map((s) => (
          <View key={s.name} style={{ gap: 2, paddingVertical: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Mono size={10.5} color={s.fault ? colors.rose : colors.text}>{`${s.depth ? '↳ ' : ''}${s.name}`}</Mono>
              <Mono size={10.5} color={colors.dim}>{`${s.dur} ms${s.depth === 0 ? ` (propio ${s.self})` : ''}`}</Mono>
            </View>
            <View style={{ height: 12, borderRadius: 3, backgroundColor: colors.line + '55' }}>
              <View style={{ position: 'absolute', left: `${(s.start / t.total) * 100}%`, width: `${Math.max(1.5, (s.dur / t.total) * 100)}%`, height: 12, borderRadius: 3, backgroundColor: s.fault ? colors.rose : s.name.startsWith(slowest) && s.depth > 0 ? colors.amber : s.depth === 0 ? a + '77' : a }} />
            </View>
          </View>
        ))}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`cuello de botella: ${slowest}`} color={colors.amber} solid />
        <Pill text={fault ? 'traza con fallo (fault)' : 'sin fallos'} color={fault ? colors.rose : colors.green} />
      </View>
      <Explain k={`${inv}${fault}${retry}`} title={fault ? '🔥 Mira el segmento en rojo' : slowest === 'checkout' ? '🧩 El tiempo es de la función' : '⏱ El tiempo se va en otro sitio'} color={fault ? colors.rose : colors.amber}>
        {fault
          ? 'DynamoDB falla y el error sube hasta la traza completa (fault). El mapa de servicios pondría ese nodo en rojo y los filtros `fault` o `service("DynamoDB")` encontrarían esta petición.'
          : slowest === 'checkout'
            ? 'Ninguna llamada es lenta: el tiempo propio de checkout es el mayor. Aquí el cuello de botella estaría en su propio código.'
            : `checkout «tarda» ${t.total} ms, pero casi todo es espera: el tiempo propio está en ${slowest}. Optimizar checkout no serviría de nada. ${retry ? 'Además, el reintento duplica la espera.' : ''}`}
      </Explain>
    </Frame>
  );
}
