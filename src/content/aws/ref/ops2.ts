import type { AwsRef } from '../reference';

const DESDE = (d: string) => `--start-time $(date -u -d "${d}" +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u -d "1 minute" +%Y-%m-%dT%H:%M:%SZ)`;

export const AWS_REF_OPS2: AwsRef[] = [
  // ───────────────────────── Systems Manager ─────────────────────────
  {
    name: 'AWS Systems Manager',
    kind: 'servicio',
    category: 'operaciones',
    level: 1,
    summary: 'La caja de herramientas de operaciones de AWS: ejecutar órdenes en la flota, sesiones sin SSH, configuración y secretos, parches y automatizaciones.',
    details: `
Capacidades principales (todas comparten el **agente de SSM**, un **rol de instancia** y los permisos de IAM):

- **Run Command**: órdenes y documentos en muchas instancias a la vez.
- **Session Manager**: terminal sin SSH ni claves, con registro de sesiones.
- **Parameter Store**: configuración y secretos jerárquicos.
- **Patch Manager**: líneas base, grupos y ventanas de parcheo.
- **Automation**: runbooks de varios pasos (reiniciar, crear AMI, cerrar puertos…).
- **State Manager**: asociaciones que mantienen una configuración.
- **Maintenance Windows**, **Inventory**, **Explorer/OpsCenter** (visión operativa y casos).

**Nodo administrado**: una instancia (o servidor local) aparece solo si tiene el agente, un rol con \`AmazonSSMManagedInstanceCore\` y salida de red hacia los servicios de SSM (internet/NAT o los *endpoints* \`ssm\`, \`ssmmessages\` y \`ec2messages\`). Si falta algo, no aparece en \`describe-instance-information\`.
`,
    whenUse: ['Operar la flota sin puertos de entrada ni claves compartidas', 'Parchear, inventariar y automatizar tareas repetitivas', 'Guardar configuración de aplicaciones fuera del código'],
    whenNot: ['Para auditoría (CloudTrail) o cumplimiento (Config)', 'Si todo tu cómputo es serverless: Lambda y contenedores no usan nodos administrados'],
    pricing: 'Gran parte de las capacidades son gratuitas (Run Command, Session Manager, Parameter Store estándar, Patch Manager). Se paga por las avanzadas (parámetros avanzados, OpsCenter, pasos de Automation por encima de la capa gratuita) y por lo que usan por debajo (registros, S3, SNS).',
    scenario: 'ops-ssm-run',
    examples: [
      ['aws ssm describe-instance-information --query "InstanceInformationList[].[InstanceId,PingStatus]" --output text', 'Las instancias administradas'],
      ['aws ssm list-documents --filters Key=Owner,Values=Amazon --query "length(DocumentIdentifiers)"', 'Documentos públicos de Amazon (runbooks y comandos)'],
    ],
    seeAlso: ['Run Command', 'Parameter Store', 'Patch Manager', 'Automation y ventanas de mantenimiento', 'Session Manager'],
  },
  {
    name: 'Parameter Store',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Almacén jerárquico de configuración y secretos (String, StringList, SecureString) con versiones, permisos de IAM por ruta y lectura por ruta.',
    details: `
\`\`\`
/tienda/prod/db-host        String        db-prod.interno
/tienda/prod/db-password    SecureString  (cifrado con KMS)
\`\`\`

- **Tipos**: \`String\`, \`StringList\` (valores separados por comas) y \`SecureString\` (cifrado con KMS: \`--key-id alias/mi-clave\` o la clave por defecto \`aws/ssm\`; se lee con \`--with-decryption\`).
- **Jerarquía**: \`/entorno/servicio/clave\` (hasta 15 niveles). Permite leer toda la configuración con \`get-parameters-by-path\` y dar permisos solo a una ruta.
- **Versiones** (\`--overwrite\` crea una nueva), **etiquetas** (\`label-parameter-version\`: «estable») e historial (\`get-parameter-history\`).
- **Tiers**: **Standard** (valor hasta 4 KB, hasta 10 000 parámetros, gratis) y **Advanced** (8 KB, hasta 100 000, con **políticas** de caducidad y notificaciones; de pago).
- **Patrón de permisos**: \`ssm:GetParametersByPath\` sobre \`arn:aws:ssm:región:cuenta:parameter/tienda/prod*\`.
- **Integraciones**: CloudFormation (\`{{resolve:ssm:/ruta}}\` y \`AWS::SSM::Parameter\`), Lambda y ECS (secretos como variables), AMI recomendadas (\`/aws/service/ami-amazon-linux-latest/…\`).

Parameter Store **no rota** secretos: para eso, Secrets Manager.
`,
    whenUse: ['Configuración por entorno de aplicaciones, funciones y contenedores', 'Secretos sencillos y baratos que no necesitan rotación automática', 'Pasar valores entre plantillas y pipelines'],
    whenNot: ['Contraseñas que deben rotar solas (bases de datos): Secrets Manager', 'Datos grandes o muy dinámicos: S3, DynamoDB'],
    pricing: 'El nivel estándar es gratis. El avanzado cuesta por parámetro y mes, y las llamadas con mayor rendimiento y los parámetros con políticas se cobran aparte. El SecureString usa KMS: la clave gestionada por AWS es gratuita, las propias tienen cuota mensual y por uso.',
    limits: ['Estándar: 4 KB por valor y 10 000 parámetros', 'Avanzado: 8 KB por valor y 100 000 parámetros', 'Hasta 15 niveles de jerarquía'],
    versus: [
      ['Secrets Manager', 'Rotación automática, versiones de secretos y replicación entre regiones; se paga por secreto. Parameter Store es más sencillo y mucho más barato.'],
      ['Variables de entorno', 'Más simples, pero en texto plano en la configuración de la función y sin permisos por valor.'],
    ],
    scenario: 'base',
    examples: [
      ['aws ssm put-parameter --name /tienda/prod/db-host --value db-prod.interno --type String', 'Crea el parámetro (versión 1)'],
      ['aws ssm put-parameter --name /tienda/prod/db-password --value "Secreta#2026" --type SecureString', 'Un secreto: cifrado con KMS'],
      ['aws ssm get-parameter --name /tienda/prod/db-password --query Parameter.Value --output text', 'Sin descifrar, lo que ves es el texto cifrado'],
      ['aws ssm get-parameter --name /tienda/prod/db-password --with-decryption --query Parameter.Value --output text', 'Con `--with-decryption` y permiso sobre la clave, el valor real'],
      ['aws ssm put-parameter --name /tienda/prod/db-host --value db2.interno --type String --overwrite', 'Nueva versión (la 2)'],
      ['aws ssm get-parameter-history --name /tienda/prod/db-host --query "Parameters[].[Version,Value]" --output text', 'El historial de versiones'],
      ['aws ssm get-parameters-by-path --path /tienda/prod --query "Parameters[].Name" --output text', 'Toda la configuración de un entorno, por ruta'],
      ['aws ssm put-parameter --name /tienda/prod/db-host --value otro --type String', 'Sin `--overwrite` no se pisa uno existente', 'error'],
    ],
    seeAlso: ['AWS Systems Manager'],
  },
  {
    name: 'Patch Manager',
    kind: 'concepto',
    category: 'operaciones',
    level: 3,
    summary: 'Automatiza el parcheo con líneas base (qué se aprueba), grupos de parches (a quién) y ventanas de mantenimiento (cuándo), y mide el cumplimiento.',
    details: `
1. **Línea base** (\`create-patch-baseline\`): reglas de aprobación (clasificación, gravedad, producto), días de espera tras la publicación (\`ApproveAfterDays\`), parches aprobados o rechazados explícitamente. Hay una **por defecto por sistema operativo**.
   ⚠️ **Sin \`--operating-system\` se crea para WINDOWS.**
2. **Grupo de parches**: etiqueta de instancia con clave exacta **\`Patch Group\`** (con espacio) y el valor que elijas. La línea base se asocia con \`register-patch-baseline-for-patch-group\`. Cada grupo solo puede tener una línea base por sistema operativo.
3. **Operación**: el documento \`AWS-RunPatchBaseline\` con \`Operation=Scan\` (solo informa) o \`Install\` (instala y, si hace falta, reinicia: \`RebootOption\`).
4. **Cuándo**: una **ventana de mantenimiento**, o una asociación de State Manager.
5. **Cumplimiento**: \`describe-instance-patch-states\` y el panel de Patch Manager (instalados, pendientes, fallidos).

Consejos: prueba la base en un grupo de **preproducción** antes de producción; usa \`ApproveAfterDays\` para dejar tiempo a que se detecten parches problemáticos; y programa un \`Scan\` frecuente aunque el \`Install\` sea mensual.
`,
    whenUse: ['Flotas de EC2 o servidores locales que necesitan mantenerse al día con trazabilidad', 'Informes de cumplimiento de parches'],
    whenNot: ['Contenedores y serverless (el parche es reconstruir la imagen o lo hace AWS)', 'Servidores inmutables: sustituye la AMI en lugar de parchear'],
    pricing: 'Patch Manager no cuesta nada por sí mismo; sí lo que usan las ventanas y las automatizaciones.',
    scenario: 'ops-ssm-parches',
    examples: [
      ['aws ssm get-default-patch-baseline --operating-system AMAZON_LINUX_2023 --query BaselineId --output text', 'La base por defecto de Amazon Linux 2023'],
      [`echo '{"PatchRules":[{"PatchFilterGroup":{"PatchFilters":[{"Key":"CLASSIFICATION","Values":["Security"]},{"Key":"SEVERITY","Values":["Critical","Important"]}]},"ApproveAfterDays":3}]}' > reglas.json`, 'Reglas de aprobación'],
      ['B=$(aws ssm create-patch-baseline --name seguridad-linux --operating-system AMAZON_LINUX_2023 --approval-rules file://reglas.json --query BaselineId --output text)', 'La línea base (¡con el sistema operativo!)'],
      ['aws ssm register-patch-baseline-for-patch-group --baseline-id $B --patch-group web', 'Asociada al grupo `web`'],
      ['aws ssm describe-patch-groups --query "Mappings[].[PatchGroup,BaselineIdentity.BaselineName]" --output text', 'Quién usa qué'],
    ],
    seeAlso: ['AWS Systems Manager', 'Automation y ventanas de mantenimiento', 'Run Command'],
  },
  {
    name: 'Automation y ventanas de mantenimiento',
    kind: 'concepto',
    category: 'operaciones',
    level: 3,
    summary: 'Automation ejecuta runbooks de varios pasos con un rol; las ventanas de mantenimiento deciden cuándo se permite ejecutarlos sobre unos destinos.',
    details: `
**Automation**
- Un **documento** (\`schemaVersion: '0.3'\`) con \`parameters\` y \`mainSteps\`. Acciones frecuentes: \`aws:executeAwsApi\` (cualquier llamada a la API), \`aws:changeInstanceState\`, \`aws:runCommand\`, \`aws:executeScript\` (Python/PowerShell), \`aws:invokeLambdaFunction\`, \`aws:branch\` (decisiones), \`aws:sleep\`, \`aws:approve\` (aprobación manual).
- Hay decenas de **runbooks públicos** de Amazon: \`AWS-RestartEC2Instance\`, \`AWS-StopEC2Instance\`, \`AWS-CreateImage\`, \`AWS-DisablePublicAccessForSecurityGroup\`, \`AWS-PublishSNSNotification\`…
- \`AutomationAssumeRole\`: rol con **solo los permisos de lo que hace** (y que confíe en \`ssm.amazonaws.com\`).
- Se lanza a mano (\`start-automation-execution\`), desde EventBridge, desde una remediación de Config o desde una alarma. Se sigue con \`get-automation-execution\` y \`describe-automation-step-executions\`.

**Ventanas de mantenimiento**
- \`create-maintenance-window\`: \`--schedule\` (\`cron(0 3 ? * SUN *)\` o \`rate(7 days)\`), \`--duration\` (horas) y \`--cutoff\` (horas antes del final en que no se inician tareas nuevas).
- **Destinos** (\`register-target-with-maintenance-window\`, por etiqueta o ids) y **tareas** (\`register-task-with-maintenance-window\`: documento, prioridad, concurrencia y errores máximos).

**State Manager**: una *asociación* repite un documento con un horario sobre unos destinos (mantener el agente actualizado, aplicar una configuración).
`,
    whenUse: ['Respuestas repetibles a incidentes y tareas rutinarias (reiniciar, crear imágenes, rotar claves)', 'Ejecutar cambios solo en horarios acordados'],
    whenNot: ['Lógica compleja de negocio: Step Functions o Lambda', 'Si hace falta tomar decisiones difíciles: deja un paso de aprobación o avisa a una persona'],
    pricing: 'Automation incluye una cuota gratuita de pasos al mes y después se cobra por paso (y los pasos `aws:executeScript` por duración). Las ventanas no cuestan nada.',
    scenario: 'ops-ssm-run',
    examples: [
      ['I=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].InstanceId" --output text)', 'El id de la instancia'],
      ['aws ssm start-automation-execution --document-name AWS-RestartEC2Instance --parameters InstanceId=$I --query AutomationExecutionId --output text', 'Lanza un runbook público'],
      ['aws ssm describe-automation-executions --query "AutomationExecutionMetadataList[0].[DocumentName,AutomationExecutionStatus]" --output text', 'Su estado'],
      ['aws ssm create-maintenance-window --name sabado-noche --schedule "cron(0 2 ? * SAT *)" --duration 3 --cutoff 1 --no-allow-unassociated-targets --query WindowId --output text', 'Una ventana semanal'],
    ],
    seeAlso: ['AWS Systems Manager', 'Patch Manager', 'Runbooks y respuesta a incidentes'],
  },

  // ───────────────────────── X-Ray y respuesta ─────────────────────────
  {
    name: 'AWS X-Ray',
    kind: 'servicio',
    category: 'operaciones',
    level: 2,
    summary: 'Trazado distribuido: sigue una petición por todos los servicios que atraviesa y muestra un mapa con tiempos y errores para localizar el cuello de botella.',
    details: `
- **Traza**: el recorrido completo de una petición. **Segmento**: el trabajo de un servicio. **Subsegmento**: una llamada que ese servicio hace (a otra API, a DynamoDB, un bloque de código medido).
- **Mapa de servicios** (\`get-service-graph\`): nodos con peticiones, errores, fallos y tiempo; aristas entre servicios.
- **Resúmenes de trazas** (\`get-trace-summaries\`, con \`--filter-expression\`: \`fault\`, \`responsetime > 2\`, \`annotation.cliente = "ana"\`, \`service("checkout")\`) y trazas completas (\`batch-get-traces\`).
- **Anotaciones** (indexadas, para buscar) y **metadatos** (no indexados).
- **Cómo se activa**: Lambda (\`--tracing-config Mode=Active\`, con \`AWSXRayDaemonWriteAccess\` en el rol), API Gateway (trazado por etapa), ECS/EKS/EC2 con el demonio de X-Ray o el colector **AWS Distro for OpenTelemetry**; y el SDK en el código (\`patch_all()\` en Python) para ver las llamadas a otros servicios.
- **Muestreo**: por defecto la primera petición de cada segundo más el 5 % del resto; se ajusta con reglas.
- Las trazas se conservan 30 días.

Cómo leerlo: un servicio que «tarda» puede estar solo **esperando** a otro; el cuello de botella es el que concentra **tiempo propio**.
`,
    whenUse: ['Arquitecturas con varios servicios (microservicios, serverless): encontrar dónde se pierde el tiempo o falla', 'Entender las dependencias reales de una aplicación'],
    whenNot: ['Aplicaciones de un solo componente: registros y métricas bastan', 'Si necesitas el detalle de todas las peticiones: las trazas están muestreadas'],
    pricing: 'Se paga por traza registrada y por traza recuperada o analizada, con una capa gratuita mensual. El muestreo controla el coste.',
    limits: ['Las trazas se conservan 30 días', 'Un documento de segmento: hasta 64 KB', 'Muestreo por defecto: 1 por segundo + 5 %'],
    versus: [
      ['OpenTelemetry (ADOT) + otro backend', 'Estándar abierto, neutral con el proveedor; X-Ray es uno de los destinos posibles.'],
      ['CloudWatch ServiceLens / Application Signals', 'Vistas que combinan trazas, métricas y registros sobre la misma información.'],
    ],
    scenario: 'ops-trazas-ok',
    examples: [
      [`aws xray get-service-graph ${DESDE('1 hour ago')} --query "Services[].[Name,Type,SummaryStatistics.TotalCount]" --output text`, 'El mapa: nodos, tipos y peticiones'],
      [`aws xray get-trace-summaries ${DESDE('1 hour ago')} --query "TraceSummaries[].[Id,ResponseTime]" --output text`, 'Las trazas guardadas y su duración'],
      [`aws xray get-trace-summaries ${DESDE('1 hour ago')} --filter-expression "responsetime > 2" --query "length(TraceSummaries)"`, 'Las que tardaron más de 2 segundos'],
    ],
    seeAlso: ['Muestreo y grupos de X-Ray', 'Observabilidad: las tres señales'],
  },
  {
    name: 'Muestreo y grupos de X-Ray',
    kind: 'concepto',
    category: 'operaciones',
    level: 3,
    summary: 'Las reglas de muestreo deciden qué peticiones se trazan (reservorio por segundo más un porcentaje); los grupos son filtros guardados con su propio mapa.',
    details: `
**Regla de muestreo** (\`create-sampling-rule\`): \`RuleName\`, \`Priority\` (el número más bajo se evalúa primero), \`FixedRate\` (0–1), \`ReservoirSize\` (peticiones por segundo que se guardan siempre), y los criterios \`ServiceName\`, \`ServiceType\`, \`Host\`, \`HTTPMethod\`, \`URLPath\`, \`ResourceARN\`. Hay una regla **Default** (prioridad 10000, 1 por segundo y 5 %) que no se puede borrar.

Cómo se decide: se aplica la **primera regla que coincide**, por prioridad. Ejemplos: 100 % para \`/pago\`, 1 % para \`/salud\` (que llega cada segundo desde el balanceador).

**Grupos** (\`create-group\`): un nombre y una **expresión de filtro** (\`responsetime > 1\`, \`fault\`, \`annotation.cliente = "ana"\`). Cada grupo tiene su mapa de servicios y puede publicar métricas de CloudWatch (para alarmar sobre «peticiones lentas»).

**Insights** de X-Ray: detección automática de anomalías sobre un grupo.

Un coste que se descontrola casi siempre es de un muestreo demasiado alto en rutas ruidosas.
`,
    whenUse: ['Capturar el 100 % de una operación crítica (pagos)', 'Reducir el ruido de comprobaciones de salud', 'Mirar siempre aparte las peticiones lentas o con error'],
    whenNot: ['Subir el muestreo del 100 % en todo el tráfico: sube el coste sin dar más información útil'],
    pricing: 'Cada traza guardada se paga; un porcentaje más alto implica más trazas.',
    scenario: 'ops-trazas-ok',
    examples: [
      ['aws xray get-sampling-rules --query "SamplingRuleRecords[].SamplingRule.[RuleName,FixedRate,Priority]" --output text', 'La regla por defecto'],
      [`aws xray create-sampling-rule --sampling-rule '{"RuleName":"checkout-todas","Priority":1,"FixedRate":1,"ReservoirSize":1,"ResourceARN":"*","ServiceName":"checkout","ServiceType":"*","Host":"*","HTTPMethod":"*","URLPath":"*","Version":1}'`, 'El 100 % del servicio checkout'],
      ['aws xray create-group --group-name lentas --filter-expression "responsetime > 1"', 'Un grupo con las peticiones de más de 1 s'],
      ['aws xray get-groups --query "Groups[].GroupName" --output text', 'Los grupos'],
    ],
    seeAlso: ['AWS X-Ray'],
  },
  {
    name: 'Automatizar respuestas con EventBridge',
    kind: 'buena práctica',
    category: 'operaciones',
    level: 3,
    summary: 'Reglas de EventBridge que escuchan cambios (estado de alarmas, cumplimiento de Config, llamadas de CloudTrail) y lanzan una respuesta: automatización, función Lambda, aviso.',
    details: `
**Eventos de operaciones** más útiles:

- \`aws.cloudwatch\` · \`CloudWatch Alarm State Change\` (con \`detail.alarmName\` y \`detail.state.value\`).
- \`aws.config\` · \`Config Rules Compliance Change\`.
- \`aws.ec2\` · \`EC2 Instance State-change Notification\`.
- Cualquier llamada de gestión de la API: \`AWS API Call via CloudTrail\` (por ejemplo, «alguien ha desactivado un trail»).
- \`aws.health\`: avisos de AWS sobre tus recursos.

**Destinos**: Lambda, SNS, SQS, Step Functions, Automation (\`arn:aws:ssm:…:automation-definition/NOMBRE:$DEFAULT\`), Run Command, otro bus… hasta **5 destinos por regla**. Los que necesitan identidad llevan un \`RoleArn\` y el rol trabaja con **mínimo privilegio**. Puedes transformar la entrada (\`InputTransformer\`) para pasar solo lo necesario.

**Prudencia**:
1. Acciones **idempotentes** y de **alcance limitado**.
2. **Avisa también a una persona** (otro destino SNS) aunque la respuesta sea automática.
3. Evita **bucles** (una respuesta que provoca el mismo evento).
4. Prueba con eventos de ejemplo y deja una **cola de mensajes fallidos** (DLQ) en los destinos que puedan fallar.
`,
    whenUse: ['Reiniciar o recuperar un servicio ante una alarma conocida', 'Reaccionar a cambios peligrosos en la cuenta (desactivar CloudTrail, abrir un bucket)', 'Encadenar herramientas de operaciones'],
    whenNot: ['Incidentes que requieren juicio humano: avisa y deja que decida una persona', 'Para repetir tareas por horario simple: una regla programada o una ventana de mantenimiento'],
    pricing: 'Los eventos de servicios de AWS en el bus por defecto no tienen coste; los eventos personalizados y los de otros buses sí. Pagas el destino (Lambda, Automation…).',
    scenario: 'ops-eventos',
    examples: [
      [`aws events put-rule --name reiniciar-web --event-pattern '{"source":["aws.cloudwatch"],"detail-type":["CloudWatch Alarm State Change"],"detail":{"alarmName":["web-lenta"],"state":{"value":["ALARM"]}}}'`, 'Escucha cuando `web-lenta` pasa a ALARM'],
      ['aws events describe-rule --name reiniciar-web --query "[Name,State]" --output text', 'La regla, activa'],
      ['aws events list-targets-by-rule --rule reiniciar-web --query "length(Targets)"', 'Todavía sin destinos (hay que añadir `put-targets`)'],
    ],
    seeAlso: ['Amazon EventBridge', 'Runbooks y respuesta a incidentes', 'Automation y ventanas de mantenimiento'],
  },
  {
    name: 'Runbooks y respuesta a incidentes',
    kind: 'buena práctica',
    category: 'operaciones',
    level: 3,
    summary: 'Un incidente se gestiona con un proceso: detectar, avisar, mitigar, resolver y aprender. Un runbook es el paso a paso escrito (y, si se puede, automatizado) de cada uno.',
    details: `
**Ciclo de un incidente**

1. **Detectar**: alarmas sobre síntomas del usuario (errores, latencia).
2. **Avisar** a la persona de guardia (SNS, Incident Manager, chat) con un enlace al **runbook** y al panel.
3. **Mitigar primero, diagnosticar después**: volver atrás un despliegue, escalar, reiniciar. Reducir el impacto es lo primero.
4. **Investigar**: registros (Insights), trazas (X-Ray), cambios recientes (**CloudTrail**), configuración anterior (**Config**).
5. **Resolver** y comunicar.
6. **Aprender**: revisión **sin culpables**, qué falló en la detección y en la respuesta, y qué se automatiza o se añade (una alarma nueva, una regla de Config, un runbook mejor).

**Un buen runbook**: título claro, cuándo se usa, cómo comprobar que de verdad ocurre, pasos numerados con comandos, cómo verificar que funcionó, cuándo escalar y a quién. Se guarda como documento de Systems Manager (**Automation**) para que ejecutarlo sea un clic, con aprobación cuando es destructivo.

**Medidas útiles**: MTTD (tiempo hasta detectar), MTTR (tiempo hasta resolver), número de avisos por guardia (si hay muchos, hay ruido y se pierde confianza).
`,
    whenUse: ['Antes de producción: escribe el runbook de los tres fallos más probables', 'Tras cada incidente: convierte lo aprendido en alarma, regla o automatización'],
    whenNot: ['No sustituye a diseñar para que el sistema no falle (reintentos, varias zonas): complementa'],
    scenario: 'ops-ssm-run',
    examples: [
      ['aws ssm list-documents --filters Key=Owner,Values=Amazon Key=DocumentType,Values=Automation --query "length(DocumentIdentifiers)"', 'Runbooks públicos de Amazon para reutilizar'],
      ['aws ssm describe-document --name AWS-RestartEC2Instance --query "Document.[Name,DocumentType,Description]" --output text', 'Un runbook concreto'],
    ],
    seeAlso: ['Automatizar respuestas con EventBridge', 'Automation y ventanas de mantenimiento', 'Observabilidad: las tres señales'],
  },
  {
    name: 'Observabilidad: las tres señales',
    kind: 'concepto',
    category: 'operaciones',
    level: 1,
    summary: 'Métricas, registros y trazas son las tres señales de la observabilidad: las métricas avisan, las trazas localizan y los registros explican.',
    details: `
| Señal | Responde a | AWS | Cuándo la miras |
| --- | --- | --- | --- |
| **Métricas** | ¿Cómo va? ¿Hay un problema? | CloudWatch Metrics y alarmas | Siempre (paneles) y cuando suena una alarma |
| **Trazas** | ¿Dónde pasa? ¿Qué servicio tarda o falla? | X-Ray | Tras el aviso, para localizar |
| **Registros** | ¿Qué pasó exactamente? | CloudWatch Logs e Insights | Para explicar y encontrar la causa |

Y alrededor: **CloudTrail** (quién cambió qué), **Config** (cómo estaba y si cumple) y **EventBridge + Systems Manager** (reaccionar).

**Cuatro señales doradas** para cualquier servicio: **tráfico**, **errores**, **latencia** y **saturación**. Una alarma por cada una (sobre lo que ve el usuario) cubre la mayoría de los problemas.

**Para que el día de mañana encuentres el fallo:**
- Registros en **JSON** con un identificador de petición (el mismo de las trazas).
- Métricas de **negocio** (pedidos, pagos) además de las técnicas.
- **Retención** definida y **sin datos personales** en los registros.
- Alarmas con **dueño** y con enlace al manual.
`,
    whenUse: ['Al diseñar cualquier servicio de producción: decide desde el principio qué mides, qué registras y qué trazas'],
    scenario: 'ops-trazas-ok',
    examples: [
      ['aws cloudwatch list-metrics --namespace AWS/Lambda --query "length(Metrics)"', 'Métricas que publica Lambda'],
      ['aws logs describe-log-groups --query "logGroups[].logGroupName" --output text', 'Registros'],
      ['aws xray get-groups --query "Groups[].GroupName" --output text', 'Trazas: el grupo por defecto'],
    ],
    seeAlso: ['Amazon CloudWatch', 'Amazon CloudWatch Logs', 'AWS X-Ray', 'AWS CloudTrail'],
  },
];
