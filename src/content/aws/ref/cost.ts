import type { AwsRef } from '../reference';

export const AWS_REF_COST: AwsRef[] = [
  {
    name: 'Pago por uso',
    kind: 'concepto',
    category: 'costes',
    level: 1,
    summary: 'En AWS no compras: pagas lo que consumes. Casi todo se mide con tres ejes: cómputo (por segundo u hora), almacenamiento (por GB al mes) y datos que salen (por GB), más peticiones y funciones extra.',
    details: `
Los **cuatro motores** de casi cualquier factura:

1. **Cómputo**: horas de instancia, segundos de Lambda, horas de base de datos.
2. **Almacenamiento**: GB al mes (S3, EBS, snapshots, bases de datos).
3. **Transferencia de datos**: la que **sale** de AWS hacia internet o entre regiones/zonas.
4. **Peticiones y extras**: llamadas a la API, NAT gateway, balanceadores, IP públicas, registros…

Principios que conviene recordar:

- **Entrada gratis, salida de pago**: subir datos a AWS no cuesta; sacarlos, sí (con un primer tramo mensual gratuito).
- **Más compromiso, más descuento**: Savings Plans y reservas (1–3 años) abaratan hasta ~70 %; Spot hasta ~90 %.
- **Más volumen, menos precio**: muchos servicios tienen tramos decrecientes (S3, transferencia).
- **El precio cambia por región**: us-east-1 suele ser de las más baratas.
`,
    whenUse: ['Para razonar la factura: ¿qué eje pesa más en mi arquitectura?'],
    whenNot: ['No te fíes de cifras de memoria: los precios cambian; usa la calculadora y la página de precios del servicio'],
    pricing: 'Los precios de este curso son ilustrativos (redondeados, us-east-1).',
    seeAlso: ['Transferencia de datos', 'Recursos huérfanos', 'Capa gratuita', 'Modelos de compra'],
  },
  {
    name: 'Transferencia de datos',
    kind: 'concepto',
    category: 'costes',
    level: 1,
    summary: 'Entrar a AWS es gratis; salir a internet, entre regiones o incluso entre zonas de disponibilidad cuesta por GB. Es uno de los costes que más sorprende.',
    details: `
| Tráfico | Coste (orientativo) |
| --- | --- |
| De internet **hacia** AWS | Gratis |
| Dentro de la **misma zona** (por IP privada) | Gratis |
| Entre **zonas** de una región | ≈ 0,01 USD/GB en cada sentido |
| Entre **regiones** | ≈ 0,02 USD/GB |
| De AWS **hacia internet** | ≈ 0,09 USD/GB (tramos decrecientes; primeros GB del mes gratis) |
| S3 → CloudFront | Gratis (y CloudFront es más barato que salir directo) |

Cómo reducirla: **CloudFront** (cachea cerca del usuario), colocar piezas que hablan mucho **en la misma zona**, **VPC endpoints** (S3/DynamoDB gratis) en lugar de pasar por un NAT, comprimir, y evitar traer datos de otras regiones.
`,
    whenUse: ['Al diseñar arquitecturas multi-zona o multirregión: calcula el tráfico entre piezas'],
    whenNot: ['No sacrifiques la alta disponibilidad por ahorrar el tráfico entre zonas: es un coste razonable'],
    seeAlso: ['Pago por uso', 'CloudFront', 'NAT gateway'],
  },
  {
    name: 'Recursos huérfanos',
    kind: 'buena práctica',
    category: 'costes',
    level: 1,
    summary: 'Recursos que siguen cobrando aunque nadie los use: IP elásticas sin asociar, discos EBS sin conectar, snapshots viejos, NAT gateways y balanceadores sin tráfico, bases de datos olvidadas.',
    details: `
La lista de revisión mensual:

- **IP elásticas** sin asociar (y toda IPv4 pública en uso: ≈ 3,65 USD/mes cada una).
- **Volúmenes EBS** en estado \`available\` y **snapshots** antiguos.
- **NAT gateways** (≈ 33 USD/mes + datos) de entornos que ya no se usan.
- **Balanceadores** sin destinos, **instancias** de pruebas encendidas, **bases de datos** olvidadas (¡y Multi-AZ en desarrollo!).
- **Versiones** antiguas y cargas multiparte incompletas en S3; **logs** de CloudWatch sin caducidad.

Herramientas: **Cost Explorer**, **Trusted Advisor**, **Compute Optimizer**, etiquetas (para saber de quién es cada cosa) y **presupuestos con alertas**.
`,
    whenUse: ['Cada mes, y siempre al terminar un proyecto o un laboratorio'],
    whenNot: ['Antes de borrar, comprueba de quién es (etiquetas) y haz un snapshot si hay duda'],
    scenario: 'factura',
    examples: [
      ['aws ec2 describe-volumes --filters Name=status,Values=available --query "Volumes[].[VolumeId,Size,Tags[0].Value]" --output table', 'Discos sin conectar'],
      ["aws ec2 describe-addresses --query 'Addresses[?AssociationId==`null`].PublicIp' --output text", 'IP elásticas sin asociar'],
      ['aws ec2 describe-nat-gateways --query "NatGateways[].[Tags[0].Value,State]" --output table', 'NAT gateways que existen'],
    ],
    seeAlso: ['IP elástica', 'NAT gateway', 'Trusted Advisor', 'Etiquetas de asignación de costes'],
  },
  {
    name: 'Calculadora de precios de AWS',
    kind: 'servicio',
    category: 'costes',
    level: 1,
    summary: 'Herramienta web gratuita para estimar cuánto costaría una arquitectura ANTES de construirla: añades servicios, configuras uso y obtienes el coste mensual y anual, que puedes compartir.',
    details: `
Se usa en la fase de diseño: «¿cuánto costará esto?». Permite estimar servicios sueltos o una arquitectura completa, comparar regiones y modelos de compra (on-demand frente a Savings Plans) y **exportar** la estimación.

No confundir con:

- **Cost Explorer**: analiza lo que **ya has gastado** y prevé lo que gastarás.
- **Budgets**: **te avisa** cuando el gasto real o previsto supera un umbral.
- **Página de precios** de cada servicio: la tarifa unitaria.
`,
    whenUse: ['Antes de lanzar un proyecto, para presupuestar', 'Para comparar alternativas (por ejemplo, NAT gateway frente a VPC endpoint)'],
    whenNot: ['Para saber qué estás gastando ahora → Cost Explorer'],
    pricing: 'Gratuita.',
    seeAlso: ['Cost Explorer', 'AWS Budgets', 'Pago por uso'],
  },
  {
    name: 'Cost Explorer',
    kind: 'servicio',
    category: 'costes',
    level: 1,
    summary: 'Visualiza y analiza tu gasto histórico (hasta 13 meses, o 38 con datos ampliados), lo agrupa por servicio, cuenta, región o etiqueta y prevé el gasto futuro. Se activa una vez en la cuenta.',
    details: `
- **Agrupar** por servicio, tipo de uso, región, cuenta vinculada o **etiqueta** (si está activada para costes).
- **Filtrar** y comparar meses; ver el gasto **diario** o **mensual**.
- **Previsión** del gasto del mes o de los próximos 12.
- **Recomendaciones** de dimensionamiento y de Savings Plans.
- Los datos tardan hasta ~24 h en reflejarse. La interfaz web es gratuita; las **llamadas a la API** cuestan unos céntimos cada una.

Para análisis profundo: **Cost and Usage Report (CUR)**, que vuelca todo el detalle a S3 para consultarlo con Athena.
`,
    whenUse: ['Averiguar por qué subió la factura y qué servicio pesa más', 'Repartir costes por proyecto (con etiquetas)'],
    whenNot: ['Para presupuestar algo que aún no existe → Calculadora de precios', 'Para recibir avisos → Budgets / Cost Anomaly Detection'],
    pricing: 'Interfaz gratis; API: ≈ 0,01 USD por petición.',
    scenario: 'factura',
    examples: [['aws ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE --query "ResultsByTime[0].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]" --output table']],
    seeAlso: ['aws ce get-cost-and-usage', 'aws ce get-cost-forecast', 'Etiquetas de asignación de costes', 'AWS Budgets'],
  },
  {
    name: 'aws ce get-cost-and-usage',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Gasto por periodo con agrupación y filtros. Obligatorios: `--time-period`, `--granularity` (DAILY/MONTHLY) y `--metrics` (UnblendedCost…).',
    usage: 'aws ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY \\\n  --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE',
    details: '`End` es **exclusivo** (el 1 de marzo no entra). Agrupar por etiqueta: `Type=TAG,Key=Proyecto`: solo funciona si la etiqueta está **activada** para asignación de costes.',
    scenario: 'factura',
    examples: [
      ['aws ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE --query "sort_by(ResultsByTime[0].Groups,&Metrics.UnblendedCost.Amount)[-1].Keys[0]" --output text', 'El servicio que más gasta'],
      ['aws ce get-cost-and-usage --time-period Start=2026-03-01,End=2026-03-08 --granularity DAILY --metrics UnblendedCost --query "ResultsByTime[].[TimePeriod.Start,Total.UnblendedCost.Amount]" --output table'],
      ['aws ce get-cost-and-usage --time-period Start=2026-03-01,End=2026-02-01 --granularity MONTHLY --metrics UnblendedCost', 'El inicio debe ser anterior al fin', 'error'],
    ],
    seeAlso: ['Cost Explorer', 'aws ce get-cost-forecast'],
  },
  {
    name: 'aws ce get-cost-forecast',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Previsión del gasto para un periodo futuro a partir de lo que tienes ahora. `--time-period` debe empezar hoy o después.',
    usage: 'aws ce get-cost-forecast --time-period Start=2026-03-15,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY',
    scenario: 'factura',
    examples: [['aws ce get-cost-forecast --time-period Start=2026-03-15,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY --query Total.Amount --output text'], ['aws ce get-cost-forecast --time-period Start=2026-03-01,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY', 'No se puede prever el pasado', 'error']],
    seeAlso: ['Cost Explorer', 'AWS Budgets'],
  },
  {
    name: 'Etiquetas de asignación de costes',
    kind: 'buena práctica',
    category: 'costes',
    level: 1,
    summary: 'Etiquetas (clave-valor) que pones a los recursos para saber a qué proyecto, equipo o entorno pertenece cada gasto. Hay que activarlas en facturación para poder agrupar la factura por ellas.',
    details: `
- Convención común: \`Proyecto\`, \`Entorno\` (prod/dev), \`Propietario\`, \`CentroDeCoste\`.
- **Consistencia**: \`Proyecto\` y \`proyecto\` son claves distintas. Las **políticas de etiquetas** (Organizations) y las reglas de AWS Config ayudan a imponerlas.
- **Activación**: las etiquetas definidas por el usuario deben **activarse** como _cost allocation tags_ para aparecer en Cost Explorer y en la factura; solo cuentan desde que se activan (no son retroactivas).
- Lo que no tiene etiqueta aparece como «sin etiquetar» (\`Proyecto$\`): ese cajón suele ser el gran misterio de la factura.
- Se pueden aplicar a **muchos recursos a la vez** con la API de etiquetas (\`resourcegroupstaggingapi\`).
`,
    whenUse: ['Desde el primer recurso: etiquetar a posteriori es mucho más caro', 'Para repartir costes entre equipos y entornos'],
    whenNot: ['No pongas datos sensibles (contraseñas, datos personales) en etiquetas'],
    scenario: 'factura',
    examples: [['aws ce list-cost-allocation-tags --query "CostAllocationTags[].[TagKey,Status]" --output table'], ['aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Proyecto,Status=Active'], ['aws ce list-cost-allocation-tags --status Active --query "CostAllocationTags[].TagKey" --output text']],
    seeAlso: ['aws resourcegroupstaggingapi get-resources', 'Cost Explorer', 'AWS Organizations'],
  },
  {
    name: 'aws resourcegroupstaggingapi get-resources',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Busca recursos de varios servicios por etiqueta con una sola orden (instancias, discos, buckets, bases de datos…).',
    usage: 'aws resourcegroupstaggingapi get-resources --tag-filters Key=Proyecto,Values=tienda [--resource-type-filters ec2:instance]',
    details: 'Para etiquetar varios recursos a la vez: `tag-resources --resource-arn-list <arn> <arn> --tags Proyecto=tienda,Entorno=dev`. Solo devuelve recursos que **tienen** etiquetas.',
    scenario: 'factura',
    examples: [['aws resourcegroupstaggingapi get-resources --tag-filters Key=Entorno,Values=dev --query "ResourceTagMappingList[].ResourceARN" --output table'], ['aws resourcegroupstaggingapi get-tag-keys --query TagKeys --output text']],
    seeAlso: ['Etiquetas de asignación de costes'],
  },
  {
    name: 'AWS Organizations',
    kind: 'servicio',
    category: 'costes',
    level: 1,
    summary: 'Agrupa varias cuentas de AWS bajo una organización: facturación única, jerarquía de unidades organizativas (OU), creación automática de cuentas y políticas (SCP) que acotan lo que se puede hacer.',
    details: `
- **Cuenta de administración** (_management account_): paga la factura y gestiona la organización. Conviene **no desplegar cargas** en ella.
- **Cuentas miembro** agrupadas en **unidades organizativas (OU)**: por ejemplo, \`Producción\`, \`Desarrollo\`, \`Seguridad\`.
- **Facturación consolidada**: una sola factura, descuentos por volumen agregados y reservas/Savings Plans compartidos.
- **SCP** (_service control policies_): barreras que fijan el **máximo** de permisos de una cuenta u OU.
- Muchas cuentas = **aislamiento** (un error en desarrollo no toca producción), límites de gasto por equipo y permisos más simples.

Es la base de una **estrategia multicuenta** y de **Control Tower**.
`,
    whenUse: ['Cualquier empresa con más de una cuenta (producción, desarrollo, seguridad…)', 'Ahorrar con descuentos por volumen y compartir reservas'],
    whenNot: ['Para dar acceso a personas: IAM Identity Center; Organizations no sustituye a IAM'],
    pricing: 'Gratuito.',
    limits: ['10 cuentas por defecto (ampliable)', 'Profundidad máxima de OU: 5 niveles'],
    scenario: 'org-demo',
    examples: [['aws organizations list-accounts --query "Accounts[].[Name,Email,Status]" --output table'], ['aws organizations list-roots --query "Roots[0].[Id,Name]" --output text']],
    seeAlso: ['Facturación consolidada', 'SCP', 'aws organizations create-organization', 'aws organizations move-account'],
  },
  {
    name: 'Facturación consolidada',
    kind: 'concepto',
    category: 'costes',
    level: 1,
    summary: 'Con Organizations, todas las cuentas miembro se pagan en una sola factura de la cuenta de administración, sumando el uso para alcanzar antes los descuentos por volumen y compartiendo reservas y Savings Plans.',
    details: `
Ventajas:

- **Una sola factura** con el detalle por cuenta.
- **Descuentos por volumen** calculados sobre el uso total de la organización (S3, transferencia…).
- **Reservas y Savings Plans compartidos** entre cuentas: lo que una no usa, lo aprovecha otra.
- Cada cuenta sigue viendo su gasto y puede tener sus propios presupuestos.

No es solo contabilidad: refuerza el **control** (agrupar cuentas por equipo) sin perder el aislamiento técnico.
`,
    whenUse: ['Siempre que haya más de una cuenta'],
    whenNot: ['No sirve para repartir el gasto «por proyecto» dentro de una cuenta: para eso, etiquetas'],
    seeAlso: ['AWS Organizations', 'Savings Plans', 'Etiquetas de asignación de costes'],
  },
  {
    name: 'SCP',
    kind: 'concepto',
    category: 'costes',
    level: 2,
    summary: 'Service control policy: política de Organizations que fija el máximo de permisos de las cuentas de una OU. No concede nada por sí sola, solo recorta lo que IAM podría permitir (ni siquiera el usuario root de la cuenta puede saltársela).',
    details: `
Una SCP funciona como una **barrera**. Por ejemplo, impedir usar regiones no autorizadas o desactivar el registro de auditoría:

\`\`\`
{"Version":"2012-10-17","Statement":[{"Effect":"Deny",
 "Action":"cloudtrail:StopLogging","Resource":"*"}]}
\`\`\`

- Se aplican a la **raíz, a una OU o a una cuenta** y se heredan hacia abajo.
- **Permitido de verdad** = lo que permite IAM **y** lo que permiten todas las SCP.
- No afectan a la cuenta de administración.
- Toda cuenta necesita al menos una SCP aplicada (por defecto, \`FullAWSAccess\`).
`,
    whenUse: ['Guardarraíles de toda la organización (regiones, servicios prohibidos, protección de auditoría)'],
    whenNot: ['No sirve para dar permisos: IAM sigue haciendo falta'],
    seeAlso: ['AWS Organizations', 'Política de IAM'],
  },
  {
    name: 'aws organizations create-organization',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Crea una organización en la que la cuenta actual es la de administración. `--feature-set ALL` activa todas las funciones (SCP incluidas); `CONSOLIDATED_BILLING` solo la facturación unificada.',
    usage: 'aws organizations create-organization --feature-set ALL',
    scenario: 'base',
    examples: [['aws organizations create-organization --feature-set ALL --query Organization.[Id,FeatureSet] --output text'], ['aws organizations create-organization', 'Ya pertenece a una organización', 'error']],
    seeAlso: ['AWS Organizations'],
  },
  {
    name: 'aws organizations create-account',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Crea una cuenta nueva dentro de la organización (con un correo único). Es asíncrono: comprueba el resultado con `describe-create-account-status`.',
    usage: 'aws organizations create-account --email dev@ejemplo.com --account-name desarrollo',
    scenario: 'org-demo',
    examples: [
      ['REQ=$(aws organizations create-account --email test@ejemplo.com --account-name pruebas --query CreateAccountStatus.Id --output text)'],
      ['aws organizations describe-create-account-status --create-account-request-id $REQ --query CreateAccountStatus.[State,AccountId] --output text'],
    ],
    seeAlso: ['AWS Organizations', 'aws organizations move-account'],
  },
  {
    name: 'aws organizations move-account',
    kind: 'comando',
    category: 'costes',
    level: 2,
    summary: 'Mueve una cuenta de la raíz a una unidad organizativa (o entre unidades). Hereda las SCP de su nueva ubicación.',
    usage: 'aws organizations move-account --account-id <id> --source-parent-id <origen> --destination-parent-id <destino>',
    scenario: 'org-demo',
    examples: [
      ['ROOT=$(aws organizations list-roots --query "Roots[0].Id" --output text)'],
      ['OU=$(aws organizations create-organizational-unit --parent-id $ROOT --name Desarrollo --query OrganizationalUnit.Id --output text)'],
      ["ACC=$(aws organizations list-accounts --query 'Accounts[?Name==`desarrollo`].Id' --output text)"],
      ['aws organizations move-account --account-id $ACC --source-parent-id $ROOT --destination-parent-id $OU'],
    ],
    seeAlso: ['AWS Organizations', 'SCP'],
  },
  {
    name: 'Planes de soporte',
    kind: 'comparativa',
    category: 'costes',
    level: 1,
    summary: 'Basic (gratis, solo foros y atención de facturación), Developer (correo en horario laboral), Business (24/7 por chat, teléfono y correo, Trusted Advisor completo), Enterprise On-Ramp y Enterprise (gestor técnico de cuenta, TAM).',
    details: `
| Plan | Ideal para | Soporte técnico | Extras |
| --- | --- | --- | --- |
| **Basic** | Aprender | Solo atención al cliente (cuenta/facturación) y foros | Trusted Advisor: comprobaciones básicas (core) |
| **Developer** | Pruebas | Correo en horario laboral | Orientación arquitectónica general |
| **Business** | Producción | **24/7** teléfono, chat y correo; respuesta < 1 h en «sistema de producción caído» | **Trusted Advisor completo**, soporte de terceros |
| **Enterprise On-Ramp** | Cargas críticas | Respuesta más rápida | Pool de gestores técnicos (TAM) |
| **Enterprise** | Cargas de misión crítica | Respuesta en 15 min para «caída crítica del negocio» | **TAM** dedicado, revisiones, formación |

Precios: gratis, desde unos 29, 100 y miles de dólares al mes (el Business cobra el mayor entre un mínimo y un % del gasto). **AWS ha ido renovando los planes**: contrasta siempre con la página oficial.
`,
    whenUse: ['Business como mínimo para producción'],
    whenNot: ['No pagues Enterprise si solo necesitas respuesta rápida en incidencias: Business basta para muchos equipos'],
    pricing: 'Cuota mensual fija o porcentaje del gasto, según el plan.',
    seeAlso: ['Trusted Advisor', 'AWS Health'],
  },
  {
    name: 'Trusted Advisor',
    kind: 'servicio',
    category: 'costes',
    level: 1,
    summary: 'Revisa tu cuenta y te recomienda mejoras en costes, rendimiento, seguridad, tolerancia a fallos y límites de servicio: IP sin usar, security groups abiertos, buckets públicos, falta de MFA…',
    details: `
Las comprobaciones se agrupan en categorías: **optimización de costes**, **rendimiento**, **seguridad**, **tolerancia a fallos**, **límites de servicio** y **excelencia operativa**.

- Con **Basic y Developer** ves las comprobaciones **básicas** (core): sobre todo de seguridad y límites de servicio.
- Con **Business y superior** ves **todas** y puedes acceder por **API/CLI** (\`aws support …\`).
- Cada resultado: estado (**ok**, **warning**, **error**), recursos señalados y ahorro estimado.

Ejemplos: «IP elásticas sin asociar», «volúmenes EBS infrautilizados», «security groups con puertos sin restricción», «MFA en la cuenta raíz», «permisos de buckets de S3».
`,
    whenUse: ['Revisión periódica de higiene de la cuenta', 'Detectar ahorros fáciles'],
    whenNot: ['No sustituye a servicios especializados (GuardDuty, Inspector, Config): es una primera revisión'],
    pricing: 'Las comprobaciones básicas son gratis; las completas requieren plan Business o superior.',
    scenario: 'soporte',
    examples: [
      ['aws support describe-trusted-advisor-checks --language en --query "checks[].[name,category]" --output table'],
      ['aws support describe-trusted-advisor-check-result --check-id HCP4007jGY --query "result.[status,resourcesSummary.resourcesFlagged]" --output text', 'Security groups con puertos sin restringir'],
    ],
    seeAlso: ['Planes de soporte', 'Recursos huérfanos', 'Security group'],
  },
  {
    name: 'AWS Health',
    kind: 'servicio',
    category: 'costes',
    level: 1,
    summary: 'Te informa del estado de los servicios de AWS y de eventos que afectan a TUS recursos (mantenimientos, caídas, retiradas de versión). El «Panel de Salud» personal; el estado global está en la página pública.',
    details: `
- **AWS Health Dashboard** (personal): eventos que afectan a tus cuentas y recursos concretos, con la lista de recursos afectados.
- **Estado de los servicios** (público): visión general de todas las regiones.
- Se integra con **EventBridge** para automatizar avisos (por ejemplo, enviar a un canal de chat cuando hay una caída).
`,
    whenUse: ['Saber si una incidencia es tuya o de AWS', 'Recibir avisos de mantenimiento programado'],
    whenNot: ['Para monitorizar tus aplicaciones → CloudWatch'],
    seeAlso: ['Planes de soporte', 'Trusted Advisor'],
  },
  {
    name: 'Informes de costes',
    kind: 'servicio',
    category: 'costes',
    level: 2,
    summary: 'Cost and Usage Report (CUR: el detalle más completo, volcado a S3), Cost Anomaly Detection (avisa de gastos fuera de lo normal) y Budgets (avisa al superar un umbral).',
    details: `
- **Cost and Usage Report**: informe granular (hasta por hora y recurso) para analizar con Athena o QuickSight.
- **Cost Anomaly Detection**: aprende tu patrón de gasto y **avisa** si un servicio, cuenta o etiqueta se dispara.
- **Budgets**: umbrales fijos, con acciones automáticas (por ejemplo, aplicar una política restrictiva).
- **Compute Optimizer** y **Cost Optimization Hub**: recomendaciones de dimensionamiento y ahorro.
`,
    whenUse: ['CUR para análisis serio; anomalías y presupuestos desde el primer día'],
    whenNot: ['Para una duda puntual, basta con Cost Explorer'],
    seeAlso: ['Cost Explorer', 'AWS Budgets'],
  },
  {
    name: 'AWS Well-Architected Framework',
    kind: 'concepto',
    category: 'fundamentos',
    level: 1,
    summary: 'Los seis pilares para evaluar una arquitectura: excelencia operativa, seguridad, fiabilidad, eficiencia del rendimiento, optimización de costes y sostenibilidad.',
    details: `
| Pilar | Pregunta que plantea |
| --- | --- |
| **Excelencia operativa** | ¿Puedo operar, monitorizar y mejorar mi sistema? |
| **Seguridad** | ¿Protejo datos, identidades y sistemas? |
| **Fiabilidad** | ¿Se recupera de fallos y cumple su disponibilidad? |
| **Eficiencia del rendimiento** | ¿Uso bien los recursos y escala con la demanda? |
| **Optimización de costes** | ¿Evito gastos innecesarios? |
| **Sostenibilidad** | ¿Minimizo el impacto ambiental? |

Herramienta: **AWS Well-Architected Tool** (cuestionarios por carga de trabajo, con plan de mejora).
`,
    whenUse: ['Revisar cualquier arquitectura antes de producción y de forma periódica'],
    whenNot: ['No es una lista de verificación para «aprobar»: es una conversación sobre compromisos (_trade-offs_)'],
    seeAlso: ['Responsabilidad compartida', 'Recursos huérfanos'],
  },
];
