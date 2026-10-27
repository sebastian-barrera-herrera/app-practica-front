import type { AwsRef } from '../reference';

const COLA = `echo '{"Resources":{"Cola":{"Type":"AWS::SQS::Queue"}}}' > cola.json`;
const WEB = `echo '{"Parameters":{"Entorno":{"Type":"String","AllowedValues":["dev","prod"],"Default":"dev"}},"Resources":{"Cubo":{"Type":"AWS::S3::Bucket","Properties":{"BucketName":{"Fn::Sub":"app-\${Entorno}-\${AWS::AccountId}"}}}},"Outputs":{"Nombre":{"Value":{"Ref":"Cubo"}}}}' > web.json`;
const FN = String.raw`echo '{"Mappings":{"Tam":{"dev":{"t":"30"},"prod":{"t":"120"}}},"Parameters":{"E":{"Type":"String","Default":"prod"}},"Conditions":{"EsProd":{"Fn::Equals":[{"Ref":"E"},"prod"]}},"Resources":{"Cola":{"Type":"AWS::SQS::Queue","Properties":{"VisibilityTimeout":{"Fn::FindInMap":["Tam",{"Ref":"E"},"t"]}}},"Cubo":{"Type":"AWS::S3::Bucket","Condition":"EsProd"}},"Outputs":{"Arn":{"Value":{"Fn::GetAtt":["Cola","Arn"]}},"Url":{"Value":{"Fn::Join":["/",["cola",{"Ref":"E"}]]}}}}' > fn.json`;
const TRUST_CFN = `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"cloudformation.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > adm.json`;
const TRUST_ADM = `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::123456789012:role/AWSCloudFormationStackSetAdministrationRole"},"Action":"sts:AssumeRole"}]}' > exe.json`;
const SAM_APP = `echo 'def handler(event, context): return {"statusCode": 200}' > src/app.py`;
const SAM_JSON = `echo '{"Transform":"AWS::Serverless-2016-10-31","Resources":{"Hola":{"Type":"AWS::Serverless::Function","Properties":{"FunctionName":"hola","Handler":"app.handler","Runtime":"python3.12","CodeUri":"src/"}}}}' > sam.json`;
const V2 = `echo '{"Resources":{"Archivos":{"Type":"AWS::S3::Bucket"},"Ventas":{"Type":"AWS::SQS::Queue","Properties":{"QueueName":"ventas","VisibilityTimeout":60}}}}' > v2.json`;
const V2_RENAME = V2.replace('"QueueName":"ventas"', '"QueueName":"ventas-2026"');
const REVISION = String.raw`echo '{"revisionType":"AppSpecContent","appSpecContent":{"content":"version: 0.0\nResources:\n  - tienda:\n      Type: AWS::Lambda::Function\n      Properties:\n        Name: tienda\n        Alias: live\n        CurrentVersion: \"1\"\n        TargetVersion: \"2\"\n"}}' > revision.json`;
const GRUPO = 'aws deploy create-deployment-group --application-name tienda --deployment-group-name prod --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name CodeDeployDefault.LambdaCanary10Percent10Minutes --alarm-configuration enabled=true,alarms=[{name=errores-tienda}] --auto-rollback-configuration enabled=true,events=DEPLOYMENT_STOP_ON_ALARM';
const TOKEN = `TOKEN=$(aws codepipeline get-pipeline-state --name web --query "stageStates[?stageName=='Aprobar'].actionStates[0].latestExecution.token | [0]" --output text)`;

export const AWS_REF_IAC: AwsRef[] = [
  // ───────────────────────── CloudFormation ─────────────────────────
  {
    name: 'AWS CloudFormation',
    kind: 'servicio',
    category: 'devops',
    level: 2,
    summary: 'Describes tu infraestructura en una plantilla (YAML o JSON) y CloudFormation crea, actualiza y borra los recursos como una unidad: la pila. Es la base de la infraestructura como código en AWS.',
    details: `
**Plantilla → pila → recursos.** Escribes *qué* quieres (un bucket, una cola, una función…), no *cómo* crearlo. CloudFormation calcula el orden por las dependencias, lo crea todo y, si algo falla, **deshace** lo ya creado.

- Una **pila** (*stack*) es una instancia de una plantilla: sus recursos se crean, actualizan y borran juntos.
- Cambiar la plantilla y actualizar la pila aplica **solo la diferencia**. Algunas propiedades se cambian al vuelo y otras obligan a **sustituir** el recurso (uno nuevo y borrar el viejo).
- Un **conjunto de cambios** (*change set*) te enseña la diferencia antes de aplicarla; la **deriva** (*drift*) detecta lo que alguien cambió a mano.
- Es gratis: pagas los recursos que crea. Cada pila y cada plantilla pueden guardarse en control de versiones, revisarse y repetirse en otra cuenta o región.

Herramientas encima de CloudFormation: **SAM** (serverless más corto), **CDK** (la plantilla se genera desde código) y **CodePipeline** (despliegues automáticos).
`,
    whenUse: ['Todo lo que vaya a existir más de una vez (dev, pre, prod) o deba poder reconstruirse', 'Entornos reproducibles: la misma plantilla en otra cuenta o región', 'Infraestructura revisable: cada cambio es un cambio de código con su historial'],
    whenNot: ['Para un experimento de cinco minutos: la CLI o la consola bastan', 'Para datos: la plantilla crea la tabla, no controla su contenido', 'Para cambiar recursos «por fuera»: provoca deriva y sorpresas en la siguiente actualización'],
    pricing: 'CloudFormation no cuesta nada con recursos de AWS. Los tipos de terceros y los *hooks* sí tienen coste por operación.',
    limits: ['Hasta 500 recursos por pila (divide en pilas anidadas o enlazadas)', 'Plantilla de hasta 51.200 bytes en la llamada o 1 MB desde S3', 'Hasta 200 parámetros y 200 salidas por plantilla'],
    versus: [
      ['AWS SAM', 'Atajos para Lambda, API y DynamoDB; se convierte en CloudFormation al desplegar.'],
      ['AWS CDK', 'Escribes la infraestructura en Python o TypeScript y genera la plantilla.'],
      ['Terraform', 'Herramienta de terceros y multinube; guarda su propio estado fuera de AWS.'],
    ],
    scenario: 'base',
    examples: [
      [COLA, 'Una plantilla mínima en JSON: una cola SQS'],
      ['aws cloudformation validate-template --template-body file://cola.json --query "Parameters"', 'Comprueba la sintaxis sin crear nada (sin parámetros)'],
      ['aws cloudformation create-stack --stack-name demo --template-body file://cola.json --query StackId --output text', 'Crea la pila'],
      ['aws cloudformation wait stack-create-complete --stack-name demo', 'Espera a que termine'],
      ['aws cloudformation describe-stacks --stack-name demo --query "Stacks[0].StackStatus"', '`CREATE_COMPLETE`'],
      ['aws cloudformation list-stack-resources --stack-name demo --query "StackResourceSummaries[].[LogicalResourceId,ResourceType,ResourceStatus]"', 'Lo que creó: un id lógico y un recurso físico'],
      ['aws cloudformation create-stack --stack-name demo --template-body file://cola.json', 'Mismo nombre de pila: error', 'error'],
    ],
    seeAlso: ['Plantilla de CloudFormation', 'Estados y retroceso de una pila', 'Conjuntos de cambios (change sets)', 'AWS SAM'],
  },
  {
    name: 'Plantilla de CloudFormation',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'Documento YAML o JSON con secciones: Parameters (entradas), Mappings, Conditions, Resources (lo único obligatorio), Outputs (salidas) y Transform. Es la declaración de lo que quieres.',
    details: `
| Sección | Para qué sirve |
| --- | --- |
| \`AWSTemplateFormatVersion\` | Versión del formato (\`'2010-09-09'\`) |
| \`Description\` | Texto para quien la lea |
| \`Parameters\` | Valores que das al crear/actualizar: tipo, valor por defecto, valores permitidos |
| \`Mappings\` | Tablas fijas (p. ej. imagen por región) que se consultan con \`Fn::FindInMap\` |
| \`Conditions\` | Condiciones (¿es producción?) para crear o no un recurso |
| \`Resources\` | **Obligatoria.** Cada recurso: \`Type\` y \`Properties\` |
| \`Outputs\` | Valores de salida; pueden exportarse para otras pilas |
| \`Transform\` | Macros (SAM = \`AWS::Serverless-2016-10-31\`) |

Cada recurso tiene un **id lógico** (\`Cola\`) que usas en la plantilla y un **id físico** (el nombre real, el ARN o la URL) que asigna AWS al crearlo.

Consejos: deja que CloudFormation **genere los nombres** (sin \`BucketName\`) para poder tener la misma plantilla varias veces; usa parámetros para lo que cambia entre entornos; valida con \`aws cloudformation validate-template\` antes de desplegar.
`,
    whenUse: ['Una plantilla por «cosa» que se despliega junta: red, datos, aplicación…', 'Parámetros para lo que cambia (entorno, tamaño) y el resto fijo'],
    whenNot: ['No metas contraseñas en `Parameters` sin `NoEcho: true`; mejor referencia a Secrets Manager', 'No pongas nombres fijos a todo: impiden repetir la pila o sustituir el recurso'],
    scenario: 'base',
    examples: [
      [WEB, 'Un parámetro con valores permitidos, un bucket con nombre calculado y una salida'],
      ['aws cloudformation validate-template --template-body file://web.json --query "Parameters[].[ParameterKey,DefaultValue]"', 'Lee los parámetros de la plantilla'],
      ['aws cloudformation create-stack --stack-name web --template-body file://web.json --parameters ParameterKey=Entorno,ParameterValue=prod', 'Crea la pila con `Entorno=prod`'],
      ['aws cloudformation wait stack-create-complete --stack-name web', 'Espera'],
      ['aws cloudformation describe-stacks --stack-name web --query "Stacks[0].Outputs"', 'La salida: el nombre del bucket, `app-prod-123456789012`'],
      ['aws cloudformation create-stack --stack-name otra --template-body file://web.json --parameters ParameterKey=Entorno,ParameterValue=test', 'Un valor no permitido: error', 'error'],
    ],
    seeAlso: ['Funciones intrínsecas de CloudFormation', 'Parámetros, salidas y exportaciones', 'AWS CloudFormation'],
  },
  {
    name: 'Funciones intrínsecas de CloudFormation',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'Funciones que CloudFormation resuelve al desplegar: Ref, Fn::GetAtt, Fn::Sub, Fn::Join, Fn::If, Fn::FindInMap, Fn::ImportValue… Enlazan recursos y parámetros sin escribir ids a mano.',
    details: `
| Función | Qué devuelve |
| --- | --- |
| \`Ref\` | Un **parámetro** (su valor) o el **id físico** de un recurso (nombre, URL…) |
| \`Fn::GetAtt\` | Un atributo del recurso: \`Fn::GetAtt: [Cola, Arn]\` |
| \`Fn::Sub\` | Texto con variables: \`"arn:aws:s3:::\${Cubo}/*"\` (\`\${AWS::Region}\`, \`\${AWS::AccountId}\`) |
| \`Fn::Join\` | Une una lista con un separador |
| \`Fn::Select\` / \`Fn::Split\` | Elige un elemento / parte un texto |
| \`Fn::If\` / \`Fn::Equals\`… | Valor u opción según una **condición** |
| \`Fn::FindInMap\` | Busca en un \`Mappings\` |
| \`Fn::ImportValue\` | Valor **exportado** por otra pila |

En YAML se abrevian con \`!\`: \`!Ref Cola\`, \`!GetAtt Cola.Arn\`, \`!Sub "…"\`.

**Las dependencias salen solas:** si un recurso usa \`!Ref\` o \`!GetAtt\` de otro, CloudFormation lo crea después. Para forzar un orden sin referencia, \`DependsOn\`.

**Pseudoparámetros**: \`AWS::Region\`, \`AWS::AccountId\`, \`AWS::StackName\`, \`AWS::StackId\`, \`AWS::NoValue\` (quita la propiedad).
`,
    scenario: 'base',
    examples: [
      [FN, 'Mapa + condición + FindInMap + GetAtt + Join en una sola plantilla'],
      ['aws cloudformation create-stack --stack-name fn --template-body file://fn.json', 'Con `E=prod` (por defecto) crea cola y bucket'],
      ['aws cloudformation wait stack-create-complete --stack-name fn', 'Espera'],
      ['aws cloudformation describe-stacks --stack-name fn --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output text', 'Las salidas resueltas'],
      ['aws cloudformation list-stack-resources --stack-name fn --query "length(StackResourceSummaries)"', 'Cola y cubo: 2 recursos'],
    ],
    seeAlso: ['Plantilla de CloudFormation', 'Parámetros, salidas y exportaciones'],
  },
  {
    name: 'Parámetros, salidas y exportaciones',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'Parameters entran en la plantilla (con tipo y valores permitidos), Outputs salen de ella y, con Export, otras pilas de la región pueden importarlos con Fn::ImportValue. Una pila exportada no se puede borrar mientras alguien la use.',
    details: `
**Parámetros**: \`Type\` (\`String\`, \`Number\`, \`List<…>\`, \`AWS::EC2::KeyPair::KeyName\`…), \`Default\`, \`AllowedValues\`, \`AllowedPattern\`, \`MinLength\`, \`NoEcho: true\` (oculta el valor en las consultas). Si no hay valor por defecto y no lo das, falla.

**Salidas**: nombre, valor y, opcionalmente, \`Export: {Name: red-subredes}\`. El nombre de una exportación es **único por región y cuenta**.

**Pilas enlazadas**: una pila de *red* exporta los ids de la VPC y las subredes; las pilas de *aplicación* los importan. Ventajas: ciclo de vida separado (la red cambia poco). Inconveniente: **acoplamiento** — no puedes borrar ni cambiar el valor exportado mientras otra pila lo importe.

\`aws cloudformation list-exports\` y \`list-imports --export-name …\` te dicen quién usa qué.
`,
    whenUse: ['Exportar solo lo que de verdad comparten varias pilas (red, claves, roles)', 'Parámetros de tipo SSM para leer valores de Parameter Store al desplegar'],
    whenNot: ['No exportes todo «por si acaso»: cada exportación usada es una dependencia', 'No uses exportaciones entre regiones: no funcionan (usa parámetros)'],
    scenario: 'base',
    examples: [
      [String.raw`echo '{"Resources":{"Cola":{"Type":"AWS::SQS::Queue"}},"Outputs":{"Url":{"Value":{"Ref":"Cola"},"Export":{"Name":"red-cola"}}}}' > red.json`, 'Una pila que exporta la URL de su cola'],
      ['aws cloudformation create-stack --stack-name red --template-body file://red.json', 'Crea la pila de red'],
      ['aws cloudformation wait stack-create-complete --stack-name red', 'Espera'],
      ['aws cloudformation list-exports --query "Exports[].[Name,Value]" --output text', 'Las exportaciones disponibles'],
      [String.raw`echo '{"Resources":{"Param":{"Type":"AWS::SQS::Queue","Properties":{"QueueName":{"Fn::Join":["-",["copia",{"Fn::Select":[4,{"Fn::Split":["/",{"Fn::ImportValue":"red-cola"}]}]}]]}}}}}' > app.json`, 'Otra pila que importa esa exportación'],
      ['aws cloudformation create-stack --stack-name app --template-body file://app.json', 'Crea la pila de aplicación'],
      ['aws cloudformation wait stack-create-complete --stack-name app', 'Espera'],
      ['aws cloudformation list-imports --export-name red-cola --query Imports', 'Quién la usa: `app`'],
      ['aws cloudformation delete-stack --stack-name red', 'Borrar la pila exportada mientras `app` la importa: error, la exportación está en uso', 'error'],
    ],
    seeAlso: ['Funciones intrínsecas de CloudFormation', 'AWS CloudFormation'],
  },
  {
    name: 'Estados y retroceso de una pila',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'CREATE_COMPLETE, UPDATE_COMPLETE, ROLLBACK_COMPLETE, UPDATE_ROLLBACK_COMPLETE, DELETE_FAILED… El estado cuenta qué pasó; describe-stack-events cuenta por qué. Una pila en ROLLBACK_COMPLETE no se actualiza: se borra y se crea de nuevo.',
    details: `
| Estado | Significa | Qué hacer |
| --- | --- | --- |
| \`CREATE_IN_PROGRESS\` / \`UPDATE_IN_PROGRESS\` | Trabajando | Esperar (\`aws cloudformation wait …\`) |
| \`CREATE_COMPLETE\` / \`UPDATE_COMPLETE\` | Todo bien | — |
| \`ROLLBACK_COMPLETE\` | La **creación** falló y se deshizo | Leer los eventos, **borrar la pila** y crearla de nuevo |
| \`UPDATE_ROLLBACK_COMPLETE\` | La **actualización** falló y volvió a como estaba | Leer los eventos, corregir y actualizar de nuevo |
| \`UPDATE_ROLLBACK_FAILED\` | Ni siquiera pudo volver atrás | Corregir la causa y \`continue-update-rollback\` |
| \`DELETE_FAILED\` | No se pudo borrar un recurso (p. ej. un bucket con objetos) | Vaciarlo o conservarlo (\`--retain-resources\`) |

**La causa está en los eventos**: \`aws cloudformation describe-stack-events\` ordena del más reciente al más antiguo; busca el primer \`*_FAILED\` y lee \`ResourceStatusReason\`. Los eventos posteriores (\`ROLLBACK_IN_PROGRESS\`…) son consecuencia.

\`--on-failure DO_NOTHING\` o \`--disable-rollback\` deja los recursos creados para depurar (y te toca borrarlos).
`,
    whenUse: ['Depurar: siempre eventos primero, adivinar después', 'Dejar el retroceso automático activado en producción'],
    whenNot: ['No «arregles» el recurso a mano dentro de una pila fallida: borra la pila y vuelve a crearla'],
    scenario: 'iac-pilas',
    examples: [
      ['aws cloudformation describe-stacks --stack-name catalogo --query "Stacks[0].StackStatus"', 'La pila `catalogo` se quedó en `ROLLBACK_COMPLETE`'],
      ['aws cloudformation describe-stack-events --stack-name catalogo --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\'].[LogicalResourceId,ResourceStatusReason]" --output text', 'La causa: el nombre del bucket ya existe'],
      ['aws cloudformation delete-stack --stack-name catalogo', 'Una pila en ROLLBACK_COMPLETE solo se puede borrar'],
      ['aws cloudformation wait stack-delete-complete --stack-name catalogo', 'Espera a que desaparezca'],
      ['aws cloudformation describe-stacks --stack-name catalogo', 'Ya no existe', 'error'],
    ],
    seeAlso: ['aws cloudformation describe-stack-events', 'DeletionPolicy y UpdateReplacePolicy', 'AWS CloudFormation'],
  },
  {
    name: 'DeletionPolicy y UpdateReplacePolicy',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'Atributos de un recurso que deciden qué pasa con él al borrar la pila (DeletionPolicy) o al ser sustituido en una actualización (UpdateReplacePolicy): Delete, Retain o Snapshot. Protegen tus datos de un delete-stack.',
    details: `
- \`Delete\` (por defecto): se borra con la pila.
- \`Retain\`: el recurso **sobrevive**; sigue existiendo pero ya no lo gestiona la pila.
- \`Snapshot\`: antes de borrarlo, hace una copia (EBS, RDS, ElastiCache, Redshift…).

\`DeletionPolicy\` actúa al **borrar la pila** (o al quitar el recurso de la plantilla). \`UpdateReplacePolicy\` actúa cuando una actualización **sustituye** el recurso: qué hacer con el viejo.

Para datos que importan (bases de datos, buckets con contenido, claves) pon \`Retain\` o \`Snapshot\`. **CDK** lo hace por ti: sus buckets y tablas se crean con *removal policy* \`RETAIN\` salvo que digas lo contrario.

Aparte, **protección contra terminación** (\`--enable-termination-protection\`) impide borrar la pila entera hasta que la desactives.
`,
    whenUse: ['`Retain` en buckets y tablas con datos de producción', '`Snapshot` en bases de datos: copia final al borrar', 'Protección contra terminación en pilas críticas'],
    whenNot: ['No dejes `Retain` por todas partes en entornos de pruebas: acumulas recursos huérfanos y su coste'],
    scenario: 'base',
    examples: [
      [String.raw`echo '{"Resources":{"Datos":{"Type":"AWS::S3::Bucket","DeletionPolicy":"Retain"},"Cola":{"Type":"AWS::SQS::Queue"}}}' > ret.json`, 'Bucket con `Retain` y cola normal'],
      ['aws cloudformation create-stack --stack-name ret --template-body file://ret.json', 'Crea la pila'],
      ['aws cloudformation wait stack-create-complete --stack-name ret', 'Espera'],
      ['aws cloudformation delete-stack --stack-name ret', 'Borra la pila'],
      ['aws cloudformation wait stack-delete-complete --stack-name ret', 'Espera'],
      ['aws s3api list-buckets --query "length(Buckets)"', 'El bucket sobrevivió: 1'],
      ["aws sqs list-queues --query 'length(QueueUrls || `[]`)'", 'La cola no: 0'],
    ],
    seeAlso: ['Estados y retroceso de una pila', 'AWS CDK'],
  },
  {
    name: 'Conjuntos de cambios (change sets)',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'Un conjunto de cambios es la vista previa de una actualización: qué recursos se añaden, modifican o eliminan y, sobre todo, si algún recurso se sustituye (Replacement: True). Se revisa y solo entonces se ejecuta.',
    details: `
\`aws cloudformation create-change-set\` compara la plantilla nueva con la pila y devuelve, por recurso:

- **Acción**: \`Add\`, \`Modify\`, \`Remove\`.
- **Replacement**: \`False\` (se modifica **sin interrupción** o con interrupciones), \`True\` (se **crea uno nuevo y se borra el viejo**: el dato del viejo se pierde) o \`Conditional\`.

Flujo seguro: \`create-change-set\` → \`wait change-set-create-complete\` → \`describe-change-set\` → \`execute-change-set\` (o \`delete-change-set\` si no te gusta). Es lo que hace \`aws cloudformation deploy\` por dentro, y lo que usa CodePipeline en el modo \`CHANGE_SET_REPLACE\` + \`CHANGE_SET_EXECUTE\` con una **aprobación** entre medias.

Para una pila nueva: \`--change-set-type CREATE\`.
`,
    whenUse: ['Siempre que toques recursos con datos o nombres: revisa si hay `Replacement`', 'Pipelines con aprobación humana: el revisor ve el cambio exacto'],
    whenNot: ['No confíes solo en la vista previa para valores que se resuelven al ejecutar: algunos cambios dependen de recursos creados en ese momento'],
    scenario: 'iac-cambios',
    examples: [
      [V2_RENAME, 'La plantilla nueva cambia el nombre de la cola y el tiempo de visibilidad'],
      ['aws cloudformation create-change-set --stack-name tienda --change-set-name v2 --template-body file://v2.json', 'Crea el conjunto de cambios (no toca nada todavía)'],
      ['aws cloudformation wait change-set-create-complete --stack-name tienda --change-set-name v2', 'Espera a que esté calculado'],
      ['aws cloudformation describe-change-set --stack-name tienda --change-set-name v2 --query "Changes[].ResourceChange.[LogicalResourceId,Action,Replacement]"', '`Ventas`: `Modify` con `Replacement: True` — se perdería la cola con sus mensajes'],
      ['aws cloudformation delete-change-set --stack-name tienda --change-set-name v2', 'No lo ejecutamos: lo descartamos'],
      [V2, 'Mismo nombre de cola, solo cambia el tiempo'],
      ['aws cloudformation create-change-set --stack-name tienda --change-set-name v3 --template-body file://v2.json', 'Otro conjunto'],
      ['aws cloudformation wait change-set-create-complete --stack-name tienda --change-set-name v3', 'Espera'],
      ['aws cloudformation describe-change-set --stack-name tienda --change-set-name v3 --query "Changes[].ResourceChange.Replacement"', 'Ahora `False`: se modifica en el sitio'],
      ['aws cloudformation execute-change-set --stack-name tienda --change-set-name v3', 'Ejecutarlo'],
    ],
    seeAlso: ['aws cloudformation deploy', 'Deriva de pila (drift)', 'AWS CloudFormation'],
  },
  {
    name: 'Deriva de pila (drift)',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'La deriva es la diferencia entre lo que dice la plantilla y lo que hay de verdad porque alguien tocó un recurso a mano. detect-stack-drift la encuentra; arreglarla es decidir quién manda: la plantilla o el cambio manual.',
    details: `
\`aws cloudformation detect-stack-drift --stack-name web\` devuelve un id; consulta el resultado con \`describe-stack-drift-detection-status\` y el detalle con \`describe-stack-resource-drifts\`:

- \`IN_SYNC\`: coincide.
- \`MODIFIED\`: hay propiedades distintas (te dice cuáles: valor esperado frente al actual).
- \`DELETED\`: borraron el recurso.
- \`NOT_CHECKED\`: ese tipo de recurso no admite detección.

**Cómo se arregla**
1. Si el cambio manual era un error → **revertirlo** (o ejecutar de nuevo la plantilla si cambia algo).
2. Si era un cambio legítimo → **llevarlo a la plantilla** y actualizar la pila.
3. Un cambio de plantilla sin diferencia **no** repara la deriva: CloudFormation dice «No updates are to be performed».

Prevención: permisos de IAM que impidan editar a mano los recursos de las pilas, y AWS Config para detectar cambios.
`,
    whenUse: ['Revisiones periódicas de pilas de producción', 'Antes de una actualización grande: asegúrate de que parte de un estado conocido'],
    whenNot: ['No esperes que cubra todos los tipos de recurso ni todas las propiedades'],
    scenario: 'iac-deriva',
    examples: [
      ['ID=$(aws cloudformation detect-stack-drift --stack-name web --query StackDriftDetectionId --output text)', 'Inicia la detección'],
      ['aws cloudformation describe-stack-drift-detection-status --stack-drift-detection-id $ID --query "[StackDriftStatus,DriftedStackResourceCount]"', '`DRIFTED`: dos recursos cambiados a mano'],
      ['aws cloudformation describe-stack-resource-drifts --stack-name web --stack-resource-drift-status-filters MODIFIED --query "StackResourceDrifts[].[LogicalResourceId,StackResourceDriftStatus]"', 'Cuáles'],
      ['aws cloudformation describe-stack-resource-drifts --stack-name web --stack-resource-drift-status-filters MODIFIED --query "StackResourceDrifts[?LogicalResourceId==\'Avisos\'].PropertyDifferences[].[PropertyPath,ExpectedValue,ActualValue]" --output text', 'Esperado 45, actual 5'],
    ],
    seeAlso: ['Conjuntos de cambios (change sets)', 'AWS CloudFormation'],
  },
  {
    name: 'CloudFormation StackSets',
    kind: 'concepto',
    category: 'devops',
    level: 3,
    summary: 'Un conjunto de pilas despliega la misma plantilla en varias cuentas y regiones con una sola operación. Con permisos autogestionados necesita dos roles (administración y ejecución); con AWS Organizations, permisos gestionados por el servicio.',
    details: `
- **Conjunto** (\`create-stack-set\`): la plantilla y los parámetros.
- **Instancias** (\`create-stack-instances\`): en qué cuentas y regiones se despliega; cada una es una pila normal gestionada por el conjunto.
- **Actualizar el conjunto** propaga el cambio a todas las instancias; \`--operation-preferences\` controla cuántas a la vez y cuántos fallos se toleran.

**Dos modelos de permisos**
| | Autogestionados | Gestionados por el servicio |
| --- | --- | --- |
| Roles | \`AWSCloudFormationStackSetAdministrationRole\` (cuenta administradora) y \`AWSCloudFormationStackSetExecutionRole\` (cuentas destino) | Los crea AWS con **Organizations** |
| Destinos | Cuentas que listas | Unidades organizativas; las cuentas nuevas se incluyen solas |

Uso típico: roles de auditoría, reglas de Config o el *baseline* de seguridad en **todas** las cuentas y regiones.
`,
    whenUse: ['Una configuración común en muchas cuentas o regiones (auditoría, registros, roles)', 'Cuentas nuevas con el mismo punto de partida'],
    whenNot: ['Para un solo entorno: una pila normal es más simple', 'Recursos que dependen unos de otros entre cuentas'],
    scenario: 'base',
    examples: [
      [COLA, 'La plantilla común'],
      [TRUST_CFN, 'Política de confianza del rol de administración'],
      ['aws iam create-role --role-name AWSCloudFormationStackSetAdministrationRole --assume-role-policy-document file://adm.json --query Role.RoleName', 'Rol de administración'],
      [TRUST_ADM, 'El rol de ejecución confía en el de administración'],
      ['aws iam create-role --role-name AWSCloudFormationStackSetExecutionRole --assume-role-policy-document file://exe.json --query Role.RoleName', 'Rol de ejecución'],
      ['aws cloudformation create-stack-set --stack-set-name colas --template-body file://cola.json', 'Crea el conjunto'],
      ['aws cloudformation create-stack-instances --stack-set-name colas --accounts 123456789012 --regions us-east-1 eu-west-1', 'Lo despliega en dos regiones'],
      ['aws cloudformation list-stack-instances --stack-set-name colas --query "Summaries[].Region"', 'Las instancias'],
    ],
    seeAlso: ['AWS CloudFormation'],
  },

  // ───────────────────────── SAM y CDK ─────────────────────────
  {
    name: 'AWS SAM',
    kind: 'servicio',
    category: 'devops',
    level: 2,
    summary: 'SAM (Serverless Application Model) es una extensión de CloudFormation: con Transform AWS::Serverless-2016-10-31 declaras funciones, APIs y tablas en pocas líneas y CloudFormation las expande a los recursos de verdad (rol, función, permisos, API…).',
    details: `
\`\`\`yaml
Transform: AWS::Serverless-2016-10-31
Resources:
  Saludo:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.handler
      Runtime: python3.12
      CodeUri: src/
      Events:
        Raiz: {Type: HttpApi, Properties: {Path: /saludo, Method: get}}
\`\`\`

Tipos: \`AWS::Serverless::Function\`, \`SimpleTable\` (DynamoDB), \`Api\` / \`HttpApi\`, \`StateMachine\`, \`LayerVersion\`… En \`Globals\` pones lo común a todas las funciones. \`Policies:\` acepta **plantillas de políticas** (\`DynamoDBCrudPolicy\`, \`S3ReadPolicy\`, \`SQSSendMessagePolicy\`…): permisos mínimos con una línea.

**Flujo**: \`sam build\` → \`sam deploy\`, o con la CLI de AWS:
1. \`aws cloudformation package\`: sube el código de \`CodeUri\` a S3 y reescribe la plantilla.
2. \`aws cloudformation deploy\`: crea el *change set* y lo ejecuta. Hay que dar **\`CAPABILITY_IAM\`** (crea roles) y **\`CAPABILITY_AUTO_EXPAND\`** (hay una transformación).

\`sam local invoke\` y \`sam local start-api\` prueban en tu ordenador con contenedores.
`,
    whenUse: ['Aplicaciones serverless: función + API + tabla en una plantilla corta', 'Políticas mínimas con las plantillas de SAM'],
    whenNot: ['Infraestructura sin Lambda (redes, bases de datos): CloudFormation puro o CDK', 'Si quieres bucles o lógica al definir recursos: CDK'],
    scenario: 'base',
    examples: [
      ['mkdir -p src', 'Carpeta del código'],
      [SAM_APP, 'Una función mínima'],
      [SAM_JSON, 'Plantilla SAM (en JSON) con una función'],
      ['aws s3 mb s3://artefactos', 'Bucket donde `package` sube el código'],
      ['aws cloudformation package --template-file sam.json --s3-bucket artefactos --output-template-file empaquetada.json', 'Sube `src/` a S3 y reescribe `CodeUri`'],
      ['aws cloudformation deploy --template-file empaquetada.json --stack-name hola --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND', 'Despliega: crea el rol, la función…'],
      ['aws cloudformation list-stack-resources --stack-name hola --query "StackResourceSummaries[].ResourceType"', 'SAM generó también el rol de la función'],
      ['aws cloudformation deploy --template-file empaquetada.json --stack-name hola2', 'Sin las capacidades: error', 'error'],
    ],
    seeAlso: ['aws cloudformation package', 'aws cloudformation deploy', 'AWS Lambda'],
  },
  {
    name: 'AWS CDK',
    kind: 'servicio',
    category: 'devops',
    level: 3,
    summary: 'CDK (Cloud Development Kit) te deja definir la infraestructura en un lenguaje de programación (Python, TypeScript, Java…). cdk synth genera una plantilla de CloudFormation y cdk deploy la despliega: por debajo, siempre es CloudFormation.',
    details: `
\`\`\`python
class DatosStack(Stack):
    def __init__(self, scope, id, **kw):
        super().__init__(scope, id, **kw)
        s3.Bucket(self, "Archivo", versioned=True)
        sqs.Queue(self, "Cola")
\`\`\`

- **Constructos**: L1 (\`CfnBucket\`: 1 a 1 con CloudFormation), **L2** (\`Bucket\`: valores por defecto razonables y métodos como \`grant_read\`) y **L3**/patrones (varios recursos juntos).
- **Orden de trabajo**: \`cdk init\` → \`cdk synth\` (genera \`cdk.out/*.template.json\`) → \`cdk diff\` (equivale a un *change set*) → \`cdk deploy\` → \`cdk destroy\`.
- **Bootstrap** (\`cdk bootstrap\`): una vez por cuenta y región crea la pila \`CDKToolkit\` con un bucket y roles para subir *assets* (código de Lambda, imágenes). Sin ella, \`cdk deploy\` falla.
- **Valores por defecto de protección**: los buckets, bases de datos y claves se crean con *removal policy* \`RETAIN\`; las colas y funciones, no.

Lo bueno: bucles, condiciones, funciones reutilizables y pruebas unitarias sobre la infraestructura. Lo malo: más abstracción; para entender un fallo acabas leyendo la plantilla generada.
`,
    whenUse: ['Equipos de desarrollo que prefieren su lenguaje a YAML', 'Infraestructura repetitiva o con lógica (varias regiones, bucles de subredes)'],
    whenNot: ['Plantillas pequeñas y estables: CloudFormation directo es más transparente', 'Si no quieres depender de Node.js y de versiones de la biblioteca'],
    scenario: 'base',
    examples: [
      [String.raw`echo '{"Resources":{"Archivo":{"Type":"AWS::S3::Bucket","UpdateReplacePolicy":"Retain","DeletionPolicy":"Retain"},"Cola":{"Type":"AWS::SQS::Queue","UpdateReplacePolicy":"Delete","DeletionPolicy":"Delete"}}}' > DatosStack.template.json`, 'Lo que produciría `cdk synth`: una plantilla de CloudFormation'],
      ['aws cloudformation deploy --template-file DatosStack.template.json --stack-name DatosStack', 'Lo que hace `cdk deploy`'],
      ['aws cloudformation delete-stack --stack-name DatosStack', 'Lo que hace `cdk destroy`'],
      ['aws cloudformation wait stack-delete-complete --stack-name DatosStack', 'Espera'],
      ['aws s3api list-buckets --query "length(Buckets)"', 'El bucket `RETAIN` sigue ahí'],
    ],
    seeAlso: ['AWS CloudFormation', 'AWS SAM', 'DeletionPolicy y UpdateReplacePolicy'],
  },

  // ───────────────────────── CI/CD ─────────────────────────
  {
    name: 'AWS CodeBuild',
    kind: 'servicio',
    category: 'devops',
    level: 2,
    summary: 'CodeBuild compila, prueba y empaqueta tu código en un contenedor efímero que ejecuta las órdenes de un buildspec.yml. Pagas por minuto de compilación y no hay servidores que mantener.',
    details: `
Un **proyecto** define: de dónde sale el código (\`S3\`, \`CODEPIPELINE\`, GitHub…), el **entorno** (imagen, tamaño del contenedor), el **rol de servicio** y los **artefactos** (dónde deja el resultado).

Cada compilación recorre fases: \`SUBMITTED\` → \`QUEUED\` → \`PROVISIONING\` → \`DOWNLOAD_SOURCE\` → \`INSTALL\` → \`PRE_BUILD\` → \`BUILD\` → \`POST_BUILD\` → \`UPLOAD_ARTIFACTS\` → \`FINALIZING\`. Si una orden de una fase falla, esa fase y la compilación fallan (\`post_build\` se ejecuta igualmente, y puedes saber si todo va bien con \`$CODEBUILD_BUILD_SUCCEEDING\`).

Los **registros** van a CloudWatch Logs (\`/aws/codebuild/<proyecto>\`). El **rol de servicio** es la identidad de los comandos \`aws\` que ejecuta la compilación: si le falta un permiso, falla ahí.

Si el proyecto va dentro de **CodePipeline**, el origen y los artefactos son \`CODEPIPELINE\` y es la canalización quien la lanza.
`,
    whenUse: ['Pruebas y empaquetado en cada cambio (CI)', 'Construir imágenes de contenedor y subirlas a ECR', 'Pasos de `aws cloudformation package` para SAM'],
    whenNot: ['Cargas largas y continuas: usa ECS, EC2 o Batch', 'Para ejecutar tu aplicación: CodeBuild es solo para construir'],
    pricing: 'Por minuto de compilación, según el tamaño del contenedor (small, medium, large…). Hay una capa gratuita mensual.',
    limits: ['Tiempo máximo de una compilación: 8 horas (por defecto 60 minutos)', 'Proyectos por región: 5.000'],
    scenario: 'iac-build',
    examples: [
      ['aws codebuild list-projects', 'El proyecto `tienda`'],
      ['aws codebuild batch-get-projects --names tienda --query "projects[0].[source.location,environment.image,serviceRole]" --output text', 'De dónde coge el código y con qué rol'],
      ['ID=$(aws codebuild start-build --project-name tienda --query build.id --output text)', 'Lanza una compilación'],
      ['aws codebuild batch-get-builds --ids $ID --query "builds[0].[buildStatus,currentPhase]" --output text', 'Recién lanzada: `IN_PROGRESS`'],
      ['aws codebuild list-builds-for-project --project-name tienda --query "length(ids)"', 'Historial: 1'],
    ],
    seeAlso: ['buildspec.yml', 'aws codebuild start-build', 'AWS CodePipeline'],
  },
  {
    name: 'buildspec.yml',
    kind: 'concepto',
    category: 'devops',
    level: 2,
    summary: 'Archivo YAML (en la raíz del código o en el proyecto) que dice a CodeBuild qué hacer: variables de entorno, fases con órdenes (install, pre_build, build, post_build) y qué archivos son el artefacto.',
    details: `
\`\`\`yaml
version: 0.2
env:
  variables:
    ENTORNO: pruebas
phases:
  install:
    commands:
      - pip install pytest
  pre_build:
    commands:
      - pytest -q
  build:
    commands:
      - mkdir -p dist && cp app.py dist/
  post_build:
    commands:
      - echo "Fin: éxito=$CODEBUILD_BUILD_SUCCEEDING"
artifacts:
  files:
    - '**/*'
  base-directory: dist
  name: tienda
\`\`\`

- Cada fase corre sus órdenes **en secuencia**; si una falla (código de salida distinto de 0), la fase falla y se detiene la compilación (salvo \`post_build\`, que sigue).
- \`artifacts.files\` + \`base-directory\`: qué se sube y desde qué carpeta. Si no coincide ningún archivo, falla en \`UPLOAD_ARTIFACTS\`.
- \`env.parameter-store\` y \`env.secrets-manager\` inyectan secretos sin escribirlos en el código.
- \`cache\`: carpetas que se conservan entre compilaciones (p. ej. dependencias).
- Un buildspec en el proyecto (\`--buildspec\`) se puede sobrescribir en cada \`start-build\`.
`,
    whenUse: ['Todas las pruebas y pasos de empaquetado dentro del buildspec, versionados con el código'],
    whenNot: ['No escribas credenciales en el buildspec: usa el rol del proyecto y secretos de Secrets Manager o Parameter Store'],
    seeAlso: ['AWS CodeBuild'],
  },
  {
    name: 'AWS CodeDeploy',
    kind: 'servicio',
    category: 'devops',
    level: 3,
    summary: 'CodeDeploy automatiza despliegues en EC2, ECS y Lambda con un reparto de tráfico gradual (canario, lineal o todo de golpe), ganchos de validación, alarmas de CloudWatch y vuelta atrás automática.',
    details: `
Conceptos: **aplicación** (plataforma EC2/on-premises, ECS o Lambda), **grupo de despliegue** (a qué se despliega, con qué rol, con qué configuración y alarmas), **configuración de despliegue** y **AppSpec** (qué desplegar).

**Para Lambda**: AppSpec indica la función, el alias y las versiones actual y destino. CodeDeploy mueve el **alias** de una versión a otra repartiendo tráfico:
| Configuración | Tráfico |
| --- | --- |
| \`LambdaAllAtOnce\` | 100 % a la nueva de golpe |
| \`LambdaCanary10Percent5Minutes\` (o 10/15/30 min) | 10 % a la nueva; si no hay problemas, el resto tras X minutos |
| \`LambdaLinear10PercentEvery1Minute\` (2, 3, 10) | +10 % cada intervalo |

- **Ganchos** (\`BeforeAllowTraffic\`, \`AfterAllowTraffic\`): funciones Lambda que validan y avisan con \`put-lifecycle-event-hook-execution-status\`.
- **Alarmas**: si una alarma de CloudWatch (errores, latencia) salta durante el despliegue, se detiene.
- **Retroceso automático**: \`--auto-rollback-configuration enabled=true,events=DEPLOYMENT_FAILURE,DEPLOYMENT_STOP_ON_ALARM\` devuelve el alias a la versión anterior.

Necesita un **rol de servicio** de confianza \`codedeploy.amazonaws.com\`.
`,
    whenUse: ['Publicar versiones nuevas de Lambda reduciendo el riesgo', 'Despliegues azul/verde en ECS o EC2 con vuelta atrás'],
    whenNot: ['Cambios de infraestructura: usa CloudFormation', 'Si basta con `update-function-code`, la versión nueva se publica de golpe'],
    pricing: 'Gratis para EC2, Lambda y ECS. Para servidores locales, una pequeña cuota por actualización de instancia.',
    scenario: 'iac-deploy',
    examples: [
      ['aws deploy list-applications', 'La aplicación `tienda` (plataforma Lambda)'],
      ['aws deploy list-deployment-configs --query "deploymentConfigsList[?contains(@, \'LambdaCanary\')]"', 'Las configuraciones de canario'],
      [GRUPO, 'Grupo con canario del 10 % en 10 minutos, alarma y vuelta atrás'],
      ['aws deploy get-deployment-group --application-name tienda --deployment-group-name prod --query "deploymentGroupInfo.[deploymentConfigName,autoRollbackConfiguration.events]"', 'Cómo quedó configurado'],
      ['aws lambda get-alias --function-name tienda --name live --query FunctionVersion', 'El alias `live` apunta a la versión 1'],
    ],
    seeAlso: ['aws deploy create-deployment', 'Estrategias de despliegue', 'AWS CodePipeline'],
  },
  {
    name: 'AWS CodePipeline',
    kind: 'servicio',
    category: 'devops',
    level: 2,
    summary: 'CodePipeline orquesta la entrega continua: etapas (origen, compilación, pruebas, aprobación, despliegue) con acciones que pasan artefactos de una a otra. Cada cambio en el origen lanza la canalización entera.',
    details: `
- **Etapas** → **acciones** (en serie por \`runOrder\`, en paralelo con el mismo número).
- **Artefactos**: una acción deja su salida (un zip) en el **almacén de artefactos** (un bucket S3) y la siguiente la coge como entrada.
- **Origen**: S3 (el bucket **debe tener versiones**), CodeCommit, GitHub (CodeStar Connections), ECR.
- **Acciones de compilación/prueba**: CodeBuild. **Despliegue**: CloudFormation, CodeDeploy, S3, ECS, Elastic Beanstalk. **Aprobación manual**: la canalización se detiene hasta que alguien aprueba o rechaza.
- Un **rol de servicio** propio, que debe poder usar el almacén de artefactos, lanzar CodeBuild, operar CloudFormation y **pasar** (\`iam:PassRole\`) el rol que use la pila.

**Diagnóstico**: \`get-pipeline-state\` te dice qué etapa está parada y por qué (\`errorDetails\`); \`list-action-executions\` da el historial. Se reintenta con \`retry-stage-execution\` o lanzando otra ejecución (\`start-pipeline-execution\`).

Cada cambio nuevo en el origen **sustituye** a la ejecución anterior en las etapas (modo *superseded*).
`,
    whenUse: ['Entrega continua desde el código hasta producción, con aprobaciones donde las necesites', 'Un único sitio donde ver qué versión está en cada entorno'],
    whenNot: ['Si solo quieres compilar al hacer push: CodeBuild con un disparador basta', 'Flujos muy a medida con muchos pasos manuales: Step Functions'],
    pricing: 'Por canalización activa y mes (con la primera gratis); las acciones (CodeBuild, etc.) se cobran aparte.',
    limits: ['Hasta 50 etapas y 50 acciones por etapa', 'Acciones de aprobación manual caducan a los 7 días'],
    scenario: 'iac-aprobacion',
    examples: [
      ['aws codepipeline list-pipelines --query "pipelines[].name"', 'La canalización `web`'],
      ['aws codepipeline get-pipeline --name web --query "pipeline.stages[].name"', 'Sus etapas'],
      ['aws codepipeline get-pipeline-state --name web --query "stageStates[].[stageName,latestExecution.status]" --output text', 'Parada en la aprobación (`Aprobar InProgress`)'],
      ['aws codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[].[status,trigger.triggerType]" --output text', 'Una ejecución en curso'],
      ['aws codepipeline list-action-executions --pipeline-name web --query "actionExecutionDetails[].[stageName,actionName,status]" --output text', 'El historial por acción'],
    ],
    seeAlso: ['aws codepipeline get-pipeline-state', 'aws codepipeline put-approval-result', 'AWS CodeBuild', 'AWS CodeDeploy'],
  },
  {
    name: 'Estrategias de despliegue',
    kind: 'comparativa',
    category: 'devops',
    level: 3,
    summary: 'Desplegar una versión nueva puede ser «parar y sustituir», por tandas, con otro entorno en paralelo o enviando poco a poco el tráfico. Cada estrategia cambia riesgo, coste, tiempo y capacidad de volver atrás.',
    details: `
| Estrategia | Cómo | Riesgo | Vuelta atrás | Coste extra |
| --- | --- | --- | --- | --- |
| **In-place / todo de golpe** | Se sustituye la versión en los mismos servidores | Alto: hay corte o todos reciben el fallo | Lenta (redesplegar lo anterior) | Ninguno |
| **Rolling** | Por tandas (25 %, 50 %…) | Medio: parte de los usuarios ve el fallo | Media | Ninguno |
| **Rolling con lote adicional** | Se añaden instancias nuevas antes de retirar viejas | Medio-bajo: nunca baja la capacidad | Media | Pequeño y temporal |
| **Inmutable** | Un grupo nuevo completo; si va bien, sustituye al viejo | Bajo | Rápida (se descarta el nuevo) | Doble capacidad mientras dura |
| **Azul/verde** | Entorno nuevo (verde) en paralelo; se cambia el tráfico (DNS, ALB, alias) de golpe | Bajo | **Inmediata** (volver al azul) | Doble entorno mientras dura |
| **Canario** | Un 5-10 % del tráfico a la nueva; si todo bien, el resto | Muy bajo | Inmediata | Mínimo |
| **Lineal** | +10 % cada X minutos | Muy bajo | Inmediata | Mínimo |

Complementos: **alarmas** de CloudWatch que detienen y revierten solos, **ganchos** de validación, *feature flags* (el código nuevo está desplegado pero apagado) y migraciones de base de datos **compatibles hacia atrás** (la versión vieja y la nueva conviven con el mismo esquema).

Elastic Beanstalk, CodeDeploy, ECS y Lambda (alias con pesos) ofrecen varias de estas estrategias ya hechas.
`,
    whenUse: ['Canario o lineal con alarmas: producción con usuarios reales y cambios de riesgo', 'Azul/verde: cambios grandes (versión de motor, plataforma) donde quieres volver atrás en segundos', 'Rolling: servicios con muchas instancias y cambios pequeños'],
    whenNot: ['Azul/verde con bases de datos incompatibles entre versiones: ambos entornos comparten datos', 'Todo de golpe en producción sin vuelta atrás probada'],
    seeAlso: ['AWS CodeDeploy', 'AWS Elastic Beanstalk'],
  },
  {
    name: 'AWS Elastic Beanstalk',
    kind: 'servicio',
    category: 'devops',
    level: 2,
    summary: 'Elastic Beanstalk despliega aplicaciones web (Python, Node.js, Java, .NET, Docker…) subiendo solo el código: crea y gestiona el balanceador, el Auto Scaling y las instancias EC2. Tú sigues teniendo acceso a todo lo que crea.',
    details: `
- **Aplicación** → **versiones** (cada \`zip\` subido) → **entornos** (dev, pre, prod: cada uno con su balanceador y su grupo de instancias).
- **Plataforma**: sistema + lenguaje gestionados (\`Python 3.12 running on 64bit Amazon Linux 2023\`).
- Configuración en el entorno o en \`.ebextensions/\` y \`.platform/\` dentro del código.
- Política de despliegue por entorno: \`All at once\`, \`Rolling\`, \`Rolling with additional batch\`, \`Immutable\` o \`Traffic splitting\` (canario).
- **Azul/verde**: clona el entorno, despliega la versión nueva y **intercambia las URL** (*swap environment URLs*); si falla, vuelves a intercambiar.
- CLI propia: \`eb init\`, \`eb create\`, \`eb deploy\`, \`eb swap\`.

Es el término medio entre «gestionar EC2 a mano» y «serverless»: más sencillo que montar balanceador + ASG + despliegues con CloudFormation, a cambio de menos control fino y de un modelo propio. Para contenedores modernos hoy se prefiere ECS/Fargate o App Runner.
`,
    whenUse: ['Una aplicación web clásica que quieres en AWS rápido, sin montar la infraestructura', 'Equipos pequeños que no quieren gestionar balanceadores ni ASG'],
    whenNot: ['Arquitecturas con muchos servicios y requisitos finos de red: ECS/EKS o CloudFormation', 'Cargas serverless: Lambda y API Gateway'],
    pricing: 'Elastic Beanstalk es gratis: pagas los recursos que crea (EC2, ELB, almacenamiento…).',
    versus: [
      ['AWS App Runner', 'Para contenedores o código con aún menos configuración.'],
      ['Amazon ECS', 'Más control sobre contenedores y redes.'],
      ['AWS Lambda', 'Sin servidores; para cargas dirigidas por eventos.'],
    ],
    seeAlso: ['Estrategias de despliegue', 'AWS CodePipeline'],
  },

  // ───────────────────────── Comandos ─────────────────────────
  {
    name: 'aws cloudformation deploy',
    kind: 'comando',
    category: 'devops',
    level: 2,
    summary: 'Despliega una plantilla en un solo comando: crea la pila si no existe o, si existe, crea un change set y lo ejecuta. Espera a que termine y falla si hay error. Es la forma cómoda para scripts y CI.',
    usage: 'aws cloudformation deploy --template-file <plantilla> --stack-name <pila> [--parameter-overrides K=V …] [--capabilities CAPABILITY_IAM …] [--no-fail-on-empty-changeset] [--role-arn <rol>]',
    details: `
- Sin cambios, el comando termina con un mensaje y **código distinto de 0**; con \`--no-fail-on-empty-changeset\` es un éxito (lo habitual en pipelines).
- Las plantillas con \`Transform\` (SAM) necesitan \`CAPABILITY_AUTO_EXPAND\`; las que crean roles o políticas de IAM, \`CAPABILITY_IAM\` (o \`CAPABILITY_NAMED_IAM\` si les pones nombre).
- Si la plantilla usa \`CodeUri\` o referencias locales, pasa antes por \`aws cloudformation package\`.
- Si la pila quedó en \`ROLLBACK_COMPLETE\`, \`deploy\` no puede actualizarla: bórrala primero.
`,
    scenario: 'base',
    examples: [
      [String.raw`echo '{"Parameters":{"Tiempo":{"Type":"Number","Default":30}},"Resources":{"Cola":{"Type":"AWS::SQS::Queue","Properties":{"VisibilityTimeout":{"Ref":"Tiempo"}}}}}' > t.json`, 'Plantilla con un parámetro numérico'],
      ['aws cloudformation deploy --template-file t.json --stack-name demo', 'Crea la pila'],
      ['aws cloudformation deploy --template-file t.json --stack-name demo --parameter-overrides Tiempo=90', 'Cambia un parámetro: actualiza la pila'],
      ['aws cloudformation deploy --template-file t.json --stack-name demo --parameter-overrides Tiempo=90 --no-fail-on-empty-changeset', 'Sin cambios: no es un error'],
      ['aws cloudformation deploy --template-file t.json --stack-name demo --parameter-overrides Tiempo=90', 'Sin cambios y sin la opción: falla', 'error'],
    ],
    seeAlso: ['aws cloudformation package', 'Conjuntos de cambios (change sets)', 'AWS SAM'],
  },
  {
    name: 'aws cloudformation package',
    kind: 'comando',
    category: 'devops',
    level: 2,
    summary: 'Sube a S3 los archivos locales a los que apunta la plantilla (CodeUri, Code de Lambda, plantillas anidadas) y escribe otra plantilla con las rutas de S3, lista para desplegar desde cualquier sitio.',
    usage: 'aws cloudformation package --template-file <plantilla> --s3-bucket <bucket> [--s3-prefix <prefijo>] [--output-template-file <salida>]',
    details: `
- El bucket debe existir ya y tu identidad debe poder escribir en él.
- Comprime la carpeta de \`CodeUri\` en un \`.zip\`, lo sube con un nombre basado en su hash (si no cambió, no vuelve a subirlo) y sustituye \`CodeUri: src/\` por \`s3://bucket/hash\`.
- Es el paso que va **antes** de \`deploy\` en cualquier plantilla SAM o con código local; en una canalización suele ejecutarse en CodeBuild y su resultado (\`empaquetada.yaml\`) pasa como artefacto a la acción de CloudFormation.
`,
    scenario: 'base',
    examples: [
      ['mkdir -p src', 'Carpeta del código'],
      [SAM_APP, 'Una función mínima'],
      [SAM_JSON, 'Plantilla SAM con `CodeUri: src/`'],
      ['aws s3 mb s3://artefactos', 'El bucket de destino'],
      ['aws cloudformation package --template-file sam.json --s3-bucket artefactos --output-template-file out.json', 'Empaqueta'],
      ['aws s3 ls s3://artefactos/', 'El zip subido, con nombre de hash'],
      ['aws cloudformation package --template-file sam.json --s3-bucket no-existe --output-template-file out2.json', 'Bucket inexistente: error', 'error'],
    ],
    seeAlso: ['aws cloudformation deploy', 'AWS SAM'],
  },
  {
    name: 'aws cloudformation describe-stack-events',
    kind: 'comando',
    category: 'devops',
    level: 2,
    summary: 'Lista, del más reciente al más antiguo, todo lo que ha pasado en una pila. Para saber por qué falló, busca el primer *_FAILED y lee ResourceStatusReason.',
    usage: 'aws cloudformation describe-stack-events --stack-name <pila> [--query "StackEvents[?contains(ResourceStatus, `FAILED`)]"]',
    details: `
Cada evento: \`Timestamp\`, \`LogicalResourceId\`, \`ResourceType\`, \`ResourceStatus\` y, si falla, \`ResourceStatusReason\`. Los eventos de la propia pila tienen el tipo \`AWS::CloudFormation::Stack\`.

Truco: **el primer error cronológico** es la causa; los demás son la reversión. Con \`--query\` filtras: \`"StackEvents[?ResourceStatus=='CREATE_FAILED']"\`. Para una pila ya **borrada** necesitas su *StackId* (el nombre ya no sirve).
`,
    scenario: 'iac-pilas',
    examples: [
      ['aws cloudformation describe-stack-events --stack-name catalogo --query "length(StackEvents)"', 'Cuántos eventos hay'],
      ['aws cloudformation describe-stack-events --stack-name catalogo --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\'].[LogicalResourceId,ResourceStatusReason]" --output text', 'La causa del fallo'],
      ['aws cloudformation describe-stack-events --stack-name catalogo --query "StackEvents[?ResourceType==\'AWS::CloudFormation::Stack\'].ResourceStatus" --output text', 'El estado de la pila a lo largo del tiempo'],
    ],
    seeAlso: ['Estados y retroceso de una pila'],
  },
  {
    name: 'aws codebuild start-build',
    kind: 'comando',
    category: 'devops',
    level: 2,
    summary: 'Lanza una compilación de un proyecto de CodeBuild. Devuelve el id; el resultado se consulta con batch-get-builds y los registros con logs get-log-events.',
    usage: 'aws codebuild start-build --project-name <proyecto> [--environment-variables-override name=X,value=Y] [--buildspec-override file://spec.yml] [--source-version <versión>]',
    details: `
No espera a que termine: la compilación pasa por fases. Consulta \`aws codebuild batch-get-builds --ids <id>\` y mira \`buildStatus\` (\`IN_PROGRESS\`, \`SUCCEEDED\`, \`FAILED\`, \`STOPPED\`) y, en \`phases\`, cuál falló y su mensaje.

Los **registros** están en el grupo \`/aws/codebuild/<proyecto>\` (flujo = id de la compilación sin el nombre del proyecto). Los proyectos con origen \`CODEPIPELINE\` no se lanzan a mano: los lanza la canalización.
`,
    scenario: 'iac-build',
    examples: [
      ['ID=$(aws codebuild start-build --project-name tienda --query build.id --output text)', 'Guarda el id'],
      ['aws codebuild batch-get-builds --ids $ID --query "builds[0].buildStatus" --output text', 'Recién empezada: `IN_PROGRESS`'],
      ['aws codebuild start-build --project-name no-existe', 'Un proyecto inexistente: error', 'error'],
    ],
    seeAlso: ['AWS CodeBuild', 'buildspec.yml'],
  },
  {
    name: 'aws codepipeline get-pipeline-state',
    kind: 'comando',
    category: 'devops',
    level: 2,
    summary: 'Muestra el estado de cada etapa y acción de la última ejecución: Succeeded, InProgress o Failed, con el motivo del fallo (errorDetails) y el token de las aprobaciones pendientes.',
    usage: 'aws codepipeline get-pipeline-state --name <canalización>',
    details: `
Dentro de \`stageStates[].actionStates[].latestExecution\` encuentras \`status\`, \`summary\`, \`errorDetails.message\`, \`externalExecutionId\` (id de la compilación o del despliegue que lanzó) y, en una aprobación manual, el \`token\` que necesita \`put-approval-result\`.

Una etapa sin \`latestExecution\` es que la ejecución no ha llegado todavía.
`,
    scenario: 'iac-aprobacion',
    examples: [
      ['aws codepipeline get-pipeline-state --name web --query "stageStates[].[stageName,latestExecution.status]" --output text', 'Origen y Compilar bien; Aprobar esperando; Publicar sin empezar'],
      ['aws codepipeline get-pipeline-state --name web --query "stageStates[?stageName==\'Compilar\'].actionStates[0].latestExecution.[status,externalExecutionId]" --output text', 'La compilación que lanzó la etapa'],
      ['aws codepipeline get-pipeline-state --name web --query "stageStates[?stageName==\'Aprobar\'].actionStates[0].latestExecution.summary" --output text', 'El texto para el revisor'],
    ],
    seeAlso: ['AWS CodePipeline', 'aws codepipeline put-approval-result'],
  },
  {
    name: 'aws codepipeline put-approval-result',
    kind: 'comando',
    category: 'devops',
    level: 2,
    summary: 'Aprueba o rechaza una acción de aprobación manual que está esperando. Si apruebas, la canalización sigue; si rechazas, la ejecución falla. Necesita el token de la ejecución concreta.',
    usage: 'aws codepipeline put-approval-result --pipeline-name <c> --stage-name <etapa> --action-name <acción> --result summary="…",status=Approved|Rejected --token <token>',
    details: `
El **token** se obtiene con \`get-pipeline-state\` (\`latestExecution.token\` de la acción de aprobación) y vale solo para esa ejecución: no se puede reutilizar. En el mundo real también se aprueba desde la consola o con una notificación de SNS que avisa al revisor; la identidad que aprueba necesita el permiso \`codepipeline:PutApprovalResult\`.
`,
    scenario: 'iac-aprobacion',
    examples: [
      [TOKEN, 'Lee el token de la aprobación'],
      ['aws codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revision --result summary=ok,status=Quizas --token $TOKEN', 'Un estado que no existe: error', 'error'],
      ['aws codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revision --result summary=Revisado,status=Approved --token $TOKEN', 'Aprueba: la canalización continúa'],
      ['aws codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revision --result summary=Otra,status=Approved --token $TOKEN', 'Ya no espera nada: error', 'error'],
    ],
    seeAlso: ['aws codepipeline get-pipeline-state', 'AWS CodePipeline'],
  },
  {
    name: 'aws deploy create-deployment',
    kind: 'comando',
    category: 'devops',
    level: 3,
    summary: 'Lanza un despliegue de CodeDeploy con un AppSpec. En Lambda, mueve el alias de la versión actual a la nueva con el reparto de tráfico de la configuración del grupo; en EC2 y ECS, despliega la revisión.',
    usage: 'aws deploy create-deployment --application-name <app> --deployment-group-name <grupo> --revision file://revision.json [--deployment-config-name <config>]',
    details: `
La revisión puede ser un AppSpec dentro de la propia llamada (\`revisionType: AppSpecContent\`) o un archivo en S3. Para **Lambda** el AppSpec nombra la función, el alias y las versiones:

\`\`\`yaml
version: 0.0
Resources:
  - tienda:
      Type: AWS::Lambda::Function
      Properties: {Name: tienda, Alias: live, CurrentVersion: "1", TargetVersion: "2"}
\`\`\`

Falla si \`CurrentVersion\` no es la que tiene el alias ahora o si hay otro despliegue en curso sobre la misma función. Se sigue con \`get-deployment\` (\`status\`: \`InProgress\`, \`Succeeded\`, \`Failed\`, \`Stopped\`), y se detiene con \`stop-deployment --auto-rollback-enabled\`.
`,
    scenario: 'iac-deploy',
    examples: [
      [GRUPO, 'Crea el grupo con canario, alarma y vuelta atrás'],
      [REVISION, 'El AppSpec: pasar `live` de la versión 1 a la 2'],
      ['ID=$(aws deploy create-deployment --application-name tienda --deployment-group-name prod --revision file://revision.json --query deploymentId --output text)', 'Lanza el despliegue'],
      ['aws deploy get-deployment --deployment-id $ID --query deploymentInfo.status --output text', '`InProgress`: el canario está en marcha'],
      ['aws lambda get-alias --function-name tienda --name live --query "[FunctionVersion,RoutingConfig.AdditionalVersionWeights]"', 'El alias reparte: 10 % a la versión 2'],
      ['aws deploy create-deployment --application-name tienda --deployment-group-name prod --revision file://revision.json', 'Otro a la vez sobre la misma función: error', 'error'],
    ],
    seeAlso: ['AWS CodeDeploy', 'Estrategias de despliegue'],
  },
];
