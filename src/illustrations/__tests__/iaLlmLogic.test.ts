import {
  CLAVES,
  CONSULTAS,
  CONVERSACION,
  FRASE_ATENCION,
  PRESETS_MODELO,
  SIGUIENTE,
  ajustarContexto,
  bpeEntrenar,
  bpeTokens,
  contarParametros,
  distribucion,
  entropiaBits,
  fusionar,
  memoriaGB,
  muestrear,
  pesosAtencion,
  rng,
  salidaAtencion,
  softmaxFila,
} from '../iaLlmLogic';

const PALABRAS: [string, number][] = [['bajo', 4], ['baja', 3], ['bajar', 2], ['subo', 2], ['subir', 2]];

describe('BPE', () => {
  it('replica las fusiones de BPETokenizer.entrenar (Python)', () => {
    const pasos = bpeEntrenar(PALABRAS, 8);
    expect(pasos.map((p) => p.par.join('+'))).toEqual(['a+j', 'b+aj', 'o+</w>', 'baj+a', 'baj+o</w>', 'r+</w>', 's+u', 'su+b']);
    expect(pasos[0].veces).toBe(9);
  });
  it('se detiene cuando ningún par se repite', () => {
    expect(bpeEntrenar(PALABRAS, 50).length).toBeLessThan(50);
    expect(bpeEntrenar([['ab', 1]], 5)).toEqual([]);
  });
  it('trocea palabras nuevas con las fusiones aprendidas', () => {
    const merges = bpeEntrenar(PALABRAS, 8).map((p) => p.par);
    expect(bpeTokens('bajo', merges)).toEqual(['bajo</w>']);
    expect(bpeTokens('bajista', merges)).toEqual(['baj', 'i', 's', 't', 'a', '</w>']);
    expect(bpeTokens('subo', merges)).toEqual(['sub', 'o</w>']);
  });
  it('fusionar solo une pares adyacentes', () => {
    expect(fusionar(['a', 'a', 'a'], ['a', 'a'])).toEqual(['aa', 'a']);
  });
});

describe('atención', () => {
  const W = pesosAtencion(CONSULTAS, CLAVES, true, false);
  it('cada fila suma 1', () => {
    for (const f of W) expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it('«estaba» y «cansado» atienden sobre todo a «gato»', () => {
    const argmax = (f: number[]): number => f.indexOf(Math.max(...f));
    expect(FRASE_ATENCION[argmax(W[7])]).toBe('gato');
    expect(FRASE_ATENCION[argmax(W[8])]).toBe('gato');
  });
  it('«cruzó» reparte su atención entre el que cruza y lo que cruza', () => {
    const orden = W[3].map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).slice(0, 2).map((x) => FRASE_ATENCION[x.i]);
    expect(orden.sort()).toEqual(['calle', 'gato']);
  });
  it('la máscara causal pone a 0 el futuro', () => {
    const C = pesosAtencion(CONSULTAS, CLAVES, true, true);
    for (let i = 0; i < C.length; i += 1) for (let j = i + 1; j < C.length; j += 1) expect(C[i][j]).toBe(0);
    expect(C[0][0]).toBe(1);
  });
  it('sin escalar la atención es más afilada', () => {
    const sin = pesosAtencion(CONSULTAS, CLAVES, false, false);
    expect(Math.max(...sin[7])).toBeGreaterThan(Math.max(...W[7]));
  });
  it('la salida es una media ponderada de V', () => {
    const V = CLAVES.map((_, i) => [i, 1]);
    const out = salidaAtencion(W, V);
    expect(out[0][1]).toBeCloseTo(1, 10);
    expect(out[3][0]).toBeGreaterThan(0);
  });
});

describe('parámetros', () => {
  it('GPT-2 pequeño ≈ 124 M y 7B ≈ 6.6 mil millones', () => {
    const g = contarParametros(PRESETS_MODELO[0].p).total;
    expect(g).toBeGreaterThan(120e6);
    expect(g).toBeLessThan(128e6);
    const s = contarParametros(PRESETS_MODELO[1].p).total;
    expect(s).toBeGreaterThan(6.4e9);
    expect(s).toBeLessThan(6.9e9);
  });
  it('desglose coherente y memoria', () => {
    const d = contarParametros({ d: 100, capas: 2, vocab: 10 });
    expect(d.porCapa).toBe(4 * 10000 + 8 * 10000);
    expect(d.total).toBe(2 * d.porCapa + 1000);
    expect(memoriaGB(7e9, 2)).toBeCloseTo(14, 6);
  });
});

describe('muestreo', () => {
  const lg = SIGUIENTE.map((c) => c.logit);
  it('con temperatura 1 las probabilidades suman 1 y respetan el orden', () => {
    const m = distribucion(lg, 1, 8, 1);
    expect(m.final.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(m.final[0]).toBeGreaterThan(m.final[1]);
  });
  it('temperatura baja afila y alta aplana', () => {
    expect(distribucion(lg, 0.3, 8, 1).final[0]).toBeGreaterThan(distribucion(lg, 1, 8, 1).final[0]);
    expect(distribucion(lg, 2, 8, 1).final[0]).toBeLessThan(distribucion(lg, 1, 8, 1).final[0]);
    expect(entropiaBits(distribucion(lg, 2, 8, 1).final)).toBeGreaterThan(entropiaBits(distribucion(lg, 0.5, 8, 1).final));
  });
  it('top-k deja k candidatas y top-p el núcleo', () => {
    expect(distribucion(lg, 1, 3, 1).conserva.filter(Boolean)).toHaveLength(3);
    const p = distribucion(lg, 1, 8, 0.8);
    const base = p.base.filter((_, i) => p.conserva[i]).reduce((a, b) => a + b, 0);
    expect(base).toBeGreaterThanOrEqual(0.8);
    expect(p.conserva.filter(Boolean).length).toBeLessThan(8);
  });
  it('temperatura ~0 es voraz', () => {
    const m = distribucion(lg, 0, 8, 1);
    expect(m.final[0]).toBe(1);
  });
  it('muestrear respeta las probabilidades y es reproducible', () => {
    expect(muestrear([0.5, 0.5], 0.49)).toBe(0);
    expect(muestrear([0.5, 0.5], 0.5)).toBe(1);
    const a = rng(3);
    const b = rng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = rng(1);
    const cuentas = [0, 0];
    const p = distribucion([2, 0], 1, 2, 1).final;
    for (let i = 0; i < 2000; i += 1) cuentas[muestrear(p, r())] += 1;
    expect(cuentas[0] / 2000).toBeGreaterThan(p[0] - 0.05);
    expect(softmaxFila([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('ventana de contexto', () => {
  const total = CONVERSACION.reduce((a, m) => a + m.tokens, 0);
  it('los tokens de la conversación coinciden con el demo de Python (174)', () => {
    expect(total).toBe(174);
  });
  it('si cabe todo, no se olvida nada', () => {
    const r = ajustarContexto(CONVERSACION, 300, 50);
    expect(r.olvidados).toBe(0);
    expect(r.usados).toBe(174);
  });
  it('si no cabe, se pierde lo más antiguo pero se conserva el sistema', () => {
    const r = ajustarContexto(CONVERSACION, 150, 30);
    expect(r.dentro[0]).toBe(true);
    expect(r.dentro[CONVERSACION.length - 1]).toBe(true);
    expect(r.dentro[1]).toBe(false);
    expect(r.usados).toBeLessThanOrEqual(120);
  });
});
