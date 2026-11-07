import { RAG_EVAL, RAG_LAB, RAG_PIPE, RAG_TROCEADO } from '../iaRagData';
import { filasMetodo, laboratorio, mejorTroceado, metricasMetodo, posicionAcierto, resumenEval } from '../iaRagLogic';

describe('datos del RAG de ejemplo', () => {
  it('hay 19 preguntas del manual y 4 ajenas', () => {
    expect(RAG_EVAL.filter((e) => e.esp !== null)).toHaveLength(19);
    expect(RAG_EVAL.filter((e) => e.esp === null)).toHaveLength(4);
  });
  it('el híbrido mejora la cobertura (hit@3) del vectorial', () => {
    expect(metricasMetodo('hibrido').hit3).toBeGreaterThan(metricasMetodo('vector').hit3);
    expect(metricasMetodo('rerank').hit1).toBeGreaterThan(metricasMetodo('hibrido').hit1);
    expect(metricasMetodo('palabras').hit1).toBeLessThanOrEqual(metricasMetodo('vector').hit1);
  });
  it('cada configuración de troceado tiene métricas y el mejor primer puesto existe', () => {
    expect(RAG_TROCEADO).toHaveLength(6);
    expect(RAG_TROCEADO[mejorTroceado()].hit1).toBe(Math.max(...RAG_TROCEADO.map((g) => g.hit1)));
    expect(RAG_TROCEADO[0].trozos).toBeGreaterThan(RAG_TROCEADO[5].trozos);
  });
  it('la tubería de ejemplo trae prompt con fuentes numeradas', () => {
    for (const p of RAG_PIPE) expect(p.prompt).toMatch(/\[1\]/);
    expect(RAG_PIPE[0].resp).toMatch(/6,90/);
    expect(RAG_PIPE[2].resp).toMatch(/^No lo sé/);
  });
});

describe('lógica', () => {
  it('posicionAcierto es 1-indexada y 0 si falla', () => {
    expect(posicionAcierto('a', ['b', 'a'])).toBe(2);
    expect(posicionAcierto('z', ['b', 'a'])).toBe(0);
  });
  it('filasMetodo filtra solo fallos del primer puesto', () => {
    const todas = filasMetodo('vector', false);
    const fallos = filasMetodo('vector', true);
    expect(todas).toHaveLength(19);
    expect(fallos.length).toBeLessThan(todas.length);
    expect(fallos.every((f) => f.pos !== 1)).toBe(true);
  });
  it('laboratorio: sin contexto inventa, con contexto bueno acierta, envenenado sin defensa se deja engañar', () => {
    expect(laboratorio('ninguno', 'libre').veredicto).toBe('inventa');
    expect(laboratorio('bueno', 'ancla').veredicto).toBe('correcta');
    expect(laboratorio('irrelevante', 'ancla').veredicto).toBe('abstencion');
    expect(laboratorio('irrelevante', 'libre').veredicto).toBe('inventa');
    expect(laboratorio('envenenado', 'ancla').veredicto).toBe('inyectada');
    expect(laboratorio('envenenado', 'defensa').veredicto).toBe('correcta');
    expect(RAG_LAB.pregunta).toMatch(/reembolso/);
  });
  it('resumen de evaluación coherente', () => {
    const r = resumenEval();
    expect(r.hit3).toBeGreaterThan(0.9);
    expect(r.abstencionesOk).toBe(1);
    expect(r.fallosGeneracion).toBeGreaterThan(0);
    expect(r.total).toBe(23);
  });
});
