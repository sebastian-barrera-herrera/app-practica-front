/** Ilustraciones de diseño de bases de datos: modelo entidad-relación y normalización. */
import React, { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { select, tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Btn, Tabs } from './pyui';
import { Explain, Note, SqlTable, sqlHue } from './sqlui';

// ───────────────────────── modelo entidad-relación ─────────────────────────

type Key = 'pk' | 'fk' | 'pkfk';
interface ColDef {
  name: string;
  key?: Key;
}

function keyMark(k?: Key) {
  return k === 'pk' ? '🔑 ' : k === 'fk' ? '🔗 ' : k === 'pkfk' ? '🔑🔗 ' : '';
}

function TableCard({ name, cols, color, hi = [], dim }: { name: string; cols: ColDef[]; color: string; hi?: string[]; dim?: boolean }) {
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 2, borderColor: color, backgroundColor: colors.card2, overflow: 'hidden', opacity: dim ? 0.4 : 1 }}>
      <View style={{ backgroundColor: color + '33', paddingHorizontal: 10, paddingVertical: 5 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={color}>▦ {name}</T>
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {cols.map((c) => {
          const on = hi.includes(c.name);
          return (
            <View key={c.name} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: on ? color + '55' : 'transparent', borderWidth: on ? 1 : 0, borderColor: color }}>
              <T style={{ fontFamily: on ? fonts.monoBold : fonts.mono, fontSize: 12, lineHeight: 17 }} color={on ? colors.text : colors.dim}>{keyMark(c.key)}{c.name}</T>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const SHOP: Record<string, { cols: ColDef[]; color: () => string }> = {
  clientes: { cols: [{ name: 'id', key: 'pk' }, { name: 'nombre' }, { name: 'ciudad' }, { name: 'email' }], color: () => colors.cyan },
  pedidos: { cols: [{ name: 'id', key: 'pk' }, { name: 'cliente_id', key: 'fk' }, { name: 'fecha' }, { name: 'estado' }], color: () => colors.mint },
  detalle_pedido: { cols: [{ name: 'pedido_id', key: 'pkfk' }, { name: 'producto_id', key: 'pkfk' }, { name: 'cantidad' }], color: () => colors.violet },
  productos: { cols: [{ name: 'id', key: 'pk' }, { name: 'nombre' }, { name: 'categoria' }, { name: 'precio' }], color: () => colors.amber },
};
const SHOP_ORDER = ['clientes', 'pedidos', 'detalle_pedido', 'productos'];
const SHOP_RELS = [
  { id: 'cp', a: 'clientes', b: 'pedidos', ka: 'id', kb: 'cliente_id', ca: '1', cb: 'N', text: 'Un cliente puede hacer MUCHOS pedidos, pero cada pedido es de UN solo cliente. La clave foránea `pedidos.cliente_id` apunta a `clientes.id`: es una relación uno a muchos (1:N).' },
  { id: 'pd', a: 'pedidos', b: 'detalle_pedido', ka: 'id', kb: 'pedido_id', ca: '1', cb: 'N', text: 'Un pedido tiene VARIAS líneas (un producto con su cantidad cada una). `detalle_pedido.pedido_id` apunta a `pedidos.id`.' },
  { id: 'prd', a: 'productos', b: 'detalle_pedido', ka: 'id', kb: 'producto_id', ca: '1', cb: 'N', text: 'Un producto puede aparecer en MUCHAS líneas. Juntas, las dos relaciones de `detalle_pedido` forman una relación muchos a muchos entre pedidos y productos: `detalle_pedido` es la tabla puente.' },
] as const;

function ShopModel() {
  const [rel, setRel] = useState<(typeof SHOP_RELS)[number]['id']>('cp');
  const r = SHOP_RELS.find((x) => x.id === rel)!;
  const link = (a: string, b: string) => SHOP_RELS.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))!;
  return (
    <View style={{ gap: 4 }}>
      {SHOP_ORDER.map((name, i) => {
        const t = SHOP[name];
        const involved = name === r.a || name === r.b;
        const hi = name === r.a ? [r.ka] : name === r.b ? [r.kb] : [];
        const next = SHOP_ORDER[i + 1];
        const lk = next ? link(name, next) : null;
        return (
          <View key={name} style={{ gap: 4 }}>
            <TableCard name={name} cols={t.cols} color={t.color()} hi={hi} dim={!involved} />
            {lk ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Relación ${lk.a} con ${lk.b}`}
                onPress={() => { select(); setRel(lk.id); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 4, minHeight: 36, borderRadius: radius.md, backgroundColor: lk.id === rel ? sqlHue().a + '26' : 'transparent' }}
              >
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={lk.id === rel ? sqlHue().a : colors.faint}>{name === lk.a ? lk.ca : lk.cb}</T>
                <View style={{ width: 2, height: 22, backgroundColor: lk.id === rel ? sqlHue().a : colors.line }} />
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={lk.id === rel ? sqlHue().a : colors.faint}>{next === lk.b ? lk.cb : lk.ca}</T>
                <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim}>{lk.kb}</T>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Explain k={rel} title={`${r.a} ↔ ${r.b}`} color={sqlHue().a}>{r.text.replace(/`/g, '')}</Explain>
    </View>
  );
}

// tablas pequeñas con filas, unidas por líneas

interface MiniTable {
  title: string;
  cols: ColDef[];
  rows: (string | number)[][];
  color: string;
}
interface RowLink {
  a: [number, number];
  b: [number, number];
}
const HEAD = 26;
const SUBHEAD = 22;
const ROWH = 28;

function RelDiagram({ tables, links }: { tables: MiniTable[]; links: RowLink[] }) {
  const [w, setW] = useState(320);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const n = tables.length;
  const gap = n === 2 ? 56 : 30;
  const tw = (w - gap * (n - 1)) / n;
  const maxRows = Math.max(...tables.map((t) => t.rows.length));
  const height = HEAD + SUBHEAD + maxRows * ROWH + 4;
  const rowY = (r: number) => HEAD + SUBHEAD + r * ROWH + ROWH / 2;
  const same = (p: [number, number], q: [number, number]) => p[0] === q[0] && p[1] === q[1];
  const active = (l: RowLink) => !!sel && (same(l.a, sel) || same(l.b, sel));
  const linked = (t: number, r: number) => !!sel && ((sel[0] === t && sel[1] === r) || links.some((l) => active(l) && (same(l.a, [t, r]) || same(l.b, [t, r]))));
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height, width: '100%' }}>
      <Svg width={w} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
        {links.map((l, i) => {
          const [t1, r1] = l.a[0] < l.b[0] ? l.a : l.b;
          const [t2, r2] = l.a[0] < l.b[0] ? l.b : l.a;
          const on = active(l);
          return <Line key={i} x1={t1 * (tw + gap) + tw} y1={rowY(r1)} x2={t2 * (tw + gap)} y2={rowY(r2)} stroke={on ? sqlHue().a : colors.dim} strokeOpacity={sel && !on ? 0.2 : 0.85} strokeWidth={on ? 3 : 1.6} />;
        })}
      </Svg>
      {tables.map((t, ti) => (
        <View key={t.title} style={{ position: 'absolute', left: ti * (tw + gap), top: 0, width: tw, borderRadius: radius.md, borderWidth: 2, borderColor: t.color, backgroundColor: colors.card2, overflow: 'hidden' }}>
          <View style={{ height: HEAD, backgroundColor: t.color + '33', justifyContent: 'center', paddingHorizontal: 6 }}>
            <T numberOfLines={1} style={{ fontFamily: fonts.monoBold, fontSize: 11.5 }} color={t.color}>▦ {t.title}</T>
          </View>
          <View style={{ height: SUBHEAD, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line }}>
            {t.cols.map((c) => (
              <View key={c.name} style={{ flex: 1, paddingHorizontal: 4 }}>
                <T numberOfLines={1} style={{ fontFamily: fonts.monoBold, fontSize: 10.5 }} color={colors.dim}>{keyMark(c.key)}{c.name}</T>
              </View>
            ))}
          </View>
          {t.rows.map((r, ri) => {
            const on = linked(ti, ri);
            return (
              <Pressable key={ri} accessibilityRole="button" accessibilityLabel={`Fila ${r.join(', ')} de ${t.title}`} onPress={() => { tap(); setSel(sel && same(sel, [ti, ri]) ? null : [ti, ri]); }} style={{ height: ROWH, flexDirection: 'row', alignItems: 'center', backgroundColor: on ? t.color + '44' : 'transparent' }}>
                {r.map((v, ci) => (
                  <View key={ci} style={{ flex: 1, paddingHorizontal: 4 }}>
                    <T numberOfLines={1} style={{ fontFamily: on ? fonts.monoBold : fonts.mono, fontSize: 11.5 }} color={colors.text}>{v}</T>
                  </View>
                ))}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const REL_TABS = {
  '1n': {
    text: 'Uno a muchos: Ana tiene 2 pedidos y Luis 1. La clave foránea va en el lado «muchos» (`pedidos.cliente_id`). Toca una fila para ver con quién se relaciona.',
    tables: (): MiniTable[] => [
      { title: 'clientes', cols: [{ name: 'id', key: 'pk' }, { name: 'nombre' }], rows: [[1, 'Ana'], [2, 'Luis']], color: colors.cyan },
      { title: 'pedidos', cols: [{ name: 'id', key: 'pk' }, { name: 'cliente_id', key: 'fk' }], rows: [[10, 1], [11, 1], [12, 2]], color: colors.mint },
    ],
    links: [{ a: [0, 0], b: [1, 0] }, { a: [0, 0], b: [1, 1] }, { a: [0, 1], b: [1, 2] }] as RowLink[],
  },
  nm: {
    text: 'Muchos a muchos: Ana cursa 2 cursos y SQL lo cursan 2 personas. Se resuelve con una tabla puente (`inscripciones`), con una clave foránea a cada lado y clave primaria compuesta.',
    tables: (): MiniTable[] => [
      { title: 'estudiantes', cols: [{ name: 'id', key: 'pk' }, { name: 'nombre' }], rows: [[1, 'Ana'], [2, 'Luis']], color: colors.cyan },
      { title: 'inscripciones', cols: [{ name: 'est_id', key: 'pkfk' }, { name: 'curso', key: 'pkfk' }], rows: [[1, 10], [1, 11], [2, 10]], color: colors.violet },
      { title: 'cursos', cols: [{ name: 'id', key: 'pk' }, { name: 'nombre' }], rows: [[10, 'SQL'], [11, 'Py']], color: colors.amber },
    ],
    links: [{ a: [0, 0], b: [1, 0] }, { a: [0, 0], b: [1, 1] }, { a: [0, 1], b: [1, 2] }, { a: [1, 0], b: [2, 0] }, { a: [1, 1], b: [2, 1] }, { a: [1, 2], b: [2, 0] }] as RowLink[],
  },
  '11': {
    text: 'Uno a uno: cada usuario tiene como mucho UN perfil y cada perfil es de UN usuario. La clave foránea `perfiles.usuario_id` es a la vez la clave primaria, así que no se puede repetir.',
    tables: (): MiniTable[] => [
      { title: 'usuarios', cols: [{ name: 'id', key: 'pk' }, { name: 'alias' }], rows: [[1, 'ana_dev'], [2, 'luis_db']], color: colors.cyan },
      { title: 'perfiles', cols: [{ name: 'usuario_id', key: 'pkfk' }, { name: 'bio' }], rows: [[1, 'Amo SQL'], [2, 'Datos']], color: colors.rose },
    ],
    links: [{ a: [0, 0], b: [1, 0] }, { a: [0, 1], b: [1, 1] }] as RowLink[],
  },
};

type ErTab = 'tienda' | '1n' | 'nm' | '11';

export function ErModel() {
  const [tab, setTab] = useState<ErTab>('tienda');
  const c = sqlHue().a;
  return (
    <Frame>
      <Tabs color={c} value={tab} onChange={setTab} items={[{ id: 'tienda', label: 'TiendaTech' }, { id: '1n', label: '1 : N' }, { id: 'nm', label: 'N : M' }, { id: '11', label: '1 : 1' }]} />
      {tab === 'tienda' ? (
        <Animated.View key="tienda" entering={FadeIn.duration(220)}>
          <ShopModel />
        </Animated.View>
      ) : (
        <Animated.View key={tab} entering={FadeIn.duration(220)} style={{ gap: 12 }}>
          <RelDiagram tables={REL_TABS[tab].tables()} links={REL_TABS[tab].links} />
          <Explain k={tab} title={tab === '1n' ? 'Uno a muchos' : tab === 'nm' ? 'Muchos a muchos' : 'Uno a uno'} color={c}>{REL_TABS[tab].text.replace(/`/g, '')}</Explain>
        </Animated.View>
      )}
      <Note min={36}>{tab === 'tienda' ? 'Toca una conexión entre tablas para ver qué columnas la forman (🔑 clave primaria, 🔗 clave foránea).' : 'Toca una fila: se iluminan las filas relacionadas con ella.'}</Note>
    </Frame>
  );
}

// ───────────────────────── normalización ─────────────────────────

/** cliente, email, producto, precio */
const FLAT: (string | number)[][] = [
  ['Ana', 'ana@x.com', 'Teclado', 79.9],
  ['Ana', 'ana@x.com', 'Ratón', 24.5],
  ['Luis', 'luis@x.com', 'Teclado', 79.9],
  ['Ana', 'ana@x.com', 'Teclado', 79.9],
  ['Luis', 'luis@x.com', 'Ratón', 24.5],
];

type NormMode = 'antes' | 'despues';
type Upd = 'none' | 'ok' | 'forgot';

export function Normalization() {
  const [mode, setMode] = useState<NormMode>('antes');
  const [upd, setUpd] = useState<Upd>('none');
  const c = sqlHue().a;
  const NEW = 89.9;
  const change = (m: NormMode, u: Upd) => { setMode(m); setUpd(u); };
  // tabla plana: las filas del teclado son 0, 2 y 3
  const flat = FLAT.map((r, i) => {
    const kb = r[2] === 'Teclado';
    const price = kb && (upd === 'ok' || (upd === 'forgot' && i !== 0)) ? NEW : r[3];
    return [r[0], r[1], r[2], price];
  });
  const flatChanged = FLAT.map((r, i) => (r[2] === 'Teclado' && (upd === 'ok' || (upd === 'forgot' && i !== 0)) ? i : -1)).filter((i) => i >= 0);
  const prices = flat.filter((r) => r[2] === 'Teclado').map((r) => r[3]);
  const contradiction = new Set(prices).size > 1;
  const kbWrong = contradiction ? flat.map((r, i) => (r[2] === 'Teclado' && r[3] !== NEW ? i : -1)).filter((i) => i >= 0) : [];
  return (
    <Frame>
      <Tabs color={c} value={mode} onChange={(m) => change(m, 'none')} items={[{ id: 'antes', label: 'Antes: 1 tabla' }, { id: 'despues', label: 'Después: 3 tablas' }]} />
      {mode === 'antes' ? (
        <Animated.View key="a" entering={FadeIn.duration(240)} style={{ gap: 10 }}>
          <SqlTable name="ventas (todo repetido)" cols={[{ name: 'cliente' }, { name: 'email' }, { name: 'producto' }, { name: 'precio' }]} rows={flat} hiCols={upd === 'none' ? [0, 1, 2, 3] : []} hiRows={flatChanged} dimRows={[]} hiCells={kbWrong.map((i) => `${i},3`)} color={contradiction ? colors.rose : c} size={11} colW={34} />
          <T v="small" color={colors.dim}>El nombre y el email de cada cliente, y el nombre y el precio de cada producto, se escriben una y otra vez (celdas coloreadas).</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Btn label="Subir el teclado a 89,9 €" onPress={() => setUpd('ok')} disabled={upd !== 'none'} />
            <Btn label="…olvidándome de una fila" onPress={() => setUpd('forgot')} disabled={upd !== 'none'} color={colors.rose} />
            <Btn label="↺" a11y="Reiniciar" onPress={() => setUpd('none')} disabled={upd === 'none'} />
          </View>
          {upd === 'ok' ? <Explain k="ok" title="3 filas que modificar" color={colors.amber}>El precio del teclado está repetido en 3 filas: hay que acordarse de cambiar las tres.</Explain> : null}
          {upd === 'forgot' ? <Explain k="forgot" title="¡Contradicción!" color={colors.rose}>Quedó una fila con 79,9 y otras con 89,9: ¿cuánto cuesta el teclado? La base de datos se contradice a sí misma (anomalía de actualización).</Explain> : null}
        </Animated.View>
      ) : (
        <Animated.View key="d" entering={FadeIn.duration(240)} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <SqlTable name="clientes" cols={[{ name: 'id', pk: true }, { name: 'nombre' }, { name: 'email' }]} rows={[[1, 'Ana', 'ana@x.com'], [2, 'Luis', 'luis@x.com']]} color={colors.cyan} size={10.5} colW={30} />
            </View>
            <View style={{ flex: 1 }}>
              <SqlTable name="productos" cols={[{ name: 'id', pk: true }, { name: 'nombre' }, { name: 'precio' }]} rows={[[1, 'Teclado', upd === 'ok' ? NEW : 79.9], [2, 'Ratón', 24.5]]} hiRows={upd === 'ok' ? [0] : []} color={colors.amber} size={10.5} colW={30} />
            </View>
          </View>
          <SqlTable name="lineas" cols={[{ name: 'id', pk: true }, { name: 'cliente_id', fk: true }, { name: 'producto_id', fk: true }, { name: 'cant' }]} rows={[[1, 1, 1, 1], [2, 1, 2, 2], [3, 2, 1, 1], [4, 1, 1, 3], [5, 2, 2, 1]]} color={colors.violet} size={11} colW={34} />
          <T v="small" color={colors.dim}>Cada dato vive en UN sitio. Las líneas solo guardan números que apuntan a clientes y productos.</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Btn label="Subir el teclado a 89,9 €" onPress={() => setUpd('ok')} disabled={upd !== 'none'} />
            <Btn label="↺" a11y="Reiniciar" onPress={() => setUpd('none')} disabled={upd === 'none'} />
          </View>
          {upd === 'ok' ? <Explain k="ok2" title="1 sola fila" color={colors.mint}>El precio está en una única celda de «productos». Todas las líneas que lo usan lo reflejan al instante, con un JOIN. No hay forma de dejar datos contradictorios.</Explain> : null}
        </Animated.View>
      )}
    </Frame>
  );
}
