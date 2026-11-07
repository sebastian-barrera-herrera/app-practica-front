/** Ilustraciones de la zona 11 del curso de IA: BPE, atención, bloque Transformer, muestreo, etapas de un LLM y ventana de contexto. */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import {
  CLAVES,
  CONSULTAS,
  CONVERSACION,
  ETAPAS,
  FRASE_ATENCION,
  PREGUNTA_ETAPAS,
  PRESETS_MODELO,
  SIGUIENTE,
  ajustarContexto,
  bpeEntrenar,
  bpeTokens,
  contarParametros,
  distribucion,
  entropiaBits,
  formatoParams,
  memoriaGB,
  muestrear,
  pesosAtencion,
  rng,
} from './iaLlmLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs, Toggle } from './iaui';

const palette = (): string[] => [colors.cyan, colors.amber, colors.rose, colors.green, colors.violet, colors.mint];
const mostrar = (s: string): string => s.replace('</w>', '·');

// ───────────────────────── BPE ─────────────────────────

const BPE_PALABRAS: [string, number][] = [['bajo', 4], ['baja', 3], ['bajar', 2], ['subo', 2], ['subir', 2]];

export function BpeDemo() {
  const pasos = useMemo(() => bpeEntrenar(BPE_PALABRAS, 8), []);
  const [n, setN] = useState(0);
  const [prueba, setPrueba] = useState('bajista');
  const merges = pasos.slice(0, n).map((p) => p.par);
  const paso = n > 0 ? pasos[n - 1] : null;
  const palabras = n > 0 ? pasos[n - 1].palabras : BPE_PALABRAS.map(([w, f]) => ({ simbolos: [...w, '</w>'], n: f }));
  const siguiente = pasos[n];
  const pal = palette();
  const colorDe = (s: string): string => {
    const idx = pasos.findIndex((p) => p.nuevo === s);
    return idx >= 0 && idx < n ? pal[idx % pal.length] : colors.faint;
  };
  const toks = bpeTokens(prueba, merges);
  return (
    <Frame>
      <Stepper label="Fusiones aplicadas" value={n} min={0} max={pasos.length} onChange={setN} />
      <View style={{ gap: 6 }}>
        {palabras.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 11 }} color={colors.dim}>×{p.n}</T>
            {p.simbolos.map((s, j) => (
              <View key={j} style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, borderColor: colorDe(s), backgroundColor: colorDe(s) + '26' }}>
                <T style={{ fontFamily: fonts.mono, fontSize: 13 }} color={colors.text}>{mostrar(s)}</T>
              </View>
            ))}
          </View>
        ))}
      </View>
      {paso ? <Pill text={`fusión ${n}: ${mostrar(paso.par[0])} + ${mostrar(paso.par[1])} → ${mostrar(paso.nuevo)} (${paso.veces} veces)`} color={colors.green} solid /> : <Pill text="solo caracteres sueltos" color={colors.faint} />}
      {siguiente ? (
        <Explain k={n} title="Siguiente par más frecuente" color={colors.violet}>
          {siguiente.cuentas.slice(0, 3).map((c, i) => `${mostrar(c.par[0])}+${mostrar(c.par[1])}: ${c.veces}${i < 2 ? ' · ' : ''}`)}. Gana el que más se repite (si empatan, el primero alfabéticamente); se fusiona en <T v="small" bold>todas</T> las palabras y empieza otra ronda.
        </Explain>
      ) : (
        <Explain k="fin" title="Sin más pares repetidos" color={colors.green}>Ningún par aparece 2 veces o más: el entrenamiento termina. Cuantas más fusiones, más palabras caben en un solo token y menos tokens cuesta cada texto.</Explain>
      )}
      <Tabs items={['bajo', 'bajista', 'subir', 'sube'].map((w) => ({ id: w, label: w }))} value={prueba} onChange={setPrueba} color={colors.cyan} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <T v="tiny" color={colors.dim}>«{prueba}» con {n} fusiones →</T>
        {toks.map((t, i) => <Pill key={i} text={mostrar(t)} color={colors.cyan} />)}
      </View>
      <Callout color={colors.violet}>Una palabra que el tokenizador nunca vio no falla: se parte en piezas conocidas (hasta caracteres sueltos). Por eso un LLM puede leer cualquier texto, aunque «cuesta» más tokens lo raro.</Callout>
    </Frame>
  );
}

// ───────────────────────── atención ─────────────────────────

export function AttentionDemo() {
  const [foco, setFoco] = useState(7);
  const [escalar, setEscalar] = useState(true);
  const [causal, setCausal] = useState(false);
  const W = useMemo(() => pesosAtencion(CONSULTAS, CLAVES, escalar, causal), [escalar, causal]);
  const fila = W[foco];
  const top = fila.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  return (
    <Frame>
      <T v="tiny" color={colors.dim}>Toca una palabra: ¿a qué otras palabras mira?</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {FRASE_ATENCION.map((w, i) => {
          const on = i === foco;
          const a = fila[i];
          return (
            <Pressable key={i} accessibilityRole="button" accessibilityLabel={w} onPress={() => { tap(); setFoco(i); }} style={{ paddingHorizontal: 9, paddingVertical: 7, minHeight: 40, borderRadius: radius.sm, borderWidth: on ? 2 : 1, borderColor: on ? colors.amber : colors.line, backgroundColor: colors.cyan + Math.round(18 + a * 200).toString(16).padStart(2, '0') }}>
              <T style={{ fontFamily: on ? fonts.monoBold : fonts.mono, fontSize: 13 }} color={colors.text}>{w}</T>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 5 }}>
        {FRASE_ATENCION.map((w, i) => (
          <Meter key={i} label={w} value={fila[i]} color={i === top[0].i ? colors.green : colors.cyan} suffix={causal && i > foco ? 'oculta' : `${Math.round(fila[i] * 100)} %`} />
        ))}
      </View>
      <Toggle label="Dividir por √d (escalar)" on={escalar} set={setEscalar} hint="Sin escalar, los productos grandes dejan una atención casi de «todo o nada»" />
      <Toggle label="Máscara causal (no ver el futuro)" on={causal} set={setCausal} hint="Así generan texto los modelos tipo GPT: cada palabra solo mira hacia atrás" />
      <Explain k={`${foco}-${escalar}-${causal}`} title={`«${FRASE_ATENCION[foco]}» mira sobre todo a «${FRASE_ATENCION[top[0].i]}»`} color={colors.amber}>
        La fila suma 100 %. La consulta de «{FRASE_ATENCION[foco]}» encaja con las claves de las demás palabras y el <T v="small" bold>softmax</T> reparte la atención. Prueba con «estaba»: encuentra a su sujeto aunque esté varias palabras atrás.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── bloque Transformer ─────────────────────────

const PARTES: { id: string; nombre: string; forma: string; color: string; texto: string }[] = [
  { id: 'emb', nombre: 'Embedding + posición', forma: '(T) → (T, d)', color: colors.cyan, texto: 'Cada token se convierte en un vector de d números (tabla de embeddings) y se le suma una señal de su posición, porque la atención por sí sola no sabe el orden.' },
  { id: 'ln1', nombre: 'Normalización', forma: '(T, d)', color: colors.faint, texto: 'LayerNorm: reescala cada vector a media 0 y varianza 1. Estabiliza el entrenamiento de redes muy profundas.' },
  { id: 'att', nombre: 'Atención multi-cabeza', forma: '(T, d) → (T, d)', color: colors.amber, texto: 'Varias «cabezas» de atención en paralelo, cada una mirando un tipo de relación (sujeto, tiempo verbal, correferencia…). Se concatenan y se mezclan con una matriz Wo.' },
  { id: 'res1', nombre: '+ Conexión residual', forma: 'x + atención(x)', color: colors.green, texto: 'La entrada se suma a la salida de la subcapa. El gradiente tiene un «atajo» hasta las primeras capas: sin esto, apilar 80 bloques sería imposible de entrenar.' },
  { id: 'mlp', nombre: 'Red por posición (MLP)', forma: '(T, d) → (T, 4d) → (T, d)', color: colors.rose, texto: 'Dos capas densas con una activación entre medias, aplicadas a cada posición por separado. Ahí vive buena parte del «conocimiento» (hechos) del modelo: unos dos tercios de los parámetros.' },
  { id: 'res2', nombre: '+ Conexión residual', forma: 'x + mlp(x)', color: colors.green, texto: 'Otra suma de atajo. El bloque completo mantiene la forma (T, d), así que se puede repetir L veces.' },
  { id: 'out', nombre: 'Salida: logits', forma: '(T, d) → (T, vocab)', color: colors.violet, texto: 'Tras L bloques, una capa lineal da una puntuación (logit) por cada token del vocabulario; el softmax las convierte en probabilidades del siguiente token.' },
];

export function TransformerDemo() {
  const [vista, setVista] = useState<'bloque' | 'tamano'>('bloque');
  const [sel, setSel] = useState('att');
  const [preset, setPreset] = useState('7b');
  const base = PRESETS_MODELO.find((p) => p.id === preset)!.p;
  const [d, setD] = useState(base.d);
  const [capas, setCapas] = useState(base.capas);
  const elegir = (id: string) => {
    const p = PRESETS_MODELO.find((x) => x.id === id)!.p;
    setPreset(id);
    setD(p.d);
    setCapas(p.capas);
  };
  const desglose = contarParametros({ d, capas, vocab: base.vocab });
  const parte = PARTES.find((p) => p.id === sel)!;
  return (
    <Frame>
      <Tabs items={[{ id: 'bloque' as const, label: 'Anatomía' }, { id: 'tamano' as const, label: 'Tamaño' }]} value={vista} onChange={setVista} color={colors.violet} />
      {vista === 'bloque' ? (
        <>
          <View style={{ gap: 5 }}>
            {PARTES.map((p) => {
              const on = p.id === sel;
              return (
                <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.nombre} onPress={() => { tap(); setSel(p.id); }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: on ? 2 : 1, borderColor: p.color, backgroundColor: p.color + (on ? '40' : '18') }}>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>{p.nombre}</T>
                  </View>
                  <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim}>{p.forma}</T>
                </Pressable>
              );
            })}
          </View>
          <Explain k={sel} title={parte.nombre} color={parte.color}>{parte.texto}</Explain>
          <Callout color={colors.violet}>El bloque del medio (normalización → atención → suma → normalización → MLP → suma) se <T v="small" bold>repite L veces</T>: 12 en GPT-2 pequeño, decenas en los modelos grandes.</Callout>
        </>
      ) : (
        <>
          <Tabs items={PRESETS_MODELO.map((p) => ({ id: p.id, label: p.nombre }))} value={preset} onChange={elegir} color={colors.cyan} />
          <Stepper label="Anchura d (tamaño del vector)" value={d} min={256} max={12288} step={256} onChange={setD} />
          <Stepper label="Capas (bloques)" value={capas} min={2} max={120} step={2} onChange={setCapas} />
          <Pill text={`${formatoParams(desglose.total)} de parámetros`} color={colors.green} solid size={13} />
          <Meter label="Atención (4·d² por capa)" value={(desglose.porCapaAtencion * capas) / desglose.total} color={colors.amber} />
          <Meter label="MLP (8·d² por capa)" value={(desglose.porCapaMlp * capas) / desglose.total} color={colors.rose} />
          <Meter label="Tabla de embeddings (vocabulario × d)" value={desglose.embeddings / desglose.total} color={colors.cyan} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pill text={`float16: ${memoriaGB(desglose.total, 2).toFixed(1)} GB`} color={colors.violet} />
            <Pill text={`4 bits: ${memoriaGB(desglose.total, 0.5).toFixed(1)} GB`} color={colors.mint} />
          </View>
          <Callout color={colors.violet}>Casi todo el tamaño sale de <T v="small" bold>d² × capas</T>: duplicar la anchura cuadruplica los parámetros. Para <T v="small" bold>usar</T> el modelo hay que cargar todos los pesos en memoria; por eso se «cuantizan» a 8 o 4 bits.</Callout>
        </>
      )}
    </Frame>
  );
}

// ───────────────────────── muestreo ─────────────────────────

const LOGITS = SIGUIENTE.map((c) => c.logit);

export function SamplingDemo() {
  const [temp, setTemp] = useState(1);
  const [k, setK] = useState(8);
  const [p, setP] = useState(1);
  const [semilla, setSemilla] = useState(0);
  const m = useMemo(() => distribucion(LOGITS, temp, k, p), [temp, k, p]);
  const cuentas = useMemo(() => {
    if (semilla === 0) return null;
    const r = rng(semilla);
    const c = SIGUIENTE.map(() => 0);
    for (let i = 0; i < 20; i += 1) c[muestrear(m.final, r())] += 1;
    return c;
  }, [semilla, m]);
  const vivas = m.conserva.filter(Boolean).length;
  return (
    <Frame>
      <T v="tiny" color={colors.dim}>«El gato se sentó en el ___»</T>
      <View style={{ gap: 5 }}>
        {SIGUIENTE.map((c, i) => (
          <View key={c.token} style={{ gap: 2, opacity: m.conserva[i] ? 1 : 0.35 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={{ fontFamily: m.conserva[i] ? fonts.monoBold : fonts.mono, fontSize: 12 }} color={colors.text}>{c.token}{cuentas ? `  ×${cuentas[i]}` : ''}</T>
              <T style={{ fontFamily: fonts.mono, fontSize: 11.5 }} color={colors.dim}>{(m.final[i] * 100).toFixed(1)} %</T>
            </View>
            <View style={{ height: 9, borderRadius: 5, backgroundColor: colors.line, overflow: 'hidden' }}>
              <View style={{ width: `${m.final[i] * 100}%`, height: '100%', backgroundColor: m.conserva[i] ? colors.cyan : colors.faint }} />
            </View>
          </View>
        ))}
      </View>
      <Stepper label="Temperatura" value={Math.round(temp * 10) / 10} min={0} max={2.5} step={0.1} onChange={(v) => setTemp(Math.round(v * 10) / 10)} />
      <Stepper label="top-k (candidatas máximas)" value={k} min={1} max={8} onChange={setK} />
      <Stepper label="top-p (masa acumulada)" value={Math.round(p * 100) / 100} min={0.1} max={1} step={0.1} onChange={(v) => setP(Math.round(v * 10) / 10)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Pill text={`${vivas} candidatas vivas`} color={colors.violet} />
        <Pill text={`entropía ${entropiaBits(m.final).toFixed(2)} bits`} color={colors.amber} />
        <Pressable accessibilityRole="button" accessibilityLabel="Tirar 20 veces" onPress={() => { tap(); setSemilla((s) => s + 1); }} style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.green }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color="#04120D">🎲 Tirar 20 veces</T>
        </Pressable>
      </View>
      <Explain k={`${temp}-${k}-${p}`} title={temp <= 0.05 ? 'Voraz (greedy)' : temp < 0.7 ? 'Temperatura baja: previsible' : temp > 1.4 ? 'Temperatura alta: creativo y arriesgado' : 'Temperatura media'} color={colors.green}>
        {temp <= 0.05 ? 'Elige siempre la palabra más probable: mismo resultado cada vez, pero a veces repetitivo.' : <>La temperatura divide los logits antes del softmax: <T v="small" bold>baja</T> afila la distribución, <T v="small" bold>alta</T> la aplana. <T v="small" bold>top-k</T> y <T v="small" bold>top-p</T> recortan las candidatas absurdas (como «cohete») antes de tirar el dado.</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── etapas de un LLM ─────────────────────────

export function LlmStagesDemo() {
  const [sel, setSel] = useState('pre');
  const idx = ETAPAS.findIndex((e) => e.id === sel);
  const e = ETAPAS[idx];
  return (
    <Frame>
      <View style={{ gap: 5 }}>
        {ETAPAS.map((x, i) => {
          const on = x.id === sel;
          const c = i <= idx ? colors.green : colors.faint;
          return (
            <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={x.titulo} onPress={() => { tap(); setSel(x.id); }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: on ? 2 : 1, borderColor: c, backgroundColor: c + (on ? '33' : '14') }}>
              <T style={{ fontSize: 20, lineHeight: 26 }}>{x.emoji}</T>
              <T style={{ fontFamily: on ? fonts.monoBold : fonts.mono, fontSize: 12.5, flex: 1 }} color={colors.text}>{i + 1}. {x.titulo}</T>
            </Pressable>
          );
        })}
      </View>
      <Explain k={sel} title={e.titulo} color={colors.violet}>{e.idea}</Explain>
      <View style={{ gap: 4 }}>
        <T v="small" color={colors.text}><T v="small" bold>Datos:</T> {e.datos}</T>
        <T v="small" color={colors.text}><T v="small" bold>Coste:</T> {e.coste}</T>
      </View>
      <View style={{ gap: 4, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }}>
        <T v="tiny" color={colors.dim}>Ejemplo ilustrativo · pregunta: «{PREGUNTA_ETAPAS}»</T>
        <T style={{ fontFamily: fonts.mono, fontSize: 12.5 }} color={colors.text}>{e.salida}</T>
      </View>
      <Callout color={colors.violet}>El preentrenamiento da <T v="small" bold>saber</T>; el ajuste con instrucciones y la alineación dan <T v="small" bold>modales</T>. Un modelo base no es un asistente: solo continúa texto.</Callout>
    </Frame>
  );
}

// ───────────────────────── ventana de contexto ─────────────────────────

const ROL: Record<string, { c: string; t: string }> = { system: { c: colors.violet, t: 'system' }, user: { c: colors.cyan, t: 'usuario' }, assistant: { c: colors.green, t: 'asistente' } };

export function ContextDemo() {
  const [ventana, setVentana] = useState(150);
  const [reserva, setReserva] = useState(30);
  const r = useMemo(() => ajustarContexto(CONVERSACION, ventana, reserva), [ventana, reserva]);
  return (
    <Frame>
      <Stepper label="Ventana de contexto" value={ventana} min={60} max={300} step={10} unit="tokens" onChange={setVentana} />
      <Stepper label="Reservado para la respuesta" value={reserva} min={0} max={100} step={10} unit="tokens" onChange={setReserva} />
      <View style={{ gap: 5 }}>
        {CONVERSACION.map((m, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', opacity: r.dentro[i] ? 1 : 0.3, padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: r.dentro[i] ? ROL[m.rol].c : colors.line, backgroundColor: ROL[m.rol].c + '14' }}>
            <View style={{ width: 62 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 10.5 }} color={ROL[m.rol].c}>{ROL[m.rol].t}</T>
              <T style={{ fontFamily: fonts.mono, fontSize: 10.5 }} color={colors.dim}>{m.tokens} tok</T>
            </View>
            <T v="small" color={colors.text} style={{ flex: 1, textDecorationLine: r.dentro[i] ? 'none' : 'line-through' }}>{m.texto}</T>
          </View>
        ))}
      </View>
      <Meter label="Contexto usado" value={r.usados / ventana} color={r.olvidados ? colors.amber : colors.green} suffix={`${r.usados} / ${ventana}`} />
      <Pill text={r.olvidados ? `${r.olvidados} mensaje(s) olvidados` : 'todo cabe'} color={r.olvidados ? colors.rose : colors.green} solid />
      <Callout color={colors.violet}>{r.olvidados ? <>El modelo <T v="small" bold>no recuerda</T> lo que queda fuera: si preguntas «¿y cuánto tarda el reembolso?» sin que figure la devolución de antes, no sabrá de qué hablas. Se suele conservar el mensaje del sistema y resumir lo viejo.</> : <>Todo el historial cabe, y aún sobran tokens para la respuesta. Los modelos reales tienen ventanas de decenas o cientos de miles de tokens, pero cada token cuesta y cuanto más largo el contexto, más se diluye la información útil.</>}</Callout>
    </Frame>
  );
}
