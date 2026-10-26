import { A, all, awsEmpty, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, multi, order, practice, predict, tf } from './awsbuild';

const VPC = 'VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=tienda --query "Vpcs[0].VpcId" --output text)';
const SA = 'SA=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a --query "Subnets[0].SubnetId" --output text)';
const SB = 'SB=$(aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-b --query "Subnets[0].SubnetId" --output text)';
const ALBSG = 'ALBSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId" --output text)';
const WEBSG = 'WEBSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text)';
const TG = 'TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)';
const SERVER = (v: string, name: string) => `${v}=$(aws ec2 describe-instances --filters Name=tag:Name,Values=${name} --query "Reservations[0].Instances[0].InstanceId" --output text)`;
const HEALTHY = awsIs('_check targets --group web-tg --query States', ['healthy', 'healthy'], 'Los dos servidores deben aparecer sanos (healthy) en el grupo web-tg');
const ZONE = 'ZONE=$(aws route53 list-hosted-zones --query "HostedZones[0].Id" --output text)';
const IP = (v: string, region: string, name: string) => `${v}=$(aws ec2 describe-instances --region ${region} --filters Name=tag:Name,Values=${name} --query "Reservations[0].Instances[0].PublicIpAddress" --output text)`;
const DNS_OF_ALB = 'DNS=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text)';

export const a8 = awsWorld({
  id: 'a8',
  index: 8,
  title: 'Alta disponibilidad y escalado',
  subtitle: 'Que la tienda no caiga ni se sature',
  emoji: '⚖️',
  color: '#38BDF8',
  level: 'intermedio',
  intro:
    'Un solo servidor es un solo punto de fallo… y una sola cantidad de capacidad. En esta zona aprendes a repartir el tráfico con **balanceadores de carga**, a hacer crecer y encoger la flota con **Auto Scaling**, a diseñar sin puntos únicos de fallo, a dirigir a los usuarios con **Route 53** (latencia, failover, ponderado) y a acercar el contenido con **CloudFront** y **Global Accelerator**. Todo con servidores que se caen, cargas que suben y comprobaciones de salud que mandan.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a8-1', { title: 'Balanceadores de carga (ELB)', summary: 'ALB, NLB y GWLB: un único punto de entrada para muchos servidores', emoji: '⚖️', commands: ['Elastic Load Balancing', 'ALB', 'NLB', 'Grupo de destino', 'Comprobación de salud', 'aws elbv2 create-load-balancer', 'aws elbv2 describe-target-health'], minutes: 18 }, [
      learn(
        'Un solo punto de entrada',
        `
Si tu web vive en **un** servidor, cuando ese servidor falla (o se satura) se acaba la web. Un **balanceador de carga** (_Elastic Load Balancing_, **ELB**) se pone delante y:

- ofrece **un único nombre DNS** a los usuarios;
- **reparte** las peticiones entre varios servidores;
- **comprueba la salud** de cada servidor y deja de enviar tráfico a los que fallan;
- se reparte él mismo entre **varias zonas de disponibilidad**, así que tampoco es un punto único de fallo;
- escala solo con el tráfico y es un servicio gestionado.

Las piezas son siempre las mismas:

| Pieza | Qué es |
| --- | --- |
| **Balanceador** | El nombre DNS y sus nodos en cada zona |
| **Oyente** (_listener_) | Un puerto y protocolo en el que escucha (HTTP:80, HTTPS:443) |
| **Regla** | Qué hacer según la ruta, el host… (reenviar, redirigir, responder) |
| **Grupo de destino** (_target group_) | Los servidores a los que reenvía y **cómo comprobar su salud** |
`,
        '⚖️',
      ),
      mc('Un servidor del grupo de destino deja de responder a la comprobación de salud. ¿Qué hace el balanceador?', ['Se detiene y devuelve error a todos', 'Deja de enviarle peticiones y reparte entre los sanos', 'Reinicia el servidor', 'Le envía el doble de tráfico para que se recupere'], 1, 'El balanceador solo detecta y evita: no repara ni reinicia. (Quien repone servidores es Auto Scaling, en la siguiente lección.)'),
      illus('aws-elb-flow', 'El camino de una petición', 'Rompe un servidor y mira cómo el balanceador lo saca de la rotación.'),
      learn(
        'ALB, NLB y GWLB: cuál elegir',
        `
| | **ALB** (_Application_) | **NLB** (_Network_) | **GWLB** (_Gateway_) |
| --- | --- | --- | --- |
| Capa | 7 (HTTP/HTTPS, gRPC) | 4 (TCP, UDP, TLS) | 3 (paquetes IP) |
| Reglas | Por **ruta**, host, cabeceras, método | No (solo puerto) | No |
| Rendimiento | Muy alto | **Millones** de peticiones/s, latencia mínima | Alto |
| IP fija | No (usa el DNS) | **Sí** (una IP estática por zona, o IP elástica) | — |
| Destinos | Instancias, IP, **Lambda** | Instancias, IP, ALB | Aparatos de red |
| Ideal para | **Webs y APIs** | Juegos, IoT, TCP/UDP, IP fija | Firewalls y antivirus de terceros |

Regla práctica: **ALB** para casi todo lo web; **NLB** si necesitas IP fija, UDP o rendimiento extremo; **GWLB** para insertar aparatos de seguridad en el camino.

Con un ALB, **una sola regla** puede llevar \`/api/*\` a un grupo de servidores y el resto a otro.
`,
        '🧭',
      ),
      match(
        'Une cada necesidad con el balanceador',
        [
          ['Una web con `/api/*` en unos servidores y `/imagenes/*` en otros', 'ALB'],
          ['Millones de conexiones TCP/UDP por segundo y una IP fija', 'NLB'],
          ['Pasar todo el tráfico por un firewall de un fabricante antes de llegar a las instancias', 'GWLB'],
        ],
        'El ALB entiende HTTP (rutas, cabeceras); el NLB trabaja con conexiones TCP/UDP y da IP estática; el GWLB inserta aparatos de red.',
      ),
      demo(
        'Un balanceador funcionando',
        [
          ['aws elbv2 describe-load-balancers --query "LoadBalancers[].[LoadBalancerName,Scheme,Type,State.Code]" --output table', 'El balanceador, de cara a internet, tipo ALB y activo'],
          ['aws elbv2 describe-target-groups --query "TargetGroups[].[TargetGroupName,Protocol,Port,HealthCheckPath]" --output table', 'El grupo de destino y la ruta de su comprobación de salud'],
          ['TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)'],
          ['aws elbv2 describe-target-health --target-group-arn $TG --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output table', 'Los dos servidores, sanos'],
          ['DNS=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text)'],
          ['curl -s http://$DNS/', 'Una petición cae en un servidor…'],
          ['curl -s http://$DNS/', '…la siguiente, en el otro: reparto por turnos'],
        ],
        A('ha-alb'),
      ),
      predict('¿Cuál es el estado de los destinos del grupo `web-tg`?', 'aws elbv2 describe-target-health --target-group-arn $(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text) --query "TargetHealthDescriptions[].TargetHealth.State" --output text', ['unhealthy\tunhealthy', 'initial\tinitial', 'unused\tunused'], 'Los dos servidores responden 200 a la comprobación: ambos `healthy`.', A('ha-alb')),
      mc('Un balanceador responde **503 Service Temporarily Unavailable** a todo. ¿Qué es lo más probable?', ['Que el certificado ha caducado', 'Que no hay ningún destino registrado en el grupo (o ninguno sano)', 'Que el balanceador está en otra región', 'Que el DNS está mal'], 1, '503 = no hay a quién enviar la petición. 502 = el destino respondió mal o cerró la conexión; 504 = el destino no respondió a tiempo.'),
      learn(
        'Comprobaciones de salud y drenaje',
        `
Cada grupo de destino define **cómo se comprueba un servidor**: protocolo, puerto, **ruta** (\`/\` o \`/health\`), cada cuántos segundos (**intervalo**, 30 por defecto), cuántas respuestas buenas lo declaran sano (**umbral sano**, 5) o malas lo declaran enfermo (**umbral no sano**, 2) y qué códigos HTTP valen (\`200\`).

Los destinos pasan por estados: **initial → healthy → unhealthy**, y también **unused** (no se usa) o **draining** (se está retirando).

Cuando retiras un servidor (\`deregister-targets\`), el balanceador **drena**: deja de enviarle peticiones nuevas pero espera hasta **300 s** (_deregistration delay_) a que terminen las que están en curso. Ajústalo si tus peticiones son cortas.

Motivos típicos de «unhealthy»:

- \`Target.Timeout\` → el **security group** (o la NACL) no deja llegar al balanceador.
- \`Target.ResponseCodeMismatch\` → la ruta de la comprobación devuelve otro código (404…).
- \`Target.FailedHealthChecks\` → el servicio ni siquiera está escuchando.
`,
        '🩺',
      ),
      practice({
        prompt:
          'Hay dos servidores web (`web-a` y `web-b`, uno en cada zona) y ningún balanceador. Monta lo que falta en **us-east-1**:\n\n1. Un **grupo de destino** `web-tg` (HTTP, puerto 80) en la VPC `tienda`, con comprobación en `/health`, y registra los dos servidores.\n2. Un **ALB** `tienda-alb` de cara a internet en las **dos subredes públicas** (`publica-a` y `publica-b`) con el grupo de seguridad `alb-sg`.\n3. Un **oyente** HTTP:80 que reenvíe todo a `web-tg`.',
        goal: 'ALB tienda-alb repartiendo entre web-a y web-b',
        setup: A('ha-base'),
        check: all(HEALTHY, awsIs('_check http --url http://lb:tienda-alb/ --query Status', 200, 'Al pedir la web por el balanceador debe responder 200')),
        solution: [
          VPC,
          SA,
          SB,
          ALBSG,
          SERVER('WA', 'web-a'),
          SERVER('WB', 'web-b'),
          'TG=$(aws elbv2 create-target-group --name web-tg --protocol HTTP --port 80 --vpc-id $VPC --health-check-path /health --query "TargetGroups[0].TargetGroupArn" --output text)',
          'aws elbv2 register-targets --target-group-arn $TG --targets Id=$WA Id=$WB',
          'LB=$(aws elbv2 create-load-balancer --name tienda-alb --subnets $SA $SB --security-groups $ALBSG --query "LoadBalancers[0].LoadBalancerArn" --output text)',
          'aws elbv2 create-listener --load-balancer-arn $LB --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=$TG',
        ],
        hints: [
          'Orden: grupo de destino → registrar servidores → balanceador → oyente. Los ids de los servidores salen de `aws ec2 describe-instances` (etiqueta `Name`).',
          '`aws elbv2 create-target-group --name web-tg --protocol HTTP --port 80 --vpc-id <vpc> --health-check-path /health` y después `aws elbv2 register-targets --target-group-arn <arn> --targets Id=<id1> Id=<id2>`.',
          '`aws elbv2 create-load-balancer --name tienda-alb --subnets <subA> <subB> --security-groups <alb-sg>` y `aws elbv2 create-listener --load-balancer-arn <arn> --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=<arn del grupo>`.',
        ],
        explain: 'Cuatro piezas (grupo de destino, registro, balanceador y oyente) y listo: el nombre DNS del balanceador reparte entre los dos servidores. Los servidores tardan unos minutos en pasar las comprobaciones antes de recibir tráfico.',
        par: 7,
        commands: ['aws elbv2 create-load-balancer', 'Grupo de destino'],
      }),
      practice({
        prompt: 'El balanceador ya existe, pero los dos destinos aparecen **`unhealthy`** con el motivo `Target.ResponseCodeMismatch`: la comprobación pide la ruta `/estado` y los servidores responden 404 (esa página no existe; la portada `/` sí responde 200). Arregla la **comprobación de salud** de `web-tg` para que los dos queden sanos.',
        goal: 'Los dos destinos de web-tg sanos',
        setup: A('ha-alb-roto'),
        check: HEALTHY,
        solution: [TG, 'aws elbv2 modify-target-group --target-group-arn $TG --health-check-path /'],
        hints: ['Mira el motivo con `aws elbv2 describe-target-health --target-group-arn <arn>`.', '`aws elbv2 modify-target-group --target-group-arn <arn> --health-check-path /`'],
        explain: 'Cuando una comprobación falla, lee el **motivo**: `ResponseCodeMismatch` es la ruta o los códigos aceptados, no la red. Tras corregirla los destinos pasan a sanos tras varias comprobaciones seguidas buenas (por defecto 5 × 30 s).',
        par: 2,
        commands: ['Comprobación de salud', 'aws elbv2 describe-target-health'],
      }),
      practice({
        prompt: 'Ahora los destinos aparecen `unhealthy` con `Target.Timeout`: el balanceador no consigue ni conectar. Los servidores usan el grupo de seguridad **`web-sg`** y el balanceador **`alb-sg`**. Deja que `web-sg` admita el **puerto 80 desde el grupo `alb-sg`** (no desde todo internet).',
        goal: 'web-sg admite al balanceador y los destinos pasan a sanos',
        setup: A('ha-alb-sg'),
        check: HEALTHY,
        solution: [WEBSG, ALBSG, 'aws ec2 authorize-security-group-ingress --group-id $WEBSG --protocol tcp --port 80 --source-group $ALBSG'],
        hints: ['Un security group puede usar **otro grupo como origen** en vez de un CIDR.', '`aws ec2 authorize-security-group-ingress --group-id <web-sg> --protocol tcp --port 80 --source-group <alb-sg>`'],
        explain: 'Es la forma recomendada: los servidores solo aceptan tráfico que venga del balanceador. Así nadie puede saltarse el balanceador conectando directo al servidor.',
        par: 3,
        commands: ['Security group', 'aws ec2 authorize-security-group-ingress'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a8-2', { title: 'Auto Scaling', summary: 'Una flota que crece con la carga y se repara sola', emoji: '📈', commands: ['Auto Scaling', 'Plantilla de lanzamiento', 'Política de escalado', 'Enfriamiento y calentamiento', 'aws autoscaling create-auto-scaling-group', 'ab'], minutes: 20 }, [
      learn(
        'Capacidad que se ajusta sola',
        `
Con un número fijo de servidores, o te quedas corto en un pico o pagas de más en la calma. **EC2 Auto Scaling** mantiene un **grupo** de instancias:

- **Mínimo**: nunca menos de N (tu red de seguridad).
- **Máximo**: nunca más de N (tu tope de gasto).
- **Deseado**: cuántas quiere ahora; Auto Scaling lanza o termina instancias hasta alcanzarlo.

Además:

- Lanza las instancias con una **plantilla de lanzamiento** (AMI, tipo, grupo de seguridad, _user data_…).
- Las **reparte entre zonas** de disponibilidad y las **registra** en el balanceador.
- **Sustituye** las que fallan (comprobación de EC2 o, mejor, la del **ELB**).
- Cambia el deseado con **políticas** según la carga (o a horas fijas).

Es gratis: solo pagas las instancias que lanza.
`,
        '📈',
      ),
      mc('Un grupo tiene mínimo 2, máximo 6 y deseado 2. ¿Cuántas instancias tendrá si alguien termina una a mano?', ['1, porque se perdió', '2: lanza otra para volver al deseado', '6', 'Ninguna'], 1, 'Auto Scaling compara lo que hay con el deseado y repone lo que falte.'),
      illus('aws-asg-scale', 'Escalar con la carga', 'Sube y baja la carga y mira cuántas instancias necesita el grupo para mantener la CPU en su objetivo.'),
      learn(
        'Políticas de escalado',
        `
| Política | Cómo funciona | Cuándo |
| --- | --- | --- |
| **Seguimiento de objetivo** (_target tracking_) | «Mantén la CPU media en el 50 %»: calcula solo cuántas instancias hacen falta | **La recomendada** para casi todo |
| **Por pasos** (_step_) | Una alarma de CloudWatch y, según cuánto se pase, suma 1, 2 o 4 | Cuando necesitas reacciones graduadas |
| **Simple** | Una alarma → sumar/restar N y esperar el enfriamiento | Heredada; usa las anteriores |
| **Programada** | «A las 8:00 mínimo 10; a las 22:00 mínimo 2» | Picos previsibles |
| **Predictiva** | Aprende de tu histórico y escala **antes** del pico | Cargas con patrón diario o semanal |

Dos tiempos que debes conocer:

- **Calentamiento** (_warm-up_): lo que tarda una instancia nueva en estar lista (arrancar la aplicación). Auto Scaling no la cuenta ni lanza más mientras tanto.
- **Enfriamiento** (_cooldown_): tiempo de espera tras un escalado simple (300 s por defecto) para no reaccionar en cascada.

Reducir es más lento a propósito: el seguimiento de objetivo espera unos 15 minutos de carga baja antes de quitar instancias.
`,
        '🎚️',
      ),
      match(
        'Une cada situación con la política',
        [
          ['Mantener la CPU media del grupo en el 50 % sin pensar más', 'Seguimiento de objetivo'],
          ['Cada día a las 8:00 hay un pico de matrículas conocido', 'Programada'],
          ['Si la cola pasa de 100 mensajes suma 2, y si pasa de 500 suma 6', 'Por pasos'],
          ['El tráfico sigue un patrón semanal y quieres anticiparte', 'Predictiva'],
        ],
        'Seguimiento de objetivo para lo general; programada para lo conocido; por pasos para respuestas graduadas; predictiva para patrones.',
      ),
      demo(
        'Un grupo en marcha',
        [
          ['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[].[AutoScalingGroupName,MinSize,DesiredCapacity,MaxSize,HealthCheckType]" --output table', 'Mínimo 2, máximo 6, deseado 2'],
          ['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].Instances[].[InstanceId,AvailabilityZone,LifecycleState,HealthStatus]" --output table', 'Dos instancias, una en cada zona'],
          ['aws autoscaling describe-policies --query "ScalingPolicies[].[PolicyName,PolicyType,TargetTrackingConfiguration.TargetValue]" --output table', 'Seguimiento de objetivo al 50 % de CPU'],
          ['aws ec2 describe-launch-templates --query "LaunchTemplates[].[LaunchTemplateName,DefaultVersionNumber]" --output table', 'La plantilla de lanzamiento con la que se crean'],
        ],
        A('ha-asg-vivo'),
      ),
      predict('¿Qué mínimo, deseado y máximo tiene el grupo `web`?', 'aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].[MinSize,DesiredCapacity,MaxSize]" --output text', ['1\t1\t3', '2\t6\t6', '0\t2\t2'], 'Se creó con mínimo 2, deseado 2 y máximo 6.', A('ha-asg-vivo')),
      tf('«Si una instancia de un grupo de Auto Scaling se queda sin disco o la terminas a mano, el grupo no hace nada.»', false, 'El grupo detecta que falta una instancia (o que no está sana) y lanza otra: es su segunda función, además de escalar.'),
      order('Ordena el ciclo de vida de una instancia nueva de un grupo', ['Pending', 'InService', 'Terminating'], 'Pending InService Terminating', 'Entra en **Pending** (arrancando), pasa a **InService** (recibe tráfico) y, al retirarla, a **Terminating**.'),
      practice({
        prompt:
          'Ya hay un balanceador `tienda-alb` con su grupo `web-tg` (vacío) y una **plantilla de lanzamiento `web-lt`**. Crea el grupo de Auto Scaling **`web`**:\n\n- plantilla `web-lt` (versión por defecto `$Default`);\n- **mínimo 2, máximo 4**;\n- en las subredes `publica-a` y `publica-b` (`--vpc-zone-identifier` separa los ids con coma);\n- conectado al grupo de destino `web-tg`;\n- comprobación de salud de tipo **ELB** con 60 s de gracia.',
        goal: 'ASG web (2–4) en dos zonas, conectado a web-tg',
        setup: A('ha-asg'),
        check: all(
          awsIs('autoscaling describe-auto-scaling-groups --auto-scaling-group-names web --query "AutoScalingGroups[0].[MinSize,MaxSize,length(AvailabilityZones),HealthCheckType,length(TargetGroupARNs)]"', [2, 4, 2, 'ELB', 1], 'El grupo web debe ser 2–4, en 2 zonas, de tipo ELB y con un grupo de destino'),
          HEALTHY,
        ),
        solution: [SA, SB, TG, "aws autoscaling create-auto-scaling-group --auto-scaling-group-name web --launch-template LaunchTemplateName=web-lt,Version='$Default' --min-size 2 --max-size 4 --vpc-zone-identifier $SA,$SB --target-group-arns $TG --health-check-type ELB --health-check-grace-period 60"],
        hints: ['`aws autoscaling create-auto-scaling-group --auto-scaling-group-name web --launch-template LaunchTemplateName=web-lt,Version=\'$Default\' …` (las comillas simples evitan que el shell toque el `$`).', 'Añade `--min-size 2 --max-size 4 --vpc-zone-identifier <subA>,<subB> --target-group-arns <arn> --health-check-type ELB --health-check-grace-period 60`.'],
        explain: 'El grupo lanza dos instancias (una por zona), las registra solas en el grupo de destino y las repone si fallan. Con `HealthCheckType ELB`, una instancia que el balanceador da por mala también se sustituye.',
        par: 4,
        commands: ['aws autoscaling create-auto-scaling-group', 'Plantilla de lanzamiento'],
      }),
      practice({
        prompt: 'El grupo `web` existe pero no escala. Añade una **política de seguimiento de objetivo** llamada **`cpu50`** que mantenga la **CPU media en el 50 %** (`ASGAverageCPUUtilization`).',
        goal: 'Política cpu50 de seguimiento de objetivo',
        setup: A('ha-asg-sin-politica'),
        check: awsIs('autoscaling describe-policies --query "ScalingPolicies[].[PolicyName,PolicyType,TargetTrackingConfiguration.TargetValue]"', [['cpu50', 'TargetTrackingScaling', 50]], 'Falta la política cpu50 de seguimiento de objetivo al 50 %'),
        solution: ["aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration '{\"PredefinedMetricSpecification\":{\"PredefinedMetricType\":\"ASGAverageCPUUtilization\"},\"TargetValue\":50.0}'"],
        hints: ['`aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration \'…JSON…\'`', 'El JSON: `{"PredefinedMetricSpecification":{"PredefinedMetricType":"ASGAverageCPUUtilization"},"TargetValue":50.0}`'],
        explain: 'Con seguimiento de objetivo AWS crea y gestiona por ti las alarmas de CloudWatch (AlarmHigh y AlarmLow). No las edites a mano.',
        par: 1,
        commands: ['Política de escalado', 'Enfriamiento y calentamiento'],
      }),
      practice({
        prompt: 'Comprueba que el escalado funciona de verdad. Crea la política **`cpu50`** (seguimiento de objetivo, CPU al 50 %) y lanza una prueba de carga contra el balanceador con **`ab`** (ApacheBench), por ejemplo `ab -n 5000000 -c 150 -t 600 http://<dns>/`. Tras esos 10 minutos de carga, el grupo `web` debe haber **crecido por encima de 2 instancias**.',
        goal: 'Que el grupo web escale por encima de 2 bajo carga',
        setup: A('ha-asg-sin-politica'),
        check: awsIs('autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].DesiredCapacity > `2`"', true, 'El grupo todavía no ha escalado: crea la política y lanza la carga'),
        solution: [
          "aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration '{\"PredefinedMetricSpecification\":{\"PredefinedMetricType\":\"ASGAverageCPUUtilization\"},\"TargetValue\":50.0}'",
          DNS_OF_ALB,
          'ab -n 5000000 -c 150 -t 600 http://$DNS/',
        ],
        hints: ['Primero la política `cpu50` (como en el reto anterior). Sin ella, el grupo no reacciona a la carga.', 'El nombre DNS del balanceador: `aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text`.', '`ab -n 5000000 -c 150 -t 600 http://<dns>/` (necesitas `-n` grande: con `-t` solo, ab para a las 50 000 peticiones).'],
        explain: 'La CPU sube al máximo, la política calcula cuántas instancias hacen falta (CPU actual ÷ objetivo × instancias) y el grupo las lanza respetando el calentamiento. Al terminar la carga, tardará unos 15 minutos en volver a reducir.',
        par: 3,
        commands: ['ab', 'Política de escalado'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a8-3', { title: 'Multi-AZ y diseño sin punto único de fallo', summary: 'Qué pasa cuando cae una zona entera', emoji: '🛡️', commands: ['Alta disponibilidad', 'Punto único de fallo', 'Multi-AZ', 'Zona de disponibilidad'], minutes: 15 }, [
      learn(
        'La pregunta que lo cambia todo',
        `
Para cada pieza de tu arquitectura pregúntate: **«¿qué pasa si esto se cae?»**. Si la respuesta es «la aplicación deja de funcionar», es un **punto único de fallo** (SPOF).

Los fallos que se diseñan hoy son de tres tamaños:

1. **Un servidor o un disco** → lo resuelve el balanceador + Auto Scaling.
2. **Una zona de disponibilidad entera** (energía, red, incendio) → se resuelve repartiendo todo en **al menos 2 zonas**.
3. **Una región entera** (muy raro) → recuperación ante desastres entre regiones (se verá más adelante).

**Alta disponibilidad (HA)** = que el servicio **siga funcionando** (o se recupere en minutos) ante fallos de componentes. **Tolerancia a fallos** = ni un solo usuario nota nada. **Recuperación ante desastres (DR)** = volver a funcionar tras perder algo grande.
`,
        '🛡️',
      ),
      illus('aws-spof', 'Tumba una zona', 'Elige qué piezas están repartidas entre zonas y mira qué sobrevive cuando cae la zona A.'),
      learn(
        'La lista de comprobación por capas',
        `
| Capa | Para no tener un SPOF |
| --- | --- |
| Entrada | Balanceador en **2+ zonas** (siempre lo es) y DNS con comprobaciones de salud |
| Aplicación | Grupo de Auto Scaling en **2+ zonas**, **mínimo ≥ 2**, aplicación **sin estado** |
| Sesiones y caché | Fuera del servidor: ElastiCache o DynamoDB |
| Base de datos | **RDS Multi-AZ** (copia síncrona en otra zona y conmutación automática) o Aurora |
| Salida a internet | **Un NAT gateway por zona**, cada subred privada con su ruta |
| Archivos | S3 (regional por diseño) o EFS (multi-AZ) en vez de un disco EBS pegado a una instancia |

Los servicios **gestionados** como S3, DynamoDB, SQS o Lambda ya son multi-AZ por dentro: no hay nada que configurar.

La trampa más común del examen: **«una instancia más grande»** no es alta disponibilidad: es un solo servidor más caro.
`,
        '🧱',
      ),
      mc('Una base de datos RDS **Multi-AZ** sirve principalmente para…', ['Repartir las lecturas entre dos servidores', 'Seguir funcionando si cae la zona de la base de datos principal', 'Duplicar el rendimiento de las escrituras', 'Reducir el coste'], 1, 'Multi-AZ = copia **síncrona en espera** en otra zona + conmutación automática. No reparte lecturas (eso son las réplicas de lectura) y cuesta el doble.'),
      multi(
        'Una aplicación web tiene: un ALB en 2 zonas, un grupo de Auto Scaling de 1 instancia en una sola zona, y una base de datos RDS sin Multi-AZ. ¿Cuáles son puntos únicos de fallo?',
        ['El balanceador (ALB)', 'El grupo de Auto Scaling de 1 instancia en una sola zona', 'La base de datos RDS sin Multi-AZ', 'El DNS de Route 53'],
        [1, 2],
        'El ALB ya está repartido en dos zonas y Route 53 es un servicio global de alta disponibilidad. Fallan la instancia única (y su zona) y la base de datos de una sola zona.',
      ),
      demo(
        'Buscar puntos únicos de fallo',
        [
          ['aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[].[AutoScalingGroupName,MinSize,AvailabilityZones]"', 'Mínimo 1 y una sola zona: dos señales de alarma'],
          ['aws rds describe-db-instances --query "DBInstances[].[DBInstanceIdentifier,MultiAZ,AvailabilityZone]"', 'Una base de datos de una sola zona'],
          ['aws elbv2 describe-load-balancers --query "LoadBalancers[].[LoadBalancerName,AvailabilityZones[].ZoneName]"', 'El balanceador sí está en dos zonas'],
        ],
        A('ha-spof'),
      ),
      predict('¿Está la base de datos `tienda-db` en modo Multi-AZ?', 'aws rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].MultiAZ" --output text', ['True', 'Yes', 'enabled'], 'Se creó sin Multi-AZ: la consulta devuelve `False`.', A('ha-spof')),
      tf('«Elegir una instancia EC2 mucho más grande y fiable hace que la aplicación sea de alta disponibilidad.»', false, 'Sigue siendo un solo servidor en una sola zona. La alta disponibilidad se consigue con **redundancia** (varios servidores y varias zonas), no con servidores mayores.'),
      practice({
        prompt:
          'Esta tienda tiene tres puntos únicos de fallo. Arregla los **dos de la aplicación**:\n\n1. El grupo de Auto Scaling `web` usa **una sola zona** y su mínimo es **1**. Haz que use **las dos subredes del balanceador** (`tienda-alb`) y que tenga **mínimo 2** (deseado 2, máximo 4).',
        goal: 'ASG web en dos zonas con mínimo 2',
        setup: A('ha-spof'),
        check: awsEmpty('_check spof --query "Issues[?contains(@, `asg:`)]"', 'El grupo web todavía tiene un punto único de fallo (una sola zona o mínimo 1)'),
        solution: [
          'SUBS=$(aws elbv2 describe-load-balancers --names tienda-alb --query "join(\',\', LoadBalancers[0].AvailabilityZones[].SubnetId)" --output text)',
          'aws autoscaling update-auto-scaling-group --auto-scaling-group-name web --min-size 2 --desired-capacity 2 --max-size 4 --vpc-zone-identifier $SUBS',
        ],
        hints: ['Las subredes del balanceador: `aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].AvailabilityZones[].SubnetId"`.', '`aws autoscaling update-auto-scaling-group --auto-scaling-group-name web --min-size 2 --desired-capacity 2 --max-size 4 --vpc-zone-identifier <subA>,<subB>`'],
        explain: 'Con mínimo 2 y dos zonas, el grupo siempre tiene una instancia en cada zona: si cae una zona, la otra sigue sirviendo mientras el grupo repone la perdida.',
        par: 2,
        commands: ['Punto único de fallo', 'Auto Scaling'],
      }),
      practice({
        prompt: 'El tercer punto único de fallo es la base de datos **`tienda-db`** (RDS MySQL en una sola zona). Conviértela a **Multi-AZ** y aplica el cambio **ya**, sin esperar a la ventana de mantenimiento.',
        goal: 'tienda-db en Multi-AZ',
        setup: A('ha-spof'),
        check: awsEmpty('_check spof --query "Issues[?contains(@, `rds:`)]"', 'La base de datos tienda-db sigue sin Multi-AZ'),
        solution: ['aws rds modify-db-instance --db-instance-identifier tienda-db --multi-az --apply-immediately'],
        hints: ['`aws rds modify-db-instance --db-instance-identifier tienda-db --multi-az …`', 'Añade `--apply-immediately` para que se aplique ahora.'],
        explain: 'RDS crea una copia en espera en otra zona (sincronizada) y, si la principal falla, el nombre del endpoint apunta solo a la copia en 1–2 minutos. Tu aplicación no cambia nada.',
        par: 1,
        commands: ['Multi-AZ', 'Alta disponibilidad'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a8-4', { title: 'Route 53 avanzado', summary: 'Latencia, failover, ponderado y geolocalización', emoji: '🧭', commands: ['Políticas de enrutamiento', 'Comprobación de salud de Route 53', 'Alias frente a CNAME', 'aws route53 create-health-check'], minutes: 20 }, [
      learn(
        'DNS que decide',
        `
Un registro DNS normal contesta siempre lo mismo. Con las **políticas de enrutamiento** de Route 53 la respuesta **depende de quién pregunta y de cómo están tus servidores**. Cada registro lleva un **identificador** (\`SetIdentifier\`) y los de un mismo nombre deben usar la misma política:

| Política | Contesta… | Ejemplo |
| --- | --- | --- |
| **Simple** | Siempre lo mismo | Una web sencilla |
| **Ponderada** | Según pesos (90/10) | **Despliegue canario**, migraciones |
| **Latencia** | La región con menor latencia para el usuario | Una aplicación en varias regiones |
| **Failover** | El principal si está sano; si no, el secundario | **Recuperación ante desastres** |
| **Geolocalización** | Según el país o continente del usuario | Idioma, derechos de contenido, normativa |
| **Geoproximidad** | Según la distancia (con sesgo ajustable) | Mover tráfico entre regiones |
| **Varios valores** | Hasta 8 IP sanas | Reparto simple con comprobaciones |

Las **comprobaciones de salud** son lo que hace inteligentes a las políticas: si un destino no está sano, Route 53 **deja de contestar con él**.
`,
        '🧭',
      ),
      illus('aws-r53-policies', 'Quién contesta a quién', 'Elige una política y la ubicación del usuario; apaga un destino y mira cómo cambia la respuesta.'),
      match(
        'Une cada necesidad con la política',
        [
          ['Probar una versión nueva enviándole el 10 % del tráfico', 'Ponderada'],
          ['Servir a cada usuario desde la región que le responde más rápido', 'Latencia'],
          ['Pasar a un sitio de reserva si el principal deja de responder', 'Failover'],
          ['Mostrar la web en alemán a los usuarios de Alemania', 'Geolocalización'],
        ],
        'Ponderada reparte por pesos; latencia mira la velocidad; failover espera a un fallo; geolocalización mira el país.',
      ),
      learn(
        'Comprobaciones de salud: lo que hay que saber',
        `
Una **comprobación de salud** de Route 53 pide una URL o un puerto a tu servidor **desde decenas de ubicaciones del mundo** cada **10 o 30 segundos**. Si falla **3 veces seguidas** (umbral por defecto) lo marca como no sano.

Trampas habituales:

- El **security group** (y la NACL) del servidor deben dejar entrar a los **comprobadores de Route 53** (rangos de IP publicados por AWS). Si solo dejas entrar tu IP, el servidor «está caído» para Route 53 aunque funcione.
- El cambio de estado **no es instantáneo**: intervalo × umbral (p. ej. 3 × 10 s) **más el TTL** del registro, que mantienen las cachés de los usuarios. Usa TTL bajos (60 s) en registros de failover.
- Con un **alias** hacia un balanceador, activa **«evaluar la salud del destino»**: Route 53 mira si el ALB tiene destinos sanos sin que crees una comprobación aparte (y es gratis).
- Un **CNAME** no puede estar en el vértice del dominio (\`tienda.com\`); un **alias** sí, y no cuesta consultas.
`,
        '🩺',
      ),
      tf('«Un registro CNAME puede crearse en el vértice (apex) del dominio, por ejemplo `tienda.com`.»', false, 'El estándar DNS lo prohíbe. Para el vértice usa un registro **alias** de Route 53 (A o AAAA hacia un ALB, CloudFront, un sitio de S3…).'),
      demo(
        'Preguntar a Route 53 desde distintos lugares',
        [
          [ZONE],
          [IP('US', 'us-east-1', 'web-us')],
          [IP('EU', 'eu-west-1', 'web-eu')],
          ['aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \'{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"virginia","Region":"us-east-1","TTL":60,"ResourceRecords":[{"Value":"\'$US\'"}]}},{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"irlanda","Region":"eu-west-1","TTL":60,"ResourceRecords":[{"Value":"\'$EU\'"}]}}]}\'', 'Dos registros de latencia con el mismo nombre'],
          ['aws route53 test-dns-answer --hosted-zone-id $ZONE --record-name www.tienda.test --record-type A --edns0-client-subnet-ip 203.0.113.25 --query RecordData[0] --output text', 'Un usuario de España: contesta Irlanda'],
          ['aws route53 test-dns-answer --hosted-zone-id $ZONE --record-name www.tienda.test --record-type A --edns0-client-subnet-ip 198.51.100.10 --query RecordData[0] --output text', 'Un usuario de EE. UU.: contesta Virginia'],
        ],
        A('dns-ha'),
        'Los rangos 203.0.113.0/24 (España), 198.51.100.0/24 (EE. UU.) y 192.0.2.0/24 (Japón) se usan aquí como clientes de ejemplo.',
      ),
      mc('Quieres que Route 53 pase al servidor de reserva si el principal cae. ¿Qué necesitas?', ['Un registro ponderado 100/0', 'Registros de failover (primary/secondary) y una comprobación de salud en el primario', 'Un registro CNAME doble', 'Geolocalización por país'], 1, 'Failover exige identificar el primario y el secundario, y que el primario tenga una comprobación de salud para saber cuándo cae.'),
      practice({
        prompt:
          'La tienda tiene un servidor en **Virginia** (`web-us`, us-east-1) y otro en **Irlanda** (`web-eu`, eu-west-1), y una zona `tienda.test` vacía. Crea **dos registros A de latencia** para `www.tienda.test` (TTL 60), uno por región, con los identificadores `virginia` e `irlanda`, apuntando a la **IP pública** de cada servidor.\n\n(Los clientes de España —203.0.113.0/24— deben ir a Irlanda; los de EE. UU. —198.51.100.0/24— a Virginia.)',
        goal: 'Latencia: España → Irlanda, EE. UU. → Virginia',
        setup: A('dns-ha'),
        check: all(awsIs('_check dns --name www.tienda.test --client 203.0.113.25 --query Instance', 'web-eu', 'Un usuario de España debería recibir el servidor de Irlanda'), awsIs('_check dns --name www.tienda.test --client 198.51.100.10 --query Instance', 'web-us', 'Un usuario de EE. UU. debería recibir el servidor de Virginia')),
        solution: [
          ZONE,
          IP('US', 'us-east-1', 'web-us'),
          IP('EU', 'eu-west-1', 'web-eu'),
          'aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \'{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"virginia","Region":"us-east-1","TTL":60,"ResourceRecords":[{"Value":"\'$US\'"}]}},{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"irlanda","Region":"eu-west-1","TTL":60,"ResourceRecords":[{"Value":"\'$EU\'"}]}}]}\'',
        ],
        hints: ['Las IP: `aws ec2 describe-instances --region <región> --filters Name=tag:Name,Values=web-us …`. Cada servidor está en una región distinta: usa `--region`.', 'Cada registro lleva `"SetIdentifier":"…"` y `"Region":"us-east-1"` / `"eu-west-1"`.', 'Un cambio puede llevar los dos registros en el mismo `Changes`.'],
        explain: 'Route 53 mide qué región responde más rápido a cada zona del mundo y contesta con ella. Los usuarios europeos van a Irlanda y los americanos a Virginia sin que hagas nada más.',
        par: 4,
        commands: ['Políticas de enrutamiento', 'aws route53 change-resource-record-sets'],
      }),
      practice({
        prompt:
          'Monta un **failover**: `www.tienda.test` debe ir a **`web-us`** (principal) y, si cae, a **`web-eu`** (secundario).\n\n1. Crea una **comprobación de salud** HTTP contra la IP de `web-us` (puerto 80, ruta `/`).\n2. Crea dos registros A de **failover** (TTL 60): `primario` (PRIMARY, con la comprobación) y `secundario` (SECONDARY).',
        goal: 'Failover web-us → web-eu con comprobación de salud',
        setup: A('dns-ha'),
        check: all(
          awsIs("_check records --name www.tienda.test --query \"Records[?Failover=='PRIMARY'].HasHealthCheck\"", [true], 'El registro PRIMARY necesita una comprobación de salud'),
          awsIs("_check records --name www.tienda.test --query \"length(Records[?Failover=='SECONDARY'])\"", 1, 'Falta el registro SECONDARY'),
          awsIs('_check dns --name www.tienda.test --query Instance', 'web-us', 'Con todo sano, www debe apuntar al principal (web-us)'),
        ),
        solution: [
          ZONE,
          IP('US', 'us-east-1', 'web-us'),
          IP('EU', 'eu-west-1', 'web-eu'),
          'HC=$(aws route53 create-health-check --caller-reference tienda-hc --health-check-config \'{"IPAddress":"\'$US\'","Port":80,"Type":"HTTP","ResourcePath":"/","RequestInterval":10,"FailureThreshold":3}\' --query HealthCheck.Id --output text)',
          'aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \'{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"primario","Failover":"PRIMARY","TTL":60,"HealthCheckId":"\'$HC\'","ResourceRecords":[{"Value":"\'$US\'"}]}},{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","SetIdentifier":"secundario","Failover":"SECONDARY","TTL":60,"ResourceRecords":[{"Value":"\'$EU\'"}]}}]}\'',
        ],
        hints: ['`aws route53 create-health-check --caller-reference <texto único> --health-check-config \'{"IPAddress":"<ip>","Port":80,"Type":"HTTP","ResourcePath":"/"}\'` devuelve el id de la comprobación.', 'En el registro primario: `"Failover":"PRIMARY"` y `"HealthCheckId":"<id>"`. El secundario lleva `"Failover":"SECONDARY"` y no necesita comprobación.'],
        explain: 'Mientras la comprobación del primario esté sana, Route 53 contesta con él. Si deja de responder (3 fallos seguidos), contesta con el secundario hasta que se recupere.',
        par: 5,
        commands: ['aws route53 create-health-check', 'Comprobación de salud de Route 53'],
      }),
      practice({
        prompt: 'El failover de `www.tienda.test` ya está montado, pero **siempre contesta con el secundario** (`web-eu`): la comprobación de salud del primario (`web-us`) dice que está caído, aunque el servidor funciona. Revisa el **grupo de seguridad `web-abierto` de us-east-1** (hint: ¿a quién deja entrar al puerto 80?) y arréglalo para que los comprobadores de Route 53 lleguen. El primario debe volver a responder.',
        goal: 'El primario vuelve a contestar (los comprobadores llegan)',
        setup: A('dns-failover'),
        check: awsIs('_check dns --name www.tienda.test --query Instance', 'web-us', 'El primario todavía se considera caído'),
        solution: [
          'SG=$(aws ec2 describe-security-groups --region us-east-1 --filters Name=group-name,Values=web-abierto --query "SecurityGroups[0].GroupId" --output text)',
          'aws ec2 authorize-security-group-ingress --region us-east-1 --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0',
        ],
        hints: ['`aws ec2 describe-security-groups --region us-east-1 --group-names web-abierto` te muestra las reglas de entrada.', 'Solo admite una IP (la tuya). Los comprobadores de Route 53 vienen de muchas IP: abre el puerto 80 a `0.0.0.0/0` (o a sus rangos publicados).'],
        explain: 'Un clásico: el servidor funciona para ti pero no para los comprobadores. Tras corregir la regla, la comprobación vuelve a «sano» en unos segundos y Route 53 vuelve a contestar con el primario.',
        par: 2,
        commands: ['Comprobación de salud de Route 53', 'Security group'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a8-5', { title: 'CloudFront y Global Accelerator', summary: 'Acercar el contenido y las conexiones al usuario', emoji: '🌍', commands: ['CloudFront', 'Invalidación de CloudFront', 'Origin Access Control (OAC)', 'Global Accelerator', 'CloudFront frente a Global Accelerator', 'aws cloudfront create-invalidation'], minutes: 16 }, [
      learn(
        'CloudFront por dentro',
        `
**CloudFront** guarda copias de tu contenido en **ubicaciones de borde** repartidas por el mundo. Sus ideas clave:

- **Distribución**: la configuración; recibe un nombre \`dxxxxxxxx.cloudfront.net\` (y puedes poner el tuyo con un certificado de ACM).
- **Origen** (_origin_): de dónde saca el contenido cuando no lo tiene: un bucket de S3, un ALB, un servidor HTTP…
- **Comportamiento de caché** (_behavior_): qué rutas se cachean, durante cuánto (**TTL**), qué métodos se permiten y si se fuerza **HTTPS**.
- **Caché**: la primera petición va al origen (_Miss_); las siguientes se sirven desde el borde (_Hit_) hasta que caduca el TTL (86 400 s = 1 día por defecto).
- **OAC** (_Origin Access Control_): permite que CloudFront lea un bucket de S3 **privado** (con una política de bucket que nombre a tu distribución); el bucket **no** tiene que ser público.
- **Invalidaciones**: borran rutas de la caché de borde **antes** de que caduquen. Las 1 000 primeras rutas al mes son gratis. Mejor: archivos con **versión en el nombre** (\`app.v3.js\`) y no invalidar.

Una distribución tarda unos minutos en **desplegarse** (\`InProgress\` → \`Deployed\`). Para borrarla, primero se **desactiva**.
`,
        '🌍',
      ),
      illus('aws-cloudfront-flow', 'Hit, miss e invalidación', 'Pide la misma página varias veces, cambia la versión del origen y mira qué ve el usuario.'),
      mc('Subes `index.html` nuevo a S3 pero CloudFront sigue mostrando el antiguo. ¿Por qué?', ['S3 tarda horas en replicar', 'La copia en caché de los bordes no ha caducado: hay que esperar al TTL o invalidar la ruta', 'El bucket está en otra región', 'CloudFront no admite `index.html`'], 1, 'La caché de borde guarda la copia hasta que vence su TTL. `create-invalidation` la borra al momento.'),
      learn(
        'Global Accelerator: otra cosa distinta',
        `
**AWS Global Accelerator** **no cachea nada**. Te da **dos direcciones IP estáticas** (_anycast_) que el usuario alcanza en el borde de AWS más cercano, y desde ahí el tráfico viaja por la **red troncal de AWS** hasta tu aplicación (un ALB, un NLB, una instancia o una IP elástica) en la región sana más cercana.

| | **CloudFront** | **Global Accelerator** |
| --- | --- | --- |
| Qué hace | **CDN**: cachea contenido en el borde | Acelera la **ruta de red** hasta tus regiones |
| Protocolos | HTTP/HTTPS | **TCP y UDP** |
| IP fijas | No | **Sí** (2 IP estáticas) |
| Ideal para | Webs, imágenes, vídeo, APIs cacheables | Juegos, VoIP, IoT, APIs no cacheables, **listas blancas de IP** |
| Failover | Entre orígenes | **Entre regiones**, en segundos |
`,
        '🚀',
      ),
      multi(
        '¿Qué casos se resuelven mejor con **Global Accelerator** que con CloudFront?',
        ['Servir imágenes y hojas de estilo a usuarios de todo el mundo', 'Un juego con tráfico UDP que necesita una IP fija', 'Un cliente corporativo solo puede abrir su firewall a dos IP concretas de tu servicio', 'Servir un bucket privado de S3 con HTTPS y caché'],
        [1, 2],
        'Global Accelerator da IP estáticas y acelera conexiones TCP/UDP sin cachear. Las imágenes y el bucket de S3 con caché son terreno de CloudFront.',
      ),
      demo(
        'Una distribución con caché',
        [
          ['aws cloudfront list-distributions --query "DistributionList.Items[].[Id,DomainName,Status,Enabled]" --output table', 'La distribución, ya desplegada'],
          ['DOM=$(aws cloudfront list-distributions --query "DistributionList.Items[0].DomainName" --output text)'],
          ['curl -s http://$DOM/', 'Lo que ve el usuario: la versión 1 en caché'],
          ['curl -sI http://$DOM/ | grep -i x-cache', 'Cabecera X-Cache: Hit from cloudfront'],
          ['aws s3 cp s3://tienda-estaticos/index.html - ', 'En S3 ya está la versión 2 (rebajas)'],
        ],
        A('cdn-vivo'),
      ),
      predict('¿Cuál es el estado de la distribución?', 'aws cloudfront list-distributions --query "DistributionList.Items[0].Status" --output text', ['InProgress', 'Enabled', 'Active'], 'Lleva desplegada mucho tiempo: `Deployed`.', A('cdn-vivo')),
      tf('«Cuando actualizas un archivo en el origen, CloudFront lo sirve nuevo a todos los usuarios al instante.»', false, 'Cada borde mantiene su copia hasta que caduca el TTL. Por eso se invalida o, mejor, se versiona el nombre del archivo.'),
      practice({
        prompt: 'La portada de la tienda ya se actualizó en S3 (versión 2, rebajas) pero **CloudFront sigue mostrando la versión 1**. Invalida la ruta **`/index.html`** de la distribución.',
        goal: 'Que los usuarios vean la versión 2 de la portada',
        setup: A('cdn-vivo'),
        check: awsIs('_check http --url http://cf:first/ --query Body', '<h1>Tienda v2 - rebajas</h1>', 'La caché todavía sirve la versión antigua'),
        solution: ['ID=$(aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text)', 'aws cloudfront create-invalidation --distribution-id $ID --paths /index.html'],
        hints: ['El id de la distribución: `aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text`.', '`aws cloudfront create-invalidation --distribution-id <id> --paths /index.html` (la ruta empieza por `/`).'],
        explain: 'La invalidación borra esa ruta de todas las cachés de borde. En producción conviene versionar los nombres de archivo (`app.3f2a.js`) y reservar las invalidaciones para urgencias.',
        par: 2,
        commands: ['Invalidación de CloudFront', 'aws cloudfront create-invalidation'],
      }),
      practice({
        prompt:
          'El bucket **`tienda-estaticos`** es **privado** (Block Public Access activado) y contiene la web. Pon **CloudFront** delante sin hacer público el bucket:\n\n1. Crea un **OAC** (`tienda-oac`, tipo `s3`, firma `sigv4` siempre).\n2. Crea una distribución con ese bucket como origen (`tienda-estaticos.s3.amazonaws.com`), el OAC, objeto raíz **`index.html`** y redirección a HTTPS.\n3. Añade al bucket una **política** que permita `s3:GetObject` a `cloudfront.amazonaws.com` solo desde tu distribución (`AWS:SourceArn`).',
        goal: 'La web servida por CloudFront desde un bucket privado',
        setup: A('cdn'),
        check: awsIs('_check http --url https://cf:first/ --query Status', 200, 'La distribución todavía no sirve la portada del bucket privado'),
        solution: [
          'OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config Name=tienda-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 --query OriginAccessControl.Id --output text)',
          'ID=$(aws cloudfront create-distribution --distribution-config \'{"CallerReference":"tienda-1","Origins":{"Quantity":1,"Items":[{"Id":"s3","DomainName":"tienda-estaticos.s3.amazonaws.com","OriginAccessControlId":"\'$OAC\'","S3OriginConfig":{"OriginAccessIdentity":""}}]},"DefaultCacheBehavior":{"TargetOriginId":"s3","ViewerProtocolPolicy":"redirect-to-https","MinTTL":0},"DefaultRootObject":"index.html","Enabled":true,"Comment":"tienda"}\' --query Distribution.Id --output text)',
          'aws s3api put-bucket-policy --bucket tienda-estaticos --policy \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"cloudfront.amazonaws.com"},"Action":"s3:GetObject","Resource":"arn:aws:s3:::tienda-estaticos/*","Condition":{"StringEquals":{"AWS:SourceArn":"arn:aws:cloudfront::123456789012:distribution/\'$ID\'"}}}]}\'',
        ],
        hints: [
          'OAC: `aws cloudfront create-origin-access-control --origin-access-control-config Name=tienda-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3`.',
          'La distribución se crea con `aws cloudfront create-distribution --distribution-config \'<JSON>\'`. En `Origins.Items[0]` va `"OriginAccessControlId"` y `"S3OriginConfig":{"OriginAccessIdentity":""}`.',
          'La política del bucket nombra como `Principal` `{"Service":"cloudfront.amazonaws.com"}` y limita con `"Condition":{"StringEquals":{"AWS:SourceArn":"arn:aws:cloudfront::123456789012:distribution/<id>"}}`.',
        ],
        explain: 'El bucket sigue privado: nadie puede leerlo por su URL de S3. Solo tu distribución, identificada por su ARN, puede pedir objetos. Es el patrón recomendado para webs estáticas.',
        par: 4,
        commands: ['Origin Access Control (OAC)', 'CloudFront'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Misión final: **«La tienda no cae»**. Tienes una VPC `tienda` con dos subredes públicas, los grupos de seguridad `alb-sg` y `web-sg`, una **plantilla de lanzamiento `web-lt`** y una zona DNS `tienda.test`. Aún no hay balanceador ni servidores. Monta, en **us-east-1**:\n\n1. Un grupo de destino `web-tg` (HTTP:80, comprobación `/health`).\n2. Un **ALB** `tienda-alb` en las dos subredes con `alb-sg` y un oyente HTTP:80 hacia `web-tg`.\n3. Un grupo de Auto Scaling **`web`** (plantilla `web-lt`, **mínimo 2**, máximo 6, en **las dos subredes**, conectado a `web-tg`, comprobación de salud **ELB**).\n4. Una política de **seguimiento de objetivo** al 50 % de CPU.\n5. Un registro **alias** `www.tienda.test` → el ALB, con **«evaluar la salud del destino»** activado.\n\nCuando termines, `http://www.tienda.test/` debe responder 200 y no debe quedar ningún punto único de fallo.',
    goal: 'www.tienda.test sirviendo desde un ALB + Auto Scaling sin puntos únicos de fallo',
    setup: A('ha-tienda'),
    check: all(
      awsIs('_check http --url http://www.tienda.test/ --query Status', 200, 'http://www.tienda.test/ todavía no responde 200'),
      awsEmpty('_check spof --query Issues', 'Todavía queda algún punto único de fallo (una sola zona o mínimo 1)'),
      awsIs('autoscaling describe-policies --query "ScalingPolicies[].PolicyType"', ['TargetTrackingScaling'], 'Falta la política de seguimiento de objetivo'),
      awsIs('_check records --name www.tienda.test --query "Records[].EvaluateTargetHealth"', [true], 'El alias debe evaluar la salud del destino'),
    ),
    solution: [
      VPC,
      SA,
      SB,
      ALBSG,
      ZONE,
      'TG=$(aws elbv2 create-target-group --name web-tg --protocol HTTP --port 80 --vpc-id $VPC --health-check-path /health --query "TargetGroups[0].TargetGroupArn" --output text)',
      'LB=$(aws elbv2 create-load-balancer --name tienda-alb --subnets $SA $SB --security-groups $ALBSG --query "LoadBalancers[0].LoadBalancerArn" --output text)',
      'aws elbv2 create-listener --load-balancer-arn $LB --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=$TG',
      "aws autoscaling create-auto-scaling-group --auto-scaling-group-name web --launch-template LaunchTemplateName=web-lt,Version='$Default' --min-size 2 --max-size 6 --vpc-zone-identifier $SA,$SB --target-group-arns $TG --health-check-type ELB --health-check-grace-period 60",
      "aws autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration '{\"PredefinedMetricSpecification\":{\"PredefinedMetricType\":\"ASGAverageCPUUtilization\"},\"TargetValue\":50.0}'",
      'INFO=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].[DNSName,CanonicalHostedZoneId]" --output text)',
      'LBDNS=$(echo $INFO | cut -d" " -f1)',
      'LBZONE=$(echo $INFO | cut -d" " -f2)',
      'aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \'{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"www.tienda.test","Type":"A","AliasTarget":{"HostedZoneId":"\'$LBZONE\'","DNSName":"\'$LBDNS\'","EvaluateTargetHealth":true}}}]}\'',
    ],
    hints: [
      'Orden: grupo de destino → balanceador y oyente → grupo de Auto Scaling (que registra solo los servidores) → política → DNS.',
      'El grupo de Auto Scaling necesita `--vpc-zone-identifier <subA>,<subB>`, `--target-group-arns`, `--health-check-type ELB` y `--min-size 2`.',
      'El alias necesita el **nombre DNS** y el **id de zona alojada canónico** del balanceador: `aws elbv2 describe-load-balancers --query "LoadBalancers[0].[DNSName,CanonicalHostedZoneId]"`. Usa `"AliasTarget":{"HostedZoneId":…,"DNSName":…,"EvaluateTargetHealth":true}` y no pongas TTL.',
    ],
    explain: 'Has montado la arquitectura clásica de alta disponibilidad: DNS con comprobación de salud → ALB en dos zonas → flota de Auto Scaling que se repone y escala sola. Ningún servidor, ninguna zona y ningún pico puede tumbar la tienda por sí solo.',
    commands: ['Elastic Load Balancing', 'Auto Scaling', 'Políticas de enrutamiento'],
  },
});
