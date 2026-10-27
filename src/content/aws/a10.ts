import { SRV_ASL, SRV_CODE } from '@/awsengine/scenarios-srv';
import { A, all, awsAfter, awsHas, awsIs, awsMatches, awsWorld, demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf } from './awsbuild';

const Q = (n: string) => `https://sqs.us-east-1.amazonaws.com/123456789012/${n}`;
const QARN = (n: string) => `arn:aws:sqs:us-east-1:123456789012:${n}`;
const SM = 'arn:aws:states:us-east-1:123456789012:stateMachine:pedido';
const attr = (queue: string, name: string) => `sqs get-queue-attributes --queue-url ${Q(queue)} --attribute-names ${name} --query Attributes.${name}`;
const count = (queue: string, expect: string, want: string) => awsIs(`sqs get-queue-attributes --queue-url ${Q(queue)} --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages`, expect, want);
const entries = (list: { source: string; type: string; total: number }[]) => `events put-events --entries '${JSON.stringify(list.map((e) => ({ Source: e.source, DetailType: e.type, Detail: JSON.stringify({ total: e.total }) })))}'`;

const ATTR_PEDIDOS = JSON.stringify({ VisibilityTimeout: '60', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: QARN('pedidos-dlq'), maxReceiveCount: '3' }) });
const REDRIVE_TRABAJOS = JSON.stringify({ RedrivePolicy: JSON.stringify({ deadLetterTargetArn: QARN('trabajos-dlq'), maxReceiveCount: '2' }) });
const queuePolicy = (queue: string) =>
  JSON.stringify({
    Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: QARN(queue), Condition: { ArnEquals: { 'aws:SourceArn': 'arn:aws:sns:us-east-1:123456789012:pedidos' } } }] }),
  });
const FILTRO = JSON.stringify({ FilterPolicy: JSON.stringify({ tipo: ['fisico'] }) });
const NOTIF_FOTOS = JSON.stringify({ LambdaFunctionConfigurations: [{ Id: 'miniaturas', LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:miniatura', Events: ['s3:ObjectCreated:*'], Filter: { Key: { FilterRules: [{ Name: 'suffix', Value: '.jpg' }] } } }] });
const PEDIDO = JSON.stringify({ id: 1, total: 40, cliente: 'ana' });
const PEDIDO_MALO = JSON.stringify({ id: 2, total: -5, cliente: 'bob' });
const POLICY_RECIBE = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: QARN('pedidos') }] });
const POLICY_PROCESA = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:PutItem', Resource: 'arn:aws:dynamodb:us-east-1:123456789012:table/pedidos' }] });

const POOL = 'POOL=$(aws cognito-idp list-user-pools --max-results 10 --query "UserPools[0].Id" --output text)';
const CLIENT = 'CLIENT=$(aws cognito-idp list-user-pool-clients --user-pool-id $POOL --query "UserPoolClients[0].ClientId" --output text)';
const AUTHORIZER = "AUTH=$(aws apigatewayv2 create-authorizer --api-id $API --authorizer-type JWT --identity-source '$request.header.Authorization' --name cognito --jwt-configuration Audience=$CLIENT,Issuer=https://cognito-idp.us-east-1.amazonaws.com/$POOL --query AuthorizerId --output text)";
const ROLE = (v: string, name: string) => `${v}=$(aws iam get-role --role-name ${name} --query Role.Arn --output text)`;

export const a10 = awsWorld({
  id: 'a10',
  index: 10,
  title: 'Serverless',
  subtitle: 'Funciones, APIs, colas y eventos sin servidores que mantener',
  emoji: '⚡',
  color: '#E879F9',
  level: 'intermedio',
  intro:
    'Con **serverless** no reservas servidores: AWS ejecuta tu código cuando pasa algo y solo pagas mientras trabaja. En esta zona escribes funciones **Lambda** en Python (que se ejecutan de verdad en el simulador, con `boto3` hablando con tu cuenta), las publicas con **API Gateway**, desacoplas con **SQS y SNS**, las orquestas con **EventBridge y Step Functions** y proteges las APIs con **Cognito**. Al final, una tienda completa de pedidos sin un solo servidor.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a10-1', { title: 'Lambda: eventos, memoria, tiempo y logs', summary: 'Tu primera función, y cómo diagnosticarla cuando falla', emoji: '🧩', commands: ['AWS Lambda', 'Arranque en frío (cold start)', 'Concurrencia de Lambda', 'Rol de ejecución y política de recursos', 'aws lambda create-function', 'aws lambda invoke'], minutes: 28 }, [
      learn(
        'Una función, un evento',
        `
**AWS Lambda** ejecuta tu código cuando ocurre algo —una petición web, un mensaje en una cola, un archivo subido, una hora— y lo apaga al terminar. No hay servidor que parchear ni capacidad que calcular, y **pagas por milisegundo de ejecución**: si nadie la llama, no pagas.

Una función de Python es solo esto:

\`\`\`python
def lambda_handler(event, context):
    return {'mensaje': 'hola'}
\`\`\`

- **event**: un JSON con lo que ha pasado. Cambia según quién llama (una API, una cola, S3…).
- **context**: datos de la ejecución (id de la petición, tiempo que queda).
- El **handler** es \`archivo.función\`: con \`lambda_function.py\` y \`lambda_handler\` es \`lambda_function.lambda_handler\`.

Para crearla empaquetas el código en un **.zip** y se lo das a \`create-function\` junto con un **rol de ejecución**. Todo lo que imprimes con \`print\` acaba en **CloudWatch Logs**.

En este simulador el código Python **se ejecuta de verdad**, y \`import boto3\` habla con tu cuenta simulada con los permisos del rol de la función.
`,
        '🧩',
      ),
      illus('aws-lambda-lifecycle', 'Memoria, CPU, coste y arranque en frío', 'Cambia la memoria y mira cómo varían la duración y el precio. Activa «función fría» para ver el Init Duration.'),
      mc('Tu función Lambda necesita leer una tabla de DynamoDB. ¿Dónde das ese permiso?', ['En el rol de ejecución de la función', 'En la política de recursos de la función', 'En un security group', 'Con claves de acceso dentro del código'], 0, 'El rol de ejecución dice qué puede hacer la función. Nunca metas claves en el código: Lambda entrega credenciales temporales del rol a `boto3` automáticamente.'),
      demo(
        'Ver, invocar y leer los logs',
        [
          ['aws lambda list-functions --query "Functions[].[FunctionName,Runtime,MemorySize,Timeout]" --output table', 'Dos funciones: memoria y tiempo máximo'],
          ['aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{"nombre":"Ana"}\' respuesta.json', '200: Lambda ejecutó la función'],
          ['cat respuesta.json', 'El valor que devolvió el handler'],
          ['aws lambda invoke --function-name saludo --log-type Tail --query LogResult --output text respuesta.json | base64 -d', 'Los logs de esa ejecución: START, tu print, END y REPORT'],
        ],
        A('srv-lambda-demo'),
        'La función `saludo` ya está creada. Fíjate en el REPORT: duración, duración facturada, memoria usada… y en la primera ejecución, el **Init Duration** del arranque en frío.',
      ),
      predict('¿Qué guarda `respuesta.json`?', 'aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{"nombre":"Marta"}\' respuesta.json --query StatusCode --output text > /dev/null && cat respuesta.json', ['{"mensaje": "Hola, mundo!"}', '{"mensaje": "Hola, Marta"}', 'Hola, Marta!'], 'El handler lee `nombre` del evento y devuelve un diccionario, que Lambda serializa a JSON.', A('srv-lambda-demo')),
      practice({
        prompt:
          'En tu carpeta está **`lambda_function.py`** con la función `saludo`. Publícala:\n\n1. Empaquétala en un `.zip` (`zip`).\n2. Crea la función **`saludo`** (Python 3.12) con el rol **`lambda-basico`** (ya existe) y el handler `lambda_function.lambda_handler`.\n3. Pruébala con el evento `{"nombre":"Ana"}`.',
        goal: 'La función saludo responde «Hola, Ana!»',
        setup: A('srv-lambda', { files: { '/home/alumno/lambda_function.py': SRV_CODE.saludo } }),
        check: awsIs(`_check invoke --function saludo --payload '{"nombre":"Ana"}' --query Payload.mensaje`, 'Hola, Ana!', 'La función saludo todavía no existe o no responde «Hola, Ana!»'),
        solution: [
          'zip function.zip lambda_function.py',
          ROLE('ROLE', 'lambda-basico'),
          'aws lambda create-function --function-name saludo --runtime python3.12 --role $ROLE --handler lambda_function.lambda_handler --zip-file fileb://function.zip',
          'aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{"nombre":"Ana"}\' respuesta.json',
          'cat respuesta.json',
        ],
        hints: ['Primero `zip function.zip lambda_function.py`. El ARN del rol: `aws iam get-role --role-name lambda-basico --query Role.Arn --output text`.', '`aws lambda create-function --function-name saludo --runtime python3.12 --role <arn> --handler lambda_function.lambda_handler --zip-file fileb://function.zip` (con `fileb://`, que es un archivo binario).', 'Para probarla: `aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{"nombre":"Ana"}\' respuesta.json` y `cat respuesta.json`.'],
        explain: 'Empaquetar, crear con un rol y un handler, invocar. El handler es `archivo.función`; sin `--cli-binary-format raw-in-base64-out` la CLI v2 esperaría el `--payload` en base64.',
        par: 5,
        commands: ['aws lambda create-function', 'aws lambda invoke'],
      }),
      learn(
        'Cuando falla: handler, tiempo y memoria',
        `
Tres fallos de configuración que verás una y otra vez:

| Síntoma | Causa |
| --- | --- |
| \`Runtime.HandlerNotFound\` | El **handler** no coincide con el archivo o la función |
| \`Task timed out after 3.00 seconds\` | La función tarda más que su **timeout** (3 s por defecto, máximo 15 min) |
| \`Runtime.ImportModuleError\` | El código importa un módulo que no está en el .zip |

Un **StatusCode 200** al invocar solo dice que Lambda ha ejecutado algo. Si el código falla, además verás \`"FunctionError": "Unhandled"\` y el detalle en el archivo de salida.

**Memoria y CPU van juntas**: a 128 MB tienes una fracción de CPU; a **1.769 MB** tienes un vCPU entero. Como se paga memoria × tiempo, subir la memoria de una función que usa mucha CPU suele **bajar el tiempo en la misma proporción** y el coste casi no cambia, pero el usuario espera mucho menos. Lo que sí **no** arregla la memoria es una espera (\`sleep\`, una llamada de red lenta): ahí hace falta más timeout.
`,
        '🩺',
      ),
      tf('«Si subes la memoria de una función de 128 MB a 1.024 MB, pagarás siempre 8 veces más.»', false, 'Pagas memoria × tiempo. Si la función es de CPU, con 8 veces más CPU tarda aproximadamente 8 veces menos y el coste casi no varía.'),
      practice({
        prompt: 'La función **`informe`** devuelve un error al invocarla. Invócala (con `--log-type Tail` o mirando el archivo de salida), averigua qué pasa y **corrige su configuración** (sin tocar el código) hasta que devuelva `{"informe": "listo", "filas": 120}`.',
        goal: 'informe responde correctamente',
        setup: A('srv-lambda-roto'),
        check: awsIs('_check invoke --function informe --query Payload', { informe: 'listo', filas: 120 }, 'La función informe todavía falla (¿el handler? ¿el tiempo máximo?)'),
        solution: [
          'aws lambda invoke --function-name informe respuesta.json',
          'cat respuesta.json',
          'aws lambda update-function-configuration --function-name informe --handler lambda_function.lambda_handler',
          'aws lambda invoke --function-name informe respuesta.json',
          'cat respuesta.json',
          'aws lambda update-function-configuration --function-name informe --timeout 10',
        ],
        hints: ['El primer error dice `Runtime.HandlerNotFound`: mira el handler con `aws lambda get-function-configuration --function-name informe --query Handler`.', 'El archivo se llama `lambda_function.py` y la función `lambda_handler`: `aws lambda update-function-configuration --function-name informe --handler lambda_function.lambda_handler`.', 'Tras arreglar el handler saldrá `Task timed out`: el código espera 4 segundos y el timeout es 3. Súbelo con `--timeout 10`.'],
        explain: 'Primero el handler (la función ni siquiera arrancaba) y después el timeout (el código espera 4 s). Con la memoria no se arregla una espera: solo con más tiempo máximo.',
        par: 4,
        commands: ['aws lambda invoke', 'AWS Lambda'],
      }),
      practice({
        prompt: 'La función **`calcula`** hace un cálculo largo y siempre agota su tiempo (**1 segundo**) con **128 MB**. No cambies ni el código ni el timeout: dale la **memoria** necesaria para que termine a tiempo. Ve probando.',
        goal: 'calcula termina dentro de 1 segundo sin cambiar el timeout',
        setup: A('srv-lambda-lenta'),
        check: all(awsIs('_check invoke --function calcula --query FunctionError', null, 'La función todavía agota su tiempo: prueba con más memoria'), awsIs('lambda get-function-configuration --function-name calcula --query Timeout', 1, 'No cambies el timeout: la solución es la memoria')),
        solution: ['aws lambda invoke --function-name calcula --log-type Tail --query LogResult --output text respuesta.json | base64 -d', 'aws lambda update-function-configuration --function-name calcula --memory-size 512', 'aws lambda invoke --function-name calcula --log-type Tail --query LogResult --output text respuesta.json | base64 -d'],
        hints: ['Mira el REPORT: con 128 MB tarda más de un segundo. La CPU es proporcional a la memoria.', '`aws lambda update-function-configuration --function-name calcula --memory-size 512` (prueba 256, 512, 1024…).'],
        explain: 'Más memoria = más CPU = menos tiempo, y como pagas memoria × tiempo, el coste apenas sube. Es lo primero que se prueba cuando una función de cálculo va lenta.',
        par: 3,
        commands: ['aws lambda invoke', 'AWS Lambda'],
      }),
      learn(
        'Logs, permisos y concurrencia',
        `
- Los \`print\` y errores van a **CloudWatch Logs**, grupo \`/aws/lambda/<función>\`. Pero lo escribe **tu rol**: si le faltan permisos de logs (la política gestionada \`AWSLambdaBasicExecutionRole\` los da), la función **funciona sin dejar rastro** y el grupo ni se crea.
- **Concurrencia**: una región admite 1.000 ejecuciones simultáneas. La **reservada** garantiza capacidad a una función y a la vez le pone techo; con **0** la apagas de golpe. La **aprovisionada** mantiene entornos calientes (sin arranque en frío) a cambio de un coste fijo.
- Cuando se superan los límites: las invocaciones síncronas reciben \`TooManyRequestsException\` y las asíncronas se reintentan.
- Recuerda: el **rol de ejecución** es lo que la función PUEDE HACER; la **política de recursos** (\`add-permission\`) es QUIÉN PUEDE INVOCARLA.
`,
        '📜',
      ),
      mc('Una función se ejecuta y devuelve resultados, pero no existe el grupo de logs `/aws/lambda/…`. ¿Qué es lo más probable?', ['El runtime no soporta logs', 'Su rol de ejecución no puede escribir en CloudWatch Logs', 'Hay que activar los logs en el timeout', 'Falta la política de recursos'], 1, 'Lambda escribe los logs con el rol de la función. Sin `logs:CreateLogGroup`, `CreateLogStream` y `PutLogEvents` no se escribe nada (ni se avisa).'),
      practice({
        prompt: 'La función **`confirma`** se ejecuta bien, pero **no deja logs**: `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/confirma` no devuelve nada. Arréglalo dando a su rol **`confirma-role`** la política gestionada de AWS que escribe en CloudWatch Logs, vuelve a invocarla y comprueba que ya existe el grupo.',
        goal: 'El grupo de logs /aws/lambda/confirma existe',
        setup: A('srv-lambda-sinlogs'),
        check: awsAfter(['_check invoke --function confirma'], awsIs('logs describe-log-groups --log-group-name-prefix /aws/lambda/confirma --query "logGroups[].logGroupName"', ['/aws/lambda/confirma'], 'La función todavía no puede escribir logs')),
        solution: ['aws iam attach-role-policy --role-name confirma-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', 'aws lambda invoke --function-name confirma respuesta.json', 'aws logs describe-log-groups --log-group-name-prefix /aws/lambda/confirma --query "logGroups[].logGroupName"'],
        hints: ['El rol de la función es `confirma-role`: `aws iam list-attached-role-policies --role-name confirma-role` (no tiene nada).', 'La política se llama `AWSLambdaBasicExecutionRole` y está en la ruta `service-role/`: `arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`.'],
        explain: 'Es el fallo silencioso más típico: la función funciona pero nadie puede ver qué hace. Lo primero que se da a un rol de Lambda es `AWSLambdaBasicExecutionRole`.',
        par: 3,
        commands: ['Rol de ejecución y política de recursos', 'aws lambda invoke'],
      }),
      match(
        'Une cada síntoma con su causa',
        [
          ['Runtime.HandlerNotFound', 'El handler no coincide con el archivo o la función'],
          ['Task timed out after 3.00 seconds', 'La función tarda más que su timeout'],
          ['AccessDeniedException en los logs de la función', 'Al rol de ejecución le falta un permiso'],
          ['TooManyRequestsException', 'Se ha agotado la concurrencia'],
        ],
        'Cada síntoma señala un sitio: handler y timeout son de configuración, AccessDenied es del rol, y TooManyRequests de la concurrencia (reservada o de la cuenta).',
      ),
    ]),
    // ───────────────────────── 2 ─────────────────────────
    lesson('a10-2', { title: 'API Gateway + Lambda + DynamoDB', summary: 'Publicar una API HTTP y encontrar el salto que falla', emoji: '🚪', commands: ['Amazon API Gateway', 'aws apigatewayv2 create-api', 'aws lambda add-permission', 'Rol de ejecución y política de recursos'], minutes: 26 }, [
      learn(
        'De una URL a tu código',
        `
**API Gateway** es la puerta pública de tu backend. Una **API HTTP** (la opción simple y barata) tiene cuatro piezas:

| Pieza | Qué es |
| --- | --- |
| **Ruta** | \`GET /productos\`, \`POST /productos/{id}\`, \`$default\` (todo lo demás) |
| **Integración** | A dónde va la petición: normalmente una función Lambda (\`AWS_PROXY\`) |
| **Etapa** | Una versión publicada (\`$default\`, \`prod\`…). **Hay que desplegarla** (\`--auto-deploy\`) |
| **Autorizador** | Quién puede llamar: JWT de Cognito, Lambda o IAM |

La URL es \`https://<id>.execute-api.us-east-1.amazonaws.com/<etapa>/<ruta>\` (en la etapa \`$default\` no se escribe la etapa).

La forma más rápida: \`aws apigatewayv2 create-api --name mi-api --protocol-type HTTP --target <ARN de la función>\`. Crea la ruta \`$default\`, la integración, la etapa y **el permiso para que la API invoque la función**. Si lo montas pieza a pieza, ese permiso (\`lambda add-permission\`) **no** se añade solo.
`,
        '🚪',
      ),
      illus('aws-apigw-flow', 'Cada salto puede fallar', 'Apaga y enciende piezas y mira qué código HTTP devuelve la API y en qué salto se corta.'),
      mc('Tu API devuelve `500 Internal Server Error` y la función no ha registrado ninguna ejecución nueva. ¿Qué es lo más probable?', ['La tabla de DynamoDB está llena', 'Falta el permiso (política de recursos) para que API Gateway invoque la función', 'La API no tiene etapa', 'El rol de la función no puede escribir logs'], 1, 'Si la función no llega a ejecutarse, la causa está antes: API Gateway no tiene permiso para invocarla. Sin etapa desplegada sería un 404.'),
      demo(
        'Una API que responde 500',
        [
          ['aws apigatewayv2 get-apis --query "Items[].[Name,ApiEndpoint]" --output text', 'La API y su URL base'],
          ['curl -s -o /dev/null -w "%{http_code}\\n" "$(aws apigatewayv2 get-apis --query "Items[0].ApiEndpoint" --output text)/prod/productos"', 'La ruta existe pero responde 500'],
          ['aws lambda get-policy --function-name catalogo', 'La función no tiene política de recursos: nadie puede invocarla', 'error'],
        ],
        A('srv-api-500'),
        'La integración está creada, pero ¿quién ha dicho a la función que API Gateway puede llamarla?',
      ),
      predict('¿Qué código HTTP devuelve esta API?', 'curl -s -o /dev/null -w "%{http_code}\\n" "$(aws apigatewayv2 get-apis --query \'Items[0].ApiEndpoint\' --output text)/prod/productos"', ['200', '404', '403'], 'La ruta y la etapa existen (no es 404), pero la función no admite a API Gateway: 500 sin más detalle.', A('srv-api-500')),
      learn(
        'Lo que recibe y lo que devuelve la función',
        `
Con la integración proxy (formato **2.0**) tu función recibe la petición entera:

\`\`\`json
{ "routeKey": "GET /productos/{id}", "rawPath": "/productos/p1",
  "queryStringParameters": {"orden": "precio"},
  "pathParameters": {"id": "p1"},
  "headers": {...}, "body": "{\\"a\\":1}",
  "requestContext": {"http": {"method": "GET"}} }
\`\`\`

y debe **devolver**:

\`\`\`python
return {'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(datos)}   # el body SIEMPRE es una cadena
\`\`\`

Si falta \`statusCode\` o \`body\` no es una cadena, API Gateway no puede construir la respuesta y devuelve **500**. Otros códigos: **404** (ruta o etapa inexistente), **401** (token ausente o inválido), **429** (demasiadas peticiones).

Con DynamoDB, \`boto3.resource('dynamodb').Table('productos')\` y sus métodos \`put_item\`, \`get_item\`, \`scan\`, \`query\`. Los números llegan como \`Decimal\`: conviértelos para \`json.dumps\`.
`,
        '📦',
      ),
      fill('Completa', 'La función de una API debe devolver un diccionario con `statusCode` y un `body` que sea una ___, no un ___.', ['cadena', 'diccionario', 'lista', 'número'], ['cadena', 'diccionario'], 'API Gateway espera texto en el body. Haz `json.dumps(datos)` en vez de devolver el diccionario.'),
      practice({
        prompt:
          'En la tabla **`productos`** de DynamoDB hay tres artículos. Publica el catálogo como una API:\n\n1. Empaqueta **`catalogo.py`** y crea la función **`catalogo`** (Python 3.12, rol **`api-role`**, handler `catalogo.lambda_handler`).\n2. Crea una **API HTTP** con la «creación rápida» apuntando a la función.\n3. Comprueba con `curl` la URL + `/productos`.',
        goal: 'GET /productos devuelve el catálogo',
        setup: A('srv-api', { files: { '/home/alumno/catalogo.py': SRV_CODE.catalogo } }),
        check: all(awsIs('_check http --url api:first/productos --query Status', 200, 'La API todavía no responde 200'), awsHas('_check http --url api:first/productos --query Body', 'Camiseta', 'La respuesta no incluye los productos')),
        solution: [
          'zip function.zip catalogo.py',
          ROLE('ROLE', 'api-role'),
          'ARN=$(aws lambda create-function --function-name catalogo --runtime python3.12 --role $ROLE --handler catalogo.lambda_handler --zip-file fileb://function.zip --query FunctionArn --output text)',
          'aws apigatewayv2 create-api --name tienda-api --protocol-type HTTP --target $ARN',
          'curl -s $(aws apigatewayv2 get-apis --query "Items[0].ApiEndpoint" --output text)/productos',
        ],
        hints: ['Empaqueta con `zip function.zip catalogo.py`; el handler es `catalogo.lambda_handler` (el archivo se llama `catalogo.py`).', 'Guarda el ARN de la función: `--query FunctionArn --output text`.', '`aws apigatewayv2 create-api --name tienda-api --protocol-type HTTP --target <ARN>` hace todo de una vez, permiso incluido.'],
        explain: 'La creación rápida (`--target`) monta la ruta `$default`, la integración, la etapa con despliegue automático y el permiso de invocación. Por eso es la forma más corta de exponer una función.',
        par: 5,
        commands: ['aws apigatewayv2 create-api', 'aws lambda create-function'],
      }),
      practice({
        prompt: 'La API **`tienda-api`** (etapa **`prod`**) devuelve **500** en `…/prod/productos`. La función `catalogo` está bien. Averigua qué falta y arréglalo para que responda 200.',
        goal: 'GET /prod/productos devuelve 200',
        setup: A('srv-api-500'),
        check: awsIs('_check http --url api:first/prod/productos --query Status', 200, 'La API todavía responde con error'),
        solution: [
          'API=$(aws apigatewayv2 get-apis --query "Items[0].ApiId" --output text)',
          'curl -s -o /dev/null -w "%{http_code}\\n" https://$API.execute-api.us-east-1.amazonaws.com/prod/productos',
          'aws lambda add-permission --function-name catalogo --statement-id apigateway --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:123456789012:$API/*/*/*"',
          'curl -s -o /dev/null -w "%{http_code}\\n" https://$API.execute-api.us-east-1.amazonaws.com/prod/productos',
        ],
        hints: ['La función no llega a ejecutarse: `aws lambda get-policy --function-name catalogo` dice que no tiene política.', '`aws lambda add-permission --function-name catalogo --statement-id apigateway --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn <arn>`.', 'El `--source-arn` tiene la forma `arn:aws:execute-api:us-east-1:123456789012:<id-de-la-api>/*/*/*`.'],
        explain: 'Montar la API pieza a pieza no añade el permiso de invocación. El síntoma es un 500 sin rastro en los logs de la función. Limitar con `--source-arn` evita que otra API use tu función.',
        par: 3,
        commands: ['aws lambda add-permission', 'Rol de ejecución y política de recursos'],
      }),
      learn(
        'El rol de la función y el mínimo privilegio',
        `
Cuando la ruta llega a la función pero esta falla por dentro (por ejemplo \`AccessDeniedException\` al escribir en DynamoDB) la API devuelve también un **500** genérico. La causa está en los **logs de la función**:

\`aws logs filter-log-events --log-group-name /aws/lambda/crea --query "events[].message" --output text\`

La solución no es dar \`AmazonDynamoDBFullAccess\`: crea una **política en línea** con **solo** la acción que hace falta (\`dynamodb:PutItem\`) sobre **solo** esa tabla (su ARN). Cada función con su propio rol y sus propios permisos: si una se compromete, el daño queda acotado.
`,
        '🔒',
      ),
      tf('«Para arreglar un AccessDenied de una función, lo recomendable es adjuntar `AmazonDynamoDBFullAccess` a su rol.»', false, 'Es lo más rápido pero da permisos sobre todas las tablas y todas las acciones. El mínimo privilegio pide solo `PutItem` sobre el ARN de esa tabla.'),
      practice({
        prompt: 'En la API **`tienda-api`**, `GET /productos` funciona pero **`POST /productos`** responde 500. Prueba con `curl -X POST -d \'{"id":"p4","nombre":"Bolsa","precio":5}\' <url>/productos`, lee los **logs** de la función `crea` y arregla el problema con una **política en línea** de **mínimo privilegio** en su rol `crea-role` (solo la acción necesaria sobre la tabla `productos`).',
        goal: 'POST /productos guarda el producto con permisos mínimos',
        setup: A('srv-api-post'),
        check: all(
          awsAfter([`_check http --url api:first/productos --method POST --body '{"id":"p4","nombre":"Bolsa","precio":5}'`], awsIs('dynamodb scan --table-name productos --query Count', 4, 'El POST todavía no guarda el producto')),
          awsIs('iam list-attached-role-policies --role-name crea-role --query "AttachedPolicies[].PolicyName"', ['AWSLambdaBasicExecutionRole'], 'Usa una política en línea con lo mínimo, no políticas gestionadas más amplias'),
        ),
        solution: [
          'URL=$(aws apigatewayv2 get-apis --query "Items[0].ApiEndpoint" --output text)',
          `curl -s -X POST -d '{"id":"p4","nombre":"Bolsa","precio":5}' $URL/productos`,
          'aws logs filter-log-events --log-group-name /aws/lambda/crea --query "events[].message" --output text',
          `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"dynamodb:PutItem","Resource":"arn:aws:dynamodb:us-east-1:123456789012:table/productos"}]}' > politica.json`,
          'aws iam put-role-policy --role-name crea-role --policy-name escribe-productos --policy-document file://politica.json',
          `curl -s -X POST -d '{"id":"p4","nombre":"Bolsa","precio":5}' $URL/productos`,
        ],
        hints: ['Tras el POST fallido, mira `aws logs filter-log-events --log-group-name /aws/lambda/crea`: dice `AccessDeniedException` y qué acción falta.', 'Crea un JSON con `dynamodb:PutItem` y como `Resource` el ARN `arn:aws:dynamodb:us-east-1:123456789012:table/productos`.', '`aws iam put-role-policy --role-name crea-role --policy-name escribe-productos --policy-document file://politica.json`.'],
        explain: 'El error está en los logs de la función, no en la API. Una política en línea con `PutItem` sobre una sola tabla cumple el mínimo privilegio: la función hace lo que debe y nada más.',
        par: 6,
        commands: ['Rol de ejecución y política de recursos', 'Amazon API Gateway'],
      }),
      order('Ordena el comando que deja a una API invocar una función', ['aws', 'lambda', 'add-permission', '--function-name', 'catalogo', '--principal', 'apigateway.amazonaws.com'], 'aws lambda add-permission --function-name catalogo --principal apigateway.amazonaws.com', 'Los demás parámetros (`--statement-id`, `--action`, `--source-arn`) completan la frase de la política de recursos.', ['aws lambda add-permission --principal apigateway.amazonaws.com --function-name catalogo']),
    ]),
    // ───────────────────────── 3 ─────────────────────────
    lesson('a10-3', { title: 'SQS y SNS: desacoplar', summary: 'Colas que absorben picos, temas que reparten y mensajes que se atascan', emoji: '📬', commands: ['Amazon SQS', 'Cola de mensajes muertos (DLQ)', 'Amazon SNS', 'aws sns publish', 'aws lambda create-event-source-mapping'], minutes: 28 }, [
      learn(
        'Una cola entre dos servicios',
        `
Si tu API llama directamente a otro servicio y este se cae o va lento, tu API también. Con una **cola SQS** en medio, el productor deja el mensaje y se olvida; el consumidor lo toma cuando puede. Los picos se acumulan en la cola en vez de tumbar nada.

El ciclo de un mensaje:

1. \`send-message\`: entra en la cola.
2. \`receive-message\`: el consumidor lo recibe y queda **oculto** durante el **tiempo de visibilidad**.
3. Si lo procesa bien, lo **borra** (\`delete-message\`). Si no lo borra a tiempo, **vuelve a ser visible** y otro consumidor lo recibirá (por eso «al menos una vez»: tu código debe tolerar duplicados).
4. Si un mensaje se recibe más de \`maxReceiveCount\` veces sin borrarse, pasa a la **cola de mensajes muertos (DLQ)**.

Con Lambda como consumidor (\`event-source-mapping\`), Lambda lee la cola con **tu rol**, invoca la función con un **lote** de mensajes y los borra si termina bien. Para crearlo, la visibilidad de la cola debe ser **mayor o igual que el timeout** de la función.
`,
        '📬',
      ),
      illus('aws-sqs-visibility', 'Visibilidad, reintentos y DLQ', 'Juega con el tiempo de visibilidad y con lo que tarda el consumidor; activa el fallo para ver cómo acaba el mensaje en la DLQ.'),
      mc('Un consumidor tarda 45 segundos en procesar cada mensaje y la visibilidad de la cola es de 30 segundos. ¿Qué ocurre?', ['Nada: SQS espera a que termine', 'El mensaje vuelve a ser visible mientras se procesa y otro consumidor lo recibe: se procesa dos veces', 'El mensaje se mueve a la DLQ', 'La cola se bloquea'], 1, 'La visibilidad es un temporizador, no un bloqueo. Debe ser mayor que lo que tarda el consumidor (con Lambda, al menos 6 veces su timeout).'),
      demo(
        'Enviar, recibir y ver el mensaje «en vuelo»',
        [
          'aws sqs create-queue --queue-name demo --attributes VisibilityTimeout=60',
          'Q=$(aws sqs get-queue-url --queue-name demo --query QueueUrl --output text)',
          ['aws sqs send-message --queue-url $Q --message-body \'{"pedido":1}\' --query MessageId --output text', 'Entra en la cola'],
          ['aws sqs receive-message --queue-url $Q --query "Messages[0].Body" --output text', 'El consumidor lo recibe: ahora queda oculto 60 s'],
          ['aws sqs get-queue-attributes --queue-url $Q --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible', 'Ninguno visible y uno «en vuelo»'],
        ],
        A('base'),
        'Si no lo borras en 60 segundos, volverá a aparecer.',
      ),
      practice({
        prompt:
          'Crea el sistema de reintentos de la tienda:\n\n1. Una cola de mensajes muertos **`pedidos-dlq`**.\n2. Una cola **`pedidos`** con **visibilidad de 60 segundos** que, tras **3 recepciones** sin borrar, mande el mensaje a `pedidos-dlq`.\n\nTienes `atributos.json` con la configuración lista (dentro lleva la política de reenvío: JSON dentro de JSON).',
        goal: 'pedidos reenvía a pedidos-dlq tras 3 intentos, con visibilidad 60',
        setup: A('base', { files: { '/home/alumno/atributos.json': ATTR_PEDIDOS } }),
        check: all(awsHas(attr('pedidos', 'RedrivePolicy'), 'pedidos-dlq', 'La cola pedidos todavía no envía a pedidos-dlq'), awsMatches(attr('pedidos', 'RedrivePolicy'), 'maxReceiveCount[^0-9]{1,8}3', 'maxReceiveCount debería ser 3'), awsIs(attr('pedidos', 'VisibilityTimeout'), '60', 'La visibilidad debería ser de 60 segundos')),
        solution: ['aws sqs create-queue --queue-name pedidos-dlq', 'aws sqs create-queue --queue-name pedidos --attributes file://atributos.json', `aws sqs get-queue-attributes --queue-url ${Q('pedidos')} --attribute-names All`],
        hints: ['La DLQ va primero (la otra cola necesita su ARN): `aws sqs create-queue --queue-name pedidos-dlq`.', '`aws sqs create-queue --queue-name pedidos --attributes file://atributos.json`.', 'Comprueba con `aws sqs get-queue-attributes --queue-url <url> --attribute-names All`.'],
        explain: 'La `RedrivePolicy` va en la cola de origen y apunta a la ARN de la DLQ. Se guarda en un archivo porque es JSON dentro de JSON y las comillas se vuelven un infierno.',
        par: 3,
        commands: ['Amazon SQS', 'Cola de mensajes muertos (DLQ)'],
      }),
      learn(
        'SNS: un mensaje, muchos destinos',
        `
SQS entrega cada mensaje **a un consumidor**. **SNS** hace lo contrario: publicas un mensaje en un **tema** y SNS lo copia a **todos los suscriptores** (colas SQS, funciones, correo, SMS…). Es el «fan-out»: un pedido nuevo avisa a facturación, a envíos y a analítica a la vez, cada uno con su cola y a su ritmo.

Dos detalles que hacen perder tardes:

- **SNS → SQS** necesita una **política en la cola** que permita a \`sns.amazonaws.com\` enviar desde ese tema. Sin ella, **los mensajes se pierden sin avisar**.
- Cada suscripción puede tener una **política de filtro** sobre los **atributos** del mensaje: \`{"tipo": ["fisico"]}\` hace que solo reciba los pedidos físicos.

\`aws sns publish --topic-arn <arn> --message "pedido 7" --message-attributes 'tipo={DataType=String,StringValue=fisico}'\`
`,
        '📣',
      ),
      match(
        'Une cada servicio con su papel',
        [
          ['SQS', 'Un mensaje lo procesa un solo consumidor'],
          ['SNS', 'Un mensaje se copia a todos los suscriptores'],
          ['DLQ', 'Aparta los mensajes que fallan demasiadas veces'],
          ['Tiempo de visibilidad', 'Oculta el mensaje mientras se procesa'],
        ],
        'SQS reparte trabajo (competencia entre consumidores); SNS reparte copias (todos reciben). La DLQ y la visibilidad son los mecanismos de reintento de SQS.',
      ),
      practice({
        prompt:
          'Pedidos nuevos deben llegar a **dos** colas: **`facturacion`** (todos los pedidos) y **`envios`** (solo los de `tipo = fisico`). El tema **`pedidos`** y las dos colas ya existen, sin conectar. Hazlo:\n\n1. Da a cada cola la política que admite al tema (`attrs-facturacion.json` es el modelo; para `envios` cambia el nombre con `sed`).\n2. Suscribe las dos colas al tema; la de `envios` con el filtro de `filtro.json`.\n\nNo publiques mensajes tú: el corrector probará con pedidos físicos y digitales.',
        goal: 'facturacion recibe todo y envios solo lo físico',
        setup: A('srv-fanout', { files: { '/home/alumno/attrs-facturacion.json': queuePolicy('facturacion'), '/home/alumno/filtro.json': FILTRO } }),
        check: all(
          awsAfter([`sns publish --topic-arn arn:aws:sns:us-east-1:123456789012:pedidos --message digital --message-attributes 'tipo={DataType=String,StringValue=digital}'`], count('facturacion', '1', 'facturacion debe recibir todos los pedidos')),
          awsAfter([`sns publish --topic-arn arn:aws:sns:us-east-1:123456789012:pedidos --message digital --message-attributes 'tipo={DataType=String,StringValue=digital}'`], count('envios', '0', 'envios no debe recibir los pedidos digitales')),
          awsAfter([`sns publish --topic-arn arn:aws:sns:us-east-1:123456789012:pedidos --message fisico --message-attributes 'tipo={DataType=String,StringValue=fisico}'`], count('envios', '1', 'envios debe recibir los pedidos físicos')),
        ),
        solution: [
          'TOPIC=arn:aws:sns:us-east-1:123456789012:pedidos',
          'QF=$(aws sqs get-queue-url --queue-name facturacion --query QueueUrl --output text)',
          'QE=$(aws sqs get-queue-url --queue-name envios --query QueueUrl --output text)',
          'aws sqs set-queue-attributes --queue-url $QF --attributes file://attrs-facturacion.json',
          "sed 's/facturacion/envios/g' attrs-facturacion.json > attrs-envios.json",
          'aws sqs set-queue-attributes --queue-url $QE --attributes file://attrs-envios.json',
          'aws sns subscribe --topic-arn $TOPIC --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:123456789012:facturacion',
          'aws sns subscribe --topic-arn $TOPIC --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:123456789012:envios --attributes file://filtro.json',
          'aws sns list-subscriptions-by-topic --topic-arn $TOPIC --query "Subscriptions[].Endpoint" --output text',
        ],
        hints: ['Las URLs de las colas: `aws sqs get-queue-url --queue-name envios`. La política se aplica con `aws sqs set-queue-attributes --queue-url <url> --attributes file://attrs-facturacion.json`.', 'Para `envios`: `sed \'s/facturacion/envios/g\' attrs-facturacion.json > attrs-envios.json` (cambia la cola en el ARN) y aplícala igual.', '`aws sns subscribe --topic-arn <tema> --protocol sqs --notification-endpoint <ARN de la cola>`; la de envíos con `--attributes file://filtro.json`.'],
        explain: 'Dos piezas por cola: la política (que SNS pueda escribir) y la suscripción (qué mensajes). El filtro sobre el atributo `tipo` evita que `envios` reciba pedidos digitales sin tocar ningún código.',
        par: 9,
        commands: ['Amazon SNS', 'aws sns publish'],
      }),
      learn(
        'SQS + Lambda y el mensaje «veneno»',
        `
Con una cola conectada a una función, un solo mensaje malformado puede quedarse **atascado para siempre**: la función falla, el mensaje vuelve, se reintenta, falla… y consume ejecuciones (y dinero) sin parar.

- Pon una **DLQ** en la cola de origen (\`maxReceiveCount\` 3–5): el mensaje malo se aparta y el resto sigue.
- **Una excepción en un lote devuelve el lote entero**: los mensajes buenos también se reintentan. Usa lotes pequeños o activa \`ReportBatchItemFailures\` y responde \`{"batchItemFailures": [{"itemIdentifier": "<messageId>"}]}\`.
- **Alarma** sobre los mensajes de la DLQ: si hay alguno, alguien debe mirar qué pasa.
- Haz el código **idempotente** (procesar dos veces lo mismo no debe romper nada).
`,
        '☠️',
      ),
      practice({
        prompt: 'La cola **`trabajos`** alimenta a la función `worker`, que **falla siempre** con el mensaje `{"malo": true}` y lo reintenta una y otra vez. Crea la cola **`trabajos-dlq`** y configura `trabajos` para que, tras **2 recepciones**, el mensaje malo se aparte (`redrive.json` tiene la política lista). Los mensajes buenos ya se procesan solos.',
        goal: 'El mensaje malo acaba en trabajos-dlq y trabajos queda vacía',
        setup: A('srv-veneno', { files: { '/home/alumno/redrive.json': REDRIVE_TRABAJOS } }),
        check: all(count('trabajos-dlq', '1', 'El mensaje malo todavía no está en trabajos-dlq'), count('trabajos', '0', 'La cola trabajos todavía no está vacía'), awsIs(attr('trabajos', 'ApproximateNumberOfMessagesNotVisible'), '0', 'Quedan mensajes en vuelo')),
        solution: ['aws sqs create-queue --queue-name trabajos-dlq', `aws sqs set-queue-attributes --queue-url ${Q('trabajos')} --attributes file://redrive.json`, `aws sqs get-queue-attributes --queue-url ${Q('trabajos')} --attribute-names RedrivePolicy`],
        hints: ['Primero la DLQ: `aws sqs create-queue --queue-name trabajos-dlq`.', '`aws sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/trabajos --attributes file://redrive.json`.'],
        explain: 'Con la DLQ, el mensaje que siempre falla se aparta tras `maxReceiveCount` intentos y la cola principal queda limpia. Después se revisa el contenido de la DLQ para entender el fallo.',
        par: 3,
        commands: ['Cola de mensajes muertos (DLQ)', 'aws lambda create-event-source-mapping'],
      }),
      multi('Elige TODAS las medidas que hacen más robusto a un consumidor de SQS con Lambda', ['Una DLQ con maxReceiveCount', 'Visibilidad de la cola mayor que el timeout de la función', 'Código idempotente', 'Poner la visibilidad a 0 para reintentar antes'], [0, 1, 2], 'Visibilidad 0 haría que el mensaje se reentregara al instante, incluso mientras se procesa.'),
    ]),
    // ───────────────────────── 4 ─────────────────────────
    lesson('a10-4', { title: 'EventBridge y Step Functions', summary: 'Reglas que reaccionan a eventos y flujos con decisiones y reintentos', emoji: '🕸️', commands: ['Amazon EventBridge', 'aws events put-events', 'AWS Step Functions', 'aws stepfunctions start-execution', 'Colas, temas, eventos y flujos'], minutes: 28 }, [
      learn(
        'EventBridge: reglas sobre eventos',
        `
**EventBridge** es un bus de eventos. Un servicio (o tu código) **publica un evento** —un JSON con \`source\`, \`detail-type\` y \`detail\`— y las **reglas** del bus lo encaminan a sus **destinos** (funciones, colas, temas, máquinas de estados…).

- Una regla filtra por un **patrón**: \`{"source": ["tienda.pedidos"], "detail": {"total": [{"numeric": [">", 100]}]}}\`. Admite igualdad, \`prefix\`, \`anything-but\`, \`numeric\` y \`exists\`.
- O se dispara por **tiempo**: \`rate(5 minutes)\` o \`cron(0 3 * * ? *)\` (el «cron» de la nube).
- Un evento puede coincidir con **varias** reglas, o con **ninguna** (entonces se descarta).
- **Cada destino necesita permiso**: la función, en su política de recursos (\`events.amazonaws.com\`); la cola, en su política. Si falta, el evento **se pierde sin error**.
`,
        '🚌',
      ),
      illus('aws-event-routing', 'Qué reglas reciben cada evento', 'Elige un evento, cambia el umbral y mira a qué reglas llega.'),
      mc('Quieres que una función se ejecute cada noche a las 3:00. ¿Qué usas?', ['Una regla de EventBridge con programación `cron(0 3 * * ? *)`', 'Una cola SQS con visibilidad de 24 horas', 'Un tema SNS con retraso', 'Una API HTTP que llame a la función'], 0, 'EventBridge es el planificador de la nube: una regla programada con la función como destino (y su permiso para `events.amazonaws.com`).'),
      demo(
        'Probar un patrón antes de crear la regla',
        [
          ['aws events test-event-pattern --event-pattern \'{"source":["tienda.pedidos"],"detail":{"total":[{"numeric":[">",100]}]}}\' --event \'{"source":"tienda.pedidos","detail-type":"PedidoCreado","detail":{"total":250},"region":"us-east-1"}\' --query Result', '250 > 100: coincide'],
          ['aws events test-event-pattern --event-pattern \'{"source":["tienda.pedidos"],"detail":{"total":[{"numeric":[">",100]}]}}\' --event \'{"source":"tienda.pedidos","detail-type":"PedidoCreado","detail":{"total":40},"region":"us-east-1"}\' --query Result', '40 no supera 100'],
          ['aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/grandes --attribute-names Policy --query Attributes.Policy --output text', 'La cola solo admite eventos de la regla pedidos-grandes: el nombre importa'],
        ],
        A('srv-eventos'),
        '`test-event-pattern` no publica nada: solo dice si un evento encajaría.',
      ),
      practice({
        prompt: 'La función **`limpieza`** debe ejecutarse **cada 5 minutos**. Crea la regla **`cada-5-min`** con la programación `rate(5 minutes)`, añade la función como destino y dale permiso a EventBridge para invocarla (limitado a esa regla con `--source-arn`).',
        goal: 'limpieza se ejecuta sola cada 5 minutos',
        setup: A('srv-cron'),
        check: all(awsHas('events list-targets-by-rule --rule cada-5-min --query "Targets[].Arn" --output text', ':function:limpieza', 'La regla cada-5-min todavía no tiene la función como destino'), awsMatches('logs filter-log-events --log-group-name /aws/lambda/limpieza --filter-pattern limpiando --query length(events) --output text', '^[1-9]', 'La función todavía no se ha ejecutado sola (¿falta el permiso?)')),
        solution: [
          'RULE=$(aws events put-rule --name cada-5-min --schedule-expression "rate(5 minutes)" --query RuleArn --output text)',
          'FN=$(aws lambda get-function --function-name limpieza --query Configuration.FunctionArn --output text)',
          'aws events put-targets --rule cada-5-min --targets Id=1,Arn=$FN',
          'aws lambda add-permission --function-name limpieza --statement-id eventbridge --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn $RULE',
        ],
        hints: ['`aws events put-rule --name cada-5-min --schedule-expression "rate(5 minutes)"` devuelve el ARN de la regla.', '`aws events put-targets --rule cada-5-min --targets Id=1,Arn=<ARN de la función>`.', 'Sin el permiso, la regla dispara pero la función no se ejecuta: `aws lambda add-permission … --principal events.amazonaws.com --source-arn <ARN de la regla>`.'],
        explain: 'Tres piezas: la regla con su programación, el destino y el permiso. Si falta el permiso, EventBridge intenta invocar y falla sin que veas ningún error.',
        par: 4,
        commands: ['Amazon EventBridge', 'aws lambda add-permission'],
      }),
      practice({
        prompt: 'Los pedidos grandes deben ir a la cola **`grandes`**. Crea la regla **`pedidos-grandes`** que envíe a esa cola los eventos con `source` **`tienda.pedidos`**, `detail-type` **`PedidoCreado`** y `detail.total` **mayor que 100**. La cola ya admite eventos, pero solo de una regla con ese nombre. Usa `aws events test-event-pattern` para probar tu patrón antes de crear la regla.',
        goal: 'Solo los pedidos de más de 100 € llegan a la cola grandes',
        setup: A('srv-eventos'),
        check: awsAfter(
          [
            entries([
              { source: 'tienda.pedidos', type: 'PedidoCreado', total: 50 },
              { source: 'tienda.pedidos', type: 'PedidoCreado', total: 500 },
              { source: 'tienda.envios', type: 'EnvioSalido', total: 900 },
            ]),
          ],
          count('grandes', '1', 'A la cola grandes solo debe llegar el pedido de 500 (ni el de 50 ni el de otra fuente)'),
        ),
        solution: [
          `aws events test-event-pattern --event-pattern '{"source":["tienda.pedidos"],"detail-type":["PedidoCreado"],"detail":{"total":[{"numeric":[">",100]}]}}' --event '{"source":"tienda.pedidos","detail-type":"PedidoCreado","detail":{"total":250},"region":"us-east-1"}' --query Result`,
          `aws events put-rule --name pedidos-grandes --event-pattern '{"source":["tienda.pedidos"],"detail-type":["PedidoCreado"],"detail":{"total":[{"numeric":[">",100]}]}}'`,
          `aws events put-targets --rule pedidos-grandes --targets Id=1,Arn=${QARN('grandes')}`,
        ],
        hints: ['El patrón: `{"source":["tienda.pedidos"],"detail-type":["PedidoCreado"],"detail":{"total":[{"numeric":[">",100]}]}}`.', '`aws events put-rule --name pedidos-grandes --event-pattern \'<patrón>\'` y después `aws events put-targets --rule pedidos-grandes --targets Id=1,Arn=<ARN de la cola>`.'],
        explain: 'Un patrón con tres condiciones. Las condiciones de distintos campos se combinan con «y»; los valores de un mismo campo, con «o». El nombre de la regla importa aquí porque la política de la cola menciona su ARN.',
        par: 3,
        commands: ['Amazon EventBridge', 'aws events put-events'],
      }),
      learn(
        'Step Functions: un flujo con memoria',
        `
Encadenar funciones llamándose unas a otras es frágil: ¿qué pasa si la segunda falla? ¿y si hay que esperar 3 días? **Step Functions** es una **máquina de estados** que ejecuta los pasos en orden y se encarga de decisiones, reintentos y errores. Se define en JSON (Amazon States Language):

| Estado | Para qué |
| --- | --- |
| **Task** | Ejecuta algo: una función, o directamente SQS/SNS/DynamoDB sin código |
| **Choice** | Decide según los datos (\`$.valido == true\`) |
| **Wait**, **Parallel**, **Map** | Esperas, ramas simultáneas, uno por elemento |
| **Succeed / Fail** | Terminar bien o con un error |

Cada estado puede llevar **Retry** (intentos, espera creciente con \`BackoffRate\`) y **Catch** (a qué estado ir si sigue fallando). La **salida** de un estado es la **entrada** del siguiente.

La máquina usa su **propio rol**, que debe poder invocar todo lo que llama. Tipos: **Standard** (hasta 1 año, historial completo, se cobra por transición) y **Express** (hasta 5 minutos, mucho volumen, se cobra por duración).
`,
        '🧭',
      ),
      match(
        'Une cada necesidad con el estado o la opción',
        [
          ['Seguir solo si el pedido es válido', 'Choice'],
          ['Reintentar un paso con espera creciente', 'Retry'],
          ['Ir a otra rama si un paso sigue fallando', 'Catch'],
          ['Esperar 24 horas antes del siguiente paso', 'Wait'],
        ],
        'Estas cuatro piezas son lo que convierte una cadena de funciones en un flujo robusto.',
      ),
      practice({
        prompt:
          'Crea la máquina de estados **`pedido`** con la definición de `flujo.json` y el rol **`sfn-role`** (que ya puede invocar las funciones). Después ejecútala dos veces:\n\n- con `pedido.json` (un pedido válido): debe terminar **SUCCEEDED**,\n- con `pedido-invalido.json` (total negativo): el *Choice* lo manda a *Fail* y debe terminar **FAILED**.',
        goal: 'Una ejecución SUCCEEDED y otra FAILED de la máquina pedido',
        setup: A('srv-sfn', { files: { '/home/alumno/flujo.json': SRV_ASL, '/home/alumno/pedido.json': PEDIDO, '/home/alumno/pedido-invalido.json': PEDIDO_MALO } }),
        check: all(
          awsMatches(`stepfunctions list-executions --state-machine-arn ${SM} --status-filter SUCCEEDED --query "length(executions)" --output text`, '^[1-9]', 'Falta una ejecución que termine SUCCEEDED (con pedido.json)'),
          awsMatches(`stepfunctions list-executions --state-machine-arn ${SM} --status-filter FAILED --query "length(executions)" --output text`, '^[1-9]', 'Falta una ejecución que termine FAILED (con pedido-invalido.json)'),
        ),
        solution: [
          ROLE('ROLE', 'sfn-role'),
          'SM=$(aws stepfunctions create-state-machine --name pedido --definition file://flujo.json --role-arn $ROLE --query stateMachineArn --output text)',
          'aws stepfunctions start-execution --state-machine-arn $SM --name ok --input file://pedido.json',
          'aws stepfunctions start-execution --state-machine-arn $SM --name rechazado --input file://pedido-invalido.json',
          'aws stepfunctions list-executions --state-machine-arn $SM --query "executions[].[name,status]" --output text',
        ],
        hints: ['`aws stepfunctions create-state-machine --name pedido --definition file://flujo.json --role-arn <arn de sfn-role>` devuelve el ARN de la máquina.', '`aws stepfunctions start-execution --state-machine-arn <arn> --input file://pedido.json` (y lo mismo con `pedido-invalido.json`).', 'Mira el resultado con `aws stepfunctions list-executions --state-machine-arn <arn>`.'],
        explain: 'El mismo flujo, dos caminos: con un pedido válido pasa por Validar → Cobrar → Notificar; con uno inválido, el Choice lo desvía a Fail. Y todo queda en el historial de la ejecución para auditarlo.',
        par: 4,
        commands: ['AWS Step Functions', 'aws stepfunctions start-execution'],
      }),
      practice({
        prompt: 'La máquina **`pedido`** ya existe, pero su ejecución **`primera`** terminó en **FAILED**. Averigua por qué (`describe-execution`) y arréglalo para que una **nueva ejecución** con `pedido.json` termine **SUCCEEDED**. Da al rol solo lo necesario.',
        goal: 'Una nueva ejecución de pedido termina SUCCEEDED',
        setup: A('srv-sfn-roto', { files: { '/home/alumno/pedido.json': PEDIDO } }),
        check: awsMatches(`stepfunctions list-executions --state-machine-arn ${SM} --status-filter SUCCEEDED --query "length(executions)" --output text`, '^[1-9]', 'Todavía no hay ninguna ejecución SUCCEEDED'),
        solution: [
          'aws stepfunctions describe-execution --execution-arn arn:aws:states:us-east-1:123456789012:execution:pedido:primera --query "[status,error,cause]" --output text',
          `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:us-east-1:123456789012:function:*"}]}' > permisos.json`,
          'aws iam put-role-policy --role-name sfn-role --policy-name invoca-lambda --policy-document file://permisos.json',
          `aws stepfunctions start-execution --state-machine-arn ${SM} --name segunda --input file://pedido.json`,
        ],
        hints: ['`aws stepfunctions describe-execution --execution-arn arn:aws:states:us-east-1:123456789012:execution:pedido:primera` indica el error y la causa.', 'El rol `sfn-role` no tiene ningún permiso: añade una política en línea con `lambda:InvokeFunction`.', 'Después, una nueva `start-execution` con `--input file://pedido.json`.'],
        explain: 'El rol de una máquina de estados es una pieza más con sus permisos mínimos. Una ejecución que falla no se «reintenta sola» tras arreglar el rol: lanzas una nueva.',
        par: 4,
        commands: ['AWS Step Functions', 'aws stepfunctions start-execution'],
      }),
      tf('«Si EventBridge no puede entregar un evento a una función porque falta el permiso, te avisa con un error al crear la regla.»', false, 'No: la regla se crea bien y los eventos se pierden en silencio. Por eso conviene probar de extremo a extremo y revisar las métricas `FailedInvocations`.'),
      mc('Necesitas un flujo con 12 pasos, decisiones, reintentos y esperas de horas. ¿Qué eliges?', ['Una cola SQS', 'Un tema SNS con 12 suscripciones', 'Step Functions (Standard)', 'Una función Lambda que llame a las demás'], 2, 'Step Functions Standard soporta duraciones largas, guarda el historial de cada paso y gestiona reintentos y errores sin que escribas esa lógica.'),
    ]),
    // ───────────────────────── 5 ─────────────────────────
    lesson('a10-5', { title: 'Cognito y seguridad serverless', summary: 'Usuarios, tokens y APIs protegidas; eventos de S3 sin bucles', emoji: '🪪', commands: ['Amazon Cognito', 'aws cognito-idp initiate-auth', 'Notificaciones de eventos de S3', 'aws s3api put-bucket-notification-configuration', 'Rol de ejecución y política de recursos'], minutes: 28 }, [
      learn(
        'Usuarios en tu aplicación: Cognito',
        `
**Amazon Cognito** gestiona el registro e inicio de sesión de los usuarios de tu web o app:

- **Grupo de usuarios**: el directorio (registro, confirmación por correo, contraseñas con política, grupos…).
- **Cliente de aplicación**: cada app tiene el suyo, con los **flujos** que permite. \`USER_PASSWORD_AUTH\` **no viene activado**: sin él, \`initiate-auth\` falla.
- Al iniciar sesión recibes tres tokens JWT: **IdToken** (quién eres: email, nombre), **AccessToken** (qué puedes hacer: grupos y ámbitos) y **RefreshToken** (30 días, para pedir otros nuevos). Los dos primeros duran **1 hora**.

En el simulador, el código del correo de confirmación es siempre **123456**.

**API Gateway** puede verificar esos tokens por ti con un **autorizador JWT**: comprueba la firma, el emisor (\`iss\`, el grupo de usuarios), la audiencia (\`aud\`, el cliente) y la caducidad, sin llamar a Cognito. Tu función recibe los datos del usuario en \`event['requestContext']['authorizer']['jwt']['claims']\`.
`,
        '🪪',
      ),
      illus('aws-cognito-flow', 'Del registro al token y a la API', 'Rompe cada paso (flujo no activado, sin confirmar, token caducado, audiencia errónea) y mira el error que aparece.'),
      mc('Tu función necesita saber el correo del usuario que llama. ¿De qué token viene ese dato?', ['Del IdToken', 'Del RefreshToken', 'De ninguno: Cognito no entrega correos', 'Del cliente de aplicación'], 0, 'El IdToken contiene los atributos de la persona (email, nombre…). El AccessToken describe lo que puede hacer (grupos, ámbitos).'),
      practice({
        prompt:
          'Monta el inicio de sesión de la tienda:\n\n1. Un grupo de usuarios **`tienda`** que use el **correo como nombre de usuario**.\n2. Un cliente de aplicación **`web`** con los flujos **`ALLOW_USER_PASSWORD_AUTH`** y **`ALLOW_REFRESH_TOKEN_AUTH`**.\n3. Registra a **`ana@tienda.es`** (contraseña `Secreto#2026`), confírmala (el código es `123456`) e inicia sesión para comprobar que recibes tokens.',
        goal: 'ana@tienda.es confirmada y con el flujo de contraseña habilitado',
        setup: A('base'),
        check: all(awsIs(`_check cognito --query "Users[?Status=='CONFIRMED'] | length(@)"`, 1, 'Falta un usuario confirmado'), awsHas('_check cognito --query "Clients[].Flows[]"', 'ALLOW_USER_PASSWORD_AUTH', 'El cliente no permite iniciar sesión con usuario y contraseña')),
        solution: [
          'POOL=$(aws cognito-idp create-user-pool --pool-name tienda --username-attributes email --auto-verified-attributes email --query UserPool.Id --output text)',
          'CLIENT=$(aws cognito-idp create-user-pool-client --user-pool-id $POOL --client-name web --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH --query UserPoolClient.ClientId --output text)',
          "aws cognito-idp sign-up --client-id $CLIENT --username ana@tienda.es --password 'Secreto#2026'",
          'aws cognito-idp confirm-sign-up --client-id $CLIENT --username ana@tienda.es --confirmation-code 123456',
          "aws cognito-idp initiate-auth --client-id $CLIENT --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD='Secreto#2026' --query AuthenticationResult.ExpiresIn",
        ],
        hints: ['`aws cognito-idp create-user-pool --pool-name tienda --username-attributes email --auto-verified-attributes email` devuelve el id del grupo (`UserPool.Id`).', '`aws cognito-idp create-user-pool-client --user-pool-id <id> --client-name web --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH`.', '`sign-up` (queda UNCONFIRMED), `confirm-sign-up … --confirmation-code 123456` y `initiate-auth --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=…,PASSWORD=…`.'],
        explain: 'Registro → confirmación → inicio de sesión. Si olvidas habilitar `ALLOW_USER_PASSWORD_AUTH`, `initiate-auth` responde «flow not enabled for this client»: es el fallo número uno con Cognito.',
        par: 5,
        commands: ['Amazon Cognito', 'aws cognito-idp initiate-auth'],
      }),
      practice({
        prompt: 'La API **`perfil-api`** tiene la ruta `GET /perfil` **abierta a todo el mundo**. Protégela con un **autorizador JWT** que acepte solo tokens de tu grupo de usuarios y de su cliente de aplicación:\n\n- `Issuer`: `https://cognito-idp.us-east-1.amazonaws.com/<id del grupo>`\n- `Audience`: el id del cliente de aplicación\n- `identity-source`: `$request.header.Authorization`\n\nCrea el autorizador y asócialo a la ruta (`update-route`).',
        goal: 'GET /perfil exige un token válido de Cognito',
        setup: A('srv-auth'),
        check: all(awsIs('_check http --url api:first/perfil --query Status', 401, 'Sin token la ruta debe responder 401'), awsIs('_check http --url api:first/perfil --bearer-of ana@tienda.es --query Status', 200, 'Con el token de ana debe responder 200')),
        solution: [
          POOL,
          CLIENT,
          'API=$(aws apigatewayv2 get-apis --query "Items[0].ApiId" --output text)',
          AUTHORIZER,
          'ROUTE=$(aws apigatewayv2 get-routes --api-id $API --query "Items[0].RouteId" --output text)',
          'aws apigatewayv2 update-route --api-id $API --route-id $ROUTE --authorization-type JWT --authorizer-id $AUTH',
          'curl -s -o /dev/null -w "%{http_code}\\n" $(aws apigatewayv2 get-apis --query "Items[0].ApiEndpoint" --output text)/perfil',
        ],
        hints: ['El id del grupo: `aws cognito-idp list-user-pools --max-results 10`; el del cliente: `aws cognito-idp list-user-pool-clients --user-pool-id <id>`.', '`aws apigatewayv2 create-authorizer --api-id <api> --authorizer-type JWT --identity-source \'$request.header.Authorization\' --name cognito --jwt-configuration Audience=<cliente>,Issuer=<url>`.', '`aws apigatewayv2 update-route --api-id <api> --route-id <ruta> --authorization-type JWT --authorizer-id <autorizador>`. El id de la ruta: `aws apigatewayv2 get-routes --api-id <api>`.'],
        explain: 'API Gateway rechaza con 401 lo que no trae un token válido (firma, emisor, audiencia y caducidad) y tu función ni se ejecuta. Dentro de la función recibes los claims del usuario ya verificados.',
        par: 7,
        commands: ['Amazon Cognito', 'Amazon API Gateway'],
      }),
      learn(
        'Seguridad en serverless',
        `
Sin servidores que parchear, tu superficie de ataque cambia de sitio. Las reglas de oro:

- **Un rol por función, con el mínimo privilegio**: acciones concretas sobre recursos concretos (ARN), nunca \`*:*\`.
- **Política de recursos con \`--source-arn\`**: solo ESA API, ESE bucket o ESA regla pueden invocar la función.
- **Nada de claves en el código ni en variables de entorno**: el rol entrega credenciales temporales. Los secretos van en **Secrets Manager** o **Parameter Store** (los verás más adelante).
- **Valida la entrada** (el \`event\` lo controla quien llama): longitudes, tipos y campos obligatorios, como hace \`recibe.py\` con su 400.
- **Límites**: concurrencia reservada para proteger la base de datos, y *throttling* en la API.
- **Idempotencia**: SQS, SNS, EventBridge y S3 entregan «al menos una vez».
- **Cuidado con los bucles**: una función que escribe en el mismo bucket que la dispara se invoca a sí misma sin parar (y a ti te cobran cada vuelta).
`,
        '🛡️',
      ),
      mc('Una función solo necesita guardar pedidos en la tabla `pedidos`. ¿Qué permiso es el correcto?', ['`dynamodb:*` sobre `*`', '`dynamodb:PutItem` sobre el ARN de la tabla `pedidos`', 'AdministratorAccess', '`dynamodb:PutItem` sobre `*`'], 1, 'Una acción y un recurso. Si la función se compromete, lo único que puede hacer el atacante es escribir en esa tabla.'),
      learn(
        'S3 dispara una función',
        `
Un bucket puede avisar cuando se crea o borra un objeto. Con \`put-bucket-notification-configuration\` indicas los **eventos** (\`s3:ObjectCreated:*\`), un **filtro** de \`prefix\`/\`suffix\` y el **destino** (función, cola, tema o EventBridge).

Cosas que muerden:

- **S3 valida el destino antes de guardar**: la función debe tener un permiso para \`s3.amazonaws.com\` con el ARN del bucket. Si no: *Unable to validate the following destination configurations*.
- En el evento, el **nombre del objeto va codificado como URL** (los espacios son \`+\`): usa \`urllib.parse.unquote_plus\`.
- Dos reglas que se solapan para el mismo evento dan *Configuration is ambiguously defined*.
- **Bucle infinito**: si la función escribe en el **mismo bucket y prefijo** que la dispara, se llama a sí misma sin fin. Escribe en otro bucket (o prefijo filtrado). Lambda corta las cadenas recursivas a las 16 invocaciones.
`,
        '🪣',
      ),
      tf('«Una función disparada por la subida de un objeto a un bucket puede guardar el resultado en ese mismo bucket sin ningún riesgo.»', false, 'Cada objeto nuevo vuelve a disparar la función, que crea otro objeto, que la vuelve a disparar… Escribe en otro bucket o filtra por prefijo.'),
      practice({
        prompt:
          'Las fotos que se suban a **`tienda-fotos-originales`** deben generar su miniatura con la función **`miniatura`** (que guarda en `tienda-fotos-miniaturas`). Solo los archivos que acaben en **`.jpg`**. En `notificacion.json` tienes la configuración. Aplícala (¡fíjate en el orden: S3 comprueba el destino antes de guardar!).',
        goal: 'Subir un .jpg crea su miniatura; un .txt no',
        setup: A('srv-s3ev', { files: { '/home/alumno/notificacion.json': NOTIF_FOTOS } }),
        check: awsAfter(['_check put --bucket tienda-fotos-originales --key a.jpg --body JPEG', '_check put --bucket tienda-fotos-originales --key nota.txt --body hola'], awsIs('s3api list-objects-v2 --bucket tienda-fotos-miniaturas --query "Contents[].Key"', ['a.jpg'], 'Solo el .jpg debe generar su miniatura')),
        solution: ['aws lambda add-permission --function-name miniatura --statement-id s3 --action lambda:InvokeFunction --principal s3.amazonaws.com --source-arn arn:aws:s3:::tienda-fotos-originales --source-account 123456789012', 'aws s3api put-bucket-notification-configuration --bucket tienda-fotos-originales --notification-configuration file://notificacion.json', 'aws s3api get-bucket-notification-configuration --bucket tienda-fotos-originales'],
        hints: ['Si lo aplicas directamente verás «Unable to validate the following destination configurations»: la función no admite a S3.', '`aws lambda add-permission --function-name miniatura --statement-id s3 --action lambda:InvokeFunction --principal s3.amazonaws.com --source-arn arn:aws:s3:::tienda-fotos-originales --source-account 123456789012`.', 'Después, `aws s3api put-bucket-notification-configuration --bucket tienda-fotos-originales --notification-configuration file://notificacion.json`.'],
        explain: 'El permiso primero, la configuración después: S3 valida el destino antes de guardar. `--source-account` evita que otra cuenta use un bucket con tu mismo nombre para invocar tu función.',
        par: 3,
        commands: ['Notificaciones de eventos de S3', 'aws s3api put-bucket-notification-configuration'],
      }),
      match(
        'Une cada error con su arreglo',
        [
          ['«flow not enabled for this client»', 'Activar ALLOW_USER_PASSWORD_AUTH en el cliente'],
          ['401 con un token que parece correcto', 'Revisar emisor, audiencia y caducidad del token'],
          ['«Unable to validate the following destination configurations»', 'Dar permiso a s3.amazonaws.com en la función'],
          ['Un 500 sin logs nuevos en la función', 'Añadir la política de recursos para API Gateway'],
        ],
        'Cuatro errores clásicos de serverless; cada uno señala una configuración concreta (flujo, token, permiso de S3, permiso de API).',
      ),
    ]),
  ],
  boss: {
    prompt:
      'Misión final: **«Pedidos sin servidores»**. La tienda quiere recibir pedidos por una API, sin un solo servidor. Ya existen la tabla **`pedidos`** de DynamoDB, el grupo de usuarios de Cognito (con la usuaria `ana@tienda.es`), los roles **`recibe-role`** y **`procesa-role`** (solo con permiso de logs) y el código en **`recibe.py`** y **`procesa.py`**. Monta todo:\n\n1. Cola **`pedidos-dlq`** y cola **`pedidos`** (visibilidad 60 s, a la DLQ tras 3 recepciones): usa `atributos.json`.\n2. Permisos: `recibe-role` solo **envía** a la cola (`permisos-recibe.json`); `procesa-role` solo **escribe** en la tabla (`permisos-procesa.json`) y lee la cola con la política gestionada `AWSLambdaSQSQueueExecutionRole`.\n3. Funciones **`recibe`** (variable de entorno `COLA_URL` con la URL de la cola) y **`procesa`** (timeout de 10 s); conecta la cola `pedidos` con `procesa`.\n4. Una API HTTP con la ruta **`POST /pedidos`** hacia `recibe`, protegida con un autorizador **JWT de Cognito** (con el permiso de invocación).\n\nCuando termines: **sin token → 401**; con token y un JSON con `sku` y `cantidad` → **202** y, al poco, el pedido aparece en la tabla; con un cuerpo que no es JSON → **400**.',
    goal: 'POST /pedidos con token guarda el pedido en DynamoDB a través de SQS',
    setup: A('srv-boss', {
      files: {
        '/home/alumno/recibe.py': SRV_CODE.recibe,
        '/home/alumno/procesa.py': SRV_CODE.procesa,
        '/home/alumno/atributos.json': ATTR_PEDIDOS,
        '/home/alumno/permisos-recibe.json': POLICY_RECIBE,
        '/home/alumno/permisos-procesa.json': POLICY_PROCESA,
      },
    }),
    check: all(
      awsHas(`sqs get-queue-attributes --queue-url ${Q('pedidos')} --attribute-names RedrivePolicy --query Attributes.RedrivePolicy`, 'pedidos-dlq', 'La cola pedidos necesita su cola de mensajes muertos pedidos-dlq'),
      awsIs(`_check http --url api:first/pedidos --method POST --body '{"sku":"A1","cantidad":2}' --query Status`, 401, 'Sin token, la API debe responder 401'),
      awsIs(`_check http --url api:first/pedidos --method POST --bearer-of ana@tienda.es --body 'esto no es json' --query Status`, 400, 'Con token y un cuerpo que no es JSON debe responder 400'),
      awsIs(`_check http --url api:first/pedidos --method POST --bearer-of ana@tienda.es --body '{"sku":"A1","cantidad":2}' --query Status`, 202, 'Con token y un pedido válido debe responder 202'),
      awsAfter([`_check http --url api:first/pedidos --method POST --bearer-of ana@tienda.es --body '{"sku":"A1","cantidad":2}'`], awsIs('dynamodb scan --table-name pedidos --query Count', 1, 'El pedido debe acabar guardado en la tabla (¿permisos? ¿conexión cola → procesa?)')),
    ),
    solution: [
      'aws sqs create-queue --queue-name pedidos-dlq',
      'aws sqs create-queue --queue-name pedidos --attributes file://atributos.json',
      'QURL=$(aws sqs get-queue-url --queue-name pedidos --query QueueUrl --output text)',
      'aws iam put-role-policy --role-name recibe-role --policy-name enviar-pedidos --policy-document file://permisos-recibe.json',
      'aws iam put-role-policy --role-name procesa-role --policy-name guardar-pedidos --policy-document file://permisos-procesa.json',
      'aws iam attach-role-policy --role-name procesa-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole',
      'zip recibe.zip recibe.py',
      'zip procesa.zip procesa.py',
      ROLE('RR', 'recibe-role'),
      ROLE('PR', 'procesa-role'),
      'RECIBE=$(aws lambda create-function --function-name recibe --runtime python3.12 --role $RR --handler recibe.lambda_handler --zip-file fileb://recibe.zip --environment "Variables={COLA_URL=$QURL}" --query FunctionArn --output text)',
      'aws lambda create-function --function-name procesa --runtime python3.12 --role $PR --handler procesa.lambda_handler --zip-file fileb://procesa.zip --timeout 10',
      `aws lambda create-event-source-mapping --function-name procesa --event-source-arn ${QARN('pedidos')} --batch-size 5`,
      POOL,
      CLIENT,
      'API=$(aws apigatewayv2 create-api --name pedidos-api --protocol-type HTTP --query ApiId --output text)',
      'INT=$(aws apigatewayv2 create-integration --api-id $API --integration-type AWS_PROXY --integration-uri $RECIBE --payload-format-version 2.0 --query IntegrationId --output text)',
      AUTHORIZER,
      'aws apigatewayv2 create-route --api-id $API --route-key "POST /pedidos" --target integrations/$INT --authorization-type JWT --authorizer-id $AUTH',
      "aws apigatewayv2 create-stage --api-id $API --stage-name '$default' --auto-deploy",
      'aws lambda add-permission --function-name recibe --statement-id apigateway --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:123456789012:$API/*/*/pedidos"',
    ],
    hints: [
      'Empieza por la mensajería: `pedidos-dlq`, luego `pedidos` con `--attributes file://atributos.json`. Después los permisos: `aws iam put-role-policy --role-name recibe-role --policy-name … --policy-document file://permisos-recibe.json` (y lo mismo con procesa), más `attach-role-policy` de `AWSLambdaSQSQueueExecutionRole` al rol de procesa.',
      'Las funciones: `zip` + `create-function` con handler `recibe.lambda_handler` / `procesa.lambda_handler`. `recibe` necesita `--environment "Variables={COLA_URL=<url de la cola>}"` y `procesa` `--timeout 10`. Conecta con `aws lambda create-event-source-mapping --function-name procesa --event-source-arn <arn de la cola pedidos>`.',
      'La API, pieza a pieza: `create-api`, `create-integration` (AWS_PROXY, formato 2.0), `create-authorizer` (JWT con el grupo y el cliente de Cognito), `create-route "POST /pedidos"` con `--authorization-type JWT --authorizer-id`, `create-stage \'$default\' --auto-deploy` y, sin olvidarlo, `lambda add-permission` para `apigateway.amazonaws.com`.',
    ],
    explain: 'Has montado una arquitectura serverless de verdad: una API autenticada con Cognito, una función que valida y encola, una cola con su DLQ que absorbe los picos, y una función que guarda en DynamoDB. Cada pieza con su rol de mínimo privilegio y cada servicio con su permiso de invocación. Ni un servidor.',
    commands: ['AWS Lambda', 'Amazon API Gateway', 'Amazon SQS', 'Amazon Cognito'],
  },
});

