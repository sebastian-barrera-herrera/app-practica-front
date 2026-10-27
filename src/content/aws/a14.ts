import { A, all, awsAfter, awsHas, awsIs, awsMatches, awsWorld, demo, illus, learn, lesson, match, mc, multi, order, practice, predict, tf } from './awsbuild';

const QUEUE = 'https://sqs.us-east-1.amazonaws.com/123456789012/guardia';
/** Mensajes que han llegado a la cola `guardia` (la que recibe lo que publica el tema `alertas`). */
const AVISOS = `sqs get-queue-attributes --queue-url ${QUEUE} --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages`;
const HAY_AVISO = '^"?[1-9]';
const TOPIC = 'TOPIC=$(aws sns list-topics --query "Topics[0].TopicArn" --output text)';
const ACCT = '123456789012';
const RANGO = (desde: string) => `--start-time $(date -u -d "${desde}" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ)`;
const ALARMA_ERRORES = '--statistic Sum --period 60 --evaluation-periods 1 --threshold 3 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching';
const LOGS_5XX = `_check log --group /tienda/api --message '{"level":"ERROR","route":"/api/pedidos","status":503,"latency":30}' --count 5`;
const POLITICA_TRAIL = `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},"Action":"s3:GetBucketAcl","Resource":"arn:aws:s3:::auditoria-logs"},{"Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},"Action":"s3:PutObject","Resource":"arn:aws:s3:::auditoria-logs/AWSLogs/${ACCT}/*","Condition":{"StringEquals":{"s3:x-amz-acl":"bucket-owner-full-control"}}}]}' > politica.json`;
const REMEDIACION = JSON.stringify(
  [
    {
      ConfigRuleName: 'ssh-cerrado',
      TargetType: 'SSM_DOCUMENT',
      TargetId: 'AWS-DisablePublicAccessForSecurityGroup',
      Parameters: { GroupId: { ResourceValue: { Value: 'RESOURCE_ID' } }, AutomationAssumeRole: { StaticValue: { Values: ['ARN_DEL_ROL'] } } },
      Automatic: true,
      MaximumAutomaticAttempts: 3,
      RetryAttemptSeconds: 60,
    },
  ],
  null,
  2,
);
const RULE = (name: string, id: string) => `aws configservice put-config-rule --config-rule '{"ConfigRuleName":"${name}","Source":{"Owner":"AWS","SourceIdentifier":"${id}"}}'`;
const ABRE_22 = `_check act --user carlos --service ec2 --op authorize-security-group-ingress --params '{"GroupId":"sg:web-sg","IpPermissions":[{"IpProtocol":"tcp","FromPort":22,"ToPort":22,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]}'`;
const PUERTOS_WEB = 'ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].IpPermissions[].FromPort"';
const INVOCA = (f: string) => `aws lambda invoke --function-name ${f} --cli-binary-format raw-in-base64-out --payload '{"id":"P-1"}' salida.json`;
const GRAFO = 'aws xray get-service-graph --start-time $(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ) --query "Services[].[Name,Type,SummaryStatistics.TotalCount,SummaryStatistics.TotalResponseTime]" --output text';
const TARGETS_REINICIO = String.raw`cat > targets.json <<EOF
[{"Id":"reinicio","Arn":"arn:aws:ssm:us-east-1:123456789012:automation-definition/AWS-RestartEC2Instance:\$DEFAULT","RoleArn":"arn:aws:iam::123456789012:role/eventos-rol","Input":"{\"InstanceId\":[\"$ID\"],\"AutomationAssumeRole\":[\"arn:aws:iam::123456789012:role/auto-rol\"]}"}]
EOF`;

export const a14 = awsWorld({
  id: 'a14',
  index: 14,
  title: 'Observabilidad y operaciones',
  subtitle: 'CloudWatch, Logs, CloudTrail, Config, Systems Manager y X-Ray',
  emoji: '🔭',
  color: '#F59E0B',
  level: 'intermedio',
  intro:
    'Poner una aplicación en producción es el principio: luego hay que **saber qué le pasa, quién cambia qué y reaccionar a tiempo**. En esta zona aprendes las tres señales de la observabilidad —**métricas, registros y trazas**— con **CloudWatch** (métricas propias, alarmas simples y compuestas, Logs e Insights) y **X-Ray**; la auditoría con **CloudTrail** («¿quién lo hizo?») y **Config** («¿cómo estaba y cumple las reglas?»); y la operación diaria con **Systems Manager** (Parameter Store, Run Command, parches, automatizaciones). Terminas cerrando el círculo: de la alarma a la **respuesta automática** con EventBridge. Todo corre en tu cuenta simulada, con alarmas que de verdad cambian de estado, registros que se pueden consultar con Insights y un historial de CloudTrail que investigar.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a14-1', { title: 'CloudWatch: métricas y alarmas', summary: 'Medir tu aplicación, avisar cuando algo va mal y depurar una alarma que no avisa', emoji: '📈', commands: ['Amazon CloudWatch', 'Métricas y dimensiones', 'Alarmas de CloudWatch', 'Alarmas compuestas', 'Paneles de CloudWatch'], minutes: 36 }, [
      learn(
        'Lo que no se mide, no se arregla',
        `
Una aplicación en producción se observa con **tres señales**:

| Señal | Responde a… | En AWS |
| --- | --- | --- |
| **Métricas** | «¿Cuánto? ¿Cómo va?» (números en el tiempo) | CloudWatch Metrics |
| **Registros** | «¿Qué ha pasado exactamente?» (líneas de texto) | CloudWatch Logs |
| **Trazas** | «¿Por dónde ha ido esta petición y dónde tardó?» | X-Ray |

Una **métrica** de CloudWatch es una serie de números con tres piezas de identidad:

- el **espacio de nombres** (\`AWS/EC2\`, \`AWS/Lambda\`… o el tuyo: \`Tienda\`; el prefijo \`AWS/\` está reservado),
- el **nombre** (\`CPUUtilization\`, \`PedidosFallidos\`),
- las **dimensiones**: pares nombre=valor que la distinguen (\`InstanceId=i-0abc\`, \`Servicio=checkout\`).

⚠️ **Cada combinación de dimensiones es una métrica distinta.** \`LatenciaMs\` con \`Servicio=checkout\` y \`LatenciaMs\` sin dimensiones **no son la misma**: si consultas (o alarmas) con las dimensiones equivocadas, no verás datos.

Para leer una métrica eliges un **periodo** (60 s, 300 s…) y una **estadística** (\`Average\`, \`Sum\`, \`Maximum\`, \`SampleCount\`, percentiles como \`p95\`). Los servicios de AWS publican sus métricas solos; las tuyas las envías con \`put-metric-data\`. Los datos de 1 minuto se conservan 15 días, los de 5 minutos 63 y los de 1 hora 15 meses.
`,
        '📈',
      ),
      illus('aws-alarm-eval', 'Cómo decide una alarma', 'Cambia el umbral, el periodo, los datapoints necesarios y qué hacer con los datos que faltan: mira cuándo pasa a ALARM, OK o INSUFFICIENT_DATA.'),
      mc('Publicas `LatenciaMs` con la dimensión `Servicio=checkout`. Creas una alarma sobre `LatenciaMs` **sin indicar dimensiones**. ¿Qué pasa?', ['La alarma usa los datos de todos los servicios', 'La alarma se queda en INSUFFICIENT_DATA: busca una métrica sin dimensiones, que no existe', 'CloudWatch rechaza la alarma por estar incompleta', 'La alarma coge la primera dimensión que encuentra'], 1, 'Las dimensiones forman parte de la identidad de la métrica. Sin ellas buscas otra métrica distinta (que no recibe datos), así que la alarma nunca sale de INSUFFICIENT_DATA. Con `list-metrics` ves qué dimensiones existen de verdad.'),
      demo(
        'Publica una métrica propia y léela',
        [
          ['aws cloudwatch put-metric-data --namespace Tienda --metric-name Pedidos --value 3 --unit Count', 'Tu aplicación envía un dato (la CLI no devuelve nada si todo va bien)'],
          ['aws cloudwatch put-metric-data --namespace Tienda --metric-name Pedidos --value 5 --dimensions Servicio=checkout --unit Count', 'Mismo nombre, con una dimensión: es **otra métrica**'],
          ['aws cloudwatch list-metrics --namespace Tienda', 'Las dos series, con sus dimensiones'],
          [`aws cloudwatch get-metric-statistics --namespace Tienda --metric-name Pedidos --dimensions Name=Servicio,Value=checkout ${RANGO('10 minutes ago')} --period 60 --statistics Sum`, 'Solo la serie de `checkout`: la suma del último minuto'],
          ['aws cloudwatch put-metric-data --namespace AWS/Tienda --metric-name X --value 1', 'El prefijo `AWS/` está reservado para los servicios de AWS', 'error'],
        ],
        A('ops-metricas'),
        'En producción no se mandan datos uno a uno desde la CLI: la aplicación usa el SDK (`boto3`) o el agente de CloudWatch. Aquí sirve para ver cómo se comporta el servicio.',
      ),
      predict('Hay datos de latencia de dos servicios (`checkout` y `catalogo`) con el mismo nombre de métrica. ¿Cuántas métricas lista `list-metrics`?', 'aws cloudwatch list-metrics --namespace Tienda --query "length(Metrics)"', ['1', '40', '0'], 'Una métrica por cada combinación de dimensiones: `LatenciaMs` con `Servicio=checkout` y `LatenciaMs` con `Servicio=catalogo` son dos métricas (cada una con sus 20 datos).', A('ops-alarma-muda')),
      practice({
        prompt: 'La tienda publica en el espacio de nombres **`Tienda`** la métrica **`PedidosFallidos`** (cuántos pedidos fallan en cada intento de cobro). Quieres que, si en **un minuto** fallan **más de 5** (suma), se avise al tema SNS **`alertas`** (hay una cola `guardia` suscrita, que es lo que recibe el aviso). Si no llegan datos, no debe contarse como fallo (`notBreaching`). Llama a la alarma **`pedidos-fallidos`**.',
        goal: 'La alarma pedidos-fallidos avisa a alertas cuando fallan más de 5 pedidos en un minuto',
        setup: A('ops-metricas'),
        check: all(
          awsIs('cloudwatch describe-alarms --alarm-names pedidos-fallidos --query "MetricAlarms[0].[Namespace,MetricName,Statistic,Period,EvaluationPeriods,Threshold,ComparisonOperator,TreatMissingData]"', ['Tienda', 'PedidosFallidos', 'Sum', 60, 1, 5, 'GreaterThanThreshold', 'notBreaching'], 'Falta la alarma pedidos-fallidos con esos ajustes (métrica, suma, periodo de 60 s, umbral 5, notBreaching)'),
          awsMatches(AVISOS, HAY_AVISO, 'La alarma no avisa: cuando fallan muchos pedidos, no llega ningún mensaje a la cola de guardia (¿le has puesto la acción de alarma con el tema alertas?)'),
          awsAfter(['_check metric --namespace Tienda --name PedidosFallidos --value 20'], awsMatches(AVISOS, HAY_AVISO, 'Con 20 pedidos fallidos en un minuto la alarma debería avisar al tema alertas')),
        ),
        solution: [TOPIC, 'aws cloudwatch put-metric-alarm --alarm-name pedidos-fallidos --namespace Tienda --metric-name PedidosFallidos --statistic Sum --period 60 --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC', 'aws cloudwatch put-metric-data --namespace Tienda --metric-name PedidosFallidos --value 20 --unit Count', 'aws cloudwatch describe-alarms --alarm-names pedidos-fallidos --query "MetricAlarms[0].StateValue"'],
        hints: ['El ARN del tema lo da `aws sns list-topics`. La alarma se crea con `aws cloudwatch put-metric-alarm`: `--namespace`, `--metric-name`, `--statistic`, `--period`, `--evaluation-periods`, `--threshold` y `--comparison-operator`.', 'Más de 5 = `GreaterThanThreshold` con umbral 5. «Suma en un minuto» = `--statistic Sum --period 60 --evaluation-periods 1`. Los datos que faltan: `--treat-missing-data notBreaching`.', 'El aviso se pide con `--alarm-actions <ARN del tema>`. Para probarla, publica un dato alto con `aws cloudwatch put-metric-data --namespace Tienda --metric-name PedidosFallidos --value 20` y mira el estado con `describe-alarms`.'],
        explain: 'Una alarma son cuatro decisiones: **qué métrica** (con sus dimensiones), **cómo agregarla** (estadística y periodo), **cuándo es grave** (umbral, operador y cuántos periodos) y **qué hacer** (acciones). `notBreaching` evita falsas alarmas cuando el servicio simplemente no envía datos. La acción de alarma publica en el tema SNS, que reparte el mensaje a sus suscriptores (aquí, la cola de guardia).',
        par: 5,
        commands: ['Alarmas de CloudWatch', 'Amazon CloudWatch', 'Métricas y dimensiones'],
      }),
      learn(
        'Alarmas: estados, periodos y datos que faltan',
        `
Una alarma está siempre en uno de **tres estados**:

- **OK**: la métrica está dentro del umbral.
- **ALARM**: se ha cruzado el umbral.
- **INSUFFICIENT_DATA**: faltan datos para decidir (acaba de crearse o la métrica no llega).

**Cuánto aguanta antes de saltar:** \`--evaluation-periods N\` mira los últimos *N* periodos, y \`--datapoints-to-alarm M\` pide que *M de esos N* incumplan (el «M de N» evita saltar por un pico suelto).

**Datos que faltan** (\`--treat-missing-data\`): \`missing\` (por defecto: la alarma se queda como estaba o pasa a INSUFFICIENT_DATA), \`notBreaching\` (cuenta como bueno; ideal para métricas que solo existen cuando hay problemas), \`breaching\` (cuenta como malo; ideal para «¡si deja de latir, avisa!») e \`ignore\`.

**Acciones**: al cambiar de estado una alarma puede avisar a un tema **SNS**, escalar un grupo de Auto Scaling, reiniciar/recuperar/parar una instancia EC2 o abrir un caso en Systems Manager. Se pueden poner distintas acciones para \`ALARM\`, \`OK\` e \`INSUFFICIENT_DATA\`, y desactivarlas todas con \`disable-alarm-actions\`.

**Alarmas compuestas**: combinan otras alarmas con \`AND\`, \`OR\` y \`NOT\` (\`ALARM("latencia-alta") AND ALARM("errores-altos")\`). Sirven para **reducir ruido**: se avisa de «el servicio está degradado» una sola vez, en lugar de una alerta por cada síntoma.

Para entender qué ha hecho una alarma: \`describe-alarms\` (estado y motivo) y \`describe-alarm-history\` (cada cambio **y cada acción**, con su éxito o su error).
`,
        '🚦',
      ),
      tf('«Una alarma en estado ALARM siempre ha enviado una notificación.»', false, 'No: puede tener las acciones desactivadas, no tener ninguna configurada o apuntar a un tema que no existe (el fallo queda en el historial, no en la alarma). Por eso se prueban las alarmas y se mira `describe-alarm-history`.'),
      practice({
        prompt: 'Hay dos alarmas que avisan cada una por su cuenta al tema **`alertas`**: **`latencia-alta`** y **`errores-altos`**. A las tres de la mañana suenan las dos a la vez y el equipo recibe dos mensajes por el mismo problema. Quieres **un único aviso cuando las dos estén en ALARM a la vez**: crea una alarma compuesta **`tienda-degradada`** (`ALARM("latencia-alta") AND ALARM("errores-altos")`) que avise al tema `alertas`, y **quita el aviso de las dos alarmas originales** (que sigan existiendo, pero en silencio).',
        goal: 'Un único aviso (compuesta) cuando latencia y errores están en ALARM a la vez; las dos simples ya no avisan solas',
        setup: A('ops-compuesta'),
        check: all(
          awsIs('cloudwatch describe-alarms --alarm-types CompositeAlarm --query "CompositeAlarms[0].[AlarmName,AlarmRule]"', ['tienda-degradada', 'ALARM("latencia-alta") AND ALARM("errores-altos")'], 'Falta la alarma compuesta tienda-degradada con la regla ALARM("latencia-alta") AND ALARM("errores-altos")'),
          awsAfter(['_check metric --namespace Tienda --name LatenciaMs --value 2000'], awsIs(AVISOS, '0', 'Con solo la latencia alta no debe avisar nadie: las alarmas simples tienen que estar en silencio y la compuesta necesita las dos')),
          awsAfter(['_check metric --namespace Tienda --name LatenciaMs --value 2000', '_check metric --namespace Tienda --name Errores --value 50'], awsMatches(AVISOS, HAY_AVISO, 'Con latencia y errores altos a la vez la compuesta debería avisar al tema alertas')),
        ),
        solution: [TOPIC, `aws cloudwatch put-composite-alarm --alarm-name tienda-degradada --alarm-rule 'ALARM("latencia-alta") AND ALARM("errores-altos")' --alarm-actions $TOPIC`, 'aws cloudwatch disable-alarm-actions --alarm-names latencia-alta errores-altos', 'aws cloudwatch describe-alarms --alarm-types CompositeAlarm MetricAlarm --query "[CompositeAlarms[].AlarmName, MetricAlarms[].[AlarmName,ActionsEnabled]]"'],
        hints: ['La compuesta se crea con `aws cloudwatch put-composite-alarm --alarm-name … --alarm-rule \'…\' --alarm-actions …`. La regla usa `ALARM("nombre")`, `AND`, `OR`, `NOT`.', 'Para dejar en silencio las dos alarmas simples sin borrarlas: `aws cloudwatch disable-alarm-actions --alarm-names latencia-alta errores-altos`.', 'Sin silenciar las simples, cada una seguiría avisando sola (aunque la compuesta aguante); sin la compuesta, no habría ningún aviso conjunto.'],
        explain: 'La alarma compuesta no mira métricas: mira **el estado de otras alarmas**. Así «latencia alta» (un síntoma) y «errores altos» (otro síntoma) se combinan en «el servicio está degradado» (un diagnóstico). Se quitan las acciones de las alarmas hijas para que solo avise la compuesta; las hijas siguen evaluándose, porque la compuesta las necesita.',
        par: 4,
        commands: ['Alarmas compuestas', 'Alarmas de CloudWatch'],
      }),
      practice({
        prompt: 'La alarma **`latencia-checkout`** (latencia media del servicio `checkout` por encima de 800 ms en un minuto) **nunca avisa**, aunque la aplicación sí publica los datos. Averigua por qué —puede haber **más de un motivo**— y arréglala para que avise al tema **`alertas`**. Pistas del terreno: el estado de la alarma, `list-metrics` del espacio de nombres `Tienda` y el historial de la alarma.',
        goal: 'La alarma latencia-checkout lee la métrica correcta y avisa de verdad al tema alertas',
        setup: A('ops-alarma-muda'),
        check: all(
          awsIs('cloudwatch describe-alarms --alarm-names latencia-checkout --query "MetricAlarms[0].Dimensions"', [{ Name: 'Servicio', Value: 'checkout' }], 'La alarma no está leyendo la métrica del servicio checkout (¿qué dimensiones tiene la métrica?)'),
          awsAfter(['_check metric --namespace Tienda --name LatenciaMs --dimensions Servicio=checkout --value 3000'], awsMatches(AVISOS, HAY_AVISO, 'Con la latencia de checkout disparada, la alarma debería avisar al tema alertas (¿existe el tema al que apunta?)')),
        ),
        solution: ['aws cloudwatch describe-alarms --alarm-names latencia-checkout --query "MetricAlarms[0].[StateValue,StateReason,Dimensions,AlarmActions]"', 'aws cloudwatch list-metrics --namespace Tienda --metric-name LatenciaMs', TOPIC, 'aws cloudwatch put-metric-alarm --alarm-name latencia-checkout --namespace Tienda --metric-name LatenciaMs --dimensions Name=Servicio,Value=checkout --statistic Average --period 60 --evaluation-periods 1 --threshold 800 --comparison-operator GreaterThanThreshold --alarm-actions $TOPIC', 'aws cloudwatch put-metric-data --namespace Tienda --metric-name LatenciaMs --dimensions Servicio=checkout --value 3000', 'aws cloudwatch describe-alarm-history --alarm-name latencia-checkout --history-item-type Action --max-records 3'],
        hints: ['`describe-alarms` muestra el estado (`INSUFFICIENT_DATA`: no encuentra datos), las dimensiones de la alarma (ninguna) y las acciones. Compara con lo que lista `aws cloudwatch list-metrics --namespace Tienda`.', 'Motivo 1: la alarma no tiene la dimensión `Servicio=checkout` (la métrica con datos sí). Se corrige volviendo a ejecutar `put-metric-alarm` con `--dimensions Name=Servicio,Value=checkout`.', 'Motivo 2: la acción apunta a `alertas-prod`, un tema que no existe (lo verás en `describe-alarm-history --history-item-type Action` en cuanto la alarma salte). Usa el ARN real de `aws sns list-topics` en `--alarm-actions`.'],
        explain: 'Dos fallos independientes que producen el mismo síntoma («no avisa»): sin las **dimensiones** correctas la alarma busca una métrica que no existe (INSUFFICIENT_DATA para siempre), y con una **acción rota** la alarma salta pero el aviso no llega a nadie. El historial de acciones es el sitio donde se ve: «Failed to execute action … Topic does not exist». Moraleja: una alarma no está terminada hasta que la has visto avisar.',
        par: 6,
        commands: ['Métricas y dimensiones', 'Alarmas de CloudWatch', 'Paneles de CloudWatch'],
      }),
      order('Ordena lo que ocurre desde que la aplicación envía un dato hasta que alguien recibe el aviso', ['dato', 'periodo', 'umbral', 'estado', 'acción'], 'dato periodo umbral estado acción', 'La aplicación envía un **dato**; CloudWatch lo agrega por **periodo** con la estadística elegida; la alarma lo compara con el **umbral** durante los periodos indicados; si procede cambia de **estado**; y al cambiar de estado ejecuta su **acción** (publicar en SNS, escalar, reiniciar…).'),
      match(
        'Une cada estado o ajuste con lo que significa',
        [
          ['OK', 'La métrica está dentro del umbral'],
          ['ALARM', 'Se ha cruzado el umbral los periodos necesarios'],
          ['INSUFFICIENT_DATA', 'Faltan datos para decidir'],
          ['notBreaching', 'Los datos que faltan cuentan como buenos'],
        ],
        'Los tres estados son los únicos que existe; `--treat-missing-data` decide qué hacer cuando no llegan datos, y es la causa de muchas falsas alarmas (o de alarmas que no saltan).',
      ),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a14-2', { title: 'CloudWatch Logs e Insights', summary: 'Buscar en los registros, convertirlos en métricas y hacerles preguntas con Logs Insights', emoji: '📜', commands: ['Amazon CloudWatch Logs', 'aws logs filter-log-events', 'aws logs tail', 'Filtros de métricas', 'Logs Insights', 'Retención y coste de los registros'], minutes: 38 }, [
      learn(
        'Grupos, flujos y eventos',
        `
Los registros de AWS se organizan en tres niveles:

- **Grupo de registros** (\`/aws/lambda/pedidos\`, \`/tienda/api\`): lo que tienen en común varios flujos (misma **retención**, mismos permisos, mismos filtros). Suele haber uno por aplicación.
- **Flujo de registros**: una fuente concreta dentro del grupo (una instancia, un contenedor, una ejecución de Lambda).
- **Evento**: una línea con una marca de tiempo.

Quién escribe en ellos: Lambda (automáticamente), ECS/Fargate con el controlador \`awslogs\`, EC2 con el agente de CloudWatch, VPC Flow Logs, CloudTrail, API Gateway… y tu código con el SDK.

Tres cosas que conviene saber desde el primer día:

1. **Por defecto los registros no caducan** y se pagan por GB recibido y por GB guardado. Fija una **retención** (\`put-retention-policy\`: 14 o 30 días suele bastar; archiva a S3 lo que necesites más tiempo).
2. Escribe los registros en **JSON** (una línea = un objeto con \`level\`, \`route\`, \`status\`, \`latency\`…): se filtran y consultan mucho mejor que el texto libre.
3. **No registres secretos ni datos personales**: quedan guardados y los leen quienes tengan permiso sobre el grupo.

Para buscar tienes \`filter-log-events\` (con un **patrón de filtro**), \`tail\` (ver en directo, estilo \`tail -f\`) y **Logs Insights** (consultas).
`,
        '📜',
      ),
      illus('aws-log-filter', 'Patrones de filtro', 'Escribe o elige un patrón (texto, varios términos, exclusión o JSON) y mira qué líneas coinciden y cuántas veces contaría un filtro de métricas.'),
      demo(
        'Explora los registros de la API',
        [
          ['aws logs describe-log-groups --query "logGroups[].[logGroupName,retentionInDays,storedBytes]" --output text', 'El grupo de la tienda: sin retención (`None`)'],
          ['aws logs describe-log-streams --log-group-name /tienda/api --query "logStreams[].logStreamName" --output text', 'Dos flujos: `api-1` y `api-2`'],
          ['aws logs filter-log-events --log-group-name /tienda/api --filter-pattern ERROR --query "events[].message" --output text', 'Texto libre: las líneas que contienen `ERROR`'],
          ['aws logs filter-log-events --log-group-name /tienda/api --filter-pattern \'{ $.status = 500 }\' --query "length(events)"', 'Patrón **JSON**: `{ $.campo operador valor }` (aquí, tres respuestas 500)'],
          ['aws logs filter-log-events --log-group-name /tienda/api --filter-pattern \'{ $.latency > 2000 && $.route = "/api/informes" }\' --query "length(events)"', 'Se pueden combinar condiciones con `&&` y `||`'],
          ['aws logs tail /tienda/api --since 10m --filter-pattern ERROR', 'Como `tail -f`, pero de un grupo de CloudWatch (con `--follow` se queda esperando)'],
        ],
        A('ops-logs'),
        'Un patrón de filtro NO es una expresión regular: es su propio mini-lenguaje (términos entre comillas, `?A ?B` para «A o B», `-X` para excluir y las llaves para JSON).',
      ),
      mc('¿Qué patrón de filtro encuentra las líneas que contengan `ERROR` **o** `WARN`?', ['`ERROR|WARN`', '`?ERROR ?WARN`', '`ERROR WARN`', '`ERROR OR WARN`'], 1, 'Con varios términos sueltos (`ERROR WARN`) se piden TODOS a la vez; para «alguno de» se antepone `?` a cada término. La barra `|` y `OR` no existen en los patrones de filtro (eso es de las expresiones regulares).'),
      practice({
        prompt: 'En los registros de la API (**`/tienda/api`**) hay **un pedido** cuyo cobro fue rechazado (`PaymentDeclined`). Atención al cliente necesita su identificador. Encuéntralo con un patrón de filtro y guárdalo en un parámetro de Parameter Store llamado **`/incidencia/pedido`** (`aws ssm put-parameter --name /incidencia/pedido --value <id> --type String`).',
        goal: 'El identificador del pedido rechazado está en el parámetro /incidencia/pedido',
        setup: A('ops-logs'),
        check: awsIs('ssm get-parameter --name /incidencia/pedido --query Parameter.Value', 'P-4821', 'Todavía no está en /incidencia/pedido el id del pedido con PaymentDeclined'),
        solution: ['aws logs filter-log-events --log-group-name /tienda/api --filter-pattern PaymentDeclined --query "events[].message" --output text', 'aws ssm put-parameter --name /incidencia/pedido --value P-4821 --type String', 'aws ssm get-parameter --name /incidencia/pedido --query Parameter.Value'],
        hints: ['`aws logs filter-log-events --log-group-name /tienda/api --filter-pattern PaymentDeclined` devuelve solo las líneas que lo contienen. Añade `--query "events[].message"` para ver el texto.', 'Cada línea es un JSON con el campo `pedido`. Anota su valor (con la forma `P-1234`).', 'Guárdalo con `aws ssm put-parameter --name /incidencia/pedido --value <id> --type String`.'],
        explain: 'Con 400 líneas se podría leer a ojo; con millones no. El filtro de texto busca la palabra en cualquier parte de la línea. Si prefieres precisión, el patrón JSON `{ $.error = "PaymentDeclined" }` compara el campo exacto.',
        par: 3,
        commands: ['aws logs filter-log-events', 'Amazon CloudWatch Logs'],
      }),
      learn(
        'De registros a métricas y alarmas',
        `
Los registros cuentan lo que pasó; las **métricas** permiten **vigilarlo**. Un **filtro de métricas** convierte líneas que coinciden con un patrón en puntos de una métrica de CloudWatch:

\`\`\`
aws logs put-metric-filter --log-group-name /tienda/api \\
  --filter-name errores-5xx --filter-pattern '{ $.status >= 500 }' \\
  --metric-transformations metricName=Errores5xx,metricNamespace=Tienda,metricValue=1,defaultValue=0
\`\`\`

Cada línea que coincide suma \`metricValue\` (1 = «cuenta líneas»; también puede ser un campo: \`$.latency\`). Con \`defaultValue=0\` se publican ceros cuando no hay coincidencias, y la alarma no queda en INSUFFICIENT_DATA.

Reglas que sorprenden:

- El filtro **solo cuenta líneas nuevas**, desde que lo creas: no reprocesa el histórico.
- Se prueba antes con \`test-metric-filter\` sobre líneas de ejemplo.
- Es **un valor por línea**: para sacar la latencia media por ruta, usa Logs Insights.

La cadena completa de una vigilancia basada en registros es: **registro → filtro de métricas → métrica → alarma → aviso.**
`,
        '🔁',
      ),
      practice({
        prompt: 'Quieres enterarte cuando la API empiece a dar errores de servidor. En el grupo **`/tienda/api`**: crea un **filtro de métricas** que cuente las líneas con `status` de **500 o más** (métrica **`Errores5xx`** en el espacio de nombres **`Tienda`**, valor 1); una **alarma** que salte con **3 o más en un minuto** y avise al tema **`alertas`**; y fija la **retención del grupo en 14 días** (ahora no caducan nunca).',
        goal: 'Filtro de métricas, alarma con aviso y retención de 14 días en /tienda/api',
        setup: A('ops-logs'),
        check: all(
          awsIs('logs describe-log-groups --log-group-name-prefix /tienda/api --query "logGroups[0].retentionInDays"', 14, 'El grupo /tienda/api debería guardar los registros 14 días'),
          awsAfter([LOGS_5XX], awsMatches(AVISOS, HAY_AVISO, 'Cuando la API escribe errores 5xx, debería llegar un aviso (filtro de métricas → métrica → alarma con acción)')),
        ),
        solution: [`aws logs put-metric-filter --log-group-name /tienda/api --filter-name errores-5xx --filter-pattern '{ $.status >= 500 }' --metric-transformations metricName=Errores5xx,metricNamespace=Tienda,metricValue=1,defaultValue=0`, TOPIC, `aws cloudwatch put-metric-alarm --alarm-name errores-5xx --namespace Tienda --metric-name Errores5xx ${ALARMA_ERRORES} --alarm-actions $TOPIC`, 'aws logs put-retention-policy --log-group-name /tienda/api --retention-in-days 14', 'aws logs describe-metric-filters --log-group-name /tienda/api --query "metricFilters[].[filterName,filterPattern]"'],
        hints: ['El patrón JSON para «status de 500 o más» es `\'{ $.status >= 500 }\'` (entre comillas simples en la terminal). `--metric-transformations metricName=…,metricNamespace=…,metricValue=1`.', 'La alarma se pone sobre esa métrica: `Sum`, periodo 60, umbral 3, `GreaterThanOrEqualToThreshold`, `--alarm-actions` con el tema `alertas`.', 'La retención: `aws logs put-retention-policy --log-group-name /tienda/api --retention-in-days 14`.'],
        explain: 'Es la cadena de vigilancia más usada en AWS: el filtro **traduce registros a una métrica**, la alarma **vigila la métrica** y SNS **avisa**. La retención corta es la tercera pata: sin ella los registros se acumulan (y se pagan) para siempre.',
        par: 5,
        commands: ['Filtros de métricas', 'Retención y coste de los registros', 'Alarmas de CloudWatch'],
      }),
      learn(
        'Logs Insights: hacerle preguntas a los registros',
        `
**Logs Insights** es un lenguaje de consulta para analizar los registros de uno o varios grupos. Cada comando va separado por \`|\`:

\`\`\`
fields @timestamp, route, latency
| filter status >= 500
| stats count(*) as n, avg(latency) as media, pct(latency, 95) as p95 by route
| sort p95 desc
| limit 10
\`\`\`

- \`fields\` elige columnas; \`filter\` descarta líneas; \`parse\` extrae campos de texto libre (\`parse @message "user=* ip=*" as usuario, ip\`).
- \`stats\` agrega (\`count\`, \`sum\`, \`avg\`, \`min\`, \`max\`, \`pct\`) y puede agrupar con \`by\` (también \`by bin(5m)\` para series temporales).
- Los registros **JSON se descubren solos**: \`route\` y \`latency\` ya son campos. Los de Lambda traen \`@duration\`, \`@maxMemoryUsed\`…
- Las consultas son **asíncronas**: \`start-query\` devuelve un \`queryId\`, y con \`get-query-results\` se lee el resultado cuando el estado es \`Complete\`.
- Se cobran por **GB analizado**: acota siempre el rango de tiempo y los grupos.

⚠️ **Los promedios engañan.** Una ruta con 1 000 peticiones de 100 ms y una de 30 s tiene una media de 129 ms; el **percentil 95** (\`pct(latency, 95)\`) cuenta lo que vive la gente en los peores casos.
`,
        '🔍',
      ),
      demo(
        'Tu primera consulta de Insights',
        [
          ['Q=$(aws logs start-query --log-group-name /tienda/api --start-time $(date -u -d "4 hours ago" +%s) --end-time $(date -u +%s) --query-string \'stats count(*) as n by route | sort n desc\' --query queryId --output text)', 'La consulta arranca y devuelve su identificador'],
          ['aws logs get-query-results --query-id $Q --query "results[*][*].value" --output text', 'Resultado: cuántas peticiones por ruta'],
          ['aws logs describe-queries --log-group-name /tienda/api --query "queries[].[status,queryString]" --output text', 'El historial de consultas del grupo'],
        ],
        A('ops-logs'),
        'En la consola de AWS verías además un gráfico. Aquí lees el resultado en texto; el lenguaje es el mismo.',
      ),
      practice({
        prompt: 'Los clientes se quejan de que «la web va lenta», pero la latencia media parece normal. Con **Logs Insights** sobre **`/tienda/api`** averigua qué **ruta** tiene la **latencia más alta en el percentil 95** (usa `pct(latency, 95)` agrupado por `route`). Guarda su nombre (por ejemplo `/api/xxx`) en el parámetro **`/incidencia/ruta-lenta`**.',
        goal: 'La ruta con peor p95 está guardada en /incidencia/ruta-lenta',
        setup: A('ops-logs'),
        check: awsIs('ssm get-parameter --name /incidencia/ruta-lenta --query Parameter.Value', '/api/informes', 'Todavía no está en /incidencia/ruta-lenta la ruta con peor percentil 95'),
        solution: ['Q=$(aws logs start-query --log-group-name /tienda/api --start-time $(date -u -d "4 hours ago" +%s) --end-time $(date -u +%s) --query-string \'stats pct(latency, 95) as p95, avg(latency) as media, count(*) as n by route | sort p95 desc\' --query queryId --output text)', 'aws logs get-query-results --query-id $Q --query "results[0]"', 'aws ssm put-parameter --name /incidencia/ruta-lenta --value /api/informes --type String'],
        hints: ['Arranca la consulta con `aws logs start-query --log-group-name /tienda/api --start-time … --end-time … --query-string \'…\'` (tiempos en segundos: `$(date -u -d "4 hours ago" +%s)` y `$(date -u +%s)`).', 'La consulta: `stats pct(latency, 95) as p95 by route | sort p95 desc`. Lee el resultado con `aws logs get-query-results --query-id <id>`: la primera fila es la ruta más lenta.', 'Ojo: ordenar por el valor MÁXIMO de latencia te llevaría a otra ruta (hay un pico suelto en el catálogo); el percentil 95 ignora los picos aislados.'],
        explain: 'La media y el máximo mienten: la media la diluyen las rutas rápidas y el máximo lo marca un único pico. El **percentil 95** responde a «¿qué tan lento va para el 5 % más desafortunado?» y es la métrica de latencia que se suele vigilar en una alarma (`--extended-statistic p95`).',
        par: 5,
        commands: ['Logs Insights', 'Amazon CloudWatch Logs'],
      }),
      tf('«La mejor forma de vigilar la latencia de una API es alarmar sobre la media (`Average`).»', false, 'La media esconde los casos malos. Para latencia se alarma sobre percentiles (p95, p99) o sobre el máximo, según el objetivo de servicio.'),
      order('Ordena la cadena de vigilancia basada en registros', ['registro', 'filtro', 'métrica', 'alarma', 'aviso'], 'registro filtro métrica alarma aviso', 'La aplicación escribe un **registro**; un **filtro de métricas** convierte las líneas que coinciden en una **métrica**; una **alarma** vigila la métrica y, cuando salta, manda un **aviso** (SNS).'),
      match(
        'Une cada herramienta de registros con su uso',
        [
          ['filter-log-events', 'Buscar líneas con un patrón de filtro'],
          ['tail', 'Ver los registros según llegan'],
          ['Filtro de métricas', 'Convertir líneas en una métrica vigilable'],
          ['Logs Insights', 'Consultas con agregaciones y percentiles'],
        ],
        'Para encontrar un caso concreto, `filter-log-events`/`tail`; para vigilar, el filtro de métricas; para investigar patrones (qué ruta, qué hora), Insights.',
      ),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a14-3', { title: 'CloudTrail y Config: «¿quién cambió qué?»', summary: 'Investigar quién hizo una llamada, guardar la historia en un trail y vigilar el cumplimiento con reglas y remediación', emoji: '🕵️', commands: ['AWS CloudTrail', 'Trails y eventos de datos', 'AWS Config', 'Reglas de Config y remediación', 'CloudTrail frente a Config frente a CloudWatch'], minutes: 38 }, [
      learn(
        'Tres preguntas, tres servicios',
        `
Cuando algo falla o llega una auditoría, las preguntas se repiten:

| Pregunta | Servicio |
| --- | --- |
| **¿Quién** hizo esa llamada, **cuándo**, **desde dónde**? | **CloudTrail** |
| **¿Cómo estaba** ese recurso ayer y **cumple** nuestras reglas? | **AWS Config** |
| **¿Cómo va** ahora mismo (CPU, errores, latencia)? | **CloudWatch** |

**CloudTrail** anota cada llamada a la API de AWS (consola, CLI, SDK, otros servicios): quién (la identidad), qué (\`eventName\`: \`AuthorizeSecurityGroupIngress\`), sobre qué recurso, cuándo, desde qué IP y con qué agente (\`aws-cli\`, \`Boto3\`, \`console\`), si funcionó o falló (\`errorCode\`). Es el «cuaderno de bitácora» de la cuenta.

Sin configurar nada tienes el **historial de eventos**: los últimos **90 días** de eventos de **gestión** (crear, borrar, modificar), por región y gratis, consultable con \`lookup-events\`. No sirve para guardar más tiempo ni para analizar con otras herramientas: para eso están los **trails**.

Dos matices de lo que recoge:

- **Eventos de gestión** (creas un bucket, abres un puerto): siempre. **Eventos de datos** (leer un objeto de S3, invocar una función, leer un ítem de DynamoDB): solo si los activas, y se pagan.
- Los eventos de **lectura** (\`Describe*\`, \`List*\`, \`Get*\`) se registran, pero normalmente al investigar un cambio te interesan los de **escritura**.
`,
        '🕵️',
      ),
      illus('aws-audit-trail', 'Investiga con CloudTrail', 'Filtra los eventos por usuario o por nombre y resuelve el caso: ¿quién abrió el puerto 22 al mundo?'),
      demo(
        'Pregunta a CloudTrail',
        [
          ['aws cloudtrail lookup-events --max-results 5 --query "Events[].[EventTime,Username,EventName]" --output text', 'Los últimos eventos de la cuenta (lo más reciente, primero)'],
          ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=carlos --query "Events[].[EventTime,EventName]" --output text', 'Todo lo que ha hecho una persona'],
          ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress --query "Events[].[EventTime,Username]" --output text', 'Quién ha abierto puertos en grupos de seguridad'],
          ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress --max-results 1 --query "Events[0].CloudTrailEvent" --output text', 'El evento completo: identidad, IP de origen, agente y los parámetros de la llamada'],
          ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=DeleteSecurityGroup --query "Events[0].CloudTrailEvent" --output text', 'Los intentos fallidos también quedan: mira `errorCode`'],
        ],
        A('ops-auditoria'),
        'Cada `lookup-events` admite **un solo** atributo de búsqueda (usuario, nombre de evento, recurso…). Para cruzar condiciones se usa `--query` o, a gran escala, Athena sobre el trail en S3.',
      ),
      mc('Quieres saber quién borró un bucket de S3 el martes pasado. ¿Dónde miras primero?', ['CloudWatch Metrics', 'CloudTrail (historial de eventos)', 'AWS Config', 'Los registros de acceso del bucket borrado'], 1, 'Borrar un bucket es una llamada a la API (`DeleteBucket`): queda en CloudTrail, con el usuario y la IP. Config te diría cómo era el bucket antes; CloudWatch, nada de esto.'),
      practice({
        prompt: 'Un análisis de seguridad ha detectado que el grupo de seguridad **`web-sg`** tiene el **puerto 22 (SSH) abierto a todo internet**, y nadie lo reconoce. Averigua con **CloudTrail quién lo abrió**; después **cierra** esa regla (solo la del 22; el puerto 80 debe seguir abierto) y **etiqueta el grupo** con **`AbiertoPor`** = el nombre de esa persona.',
        goal: 'El 22 ya no está abierto y web-sg lleva la etiqueta AbiertoPor con la persona responsable',
        setup: A('ops-auditoria'),
        check: all(awsIs(PUERTOS_WEB, [80], 'El grupo web-sg solo debería tener el puerto 80 abierto'), awsIs('ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].Tags[?Key==\'AbiertoPor\'].Value | [0]"', 'carlos', 'Falta la etiqueta AbiertoPor con el nombre de quien abrió el puerto 22')),
        solution: ['aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress --query "Events[].[EventTime,Username]" --output text', 'SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text)', 'aws ec2 revoke-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 0.0.0.0/0', 'aws ec2 create-tags --resources $SG --tags Key=AbiertoPor,Value=carlos'],
        hints: ['`aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress` lista las aperturas de puertos con `Username` y hora. Hay dos: una para el 80 (la web) y otra para el 22 (mira los parámetros con `--query "Events[].CloudTrailEvent"`).', 'La apertura del 22 es la más reciente. Cierra solo esa regla con `aws ec2 revoke-security-group-ingress --group-id <id> --protocol tcp --port 22 --cidr 0.0.0.0/0`.', 'Etiqueta con `aws ec2 create-tags --resources <id del grupo> --tags Key=AbiertoPor,Value=<usuario>`.'],
        explain: 'CloudTrail convierte «alguien lo hizo» en un nombre, una hora y una IP. En el evento de apertura del 22 aparece el usuario `carlos` y la descripción que él mismo puso («solo un momento»). Cerrar la regla y **dejar anotado el responsable** (etiqueta) es la mitad de la investigación; la otra mitad, con él, es entender por qué lo hizo y ofrecer una alternativa (Session Manager) para que no vuelva a necesitar el 22.',
        par: 4,
        commands: ['AWS CloudTrail'],
      }),
      learn(
        'Trails: guardar la historia',
        `
El historial de 90 días no basta para una auditoría: hace falta un **trail**, que entrega los eventos a un **bucket de S3** (y, opcionalmente, a CloudWatch Logs y a EventBridge).

\`\`\`
aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs \\
  --is-multi-region-trail --enable-log-file-validation
aws cloudtrail start-logging --name auditoria
\`\`\`

Lo que importa:

- **El bucket necesita una política** que deje a \`cloudtrail.amazonaws.com\` leer la ACL (\`s3:GetBucketAcl\`) y escribir en \`AWSLogs/<cuenta>/\` (\`s3:PutObject\`, con la condición \`s3:x-amz-acl = bucket-owner-full-control\`). Sin ella, \`create-trail\` falla con \`InsufficientS3BucketPolicyException\`.
- **Multirregión**: un trail de una sola región se pierde lo que pase en las demás (justo donde un atacante crea sus recursos). Casi siempre quieres \`--is-multi-region-trail\`.
- **Eventos globales** (IAM, STS, CloudFront): se incluyen por defecto en el trail de la región de origen.
- **Validación de integridad** (\`--enable-log-file-validation\`): CloudTrail firma un resumen por hora para que \`validate-logs\` demuestre que nadie ha manipulado los archivos.
- **Un trail creado por CLI no registra hasta \`start-logging\`** (la consola sí lo arranca solo).
- Los **eventos de datos** (\`put-event-selectors\`) y los eventos de **Insights** (actividad anómala) se pagan aparte: actívalos solo donde los necesites (un bucket concreto, una función crítica).

Los archivos llegan a S3 en lotes, unos 5 minutos después. Para analizarlos a gran escala se usa **Athena** sobre el bucket o **CloudTrail Lake**.
`,
        '🗄️',
      ),
      practice({
        prompt: 'La empresa exige **conservar la actividad de la cuenta** más allá de los 90 días y poder demostrar que nadie manipula los registros. Hay un bucket vacío, **`auditoria-logs`**. Prepara el bucket para que CloudTrail pueda escribir en él, crea un trail **`auditoria`** que cubra **todas las regiones** y tenga **validación de archivos de registro**, y **empieza a registrar**.',
        goal: 'Trail auditoria multirregión, con validación de archivos y registrando',
        setup: A('ops-trail'),
        check: all(awsIs('cloudtrail describe-trails --trail-name-list auditoria --query "trailList[0].[S3BucketName,IsMultiRegionTrail,LogFileValidationEnabled]"', ['auditoria-logs', true, true], 'Falta el trail auditoria (bucket auditoria-logs, multirregión y con validación de archivos)'), awsIs('cloudtrail get-trail-status --name auditoria --query IsLogging', true, 'El trail existe pero no está registrando: falta arrancarlo')),
        solution: [POLITICA_TRAIL, 'aws s3api put-bucket-policy --bucket auditoria-logs --policy file://politica.json', 'aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs --is-multi-region-trail --enable-log-file-validation', 'aws cloudtrail start-logging --name auditoria', 'aws cloudtrail get-trail-status --name auditoria --query "[IsLogging,LatestDeliveryError]"'],
        hints: ['Si `create-trail` te dice `InsufficientS3BucketPolicyException`, al bucket le falta una política: dos permisos para la entidad de servicio `cloudtrail.amazonaws.com` (`s3:GetBucketAcl` sobre el bucket y `s3:PutObject` sobre `arn:aws:s3:::auditoria-logs/AWSLogs/123456789012/*`, con la condición `s3:x-amz-acl` = `bucket-owner-full-control`).', 'Guarda la política en un archivo y aplícala con `aws s3api put-bucket-policy --bucket auditoria-logs --policy file://politica.json`.', 'Después: `aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs --is-multi-region-trail --enable-log-file-validation` y `aws cloudtrail start-logging --name auditoria`.'],
        explain: 'Tres piezas: la **política del bucket** (CloudTrail es otro servicio que escribe en tu bucket, y necesita permiso expreso), el **trail multirregión con validación** (cubre todas las regiones y firma los resúmenes) y el **arranque** (`start-logging`). A partir de aquí la historia deja de caducar a los 90 días.',
        par: 5,
        commands: ['Trails y eventos de datos', 'AWS CloudTrail'],
      }),
      tf('«CloudTrail guarda por defecto quién ha leído cada objeto de tus buckets de S3.»', false, 'Leer o escribir objetos son eventos de DATOS: no se registran salvo que los actives con selectores de eventos (y se cobran). Por defecto solo hay eventos de gestión.'),
      learn(
        'AWS Config: la configuración de tus recursos, con memoria',
        `
**AWS Config** responde a «¿cómo estaba?» y «¿cumple?»:

1. Un **grabador** (\`configuration recorder\`) anota la configuración de los recursos y **cada cambio** (un grupo de seguridad que cambia sus reglas, un bucket que activa el versionado). Necesita un **rol** y un **canal de entrega** (bucket de S3) con política propia.
2. Las **reglas** (\`config rules\`) evalúan cada recurso: **COMPLIANT** o **NON_COMPLIANT**. Hay unas 400 administradas (\`INCOMING_SSH_DISABLED\`, \`S3_BUCKET_PUBLIC_READ_PROHIBITED\`, \`ENCRYPTED_VOLUMES\`, \`IAM_USER_MFA_ENABLED\`…) y puedes crear las tuyas con Lambda.
3. La **remediación** corrige lo que incumple, ejecutando un documento de **Systems Manager Automation** (por ejemplo, \`AWS-DisablePublicAccessForSecurityGroup\`): manual (tú la lanzas) o **automática**. Necesita un rol de automatización con permisos sobre el recurso.
4. Cada cambio de cumplimiento genera un evento de **EventBridge**: puedes avisar o reaccionar.

Con el historial puedes ver **un recurso en el tiempo** (\`get-resource-config-history\`) y con \`get-compliance-details-by-config-rule\` **qué recursos incumplen y por qué**.

**Config no impide nada** (no es un firewall): detecta y, si se lo pides, corrige después. Para impedir de antemano usas IAM, SCP o políticas de bucket.
`,
        '📋',
      ),
      practice({
        prompt: 'AWS Config está **apagado**. Actívalo con el rol **`config-rol`** y el bucket **`config-logs`** (ya preparados): grabador **`default`** (todos los tipos soportados), canal de entrega **`default`** y **empieza a grabar**. Crea dos reglas administradas: **`ssh-cerrado`** (`INCOMING_SSH_DISABLED`) y **`s3-sin-lectura-publica`** (`S3_BUCKET_PUBLIC_READ_PROHIBITED`). El SSH abierto se corrige **solo**: en `remediacion.json` tienes la remediación automática a medias (falta el ARN del rol **`remediacion`**, que ya existe). Y el bucket público **`datos-clientes`** lo corriges tú a mano.',
        goal: 'Config grabando, dos reglas, SSH cerrado automáticamente y datos-clientes sin lectura pública',
        setup: A('ops-config', { files: { '/home/alumno/remediacion.json': REMEDIACION + '\n' } }),
        check: all(
          awsIs('configservice describe-configuration-recorder-status --query "ConfigurationRecordersStatus[0].recording"', true, 'Falta activar el grabador de Config (recorder + canal de entrega + start)'),
          awsIs('configservice describe-compliance-by-config-rule --config-rule-names s3-sin-lectura-publica --query "ComplianceByConfigRules[0].Compliance.ComplianceType"', 'COMPLIANT', 'La regla s3-sin-lectura-publica debería dar COMPLIANT (¿sigue público el bucket datos-clientes?)'),
          awsAfter([ABRE_22], awsIs(PUERTOS_WEB, [80], 'La remediación automática debería cerrar el 22 de web-sg aunque alguien lo vuelva a abrir')),
        ),
        solution: [
          'ROLE=$(aws iam get-role --role-name config-rol --query Role.Arn --output text)',
          'aws configservice put-configuration-recorder --configuration-recorder name=default,roleARN=$ROLE --recording-group allSupported=true',
          'aws configservice put-delivery-channel --delivery-channel name=default,s3BucketName=config-logs',
          'aws configservice start-configuration-recorder --configuration-recorder-name default',
          RULE('ssh-cerrado', 'INCOMING_SSH_DISABLED'),
          RULE('s3-sin-lectura-publica', 'S3_BUCKET_PUBLIC_READ_PROHIBITED'),
          'AUTO=$(aws iam get-role --role-name remediacion --query Role.Arn --output text)',
          'sed -i "s|ARN_DEL_ROL|$AUTO|" remediacion.json',
          'aws configservice put-remediation-configurations --remediation-configurations file://remediacion.json',
          'aws s3api delete-bucket-policy --bucket datos-clientes',
          'aws configservice describe-compliance-by-config-rule --query "ComplianceByConfigRules[].[ConfigRuleName,Compliance.ComplianceType]" --output text',
        ],
        hints: [
          'Orden obligatorio: `put-configuration-recorder` (con `roleARN` de `config-rol`), `put-delivery-channel` (bucket `config-logs`) y `start-configuration-recorder`. Sin el canal de entrega, el grabador no arranca.',
          'Cada regla: `aws configservice put-config-rule --config-rule \'{"ConfigRuleName":"ssh-cerrado","Source":{"Owner":"AWS","SourceIdentifier":"INCOMING_SSH_DISABLED"}}\'`.',
          'En `remediacion.json` cambia `ARN_DEL_ROL` por el ARN de `remediacion` (`aws iam get-role --role-name remediacion`; por ejemplo con `sed -i`) y aplícalo con `aws configservice put-remediation-configurations --remediation-configurations file://remediacion.json`. El bucket público lo arregla `aws s3api delete-bucket-policy --bucket datos-clientes` (la política que lo abre al mundo).',
        ],
        explain: 'Has montado el ciclo completo de cumplimiento: **grabar** (recorder + canal), **evaluar** (reglas administradas), **corregir** (remediación automática con un documento de Automation y un rol) y **detectar** lo que no se puede corregir sin criterio (un bucket público lo arreglas tú, porque podría ser intencionado). La prueba final reabre el 22 «como si alguien lo hiciera»: la remediación lo vuelve a cerrar sola.',
        par: 8,
        commands: ['AWS Config', 'Reglas de Config y remediación'],
      }),
      multi('¿Cuáles de estas preguntas responde **AWS Config** (y no CloudTrail ni CloudWatch)? (elige todas las correctas)', ['¿Qué reglas tenía este grupo de seguridad hace dos semanas?', '¿Cuántas peticiones por segundo recibe mi API?', '¿Qué buckets de S3 no tienen cifrado por defecto?', '¿Qué dirección IP usó Ana para llamar a la API?'], [0, 2], 'Config guarda el **estado** de los recursos a lo largo del tiempo y evalúa su cumplimiento. Las peticiones por segundo son una métrica (CloudWatch) y la IP de quien llamó es un dato del evento de CloudTrail.'),
      order('Ordena lo que hay que preparar para activar AWS Config', ['rol', 'bucket', 'grabador', 'canal', 'reglas'], 'rol bucket grabador canal reglas', 'Necesitas un **rol** (que Config asume), un **bucket** con su política, el **grabador** (qué recursos y con qué rol), el **canal** de entrega (a qué bucket) y, por último, las **reglas** que evaluarán lo grabado. Después se arranca el grabador.', ['bucket rol grabador canal reglas']),
      match(
        'Une cada servicio con la pregunta que responde mejor',
        [
          ['CloudTrail', '¿Quién llamó a la API y cuándo?'],
          ['AWS Config', '¿Cómo estaba este recurso y cumple las reglas?'],
          ['CloudWatch', '¿Cómo va el sistema ahora (métricas, registros)?'],
          ['X-Ray', '¿Por dónde pasó esta petición y dónde tardó?'],
        ],
        'Cuatro herramientas complementarias: **auditar** (CloudTrail), **cumplir** (Config), **vigilar** (CloudWatch) y **diagnosticar** (X-Ray). Una investigación seria suele usar las cuatro.',
      ),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a14-4', { title: 'Systems Manager: operar sin SSH', summary: 'Ejecutar órdenes en la flota, guardar la configuración en Parameter Store y automatizar los parches', emoji: '🧰', commands: ['AWS Systems Manager', 'Parameter Store', 'Run Command', 'Patch Manager', 'Automation y ventanas de mantenimiento'], minutes: 40 }, [
      learn(
        'La sala de control de tus servidores',
        `
**AWS Systems Manager** (SSM) es el conjunto de herramientas para **operar** tus servidores (EC2, locales, otras nubes) sin abrir puertos ni repartir claves SSH:

| Herramienta | Para qué |
| --- | --- |
| **Run Command** | Ejecutar una orden o un documento en muchas máquinas a la vez |
| **Session Manager** | Un terminal en la instancia, sin SSH, con permisos de IAM y registro de la sesión |
| **Parameter Store** | Configuración y secretos jerárquicos (\`/tienda/prod/db-host\`) |
| **Patch Manager** | Aplicar parches según una línea base, por grupos y en ventanas |
| **Automation** | «Runbooks»: pasos automáticos (reiniciar, crear AMI, cerrar un puerto…) |
| **State Manager** | Mantener una configuración deseada (asociaciones) |
| **Maintenance Windows** | Cuándo se permite hacer cada tarea |
| **Inventory** | Qué software hay instalado en cada máquina |

Para que una instancia aparezca como **«nodo administrado»** necesita tres cosas, y si falla una no aparece:

1. el **agente de SSM** (viene instalado en Amazon Linux y Ubuntu recientes),
2. un **rol de instancia** con la política \`AmazonSSMManagedInstanceCore\`,
3. **salida de red** hasta los servicios de SSM (internet/NAT, o tres *endpoints* de VPC: \`ssm\`, \`ssmmessages\` y \`ec2messages\`).

Con Session Manager y Run Command ya **no hace falta el puerto 22 ni las claves**: cierras SSH y la autoría queda en CloudTrail.
`,
        '🧰',
      ),
      illus('aws-ssm-fleet', '¿Por qué mi instancia no aparece?', 'Quita el rol, el agente o la salida a internet y mira en qué estado queda cada instancia y qué te dice Systems Manager.'),
      demo(
        'Órdenes a toda la flota',
        [
          ['aws ssm describe-instance-information --query "InstanceInformationList[].[InstanceId,PingStatus,PlatformName]" --output text', 'Las tres instancias administradas (todas `Online`)'],
          ['C=$(aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Env,Values=prod --parameters commands="uptime" --query Command.CommandId --output text)', 'Una orden a todas las que tengan la etiqueta `Env=prod` (sin SSH)'],
          ['aws ssm list-command-invocations --command-id $C --query "CommandInvocations[].[InstanceId,Status]" --output text', 'Resultado por instancia'],
          ['I=$(aws ssm list-command-invocations --command-id $C --query "CommandInvocations[0].InstanceId" --output text)', 'Quedamos con una de ellas'],
          ['aws ssm get-command-invocation --command-id $C --instance-id $I --query "[Status,StandardOutputContent]" --output text', 'La salida de la orden en esa máquina'],
          ['aws ssm send-command --document-name AWS-RunShellScript --instance-ids i-00000000000000000 --parameters commands="uptime"', 'Una instancia que no existe (o no está administrada) no puede recibir órdenes', 'error'],
        ],
        A('ops-ssm-run'),
        'Los documentos de comandos (`AWS-RunShellScript`, `AWS-RunPatchBaseline`, `AWS-UpdateSSMAgent`…) son plantillas con parámetros. También puedes escribir los tuyos.',
      ),
      practice({
        prompt: 'Tres servidores de producción (**`web-1`**, **`web-2`**, **`web-3`**, todos con la etiqueta `Env=prod`) deberían servir la web con Apache (`httpd`), pero el balanceador se queja de que uno de ellos no responde. Sin abrir SSH: usa **Run Command** con `systemctl is-active httpd` en todos los servidores de producción a la vez, averigua **cuál no tiene el servicio activo** y márcalo con la etiqueta **`Estado`** = **`caida`**.',
        goal: 'La instancia sin servidor web lleva la etiqueta Estado=caida (y solo esa)',
        setup: A('ops-ssm-run'),
        check: all(
          awsIs('ec2 describe-instances --filters Name=tag:Estado,Values=caida --query "length(Reservations[].Instances[])"', 1, 'Solo una instancia debe llevar la etiqueta Estado=caida'),
          awsIs('ec2 describe-instances --filters Name=tag:Name,Values=web-3 Name=tag:Estado,Values=caida --query "length(Reservations[].Instances[])"', 1, 'La instancia que no sirve la web no es la que has marcado'),
        ),
        solution: ['C=$(aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Env,Values=prod --parameters commands="systemctl is-active httpd" --query Command.CommandId --output text)', 'aws ssm list-command-invocations --command-id $C --query "CommandInvocations[].[InstanceId,Status]" --output text', 'BAD=$(aws ssm list-command-invocations --command-id $C --query "CommandInvocations[?Status==\'Failed\'].InstanceId | [0]" --output text)', 'aws ec2 create-tags --resources $BAD --tags Key=Estado,Value=caida'],
        hints: ['`aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Env,Values=prod --parameters commands="systemctl is-active httpd"` lanza la orden a todas las instancias con esa etiqueta y devuelve un `CommandId`.', '`aws ssm list-command-invocations --command-id <id>` enseña el estado por instancia: `Success` si el servicio está activo y `Failed` si no (el código de salida de `is-active` es distinto de 0).', 'Etiqueta la instancia que falló: `aws ec2 create-tags --resources <id> --tags Key=Estado,Value=caida`.'],
        explain: 'Run Command te da el resultado **por instancia** (estado, salida estándar y de error) sin entrar en ninguna. `systemctl is-active` devuelve código 0 solo si el servicio está activo, así que `Failed` apunta a la máquina caída. La etiqueta `Estado=caida` es el paso siguiente típico: dejar marcado el problema para que lo vea el resto del equipo (o una automatización).',
        par: 4,
        commands: ['Run Command', 'AWS Systems Manager', 'Session Manager'],
      }),
      learn(
        'Parameter Store: la configuración fuera del código',
        `
**Parameter Store** guarda valores de configuración y secretos en una **jerarquía** con permisos de IAM por ruta:

\`\`\`
/tienda/prod/db-host        String        db-prod.interno
/tienda/prod/db-port        String        5432
/tienda/prod/db-password    SecureString  (cifrado con KMS)
/tienda/dev/db-host         String        localhost
\`\`\`

- Tipos: \`String\`, \`StringList\` y **\`SecureString\`** (cifrado con una clave de KMS; para leerlo hay que pedir \`--with-decryption\`).
- **Versiones** y etiquetas: cada \`--overwrite\` crea una versión nueva; \`label-parameter-version\` marca la «estable»; \`get-parameter-history\` las lista.
- **Tiers**: estándar (4 KB, gratis, hasta 10 000 parámetros) y avanzado (8 KB, con políticas de caducidad; se paga por parámetro).
- Se leen por nombre (\`get-parameter\`), varios a la vez (\`get-parameters\`) o **por ruta** (\`get-parameters-by-path --path /tienda/prod\`): una aplicación pide toda su configuración de un golpe.
- **Permisos por ruta**: la política del rol de tu aplicación limita \`ssm:GetParametersByPath\` a \`arn:aws:ssm:…:parameter/tienda/prod*\`. Así la función de producción no lee los parámetros de otros entornos.
- CloudFormation y las plantillas pueden leer parámetros con referencias dinámicas (\`{{resolve:ssm:/tienda/prod/db-host}}\`).

⚠️ Si necesitas **rotación automática** de contraseñas, usa **Secrets Manager** (lo verás en la siguiente zona); Parameter Store es más barato y sencillo, pero no rota nada por sí solo.
`,
        '🗝️',
      ),
      mc('Una función Lambda necesita la contraseña de la base de datos. ¿Dónde es mejor guardarla?', ['En una variable de entorno de la función, en texto', 'En el código de la función', 'En Parameter Store como SecureString, con un rol que solo lea esa ruta', 'En un archivo de texto en un bucket de S3 compartido'], 2, 'Un SecureString queda cifrado con KMS, se lee con permisos de IAM por ruta y se puede cambiar sin tocar el código. Una variable de entorno en texto o el código acaban en repositorios, capturas y registros.'),
      practice({
        prompt: 'La función **`pedidos`** lee su configuración con `get_parameters_by_path(Path=\'/tienda/prod\', WithDecryption=True)` y espera tres parámetros: **`db-host`** (`db-prod.interno`), **`db-port`** (`5432`) y **`db-password`** (cualquier contraseña, que debe ir **cifrada**). Crea los tres parámetros bajo **`/tienda/prod/`** y dale a su rol **`pedidos-rol`** permiso para leerlos (solo `ssm:GetParametersByPath` sobre esa ruta).',
        goal: 'La función pedidos obtiene su configuración de Parameter Store',
        setup: A('ops-ssm-params'),
        check: all(
          awsIs('ssm describe-parameters --parameter-filters Key=Name,Values=/tienda/prod/db-password --query "Parameters[0].Type"', 'SecureString', 'La contraseña db-password debe ser de tipo SecureString'),
          awsIs('_check invoke --function pedidos --query Payload.host', 'db-prod.interno', 'La función todavía no consigue su configuración (¿existen los tres parámetros? ¿puede su rol leerlos?)'),
        ),
        solution: ['aws ssm put-parameter --name /tienda/prod/db-host --value db-prod.interno --type String', 'aws ssm put-parameter --name /tienda/prod/db-port --value 5432 --type String', 'aws ssm put-parameter --name /tienda/prod/db-password --value "Secreta#2026" --type SecureString', 'echo \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"ssm:GetParametersByPath","Resource":"arn:aws:ssm:us-east-1:123456789012:parameter/tienda/prod*"}]}\' > ssm-lectura.json', 'aws iam put-role-policy --role-name pedidos-rol --policy-name leer-config --policy-document file://ssm-lectura.json', 'aws ssm get-parameters-by-path --path /tienda/prod --with-decryption --query "Parameters[].Name"'],
        hints: ['Cada parámetro: `aws ssm put-parameter --name /tienda/prod/db-host --value db-prod.interno --type String`. La contraseña lleva `--type SecureString`.', 'La función falla con un error de permisos (`AccessDeniedException`) hasta que su rol pueda leer la ruta. Ponle una política en línea: `aws iam put-role-policy --role-name pedidos-rol --policy-name leer-config --policy-document file://…`.', 'La política: `Allow` de `ssm:GetParametersByPath` sobre `arn:aws:ssm:us-east-1:123456789012:parameter/tienda/prod*` (el `*` final cubre la ruta y todo lo que cuelga de ella).'],
        explain: 'Dos cosas hacen falta, y fallan por separado: que **existan** los parámetros y que el **rol** de quien los lee tenga permiso **sobre esa ruta**. Fíjate en lo que no hiciste: no tocaste el código de la función; y el permiso se limita a `/tienda/prod`, así que esa función no podría leer `/tienda/dev` ni los parámetros de otros equipos. El `SecureString` se descifra al leer porque el rol puede usar la clave de KMS por defecto de SSM.',
        par: 6,
        commands: ['Parameter Store', 'AWS Systems Manager'],
      }),
      learn(
        'Parches y automatización',
        `
Parchear a mano treinta servidores es lento y se olvida. **Patch Manager** lo ordena en tres piezas:

1. **Línea base de parches** (\`create-patch-baseline\`): qué se aprueba y cuándo (p. ej. «seguridad crítica e importante, 3 días después de publicarse»). Hay una por defecto por sistema operativo. ⚠️ **Si no indicas \`--operating-system\`, será WINDOWS**: una base de Linux creada sin indicarlo no sirve para tus instancias.
2. **Grupo de parches**: una etiqueta de instancia llamada exactamente **\`Patch Group\`** (con el espacio) y el valor que elijas (\`web\`). La línea base se asocia a ese grupo con \`register-patch-baseline-for-patch-group\`.
3. **Cuándo y con qué**: el documento \`AWS-RunPatchBaseline\` con \`Operation=Scan\` (solo informar) o \`Install\` (aplicar y, si hace falta, reiniciar).

Para que ocurra **fuera de horas pico** y solo allí, se usa una **ventana de mantenimiento** (\`create-maintenance-window\`): un horario (\`cron(0 3 ? * SUN *)\` = domingos a las 3:00), una duración, un corte, unos **destinos** (por etiqueta) y una **tarea** (el documento de comandos).

Más cosas de la misma familia:

- **Automation**: documentos de varios pasos (\`AWS-RestartEC2Instance\`, \`AWS-CreateImage\`…) con un **rol de automatización** (\`AutomationAssumeRole\`) y, si quieres, un paso de aprobación manual (\`aws:approve\`).
- **State Manager**: una *asociación* repite un documento cada cierto tiempo para mantener una configuración (por ejemplo, que el agente esté actualizado).
- Los resultados de cumplimiento de parches se ven en \`describe-instance-patch-states\`.
`,
        '🩹',
      ),
      practice({
        prompt: 'Los servidores `web-1` y `web-2` (etiqueta `Env=prod`, Amazon Linux 2023) no se parchean nunca. Configura Patch Manager: una **línea base `seguridad-linux`** para **Amazon Linux 2023** que apruebe los parches de **seguridad crítica e importante** a los **3 días**; el **grupo de parches `web`** (etiqueta **`Patch Group`** = `web` en las dos instancias, y la línea base asociada a ese grupo); y una **ventana de mantenimiento `parches-domingo`** los domingos a las 3:00 (`cron(0 3 ? * SUN *)`, duración 3 h, corte 1 h) que, sobre las instancias del grupo `web`, ejecute `AWS-RunPatchBaseline` con `Operation=Install`.',
        goal: 'Línea base para Amazon Linux, grupo de parches web en las dos instancias y ventana semanal que instala parches',
        setup: A('ops-ssm-parches'),
        check: all(
          awsIs('ssm describe-patch-groups --query "Mappings[?PatchGroup==\'web\'].BaselineIdentity.[BaselineName,OperatingSystem] | [0]"', ['seguridad-linux', 'AMAZON_LINUX_2023'], 'El grupo de parches web debería usar la línea base seguridad-linux, creada para AMAZON_LINUX_2023 (¿has indicado el sistema operativo?)'),
          awsIs('ec2 describe-instances --filters "Name=tag:Patch Group,Values=web" --query "length(Reservations[].Instances[])"', 2, 'Las dos instancias deberían llevar la etiqueta Patch Group = web'),
          awsIs('_check windows --query "Windows[].[Name,Schedule,Duration,Cutoff,Targets,Tasks[0].Install]"', [['parches-domingo', 'cron(0 3 ? * SUN *)', 3, 1, ['tag:Patch Group=web'], true]], 'Falta la ventana parches-domingo (domingos 3:00, 3 h, corte 1 h) con destino el grupo web y la tarea AWS-RunPatchBaseline en modo Install'),
        ),
        solution: [
          `echo '{"PatchRules":[{"PatchFilterGroup":{"PatchFilters":[{"Key":"CLASSIFICATION","Values":["Security"]},{"Key":"SEVERITY","Values":["Critical","Important"]}]},"ApproveAfterDays":3}]}' > reglas.json`,
          'B=$(aws ssm create-patch-baseline --name seguridad-linux --operating-system AMAZON_LINUX_2023 --approval-rules file://reglas.json --query BaselineId --output text)',
          'aws ssm register-patch-baseline-for-patch-group --baseline-id $B --patch-group web',
          'I1=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].InstanceId" --output text)',
          'I2=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-2 --query "Reservations[0].Instances[0].InstanceId" --output text)',
          'aws ec2 create-tags --resources $I1 $I2 --tags "Key=Patch Group,Value=web"',
          'W=$(aws ssm create-maintenance-window --name parches-domingo --schedule "cron(0 3 ? * SUN *)" --duration 3 --cutoff 1 --no-allow-unassociated-targets --query WindowId --output text)',
          'T=$(aws ssm register-target-with-maintenance-window --window-id $W --resource-type INSTANCE --targets "Key=tag:Patch Group,Values=web" --query WindowTargetId --output text)',
          "aws ssm register-task-with-maintenance-window --window-id $W --targets Key=WindowTargetIds,Values=$T --task-arn AWS-RunPatchBaseline --task-type RUN_COMMAND --priority 1 --max-concurrency 50% --max-errors 0 --task-invocation-parameters 'RunCommand={Parameters={Operation=[Install]}}'",
          'aws ssm describe-patch-groups --query "Mappings[].[PatchGroup,BaselineIdentity.BaselineName]" --output text',
        ],
        hints: [
          'Las reglas de aprobación van en un JSON: `{"PatchRules":[{"PatchFilterGroup":{"PatchFilters":[{"Key":"CLASSIFICATION","Values":["Security"]},{"Key":"SEVERITY","Values":["Critical","Important"]}]},"ApproveAfterDays":3}]}`. ⚠️ En `create-patch-baseline` añade **`--operating-system AMAZON_LINUX_2023`**: si no, la línea base se crea para WINDOWS y no sirve a estas instancias.',
          'Asocia la línea base al grupo con `aws ssm register-patch-baseline-for-patch-group --baseline-id <id> --patch-group web` y etiqueta las instancias con `aws ec2 create-tags --resources … --tags "Key=Patch Group,Value=web"` (la clave lleva un espacio).',
          'La ventana: `create-maintenance-window` (`--no-allow-unassociated-targets`), luego `register-target-with-maintenance-window` con `--targets "Key=tag:Patch Group,Values=web"` y por último `register-task-with-maintenance-window` con `--targets Key=WindowTargetIds,Values=<id del destino>`, `--task-arn AWS-RunPatchBaseline`, `--task-type RUN_COMMAND` y `--task-invocation-parameters \'RunCommand={Parameters={Operation=[Install]}}\'`.',
        ],
        explain: 'Cada pieza responde a una pregunta: la **línea base** decide *qué* parches se aprueban, el **grupo de parches** (etiqueta `Patch Group`) *a quién* se aplican, y la **ventana** *cuándo* y con qué documento. La trampa clásica es la del sistema operativo: sin `--operating-system` la línea base es de Windows y tus instancias Linux seguirían usando la por defecto sin que nadie lo note.',
        par: 10,
        commands: ['Patch Manager', 'Automation y ventanas de mantenimiento'],
      }),
      tf('«Para usar Run Command o Session Manager hay que tener abierto el puerto 22 en el grupo de seguridad.»', false, 'No: el agente de SSM sale a los servicios de AWS por HTTPS (443) y no recibe conexiones entrantes. Puedes cerrar el 22 por completo; el acceso se controla con IAM y queda en CloudTrail.'),
      multi('Una instancia EC2 no aparece como nodo administrado en Systems Manager. ¿Qué puede ser? (elige todas las correctas)', ['No tiene un rol de instancia con `AmazonSSMManagedInstanceCore`', 'El agente de SSM no está instalado o no está en marcha', 'La instancia no tiene salida a los servicios de SSM (ni NAT/internet ni endpoints)', 'El puerto 22 está cerrado en su grupo de seguridad'], [0, 1, 2], 'Hacen falta el rol, el agente y la ruta de red hacia SSM (saliente). El puerto 22 no interviene: SSM no usa SSH.'),
      order('Ordena el flujo de parcheo automático', ['línea-base', 'grupo', 'ventana', 'tarea', 'cumplimiento'], 'línea-base grupo ventana tarea cumplimiento', 'Defines la **línea base** (qué se aprueba), asocias las instancias en un **grupo** (etiqueta `Patch Group`), programas la **ventana**, le añades la **tarea** (`AWS-RunPatchBaseline`) y después revisas el **cumplimiento** (qué instancias siguen con parches pendientes).'),
      match(
        'Une cada herramienta de Systems Manager con su uso',
        [
          ['Run Command', 'Ejecutar una orden en muchas instancias a la vez'],
          ['Parameter Store', 'Guardar configuración y secretos por rutas'],
          ['Patch Manager', 'Aplicar parches con una línea base y por grupos'],
          ['Automation', 'Runbooks de varios pasos con roles y aprobaciones'],
        ],
        'Son piezas de la misma familia que comparten el agente, el rol de instancia y los permisos de IAM.',
      ),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a14-5', { title: 'X-Ray, EventBridge y respuesta automática', summary: 'Encontrar el cuello de botella con trazas y cerrar el círculo: de la alarma a la acción sin que nadie despierte', emoji: '⚡', commands: ['AWS X-Ray', 'Muestreo y grupos de X-Ray', 'Automatizar respuestas con EventBridge', 'Runbooks y respuesta a incidentes', 'Observabilidad: las tres señales'], minutes: 38 }, [
      learn(
        'Trazas: seguir una petición por el sistema',
        `
Una petición de un cliente puede pasar por API Gateway, dos funciones Lambda, una cola y DynamoDB. Las métricas te dicen que «va lenta» y los registros que «algo falló»; **las trazas te dicen dónde**. En AWS lo hace **X-Ray**:

- Una **traza** es el recorrido completo de una petición (un \`trace id\`). Se compone de **segmentos** (el trabajo de un servicio: una función Lambda, un contenedor) y **subsegmentos** (las llamadas que ese servicio hace: a DynamoDB, a otra API, o un bloque de tu código que mides).
- El **mapa de servicios** (\`get-service-graph\`) dibuja los nodos, con su número de peticiones, errores y tiempo medio.
- Las **anotaciones** (\`cliente=ana\`) se indexan y sirven para **buscar** (\`annotation.cliente = "ana"\`); los **metadatos** son datos extra que no se indexan.
- **Activar el rastreo**: en Lambda con \`--tracing-config Mode=Active\` (y el rol necesita \`AWSXRayDaemonWriteAccess\`); en el código, el SDK de X-Ray (\`patch_all()\`) añade las llamadas a otros servicios.
- **Muestreo**: no se guarda cada petición (sería carísimo). Por defecto: la **primera petición de cada segundo** más el **5 %** del resto. Con **reglas de muestreo** puedes pedir el 100 % de una ruta crítica o menos de una ruidosa.
- **Grupos**: filtros guardados (\`fault\`, \`responsetime > 2\`) con su propio mapa y métricas.

Una pista para leer una traza: el servicio que «tarda» puede estar simplemente **esperando** a otro. El cuello de botella es el que tiene mucho tiempo **propio** (sin contar lo que espera de sus llamadas).
`,
        '🧵',
      ),
      illus('aws-trace-map', 'Una petición, de principio a fin', 'Haz lento un servicio, rompe otro y mira cómo cambia el mapa y la cascada de tiempos: ¿cuál es el cuello de botella?'),
      demo(
        'Mapa y trazas de la tienda',
        [
          [GRAFO, 'El mapa de servicios: nombre, tipo, peticiones y tiempo total'],
          ['aws xray get-trace-summaries --start-time $(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ) --query "TraceSummaries[].[Id,ResponseTime,HasFault]" --output text', 'Las trazas guardadas (id, duración en segundos y si hubo fallo)'],
          ['T=$(aws xray get-trace-summaries --start-time $(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ) --query "TraceSummaries[0].Id" --output text)', 'Elegimos una'],
          ['aws xray batch-get-traces --trace-ids $T --query "Traces[0].Segments[].Document" --output text', 'Sus segmentos (JSON con inicio, fin y subsegmentos)'],
          ['aws xray get-trace-summaries --start-time $(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ) --filter-expression "responsetime > 2" --query "length(TraceSummaries)"', 'Búsqueda con expresión de filtro: las peticiones de más de 2 s'],
        ],
        A('ops-trazas-ok'),
        'Las trazas llegan con un pequeño retraso en el servicio real (unos segundos); aquí ya están listas.',
      ),
      tf('«X-Ray guarda todas las trazas de todas las peticiones.»', false, 'Se muestrean: por defecto la primera petición de cada segundo y el 5 % del resto. Así el coste es predecible. Con reglas de muestreo subes el porcentaje donde lo necesitas (por ejemplo, el 100 % del cobro).'),
      practice({
        prompt: 'La función **`checkout`** llama a **`inventario`** y guarda el pedido en DynamoDB. Los clientes se quejan de que cobrar tarda más de 2 segundos y nadie sabe por qué. **Activa el rastreo** (X-Ray en modo `Active`) en **las dos funciones** y dales a sus roles (`checkout-rol`, `inventario-rol`) la política `AWSXRayDaemonWriteAccess`; invoca `checkout` unas veces y, con el mapa de servicios y las trazas, averigua qué servicio es **el cuello de botella** (el que tarda de verdad, no el que solo espera). Guarda su nombre en el parámetro **`/incidencia/servicio-lento`**.',
        goal: 'Rastreo activo en las dos funciones, con permisos, y el servicio lento anotado en /incidencia/servicio-lento',
        setup: A('ops-trazas'),
        check: all(
          awsIs('ssm get-parameter --name /incidencia/servicio-lento --query Parameter.Value', 'inventario', 'Todavía no está en /incidencia/servicio-lento el servicio que de verdad tarda'),
          awsAfter([`_check invoke --function checkout --payload '{"id":"P-9"}'`, `_check invoke --function checkout --payload '{"id":"P-10"}'`, `_check invoke --function checkout --payload '{"id":"P-11"}'`], awsHas('_check traces', ['inventario', 'DynamoDB'], 'No llegan trazas de las dos funciones y de DynamoDB (¿modo Active en las dos y permiso de X-Ray en los roles?)')),
        ),
        solution: [
          'aws lambda update-function-configuration --function-name checkout --tracing-config Mode=Active',
          'aws lambda update-function-configuration --function-name inventario --tracing-config Mode=Active',
          'aws iam attach-role-policy --role-name checkout-rol --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess',
          'aws iam attach-role-policy --role-name inventario-rol --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess',
          INVOCA('checkout'),
          INVOCA('checkout'),
          INVOCA('checkout'),
          GRAFO,
          'aws ssm put-parameter --name /incidencia/servicio-lento --value inventario --type String',
        ],
        hints: ['Para cada función: `aws lambda update-function-configuration --function-name <f> --tracing-config Mode=Active`, y para cada rol `aws iam attach-role-policy --role-name <rol> --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess`. Sin el permiso del rol, el rastreo se activa pero no llega ninguna traza.', 'Invoca con `aws lambda invoke --function-name checkout --cli-binary-format raw-in-base64-out --payload \'{"id":"P-1"}\' salida.json` (tres o cuatro veces) y mira `aws xray get-service-graph …` y `aws xray get-trace-summaries …`.', 'En el mapa, `checkout` también «tarda» más de 2 s, pero porque espera a `inventario`; DynamoDB tarda milisegundos. Compara el tiempo total de cada nodo con el de sus llamadas: el que concentra el tiempo propio es el cuello de botella.'],
        explain: 'Dos requisitos distintos para que lleguen trazas: el **modo Active** en la función y el **permiso de X-Ray** en su rol. Con ellos, el mapa muestra a `checkout` con un tiempo alto, pero dentro está la llamada a `inventario` (2 s) y la de DynamoDB (milisegundos): **el cuello de botella es `inventario`**; arreglar `checkout` no serviría de nada. Es lo que una media de latencia nunca te dice.',
        par: 7,
        commands: ['AWS X-Ray', 'Observabilidad: las tres señales'],
      }),
      practice({
        prompt: 'El rastreo ya está activo en `checkout` y `inventario`, pero con el muestreo por defecto se pierden la mayoría de las peticiones de cobro. Crea una **regla de muestreo `checkout-todas`** que guarde el **100 %** de las peticiones del servicio **`checkout`** (prioridad 1, reservorio de 1) y un **grupo de X-Ray `lentas`** con la expresión de filtro **`responsetime > 1`** para ver solo las peticiones de más de un segundo.',
        goal: 'Regla de muestreo del 100 % para checkout y grupo lentas con su filtro',
        setup: A('ops-trazas-ok'),
        check: all(
          awsIs('xray get-sampling-rules --query "SamplingRuleRecords[?SamplingRule.RuleName==\'checkout-todas\'].SamplingRule.[ServiceName,FixedRate,Priority] | [0]"', ['checkout', 1, 1], 'Falta la regla de muestreo checkout-todas (servicio checkout, 100 %, prioridad 1)'),
          awsIs('xray get-groups --query "Groups[?GroupName==\'lentas\'].FilterExpression | [0]"', 'responsetime > 1', 'Falta el grupo lentas con el filtro responsetime > 1'),
        ),
        solution: [`aws xray create-sampling-rule --sampling-rule '{"RuleName":"checkout-todas","Priority":1,"FixedRate":1,"ReservoirSize":1,"ResourceARN":"*","ServiceName":"checkout","ServiceType":"*","Host":"*","HTTPMethod":"*","URLPath":"*","Version":1}'`, 'aws xray create-group --group-name lentas --filter-expression "responsetime > 1"', 'aws xray get-sampling-rules --query "SamplingRuleRecords[].SamplingRule.[RuleName,FixedRate,Priority]" --output text'],
        hints: ['La regla es un JSON con `RuleName`, `Priority`, `FixedRate` (1 = 100 %), `ReservoirSize`, `ResourceARN`, `ServiceName`, `ServiceType`, `Host`, `HTTPMethod`, `URLPath` y `Version`: `aws xray create-sampling-rule --sampling-rule \'{…}\'`.', 'Para que se aplique antes que la regla `Default` (prioridad 10000), la nuestra necesita un número bajo: 1.', 'El grupo: `aws xray create-group --group-name lentas --filter-expression "responsetime > 1"`.'],
        explain: 'Las reglas se evalúan por prioridad (el número más bajo, primero) y gana la primera que coincide: la tuya, con prioridad 1, se aplica antes que la `Default`. `FixedRate` es la fracción de peticiones guardadas después de agotar el **reservorio** (peticiones por segundo garantizadas). Un grupo es un filtro con nombre: así el equipo tiene siempre a mano «las lentas».',
        par: 3,
        commands: ['Muestreo y grupos de X-Ray', 'AWS X-Ray'],
      }),
      learn(
        'Del dato a la acción: responder sin despertar a nadie',
        `
Medir y avisar es la mitad. La otra es **responder**, y lo repetitivo se puede automatizar:

\`\`\`
Alarma de CloudWatch ──► EventBridge ──► Systems Manager Automation
(CloudWatch Alarm State Change)         (AWS-RestartEC2Instance)
Config (NON_COMPLIANT) ─────────────────► remediación (AWS-DisablePublicAccessForSecurityGroup)
\`\`\`

- Los cambios de estado de una alarma llegan a **EventBridge** como eventos \`aws.cloudwatch\` · \`CloudWatch Alarm State Change\`; una **regla** con un patrón (\`"detail":{"alarmName":["web-lenta"],"state":{"value":["ALARM"]}}\`) los envía a un **destino**: una Lambda, una cola, un tema SNS, un documento de **Automation**, Run Command…
- Los destinos con identidad necesitan un **rol** que EventBridge asume (\`RoleArn\`), con permiso para iniciar la automatización y para **pasar** el rol de automatización (\`iam:PassRole\`).
- Un *runbook* de Automation lleva su propio **rol** (\`AutomationAssumeRole\`) con los permisos mínimos para lo que hace (reiniciar esa instancia, no administrar toda la cuenta).

**Prudencia con la automatización:** reiniciar sin mirar puede empeorar un incidente. Buenas prácticas: que sea **idempotente** (repetirla no hace daño), **limitar el alcance** (una instancia, no la flota), **avisar siempre a una persona** (SNS en paralelo), añadir un **paso de aprobación** para acciones destructivas y **medir** (¿se resolvió o solo se tapó?).
`,
        '🤖',
      ),
      practice({
        prompt: 'La alarma **`web-lenta`** salta cada vez que la web del servidor **`web-1`** se queda colgada, y la solución es siempre la misma: reiniciarlo. Automatízalo: una **regla de EventBridge `reiniciar-web`** que reaccione a esa alarma cuando pasa a **ALARM** y ejecute la automatización **`AWS-RestartEC2Instance`** sobre `web-1`. Ya existen los roles **`eventos-rol`** (el que usa EventBridge para lanzar la automatización) y **`auto-rol`** (el que usa la automatización para tocar EC2). La automatización recibe `InstanceId` y `AutomationAssumeRole` como entrada (listas de un elemento).',
        goal: 'Cuando web-lenta salta, EventBridge lanza AWS-RestartEC2Instance sobre web-1 y termina bien',
        setup: A('ops-eventos'),
        check: awsAfter(['_check metric --namespace Tienda --name LatenciaMs --value 2000'], awsIs('ssm describe-automation-executions --query "AutomationExecutionMetadataList[0].[DocumentName,AutomationExecutionStatus]"', ['AWS-RestartEC2Instance', 'Success'], 'Cuando la latencia se dispara y web-lenta salta, no se ejecuta con éxito AWS-RestartEC2Instance (¿patrón de la regla? ¿destino? ¿roles?)')),
        solution: [
          'ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].InstanceId" --output text)',
          `aws events put-rule --name reiniciar-web --event-pattern '{"source":["aws.cloudwatch"],"detail-type":["CloudWatch Alarm State Change"],"detail":{"alarmName":["web-lenta"],"state":{"value":["ALARM"]}}}'`,
          TARGETS_REINICIO,
          'aws events put-targets --rule reiniciar-web --targets file://targets.json',
          'aws events list-targets-by-rule --rule reiniciar-web --query "Targets[].Arn" --output text',
        ],
        hints: ['El patrón: `{"source":["aws.cloudwatch"],"detail-type":["CloudWatch Alarm State Change"],"detail":{"alarmName":["web-lenta"],"state":{"value":["ALARM"]}}}` con `aws events put-rule --name reiniciar-web --event-pattern …`.', 'El destino es un ARN de Automation: `arn:aws:ssm:us-east-1:123456789012:automation-definition/AWS-RestartEC2Instance:$DEFAULT`, con `RoleArn` = `eventos-rol` y un `Input` JSON `{"InstanceId":["<id de web-1>"],"AutomationAssumeRole":["arn:aws:iam::123456789012:role/auto-rol"]}`. Escribe los destinos en un archivo y pásalos con `--targets file://targets.json`.', 'El id de `web-1` sale de `aws ec2 describe-instances --filters Name=tag:Name,Values=web-1`. Para ver que funciona, publica `aws cloudwatch put-metric-data --namespace Tienda --metric-name LatenciaMs --value 2000` y mira `aws ssm describe-automation-executions`.'],
        explain: 'Tres piezas encadenadas, cada una con su permiso: la **regla** (qué evento), el **destino** (qué documento de Automation y con qué entrada) y los **dos roles** (`eventos-rol` deja a EventBridge iniciar la automatización y pasar `auto-rol`; `auto-rol` da a la automatización permisos sobre EC2). Fíjate en que la automatización no pregunta nada: por eso se empieza por acciones seguras (reiniciar una instancia) y se avisa también a una persona.',
        par: 8,
        commands: ['Automatizar respuestas con EventBridge', 'Runbooks y respuesta a incidentes', 'Automation y ventanas de mantenimiento'],
      }),
      multi('Quieres automatizar la respuesta a un incidente repetitivo. ¿Qué buenas prácticas aplicarías? (elige todas las correctas)', ['Que la acción sea idempotente (repetirla no causa daño)', 'Limitar el alcance del rol de automatización a lo imprescindible', 'Avisar también a una persona, aunque la automatización lo resuelva', 'Dar a la automatización permisos de administrador «para que no falle»'], [0, 1, 2], 'Idempotencia, mínimo privilegio y una persona informada son la base. Un rol de administrador convierte un fallo de la automatización en un incidente mayor.'),
      order('Ordena la cadena de respuesta automática a una alarma', ['métrica', 'alarma', 'evento', 'regla', 'automatización'], 'métrica alarma evento regla automatización', 'La **métrica** cruza el umbral; la **alarma** cambia de estado; se emite un **evento** a EventBridge; una **regla** con su patrón lo recoge; y el destino lanza la **automatización**.'),
      match(
        'Une cada señal con lo que te aporta',
        [
          ['Métricas', 'Saber cuánto y cómo va, y alarmar'],
          ['Registros', 'Saber qué pasó exactamente'],
          ['Trazas', 'Saber por dónde pasó una petición y dónde tardó'],
          ['EventBridge + Automation', 'Reaccionar sin intervención humana'],
        ],
        'Las tres señales (métricas, registros y trazas) se complementan: las métricas avisan, las trazas localizan, los registros explican; y la automatización cierra el círculo.',
      ),
    ]),

  ],
  boss: {
    prompt:
      'Misión final: **«La noche de guardia»**. Son las dos de la mañana: nadie sabe por qué la función **`pedidos`** (que procesa los pedidos de la tienda) falla desde hace un rato, y no hay **ninguna alarma** que avisara. Ya existen el tema SNS **`alertas`** (con la cola `guardia` suscrita), el bucket **`auditoria-logs`** (con la política para CloudTrail ya puesta) y el parámetro **`/tienda/prod/db-host`** con el valor correcto de la base de datos. Haz lo siguiente: **(1)** investiga con **CloudTrail** quién cambió la configuración de la función y **etiquétala** con **`CambiadoPor`** = esa persona; **(2)** mira los **registros** de la función, **restaura** el valor correcto de la variable `DB_HOST` (el de Parameter Store) y comprueba que `pedidos` vuelve a funcionar; **(3)** para que no vuelva a pasar desapercibido, crea un **filtro de métricas** sobre `ERROR` en `/aws/lambda/pedidos`, una **alarma** que avise a `alertas` con **1 o más errores en un minuto** y deja los registros **14 días**; **(4)** crea un **trail multirregión con validación** llamado **`auditoria`** y arráncalo.',
    goal: 'pedidos arreglada, causa anotada, vigilada con filtro y alarma, registros a 14 días y trail de auditoría registrando',
    setup: A('ops-boss'),
    check: all(
      awsIs('_check invoke --function pedidos --query Payload.estado', 'ok', 'La función pedidos todavía falla: mira los registros y la variable DB_HOST'),
      awsIs('lambda list-tags --resource arn:aws:lambda:us-east-1:123456789012:function:pedidos --query Tags.CambiadoPor', 'becario', 'Falta etiquetar la función con CambiadoPor = quien cambió su configuración (míralo en CloudTrail)'),
      awsIs('logs describe-log-groups --log-group-name-prefix /aws/lambda/pedidos --query "logGroups[0].retentionInDays"', 14, 'Los registros de /aws/lambda/pedidos deberían guardarse 14 días'),
      awsIs('cloudtrail describe-trails --trail-name-list auditoria --query "trailList[0].[IsMultiRegionTrail,LogFileValidationEnabled]"', [true, true], 'Falta el trail auditoria (multirregión y con validación de archivos)'),
      awsIs('cloudtrail get-trail-status --name auditoria --query IsLogging', true, 'El trail auditoria existe pero no está registrando'),
      awsAfter(['_check log --group /aws/lambda/pedidos --message "ERROR no se puede conectar con la base de datos" --count 3'], awsMatches(AVISOS, HAY_AVISO, 'Si la función vuelve a escribir ERROR, tiene que llegar un aviso (filtro de métricas + alarma con acción a alertas)')),
    ),
    solution: [
      'aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventSource,AttributeValue=lambda.amazonaws.com --query "Events[].[EventTime,Username,EventName]" --output text',
      'aws logs filter-log-events --log-group-name /aws/lambda/pedidos --filter-pattern ERROR --query "events[0].message" --output text',
      'HOST=$(aws ssm get-parameter --name /tienda/prod/db-host --query Parameter.Value --output text)',
      'aws lambda update-function-configuration --function-name pedidos --environment "Variables={DB_HOST=$HOST}"',
      'aws lambda tag-resource --resource arn:aws:lambda:us-east-1:123456789012:function:pedidos --tags CambiadoPor=becario',
      'aws logs put-metric-filter --log-group-name /aws/lambda/pedidos --filter-name errores --filter-pattern ERROR --metric-transformations metricName=ErroresPedidos,metricNamespace=Tienda,metricValue=1,defaultValue=0',
      TOPIC,
      'aws cloudwatch put-metric-alarm --alarm-name pedidos-errores --namespace Tienda --metric-name ErroresPedidos --statistic Sum --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching --alarm-actions $TOPIC',
      'aws logs put-retention-policy --log-group-name /aws/lambda/pedidos --retention-in-days 14',
      'aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs --is-multi-region-trail --enable-log-file-validation',
      'aws cloudtrail start-logging --name auditoria',
      'aws lambda invoke --function-name pedidos --cli-binary-format raw-in-base64-out --payload \'{}\' salida.json',
    ],
    hints: [
      'Empieza por el **qué** y el **quién**: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventSource,AttributeValue=lambda.amazonaws.com` (busca `UpdateFunctionConfiguration`) y los registros de `/aws/lambda/pedidos` con `aws logs filter-log-events … --filter-pattern ERROR` (el error dice a qué servidor intenta conectar la función).',
      'Restaura la variable: `aws lambda update-function-configuration --function-name pedidos --environment "Variables={DB_HOST=<valor de /tienda/prod/db-host>}"`. La etiqueta: `aws lambda tag-resource --resource arn:aws:lambda:us-east-1:123456789012:function:pedidos --tags CambiadoPor=<usuario>`.',
      'Vigilancia: `aws logs put-metric-filter … --filter-pattern ERROR --metric-transformations metricName=…,metricNamespace=…,metricValue=1`, una alarma sobre esa métrica (Sum, 60 s, ≥ 1) con `--alarm-actions` del tema `alertas`, y `aws logs put-retention-policy … --retention-in-days 14`. El trail: `aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs --is-multi-region-trail --enable-log-file-validation` y `start-logging`.',
    ],
    explain: 'Has hecho una guardia de principio a fin con las herramientas de la zona: **CloudTrail** dio el *quién* y el *cuándo* (un cambio de configuración de `becario`), los **registros** dieron el *qué* (la función intentaba conectar con una base de datos que ya no existe), **Parameter Store** guardaba el valor bueno, y después cerraste el círculo: un **filtro de métricas** y una **alarma** para que el siguiente fallo avise antes que el cliente, **retención** para no pagar registros eternos y un **trail** multirregión con validación para tener la historia completa. Ningún paso es opcional en una cuenta de producción.',
    commands: ['AWS CloudTrail', 'Filtros de métricas', 'Alarmas de CloudWatch', 'Parameter Store', 'Observabilidad: las tres señales'],
  },
});
