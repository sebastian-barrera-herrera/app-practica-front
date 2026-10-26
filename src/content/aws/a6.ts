import { A, all, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, multi, out, practice, predict, ran, tf } from './awsbuild';

const KEY = (c: string, f: string) => `--key '{"cliente":{"S":"${c}"},"fecha":{"S":"${f}"}}'`;
const QANA = `aws dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --expression-attribute-values '{":c":{"S":"ana"}}'`;
const RDS_MIN = (id: string, extra = '') => `aws rds create-db-instance --db-instance-identifier ${id} --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password 'Secreta123' --allocated-storage 20 ${extra}`.trim();

export const a6 = awsWorld({
  id: 'a6',
  index: 6,
  title: 'Bases de datos',
  subtitle: 'Cada dato en su sitio',
  emoji: '🗄️',
  color: '#F472B6',
  level: 'basico',
  intro:
    'AWS ofrece más de una docena de bases de datos y la pregunta más importante no es «¿cuál es la mejor?», sino «¿cómo voy a consultar mis datos?». En esta zona verás la diferencia entre relacional y NoSQL, montarás una base **RDS** con alta disponibilidad y copias, trabajarás con **DynamoDB** (claves, consultas e índices) y aprenderás a elegir entre ElastiCache, Redshift, Neptune y DocumentDB según el caso de uso.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a6-1', { title: 'SQL frente a NoSQL y servicios gestionados', summary: 'Las familias de bases de datos y qué hace AWS por ti', emoji: '⚖️', commands: ['SQL frente a NoSQL', 'Bases de datos en AWS', 'RDS', 'DynamoDB', 'aws dynamodb create-table'], minutes: 13 }, [
      learn(
        'Dos grandes familias',
        `
**Bases de datos relacionales (SQL)**: guardan los datos en **tablas** con columnas fijas y **relaciones** entre ellas. Permiten consultar de casi cualquier forma (\`JOIN\`, agregaciones) y ofrecen **transacciones ACID** entre varias tablas. Ejemplos: MySQL, PostgreSQL, Oracle. En AWS: **RDS** y **Aurora**.

**Bases de datos NoSQL**: modelos más flexibles — **clave-valor**, **documentos**, **grafos**, **en memoria**, **columnares**. Se diseñan para **patrones de acceso concretos** a cambio de escalar casi sin límite y responder en milisegundos. En AWS: **DynamoDB**, DocumentDB, Neptune, ElastiCache…

Dos ideas falsas muy comunes:

- «NoSQL no tiene consistencia»: DynamoDB permite lecturas fuertemente consistentes y transacciones.
- «SQL no escala»: Aurora escala muchísimo para lecturas, y muchas aplicaciones jamás necesitarán más.
`,
        '⚖️',
      ),
      mc('Tu aplicación necesita consultar los datos de muchas formas distintas, con uniones entre tablas e integridad entre ellas. ¿Qué familia encaja mejor?', ['Clave-valor', 'Relacional (SQL)', 'En memoria', 'Grafos'], 1, 'Las consultas variadas con uniones y transacciones son el terreno natural de las bases relacionales.'),
      learn(
        'Gestionada o instalada por ti',
        `
Puedes instalar MySQL en una instancia **EC2**: tendrías control total, pero **tú** te encargarías del sistema operativo, de los parches, de las copias, de la alta disponibilidad y de las migraciones de versión.

Una base **gestionada** (RDS, Aurora, DynamoDB…) delega en AWS el servidor, los parches, las copias automáticas y la conmutación por error. A cambio, no tienes acceso al sistema operativo.

Es la **responsabilidad compartida** aplicada a los datos: AWS cuida «de» la nube (hardware, motor, copias); tú cuidas lo que pones «en» la nube (esquema, consultas, accesos, red).
`,
        '🧰',
      ),
      match(
        'Une cada tipo de datos con el servicio de AWS',
        [
          ['Tablas y relaciones (MySQL, PostgreSQL)', 'RDS / Aurora'],
          ['Clave-valor con escala masiva y sin servidores', 'DynamoDB'],
          ['Datos en memoria con latencia de microsegundos', 'ElastiCache'],
          ['Conexiones entre entidades (amigos de amigos)', 'Neptune'],
        ],
        'Cada servicio está pensado para un modelo de datos y un patrón de acceso.',
      ),
      illus('aws-db-chooser', '¿Qué base de datos?', 'Marca lo que necesita tu aplicación y mira qué servicio encaja.'),
      multi('Marca las ventajas de una base de datos **gestionada** frente a instalarla tú en EC2.', ['Copias de seguridad automáticas', 'Parches del motor aplicados por AWS', 'Conmutación por error automática (Multi-AZ)', 'Acceso de administrador al sistema operativo', 'Es gratuita'], [0, 1, 2], 'No tienes acceso al sistema operativo (es una contrapartida) y, por supuesto, se paga.'),
      demo(
        'Una tabla NoSQL en un minuto',
        [
          ['aws dynamodb create-table --table-name Productos --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST --query TableDescription.TableStatus --output text', 'Solo declaramos la clave; los demás atributos son libres'],
          ['aws dynamodb wait table-exists --table-name Productos'],
          [`aws dynamodb put-item --table-name Productos --item '{"id":{"S":"p1"},"nombre":{"S":"Teclado"},"precio":{"N":"29.9"}}'`, 'Un elemento con tres atributos'],
          [`aws dynamodb put-item --table-name Productos --item '{"id":{"S":"p2"},"nombre":{"S":"Alfombrilla"},"colores":{"SS":["negro","azul"]}}'`, 'Otro con atributos distintos: no hay esquema rígido'],
          [`aws dynamodb get-item --table-name Productos --key '{"id":{"S":"p1"}}' --query Item.nombre.S --output text`, 'Lectura por clave'],
        ],
        A('base'),
      ),
      tf('«Si eliges DynamoDB, ya no hace falta pensar cómo se van a consultar los datos: se puede consultar de cualquier forma después.»', false, 'Con DynamoDB el diseño empieza por los **patrones de acceso**: la clave decide qué consultas son rápidas. Consultas imprevistas obligan a Scan o a nuevos índices.'),
      mc('¿Qué parte de una base de datos RDS sigue siendo responsabilidad tuya?', ['Los parches del motor', 'Las copias de seguridad automáticas', 'El esquema, las consultas y los permisos dentro de la base', 'El hardware del servidor'], 2, 'AWS gestiona infraestructura, parches y copias; tú gestionas lo que hay «dentro»: datos, esquema, usuarios y reglas de red.'),
      practice({
        prompt: 'Crea una tabla **`Productos`** de DynamoDB con clave de partición **`id`** (tipo cadena) en modo **bajo demanda** (`PAY_PER_REQUEST`).',
        goal: 'Tabla Productos con clave id y bajo demanda',
        setup: A('base'),
        check: all(
          awsIs('dynamodb describe-table --table-name Productos --query "Table.KeySchema[].AttributeName"', ['id'], 'La clave de partición debe ser `id`'),
          awsIs('dynamodb describe-table --table-name Productos --query "Table.BillingModeSummary.BillingMode"', 'PAY_PER_REQUEST', 'La tabla debe ser bajo demanda'),
        ),
        solution: ['aws dynamodb create-table --table-name Productos --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST'],
        hints: ['`aws dynamodb create-table --table-name … --attribute-definitions … --key-schema … --billing-mode …`', '`AttributeName=id,AttributeType=S` y `AttributeName=id,KeyType=HASH`.'],
        explain: 'En modo bajo demanda no planificas capacidad: pagas por petición, ideal para empezar o para tráfico impredecible.',
        par: 1,
        commands: ['aws dynamodb create-table'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a6-2', { title: 'RDS y Aurora', summary: 'Multi-AZ, réplicas de lectura y copias de seguridad', emoji: '🏛️', commands: ['RDS', 'Aurora', 'Multi-AZ', 'Réplica de lectura', 'Copias de seguridad de RDS', 'aws rds create-db-instance', 'aws rds modify-db-instance', 'aws rds create-db-snapshot', 'aws rds restore-db-instance-from-db-snapshot', 'aws rds create-db-instance-read-replica'], minutes: 18 }, [
      learn(
        'RDS: la base relacional sin el trabajo de servidor',
        `
**Amazon RDS** ejecuta MySQL, PostgreSQL, MariaDB, Oracle o SQL Server por ti. Para crear una base eliges:

- **Motor y versión**.
- **Clase de instancia** (\`db.t3.micro\` para pruebas, \`db.m5.large\`… para producción) y **almacenamiento** (que solo puede crecer).
- **Red**: un **grupo de subredes** (de al menos dos zonas) y un **security group**. Una base de producción va en subredes **privadas**, sin acceso público.
- Alta disponibilidad (**Multi-AZ**), **copias de seguridad** y protección contra borrado.

Se conecta como a cualquier base: con el **endpoint** que te da AWS (\`tienda-db.abc123.us-east-1.rds.amazonaws.com\`) y el puerto del motor.
`,
        '🏛️',
      ),
      learn(
        'Multi-AZ y réplicas de lectura: dos cosas distintas',
        `
**Multi-AZ** crea una **copia en espera** en otra zona, actualizada de forma **síncrona**. Si la zona principal cae, RDS **conmuta solo** (1–2 minutos) y el endpoint no cambia. Es para **disponibilidad**. No puedes leer de la copia en espera y **cuesta el doble**.

Una **réplica de lectura** es una copia **asíncrona** que **sirve consultas**: reparte lecturas (informes, búsquedas). Tiene su propio endpoint, puede estar en otra región y se puede **promover** a base independiente.

| | Multi-AZ | Réplica de lectura |
| --- | --- | --- |
| Objetivo | Disponibilidad | Rendimiento de lectura |
| Replicación | Síncrona | Asíncrona |
| ¿Se lee de ella? | No | Sí |
| Conmutación | Automática | Manual (promover) |
`,
        '🔁',
      ),
      illus('aws-multi-az', 'Principal, reserva y réplica', 'Provoca una caída de zona y mira qué ocurre en Multi-AZ y qué en una réplica de lectura.'),
      match(
        'Une cada objetivo con la solución',
        [
          ['Que la base siga funcionando si cae una zona', 'Multi-AZ'],
          ['Repartir consultas de informes pesadas', 'Réplica de lectura'],
          ['Volver a un instante concreto de ayer', 'Recuperación a un punto en el tiempo'],
          ['Guardar una copia antes de una migración', 'Snapshot manual'],
        ],
        'Disponibilidad, lectura, recuperación temporal y copia puntual son cuatro necesidades distintas con herramientas distintas.',
      ),
      mc('Tu base de datos RDS se ralentiza porque los informes lanzan consultas enormes de lectura. ¿Qué es lo más adecuado?', ['Activar Multi-AZ', 'Crear una réplica de lectura y apuntar los informes a ella', 'Cambiar a una región más barata', 'Borrar las copias de seguridad'], 1, 'Multi-AZ no sirve lecturas. La réplica de lectura sí y quita carga a la principal.'),
      learn(
        'Copias de seguridad: automáticas y manuales',
        `
- **Automáticas**: copia diaria + registros de transacciones. Permiten volver a **cualquier momento** dentro de la **retención** (por defecto 1 día por CLI, hasta **35**). Con retención **0** se desactivan (y no podrás crear réplicas).
- **Manuales** (_snapshots_): las pides tú y **no caducan** hasta que las borres.
- **Restaurar crea una instancia NUEVA**, con otro endpoint; la original no se toca.
- **Multi-AZ no es una copia de seguridad**: si alguien borra datos por error, la reserva los borra también.
`,
        '💾',
      ),
      demo(
        'Crear una base y protegerla',
        [
          [RDS_MIN('tienda-db'), 'Una MySQL pequeña (la capa gratuita lo permite): estado `creating`'],
          ['aws rds wait db-instance-available --db-instance-identifier tienda-db', 'Esperamos a que esté lista (unos minutos en la vida real)'],
          ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[DBInstanceStatus,MultiAZ,BackupRetentionPeriod,PubliclyAccessible]" --output text', 'Nace sin Multi-AZ, con 1 día de copias y accesible públicamente (VPC por defecto)'],
          ['aws rds modify-db-instance --db-instance-identifier tienda-db --multi-az --backup-retention-period 7 --no-publicly-accessible --apply-immediately --query DBInstance.DBInstanceStatus --output text', 'Lo endurecemos: Multi-AZ, 7 días de copias y sin acceso público'],
          ['aws rds wait db-instance-available --db-instance-identifier tienda-db'],
          ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[MultiAZ,BackupRetentionPeriod,PubliclyAccessible]" --output text', 'Ahora sí'],
        ],
        A('base'),
      ),
      tf('«Al restaurar un snapshot de RDS, la base de datos original se sobrescribe con los datos de la copia.»', false, 'Restaurar crea una instancia NUEVA con otro endpoint. Tú decides cuándo apuntar la aplicación a ella y cuándo borrar la antigua.'),
      learn(
        'Aurora: la base relacional de AWS',
        `
**Aurora** es compatible con MySQL y PostgreSQL pero con otra arquitectura:

- Los datos viven en un **volumen compartido** que guarda **6 copias en 3 zonas** y crece solo.
- El **clúster** tiene una instancia **escritora** y hasta **15 lectoras** que comparten ese volumen (la réplica de Aurora no necesita copiar datos, así que se retrasa muy poco).
- Si el escritor cae, una lectora se promueve en unos **30 s**.
- Dos endpoints: **del clúster** (siempre el escritor) y **de lectores** (reparto).
- **Aurora Serverless v2** ajusta la capacidad sola; **Global Database** replica a otras regiones.

Cuesta algo más que RDS, pero rinde y se recupera mejor.
`,
        '🌟',
      ),
      mc('¿En qué se diferencian las réplicas de Aurora de la «copia en espera» de RDS Multi-AZ?', ['No hay ninguna diferencia', 'Las lectoras de Aurora sirven consultas y además sirven de reserva ante un fallo', 'Aurora no tiene alta disponibilidad', 'Las de Aurora son siempre de otra región'], 1, 'En Aurora las réplicas hacen las dos cosas: reparten lecturas y toman el relevo si cae el escritor.'),
      practice({
        prompt:
          'Crea una base de datos RDS en **producción**:\n\n- Identificador **`tienda-db`**, motor **mysql**, clase **`db.t3.micro`**, **20** GiB, usuario `admin`, contraseña `Secreta123`.\n- **Multi-AZ** activado.\n- Copias automáticas con **7 días** de retención.',
        goal: 'tienda-db Multi-AZ con 7 días de copias',
        setup: A('base'),
        check: awsIs('rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[Engine,DBInstanceClass,AllocatedStorage,MultiAZ,BackupRetentionPeriod]"', ['mysql', 'db.t3.micro', 20, true, 7], 'La base debe ser mysql db.t3.micro de 20 GiB, Multi-AZ y con 7 días de copias'),
        solution: [RDS_MIN('tienda-db', '--multi-az --backup-retention-period 7')],
        hints: ['`aws rds create-db-instance --db-instance-identifier tienda-db --db-instance-class db.t3.micro --engine mysql …`', 'Añade `--multi-az` y `--backup-retention-period 7`.'],
        explain: 'Multi-AZ y copias son lo mínimo para producción. Recuerda que Multi-AZ cuesta el doble: en desarrollo no suele compensar.',
        par: 1,
        commands: ['aws rds create-db-instance', 'Multi-AZ'],
      }),
      practice({
        prompt: 'Vas a hacer una migración arriesgada en `tienda-db`. Haz primero una **copia manual** llamada **`antes-de-migrar`**, espera a que esté disponible y **restáurala** como una instancia nueva llamada **`tienda-copia`** para probar la migración sin riesgo.',
        goal: 'Snapshot antes-de-migrar y la instancia tienda-copia',
        setup: A('rds-base'),
        check: all(
          awsIs('rds describe-db-snapshots --db-snapshot-identifier antes-de-migrar --query "DBSnapshots[0].DBInstanceIdentifier"', 'tienda-db', 'Falta el snapshot antes-de-migrar de tienda-db'),
          awsIs('rds describe-db-instances --db-instance-identifier tienda-copia --query "DBInstances[0].DBInstanceIdentifier"', 'tienda-copia', 'Falta la instancia tienda-copia restaurada'),
        ),
        solution: [
          'aws rds create-db-snapshot --db-instance-identifier tienda-db --db-snapshot-identifier antes-de-migrar',
          'aws rds wait db-snapshot-available --db-snapshot-identifier antes-de-migrar',
          'aws rds restore-db-instance-from-db-snapshot --db-instance-identifier tienda-copia --db-snapshot-identifier antes-de-migrar',
        ],
        hints: ['`aws rds create-db-snapshot --db-instance-identifier … --db-snapshot-identifier …`', 'Espera con `aws rds wait db-snapshot-available …` y luego `aws rds restore-db-instance-from-db-snapshot …`.'],
        explain: 'Un snapshot manual antes de tocar nada es el seguro más barato. Y recuerda: la restauración crea otra instancia, que también cuesta hasta que la borres.',
        par: 3,
        commands: ['aws rds restore-db-instance-from-db-snapshot', 'Copias de seguridad de RDS'],
      }),
      practice({
        prompt: 'Los informes de la tienda están frenando a `tienda-db`. Crea una **réplica de lectura** llamada **`tienda-lectura`** a partir de ella.',
        goal: 'Réplica tienda-lectura de tienda-db',
        setup: A('rds-base'),
        check: awsIs('rds describe-db-instances --db-instance-identifier tienda-lectura --query "DBInstances[0].ReadReplicaSourceDBInstanceIdentifier"', 'tienda-db', 'tienda-lectura debe ser réplica de tienda-db'),
        solution: ['aws rds create-db-instance-read-replica --db-instance-identifier tienda-lectura --source-db-instance-identifier tienda-db'],
        hints: ['`aws rds create-db-instance-read-replica --db-instance-identifier <nueva> --source-db-instance-identifier <origen>`'],
        explain: 'La réplica tiene su propio endpoint: ahora los informes deben conectarse a él, no al de la principal.',
        par: 1,
        commands: ['aws rds create-db-instance-read-replica', 'Réplica de lectura'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a6-3', { title: 'DynamoDB básico', summary: 'Claves, elementos, Query, Scan e índices', emoji: '⚡', commands: ['DynamoDB', 'Clave de partición y de ordenación', 'Query frente a Scan', 'Índice secundario global', 'aws dynamodb put-item', 'aws dynamodb get-item', 'aws dynamodb query', 'aws dynamodb scan', 'aws dynamodb update-item'], minutes: 17 }, [
      learn(
        'Tablas, elementos y la clave primaria',
        `
En **DynamoDB** guardas **elementos** (_items_) en **tablas**. Cada elemento es un conjunto de **atributos** y puede tener atributos distintos de los demás. Lo único obligatorio es la **clave primaria**:

- **Clave de partición** (_partition key_): decide en qué partición física vive el elemento. Debe repartir la carga.
- **Clave de ordenación** (_sort key_, opcional): ordena los elementos con la misma partición y permite rangos.

Ejemplo — tabla **Pedidos** con partición \`cliente\` y ordenación \`fecha\`:

\`\`\`
cliente=ana  fecha=2026-01-05 …
cliente=ana  fecha=2026-02-10 …   ← los de «ana», juntos y ordenados
cliente=bob  fecha=2026-01-20 …
\`\`\`

Los valores llevan su **tipo**: \`{"S":"texto"}\`, \`{"N":"5"}\` (los números van como texto), \`{"BOOL":true}\`, \`{"L":[…]}\`, \`{"M":{…}}\`.
`,
        '⚡',
      ),
      illus('aws-ddb-partition', 'Cómo se reparten los elementos', 'Elige la clave de partición y observa cómo se reparte la carga entre particiones.'),
      mc('¿Qué clave de partición reparte mejor la carga en una tienda con millones de clientes?', ['El país del cliente', 'El identificador de cliente', 'La fecha actual', 'Un valor fijo, «tienda»'], 1, 'Muchos valores distintos y accedidos de forma pareja. Con pocos valores (país) o uno solo, todas las peticiones caen en la misma partición («partición caliente»).'),
      demo(
        'Leer una tabla de pedidos',
        [
          [`aws dynamodb get-item --table-name Pedidos ${KEY('ana', '2026-02-10')}`, 'Por la clave completa: la lectura más barata'],
          [`${QANA} --query "Items[].fecha.S" --output text`, 'Query: todos los pedidos de ana, ordenados por fecha'],
          [`${QANA} --key-condition-expression "cliente = :c AND fecha >= :f" --expression-attribute-values '{":c":{"S":"ana"},":f":{"S":"2026-02-01"}}' --query "Items[].fecha.S" --output text`, 'Con un rango sobre la clave de ordenación'],
          [`aws dynamodb scan --table-name Pedidos --filter-expression "importe > :m" --expression-attribute-values '{":m":{"N":"20"}}' --query "[Count,ScannedCount]" --output text`, 'Scan con filtro: devuelve 3, pero ha LEÍDO los 5 elementos'],
          [`aws dynamodb query --table-name Pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --query "Items[].[cliente.S,fecha.S]" --output text`, 'Un índice secundario permite consultar por estado sin Scan'],
        ],
        A('ddb-pedidos'),
      ),
      predict('¿Cuántos pedidos tiene `ana`?', `${QANA} --select COUNT --query Count --output text`, ['2', '5', '1'], 'Ana tiene tres pedidos (5 de enero, 10 de febrero y 1 de marzo).', A('ddb-pedidos')),
      learn(
        'Query, Scan e índices',
        `
- **Query**: va **directo** a una partición. Rápida y barata. Necesita la clave de partición.
- **Scan**: lee **toda** la tabla y filtra después. El filtro (\`--filter-expression\`) **no ahorra lectura**: \`ScannedCount\` se paga entero.
- **Índice secundario global (GSI)**: otra «vista» de la tabla con otra clave, para consultar por otros atributos. Se puede crear después; los elementos sin el atributo no aparecen (índice **disperso**).

**Palabras reservadas**: nombres como \`status\`, \`name\`, \`date\`, \`year\`… no pueden usarse directamente en expresiones; se rodean con un marcador declarado aparte:

\`\`\`
--update-expression "SET #s = :v"
--expression-attribute-names '{"#s":"status"}'
\`\`\`
`,
        '🔎',
      ),
      mc('Necesitas listar los pedidos «pendientes» de todos los clientes con frecuencia y la tabla tiene millones de elementos. ¿Qué haces?', ['Un Scan con filtro cada vez', 'Crear un índice secundario global por estado y usar Query', 'Cambiar a una base relacional siempre', 'Guardar los pendientes en otro bucket'], 1, 'Un Scan lee toda la tabla cada vez. Un GSI por estado convierte la pregunta en una Query barata.'),
      tf('«En DynamoDB, un `--filter-expression` en un Scan reduce el coste porque solo se leen los elementos que cumplen el filtro.»', false, 'El filtro se aplica después de leer: se paga todo lo leído (ScannedCount), no solo lo devuelto (Count).'),
      practice({
        prompt: 'Entra un pedido nuevo: **bob** compra el **2026-03-05**, estado **`pendiente`**, importe **20**. Créalo con `put-item` y asegúrate de **no sobrescribir** un pedido existente (condición `attribute_not_exists(cliente)`).',
        goal: 'Pedido nuevo de bob',
        setup: A('ddb-pedidos'),
        check: awsIs(`dynamodb get-item --table-name Pedidos ${KEY('bob', '2026-03-05')} --query "Item.[estado.S,importe.N]"`, ['pendiente', '20'], 'Falta el pedido de bob del 2026-03-05 (pendiente, importe 20)'),
        solution: [`aws dynamodb put-item --table-name Pedidos --item '{"cliente":{"S":"bob"},"fecha":{"S":"2026-03-05"},"estado":{"S":"pendiente"},"importe":{"N":"20"}}' --condition-expression "attribute_not_exists(cliente)"`],
        hints: ['Los valores llevan tipo: `{"S":"bob"}` y `{"N":"20"}` (el número va entre comillas).', '`--condition-expression "attribute_not_exists(cliente)"`'],
        explain: 'Sin la condición, un `put-item` con una clave existente reemplazaría el elemento entero en silencio. La condición lo convierte en «solo crear».',
        par: 1,
        commands: ['aws dynamodb put-item'],
      }),
      practice({
        prompt: 'El pedido de **ana** del **2026-02-10** ya se ha enviado. Cámbiale el estado a **`enviado`** con `update-item` (recuerda: `status` y similares son palabras reservadas; `estado` no, pero puedes usar un marcador igualmente). Solo debe cambiar si está **`pendiente`** (condición).',
        goal: 'Pedido de ana pasa a enviado',
        setup: A('ddb-pedidos'),
        check: awsIs(`dynamodb get-item --table-name Pedidos ${KEY('ana', '2026-02-10')} --query "Item.estado.S"`, 'enviado', 'El pedido de ana del 2026-02-10 debe quedar enviado'),
        solution: [`aws dynamodb update-item --table-name Pedidos ${KEY('ana', '2026-02-10')} --update-expression "SET estado = :nuevo" --condition-expression "estado = :viejo" --expression-attribute-values '{":nuevo":{"S":"enviado"},":viejo":{"S":"pendiente"}}'`],
        hints: ['`aws dynamodb update-item --table-name Pedidos --key … --update-expression "SET estado = :nuevo" …`', 'Añade `--condition-expression "estado = :viejo"` y declara los dos valores.'],
        explain: 'La condición evita carreras: si otro proceso ya cambió el estado, tu actualización falla en vez de pisarlo (control de concurrencia optimista).',
        par: 1,
        commands: ['aws dynamodb update-item'],
      }),
      practice({
        prompt: 'Lista **cuántos pedidos pendientes** hay usando el **índice** `por-estado` (no un Scan). Usa `query` con `--index-name`.',
        goal: 'Query al índice por-estado',
        setup: A('ddb-pedidos'),
        check: all(ran('dynamodb query.*--index-name por-estado'), out('"Count": 2')),
        solution: [`aws dynamodb query --table-name Pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --select COUNT`],
        hints: ['`aws dynamodb query --table-name Pedidos --index-name por-estado --key-condition-expression "estado = :e" …`', 'Añade `--select COUNT` si solo quieres el número.'],
        explain: 'El índice convierte «dame los pendientes» en una consulta directa. Un Scan habría leído toda la tabla.',
        par: 1,
        commands: ['aws dynamodb query', 'Índice secundario global'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a6-4', { title: 'ElastiCache, Redshift, Neptune y DocumentDB', summary: 'Las bases de datos especializadas y cuándo usarlas', emoji: '🧩', commands: ['ElastiCache', 'Redshift', 'Neptune', 'DocumentDB', 'Bases de datos especializadas', 'TTL de DynamoDB', 'aws dynamodb update-time-to-live'], minutes: 14 }, [
      learn(
        'Cuando una base «general» no es lo mejor',
        `
Además de RDS y DynamoDB, AWS tiene servicios pensados para **un patrón concreto**. Cada uno hace muy bien una cosa:

- **ElastiCache** (Redis/Valkey y Memcached): datos **en memoria**, latencia de microsegundos. Caché delante de otra base, sesiones, rankings.
- **Redshift**: **almacén de datos** columnar para analítica sobre terabytes (_OLAP_): informes de ventas históricos.
- **Neptune**: base de **grafos**: recorrer relaciones (recomendaciones, fraude, redes sociales).
- **DocumentDB**: documentos JSON compatibles con **MongoDB**.
- **Timestream**: **series temporales** (métricas, IoT). **Keyspaces**: compatible con Cassandra.
`,
        '🧩',
      ),
      match(
        'Une cada caso de uso con el servicio',
        [
          ['Un ranking de jugadores en tiempo real', 'ElastiCache (Redis)'],
          ['Informes de ventas de 5 años sobre petabytes', 'Redshift'],
          ['«¿Quién conoce a quién a tres saltos?»', 'Neptune'],
          ['Migrar una aplicación que usa MongoDB', 'DocumentDB'],
        ],
        'Cada servicio está optimizado para un patrón: memoria, analítica, relaciones o compatibilidad.',
      ),
      learn(
        'El patrón cache-aside',
        `
La caché más habitual funciona así (_cache-aside_ o _lazy loading_):

1. La aplicación pide un dato a **ElastiCache**.
2. Si **está** (acierto, _hit_): lo devuelve en microsegundos.
3. Si **no está** (fallo, _miss_): lo lee de la **base de datos**, lo **guarda en la caché** con una caducidad y lo devuelve.

Ventajas: menos carga en la base de datos y respuestas más rápidas. Contrapartida: los datos en caché pueden estar **un poco desactualizados**, y una caché **puede perderse**: la fuente de verdad sigue siendo la base de datos.
`,
        '🔁',
      ),
      mc('¿Para qué NO es adecuado Amazon Redshift?', ['Informes de negocio sobre años de datos', 'Las operaciones transaccionales del día a día de una tienda online', 'Analítica a gran escala con SQL', 'Combinar datos de muchas fuentes para estudiarlos'], 1, 'Redshift es OLAP (pocas consultas enormes). Las operaciones transaccionales (muchas lecturas/escrituras pequeñas) son OLTP: RDS/Aurora/DynamoDB.'),
      mc('Los usuarios de una aplicación de música piden a menudo las mismas 100 listas populares y la base de datos se satura. ¿Qué añades?', ['Una réplica en otra región', 'Una caché ElastiCache delante de la base de datos', 'Redshift', 'Neptune'], 1, 'Las lecturas repetidas de unos pocos datos son el caso ideal de una caché en memoria.'),
      learn(
        'Datos que caducan solos: TTL en DynamoDB',
        `
Las **sesiones de usuario**, los tokens y los datos temporales deberían desaparecer tras un tiempo. En **DynamoDB** se hace con el **TTL**:

1. Cada elemento lleva un atributo **numérico** con su hora de caducidad (en segundos desde 1970).
2. Activas el TTL en la tabla indicando ese atributo.
3. DynamoDB **borra solo** los elementos caducados, **gratis** y sin consumir escritura.

Detalle importante: el borrado es **en segundo plano** y puede tardar **hasta 48 horas**; si necesitas exactitud, filtra también por fecha en tu consulta.
`,
        '⏳',
      ),
      tf('«Con el TTL de DynamoDB, un elemento desaparece exactamente en el segundo en que caduca.»', false, 'El borrado es asíncrono y puede tardar horas (hasta 48). Un elemento caducado puede seguir apareciendo un tiempo.'),
      demo(
        'Activar el TTL',
        [
          ['aws dynamodb describe-time-to-live --table-name Sesiones --query TimeToLiveDescription.TimeToLiveStatus --output text', 'De momento desactivado'],
          ['aws dynamodb update-time-to-live --table-name Sesiones --time-to-live-specification Enabled=true,AttributeName=expira', 'Indicamos qué atributo lleva la hora de caducidad'],
          ['aws dynamodb describe-time-to-live --table-name Sesiones --query TimeToLiveDescription --output text', 'Ahora DynamoDB limpia las sesiones caducadas'],
        ],
        A('ddb-sesiones'),
      ),
      practice({
        prompt: 'La tabla **`Sesiones`** acumula sesiones caducadas. Cada elemento ya tiene el atributo **`expira`** (hora de caducidad en segundos). **Activa el TTL** usando ese atributo.',
        goal: 'TTL activado con expira',
        setup: A('ddb-sesiones'),
        check: awsIs('dynamodb describe-time-to-live --table-name Sesiones --query TimeToLiveDescription', { TimeToLiveStatus: 'ENABLED', AttributeName: 'expira' }, 'El TTL de Sesiones debe estar activado con el atributo expira'),
        solution: ['aws dynamodb update-time-to-live --table-name Sesiones --time-to-live-specification Enabled=true,AttributeName=expira'],
        hints: ['`aws dynamodb update-time-to-live --table-name Sesiones --time-to-live-specification Enabled=true,AttributeName=expira`'],
        explain: 'Una limpieza gratuita y automática. Para datos que se leen mucho y se pierden sin problema, ElastiCache sería la alternativa en memoria.',
        par: 1,
        commands: ['aws dynamodb update-time-to-live', 'TTL de DynamoDB'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a6-5', { title: 'Elegir la base de datos adecuada', summary: 'Escenarios al estilo del examen', emoji: '🎯', commands: ['Bases de datos en AWS', 'SQL frente a NoSQL', 'aws rds describe-db-instances'], minutes: 15 }, [
      learn(
        'Un método para elegir',
        `
Ante un escenario, hazte estas preguntas **en orden**:

1. **¿Cómo son los datos?** ¿Tablas con relaciones, documentos, pares clave-valor, grafos, series temporales?
2. **¿Cómo se consultan?** ¿Consultas variadas con uniones (SQL) o patrones fijos por clave (DynamoDB)? ¿Analítica sobre el histórico (Redshift)?
3. **¿Qué escala y latencia?** Milisegundos con millones de peticiones → DynamoDB; microsegundos → caché en memoria.
4. **¿Qué garantías?** ¿Transacciones entre tablas (relacional)? ¿Consistencia fuerte?
5. **¿Cuánto quieres operar?** Menos trabajo → gestionada y sin servidores.
6. **¿Hay algo que migrar?** MongoDB → DocumentDB; Oracle/SQL Server → RDS; MySQL/PostgreSQL → RDS/Aurora.
`,
        '🧭',
      ),
      mc('Una tienda online guarda carritos de compra con una latencia de milisegundos y picos enormes en el Black Friday, sin querer gestionar servidores. ¿Qué eliges?', ['RDS Multi-AZ', 'DynamoDB bajo demanda', 'Redshift', 'Neptune'], 1, 'Acceso por clave (cliente), milisegundos, picos impredecibles y sin servidores: DynamoDB en modo bajo demanda.'),
      mc('Una red social necesita recomendar «amigos de amigos» a tres niveles de profundidad. ¿Qué base encaja mejor?', ['DynamoDB', 'Neptune', 'ElastiCache', 'RDS'], 1, 'Las preguntas sobre conexiones profundas son el caso de las bases de grafos.'),
      mc('Una empresa tiene una aplicación en Oracle y quiere migrar a AWS con los menores cambios y sin gestionar el servidor. ¿Qué eliges?', ['DynamoDB', 'RDS for Oracle', 'DocumentDB', 'ElastiCache'], 1, 'RDS ofrece Oracle gestionado: mismo motor, sin administrar el servidor.'),
      mc('El equipo de analítica quiere ejecutar consultas SQL sobre cinco años de datos históricos de ventas (varios TB) para cuadros de mando. ¿Qué eliges?', ['RDS MySQL', 'Amazon Redshift', 'DynamoDB', 'ElastiCache'], 1, 'Analítica sobre grandes históricos (OLAP) es el terreno de un almacén de datos como Redshift.'),
      mc('Una aplicación de juegos necesita un ranking de jugadores actualizado en tiempo real con latencia de microsegundos. ¿Qué eliges?', ['ElastiCache for Redis', 'RDS', 'Redshift', 'DocumentDB'], 0, 'Los conjuntos ordenados de Redis son perfectos para rankings en memoria.'),
      mc('Una aplicación ya usa MongoDB y se quiere llevar a AWS sin reescribir el código de acceso. ¿Qué eliges?', ['DynamoDB', 'DocumentDB', 'Neptune', 'Aurora'], 1, 'DocumentDB es compatible con la API de MongoDB.'),
      multi('Marca los motivos para elegir **Aurora** en lugar de RDS estándar.', ['Más réplicas de lectura que comparten almacenamiento', 'Conmutación por error muy rápida', 'Almacenamiento que crece solo', 'Es más barata que una db.t3.micro de RDS'], [0, 1, 2], 'Aurora destaca en disponibilidad y escala; no suele ser la opción más barata para cargas muy pequeñas.'),
      tf('«Una base de datos Multi-AZ no necesita copias de seguridad, porque ya está duplicada.»', false, 'Multi-AZ protege frente a fallos de infraestructura, no frente a errores humanos: un borrado se replica a la reserva. Las copias de seguridad siguen siendo imprescindibles.'),
      demo(
        'Revisar una base «de producción»',
        [
          ['aws rds describe-db-instances --db-instance-identifier prod-db --query "DBInstances[0].[DBInstanceClass,MultiAZ,BackupRetentionPeriod,PubliclyAccessible,DeletionProtection]" --output text', 'Un servidor, sin copias, abierto a internet y sin protección de borrado'],
          ['aws rds describe-db-instances --db-instance-identifier prod-db --query "DBInstances[0].DBInstanceClass" --output text', 'Va justa de recursos: db.t3.small'],
        ],
        A('rds-prod'),
      ),
      practice({
        prompt: 'La base `prod-db` va justa de memoria (`db.t3.small`). Sube su clase a **`db.t3.medium`** aplicando el cambio **de inmediato** y espera a que quede disponible.',
        goal: 'prod-db en db.t3.medium',
        setup: A('rds-prod'),
        check: awsIs('rds describe-db-instances --db-instance-identifier prod-db --query "DBInstances[0].DBInstanceClass"', 'db.t3.medium', 'La clase de prod-db debe ser db.t3.medium'),
        solution: ['aws rds modify-db-instance --db-instance-identifier prod-db --db-instance-class db.t3.medium --apply-immediately', 'aws rds wait db-instance-available --db-instance-identifier prod-db'],
        hints: ['`aws rds modify-db-instance --db-instance-identifier prod-db --db-instance-class db.t3.medium --apply-immediately`', 'Sin `--apply-immediately`, el cambio queda pendiente hasta la próxima ventana de mantenimiento.'],
        explain: 'Cambiar la clase provoca un breve corte (en Multi-AZ, menor). Por eso se programa en horas de poco uso o se deja para la ventana de mantenimiento.',
        par: 2,
        commands: ['aws rds modify-db-instance'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Auditoría de seguridad: la base de datos de producción **`prod-db`** nació sin cuidados. Déjala lista para producción:\n\n1. **Multi-AZ** activado.\n2. Copias automáticas con **7 días** de retención.\n3. **Sin acceso público**.\n4. **Protección contra borrado** activada.\n5. Una **copia manual** llamada **`prod-inicial`** (espera a que esté disponible).',
    goal: 'prod-db lista para producción',
    setup: A('rds-prod'),
    check: all(
      awsIs('rds describe-db-instances --db-instance-identifier prod-db --query "DBInstances[0].[MultiAZ,BackupRetentionPeriod,PubliclyAccessible,DeletionProtection]"', [true, 7, false, true], 'Multi-AZ, 7 días de copias, sin acceso público y con protección contra borrado'),
      awsIs('rds describe-db-snapshots --db-snapshot-identifier prod-inicial --query "DBSnapshots[0].[DBInstanceIdentifier,Status]"', ['prod-db', 'available'], 'Falta la copia manual prod-inicial'),
    ),
    solution: [
      'aws rds modify-db-instance --db-instance-identifier prod-db --multi-az --backup-retention-period 7 --no-publicly-accessible --deletion-protection --apply-immediately',
      'aws rds wait db-instance-available --db-instance-identifier prod-db',
      'aws rds create-db-snapshot --db-instance-identifier prod-db --db-snapshot-identifier prod-inicial',
      'aws rds wait db-snapshot-available --db-snapshot-identifier prod-inicial',
    ],
    hints: [
      'Casi todo se cambia con una sola orden: `aws rds modify-db-instance` con `--multi-az`, `--backup-retention-period 7`, `--no-publicly-accessible` y `--deletion-protection` (más `--apply-immediately`).',
      'Espera a que la base vuelva a estar disponible: `aws rds wait db-instance-available --db-instance-identifier prod-db`.',
      'La copia manual: `aws rds create-db-snapshot --db-instance-identifier prod-db --db-snapshot-identifier prod-inicial`.',
    ],
    explain: 'Multi-AZ para la disponibilidad, copias para los errores humanos, privacidad de red para la seguridad y protección contra borrado para el «dedo gordo». Es la lista de comprobación básica de cualquier base de producción.',
    commands: ['RDS', 'Multi-AZ', 'Copias de seguridad de RDS'],
  },
});

