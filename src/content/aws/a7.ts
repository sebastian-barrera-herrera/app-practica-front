import { A, all, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, multi, out, practice, predict, ran, tf } from './awsbuild';

const FEB = '--time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost';
const BY_SERVICE = `aws ce get-cost-and-usage ${FEB} --group-by Type=DIMENSION,Key=SERVICE`;
const ID_OF = (name: string) => `ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=${name} --query "Reservations[0].Instances[0].InstanceId" --output text)`;
const IDLE = "IDLE=$(aws ec2 describe-addresses --query 'Addresses[?AssociationId==`null`].AllocationId' --output text)";

export const a7 = awsWorld({
  id: 'a7',
  index: 7,
  title: 'Costes, facturación y soporte',
  subtitle: 'Cuánto cuesta y cómo gastar menos',
  emoji: '💰',
  color: '#FBBF24',
  level: 'basico',
  intro:
    'La nube cobra por uso: eso es una ventaja enorme… y una fuente de sustos si nadie mira la factura. En esta zona aprenderás **cómo se cobra** (y qué se olvida), a **estimar** costes antes de construir, a **analizarlos** con Cost Explorer y **vigilarlos** con presupuestos, a **repartirlos** con etiquetas y a **agrupar cuentas** con Organizations. También los planes de soporte y Trusted Advisor, y un **simulacro de Cloud Practitioner** con las cuatro áreas del examen.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a7-1', { title: 'Cómo se cobra', summary: 'Los ejes de la factura y los gastos que se olvidan', emoji: '🧾', commands: ['Pago por uso', 'Transferencia de datos', 'Recursos huérfanos', 'Capa gratuita', 'aws ce get-cost-and-usage'], minutes: 16 }, [
      learn(
        'Pagas por lo que usas',
        `
En AWS **no compras servidores: pagas por lo que consumes**, sin cuota inicial en la mayoría de servicios. Casi toda factura se explica con **cuatro ejes**:

1. **Cómputo**: horas o segundos de instancia, de base de datos, de función.
2. **Almacenamiento**: GB al mes (S3, discos EBS, copias).
3. **Transferencia de datos**: la que **sale** de AWS (a internet, entre regiones o entre zonas).
4. **Peticiones y extras**: llamadas a la API, NAT gateways, IP públicas, balanceadores, registros…

Tres reglas útiles:

- **Entrar es gratis, salir cuesta**: subir datos a AWS no se cobra; sacarlos, sí (con un primer tramo gratuito).
- **Compromiso = descuento**: Savings Plans y reservas (1–3 años) abaratan hasta ~70 %; Spot hasta ~90 %.
- **Volumen = descuento**: muchos servicios abaratan por tramos.

Los precios de este curso son **ilustrativos**: contrasta siempre con la página oficial de cada servicio.
`,
        '🧾',
      ),
      mc('¿Cuál de estas transferencias de datos es **gratuita**?', ['De una instancia EC2 hacia internet', 'De internet hacia AWS (subir datos)', 'Entre dos regiones de AWS', 'De S3 a un servidor de otra empresa'], 1, 'La entrada de datos desde internet no se cobra. La salida (a internet o entre regiones) sí.'),
      learn(
        'Los gastos que se olvidan',
        `
Estas cosas **siguen cobrando aunque nadie las use**:

- **IP elásticas** sin asociar (y, desde 2024, **toda IPv4 pública**: ≈ 3,65 USD al mes cada una).
- **Discos EBS** en estado \`available\` (sin conectar) y **snapshots** antiguos.
- **NAT gateways**: ≈ 33 USD al mes cada uno **más** los GB procesados, haya tráfico o no.
- **Instancias de prueba** encendidas, **bases de datos Multi-AZ de desarrollo**, **balanceadores** sin tráfico.
- **Una instancia parada** no cobra cómputo, pero **su disco sí**.

El truco: **etiquetar** (para saber de quién es cada cosa) y **revisar cada mes**.
`,
        '👻',
      ),
      multi('Marca todo lo que **sigue costando** aunque no haya tráfico ni uso.', ['Un NAT gateway sin tráfico', 'Una IP elástica sin asociar', 'El disco de una instancia parada', 'El cómputo de una instancia parada', 'Los datos que subes a S3 (la subida en sí)'], [0, 1, 2], 'Parada, una instancia no cobra cómputo. Subir datos a AWS es gratis. Lo demás cuesta por existir.'),
      tf('«Si paro una instancia EC2, ya no pago nada por ella.»', false, 'Dejas de pagar el cómputo, pero sus discos EBS (y su IP elástica, si la tiene) siguen cobrando.'),
      demo(
        'Leer la factura de una cuenta de verdad',
        [
          [BY_SERVICE + ' --query "ResultsByTime[0].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]" --output table', 'El gasto de febrero por servicio'],
          [`aws ce get-cost-and-usage ${FEB} --group-by Type=DIMENSION,Key=SERVICE --query "sort_by(ResultsByTime[0].Groups,&Metrics.UnblendedCost.Amount)[-1].Keys[0]" --output text`, 'El que más pesa: ordenamos y cogemos el último'],
          ['aws ce get-cost-and-usage --time-period Start=2026-03-01,End=2026-03-08 --granularity DAILY --metrics UnblendedCost --query "ResultsByTime[].[TimePeriod.Start,Total.UnblendedCost.Amount]" --output table', 'Y el detalle diario de la primera semana de marzo'],
        ],
        A('factura'),
      ),
      predict('¿Cuántos servicios distintos aparecen en la factura de febrero?', `${BY_SERVICE} --query "length(ResultsByTime[0].Groups)"`, ['3', '8', '12'], 'Seis: EC2 (cómputo), «EC2 - Other» (discos y NAT), VPC (IP públicas), RDS, S3 y el plan de soporte.', A('factura')),
      mc('En Cost Explorer aparece «EC2 - Other» con bastante gasto. ¿Qué suele esconderse ahí?', ['Solo las instancias EC2', 'Discos EBS, snapshots, NAT gateways y transferencia de datos', 'El soporte técnico', 'Las licencias de Windows'], 1, '«EC2 - Other» agrupa lo que no es cómputo puro: EBS, snapshots, NAT gateways, transferencia de datos… Es donde se esconden muchos sustos.'),
      practice({
        prompt: 'Averigua en qué **servicio** se fue más dinero en **febrero de 2026**: consulta el gasto agrupado **por servicio** (`--group-by Type=DIMENSION,Key=SERVICE`).',
        goal: 'Consultar el gasto por servicio',
        setup: A('factura'),
        check: all(ran('ce get-cost-and-usage.*SERVICE'), out('Amazon Relational Database Service')),
        solution: [BY_SERVICE],
        hints: ['`aws ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE`', '`End` es exclusivo: el 1 de marzo no entra.'],
        explain: 'RDS (las dos bases Multi-AZ) es lo más caro de esta cuenta. Saber **dónde** está el dinero es el primer paso para ahorrar.',
        par: 1,
        commands: ['aws ce get-cost-and-usage'],
      }),
      practice({
        prompt: 'Trusted Advisor y tú habéis visto una **IP elástica sin asociar**, que cobra por no hacer nada. **Libérala** (`release-address`). No toques la IP que usa el NAT gateway.',
        goal: 'Sin IP elásticas sueltas',
        setup: A('factura'),
        check: awsIs("ec2 describe-addresses --query 'length(Addresses[?AssociationId==`null`])'", 0, 'Todavía queda una IP elástica sin asociar'),
        solution: [IDLE, 'aws ec2 release-address --allocation-id $IDLE'],
        hints: ["Las IP sin asociar no tienen `AssociationId`: `aws ec2 describe-addresses --query 'Addresses[?AssociationId==`null`].AllocationId' --output text`.", '`aws ec2 release-address --allocation-id <eipalloc>`'],
        explain: 'Ahorras unos 3,65 USD al mes. Pocos euros, pero esa «lluvia fina» de recursos olvidados suma mucho en una cuenta grande.',
        par: 2,
        commands: ['Recursos huérfanos'],
      }),
      practice({
        prompt: 'En la cuenta hay un **volumen de 200 GiB llamado `copia-vieja`** que no está conectado a ninguna instancia. Ya nadie lo necesita: **bórralo**.',
        goal: 'Sin volúmenes sin conectar',
        setup: A('factura'),
        check: awsIs('ec2 describe-volumes --filters Name=status,Values=available --query "length(Volumes)"', 0, 'Todavía hay un volumen sin conectar'),
        solution: ['VOL=$(aws ec2 describe-volumes --filters Name=status,Values=available --query "Volumes[0].VolumeId" --output text)', 'aws ec2 delete-volume --volume-id $VOL'],
        hints: ['`aws ec2 describe-volumes --filters Name=status,Values=available`', '`aws ec2 delete-volume --volume-id <id>` (si dudas, haz un snapshot antes).'],
        explain: 'Antes de borrar un disco, comprueba de quién es (etiquetas) y, si hay dudas, haz un snapshot: es más barato que un susto.',
        par: 2,
        commands: ['Recursos huérfanos'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a7-2', { title: 'Calculadora de precios, Cost Explorer y Budgets', summary: 'Estimar antes, analizar después y vigilar siempre', emoji: '🧮', commands: ['Calculadora de precios de AWS', 'Cost Explorer', 'AWS Budgets', 'Alarma de facturación', 'aws ce get-cost-forecast', 'Informes de costes'], minutes: 15 }, [
      learn(
        'Tres herramientas, tres momentos',
        `
| Momento | Herramienta | Qué hace |
| --- | --- | --- |
| **Antes** de construir | **Calculadora de precios de AWS** | Estima el coste mensual de una arquitectura que aún no existe |
| **Después**, para entender | **Cost Explorer** | Analiza el gasto pasado (por servicio, cuenta, etiqueta…) y prevé el futuro |
| **Siempre**, para vigilar | **AWS Budgets** (y Cost Anomaly Detection) | **Avisa** cuando el gasto real o previsto pasa un umbral, o cuando algo se dispara |

Para un análisis muy detallado, el **Cost and Usage Report (CUR)** vuelca cada línea de la factura a S3.
`,
        '🧮',
      ),
      match(
        'Une cada necesidad con la herramienta',
        [
          ['¿Cuánto costará esta arquitectura antes de lanzarla?', 'Calculadora de precios'],
          ['¿Qué servicio me costó más el mes pasado?', 'Cost Explorer'],
          ['Avísame cuando pase de 200 USD este mes', 'AWS Budgets'],
          ['Quiero cada línea de la factura para analizarla con SQL', 'Cost and Usage Report'],
        ],
        'Estimar, analizar, vigilar y detallar son cuatro necesidades con cuatro herramientas.',
      ),
      illus('aws-price-calc', 'Calculadora de costes', 'Elige cuántos recursos de cada tipo necesitas y mira qué pesa más en la factura.'),
      mc('Quieres comparar lo que costaría tu aplicación con un NAT gateway frente a un VPC endpoint **antes** de construirla. ¿Qué usas?', ['Cost Explorer', 'La calculadora de precios de AWS', 'Trusted Advisor', 'AWS Health'], 1, 'Para estimar costes de algo que todavía no existe: la calculadora de precios.'),
      learn(
        'Previsión y presupuestos',
        `
**Cost Explorer** no solo mira atrás: la **previsión** (\`get-cost-forecast\`) estima el gasto del resto del mes según lo que tienes encendido hoy.

**AWS Budgets** crea **presupuestos** con **alertas**:

- Tipos: de **coste**, de **uso**, de **reservas** y de **Savings Plans**.
- Alerta sobre el gasto **real** (ya ocurrido, p. ej. al 80 %) o **previsto** (va a pasar del límite).
- Canales: **correo** o **SNS**; incluso **acciones automáticas** (aplicar una política restrictiva).
- Los primeros presupuestos son **gratuitos**.

Buena práctica: **un presupuesto mensual y una alarma el primer día**, antes de lanzar nada.
`,
        '📣',
      ),
      demo(
        'Prever lo que viene',
        [
          ['aws ce get-cost-forecast --time-period Start=2026-03-15,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY --query Total.Amount --output text', 'Lo que gastaremos del 15 de marzo al fin de mes si no cambiamos nada'],
          ['aws ce get-cost-forecast --time-period Start=2026-03-01,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY', 'No se puede prever el pasado', 'error'],
          ['aws budgets describe-budgets --account-id 123456789012 --query "Budgets[].BudgetName" --output text', 'Esta cuenta no tiene ningún presupuesto'],
        ],
        A('factura'),
      ),
      mc('Quieres recibir un correo cuando el gasto **real** del mes llegue al 80 % de tu límite. ¿Qué configuras?', ['Una alarma de CloudWatch sobre CPU', 'Un presupuesto de AWS Budgets con una alerta al 80 % del gasto real', 'Un snapshot', 'Una regla de security group'], 1, 'AWS Budgets permite alertas por umbral sobre el gasto real o previsto, con aviso por correo o SNS.'),
      tf('«Cost Explorer puede avisar por correo cuando el gasto supera un umbral.»', false, 'Cost Explorer analiza y prevé, pero los **avisos** los dan AWS Budgets y Cost Anomaly Detection.'),
      practice({
        prompt: 'Crea un **presupuesto mensual de coste** llamado **`mensual`** con un límite de **200 USD**, y una alerta cuando el gasto **real** alcance el **80 %** (aviso a `yo@ejemplo.com`).\n\nCuenta: `123456789012`.',
        goal: 'Presupuesto mensual de 200 USD con alerta al 80 %',
        setup: A('base'),
        check: awsIs('budgets describe-budgets --account-id 123456789012 --query "Budgets[].[BudgetName,BudgetLimit.Amount,TimeUnit]"', [['mensual', '200', 'MONTHLY']], 'Falta el presupuesto mensual de 200 USD'),
        solution: [
          `aws budgets create-budget --account-id 123456789012 --budget '{"BudgetName":"mensual","BudgetLimit":{"Amount":"200","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"yo@ejemplo.com"}]}]'`,
        ],
        hints: ['`aws budgets create-budget --account-id 123456789012 --budget \'{…}\' --notifications-with-subscribers \'[…]\'`', 'El presupuesto: `{"BudgetName":"mensual","BudgetLimit":{"Amount":"200","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}`.', 'La alerta: `{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"yo@ejemplo.com"}]}`.'],
        explain: 'Es lo primero que se hace en una cuenta nueva: un presupuesto y una alerta. Cuesta nada y evita las sorpresas de fin de mes.',
        par: 1,
        commands: ['AWS Budgets'],
      }),
      practice({
        prompt: 'Calcula la **previsión de gasto** del resto de marzo: del **15 de marzo de 2026** (incluido) al **1 de abril** (excluido), métrica `UNBLENDED_COST`, granularidad mensual.',
        goal: 'Consultar la previsión',
        setup: A('factura'),
        check: all(ran('ce get-cost-forecast'), out('"Total"')),
        solution: ['aws ce get-cost-forecast --time-period Start=2026-03-15,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY'],
        hints: ['`aws ce get-cost-forecast --time-period Start=2026-03-15,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY`'],
        explain: 'La previsión parte de lo que tienes encendido hoy: si apagas lo que sobra, baja. En la misión final lo comprobarás.',
        par: 1,
        commands: ['aws ce get-cost-forecast'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a7-3', { title: 'Etiquetas, Organizations y facturación consolidada', summary: 'Saber de quién es cada gasto y agrupar cuentas', emoji: '🏷️', commands: ['Etiquetas de asignación de costes', 'aws resourcegroupstaggingapi get-resources', 'AWS Organizations', 'Facturación consolidada', 'SCP', 'aws organizations create-organization', 'aws organizations create-account', 'aws organizations move-account'], minutes: 17 }, [
      learn(
        'Etiquetas: el DNI de cada recurso',
        `
Una **etiqueta** es un par clave-valor que pones a un recurso (\`Proyecto=tienda\`, \`Entorno=dev\`). Sirven para **buscar**, **automatizar** y, sobre todo, **repartir costes**:

- Convención típica: \`Proyecto\`, \`Entorno\` (prod/dev), \`Propietario\`, \`CentroDeCoste\`.
- **Sé consistente**: \`Proyecto\` y \`proyecto\` son claves distintas.
- Para agrupar la **factura** por una etiqueta hay que **activarla** como _etiqueta de asignación de costes_ (solo cuenta desde ese momento, **no es retroactiva**).
- Lo que no tiene etiqueta aparece como «sin etiquetar» (\`Proyecto$\`): ese cajón suele esconder el misterio de la factura.
`,
        '🏷️',
      ),
      mc('Has etiquetado todo con `Proyecto`, pero en Cost Explorer no puedes agrupar por esa etiqueta. ¿Qué falta?', ['Reiniciar las instancias', 'Activarla como etiqueta de asignación de costes', 'Cambiar de región', 'Contratar soporte Business'], 1, 'Las etiquetas definidas por el usuario deben activarse para la asignación de costes antes de aparecer en la factura y en Cost Explorer.'),
      demo(
        'Buscar por etiqueta y detectar lo que falta',
        [
          ['aws resourcegroupstaggingapi get-resources --tag-filters Key=Proyecto,Values=tienda --query "ResourceTagMappingList[].ResourceARN" --output table', 'Todo lo del proyecto «tienda», de varios servicios a la vez'],
          ['aws resourcegroupstaggingapi get-resources --tag-filters Key=Entorno,Values=dev --query "ResourceTagMappingList[].ResourceARN" --output table', 'Y lo de desarrollo'],
          ['aws ec2 describe-instances --query "Reservations[].Instances[?Tags[?Key==\'Proyecto\']==null].Tags[?Key==\'Name\'].Value[]" --output text', '¿Qué instancia no tiene etiqueta de proyecto? La del gasto olvidado'],
          ['aws ce list-cost-allocation-tags --query "CostAllocationTags[].[TagKey,Status]" --output table', 'Ninguna etiqueta está activada para costes'],
        ],
        A('factura'),
      ),
      learn(
        'AWS Organizations: muchas cuentas, un orden',
        `
Las empresas serias usan **varias cuentas de AWS** (producción, desarrollo, seguridad…) para **aislar** errores, permisos y gasto. **AWS Organizations** las gestiona juntas:

- La **cuenta de administración** paga la factura y gestiona la organización (conviene **no** desplegar cargas en ella).
- Las **cuentas miembro** se agrupan en **unidades organizativas (OU)**.
- **Facturación consolidada**: **una sola factura**, descuentos por volumen sumando el uso de todas, y **reservas/Savings Plans compartidos**.
- **SCP** (_service control policies_): barreras que fijan el **máximo** de permisos de una OU o cuenta. **No conceden** permisos: solo recortan lo que IAM permitiría (y no se las salta ni el root de la cuenta miembro).
- Es **gratis**.
`,
        '🏢',
      ),
      illus('aws-org-tree', 'La jerarquía de una organización', 'Activa y desactiva SCP en cada nivel y mira qué puede hacer cada cuenta.'),
      mc('¿Qué ventaja de costes ofrece la facturación consolidada de AWS Organizations?', ['Las cuentas no pagan impuestos', 'Una sola factura y descuentos por volumen calculados sobre el uso total', 'Todo el uso es gratis', 'Elimina la necesidad de etiquetas'], 1, 'El uso se suma entre cuentas para alcanzar antes los tramos con descuento, y las reservas se comparten.'),
      tf('«Una SCP aplicada a una OU concede permisos a las cuentas de esa OU.»', false, 'Las SCP nunca conceden permisos: fijan el máximo. Para permitir algo hace falta IAM **y** que ninguna SCP lo prohíba.'),
      practice({
        prompt: 'La instancia **`batch-olvidado`** no tiene etiquetas y su coste aparece como «sin etiquetar». Ponle, con la **API de etiquetas** (`resourcegroupstaggingapi tag-resources`), las etiquetas **`Proyecto=tienda`** y **`Entorno=dev`**.\n\nARN de una instancia: `arn:aws:ec2:us-east-1:123456789012:instance/<id>`',
        goal: 'batch-olvidado con Proyecto=tienda',
        setup: A('factura'),
        check: awsIs('resourcegroupstaggingapi get-resources --tag-filters Key=Proyecto,Values=tienda --resource-type-filters ec2:instance --query "length(ResourceTagMappingList)"', 3, 'batch-olvidado debe llevar Proyecto=tienda'),
        solution: [ID_OF('batch-olvidado'), 'aws resourcegroupstaggingapi tag-resources --resource-arn-list arn:aws:ec2:us-east-1:123456789012:instance/$ID --tags Proyecto=tienda,Entorno=dev'],
        hints: ['Busca su id con `aws ec2 describe-instances --filters Name=tag:Name,Values=batch-olvidado`.', '`aws resourcegroupstaggingapi tag-resources --resource-arn-list <arn> --tags Proyecto=tienda,Entorno=dev`'],
        explain: 'Con una sola orden puedes etiquetar recursos de cualquier servicio. Es la forma rápida de poner orden en una cuenta existente.',
        par: 2,
        commands: ['aws resourcegroupstaggingapi get-resources', 'Etiquetas de asignación de costes'],
      }),
      practice({
        prompt: 'Para repartir la factura por proyecto, **activa la etiqueta `Proyecto`** como etiqueta de asignación de costes (`ce update-cost-allocation-tags-status`).',
        goal: 'Etiqueta Proyecto activa para costes',
        setup: A('factura'),
        check: awsIs('ce list-cost-allocation-tags --status Active --query "CostAllocationTags[].TagKey"', ['Proyecto'], 'La etiqueta Proyecto debe estar activa'),
        solution: ['aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Proyecto,Status=Active'],
        hints: ['`aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Proyecto,Status=Active`'],
        explain: 'Desde ahora Cost Explorer puede agrupar por `Proyecto`. Recuerda: no es retroactivo, solo cuenta desde la activación (en la vida real tarda hasta 24 h).',
        par: 1,
        commands: ['Etiquetas de asignación de costes'],
      }),
      practice({
        prompt: 'La organización ya existe y tiene dos cuentas miembro (`desarrollo` y `produccion`), ambas en la raíz. **Crea una unidad organizativa llamada `Desarrollo`** y **mueve la cuenta `desarrollo`** a ella.',
        goal: 'La cuenta desarrollo está en la OU Desarrollo',
        setup: A('org-demo'),
        check: awsIs('_check org --account desarrollo --query Parent', 'Desarrollo', 'La cuenta desarrollo debe estar en la OU Desarrollo'),
        solution: [
          'ROOT=$(aws organizations list-roots --query "Roots[0].Id" --output text)',
          'OU=$(aws organizations create-organizational-unit --parent-id $ROOT --name Desarrollo --query OrganizationalUnit.Id --output text)',
          "ACC=$(aws organizations list-accounts --query 'Accounts[?Name==`desarrollo`].Id' --output text)",
          'aws organizations move-account --account-id $ACC --source-parent-id $ROOT --destination-parent-id $OU',
        ],
        hints: ['Necesitas el id de la raíz: `aws organizations list-roots`.', '`aws organizations create-organizational-unit --parent-id <raíz> --name Desarrollo`', '`aws organizations move-account --account-id <cuenta> --source-parent-id <raíz> --destination-parent-id <OU>`'],
        explain: 'Agrupar cuentas en OU permite aplicar SCP y políticas a todas a la vez: «las cuentas de Desarrollo no pueden usar regiones fuera de la UE», por ejemplo.',
        par: 4,
        commands: ['aws organizations move-account', 'AWS Organizations'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a7-4', { title: 'Planes de soporte y Trusted Advisor', summary: 'Cuándo contratar soporte y qué te aconseja AWS gratis', emoji: '🛟', commands: ['Planes de soporte', 'Trusted Advisor', 'AWS Health', 'Recursos huérfanos'], minutes: 13 }, [
      learn(
        'Cinco planes de soporte',
        `
AWS ofrece planes de soporte técnico según la criticidad de tu carga:

| Plan | Para | Lo esencial |
| --- | --- | --- |
| **Basic** | Aprender | Gratis. Solo atención de cuenta/facturación y foros |
| **Developer** | Pruebas | Correo en horario laboral |
| **Business** | **Producción** | **24/7**, teléfono, chat y correo; Trusted Advisor **completo** |
| **Enterprise On-Ramp** | Cargas críticas | Pool de gestores técnicos |
| **Enterprise** | Misión crítica | **TAM** (gestor técnico de cuenta) dedicado, respuesta más rápida |

Cuanto más alto, más cuota y mejor tiempo de respuesta. **AWS actualiza los planes con el tiempo**: contrasta con la página oficial.
`,
        '🛟',
      ),
      illus('aws-support-plans', 'Comparar planes', 'Elige un plan y mira qué incluye y para qué situación encaja.'),
      match(
        'Une cada necesidad con el plan',
        [
          ['Estoy aprendiendo y no quiero pagar soporte', 'Basic'],
          ['Quiero poder consultar por correo en horario laboral mientras desarrollo', 'Developer'],
          ['Mi aplicación de producción necesita ayuda 24/7 por chat o teléfono', 'Business'],
          ['Necesito un gestor técnico dedicado (TAM) para una carga crítica', 'Enterprise'],
        ],
        'Basic es gratis; Developer para desarrollo; Business para producción 24/7; Enterprise añade un TAM.',
      ),
      learn(
        'Trusted Advisor: un asesor dentro de tu cuenta',
        `
**Trusted Advisor** revisa tu cuenta y te recomienda mejoras en cinco áreas: **costes**, **rendimiento**, **seguridad**, **tolerancia a fallos** y **límites de servicio**.

- **Basic/Developer**: solo algunas comprobaciones básicas (sobre todo de seguridad y límites).
- **Business o superior**: **todas** las comprobaciones, con acceso por API/CLI (\`aws support …\`).
- Cada comprobación da un **estado** (verde/ok, amarillo/warning, rojo/error), los **recursos señalados** y un **ahorro estimado**.

Ejemplos: IP elásticas sin asociar, instancias infrautilizadas, security groups con el puerto 22 abierto al mundo, falta de MFA en root, buckets de S3 públicos.
`,
        '🔭',
      ),
      mc('¿Qué plan de soporte incluye **todas** las comprobaciones de Trusted Advisor y soporte 24/7 por teléfono y chat?', ['Basic', 'Developer', 'Business (o superior)', 'Ninguno: son gratuitas siempre'], 2, 'Business y superiores. Basic y Developer solo ven comprobaciones básicas.'),
      demo(
        'Preguntarle a Trusted Advisor',
        [
          ['aws support describe-trusted-advisor-checks --language en --query "checks[].[name,category]" --output table', 'Con plan Business, la CLI muestra las comprobaciones'],
          ['aws support describe-trusted-advisor-check-result --check-id HCP4007jGY --query "result.[status,resourcesSummary.resourcesFlagged]" --output text', 'Security groups con puertos sin restricción: `error`, 1 señalado'],
          ['aws support describe-trusted-advisor-check-result --check-id 7DAFEmoDos --query result.status --output text', 'Y la cuenta raíz sin MFA'],
          ['aws support describe-trusted-advisor-check-result --check-id Z4AUBRNSmz --query "result.flaggedResources[].resourceId" --output text', 'La IP elástica que no usa nadie'],
        ],
        A('soporte'),
      ),
      tf('«Con el plan Basic puedes consultar todas las comprobaciones de Trusted Advisor por la CLI.»', false, 'Las comprobaciones completas y el acceso por API requieren plan Business o superior. Con Basic hay un conjunto reducido en la consola.'),
      mc('¿Qué servicio te avisa si un mantenimiento programado de AWS o una incidencia afecta a **tus** recursos?', ['AWS Health', 'Amazon Inspector', 'AWS Artifact', 'Amazon Macie'], 0, 'AWS Health (Panel de Salud) muestra eventos que afectan a tus cuentas y recursos concretos.'),
      practice({
        prompt: 'Trusted Advisor marca dos problemas de **costes**: una **IP elástica sin asociar** y una instancia **`sobredimensionado`** (m5.xlarge) que casi no se usa. Resuélvelos: **libera la IP** y **termina** la instancia.',
        goal: 'Comprobaciones de costes en verde',
        setup: A('soporte'),
        check: all(
          awsIs('support describe-trusted-advisor-check-result --check-id Z4AUBRNSmz --query result.status', 'ok', 'La IP elástica sin asociar sigue marcada'),
          awsIs('support describe-trusted-advisor-check-result --check-id Qch7DwouX1 --query result.status', 'ok', 'La instancia sobredimensionada sigue marcada'),
        ),
        solution: [IDLE, 'aws ec2 release-address --allocation-id $IDLE', ID_OF('sobredimensionado'), 'aws ec2 terminate-instances --instance-ids $ID'],
        hints: ['La IP: `aws ec2 describe-addresses` → `aws ec2 release-address --allocation-id <id>`.', 'La instancia: `aws ec2 terminate-instances --instance-ids <id>`.'],
        explain: 'En la vida real, antes de terminar una instancia «sobredimensionada» se mide su uso (CloudWatch, Compute Optimizer) y se valora cambiarla a un tipo más pequeño en vez de borrarla.',
        par: 4,
        commands: ['Trusted Advisor', 'Recursos huérfanos'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a7-5', { title: 'Simulacro Cloud Practitioner', summary: 'Preguntas por dominios, como el examen real', emoji: '🎓', commands: ['AWS Well-Architected Framework', 'Responsabilidad compartida', 'Planes de soporte', 'Trusted Advisor'], minutes: 30 }, [
      learn(
        'Cómo funciona este simulacro',
        `
El examen **AWS Certified Cloud Practitioner** pone a prueba cuatro **dominios**, con estos pesos aproximados:

| Dominio | Peso |
| --- | --- |
| **1 · Conceptos de la nube** | 24 % |
| **2 · Seguridad y cumplimiento** | 30 % |
| **3 · Tecnología y servicios** | 34 % |
| **4 · Facturación, precios y soporte** | 12 % |

Aquí encontrarás **preguntas de cada dominio** con el mismo estilo (opción única y opción múltiple). Cada una indica su dominio al principio. Al final verás tu puntuación y podrás repasar lo que falles. Los pesos y el contenido oficial **cambian con las versiones del examen**: consulta siempre la guía oficial.
`,
        '🎓',
      ),
      // ───── Dominio 1 ─────
      mc('**[Dominio 1 · Conceptos de la nube]** ¿Qué ventaja de la nube describe «dejar de comprar servidores y pagar solo por el uso»?', ['Mayor latencia', 'Cambiar gasto de capital (CapEx) por gasto variable (OpEx)', 'Eliminar la necesidad de seguridad', 'Pérdida de control sobre los datos'], 1, 'Es la primera de las ventajas clásicas: no inviertes por adelantado, pagas lo que consumes.'),
      mc('**[Dominio 1 · Conceptos de la nube]** Una tienda online recibe 10 veces más tráfico en el Black Friday y luego vuelve a la normalidad. ¿Qué característica de la nube la ayuda?', ['Durabilidad', 'Elasticidad', 'Cifrado en reposo', 'Facturación consolidada'], 1, 'La elasticidad permite aumentar y reducir recursos automáticamente según la demanda.'),
      mc('**[Dominio 1 · Conceptos de la nube]** Para tolerar el fallo de un centro de datos, ¿cómo deberías desplegar tu aplicación?', ['En una sola zona de disponibilidad, con una instancia grande', 'En varias zonas de disponibilidad de una región', 'En una sola instancia con un disco grande', 'Solo en una región cualquiera'], 1, 'Las zonas de disponibilidad están aisladas entre sí: repartir la aplicación entre varias evita el punto único de fallo.'),
      match(
        '**[Dominio 1 · Conceptos de la nube]** Une cada pilar de Well-Architected con su pregunta',
        [
          ['Seguridad', '¿Protejo datos e identidades?'],
          ['Fiabilidad', '¿Se recupera de los fallos?'],
          ['Optimización de costes', '¿Evito gastos innecesarios?'],
          ['Excelencia operativa', '¿Puedo operar y mejorar el sistema?'],
        ],
        'Seis pilares: excelencia operativa, seguridad, fiabilidad, eficiencia del rendimiento, optimización de costes y sostenibilidad.',
      ),
      mc('**[Dominio 1 · Conceptos de la nube]** Con AWS Lambda subes tu código y AWS gestiona los servidores. ¿Qué modelo es?', ['IaaS', 'Sin servidores (serverless) / PaaS-FaaS', 'Nube privada', 'Hardware dedicado'], 1, 'En serverless no administras servidores: pagas por ejecución.'),
      mc('**[Dominio 1 · Conceptos de la nube]** ¿Qué es una ubicación de borde (edge location)?', ['Un centro de datos con servidores EC2', 'Un punto de presencia donde CloudFront guarda copias de contenido cerca de los usuarios', 'Una región de AWS', 'Una subred pública'], 1, 'Las edge locations acercan el contenido a los usuarios (CloudFront, Route 53).'),
      tf('**[Dominio 1 · Conceptos de la nube]** «Las economías de escala permiten a AWS bajar los precios porque compra y opera a gran volumen.»', true, 'Es una de las ventajas clásicas: más clientes → menor coste por unidad.'),
      mc('**[Dominio 1 · Conceptos de la nube]** ¿Qué diferencia a una región de una zona de disponibilidad?', ['Son lo mismo', 'Una región es un área geográfica que contiene varias zonas de disponibilidad aisladas', 'Una zona contiene varias regiones', 'Las regiones solo existen en EE. UU.'], 1, 'Región → varias zonas de disponibilidad (mínimo tres).'),
      // ───── Dominio 2 ─────
      mc('**[Dominio 2 · Seguridad y cumplimiento]** Según el modelo de responsabilidad compartida, ¿de qué es responsable el **cliente** en una instancia EC2?', ['Del hardware físico', 'De los parches del sistema operativo y de las reglas del security group', 'De la seguridad física del centro de datos', 'Del hipervisor'], 1, 'AWS protege la nube (hardware, instalaciones, hipervisor); el cliente, lo que hay en la nube (SO, aplicaciones, datos, red).'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** ¿Qué debes hacer **primero** con el usuario root de una cuenta nueva?', ['Crear claves de acceso para usarlo a diario', 'Activar MFA y guardarlo; usar usuarios IAM o Identity Center para el día a día', 'Compartir la contraseña con el equipo', 'Borrarlo'], 1, 'El root solo se usa para tareas excepcionales y con MFA.'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** Una aplicación en EC2 necesita leer de un bucket de S3. ¿Cuál es la forma más segura?', ['Guardar claves de acceso en el código', 'Asignar un rol de IAM a la instancia', 'Dar acceso público al bucket', 'Usar las credenciales del root'], 1, 'Los roles proporcionan credenciales temporales sin secretos en el código.'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** ¿Qué servicio ayuda a proteger una aplicación web contra ataques de denegación de servicio distribuido (DDoS)?', ['AWS Shield', 'AWS KMS', 'AWS Artifact', 'Amazon Inspector'], 0, 'Shield protege contra DDoS (Shield Standard es gratuito para todos).'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** ¿Qué servicio registra **quién hizo qué** en tu cuenta (llamadas a la API)?', ['AWS CloudTrail', 'Amazon CloudWatch Logs de una aplicación', 'AWS Config', 'Amazon GuardDuty'], 0, 'CloudTrail audita las acciones de usuarios, roles y servicios.'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** ¿Dónde obtienes informes de cumplimiento y certificaciones de AWS (ISO, SOC…)?', ['AWS Artifact', 'AWS Budgets', 'Amazon Route 53', 'AWS Trusted Advisor'], 0, 'AWS Artifact es el portal de informes y acuerdos de cumplimiento.'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** ¿Qué servicio gestiona claves de cifrado y controla quién puede usarlas?', ['AWS KMS', 'AWS WAF', 'Amazon Macie', 'AWS Shield'], 0, 'KMS crea y gestiona claves de cifrado y registra su uso.'),
      multi('**[Dominio 2 · Seguridad y cumplimiento]** Marca las buenas prácticas de IAM.', ['Aplicar el mínimo privilegio', 'Activar MFA en el usuario root', 'Compartir una única cuenta de administrador entre todo el equipo', 'Usar roles en lugar de claves de acceso de larga duración'], [0, 1, 3], 'Compartir una cuenta impide saber quién hizo qué. Las otras tres son prácticas recomendadas.'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** Un security group permite el puerto 80 de entrada. Un cliente envía una petición. ¿Hace falta una regla de salida para que la respuesta vuelva?', ['Sí, siempre', 'No: los security groups tienen estado y dejan salir la respuesta', 'Solo si es UDP', 'Solo desde otra región'], 1, 'Los security groups son con estado (a diferencia de las NACL).'),
      mc('**[Dominio 2 · Seguridad y cumplimiento]** ¿Qué servicio detecta actividad sospechosa o maliciosa en tu cuenta analizando registros (por ejemplo, credenciales comprometidas)?', ['Amazon GuardDuty', 'AWS Backup', 'Amazon Route 53', 'AWS Snowball'], 0, 'GuardDuty analiza CloudTrail, VPC Flow Logs y DNS para detectar amenazas.'),
      // ───── Dominio 3 ─────
      learn(
        'Mapa rápido de servicios que aparecen en el examen',
        `
Antes del dominio 3, un repaso de **una línea** por servicio:

- **ELB**: reparte el tráfico entre varias instancias. **Auto Scaling**: añade o quita instancias según la demanda.
- **Lambda**: ejecuta código en respuesta a eventos, sin servidores. **ECS/EKS/Fargate**: contenedores.
- **CloudWatch**: métricas, registros y alarmas. **CloudFormation**: infraestructura como código.
- **SQS**: colas de mensajes. **SNS**: avisos a suscriptores. **API Gateway**: puerta de entrada de APIs.
- **Direct Connect**: conexión física dedicada a AWS. **VPN**: túnel cifrado por internet.
- **Snowball**: dispositivo físico para mover muchos TB. **Storage Gateway**: puente entre tu centro de datos y S3.
`,
        '🗺️',
      ),
      mc('**[Dominio 3 · Tecnología y servicios]** Quieres ejecutar una función cuando se sube un archivo a S3, sin gestionar servidores. ¿Qué usas?', ['Amazon EC2', 'AWS Lambda', 'AWS Direct Connect', 'Amazon RDS'], 1, 'Lambda ejecuta código en respuesta a eventos, y solo pagas por ejecución.'),
      mc('**[Dominio 3 · Tecnología y servicios]** Necesitas guardar millones de imágenes de forma duradera y barata, accesibles por HTTP. ¿Qué eliges?', ['Amazon EBS', 'Amazon S3', 'Instance store', 'Amazon RDS'], 1, 'S3 es almacenamiento de objetos duradero, ilimitado y barato.'),
      mc('**[Dominio 3 · Tecnología y servicios]** ¿Qué servicio reparte el tráfico entrante entre varias instancias EC2 de varias zonas?', ['Elastic Load Balancing', 'Amazon CloudFront', 'AWS Shield', 'Amazon SQS'], 0, 'ELB distribuye el tráfico y comprueba la salud de los destinos.'),
      mc('**[Dominio 3 · Tecnología y servicios]** Una aplicación necesita una base de datos clave-valor con latencia de milisegundos y sin administrar servidores. ¿Qué eliges?', ['Amazon DynamoDB', 'Amazon Redshift', 'Amazon RDS for Oracle', 'Amazon Neptune'], 0, 'DynamoDB es NoSQL gestionada y sin servidores.'),
      mc('**[Dominio 3 · Tecnología y servicios]** Quieres que tu web estática cargue más rápido para usuarios de todo el mundo. ¿Qué añades?', ['Amazon CloudFront', 'AWS Backup', 'AWS Snowball', 'Amazon Macie'], 0, 'CloudFront cachea el contenido en ubicaciones de borde cercanas al usuario.'),
      mc('**[Dominio 3 · Tecnología y servicios]** ¿Qué servicio permite definir tu infraestructura (EC2, VPC, bases de datos…) en plantillas y desplegarla de forma repetible?', ['AWS CloudFormation', 'Amazon Route 53', 'AWS Artifact', 'Amazon SNS'], 0, 'CloudFormation es infraestructura como código.'),
      mc('**[Dominio 3 · Tecnología y servicios]** Tienes 80 TB de datos que mover a AWS y tu conexión es lentísima. ¿Qué usas?', ['AWS Snowball', 'Una VPN sobre internet', 'Amazon CloudFront', 'AWS Shield'], 0, 'Los dispositivos Snow transportan datos físicamente cuando la red no basta.'),
      mc('**[Dominio 3 · Tecnología y servicios]** Quieres traducir `www.ejemplo.com` en la IP de tu servidor y dirigir el tráfico según la salud de los destinos. ¿Qué usas?', ['Amazon Route 53', 'Amazon VPC', 'AWS IAM', 'Amazon EBS'], 0, 'Route 53 es el DNS de AWS y permite políticas de enrutamiento y comprobaciones de salud.'),
      mc('**[Dominio 3 · Tecnología y servicios]** ¿Qué hace que una subred sea «pública» en una VPC?', ['Su nombre', 'Una ruta 0.0.0.0/0 hacia una internet gateway', 'Que tenga muchas IP', 'Que use un NAT gateway'], 1, 'La ruta a la internet gateway diferencia una subred pública de una privada.'),
      mc('**[Dominio 3 · Tecnología y servicios]** Quieres una base de datos relacional gestionada con alta disponibilidad en dos zonas. ¿Qué configuras?', ['Una réplica de lectura', 'RDS con Multi-AZ', 'Un snapshot diario', 'Un bucket de S3'], 1, 'Multi-AZ mantiene una copia síncrona en otra zona y conmuta automáticamente.'),
      mc('**[Dominio 3 · Tecnología y servicios]** ¿Qué servicio mide la utilización de CPU de tus instancias y puede disparar una alarma?', ['Amazon CloudWatch', 'AWS CloudTrail', 'AWS Artifact', 'Amazon Macie'], 0, 'CloudWatch recoge métricas, registros y alarmas.'),
      // ───── Dominio 4 ─────
      mc('**[Dominio 4 · Facturación, precios y soporte]** ¿Qué modelo de compra de EC2 es el más barato para cargas tolerantes a interrupciones (procesamiento por lotes)?', ['On-Demand', 'Spot', 'Dedicated Host', 'Savings Plans con compromiso de 3 años'], 1, 'Spot ofrece hasta ~90 % de descuento a cambio de que AWS pueda interrumpir la instancia.'),
      mc('**[Dominio 4 · Facturación, precios y soporte]** ¿Qué herramienta estima el coste de una arquitectura **antes** de construirla?', ['Calculadora de precios de AWS', 'Cost Explorer', 'AWS Budgets', 'AWS Health'], 0, 'La calculadora de precios sirve para presupuestar cargas que aún no existen.'),
      mc('**[Dominio 4 · Facturación, precios y soporte]** Una empresa con 15 cuentas quiere una sola factura y descuentos por volumen. ¿Qué usa?', ['AWS Organizations con facturación consolidada', 'AWS Config', 'Amazon Inspector', 'AWS Trusted Advisor'], 0, 'Organizations suma el uso de todas las cuentas y emite una única factura.'),
      mc('**[Dominio 4 · Facturación, precios y soporte]** ¿Qué plan de soporte incluye un gestor técnico de cuenta (TAM)?', ['Developer', 'Business', 'Enterprise', 'Basic'], 2, 'El TAM está incluido en los planes Enterprise (en Enterprise On-Ramp, en un pool compartido).'),
      mc('**[Dominio 4 · Facturación, precios y soporte]** Quieres repartir la factura entre los equipos «ventas» y «marketing». ¿Qué haces?', ['Cambiar de región', 'Etiquetar los recursos y activar las etiquetas de asignación de costes', 'Contratar soporte Enterprise', 'Usar una sola cuenta sin etiquetas'], 1, 'Las etiquetas activadas permiten agrupar la factura por equipo o proyecto.'),
      multi('**[Dominio 4 · Facturación, precios y soporte]** Marca las formas de **reducir** la factura de EC2 para una carga estable 24/7.', ['Savings Plans o instancias reservadas', 'Ajustar el tamaño de la instancia (rightsizing)', 'Dejar encendidas instancias sin usar', 'Usar On-Demand siempre'], [0, 1], 'Compromisos y dimensionamiento correcto reducen el coste. Dejar recursos sin usar o pagar siempre On-Demand lo aumentan.'),
      tf('**[Dominio 4 · Facturación, precios y soporte]** «Trusted Advisor completo (todas las comprobaciones) está disponible en el plan de soporte Basic.»', false, 'Las comprobaciones completas requieren Business o superior.'),
      practice({
        prompt: 'Último reto del simulacro, en la cuenta con plan Business: Trusted Advisor marca dos problemas de **seguridad**:\n\n1. El security group **`ssh-abierto`** deja el **puerto 22 abierto a todo internet** (`0.0.0.0/0`).\n2. El bucket **`datos-publicos`** tiene una política pública y **no tiene Block Public Access**.\n\nArréglalos: **revoca** la regla de SSH y **activa los cuatro bloqueos** de Block Public Access en el bucket.',
        goal: 'Comprobaciones de seguridad en verde',
        setup: A('soporte'),
        check: all(
          awsIs('support describe-trusted-advisor-check-result --check-id HCP4007jGY --query result.status', 'ok', 'El security group sigue con el 22 abierto al mundo'),
          awsIs('support describe-trusted-advisor-check-result --check-id Pfx0RwqBli --query result.status', 'ok', 'El bucket público sigue marcado'),
        ),
        solution: ['SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=ssh-abierto --query "SecurityGroups[0].GroupId" --output text)', 'aws ec2 revoke-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 0.0.0.0/0', 'aws s3api put-public-access-block --bucket datos-publicos --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'],
        hints: ['`aws ec2 revoke-security-group-ingress --group-id <sg> --protocol tcp --port 22 --cidr 0.0.0.0/0`', '`aws s3api put-public-access-block --bucket datos-publicos --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`'],
        explain: 'Cerrar el SSH al mundo y activar Block Public Access son dos de las correcciones más importantes de cualquier cuenta. Trusted Advisor las detecta; tú las aplicas.',
        par: 3,
        commands: ['Trusted Advisor', 'Block Public Access'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Misión final de costes: la cuenta de la tienda gasta **demasiado**. La dirección pide bajar la factura mensual estimada a **340 USD o menos** sin tocar producción. Debes **mantener**:\n\n- la instancia `web-prod` (encendida), y\n- la base de datos `tienda-prod` (disponible).\n\nPuedes recortar todo lo demás: el servidor olvidado `batch-olvidado`, el disco huérfano, la IP elástica sin usar, el NAT gateway de desarrollo (y su IP) y la base de datos de desarrollo `tienda-dev` (bórrala sin copia final o párala).\n\nComprueba antes y después con la previsión de costes.',
    goal: 'Gasto mensual estimado ≤ 340 USD con producción intacta',
    setup: A('factura'),
    check: all(
      awsIs('_check burn --max 340 --query Ok', true, 'El gasto mensual estimado todavía supera los 340 USD'),
      awsIs('ec2 describe-instances --filters Name=tag:Name,Values=web-prod --query "Reservations[0].Instances[0].State.Name"', 'running', 'web-prod debe seguir encendida'),
      awsIs('rds describe-db-instances --db-instance-identifier tienda-prod --query "DBInstances[0].DBInstanceStatus"', 'available', 'tienda-prod debe seguir disponible'),
    ),
    solution: [
      ID_OF('batch-olvidado'),
      'aws ec2 terminate-instances --instance-ids $ID',
      'VOL=$(aws ec2 describe-volumes --filters Name=status,Values=available --query "Volumes[0].VolumeId" --output text)',
      'aws ec2 delete-volume --volume-id $VOL',
      IDLE,
      'aws ec2 release-address --allocation-id $IDLE',
      'NAT=$(aws ec2 describe-nat-gateways --query "NatGateways[0].NatGatewayId" --output text)',
      'ALLOC=$(aws ec2 describe-nat-gateways --nat-gateway-ids $NAT --query "NatGateways[0].NatGatewayAddresses[0].AllocationId" --output text)',
      'aws ec2 delete-nat-gateway --nat-gateway-id $NAT',
      'aws ec2 release-address --allocation-id $ALLOC',
      'aws rds delete-db-instance --db-instance-identifier tienda-dev --skip-final-snapshot',
    ],
    hints: [
      'Lo que más pesa es la base de datos `tienda-dev` (Multi-AZ y de clase grande): `aws rds delete-db-instance --db-instance-identifier tienda-dev --skip-final-snapshot` (o `stop-db-instance`).',
      'Después recorta lo huérfano: `terminate-instances` de `batch-olvidado`, `delete-volume` del disco sin conectar y `release-address` de las IP sin asociar.',
      'El NAT gateway cuesta unos 37 USD al mes: bórralo y **libera su IP elástica** (queda suelta al borrarlo) para que no siga cobrando.',
    ],
    explain: 'Ordenaste el gasto de mayor a menor impacto: bases de datos de desarrollo, servidores olvidados, NAT, discos e IP. Con etiquetas (`Entorno=dev`) y un presupuesto con alertas, esta limpieza se vuelve un hábito mensual en vez de una emergencia.',
    commands: ['Recursos huérfanos', 'Cost Explorer', 'NAT gateway'],
  },
});
