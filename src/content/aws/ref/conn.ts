import type { AwsRef } from '../reference';

const VPC = (n: string) => `VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=${n} --query "Vpcs[0].VpcId" --output text)`;
const INST = (v: string, n: string) => `${v}=$(aws ec2 describe-instances --filters Name=tag:Name,Values=${n} --query "Reservations[0].Instances[0].InstanceId" --output text)`;

export const AWS_REF_CONN: AwsRef[] = [
  {
    name: 'VPC Peering',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Conexión privada y directa entre dos VPC (de la misma o de distinta cuenta o región) para que sus recursos se hablen por IP privada. No es transitiva y exige CIDR que no se solapen.',
    details: `
Pasos: **solicitar** el peering → la otra parte lo **acepta** → añadir una **ruta en cada VPC** hacia el CIDR de la otra con destino \`pcx-…\` → permitir el tráfico en los **security groups** (y NACL).

Reglas que fallan en los exámenes:

- **No transitivo**: si A↔B y B↔C, A **no** llega a C pasando por B (ni usa la salida a internet o el VPN de B).
- **CIDR sin solaparse**: si dos VPC usan \`10.0.0.0/16\`, no se pueden conectar.
- **Las rutas son de ida y de vuelta**: si falta la ruta de B hacia A, los paquetes llegan pero la respuesta no vuelve.
- Sin ancho de banda extra ni punto único de fallo: usa la red de AWS. Tráfico entre zonas distintas se cobra por GB; no hay coste por hora.
- Un security group puede nombrar a otro de una VPC pareada en la misma región; los CIDR siempre funcionan.
`,
    whenUse: ['Pocas VPC (2–5) que deben comunicarse con mucho tráfico y sin coste por hora', 'Conectar la VPC de una aplicación con la de datos o la de otra cuenta'],
    whenNot: ['Decenas de VPC: crecen como n·(n−1)/2 conexiones, usa Transit Gateway', 'Solo quieres compartir un servicio con otras redes: PrivateLink'],
    pricing: 'Sin cargo por la conexión; el tráfico entre zonas de disponibilidad o regiones se cobra por GB.',
    limits: ['125 peerings activos por VPC (ampliable)', 'Sin enrutamiento transitivo'],
    scenario: 'net-peering-roto',
    examples: [
      ['aws ec2 describe-vpc-peering-connections --query "VpcPeeringConnections[].[VpcPeeringConnectionId,Status.Code]" --output table', 'Peering activo'],
      ['aws ec2 describe-route-tables --query "RouteTables[].Routes[?VpcPeeringConnectionId][].[DestinationCidrBlock,VpcPeeringConnectionId,State]" --output table', 'Solo una VPC tiene la ruta: falta la de vuelta'],
    ],
    seeAlso: ['Transit Gateway', 'Peering, Transit Gateway, PrivateLink y VPN', 'aws ec2 create-vpc-peering-connection'],
  },
  {
    name: 'aws ec2 create-vpc-peering-connection',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ec2 create-vpc-peering-connection --vpc-id <vpc-origen> --peer-vpc-id <vpc-destino> [--peer-region <r>] [--peer-owner-id <cuenta>]',
    summary: 'Solicita un peering entre dos VPC. Queda `pending-acceptance` hasta que la otra parte ejecute `accept-vpc-peering-connection`.',
    details: 'Falla si los CIDR se solapan o si ya existe un peering entre las dos VPC. Después de aceptarlo hay que crear las rutas en **las dos** tablas.',
    scenario: 'net-peering',
    examples: [
      [VPC('app')],
      ['VPC2=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=datos --query "Vpcs[0].VpcId" --output text)'],
      ['PCX=$(aws ec2 create-vpc-peering-connection --vpc-id $VPC --peer-vpc-id $VPC2 --query VpcPeeringConnection.VpcPeeringConnectionId --output text)'],
      ['aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id $PCX --query VpcPeeringConnection.Status.Code --output text', 'Ya activo'],
      ['aws ec2 create-vpc-peering-connection --vpc-id $VPC2 --peer-vpc-id $VPC', 'Ya existe un peering entre las dos', 'error'],
    ],
    seeAlso: ['VPC Peering'],
  },
  {
    name: 'Transit Gateway',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Un «router» regional y gestionado al que conectas muchas VPC, VPN y Direct Connect. Con sus tablas de rutas decides quién se ve con quién. Es transitivo y escala a miles de redes.',
    details: `
Piezas:

- **Transit Gateway (TGW)**: el centro, en una región.
- **Adjuntos** (_attachments_): cada VPC, VPN, Direct Connect gateway o peering de TGW se conecta con un adjunto. Los de VPC piden **una subred por zona**.
- **Tablas de rutas del TGW**: cada adjunto se **asocia** a una tabla (la que consulta cuando le llega tráfico) y puede **propagar** su CIDR a una o varias tablas (para que otros lo vean). Con la tabla por defecto, todos ven a todos.
- Las **VPC siguen necesitando una ruta** en sus propias tablas hacia el TGW (p. ej. \`10.0.0.0/8 → tgw-…\`).

**Segmentación**: crea tablas distintas (producción, desarrollo, compartida) y propaga solo lo que cada una debe ver. Recuerda que la **respuesta** también cruza el TGW: la tabla del otro adjunto debe saber volver.
`,
    whenUse: ['Muchas VPC y/o varias sedes conectadas (hub-and-spoke)', 'Segmentar redes (prod/dev/compartida) con tablas de rutas', 'Una sola VPN a la oficina para todas las VPC'],
    whenNot: ['Dos VPC con mucho tráfico: el peering es más barato (no hay cargo por adjunto ni por GB de TGW)'],
    pricing: 'Por hora por adjunto y por GB procesado. Más caro que el peering, pero simplifica mucho la red.',
    limits: ['5 000 adjuntos por TGW', 'Las VPC conectadas no pueden tener CIDR solapados', 'Ancho de banda de 50 Gbps por adjunto de VPC (ráfaga)'],
    scenario: 'net-tgw-adjuntas',
    examples: [
      ['aws ec2 describe-transit-gateways --query "TransitGateways[].[TransitGatewayId,State]" --output table'],
      ['aws ec2 describe-transit-gateway-vpc-attachments --query "TransitGatewayVpcAttachments[].[TransitGatewayAttachmentId,VpcId,State]" --output table', 'Una VPC por adjunto'],
      ['RT=$(aws ec2 describe-transit-gateway-route-tables --query "TransitGatewayRouteTables[0].TransitGatewayRouteTableId" --output text)'],
      ['aws ec2 search-transit-gateway-routes --transit-gateway-route-table-id $RT --filters Name=type,Values=propagated --query "Routes[].[DestinationCidrBlock,Type,State]" --output table', 'Cada VPC propaga su CIDR a la tabla por defecto'],
    ],
    seeAlso: ['Asociación y propagación (TGW)', 'VPC Peering', 'aws ec2 create-transit-gateway'],
  },
  {
    name: 'Asociación y propagación (TGW)',
    kind: 'concepto',
    category: 'redes',
    level: 3,
    summary: 'La asociación elige QUÉ tabla consulta un adjunto cuando le llega tráfico. La propagación elige EN QUÉ tablas aparece el CIDR de ese adjunto. Con las dos se dibujan aislamientos.',
    details: `
Un adjunto está **asociado a una sola tabla** y **propaga a las que quieras**. Regla para razonar:

> «Para que **A llegue a B** hace falta que la tabla **asociada a A** tenga una ruta hacia B (B propaga ahí o hay una ruta estática). Para que **vuelva la respuesta**, la tabla asociada a B debe tener ruta hacia A.»

Patrones:

| Patrón | Cómo |
| --- | --- |
| Todos ven a todos | Una tabla; todos se asocian y propagan a ella |
| Aislar desarrollo de producción | Dos tablas; dev asociado a «dev» (propaga solo compartida); prod a «prod» |
| Servicios compartidos | Compartida propaga en todas las tablas; los radios solo propagan en la de compartida |
| Inspección central | Ruta estática \`0.0.0.0/0\` → adjunto del firewall |
`,
    scenario: 'net-tgw-adjuntas',
    examples: [
      ['RT=$(aws ec2 describe-transit-gateway-route-tables --query "TransitGatewayRouteTables[0].TransitGatewayRouteTableId" --output text)'],
      ['aws ec2 get-transit-gateway-route-table-associations --transit-gateway-route-table-id $RT --query "Associations[].[ResourceId,State]" --output table', 'Qué adjuntos consultan esta tabla'],
      ['aws ec2 get-transit-gateway-route-table-propagations --transit-gateway-route-table-id $RT --query "TransitGatewayRouteTablePropagations[].[ResourceId,State]" --output table', 'Qué adjuntos anuncian su CIDR en ella'],
    ],
    seeAlso: ['Transit Gateway'],
  },
  {
    name: 'aws ec2 create-transit-gateway',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ec2 create-transit-gateway [--description <texto>] [--options DefaultRouteTableAssociation=disable,DefaultRouteTablePropagation=disable]',
    summary: 'Crea un Transit Gateway (tarda un minuto en estar `available`). Conecta después las VPC con `create-transit-gateway-vpc-attachment` y añade rutas en cada VPC.',
    details: 'Por defecto asocia y propaga todos los adjuntos a una tabla única (todos ven a todos). Para segmentar, desactiva las dos opciones por defecto y crea tus tablas.',
    scenario: 'net-tgw',
    examples: [
      ['aws ec2 create-transit-gateway --description central --query TransitGateway.State --output text', 'pending: espera un minuto'],
      ['aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id $(aws ec2 describe-transit-gateways --query "TransitGateways[0].TransitGatewayId" --output text) --vpc-id $(aws ec2 describe-vpcs --filters Name=tag:Name,Values=app --query "Vpcs[0].VpcId" --output text) --subnet-ids $(aws ec2 describe-subnets --filters Name=tag:Name,Values=app-sub --query "Subnets[0].SubnetId" --output text)', 'Todavía no está disponible', 'error'],
      ['sleep 70'],
      ['aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id $(aws ec2 describe-transit-gateways --query "TransitGateways[0].TransitGatewayId" --output text) --vpc-id $(aws ec2 describe-vpcs --filters Name=tag:Name,Values=app --query "Vpcs[0].VpcId" --output text) --subnet-ids $(aws ec2 describe-subnets --filters Name=tag:Name,Values=app-sub --query "Subnets[0].SubnetId" --output text) --query TransitGatewayVpcAttachment.State --output text', 'Ahora sí'],
    ],
    seeAlso: ['Transit Gateway'],
  },
  {
    name: 'VPC Endpoint',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Entrada privada a un servicio de AWS desde tu VPC sin internet, NAT ni IP pública. De puerta de enlace (S3 y DynamoDB, gratis) o de interfaz (la mayoría de servicios, con IP privada propia).',
    details: `
| | **Gateway** | **Interface** (PrivateLink) |
| --- | --- | --- |
| Servicios | **S3 y DynamoDB** | SQS, SNS, SSM, KMS, Secrets Manager, ECR, API Gateway… y servicios de terceros |
| Cómo funciona | Una **ruta** en la tabla de rutas (lista de prefijos → \`vpce-…\`) | Una **interfaz de red (ENI)** con IP privada en tus subredes |
| Control de acceso | **Política del endpoint** + política del bucket | Política del endpoint + **security group** del endpoint |
| Coste | **Gratis** | Por hora y por GB |
| Desde on-premises / otra VPC | No | Sí (por VPN, Direct Connect o peering) |

Con un endpoint de interfaz, el **DNS privado** hace que \`sqs.us-east-1.amazonaws.com\` resuelva a la IP privada del endpoint: tu código no cambia. Requiere **DNS support y DNS hostnames** activados en la VPC.

Una **política de bucket** puede exigir que solo se acceda a través del endpoint (\`"aws:SourceVpce": "vpce-…"\`).
`,
    whenUse: ['Servidores en subredes privadas que leen de S3 o DynamoDB sin pagar NAT', 'Cumplimiento: que el tráfico no salga a internet', 'Acceder a servicios de AWS desde una VPC sin internet gateway'],
    whenNot: ['Ya tienes un NAT por otras razones y poco tráfico a S3 (aunque el endpoint de puerta sigue siendo gratis y más seguro)'],
    pricing: 'Gateway: sin cargo. Interface: por hora por zona y por GB procesado.',
    scenario: 'net-endpoints-sg',
    examples: [
      ['aws ec2 describe-vpc-endpoints --query "VpcEndpoints[].[VpcEndpointId,ServiceName,VpcEndpointType,State]" --output table', 'Un endpoint de interfaz de SQS'],
      ['aws ec2 describe-network-interfaces --filters Name=description,Values="VPC Endpoint Interface*" --query "NetworkInterfaces[].[NetworkInterfaceId,PrivateIpAddress,InterfaceType]" --output table', 'Su interfaz de red con IP privada'],
      ['aws ec2 describe-prefix-lists --query "PrefixLists[].[PrefixListName,PrefixListId]" --output table', 'La lista de prefijos de S3 que usa un endpoint de puerta'],
      [VPC('tienda')],
      ['aws ec2 create-vpc-endpoint --vpc-id $VPC --service-name com.amazonaws.us-east-1.s3', 'Un endpoint de puerta necesita tablas de rutas', 'error'],
    ],
    seeAlso: ['AWS PrivateLink', 'Lista de prefijos', 'aws ec2 create-vpc-endpoint'],
  },
  {
    name: 'aws ec2 create-vpc-endpoint',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ec2 create-vpc-endpoint --vpc-id <vpc> --service-name com.amazonaws.<región>.<servicio> [--vpc-endpoint-type Gateway|Interface] [--route-table-ids <rtb>…] [--subnet-ids <sn>…] [--security-group-ids <sg>…] [--private-dns-enabled]',
    summary: 'Crea un endpoint. De puerta: `--route-table-ids` (añade la ruta sola). De interfaz: `--subnet-ids` y `--security-group-ids` (el grupo debe admitir el puerto 443 desde tu VPC).',
    scenario: 'net-endpoints',
    examples: [
      [VPC('tienda')],
      ['RTB=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC --query "RouteTables[0].RouteTableId" --output text)'],
      ['aws ec2 create-vpc-endpoint --vpc-id $VPC --service-name com.amazonaws.us-east-1.s3 --route-table-ids $RTB --query VpcEndpoint.[VpcEndpointId,VpcEndpointType] --output text', 'Endpoint de puerta para S3'],
      ['aws ec2 describe-route-tables --route-table-ids $RTB --query "RouteTables[0].Routes[].[DestinationPrefixListId,GatewayId]" --output table', 'La ruta nueva apunta a la lista de prefijos'],
    ],
    seeAlso: ['VPC Endpoint'],
  },
  {
    name: 'AWS PrivateLink',
    kind: 'servicio',
    category: 'redes',
    level: 3,
    summary: 'Publica un servicio (detrás de un NLB) para que otras VPC y cuentas lo consuman por una interfaz privada, sin peering, sin solapes de CIDR y sin exponer el resto de tu red.',
    details: `
El **proveedor** pone su servicio detrás de un **Network Load Balancer** y crea una **configuración de servicio de endpoint**; puede exigir **aceptar** cada conexión y limitar qué cuentas pueden conectarse. Cada **consumidor** crea un **endpoint de interfaz** hacia ese servicio en su VPC.

Solo fluye **tráfico del consumidor al proveedor** y solo hacia ese servicio (nunca a toda la VPC). Los CIDR pueden solaparse. Es la forma de vender un SaaS a clientes que usan AWS o de compartir una API interna entre cuentas.
`,
    whenUse: ['Exponer un único servicio a muchas VPC o cuentas', 'Redes con CIDR solapados que no pueden conectarse por peering'],
    whenNot: ['Necesitas conectar redes completas entre sí (peering o Transit Gateway)'],
    scenario: 'net-endpoints',
    examples: [['aws ec2 describe-vpc-endpoint-service-configurations --query ServiceConfigurations', 'Todavía no hay servicios publicados']],
    seeAlso: ['VPC Endpoint', 'Peering, Transit Gateway, PrivateLink y VPN'],
  },
  {
    name: 'Lista de prefijos',
    kind: 'concepto',
    category: 'redes',
    level: 3,
    summary: 'Conjunto con nombre de CIDR que puedes usar en rutas y reglas de security group. AWS mantiene las de S3 y DynamoDB; tú puedes crear las tuyas.',
    details: 'Los endpoints de puerta añaden a la tabla de rutas una ruta cuyo destino es la **lista de prefijos** del servicio (`pl-…`), no un CIDR. Así AWS actualiza las direcciones sin que toques nada.',
    scenario: 'net-endpoints',
    examples: [['aws ec2 describe-prefix-lists --query "PrefixLists[].[PrefixListName,PrefixListId,Cidrs[0]]" --output table']],
    seeAlso: ['VPC Endpoint'],
  },
  {
    name: 'VPN de sitio a sitio',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Túneles IPsec cifrados por internet entre tu red (oficina o centro de datos) y una VPC o un Transit Gateway. Se monta en minutos y cada conexión incluye dos túneles.',
    details: `
Tres piezas:

1. **Puerta del cliente** (_customer gateway_): AWS necesita la **IP pública** de tu router/firewall y su ASN (para BGP).
2. **Puerta de enlace privada virtual** (_virtual private gateway_, VGW) conectada a **una** VPC, o un **Transit Gateway**: el extremo del lado AWS.
3. **Conexión VPN**: crea **dos túneles** (en zonas distintas) para redundancia.

Enrutamiento: **dinámico (BGP)** — tu router anuncia sus redes y AWS las aprende (recomendado) — o **estático** — tú declaras los CIDR de la oficina con \`create-vpn-connection-route\`; sin rutas estáticas el túnel se queda **DOWN**.

En la VPC, activa la **propagación de rutas** de la VGW en la tabla de rutas (\`enable-vgw-route-propagation\`) o añade la ruta a mano. Y recuerda los security groups: tienen que admitir el CIDR de la oficina.
`,
    whenUse: ['Conectar una oficina a AWS rápido y barato', 'Respaldo de Direct Connect', 'Cifrado en tránsito hacia on-premises'],
    whenNot: ['Necesitas varios Gbps o latencia estable: Direct Connect', 'Un portátil que se conecta desde casa: Client VPN o Session Manager'],
    pricing: 'Por hora por conexión VPN y por GB de salida de datos.',
    limits: ['≈1,25 Gbps por túnel', 'Dos túneles por conexión; solo uno lleva tráfico a la vez salvo ECMP con Transit Gateway'],
    scenario: 'net-vpn-rota',
    examples: [
      ['aws ec2 describe-customer-gateways --query "CustomerGateways[].[CustomerGatewayId,IpAddress,BgpAsn]" --output table', 'El router de la oficina'],
      ['aws ec2 describe-vpn-connections --query "VpnConnections[0].VgwTelemetry[].[OutsideIpAddress,Status,StatusMessage]" --output table', 'Dos túneles UP (rutas por BGP)'],
      ['aws ec2 describe-route-tables --query "RouteTables[].Routes[?starts_with(GatewayId, \'vgw-\')][].DestinationCidrBlock"', 'Aún no hay rutas hacia la oficina: falta propagarlas'],
    ],
    seeAlso: ['AWS Direct Connect', 'Transit Gateway', 'aws ec2 create-vpn-connection'],
  },
  {
    name: 'aws ec2 create-vpn-connection',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id <cgw> (--vpn-gateway-id <vgw> | --transit-gateway-id <tgw>) [--options StaticRoutesOnly=true]',
    summary: 'Crea la VPN. Los túneles tardan unos minutos en subir (UP). Con `StaticRoutesOnly=true` hay que declarar después las redes de la oficina con `create-vpn-connection-route`.',
    scenario: 'net-vpn',
    examples: [
      ['CGW=$(aws ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.50 --bgp-asn 65000 --query CustomerGateway.CustomerGatewayId --output text)'],
      ['VGW=$(aws ec2 create-vpn-gateway --type ipsec.1 --query VpnGateway.VpnGatewayId --output text)'],
      [VPC('tienda')],
      ['aws ec2 attach-vpn-gateway --vpn-gateway-id $VGW --vpc-id $VPC'],
      ['VPN=$(aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id $CGW --vpn-gateway-id $VGW --options StaticRoutesOnly=true --query VpnConnection.VpnConnectionId --output text)'],
      ['aws ec2 describe-vpn-connections --vpn-connection-ids $VPN --query "VpnConnections[0].VgwTelemetry[].[Status,StatusMessage]" --output table', 'DOWN: no hay rutas estáticas'],
      ['aws ec2 create-vpn-connection-route --vpn-connection-id $VPN --destination-cidr-block 192.168.0.0/16'],
      ['sleep 200'],
      ['aws ec2 describe-vpn-connections --vpn-connection-ids $VPN --query "VpnConnections[0].VgwTelemetry[].Status" --output text', 'Los dos túneles suben'],
      ['aws ec2 create-customer-gateway --type ipsec.1 --public-ip 192.168.1.1', 'Es una IP privada: hace falta la pública del router', 'error'],
    ],
    seeAlso: ['VPN de sitio a sitio'],
  },
  {
    name: 'AWS Direct Connect',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Un cable dedicado (1, 10 o 100 Gbps) entre tu centro de datos y AWS, desde una ubicación de colocación. Latencia estable y ancho de banda alto, pero tarda semanas y no cifra por sí solo.',
    details: `
- Se pide un **puerto** en una **ubicación de Direct Connect**; un proveedor tiende el cable (semanas). También hay conexiones alojadas con partners (50 Mbps–25 Gbps).
- Sobre el cable se crean **interfaces virtuales** (VIF): **privada** (a una VPC/VGW o a un Direct Connect gateway), **pública** (servicios públicos de AWS como S3) y **de tránsito** (a un Transit Gateway).
- Un **Direct Connect gateway** conecta un enlace con VPC o Transit Gateway de **varias regiones**.
- **No está cifrado**: si lo necesitas, ejecuta una **VPN IPsec sobre Direct Connect** o usa MACsec en puertos de 10/100 Gbps.
- Para alta disponibilidad: **dos enlaces en ubicaciones distintas** o un enlace + **VPN de respaldo**.
`,
    whenUse: ['Mucho tráfico sostenido hacia AWS (copias, datos, híbrido)', 'Latencia predecible', 'Reducir costes de salida de datos'],
    whenNot: ['Lo necesitas hoy o es una oficina pequeña: VPN'],
    pricing: 'Por hora de puerto y por GB transferido (la salida cuesta menos que por internet).',
    scenario: 'net-vpn',
    examples: [
      ['aws directconnect describe-locations --query "locations[].[locationCode,locationName]" --output table'],
      ['aws directconnect create-connection --location EqDC2 --bandwidth 1Gbps --connection-name sede-madrid --query connectionState --output text', 'Pedido: «ordering»'],
      ['aws directconnect create-connection --location XX --bandwidth 1Gbps --connection-name malo', 'Ubicación inexistente', 'error'],
    ],
    seeAlso: ['VPN de sitio a sitio', 'Peering, Transit Gateway, PrivateLink y VPN'],
  },
  {
    name: 'Peering, Transit Gateway, PrivateLink y VPN',
    kind: 'comparativa',
    category: 'redes',
    level: 2,
    summary: 'Cuatro formas de conectar redes: elige según cuántas redes hay, qué debe verse y quién está al otro lado.',
    versus: [
      ['VPC Peering', 'Dos VPC, punto a punto, barato, sin transitividad ni solapes. Ideal para 2–5 VPC.'],
      ['Transit Gateway', 'Muchas VPC y sedes con tablas de rutas (segmentación). Cobra por adjunto y GB. Es el estándar a escala.'],
      ['PrivateLink', 'Solo un servicio, en un sentido (consumidor → proveedor). Permite CIDR solapados y cuentas distintas.'],
      ['VPN de sitio a sitio', 'Oficina ↔ AWS cifrada por internet, en minutos. Hasta ≈1,25 Gbps por túnel.'],
      ['Direct Connect', 'Oficina ↔ AWS por cable dedicado: ancho de banda y latencia estables; semanas y sin cifrado propio.'],
    ],
    seeAlso: ['VPC Peering', 'Transit Gateway', 'AWS PrivateLink', 'VPN de sitio a sitio', 'AWS Direct Connect'],
  },
  {
    name: 'VPC Flow Logs',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Registro del tráfico IP que entra y sale de las interfaces de red de una VPC, subred o ENI: origen, destino, puertos, bytes y si se aceptó (ACCEPT) o se rechazó (REJECT).',
    details: `
Se publican en **CloudWatch Logs**, **S3** o **Firehose**. Cada registro (formato v2) tiene:

\`versión  cuenta  interfaz  srcaddr  dstaddr  srcport  dstport  protocolo  paquetes  bytes  inicio  fin  acción  estado\`

\`2 123456789012 eni-0a1 198.51.100.23 10.0.1.10 51234 22 6 20 840 1700000000 1700000060 ACCEPT OK\`

- **ACCEPT/REJECT** lo deciden security groups y NACL. Un **REJECT** no te dice cuál: mira ambos (el Reachability Analyzer te lo dice).
- **No** registra: tráfico DNS a Route 53 Resolver, metadatos de la instancia (169.254.169.254), DHCP ni el tráfico espejo.
- Los registros se agregan en ventanas de **1 o 10 minutos** (no es en tiempo real).
- Para CloudWatch Logs hace falta un **rol** con relación de confianza con \`vpc-flow-logs.amazonaws.com\` y permisos de \`logs:CreateLogStream\` y \`logs:PutLogEvents\`. Si no, el flow log se crea pero la entrega **falla** (_Access error_).
`,
    whenUse: ['Averiguar por qué una conexión no funciona (REJECT)', 'Detectar escaneos y accesos sospechosos', 'Auditoría y análisis de tráfico (con Athena sobre S3)'],
    whenNot: ['No sustituye a una captura de paquetes (Traffic Mirroring) ni ve el contenido'],
    pricing: 'Cargo por GB ingerido en el destino (CloudWatch Logs es más caro que S3).',
    scenario: 'net-diag',
    examples: [
      ['aws logs describe-log-groups --query "logGroups[].logGroupName"', 'Un grupo con un histórico de tráfico'],
      ['aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern REJECT --query "events[0].message" --output text', 'Un paquete rechazado'],
      ['aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern ACCEPT --query "events[].message" --output text | tr "\\t" "\\n" | awk \'{print $4}\' | sort | uniq -c | sort -rn | head -3', 'Quién habla más con el servidor web'],
      ['aws iam get-role --role-name flowlogs-role --query Role.AssumeRolePolicyDocument.Statement[0].Principal.Service --output text', 'El rol confía en EC2, no en vpc-flow-logs: la entrega fallaría'],
    ],
    seeAlso: ['Reachability Analyzer', 'Amazon CloudWatch Logs', 'aws ec2 create-flow-logs'],
  },
  {
    name: 'aws ec2 create-flow-logs',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ec2 create-flow-logs --resource-type VPC|Subnet|NetworkInterface --resource-ids <id>… --traffic-type ACCEPT|REJECT|ALL (--log-group-name <g> --deliver-logs-permission-arn <rol> | --log-destination-type s3 --log-destination arn:aws:s3:::<bucket>) [--log-format \'${srcaddr} ${dstaddr} ${action}\']',
    summary: 'Activa los flow logs de una VPC, subred o interfaz. Después de crearlo, comprueba `describe-flow-logs`: `DeliverLogsStatus` debe ser `SUCCESS`.',
    scenario: 'net-diag',
    examples: [
      [VPC('tienda')],
      ['aws ec2 create-flow-logs --resource-type VPC --resource-ids $VPC --traffic-type ALL --log-group-name /vpc/tienda', 'Falta el rol de entrega', 'error'],
      ['ROLE=$(aws iam get-role --role-name flowlogs-role --query Role.Arn --output text)'],
      ['aws ec2 create-flow-logs --resource-type VPC --resource-ids $VPC --traffic-type REJECT --log-group-name /vpc/tienda/rechazos --deliver-logs-permission-arn $ROLE --query FlowLogIds --output text'],
      ['aws ec2 describe-flow-logs --query "FlowLogs[].[FlowLogId,DeliverLogsStatus,DeliverLogsErrorMessage]" --output table', 'FAILED · Access error: la relación de confianza del rol está mal'],
    ],
    seeAlso: ['VPC Flow Logs'],
  },
  {
    name: 'Reachability Analyzer',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Analiza la configuración de la red (rutas, NACL, security groups, gateways…) entre un origen y un destino y dice si hay camino. Si no, nombra el componente que lo corta. No envía paquetes.',
    details: `
Se define un **camino** (origen, destino, protocolo, puerto) y se **analiza**. El resultado:

- \`NetworkPathFound: true\` + los componentes del camino, o
- \`false\` + **explicaciones** con un código y el recurso culpable:

| Código | Significa |
| --- | --- |
| \`NO_ROUTE_TO_DESTINATION\` | La tabla de rutas no tiene ruta al destino |
| \`ENI_SG_RULES_MISMATCH\` | Ningún security group lo permite |
| \`SUBNET_ACL_RESTRICTION\` | Una NACL lo bloquea |
| \`IGW_NOT_ATTACHED\` | Falta la puerta de internet |
| \`VPC_PEERING_CONNECTION_NOT_ACTIVE\` | El peering no está aceptado |
| \`TRANSIT_GATEWAY_ROUTE_MISSING\` | La tabla del TGW no conoce el destino |
| \`VPN_TUNNEL_DOWN\` | Los túneles están caídos |

Complementa a los **Flow Logs**: el analizador responde «¿debería funcionar?» sin tráfico; los Flow Logs responden «¿qué pasó de verdad?».
`,
    whenUse: ['Cuando una conexión «no llega» y no sabes qué capa falla', 'Validar un cambio de red antes de producción', 'Auditorías de conectividad (¿puede X llegar a Y?)'],
    whenNot: ['No ve el firewall del sistema operativo ni si la aplicación escucha', 'No sustituye a una prueba real de extremo a extremo'],
    pricing: 'Se cobra por cada análisis ejecutado.',
    scenario: 'net-diag',
    examples: [
      [INST('WEB', 'web')],
      [INST('APP', 'app')],
      ['NIP=$(aws ec2 create-network-insights-path --source $WEB --destination $APP --protocol tcp --destination-port 8080 --query NetworkInsightsPath.NetworkInsightsPathId --output text)'],
      ['aws ec2 start-network-insights-analysis --network-insights-path-id $NIP --query "NetworkInsightsAnalysis.[NetworkPathFound,Explanations[0].ExplanationCode,Explanations[0].SecurityGroups[0].Id]"', 'ENI_SG_RULES_MISMATCH y el grupo culpable'],
    ],
    seeAlso: ['VPC Flow Logs', 'aws ec2 start-network-insights-analysis'],
  },
  {
    name: 'aws ec2 start-network-insights-analysis',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ec2 start-network-insights-analysis --network-insights-path-id <nip-…>',
    summary: 'Ejecuta el análisis de un camino definido con `create-network-insights-path`. Lee `NetworkPathFound` y `Explanations`.',
    scenario: 'net-diag',
    examples: [
      [INST('WEB', 'web')],
      [INST('APP', 'app')],
      ['NIP=$(aws ec2 create-network-insights-path --source $WEB --destination $APP --protocol tcp --destination-port 8081 --query NetworkInsightsPath.NetworkInsightsPathId --output text)'],
      ['aws ec2 start-network-insights-analysis --network-insights-path-id $NIP --query "NetworkInsightsAnalysis.NetworkPathFound"', 'El puerto 8081 sí está permitido'],
      ['aws ec2 start-network-insights-analysis --network-insights-path-id nip-00000000000000000', 'Camino inexistente', 'error'],
    ],
    seeAlso: ['Reachability Analyzer'],
  },
  {
    name: 'Session Manager',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Parte de Systems Manager: abre una shell en una instancia por HTTPS sin SSH, sin puerto 22, sin claves ni bastión. El acceso se controla con IAM y cada sesión queda auditada.',
    details: `
Para que una instancia aparezca «administrada» (_Online_) necesita las **tres** cosas:

1. **SSM Agent** (viene instalado en Amazon Linux y Ubuntu recientes).
2. Un **perfil de instancia** con un rol que lleve la política **\`AmazonSSMManagedInstanceCore\`** (relación de confianza con \`ec2.amazonaws.com\`).
3. **Salida de red** hacia los servicios de SSM: un NAT/IGW **o** tres endpoints de interfaz (\`ssm\`, \`ssmmessages\`, \`ec2messages\`) con DNS privado.

Ventajas frente a un bastión: **sin puertos entrantes**, permisos con **IAM** (y MFA), **registro** de las sesiones en CloudTrail/S3/CloudWatch Logs, reenvío de puertos y **Run Command** para ejecutar órdenes en cientos de instancias a la vez.
`,
    whenUse: ['Administrar servidores sin exponer SSH', 'Instancias en subredes privadas', 'Auditar quién entró y qué ejecutó'],
    whenNot: ['Cuando una herramienta necesita SSH puro y un túnel (se puede reenviar con `start-session` y el documento de reenvío de puertos)'],
    pricing: 'Sin cargo adicional para instancias EC2 (las funciones avanzadas y los endpoints sí se cobran).',
    scenario: 'net-ssm-rol',
    examples: [
      [INST('INST', 'app-1')],
      ['aws ssm describe-instance-information --query "InstanceInformationList[].InstanceId"', 'Todavía no aparece: sin perfil de instancia'],
      ['aws ec2 associate-iam-instance-profile --instance-id $INST --iam-instance-profile Name=ssm-ec2 --query IamInstanceProfileAssociation.State --output text'],
      ['aws ssm describe-instance-information --query "InstanceInformationList[].[InstanceId,PingStatus,PlatformName]" --output table', 'Ahora sí: Online'],
      ['aws ssm start-session --target $INST --query SessionId --output text', 'Con el plugin de Session Manager abrirías la shell'],
    ],
    seeAlso: ['Run Command', 'Bastión (jump host)'],
  },
  {
    name: 'Run Command',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Ejecuta órdenes (documento `AWS-RunShellScript`) en una o muchas instancias administradas a la vez, sin conectarte a ninguna, y guarda la salida de cada una.',
    details: 'Elige destinos por **id** o por **etiqueta** (`Key=tag:Rol,Values=web`). Cada instancia devuelve estado (`Success`/`Failed`), salida estándar, error y código de salida. Se puede limitar la concurrencia y el porcentaje de errores (`--max-concurrency`, `--max-errors`) para no romper toda la flota. Además de `AWS-RunShellScript` hay documentos como `AWS-RunPatchBaseline` o `AWS-UpdateSSMAgent`, y puedes escribir los tuyos. Quien lanza necesita `ssm:SendCommand` (limitable por etiqueta) y todo queda en CloudTrail. `list-command-invocations` da el estado por instancia y `get-command-invocation`, su salida.',
    scenario: 'net-ssm-rol',
    examples: [
      [INST('INST', 'app-1')],
      ['aws ec2 associate-iam-instance-profile --instance-id $INST --iam-instance-profile Name=ssm-ec2'],
      ['CMD=$(aws ssm send-command --document-name AWS-RunShellScript --instance-ids $INST --parameters commands=hostname --query Command.CommandId --output text)'],
      ['aws ssm get-command-invocation --command-id $CMD --instance-id $INST --query "[Status,StandardOutputContent]"', 'El nombre de la máquina'],
      ['aws ssm send-command --document-name AWS-RunShellScript --instance-ids i-00000000000000000 --parameters commands=hostname', 'Instancia que no es administrada', 'error'],
    ],
    seeAlso: ['Session Manager', 'aws ssm send-command'],
  },
  {
    name: 'aws ssm send-command',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws ssm send-command --document-name AWS-RunShellScript (--instance-ids <i-…> | --targets Key=tag:<clave>,Values=<v>) --parameters commands="cmd1","cmd2"',
    summary: 'Lanza órdenes en instancias administradas. Devuelve un `CommandId`; consulta el resultado con `get-command-invocation` o `list-command-invocations --details`.',
    scenario: 'net-ssm-rol',
    examples: [
      [INST('INST', 'app-1')],
      ['aws ec2 associate-iam-instance-profile --instance-id $INST --iam-instance-profile Name=ssm-ec2'],
      ['CMD=$(aws ssm send-command --document-name AWS-RunShellScript --instance-ids $INST --parameters commands=hostname,"cat /var/www/html/index.html" --query Command.CommandId --output text)'],
      ['aws ssm list-command-invocations --command-id $CMD --details --query "CommandInvocations[0].CommandPlugins[0].Output" --output text'],
    ],
    seeAlso: ['Run Command'],
  },
  {
    name: 'Bastión (jump host)',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Servidor público con SSH abierto que sirve de puerta de entrada a los servidores privados. Funciona, pero es una superficie de ataque que hay que parchear, vigilar y rotar sus claves. Hoy se prefiere Session Manager.',
    details: `
Buenas prácticas si aún usas uno: abrir el puerto 22 **solo a tus IP**, usar **claves** (no contraseñas) y **MFA**, instancia mínima y parcheada, **registrar** las sesiones y apagarlo cuando no se use. La alternativa moderna: **Session Manager** (sin puertos entrantes) o **EC2 Instance Connect Endpoint**.
`,
    seeAlso: ['Session Manager', 'Security group'],
  },
  {
    name: 'IPv6 en la VPC',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Una VPC puede ser de doble pila: además del CIDR IPv4 recibe un bloque IPv6 /56 de AWS y cada subred un /64. Las direcciones IPv6 son públicas y globales: no hay NAT, se controla con rutas y security groups.',
    details: `
- Asocia el bloque a la VPC (\`associate-vpc-cidr-block --amazon-provided-ipv6-cidr-block\`) y un **/64** a cada subred (\`associate-subnet-cidr-block\`).
- Ruta pública: \`::/0\` → **internet gateway**. Ruta privada de solo salida: \`::/0\` → **egress-only internet gateway** (permite que salgan conexiones, no que entren).
- Los security groups y NACL tienen reglas **IPv6 propias** (\`::/0\`): una regla \`0.0.0.0/0\` no cubre IPv6.
- No necesitas NAT gateway para IPv6, así que ahorras ese coste.
`,
    scenario: 'net-ipv6',
    examples: [
      [VPC('tienda')],
      ['aws ec2 associate-vpc-cidr-block --vpc-id $VPC --amazon-provided-ipv6-cidr-block --query Ipv6CidrBlockAssociation.Ipv6CidrBlock --output text', 'Un bloque /56 de AWS'],
      ['aws ec2 describe-vpcs --vpc-ids $VPC --query "Vpcs[0].Ipv6CidrBlockAssociationSet[].Ipv6CidrBlock" --output text'],
    ],
    seeAlso: ['Egress-only internet gateway'],
  },
  {
    name: 'Egress-only internet gateway',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'El equivalente IPv6 de un NAT gateway para salida: deja que las instancias privadas inicien conexiones a internet por IPv6 y bloquea las que llegan desde fuera. Es gratuito y solo sirve para IPv6.',
    scenario: 'net-ipv6',
    examples: [
      [VPC('tienda')],
      ['aws ec2 create-egress-only-internet-gateway --vpc-id $VPC --query EgressOnlyInternetGateway.EgressOnlyInternetGatewayId --output text'],
      ['aws ec2 describe-egress-only-internet-gateways --query "EgressOnlyInternetGateways[].[EgressOnlyInternetGatewayId,Attachments[0].VpcId]" --output table'],
    ],
    seeAlso: ['IPv6 en la VPC', 'NAT gateway'],
  },
  {
    name: 'Amazon CloudWatch Logs',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Almacén central de registros: grupos de registros con flujos dentro, retención configurable, búsqueda por patrón, métricas a partir de registros y suscripciones. Lo usan Lambda, Flow Logs, ECS y el agente de CloudWatch.',
    details: `
- **Grupo de registros** (_log group_): el contenedor; define **retención** y permisos. **Flujo** (_log stream_): una fuente (instancia, contenedor, invocación).
- Por defecto los registros se **conservan para siempre** (y se cobra el almacenamiento): define una retención (\`put-retention-policy\`).
- Patrones de filtro: \`ERROR\`, \`"texto exacto"\`, \`?ERROR ?WARN\` (alguno), \`-DEBUG\` (excluir).
- Se pueden convertir en **métricas** (filtros de métricas) y exportar a S3 o enviar en tiempo real a Lambda/Kinesis.
`,
    pricing: 'Por GB ingerido, por GB almacenado al mes y por GB escaneado en consultas (Logs Insights).',
    scenario: 'net-diag',
    examples: [
      ['aws logs describe-log-groups --query "logGroups[].[logGroupName,retentionInDays]" --output table', 'Sin retención: se guardan para siempre'],
      ['aws logs put-retention-policy --log-group-name /vpc/tienda/historico --retention-in-days 30'],
      ['aws logs describe-log-streams --log-group-name /vpc/tienda/historico --query "logStreams[].logStreamName" --output text'],
      ['aws logs get-log-events --log-group-name /vpc/tienda/historico --log-stream-name no-existe', 'Ese flujo no existe', 'error'],
    ],
    seeAlso: ['VPC Flow Logs', 'aws logs filter-log-events'],
  },
  {
    name: 'aws logs filter-log-events',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws logs filter-log-events --log-group-name <g> [--filter-pattern <patrón>] [--start-time <ms>] [--log-stream-names <s>…] [--query "events[].message" --output text]',
    summary: 'Busca en todos los flujos de un grupo los registros que cumplan un patrón. Con `--output text` y `awk`/`sort`/`uniq` se agrupan y cuentan.',
    scenario: 'net-diag',
    examples: [
      ['aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern "REJECT" --query "length(events)"', 'Cuántos paquetes rechazados'],
      ['aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern "?ACCEPT ?REJECT" --query "events[0].message" --output text', 'Cualquiera de los dos'],
      ['aws logs filter-log-events --log-group-name /no/existe', 'Grupo inexistente', 'error'],
    ],
    seeAlso: ['Amazon CloudWatch Logs'],
  },
];
