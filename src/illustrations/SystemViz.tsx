import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, withSpring, ZoomIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Caption, Chips, FlowDiagram, Frame, MonoBox, StepControls, useStepper, type FlowNode, type FlowStep } from './common';

// ───────────────────────── estados de un proceso ─────────────────────────

export function ProcessStates() {
  const nodes: FlowNode[] = [
    { id: 'new', label: 'Nuevo', sub: 'fork()', emoji: '🐣', x: 17, y: 14, color: colors.mint },
    { id: 'ready', label: 'Listo', sub: 'R · en cola', emoji: '🚦', x: 50, y: 14, color: colors.cyan },
    { id: 'run', label: 'Ejecutando', sub: 'R · con CPU', emoji: '🏃', x: 83, y: 14, color: colors.green },
    { id: 'sleep', label: 'Durmiendo', sub: 'S · esperando', emoji: '😴', x: 83, y: 50, color: colors.violet },
    { id: 'stopped', label: 'Detenido', sub: 'T · Ctrl+Z', emoji: '⏸️', x: 50, y: 50, color: colors.amber },
    { id: 'zombie', label: 'Zombi', sub: 'Z · sin recoger', emoji: '🧟', x: 83, y: 86, color: colors.rose },
    { id: 'done', label: 'Terminado', sub: 'fuera de ps', emoji: '🪦', x: 50, y: 86, color: colors.faint },
  ];
  const edges: [string, string][] = [['new', 'ready'], ['ready', 'run'], ['run', 'sleep'], ['sleep', 'ready'], ['run', 'stopped'], ['stopped', 'ready'], ['run', 'zombie'], ['zombie', 'done']];
  const steps: FlowStep[] = [
    { from: 'new', to: 'ready', packet: 'PID 2301', text: 'fork(): un proceso hijo nace con su PID y con un PPID (el PID de su padre). Entra en la cola de procesos listos.' },
    { from: 'ready', to: 'run', packet: 'CPU', text: 'El planificador del kernel le asigna tiempo de CPU: ahora se está ejecutando (estado R).' },
    { from: 'run', to: 'sleep', packet: 'espera E/S', text: 'Necesita leer del disco o de la red. Pasa a dormir (S): no gasta CPU mientras espera.' },
    { from: 'sleep', to: 'ready', packet: 'datos listos', text: 'Llegan los datos: despierta y vuelve a la cola de listos.' },
    { from: 'run', to: 'stopped', packet: 'SIGTSTP', text: 'Pulsas Ctrl+Z: el proceso queda detenido (T), congelado en memoria.' },
    { from: 'stopped', to: 'ready', packet: 'SIGCONT', text: 'fg o bg lo reanudan enviándole SIGCONT.' },
    { from: 'run', to: 'zombie', packet: 'exit(0)', text: 'Termina. Mientras su padre no recoja su código de salida con wait(), queda como zombi (Z): ocupa una fila de la tabla pero ningún recurso.' },
    { from: 'zombie', to: 'done', packet: 'wait()', text: 'El padre lo recoge y desaparece de ps. Si el padre muriera antes, init (PID 1) adopta a sus huérfanos.' },
  ];
  return <FlowDiagram title="La vida de un proceso" nodes={nodes} edges={edges} steps={steps} height={290} nodeW={96} />;
}

// ───────────────────────── señales ─────────────────────────

type Sig = 'INT' | 'TERM' | 'KILL' | 'TSTP' | 'CONT' | 'HUP';
const SIGS: { id: Sig; label: string; n: number }[] = [
  { id: 'INT', label: 'Ctrl+C · INT 2', n: 2 },
  { id: 'TERM', label: 'kill · TERM 15', n: 15 },
  { id: 'KILL', label: 'kill -9 · KILL 9', n: 9 },
  { id: 'TSTP', label: 'Ctrl+Z · TSTP 20', n: 20 },
  { id: 'CONT', label: 'fg/bg · CONT 18', n: 18 },
  { id: 'HUP', label: 'HUP 1', n: 1 },
];

export function Signals() {
  const [handler, setHandler] = useState(false);
  const [state, setState] = useState<'running' | 'stopped' | 'dead'>('running');
  const [log, setLog] = useState<string[]>([]);
  const say = (m: string) => setLog((l) => [...l.slice(-3), m]);
  const send = (s: Sig) => {
    tap();
    if (state === 'dead') {
      say(`→ SIG${s}: el proceso ya no existe`);
      return;
    }
    switch (s) {
      case 'INT':
        say(handler ? '→ SIGINT atrapada: guarda datos y sale limpiamente' : '→ SIGINT: interrumpido (código 130)');
        setState('dead');
        break;
      case 'TERM':
        say(handler ? '→ SIGTERM atrapada: cierra archivos, borra temporales y termina' : '→ SIGTERM: el proceso termina');
        setState('dead');
        break;
      case 'KILL':
        say('→ SIGKILL: muerte inmediata. No se puede atrapar ni ignorar');
        setState('dead');
        break;
      case 'TSTP':
        say('→ SIGTSTP: proceso detenido (T)');
        setState('stopped');
        break;
      case 'CONT':
        say(state === 'stopped' ? '→ SIGCONT: reanudado' : '→ SIGCONT: ya estaba en marcha');
        setState('running');
        break;
      case 'HUP':
        if (handler) say('→ SIGHUP atrapada: recarga su configuración y sigue vivo');
        else {
          say('→ SIGHUP: sin manejador, el proceso muere');
          setState('dead');
        }
        break;
    }
  };
  const reset = () => {
    setState('running');
    setLog([]);
  };
  const col = state === 'running' ? colors.green : state === 'stopped' ? colors.amber : colors.rose;
  return (
    <Frame title="Envía señales a un proceso">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Animated.View key={state} entering={ZoomIn.duration(250)} style={{ width: 84, height: 70, borderRadius: 16, borderWidth: 2.5, borderColor: col, backgroundColor: col + '22', alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontSize: 26 }}>{state === 'running' ? '⚙️' : state === 'stopped' ? '⏸️' : '💀'}</T>
          <T v="tiny" bold color={col}>{state === 'running' ? 'R/S' : state === 'stopped' ? 'T' : 'muerto'}</T>
        </Animated.View>
        <View style={{ flex: 1, gap: 6 }}>
          <Pressable onPress={() => { tap(); setHandler((h) => !h); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: handler ? colors.mint : colors.card2, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', paddingHorizontal: 2, alignItems: handler ? 'flex-end' : 'flex-start' }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' }} />
            </View>
            <T v="small" style={{ flex: 1 }}>El proceso tiene un manejador (trap)</T>
          </Pressable>
          {state === 'dead' && (
            <Pressable onPress={() => { tap(); reset(); }}>
              <T v="tiny" bold color={colors.cyan}>↺ Lanzar otro proceso</T>
            </Pressable>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SIGS.map((s) => (
          <Pressable key={s.id} onPress={() => send(s.id)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: s.id === 'KILL' ? colors.rose + '22' : colors.card2, borderWidth: 1, borderColor: s.id === 'KILL' ? colors.rose : colors.line }}>
            <T v="tiny" bold color={s.id === 'KILL' ? colors.rose : colors.text} style={{ fontFamily: fonts.monoBold }}>{s.label}</T>
          </Pressable>
        ))}
      </View>
      <MonoBox color={colors.dim} size={12}>{log.length ? log.join('\n') : 'Pulsa una señal…'}</MonoBox>
      <Caption>SIGTERM pide educadamente; SIGKILL no se puede atrapar. Prueba con y sin manejador.</Caption>
    </Frame>
  );
}

// ───────────────────────── cron ─────────────────────────

const CRON_PRESETS = [
  { id: 'min', label: 'cada minuto', f: ['*', '*', '*', '*', '*'], text: 'Cada minuto, sin parar.' },
  { id: 'q', label: 'cada 15 min', f: ['*/15', '*', '*', '*', '*'], text: 'Cada 15 minutos (en el minuto 0, 15, 30 y 45).' },
  { id: 'd', label: 'diario 3:30', f: ['30', '3', '*', '*', '*'], text: 'Todos los días a las 03:30.' },
  { id: 'wk', label: 'lun-vie 9:00', f: ['0', '9', '*', '*', '1-5'], text: 'De lunes a viernes a las 09:00.' },
  { id: 'sun', label: 'domingo 4:00', f: ['0', '4', '*', '*', '0'], text: 'Cada domingo a las 04:00.' },
  { id: 'm', label: 'día 1 de mes', f: ['0', '0', '1', '*', '*'], text: 'El día 1 de cada mes, a medianoche.' },
];
const CRON_FIELDS = [
  { n: 'minuto', r: '0-59' },
  { n: 'hora', r: '0-23' },
  { n: 'día mes', r: '1-31' },
  { n: 'mes', r: '1-12' },
  { n: 'día sem', r: '0-7' },
];

export function CronFields() {
  const [id, setId] = useState('d');
  const p = CRON_PRESETS.find((x) => x.id === id)!;
  return (
    <Frame title="Los 5 campos de cron">
      <Chips items={CRON_PRESETS.map((x) => ({ id: x.id, label: x.label }))} value={id} onChange={setId} color={colors.amber} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {CRON_FIELDS.map((f, i) => {
          const val = p.f[i];
          const on = val !== '*';
          return (
            <View key={f.n} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <Animated.View key={id + i} entering={FadeInDown.delay(i * 40).duration(200)} style={{ width: '100%', height: 54, borderRadius: 12, borderWidth: 2, borderColor: on ? colors.mint : colors.line, backgroundColor: on ? colors.mintSoft : colors.card2, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: val.length > 3 ? 13 : 18 }} color={on ? colors.mint : colors.faint}>{val}</T>
              </Animated.View>
              <T v="tiny" bold color={colors.text} style={{ fontSize: 10 }}>{f.n}</T>
              <T v="tiny" color={colors.faint} style={{ fontSize: 9 }}>{f.r}</T>
            </View>
          );
        })}
      </View>
      <MonoBox color={colors.amber}>{`${p.f.join(' ')}  /home/alumno/backup.sh`}</MonoBox>
      <Animated.View key={id} entering={FadeIn.duration(200)}>
        <T v="h3" color={colors.mint}>⏰ {p.text}</T>
      </Animated.View>
      <Caption>* = cualquier valor · */N = cada N · a-b = rango · a,b = lista.</Caption>
    </Frame>
  );
}

// ───────────────────────── usuarios y grupos ─────────────────────────

const USERS = [
  { id: 'alumno', uid: 1000, groups: ['alumno', 'sudo', 'users', 'dev'], shell: '/bin/bash' },
  { id: 'ana', uid: 1001, groups: ['ana', 'users', 'dev'], shell: '/bin/bash' },
  { id: 'bob', uid: 1002, groups: ['bob', 'users'], shell: '/bin/bash' },
];
const GROUPS = ['alumno', 'ana', 'bob', 'sudo', 'users', 'dev'];

export function UsersGroups() {
  const [id, setId] = useState('alumno');
  const u = USERS.find((x) => x.id === id)!;
  const sudo = u.groups.includes('sudo');
  return (
    <Frame title="Usuarios y grupos">
      <Chips items={USERS.map((x) => ({ id: x.id, label: x.id }))} value={id} onChange={setId} color={colors.mint} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GROUPS.map((g) => {
          const on = u.groups.includes(g);
          const primary = u.groups[0] === g;
          return (
            <Animated.View key={g + id} entering={ZoomIn.duration(220)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 2, borderColor: on ? (primary ? colors.amber : colors.cyan) : colors.line, backgroundColor: on ? (primary ? colors.amber : colors.cyan) + '22' : colors.card2, opacity: on ? 1 : 0.4 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={on ? (primary ? colors.amber : colors.cyan) : colors.faint}>{g}</T>
              {on && <T v="tiny" color={colors.dim} style={{ fontSize: 9 }}>{primary ? 'principal' : 'secundario'}</T>}
            </Animated.View>
          );
        })}
      </View>
      <MonoBox color={colors.termText} size={12}>
        {`$ id ${u.id}\nuid=${u.uid}(${u.id}) gid=${u.uid}(${u.id}) groups=${u.groups.map((g) => `${GROUP_IDS[g]}(${g})`).join(',')}\n\n/etc/passwd →\n${u.id}:x:${u.uid}:${u.uid}::/home/${u.id}:${u.shell}`}
      </MonoBox>
      <Caption color={sudo ? colors.green : colors.rose}>{sudo ? '✔ Pertenece a «sudo»: puede administrar el sistema con sudo.' : '✘ No está en «sudo»: no puede usar sudo.'}</Caption>
    </Frame>
  );
}
const GROUP_IDS: Record<string, number> = { alumno: 1000, ana: 1001, bob: 1002, sudo: 27, users: 100, dev: 1005 };

// ───────────────────────── tar ─────────────────────────

const TAR_STEPS = [
  { title: 'Archivos sueltos', cmd: '', size: 120, text: 'Tres archivos en una carpeta: 120 KB en total.' },
  { title: 'tar los empaqueta', cmd: 'tar -cf proyecto.tar proyecto/', size: 120, text: 'tar los junta en UN solo archivo. No comprime: sigue pesando 120 KB.' },
  { title: 'gzip comprime', cmd: 'tar -czf proyecto.tar.gz proyecto/', size: 31, text: 'Con la z, gzip comprime el paquete: 31 KB. Se escribe todo de golpe con -czf.' },
  { title: 'Extraer', cmd: 'tar -xzf proyecto.tar.gz', size: 120, text: 'La x extrae: vuelven los tres archivos exactamente como estaban.' },
];

export function TarBox() {
  const { i, go, auto, setAuto } = useStepper(TAR_STEPS.length, 2800);
  const s = TAR_STEPS[i];
  const files = ['a.txt', 'b.txt', 'logo.png'];
  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(i === 2 ? 0.7 : 1, { damping: 12 }) }] }), [i]);
  return (
    <Frame title="tar y gzip: una caja y una prensa">
      <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
        {i === 0 || i === 3 ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {files.map((f, k) => (
              <Animated.View key={f + i} entering={FadeInDown.delay(k * 90).duration(260)} style={{ alignItems: 'center', gap: 2 }}>
                <T style={{ fontSize: 34 }}>📄</T>
                <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim}>{f}</T>
              </Animated.View>
            ))}
          </View>
        ) : (
          <Animated.View key={i} style={[{ alignItems: 'center', gap: 4 }, boxStyle]}>
            <T style={{ fontSize: 56 }}>{i === 1 ? '📦' : '🗜️'}</T>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={i === 1 ? colors.amber : colors.mint}>{i === 1 ? 'proyecto.tar' : 'proyecto.tar.gz'}</T>
          </Animated.View>
        )}
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T v="tiny" bold color={colors.dim}>{s.title}</T>
          <T v="tiny" bold color={s.size < 50 ? colors.green : colors.amber}>{s.size} KB</T>
        </View>
        <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.card2, overflow: 'hidden' }}>
          <View style={{ width: `${(s.size / 120) * 100}%`, height: 12, borderRadius: 6, backgroundColor: s.size < 50 ? colors.green : colors.amber }} />
        </View>
      </View>
      {s.cmd ? <MonoBox color={colors.mint} size={12}>{`$ ${s.cmd}`}</MonoBox> : null}
      <T v="small" color={colors.text}>{s.text}</T>
      <StepControls i={i} n={TAR_STEPS.length} go={go} auto={auto} setAuto={setAuto} />
    </Frame>
  );
}
