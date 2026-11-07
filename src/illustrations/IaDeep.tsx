/** Ilustraciones de la zona 9 del curso de IA: formas de tensores, autograd, bucle de entrenamiento, convolución, memoria de las RNN y sobreajuste. */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import {
  IMG_L, KERNELS, SHAPE_OPS, agApply, agInit, applyShapeOp, bestEpoch, convolve2d, earlyStop, loopSim, maxPool, memoryOfFirst, outSize, overfitCurves, rnnTrace, cellTrace, shapeStr,
  type AgAction, type LoopBug, type Reg, type Shape, type ShapeOp,
} from './iaDlLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs, Toggle } from './iaui';

const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, alignSelf: 'flex-start', opacity: disabled ? 0.4 : 1 }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

// ───────────────────────── formas de tensores ─────────────────────────

const PRESETS: { id: string; label: string; shape: Shape; note: string }[] = [
  { id: 'img', label: 'Imagen RGB', shape: [3, 32, 32], note: '(canales, alto, ancho)' },
  { id: 'lote', label: 'Lote de imágenes', shape: [8, 3, 32, 32], note: '(lote, canales, alto, ancho)' },
  { id: 'texto', label: 'Lote de texto', shape: [4, 10, 16], note: '(lote, palabras, características)' },
];

export function TensorShapesDemo() {
  const [preset, setPreset] = useState('lote');
  const base = PRESETS.find((p) => p.id === preset)!;
  const [hist, setHist] = useState<{ op: ShapeOp; shape: Shape }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const cur = hist.length ? hist[hist.length - 1].shape : base.shape;
  const apply = (op: ShapeOp) => {
    const r = applyShapeOp(cur, op);
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setHist([...hist, { op, shape: r.shape }]);
  };
  const reset = (id: string) => {
    setPreset(id);
    setHist([]);
    setErr(null);
  };
  const dims = (s: Shape): React.ReactNode => (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {s.length === 0 ? <Pill text="escalar (0-D)" color={colors.dim} /> : s.map((d, i) => <Pill key={i} text={String(d)} color={[colors.cyan, colors.amber, colors.rose, colors.green, colors.violet][i % 5]} solid />)}
    </View>
  );
  return (
    <Frame>
      <Tabs items={PRESETS.map((p) => ({ id: p.id, label: p.label }))} value={preset} onChange={reset} color={colors.violet} />
      <T v="tiny" color={colors.dim}>Forma inicial {base.note}</T>
      {dims(cur)}
      <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.text}>{shapeStr(cur)}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(SHAPE_OPS) as ShapeOp[]).map((op) => (
          <Pressable key={op} accessibilityRole="button" accessibilityLabel={SHAPE_OPS[op].label} onPress={() => { tap(); apply(op); }} style={{ minHeight: 40, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.cyan, justifyContent: 'center' }}>
            <T v="tiny" bold color={colors.cyan} style={{ fontFamily: fonts.monoBold }}>{SHAPE_OPS[op].label}</T>
          </Pressable>
        ))}
      </View>
      {hist.length > 0 ? (
        <View style={{ gap: 3 }}>
          {hist.slice(-5).map((h, i) => <T key={i} v="tiny" color={colors.dim} style={{ fontFamily: fonts.mono }}>{SHAPE_OPS[h.op].code} → [{h.shape.join(', ')}]</T>)}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn label="↺ Reiniciar" color={colors.violet} onPress={() => reset(preset)} />
        <Btn label="↶ Deshacer" color={colors.amber} onPress={() => { setHist(hist.slice(0, -1)); setErr(null); }} disabled={!hist.length} />
      </View>
      {err ? <Explain k={err} title="Error de PyTorch" color={colors.rose}>{err}</Explain> : <Callout color={colors.green}>Cada operación devuelve un tensor nuevo con otra <T v="small" bold>forma</T>. Casi todos los errores de PyTorch son formas que no encajan: aprende a seguirlas.</Callout>}
    </Frame>
  );
}

// ───────────────────────── autograd: .grad se acumula ─────────────────────────

export function AutogradLab() {
  const [s, setS] = useState(() => agInit(0));
  const do_ = (a: AgAction) => setS((p) => agApply(p, a));
  const acc = s.log.some((l) => l.includes('SUMADO'));
  return (
    <Frame>
      <T style={{ fontFamily: fonts.mono, fontSize: 12.5 }} color={colors.dim}>w = torch.tensor(…, requires_grad=True){'\n'}loss = (3*w - 6) ** 2   # el óptimo es w = 2</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`w = ${s.w.toFixed(3)}`} color={colors.cyan} solid />
        <Pill text={`loss = ${s.loss === null ? '—' : s.loss.toFixed(2)}`} color={colors.violet} solid />
        <Pill text={`w.grad = ${s.grad === null ? 'None' : s.grad.toFixed(2)}`} color={acc ? colors.rose : colors.amber} solid />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Btn label="loss = …" color={colors.violet} onPress={() => do_('forward')} />
        <Btn label="loss.backward()" color={colors.amber} onPress={() => do_('backward')} />
        <Btn label="w.grad.zero_()" color={colors.cyan} onPress={() => do_('zero_grad')} />
        <Btn label="w -= 0.05·w.grad" color={colors.green} onPress={() => do_('step')} />
      </View>
      <Btn label="↺ Reiniciar" color={colors.faint} onPress={() => setS(agInit(0))} />
      <View style={{ gap: 3 }}>
        {s.log.length ? s.log.map((l, i) => <T key={i} v="tiny" color={i === 0 ? colors.text : colors.dim} style={{ fontFamily: fonts.mono }}>{i === 0 ? '▶ ' : '  '}{l}</T>) : <T v="tiny" color={colors.dim}>Pulsa los botones en orden: loss → backward → step. Luego repite backward sin poner a cero.</T>}
      </View>
      <Explain k={`${acc}-${s.grad}`} title={acc ? '⚠️ Gradientes acumulados' : 'Así funciona .grad'} color={acc ? colors.rose : colors.green}>
        {acc ? <>Llamar a <T v="small" bold>backward()</T> varias veces <T v="small" bold>suma</T> los gradientes en <T v="small" bold>.grad</T> en lugar de reemplazarlos. Por eso cada iteración de entrenamiento empieza con <T v="small" bold>optimizer.zero_grad()</T>.</> : <>PyTorch construye el grafo al calcular <T v="small" bold>loss</T>; <T v="small" bold>backward()</T> lo recorre hacia atrás y deja la derivada en <T v="small" bold>w.grad</T>. Con ella, <T v="small" bold>w −= lr·grad</T> acerca w al óptimo (2).</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── el bucle de entrenamiento y sus fallos ─────────────────────────

const BUGS: { id: LoopBug; label: string; col: string; note: string }[] = [
  { id: 'ninguno', label: 'Bucle correcto', col: colors.green, note: 'zero_grad → forward → loss → backward → step: la pérdida baja de forma suave.' },
  { id: 'sin_zero_grad', label: 'Sin zero_grad()', col: colors.rose, note: 'Los gradientes se acumulan: cada paso es cada vez más grande y la pérdida rebota o explota.' },
  { id: 'sin_step', label: 'Sin step()', col: colors.amber, note: 'Se calculan gradientes pero nadie actualiza los pesos: la pérdida no se mueve.' },
  { id: 'sin_backward', label: 'Sin backward()', col: colors.cyan, note: 'Sin gradientes, step() no tiene nada que aplicar: la pérdida tampoco se mueve.' },
];

export function TrainLoopDemo() {
  const [bug, setBug] = useState<LoopBug>('sin_zero_grad');
  const [lr, setLr] = useState(0.1);
  const ok = useMemo(() => loopSim('ninguno', 30, lr), [lr]);
  const bad = useMemo(() => loopSim(bug, 30, lr), [bug, lr]);
  const W = 280;
  const H = 130;
  const top = Math.max(ok[0], 0.5);
  const X = (i: number): number => 8 + (i / 29) * (W - 16);
  const Y = (v: number): number => H - 10 - Math.min(1, v / top) * (H - 22);
  const line = (v: number[]) => v.map((q, i) => `${X(i).toFixed(1)},${Y(q).toFixed(1)}`).join(' ');
  const info = BUGS.find((b) => b.id === bug)!;
  const last = bad[bad.length - 1];
  return (
    <Frame>
      <Tabs items={BUGS.slice(1).map((b) => ({ id: b.id, label: b.label }))} value={bug} onChange={setBug} color={colors.rose} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill="none" stroke={colors.line} />
        <Polyline points={line(ok)} stroke={colors.green} strokeWidth={3} fill="none" />
        <Polyline points={line(bad)} stroke={info.col} strokeWidth={3} fill="none" strokeDasharray="6,4" />
        <SvgText x={10} y={14} fontSize={10} fill={colors.green} fontFamily={fonts.mono}>— correcto</SvgText>
        <SvgText x={100} y={14} fontSize={10} fill={info.col} fontFamily={fonts.mono}>- - {info.label}</SvgText>
        <SvgText x={W - 70} y={H - 3} fontSize={9} fill={colors.dim} fontFamily={fonts.mono}>iteraciones →</SvgText>
      </Svg>
      <Stepper label="Tasa de aprendizaje" value={lr} min={0.05} max={0.4} step={0.05} onChange={(n) => setLr(Math.round(n * 100) / 100)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`pérdida final correcta ${ok[29].toFixed(4)}`} color={colors.green} />
        <Pill text={`con el fallo ${last > 1e6 ? 'explota 💥' : last.toFixed(4)}`} color={info.col} solid />
      </View>
      <Explain k={`${bug}-${lr}`} title={info.label} color={info.col}>{info.note}</Explain>
    </Frame>
  );
}

// ───────────────────────── convolución ─────────────────────────

const CELL = 26;

export function ConvDemo() {
  const [kid, setKid] = useState<keyof typeof KERNELS>('vertical');
  const [pad, setPad] = useState(0);
  const [stride, setStride] = useState(1);
  const [pos, setPos] = useState(0);
  const [pool, setPool] = useState(false);
  const k = KERNELS[kid];
  const out = useMemo(() => convolve2d(IMG_L, k.k, stride, pad), [k, stride, pad]);
  const shown = pool ? maxPool(out) : out;
  const ow = out[0].length;
  const total = out.length * ow;
  const p = Math.min(pos, total - 1);
  const pr = Math.floor(p / ow);
  const pc = p % ow;
  const maxAbs = Math.max(1, ...out.flat().map((v) => Math.abs(v)));
  const cellColor = (v: number): string => (v > 0 ? colors.green : v < 0 ? colors.rose : colors.faint);
  const n = IMG_L.length;
  return (
    <Frame>
      <Tabs items={(Object.keys(KERNELS) as (keyof typeof KERNELS)[]).map((id) => ({ id, label: KERNELS[id].label }))} value={kid} onChange={(v) => { setKid(v); setPos(0); }} color={colors.cyan} />
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <View>
          <T v="tiny" color={colors.dim}>Imagen 7×7{pad ? ` (+${pad} de relleno)` : ''}</T>
          <Svg width={n * CELL + 2 * pad * CELL} height={n * CELL + 2 * pad * CELL}>
            {Array.from({ length: n + 2 * pad }, (_, r) => Array.from({ length: n + 2 * pad }, (_, c) => {
              const ir = r - pad;
              const ic = c - pad;
              const v = ir < 0 || ic < 0 || ir >= n || ic >= n ? 0 : IMG_L[ir][ic];
              return <Rect key={`${r}-${c}`} x={c * CELL} y={r * CELL} width={CELL - 1} height={CELL - 1} fill={v ? colors.text : colors.card} stroke={colors.line} opacity={ir < 0 || ic < 0 || ir >= n || ic >= n ? 0.35 : 1} />;
            }))}
            <Rect x={pc * stride * CELL} y={pr * stride * CELL} width={3 * CELL - 1} height={3 * CELL - 1} fill="none" stroke={colors.amber} strokeWidth={3} />
          </Svg>
        </View>
        <View>
          <T v="tiny" color={colors.dim}>Mapa de características {shown.length}×{shown[0].length}{pool ? ' (tras max-pool)' : ''}</T>
          <Svg width={shown[0].length * CELL} height={shown.length * CELL}>
            {shown.map((row, r) => row.map((v, c) => (
              <React.Fragment key={`${r}-${c}`}>
                <Rect x={c * CELL} y={r * CELL} width={CELL - 1} height={CELL - 1} fill={cellColor(v)} opacity={v === 0 ? 0.12 : 0.25 + 0.75 * Math.min(1, Math.abs(v) / maxAbs)} stroke={!pool && r === pr && c === pc ? colors.amber : colors.line} strokeWidth={!pool && r === pr && c === pc ? 3 : 1} />
                <SvgText x={c * CELL + 4} y={r * CELL + 17} fontSize={9} fill={colors.text} fontFamily={fonts.mono}>{Math.abs(v) < 0.05 ? '0' : v.toFixed(Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0)}</SvgText>
              </React.Fragment>
            )))}
          </Svg>
        </View>
      </View>
      <T v="tiny" color={colors.dim}>Filtro {kid}: {k.k.map((r) => r.map((v) => (Math.abs(v) < 1 && v !== 0 ? '1/9' : v)).join(' ')).join('  |  ')}</T>
      <Stepper label="Posición de la ventana" value={p} min={0} max={total - 1} onChange={setPos} />
      <Stepper label="Relleno (padding)" value={pad} min={0} max={2} onChange={(v) => { setPad(v); setPos(0); }} />
      <Stepper label="Paso (stride)" value={stride} min={1} max={2} onChange={(v) => { setStride(v); setPos(0); }} />
      <Toggle label="Max-pool 2×2 después" on={pool} set={setPool} hint="Se queda con el mayor valor de cada bloque: reduce a la mitad" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`(${n} + 2·${pad} − 3) / ${stride} + 1 = ${outSize(n, 3, pad, stride)}`} color={colors.violet} solid />
      </View>
      <Callout color={colors.cyan}>{k.note} <T v="small" bold>El mismo filtro de 9 pesos se aplica en todas las posiciones</T>: por eso una CNN necesita muchos menos parámetros que una red densa y reconoce un patrón esté donde esté.</Callout>
    </Frame>
  );
}

// ───────────────────────── memoria: RNN frente a celda con puerta ─────────────────────────

export function RnnMemoryDemo() {
  const [len, setLen] = useState(10);
  const [w, setW] = useState(0.5);
  const [f, setF] = useState(0.9);
  const x = useMemo(() => Array.from({ length: len }, (_, i) => (i === 0 ? 1 : 0)), [len]);
  const rnn = useMemo(() => rnnTrace(x, w), [x, w]);
  const cell = useMemo(() => cellTrace(x, f), [x, f]);
  const mr = memoryOfFirst(len, 'rnn', w);
  const mc = memoryOfFirst(len, 'cell', f);
  const Wd = 280;
  const Hh = 110;
  const X = (i: number): number => 10 + (i / Math.max(1, len - 1)) * (Wd - 20);
  const Y = (v: number): number => Hh - 8 - Math.max(0, Math.min(1, v)) * (Hh - 16);
  const line = (v: number[]) => v.map((q, i) => `${X(i).toFixed(1)},${Y(q).toFixed(1)}`).join(' ');
  return (
    <Frame>
      <T v="small" color={colors.dim}>Entrada: un «1» en el primer paso y ceros después. ¿Cuánto queda de ese 1 al final?</T>
      <Svg width="100%" height={Hh} viewBox={`0 0 ${Wd} ${Hh}`}>
        <Rect x={0} y={0} width={Wd} height={Hh} fill="none" stroke={colors.line} />
        <Polyline points={line(rnn)} stroke={colors.rose} strokeWidth={3} fill="none" />
        <Polyline points={line(cell)} stroke={colors.green} strokeWidth={3} fill="none" />
        {x.map((_, i) => <Circle key={i} cx={X(i)} cy={Hh - 4} r={2} fill={colors.dim} />)}
        <SvgText x={10} y={14} fontSize={10} fill={colors.rose} fontFamily={fonts.mono}>— RNN simple (tanh)</SvgText>
        <SvgText x={130} y={14} fontSize={10} fill={colors.green} fontFamily={fonts.mono}>— celda con puerta</SvgText>
      </Svg>
      <Stepper label="Longitud de la secuencia" value={len} min={3} max={30} step={1} onChange={setLen} />
      <Stepper label="Peso recurrente w de la RNN" value={w} min={0.1} max={1.5} step={0.1} onChange={(n) => setW(Math.round(n * 10) / 10)} />
      <Stepper label="Puerta de olvido f de la celda" value={f} min={0.5} max={1} step={0.05} onChange={(n) => setF(Math.round(n * 100) / 100)} />
      <Meter label="Memoria del primer dato · RNN" value={Math.min(1, mr)} color={colors.rose} suffix={`${(mr * 100).toFixed(1)} %`} />
      <Meter label="Memoria del primer dato · celda con puerta" value={Math.min(1, mc)} color={colors.green} suffix={`${(mc * 100).toFixed(1)} %`} />
      <Explain k={`${len}-${w}-${f}`} title={mr < 0.05 && mc > 0.3 ? 'La puerta conserva, la RNN olvida' : mr < 0.05 ? 'Ambas olvidan' : 'Hay memoria'} color={mc > mr ? colors.green : colors.amber}>
        En una RNN simple el estado se multiplica por <T v="small" bold>w</T> y pasa por <T v="small" bold>tanh</T> en cada paso: con w &lt; 1 lo antiguo se desvanece de forma exponencial (el gradiente también). La <T v="small" bold>LSTM</T> mantiene una ruta casi lineal, la <T v="small" bold>celda</T>, y una <T v="small" bold>puerta de olvido</T> f decide cuánto conservar: con f ≈ 1 recuerda a largo plazo.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── sobreajuste y regularización ─────────────────────────

export function OverfitDemo() {
  const [cap, setCap] = useState<1 | 2 | 3>(3);
  const [dropout, setDropout] = useState(false);
  const [decay, setDecay] = useState(false);
  const [paciencia, setPaciencia] = useState(5);
  const reg: Reg = { capacidad: cap, dropout, decay };
  const { train, val } = useMemo(() => overfitCurves(reg), [cap, dropout, decay]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = bestEpoch(val);
  const stop = earlyStop(val, paciencia);
  const W = 280;
  const H = 150;
  const X = (i: number): number => 10 + (i / 59) * (W - 20);
  const Y = (v: number): number => H - 10 - Math.min(1, v / 2.4) * (H - 24);
  const line = (v: number[]) => v.map((q, i) => `${X(i).toFixed(1)},${Y(q).toFixed(1)}`).join(' ');
  const gap = val[59] - train[59];
  const over = val[59] - val[best] > 0.15;
  return (
    <Frame>
      <Tabs items={[{ id: '1' as const, label: 'Modelo pequeño' }, { id: '2' as const, label: 'Mediano' }, { id: '3' as const, label: 'Muy grande' }]} value={String(cap) as '1' | '2' | '3'} onChange={(v) => setCap(Number(v) as 1 | 2 | 3)} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill="none" stroke={colors.line} />
        <Polyline points={line(train)} stroke={colors.cyan} strokeWidth={3} fill="none" />
        <Polyline points={line(val)} stroke={colors.rose} strokeWidth={3} fill="none" />
        <Line x1={X(best)} x2={X(best)} y1={6} y2={H - 6} stroke={colors.green} strokeWidth={2} strokeDasharray="4,3" />
        <Line x1={X(stop)} x2={X(stop)} y1={6} y2={H - 6} stroke={colors.amber} strokeWidth={2} strokeDasharray="2,3" />
        <SvgText x={10} y={14} fontSize={10} fill={colors.cyan} fontFamily={fonts.mono}>— entrenamiento</SvgText>
        <SvgText x={105} y={14} fontSize={10} fill={colors.rose} fontFamily={fonts.mono}>— validación</SvgText>
        <SvgText x={X(best) + 3} y={H - 12} fontSize={9} fill={colors.green} fontFamily={fonts.mono}>mejor</SvgText>
        <SvgText x={Math.min(W - 52, X(stop) + 3)} y={H - 26} fontSize={9} fill={colors.amber} fontFamily={fonts.mono}>parada</SvgText>
      </Svg>
      <Toggle label="Dropout" on={dropout} set={setDropout} hint="Apaga neuronas al azar al entrenar" />
      <Toggle label="Decaimiento de pesos (L2)" on={decay} set={setDecay} hint="Penaliza los pesos grandes" />
      <Stepper label="Paciencia de la parada temprana" value={paciencia} min={1} max={15} onChange={setPaciencia} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`mejor época ${best + 1}`} color={colors.green} solid />
        <Pill text={`para en la ${stop + 1}`} color={colors.amber} solid />
        <Pill text={`brecha final ${gap.toFixed(2)}`} color={over ? colors.rose : colors.green} />
      </View>
      <Explain k={`${cap}-${dropout}-${decay}-${over}`} title={over ? '⚠️ Sobreajuste' : cap === 1 ? 'Infraajuste leve' : '✅ Bien generalizado'} color={over ? colors.rose : colors.green}>
        {over ? <>La pérdida de entrenamiento sigue bajando pero la de validación <T v="small" bold>sube</T>: la red memoriza. Opciones: más datos, <T v="small" bold>dropout</T>, <T v="small" bold>decaimiento de pesos</T>, un modelo menor o <T v="small" bold>parar en la mejor época</T> (línea verde).</> : <>Las dos curvas bajan juntas y la brecha es pequeña. La parada temprana guarda los pesos de la <T v="small" bold>mejor época</T> de validación, no de la última.</>}
      </Explain>
    </Frame>
  );
}
