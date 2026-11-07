/** Ilustraciones de la zona 13 del curso de IA: tubería RAG, troceado, recuperación, laboratorio de respuestas y evaluación. */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { RAG_EVAL, RAG_LAB, RAG_PIPE, RAG_TROCEADO } from './iaRagData';
import { METODOS, filasMetodo, laboratorio, metricasMetodo, resumenEval, type Contexto, type MetodoRag, type SistemaRag } from './iaRagLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs, Toggle } from './iaui';

const Caja = ({ titulo, color, children }: { titulo: string; color: string; children: React.ReactNode }) => (
  <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: color, backgroundColor: color + '14', gap: 3 }}>
    <T style={{ fontFamily: fonts.monoBold, fontSize: 10.5 }} color={color}>{titulo}</T>
    {children}
  </View>
);

// ───────────────────────── tubería ─────────────────────────

const ETAPAS = [
  { t: '1 · Indexar (offline)', c: colors.violet, texto: 'Se divide el manual en fragmentos, se calcula el embedding de cada uno y se guardan con su origen en una base vectorial. Se hace una vez y se actualiza cuando cambian los documentos.' },
  { t: '2 · Embedding de la pregunta', c: colors.cyan, texto: 'La pregunta del usuario se convierte en un vector con el MISMO modelo de embeddings que los fragmentos.' },
  { t: '3 · Recuperar', c: colors.amber, texto: 'Se buscan los k fragmentos más cercanos (a menudo mezclando búsqueda vectorial y por palabras). Lo que no se recupera, el modelo no lo ve.' },
  { t: '4 · Construir el prompt', c: colors.rose, texto: 'Se monta el mensaje: fragmentos numerados como fuentes, la pregunta y las reglas (responde solo con el contexto, cita, di «No lo sé»).' },
  { t: '5 · Generar', c: colors.green, texto: 'El LLM redacta la respuesta usando el contexto. Con las instrucciones adecuadas cita las fuentes y se abstiene si no hay base.' },
];

export function RagPipelineDemo() {
  const [q, setQ] = useState('0');
  const [paso, setPaso] = useState(1);
  const p = RAG_PIPE[Number(q)];
  const e = ETAPAS[paso - 1];
  return (
    <Frame>
      <Tabs items={RAG_PIPE.map((x, i) => ({ id: String(i), label: i === 2 ? 'Fuera de tema' : `Pregunta ${i + 1}` }))} value={q} onChange={setQ} color={colors.cyan} />
      <T v="small" color={colors.text} bold>«{p.q}»</T>
      <Stepper label="Etapa" value={paso} min={1} max={5} onChange={setPaso} />
      <Explain k={paso} title={e.t} color={e.c}>{e.texto}</Explain>
      {paso === 2 ? <Caja titulo="VECTOR DE LA PREGUNTA" color={colors.cyan}><T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.text}>[0.04, −0.11, 0.31, … 128 números de longitud 1]</T></Caja> : null}
      {paso === 3 ? (
        <Caja titulo="FRAGMENTOS RECUPERADOS" color={colors.amber}>
          {p.trozos.map((t, i) => <T key={i} v="small" color={colors.text}>[{i + 1}] <T v="tiny" color={colors.dim}>({p.secs[i]})</T> {t}</T>)}
        </Caja>
      ) : null}
      {paso === 4 ? <Caja titulo="PROMPT FINAL" color={colors.rose}><T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.text}>{p.prompt}</T></Caja> : null}
      {paso === 5 ? <Caja titulo="RESPUESTA" color={colors.green}><T v="small" color={colors.text}>{p.resp}</T></Caja> : null}
      {paso === 1 ? <Caja titulo="BASE VECTORIAL" color={colors.violet}><T v="small" color={colors.text}>26 fragmentos de 2 frases, cada uno con su sección de origen (para poder citar).</T></Caja> : null}
      <Callout color={colors.violet}>Dos fallos distintos: si la <T v="small" bold>recuperación</T> trae el fragmento equivocado, el mejor modelo del mundo responderá mal; si la recuperación acierta pero la <T v="small" bold>generación</T> ignora el contexto, también. Hay que medir las dos partes por separado.</Callout>
    </Frame>
  );
}

// ───────────────────────── troceado ─────────────────────────

export function RagChunksDemo() {
  const [i, setI] = useState(1);
  const g = RAG_TROCEADO[i];
  return (
    <Frame>
      <Tabs items={RAG_TROCEADO.map((x, k) => ({ id: String(k), label: `${x.n} frase${x.n > 1 ? 's' : ''}${x.solape ? ` +${x.solape}` : ''}` }))} value={String(i)} onChange={(v) => setI(Number(v))} color={colors.violet} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`${g.trozos} fragmentos`} color={colors.violet} solid />
        <Pill text={`≈ ${g.caracteres} caracteres`} color={colors.cyan} />
        <Pill text={`solape ${g.solape}`} color={colors.faint} />
      </View>
      <Caja titulo="EJEMPLO DE FRAGMENTO" color={colors.violet}><T v="small" color={colors.text}>{g.ejemplo}</T></Caja>
      <Meter label="El fragmento correcto es el 1º (hit@1)" value={g.hit1} color={g.hit1 >= 0.85 ? colors.green : colors.amber} />
      <Meter label="Está entre los 3 primeros (hit@3)" value={g.hit3} color={g.hit3 >= 0.9 ? colors.green : colors.amber} />
      <Explain k={i} title={g.n === 1 ? 'Fragmentos muy pequeños' : g.n >= 6 ? 'Fragmentos grandes' : 'Un punto intermedio'} color={colors.amber}>
        {g.n === 1 ? 'Muchos fragmentos de una frase: precisos, pero pierden el contexto («tarda entre 5 y 7 días» sin saber de qué) y multiplican el índice.' : g.n >= 6 ? 'Un fragmento por sección: cabe todo, pero el embedding mezcla varios temas y el primer puesto se vuelve menos fiable (baja el hit@1).' : 'Unas pocas frases por fragmento y algo de solape suelen dar el mejor equilibrio entre precisión y contexto. Aquí el efecto es pequeño porque el manual es corto: con documentos reales se nota mucho más.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── recuperación ─────────────────────────

export function RagRetrievalDemo() {
  const [m, setM] = useState<MetodoRag>('vector');
  const [fallos, setFallos] = useState(true);
  const met = metricasMetodo(m);
  const filas = filasMetodo(m, fallos);
  return (
    <Frame>
      <Tabs items={METODOS.map((x) => ({ id: x.id, label: x.label }))} value={m} onChange={setM} color={colors.amber} />
      <Explain k={m} title={METODOS.find((x) => x.id === m)!.label} color={colors.amber}>{METODOS.find((x) => x.id === m)!.idea}</Explain>
      <Meter label="hit@1" value={met.hit1} color={colors.cyan} />
      <Meter label="hit@3" value={met.hit3} color={colors.green} />
      <Meter label="MRR" value={met.mrr} color={colors.violet} />
      <Toggle label="Mostrar solo las preguntas que fallan en el primer puesto" on={fallos} set={setFallos} />
      <View style={{ gap: 5 }}>
        {filas.map((f) => (
          <View key={f.q} style={{ gap: 2, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <T v="tiny" color={colors.text}>{f.q}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {f.secs.map((s, i) => <Pill key={i} text={`${i + 1}. ${s}`} color={s === f.esp ? colors.green : colors.faint} solid={s === f.esp} size={10.5} />)}
              {f.pos === 0 ? <Pill text="✗ no aparece" color={colors.rose} size={10.5} /> : null}
            </View>
          </View>
        ))}
        {filas.length === 0 ? <T v="small" color={colors.green}>Todas aciertan en el primer puesto.</T> : null}
      </View>
    </Frame>
  );
}

// ───────────────────────── laboratorio de respuestas ─────────────────────────

const COLOR_VEREDICTO = { correcta: colors.green, abstencion: colors.cyan, inventa: colors.rose, inyectada: colors.rose };
const TEXTO_VEREDICTO = { correcta: '✓ Respuesta fundada en el contexto', abstencion: '✓ Se abstiene: no hay base', inventa: '✗ Inventa o usa lo que no toca', inyectada: '✗ Obedece una orden escondida en el documento' };

export function RagAnswerDemo() {
  const [ctx, setCtx] = useState<Contexto>('bueno');
  const [sis, setSis] = useState<SistemaRag>('ancla');
  const r = laboratorio(ctx, sis);
  const contexto = ctx === 'ninguno' ? '(sin contexto)' : RAG_LAB.contextos[ctx];
  return (
    <Frame>
      <T v="small" color={colors.text} bold>Pregunta: «{RAG_LAB.pregunta}»</T>
      <T v="tiny" color={colors.dim}>Contexto que recibe el modelo:</T>
      <Tabs items={[{ id: 'bueno' as Contexto, label: 'Bueno' }, { id: 'irrelevante' as Contexto, label: 'Irrelevante' }, { id: 'envenenado' as Contexto, label: 'Envenenado' }, { id: 'ninguno' as Contexto, label: 'Ninguno' }]} value={ctx} onChange={setCtx} color={colors.cyan} />
      <Caja titulo="CONTEXTO" color={colors.cyan}><T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.text}>{contexto}</T></Caja>
      <T v="tiny" color={colors.dim}>Instrucciones del prompt de sistema:</T>
      <Tabs items={[{ id: 'libre' as SistemaRag, label: 'Genéricas' }, { id: 'ancla' as SistemaRag, label: 'Solo con el contexto + citas' }, { id: 'defensa' as SistemaRag, label: '+ contexto = datos' }]} value={sis} onChange={setSis} color={colors.violet} />
      <Caja titulo="RESPUESTA" color={COLOR_VEREDICTO[r.veredicto]}>
        <T v="small" color={colors.text}>{r.respuesta}</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 11 }} color={COLOR_VEREDICTO[r.veredicto]}>{TEXTO_VEREDICTO[r.veredicto]}</T>
      </Caja>
      <Callout color={colors.violet}>Tres palancas a la vez: un <T v="small" bold>buen contexto</T> (recuperación), la orden de <T v="small" bold>responder solo con él y citar</T>, y la <T v="small" bold>defensa</T> que declara el contexto como datos. Sin la segunda el modelo rellena con lo que sabe (o inventa); sin la tercera, un documento manipulado puede darle órdenes.</Callout>
    </Frame>
  );
}

// ───────────────────────── evaluación ─────────────────────────

const COLOR_DIAG: Record<string, string> = { ok: colors.green, recuperación: colors.amber, generación: colors.rose, alucinación: colors.rose };

export function RagEvalDemo() {
  const [filtro, setFiltro] = useState<'todos' | 'fallos'>('fallos');
  const r = resumenEval();
  const filas = RAG_EVAL.filter((e) => (filtro === 'fallos' ? e.diag !== 'ok' : true));
  return (
    <Frame>
      <Meter label="Recuperación acertada (hit@3)" value={r.hit3} color={colors.cyan} />
      <Meter label="Respuestas correctas (19 preguntas del manual)" value={r.correctas} color={colors.green} />
      <Meter label="Fidelidad media (lo dicho está en el contexto)" value={r.fieles} color={colors.violet} />
      <Meter label="Se abstiene bien (4 preguntas ajenas)" value={r.abstencionesOk} color={colors.mint} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`fallos de recuperación: ${r.fallosRecuperacion}`} color={colors.amber} />
        <Pill text={`fallos de generación: ${r.fallosGeneracion}`} color={colors.rose} />
      </View>
      <Tabs items={[{ id: 'fallos' as const, label: 'Solo fallos' }, { id: 'todos' as const, label: 'Todos los casos' }]} value={filtro} onChange={setFiltro} color={colors.violet} />
      <View style={{ gap: 6 }}>
        {filas.map((e) => (
          <Pressable key={e.q} accessibilityRole="button" onPress={() => tap()} style={{ gap: 3, padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: COLOR_DIAG[e.diag] ?? colors.line, backgroundColor: (COLOR_DIAG[e.diag] ?? colors.line) + '12' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
              <T v="tiny" color={colors.text} style={{ flex: 1 }}>{e.q}</T>
              <Pill text={e.diag} color={COLOR_DIAG[e.diag] ?? colors.faint} solid size={10.5} />
            </View>
            <T v="tiny" color={colors.dim}>recuperó: {e.secs.join(', ')}{e.esp ? ` · esperada: ${e.esp}` : ' · (pregunta ajena)'}</T>
            <T v="tiny" color={colors.text}>{e.resp}</T>
          </Pressable>
        ))}
      </View>
      <Callout color={colors.violet}>Diagnóstico: si <T v="small" bold>no recuperó</T> la sección correcta, arregla el índice (troceado, embeddings, búsqueda híbrida); si <T v="small" bold>sí la recuperó</T> y aun así responde mal, arregla el prompt o el modelo. Cambiar el LLM cuando el fallo es de recuperación es dinero perdido.</Callout>
    </Frame>
  );
}
