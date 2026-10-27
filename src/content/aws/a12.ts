import { IAC_FILES } from '@/awsengine/scenarios-iac';
import { A, all, awsAfter, awsFails, awsHas, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd } from './awsbuild';

const stackStatus = (name: string) => `cloudformation describe-stacks --stack-name ${name} --query "Stacks[0].StackStatus"`;
const lastExec = (name: string) => `codepipeline list-pipeline-executions --pipeline-name ${name} --query "pipelineExecutionSummaries[0].status"`;
const pipeFail = (name: string) => `aws codepipeline list-action-executions --pipeline-name ${name} --query "actionExecutionDetails[?status=='Failed'].output.executionResult.errorDetails.message | [0]" --output text`;
const stateTable = (name: string) => `aws codepipeline get-pipeline-state --name ${name} --query "stageStates[].[stageName,latestExecution.status]" --output text`;
const INVOKE = (fn: string) => `aws lambda invoke --function-name ${fn} --cli-binary-format raw-in-base64-out --payload '{}' salida.json && cat salida.json`;
const CAPS = '--capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND';

export const a12 = awsWorld({
  id: 'a12',
  index: 12,
  title: 'IaC y CI/CD',
  subtitle: 'CloudFormation, SAM, CDK, CodePipeline y despliegues seguros',
  emoji: '🏗️',
  color: '#F472B6',
  level: 'intermedio',
  intro:
    'Una infraestructura que solo existe en la consola es una infraestructura que nadie puede repetir, revisar ni arreglar a las tres de la mañana. En esta zona la describes como **código**: **CloudFormation** con parámetros, conjuntos de cambios y detección de deriva; **SAM** y **CDK** para escribir menos; y una **canalización de entrega continua** (CodeBuild, CodePipeline, CodeDeploy) que lleva cada cambio a producción con pruebas, aprobaciones y vuelta atrás automática. Todo funciona en tu cuenta simulada, incluidas compilaciones que ejecutan `pytest` y funciones Python reales.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a12-1', { title: 'CloudFormation: plantillas, parámetros y salidas', summary: 'Describir la infraestructura en un archivo y crearla como una unidad', emoji: '📄', commands: ['AWS CloudFormation', 'Plantilla de CloudFormation', 'Funciones intrínsecas de CloudFormation', 'Parámetros, salidas y exportaciones'], minutes: 28 }, [
      learn(
        'Infraestructura como código',
        `
Si montas todo pulsando botones en la consola, el resultado vive solo en tu cabeza: nadie puede **repetirlo** en otra cuenta, **revisarlo** antes de que exista, ni saber **qué cambió** cuando algo se rompe. La **infraestructura como código** (IaC) cambia el enfoque: escribes un archivo que dice *qué* debe existir y una herramienta lo hace realidad.

En AWS esa herramienta es **CloudFormation**:

1. Escribes una **plantilla** (YAML o JSON) con los recursos que quieres.
2. Se la das a CloudFormation: crea una **pila** (*stack*).
3. La pila es una **unidad**: sus recursos se crean, se actualizan y se borran juntos. Si algo falla al crearla, **se deshace todo** (*rollback*).

Ventajas: es **repetible** (la misma plantilla en dev, pre y prod), **revisable** (va a git como cualquier código) y **declarativa**: tú dices el resultado y CloudFormation calcula el orden y los pasos.

Es **gratis**: solo pagas los recursos que crea.
`,
        '📄',
      ),
      illus('aws-cfn-flow', 'De la plantilla a la pila', 'Cambia el entorno y activa el fallo de la función: mira qué recursos se crean, en qué orden y qué pasa cuando algo falla.'),
      mc('Una pila de CloudFormation falla a mitad de la creación. ¿Qué hace por defecto CloudFormation?', ['Deja lo que ya había creado y se detiene', 'Deshace lo creado y deja la pila en `ROLLBACK_COMPLETE`', 'Reintenta cada hora hasta que funcione', 'Borra la plantilla'], 1, 'La pila es una unidad: si no puede crearse entera, CloudFormation revierte lo creado. La pila queda en `ROLLBACK_COMPLETE` y solo sirve para mirar los eventos y borrarla.'),
      demo(
        'Tu primera pila, paso a paso',
        [
          [`echo '{"Resources":{"Cola":{"Type":"AWS::SQS::Queue"}}}' > cola.json`, 'Una plantilla mínima en JSON: una cola SQS'],
          ['aws cloudformation validate-template --template-body file://cola.json --query Parameters', 'Comprueba la sintaxis sin crear nada (esta plantilla no tiene parámetros)'],
          ['aws cloudformation create-stack --stack-name demo --template-body file://cola.json --query StackId --output text', 'Crea la pila: devuelve su identificador'],
          ['aws cloudformation wait stack-create-complete --stack-name demo', 'Espera a que termine (`create-stack` no espera)'],
          ['aws cloudformation list-stack-resources --stack-name demo --query "StackResourceSummaries[].[LogicalResourceId,ResourceType,ResourceStatus]"', 'Un recurso lógico (`Cola`) y su tipo; el nombre físico lo pone AWS'],
          ['aws cloudformation create-stack --stack-name demo --template-body file://cola.json', 'Mismo nombre de pila: error', 'error'],
        ],
        A('base'),
        '`create-stack` solo **inicia** la creación; para saber cuándo termina usa `aws cloudformation wait stack-create-complete` o consulta `describe-stacks`.',
      ),
      learn(
        'Anatomía de una plantilla',
        `
| Sección | Para qué sirve |
| --- | --- |
| \`Parameters\` | Valores que das al desplegar (entorno, tamaño…) con tipo y valores permitidos |
| \`Mappings\` | Tablas fijas que consultas con \`Fn::FindInMap\` |
| \`Conditions\` | Decisiones: «¿es producción?» para crear o no un recurso |
| \`Resources\` | **Obligatoria.** Cada recurso: un *id lógico*, su \`Type\` y sus \`Properties\` |
| \`Outputs\` | Valores de salida (y exportaciones para otras pilas) |
| \`Transform\` | Macros como SAM |

Cada recurso tiene un **id lógico** (\`Fotos\`), que usas dentro de la plantilla, y un **id físico** (el nombre real, la URL o el ARN), que asigna AWS al crearlo. Si no pones un nombre (\`BucketName\`), CloudFormation lo **genera**: así puedes tener la misma plantilla desplegada varias veces.

En YAML las funciones se abrevian con \`!\`: \`!Ref Fotos\`, \`!GetAtt Pedidos.Arn\`, \`!Sub "tienda-\${Entorno}"\`.
`,
        '🧩',
      ),
      predict('La pila `tienda` existe y ya terminó de crearse. ¿Qué muestra este comando?', 'aws cloudformation describe-stacks --stack-name tienda --query "Stacks[0].StackStatus" --output text', ['CREATE_IN_PROGRESS', 'UPDATE_COMPLETE', 'ROLLBACK_COMPLETE'], 'Una creación correcta termina en `CREATE_COMPLETE`. Los otros estados aparecen durante la creación (`IN_PROGRESS`), después de una actualización o tras un fallo con retroceso.', A('iac-cambios')),
      learn(
        'Parámetros, funciones y salidas',
        `
Las **funciones intrínsecas** enlazan unas piezas con otras sin escribir ids a mano:

- \`!Ref X\` → el valor de un **parámetro** o el **id físico** de un recurso (nombre del bucket, URL de la cola…).
- \`!GetAtt X.Atributo\` → un atributo del recurso (\`Pedidos.Arn\`).
- \`!Sub "arn:aws:s3:::\${Fotos}/*"\` → texto con variables (\`\${AWS::Region}\`, \`\${AWS::AccountId}\`).
- \`!If\`, \`!Equals\` y las **condiciones**; \`!FindInMap\` para consultar un \`Mappings\`.

**Las dependencias salen solas**: si un recurso usa \`!Ref\` o \`!GetAtt\` de otro, CloudFormation crea primero el otro. Los recursos independientes se crean a la vez.

Los **parámetros** hacen la plantilla reutilizable: \`AllowedValues\` limita las opciones, \`Default\` da un valor por defecto, \`NoEcho\` oculta secretos. Las **salidas** devuelven datos de la pila (el nombre del bucket, una URL) y, con \`Export\`, otras pilas de la región pueden importarlas con \`Fn::ImportValue\`.
`,
        '🔗',
      ),
      mc('Quieres pasar a una función Lambda el ARN de una cola de la misma plantilla. ¿Qué escribes en la variable de entorno?', ['`!Ref Cola`', '`!GetAtt Cola.Arn`', '`!Sub Cola`', 'El ARN a mano, copiado de la consola'], 1, '`!Ref` de una cola SQS devuelve su **URL**, no su ARN. Para el ARN usa `!GetAtt Cola.Arn`. Y nunca a mano: la plantilla debe funcionar igual en cualquier cuenta.'),
      practice({
        prompt: 'La plantilla **`web.yaml`** tiene un parámetro `Entorno` (`dev` o `prod`), una condición `EsProd` que solo en producción crea un bucket de copia, y salidas. Mira sus parámetros con `validate-template` y despliega el entorno de **producción** como la pila **`web-prod`**. Espera a que termine.',
        goal: 'La pila web-prod en CREATE_COMPLETE con sus 3 recursos',
        setup: A('base', { files: IAC_FILES.plantilla }),
        check: all(awsIs(stackStatus('web-prod'), 'CREATE_COMPLETE', 'La pila web-prod todavía no está creada del todo'), awsIs('cloudformation list-stack-resources --stack-name web-prod --query "length(StackResourceSummaries)"', 3, 'En producción deberían crearse 3 recursos (el bucket de copia también)')),
        solution: [
          'aws cloudformation validate-template --template-body file://web.yaml --query "Parameters[].[ParameterKey,DefaultValue]"',
          'aws cloudformation create-stack --stack-name web-prod --template-body file://web.yaml --parameters ParameterKey=Entorno,ParameterValue=prod',
          'aws cloudformation wait stack-create-complete --stack-name web-prod',
          'aws cloudformation describe-stacks --stack-name web-prod --query "Stacks[0].Outputs"',
        ],
        hints: ['`aws cloudformation validate-template --template-body file://web.yaml` te lista los parámetros de la plantilla.', 'Los parámetros se dan así: `--parameters ParameterKey=Entorno,ParameterValue=prod`.', '`aws cloudformation create-stack --stack-name web-prod --template-body file://web.yaml --parameters …` y después `aws cloudformation wait stack-create-complete --stack-name web-prod`.'],
        explain: 'Con `Entorno=prod` la condición `EsProd` es verdadera y se crea el bucket de copia; con `dev` solo habría dos recursos. Un valor fuera de `AllowedValues` (por ejemplo `test`) lo rechaza CloudFormation antes de crear nada.',
        par: 3,
        commands: ['aws cloudformation deploy', 'Plantilla de CloudFormation'],
      }),
      tf('«Si en una plantilla no pones el nombre de un bucket (`BucketName`), CloudFormation no puede crearlo.»', false, 'CloudFormation genera un nombre único a partir del nombre de la pila y del id lógico. De hecho es lo recomendable: con nombres fijos no puedes desplegar la misma plantilla dos veces ni sustituir el recurso.'),
      learn(
        'Cuando la plantilla está mal',
        `
Antes de crear nada, **valida**: \`aws cloudformation validate-template\` detecta errores de sintaxis, tipos de recurso que no existen y **referencias a recursos o parámetros inexistentes** (\`Template format error: Unresolved resource dependencies [Colas]\`). Te ahorra un ciclo de crear, fallar y deshacer.

Hay errores que solo salen al **crear** el recurso (el nombre ya existe, falta un permiso, un valor fuera de rango). Esos aparecen en los **eventos** de la pila (\`describe-stack-events\`) y son el tema de la siguiente lección.

Regla práctica: *validar → desplegar → esperar → comprobar las salidas*.
`,
        '🔍',
      ),
      practice({
        prompt: 'Alguien ha dejado la plantilla **`rota.yaml`** a medias: `validate-template` se queja. Averigua qué falla, corrígelo en el archivo y crea la pila **`reparada`** con ella.',
        goal: 'La pila reparada en CREATE_COMPLETE',
        setup: A('base', { files: IAC_FILES.rota }),
        check: awsIs(stackStatus('reparada'), 'CREATE_COMPLETE', 'La pila reparada todavía no se ha creado'),
        solution: ["sed -i 's/Colas/Cola/' rota.yaml", 'aws cloudformation validate-template --template-body file://rota.yaml --query "Parameters"', 'aws cloudformation create-stack --stack-name reparada --template-body file://rota.yaml', 'aws cloudformation wait stack-create-complete --stack-name reparada'],
        hints: ['Ejecuta `aws cloudformation validate-template --template-body file://rota.yaml`: el mensaje dice qué referencia no se resuelve y en qué bloque.', 'La salida `Url` hace `!Ref Colas`, pero el recurso se llama `Cola`. Cámbialo con `sed -i \'s/Colas/Cola/\' rota.yaml`.', 'Cuando `validate-template` termine sin error: `aws cloudformation create-stack --stack-name reparada --template-body file://rota.yaml`.'],
        explain: '`validate-template` encuentra las referencias a nombres que no existen sin crear nada. Validar siempre antes de desplegar es el hábito que más tiempo ahorra.',
        par: 4,
        commands: ['aws cloudformation deploy', 'Plantilla de CloudFormation'],
      }),
      order('Ordena un despliegue seguro', ['validate-template', 'create-stack', 'wait', 'describe-stacks'], 'validate-template create-stack wait describe-stacks', 'Primero se valida, luego se crea; `create-stack` no espera, así que se usa `wait`, y por último se consultan el estado y las salidas con `describe-stacks`.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a12-2', { title: 'Pilas: fallos, cambios y deriva', summary: 'Entender por qué falla una pila, ver los cambios antes de aplicarlos y detectar lo que alguien tocó a mano', emoji: '🔧', commands: ['Estados y retroceso de una pila', 'aws cloudformation describe-stack-events', 'Conjuntos de cambios (change sets)', 'DeletionPolicy y UpdateReplacePolicy', 'Deriva de pila (drift)', 'CloudFormation StackSets'], minutes: 32 }, [
      learn(
        'Cuando una pila falla',
        `
El **estado** de la pila te dice *qué* pasó; los **eventos** te dicen *por qué*:

| Estado | Qué hacer |
| --- | --- |
| \`CREATE_COMPLETE\` / \`UPDATE_COMPLETE\` | Todo bien |
| \`ROLLBACK_COMPLETE\` | La **creación** falló y se deshizo. Solo se puede **borrar** y volver a crear |
| \`UPDATE_ROLLBACK_COMPLETE\` | La **actualización** falló y volvió a como estaba: corrige y vuelve a actualizar |
| \`DELETE_FAILED\` | Un recurso no se pudo borrar (un bucket con objetos…) |

\`aws cloudformation describe-stack-events --stack-name X\` lista los sucesos **del más reciente al más antiguo**. El primer \`*_FAILED\` cronológico es la causa y su \`ResourceStatusReason\` te dice el motivo; los eventos de \`ROLLBACK\` que vienen después son consecuencia.

No «arregles» a mano un recurso dentro de una pila fallida: bórrala y vuelve a crearla con la plantilla corregida.
`,
        '🧯',
      ),
      predict('La pila `catalogo` falló al crearse. ¿En qué estado queda?', 'aws cloudformation describe-stacks --stack-name catalogo --query "Stacks[0].StackStatus" --output text', ['CREATE_FAILED', 'DELETE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'], 'Cuando falla la creación, CloudFormation deshace lo creado y deja la pila en `ROLLBACK_COMPLETE`. Ya no se puede actualizar: hay que borrarla.', A('iac-pilas')),
      practice({
        prompt: 'La pila **`catalogo`** no se llegó a crear y se quedó en `ROLLBACK_COMPLETE`. Busca en los eventos **por qué** falló, corrige la plantilla **`catalogo.yaml`** (quita lo que choca) y deja la pila en **`CREATE_COMPLETE`**.',
        goal: 'catalogo en CREATE_COMPLETE',
        setup: A('iac-pilas', { files: IAC_FILES.pilas }),
        check: awsIs(stackStatus('catalogo'), 'CREATE_COMPLETE', 'La pila catalogo todavía no está en CREATE_COMPLETE'),
        solution: [
          'aws cloudformation describe-stack-events --stack-name catalogo --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\'].[LogicalResourceId,ResourceStatusReason]" --output text',
          'aws cloudformation delete-stack --stack-name catalogo',
          'aws cloudformation wait stack-delete-complete --stack-name catalogo',
          "sed -i '/BucketName/d' catalogo.yaml",
          'aws cloudformation create-stack --stack-name catalogo --template-body file://catalogo.yaml',
          'aws cloudformation wait stack-create-complete --stack-name catalogo',
        ],
        hints: ['Los eventos: `aws cloudformation describe-stack-events --stack-name catalogo --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\']"`. Lee el `ResourceStatusReason`.', 'El bucket con nombre fijo `catalogo-prod-123456789012` ya existe en la cuenta. Una pila en `ROLLBACK_COMPLETE` no se actualiza: `aws cloudformation delete-stack --stack-name catalogo` y `wait stack-delete-complete`.', 'Quita la línea `BucketName` (`sed -i \'/BucketName/d\' catalogo.yaml`) para que CloudFormation genere un nombre libre y crea la pila de nuevo.'],
        explain: 'El motivo estaba en el evento `CREATE_FAILED`: el bucket ya existía. Con nombres fijos una plantilla choca con cualquier recurso homónimo; dejando que CloudFormation los genere, el problema desaparece.',
        par: 6,
        commands: ['aws cloudformation describe-stack-events', 'Estados y retroceso de una pila'],
      }),
      mc('Una pila está en `ROLLBACK_COMPLETE`. ¿Qué puedes hacer con ella?', ['Actualizarla con `update-stack`', 'Borrarla y crearla de nuevo', 'Ejecutar un conjunto de cambios', 'Nada: es permanente'], 1, 'Una pila que falló al crearse no tiene un estado válido al que actualizar: solo se puede consultar (eventos) y borrar.'),
      learn(
        'Actualizar con red: conjuntos de cambios',
        `
Cambiar la plantilla y actualizar la pila aplica **solo la diferencia**, pero no todos los cambios cuestan lo mismo:

- **Sin interrupción**: la propiedad se cambia en el sitio (el tiempo de visibilidad de una cola).
- **Con interrupciones**: el recurso se detiene un rato (cambiar el tipo de una instancia EC2).
- **Sustitución** (\`Replacement: True\`): CloudFormation crea un recurso **nuevo** y borra el viejo. Con una cola, un bucket o una tabla, **pierdes lo que contenía**.

Un **conjunto de cambios** (*change set*) te enseña esa diferencia **antes** de tocar nada: \`create-change-set\` → \`describe-change-set\` (mira la columna \`Replacement\`) → \`execute-change-set\` o \`delete-change-set\`.
`,
        '🔎',
      ),
      illus('aws-cfn-change', 'Qué pasa al actualizar', 'Elige un cambio y mira lo que anuncia la vista previa. Activa «Retain» y ejecuta el cambio para ver qué datos se conservan.'),
      practice({
        prompt: 'La pila **`tienda`** tiene la cola `ventas` con **3 pedidos sin procesar**. En **`tienda-v2.yaml`** alguien ha cambiado el nombre de la cola **y** su tiempo de visibilidad (a 60). Crea un conjunto de cambios con esa plantilla y mira qué pasaría con la cola. Después deja la pila en `UPDATE_COMPLETE` con el tiempo a **60** **sin perder la cola ni sus 3 mensajes**.',
        goal: 'ventas con VisibilityTimeout 60 y sus 3 mensajes',
        setup: A('iac-cambios', { files: IAC_FILES.cambios }),
        check: all(awsIs(stackStatus('tienda'), 'UPDATE_COMPLETE', 'La pila tienda todavía no se ha actualizado'), awsIs('sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/ventas --attribute-names VisibilityTimeout ApproximateNumberOfMessages --query Attributes', { VisibilityTimeout: '60', ApproximateNumberOfMessages: '3' }, 'La cola ventas debería tener tiempo 60 y conservar sus 3 mensajes')),
        solution: [
          'aws cloudformation create-change-set --stack-name tienda --change-set-name v2 --template-body file://tienda-v2.yaml',
          'aws cloudformation wait change-set-create-complete --stack-name tienda --change-set-name v2',
          'aws cloudformation describe-change-set --stack-name tienda --change-set-name v2 --query "Changes[].ResourceChange.[LogicalResourceId,Replacement]"',
          'aws cloudformation delete-change-set --stack-name tienda --change-set-name v2',
          "sed -i 's/ventas-2026/ventas/' tienda-v2.yaml",
          'aws cloudformation create-change-set --stack-name tienda --change-set-name v3 --template-body file://tienda-v2.yaml',
          'aws cloudformation wait change-set-create-complete --stack-name tienda --change-set-name v3',
          'aws cloudformation describe-change-set --stack-name tienda --change-set-name v3 --query "Changes[].ResourceChange.Replacement"',
          'aws cloudformation execute-change-set --stack-name tienda --change-set-name v3',
          'aws cloudformation wait stack-update-complete --stack-name tienda',
        ],
        hints: ['`aws cloudformation create-change-set --stack-name tienda --change-set-name v2 --template-body file://tienda-v2.yaml`, espera con `aws cloudformation wait change-set-create-complete …` y mira `describe-change-set --query "Changes[].ResourceChange"`.', 'La cola aparece con `Replacement: True`: cambiar `QueueName` crea una cola nueva y borra la vieja con sus mensajes. Descarta el conjunto (`delete-change-set`) y deja el nombre como estaba: `sed -i \'s/ventas-2026/ventas/\' tienda-v2.yaml`.', 'Crea otro conjunto de cambios con la plantilla corregida, comprueba que ahora `Replacement` es `False` y ejecútalo con `execute-change-set`. Espera con `aws cloudformation wait stack-update-complete --stack-name tienda`.'],
        explain: 'La vista previa avisó de `Replacement: True` en la cola: renombrarla habría creado una cola vacía y borrado la de los 3 pedidos. Sin el cambio de nombre, solo cambia el tiempo de visibilidad, que se modifica en el sitio. Mirar `Replacement` antes de ejecutar es el hábito que evita perder datos.',
        par: 10,
        commands: ['Conjuntos de cambios (change sets)', 'AWS CloudFormation'],
      }),
      tf('«Si un conjunto de cambios dice `Replacement: False`, el recurso nunca se interrumpe.»', false, '`Replacement: False` significa que no se sustituye, pero algunas propiedades provocan **interrupciones** (por ejemplo, cambiar el tipo de instancia de EC2 la detiene unos minutos). La documentación de cada propiedad indica «Update requires: No interruption / Some interruptions / Replacement».'),
      learn(
        'Proteger los datos: DeletionPolicy y UpdateReplacePolicy',
        `
Quitar un recurso de la plantilla, borrar la pila o hacer que un cambio **sustituya** el recurso equivale a **borrarlo**. Dos atributos del recurso deciden qué pasa:

- \`DeletionPolicy\` — al borrar la pila (o quitar el recurso): \`Delete\` (por defecto), \`Retain\` (sobrevive, pero sale de la pila) o \`Snapshot\` (hace una copia antes: EBS, RDS…).
- \`UpdateReplacePolicy\` — cuando una actualización **sustituye** el recurso: qué hacer con el viejo.

Para datos importantes (bases de datos, buckets con contenido) usa \`Retain\` o \`Snapshot\`. Además, la **protección contra terminación** (\`--enable-termination-protection\`) impide borrar la pila entera hasta que la quites.
`,
        '🛡️',
      ),
      mc('Tienes una base de datos RDS dentro de una pila. Quieres que, si alguien borra la pila por error, quede una copia de los datos. ¿Qué pones?', ['`DeletionPolicy: Delete`', '`DeletionPolicy: Snapshot`', '`DependsOn: Snapshot`', 'Nada: RDS ya lo hace solo'], 1, '`Snapshot` hace una copia final antes de borrar el recurso (EBS, RDS, ElastiCache…). `Retain` conservaría la base de datos viva pero huérfana, y con `Delete` (lo habitual por defecto) se pierde todo.'),
      learn(
        'Deriva: cuando alguien toca a mano',
        `
La plantilla dice una cosa y la realidad otra porque alguien editó un recurso en la consola. A eso se le llama **deriva** (*drift*), y es una de las causas más habituales de sorpresas en una actualización.

\`aws cloudformation detect-stack-drift --stack-name X\` devuelve un id; \`describe-stack-drift-detection-status\` te da el resultado global (\`IN_SYNC\` o \`DRIFTED\`) y \`describe-stack-resource-drifts\` el detalle por recurso, con el valor **esperado** y el **actual** de cada propiedad.

Hay que decidir quién manda: o se **revierte** el cambio manual (la plantilla gana) o se **lleva a la plantilla** (el cambio manual gana). Ejecutar de nuevo la misma plantilla **no** lo arregla: CloudFormation compara plantilla con plantilla y dice «No updates are to be performed».
`,
        '🧭',
      ),
      practice({
        prompt: 'Alguien ha editado a mano recursos de la pila **`web`** (hay un bucket y una cola). Detecta la **deriva**, averigua qué propiedades cambiaron y devuelve los recursos a lo que dice la plantilla (`web.yaml`). Al final la pila tiene que estar **`IN_SYNC`**.',
        goal: 'La pila web sin deriva (IN_SYNC)',
        setup: A('iac-deriva', { files: IAC_FILES.deriva }),
        check: awsAfter(['cloudformation detect-stack-drift --stack-name web'], awsIs('cloudformation describe-stacks --stack-name web --query "Stacks[0].DriftInformation.StackDriftStatus"', 'IN_SYNC', 'La pila web todavía tiene deriva: revierte lo que se cambió a mano')),
        solution: [
          'ID=$(aws cloudformation detect-stack-drift --stack-name web --query StackDriftDetectionId --output text)',
          'aws cloudformation describe-stack-drift-detection-status --stack-drift-detection-id $ID --query StackDriftStatus',
          'aws cloudformation describe-stack-resource-drifts --stack-name web --stack-resource-drift-status-filters MODIFIED --query "StackResourceDrifts[].[LogicalResourceId,PropertyDifferences[].[PropertyPath,ExpectedValue,ActualValue]]"',
          'BUCKET=$(aws cloudformation describe-stack-resource --stack-name web --logical-resource-id Datos --query StackResourceDetail.PhysicalResourceId --output text)',
          'aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled',
          'aws sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/avisos-web --attributes VisibilityTimeout=45',
          'aws cloudformation detect-stack-drift --stack-name web',
        ],
        hints: ['Empieza con `aws cloudformation detect-stack-drift --stack-name web` y consulta el resultado con `describe-stack-drift-detection-status --stack-drift-detection-id <id>`.', '`aws cloudformation describe-stack-resource-drifts --stack-name web --stack-resource-drift-status-filters MODIFIED` te da, por recurso, `PropertyDifferences` con `ExpectedValue` y `ActualValue`. Deberían ser el versionado del bucket y el tiempo de visibilidad de la cola.', 'Reviértelos: `aws s3api put-bucket-versioning --bucket <bucket> --versioning-configuration Status=Enabled` y `aws sqs set-queue-attributes --queue-url … --attributes VisibilityTimeout=45`. El nombre real del bucket está en `describe-stack-resource --logical-resource-id Datos`.'],
        explain: 'La deriva eran dos cambios manuales: el versionado del bucket suspendido y el tiempo de visibilidad de la cola rebajado a 5. Se arregla devolviendo cada recurso a lo que declara la plantilla; una nueva detección lo confirma (`IN_SYNC`).',
        par: 7,
        commands: ['Deriva de pila (drift)', 'AWS CloudFormation'],
      }),
      learn(
        'StackSets: la misma pila en muchas cuentas y regiones',
        `
Un **conjunto de pilas** (*StackSet*) despliega una plantilla en **varias cuentas y regiones** con una sola operación: roles de auditoría, reglas de seguridad, registros… todo lo que debe ser igual en cada cuenta.

- El **conjunto** guarda la plantilla; las **instancias** (\`create-stack-instances\`) son las pilas que se crean en cada cuenta y región.
- Con permisos **autogestionados** necesitas el rol \`AWSCloudFormationStackSetAdministrationRole\` en la cuenta administradora y \`AWSCloudFormationStackSetExecutionRole\` en cada cuenta destino. Con **AWS Organizations** el servicio gestiona los roles y puede incluir las cuentas nuevas automáticamente.
- Actualizar el conjunto propaga el cambio a todas las instancias; las preferencias de operación controlan cuántas a la vez y cuántos fallos se toleran.
`,
        '🌍',
      ),
      match(
        'Une cada situación con la herramienta',
        [
          ['Ver qué cambiaría una actualización antes de aplicarla', 'Conjunto de cambios'],
          ['Saber si alguien editó un recurso en la consola', 'Detección de deriva'],
          ['Desplegar la misma plantilla en 20 cuentas y 3 regiones', 'StackSets'],
          ['Saber por qué falló la creación de un recurso', 'Eventos de la pila'],
        ],
        'El conjunto de cambios es la vista previa; la deriva compara con la realidad; StackSets multiplica el despliegue; los eventos (`describe-stack-events`) cuentan la causa de un fallo.',
      ),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a12-3', { title: 'SAM y CDK: menos plantilla, más código', summary: 'Empaquetar y desplegar aplicaciones serverless con SAM y entender cómo CDK genera CloudFormation', emoji: '🧬', commands: ['AWS SAM', 'AWS CDK', 'aws cloudformation package', 'aws cloudformation deploy'], minutes: 30 }, [
      learn(
        'SAM: serverless en pocas líneas',
        `
Una función Lambda con su API, su rol y sus permisos son **siete recursos** de CloudFormation. **SAM** (*Serverless Application Model*) es una extensión: con la línea \`Transform: AWS::Serverless-2016-10-31\` declaras

\`\`\`yaml
Saludo:
  Type: AWS::Serverless::Function
  Properties:
    Handler: app.handler
    CodeUri: src/
    Events:
      Raiz: {Type: HttpApi, Properties: {Path: /saludo, Method: get}}
\`\`\`

y CloudFormation lo **expande** a la función, el rol, el permiso de invocación, la API, la ruta, la integración y la etapa. También hay \`SimpleTable\` (DynamoDB) y las **plantillas de políticas** (\`DynamoDBCrudPolicy\`, \`S3ReadPolicy\`…) que dan permisos mínimos con una línea.

Es CloudFormation de verdad: todo lo que sabes de pilas, eventos y conjuntos de cambios sigue valiendo.
`,
        '🧬',
      ),
      illus('aws-sam-cdk', 'Tres formas de escribir lo mismo', 'Compara cuánto escribes con CloudFormation, SAM y CDK y qué acaba desplegando CloudFormation. Prueba CDK sin «bootstrap».'),
      mc('¿Qué hace la línea `Transform: AWS::Serverless-2016-10-31` de una plantilla SAM?', ['Convierte la plantilla a JSON', 'Activa una macro que expande los recursos `Serverless::*` a recursos normales de CloudFormation', 'Despliega la plantilla en todas las regiones', 'Sube el código a S3'], 1, 'Es una *transformación*: CloudFormation la procesa antes de crear nada y sustituye los tipos `AWS::Serverless::*` por los recursos reales (función, rol, API…). Por eso al desplegar hay que aceptar `CAPABILITY_AUTO_EXPAND`.'),
      learn(
        'package y deploy',
        `
Con código local (\`CodeUri: src/\`) hay dos pasos:

1. \`aws cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml\` comprime \`src/\`, lo **sube a S3** y escribe una plantilla nueva donde \`CodeUri\` apunta a \`s3://…\`. El bucket debe existir.
2. \`aws cloudformation deploy --template-file empaquetada.yaml --stack-name saludos --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND\` crea el conjunto de cambios y lo ejecuta, esperando al final. Sirve para crear y para actualizar.

Las **capacidades** son una confirmación de que sabes lo que haces: \`CAPABILITY_IAM\` (la plantilla crea roles o políticas; con nombres propios, \`CAPABILITY_NAMED_IAM\`) y \`CAPABILITY_AUTO_EXPAND\` (hay una transformación). Sin ellas, el despliegue falla antes de crear nada.

\`sam build\` y \`sam deploy\` de la herramienta SAM CLI hacen lo mismo de una tacada; aquí usas los comandos de la CLI de AWS que están por debajo.
`,
        '📦',
      ),
      mc('`aws cloudformation deploy` de una plantilla SAM falla diciendo que necesita `CAPABILITY_AUTO_EXPAND`. ¿Qué haces?', ['Cambiar de región', 'Añadir `--capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND`', 'Quitar el `Transform`', 'Subir la plantilla a S3'], 1, 'Las capacidades son un consentimiento explícito: IAM porque se crean roles y AUTO_EXPAND porque hay una transformación que expande recursos.'),
      practice({
        prompt: 'La API de saludos está escrita con SAM: **`plantilla.yaml`** y el código en **`src/`**. El bucket **`artefactos`** ya existe. Empaqueta la plantilla (subiendo el código a ese bucket) y despliégala como la pila **`saludos`**. Cuando termine, invoca la función **`saludo`**.',
        goal: 'saludos en CREATE_COMPLETE y la función saludo responde',
        setup: A('iac-sam', { files: IAC_FILES.sam }),
        check: all(awsIs(stackStatus('saludos'), 'CREATE_COMPLETE', 'La pila saludos todavía no está creada'), awsHas(`_check invoke --function saludo --payload '{}' --query Payload`, 'Hola desde SAM', 'La función saludo debería responder «Hola desde SAM»')),
        solution: [
          'aws cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml',
          `aws cloudformation deploy --template-file empaquetada.yaml --stack-name saludos ${CAPS}`,
          INVOKE('saludo'),
          'aws cloudformation describe-stacks --stack-name saludos --query "Stacks[0].Outputs[0].OutputValue"',
        ],
        hints: ['Primero `aws cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml`: sube `src/` a S3 y reescribe `CodeUri`.', 'Después `aws cloudformation deploy --template-file empaquetada.yaml --stack-name saludos --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND`.', 'Para invocar: `aws lambda invoke --function-name saludo --cli-binary-format raw-in-base64-out --payload \'{}\' salida.json` y `cat salida.json`.'],
        explain: '`package` convirtió la ruta local en un objeto de S3 y `deploy` creó la pila: SAM expandió la función, el rol, el permiso y la API. Desplegar sin las dos capacidades habría fallado antes de crear nada.',
        par: 4,
        commands: ['aws cloudformation package', 'aws cloudformation deploy', 'AWS SAM'],
      }),
      learn(
        'CDK: infraestructura en Python o TypeScript',
        `
Con **CDK** (*Cloud Development Kit*) escribes la infraestructura en un lenguaje de programación:

\`\`\`python
class DatosStack(Stack):
    def __init__(self, scope, id, **kw):
        super().__init__(scope, id, **kw)
        s3.Bucket(self, "Archivo", versioned=True)
        sqs.Queue(self, "Cola")
\`\`\`

Tienes bucles, funciones, condiciones y pruebas unitarias; los **constructos** de nivel 2 traen valores por defecto sensatos y métodos como \`bucket.grant_read(fn)\` que crean los permisos mínimos.

- \`cdk synth\` ejecuta tu programa y escribe la **plantilla de CloudFormation** en \`cdk.out/\`.
- \`cdk diff\` es un conjunto de cambios; \`cdk deploy\` crea o actualiza la pila; \`cdk destroy\` la borra.
- \`cdk bootstrap\` (una vez por cuenta y región) crea la pila \`CDKToolkit\` con un bucket y roles para subir el código y las imágenes. Sin ella, \`cdk deploy\` falla.
- Los buckets y las bases de datos se crean con *removal policy* \`RETAIN\`: al destruir la pila **no se borran** (hay que quitar esos datos a conciencia).

**Siempre es CloudFormation por debajo**: si algo falla, los eventos de la pila te lo cuentan igual.
`,
        '🧱',
      ),
      practice({
        prompt: 'El equipo de datos usa CDK. En **`cdk.out/DatosStack.template.json`** está la plantilla que genera `cdk synth` (un bucket **con `Retain`** y una cola). Haz el ciclo de prueba: **despliega** esa plantilla como la pila **`DatosStack`** (lo que hace `cdk deploy`) y luego **destrúyela** (`cdk destroy`). Al terminar, el bucket de datos tiene que **seguir existiendo** y la cola no.',
        goal: 'Pila destruida, bucket conservado, cola borrada',
        setup: A('base', { files: IAC_FILES.cdk }),
        check: all(
          awsIs('s3api list-buckets --query "length(Buckets)"', 1, 'El bucket con Retain debería seguir existiendo (¿has desplegado y destruido la pila?)'),
          awsIs('sqs list-queues --query "length(QueueUrls || `[]`)"', 0, 'La cola no tiene Retain: debería haberse borrado con la pila'),
          awsFails('cloudformation describe-stacks --stack-name DatosStack', 'does not exist', 'La pila DatosStack debería estar borrada'),
        ),
        solution: [
          'aws cloudformation deploy --template-file cdk.out/DatosStack.template.json --stack-name DatosStack',
          'aws cloudformation list-stack-resources --stack-name DatosStack --query "StackResourceSummaries[].[LogicalResourceId,ResourceType]"',
          'aws cloudformation delete-stack --stack-name DatosStack',
          'aws cloudformation wait stack-delete-complete --stack-name DatosStack',
          'aws s3api list-buckets --query "Buckets[].Name"',
        ],
        hints: ['`cdk deploy` equivale a `aws cloudformation deploy --template-file cdk.out/DatosStack.template.json --stack-name DatosStack`.', '`cdk destroy` equivale a `aws cloudformation delete-stack --stack-name DatosStack`; espera con `aws cloudformation wait stack-delete-complete --stack-name DatosStack`.', 'Fíjate en `DeletionPolicy` de los dos recursos dentro del JSON: el bucket es `Retain` y la cola `Delete`.'],
        explain: 'CDK genera `DeletionPolicy: Retain` en buckets y bases de datos para que un `cdk destroy` no se lleve los datos por delante. La cola, sin datos valiosos, se borró con la pila. Para quitar el bucket hay que vaciarlo y borrarlo aparte.',
        par: 5,
        commands: ['AWS CDK', 'DeletionPolicy y UpdateReplacePolicy'],
      }),
      tf('«Con CDK ya no se usa CloudFormation: CDK despliega los recursos directamente.»', false, 'CDK genera una plantilla de CloudFormation (`cdk synth`) y la despliega como una pila normal. Por eso heredas sus estados, sus eventos, los conjuntos de cambios, la deriva y los límites.'),
      match(
        'Elige la herramienta',
        [
          ['Función + API + tabla en 15 líneas de YAML', 'SAM'],
          ['Bucles y lógica de programación al definir recursos', 'CDK'],
          ['Control total de cada recurso en una plantilla declarativa', 'CloudFormation'],
          ['Preparar la cuenta para desplegar con CDK', 'cdk bootstrap'],
        ],
        'SAM simplifica serverless; CDK pone el lenguaje de programación; CloudFormation es la base de ambos; y `cdk bootstrap` crea la pila `CDKToolkit` que necesitan los despliegues de CDK.',
      ),
      typeCmd('Escribe el comando que sube a S3 el código local de `plantilla.yaml` (bucket `artefactos`) y escribe `empaquetada.yaml`.', ['aws cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml'], '`package` comprime el código, lo sube y reescribe `CodeUri`; el resultado es la plantilla que luego se despliega con `deploy`.', { setup: A('iac-sam', { files: IAC_FILES.sam }), check: awsHas('s3api list-objects-v2 --bucket artefactos --query "length(Contents)"', '1'), regex: '^aws cloudformation package --template-file plantilla\\.yaml --s3-bucket artefactos( --output-template-file empaquetada\\.yaml)?$', hint: 'aws cloudformation package --template-file … --s3-bucket … --output-template-file …' }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a12-4', { title: 'Entrega continua: CodeBuild y CodePipeline', summary: 'Compilar y probar cada cambio y llevarlo a producción con una canalización', emoji: '🚚', commands: ['AWS CodeBuild', 'buildspec.yml', 'aws codebuild start-build', 'AWS CodePipeline', 'aws codepipeline get-pipeline-state', 'aws codepipeline put-approval-result'], minutes: 34 }, [
      learn(
        'Integración y entrega continuas',
        `
**CI** (integración continua): cada cambio de código se compila y se prueba automáticamente. **CD** (entrega/despliegue continuo): si pasa, se lleva a un entorno —con o sin una aprobación humana en medio—.

En AWS se reparte así:

- **CodeBuild** compila y ejecuta las pruebas en un contenedor efímero. Pagas por minuto, sin servidores.
- **CodeDeploy** despliega con reparto gradual del tráfico (próxima lección).
- **CodePipeline** orquesta: **etapas** (origen → compilar → aprobar → desplegar) con **acciones** que se pasan **artefactos** (zips en un bucket S3).

Cada uno usa un **rol de IAM** propio. Y ahí aparecen los fallos de siempre: casi cualquier canalización que no funciona es porque a un rol le falta un permiso.
`,
        '🚚',
      ),
      learn(
        'CodeBuild y el buildspec',
        `
Un **proyecto de CodeBuild** define de dónde sale el código (S3, o \`CODEPIPELINE\` si lo lanza una canalización), la imagen del contenedor, el **rol de servicio** y dónde dejar los artefactos. Las órdenes están en un **\`buildspec.yml\`** junto al código:

\`\`\`yaml
version: 0.2
phases:
  install:    {commands: [pip install pytest]}
  pre_build:  {commands: [pytest -q]}
  build:      {commands: [mkdir -p dist, cp app.py dist/]}
artifacts:
  files: ['**/*']
  base-directory: dist
\`\`\`

Las fases corren en orden; si una orden devuelve error, **la fase y la compilación fallan** (\`post_build\` aun así se ejecuta). El resultado se consulta con \`aws codebuild batch-get-builds --ids <id>\` y los **registros** están en CloudWatch Logs (\`/aws/codebuild/<proyecto>\`).

Los comandos \`aws\` de dentro de la compilación usan los permisos del **rol del proyecto**.
`,
        '🔨',
      ),
      predict('El proyecto `tienda` usa un contenedor pequeño. ¿Qué tamaño de cómputo tiene?', 'aws codebuild batch-get-projects --names tienda --query "projects[0].environment.computeType" --output text', ['BUILD_GENERAL1_LARGE', 'BUILD_GENERAL1_MEDIUM', 'LINUX_CONTAINER'], 'El proyecto se creó con `BUILD_GENERAL1_SMALL`. El tamaño define CPU y memoria del contenedor y el precio por minuto.', A('iac-build')),
      practice({
        prompt: 'El proyecto de CodeBuild **`tienda`** compila el código que hay en `s3://codigo/tienda.zip`, pero **falla**. Lanza una compilación, averigua en qué fase y por qué falla (está el código en la carpeta **`tienda/`**), corrígelo, vuelve a empaquetar (`zip`) y subir `tienda.zip` y lanza otra. Cuando termine bien, el artefacto **`tienda.zip`** estará en el bucket **`artefactos`**.',
        goal: 'La compilación correcta deja tienda.zip en artefactos',
        setup: A('iac-build', { files: IAC_FILES.build }),
        check: awsIs('s3api list-objects-v2 --bucket artefactos --query "Contents[].Key"', ['tienda.zip'], 'El artefacto tienda.zip todavía no está en artefactos: la compilación debe terminar bien'),
        solution: [
          'ID=$(aws codebuild start-build --project-name tienda --query build.id --output text)',
          'sleep 300',
          'aws codebuild batch-get-builds --ids $ID --query "builds[0].[buildStatus,phases[?phaseStatus==\'FAILED\'].phaseType]"',
          'aws logs get-log-events --log-group-name /aws/codebuild/tienda --log-stream-name $(echo $ID | cut -d: -f2) --query "events[].message" --output text',
          "sed -i 's/return precio - descuento/return precio * (100 - descuento) \\/ 100/' tienda/app.py",
          'cd tienda',
          'zip -qr ../tienda.zip buildspec.yml app.py test_app.py',
          'cd ..',
          'aws s3 cp tienda.zip s3://codigo/tienda.zip',
          'ID2=$(aws codebuild start-build --project-name tienda --query build.id --output text)',
          'sleep 300',
          'aws codebuild batch-get-builds --ids $ID2 --query "builds[0].buildStatus"',
          'aws s3 ls s3://artefactos/',
        ],
        hints: ['`aws codebuild start-build --project-name tienda --query build.id --output text` guarda el id. La compilación tarda unos minutos: `sleep 300` y después `aws codebuild batch-get-builds --ids <id>`.', 'Mira la fase que falló (`phases`) y los registros: `aws logs get-log-events --log-group-name /aws/codebuild/tienda --log-stream-name <la parte del id tras los dos puntos>`. Falla una prueba: `precio_final` resta el descuento en vez de aplicar un porcentaje.', 'Corrige `tienda/app.py` (`return precio * (100 - descuento) / 100`), empaqueta con `cd tienda && zip -qr ../tienda.zip buildspec.yml app.py test_app.py`, sube con `aws s3 cp tienda.zip s3://codigo/tienda.zip` y vuelve a lanzar la compilación.'],
        explain: 'La fase `PRE_BUILD` ejecuta `pytest` y una prueba fallaba: `precio_final(200, 10)` devolvía 190 en vez de 180. Con el código corregido, todas las fases pasan y `UPLOAD_ARTIFACTS` deja `tienda.zip` en el bucket. Una compilación que falla en pruebas no produce artefacto: así nada roto llega más lejos.',
        par: 12,
        commands: ['aws codebuild start-build', 'buildspec.yml', 'AWS CodeBuild'],
      }),
      mc('En un `buildspec.yml`, `pytest -q` de la fase `pre_build` devuelve un error. ¿Qué ocurre?', ['La compilación continúa y avisa', 'La fase y la compilación fallan (se ejecuta igualmente `post_build`)', 'CodeBuild reintenta tres veces', 'Se sube el artefacto igualmente'], 1, 'Una orden con código de salida distinto de 0 hace fallar la fase y detiene el resto (salvo `post_build`, que se ejecuta y puede mirar `$CODEBUILD_BUILD_SUCCEEDING`). Sin éxito, no hay artefacto.'),
      learn(
        'CodePipeline: etapas, artefactos y roles',
        `
Una canalización es una lista de **etapas**, cada una con una o varias **acciones**:

| Etapa típica | Acción | Qué hace |
| --- | --- | --- |
| Origen | \`Source: S3\` (también CodeCommit, GitHub, ECR) | Obtiene el código. En S3, el bucket **necesita versiones** |
| Compilar | \`Build: CodeBuild\` | Compila y prueba; el proyecto usa origen y artefactos \`CODEPIPELINE\` |
| Aprobar | \`Approval: Manual\` | La canalización **espera** a una persona |
| Desplegar | \`Deploy: CloudFormation\` / CodeDeploy / S3 | Lleva el resultado a producción |

Las acciones se pasan **artefactos**: la salida de una (\`outputArtifacts\`) es la entrada de la siguiente (\`inputArtifacts\`), guardados como zips en el **almacén de artefactos** (un bucket S3).

El **rol de la canalización** debe poder leer y escribir en el almacén, lanzar CodeBuild (\`codebuild:StartBuild\`, \`BatchGetBuilds\`), operar CloudFormation y **pasar** el rol de la pila (\`iam:PassRole\`). Cada cambio nuevo en el origen vuelve a lanzar la canalización.

Para depurar: \`aws codepipeline get-pipeline-state --name X\` muestra qué etapa está parada y su \`errorDetails\`.
`,
        '🛤️',
      ),
      illus('aws-pipeline-run', 'Dónde se para la canalización', 'Rompe una cosa cada vez y avanza paso a paso: mira qué etapa falla, qué dice el error y qué comando lo arregla.'),
      practice({
        prompt: 'Tienes la definición de una canalización en **`pipeline.json`** (origen S3 `codigo/web.zip` → CodeBuild `web-build` → publicar en el bucket `sitio`). Créala con `aws codepipeline create-pipeline --cli-input-json file://pipeline.json`, **averigua por qué no llega a publicar** y arréglalo hasta que la última ejecución termine bien y `sitio` tenga el `index.html`.',
        goal: 'Última ejecución de web en Succeeded y sitio publicado',
        setup: A('iac-pipeline', { files: IAC_FILES.pipeline }),
        check: all(awsIs(lastExec('web'), 'Succeeded', 'La última ejecución de la canalización web todavía no ha terminado bien'), awsHas('s3 ls s3://sitio/', 'index.html', 'El bucket sitio todavía no tiene index.html')),
        solution: [
          'aws codepipeline create-pipeline --cli-input-json file://pipeline.json',
          'sleep 120',
          stateTable('web'),
          'aws codepipeline get-pipeline-state --name web --query "stageStates[0].actionStates[0].latestExecution.errorDetails.message" --output text',
          'aws s3api put-bucket-versioning --bucket codigo --versioning-configuration Status=Enabled',
          'aws codepipeline start-pipeline-execution --name web',
          'sleep 180',
          pipeFail('web'),
          `aws iam put-role-policy --role-name web-pipe-role --policy-name permisos --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*","codebuild:StartBuild","codebuild:BatchGetBuilds"],"Resource":"*"}]}'`,
          'aws codepipeline start-pipeline-execution --name web',
          'sleep 300',
          stateTable('web'),
          'aws s3 ls s3://sitio/',
        ],
        hints: ['Tras crearla, espera un par de minutos (`sleep 120`) y mira `aws codepipeline get-pipeline-state --name web`: la etapa que falla trae `errorDetails.message`.', 'El primer fallo está en el origen: el bucket `codigo` no tiene **versiones**. Actívalas con `aws s3api put-bucket-versioning --bucket codigo --versioning-configuration Status=Enabled` y lanza otra ejecución con `aws codepipeline start-pipeline-execution --name web`.', 'El segundo, en la compilación: `aws codepipeline list-action-executions --pipeline-name web` dice qué permiso le falta a `web-pipe-role` (`codebuild:StartBuild`). Añádelo con `aws iam put-role-policy --role-name web-pipe-role …` y lanza otra ejecución.'],
        explain: 'Dos fallos clásicos, uno detrás de otro: un origen S3 sin versiones (CodePipeline las necesita para saber qué versión usa) y un rol sin `codebuild:StartBuild`. `get-pipeline-state` y `list-action-executions` te dan el mensaje exacto de cada acción; la causa casi siempre está ahí.',
        par: 13,
        commands: ['aws codepipeline get-pipeline-state', 'AWS CodePipeline'],
      }),
      mc('El origen de una canalización es un objeto de S3. ¿Qué necesita ese bucket?', ['Cifrado con KMS', 'Versiones activadas (versioning)', 'Acceso público', 'Replicación entre regiones'], 1, 'CodePipeline detecta cambios por el identificador de versión del objeto: sin versiones, la acción de origen falla.'),
      learn(
        'Aprobaciones manuales',
        `
Una acción \`Approval: Manual\` **detiene** la canalización hasta que alguien aprueba o rechaza. Es el sitio habitual para una revisión humana entre las pruebas y producción.

- La etapa queda \`InProgress\` y su acción tiene un **token** (en \`get-pipeline-state\`, \`latestExecution.token\`), válido solo para esa ejecución.
- \`aws codepipeline put-approval-result --pipeline-name X --stage-name Aprobar --action-name Revision --result summary="Revisado",status=Approved --token <token>\`.
- **Approved** → continúa con la siguiente etapa. **Rejected** → la ejecución falla.
- Quien aprueba necesita el permiso \`codepipeline:PutApprovalResult\`. En la práctica se avisa con SNS a los revisores.
`,
        '✋',
      ),
      practice({
        prompt: 'La canalización **`web`** ha compilado la nueva versión del sitio y está **esperando tu aprobación** antes de publicarla. Mira su estado, localiza la acción de aprobación y **apruébala** con un comentario. Cuando termine, el sitio (`sitio`) tiene que estar publicado.',
        goal: 'Aprobada, última ejecución en Succeeded y sitio publicado',
        setup: A('iac-aprobacion'),
        check: all(awsIs(lastExec('web'), 'Succeeded', 'La ejecución de web todavía no ha terminado: ¿está aprobada?'), awsHas('s3 ls s3://sitio/', 'index.html', 'El sitio todavía no está publicado')),
        solution: [
          stateTable('web'),
          `TOKEN=$(aws codepipeline get-pipeline-state --name web --query "stageStates[?stageName=='Aprobar'].actionStates[0].latestExecution.token | [0]" --output text)`,
          'aws codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revision --result summary=Revisado,status=Approved --token $TOKEN',
          'sleep 120',
          stateTable('web'),
          'aws s3 ls s3://sitio/',
        ],
        hints: ['`aws codepipeline get-pipeline-state --name web`: busca la etapa `Aprobar`; su acción está `InProgress` y tiene un `token`.', 'Extrae el token con `--query "stageStates[?stageName==\'Aprobar\'].actionStates[0].latestExecution.token | [0]" --output text`.', '`aws codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revision --result summary=Revisado,status=Approved --token <token>`. El nombre de la acción es `Revision`.'],
        explain: 'La canalización llegó a la acción manual y se detuvo con un token. `put-approval-result` con `Approved` la reanudó: pasó a `Publicar` y dejó el sitio en S3. Con `Rejected` la ejecución habría fallado y no se habría publicado nada.',
        par: 4,
        commands: ['aws codepipeline put-approval-result', 'AWS CodePipeline'],
      }),
      match(
        'Une cada síntoma con su causa',
        [
          ['La acción de origen falla: «versioning of the bucket is not enabled»', 'Falta activar versiones en el bucket'],
          ['«is not authorized to perform: codebuild:StartBuild»', 'El rol de la canalización no tiene ese permiso'],
          ['La compilación falla en PRE_BUILD', 'Una prueba del código no pasa'],
          ['La etapa Aprobar sigue en InProgress', 'Alguien tiene que aprobar con el token'],
        ],
        'Casi todo lo que se rompe en una canalización es un permiso, una versión de bucket o una prueba. `get-pipeline-state` y los registros de CodeBuild dicen cuál.',
      ),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a12-5', { title: 'Despliegues sin sobresaltos', summary: 'Canarios, azul/verde y vuelta atrás automática con CodeDeploy', emoji: '🐤', commands: ['AWS CodeDeploy', 'Estrategias de despliegue', 'aws deploy create-deployment', 'AWS Elastic Beanstalk'], minutes: 30 }, [
      learn(
        'Desplegar es el momento más peligroso',
        `
La mayoría de las caídas ocurren **justo después de desplegar**. La estrategia decide cuánta gente ve el fallo y cuánto cuesta volver atrás:

| Estrategia | Cómo | Vuelta atrás |
| --- | --- | --- |
| **De golpe** | Todo cambia a la vez | Lenta (redesplegar) |
| **Rolling** | Por tandas de instancias | Media |
| **Inmutable** | Un grupo nuevo completo; si va bien sustituye al viejo | Rápida |
| **Azul/verde** | Entorno nuevo (verde) en paralelo; se cambia el tráfico de golpe | **Inmediata** |
| **Canario** | Un 5–10 % del tráfico a la versión nueva y, si no hay problemas, el resto | Inmediata |
| **Lineal** | +10 % cada minuto | Inmediata |

Lo que las hace seguras no es el reparto, sino lo que **mide y reacciona**: alarmas de CloudWatch que paran el despliegue y lo revierten, y ganchos de validación. Un canario sin alarma solo retrasa el desastre.
`,
        '🐤',
      ),
      illus('aws-deploy-shift', 'Mismo fallo, distinta estrategia', 'Hazlo fallar y compara cuántas peticiones fallidas acumula cada estrategia, con y sin alarma de retroceso automático.'),
      mc('Vas a cambiar una versión mayor del motor de la web y quieres poder volver a la anterior en segundos si algo va mal. ¿Qué eliges?', ['De golpe', 'Rolling', 'Azul/verde', 'Detener el servicio un sábado'], 2, 'En azul/verde el entorno viejo sigue intacto mientras el nuevo recibe el tráfico: volver atrás es cambiar de nuevo el reparto (DNS, ALB o alias). La contrapartida es pagar los dos entornos durante el cambio.'),
      learn(
        'CodeDeploy para Lambda',
        `
CodeDeploy mueve el **alias** de una función de una versión a otra repartiendo tráfico, con el reparto de una **configuración de despliegue**:

- \`CodeDeployDefault.LambdaAllAtOnce\` — todo a la vez.
- \`LambdaCanary10Percent5Minutes\` (también 10, 15 y 30 minutos) — 10 % a la nueva y, pasado el tiempo, el resto.
- \`LambdaLinear10PercentEvery1Minute\` (2, 3 y 10) — +10 % cada intervalo.

El **grupo de despliegue** une la aplicación con un **rol de servicio** (confía en \`codedeploy.amazonaws.com\`), la configuración, las **alarmas** que vigilar y cuándo **volver atrás solo**:

\`--alarm-configuration enabled=true,alarms=[{name=errores-tienda}]\` y \`--auto-rollback-configuration enabled=true,events=DEPLOYMENT_STOP_ON_ALARM\`.

El despliegue se lanza con un **AppSpec** que nombra la función, el alias y las versiones actual y destino. Si una alarma salta durante el reparto, CodeDeploy lo detiene y el alias recupera el 100 % de la versión anterior.
`,
        '🚦',
      ),
      predict('El alias `live` de la función `tienda` apunta a la versión estable. ¿Cuál?', 'aws lambda get-alias --function-name tienda --name live --query FunctionVersion --output text', ['2', '$LATEST', '0'], 'El alias `live` sirve la versión 1; la 2 ya está publicada pero sin tráfico. El despliegue de CodeDeploy irá moviendo el alias de la 1 a la 2.', A('iac-deploy')),
      practice({
        prompt: 'La versión **2** de la función **`tienda`** ya está publicada, pero el alias **`live`** sigue en la **1**. Despliégala **con red**: crea un grupo de despliegue **`prod`** para la aplicación `tienda` con el rol `cd-role`, la configuración de **canario del 10 % en 10 minutos**, la alarma **`errores-tienda`** vigilada y **vuelta atrás automática** si salta. Lanza el despliegue con `revision.json`. Si la alarma salta durante el canario, el alias tiene que **volver a la versión 1**.',
        goal: 'Canario con alarma y vuelta atrás: ante un fallo, live vuelve a la versión 1',
        setup: A('iac-deploy', { files: IAC_FILES.deploy }),
        check: all(
          awsAfter(['cloudwatch set-alarm-state --alarm-name errores-tienda --state-value ALARM --state-reason "La versión nueva da errores"'], awsIs('lambda get-alias --function-name tienda --name live --query "[FunctionVersion,RoutingConfig.AdditionalVersionWeights]"', ['1', {}], 'Con la alarma saltando durante el canario, el alias debería volver a la versión 1 sin reparto (¿grupo con canario, alarma y retroceso?)')),
          awsIs('deploy list-deployments --query "length(deployments)"', 1, 'Debería haber exactamente un despliegue lanzado'),
        ),
        solution: [
          'aws deploy create-deployment-group --application-name tienda --deployment-group-name prod --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name CodeDeployDefault.LambdaCanary10Percent10Minutes --alarm-configuration enabled=true,alarms=[{name=errores-tienda}] --auto-rollback-configuration enabled=true,events=DEPLOYMENT_STOP_ON_ALARM',
          'aws deploy create-deployment --application-name tienda --deployment-group-name prod --revision file://revision.json',
          'aws lambda get-alias --function-name tienda --name live --query "[FunctionVersion,RoutingConfig.AdditionalVersionWeights]"',
        ],
        hints: ['Primero el grupo: `aws deploy create-deployment-group --application-name tienda --deployment-group-name prod --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name CodeDeployDefault.LambdaCanary10Percent10Minutes …`.', 'Añade la alarma y la vuelta atrás: `--alarm-configuration enabled=true,alarms=[{name=errores-tienda}] --auto-rollback-configuration enabled=true,events=DEPLOYMENT_STOP_ON_ALARM`.', 'Lanza el despliegue con `aws deploy create-deployment --application-name tienda --deployment-group-name prod --revision file://revision.json` y mira el alias: `aws lambda get-alias --function-name tienda --name live`. **No esperes** a que acabe el canario.'],
        explain: 'El alias reparte el 10 % del tráfico a la versión 2 durante el canario. Si la alarma de errores salta en esa ventana, CodeDeploy detiene el despliegue y, con `DEPLOYMENT_STOP_ON_ALARM`, devuelve el 100 % a la versión 1. Con `AllAtOnce` el fallo habría llegado a todos; sin la alarma, nadie lo habría parado.',
        par: 3,
        commands: ['AWS CodeDeploy', 'aws deploy create-deployment', 'Estrategias de despliegue'],
      }),
      tf('«Un despliegue canario protege la producción aunque no haya ninguna alarma configurada.»', false, 'Un canario limita cuánta gente ve el fallo, pero si nada mide los errores y reacciona, el despliegue sigue adelante hasta el 100 %. Hacen falta alarmas (y vuelta atrás automática o alguien mirando) para que sea una red de seguridad.'),
      learn(
        'Elastic Beanstalk y el resto del mapa',
        `
**Elastic Beanstalk** despliega aplicaciones web (Python, Node.js, Java, Docker…) subiendo solo el código: crea y gestiona el balanceador, el Auto Scaling y las instancias EC2. Tiene la política de despliegue como opción del entorno (*all at once*, *rolling*, *rolling con lote adicional*, *immutable*, *traffic splitting*) y el **azul/verde** como «clonar el entorno e intercambiar las URL».

| Si tienes… | Considera |
| --- | --- |
| Una web clásica y poca gente para operarla | Elastic Beanstalk |
| Contenedores | ECS, EKS o App Runner (próxima zona) |
| Lambda | Alias con pesos + CodeDeploy |
| Infraestructura entera a repetir | CloudFormation / CDK |

Dos reglas que valen siempre: **las migraciones de base de datos deben ser compatibles hacia atrás** (la versión vieja y la nueva conviven un rato con el mismo esquema) y **lo que no puedes revertir, no lo despliegues de golpe**.
`,
        '🗺️',
      ),
      multi('¿Qué ayuda a que un despliegue en producción sea más seguro? (elige todas las correctas)', ['Reparto gradual del tráfico (canario o lineal)', 'Una alarma de CloudWatch que detenga y revierta', 'Un gancho de validación que pruebe la versión nueva', 'Desplegar siempre el viernes por la tarde'], [0, 1, 2], 'Reparto gradual, alarmas con vuelta atrás y validaciones automáticas reducen el riesgo. El día de la semana no ayuda: lo que no puedes vigilar, mejor que no salga un viernes por la tarde.'),
      match(
        'Une cada estrategia con su rasgo',
        [
          ['Azul/verde', 'Dos entornos y cambio de tráfico en bloque'],
          ['Canario', 'Pequeño porcentaje y luego el resto'],
          ['Lineal', 'Sube un porcentaje cada pocos minutos'],
          ['Inmutable', 'Un grupo nuevo completo que sustituye al viejo'],
        ],
        'Todas buscan lo mismo —limitar el daño y poder volver atrás— con distinto equilibrio entre coste, velocidad y complejidad.',
      ),
    ]),
  ],
  boss: {
    prompt:
      'Misión final: **«De `tienda.zip` a producción»**. La tienda quiere entrega continua: cada vez que se suba `tienda.zip` (una aplicación SAM) a `s3://codigo`, tiene que **compilarse con `aws cloudformation package` en CodeBuild** y **desplegarse con CloudFormation** como la pila **`tienda-api`**. Está todo montado menos que funcione: el código y el bucket `artefactos`, el proyecto `tienda-build`, los roles `pipe-role` y `cfn-role` y la definición **`pipeline.json`** (en tu directorio, junto con `permisos-build.json`). Créala y haz que **se despliegue**: esto es un canal real, así que te irás encontrando los fallos de uno en uno. Cuando termines, la última ejecución estará en `Succeeded`, la pila `tienda-api` en `CREATE_COMPLETE` y la función **`tienda`** responderá.',
    goal: 'Canalización en Succeeded, pila tienda-api creada y la función tienda responde',
    setup: A('iac-boss', { files: IAC_FILES.boss }),
    check: all(
      awsIs(lastExec('tienda'), 'Succeeded', 'La última ejecución de la canalización tienda todavía no ha terminado bien'),
      awsIs(stackStatus('tienda-api'), 'CREATE_COMPLETE', 'La pila tienda-api todavía no está creada'),
      awsHas(`_check invoke --function tienda --payload '{}' --query Payload`, 'Hola desde SAM', 'La función tienda debería responder «Hola desde SAM»'),
    ),
    solution: [
      'aws codepipeline create-pipeline --cli-input-json file://pipeline.json',
      'sleep 480',
      pipeFail('tienda'),
      'aws iam put-role-policy --role-name pipe-role --policy-name build --policy-document file://permisos-build.json',
      'aws codepipeline start-pipeline-execution --name tienda',
      'sleep 480',
      pipeFail('tienda'),
      `aws iam put-role-policy --role-name pipe-role --policy-name cfn --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudformation:*","iam:PassRole"],"Resource":"*"}]}'`,
      'aws codepipeline start-pipeline-execution --name tienda',
      'sleep 480',
      pipeFail('tienda'),
      `sed -i 's/"ActionMode": "CREATE_UPDATE",/"ActionMode": "CREATE_UPDATE", "Capabilities": "CAPABILITY_IAM,CAPABILITY_AUTO_EXPAND",/' pipeline.json`,
      'aws codepipeline update-pipeline --cli-input-json file://pipeline.json',
      'aws codepipeline start-pipeline-execution --name tienda',
      'sleep 600',
      stateTable('tienda'),
      INVOKE('tienda'),
    ],
    hints: [
      'Crea la canalización con `aws codepipeline create-pipeline --cli-input-json file://pipeline.json`, espera unos minutos (`sleep 480`) y lee el error con `aws codepipeline list-action-executions --pipeline-name tienda` o `get-pipeline-state`. El primero: `pipe-role` no puede lanzar CodeBuild. Tienes un `permisos-build.json` listo: `aws iam put-role-policy --role-name pipe-role --policy-name build --policy-document file://permisos-build.json`.',
      'Lanza otra ejecución (`aws codepipeline start-pipeline-execution --name tienda`). Ahora falla la etapa de despliegue: el rol de la canalización necesita `cloudformation:*` (para operar la pila) e `iam:PassRole` (para pasar `cfn-role` a CloudFormation). Añade otra política en línea con esas dos acciones.',
      'Otra ejecución: el error ahora es de capacidades (`CAPABILITY_AUTO_EXPAND`/`CAPABILITY_IAM`): la plantilla SAM tiene una transformación y crea roles. Añade en la acción de CloudFormation de `pipeline.json` `"Capabilities": "CAPABILITY_IAM,CAPABILITY_AUTO_EXPAND"` (por ejemplo con `sed`), aplícalo con `aws codepipeline update-pipeline --cli-input-json file://pipeline.json` y lanza una última ejecución.',
    ],
    explain: 'Has depurado una canalización real de principio a fin: permisos del rol de CodePipeline (CodeBuild, luego CloudFormation y `iam:PassRole`) y las capacidades de la acción de despliegue. Cada fallo se explica en `list-action-executions`. El resultado es el canal de entrega continua más típico de AWS: origen en S3 → CodeBuild (package) → CloudFormation (con un rol de servicio con permisos acotados), que de ahora en adelante despliega cada cambio por sí solo.',
    commands: ['AWS CodePipeline', 'AWS CodeBuild', 'AWS CloudFormation', 'AWS SAM'],
  },
});
