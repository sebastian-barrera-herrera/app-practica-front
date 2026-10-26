/** Ilustraciones de SQL avanzado: funciones de ventana, índices y transacciones. */
import React, { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Btn, Slider, StepBar, Tabs, useSteps } from './pyui';
import { Badge, Explain, Note, Sql, SqlLines, SqlTable, sqlHue, type Cell } from './sqlui';

// ───────────────────────── funciones de ventana ─────────────────────────

const WROWS: [string, number, number][] = [
  ['A', 1, 10],
  ['A', 2, 20],
  ['A', 3, 30],
  ['B', 4, 5],
  ['B', 5, 15],
  ['B', 6, 25],
  ['B', 7, 35],
];
type WMode = 'part' | 'order' | 'frame';

function windowOf(mode: WMode, cur: number, pre: number, fol: number): number[] {
  const idx = WROWS.map((_, i) => i);
  if (mode === 'part') return idx.filter((i) => WROWS[i][0] === WROWS[cur][0]);
  if (mode === 'order') return idx.filter((i) => i <= cur);
  return idx.filter((i) => i >= cur - pre && i <= cur + fol);
}
const round1 = (v: number) => Math.round(v * 10) / 10;

export function WindowFrame() {
  const st = useSteps(WROWS.length, 1700, true);
  const [mode, setMode] = useState<WMode>('part');
  const [pre, setPre] = useState(1);
  const [fol, setFol] = useState(1);
  const c = sqlHue().a;
  const cur = st.i;
  const value = (i: number): number => {
    const w = windowOf(mode, i, pre, fol);
    const sum = w.reduce((a, k) => a + WROWS[k][2], 0);
    return mode === 'frame' ? round1(sum / w.length) : sum;
  };
  const win = windowOf(mode, cur, pre, fol);
  const rows: Cell[][] = WROWS.map((r, i) => [r[0], r[1], r[2], value(i)]);
  const edge = (n: number, word: string) => (n === 0 ? 'CURRENT ROW' : `${n} ${word}`);
  const code =
    mode === 'part'
      ? 'SUM(importe) OVER (PARTITION BY cat)'
      : mode === 'order'
        ? 'SUM(importe) OVER (ORDER BY dia)'
        : `AVG(importe) OVER (ORDER BY dia\n  ROWS BETWEEN ${edge(pre, 'PRECEDING')}\n           AND ${edge(fol, 'FOLLOWING')})`;
  const vals = win.map((k) => WROWS[k][2]);
  const text =
    mode === 'part'
      ? `PARTITION BY divide las filas en grupos: la fila ${cur + 1} (grupo ${WROWS[cur][0]}) solo «ve» las filas de su grupo. Suma ${vals.join(' + ')} = ${value(cur)} y repite ese valor en cada fila de su grupo.`
      : mode === 'order'
        ? `Con ORDER BY, la ventana crece fila a fila: cada fila ve desde la primera hasta ella misma. Suma ${vals.join(' + ')} = ${value(cur)}. Es un acumulado.`
        : `El marco ROWS BETWEEN fija cuántas filas ve cada fila: ${pre} antes y ${fol} después. Media de ${vals.join(', ')} = ${value(cur)}. Es una media móvil.`;
  return (
    <Frame>
      <Tabs color={c} value={mode} onChange={setMode} items={[{ id: 'part', label: 'Partición' }, { id: 'order', label: 'Orden' }, { id: 'frame', label: 'Marco' }]} />
      <Sql code={`SELECT cat, dia, importe,\n  ${code}\n  AS res\nFROM ventas;`} hi={['OVER', 'PARTITION', 'ROWS']} size={11.5} />
      <SqlTable
        name="ventas"
        cols={[{ name: 'cat' }, { name: 'dia' }, { name: 'importe' }, { name: 'res' }]}
        rows={rows}
        hiRows={win}
        dimRows={WROWS.map((_, i) => (win.includes(i) ? -1 : i)).filter((i) => i >= 0)}
        hiCells={[`${cur},3`]}
        rowTags={{ [cur]: '▶' }}
        onRow={(r) => st.go(r)}
        color={c}
        size={11.5}
        colW={36}
      />
      {mode === 'frame' ? (
        <View style={{ gap: 6 }}>
          <T v="tiny" bold color={colors.dim}>Filas ANTES: {pre}</T>
          <Slider min={0} max={3} value={pre} onChange={setPre} color={c} label="Filas antes" />
          <T v="tiny" bold color={colors.dim}>Filas DESPUÉS: {fol}</T>
          <Slider min={0} max={3} value={fol} onChange={setFol} color={c} label="Filas después" />
        </View>
      ) : null}
      <Explain k={`${mode}${cur}${pre}${fol}`} title={`Fila ${cur + 1} · resultado ${value(cur)}`} color={c}>{text}</Explain>
      <StepBar i={cur} n={WROWS.length} go={st.go} auto={st.auto} toggle={st.toggle} color={c} label={`Fila actual: ${cur + 1} de ${WROWS.length}`} hint />
    </Frame>
  );
}

// ───────────────────────── índice (árbol B) ─────────────────────────

const N_ROWS = 64;
/** hoja 0..7 de 8 filas cada una; nodos intermedios cubren 3, 3 y 2 hojas; la raíz separa en 25 y 49. */
const MID: { keys: string; leaves: number[]; range: string }[] = [
  { keys: '9 · 17', leaves: [0, 1, 2], range: '1–24' },
  { keys: '33 · 41', leaves: [3, 4, 5], range: '25–48' },
  { keys: '57', leaves: [6, 7], range: '49–64' },
];
const midOf = (t: number) => (t < 25 ? 0 : t < 49 ? 1 : 2);
const leafOf = (t: number) => Math.floor((t - 1) / 8);

export function IndexTree() {
  const [target, setTarget] = useState(37);
  const [tick, setTick] = useState(-1);
  const [w, setW] = useState(320);
  const running = tick >= 0;
  const scan = running ? Math.min(tick, target) : 0;
  const path = running ? Math.min(Math.floor(tick / 10), 4) : 0;
  const done = running && scan >= target && path >= 4;
  const active = running && !done;
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 45);
    return () => clearInterval(id);
  }, [active]);
  const c = sqlHue().a;
  const cols = 16;
  const cell = Math.max(12, Math.floor((w - 48) / cols));
  const m = midOf(target);
  const l = leafOf(target);
  const start = () => setTick(0);
  return (
    <Frame>
      <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T v="label" color={colors.amber}>SIN ÍNDICE</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.amber}>{scan} filas leídas</T>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 6, borderRadius: radius.md, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line }}>
          {Array.from({ length: N_ROWS }).map((_, i) => {
            const n = i + 1;
            const visited = running && n <= scan;
            const found = running && n === target && scan >= target;
            return (
              <View key={n} style={{ width: cell, height: cell, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: found ? colors.mint : visited ? colors.amber + '88' : colors.line + '88', borderWidth: n === target ? 2 : 0, borderColor: colors.mint }}>
                {cell >= 18 ? <T style={{ fontFamily: fonts.mono, fontSize: 9 }} color={found ? '#04120D' : colors.dim}>{n}</T> : null}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T v="label" color={colors.mint}>CON ÍNDICE (árbol B)</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.mint}>{path} lecturas</T>
        </View>
        <View style={{ gap: 6, padding: 8, borderRadius: radius.md, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line }}>
          <View style={{ alignItems: 'center' }}>
            <Node text="25 · 49" sub="raíz" on={running && path >= 1} color={colors.mint} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {MID.map((md, i) => <Node key={i} text={md.keys} sub={md.range} on={running && path >= 2 && i === m} color={colors.mint} />)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 2 }}>
            {Array.from({ length: 8 }).map((_, k) => (
              <View key={k} style={{ flex: 1 }}>
                <Node text={`${k * 8 + 1}`} sub={`–${k * 8 + 8}`} on={running && path >= 3 && k === l} color={colors.mint} small />
              </View>
            ))}
          </View>
          <T v="tiny" color={colors.dim} center>{running && path >= 4 ? `Fila ${target} encontrada dentro de la hoja ✔` : running ? 'Bajando por el árbol…' : 'Pulsa «Buscar» para recorrer el índice'}</T>
        </View>
      </View>
      <T v="tiny" bold color={colors.dim}>Fila a buscar: {target}</T>
      <Slider min={1} max={N_ROWS} value={target} onChange={(v) => { setTarget(v); setTick(-1); }} color={c} label="Fila a buscar" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn label={running && !done ? 'Buscando…' : done ? '↺ Repetir' : '🔍 Buscar'} onPress={start} disabled={running && !done} solid color={c} grow />
      </View>
      <Explain k={done ? 'd' : 'n'} title={done ? `${scan} lecturas frente a ${path}` : 'Cómo funciona'} color={c}>
        {done
          ? `Sin índice hubo que mirar ${scan} filas, una por una. Con el índice bastaron ${path}: raíz, nodo intermedio, hoja y la fila. Con 1.000.000 de filas, el escaneo leería hasta 1.000.000 y el índice unas 20.`
          : 'El índice guarda los valores ORDENADOS en un árbol. En cada nivel se descarta la mayor parte de las filas, como cuando buscas una palabra en un diccionario. Sin índice, solo queda leer la tabla fila a fila.'}
      </Explain>
    </Frame>
  );
}

function Node({ text, sub, on, color, small }: { text: string; sub: string; on: boolean; color: string; small?: boolean }) {
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: small ? 2 : 10, paddingVertical: 3, borderRadius: 8, borderWidth: 2, borderColor: on ? color : colors.line, backgroundColor: on ? color + '44' : 'transparent' }}>
      <T numberOfLines={1} style={{ fontFamily: fonts.monoBold, fontSize: small ? 9.5 : 12 }} color={on ? colors.text : colors.dim}>{text}</T>
      <T numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: small ? 8.5 : 9.5 }} color={colors.faint}>{sub}</T>
    </View>
  );
}

// ───────────────────────── transacciones ─────────────────────────

type TxOutcome = null | 'commit' | 'rollback' | 'crash';

function Account({ name, value, provisional, flash }: { name: string; value: number; provisional: boolean; flash: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4, padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: provisional ? colors.amber : colors.line, backgroundColor: provisional ? colors.amber + '18' : colors.card2 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.dim}>{name}</T>
      <Animated.View key={`${value}${provisional}`} entering={flash ? ZoomIn.duration(260) : undefined}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 24, lineHeight: 30 }} color={colors.text}>{value}</T>
      </Animated.View>
      <T v="tiny" color={provisional ? colors.amber : colors.mint}>{provisional ? 'provisional' : 'definitivo'}</T>
    </View>
  );
}

function AllOrNothing() {
  const [stage, setStage] = useState(0);
  const [out, setOut] = useState<TxOutcome>(null);
  const c = sqlHue().a;
  const open = stage >= 1 && out === null;
  const ana = out === 'commit' || (open && stage >= 2) ? 900 : 1000;
  const beto = out === 'commit' || (open && stage >= 3) ? 350 : 250;
  const lines = ['BEGIN;', 'UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;', 'UPDATE cuentas SET saldo = saldo + 100 WHERE id = 2;', out === 'rollback' ? 'ROLLBACK;' : out === 'crash' ? '-- 💥 el servidor se cae' : 'COMMIT;'];
  const active = out ? [3] : stage > 0 ? [stage - 1] : [];
  const msg: Record<string, string> = {
    '0': 'Dos cuentas con 1.250 € en total. Vamos a mover 100 € de Ana a Beto en dos pasos.',
    '1': 'BEGIN abre la transacción. A partir de aquí, los cambios son provisionales.',
    '2': 'Ana ya tiene 900… pero solo dentro de la transacción. Los demás siguen viendo 1.000. Ahora el dinero «no está» en ninguna parte: si algo falla aquí, es un desastre.',
    '3': 'Beto recibe 100. Falta decidir: COMMIT lo hace definitivo y ROLLBACK lo deshace todo.',
    commit: 'COMMIT: los dos cambios se vuelven definitivos a la vez. El total sigue siendo 1.250.',
    rollback: 'ROLLBACK: todo vuelve a como estaba al empezar. Como si nada hubiera pasado.',
    crash: 'El servidor se cayó en mitad de la transacción. Al reiniciar, la base de datos descarta lo que no se confirmó: Ana conserva sus 1.000. Esto es la atomicidad.',
  };
  const key = out ?? String(stage);
  return (
    <View style={{ gap: 12 }}>
      <SqlLines lines={lines} active={active} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Account name="Ana" value={ana} provisional={open && stage >= 2} flash={stage >= 2 || !!out} />
        <Account name="Beto" value={beto} provisional={open && stage >= 3} flash={stage >= 3 || !!out} />
      </View>
      <T v="tiny" color={colors.dim} center>Lo que ven los demás ahora: Ana {out === 'commit' ? 900 : 1000} · Beto {out === 'commit' ? 350 : 250}</T>
      <Explain k={key} title={out ? { commit: 'Confirmado ✔', rollback: 'Deshecho ↩', crash: 'Fallo del servidor 💥' }[out] : stage === 0 ? 'Antes de empezar' : `Paso ${stage}`} color={out === 'crash' || out === 'rollback' ? colors.rose : out === 'commit' ? colors.mint : c}>{msg[key]}</Explain>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {out ? (
          <Btn label="↺ Empezar de nuevo" onPress={() => { setOut(null); setStage(0); }} solid color={c} />
        ) : stage < 3 ? (
          <>
            <Btn label={stage === 0 ? '▶ BEGIN' : '▶ Siguiente sentencia'} onPress={() => setStage(stage + 1)} solid color={c} />
            <Btn label="💥 Fallo del servidor" onPress={() => setOut('crash')} disabled={stage === 0} color={colors.rose} />
          </>
        ) : (
          <>
            <Btn label="COMMIT ✔" onPress={() => setOut('commit')} solid color={colors.mint} />
            <Btn label="ROLLBACK ↩" onPress={() => setOut('rollback')} color={colors.rose} />
            <Btn label="💥 Fallo" onPress={() => setOut('crash')} color={colors.rose} />
          </>
        )}
      </View>
    </View>
  );
}

interface TxEvent {
  lane: 'A' | 'B';
  text: string;
  sub: string;
  db: number;
  lock: 'A' | 'B' | null;
  tone: 'ok' | 'bad' | 'wait';
  explain: string;
}

const NO_PROTECTION: TxEvent[] = [
  { lane: 'A', text: 'SELECT saldo', sub: '→ 1000', db: 1000, lock: null, tone: 'ok', explain: 'El usuario A lee el saldo: 1.000. Quiere cobrar 100.' },
  { lane: 'B', text: 'SELECT saldo', sub: '→ 1000', db: 1000, lock: null, tone: 'ok', explain: 'El usuario B también lee el saldo antes de que A termine: ve 1.000. Quiere cobrar 200.' },
  { lane: 'A', text: 'UPDATE saldo = 900', sub: '(1000 − 100)', db: 900, lock: null, tone: 'ok', explain: 'A escribe 900 (lo que calculó con lo que leyó).' },
  { lane: 'B', text: 'UPDATE saldo = 800', sub: '(1000 − 200)', db: 800, lock: null, tone: 'bad', explain: 'B escribe 800, calculado con el 1.000 que leyó al principio. ¡Pisa el cambio de A sin saberlo!' },
  { lane: 'B', text: 'saldo final = 800', sub: 'debían ser 700', db: 800, lock: null, tone: 'bad', explain: 'Actualización perdida: el cobro de 100 de A desapareció. Faltan 100 € que nadie sabe dónde están.' },
];
const WITH_LOCK: TxEvent[] = [
  { lane: 'A', text: 'SELECT … FOR UPDATE', sub: '→ 1000 · 🔒', db: 1000, lock: 'A', tone: 'ok', explain: 'A lee el saldo y BLOQUEA la fila hasta terminar su transacción.' },
  { lane: 'B', text: 'SELECT … FOR UPDATE', sub: '⏳ espera…', db: 1000, lock: 'A', tone: 'wait', explain: 'B intenta lo mismo, pero la fila está bloqueada por A: B se queda esperando. No lee un valor que va a quedar desfasado.' },
  { lane: 'A', text: 'UPDATE saldo − 100', sub: 'COMMIT → 900', db: 900, lock: null, tone: 'ok', explain: 'A escribe 900 y confirma. Al terminar, libera el bloqueo.' },
  { lane: 'B', text: 'SELECT … FOR UPDATE', sub: '→ 900 · 🔒', db: 900, lock: 'B', tone: 'ok', explain: 'Ahora B puede continuar, y lee el valor ACTUAL: 900.' },
  { lane: 'B', text: 'UPDATE saldo − 200', sub: 'COMMIT → 700', db: 700, lock: null, tone: 'ok', explain: 'B calcula con el dato correcto: 900 − 200 = 700. Los dos cobros están aplicados. ✔' },
];

function TwoUsers() {
  const [prot, setProt] = useState<'sin' | 'con'>('sin');
  const evs = prot === 'sin' ? NO_PROTECTION : WITH_LOCK;
  const st = useSteps(evs.length, 2600);
  const c = sqlHue().a;
  const e = evs[st.i];
  const toneColor = { ok: colors.mint, bad: colors.rose, wait: colors.amber };
  return (
    <View style={{ gap: 12 }}>
      <Tabs color={c} value={prot} onChange={(v) => { setProt(v); st.reset(); }} items={[{ id: 'sin', label: 'Sin protección' }, { id: 'con', label: 'Con FOR UPDATE' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['A', 'B'] as const).map((lane) => (
          <View key={lane} style={{ flex: 1, gap: 6 }}>
            <Badge text={`Usuario ${lane}`} color={lane === 'A' ? colors.cyan : colors.violet} />
            {evs.map((ev, i) =>
              ev.lane === lane ? (
                i <= st.i ? (
                  <Animated.View key={`${prot}${i}`} entering={FadeIn.duration(260)} style={{ padding: 6, borderRadius: radius.md, borderWidth: 2, borderColor: toneColor[ev.tone], backgroundColor: toneColor[ev.tone] + (i === st.i ? '33' : '14'), minHeight: 46 }}>
                    <T style={{ fontFamily: fonts.monoBold, fontSize: 10.5 }} color={colors.text}>{ev.text}</T>
                    <T style={{ fontFamily: fonts.mono, fontSize: 10.5 }} color={toneColor[ev.tone]}>{ev.sub}</T>
                  </Animated.View>
                ) : (
                  <View key={`${prot}${i}`} style={{ minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, opacity: 0.4 }} />
                )
              ) : null,
            )}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 8, borderRadius: radius.md, backgroundColor: colors.card2, borderWidth: 1, borderColor: e.tone === 'bad' ? colors.rose : colors.line }}>
        <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.dim}>saldo en la base de datos</T>
        <Animated.View key={`${prot}${e.db}${st.i}`} entering={ZoomIn.duration(240)}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 22, lineHeight: 28 }} color={e.tone === 'bad' && st.i === evs.length - 1 ? colors.rose : colors.text}>{e.db}</T>
        </Animated.View>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.amber}>{e.lock ? `🔒 bloqueada por ${e.lock}` : ''}</T>
      </View>
      <Explain k={`${prot}${st.i}`} title={`Paso ${st.i + 1} · usuario ${e.lane}`} color={toneColor[e.tone]}>{e.explain}</Explain>
      <StepBar i={st.i} n={evs.length} go={st.go} auto={st.auto} toggle={st.toggle} color={c} hint />
    </View>
  );
}

type TxTab = 'todo' | 'dos';
export function Transaction() {
  const [tab, setTab] = useState<TxTab>('todo');
  const c = sqlHue().a;
  return (
    <Frame>
      <Tabs color={c} value={tab} onChange={setTab} items={[{ id: 'todo', label: 'Todo o nada' }, { id: 'dos', label: 'Dos usuarios' }]} />
      {tab === 'todo' ? <AllOrNothing /> : <TwoUsers />}
      <Note min={24}>{tab === 'todo' ? 'Prueba los tres finales: confirmar, deshacer o que se caiga el servidor.' : 'Cambia entre «Sin protección» y «Con FOR UPDATE» y compara el saldo final.'}</Note>
    </Frame>
  );
}
