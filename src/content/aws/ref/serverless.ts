import type { AwsRef } from '../reference';

const REDRIVE = String.raw`echo '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:123456789012:trabajos-dlq\",\"maxReceiveCount\":\"2\"}"}' > redrive.json`;
const SNS_FILTER = String.raw`echo '{"FilterPolicy":"{\"tipo\":[\"fisico\"]}"}' > filtro.json`;
const SQS_POLICY = String.raw`echo '{"Policy":"{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"sns.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"arn:aws:sqs:us-east-1:123456789012:envios\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"arn:aws:sns:us-east-1:123456789012:pedidos\"}}}]}"}' > politica.json`;
const TOPIC = 'arn:aws:sns:us-east-1:123456789012:pedidos';
const ENVIOS = 'arn:aws:sqs:us-east-1:123456789012:envios';
const S3CONF = '{"LambdaFunctionConfigurations":[{"Id":"miniaturas","LambdaFunctionArn":"arn:aws:lambda:us-east-1:123456789012:function:miniatura","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"suffix","Value":".jpg"}]}}}]}';

export const AWS_REF_SERVERLESS: AwsRef[] = [
  {
    name: 'AWS Lambda',
    kind: 'servicio',
    category: 'integracion',
    level: 2,
    summary: 'Ejecuta tu código (una función) en respuesta a un evento, sin servidores que gestionar. Pagas por petición y por milisegundo de ejecución; si nadie la llama, no pagas nada.',
    details: `
Una función tiene un **handler** (\`archivo.funcion\`), un **runtime** (python3.12, nodejs20.x…), una **memoria** (128 MB – 10 GB, y con ella la CPU), un **tiempo máximo** (hasta 15 minutos) y un **rol de ejecución**.

\`\`\`python
def lambda_handler(event, context):
    return {'mensaje': 'hola'}
\`\`\`

- El \`event\` es un JSON que cambia según quién llama (API Gateway, SQS, S3, EventBridge…). \`context\` trae el id de la petición y cuánto tiempo queda.
- **Dos permisos distintos**: el **rol de ejecución** dice qué puede hacer la función (leer DynamoDB, escribir logs…); la **política de recursos** dice quién puede invocarla (API Gateway, S3, SNS…).
- Todo lo que escribes con \`print\` va a **CloudWatch Logs** (\`/aws/lambda/<nombre>\`)… solo si el rol puede escribir en logs.
- Los entornos de ejecución se **reutilizan** entre peticiones: lo que declaras fuera del handler (conexiones, clientes de boto3) se conserva. La primera petición paga un **arranque en frío**.
- Una invocación \`RequestResponse\` espera el resultado; una \`Event\` es asíncrona (Lambda reintenta 2 veces y puedes configurar un destino para los fallos).
- El tamaño del paquete \`.zip\` puede ser de hasta 50 MB (250 MB descomprimido); más allá, usa imágenes de contenedor o capas.
`,
    whenUse: ['APIs y backends con tráfico irregular o desconocido', 'Procesar eventos: subidas a S3, mensajes de una cola, cambios en una tabla', 'Tareas programadas y automatización de la cuenta'],
    whenNot: ['Procesos de más de 15 minutos o que necesitan estado en memoria entre peticiones', 'Cargas constantes y muy altas: un contenedor o una instancia suele salir más barato', 'Aplicaciones que necesitan conexiones persistentes (WebSockets largos sin API Gateway)'],
    pricing: 'Por millón de peticiones y por GB-segundo (memoria × duración, redondeada al milisegundo). 1 millón de peticiones y 400.000 GB-s al mes gratis. La concurrencia aprovisionada se cobra aparte, aunque nadie llame.',
    limits: ['Tiempo máximo: 900 s', 'Memoria: 128 MB – 10.240 MB (1 vCPU a 1.769 MB)', '1.000 ejecuciones simultáneas por región (ampliable)', 'Carga útil síncrona: 6 MB'],
    scenario: 'srv-lambda-demo',
    examples: [
      ['aws lambda list-functions --query "Functions[].[FunctionName,Runtime,MemorySize,Timeout]" --output table', 'Las funciones de la cuenta con su configuración'],
      ['aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{"nombre":"Ana"}\' respuesta.json', 'Invocación síncrona: devuelve el estado'],
      ['cat respuesta.json', 'El resultado de la función'],
      ['aws lambda get-function-configuration --function-name saludo --query "{Handler:Handler,Rol:Role}"', 'Handler y rol de ejecución'],
    ],
    seeAlso: ['Arranque en frío (cold start)', 'Concurrencia de Lambda', 'Rol de ejecución y política de recursos', 'aws lambda create-function', 'aws lambda invoke'],
  },
  {
    name: 'Arranque en frío (cold start)',
    kind: 'concepto',
    category: 'integracion',
    level: 2,
    summary: 'El tiempo extra que tarda la primera petición a una función «fría»: crear el entorno, descargar el código e importar tus librerías. Aparece como `Init Duration` en el informe de la ejecución.',
    details: `
Lambda mantiene el entorno de ejecución vivo unos **5–15 minutos** tras una petición. La siguiente reutiliza el entorno («caliente») y se salta la inicialización. Se vuelve a «frío» cuando:

- pasa un rato sin peticiones,
- cambias el código o la configuración,
- llegan más peticiones simultáneas que entornos calientes (Lambda crea más).

Cómo reducirlo: paquetes pequeños, **importar y crear clientes fuera del handler**, más memoria (más CPU en la inicialización), **concurrencia aprovisionada** (entornos siempre listos, con coste fijo) o runtimes que arrancan rápido.

En la línea \`REPORT\` de los logs verás \`Duration\` (tu código) y, solo en arranques en frío, \`Init Duration\` (la preparación).
`,
    whenUse: ['Entender por qué la primera petición tras un rato parado es más lenta'],
    whenNot: ['Para una API con latencia crítica y tráfico bajo, no lo ignores: considera la concurrencia aprovisionada'],
    scenario: 'srv-lambda-demo',
    examples: [
      ['aws lambda invoke --function-name saludo --log-type Tail --query LogResult --output text salida.json | base64 -d | grep REPORT', 'Primera vez: aparece Init Duration'],
      ['aws lambda invoke --function-name saludo --log-type Tail --query LogResult --output text salida.json | base64 -d | grep REPORT', 'Segunda vez: el entorno estaba caliente y no hay Init Duration'],
    ],
    seeAlso: ['AWS Lambda', 'Concurrencia de Lambda'],
  },
  {
    name: 'Concurrencia de Lambda',
    kind: 'concepto',
    category: 'integracion',
    level: 3,
    summary: 'Cuántas ejecuciones de funciones pueden estar activas a la vez. Se comparte por región (1.000 por defecto): puedes reservar una parte para una función (y ponerle techo) o mantener entornos calientes.',
    details: `
- **Concurrencia no reservada**: el fondo común de la cuenta. Una función descontrolada puede agotarlo y dejar sin ejecutar a las demás (_throttling_).
- **Concurrencia reservada** (\`put-function-concurrency\`): garantiza que esa función dispone de N ejecuciones **y a la vez limita** que no pase de N. Con **0** la función queda desactivada (cada invocación se rechaza): es el «interruptor de emergencia».
- **Concurrencia aprovisionada**: N entornos ya inicializados para una versión o un alias; elimina el arranque en frío y se paga siempre.
- Cuando se supera el límite, las invocaciones síncronas reciben \`TooManyRequestsException\` (429); las asíncronas y las de colas se reintentan.
`,
    whenUse: ['Proteger una base de datos limitando cuántas conexiones puede abrir una función', 'Garantizar capacidad a una función crítica', 'Parar una función de golpe (reserva 0)'],
    whenNot: ['No la uses para «hacer más rápida» una función: solo controla cuántas corren a la vez'],
    pricing: 'La reservada es gratis. La aprovisionada se cobra por GB-s de entorno reservado, se use o no.',
    scenario: 'srv-lambda-demo',
    examples: [
      ['aws lambda get-account-settings --query AccountLimit', 'Los límites de la cuenta'],
      ['aws lambda put-function-concurrency --function-name saludo --reserved-concurrent-executions 5', 'Reserva (y techo) de 5 ejecuciones'],
      ['aws lambda put-function-concurrency --function-name saludo --reserved-concurrent-executions 0', 'Con 0 la función no se ejecuta'],
      ['aws lambda invoke --function-name saludo respuesta.json', 'Rechazada: TooManyRequestsException', 'error'],
    ],
    seeAlso: ['AWS Lambda', 'Arranque en frío (cold start)'],
  },
  {
    name: 'Rol de ejecución y política de recursos',
    kind: 'concepto',
    category: 'integracion',
    level: 2,
    summary: 'Los dos permisos de una función Lambda: el rol de ejecución (lo que ELLA puede hacer) y su política de recursos (quién puede INVOCARLA).',
    details: `
| | Rol de ejecución | Política de recursos |
|---|---|---|
| Responde a | ¿Qué puede hacer mi función? | ¿Quién puede llamar a mi función? |
| Dónde | IAM (rol con confianza en \`lambda.amazonaws.com\`) | La propia función (\`add-permission\`) |
| Ejemplo | \`dynamodb:PutItem\` sobre una tabla; \`logs:*\` | API Gateway, S3, SNS, EventBridge |
| Si falta | La función se ejecuta y falla dentro (AccessDenied en sus logs) | El servicio no puede invocarla (500 en la API, evento perdido) |

Los servicios que **te invocan a ti** (API Gateway, S3, SNS, EventBridge) necesitan la política de recursos. Los que **tú lees** con un _event source mapping_ (SQS, DynamoDB Streams, Kinesis) los consulta Lambda con **tu rol**, así que el rol debe poder leer la cola.

La política de recursos admite condiciones: \`--source-arn\` limita a **qué** API, bucket o regla concreta; \`--source-account\` evita que otro usuario use tu función desde su cuenta.
`,
    whenUse: ['Cuando una API devuelve 500 sin que la función haya registrado nada: falta la política de recursos', 'Cuando la función falla con AccessDeniedException: falta algo en el rol'],
    scenario: 'srv-lambda-demo',
    examples: [
      ['aws lambda get-function-configuration --function-name saludo --query Role --output text', 'El rol de ejecución de la función'],
      ['aws lambda add-permission --function-name saludo --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:123456789012:abc123def4/*/*/*"', 'Dejar que una API concreta la invoque'],
      ['aws lambda get-policy --function-name saludo --query Policy --output text', 'La política de recursos resultante'],
    ],
    seeAlso: ['AWS Lambda', 'aws lambda add-permission', 'Amazon API Gateway'],
  },
  {
    name: 'Amazon API Gateway',
    kind: 'servicio',
    category: 'integracion',
    level: 2,
    summary: 'La «puerta» pública de tu backend: recibe peticiones HTTP, comprueba rutas y autenticación, y las pasa a una función Lambda (u otro destino). Las APIs HTTP son la opción simple y barata.',
    details: `
Tipos: **API HTTP** (ligera, más barata, JWT y Lambda: lo habitual), **API REST** (más funciones: claves de uso, planes, caché, validación) y **WebSocket**.

Piezas de una API HTTP:

- **Ruta** (\`GET /productos\`, \`POST /productos/{id}\`, \`$default\`): qué petición llega.
- **Integración**: a dónde va (\`AWS_PROXY\` a una función Lambda con formato **2.0**).
- **Etapa** (\`$default\`, \`prod\`): una versión publicada, con su URL base. Hay que **desplegarla** (o activar _auto-deploy_).
- **Autorizador**: **JWT** (Cognito u otro OIDC), Lambda o IAM.

Con la integración proxy la función recibe la petición entera y debe devolver \`{"statusCode": 200, "headers": {…}, "body": "texto"}\` (el \`body\` **siempre una cadena**). Si no, API Gateway responde \`500 Internal Server Error\`.

Errores típicos: **404** (ruta o etapa inexistente), **401** (token ausente o no válido), **403** (autorizador o política), **500** (falta \`add-permission\`, la función lanza una excepción o la respuesta está mal formada), **429** (límite de peticiones).
`,
    whenUse: ['Exponer una función Lambda como una API HTTP', 'Autenticar con Cognito/JWT sin escribir código'],
    whenNot: ['Si solo necesitas una URL para una función, la _Function URL_ de Lambda es más simple', 'Para servir páginas estáticas: S3 + CloudFront'],
    pricing: 'Por millón de peticiones (la API HTTP cuesta alrededor de una tercera parte que la REST). Los datos salientes se cobran aparte.',
    limits: ['Tiempo máximo de integración: 30 s (HTTP API)', 'Carga útil: 10 MB'],
    scenario: 'srv-api-500',
    examples: [
      ['aws apigatewayv2 get-apis --query "Items[].[Name,ApiEndpoint]" --output text', 'La URL base de la API'],
      ['aws apigatewayv2 get-routes --api-id $(aws apigatewayv2 get-apis --query "Items[0].ApiId" --output text) --query "Items[].[RouteKey,Target]" --output text', 'Rutas e integraciones'],
      ['curl -s -o /dev/null -w "%{http_code}\\n" "$(aws apigatewayv2 get-apis --query "Items[0].ApiEndpoint" --output text)/prod/productos"', '500: la integración existe pero la función no admite a API Gateway'],
    ],
    seeAlso: ['aws apigatewayv2 create-api', 'Rol de ejecución y política de recursos', 'Amazon Cognito', 'Colas, temas, eventos y flujos'],
  },
  {
    name: 'Amazon SQS',
    kind: 'servicio',
    category: 'integracion',
    level: 2,
    summary: 'Cola de mensajes gestionada: un productor deja mensajes y uno o varios consumidores los procesan a su ritmo. Desacopla servicios y absorbe los picos de carga.',
    details: `
- **Estándar**: casi ilimitada, entrega **al menos una vez** (puede haber duplicados) y sin garantía de orden. **FIFO** (nombre acabado en \`.fifo\`): orden por grupo y sin duplicados, hasta 300 msg/s (3.000 en lote).
- Al **recibir** un mensaje queda oculto durante el **tiempo de visibilidad**; si no lo **borras** (\`delete-message\`) antes de que acabe, vuelve a verse y se reentrega. Con Lambda, el borrado lo hace Lambda si la función termina bien.
- **Long polling** (\`--wait-time-seconds 20\`): menos llamadas vacías y menos coste.
- **Retención** de 1 minuto a 14 días (4 por defecto). **Tamaño** hasta 256 KB (para más, guarda el dato en S3 y envía su clave).
- Una **cola de mensajes muertos** recoge los mensajes que fallan demasiadas veces.
- El cifrado en reposo con SSE viene activado; las políticas de la cola (\`Policy\`) controlan quién puede enviar (SNS, EventBridge y S3 necesitan una).
`,
    whenUse: ['Desacoplar un productor rápido de un consumidor lento', 'Suavizar picos: la cola crece y los consumidores la vacían a su ritmo', 'Reintentar trabajos fallidos sin perderlos'],
    whenNot: ['Si necesitas que muchos consumidores reciban el mismo mensaje: SNS o EventBridge (con colas detrás)', 'Si el orden estricto y sin duplicados es esencial y el volumen es alto: FIFO con cuidado, o un flujo de datos (Kinesis)'],
    pricing: 'Por millón de peticiones (envío, recepción, borrado). 1 millón gratis al mes. Los lotes de hasta 10 mensajes cuentan como una petición.',
    limits: ['Mensaje: 256 KB', 'Visibilidad máxima: 12 horas', 'Lote: 10 mensajes'],
    scenario: 'base',
    examples: [
      ['aws sqs create-queue --queue-name pedidos --attributes VisibilityTimeout=60', 'Cola con 60 s de visibilidad'],
      ['Q=$(aws sqs get-queue-url --queue-name pedidos --query QueueUrl --output text)'],
      ['aws sqs send-message --queue-url $Q --message-body \'{"pedido":1}\' --query MessageId --output text', 'Enviar un mensaje'],
      ['aws sqs receive-message --queue-url $Q --query "Messages[0].Body" --output text', 'Recibirlo (queda oculto 60 s)'],
      ['aws sqs get-queue-attributes --queue-url $Q --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible', 'Uno en vuelo y ninguno visible'],
    ],
    seeAlso: ['Cola de mensajes muertos (DLQ)', 'Amazon SNS', 'Colas, temas, eventos y flujos', 'aws lambda create-event-source-mapping'],
  },
  {
    name: 'Cola de mensajes muertos (DLQ)',
    kind: 'concepto',
    category: 'integracion',
    level: 2,
    summary: 'Una cola aparte donde SQS aparta los mensajes que se han recibido `maxReceiveCount` veces sin borrarse, para que un mensaje «veneno» no bloquee el trabajo ni se reintente eternamente.',
    details: `
Se configura en la cola **de origen** con una \`RedrivePolicy\`:

\`{"deadLetterTargetArn": "arn:aws:sqs:…:trabajos-dlq", "maxReceiveCount": "3"}\`

- La DLQ debe ser **del mismo tipo** (estándar con estándar, FIFO con FIFO) y estar en la misma región y cuenta.
- Dale una **retención más larga** (14 días) que a la cola de origen: el reloj de retención sigue corriendo desde el envío original.
- Pon una **alarma** en \`ApproximateNumberOfMessagesVisible\` de la DLQ: si tiene mensajes, algo falla.
- Cuando arregles el fallo, **redrive** devuelve los mensajes a la cola de origen.
- Con Lambda, una excepción en el lote devuelve **todo el lote** a la cola: usa un tamaño de lote pequeño o \`ReportBatchItemFailures\` para devolver solo los mensajes que fallaron.
- Las funciones Lambda y los temas SNS también admiten una DLQ propia para invocaciones asíncronas fallidas.
`,
    whenUse: ['Siempre que haya consumidores que puedan fallar con datos malformados', 'Para investigar mensajes problemáticos sin perderlos'],
    scenario: 'srv-veneno',
    examples: [
      ['aws sqs create-queue --queue-name trabajos-dlq', 'La cola donde irán a parar los mensajes problemáticos'],
      [REDRIVE, 'La política de reenvío (se guarda en un archivo para evitar comillas anidadas)'],
      ['aws sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/trabajos --attributes file://redrive.json', 'Tras 2 recepciones fallidas, el mensaje pasa a la DLQ'],
      ['aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/trabajos --attribute-names RedrivePolicy --query Attributes.RedrivePolicy --output text'],
    ],
    seeAlso: ['Amazon SQS', 'aws lambda create-event-source-mapping'],
  },
  {
    name: 'Amazon SNS',
    kind: 'servicio',
    category: 'integracion',
    level: 2,
    summary: 'Tema de publicación/suscripción: publicas un mensaje y SNS lo reparte a todos los suscriptores (colas SQS, funciones Lambda, correo, SMS, HTTP). Es el «fan-out» clásico.',
    details: `
- Un **tema** tiene **suscripciones**; cada una puede llevar una **política de filtro** (\`{"tipo": ["fisico"]}\`) para recibir solo algunos mensajes según sus **atributos**.
- **SNS → SQS** es el patrón estándar: cada servicio tiene su cola y consume a su ritmo. La cola necesita una **política** que permita a \`sns.amazonaws.com\` enviar desde ese tema; sin ella los mensajes se pierden **sin avisar**.
- **SNS → Lambda**: la función necesita el permiso en su política de recursos (\`--principal sns.amazonaws.com\`).
- \`RawMessageDelivery=true\` entrega el mensaje tal cual, sin el sobre JSON de SNS.
- Los temas **FIFO** se combinan con colas FIFO para orden y duplicados controlados.
`,
    whenUse: ['Avisar a varios sistemas del mismo hecho (pedido creado → facturación, envíos, analítica)', 'Notificaciones a personas (correo, SMS)'],
    whenNot: ['Si necesitas enrutar por el contenido de eventos de muchos servicios: EventBridge', 'Si un solo consumidor debe procesar cada mensaje con reintentos: SQS directamente'],
    pricing: 'Por millón de publicaciones; las entregas a SQS y Lambda son gratis; correo, SMS y HTTP se cobran por entrega.',
    scenario: 'srv-fanout',
    examples: [
      ['aws sns list-topics --query "Topics[].TopicArn" --output text', 'El tema de la tienda'],
      [`aws sns publish --topic-arn ${TOPIC} --message "hola" --message-attributes 'tipo={DataType=String,StringValue=fisico}' --query MessageId --output text`, 'Publicar un mensaje con un atributo'],
      [`aws sns subscribe --topic-arn ${TOPIC} --protocol sqs --notification-endpoint ${ENVIOS} --query SubscriptionArn --output text`, 'Suscribir una cola (aún sin su política)'],
    ],
    seeAlso: ['Amazon SQS', 'Colas, temas, eventos y flujos', 'aws sns publish'],
  },
  {
    name: 'Amazon EventBridge',
    kind: 'servicio',
    category: 'integracion',
    level: 2,
    summary: 'Bus de eventos: servicios y aplicaciones publican eventos y las reglas los encaminan, según su contenido o a una hora, hacia funciones, colas, máquinas de estados y más.',
    details: `
- Un **evento** es un JSON con \`source\`, \`detail-type\` y \`detail\`. Los servicios de AWS publican los suyos (EC2 cambia de estado, S3 crea un objeto…) y tú los tuyos con \`put-events\`.
- Una **regla** tiene un **patrón de evento** (qué eventos le interesan) o una **programación** (\`rate(5 minutes)\`, \`cron(0 8 * * ? *)\`) y hasta cinco **destinos**.
- Los patrones comparan por igualdad (\`"source": ["tienda.pedidos"]\`) y admiten \`prefix\`, \`anything-but\`, \`numeric\` (\`[">", 100]\`), \`exists\`. Un evento puede coincidir con **varias reglas** a la vez.
- Cada destino necesita permiso: una función necesita su política de recursos; una cola, una política que admita a \`events.amazonaws.com\` (si pones la condición del ARN de la regla, el **nombre de la regla** debe coincidir).
- Los eventos que no coinciden con ninguna regla se descartan. Puedes reintentar y enviar los fallos a una DLQ.
`,
    whenUse: ['Reaccionar a cambios en tu cuenta de AWS sin sondear', 'Tareas programadas (el «cron» de la nube)', 'Enrutar por contenido eventos de varios servicios'],
    whenNot: ['Cuando solo hay un productor y un consumidor: una cola es más simple', 'Para flujos con muchos pasos y estado: Step Functions'],
    pricing: 'Por millón de eventos personalizados publicados; los eventos de servicios de AWS en el bus por defecto son gratis.',
    scenario: 'srv-eventos',
    examples: [
      ['aws events test-event-pattern --event-pattern \'{"source":["tienda.pedidos"],"detail":{"total":[{"numeric":[">",100]}]}}\' --event \'{"source":"tienda.pedidos","detail-type":"PedidoCreado","detail":{"total":250},"region":"us-east-1"}\' --query Result', 'El patrón encaja con un pedido de 250'],
      ['aws events put-rule --name pedidos-grandes --event-pattern \'{"source":["tienda.pedidos"],"detail":{"total":[{"numeric":[">",100]}]}}\' --query RuleArn --output text', 'Crear la regla'],
      ['aws events put-targets --rule pedidos-grandes --targets Id=1,Arn=arn:aws:sqs:us-east-1:123456789012:grandes', 'Destino: la cola grandes'],
      ['aws events list-rules --query "Rules[].[Name,State]" --output text'],
    ],
    seeAlso: ['aws events put-events', 'Colas, temas, eventos y flujos', 'AWS Step Functions'],
  },
  {
    name: 'AWS Step Functions',
    kind: 'servicio',
    category: 'integracion',
    level: 3,
    summary: 'Orquesta varios pasos (funciones, colas, tablas…) como una máquina de estados con decisiones, reintentos, esperas y manejo de errores, en lugar de encadenar funciones a mano.',
    details: `
Se define en **Amazon States Language** (JSON). Estados principales:

- **Task**: ejecuta algo (una función Lambda, o con \`arn:aws:states:::sqs:sendMessage\`, \`dynamodb:putItem\`… sin escribir código).
- **Choice**: decide según los datos (\`$.valido == true\`). **Wait**: espera. **Parallel** y **Map**: ramas simultáneas / uno por elemento.
- **Pass**, **Succeed**, **Fail**.
- **Retry** (con \`IntervalSeconds\`, \`MaxAttempts\`, \`BackoffRate\`) y **Catch** (a qué estado ir si sigue fallando) hacen el flujo robusto.

La salida de cada estado es la entrada del siguiente. La **máquina** usa un **rol** propio: debe poder invocar cada cosa que llama.

Tipos: **Standard** (hasta 1 año, historial completo, «exactamente una vez», se cobra por transición) y **Express** (hasta 5 minutos, mucho volumen, «al menos una vez», se cobra por duración).

El historial de una ejecución (\`get-execution-history\`) indica qué estado falló, con qué entrada y por qué.
`,
    whenUse: ['Procesos de varios pasos con decisiones y reintentos (pedidos, aprobaciones, ETL)', 'Esperas largas (días) sin mantener nada encendido', 'Cuando quieres ver y auditar por dónde pasó cada ejecución'],
    whenNot: ['Un único paso: llama a la función directamente', 'Flujos de datos continuos de alto volumen: Kinesis / Express con cuidado'],
    pricing: 'Standard: por transición de estado. Express: por número de ejecuciones y duración/memoria.',
    scenario: 'srv-sfn',
    examples: [
      ['aws stepfunctions create-state-machine --name hola --definition \'{"StartAt":"Saludar","States":{"Saludar":{"Type":"Pass","Result":"hola","End":true}}}\' --role-arn arn:aws:iam::123456789012:role/sfn-role --query stateMachineArn --output text', 'La máquina más pequeña posible'],
      ['aws stepfunctions start-execution --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:hola --name primera --query executionArn --output text'],
      ['aws stepfunctions describe-execution --execution-arn arn:aws:states:us-east-1:123456789012:execution:hola:primera --query "[status,output]" --output text', 'Estado y salida'],
    ],
    seeAlso: ['aws stepfunctions start-execution', 'Colas, temas, eventos y flujos', 'AWS Lambda'],
  },
  {
    name: 'Amazon Cognito',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Registro e inicio de sesión de usuarios de tu aplicación (grupos de usuarios) y credenciales temporales de AWS para ellos (grupos de identidades). Entrega tokens JWT que API Gateway sabe verificar.',
    details: `
- **Grupo de usuarios** (_user pool_): el directorio. Registro, confirmación por correo/SMS, contraseñas con política, MFA, grupos (\`cognito:groups\`), inicio de sesión con Google/Apple…
- **Cliente de aplicación**: cada app (web, móvil) tiene el suyo, con los **flujos** que permite. \`USER_PASSWORD_AUTH\` **no está activado por defecto**; sin él, \`initiate-auth\` falla.
- **Tokens**: \`IdToken\` (quién eres: email, nombre), \`AccessToken\` (qué puedes hacer: ámbitos y grupos) y \`RefreshToken\` (30 días, para pedir otros nuevos). Los dos primeros caducan en **1 hora** por defecto.
- Un JWT lleva \`iss\` (el grupo de usuarios), \`aud\`/\`client_id\` (el cliente), \`exp\` (caducidad) y una **firma**. API Gateway los comprueba sin llamar a Cognito.
- **Grupo de identidades** (_identity pool_): canjea un token (de Cognito u otro proveedor) por **credenciales temporales de IAM** para que la app hable directamente con S3 o DynamoDB.

Autenticación (quién eres) es de Cognito; autorización (qué puedes hacer) la decides tú con grupos, ámbitos o roles de IAM.
`,
    whenUse: ['Login de usuarios de una web o app móvil sin construir tu propio sistema de cuentas', 'Proteger una API HTTP con un autorizador JWT'],
    whenNot: ['Para dar acceso a empleados a la consola de AWS: IAM Identity Center', 'Si ya tienes un proveedor de identidad propio: puedes federarlo, pero valora si Cognito aporta algo'],
    pricing: 'Por usuario activo mensual (con un nivel gratuito generoso); los usuarios federados y las funciones avanzadas de seguridad se cobran aparte.',
    scenario: 'srv-auth',
    examples: [
      ['aws cognito-idp list-user-pools --max-results 10 --query "UserPools[].[Id,Name]" --output text', 'El grupo de usuarios'],
      ['POOL=$(aws cognito-idp list-user-pools --max-results 10 --query "UserPools[0].Id" --output text)'],
      ['aws cognito-idp list-users --user-pool-id $POOL --query "Users[].[Username,UserStatus]" --output text', 'Una usuaria confirmada'],
      ['aws cognito-idp list-user-pool-clients --user-pool-id $POOL --query "UserPoolClients[].[ClientId,ClientName]" --output text'],
    ],
    seeAlso: ['aws cognito-idp initiate-auth', 'Amazon API Gateway'],
  },
  {
    name: 'Notificaciones de eventos de S3',
    kind: 'concepto',
    category: 'integracion',
    level: 2,
    summary: 'Un bucket puede avisar cuando se crea o borra un objeto: dispara una función Lambda, deja un mensaje en una cola SQS, publica en un tema SNS o envía el evento a EventBridge.',
    details: `
Se configura con \`put-bucket-notification-configuration\`. Cada regla indica **eventos** (\`s3:ObjectCreated:*\`, \`s3:ObjectRemoved:Delete\`…), un **filtro** opcional por \`prefix\` y \`suffix\`, y un **destino**.

- **Antes de guardar, S3 comprueba el destino**: la función debe tener un permiso para \`s3.amazonaws.com\` (con el ARN del bucket) y la cola/tema una política que lo admita. Si no: _Unable to validate the following destination configurations_.
- En el evento, el **nombre del objeto va codificado como URL** (espacios como \`+\`): usa \`urllib.parse.unquote_plus\`.
- Las reglas **no pueden solaparse** (mismo evento con prefijos y sufijos que se pisan): _Configuration is ambiguously defined_.
- Al configurar una cola o un tema, S3 envía un mensaje de prueba \`s3:TestEvent\`.
- **Cuidado con el bucle**: una función que escribe en el **mismo bucket** (y prefijo) que la dispara se invoca a sí misma sin parar y puede costar mucho. Escribe en otro bucket o en otro prefijo con filtro. Lambda corta las cadenas recursivas a las 16 invocaciones.
- La entrega es «al menos una vez» y el orden no está garantizado.
`,
    whenUse: ['Procesar archivos al subirlos (miniaturas, antivirus, importar un CSV)', 'Indexar o catalogar objetos nuevos'],
    whenNot: ['Si necesitas reglas complejas o varios destinos por evento: activa EventBridge en el bucket'],
    scenario: 'srv-s3ev',
    examples: [
      ['aws s3api get-bucket-notification-configuration --bucket tienda-fotos-originales', 'Todavía no hay ninguna'],
      [`aws s3api put-bucket-notification-configuration --bucket tienda-fotos-originales --notification-configuration '${S3CONF}'`, 'Falla: la función no admite a S3', 'error'],
      ['aws lambda add-permission --function-name miniatura --statement-id s3 --action lambda:InvokeFunction --principal s3.amazonaws.com --source-arn arn:aws:s3:::tienda-fotos-originales --source-account 123456789012', 'El permiso que faltaba'],
      [`aws s3api put-bucket-notification-configuration --bucket tienda-fotos-originales --notification-configuration '${S3CONF}'`, 'Ahora sí'],
      ['echo FOTO > a.jpg && aws s3 cp a.jpg s3://tienda-fotos-originales/a.jpg', 'Subir una foto dispara la función'],
      ['aws s3 ls s3://tienda-fotos-miniaturas/', 'La miniatura apareció en el otro bucket'],
    ],
    seeAlso: ['AWS Lambda', 'aws s3api put-bucket-notification-configuration', 'Amazon EventBridge'],
  },
  {
    name: 'Colas, temas, eventos y flujos',
    kind: 'comparativa',
    category: 'integracion',
    level: 2,
    summary: 'SQS, SNS, EventBridge y Step Functions resuelven problemas distintos. Elige por quién recibe el mensaje, cuántos consumidores hay y si importa el orden de los pasos.',
    versus: [
      ['SQS', 'Una cola: el productor deja trabajo, los consumidores lo toman y lo borran. Reintentos y DLQ. Un mensaje, un consumidor.'],
      ['SNS', 'Publicación/suscripción: un mensaje a MUCHOS suscriptores a la vez (fan-out), con filtros por atributos.'],
      ['EventBridge', 'Bus de eventos: enruta por el CONTENIDO del evento y por horarios, con integración nativa con casi todos los servicios de AWS.'],
      ['Step Functions', 'Un flujo con estado: pasos en orden, decisiones, reintentos, esperas y errores visibles. Orquesta, no solo transporta.'],
      ['Kinesis / MSK', 'Flujos de datos continuos de gran volumen, con orden por partición y relectura (varios consumidores).'],
    ],
    seeAlso: ['Amazon SQS', 'Amazon SNS', 'Amazon EventBridge', 'AWS Step Functions'],
  },
  // ───────────────────────── comandos ─────────────────────────
  {
    name: 'aws lambda create-function',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws lambda create-function --function-name <n> --runtime python3.12 --role <arn> --handler <archivo.funcion> --zip-file fileb://<zip> [--timeout 10] [--memory-size 256] [--environment Variables={A=1}]',
    summary: 'Crea una función a partir de un `.zip` con el código. El rol debe confiar en `lambda.amazonaws.com`.',
    details: `
El handler es \`nombre_del_archivo.nombre_de_la_función\` (sin \`.py\`): con \`lambda_function.py\` y \`def lambda_handler\`, el handler es \`lambda_function.lambda_handler\`.

Errores frecuentes:

- _The role defined for the function cannot be assumed by Lambda_: el rol no tiene la confianza \`lambda.amazonaws.com\`.
- _Runtime.HandlerNotFound_ al invocar: el handler no coincide con el archivo o la función.
- \`fileb://\` para binarios (el zip); con \`file://\` se rompería.
`,
    scenario: 'srv-lambda',
    examples: [
      ['echo "def lambda_handler(event, context): return {\'ok\': True}" > lambda_function.py && zip fn.zip lambda_function.py', 'Empaquetar el código (hace falta el comando zip)'],
      ['aws lambda create-function --function-name prueba --runtime python3.12 --role arn:aws:iam::123456789012:role/lambda-basico --handler lambda_function.lambda_handler --zip-file fileb://fn.zip --query "[FunctionName,State]" --output text', 'Crear la función'],
      ['aws lambda create-function --function-name prueba --runtime python3.12 --role arn:aws:iam::123456789012:role/lambda-basico --handler lambda_function.lambda_handler --zip-file fileb://fn.zip', 'Ya existe', 'error'],
    ],
    seeAlso: ['AWS Lambda', 'aws lambda invoke'],
  },
  {
    name: 'aws lambda invoke',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws lambda invoke --function-name <n> [--payload \'{"a":1}\' --cli-binary-format raw-in-base64-out] [--log-type Tail] [--invocation-type Event] <archivo-de-salida>',
    summary: 'Ejecuta una función. La respuesta de la función se guarda en el archivo de salida; la CLI imprime el estado. Con `--log-type Tail` devuelve las últimas líneas de log (en base64).',
    details: `
- La CLI v2 espera \`--payload\` en **base64**: añade \`--cli-binary-format raw-in-base64-out\` (o ponlo en \`~/.aws/config\`) para escribir el JSON tal cual.
- \`--invocation-type Event\` lanza la función en segundo plano (devuelve 202); \`DryRun\` solo comprueba permisos.
- \`StatusCode: 200\` no significa que la función haya ido bien: si lanzó una excepción verás \`FunctionError: Unhandled\` y el detalle en el archivo de salida.
- \`/dev/stdout\` como archivo de salida imprime el resultado en pantalla.
`,
    scenario: 'srv-lambda-demo',
    examples: [
      ['aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{"nombre":"Luis"}\' respuesta.json && cat respuesta.json', 'Ejecutar con un evento propio'],
      ['aws lambda invoke --function-name saludo --log-type Tail --query LogResult --output text respuesta.json | base64 -d', 'Ver los logs de esa ejecución'],
      ['aws lambda invoke --function-name saludo --invocation-type Event respuesta.json --query StatusCode', 'Asíncrona: 202'],
    ],
    seeAlso: ['AWS Lambda', 'aws lambda create-function'],
  },
  {
    name: 'aws lambda add-permission',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws lambda add-permission --function-name <n> --statement-id <id> --action lambda:InvokeFunction --principal <servicio> [--source-arn <arn>] [--source-account <cuenta>]',
    summary: 'Añade una frase a la política de recursos de la función para que otro servicio (API Gateway, S3, SNS, EventBridge) pueda invocarla.',
    details: 'Es lo que falta cuando una API devuelve 500 sin que la función haya registrado nada, cuando una regla de EventBridge no dispara o cuando S3 no puede validar la notificación. Usa siempre `--source-arn` para limitar el permiso a un recurso concreto.',
    scenario: 'srv-lambda-demo',
    examples: [
      ['aws lambda add-permission --function-name saludo --statement-id eventos --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:us-east-1:123456789012:rule/cada-hora', 'Permitir a una regla de EventBridge'],
      ['aws lambda get-policy --function-name saludo --query Policy --output text'],
      ['aws lambda remove-permission --function-name saludo --statement-id eventos', 'Retirarlo'],
    ],
    seeAlso: ['Rol de ejecución y política de recursos', 'AWS Lambda'],
  },
  {
    name: 'aws lambda create-event-source-mapping',
    kind: 'comando',
    category: 'cli',
    level: 3,
    usage: 'aws lambda create-event-source-mapping --function-name <n> --event-source-arn <arn-de-cola> [--batch-size 10] [--function-response-types ReportBatchItemFailures]',
    summary: 'Conecta una cola SQS con una función: Lambda lee la cola y la invoca con lotes de mensajes. Si la función termina bien, borra los mensajes; si falla, vuelven a la cola.',
    details: `
- El **rol de la función** necesita permisos de lectura de la cola (\`AWSLambdaSQSQueueExecutionRole\`): es Lambda quien lee, con tu rol.
- El **tiempo de visibilidad de la cola** debe ser al menos el **timeout de la función** (recomendado ×6); si no, el comando falla.
- Con un lote, una excepción devuelve **todos** los mensajes del lote: usa lotes pequeños o \`ReportBatchItemFailures\` y responde \`{"batchItemFailures": [{"itemIdentifier": "<messageId>"}]}\`.
- Pon una DLQ en la cola de origen para los mensajes que no se puedan procesar.
`,
    scenario: 'srv-veneno',
    examples: [
      ['aws lambda list-event-source-mappings --query "EventSourceMappings[].[FunctionArn,EventSourceArn,BatchSize,State]" --output text', 'La conexión que ya existe'],
      ['aws lambda update-event-source-mapping --uuid $(aws lambda list-event-source-mappings --query "EventSourceMappings[0].UUID" --output text) --batch-size 5 --function-response-types ReportBatchItemFailures --query "[BatchSize,FunctionResponseTypes]"', 'Lotes mayores con respuesta parcial'],
    ],
    seeAlso: ['Amazon SQS', 'Cola de mensajes muertos (DLQ)', 'AWS Lambda'],
  },
  {
    name: 'aws apigatewayv2 create-api',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: 'aws apigatewayv2 create-api --name <n> --protocol-type HTTP [--target <arn-de-lambda>]',
    summary: 'Crea una API HTTP. Con `--target <ARN de Lambda>` hace la «creación rápida»: ruta `$default`, integración, etapa `$default` con despliegue automático y el permiso de invocación, todo de una vez.',
    details: `
Sin \`--target\` creas una API vacía y debes añadir a mano: \`create-integration\`, \`create-route\`, \`create-stage\` (con \`--auto-deploy\`) y el permiso \`lambda add-permission\` (la integración **no** lo añade).

La URL es \`https://<api-id>.execute-api.<región>.amazonaws.com/<etapa>/<ruta>\`; en la etapa \`$default\` no se escribe la etapa.
`,
    scenario: 'srv-api',
    examples: [
      ['aws apigatewayv2 create-api --name prueba --protocol-type HTTP --query "[Name,ApiEndpoint]" --output text', 'Una API vacía'],
      ['aws apigatewayv2 get-apis --query "Items[].Name" --output text'],
    ],
    seeAlso: ['Amazon API Gateway', 'aws lambda add-permission'],
  },
  {
    name: 'aws sns publish',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: "aws sns publish --topic-arn <arn> --message <texto> [--subject <asunto>] [--message-attributes 'clave={DataType=String,StringValue=valor}']",
    summary: 'Publica un mensaje en un tema. Los suscriptores cuya política de filtro encaje con los atributos del mensaje lo reciben.',
    details: 'Los atributos (`--message-attributes`) son lo que miran los filtros de las suscripciones; el texto del mensaje no se filtra salvo que uses el ámbito `MessageBody`. Si una cola suscrita no recibe nada, comprueba su política: sin permiso para `sns.amazonaws.com`, SNS descarta el mensaje en silencio.',
    scenario: 'srv-fanout',
    examples: [
      [`aws sns publish --topic-arn ${TOPIC} --message "pedido 7" --message-attributes 'tipo={DataType=String,StringValue=digital}' --query MessageId --output text`],
      [SNS_FILTER, 'Una política de filtro en un archivo'],
      [SQS_POLICY, 'La política de la cola que admite al tema'],
    ],
    seeAlso: ['Amazon SNS', 'Amazon SQS'],
  },
  {
    name: 'aws events put-events',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: "aws events put-events --entries '[{\"Source\":\"tienda.pedidos\",\"DetailType\":\"PedidoCreado\",\"Detail\":\"{\\\"total\\\":250}\"}]'",
    summary: 'Publica eventos propios en el bus por defecto (o en otro). `Detail` es un JSON escrito como cadena. Devuelve cuántas entradas fallaron.',
    details: 'Si `FailedEntryCount` es 0, EventBridge aceptó los eventos; que lleguen a algún destino depende de las reglas y de los permisos de cada destino. Un evento sin regla que lo recoja simplemente desaparece.',
    scenario: 'srv-eventos',
    examples: [
      ['aws events put-events --entries \'[{"Source":"tienda.pedidos","DetailType":"PedidoCreado","Detail":"{\\"total\\":250}"}]\' --query FailedEntryCount', 'Publicar un pedido de 250 (0 fallos)'],
      ['aws events put-events --entries \'[{"Source":"tienda.pedidos","DetailType":"PedidoCreado","Detail":"{no es json"}]\' --query "Entries[0].ErrorCode" --output text', 'Detail mal formado: la entrada falla'],
    ],
    seeAlso: ['Amazon EventBridge'],
  },
  {
    name: 'aws stepfunctions start-execution',
    kind: 'comando',
    category: 'cli',
    level: 3,
    usage: "aws stepfunctions start-execution --state-machine-arn <arn> [--name <n>] [--input '{\"id\":1}']",
    summary: 'Inicia una ejecución de una máquina de estados con un JSON de entrada. Después consulta `describe-execution` (estado y salida) o `get-execution-history` (qué pasó en cada estado).',
    details: 'Una ejecución puede quedar `RUNNING` un rato (esperas, reintentos con espera creciente) antes de terminar en `SUCCEEDED`, `FAILED`, `TIMED_OUT` o `ABORTED`. Si falla, el historial dice qué estado y qué error. Un fallo de permisos aparece como `States.TaskFailed` con `AccessDeniedException` en la causa.',
    scenario: 'srv-sfn-roto',
    examples: [
      ['aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:pedido --query "executions[].[name,status]" --output text', 'La primera ejecución falló'],
      ['aws stepfunctions describe-execution --execution-arn arn:aws:states:us-east-1:123456789012:execution:pedido:primera --query "[error,cause]" --output text', 'El motivo: el rol no puede invocar la función'],
    ],
    seeAlso: ['AWS Step Functions'],
  },
  {
    name: 'aws cognito-idp initiate-auth',
    kind: 'comando',
    category: 'cli',
    level: 2,
    usage: "aws cognito-idp initiate-auth --client-id <id> --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=<u>,PASSWORD='<p>'",
    summary: 'Inicia sesión de un usuario y devuelve los tokens (`IdToken`, `AccessToken`, `RefreshToken`). El cliente debe tener habilitado `ALLOW_USER_PASSWORD_AUTH`.',
    details: `
Errores típicos: _flow not enabled for this client_ (activa el flujo en el cliente), _UserNotConfirmedException_ (falta confirmar el registro), _NotAuthorizedException_ (usuario o contraseña incorrectos; el mensaje no dice cuál, a propósito).

El primer inicio de sesión de un usuario creado por un administrador devuelve un desafío \`NEW_PASSWORD_REQUIRED\` que se responde con \`respond-to-auth-challenge\`. Para renovar sin pedir la contraseña usa el flujo \`REFRESH_TOKEN_AUTH\`.
`,
    scenario: 'srv-auth',
    examples: [
      ['POOL=$(aws cognito-idp list-user-pools --max-results 10 --query "UserPools[0].Id" --output text)'],
      ['CLIENT=$(aws cognito-idp list-user-pool-clients --user-pool-id $POOL --query "UserPoolClients[0].ClientId" --output text)'],
      ['aws cognito-idp initiate-auth --client-id $CLIENT --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD=\'Secreto#2026\' --query "[AuthenticationResult.ExpiresIn,AuthenticationResult.TokenType]" --output text', 'Los tokens duran una hora'],
      ['aws cognito-idp initiate-auth --client-id $CLIENT --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD=mala', 'Contraseña incorrecta', 'error'],
    ],
    seeAlso: ['Amazon Cognito'],
  },
  {
    name: 'aws s3api put-bucket-notification-configuration',
    kind: 'comando',
    category: 'cli',
    level: 3,
    usage: "aws s3api put-bucket-notification-configuration --bucket <b> --notification-configuration file://notif.json",
    summary: 'Configura a quién avisa el bucket cuando se crea o borra un objeto. Sustituye TODA la configuración anterior (lee la actual con `get-…` y añade lo nuevo).',
    details: 'S3 valida el destino antes de guardar: si la función, la cola o el tema no admiten a S3, el error es _Unable to validate the following destination configurations_. Si necesitas saltarte la validación (no suele convenir) existe `--skip-destination-validation`.',
    scenario: 'srv-s3ev',
    examples: [
      ['aws s3api get-bucket-notification-configuration --bucket tienda-fotos-originales', 'Sin configuración: salida vacía'],
      [`aws s3api put-bucket-notification-configuration --bucket tienda-fotos-originales --notification-configuration '${S3CONF}'`, 'Sin permiso en la función: no valida', 'error'],
    ],
    seeAlso: ['Notificaciones de eventos de S3', 'aws lambda add-permission'],
  },
];
