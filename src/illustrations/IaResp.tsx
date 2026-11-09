/** Ilustraciones de la zona 15 del curso de IA: equidad, privacidad, intervalos de confianza, coste y puesta en producción. */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { BOOTSTRAP, JUEZ } from './iaRespData';
import { ETIQUETA_PII, REQUISITOS, USOS, costeMensual, detectar, enmascarar, metricasGrupos, nivelRiesgo, umbralParaTasa, type TipoPii } from './iaRespLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs, Toggle } from './iaui';

// ───────────────────────── equidad ─────────────────────────

export function FairnessDemo() {
  const [uA, setUA] = useState(0.5);
  const [uB, setUB] = useState(0.5);
  const m = useMemo(() => metricasGrupos(uA, uB), [uA, uB]);
  const ajustar = () => setUB(Math.round(umbralParaTasa(1, m.tasaA) * 100) / 100);
  const cumple = m.razon >= 0.8;
  return (
    <Frame>
      <T v="tiny" color={colors.dim}>Un modelo de créditos aprueba si su puntuación supera el umbral. Hay dos grupos con rentas históricas distintas.</T>
      <Stepper label="Umbral grupo A" value={uA} min={0.1} max={0.9} step={0.05} onChange={(v) => setUA(Math.round(v * 100) / 100)} />
      <Stepper label="Umbral grupo B" value={uB} min={0.1} max={0.9} step={0.05} onChange={(v) => setUB(Math.round(v * 100) / 100)} />
      <Meter label="Aprobados en A" value={m.tasaA} color={colors.cyan} />
      <Meter label="Aprobados en B" value={m.tasaB} color={colors.amber} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`razón de impacto ${m.razon.toFixed(2)}`} color={cumple ? colors.green : colors.rose} solid />
        <Pill text={`diferencia de aprobación ${(m.paridad * 100).toFixed(1)} pts`} color={Math.abs(m.paridad) < 0.05 ? colors.green : colors.amber} />
        <Pill text={`precisión ${(m.precision * 100).toFixed(1)} %`} color={colors.violet} />
      </View>
      <Meter label="Verdaderos positivos A (devuelven y los aprueba)" value={m.tprA} color={colors.cyan} />
      <Meter label="Verdaderos positivos B" value={m.tprB} color={colors.amber} />
      <Toggle label="Igualar la tasa de aprobación de B a la de A" on={Math.abs(m.paridad) < 0.01} set={(v) => (v ? ajustar() : setUB(uA))} hint="Busca el umbral de B que aprueba la misma fracción" />
      <Explain k={`${cumple}-${Math.abs(m.paridad) < 0.01}`} title={cumple ? 'Cumple la «regla de los cuatro quintos»' : 'Impacto dispar'} color={cumple ? colors.green : colors.rose}>
        {cumple ? 'La tasa de aprobación del grupo menos favorecido es al menos el 80 % de la del más favorecido. Fíjate en lo que ha pasado con la precisión y con los verdaderos positivos de cada grupo: no se pueden igualar todos los criterios a la vez.' : 'Con el mismo umbral, el grupo B recibe la mitad de aprobaciones. El modelo «solo mira la renta», pero la renta es un reflejo de desigualdades previas: usar variables neutrales no garantiza resultados neutrales.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── privacidad ─────────────────────────

const EJEMPLO = 'Marta Gil (marta@correo.example) llamó desde 612 345 678. DNI 12345678Z. Pagó con la tarjeta 4539 1488 0343 6467 el pedido PED-48213.';
const TIPOS: { id: TipoPii; label: string; color: string }[] = [
  { id: 'email', label: 'Correo', color: colors.cyan },
  { id: 'telefono', label: 'Teléfono', color: colors.amber },
  { id: 'dni', label: 'DNI', color: colors.rose },
  { id: 'tarjeta', label: 'Tarjeta (Luhn)', color: colors.violet },
];

export function PrivacyDemo() {
  const [activos, setActivos] = useState<TipoPii[]>(['email', 'telefono', 'dni', 'tarjeta']);
  const [oculto, setOculto] = useState(false);
  const hallazgos = detectar(EJEMPLO, activos);
  const partes: { t: string; tipo?: TipoPii }[] = [];
  let pos = 0;
  for (const h of hallazgos) {
    if (h.ini > pos) partes.push({ t: EJEMPLO.slice(pos, h.ini) });
    partes.push({ t: h.texto, tipo: h.tipo });
    pos = h.fin;
  }
  if (pos < EJEMPLO.length) partes.push({ t: EJEMPLO.slice(pos) });
  const alternar = (t: TipoPii) => setActivos((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));
  return (
    <Frame>
      <T v="tiny" color={colors.dim}>Registro de una conversación de soporte. Elige qué detectores aplicar:</T>
      <View style={{ gap: 6 }}>
        {TIPOS.map((t) => <Toggle key={t.id} label={t.label} on={activos.includes(t.id)} set={() => alternar(t.id)} />)}
      </View>
      <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }}>
        {oculto ? (
          <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.text}>{enmascarar(EJEMPLO, activos)}</T>
        ) : (
          <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.text}>
            {partes.map((p, i) => (p.tipo ? <T key={i} style={{ fontFamily: fonts.monoBold, fontSize: 12, backgroundColor: TIPOS.find((x) => x.id === p.tipo)!.color + '55' }} color={colors.text}>{p.t}</T> : p.t))}
          </T>
        )}
      </View>
      <Toggle label="Mostrar el texto enmascarado" on={oculto} set={setOculto} hint="Lo que se guardaría en los logs o se enviaría al modelo" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {hallazgos.map((h, i) => <Pill key={i} text={`${ETIQUETA_PII[h.tipo]} ${h.texto}`} color={TIPOS.find((x) => x.id === h.tipo)!.color} size={10.5} />)}
        {hallazgos.length === 0 ? <Pill text="sin datos personales detectados" color={colors.faint} /> : null}
      </View>
      <Callout color={colors.violet}>Una tarjeta no es «16 dígitos»: se confirma con el <T v="small" bold>algoritmo de Luhn</T> para no tapar números de pedido. Y los patrones nunca lo detectan todo (nombres, direcciones): <T v="small" bold>minimiza</T> qué datos entran en el sistema, <T v="small" bold>enmascara</T> antes de guardar o enviar a un tercero, y <T v="small" bold>borra</T> lo que ya no haga falta.</Callout>
    </Frame>
  );
}

// ───────────────────────── evaluación: intervalos y juez ─────────────────────────

export function EvalCiDemo() {
  const [i, setI] = useState(2);
  const b = BOOTSTRAP[i];
  return (
    <Frame>
      <T v="tiny" color={colors.dim}>La precisión «verdadera» de un sistema es 0,80. Mides con conjuntos de evaluación de distinto tamaño:</T>
      <Tabs items={BOOTSTRAP.map((x, k) => ({ id: String(k), label: `n=${x.n}` }))} value={String(i)} onChange={(v) => setI(Number(v))} color={colors.cyan} />
      <View style={{ height: 36, justifyContent: 'center' }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.line }} />
        <View style={{ position: 'absolute', left: `${b.bajo * 100}%`, width: `${(b.alto - b.bajo) * 100}%`, height: 14, borderRadius: 7, backgroundColor: colors.cyan + 'AA' }} />
        <View style={{ position: 'absolute', left: '80%', width: 2, height: 30, backgroundColor: colors.green }} />
        <View style={{ position: 'absolute', left: `${b.media * 100}%`, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber, marginLeft: -5 }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`medida ${(b.media * 100).toFixed(1)} %`} color={colors.amber} />
        <Pill text={`IC 95 %: ${(b.bajo * 100).toFixed(1)}–${(b.alto * 100).toFixed(1)} %`} color={colors.cyan} solid />
        <Pill text={`anchura ${((b.alto - b.bajo) * 100).toFixed(1)} pts`} color={colors.violet} />
      </View>
      <Explain k={i} title={b.n <= 20 ? 'Con tan pocos casos no puedes decidir' : b.n <= 100 ? 'Aún con mucha incertidumbre' : 'Ya es una medida fiable'} color={colors.green}>
        La línea verde es la verdad (80 %). Con {b.n} casos el intervalo mide {Math.round((b.alto - b.bajo) * 100)} puntos: dos prompts que difieran menos que eso <T v="small" bold>no se pueden distinguir</T>. El intervalo se estrecha con la raíz de n: para reducirlo a la mitad hay que cuadruplicar los casos.
      </Explain>
      <T v="tiny" color={colors.dim}>Cuidado con el juez automático: otro modelo puntúa respuestas (1–5) frente a la referencia, y tiene sesgos:</T>
      <View style={{ gap: 5 }}>
        {JUEZ.map((j) => (
          <View key={j.nombre} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <T v="tiny" color={colors.text} style={{ flex: 1 }}>{j.nombre} ({j.palabras} palabras)</T>
            <Pill text={j.nota.replace('Puntuación: ', '★ ')} color={j.nombre.includes('errónea') ? colors.rose : colors.green} solid />
          </View>
        ))}
      </View>
      <Callout color={colors.rose}>Mismo contenido, más palabras, <T v="small" bold>más nota</T>: el sesgo de verbosidad. Un juez LLM sirve para triaje, no como verdad: calíbralo con casos puntuados por personas.</Callout>
    </Frame>
  );
}

// ───────────────────────── coste ─────────────────────────

export function CostDemo() {
  const [peticiones, setPeticiones] = useState(100000);
  const [tokIn, setTokIn] = useState(1000);
  const [tokOut, setTokOut] = useState(300);
  const [cache, setCache] = useState(0);
  const [grande, setGrande] = useState(100);
  const base = costeMensual({ peticiones, tokIn, tokOut, cache: 0, grande: 1 });
  const r = costeMensual({ peticiones, tokIn, tokOut, cache: cache / 100, grande: grande / 100 });
  const ahorro = base.total === 0 ? 0 : 1 - r.total / base.total;
  return (
    <Frame>
      <Stepper label="Peticiones al mes" value={peticiones} min={10000} max={1000000} step={10000} onChange={setPeticiones} />
      <Stepper label="Tokens de entrada" value={tokIn} min={200} max={8000} step={200} onChange={setTokIn} />
      <Stepper label="Tokens de salida" value={tokOut} min={50} max={2000} step={50} onChange={setTokOut} />
      <Stepper label="Respuestas desde la caché" value={cache} min={0} max={80} step={10} unit="%" onChange={setCache} />
      <Stepper label="Peticiones al modelo grande" value={grande} min={0} max={100} step={10} unit="%" onChange={setGrande} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`${r.total.toLocaleString('es-ES', { maximumFractionDigits: 0 })} $ al mes`} color={colors.green} solid size={13} />
        <Pill text={`${(r.porPeticion * 1000).toFixed(3)} milésimas de $ por petición`} color={colors.violet} />
        <Pill text={`latencia media ≈ ${Math.round(r.latenciaMs)} ms`} color={colors.amber} />
      </View>
      <Meter label="Ahorro frente a usar siempre el modelo grande sin caché" value={Math.max(0, ahorro)} color={ahorro > 0.5 ? colors.green : colors.amber} />
      <Explain k={`${cache}-${grande}`} title={grande < 100 || cache > 0 ? 'Las tres palancas de coste' : 'Todo al modelo grande, sin caché'} color={colors.green}>
        <T v="small" bold>Enrutar</T> las preguntas fáciles al modelo pequeño, <T v="small" bold>cachear</T> las repetidas y <T v="small" bold>acortar</T> el prompt (menos tokens de entrada) suelen recortar la factura en un orden de magnitud sin perder calidad perceptible. Mide siempre la calidad al cambiar: el modelo barato no vale para todo.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── puesta en producción ─────────────────────────

const FASES = [
  { t: '1 · Diseñar', c: colors.cyan, texto: 'Define el objetivo, los usuarios, qué errores son aceptables y qué datos entran. Clasifica el riesgo del uso (¿decide sobre personas?).' },
  { t: '2 · Construir y evaluar', c: colors.violet, texto: 'Prompts, RAG, herramientas. Conjunto de evaluación con casos oscuros, pruebas de equidad, de inyección y de privacidad.' },
  { t: '3 · Lanzar con red', c: colors.amber, texto: 'Despliegue gradual (un % de usuarios), versiones de prompt y de modelo registradas, plan de reversión y supervisión humana definida.' },
  { t: '4 · Observar', c: colors.green, texto: 'Registra entradas (sin datos personales), salidas, herramientas, coste, latencia, fallos y reclamaciones. Alertas ante cambios de calidad.' },
  { t: '5 · Mejorar', c: colors.rose, texto: 'Los fallos reales vuelven al conjunto de pruebas. Cambios con prueba A/B y puerta de regresión; revisiones periódicas y retirada si ya no es adecuado.' },
];

export function OpsDemo() {
  const [vista, setVista] = useState<'ciclo' | 'lista' | 'riesgo'>('ciclo');
  const [fase, setFase] = useState(1);
  const [hecho, setHecho] = useState<string[]>([]);
  const [usos, setUsos] = useState<string[]>(['chatbot']);
  const nivel = nivelRiesgo(usos);
  const f = FASES[fase - 1];
  const alternar = (r: string) => setHecho((h) => (h.includes(r) ? h.filter((x) => x !== r) : [...h, r]));
  const alternarUso = (u: string) => setUsos((x) => (x.includes(u) ? x.filter((y) => y !== u) : [...x, u]));
  const colNivel = { prohibido: colors.rose, alto: colors.amber, limitado: colors.cyan, mínimo: colors.green }[nivel];
  return (
    <Frame>
      <Tabs items={[{ id: 'ciclo' as const, label: 'Ciclo de vida' }, { id: 'lista' as const, label: 'Lista de lanzamiento' }, { id: 'riesgo' as const, label: 'Nivel de riesgo' }]} value={vista} onChange={setVista} color={colors.violet} />
      {vista === 'ciclo' ? (
        <>
          <Stepper label="Fase" value={fase} min={1} max={FASES.length} onChange={setFase} />
          <View style={{ gap: 4 }}>
            {FASES.map((x, i) => (
              <View key={x.t} style={{ padding: 8, borderRadius: radius.sm, borderWidth: i + 1 === fase ? 2 : 1, borderColor: x.c, backgroundColor: x.c + (i + 1 === fase ? '33' : '14') }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{x.t}</T>
              </View>
            ))}
          </View>
          <Explain k={fase} title={f.t} color={f.c}>{f.texto}</Explain>
        </>
      ) : null}
      {vista === 'lista' ? (
        <>
          {REQUISITOS.map((r) => <Toggle key={r} label={r} on={hecho.includes(r)} set={() => alternar(r)} good="on" />)}
          <Meter label="Listo para lanzar" value={hecho.length / REQUISITOS.length} color={hecho.length === REQUISITOS.length ? colors.green : colors.amber} suffix={`${hecho.length}/${REQUISITOS.length}`} />
          <Callout color={hecho.length === REQUISITOS.length ? colors.green : colors.rose}>{hecho.length === REQUISITOS.length ? 'Puedes lanzar de forma gradual y con red.' : 'Faltan requisitos: lanzar sin ellos es apostar. Cada uno responde a un fallo real de sistemas que salieron a producción sin él.'}</Callout>
        </>
      ) : null}
      {vista === 'riesgo' ? (
        <>
          <T v="tiny" color={colors.dim}>Marca para qué se usa tu sistema (clasificación didáctica inspirada en el Reglamento europeo de IA; no es asesoramiento legal):</T>
          {USOS.map((u) => <Toggle key={u.id} label={u.label} on={usos.includes(u.id)} set={() => alternarUso(u.id)} />)}
          <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colNivel, backgroundColor: colNivel + '14' }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colNivel}>RIESGO {nivel.toUpperCase()}</T>
            <T v="small" color={colors.text}>{nivel === 'prohibido' ? 'Uso no permitido.' : nivel === 'alto' ? 'Exige evaluación de riesgos, calidad de datos, registro, supervisión humana y documentación técnica.' : nivel === 'limitado' ? 'Exige transparencia: avisar de que se habla con una IA o de que el contenido es generado.' : 'Sin obligaciones específicas; buenas prácticas voluntarias.'}</T>
          </View>
        </>
      ) : null}
    </Frame>
  );
}
