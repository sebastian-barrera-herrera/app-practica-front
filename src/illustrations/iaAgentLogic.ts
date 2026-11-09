/** Lógica pura de las ilustraciones de la zona 14 (agentes): trazas, seguridad y memoria. */
import { AGENTE_MEMORIA, AGENTE_SEGURIDAD, AGENTE_TRAZAS, type EventoAgente } from './iaAgentData';

export function pasosHerramienta(eventos: EventoAgente[]): number {
  return eventos.filter((e) => e.t === 'llamada').length;
}

export function costeTraza(id: string): { tokens: number; coste: number; llamadas: number } {
  const t = AGENTE_TRAZAS.find((x) => x.id === id)!;
  return { tokens: t.tokens, coste: t.coste, llamadas: pasosHerramienta(t.eventos) };
}

export type ModeloAg = 'mini' | 'pro';

export function ataqueAgente(modelo: ModeloAg, defensa: boolean, guardia: boolean): { correos: string[]; filtra: boolean; eventos: EventoAgente[] } {
  const c = AGENTE_SEGURIDAD.celdas[`${modelo}|${defensa ? 'con' : 'sin'}|${guardia ? 'con' : 'sin'}`];
  return { correos: c.correos, filtra: c.correos.length > 0, eventos: c.eventos };
}

export function matrizSeguridad(): { modelo: ModeloAg; defensa: boolean; guardia: boolean; filtra: boolean }[] {
  const out: { modelo: ModeloAg; defensa: boolean; guardia: boolean; filtra: boolean }[] = [];
  for (const modelo of ['mini', 'pro'] as const) for (const defensa of [false, true]) for (const guardia of [false, true]) out.push({ modelo, defensa, guardia, filtra: ataqueAgente(modelo, defensa, guardia).filtra });
  return out;
}

/** Mensajes que caben en una ventana de `n` turnos (los últimos) y los hechos que se pierden. */
export function ventanaTurnos(n: number): { dentro: number[]; perdidos: number[] } {
  const total = AGENTE_MEMORIA.turnos.length;
  const ini = Math.max(0, total - n);
  return { dentro: Array.from({ length: total - ini }, (_, i) => ini + i), perdidos: Array.from({ length: ini }, (_, i) => i) };
}

/** ¿Sigue visible en la ventana el turno que menciona `texto` (por ejemplo el número de pedido)? */
export function sigueVisible(n: number, fragmento: string): boolean {
  const { dentro } = ventanaTurnos(n);
  return dentro.some((i) => AGENTE_MEMORIA.turnos[i].texto.includes(fragmento));
}
