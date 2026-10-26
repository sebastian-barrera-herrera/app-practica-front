import type { AwsRef } from '../reference';

const VPC_ID = 'VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=produccion --query "Vpcs[0].VpcId" --output text)';

export const AWS_REF_NET: AwsRef[] = [
  {
    name: 'CIDR',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Forma de escribir un rango de direcciones IP: `10.0.0.0/16` = la dirección base y cuántos bits (16) quedan fijos. Cuantos más bits fijos, más pequeña la red.',
    details: `
Una IPv4 tiene 32 bits. En \`10.0.1.0/24\`, los primeros **24 bits** identifican la red y los 8 restantes los equipos: 2⁸ = **256** direcciones.

| Prefijo | Direcciones | Utilizables en una subred de AWS |
| --- | --- | --- |
| /16 | 65 536 | 65 531 |
| /20 | 4 096 | 4 091 |
| /24 | 256 | 251 |
| /28 | 16 | 11 |

AWS **reserva 5 direcciones en cada subred**: la de red (.0), el router de la VPC (.1), el DNS de Amazon (.2), una reservada para uso futuro (.3) y la de difusión (.255 en una /24). Por eso la subred más pequeña (/28) tiene 11 utilizables.

Rangos privados que se usan en las VPC (RFC 1918): \`10.0.0.0/8\`, \`172.16.0.0/12\` y \`192.168.0.0/16\`. Una VPC admite desde **/16** (la mayor) hasta **/28** (la menor).
`,
    whenUse: ['Planificar las direcciones de tus VPC y subredes antes de crearlas', 'Evitar solapes entre redes que luego querrás conectar (peering, VPN)'],
    whenNot: ['No elijas una VPC pequeña «por si acaso»: el CIDR principal no se puede cambiar (solo añadir otros)', 'No uses el mismo rango en dos VPC que vayas a unir: no se pueden enrutar entre sí'],
    scenario: 'base',
    examples: [['ipcalc 10.0.0.0/16', 'Una VPC grande'], ['ipcalc 10.0.1.0/24', 'Una subred típica: 254 hosts (251 en AWS)'], ['ipcalc 10.0.1.0/28', 'La subred más pequeña posible']],
    seeAlso: ['ipcalc', 'VPC', 'Subred'],
  },
  {
    name: 'ipcalc',
    kind: 'comando',
    category: 'cli',
    level: 1,
    summary: 'Calcula la red, el primer y último host, la difusión y el número de hosts de un CIDR. Imprescindible para planificar subredes.',
    usage: 'ipcalc 10.0.1.0/24',
    details: 'Recuerda restar las **5 direcciones reservadas por AWS** a los «Hosts/Net» que muestra.',
    scenario: 'base',
    examples: [['ipcalc 192.168.0.0/20'], ['ipcalc 10.0.2.0/23 | grep Hosts', 'Cuántas direcciones útiles tiene una /23']],
    seeAlso: ['CIDR', 'Subred'],
  },
  {
    name: 'VPC',
    kind: 'servicio',
    category: 'redes',
    level: 1,
    summary: 'Tu red privada virtual dentro de AWS: tú decides el rango de IP, las subredes, las rutas y quién puede entrar. Vive en una región.',
    details: `
Una **VPC** (_Virtual Private Cloud_) es una red lógicamente aislada de las demás. Dentro creas **subredes** (cada una en una zona de disponibilidad) y controlas el tráfico con:

- **Tablas de rutas** (a dónde va el tráfico de cada subred).
- **Internet gateway** y **NAT gateway** (salida a internet).
- **Security groups** (firewall de cada instancia, con estado) y **NACL** (filtro de cada subred, sin estado).

Cada región trae una **VPC por defecto** (172.31.0.0/16, subredes públicas) para empezar rápido. En producción conviene crear tus propias VPC con subredes públicas y privadas.
`,
    whenUse: ['Cualquier recurso que necesite red: EC2, RDS, Lambda en VPC, contenedores…', 'Separar entornos (producción y desarrollo en VPC distintas)'],
    whenNot: ['Para pruebas rápidas basta la VPC por defecto; para producción, crea la tuya'],
    pricing: 'La VPC, las subredes, las tablas de rutas y las internet gateways son gratis. Cobran los NAT gateway, las IP públicas, los endpoints de interfaz, el tráfico entre zonas/regiones y las VPN.',
    limits: ['5 VPC por región por defecto (ampliable)', '200 subredes por VPC por defecto', 'CIDR de /16 a /28'],
    scenario: 'red-ok',
    examples: [['aws ec2 describe-vpcs --query "Vpcs[].[VpcId,CidrBlock,IsDefault]" --output table'], ['aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].[CidrBlock,AvailabilityZone,MapPublicIpOnLaunch]" --output text']],
    seeAlso: ['VPC por defecto', 'Subred', 'Internet gateway', 'Tabla de rutas', 'Security group frente a NACL'],
  },
  {
    name: 'VPC por defecto',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'La VPC que AWS crea en cada región (172.31.0.0/16): una subred pública por zona, internet gateway y ruta a internet ya configuradas.',
    details: `
Sirve para lanzar una instancia sin configurar red: sus subredes son **públicas** y las instancias reciben IP pública. Es cómoda y por eso mismo **no es la mejor opción para producción**: todo nace expuesto por defecto.

Se puede borrar y recrear (\`aws ec2 create-default-vpc\`). Muchas organizaciones la eliminan para obligar a usar VPC diseñadas.
`,
    whenUse: ['Pruebas, formación y prototipos'],
    whenNot: ['Producción con datos sensibles: usa subredes privadas'],
    scenario: 'base',
    examples: [['aws ec2 describe-vpcs --filters Name=is-default,Values=true --query "Vpcs[0].CidrBlock" --output text'], ['aws ec2 describe-subnets --query "Subnets[].[AvailabilityZone,CidrBlock]" --output text']],
    seeAlso: ['VPC', 'Subred pública y privada'],
  },
  {
    name: 'Subred',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Un trozo de la VPC (un CIDR más pequeño) que vive en UNA sola zona de disponibilidad. Para alta disponibilidad hacen falta subredes en varias zonas.',
    details: `
- Una subred **no puede cruzar zonas**: para dos zonas, dos subredes.
- Los CIDR de las subredes de una VPC **no pueden solaparse** y han de caber dentro del de la VPC.
- Cada subred tiene **una tabla de rutas** (la que le asocies o, si no, la principal de la VPC) y **una NACL**.
- Una subred «pública» o «privada» no es un ajuste: lo decide su tabla de rutas.
`,
    whenUse: ['Una subred pública y una privada por zona (mínimo dos zonas para producción)'],
    whenNot: ['No metas bases de datos en subredes públicas'],
    scenario: 'red-ok',
    examples: [['aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a,privada-a --query "Subnets[].[Tags[0].Value,CidrBlock,AvailableIpAddressCount]" --output table', 'Direcciones disponibles: 256 − 5 = 251']],
    seeAlso: ['CIDR', 'Subred pública y privada', 'aws ec2 create-subnet'],
  },
  {
    name: 'Subred pública y privada',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Pública = su tabla de rutas tiene una ruta a una internet gateway. Privada = no la tiene (y sale a internet, si hace falta, por un NAT gateway).',
    details: `
No existe un interruptor «público/privado»: lo decide **la ruta**.

| | Pública | Privada |
| --- | --- | --- |
| Ruta \`0.0.0.0/0\` | → internet gateway | → NAT gateway (o ninguna) |
| Instancias | Con IP pública (si quieres acceso directo) | Solo IP privada |
| Qué va ahí | Balanceadores, bastiones, NAT gateways | Servidores de aplicación y bases de datos |

Una arquitectura típica de tres capas: balanceador en subredes **públicas** y aplicación y base de datos en subredes **privadas**.
`,
    whenUse: ['Siempre que haya datos o lógica que no deban ser accesibles directamente desde internet'],
    whenNot: ['No hace falta una subred privada para un sitio web estático (S3 + CloudFront)'],
    scenario: 'red-ok',
    examples: [['aws ec2 describe-route-tables --filters Name=tag:Name,Values=rt-publica --query "RouteTables[0].Routes[].[DestinationCidrBlock,GatewayId]" --output table', 'La ruta a la IGW es lo que hace pública a la subred']],
    seeAlso: ['Subred', 'Internet gateway', 'NAT gateway', 'Tabla de rutas'],
  },
  {
    name: 'Direcciones IP privadas y públicas',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Toda instancia tiene una IP privada (dentro de la VPC). La IP pública es opcional, cambia al parar/arrancar y se cobra por hora; la IP elástica es una pública fija.',
    details: `
- **Privada**: del rango de la subred; se conserva al parar la instancia.
- **Pública (auto-asignada)**: la traduce la internet gateway; se pierde al parar.
- **IP elástica (EIP)**: una pública que reservas y mantienes; si no está asociada, **se cobra**.
- Desde 2024, **toda IPv4 pública** tiene un coste por hora (≈ 0,005 USD/h). Las IPv6 no.

La IP pública **no sirve de nada** si la subred no tiene ruta a la internet gateway.
`,
    whenUse: ['IP elástica para un servidor que necesita una dirección fija (aunque suele ser mejor un balanceador o DNS)'],
    whenNot: ['No pongas IP pública a servidores internos'],
    pricing: 'Cada IPv4 pública cobra por hora, esté asociada o no.',
    seeAlso: ['IP elástica', 'Internet gateway', 'NAT gateway'],
  },
  {
    name: 'Internet gateway',
    kind: 'servicio',
    category: 'redes',
    level: 1,
    summary: 'La puerta de la VPC hacia internet. Es gratis, escala sola y se conecta a una sola VPC. Hace falta además una ruta 0.0.0.0/0 hacia ella y una IP pública en la instancia.',
    details: `
Para que una instancia sea accesible desde internet tienen que cumplirse **cuatro cosas**:

1. La VPC tiene una **internet gateway conectada** (attached).
2. La tabla de rutas de la subred envía \`0.0.0.0/0\` a la IGW.
3. La instancia tiene **IP pública** (o elástica).
4. El **security group** y la **NACL** lo permiten.

Si falta cualquiera, la conexión se queda esperando (_timeout_).
`,
    whenUse: ['Subredes públicas: balanceadores, bastiones, NAT gateways'],
    whenNot: ['Para dejar salir a internet a instancias privadas → NAT gateway', 'Para IPv6 solo de salida → egress-only internet gateway'],
    pricing: 'Gratis. Se paga la transferencia de datos hacia internet y las IP públicas.',
    scenario: 'red-igw',
    examples: [['aws ec2 describe-internet-gateways --query "InternetGateways[].[InternetGatewayId,Attachments[0].VpcId]" --output text', 'La segunda no está conectada a ninguna VPC']],
    seeAlso: ['aws ec2 create-internet-gateway', 'aws ec2 attach-internet-gateway', 'Tabla de rutas', 'NAT gateway'],
  },
  {
    name: 'Tabla de rutas',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'Lista de «destino → siguiente salto» que decide a dónde se envía cada paquete. Gana la ruta más específica (mayor prefijo). Toda tabla tiene la ruta «local».',
    details: `
\`\`\`
Destino         Siguiente salto
10.0.0.0/16     local          ← tráfico dentro de la VPC (siempre existe)
0.0.0.0/0       igw-0123…      ← el resto, a internet
\`\`\`

- Si varias rutas coinciden, **gana la de prefijo más largo** (la más específica).
- **Principal (main)**: la que usan las subredes sin asociación explícita. Conviene dejarla **sin salida a internet** (segura por defecto) y crear tablas propias para las públicas.
- Una ruta cuyo destino ya no existe (IGW desconectada, NAT borrado) queda como **\`blackhole\`**.
`,
    whenUse: ['Una tabla pública (ruta a la IGW) y otra privada (ruta al NAT) por VPC'],
    whenNot: ['No añadas 0.0.0.0/0 → IGW a la tabla principal: todas las subredes nuevas serían públicas'],
    scenario: 'red-ok',
    examples: [['aws ec2 describe-route-tables --filters Name=vpc-id,Values=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=produccion --query "Vpcs[0].VpcId" --output text) --query "RouteTables[].[Tags[0].Value,Routes[].DestinationCidrBlock|join(\',\',@)]" --output text']],
    seeAlso: ['aws ec2 create-route-table', 'aws ec2 create-route', 'aws ec2 associate-route-table', 'Subred pública y privada'],
  },
  {
    name: 'NAT gateway',
    kind: 'servicio',
    category: 'redes',
    level: 1,
    summary: 'Deja salir a internet a las instancias de subredes privadas (actualizaciones, APIs) sin que internet pueda entrar. Vive en una subred PÚBLICA y cobra por hora y por GB.',
    details: `
- Se crea en una **subred pública** y necesita una **IP elástica**.
- Las subredes privadas apuntan a él con \`0.0.0.0/0 → nat-…\`.
- Es **por zona**: para alta disponibilidad, uno por zona (y cada subred privada usa el de su zona).
- Es de los servicios que **más sorprenden en la factura**: ≈ 0,045 USD/hora (unos 33 USD al mes) **más** 0,045 USD por GB procesado, aunque no tenga tráfico.

Alternativas más baratas: **VPC endpoints** (para S3 y DynamoDB, gratis; para otros, de interfaz) si el tráfico va hacia servicios de AWS.
`,
    whenUse: ['Servidores privados que necesitan descargar parches o llamar a APIs externas'],
    whenNot: ['Si solo hablan con S3/DynamoDB → gateway endpoint (gratis)', 'En entornos de desarrollo que nadie usa de noche: bórralo o apágalo con el entorno'],
    pricing: 'Por hora de existencia + por GB procesado. Además, el tráfico entre zonas si la subred privada usa un NAT de otra zona.',
    limits: ['5 NAT gateway por zona por defecto', 'Hasta 55 000 conexiones simultáneas por IP de destino'],
    scenario: 'factura',
    examples: [['aws ec2 describe-nat-gateways --query "NatGateways[].[NatGatewayId,State,SubnetId,NatGatewayAddresses[0].PublicIp]" --output table'], ['aws ec2 describe-addresses --query "Addresses[].[PublicIp,AllocationId,AssociationId]" --output table', 'La IP elástica de un NAT sigue cobrando si borras el NAT y no la liberas']],
    seeAlso: ['aws ec2 create-nat-gateway', 'Subred pública y privada', 'IP elástica'],
  },
  {
    name: 'NACL',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Lista de reglas numeradas (permitir/denegar) que filtra el tráfico que entra y sale de una SUBRED. No tiene estado: hay que permitir también la respuesta.',
    details: `
- Se aplica a **toda la subred** (todas sus instancias).
- Las reglas se evalúan **de menor a mayor número**; la primera que coincide gana. La regla final \`*\` deniega todo.
- **Sin estado (_stateless_)**: si permites la entrada del puerto 80, tienes que permitir también la salida de los **puertos efímeros (1024–65535)** para la respuesta.
- La NACL por defecto de la VPC permite todo; una NACL nueva **lo deniega todo** hasta que añades reglas.

Se usa como segunda capa, sobre todo para **bloquear** direcciones concretas (algo que un security group no puede: solo permite).
`,
    whenUse: ['Bloquear una IP o un rango abusivo', 'Cumplimiento que exige filtrado a nivel de subred'],
    whenNot: ['Para el control normal del acceso a una instancia → security group (más sencillo y con estado)'],
    scenario: 'red-nacl',
    examples: [[`aws ec2 describe-network-acls --filters Name=tag:Name,Values=nacl-publica --query 'NetworkAcls[0].Entries[?Egress==\`false\`].[RuleNumber,RuleAction,Protocol,CidrBlock]' --output table`, 'La regla 90 deniega el puerto 80 antes de que llegue la 100 que permite todo']],
    seeAlso: ['Security group frente a NACL', 'Security group', 'aws ec2 create-network-acl-entry'],
  },
  {
    name: 'Security group frente a NACL',
    kind: 'comparativa',
    category: 'redes',
    level: 2,
    summary: 'El security group protege la instancia, recuerda las conexiones y solo permite. La NACL protege la subred, no recuerda nada y puede permitir y denegar.',
    details: `
| | Security group | NACL |
| --- | --- | --- |
| Se aplica a | Instancia (interfaz de red) | Subred entera |
| Estado | **Con estado**: la respuesta vuelve sola | **Sin estado**: hay que permitir la ida y la vuelta |
| Reglas | Solo **permitir** | Permitir y **denegar** |
| Evaluación | Todas las reglas a la vez | Por número, la primera que coincide |
| Origen/destino | CIDR o **otro security group** | Solo CIDR |
| Por defecto | Todo entrante denegado, todo saliente permitido | La de por defecto permite todo |

**Orden de un paquete que entra desde internet**: IGW → tabla de rutas → NACL (entrada) → security group (entrada) → instancia → respuesta: security group (automática) → NACL (salida).
`,
    whenUse: ['Security groups para todo el control normal; NACL como capa extra o para bloquear IP'],
    whenNot: ['No dupliques las mismas reglas en ambos «por si acaso»: es la causa típica de «no sé por qué no llega»'],
    seeAlso: ['Security group', 'NACL', 'Tabla de rutas'],
  },
  {
    name: 'Route 53',
    kind: 'servicio',
    category: 'redes',
    level: 1,
    summary: 'El DNS de AWS: traduce nombres (www.ejemplo.com) en direcciones, y puede además elegir la respuesta según salud, latencia o geografía. Disponibilidad del 100 %.',
    details: `
Tres funciones: **registrar dominios**, **resolver nombres** (zonas alojadas con sus registros) y **comprobar la salud** de los destinos para dejar de enviar tráfico a los que caen.

Una **zona alojada** (_hosted zone_) contiene los registros de un dominio. Puede ser **pública** (visible en internet) o **privada** (solo dentro de tus VPC).

Políticas de enrutamiento (se estudian en la zona de alta disponibilidad): simple, ponderada, por latencia, por conmutación (_failover_), por geolocalización…
`,
    whenUse: ['Poner nombre a tus aplicaciones y balanceadores', 'Dominios internos privados (por ejemplo, bd.interno)'],
    whenNot: ['Para repartir carga entre servidores dentro de la VPC → un balanceador (ELB)'],
    pricing: '0,50 USD al mes por zona alojada y una pequeña cantidad por millón de consultas (las consultas a registros «alias» hacia recursos de AWS son gratis).',
    scenario: 'dns-demo',
    examples: [['aws route53 list-hosted-zones --query "HostedZones[].[Name,ResourceRecordSetCount]" --output text'], ['dig +short www.ejemplo.com']],
    seeAlso: ['Registros DNS', 'aws route53 create-hosted-zone', 'aws route53 change-resource-record-sets', 'CloudFront'],
  },
  {
    name: 'Registros DNS',
    kind: 'concepto',
    category: 'redes',
    level: 1,
    summary: 'A (nombre → IPv4), AAAA (IPv6), CNAME (nombre → otro nombre), MX (correo), TXT (texto/verificaciones), NS (servidores de la zona) y el «alias» propio de Route 53.',
    details: `
| Tipo | Para qué |
| --- | --- |
| **A** / **AAAA** | Nombre → dirección IPv4 / IPv6 |
| **CNAME** | Un nombre es un apodo de otro. **No se puede en el ápice** (ejemplo.com) ni junto a otros registros del mismo nombre |
| **MX** | Servidores de correo, con prioridad |
| **TXT** | Texto libre: verificación de dominio, SPF, DKIM… |
| **NS** / **SOA** | Los crea Route 53 al crear la zona |
| **Alias** | Registro especial de Route 53: apunta a un recurso de AWS (CloudFront, balanceador, sitio web de S3…). **Gratis**, funciona en el ápice y sigue los cambios de IP |

El **TTL** indica cuántos segundos pueden guardar la respuesta las cachés: TTL bajo = cambios rápidos, más consultas.
`,
    whenUse: ['Alias para apuntar el dominio raíz a CloudFront o a un balanceador', 'TTL bajo antes de una migración'],
    whenNot: ['No uses CNAME en el ápice (da error): usa un alias'],
    scenario: 'dns-demo',
    examples: [['aws route53 list-resource-record-sets --hosted-zone-id $(aws route53 list-hosted-zones --query "HostedZones[0].Id" --output text) --query "ResourceRecordSets[].[Name,Type,TTL]" --output table'], ['dig +short ejemplo.com MX']],
    seeAlso: ['Route 53', 'aws route53 change-resource-record-sets'],
  },
  {
    name: 'CloudFront',
    kind: 'servicio',
    category: 'redes',
    level: 1,
    summary: 'Red de distribución de contenido (CDN): guarda copias de tu web, imágenes y vídeos en cientos de ubicaciones de borde, cerca de los usuarios. Menos latencia, menos carga en el origen y HTTPS fácil.',
    details: `
Los usuarios piden el contenido a la **edge location** más cercana. Si la tiene en caché, la responde al instante; si no, la pide al **origen** (un bucket de S3, un balanceador, un servidor web…) y la guarda.

- **HTTPS** gratuito con certificados de ACM y dominio propio.
- **OAC** (_Origin Access Control_): permite que **solo CloudFront** lea un bucket de S3 privado.
- Protección: integra **WAF** y **Shield** (anti-DDoS).
- Invalidaciones para renovar contenido antes de que caduque la caché.
`,
    whenUse: ['Webs estáticas y aplicaciones con usuarios repartidos por el mundo', 'Servir S3 sin hacerlo público', 'Reducir la carga del origen'],
    whenNot: ['Contenido que cambia en cada petición y no se puede cachear (se puede usar, pero gana poco)', 'Tráfico solo interno de una VPC'],
    pricing: 'Por GB transferido hacia los usuarios y por millón de peticiones. Hay una capa gratuita mensual generosa. Más barato que sacar datos directamente desde S3 o EC2.',
    versus: [['CloudFront frente a Global Accelerator', 'CloudFront cachea contenido en el borde. Global Accelerator no cachea: dirige el tráfico TCP/UDP por la red de AWS a tus endpoints (útil para aplicaciones dinámicas y juegos).']],
    seeAlso: ['Edge location', 'Sitio web estático en S3', 'Route 53'],
  },
  {
    name: 'aws ec2 create-vpc',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea una VPC con el CIDR indicado (de /16 a /28). Nace con tabla de rutas principal, NACL y security group por defecto, pero sin subredes ni salida a internet.',
    usage: 'aws ec2 create-vpc --cidr-block 10.0.0.0/16 [--tag-specifications \'ResourceType=vpc,Tags=[{Key=Name,Value=mi-vpc}]\']',
    scenario: 'base',
    examples: [
      ["aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=ejemplo}]' --query Vpc.VpcId --output text"],
      ['aws ec2 create-vpc --cidr-block 10.0.0.0/8', 'Una /8 es demasiado grande: el máximo es /16', 'error'],
    ],
    seeAlso: ['VPC', 'CIDR', 'aws ec2 create-subnet'],
  },
  {
    name: 'aws ec2 create-subnet',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea una subred dentro de una VPC: CIDR (dentro del de la VPC y sin solapes) y zona de disponibilidad.',
    usage: 'aws ec2 create-subnet --vpc-id <vpc> --cidr-block 10.0.1.0/24 --availability-zone us-east-1a',
    details: 'Sin `--availability-zone`, AWS elige una. Para que las instancias reciban IP pública al lanzarse: `aws ec2 modify-subnet-attribute --subnet-id <id> --map-public-ip-on-launch`.',
    scenario: 'red-ok',
    examples: [
      [VPC_ID],
      ['aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.10.0/24 --availability-zone us-east-1b --query Subnet.SubnetId --output text'],
      ['aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.10.128/25', 'Se solapa con la subred anterior', 'error'],
    ],
    seeAlso: ['Subred', 'CIDR', 'aws ec2 create-vpc'],
  },
  {
    name: 'aws ec2 create-internet-gateway',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea una internet gateway (todavía suelta: hay que conectarla a una VPC).',
    usage: 'aws ec2 create-internet-gateway [--tag-specifications …]',
    scenario: 'base',
    examples: [['aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text']],
    seeAlso: ['Internet gateway', 'aws ec2 attach-internet-gateway'],
  },
  {
    name: 'aws ec2 attach-internet-gateway',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Conecta una internet gateway a una VPC. Una VPC solo admite una, y una IGW solo está en una VPC.',
    usage: 'aws ec2 attach-internet-gateway --internet-gateway-id <igw> --vpc-id <vpc>',
    scenario: 'red-igw',
    examples: [
      [VPC_ID],
      ["IGW=$(aws ec2 describe-internet-gateways --query 'InternetGateways[?length(Attachments)==`0`].InternetGatewayId' --output text)"],
      ['aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC'],
      ['aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC', 'Ya está conectada', 'error'],
    ],
    seeAlso: ['Internet gateway', 'aws ec2 create-internet-gateway', 'aws ec2 create-route'],
  },
  {
    name: 'aws ec2 create-route-table',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea una tabla de rutas vacía (solo con la ruta «local») en una VPC. Después se le añaden rutas y se asocia a subredes.',
    usage: 'aws ec2 create-route-table --vpc-id <vpc> [--tag-specifications …]',
    scenario: 'red-ruta',
    examples: [[VPC_ID], ['aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text']],
    seeAlso: ['Tabla de rutas', 'aws ec2 create-route', 'aws ec2 associate-route-table'],
  },
  {
    name: 'aws ec2 create-route',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Añade una ruta a una tabla: `--destination-cidr-block` va a una internet gateway (`--gateway-id`) o a un NAT (`--nat-gateway-id`).',
    usage: 'aws ec2 create-route --route-table-id <rtb> --destination-cidr-block 0.0.0.0/0 --gateway-id <igw>',
    details: 'Para cambiar el destino de una ruta que ya existe: `replace-route`. Para quitarla: `delete-route`.',
    scenario: 'red-ruta',
    examples: [
      [VPC_ID],
      ['RTB=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC Name=association.main,Values=true --query "RouteTables[0].RouteTableId" --output text)'],
      ["IGW=$(aws ec2 describe-internet-gateways --filters Name=attachment.vpc-id,Values=$VPC --query 'InternetGateways[0].InternetGatewayId' --output text)"],
      ['aws ec2 create-route --route-table-id $RTB --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW'],
      ['aws ec2 create-route --route-table-id $RTB --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW', 'Esa ruta ya existe', 'error'],
    ],
    seeAlso: ['Tabla de rutas', 'aws ec2 create-route-table', 'Internet gateway'],
  },
  {
    name: 'aws ec2 associate-route-table',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Asocia una tabla de rutas a una subred (una subred solo tiene una tabla). Sin asociación, la subred usa la tabla principal.',
    usage: 'aws ec2 associate-route-table --route-table-id <rtb> --subnet-id <subnet>',
    scenario: 'red-ruta',
    examples: [
      [VPC_ID],
      ['RTB=$(aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text)'],
      ['SN=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].SubnetId" --output text)'],
      ['aws ec2 associate-route-table --route-table-id $RTB --subnet-id $SN'],
    ],
    seeAlso: ['Tabla de rutas', 'aws ec2 create-route-table'],
  },
  {
    name: 'aws ec2 describe-route-tables',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Lista las tablas de rutas con sus rutas y asociaciones. Con `--filters Name=association.subnet-id,Values=…` ves la de una subred.',
    usage: 'aws ec2 describe-route-tables [--filters Name=vpc-id,Values=<vpc>]',
    scenario: 'red-ok',
    examples: [[VPC_ID], ['aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC --query "RouteTables[].[RouteTableId,Associations[0].Main,length(Routes)]" --output table']],
    seeAlso: ['Tabla de rutas'],
  },
  {
    name: 'aws ec2 create-nat-gateway',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea un NAT gateway público en una subred pública, con una IP elástica. Tarda un poco en pasar de `pending` a `available`.',
    usage: 'aws ec2 create-nat-gateway --subnet-id <subred-publica> --allocation-id <eipalloc>',
    scenario: 'red-ok',
    examples: [
      ['ALLOC=$(aws ec2 allocate-address --query AllocationId --output text)'],
      ['SN=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].SubnetId" --output text)'],
      ['aws ec2 create-nat-gateway --subnet-id $SN --allocation-id $ALLOC --query NatGateway.[NatGatewayId,State] --output text'],
    ],
    seeAlso: ['NAT gateway', 'IP elástica', 'aws ec2 create-route'],
  },
  {
    name: 'aws ec2 create-network-acl-entry',
    kind: 'comando',
    category: 'redes',
    level: 2,
    summary: 'Añade una regla a una NACL: número, protocolo, puerto, CIDR y permitir/denegar, de entrada (`--ingress`) o de salida (`--egress`).',
    usage: 'aws ec2 create-network-acl-entry --network-acl-id <acl> --ingress --rule-number 100 --protocol tcp --port-range From=80,To=80 --cidr-block 0.0.0.0/0 --rule-action allow',
    scenario: 'red-nacl',
    examples: [
      ['ACL=$(aws ec2 describe-network-acls --filters Name=tag:Name,Values=nacl-publica --query "NetworkAcls[0].NetworkAclId" --output text)'],
      ['aws ec2 create-network-acl-entry --network-acl-id $ACL --ingress --rule-number 95 --protocol tcp --port-range From=22,To=22 --cidr-block 0.0.0.0/0 --rule-action deny'],
      ['aws ec2 create-network-acl-entry --network-acl-id $ACL --ingress --rule-number 95 --protocol tcp --port-range From=23,To=23 --cidr-block 0.0.0.0/0 --rule-action deny', 'El número 95 ya está en uso en la entrada', 'error'],
    ],
    seeAlso: ['NACL', 'Security group frente a NACL'],
  },
  {
    name: 'aws route53 create-hosted-zone',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea una zona alojada para un dominio. Devuelve sus 4 servidores de nombres, que hay que configurar en el registrador del dominio.',
    usage: 'aws route53 create-hosted-zone --name ejemplo.org --caller-reference <texto-unico>',
    details: '`--caller-reference` es un texto único que evita crear la zona dos veces si repites la orden por error.',
    scenario: 'base',
    examples: [['aws route53 create-hosted-zone --name mi-empresa.com --caller-reference ref-001 --query DelegationSet.NameServers --output text']],
    seeAlso: ['Route 53', 'Registros DNS', 'aws route53 change-resource-record-sets'],
  },
  {
    name: 'aws route53 change-resource-record-sets',
    kind: 'comando',
    category: 'redes',
    level: 1,
    summary: 'Crea (`CREATE`), reemplaza o crea (`UPSERT`) o borra (`DELETE`) registros DNS en una zona, con un lote de cambios en JSON.',
    usage: 'aws route53 change-resource-record-sets --hosted-zone-id <id> --change-batch file://cambios.json',
    details: `
\`\`\`
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
  "Name":"www.ejemplo.com","Type":"A","TTL":300,
  "ResourceRecords":[{"Value":"203.0.113.10"}]}}]}
\`\`\`

**UPSERT** es lo más cómodo: crea el registro si no existe y lo actualiza si existe. Los cambios son atómicos (todo o nada).
`,
    scenario: 'dns-demo',
    examples: [
      ['ZONE=$(aws route53 list-hosted-zones --query "HostedZones[0].Id" --output text)'],
      [`aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"api.ejemplo.com","Type":"A","TTL":60,"ResourceRecords":[{"Value":"203.0.113.20"}]}}]}'`],
      ['dig +short api.ejemplo.com'],
      [`aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch '{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"ejemplo.com","Type":"CNAME","TTL":60,"ResourceRecords":[{"Value":"www.ejemplo.com"}]}}]}'`, 'Un CNAME en el ápice no se permite', 'error'],
    ],
    seeAlso: ['Registros DNS', 'Route 53', 'aws route53 create-hosted-zone'],
  },
];
