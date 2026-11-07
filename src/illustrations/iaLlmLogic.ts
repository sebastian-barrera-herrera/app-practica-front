/** Lógica pura de las ilustraciones de la zona 11 (tokens y BPE, atención, bloque Transformer, muestreo, etapas y contexto). Se prueba aparte. */

// ───────────────────────── BPE ─────────────────────────

export const FIN_PALABRA = '</w>';

export interface BpePalabra {
  simbolos: string[];
  n: number;
}

export interface BpePaso {
  par: [string, string];
  veces: number;
  nuevo: string;
  palabras: BpePalabra[];
  /** Pares con su frecuencia ANTES de fusionar, de mayor a menor. */
  cuentas: { par: [string, string]; veces: number }[];
}

const cmpPar = (a: [string, string], b: [string, string]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

export function fusionar(simbolos: string[], par: [string, string]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < simbolos.length) {
    if (i < simbolos.length - 1 && simbolos[i] === par[0] && simbolos[i + 1] === par[1]) {
      out.push(par[0] + par[1]);
      i += 2;
    } else {
      out.push(simbolos[i]);
      i += 1;
    }
  }
  return out;
}

export function bpeInicial(palabras: [string, number][]): BpePalabra[] {
  return palabras.map(([w, n]) => ({ simbolos: [...w, FIN_PALABRA], n }));
}

/** Mismo algoritmo que `BPETokenizer.entrenar` de dojo_ai: gana el par más frecuente (empate: el menor alfabéticamente); se para si ya nadie se repite. */
export function bpeEntrenar(palabras: [string, number][], numMerges: number): BpePaso[] {
  let actual = bpeInicial(palabras);
  const pasos: BpePaso[] = [];
  for (let m = 0; m < numMerges; m += 1) {
    const mapa = new Map<string, { par: [string, string]; veces: number }>();
    for (const p of actual) {
      for (let i = 0; i < p.simbolos.length - 1; i += 1) {
        const par: [string, string] = [p.simbolos[i], p.simbolos[i + 1]];
        const k = par[0] + '\u0000' + par[1];
        const e = mapa.get(k);
        if (e) e.veces += p.n;
        else mapa.set(k, { par, veces: p.n });
      }
    }
    const cuentas = [...mapa.values()].sort((a, b) => b.veces - a.veces || cmpPar(a.par, b.par));
    if (!cuentas.length || cuentas[0].veces < 2) break;
    const mejor = cuentas[0];
    actual = actual.map((p) => ({ simbolos: fusionar(p.simbolos, mejor.par), n: p.n }));
    pasos.push({ par: mejor.par, veces: mejor.veces, nuevo: mejor.par[0] + mejor.par[1], palabras: actual, cuentas: cuentas.slice(0, 5) });
  }
  return pasos;
}

/** Trocea una palabra nueva aplicando las fusiones aprendidas por orden. */
export function bpeTokens(palabra: string, merges: [string, string][]): string[] {
  let s = [...palabra, FIN_PALABRA];
  const rango = new Map(merges.map((m, i) => [m[0] + '\u0000' + m[1], i]));
  while (s.length > 1) {
    let mejor: { r: number; par: [string, string] } | null = null;
    for (let i = 0; i < s.length - 1; i += 1) {
      const r = rango.get(s[i] + '\u0000' + s[i + 1]);
      if (r !== undefined && (mejor === null || r < mejor.r)) mejor = { r, par: [s[i], s[i + 1]] };
    }
    if (!mejor) break;
    s = fusionar(s, mejor.par);
  }
  return s;
}

// ───────────────────────── atención ─────────────────────────

export function softmaxFila(x: number[]): number[] {
  const m = Math.max(...x.filter((v) => Number.isFinite(v)));
  const e = x.map((v) => (Number.isFinite(v) ? Math.exp(v - m) : 0));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export const FRASE_ATENCION = ['el', 'gato', 'no', 'cruzó', 'la', 'calle', 'porque', 'estaba', 'cansado'];

/** Lo que cada palabra «ofrece» (clave) en cuatro rasgos: ser vivo, lugar/cosa, acción, palabra función. */
export const CLAVES: number[][] = [
  [0, 0, 0, 1], // el
  [1, 0, 0, 0], // gato
  [0, 0, 0, 1], // no
  [0, 0, 1, 0], // cruzó
  [0, 0, 0, 1], // la
  [0, 1, 0, 0], // calle
  [0, 0, 0, 1], // porque
  [0, 0, 1, 0], // estaba
  [0.5, 0, 0.5, 0], // cansado
];

/** Lo que cada palabra «busca» (consulta), a mano para que el ejemplo se vea claro. */
export const CONSULTAS: number[][] = [
  [1.5, 1, 0, 0], // el: un nombre
  [0, 0, 2, 0], // gato: su verbo
  [0, 0, 2, 0], // no: su verbo
  [2.5, 2, 0, 0], // cruzó: quién cruza y qué cruza
  [0, 2, 0, 0], // la: un lugar
  [0, 0, 1.5, 0], // calle: acción
  [0, 0, 2, 0], // porque: una acción
  [3, 0, 0.6, 0], // estaba: su sujeto
  [3, 0, 0.8, 0], // cansado: quién está cansado
];

export function pesosAtencion(Q: number[][], K: number[][], escalar: boolean, causal: boolean): number[][] {
  const d = K[0].length;
  return Q.map((q, i) => {
    const pts = K.map((k, j) => {
      if (causal && j > i) return -Infinity;
      const dot = q.reduce((a, v, t) => a + v * k[t], 0);
      return escalar ? dot / Math.sqrt(d) : dot;
    });
    return softmaxFila(pts);
  });
}

export function salidaAtencion(W: number[][], V: number[][]): number[][] {
  return W.map((fila) => V[0].map((_, c) => fila.reduce((a, w, j) => a + w * V[j][c], 0)));
}

// ───────────────────────── bloque Transformer ─────────────────────────

export interface ParamsTransformer {
  d: number;
  capas: number;
  vocab: number;
  /** Multiplicador de la red por posición (clásico: 4). */
  ff?: number;
}

export interface DesgloseParams {
  porCapaAtencion: number;
  porCapaMlp: number;
  porCapa: number;
  embeddings: number;
  total: number;
}

/** Cuenta aproximada (sin sesgos ni normalizaciones): atención 4·d², MLP 2·ff·d² por capa, más la tabla de embeddings (compartida con la salida). */
export function contarParametros(p: ParamsTransformer): DesgloseParams {
  const ff = p.ff ?? 4;
  const porCapaAtencion = 4 * p.d * p.d;
  const porCapaMlp = 2 * ff * p.d * p.d;
  const porCapa = porCapaAtencion + porCapaMlp;
  const embeddings = p.vocab * p.d;
  return { porCapaAtencion, porCapaMlp, porCapa, embeddings, total: porCapa * p.capas + embeddings };
}

export function formatoParams(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' mil millones';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' millones';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' mil';
  return String(n);
}

/** Memoria (GB) solo para guardar los pesos con `bytes` por parámetro (4 = float32, 2 = float16, 1 = int8, 0.5 = 4 bits). */
export function memoriaGB(params: number, bytes: number): number {
  return (params * bytes) / 1e9;
}

export const PRESETS_MODELO: { id: string; nombre: string; p: ParamsTransformer }[] = [
  { id: 'gpt2', nombre: 'Pequeño (tipo GPT-2)', p: { d: 768, capas: 12, vocab: 50257 } },
  { id: '7b', nombre: 'Mediano (~7B)', p: { d: 4096, capas: 32, vocab: 32000 } },
  { id: '70b', nombre: 'Grande (~70B)', p: { d: 8192, capas: 80, vocab: 32000 } },
];

// ───────────────────────── muestreo ─────────────────────────

export interface Candidata {
  token: string;
  logit: number;
}

export const SIGUIENTE: Candidata[] = [
  { token: 'sofá', logit: 3.0 },
  { token: 'suelo', logit: 2.6 },
  { token: 'tejado', logit: 2.2 },
  { token: 'jardín', logit: 1.8 },
  { token: 'coche', logit: 0.9 },
  { token: 'ordenador', logit: 0.4 },
  { token: 'cohete', logit: -0.5 },
  { token: 'plátano', logit: -1.2 },
];

export interface Muestreo {
  /** Probabilidad tras softmax con temperatura. */
  base: number[];
  /** Probabilidad final tras top-k y top-p (renormalizada). */
  final: number[];
  conserva: boolean[];
}

export function distribucion(logits: number[], temperatura: number, topK: number, topP: number): Muestreo {
  if (temperatura <= 0.05) {
    const im = logits.indexOf(Math.max(...logits));
    const f = logits.map((_, i) => (i === im ? 1 : 0));
    return { base: f, final: f, conserva: f.map((v) => v > 0) };
  }
  const base = softmaxFila(logits.map((l) => l / temperatura));
  const orden = base.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p || a.i - b.i);
  const conserva = base.map(() => false);
  let acum = 0;
  for (let r = 0; r < orden.length; r += 1) {
    if (r >= topK) break;
    conserva[orden[r].i] = true;
    acum += orden[r].p;
    if (acum >= topP) break;
  }
  const suma = base.reduce((a, p, i) => a + (conserva[i] ? p : 0), 0);
  return { base, final: base.map((p, i) => (conserva[i] ? p / suma : 0)), conserva };
}

/** Generador pseudoaleatorio determinista (mulberry32) para que «tirar de nuevo» sea reproducible. */
export function rng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function muestrear(probs: number[], u: number): number {
  let acum = 0;
  for (let i = 0; i < probs.length; i += 1) {
    acum += probs[i];
    if (u < acum) return i;
  }
  for (let i = probs.length - 1; i >= 0; i -= 1) if (probs[i] > 0) return i;
  return probs.length - 1;
}

export function entropiaBits(p: number[]): number {
  return -p.reduce((a, v) => (v > 0 ? a + v * Math.log2(v) : a), 0);
}

// ───────────────────────── etapas de un LLM ─────────────────────────

export interface Etapa {
  id: string;
  titulo: string;
  emoji: string;
  idea: string;
  datos: string;
  coste: string;
  salida: string;
}

export const PREGUNTA_ETAPAS = '¿Cuál es la capital de Francia?';

export const ETAPAS: Etapa[] = [
  { id: 'datos', titulo: 'Recoger y limpiar datos', emoji: '🗂️', idea: 'Se reúnen billones de palabras de la web, libros, código y artículos, se filtra la basura, se quitan duplicados y datos personales.', datos: 'Billones de tokens (texto, código, a veces imágenes y audio)', coste: 'Mucho trabajo de ingeniería; la calidad pesa más que la cantidad', salida: 'Todavía no hay modelo: solo un gran conjunto de textos' },
  { id: 'pre', titulo: 'Preentrenamiento', emoji: '🧠', idea: 'La red aprende a predecir el siguiente token en todo ese texto. De ahí salen la gramática, los hechos y cierta capacidad de razonar.', datos: 'Todo el corpus, sin etiquetas: el texto es su propia solución', coste: 'Semanas o meses en miles de GPU: millones de euros', salida: '¿Cuál es la capital de Francia? ¿Cuál es la capital de Italia? ¿Cuál es la capital de…' },
  { id: 'sft', titulo: 'Ajuste fino con instrucciones (SFT)', emoji: '📝', idea: 'Se sigue entrenando con decenas de miles de pares «instrucción → buena respuesta» escritos por personas. Aprende el formato de un asistente.', datos: 'Miles o decenas de miles de ejemplos de calidad', coste: 'Horas o días en pocas GPU', salida: 'La capital de Francia es París.' },
  { id: 'rlhf', titulo: 'Alineación con preferencias (RLHF / DPO)', emoji: '👍', idea: 'Personas (o modelos) comparan dos respuestas y eligen la mejor. El modelo aprende a ser más útil, honesto y prudente, y a rechazar lo dañino.', datos: 'Cientos de miles de comparaciones «A es mejor que B»', coste: 'Parecido al ajuste fino, con más complejidad', salida: 'París. Si quieres, te cuento algo más sobre la ciudad.' },
  { id: 'uso', titulo: 'Uso: prompt, RAG, herramientas', emoji: '🚀', idea: 'Ya no se entrena: se guía con instrucciones (prompt), se le da información propia (RAG) y herramientas. Ajustes ligeros como LoRA si hace falta.', datos: 'Tus documentos, tus ejemplos, tus herramientas', coste: 'Pago por token o por servidor', salida: 'La respuesta, adaptada a tu producto y con tus datos' },
];

// ───────────────────────── ventana de contexto ─────────────────────────

export interface MensajeCtx {
  rol: 'system' | 'user' | 'assistant';
  texto: string;
  tokens: number;
}

export const CONVERSACION: MensajeCtx[] = [
  { rol: 'system', texto: 'Eres el asistente de DojoShop. Responde en español y con brevedad.', tokens: 38 },
  { rol: 'user', texto: 'Hola, quiero devolver unas zapatillas.', tokens: 24 },
  { rol: 'assistant', texto: 'Claro. ¿Cuántos días han pasado desde que las recibiste?', tokens: 36 },
  { rol: 'user', texto: 'Unos 12 días.', tokens: 9 },
  { rol: 'assistant', texto: 'Entonces estás dentro del plazo de 30 días. Entra en tu cuenta y solicita la etiqueta.', tokens: 47 },
  { rol: 'user', texto: '¿Y cuánto tarda el reembolso?', tokens: 20 },
];

export interface AjusteCtx {
  dentro: boolean[];
  usados: number;
  libre: number;
  olvidados: number;
}

/** Conserva el mensaje de sistema y los mensajes MÁS RECIENTES que quepan en `ventana − reserva` (la reserva es para la respuesta). */
export function ajustarContexto(msgs: MensajeCtx[], ventana: number, reserva: number): AjusteCtx {
  const presupuesto = ventana - reserva;
  const dentro = msgs.map(() => false);
  let usados = 0;
  const sis = msgs.findIndex((m) => m.rol === 'system');
  if (sis >= 0 && msgs[sis].tokens <= presupuesto) {
    dentro[sis] = true;
    usados += msgs[sis].tokens;
  }
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (i === sis) continue;
    if (usados + msgs[i].tokens > presupuesto) break;
    dentro[i] = true;
    usados += msgs[i].tokens;
  }
  return { dentro, usados, libre: Math.max(0, ventana - usados), olvidados: dentro.filter((d) => !d).length };
}
