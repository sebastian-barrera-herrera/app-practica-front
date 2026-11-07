/** Ilustraciones de la zona 10 del curso de IA: espacio de vectores, mapa de embeddings, búsqueda semántica, índices aproximados y chunking. */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { EMB_FAMILIA, EMB_MAP, EMB_PAISES, FAQ_DOCS, FAQ_SEARCH } from './iaEmbedData';
import { ANIMALS, annSearch, chunkInfo, cloud, kmeans2, rank2, type Metric } from './iaVecLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs } from './iaui';

const palette = (): string[] => [colors.cyan, colors.amber, colors.rose, colors.green, colors.violet, colors.mint];

// ───────────────────────── espacio de características ─────────────────────────

export function VecSpaceDemo() {
  const [qx, setQx] = useState(4);
  const [qy, setQy] = useState(7);
  const [m, setM] = useState<Metric>('euclidea');
  const ranking = useMemo(() => rank2(ANIMALS, { x: qx, y: qy }, m), [qx, qy, m]);
  const W = 280;
  const H = 220;
  const X = (v: number): number => 28 + (v / 11) * (W - 40);
  const Y = (v: number): number => H - 26 - (v / 11) * (H - 40);
  const top = ranking.slice(0, 3);
  const unit = (n: string): number => ranking.findIndex((r) => r.item.name === n);
  return (
    <Frame>
      <Tabs items={[{ id: 'euclidea' as Metric, label: 'Distancia' }, { id: 'coseno' as Metric, label: 'Coseno' }, { id: 'producto' as Metric, label: 'Producto escalar' }]} value={m} onChange={setM} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={X(0)} x2={X(11)} y1={Y(0)} y2={Y(0)} stroke={colors.line} />
        <Line x1={X(0)} x2={X(0)} y1={Y(0)} y2={Y(11)} stroke={colors.line} />
        <SvgText x={W - 78} y={H - 8} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>tamaño →</SvgText>
        <SvgText x={4} y={14} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>↑ velocidad</SvgText>
        {m !== 'euclidea' ? <Line x1={X(0)} y1={Y(0)} x2={X(qx * (10 / Math.max(qx, qy, 1)))} y2={Y(qy * (10 / Math.max(qx, qy, 1)))} stroke={colors.amber} strokeWidth={1.5} strokeDasharray="4,3" /> : null}
        {top.map((r, i) => <Line key={r.item.name} x1={X(qx)} y1={Y(qy)} x2={X(r.item.x)} y2={Y(r.item.y)} stroke={[colors.green, colors.cyan, colors.faint][i]} strokeWidth={2.5 - i * 0.6} />)}
        {ANIMALS.map((a) => {
          const r = unit(a.name);
          return (
            <React.Fragment key={a.name}>
              <Circle cx={X(a.x)} cy={Y(a.y)} r={r < 3 ? 6 : 4} fill={r === 0 ? colors.green : r < 3 ? colors.cyan : colors.faint} stroke={colors.bg} strokeWidth={1.5} />
              <SvgText x={X(a.x) + 7} y={Y(a.y) + 3} fontSize={9.5} fill={colors.text} fontFamily={fonts.mono}>{a.name}</SvgText>
            </React.Fragment>
          );
        })}
        <Polygon points={`${X(qx)},${Y(qy) - 9} ${X(qx) + 8},${Y(qy) + 6} ${X(qx) - 8},${Y(qy) + 6}`} fill={colors.amber} stroke={colors.text} strokeWidth={2} />
      </Svg>
      <Stepper label="Consulta · tamaño" value={qx} min={0.5} max={10} step={0.5} onChange={setQx} />
      <Stepper label="Consulta · velocidad" value={qy} min={0.5} max={10} step={0.5} onChange={setQy} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {ranking.slice(0, 4).map((r, i) => <Pill key={r.item.name} text={`${i + 1}. ${r.item.name} ${m === 'euclidea' ? (-r.score).toFixed(1) : r.score.toFixed(2)}`} color={i === 0 ? colors.green : colors.dim} solid={i === 0} />)}
      </View>
      <Callout color={colors.violet}>
        {m === 'euclidea' ? <>La <T v="small" bold>distancia</T> mide lo lejos que están dos puntos: tiene en cuenta cuánto de grande y de rápido es cada animal.</> : m === 'coseno' ? <>El <T v="small" bold>coseno</T> solo mira el <T v="small" bold>ángulo</T> (la línea discontinua parte del origen): dos animales en la misma dirección empatan aunque uno sea mucho más grande. Es la medida habitual con embeddings.</> : <>El <T v="small" bold>producto escalar</T> premia el parecido de dirección y también la <T v="small" bold>longitud</T>: los vectores grandes ganan. Con vectores normalizados (longitud 1) coincide con el coseno.</>}
      </Callout>
    </Frame>
  );
}

// ───────────────────────── mapa de embeddings ─────────────────────────

const GROUP_COL: Record<string, number> = { animales: 0, comida: 1, 'tecnología': 2, personas: 3, 'países': 4 };

export function EmbedMapDemo() {
  const [tab, setTab] = useState<'mapa' | 'familia' | 'paises'>('mapa');
  const [sel, setSel] = useState('perro');
  const pal = palette();
  const W = 290;
  const H = 230;
  const X = (v: number): number => 18 + v * (W - 60);
  const Y = (v: number): number => H - 20 - v * (H - 44);
  const cur = EMB_MAP.find((p) => p.w === sel) ?? EMB_MAP[0];
  const pairs: [string, string, string, string][] = tab === 'familia' ? [['hombre', 'rey', 'mujer', 'reina'], ['niño', 'príncipe', 'niña', 'princesa'], ['padre', 'hijo', 'madre', 'hija']] : [['francia', 'parís', 'italia', 'roma'], ['españa', 'madrid', 'japón', 'tokio']];
  const pts = tab === 'familia' ? EMB_FAMILIA : EMB_PAISES;
  const at = (w: string) => pts.find((p) => p.w === w)!;
  return (
    <Frame>
      <Tabs items={[{ id: 'mapa' as const, label: 'Mapa de palabras' }, { id: 'familia' as const, label: 'Rey − hombre + mujer' }, { id: 'paises' as const, label: 'Países y capitales' }]} value={tab} onChange={setTab} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill="none" stroke={colors.line} />
        {tab === 'mapa'
          ? EMB_MAP.map((p) => {
              const isNn = cur.nn?.some((n) => n[0] === p.w);
              const on = p.w === sel;
              const col = pal[GROUP_COL[p.g ?? 'animales']];
              return (
                <React.Fragment key={p.w}>
                  {on ? cur.nn?.map((n) => {
                    const q = EMB_MAP.find((e) => e.w === n[0]);
                    return q ? <Line key={n[0]} x1={X(p.x)} y1={Y(p.y)} x2={X(q.x)} y2={Y(q.y)} stroke={colors.text} strokeWidth={1} opacity={0.5} /> : null;
                  }) : null}
                  <Circle cx={X(p.x)} cy={Y(p.y)} r={on ? 7 : isNn ? 5.5 : 4} fill={col} opacity={on || isNn ? 1 : 0.55} stroke={on ? colors.text : colors.bg} strokeWidth={on ? 2 : 1} />
                  <SvgText x={X(p.x) + 6} y={Y(p.y) + 3} fontSize={on || isNn ? 10 : 8} fill={colors.text} fontFamily={on ? fonts.monoBold : fonts.mono} opacity={on || isNn ? 1 : 0.7}>{p.w}</SvgText>
                </React.Fragment>
              );
            })
          : (
            <>
              {pairs.map(([a, b, c, d], i) => (
                <React.Fragment key={a}>
                  <Line x1={X(at(a).x)} y1={Y(at(a).y)} x2={X(at(b).x)} y2={Y(at(b).y)} stroke={pal[i]} strokeWidth={2.5} />
                  <Line x1={X(at(c).x)} y1={Y(at(c).y)} x2={X(at(d).x)} y2={Y(at(d).y)} stroke={pal[i]} strokeWidth={2.5} strokeDasharray="5,3" />
                </React.Fragment>
              ))}
              {pts.map((p) => (
                <React.Fragment key={p.w}>
                  <Circle cx={X(p.x)} cy={Y(p.y)} r={5} fill={colors.text} stroke={colors.bg} strokeWidth={1.5} />
                  <SvgText x={X(p.x) + 7} y={Y(p.y) + 3} fontSize={10} fill={colors.text} fontFamily={fonts.mono}>{p.w}</SvgText>
                </React.Fragment>
              ))}
            </>
          )}
      </Svg>
      {tab === 'mapa' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {EMB_MAP.map((p) => (
              <Pressable key={p.w} accessibilityRole="button" accessibilityLabel={p.w} onPress={() => { tap(); setSel(p.w); }} style={{ minHeight: 34, paddingHorizontal: 9, borderRadius: radius.pill, justifyContent: 'center', borderWidth: 1, borderColor: pal[GROUP_COL[p.g ?? 'animales']], backgroundColor: p.w === sel ? pal[GROUP_COL[p.g ?? 'animales']] : 'transparent' }}>
                <T v="tiny" bold color={p.w === sel ? '#0B0B14' : colors.text} style={{ fontFamily: fonts.mono }}>{p.w}</T>
              </Pressable>
            ))}
          </View>
          <Explain k={sel} title={`Vecinos de «${sel}»`} color={pal[GROUP_COL[cur.g ?? 'animales']]}>
            {cur.nn?.map((n) => `${n[0]} (${n[1].toFixed(2)})`).join(' · ')}. Cada color es un tema y las palabras de un mismo tema se agrupan, aunque el modelo no conozca los temas: solo ve en qué contextos aparece cada palabra.
          </Explain>
        </>
      ) : (
        <Explain k={tab} title={tab === 'familia' ? 'Las diferencias son direcciones' : 'Capital = país + una dirección'} color={colors.green}>
          {tab === 'familia' ? <>La flecha <T v="small" bold>hombre → rey</T> es casi paralela a <T v="small" bold>mujer → reina</T>: el embedding ha aprendido una dirección de «realeza». Por eso <T v="small" bold>rey − hombre + mujer ≈ reina</T>. Las líneas continuas y discontinuas del mismo color son las parejas.</> : <>En cada pareja, el paso <T v="small" bold>país → capital</T> es casi el mismo vector. Así se calcula <T v="small" bold>parís − francia + italia ≈ roma</T>. (Proyección en 2D de vectores de 128 dimensiones: el parecido es aproximado.)</>}
        </Explain>
      )}
    </Frame>
  );
}

// ───────────────────────── búsqueda por palabras frente a búsqueda semántica ─────────────────────────

export function SemanticSearchDemo() {
  const [qi, setQi] = useState(0);
  const s = FAQ_SEARCH[qi];
  const order = (v: number[]): number[] => v.map((_, i) => i).sort((a, b) => v[b] - v[a] || a - b).slice(0, 3);
  const kw = order(s.kw);
  const sem = order(s.sem);
  const id = (i: number): string => FAQ_DOCS[i].id;
  const row = (list: number[], vals: number[], title: string, col: string) => (
    <View style={{ gap: 6, flex: 1, minWidth: 140 }}>
      <T v="label" color={col}>{title}</T>
      {list.map((i, n) => {
        const ok = id(i) === s.esp;
        return (
          <View key={i} style={{ borderLeftWidth: 4, borderLeftColor: ok ? colors.green : n === 0 ? colors.rose : colors.line, paddingLeft: 8 }}>
            <T v="tiny" bold color={ok ? colors.green : colors.text} style={{ fontFamily: fonts.mono }}>{n + 1}. {id(i)} {ok ? '✓' : ''}</T>
            <Meter label="" value={Math.max(0, Math.min(1, vals[i]))} color={col} suffix={vals[i].toFixed(2)} />
          </View>
        );
      })}
    </View>
  );
  const kwOk = id(kw[0]) === s.esp;
  const semOk = id(sem[0]) === s.esp;
  return (
    <Frame>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {FAQ_SEARCH.map((q, i) => (
          <Pressable key={q.q} accessibilityRole="button" accessibilityLabel={q.q} onPress={() => { tap(); setQi(i); }} style={{ minHeight: 36, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center', borderWidth: 1, borderColor: colors.violet, backgroundColor: i === qi ? colors.violet : 'transparent' }}>
            <T v="tiny" bold color={i === qi ? '#0B0B14' : colors.text}>{i + 1}</T>
          </Pressable>
        ))}
      </View>
      <T v="body" bold color={colors.text}>«{s.q}»</T>
      <T v="tiny" color={colors.dim}>Documento correcto: {s.esp}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {row(kw, s.kw, 'Por palabras (coincidencias)', colors.amber)}
        {row(sem, s.sem, 'Por significado (embeddings)', colors.cyan)}
      </View>
      <Explain k={`${qi}-${kwOk}-${semOk}`} title={semOk && !kwOk ? '🎯 El significado gana' : semOk && kwOk ? 'Las dos aciertan' : !semOk && kwOk ? '⚠️ Aquí falla la semántica' : '⚠️ Las dos fallan'} color={semOk ? colors.green : colors.rose}>
        {semOk && !kwOk ? <>La búsqueda por palabras se fija en que coincidan términos exactos; la semántica entiende que el texto trata del mismo tema aunque use otras palabras.</> : !semOk ? <>Ningún método es perfecto: este embedding de juguete no separa bien dos temas parecidos. En un sistema real se combinan ambos (búsqueda <T v="small" bold>híbrida</T>) y se añade un <T v="small" bold>reordenador</T>.</> : <>Cuando las palabras coinciden, ambas funcionan; la ventaja de los embeddings aparece cuando se reformula la pregunta.</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── búsqueda aproximada: celdas de un índice IVF ─────────────────────────

export function AnnDemo() {
  const pts = useMemo(() => cloud(), []);
  const km = useMemo(() => kmeans2(pts, 6), [pts]);
  const [nprobe, setNprobe] = useState(1);
  const [qx, setQx] = useState(0.5);
  const [qy, setQy] = useState(0.62);
  const k = 8;
  const res = useMemo(() => annSearch(pts, km, { x: qx, y: qy }, k, nprobe), [pts, km, qx, qy, nprobe]);
  const pal = palette();
  const W = 280;
  const H = 230;
  const X = (v: number): number => 8 + v * (W - 16);
  const Y = (v: number): number => H - 8 - v * (H - 16);
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill="none" stroke={colors.line} />
        {pts.map((p, i) => {
          const searched = res.searchedCells.includes(km.label[i]);
          const exact = res.exact.includes(i);
          const found = res.found.includes(i);
          return (
            <Circle key={i} cx={X(p.x)} cy={Y(p.y)} r={exact ? 5.5 : 3.2} fill={pal[km.label[i] % pal.length]} opacity={searched ? 1 : 0.2} stroke={exact ? (found ? colors.green : colors.rose) : 'none'} strokeWidth={exact ? 2.5 : 0} />
          );
        })}
        {km.centers.map((c, j) => <Rect key={j} x={X(c.x) - 5} y={Y(c.y) - 5} width={10} height={10} fill={pal[j % pal.length]} stroke={colors.text} strokeWidth={res.searchedCells.includes(j) ? 2.5 : 1} />)}
        <Polygon points={`${X(qx)},${Y(qy) - 10} ${X(qx) + 9},${Y(qy) + 7} ${X(qx) - 9},${Y(qy) + 7}`} fill={colors.amber} stroke={colors.text} strokeWidth={2} />
      </Svg>
      <Stepper label="Celdas que se miran (nprobe)" value={nprobe} min={1} max={6} onChange={setNprobe} />
      <Stepper label="Consulta · x" value={qx} min={0.05} max={0.95} step={0.05} onChange={(v) => setQx(Math.round(v * 100) / 100)} />
      <Stepper label="Consulta · y" value={qy} min={0.05} max={0.95} step={0.05} onChange={(v) => setQy(Math.round(v * 100) / 100)} />
      <Meter label={`Exhaustividad (recall@${k})`} value={res.recall} color={res.recall >= 1 ? colors.green : res.recall >= 0.75 ? colors.amber : colors.rose} suffix={`${Math.round(res.recall * 100)} %`} />
      <Meter label="Comparaciones frente a la búsqueda exacta" value={res.comparisons / res.exactComparisons} color={colors.violet} suffix={`${res.comparisons} de ${res.exactComparisons}`} />
      <Explain k={`${nprobe}-${qx}-${qy}`} title={res.recall >= 1 ? '✅ Encontró todos los vecinos exactos' : '⚠️ Se escapó algún vecino'} color={res.recall >= 1 ? colors.green : colors.rose}>
        {res.recall >= 1 ? <>Los 8 vecinos más cercanos (círculos grandes) estaban en las celdas visitadas y solo se compararon {Math.round((res.comparisons / res.exactComparisons) * 100)} % de los puntos.</> : <>Los círculos grandes <T v="small" bold>rojos</T> son vecinos reales que están en una celda <T v="small" bold>no visitada</T> (apagada): sucede cuando la consulta cae cerca del borde entre dos celdas. Sube <T v="small" bold>nprobe</T> o mueve la consulta al centro de una celda.</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── chunking ─────────────────────────

const DOC =
  'POLÍTICA DE DEVOLUCIONES. Puedes devolver cualquier producto en un plazo de 30 días desde que lo recibes. El artículo debe estar sin usar y con su embalaje original. Para iniciar la devolución entra en tu cuenta y solicita la etiqueta. El reembolso se realiza en el mismo método de pago y tarda entre 5 y 7 días hábiles. Los productos personalizados y las tarjetas regalo no admiten devolución. Si el artículo llegó defectuoso, la devolución es gratuita y la recogemos nosotros en tu domicilio.';
const ANS_TEXT = 'tarda entre 5 y 7 días hábiles';
const ANS: [number, number] = [DOC.indexOf(ANS_TEXT), DOC.indexOf(ANS_TEXT) + ANS_TEXT.length];

export function ChunkingDemo() {
  const [size, setSize] = useState(160);
  const [overlap, setOverlap] = useState(0);
  const info = useMemo(() => chunkInfo(DOC.length, size, Math.min(overlap, size - 20), ANS), [size, overlap]);
  const pal = palette();
  const segs: { text: string; chunks: number[] }[] = [];
  for (let i = 0; i < DOC.length; i += 1) {
    const ch = info.ranges.map((r, n) => (r[0] <= i && i < r[1] ? n : -1)).filter((n) => n >= 0);
    const last = segs[segs.length - 1];
    if (last && last.chunks.join() === ch.join()) last.text += DOC[i];
    else segs.push({ text: DOC[i], chunks: ch });
  }
  return (
    <Frame>
      <T v="small" color={colors.text}>
        {segs.map((s, i) => {
          const hasAns = s.text.length > 0 && DOC.indexOf(s.text) !== -1;
          void hasAns;
          const col = s.chunks.length ? pal[s.chunks[0] % pal.length] : colors.faint;
          return <T key={i} v="small" color={s.chunks.length > 1 ? colors.text : col} style={{ backgroundColor: s.chunks.length > 1 ? colors.amber + '55' : col + '22' }}>{s.text}</T>;
        })}
      </T>
      <Stepper label="Tamaño del fragmento (caracteres)" value={size} min={60} max={420} step={20} onChange={setSize} />
      <Stepper label="Solape entre fragmentos" value={overlap} min={0} max={120} step={10} onChange={setOverlap} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`${info.ranges.length} fragmentos`} color={colors.violet} solid />
        <Pill text={info.cut ? 'respuesta PARTIDA' : `respuesta entera en ${info.complete.length} fragmento(s)`} color={info.cut ? colors.rose : colors.green} solid />
      </View>
      <Explain k={`${size}-${overlap}-${info.cut}`} title={info.cut ? '✂️ El corte cae en medio de la respuesta' : size > 300 ? '📚 Fragmentos grandes: poco precisos' : '✅ La respuesta cabe entera'} color={info.cut ? colors.rose : size > 300 ? colors.amber : colors.green}>
        {info.cut ? <>La frase «{ANS_TEXT}» queda dividida entre dos fragmentos y ninguno la contiene completa. El <T v="small" bold>solape</T> repite el final de un fragmento al principio del siguiente para que no pase.</> : size > 300 ? <>Con fragmentos grandes cabe la respuesta pero mezclada con mucho texto de otros temas: el embedding del fragmento queda «diluido» y es más difícil recuperarlo con precisión.</> : <>Fragmentos pequeños son precisos, pero si son demasiado cortos pierden contexto. Lo habitual: 200–800 caracteres con un solape del 10–20 %.</>}
      </Explain>
    </Frame>
  );
}
