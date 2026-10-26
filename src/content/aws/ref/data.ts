import type { AwsRef } from '../reference';

const KEY_ANA = `--key '{"cliente":{"S":"ana"},"fecha":{"S":"2026-02-10"}}'`;

export const AWS_REF_DATA: AwsRef[] = [
  {
    name: 'SQL frente a NoSQL',
    kind: 'comparativa',
    category: 'datos',
    level: 1,
    summary: 'Relacional (tablas, SQL, uniones, transacciones) frente a no relacional (clave-valor, documentos, grafos, en memoria…): se elige por cómo vas a consultar los datos, no por moda.',
    details: `
| | **Relacional (SQL)** | **NoSQL** |
| --- | --- | --- |
| Datos | Tablas con columnas fijas y relaciones | Elementos flexibles (clave-valor, documento, grafo, columnar) |
| Consultas | SQL: cualquier combinación, \`JOIN\`, agregaciones | Pensadas para unos **patrones de acceso concretos** |
| Transacciones | ACID entre muchas tablas | Más limitadas (DynamoDB admite transacciones, con coste) |
| Escala | Vertical (máquina mayor) y réplicas de lectura | Horizontal (más particiones) casi sin límite |
| Esquema | Rígido, se cambia con migraciones | Flexible |
| En AWS | RDS, Aurora | DynamoDB, DocumentDB, Neptune, ElastiCache… |

**NoSQL no significa «sin consistencia»**: DynamoDB permite lecturas fuertemente consistentes y transacciones. Y **SQL no significa «no escala»**: Aurora llega muy lejos. La pregunta es: ¿conozco mis consultas de antemano y necesito escala enorme y latencia de milisegundos (NoSQL), o necesito consultar de muchas formas con integridad entre tablas (SQL)?
`,
    whenUse: ['SQL: datos con muchas relaciones, informes, consultas variadas y transacciones', 'NoSQL: carritos, sesiones, perfiles, catálogos y dispositivos con acceso por clave y mucho volumen'],
    whenNot: ['No elijas NoSQL «porque escala» si no sabes todavía cómo vas a consultar los datos', 'No fuerces SQL para un patrón clave-valor con millones de peticiones por segundo'],
    seeAlso: ['Bases de datos en AWS', 'RDS', 'DynamoDB'],
  },
  {
    name: 'Bases de datos en AWS',
    kind: 'comparativa',
    category: 'datos',
    level: 1,
    summary: 'El mapa de servicios: RDS/Aurora (relacional), DynamoDB (clave-valor/documento), ElastiCache (en memoria), Redshift (almacén de datos), Neptune (grafo), DocumentDB (compatible con MongoDB), Timestream (series temporales).',
    details: `
| Necesito… | Servicio |
| --- | --- |
| Una base de datos relacional estándar (MySQL, PostgreSQL, MariaDB, Oracle, SQL Server) | **RDS** |
| Relacional muy escalable y disponible, compatible con MySQL/PostgreSQL | **Aurora** |
| Clave-valor/documento con latencia de milisegundos y escala masiva, sin servidores | **DynamoDB** |
| Caché o datos en memoria (sesiones, rankings) con latencia de microsegundos | **ElastiCache** (Redis/Memcached) |
| Analítica sobre petabytes de datos estructurados (BI) | **Redshift** |
| Relaciones entre entidades (redes sociales, fraude, recomendaciones) | **Neptune** |
| Compatibilidad con la API de MongoDB | **DocumentDB** |
| Métricas y series temporales (IoT) | **Timestream** |
| Compatibilidad con Cassandra | **Keyspaces** |
`,
    versus: [
      ['RDS frente a Aurora', 'Aurora separa cómputo y almacenamiento (6 copias en 3 zonas) y conmuta en menos de un minuto; suele costar algo más pero rinde y escala mejor.'],
      ['DynamoDB frente a ElastiCache', 'DynamoDB es una base de datos duradera. ElastiCache es una caché en memoria: más rápida, pero para datos que se pueden reconstruir (o con MemoryDB si necesitas durabilidad).'],
    ],
    seeAlso: ['SQL frente a NoSQL', 'RDS', 'Aurora', 'DynamoDB', 'ElastiCache', 'Redshift', 'Neptune', 'DocumentDB'],
  },
  {
    name: 'RDS',
    kind: 'servicio',
    category: 'datos',
    level: 1,
    summary: 'Bases de datos relacionales gestionadas (MySQL, PostgreSQL, MariaDB, Oracle, SQL Server): AWS se encarga del servidor, los parches, las copias de seguridad y la conmutación por error.',
    details: `
Tú eliges motor, versión, **clase de instancia** (\`db.t3.micro\`, \`db.m5.large\`…), almacenamiento y red. AWS se encarga de instalar y parchear el motor, hacer copias automáticas, vigilar y **recuperar** la instancia.

Lo que sigue siendo tuyo: el **esquema**, las consultas, los índices, los **usuarios y permisos dentro de la base** y la **configuración de red** (security groups, subredes privadas). Es un buen ejemplo de **responsabilidad compartida**.

No tienes acceso al sistema operativo (no hay SSH).
`,
    whenUse: ['Aplicaciones con una base relacional que no quieres administrar', 'Migrar una base de datos existente con poco cambio (_lift and shift_)'],
    whenNot: ['Cargas clave-valor enormes con latencia mínima → DynamoDB', 'Si necesitas acceso al SO o una configuración rara → instalarla tú en EC2 (con todo el trabajo que implica)', 'Si necesitas más escala y rapidez de recuperación → Aurora'],
    pricing: 'Por hora de instancia (según su clase; Multi-AZ cobra el doble), por GB de almacenamiento al mes, por IOPS aprovisionadas (según el tipo de disco), por copias de seguridad manuales y por transferencia de datos hacia internet.',
    limits: ['40 instancias por región por defecto (ampliable)', 'Hasta 64 TiB de almacenamiento (la mayoría de motores)', 'Hasta 15 réplicas de lectura (según motor)'],
    scenario: 'rds-base',
    examples: [['aws rds describe-db-instances --query "DBInstances[].[DBInstanceIdentifier,Engine,DBInstanceClass,DBInstanceStatus,MultiAZ]" --output table']],
    seeAlso: ['Aurora', 'Multi-AZ', 'Réplica de lectura', 'Copias de seguridad de RDS', 'Grupo de subredes de RDS'],
  },
  {
    name: 'Aurora',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Base de datos relacional de AWS compatible con MySQL y PostgreSQL: el almacenamiento (6 copias en 3 zonas) se separa del cómputo, crece solo y hasta 15 réplicas de lectura comparten los mismos datos.',
    details: `
- **Clúster**: una instancia **escritora** y hasta 15 **lectoras** que comparten un volumen distribuido.
- **Endpoints**: el del clúster (siempre apunta al escritor) y el de **lectores** (reparte entre las réplicas).
- **Conmutación**: si el escritor cae, una lectora se promueve en unos 30 segundos.
- **Aurora Serverless v2**: la capacidad sube y baja sola (ideal para cargas variables).
- **Aurora Global Database**: replicación a otras regiones con retraso de segundos.
- Almacenamiento que crece hasta 128 TiB sin intervención.
`,
    whenUse: ['Aplicaciones relacionales críticas que necesitan alta disponibilidad y lecturas escalables', 'Cargas con picos (Serverless v2)'],
    whenNot: ['Pruebas pequeñas y baratas → RDS `db.t3.micro` o capa gratuita', 'Si necesitas un motor que Aurora no ofrece (Oracle, SQL Server)'],
    pricing: 'Por hora de instancia (más cara que la de RDS equivalente), por GB de almacenamiento realmente usado y por millón de operaciones de E/S (o el modelo I/O-Optimized, que las incluye). Serverless v2: por ACU-hora.',
    versus: [['Aurora frente a RDS Multi-AZ', 'Multi-AZ de RDS mantiene una copia pasiva que no puedes leer. En Aurora, las réplicas lectoras sirven consultas Y sirven de reserva.']],
    seeAlso: ['RDS', 'Multi-AZ', 'Réplica de lectura'],
  },
  {
    name: 'Multi-AZ',
    kind: 'concepto',
    category: 'datos',
    level: 1,
    summary: 'RDS mantiene una copia síncrona en otra zona de disponibilidad y, si la principal falla, conmuta a ella (de 1 a 2 minutos). Sirve para disponibilidad, no para repartir lecturas.',
    details: `
- La **réplica en espera** (_standby_) se actualiza de forma **síncrona**: nunca pierde datos confirmados.
- La conmutación es **automática** y el nombre del endpoint no cambia (solo cambia a qué servidor apunta).
- **No puedes leer** de la copia en espera (para repartir lecturas, usa réplicas de lectura).
- También protege durante el **mantenimiento**: se parchea primero la reserva.
- **Cuesta el doble** (dos instancias y dos copias del disco).

Probar la conmutación: \`aws rds reboot-db-instance --db-instance-identifier X --force-failover\`.
`,
    whenUse: ['Producción: cualquier base de datos cuya caída duela'],
    whenNot: ['Desarrollo y pruebas (duplica el coste)', 'Para escalar lecturas → réplicas de lectura'],
    pricing: 'El doble que una instancia única (instancia y almacenamiento).',
    versus: [['Multi-AZ frente a réplica de lectura', 'Multi-AZ = disponibilidad (síncrona, no se lee). Réplica de lectura = rendimiento (asíncrona, se lee). Se pueden combinar.']],
    scenario: 'rds-base',
    examples: [['aws rds modify-db-instance --db-instance-identifier tienda-db --multi-az --apply-immediately --query DBInstance.DBInstanceStatus --output text'], ['aws rds wait db-instance-available --db-instance-identifier tienda-db'], ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[MultiAZ,AvailabilityZone,SecondaryAvailabilityZone]" --output text']],
    seeAlso: ['Réplica de lectura', 'RDS', 'aws rds reboot-db-instance'],
  },
  {
    name: 'Réplica de lectura',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Copia asíncrona de una base de datos que sirve consultas de lectura. Reparte la carga (informes, búsquedas), puede estar en otra región y se puede promover a base independiente.',
    details: `
- **Asíncrona**: va con un pequeño retraso (_replica lag_): los datos recién escritos pueden tardar en aparecer.
- Tiene **su propio endpoint**: la aplicación decide qué consultas envía a cada una.
- Se puede crear en **otra región** (recuperación ante desastres o lectura cercana).
- Requiere que la base de origen tenga **copias automáticas activadas** (retención > 0).
- Una réplica se puede **promover** a base independiente (\`promote-read-replica\`).
`,
    whenUse: ['Informes y consultas pesadas que no deben frenar a la aplicación', 'Muchas lecturas y pocas escrituras'],
    whenNot: ['Para tolerar la caída de una zona automáticamente → Multi-AZ', 'Si necesitas leer siempre el último dato escrito'],
    pricing: 'Cada réplica es una instancia más (con su almacenamiento). Entre regiones, además, la transferencia.',
    scenario: 'rds-base',
    examples: [['aws rds create-db-instance-read-replica --db-instance-identifier tienda-lectura --source-db-instance-identifier tienda-db --query DBInstance.DBInstanceStatus --output text'], ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].ReadReplicaDBInstanceIdentifiers" --output text']],
    seeAlso: ['Multi-AZ', 'RDS', 'aws rds create-db-instance-read-replica'],
  },
  {
    name: 'Copias de seguridad de RDS',
    kind: 'concepto',
    category: 'datos',
    level: 1,
    summary: 'Copias automáticas (con recuperación a un punto en el tiempo, retención de 0 a 35 días) y copias manuales (snapshots que no caducan). Restaurar SIEMPRE crea una instancia nueva.',
    details: `
- **Automáticas**: una copia diaria más los registros de transacciones cada pocos minutos. Permiten **restaurar a cualquier instante** (_point-in-time recovery_) dentro del periodo de retención (**1 día por defecto con la CLI, hasta 35**). Con retención **0** están desactivadas (y no podrás crear réplicas).
- **Manuales** (_snapshots_): las pides tú, **no caducan** hasta que las borres y se pueden copiar entre regiones o compartir.
- **Restaurar** no pisa la base existente: crea una **instancia nueva** (con otro endpoint) a partir de la copia. Hay que apuntar la aplicación a la nueva.
- Antes de borrar una instancia, AWS te obliga a elegir: **copia final** o saltarla.
`,
    whenUse: ['Retención de al menos 7 días en producción', 'Un snapshot manual antes de una migración o un cambio arriesgado'],
    whenNot: ['No confundas Multi-AZ con copia de seguridad: si borras datos por error, Multi-AZ replica el borrado'],
    pricing: 'El espacio de las copias automáticas es gratis hasta el tamaño de la base de datos; los snapshots manuales y el exceso se cobran por GB al mes.',
    scenario: 'rds-base',
    examples: [['aws rds create-db-snapshot --db-instance-identifier tienda-db --db-snapshot-identifier ejemplo-snap --query DBSnapshot.Status --output text'], ['aws rds wait db-snapshot-available --db-snapshot-identifier ejemplo-snap'], ['aws rds describe-db-snapshots --query "DBSnapshots[].[DBSnapshotIdentifier,Status,SnapshotType]" --output table']],
    seeAlso: ['aws rds create-db-snapshot', 'aws rds restore-db-instance-from-db-snapshot', 'RDS'],
  },
  {
    name: 'Grupo de subredes de RDS',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Conjunto de subredes (de al menos 2 zonas) de una VPC donde RDS puede colocar tu base de datos. Sirve para meterla en subredes privadas.',
    details: `
Al crear una base de datos eliges un **grupo de subredes**. RDS coloca la instancia en una de sus subredes (y la reserva de Multi-AZ en otra zona). Exige **dos zonas como mínimo**, aunque la base sea de una sola instancia.

Para una base **privada**: grupo con **subredes privadas** + \`--no-publicly-accessible\` + security group que solo deje entrar a la aplicación.
`,
    whenUse: ['Siempre que la base de datos vaya a una VPC propia'],
    whenNot: ['No pongas la base en subredes públicas'],
    scenario: 'base',
    examples: [['aws rds describe-db-subnet-groups --query "DBSubnetGroups[].[DBSubnetGroupName,VpcId,length(Subnets)]" --output table']],
    seeAlso: ['RDS', 'Subred pública y privada', 'Security group'],
  },
  {
    name: 'DynamoDB',
    kind: 'servicio',
    category: 'datos',
    level: 1,
    summary: 'Base de datos NoSQL clave-valor y de documentos, sin servidores, con latencia de milisegundos a cualquier escala. Se paga por lecturas y escrituras (o capacidad reservada).',
    details: `
Una **tabla** contiene **elementos** (_items_) con **atributos** (cada elemento puede tener otros atributos). Lo único obligatorio es la **clave primaria**: **clave de partición** (y, opcionalmente, de ordenación).

- **Sin servidores**: no hay instancias que dimensionar ni parchear; sin tiempo de inactividad.
- **Alta disponibilidad**: datos replicados en 3 zonas.
- **Modos de capacidad**: **bajo demanda** (pagas por petición, sin planificar) o **aprovisionada** (fijas unidades de lectura/escritura; más barata si el tráfico es estable y predecible).
- Extras: **índices secundarios**, **TTL**, **streams**, transacciones, copias a un punto en el tiempo y **tablas globales** (multirregión).
- El diseño empieza por los **patrones de acceso**: primero decides cómo vas a consultar, luego el modelo.
`,
    whenUse: ['Carritos de compra, sesiones, perfiles de usuario, catálogos, historiales', 'Aplicaciones sin servidores (Lambda) y picos impredecibles', 'Latencia constante de milisegundos con millones de peticiones'],
    whenNot: ['Consultas variadas, uniones y agregaciones → relacional (Aurora/RDS)', 'Análisis de todo el histórico → Redshift/Athena', 'Elementos de más de 400 KB → guarda el archivo en S3 y su referencia en DynamoDB'],
    pricing: 'Bajo demanda: por millón de unidades de lectura y escritura. Aprovisionada: por unidad de capacidad y hora. Más: almacenamiento (GB al mes), copias, streams y tablas globales.',
    limits: ['Elemento: máx. 400 KB', 'Una sola partición: 3 000 lecturas y 1 000 escrituras por segundo (se reparte solo entre particiones)', 'Una consulta devuelve como máximo 1 MB por página'],
    scenario: 'ddb-pedidos',
    examples: [['aws dynamodb list-tables --output text'], ['aws dynamodb describe-table --table-name Pedidos --query "Table.[KeySchema[].AttributeName,BillingModeSummary.BillingMode,ItemCount]" --output text']],
    seeAlso: ['Clave de partición y de ordenación', 'Query frente a Scan', 'Índice secundario global', 'TTL de DynamoDB', 'ElastiCache'],
  },
  {
    name: 'Clave de partición y de ordenación',
    kind: 'concepto',
    category: 'datos',
    level: 1,
    summary: 'La clave primaria de DynamoDB: la de partición decide en qué partición física vive el elemento; la de ordenación (opcional) ordena los elementos de una misma partición y permite rangos.',
    details: `
Ejemplo: tabla **Pedidos** con partición \`cliente\` y ordenación \`fecha\`:

\`\`\`
cliente=ana   fecha=2026-01-05  …
cliente=ana   fecha=2026-02-10  …   ← todos los de «ana» juntos y ordenados por fecha
cliente=bob   fecha=2026-01-20  …
\`\`\`

- Con **solo** la partición, cada elemento se identifica por ella (una por elemento).
- Con partición + ordenación, la **pareja** debe ser única. Puedes pedir «todos los pedidos de ana en febrero» con una sola consulta (\`Query\`).
- **Una buena clave de partición reparte la carga**: muchos valores distintos y accedidos de forma pareja. Una clave de poca variedad (por ejemplo, el país) crea una **partición caliente**.
- Sus tipos: cadena (S), número (N) o binario (B). No se pueden cambiar tras crear la tabla.
`,
    whenUse: ['Partición: ID de usuario, de dispositivo, de pedido…', 'Ordenación: fecha, versión o tipo de entidad'],
    whenNot: ['No uses como partición un valor con muy pocos valores distintos ni un contador creciente'],
    seeAlso: ['DynamoDB', 'Query frente a Scan', 'Índice secundario global'],
  },
  {
    name: 'Query frente a Scan',
    kind: 'comparativa',
    category: 'datos',
    level: 1,
    summary: 'Query va directo a una partición (rápida y barata). Scan lee la tabla ENTERA y filtra después (lenta y cara cuanto más crece). Un FilterExpression no ahorra lectura.',
    details: `
| | **Query** | **Scan** |
| --- | --- | --- |
| Qué lee | Solo los elementos con una clave de partición dada (y rango de ordenación) | **Toda** la tabla o índice |
| Coste | Solo lo que devuelve (más el filtro) | Todo lo leído |
| Orden | Por clave de ordenación | **Sin garantía** |
| Requiere | La clave de partición (en la tabla o en un índice) | Nada |

El **filtro** (\`--filter-expression\`) se aplica **después** de leer: \`ScannedCount\` (leídos) puede ser mucho mayor que \`Count\` (devueltos), y se paga lo leído.

Si necesitas buscar por otro atributo con frecuencia, no hagas \`Scan\`: crea un **índice secundario global**.
`,
    whenUse: ['Query para el 99 % de las consultas', 'Scan para tablas pequeñas, exportaciones o tareas puntuales'],
    whenNot: ['No hagas Scan en una tabla grande dentro de una petición de usuario'],
    scenario: 'ddb-pedidos',
    examples: [
      [`aws dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c" --expression-attribute-values '{":c":{"S":"ana"}}' --select COUNT --query "[Count,ScannedCount]" --output text`, 'Solo lee los 3 pedidos de ana'],
      [`aws dynamodb scan --table-name Pedidos --filter-expression "cliente = :c" --expression-attribute-values '{":c":{"S":"ana"}}' --select COUNT --query "[Count,ScannedCount]" --output text`, 'Devuelve lo mismo pero LEYÓ los 5 elementos de la tabla'],
    ],
    seeAlso: ['DynamoDB', 'Índice secundario global', 'aws dynamodb query', 'aws dynamodb scan'],
  },
  {
    name: 'Índice secundario global',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Una «vista» de la tabla con otra clave de partición (y de ordenación) para poder consultar por otros atributos. Se mantiene sola y cuesta lo que cuesta escribir en ella.',
    details: `
Si la tabla **Pedidos** tiene partición \`cliente\`, no puedes preguntar «¿qué pedidos están pendientes?» sin un Scan. Con un **GSI** \`por-estado\` (partición \`estado\`, ordenación \`fecha\`) sí:

\`\`\`
aws dynamodb query --table-name Pedidos --index-name por-estado \\
  --key-condition-expression "estado = :e" ...
\`\`\`

- Se puede crear **o borrar después** (\`update-table\`); la clave de la tabla no.
- Los elementos que **no tienen** el atributo del índice no aparecen (índice **disperso**: muy útil).
- **Proyección**: qué atributos copia (todos, solo claves, o los elegidos): menos copiados = menos coste.
- Es **eventualmente consistente** con la tabla (retraso de milisegundos).
- Cada GSI tiene su propia capacidad y se paga aparte.
`,
    whenUse: ['Consultar por otro atributo con frecuencia', 'Listas «pendientes», «por fecha», «por correo electrónico»'],
    whenNot: ['No crees un GSI «por si acaso»: cada uno multiplica el coste de escritura'],
    scenario: 'ddb-simple',
    examples: [
      [`aws dynamodb update-table --table-name Pedidos --attribute-definitions AttributeName=estado,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"por-estado","KeySchema":[{"AttributeName":"estado","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}}]' --query TableDescription.TableStatus --output text`],
      [`aws dynamodb query --table-name Pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --query Count --output text`],
    ],
    seeAlso: ['DynamoDB', 'Query frente a Scan', 'Clave de partición y de ordenación'],
  },
  {
    name: 'TTL de DynamoDB',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Marca un atributo (hora en segundos desde 1970) y DynamoDB borra solo los elementos caducados, gratis, normalmente en horas (hasta 48 h). Perfecto para sesiones y datos temporales.',
    details: `
- Activas el TTL **por tabla** indicando el atributo (de tipo **número**, con la fecha en _epoch_ de segundos).
- El borrado es **en segundo plano y no inmediato**: un elemento caducado puede seguir apareciendo unas horas; filtra por la fecha si importa.
- **No consume capacidad** de escritura y no cuesta.
- Los borrados aparecen en los **streams**, así puedes archivar lo que caduca.
`,
    whenUse: ['Sesiones de usuario, tokens, cachés y datos temporales', 'Cumplir plazos de retención'],
    whenNot: ['Cuando el borrado debe ser exacto al segundo → hazlo en la aplicación'],
    scenario: 'ddb-sesiones',
    examples: [['aws dynamodb update-time-to-live --table-name Sesiones --time-to-live-specification Enabled=true,AttributeName=expira'], ['aws dynamodb describe-time-to-live --table-name Sesiones --query TimeToLiveDescription --output text']],
    seeAlso: ['DynamoDB', 'aws dynamodb update-time-to-live'],
  },
  {
    name: 'ElastiCache',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Caché y almacén en memoria gestionado (Redis OSS / Valkey y Memcached) con latencia de microsegundos. Se pone delante de una base de datos para aliviar lecturas repetidas.',
    details: `
Patrones habituales:

- **Cache-aside** (_lazy loading_): la aplicación mira primero la caché; si falla, lee de la base de datos y **guarda** el resultado en caché.
- **Almacén de sesiones** de usuario.
- **Rankings** en tiempo real (conjuntos ordenados de Redis), colas y mensajería ligera.

**Redis** (estructuras avanzadas, persistencia opcional, replicación y Multi-AZ) frente a **Memcached** (simple, multihilo, sin replicación). Si necesitas durabilidad total en memoria: **MemoryDB**.

Los datos de una caché **se pueden perder**: la fuente de verdad sigue siendo la base de datos.
`,
    whenUse: ['Reducir lecturas repetidas a RDS/DynamoDB', 'Sesiones y rankings con respuesta instantánea'],
    whenNot: ['Como única base de datos de datos importantes → MemoryDB/RDS/DynamoDB', 'Datos que casi nunca se repiten (no habrá aciertos de caché)'],
    pricing: 'Por hora de nodo (según su tamaño) y por GB de transferencia entre zonas. Existe también modalidad sin servidores.',
    seeAlso: ['DynamoDB', 'RDS', 'Bases de datos en AWS'],
  },
  {
    name: 'Redshift',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Almacén de datos (data warehouse) en columnas para analítica sobre terabytes o petabytes con SQL. Pensado para informes e inteligencia de negocio (OLAP), no para transacciones (OLTP).',
    details: `
Guarda los datos **por columnas** y los comprime, así que las consultas que agregan millones de filas (_suma de ventas por mes_) son muy rápidas. Hay modalidad **Serverless** (sin gestionar clústeres).

Se carga desde S3 (\`COPY\`), y con **Redshift Spectrum** puede consultar datos que se quedan en S3. Se conecta con herramientas de BI como QuickSight.

**OLTP** (muchas lecturas/escrituras pequeñas: la tienda) → RDS/Aurora. **OLAP** (pocas consultas enormes: el informe del trimestre) → Redshift.
`,
    whenUse: ['Informes y cuadros de mando sobre grandes volúmenes históricos', 'Combinar datos de muchas fuentes para analizarlos'],
    whenNot: ['Operaciones del día a día de una aplicación → RDS/DynamoDB', 'Consultas puntuales sobre archivos en S3 sin montar un almacén → Athena'],
    pricing: 'Por hora de nodo (clúster aprovisionado) o por RPU-hora consumida (Serverless), más el almacenamiento gestionado.',
    seeAlso: ['Bases de datos en AWS', 'RDS'],
  },
  {
    name: 'Neptune',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Base de datos de grafos gestionada: guarda nodos y las relaciones entre ellos y recorre conexiones (amigos de amigos, rutas, fraude) en milisegundos.',
    details: `
Modelos y lenguajes: **property graph** (Gremlin, openCypher) y **RDF** (SPARQL).

Un grafo es mejor que tablas cuando la pregunta es sobre **conexiones**: «¿quién conoce a quién a tres saltos?», «¿qué productos compran los que compraron esto?», «¿estas cuentas están relacionadas con un fraude?». En SQL, esas consultas requieren uniones encadenadas que se vuelven muy lentas.
`,
    whenUse: ['Redes sociales, motores de recomendación, detección de fraude, grafos de conocimiento'],
    whenNot: ['Datos tabulares sin relaciones profundas → RDS/DynamoDB'],
    seeAlso: ['Bases de datos en AWS', 'DocumentDB'],
  },
  {
    name: 'DocumentDB',
    kind: 'servicio',
    category: 'datos',
    level: 2,
    summary: 'Base de datos de documentos JSON gestionada y compatible con la API de MongoDB. Útil para migrar aplicaciones MongoDB con pocos cambios.',
    details: `
Guarda documentos JSON flexibles y los consulta con la API de MongoDB. Su arquitectura es parecida a la de Aurora: almacenamiento distribuido en 3 zonas con réplicas de lectura.

Si empiezas de cero y no necesitas la compatibilidad con MongoDB, **DynamoDB** (sin servidores, escala mayor y modelo sencillo) suele ser más sencillo.
`,
    whenUse: ['Migrar aplicaciones que ya usan MongoDB'],
    whenNot: ['Proyectos nuevos sin dependencia de MongoDB → DynamoDB', 'Datos relacionales → RDS/Aurora'],
    seeAlso: ['DynamoDB', 'Bases de datos en AWS', 'Neptune'],
  },
  {
    name: 'Bases de datos especializadas',
    kind: 'concepto',
    category: 'datos',
    level: 2,
    summary: 'Timestream (series temporales), Keyspaces (compatible con Cassandra), MemoryDB (Redis duradero en memoria) y otras para casos concretos.',
    details: `
- **Timestream**: métricas e IoT con millones de puntos por segundo y consultas por intervalos de tiempo.
- **Keyspaces**: Apache Cassandra gestionado y sin servidores.
- **MemoryDB**: compatible con Redis, **durable** (registro multi-AZ): sirve como base de datos principal en memoria.
- **OpenSearch**: búsqueda de texto y análisis de registros.

Regla: **elige la herramienta por el patrón de acceso**, no al revés.
`,
    whenUse: ['Cuando el patrón de acceso encaja de forma clara con uno de ellos'],
    whenNot: ['No pongas una base especializada si una general (RDS/DynamoDB) cubre bien el caso: más servicios = más que operar'],
    seeAlso: ['Bases de datos en AWS', 'ElastiCache'],
  },
  {
    name: 'aws rds create-db-instance',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Crea una base de datos RDS. Obligatorios: identificador, clase, motor y, para motores no Aurora, usuario, contraseña (8+ caracteres) y almacenamiento.',
    usage: 'aws rds create-db-instance --db-instance-identifier tienda-db --db-instance-class db.t3.micro \\\n  --engine mysql --master-username admin --master-user-password \'Secreta123\' --allocated-storage 20 \\\n  [--multi-az] [--backup-retention-period 7] [--no-publicly-accessible] [--deletion-protection]',
    details: 'Tarda unos minutos en pasar de `creating` a `available`: usa `aws rds wait db-instance-available --db-instance-identifier <id>`. **No pongas contraseñas reales en la línea de comandos** (quedan en el historial): usa Secrets Manager (`--manage-master-user-password`).',
    scenario: 'base',
    examples: [
      ["aws rds create-db-instance --db-instance-identifier ejemplo-db --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password 'Secreta123' --allocated-storage 20 --query DBInstance.DBInstanceStatus --output text"],
      ['aws rds wait db-instance-available --db-instance-identifier ejemplo-db'],
      ['aws rds describe-db-instances --db-instance-identifier ejemplo-db --query "DBInstances[0].Endpoint.[Address,Port]" --output text', 'El endpoint al que se conecta la aplicación'],
      ["aws rds create-db-instance --db-instance-identifier otra-db --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password 'corta' --allocated-storage 20", 'La contraseña tiene menos de 8 caracteres', 'error'],
    ],
    seeAlso: ['RDS', 'Multi-AZ', 'Copias de seguridad de RDS', 'aws rds describe-db-instances'],
  },
  {
    name: 'aws rds describe-db-instances',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Lista las bases de datos con su estado, motor, clase, Multi-AZ, endpoint y cambios pendientes.',
    usage: 'aws rds describe-db-instances [--db-instance-identifier <id>]',
    scenario: 'rds-base',
    examples: [['aws rds describe-db-instances --query "DBInstances[].[DBInstanceIdentifier,DBInstanceStatus,Endpoint.Address]" --output table'], ['aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].[BackupRetentionPeriod,MultiAZ,PubliclyAccessible,DeletionProtection]" --output text']],
    seeAlso: ['RDS'],
  },
  {
    name: 'aws rds modify-db-instance',
    kind: 'comando',
    category: 'datos',
    level: 2,
    summary: 'Cambia una base de datos existente: clase, disco (solo crece), Multi-AZ, retención de copias, acceso público, protección contra borrado… Con `--apply-immediately` se aplica ya (puede reiniciar); si no, en la ventana de mantenimiento.',
    usage: 'aws rds modify-db-instance --db-instance-identifier <id> [--db-instance-class …] [--multi-az] [--backup-retention-period 7] [--apply-immediately]',
    details: 'Sin `--apply-immediately`, el cambio queda en `PendingModifiedValues`. Con `--apply-immediately` se aplican **también** los cambios que estuvieran pendientes.',
    scenario: 'rds-base',
    examples: [['aws rds modify-db-instance --db-instance-identifier tienda-db --db-instance-class db.t3.small --query DBInstance.PendingModifiedValues --output text', 'Queda pendiente hasta la ventana de mantenimiento'], ['aws rds modify-db-instance --db-instance-identifier tienda-db --allocated-storage 10 --apply-immediately', 'El disco no se puede reducir', 'error']],
    seeAlso: ['RDS', 'Multi-AZ'],
  },
  {
    name: 'aws rds create-db-snapshot',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Crea una copia manual (snapshot) de una base de datos. No caduca hasta que la borres.',
    usage: 'aws rds create-db-snapshot --db-instance-identifier <id> --db-snapshot-identifier <nombre>',
    scenario: 'rds-base',
    examples: [['aws rds create-db-snapshot --db-instance-identifier tienda-db --db-snapshot-identifier antes-del-cambio --query DBSnapshot.Status --output text'], ['aws rds wait db-snapshot-available --db-snapshot-identifier antes-del-cambio']],
    seeAlso: ['Copias de seguridad de RDS', 'aws rds restore-db-instance-from-db-snapshot'],
  },
  {
    name: 'aws rds restore-db-instance-from-db-snapshot',
    kind: 'comando',
    category: 'datos',
    level: 2,
    summary: 'Crea una instancia NUEVA a partir de un snapshot. La original no se toca: la aplicación debe apuntar al nuevo endpoint.',
    usage: 'aws rds restore-db-instance-from-db-snapshot --db-instance-identifier <nueva> --db-snapshot-identifier <snap>',
    scenario: 'rds-base',
    examples: [
      ['aws rds create-db-snapshot --db-instance-identifier tienda-db --db-snapshot-identifier base-snap'],
      ['aws rds wait db-snapshot-available --db-snapshot-identifier base-snap'],
      ['aws rds restore-db-instance-from-db-snapshot --db-instance-identifier tienda-restaurada --db-snapshot-identifier base-snap --query DBInstance.DBInstanceStatus --output text'],
    ],
    seeAlso: ['Copias de seguridad de RDS', 'aws rds create-db-snapshot'],
  },
  {
    name: 'aws rds create-db-instance-read-replica',
    kind: 'comando',
    category: 'datos',
    level: 2,
    summary: 'Crea una réplica de lectura asíncrona de una instancia. El origen necesita copias automáticas activadas (`BackupRetentionPeriod` > 0).',
    usage: 'aws rds create-db-instance-read-replica --db-instance-identifier <replica> --source-db-instance-identifier <origen>',
    scenario: 'rds-base',
    examples: [['aws rds create-db-instance-read-replica --db-instance-identifier tienda-lectura --source-db-instance-identifier tienda-db --query DBInstance.ReadReplicaSourceDBInstanceIdentifier --output text']],
    seeAlso: ['Réplica de lectura', 'Copias de seguridad de RDS'],
  },
  {
    name: 'aws rds reboot-db-instance',
    kind: 'comando',
    category: 'datos',
    level: 2,
    summary: 'Reinicia la instancia. Con `--force-failover` (solo Multi-AZ) fuerza la conmutación a la zona de reserva: la forma de probar la alta disponibilidad.',
    usage: 'aws rds reboot-db-instance --db-instance-identifier <id> [--force-failover]',
    scenario: 'rds-base',
    examples: [['aws rds reboot-db-instance --db-instance-identifier tienda-db --force-failover', 'La base no es Multi-AZ: no hay a dónde conmutar', 'error']],
    seeAlso: ['Multi-AZ', 'RDS'],
  },
  {
    name: 'aws dynamodb create-table',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Crea una tabla: definición de los atributos de clave, clave primaria y modo de facturación (`PAY_PER_REQUEST` o `PROVISIONED`).',
    usage: 'aws dynamodb create-table --table-name Productos \\\n  --attribute-definitions AttributeName=id,AttributeType=S \\\n  --key-schema AttributeName=id,KeyType=HASH \\\n  --billing-mode PAY_PER_REQUEST',
    details: 'Solo se declaran los atributos que forman parte de **claves** (de la tabla o de índices); el resto se añade libremente. Tarda unos segundos en pasar de `CREATING` a `ACTIVE` (`aws dynamodb wait table-exists`).',
    scenario: 'base',
    examples: [
      ['aws dynamodb create-table --table-name Productos --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST --query TableDescription.TableStatus --output text'],
      ['aws dynamodb wait table-exists --table-name Productos'],
      ['aws dynamodb create-table --table-name Otra --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH', 'Sin --billing-mode hay que dar la capacidad aprovisionada', 'error'],
    ],
    seeAlso: ['DynamoDB', 'Clave de partición y de ordenación'],
  },
  {
    name: 'aws dynamodb put-item',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Crea o REEMPLAZA un elemento entero. Los valores llevan su tipo: `{"S":"texto"}`, `{"N":"5"}` (los números van como texto), `{"BOOL":true}`, `{"L":[…]}`, `{"M":{…}}`.',
    usage: "aws dynamodb put-item --table-name Pedidos --item '{\"cliente\":{\"S\":\"ana\"},\"fecha\":{\"S\":\"2026-04-01\"},\"importe\":{\"N\":\"20\"}}' \\\n  [--condition-expression \"attribute_not_exists(cliente)\"]",
    details: 'Con `--condition-expression "attribute_not_exists(cliente)"` solo crea si **no existe** (evita pisar un elemento). Si la condición falla: `ConditionalCheckFailedException`.',
    scenario: 'ddb-pedidos',
    examples: [
      [`aws dynamodb put-item --table-name Pedidos --item '{"cliente":{"S":"dani"},"fecha":{"S":"2026-04-01"},"estado":{"S":"pendiente"},"importe":{"N":"20"}}' --condition-expression "attribute_not_exists(cliente)"`],
      [`aws dynamodb put-item --table-name Pedidos --item '{"cliente":{"S":"dani"},"fecha":{"S":"2026-04-01"}}' --condition-expression "attribute_not_exists(cliente)"`, 'Ya existe: la condición falla', 'error'],
    ],
    seeAlso: ['DynamoDB', 'aws dynamodb update-item', 'aws dynamodb get-item'],
  },
  {
    name: 'aws dynamodb get-item',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Lee un elemento por su clave primaria COMPLETA (partición + ordenación). La forma más rápida y barata de leer.',
    usage: "aws dynamodb get-item --table-name Pedidos --key '{\"cliente\":{\"S\":\"ana\"},\"fecha\":{\"S\":\"2026-02-10\"}}' [--consistent-read]",
    details: 'Por defecto la lectura es **eventualmente consistente** (puede ver datos de hace milisegundos); con `--consistent-read` es **fuerte** (cuesta el doble de unidades). Si no existe, devuelve `{}` (no es un error).',
    scenario: 'ddb-pedidos',
    examples: [[`aws dynamodb get-item --table-name Pedidos ${KEY_ANA}`], [`aws dynamodb get-item --table-name Pedidos ${KEY_ANA} --projection-expression "estado,importe" --query Item.estado.S --output text`]],
    seeAlso: ['DynamoDB', 'aws dynamodb query'],
  },
  {
    name: 'aws dynamodb query',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Busca los elementos de UNA clave de partición, opcionalmente acotados por la clave de ordenación (`=`, `<`, `BETWEEN`, `begins_with`). Con `--index-name` consulta un índice.',
    usage: "aws dynamodb query --table-name Pedidos --key-condition-expression \"cliente = :c\" \\\n  --expression-attribute-values '{\":c\":{\"S\":\"ana\"}}' [--no-scan-index-forward] [--limit 10]",
    details: 'Las **palabras reservadas** (`status`, `name`, `date`, `year`…) no se pueden usar como nombre de atributo directamente: se rodean con un marcador (`#s`) declarado en `--expression-attribute-names \'{"#s":"status"}\'`.',
    scenario: 'ddb-pedidos',
    examples: [
      [`aws dynamodb query --table-name Pedidos --key-condition-expression "cliente = :c AND fecha >= :f" --expression-attribute-values '{":c":{"S":"ana"},":f":{"S":"2026-02-01"}}' --query "Items[].fecha.S" --output text`],
      [`aws dynamodb query --table-name Pedidos --index-name por-estado --key-condition-expression "estado = :e" --expression-attribute-values '{":e":{"S":"pendiente"}}' --select COUNT --query Count --output text`],
    ],
    seeAlso: ['Query frente a Scan', 'Índice secundario global', 'DynamoDB'],
  },
  {
    name: 'aws dynamodb scan',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Lee TODA la tabla (o índice) y filtra después. Caro y lento en tablas grandes; úsalo en tablas pequeñas o tareas puntuales.',
    usage: 'aws dynamodb scan --table-name Pedidos [--filter-expression "importe > :m" --expression-attribute-values …] [--select COUNT]',
    scenario: 'ddb-pedidos',
    examples: [[`aws dynamodb scan --table-name Pedidos --filter-expression "importe > :m" --expression-attribute-values '{":m":{"N":"20"}}' --query "[Count,ScannedCount]" --output text`, 'Devuelve 3 pero leyó 5']],
    seeAlso: ['Query frente a Scan', 'DynamoDB'],
  },
  {
    name: 'aws dynamodb update-item',
    kind: 'comando',
    category: 'datos',
    level: 1,
    summary: 'Modifica atributos de un elemento SIN reemplazarlo entero (`SET`, `REMOVE`, `ADD`). Crea el elemento si no existe. Admite condiciones.',
    usage: "aws dynamodb update-item --table-name Pedidos --key '{…}' \\\n  --update-expression \"SET importe = importe + :d\" --expression-attribute-values '{\":d\":{\"N\":\"5\"}}'",
    details: 'Para contadores: `ADD visitas :uno`. Para no pisar un valor: `SET nota = if_not_exists(nota, :n)`. Para actualizar solo si el estado actual es el esperado: `--condition-expression "estado = :p"` (control de concurrencia optimista).',
    scenario: 'ddb-pedidos',
    examples: [[`aws dynamodb update-item --table-name Pedidos ${KEY_ANA} --update-expression "SET importe = importe + :d" --expression-attribute-values '{":d":{"N":"5"}}' --return-values UPDATED_NEW --query Attributes.importe.N --output text`], [`aws dynamodb update-item --table-name Pedidos ${KEY_ANA} --update-expression "SET status = :v" --expression-attribute-values '{":v":{"S":"x"}}'`, '«status» es palabra reservada: hay que usar #s', 'error']],
    seeAlso: ['aws dynamodb put-item', 'DynamoDB'],
  },
  {
    name: 'aws dynamodb update-time-to-live',
    kind: 'comando',
    category: 'datos',
    level: 2,
    summary: 'Activa o desactiva el TTL de una tabla indicando el atributo con la hora de caducidad (epoch en segundos).',
    usage: 'aws dynamodb update-time-to-live --table-name Sesiones --time-to-live-specification Enabled=true,AttributeName=expira',
    scenario: 'ddb-sesiones',
    examples: [['aws dynamodb update-time-to-live --table-name Sesiones --time-to-live-specification Enabled=true,AttributeName=expira'], ['aws dynamodb describe-time-to-live --table-name Sesiones --query TimeToLiveDescription.TimeToLiveStatus --output text']],
    seeAlso: ['TTL de DynamoDB', 'DynamoDB'],
  },
];
