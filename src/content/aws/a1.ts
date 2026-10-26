import { A, all, awsHas, awsIs, awsWorld, content, demo, illus, learn, lesson, match, mc, multi, out, practice, predict, ran, tf, typeCmd } from './awsbuild';

export const a1 = awsWorld({
  id: 'a1',
  index: 1,
  title: 'Hola, nube',
  subtitle: 'Qué es AWS y cómo se organiza',
  emoji: '☁️',
  color: '#A78BFA',
  level: 'basico',
  intro:
    'Hoy empiezas en la nube. No necesitas tarjeta de crédito ni miedo a la factura: el laboratorio de esta app es una cuenta de AWS simulada que responde como la real, con los mismos comandos de la CLI. En esta zona entenderás qué es «la nube», cómo está montada por dentro (regiones y zonas), quién se responsabiliza de qué, cómo te conectas y cómo evitar el susto de la factura desde el primer día.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a1-1', { title: '¿Qué es la nube?', summary: 'Servidores que alquilas por uso, y tu primer comando', emoji: '☁️', commands: ['Nube', 'aws sts get-caller-identity'], minutes: 9 }, [
      learn(
        'Un ordenador que alquilas',
        `
Antes de la nube, si querías publicar una web tenías que **comprar servidores**, ponerles un sitio con electricidad y refrigeración, instalarlos y mantenerlos… calculando de antemano cuánta gente te visitaría. Si te equivocabas por poco, la web se caía; si te equivocabas por mucho, tenías máquinas pagadas y paradas.

La **nube** cambia el trato: en vez de comprar, **alquilas** lo que necesitas (cómputo, almacenamiento, redes, bases de datos…) a través de internet, lo tienes en minutos y **pagas solo por lo que usas**.

| Antes | Con la nube |
| --- | --- |
| Compras servidores (inversión inicial grande) | Alquilas por uso (gasto mensual) |
| Calculas la capacidad para el peor día del año | Aumentas o reduces según la demanda |
| Semanas para tener un servidor nuevo | Minutos |
| Mantienes el centro de datos | Lo mantiene el proveedor |

> CLAVE: Se dice que pasas de **CapEx** (inversión de capital, comprar) a **OpEx** (gasto operativo, alquilar). No es solo contabilidad: te quita el riesgo de equivocarte al calcular.
`,
        '☁️',
      ),
      mc(
        'Una tienda online espera un pico enorme de visitas solo en Navidad. ¿Qué ventaja de la nube le ayuda más?',
        ['Comprar más servidores en enero', 'Aumentar la capacidad en diciembre y reducirla después, pagando solo por ese tiempo', 'Tener un centro de datos propio', 'Pagar una cuota fija enorme todo el año'],
        1,
        'Eso es la **elasticidad**: la capacidad sube y baja con la demanda y solo pagas lo que usas.',
      ),
      learn(
        'Tres modelos de servicio',
        `
Según **cuánto te gestiona el proveedor**, los servicios de nube se agrupan en tres modelos:

- **IaaS** (_Infrastructure as a Service_): te dan la máquina «en bruto» (servidor, disco, red) y tú instalas el sistema operativo y tus programas. Ejemplo en AWS: **EC2**.
- **PaaS** (_Platform as a Service_): te dan una plataforma ya preparada y tú solo subes tu código. Ejemplos: **Elastic Beanstalk**, o **Lambda** (ni siquiera ves el servidor).
- **SaaS** (_Software as a Service_): te dan el programa terminado y tú solo lo usas. Ejemplos: Gmail, Microsoft 365, Amazon Chime.

A más gestión del proveedor, **menos control y menos trabajo** para ti.
`,
        '🧱',
      ),
      illus('aws-service-models', 'Quién gestiona cada capa', 'Toca cada modelo: lo oscuro lo gestiona el proveedor, lo claro lo gestionas tú.'),
      match(
        'Une cada servicio con su modelo',
        [
          ['EC2: un servidor virtual', 'IaaS'],
          ['Elastic Beanstalk: subes el código y se encarga de lo demás', 'PaaS'],
          ['Gmail: usas el correo, sin instalar nada', 'SaaS'],
        ],
        'IaaS = la infraestructura en bruto; PaaS = la plataforma lista para tu código; SaaS = el programa terminado.',
      ),
      tf('«En la nube, el cliente compra los servidores y AWS los guarda en su centro de datos.»', false, 'No compras el hardware: alquilas capacidad. Los servidores son de AWS y pagas por el tiempo que los usas.'),
      learn(
        'Tu laboratorio: la CLI de AWS',
        `
AWS se puede manejar con la **consola web** (haciendo clic) o con la **CLI** (_Command Line Interface_): una herramienta de línea de comandos, ideal para automatizar y repetir tareas. En este curso usarás la CLI, porque es lo que usan los profesionales y deja claro **qué estás pidiendo**.

Todos los comandos tienen la misma forma:

\`\`\`
aws <servicio> <operación> [--opciones]
\`\`\`

Y el primero que debes conocer te dice **quién eres para AWS** y en qué cuenta estás:
`,
        '⌨️',
      ),
      demo(
        'Tu primera llamada a AWS',
        [
          ['aws sts get-caller-identity', 'STS es el servicio de identidades: te devuelve la cuenta (Account), el identificador (UserId) y tu «dirección» única en AWS (Arn)'],
          ['aws sts get-caller-identity --query Account --output text', '`--query` filtra solo lo que quieres; `--output text` quita las comillas y el formato JSON'],
        ],
        A('base'),
        'Esta es una cuenta de AWS de práctica: nada de lo que hagas aquí cuesta dinero ni afecta a nadie.',
      ),
      predict(
        '¿Qué imprime este comando?',
        'aws sts get-caller-identity --query Arn --output text',
        ['alumno', 'arn:aws:iam::123456789012:root', '123456789012'],
        'El **ARN** (_Amazon Resource Name_) es el nombre completo y único de cada recurso en AWS. El tuyo es el de un usuario de IAM llamado «alumno».',
        A('base'),
      ),
      practice({
        prompt: 'Cada cuenta de AWS tiene un número de **12 dígitos**. Averigua el de esta cuenta con la CLI y muéstralo (solo el número).',
        goal: 'Mostrar el número de cuenta',
        setup: A('base'),
        check: all(ran('aws\\s+sts\\s+get-caller-identity'), out('123456789012')),
        solution: ['aws sts get-caller-identity --query Account --output text'],
        hints: ['El servicio es `sts` y la operación `get-caller-identity`.', 'Para quedarte solo con el número usa `--query Account --output text`.'],
        explain: 'La respuesta de `get-caller-identity` trae `Account`, `UserId` y `Arn`. Con `--query Account` eliges ese campo y con `--output text` lo ves sin comillas.',
        par: 1,
        commands: ['aws sts get-caller-identity'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a1-2', { title: 'La infraestructura global', summary: 'Regiones, zonas de disponibilidad y puntos de borde', emoji: '🌍', commands: ['Región', 'Zona de disponibilidad', 'Edge location', 'aws ec2 describe-regions'], minutes: 10 }, [
      learn(
        'Regiones: países de la nube',
        `
AWS no es «un gran ordenador»: son **miles de centros de datos** repartidos por el mundo y organizados en tres niveles:

- **Región**: una zona geográfica con varios centros de datos (por ejemplo \`eu-west-1\` es Irlanda, \`us-east-1\` es el norte de Virginia, \`sa-east-1\` es São Paulo, \`eu-south-2\` es España). Cada región es **independiente** de las demás: lo que creas en una no existe en otra.
- **Zona de disponibilidad** (AZ, _Availability Zone_): uno o varios centros de datos dentro de una región, con electricidad, refrigeración y red propias. Cada región tiene **al menos tres**, separadas decenas de kilómetros pero conectadas por redes muy rápidas. Se nombran con una letra: \`eu-west-1a\`, \`eu-west-1b\`, \`eu-west-1c\`.
- **Edge location** (punto de presencia): pequeños nodos repartidos por cientos de ciudades que acercan el contenido al usuario (los usan CloudFront y Route 53). No ejecutas tus servidores en ellos.

> NOTA: AWS añade regiones con frecuencia. El número exacto cambia, así que consúltalo en la documentación oficial (_AWS Global Infrastructure_) cuando lo necesites.
`,
        '🌍',
      ),
      illus('aws-global-infra', 'Región → zonas → centros de datos', 'Toca cada nivel para ver qué es y para qué sirve.'),
      mc('¿Qué es una **zona de disponibilidad**?', ['Un país entero donde AWS tiene oficinas', 'Uno o más centros de datos independientes dentro de una región', 'Un servidor virtual', 'Un punto de caché para vídeos'], 1, 'Una AZ son centros de datos aislados (energía, red, refrigeración) dentro de una región. Varias AZ juntas forman la región.'),
      demo(
        'Mira la infraestructura real',
        [
          ['aws ec2 describe-regions --query "Regions[].RegionName" --output text', 'Las regiones disponibles para tu cuenta'],
          ['aws ec2 describe-availability-zones --region eu-west-1 --query "AvailabilityZones[].ZoneName" --output text', 'Las zonas de Irlanda: tres, con letras a, b y c'],
          ['aws ec2 describe-availability-zones --region us-east-1 --query "length(AvailabilityZones)"', 'Virginia es una de las regiones más grandes: tiene seis zonas'],
        ],
        A('base'),
      ),
      match(
        'Une cada nivel con lo que es',
        [
          ['Región', 'Zona geográfica independiente, con varias AZ'],
          ['Zona de disponibilidad', 'Uno o más centros de datos aislados de una región'],
          ['Edge location', 'Nodo cercano al usuario para acelerar contenido'],
        ],
        'Región > zona de disponibilidad > centro de datos. Las edge locations son aparte: acercan contenido al usuario pero no alojan tus servidores.',
      ),
      learn(
        'Por qué importan las zonas: la alta disponibilidad',
        `
Un centro de datos puede quedarse sin luz, inundarse o perder la red. Si todo tu sistema está en **una sola zona**, ese día tu web se cae.

Si repartes tus servidores entre **dos o más zonas** de la misma región, cuando una falla las demás siguen atendiendo. A eso se le llama **alta disponibilidad**, y AWS está diseñado para que sea fácil: casi todos sus servicios te dejan elegir varias zonas.

> TIP: Regla de oro de AWS: **diseña para que algo se rompa**. No «si falla», sino «cuando falle, ¿mi sistema sigue vivo?».
`,
        '🛡️',
      ),
      mc('Quieres que tu aplicación siga funcionando aunque se caiga un centro de datos. ¿Qué haces?', ['Usar un servidor más grande', 'Repartir los servidores entre varias zonas de disponibilidad', 'Cambiar el nombre de la región', 'Usar solo S3'], 1, 'Cada zona es un fallo independiente: con servidores en dos o más zonas, perder una no tumba el sistema.'),
      tf('«Dos zonas de disponibilidad de la misma región pueden usarse a la vez para tolerar fallos.»', true, 'Exacto: son independientes entre sí pero están en la misma región, conectadas con baja latencia.'),
      typeCmd(
        'Escribe el comando que muestra las zonas de disponibilidad de la región `eu-west-1`.',
        ['aws ec2 describe-availability-zones --region eu-west-1'],
        'La operación es `describe-availability-zones` del servicio `ec2` y la región se indica con `--region`.',
        { setup: A('base'), hint: 'aws ec2 describe-… --region eu-west-1', regex: '^aws ec2 describe-availability-zones --region eu-west-1' },
      ),
      practice({
        prompt: 'Averigua cuáles son las **zonas de disponibilidad de la región `eu-west-1`** (Irlanda). Muestra solo sus nombres, separados por espacios.',
        goal: 'Listar los nombres de las zonas de eu-west-1',
        setup: A('base'),
        check: all(ran('describe-availability-zones'), out(['eu-west-1a', 'eu-west-1b', 'eu-west-1c'])),
        solution: ['aws ec2 describe-availability-zones --region eu-west-1 --query "AvailabilityZones[].ZoneName" --output text'],
        hints: ['La operación es `ec2 describe-availability-zones`.', 'Añade `--region eu-west-1`.', 'Con `--query "AvailabilityZones[].ZoneName" --output text` te quedas solo con los nombres.'],
        explain: 'Cada operación regional se ejecuta en una región: la de tu configuración o la que indiques con `--region`. `[]` recorre la lista y `.ZoneName` extrae el nombre de cada zona.',
        par: 1,
        commands: ['aws ec2 describe-regions'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a1-3', { title: 'Responsabilidad compartida', summary: 'Qué protege AWS y qué proteges tú', emoji: '🤝', commands: ['Responsabilidad compartida', 'aws s3api get-public-access-block'], minutes: 9 }, [
      learn(
        'Dos mitades de la seguridad',
        `
La seguridad en AWS se reparte entre AWS y tú. Es **el concepto más preguntado** del examen de Cloud Practitioner, y el que más problemas reales evita:

- **AWS protege la nube** (_security **of** the cloud_): los edificios, el hardware, la electricidad, la red global, el software de virtualización y los propios servicios.
- **Tú proteges lo que pones en la nube** (_security **in** the cloud_): tus datos, quién puede acceder (IAM), la configuración de los servicios, el cifrado, los firewalls (_security groups_) y, si usas servidores, **el sistema operativo y sus parches**.

Una imagen sencilla: el banco es responsable de la cámara acorazada; tú de no dejar la llave de tu caja puesta.
`,
        '🤝',
      ),
      illus('aws-shared-responsibility', 'Se reparte según el servicio', 'Cambia de servicio: cuanto más gestionado es, menos te toca a ti.'),
      mc('Con una instancia **EC2**, ¿quién instala los parches de seguridad del sistema operativo?', ['AWS, automáticamente', 'El cliente', 'Nadie: no hacen falta', 'El proveedor de internet'], 1, 'EC2 es IaaS: AWS te da la máquina virtual, pero el sistema operativo invitado es tuyo. Parchearlo es responsabilidad del cliente.'),
      multi(
        'Marca las tareas que son responsabilidad **del cliente**.',
        ['Decidir quién puede leer un bucket de S3', 'Proteger el edificio del centro de datos', 'Cifrar los datos sensibles', 'Cambiar un disco duro roto en un servidor físico', 'Abrir o cerrar puertos en un security group'],
        [0, 2, 4],
        'AWS se ocupa de lo físico y de la plataforma (edificios, discos, hipervisor). Los permisos, el cifrado y los firewalls de tus recursos los configuras tú.',
      ),
      learn(
        'Cuanto más gestionado el servicio, menos tareas tuyas',
        `
| Servicio | Tú gestionas… |
| --- | --- |
| **EC2** (IaaS) | Sistema operativo, parches, aplicaciones, firewall, datos |
| **RDS** (base de datos gestionada) | Datos, usuarios, configuración y acceso (AWS parchea el motor) |
| **S3** (almacenamiento) | Datos, permisos del bucket y cifrado |
| **Lambda** (sin servidores) | Tu código y sus permisos |

En **todos** los casos, los datos y los permisos son tuyos.
`,
        '📊',
      ),
      demo(
        'AWS te lo deja protegido por defecto… mantenerlo es cosa tuya',
        [
          ['aws s3 mb s3://datos-clientes-2026', 'Creamos un bucket (el nombre debe ser único en todo el mundo)'],
          ['aws s3api get-public-access-block --bucket datos-clientes-2026', 'Los cuatro bloqueos de acceso público vienen activados en los buckets nuevos'],
        ],
        A('base'),
      ),
      tf('«Si AWS cifra los discos de sus servidores, ya no tengo que preocuparme de quién puede leer mis ficheros en S3.»', false, 'AWS protege la infraestructura, pero los permisos del bucket (¿es público?, ¿quién lee?) los decides tú. Muchas filtraciones vienen de buckets mal configurados por sus dueños.'),
      practice({
        prompt:
          'Tu equipo va a guardar datos de clientes. Crea un bucket llamado **`datos-clientes-2026`** y **comprueba** que los bloqueos de acceso público están activos (en concreto `BlockPublicPolicy`).',
        goal: 'Crear el bucket y comprobar su Block Public Access',
        setup: A('base'),
        check: awsIs('s3api get-public-access-block --bucket datos-clientes-2026 --query PublicAccessBlockConfiguration.BlockPublicPolicy', true, 'Falta crear el bucket'),
        solution: ['aws s3 mb s3://datos-clientes-2026', 'aws s3api get-public-access-block --bucket datos-clientes-2026'],
        hints: ['Crear: `aws s3 mb s3://nombre`.', 'Comprobar: `aws s3api get-public-access-block --bucket nombre`.'],
        explain: 'Los buckets nuevos nacen con **Block Public Access** activado. Es una red de seguridad: aunque alguien escriba una política pública por error, no tendrá efecto mientras esté activo.',
        par: 2,
        commands: ['Responsabilidad compartida', 'aws s3api get-public-access-block'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a1-4', { title: 'Tu cuenta: CLI, perfiles y facturación', summary: 'Consola, CLI, SDK, región por defecto y avisos de gasto', emoji: '🧰', commands: ['AWS CLI', 'aws configure', 'Capa gratuita', 'AWS Budgets', 'Alarma de facturación'], minutes: 12 }, [
      learn(
        'Tres formas de hablar con AWS',
        `
Todo lo que haces en AWS acaba siendo una **llamada a su API** (una petición HTTPS firmada). Hay tres maneras cómodas de hacerla:

- **Consola web**: haces clic. Ideal para explorar y aprender; difícil de repetir.
- **CLI** (\`aws …\`): escribes comandos. Perfecta para scripts, automatizar y dejar constancia de qué hiciste.
- **SDK** (_Software Development Kit_): llamas a AWS desde tu código (Python con **boto3**, JavaScript, Java…).

Más adelante añadirás una cuarta: **infraestructura como código** (CloudFormation, CDK). Todas acaban llamando a la misma API.
`,
        '🧰',
      ),
      mc('Quieres repetir cada noche una tarea en AWS sin hacer clic. ¿Qué te sirve mejor?', ['La consola web', 'La CLI o un SDK dentro de un script', 'Llamar por teléfono a AWS', 'Nada: no se puede automatizar'], 1, 'La CLI y los SDK permiten escribir la tarea una vez y repetirla (programada o en un script).'),
      learn(
        'Configurar la CLI: credenciales, región y formato',
        `
Antes de usar la CLI hay que decirle **quién eres** y **dónde** trabajas. Eso hace \`aws configure\`: pregunta cuatro cosas y las guarda en dos archivos de texto en \`~/.aws/\`:

| Pregunta | Dónde se guarda |
| --- | --- |
| Access Key ID | \`~/.aws/credentials\` |
| Secret Access Key | \`~/.aws/credentials\` |
| Región por defecto (\`eu-west-1\`) | \`~/.aws/config\` |
| Formato de salida (\`json\`, \`text\`, \`table\`) | \`~/.aws/config\` |

> OJO: El archivo \`credentials\` contiene tu **clave secreta**. Es como una contraseña: no la subas a GitHub, no la pegues en chats y protege el archivo (permisos \`600\`).

Puedes tener varios **perfiles** (\`[default]\`, \`[trabajo]\`, \`[ana]\`) y elegir uno con \`--profile\`.
`,
        '🔑',
      ),
      demo(
        'Mira tu configuración',
        [
          ['cat ~/.aws/config', 'La región y el formato por defecto'],
          ['aws configure list', 'Qué credenciales, región y perfil se están usando y de dónde salen'],
          ['aws configure get region', 'Lee un valor concreto'],
        ],
        A('base'),
      ),
      practice({
        prompt: 'Tu empresa trabaja en Europa. Cambia la **región por defecto** de la CLI a **`eu-west-1`** (Irlanda).',
        goal: 'Región por defecto = eu-west-1',
        setup: A('base'),
        check: content('/home/alumno/.aws/config', { includes: 'region = eu-west-1' }),
        solution: ['aws configure set region eu-west-1'],
        hints: ['`aws configure set <nombre> <valor>` guarda un valor sin hacerte preguntas.', 'El nombre del ajuste es `region`.'],
        explain: '`aws configure set region eu-west-1` edita `~/.aws/config`. Desde ahora, los comandos regionales (EC2, SNS…) irán a Irlanda salvo que añadas `--region`.',
        par: 1,
        commands: ['AWS CLI', 'aws configure'],
      }),
      learn(
        'La factura: capa gratuita y avisos',
        `
AWS cobra **por uso**: horas de servidor, gigas almacenados, datos transferidos hacia fuera… Es barato si controlas lo que enciendes y caro si olvidas algo. Dos ideas para dormir tranquilo:

1. **Capa gratuita (Free Tier)**: AWS regala cierto uso mensual de muchos servicios a las cuentas nuevas. Las condiciones han cambiado varias veces (límites de tiempo, créditos, planes gratuitos), así que **léelas siempre en aws.amazon.com/free** antes de fiarte de lo que oíste.
2. **Avisos de gasto desde el día 1**. Hay dos herramientas:
   - **AWS Budgets**: defines un presupuesto (por ejemplo 10 USD/mes) y te avisa por correo o SNS cuando lo **real** o lo **previsto** se acerca al límite.
   - **Alarma de facturación de CloudWatch** sobre la métrica \`EstimatedCharges\`. Las métricas de facturación solo existen en **us-east-1**, así que la alarma se crea allí.

> CLAVE: Ninguna de las dos **frena** el gasto: solo **avisa**. Si algo está encendido, sigue cobrando hasta que lo apagues.
`,
        '💸',
      ),
      mc('¿Qué hace un presupuesto de AWS Budgets cuando se supera el límite?', ['Apaga automáticamente todos los servidores', 'Envía un aviso (por ejemplo, un correo)', 'Cierra la cuenta', 'Reduce el precio'], 1, 'Budgets avisa; no apaga nada por sí solo. (Se pueden configurar acciones automáticas, pero hay que pedirlas expresamente.)'),
      tf('«La métrica EstimatedCharges de facturación solo está disponible en la región us-east-1.»', true, 'Los datos de facturación se publican en us-east-1. Por eso la alarma de CloudWatch de facturación se crea en esa región.'),
      demo(
        'Un presupuesto en dos líneas',
        [
          ['aws budgets create-budget --account-id 123456789012 --budget "BudgetName=demo,BudgetLimit={Amount=25,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST"', 'La sintaxis abreviada (_shorthand_) de la CLI: `Clave=valor` separados por comas, con `{}` para anidar'],
          ['aws budgets describe-budgets --account-id 123456789012 --query "Budgets[].[BudgetName,BudgetLimit.Amount]" --output text', 'Comprobamos lo que quedó creado'],
        ],
        A('base'),
      ),
      practice({
        prompt: 'Crea un **presupuesto mensual de 10 USD** llamado **`tope-10`** (tipo `COST`) en la cuenta `123456789012`.',
        goal: 'Presupuesto tope-10: 10 USD al mes',
        setup: A('base'),
        check: awsIs('budgets describe-budgets --account-id 123456789012 --query "Budgets[].[BudgetName,BudgetLimit.Amount,TimeUnit]"', [['tope-10', '10', 'MONTHLY']], 'Falta crear el presupuesto con ese nombre, importe y periodo'),
        solution: ['aws budgets create-budget --account-id 123456789012 --budget "BudgetName=tope-10,BudgetLimit={Amount=10,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST"'],
        hints: ['`aws budgets create-budget --account-id <cuenta> --budget ...`', 'Los campos son `BudgetName`, `BudgetLimit={Amount=…,Unit=USD}`, `TimeUnit=MONTHLY` y `BudgetType=COST`.'],
        explain: 'Un presupuesto tiene un nombre, un límite (`Amount` y `Unit`), un periodo (`TimeUnit`) y un tipo (`COST`, `USAGE`…). Para recibir avisos se le añaden notificaciones con suscriptores.',
        par: 1,
        commands: ['AWS Budgets'],
      }),
      practice({
        prompt:
          'Crea ahora la **alarma de facturación** clásica en la región **us-east-1**: nombre `factura-alta`, espacio de nombres `AWS/Billing`, métrica `EstimatedCharges`, estadístico `Maximum`, periodo `21600` (6 h), 1 periodo de evaluación, umbral `10`, operador `GreaterThanThreshold` y dimensión `Currency=USD`.',
        goal: 'Alarma factura-alta en us-east-1',
        setup: A('base'),
        check: awsHas('cloudwatch describe-alarms --region us-east-1 --query "MetricAlarms[].AlarmName"', 'factura-alta', 'La alarma debe llamarse factura-alta y estar en us-east-1'),
        solution: ['aws cloudwatch put-metric-alarm --region us-east-1 --alarm-name factura-alta --namespace AWS/Billing --metric-name EstimatedCharges --statistic Maximum --period 21600 --evaluation-periods 1 --threshold 10 --comparison-operator GreaterThanThreshold --dimensions Name=Currency,Value=USD'],
        hints: ['El comando es `aws cloudwatch put-metric-alarm`.', 'No olvides `--region us-east-1`.', 'La dimensión se escribe `--dimensions Name=Currency,Value=USD`.'],
        explain: 'La alarma vigila `EstimatedCharges` cada 6 horas y pasa a ALARM si el gasto estimado supera 10 USD. Después se le añaden acciones (por ejemplo, publicar en un tema de SNS que te envía un correo).',
        par: 1,
        commands: ['Alarma de facturación'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a1-5', { title: 'Elegir una región', summary: 'Cumplimiento, latencia, servicios y precio', emoji: '📍', commands: ['Elegir una región', 'aws s3 mb'], minutes: 9 }, [
      learn(
        'Cuatro factores para elegir',
        `
Al crear casi cualquier recurso tienes que decidir **en qué región**. Estos son los criterios, por orden de importancia:

1. **Cumplimiento y residencia de datos**: algunas leyes o contratos obligan a que ciertos datos no salgan de un país o de la UE (el RGPD, por ejemplo, regula las transferencias fuera del Espacio Económico Europeo). Si hay una obligación legal, **manda sobre todo lo demás**.
2. **Latencia**: cuanto más cerca esté la región de tus usuarios, más rápida irá tu aplicación. 100 ms de ida y vuelta se notan.
3. **Servicios disponibles**: AWS no lanza todos los servicios y funciones a la vez en todas las regiones. Comprueba que existe lo que necesitas.
4. **Precio**: varía por región. \`us-east-1\` (Virginia) suele ser de las más baratas; \`sa-east-1\` (São Paulo), de las más caras.

> TIP: Para una web de clientes europeos suele elegirse \`eu-west-1\` (Irlanda), \`eu-central-1\` (Fráncfort), \`eu-west-3\` (París) o \`eu-south-2\` (España). La decisión final depende de las cuatro cosas de arriba.
`,
        '📍',
      ),
      mc(
        'Una empresa alemana debe guardar los datos personales de sus clientes dentro de la Unión Europea. ¿Qué región es una opción válida?',
        ['us-east-1 (Virginia)', 'eu-central-1 (Fráncfort)', 'ap-southeast-1 (Singapur)', 'sa-east-1 (São Paulo)'],
        1,
        'Fráncfort está en la UE. La obligación legal de residencia de datos es el primer criterio, por encima del precio o la latencia.',
      ),
      match(
        'Une cada criterio con la pregunta que responde',
        [
          ['Cumplimiento', '¿La ley me permite guardar los datos ahí?'],
          ['Latencia', '¿Está cerca de mis usuarios?'],
          ['Servicios', '¿Existe en esa región lo que necesito?'],
          ['Precio', '¿Cuánto cuesta lo mismo en otra región?'],
        ],
        'Son los cuatro factores clásicos de elección de región. Si hay obligación legal, el cumplimiento decide primero.',
      ),
      learn(
        'Las regiones son mundos separados',
        `
La mayoría de recursos (servidores EC2, bases de datos RDS, buckets de S3…) **viven en una región** y no se ven desde las demás. Si creas un servidor en Irlanda y luego miras Virginia, no lo encontrarás: no lo has perdido, estás mirando otro mundo.

Algunos servicios son **globales**: IAM (usuarios y permisos), Route 53 (DNS), CloudFront (CDN) y la facturación. Se gestionan una sola vez para toda la cuenta.

En la CLI, la región sale de \`--region\`, de la variable \`AWS_REGION\` o de tu \`~/.aws/config\`, en ese orden.
`,
        '🗺️',
      ),
      demo(
        'El mismo servidor, según dónde mires',
        [
          ['aws ec2 describe-instances --query "length(Reservations)"', 'En la región por defecto (us-east-1) no hay ningún servidor…'],
          ['aws ec2 describe-instances --region eu-west-1 --query "Reservations[].Instances[].Tags[?Key==\'Name\'].Value" --output text', '…pero en eu-west-1 hay uno llamado web-irlanda'],
        ],
        A('regiones'),
      ),
      tf('«IAM, el servicio de usuarios y permisos, es global: se gestiona una vez para toda la cuenta.»', true, 'IAM no pertenece a una región: los usuarios y roles que creas valen en todas.'),
      learn(
        'Los buckets: nombre global, vida regional',
        `
Un bucket de S3 tiene un **nombre único en todo el mundo**, pero **vive en una región**. Al crearlo fuera de \`us-east-1\` hay que indicar la región (con \`aws s3 mb\` se hace con \`--region\`; con \`s3api create-bucket\`, con \`LocationConstraint\`).

Esto importa para el cumplimiento: los datos del bucket **no salen de esa región** a menos que tú los copies.
`,
        '🪣',
      ),
      practice({
        prompt: 'Tu aplicación sirve a clientes europeos. Crea un bucket llamado **`fotos-ue-2026`** en la región **`eu-west-1`**.',
        goal: 'Bucket fotos-ue-2026 en eu-west-1',
        setup: A('base'),
        check: awsIs('s3api get-bucket-location --bucket fotos-ue-2026 --query LocationConstraint', 'eu-west-1', 'El bucket debe existir en eu-west-1'),
        solution: ['aws s3 mb s3://fotos-ue-2026 --region eu-west-1'],
        hints: ['`aws s3 mb s3://nombre` crea un bucket.', 'Añade `--region eu-west-1`.'],
        explain: 'Sin `--region`, el bucket se habría creado en la región por defecto (`us-east-1`). Con `--region eu-west-1`, los datos se quedan en Irlanda.',
        par: 1,
        commands: ['Elegir una región', 'aws s3 mb'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Es tu **primer día** como responsable de la nube en una startup europea. Deja la cuenta lista:\n\n1. Cambia la **región por defecto** a `eu-west-1`.\n2. Crea el bucket **`mi-nube-2026`** (en Irlanda).\n3. Crea un presupuesto mensual de **5 USD** llamado **`tope-5`**.',
    goal: 'Región eu-west-1, bucket mi-nube-2026 y presupuesto tope-5',
    setup: A('base'),
    check: all(
      content('/home/alumno/.aws/config', { includes: 'region = eu-west-1' }),
      awsIs('s3api get-bucket-location --bucket mi-nube-2026 --query LocationConstraint', 'eu-west-1', 'Falta el bucket mi-nube-2026 en eu-west-1'),
      awsIs('budgets describe-budgets --account-id 123456789012 --query "Budgets[].[BudgetName,BudgetLimit.Amount]"', [['tope-5', '5']], 'Falta el presupuesto tope-5 de 5 USD'),
    ),
    solution: [
      'aws configure set region eu-west-1',
      'aws s3 mb s3://mi-nube-2026',
      'aws budgets create-budget --account-id 123456789012 --budget "BudgetName=tope-5,BudgetLimit={Amount=5,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST"',
    ],
    hints: ['Empieza con `aws configure set region eu-west-1`: así los siguientes comandos ya van a Irlanda.', 'Con la región ya configurada, `aws s3 mb s3://mi-nube-2026` crea el bucket en eu-west-1.', 'El presupuesto se crea con `aws budgets create-budget --account-id 123456789012 --budget "…"`.'],
    explain: 'Región por defecto, un primer recurso en la región correcta y un tope de gasto: es el arranque responsable de cualquier cuenta de AWS.',
    commands: ['aws configure', 'aws s3 mb', 'AWS Budgets'],
  },
});
