/** Ilustraciones de consultas SQL: orden de ejecución, GROUP BY, tipos de JOIN y operaciones de conjuntos. */
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { StepBar, Tabs, useSteps } from './pyui';
import { Badge, Chip, Explain, Sql, SqlLines, SqlTable, Venn, sqlHue, type Cell } from './sqlui';

// ───────────────────────── orden de ejecución ─────────────────────────

const PRODUCTS: [string, string, number][] = [
  ['Portátil Pro', 'ordenadores', 1299],
  ['Teclado', 'perifericos', 79.9],
  ['Ratón', 'perifericos', 24.5],
  ['Monitor 24"', 'pantallas', 159.99],
  ['Portátil Air', 'ordenadores', 999],
  ['Monitor 27"', 'pantallas', 249],
  ['Auriculares', 'audio', 59],
  ['Monitor 32"', 'pantallas', 399],
  ['Altavoz', 'audio', 29],
];
const CAT_COLOR = () => ({ ordenadores: colors.violet, perifericos: colors.cyan, pantallas: colors.amber, audio: colors.mint }) as Record<string, string>;

const QUERY = ['SELECT categoria, COUNT(*) AS n', 'FROM productos', 'WHERE precio > 30', 'GROUP BY categoria', 'HAVING COUNT(*) > 1', 'ORDER BY n DESC', 'LIMIT 1;'];
/** Fase de ejecución → línea de la consulta. */
const PHASE_LINE = [1, 2, 3, 4, 0, 5, 6];
const LINE_ORDER: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 0: 5, 5: 6, 6: 7 };

const PHASES = [
  { name: 'FROM', count: '9 filas', text: 'Lo primero es saber de dónde salen los datos. Se leen las 9 filas de `productos`. Todavía no se ha filtrado ni calculado nada.' },
  { name: 'WHERE', count: '7 filas', text: 'Se descartan las filas que no cumplen `precio > 30`: caen el ratón (24,5) y el altavoz (29). Quedan 7 filas. El `WHERE` actúa ANTES de agrupar, por eso no puede usar `COUNT(*)` ni alias.' },
  { name: 'GROUP BY', count: '4 grupos', text: 'Las 7 filas supervivientes se reparten en cajas por categoría: 4 grupos. A partir de aquí, cada caja es una unidad.' },
  { name: 'HAVING', count: '2 grupos', text: '`HAVING` filtra GRUPOS, no filas: se van los que tienen una sola fila (periféricos y audio). Quedan 2 grupos.' },
  { name: 'SELECT', count: '2 filas', text: 'Ahora sí: se calculan las columnas del `SELECT` y nace el alias `n`. Una fila por grupo. Por eso el `WHERE` y el `HAVING` no conocían todavía el alias.' },
  { name: 'ORDER BY', count: '2 filas', text: 'Se ordena el resultado por `n` de mayor a menor. Aquí SÍ se puede usar el alias, porque el `SELECT` ya se ejecutó.' },
  { name: 'LIMIT', count: '1 fila', text: 'Lo último: se recorta a la primera fila. La consulta devuelve `pantallas | 3`.' },
];

function Groups({ dim = [] }: { dim?: string[] }) {
  const kept = PRODUCTS.filter((p) => p[2] > 30);
  const order: string[] = [];
  kept.forEach((p) => { if (!order.includes(p[1])) order.push(p[1]); });
  const cc = CAT_COLOR();
  return (
    <View style={{ gap: 8 }}>
      {order.map((cat) => {
        const items = kept.filter((p) => p[1] === cat);
        const off = dim.includes(cat);
        return (
          <Animated.View key={cat} entering={FadeIn.duration(260)} style={{ borderWidth: 2, borderColor: cc[cat], borderRadius: radius.md, padding: 8, gap: 6, backgroundColor: cc[cat] + '14', opacity: off ? 0.3 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={cc[cat]}>{cat}</T>
              <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.dim}>{off ? `COUNT = ${items.length} ✗` : `COUNT = ${items.length}`}</T>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {items.map((p) => <Chip key={p[0]} text={p[0]} color={cc[cat]} />)}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

export function EvalOrder() {
  const st = useSteps(PHASES.length, 2600);
  const ph = PHASES[st.i];
  const c = sqlHue().a;
  const cols = [{ name: 'nombre' }, { name: 'categoria' }, { name: 'precio' }];
  const rows: Cell[][] = PRODUCTS.map((p) => [p[0], p[1], p[2]]);
  let body: React.ReactNode;
  if (st.i <= 1) {
    body = <SqlTable name="productos" cols={cols} rows={rows} color={c} dimRows={st.i === 1 ? [2, 8] : []} hiRows={st.i === 0 ? [] : []} size={11.5} />;
  } else if (st.i <= 3) {
    body = <Groups dim={st.i === 3 ? ['perifericos', 'audio'] : []} />;
  } else {
    const r: Cell[][] = st.i === 4 ? [['ordenadores', 2], ['pantallas', 3]] : [['pantallas', 3], ['ordenadores', 2]];
    body = <SqlTable name="resultado" cols={[{ name: 'categoria' }, { name: 'n' }]} rows={r} color={c} dimRows={st.i === 6 ? [1] : []} hiCols={st.i === 4 ? [1] : []} size={12} />;
  }
  return (
    <Frame>
      <SqlLines lines={QUERY} active={[PHASE_LINE[st.i]]} order={LINE_ORDER} onLine={(l) => st.go(PHASE_LINE.indexOf(l))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Badge text={`${st.i + 1}º · ${ph.name}`} color={c} />
        <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.dim}>→ {ph.count}</T>
      </View>
      <Animated.View key={st.i} entering={FadeIn.duration(240)} style={{ minHeight: 120 }}>{body}</Animated.View>
      <Explain k={st.i} title={ph.name} color={c}>{ph.text.replace(/`/g, '')}</Explain>
      <StepBar i={st.i} n={PHASES.length} go={st.go} auto={st.auto} toggle={st.toggle} color={c} hint />
    </Frame>
  );
}

// ───────────────────────── GROUP BY ─────────────────────────

const GROUP_DATA: [string, string, number][] = [
  ['Teclado', 'perifericos', 79.9],
  ['Ratón', 'perifericos', 24.5],
  ['Monitor 24"', 'pantallas', 159.99],
  ['Monitor 27"', 'pantallas', 249],
  ['Monitor 32"', 'pantallas', 399],
  ['Auriculares', 'audio', 59],
  ['Altavoz', 'audio', 29],
  ['Portátil Air', 'ordenadores', 999],
];
const AGGS = [
  { id: 'count', label: 'COUNT(*)', fn: (v: number[]) => v.length },
  { id: 'sum', label: 'SUM(precio)', fn: (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 },
  { id: 'avg', label: 'AVG(precio)', fn: (v: number[]) => Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 },
  { id: 'max', label: 'MAX(precio)', fn: (v: number[]) => Math.max(...v) },
] as const;
type AggId = (typeof AGGS)[number]['id'];
const GROUP_STEPS = ['Filas sueltas', 'Se reparten en cajas', 'Cada caja → 1 fila'];

export function GroupFlow() {
  const st = useSteps(3, 2600);
  const [agg, setAgg] = useState<AggId>('count');
  const cc = CAT_COLOR();
  const a = AGGS.find((x) => x.id === agg)!;
  const cats = ['perifericos', 'pantallas', 'audio', 'ordenadores'];
  const c = sqlHue().a;
  const result: Cell[][] = cats.map((cat) => [cat, a.fn(GROUP_DATA.filter((p) => p[1] === cat).map((p) => p[2]))]);
  return (
    <Frame>
      <Sql code={`SELECT categoria, ${a.label} AS resultado\nFROM productos\nGROUP BY categoria;`} hi={['GROUP', 'BY']} />
      <Tabs color={c} value={agg} onChange={setAgg} items={AGGS.map((x) => ({ id: x.id, label: x.label }))} />
      <View style={{ minHeight: 250 }}>
        {st.i === 0 ? (
          <Animated.View key="a" entering={FadeIn.duration(240)} style={{ gap: 8 }}>
            <T v="label" color={colors.dim}>8 filas de «productos»</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {GROUP_DATA.map((p) => <Chip key={p[0]} text={`${p[0]} · ${p[2]}`} color={cc[p[1]]} />)}
            </View>
          </Animated.View>
        ) : (
          <Animated.View key={st.i} entering={FadeIn.duration(240)} style={{ gap: 8 }}>
            {cats.map((cat) => {
              const items = GROUP_DATA.filter((p) => p[1] === cat);
              const vals = items.map((p) => p[2]);
              return (
                <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1, borderWidth: 2, borderColor: cc[cat], borderRadius: radius.md, padding: 6, backgroundColor: cc[cat] + '14', gap: 4 }}>
                    <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={cc[cat]}>{cat}</T>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {items.map((p) => <Chip key={p[0]} text={`${p[2]}`} color={cc[cat]} size={11} />)}
                    </View>
                  </View>
                  {st.i === 2 ? (
                    <Animated.View entering={FadeIn.duration(300)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <T style={{ fontSize: 16 }} color={colors.dim}>→</T>
                      <View style={{ minWidth: 76, paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card2, borderWidth: 1, borderColor: cc[cat], alignItems: 'center' }}>
                        <T style={{ fontFamily: fonts.monoBold, fontSize: 15 }} color={colors.text}>{a.fn(vals)}</T>
                      </View>
                    </Animated.View>
                  ) : null}
                </View>
              );
            })}
          </Animated.View>
        )}
      </View>
      {st.i === 2 ? <SqlTable name="resultado" cols={[{ name: 'categoria' }, { name: 'resultado' }]} rows={result} color={c} hiCols={[1]} size={12} /> : null}
      <Explain k={st.i} title={GROUP_STEPS[st.i]} color={c}>
        {st.i === 0 ? 'Al principio las filas están mezcladas, en el orden en que se guardaron. Cada color es una categoría.' : st.i === 1 ? 'GROUP BY reúne las filas que tienen el mismo valor en la columna indicada: una caja por categoría.' : `Cada caja se resume en UNA fila con ${a.label}. Cambia la función arriba y mira cómo cambia el resultado de cada caja: el reparto en cajas no cambia, solo el resumen.`}
      </Explain>
      <StepBar i={st.i} n={3} go={st.go} auto={st.auto} toggle={st.toggle} color={c} hint />
    </Frame>
  );
}

// ───────────────────────── tipos de JOIN ─────────────────────────

type JoinKind = 'inner' | 'left' | 'right' | 'full';
const DEPTS: [number, string][] = [[1, 'Ventas'], [2, 'IT'], [3, 'Legal']];
const EMPS: [string, number | null][] = [['Ana', 1], ['Luis', 2], ['Pedro', 1], ['Eva', null]];

const JOIN_INFO: Record<JoinKind, { sql: string; text: string; a: boolean; ab: boolean; b: boolean }> = {
  inner: { sql: 'INNER JOIN', a: false, ab: true, b: false, text: 'Solo las filas que tienen pareja en las DOS tablas. «Legal» (sin empleados) y «Eva» (sin departamento) desaparecen.' },
  left: { sql: 'LEFT JOIN', a: true, ab: true, b: false, text: 'Todas las filas de la tabla izquierda (departamentos), tengan pareja o no. «Legal» se conserva con NULL en la parte del empleado. «Eva» desaparece.' },
  right: { sql: 'RIGHT JOIN', a: false, ab: true, b: true, text: 'Todas las filas de la tabla derecha (empleados). «Eva» se conserva con NULL en el departamento. «Legal» desaparece.' },
  full: { sql: 'FULL JOIN', a: true, ab: true, b: true, text: 'Todas las filas de las dos tablas. Las que no tienen pareja llevan NULL al otro lado: «Legal» y «Eva» aparecen las dos.' },
};

function joinRows(kind: JoinKind): Cell[][] {
  const out: Cell[][] = [];
  const dName = (id: number | null) => DEPTS.find((d) => d[0] === id)?.[1] ?? null;
  for (const d of DEPTS) {
    const emps = EMPS.filter((e) => e[1] === d[0]);
    if (emps.length) emps.forEach((e) => out.push([d[1], e[0]]));
    else if (kind === 'left' || kind === 'full') out.push([d[1], null]);
  }
  if (kind === 'right' || kind === 'full') EMPS.filter((e) => dName(e[1]) === null).forEach((e) => out.push([null, e[0]]));
  return out;
}

export function JoinTypes() {
  const [kind, setKind] = useState<JoinKind>('inner');
  const info = JOIN_INFO[kind];
  const c = sqlHue().a;
  const rows = joinRows(kind);
  const nullCells: string[] = [];
  rows.forEach((r, ri) => r.forEach((v, ci) => { if (v === null) nullCells.push(`${ri},${ci}`); }));
  const keepD = (id: number) => kind === 'left' || kind === 'full' || EMPS.some((e) => e[1] === id);
  const keepE = (e: [string, number | null]) => kind === 'right' || kind === 'full' || e[1] !== null;
  return (
    <Frame>
      <Tabs color={c} value={kind} onChange={setKind} items={[{ id: 'inner', label: 'INNER' }, { id: 'left', label: 'LEFT' }, { id: 'right', label: 'RIGHT' }, { id: 'full', label: 'FULL' }]} />
      <Venn a={info.a} ab={info.ab} b={info.b} labelA="departamentos" labelB="empleados" colorA={colors.cyan} colorB={colors.amber} />
      <Sql code={`SELECT d.nombre, e.nombre\nFROM departamentos d\n${info.sql} empleados e\n  ON e.departamento_id = d.id;`} hi={[info.sql.split(' ')[0]]} size={12} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <SqlTable name="departamentos" cols={[{ name: 'id', pk: true }, { name: 'nombre' }]} rows={DEPTS.map((d) => [d[0], d[1]])} dimRows={DEPTS.map((d, i) => (keepD(d[0]) ? -1 : i)).filter((i) => i >= 0)} color={colors.cyan} size={11.5} />
        </View>
        <View style={{ flex: 1 }}>
          <SqlTable name="empleados" cols={[{ name: 'nombre' }, { name: 'dep', fk: true }]} rows={EMPS.map((e) => [e[0], e[1]])} dimRows={EMPS.map((e, i) => (keepE(e) ? -1 : i)).filter((i) => i >= 0)} color={colors.amber} size={11.5} />
        </View>
      </View>
      <Animated.View key={kind} entering={FadeIn.duration(240)} style={{ gap: 8 }}>
        <SqlTable name={`resultado · ${rows.length} filas`} cols={[{ name: 'd.nombre' }, { name: 'e.nombre' }]} rows={rows} hiCells={nullCells} color={colors.rose} size={12} />
        <Explain k={kind} title={info.sql} color={c}>{info.text}</Explain>
      </Animated.View>
    </Frame>
  );
}

// ───────────────────────── UNION / INTERSECT / EXCEPT ─────────────────────────

type SetKind = 'unionall' | 'union' | 'intersect' | 'except';
const PY = ['Ana', 'Luis', 'Eva', 'Marta'];
const SQLS = ['Luis', 'Eva', 'Pedro', 'Sofía'];
const SET_INFO: Record<SetKind, { sql: string; a: boolean; ab: boolean; b: boolean; text: string; rows: () => string[] }> = {
  unionall: { sql: 'UNION ALL', a: true, ab: true, b: true, text: 'Junta todas las filas de las dos consultas, SIN quitar repetidos: Luis y Eva salen dos veces. Es la más rápida.', rows: () => [...PY, ...SQLS] },
  union: { sql: 'UNION', a: true, ab: true, b: true, text: 'Junta las filas de las dos consultas y elimina los repetidos: cada persona sale una sola vez.', rows: () => [...PY, ...SQLS.filter((x) => !PY.includes(x))] },
  intersect: { sql: 'INTERSECT', a: false, ab: true, b: false, text: 'Solo las filas que están en LAS DOS consultas: quienes hacen Python y SQL a la vez.', rows: () => PY.filter((x) => SQLS.includes(x)) },
  except: { sql: 'EXCEPT', a: true, ab: false, b: false, text: 'Las filas de la primera consulta que NO están en la segunda: quienes hacen Python pero no SQL. El orden importa: A EXCEPT B no es igual que B EXCEPT A.', rows: () => PY.filter((x) => !SQLS.includes(x)) },
};

export function SetOps() {
  const [kind, setKind] = useState<SetKind>('unionall');
  const info = SET_INFO[kind];
  const c = sqlHue().a;
  const rows = info.rows();
  return (
    <Frame>
      <Tabs color={c} value={kind} onChange={setKind} items={[{ id: 'unionall', label: 'UNION ALL' }, { id: 'union', label: 'UNION' }, { id: 'intersect', label: 'INTERSECT' }, { id: 'except', label: 'EXCEPT' }]} />
      <Venn a={info.a} ab={info.ab} b={info.b} labelA="curso_python" labelB="curso_sql" colorA={colors.cyan} colorB={colors.amber} />
      <Sql code={`SELECT nombre FROM curso_python\n${info.sql}\nSELECT nombre FROM curso_sql;`} hi={[info.sql.split(' ')[0]]} size={12} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <SqlTable name="curso_python" cols={[{ name: 'nombre' }]} rows={PY.map((x) => [x])} color={colors.cyan} size={11.5} hiRows={PY.map((x, i) => (SQLS.includes(x) ? i : -1)).filter((i) => i >= 0)} />
        </View>
        <View style={{ flex: 1 }}>
          <SqlTable name="curso_sql" cols={[{ name: 'nombre' }]} rows={SQLS.map((x) => [x])} color={colors.amber} size={11.5} hiRows={SQLS.map((x, i) => (PY.includes(x) ? i : -1)).filter((i) => i >= 0)} />
        </View>
      </View>
      <Animated.View key={kind} entering={FadeIn.duration(240)} style={{ gap: 8 }}>
        <T v="label" color={colors.dim}>RESULTADO · {rows.length} {rows.length === 1 ? 'fila' : 'filas'}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 30 }}>
          {rows.map((x, i) => <Chip key={`${x}${i}`} text={x} color={PY.includes(x) && SQLS.includes(x) ? colors.mint : PY.includes(x) ? colors.cyan : colors.amber} strong />)}
        </View>
        <Explain k={kind} title={info.sql} color={c}>{info.text}</Explain>
      </Animated.View>
    </Frame>
  );
}
