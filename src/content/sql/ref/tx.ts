import type { SqlRef } from '../reference';

export const SQL_REF_TX: SqlRef[] = [
  {
    name: 'ACID',
    kind: 'concepto',
    category: 'transacciones',
    level: 3,
    db: 'banco',
    summary: 'Las cuatro garantías de una base de datos fiable: Atomicidad (todo o nada), Consistencia, Aislamiento y Durabilidad.',
    usage: 'BEGIN;  …sentencias…  COMMIT;   -- o ROLLBACK;',
    details: '**Atomicidad**: la transacción se ejecuta entera o nada. **Consistencia**: las restricciones siempre se cumplen. **Aislamiento**: las transacciones simultáneas no se estorban. **Durabilidad**: lo confirmado con `COMMIT` sobrevive a un fallo del servidor. Sin transacción explícita, cada sentencia es su propia transacción (autocommit) y es atómica.',
    examples: [
      ['BEGIN;\nUPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;\nUPDATE cuentas SET saldo = saldo + 100 WHERE id = 2;\nCOMMIT;\nSELECT * FROM cuentas ORDER BY id;', 'Una transferencia: las dos modificaciones o ninguna'],
      ['BEGIN;\nUPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;\nROLLBACK;\nSELECT * FROM cuentas ORDER BY id;', 'Con ROLLBACK todo vuelve a como estaba'],
    ],
    seeAlso: ['BEGIN / COMMIT / ROLLBACK', 'SAVEPOINT', 'Restricciones'],
  },
  {
    name: 'SAVEPOINT',
    kind: 'sentencia',
    category: 'transacciones',
    level: 3,
    db: 'banco',
    summary: 'Marca un punto intermedio de una transacción al que se puede volver sin deshacer lo anterior.',
    usage: 'SAVEPOINT nombre;\nROLLBACK TO [SAVEPOINT] nombre;\nRELEASE [SAVEPOINT] nombre;',
    details: '`ROLLBACK TO` deshace solo lo hecho después del punto (y los puntos posteriores) y deja la transacción abierta; si había quedado abortada por un error, vuelve a estar viva. `RELEASE` descarta el marcador sin deshacer nada. Útil para procesar muchos registros y descartar solo los que fallan.',
    examples: [
      ['BEGIN;\nUPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;\nSAVEPOINT p;\nUPDATE cuentas SET saldo = saldo - 100 WHERE id = 2;\nROLLBACK TO p;\nCOMMIT;\nSELECT * FROM cuentas ORDER BY id;', 'Solo se conserva el primer paso'],
    ],
    seeAlso: ['BEGIN / COMMIT / ROLLBACK', 'ACID'],
  },
  {
    name: 'Concurrencia y aislamiento',
    kind: 'concepto',
    category: 'transacciones',
    level: 3,
    db: 'banco',
    summary: 'Qué pasa cuando varios usuarios tocan los mismos datos a la vez y cómo evitar pisarse: aislamiento, bloqueos y control optimista.',
    usage: 'BEGIN ISOLATION LEVEL SERIALIZABLE;\nSELECT … FOR UPDATE;\nUPDATE … WHERE id = 1 AND version = 3;',
    details: 'Anomalías: actualización perdida, lectura sucia, lectura no repetible y lectura fantasma. Niveles de aislamiento: `READ UNCOMMITTED`, `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE` (más seguro, más lento). Herramientas: operaciones relativas (`saldo = saldo - 100`), bloqueo de filas con `SELECT … FOR UPDATE`, control optimista con una columna `version` (si el `UPDATE` afecta a 0 filas, alguien se adelantó) y tocar siempre las filas en el mismo orden para evitar interbloqueos.',
    examples: [
      ['BEGIN;\nSELECT saldo FROM cuentas WHERE id = 1 FOR UPDATE;\nUPDATE cuentas SET saldo = saldo - 300 WHERE id = 1;\nCOMMIT;', 'Leer, bloquear y escribir con garantías'],
      ['BEGIN ISOLATION LEVEL SERIALIZABLE;\nSELECT SUM(saldo) FROM cuentas;\nCOMMIT;', 'Una transacción con el nivel más estricto'],
    ],
    seeAlso: ['ACID', 'BEGIN / COMMIT / ROLLBACK'],
  },
  {
    name: 'CREATE VIEW',
    kind: 'sentencia',
    category: 'disenar',
    level: 3,
    db: 'tienda',
    summary: 'Guarda una consulta con un nombre para usarla como si fuera una tabla. No guarda datos: siempre muestra los actuales.',
    usage: 'CREATE [OR REPLACE] VIEW nombre [(col, …)] AS consulta;\nDROP VIEW [IF EXISTS] nombre;',
    details: 'Sirven para simplificar consultas con `JOIN`, reutilizar lógica y limitar lo que se ve (ocultar columnas). Las vistas con `JOIN` o agregados no se pueden modificar directamente: se cambia la tabla de origen. Las vistas **materializadas** (PostgreSQL) sí guardan el resultado y hay que refrescarlas.',
    examples: [
      ['CREATE VIEW clientes_vip AS SELECT nombre, ciudad FROM clientes WHERE vip;\nSELECT * FROM clientes_vip ORDER BY nombre;', 'Una vista sencilla'],
      ['CREATE VIEW pedidos_detalle AS SELECT p.id, c.nombre AS cliente, p.estado FROM pedidos p JOIN clientes c ON c.id = p.cliente_id;\nSELECT * FROM pedidos_detalle LIMIT 5;', 'El JOIN queda escondido detrás del nombre'],
    ],
    seeAlso: ['WITH', 'INNER JOIN'],
  },
];
