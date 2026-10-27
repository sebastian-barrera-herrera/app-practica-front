import type { AwsRef } from '../reference';

const KEY_ANA = `'{"cliente":{"S":"ana"},"fecha":{"S":"2026-01-05"}}'`;
const GSI_ESTADO = `'[{"Create":{"IndexName":"por-estado","KeySchema":[{"AttributeName":"estado","KeyType":"HASH"},{"AttributeName":"fecha","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]'`;
const TX_TRANSFER = `'[{"Update":{"TableName":"cuentas","Key":{"id":{"S":"ana"}},"UpdateExpression":"SET saldo = saldo - :m","ConditionExpression":"saldo >= :m","ExpressionAttributeValues":{":m":{"N":"30"}}}},{"Update":{"TableName":"cuentas","Key":{"id":{"S":"bob"}},"UpdateExpression":"SET saldo = saldo + :m","ExpressionAttributeValues":{":m":{"N":"30"}}}}]'`;
const TX_BIG = TX_TRANSFER.replace(/"30"/g, '"500"');
const LSI = `'[{"IndexName":"por-total","KeySchema":[{"AttributeName":"cliente","KeyType":"HASH"},{"AttributeName":"total","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]'`;
const MAPEO = String.raw`echo '{"rules":[{"rule-type":"selection","rule-id":"1","rule-name":"tienda","object-locator":{"schema-name":"tienda","table-name":"%"},"rule-action":"include"}]}' > mapeo.json`;

export const AWS_REF_DATADEEP: AwsRef[] = [
  // ───────────────────────── DynamoDB ─────────────────────────
  {
    name: 'Capacidad de DynamoDB (RCU y WCU)',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'DynamoDB cobra y limita por unidades: 1 RCU = una lectura fuertemente consistente de hasta 4 KB por segundo (o dos eventualmente consistentes); 1 WCU = una escritura de hasta 1 KB por segundo. Eliges modo provisionado o bajo demanda.',
    details: `
| | **Provisionado** | **Bajo demanda** (\`PAY_PER_REQUEST\`) |
| --- | --- | --- |
| Tú decides | RCU y WCU por segundo (con *auto scaling* opcional) | Nada |
| Pagas | Capacidad reservada, la uses o no | Cada lectura y escritura |
| Ideal para | Tráfico constante y predecible | Tráfico impredecible, picos o casi nulo |
| Si te pasas | \`ProvisionedThroughputExceededException\` (*throttling*) | Se adapta (con topes por partición) |

**Cuentas que conviene saber**

- Lectura: redondeo **hacia arriba a bloques de 4 KB**. Un elemento de 9 KB = 3 RCU fuertes o 1,5 eventuales; con una transacción cuesta el doble.
- Escritura: bloques de **1 KB**. Una de 3,5 KB = 4 WCU; con transacción, el doble.
- \`Scan\` lee **todo** lo que recorre aunque filtres: pagas lo examinado, no lo devuelto.
- Puedes pedir \`--return-consumed-capacity TOTAL\` para ver cuánto ha costado una llamada.
- Cambiar de modo se puede hacer **una vez cada 24 horas**.
`,
    whenUse: ['Bajo demanda: aplicaciones nuevas, cargas con picos o tráfico que no conoces todavía', 'Provisionado con auto scaling: carga estable y previsible, donde ahorras bastante'],
    whenNot: ['No dejes un `Scan` frecuente sobre una tabla grande: es la forma más cara de leer', 'No provisiones «por si acaso» capacidad alta: la pagas ociosa'],
    pricing: 'Provisionado: por RCU y WCU-hora. Bajo demanda: por millón de unidades de lectura y escritura. Más almacenamiento, copias, streams y tablas globales.',
    scenario: 'data-ddb-tienda',
    examples: [
      [`aws dynamodb get-item --table-name pedidos --key ${KEY_ANA} --return-consumed-capacity TOTAL --query ConsumedCapacity.CapacityUnits`, 'Lectura eventualmente consistente de un elemento pequeño: 0,5'],
      [`aws dynamodb get-item --table-name pedidos --key ${KEY_ANA} --consistent-read --return-consumed-capacity TOTAL --query ConsumedCapacity.CapacityUnits`, 'Fuertemente consistente: el doble (1)'],
      ['aws dynamodb describe-table --table-name lecturas --query "Table.ProvisionedThroughput"', 'La tabla `lecturas` está provisionada con 1 RCU y 1 WCU'],
      ['aws dynamodb update-table --table-name lecturas --billing-mode PAY_PER_REQUEST --query TableDescription.BillingModeSummary.BillingMode', 'Pasarla a bajo demanda'],
    ],
    seeAlso: ['DynamoDB', 'Partición caliente', 'aws dynamodb update-table'],
  },
  {
    name: 'Índice secundario local (LSI)',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Un índice con la misma clave de partición que la tabla pero otra clave de ordenación. Solo se puede definir al crear la tabla y limita cada colección de elementos a 10 GB.',
    details: `
| | **GSI** (global) | **LSI** (local) |
| --- | --- | --- |
| Clave de partición | Cualquier atributo | La **misma** de la tabla |
| Cuándo se crea | En cualquier momento | **Solo al crear la tabla** |
| Consistencia de lectura | Solo eventual | Eventual o fuerte |
| Capacidad | Propia (se paga aparte) | Comparte la de la tabla |
| Límite | 20 por tabla | 5 por tabla; 10 GB por valor de clave de partición |

Si dudas, un **GSI** casi siempre es la respuesta: no te ata a decisiones del primer día.
`,
    whenUse: ['Necesitas otro orden dentro de la misma partición con lectura fuertemente consistente'],
    whenNot: ['Si la tabla ya existe: un LSI no se puede añadir después (usa un GSI)', 'Si una partición puede pasar de 10 GB de datos'],
    scenario: 'data-ddb-tienda',
    examples: [
      [`aws dynamodb create-table --table-name pedidos-lsi --attribute-definitions AttributeName=cliente,AttributeType=S AttributeName=fecha,AttributeType=S AttributeName=total,AttributeType=N --key-schema AttributeName=cliente,KeyType=HASH AttributeName=fecha,KeyType=RANGE --local-secondary-indexes ${LSI} --billing-mode PAY_PER_REQUEST --query "TableDescription.LocalSecondaryIndexes[].IndexName"`, 'Un LSI se declara al crear la tabla'],
      ['aws dynamodb update-table --table-name pedidos --local-secondary-index-updates \'[{"Create":{}}]\'', 'En una tabla existente no hay forma de añadirlo', 'error'],
    ],
    seeAlso: ['Índice secundario global', 'Clave de partición y de ordenación'],
  },
  {
    name: 'Partición caliente',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Una partición (un valor de clave) que recibe mucho más tráfico que las demás. Cada partición tiene su propio límite (≈1.000 escrituras/s y 3.000 lecturas/s): se estrangula aunque la tabla esté casi vacía.',
    details: `
Se produce cuando la clave de partición tiene **pocos valores** (estado, país, la fecha de hoy) o cuando unos pocos valores concentran el tráfico (un cliente famoso, un producto viral).

**Cómo se evita**

- Elige una clave con **muchos valores** y accesos parejos (\`cliente\`, \`dispositivo\`, \`pedido\`).
- Para claves inevitablemente calientes, **añade un sufijo aleatorio** (\`ventas#0\` … \`ventas#9\`) al escribir y consulta los diez al leer (*write sharding*).
- Pon una **caché** delante (DAX o ElastiCache) para las lecturas repetidas.
- Los índices también son particiones: un GSI con clave de poca variedad también se calienta.
`,
    whenUse: ['Antes de elegir la clave: pregúntate cuántos valores distintos tendrá y cómo se reparte el tráfico'],
    whenNot: ['No «arregles» una partición caliente subiendo la capacidad: el límite es por partición'],
    scenario: 'data-ddb-tienda',
    examples: [
      [`aws dynamodb put-item --table-name pedidos --item '{"cliente":{"S":"ventas#3"},"fecha":{"S":"2026-03-10"},"estado":{"S":"pendiente"},"total":{"N":"5"}}'`, 'Escribir con un sufijo aleatorio (0–9) para repartir'],
      [`aws dynamodb query --table-name pedidos --key-condition-expression "cliente = :c" --expression-attribute-values '{":c":{"S":"ventas#3"}}' --select COUNT --query Count`, 'Al leer hay que consultar cada sufijo y sumar'],
    ],
    seeAlso: ['Clave de partición y de ordenación', 'Capacidad de DynamoDB (RCU y WCU)', 'DAX'],
  },
  {
    name: 'DynamoDB Streams',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Un registro ordenado de los cambios de una tabla (INSERT, MODIFY, REMOVE) que se conserva 24 horas. Lambda puede leerlo para reaccionar a cada cambio.',
    details: `
Al activarlo eliges qué incluye cada registro (\`StreamViewType\`):

| Valor | Trae |
| --- | --- |
| \`KEYS_ONLY\` | Solo las claves |
| \`NEW_IMAGE\` | El elemento después del cambio |
| \`OLD_IMAGE\` | El elemento antes del cambio |
| \`NEW_AND_OLD_IMAGES\` | Ambos (necesario para tablas globales) |

**Con Lambda** (*event source mapping*): la función recibe lotes de registros. El **rol** de la función necesita leer el stream (\`AWSLambdaDynamoDBExecutionRole\`). Si un registro hace fallar la función, el fragmento se **bloquea** y se reintenta hasta que funcione o caduque: limita con \`--maximum-retry-attempts\`, \`--bisect-batch-on-function-error\` y un \`--destination-config\` de fallos.

Los borrados del **TTL** también aparecen como \`REMOVE\` (con \`userIdentity\` del servicio). Si escribes sin cambiar nada, no se genera registro.
`,
    whenUse: ['Auditoría, replicación, notificaciones o índices derivados a partir de los cambios', 'Materializar vistas o enviar eventos a otros servicios'],
    whenNot: ['No lo uses para consultar historial a largo plazo (24 h): guarda los eventos en S3'],
    scenario: 'data-ddb-eventos',
    examples: [
      ['aws dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES --query TableDescription.StreamSpecification', 'Activar el stream'],
      ['ARN=$(aws dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn --output text) && echo $ARN'],
      [`aws dynamodb put-item --table-name pedidos --item '{"id":{"S":"1"},"estado":{"S":"nuevo"}}'`],
      [`aws dynamodb update-item --table-name pedidos --key '{"id":{"S":"1"}}' --update-expression "SET estado = :e" --expression-attribute-values '{":e":{"S":"enviado"}}'`],
      ['SHARD=$(aws dynamodbstreams describe-stream --stream-arn $ARN --query "StreamDescription.Shards[0].ShardId" --output text)'],
      ['IT=$(aws dynamodbstreams get-shard-iterator --stream-arn $ARN --shard-id $SHARD --shard-iterator-type TRIM_HORIZON --query ShardIterator --output text)'],
      ['aws dynamodbstreams get-records --shard-iterator "$IT" --query "Records[].[eventName,dynamodb.OldImage.estado.S,dynamodb.NewImage.estado.S]" --output text', 'INSERT y MODIFY, con el valor antiguo y el nuevo'],
    ],
    seeAlso: ['TTL de DynamoDB', 'Tablas globales de DynamoDB', 'aws lambda create-event-source-mapping'],
  },
  {
    name: 'Transacciones de DynamoDB',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Hasta 100 operaciones sobre elementos distintos (de una o varias tablas) que se aplican todas o ninguna, con condiciones. Cuestan el doble de capacidad.',
    details: `
\`transact-write-items\` admite \`Put\`, \`Update\`, \`Delete\` y \`ConditionCheck\`. Si **una condición falla**, la transacción se cancela entera y el error \`TransactionCanceledException\` dice qué operación fue (\`[ConditionalCheckFailed, None]\`: la primera).

- Un mismo elemento no puede aparecer **dos veces** en la misma transacción.
- \`--client-request-token\` hace la llamada **idempotente**: repetirla con el mismo token y los mismos datos no se aplica dos veces (con datos distintos: \`IdempotentParameterMismatchException\`).
- \`transact-get-items\` lee varios elementos como una «foto» coherente.
- Una alternativa más barata para un solo elemento: \`--condition-expression\` en \`put-item\`/\`update-item\`.
`,
    whenUse: ['Transferencias, reservas y cualquier cambio que debe ser atómico entre varios elementos'],
    whenNot: ['Para operaciones sueltas: una condición en `update-item` basta y cuesta la mitad'],
    pricing: 'Cada elemento de la transacción consume el doble de unidades de capacidad que la misma operación normal.',
    scenario: 'data-ddb-eventos',
    examples: [
      [`aws dynamodb transact-write-items --transact-items ${TX_TRANSFER}`, 'Mover 30 de ana a bob: las dos cosas o ninguna'],
      [`aws dynamodb transact-write-items --transact-items ${TX_BIG}`, 'ana ya no tiene 500: se cancela todo', 'error'],
      ['aws dynamodb scan --table-name cuentas --query "Items[].[id.S,saldo.N]" --output text', 'ana 70, bob 30: nada a medias'],
    ],
    seeAlso: ['aws dynamodb transact-write-items', 'DynamoDB'],
  },
  {
    name: 'Tablas globales de DynamoDB',
    kind: 'concepto',
    category: 'datos',
    level: 3,
    summary: 'Una tabla con réplicas en varias regiones que aceptan lecturas y escrituras a la vez (multi-activo). Cada cambio se copia a las demás en ~1 segundo; si dos regiones escriben el mismo elemento, gana la última escritura.',
    details: `
Requisitos para añadir una réplica: **streams con \`NEW_AND_OLD_IMAGES\`**, y la tabla en modo **bajo demanda** (o provisionada con auto scaling). Se añade con \`update-table --replica-updates\`.

- Latencia local para usuarios de todo el mundo y recuperación ante la caída de una región.
- Resolución de conflictos: **last writer wins**. Diseña para que dos regiones no editen el mismo elemento a la vez (o incluye un atributo de región/versión).
- Pagas la escritura en **cada** región (escrituras replicadas) más la transferencia entre regiones.
- Borrar la réplica la convierte en una tabla independiente.
`,
    whenUse: ['Aplicaciones globales con baja latencia de lectura y escritura locales', 'Recuperación ante desastres con RPO de segundos y datos siempre disponibles en la otra región'],
    whenNot: ['Si una sola región basta: pagas las escrituras de cada réplica', 'Si necesitas transacciones entre regiones (las transacciones son locales a cada región)'],
    pricing: 'Escrituras replicadas (rWCU) en cada región, almacenamiento en cada región y transferencia de datos entre regiones.',
    scenario: 'data-ddb-eventos',
    examples: [
      ['aws dynamodb update-table --table-name pedidos --replica-updates \'[{"Create":{"RegionName":"eu-west-1"}}]\'', 'Sin streams NEW_AND_OLD_IMAGES no se puede', 'error'],
      ['aws dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES --query TableDescription.StreamSpecification.StreamViewType', 'Primero los streams'],
      ['aws dynamodb update-table --table-name pedidos --replica-updates \'[{"Create":{"RegionName":"eu-west-1"}}]\' --query "TableDescription.TableName"', 'Ahora sí: réplica en Irlanda'],
      [`aws dynamodb put-item --table-name pedidos --item '{"id":{"S":"7"}}'`, 'Escribir en Virginia…'],
      [`aws dynamodb get-item --table-name pedidos --key '{"id":{"S":"7"}}' --region eu-west-1 --query Item.id.S`, '…y leerlo en Irlanda'],
    ],
    seeAlso: ['DynamoDB Streams', 'Capacidad de DynamoDB (RCU y WCU)'],
  },
  {
    name: 'DAX',
    kind: 'servicio',
    category: 'datos',
    level: 3,
    summary: 'DynamoDB Accelerator: una caché en memoria compatible con la API de DynamoDB que baja las lecturas de milisegundos a microsegundos sin cambiar el modelo de datos.',
    details: `
Pones un clúster DAX delante de la tabla y cambias el cliente por el de DAX; el resto del código es igual.

- Ideal para **lecturas repetidas** de los mismos elementos (productos populares, configuraciones).
- Es **write-through**: las escrituras pasan por DAX y se guardan en la tabla.
- Solo ayuda con lecturas **eventualmente consistentes**: las fuertemente consistentes y las transacciones van directas a la tabla.
- Vive **dentro de tu VPC** y requiere un rol y grupo de seguridad (puerto 8111).
- Para cachés genéricas (resultados de SQL, sesiones) usa ElastiCache.
`,
    whenUse: ['Lecturas muy repetidas con latencia de microsegundos', 'Aliviar una partición caliente de lectura'],
    whenNot: ['Cargas dominadas por escrituras', 'Lecturas que exigen consistencia fuerte'],
    pricing: 'Por nodo-hora según su tipo.',
    seeAlso: ['DynamoDB', 'Partición caliente', 'ElastiCache'],
  },
  {
    name: 'Copias de seguridad y PITR de DynamoDB',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Copias bajo demanda (cuando tú quieras, se conservan hasta que las borres) y recuperación a un punto en el tiempo (PITR): cualquier segundo de los últimos 35 días. Siempre se restaura a una tabla nueva.',
    details: `
- **Bajo demanda** (\`create-backup\`): no consume capacidad ni afecta al rendimiento.
- **PITR** (\`update-continuous-backups\`): hay que **activarlo**. Se puede restaurar a cualquier momento entre «hace 35 días» y «hace unos 5 minutos».
- La restauración **crea una tabla nueva**; no sobrescribe la original. No se copian el TTL, los streams ni las alarmas: hay que volver a configurarlos.
- **AWS Backup** centraliza copias de muchos servicios con políticas y retención.
`,
    whenUse: ['PITR activado en toda tabla importante: un borrado accidental se arregla en minutos', 'Copias bajo demanda antes de un cambio de esquema o un despliegue arriesgado'],
    whenNot: ['No confundas con las tablas globales: replicar un borrado también borra en la otra región'],
    pricing: 'Por GB-mes de copia (PITR y bajo demanda) y por GB restaurado.',
    scenario: 'data-ddb-eventos',
    examples: [
      ['aws dynamodb update-continuous-backups --table-name cuentas --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true --query ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus', 'Activar PITR'],
      ['aws dynamodb create-backup --table-name cuentas --backup-name antes-de-cambiar --query BackupDetails.BackupStatus', 'Copia bajo demanda'],
      ['aws dynamodb list-backups --table-name cuentas --query "BackupSummaries[].BackupName"'],
      ['BK=$(aws dynamodb list-backups --table-name cuentas --query "BackupSummaries[0].BackupArn" --output text) && aws dynamodb restore-table-from-backup --target-table-name cuentas-restauradas --backup-arn $BK --query TableDescription.TableName', 'Restaurar a una tabla nueva'],
    ],
    seeAlso: ['aws dynamodb restore-table-to-point-in-time', 'AWS Backup', 'Copias de seguridad de RDS'],
  },

  // ───────────────────────── RDS / Aurora ─────────────────────────
  {
    name: 'Grupo de parámetros de RDS',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'El archivo de configuración del motor (max_connections, binlog_format, work_mem…) gestionado por AWS. Los grupos por defecto no se pueden editar: creas uno propio, cambias valores y lo asignas a la instancia.',
    details: `
- **Dinámicos** (\`ApplyMethod=immediate\`): se aplican al momento. **Estáticos**: solo \`pending-reboot\` y tras **reiniciar** la instancia.
- Asignar un grupo nuevo a una instancia deja su estado en \`pending-reboot\` hasta el siguiente reinicio.
- Muchos valores son **fórmulas**: \`max_connections\` en MySQL = memoria ÷ 12.582.880 (≈ 85 en una \`db.t3.micro\`). Si subes la clase de instancia, el valor por defecto crece solo.
- Aurora tiene dos niveles: grupo de **clúster** y grupo de **instancia**.
- \`reset-db-parameter-group\` devuelve valores a los de por defecto.
`,
    whenUse: ['Ajustar conexiones, registros lentos (`log_min_duration_statement`), formato del binlog para replicación'],
    whenNot: ['No cambies parámetros estáticos en producción sin planificar el reinicio'],
    scenario: 'data-rds',
    examples: [
      ['aws rds describe-db-parameters --db-parameter-group-name default.mysql8.0 --query "Parameters[?ParameterName==\'max_connections\'].[ParameterName,ApplyType]" --output text', 'max_connections es dinámico en MySQL'],
      ['aws rds create-db-parameter-group --db-parameter-group-name mi-mysql --db-parameter-group-family mysql8.0 --description "Tienda" --query DBParameterGroup.DBParameterGroupName'],
      ['aws rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=max_connections,ParameterValue=300,ApplyMethod=immediate --query DBParameterGroupName'],
      ['aws rds modify-db-parameter-group --db-parameter-group-name default.mysql8.0 --parameters ParameterName=max_connections,ParameterValue=300,ApplyMethod=immediate', 'El grupo por defecto no se toca', 'error'],
    ],
    seeAlso: ['aws rds modify-db-parameter-group', 'RDS', 'RDS Proxy'],
  },
  {
    name: 'RDS Proxy',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Un grupo de conexiones gestionado entre tu aplicación y la base de datos: multiplexa miles de conexiones de cliente en unas pocas a la base de datos y acelera la conmutación por error. Imprescindible con Lambda.',
    details: `
Cada ejecución de Lambda abre su propia conexión; con cientos a la vez se agota \`max_connections\` (*Too many connections*). El proxy mantiene un conjunto reducido de conexiones abiertas y las presta.

**Qué necesita**

- Un **secreto** de Secrets Manager con el usuario y la contraseña.
- Un **rol** que confíe en \`rds.amazonaws.com\` y pueda leer ese secreto.
- Subredes de la VPC y un grupo de seguridad; el de la base de datos debe **admitir al del proxy** en el puerto del motor.

**Diagnóstico** (\`describe-db-proxy-targets\` → \`TargetHealth\`): \`AUTH_FAILURE\` (el rol no lee el secreto o la contraseña no coincide), \`CONNECTION_FAILED\` (red o grupo de seguridad), \`REGISTERING\` (aún no ha comprobado).

Se configura el reparto con \`modify-db-proxy-target-group\` (\`MaxConnectionsPercent\` de \`max_connections\`). Las aplicaciones se conectan al **endpoint del proxy**, no al de la base de datos.
`,
    whenUse: ['Lambda y contenedores que escalan a muchas conexiones', 'Reducir el tiempo de conmutación en Multi-AZ y Aurora', 'Forzar autenticación IAM sin tocar la aplicación'],
    whenNot: ['Aplicaciones con pocas conexiones estables: solo añadiría un salto'],
    pricing: 'Por vCPU-hora de la base de datos protegida.',
    seeAlso: ['aws rds create-db-proxy', 'AWS Secrets Manager', 'Grupo de parámetros de RDS'],
  },
  {
    name: 'Aurora Serverless v2',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Aurora cuya capacidad se ajusta sola, en fracciones de 0,5 ACU, entre un mínimo y un máximo que fijas. Pagas por ACU-segundo usada: ideal para cargas variables o impredecibles.',
    details: `
1 **ACU** ≈ 2 GiB de memoria y su CPU. En el clúster fijas \`MinCapacity\` y \`MaxCapacity\` (\`--serverless-v2-scaling-configuration\`) y las instancias usan la clase especial \`db.serverless\`.

- Escala en segundos **sin cortar conexiones**; puede convivir con instancias normales en el mismo clúster.
- Con \`MinCapacity=0\` (si la versión lo permite) puede pausarse cuando no hay conexiones.
- Un máximo bajo es una **protección de coste**; un mínimo bajo ahorra pero obliga a calentar la caché de la base de datos.
- Para carga constante y alta, las instancias aprovisionadas salen más baratas.
`,
    whenUse: ['Entornos de desarrollo, cargas con picos, SaaS con muchos clientes de uso desigual'],
    whenNot: ['Carga estable y continua (aprovisionada y con Savings Plans/instancias reservadas es más barata)'],
    scenario: 'data-rds',
    examples: [
      ['aws rds modify-db-cluster --db-cluster-identifier aurora-tienda --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4 --query DBCluster.ServerlessV2ScalingConfiguration'],
      ['aws rds create-db-instance --db-instance-identifier aurora-1 --db-instance-class db.serverless --engine aurora-mysql --db-cluster-identifier aurora-tienda --query DBInstance.DBInstanceClass', 'Instancia escritora serverless'],
    ],
    seeAlso: ['Aurora', 'RDS Proxy', 'aws rds create-db-proxy'],
  },
  {
    name: 'Recuperación a un momento dado (PITR) de RDS',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'RDS guarda copias automáticas y los registros de transacciones: puedes crear una instancia nueva con el estado exacto de cualquier segundo dentro del periodo de retención (hasta 35 días).',
    details: `
- Requiere **copias automáticas activas** (\`BackupRetentionPeriod\` > 0); con 0 no hay PITR.
- Siempre **crea una instancia nueva** (con otro endpoint): no sobrescribe la original. Cambia la aplicación al nuevo endpoint o renombra las instancias.
- El último momento restaurable va unos **5 minutos por detrás** del presente (\`LatestRestorableTime\`).
- No se copian los grupos de parámetros ni los grupos de seguridad personalizados por defecto: indícalos en la restauración.
- Para un entorno de pruebas con datos reales o para deshacer un \`DROP TABLE\`.
`,
    whenUse: ['Deshacer un borrado o un cambio erróneo', 'Clonar producción en un momento concreto para probar una migración'],
    whenNot: ['No sustituye a las copias entre regiones si necesitas sobrevivir a la caída de una región'],
    seeAlso: ['aws rds restore-db-instance-to-point-in-time', 'Copias de seguridad de RDS'],
  },
  {
    name: 'AWS Secrets Manager',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Guarda credenciales y otros secretos cifrados, con versiones, permisos IAM y (más adelante) rotación automática. La aplicación los lee en ejecución en vez de llevarlos en el código.',
    details: `
- Un secreto tiene **versiones** con etapas: \`AWSCURRENT\` (la actual) y \`AWSPREVIOUS\`. \`put-secret-value\` crea una versión nueva y mueve las etapas.
- Se borra con una **ventana de recuperación** de 7 a 30 días (\`restore-secret\` lo recupera); \`--force-delete-without-recovery\` lo borra ya.
- El acceso se concede con IAM (\`secretsmanager:GetSecretValue\`) sobre el **ARN** del secreto; si usa una clave KMS propia, hace falta también permiso de la clave.
- Con RDS, Aurora y Redshift se puede **rotar** la contraseña automáticamente.
- Diferencia con Parameter Store: Secrets Manager rota y está pensado para secretos; Parameter Store es más barato para configuración.
`,
    whenUse: ['Contraseñas de bases de datos, claves de API de terceros, tokens'],
    whenNot: ['Configuración no sensible (usa Parameter Store) o datos grandes (límite de 64 KB)'],
    pricing: 'Por secreto-mes y por cada 10.000 llamadas a la API.',
    scenario: 'data-rds',
    examples: [
      ['aws secretsmanager get-secret-value --secret-id prod/tienda --query SecretString --output text', 'Leer el valor actual'],
      [`aws secretsmanager create-secret --name prod/api --secret-string '{"clave":"abc"}' --query Name --output text`, 'Crear otro'],
      [`aws secretsmanager put-secret-value --secret-id prod/api --secret-string '{"clave":"def"}' --query VersionStages`, 'Nueva versión'],
      ['aws secretsmanager get-secret-value --secret-id prod/api --version-stage AWSPREVIOUS --query SecretString --output text', 'La anterior sigue disponible'],
    ],
    seeAlso: ['RDS Proxy', 'aws secretsmanager create-secret', 'aws secretsmanager get-secret-value', 'Rotación de secretos', 'Secrets Manager frente a Parameter Store'],
  },

  // ───────────────────────── caché ─────────────────────────
  {
    name: 'Patrones de caché',
    kind: 'comparativa',
    category: 'datos',
    level: 2,
    summary: 'Cómo se relacionan aplicación, caché y base de datos: cache-aside (lo más común), read-through, write-through y write-behind. Cada uno cambia quién carga la caché y qué tan fresca queda.',
    details: `
| Patrón | Lectura | Escritura | Riesgo |
| --- | --- | --- | --- |
| **Cache-aside** | La app mira la caché; si falla, lee la BD y guarda | La app escribe en la BD (e invalida la clave) | Datos viejos hasta el TTL |
| **Read-through** | La app solo habla con la caché, que carga de la BD | — | Menos control para la app |
| **Write-through** | Igual que cualquiera | Escribe en caché **y** BD a la vez | Escrituras más lentas; caché con datos que quizá no se lean |
| **Write-behind** | — | Escribe en caché; la BD se actualiza después | **Pérdida de datos** si la caché cae |

**Reglas prácticas**

- Pon siempre un **TTL**: es tu red de seguridad contra datos eternos.
- Al modificar un dato, **invalida** (borra) la clave en lugar de actualizarla: evita carreras.
- Cuidado con la **estampida** (*thundering herd*): si una clave popular caduca, cientos de peticiones van a la vez a la BD. Usa TTL con variación aleatoria o un bloqueo.
- Mide el **ratio de aciertos** (\`CacheHits\` / \`CacheMisses\` en CloudWatch).
`,
    whenUse: ['Cache-aside para casi todo: es simple y tolera que la caché se pierda'],
    whenNot: ['Write-behind para datos que no puedes perder (pagos, pedidos)', 'Cachear datos que cambian en cada petición'],
    seeAlso: ['ElastiCache', 'Redis frente a Memcached', 'DAX'],
  },
  {
    name: 'Redis frente a Memcached',
    kind: 'comparativa',
    category: 'datos',
    level: 2,
    summary: 'Redis (y Valkey) ofrece estructuras de datos, persistencia, réplicas y conmutación automática. Memcached es más simple: solo clave-valor, multihilo, sin réplicas ni persistencia.',
    details: `
| | **Redis / Valkey** | **Memcached** |
| --- | --- | --- |
| Tipos de datos | Cadenas, listas, conjuntos, hashes, ordenados, streams | Cadenas |
| Réplicas y Multi-AZ | Sí (grupo de replicación, failover) | No |
| Persistencia y copias | Sí (snapshots) | No |
| Escala | Fragmentos (modo clúster) y réplicas | Más nodos (sharding en el cliente) |
| Multihilo | Esencialmente un hilo por fragmento | Sí |
| Endpoint | Primario + de lectura (o de configuración en modo clúster) | De configuración + nodos |

Elige **Redis** salvo que solo necesites una caché desechable muy simple y quieras aprovechar muchos núcleos.
`,
    whenUse: ['Redis: sesiones, rankings, colas ligeras, limitadores de peticiones, cachés con alta disponibilidad', 'Memcached: caché sencilla, desechable y multihilo'],
    whenNot: ['No guardes en ninguna de las dos el único ejemplar de un dato que no puedas reconstruir (para eso, MemoryDB o una base de datos)'],
    seeAlso: ['ElastiCache', 'Patrones de caché', 'aws elasticache create-replication-group'],
  },
  {
    name: 'Lambda en una VPC',
    kind: 'concepto',
    category: 'integracion',
    level: 2,
    summary: 'Una función puede conectarse a tus subredes privadas (para llegar a RDS, ElastiCache…). Entonces deja de tener Internet: para llegar a servicios de AWS necesita endpoints de VPC o un NAT.',
    details: `
Se configura con \`--vpc-config SubnetIds=…,SecurityGroupIds=…\`. Lambda crea interfaces de red (ENI) en tus subredes, así que el **rol** necesita permisos de red (\`AWSLambdaVPCAccessExecutionRole\`).

**Lo que más sorprende**

- Dentro de la VPC la función **no tiene salida a Internet**, aunque la subred tenga una ruta a un Internet Gateway (las ENI de Lambda no tienen IP pública). Para llegar a **DynamoDB o S3**: un *VPC endpoint de puerta*; para otros servicios, un endpoint de interfaz; para Internet: **NAT gateway**.
- Un fallo de red no da error rápido: da \`Task timed out\` (o un \`TimeoutError\` del cliente si lo configuras).
- El **grupo de seguridad de la función** debe poder salir hacia el servicio, y el del servicio (ElastiCache, RDS) debe **admitir al grupo de la función** en su puerto.
- Pon subredes en **al menos dos zonas** para tolerar la caída de una.
`,
    whenUse: ['La función necesita llegar a recursos privados: base de datos, caché, servicios internos'],
    whenNot: ['Si solo habla con servicios públicos de AWS: no la metas en la VPC, evitas NAT y endpoints'],
    seeAlso: ['AWS Lambda', 'VPC Endpoint', 'ElastiCache', 'RDS Proxy'],
  },

  // ───────────────────────── migración ─────────────────────────
  {
    name: 'AWS DMS',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Database Migration Service: mueve bases de datos a AWS (o entre motores) con la base de origen en marcha: primero una carga completa y luego replicación continua de cambios hasta el corte.',
    details: `
Tres piezas:

1. **Instancia de replicación**: el servidor gestionado que ejecuta las tareas (tarda unos minutos en crearse).
2. **Endpoints**: origen y destino (una base de datos con servidor, puerto y credenciales; un bucket de S3 con un rol; una tabla de DynamoDB con un rol).
3. **Tarea**: \`full-load\`, \`cdc\` o \`full-load-and-cdc\`, con reglas de **mapeo de tablas** (qué esquemas y tablas).

**Antes de que funcione**

- \`test-connection\` desde la instancia a cada endpoint: red (el grupo de seguridad del origen debe admitir a la instancia), usuario/contraseña y permisos del rol.
- Para el grupo de subredes de replicación hace falta el rol **\`dms-vpc-role\`** (con \`AmazonDMSVPCManagementRole\`) en tu cuenta.
- Para S3 y DynamoDB como destino, un rol que confíe en \`dms.amazonaws.com\` con permisos de escritura.
- Para cambiar de motor (Oracle → PostgreSQL) convierte primero el esquema con **AWS SCT**.
`,
    whenUse: ['Migrar con poco tiempo de parada', 'Replicar una base de datos a S3 o a un lago de datos de forma continua'],
    whenNot: ['Para copiar archivos: DataSync', 'Para una migración de un solo día con parada permitida: un volcado y restauración nativo es más sencillo'],
    pricing: 'Por hora de instancia de replicación (más almacenamiento y transferencia). Existe una variante Serverless que escala sola.',
    seeAlso: ['Captura de cambios (CDC)', 'aws dms create-replication-task', 'aws dms test-connection', 'Elegir cómo migrar datos'],
  },
  {
    name: 'Captura de cambios (CDC)',
    kind: 'concepto',
    category: 'datos',
    level: 3,
    summary: 'Change Data Capture: leer el registro de transacciones de la base de origen para copiar en segundos cada INSERT, UPDATE y DELETE posterior a la carga inicial.',
    details: `
El origen debe **registrar los cambios** de una forma que DMS entienda:

| Motor | Qué activar |
| --- | --- |
| **MySQL / MariaDB / Aurora MySQL** | Copias automáticas activas (para conservar el binlog) y \`binlog_format = ROW\` |
| **PostgreSQL / Aurora PostgreSQL** | \`rds.logical_replication = 1\` (parámetro **estático**: hay que reiniciar) |
| **SQL Server / Oracle** | Registro suplementario / CDC o MS-Replication |

Si falta algo, la tarea falla al arrancar con un mensaje que lo dice. El **retraso** (\`CDCLatency\`) indica cuánto va por detrás el destino: cuando llega a casi 0, puedes hacer el corte.
`,
    whenUse: ['Migraciones con parada mínima', 'Mantener un destino analítico (S3, Redshift) al día'],
    whenNot: ['Si el origen no permite cambiar su configuración de registro'],
    seeAlso: ['AWS DMS', 'Grupo de parámetros de RDS'],
  },
  {
    name: 'AWS DataSync',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 2,
    summary: 'Copia archivos de forma rápida y programada entre tus almacenamientos locales (NFS, SMB) y AWS (S3, EFS, FSx), o entre servicios de AWS. Solo transfiere lo que ha cambiado y verifica la integridad.',
    details: `
- Instalas un **agente** (una máquina virtual) en tu red; debe estar \`ONLINE\`.
- Creas dos **ubicaciones** (origen y destino). Para S3 necesitas un **rol** que confíe en \`datasync.amazonaws.com\` con permisos sobre el bucket: DataSync lo **comprueba al crear la ubicación**.
- Una **tarea** une ambas, con filtros (\`--includes "FilterType=SIMPLE_PATTERN,Value=/ventas*"\`), modo de transferencia (\`CHANGED\`/\`ALL\`), qué hacer con lo ya existente (\`OverwriteMode\`) y si borrar lo que ya no existe en el origen (\`PreserveDeletedFiles=REMOVE\`).
- Cada **ejecución** pasa por LAUNCHING → PREPARING → TRANSFERRING → VERIFYING → SUCCESS.
- Se puede programar (\`--schedule\`).
`,
    whenUse: ['Migrar o sincronizar carpetas grandes hacia S3, EFS o FSx', 'Copias periódicas desde la oficina'],
    whenNot: ['Para bases de datos: DMS', 'Para cientos de TB sin red suficiente: Snow'],
    pricing: 'Por GB transferido.',
    seeAlso: ['aws datasync create-task', 'aws datasync start-task-execution', 'Elegir cómo migrar datos'],
  },
  {
    name: 'Familia AWS Snow',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 2,
    summary: 'Dispositivos físicos (Snowcone, Snowball Edge) que AWS te envía: los llenas con tus datos y los devuelves para que los vuelquen en S3. Para volúmenes enormes o conexiones lentas.',
    details: `
| | **Snowcone** | **Snowball Edge** |
| --- | --- | --- |
| Capacidad | 8–14 TB | Hasta ~210 TB utilizables (almacenamiento) |
| Uso | Entornos pequeños o extremos, también online con DataSync | Migraciones de cientos de TB y cómputo en el borde |

- Cifrado de datos y custodia con una clave que controlas (KMS).
- **Cuenta rápida**: datos × 8 ÷ ancho de banda. 100 TB por una línea de 1 Gbps ≈ 9–10 días **sin parar**; por una de 100 Mbps, casi 3 meses. Un envío físico tarda 1–2 semanas.
- Se pueden pedir varios dispositivos en paralelo.
`,
    whenUse: ['Más de ~10–20 TB con conectividad limitada, o cuando la transferencia por red tardaría más de una semana'],
    whenNot: ['Transferencias pequeñas o con buena conexión: DataSync o `aws s3 sync`'],
    seeAlso: ['AWS DataSync', 'Elegir cómo migrar datos'],
  },
  {
    name: 'Elegir cómo migrar datos',
    kind: 'comparativa',
    category: 'datos',
    level: 2,
    summary: 'Qué servicio usar según lo que mueves: bases de datos (DMS), archivos (DataSync), enormes volúmenes sin red (Snow), transferencias por SFTP (Transfer Family) o acceso híbrido continuo (Storage Gateway).',
    details: `
| Quiero mover… | Servicio |
| --- | --- |
| Una base de datos, con poca parada | **DMS** (+ SCT si cambia el motor) |
| Carpetas desde NFS/SMB a S3/EFS/FSx, de forma periódica | **DataSync** |
| Cientos de TB con red lenta | **Snowball Edge** |
| Archivos que me envían socios por SFTP/FTPS | **Transfer Family** |
| Que mis servidores locales vean S3 como un disco o una cinta | **Storage Gateway** |
| Servidores completos (máquinas virtuales) | **Application Migration Service (MGN)** |

**Las 7 R de la migración**: *Retire* (apagar), *Retain* (dejar como está), *Rehost* («lift and shift»), *Relocate*, *Replatform* («lift, tinker and shift», p. ej. a RDS), *Repurchase* (pasar a un SaaS) y *Refactor* (rediseñar para la nube).
`,
    whenUse: ['Al planificar una migración: elige la herramienta por el tipo de dato y el volumen'],
    whenNot: ['No uses una herramienta de archivos para una base de datos viva: copiarás datos inconsistentes'],
    seeAlso: ['AWS DMS', 'AWS DataSync', 'Familia AWS Snow'],
  },

  // ───────────────────────── comandos ─────────────────────────
  {
    name: 'aws dynamodb update-table',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws dynamodb update-table --table-name <t> [--billing-mode PAY_PER_REQUEST] [--attribute-definitions …] [--global-secondary-index-updates <json>] [--stream-specification StreamEnabled=true,StreamViewType=…] [--replica-updates <json>]',
    summary: 'Cambia una tabla existente: modo de facturación, índices secundarios globales (crear o borrar), streams y réplicas globales.',
    details: `
- Para **crear un GSI** hay que declarar en \`--attribute-definitions\` los atributos de su clave y pasar \`--global-secondary-index-updates '[{"Create":{…}}]'\`. DynamoDB rellena el índice con lo que ya hay (*backfill*).
- Solo se puede cambiar el modo de facturación **una vez cada 24 horas**.
- Un LSI no se puede añadir: solo existe desde \`create-table\`.
- Con \`--stream-specification\` activas o cambias el tipo de registro; con \`--replica-updates\`, añades (\`Create\`) o quitas (\`Delete\`) regiones.
`,
    scenario: 'data-ddb-tienda',
    examples: [
      [`aws dynamodb update-table --table-name pedidos --attribute-definitions AttributeName=estado,AttributeType=S AttributeName=fecha,AttributeType=S --global-secondary-index-updates ${GSI_ESTADO} --query "TableDescription.GlobalSecondaryIndexes[].IndexName"`, 'Crear el índice por estado'],
      [`aws dynamodb query --table-name pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --select COUNT --query Count`, 'Consultar por el nuevo índice'],
      ['aws dynamodb update-table --table-name lecturas --billing-mode PAY_PER_REQUEST --query TableDescription.BillingModeSummary.BillingMode', 'Pasar a bajo demanda'],
    ],
    seeAlso: ['Índice secundario global', 'Capacidad de DynamoDB (RCU y WCU)'],
  },
  {
    name: 'aws dynamodb transact-write-items',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws dynamodb transact-write-items --transact-items <json> [--client-request-token <token>]',
    summary: 'Aplica varias operaciones (`Put`, `Update`, `Delete`, `ConditionCheck`) como una sola unidad: todas o ninguna.',
    details: 'Cada elemento de la lista lleva una de esas claves con `TableName`, `Key` o `Item`, `ConditionExpression` y los valores. Si falla una condición, `TransactionCanceledException` indica en `CancellationReasons` cuál. Máximo 100 operaciones y 4 MB.',
    scenario: 'data-ddb-eventos',
    examples: [
      [`aws dynamodb transact-write-items --transact-items ${TX_TRANSFER} --client-request-token t1`, 'Transferir con token de idempotencia'],
      [`aws dynamodb transact-write-items --transact-items ${TX_TRANSFER} --client-request-token t1`, 'Repetirla con el mismo token no vuelve a aplicarla'],
      ['aws dynamodb scan --table-name cuentas --query "Items[].[id.S,saldo.N]" --output text', 'ana 70, bob 30 (una sola vez)'],
    ],
    seeAlso: ['Transacciones de DynamoDB'],
  },
  {
    name: 'aws dynamodb restore-table-to-point-in-time',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws dynamodb restore-table-to-point-in-time --source-table-name <t> --target-table-name <nueva> (--use-latest-restorable-time | --restore-date-time <ISO>)',
    summary: 'Crea una tabla nueva con el contenido de otra en un instante de los últimos 35 días. Requiere PITR activado.',
    details: 'Sin PITR: `PointInTimeRecoveryUnavailableException`. Fuera de la ventana: `InvalidRestoreTimeException`. La tabla restaurada no hereda el TTL ni los streams.',
    scenario: 'data-ddb-eventos',
    examples: [
      ['aws dynamodb restore-table-to-point-in-time --source-table-name cuentas --target-table-name cuentas-ayer --use-latest-restorable-time', 'Sin PITR activado', 'error'],
      ['aws dynamodb update-continuous-backups --table-name cuentas --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true --query ContinuousBackupsDescription.ContinuousBackupsStatus', 'Activar PITR'],
      ['aws dynamodb restore-table-to-point-in-time --source-table-name cuentas --target-table-name cuentas-ayer --use-latest-restorable-time --query TableDescription.TableName', 'Ahora sí'],
    ],
    seeAlso: ['Copias de seguridad y PITR de DynamoDB'],
  },
  {
    name: 'aws rds modify-db-parameter-group',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws rds modify-db-parameter-group --db-parameter-group-name <g> --parameters ParameterName=<p>,ParameterValue=<v>,ApplyMethod=immediate|pending-reboot [ParameterName=…]',
    summary: 'Cambia valores de un grupo de parámetros propio. Los dinámicos admiten `immediate`; los estáticos solo `pending-reboot`.',
    details: 'No funciona con los grupos `default.*`. Tras cambiar el grupo asignado a una instancia, reiníciala (`reboot-db-instance`) para que quede `in-sync`. Mira lo aplicado con `describe-db-parameters --source user`.',
    scenario: 'data-rds',
    examples: [
      ['aws rds create-db-parameter-group --db-parameter-group-name mi-mysql --db-parameter-group-family mysql8.0 --description prueba --query DBParameterGroup.DBParameterGroupName'],
      ['aws rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=max_connections,ParameterValue=300,ApplyMethod=immediate'],
      ['aws rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=performance_schema,ParameterValue=1,ApplyMethod=immediate', 'Es estático: solo con pending-reboot', 'error'],
      ['aws rds describe-db-parameters --db-parameter-group-name mi-mysql --source user --query "Parameters[].[ParameterName,ParameterValue]" --output text'],
    ],
    seeAlso: ['Grupo de parámetros de RDS'],
  },
  {
    name: 'aws rds create-db-proxy',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws rds create-db-proxy --db-proxy-name <n> --engine-family MYSQL|POSTGRESQL --auth <json> --role-arn <rol> --vpc-subnet-ids <s1> <s2> [--vpc-security-group-ids <sg>]',
    summary: 'Crea un RDS Proxy. Después hay que registrar la base de datos de destino con `register-db-proxy-targets` y comprobar `TargetHealth`.',
    details: '`--auth` es una lista JSON con `AuthScheme=SECRETS`, `SecretArn` e `IAMAuth`. Si el rol no confía en `rds.amazonaws.com` o el secreto no existe, falla al crear. Si la creación va bien pero el destino queda `UNAVAILABLE`, mira `Reason`: `AUTH_FAILURE` (el rol no lee el secreto, o la contraseña difiere) o `CONNECTION_FAILED` (grupo de seguridad).',
    scenario: 'data-rds',
    examples: [
      ['SECRET=$(aws secretsmanager describe-secret --secret-id prod/tienda --query ARN --output text)'],
      ['ROLE=$(aws iam get-role --role-name proxy-role --query Role.Arn --output text)'],
      ['SUBNETS=$(aws ec2 describe-subnets --query "Subnets[?DefaultForAz].SubnetId | [0:2]" --output text)'],
      ['aws rds create-db-proxy --db-proxy-name tienda-proxy --engine-family MYSQL --auth "[{\\"AuthScheme\\":\\"SECRETS\\",\\"SecretArn\\":\\"$SECRET\\",\\"IAMAuth\\":\\"DISABLED\\"}]" --role-arn $ROLE --vpc-subnet-ids $SUBNETS --query DBProxy.Endpoint --output text', 'El endpoint al que se conectará la aplicación'],
      ['aws rds register-db-proxy-targets --db-proxy-name tienda-proxy --db-instance-identifiers tienda-db --query "DBProxyTargets[0].TargetHealth.State" --output text', 'REGISTERING'],
    ],
    seeAlso: ['RDS Proxy', 'AWS Secrets Manager'],
  },
  {
    name: 'aws rds restore-db-instance-to-point-in-time',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier <orig> --target-db-instance-identifier <nueva> (--use-latest-restorable-time | --restore-time <ISO>)',
    summary: 'Crea una instancia nueva con el estado de otra en un momento concreto del periodo de retención.',
    details: 'Falla con `Backups are not enabled` si la retención es 0, y con errores de rango si la hora queda fuera de la ventana. La instancia nueva tiene otro endpoint.',
    scenario: 'data-rds',
    examples: [
      ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[BackupRetentionPeriod,LatestRestorableTime]" --output text', 'Siete días de copias'],
      ['aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier tienda-db --target-db-instance-identifier tienda-clon --use-latest-restorable-time --query DBInstance.DBInstanceStatus --output text', 'Un clon de producción'],
    ],
    seeAlso: ['Recuperación a un momento dado (PITR) de RDS', 'Copias de seguridad de RDS'],
  },
  {
    name: 'aws elasticache create-replication-group',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws elasticache create-replication-group --replication-group-id <id> --replication-group-description <txt> --engine redis --cache-node-type cache.t4g.micro --num-cache-clusters 2 [--automatic-failover-enabled] [--multi-az-enabled] --cache-subnet-group-name <g> --security-group-ids <sg>',
    summary: 'Crea un grupo de replicación de Redis: un primario y réplicas. Con failover automático, si cae el primario se promueve una réplica y el endpoint primario no cambia.',
    details: `
- El failover automático necesita al menos una réplica; Multi-AZ necesita failover.
- \`--auth-token\` exige \`--transit-encryption-enabled\` (cifrado en tránsito): el cliente debe usar TLS.
- El grupo de subredes decide la VPC; el **grupo de seguridad** debe abrir el 6379 a la aplicación.
- Tarda unos minutos: usa \`aws elasticache wait replication-group-available\`.
- Conéctate al **endpoint primario** para escribir y al de lectura para repartir lecturas.
`,
    scenario: 'data-cache',
    examples: [
      ['aws elasticache describe-replication-groups --replication-group-id sesiones --query "ReplicationGroups[0].[Status,AutomaticFailover,MultiAZ]" --output text', 'El grupo `sesiones` solo tiene un nodo: sin failover'],
      ['aws elasticache increase-replica-count --replication-group-id sesiones --new-replica-count 1 --apply-immediately --query ReplicationGroup.Status --output text', 'Añadir una réplica'],
      ['aws elasticache wait replication-group-available --replication-group-id sesiones', 'Esperar a que termine'],
      ['aws elasticache describe-replication-groups --replication-group-id sesiones --query "ReplicationGroups[0].NodeGroups[0].NodeGroupMembers[].[CacheClusterId,CurrentRole]" --output text'],
    ],
    seeAlso: ['ElastiCache', 'aws elasticache test-failover', 'Redis frente a Memcached'],
  },
  {
    name: 'aws elasticache test-failover',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws elasticache test-failover --replication-group-id <id> --node-group-id 0001',
    summary: 'Simula la caída del primario para comprobar que la conmutación funciona. Una réplica pasa a primaria y el endpoint primario sigue siendo el mismo.',
    details: 'Solo con failover automático activado. Hazlo antes de necesitarlo: comprueba que tu aplicación reconecta sola (resolviendo de nuevo el nombre DNS) y cuánto tarda.',
    scenario: 'data-cache',
    examples: [
      ['aws elasticache test-failover --replication-group-id sesiones --node-group-id 0001', 'Sin réplica ni failover automático no se puede', 'error'],
      ['aws elasticache increase-replica-count --replication-group-id sesiones --new-replica-count 1 --apply-immediately --query ReplicationGroup.Status --output text'],
      ['aws elasticache wait replication-group-available --replication-group-id sesiones'],
      ['aws elasticache modify-replication-group --replication-group-id sesiones --automatic-failover-enabled --multi-az-enabled --apply-immediately --query ReplicationGroup.AutomaticFailover --output text'],
      ['aws elasticache wait replication-group-available --replication-group-id sesiones'],
      ['aws elasticache test-failover --replication-group-id sesiones --node-group-id 0001 --query ReplicationGroup.Status --output text'],
    ],
    seeAlso: ['aws elasticache create-replication-group', 'ElastiCache'],
  },
  {
    name: 'aws secretsmanager create-secret',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws secretsmanager create-secret --name <ruta/nombre> --secret-string <texto o JSON> [--description <txt>]',
    summary: 'Crea un secreto cifrado. Usa nombres con ruta (`prod/db`, `app/api-key`) para poder dar permisos por prefijo.',
    details: 'Para credenciales de base de datos el valor suele ser un JSON con `username` y `password`. Si ya existe: `ResourceExistsException`. Al borrar hay una ventana de recuperación de 7–30 días.',
    scenario: 'data-rds',
    examples: [
      [`aws secretsmanager create-secret --name prod/api --secret-string '{"clave":"abc"}' --query Name --output text`],
      [`aws secretsmanager create-secret --name prod/api --secret-string '{"clave":"abc"}'`, 'Ya existe', 'error'],
      ['aws secretsmanager list-secrets --query "SecretList[].Name" --output text'],
    ],
    seeAlso: ['AWS Secrets Manager', 'aws secretsmanager get-secret-value'],
  },
  {
    name: 'aws secretsmanager get-secret-value',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws secretsmanager get-secret-value --secret-id <nombre o ARN> [--version-stage AWSPREVIOUS]',
    summary: 'Lee el valor de un secreto (la versión `AWSCURRENT` por defecto). Necesita `secretsmanager:GetSecretValue` sobre ese secreto.',
    details: 'Un secreto marcado para borrar no se puede leer hasta restaurarlo. En una función Lambda, lee el secreto **fuera del handler** y guárdalo en una variable para no pagar una llamada por invocación.',
    scenario: 'data-rds',
    examples: [
      ['aws secretsmanager get-secret-value --secret-id prod/tienda --query SecretString --output text'],
      ['aws secretsmanager get-secret-value --secret-id prod/no-existe', 'No existe', 'error'],
    ],
    seeAlso: ['AWS Secrets Manager'],
  },
  {
    name: 'aws dms create-replication-task',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws dms create-replication-task --replication-task-identifier <id> --source-endpoint-arn <arn> --target-endpoint-arn <arn> --replication-instance-arn <arn> --migration-type full-load|cdc|full-load-and-cdc --table-mappings file://mapeo.json',
    summary: 'Define qué se migra, de dónde a dónde y cómo. Se arranca después con `start-replication-task`.',
    details: `
Las reglas de **mapeo** eligen tablas con comodines (\`%\`): \`{"rules":[{"rule-type":"selection","rule-id":"1","rule-name":"tienda","object-locator":{"schema-name":"tienda","table-name":"%"},"rule-action":"include"}]}\`.

Al arrancar, la tarea falla si las conexiones no se han probado con éxito o, para CDC, si el origen no registra cambios. Mira \`describe-replication-tasks\` (\`Status\`, \`LastFailureMessage\`) y \`describe-table-statistics\`.
`,
    scenario: 'data-dms',
    examples: [
      [MAPEO, 'El archivo de mapeo: todas las tablas del esquema `tienda`'],
      ['aws dms create-replication-task --replication-task-identifier t1 --source-endpoint-arn arn:aws:dms:us-east-1:123456789012:endpoint:origen --target-endpoint-arn arn:aws:dms:us-east-1:123456789012:endpoint:destino --replication-instance-arn arn:aws:dms:us-east-1:123456789012:rep:rep1 --migration-type full-load --table-mappings file://mapeo.json', 'Aún no existen los endpoints ni la instancia', 'error'],
    ],
    seeAlso: ['AWS DMS', 'aws dms test-connection', 'Captura de cambios (CDC)'],
  },
  {
    name: 'aws dms test-connection',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws dms test-connection --replication-instance-arn <arn> --endpoint-arn <arn>   →   aws dms describe-connections',
    summary: 'Comprueba desde la instancia de replicación que puede llegar a un endpoint (red, credenciales, permisos del rol). El resultado llega unos segundos después a `describe-connections`.',
    details: `
Mensajes típicos en \`LastFailureMessage\`:

- *the security group … does not allow the replication instance*: abre el puerto de la base al grupo/CIDR de la instancia.
- *Access denied for user*: usuario o contraseña del endpoint.
- *the role needs s3:PutObject, s3:DeleteObject and s3:ListBucket*: faltan permisos al rol del destino S3.
- *cannot be assumed by dms.amazonaws.com*: la política de confianza del rol.

\`aws dms wait test-connection-succeeds\` espera al resultado.
`,
    scenario: 'data-dms',
    examples: [
      ['aws dms describe-connections --query "Connections[].Status" --output text', 'Todavía no hay ninguna prueba'],
      ['aws iam get-role --role-name dms-s3-role --query "Role.AssumeRolePolicyDocument.Statement[0].Principal.Service" --output text', 'El rol de S3 debe confiar en DMS'],
    ],
    seeAlso: ['AWS DMS', 'aws dms create-replication-task'],
  },
  {
    name: 'aws datasync create-task',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws datasync create-task --source-location-arn <arn> --destination-location-arn <arn> [--name <n>] [--includes "FilterType=SIMPLE_PATTERN,Value=/ventas*"] [--options OverwriteMode=ALWAYS,TransferMode=CHANGED]',
    summary: 'Crea la tarea de copia entre dos ubicaciones, con filtros y opciones. `--includes` y `--excludes` aceptan varios patrones separados por `|`.',
    details: `
Antes: \`create-location-nfs\` (con el \`AgentArns\` de un agente \`ONLINE\`) y \`create-location-s3\` (con \`BucketAccessRoleArn\`; DataSync comprueba al momento que el rol puede listar, leer y escribir).

Opciones útiles: \`TransferMode=CHANGED|ALL\`, \`OverwriteMode=ALWAYS|NEVER\`, \`PreserveDeletedFiles=PRESERVE|REMOVE\`, \`VerifyMode\`.
`,
    scenario: 'data-sync',
    examples: [
      ['aws datasync list-agents --query "Agents[].[Name,Status]" --output text', 'El agente de la oficina está ONLINE'],
      ['aws datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::archivo-oficina --s3-config BucketAccessRoleArn=arn:aws:iam::123456789012:role/datasync-role', 'El rol aún no tiene permisos sobre el bucket', 'error'],
    ],
    seeAlso: ['AWS DataSync', 'aws datasync start-task-execution'],
  },
  {
    name: 'aws datasync start-task-execution',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws datasync start-task-execution --task-arn <arn> [--override-options PreserveDeletedFiles=REMOVE]   →   aws datasync describe-task-execution --task-execution-arn <arn>',
    summary: 'Lanza la copia. Pasa por LAUNCHING, PREPARING, TRANSFERRING y VERIFYING hasta SUCCESS (o ERROR, con el motivo).',
    details: 'Una segunda ejecución copia solo lo que cambió (`TransferMode=CHANGED`). `describe-task-execution` muestra `FilesTransferred` y `BytesTransferred`. Si el agente está desconectado, la ejecución acaba en `ERROR`.',
    scenario: 'data-sync',
    examples: [
      ['aws datasync list-tasks --query "Tasks[].Name" --output text', 'Aún no hay tareas'],
      ['aws datasync list-locations --query "Locations[].LocationUri" --output text'],
    ],
    seeAlso: ['AWS DataSync', 'aws datasync create-task'],
  },
];
