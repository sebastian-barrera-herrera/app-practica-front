import type { AwsRef } from '../reference';

const RANGO = (desde: string) => `--start-time $(date -u -d "${desde}" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ)`;
const TOPIC = 'TOPIC=$(aws sns list-topics --query "Topics[0].TopicArn" --output text)';

export const AWS_REF_OPS: AwsRef[] = [
  // ───────────────────────── CloudWatch ─────────────────────────
  {
    name: 'Amazon CloudWatch',
    kind: 'servicio',
    category: 'operaciones',
    level: 1,
    summary: 'El servicio de observabilidad de AWS: métricas (números en el tiempo), alarmas, paneles y registros. Casi todos los servicios publican en él sin que hagas nada.',
    details: `
CloudWatch es la suma de varias piezas que se usan juntas:

- **Métricas**: series de datos con espacio de nombres, nombre y dimensiones (\`AWS/EC2\` · \`CPUUtilization\` · \`InstanceId=i-…\`). Las publican los servicios de AWS y también tu aplicación (\`put-metric-data\`).
- **Alarmas**: vigilan una métrica (o a otras alarmas) y ejecutan acciones al cambiar de estado.
- **Paneles**: gráficas en una página para ver el estado de un vistazo.
- **Logs** y **Logs Insights**: registros y consultas sobre ellos.
- **Eventos** (hoy EventBridge) para reaccionar a lo que ocurre.

Cuándo ve cada cosa: los datos de 1 minuto se conservan 15 días; los de 5 minutos, 63 días; los de 1 hora, 15 meses. Muchos servicios publican cada 5 minutos por defecto (EC2 con «monitorización detallada» activada, cada 1).

Lo que **no** es: no es una herramienta de auditoría (eso es CloudTrail) ni de cumplimiento (Config).
`,
    whenUse: ['Vigilar cualquier recurso de AWS y tu propia aplicación', 'Avisar a personas o disparar automatizaciones cuando algo supera un umbral', 'Tener un panel único del estado de un servicio'],
    whenNot: ['Para saber quién hizo un cambio: CloudTrail', 'Para seguir una petición entre servicios: X-Ray', 'Si necesitas retener métricas años con resolución fina: expórtalas (a S3 con Firehose) o usa un almacén de series temporales'],
    pricing: 'Las métricas de los servicios de AWS son gratis (con resolución estándar). Pagas por cada métrica personalizada al mes, por cada alarma, por panel y por las llamadas a la API (por ejemplo, las consultas masivas con `GetMetricData`).',
    limits: ['Hasta 30 dimensiones por métrica', 'Datos de 1 minuto: 15 días · 5 minutos: 63 días · 1 hora: 15 meses', 'Los datos con más de 2 semanas de antigüedad no se pueden publicar'],
    versus: [
      ['Prometheus + Grafana', 'Estándar abierto muy popular en Kubernetes; CloudWatch está integrado sin instalar nada y en AWS lo gestionan ellos. Hay servicios gestionados de ambos (Amazon Managed Prometheus/Grafana).'],
      ['Datadog / New Relic', 'Plataformas de terceros con más funciones de análisis, de pago por host; empiezan a ser interesantes cuando mezclas varias nubes.'],
    ],
    scenario: 'ops-metricas',
    examples: [
      ['aws cloudwatch list-metrics --namespace AWS/EC2 --query "length(Metrics)"', 'Los servicios de AWS publican solos (aquí, aún no hay instancias: 0)'],
      ['aws cloudwatch put-metric-data --namespace Tienda --metric-name Pedidos --value 12 --unit Count', 'Una métrica propia'],
      ['aws cloudwatch list-metrics --namespace Tienda', 'Ya existe en su espacio de nombres'],
      [`aws cloudwatch get-metric-statistics --namespace Tienda --metric-name Pedidos ${RANGO('10 minutes ago')} --period 60 --statistics Sum`, 'La suma por minuto'],
    ],
    seeAlso: ['Métricas y dimensiones', 'Alarmas de CloudWatch', 'Amazon CloudWatch Logs', 'Observabilidad: las tres señales'],
  },
  {
    name: 'Métricas y dimensiones',
    kind: 'concepto',
    category: 'operaciones',
    level: 1,
    summary: 'Una métrica se identifica por su espacio de nombres, su nombre y su conjunto exacto de dimensiones. Cambiar una dimensión es hablar de otra métrica.',
    details: `
- **Espacio de nombres** (\`Tienda\`, \`AWS/Lambda\`): agrupa métricas. El prefijo \`AWS/\` está reservado.
- **Nombre** (\`PedidosFallidos\`) y **unidad** (\`Count\`, \`Milliseconds\`, \`Percent\`, \`Bytes\`…).
- **Dimensiones**: pares nombre=valor que subdividen la métrica (\`FunctionName=pedidos\`, \`Servicio=checkout\`).
- **Estadísticas**: \`Sum\`, \`Average\`, \`Minimum\`, \`Maximum\`, \`SampleCount\` y percentiles (\`p95\`, \`p99\`). Se calculan por **periodo** (60 s, 300 s…).
- **Resolución alta** (1 s) para métricas propias, a mayor precio.

⚠️ **Dos trampas clásicas:**

1. Una alarma (o un panel) con otras dimensiones que las que publica la aplicación no encuentra datos: queda en \`INSUFFICIENT_DATA\`.
2. **Cardinalidad**: si metes el id de usuario como dimensión creas una métrica por usuario (y las pagas todas). Las dimensiones son para pocas categorías (servicio, entorno, región), no para identificadores.

Para combinar métricas (tasa de error = errores / peticiones) usa **métricas matemáticas** con \`get-metric-data\`.
`,
    whenUse: ['Cada vez que publiques datos propios: decide primero qué dimensiones tendrán', 'Al depurar una alarma que no recibe datos'],
    whenNot: ['No pongas identificadores de alta cardinalidad (usuario, pedido) como dimensión: usa registros o trazas para eso'],
    pricing: 'Cada combinación única de espacio de nombres, nombre y dimensiones cuenta como una métrica personalizada (y se factura por mes).',
    scenario: 'ops-alarma-muda',
    examples: [
      ['aws cloudwatch list-metrics --namespace Tienda --query "Metrics[].[MetricName,Dimensions[0].Value]" --output text', 'El mismo nombre, dos conjuntos de dimensiones'],
      [`aws cloudwatch get-metric-statistics --namespace Tienda --metric-name LatenciaMs --dimensions Name=Servicio,Value=checkout ${RANGO('30 minutes ago')} --period 300 --statistics Average Maximum`, 'Con las dimensiones correctas hay datos'],
      [`aws cloudwatch get-metric-statistics --namespace Tienda --metric-name LatenciaMs ${RANGO('30 minutes ago')} --period 300 --statistics Average --query "length(Datapoints)"`, 'Sin dimensiones es otra métrica, y no tiene datos'],
      ['aws cloudwatch put-metric-data --namespace AWS/Tienda --metric-name X --value 1', 'El prefijo AWS/ es solo de AWS', 'error'],
    ],
    seeAlso: ['Amazon CloudWatch', 'Alarmas de CloudWatch'],
  },
  {
    name: 'Alarmas de CloudWatch',
    kind: 'concepto',
    category: 'operaciones',
    level: 2,
    summary: 'Una alarma vigila una métrica y cambia entre OK, ALARM e INSUFFICIENT_DATA; al cambiar ejecuta acciones (SNS, Auto Scaling, EC2, Systems Manager).',
    details: `
Los ajustes que definen una alarma:

- **Qué mira**: espacio de nombres, métrica, dimensiones, **estadística** y **periodo**.
- **Cuándo salta**: \`--threshold\`, \`--comparison-operator\` y los periodos (\`--evaluation-periods\`, y \`--datapoints-to-alarm\` para «M de N»).
- **Datos que faltan** (\`--treat-missing-data\`): \`missing\`, \`notBreaching\`, \`breaching\` o \`ignore\`.
- **Acciones** para \`ALARM\`, \`OK\` e \`INSUFFICIENT_DATA\`: temas SNS, acciones de EC2 (\`arn:aws:automate:…:ec2:reboot\`), Auto Scaling, Systems Manager. Se pueden desactivar con \`disable-alarm-actions\`.

Para depurar: \`describe-alarms\` (estado y **motivo**), \`describe-alarm-history\` (cada cambio y **cada acción**, con su éxito o fallo) y \`set-alarm-state\` para **probar** el aviso sin esperar a que ocurra el problema.

Buenas prácticas: alarma sobre **síntomas** que vive el usuario (errores, latencia p95) más que sobre causas (CPU); un umbral con sentido (no alertes de lo que nadie puede arreglar); y avisos con **enlace al panel o al manual** en la descripción.
`,
    whenUse: ['Avisar de errores, latencia o saturación', 'Disparar una acción automática (escalar, reiniciar)', 'Vigilar costes (alarma de facturación)'],
    whenNot: ['Para investigar «qué pasó»: una alarma dice que algo va mal, no por qué (registros y trazas)', 'Si nadie va a actuar cuando suene: es ruido'],
    pricing: 'Se paga por alarma y mes (las de alta resolución y las compuestas cuestan más). Las acciones SNS tienen su propia tarifa.',
    scenario: 'ops-metricas',
    examples: [
      [TOPIC, 'El ARN del tema de avisos'],
      ['aws cloudwatch put-metric-alarm --alarm-name pedidos-fallidos --namespace Tienda --metric-name PedidosFallidos --statistic Sum --period 60 --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC', 'Más de 5 fallos en un minuto avisan al tema'],
      ['aws cloudwatch describe-alarms --alarm-names pedidos-fallidos --query "MetricAlarms[0].[StateValue,StateReason]" --output text', 'Aún sin datos'],
      ['aws cloudwatch set-alarm-state --alarm-name pedidos-fallidos --state-value ALARM --state-reason "Prueba del aviso"', 'Fuerza el estado para probar las acciones'],
      ['aws cloudwatch describe-alarm-history --alarm-name pedidos-fallidos --history-item-type Action --query "AlarmHistoryItems[].HistorySummary" --output text', 'Se ve que la acción se ejecutó'],
    ],
    seeAlso: ['Alarmas compuestas', 'Amazon CloudWatch', 'Métricas y dimensiones'],
  },
  {
    name: 'Alarmas compuestas',
    kind: 'concepto',
    category: 'operaciones',
    level: 2,
    summary: 'Una alarma que combina el estado de otras alarmas con AND, OR y NOT: sirve para avisar de un diagnóstico («servicio degradado») y no de cada síntoma por separado.',
    details: `
\`\`\`
aws cloudwatch put-composite-alarm --alarm-name tienda-degradada \\
  --alarm-rule 'ALARM("latencia-alta") AND ALARM("errores-altos")' \\
  --alarm-actions $TOPIC
\`\`\`

- La regla usa \`ALARM("nombre")\`, \`OK("nombre")\`, \`INSUFFICIENT_DATA("nombre")\`, con \`AND\`, \`OR\`, \`NOT\` y paréntesis. También acepta ARN.
- No mira métricas: mira **estados de otras alarmas**, que siguen evaluándose y conservando su propia historia.
- Para reducir ruido, quita las acciones de las alarmas «hijas» (\`disable-alarm-actions\`) y deja las acciones en la compuesta.
- Se pueden encadenar (una compuesta puede depender de otra) con cuidado de no crear dependencias circulares.
- \`--actions-suppressor\` permite silenciar las acciones mientras otra alarma está en ALARM (por ejemplo, durante un mantenimiento).

Un patrón muy usado: «avisa solo si **la web va lenta Y además hay errores**», o «no me despiertes si hay un despliegue en curso» (suprimiendo con la alarma de despliegue).
`,
    whenUse: ['Cuando varios síntomas del mismo problema generan varios avisos', 'Para suprimir alertas durante mantenimientos'],
    whenNot: ['Para una sola métrica: una alarma normal basta'],
    pricing: 'Cada alarma compuesta se factura aparte (más barata que una de métrica de alta resolución).',
    scenario: 'ops-compuesta',
    examples: [
      [TOPIC, 'El tema de avisos'],
      ['aws cloudwatch put-composite-alarm --alarm-name tienda-degradada --alarm-rule \'ALARM("latencia-alta") AND ALARM("errores-altos")\' --alarm-actions $TOPIC', 'Un solo aviso cuando ocurren las dos cosas'],
      ['aws cloudwatch disable-alarm-actions --alarm-names latencia-alta errores-altos', 'Las simples dejan de avisar por su cuenta'],
      ['aws cloudwatch describe-alarms --alarm-types CompositeAlarm --query "CompositeAlarms[0].[AlarmName,AlarmRule,StateValue]" --output text', 'La compuesta y su estado'],
    ],
    seeAlso: ['Alarmas de CloudWatch'],
  },
  {
    name: 'Paneles de CloudWatch',
    kind: 'concepto',
    category: 'operaciones',
    level: 2,
    summary: 'Páginas con gráficas, números y alarmas de varios recursos, definidas con un JSON de widgets. Sirven para mirar de un vistazo el estado de un servicio.',
    details: `
Un panel es un JSON con una lista de **widgets** (\`metric\`, \`text\`, \`alarm\`, \`log\`) y su posición en una cuadrícula de 24 columnas:

\`\`\`json
{ "widgets": [
  { "type": "metric", "x": 0, "y": 0, "width": 12, "height": 6,
    "properties": { "title": "Pedidos", "region": "us-east-1", "stat": "Sum", "period": 300,
                    "metrics": [["Tienda", "Pedidos"]] } }
]}
\`\`\`

- Se crea con \`put-dashboard\` (si existe, lo reemplaza), se lee con \`get-dashboard\` y se lista con \`list-dashboards\`.
- Los paneles pueden mostrar métricas de **varias regiones y cuentas**.
- Tenerlo definido como JSON (en Git, en CloudFormation) permite **recrearlo** igual en otro entorno.
- Un buen panel de servicio sigue el orden «**tráfico, errores, latencia, saturación**» (las cuatro señales doradas) y trae enlaces a las alarmas y a los registros.
`,
    whenUse: ['Pantalla de estado del equipo', 'Recopilar en un sitio las métricas de un servicio que usa varios recursos'],
    whenNot: ['Para avisar: los paneles no avisan, las alarmas sí'],
    pricing: 'Los tres primeros paneles (con hasta 50 métricas) son gratuitos; después, tarifa mensual por panel.',
    scenario: 'ops-metricas',
    examples: [
      [`echo '{"widgets":[{"type":"metric","x":0,"y":0,"width":12,"height":6,"properties":{"title":"Pedidos","region":"us-east-1","stat":"Sum","period":300,"metrics":[["Tienda","Pedidos"]]}}]}' > panel.json`, 'El JSON del panel'],
      ['aws cloudwatch put-dashboard --dashboard-name tienda --dashboard-body file://panel.json', 'Crea (o reemplaza) el panel'],
      ['aws cloudwatch list-dashboards --query "DashboardEntries[].DashboardName" --output text', 'Los paneles que hay'],
      ['aws cloudwatch get-dashboard --dashboard-name tienda --query DashboardName --output text', 'Se puede leer de vuelta'],
    ],
    seeAlso: ['Amazon CloudWatch', 'Alarmas de CloudWatch'],
  },

  // ───────────────────────── Logs ─────────────────────────
  {
    name: 'aws logs tail',
    kind: 'comando',
    category: 'operaciones',
    level: 1,
    summary: 'Ver los registros de un grupo de CloudWatch Logs según llegan, como un `tail -f`, con filtros y un rango de tiempo.',
    usage: 'aws logs tail <grupo> [--since 10m] [--follow] [--filter-pattern PATRÓN] [--log-stream-name-prefix PREFIJO] [--format short|detailed|json]',
    details: `
- \`--since\` acepta duraciones (\`30s\`, \`10m\`, \`2h\`, \`1d\`) o una fecha.
- \`--follow\` se queda esperando líneas nuevas (Ctrl+C para salir).
- \`--filter-pattern\` usa el mismo mini-lenguaje que \`filter-log-events\`.
- \`--log-stream-name-prefix\` limita a las instancias o ejecuciones que te interesan.
- \`--format\`: \`short\` (hora y mensaje), \`detailed\` (con el nombre del flujo) o \`json\`.

Para depurar una Lambda justo después de invocarla, es lo más rápido: \`aws logs tail /aws/lambda/mi-funcion --since 5m --follow\`.
`,
    whenUse: ['Depurar en caliente', 'Mirar un incidente reciente sin abrir la consola'],
    whenNot: ['Para análisis (percentiles, agrupaciones): Logs Insights', 'Para vigilar: filtro de métricas y alarma'],
    scenario: 'ops-logs',
    examples: [
      ['aws logs tail /tienda/api --since 10m --filter-pattern ERROR', 'Los errores de los últimos 10 minutos'],
      ['aws logs tail /tienda/api --since 3h --filter-pattern PaymentDeclined --format short', 'Un error concreto en las últimas 3 horas'],
    ],
    seeAlso: ['Amazon CloudWatch Logs', 'aws logs filter-log-events', 'Logs Insights'],
  },
  {
    name: 'Filtros de métricas',
    kind: 'concepto',
    category: 'operaciones',
    level: 2,
    summary: 'Convierten las líneas de un grupo de registros que cumplen un patrón en puntos de una métrica de CloudWatch, que luego se puede vigilar con una alarma.',
    details: `
\`\`\`
aws logs put-metric-filter --log-group-name /tienda/api --filter-name errores-5xx \\
  --filter-pattern '{ $.status >= 500 }' \\
  --metric-transformations metricName=Errores5xx,metricNamespace=Tienda,metricValue=1,defaultValue=0
\`\`\`

- **Patrones**: texto (\`ERROR\`, \`"timed out"\`, \`?ERROR ?WARN\`, \`-DEBUG\`), por campos separados por espacios (\`[ip, user, ..., status=5*, bytes]\`) y **JSON** (\`{ $.status >= 500 && $.route = "/api/pago" }\`).
- \`metricValue\`: \`1\` para contar líneas, o un campo (\`$.latency\`) para publicar su valor.
- \`defaultValue=0\`: publica ceros cuando no hay coincidencias (la alarma no se queda sin datos).
- Hasta 3 dimensiones tomadas de campos JSON (\`dimensions\`), con cuidado con la cardinalidad.
- **Solo cuenta lo que llega después de crearlo.** Se prueba con \`test-metric-filter\` antes de aplicarlo.

Cadena habitual: registro → filtro → métrica → alarma → aviso.
`,
    whenUse: ['Alarmar sobre errores que solo aparecen en los registros (excepciones, intentos de acceso fallidos)', 'Contar eventos de negocio escritos en el registro'],
    whenNot: ['Si necesitas agrupar por ruta, usuario o calcular percentiles: Logs Insights', 'Si la aplicación ya puede publicar la métrica por sí misma (formato de métrica embebida)'],
    pricing: 'Los filtros no cuestan; sí la métrica personalizada que generan y la alarma que añadas.',
    scenario: 'ops-logs',
    examples: [
      [`aws logs test-metric-filter --filter-pattern '{ $.status >= 500 }' --log-event-messages '{"status":503,"route":"/api/pedidos"}' '{"status":200,"route":"/api/catalogo"}' --query "length(matches)"`, 'Prueba el patrón antes de crearlo: coincide 1 de 2'],
      [`aws logs put-metric-filter --log-group-name /tienda/api --filter-name errores-5xx --filter-pattern '{ $.status >= 500 }' --metric-transformations metricName=Errores5xx,metricNamespace=Tienda,metricValue=1,defaultValue=0`, 'El filtro'],
      ['aws logs describe-metric-filters --log-group-name /tienda/api --query "metricFilters[].[filterName,filterPattern]" --output text', 'Los filtros del grupo'],
    ],
    seeAlso: ['Amazon CloudWatch Logs', 'Alarmas de CloudWatch', 'Logs Insights'],
  },
  {
    name: 'Logs Insights',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Lenguaje de consulta para analizar registros: filtra, extrae campos, agrega (cuenta, medias, percentiles) y ordena, sobre uno o varios grupos y un rango de tiempo.',
    details: `
\`\`\`
fields @timestamp, route, latency
| filter status >= 500
| stats count(*) as n, pct(latency, 95) as p95 by route
| sort p95 desc
| limit 10
\`\`\`

- **Comandos**: \`fields\`, \`filter\`, \`stats\`, \`sort\`, \`limit\`, \`parse\` (extraer campos de texto libre), \`dedup\`, \`display\`.
- **Funciones de agregación**: \`count\`, \`sum\`, \`avg\`, \`min\`, \`max\`, \`pct\`, \`stddev\`, \`count_distinct\`. Con \`bin(5m)\` se hacen series temporales.
- **Campos**: \`@timestamp\`, \`@message\`, \`@logStream\`… y los campos de los registros **JSON se descubren solos**. Los registros de Lambda traen \`@duration\`, \`@billedDuration\`, \`@maxMemoryUsed\`, \`@initDuration\` (arranque en frío).
- **Asíncrono**: \`start-query\` → \`queryId\`; \`get-query-results\` hasta que el estado sea \`Complete\`. Se pueden parar con \`stop-query\`.
- Se paga por **GB analizado**: limita el rango y los grupos, y usa \`filter\` lo antes posible.

Para la latencia, desconfía de la media y mira el **percentil 95/99**.
`,
    whenUse: ['Investigar un incidente: qué ruta falla, qué usuario, a qué hora', 'Percentiles de latencia y consumo de memoria de Lambda', 'Responder preguntas que no habías previsto al crear los registros'],
    whenNot: ['Vigilancia continua: filtro de métricas + alarma (más barato y automático)', 'Analítica masiva de años de datos: llévalos a S3 y usa Athena'],
    pricing: 'Se cobra por GB de datos escaneados en cada consulta. Un rango de tiempo corto y pocos grupos lo mantienen barato.',
    limits: ['Hasta varios grupos de registros por consulta', 'Los resultados tienen un máximo de filas (`limit`)'],
    versus: [
      ['Athena sobre S3', 'Para históricos largos y análisis pesados con SQL; Insights es más rápido de usar sobre datos recientes.'],
      ['OpenSearch / Elasticsearch', 'Búsqueda de texto completo y paneles muy flexibles, pero hay que operar el clúster (o pagar el servicio).'],
    ],
    scenario: 'ops-logs',
    examples: [
      ['Q=$(aws logs start-query --log-group-name /tienda/api --start-time $(date -u -d "4 hours ago" +%s) --end-time $(date -u +%s) --query-string \'stats count(*) as n, pct(latency, 95) as p95 by route | sort p95 desc\' --query queryId --output text)', 'Arranca la consulta'],
      ['aws logs get-query-results --query-id $Q --query status --output text', 'Estado de la consulta'],
      ['aws logs get-query-results --query-id $Q --query "results[*][*].value" --output text', 'Ruta, peticiones y p95 (ordenadas por p95)'],
    ],
    seeAlso: ['Amazon CloudWatch Logs', 'Filtros de métricas', 'aws logs filter-log-events'],
  },
  {
    name: 'Retención y coste de los registros',
    kind: 'buena práctica',
    category: 'operaciones',
    level: 1,
    summary: 'Los registros no caducan por defecto y se pagan por recibirlos y por guardarlos: fija una retención en cada grupo y registra solo lo útil.',
    details: `
Dónde se va el dinero de los registros:

1. **Recepción** (por GB que entra): la parte más cara. Un \`DEBUG\` olvidado en producción multiplica la factura.
2. **Almacenamiento** (por GB y mes): sin retención crece para siempre.
3. **Consultas** de Insights (por GB analizado).

Qué hacer:

- **Retención en cada grupo**: \`aws logs put-retention-policy --log-group-name … --retention-in-days 14\` (valores permitidos: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365…). Lo normal: 14–30 días en aplicaciones, 90–365 en auditoría.
- **Archivar** lo que debas conservar más: exportación a S3 (con ciclo de vida a Glacier).
- **Nivel de registro** adecuado (\`INFO\` en producción, \`DEBUG\` solo cuando lo necesites y con una fecha para apagarlo).
- **No registres** secretos, tarjetas ni datos personales: quedan guardados y los lee cualquiera con permisos sobre el grupo.
- Los grupos que crea Lambda y otros servicios nacen **sin retención**: ponla en la plantilla de infraestructura.
`,
    whenUse: ['En cada grupo de registros, desde el primer día'],
    whenNot: ['Registros de auditoría con requisitos legales: la retención la fija la norma, no el ahorro'],
    pricing: 'Por GB recibido, por GB almacenado al mes y por GB analizado en Insights. Hay una capa gratuita pequeña.',
    scenario: 'ops-logs',
    examples: [
      ['aws logs describe-log-groups --query "logGroups[].[logGroupName,retentionInDays]" --output text', 'Sin retención (`None`): nunca caduca'],
      ['aws logs put-retention-policy --log-group-name /tienda/api --retention-in-days 14', 'Ahora, 14 días'],
      ['aws logs describe-log-groups --query "logGroups[0].retentionInDays"', 'Comprobado'],
      ['aws logs put-retention-policy --log-group-name /tienda/api --retention-in-days 10', 'Solo valen los valores de la lista', 'error'],
    ],
    seeAlso: ['Amazon CloudWatch Logs', 'Filtros de métricas'],
  },

  // ───────────────────────── CloudTrail y Config ─────────────────────────
  {
    name: 'AWS CloudTrail',
    kind: 'servicio',
    category: 'operaciones',
    level: 1,
    summary: 'El registro de auditoría de la cuenta: cada llamada a la API de AWS (consola, CLI, SDK, servicios) con quién, qué, cuándo, desde dónde y si funcionó.',
    details: `
Un evento de CloudTrail lleva, entre otros campos:

- \`userIdentity\`: quién (usuario IAM, rol asumido con el nombre de la sesión, root, servicio de AWS).
- \`eventSource\` y \`eventName\`: qué (\`ec2.amazonaws.com\` · \`AuthorizeSecurityGroupIngress\`).
- \`eventTime\`, \`awsRegion\`, \`sourceIPAddress\` y \`userAgent\` (\`aws-cli\`, \`Boto3\`, consola…).
- \`requestParameters\` y \`responseElements\`: con qué parámetros y qué devolvió.
- \`errorCode\` / \`errorMessage\` si falló (\`AccessDenied\`, \`UnauthorizedOperation\`): **los intentos denegados también quedan**.

Dónde consultarlo:

- **Historial de eventos**: últimos 90 días de eventos de gestión, gratis, por región (\`lookup-events\`, un solo atributo de búsqueda por consulta).
- **Un trail** entrega los eventos a S3 (y CloudWatch Logs): conserva todo el tiempo que quieras.
- **CloudTrail Lake** guarda y consulta con SQL; **Athena** sobre el bucket para investigaciones grandes.

CloudTrail **registra, no impide**. Para impedir, IAM y SCP.
`,
    whenUse: ['Averiguar quién hizo un cambio o borró un recurso', 'Cumplir auditorías y normas (conservación y validación de integridad)', 'Detectar actividad sospechosa (inicios de sesión raros, llamadas denegadas)'],
    whenNot: ['Para saber cómo estaba configurado un recurso en el tiempo: Config', 'Para monitorizar rendimiento: CloudWatch'],
    pricing: 'Una copia de los eventos de gestión de cada región (el historial y un trail) es gratuita; las copias adicionales, los eventos de datos, los eventos de Insights y CloudTrail Lake se pagan.',
    limits: ['Historial: 90 días de eventos de gestión', 'Hasta 5 trails por región', 'Los archivos llegan a S3 con unos minutos de retraso'],
    versus: [
      ['AWS Config', 'Config guarda el estado de los recursos y evalúa reglas; CloudTrail guarda las llamadas a la API que los cambiaron.'],
      ['Registros de acceso de S3 / VPC Flow Logs', 'Registran el acceso a datos o el tráfico de red, no las llamadas de gestión a la API.'],
    ],
    scenario: 'ops-auditoria',
    examples: [
      ['aws cloudtrail lookup-events --max-results 5 --query "Events[].[EventTime,Username,EventName]" --output text', 'Lo último que ha pasado en la cuenta'],
      ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress --query "Events[].[EventTime,Username]" --output text', 'Quién ha abierto puertos'],
      ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=lucia --query "Events[].EventName" --output text', 'Todo lo de una persona (incluidos los intentos denegados)'],
    ],
    seeAlso: ['Trails y eventos de datos', 'CloudTrail frente a Config frente a CloudWatch', 'AWS Config'],
  },
  {
    name: 'Trails y eventos de datos',
    kind: 'concepto',
    category: 'operaciones',
    level: 2,
    summary: 'Un trail entrega los eventos de CloudTrail a un bucket de S3 (y a CloudWatch Logs) para conservarlos, y puede añadir eventos de datos (objetos de S3, funciones Lambda…), que son de pago.',
    details: `
- **Bucket de entrega** con una política que permita a \`cloudtrail.amazonaws.com\` hacer \`s3:GetBucketAcl\` y \`s3:PutObject\` en \`AWSLogs/<cuenta>/\` con \`bucket-owner-full-control\`.
- **Multirregión** (\`--is-multi-region-trail\`): una sola configuración cubre todas las regiones, incluidas las que no usas (donde un atacante crearía recursos).
- **Eventos globales** (IAM, STS, CloudFront) incluidos por defecto.
- **Validación de integridad** (\`--enable-log-file-validation\`) y \`validate-logs\` para demostrar que no se han manipulado.
- **CloudWatch Logs**: con un rol, el trail envía los eventos a un grupo de registros para alarmar sobre ellos (inicio de sesión de root, cambios de políticas).
- **Selectores de eventos** (\`put-event-selectors\`): lectura/escritura/ambos, y **eventos de datos** de recursos concretos (\`AWS::S3::Object\` de un bucket, \`AWS::Lambda::Function\`).
- **Trail de organización** (\`--is-organization-trail\`) para toda una AWS Organization.
- Un trail creado con la CLI **no registra hasta \`start-logging\`**.

Los archivos son JSON comprimido, entregados cada ~5 minutos por región.
`,
    whenUse: ['Siempre: un trail multirregión por cuenta (o uno de organización)', 'Eventos de datos solo para recursos sensibles (buckets con datos personales, funciones críticas)'],
    whenNot: ['Eventos de datos de todos los buckets "por si acaso": el coste escala con las peticiones'],
    pricing: 'El primer trail de eventos de gestión es gratuito; los trails adicionales, los eventos de datos (por cada 100 000) y el almacenamiento en S3 se pagan.',
    scenario: 'ops-trail',
    examples: [
      [`echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},"Action":"s3:GetBucketAcl","Resource":"arn:aws:s3:::auditoria-logs"},{"Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},"Action":"s3:PutObject","Resource":"arn:aws:s3:::auditoria-logs/AWSLogs/123456789012/*","Condition":{"StringEquals":{"s3:x-amz-acl":"bucket-owner-full-control"}}}]}' > politica.json`, 'La política del bucket'],
      ['aws s3api put-bucket-policy --bucket auditoria-logs --policy file://politica.json', 'Se aplica'],
      ['aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs --is-multi-region-trail --enable-log-file-validation', 'El trail (todavía no registra)'],
      ['aws cloudtrail start-logging --name auditoria', 'Ahora sí'],
      ['aws cloudtrail get-trail-status --name auditoria --query IsLogging', 'Comprobado'],
      [`aws cloudtrail put-event-selectors --trail-name auditoria --event-selectors '[{"ReadWriteType":"All","IncludeManagementEvents":true,"DataResources":[{"Type":"AWS::S3::Object","Values":["arn:aws:s3:::auditoria-logs/"]}]}]' --query EventSelectors[0].DataResources[0].Type --output text`, 'Eventos de datos del propio bucket'],
    ],
    seeAlso: ['AWS CloudTrail', 'CloudTrail frente a Config frente a CloudWatch'],
  },
  {
    name: 'AWS Config',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Guarda la configuración de tus recursos y su historial de cambios, y la evalúa con reglas: ¿cómo estaba este grupo de seguridad ayer? ¿cumplen todos los buckets el cifrado?',
    details: `
Piezas:

- **Grabador** (*configuration recorder*): qué tipos de recursos se anotan y con qué rol.
- **Canal de entrega** (*delivery channel*): bucket de S3 (y opcionalmente SNS) donde se vuelcan instantáneas e historial.
- **Elementos de configuración**: una "foto" de un recurso en un momento (\`get-resource-config-history\`).
- **Reglas** (*config rules*): administradas (cientos, por identificador) o personalizadas (Lambda / Guard). Dan \`COMPLIANT\` / \`NON_COMPLIANT\` por recurso.
- **Remediación**: documento de Systems Manager Automation, manual o automática.
- **Paquetes de conformidad** y **agregadores** para varias cuentas y regiones.

Cada cambio de cumplimiento genera un evento de EventBridge (\`Config Rules Compliance Change\`).

Config **no impide** nada: informa y, si lo pides, corrige después. Y se paga por elemento de configuración grabado y por evaluación de regla: graba solo los tipos que te interesen en entornos grandes.
`,
    whenUse: ['Auditorías y cumplimiento continuo (cifrado, MFA, puertos abiertos, etiquetas obligatorias)', 'Investigar cómo ha cambiado un recurso en el tiempo', 'Remediar desviaciones automáticamente'],
    whenNot: ['Para saber quién hizo el cambio: CloudTrail', 'Para impedir configuraciones inseguras: SCP, políticas de IAM, Service Control'],
    pricing: 'Por elemento de configuración grabado y por evaluación de regla, más el almacenamiento de S3 y las ejecuciones de la remediación.',
    scenario: 'ops-config',
    examples: [
      ['ROLE=$(aws iam get-role --role-name config-rol --query Role.Arn --output text)', 'El rol que asume Config'],
      ['aws configservice put-configuration-recorder --configuration-recorder name=default,roleARN=$ROLE --recording-group allSupported=true', 'El grabador'],
      ['aws configservice put-delivery-channel --delivery-channel name=default,s3BucketName=config-logs', 'El canal de entrega'],
      ['aws configservice start-configuration-recorder --configuration-recorder-name default', 'A grabar'],
      ['aws configservice list-discovered-resources --resource-type AWS::EC2::SecurityGroup --query "resourceIdentifiers[].resourceName" --output text', 'Lo descubierto'],
    ],
    seeAlso: ['Reglas de Config y remediación', 'AWS CloudTrail', 'CloudTrail frente a Config frente a CloudWatch'],
  },
  {
    name: 'Reglas de Config y remediación',
    kind: 'concepto',
    category: 'operaciones',
    level: 3,
    summary: 'Las reglas de Config evalúan cada recurso (COMPLIANT / NON_COMPLIANT) y la remediación corrige los incumplimientos ejecutando un documento de Automation con un rol.',
    details: `
**Reglas administradas** más habituales: \`INCOMING_SSH_DISABLED\`, \`RESTRICTED_INCOMING_TRAFFIC\`, \`S3_BUCKET_PUBLIC_READ_PROHIBITED\`, \`S3_BUCKET_VERSIONING_ENABLED\`, \`ENCRYPTED_VOLUMES\`, \`IAM_USER_MFA_ENABLED\`, \`ACCESS_KEYS_ROTATED\`, \`REQUIRED_TAGS\`, \`RDS_MULTI_AZ_SUPPORT\`.

\`\`\`
aws configservice put-config-rule --config-rule '{"ConfigRuleName":"ssh-cerrado",
  "Source":{"Owner":"AWS","SourceIdentifier":"INCOMING_SSH_DISABLED"}}'
\`\`\`

**Consultar**: \`describe-compliance-by-config-rule\` (resumen), \`get-compliance-details-by-config-rule\` (qué recursos y por qué, con la anotación).

**Remediación** (\`put-remediation-configurations\`): \`TargetType: SSM_DOCUMENT\`, \`TargetId\` (por ejemplo \`AWS-DisablePublicAccessForSecurityGroup\`), parámetros (\`RESOURCE_ID\` = el recurso que incumple, y \`AutomationAssumeRole\`) y \`Automatic: true|false\`. Con \`Automatic\`, Config reintenta un número limitado de veces; sin él, la lanzas con \`start-remediation-execution\`.

Ten en cuenta:
- El **rol de automatización** necesita permisos sobre el recurso que va a cambiar.
- Remediar automáticamente algo que puede ser intencionado (un bucket público de una web) rompe cosas: empieza en modo manual y automatiza lo que no tiene excepciones.
`,
    whenUse: ['Cerrar puertos abiertos al mundo, activar el versionado o el cifrado, etiquetar', 'Convertir las normas de seguridad en comprobaciones continuas'],
    whenNot: ['Cuando el incumplimiento puede ser intencionado y la corrección automática cortaría un servicio'],
    pricing: 'Por evaluación de regla y por ejecución de la automatización; la remediación en sí no cuesta más que sus pasos.',
    scenario: 'ops-config',
    examples: [
      ['ROLE=$(aws iam get-role --role-name config-rol --query Role.Arn --output text)', 'El rol de Config (ya existe)'],
      ['aws configservice put-configuration-recorder --configuration-recorder name=default,roleARN=$ROLE --recording-group allSupported=true', 'Hace falta el grabador…'],
      ['aws configservice put-delivery-channel --delivery-channel name=default,s3BucketName=config-logs', '…el canal de entrega…'],
      ['aws configservice start-configuration-recorder --configuration-recorder-name default', '…y que esté grabando'],
      [`aws configservice put-config-rule --config-rule '{"ConfigRuleName":"ssh-cerrado","Source":{"Owner":"AWS","SourceIdentifier":"INCOMING_SSH_DISABLED"}}'`, 'La regla administrada'],
      ['aws configservice describe-compliance-by-config-rule --config-rule-names ssh-cerrado --query "ComplianceByConfigRules[0].Compliance.ComplianceType" --output text', 'El grupo web-sg tiene el 22 abierto: NON_COMPLIANT'],
      ['aws configservice get-compliance-details-by-config-rule --config-rule-name ssh-cerrado --compliance-types NON_COMPLIANT --query "EvaluationResults[].Annotation" --output text', 'Por qué incumple'],
      [`aws configservice put-config-rule --config-rule '{"ConfigRuleName":"x","Source":{"Owner":"AWS","SourceIdentifier":"NO_EXISTE"}}'`, 'Un identificador de regla administrada que no existe', 'error'],
    ],
    seeAlso: ['AWS Config', 'Automation y ventanas de mantenimiento'],
  },
  {
    name: 'CloudTrail frente a Config frente a CloudWatch',
    kind: 'comparativa',
    category: 'operaciones',
    level: 1,
    summary: 'Tres servicios de operaciones que se confunden: CloudTrail dice quién hizo qué, Config cómo estaba y si cumple, CloudWatch cómo va ahora.',
    details: `
| Pregunta | Servicio | Ejemplo |
| --- | --- | --- |
| ¿Quién lo hizo? ¿Cuándo? ¿Desde dónde? | **CloudTrail** | «\`carlos\` abrió el 22 a las 14:07 desde 203.0.113.9» |
| ¿Cómo estaba? ¿Cumple las reglas? | **Config** | «El 22 estaba cerrado el lunes; hoy el grupo incumple \`INCOMING_SSH_DISABLED\`» |
| ¿Cómo va ahora? ¿Hay un problema? | **CloudWatch** | «La latencia p95 de checkout es 2,3 s; alarma en ALARM» |

Una investigación típica los usa en cadena: CloudWatch **detecta** (la alarma salta), los registros y X-Ray **localizan**, CloudTrail **atribuye** (quién cambió qué justo antes) y Config **compara** (cómo estaba antes del cambio) y **previene** la repetición (regla + remediación).

Y no confundir con **AWS Trusted Advisor** (recomendaciones de coste, seguridad y límites) ni con **GuardDuty** (detección de amenazas con inteligencia de seguridad, zona siguiente).
`,
    whenUse: ['Para elegir la herramienta correcta en una pregunta de examen o en un incidente'],
    versus: [
      ['CloudTrail', 'Llamadas a la API (quién, qué, cuándo).'],
      ['AWS Config', 'Estado de recursos en el tiempo y cumplimiento.'],
      ['CloudWatch', 'Rendimiento y salud: métricas, registros, alarmas.'],
    ],
    scenario: 'ops-auditoria',
    examples: [
      ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress --max-results 2 --query "Events[].Username" --output text', 'CloudTrail: quién'],
      ['aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].IpPermissions[].FromPort" --output text', 'Estado actual: qué puertos están abiertos'],
      ['aws cloudwatch describe-alarms --query "length(MetricAlarms)"', 'CloudWatch: ¿hay alarmas vigilándolo? (no)'],
    ],
    seeAlso: ['AWS CloudTrail', 'AWS Config', 'Amazon CloudWatch'],
  },
];
