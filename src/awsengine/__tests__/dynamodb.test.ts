import { mkEnv } from './helpers';

const CREATE = `dynamodb create-table --table-name Pedidos --attribute-definitions AttributeName=cliente,AttributeType=S AttributeName=fecha,AttributeType=S AttributeName=estado,AttributeType=S --key-schema AttributeName=cliente,KeyType=HASH AttributeName=fecha,KeyType=RANGE --billing-mode PAY_PER_REQUEST --global-secondary-indexes '[{"IndexName":"por-estado","KeySchema":[{"AttributeName":"estado","KeyType":"HASH"},{"AttributeName":"fecha","KeyType":"RANGE"}],"Projection":{"ProjectionType":"KEYS_ONLY"}}]'`;

const put = (e: ReturnType<typeof mkEnv>, item: Record<string, unknown>, extra = '') => e.run(`dynamodb put-item --table-name Pedidos --item '${JSON.stringify(item)}' ${extra}`);
const S = (s: string) => ({ S: s });
const N = (n: number) => ({ N: String(n) });

async function seeded() {
  const e = mkEnv();
  await e.json(CREATE);
  e.acct.clock += 10000;
  await put(e, { cliente: S('ana'), fecha: S('2026-01-05'), estado: S('enviado'), importe: N(30), items: { L: [S('a'), S('b')] } });
  await put(e, { cliente: S('ana'), fecha: S('2026-02-10'), estado: S('pendiente'), importe: N(12.5) });
  await put(e, { cliente: S('ana'), fecha: S('2026-03-01'), estado: S('pendiente'), importe: N(99) });
  await put(e, { cliente: S('bob'), fecha: S('2026-01-20'), estado: S('enviado'), importe: N(7) });
  return e;
}

describe('DynamoDB: tablas', () => {
  test('crear, describir, listar y borrar', async () => {
    const e = mkEnv();
    const t = (await e.json(CREATE)).TableDescription;
    expect(t.TableStatus).toBe('CREATING');
    expect(t.TableArn).toBe('arn:aws:dynamodb:us-east-1:123456789012:table/Pedidos');
    expect(t.BillingModeSummary.BillingMode).toBe('PAY_PER_REQUEST');
    expect((await e.run(CREATE)).stderr).toContain('ResourceInUseException');
    expect(await e.json('dynamodb list-tables --query TableNames')).toEqual(['Pedidos']);
    await e.run('dynamodb wait table-exists --table-name Pedidos');
    expect(await e.json('dynamodb describe-table --table-name Pedidos --query "Table.[TableStatus,KeySchema[].AttributeName,GlobalSecondaryIndexes[0].IndexName]"')).toEqual(['ACTIVE', ['cliente', 'fecha'], 'por-estado']);
    expect((await e.run('dynamodb describe-table --table-name Nada')).stderr).toContain('ResourceNotFoundException');
    await e.run('dynamodb delete-table --table-name Pedidos');
    await e.run('dynamodb wait table-not-exists --table-name Pedidos');
    expect(await e.json('dynamodb list-tables --query TableNames')).toEqual([]);
  });

  test('validaciones al crear', async () => {
    const e = mkEnv();
    expect((await e.run('dynamodb create-table --table-name ab --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST')).stderr).toContain('greater than or equal to 3');
    expect((await e.run('dynamodb create-table --table-name Tab1 --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH')).stderr).toContain('ReadCapacityUnits and WriteCapacityUnits must both be specified');
    expect((await e.run('dynamodb create-table --table-name Tab1 --attribute-definitions AttributeName=id,AttributeType=S AttributeName=otro,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST')).stderr).toContain('Number of attributes in KeySchema does not exactly match');
    expect((await e.run('dynamodb create-table --table-name Tab1 --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1')).stderr).toContain('Neither ReadCapacityUnits');
    const ok = await e.json('dynamodb create-table --table-name Tab1 --attribute-definitions AttributeName=id,AttributeType=N --key-schema AttributeName=id,KeyType=HASH --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=2');
    expect(ok.TableDescription.ProvisionedThroughput).toEqual({ NumberOfDecreasesToday: 0, ReadCapacityUnits: 5, WriteCapacityUnits: 2 });
  });
});

describe('DynamoDB: elementos', () => {
  test('put, get, claves y tipos', async () => {
    const e = await seeded();
    const g = await e.json('dynamodb get-item --table-name Pedidos --key \'{"cliente":{"S":"ana"},"fecha":{"S":"2026-01-05"}}\'');
    expect(g.Item.importe).toEqual({ N: '30' });
    expect(g.Item.items.L).toHaveLength(2);
    expect(await e.json('dynamodb get-item --table-name Pedidos --key \'{"cliente":{"S":"zoe"},"fecha":{"S":"x"}}\'')).toEqual({});
    // sintaxis abreviada
    const short = await e.json('dynamodb get-item --table-name Pedidos --key cliente={S=bob},fecha={S=2026-01-20}');
    expect(short.Item.estado.S).toBe('enviado');
    expect((await e.run('dynamodb get-item --table-name Pedidos --key \'{"cliente":{"S":"ana"}}\'')).stderr).toContain('The provided key element does not match the schema');
    expect((await e.run('dynamodb get-item --table-name Pedidos --key \'{"cliente":{"N":"1"},"fecha":{"S":"x"}}\'')).stderr).toContain('Type mismatch for key cliente expected: S actual: N');
    expect((await put(e, { cliente: S('ana') })).stderr).toContain('Missing the key fecha in the item');
    expect((await put(e, { cliente: S('x'), fecha: S('y'), importe: { N: 'abc' } })).stderr).toContain('cannot be converted to a numeric value');
    expect((await put(e, { cliente: S(''), fecha: S('y') })).stderr).toContain('may not contain an empty string');
    expect((await e.run('dynamodb put-item --table-name Nada --item \'{"a":{"S":"1"}}\'')).stderr).toContain('Requested resource not found');
  });

  test('condiciones: no sobrescribir y devolver lo anterior', async () => {
    const e = await seeded();
    const again = await put(e, { cliente: S('ana'), fecha: S('2026-01-05'), estado: S('x') }, '--condition-expression "attribute_not_exists(cliente)"');
    expect(again.stderr).toContain('ConditionalCheckFailedException');
    const nuevo = await put(e, { cliente: S('cy'), fecha: S('2026-04-01'), estado: S('x') }, '--condition-expression "attribute_not_exists(cliente)"');
    expect(nuevo.code).toBe(0);
    const old = JSON.parse((await put(e, { cliente: S('cy'), fecha: S('2026-04-01'), estado: S('y') }, '--return-values ALL_OLD')).stdout);
    expect(old.Attributes.estado.S).toBe('x');
  });

  test('update-item: SET, aritmética, if_not_exists, ADD, REMOVE y palabras reservadas', async () => {
    const e = await seeded();
    const key = '--key \'{"cliente":{"S":"ana"},"fecha":{"S":"2026-02-10"}}\'';
    const r = await e.json(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET importe = importe + :d, nota = if_not_exists(nota, :n) ADD visitas :uno" --expression-attribute-values '{":d":{"N":"7.5"},":n":{"S":"hola"},":uno":{"N":"1"}}' --return-values ALL_NEW`);
    expect(r.Attributes.importe.N).toBe('20');
    expect(r.Attributes.nota.S).toBe('hola');
    expect(r.Attributes.visitas.N).toBe('1');
    await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "REMOVE nota"`);
    expect((await e.json(`dynamodb get-item --table-name Pedidos ${key} --projection-expression "importe,visitas"`)).Item).toEqual({ importe: { N: '20' }, visitas: { N: '1' } });
    // «status» es una palabra reservada: hay que usar #s
    const bad = await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET status = :v" --expression-attribute-values '{":v":{"S":"x"}}'`);
    expect(bad.stderr).toContain('reserved keyword; reserved keyword: status');
    const good = await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET #e = :v" --expression-attribute-names '{"#e":"estado"}' --expression-attribute-values '{":v":{"S":"enviado"}}' --condition-expression "#e = :p"`);
    expect(good.stderr).toContain('not defined; attribute value: :p');
    const ok2 = await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET #e = :v" --expression-attribute-names '{"#e":"estado"}' --expression-attribute-values '{":v":{"S":"enviado"},":p":{"S":"pendiente"}}' --condition-expression "#e = :p"`);
    expect(ok2.code).toBe(0);
    const again = await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET #e = :v" --expression-attribute-names '{"#e":"estado"}' --expression-attribute-values '{":v":{"S":"x"},":p":{"S":"pendiente"}}' --condition-expression "#e = :p"`);
    expect(again.stderr).toContain('ConditionalCheckFailedException');
    expect((await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET cliente = :v" --expression-attribute-values '{":v":{"S":"x"}}'`)).stderr).toContain('part of the key');
    // sobra un valor declarado
    expect((await e.run(`dynamodb update-item --table-name Pedidos ${key} --update-expression "SET importe = :v" --expression-attribute-values '{":v":{"N":"1"},":x":{"N":"2"}}'`)).stderr).toContain('unused in expressions');
    // upsert: crea el elemento si no existe
    await e.run('dynamodb update-item --table-name Pedidos --key \'{"cliente":{"S":"nuevo"},"fecha":{"S":"2026-05-05"}}\' --update-expression "SET importe = :t" --expression-attribute-values \'{":t":{"N":"1"}}\'');
    expect((await e.json('dynamodb scan --table-name Pedidos --select COUNT')).Count).toBe(5);
  });

  test('delete-item', async () => {
    const e = await seeded();
    await e.run('dynamodb delete-item --table-name Pedidos --key \'{"cliente":{"S":"bob"},"fecha":{"S":"2026-01-20"}}\'');
    expect((await e.json('dynamodb scan --table-name Pedidos --select COUNT')).Count).toBe(3);
  });
});

describe('DynamoDB: query y scan', () => {
  test('query por partición con condición de ordenación, orden y límite', async () => {
    const e = await seeded();
    const q = await e.json('dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --expression-attribute-values \'{":c":{"S":"ana"}}\' --query "Items[].fecha.S"');
    expect(q).toEqual(['2026-01-05', '2026-02-10', '2026-03-01']);
    const desc = await e.json('dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --expression-attribute-values \'{":c":{"S":"ana"}}\' --no-scan-index-forward --query "Items[].fecha.S"');
    expect(desc).toEqual(['2026-03-01', '2026-02-10', '2026-01-05']);
    const r = await e.json('dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c AND fecha BETWEEN :a AND :b" --expression-attribute-values \'{":c":{"S":"ana"},":a":{"S":"2026-02-01"},":b":{"S":"2026-02-28"}}\'');
    expect(r.Count).toBe(1);
    const p = await e.json('dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c AND begins_with(fecha, :m)" --expression-attribute-values \'{":c":{"S":"ana"},":m":{"S":"2026-0"}}\' --select COUNT');
    expect(p).toMatchObject({ Count: 3, ScannedCount: 3 });
    const lim = await e.json('dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --expression-attribute-values \'{":c":{"S":"ana"}}\' --limit 2');
    expect(lim.Items).toHaveLength(2);
    expect(lim.LastEvaluatedKey).toEqual({ cliente: { S: 'ana' }, fecha: { S: '2026-02-10' } });
    const next = await e.json(`dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --expression-attribute-values '{":c":{"S":"ana"}}' --exclusive-start-key '${JSON.stringify(lim.LastEvaluatedKey)}'`);
    expect(next.Items.map((i: any) => i.fecha.S)).toEqual(['2026-03-01']);
    // filtro: se aplica después (ScannedCount > Count)
    const f = await e.json('dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --filter-expression "importe > :m" --expression-attribute-values \'{":c":{"S":"ana"},":m":{"N":"20"}}\'');
    expect(f).toMatchObject({ Count: 2, ScannedCount: 3 });
    expect((await e.run('dynamodb query --table-name Pedidos --key-condition-expression "fecha = :c" --expression-attribute-values \'{":c":{"S":"x"}}\'')).stderr).toContain('Query condition missed key schema element: cliente');
  });

  test('índice secundario global (disperso y solo claves)', async () => {
    const e = await seeded();
    const q = await e.json('dynamodb query --table-name Pedidos --index-name por-estado --key-condition-expression "estado = :s" --expression-attribute-values \'{":s":{"S":"pendiente"}}\'');
    expect(q.Count).toBe(2);
    // KEYS_ONLY: solo claves de la tabla y del índice
    expect(Object.keys(q.Items[0]).sort()).toEqual(['cliente', 'estado', 'fecha']);
    expect((await e.run('dynamodb query --table-name Pedidos --index-name no-existe --key-condition-expression "estado = :s" --expression-attribute-values \'{":s":{"S":"x"}}\'')).stderr).toContain('does not have the specified index');
  });

  test('scan con filtro y capacidad consumida', async () => {
    const e = await seeded();
    const s = await e.json('dynamodb scan --table-name Pedidos --filter-expression "#e = :e" --expression-attribute-names \'{"#e":"estado"}\' --expression-attribute-values \'{":e":{"S":"enviado"}}\' --return-consumed-capacity TOTAL');
    expect(s).toMatchObject({ Count: 2, ScannedCount: 4 });
    expect(s.ConsumedCapacity).toEqual({ TableName: 'Pedidos', CapacityUnits: 0.5 });
    const strong = await e.json('dynamodb get-item --table-name Pedidos --key cliente={S=bob},fecha={S=2026-01-20} --consistent-read --return-consumed-capacity TOTAL');
    expect(strong.ConsumedCapacity.CapacityUnits).toBe(1);
    const w = await put(e, { cliente: S('w'), fecha: S('1'), grande: S('x'.repeat(2500)) }, '--return-consumed-capacity TOTAL');
    expect(JSON.parse(w.stdout).ConsumedCapacity.CapacityUnits).toBe(3);
    // siempre devuelve lo mismo y en el mismo orden
    expect(await e.json('dynamodb scan --table-name Pedidos --query "Items[].cliente.S"')).toEqual(await e.json('dynamodb scan --table-name Pedidos --query "Items[].cliente.S"'));
  });
});

describe('DynamoDB: lotes, TTL, índices y facturación', () => {
  test('batch-write, batch-get y límite de 25', async () => {
    const e = mkEnv();
    await e.run('dynamodb create-table --table-name Tbl --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST');
    const reqs = Array.from({ length: 3 }, (_, i) => ({ PutRequest: { Item: { id: S('k' + i), v: N(i) } } }));
    expect((await e.run(`dynamodb batch-write-item --request-items '${JSON.stringify({ Tbl: reqs })}'`)).code).toBe(0);
    expect((await e.json('dynamodb scan --table-name Tbl --select COUNT')).Count).toBe(3);
    const got = await e.json(`dynamodb batch-get-item --request-items '${JSON.stringify({ Tbl: { Keys: [{ id: S('k1') }, { id: S('nada') }] } })}'`);
    expect(got.Responses.Tbl).toHaveLength(1);
    const many = Array.from({ length: 26 }, (_, i) => ({ PutRequest: { Item: { id: S('x' + i) } } }));
    expect((await e.run(`dynamodb batch-write-item --request-items '${JSON.stringify({ Tbl: many })}'`)).stderr).toContain('Too many items');
  });

  test('TTL, índice nuevo y paso a modo provisionado', async () => {
    const e = await seeded();
    expect(await e.json('dynamodb describe-time-to-live --table-name Pedidos --query TimeToLiveDescription.TimeToLiveStatus')).toBe('DISABLED');
    await e.run('dynamodb update-time-to-live --table-name Pedidos --time-to-live-specification Enabled=true,AttributeName=caduca');
    expect(await e.json('dynamodb describe-time-to-live --table-name Pedidos --query TimeToLiveDescription')).toEqual({ TimeToLiveStatus: 'ENABLED', AttributeName: 'caduca' });
    await e.run('dynamodb update-table --table-name Pedidos --attribute-definitions AttributeName=importe,AttributeType=N --global-secondary-index-updates \'[{"Create":{"IndexName":"por-importe","KeySchema":[{"AttributeName":"cliente","KeyType":"HASH"},{"AttributeName":"importe","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]\'');
    const q = await e.json('dynamodb query --table-name Pedidos --index-name por-importe --key-condition-expression "cliente = :c AND importe > :t" --expression-attribute-values \'{":c":{"S":"ana"},":t":{"N":"20"}}\' --query "Items[].importe.N"');
    expect(q).toEqual(['30', '99']);
    const upd = await e.json('dynamodb update-table --table-name Pedidos --billing-mode PROVISIONED --provisioned-throughput ReadCapacityUnits=3,WriteCapacityUnits=3 --query TableDescription.ProvisionedThroughput');
    expect(upd).toEqual({ NumberOfDecreasesToday: 0, ReadCapacityUnits: 3, WriteCapacityUnits: 3 });
  });
});
