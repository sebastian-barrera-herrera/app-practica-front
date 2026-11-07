/** Lógica pura de las ilustraciones de la zona 12 (chat, anatomía de un prompt, few-shot, razonamiento e inyección). Se prueba aparte. */
import { COT, FEWSHOT, INYECCION } from './iaPromptData';

// ───────────────────────── anatomía de un prompt ─────────────────────────

export type Pieza = 'rol' | 'tarea' | 'contexto' | 'formato' | 'restricciones' | 'ejemplo';

export const PIEZAS: { id: Pieza; nombre: string; texto: string; pista: string }[] = [
  { id: 'rol', nombre: 'Rol', texto: 'Eres un agente de atención al cliente de DojoShop, amable y profesional.', pista: 'Fija el punto de vista, el tono y el nivel de detalle.' },
  { id: 'tarea', nombre: 'Tarea', texto: 'Redacta la respuesta a la reclamación del cliente.', pista: 'Qué tiene que hacer exactamente. Un verbo claro.' },
  { id: 'contexto', nombre: 'Contexto', texto: 'Política: los productos se pueden devolver en 30 días y el reembolso tarda de 5 a 7 días.', pista: 'Los datos que el modelo no puede saber. Sin contexto, inventa.' },
  { id: 'formato', nombre: 'Formato', texto: 'Responde con tres partes: saludo, solución y siguiente paso.', pista: 'Cómo debe ser la salida (JSON, viñetas, longitud…).' },
  { id: 'restricciones', nombre: 'Restricciones', texto: 'Máximo 50 palabras. No prometas plazos que no estén en la política.', pista: 'Lo que NO debe hacer y los límites.' },
  { id: 'ejemplo', nombre: 'Ejemplo', texto: 'Ejemplo de tono: «Hola Marta, lamentamos lo ocurrido…»', pista: 'Una muestra de salida ideal: fija el estilo mejor que una descripción.' },
];

export function componerPrompt(sel: Pieza[]): string {
  return PIEZAS.filter((p) => sel.includes(p.id)).map((p) => p.texto).join('\n') || '(prompt vacío)';
}

export interface Valoracion {
  puntos: number;
  respuesta: string;
  avisos: string[];
}

/** Valora de forma orientativa un prompt según las piezas incluidas y devuelve la respuesta típica que daría un modelo. */
export function valorarPrompt(sel: Pieza[]): Valoracion {
  const tiene = (p: Pieza): boolean => sel.includes(p);
  const avisos: string[] = [];
  if (!tiene('tarea')) avisos.push('Sin tarea clara, el modelo adivina qué quieres.');
  if (tiene('tarea') && !tiene('contexto')) avisos.push('Sin contexto, puede inventar plazos y condiciones.');
  if (tiene('tarea') && !tiene('formato')) avisos.push('Sin formato, cada respuesta saldrá con una estructura distinta.');
  if (tiene('tarea') && !tiene('restricciones')) avisos.push('Sin límites, puede ser largo o prometer de más.');
  const puntos = Math.min(100, sel.length * 14 + (tiene('tarea') ? 8 : 0) + (tiene('contexto') ? 8 : 0));
  let respuesta: string;
  if (!tiene('tarea')) respuesta = 'Gracias por escribirnos. ¿En qué puedo ayudarte?';
  else if (!tiene('contexto')) respuesta = 'Lamentamos el problema. Normalmente puedes devolver el producto en 14 días y recibirás el reembolso en 3 días hábiles.';
  else if (!tiene('formato')) respuesta = 'Lamentamos lo ocurrido con tu pedido. Dentro de los 30 días puedes devolver el producto y el reembolso llega en 5 a 7 días hábiles; si necesitas ayuda con la etiqueta, escríbenos.';
  else if (!tiene('restricciones')) respuesta = 'Saludo: Hola, lamentamos lo ocurrido.\nSolución: puedes devolver el producto dentro de los 30 días y te reembolsamos por el mismo método de pago.\nSiguiente paso: solicita la etiqueta desde «Mis pedidos». El reembolso tarda de 5 a 7 días hábiles y, además, te regalamos un cupón de disculpa del 20 %.';
  else if (!tiene('ejemplo')) respuesta = 'Saludo: Hola, lamentamos lo ocurrido.\nSolución: devolución dentro de 30 días con reembolso.\nSiguiente paso: pide la etiqueta en «Mis pedidos» (reembolso en 5 a 7 días hábiles).';
  else respuesta = 'Saludo: Hola Marta, lamentamos lo ocurrido.\nSolución: puedes devolverlo en 30 días y te reembolsamos.\nSiguiente paso: solicita la etiqueta en «Mis pedidos» (reembolso en 5 a 7 días hábiles).';
  return { puntos, respuesta, avisos };
}

// ───────────────────────── chat ─────────────────────────

export function tokensAprox(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 3));
}

// ───────────────────────── few-shot ─────────────────────────

export type ModoFewShot = 'k0' | 'k2' | 'k4' | 'malos';

export function aciertos(modo: ModoFewShot): { ok: boolean[]; precision: number } {
  const ok = FEWSHOT.pruebas.map((p) => p[modo] === p.y);
  return { ok, precision: ok.filter(Boolean).length / ok.length };
}

// ───────────────────────── razonamiento ─────────────────────────

export function respuestaCot(problema: number, modelo: 'mini' | 'pro', pasos: boolean): { texto: string; acierta: boolean } {
  const f = COT[problema];
  const texto = modelo === 'mini' ? (pasos ? f.miniPasos : f.miniDirecto) : pasos ? f.proPasos : f.proDirecto;
  const nums = texto.match(/\d+/g) ?? [];
  return { texto, acierta: nums.length > 0 && nums[nums.length - 1] === f.correcto };
}

// ───────────────────────── inyección ─────────────────────────

export function ataque(modelo: 'mini' | 'pro', defensa: boolean, id: string): { texto: string; filtra: boolean } {
  const texto = INYECCION.celdas[`${modelo}|${defensa ? 'con' : 'sin'}|${id}`];
  return { texto, filtra: /DOJO-2024/.test(texto) };
}

export function resumenInyeccion(): { modelo: 'mini' | 'pro'; defensa: boolean; filtraciones: number }[] {
  const out: { modelo: 'mini' | 'pro'; defensa: boolean; filtraciones: number }[] = [];
  for (const modelo of ['mini', 'pro'] as const) {
    for (const defensa of [false, true]) {
      out.push({ modelo, defensa, filtraciones: INYECCION.ataques.filter((a) => ataque(modelo, defensa, a.id).filtra).length });
    }
  }
  return out;
}
