import { A, all, awsAny, awsIs, awsWorld, demo, fill, illus, learn, lesson, match, mc, order, practice, predict, tf, typeCmd } from './awsbuild';

const VPCID = (v: string, n: string) => `${v}=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=${n} --query "Vpcs[0].VpcId" --output text)`;
const SUBID = (v: string, n: string) => `${v}=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=${n} --query "Subnets[0].SubnetId" --output text)`;
const RTBOF = (v: string, vpc: string) => `${v}=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$${vpc} --query "RouteTables[0].RouteTableId" --output text)`;
const SGID = (v: string, n: string) => `${v}=$(aws ec2 describe-security-groups --filters Name=group-name,Values=${n} --query "SecurityGroups[0].GroupId" --output text)`;
const INSTID = (v: string, n: string) => `${v}=$(aws ec2 describe-instances --filters Name=tag:Name,Values=${n} --query "Reservations[0].Instances[0].InstanceId" --output text)`;

const trace = (from: string, to: string, port: number, want: string, expect = true) => awsIs(`_check trace --from ${from} --to ${to} --port ${port} --query Reachable`, expect, want);

const FLOWTRUST = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"vpc-flow-logs.amazonaws.com"},"Action":"sts:AssumeRole"}]}';
const EC2TRUST = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}';

export const a9 = awsWorld({
  id: 'a9',
  index: 9,
  title: 'VPC avanzada y conectividad',
  subtitle: 'Conectar redes, diagnosticar «no conecta» y entrar sin abrir puertos',
  emoji: '🕸️',
  color: '#818CF8',
  level: 'intermedio',
  intro:
    'Una empresa real no vive en una sola VPC: tiene varias, una oficina, servicios compartidos… En esta zona conectas redes con **peering** y **Transit Gateway**, hablas con los servicios de AWS sin salir a internet con **endpoints**, montas una **VPN** hasta la oficina, diagnosticas el eterno «no conecta» con **Flow Logs** y el **Reachability Analyzer**, y entras a tus servidores sin abrir el puerto 22 con **Session Manager**. Todo en el simulador, con un trazador de paquetes que te dice exactamente dónde se corta el camino.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a9-1', { title: 'Peering y Transit Gateway', summary: 'Conectar VPC entre sí, de dos en dos o con un centro', emoji: '🔗', commands: ['VPC Peering', 'Transit Gateway', 'Asociación y propagación (TGW)', 'aws ec2 create-vpc-peering-connection', 'aws ec2 create-transit-gateway'], minutes: 22 }, [
      learn(
        'Dos redes privadas que se hablan',
        `
Cada VPC es una isla: ni siquiera dos VPC de la misma cuenta se ven por defecto. El **VPC peering** es un puente privado entre dos VPC por la red de AWS (sin internet, sin cifrar a mano, sin cuello de botella).

Los pasos son siempre los mismos:

1. **Solicitar** el peering (\`create-vpc-peering-connection\`).
2. La otra VPC lo **acepta** (\`accept-vpc-peering-connection\`) → estado \`active\`.
3. **Ruta de ida**: en la tabla de rutas de A, el CIDR de B → \`pcx-…\`.
4. **Ruta de vuelta**: en la tabla de rutas de B, el CIDR de A → \`pcx-…\`. Sin ella los paquetes llegan, pero **la respuesta no vuelve**.
5. **Security groups** (y NACL) que admitan el CIDR del otro lado.

Y tres reglas que caen en el examen:

- Los CIDR **no pueden solaparse** (dos VPC \`10.0.0.0/16\` no se conectan).
- **No es transitivo**: si A↔B y B↔C, A **no** llega a C pasando por B.
- No hay punto único de fallo ni ancho de banda que gestionar, y **no cobra por hora** (solo el tráfico entre zonas o regiones).
`,
        '🔗',
      ),
      illus('aws-peering-tgw', 'Ida, vuelta y security group', 'Apaga una pieza y mira por qué deja de haber conversación. Cambia a Transit Gateway y compara el número de conexiones.'),
      mc('Tienes peering entre A y B, y entre B y C. Un servidor de A intenta llegar a uno de C. ¿Qué pasa?', ['Llega pasando por B', 'No llega: el peering no es transitivo', 'Llega solo si B tiene IP elástica', 'Llega con un coste extra'], 1, 'El peering conecta solo las dos VPC implicadas. Para que A llegue a C necesitas un peering A↔C o un Transit Gateway.'),
      match(
        'Une cada situación con la herramienta de conexión',
        [
          ['Dos VPC con mucho tráfico entre ellas y sin coste por hora', 'Peering'],
          ['Veinte VPC y una VPN a la oficina que deben verse según reglas', 'Transit Gateway'],
          ['Ofrecer una única API interna a otras cuentas aunque sus CIDR coincidan', 'PrivateLink'],
        ],
        'Peering para pocas VPC; Transit Gateway cuando son muchas o hay que segmentar; PrivateLink cuando solo expones un servicio (y no te importan los solapes de CIDR).',
      ),
      demo(
        'Un peering a medias',
        [
          ['aws ec2 describe-vpc-peering-connections --query "VpcPeeringConnections[].[VpcPeeringConnectionId,Status.Code]" --output table', 'El peering está activo'],
          ['aws ec2 describe-route-tables --query "RouteTables[].Routes[?VpcPeeringConnectionId][].[DestinationCidrBlock,VpcPeeringConnectionId]" --output table', 'Solo hay UNA ruta hacia el peering: la de la VPC app'],
          ['aws ec2 describe-security-groups --filters Name=group-name,Values=db-sg --query "SecurityGroups[0].IpPermissions[].[FromPort,IpRanges[0].CidrIp]" --output table', 'La base de datos sí admite el CIDR de app en el 3306'],
        ],
        A('net-peering-roto'),
        'Aquí la aplicación puede enviar paquetes a la base de datos, pero ninguna respuesta vuelve. ¿Qué falta?',
      ),
      predict('¿En qué estado está el peering de este escenario?', 'aws ec2 describe-vpc-peering-connections --query "VpcPeeringConnections[0].Status.Code" --output text', ['pending-acceptance', 'provisioning', 'rejected'], 'Alguien ya lo aceptó: está `active`. El problema no es el peering sino la ruta de vuelta.', A('net-peering-roto')),
      order('Ordena el comando que acepta un peering', ['aws', 'ec2', 'accept-vpc-peering-connection', '--vpc-peering-connection-id', 'pcx-0abc'], 'aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id pcx-0abc', 'Lo ejecuta quien recibió la solicitud. Hasta entonces el peering está en `pending-acceptance` y no se pueden crear rutas hacia él.'),
      practice({
        prompt:
          'La VPC **`app`** (10.0.0.0/16, con el servidor `app-1`) y la VPC **`datos`** (10.1.0.0/16, con la base de datos `db-1`) no están conectadas. Haz que `app-1` pueda hablar con `db-1` por el puerto **3306** (MySQL), en **us-east-1**:\n\n1. Pide un peering de `app` a `datos` y acéptalo.\n2. Añade la ruta **en las dos** tablas de rutas.\n3. Abre el 3306 en el grupo `db-sg` a la VPC `app` (**10.0.0.0/16**).',
        goal: 'app-1 llega a db-1 por el 3306 (ida y vuelta)',
        setup: A('net-peering'),
        check: trace('app-1', 'db-1', 3306, 'app-1 todavía no llega a db-1 por el puerto 3306 (¿falta una ruta, la aceptación o el security group?)'),
        solution: [
          VPCID('APP', 'app'),
          VPCID('DATOS', 'datos'),
          'PCX=$(aws ec2 create-vpc-peering-connection --vpc-id $APP --peer-vpc-id $DATOS --query VpcPeeringConnection.VpcPeeringConnectionId --output text)',
          'aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id $PCX',
          RTBOF('RA', 'APP'),
          RTBOF('RD', 'DATOS'),
          'aws ec2 create-route --route-table-id $RA --destination-cidr-block 10.1.0.0/16 --vpc-peering-connection-id $PCX',
          'aws ec2 create-route --route-table-id $RD --destination-cidr-block 10.0.0.0/16 --vpc-peering-connection-id $PCX',
          SGID('DBSG', 'db-sg'),
          'aws ec2 authorize-security-group-ingress --group-id $DBSG --protocol tcp --port 3306 --cidr 10.0.0.0/16',
        ],
        hints: [
          'Los ids de las VPC: `aws ec2 describe-vpcs --filters Name=tag:Name,Values=app`. Sus tablas de rutas: `aws ec2 describe-route-tables --filters Name=vpc-id,Values=<vpc>`.',
          '`aws ec2 create-vpc-peering-connection --vpc-id <app> --peer-vpc-id <datos>` y después `aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id <pcx>`.',
          'Rutas: `aws ec2 create-route --route-table-id <rtb> --destination-cidr-block 10.1.0.0/16 --vpc-peering-connection-id <pcx>` (y la inversa con 10.0.0.0/16). Grupo: `aws ec2 authorize-security-group-ingress --group-id <db-sg> --protocol tcp --port 3306 --cidr 10.0.0.0/16`.',
        ],
        explain: 'Peering = solicitud + aceptación + una ruta en CADA lado + security group. Si olvidas una de las dos rutas, los paquetes llegan pero la respuesta no vuelve, y el síntoma es un `timeout` que despista.',
        par: 10,
        commands: ['VPC Peering', 'aws ec2 create-vpc-peering-connection'],
      }),
      practice({
        prompt: 'El peering entre `app` y `datos` ya está **activo**, la VPC `app` ya tiene su ruta y `db-sg` ya admite el puerto 3306, pero `app-1` sigue sin poder hablar con `db-1`: **la respuesta no vuelve**. Arréglalo.',
        goal: 'La respuesta de db-1 vuelve a app-1',
        setup: A('net-peering-roto'),
        check: trace('app-1', 'db-1', 3306, 'Falta la ruta de vuelta en la VPC de la base de datos'),
        solution: [
          VPCID('DATOS', 'datos'),
          'PCX=$(aws ec2 describe-vpc-peering-connections --query "VpcPeeringConnections[0].VpcPeeringConnectionId" --output text)',
          RTBOF('RD', 'DATOS'),
          'aws ec2 create-route --route-table-id $RD --destination-cidr-block 10.0.0.0/16 --vpc-peering-connection-id $PCX',
        ],
        hints: ['Mira qué tabla de rutas tiene una ruta hacia `pcx-…` y cuál no: `aws ec2 describe-route-tables --query "RouteTables[].[VpcId,Routes[].DestinationCidrBlock]"`.', 'Falta en la tabla de la VPC `datos` una ruta hacia 10.0.0.0/16 por el peering.'],
        explain: 'Las rutas se declaran en los dos lados. Es el error número uno con peering, Transit Gateway y VPN: «la ida funciona, la vuelta no».',
        par: 3,
        commands: ['VPC Peering'],
      }),
      learn(
        'Transit Gateway: el centro de la red',
        `
Con peering, conectar **n** VPC exige **n·(n−1)/2** conexiones y rutas en todas partes (con 10 VPC, 45 peerings). El **Transit Gateway** (TGW) es un **router central**: cada VPC se conecta **una vez** (un _adjunto_) y el TGW hace el resto. También conecta VPN y Direct Connect, y **sí es transitivo**.

Lo importante son sus **tablas de rutas**:

- Cada adjunto está **asociado a una tabla**: la que consulta cuando le llega tráfico.
- Cada adjunto puede **propagar** su CIDR a las tablas que quieras, para que otros lo vean.
- Con la tabla por defecto, **todos ven a todos**. Con varias tablas segmentas (producción, desarrollo, compartida).
- **Las VPC siguen necesitando su ruta** hacia el TGW (por ejemplo \`10.0.0.0/8 → tgw-…\`).

El TGW tarda un minuto en estar disponible y cada adjunto otro medio minuto. Cobra por hora por adjunto y por GB: más caro que un peering, pero mucho más sencillo de operar.
`,
        '🌐',
      ),
      mc('En un Transit Gateway quieres que producción vea a la red compartida, pero NO a desarrollo. ¿Qué usas?', ['Un security group por VPC', 'Tablas de rutas separadas: asociación y propagación distintas', 'Un peering extra', 'Una NACL en el TGW'], 1, 'La segmentación en un TGW se hace con tablas de rutas: cada adjunto consulta la suya y solo ve lo que se propaga o declara ahí.'),
      tf('«Si adjuntas una VPC a un Transit Gateway, sus servidores ya pueden hablar con todas las demás.»', false, 'Falta la ruta en las tablas de rutas de la VPC (`CIDR → tgw`) y que los security groups lo admitan. El adjunto solo conecta la VPC con el TGW.'),
      practice({
        prompt:
          'Hay tres VPC con un servidor cada una: **`app`** (10.0.0.0/16, `app-1`), **`datos`** (10.1.0.0/16, `db-1`) y **`herramientas`** (10.2.0.0/16, `tools-1`). Conéctalas con un **Transit Gateway**:\n\n1. Crea el TGW y **espera ~1 minuto** (`sleep 70`) a que esté disponible.\n2. Adjunta las tres VPC (con su subred `…-sub`).\n3. En cada VPC, ruta **10.0.0.0/8** → el TGW.\n\nLos security groups ya admiten 10.0.0.0/8.',
        goal: 'Las tres VPC se hablan entre sí a través del Transit Gateway',
        setup: A('net-tgw'),
        check: all(trace('app-1', 'db-1', 3306, 'app-1 todavía no llega a db-1'), trace('tools-1', 'app-1', 22, 'tools-1 todavía no llega a app-1')),
        solution: [
          'TGW=$(aws ec2 create-transit-gateway --description central --query TransitGateway.TransitGatewayId --output text)',
          'sleep 70',
          'for N in app datos herramientas; do V=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=$N --query "Vpcs[0].VpcId" --output text); S=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=$N-sub --query "Subnets[0].SubnetId" --output text); aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id $TGW --vpc-id $V --subnet-ids $S; done',
          'for N in app datos herramientas; do V=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=$N --query "Vpcs[0].VpcId" --output text); R=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$V --query "RouteTables[0].RouteTableId" --output text); aws ec2 create-route --route-table-id $R --destination-cidr-block 10.0.0.0/8 --transit-gateway-id $TGW; done',
        ],
        hints: [
          'Si `create-transit-gateway-vpc-attachment` dice que el TGW no está disponible, espera: `sleep 70`.',
          '`aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id <tgw> --vpc-id <vpc> --subnet-ids <subred>` (una por VPC). Las subredes se llaman `app-sub`, `datos-sub` y `herramientas-sub`.',
          'Rutas: `aws ec2 create-route --route-table-id <rtb> --destination-cidr-block 10.0.0.0/8 --transit-gateway-id <tgw>` en la tabla de cada VPC. Un bucle `for N in app datos herramientas; do …; done` te ahorra repetir.',
        ],
        explain: 'Con el Transit Gateway cada VPC se conecta una sola vez. La tabla por defecto propaga los tres CIDR y las rutas `10.0.0.0/8 → tgw` de cada VPC mandan el tráfico al centro. Para segmentar redes basta con crear más tablas del TGW.',
        par: 6,
        commands: ['Transit Gateway', 'aws ec2 create-transit-gateway', 'Asociación y propagación (TGW)'],
      }),
    ]),
    // ───────────────────────── 2 ─────────────────────────
    lesson('a9-2', { title: 'Endpoints y PrivateLink', summary: 'Hablar con S3, SQS o tu propio servicio sin salir a internet', emoji: '🔒', commands: ['VPC Endpoint', 'AWS PrivateLink', 'Lista de prefijos', 'aws ec2 create-vpc-endpoint'], minutes: 18 }, [
      learn(
        'Servicios de AWS sin pasar por internet',
        `
Un servidor en una **subred privada** necesita leer de S3 o enviar mensajes a SQS. La solución clásica es un **NAT gateway**: el tráfico sale a internet y vuelve. Funciona, pero cuesta (por hora y por GB) y el tráfico sale de tu VPC.

Un **VPC endpoint** crea una entrada privada al servicio:

| | **Gateway** | **Interface** (PrivateLink) |
| --- | --- | --- |
| Servicios | **S3 y DynamoDB** | La mayoría (SQS, SNS, SSM, KMS, ECR…) |
| Cómo | Una **ruta** en la tabla (lista de prefijos \`pl-…\` → \`vpce-…\`) | Una **interfaz de red** con IP privada en tu subred |
| Control | Política del endpoint | Política + **security group** del endpoint |
| Coste | **Gratis** | Por hora y por GB |

Con los de interfaz, el **DNS privado** hace que \`sqs.us-east-1.amazonaws.com\` resuelva a la IP del endpoint: tu código no cambia. Para activarlo, la VPC necesita **DNS support y DNS hostnames** activados.
`,
        '🔒',
      ),
      illus('aws-endpoint-paths', 'NAT frente a endpoints', 'Cambia de camino y mueve los GB: mira cuánto cuesta cada opción.'),
      mc('Un servidor privado lee 20 TB al mes de un bucket de S3 a través de un NAT gateway. ¿Cómo bajas la factura y mejoras la seguridad?', ['Cambiar a un NAT más grande', 'Crear un endpoint de puerta de enlace de S3 y añadirlo a su tabla de rutas', 'Hacer público el bucket', 'Mover el bucket a otra región'], 1, 'El endpoint de puerta de enlace de S3 es gratuito, no usa el NAT y el tráfico no sale de la red de AWS.'),
      match(
        'Une cada necesidad con el tipo de endpoint',
        [
          ['Leer de S3 desde subredes privadas sin coste', 'Endpoint de puerta de enlace'],
          ['Enviar mensajes a SQS con IP privada y security group', 'Endpoint de interfaz'],
          ['Publicar tu servicio (tras un NLB) a otras cuentas sin peering', 'Servicio de PrivateLink'],
        ],
        'Puerta de enlace = S3/DynamoDB por tabla de rutas. Interfaz = ENI con IP privada para casi cualquier servicio. PrivateLink también sirve para exponer el tuyo.',
      ),
      demo(
        'Un endpoint de interfaz de SQS',
        [
          ['aws ec2 describe-vpc-endpoints --query "VpcEndpoints[].[VpcEndpointId,ServiceName,VpcEndpointType,State]" --output table', 'Tipo Interface, disponible'],
          ['aws ec2 describe-network-interfaces --filters Name=description,Values="VPC Endpoint Interface*" --query "NetworkInterfaces[].[NetworkInterfaceId,PrivateIpAddress,InterfaceType]" --output table', 'Su interfaz de red con IP privada'],
          ['aws ec2 describe-security-groups --filters Name=group-name,Values=endpoint-sg --query "SecurityGroups[0].IpPermissions" --output json', 'Ninguna regla de entrada: nadie podrá hablar con el endpoint'],
        ],
        A('net-endpoints-sg'),
      ),
      predict('¿De qué tipo es el endpoint de este escenario?', 'aws ec2 describe-vpc-endpoints --query "VpcEndpoints[0].VpcEndpointType" --output text', ['Gateway', 'GatewayLoadBalancer', 'Resolver'], 'SQS no se ofrece como endpoint de puerta de enlace (solo S3 y DynamoDB): es de interfaz.', A('net-endpoints-sg')),
      learn(
        'Políticas, DNS y PrivateLink',
        `
- **Política del endpoint**: un documento JSON que limita qué se puede hacer **a través** del endpoint (por ejemplo, solo ciertos buckets). Se suma a IAM y a la política del bucket.
- **Política de bucket** con \`"aws:SourceVpce": "vpce-…"\` (o \`aws:SourceVpc\`): permite el acceso **solo** desde ese endpoint. Si ya existe una política así, desde fuera del endpoint (tu portátil) el acceso se deniega.
- **DNS privado**: exige \`enableDnsSupport\` y \`enableDnsHostnames\` en la VPC. Sin ellos, \`--private-dns-enabled\` falla.
- **Security group del endpoint de interfaz**: debe admitir el **puerto 443** desde las instancias que lo usan.

**PrivateLink** va más allá de los servicios de AWS: un proveedor pone su servicio tras un **NLB**, lo publica (_endpoint service_) y cada consumidor crea un endpoint de interfaz hacia él. Solo viaja tráfico del consumidor al servicio (no se abre toda la red) y los CIDR pueden solaparse.
`,
        '🛰️',
      ),
      practice({
        prompt: 'La VPC **`tienda`** (10.0.0.0/16) tiene una subred **privada** (sin internet ni NAT) con el servidor `app-priv`, que debe leer del bucket `tienda-datos`. Crea un **endpoint de puerta de enlace de S3** y asócialo a la tabla de rutas de la VPC, en **us-east-1**.',
        goal: 'app-priv llega a S3 por un endpoint de puerta de enlace',
        setup: A('net-endpoints'),
        check: trace('app-priv', 'vpce:s3', 443, 'app-priv todavía no llega a S3 de forma privada', true),
        solution: [VPCID('VPC', 'tienda'), RTBOF('RTB', 'VPC'), 'aws ec2 create-vpc-endpoint --vpc-id $VPC --service-name com.amazonaws.us-east-1.s3 --route-table-ids $RTB'],
        hints: ['El nombre del servicio es `com.amazonaws.us-east-1.s3`.', '`aws ec2 create-vpc-endpoint --vpc-id <vpc> --service-name com.amazonaws.us-east-1.s3 --route-table-ids <rtb>` (los de puerta de enlace exigen tablas de rutas).'],
        explain: 'AWS añadió a la tabla de rutas una ruta cuyo destino es la lista de prefijos de S3 (`pl-…`) apuntando al endpoint. No hay NAT, no hay IP pública y no cuesta nada.',
        par: 3,
        commands: ['VPC Endpoint', 'aws ec2 create-vpc-endpoint', 'Lista de prefijos'],
      }),
      practice({
        prompt: 'Ya existe un endpoint de **interfaz de SQS** en la VPC `tienda`, pero `app-priv` no puede hablar con él: el grupo de seguridad **`endpoint-sg`** no tiene ninguna regla de entrada. Permite el puerto **443/TCP** desde la VPC (**10.0.0.0/16**).',
        goal: 'app-priv llega al endpoint de SQS por el 443',
        setup: A('net-endpoints-sg'),
        check: trace('app-priv', 'vpce:sqs', 443, 'El endpoint de SQS sigue sin admitir el tráfico de app-priv'),
        solution: [SGID('EPSG', 'endpoint-sg'), 'aws ec2 authorize-security-group-ingress --group-id $EPSG --protocol tcp --port 443 --cidr 10.0.0.0/16'],
        hints: ['El grupo se llama `endpoint-sg` (filtra por `group-name`).', '`aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 443 --cidr 10.0.0.0/16`.'],
        explain: 'El endpoint de interfaz tiene una interfaz de red en tu subred y manda su security group. Con endpoints, el 443 desde la VPC es la regla de oro.',
        par: 2,
        commands: ['VPC Endpoint', 'Security group'],
      }),
      tf('«Un endpoint de puerta de enlace de S3 también sirve a los equipos de la oficina conectados por VPN.»', false, 'Los de puerta de enlace solo funcionan desde dentro de la VPC (se basan en una ruta). Para llegar desde on-premises necesitas un endpoint de interfaz.'),
      typeCmd('Escribe el comando que lista las listas de prefijos gestionadas por AWS.', ['aws ec2 describe-prefix-lists'], 'Las listas de prefijos (S3, DynamoDB) se consultan con `describe-prefix-lists`.', { setup: A('net-endpoints'), regex: '^aws ec2 describe-prefix-lists' }),
    ]),
    // ───────────────────────── 3 ─────────────────────────
    lesson('a9-3', { title: 'VPN y Direct Connect', summary: 'Unir la oficina con AWS: túneles cifrados o un cable dedicado', emoji: '🏢', commands: ['VPN de sitio a sitio', 'AWS Direct Connect', 'aws ec2 create-vpn-connection', 'Peering, Transit Gateway, PrivateLink y VPN'], minutes: 20 }, [
      learn(
        'VPN de sitio a sitio',
        `
Para unir tu oficina (o centro de datos) con una VPC por internet **cifrando todo**, montas una **VPN de sitio a sitio** (IPsec). Tres piezas:

1. **Puerta del cliente** (_customer gateway_): le dices a AWS la **IP pública** de tu router y su ASN.
2. **Puerta de enlace privada virtual** (_virtual private gateway_, VGW) **conectada a la VPC** — o un Transit Gateway: el extremo del lado AWS.
3. **Conexión VPN**: crea **dos túneles** en zonas distintas para tener redundancia.

El enrutamiento puede ser:

- **Dinámico (BGP)**: tu router anuncia sus redes y AWS las aprende. Recomendado.
- **Estático**: tú declaras los CIDR de la oficina (\`create-vpn-connection-route\`). **Sin rutas estáticas, los túneles se quedan DOWN.**

En la VPC activa la **propagación de rutas** de la VGW en la tabla de rutas (\`enable-vgw-route-propagation\`) y comprueba que los **security groups** admiten el CIDR de la oficina. Los túneles tardan unos minutos en subir.
`,
        '🏢',
      ),
      mc('¿Para qué crea AWS dos túneles en cada conexión VPN?', ['Para duplicar el ancho de banda siempre', 'Para tener redundancia: terminan en zonas distintas y AWS hace mantenimiento en uno cada vez', 'Porque IPsec lo exige', 'Para separar entrada y salida'], 1, 'Son dos extremos en zonas distintas. Si uno cae o se actualiza, el otro sigue. Configura tu router con los dos.'),
      order('Ordena el comando que crea la conexión VPN con una puerta privada virtual', ['aws', 'ec2', 'create-vpn-connection', '--type', 'ipsec.1', '--customer-gateway-id', 'cgw-0a', '--vpn-gateway-id', 'vgw-0b'], 'aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id cgw-0a --vpn-gateway-id vgw-0b', 'El tipo siempre es `ipsec.1`; después indicas la puerta del cliente y el extremo de AWS (VGW o Transit Gateway).'),
      demo(
        'Una VPN dinámica a medio configurar',
        [
          ['aws ec2 describe-customer-gateways --query "CustomerGateways[].[CustomerGatewayId,IpAddress,BgpAsn]" --output table', 'El router de la oficina'],
          ['aws ec2 describe-vpn-connections --query "VpnConnections[0].VgwTelemetry[].[OutsideIpAddress,Status,StatusMessage]" --output table', 'Los dos túneles UP y las rutas aprendidas por BGP'],
          ['aws ec2 describe-route-tables --query "RouteTables[].Routes[].[DestinationCidrBlock,GatewayId]" --output table', 'Pero la tabla de rutas de la VPC no tiene ninguna ruta hacia 192.168.0.0/16'],
        ],
        A('net-vpn-rota'),
        'La VPN está viva (túneles UP) y, sin embargo, la oficina no llega a los servidores. Algo falta en la VPC…',
      ),
      predict('¿Cómo están los túneles de la VPN?', 'aws ec2 describe-vpn-connections --query "VpnConnections[0].VgwTelemetry[].Status" --output text', ['DOWN\tDOWN', 'UP\tDOWN', 'PENDING\tPENDING'], 'Los dos están `UP`: el problema no es la VPN sino el enrutamiento y los security groups de la VPC.', A('net-vpn-rota')),
      learn(
        'Direct Connect: un cable dedicado',
        `
**AWS Direct Connect** es un **enlace físico dedicado** (1, 10 o 100 Gbps) entre tu centro de datos y AWS, a través de una ubicación de colocación. Frente a la VPN:

| | **VPN** | **Direct Connect** |
| --- | --- | --- |
| Medio | Internet público | Cable dedicado |
| Montaje | **Minutos** | **Semanas** |
| Ancho de banda | ≈1,25 Gbps por túnel | 1–100 Gbps |
| Latencia | Variable | **Estable** |
| Cifrado | **Sí (IPsec)** | **No** por defecto |
| Coste | Barato | Puerto + datos |

Sobre el cable creas **interfaces virtuales**: privada (a una VPC), pública (a servicios públicos de AWS) o de tránsito (a un Transit Gateway). Un **Direct Connect gateway** conecta un enlace con VPC de **varias regiones**. Para alta disponibilidad, dos enlaces en ubicaciones distintas o enlace + **VPN de respaldo**. Si necesitas cifrado, ejecuta una **VPN sobre Direct Connect**.
`,
        '🔌',
      ),
      illus('aws-hybrid-chooser', 'VPN, Direct Connect o las dos', 'Cambia los requisitos y mira qué recomienda.'),
      match(
        'Une cada situación con la solución híbrida',
        [
          ['Oficina pequeña que necesita conexión mañana', 'VPN de sitio a sitio'],
          ['Copiar 20 TB cada semana con latencia estable', 'Direct Connect'],
          ['Enlace dedicado, pero con cifrado obligatorio por normativa', 'VPN IPsec sobre Direct Connect'],
        ],
        'La VPN es rápida de montar y cifrada; Direct Connect da rendimiento estable pero tarda y no cifra solo; si necesitas ambas cosas, VPN encima del enlace dedicado.',
      ),
      practice({
        prompt:
          'La oficina tiene un router con IP pública **203.0.113.50** (ASN 65000) y la red **192.168.0.0/16**. Conéctala a la VPC **`tienda`** con una VPN **estática**, en **us-east-1**:\n\n1. Puerta del cliente (`ipsec.1`, IP y ASN del router) y **puerta privada virtual** conectada a la VPC.\n2. Conexión VPN con `StaticRoutesOnly=true` y la ruta estática **192.168.0.0/16**.\n3. **Propaga** las rutas de la VGW en la tabla de rutas de la VPC.\n4. Permite el **SSH (22)** a `app-priv` desde 192.168.0.0/16 en el grupo `app-sg`.',
        goal: 'La oficina llega por SSH a app-priv a través de la VPN',
        setup: A('net-vpn'),
        check: trace('onprem', 'app-priv', 22, 'La oficina todavía no llega a app-priv por SSH (túneles, ruta o security group)'),
        solution: [
          'CGW=$(aws ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.50 --bgp-asn 65000 --query CustomerGateway.CustomerGatewayId --output text)',
          'VGW=$(aws ec2 create-vpn-gateway --type ipsec.1 --query VpnGateway.VpnGatewayId --output text)',
          VPCID('VPC', 'tienda'),
          'aws ec2 attach-vpn-gateway --vpn-gateway-id $VGW --vpc-id $VPC',
          'VPN=$(aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id $CGW --vpn-gateway-id $VGW --options StaticRoutesOnly=true --query VpnConnection.VpnConnectionId --output text)',
          'aws ec2 create-vpn-connection-route --vpn-connection-id $VPN --destination-cidr-block 192.168.0.0/16',
          RTBOF('RTB', 'VPC'),
          'aws ec2 enable-vgw-route-propagation --gateway-id $VGW --route-table-id $RTB',
          SGID('SG', 'app-sg'),
          'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 192.168.0.0/16',
        ],
        hints: [
          'Orden: `create-customer-gateway` → `create-vpn-gateway` → `attach-vpn-gateway` → `create-vpn-connection` → `create-vpn-connection-route`.',
          '`aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id <cgw> --vpn-gateway-id <vgw> --options StaticRoutesOnly=true` y después `aws ec2 create-vpn-connection-route --vpn-connection-id <vpn> --destination-cidr-block 192.168.0.0/16`.',
          '`aws ec2 enable-vgw-route-propagation --gateway-id <vgw> --route-table-id <rtb>` y `aws ec2 authorize-security-group-ingress --group-id <app-sg> --protocol tcp --port 22 --cidr 192.168.0.0/16`.',
        ],
        explain: 'Cuatro cosas tienen que cuadrar: túneles UP (con rutas estáticas o BGP), una ruta hacia la oficina en la VPC (propagada), un security group que admita su CIDR y, por supuesto, que el router de la oficina esté configurado.',
        par: 10,
        commands: ['VPN de sitio a sitio', 'aws ec2 create-vpn-connection'],
      }),
      practice({
        prompt: 'Ya hay una VPN **dinámica (BGP)** entre la oficina y la VPC `tienda` y sus túneles están **UP**, pero desde la oficina no se llega a `app-priv` por SSH. Falta lo que ocurre dentro de la VPC: haz que la oficina (**192.168.0.0/16**) llegue al puerto **22** de `app-priv`.',
        goal: 'La oficina llega por SSH a app-priv',
        setup: A('net-vpn-rota'),
        check: trace('onprem', 'app-priv', 22, 'La oficina todavía no llega a app-priv'),
        solution: [
          'VGW=$(aws ec2 describe-vpn-gateways --query "VpnGateways[0].VpnGatewayId" --output text)',
          VPCID('VPC', 'tienda'),
          RTBOF('RTB', 'VPC'),
          'aws ec2 enable-vgw-route-propagation --gateway-id $VGW --route-table-id $RTB',
          SGID('SG', 'app-sg'),
          'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 192.168.0.0/16',
        ],
        hints: ['Dos cosas: la tabla de rutas no aprende lo que anuncia la VPN y el security group no admite la oficina.', '`aws ec2 enable-vgw-route-propagation --gateway-id <vgw> --route-table-id <rtb>` y abre el 22 a 192.168.0.0/16 en `app-sg`.'],
        explain: 'Con BGP la VPN aprende solo las redes de la oficina, pero la VPC no las ve hasta que activas la propagación en su tabla de rutas. Y, como siempre, el security group.',
        par: 4,
        commands: ['VPN de sitio a sitio', 'Security group'],
      }),
      tf('«Direct Connect cifra el tráfico por defecto, por eso no necesitas VPN.»', false, 'Direct Connect es un cable privado pero no cifra. Si la normativa lo exige, se añade una VPN IPsec por encima (o MACsec en puertos compatibles).'),
    ]),
    // ───────────────────────── 4 ─────────────────────────
    lesson('a9-4', { title: 'Flow Logs y Reachability Analyzer', summary: 'Diagnosticar «no conecta» con método', emoji: '🔍', commands: ['VPC Flow Logs', 'Reachability Analyzer', 'Amazon CloudWatch Logs', 'aws ec2 create-flow-logs', 'aws ec2 start-network-insights-analysis', 'aws logs filter-log-events'], minutes: 24 }, [
      learn(
        '«No conecta»: el orden importa',
        `
La frase más repetida en soporte de redes. Un paquete atraviesa muchas capas y cualquiera puede cortarlo. Revisa **siempre en este orden**:

1. **Origen**: ¿el security group de salida lo permite? (casi siempre sí)
2. **Tabla de rutas** del origen: ¿hay ruta hacia el destino? (¿es una ruta _blackhole_?)
3. **NACL** de salida de la subred de origen y **de entrada** de la de destino (no tienen estado: ida y vuelta).
4. **Security group del destino**: ¿admite el puerto desde el origen?
5. **Ruta de vuelta**: ¿sabe el destino llegar al origen?
6. **Dentro de la instancia**: ¿la aplicación escucha? ¿firewall del sistema?

Dos herramientas te lo ahorran:

- **Reachability Analyzer**: lee la configuración y te dice si hay camino y **qué componente lo corta** (sin enviar paquetes).
- **VPC Flow Logs**: registra el tráfico real (**ACCEPT** o **REJECT**) para saber qué ha pasado de verdad.
`,
        '🧭',
      ),
      illus('aws-flow-reach', 'Qué ve cada herramienta', 'Rompe una pieza y compara lo que muestran los Flow Logs y el analizador.'),
      learn(
        'Leer un flow log',
        `
Un registro (formato por defecto) es una línea con campos separados por espacios:

\`\`\`
2 123456789012 eni-0a1 198.51.100.23 10.0.1.10 51234 22 6 20 840 1700000000 1700000060 ACCEPT OK
versión · cuenta · interfaz · srcaddr · dstaddr · srcport · dstport · protocolo(6=TCP) · paquetes · bytes · inicio · fin · acción · estado
\`\`\`

- **ACCEPT** = lo permitieron los security groups y las NACL. **REJECT** = lo bloqueó alguno de los dos (no dice cuál).
- Se agregan en ventanas de 1 o 10 minutos: no es tiempo real.
- Si el paquete **nunca llega** a la interfaz (falta una ruta), **no hay registro**: los Flow Logs no ven lo que no llega.
- Destino: **CloudWatch Logs** (necesita un **rol** con confianza en \`vpc-flow-logs.amazonaws.com\`), S3 o Firehose.
`,
        '📜',
      ),
      mc(
        '¿Qué indica esta línea de un flow log?',
        ['Se rechazó una conexión SSH desde 203.0.113.9', 'Se aceptó una conexión SSH (puerto 22) desde 203.0.113.9', 'Se aceptó tráfico HTTP desde 203.0.113.9', 'El servidor 10.0.1.10 inició una conexión a 203.0.113.9'],
        1,
        'Puerto de destino 22, protocolo 6 (TCP), acción ACCEPT y origen 203.0.113.9: alguien se conectó por SSH y se le permitió.',
        '2 123456789012 eni-0a1 203.0.113.9 10.0.1.10 51234 22 6 20 840 1700000000 1700000060 ACCEPT OK',
      ),
      demo(
        'Interrogar un histórico de tráfico',
        [
          ['aws logs describe-log-groups --query "logGroups[].logGroupName" --output text', 'Un grupo de registros con el histórico'],
          ['aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern REJECT --query "events[0].message" --output text', 'Un paquete rechazado (puerto 3389)'],
          ['aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern ACCEPT --query "events[].message" --output text | tr "\\t" "\\n" | awk \'{print $4}\' | sort | uniq -c | sort -rn | head -3', 'Quién habla más con el servidor: una IP destaca con diferencia'],
        ],
        A('net-diag'),
        'Esa IP que machaca el servidor, ¿son clientes o un ataque?',
      ),
      predict('Para entregar flow logs a CloudWatch el rol debe confiar en `vpc-flow-logs.amazonaws.com`. ¿En qué servicio confía el rol `flowlogs-role` de esta cuenta?', 'aws iam get-role --role-name flowlogs-role --query "Role.AssumeRolePolicyDocument.Statement[0].Principal.Service" --output text', ['vpc-flow-logs.amazonaws.com', 'logs.amazonaws.com', 'lambda.amazonaws.com'], 'Confía en `ec2.amazonaws.com`: es el error clásico. El flow log se crea, pero la entrega falla con «Access error».', A('net-diag')),
      match(
        'Une cada código del Reachability Analyzer con su causa',
        [
          ['NO_ROUTE_TO_DESTINATION', 'La tabla de rutas no tiene ruta al destino'],
          ['ENI_SG_RULES_MISMATCH', 'Ningún security group permite el tráfico'],
          ['SUBNET_ACL_RESTRICTION', 'Una NACL bloquea el tráfico'],
        ],
        'El analizador nombra el componente exacto: la tabla de rutas, el security group o la NACL.',
      ),
      practice({
        prompt:
          'En la VPC `tienda` hay tres servidores: `web` (público), `app` (privado, puerto **8080**) y `db`. Desde `web` **no se llega a `app` por el 8080**. Diagnostícalo con el **Reachability Analyzer**:\n\n1. Crea un camino de `web` a `app` (TCP, puerto 8080) y analízalo.\n2. Lee la explicación y arregla lo que corta el paso.\n3. Vuelve a analizar y comprueba que `NetworkPathFound` es `true`.\n\n(Pista: `app-sg` solo admite el 8081 desde `web-sg`.)',
        goal: 'web llega a app por el 8080 y el análisis lo confirma',
        setup: A('net-diag'),
        check: all(awsAny('ec2 describe-network-insights-analyses --query NetworkInsightsAnalyses', 'Ejecuta al menos un análisis con el Reachability Analyzer'), trace('web', 'app', 8080, 'web todavía no llega a app por el 8080')),
        solution: [
          INSTID('WEB', 'web'),
          INSTID('APP', 'app'),
          'NIP=$(aws ec2 create-network-insights-path --source $WEB --destination $APP --protocol tcp --destination-port 8080 --query NetworkInsightsPath.NetworkInsightsPathId --output text)',
          'aws ec2 start-network-insights-analysis --network-insights-path-id $NIP',
          SGID('APPSG', 'app-sg'),
          SGID('WEBSG', 'web-sg'),
          'aws ec2 authorize-security-group-ingress --group-id $APPSG --protocol tcp --port 8080 --source-group $WEBSG',
          'aws ec2 start-network-insights-analysis --network-insights-path-id $NIP --query NetworkInsightsAnalysis.NetworkPathFound',
        ],
        hints: [
          '`aws ec2 create-network-insights-path --source <i-web> --destination <i-app> --protocol tcp --destination-port 8080` y luego `aws ec2 start-network-insights-analysis --network-insights-path-id <nip>`.',
          'La explicación será `ENI_SG_RULES_MISMATCH` y te dará el id del security group (`app-sg`).',
          '`aws ec2 authorize-security-group-ingress --group-id <app-sg> --protocol tcp --port 8080 --source-group <web-sg>`. Vuelve a ejecutar el análisis.',
        ],
        explain: 'El analizador te ahorró probar capa por capa: te dijo que era un security group y cuál. Con un grupo origen en la regla (`--source-group`) no dependes de IPs concretas.',
        par: 7,
        commands: ['Reachability Analyzer', 'aws ec2 start-network-insights-analysis'],
      }),
      practice({
        prompt:
          'Quieres registrar el tráfico **rechazado** de la VPC `tienda` en CloudWatch Logs. Crea un flow log de la VPC con tráfico **REJECT**, grupo de registros **`/vpc/tienda/rechazos`** y el rol `flowlogs-role`, y comprueba que **la entrega funciona** (`DeliverLogsStatus` = `SUCCESS`). Si falla, averigua por qué.',
        goal: 'Flow log de REJECT con entrega correcta',
        setup: A('net-diag'),
        check: awsIs('ec2 describe-flow-logs --query "FlowLogs[].[TrafficType,DeliverLogsStatus]"', [['REJECT', 'SUCCESS']], 'Falta un flow log de tráfico REJECT con DeliverLogsStatus = SUCCESS'),
        solution: [
          VPCID('VPC', 'tienda'),
          'ROLE=$(aws iam get-role --role-name flowlogs-role --query Role.Arn --output text)',
          'aws ec2 create-flow-logs --resource-type VPC --resource-ids $VPC --traffic-type REJECT --log-group-name /vpc/tienda/rechazos --deliver-logs-permission-arn $ROLE',
          `aws iam update-assume-role-policy --role-name flowlogs-role --policy-document '${FLOWTRUST}'`,
          'aws ec2 describe-flow-logs --query "FlowLogs[].[FlowLogId,DeliverLogsStatus]"',
        ],
        hints: [
          '`aws ec2 create-flow-logs --resource-type VPC --resource-ids <vpc> --traffic-type REJECT --log-group-name /vpc/tienda/rechazos --deliver-logs-permission-arn <arn del rol>`.',
          '`aws ec2 describe-flow-logs` dice `FAILED` con «Access error»: el rol no confía en el servicio de flow logs.',
          'Corrige la relación de confianza con `aws iam update-assume-role-policy --role-name flowlogs-role --policy-document \'<JSON>\'`, con `"Principal":{"Service":"vpc-flow-logs.amazonaws.com"}`.',
        ],
        explain: 'Un flow log puede crearse «bien» y no entregar nada. Mira siempre `DeliverLogsStatus`. Casi siempre es la relación de confianza del rol (debe nombrar `vpc-flow-logs.amazonaws.com`) o falta el permiso de escritura en los logs.',
        par: 5,
        commands: ['VPC Flow Logs', 'aws ec2 create-flow-logs', 'Amazon CloudWatch Logs'],
      }),
      practice({
        prompt:
          'El histórico de tráfico (`/vpc/tienda/historico`) muestra que la IP **198.51.100.23** machaca el **puerto 22** del servidor `web` (fuerza bruta de SSH). Ese puerto está abierto a todo el mundo en el security group. Corta el ataque **sin romper la web** para el resto de usuarios:\n\n- `198.51.100.23` no debe poder llegar al 22 de `web`.\n- El puerto **80** debe seguir funcionando para todos.\n\n(Puedes denegar solo esa IP con una **NACL** — los security groups solo permiten — o cerrar el 22 a internet.)',
        goal: 'Atacante bloqueado y la web sigue funcionando',
        setup: A('net-diag'),
        check: all(awsIs('_check trace --from internet:198.51.100.23 --to web --port 22 --query Reachable', false, '198.51.100.23 todavía puede llegar al puerto 22'), trace('internet', 'web', 80, 'La web (puerto 80) ya no es accesible')),
        solution: [
          VPCID('VPC', 'tienda'),
          'ACL=$(aws ec2 describe-network-acls --filters Name=vpc-id,Values=$VPC --query "NetworkAcls[0].NetworkAclId" --output text)',
          'aws ec2 create-network-acl-entry --network-acl-id $ACL --ingress --rule-number 50 --protocol tcp --port-range From=22,To=22 --cidr-block 198.51.100.23/32 --rule-action deny',
        ],
        hints: [
          'Los security groups no pueden denegar; las NACL sí, y se evalúan por número de regla (la menor primero).',
          '`aws ec2 describe-network-acls --filters Name=vpc-id,Values=<vpc>` te da la NACL; añade una regla de entrada con un número **menor** que el de la regla que permite todo (100).',
          '`aws ec2 create-network-acl-entry --network-acl-id <acl> --ingress --rule-number 50 --protocol tcp --port-range From=22,To=22 --cidr-block 198.51.100.23/32 --rule-action deny`.',
        ],
        explain: 'Los Flow Logs te dieron el culpable; la NACL permite bloquear una IP concreta (el security group no puede). Lo más sano a largo plazo: cerrar el 22 a internet y entrar con Session Manager (siguiente lección).',
        par: 3,
        commands: ['VPC Flow Logs', 'NACL'],
      }),
      tf('«Si en los Flow Logs aparece REJECT, el culpable siempre es el security group.»', false, 'REJECT lo producen los security groups y las NACL. El registro no dice cuál; el Reachability Analyzer sí.'),
    ]),
    // ───────────────────────── 5 ─────────────────────────
    lesson('a9-5', { title: 'Acceso seguro a instancias e IPv6', summary: 'Entrar sin abrir el 22 y salir a internet por IPv6', emoji: '🔑', commands: ['Session Manager', 'Run Command', 'Bastión (jump host)', 'IPv6 en la VPC', 'Egress-only internet gateway', 'aws ssm send-command'], minutes: 22 }, [
      learn(
        'Adiós al puerto 22',
        `
Para administrar un servidor hay dos escuelas:

- **Bastión (_jump host_)**: un servidor público con SSH abierto desde el que saltas a los privados. Funciona, pero tienes un puerto expuesto, claves que rotar y una máquina más que parchear y vigilar.
- **Session Manager** (Systems Manager): abres una shell **por HTTPS desde la consola o la CLI**, sin puertos entrantes, sin claves ni bastión. Se controla con **IAM** (y MFA) y cada sesión queda **auditada**.

Para que una instancia aparezca «administrada» (**Online**) necesita las **tres** cosas:

1. **SSM Agent** (viene en Amazon Linux y Ubuntu recientes).
2. Un **perfil de instancia** con un rol que lleve **\`AmazonSSMManagedInstanceCore\`** (y confíe en \`ec2.amazonaws.com\`).
3. **Salida de red** hacia SSM: un NAT/IGW **o** tres endpoints de interfaz (\`ssm\`, \`ssmmessages\`, \`ec2messages\`) con DNS privado.

Y con **Run Command** ejecutas órdenes (\`AWS-RunShellScript\`) en una o cientos de instancias a la vez, sin conectarte.
`,
        '🔑',
      ),
      illus('aws-ssm-access', 'Bastión o Session Manager', 'Activa y desactiva piezas hasta conseguir acceso sin puertos abiertos.'),
      mc('Una instancia con el perfil correcto no aparece en Systems Manager. Está en una subred privada sin NAT ni endpoints. ¿Qué falta?', ['Abrir el puerto 22', 'Un camino de red hacia los servicios de SSM (NAT o endpoints ssm, ssmmessages y ec2messages)', 'Una clave SSH', 'Una IP elástica'], 1, 'El agente inicia la conexión hacia SSM: sin salida de red (ni NAT ni endpoints) no puede registrarse.'),
      demo(
        'De invisible a administrada',
        [
          ['aws ssm describe-instance-information --query "InstanceInformationList[].InstanceId" --output text', 'Nada: la instancia no aparece'],
          ['INST=$(aws ec2 describe-instances --query "Reservations[0].Instances[0].InstanceId" --output text)'],
          ['aws ec2 associate-iam-instance-profile --instance-id $INST --iam-instance-profile Name=ssm-ec2 --query IamInstanceProfileAssociation.State --output text', 'Asociamos el perfil con el rol de SSM'],
          ['aws ssm describe-instance-information --query "InstanceInformationList[].[InstanceId,PingStatus,PlatformName]" --output table', 'Ahora aparece Online'],
          ['CMD=$(aws ssm send-command --document-name AWS-RunShellScript --instance-ids $INST --parameters commands=hostname --query Command.CommandId --output text)'],
          ['aws ssm get-command-invocation --command-id $CMD --instance-id $INST --query StandardOutputContent --output text', 'Salida de la orden, sin SSH'],
        ],
        A('net-ssm-rol'),
      ),
      predict('¿Cuántas instancias administra Systems Manager ahora mismo?', 'aws ssm describe-instance-information --query "length(InstanceInformationList)" --output text', ['1', '2', '3'], 'Ninguna: la instancia no tiene perfil de instancia con permisos de SSM.', A('net-ssm-rol')),
      practice({
        prompt: 'El servidor **`app-1`** no aparece en Systems Manager. Ya existe el perfil de instancia **`ssm-ec2`** (con el rol que lleva `AmazonSSMManagedInstanceCore`). **Asócialo a `app-1`** para poder administrarlo sin SSH.',
        goal: 'app-1 aparece Online en Systems Manager',
        setup: A('net-ssm-rol'),
        check: awsIs('_check ssm --instance app-1 --query Online', true, 'app-1 todavía no está administrada por Systems Manager'),
        solution: [INSTID('INST', 'app-1'), 'aws ec2 associate-iam-instance-profile --instance-id $INST --iam-instance-profile Name=ssm-ec2'],
        hints: ['Las instancias ya creadas reciben el perfil con `associate-iam-instance-profile`.', '`aws ec2 associate-iam-instance-profile --instance-id <i-…> --iam-instance-profile Name=ssm-ec2`.'],
        explain: 'El perfil de instancia es la «pulsera» que lleva el rol a la instancia. El agente usa esas credenciales temporales para registrarse en SSM.',
        par: 2,
        commands: ['Session Manager'],
      }),
      learn(
        'Crear el rol de SSM',
        `
Un rol para EC2 siempre se crea en tres pasos (y un cuarto para instancias que ya existen):

1. \`aws iam create-role\` con la **relación de confianza** que deja a EC2 asumirlo.
2. \`aws iam attach-role-policy\` con **\`arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore\`**.
3. \`aws iam create-instance-profile\` + \`aws iam add-role-to-instance-profile\` (la consola lo hace sola; la CLI no).
4. \`aws ec2 associate-iam-instance-profile\` (o \`--iam-instance-profile\` al lanzar).

La confianza es siempre algo así: \`{"Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}\`.
`,
        '🧩',
      ),
      practice({
        prompt:
          'El servidor **`app-1`** tiene el puerto **22 abierto a todo internet** y ninguna forma de administrarlo sin él. Déjalo así:\n\n1. Crea el rol **`ssm-ec2`** (confianza en `ec2.amazonaws.com`) con la política administrada **`AmazonSSMManagedInstanceCore`**.\n2. Crea el perfil de instancia **`ssm-ec2`**, añade el rol y asócialo a `app-1`.\n3. **Cierra el puerto 22** en `app-sg` (revoca la regla de 0.0.0.0/0). El puerto 80 debe seguir abierto.',
        goal: 'app-1 administrada por SSM, sin SSH abierto y con la web accesible',
        setup: A('net-ssm'),
        check: all(awsIs('_check ssm --instance app-1 --query Online', true, 'app-1 todavía no está administrada por Systems Manager'), trace('internet', 'app-1', 22, 'El puerto 22 sigue abierto a internet', false), trace('internet', 'app-1', 80, 'El puerto 80 debe seguir accesible')),
        solution: [
          `aws iam create-role --role-name ssm-ec2 --assume-role-policy-document '${EC2TRUST}'`,
          'aws iam attach-role-policy --role-name ssm-ec2 --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
          'aws iam create-instance-profile --instance-profile-name ssm-ec2',
          'aws iam add-role-to-instance-profile --instance-profile-name ssm-ec2 --role-name ssm-ec2',
          INSTID('INST', 'app-1'),
          'aws ec2 associate-iam-instance-profile --instance-id $INST --iam-instance-profile Name=ssm-ec2',
          SGID('SG', 'app-sg'),
          'aws ec2 revoke-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 0.0.0.0/0',
        ],
        hints: [
          '`aws iam create-role --role-name ssm-ec2 --assume-role-policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}\'`.',
          'Después: `attach-role-policy` (política `AmazonSSMManagedInstanceCore`), `create-instance-profile`, `add-role-to-instance-profile` y `ec2 associate-iam-instance-profile`.',
          'Para cerrar el SSH: `aws ec2 revoke-security-group-ingress --group-id <app-sg> --protocol tcp --port 22 --cidr 0.0.0.0/0`.',
        ],
        explain: 'Sin puerto 22 no hay fuerza bruta de SSH que valga, ni claves que rotar. Entras con IAM (y MFA) y todo queda registrado.',
        par: 8,
        commands: ['Session Manager', 'Bastión (jump host)'],
      }),
      learn(
        'IPv6 en la VPC',
        `
Las direcciones IPv4 públicas escasean y se cobran. **IPv6** tiene direcciones de sobra:

- Asocias un bloque **/56** de AWS a la VPC (\`associate-vpc-cidr-block --amazon-provided-ipv6-cidr-block\`) y un **/64** a cada subred (\`associate-subnet-cidr-block\`).
- Todas las direcciones IPv6 son **públicas y únicas**: **no hay NAT**. Lo que decide si algo es accesible desde fuera son las **rutas** y los **security groups**.
- Subred pública: ruta \`::/0\` → **internet gateway**. Subred privada con salida: ruta \`::/0\` → **egress-only internet gateway** (permite conexiones salientes, bloquea las entrantes).
- Los security groups y NACL tienen **reglas IPv6 propias** (\`::/0\`): una regla \`0.0.0.0/0\` no cubre IPv6.
- Ahorras NAT gateways si tu tráfico saliente puede ir por IPv6.
`,
        '🌍',
      ),
      fill('Completa', 'Para que una subred privada inicie conexiones por IPv6 sin aceptar entrantes, su ruta ::/0 apunta a un ___ y no a un ___.', ['egress-only internet gateway', 'NAT gateway', 'internet gateway'], ['egress-only internet gateway', 'internet gateway'], 'La egress-only internet gateway es el «NAT» de IPv6 (aunque no traduce nada): solo deja salir. La internet gateway permitiría también las conexiones entrantes.'),
      tf('«Como con IPv4, para que una subred IPv6 privada salga a internet hace falta un NAT gateway.»', false, 'No hay NAT en IPv6: las direcciones ya son públicas. Para solo salida se usa una egress-only internet gateway, que además es gratuita.'),
      practice({
        prompt:
          'Pasa la VPC **`tienda`** a doble pila IPv4+IPv6 y da salida solo-IPv6 a la subred **privada**:\n\n1. Asocia un bloque IPv6 de Amazon a la VPC.\n2. Asocia un **/64** a la subred `privada` (usa el bloque de la VPC: sustituye el tercer grupo por `02`, p. ej. `…:02::/64`).\n3. Crea una **egress-only internet gateway**, una tabla de rutas nueva asociada a `privada` con la ruta **::/0** hacia ella.',
        goal: 'Subred privada con IPv6 y salida solo de salida',
        setup: A('net-ipv6'),
        check: all(
          awsIs('ec2 describe-subnets --filters Name=tag:Name,Values=privada --query "Subnets[0].Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlockState.State"', 'associated', 'La subred privada todavía no tiene un bloque IPv6'),
          awsAny('ec2 describe-route-tables --query "RouteTables[].Routes[?EgressOnlyInternetGatewayId][]"', 'Falta una ruta ::/0 hacia una egress-only internet gateway'),
        ),
        solution: [
          VPCID('VPC', 'tienda'),
          'BLOCK=$(aws ec2 associate-vpc-cidr-block --vpc-id $VPC --amazon-provided-ipv6-cidr-block --query Ipv6CidrBlockAssociation.Ipv6CidrBlock --output text)',
          SUBID('PRIV', 'privada'),
          'PREFIX=${BLOCK%00::/56}',
          'aws ec2 associate-subnet-cidr-block --subnet-id $PRIV --ipv6-cidr-block ${PREFIX}02::/64',
          'EIGW=$(aws ec2 create-egress-only-internet-gateway --vpc-id $VPC --query EgressOnlyInternetGateway.EgressOnlyInternetGatewayId --output text)',
          'RT=$(aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text)',
          'aws ec2 associate-route-table --route-table-id $RT --subnet-id $PRIV',
          'aws ec2 create-route --route-table-id $RT --destination-ipv6-cidr-block ::/0 --egress-only-internet-gateway-id $EIGW',
        ],
        hints: [
          '`aws ec2 associate-vpc-cidr-block --vpc-id <vpc> --amazon-provided-ipv6-cidr-block` te devuelve algo como `2600:1f00:abcd:ef00::/56`.',
          'Para la subred: `aws ec2 associate-subnet-cidr-block --subnet-id <privada> --ipv6-cidr-block 2600:1f00:abcd:ef02::/64` (mismo prefijo, tercer grupo `02`).',
          '`aws ec2 create-egress-only-internet-gateway --vpc-id <vpc>`, `aws ec2 create-route-table --vpc-id <vpc>`, `associate-route-table` con la subred y `aws ec2 create-route --route-table-id <rtb> --destination-ipv6-cidr-block ::/0 --egress-only-internet-gateway-id <eigw>`.',
        ],
        explain: 'Doble pila: lo mismo que IPv4 pero con `::/0` en las rutas. La egress-only internet gateway hace de «NAT» solo de salida, y es gratis.',
        par: 8,
        commands: ['IPv6 en la VPC', 'Egress-only internet gateway'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Misión final: **«La red de la empresa»**. Tienes tres VPC sin conectar en **us-east-1**: **`prod`** (10.0.0.0/16, servidor `app-prod`), **`dev`** (10.1.0.0/16, `app-dev`) y **`compartida`** (10.2.0.0/16, el directorio `dir-1`). La oficina (router **203.0.113.50**, red 192.168.0.0/16) también debe entrar. Monta con un **Transit Gateway**:\n\n1. Adjunta las tres VPC (espera ~1 min tras crearlo) y pon en cada una la ruta **10.0.0.0/8 → TGW**.\n2. `prod` y `dev` deben llegar a `dir-1` (puerto 389), pero **`dev` no debe ver a `prod`**: usa una tabla de rutas del TGW propia para `dev` que solo propague `compartida`.\n3. Una **VPN** de la oficina al TGW (BGP) y ruta **192.168.0.0/16 → TGW** en `prod`; la oficina debe llegar al **SSH de `app-prod`** (abre el 22 a 192.168.0.0/16 en `prod-sg`).\n4. `app-prod` debe ser administrable con **Session Manager** (ya existe el perfil `ssm-ec2`).',
    goal: 'Red segmentada: prod y dev ven la compartida, dev no ve prod, la oficina entra a prod',
    setup: A('net-sede'),
    check: all(
      awsIs('ec2 describe-transit-gateway-vpc-attachments --query "TransitGatewayVpcAttachments[].State"', ['available', 'available', 'available'], 'Las tres VPC deben estar adjuntas al Transit Gateway'),
      trace('app-prod', 'dir-1', 389, 'prod todavía no llega al directorio compartido'),
      trace('app-dev', 'dir-1', 389, 'dev todavía no llega al directorio compartido'),
      trace('app-dev', 'app-prod', 22, 'dev NO debe poder llegar a prod', false),
      trace('onprem', 'app-prod', 22, 'La oficina todavía no llega al SSH de app-prod'),
      awsIs('_check ssm --instance app-prod --query Online', true, 'app-prod debe estar administrada por Session Manager'),
    ),
    solution: [
      'TGW=$(aws ec2 create-transit-gateway --description empresa --query TransitGateway.TransitGatewayId --output text)',
      'sleep 70',
      'for N in prod dev compartida; do V=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=$N --query "Vpcs[0].VpcId" --output text); S=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=$N-sub --query "Subnets[0].SubnetId" --output text); aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id $TGW --vpc-id $V --subnet-ids $S; done',
      'for N in prod dev compartida; do V=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=$N --query "Vpcs[0].VpcId" --output text); R=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$V --query "RouteTables[0].RouteTableId" --output text); aws ec2 create-route --route-table-id $R --destination-cidr-block 10.0.0.0/8 --transit-gateway-id $TGW; done',
      'DEFRT=$(aws ec2 describe-transit-gateway-route-tables --query "TransitGatewayRouteTables[0].TransitGatewayRouteTableId" --output text)',
      VPCID('DEV', 'dev'),
      VPCID('COMP', 'compartida'),
      'ADEV=$(aws ec2 describe-transit-gateway-vpc-attachments --filters Name=vpc-id,Values=$DEV --query "TransitGatewayVpcAttachments[0].TransitGatewayAttachmentId" --output text)',
      'ACOMP=$(aws ec2 describe-transit-gateway-vpc-attachments --filters Name=vpc-id,Values=$COMP --query "TransitGatewayVpcAttachments[0].TransitGatewayAttachmentId" --output text)',
      'DEVRT=$(aws ec2 create-transit-gateway-route-table --transit-gateway-id $TGW --query TransitGatewayRouteTable.TransitGatewayRouteTableId --output text)',
      'aws ec2 disassociate-transit-gateway-route-table --transit-gateway-route-table-id $DEFRT --transit-gateway-attachment-id $ADEV',
      'aws ec2 associate-transit-gateway-route-table --transit-gateway-route-table-id $DEVRT --transit-gateway-attachment-id $ADEV',
      'aws ec2 enable-transit-gateway-route-table-propagation --transit-gateway-route-table-id $DEVRT --transit-gateway-attachment-id $ACOMP',
      'CGW=$(aws ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.50 --bgp-asn 65000 --query CustomerGateway.CustomerGatewayId --output text)',
      'aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id $CGW --transit-gateway-id $TGW',
      VPCID('PROD', 'prod'),
      RTBOF('RPROD', 'PROD'),
      'aws ec2 create-route --route-table-id $RPROD --destination-cidr-block 192.168.0.0/16 --transit-gateway-id $TGW',
      SGID('PRODSG', 'prod-sg'),
      'aws ec2 authorize-security-group-ingress --group-id $PRODSG --protocol tcp --port 22 --cidr 192.168.0.0/16',
      INSTID('APROD', 'app-prod'),
      'aws ec2 associate-iam-instance-profile --instance-id $APROD --iam-instance-profile Name=ssm-ec2',
    ],
    hints: [
      'Empieza por el Transit Gateway: `create-transit-gateway`, `sleep 70`, tres `create-transit-gateway-vpc-attachment` y la ruta `10.0.0.0/8 → tgw` en cada VPC.',
      'Para aislar `dev`: crea una tabla (`create-transit-gateway-route-table`), quita la asociación de su adjunto a la tabla por defecto (`disassociate-…`), asócialo a la nueva y propaga **solo** el adjunto de `compartida` en ella (`enable-transit-gateway-route-table-propagation`). Las respuestas también tienen que poder volver.',
      'La VPN: `create-customer-gateway`, y `create-vpn-connection --type ipsec.1 --customer-gateway-id <cgw> --transit-gateway-id <tgw>` (aparece como un adjunto más). Después, ruta `192.168.0.0/16 → tgw` en la tabla de `prod`, regla 22 en `prod-sg` y `associate-iam-instance-profile` con `ssm-ec2`.',
    ],
    explain: 'Has montado una red de empresa de verdad: un Transit Gateway central, segmentación con tablas de rutas (dev nunca ve prod), una VPN a la oficina que llega a producción y administración sin puertos abiertos. Y con los Flow Logs y el Reachability Analyzer sabes diagnosticar cuando algo no conecta.',
    commands: ['Transit Gateway', 'Asociación y propagación (TGW)', 'VPN de sitio a sitio', 'Session Manager'],
  },
});
