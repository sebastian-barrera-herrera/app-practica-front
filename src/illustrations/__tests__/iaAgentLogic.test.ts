import { AGENTE_MEMORIA, AGENTE_SEGURIDAD, AGENTE_TRAZAS } from '../iaAgentData';
import { ataqueAgente, costeTraza, matrizSeguridad, pasosHerramienta, sigueVisible, ventanaTurnos } from '../iaAgentLogic';

describe('trazas de agente', () => {
  it('cada traza empieza con el usuario y acaba con una respuesta', () => {
    for (const t of AGENTE_TRAZAS) {
      expect(t.eventos[0].t).toBe('user');
      expect(t.eventos[t.eventos.length - 1].t).toBe('final');
    }
  });
  it('la cadena usa dos herramientas y la consulta sin herramientas, ninguna', () => {
    expect(costeTraza('cadena').llamadas).toBe(2);
    expect(costeTraza('sin').llamadas).toBe(0);
    expect(costeTraza('simple').llamadas).toBe(1);
    expect(costeTraza('cadena').tokens).toBeGreaterThan(costeTraza('simple').tokens);
    expect(pasosHerramienta(AGENTE_TRAZAS[2].eventos)).toBe(1);
  });
  it('el error de una herramienta aparece en el resultado', () => {
    const t = AGENTE_TRAZAS.find((x) => x.id === 'error')!;
    expect(t.eventos.find((e) => e.t === 'resultado')!.texto).toMatch(/no encontrado/);
  });
});

describe('seguridad', () => {
  it('solo el modelo pequeño sin defensa ni guardia envía el correo del atacante', () => {
    const m = matrizSeguridad();
    expect(m.filter((x) => x.filtra)).toEqual([{ modelo: 'mini', defensa: false, guardia: false, filtra: true }]);
    expect(ataqueAgente('mini', false, false).correos).toEqual(['robo@malo.example']);
    expect(AGENTE_SEGURIDAD.nota).toMatch(/ignora/);
  });
  it('sin confirmación el pedido no se cancela', () => {
    expect(AGENTE_SEGURIDAD.confirmacion.no.estado).toBe('preparando');
    expect(AGENTE_SEGURIDAD.confirmacion.si.estado).toBe('cancelado');
  });
});

describe('memoria', () => {
  it('la ventana conserva los últimos turnos y pierde los primeros', () => {
    const total = AGENTE_MEMORIA.turnos.length;
    expect(ventanaTurnos(3).dentro).toEqual([total - 3, total - 2, total - 1]);
    expect(ventanaTurnos(100).perdidos).toEqual([]);
  });
  it('el número de pedido se pierde con ventanas pequeñas', () => {
    expect(sigueVisible(100, 'PED-48213')).toBe(true);
    expect(sigueVisible(2, 'PED-48213')).toBe(false);
  });
  it('la memoria vectorial recupera los hechos pedidos', () => {
    expect(AGENTE_MEMORIA.consultas[0].top[0].hecho).toMatch(/PED-48213/);
    expect(AGENTE_MEMORIA.consultas[1].top[0].hecho).toMatch(/marta@correo/);
  });
});
