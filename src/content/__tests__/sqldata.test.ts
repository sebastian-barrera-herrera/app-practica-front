import { DATASET_LIST } from '@/content/sql/datasets';
import { SqlSession } from '@/sqlengine';

describe('bases de datos de ejemplo de SQL', () => {
  for (const ds of DATASET_LIST) {
    test(`${ds.id} se carga sin errores`, () => {
      const s = new SqlSession();
      const t0 = Date.now();
      const out = s.exec(ds.script);
      expect(out.error?.error.message).toBeUndefined();
      const tables = [...s.db.tables.values()];
      if (ds.id !== 'vacia') expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) expect(t.rows.length).toBeGreaterThan(0);
      expect(Date.now() - t0).toBeLessThan(5000);
    });
  }

  test('ventas_grande tiene 6000 filas y fechas válidas', () => {
    const s = new SqlSession();
    s.exec(DATASET_LIST.find((d) => d.id === 'ventas_grande')!.script);
    expect(s.query('SELECT COUNT(*), MIN(fecha), MAX(fecha), COUNT(DISTINCT cliente_id) FROM ventas').rows).toEqual([[6000, '2024-01-01', '2024-12-30', 500]]);
  });

  test('tienda: cifras que luego usan las lecciones', () => {
    const s = new SqlSession();
    s.exec(DATASET_LIST.find((d) => d.id === 'tienda')!.script);
    expect(s.query('SELECT COUNT(*) FROM clientes').rows).toEqual([[12]]);
    expect(s.query('SELECT COUNT(*) FROM productos').rows).toEqual([[14]]);
    expect(s.query('SELECT COUNT(*) FROM pedidos').rows).toEqual([[24]]);
    expect(s.query('SELECT COUNT(*) FROM detalle_pedido').rows).toEqual([[41]]);
  });
});
