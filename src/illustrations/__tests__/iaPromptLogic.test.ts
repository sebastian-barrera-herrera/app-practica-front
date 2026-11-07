import { CHAT_DEMO, COT, FEWSHOT, INYECCION } from '../iaPromptData';
import { PIEZAS, aciertos, ataque, componerPrompt, respuestaCot, resumenInyeccion, tokensAprox, valorarPrompt } from '../iaPromptLogic';

describe('datos generados con el LLM simulado', () => {
  it('few-shot: más ejemplos buenos no empeoran y los mal etiquetados no ayudan', () => {
    expect(FEWSHOT.acc['0']).toBeLessThan(FEWSHOT.acc['4']);
    expect(FEWSHOT.accMalos).toBeLessThanOrEqual(FEWSHOT.acc['0']);
    expect(FEWSHOT.pruebas).toHaveLength(8);
  });
  it('chat: sin historial no sabe, con historial responde', () => {
    expect(CHAT_DEMO.sinHistorial).toMatch(/No tengo/);
    expect(CHAT_DEMO.conHistorial).toMatch(/Roma/);
  });
  it('inyección: celdas completas para los 12 casos', () => {
    expect(Object.keys(INYECCION.celdas)).toHaveLength(12);
  });
});

describe('anatomía de un prompt', () => {
  it('compone solo las piezas elegidas y orden estable', () => {
    expect(componerPrompt([])).toBe('(prompt vacío)');
    const t = componerPrompt(['formato', 'rol']);
    expect(t.indexOf('Eres un agente')).toBeLessThan(t.indexOf('Responde con tres partes'));
    expect(PIEZAS).toHaveLength(6);
  });
  it('más piezas, más puntos y menos avisos', () => {
    const poco = valorarPrompt(['tarea']);
    const todo = valorarPrompt(['rol', 'tarea', 'contexto', 'formato', 'restricciones', 'ejemplo']);
    expect(todo.puntos).toBeGreaterThan(poco.puntos);
    expect(todo.avisos).toHaveLength(0);
    expect(poco.avisos.length).toBeGreaterThan(0);
    expect(valorarPrompt([]).respuesta).toMatch(/En qué puedo ayudarte/);
  });
  it('sin contexto la respuesta inventa un plazo', () => {
    expect(valorarPrompt(['tarea']).respuesta).toMatch(/14 días/);
    expect(valorarPrompt(['tarea', 'contexto']).respuesta).toMatch(/30 días/);
  });
  it('tokensAprox crece con el texto', () => {
    expect(tokensAprox('hola mundo')).toBeLessThan(tokensAprox('hola mundo, esto es un texto bastante más largo'));
  });
});

describe('few-shot', () => {
  it('coincide con la precisión guardada', () => {
    expect(aciertos('k0').precision).toBeCloseTo(FEWSHOT.acc['0'], 3);
    expect(aciertos('k4').precision).toBeCloseTo(FEWSHOT.acc['4'], 3);
    expect(aciertos('malos').precision).toBeCloseTo(FEWSHOT.accMalos, 3);
  });
});

describe('razonamiento', () => {
  it('el modelo pequeño solo acierta paso a paso y el grande siempre', () => {
    for (let i = 0; i < COT.length; i += 1) {
      expect(respuestaCot(i, 'mini', false).acierta).toBe(false);
      expect(respuestaCot(i, 'mini', true).acierta).toBe(true);
      expect(respuestaCot(i, 'pro', false).acierta).toBe(true);
    }
  });
});

describe('inyección', () => {
  it('solo el modelo pequeño sin defensa se deja engañar por «ignora»', () => {
    expect(ataque('mini', false, 'ignora').filtra).toBe(true);
    expect(ataque('mini', false, 'directo').filtra).toBe(false);
    expect(ataque('mini', true, 'ignora').filtra).toBe(false);
    expect(ataque('pro', false, 'ignora').filtra).toBe(false);
  });
  it('resumen: 2 filtraciones sin defensa en el pequeño, 0 en el resto', () => {
    const r = resumenInyeccion();
    expect(r.find((x) => x.modelo === 'mini' && !x.defensa)?.filtraciones).toBe(2);
    expect(r.filter((x) => x.defensa || x.modelo === 'pro').every((x) => x.filtraciones === 0)).toBe(true);
  });
});
