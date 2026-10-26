import type { AwsRef } from '../reference';

const LB_ARN = '$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)';
const TG_ARN = 'TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)';
const DNS = 'DNS=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text)';

export const AWS_REF_HA: AwsRef[] = [
  {
    name: 'Alta disponibilidad',
    kind: 'concepto',
    category: 'fundamentos',
    level: 2,
    summary: 'Que el servicio siga funcionando (o se recupere en minutos) cuando falla un componente: servidor, disco o zona de disponibilidad entera. Se consigue con redundancia, no con piezas más grandes.',
    details: `
**Alta disponibilidad (HA)** ≠ **tolerancia a fallos** ≠ **recuperación ante desastres**:

- **HA**: ante un fallo, el servicio sigue (quizá con una breve interrupción). Ej.: RDS Multi-AZ conmuta en 1–2 minutos.
- **Tolerancia a fallos**: ni un usuario nota nada. Más caro. Ej.: S3 repartido en varias zonas.
- **DR**: cómo volver a funcionar tras perder una región o los datos. Se mide con **RTO** (cuánto tarda) y **RPO** (cuántos datos pierdes).

Recetas: varias **zonas de disponibilidad**, balanceador, Auto Scaling con mínimo ≥ 2, base de datos Multi-AZ, aplicación **sin estado** y servicios gestionados multi-AZ (S3, DynamoDB, SQS, Lambda).
`,
    whenUse: ['Cualquier carga de producción que no pueda tolerar horas de caída'],
    whenNot: ['Entornos de desarrollo y pruebas: duplicar todo cuesta el doble y no hace falta'],
    seeAlso: ['Punto único de fallo', 'Multi-AZ', 'Zona de disponibilidad', 'Auto Scaling'],
  },
  {
    name: 'Punto único de fallo',
    kind: 'concepto',
    category: 'fundamentos',
    level: 2,
    summary: 'Una pieza de la arquitectura cuya caída tumba todo el servicio. Se busca preguntando de cada componente: «¿qué pasa si esto se cae?».',
    details: `
Puntos únicos de fallo típicos y su arreglo:

| Pieza | Arreglo |
| --- | --- |
| Una sola instancia EC2 | Grupo de Auto Scaling con **mínimo 2** y balanceador |
| Todo en una zona | Repartir en **2 o más zonas** |
| RDS sin Multi-AZ | **Multi-AZ** (o Aurora) |
| Un NAT gateway para todas las zonas | Un NAT **por zona** |
| Datos en un disco EBS de una instancia | S3, EFS o una base de datos gestionada |
| Sesiones guardadas en el servidor | ElastiCache o DynamoDB |
| Una sola región | Multi-región (si el negocio lo justifica) |
`,
    whenUse: ['Revisar una arquitectura antes de producción y en cada examen de arquitectura'],
    scenario: 'ha-spof',
    examples: [['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[].[AutoScalingGroupName,MinSize,AvailabilityZones]"', 'Mínimo 1 y una sola zona: dos puntos únicos de fallo'], ['aws rds describe-db-instances --query "DBInstances[].[DBInstanceIdentifier,MultiAZ]"', 'Una base de datos sin Multi-AZ']],
    seeAlso: ['Alta disponibilidad', 'Multi-AZ', 'Auto Scaling'],
  },
  {
    name: 'Elastic Load Balancing',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Reparte el tráfico entre varios destinos (instancias, contenedores, IP, Lambda) en varias zonas, comprueba su salud y escala solo. Tres tipos: ALB (HTTP), NLB (TCP/UDP) y GWLB (aparatos de red).',
    details: `
Piezas: **balanceador** (nombre DNS + nodos por zona), **oyente** (puerto y protocolo), **reglas** (qué hacer según ruta, host…) y **grupo de destino** (servidores + comprobación de salud).

El balanceador es un servicio **regional y multi-AZ**: AWS añade nodos por cada zona que habilites. Para que funcione, **habilita al menos 2 zonas** (un ALB lo exige) y deja que sus nodos lleguen a los destinos (security groups).

Códigos que devuelve un ALB: **502** (el destino respondió mal), **503** (sin destinos sanos), **504** (el destino no contestó a tiempo).
`,
    whenUse: ['Cualquier web o API con más de un servidor', 'Terminar HTTPS (certificados de ACM) en un punto'],
    whenNot: ['Una sola instancia de pruebas', 'Tráfico que solo necesita DNS (Route 53 ponderado) y no comprobaciones a nivel de petición'],
    pricing: 'Por hora de balanceador **más** una unidad de capacidad (LCU/NLCU) según conexiones nuevas, conexiones activas, bytes y reglas evaluadas.',
    limits: ['ALB: 50 reglas por oyente (ampliable) · 100 oyentes… (consulta la cuota vigente)', 'Un ALB necesita subredes en **al menos 2 zonas**'],
    versus: [['ALB', 'HTTP/HTTPS, rutas y cabeceras'], ['NLB', 'TCP/UDP, IP fija, rendimiento extremo'], ['GWLB', 'Insertar firewalls de terceros']],
    scenario: 'ha-alb',
    examples: [
      ['aws elbv2 describe-load-balancers --query "LoadBalancers[].[LoadBalancerName,Scheme,Type,State.Code]" --output table', 'Lista los balanceadores'],
      [DNS],
      ['curl -s http://$DNS/', 'Una petición pasa por el balanceador'],
    ],
    seeAlso: ['ALB', 'NLB', 'Grupo de destino', 'Comprobación de salud'],
  },
  {
    name: 'ALB',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Application Load Balancer: balanceador de capa 7 (HTTP/HTTPS/gRPC) con reglas por ruta, host y cabeceras, destinos instancia/IP/Lambda y redirecciones o respuestas fijas.',
    details: `
Lo que lo distingue: **reglas de enrutamiento** (\`/api/*\` → grupo A, \`admin.tienda.com\` → grupo B), **redirecciones** (HTTP→HTTPS), **respuestas fijas**, autenticación con Cognito/OIDC, WebSockets, HTTP/2 y **destinos Lambda**.

Tiene **grupos de seguridad** propios: los servidores deben admitir el puerto **desde el grupo del ALB**, no desde internet.

Para IP fija o UDP usa un NLB. El nombre DNS del ALB cambia sus IP con el tiempo: **no uses sus IP**, apunta con un **alias** de Route 53.
`,
    whenUse: ['Webs y APIs HTTP', 'Microservicios con rutas distintas', 'Contenedores (ECS/EKS) y Lambda detrás de HTTP'],
    whenNot: ['Necesitas IP estáticas o UDP (usa NLB)', 'Tráfico no HTTP'],
    pricing: 'Por hora + LCU (nuevas conexiones, conexiones activas, ancho de banda procesado y reglas).',
    scenario: 'ha-alb',
    examples: [['aws elbv2 describe-listeners --load-balancer-arn ' + LB_ARN + ' --query "Listeners[].[Port,Protocol]" --output table', 'El oyente en HTTP:80']],
    seeAlso: ['Elastic Load Balancing', 'NLB', 'ALB frente a NLB', 'Reglas de un oyente'],
  },
  {
    name: 'NLB',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Network Load Balancer: capa 4 (TCP, UDP, TLS). Millones de peticiones por segundo con latencia de microsegundos, una IP estática por zona (o IP elástica) y conserva la IP de origen del cliente.',
    details: `
- **IP estática** por zona (o elástica): ideal para listas blancas de firewalls.
- Conserva la **IP de origen**: el servidor ve al cliente real (por eso el security group del servidor debe admitir esas IP, no solo el balanceador).
- Admite **PrivateLink** (publicar tu servicio a otras VPC o cuentas).
- No entiende rutas HTTP ni reglas: reenvía conexiones.
`,
    whenUse: ['TCP/UDP: juegos, IoT, DNS, VoIP', 'IP fija o PrivateLink', 'Rendimiento y latencia extremos'],
    whenNot: ['Necesitas reglas por ruta o cabeceras (usa ALB)'],
    pricing: 'Por hora + NLCU (conexiones y bytes).',
    seeAlso: ['Elastic Load Balancing', 'ALB', 'ALB frente a NLB'],
  },
  {
    name: 'Gateway Load Balancer',
    kind: 'servicio',
    category: 'redes',
    level: 3,
    summary: 'Balanceador de capa 3 para insertar aparatos de red de terceros (firewalls, IDS/IPS) en el camino del tráfico y escalarlos como un grupo. Usa el protocolo GENEVE.',
    whenUse: ['Inspección centralizada de tráfico con aparatos virtuales de un fabricante'],
    whenNot: ['Webs normales (ALB) o conexiones TCP/UDP (NLB)'],
    seeAlso: ['Elastic Load Balancing', 'ALB', 'NLB'],
  },
  {
    name: 'Grupo de destino',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'El conjunto de servidores (instancias, IP o funciones Lambda) a los que reparte un balanceador, junto con la forma de comprobar su salud. Un balanceador puede usar varios; uno puede estar en varios balanceadores.',
    details: `
Configuración importante: **protocolo y puerto**, **tipo de destino** (instancia, ip, lambda), **comprobación de salud** (ruta, intervalo, umbrales, códigos), **atributos**: tiempo de drenaje (300 s), **afinidad de sesión** (_stickiness_) y algoritmo (turnos o **menos peticiones pendientes**).

Con **Auto Scaling**, conectas el grupo de destino al grupo de instancias y los servidores nuevos se registran solos.
`,
    scenario: 'ha-alb',
    examples: [['aws elbv2 describe-target-groups --query "TargetGroups[].[TargetGroupName,Protocol,Port,HealthCheckPath,HealthyThresholdCount]" --output table', 'El grupo y su comprobación de salud']],
    seeAlso: ['Comprobación de salud', 'Drenaje de conexiones', 'Elastic Load Balancing'],
  },
  {
    name: 'Comprobación de salud',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Cómo decide un balanceador si un destino puede recibir tráfico: pide una ruta (o abre un puerto) cada N segundos y exige M respuestas buenas seguidas para declararlo sano (y K malas para declararlo enfermo).',
    details: `
| Ajuste | Por defecto (HTTP) |
| --- | --- |
| Ruta | \`/\` |
| Intervalo | 30 s |
| Tiempo de espera | 5 s |
| Umbral sano | 5 |
| Umbral no sano | 2 |
| Códigos válidos | 200 |

Motivos de «unhealthy»: \`Target.Timeout\` (security group o NACL), \`Target.ResponseCodeMismatch\` (código distinto), \`Target.FailedHealthChecks\` (no escucha), \`Target.NotInUse\` (el grupo no está asociado a un oyente o la zona no está habilitada).

Si **todos** los destinos están enfermos, el ALB reparte entre todos ellos (_fail open_) en vez de cortar el servicio.
`,
    whenUse: ['Siempre: una ruta ligera (`/health`) que compruebe lo esencial de la aplicación'],
    whenNot: ['No hagas que `/health` llame a una base de datos lenta: una caída de la base tumbaría toda la flota'],
    scenario: 'ha-alb-roto',
    examples: [['aws elbv2 describe-target-health --target-group-arn $(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text) --query "TargetHealthDescriptions[].TargetHealth" --output table', 'unhealthy y por qué'], ['aws elbv2 modify-target-group --target-group-arn $(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text) --health-check-path / --query "TargetGroups[0].HealthCheckPath"', 'Corregir la ruta']],
    seeAlso: ['Grupo de destino', 'Elastic Load Balancing', 'Comprobación de salud de Route 53'],
  },
  {
    name: 'Reglas de un oyente',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Un oyente de ALB evalúa sus reglas por prioridad (1 es la primera) y aplica la acción de la primera que cumpla todas sus condiciones; si ninguna, la acción por defecto. Acciones: reenviar, redirigir o responder fijo.',
    details: `
Condiciones: **ruta** (\`/api/*\`), **host** (\`admin.tienda.com\`), método, cabecera, cadena de consulta, IP de origen.

Acciones: **forward** (a uno o varios grupos, con **pesos** para despliegues canario), **redirect** (HTTP→HTTPS, 301/302), **fixed-response** (un 200 o 404 propio) y autenticación.
`,
    scenario: 'ha-alb',
    examples: [
      ['L=$(aws elbv2 describe-listeners --load-balancer-arn ' + LB_ARN + ' --query "Listeners[0].ListenerArn" --output text)'],
      ['aws elbv2 create-rule --listener-arn $L --priority 10 --conditions \'[{"Field":"path-pattern","Values":["/api/*"]}]\' --actions \'[{"Type":"fixed-response","FixedResponseConfig":{"StatusCode":"200","ContentType":"text/plain","MessageBody":"hola desde la API"}}]\' --query "Rules[0].Priority"', 'Todo lo que empiece por /api/ recibe una respuesta fija'],
      [DNS],
      ['curl -s http://$DNS/api/ping', 'La regla responde antes de llegar a los servidores'],
    ],
    seeAlso: ['ALB', 'Grupo de destino'],
  },
  {
    name: 'Drenaje de conexiones',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Al retirar un destino (o al reducirse un grupo), el balanceador deja de enviarle peticiones nuevas pero espera hasta 300 s (por defecto) a que terminen las que están en curso. Estado: draining.',
    details: 'El **tiempo de drenaje** (`deregistration_delay.timeout_seconds`) se ajusta en los atributos del grupo de destino. Para peticiones cortas, 30 s bastan y los despliegues van mucho más rápido.',
    scenario: 'ha-alb',
    examples: [
      [TG_ARN],
      ['ID=$(aws elbv2 describe-target-health --target-group-arn $TG --query "TargetHealthDescriptions[0].Target.Id" --output text)'],
      ['aws elbv2 deregister-targets --target-group-arn $TG --targets Id=$ID'],
      ['aws elbv2 describe-target-health --target-group-arn $TG --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output table', 'El destino retirado aparece como draining'],
    ],
    seeAlso: ['Grupo de destino', 'Auto Scaling'],
  },
  {
    name: 'ALB frente a NLB',
    kind: 'comparativa',
    category: 'redes',
    level: 2,
    summary: 'ALB para HTTP con reglas; NLB para TCP/UDP con IP fija y rendimiento extremo.',
    versus: [
      ['ALB', 'Capa 7. Reglas por ruta/host/cabecera, redirecciones, destinos Lambda. Tiene grupo de seguridad. IP cambiantes: usa el DNS.'],
      ['NLB', 'Capa 4. Millones de conexiones, latencia mínima, **IP estática**, conserva la IP de origen, admite PrivateLink.'],
      ['Elige', 'ALB por defecto para webs y APIs. NLB si necesitas IP fija, UDP, o rendimiento/latencia extremos.'],
    ],
    seeAlso: ['ALB', 'NLB', 'Gateway Load Balancer'],
  },
  {
    name: 'aws elbv2 create-load-balancer',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws elbv2 create-load-balancer --name <nombre> --subnets <subA> <subB> --security-groups <sg> [--scheme internal] [--type network]',
    summary: 'Crea un balanceador (ALB por defecto). Necesita al menos 2 subredes en 2 zonas y, para internet-facing, una VPC con internet gateway.',
    details: 'Tras crearlo está en `provisioning` unos 2–3 minutos. Crea después el grupo de destino y el oyente. `aws elbv2 wait load-balancer-available --names <nombre>` espera a que esté activo.',
    scenario: 'ha-base',
    examples: [
      ['aws elbv2 create-load-balancer --name mi-alb --subnets $(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].SubnetId" --output text) $(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-b --query "Subnets[0].SubnetId" --output text) --security-groups $(aws ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId" --output text) --query "LoadBalancers[0].[LoadBalancerName,Type,State.Code]"', 'Un ALB nuevo'],
      ['aws elbv2 create-load-balancer --name solo-una --subnets $(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].SubnetId" --output text)', 'Con una sola subred falla: hacen falta dos zonas', 'error'],
    ],
    seeAlso: ['Elastic Load Balancing', 'Grupo de destino'],
  },
  {
    name: 'aws elbv2 describe-target-health',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws elbv2 describe-target-health --target-group-arn <arn>',
    summary: 'Estado de salud de cada destino de un grupo, con el motivo cuando no es sano. Es el primer comando que ejecutas cuando «el balanceador da error».',
    scenario: 'ha-alb',
    examples: [[TG_ARN], ['aws elbv2 describe-target-health --target-group-arn $TG --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output table', 'Los dos servidores']],
    seeAlso: ['Comprobación de salud', 'Grupo de destino'],
  },
  {
    name: 'Auto Scaling',
    kind: 'servicio',
    category: 'computo',
    level: 2,
    summary: 'Mantiene un grupo de instancias EC2 entre un mínimo y un máximo: las lanza con una plantilla, las reparte entre zonas, las registra en el balanceador, sustituye las que fallan y cambia su número según la carga.',
    details: `
Un **grupo** define: plantilla de lanzamiento, **mínimo / deseado / máximo**, subredes (zonas), grupos de destino, tipo de comprobación de salud (**EC2** o **ELB**) y **periodo de gracia**.

Funciones: **repone** instancias caídas, **reparte** entre zonas (rebalanceo de zonas), **escala** con políticas, **programa** cambios y **sustituye** instancias en un despliegue (_instance refresh_). Puedes **suspender procesos** (Launch, Terminate, HealthCheck, ReplaceUnhealthy, AZRebalance…) para investigar sin que el grupo «arregle» lo que estás mirando.

Las instancias nuevas tardan en estar listas (**calentamiento**) y las que se retiran se **drenan** del balanceador.
`,
    whenUse: ['Flotas web o de procesamiento con carga variable', 'Auto-reparación de servidores sin estado', 'Reparto entre zonas'],
    whenNot: ['Servidores con estado en disco local que no puedes sustituir (usa antes almacenamiento externo)', 'Una única instancia con mínimo = máximo = 1 como «alta disponibilidad» (se repone, pero hay una caída mientras tanto)'],
    pricing: 'Auto Scaling es gratis; pagas las instancias, los volúmenes y los balanceadores que lanza.',
    versus: [['Auto Scaling', 'Cambia el número de instancias'], ['Escalado vertical', 'Cambiar a una instancia mayor (requiere parar)'], ['Lambda / Fargate', 'Escalado gestionado sin servidores que administrar']],
    scenario: 'ha-asg-vivo',
    examples: [
      ['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[].[AutoScalingGroupName,MinSize,DesiredCapacity,MaxSize]" --output table', 'Límites del grupo'],
      ['aws autoscaling describe-auto-scaling-instances --query "AutoScalingInstances[].[InstanceId,AvailabilityZone,LifecycleState,HealthStatus]" --output table', 'Sus instancias'],
      ['aws autoscaling describe-scaling-activities --auto-scaling-group-name web --query "Activities[].[StartTime,Description]" --output table', 'Qué ha hecho el grupo'],
    ],
    seeAlso: ['Plantilla de lanzamiento', 'Política de escalado', 'Enfriamiento y calentamiento', 'Elastic Load Balancing'],
  },
  {
    name: 'Plantilla de lanzamiento',
    kind: 'concepto',
    category: 'computo',
    level: 2,
    summary: 'La «receta» con la que se crean instancias: AMI, tipo, par de claves, grupos de seguridad, user data, perfil de IAM, etiquetas, discos. Tiene versiones inmutables y una versión por defecto.',
    details: `
Cada cambio crea una **versión nueva** (las anteriores no se modifican). El grupo de Auto Scaling apunta a \`$Default\` o \`$Latest\` (o a un número). Las **configuraciones de lanzamiento** (_launch configurations_) son la forma antigua y están obsoletas: usa plantillas.

El \`UserData\` de la plantilla va en **base64**. Si cambias la plantilla, las instancias existentes no cambian: se aplica a las nuevas (o con un _instance refresh_).
`,
    scenario: 'ha-asg',
    examples: [
      ['aws ec2 describe-launch-templates --query "LaunchTemplates[].[LaunchTemplateName,DefaultVersionNumber,LatestVersionNumber]" --output table', 'La plantilla web-lt'],
      ['aws ec2 describe-launch-template-versions --launch-template-name web-lt --versions 1 --query "LaunchTemplateVersions[0].LaunchTemplateData.InstanceType"', 'Los datos de una versión'],
      ['aws ec2 create-launch-template-version --launch-template-name web-lt --source-version 1 --launch-template-data \'{"InstanceType":"t3.small"}\' --query "LaunchTemplateVersion.VersionNumber"', 'Una versión 2 con otro tipo de instancia'],
    ],
    seeAlso: ['Auto Scaling', 'AMI', 'User data'],
  },
  {
    name: 'Política de escalado',
    kind: 'concepto',
    category: 'computo',
    level: 2,
    summary: 'Regla que cambia la capacidad deseada de un grupo de Auto Scaling: seguimiento de objetivo (la recomendada), por pasos, simple, programada o predictiva.',
    details: `
**Seguimiento de objetivo**: eliges una métrica y un valor (CPU media 50 %, peticiones por destino 1 000) y AWS crea las alarmas y calcula cuántas instancias hacen falta. Sube rápido y baja despacio (~15 min).

**Por pasos / simple**: una **alarma de CloudWatch** dispara una acción («suma 2 instancias» o «aumenta un 20 %»). Los pasos permiten reaccionar más fuerte cuanto más se pase del umbral.

**Programada**: cambia mínimo, máximo o deseado a una hora (o con cron). **Predictiva**: aprende de las últimas semanas y escala antes.
`,
    scenario: 'ha-asg-sin-politica',
    examples: [
      ['aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration \'{"PredefinedMetricSpecification":{"PredefinedMetricType":"ASGAverageCPUUtilization"},"TargetValue":50.0}\' --query PolicyARN', 'Mantener la CPU al 50 %'],
      ['aws autoscaling describe-policies --query "ScalingPolicies[].[PolicyName,PolicyType]" --output table'],
      ['aws cloudwatch describe-alarms --query "MetricAlarms[].[AlarmName,Threshold]" --output table', 'Las alarmas AlarmHigh y AlarmLow que gestiona AWS'],
    ],
    seeAlso: ['Auto Scaling', 'Enfriamiento y calentamiento', 'Escalado programado y predictivo'],
  },
  {
    name: 'Enfriamiento y calentamiento',
    kind: 'concepto',
    category: 'computo',
    level: 2,
    summary: 'Cooldown: tiempo tras un escalado en el que el grupo no vuelve a escalar (política simple; 300 s por defecto). Warm-up: lo que tarda una instancia nueva en estar lista y que no se cuenta para las métricas.',
    details: 'Un **calentamiento demasiado corto** hace que el grupo crea que sigue saturado y lance instancias de más. Uno **demasiado largo** retrasa la respuesta. Ajusta `DefaultInstanceWarmup` al tiempo real de arranque de tu aplicación.',
    seeAlso: ['Política de escalado', 'Auto Scaling'],
  },
  {
    name: 'Escalado programado y predictivo',
    kind: 'concepto',
    category: 'computo',
    level: 2,
    summary: 'Programado: cambia la capacidad a horas fijas (cron). Predictivo: usa el histórico de CloudWatch para escalar antes de que llegue un pico recurrente.',
    scenario: 'ha-asg-vivo',
    examples: [['aws autoscaling put-scheduled-update-group-action --auto-scaling-group-name web --scheduled-action-name pico-matinal --recurrence "0 8 * * 1-5" --min-size 4 --desired-capacity 4', 'De lunes a viernes a las 8:00 sube el mínimo a 4'], ['aws autoscaling describe-scheduled-actions --query "ScheduledUpdateGroupActions[].[ScheduledActionName,Recurrence,MinSize]" --output table']],
    seeAlso: ['Política de escalado', 'Auto Scaling'],
  },
  {
    name: 'Escalado horizontal y vertical',
    kind: 'comparativa',
    category: 'computo',
    level: 1,
    summary: 'Horizontal: más servidores (escala casi sin límite y da redundancia). Vertical: un servidor más grande (simple, pero con tope y con un único punto de fallo).',
    versus: [
      ['Horizontal (scale out/in)', 'Añade o quita instancias. Requiere aplicación sin estado y un balanceador. Es lo que hace Auto Scaling.'],
      ['Vertical (scale up/down)', 'Cambia el tipo de instancia (de t3.medium a m5.2xlarge). Hay que parar la instancia; tiene un techo y sigue siendo un servidor único.'],
    ],
    seeAlso: ['Auto Scaling', 'Tipo de instancia'],
  },
  {
    name: 'aws autoscaling create-auto-scaling-group',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws autoscaling create-auto-scaling-group --auto-scaling-group-name <n> --launch-template LaunchTemplateName=<t>,Version=\'$Default\' --min-size 2 --max-size 4 --vpc-zone-identifier <subA>,<subB> [--target-group-arns <arn>] [--health-check-type ELB]',
    summary: 'Crea un grupo de Auto Scaling. Las subredes se pasan separadas por comas en `--vpc-zone-identifier` y repartirán las instancias entre sus zonas.',
    details: 'Pon la versión de la plantilla entre comillas simples (`Version=\'$Default\'`) para que el shell no interprete el `$`.',
    scenario: 'ha-asg',
    examples: [
      ['SA=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].SubnetId" --output text)'],
      ['SB=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-b --query "Subnets[0].SubnetId" --output text)'],
      ['aws autoscaling create-auto-scaling-group --auto-scaling-group-name web --launch-template LaunchTemplateName=web-lt,Version=\'$Default\' --min-size 2 --max-size 4 --vpc-zone-identifier $SA,$SB'],
      ['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].[DesiredCapacity,AvailabilityZones]"', 'Dos instancias deseadas en dos zonas'],
      ['aws autoscaling create-auto-scaling-group --auto-scaling-group-name web2 --launch-template LaunchTemplateName=web-lt --min-size 5 --max-size 2 --vpc-zone-identifier $SA', 'El mínimo no puede superar al máximo', 'error'],
    ],
    seeAlso: ['Auto Scaling', 'Plantilla de lanzamiento'],
  },
  {
    name: 'aws autoscaling put-scaling-policy',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws autoscaling put-scaling-policy --auto-scaling-group-name <g> --policy-name <p> --policy-type TargetTrackingScaling --target-tracking-configuration <json>',
    summary: 'Crea o cambia una política de escalado. Con seguimiento de objetivo, AWS crea además las alarmas de CloudWatch que la gobiernan.',
    scenario: 'ha-asg-sin-politica',
    examples: [['aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration \'{"PredefinedMetricSpecification":{"PredefinedMetricType":"ASGAverageCPUUtilization"},"TargetValue":50.0}\' --query "Alarms[].AlarmName"', 'Devuelve las dos alarmas que gestiona AWS'], ['aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name mala --policy-type SimpleScaling --adjustment-type ChangeInCapacity', 'Una política simple necesita ScalingAdjustment', 'error']],
    seeAlso: ['Política de escalado', 'Auto Scaling'],
  },
  {
    name: 'aws autoscaling set-desired-capacity',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws autoscaling set-desired-capacity --auto-scaling-group-name <g> --desired-capacity <n>',
    summary: 'Fija a mano el número deseado de instancias (entre el mínimo y el máximo). Útil para pruebas o para vaciar un grupo antes de borrarlo.',
    scenario: 'ha-asg-vivo',
    examples: [['aws autoscaling set-desired-capacity --auto-scaling-group-name web --desired-capacity 3'], ['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].DesiredCapacity"'], ['aws autoscaling set-desired-capacity --auto-scaling-group-name web --desired-capacity 20', 'Por encima del máximo', 'error']],
    seeAlso: ['Auto Scaling', 'Política de escalado'],
  },
  {
    name: 'ab',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'ab -n <peticiones> -c <concurrencia> [-t <segundos>] http://<dns>/',
    summary: 'ApacheBench: prueba de carga HTTP. En el simulador aplica la carga al balanceador y hace avanzar el reloj, así que puedes ver cómo reacciona Auto Scaling.',
    details: 'Con `-t` solo, `ab` fija `-n 50000`: para una carga sostenida pon también un `-n` grande (`-n 5000000 -t 600`). Muestra peticiones por segundo, tiempos y percentiles.',
    scenario: 'ha-alb',
    examples: [[DNS], ['ab -n 1000 -c 20 http://$DNS/', 'Mil peticiones, 20 a la vez'], ['ab -n 10 -c 20 http://$DNS/', 'La concurrencia no puede superar a las peticiones', 'error']],
    seeAlso: ['Auto Scaling', 'Política de escalado'],
  },
  {
    name: 'Políticas de enrutamiento',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Cómo responde Route 53 cuando hay varios registros con el mismo nombre: simple, ponderada, latencia, failover, geolocalización, geoproximidad o varios valores. Cada registro lleva un SetIdentifier.',
    details: `
| Política | Para… |
| --- | --- |
| Ponderada | Despliegues canario (90/10), migraciones |
| Latencia | Varias regiones: la más rápida para cada usuario |
| Failover | Principal/secundario con comprobación de salud |
| Geolocalización | Contenido por país o continente (se necesita un registro «por defecto») |
| Varios valores | Hasta 8 registros sanos al azar |

Todos los registros de un nombre y tipo deben usar **la misma política**. Los registros **alias** (a ALB, CloudFront, S3…) pueden evaluar la salud de su destino.
`,
    scenario: 'dns-ha',
    examples: [
      ['ZONE=$(aws route53 list-hosted-zones --query "HostedZones[0].Id" --output text)'],
      ['US=$(aws ec2 describe-instances --region us-east-1 --filters Name=tag:Name,Values=web-us --query "Reservations[0].Instances[0].PublicIpAddress" --output text)'],
      ['EU=$(aws ec2 describe-instances --region eu-west-1 --filters Name=tag:Name,Values=web-eu --query "Reservations[0].Instances[0].PublicIpAddress" --output text)'],
      ['aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \'{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"estable","Weight":90,"TTL":60,"ResourceRecords":[{"Value":"\'$US\'"}]}},{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"canario","Weight":10,"TTL":60,"ResourceRecords":[{"Value":"\'$EU\'"}]}}]}\'', 'Un despliegue canario: 90 % / 10 %'],
      ['aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \'{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"otro.tienda.test","Type":"A","Weight":50,"TTL":60,"ResourceRecords":[{"Value":"1.2.3.4"}]}}]}\'', 'Sin SetIdentifier no vale', 'error'],
    ],
    seeAlso: ['Comprobación de salud de Route 53', 'Alias frente a CNAME', 'Route 53'],
  },
  {
    name: 'Comprobación de salud de Route 53',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Route 53 pide una URL o un puerto a tu destino desde varias ubicaciones del mundo cada 10 o 30 s; con 3 fallos seguidos lo marca como no sano y las políticas dejan de contestar con él.',
    details: `
Tipos: **HTTP/HTTPS** (con o sin cadena de texto esperada), **TCP**, **calculada** (combina otras con AND/OR) y de **alarma de CloudWatch**.

Los **security groups** y NACL del destino deben dejar entrar a los comprobadores (IP publicados por AWS). Para recursos **privados** no se pueden comprobar desde fuera: usa una comprobación basada en una alarma de CloudWatch.

El tiempo total de reacción es: intervalo × umbral de fallos + **TTL** del registro (las cachés de los usuarios).
`,
    scenario: 'dns-ha',
    examples: [
      ['US=$(aws ec2 describe-instances --region us-east-1 --filters Name=tag:Name,Values=web-us --query "Reservations[0].Instances[0].PublicIpAddress" --output text)'],
      ['HC=$(aws route53 create-health-check --caller-reference demo-1 --health-check-config \'{"IPAddress":"\'$US\'","Port":80,"Type":"HTTP","ResourcePath":"/","RequestInterval":10,"FailureThreshold":3}\' --query HealthCheck.Id --output text)'],
      ['aws route53 get-health-check-status --health-check-id $HC --query "HealthCheckObservations[].[Region,StatusReport.Status]" --output table', 'Lo que ve cada región de comprobadores'],
    ],
    seeAlso: ['Políticas de enrutamiento', 'Comprobación de salud'],
  },
  {
    name: 'Alias frente a CNAME',
    kind: 'comparativa',
    category: 'redes',
    level: 2,
    summary: 'Alias: registro propio de Route 53 hacia recursos de AWS (ALB, CloudFront, S3…); vale en el vértice del dominio, es gratis y puede evaluar la salud. CNAME: estándar DNS hacia otro nombre; no puede ir en el vértice.',
    versus: [
      ['Alias', 'Solo Route 53. A/AAAA hacia recursos de AWS. **Sí** en el vértice. Sin coste por consulta. Evalúa la salud del destino. Sin TTL propio (lo gestiona AWS).'],
      ['CNAME', 'Cualquier DNS. Hacia cualquier nombre. **No** en el vértice. Se cobra la consulta. Sin evaluación de salud.'],
    ],
    seeAlso: ['Registros DNS', 'Políticas de enrutamiento', 'Route 53'],
  },
  {
    name: 'aws route53 create-health-check',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws route53 create-health-check --caller-reference <único> --health-check-config <json>',
    summary: 'Crea una comprobación de salud (HTTP, HTTPS, TCP, calculada…). Devuelve su `Id`, que se enlaza con un registro mediante `HealthCheckId`.',
    scenario: 'dns-ha',
    examples: [
      ['aws route53 create-health-check --caller-reference mala --health-check-config \'{"Type":"HTTP"}\'', 'Falta IPAddress o el nombre de dominio', 'error'],
      ['aws route53 create-health-check --caller-reference ok-1 --health-check-config \'{"Type":"HTTP","FullyQualifiedDomainName":"www.tienda.test","Port":80,"ResourcePath":"/"}\' --query "HealthCheck.HealthCheckConfig.Type"'],
      ['aws route53 list-health-checks --query "HealthChecks[].[Id,HealthCheckConfig.Type]" --output table'],
    ],
    seeAlso: ['Comprobación de salud de Route 53', 'Políticas de enrutamiento'],
  },
  {
    name: 'Invalidación de CloudFront',
    kind: 'concepto',
    category: 'redes',
    level: 2,
    summary: 'Borra rutas de la caché de todos los bordes antes de que venza su TTL. Las 1 000 primeras rutas al mes son gratis; mejor versionar los nombres (`app.v3.js`) que invalidar.',
    details: 'Las rutas empiezan por `/` y admiten `*` al final (`/img/*`). La invalidación tarda unos minutos en completarse. Alternativas: TTL cortos, cabeceras `Cache-Control` y nombres de archivo con huella (hash).',
    scenario: 'cdn-vivo',
    examples: [
      ['ID=$(aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text)'],
      ['aws cloudfront create-invalidation --distribution-id $ID --paths /index.html --query "Invalidation.Status"'],
      ['aws cloudfront create-invalidation --distribution-id $ID --paths index.html', 'La ruta debe empezar por /', 'error'],
    ],
    seeAlso: ['CloudFront', 'aws cloudfront create-invalidation'],
  },
  {
    name: 'Origin Access Control (OAC)',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Permite que CloudFront lea un bucket de S3 privado firmando sus peticiones (SigV4). El bucket no es público: su política concede s3:GetObject a cloudfront.amazonaws.com solo para tu distribución (AWS:SourceArn).',
    details: 'Sustituye a la identidad de acceso de origen (OAI), que está obsoleta. Si el objeto no existe, S3 responde 403 y no 404 salvo que la política también conceda `s3:ListBucket`.',
    scenario: 'cdn',
    examples: [['aws cloudfront create-origin-access-control --origin-access-control-config Name=mi-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 --query OriginAccessControl.Id', 'Crear un OAC'], ['aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[].[Id,Name]" --output table']],
    seeAlso: ['CloudFront', 'Política de bucket', 'Block Public Access'],
  },
  {
    name: 'Global Accelerator',
    kind: 'servicio',
    category: 'redes',
    level: 2,
    summary: 'Dos IP estáticas anycast que entran por el borde de AWS más cercano y llevan el tráfico TCP/UDP por la red troncal de AWS hasta tus ALB, NLB, instancias o IP elásticas, con failover entre regiones en segundos. No cachea.',
    details: 'Estructura: **acelerador** → **oyentes** (puertos) → **grupos de destinos** por región (con porcentaje de tráfico) → **destinos** (con peso). Ideal para clientes que solo pueden abrir su firewall a IP fijas, juegos, VoIP y APIs no cacheables.',
    pricing: 'Por hora de acelerador más una tarifa por GB de la dirección dominante del tráfico.',
    scenario: 'ha-alb',
    examples: [
      ['aws globalaccelerator create-accelerator --name tienda-ga --query "Accelerator.[Name,IpSets[0].IpAddresses]"', 'Dos IP estáticas'],
      ['aws globalaccelerator list-accelerators --query "Accelerators[].[Name,Enabled,Status]" --output table'],
    ],
    seeAlso: ['CloudFront frente a Global Accelerator', 'CloudFront', 'NLB'],
  },
  {
    name: 'CloudFront frente a Global Accelerator',
    kind: 'comparativa',
    category: 'redes',
    level: 2,
    summary: 'CloudFront cachea contenido HTTP cerca del usuario; Global Accelerator no cachea: acelera conexiones TCP/UDP y da IP fijas.',
    versus: [
      ['CloudFront', 'CDN. Cachea contenido estático y acelera el dinámico. HTTP/HTTPS/WebSocket. Dominios y certificados propios. Función Lambda@Edge. Barato para tráfico cacheable.'],
      ['Global Accelerator', 'Enrutamiento por la red de AWS. **TCP y UDP**. **2 IP estáticas**. Failover entre regiones en segundos. Sin caché.'],
    ],
    seeAlso: ['CloudFront', 'Global Accelerator'],
  },
  {
    name: 'aws cloudfront create-invalidation',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws cloudfront create-invalidation --distribution-id <id> --paths /ruta1 /ruta2/*',
    summary: 'Pide a CloudFront que borre esas rutas de la caché de borde. Las rutas empiezan por `/`.',
    scenario: 'cdn-vivo',
    examples: [['ID=$(aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text)'], ['aws cloudfront create-invalidation --distribution-id $ID --paths "/*" --query Invalidation.Status', 'Invalida todo (cuenta como 1 ruta)'], ['aws cloudfront list-invalidations --distribution-id $ID --query "InvalidationList.Quantity"']],
    seeAlso: ['Invalidación de CloudFront', 'CloudFront'],
  },
  {
    name: 'aws cloudfront create-distribution',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws cloudfront create-distribution --origin-domain-name <bucket>.s3.amazonaws.com [--default-root-object index.html]  |  --distribution-config <json>',
    summary: 'Crea una distribución. La forma corta solo admite un origen y valores por defecto; para OAC, comportamientos o dominios propios usa `--distribution-config`.',
    details: 'Tarda unos minutos en pasar de `InProgress` a `Deployed` (`aws cloudfront wait distribution-deployed --id <id>`). Para borrarla hay que **desactivarla** (`Enabled: false`) y esperar de nuevo.',
    scenario: 'cdn',
    examples: [
      ['aws cloudfront create-distribution --origin-domain-name tienda-estaticos.s3.amazonaws.com --default-root-object index.html --query "Distribution.[Id,Status]"', 'Una distribución sobre el bucket'],
      ['aws cloudfront create-distribution --origin-domain-name no-existe-123.s3.amazonaws.com', 'El bucket del origen no existe', 'error'],
    ],
    seeAlso: ['CloudFront', 'Origin Access Control (OAC)', 'Invalidación de CloudFront'],
  },
];
