import type { AwsRef } from '../reference';

const AMI_CMD = 'AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)';

export const AWS_REF_EC2: AwsRef[] = [
  {
    name: 'EC2',
    kind: 'servicio',
    category: 'computo',
    level: 1,
    summary: 'Servidores virtuales (instancias) que lanzas en minutos, en el tamaño que elijas, y pagas por el tiempo que están encendidos.',
    details: `
Es **IaaS**: tú gestionas el sistema operativo, los parches, las aplicaciones y la seguridad de red (security groups).

Lo que necesitas para lanzar una instancia: AMI, tipo, par de claves, red/security group y disco. Se usa para todo: webs, APIs, bases de datos propias, procesos por lotes…
`,
    whenUse: ['Necesitas control total del sistema operativo o software que no encaja en otros servicios', 'Migrar aplicaciones existentes (_lift and shift_)', 'Cargas con requisitos especiales de CPU, memoria, GPU o disco'],
    whenNot: ['Código que se ejecuta en respuesta a eventos y puntualmente → Lambda', 'Una base de datos relacional estándar → RDS/Aurora (parches y copias gestionados)', 'Aplicaciones en contenedores → ECS/EKS/Fargate', 'Webs estáticas → S3 + CloudFront'],
    pricing: 'Por segundo (Linux, mínimo 60 s) o por hora según el sistema, mientras la instancia está `running`. Modelos: On-Demand, Savings Plans, Spot, reservadas. Aparte: discos EBS, IP públicas y transferencia de datos hacia fuera.',
    limits: ['Cuotas de vCPU por familia y región (una cuenta nueva suele empezar con pocas decenas)'],
    versus: [
      ['EC2 frente a Lambda', 'EC2: procesos continuos y control total. Lambda: funciones cortas por evento, sin servidores que gestionar.'],
      ['EC2 frente a RDS', 'Instalar MySQL en EC2 lo hace tuyo (parches, copias, alta disponibilidad). RDS lo gestiona AWS.'],
    ],
    scenario: 'ec2demo',
    examples: [['aws ec2 describe-instances --query "Reservations[].Instances[].[Tags[?Key==\'Name\'].Value|[0],InstanceType,State.Name]" --output table', 'Las instancias de la cuenta de práctica']],
    seeAlso: ['AMI', 'Tipo de instancia', 'Security group', 'EBS', 'Modelos de compra'],
  },
  {
    name: 'AMI',
    kind: 'concepto',
    category: 'computo',
    level: 1,
    summary: 'Amazon Machine Image: la plantilla (sistema operativo, software y configuración) a partir de la que se crea una instancia.',
    details: `
- Las hay de AWS (Amazon Linux), de terceros (Ubuntu, Windows, Red Hat…) y del **AWS Marketplace**. También puedes crear las tuyas desde una instancia.
- **Son regionales**: el mismo sistema tiene un ID distinto en cada región. Para copiarlas entre regiones se usa \`copy-image\`.
- Han de coincidir con la arquitectura del tipo de instancia (x86_64 o arm64).
- Para obtener la última Amazon Linux de tu región: parámetro público de SSM \`/aws/service/ami-amazon-linux-latest/…\`.
`,
    whenUse: ['Siempre al lanzar una instancia', 'Crear una AMI propia para lanzar muchas instancias idénticas rápido'],
    whenNot: ['No metas secretos (claves, contraseñas) dentro de una AMI que vayas a compartir'],
    examples: [[AMI_CMD, 'Guarda el ID vigente de Amazon Linux 2023'], ['aws ec2 describe-images --owners amazon --filters "Name=name,Values=al2023-ami-2023*-x86_64" --query "Images[].[ImageId,Name]" --output text']],
    seeAlso: ['EC2', 'aws ec2 run-instances'],
  },
  {
    name: 'Par de claves',
    kind: 'concepto',
    category: 'computo',
    level: 1,
    summary: 'Clave pública (la guarda la instancia) y clave privada (te la quedas tú, solo se descarga al crearla) para entrar por SSH.',
    details: `
\`\`\`
aws ec2 create-key-pair --key-name mi-clave --query KeyMaterial --output text > mi-clave.pem
chmod 400 mi-clave.pem
ssh -i mi-clave.pem ec2-user@<ip-publica>
\`\`\`

El usuario por defecto depende de la AMI: \`ec2-user\` (Amazon Linux), \`ubuntu\` (Ubuntu), \`Administrator\` (Windows, con clave para obtener la contraseña).
`,
    whenUse: ['Acceso SSH tradicional'],
    whenNot: ['Prefiere **Session Manager** (SSM): entras sin abrir el puerto 22 ni gestionar claves'],
    examples: [['aws ec2 create-key-pair --key-name ejemplo --query KeyFingerprint --output text'], ['aws ec2 describe-key-pairs --query "KeyPairs[].KeyName" --output text']],
    seeAlso: ['EC2', 'Security group'],
  },
  {
    name: 'aws ec2 run-instances',
    kind: 'comando',
    category: 'computo',
    level: 1,
    summary: 'Lanza una o más instancias EC2. Obligatorios: `--image-id` y `--instance-type` (o plantilla de lanzamiento).',
    usage: 'aws ec2 run-instances --image-id <ami> --instance-type t3.micro \\\n  [--key-name <clave>] [--security-group-ids <sg>] [--subnet-id <subnet>] \\\n  [--user-data file://script.sh] [--count 1] \\\n  [--tag-specifications \'ResourceType=instance,Tags=[{Key=Name,Value=web}]\'] [--dry-run]',
    details: '`--dry-run` comprueba permisos y parámetros sin crear nada: responde `DryRunOperation` si todo estaría bien.',
    examples: [
      [AMI_CMD],
      ['aws ec2 run-instances --image-id $AMI --instance-type t3.micro --dry-run', 'Prueba sin crear: el «error» DryRunOperation significa que habría funcionado', 'error'],
    ],
    seeAlso: ['EC2', 'AMI', 'aws ec2 describe-instances'],
  },
  {
    name: 'aws ec2 describe-instances',
    kind: 'comando',
    category: 'computo',
    level: 1,
    summary: 'Lista las instancias de la región, agrupadas en reservaciones. Se filtra con `--filters` y se recorta con `--query`.',
    usage: 'aws ec2 describe-instances [--instance-ids …] [--filters Name=instance-state-name,Values=running] [--query …]',
    details: 'Filtros muy usados: `instance-state-name`, `tag:Nombre`, `instance-type`, `availability-zone`, `vpc-id`.',
    scenario: 'ec2demo',
    examples: [
      ['aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId" --output text'],
      ['aws ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[].Instances[].[PublicIpAddress,PrivateIpAddress]" --output text'],
    ],
    seeAlso: ['EC2'],
  },
  {
    name: 'Tipo de instancia',
    kind: 'concepto',
    category: 'computo',
    level: 1,
    summary: 'Combinación de CPU, memoria, red y almacenamiento. Se nombra familia + generación + tamaño: `m5.large`.',
    versus: [
      ['T (t3, t4g)', 'CPU en ráfagas con créditos: webs pequeñas, pruebas.'],
      ['M', 'Equilibrio CPU/memoria: uso general.'],
      ['C', 'Más CPU: cómputo intensivo.'],
      ['R / X', 'Más memoria: cachés y bases de datos en memoria.'],
      ['I / D', 'Discos locales rápidos.'],
      ['P / G', 'GPU: machine learning y gráficos.'],
    ],
    details: 'Sufijo **g** = procesador Graviton (ARM) · **a** = AMD · **d** = discos NVMe locales. Cambiar el tipo de una instancia EBS exige pararla primero.',
    whenUse: ['Empieza pequeño y mide; ajusta el tamaño con datos de CloudWatch'],
    whenNot: ['Evita sobredimensionar «por si acaso»: pagas por lo que reservas, no por lo que usas'],
    seeAlso: ['aws ec2 describe-instance-types', 'EC2', 'Modelos de compra'],
  },
  {
    name: 'aws ec2 describe-instance-types',
    kind: 'comando',
    category: 'computo',
    level: 1,
    summary: 'Detalles de los tipos de instancia: vCPU, memoria, arquitectura, red, GPU, almacenamiento local y elegibilidad para la capa gratuita.',
    usage: 'aws ec2 describe-instance-types [--instance-types t3.micro m5.large] [--filters Name=…,Values=…]',
    examples: [
      ['aws ec2 describe-instance-types --instance-types t3.micro m5.large --query "InstanceTypes[].[InstanceType,VCpuInfo.DefaultVCpus,MemoryInfo.SizeInMiB]" --output table'],
      ['aws ec2 describe-instance-types --filters Name=processor-info.supported-architecture,Values=arm64 --query "InstanceTypes[].InstanceType" --output text', 'Los tipos Graviton (ARM)'],
    ],
    seeAlso: ['Tipo de instancia'],
  },
  {
    name: 'EBS',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 1,
    summary: 'Discos de bloque de red y persistentes para EC2. Viven en una zona de disponibilidad y sobreviven a la instancia.',
    versus: [
      ['gp3', 'SSD de propósito general (por defecto).'],
      ['io2', 'SSD con IOPS provisionadas para bases de datos críticas.'],
      ['st1', 'HDD para lecturas secuenciales grandes.'],
      ['sc1', 'HDD frío, el más barato.'],
      ['EBS frente a S3', 'EBS es un disco que montas en una instancia; S3 son objetos accesibles por HTTP desde cualquier sitio.'],
      ['EBS frente a EFS', 'EBS: un disco para una instancia (misma AZ). EFS: sistema de archivos compartido por muchas.'],
    ],
    whenUse: ['Disco raíz y de datos de instancias', 'Bases de datos en EC2'],
    whenNot: ['Archivos que muchas instancias deben compartir a la vez → EFS', 'Datos que se sirven por HTTP o se guardan para siempre → S3'],
    pricing: 'Por GB-mes aprovisionado (aunque no lo uses) y, según el tipo, por IOPS y rendimiento extra. Los snapshots se cobran por GB almacenado.',
    limits: ['Un volumen se conecta a instancias de su misma zona de disponibilidad', 'Se puede ampliar en caliente; no reducir'],
    seeAlso: ['Instance store', 'Snapshot de EBS', 'aws ec2 create-volume'],
  },
  {
    name: 'Instance store',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Disco físico local del servidor: rapidísimo pero efímero (se pierde al parar o terminar la instancia o si falla el hardware).',
    whenUse: ['Cachés, búferes, datos temporales o réplicas que se pueden reconstruir'],
    whenNot: ['Cualquier dato que no puedas perder'],
    pricing: 'Está incluido en el precio de la instancia (solo existe en ciertos tipos, como i3, d3, m5d).',
    seeAlso: ['EBS'],
  },
  {
    name: 'Snapshot de EBS',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Copia incremental de un volumen EBS guardada por AWS. Sirve para restaurar, copiar entre regiones y crear AMI.',
    whenUse: ['Copias de seguridad de volúmenes', 'Mover datos a otra zona o región'],
    whenNot: ['No sustituyen a un plan de backup completo: usa AWS Backup para políticas, retención y copias entre cuentas'],
    pricing: 'Por GB-mes de datos almacenados (solo los bloques cambiados desde el snapshot anterior).',
    seeAlso: ['EBS', 'aws ec2 create-snapshot'],
  },
  {
    name: 'aws ec2 create-volume',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Crea un volumen EBS en una zona de disponibilidad (vacío o a partir de un snapshot).',
    usage: 'aws ec2 create-volume --availability-zone <az> --size <GiB> [--volume-type gp3] [--snapshot-id <snap>]',
    scenario: 'ec2demo',
    examples: [
      ['aws ec2 create-volume --availability-zone us-east-1a --size 10 --volume-type gp3 --query VolumeId --output text'],
      ['aws ec2 create-volume --availability-zone us-east-1a --size 10 --volume-type io1', 'io1 y io2 exigen indicar IOPS', 'error'],
    ],
    seeAlso: ['EBS', 'aws ec2 attach-volume'],
  },
  {
    name: 'aws ec2 attach-volume',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Conecta un volumen a una instancia de su misma zona. Después hay que formatearlo y montarlo dentro del sistema operativo.',
    usage: 'aws ec2 attach-volume --volume-id <vol> --instance-id <i> --device /dev/sdf',
    seeAlso: ['aws ec2 create-volume', 'EBS'],
  },
  {
    name: 'aws ec2 create-snapshot',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Crea un snapshot de un volumen EBS.',
    usage: 'aws ec2 create-snapshot --volume-id <vol> [--description "texto"]',
    scenario: 'ec2demo',
    examples: [['aws ec2 create-snapshot --volume-id $(aws ec2 describe-volumes --query "Volumes[0].VolumeId" --output text) --description ejemplo --query SnapshotId --output text']],
    seeAlso: ['Snapshot de EBS'],
  },
  {
    name: 'Security group',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Firewall virtual de la instancia: solo reglas Allow, con estado, entrada cerrada por defecto y salida abierta.',
    details: `
Puertos habituales: 22 SSH · 80 HTTP · 443 HTTPS · 3389 RDP · 3306 MySQL · 5432 PostgreSQL.

Como origen puedes usar un CIDR o **otro security group** (muy útil: «el SG de la base de datos acepta tráfico del SG de la aplicación»). Los cambios se aplican al instante.
`,
    whenUse: ['Siempre: cada instancia tiene al menos uno'],
    whenNot: ['Para bloquear una IP concreta usa una NACL (los security groups no tienen Deny)', 'No abras 22 ni 3389 a 0.0.0.0/0'],
    versus: [['Security group frente a NACL', 'SG: a nivel de instancia, con estado, solo Allow. NACL: a nivel de subred, sin estado, con Allow y Deny.']],
    scenario: 'ec2web',
    examples: [['aws ec2 describe-security-groups --filters Name=group-name,Values=web-cerrado --query "SecurityGroups[].IpPermissions"', 'Sin reglas de entrada: por eso nadie puede llegar']],
    seeAlso: ['aws ec2 create-security-group', 'aws ec2 authorize-security-group-ingress'],
  },
  {
    name: 'aws ec2 create-security-group',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea un security group (sin reglas de entrada) en la VPC por defecto o en la indicada.',
    usage: 'aws ec2 create-security-group --group-name <n> --description "…" [--vpc-id <vpc>]',
    examples: [['aws ec2 create-security-group --group-name ejemplo --description "Prueba" --query GroupId --output text'], ['aws ec2 create-security-group --group-name sg-malo --description x', 'El nombre no puede empezar por sg-', 'error']],
    seeAlso: ['Security group'],
  },
  {
    name: 'aws ec2 authorize-security-group-ingress',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Añade una regla de entrada a un security group. `revoke-security-group-ingress` la quita.',
    usage: 'aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 443 --cidr 0.0.0.0/0',
    scenario: 'ec2web',
    examples: [['aws ec2 authorize-security-group-ingress --group-id $(aws ec2 describe-security-groups --filters Name=group-name,Values=web-cerrado --query "SecurityGroups[0].GroupId" --output text) --protocol tcp --port 80 --cidr 0.0.0.0/0 --query "SecurityGroupRules[0].CidrIpv4" --output text']],
    seeAlso: ['Security group'],
  },
  {
    name: 'IP elástica',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Dirección IPv4 pública fija que reservas en tu cuenta y asocias a una instancia. Sobrevive a parar y arrancar.',
    whenUse: ['Cuando algo externo necesita una IP que no cambie (lista de IP permitidas, DNS sencillo)'],
    whenNot: ['Para servicios de producción suele ser mejor un balanceador de carga o un nombre DNS', 'No las acumules: AWS cobra por las direcciones IPv4 públicas'],
    pricing: 'AWS cobra por cada dirección IPv4 pública (también las elásticas) por hora, en uso o no. Consulta los precios vigentes.',
    seeAlso: ['aws ec2 allocate-address'],
  },
  {
    name: 'aws ec2 allocate-address',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Reserva una IP elástica. Con `associate-address` la asocias a una instancia y con `release-address` la devuelves.',
    usage: 'aws ec2 allocate-address\naws ec2 associate-address --allocation-id <eipalloc> --instance-id <i>\naws ec2 release-address --allocation-id <eipalloc>',
    examples: [['aws ec2 allocate-address --query PublicIp --output text']],
    seeAlso: ['IP elástica'],
  },
  {
    name: 'User data',
    kind: 'concepto',
    category: 'computo',
    level: 1,
    summary: 'Script que la instancia ejecuta una vez, como root, en su primer arranque. Hasta 16 KB.',
    details: `
\`\`\`
#!/bin/bash
dnf install -y httpd
systemctl enable --now httpd
\`\`\`

Se pasa con \`--user-data file://script.sh\`. Los registros se guardan en \`/var/log/cloud-init-output.log\`. No pongas secretos dentro: cualquiera con acceso a la instancia puede leerlo (usa Secrets Manager o Parameter Store).
`,
    whenUse: ['Instalar y arrancar software al crear la instancia, sin entrar por SSH'],
    whenNot: ['Para configuración compleja y repetible, mejor una AMI propia, Systems Manager o gestión de configuración'],
    seeAlso: ['aws ec2 run-instances', 'AMI'],
  },
  {
    name: 'Modelos de compra',
    kind: 'comparativa',
    category: 'costes',
    level: 1,
    summary: 'On-Demand, Savings Plans, instancias reservadas, Spot y Dedicated: la misma capacidad a distinto precio según compromiso y riesgo.',
    versus: [
      ['On-Demand', 'Sin compromiso, precio de lista.'],
      ['Savings Plans', 'Compromiso de gasto por hora a 1 o 3 años; descuento alto y flexible entre tipos.'],
      ['Reservadas', 'Compromiso con un tipo concreto; algo menos flexibles.'],
      ['Spot', 'Capacidad sobrante hasta ~90 % más barata, pero interrumpible.'],
      ['Dedicated', 'Hardware físico para ti: licencias y cumplimiento.'],
    ],
    whenUse: ['Estable y larga → Savings Plans', 'Tolerante a cortes → Spot', 'Incierta o corta → On-Demand'],
    whenNot: ['No compres compromisos para cargas que no sabes si seguirán'],
    seeAlso: ['Instancias Spot', 'Savings Plans'],
  },
  {
    name: 'Instancias Spot',
    kind: 'concepto',
    category: 'costes',
    level: 2,
    summary: 'Capacidad sobrante de EC2 a un precio muy inferior, que AWS puede recuperar con 2 minutos de aviso.',
    whenUse: ['Procesos por lotes, renderizado, análisis de datos, CI/CD, nodos de contenedores tolerantes a fallos'],
    whenNot: ['Bases de datos de producción o servicios sin tolerancia a cortes'],
    scenario: 'base',
    examples: [['aws ec2 describe-spot-price-history --instance-types t3.micro --query "SpotPriceHistory[0:2].[AvailabilityZone,SpotPrice]" --output text']],
    seeAlso: ['Modelos de compra', 'aws ec2 describe-spot-price-history'],
  },
  {
    name: 'Savings Plans',
    kind: 'concepto',
    category: 'costes',
    level: 2,
    summary: 'Te comprometes a gastar una cantidad por hora durante 1 o 3 años y recibes un descuento sobre On-Demand.',
    details: 'Los _Compute Savings Plans_ valen para EC2, Fargate y Lambda sin importar familia, región o SO; los _EC2 Instance Savings Plans_ dan más descuento atados a una familia y región.',
    whenUse: ['Cubrir con descuento tu base de uso estable'],
    whenNot: ['No cubras el pico ni cargas que quizá desaparezcan: pagarías compromiso sin usarlo'],
    seeAlso: ['Modelos de compra'],
  },
  {
    name: 'aws ec2 describe-spot-price-history',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Historial reciente de precios Spot por tipo de instancia y zona.',
    usage: 'aws ec2 describe-spot-price-history --instance-types <tipo> [--availability-zone <az>]',
    examples: [['aws ec2 describe-spot-price-history --instance-types m5.large --query "SpotPriceHistory[0:3].[AvailabilityZone,SpotPrice]" --output table']],
    seeAlso: ['Instancias Spot'],
  },
];
