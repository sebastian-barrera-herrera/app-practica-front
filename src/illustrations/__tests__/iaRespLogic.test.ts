import { BOOTSTRAP, EQUIDAD, JUEZ } from '../iaRespData';
import { REQUISITOS, costeLlamada, costeMensual, detectar, enmascarar, faltan, luhn, metricasGrupos, nivelRiesgo, umbralParaTasa } from '../iaRespLogic';

describe('equidad (mismos números que la lección)', () => {
  it('con umbral 0,5 el grupo B recibe muchos menos aprobados', () => {
    const m = metricasGrupos(0.5, 0.5);
    expect(EQUIDAD.score).toHaveLength(400);
    expect(m.tasaA).toBeCloseTo(0.508, 2);
    expect(m.tasaB).toBeCloseTo(0.258, 2);
    expect(m.razon).toBeLessThan(0.8);
    expect(m.precision).toBeCloseTo(0.765, 2);
  });
  it('igualar la tasa de aprobación baja algo la precisión y mueve el TPR', () => {
    const u = umbralParaTasa(1, metricasGrupos(0.5, 0.5).tasaA);
    const m = metricasGrupos(0.5, u);
    expect(Math.abs(m.paridad)).toBeLessThan(0.01);
    expect(m.razon).toBeGreaterThan(0.98);
    expect(m.precision).toBeLessThan(0.765);
    expect(m.igualdadOportunidad).toBeLessThan(0);
  });
});

describe('privacidad', () => {
  const LOG = 'Marta Gil (marta@correo.example) llamó desde 612 345 678. DNI 12345678Z. Pagó con la tarjeta 4539 1488 0343 6467 el pedido PED-48213.';
  it('luhn valida tarjetas', () => {
    expect(luhn('4539 1488 0343 6467')).toBe(true);
    expect(luhn('1234 5678 9012 3456')).toBe(false);
  });
  it('detecta los cuatro tipos y no confunde el número de pedido', () => {
    expect(detectar(LOG).map((h) => h.tipo).sort()).toEqual(['dni', 'email', 'tarjeta', 'telefono']);
  });
  it('enmascara igual que la versión de Python', () => {
    expect(enmascarar(LOG)).toBe('Marta Gil (<EMAIL>) llamó desde <TELEFONO>. DNI <DNI>. Pagó con la tarjeta <TARJETA> el pedido PED-48213.');
  });
  it('un número largo que no pasa Luhn no se enmascara', () => {
    expect(enmascarar('Código 1234 5678 9012 3456 ok')).toBe('Código 1234 5678 9012 3456 ok');
  });
});

describe('evaluación', () => {
  it('el intervalo se estrecha al crecer el conjunto', () => {
    const w = BOOTSTRAP.map((b) => b.alto - b.bajo);
    expect(w[0]).toBeGreaterThan(w[w.length - 1] * 5);
    for (let i = 1; i < w.length; i += 1) expect(w[i]).toBeLessThanOrEqual(w[i - 1] + 0.05);
  });
  it('el juez simulado premia la verbosidad', () => {
    const nota = (n: string): number => Number(JUEZ.find((j) => j.nombre === n)!.nota.match(/\d/)![0]);
    expect(nota('Larga con relleno')).toBeGreaterThan(nota('Corta y correcta'));
    expect(nota('Larga y errónea')).toBeGreaterThan(nota('Corta y errónea'));
  });
});

describe('coste y riesgo', () => {
  it('el modelo grande cuesta ~23 veces más por llamada con 1000 tokens de entrada y 500 de salida', () => {
    expect(costeLlamada('mini', 1000, 500)).toBeCloseTo(0.00045, 8);
    expect(costeLlamada('pro', 1000, 500) / costeLlamada('mini', 1000, 500)).toBeCloseTo(23.33, 1);
  });
  it('la caché y el enrutado reducen el coste y la latencia', () => {
    const base = { peticiones: 100000, tokIn: 1000, tokOut: 300, cache: 0, grande: 1 };
    const opt = { ...base, cache: 0.3, grande: 0.1 };
    expect(costeMensual(opt).total).toBeLessThan(costeMensual(base).total / 5);
    expect(costeMensual(opt).latenciaMs).toBeLessThan(costeMensual(base).latenciaMs);
  });
  it('niveles de riesgo y requisitos', () => {
    expect(nivelRiesgo(['chatbot'])).toBe('limitado');
    expect(nivelRiesgo(['chatbot', 'credito'])).toBe('alto');
    expect(nivelRiesgo(['puntuacion_social', 'credito'])).toBe('prohibido');
    expect(nivelRiesgo(['filtro_spam'])).toBe('mínimo');
    expect(nivelRiesgo([])).toBe('mínimo');
    expect(faltan(REQUISITOS.slice(0, 3))).toHaveLength(REQUISITOS.length - 3);
  });
});
