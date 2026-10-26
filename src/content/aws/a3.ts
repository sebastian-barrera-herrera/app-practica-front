import { A, all, awsHas, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, out, practice, predict, ran, tf } from './awsbuild';

const AMI_PARAM = '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64';
const GET_AMI = `AMI=$(aws ssm get-parameter --name ${AMI_PARAM} --query Parameter.Value --output text)`;
const ID_OF = (name: string) => `ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=${name} --query "Reservations[0].Instances[0].InstanceId" --output text)`;
const WEB_UD = '#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Hola desde mi web</h1>" > /var/www/html/index.html\n';

export const a3 = awsWorld({
  id: 'a3',
  index: 3,
  title: 'Cómputo: EC2',
  subtitle: 'Servidores virtuales a tu medida',
  emoji: '🖥️',
  color: '#22D3EE',
  level: 'basico',
  intro:
    'EC2 (_Elastic Compute Cloud_) es el servicio estrella de AWS: servidores virtuales que enciendes en minutos y pagas por el tiempo que están encendidos. Aprenderás a lanzar tu primera instancia, a elegir el tipo adecuado, a darle discos, a abrirla al mundo con un firewall bien configurado y a pagar menos por ella. Todo con la CLI, sobre una cuenta de práctica donde equivocarse sale gratis.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a3-1', { title: 'Tu primera instancia', summary: 'AMI, tipo, clave y ciclo de vida', emoji: '🚀', commands: ['EC2', 'AMI', 'Par de claves', 'aws ec2 run-instances', 'aws ec2 describe-instances'], minutes: 13 }, [
      learn(
        'Qué hace falta para lanzar un servidor',
        `
Una **instancia EC2** es un servidor virtual. Para lanzarla le indicas, como mínimo:

- **AMI** (_Amazon Machine Image_): la «plantilla» del disco, con el sistema operativo y el software preinstalado (Amazon Linux, Ubuntu, Windows…). Los **ID de AMI cambian por región** y se renuevan con el tiempo.
- **Tipo de instancia**: cuánta CPU y memoria tiene (\`t3.micro\`, \`m5.large\`…).
- **Par de claves**: la forma de entrar por SSH. AWS guarda la clave pública en la instancia y tú te quedas con la privada.
- **Red**: en qué subred y con qué **security group** (firewall).
- **Almacenamiento**: el disco raíz (EBS).

Opcionales pero muy usados: **etiquetas** (para encontrarla), **user data** (un script de arranque) y un **rol de IAM** (para que acceda a otros servicios sin claves).
`,
        '🚀',
      ),
      mc('¿Qué es una AMI?', ['Un tipo de CPU', 'Una plantilla de disco con sistema operativo y software, a partir de la que se crea una instancia', 'Un permiso de IAM', 'Un balanceador de carga'], 1, 'La AMI es el «molde» del disco de arranque. Cada instancia nace de una AMI.'),
      learn(
        'Encontrar la AMI de hoy',
        `
La forma moderna de obtener el ID de la última Amazon Linux 2023 es consultar un **parámetro público de SSM**: AWS lo mantiene siempre apuntando a la AMI actual de **tu región**.

\`\`\`
aws ssm get-parameter \\
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \\
  --query Parameter.Value --output text
\`\`\`

Así tus scripts no dependen de IDs que caducan.
`,
        '🔎',
      ),
      demo(
        'Preparar el terreno',
        [
          [GET_AMI, 'Guardamos en la variable AMI el ID vigente en esta región'],
          ['echo $AMI', 'Cada región tiene su propio ID: `ami-0…`'],
          ['aws ec2 describe-images --image-ids $AMI --query "Images[0].[Name,Architecture,RootDeviceType]" --output text', 'Comprobamos qué es: una Amazon Linux 2023 de 64 bits x86, con disco EBS'],
          ['aws ec2 create-key-pair --key-name clave-curso --query KeyMaterial --output text > clave-curso.pem', 'El par de claves: la CLI te da la clave **privada** solo esta vez; la guardamos en un archivo'],
          ['chmod 400 clave-curso.pem', 'SSH exige que solo tú puedas leer la clave (permisos 400)'],
          ['ls -l clave-curso.pem', 'Fíjate: `-r--------`'],
        ],
        A('base'),
      ),
      mc('Creaste un par de claves y has perdido el archivo `.pem`. ¿Puedes volver a descargar la clave privada?', ['Sí, con `aws ec2 describe-key-pairs`', 'No: AWS solo la entrega al crearla; tendrías que crear otro par', 'Sí, desde la consola, en cualquier momento', 'Sí, pidiéndola a soporte'], 1, 'AWS no guarda la clave privada. Si la pierdes, creas otro par de claves (y, para instancias ya lanzadas, hay procedimientos de recuperación).'),
      learn(
        'El ciclo de vida de una instancia',
        `
Una instancia pasa por estos estados:

- \`pending\`: arrancando (unos segundos).
- \`running\`: encendida. **Aquí pagas el cómputo** (por segundo en Linux, con un mínimo de 60 s).
- \`stopping\` → \`stopped\`: detenida. **No pagas el cómputo**, pero sí sus discos EBS. Conserva el disco y puede volver a arrancar.
- \`shutting-down\` → \`terminated\`: eliminada para siempre (el disco raíz se borra por defecto).

Al parar y arrancar una instancia, su **IP pública cambia** (la privada se conserva).
`,
        '🔄',
      ),
      illus('aws-ec2-lifecycle', 'Estados y qué pagas', 'Toca cada estado: verás si se cobra, qué conserva y a qué estados puede ir.'),
      mc('Quieres dejar de pagar el cómputo de una instancia pero conservar su disco para usarla el mes que viene. ¿Qué haces?', ['Terminarla', 'Pararla (stop)', 'Reiniciarla', 'Borrar su AMI'], 1, 'Detenida no cobra cómputo y el disco se conserva. (El almacenamiento EBS sí se sigue pagando.)'),
      practice({
        prompt:
          'Lanza una instancia **`t3.micro`** con la última **Amazon Linux 2023** (usa el parámetro de SSM para obtener la AMI) y etiquétala con **`Name=mi-web`**.\n\nEjemplo de etiquetas: `--tag-specifications \'ResourceType=instance,Tags=[{Key=Name,Value=mi-web}]\'`',
        goal: 'Instancia t3.micro etiquetada mi-web',
        setup: A('base'),
        check: awsIs('ec2 describe-instances --filters Name=tag:Name,Values=mi-web Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceType"', ['t3.micro'], 'No hay una instancia t3.micro con la etiqueta Name=mi-web'),
        solution: [GET_AMI, "aws ec2 run-instances --image-id $AMI --instance-type t3.micro --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=mi-web}]'"],
        hints: ['Primero obtén la AMI: `aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text`.', 'Después `aws ec2 run-instances --image-id <AMI> --instance-type t3.micro …`.', 'No olvides `--tag-specifications`.'],
        explain: '`run-instances` crea la instancia (empieza en `pending` y pasa a `running` en unos segundos). Las etiquetas permiten encontrarla después con filtros `Name=tag:Name,Values=…`.',
        par: 2,
        commands: ['aws ec2 run-instances', 'AMI'],
      }),
      practice({
        prompt: 'Ya terminó el horario laboral. **Para** la instancia llamada **`web-1`** (etiqueta `Name`) para no pagar su cómputo esta noche.',
        goal: 'web-1 en estado stopped',
        setup: A('ec2demo'),
        check: awsIs('ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[].Instances[].State.Name"', ['stopped'], 'web-1 sigue encendida'),
        solution: [ID_OF('web-1'), 'aws ec2 stop-instances --instance-ids $ID'],
        hints: ['Busca su ID con `describe-instances --filters Name=tag:Name,Values=web-1`.', 'Después `aws ec2 stop-instances --instance-ids <id>`.'],
        explain: 'Parar es la forma de «apagar» sin perder el disco. Si ya no la necesitas nunca más, se **termina** (`terminate-instances`).',
        par: 2,
        commands: ['aws ec2 describe-instances'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a3-2', { title: 'Familias de instancias y cómo elegir', summary: 'm5.large, c7g.xlarge… qué significa cada letra', emoji: '🧬', commands: ['Tipo de instancia', 'aws ec2 describe-instance-types'], minutes: 10 }, [
      learn(
        'Cómo leer el nombre de un tipo',
        `
Un nombre como **\`m5.large\`** se lee así:

- \`m\` → la **familia** (para qué está pensada).
- \`5\` → la **generación** (mayor número = más moderna, normalmente mejor precio/rendimiento).
- \`large\` → el **tamaño** (nano, micro, small, medium, large, xlarge, 2xlarge…; cada salto suele duplicar CPU y memoria).

Familias principales:

| Letra | Para qué | Ejemplo de uso |
| --- | --- | --- |
| **T** | Propósito general con CPU «ráfaga» (_burstable_) | Webs pequeñas, entornos de prueba |
| **M** | Propósito general equilibrado | Aplicaciones, servidores de backend |
| **C** | Optimizada para cómputo | Procesado de vídeo, juegos, cálculo |
| **R / X** | Optimizada para memoria | Cachés, bases de datos en memoria |
| **I / D** | Almacenamiento local rápido | Bases de datos NoSQL |
| **P / G** | Aceleración por GPU | Machine learning, gráficos |

Un sufijo da pistas: **\`g\`** = procesador **Graviton** (ARM, de AWS), **\`a\`** = AMD, **\`d\`** = discos locales NVMe.
`,
        '🧬',
      ),
      match(
        'Une cada familia con su uso típico',
        [
          ['C (c5, c7g)', 'Mucho cómputo: codificar vídeo'],
          ['R (r5, r6i)', 'Mucha memoria: caché o base de datos en memoria'],
          ['T (t3, t4g)', 'Cargas pequeñas y variables con CPU en ráfagas'],
          ['P / G', 'GPU: entrenar modelos de ML'],
        ],
        'Mnemotecnia: **C**ompute, **R**AM, **T**iny/burst**y**, **P**/**G** para GPU.',
      ),
      mc('Una base de datos en memoria necesita muchísima RAM por cada vCPU. ¿Qué familia eliges?', ['C', 'R', 'T', 'P'], 1, 'La familia R está optimizada para memoria (más RAM por vCPU).'),
      demo(
        'Compara tipos desde la CLI',
        [
          ['aws ec2 describe-instance-types --instance-types t3.micro m5.large c5.large r5.large --query "InstanceTypes[].[InstanceType,VCpuInfo.DefaultVCpus,MemoryInfo.SizeInMiB]" --output table', 'vCPU y memoria (en MiB) de cuatro tipos'],
          ['aws ec2 describe-instance-types --instance-types t4g.micro --query "InstanceTypes[0].ProcessorInfo.SupportedArchitectures" --output text', 'Graviton (t4g) es arm64: necesita una AMI para arm64'],
          [GET_AMI, 'La AMI x86 de siempre'],
          ['aws ec2 run-instances --image-id $AMI --instance-type t4g.micro', 'Mezclar una AMI x86 con un tipo ARM falla: las arquitecturas deben coincidir', 'error'],
        ],
        A('base'),
      ),
      predict(
        '¿Cuánta memoria (en MiB) tiene un `m5.large`?',
        'aws ec2 describe-instance-types --instance-types m5.large --query "InstanceTypes[0].MemoryInfo.SizeInMiB"',
        ['2048', '4096', '16384'],
        'Un `m5.large` tiene 2 vCPU y 8 GiB (8192 MiB) de memoria, la proporción típica de la familia M (1 vCPU : 4 GiB).',
        A('base'),
      ),
      tf('«Un tipo de instancia Graviton (por ejemplo `t4g.micro`) puede arrancar cualquier AMI de arquitectura x86.»', false, 'Graviton usa procesadores ARM (arm64). Necesita una AMI arm64. Suelen dar mejor precio/rendimiento, pero tu software debe ser compatible.'),
      learn(
        'Elegir y ajustar el tamaño',
        `
No existe «el tipo correcto» de partida. El método habitual:

1. **Empieza pequeño** con un tipo razonable de la familia adecuada.
2. **Mide**: CloudWatch muestra CPU, red y disco (la memoria requiere el agente de CloudWatch). **AWS Compute Optimizer** te sugiere tipos mejores.
3. **Ajusta** (_right-sizing_): si siempre estás al 10 % de CPU, pasa a uno menor y ahorras.

Para cambiar el tipo de una instancia EBS: **párala → cambia el tipo → arráncala**. Hay que estar parada y la arquitectura debe ser la misma.
`,
        '📏',
      ),
      practice({
        prompt: 'Para ahorrar, quieres usar tipos de la **capa gratuita**. Lista solo los **nombres** de los tipos de instancia elegibles para ella (filtro `free-tier-eligible=true`).',
        goal: 'Mostrar los tipos elegibles para la capa gratuita',
        setup: A('base'),
        check: all(ran('free-tier-eligible'), out(['t2.micro', 't3.micro']), { t: 'output', notIncludes: 'm5.large' }),
        solution: ['aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --query "InstanceTypes[].InstanceType" --output text'],
        hints: ['`aws ec2 describe-instance-types --filters Name=…,Values=…`', 'El filtro se llama `free-tier-eligible`.', 'Para quedarte solo con los nombres: `--query "InstanceTypes[].InstanceType" --output text`.'],
        explain: 'Los filtros (`--filters`) se aplican en el servidor y `--query` en tu equipo. La elegibilidad real de la capa gratuita depende de tu cuenta y región: comprueba siempre las condiciones vigentes.',
        par: 1,
        commands: ['aws ec2 describe-instance-types'],
      }),
      practice({
        prompt: 'La instancia **`batch-1`** (parada) se queda corta de memoria. Cámbiale el tipo a **`t3.large`** (no hace falta arrancarla).',
        goal: 'batch-1 con tipo t3.large',
        setup: A('ec2demo'),
        check: awsIs('ec2 describe-instances --filters Name=tag:Name,Values=batch-1 --query "Reservations[].Instances[].InstanceType"', ['t3.large'], 'batch-1 debería ser t3.large'),
        solution: [ID_OF('batch-1'), 'aws ec2 modify-instance-attribute --instance-id $ID --instance-type Value=t3.large'],
        hints: ['Obtén su ID con `describe-instances --filters Name=tag:Name,Values=batch-1`.', '`aws ec2 modify-instance-attribute --instance-id <id> --instance-type Value=t3.large`'],
        explain: 'Solo se puede cambiar el tipo de una instancia **detenida**. Si estuviera encendida, la CLI te devolvería `IncorrectInstanceState`.',
        par: 2,
        commands: ['Tipo de instancia'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a3-3', { title: 'Discos: EBS frente a instance store', summary: 'Persistencia, tipos de volumen y snapshots', emoji: '💽', commands: ['EBS', 'Instance store', 'Snapshot de EBS', 'aws ec2 create-volume', 'aws ec2 attach-volume', 'aws ec2 create-snapshot'], minutes: 12 }, [
      learn(
        'Dos tipos de disco',
        `
- **Amazon EBS** (_Elastic Block Store_): discos **de red, persistentes**, independientes de la instancia. Sobreviven a que pares, reinicies o incluso termines la instancia (si no marcaste «borrar al terminar»). Viven en **una zona de disponibilidad** y solo se adjuntan a instancias de **esa misma zona**.
- **Instance store**: discos físicos del servidor donde corre la instancia. Muy rápidos, pero **efímeros**: los datos se pierden al parar, terminar o si falla el hardware. Sirven para cachés y datos temporales.

> CLAVE: Los datos que no puedes perder no van en un instance store. Y la regla del tamaño: un volumen EBS **y su instancia deben estar en la misma AZ**.
`,
        '💽',
      ),
      illus('aws-ebs-vs-store', '¿Qué sobrevive?', 'Elige una acción sobre la instancia y mira qué datos se conservan.'),
      mc('¿Qué ocurre con los datos de un instance store cuando paras la instancia?', ['Se conservan', 'Se pierden', 'Se copian a S3 automáticamente', 'Se conservan solo 24 horas'], 1, 'El instance store es efímero: parar, terminar o un fallo de hardware lo borra.'),
      learn(
        'Tipos de volumen EBS',
        `
| Tipo | Medio | Úsalo para |
| --- | --- | --- |
| **gp3** | SSD de propósito general | La opción por defecto para casi todo |
| **gp2** | SSD (generación anterior) | Heredado: mejor gp3 |
| **io1 / io2** | SSD con IOPS provisionadas | Bases de datos críticas que necesitan rendimiento garantizado |
| **st1** | HDD optimizado para rendimiento | Lecturas secuenciales grandes: big data, logs |
| **sc1** | HDD frío | Datos poco accesibles, lo más barato |

Los volúmenes se pueden **ampliar en caliente** (\`modify-volume\`), nunca reducir. Después hay que ampliar el sistema de archivos dentro del SO.
`,
        '📀',
      ),
      match(
        'Une cada tipo de volumen con su uso',
        [
          ['gp3', 'SSD de propósito general (la elección por defecto)'],
          ['io2', 'IOPS provisionadas para bases de datos exigentes'],
          ['st1', 'HDD para lecturas secuenciales grandes'],
          ['sc1', 'HDD frío y barato para datos poco usados'],
        ],
        'Empieza por gp3; sube a io2 si necesitas IOPS garantizadas; usa HDD (st1/sc1) solo para cargas secuenciales o datos fríos.',
      ),
      learn(
        'Snapshots: copias de seguridad de un volumen',
        `
Un **snapshot** es una copia de un volumen EBS en un instante dado. Son **incrementales** (solo se guarda lo que cambió desde el anterior) y AWS los guarda por ti en S3. Con un snapshot puedes:

- **Restaurar**: crear un volumen nuevo a partir de él (incluso en otra zona o región).
- **Copiar** entre regiones, para recuperación ante desastres.
- Construir **AMI** propias.

Para automatizar copias periódicas están **Amazon Data Lifecycle Manager** y **AWS Backup**.
`,
        '📸',
      ),
      demo(
        'Crear, conectar y copiar un disco',
        [
          ['AZ=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].Placement.AvailabilityZone" --output text)', 'La zona en la que está web-1: el disco debe crearse en la misma'],
          ['VOL=$(aws ec2 create-volume --availability-zone $AZ --size 10 --volume-type gp3 --query VolumeId --output text)', 'Creamos un volumen gp3 de 10 GiB'],
          ['aws ec2 wait volume-available --volume-ids $VOL', 'Esperamos a que esté disponible'],
          [ID_OF('web-1'), 'ID de la instancia'],
          ['aws ec2 attach-volume --volume-id $VOL --instance-id $ID --device /dev/sdg', 'Lo conectamos como /dev/sdg (dentro del SO habría que formatearlo y montarlo)'],
          ['aws ec2 create-snapshot --volume-id $VOL --description prueba --query SnapshotId --output text', 'Hacemos un snapshot'],
          ['aws ec2 create-volume --availability-zone eu-west-1a --size 10', 'Una zona de otra región no es válida aquí', 'error'],
        ],
        A('ec2demo'),
      ),
      tf('«Un volumen EBS de la zona us-east-1a se puede adjuntar a una instancia de us-east-1b.»', false, 'Debe ser la misma zona de disponibilidad. Para moverlo, haz un snapshot y crea un volumen nuevo a partir de él en la otra zona.'),
      practice({
        prompt: 'Crea un volumen **gp3 de 30 GiB** en la misma zona que la instancia `web-1` y **adjúntalo** a ella como **`/dev/sdh`**.',
        goal: 'Volumen de 30 GiB conectado a web-1 en /dev/sdh',
        setup: A('ec2demo'),
        check: awsIs('ec2 describe-volumes --query \'Volumes[?Size==`30`].Attachments[].Device\'', ['/dev/sdh'], 'Falta un volumen de 30 GiB conectado en /dev/sdh'),
        solution: [
          'AZ=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].Placement.AvailabilityZone" --output text)',
          'VOL=$(aws ec2 create-volume --availability-zone $AZ --size 30 --volume-type gp3 --query VolumeId --output text)',
          'aws ec2 wait volume-available --volume-ids $VOL',
          ID_OF('web-1'),
          'aws ec2 attach-volume --volume-id $VOL --instance-id $ID --device /dev/sdh',
        ],
        hints: ['Primero averigua la zona de web-1 (`Placement.AvailabilityZone`).', '`aws ec2 create-volume --availability-zone <zona> --size 30 --volume-type gp3`', 'Después `aws ec2 attach-volume --volume-id … --instance-id … --device /dev/sdh`.'],
        explain: 'Crear el volumen en la zona correcta es lo que permite conectarlo. Si te equivocas de zona, `attach-volume` falla con `InvalidVolume.ZoneMismatch`.',
        par: 4,
        commands: ['aws ec2 create-volume', 'aws ec2 attach-volume'],
      }),
      practice({
        prompt: 'El volumen **`datos`** (etiqueta `Name=datos`) tiene información importante. Haz un **snapshot** con la descripción **`copia-diaria`**.',
        goal: 'Snapshot con descripción copia-diaria',
        setup: A('ec2demo'),
        check: awsHas('ec2 describe-snapshots --query "Snapshots[].Description"', 'copia-diaria', 'Falta el snapshot con descripción copia-diaria'),
        solution: ['VOL=$(aws ec2 describe-volumes --filters Name=tag:Name,Values=datos --query "Volumes[0].VolumeId" --output text)', 'aws ec2 create-snapshot --volume-id $VOL --description copia-diaria'],
        hints: ['Busca el ID del volumen con `describe-volumes --filters Name=tag:Name,Values=datos`.', '`aws ec2 create-snapshot --volume-id <id> --description copia-diaria`'],
        explain: 'Los snapshots son incrementales: el primero copia todo y los siguientes solo lo que cambió. Con Data Lifecycle Manager puedes programarlos y borrar los antiguos automáticamente.',
        par: 2,
        commands: ['Snapshot de EBS', 'aws ec2 create-snapshot'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a3-4', { title: 'Security groups, IP elástica y user data', summary: 'Abrir el servidor al mundo sin dejar la puerta abierta', emoji: '🧱', commands: ['Security group', 'IP elástica', 'User data', 'aws ec2 create-security-group', 'aws ec2 authorize-security-group-ingress', 'aws ec2 allocate-address'], minutes: 15 }, [
      learn(
        'El firewall de la instancia',
        `
Un **security group** (SG) es un firewall virtual asociado a la instancia (en realidad a su interfaz de red). Reglas básicas:

- Solo hay reglas **Allow**: no se puede escribir un «Deny».
- **Entrada**: por defecto, **todo bloqueado**. Tú abres lo necesario.
- **Salida**: por defecto, todo permitido.
- Es **con estado** (_stateful_): si dejas entrar una petición, la respuesta sale sola, sin otra regla.
- Cada regla tiene protocolo, **puerto**, y **origen**: un rango CIDR (\`203.0.113.0/24\`, \`0.0.0.0/0\` = todo internet) u **otro security group**.

Puertos que debes reconocer: **22** SSH · **80** HTTP · **443** HTTPS · **3389** RDP · **3306** MySQL · **5432** PostgreSQL.

> OJO: Abrir el 22 o el 3389 a \`0.0.0.0/0\` es una de las configuraciones más peligrosas: los bots de internet los prueban sin parar. Ábrelos solo a tu IP (\`/32\`) o, mejor, usa **Session Manager** y no abras nada.
`,
        '🧱',
      ),
      mc('¿Se puede crear en un security group una regla que **deniegue** el tráfico desde una IP concreta?', ['Sí, con Effect Deny', 'No: los security groups solo tienen reglas Allow (para denegar hay NACL)', 'Sí, pero solo para salida', 'Sí, si es el grupo default'], 1, 'Los security groups solo permiten. Para bloquear una IP concreta se usan las ACL de red (NACL), que veremos en la zona de redes.'),
      tf('«Los security groups tienen estado: si dejo entrar una petición HTTP, la respuesta sale sin necesitar otra regla.»', true, 'Es lo que significa _stateful_. (Las NACL, en cambio, no tienen estado.)'),
      learn(
        'IP pública, IP elástica y user data',
        `
- Una instancia recibe una **IP pública** de un conjunto de AWS, pero **cambia** cada vez que la paras y arrancas. Para una IP **fija** reservas una **IP elástica** (Elastic IP) y la asocias a la instancia. Desde 2024, AWS cobra por **cada dirección IPv4 pública**, en uso o no, así que reserva solo las que necesites (consulta los precios vigentes).
- El **user data** es un script que se ejecuta **una vez, en el primer arranque**, como root. Sirve para instalar y configurar lo que necesite el servidor (hasta 16 KB).

\`\`\`
#!/bin/bash
dnf install -y httpd
systemctl enable --now httpd
echo "<h1>Hola desde mi web</h1>" > /var/www/html/index.html
\`\`\`
`,
        '📜',
      ),
      demo(
        'Una web en EC2, paso a paso (y el error que casi todos cometen)',
        [
          ['SG=$(aws ec2 create-security-group --group-name web --description "Servidor web" --query GroupId --output text)', 'Un grupo de seguridad nuevo: sin ninguna regla de entrada'],
          [GET_AMI, 'La AMI de Amazon Linux 2023'],
          ['ID=$(aws ec2 run-instances --image-id $AMI --instance-type t3.micro --security-group-ids $SG --user-data file://ud.sh --query "Instances[0].InstanceId" --output text)', 'Lanzamos la instancia con un script de arranque que instala el servidor web'],
          ['aws ec2 wait instance-running --instance-ids $ID', 'Esperamos a que esté en marcha'],
          ['IP=$(aws ec2 describe-instances --instance-ids $ID --query "Reservations[0].Instances[0].PublicIpAddress" --output text)', 'Su IP pública'],
          ['curl -m 5 http://$IP', 'Se queda esperando y acaba en **timeout**: el SG bloquea el puerto 80', 'error'],
          ['aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0', 'Abrimos el puerto 80 al mundo'],
          ['curl -s http://$IP', 'Ahora sí: ¡la web responde!'],
        ],
        A('base', { files: { '/home/alumno/ud.sh': WEB_UD } }),
      ),
      learn(
        'Leer el error: timeout o rechazado',
        `
Cuando una conexión falla, **cómo** falla te dice dónde buscar:

| Síntoma | Qué significa | Dónde mirar |
| --- | --- | --- |
| **Timeout** (se queda esperando) | El paquete **nunca llegó**: algo lo descarta en silencio | Security group, ACL de red, tabla de rutas, IP pública |
| **Connection refused** (rechazada al instante) | El paquete **llegó** a la máquina, pero **nada escucha** en ese puerto | El servicio no está arrancado o escucha en otro puerto |
`,
        '🩺',
      ),
      mc('`curl` a la IP de tu instancia tarda mucho y acaba con **timeout**. ¿Cuál es la causa más probable?', ['El servidor web está arrancado pero tiene un error', 'El security group no permite el puerto', 'La instancia no tiene disco', 'El comando curl está mal escrito'], 1, 'Un timeout significa que los paquetes no llegan: lo más típico es que el security group (o la NACL) bloquee el puerto.'),
      practice({
        prompt:
          'Crea un security group llamado **`web`** en la VPC por defecto con estas reglas de entrada:\n\n- **HTTP (80)** abierto a todo internet (`0.0.0.0/0`).\n- **SSH (22)** solo desde la red de la oficina `203.0.113.0/24`.',
        goal: 'SG web: 80 desde cualquier sitio, 22 solo desde 203.0.113.0/24',
        setup: A('base'),
        check: all(
          awsIs('ec2 describe-security-groups --filters Name=group-name,Values=web --query "sort(SecurityGroups[].IpPermissions[].FromPort)"', [22, 80], 'El grupo web debe tener reglas para los puertos 22 y 80'),
          awsIs('ec2 describe-security-groups --filters Name=group-name,Values=web --query \'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp\'', ['203.0.113.0/24'], 'SSH debe abrirse solo a 203.0.113.0/24'),
          awsIs('ec2 describe-security-groups --filters Name=group-name,Values=web --query \'SecurityGroups[0].IpPermissions[?FromPort==`80`].IpRanges[].CidrIp\'', ['0.0.0.0/0'], 'HTTP debe estar abierto a 0.0.0.0/0'),
        ),
        solution: [
          'SG=$(aws ec2 create-security-group --group-name web --description "Servidor web" --query GroupId --output text)',
          'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0',
          'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 203.0.113.0/24',
        ],
        hints: ['`aws ec2 create-security-group --group-name web --description "…"`', 'Cada regla: `aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port <n> --cidr <rango>`.'],
        explain: 'Principio de mínimo privilegio también en la red: HTTP abierto porque es una web pública; SSH solo desde donde trabajas.',
        par: 3,
        commands: ['Security group', 'aws ec2 create-security-group', 'aws ec2 authorize-security-group-ingress'],
      }),
      practice({
        prompt: 'Hay una instancia con servidor web llamada **`web-cerrado`**, pero nadie puede abrir su página. Su grupo de seguridad se llama **`web-cerrado`**. Permite **HTTP (puerto 80) desde cualquier IP**.',
        goal: 'Abrir el puerto 80 en el grupo web-cerrado',
        setup: A('ec2web'),
        check: awsIs('ec2 describe-security-groups --filters Name=group-name,Values=web-cerrado --query "SecurityGroups[].IpPermissions[].[FromPort,IpRanges[0].CidrIp]"', [[80, '0.0.0.0/0']], 'Falta la regla de entrada 80 desde 0.0.0.0/0'),
        solution: ['SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-cerrado --query "SecurityGroups[0].GroupId" --output text)', 'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0'],
        hints: ['Busca el ID del grupo con `describe-security-groups --filters Name=group-name,Values=web-cerrado`.', '`aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 80 --cidr 0.0.0.0/0`'],
        explain: 'El servidor web funcionaba por dentro; faltaba la regla de entrada. Los cambios en un SG se aplican al instante y sin reiniciar nada.',
        par: 2,
        commands: ['aws ec2 authorize-security-group-ingress'],
      }),
      practice({
        prompt: 'Para que la IP de **`web-1`** no cambie al parar y arrancar, **reserva una IP elástica** y **asóciala** a esa instancia.',
        goal: 'IP elástica asociada a web-1',
        setup: A('ec2demo'),
        check: awsIs('ec2 describe-addresses --query "length(Addresses[?InstanceId])"', 1, 'Falta una IP elástica asociada a una instancia'),
        solution: ['ALLOC=$(aws ec2 allocate-address --query AllocationId --output text)', ID_OF('web-1'), 'aws ec2 associate-address --allocation-id $ALLOC --instance-id $ID'],
        hints: ['`aws ec2 allocate-address` reserva la IP y devuelve un `AllocationId`.', 'Después `aws ec2 associate-address --allocation-id … --instance-id …`.'],
        explain: 'Una IP elástica es tuya hasta que la liberes (`release-address`): sobrevive a parar y arrancar. Libérala cuando no la uses, porque cuesta dinero.',
        par: 3,
        commands: ['IP elástica', 'aws ec2 allocate-address'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a3-5', { title: 'Modelos de compra', summary: 'On-Demand, Savings Plans, Spot y Dedicated', emoji: '🧾', commands: ['Modelos de compra', 'Instancias Spot', 'Savings Plans', 'aws ec2 describe-spot-price-history'], minutes: 11 }, [
      learn(
        'Lo mismo, a distinto precio',
        `
La misma instancia puede costar muy distinto según **cómo la compres**:

| Modelo | Compromiso | Descuento orientativo | Cuándo |
| --- | --- | --- | --- |
| **On-Demand** | Ninguno, pagas por segundo | — (el precio de lista) | Pruebas, cargas impredecibles |
| **Savings Plans** | 1 o 3 años de gasto por hora | hasta ~70 % | Cargas estables 24/7 |
| **Instancias reservadas** | 1 o 3 años de un tipo concreto | hasta ~70 % | Igual, con menos flexibilidad |
| **Spot** | Ninguno, pero AWS puede **interrumpirla** con 2 minutos de aviso | hasta ~90 % | Procesos por lotes, tolerantes a fallos |
| **Dedicated Hosts / Instances** | Servidor físico para ti | — | Licencias por socket/core o cumplimiento |

Los descuentos reales cambian: contrasta siempre con la calculadora de precios de AWS.
`,
        '🧾',
      ),
      illus('aws-purchase-models', 'Precio frente a compromiso', 'Toca un modelo para ver su compromiso, su ahorro típico y su riesgo.'),
      match(
        'Une cada situación con el modelo de compra',
        [
          ['Base de datos de producción 24/7 durante 3 años', 'Savings Plans / reservadas'],
          ['Renderizado nocturno que se puede reiniciar', 'Spot'],
          ['Prueba de una semana sin saber si seguirá', 'On-Demand'],
          ['Licencias de software ligadas a un servidor físico', 'Dedicated Host'],
        ],
        'Estable y larga → compromiso (Savings Plans). Tolerante a cortes → Spot. Incierta → On-Demand. Hardware dedicado → Dedicated.',
      ),
      mc('¿Cuál es la principal desventaja de las instancias **Spot**?', ['Son más caras', 'AWS puede interrumpirlas con poco aviso cuando necesita la capacidad', 'No tienen red', 'Solo funcionan en una región'], 1, 'Spot usa capacidad sobrante: es muy barata, pero AWS puede recuperarla (aviso de 2 minutos). Diseña la carga para tolerar interrupciones.'),
      demo(
        'El mercado Spot en vivo',
        [
          ['aws ec2 describe-spot-price-history --instance-types m5.large --query "SpotPriceHistory[0:3].[AvailabilityZone,SpotPrice]" --output table', 'El precio Spot varía por zona'],
          ['aws ec2 describe-instance-types --instance-types m5.large --query "InstanceTypes[0].[InstanceType,VCpuInfo.DefaultVCpus]" --output text', 'El mismo tipo, a precio de lista (On-Demand) costaría bastante más: compáralos en la calculadora de AWS'],
        ],
        A('base'),
      ),
      tf('«Una instancia Spot puede ser interrumpida por AWS, con aviso de 2 minutos, si necesita recuperar la capacidad.»', true, 'Por eso Spot es ideal para trabajos tolerantes a interrupciones y poco recomendable para una base de datos de producción.'),
      learn(
        'Cómo pagar menos, en orden de importancia',
        `
1. **Apaga o elimina lo que no usas** (instancias paradas fuera de horario, volúmenes y snapshots huérfanos, IP elásticas sin uso).
2. **Ajusta el tamaño** (_right-sizing_) con CloudWatch y Compute Optimizer.
3. **Compromete lo estable** con Savings Plans (cubre solo tu base de uso, no el pico).
4. **Usa Spot** para lo que tolere interrupciones.
5. Valora **Graviton** (ARM): mejor precio/rendimiento si tu software lo admite.
6. **Etiqueta todo** y mira **Cost Explorer** para saber quién gasta qué.
`,
        '💡',
      ),
      mc('Una instancia cuesta 0,10 USD por hora. La dejas encendida todo un mes de 30 días (24 h/día). ¿Cuánto cuesta aproximadamente su cómputo?', ['7,20 USD', '72 USD', '720 USD', '3,00 USD'], 1, '0,10 USD × 24 h × 30 días = 72 USD. Si solo la necesitas 8 h al día en días laborables, el coste baja drásticamente.'),
      practice({
        prompt: 'Lanza una instancia **Spot** `t3.micro` con la última Amazon Linux 2023 (opción `--instance-market-options MarketType=spot`).',
        goal: 'Una instancia Spot en ejecución',
        setup: A('base'),
        check: awsIs('ec2 describe-instances --filters Name=instance-lifecycle,Values=spot --query "length(Reservations)"', 1, 'No hay ninguna instancia Spot'),
        solution: [GET_AMI, 'aws ec2 run-instances --image-id $AMI --instance-type t3.micro --instance-market-options MarketType=spot'],
        hints: ['Es `aws ec2 run-instances` igual que siempre, más `--instance-market-options MarketType=spot`.', 'No olvides la AMI: `--image-id $AMI`.'],
        explain: 'Con una sola opción cambias el modelo de compra. Una instancia Spot no se puede «parar» (solo terminar), y puede ser interrumpida.',
        par: 2,
        commands: ['Instancias Spot', 'aws ec2 describe-spot-price-history'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Despliega una web mínima y segura:\n\n1. Crea el par de claves **`web-key`**.\n2. Crea un security group **`web-sg`** con **HTTP (80)** abierto a todo internet y **SSH (22)** solo desde `203.0.113.10/32`.\n3. Lanza una instancia **`t3.micro`** de Amazon Linux 2023 con ese par de claves y ese grupo, con el script de arranque `arranque.sh` (ya está en tu carpeta como `user data`) y la etiqueta **`Name=boss-web`**.\n4. Cuando esté en marcha, **comprueba con `curl`** que la web responde.',
    goal: 'Web en EC2 con SG correcto, clave y user data, y curl funcionando',
    setup: A('base', { files: { '/home/alumno/arranque.sh': WEB_UD } }),
    check: all(
      awsIs('ec2 describe-instances --filters Name=tag:Name,Values=boss-web Name=instance-state-name,Values=running --query "Reservations[].Instances[].[InstanceType,KeyName]"', [['t3.micro', 'web-key']], 'Falta la instancia boss-web (t3.micro, clave web-key) en ejecución'),
      awsIs('ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query \'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp\'', ['203.0.113.10/32'], 'SSH debe abrirse solo a 203.0.113.10/32'),
      awsIs('ec2 describe-instances --filters Name=tag:Name,Values=boss-web --query "length(Reservations[].Instances[?SecurityGroups[?GroupName==\'web-sg\']][])"', 1, 'La instancia debe usar el grupo web-sg'),
      out('Hola desde mi web'),
    ),
    solution: [
      'aws ec2 create-key-pair --key-name web-key --query KeyMaterial --output text > web-key.pem',
      'SG=$(aws ec2 create-security-group --group-name web-sg --description "Web" --query GroupId --output text)',
      'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0',
      'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 203.0.113.10/32',
      GET_AMI,
      "ID=$(aws ec2 run-instances --image-id $AMI --instance-type t3.micro --key-name web-key --security-group-ids $SG --user-data file://arranque.sh --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=boss-web}]' --query 'Instances[0].InstanceId' --output text)",
      'aws ec2 wait instance-running --instance-ids $ID',
      'IP=$(aws ec2 describe-instances --instance-ids $ID --query "Reservations[0].Instances[0].PublicIpAddress" --output text)',
      'curl -s http://$IP',
    ],
    hints: [
      'Empieza por la red: `create-key-pair` y `create-security-group`, y las dos reglas con `authorize-security-group-ingress`.',
      'Lanza la instancia con `--key-name`, `--security-group-ids`, `--user-data file://arranque.sh` y `--tag-specifications`.',
      'Espera con `aws ec2 wait instance-running`, saca la IP pública con `describe-instances` y prueba con `curl http://<ip>`.',
    ],
    explain: 'Clave para entrar, firewall con el mínimo abierto, arranque automatizado con user data y comprobación final: así se despliega un servidor web de forma repetible.',
    commands: ['aws ec2 run-instances', 'aws ec2 authorize-security-group-ingress', 'User data'],
  },
});
