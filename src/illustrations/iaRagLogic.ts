/** Lógica pura de las ilustraciones de la zona 13 (RAG): resumen de evaluación, veredicto del laboratorio y posiciones de acierto. */
import { RAG_CASOS, RAG_EVAL, RAG_LAB, RAG_METODOS, RAG_TROCEADO } from './iaRagData';

export type MetodoRag = 'vector' | 'palabras' | 'hibrido' | 'rerank';

export const METODOS: { id: MetodoRag; label: string; idea: string }[] = [
  { id: 'vector', label: 'Vectorial', idea: 'Compara embeddings: encuentra paráfrasis y sinónimos, pero se pierde con datos exactos (cifras, nombres, códigos).' },
  { id: 'palabras', label: 'Palabras clave', idea: 'Cuenta palabras compartidas con más peso a las raras (estilo BM25): preciso con términos exactos, ciego a sinónimos.' },
  { id: 'hibrido', label: 'Híbrido (RRF)', idea: 'Fusiona los dos rankings sumando 1/(60+posición): lo que aparece alto en ambos sube. Suele mejorar la cobertura.' },
  { id: 'rerank', label: 'Híbrido + reordenar', idea: 'Reordena los mejores candidatos con una señal más fina (frase a frase y cobertura de términos). Cuesta más, pero afina el primer puesto.' },
];

export function posicionAcierto(esp: string, secciones: string[]): number {
  return secciones.indexOf(esp) + 1;
}

export function metricasMetodo(m: MetodoRag): { hit1: number; hit3: number; mrr: number } {
  return RAG_METODOS[m];
}

export function filasMetodo(m: MetodoRag, soloFallos: boolean): { q: string; esp: string; secs: string[]; pos: number }[] {
  const filas = RAG_CASOS.map((c) => ({ q: c.q, esp: c.esp, secs: c[m], pos: posicionAcierto(c.esp, c[m]) }));
  return soloFallos ? filas.filter((f) => f.pos !== 1) : filas;
}

export function mejorTroceado(): number {
  let mejor = 0;
  RAG_TROCEADO.forEach((g, i) => {
    if (g.hit1 > RAG_TROCEADO[mejor].hit1) mejor = i;
  });
  return mejor;
}

export type Contexto = 'ninguno' | 'bueno' | 'irrelevante' | 'envenenado';
export type SistemaRag = 'libre' | 'ancla' | 'defensa';

export function laboratorio(ctx: Contexto, sis: SistemaRag): { respuesta: string; veredicto: 'correcta' | 'abstencion' | 'inventa' | 'inyectada' } {
  if (ctx === 'ninguno') return { respuesta: RAG_LAB.sinContexto, veredicto: 'inventa' };
  const respuesta = RAG_LAB.celdas[`${ctx}|${sis}`];
  if (/reembolsos-rapidos/.test(respuesta)) return { respuesta, veredicto: 'inyectada' };
  if (/^No lo sé/.test(respuesta)) return { respuesta, veredicto: 'abstencion' };
  if (/5 y 7/.test(respuesta)) return { respuesta, veredicto: 'correcta' };
  return { respuesta, veredicto: 'inventa' };
}

export function resumenEval(): { hit3: number; correctas: number; fieles: number; abstencionesOk: number; fallosRecuperacion: number; fallosGeneracion: number; total: number } {
  const dentro = RAG_EVAL.filter((e) => e.esp !== null);
  const fuera = RAG_EVAL.filter((e) => e.esp === null);
  return {
    hit3: dentro.filter((e) => e.hit).length / dentro.length,
    correctas: dentro.filter((e) => e.correcta).length / dentro.length,
    fieles: RAG_EVAL.reduce((a, e) => a + e.fiel, 0) / RAG_EVAL.length,
    abstencionesOk: fuera.filter((e) => e.correcta).length / fuera.length,
    fallosRecuperacion: dentro.filter((e) => e.diag === 'recuperación').length,
    fallosGeneracion: dentro.filter((e) => e.diag === 'generación').length,
    total: RAG_EVAL.length,
  };
}
