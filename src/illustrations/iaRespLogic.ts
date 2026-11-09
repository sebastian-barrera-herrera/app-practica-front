/** Lógica pura de las ilustraciones de la zona 15 (equidad, privacidad, intervalos de confianza, coste y riesgo). */
import { EQUIDAD } from './iaRespData';

// ───────────────────────── equidad ─────────────────────────

export interface MetricasGrupos {
  tasaA: number;
  tasaB: number;
  paridad: number;
  razon: number;
  tprA: number;
  tprB: number;
  igualdadOportunidad: number;
  precision: number;
}

const media = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export function metricasGrupos(umbralA: number, umbralB: number): MetricasGrupos {
  const { score, grupo, real } = EQUIDAD;
  const pred = score.map((s, i) => (s >= (grupo[i] === 0 ? umbralA : umbralB) ? 1 : 0));
  const tasa = (g: number): number => media(pred.filter((_, i) => grupo[i] === g));
  const tpr = (g: number): number => media(pred.filter((_, i) => grupo[i] === g && real[i] === 1));
  const tasaA = tasa(0);
  const tasaB = tasa(1);
  return {
    tasaA,
    tasaB,
    paridad: tasaA - tasaB,
    razon: Math.max(tasaA, tasaB) === 0 ? 1 : Math.min(tasaA, tasaB) / Math.max(tasaA, tasaB),
    tprA: tpr(0),
    tprB: tpr(1),
    igualdadOportunidad: tpr(0) - tpr(1),
    precision: media(pred.map((p, i) => (p === real[i] ? 1 : 0))),
  };
}

/** Umbral para el grupo `g` que aprueba aproximadamente la fracción `objetivo` de ese grupo. */
export function umbralParaTasa(g: number, objetivo: number): number {
  const s = EQUIDAD.score.filter((_, i) => EQUIDAD.grupo[i] === g).sort((a, b) => b - a);
  const k = Math.max(Math.round(objetivo * s.length), 1);
  return s[k - 1];
}

// ───────────────────────── privacidad ─────────────────────────

export type TipoPii = 'email' | 'tarjeta' | 'dni' | 'telefono';

export const ETIQUETA_PII: Record<TipoPii, string> = { email: '<EMAIL>', tarjeta: '<TARJETA>', dni: '<DNI>', telefono: '<TELEFONO>' };

export function luhn(numero: string): boolean {
  const d = [...numero].filter((c) => /\d/.test(c)).map(Number).reverse();
  let s = 0;
  d.forEach((x, i) => {
    if (i % 2 === 0) s += x;
    else {
      const y = 2 * x;
      s += y > 9 ? y - 9 : y;
    }
  });
  return d.length > 0 && s % 10 === 0;
}

export interface Hallazgo {
  tipo: TipoPii;
  texto: string;
  ini: number;
  fin: number;
}

const PATRONES: { tipo: TipoPii; re: RegExp; valida?: (s: string) => boolean }[] = [
  { tipo: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { tipo: 'tarjeta', re: /\b\d(?:[ -]?\d){12,15}\b/g, valida: luhn },
  { tipo: 'dni', re: /\b\d{8}[A-Z]\b/g },
  { tipo: 'telefono', re: /(?:\+34\s?)?\b[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g },
];

export function detectar(texto: string, activos: TipoPii[] = ['email', 'tarjeta', 'dni', 'telefono']): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const p of PATRONES) {
    if (!activos.includes(p.tipo)) continue;
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null = p.re.exec(texto);
    while (m !== null) {
      const ini = m.index;
      const fin = ini + m[0].length;
      const solapa = out.some((h) => ini < h.fin && fin > h.ini);
      if (!solapa && (!p.valida || p.valida(m[0]))) out.push({ tipo: p.tipo, texto: m[0], ini, fin });
      m = p.re.exec(texto);
    }
  }
  return out.sort((a, b) => a.ini - b.ini);
}

export function enmascarar(texto: string, activos: TipoPii[] = ['email', 'tarjeta', 'dni', 'telefono']): string {
  let t = '';
  let pos = 0;
  for (const h of detectar(texto, activos)) {
    t += texto.slice(pos, h.ini) + ETIQUETA_PII[h.tipo];
    pos = h.fin;
  }
  return t + texto.slice(pos);
}

// ───────────────────────── coste y latencia ─────────────────────────

export const PRECIOS: Record<'mini' | 'pro', { entrada: number; salida: number; ttft: number; porToken: number }> = {
  mini: { entrada: 0.15, salida: 0.6, ttft: 250, porToken: 12 },
  pro: { entrada: 3.0, salida: 15.0, ttft: 600, porToken: 30 },
};

export interface EscenarioCoste {
  peticiones: number;
  tokIn: number;
  tokOut: number;
  cache: number;
  /** Fracción de peticiones que se enrutan al modelo grande. */
  grande: number;
}

export function costeLlamada(modelo: 'mini' | 'pro', tokIn: number, tokOut: number): number {
  const p = PRECIOS[modelo];
  return (tokIn * p.entrada + tokOut * p.salida) / 1_000_000;
}

export function costeMensual(e: EscenarioCoste): { total: number; porPeticion: number; latenciaMs: number } {
  const efectivas = e.peticiones * (1 - e.cache);
  const porLlamada = (1 - e.grande) * costeLlamada('mini', e.tokIn, e.tokOut) + e.grande * costeLlamada('pro', e.tokIn, e.tokOut);
  const lat = (m: 'mini' | 'pro'): number => PRECIOS[m].ttft + PRECIOS[m].porToken * e.tokOut;
  const latenciaMs = e.cache * 5 + (1 - e.cache) * ((1 - e.grande) * lat('mini') + e.grande * lat('pro'));
  return { total: efectivas * porLlamada, porPeticion: e.peticiones ? (efectivas * porLlamada) / e.peticiones : 0, latenciaMs };
}

// ───────────────────────── riesgo (simplificación didáctica del Reglamento europeo de IA) ─────────────────────────

export const USOS: { id: string; label: string; nivel: 'prohibido' | 'alto' | 'limitado' }[] = [
  { id: 'puntuacion_social', label: 'Puntuación social de ciudadanos', nivel: 'prohibido' },
  { id: 'empleo', label: 'Selección o evaluación de personal', nivel: 'alto' },
  { id: 'credito', label: 'Concesión de créditos', nivel: 'alto' },
  { id: 'salud', label: 'Diagnóstico o triaje médico', nivel: 'alto' },
  { id: 'chatbot', label: 'Chatbot que habla con personas', nivel: 'limitado' },
  { id: 'contenido_generado', label: 'Contenido generado por IA (imágenes, texto)', nivel: 'limitado' },
  { id: 'filtro_spam', label: 'Filtro de correo basura', nivel: 'limitado' },
];

export type Nivel = 'prohibido' | 'alto' | 'limitado' | 'mínimo';

export function nivelRiesgo(usos: string[]): Nivel {
  const sel = USOS.filter((u) => usos.includes(u.id) && u.id !== 'filtro_spam');
  if (sel.some((u) => u.nivel === 'prohibido')) return 'prohibido';
  if (sel.some((u) => u.nivel === 'alto')) return 'alto';
  if (sel.some((u) => u.nivel === 'limitado')) return 'limitado';
  return 'mínimo';
}

export const REQUISITOS = [
  'evaluación con conjunto oculto',
  'prueba de equidad por grupos',
  'PII enmascarada en logs',
  'límite de pasos y de coste',
  'plan de reversión',
  'monitorización y alertas',
  'supervisión humana definida',
  'documentación (tarjeta del modelo)',
];

export function faltan(hecho: string[]): string[] {
  return REQUISITOS.filter((r) => !hecho.includes(r));
}
