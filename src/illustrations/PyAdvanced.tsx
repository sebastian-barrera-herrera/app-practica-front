import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Btn, CodeLines, Console, Slider, StepBar, Tabs, Tag, dk, pyHue, useSteps } from './pyui';
import { Walk, type Panel, type WalkStep } from './pyviz';

const row = { flexDirection: 'row' as const, alignItems: 'center' as const };

function Note({ children, color, min = 58 }: { children: React.ReactNode; color: string; min?: number }) {
  return (
    <View style={{ borderLeftWidth: 4, borderLeftColor: color, paddingLeft: 12, minHeight: min, justifyContent: 'center' }}>
      <T v="small" color={colors.text}>{children}</T>
    </View>
  );
}

// ───────────────────────── clase e instancias ─────────────────────────

const PERRO_CODE = ['class Perro:', '    def __init__(self, nombre, edad):', '        self.nombre = nombre', '        self.edad = edad', '', '    def cumplir(self):', '        self.edad += 1'];

function Obj({ name, nombre, edad, hot }: { name: string; nombre: string; edad: number; hot: boolean }) {
  const c = hot ? colors.amber : colors.mint;
  return (
    <Animated.View entering={ZoomIn.duration(260)} style={{ flex: 1, minWidth: 130, borderRadius: radius.lg, borderWidth: 2, borderColor: c, backgroundColor: c + '18', padding: 10, gap: 4 }}>
      <View style={[row, { justifyContent: 'space-between' }]}>
        <Tag text={name} color={colors.violet} solid />
        <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim}>Perro</T>
      </View>
      <T style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 }} color={colors.text}>{`nombre = "${nombre}"`}</T>
      <T key={edad} style={{ fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 19 }} color={hot ? colors.amber : colors.text}>{`edad = ${edad}`}</T>
    </Animated.View>
  );
}

export function ClassInstance() {
  const hue = pyHue();
  const [rex, setRex] = useState<number | null>(null);
  const [luna, setLuna] = useState<number | null>(null);
  const [hot, setHot] = useState<string>('');
  const [log, setLog] = useState<{ t: string }[]>([]);
  const add = (t: string) => setLog((l) => [...l.slice(-3), { t }]);
  return (
    <Frame>
      <View style={{ opacity: 1 }}>
        <T v="tiny" bold color={colors.dim} style={{ fontFamily: fonts.monoBold, marginBottom: 4 }}>LA CLASE (el plano)</T>
        <CodeLines lines={PERRO_CODE} size={12} color={hue.b} marks={{}} />
      </View>
      <T v="tiny" bold color={colors.dim} style={{ fontFamily: fonts.monoBold }}>LAS INSTANCIAS (piezas hechas con el plano)</T>
      <View style={{ flexDirection: 'row', gap: 10, minHeight: 92 }}>
        {rex === null && luna === null ? <T v="small" color={colors.faint}>Aún no hay ninguna instancia. Crea alguna con los botones.</T> : null}
        {rex !== null ? <Obj name="rex" nombre="Rex" edad={rex} hot={hot === 'rex'} /> : null}
        {luna !== null ? <Obj name="luna" nombre="Luna" edad={luna} hot={hot === 'luna'} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Btn label='rex = Perro("Rex", 3)' onPress={() => { setRex(3); setHot('rex'); add('rex = Perro("Rex", 3)'); }} />
        <Btn label='luna = Perro("Luna", 5)' onPress={() => { setLuna(5); setHot('luna'); add('luna = Perro("Luna", 5)'); }} />
        <Btn label="rex.cumplir()" disabled={rex === null} onPress={() => { setRex((v) => (v ?? 0) + 1); setHot('rex'); add('rex.cumplir()'); }} />
        <Btn label="luna.cumplir()" disabled={luna === null} onPress={() => { setLuna((v) => (v ?? 0) + 1); setHot('luna'); add('luna.cumplir()'); }} />
        <Btn label="Reiniciar" onPress={() => { setRex(null); setLuna(null); setHot(''); setLog([]); }} />
      </View>
      <Console lines={log.map((l) => ({ t: '>>> ' + l.t }))} minLines={3} size={12} />
      <Note color={hue.b} min={44}>Los datos son de cada objeto (rex.edad ≠ luna.edad); los métodos viven una sola vez en la clase y reciben el objeto como «self».</Note>
    </Frame>
  );
}

// ───────────────────────── MRO ─────────────────────────

const MRO = [
  { id: 'D', note: 'Empieza por D: su quien() devuelve "D" + super().quien(). super() = la SIGUIENTE clase del MRO, que es B.' },
  { id: 'B', note: 'B: "B" + super().quien(). Ojo: la siguiente del MRO es C (no A): A debe ir después de todas sus hijas.' },
  { id: 'C', note: 'C: "C" + super().quien(). Ahora sí, la siguiente es A.' },
  { id: 'A', note: 'A: devuelve "A" sin llamar a super(). Cada clase se ejecutó una sola vez.' },
  { id: '=', note: 'Las llamadas se deshacen en orden inverso y el resultado es "D" + "B" + "C" + "A" = "DBCA".' },
];
const BOX: Record<string, { x: string; y: number }> = { A: { x: '38%', y: 0 }, B: { x: '4%', y: 74 }, C: { x: '72%', y: 74 }, D: { x: '38%', y: 148 } };

export function Mro() {
  const hue = pyHue();
  const st = useSteps(MRO.length, 2600);
  const cur = MRO[st.i];
  const order = MRO.filter((m) => m.id !== '=').map((m) => m.id);
  const done = st.i >= 4 ? 4 : st.i;
  return (
    <Frame>
      <CodeLines lines={['class A: ...', 'class B(A): ...', 'class C(A): ...', 'class D(B, C): ...', 'D().quien()   # ¿en qué orden se busca?']} active={4} color={hue.b} size={12} />
      <View style={{ height: 192 }}>
        {(['A', 'B', 'C', 'D'] as const).map((id) => {
          const idx = order.indexOf(id);
          const on = cur.id === id;
          const seen = idx < done;
          const c = on ? colors.amber : seen ? colors.mint : colors.cyan;
          return (
            <View key={id} style={{ position: 'absolute', left: BOX[id].x as `${number}%`, top: BOX[id].y, width: 76, height: 52, borderRadius: 14, borderWidth: on ? 3 : 1.5, borderColor: c, backgroundColor: c + (on ? '33' : '14'), alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 20, lineHeight: 26 }} color={c}>{id}</T>
              {seen || on ? <T style={{ fontFamily: fonts.mono, fontSize: 10, lineHeight: 12 }} color={colors.dim}>{`nº ${idx + 1}`}</T> : null}
            </View>
          );
        })}
        <T style={{ position: 'absolute', left: '24%', top: 52, fontFamily: fonts.mono, fontSize: 18 }} color={colors.faint}>↗</T>
        <T style={{ position: 'absolute', left: '66%', top: 52, fontFamily: fonts.mono, fontSize: 18 }} color={colors.faint}>↖</T>
        <T style={{ position: 'absolute', left: '24%', top: 126, fontFamily: fonts.mono, fontSize: 18 }} color={colors.faint}>↖</T>
        <T style={{ position: 'absolute', left: '66%', top: 126, fontFamily: fonts.mono, fontSize: 18 }} color={colors.faint}>↗</T>
      </View>
      <View style={[row, { gap: 6, flexWrap: 'wrap' }]}>
        <T v="tiny" bold color={colors.dim} style={{ fontFamily: fonts.monoBold }}>D.__mro__ =</T>
        {[...order, 'object'].map((id, i) => <Tag key={id} text={id} color={i < done || (i === done && cur.id === id) ? colors.amber : colors.faint} solid={cur.id === id} />)}
      </View>
      <Note color={hue.b}>{cur.note}</Note>
      <StepBar i={st.i} n={MRO.length} go={st.go} auto={st.auto} toggle={st.toggle} color={hue.b} hint />
    </Frame>
  );
}

// ───────────────────────── protocolo de iteración ─────────────────────────

const IT_LINES = ['lista = ["a", "b", "c"]', 'it = iter(lista)', 'next(it)', 'next(it)', 'next(it)', 'next(it)'];
const cells = (p: number): WalkStep['panels'] => [{ k: 'cells', title: 'lista (el iterador recuerda por dónde va)', cells: ['a', 'b', 'c'].map((t, i) => ({ text: t, hot: i === p, dim: i < p })), pointer: p }];
const IT_STEPS: WalkStep[] = [
  { at: 0, note: 'Una lista es ITERABLE: sabe entregar un iterador, pero no es un iterador.', panels: cells(-1) },
  { at: 1, note: 'iter(lista) crea un iterador: un objeto aparte que recuerda su posición (aún antes del primer elemento).', panels: cells(-1) },
  { at: 2, note: 'next(it) avanza una posición y entrega "a".', panels: cells(0), out: [{ t: "'a'" }] },
  { at: 3, note: 'Otro next: entrega "b".', panels: cells(1), out: [{ t: "'a'" }, { t: "'b'" }] },
  { at: 4, note: 'Y "c". Ya no quedan elementos.', panels: cells(2), out: [{ t: "'a'" }, { t: "'b'" }, { t: "'c'" }] },
  { at: 5, note: 'Pedir otro lanza StopIteration. El bucle for captura esa señal para saber que debe terminar. El iterador queda agotado.', marks: { 5: '#FF6B81' }, panels: cells(3), out: [{ t: "'a'" }, { t: "'b'" }, { t: "'c'" }, { t: 'StopIteration', c: '#FF9AA5' }] },
];

export function IteratorProtocol() {
  return <Walk lines={IT_LINES} steps={IT_STEPS} consoleLines={4} size={13} />;
}

// ───────────────────────── generador ─────────────────────────

const GEN_LINES = ['def cuenta(n):', '    while n > 0:', '        yield n', '        n -= 1', '', 'g = cuenta(2)', 'print(next(g))', 'print(next(g))', 'print(next(g))'];
const vn = (n: number | null, hot = true): Panel[] => [
  { k: 'vars', title: 'estado del generador', items: n === null ? [] : [{ name: 'n', value: String(n), hot }] },
];
const GEN_STEPS: WalkStep[] = [
  { at: 5, note: 'Llamar a cuenta(2) NO ejecuta nada del cuerpo: solo crea un generador, listo para empezar.', panels: [...vn(null), { k: 'text', text: 'generador creado · sin empezar', color: colors.cyan }] },
  { at: [6, 1, 2], note: 'next(g) lo pone en marcha. Llega a «yield n», ENTREGA el 2 y se PAUSA ahí, conservando sus variables.', panels: [...vn(2), { k: 'text', text: '⏸ pausado en el yield (línea 3)', color: colors.amber }], out: [{ t: '2' }] },
  { at: [7, 3, 1, 2], note: 'El siguiente next reanuda JUSTO DESPUÉS del yield: n -= 1 → 1, el while sigue, y vuelve a pausarse entregando el 1.', panels: [...vn(1), { k: 'text', text: '⏸ pausado otra vez', color: colors.amber }], out: [{ t: '2' }, { t: '1' }] },
  { at: [8, 3, 1], note: 'Tercer next: n pasa a 0, el while ya no se cumple y la función termina → StopIteration (no quedan valores).', marks: { 8: '#FF6B81' }, panels: [...vn(0, false), { k: 'text', text: '■ terminado', color: colors.rose }], out: [{ t: '2' }, { t: '1' }, { t: 'StopIteration', c: '#FF9AA5' }] },
];

export function GeneratorPause() {
  return <Walk lines={GEN_LINES} steps={GEN_STEPS} consoleLines={3} size={12} />;
}

// ───────────────────────── decorador ─────────────────────────

const DEC_LINES = ['def registrar(f):', '    def envoltorio(*a):', '        print("antes")', '        r = f(*a)', '        print("después")', '        return r', '    return envoltorio', '', '@registrar', 'def saludar(n):', '    return f"Hola {n}"', '', 'print(saludar("Ana"))'];
const M = { name: '<módulo>' };
const DEC_STEPS: WalkStep[] = [
  { at: [8, 9, 10], note: '@registrar equivale a «saludar = registrar(saludar)»: el nombre «saludar» pasa a apuntar al ENVOLTORIO, que guarda la función original en f.', panels: [{ k: 'text', text: 'saludar → envoltorio  (f = saludar original, escondida dentro)', color: colors.violet }] },
  { at: 12, note: 'Al llamar a saludar("Ana") en realidad se llama al envoltorio.', panels: [{ k: 'stack', frames: [M, { name: 'envoltorio', info: 'a=("Ana",)', hot: true }] }] },
  { at: 2, note: 'El envoltorio actúa ANTES…', panels: [{ k: 'stack', frames: [M, { name: 'envoltorio', info: 'a=("Ana",)', hot: true }] }], out: [{ t: 'antes' }] },
  { at: 3, note: '…llama a la función original f(*a)…', panels: [{ k: 'stack', frames: [M, { name: 'envoltorio' }, { name: 'saludar (original)', info: 'n="Ana"', hot: true }] }], out: [{ t: 'antes' }] },
  { at: 10, note: '…que devuelve "Hola Ana" al envoltorio.', panels: [{ k: 'stack', frames: [M, { name: 'envoltorio', info: 'r="Hola Ana"', hot: true }] }], out: [{ t: 'antes' }] },
  { at: 4, note: 'El envoltorio actúa DESPUÉS…', panels: [{ k: 'stack', frames: [M, { name: 'envoltorio', info: 'r="Hola Ana"', hot: true }] }], out: [{ t: 'antes' }, { t: 'después' }] },
  { at: 5, note: '…y devuelve el resultado: quien llamó no notó nada, pero ahora hay comportamiento añadido (registro, tiempo, caché…).', panels: [{ k: 'stack', frames: [M] }], out: [{ t: 'antes' }, { t: 'después' }, { t: 'Hola Ana' }] },
];

export function DecoratorWrap() {
  return <Walk lines={DEC_LINES} steps={DEC_STEPS} consoleLines={3} size={11} />;
}

// ───────────────────────── bucle de eventos ─────────────────────────

const TASKS = [
  { name: 'descargar("a")', dur: 1.0, color: '#22D3A6' },
  { name: 'descargar("b")', dur: 2.0, color: '#38BDF8' },
  { name: 'descargar("c")', dur: 1.5, color: '#FFD43B' },
];

export function EventLoop() {
  const hue = pyHue();
  const [mode, setMode] = useState<'seq' | 'conc'>('conc');
  const [t10, setT10] = useState(0);
  const t = t10 / 10;
  const starts = mode === 'seq' ? [0, 1.0, 3.0] : [0, 0, 0];
  const total = mode === 'seq' ? 4.5 : 2.0;
  const SCALE = 4.5;
  const running = TASKS.map((k, i) => t >= starts[i] && t < starts[i] + k.dur);
  const done = t >= total;
  return (
    <Frame>
      <Tabs items={[{ id: 'seq', label: 'await uno tras otro' }, { id: 'conc', label: 'asyncio.gather (a la vez)' }]} value={mode} onChange={(m) => { setMode(m); setT10(0); }} color={hue.b} />
      <CodeLines lines={mode === 'seq' ? ['a = await descargar("a")', 'b = await descargar("b")', 'c = await descargar("c")'] : ['a, b, c = await asyncio.gather(', '    descargar("a"),', '    descargar("b"),', '    descargar("c"))']} size={12} color={hue.b} active={mode === 'seq' ? running.findIndex(Boolean) : running.some(Boolean) ? [0, 1, 2, 3] : -1} />
      <View style={{ gap: 8 }}>
        {TASKS.map((k, i) => {
          const p = Math.max(0, Math.min(1, (t - starts[i]) / k.dur));
          return (
            <View key={k.name} style={{ gap: 3 }}>
              <T style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 14 }} color={running[i] ? k.color : colors.dim}>{`${k.name}  ${k.dur} s${running[i] ? '  ⏳ esperando…' : p >= 1 ? '  ✔' : ''}`}</T>
              <View style={{ height: 18, borderRadius: 9, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
                <View style={{ position: 'absolute', left: `${(starts[i] / SCALE) * 100}%`, width: `${(k.dur / SCALE) * 100}%`, top: 0, bottom: 0, backgroundColor: k.color + '33' }} />
                <View style={{ position: 'absolute', left: `${(starts[i] / SCALE) * 100}%`, width: `${((k.dur * p) / SCALE) * 100}%`, top: 0, bottom: 0, backgroundColor: k.color }} />
                <View style={{ position: 'absolute', left: `${(t / SCALE) * 100}%`, width: 2, top: 0, bottom: 0, backgroundColor: colors.text }} />
              </View>
            </View>
          );
        })}
      </View>
      <Slider min={0} max={45} value={t10} onChange={setT10} label="Tiempo" color={hue.b} format={(v) => (v / 10).toFixed(1)} />
      <Note color={done ? colors.mint : hue.b} min={44}>{done ? `Todo terminó a los ${total.toFixed(1)} s. ${mode === 'seq' ? 'Es la SUMA de las esperas (1 + 2 + 1.5).' : 'Es lo que tarda la más lenta: las esperas se solapan.'}` : mode === 'seq' ? 'Cada await bloquea a la corrutina hasta terminar; no empieza la siguiente. Arrastra el tiempo.' : 'Mientras una tarea espera (await), el bucle de eventos deja avanzar a las otras. Arrastra el tiempo.'}</Note>
    </Frame>
  );
}

// ───────────────────────── árbol de recursión ─────────────────────────

interface Node { n: number; depth: number; kind: 'calc' | 'repeat' | 'cache' }

function buildTree(n: number, memo: boolean): { nodes: Node[]; calls: number } {
  const nodes: Node[] = [];
  const seen = new Set<number>();
  let calls = 0;
  const visit = (k: number, depth: number) => {
    if (memo && seen.has(k)) {
      nodes.push({ n: k, depth, kind: 'cache' });
      return;
    }
    nodes.push({ n: k, depth, kind: seen.has(k) ? 'repeat' : 'calc' });
    calls += 1;
    seen.add(k);
    if (k >= 2) {
      visit(k - 1, depth + 1);
      visit(k - 2, depth + 1);
    }
  };
  visit(n, 0);
  return { nodes, calls };
}

export function RecursionTree() {
  const hue = pyHue();
  const [n, setN] = useState(5);
  const [memo, setMemo] = useState<'no' | 'si'>('no');
  const { nodes, calls } = useMemo(() => buildTree(n, memo === 'si'), [n, memo]);
  return (
    <Frame>
      <Tabs items={[{ id: 'no', label: 'sin caché' }, { id: 'si', label: 'con caché (@cache)' }]} value={memo} onChange={setMemo} color={hue.b} />
      <Slider min={1} max={6} value={n} onChange={setN} label="n" color={hue.b} />
      <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, paddingVertical: 8, paddingHorizontal: 10 }}>
        {nodes.map((x, i) => {
          const c = x.kind === 'calc' ? dk.mint : x.kind === 'repeat' ? dk.rose : dk.faint;
          return (
            <View key={i} style={{ flexDirection: 'row', marginLeft: x.depth * 14, alignItems: 'center', gap: 6, minHeight: 20 }}>
              <T style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 }} color={dk.faint}>{x.depth ? '└' : ' '}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12, lineHeight: 17 }} color={c}>{`fib(${x.n})`}</T>
              <T style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 15 }} color={c}>{x.kind === 'repeat' ? '← repetido' : x.kind === 'cache' ? '← ya en caché' : ''}</T>
            </View>
          );
        })}
      </View>
      <View style={[row, { gap: 10 }]}>
        <Tag text={`${calls} llamadas`} color={memo === 'si' ? colors.mint : colors.rose} solid />
        <T v="small" color={colors.dim}>{`fib(${n}) = ${fib(n)}`}</T>
      </View>
      <Note color={hue.b} min={44}>{memo === 'no' ? 'En rojo, trabajo repetido: fib(3), fib(2)… se recalculan una y otra vez. Sube «n» y verás cómo se dispara.' : 'La caché recuerda cada resultado: cada fib(k) se calcula UNA sola vez (en gris, lo que se reutiliza). El trabajo pasa de exponencial a lineal.'}</Note>
    </Frame>
  );
}

function fib(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

// ───────────────────────── Big-O ─────────────────────────

const CURVES = [
  { id: 'O(1)', f: () => 1, color: '#22D3A6', ex: 'dict[clave]' },
  { id: 'O(log n)', f: (n: number) => Math.max(1, Math.log2(n)), color: '#38BDF8', ex: 'búsqueda binaria' },
  { id: 'O(n)', f: (n: number) => n, color: '#FFD43B', ex: 'recorrer una lista' },
  { id: 'O(n log n)', f: (n: number) => Math.max(1, n * Math.log2(n)), color: '#FB923C', ex: 'sorted(lista)' },
  { id: 'O(n²)', f: (n: number) => n * n, color: '#F472B6', ex: 'dos bucles anidados' },
  { id: 'O(2ⁿ)', f: (n: number) => 2 ** n, color: '#FF6B81', ex: 'fib recursivo' },
];

function fmt(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} mil millones`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)} mil`;
  return String(Math.round(v * 10) / 10);
}

export function BigO() {
  const hue = pyHue();
  const [n, setN] = useState(10);
  const vals = CURVES.map((c) => c.f(n));
  const top = Math.log10(Math.max(...vals) + 1);
  return (
    <Frame>
      <Slider min={1} max={30} value={n} onChange={setN} label="Tamaño de la entrada n" color={hue.b} />
      <View style={{ gap: 8 }}>
        {CURVES.map((c, i) => {
          const w = Math.max(0.03, Math.log10(vals[i] + 1) / Math.max(0.3, top));
          return (
            <View key={c.id} style={{ gap: 3 }}>
              <View style={[row, { justifyContent: 'space-between' }]}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 12, lineHeight: 16 }} color={c.color}>{c.id}</T>
                <T style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 15 }} color={colors.dim}>{`${c.ex} · ${fmt(vals[i])} pasos`}</T>
              </View>
              <View style={{ height: 14, borderRadius: 7, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
                <Animated.View key={`${c.id}${Math.round(w * 40)}`} entering={FadeIn.duration(120)} style={{ width: `${w * 100}%`, height: 14, backgroundColor: c.color }} />
              </View>
            </View>
          );
        })}
      </View>
      <T v="tiny" color={colors.dim}>Las barras están en escala logarítmica (cada tramo es ×10 pasos); si no, las más pequeñas serían invisibles.</T>
      <Note color={hue.b} min={44}>{n >= 20 ? `Con n = ${n}: O(n) son ${n} pasos, O(n²) ${fmt(n * n)} y O(2ⁿ) ${fmt(2 ** n)}. Por eso elegir el algoritmo importa más que optimizar detalles.` : 'Sube «n»: las curvas se separan. O(1) y O(log n) casi no crecen; O(n²) y O(2ⁿ) se disparan.'}</Note>
    </Frame>
  );
}
