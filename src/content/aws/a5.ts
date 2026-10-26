import { A, all, awsIs, awsWorld, demo, fill, illus, learn, lesson, match, mc, multi, order, out, practice, predict, ran, tf, typeCmd } from './awsbuild';

const VPC_PROD = 'VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=produccion --query "Vpcs[0].VpcId" --output text)';
const SUBNET = (name: string, v: string) => `${v}=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=${name} --query "Subnets[0].SubnetId" --output text)`;
const WEB_OK = awsIs('_check trace --from internet --to web-prod --port 80 --query Reachable', true, 'La web todavía no responde desde internet');
const PRIV_OK = awsIs('_check trace --from app-privada --to internet --port 443 --query Reachable', true, 'La instancia privada todavía no puede salir a internet');
const CNAME_CHANGE = (zone: string, rec: string) => `aws route53 change-resource-record-sets --hosted-zone-id ${zone} --change-batch '${rec}'`;
const ZONE = 'ZONE=$(aws route53 list-hosted-zones --query "HostedZones[0].Id" --output text)';
const upsertA = (name: string, ip: string) => CNAME_CHANGE('$ZONE', `{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"${name}","Type":"A","TTL":300,"ResourceRecords":[{"Value":"${ip}"}]}}]}`);

export const a5 = awsWorld({
  id: 'a5',
  index: 5,
  title: 'Redes: VPC básico',
  subtitle: 'Tu red privada en la nube',
  emoji: '🌐',
  color: '#818CF8',
  level: 'basico',
  intro:
    'Casi todo lo que lanzas en AWS vive dentro de una **VPC**: tu red privada virtual. Aquí aprenderás a repartir direcciones IP con CIDR, a crear subredes públicas y privadas, a conectarlas a internet (o no), a leer una tabla de rutas y a diagnosticar el clásico «¿por qué no llega el paquete?» recorriendo, uno por uno, los controles por los que pasa: internet gateway, rutas, NACL y security group. Termina con DNS (Route 53) y CDN (CloudFront).',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a5-1', { title: 'IP, CIDR y subredes', summary: 'Repartir direcciones sin quedarte corto ni solapar redes', emoji: '🧮', commands: ['CIDR', 'ipcalc', 'Subred', 'aws ec2 create-vpc', 'aws ec2 create-subnet'], minutes: 14 }, [
      learn(
        'Direcciones IP y redes',
        `
Cada equipo de una red tiene una **dirección IP** (IPv4: cuatro números de 0 a 255, 32 bits en total, por ejemplo \`10.0.1.25\`). Las direcciones se agrupan en **redes**, y una red se escribe en notación **CIDR**:

\`\`\`
10.0.0.0/16
\`\`\`

El número tras la barra dice **cuántos de los 32 bits son fijos** (identifican la red). Los que quedan libres son para los equipos:

- \`/16\` → 16 bits libres → 2¹⁶ = **65 536** direcciones.
- \`/24\` → 8 bits libres → 2⁸ = **256** direcciones.
- \`/28\` → 4 bits libres → 2⁴ = **16** direcciones.

**Más barra = red más pequeña.** Una VPC admite desde **/16** (la mayor) hasta **/28** (la menor).
`,
        '🧮',
      ),
      mc('¿Cuántas direcciones tiene la red `10.0.1.0/24`?', ['24', '254 utilizables, 256 en total', '1 024', '65 536'], 1, 'Quedan 32 − 24 = 8 bits libres: 2⁸ = 256 direcciones (254 si descontamos las de red y difusión, como hace una red tradicional).'),
      illus('aws-cidr-calc', 'Calculadora de CIDR', 'Cambia el prefijo y mira cómo cambian el tamaño, el rango y las direcciones que AWS reserva.'),
      match(
        'Une cada prefijo con su número de direcciones',
        [
          ['/16', '65 536'],
          ['/24', '256'],
          ['/28', '16'],
          ['/32', '1'],
        ],
        'Cada bit que añades al prefijo divide la red por la mitad: /16 → /17 → /18…',
      ),
      learn(
        'Rangos privados y las 5 direcciones que AWS se queda',
        `
En una VPC solo debes usar rangos **privados** (RFC 1918):

| Rango | Tamaño |
| --- | --- |
| \`10.0.0.0/8\` | 16 millones |
| \`172.16.0.0/12\` | 1 millón |
| \`192.168.0.0/16\` | 65 536 |

Y una regla de examen: **en cada subred AWS reserva 5 direcciones** (en una /24: \`.0\` red, \`.1\` router de la VPC, \`.2\` DNS, \`.3\` uso futuro y \`.255\` difusión). Por eso una **/28 tiene 16 − 5 = 11 utilizables**.
`,
        '🔒',
      ),
      demo(
        'Calcular antes de crear',
        [
          ['ipcalc 10.0.0.0/16', 'La VPC entera: 65 534 hosts (65 531 en AWS)'],
          ['ipcalc 10.0.1.0/24', 'Una subred típica'],
          ['ipcalc 10.0.1.0/28', 'La más pequeña: 14 hosts de ipcalc… y 11 en AWS'],
          ['ipcalc 10.0.2.0/23 | grep Hosts', 'Una /23 equivale a dos /24 juntas: 510 hosts'],
        ],
        A('base'),
      ),
      predict('¿Qué número de «hosts» calcula `ipcalc` para una red /28?', 'ipcalc 10.0.1.0/28 | grep Hosts | awk \'{print $2}\'', ['16', '11', '15'], 'ipcalc descuenta la dirección de red y la de difusión: 16 − 2 = 14. AWS descuenta además 3 más: 11 utilizables.', A('base')),
      mc('¿Cuántas direcciones IP puedes usar de verdad en una subred /24 de AWS?', ['256', '254', '251', '250'], 2, '256 − 5 reservadas por AWS = 251.'),
      tf('«Dos subredes de la misma VPC pueden tener CIDR que se solapen si están en zonas de disponibilidad distintas.»', false, 'Los CIDR de las subredes de una VPC no pueden solaparse, estén donde estén. AWS lo rechaza con `InvalidSubnet.Conflict`.'),
      fill('Completa', 'Una subred /28 tiene ___ direcciones, de las que en AWS solo son utilizables ___.', ['16', '11', '14', '5'], ['16', '11'], '16 en total y 11 utilizables (se reservan 5).'),
      typeCmd('Escribe el comando que calcula los datos de la red `10.0.8.0/21`.', ['ipcalc 10.0.8.0/21'], '`ipcalc` recibe el CIDR completo.', { setup: A('base'), check: all(ran('ipcalc'), out('Network:   10.0.8.0/21')), regex: '^ipcalc 10\\.0\\.8\\.0/21$' }),
      practice({
        prompt:
          'Crea la red de la aplicación en **us-east-1**:\n\n1. Una VPC con la etiqueta `Name=produccion` y CIDR **10.0.0.0/16**.\n2. Una subred **10.0.1.0/24** en **us-east-1a**.\n3. Otra subred **10.0.2.0/24** en **us-east-1b**.\n\n(Etiqueta de ejemplo: `--tag-specifications \'ResourceType=vpc,Tags=[{Key=Name,Value=produccion}]\'`)',
        goal: 'VPC produccion con dos subredes en dos zonas',
        setup: A('base'),
        check: all(
          awsIs('ec2 describe-vpcs --filters Name=tag:Name,Values=produccion --query "Vpcs[].CidrBlock"', ['10.0.0.0/16'], 'Falta la VPC produccion 10.0.0.0/16'),
          awsIs('ec2 describe-subnets --filters Name=cidr-block,Values=10.0.1.0/24,10.0.2.0/24 --query "Subnets[].join(\':\',[CidrBlock,AvailabilityZone])|sort(@)"', ['10.0.1.0/24:us-east-1a', '10.0.2.0/24:us-east-1b'], 'Faltan las subredes 10.0.1.0/24 (us-east-1a) y 10.0.2.0/24 (us-east-1b)'),
        ),
        solution: [
          "VPC=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=produccion}]' --query Vpc.VpcId --output text)",
          'aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.1.0/24 --availability-zone us-east-1a',
          'aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.2.0/24 --availability-zone us-east-1b',
        ],
        hints: ['`aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications …` te devuelve el `VpcId`: guárdalo con `--query Vpc.VpcId --output text`.', '`aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.1.0/24 --availability-zone us-east-1a`', 'Repite con 10.0.2.0/24 en us-east-1b.'],
        explain: 'Dos subredes en dos zonas es la base de cualquier arquitectura de alta disponibilidad. Si una zona falla, la otra sigue funcionando.',
        par: 3,
        commands: ['aws ec2 create-vpc', 'aws ec2 create-subnet'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a5-2', { title: 'VPC, subredes públicas y privadas e Internet Gateway', summary: 'Qué hace «pública» a una subred', emoji: '🚪', commands: ['VPC', 'VPC por defecto', 'Subred pública y privada', 'Internet gateway', 'aws ec2 create-internet-gateway', 'aws ec2 attach-internet-gateway'], minutes: 14 }, [
      learn(
        'Tu VPC: una red privada dentro de AWS',
        `
Una **VPC** es tu red virtual aislada. Dentro defines:

- el **rango de IP** (CIDR) y las **subredes** (cada una en una zona);
- las **rutas** (a dónde va el tráfico);
- los **firewalls**: security groups (por instancia) y NACL (por subred);
- las **puertas** al exterior: internet gateway, NAT gateway, VPN…

Cada región trae una **VPC por defecto** (\`172.31.0.0/16\`) con una subred por zona, todas **públicas**, para que lanzar una instancia sea inmediato. Es cómoda para aprender y mala idea para producción: todo nace expuesto. En producción se crea una VPC propia.
`,
        '🌐',
      ),
      mc('¿Qué es la «VPC por defecto»?', ['Una VPC de AWS compartida por todos los clientes', 'Una VPC con subredes públicas que AWS crea en cada región de tu cuenta', 'La VPC más segura que existe', 'Una VPC que no se puede borrar'], 1, 'Es tuya (de tu cuenta), una por región, creada para empezar rápido. Se puede borrar y recrear.'),
      learn(
        'Pública o privada: lo decide la ruta',
        `
No hay un ajuste «esta subred es pública». Una subred es **pública** cuando su **tabla de rutas** tiene una ruta \`0.0.0.0/0\` hacia una **internet gateway** (IGW). Si no la tiene, es **privada**.

Para que una instancia sea alcanzable desde internet deben cumplirse **cuatro cosas**:

1. La VPC tiene una **IGW conectada**.
2. La subred tiene **ruta** \`0.0.0.0/0 → IGW\`.
3. La instancia tiene una **IP pública** (o elástica).
4. El **security group** (y la NACL) permiten el puerto.

Si falla una, la petición se queda esperando hasta caducar: es el síntoma típico de «no llega».
`,
        '🚪',
      ),
      illus('aws-vpc-layout', 'Una VPC de dos zonas', 'Toca cada elemento: verás qué es, qué lo conecta y si su subred es pública o privada.'),
      mc('¿Qué convierte a una subred en «pública»?', ['Que su CIDR empiece por 10.', 'Que su tabla de rutas tenga una ruta 0.0.0.0/0 hacia una internet gateway', 'Que tenga muchas direcciones libres', 'Que esté en la primera zona de disponibilidad'], 1, 'La ruta a la IGW es lo único que distingue una subred pública de una privada.'),
      demo(
        'Crear una VPC y darle puerta a internet',
        [
          ["VPC=$(aws ec2 create-vpc --cidr-block 10.20.0.0/16 --query Vpc.VpcId --output text)", 'Una VPC nueva'],
          ['aws ec2 describe-internet-gateways --query "InternetGateways[].[InternetGatewayId,Attachments[0].VpcId]" --output text', 'Solo existe la de la VPC por defecto'],
          ['IGW=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text)', 'Creamos una internet gateway: aún no está conectada a nada'],
          ['aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC', 'La conectamos a nuestra VPC'],
          ['aws ec2 describe-internet-gateways --internet-gateway-ids $IGW --query "InternetGateways[0].Attachments[0].[VpcId,State]" --output text', 'Ahora está «available» en nuestra VPC'],
          ['aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC', 'No se puede conectar dos veces', 'error'],
        ],
        A('base'),
      ),
      multi('Marca **todo** lo que hace falta para llegar por internet a una instancia de tu VPC.', ['Una internet gateway conectada a la VPC', 'Una ruta 0.0.0.0/0 hacia la IGW en la subred', 'Una IP pública (o elástica) en la instancia', 'Una regla del security group para el puerto', 'Un NAT gateway', 'Un par de claves SSH'], [0, 1, 2, 3], 'El NAT gateway es para la salida de instancias privadas, y el par de claves solo importa para entrar por SSH. Para llegar a una web bastan los cuatro primeros.'),
      tf('«Una internet gateway puede estar conectada a varias VPC a la vez.»', false, 'Una IGW se conecta a una sola VPC (y una VPC solo admite una IGW).'),
      order('Ordena los pasos para dar internet a una VPC nueva', ['create-vpc', 'create-internet-gateway', 'attach-internet-gateway', 'create-route'], 'create-vpc create-internet-gateway attach-internet-gateway create-route', 'La IGW hay que conectarla antes de poder usarla como destino de una ruta.', ['create-internet-gateway create-vpc attach-internet-gateway create-route']),
      practice({
        prompt: 'La web de producción no responde. La VPC `produccion` tiene una internet gateway (`igw-produccion`), pero **no está conectada** a ninguna VPC. **Conéctala** a la VPC `produccion`.\n\n(Todavía no responderá: la tabla de rutas la arreglaremos en la siguiente lección.)',
        goal: 'igw-produccion conectada a produccion',
        setup: A('red-igw'),
        check: awsIs('ec2 describe-internet-gateways --filters Name=tag:Name,Values=igw-produccion --query "InternetGateways[0].Attachments[0].State"', 'available', 'igw-produccion todavía no está conectada'),
        solution: [VPC_PROD, 'IGW=$(aws ec2 describe-internet-gateways --filters Name=tag:Name,Values=igw-produccion --query "InternetGateways[0].InternetGatewayId" --output text)', 'aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC'],
        hints: ['Necesitas dos ids: el de la VPC y el de la IGW (búscalos con `describe-vpcs` y `describe-internet-gateways`).', '`aws ec2 attach-internet-gateway --internet-gateway-id <igw> --vpc-id <vpc>`'],
        explain: 'Una IGW sin conectar no sirve de nada. Ya tenemos el paso 1 de 4; falta la ruta.',
        par: 3,
        commands: ['aws ec2 attach-internet-gateway'],
      }),
      practice({
        prompt: 'Crea una VPC **10.30.0.0/16** con etiqueta `Name=laboratorio`, **crea una internet gateway y conéctala** a ella.',
        goal: 'VPC laboratorio con IGW conectada',
        setup: A('base'),
        check: all(
          awsIs('ec2 describe-vpcs --filters Name=tag:Name,Values=laboratorio --query "Vpcs[].CidrBlock"', ['10.30.0.0/16'], 'Falta la VPC laboratorio'),
          awsIs('ec2 describe-internet-gateways --query "length(InternetGateways[?length(Attachments)==`1`])"', 2, 'La internet gateway nueva debe estar conectada (además de la de la VPC por defecto)'),
        ),
        solution: [
          "VPC=$(aws ec2 create-vpc --cidr-block 10.30.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=laboratorio}]' --query Vpc.VpcId --output text)",
          'IGW=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text)',
          'aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC',
        ],
        hints: ['Tres órdenes: `create-vpc`, `create-internet-gateway` y `attach-internet-gateway`.', 'Guarda los ids con `--query … --output text` y úsalos como `$VPC` y `$IGW`.'],
        explain: 'Esa es la receta básica. En la próxima lección añadiremos la ruta que la hace útil.',
        par: 3,
        commands: ['aws ec2 create-internet-gateway'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a5-3', { title: 'Tablas de rutas y NAT', summary: 'Subredes públicas, privadas y cómo salen a internet', emoji: '🗺️', commands: ['Tabla de rutas', 'NAT gateway', 'aws ec2 create-route-table', 'aws ec2 create-route', 'aws ec2 associate-route-table', 'aws ec2 create-nat-gateway', 'aws ec2 describe-route-tables'], minutes: 16 }, [
      learn(
        'Cómo decide una tabla de rutas',
        `
Una **tabla de rutas** es una lista de «destino → siguiente salto». Para cada paquete, la VPC mira **la ruta más específica** (la de prefijo más largo) que coincide con la dirección de destino:

\`\`\`
Destino        Siguiente salto
10.0.0.0/16    local        ← dentro de la VPC (siempre existe)
0.0.0.0/0      igw-0a1b…    ← todo lo demás, a internet
\`\`\`

- Un paquete para \`10.0.1.5\` coincide con las dos, pero gana \`10.0.0.0/16\` (más específica): va por la ruta **local**.
- Un paquete para \`93.184.216.34\` solo coincide con \`0.0.0.0/0\`: sale por la IGW.
`,
        '🗺️',
      ),
      mc('Una subred tiene estas rutas: `10.0.0.0/16 → local` y `0.0.0.0/0 → igw-…`. ¿Por dónde sale un paquete hacia `10.0.2.77`?', ['Por la internet gateway', 'Por la ruta local', 'Se descarta', 'Por el NAT gateway'], 1, 'Gana la ruta más específica: `10.0.0.0/16` (local), no `0.0.0.0/0`.', '10.0.0.0/16   local\n0.0.0.0/0     igw-0a1b2c'),
      learn(
        'Tabla principal y tablas personalizadas',
        `
- La tabla **principal** es la que usan las subredes que no tienen otra asociada. Conviene dejarla **solo con la ruta local** (segura por defecto).
- Para una subred pública se crea una tabla **propia** con \`0.0.0.0/0 → IGW\` y se **asocia** a esa subred.
- Para una privada, otra con \`0.0.0.0/0 → NAT gateway\` (si necesita salir) o sin salida alguna.
- Una ruta cuyo destino ha desaparecido (IGW desconectada, NAT borrado) queda como **\`blackhole\`**: no es un error, pero tampoco funciona.
`,
        '🧭',
      ),
      demo(
        'Leer las rutas de una VPC real',
        [
          [VPC_PROD, 'Buscamos la VPC `produccion`'],
          ['aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC --query "RouteTables[].[Tags[0].Value,Associations[0].Main,length(Routes)]" --output table', 'Dos tablas: la principal (sin etiqueta) y `rt-publica`'],
          ['aws ec2 describe-route-tables --filters Name=tag:Name,Values=rt-publica --query "RouteTables[0].Routes[].[DestinationCidrBlock,State]" --output table', 'La pública tiene la ruta local y la de internet'],
          ['curl -s http://$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-prod --query "Reservations[0].Instances[0].PublicIpAddress" --output text)/', 'Y la web responde: las cuatro condiciones se cumplen'],
        ],
        A('red-ok'),
      ),
      predict('¿Cuántas rutas tiene la tabla `rt-publica`?', 'aws ec2 describe-route-tables --filters Name=tag:Name,Values=rt-publica --query "length(RouteTables[0].Routes)"', ['1', '3', '4'], 'La «local» (que siempre existe) y la que sale por la internet gateway: 2.', A('red-ok')),
      learn(
        'NAT gateway: salir sin dejar entrar',
        `
Los servidores de una subred privada (aplicación, base de datos) a veces necesitan **salir** a internet: descargar parches, llamar a una API de pagos. Pero **nadie debe poder entrar** a ellos.

Un **NAT gateway** lo resuelve: las instancias privadas le envían su tráfico, él lo reenvía con su propia IP pública y devuelve las respuestas.

- Se crea en una **subred pública** y necesita una **IP elástica**.
- Las subredes privadas apuntan a él: \`0.0.0.0/0 → nat-…\`.
- Es **por zona**: para alta disponibilidad, uno en cada zona.
- **Cuesta**: unos 0,045 USD por hora (≈ 33 USD/mes) más 0,045 USD por GB. Es de las líneas que más sorprenden en la factura.
`,
        '🔀',
      ),
      mc('¿En qué subred se debe crear un NAT gateway?', ['En la subred privada que necesita salir', 'En una subred pública (con ruta a la internet gateway)', 'En cualquiera: da igual', 'En la VPC por defecto'], 1, 'El NAT sale a internet por la IGW, así que debe estar en una subred pública. Poner el NAT en la privada es un error clásico.'),
      tf('«El NAT gateway es gratuito: solo se paga por el tráfico que procesa.»', false, 'Cobra por cada hora que existe (haga o no tráfico) y, además, por los GB procesados.'),
      practice({
        prompt: 'La web `web-prod` tiene IGW conectada, IP pública y security group abierto, pero **su subred pública usa la tabla principal, que no tiene salida**. Haz que responda:\n\n1. Crea una tabla de rutas en la VPC `produccion`.\n2. Añade la ruta `0.0.0.0/0` hacia la internet gateway.\n3. Asóciala a la subred `publica-a`.',
        goal: 'La web responde desde internet',
        setup: A('red-ruta'),
        check: WEB_OK,
        solution: [
          VPC_PROD,
          'IGW=$(aws ec2 describe-internet-gateways --filters Name=attachment.vpc-id,Values=$VPC --query "InternetGateways[0].InternetGatewayId" --output text)',
          'RTB=$(aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text)',
          'aws ec2 create-route --route-table-id $RTB --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW',
          SUBNET('publica-a', 'SN'),
          'aws ec2 associate-route-table --route-table-id $RTB --subnet-id $SN',
        ],
        hints: ['`aws ec2 create-route-table --vpc-id <vpc>` crea la tabla (solo trae la ruta local).', '`aws ec2 create-route --route-table-id <rtb> --destination-cidr-block 0.0.0.0/0 --gateway-id <igw>`', 'Y para que la subred la use: `aws ec2 associate-route-table --route-table-id <rtb> --subnet-id <subred>`.'],
        explain: 'Crear una tabla propia en vez de tocar la principal es la buena práctica: las subredes nuevas nacen privadas, y solo las que asocias explícitamente son públicas.',
        par: 5,
        commands: ['aws ec2 create-route-table', 'aws ec2 create-route', 'aws ec2 associate-route-table'],
      }),
      practice({
        prompt: 'El servidor `app-privada` (subred `privada-a`) necesita **descargar actualizaciones**, pero su subred no tiene salida. Dale salida **sin exponerlo a internet**:\n\n1. Reserva una IP elástica.\n2. Crea un NAT gateway en la subred **pública** `publica-a`.\n3. Crea una tabla de rutas con `0.0.0.0/0` hacia el NAT y asóciala a `privada-a`.',
        goal: 'app-privada puede salir a internet por un NAT',
        setup: A('red-ok'),
        check: PRIV_OK,
        solution: [
          VPC_PROD,
          'ALLOC=$(aws ec2 allocate-address --query AllocationId --output text)',
          SUBNET('publica-a', 'PUB'),
          'NAT=$(aws ec2 create-nat-gateway --subnet-id $PUB --allocation-id $ALLOC --query NatGateway.NatGatewayId --output text)',
          'aws ec2 wait nat-gateway-available --nat-gateway-ids $NAT',
          'RTB=$(aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text)',
          'aws ec2 create-route --route-table-id $RTB --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT',
          SUBNET('privada-a', 'PRIV'),
          'aws ec2 associate-route-table --route-table-id $RTB --subnet-id $PRIV',
        ],
        hints: ['`aws ec2 allocate-address` te da el `AllocationId` de la IP elástica.', '`aws ec2 create-nat-gateway --subnet-id <publica> --allocation-id <eipalloc>`; espera con `aws ec2 wait nat-gateway-available --nat-gateway-ids <id>`.', 'La ruta: `create-route … --nat-gateway-id <nat>` y luego `associate-route-table` con la subred `privada-a`.'],
        explain: 'Así la instancia sigue sin IP pública (nadie puede entrar), pero puede salir por el NAT. Recuerda que el NAT cobra por hora: en entornos de desarrollo, bórralo cuando no se use.',
        par: 8,
        commands: ['aws ec2 create-nat-gateway', 'NAT gateway'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a5-4', { title: 'Security groups frente a NACL', summary: '«¿Llega el paquete?»: el camino completo', emoji: '🛡️', commands: ['Security group', 'NACL', 'Security group frente a NACL', 'aws ec2 create-network-acl-entry'], minutes: 16 }, [
      learn(
        'Dos firewalls, dos niveles',
        `
La VPC tiene **dos filtros** de tráfico que se complementan:

| | **Security group** | **NACL** |
| --- | --- | --- |
| Protege | la **instancia** | la **subred** |
| Estado | **Con estado**: la respuesta vuelve sola | **Sin estado**: ida y vuelta se permiten por separado |
| Reglas | solo **permitir** | **permitir y denegar** |
| Evaluación | todas a la vez | por número, **la primera que coincide** |
| Origen | CIDR u **otro security group** | solo CIDR |
| Por defecto | entrante denegado, saliente permitido | la de la VPC permite todo |

El **security group** es el de uso diario. La **NACL** se usa como segunda capa y, sobre todo, para **bloquear** (un security group no puede denegar).
`,
        '🛡️',
      ),
      illus('aws-sg-vs-nacl', 'Con estado frente a sin estado', 'Envía una petición y mira qué necesita cada filtro para que pase la respuesta.'),
      match(
        'Une cada necesidad con el elemento adecuado',
        [
          ['Bloquear la IP de un atacante en toda la subred', 'NACL'],
          ['Permitir el puerto 443 solo a una instancia', 'Security group'],
          ['Decidir a dónde va un paquete según su destino', 'Tabla de rutas'],
          ['Dar a la VPC una puerta a internet', 'Internet gateway'],
        ],
        'Cada capa tiene su trabajo: rutas encaminan, IGW da la puerta, NACL filtra la subred y el security group protege cada instancia.',
      ),
      learn(
        'El camino de un paquete que entra',
        `
Cuando algo no llega, recorre el camino **en orden** y comprueba cada salto:

1. **Internet gateway** conectada a la VPC.
2. **Tabla de rutas** de la subred con \`0.0.0.0/0 → IGW\`.
3. **NACL de entrada** de la subred permite el puerto.
4. **Security group** de la instancia permite el puerto desde ese origen.
5. La **instancia** tiene IP pública y el servicio escucha.
6. **Respuesta**: el security group la deja salir solo (con estado)… pero la **NACL de salida** debe permitir los **puertos efímeros 1024–65535**.

Un truco para localizar el fallo: un **timeout** (se queda esperando) suele ser filtro o ruta; un **«connection refused»** significa que el paquete llegó pero no hay servicio escuchando.
`,
        '🔍',
      ),
      illus('aws-packet-trace', '¿Llega el paquete?', 'Activa y desactiva cada pieza y observa dónde se queda el paquete.'),
      order('Ordena el camino de una petición web que entra desde internet', ['Internet-gateway', 'Tabla-de-rutas', 'NACL', 'Security-group'], 'Internet-gateway Tabla-de-rutas NACL Security-group', 'Primero la puerta, luego las rutas, el filtro de la subred (NACL) y por último el de la instancia (security group).'),
      demo(
        'Una web que da timeout',
        [
          ['IP=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-prod --query "Reservations[0].Instances[0].PublicIpAddress" --output text)', 'La IP pública de la web'],
          ['curl -s --max-time 3 http://$IP/', 'Nada: se queda esperando (timeout)', 'error'],
          ['aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].IpPermissions[].[FromPort,IpRanges[0].CidrIp]" --output text', 'El security group sí permite el 80 desde cualquier sitio'],
          ['aws ec2 describe-network-acls --filters Name=tag:Name,Values=nacl-publica --query \'NetworkAcls[0].Entries[?Egress==`false`].[RuleNumber,RuleAction,PortRange.From]\' --output table', 'La NACL tiene la regla 90 que DENIEGA el puerto 80 antes de la 100 que permite todo'],
        ],
        A('red-nacl'),
      ),
      mc('El security group permite el puerto 80, la IGW y la ruta están bien, pero la web da timeout. ¿Qué miras después?', ['El tamaño de la instancia', 'La NACL de la subred', 'El par de claves', 'La región'], 1, 'Tras comprobar IGW, ruta y security group, el siguiente salto del camino es la NACL de la subred.'),
      tf('«Si una NACL permite la entrada del puerto 80, la respuesta sale automáticamente sin más reglas.»', false, 'Las NACL no tienen estado: hay que permitir también la salida de los puertos efímeros (1024–65535) para la respuesta.'),
      mc('Dos reglas de entrada de una NACL: `90 DENY tcp 80` y `100 ALLOW todo`. ¿Qué pasa con una petición al puerto 80?', ['Se permite: la 100 permite todo', 'Se deniega: la 90 coincide primero', 'Depende del security group', 'Se permite si viene de la VPC'], 1, 'Las reglas se evalúan por número ascendente y manda la primera que coincide: la 90 deniega.'),
      practice({
        prompt: 'La web `web-prod` da timeout. Ya sabes por qué: la regla **90** de la NACL `nacl-publica` deniega el puerto 80. **Bórrala** (regla de entrada) para que la web vuelva a responder.',
        goal: 'La web responde otra vez',
        setup: A('red-nacl'),
        check: WEB_OK,
        solution: ['ACL=$(aws ec2 describe-network-acls --filters Name=tag:Name,Values=nacl-publica --query "NetworkAcls[0].NetworkAclId" --output text)', 'aws ec2 delete-network-acl-entry --network-acl-id $ACL --ingress --rule-number 90'],
        hints: ['Busca el id de la NACL con `describe-network-acls --filters Name=tag:Name,Values=nacl-publica`.', '`aws ec2 delete-network-acl-entry --network-acl-id <acl> --ingress --rule-number 90`'],
        explain: 'Borrar la regla mala (en vez de añadir una «allow» con número menor) deja la NACL más limpia. Si necesitas bloquear, hazlo con un número más bajo que las reglas que permiten.',
        par: 2,
        commands: ['aws ec2 create-network-acl-entry'],
      }),
      practice({
        prompt: 'Otra web, `web-prod`, tiene todo bien menos el **security group `web-sg`**, que no tiene ninguna regla de entrada. Permite el **puerto 80** (TCP) desde cualquier sitio (`0.0.0.0/0`).',
        goal: 'La web responde otra vez',
        setup: A('red-sg'),
        check: WEB_OK,
        solution: ['SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text)', 'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0'],
        hints: ['`aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 80 --cidr 0.0.0.0/0`'],
        explain: 'Un security group nuevo no deja entrar a nadie. Abre solo lo que haga falta.',
        par: 2,
        commands: ['Security group'],
      }),
      practice({
        prompt: 'Quieres administrar `web-prod` por SSH, pero **solo desde tu IP** (`203.0.113.25`). Añade a `web-sg` una regla de entrada para el **puerto 22** desde **203.0.113.25/32** (y no desde el resto de internet).',
        goal: 'SSH solo desde tu IP',
        setup: A('red-ok'),
        check: all(
          awsIs('_check trace --from internet --to web-prod --port 22 --query Reachable', true, 'Tu IP (203.0.113.25) debe poder entrar por el puerto 22'),
          awsIs('_check trace --from internet:8.8.8.8 --to web-prod --port 22 --query Reachable', false, 'El SSH no debe estar abierto al resto de internet'),
        ),
        solution: ['SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text)', 'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 203.0.113.25/32'],
        hints: ['El sufijo `/32` significa «solo esa dirección».', '`aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 22 --cidr 203.0.113.25/32`'],
        explain: 'Abrir el 22 a `0.0.0.0/0` es de lo primero que atacan los bots. Mejor aún: usar Session Manager y no abrir ningún puerto.',
        par: 2,
        commands: ['Security group frente a NACL'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a5-5', { title: 'DNS con Route 53 y CloudFront', summary: 'Nombres en vez de IP, y contenido cerca del usuario', emoji: '📡', commands: ['Route 53', 'Registros DNS', 'CloudFront', 'aws route53 create-hosted-zone', 'aws route53 change-resource-record-sets'], minutes: 14 }, [
      learn(
        'DNS en dos minutos',
        `
Las personas usamos nombres (\`www.ejemplo.com\`); las redes, direcciones IP. El **DNS** es la «agenda» que traduce unos en otras. **Route 53** es el DNS de AWS.

En Route 53 creas una **zona alojada** (_hosted zone_) por dominio y dentro le añades **registros**:

| Tipo | Para qué |
| --- | --- |
| **A** / **AAAA** | Nombre → dirección IPv4 / IPv6 |
| **CNAME** | Un nombre es un apodo de otro nombre |
| **MX** | Servidores de correo |
| **TXT** | Texto: verificaciones, SPF… |
| **NS** | Los servidores de nombres de la zona (los crea AWS) |

El **TTL** (en segundos) dice cuánto tiempo pueden recordar la respuesta las cachés.
`,
        '📡',
      ),
      illus('aws-dns-flow', 'Del nombre a la IP', 'Sigue una consulta: tu equipo → resolutor → Route 53 → respuesta.'),
      match(
        'Une cada registro con su función',
        [
          ['Nombre → dirección IPv4', 'A'],
          ['Un nombre es un apodo de otro nombre', 'CNAME'],
          ['Servidores de correo del dominio', 'MX'],
          ['Texto para verificar el dominio', 'TXT'],
        ],
        'A y AAAA traducen a IP; CNAME apunta a otro nombre; MX es para el correo; TXT lleva texto libre.',
      ),
      learn(
        'Alias frente a CNAME',
        `
Un **CNAME** no puede ponerse en el **ápice** del dominio (\`ejemplo.com\`, sin \`www\`) ni convivir con otros registros del mismo nombre. Para apuntar el dominio raíz a CloudFront, a un balanceador o a un sitio web de S3 existe el **registro alias** de Route 53:

- Se comporta como un A, pero **apunta a un recurso de AWS**.
- Funciona en el **ápice**.
- Las consultas a un alias hacia recursos de AWS son **gratis**.
- Sigue el cambio de IP del recurso sin que hagas nada.
`,
        '🪪',
      ),
      mc('Quieres que `ejemplo.com` (sin www) apunte a tu distribución de CloudFront. ¿Qué registro usas?', ['Un CNAME', 'Un registro alias (tipo A) hacia CloudFront', 'Un MX', 'Un TXT'], 1, 'El ápice no admite CNAME; el alias de Route 53 resuelve justo ese caso y no cobra consultas.'),
      demo(
        'Registros en acción',
        [
          ['aws route53 list-hosted-zones --query "HostedZones[].[Name,ResourceRecordSetCount]" --output text', 'Una zona con 5 registros (2 de ellos, NS y SOA, los pone AWS)'],
          [ZONE],
          ['dig +short www.ejemplo.com', 'Lo que responde hoy el DNS'],
          [upsertA('api.ejemplo.com', '203.0.113.20'), 'UPSERT: crea el registro si no existe'],
          ['dig +short api.ejemplo.com', 'Ya resuelve'],
          [CNAME_CHANGE('$ZONE', '{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"ejemplo.com","Type":"CNAME","TTL":60,"ResourceRecords":[{"Value":"www.ejemplo.com"}]}}]}'), 'Un CNAME en el ápice: AWS lo rechaza', 'error'],
        ],
        A('dns-demo'),
      ),
      predict('¿Qué devuelve esta consulta de correo?', 'dig +short ejemplo.com MX', ['correo.ejemplo.com', '203.0.113.10', '10 www.ejemplo.com'], 'Un MX contiene la prioridad y el servidor de correo: `10 correo.ejemplo.com`.', A('dns-demo')),
      learn(
        'CloudFront: una copia cerca de cada usuario',
        `
**Amazon CloudFront** es una **red de distribución de contenido (CDN)**: guarda copias de tus páginas, imágenes y vídeos en cientos de **ubicaciones de borde** (_edge locations_) repartidas por el mundo.

- El usuario pide el contenido a la ubicación más cercana → **respuesta rápida**.
- Si no la tiene, la pide a tu **origen** (S3, un balanceador, un servidor) y la **guarda en caché**.
- Menos tráfico llega a tu origen y la factura de transferencia baja.
- **HTTPS** y dominio propio con certificados gratuitos (ACM).
- Con **OAC**, tu bucket de S3 puede ser **privado**: solo CloudFront lo lee.
- Se integra con **WAF** y **Shield** para proteger contra ataques.
`,
        '🌍',
      ),
      tf('«CloudFront solo sirve para contenido estático (imágenes y archivos), nunca para aplicaciones dinámicas.»', false, 'CloudFront también acelera contenido dinámico (APIs, páginas generadas) llevando la conexión por la red de AWS, aunque la caché rinde más con contenido estático.'),
      practice({
        prompt: 'La zona `ejemplo.com` ya tiene `www`. Añade un registro **CNAME** `blog.ejemplo.com` que apunte a **`www.ejemplo.com`** (TTL 300).',
        goal: 'blog.ejemplo.com → www.ejemplo.com (CNAME)',
        setup: A('dns-demo'),
        check: awsIs('_check dns --name blog.ejemplo.com --type CNAME --query "Answers[0].data"', 'www.ejemplo.com.', 'Falta el CNAME blog → www'),
        solution: [ZONE, CNAME_CHANGE('$ZONE', '{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"blog.ejemplo.com","Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":"www.ejemplo.com"}]}}]}')],
        hints: ['Primero el id de la zona: `aws route53 list-hosted-zones`.', 'Un cambio con `"Action":"CREATE"` y `"Type":"CNAME"`, con el valor `www.ejemplo.com`.'],
        explain: 'Con el CNAME, si mañana cambia la IP de `www`, `blog` la sigue sin tocar nada.',
        par: 2,
        commands: ['aws route53 change-resource-record-sets'],
      }),
      practice({
        prompt: 'Has migrado el servidor web. Cambia la IP del registro **A** de `www.ejemplo.com` a **203.0.113.99** (usa `UPSERT`).',
        goal: 'www.ejemplo.com → 203.0.113.99',
        setup: A('dns-demo'),
        check: awsIs('_check dns --name www.ejemplo.com --type A --query "Answers[0].data"', '203.0.113.99', 'www.ejemplo.com debe apuntar a 203.0.113.99'),
        solution: [ZONE, upsertA('www.ejemplo.com', '203.0.113.99')],
        hints: ['`UPSERT` crea o reemplaza.', 'Los datos van en `ResourceRecords: [{"Value":"203.0.113.99"}]`.'],
        explain: 'UPSERT es la forma segura de «poner este valor» sin preocuparte de si el registro existe.',
        par: 2,
        commands: ['Registros DNS'],
      }),
      practice({
        prompt: 'Crea una zona alojada para **`mi-tienda.com`** (usa la referencia `ref-001`) y añade un registro **A** `www.mi-tienda.com` → **198.51.100.7** con TTL 300.',
        goal: 'Zona mi-tienda.com con www → 198.51.100.7',
        setup: A('base'),
        check: awsIs('_check dns --name www.mi-tienda.com --type A --query "Answers[0].data"', '198.51.100.7', 'Falta el registro www.mi-tienda.com'),
        solution: ['ZONE=$(aws route53 create-hosted-zone --name mi-tienda.com --caller-reference ref-001 --query HostedZone.Id --output text)', upsertA('www.mi-tienda.com', '198.51.100.7')],
        hints: ['`aws route53 create-hosted-zone --name mi-tienda.com --caller-reference ref-001`', 'El id de la zona viene en `HostedZone.Id`.'],
        explain: 'Tras crear la zona hay que copiar sus 4 servidores de nombres (NS) al registrador del dominio para que internet use Route 53.',
        par: 2,
        commands: ['aws route53 create-hosted-zone', 'Route 53'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Misión de red: la VPC `produccion` se montó con prisas y **nada funciona**:\n\n1. La web `web-prod` no responde desde internet (hay IGW, pero está **sin conectar**, **no hay ruta** pública y el **security group** no permite el puerto 80).\n2. El servidor privado `app-privada` tiene un **NAT gateway mal puesto**: está en la subred **privada** en vez de en la pública.\n\nArréglalo todo: que la web responda por internet y que `app-privada` pueda **salir** a internet por un NAT bien situado (en la subred `publica-a`).\n\nPista: el NAT mal puesto ya tiene una IP elástica; puedes borrarlo y reutilizarla.',
    goal: 'Web accesible y salida privada por un NAT en la subred pública',
    setup: A('red-dos-capas'),
    check: all(WEB_OK, PRIV_OK),
    solution: [
      VPC_PROD,
      "IGW=$(aws ec2 describe-internet-gateways --query 'InternetGateways[?length(Attachments)==`0`].InternetGatewayId' --output text)",
      'aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC',
      'PUBRT=$(aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text)',
      'aws ec2 create-route --route-table-id $PUBRT --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW',
      SUBNET('publica-a', 'PUB'),
      'aws ec2 associate-route-table --route-table-id $PUBRT --subnet-id $PUB',
      'SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text)',
      'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0',
      'OLD=$(aws ec2 describe-nat-gateways --filter Name=state,Values=available --query "NatGateways[0].NatGatewayId" --output text)',
      'ALLOC=$(aws ec2 describe-nat-gateways --nat-gateway-ids $OLD --query "NatGateways[0].NatGatewayAddresses[0].AllocationId" --output text)',
      'aws ec2 delete-nat-gateway --nat-gateway-id $OLD',
      'NAT=$(aws ec2 create-nat-gateway --subnet-id $PUB --allocation-id $ALLOC --query NatGateway.NatGatewayId --output text)',
      'PRIVRT=$(aws ec2 describe-route-tables --filters Name=tag:Name,Values=rt-privada --query "RouteTables[0].RouteTableId" --output text)',
      'aws ec2 replace-route --route-table-id $PRIVRT --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT',
    ],
    hints: [
      'Web: IGW → ruta → security group. Primero conecta la IGW que no está conectada, después crea una tabla de rutas con `0.0.0.0/0` hacia ella y asóciala a `publica-a`, y abre el puerto 80 en `web-sg`.',
      'El NAT no puede cambiarse de subred: hay que borrarlo (`delete-nat-gateway`) y crear otro en `publica-a` reutilizando su IP elástica (`NatGatewayAddresses[0].AllocationId`).',
      'La tabla `rt-privada` ya tiene una ruta `0.0.0.0/0` hacia el NAT viejo (ahora «blackhole»): cámbiala con `aws ec2 replace-route … --nat-gateway-id <nuevo>`.',
    ],
    explain: 'Recorriste el camino completo: IGW, rutas, security group y NAT. Cuando algo no llega, vuelve siempre a esa lista y comprueba cada salto en orden.',
    commands: ['Internet gateway', 'Tabla de rutas', 'NAT gateway'],
  },
});
