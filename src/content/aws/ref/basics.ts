import type { AwsRef } from '../reference';

export const AWS_REF_BASICS: AwsRef[] = [
  {
    name: 'Nube',
    kind: 'concepto',
    category: 'fundamentos',
    level: 1,
    summary: 'Recursos de cómputo, almacenamiento y redes que alquilas por internet y pagas por uso, en vez de comprar y mantener servidores.',
    details: `
Las seis ventajas clásicas de la nube (las verás en el examen de Cloud Practitioner):

- **Cambiar inversión por gasto variable**: no compras, alquilas.
- **Economías de escala**: AWS compra en volumen y baja el precio por unidad.
- **Dejar de adivinar la capacidad**: sube y baja según la demanda.
- **Más velocidad y agilidad**: un servidor en minutos, no en semanas.
- **Dejar de gastar en mantener centros de datos**.
- **Despliegue global en minutos**: pones tu aplicación cerca de usuarios de todo el mundo.
`,
    whenUse: ['Cargas que varían mucho (campañas, picos estacionales)', 'Proyectos nuevos donde no sabes cuánta capacidad necesitarás', 'Equipos pequeños que no quieren operar hardware'],
    whenNot: ['Cargas enormes, estables y predecibles donde un centro de datos propio amortizado sale más barato', 'Datos que por ley no pueden salir de unas instalaciones concretas (a veces se resuelve con regiones locales o nubes híbridas)'],
    pricing: 'Pago por uso: horas de cómputo, GB almacenados, peticiones y datos transferidos hacia fuera. Sin cuota inicial en la mayoría de servicios.',
    versus: [
      ['IaaS', 'Te dan el servidor virtual en bruto (EC2). Tú pones SO y programas.'],
      ['PaaS', 'Te dan la plataforma lista (Elastic Beanstalk, Lambda). Tú pones el código.'],
      ['SaaS', 'Te dan el programa terminado (Gmail, Microsoft 365).'],
    ],
    seeAlso: ['Región', 'Responsabilidad compartida'],
  },
  {
    name: 'Región',
    kind: 'concepto',
    category: 'fundamentos',
    level: 1,
    summary: 'Zona geográfica del mundo con varios centros de datos de AWS agrupados en zonas de disponibilidad. Cada región es independiente.',
    details: `
Se nombran así: \`us-east-1\` (norte de Virginia), \`eu-west-1\` (Irlanda), \`eu-central-1\` (Fráncfort), \`sa-east-1\` (São Paulo)…

- Los recursos **regionales** (EC2, RDS, buckets de S3…) existen en una sola región y no se ven desde las demás.
- Los datos **no salen** de la región salvo que tú los copies.
- Algunas regiones (_opt-in_) hay que activarlas en la cuenta antes de usarlas.
`,
    whenUse: ['Elegir dónde viven tus recursos según cumplimiento, latencia, servicios y precio'],
    whenNot: ['No repartas servicios que se hablan mucho entre regiones sin necesidad: la latencia y la transferencia entre regiones tienen coste'],
    pricing: 'Los precios de casi todos los servicios cambian de una región a otra.',
    examples: [['aws ec2 describe-regions --query "Regions[].RegionName" --output text', 'Las regiones que puedes usar']],
    seeAlso: ['Zona de disponibilidad', 'Elegir una región', 'aws ec2 describe-regions'],
  },
  {
    name: 'Zona de disponibilidad',
    kind: 'concepto',
    category: 'fundamentos',
    level: 1,
    summary: 'Uno o varios centros de datos aislados (energía, red y refrigeración propias) dentro de una región. Cada región tiene al menos tres.',
    details: `
Se llaman como la región más una letra: \`eu-west-1a\`, \`eu-west-1b\`, \`eu-west-1c\`. La letra se asigna **por cuenta** para repartir la carga, así que \`eu-west-1a\` de tu cuenta puede ser otra zona física que la de otra cuenta; el **ID de zona** (\`euw1-az1\`) es el que identifica la zona real.

Están separadas decenas de kilómetros (para que un incendio o una inundación no las alcance a la vez) y conectadas con redes de muy baja latencia.
`,
    whenUse: ['Repartir tus servidores entre 2 o más zonas para sobrevivir a la caída de un centro de datos (alta disponibilidad)'],
    whenNot: ['No pongas todo en una sola zona si el servicio es importante: es un único punto de fallo'],
    pricing: 'Mover datos entre zonas de la misma región tiene un coste por GB (pequeño, pero existe).',
    scenario: 'base',
    examples: [['aws ec2 describe-availability-zones --region eu-west-1 --query "AvailabilityZones[].[ZoneName,ZoneId]" --output text', 'Nombre y ID de cada zona de Irlanda']],
    seeAlso: ['Región'],
  },
  {
    name: 'Edge location',
    kind: 'concepto',
    category: 'fundamentos',
    level: 1,
    summary: 'Punto de presencia cercano al usuario que guarda copias de contenido (CloudFront) y resuelve DNS (Route 53). No alojas tus servidores ahí.',
    whenUse: ['Servir imágenes, vídeo o webs estáticas con baja latencia a usuarios de todo el mundo (con CloudFront)'],
    whenNot: ['No sirven para ejecutar tu aplicación: para eso usa una región'],
    pricing: 'Se cobra la transferencia de datos y las peticiones de CloudFront; la transferencia desde S3 hacia CloudFront es gratuita.',
    seeAlso: ['Región', 'Zona de disponibilidad'],
  },
  {
    name: 'Elegir una región',
    kind: 'buena práctica',
    category: 'fundamentos',
    level: 1,
    summary: 'Cumplimiento, latencia, servicios disponibles y precio: los cuatro criterios para decidir en qué región crear tus recursos.',
    details: `
1. **Cumplimiento y residencia de datos** (manda sobre todo lo demás si hay obligación legal).
2. **Latencia** hacia tus usuarios.
3. **Servicios y funciones** disponibles en esa región.
4. **Precio**.

Pregunta de examen típica: _«los datos de clientes alemanes no pueden salir de la UE»_ → una región de la UE.
`,
    whenUse: ['Antes de crear tu primer recurso y al diseñar la recuperación ante desastres'],
    whenNot: ['No elijas solo por precio si hay obligaciones legales'],
    seeAlso: ['Región', 'aws s3 mb'],
  },
  {
    name: 'Responsabilidad compartida',
    kind: 'concepto',
    category: 'fundamentos',
    level: 1,
    summary: 'AWS protege la nube (hardware, instalaciones, red, virtualización). El cliente protege lo que pone en ella (datos, accesos, configuración, SO invitado).',
    details: `
| Tarea | Quién |
| --- | --- |
| Seguridad física de los centros de datos | AWS |
| Hardware y red global | AWS |
| Sistema operativo de una EC2, parches y antivirus | Cliente |
| Permisos de IAM y de buckets | Cliente |
| Cifrado de datos, firewalls (security groups) | Cliente |
| Parches del motor de base de datos en RDS | AWS |

Cuanto más gestionado es el servicio (Lambda > RDS > EC2), menos tareas tuyas.
`,
    whenUse: ['Para decidir quién debe arreglar un fallo de seguridad o una auditoría'],
    whenNot: ['No te escudes en «AWS es seguro»: la mayoría de incidentes reales vienen de configuración del cliente'],
    seeAlso: ['aws s3api get-public-access-block', 'Nube'],
  },
  {
    name: 'AWS CLI',
    kind: 'servicio',
    category: 'cli',
    level: 1,
    summary: 'La línea de comandos de AWS: `aws <servicio> <operación> [--opciones]`. Útil para automatizar y repetir tareas.',
    details: `
Opciones globales que usarás siempre:

| Opción | Para qué |
| --- | --- |
| \`--region\` | Región a la que va la petición |
| \`--profile\` | Perfil de \`~/.aws\` que se usa |
| \`--output\` | \`json\`, \`text\`, \`table\` o \`yaml\` |
| \`--query\` | Filtro [JMESPath](https://jmespath.org) para quedarte con una parte de la respuesta |
| \`help\` | \`aws help\`, \`aws s3 help\`, \`aws s3 cp help\` |
`,
    whenUse: ['Automatizar tareas repetibles, scripts, integración continua'],
    whenNot: ['Para infraestructura permanente y versionada es mejor infraestructura como código (CloudFormation, CDK, Terraform)'],
    pricing: 'La CLI es gratuita; pagas los recursos que creas con ella.',
    examples: [
      ['aws sts get-caller-identity --output table', 'La misma respuesta en formato tabla'],
      ['aws iam list-users --query "Users[].UserName" --output text', 'Solo los nombres de usuario'],
      ['aws iem list-users', 'Un error de escritura: la CLI te sugiere el comando correcto', 'error'],
    ],
    seeAlso: ['aws configure', 'aws sts get-caller-identity'],
  },
  {
    name: 'aws configure',
    kind: 'comando',
    category: 'cli',
    level: 1,
    summary: 'Guarda tus credenciales, la región y el formato de salida por defecto en `~/.aws/credentials` y `~/.aws/config`.',
    usage: 'aws configure [--profile nombre]\naws configure set <ajuste> <valor>\naws configure get <ajuste>\naws configure list\naws configure list-profiles',
    details: `
Orden en que la CLI busca las credenciales (la primera que encuentra gana):

1. Opciones de línea de comandos (\`--profile\`).
2. Variables de entorno (\`AWS_ACCESS_KEY_ID\`, \`AWS_SECRET_ACCESS_KEY\`, \`AWS_SESSION_TOKEN\`).
3. Perfil indicado por \`AWS_PROFILE\` o el perfil \`default\` de los archivos de \`~/.aws\`.
4. En un servidor EC2: el rol asignado a la instancia.

> OJO: Nunca pongas claves de acceso en el código ni las subas a un repositorio. Mejor roles y credenciales temporales.
`,
    whenUse: ['La primera vez que usas la CLI', 'Para añadir un perfil nuevo (`aws configure --profile trabajo`)'],
    whenNot: ['En servidores EC2: usa un rol de instancia en lugar de guardar claves'],
    examples: [
      ['aws configure list', 'De dónde salen credenciales y región'],
      ['aws configure get region'],
      ['aws configure set region eu-west-1', 'Cambia la región por defecto sin preguntas'],
    ],
    seeAlso: ['AWS CLI'],
  },
  {
    name: 'aws sts get-caller-identity',
    kind: 'comando',
    category: 'cli',
    level: 1,
    summary: 'Muestra quién eres para AWS: cuenta, ID de usuario y ARN. No necesita permisos y es lo primero que ejecutar cuando algo «no funciona».',
    usage: 'aws sts get-caller-identity [--query Account --output text]',
    whenUse: ['Para comprobar con qué identidad (usuario, rol o root) estás llamando', 'Para sacar el número de cuenta en scripts'],
    scenario: 'equipo',
    examples: [
      ['aws sts get-caller-identity'],
      ['aws sts get-caller-identity --profile ana --query Arn --output text', 'Con otro perfil, otra identidad'],
    ],
    seeAlso: ['AWS CLI'],
  },
  {
    name: 'aws ec2 describe-regions',
    kind: 'comando',
    category: 'cli',
    level: 1,
    summary: 'Lista las regiones disponibles para tu cuenta. Con `--all-regions` incluye las que no has activado.',
    usage: 'aws ec2 describe-regions [--all-regions] [--query "Regions[].RegionName"]',
    examples: [
      ['aws ec2 describe-regions --query "Regions[].RegionName" --output text'],
      ['aws ec2 describe-regions --all-regions --query "Regions[?OptInStatus==\'not-opted-in\'].RegionName" --output text', 'Las regiones que habría que activar antes de usarlas'],
    ],
    seeAlso: ['Región'],
  },
  {
    name: 'Capa gratuita',
    kind: 'concepto',
    category: 'costes',
    level: 1,
    summary: 'Uso gratuito de muchos servicios para probar AWS. Las condiciones han cambiado con el tiempo: consúltalas siempre en la página oficial.',
    details: `
Históricamente había tres tipos: ofertas **siempre gratuitas** (con un límite mensual), **12 meses gratis** desde el alta y **pruebas** de duración corta. Las cuentas nuevas pueden recibir también **créditos** o un plan gratuito con límite de tiempo.

> OJO: Pasarte de los límites o dejar recursos encendidos empieza a cobrar. Consulta aws.amazon.com/free y pon un presupuesto el primer día.
`,
    whenUse: ['Aprender y hacer pruebas pequeñas'],
    whenNot: ['No des por hecho que algo es gratis: compruébalo en la página de precios y en Cost Explorer'],
    seeAlso: ['AWS Budgets', 'Alarma de facturación'],
  },
  {
    name: 'AWS Budgets',
    kind: 'servicio',
    category: 'costes',
    level: 1,
    summary: 'Define un presupuesto (coste, uso o savings plans) y recibe avisos cuando el gasto real o previsto se acerque al límite.',
    whenUse: ['El primer día de cualquier cuenta', 'Para avisar a cada equipo cuando se acerca a su tope'],
    whenNot: ['Para frenar el gasto: Budgets avisa; solo actúa automáticamente si configuras acciones'],
    pricing: 'Los primeros presupuestos son gratuitos; los adicionales o con acciones tienen un coste pequeño por día. Consulta la página de precios.',
    usage: 'aws budgets create-budget --account-id <cuenta> --budget "BudgetName=...,BudgetLimit={Amount=10,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST"',
    examples: [
      ['aws budgets create-budget --account-id 123456789012 --budget "BudgetName=demo,BudgetLimit={Amount=10,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST"'],
      ['aws budgets describe-budgets --account-id 123456789012 --query "Budgets[].[BudgetName,BudgetLimit.Amount]" --output text'],
    ],
    seeAlso: ['Alarma de facturación', 'Capa gratuita'],
  },
  {
    name: 'Alarma de facturación',
    kind: 'buena práctica',
    category: 'costes',
    level: 1,
    summary: 'Alarma de CloudWatch sobre la métrica `EstimatedCharges` (solo en us-east-1) que avisa cuando el gasto estimado supera un umbral.',
    usage: 'aws cloudwatch put-metric-alarm --region us-east-1 --namespace AWS/Billing --metric-name EstimatedCharges ...',
    whenUse: ['Como segundo aviso, además de AWS Budgets'],
    whenNot: ['No esperes que corte el servicio: solo notifica, normalmente a un tema de SNS'],
    seeAlso: ['AWS Budgets'],
  },
];
