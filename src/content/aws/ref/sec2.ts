import type { AwsRef } from '../reference';

const DNS = 'DNS=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text)';
const CODE = (path: string) => `curl -s -o /dev/null -w '%{http_code}\\n' http://$DNS${path}`;
const REGLA_ADMIN = `echo '[{"Name":"BloquearAdmin","Priority":1,"Statement":{"ByteMatchStatement":{"SearchString":"/admin","FieldToMatch":{"UriPath":{}},"TextTransformations":[{"Priority":0,"Type":"NONE"}],"PositionalConstraint":"STARTS_WITH"}},"Action":{"Block":{}},"VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"BloquearAdmin"}}]' > reglas.json`;
const ACL = 'aws wafv2 create-web-acl --name tienda-waf --scope REGIONAL --default-action Allow={} --rules file://reglas.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tienda-waf --query Summary.Name --output text';
const ASOCIA = 'aws wafv2 associate-web-acl --web-acl-arn $(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].ARN" --output text) --resource-arn $(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)';

export const AWS_REF_SEC2: AwsRef[] = [
  // ───────────────────────── WAF y Shield ─────────────────────────
  {
    name: 'AWS WAF',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Cortafuegos de aplicaciones web: inspecciona cada petición HTTP que llega a un ALB, CloudFront, API Gateway o AppSync y decide si la deja pasar, la bloquea o solo la cuenta, según reglas que defines tú o AWS.',
    details: `
Los grupos de seguridad y las NACL trabajan en las capas 3 y 4 (IP y puerto). **WAF trabaja en la capa 7**: ve la ruta, los parámetros, las cabeceras, el cuerpo, el país de origen… y puede parar ataques como la inyección SQL, el XSS o el abuso de un formulario de login.

Piezas:

- **ACL web** (*web ACL*): el conjunto de reglas que se asocia a un recurso. Tiene una **acción por defecto** (\`Allow\` o \`Block\`) para lo que no cumple ninguna regla.
- **Reglas**: una condición (una cadena en la URL, un país, un conjunto de IP, una regex, una tasa de peticiones…) y una acción (\`Allow\`, \`Block\`, \`Count\`, \`CAPTCHA\`, \`Challenge\`). Se evalúan **por prioridad**, de menor a mayor número, hasta que una **permite o bloquea**.
- **Grupos de reglas gestionados** por AWS o por terceros (inyección SQL, vulnerabilidades comunes, IP con mala reputación, bots).
- **Ámbito**: \`REGIONAL\` (ALB, API Gateway, Cognito… en una región) o \`CLOUDFRONT\` (global; se gestiona en **us-east-1**).
- **Capacidad (WCU)**: cada regla «pesa»; una ACL admite hasta 5000.
- **Registros** (a CloudWatch Logs, S3 o Firehose; el nombre debe empezar por \`aws-waf-logs-\`) y **métricas** en CloudWatch.

Flujo de trabajo prudente: reglas nuevas primero en **\`Count\`**, mirar las muestras (*sampled requests*) y los registros, y solo entonces pasar a **\`Block\`**.
`,
    whenUse: ['Proteger una web o API de ataques comunes (OWASP Top 10)', 'Limitar abusos: fuerza bruta en el login, scraping, un cliente que satura', 'Bloquear países, IP o rutas concretas (por ejemplo `/admin` desde fuera de la oficina)'],
    whenNot: ['Para filtrar puertos o IP en la red: grupos de seguridad y NACL', 'Como sustituto de arreglar la vulnerabilidad: WAF reduce el riesgo, no corrige el código', 'Para ataques volumétricos de capa 3/4 (DDoS): Shield'],
    pricing: 'Una cuota mensual por ACL, otra por cada regla, y un importe por millón de peticiones inspeccionadas. Los grupos de reglas de pago (bots, fraude) tienen su propia cuota.',
    limits: ['Capacidad máxima de una ACL: 5000 WCU', 'Una ACL por recurso (pero una ACL puede proteger muchos recursos)', 'Los nombres de registro empiezan por `aws-waf-logs-`'],
    versus: [
      ['Grupo de seguridad / NACL', 'Filtran por IP y puerto (capa 3-4); WAF mira el contenido HTTP (capa 7).'],
      ['Shield', 'Shield absorbe ataques de denegación de servicio volumétricos; WAF filtra peticiones concretas maliciosas.'],
    ],
    scenario: 'sec-waf',
    examples: [
      ['aws wafv2 list-available-managed-rule-groups --scope REGIONAL --query "ManagedRuleGroups[].Name" --output text', 'Los grupos gestionados que AWS ofrece'],
      [REGLA_ADMIN],
      [ACL, 'Crea la ACL con una regla que bloquea /admin'],
      [ASOCIA, 'La asocia al balanceador'],
      [DNS],
      [CODE('/'), 'La portada sigue pasando'],
      [CODE('/admin/usuarios'), 'Lo de /admin lo corta WAF antes de llegar a ningún servidor (403)'],
    ],
    seeAlso: ['Reglas de WAF: prioridad y acciones', 'Grupos de reglas gestionados de WAF', 'Reglas por tasa de WAF', 'aws wafv2 create-web-acl', 'AWS Shield'],
  },
  {
    name: 'Reglas de WAF: prioridad y acciones',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Las reglas se evalúan por prioridad (número menor primero). Allow y Block terminan la evaluación; Count solo anota y sigue. Lo que no encaja en ninguna regla recibe la acción por defecto de la ACL.',
    details: `
Orden de evaluación de una ACL:

1. Se ordenan las reglas por **\`Priority\`** (de menor a mayor; no se pueden repetir).
2. Cada regla comprueba su condición. Si **no** se cumple, pasa a la siguiente.
3. Si se cumple, aplica su acción:
   - **\`Allow\`**: la petición pasa y **no se miran más reglas**.
   - **\`Block\`**: se rechaza (403 por defecto, o una respuesta personalizada con código, cabeceras y cuerpo propios).
   - **\`Count\`**: se cuenta (métrica y registro) y **sigue** con la siguiente regla.
   - **\`CAPTCHA\`** / **\`Challenge\`**: pide una prueba al navegador; a una herramienta como \`curl\` le llega un 405 o un 202.
4. Si ninguna regla termina la evaluación, se aplica la **acción por defecto** de la ACL.

Consecuencias prácticas:

- Un **\`Allow\` de prioridad baja** (para tu oficina, por ejemplo) debe ir **antes** de los \`Block\`, o nunca se alcanzará.
- Para **probar sin riesgo**, cambia la acción a \`Count\` (en un grupo gestionado, \`OverrideAction: Count\`).
- Las **transformaciones de texto** cambian lo que se compara: \`LOWERCASE\` hace que \`/ADMIN\` coincida con \`admin\`; \`URL_DECODE\` descubre \`%27\` (una comilla) camuflada. La cadena que buscas **no** se transforma sola: si usas \`LOWERCASE\`, escribe la cadena en minúsculas.
- Las condiciones se combinan con **\`AndStatement\`**, **\`OrStatement\`** y **\`NotStatement\`** (por ejemplo: «ruta empieza por /admin **y no** viene de la oficina»).
`,
    whenUse: ['Diseñar el orden de una ACL: permitir lo conocido, bloquear lo malo, dejar el resto a la acción por defecto'],
    whenNot: ['Mil reglas sueltas: agrupa en grupos de reglas y conjuntos de IP'],
    scenario: 'sec-waf',
    examples: [
      [`echo '[{"Name":"Contar","Priority":0,"Statement":{"ByteMatchStatement":{"SearchString":"/admin","FieldToMatch":{"UriPath":{}},"TextTransformations":[{"Priority":0,"Type":"LOWERCASE"}],"PositionalConstraint":"STARTS_WITH"}},"Action":{"Count":{}},"VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"Contar"}},{"Name":"Bloquear","Priority":1,"Statement":{"ByteMatchStatement":{"SearchString":"/admin","FieldToMatch":{"UriPath":{}},"TextTransformations":[{"Priority":0,"Type":"LOWERCASE"}],"PositionalConstraint":"STARTS_WITH"}},"Action":{"Block":{}},"VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"Bloquear"}}]' > reglas.json`],
      [ACL, 'Count (prioridad 0) solo cuenta; Block (prioridad 1) bloquea'],
      [ASOCIA],
      [DNS],
      [CODE('/ADMIN'), 'Con LOWERCASE, /ADMIN también coincide (403)'],
      ['aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[].Name" --output text'],
    ],
    seeAlso: ['AWS WAF', 'Grupos de reglas gestionados de WAF', 'Reglas por tasa de WAF'],
  },
  {
    name: 'Grupos de reglas gestionados de WAF',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Conjuntos de reglas ya hechos y mantenidos por AWS (o por terceros): vulnerabilidades comunes, inyección SQL, entradas conocidas como maliciosas, reputación de IP… Los añades con una sola sentencia.',
    details: `
Los más usados de AWS (gratuitos con WAF, salvo Bot Control, ATP y similares):

| Grupo | Para qué |
| --- | --- |
| \`AWSManagedRulesCommonRuleSet\` | Vulnerabilidades comunes (OWASP): XSS, lectura de ficheros locales, SSRF, cuerpos demasiado grandes, clientes sin User-Agent |
| \`AWSManagedRulesSQLiRuleSet\` | Patrones de inyección SQL en consulta, cuerpo, cookies y ruta |
| \`AWSManagedRulesKnownBadInputsRuleSet\` | Exploits conocidos (Log4j, deserialización de Java, host \`localhost\`) |
| \`AWSManagedRulesAmazonIpReputationList\` | IP que Amazon ha visto atacando |
| \`AWSManagedRulesAnonymousIpList\` | TOR, proxies anónimos, proveedores de alojamiento |
| \`AWSManagedRulesLinuxRuleSet\` | Ataques propios de Linux (LFI) |
| \`AWSManagedRulesAdminProtectionRuleSet\` | Páginas de administración expuestas |

Cómo se usa: una regla con \`ManagedRuleGroupStatement\` (\`VendorName\` + \`Name\`) y **\`OverrideAction\`** en lugar de \`Action\`:

- \`OverrideAction: {"None":{}}\` → las reglas del grupo actúan con sus acciones propias (casi todas \`Block\`).
- \`OverrideAction: {"Count":{}}\` → **modo prueba**: todo lo que el grupo detecte se cuenta pero no se bloquea.

**Falsos positivos:** un grupo puede bloquear tráfico legítimo (típico: \`SizeRestrictions_BODY\` con subidas de ficheros de más de 8 KB). La solución **no** es quitar el grupo entero: **\`RuleActionOverrides\`** cambia la acción de **una regla concreta** del grupo a \`Count\`, o \`ExcludedRules\` la excluye, y el resto de protecciones siguen activas.

Cuesta **capacidad (WCU)**: Common 700, SQLi 200, KnownBadInputs 200…
`,
    whenUse: ['Protección rápida y mantenida sin escribir reglas a mano', 'Empezar en modo Count y pasar a Block cuando no hay falsos positivos'],
    whenNot: ['Como única defensa: no conocen tu aplicación; combínalos con reglas propias (rutas, tasas, países)'],
    scenario: 'sec-waf',
    examples: [
      ['aws wafv2 describe-managed-rule-group --vendor-name AWS --name AWSManagedRulesCommonRuleSet --scope REGIONAL --query Capacity', 'Cuántas unidades de capacidad consume'],
      [`aws wafv2 describe-managed-rule-group --vendor-name AWS --name AWSManagedRulesCommonRuleSet --scope REGIONAL --query 'Rules[?starts_with(Name, \`SizeRestrictions\`)].Name' --output text`, 'Las reglas de tamaño: las de los falsos positivos'],
      ['aws wafv2 describe-managed-rule-group --vendor-name AWS --name AWSManagedRulesSQLiRuleSet --scope REGIONAL --query "length(Rules)"', 'Reglas que trae el grupo de SQLi'],
    ],
    seeAlso: ['AWS WAF', 'Reglas de WAF: prioridad y acciones'],
  },
  {
    name: 'Reglas por tasa de WAF',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Una regla por tasa cuenta las peticiones de cada origen (normalmente cada IP) en una ventana de tiempo y bloquea a quien se pase del límite, hasta que baje. Ideal contra fuerza bruta y abusos.',
    details: `
\`RateBasedStatement\` cuenta, por clave de agregación, cuántas peticiones llegan en la ventana (**1, 2, 5 o 10 minutos**; por defecto 5):

- \`Limit\`: el máximo permitido en la ventana (mínimo **10**).
- \`AggregateKeyType\`: \`IP\` (la IP del cliente), \`FORWARDED_IP\` (la de la cabecera \`X-Forwarded-For\`, para cuando hay un CDN delante), \`CONSTANT\` (todas las peticiones juntas) o claves personalizadas (cabecera, cookie, método…).
- \`ScopeDownStatement\`: **restringe qué peticiones cuentan** (por ejemplo, solo las de \`/login\`). Sin él se cuentan todas.
- Al superar el límite, la acción (\`Block\`, \`Count\`, \`CAPTCHA\`) se aplica a esa IP hasta que su tasa vuelva a bajar del límite.

Detalles útiles:

- El límite es **por IP**: otra IP no se ve afectada. Un atacante con muchas IP necesita otras defensas (grupos de reglas de bots y reputación de IP).
- Si usas **CloudFront** delante del ALB, WAF en el ALB ve la IP de CloudFront: pon la ACL en CloudFront, o agrega por \`FORWARDED_IP\`.
- La detección tarda unos segundos en la nube real; no esperes un corte exacto en la petición 101.
`,
    whenUse: ['Proteger `/login`, `/api/token` o formularios de la fuerza bruta', 'Frenar a un cliente que satura la API'],
    whenNot: ['DDoS volumétricos masivos (usa Shield y CloudFront por delante)'],
    scenario: 'sec-waf',
    examples: [
      [`echo '[{"Name":"LimiteLogin","Priority":1,"Statement":{"RateBasedStatement":{"Limit":10,"AggregateKeyType":"IP","EvaluationWindowSec":60,"ScopeDownStatement":{"ByteMatchStatement":{"SearchString":"/login","FieldToMatch":{"UriPath":{}},"TextTransformations":[{"Priority":0,"Type":"NONE"}],"PositionalConstraint":"STARTS_WITH"}}}},"Action":{"Block":{}},"VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"LimiteLogin"}}]' > reglas.json`],
      [ACL],
      [ASOCIA],
      [DNS],
      [`for i in $(seq 1 14); do ${CODE('/login')}; done | sort | uniq -c`, 'Las 10 primeras llegan al servidor (404); las siguientes reciben 403 de WAF'],
      [CODE('/'), 'El resto del sitio no cuenta: sigue pasando'],
    ],
    seeAlso: ['AWS WAF', 'Reglas de WAF: prioridad y acciones'],
  },
  {
    name: 'aws wafv2 create-web-acl',
    kind: 'comando',
    category: 'seguridad',
    level: 2,
    summary: 'Crea una ACL web con acción por defecto, reglas y configuración de métricas. Se asocia después a un ALB (`associate-web-acl`) o a una distribución de CloudFront (`WebACLId`).',
    usage: 'aws wafv2 create-web-acl --name tienda-waf --scope REGIONAL --default-action Allow={} --rules file://reglas.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tienda-waf',
    details: `
- \`--scope\`: \`REGIONAL\` (la región de la CLI) o \`CLOUDFRONT\` (hay que usar \`--region us-east-1\`).
- \`--default-action Allow={}\` o \`Block={}\`: qué pasa con lo que no cumple ninguna regla.
- \`--rules\`: lista JSON; cada regla lleva \`Name\`, \`Priority\` (únicas), \`Statement\`, \`Action\` (o \`OverrideAction\` en grupos) y \`VisibilityConfig\`.
- \`--visibility-config\`: métricas de CloudWatch y muestras activadas o no.
- Para **cambiar** una ACL: \`get-web-acl\` te da el **\`LockToken\`** y \`update-web-acl\` **sustituye todo** (lo que no envíes se pierde, reglas incluidas). Si alguien la cambió entre medias, falla con \`WAFOptimisticLockException\`.
- No se borra mientras esté asociada (\`WAFAssociatedItemException\`).
- Asociar exige permisos de WAF **y** del recurso (\`elasticloadbalancing:SetWebAcl\` para un ALB).
- \`check-capacity\` calcula los WCU que consumirían unas reglas sin crear nada.
`,
    scenario: 'sec-waf',
    examples: [
      [REGLA_ADMIN],
      ['aws wafv2 check-capacity --scope REGIONAL --rules file://reglas.json --query Capacity', 'Una regla de cadena empezando por: 2 unidades'],
      [ACL],
      ['aws wafv2 create-web-acl --name tienda-waf --scope REGIONAL --default-action Allow={} --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=otra', 'Ya existe una con ese nombre', 'error'],
      ['ID=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].Id" --output text)'],
      ['aws wafv2 get-web-acl --name tienda-waf --scope REGIONAL --id $ID --query "[WebACL.Capacity,length(WebACL.Rules)]" --output text'],
    ],
    seeAlso: ['AWS WAF', 'Reglas de WAF: prioridad y acciones'],
  },
  {
    name: 'AWS Shield',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Protección contra ataques de denegación de servicio distribuida (DDoS). Shield Standard es automático y gratuito en todas las cuentas; Shield Advanced añade protección por recurso, respuesta de expertos y reembolso de picos de coste.',
    details: `
Un ataque **DDoS** inunda tu aplicación con tráfico para que no pueda atender a nadie. Se defiende en capas:

- **Shield Standard** (todos los clientes, gratis): protege de los ataques más frecuentes de capa 3 y 4 (inundaciones SYN, reflexión UDP) en CloudFront y Route 53, y en general en la red de AWS.
- **Shield Advanced** (de pago): protección ampliada para recursos concretos (**ALB, NLB, CloudFront, Elastic IP, Global Accelerator, Route 53**), detección con métricas propias, **equipo de respuesta (SRT)** 24×7, **protección de costes** (créditos por los picos de uso que provoque un ataque) y gestión automática de reglas de WAF.
- **Diseño resistente:** CloudFront y Route 53 delante absorben tráfico en el borde; un ALB con Auto Scaling aguanta picos legítimos; **WAF** con reglas por tasa filtra la capa 7; grupos de seguridad cerrados reducen la superficie.

Recuerda el reparto: Shield defiende la **capa de red y transporte** (volumen); WAF, la **aplicación** (contenido).
`,
    whenUse: ['Standard: ya lo tienes. Advanced: negocios donde un DDoS tiene un coste alto (comercio, juegos, finanzas) o con requisitos regulatorios'],
    whenNot: ['Advanced para una web pequeña: cuesta miles de dólares al mes con compromiso de un año'],
    pricing: 'Shield Standard es gratuito. Shield Advanced cuesta unos 3 000 $ al mes por organización (compromiso de un año) más las tarifas de transferencia de los recursos protegidos.',
    versus: [['WAF', 'Shield absorbe ataques volumétricos de red; WAF filtra peticiones HTTP maliciosas concretas. Se complementan.']],
    scenario: 'sec-waf',
    examples: [
      ['aws shield get-subscription-state --query SubscriptionState --output text', 'INACTIVE: solo tienes Shield Standard (gratis)'],
      ['aws shield describe-subscription', 'No hay suscripción a Advanced', 'error'],
      ['aws shield create-protection --name alb --resource-arn $(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)', 'Proteger un recurso exige Advanced', 'error'],
    ],
    seeAlso: ['AWS WAF', 'CloudFront', 'Elastic Load Balancing'],
  },

  // ───────────────────────── detección ─────────────────────────
  {
    name: 'Amazon GuardDuty',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Detección de amenazas gestionada: lee CloudTrail, los registros de red y de DNS (y más) y levanta hallazgos con tipo y gravedad cuando ve algo sospechoso, sin instalar agentes.',
    details: `
GuardDuty analiza por ti, con inteligencia de amenazas y aprendizaje automático:

- **Eventos de CloudTrail** (¿alguien usa root? ¿se apaga CloudTrail? ¿credenciales usadas desde una IP rara?),
- **Tráfico de red (VPC Flow Logs)** y **consultas DNS** (instancia que habla con servidores de minería o de control),
- Opcionales: **eventos de datos de S3**, **auditoría de EKS**, **malware en volúmenes EBS**, inicios de sesión en RDS, ejecución en Lambda…

Un **hallazgo** tiene un **tipo** (\`CryptoCurrency:EC2/BitcoinTool.B!DNS\`, \`UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS\`), una **gravedad** (baja <4, media 4–6,9, alta ≥7), el **recurso** afectado y el detalle de la acción.

Cómo se usa en la práctica:

1. **Actívalo** en todas las cuentas y regiones (\`create-detector\`). Empieza a funcionar sin más.
2. **Envía los hallazgos a donde se actúe**: EventBridge (\`source: aws.guardduty\`) → SNS, Lambda o Security Hub.
3. **Suprime el ruido esperado** con filtros (los hallazgos archivados dejan de molestar).
4. Responde: aísla la instancia (grupo de seguridad de cuarentena), revoca la clave, parchea.

Lo que **no** hace: no bloquea nada por sí mismo (es un detector, no un cortafuegos) ni analiza el contenido de tus datos (eso es Macie) ni busca vulnerabilidades (eso es Inspector).
`,
    whenUse: ['Detección continua en toda la organización, en cuanto abres una cuenta', 'Alertas de actividad anómala que no ves con reglas fijas'],
    whenNot: ['Para prevenir (grupos de seguridad, WAF, SCP) o buscar vulnerabilidades de paquetes (Inspector)'],
    pricing: 'Se paga por volumen analizado (eventos de CloudTrail, GB de flow logs y DNS, eventos de S3). Hay una prueba gratuita de 30 días.',
    limits: ['Un detector por cuenta y región', 'Los hallazgos se conservan 90 días'],
    scenario: 'sec-gd',
    examples: [
      ['aws guardduty create-detector --enable --query DetectorId --output text', 'Se activa en esta región'],
      ['DET=$(aws guardduty list-detectors --query "DetectorIds[0]" --output text)'],
      ['aws guardduty create-sample-findings --detector-id $DET --finding-types CryptoCurrency:EC2/BitcoinTool.B!DNS Recon:EC2/PortProbeUnprotectedPort', 'Hallazgos de ejemplo para probar alertas'],
      [`aws guardduty list-findings --detector-id $DET --finding-criteria '{"Criterion":{"severity":{"Gte":7}}}' --query "length(FindingIds)"`, 'Solo los de gravedad alta (7 o más)'],
      ['aws guardduty get-findings-statistics --detector-id $DET --finding-statistic-types COUNT_BY_SEVERITY --query FindingStatistics.CountBySeverity', 'Cuántos hay de cada gravedad'],
    ],
    seeAlso: ['Filtros y supresión en GuardDuty', 'AWS Security Hub', 'Amazon EventBridge', 'Qué servicio de seguridad usar'],
  },
  {
    name: 'Filtros y supresión en GuardDuty',
    kind: 'concepto',
    category: 'seguridad',
    level: 3,
    summary: 'Un filtro con acción ARCHIVE archiva solo los hallazgos que coinciden con unos criterios (tipo, recurso, gravedad…): así se silencia el ruido esperado sin apagar la detección.',
    details: `
No todo hallazgo es un problema: un **bastión** con SSH abierto adrede recibirá sondeos todo el día. Para no ahogarte en alertas:

- \`create-filter --action ARCHIVE --finding-criteria …\` **archiva** (oculta de la lista activa) los hallazgos que cumplan **todos** los criterios, los existentes y los futuros. Se conservan 90 días y se pueden consultar.
- Los criterios usan atributos: \`type\`, \`severity\`, \`resource.instanceDetails.instanceId\`, \`service.action.actionType\`, \`resource.accessKeyDetails.userName\`… con operadores \`Eq\`, \`Neq\`, \`Gte\`, \`Lt\`…
- **Sé específico.** Un filtro por tipo solo (todos los \`PortProbe\` de la cuenta) esconderá también el hallazgo del servidor que sí debía estar cerrado. Añade el recurso.
- \`list-findings\` por defecto lista **también los archivados**; filtra con \`service.archived = false\`.
- Otras herramientas de ajuste: **listas de IP de confianza** (tus oficinas) y **listas de amenazas** propias, ambas ficheros de S3.
- Para integrarlo: EventBridge recibe cada hallazgo **nuevo**; las actualizaciones se publican según la frecuencia del detector (15 min, 1 h o 6 h).
`,
    whenUse: ['Silenciar hallazgos esperados (un bastión, un escáner de seguridad propio)'],
    whenNot: ['Para «limpiar» la lista sin entender el hallazgo: se pierde visibilidad'],
    scenario: 'sec-gd-ruido',
    examples: [
      ['DET=$(aws guardduty list-detectors --query "DetectorIds[0]" --output text)'],
      ['aws guardduty list-findings --detector-id $DET --finding-criteria \'{"Criterion":{"service.archived":{"Eq":["false"]}}}\' --query "length(FindingIds)"', 'Dos sondeos activos: uno por servidor'],
      ['BAST=$(aws ec2 describe-instances --filters Name=tag:Name,Values=bastion --query "Reservations[0].Instances[0].InstanceId" --output text)'],
      ['aws guardduty create-filter --detector-id $DET --name bastion-esperado --action ARCHIVE --finding-criteria "{\\"Criterion\\":{\\"type\\":{\\"Eq\\":[\\"Recon:EC2/PortProbeUnprotectedPort\\"]},\\"resource.instanceDetails.instanceId\\":{\\"Eq\\":[\\"$BAST\\"]}}}" --query Name --output text', 'Solo el bastión'],
      ['aws guardduty list-findings --detector-id $DET --finding-criteria \'{"Criterion":{"service.archived":{"Eq":["false"]}}}\' --query "length(FindingIds)"', 'Queda el de web-1'],
    ],
    seeAlso: ['Amazon GuardDuty', 'AWS Security Hub'],
  },
  {
    name: 'Amazon Inspector',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Busca vulnerabilidades conocidas (CVE) en instancias EC2, imágenes de contenedor en ECR y funciones Lambda, y puertos de administración expuestos a internet. Prioriza por gravedad y por si hay exploit.',
    details: `
Inspector (v2) escanea **de forma continua** en cuanto lo activas:

- **EC2:** paquetes instalados del sistema operativo frente a la base de vulnerabilidades. **Necesita el agente de Systems Manager** (instancias *administradas*): si la instancia no aparece en SSM, Inspector la lista como «sin cobertura» (\`UNMANAGED_EC2_INSTANCE\`).
- **Alcanzabilidad de red (EC2):** puertos abiertos al mundo (SSH, RDP, bases de datos), analizando grupos de seguridad, NACL y rutas. **No** necesita agente.
- **ECR:** paquetes de las imágenes al subirlas y cada vez que aparece un CVE nuevo.
- **Lambda:** dependencias y código.

Cada hallazgo trae gravedad (\`CRITICAL\`…\`LOW\`), puntuación, **¿hay exploit disponible?**, **¿hay corrección?** y el paquete afectado con la versión que lo arregla. Cuando **parcheas**, el hallazgo se **cierra solo** (\`CLOSED\`); si necesitas ignorarlo, un filtro \`SUPPRESS\` lo oculta (\`SUPPRESSED\`).

Cierre del círculo: Inspector **encuentra** los parches que faltan; **Systems Manager Patch Manager** los **aplica**. Ojo: una línea base que aprueba parches a los 7 días mantiene el hallazgo abierto durante esa semana.
`,
    whenUse: ['Saber qué vulnerabilidades tienen tus servidores e imágenes y en qué orden arreglarlas', 'Detectar puertos de administración abiertos por error'],
    whenNot: ['Para detectar ataques en curso (GuardDuty) o datos sensibles (Macie)'],
    pricing: 'Se paga por instancia escaneada al mes, por imagen y por función. Prueba gratuita de 15 días.',
    scenario: 'sec-inspector',
    examples: [
      ['aws inspector2 enable --resource-types EC2 --query "accounts[0].state.status" --output text', 'Activa el escaneo de EC2'],
      [`aws inspector2 list-findings --filter-criteria '{"severity":[{"comparison":"EQUALS","value":"CRITICAL"}]}' --query "length(findings)"`, 'Críticos activos'],
      ['aws inspector2 list-finding-aggregations --aggregation-type TITLE --query "responses[].titleAggregation.vulnerabilityId" --output text', 'CVE distintos'],
      [`aws inspector2 list-coverage --query 'coveredResources[?scanType==\`PACKAGE\`].scanStatus.statusCode' --output text`, 'Qué instancias cubre el escaneo de paquetes'],
    ],
    seeAlso: ['Patch Manager', 'Escaneo de imágenes en ECR', 'Qué servicio de seguridad usar'],
  },
  {
    name: 'Amazon Macie',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Descubre datos sensibles en S3 (tarjetas, documentos de identidad, credenciales…) con trabajos de clasificación, y vigila los buckets que son públicos o están compartidos.',
    details: `
Macie hace dos cosas:

1. **Inventario y política de buckets** (automático): para cada bucket sabe si es **público**, está **compartido con otra cuenta**, tiene **Block Public Access** desactivado, su cifrado… y abre hallazgos de política (\`Policy:IAMUser/S3BucketPublic\`…).
2. **Trabajos de clasificación** (los lanzas tú): leen los objetos de los buckets elegidos y buscan **identificadores de datos gestionados** (números de tarjeta, claves de AWS, DNI, IBAN, claves privadas…) y **propios** (una expresión regular + palabras clave cercanas, por ejemplo tu formato de número de pedido). Cada objeto con coincidencias genera un hallazgo \`SensitiveData:S3Object/Financial\`, \`/Personal\`, \`/Credentials\` o \`/Multiple\`.

Detalles:

- Solo lee objetos de **texto y formatos conocidos** (CSV, JSON, PDF, documentos…); no imágenes.
- \`--sampling-percentage\` analiza solo una parte de los objetos: más barato, menos cobertura.
- Los trabajos tardan (minutos u horas según el volumen). Macie **no borra ni mueve nada**: te dice dónde está el dato; **tú** decides: cifrarlo con una clave propia, moverlo, restringir el acceso o borrarlo.
- Los hallazgos se envían a EventBridge y a Security Hub.
`,
    whenUse: ['Saber dónde hay datos personales o financieros en tus buckets (RGPD, PCI)', 'Auditar buckets públicos o compartidos'],
    whenNot: ['Para detectar ataques (GuardDuty) o vulnerabilidades (Inspector)', 'Para bases de datos (solo S3)'],
    pricing: 'Por bucket inventariado al mes y por GB clasificado (con prueba gratuita de 30 días).',
    scenario: 'sec-macie',
    examples: [
      ['aws macie2 enable-macie', 'Se activa en la región'],
      ['aws macie2 list-managed-data-identifiers --query "items[].id" --output text', 'Lo que sabe buscar'],
      ['aws macie2 test-custom-data-identifier --regex "PED-[0-9]{6}" --sample-text "pedido PED-123456 y PED-654321" --query matchCount', 'Prueba un identificador propio'],
      ['aws macie2 describe-buckets --query "buckets[].[bucketName,publicAccess.effectivePermission]" --output text', 'Inventario de buckets'],
    ],
    seeAlso: ['AWS Security Hub', 'Block Public Access', 'Qué servicio de seguridad usar'],
  },
  {
    name: 'AWS Security Hub',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Panel único de seguridad: reúne los hallazgos de GuardDuty, Inspector, Macie y Access Analyzer y evalúa tu cuenta con controles de buenas prácticas (AWS Foundational y CIS), con una puntuación y el modo de arreglar cada fallo.',
    details: `
Security Hub resuelve «tengo diez herramientas y diez paneles»:

- **Agrega** hallazgos de servicios de AWS y de terceros en un formato común (**ASFF**), con gravedad normalizada y estado de trabajo (\`NEW\`, \`NOTIFIED\`, \`SUPPRESSED\`, \`RESOLVED\`).
- Evalúa **estándares**: *AWS Foundational Security Best Practices* y *CIS AWS Foundations*. Cada **control** (\`S3.2\`, \`EC2.13\`, \`KMS.4\`, \`CloudTrail.1\`…) da \`PASSED\` o \`FAILED\` por recurso, con su gravedad y cómo arreglarlo.
- **Necesita AWS Config grabando**: los controles se apoyan en él. Sin Config, los estándares quedan \`INCOMPLETE\` (\`NO_AVAILABLE_CONFIGURATION_RECORDER\`).
- Puedes **desactivar un control** que no te aplique (con motivo) y **suprimir** hallazgos concretos.
- **Automatiza:** cada hallazgo nuevo sale por EventBridge (\`Security Hub Findings - Imported\`): notifica, abre un ticket o remedia con Lambda/SSM.
- Se puede **agregar entre cuentas y regiones** (cuenta de administrador delegada).

Es un **agregador y un auditor**, no un detector: no encuentra amenazas nuevas por sí mismo; ordena y prioriza lo que encuentran los demás y lo que miden sus controles.
`,
    whenUse: ['Una vista única del estado de seguridad de la organización', 'Medir y mejorar el cumplimiento (CIS, FSBP, PCI)', 'Automatizar la respuesta a hallazgos desde un solo punto'],
    whenNot: ['Si no tienes Config activado: primero actívalo', 'Como sustituto de GuardDuty/Inspector/Macie: los necesita para tener datos'],
    pricing: 'Por controles evaluados y por hallazgos ingeridos, con prueba gratuita de 30 días.',
    scenario: 'sec-boss',
    examples: [
      ['aws securityhub enable-security-hub', 'Activa Security Hub con los estándares por defecto'],
      ['aws securityhub get-enabled-standards --query "StandardsSubscriptions[].StandardsStatus" --output text', 'READY: Config está grabando'],
      [`aws securityhub get-findings --filters '{"ComplianceStatus":[{"Value":"FAILED","Comparison":"EQUALS"}],"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"}]}' --query "Findings[].[ProductFields.ControlId,Title]" --output text`, 'Los controles críticos que fallan'],
    ],
    seeAlso: ['Amazon GuardDuty', 'Amazon Inspector', 'Amazon Macie', 'IAM Access Analyzer', 'AWS Config', 'Qué servicio de seguridad usar'],
  },
  {
    name: 'aws accessanalyzer validate-policy',
    kind: 'comando',
    category: 'seguridad',
    level: 3,
    summary: 'Revisa una política antes de aplicarla: errores de sintaxis y de acciones, avisos de seguridad (PassRole con `*`, `NotAction`) y sugerencias. No necesita analizador creado.',
    usage: 'aws accessanalyzer validate-policy --policy-document file://politica.json --policy-type IDENTITY_POLICY',
    details: `
- \`--policy-type\`: \`IDENTITY_POLICY\` (para usuarios, grupos y roles), \`RESOURCE_POLICY\` (bucket, clave, cola…) o \`SERVICE_CONTROL_POLICY\`.
- Cada hallazgo trae \`findingType\` (\`ERROR\`, \`SECURITY_WARNING\`, \`WARNING\`, \`SUGGESTION\`), \`issueCode\` y dónde está (\`locations\`).
- Avisos típicos: \`MISSING_VERSION\`, \`INVALID_ACTION\`, \`PASS_ROLE_WITH_STAR_IN_RESOURCE\`, \`ALLOW_WITH_NOT_ACTION\`, \`MISSING_PRINCIPAL\`, \`REDUNDANT_ACTION\`.
- Es gratis. Úsalo en integración continua antes de desplegar políticas.
`,
    scenario: 'base',
    examples: [
      [`echo '{"Statement":[{"Effect":"Allow","Action":["iam:PassRole"],"Resource":"*"},{"Effect":"Allow","Action":"s3:GetObjects","Resource":"arn:aws:s3:::b/*"}]}' > politica.json`],
      ['aws accessanalyzer validate-policy --policy-document file://politica.json --policy-type IDENTITY_POLICY --query "findings[].[findingType,issueCode]" --output text', 'Falta la versión, un PassRole abierto y una acción con errata'],
    ],
    seeAlso: ['IAM Access Analyzer', 'Mínimo privilegio', 'Política de IAM'],
  },

  // ───────────────────────── gobierno y prácticas ─────────────────────────
  {
    name: 'Evaluación de SCP: raíz, unidades y cuenta',
    kind: 'concepto',
    category: 'costes',
    level: 3,
    summary: 'Una acción solo se permite en una cuenta miembro si CADA nivel del camino (raíz → unidades → cuenta) tiene alguna SCP que la permita y ninguna que la niegue. Una SCP nunca concede permisos: solo fija el techo.',
    details: `
Imagina la jerarquía **Raíz → OU Produccion → cuenta \`web-prod\`**. Cada nivel tiene sus SCP. La regla:

1. Si **alguna** SCP de **cualquier** nivel tiene un \`Deny\` que coincide → **denegado**.
2. Si no, **en cada nivel** tiene que haber **al menos una** SCP con un \`Allow\` que cubra la acción. Si un nivel no la cubre → **denegado** (aunque los demás niveles sí).
3. Después, además, IAM tiene que permitirlo (la SCP es un techo, no un permiso).

Dos estrategias:

- **Lista de denegados** (la de por defecto): se mantiene \`FullAWSAccess\` y se añaden \`Deny\` concretos (prohibir regiones, desactivar CloudTrail…). Es sencilla y segura.
- **Lista de permitidos**: se **quita** \`FullAWSAccess\` y se permite solo lo necesario. Más estricta, más trabajo, y fácil dejarse algo (cuidado con los servicios globales).

Detalles que se preguntan en los exámenes:

- No afectan a la **cuenta de administración**.
- Sí afectan al **usuario root** de las cuentas miembro y a todos sus usuarios y roles. No a los roles vinculados a servicios.
- Toda cuenta y unidad nace con \`FullAWSAccess\`. Si la quitas del nivel, sin otra SCP \`Allow\`, **nadie** puede hacer nada ahí.
- Un \`Deny\` con \`NotAction\` y la condición \`aws:RequestedRegion\` es el patrón clásico para **limitar regiones** sin romper IAM, Organizations, Route 53 o CloudFront (servicios globales).
- Para excepciones: condición \`ArnNotLike\` sobre \`aws:PrincipalArn\` (el rol de seguridad queda fuera del bloqueo).
`,
    whenUse: ['Diseñar guardarraíles de toda una organización', 'Depurar por qué una acción está denegada aunque IAM la permita'],
    whenNot: ['Para dar permisos (usa IAM); para controles que no dependan de la API (usa Config, Security Hub)'],
    scenario: 'sec-scp',
    examples: [
      ['aws organizations list-roots --query Roots[0].Id --output text'],
      ['aws organizations list-policies --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text', 'Solo existe FullAWSAccess'],
      [`aws organizations create-policy --name solo-irlanda --description "Solo eu-west-1" --type SERVICE_CONTROL_POLICY --content '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","NotAction":["iam:*","organizations:*","sts:*","route53:*","cloudfront:*","support:*"],"Resource":"*","Condition":{"StringNotEquals":{"aws:RequestedRegion":["eu-west-1"]}}}]}' --query Policy.PolicySummary.Id --output text`, 'Denegar todo fuera de Irlanda, excepto servicios globales'],
      [`aws organizations attach-policy --policy-id $(aws organizations list-policies --filter SERVICE_CONTROL_POLICY --query 'Policies[?Name==\`solo-irlanda\`].Id' --output text) --target-id $(aws organizations list-roots --query Roots[0].Id --output text)`, 'Se aplica a toda la organización'],
      ['aws organizations list-policies-for-target --target-id $(aws organizations list-roots --query Roots[0].Id --output text) --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text', 'La raíz ahora tiene las dos'],
    ],
    seeAlso: ['SCP', 'AWS Organizations', 'AWS Control Tower', 'Mínimo privilegio'],
  },
  {
    name: 'AWS Control Tower',
    kind: 'servicio',
    category: 'costes',
    level: 2,
    summary: 'Monta y gobierna un entorno multicuenta siguiendo buenas prácticas: una landing zone con cuentas de seguridad y de registros, guardarraíles preventivos (SCP) y detectivos (Config) y una fábrica de cuentas.',
    details: `
Crear a mano una organización segura (OU, cuentas de auditoría y de registros, CloudTrail central, Config, SCP, Identity Center) lleva semanas. **Control Tower** lo automatiza:

- **Landing zone:** una organización con OU \`Security\` (cuentas *Audit* y *Log Archive*) y \`Sandbox\`, **CloudTrail y Config centralizados** hacia la cuenta de registros y acceso por IAM Identity Center.
- **Controles (guardarraíles):** *preventivos* (SCP: p. ej. «no se puede desactivar CloudTrail», «no regiones no permitidas») y *detectivos* (reglas de Config que marcan recursos fuera de norma, p. ej. «buckets públicos»). También *proactivos* (CloudFormation Hooks).
- **Account Factory:** crea cuentas nuevas ya configuradas con las líneas base y los controles de su OU (también con *Account Factory for Terraform*).
- **Panel:** estado de cumplimiento de cada OU y cuenta.

Úsalo cuando vayas a tener **muchas cuentas**; para una sola cuenta o dos es excesivo. Lo montado con Control Tower **se gestiona con Control Tower** (evita cambiar a mano sus SCP o stacks: derivan y rompen la gobernanza).
`,
    whenUse: ['Empezar con un entorno multicuenta bien montado', 'Crear cuentas nuevas con una línea base de seguridad homogénea'],
    whenNot: ['Una o dos cuentas sueltas (basta con Organizations y SCP a mano)', 'Si necesitas una estructura totalmente a medida desde el primer día'],
    pricing: 'Control Tower no tiene coste adicional; pagas los servicios que despliega (Config, CloudTrail, S3, etc.).',
    seeAlso: ['AWS Organizations', 'SCP', 'Evaluación de SCP: raíz, unidades y cuenta', 'AWS Config'],
  },
  {
    name: 'Defensa en profundidad',
    kind: 'buena práctica',
    category: 'seguridad',
    level: 2,
    summary: 'No depender de un solo control: apilar capas (identidad, red, aplicación, datos, detección, gobierno) para que el fallo de una no deje todo al descubierto.',
    details: `
Ninguna defensa es perfecta; la seguridad se construye **apilando capas independientes**:

| Capa | Pregunta | Herramientas de AWS |
| --- | --- | --- |
| **Gobierno** | ¿Qué está permitido en toda la organización? | Organizations + **SCP**, Control Tower |
| **Identidad** | ¿Quién puede hacer qué? | IAM (mínimo privilegio, roles, MFA), Identity Center |
| **Red** | ¿Quién puede llegar hasta aquí? | VPC, subredes privadas, grupos de seguridad, NACL, endpoints |
| **Aplicación** | ¿Qué peticiones son legítimas? | **WAF**, **Shield**, CloudFront |
| **Datos** | ¿Está protegido lo que guardo? | **KMS**, cifrado en reposo y en tránsito, **Secrets Manager**, **ACM**, Macie |
| **Detección** | ¿Me entero si algo falla? | **GuardDuty**, **Inspector**, **Access Analyzer**, CloudTrail, Config |
| **Respuesta** | ¿Qué hago cuando pasa? | EventBridge, Lambda, Systems Manager, **Security Hub** |

Principios:

- **Mínimo privilegio** en cada capa y **denegar por defecto**.
- **Asume que alguien se saltará una capa:** la siguiente tiene que contener el daño (un SSH abierto no debería dar acceso a datos si la clave de KMS solo la usa un rol concreto).
- **Automatiza** controles y respuestas; lo manual se olvida.
- **Audita siempre**: si no puedes ver quién hizo qué (CloudTrail), no puedes investigar.
- Recuerda el **modelo de responsabilidad compartida**: AWS protege la nube; tú, lo que pones en ella.
`,
    whenUse: ['Diseñar una arquitectura nueva o revisar una existente'],
    whenNot: ['Convertirlo en una excusa para apilar herramientas sin entender qué cubre cada una'],
    seeAlso: ['Responsabilidad compartida', 'Mínimo privilegio', 'AWS Well-Architected Framework', 'Qué servicio de seguridad usar'],
  },
  {
    name: 'Qué servicio de seguridad usar',
    kind: 'comparativa',
    category: 'seguridad',
    level: 2,
    summary: 'Cada servicio responde a una pregunta distinta: GuardDuty (¿me atacan?), Inspector (¿qué vulnerabilidades tengo?), Macie (¿dónde hay datos sensibles?), Access Analyzer (¿quién de fuera accede?), Config (¿cumple?), CloudTrail (¿quién lo hizo?), Security Hub (todo junto).',
    details: `
| Pregunta | Servicio |
| --- | --- |
| «¿Alguien está usando mis credenciales desde un sitio raro?» «¿Mi instancia mina criptomonedas?» | **GuardDuty** |
| «¿Qué paquetes con vulnerabilidades (CVE) tienen mis servidores e imágenes?» «¿Hay SSH abierto al mundo?» | **Inspector** |
| «¿Dónde guardo tarjetas, DNI o claves en S3?» | **Macie** |
| «¿Qué recursos puede usar gente de fuera de mi cuenta?» «¿Esta política es correcta?» | **IAM Access Analyzer** |
| «¿Cómo estaba este recurso ayer y cumple mis reglas?» | **AWS Config** |
| «¿Quién hizo este cambio y desde dónde?» | **CloudTrail** |
| «¿Qué peticiones web maliciosas llegan a mi aplicación?» | **WAF** |
| «¿Y si me inundan de tráfico?» | **Shield** |
| «¿Cómo está mi seguridad en conjunto, en todas las cuentas?» | **Security Hub** |
| «¿Cómo evito que nadie pueda hacer X en toda la organización?» | **SCP** |

Reglas rápidas:
- **Detectar** (GuardDuty, Inspector, Macie, Analyzer) ≠ **evaluar** (Config, Security Hub) ≠ **prevenir** (SCP, IAM, WAF, grupos de seguridad).
- Los detectores **alimentan** a Security Hub; Config **alimenta** a sus controles.
- Casi todos envían sus hallazgos a **EventBridge**: ahí se conecta la respuesta automática.
`,
    seeAlso: ['Amazon GuardDuty', 'Amazon Inspector', 'Amazon Macie', 'IAM Access Analyzer', 'AWS Security Hub', 'CloudTrail frente a Config frente a CloudWatch'],
  },
];
