import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { CodeLines, LabelBoard, Slider, StepBar, Tabs, Tag, dk, pyHue, useSteps, type BoardLabel, type BoardObj } from './pyui';
import { Walk, type WalkStep } from './pyviz';

const row = { flexDirection: 'row' as const, alignItems: 'center' as const };

function Note({ children, color, min = 58 }: { children: React.ReactNode; color: string; min?: number }) {
  return (
    <View style={{ borderLeftWidth: 4, borderLeftColor: color, paddingLeft: 12, minHeight: min, justifyContent: 'center' }}>
      <T v="small" color={colors.text}>{children}</T>
    </View>
  );
}

// ───────────────────────── variables = etiquetas ─────────────────────────

interface BoardStep {
  at: number | number[];
  note: string;
  objs: BoardObj[];
  labels: BoardLabel[];
}

function BoardWalk({ lines, steps, rows }: { lines: string[]; steps: BoardStep[]; rows: number }) {
  const hue = pyHue();
  const st = useSteps(steps.length, 2800);
  const s = steps[st.i];
  return (
    <Frame>
      <CodeLines lines={lines} active={s.at} color={hue.b} size={13} />
      <LabelBoard rows={rows} objs={s.objs} labels={s.labels} />
      <Note color={hue.b}>{s.note}</Note>
      <StepBar i={st.i} n={steps.length} go={st.go} auto={st.auto} toggle={st.toggle} color={hue.b} hint />
    </Frame>
  );
}

export function VariablesLabels() {
  const hue = pyHue();
  const o = (id: string, row: number, text: string, show = true): BoardObj => ({ id, row, show, kind: 'int', ref: id, text, color: hue.a });
  const lines = ['edad = 30', 'otra = edad', 'edad = 31'];
  const steps: BoardStep[] = [
    { at: -1, note: 'Una variable NO es una caja con un valor dentro: es una etiqueta que apunta a un objeto. Pulsa ▶ para verlo.', objs: [o('#1', 0, '30', false)], labels: [{ name: 'edad', color: hue.b, at: null }] },
    { at: 0, note: 'Python crea el objeto 30 y cuelga la etiqueta «edad» apuntando a él.', objs: [o('#1', 0, '30')], labels: [{ name: 'edad', color: hue.b, at: { row: 0, slot: 'c' } }] },
    { at: 1, note: '«otra = edad» no copia nada: añade una segunda etiqueta al MISMO objeto.', objs: [o('#1', 0, '30')], labels: [{ name: 'edad', color: hue.b, at: { row: 0, slot: 'u' } }, { name: 'otra', color: colors.mint, at: { row: 0, slot: 'd' } }] },
    { at: 2, note: 'Reasignar mueve la etiqueta «edad» a un objeto nuevo (31). El 30 no cambia: «otra» sigue apuntando a él.', objs: [o('#1', 0, '30'), o('#2', 1, '31')], labels: [{ name: 'edad', color: hue.b, at: { row: 1, slot: 'c' } }, { name: 'otra', color: colors.mint, at: { row: 0, slot: 'c' } }] },
  ];
  return <BoardWalk lines={lines} steps={steps} rows={2} />;
}

export function Mutability() {
  const hue = pyHue();
  const lst = (id: string, row: number, items: string[], fresh?: number): BoardObj => ({ id, row, show: true, kind: 'list', ref: id, items, fresh, color: hue.a });
  const lines = ['a = [1, 2]', 'b = a', 'b.append(3)', 'c = a.copy()', 'c.append(4)'];
  const A: BoardLabel = { name: 'a', color: hue.b, at: { row: 0, slot: 'c' } };
  const hidden = (name: string, color: string): BoardLabel => ({ name, color, at: null });
  const steps: BoardStep[] = [
    { at: -1, note: 'Las listas son mutables: se pueden modificar SIN crear un objeto nuevo. Y eso importa cuando hay varias etiquetas.', objs: [{ ...lst('#1', 0, ['1', '2']), show: false }], labels: [hidden('a', hue.b), hidden('b', colors.mint), hidden('c', colors.rose)] },
    { at: 0, note: 'Se crea una lista y «a» apunta a ella.', objs: [lst('#1', 0, ['1', '2'])], labels: [A, hidden('b', colors.mint), hidden('c', colors.rose)] },
    { at: 1, note: '«b = a» no copia la lista: «b» es otra etiqueta para el mismo objeto.', objs: [lst('#1', 0, ['1', '2'])], labels: [{ ...A, at: { row: 0, slot: 'u' } }, { name: 'b', color: colors.mint, at: { row: 0, slot: 'd' } }, hidden('c', colors.rose)] },
    { at: 2, note: '¡Al añadir por «b», también cambia lo que ve «a»! Es un único objeto con dos nombres.', objs: [lst('#1', 0, ['1', '2', '3'], 2)], labels: [{ ...A, at: { row: 0, slot: 'u' } }, { name: 'b', color: colors.mint, at: { row: 0, slot: 'd' } }, hidden('c', colors.rose)] },
    { at: 3, note: '«copy()» sí crea un objeto nuevo e independiente (con los mismos elementos).', objs: [lst('#1', 0, ['1', '2', '3']), lst('#2', 1, ['1', '2', '3'])], labels: [{ ...A, at: { row: 0, slot: 'u' } }, { name: 'b', color: colors.mint, at: { row: 0, slot: 'd' } }, { name: 'c', color: colors.rose, at: { row: 1, slot: 'c' } }] },
    { at: 4, note: 'Ahora cambiar «c» no afecta a «a» ni a «b». Copia cuando quieras independencia.', objs: [lst('#1', 0, ['1', '2', '3']), lst('#2', 1, ['1', '2', '3', '4'], 3)], labels: [{ ...A, at: { row: 0, slot: 'u' } }, { name: 'b', color: colors.mint, at: { row: 0, slot: 'd' } }, { name: 'c', color: colors.rose, at: { row: 1, slot: 'c' } }] },
  ];
  return <BoardWalk lines={lines} steps={steps} rows={2} />;
}

// ───────────────────────── mapa de tipos ─────────────────────────

const TYPES = [
  { id: 'int', ex: '42, -7, 10_000', mut: false, hash: true, ord: '—', use: 'Contar, indexar, edades, cantidades.' },
  { id: 'float', ex: '3.14, 1e-3', mut: false, hash: true, ord: '—', use: 'Medidas y cálculos con decimales (con redondeo en mente).' },
  { id: 'str', ex: '"hola", \'a\'', mut: false, hash: true, ord: 'sí', use: 'Texto. Inmutable: los métodos devuelven un texto nuevo.' },
  { id: 'bool', ex: 'True, False', mut: false, hash: true, ord: '—', use: 'Condiciones. En realidad es un int (True == 1).' },
  { id: 'None', ex: 'None', mut: false, hash: true, ord: '—', use: '«Ausencia de valor»: resultado por defecto de las funciones.' },
  { id: 'list', ex: '[1, "a", 3.5]', mut: true, hash: false, ord: 'sí', use: 'Colección ordenada y modificable. La más usada.' },
  { id: 'tuple', ex: '(1, 2), (x,)', mut: false, hash: true, ord: 'sí', use: 'Grupo fijo de valores: coordenadas, registros.' },
  { id: 'dict', ex: '{"a": 1}', mut: true, hash: false, ord: 'inserción', use: 'Asociar claves con valores; búsqueda rápida por clave.' },
  { id: 'set', ex: '{1, 2, 3}', mut: true, hash: false, ord: 'no', use: 'Elementos únicos y operaciones de conjuntos.' },
] as const;

function Prop({ label, on, text }: { label: string; on?: boolean; text?: string }) {
  const c = text ? colors.cyan : on ? colors.mint : colors.rose;
  return (
    <View style={{ flex: 1, minWidth: 96, borderRadius: radius.md, borderWidth: 1, borderColor: c + '88', backgroundColor: c + '14', padding: 8, gap: 2 }}>
      <T v="tiny" color={colors.dim}>{label}</T>
      <T bold color={c} style={{ fontFamily: fonts.monoBold, fontSize: 15, lineHeight: 20 }}>{text ?? (on ? 'sí' : 'no')}</T>
    </View>
  );
}

export function TypesMap() {
  const hue = pyHue();
  const [id, setId] = useState<(typeof TYPES)[number]['id']>('list');
  const t = TYPES.find((x) => x.id === id)!;
  return (
    <Frame>
      <Tabs items={TYPES.map((x) => ({ id: x.id, label: x.id }))} value={id} onChange={setId} color={hue.b} />
      <Animated.View key={id} entering={FadeIn.duration(200)} style={{ gap: 10 }}>
        <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, padding: 10, gap: 4 }}>
          <T style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 }} color={dk.faint}>{`type(valor).__name__  →  '${t.id === 'None' ? 'NoneType' : t.id}'`}</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 16, lineHeight: 22 }} color={dk.termText}>{t.ex}</T>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Prop label="Mutable" on={t.mut} />
          <Prop label="Hasheable" on={t.hash} />
          <Prop label="Ordenado" text={t.ord} />
        </View>
        <Note color={hue.b} min={44}>{t.use}</Note>
      </Animated.View>
    </Frame>
  );
}

// ───────────────────────── precedencia ─────────────────────────

const EXAMPLES: Record<string, { lines: string[]; notes: Record<number, string>; texts: string[] }> = {
  mates: {
    lines: ['2 + 3 * 4 ** 2', '2 + 3 * 16', '2 + 48', '50'],
    notes: { 0: '', 1: '← ** primero', 2: '← * después', 3: '← + al final' },
    texts: ['Primero las potencias (**), luego * / // %, y por último + y −. Los paréntesis cambian el orden.', '4 ** 2 = 16: la potencia es la que más pesa.', '3 * 16 = 48: la multiplicación va antes que la suma.', '2 + 48 = 50. Con paréntesis, (2 + 3) * 4 ** 2 daría 80.'],
  },
  logica: {
    lines: ['not False or True and False', 'True or True and False', 'True or False', 'True'],
    notes: { 0: '', 1: '← not primero', 2: '← and antes que or', 3: '← or al final' },
    texts: ['En lógica: primero not, luego and, y por último or.', 'not False = True.', 'True and False = False (and va antes que or).', 'True or False = True.'],
  },
};

export function Precedence() {
  const hue = pyHue();
  const [k, setK] = useState<'mates' | 'logica'>('mates');
  const ex = EXAMPLES[k];
  const steps: WalkStep[] = ex.lines.map((_, i) => ({ at: i, note: ex.texts[i], notes: { [i]: ex.notes[i] }, dim: ex.lines.map((__, j) => j).filter((j) => j < i) }));
  return (
    <View style={{ gap: 10 }}>
      <Tabs items={[{ id: 'mates', label: 'aritmética' }, { id: 'logica', label: 'lógica' }]} value={k} onChange={setK} color={hue.b} />
      <Walk key={k} lines={ex.lines} steps={steps} size={14} />
    </View>
  );
}

// ───────────────────────── índices de un texto ─────────────────────────

export function StrIndex() {
  const hue = pyHue();
  const TXT = 'PYTHON';
  const n = TXT.length;
  const [a, setA] = useState(1);
  const [b, setB] = useState(4);
  const res = a < b ? TXT.slice(a, b) : '';
  return (
    <Frame>
      <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, padding: 10, gap: 4 }}>
        <View style={row}>
          {TXT.split('').map((ch, i) => {
            const on = i >= a && i < b;
            return (
              <View key={i} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <T style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 }} color={dk.mint}>{i}</T>
                <View style={{ width: '88%', aspectRatio: 1, borderRadius: 8, borderWidth: on ? 2 : 1, borderColor: on ? dk.amber : dk.line, backgroundColor: on ? dk.amber + '33' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: 18, lineHeight: 24 }} color={dk.termText}>{ch}</T>
                </View>
                <T style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 }} color={dk.rose}>{i - n}</T>
              </View>
            );
          })}
        </View>
        <View style={[row, { justifyContent: 'space-between' }]}>
          <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={dk.mint}>índice positivo →</T>
          <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={dk.rose}>← índice negativo</T>
        </View>
      </View>
      <Slider min={0} max={n} value={a} onChange={setA} label="Inicio de la rebanada" color={colors.mint} />
      <Slider min={0} max={n} value={b} onChange={setB} label="Fin de la rebanada" color={colors.amber} />
      <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, padding: 10 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 15, lineHeight: 22 }} color={dk.termText}>{`texto[${a}:${b}]  →  '${res}'`}</T>
        <T style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 }} color={dk.dim}>{`texto[${a - n}:${b - n}] da lo mismo con índices negativos`}</T>
      </View>
      <Note color={hue.b} min={44}>La rebanada incluye el inicio y EXCLUYE el fin. Si inicio ≥ fin el resultado es vacío. Arrastra los controles.</Note>
    </Frame>
  );
}

// ───────────────────────── if / elif / else ─────────────────────────

export function IfFlow() {
  const hue = pyHue();
  const [nota, setNota] = useState(6);
  const conds = [
    { code: 'nota >= 9', test: nota >= 9, out: 'Sobresaliente', kw: 'if' },
    { code: 'nota >= 7', test: nota >= 7, out: 'Notable', kw: 'elif' },
    { code: 'nota >= 5', test: nota >= 5, out: 'Aprobado', kw: 'elif' },
    { code: '', test: true, out: 'Suspenso', kw: 'else' },
  ];
  const hit = conds.findIndex((c) => c.test);
  return (
    <Frame>
      <Slider min={0} max={10} value={nota} onChange={setNota} label="Nota" color={hue.b} />
      <View style={{ gap: 6 }}>
        {conds.map((c, i) => {
          const reached = i <= hit;
          const win = i === hit;
          const col = win ? colors.mint : reached ? colors.rose : colors.faint;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, borderWidth: win ? 2 : 1, borderColor: col + (reached ? 'FF' : '55'), backgroundColor: col + (win ? '26' : '10'), paddingHorizontal: 10, paddingVertical: 8, opacity: reached ? 1 : 0.45 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 18, width: 46 }} color={colors.violet}>{c.kw}</T>
              <T style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, flex: 1 }} color={colors.text}>{c.code ? `${c.code}:` : ':'}</T>
              {c.code ? <Tag text={reached ? String(c.test) : '—'} color={win ? colors.mint : reached ? colors.rose : colors.faint} solid={win} /> : null}
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12, lineHeight: 16 }} color={win ? colors.mint : colors.faint}>{win ? `→ ${c.out}` : ''}</T>
            </View>
          );
        })}
      </View>
      <Note color={hue.b} min={44}>{`Python evalúa las condiciones EN ORDEN y ejecuta solo el primer bloque verdadero (aquí: «${conds[hit].out}»). Las siguientes ni se miran.`}</Note>
    </Frame>
  );
}

// ───────────────────────── bucles ─────────────────────────

const FOR_LINES = ['total = 0', 'for i in range(3):', '    total += i', 'print(total)'];
const FOR_STEPS: WalkStep[] = [
  { at: 0, note: 'Antes del bucle: total vale 0.', panels: [{ k: 'vars', items: [{ name: 'total', value: '0', hot: true }] }] },
  { at: 1, note: 'El for pide el primer valor de range(3): i = 0.', panels: [{ k: 'vars', items: [{ name: 'total', value: '0' }, { name: 'i', value: '0', hot: true }] }] },
  { at: 2, note: 'Se ejecuta el cuerpo: total += 0.', panels: [{ k: 'vars', items: [{ name: 'total', value: '0', hot: true }, { name: 'i', value: '0' }] }] },
  { at: 1, note: 'Vuelve arriba y pide el siguiente valor: i = 1.', panels: [{ k: 'vars', items: [{ name: 'total', value: '0' }, { name: 'i', value: '1', hot: true }] }] },
  { at: 2, note: 'total += 1 → total = 1.', panels: [{ k: 'vars', items: [{ name: 'total', value: '1', hot: true }, { name: 'i', value: '1' }] }] },
  { at: 1, note: 'Siguiente valor: i = 2.', panels: [{ k: 'vars', items: [{ name: 'total', value: '1' }, { name: 'i', value: '2', hot: true }] }] },
  { at: 2, note: 'total += 2 → total = 3.', panels: [{ k: 'vars', items: [{ name: 'total', value: '3', hot: true }, { name: 'i', value: '2' }] }] },
  { at: 1, note: 'range(3) ya no tiene más valores: el for termina y Python sigue por la línea de después.', panels: [{ k: 'vars', items: [{ name: 'total', value: '3' }, { name: 'i', value: '2' }] }] },
  { at: 3, note: 'print(total) muestra 3.', panels: [{ k: 'vars', items: [{ name: 'total', value: '3' }, { name: 'i', value: '2' }] }], out: [{ t: '3' }] },
];
const WHILE_LINES = ['n = 3', 'while n > 0:', '    print(n)', '    n -= 1', 'print("¡Despegue!")'];
const mk = (n: number, hot = true): WalkStep['panels'] => [{ k: 'vars', items: [{ name: 'n', value: String(n), hot }] }];
const WHILE_STEPS: WalkStep[] = [
  { at: 0, note: 'Arrancamos con n = 3.', panels: mk(3) },
  { at: 1, note: '¿3 > 0? Sí → entra al cuerpo.', panels: mk(3, false) },
  { at: 2, note: 'Imprime 3.', panels: mk(3, false), out: [{ t: '3' }] },
  { at: 3, note: 'n -= 1 → n = 2. Y vuelve a comprobar la condición.', panels: mk(2), out: [{ t: '3' }] },
  { at: 2, note: '¿2 > 0? Sí → imprime 2.', panels: mk(2, false), out: [{ t: '3' }, { t: '2' }] },
  { at: 3, note: 'n = 1.', panels: mk(1), out: [{ t: '3' }, { t: '2' }] },
  { at: 2, note: '¿1 > 0? Sí → imprime 1.', panels: mk(1, false), out: [{ t: '3' }, { t: '2' }, { t: '1' }] },
  { at: 3, note: 'n = 0.', panels: mk(0), out: [{ t: '3' }, { t: '2' }, { t: '1' }] },
  { at: 1, note: '¿0 > 0? No → el while termina. Si olvidaras «n -= 1», la condición sería siempre verdadera: bucle infinito.', panels: mk(0, false), out: [{ t: '3' }, { t: '2' }, { t: '1' }] },
  { at: 4, note: 'Sigue el programa.', panels: mk(0, false), out: [{ t: '3' }, { t: '2' }, { t: '1' }, { t: '¡Despegue!' }] },
];

export function LoopFlow() {
  const hue = pyHue();
  const [k, setK] = useState<'for' | 'while'>('for');
  return (
    <View style={{ gap: 10 }}>
      <Tabs items={[{ id: 'for', label: 'for (repite por cada valor)' }, { id: 'while', label: 'while (mientras se cumpla)' }]} value={k} onChange={setK} color={hue.b} />
      {k === 'for' ? <Walk key="for" lines={FOR_LINES} steps={FOR_STEPS} consoleLines={1} size={13} /> : <Walk key="while" lines={WHILE_LINES} steps={WHILE_STEPS} consoleLines={4} size={13} />}
    </View>
  );
}

// ───────────────────────── pila de llamadas ─────────────────────────

const STACK_LINES = ['def cuadrado(n):', '    return n * n', '', 'def suma_cuadrados(a, b):', '    return cuadrado(a) + cuadrado(b)', '', 'print(suma_cuadrados(2, 3))'];
const MOD = { name: '<módulo>', info: 'programa principal' };
const SUMA = { name: 'suma_cuadrados', info: 'a=2, b=3' };
const STACK_STEPS: WalkStep[] = [
  { at: 6, note: 'El programa principal llama a suma_cuadrados(2, 3). Cada llamada apila un marco con sus propias variables.', panels: [{ k: 'stack', frames: [{ ...MOD, hot: true }] }] },
  { at: 4, note: 'Dentro de suma_cuadrados hay que calcular cuadrado(a) primero…', panels: [{ k: 'stack', frames: [MOD, { ...SUMA, hot: true }] }] },
  { at: 1, note: '…lo que apila otro marco: cuadrado(n=2). Calcula 2 * 2 = 4 y devuelve.', panels: [{ k: 'stack', frames: [MOD, SUMA, { name: 'cuadrado', info: 'n=2 → 4', hot: true }] }] },
  { at: 4, note: 'El marco de cuadrado se desapila y el 4 vuelve a suma_cuadrados. Ahora toca cuadrado(b).', panels: [{ k: 'stack', frames: [MOD, { ...SUMA, info: 'a=2, b=3 · 4 + …', hot: true }] }] },
  { at: 1, note: 'Otro marco: cuadrado(n=3) → 9. Cada llamada tiene su propia «n».', panels: [{ k: 'stack', frames: [MOD, SUMA, { name: 'cuadrado', info: 'n=3 → 9', hot: true }] }] },
  { at: 4, note: 'suma_cuadrados calcula 4 + 9 = 13 y devuelve.', panels: [{ k: 'stack', frames: [MOD, { ...SUMA, info: '4 + 9 = 13', hot: true }] }] },
  { at: 6, note: 'Vuelve al programa principal, que imprime 13. Si algo falla, el traceback recorre esta pila de abajo a arriba.', panels: [{ k: 'stack', frames: [{ ...MOD, hot: true }] }], out: [{ t: '13' }] },
];

export function CallStack() {
  return <Walk lines={STACK_LINES} steps={STACK_STEPS} consoleLines={1} />;
}

// ───────────────────────── ámbitos LEGB ─────────────────────────

const SCOPES = [
  { id: 'L', title: 'Local', desc: 'dentro de la función actual', vars: ['z'], color: '#22D3A6' },
  { id: 'E', title: 'Envolvente', desc: 'funciones que la contienen', vars: ['y'], color: '#38BDF8' },
  { id: 'G', title: 'Global', desc: 'el módulo', vars: ['x'], color: '#FFD43B' },
  { id: 'B', title: 'Predefinido', desc: 'len, print, int…', vars: ['len', 'print'], color: '#C792EA' },
];
const SCOPE_CODE = ['x = "global"', 'def externa():', '    y = "envolvente"', '    def interna():', '        z = "local"', '        print(z, y, x, len)'];

export function ScopeLegb() {
  const hue = pyHue();
  const names = ['z', 'y', 'x', 'len', 'w'];
  const [name, setName] = useState('x');
  const hit = SCOPES.findIndex((s) => s.vars.includes(name));
  return (
    <Frame>
      <CodeLines lines={SCOPE_CODE} active={5} color={hue.b} size={12} />
      <T v="small" color={colors.dim}>Elige un nombre y mira dónde lo busca Python (de dentro hacia fuera):</T>
      <Tabs items={names.map((n) => ({ id: n, label: n }))} value={name} onChange={setName} color={hue.b} />
      <View style={{ gap: 6 }}>
        {SCOPES.map((s, i) => {
          const win = i === hit;
          const tried = hit === -1 || i <= hit;
          return (
            <Animated.View key={s.id + name} entering={FadeIn.delay(i * 120).duration(200)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, borderWidth: win ? 2 : 1, borderColor: s.color + (tried ? 'FF' : '44'), backgroundColor: s.color + (win ? '30' : '12'), paddingHorizontal: 10, paddingVertical: 8, opacity: tried ? 1 : 0.4, marginLeft: i * 10 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 18, lineHeight: 24, width: 22 }} color={s.color}>{s.id}</T>
              <View style={{ flex: 1 }}>
                <T bold color={colors.text} style={{ fontSize: 13, lineHeight: 18 }}>{s.title}</T>
                <T v="tiny" color={colors.dim}>{s.desc}</T>
              </View>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12, lineHeight: 16 }} color={win ? s.color : colors.faint}>{tried ? (win ? `✔ «${name}»` : '✘') : ''}</T>
            </Animated.View>
          );
        })}
      </View>
      <Note color={hit === -1 ? colors.rose : hue.b} min={44}>{hit === -1 ? `«${name}» no está en ningún ámbito → NameError: name '${name}' is not defined.` : `Python encuentra «${name}» en el ámbito ${SCOPES[hit].title} (${SCOPES[hit].id}) y deja de buscar.`}</Note>
    </Frame>
  );
}

// ───────────────────────── comprensiones ─────────────────────────

interface Part { t: string; color: string; title: string; desc: string }

export function Comprehension() {
  const [sel, setSel] = useState(1);
  const parts: Part[] = [
    { t: '[', color: colors.violet, title: 'Corchetes: se construye una lista', desc: 'Con llaves {} sería un conjunto o diccionario; con paréntesis (), un generador.' },
    { t: 'n * n', color: colors.mint, title: 'La expresión', desc: 'Lo que se guarda en la lista por cada elemento que pasa el filtro.' },
    { t: ' for n in range(6)', color: colors.cyan, title: 'El origen', desc: 'De dónde salen los elementos: se recorre range(6) con la variable n.' },
    { t: ' if n % 2 == 0', color: colors.amber, title: 'El filtro (opcional)', desc: 'Solo se procesan los n que cumplen la condición: los pares.' },
    { t: ']', color: colors.violet, title: 'Cierre', desc: 'El resultado es [0, 4, 16]: los cuadrados de 0, 2 y 4.' },
  ];
  const loop = ['resultado = []', 'for n in range(6):', '    if n % 2 == 0:', '        resultado.append(n * n)'];
  const map: Record<number, number> = { 0: 0, 1: 3, 2: 1, 3: 2, 4: 0 };
  const p = parts[sel];
  return (
    <Frame>
      <T v="tiny" color={colors.dim}>Toca cada trozo de la comprensión:</T>
      <View style={{ backgroundColor: dk.termBg, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: dk.line }}>
        <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={dk.faint}>{'cuadrados_pares ='}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {parts.map((x, i) => (
            <Pressable key={i} accessibilityRole="button" accessibilityLabel={x.title} onPress={() => { tap(); setSel(i); }} style={{ minHeight: 32, justifyContent: 'center' }}>
              <T style={{ fontFamily: sel === i ? fonts.monoBold : fonts.mono, fontSize: 16, backgroundColor: sel === i ? x.color + '33' : 'transparent', textDecorationLine: sel === i ? 'underline' : 'none' }} color={x.color}>{x.t}</T>
            </Pressable>
          ))}
        </View>
      </View>
      <Animated.View key={sel} entering={FadeIn.duration(220)} style={{ borderLeftWidth: 4, borderLeftColor: p.color, paddingLeft: 12, gap: 2, minHeight: 62 }}>
        <T v="h3" color={p.color}>{p.title}</T>
        <T v="small" color={colors.text}>{p.desc}</T>
      </Animated.View>
      <T v="small" color={colors.dim}>Equivale a este bucle (se ilumina la línea correspondiente):</T>
      <CodeLines lines={loop} active={map[sel]} color={p.color} size={12} />
    </Frame>
  );
}

// ───────────────────────── colecciones ─────────────────────────

const COLS = [
  { id: 'list', lit: '[3, 1, 3]', ord: 'sí', mut: true, dup: true, acc: 'por posición: x[0]', use: 'Una secuencia que crece, se ordena o se modifica.', color: '#22D3A6' },
  { id: 'tuple', lit: '(3, 1, 3)', ord: 'sí', mut: false, dup: true, acc: 'por posición: x[0]', use: 'Un grupo fijo de valores (coordenadas, registros). Puede ser clave de dict.', color: '#38BDF8' },
  { id: 'dict', lit: '{"a": 3, "b": 1}', ord: 'inserción', mut: true, dup: false, acc: 'por clave: x["a"]', use: 'Asociar nombres con valores; búsqueda instantánea por clave.', color: '#FFD43B' },
  { id: 'set', lit: '{3, 1}', ord: 'no', mut: true, dup: false, acc: 'solo pertenencia: 3 in x', use: 'Quitar duplicados, comprobar pertenencia y operar como conjuntos.', color: '#F472B6' },
] as const;

export function Collections() {
  const hue = pyHue();
  const [id, setId] = useState<(typeof COLS)[number]['id']>('list');
  const c = COLS.find((x) => x.id === id)!;
  return (
    <Frame>
      <Tabs items={COLS.map((x) => ({ id: x.id, label: x.id }))} value={id} onChange={setId} color={hue.b} />
      <Animated.View key={id} entering={FadeIn.duration(200)} style={{ gap: 10 }}>
        <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: c.color + '88', padding: 12 }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 17, lineHeight: 24 }} color={c.color}>{c.lit}</T>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Prop label="Ordenada" text={c.ord} />
          <Prop label="Mutable" on={c.mut} />
          <Prop label="Admite duplicados" on={c.dup} />
        </View>
        <Prop label="Acceso" text={c.acc} />
        <Note color={c.color} min={44}>{c.use}</Note>
      </Animated.View>
    </Frame>
  );
}

// ───────────────────────── flujo de excepciones ─────────────────────────

const EXC_LINES = ['try:', '    n = int(texto)', '    print(10 / n)', 'except ValueError:', '    print("no es un número")', 'except ZeroDivisionError:', '    print("no se divide entre 0")', 'else:', '    print("todo bien")', 'finally:', '    print("fin")'];
const RED = '#FF6B81';

const EXC_SCENARIOS: Record<string, { label: string; texto: string; steps: WalkStep[] }> = {
  ok: {
    label: 'sin error', texto: '"5"',
    steps: [
      { at: 0, note: 'Se entra en el try.', panels: [{ k: 'vars', items: [{ name: 'texto', value: '"5"' }] }] },
      { at: 1, note: 'int("5") funciona: n = 5.', panels: [{ k: 'vars', items: [{ name: 'texto', value: '"5"' }, { name: 'n', value: '5', hot: true }] }] },
      { at: 2, note: '10 / 5 = 2.0. Todo el try terminó SIN excepción.', panels: [{ k: 'vars', items: [{ name: 'texto', value: '"5"' }, { name: 'n', value: '5' }] }], out: [{ t: '2.0' }] },
      { at: 7, note: 'Como no hubo error, se salta los except y se ejecuta el else.', out: [{ t: '2.0' }] },
      { at: 8, note: 'else: código que solo tiene sentido si el try salió bien.', out: [{ t: '2.0' }, { t: 'todo bien' }] },
      { at: 9, note: 'Y el finally se ejecuta SIEMPRE, pase lo que pase.', out: [{ t: '2.0' }, { t: 'todo bien' }] },
      { at: 10, note: 'Fin: así termina el camino feliz.', out: [{ t: '2.0' }, { t: 'todo bien' }, { t: 'fin' }] },
    ],
  },
  value: {
    label: 'ValueError', texto: '"x"',
    steps: [
      { at: 0, note: 'Se entra en el try.', panels: [{ k: 'vars', items: [{ name: 'texto', value: '"x"' }] }] },
      { at: 1, note: 'int("x") lanza ValueError. El resto del try (línea 3) se SALTA.', marks: { 1: RED }, panels: [{ k: 'text', text: 'ValueError: invalid literal for int()', color: RED }] },
      { at: 3, note: 'Python busca un except que encaje: ¡ValueError coincide!', panels: [{ k: 'text', text: 'ValueError capturada', color: colors.mint }] },
      { at: 4, note: 'Se ejecuta el manejador.', out: [{ t: 'no es un número' }] },
      { at: 9, note: 'El else NO se ejecuta (hubo error). El finally sí.', out: [{ t: 'no es un número' }] },
      { at: 10, note: 'Fin. El programa continúa con normalidad tras el try.', out: [{ t: 'no es un número' }, { t: 'fin' }] },
    ],
  },
  zero: {
    label: 'ZeroDivisionError', texto: '"0"',
    steps: [
      { at: 0, note: 'Se entra en el try.', panels: [{ k: 'vars', items: [{ name: 'texto', value: '"0"' }] }] },
      { at: 1, note: 'int("0") funciona: n = 0.', panels: [{ k: 'vars', items: [{ name: 'texto', value: '"0"' }, { name: 'n', value: '0', hot: true }] }] },
      { at: 2, note: '10 / 0 lanza ZeroDivisionError.', marks: { 2: RED }, panels: [{ k: 'text', text: 'ZeroDivisionError: division by zero', color: RED }] },
      { at: 3, note: 'El primer except (ValueError) NO encaja… se prueba el siguiente.', dim: [4] },
      { at: 5, note: '¡ZeroDivisionError coincide!', panels: [{ k: 'text', text: 'ZeroDivisionError capturada', color: colors.mint }] },
      { at: 6, note: 'Se ejecuta ese manejador.', out: [{ t: 'no se divide entre 0' }] },
      { at: 10, note: 'finally siempre se ejecuta.', out: [{ t: 'no se divide entre 0' }, { t: 'fin' }] },
    ],
  },
  uncaught: {
    label: 'no capturada', texto: 'None',
    steps: [
      { at: 0, note: 'Se entra en el try (texto = None).', panels: [{ k: 'vars', items: [{ name: 'texto', value: 'None' }] }] },
      { at: 1, note: 'int(None) lanza TypeError: ningún except la espera.', marks: { 1: RED }, panels: [{ k: 'text', text: 'TypeError: int() argument must be a string…', color: RED }] },
      { at: [3, 5], note: 'Ni except ValueError ni except ZeroDivisionError encajan.', marks: { 3: RED, 5: RED } },
      { at: 9, note: 'El finally se ejecuta de todas formas…', out: [{ t: 'fin' }] },
      { at: 10, note: '…y después la excepción sigue subiendo: sin nadie que la trate, el programa se detiene con un traceback.', marks: { 10: RED }, out: [{ t: 'fin' }, { t: 'Traceback (most recent call last): …', c: RED }, { t: 'TypeError: int() argument must be…', c: RED }] },
    ],
  },
};

export function ExceptionsFlow() {
  const hue = pyHue();
  const [k, setK] = useState<keyof typeof EXC_SCENARIOS>('ok');
  const sc = EXC_SCENARIOS[k];
  return (
    <View style={{ gap: 10 }}>
      <Tabs items={Object.entries(EXC_SCENARIOS).map(([id, s]) => ({ id: id as keyof typeof EXC_SCENARIOS, label: s.label }))} value={k} onChange={setK} color={hue.b} />
      <Walk key={k} title={`texto = ${sc.texto}`} lines={EXC_LINES} steps={sc.steps} consoleLines={3} size={11} />
    </View>
  );
}

// ───────────────────────── modos de apertura de archivos ─────────────────────────

const MODES = [
  { id: 'r', name: 'leer', lee: true, escribe: false, crea: false, borra: false, after: 'UnsupportedOperation: not writable', ok: false, note: 'Modo por defecto. Si el archivo no existe: FileNotFoundError.' },
  { id: 'w', name: 'escribir', lee: false, escribe: true, crea: true, borra: true, after: 'XY', ok: true, note: '¡Cuidado! Al abrir se VACÍA el archivo. Si no existe, lo crea.' },
  { id: 'a', name: 'añadir', lee: false, escribe: true, crea: true, borra: false, after: 'holaXY', ok: true, note: 'Escribe siempre al final, sin tocar lo que había.' },
  { id: 'x', name: 'crear', lee: false, escribe: true, crea: true, borra: false, after: 'FileExistsError: ya existe', ok: false, note: 'Solo crea archivos nuevos: si existe, falla (protege de sobrescribir).' },
  { id: 'r+', name: 'leer y escribir', lee: true, escribe: true, crea: false, borra: false, after: 'XYla', ok: true, note: 'Escribe desde el principio, pisando lo que haya (no recorta el archivo).' },
] as const;

export function FileModes() {
  const hue = pyHue();
  const [id, setId] = useState<(typeof MODES)[number]['id']>('w');
  const m = MODES.find((x) => x.id === id)!;
  return (
    <Frame>
      <Tabs items={MODES.map((x) => ({ id: x.id, label: `"${x.id}"` }))} value={id} onChange={setId} color={hue.b} />
      <Animated.View key={id} entering={FadeIn.duration(200)} style={{ gap: 10 }}>
        <View style={{ backgroundColor: dk.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: dk.line, padding: 10, gap: 6 }}>
          <T style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 }} color={dk.termText}>{`with open("datos.txt", "${m.id}") as f:`}</T>
          <T style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 }} color={dk.termText}>{'    f.write("XY")'}</T>
          <View style={[row, { gap: 8, marginTop: 4 }]}>
            <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={dk.faint}>antes:</T>
            <Tag text="hola" color={dk.cyan} />
            <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={dk.faint}>después:</T>
            <Tag text={m.after} color={m.ok ? dk.mint : dk.rose} solid />
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Prop label="Lee" on={m.lee} />
          <Prop label="Escribe" on={m.escribe} />
          <Prop label="Crea si no existe" on={m.crea} />
          <Prop label="Borra el contenido" on={m.borra} />
        </View>
        <Note color={hue.b} min={44}>{`"${m.id}" = ${m.name}. ${m.note}`}</Note>
      </Animated.View>
    </Frame>
  );
}

// ───────────────────────── ruta de importación ─────────────────────────

const PLACES = [
  { id: 'cache', title: 'sys.modules', desc: 'módulos ya importados (caché)' },
  { id: 'prog', title: 'Carpeta del programa', desc: 'tus propios archivos .py' },
  { id: 'std', title: 'Biblioteca estándar', desc: 'math, random, json, datetime…' },
  { id: 'site', title: 'Paquetes instalados', desc: 'site-packages (pip)' },
];
const IMPORTS: Record<string, { label: string; hit: number; note: string }> = {
  math: { label: 'import math', hit: 2, note: '«math» no es tuyo ni está cargado aún: lo encuentra en la biblioteca estándar y lo guarda en sys.modules.' },
  util: { label: 'import util', hit: 1, note: 'Hay un util.py junto a tu programa: Python lo ejecuta una vez y lo guarda en sys.modules.' },
  inventado: { label: 'import inventado', hit: -1, note: 'Ningún sitio lo tiene: ModuleNotFoundError: No module named \'inventado\'.' },
  cargado: { label: 'import math (otra vez)', hit: 0, note: 'La segunda vez ya está en sys.modules: se reutiliza al instante, sin volver a ejecutar nada.' },
};

export function ImportPath() {
  const hue = pyHue();
  const [k, setK] = useState<keyof typeof IMPORTS>('math');
  const im = IMPORTS[k];
  const last = im.hit === -1 ? PLACES.length - 1 : im.hit;
  const st = useSteps(last + 2, 1500);
  const shown = Math.min(st.i, last + 1);
  return (
    <Frame>
      <Tabs items={Object.entries(IMPORTS).map(([id, s]) => ({ id: id as keyof typeof IMPORTS, label: s.label }))} value={k} onChange={(v) => { setK(v); st.go(0); }} color={hue.b} />
      <View style={{ gap: 6 }}>
        {PLACES.map((p, i) => {
          const visited = i < shown;
          const found = visited && i === im.hit;
          const miss = visited && !found;
          const c = found ? colors.mint : miss ? colors.rose : colors.faint;
          const off = i > last;
          return (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, borderWidth: found ? 2 : 1, borderColor: c + (visited ? 'FF' : '55'), backgroundColor: c + (found ? '28' : '10'), padding: 10, opacity: off && visited ? 0.4 : 1 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 16, lineHeight: 22, width: 24 }} color={c}>{i + 1}</T>
              <View style={{ flex: 1 }}>
                <T bold color={colors.text} style={{ fontSize: 13, lineHeight: 18 }}>{p.title}</T>
                <T v="tiny" color={colors.dim}>{p.desc}</T>
              </View>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={c}>{found ? '✔ ¡aquí!' : miss ? '✘' : ''}</T>
            </View>
          );
        })}
      </View>
      <Animated.View key={`${k}${shown >= last + 1}`} entering={FadeIn.duration(200)} style={{ borderLeftWidth: 4, borderLeftColor: im.hit === -1 && shown > last ? colors.rose : hue.b, paddingLeft: 12, minHeight: 58, justifyContent: 'center' }}>
        <T v="small" color={colors.text}>{shown > last ? im.note : 'Python busca el módulo en estos sitios, en orden…'}</T>
      </Animated.View>
      <StepBar i={st.i} n={last + 2} go={st.go} auto={st.auto} toggle={st.toggle} color={hue.b} hint label={shown > last ? 'Fin de la búsqueda' : `Mirando el sitio ${shown + 1}`} />
    </Frame>
  );
}
