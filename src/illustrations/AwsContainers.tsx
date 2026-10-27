import React, { useState } from 'react';
import { View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Slider, StepBar, Tabs, useSteps } from './pyui';
import { Explain, Layer, Pill, Toggle, awsHue } from './awsui';

const Mono = ({ children, color, size = 11.5 }: { children: React.ReactNode; color?: string; size?: number }) => (
  <T style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size + 4 }} color={color ?? colors.text}>{children}</T>
);

const Box = ({ title, color, dim, children }: { title: string; color?: string; dim?: boolean; children?: React.ReactNode }) => {
  const c = color ?? colors.line;
  return (
    <View style={{ borderWidth: 1.5, borderColor: c, backgroundColor: color ? c + '1A' : 'transparent', borderRadius: radius.sm, padding: 8, gap: 3, opacity: dim ? 0.5 : 1 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, lineHeight: 17 }} color={colors.text}>{title}</T>
      {children}
    </View>
  );
};

// ───────────────────────── Dockerfile: capas y caché ─────────────────────────

interface LayerDef {
  id: string;
  cmd: string;
  mb: number;
  secs: number;
  /** De qué depende: el código, las dependencias o nada. */
  uses: 'code' | 'deps' | 'none';
}

const GOOD: LayerDef[] = [
  { id: 'from', cmd: 'FROM python:3.12-slim', mb: 50, secs: 0.5, uses: 'none' },
  { id: 'cdeps', cmd: 'COPY requirements.txt .', mb: 0, secs: 0.1, uses: 'deps' },
  { id: 'pip', cmd: 'RUN pip install -r requirements.txt', mb: 45, secs: 25, uses: 'none' },
  { id: 'ccode', cmd: 'COPY . .', mb: 1, secs: 0.2, uses: 'code' },
  { id: 'cmd', cmd: 'CMD ["python", "app.py"]', mb: 0, secs: 0, uses: 'none' },
];
const BAD: LayerDef[] = [
  { id: 'from', cmd: 'FROM python:3.12-slim', mb: 50, secs: 0.5, uses: 'none' },
  { id: 'ccode', cmd: 'COPY . .', mb: 1, secs: 0.2, uses: 'code' },
  { id: 'pip', cmd: 'RUN pip install -r requirements.txt', mb: 45, secs: 25, uses: 'none' },
  { id: 'cmd', cmd: 'CMD ["python", "app.py"]', mb: 0, secs: 0, uses: 'none' },
];

export function ContainerLayers() {
  const [bad, setBad] = useState(false);
  const [code, setCode] = useState(true);
  const [deps, setDeps] = useState(false);
  const { a } = awsHue();
  const layers = bad ? BAD : GOOD;
  // una capa se reconstruye si cambia lo que usa, o si se reconstruyó cualquiera anterior
  let dirty = false;
  const rows = layers.map((l) => {
    const changed = (l.uses === 'code' && code) || (l.uses === 'deps' && deps) || (bad && l.id === 'ccode' && deps);
    dirty = dirty || changed;
    return { ...l, rebuilt: dirty };
  });
  const secs = rows.reduce((s, r) => s + (r.rebuilt ? r.secs : 0), 0);
  const push = rows.filter((r) => r.rebuilt).reduce((s, r) => s + r.mb, 0);
  return (
    <Frame>
      <Toggle label="Dockerfile con el orden malo: COPY . . antes de pip install" on={bad} set={setBad} good="off" />
      <Toggle label="He cambiado el código (app.py)" on={code} set={setCode} />
      <Toggle label="He cambiado las dependencias (requirements.txt)" on={deps} set={setDeps} />
      <Box title="🏗️ docker build -t tienda:1.1 .">
        {rows.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.rebuilt ? colors.amber : colors.green }} />
            <View style={{ flex: 1 }}>
              <Mono size={11}>{r.cmd}</Mono>
              <Mono size={10.5} color={r.rebuilt ? colors.amber : colors.green}>{r.rebuilt ? `reconstruida · ${r.secs.toFixed(1)} s${r.mb ? ` · ${r.mb} MB` : ''}` : 'Using cache'}</Mono>
            </View>
          </View>
        ))}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`construir: ${secs.toFixed(1)} s`} color={secs > 5 ? colors.rose : colors.green} solid />
        <Pill text={`subir a ECR: ~${push} MB`} color={push > 20 ? colors.amber : a} />
      </View>
      <Explain k={`${bad}${code}${deps}`} title={secs > 5 ? '🐢 Se reinstala todo' : '⚡ Solo lo que cambió'} color={secs > 5 ? colors.amber : a}>
        {!code && !deps
          ? 'Sin cambios, Docker reutiliza todas las capas: la construcción es casi instantánea.'
          : bad && code && !deps
            ? 'COPY . . va antes de pip install: cualquier cambio del código invalida esa capa y arrastra a todas las siguientes, incluida la instalación de dependencias (25 s).'
            : deps
              ? 'Cambian las dependencias: pip install tiene que ejecutarse otra vez (y se vuelve a subir esa capa grande). Es lo esperado.'
              : 'Primero se copian solo las dependencias y se instalan; el código viene después. Al cambiar el código solo se reconstruye su capa (y se sube 1 MB).'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── ECS: despliegue gradual ─────────────────────────

type TaskState = 'old' | 'new-start' | 'new' | 'bad';
const TASK_COLOR: Record<TaskState, string> = { old: colors.green, 'new-start': colors.amber, new: '#38BDF8', bad: colors.rose };
const TASK_TXT: Record<TaskState, string> = { old: 'v1', 'new-start': 'v2…', new: 'v2', bad: '✖ v2' };

interface DState {
  old: number;
  starting: number;
  newOk: number;
  bad: number;
  note: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
}

export function simulate(desired: number, minPct: number, maxPct: number, broken: boolean, breaker: boolean): DState[] {
  const maxTotal = Math.floor((desired * maxPct) / 100);
  const minHealthy = Math.ceil((desired * minPct) / 100);
  const s = { old: desired, starting: 0, newOk: 0, bad: 0 };
  const total = () => s.old + s.newOk + s.starting;
  const out: DState[] = [{ ...s, note: `Hay ${desired} tareas de la versión 1. Se actualiza el servicio a la definición de tarea 2.`, status: 'IN_PROGRESS' }];
  for (let k = 0; k < 9; k++) {
    const notes: string[] = [];
    const resolved = s.starting;
    if (resolved) {
      if (broken) {
        s.bad += resolved;
        notes.push('El balanceador da las tareas nuevas por no sanas: ECS las detiene y las cuenta como fallos');
      } else {
        s.newOk += resolved;
        notes.push('Las tareas nuevas pasan la comprobación de salud y reciben tráfico');
      }
      s.starting = 0;
    }
    if (broken && breaker && s.bad >= Math.max(3, Math.ceil(desired * 0.5))) {
      out.push({ old: desired, starting: 0, newOk: 0, bad: 0, note: 'Interruptor de despliegue: demasiados fallos seguidos. El despliegue se marca FAILED y vuelve a la versión 1 (rollback).', status: 'ROLLED_BACK' });
      return out;
    }
    let healthy = s.old + s.newOk;
    let stopped = 0;
    // sobran tareas (ya hay las nuevas necesarias) o no hay sitio para lanzar: se retiran viejas sin bajar del mínimo sano
    while (s.old > 0 && total() > desired && healthy - 1 >= minHealthy) {
      s.old--;
      healthy--;
      stopped++;
    }
    while (s.old > 0 && desired - s.newOk - s.starting > 0 && total() >= maxTotal && healthy - 1 >= minHealthy) {
      s.old--;
      healthy--;
      stopped++;
    }
    let launched = 0;
    while (s.newOk + s.starting < desired && total() < maxTotal) {
      s.starting++;
      launched++;
    }
    if (stopped) notes.push(`Se retiran ${stopped} tareas viejas (sin bajar de ${minHealthy} sanas)`);
    if (launched) notes.push(`Se lanzan ${launched} nuevas (máximo ${maxTotal} a la vez)`);
    const done = s.newOk >= desired && s.old === 0;
    if (!notes.length && !done) {
      out.push({ ...s, note: `Con ${minPct} % de mínimo sano y ${maxPct} % de máximo no hay margen: ECS no puede ni lanzar ni retirar tareas y el despliegue no avanza.`, status: 'IN_PROGRESS' });
      return out;
    }
    out.push({ ...s, note: notes.join(' — '), status: done ? 'COMPLETED' : 'IN_PROGRESS' });
    if (done) return out;
    if (broken && !breaker && k >= 4) return out;
  }
  return out;
}

export function EcsDeploy() {
  const [minPct, setMin] = useState('100');
  const [maxPct, setMax] = useState('200');
  const [broken, setBroken] = useState(false);
  const [breaker, setBreaker] = useState(false);
  const { a } = awsHue();
  const desired = 4;
  const states = simulate(desired, Number(minPct), Number(maxPct), broken, breaker);
  const n = states.length;
  const { i, go, auto, toggle } = useSteps(n, 2000);
  const s = states[Math.min(i, n - 1)];
  const tasks: TaskState[] = [...Array(s.old).fill('old'), ...Array(s.newOk).fill('new'), ...Array(s.starting).fill('new-start'), ...Array(Math.min(s.bad, 4)).fill('bad')];
  const reset = (f: () => void) => {
    f();
    go(0);
  };
  const stuck = (broken && !breaker && i >= n - 1 && n > 5) || (s.status === 'IN_PROGRESS' && i >= n - 1 && s.note.startsWith('Con '));
  return (
    <Frame>
      <T v="label" color={colors.dim}>minimumHealthyPercent</T>
      <Tabs color={a} value={minPct} onChange={(v) => reset(() => setMin(v))} items={[{ id: '50', label: '50 %' }, { id: '100', label: '100 %' }]} />
      <T v="label" color={colors.dim}>maximumPercent</T>
      <Tabs color={a} value={maxPct} onChange={(v) => reset(() => setMax(v))} items={[{ id: '100', label: '100 %' }, { id: '150', label: '150 %' }, { id: '200', label: '200 %' }]} />
      <Toggle label="La versión 2 está rota (no pasa la comprobación de salud)" on={broken} set={(v) => reset(() => setBroken(v))} good="off" />
      <Toggle label="Interruptor de despliegue con rollback" on={breaker} set={(v) => reset(() => setBreaker(v))} good="on" />
      <StepBar i={Math.min(i, n - 1)} n={n} go={go} auto={auto} toggle={toggle} color={a} hint label={`Paso ${Math.min(i, n - 1) + 1}`} />
      <Box title={`🧩 Servicio · deseadas: ${desired}`}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', minHeight: 34 }}>
          {tasks.map((t, k) => (
            <Pill key={`${t}${k}`} text={TASK_TXT[t]} color={TASK_COLOR[t]} solid={t !== 'new-start'} />
          ))}
        </View>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`sanas: ${s.old + s.newOk}`} color={s.old + s.newOk >= Math.ceil((desired * Number(minPct)) / 100) ? colors.green : colors.rose} />
        {s.bad > 0 ? <Pill text={`fallos: ${s.bad}`} color={colors.rose} /> : null}
        <Pill text={`rolloutState: ${s.status}`} color={s.status === 'COMPLETED' ? colors.green : s.status === 'IN_PROGRESS' ? colors.amber : colors.rose} solid />
      </View>
      <Explain k={`${minPct}${maxPct}${broken}${breaker}${i}`} title={s.status === 'COMPLETED' ? '✓ Despliegue completado' : s.status === 'ROLLED_BACK' ? '↩ Vuelta atrás automática' : stuck ? '⚠ Atascado' : 'Paso a paso'} color={s.status === 'COMPLETED' ? colors.green : s.status === 'ROLLED_BACK' || stuck ? colors.rose : a}>
        {s.note}
        {stuck ? ' Sin interruptor, ECS sigue lanzando tareas que fallan una y otra vez y el despliegue no termina.' : ''}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── Fargate frente a EC2: coste ─────────────────────────

const SIZES = [
  { id: 'xs', label: '0,25 vCPU · 0,5 GB', cpu: 0.25, mem: 0.5 },
  { id: 's', label: '0,5 vCPU · 1 GB', cpu: 0.5, mem: 1 },
  { id: 'm', label: '1 vCPU · 2 GB', cpu: 1, mem: 2 },
];
const P_CPU = 0.04048;
const P_MEM = 0.004445;
const P_CPU_ARM = 0.03238;
const P_MEM_ARM = 0.00356;
const EC2 = { vcpu: 2, mem: 8, price: 0.0832 };

export function FargateCost() {
  const [size, setSize] = useState('s');
  const [tasks, setTasks] = useState(8);
  const [hours, setHours] = useState(24);
  const { a } = awsHue();
  const z = SIZES.find((x) => x.id === size)!;
  const monthH = hours * 30;
  const fg = tasks * (z.cpu * P_CPU + z.mem * P_MEM) * monthH;
  const arm = tasks * (z.cpu * P_CPU_ARM + z.mem * P_MEM_ARM) * monthH;
  const spot = fg * 0.3;
  const perInst = Math.floor(Math.min(EC2.vcpu / z.cpu, EC2.mem / z.mem));
  const inst = Math.ceil(tasks / perInst);
  const ec2 = inst * EC2.price * monthH;
  const rows: { id: string; label: string; cost: number; note: string; color: string }[] = [
    { id: 'fg', label: 'Fargate', cost: fg, note: 'Sin servidores', color: a },
    { id: 'arm', label: 'Fargate ARM', cost: arm, note: 'Imagen arm64', color: '#38BDF8' },
    { id: 'spot', label: 'Fargate Spot', cost: spot, note: 'Interrumpible', color: colors.amber },
    { id: 'ec2', label: `EC2 · ${inst}× t3.large`, cost: ec2, note: `${perInst} tareas por instancia · tú las gestionas`, color: colors.green },
  ];
  const max = Math.max(...rows.map((r) => r.cost), 1);
  const best = rows.reduce((m, r) => (r.cost < m.cost ? r : m), rows[0]);
  const money = (n: number) => `${n.toFixed(n < 100 ? 1 : 0)} $`;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Tamaño de cada tarea</T>
      <Tabs color={a} value={size} onChange={setSize} items={SIZES.map((x) => ({ id: x.id, label: x.label.split(' · ')[0] }))} />
      <T v="label" color={colors.dim}>{`Tareas: ${tasks}`}</T>
      <Slider min={1} max={60} value={tasks} onChange={setTasks} color={a} label="Número de tareas" />
      <T v="label" color={colors.dim}>{`Horas al día encendidas: ${hours}`}</T>
      <Slider min={2} max={24} value={hours} onChange={setHours} color={a} label="Horas al día" />
      {rows.map((r) => (
        <View key={r.id} style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Mono size={11}>{r.label}</Mono>
            <Mono size={11} color={r.id === best.id ? colors.green : colors.text}>{money(r.cost)}/mes</Mono>
          </View>
          <View style={{ height: 10, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(3, (r.cost / max) * 100)}%`, height: 10, backgroundColor: r.color }} />
          </View>
          <Mono size={10} color={colors.dim}>{r.note}</Mono>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`más barato: ${best.label.split(' ·')[0]}`} color={colors.green} solid />
        <Pill text="precios orientativos" color={colors.dim} />
      </View>
      <Explain k={`${size}${tasks}${hours}`} title={best.id === 'ec2' ? 'EC2 sale más barato…' : best.id === 'spot' ? 'Spot es lo más barato' : 'Fargate compensa'} color={a}>
        {best.id === 'ec2'
          ? 'Con muchas tareas encendidas todo el día, llenar instancias es más barato que pagar por tarea. A cambio: parches, AMI, escalado de las instancias y capacidad desaprovechada son cosa tuya.'
          : hours < 12
            ? 'Con pocas horas al día Fargate gana: pagas solo mientras las tareas corren; con EC2 las instancias están ahí (o tienes que automatizar su encendido).'
            : 'Fargate cobra exactamente lo que cada tarea reserva, sin capacidad ociosa. Spot ahorra hasta un 70 % pero AWS puede interrumpir las tareas con 2 minutos de aviso.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── EKS: quién gestiona qué y quién entra ─────────────────────────

const MODES = [
  { id: 'managed', label: 'Nodos administrados', nodes: 'EC2 que EKS lanza y repone', patch: 'tú eliges cuándo actualizar la AMI', owner: 'EKS + tú' },
  { id: 'fargate', label: 'Fargate', nodes: 'Un entorno aislado por pod', patch: 'AWS parchea', owner: 'AWS' },
  { id: 'self', label: 'Autogestionados', nodes: 'Tus propias instancias y AMI', patch: 'todo es tuyo', owner: 'Tú' },
];

export function EksArch() {
  const [view, setView] = useState('quien');
  const [mode, setMode] = useState('managed');
  const [entry, setEntry] = useState(false);
  const [policy, setPolicy] = useState('none');
  const [write, setWrite] = useState(true);
  const { a } = awsHue();
  const m = MODES.find((x) => x.id === mode)!;
  const mine = colors.amber;
  const theirs = '#38BDF8';
  // acceso
  let result: { code: string; color: string; msg: string };
  if (!entry) result = { code: 'Unauthorized', color: colors.rose, msg: 'error: You must be logged in to the server (Unauthorized) — IAM te reconoce, pero el clúster no sabe quién eres: falta la access entry.' };
  else if (policy === 'none' || (write && policy === 'view')) result = { code: 'Forbidden', color: colors.rose, msg: write ? 'Error from server (Forbidden): deployments.apps is forbidden: User … cannot create resource "deployments"' : 'Error from server (Forbidden): pods is forbidden: User … cannot list resource "pods"' };
  else result = { code: 'OK', color: colors.green, msg: write ? 'deployment.apps/web created' : 'NAME   READY   STATUS    …' };
  return (
    <Frame>
      <Tabs color={a} value={view} onChange={setView} items={[{ id: 'quien', label: 'Quién gestiona qué' }, { id: 'acceso', label: 'Quién entra' }]} />
      {view === 'quien' ? (
        <>
          <Tabs color={a} value={mode} onChange={setMode} items={MODES.map((x) => ({ id: x.id, label: x.label }))} />
          <Layer label="API de Kubernetes · etcd · planificador" owner="AWS" color={theirs} hint="plano de control multi-zona, parches de versión incluidos" />
          <Layer label={`Nodos · ${m.nodes}`} owner={m.owner} color={mode === 'fargate' ? theirs : mode === 'self' ? mine : '#A78BFA'} hint={m.patch} />
          <Layer label="Red de pods (VPC CNI) · kube-proxy · CoreDNS" owner="EKS + tú" color="#A78BFA" hint="complementos: tú decides cuándo actualizarlos" />
          <Layer label="Tus aplicaciones: imágenes, manifiestos, permisos" owner="Tú" color={mine} hint="siempre tuyo" />
          <Explain k={mode} title={mode === 'fargate' ? 'Sin nodos que mantener' : mode === 'self' ? 'Máximo control, máximo trabajo' : 'El término medio'} color={a}>
            {mode === 'fargate'
              ? 'Cada pod que coincide con un perfil de Fargate corre en su propio entorno: no hay instancias que parchear ni capacidad que planificar. A cambio no hay DaemonSets ni GPU, y arranca más despacio.'
              : mode === 'self'
                ? 'Eliges AMI, tamaño, sistema operativo y cuándo reemplazar. Tú actualizas los nodos y los drenas. Solo si necesitas algo que los administrados no ofrecen.'
                : 'EKS crea y repone las instancias, y orquesta las actualizaciones (drenando los pods). Tú eliges la versión y el tipo de instancia. Lo más habitual.'}
          </Explain>
        </>
      ) : (
        <>
          <Toggle label="Tu usuario de IAM tiene una access entry en el clúster" on={entry} set={setEntry} good="on" />
          <T v="label" color={colors.dim}>Política de acceso asociada</T>
          <Tabs color={a} value={policy} onChange={setPolicy} items={[{ id: 'none', label: 'Ninguna' }, { id: 'view', label: 'Lectura' }, { id: 'edit', label: 'Edición' }]} />
          <Toggle label="Quieres crear un deployment (si no, solo listar pods)" on={write} set={setWrite} />
          <Box title="🔐 kubectl → aws eks get-token → API de Kubernetes">
            <Mono>{'1. IAM: ¿credenciales válidas?  ✓'}</Mono>
            <Mono color={entry ? colors.green : colors.rose}>{`2. Access entry del clúster: ${entry ? '✓' : '✖ no hay'}`}</Mono>
            <Mono color={entry && policy !== 'none' ? colors.green : colors.dim}>{`3. Política de acceso: ${policy === 'none' ? '—' : policy === 'view' ? 'AmazonEKSViewPolicy' : 'AmazonEKSEditPolicy'}`}</Mono>
          </Box>
          <Pill text={result.code} color={result.color} solid />
          <Explain k={`${entry}${policy}${write}`} title={result.code === 'OK' ? '✓ Permitido' : result.code} color={result.color}>
            {result.msg}
          </Explain>
        </>
      )}
    </Frame>
  );
}

// ───────────────────────── escalado automático de un servicio ─────────────────────────

const CAP = 30; // peticiones por segundo que aguanta una tarea de 0,25 vCPU

export function ContainerScaling() {
  const [rps, setRps] = useState(60);
  const [target, setTarget] = useState('50');
  const [max, setMax] = useState('8');
  const [minT, setMinT] = useState(2);
  const { a } = awsHue();
  const T0 = Number(target);
  const mx = Number(max);
  const cpuOf = (n: number) => Math.min(100, 2 + (rps / n / CAP) * 100);
  // el servicio acaba en el menor número de tareas con el que la CPU queda en el objetivo (o en el máximo)
  let n = minT;
  while (n < mx && cpuOf(n) > T0) n++;
  const cpu = cpuOf(n);
  const capped = n >= mx && cpu > T0;
  return (
    <Frame>
      <T v="label" color={colors.dim}>{`Carga: ${rps} peticiones por segundo`}</T>
      <Slider min={0} max={300} value={rps} onChange={setRps} color={a} label="Peticiones por segundo" />
      <T v="label" color={colors.dim}>CPU objetivo</T>
      <Tabs color={a} value={target} onChange={setTarget} items={[{ id: '30', label: '30 %' }, { id: '50', label: '50 %' }, { id: '70', label: '70 %' }]} />
      <T v="label" color={colors.dim}>Máximo de tareas</T>
      <Tabs color={a} value={max} onChange={setMax} items={[{ id: '4', label: '4' }, { id: '8', label: '8' }, { id: '12', label: '12' }]} />
      <T v="label" color={colors.dim}>{`Mínimo de tareas: ${minT}`}</T>
      <Slider min={1} max={4} value={minT} onChange={setMinT} color={a} label="Mínimo de tareas" />
      <Box title={`🧩 Tareas en marcha: ${n}`}>
        <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
          {Array.from({ length: n }, (_, k) => (
            <View key={k} style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: cpu > T0 ? colors.rose : k < minT ? colors.green : a }} />
          ))}
        </View>
        <Mono color={colors.dim}>{`verde: mínimo · color del curso: añadidas · rojo: sobrecarga`}</Mono>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`CPU media: ${cpu.toFixed(0)} %`} color={cpu > T0 ? colors.rose : colors.green} solid />
        <Pill text={`por tarea: ${(rps / n).toFixed(0)} peticiones/s`} color={a} />
      </View>
      <Explain k={`${rps}${target}${max}${minT}`} title={capped ? '⚠ Techo alcanzado' : n > minT ? '↑ Escala hacia fuera' : '✓ Dentro del objetivo'} color={capped ? colors.rose : a}>
        {capped
          ? `Con el máximo en ${mx} la CPU se queda en ${cpu.toFixed(0)} %, por encima del objetivo: Application Auto Scaling no puede pasar del máximo. Sube el máximo (o aligera la tarea).`
          : n > minT
            ? `Seguimiento de objetivo: cada tarea aguanta ~${CAP} peticiones/s; para mantener la CPU en ${T0} % o menos hacen falta ${n} tareas. Las crea la política con sus alarmas de CloudWatch. Al bajar la carga, tras ~15 minutos seguidos por debajo del objetivo, volvería a quitarlas (se sube rápido y se baja despacio).`
            : 'La carga cabe en el mínimo: no hay nada que escalar. El mínimo es también tu red de seguridad ante una subida repentina mientras arrancan tareas nuevas.'}
      </Explain>
    </Frame>
  );
}
