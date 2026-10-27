import { A, all, awsAfter, awsHas, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, order, practice, predict, tf } from './awsbuild';

const KEY_ANA = `'{"cliente":{"S":"ana"},"fecha":{"S":"2026-02-10"}}'`;
const GSI_ESTADO = `'[{"Create":{"IndexName":"por-estado","KeySchema":[{"AttributeName":"estado","KeyType":"HASH"},{"AttributeName":"fecha","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]'`;
const QUERY_ANA = `dynamodb query --table-name pedidos --key-condition-expression "cliente = :c" --expression-attribute-values '{":c":{"S":"ana"}}'`;
const SCAN_PENDIENTE = `dynamodb scan --table-name pedidos --filter-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}'`;
const tx = (m: number) =>
  `aws dynamodb transact-write-items --transact-items '[{"Update":{"TableName":"cuentas","Key":{"id":{"S":"ana"}},"UpdateExpression":"SET saldo = saldo - :m","ConditionExpression":"saldo >= :m","ExpressionAttributeValues":{":m":{"N":"${m}"}}}},{"Update":{"TableName":"cuentas","Key":{"id":{"S":"bob"}},"UpdateExpression":"SET saldo = saldo + :m","ExpressionAttributeValues":{":m":{"N":"${m}"}}}}]'`;
const saldo = (id: string, n: string) => awsIs(`dynamodb get-item --table-name cuentas --key '{"id":{"S":"${id}"}}' --query Item.saldo.N`, n, `El saldo de ${id} debería ser ${n}`);
const logs = (fn: string) => `logs filter-log-events --log-group-name /aws/lambda/${fn} --query "events[].message" --output text`;

const SUBNETS_APP = 'SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --query "Subnets[].SubnetId" --output text)';
const SUBNETS_CSV = 'SUBNETS_CSV=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --query "join(\',\', Subnets[].SubnetId)" --output text)';
const VPC_APP = 'VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=app --query "Vpcs[0].VpcId" --output text)';
const SG = (v: string, name: string) => `${v}=$(aws ec2 describe-security-groups --filters Name=group-name,Values=${name} --query "SecurityGroups[0].GroupId" --output text)`;
const INVOKE = (payload: string) => `aws lambda invoke --function-name catalogo --cli-binary-format raw-in-base64-out --payload '${payload}' salida.json && cat salida.json`;
const cacheGroup = (id: string, q: string) => `elasticache describe-replication-groups --replication-group-id ${id} --query "${q}" --output text`;

export const a11 = awsWorld({
  id: 'a11',
  index: 11,
  title: 'Datos a fondo',
  subtitle: 'DynamoDB, RDS y Aurora, cachés y migración de datos',
  emoji: '📊',
  color: '#38BDF8',
  level: 'intermedio',
  intro:
    'Elegir la base de datos es solo el principio. En esta zona aprendes lo que marca la diferencia en producción: **claves e índices de DynamoDB** que reparten la carga, **streams, TTL y transacciones**, **RDS y Aurora** con sus parámetros, su proxy de conexiones y su escala automática, **cachés con ElastiCache** y los patrones para usarlas, y cómo **migrar datos** a AWS con DMS, DataSync y Snow. Todo con tu cuenta simulada, incluidas funciones Python que usan `boto3` y `redis` de verdad.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a11-1', { title: 'DynamoDB: claves, índices y capacidad', summary: 'Diseñar para las consultas y entender cuánto cuesta cada lectura', emoji: '🔑', commands: ['DynamoDB', 'Clave de partición y de ordenación', 'Índice secundario global', 'Índice secundario local (LSI)', 'Partición caliente', 'Capacidad de DynamoDB (RCU y WCU)', 'aws dynamodb update-table'], minutes: 28 }, [
      learn(
        'Primero las preguntas, después la tabla',
        `
En SQL diseñas las tablas y luego haces las consultas que quieras. En **DynamoDB es al revés**: escribes la lista de **preguntas** que hará tu aplicación y diseñas las claves para responderlas rápido.

- La **clave de partición** (\`cliente\`) decide *en qué partición física* vive el elemento: DynamoDB aplica una función hash y reparte los datos por todo el almacenamiento.
- La **clave de ordenación** (\`fecha\`) ordena los elementos *dentro* de esa partición y permite buscar por rango (\`fecha BETWEEN …\`, \`begins_with\`).
- \`get-item\` y \`query\` usan la clave y son baratos y rápidos. \`scan\` recorre **toda** la tabla: solo para tablas pequeñas o tareas puntuales.

Una buena clave de partición tiene **muchos valores distintos** y accesos **parejos**. Una mala —\`estado\` con tres valores, o la fecha de hoy— concentra el tráfico en una partición y la **estrangula** (partición caliente), aunque pagues capacidad de sobra.
`,
        '🔑',
      ),
      illus('aws-ddb-hotkey', 'Qué clave reparte mejor', 'Cambia la clave y el tráfico. Prueba el sufijo aleatorio: así se trata una clave que no tiene más remedio que ser caliente.'),
      mc('Necesitas «los pedidos de un cliente, del más reciente al más antiguo». ¿Qué claves eliges?', ['Partición `estado`, ordenación `cliente`', 'Partición `cliente`, ordenación `fecha`', 'Partición `fecha`, ordenación `cliente`', 'Solo partición `id` y un `scan` con filtro'], 1, 'Un `query` por `cliente` te da sus pedidos y la clave de ordenación `fecha` los devuelve ordenados (`--no-scan-index-forward` para el más reciente primero), leyendo solo lo necesario.'),
      demo(
        'Query frente a Scan, con la cuenta en la mano',
        [
          ['aws dynamodb describe-table --table-name pedidos --query "Table.KeySchema"', 'Partición `cliente`, ordenación `fecha`'],
          [`aws ${QUERY_ANA} --return-consumed-capacity TOTAL --query "[Count,ScannedCount,ConsumedCapacity.CapacityUnits]"`, 'Los 3 pedidos de ana: examina 3 y cuesta 0,5 RCU'],
          [`aws ${QUERY_ANA} --no-scan-index-forward --limit 1 --query "Items[0].fecha.S"`, 'Su último pedido, sin leer los demás'],
          [`aws ${SCAN_PENDIENTE} --return-consumed-capacity TOTAL --query "[Count,ScannedCount,ConsumedCapacity.CapacityUnits]"`, 'El Scan devuelve 4 pero ha examinado (y cobrado) los 8'],
        ],
        A('data-ddb-tienda'),
        'La tabla `pedidos` tiene 8 elementos. Fíjate en la diferencia entre `Count` (lo que devuelve) y `ScannedCount` (lo que ha tenido que leer): **se paga lo leído, no lo devuelto**.',
      ),
      predict('¿Cuántos elementos examina el Scan que filtra por `estado = pendiente`?', `aws ${SCAN_PENDIENTE} --query ScannedCount`, ['4', '3', '1'], 'El filtro se aplica *después* de leer: el Scan recorre los 8 elementos, descarta los que no coinciden y devuelve 4. Con millones de elementos, eso son millones de lecturas cobradas.', A('data-ddb-tienda')),
      practice({
        prompt: 'Logística quiere ver **los pedidos de un estado** (por ejemplo, todos los `pendiente`) sin recorrer toda la tabla. Crea un **índice secundario global** llamado **`por-estado`** con clave de partición `estado` y de ordenación `fecha`, que proyecte **todos** los atributos, y consúltalo.',
        goal: 'El índice por-estado devuelve los 4 pedidos pendientes',
        setup: A('data-ddb-tienda'),
        check: awsIs(`dynamodb query --table-name pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --select COUNT --query Count`, 4, 'El índice por-estado todavía no existe o no devuelve los 4 pedidos pendientes'),
        solution: [
          `aws dynamodb update-table --table-name pedidos --attribute-definitions AttributeName=estado,AttributeType=S AttributeName=fecha,AttributeType=S --global-secondary-index-updates ${GSI_ESTADO}`,
          `aws dynamodb query --table-name pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --query Count`,
        ],
        hints: ['Un GSI se añade con `aws dynamodb update-table`. Hay que declarar en `--attribute-definitions` los atributos de su clave (`estado` y `fecha`, ambos de tipo `S`).', 'La definición del índice va en `--global-secondary-index-updates \'[{"Create":{"IndexName":"por-estado","KeySchema":[…],"Projection":{"ProjectionType":"ALL"}}}]\'`. Cada clave: `{"AttributeName":"estado","KeyType":"HASH"}` y `{"AttributeName":"fecha","KeyType":"RANGE"}`.', 'Para consultarlo: `aws dynamodb query --table-name pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values \'{":e":{"S":"pendiente"}}\'`.'],
        explain: 'Un GSI es una copia de los datos con otra clave, mantenida por DynamoDB. Ahora «pedidos por estado» es un `query` (barato) y no un `scan`. A cambio, el índice cuesta almacenamiento y escrituras extra y se lee con consistencia eventual.',
        par: 2,
        commands: ['aws dynamodb update-table', 'Índice secundario global'],
      }),
      learn(
        'GSI, LSI y proyecciones',
        `
| | **GSI** (global) | **LSI** (local) |
| --- | --- | --- |
| Clave de partición | Cualquiera | La **misma** que la tabla |
| Se crea | Cuando quieras | **Solo al crear la tabla** |
| Lectura | Solo eventualmente consistente | Eventual o fuerte |
| Capacidad | Propia | Compartida con la tabla |

**Proyección**: qué atributos copia el índice. \`KEYS_ONLY\` (solo claves, el más barato), \`INCLUDE\` (los que indiques) o \`ALL\` (todo, el más caro y el más cómodo). Si consultas un atributo que no está proyectado, DynamoDB lo busca en la tabla (*fetch*), con más coste. Proyecta lo que usan tus consultas.

En la práctica, **un GSI casi siempre es la respuesta**: un LSI te ata a decisiones del primer día y limita cada colección de elementos a 10 GB.
`,
        '🧭',
      ),
      tf('«Puedes añadir un índice secundario local a una tabla que ya existe, igual que un GSI.»', false, 'Los LSI solo se definen al crear la tabla. Para una tabla existente, usa un GSI (`update-table`).'),
      match(
        'Une cada necesidad con su herramienta',
        [
          ['Buscar pedidos por un atributo que no es la clave', 'GSI'],
          ['Otro orden dentro de la misma partición, con lectura fuerte', 'LSI'],
          ['Un solo elemento, conociendo su clave', 'get-item'],
          ['Recorrer toda la tabla (y pagarla entera)', 'scan'],
        ],
        'GSI para otro patrón de acceso, LSI para otro orden dentro de la partición (solo al crear), `get-item` para claves exactas y `scan` solo cuando de verdad necesitas todo.',
      ),
      learn(
        'Capacidad: RCU, WCU y los dos modos',
        `
DynamoDB mide el trabajo en **unidades**:

- **1 RCU** = una lectura *fuertemente consistente* de hasta **4 KB** por segundo (o **dos** *eventualmente consistentes*).
- **1 WCU** = una escritura de hasta **1 KB** por segundo.
- Se redondea hacia arriba por bloque: leer 9 KB son 3 RCU fuertes (o 1,5 eventuales); escribir 3,5 KB son 4 WCU. Una **transacción** cuesta el doble.

Dos modos de facturación:

- **Provisionado**: tú fijas RCU y WCU (con *auto scaling* si quieres). Barato con tráfico constante; si te pasas, \`ProvisionedThroughputExceededException\` (*throttling*).
- **Bajo demanda** (\`PAY_PER_REQUEST\`): no fijas nada y pagas por petición. Ideal para tráfico impredecible, picos o casi nulo. Por petición sale más caro, pero no tienes que acertar.

Se puede cambiar de modo, pero **una vez cada 24 horas**. En ambos, cada **partición** sigue teniendo su límite (≈1.000 WCU y 3.000 RCU).
`,
        '📏',
      ),
      predict('Con la tabla `pedidos`, ¿cuántas RCU consume leer un elemento pequeño con consistencia **eventual**?', `aws dynamodb get-item --table-name pedidos --key ${KEY_ANA} --return-consumed-capacity TOTAL --query ConsumedCapacity.CapacityUnits`, ['1', '2', '0.25'], 'Un elemento de hasta 4 KB cuesta 1 RCU si la lectura es fuerte y la mitad (0,5) si es eventual. Con `--consistent-read` saldría 1.', A('data-ddb-tienda')),
      mc('Escribes un elemento de 3,5 KB. ¿Cuántas WCU consume (sin transacción)?', ['1', '3,5', '4', '8'], 2, 'La escritura se redondea hacia arriba a bloques de 1 KB: 3,5 KB → 4 WCU. Con una transacción serían 8.'),
      practice({
        prompt: 'La tabla **`lecturas`** guarda lo que mandan unos sensores: a veces nada durante horas y a veces miles de escrituras en un segundo. Está en modo **provisionado** con 1 RCU y 1 WCU y va rechazando peticiones. Cámbiala al modo **bajo demanda**.',
        goal: 'lecturas en modo PAY_PER_REQUEST',
        setup: A('data-ddb-tienda'),
        check: awsIs('dynamodb describe-table --table-name lecturas --query Table.BillingModeSummary.BillingMode', 'PAY_PER_REQUEST', 'La tabla lecturas todavía no está en modo bajo demanda'),
        solution: ['aws dynamodb describe-table --table-name lecturas --query Table.ProvisionedThroughput', 'aws dynamodb update-table --table-name lecturas --billing-mode PAY_PER_REQUEST'],
        hints: ['Mira cómo está ahora: `aws dynamodb describe-table --table-name lecturas`.', '`aws dynamodb update-table --table-name lecturas --billing-mode PAY_PER_REQUEST`.'],
        explain: 'Con tráfico impredecible, bajo demanda evita tanto el throttling (capacidad corta) como pagar capacidad ociosa. Si más adelante el tráfico se estabiliza, puedes volver a provisionado con auto scaling para ahorrar (una vez cada 24 horas).',
        par: 2,
        commands: ['aws dynamodb update-table', 'Capacidad de DynamoDB (RCU y WCU)'],
      }),
      mc('Una tabla recibe un tráfico muy estable y previsible, de unas 500 lecturas por segundo todo el día. ¿Qué modo suele salir más barato?', ['Bajo demanda', 'Provisionado (con auto scaling)', 'Es idéntico', 'Ninguno: hay que usar RDS'], 1, 'Con tráfico constante, reservar capacidad es bastante más barato por unidad que pagar cada petición. Bajo demanda compensa cuando no puedes predecir la carga.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a11-2', { title: 'DynamoDB: streams, TTL, transacciones y tablas globales', summary: 'Reaccionar a los cambios, caducar datos y repartir la tabla por el mundo', emoji: '🌊', commands: ['DynamoDB Streams', 'TTL de DynamoDB', 'Transacciones de DynamoDB', 'Tablas globales de DynamoDB', 'DAX', 'Copias de seguridad y PITR de DynamoDB', 'aws dynamodb transact-write-items', 'aws dynamodb restore-table-to-point-in-time'], minutes: 30 }, [
      learn(
        'DynamoDB Streams: el registro de cambios',
        `
Un **stream** es un registro ordenado de cada cambio de la tabla —\`INSERT\`, \`MODIFY\`, \`REMOVE\`— que se conserva **24 horas**. Al activarlo eliges qué lleva cada registro (\`StreamViewType\`): solo las claves, la imagen nueva, la antigua o **las dos**.

Con él puedes: auditar, enviar notificaciones, mantener un índice o una copia en otro sitio, o replicar entre regiones. Lo normal es leerlo con **Lambda** mediante una *asignación de origen de eventos* (*event source mapping*): la función recibe lotes de registros.

Cosas que muerden:

- El **rol** de la función necesita permisos sobre el stream (\`AWSLambdaDynamoDBExecutionRole\`); si no, la asignación se rechaza.
- Si la función **falla** con un registro, el fragmento queda **bloqueado** y se reintenta una y otra vez, atascando a los registros buenos que van detrás. Limita con \`--maximum-retry-attempts\`, \`--bisect-batch-on-function-error\` y un \`--destination-config\` (a una cola SQS) para los que no se puedan procesar.
- \`--starting-position\`: \`LATEST\` (solo lo nuevo) o \`TRIM_HORIZON\` (desde lo más antiguo que se conserve).
`,
        '🌊',
      ),
      illus('aws-ddb-streams', 'Qué ve el consumidor', 'Cambia la operación y el tipo de registro. Mira también qué ocurre al activar una tabla global.'),
      mc('Quieres una función que, ante cada cambio, compare el valor anterior con el nuevo. ¿Qué `StreamViewType` necesitas?', ['KEYS_ONLY', 'NEW_IMAGE', 'OLD_IMAGE', 'NEW_AND_OLD_IMAGES'], 3, 'Para comparar «antes» y «después» hacen falta las dos imágenes. Es también el tipo que exigen las tablas globales.'),
      practice({
        prompt: 'La función **`auditoria`** imprime cada cambio que recibe de una tabla. Haz que audite **`pedidos`**: activa un stream con las **imágenes nueva y antigua**, deja que el rol `auditoria-role` lo lea (política gestionada `AWSLambdaDynamoDBExecutionRole`) y conecta la función **solo con los cambios nuevos**.',
        goal: 'Cada pedido nuevo aparece en los logs de auditoria',
        setup: A('data-ddb-eventos'),
        check: awsAfter([`dynamodb put-item --table-name pedidos --item '{"id":{"S":"1"}}'`], awsHas(logs('auditoria'), 'INSERT {"id": {"S": "1"}}', 'La función auditoria no ha recibido el pedido nuevo (¿stream? ¿permisos? ¿asignación?)')),
        solution: [
          'aws dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES',
          'STREAM=$(aws dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn --output text)',
          'aws iam attach-role-policy --role-name auditoria-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole',
          'aws lambda create-event-source-mapping --function-name auditoria --event-source-arn $STREAM --starting-position LATEST',
        ],
        hints: ['Primero el stream: `aws dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES`. Su ARN está en `describe-table` → `Table.LatestStreamArn`.', 'Si creas la asignación sin permisos verás «Cannot access stream». Añade al rol `arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole`.', '`aws lambda create-event-source-mapping --function-name auditoria --event-source-arn <arn del stream> --starting-position LATEST`.'],
        explain: 'La cadena completa: stream activado → rol con permiso de lectura → asignación de origen de eventos. Cualquiera de las tres piezas que falte y la función no ve nada (o la asignación ni se crea).',
        par: 4,
        commands: ['DynamoDB Streams', 'aws lambda create-event-source-mapping'],
      }),
      learn(
        'TTL: que los datos caduquen solos',
        `
Las sesiones, los carritos abandonados o los códigos temporales no deben vivir para siempre. Con **TTL** eliges un atributo numérico que contiene un **instante Unix** (segundos) y DynamoDB **borra gratis** los elementos cuya hora ya pasó.

- No es instantáneo: el borrado ocurre **en segundo plano** (normalmente en minutos, y hasta 48 horas después). Mientras tanto el elemento caducado **aún se ve** en las consultas: filtra por la fecha si importa.
- Si el atributo falta o no es numérico, el elemento no caduca.
- Los borrados por TTL aparecen en el stream como \`REMOVE\` hechos por \`dynamodb.amazonaws.com\`: úsalos para archivar lo que caduca.
- No consume capacidad de escritura.
`,
        '⏳',
      ),
      tf('«Con TTL, el elemento desaparece exactamente en el segundo indicado por su atributo.»', false, 'El borrado es asíncrono: puede tardar minutos u horas (hasta 48). Por eso, si tu aplicación no debe usar sesiones caducadas, comprueba la fecha al leer.'),
      practice({
        prompt: 'La tabla **`sesiones`** guarda en el atributo **`expira`** el instante Unix en que caduca cada sesión. Hay cinco: tres ya caducadas. Activa el **TTL** sobre `expira` para que DynamoDB limpie las caducadas por sí solo.',
        goal: 'Solo quedan las 2 sesiones vigentes',
        setup: A('data-ddb-eventos'),
        check: awsIs('dynamodb scan --table-name sesiones --select COUNT --query Count', 2, 'Todavía quedan sesiones caducadas (¿TTL activado sobre el atributo expira?)'),
        solution: ['aws dynamodb update-time-to-live --table-name sesiones --time-to-live-specification Enabled=true,AttributeName=expira', 'aws dynamodb describe-time-to-live --table-name sesiones'],
        hints: ['`aws dynamodb update-time-to-live --table-name sesiones --time-to-live-specification Enabled=true,AttributeName=expira`.', 'Comprueba con `aws dynamodb describe-time-to-live --table-name sesiones`: debe poner ENABLED.'],
        explain: 'Una orden y la limpieza se automatiza, sin coste de escritura. Recuerda el retraso: tras activarlo, las caducadas tardan unos minutos en desaparecer.',
        par: 2,
        commands: ['TTL de DynamoDB'],
      }),
      learn(
        'Transacciones: todo o nada',
        `
A veces dos cambios deben ocurrir **juntos**: restar saldo a una cuenta y sumarlo a otra. \`transact-write-items\` aplica hasta **100 operaciones** (\`Put\`, \`Update\`, \`Delete\`, \`ConditionCheck\`) sobre elementos distintos, de una o de varias tablas, **todas o ninguna**.

- Cada operación puede llevar una **condición** (\`saldo >= :m\`). Si una falla, la transacción entera se cancela y \`TransactionCanceledException\` te dice cuál (\`[ConditionalCheckFailed, None]\`).
- Un mismo elemento no puede aparecer dos veces.
- \`--client-request-token\` la hace **idempotente**: reintentarla no la aplica dos veces.
- Cuestan **el doble** de capacidad: para un solo elemento, una \`ConditionExpression\` en \`update-item\` basta.
`,
        '🔁',
      ),
      demo(
        'Una transferencia que se cancela entera',
        [
          [tx(30), 'ana pasa 30 a bob: las dos actualizaciones, o ninguna'],
          ['aws dynamodb scan --table-name cuentas --query "Items[].[id.S,saldo.N]" --output text', 'ana 70 · bob 30'],
          [tx(500), 'ana no tiene 500: la condición falla y se cancela todo', 'error'],
          ['aws dynamodb scan --table-name cuentas --query "Items[].[id.S,saldo.N]" --output text', 'Nada ha cambiado: ni se restó a ana ni se sumó a bob'],
        ],
        A('data-ddb-eventos'),
        'La condición `saldo >= :m` protege contra saldos negativos. Mira el mensaje del error: indica qué operación de la lista hizo fallar la transacción.',
      ),
      practice({
        prompt: '**`ana`** tiene 100 de saldo y **`bob`** 0 en la tabla **`cuentas`**. Transfiere **50** de ana a bob en **una sola transacción**: restar a ana (solo si tiene al menos 50) y sumar a bob. Usa el formato de la demo anterior.',
        goal: 'ana 50 · bob 50',
        setup: A('data-ddb-eventos'),
        check: all(saldo('ana', '50'), saldo('bob', '50')),
        solution: [tx(50), 'aws dynamodb scan --table-name cuentas --query "Items[].[id.S,saldo.N]" --output text'],
        hints: ['`aws dynamodb transact-write-items --transact-items \'[ {…ana…}, {…bob…} ]\'` con dos elementos `Update`.', 'Para ana: `"Update":{"TableName":"cuentas","Key":{"id":{"S":"ana"}},"UpdateExpression":"SET saldo = saldo - :m","ConditionExpression":"saldo >= :m","ExpressionAttributeValues":{":m":{"N":"50"}}}`.', 'Para bob el mismo `Update` pero con `SET saldo = saldo + :m` y sin condición.'],
        explain: 'Si algo fallase a medias, el dinero no se perdería ni se duplicaría. La condición y la atomicidad juntas son lo que hace útil una transacción.',
        par: 2,
        commands: ['aws dynamodb transact-write-items', 'Transacciones de DynamoDB'],
      }),
      learn(
        'Tablas globales, DAX y copias',
        `
**Tablas globales**: réplicas de la misma tabla en varias regiones, todas con lectura **y escritura** (multi-activo). Cada cambio se copia a las demás en ~1 segundo; si dos regiones escriben el mismo elemento a la vez, **gana la última escritura**. Requisitos: **streams con \`NEW_AND_OLD_IMAGES\`** y modo bajo demanda. Se añaden con \`update-table --replica-updates\`. Ojo: un borrado accidental también se replica.

**DAX**: una caché en memoria *delante* de DynamoDB, con la misma API, que baja las lecturas repetidas de milisegundos a **microsegundos**. Solo ayuda con lecturas eventualmente consistentes.

**Copias**: las **bajo demanda** (\`create-backup\`) no afectan al rendimiento; **PITR** (\`update-continuous-backups\`) permite volver a cualquier segundo de los últimos **35 días**. Restaurar siempre **crea una tabla nueva**.
`,
        '🌍',
      ),
      practice({
        prompt: 'La tienda abre en Europa. Haz que la tabla **`pedidos`** tenga también una **réplica en `eu-west-1`** (tabla global). Te hará falta algo antes: lee los errores.',
        goal: 'pedidos replicada en eu-west-1',
        setup: A('data-ddb-eventos'),
        check: awsHas('dynamodb describe-table --table-name pedidos --query "Table.Replicas[].RegionName"', 'eu-west-1', 'La tabla pedidos todavía no tiene réplica en eu-west-1'),
        solution: [
          'aws dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES',
          `aws dynamodb update-table --table-name pedidos --replica-updates '[{"Create":{"RegionName":"eu-west-1"}}]'`,
          'aws dynamodb describe-table --table-name pedidos --query "Table.Replicas[].RegionName"',
        ],
        hints: ['La réplica se pide con `aws dynamodb update-table --table-name pedidos --replica-updates \'[{"Create":{"RegionName":"eu-west-1"}}]\'`.', 'Si falla con un error de streams: las tablas globales usan el stream para copiar los cambios, así que primero actívalo con `--stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES`.'],
        explain: 'El stream con las dos imágenes es la base de la replicación. Ahora un usuario en Irlanda lee y escribe en su región con baja latencia, y la tabla sigue viva si cae una región.',
        par: 2,
        commands: ['Tablas globales de DynamoDB', 'DynamoDB Streams'],
      }),
      match(
        'Une cada problema con la pieza de DynamoDB',
        [
          ['Lecturas repetidas que necesitan microsegundos', 'DAX'],
          ['Usuarios en tres continentes con escrituras locales', 'Tabla global'],
          ['Volver al instante anterior a un borrado accidental', 'PITR'],
          ['Reaccionar a cada cambio con una función', 'Streams + Lambda'],
        ],
        'Cada necesidad tiene su pieza: caché (DAX), multi-región (tabla global), recuperación (PITR) y eventos (streams).',
      ),
    ]),
    // ───────────────────────── 3 ─────────────────────────
    lesson('a11-3', { title: 'RDS y Aurora a fondo', summary: 'Parámetros, RDS Proxy, Aurora Serverless y recuperación', emoji: '🗄️', commands: ['RDS', 'Aurora', 'Multi-AZ', 'Réplica de lectura', 'Grupo de parámetros de RDS', 'RDS Proxy', 'Aurora Serverless v2', 'Recuperación a un momento dado (PITR) de RDS', 'AWS Secrets Manager', 'aws rds modify-db-parameter-group', 'aws rds create-db-proxy'], minutes: 32 }, [
      learn(
        'Multi-AZ, réplicas y Aurora: cada cosa a lo suyo',
        `
Tres herramientas que se confunden y resuelven problemas distintos:

| | **Multi-AZ** | **Réplica de lectura** | **Aurora** |
| --- | --- | --- | --- |
| Para qué | **Disponibilidad**: si cae la zona, conmuta sola (1–2 min) | **Rendimiento**: repartir lecturas | Las dos cosas, de serie |
| Replicación | Síncrona, a una copia en espera | Asíncrona (puede ir con retraso) | Almacenamiento compartido, 6 copias en 3 zonas |
| ¿Se puede leer de la copia? | **No** (solo está en espera) | **Sí**, con su propio endpoint | Sí: hasta 15 lectoras |
| Promocionar | Automático | Manual (\`promote-read-replica\`) | Automático (\`failover-db-cluster\`) |

**Aurora** separa el cómputo del almacenamiento: un clúster tiene una instancia **escritora** y hasta 15 **lectoras** sobre el mismo volumen, con un endpoint de escritura y otro de **lectura** que reparte. Y existe **Aurora Serverless v2**, que ajusta la capacidad sola.
`,
        '🗄️',
      ),
      mc('El informe nocturno de ventas tumba tu base de datos principal de RDS cada madrugada. ¿Qué es lo más adecuado?', ['Activar Multi-AZ', 'Crear una réplica de lectura y apuntar el informe a ella', 'Subir el periodo de retención de copias', 'Apagar la base de datos por la noche'], 1, 'Multi-AZ da disponibilidad pero su copia no sirve lecturas. La réplica de lectura sí: el informe la usa y la principal queda libre para las escrituras.'),
      learn(
        'Los parámetros del motor',
        `
La configuración del motor (\`max_connections\`, \`log_min_duration_statement\`, \`binlog_format\`…) vive en un **grupo de parámetros**. Los grupos \`default.*\` **no se pueden modificar**: creas uno propio (\`create-db-parameter-group\`, con la **familia** del motor, como \`mysql8.0\`), cambias valores y se lo asignas a la instancia.

- **Dinámicos**: \`ApplyMethod=immediate\`, se aplican al momento.
- **Estáticos**: solo \`pending-reboot\`; hay que **reiniciar**.
- Asignar un grupo nuevo a una instancia deja su estado en **\`pending-reboot\`** hasta el siguiente reinicio.
- Muchos valores son **fórmulas** de la memoria: en MySQL \`max_connections\` = memoria ÷ 12.582.880. Una \`db.t3.micro\` (1 GiB) admite unas **85 conexiones**; una \`db.m5.large\` (8 GiB), unas 680.
`,
        '⚙️',
      ),
      demo(
        'Mirar la configuración de una base de datos',
        [
          ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[DBInstanceClass,Engine,BackupRetentionPeriod,DBParameterGroups[0].DBParameterGroupName]" --output text', 'Clase, motor, días de copias y grupo de parámetros asignado'],
          ['aws rds describe-db-parameters --db-parameter-group-name default.mysql8.0 --query "Parameters[?ParameterName==\'max_connections\'].[ParameterName,ParameterValue,ApplyType]" --output text', 'Una fórmula, y dinámico: se puede cambiar sin reiniciar'],
          ['aws rds describe-db-parameters --db-parameter-group-name default.mysql8.0 --query "Parameters[?ApplyType==\'static\'].ParameterName | [0:4]" --output text', 'Algunos parámetros estáticos (necesitan reinicio)'],
        ],
        A('data-rds'),
        'La instancia `tienda-db` es una MySQL pequeña. Su valor por defecto de `max_connections` depende de la memoria de la clase.',
      ),
      tf('«Puedes cambiar `max_connections` directamente en el grupo de parámetros `default.mysql8.0` con `ApplyMethod=immediate`.»', false, 'Los grupos por defecto son de solo lectura. Crea un grupo propio, modifícalo y asígnalo a la instancia (y reinicia para que quede `in-sync`).'),
      practice({
        prompt: 'La base **`tienda-db`** (MySQL, 85 conexiones) responde «Too many connections». Sube **`max_connections` a 300**: crea el grupo de parámetros **`mi-mysql`** (familia `mysql8.0`), cambia el valor, asígnaselo a la instancia y **reinicia** para que el estado quede `in-sync`.',
        goal: 'max_connections = 300 y el grupo en estado in-sync',
        setup: A('data-rds'),
        check: all(awsIs('_check dbparam --instance tienda-db --name max_connections --query Value', '300', 'max_connections todavía no vale 300'), awsIs('rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].DBParameterGroups[0].ParameterApplyStatus"', 'in-sync', 'El grupo asignado sigue pendiente de reinicio (pending-reboot)')),
        solution: [
          'aws rds create-db-parameter-group --db-parameter-group-name mi-mysql --db-parameter-group-family mysql8.0 --description "Tienda"',
          'aws rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=max_connections,ParameterValue=300,ApplyMethod=immediate',
          'aws rds modify-db-instance --db-instance-identifier tienda-db --db-parameter-group-name mi-mysql --apply-immediately',
          'aws rds reboot-db-instance --db-instance-identifier tienda-db',
          'aws rds wait db-instance-available --db-instance-identifier tienda-db',
          'aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].DBParameterGroups[0].ParameterApplyStatus"',
        ],
        hints: ['Primero crea tu grupo: `aws rds create-db-parameter-group --db-parameter-group-name mi-mysql --db-parameter-group-family mysql8.0 --description "Tienda"`. No puedes tocar el `default`.', '`aws rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=max_connections,ParameterValue=300,ApplyMethod=immediate`, y después asígnalo con `aws rds modify-db-instance --db-instance-identifier tienda-db --db-parameter-group-name mi-mysql --apply-immediately`.', 'El estado queda `pending-reboot`: `aws rds reboot-db-instance --db-instance-identifier tienda-db` y espera con `aws rds wait db-instance-available --db-instance-identifier tienda-db`.'],
        explain: 'Grupo propio → valor → asignación → reinicio. Aunque `max_connections` sea dinámico, cambiar el grupo de la instancia exige reiniciar para quedar sincronizada. En producción, hazlo en la ventana de mantenimiento o con Multi-AZ (que reduce el corte).',
        par: 5,
        commands: ['aws rds modify-db-parameter-group', 'Grupo de parámetros de RDS'],
      }),
      learn(
        'RDS Proxy: un grupo de conexiones gestionado',
        `
Subir \`max_connections\` ayuda, pero cada conexión consume memoria, y con **Lambda** el problema es otro: cada ejecución abre **su propia conexión**, de modo que mil ejecuciones simultáneas piden mil conexiones a una base que admite 85. El resultado: *ERROR 1040: Too many connections*.

**RDS Proxy** se sitúa entre tus funciones y la base de datos, mantiene un conjunto pequeño de conexiones abiertas y las **comparte** (multiplexación). Los clientes esperan un instante si hace falta, en vez de ser rechazados. Además acelera la conmutación por error y guarda las credenciales en **Secrets Manager**.

**Qué necesita**: un **secreto** con usuario y contraseña, un **rol** que confíe en \`rds.amazonaws.com\` y pueda leer ese secreto, subredes de la VPC y un grupo de seguridad. El de la base de datos debe **admitir al del proxy** en su puerto.

Tras \`register-db-proxy-targets\`, mira \`describe-db-proxy-targets\` → \`TargetHealth\`: \`AUTH_FAILURE\` (el rol no lee el secreto o la contraseña no coincide), \`CONNECTION_FAILED\` (red o grupo de seguridad).
`,
        '🔌',
      ),
      illus('aws-rds-proxy', 'Cuando las conexiones no caben', 'Sube las conexiones hasta que la base se queda sin ellas y luego pon el proxy delante.'),
      mc('Cientos de funciones Lambda se conectan a la vez a tu base de datos MySQL y fallan con «Too many connections». ¿Cuál es la solución más adecuada?', ['Multiplicar por diez el tamaño de la instancia', 'Poner un RDS Proxy delante de la base de datos', 'Cambiar a Memcached', 'Subir el timeout de las funciones'], 1, 'El proxy agrupa y comparte las conexiones: la base ve unas pocas, aunque las funciones sean cientos. Subir la instancia solo aplaza el problema.'),
      practice({
        prompt: 'Pon un **RDS Proxy** delante de **`tienda-db`**. Ya existen el secreto **`prod/tienda`** (usuario y contraseña) y el rol **`proxy-role`**, que confía en RDS pero **aún no puede leer el secreto**. Crea el proxy **`tienda-proxy`** (MYSQL), registra `tienda-db` como destino y consigue que su salud sea **`AVAILABLE`**. Si no lo es, `describe-db-proxy-targets` te dice por qué.',
        goal: 'El destino del proxy está AVAILABLE',
        setup: A('data-rds'),
        check: awsIs('rds describe-db-proxy-targets --db-proxy-name tienda-proxy --query "Targets[0].TargetHealth.State"', 'AVAILABLE', 'El destino del proxy todavía no está AVAILABLE: mira TargetHealth.Reason'),
        solution: [
          'SECRET=$(aws secretsmanager describe-secret --secret-id prod/tienda --query ARN --output text)',
          'ROLE=$(aws iam get-role --role-name proxy-role --query Role.Arn --output text)',
          'SUBNETS=$(aws ec2 describe-subnets --query "Subnets[?DefaultForAz].SubnetId | [0:2]" --output text)',
          'aws rds create-db-proxy --db-proxy-name tienda-proxy --engine-family MYSQL --auth "[{\\"AuthScheme\\":\\"SECRETS\\",\\"SecretArn\\":\\"$SECRET\\",\\"IAMAuth\\":\\"DISABLED\\"}]" --role-arn $ROLE --vpc-subnet-ids $SUBNETS',
          'aws rds register-db-proxy-targets --db-proxy-name tienda-proxy --db-instance-identifiers tienda-db',
          `aws iam put-role-policy --role-name proxy-role --policy-name lee-secreto --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"*"}]}'`,
          'PROXYSG=$(aws rds describe-db-proxies --query "DBProxies[0].VpcSecurityGroupIds[0]" --output text)',
          SG('DBSG', 'db-sg'),
          'aws ec2 authorize-security-group-ingress --group-id $DBSG --protocol tcp --port 3306 --source-group $PROXYSG',
          'aws rds describe-db-proxy-targets --db-proxy-name tienda-proxy --query "Targets[0].TargetHealth"',
        ],
        hints: ['Necesitas el ARN del secreto (`aws secretsmanager describe-secret --secret-id prod/tienda`), el del rol y dos subredes. `aws rds create-db-proxy … --auth \'[{"AuthScheme":"SECRETS","SecretArn":"…","IAMAuth":"DISABLED"}]\' --role-arn … --vpc-subnet-ids <s1> <s2>`; luego `aws rds register-db-proxy-targets --db-proxy-name tienda-proxy --db-instance-identifiers tienda-db`.', 'Espera un par de minutos y mira `aws rds describe-db-proxy-targets --db-proxy-name tienda-proxy`. Si pone `AUTH_FAILURE`, el rol no puede leer el secreto: `aws iam put-role-policy` con `secretsmanager:GetSecretValue`.', 'Si pone `CONNECTION_FAILED`, el grupo de seguridad de la base (`db-sg`) no admite al del proxy (`aws rds describe-db-proxies` → `VpcSecurityGroupIds`): `aws ec2 authorize-security-group-ingress --group-id <db-sg> --protocol tcp --port 3306 --source-group <sg-del-proxy>`.'],
        explain: 'Los dos fallos clásicos del proxy: el rol no puede leer el secreto (`AUTH_FAILURE`) y la base no admite al grupo de seguridad del proxy (`CONNECTION_FAILED`). Ahora las aplicaciones se conectan al **endpoint del proxy** en lugar del de la base de datos.',
        par: 9,
        commands: ['aws rds create-db-proxy', 'RDS Proxy', 'AWS Secrets Manager'],
      }),
      learn(
        'Aurora Serverless v2',
        `
Con **Aurora Serverless v2** no eliges una clase de instancia fija: fijas un **mínimo** y un **máximo** de **ACU** (cada una ≈ 2 GiB de memoria con su CPU) en el clúster y la capacidad sube y baja sola, **sin cortar conexiones**, en fracciones de 0,5 ACU. Pagas por ACU-segundo realmente usada.

- Se configura en el **clúster** (\`--serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=8\`) y las instancias usan la clase especial **\`db.serverless\`**. Sin esa configuración, \`create-db-instance\` te lo exige.
- El **máximo** es tu protección de gasto; el **mínimo** bajo ahorra pero obliga a "calentar" después.
- Ideal para desarrollo, cargas con picos o muy desiguales. Para carga alta y constante, las instancias aprovisionadas con reserva salen más baratas.
`,
        '📈',
      ),
      practice({
        prompt: 'El clúster **`aurora-tienda`** (Aurora MySQL) existe pero está vacío: no tiene ninguna instancia. Haz que escale solo **entre 0,5 y 4 ACU** y crea su instancia escritora **`aurora-1`** de clase **`db.serverless`**.',
        goal: 'Clúster serverless v2 (0,5–4 ACU) con la instancia aurora-1',
        setup: A('data-rds'),
        check: all(awsIs('rds describe-db-clusters --db-cluster-identifier aurora-tienda --query "DBClusters[0].ServerlessV2ScalingConfiguration"', { MinCapacity: 0.5, MaxCapacity: 4 }, 'El clúster necesita MinCapacity=0.5 y MaxCapacity=4'), awsIs('rds describe-db-instances --db-instance-identifier aurora-1 --query "DBInstances[0].DBInstanceClass"', 'db.serverless', 'Falta la instancia aurora-1 de clase db.serverless')),
        solution: ['aws rds modify-db-cluster --db-cluster-identifier aurora-tienda --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4', 'aws rds create-db-instance --db-instance-identifier aurora-1 --db-instance-class db.serverless --engine aurora-mysql --db-cluster-identifier aurora-tienda'],
        hints: ['La escala se define en el clúster: `aws rds modify-db-cluster --db-cluster-identifier aurora-tienda --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4`.', 'Después, la instancia: `aws rds create-db-instance --db-instance-identifier aurora-1 --db-instance-class db.serverless --engine aurora-mysql --db-cluster-identifier aurora-tienda`.'],
        explain: 'Clúster primero (la escala), instancia después (`db.serverless`). Si intentas crear la instancia antes, AWS te recuerda que falta la configuración de ACU.',
        par: 2,
        commands: ['Aurora Serverless v2', 'Aurora'],
      }),
      learn(
        'Volver atrás: copias y recuperación a un momento dado',
        `
RDS hace una **copia diaria** y guarda los **registros de transacciones**; con eso, la **recuperación a un momento dado (PITR)** crea una **instancia nueva** con el estado de cualquier segundo del periodo de retención (hasta 35 días).

- Con retención **0** no hay copias automáticas y por tanto no hay PITR.
- Siempre crea una instancia **nueva** (otro endpoint): cambias la aplicación a ella o renombras. No pisa a la original.
- Sirve igual para **deshacer** un \`DROP TABLE\` que para **clonar producción** y probar una migración con datos reales.
- Las copias automáticas se borran con la instancia; los *snapshots* manuales no.
`,
        '⏪',
      ),
      demo(
        'Un clon de producción',
        [
          ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].BackupRetentionPeriod"', 'Siete días de copias automáticas'],
          ['aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier tienda-db --target-db-instance-identifier tienda-clon --use-latest-restorable-time --query DBInstance.DBInstanceStatus --output text', 'Una instancia nueva: empieza en `creating`'],
          ['aws rds wait db-instance-available --db-instance-identifier tienda-clon', 'Espera a que termine (unos minutos)'],
          ['aws rds describe-db-instances --query "DBInstances[].DBInstanceIdentifier" --output text', 'Ahora hay dos: la original no se ha tocado'],
        ],
        A('data-rds'),
        'Con `--restore-time <fecha ISO>` eliges el instante exacto; `--use-latest-restorable-time` toma el último disponible (unos 5 minutos atrás).',
      ),
      match(
        'Une cada necesidad con la solución de RDS',
        [
          ['Conmutación automática si cae la zona', 'Multi-AZ'],
          ['Repartir las lecturas de un informe', 'Réplica de lectura'],
          ['Cientos de funciones Lambda con pocas conexiones', 'RDS Proxy'],
          ['Carga impredecible sin elegir tamaño', 'Aurora Serverless v2'],
          ['Volver a las 10:03 de ayer', 'PITR'],
        ],
        'Cada problema, su pieza: disponibilidad (Multi-AZ), lecturas (réplica), conexiones (proxy), capacidad variable (Serverless v2) y recuperación (PITR).',
      ),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a11-4', { title: 'Cachés: ElastiCache y patrones', summary: 'Servir en microsegundos lo que se repite, sin servir datos caducados', emoji: '⚡', commands: ['ElastiCache', 'Patrones de caché', 'Redis frente a Memcached', 'Lambda en una VPC', 'aws elasticache create-replication-group', 'aws elasticache test-failover'], minutes: 30 }, [
      learn(
        'Una caché delante de la base de datos',
        `
Casi todas las aplicaciones leen mucho más de lo que escriben, y gran parte de lo que leen **se repite** (el catálogo, el perfil, una configuración). Una **caché en memoria** guarda esas respuestas y las sirve en **microsegundos**, quitando carga a la base de datos. **ElastiCache** ofrece dos motores:

- **Redis / Valkey**: estructuras de datos, réplicas, conmutación automática, copias. La opción por defecto.
- **Memcached**: clave-valor simple y multihilo, sin réplicas ni persistencia.

El patrón más usado es **cache-aside**: la aplicación mira la caché; si el dato no está (*miss*), lo lee de la base de datos y lo guarda con un **TTL**; si está (*hit*), responde directamente. Lo único que pagas es la **posible desactualización** hasta que el TTL caduque.
`,
        '⚡',
      ),
      illus('aws-cache-patterns', 'Los cuatro patrones', 'Recorre cada patrón, juega con el acierto o el fallo y mira qué ocurre cuando el dato cambia en la base de datos.'),
      mc('La aplicación consulta Redis; si el valor no está, lo lee de la base de datos y lo guarda en Redis con caducidad. ¿Qué patrón es?', ['Cache-aside', 'Write-through', 'Write-behind', 'Replicación Multi-AZ'], 0, 'En cache-aside la **aplicación** gestiona la caché: la consulta, la rellena en un fallo y la invalida al escribir.'),
      order('Tras un fallo (miss) en cache-aside, ¿en qué orden se hacen estas operaciones?', ['GET', 'SELECT', 'SETEX', 'respuesta'], 'GET SELECT SETEX respuesta', 'Primero `GET` en Redis (fallo), luego `SELECT` en la base de datos, después `SETEX` (guardar con TTL) y finalmente se responde. La siguiente petición ya acertará.'),
      learn(
        'ElastiCache vive dentro de tu VPC',
        `
Una caché **no tiene dirección pública**: sus nodos están en las subredes de tu VPC. Para montarla:

1. **Grupo de subredes de caché** (\`create-cache-subnet-group\`): las subredes donde puede poner nodos; con dos zonas para tolerar caídas.
2. **Grupo de replicación** (\`create-replication-group\`): un nodo **primario** y réplicas. Con \`--automatic-failover-enabled\` y \`--multi-az-enabled\`, si cae el primario se promueve una réplica y el **endpoint primario no cambia**.
3. **Grupo de seguridad** de la caché: abre el puerto **6379** (Redis) solo al grupo de seguridad de tu aplicación.
4. Si el cliente (una **Lambda**) está en la VPC, necesita su configuración de VPC (\`--vpc-config\`), un rol con \`AWSLambdaVPCAccessExecutionRole\` y la dirección del **endpoint primario** en una variable de entorno.

Con un **auth token** hay que activar también el **cifrado en tránsito**, y entonces el cliente debe conectar con TLS.
`,
        '🧱',
      ),
      tf('«Si un grupo de seguridad de ElastiCache abre el puerto 6379 a `0.0.0.0/0`, cualquiera puede conectar desde Internet con el endpoint.»', false, 'Los nodos están en subredes privadas y el endpoint resuelve a una IP privada: no hay camino desde Internet. Aun así, abrir a `0.0.0.0/0` es mala práctica: ábrelo solo al grupo de la aplicación.'),
      practice({
        prompt:
          'La función **`catalogo`** (Python) usa Redis como caché de productos con *cache-aside*, pero aún no tiene caché: lee la dirección de la variable **`CACHE`**. Monta todo en la VPC **`app`**:\n\n1. Un grupo de subredes de caché con **todas** las subredes de la VPC.\n2. Un grupo de replicación Redis **`catalogo-cache`** (`cache.t4g.micro`, 2 nodos, failover automático y Multi-AZ) con el grupo de seguridad **`cache-sg`**.\n3. Abre el **6379** de `cache-sg` **solo** al grupo **`app-sg`**.\n4. Pon la función en la VPC (esas subredes y `app-sg`) y su variable `CACHE` con el **endpoint primario**.\n\nLa primera petición de un producto tarda (consulta "lenta"); la segunda sale de la caché.',
        goal: 'La segunda petición del mismo producto sale de la caché',
        setup: A('data-cache'),
        check: awsAfter([`_check invoke --function catalogo --payload '{"id":"1"}'`], awsIs(`_check invoke --function catalogo --payload '{"id":"1"}' --query Payload.origen`, 'cache', 'La segunda petición todavía no sale de la caché (¿función en la VPC? ¿puerto 6379? ¿variable CACHE?)')),
        solution: [
          VPC_APP,
          SUBNETS_APP,
          SUBNETS_CSV,
          SG('APPSG', 'app-sg'),
          SG('CACHESG', 'cache-sg'),
          'aws elasticache create-cache-subnet-group --cache-subnet-group-name app-cache --cache-subnet-group-description "Cachés de la app" --subnet-ids $SUBNETS',
          'aws elasticache create-replication-group --replication-group-id catalogo-cache --replication-group-description "Caché del catálogo" --engine redis --cache-node-type cache.t4g.micro --num-cache-clusters 2 --automatic-failover-enabled --multi-az-enabled --cache-subnet-group-name app-cache --security-group-ids $CACHESG',
          'aws ec2 authorize-security-group-ingress --group-id $CACHESG --protocol tcp --port 6379 --source-group $APPSG',
          'aws elasticache wait replication-group-available --replication-group-id catalogo-cache',
          `HOST=$(aws elasticache describe-replication-groups --replication-group-id catalogo-cache --query "ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address" --output text)`,
          'aws iam attach-role-policy --role-name catalogo-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
          'aws lambda update-function-configuration --function-name catalogo --vpc-config SubnetIds=$SUBNETS_CSV,SecurityGroupIds=$APPSG --environment "Variables={CACHE=$HOST}"',
          INVOKE('{"id":"1"}'),
          INVOKE('{"id":"1"}'),
        ],
        hints: [
          'Los ids los sacas con `aws ec2 describe-vpcs --filters Name=tag:Name,Values=app`, `describe-subnets --filters Name=vpc-id,Values=<vpc>` y `describe-security-groups --filters Name=group-name,Values=app-sg` (y `cache-sg`). Después: `aws elasticache create-cache-subnet-group --cache-subnet-group-name app-cache --cache-subnet-group-description … --subnet-ids <s1> <s2>`.',
          '`aws elasticache create-replication-group --replication-group-id catalogo-cache --replication-group-description … --engine redis --cache-node-type cache.t4g.micro --num-cache-clusters 2 --automatic-failover-enabled --multi-az-enabled --cache-subnet-group-name app-cache --security-group-ids <cache-sg>`; después `aws ec2 authorize-security-group-ingress --group-id <cache-sg> --protocol tcp --port 6379 --source-group <app-sg>` y `aws elasticache wait replication-group-available --replication-group-id catalogo-cache`.',
          'El endpoint está en `describe-replication-groups` → `NodeGroups[0].PrimaryEndpoint.Address`. La función: `aws lambda update-function-configuration --function-name catalogo --vpc-config SubnetIds=<s1>,<s2>,SecurityGroupIds=<app-sg> --environment "Variables={CACHE=<endpoint>}"`. Si dice que el rol no puede crear interfaces de red, añade `AWSLambdaVPCAccessExecutionRole` a `catalogo-role`.',
        ],
        explain: 'Cinco piezas que tienen que encajar: subredes de caché, grupo de replicación, grupo de seguridad (puerto 6379 solo para la función), función en la VPC con su rol y el endpoint en una variable de entorno. La primera petición cuesta 400 ms; la segunda, un instante.',
        par: 12,
        commands: ['aws elasticache create-replication-group', 'Lambda en una VPC', 'ElastiCache'],
      }),
      mc('Tu función Lambda (dentro de la VPC) se queda esperando y acaba con «Task timed out» al conectar con Redis. ¿Cuál es la causa más probable?', ['La clave de Redis es demasiado larga', 'El grupo de seguridad de la caché no admite al grupo de la función en el puerto 6379', 'Redis no admite Python', 'La función tiene demasiada memoria'], 1, 'Un fallo de red no devuelve un error rápido: el paquete se descarta y el cliente espera. Revisa primero los grupos de seguridad (6379 desde el grupo de la función) y que la función esté en la misma VPC.'),
      learn(
        'Alta disponibilidad de la caché',
        `
Un grupo de replicación con **un solo nodo** pierde todo si el nodo cae. Para sobrevivir:

- Añade **réplicas** (\`increase-replica-count\`), idealmente en **otra zona**.
- Activa el **failover automático** y **Multi-AZ** (\`modify-replication-group\`): si cae el primario, una réplica pasa a primaria en ~30 segundos y el **endpoint primario sigue siendo el mismo**.
- **Pruébalo** con \`test-failover\` antes de necesitarlo, y comprueba que tu aplicación **vuelve a conectar sola**.
- La conmutación pierde las últimas escrituras no replicadas (la replicación es asíncrona): la caché no es el único sitio donde guardar un dato que no puedas reconstruir.
`,
        '🛟',
      ),
      practice({
        prompt: 'El grupo **`sesiones`** guarda las sesiones de usuario en **un solo nodo**: si cae, todos pierden la sesión. Dale una **réplica**, activa **failover automático y Multi-AZ**, y **comprueba la conmutación** con una prueba de failover (la réplica debe pasar a primaria).',
        goal: 'sesiones con failover y Multi-AZ, y la réplica es ahora la primaria',
        setup: A('data-cache'),
        check: all(awsIs(cacheGroup('sesiones', 'ReplicationGroups[0].AutomaticFailover').replace(' --output text', ''), 'enabled', 'Falta activar el failover automático'), awsIs(cacheGroup('sesiones', 'ReplicationGroups[0].MultiAZ').replace(' --output text', ''), 'enabled', 'Falta activar Multi-AZ'), awsIs(cacheGroup('sesiones', "ReplicationGroups[0].NodeGroups[0].NodeGroupMembers[?CurrentRole=='primary'].CacheClusterId | [0]").replace(' --output text', ''), 'sesiones-002', 'Falta hacer la prueba de failover: la réplica aún no es la primaria')),
        solution: [
          'aws elasticache increase-replica-count --replication-group-id sesiones --new-replica-count 1 --apply-immediately',
          'aws elasticache wait replication-group-available --replication-group-id sesiones',
          'aws elasticache modify-replication-group --replication-group-id sesiones --automatic-failover-enabled --multi-az-enabled --apply-immediately',
          'aws elasticache wait replication-group-available --replication-group-id sesiones',
          'aws elasticache test-failover --replication-group-id sesiones --node-group-id 0001',
          'aws elasticache wait replication-group-available --replication-group-id sesiones',
          `aws ${cacheGroup('sesiones', 'ReplicationGroups[0].NodeGroups[0].NodeGroupMembers[].[CacheClusterId,CurrentRole]')}`,
        ],
        hints: ['Primero una réplica: `aws elasticache increase-replica-count --replication-group-id sesiones --new-replica-count 1 --apply-immediately`. Espera con `aws elasticache wait replication-group-available --replication-group-id sesiones`.', '`aws elasticache modify-replication-group --replication-group-id sesiones --automatic-failover-enabled --multi-az-enabled --apply-immediately` (otra espera después).', 'La prueba: `aws elasticache test-failover --replication-group-id sesiones --node-group-id 0001`. Mira después quién es el primario en `describe-replication-groups`.'],
        explain: 'Réplica, failover automático, Multi-AZ y una prueba real. Fíjate en que el endpoint primario no cambia: tu aplicación sigue apuntando al mismo nombre, que ahora resuelve al nuevo primario.',
        par: 7,
        commands: ['aws elasticache test-failover', 'ElastiCache'],
      }),
      match(
        'Une cada patrón de caché con su riesgo',
        [
          ['Cache-aside', 'Datos viejos hasta que caduque el TTL'],
          ['Read-through', 'La app depende de la caché para cargar'],
          ['Write-through', 'Escrituras más lentas'],
          ['Write-behind', 'Pérdida de datos si la caché cae antes del volcado'],
        ],
        'Cada patrón cambia quién carga la caché y cuándo se escribe en la base de datos: de ahí su riesgo principal. Write-behind es el más peligroso para datos que no puedes perder.',
      ),
      mc('Necesitas una caché de sesiones con réplicas y conmutación automática si cae un nodo. ¿Qué eliges?', ['Memcached con 3 nodos', 'Redis con un grupo de replicación, failover automático y Multi-AZ', 'Una tabla de RDS', 'Un bucket de S3'], 1, 'Memcached no tiene réplicas ni failover. Redis con grupo de replicación sí; si las sesiones no deben perderse nunca, MemoryDB (durable) o una base de datos son alternativas.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a11-5', { title: 'Migración: DMS, DataSync y Snow', summary: 'Mover bases de datos y archivos a AWS sin pararlo todo', emoji: '🚚', commands: ['AWS DMS', 'Captura de cambios (CDC)', 'AWS DataSync', 'Familia AWS Snow', 'Elegir cómo migrar datos', 'aws dms create-replication-task', 'aws dms test-connection', 'aws datasync create-task', 'aws datasync start-task-execution'], minutes: 32 }, [
      learn(
        'Tres formas de mover datos',
        `
Antes de elegir herramienta, pregunta **qué** mueves y **cuánto**:

- **Una base de datos**, con la aplicación funcionando → **AWS DMS**. Hace una carga completa y después replica los cambios hasta el momento del corte. Si cambia el motor (Oracle → PostgreSQL), se convierte antes el esquema con **AWS SCT**.
- **Archivos** (carpetas NFS/SMB de la oficina) → **AWS DataSync**: copias rápidas, programadas, solo de lo que cambió.
- **Cientos de terabytes** o una línea lenta → **AWS Snow** (Snowball Edge): un dispositivo físico que llenas y devuelves.

La cuenta que decide: **datos × 8 ÷ ancho de banda**. 50 TB por una línea de 200 Mbps son casi **dos meses** sin parar; un Snowball tarda 1–2 semanas con el envío.
`,
        '🚚',
      ),
      illus('aws-migration', 'Tres caminos de migración', 'Recorre las fases de DMS y compara cuántos días tardaría la red frente a un Snowball.'),
      mc('Quieres copiar cada noche 40 TB de archivos de un servidor NFS de tu oficina a S3, y solo lo que ha cambiado. ¿Qué usas?', ['AWS DMS', 'AWS DataSync', 'Una instancia EC2 con un script', 'AWS Snowball Edge solo una vez'], 1, 'DataSync está hecho para eso: agente en la oficina, tarea programada y transferencia incremental con verificación. DMS es para bases de datos.'),
      learn(
        'DMS: instancia, endpoints y tarea',
        `
Una migración con DMS tiene tres piezas:

1. **Instancia de replicación**: un servidor gestionado que ejecuta el trabajo (tarda unos minutos en crearse).
2. **Endpoints**: el **origen** y el **destino**. Una base de datos (servidor, puerto, usuario, contraseña), un bucket de **S3** o una tabla de **DynamoDB** (con un **rol** que DMS pueda asumir).
3. **Tarea**: \`full-load\`, \`cdc\` o \`full-load-and-cdc\`, con *reglas de mapeo* que eligen las tablas (\`"schema-name":"tienda","table-name":"%"\`).

Antes de arrancar, **prueba cada conexión** (\`test-connection\`) desde la instancia: red (el **grupo de seguridad** del origen debe admitir a la instancia), credenciales y permisos del rol. El resultado sale en \`describe-connections\`, con el motivo si falla. Y para crear un **grupo de subredes de replicación** la cuenta necesita el rol **\`dms-vpc-role\`**.
`,
        '🔁',
      ),
      demo(
        'Crear la instancia de replicación y esperar',
        [
          ['aws iam get-role --role-name dms-s3-role --query "Role.AssumeRolePolicyDocument.Statement[0].Principal.Service" --output text', 'El rol del destino S3 confía en DMS'],
          ['aws dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro --query ReplicationInstance.ReplicationInstanceStatus --output text', 'Empieza en `creating`'],
          ['aws dms wait replication-instance-available', 'Espera unos minutos (virtuales) hasta que esté lista'],
          ['aws dms describe-replication-instances --query "ReplicationInstances[0].[ReplicationInstanceIdentifier,ReplicationInstanceStatus]" --output text', 'Ya está `available`'],
        ],
        A('data-dms'),
        'Los waiters (`aws dms wait …`) esperan por ti en vez de repetir `describe-…` a mano.',
      ),
      practice({
        prompt:
          'Migra con una **carga completa** las tablas del esquema **`tienda`** de la base MySQL **`legado`** (usuario `admin`, contraseña `Secreto123`) al lago de datos **`lago-datos`**, dentro de la carpeta **`raw`**. La tabla `sistema.auditoria` **no** debe migrarse. En `mapeo.json` tienes las reglas de selección y en `permisos-s3.json` una política para el rol **`dms-s3-role`** (confía en DMS pero no puede escribir). Hay obstáculos: usa `describe-connections` para leer los motivos.',
        goal: 'raw/ del lago contiene solo pedidos y clientes',
        setup: A('data-dms', {
          files: {
            '/home/alumno/mapeo.json': JSON.stringify({ rules: [{ 'rule-type': 'selection', 'rule-id': '1', 'rule-name': 'tienda', 'object-locator': { 'schema-name': 'tienda', 'table-name': '%' }, 'rule-action': 'include' }] }),
            '/home/alumno/permisos-s3.json': JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::lago-datos', 'arn:aws:s3:::lago-datos/*'] }] }),
          },
        }),
        check: awsIs('s3api list-objects-v2 --bucket lago-datos --prefix raw/ --query "sort(Contents[].Key)"', ['raw/tienda/clientes/LOAD00000001.csv', 'raw/tienda/pedidos/LOAD00000001.csv'], 'El lago debería tener solo los datos de tienda.clientes y tienda.pedidos bajo raw/'),
        solution: [
          SG('DBSG', 'legado-sg'),
          'aws ec2 authorize-security-group-ingress --group-id $DBSG --protocol tcp --port 3306 --cidr 172.31.0.0/16',
          'aws iam put-role-policy --role-name dms-s3-role --policy-name escribir-lago --policy-document file://permisos-s3.json',
          'aws dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro',
          'HOST=$(aws rds describe-db-instances --db-instance-identifier legado --query "DBInstances[0].Endpoint.Address" --output text)',
          'SRC=$(aws dms create-endpoint --endpoint-identifier origen --endpoint-type source --engine-name mysql --server-name $HOST --port 3306 --username admin --password Secreto123 --query Endpoint.EndpointArn --output text)',
          'DST=$(aws dms create-endpoint --endpoint-identifier destino --endpoint-type target --engine-name s3 --s3-settings BucketName=lago-datos,ServiceAccessRoleArn=arn:aws:iam::123456789012:role/dms-s3-role,BucketFolder=raw --query Endpoint.EndpointArn --output text)',
          'aws dms wait replication-instance-available',
          'INST=$(aws dms describe-replication-instances --query "ReplicationInstances[0].ReplicationInstanceArn" --output text)',
          'aws dms test-connection --replication-instance-arn $INST --endpoint-arn $SRC',
          'aws dms test-connection --replication-instance-arn $INST --endpoint-arn $DST',
          'aws dms wait test-connection-succeeds --replication-instance-arn $INST --endpoint-arn $SRC',
          'aws dms wait test-connection-succeeds --replication-instance-arn $INST --endpoint-arn $DST',
          'TASK=$(aws dms create-replication-task --replication-task-identifier carga-tienda --source-endpoint-arn $SRC --target-endpoint-arn $DST --replication-instance-arn $INST --migration-type full-load --table-mappings file://mapeo.json --query ReplicationTask.ReplicationTaskArn --output text)',
          'aws dms start-replication-task --replication-task-arn $TASK --start-replication-task-type start-replication',
          'aws dms wait replication-task-stopped --replication-task-arn $TASK',
          'aws s3 ls s3://lago-datos/raw/ --recursive',
        ],
        hints: [
          'Orden: abre el 3306 de la base al origen de la instancia (`aws ec2 authorize-security-group-ingress --group-id <legado-sg> --protocol tcp --port 3306 --cidr 172.31.0.0/16`), dale permisos al rol (`aws iam put-role-policy … --policy-document file://permisos-s3.json`) y crea la instancia (`aws dms create-replication-instance … --replication-instance-class dms.t3.micro`).',
          'Endpoints: `aws dms create-endpoint --endpoint-type source --engine-name mysql --server-name <endpoint de legado> --port 3306 --username admin --password Secreto123 …` y `--endpoint-type target --engine-name s3 --s3-settings BucketName=lago-datos,ServiceAccessRoleArn=<arn del rol>,BucketFolder=raw`. Prueba cada uno con `aws dms test-connection` y lee `aws dms describe-connections`.',
          'Tarea: `aws dms create-replication-task … --migration-type full-load --table-mappings file://mapeo.json`; arráncala con `aws dms start-replication-task --replication-task-arn <arn> --start-replication-task-type start-replication` y espera con `aws dms wait replication-task-stopped --replication-task-arn <arn>`.',
        ],
        explain: 'Instancia → endpoints → pruebas de conexión → tarea. Los dos obstáculos eran los clásicos: el grupo de seguridad de la base no admitía a la instancia y el rol de S3 no podía escribir. `describe-connections` te los explicaba con todas las letras.',
        par: 17,
        commands: ['aws dms test-connection', 'aws dms create-replication-task', 'AWS DMS'],
      }),
      learn(
        'Replicación continua (CDC) y el corte',
        `
Una carga completa tarda horas; mientras tanto, el origen **sigue recibiendo cambios**. Con \`full-load-and-cdc\`, DMS hace la carga y después aplica los cambios leyendo el **registro de transacciones** de la base de origen hasta que el destino va solo unos segundos por detrás. Entonces haces el **corte**: paras las escrituras, esperas retraso 0 y apuntas la aplicación al destino.

El origen tiene que **registrar los cambios**:

| Motor | Qué necesita |
| --- | --- |
| MySQL / MariaDB / Aurora MySQL | Copias automáticas activas y \`binlog_format = ROW\` |
| PostgreSQL / Aurora PostgreSQL | \`rds.logical_replication = 1\` (**estático**: reiniciar) |

Si falta, la tarea falla al arrancar con un mensaje que lo explica.
`,
        '🔄',
      ),
      mc('La tarea `full-load-and-cdc` sobre una MySQL de RDS falla al arrancar con «binlog_format=ROW». ¿Qué hay que hacer?', ['Subir la clase de la instancia de replicación', 'Poner `binlog_format=ROW` en un grupo de parámetros propio de la base de origen (y reiniciar si hace falta)', 'Cambiar el destino a DynamoDB', 'Usar DataSync'], 1, 'Para leer los cambios, DMS necesita que MySQL registre el binlog en formato ROW. Se cambia en el grupo de parámetros del origen (como en la lección anterior) y se vuelve a arrancar la tarea.'),
      learn(
        'DataSync y los dispositivos Snow',
        `
**DataSync** copia archivos entre almacenamientos locales y AWS (S3, EFS, FSx). Instalas un **agente** en tu red (debe estar \`ONLINE\`), creas dos **ubicaciones** y una **tarea**:

- Para S3, la ubicación lleva un **rol** que confía en \`datasync.amazonaws.com\`. DataSync **comprueba al crearla** que el rol puede listar, leer y escribir en el bucket.
- Filtros: \`--includes "FilterType=SIMPLE_PATTERN,Value=/ventas*"\` copia solo esa carpeta.
- Opciones: \`TransferMode=CHANGED\` (solo lo modificado), \`OverwriteMode\`, \`PreserveDeletedFiles=REMOVE\` (reflejar los borrados).
- Cada ejecución pasa por LAUNCHING → PREPARING → TRANSFERRING → VERIFYING → SUCCESS.

**Snow**: cuando la red no da abasto, **Snowball Edge** (hasta ~210 TB) viaja a tu centro de datos, lo llenas, lo devuelves y AWS lo vuelca en S3. Los datos viajan cifrados con una clave tuya.
`,
        '📦',
      ),
      practice({
        prompt:
          'En la oficina hay una carpeta compartida **NFS** (`10.0.0.5:/exports/ventas`) con las subcarpetas `ventas/` y `logs/`, y un agente de DataSync **ONLINE**. Copia **solo `ventas`** al bucket **`archivo-oficina`**, dentro de **`in/`**:\n\n1. Dale permisos al rol **`datasync-role`** (`permisos-s3.json`; confía en DataSync pero no puede tocar el bucket).\n2. Crea las dos ubicaciones y una tarea con el filtro **`/ventas*`**.\n3. Ejecútala.',
        goal: 'in/ventas/ contiene los archivos; los logs no se copian',
        setup: A('data-sync', { files: { '/home/alumno/permisos-s3.json': JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:ListBucket', 's3:GetBucketLocation', 's3:PutObject', 's3:GetObject'], Resource: ['arn:aws:s3:::archivo-oficina', 'arn:aws:s3:::archivo-oficina/*'] }] }) } }),
        check: awsIs('s3api list-objects-v2 --bucket archivo-oficina --query "sort(Contents[].Key)"', ['in/ventas/2024.csv', 'in/ventas/2025.csv'], 'El bucket debería contener solo in/ventas/2024.csv y in/ventas/2025.csv'),
        solution: [
          'aws iam put-role-policy --role-name datasync-role --policy-name s3 --policy-document file://permisos-s3.json',
          'AGENT=$(aws datasync list-agents --query "Agents[0].AgentArn" --output text)',
          'DST=$(aws datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::archivo-oficina --s3-config BucketAccessRoleArn=arn:aws:iam::123456789012:role/datasync-role --subdirectory /in --query LocationArn --output text)',
          'SRC=$(aws datasync create-location-nfs --server-hostname 10.0.0.5 --subdirectory /exports/ventas --on-prem-config AgentArns=$AGENT --query LocationArn --output text)',
          'TASK=$(aws datasync create-task --source-location-arn $SRC --destination-location-arn $DST --name ventas --includes "FilterType=SIMPLE_PATTERN,Value=/ventas*" --query TaskArn --output text)',
          'EXEC=$(aws datasync start-task-execution --task-arn $TASK --query TaskExecutionArn --output text)',
          'aws datasync describe-task-execution --task-execution-arn $EXEC --query Status',
          'aws s3 ls s3://archivo-oficina/in/ --recursive',
        ],
        hints: ['Primero el permiso del rol: `aws iam put-role-policy --role-name datasync-role --policy-name s3 --policy-document file://permisos-s3.json`. Sin él, `create-location-s3` falla comprobando el acceso. El agente: `aws datasync list-agents`.', '`aws datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::archivo-oficina --s3-config BucketAccessRoleArn=<arn del rol> --subdirectory /in` y `aws datasync create-location-nfs --server-hostname 10.0.0.5 --subdirectory /exports/ventas --on-prem-config AgentArns=<arn del agente>`.', '`aws datasync create-task --source-location-arn … --destination-location-arn … --includes "FilterType=SIMPLE_PATTERN,Value=/ventas*"` y `aws datasync start-task-execution --task-arn …`.'],
        explain: 'El filtro `/ventas*` dejó fuera los logs, y las ejecuciones siguientes copiarán solo lo que cambie. El rol con permisos mínimos sobre el bucket es lo que DataSync verifica antes de dejarte crear la ubicación.',
        par: 8,
        commands: ['aws datasync create-task', 'aws datasync start-task-execution', 'AWS DataSync'],
      }),
      tf('«Para mover 300 TB por una línea de 100 Mbps, lo más razonable es DataSync, aunque tarde casi un año.»', false, 'A 100 Mbps, 300 TB tardan unos 280 días sin parar. Un Snowball Edge (con varios dispositivos en paralelo) lo resuelve en semanas. Regla práctica: si por red tardas más de una semana, piensa en Snow.'),
      match(
        'Elige la herramienta de migración',
        [
          ['Base de datos Oracle a Aurora PostgreSQL sin parar', 'DMS + SCT'],
          ['Carpeta NFS que cambia a diario', 'DataSync'],
          ['500 TB y poca red', 'Snowball Edge'],
          ['Que los servidores locales vean S3 como un disco', 'Storage Gateway'],
        ],
        'DMS para bases de datos (con SCT al cambiar de motor), DataSync para archivos con cambios, Snow para volúmenes enormes y Storage Gateway para acceso híbrido continuo.',
      ),
    ]),
  ],
  boss: {
    prompt:
      'Misión final: **«El catálogo que no se cae»**. La tienda tiene la tabla **`productos`** (con tres productos) y la función **`catalogo`**, que consulta una caché Redis y, si no está, lee de DynamoDB. Hoy no hay caché, la función no está en la VPC **`app`** (sin salida a Internet) y hay un montón de carritos abandonados. Déjalo todo en producción:\n\n1. Una caché Redis **`catalogo-cache`** (`cache.t4g.micro`, 2 nodos, failover y Multi-AZ) en las subredes de `app`, con el grupo **`cache-sg`**, que solo admite al grupo **`app-sg`** en el puerto 6379.\n2. La función **`catalogo`** en la VPC (subredes de `app` y `app-sg`) con la variable `CACHE`. Ojo: dentro de la VPC no llega a DynamoDB sin algo más.\n3. **Recuperación a un momento dado (PITR)** en `productos`.\n4. **TTL** en `carritos` sobre el atributo `expira` (hay dos caducados que deben desaparecer).\n\nCuando termines: pedir el producto `p2` dos veces devuelve **«Taza» desde la caché**.',
    goal: 'catalogo sirve p2 desde la caché dentro de la VPC, con PITR en productos y TTL en carritos',
    setup: A('data-boss'),
    check: all(
      awsAfter([`_check invoke --function catalogo --payload '{"id":"p2"}'`], awsIs(`_check invoke --function catalogo --payload '{"id":"p2"}' --query Payload`, { origen: 'cache', producto: 'Taza' }, 'La segunda petición de p2 debe salir de la caché con «Taza» (¿VPC? ¿endpoint de DynamoDB? ¿puerto 6379? ¿variable CACHE?)')),
      awsIs(cacheGroup('catalogo-cache', 'ReplicationGroups[0].MultiAZ').replace(' --output text', ''), 'enabled', 'La caché necesita failover automático y Multi-AZ'),
      awsIs('dynamodb describe-continuous-backups --table-name productos --query ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus', 'ENABLED', 'productos necesita PITR activado'),
      awsIs('dynamodb scan --table-name carritos --select COUNT --query Count', 1, 'Los carritos caducados deberían haberse borrado (¿TTL sobre expira?)'),
    ),
    solution: [
      VPC_APP,
      SUBNETS_APP,
      SUBNETS_CSV,
      SG('APPSG', 'app-sg'),
      SG('CACHESG', 'cache-sg'),
      'RTB=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC --query "RouteTables[0].RouteTableId" --output text)',
      'aws ec2 create-vpc-endpoint --vpc-id $VPC --service-name com.amazonaws.us-east-1.dynamodb --route-table-ids $RTB',
      'aws dynamodb update-continuous-backups --table-name productos --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true',
      'aws dynamodb update-time-to-live --table-name carritos --time-to-live-specification Enabled=true,AttributeName=expira',
      'aws elasticache create-cache-subnet-group --cache-subnet-group-name app-cache --cache-subnet-group-description "Cachés de la app" --subnet-ids $SUBNETS',
      'aws elasticache create-replication-group --replication-group-id catalogo-cache --replication-group-description "Caché del catálogo" --engine redis --cache-node-type cache.t4g.micro --num-cache-clusters 2 --automatic-failover-enabled --multi-az-enabled --cache-subnet-group-name app-cache --security-group-ids $CACHESG',
      'aws ec2 authorize-security-group-ingress --group-id $CACHESG --protocol tcp --port 6379 --source-group $APPSG',
      'aws elasticache wait replication-group-available --replication-group-id catalogo-cache',
      'HOST=$(aws elasticache describe-replication-groups --replication-group-id catalogo-cache --query "ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address" --output text)',
      'aws lambda update-function-configuration --function-name catalogo --vpc-config SubnetIds=$SUBNETS_CSV,SecurityGroupIds=$APPSG --environment "Variables={CACHE=$HOST}"',
      INVOKE('{"id":"p2"}'),
      INVOKE('{"id":"p2"}'),
    ],
    hints: [
      'Empieza por lo que no depende de nada: `aws dynamodb update-continuous-backups --table-name productos --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true` y `aws dynamodb update-time-to-live --table-name carritos --time-to-live-specification Enabled=true,AttributeName=expira`.',
      'La caché es la receta de la lección: `create-cache-subnet-group` con las subredes de `app`, `create-replication-group` (2 nodos, `--automatic-failover-enabled --multi-az-enabled`, `--security-group-ids <cache-sg>`), `authorize-security-group-ingress` del 6379 con `--source-group <app-sg>` y `aws elasticache wait replication-group-available`.',
      'La función necesita `--vpc-config` y `--environment "Variables={CACHE=<endpoint primario>}"`. Y como en la VPC no hay salida a Internet, la lectura de DynamoDB necesita un **endpoint de puerta**: `aws ec2 create-vpc-endpoint --vpc-id <vpc> --service-name com.amazonaws.us-east-1.dynamodb --route-table-ids <tabla de rutas>`.',
    ],
    explain: 'Has combinado tres zonas: red (VPC y endpoint de puerta), serverless (Lambda en la VPC) y datos (ElastiCache con alta disponibilidad, PITR y TTL). El patrón cache-aside hace que solo la primera petición de cada producto llegue a DynamoDB; las demás se sirven en microsegundos, y si cae un nodo de la caché la réplica toma el relevo.',
    commands: ['ElastiCache', 'DynamoDB', 'Lambda en una VPC', 'Copias de seguridad y PITR de DynamoDB', 'TTL de DynamoDB'],
  },
});
