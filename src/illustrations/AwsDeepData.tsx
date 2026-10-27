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

const Mono = ({ children, color }: { children: React.ReactNode; color?: string }) => (
  <T style={{ fontFamily: fonts.mono, fontSize: 11.5 }} color={color ?? colors.text}>{children}</T>
);

/** Barra horizontal con una marca de límite (0–100 % del ancho; la marca en `limit` %). */
const Bar = ({ pct, color, limit, label }: { pct: number; color: string; limit?: number; label: string }) => (
  <View style={{ gap: 2 }}>
    <Mono>{label}</Mono>
    <View style={{ height: 12, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 12, backgroundColor: color }} />
      {limit !== undefined ? <View style={{ position: 'absolute', left: `${limit}%`, top: 0, bottom: 0, width: 2, backgroundColor: colors.text }} /> : null}
    </View>
  </View>
);

// ───────────────────────── DynamoDB: la clave de partición reparte (o no) la carga ─────────────────────────

const KEYS = [
  { id: 'cliente', label: 'cliente', dist: [25, 25, 25, 25], note: 'Miles de clientes distintos: el reparto es casi uniforme.' },
  { id: 'estado', label: 'estado', dist: [70, 20, 10, 0], note: 'Solo tres valores (pendiente, enviado, entregado) y casi todo es «pendiente»: tres particiones como mucho, una con la mayor parte.' },
  { id: 'dia', label: 'fecha de hoy', dist: [100, 0, 0, 0], note: 'Todas las escrituras de hoy tienen la misma clave: una única partición recibe todo mientras las demás duermen.' },
];

export function DdbHotKey() {
  const [key, setKey] = useState('cliente');
  const [wps, setWps] = useState(2000);
  const [famous, setFamous] = useState(false);
  const [shard, setShard] = useState(false);
  const { a } = awsHue();
  const k = KEYS.find((x) => x.id === key)!;
  let dist = [...k.dist];
  // un cliente muy popular concentra tráfico en la partición que lo contiene
  if (famous && key === 'cliente') dist = [55, 15, 15, 15];
  // sufijo aleatorio (0–9) en la clave: reparte el tráfico de una clave caliente
  if (shard) dist = [25, 25, 25, 25];
  const LIMIT = 1000;
  const loads = dist.map((p) => Math.round((p / 100) * wps));
  const hot = Math.max(...loads);
  const throttled = loads.reduce((n, l) => n + Math.max(0, l - LIMIT), 0);
  return (
    <Frame>
      <T v="label" color={colors.dim}>Clave de partición de la tabla de pedidos</T>
      <Tabs color={a} value={key} onChange={setKey} items={KEYS.map((x) => ({ id: x.id, label: x.label }))} />
      <Stepper label="Escrituras por segundo" value={wps} min={500} max={4000} step={500} onChange={setWps} />
      {key === 'cliente' ? <Toggle label="Un cliente muy popular (una «celebrity»)" on={famous} set={setFamous} good="off" /> : null}
      <Toggle label="Añadir un sufijo aleatorio 0–9 a la clave (write sharding)" on={shard} set={setShard} good="on" hint="cliente#7, cliente#2…" />
      <Box title="🗄️ Las 4 particiones de la tabla" ok={throttled === 0}>
        {loads.map((l, i) => (
          <Bar key={i} pct={(l / (LIMIT * 1.5)) * 100} limit={(LIMIT / (LIMIT * 1.5)) * 100} color={l > LIMIT ? colors.rose : a} label={`partición ${i + 1} · ${l} escrituras/s${l > LIMIT ? ' ⚠' : ''}`} />
        ))}
        <T v="tiny" color={colors.dim}>La línea negra marca el límite de una partición: 1.000 escrituras/s (3.000 lecturas/s).</T>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`la más cargada: ${hot}/s`} color={hot > LIMIT ? colors.rose : colors.green} />
        <Pill text={throttled ? `${throttled}/s rechazadas (throttling)` : 'sin throttling'} color={throttled ? colors.rose : colors.green} solid />
      </View>
      <Explain k={`${key}${wps}${famous}${shard}`} title={throttled ? 'Partición caliente' : '✓ Carga repartida'} color={throttled ? colors.rose : colors.green}>
        {shard ? 'Con un sufijo aleatorio la misma «clave lógica» se reparte en diez claves físicas y el tráfico se extiende. A cambio, para leerla tienes que consultar los diez sufijos y juntar los resultados.' : k.note}{' '}
        {throttled ? 'Aunque la tabla esté en modo bajo demanda, cada partición tiene su propio límite: una clave mal elegida se estrangula mientras el resto está vacío. No se arregla pagando más capacidad: se arregla eligiendo una clave con muchos valores y reparto parejo.' : 'Es lo que buscas: muchos valores distintos y accesos parejos.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── DynamoDB Streams: qué ve el consumidor ─────────────────────────

const OPS = [
  { id: 'put', label: 'Nuevo pedido', name: 'INSERT', old: null, nu: '{ id: "7", estado: "nuevo" }' },
  { id: 'upd', label: 'Cambia el estado', name: 'MODIFY', old: '{ id: "7", estado: "nuevo" }', nu: '{ id: "7", estado: "enviado" }' },
  { id: 'del', label: 'Se borra', name: 'REMOVE', old: '{ id: "7", estado: "enviado" }', nu: null },
  { id: 'ttl', label: 'Caduca (TTL)', name: 'REMOVE', old: '{ id: "7", estado: "enviado" }', nu: null, ttl: true },
];
const VIEWS = ['KEYS_ONLY', 'NEW_IMAGE', 'OLD_IMAGE', 'NEW_AND_OLD_IMAGES'];

export function DdbStreams() {
  const [op, setOp] = useState('upd');
  const [view, setView] = useState('NEW_AND_OLD_IMAGES');
  const [global, setGlobal] = useState(false);
  const { a } = awsHue();
  const o = OPS.find((x) => x.id === op)!;
  const showNew = (view === 'NEW_IMAGE' || view === 'NEW_AND_OLD_IMAGES') && o.nu;
  const showOld = (view === 'OLD_IMAGE' || view === 'NEW_AND_OLD_IMAGES') && o.old;
  const replicaNeeds = view === 'NEW_AND_OLD_IMAGES';
  return (
    <Frame>
      <T v="label" color={colors.dim}>Lo que ocurre en la tabla</T>
      <Tabs color={a} value={op} onChange={setOp} items={OPS.map((x) => ({ id: x.id, label: x.label }))} />
      <T v="label" color={colors.dim}>StreamViewType del stream</T>
      <Tabs color={a} value={view} onChange={setView} items={VIEWS.map((x) => ({ id: x, label: x.replace('_AND_', '+').replace('_IMAGES', '').replace('_IMAGE', '') }))} />
      <Box title="📬 Registro del stream" ok>
        <Mono>{`eventName: "${o.name}"`}</Mono>
        {o.ttl ? <Mono color={colors.amber}>userIdentity: dynamodb.amazonaws.com (lo borró el TTL)</Mono> : null}
        <Mono>Keys: {'{ id: "7" }'}</Mono>
        {showNew ? <Mono>NewImage: {o.nu}</Mono> : null}
        {showOld ? <Mono>OldImage: {o.old}</Mono> : null}
        {!showNew && !showOld ? <Mono color={colors.dim}>(sin imágenes: solo las claves)</Mono> : null}
      </Box>
      <Toggle label="La tabla es global (réplica en eu-west-1)" on={global} set={setGlobal} />
      {global ? (
        <Box title={replicaNeeds ? '🌍 Réplica en eu-west-1' : '🌍 No se puede activar'} ok={replicaNeeds}>
          <T v="tiny" color={replicaNeeds ? colors.green : colors.rose}>
            {replicaNeeds ? 'Las tablas globales usan este stream para copiar cada cambio a la otra región (último escritor gana).' : 'Una tabla global exige NEW_AND_OLD_IMAGES y modo bajo demanda (o capacidad provisionada con auto scaling).'}
          </T>
        </Box>
      ) : null}
      <Explain k={`${op}${view}${global}`} title="Cómo se consume" color={a}>
        Los registros se conservan 24 horas, en orden por elemento. Lambda los lee por lotes con una asignación de origen de eventos: si una función falla con un registro, ese fragmento se bloquea y se reintenta hasta que funcione o caduque; para no atascarlo limita los reintentos, trocea el lote al fallar y manda lo que no se pueda procesar a una cola de fallos.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── RDS Proxy: demasiadas conexiones ─────────────────────────

const CLASSES = [
  { id: 'db.t3.micro', mem: 1, max: 85 },
  { id: 'db.t3.small', mem: 2, max: 170 },
  { id: 'db.m5.large', mem: 8, max: 683 },
];

export function RdsProxyPool() {
  const [cls, setCls] = useState('db.t3.micro');
  const [clients, setClients] = useState(200);
  const [proxy, setProxy] = useState(false);
  const [pct, setPct] = useState(80);
  const { a } = awsHue();
  const c = CLASSES.find((x) => x.id === cls)!;
  const poolMax = Math.floor((c.max * pct) / 100);
  const used = proxy ? Math.min(clients, poolMax) : Math.min(clients, c.max);
  const refused = proxy ? 0 : Math.max(0, clients - c.max);
  const waiting = proxy ? Math.max(0, clients - poolMax) : 0;
  const bad = refused > 0;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Clase de la instancia (max_connections ≈ memoria / 12.582.880)</T>
      <Tabs color={a} value={cls} onChange={setCls} items={CLASSES.map((x) => ({ id: x.id, label: `${x.id} · ${x.mem} GiB` }))} />
      <Stepper label="Conexiones que piden tus funciones / servidores" value={clients} min={20} max={1000} step={20} onChange={setClients} />
      <Toggle label="Poner un RDS Proxy delante" on={proxy} set={setProxy} good="on" />
      {proxy ? <Stepper label="MaxConnectionsPercent del proxy" value={pct} min={10} max={100} step={10} unit="%" onChange={setPct} /> : null}
      <Box title="🗄️ Conexiones a la base de datos" ok={!bad}>
        <Bar pct={(used / c.max) * 100} color={bad ? colors.rose : a} label={`${used} de ${c.max} (max_connections)`} />
        {proxy ? <Mono color={colors.dim}>El proxy mantiene como mucho {poolMax} abiertas y las comparte («multiplexa»).</Mono> : null}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={refused ? `${refused} rechazadas` : 'ninguna rechazada'} color={refused ? colors.rose : colors.green} solid />
        {waiting ? <Pill text={`${waiting} esperan turno`} color={colors.amber} /> : null}
      </View>
      <Explain k={`${cls}${clients}${proxy}${pct}`} title={bad ? 'ERROR 1040: Too many connections' : proxy ? '✓ El proxy absorbe el pico' : '✓ Cabe'} color={bad ? colors.rose : colors.green}>
        {bad
          ? 'Cada función Lambda abre su propia conexión y, con muchas ejecuciones a la vez, la base de datos se queda sin ellas. Subir max_connections (parámetro) o la clase ayuda, pero cada conexión gasta memoria.'
          : proxy
            ? 'El proxy mantiene un conjunto pequeño de conexiones y las presta a quien las pide: los clientes esperan un instante en vez de ser rechazados. Además acelera la conmutación por error y guarda las credenciales en Secrets Manager.'
            : 'Mientras las conexiones quepan en max_connections no hay problema. Súbelas para ver qué pasa.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── Patrones de caché ─────────────────────────

const PATTERNS = [
  { id: 'aside', label: 'Cache-aside', desc: 'La aplicación manda: mira la caché; si falla, lee de la base de datos y guarda en la caché.' },
  { id: 'read', label: 'Read-through', desc: 'La aplicación solo habla con la caché; es la caché la que carga de la base de datos cuando falla.' },
  { id: 'write', label: 'Write-through', desc: 'Cada escritura va a la caché y a la base de datos a la vez: la caché siempre está al día.' },
  { id: 'behind', label: 'Write-behind', desc: 'Se escribe en la caché y la base de datos se actualiza después, en lotes: muy rápido, pero puede perderse un dato.' },
];

export function CachePatterns() {
  const [p, setP] = useState('aside');
  const [hit, setHit] = useState(true);
  const [changed, setChanged] = useState(false);
  const [ttl, setTtl] = useState(300);
  const { a } = awsHue();
  const pat = PATTERNS.find((x) => x.id === p)!;
  const read = p === 'aside' || p === 'read';
  const steps: { text: string; ms: number; bad?: boolean }[] = [];
  if (read) {
    steps.push({ text: p === 'aside' ? 'La aplicación pregunta a Redis' : 'La aplicación pide el dato a la caché', ms: 1 });
    if (hit) steps.push({ text: changed ? '✓ Acierto (HIT), pero el valor es el viejo' : '✓ Acierto (HIT): devuelve el valor', ms: 0, bad: changed });
    else {
      steps.push({ text: '✖ Fallo (MISS)', ms: 0 });
      steps.push({ text: p === 'aside' ? 'La aplicación consulta la base de datos' : 'La caché consulta la base de datos', ms: 40 });
      steps.push({ text: p === 'aside' ? 'La aplicación guarda el dato en Redis con TTL' : 'La caché guarda el dato con TTL', ms: 1 });
    }
  } else if (p === 'write') {
    steps.push({ text: 'La aplicación escribe en la caché', ms: 1 });
    steps.push({ text: 'Se escribe también en la base de datos (se espera)', ms: 40 });
  } else {
    steps.push({ text: 'La aplicación escribe en la caché', ms: 1 });
    steps.push({ text: 'Responde ya; la base de datos se actualiza más tarde, en lotes', ms: 0 });
    steps.push({ text: '⚠ Si la caché cae antes del volcado, ese dato se pierde', ms: 0, bad: true });
  }
  const total = steps.reduce((n, s) => n + s.ms, 0);
  return (
    <Frame>
      <Tabs color={a} value={p} onChange={setP} items={PATTERNS.map((x) => ({ id: x.id, label: x.label }))} />
      <T v="small" color={colors.text}>{pat.desc}</T>
      {read ? <Toggle label="El dato está en la caché (acierto)" on={hit} set={setHit} good="on" /> : null}
      {read && hit ? <Toggle label="El dato ha cambiado en la base de datos desde que se cacheó" on={changed} set={setChanged} good="off" /> : null}
      {read ? <Stepper label="TTL de la caché" value={ttl} min={10} max={3600} step={30} unit=" s" onChange={setTtl} /> : null}
      <Box title="⏱️ Recorrido de la petición" ok={!steps.some((s) => s.bad)}>
        {steps.map((s, i) => (
          <Mono key={i} color={s.bad ? colors.rose : colors.text}>
            {i + 1}. {s.text}
            {s.ms ? ` · ${s.ms} ms` : ''}
          </Mono>
        ))}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`≈ ${total} ms`} color={total > 20 ? colors.amber : colors.green} solid />
        {read ? <Pill text={`el dato viejo vive hasta ${ttl} s`} color={a} /> : null}
      </View>
      <Explain k={`${p}${hit}${changed}${ttl}`} title={read ? (hit ? (changed ? 'Dato desactualizado hasta que expire' : 'El camino rápido') : 'El camino lento, una sola vez') : p === 'write' ? 'Coherente pero escribe más despacio' : 'Rapidísimo pero con riesgo'} color={read && hit && changed ? colors.amber : a}>
        {read
          ? 'La caché acierta casi siempre y alivia a la base de datos. Lo que pagas es la posible desactualización: el TTL es el compromiso entre datos frescos y aciertos. Para datos que no pueden estar viejos, invalida la clave al escribir (delete tras el update).'
          : p === 'write'
            ? 'Evitas leer datos viejos, pero guardas en la caché cosas que quizá nadie vuelva a leer. Suele combinarse con un TTL.'
            : 'Absorbe picos de escritura, pero la base de datos no es la fuente de la verdad hasta que se vuelca. Úsalo solo si puedes tolerar perder datos.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── Migración: DMS, DataSync y Snow ─────────────────────────

const PHASES = [
  { t: 'Origen y destino creados', d: 'Dos endpoints (origen y destino) y una instancia de replicación. Pruebas de conexión: red, credenciales y permisos.' },
  { t: 'Carga completa (full load)', d: 'La tarea copia todas las tablas elegidas. El origen sigue funcionando y los cambios nuevos se van anotando.' },
  { t: 'Replicación continua (CDC)', d: 'Se aplican los cambios que llegaron durante la carga y, desde ahí, cada cambio nuevo en segundos. Origen y destino quedan sincronizados.' },
  { t: 'Corte (cutover)', d: 'Paras las escrituras, esperas a que el retraso llegue a 0 y apuntas la aplicación al destino. Minutos de parada, no horas.' },
];

export function MigrationPaths() {
  const [path, setPath] = useState('dms');
  const [step, setStep] = useState(1);
  const [tb, setTb] = useState(50);
  const [mbps, setMbps] = useState(200);
  const { a } = awsHue();
  const days = (tb * 8e6) / mbps / 86400;
  const snow = days > 10;
  return (
    <Frame>
      <Tabs
        color={a}
        value={path}
        onChange={setPath}
        items={[
          { id: 'dms', label: 'Base de datos · DMS' },
          { id: 'sync', label: 'Archivos · DataSync' },
          { id: 'snow', label: 'Mucho dato · Snow' },
        ]}
      />
      {path === 'dms' ? (
        <>
          <Stepper label="Fase de la migración" value={step} min={0} max={3} onChange={setStep} />
          <Box title="🗄️ Origen  →  🖥️ Instancia de replicación  →  🪣 Destino" ok>
            <Mono>MySQL local / RDS · motor igual o distinto · S3 · DynamoDB · Aurora</Mono>
          </Box>
          {PHASES.map((ph, i) => (
            <Box key={ph.t} title={`${i < step ? '✓' : i === step ? '▶' : '·'} ${ph.t}`} ok={i < step ? true : undefined}>
              {i === step ? <T v="tiny" color={colors.text}>{ph.d}</T> : null}
            </Box>
          ))}
          <Explain k={`${path}${step}`} title="Migrar sin parar" color={a}>
            Para pasar de un motor a otro (Oracle → PostgreSQL) se usa antes el AWS Schema Conversion Tool para convertir el esquema; DMS mueve los datos. Para CDC el origen debe registrar los cambios (MySQL: binlog en formato ROW y copias automáticas activas; PostgreSQL: replicación lógica).
          </Explain>
        </>
      ) : path === 'sync' ? (
        <>
          <Box title="📁 NFS / SMB de la oficina  →  🤖 Agente  →  🪣 S3 / EFS / FSx" ok>
            <Mono>Copias programadas, solo cambios, verificación de integridad</Mono>
          </Box>
          <Explain k={path} title="Archivos, no tablas" color={a}>
            DataSync copia carpetas enteras entre almacenamientos locales y AWS (o entre servicios de AWS) hasta 10 veces más rápido que a mano. Instalas un agente en tu red, creas dos ubicaciones y una tarea con filtros (por ejemplo, solo /ventas*). Cada ejecución copia solo lo que cambió.
          </Explain>
        </>
      ) : (
        <>
          <Stepper label="Datos a mover" value={tb} min={1} max={500} step={10} unit=" TB" onChange={setTb} />
          <Stepper label="Ancho de banda disponible" value={mbps} min={50} max={5000} step={50} unit=" Mbps" onChange={setMbps} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill text={`por red: ${days < 1 ? '< 1 día' : `${Math.round(days)} días`}`} color={snow ? colors.rose : colors.green} />
            <Pill text="Snowball: ≈ 1–2 semanas con envíos" color={a} solid={snow} />
          </View>
          <Explain k={`${tb}${mbps}`} title={snow ? 'Mejor un dispositivo físico' : 'La red basta'} color={snow ? colors.amber : colors.green}>
            {snow ? 'Con tanto volumen y tan poca línea, subir por Internet tardaría semanas o meses. Un Snowball Edge (hasta 210 TB utilizables) se carga en tu centro de datos, se envía a AWS y se vuelca en S3.' : 'Si la transferencia por red tarda menos que un envío físico, DataSync o aws s3 sync son más simples. La regla práctica: si tardas más de una semana por red, piensa en Snow.'}
          </Explain>
        </>
      )}
    </Frame>
  );
}
