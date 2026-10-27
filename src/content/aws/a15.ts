import { A, all, awsAfter, awsHas, awsIs, awsMatches, awsWorld, demo, illus, learn, lesson, match, mc, multi, order, practice, predict, tf } from './awsbuild';

/** Si la aplicación (usuario `user`) puede hacer la operación; el resultado es `true` o `false`. */
const PUEDE = (user: string, service: string, op: string, params: object) => `_check act --user ${user} --service ${service} --op ${op} --params '${JSON.stringify(params)}' --query Ok`;
const LEE_BALANCE = PUEDE('app-informes', 's3api', 'get-object', { Bucket: 'informes-clientes', Key: 'balance.csv' });
const BORRA_CLAVE = (user: string, key: string) => PUEDE(user, 'kms', 'schedule-key-deletion', { KeyId: key });
const POLITICA_PAGOS = String.raw`cat > politica.json <<EOF
{
  "Version": "2012-10-17",
  "Id": "key-pagos",
  "Statement": [
    {
      "Sid": "Administradores",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::123456789012:user/alumno"},
      "Action": ["kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion"],
      "Resource": "*"
    },
    {
      "Sid": "Aplicacion",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::123456789012:user/app-pagos"},
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "*"
    }
  ]
}
EOF`;

const HTTP = (path: string, extra = '') => `_check http --url "lb:tienda-alb${path}" ${extra}`.trim();
/** La petición con inyección SQL que usan los retos de WAF. */
const SQLI = "/buscar?q=1'%20OR%20'1'='1";
const NO_403 = '^(?!403)\\d+$';
const DNS_ALB = 'DNS=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text)';
const CODIGO = (path: string) => `curl -s -o /dev/null -w '%{http_code}\\n' http://$DNS${path}`;
const VIS = (name: string) => `{"SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "${name}"}`;
const REGLA_ADMIN = `echo '[{"Name":"BloquearAdmin","Priority":1,"Statement":{"ByteMatchStatement":{"SearchString":"/admin","FieldToMatch":{"UriPath":{}},"TextTransformations":[{"Priority":0,"Type":"NONE"}],"PositionalConstraint":"STARTS_WITH"}},"Action":{"Block":{}},"VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"BloquearAdmin"}}]' > reglas.json`;
const ADMIN_OFICINA = String.raw`cat > reglas.json <<EOF
[
  {
    "Name": "AdminSoloOficina",
    "Priority": 1,
    "Statement": {"AndStatement": {"Statements": [
      {"ByteMatchStatement": {"SearchString": "/admin", "FieldToMatch": {"UriPath": {}}, "TextTransformations": [{"Priority": 0, "Type": "LOWERCASE"}], "PositionalConstraint": "STARTS_WITH"}},
      {"NotStatement": {"Statement": {"IPSetReferenceStatement": {"ARN": "$IPS"}}}}
    ]}},
    "Action": {"Block": {}},
    "VisibilityConfig": {"SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "AdminSoloOficina"}
  }
]
EOF`;
const GRUPOS = `cat > reglas.json <<EOF
[
  {
    "Name": "Comunes",
    "Priority": 1,
    "Statement": {"ManagedRuleGroupStatement": {"VendorName": "AWS", "Name": "AWSManagedRulesCommonRuleSet", "RuleActionOverrides": [{"Name": "SizeRestrictions_BODY", "ActionToUse": {"Count": {}}}]}},
    "OverrideAction": {"None": {}},
    "VisibilityConfig": ${VIS('Comunes')}
  },
  {
    "Name": "InyeccionSQL",
    "Priority": 2,
    "Statement": {"ManagedRuleGroupStatement": {"VendorName": "AWS", "Name": "AWSManagedRulesSQLiRuleSet"}},
    "OverrideAction": {"None": {}},
    "VisibilityConfig": ${VIS('InyeccionSQL')}
  }
]
EOF`;
const LIMITE_LOGIN = `cat > reglas.json <<EOF
[
  {
    "Name": "LimiteLogin",
    "Priority": 1,
    "Statement": {"RateBasedStatement": {"Limit": 100, "AggregateKeyType": "IP", "EvaluationWindowSec": 300, "ScopeDownStatement": {"ByteMatchStatement": {"SearchString": "/login", "FieldToMatch": {"UriPath": {}}, "TextTransformations": [{"Priority": 0, "Type": "NONE"}], "PositionalConstraint": "STARTS_WITH"}}}},
    "Action": {"Block": {}},
    "VisibilityConfig": ${VIS('LimiteLogin')}
  }
]
EOF`;
const SQLI_CONTAR = `cat > reglas.json <<EOF
[
  {
    "Name": "InyeccionSQL",
    "Priority": 1,
    "Statement": {"ManagedRuleGroupStatement": {"VendorName": "AWS", "Name": "AWSManagedRulesSQLiRuleSet"}},
    "OverrideAction": {"Count": {}},
    "VisibilityConfig": ${VIS('InyeccionSQL')}
  }
]
EOF`;
const SQLI_BLOQUEA = `cat > reglas.json <<EOF
[
  {
    "Name": "InyeccionSQL",
    "Priority": 1,
    "Statement": {"ManagedRuleGroupStatement": {"VendorName": "AWS", "Name": "AWSManagedRulesSQLiRuleSet"}},
    "OverrideAction": {"None": {}},
    "VisibilityConfig": ${VIS('InyeccionSQL')}
  }
]
EOF`;
/** Sustituye todas las reglas de la ACL `tienda-waf` (ya existente) por las de `reglas.json`. */
const ACTUALIZA_ACL = ['ID=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].Id" --output text)', 'TOKEN=$(aws wafv2 get-web-acl --name tienda-waf --scope REGIONAL --id $ID --query LockToken --output text)', 'aws wafv2 update-web-acl --name tienda-waf --scope REGIONAL --id $ID --lock-token $TOKEN --default-action Allow={} --rules file://reglas.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tienda-waf'];

const QUEUE = 'https://sqs.us-east-1.amazonaws.com/123456789012/guardia';
/** Mensajes que han llegado a la cola `guardia` (la que recibe lo que publica el tema `alertas`). */
const AVISOS = `sqs get-queue-attributes --queue-url ${QUEUE} --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages`;
const HAY_AVISO = '^"?[1-9]';
const CRITICAS_ACTIVAS = `inspector2 list-findings --filter-criteria '{"severity":[{"comparison":"EQUALS","value":"CRITICAL"}],"findingStatus":[{"comparison":"EQUALS","value":"ACTIVE"}]}' --query "length(findings)"`;
const ANALIZADOR = 'arn:aws:access-analyzer:us-east-1:123456789012:analyzer/cuenta';
const FILTRO_BASTION = 'aws guardduty create-filter --detector-id $DET --name bastion-esperado --action ARCHIVE --finding-criteria "{\\"Criterion\\":{\\"type\\":{\\"Eq\\":[\\"Recon:EC2/PortProbeUnprotectedPort\\"]},\\"resource.instanceDetails.instanceId\\":{\\"Eq\\":[\\"$BAST\\"]}}}"';

export const a15 = awsWorld({
  id: 'a15',
  index: 15,
  title: 'Seguridad en profundidad',
  subtitle: 'KMS, Secrets Manager, ACM, WAF, GuardDuty, Inspector, Macie y SCP',
  emoji: '🛡️',
  color: '#EF4444',
  level: 'intermedio',
  intro:
    'La seguridad en la nube no es una puerta: son **muchas capas**, y que una falle no debe tumbarlo todo. En esta zona construyes esas capas con las herramientas de AWS: **proteges los datos** con claves de **KMS** (cifrado de sobre, políticas de clave, rotación), **secretos** que se rotan solos con **Secrets Manager** y **certificados** gratuitos con **ACM**; **filtras el tráfico** de la web con **WAF** (reglas gestionadas, límites por tasa) y **Shield**; **detectas** lo que ya ha pasado con **GuardDuty**, **Inspector**, **Macie**, **Access Analyzer** y **Security Hub**; y **limitas el daño** a toda una organización con **SCP**. Todo en tu cuenta simulada, con ataques de verdad: un minero de criptomonedas, una inyección SQL, un bucket que se compartió por error. Terminas con una **auditoría de seguridad** completa.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a15-1', { title: 'KMS: claves y cifrado', summary: 'Quién guarda las claves, quién puede usarlas y cómo se cifra algo grande con un sobre', emoji: '🔑', commands: ['AWS KMS', 'Claves de KMS: administradas y propias', 'Cifrado de sobre (envelope encryption)', 'Política de clave y concesiones (grants)', 'Contexto de cifrado', 'Rotación de claves de KMS', 'Cifrado en reposo y en tránsito', 'aws kms encrypt', 'Cifrado en S3'], minutes: 40 }, [
      learn(
        'Cifrar es fácil; gestionar las claves es lo difícil',
        `
Cifrar un dato es una operación matemática que cualquier librería hace. Lo delicado es **dónde viven las claves y quién puede usarlas**. En AWS eso es **KMS** (*Key Management Service*): guarda las claves en equipos especiales (HSM) y **no las deja salir nunca**. Tú le mandas el dato —o una clave de datos— y KMS cifra o descifra… si quien pregunta tiene permiso.

| Tipo de clave | La crea | ¿Controlas su política? | Coste |
| --- | --- | --- | --- |
| **De propiedad de AWS** | AWS (compartida, invisible) | No | Gratis |
| **Administrada por AWS** (\`aws/s3\`, \`aws/ebs\`…) | AWS, en tu cuenta, la primera vez que usas el servicio | No: solo la ves; cada uso queda en CloudTrail | Gratis (pagas las llamadas) |
| **Administrada por el cliente** (*CMK*) | **Tú** | **Sí**: política, rotación, desactivar o borrar | 1 $/mes + llamadas |

Una clave tiene un **ID**, un **ARN** y, opcionalmente, uno o más **alias** (\`alias/datos-clientes\`): un nombre humano que puedes apuntar a otra clave sin tocar la aplicación. Su **estado** puede ser \`Enabled\`, \`Disabled\` o \`PendingDeletion\` (el borrado tarda entre 7 y 30 días y se puede cancelar).

⚠️ **Borrar una clave es perder para siempre todo lo que cifraste con ella.** Por eso KMS obliga a esperar y recomienda *desactivarla* primero: si algo falla, la reactivas.

**Cifrado de sobre.** \`Encrypt\` solo admite hasta **4 KB**. Para un fichero de gigas se usa un *sobre*: KMS genera una **clave de datos** (\`GenerateDataKey\`), tú cifras el fichero localmente con ella, y guardas el fichero junto a la clave de datos **cifrada** por KMS. Para abrirlo, mandas la clave cifrada a \`Decrypt\`. Así los datos grandes nunca viajan a KMS, y revocar el acceso a la clave basta para dejar el fichero ilegible.
`,
        '🔑',
      ),
      illus('aws-envelope', 'El cifrado de sobre, paso a paso', 'Cifra y descifra un fichero, retira el permiso kms:Decrypt y mira qué se rompe. Con el control de abajo comprueba hasta qué tamaño vale Encrypt directo.'),
      mc('Tienes que cifrar un vídeo de 2 GB con una clave de KMS. ¿Qué haces?', ['Llamas a `Encrypt` con el vídeo entero', 'Pides una clave de datos con `GenerateDataKey`, cifras el vídeo en local con ella y guardas junto a él la clave de datos cifrada', 'Divides el vídeo en trozos de 4 KB y llamas a `Encrypt` 500 000 veces', 'Subes el vídeo a S3 sin cifrar: S3 ya cifra todo'], 1, '`Encrypt` solo admite 4 KB. Con el cifrado de sobre cifras localmente (rápido) y KMS solo protege la pequeña clave de datos. Trocear en 4 KB sería lentísimo y carísimo (se paga por llamada); y el cifrado de S3 es otra capa distinta de la que estás pidiendo.'),
      demo(
        'Cifrar y descifrar con una clave propia',
        [
          ['aws kms list-aliases --query "Aliases[].AliasName"', 'Los alias de la cuenta: están el tuyo y los de las claves administradas por AWS'],
          ['echo -n "clave-de-la-caja-fuerte" > secreto.txt', 'Un dato de ejemplo (sin salto de línea al final)'],
          ['aws kms encrypt --key-id alias/datos-clientes --plaintext fileb://secreto.txt --query CiphertextBlob --output text | base64 --decode > secreto.cifrado', '`fileb://` envía el fichero tal cual; el resultado llega en base64 y lo guardamos en bruto'],
          ['aws kms decrypt --ciphertext-blob fileb://secreto.cifrado --query Plaintext --output text | base64 --decode', '`decrypt` no necesita `--key-id`: el texto cifrado ya dice con qué clave se hizo. Vuelve el original'],
          ['aws kms encrypt --key-id alias/datos-clientes --plaintext "$(echo -n pedido-1234 | base64)" --encryption-context app=tienda --query CiphertextBlob --output text > ctx.txt', 'Ahora con **contexto de cifrado**: un dato extra, no secreto, atado al cifrado'],
          ['aws kms decrypt --ciphertext-blob "$(cat ctx.txt)" --encryption-context app=tienda --query Plaintext --output text', 'Con el mismo contexto se abre (y llega en base64)'],
          ['aws kms decrypt --ciphertext-blob "$(cat ctx.txt)" --encryption-context app=otra', 'Con otro contexto no: nadie puede llevarse el texto cifrado a otra aplicación', 'error'],
          ['aws kms generate-data-key --key-id alias/datos-clientes --key-spec AES_256 --query "[length(Plaintext),length(CiphertextBlob)]" --output text', 'Una clave de datos nueva: una copia en claro (para cifrar ahora) y otra cifrada (para guardar)'],
        ],
        A('sec-kms-s3'),
        'La clave `alias/datos-clientes` ya existe en esta cuenta; en el primer reto la crearás tú.',
      ),
      predict('`Plaintext` llega en base64. ¿Qué verás al descifrar el texto `hola` sin decodificarlo?', 'aws kms encrypt --key-id alias/datos-clientes --plaintext "$(echo -n hola | base64)" --query CiphertextBlob --output text > c.txt && aws kms decrypt --ciphertext-blob "$(cat c.txt)" --query Plaintext --output text', ['hola', 'AccessDeniedException', 'null'], 'La API trabaja con bytes y la CLI los representa en base64: `aG9sYQ==` es `hola`. Para ver el texto hay que decodificar (`| base64 --decode`).', A('sec-kms-s3')),
      practice({
        prompt: 'Empieza por lo básico: la tienda va a guardar datos de clientes y quieres **tu propia clave** (no una administrada por AWS). Crea una clave de KMS con la descripción **`Datos de clientes`**, ponle el alias **`alias/datos-clientes`** y **activa la rotación automática**.',
        goal: 'Clave propia con alias datos-clientes y rotación automática activada',
        setup: A('base'),
        check: all(
          awsIs('kms describe-key --key-id alias/datos-clientes --query "KeyMetadata.[KeyManager,KeyState,Description]"', ['CUSTOMER', 'Enabled', 'Datos de clientes'], 'Falta la clave propia con el alias alias/datos-clientes y la descripción «Datos de clientes»'),
          awsIs('kms get-key-rotation-status --key-id alias/datos-clientes --query KeyRotationEnabled', true, 'Falta activar la rotación automática de la clave'),
        ),
        solution: ['KEY=$(aws kms create-key --description "Datos de clientes" --query KeyMetadata.KeyId --output text)', 'aws kms create-alias --alias-name alias/datos-clientes --target-key-id $KEY', 'aws kms enable-key-rotation --key-id $KEY', 'aws kms get-key-rotation-status --key-id alias/datos-clientes --query KeyRotationEnabled'],
        hints: ['`aws kms create-key --description "…"` devuelve el `KeyId` (usa `--query KeyMetadata.KeyId --output text` para guardarlo en una variable).', 'El alias se crea aparte: `aws kms create-alias --alias-name alias/datos-clientes --target-key-id <id>`. Los alias siempre empiezan por `alias/`.', 'La rotación: `aws kms enable-key-rotation --key-id <id>`. Compruébala con `aws kms get-key-rotation-status`.'],
        explain: 'Una clave administrada por el cliente son tres pasos: **crear** (la clave), **nombrar** (el alias, para que las aplicaciones no dependan del ID) y **cuidar** (la rotación). Rotar cambia el material criptográfico cada año **sin cambiar el ID ni el ARN** y sin recifrar nada: KMS conserva las versiones antiguas para seguir descifrando lo viejo.',
        par: 4,
        commands: ['AWS KMS', 'Claves de KMS: administradas y propias', 'Rotación de claves de KMS'],
      }),
      practice({
        prompt: 'El bucket **`informes-clientes`** cifra sus objetos con claves de S3 (SSE-S3): cualquiera con permiso de lectura los lee. Quieres que **solo pueda abrirlos quien tenga permiso sobre tu clave**. Haz que cifre **por defecto con `alias/datos-clientes`** (SSE-KMS, con **Bucket Key** activada para ahorrar llamadas a KMS) y sube el fichero **`balance.csv`** de tu carpeta.',
        goal: 'informes-clientes cifra por defecto con KMS (Bucket Key) y balance.csv está subido cifrado con la clave',
        setup: A('sec-kms-s3', { files: { '/home/alumno/balance.csv': 'mes,total\nene,1200\nfeb,1350\n' } }),
        check: all(
          awsIs('s3api get-bucket-encryption --bucket informes-clientes --query "ServerSideEncryptionConfiguration.Rules[0].[ApplyServerSideEncryptionByDefault.SSEAlgorithm,BucketKeyEnabled]"', ['aws:kms', true], 'El bucket debería cifrar por defecto con SSE-KMS y tener la Bucket Key activada'),
          awsIs('_check kmsuse --bucket informes-clientes --key balance.csv --query KeyAlias', 'alias/datos-clientes', 'balance.csv no está subido o no está cifrado con la clave alias/datos-clientes'),
        ),
        solution: [`aws s3api put-bucket-encryption --bucket informes-clientes --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"alias/datos-clientes"},"BucketKeyEnabled":true}]}'`, 'aws s3 cp balance.csv s3://informes-clientes/', 'aws s3api head-object --bucket informes-clientes --key balance.csv --query "[ServerSideEncryption,SSEKMSKeyId]"'],
        hints: ['El cifrado por defecto del bucket se cambia con `aws s3api put-bucket-encryption --bucket … --server-side-encryption-configuration \'{"Rules":[…]}\'`.', 'Cada regla lleva `ApplyServerSideEncryptionByDefault` con `SSEAlgorithm` = `aws:kms` y `KMSMasterKeyID` = el alias (o el ARN) de la clave, y `BucketKeyEnabled` = `true` junto a ella.', 'El cifrado por defecto solo afecta a los objetos que se suban **después**: sube `balance.csv` con `aws s3 cp balance.csv s3://informes-clientes/` y mira `head-object` (`ServerSideEncryption` y `SSEKMSKeyId`).'],
        explain: 'Con **SSE-KMS** S3 pide una clave de datos a KMS para cada objeto (o una por bucket si activas **Bucket Key**, que reduce las llamadas hasta un 99 %). La diferencia con SSE-S3 es de **control**: para leer un objeto hace falta `s3:GetObject` **y** `kms:Decrypt` sobre tu clave, y cada lectura queda en CloudTrail. Recuerda: el cifrado por defecto no recifra lo que ya estaba subido.',
        par: 4,
        commands: ['Cifrado en S3', 'Cifrado en reposo y en tránsito', 'AWS KMS'],
      }),
      learn(
        'Quién puede usar la clave: dos llaves',
        `
Con una CMK tienes tres formas de dar acceso, y **KMS no funciona como el resto de AWS**:

1. **La política de la clave** (siempre existe y es obligatoria). Es el control principal.
2. **Las políticas de IAM**, pero **solo si la política de la clave lo permite**: tiene que incluir la sentencia que da \`kms:*\` a la **raíz de la cuenta** (\`"Principal": {"AWS": "arn:aws:iam::123456789012:root"}\`). Eso «delega» en IAM. La política por defecto de una clave creada en la consola o con la CLI ya la lleva.
3. **Las concesiones** (\`create-grant\`): permisos concretos, temporales y revocables para un principal. Las usan los servicios de AWS y las aplicaciones que dan acceso a tiempo limitado.

| La política de la clave… | Un usuario con \`kms:Decrypt\` en IAM… |
| --- | --- |
| delega en IAM (raíz de la cuenta) | **puede** usarla |
| nombra al usuario | puede usarla (aunque no tenga nada en IAM) |
| no delega ni lo nombra | **no puede**, por mucho que IAM se lo permita |

Dos buenas prácticas:

- **Separa administración y uso.** Quien administra la clave (crear, rotar, borrar) no tiene por qué descifrar, y la aplicación que descifra no debe poder borrarla.
- **Mínimo privilegio sobre la clave concreta.** \`kms:Decrypt\` sobre el ARN de **esa** clave, no sobre \`*\`.

Y el candado extra de KMS: **si una política dejaría la clave sin nadie que pueda administrarla, KMS la rechaza** (\`The new key policy will not allow you to update the key policy in the future\`).
`,
        '🗝️',
      ),
      illus('aws-kms-access', '¿Quién puede descifrar?', 'Activa y desactiva la delegación en IAM, el nombre en la política, el permiso de IAM, la concesión y un Deny: verás qué combinaciones dejan pasar a la aplicación.'),
      mc('La aplicación `app-informes` tiene `kms:Decrypt` en su política de IAM, pero la política de la clave solo nombra a un administrador (sin delegar en IAM). Al descifrar recibe…', ['Permitido: IAM es suficiente', '`AccessDeniedException`: la política de la clave no la nombra ni delega en IAM', 'Permitido, pero queda registrado', 'Error de región'], 1, 'KMS exige que **la política de la clave** abra la puerta: o nombrando al principal, o delegando en IAM con la sentencia de la raíz de la cuenta. IAM por sí solo no basta, y esa es la causa nº 1 de `AccessDenied` con claves propias.'),
      practice({
        prompt: 'La aplicación (el usuario **`app-informes`**) lee informes de S3, pero al abrir **`balance.csv`** recibe **AccessDenied**: el objeto está cifrado con tu clave `alias/datos-clientes` y el usuario no tiene permiso sobre ella. Dale **solo** `kms:Decrypt` y **solo sobre esa clave** (no sobre `*`), con una política en línea. No debe poder, por supuesto, programar el borrado de la clave.',
        goal: 'app-informes puede leer balance.csv (kms:Decrypt sobre esa clave) pero no administrar la clave',
        setup: A('sec-kms-app'),
        check: all(
          awsIs(LEE_BALANCE, true, 'app-informes todavía no puede leer balance.csv (¿tiene kms:Decrypt sobre la clave datos-clientes?)'),
          awsIs(BORRA_CLAVE('app-informes', 'alias/datos-clientes'), false, 'La aplicación no debería poder programar el borrado de la clave: solo necesita Decrypt'),
        ),
        solution: ['KARN=$(aws kms describe-key --key-id alias/datos-clientes --query KeyMetadata.Arn --output text)', 'aws iam put-user-policy --user-name app-informes --policy-name leer-clave --policy-document "{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"kms:Decrypt\\",\\"Resource\\":\\"$KARN\\"}]}"', 'aws iam list-user-policies --user-name app-informes --query PolicyNames'],
        hints: ['Necesitas el **ARN** de la clave (no el alias): `aws kms describe-key --key-id alias/datos-clientes --query KeyMetadata.Arn --output text`.', 'Una política en línea se pone con `aws iam put-user-policy --user-name app-informes --policy-name … --policy-document \'{…}\'`: `Effect` Allow, `Action` `kms:Decrypt` y `Resource` el ARN de la clave.', 'Esta clave tiene la política por defecto, que ya delega en IAM, así que el permiso de IAM es suficiente. Comprueba que `s3:GetObject` ya lo tenía (por eso fallaba justo al descifrar).'],
        explain: 'Leer un objeto SSE-KMS exige **dos permisos**: `s3:GetObject` (para S3) y `kms:Decrypt` (para la clave). Aquí faltaba el segundo. Lo correcto es darlo sobre **el ARN de esa clave**, no sobre `*`: si mañana otra clave protege algo más sensible, esta aplicación no podrá tocarla. Y `kms:Decrypt` no incluye administrar: separar uso y administración es la base.',
        par: 5,
        commands: ['Política de clave y concesiones (grants)', 'AWS KMS'],
      }),
      practice({
        prompt: 'La aplicación de pagos (**`app-pagos`**) tiene en IAM `kms:Decrypt` y `kms:GenerateDataKey` sobre todas las claves, pero al pedir una clave de datos a **`alias/pagos`** recibe **AccessDenied**: la política de esa clave solo nombra a un administrador (`alumno`) y no delega en IAM. **Corrige la política de la clave** para que la aplicación pueda cifrar y descifrar con ella **sin darle permisos de administración** (no debe poder programar su borrado) y **sin quitar al administrador `alumno`**.',
        goal: 'app-pagos usa alias/pagos sin poder administrarla, y alumno sigue siendo su administrador',
        setup: A('sec-kms-politica'),
        check: all(
          awsIs(PUEDE('app-pagos', 'kms', 'generate-data-key', { KeyId: 'alias/pagos', KeySpec: 'AES_256' }), true, 'app-pagos todavía no puede generar una clave de datos con alias/pagos'),
          awsIs(BORRA_CLAVE('app-pagos', 'alias/pagos'), false, 'app-pagos no debería poder programar el borrado de la clave'),
          awsIs(PUEDE('alumno', 'kms', 'get-key-policy', { KeyId: 'alias/pagos', PolicyName: 'default' }), true, 'El administrador alumno ha perdido el control de la clave: no puede leer su política'),
        ),
        solution: ['aws kms get-key-policy --key-id alias/pagos --policy-name default --query Policy --output text', POLITICA_PAGOS, 'aws kms put-key-policy --key-id alias/pagos --policy-name default --policy file://politica.json', 'aws kms get-key-policy --key-id alias/pagos --policy-name default --query Policy --output text'],
        hints: ['Lee la política actual con `aws kms get-key-policy --key-id alias/pagos --policy-name default --query Policy --output text` y vuelve a escribirla **entera** con una sentencia más: la política de la clave se sustituye, no se añade.', 'Dos formas válidas: nombrar a `arn:aws:iam::123456789012:user/app-pagos` con las acciones `kms:Encrypt`, `kms:Decrypt` y `kms:GenerateDataKey`, o añadir la sentencia que delega en la raíz de la cuenta (entonces valen sus permisos de IAM). Con la primera no dependes de IAM.', 'Guarda el JSON en un fichero y aplícalo con `aws kms put-key-policy --key-id alias/pagos --policy-name default --policy file://politica.json`. Si te dejas fuera al administrador, KMS rechaza la política.'],
        explain: 'La política de la clave es el **único** control que existe siempre. Aquí no nombraba a la aplicación ni delegaba en IAM, y por eso el permiso de IAM no valía. Nombrar al principal con **solo las acciones de uso** (`Encrypt`, `Decrypt`, `GenerateDataKey`) mantiene la separación: el administrador administra, la aplicación usa. Fíjate también en el seguro de KMS: una política sin ningún administrador posible se rechaza.',
        par: 6,
        commands: ['Política de clave y concesiones (grants)', 'Contexto de cifrado', 'AWS KMS'],
      }),
      learn(
        'Rotar, desactivar y borrar sin perder datos',
        `
Tres operaciones de ciclo de vida que conviene tener claras:

- **Rotación** (\`enable-key-rotation\`): material nuevo cada año (de 90 a 2560 días con \`--rotation-period-in-days\`). **No cambia el ID, el ARN ni el alias**, y lo cifrado antes sigue abriéndose. Es *higiene*, no un remedio: si crees que la clave se ha filtrado, rotar no protege lo ya cifrado con el material antiguo. \`rotate-key-on-demand\` hace una rotación ya.
- **Desactivar** (\`disable-key\`): la clave deja de cifrar y descifrar, pero **se puede reactivar** (\`enable-key\`). Es el interruptor de emergencia y el primer paso antes de borrar.
- **Borrar** (\`schedule-key-deletion --pending-window-in-days 7..30\`): la clave pasa a \`PendingDeletion\` y desaparece al cumplirse el plazo. Hasta entonces se puede cancelar (\`cancel-key-deletion\`, queda desactivada). Después, **todo lo que cifraste con ella es irrecuperable**.

Cuidado con las **cuotas de cifrado por llamada**: KMS limita las peticiones por segundo; el cifrado de sobre y la *Bucket Key* de S3 existen en parte para no ahogar a KMS con millones de llamadas pequeñas.

Y una última idea: **cifrar en reposo no sustituye al control de acceso**. Un usuario con permiso de lectura y de la clave ve el dato en claro. El cifrado protege del robo del disco o de una copia, no de un permiso mal dado.
`,
        '⏳',
      ),
      tf('«Si rotas una clave de KMS, tienes que volver a cifrar todo lo que ya estaba cifrado con ella.»', false, 'No: KMS conserva todas las versiones del material y descifra con la que corresponda; el ID y el ARN no cambian. Solo lo nuevo se cifra con el material nuevo.'),
      multi('¿Qué afirmaciones sobre borrar una clave de KMS son ciertas? (elige todas las correctas)', ['Hay un plazo de espera de 7 a 30 días en el que se puede cancelar', 'Una clave desactivada se puede volver a activar', 'Tras el plazo, los datos cifrados con ella se pueden recuperar con un ticket a soporte', 'Es buena práctica desactivarla primero y ver si algo falla'], [0, 1, 3], 'La espera y la opción de cancelar existen precisamente porque el borrado es irreversible: **ni AWS puede recuperar** una clave borrada. Por eso se desactiva antes y se observa qué deja de funcionar.'),
      match(
        'Une cada situación con la herramienta de KMS',
        [
          ['Cifrar un fichero de varios GB', 'Cifrado de sobre con GenerateDataKey'],
          ['Que un texto cifrado solo se abra «en su sitio»', 'Contexto de cifrado'],
          ['Dar acceso temporal y revocable a una aplicación', 'Concesión (grant)'],
          ['Cambiar el material criptográfico cada año', 'Rotación automática'],
        ],
        'El sobre resuelve el tamaño, el contexto ata el cifrado a su uso, la concesión da permisos temporales y la rotación renueva el material sin tocar nada más.',
      ),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a15-2', { title: 'Secretos y certificados', summary: 'Contraseñas que se rotan solas con Secrets Manager y HTTPS gratis con ACM', emoji: '🔐', commands: ['AWS Secrets Manager', 'Rotación de secretos', 'Secrets Manager frente a Parameter Store', 'aws secretsmanager rotate-secret', 'AWS Certificate Manager (ACM)', 'Validación de dominio en ACM'], minutes: 38 }, [
      learn(
        'Los secretos no viven en el código',
        `
Una contraseña de base de datos escrita en el código, en una variable de entorno de Lambda o en un fichero de configuración acaba **en un repositorio, en un registro o en una captura de pantalla**. La regla es otra: la aplicación **pide el secreto en tiempo de ejecución** a un almacén que lo guarda cifrado, controla quién lo lee y deja rastro.

**AWS Secrets Manager** guarda secretos (hasta 64 KB) cifrados con una clave de KMS, con:

- **Versiones y etapas**: cada valor es una *versión*; la etiqueta \`AWSCURRENT\` marca la que se usa y \`AWSPREVIOUS\` la anterior. Una aplicación pide \`AWSCURRENT\` y no se entera de que ha cambiado.
- **Rotación automática**: Secrets Manager invoca una **función Lambda** en cuatro pasos —\`createSecret\` (genera la nueva en \`AWSPENDING\`), \`setSecret\` (la cambia en la base de datos), \`testSecret\` (comprueba que funciona) y \`finishSecret\` (mueve \`AWSCURRENT\`)—. Si algo falla, el secreto sigue con la versión buena.
- **Permisos**: IAM (\`secretsmanager:GetSecretValue\`), política de recurso (por ejemplo, entre cuentas) y el permiso de la clave KMS.
- **Borrado con red**: \`delete-secret\` deja el secreto en cuenta atrás de 7 a 30 días (\`restore-secret\` lo recupera). Solo \`--force-delete-without-recovery\` lo borra ya.

| | Secrets Manager | Parameter Store (\`SecureString\`) |
| --- | --- | --- |
| Rotación automática | **Sí** | No |
| Entre cuentas / réplica en otra región | Sí | Limitado |
| Coste | ≈ 0,40 $ por secreto y mes | Gratis (estándar) |

**Regla práctica:** si tiene que *rotar* o compartirse entre cuentas, Secrets Manager; si es configuración o un valor que casi no cambia, Parameter Store.
`,
        '🔐',
      ),
      mc('Tu función Lambda necesita la contraseña de la base de datos. ¿Cuál es la opción más segura y mantenible?', ['Escribirla en una variable de entorno de la función', 'Guardarla en Secrets Manager y que la función la pida al arrancar (con el permiso `GetSecretValue` en su rol)', 'Incluirla en el código del repositorio privado', 'Guardarla en un parámetro de Parameter Store de tipo `String` (sin cifrar)'], 1, 'Un secreto en Secrets Manager se cifra con KMS, se puede rotar sin tocar el código y cada lectura queda en CloudTrail. Variables de entorno y código acaban en repositorios y registros; un parámetro `String` está en claro.'),
      demo(
        'Versiones y etapas de un secreto',
        [
          [`aws secretsmanager create-secret --name tienda/db --secret-string '{"username":"app","password":"Inicial-1"}' --query Name --output text`, 'Crea el secreto (la primera versión es `AWSCURRENT`)'],
          ['aws secretsmanager get-secret-value --secret-id tienda/db --query SecretString --output text', 'La aplicación lo lee por su nombre'],
          [`aws secretsmanager put-secret-value --secret-id tienda/db --secret-string '{"username":"app","password":"Nueva-2"}' --query VersionStages --output text`, 'Una versión nueva pasa a `AWSCURRENT`…'],
          ["aws secretsmanager describe-secret --secret-id tienda/db --query 'VersionIdsToStages.*' --output text", '…y la anterior queda como `AWSPREVIOUS`'],
          ['aws secretsmanager get-secret-value --secret-id tienda/db --version-stage AWSPREVIOUS --query SecretString --output text', 'Se puede leer la anterior (útil para volver atrás)'],
          ['aws secretsmanager delete-secret --secret-id tienda/db --recovery-window-in-days 7 --query "DeletionDate!=null"', 'Borrarlo lo deja en cuenta atrás: fecha de borrado programada'],
          ['aws secretsmanager get-secret-value --secret-id tienda/db', 'Mientras está en cuenta atrás no se puede leer', 'error'],
          ['aws secretsmanager restore-secret --secret-id tienda/db --query Name --output text', 'Se recupera con `restore-secret`'],
        ],
        A('base'),
        'En la vida real, la contraseña nueva se cambia a la vez en la base de datos; aquí solo ves cómo se guardan las versiones.',
      ),
      predict('Guardas una contraseña y luego otra con `put-secret-value`. ¿Qué devuelve leer la etapa `AWSPREVIOUS`?', `aws secretsmanager create-secret --name tienda/db --secret-string 'vieja-1' > /dev/null && aws secretsmanager put-secret-value --secret-id tienda/db --secret-string 'nueva-2' > /dev/null && aws secretsmanager get-secret-value --secret-id tienda/db --version-stage AWSPREVIOUS --query SecretString --output text`, ['nueva-2', 'null', 'ResourceNotFoundException'], 'Cada `put-secret-value` mueve `AWSCURRENT` a la versión nueva y deja la anterior como `AWSPREVIOUS`: por eso se puede volver atrás si la contraseña nueva falla.', A('base')),
      practice({
        prompt: 'La tienda necesita guardar la contraseña de su base de datos y **cambiarla sola cada 30 días**. La función de rotación **`rotar-db`** ya está desplegada. Crea el secreto **`tienda/db`** con el valor `{"username":"app","password":"Inicial-1"}`, deja que Secrets Manager pueda invocar la función y **configura la rotación automática cada 30 días**. Al configurarla se hace una primera rotación: comprueba que la contraseña ya **no** es `Inicial-1`.',
        goal: 'Secreto tienda/db con rotación cada 30 días, ya rotado una vez',
        setup: A('sec-secreto'),
        check: all(
          awsIs('secretsmanager describe-secret --secret-id tienda/db --query "[RotationEnabled,RotationRules.AutomaticallyAfterDays,LastRotatedDate!=null]"', [true, 30, true], 'Falta el secreto tienda/db con la rotación activada cada 30 días (y que ya se haya rotado una vez)'),
          awsHas('secretsmanager describe-secret --secret-id tienda/db --query RotationLambdaARN', 'function:rotar-db', 'La rotación debe usar la función rotar-db'),
          awsMatches('secretsmanager get-secret-value --secret-id tienda/db --query SecretString', '^(?!.*Inicial-1).*password', 'La contraseña sigue siendo la inicial: la primera rotación no se ha completado'),
        ),
        solution: [`aws secretsmanager create-secret --name tienda/db --secret-string '{"username":"app","password":"Inicial-1"}'`, 'aws lambda add-permission --function-name rotar-db --statement-id secretsmanager --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com', 'aws secretsmanager rotate-secret --secret-id tienda/db --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:rotar-db --rotation-rules AutomaticallyAfterDays=30', 'aws secretsmanager describe-secret --secret-id tienda/db --query "[RotationEnabled,RotationRules.AutomaticallyAfterDays]"', 'aws secretsmanager get-secret-value --secret-id tienda/db --query SecretString'],
        hints: ['Crea el secreto con `aws secretsmanager create-secret --name tienda/db --secret-string \'{"username":"app","password":"Inicial-1"}\'`.', 'La rotación se configura con `aws secretsmanager rotate-secret --secret-id … --rotation-lambda-arn <arn de rotar-db> --rotation-rules AutomaticallyAfterDays=30`. Si da error de permisos, falta dejar que `secretsmanager.amazonaws.com` invoque la función: `aws lambda add-permission --function-name rotar-db --statement-id secretsmanager --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com`.', 'El ARN de la función: `arn:aws:lambda:us-east-1:123456789012:function:rotar-db` (o `aws lambda get-function --function-name rotar-db`). Al terminar mira `describe-secret` (`RotationEnabled`, `LastRotatedDate`) y `get-secret-value`.'],
        explain: 'Hacen falta **tres piezas**: el secreto, la función que sabe cambiar la contraseña (`rotar-db`) y el permiso para que Secrets Manager la invoque. Al configurar la rotación se ejecutan los cuatro pasos (`createSecret`, `setSecret`, `testSecret`, `finishSecret`) y `AWSCURRENT` apunta a la contraseña nueva. Recuerda que **la aplicación debe leer el secreto al arrancar o con una caché corta**: si copió la contraseña antigua, tras rotar dejará de conectar.',
        par: 5,
        commands: ['aws secretsmanager rotate-secret', 'Rotación de secretos', 'AWS Secrets Manager'],
      }),
      practice({
        prompt: 'Alguien ha ejecutado `delete-secret` sobre **`tienda/db`** «para limpiar» y la tienda ha dejado de poder conectar a la base de datos. El secreto tiene programado el borrado dentro de 7 días. **Recupéralo** sin perder su valor y comprueba que ya se puede leer.',
        goal: 'El secreto tienda/db está recuperado, sin borrado programado y con su valor',
        setup: A('sec-secreto-borrado'),
        check: all(
          awsIs('secretsmanager describe-secret --secret-id tienda/db --query "DeletedDate!=null"', false, 'El secreto sigue con el borrado programado: restáuralo'),
          awsHas('secretsmanager get-secret-value --secret-id tienda/db --query SecretString', 'Tienda-2024!', 'El secreto debería conservar su valor original'),
        ),
        solution: ['aws secretsmanager describe-secret --secret-id tienda/db --query "[Name,DeletedDate]"', 'aws secretsmanager restore-secret --secret-id tienda/db', 'aws secretsmanager get-secret-value --secret-id tienda/db --query SecretString --output text'],
        hints: ['`aws secretsmanager describe-secret --secret-id tienda/db` muestra `DeletedDate` mientras esté en cuenta atrás.', 'Existe un comando justo para esto: `aws secretsmanager restore-secret --secret-id tienda/db`.', 'Después lee el valor con `aws secretsmanager get-secret-value --secret-id tienda/db --query SecretString --output text`: mientras estaba en cuenta atrás daba error.'],
        explain: 'Por eso `delete-secret` **no borra al momento**: da entre 7 y 30 días para arrepentirse. Mientras dura, el secreto no se puede leer ni rotar, así que la aplicación falla; `restore-secret` lo deja como estaba. Solo `--force-delete-without-recovery` borra ya: úsalo con mucha prudencia, y limita quién puede hacerlo con una política (`secretsmanager:DeleteSecret`).',
        par: 3,
        commands: ['AWS Secrets Manager'],
      }),
      learn(
        'HTTPS gratis con ACM',
        `
Un **certificado TLS** hace dos cosas: demuestra al navegador que habla con **tu** dominio y cifra la conexión (el candado de HTTPS). **AWS Certificate Manager** (ACM) emite certificados públicos **gratuitos**, los **renueva solos** y los instala en el **ALB**, **CloudFront** o **API Gateway**. La clave privada nunca sale de AWS (por eso no puedes descargar el certificado para ponerlo en una EC2).

El proceso, en cuatro pasos:

1. **Solicitar**: \`aws acm request-certificate --domain-name tienda.es --subject-alternative-names "*.tienda.es" --validation-method DNS\`.
2. **Validar** que el dominio es tuyo: ACM te da un registro **CNAME** que publicas en Route 53. Un solo registro vale para el dominio, su comodín y todas las renovaciones. El estado pasa de \`PENDING_VALIDATION\` a \`ISSUED\`.
3. **Asociar** el certificado a un **oyente HTTPS** (puerto 443) del balanceador.
4. **Comprobar** con \`curl https://…\`.

Detalles que muerden:

- El certificado es **regional**: para un ALB, en la misma región; para CloudFront, en **us-east-1**.
- El comodín \`*.tienda.es\` cubre **un nivel** (\`www.tienda.es\`) y **no** el dominio desnudo \`tienda.es\`: pide los dos nombres.
- **No borres el CNAME de validación**: sin él no se renueva y en ~13 meses el sitio caduca.
- Un ALB puede tener **varios certificados** en el mismo oyente (SNI): según el nombre que pide el navegador, elige el que coincide.
- Para no dejar HTTP sin proteger, el oyente del 80 suele **redirigir a HTTPS** (acción \`redirect\` con código 301).
`,
        '📜',
      ),
      mc('Tienes un certificado de ACM solo para `*.tienda.es`. ¿Para cuál de estos nombres da un error de certificado?', ['`www.tienda.es`', '`api.tienda.es`', '`tienda.es`', '`blog.tienda.es`'], 2, 'El comodín cubre un único nivel por debajo del dominio; el dominio desnudo (`tienda.es`) no entra. Por eso se piden **los dos nombres** en el mismo certificado.'),
      demo(
        'Pedir un certificado y ver qué falta',
        [
          ['aws acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS --query CertificateArn --output text > cert.txt', 'Un certificado para el dominio y su comodín, validado por DNS'],
          ['aws acm describe-certificate --certificate-arn "$(cat cert.txt)" --query Certificate.Status --output text', 'Pendiente: aún no hemos demostrado que el dominio es nuestro'],
          ['aws acm describe-certificate --certificate-arn "$(cat cert.txt)" --query "Certificate.DomainValidationOptions[0].ResourceRecord.[Type,Name]" --output text', 'El registro CNAME que hay que crear en la zona'],
          ['curl -sS http://www.tienda.test/ -o /dev/null -w "%{http_code}\\n"', 'Por HTTP la tienda funciona (200)…'],
          ['curl -sS https://www.tienda.test/', '…pero por HTTPS no hay ningún oyente en el 443', 'error'],
        ],
        A('sec-acm'),
        'La tienda ya tiene un balanceador y la zona `tienda.test` con `www` apuntando a él. Falta todo lo de HTTPS.',
      ),
      practice({
        prompt: 'La tienda solo funciona por HTTP. Pon **HTTPS** en el balanceador **`tienda-alb`**: pide un certificado de ACM para **`tienda.test`** y **`*.tienda.test`** (validación **DNS**), publica el **CNAME de validación** en la zona `tienda.test` de Route 53 y crea un **oyente HTTPS en el puerto 443** que reenvíe al grupo de destino **`web-tg`** con ese certificado. Tanto `https://tienda.test/` como `https://www.tienda.test/` deben responder 200.',
        goal: 'HTTPS en el balanceador con un certificado ISSUED que cubre tienda.test y *.tienda.test',
        setup: A('sec-acm'),
        check: all(
          awsIs('_check http --url https://www.tienda.test/ --query Status', 200, 'https://www.tienda.test/ no responde 200 (¿certificado emitido, oyente 443 y grupo de destino web-tg?)'),
          awsIs('_check http --url https://tienda.test/ --query Status', 200, 'https://tienda.test/ no responde 200: el certificado debe cubrir también el dominio sin www'),
        ),
        solution: [
          'CERT=$(aws acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS --query CertificateArn --output text)',
          'ZONA=$(aws route53 list-hosted-zones-by-name --dns-name tienda.test --query "HostedZones[0].Id" --output text)',
          'N=$(aws acm describe-certificate --certificate-arn $CERT --query Certificate.DomainValidationOptions[0].ResourceRecord.Name --output text)',
          'V=$(aws acm describe-certificate --certificate-arn $CERT --query Certificate.DomainValidationOptions[0].ResourceRecord.Value --output text)',
          'aws route53 change-resource-record-sets --hosted-zone-id $ZONA --change-batch "{\\"Changes\\":[{\\"Action\\":\\"UPSERT\\",\\"ResourceRecordSet\\":{\\"Name\\":\\"$N\\",\\"Type\\":\\"CNAME\\",\\"TTL\\":300,\\"ResourceRecords\\":[{\\"Value\\":\\"$V\\"}]}}]}"',
          'aws acm wait certificate-validated --certificate-arn $CERT',
          'LB=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)',
          'TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)',
          'aws elbv2 create-listener --load-balancer-arn $LB --protocol HTTPS --port 443 --certificates CertificateArn=$CERT --default-actions Type=forward,TargetGroupArn=$TG',
          'curl -sS https://www.tienda.test/ -o /dev/null -w "%{http_code}\\n"',
        ],
        hints: ['Primero el certificado: `aws acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS`. `describe-certificate` te da, en `DomainValidationOptions[0].ResourceRecord`, el `Name` y el `Value` del CNAME que ACM espera.', 'El id de la zona sale de `aws route53 list-hosted-zones-by-name --dns-name tienda.test`. Crea el CNAME con `aws route53 change-resource-record-sets --hosted-zone-id … --change-batch \'{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":…,"Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":…}]}}]}\'` y espera con `aws acm wait certificate-validated --certificate-arn …` a que pase a ISSUED.', 'El oyente: `aws elbv2 create-listener --load-balancer-arn <alb> --protocol HTTPS --port 443 --certificates CertificateArn=<cert> --default-actions Type=forward,TargetGroupArn=<web-tg>`. Los ARN salen de `describe-load-balancers` y `describe-target-groups`. Prueba con `curl -sS https://www.tienda.test/`.'],
        explain: 'ACM no emite nada hasta que **demuestras que el dominio es tuyo**: el CNAME de validación. En cuanto existe, el certificado pasa a `ISSUED` y ya se puede usar en el oyente. Antes de eso, `create-listener` falla (*only ISSUED certificates can be used*). El 443 estaba abierto en el grupo de seguridad del balanceador; si no, el oyente existiría pero nadie podría llegar.',
        par: 8,
        commands: ['AWS Certificate Manager (ACM)', 'Validación de dominio en ACM', 'Cifrado en reposo y en tránsito'],
      }),
      practice({
        prompt: 'La tienda ya sirve HTTPS, pero **`https://www.tienda.test/`** da un **error de certificado** (curl: «no alternative certificate subject name matches»), mientras que `https://tienda.test/` funciona. El certificado instalado solo cubre `tienda.test`. **Arréglalo sin quitar el certificado que ya está**: pide uno que cubra también el comodín `*.tienda.test` y añádelo al oyente del 443 del balanceador.',
        goal: 'www.tienda.test y tienda.test responden 200 por HTTPS',
        setup: A('sec-acm-nombre'),
        check: all(
          awsIs('_check http --url https://www.tienda.test/ --query Status', 200, 'https://www.tienda.test/ sigue dando error de certificado'),
          awsIs('_check http --url https://tienda.test/ --query Status', 200, 'https://tienda.test/ dejó de funcionar: el certificado nuevo debe cubrir también el dominio sin www'),
        ),
        solution: [
          'NUEVO=$(aws acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS --query CertificateArn --output text)',
          'aws acm wait certificate-validated --certificate-arn $NUEVO',
          "LB=$(aws elbv2 describe-load-balancers --names tienda-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)",
          "L=$(aws elbv2 describe-listeners --load-balancer-arn $LB --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text)",
          'aws elbv2 add-listener-certificates --listener-arn $L --certificates CertificateArn=$NUEVO',
          "aws elbv2 describe-listener-certificates --listener-arn $L --query 'Certificates[].[CertificateArn,IsDefault]' --output text",
          'curl -sS https://www.tienda.test/ -o /dev/null -w "%{http_code}\\n"',
        ],
        hints: ['El certificado actual cubre solo el dominio desnudo. Pide uno nuevo con `--domain-name tienda.test --subject-alternative-names "*.tienda.test"`. Como el CNAME de validación de `tienda.test` **ya existe** en la zona, ACM lo reconoce y lo emite enseguida (`aws acm wait certificate-validated`).', 'Un oyente admite varios certificados (SNI): `aws elbv2 add-listener-certificates --listener-arn <oyente 443> --certificates CertificateArn=<nuevo>`. El ARN del oyente: `aws elbv2 describe-listeners --load-balancer-arn <alb>`.', 'También valdría cambiar el certificado por defecto con `modify-listener --certificates`, pero con `add-listener-certificates` no tocas lo que ya funciona. Comprueba con `curl -sS https://www.tienda.test/`.'],
        explain: 'Cuando el nombre que pide el navegador no coincide con ninguno del certificado, TLS falla **antes** de que el balanceador mire nada. Un certificado con **el dominio y su comodín** es lo habitual. El ALB elige el certificado según el nombre solicitado (**SNI**), así que puedes añadir el nuevo sin quitar el viejo y sin cortar el servicio. Y como el CNAME de validación es el mismo para el mismo dominio, no tuviste que crear ningún registro nuevo.',
        par: 5,
        commands: ['AWS Certificate Manager (ACM)', 'Validación de dominio en ACM'],
      }),
      order('Ordena los pasos para publicar un sitio por HTTPS con ACM', ['solicitar', 'validar', 'emitir', 'asociar'], 'solicitar validar emitir asociar', 'Pides el certificado (**solicitar**), publicas el CNAME para demostrar que el dominio es tuyo (**validar**), ACM lo da por bueno (**emitir**) y lo pones en el oyente HTTPS del balanceador (**asociar**).'),
      match(
        'Une cada necesidad con el servicio',
        [
          ['Contraseña de base de datos que cambia cada 30 días', 'Secrets Manager'],
          ['URL de configuración por entorno, gratis', 'Parameter Store'],
          ['Certificado TLS gratuito con renovación automática', 'ACM'],
          ['Controlar quién puede descifrar los datos', 'KMS'],
        ],
        'Cada servicio resuelve una parte: KMS controla las claves, Secrets Manager y Parameter Store guardan valores cifrados (el primero rota), y ACM da los certificados para cifrar el tráfico.',
      ),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a15-3', { title: 'WAF y Shield: filtrar el tráfico', summary: 'Reglas por ruta, grupos gestionados, límites por tasa y protección contra DDoS', emoji: '🧱', commands: ['AWS WAF', 'Reglas de WAF: prioridad y acciones', 'Grupos de reglas gestionados de WAF', 'Reglas por tasa de WAF', 'aws wafv2 create-web-acl', 'AWS Shield'], minutes: 42 }, [
      learn(
        'WAF: un portero que lee la petición',
        `
Los **grupos de seguridad** y las **NACL** miran IP y puerto (capas 3 y 4): no saben si lo que llega al puerto 443 es un cliente o un intento de inyección SQL. **AWS WAF** trabaja en la **capa 7** (HTTP): ve la ruta, los parámetros, las cabeceras, el cuerpo, el país de origen… y puede cortar la petición **antes de que llegue a tu servidor**. Se asocia a un **ALB**, una distribución de **CloudFront**, **API Gateway**, Cognito o AppSync.

Piezas:

- **ACL web**: el conjunto de reglas asociado al recurso. Tiene una **acción por defecto** (\`Allow\` o \`Block\`) para lo que no cumple ninguna regla.
- **Regla**: una **condición** (cadena en la URL, conjunto de IP, país, regex, tasa de peticiones…) y una **acción**: \`Allow\`, \`Block\`, \`Count\` (cuenta y sigue), \`CAPTCHA\`, \`Challenge\`. Se combinan con \`And\`, \`Or\` y \`Not\`.
- **Prioridad**: las reglas se evalúan de menor a mayor número. **\`Allow\` y \`Block\` terminan** la evaluación; \`Count\` no. Si ninguna termina, manda la acción por defecto.
- **Transformaciones** (\`LOWERCASE\`, \`URL_DECODE\`…): preparan el texto antes de comparar, para que \`/ADMIN\` o \`%27\` no esquiven la regla.
- **Capacidad (WCU)**: cada regla «pesa» y una ACL admite hasta 5000.
- **Métricas** en CloudWatch (\`AWS/WAFV2\`), **muestras** de peticiones y **registros** completos (a CloudWatch Logs, S3 o Firehose; el nombre empieza por \`aws-waf-logs-\`).

⚠️ **Una ACL se sustituye entera**: \`update-web-acl\` necesita el \`LockToken\` que da \`get-web-acl\` y lo que no envíes **desaparece**. Y WAF **reduce** el riesgo; no sustituye a arreglar la vulnerabilidad.
`,
        '🧱',
      ),
      illus('aws-waf-rules', 'Cómo decide una ACL', 'Elige una petición, cambia el orden de las reglas, sus acciones y la acción por defecto: observa qué regla termina la evaluación y cuáles ni se llegan a mirar.'),
      mc('Una ACL tiene la regla de prioridad 0 «Bloquear /admin» y la de prioridad 1 «Permitir la IP de la oficina». Ana abre `/admin` desde la oficina. ¿Qué pasa?', ['Pasa: la regla de la oficina es más específica', 'Recibe un 403: la regla de prioridad 0 bloquea y termina la evaluación; la de la oficina ni se mira', 'Se cuenta pero pasa', 'Depende de la acción por defecto'], 1, 'Las reglas se evalúan por prioridad y `Block` termina la evaluación. Para que la oficina pase, su `Allow` debe tener una prioridad **menor** (se evalúa antes), o el bloqueo debe incluir «y no viene de la oficina».'),
      demo(
        'Una ACL con una regla, de principio a fin',
        [
          ['aws wafv2 list-available-managed-rule-groups --scope REGIONAL --query "ManagedRuleGroups[].Name" --output text', 'Los grupos de reglas que AWS mantiene por ti'],
          [DNS_ALB, 'El nombre del balanceador de la tienda'],
          [CODIGO('/admin/usuarios'), 'Sin WAF la petición llega al servidor (que responde 404: no tiene esa página)'],
          [REGLA_ADMIN, 'Una regla: si la ruta empieza por /admin, bloquear'],
          ['aws wafv2 check-capacity --scope REGIONAL --rules file://reglas.json --query Capacity', 'Cuánta capacidad (WCU) consumiría: una comparación de texto cuesta poco'],
          ['aws wafv2 create-web-acl --name tienda-waf --scope REGIONAL --default-action Allow={} --rules file://reglas.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tienda-waf --query Summary.Name --output text', 'La ACL: lo que no cumple ninguna regla pasa (Allow por defecto)'],
          ['aws wafv2 associate-web-acl --web-acl-arn $(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].ARN" --output text) --resource-arn $(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)', 'Una ACL no hace nada hasta que se asocia a un recurso'],
          [CODIGO('/admin/usuarios'), 'Ahora WAF responde 403 antes de llegar a ningún servidor'],
          [CODIGO('/'), 'La portada sigue pasando'],
          ['aws wafv2 delete-web-acl --name tienda-waf --scope REGIONAL --id $(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].Id" --output text) --lock-token $(aws wafv2 get-web-acl --name tienda-waf --scope REGIONAL --id $(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].Id" --output text) --query LockToken --output text)', 'No se puede borrar una ACL que sigue asociada', 'error'],
        ],
        A('sec-waf'),
        'El balanceador `tienda-alb` ya tiene dos servidores detrás y ninguna ACL.',
      ),
      practice({
        prompt: 'La zona de administración de la tienda (**`/admin`**) está abierta a todo internet. Protégela: crea un **conjunto de IP `oficina`** con el rango **`203.0.113.0/24`**, una **ACL web `tienda-acl`** (regional, acción por defecto **Allow**) con una regla que **bloquee las rutas que empiecen por `/admin` salvo si la petición viene de la oficina**, y **asóciala** al balanceador `tienda-alb`. La portada tiene que seguir pasando para todos.',
        goal: '/admin solo accesible desde la oficina; el resto del sitio, abierto',
        setup: A('sec-waf'),
        check: all(
          awsIs(HTTP('/', '--query Status'), 200, 'La portada debería seguir respondiendo 200 para todos'),
          awsIs(HTTP('/admin', '--from-ip 192.0.2.10 --query Status'), 403, 'Desde fuera de la oficina, /admin debería recibir un 403 de WAF (¿ACL asociada al balanceador?)'),
          awsIs(HTTP('/ADMIN/usuarios', '--from-ip 192.0.2.10 --query Status'), 403, '/ADMIN con mayúsculas se cuela: usa una transformación LOWERCASE (y la cadena en minúsculas)'),
          awsMatches(HTTP('/admin', '--from-ip 203.0.113.25 --query Status'), NO_403, 'Desde la oficina (203.0.113.25) /admin debería llegar al servidor, no recibir un 403'),
        ),
        solution: [
          'IPS=$(aws wafv2 create-ip-set --name oficina --scope REGIONAL --ip-address-version IPV4 --addresses 203.0.113.0/24 --query Summary.ARN --output text)',
          ADMIN_OFICINA,
          'aws wafv2 create-web-acl --name tienda-acl --scope REGIONAL --default-action Allow={} --rules file://reglas.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tienda-acl',
          'ACL=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].ARN" --output text)',
          'LB=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)',
          'aws wafv2 associate-web-acl --web-acl-arn $ACL --resource-arn $LB',
          'aws wafv2 get-web-acl-for-resource --resource-arn $LB --query WebACL.Name --output text',
        ],
        hints: ['Primero el conjunto de IP: `aws wafv2 create-ip-set --name oficina --scope REGIONAL --ip-address-version IPV4 --addresses 203.0.113.0/24` (te da el ARN en `Summary.ARN`).', 'La regla combina dos condiciones con `AndStatement`: un `ByteMatchStatement` (`SearchString` `/admin`, `FieldToMatch` `UriPath`, `PositionalConstraint` `STARTS_WITH`) **y** un `NotStatement` que envuelve un `IPSetReferenceStatement` con el ARN del conjunto. La acción es `Block`. Con la transformación `LOWERCASE`, también cazas `/ADMIN`.', 'Guarda las reglas en un archivo JSON y usa `aws wafv2 create-web-acl --name tienda-acl --scope REGIONAL --default-action Allow={} --rules file://reglas.json --visibility-config …`. Después `aws wafv2 associate-web-acl --web-acl-arn … --resource-arn <ARN del balanceador>`.'],
        explain: 'Para dejar entrar a la oficina hay dos diseños válidos: un `Allow` de prioridad baja para sus IP **antes** del `Block`, o —el de este reto— un solo `Block` con la condición «ruta /admin **y no** viene de la oficina». Fíjate en la transformación `LOWERCASE`: sin ella, `/ADMIN` esquivaría la regla (y la cadena que buscas debe ir en minúsculas, porque la transformación se aplica a la petición, no a tu texto). Y recuerda que la ACL **no actúa hasta asociarla**.',
        par: 8,
        commands: ['AWS WAF', 'Reglas de WAF: prioridad y acciones', 'aws wafv2 create-web-acl'],
      }),
      tf('«Si el grupo de seguridad del balanceador solo permite los puertos 80 y 443, ya no hace falta WAF.»', false, 'Los grupos de seguridad no distinguen una petición legítima al 443 de una con inyección SQL: las dos entran por el mismo puerto. WAF inspecciona el contenido HTTP; son capas distintas y se complementan.'),
      learn(
        'Grupos gestionados, falsos positivos y límites por tasa',
        `
Escribir a mano las reglas contra la inyección SQL, el XSS o los exploits conocidos es un trabajo sin fin. AWS mantiene **grupos de reglas gestionados** (gratuitos con WAF, salvo los de bots o fraude):

| Grupo | Para qué |
| --- | --- |
| \`AWSManagedRulesCommonRuleSet\` | Vulnerabilidades comunes: XSS, lectura de ficheros, cuerpos enormes… |
| \`AWSManagedRulesSQLiRuleSet\` | Inyección SQL |
| \`AWSManagedRulesKnownBadInputsRuleSet\` | Exploits conocidos (Log4j…) |
| \`AWSManagedRulesAmazonIpReputationList\` | IP que Amazon ha visto atacando |

Se usan con \`ManagedRuleGroupStatement\` y **\`OverrideAction\`** (no \`Action\`): \`{"None":{}}\` deja que el grupo actúe con sus propias acciones; \`{"Count":{}}\` es el **modo prueba** (cuenta todo lo que detectaría, sin bloquear).

**Flujo prudente:** primero \`Count\` + registros, mirar los **falsos positivos**, y solo entonces pasar a \`None\` (bloquear). Cuando una regla suelta del grupo bloquea tráfico legítimo (típico: \`SizeRestrictions_BODY\` con subidas de más de 8 KB), la solución **no** es quitar el grupo, sino \`RuleActionOverrides\`: cambiar **esa regla** a \`Count\` y dejar el resto protegiendo.

**Reglas por tasa** (\`RateBasedStatement\`): cuentan las peticiones de cada IP en una ventana (1, 2, 5 o 10 minutos) y bloquean a quien se pase de \`Limit\` (mínimo 10), hasta que baje. Con un \`ScopeDownStatement\` (por ejemplo, solo \`/login\`) el resto del sitio no se cuenta. Son la defensa clásica contra la **fuerza bruta**. Detrás de CloudFront, la IP que ve el ALB es la de CloudFront: agrega por \`FORWARDED_IP\` o pon la ACL en CloudFront.
`,
        '🚦',
      ),
      practice({
        prompt: 'La tienda recibe inyecciones SQL en el buscador y ataques de scripts (XSS). La ACL **`tienda-waf`** ya está asociada a `tienda-alb`, pero **no tiene reglas**. Añade los grupos gestionados de AWS **`AWSManagedRulesCommonRuleSet`** y **`AWSManagedRulesSQLiRuleSet`** (que bloqueen con sus acciones propias). Cuidado: los clientes suben informes de **más de 8 KB** por POST a `/subir` y **no deben bloquearse**: sin quitar el grupo Common, deja la regla que lo bloquea (`SizeRestrictions_BODY`) en **Count**.',
        goal: 'SQLi y XSS bloqueados, las subidas grandes siguen funcionando y la portada también',
        setup: A('sec-waf-grupos'),
        check: all(
          awsIs(HTTP(SQLI, '--query Status'), 403, 'La inyección SQL no se bloquea: añade el grupo AWSManagedRulesSQLiRuleSet con OverrideAction None'),
          awsIs(HTTP('/?q=<script>alert(1)</script>', '--query Status'), 403, 'El XSS no se bloquea: añade el grupo AWSManagedRulesCommonRuleSet'),
          awsMatches(HTTP('/subir', `--method POST --body ${'a'.repeat(9000)} --query Status`), NO_403, 'Las subidas de más de 8 KB están bloqueadas: pon la regla SizeRestrictions_BODY en Count con RuleActionOverrides'),
          awsIs(HTTP('/', '--query Status'), 200, 'La portada debería seguir respondiendo 200'),
        ),
        solution: [GRUPOS, ...ACTUALIZA_ACL, `aws wafv2 get-web-acl --name tienda-waf --scope REGIONAL --id $ID --query "WebACL.[Capacity,length(Rules)]" --output text`],
        hints: ['Una ACL se actualiza entera: `aws wafv2 get-web-acl --name tienda-waf --scope REGIONAL --id <id>` te da el `LockToken` y `aws wafv2 update-web-acl … --lock-token … --default-action Allow={} --rules file://reglas.json --visibility-config …` la sustituye. El id sale de `list-web-acls`.', 'Cada grupo es una regla con `Statement.ManagedRuleGroupStatement` (`VendorName` `AWS`, `Name` el del grupo) y `OverrideAction` `{"None":{}}` (en lugar de `Action`). Dale a cada una un `Priority` distinto y un `MetricName`.', 'Para el falso positivo, dentro del `ManagedRuleGroupStatement` de Common añade `"RuleActionOverrides":[{"Name":"SizeRestrictions_BODY","ActionToUse":{"Count":{}}}]`. Sin eso, `POST /subir` con más de 8 KB recibe un 403.'],
        explain: 'Con **dos líneas de configuración** tienes mantenida por AWS la protección contra la inyección SQL y las vulnerabilidades más comunes. Lo importante es el falso positivo: si quitas el grupo entero «porque bloquea las subidas», pierdes también el XSS. `RuleActionOverrides` baja **una regla** a `Count` y el resto sigue bloqueando. El flujo real es el mismo: observas en `Count`, ajustas y entonces bloqueas.',
        par: 8,
        commands: ['Grupos de reglas gestionados de WAF', 'AWS WAF', 'aws wafv2 create-web-acl'],
      }),
      mc('Quieres probar un grupo gestionado sin bloquear a nadie todavía. ¿Qué pones en su regla?', ['`"Action": {"Count": {}}`', '`"OverrideAction": {"Count": {}}`', '`"OverrideAction": {"None": {}}`', '`"Action": {"Allow": {}}`'], 1, 'Los grupos gestionados usan `OverrideAction`, no `Action`. `Count` anula todas sus acciones y solo cuenta (modo prueba); `None` deja que cada regla del grupo actúe como fue diseñada (normalmente bloqueando).'),
      practice({
        prompt: 'Alguien está probando contraseñas contra **`/login`**. Protégelo en la ACL **`tienda-waf`** (ya asociada a `tienda-alb`): una **regla por tasa** que **bloquee a cualquier IP que haga más de 100 peticiones a `/login` en 5 minutos**. El resto del sitio (la portada, el catálogo…) **no debe contar** para ese límite, y los usuarios normales no deben verse afectados.',
        goal: 'La IP que supera 100 intentos a /login en 5 minutos se bloquea; el resto no se ve afectado',
        setup: A('sec-waf-grupos'),
        check: all(
          awsMatches(HTTP('/login', '--from-ip 198.51.100.99 --count 150 --query Blocked'), '^[1-9]\\d+$', 'Una IP que hace 150 intentos a /login debería quedar bloqueada a partir del 101 (¿regla por tasa con límite 100?)'),
          awsIs(HTTP('/login', '--from-ip 203.0.113.9 --count 30 --query Blocked'), 0, 'Un usuario normal (30 intentos) no debería bloquearse'),
          awsIs(HTTP('/', '--from-ip 198.51.100.99 --count 150 --query Blocked'), 0, 'La portada no debe contar para el límite: usa un ScopeDownStatement que solo cuente /login'),
        ),
        solution: [LIMITE_LOGIN, ...ACTUALIZA_ACL, 'aws wafv2 get-web-acl --name tienda-waf --scope REGIONAL --id $ID --query "WebACL.Rules[0].Statement.RateBasedStatement.Limit"'],
        hints: ['Es una regla con `Statement.RateBasedStatement`: `Limit` 100, `AggregateKeyType` `IP` y `EvaluationWindowSec` 300 (5 minutos). La acción es `Block`.', 'Para que solo cuenten las peticiones a `/login`, añade dentro del `RateBasedStatement` un `ScopeDownStatement` con un `ByteMatchStatement` (`SearchString` `/login`, `FieldToMatch` `UriPath`, `PositionalConstraint` `STARTS_WITH`).', 'La ACL ya existe: léela con `get-web-acl` (para el `LockToken`) y sustituye sus reglas con `update-web-acl … --rules file://reglas.json`. Recuerda repetir la acción por defecto y la configuración de visibilidad.'],
        explain: 'Una regla por tasa **cuenta por IP**: otra IP no se ve afectada, y con el `ScopeDownStatement` solo se cuentan las peticiones que te interesan. Las primeras 100 llegan al servidor y, a partir de la 101, WAF responde 403 hasta que la tasa de esa IP baje. Contra un atacante con miles de IP no basta (necesitas grupos de reputación y bots), pero frena la fuerza bruta casual y los clientes mal programados.',
        par: 8,
        commands: ['Reglas por tasa de WAF', 'AWS WAF'],
      }),
      practice({
        prompt: 'Antes de bloquear nada en producción, quieres **ver qué cazaría el grupo de inyección SQL** sin afectar a los clientes. En la ACL **`tienda-waf`** (ya asociada a `tienda-alb`) añade **`AWSManagedRulesSQLiRuleSet`** en **modo prueba (Count)** y activa el **registro** de la ACL en un grupo de CloudWatch Logs llamado **`aws-waf-logs-tienda`**. Un atacante lanza una inyección: debe quedar **anotada en los registros como contada** y la web debe **seguir contestando** (aún no bloqueas).',
        goal: 'SQLi en modo Count, registro de WAF activado y las peticiones contadas aparecen en los registros',
        setup: A('sec-waf-grupos'),
        check: all(
          awsAfter([HTTP(SQLI)], awsMatches('logs filter-log-events --log-group-name aws-waf-logs-tienda --filter-pattern COUNT --query "length(events)"', '^[1-9]', 'La inyección no aparece contada en el grupo aws-waf-logs-tienda (¿registro activado y grupo SQLi en Count?)')),
          awsAfter([HTTP(SQLI)], awsMatches(HTTP(SQLI, '--query Status'), NO_403, 'En modo prueba no se debe bloquear: la petición tiene que seguir llegando al servidor')),
        ),
        solution: [SQLI_CONTAR, ...ACTUALIZA_ACL, 'ACL=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].ARN" --output text)', 'aws logs create-log-group --log-group-name aws-waf-logs-tienda', 'aws wafv2 put-logging-configuration --logging-configuration ResourceArn=$ACL,LogDestinationConfigs=arn:aws:logs:us-east-1:123456789012:log-group:aws-waf-logs-tienda', 'aws wafv2 get-logging-configuration --resource-arn $ACL --query LoggingConfiguration.LogDestinationConfigs --output text'],
        hints: ['El grupo SQLi con `"OverrideAction": {"Count": {}}` en lugar de `None`. La ACL se sustituye con `update-web-acl` (necesita el `LockToken` de `get-web-acl`).', 'Los registros de WAF van a un grupo de CloudWatch Logs cuyo nombre **empieza por `aws-waf-logs-`**: créalo con `aws logs create-log-group --log-group-name aws-waf-logs-tienda`.', 'Actívalos con `aws wafv2 put-logging-configuration --logging-configuration ResourceArn=<ARN de la ACL>,LogDestinationConfigs=arn:aws:logs:us-east-1:123456789012:log-group:aws-waf-logs-tienda`.'],
        explain: 'Es el flujo con el que se despliega WAF sin sustos: **Count + registros**, observar durante unos días qué detecta y a quién afectaría, ajustar los falsos positivos y solo entonces bloquear. En el registro, las reglas contadas salen en `nonTerminatingMatchingRules` y la petición como `ALLOW`: WAF la dejó pasar, pero tú sabes que la habría cortado.',
        par: 7,
        commands: ['Grupos de reglas gestionados de WAF', 'AWS WAF'],
      }),
      learn(
        'Shield y el diseño frente a DDoS',
        `
Un ataque **DDoS** (denegación de servicio distribuida) inunda tu aplicación con tanto tráfico que no puede atender a nadie. WAF no está pensado para eso; se defiende por capas:

- **AWS Shield Standard** (gratis, **ya activo en todas las cuentas**): protege de los ataques más frecuentes de capa 3 y 4 (inundaciones SYN, reflexión UDP…) en CloudFront, Route 53 y la red de AWS.
- **AWS Shield Advanced** (de pago, ≈ 3 000 $/mes con compromiso anual): protección ampliada por recurso (ALB, NLB, CloudFront, Elastic IP, Route 53, Global Accelerator), detección con métricas propias, **equipo de respuesta 24×7** y **protección de costes** (créditos por el uso extra que provoque un ataque).
- **Arquitectura resistente**, que es la que más pesa: **CloudFront** y **Route 53** delante absorben el tráfico en el borde; un ALB con **Auto Scaling** aguanta picos; **WAF** con reglas por tasa filtra la capa 7; **grupos de seguridad cerrados** reducen la superficie de ataque.

| | Defiende… | Ejemplo |
| --- | --- | --- |
| **Shield** | la red y el transporte (volumen) | Una inundación de paquetes UDP |
| **WAF** | la aplicación (contenido) | Mil peticiones al login con contraseñas distintas |
| **Grupo de seguridad** | los puertos | Que el 3306 de la base de datos no esté abierto |

Y la regla de oro: **ninguna capa sola es suficiente** —eso es *defensa en profundidad*—.
`,
        '🌊',
      ),
      multi('¿Qué elementos ayudan a resistir un ataque de denegación de servicio? (elige todos los correctos)', ['CloudFront delante del balanceador', 'Auto Scaling en el grupo de servidores', 'Reglas por tasa en WAF', 'Abrir todos los puertos en el grupo de seguridad "para que se reparta el tráfico"'], [0, 1, 2], 'CloudFront absorbe tráfico en el borde, Auto Scaling aguanta los picos y las reglas por tasa filtran la capa 7. Abrir puertos solo aumenta la superficie de ataque.'),
      match(
        'Une cada ataque con la defensa más adecuada',
        [
          ['Inundación de paquetes UDP contra la IP del balanceador', 'Shield'],
          ['Mil intentos de contraseña por minuto desde una IP', 'Regla por tasa de WAF'],
          ["Inyección SQL en el parámetro q", 'Grupo gestionado de SQLi'],
          ['Alguien conecta al puerto 3306 de la base de datos', 'Grupo de seguridad'],
        ],
        'Cada capa tiene su trabajo: Shield el volumen de red, WAF el contenido HTTP (con reglas gestionadas o por tasa) y los grupos de seguridad los puertos.',
      ),
      order('Ordena el despliegue prudente de un grupo gestionado de WAF', ['count', 'registrar', 'ajustar', 'bloquear'], 'count registrar ajustar bloquear', 'Se despliega en **Count**, se **registran** y revisan las peticiones detectadas, se **ajustan** los falsos positivos con `RuleActionOverrides` y solo entonces se pasa a **bloquear**.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a15-4', { title: 'Detección de amenazas', summary: 'GuardDuty, Inspector, Macie, Access Analyzer y Security Hub: enterarte antes que el cliente', emoji: '🚨', commands: ['Amazon GuardDuty', 'Filtros y supresión en GuardDuty', 'Amazon Inspector', 'Amazon Macie', 'AWS Security Hub', 'IAM Access Analyzer', 'aws accessanalyzer validate-policy', 'Qué servicio de seguridad usar'], minutes: 48 }, [
      learn(
        'Prevenir no basta: hay que detectar',
        `
Por buenas que sean tus defensas, **algo se colará**: una clave filtrada, un bucket compartido por error, un paquete sin parchear. La pregunta es **cuánto tardas en enterarte**. AWS tiene un servicio distinto para cada pregunta:

| Pregunta | Servicio | Qué mira |
| --- | --- | --- |
| «¿Alguien está atacando **ahora**?» | **GuardDuty** | CloudTrail, tráfico de red (flow logs) y DNS |
| «¿Qué **vulnerabilidades** tienen mis servidores e imágenes?» | **Inspector** | Paquetes instalados (CVE) y puertos expuestos |
| «¿Dónde hay **datos sensibles** en mis buckets?» | **Macie** | El contenido de los objetos de S3 |
| «¿Qué recursos están **compartidos con el exterior**?» | **Access Analyzer** | Las políticas de recursos |
| «¿Cómo estaba esto **ayer** y cumple las reglas?» | **Config** | El historial de configuración |
| «¿**Quién** hizo esa llamada, cuándo y desde dónde?» | **CloudTrail** | La API |
| «Quiero **una sola lista** priorizada de todo» | **Security Hub** | Agrega los hallazgos de todos y evalúa controles |

Ninguno **bloquea** nada por sí mismo: **detectan e informan**. La respuesta (aislar una instancia, revocar una clave, parchear) la ejecutas tú o la automatizas con **EventBridge**.
`,
        '🚨',
      ),
      illus('aws-sec-map', '¿Qué servicio responde?', 'Diez situaciones reales de seguridad: elige el servicio que las detecta o resuelve y lee por qué.'),
      learn(
        'GuardDuty: el vigilante que no instalas',
        `
**GuardDuty** analiza, sin agentes, tres fuentes: los **eventos de CloudTrail** (¿uso de root? ¿alguien apaga CloudTrail?), el **tráfico de red** (VPC Flow Logs) y las **consultas DNS** (una instancia que resuelve dominios de minería de criptomonedas o de control remoto). Cuando ve algo, abre un **hallazgo** con:

- un **tipo** (\`CryptoCurrency:EC2/BitcoinTool.B!DNS\`, \`Recon:EC2/PortProbeUnprotectedPort\`, \`UnauthorizedAccess:IAMUser/TorIPCaller\`…),
- una **gravedad**: baja (< 4), media (4–6,9) o alta (≥ 7),
- el **recurso** afectado y el detalle de lo que hizo.

Cómo se saca partido en la práctica:

1. **Actívalo** (\`create-detector --enable\`) en todas las regiones y cuentas. No hay nada más que configurar.
2. **Enruta los hallazgos graves**: GuardDuty publica cada hallazgo nuevo en **EventBridge** (\`source: aws.guardduty\`, \`detail-type: GuardDuty Finding\`). Una regla con el patrón \`"detail":{"severity":[{"numeric":[">=",7]}]}\` envía solo los de gravedad alta a un tema SNS, una Lambda o Security Hub. ⚠️ El tema SNS necesita una **política que deje publicar a \`events.amazonaws.com\`**.
3. **Silencia el ruido esperado** con un filtro \`ARCHIVE\`: un bastión con SSH abierto adrede recibirá sondeos todo el día. **Sé específico** (tipo **y** recurso): archivar todos los \`PortProbe\` de la cuenta esconde también el del servidor que sí debía estar cerrado.
4. **Responde**: grupo de seguridad de cuarentena, revocar la clave, parchear. Los hallazgos se conservan 90 días.

Y recuerda lo que **no** hace: no bloquea tráfico (eso es WAF, grupos de seguridad), no busca vulnerabilidades (Inspector) ni lee tus datos (Macie).
`,
        '🔭',
      ),
      demo(
        'GuardDuty con hallazgos de ejemplo',
        [
          ['aws guardduty create-detector --enable --query DetectorId --output text', 'Se activa en esta región: un detector por cuenta y región'],
          ['DET=$(aws guardduty list-detectors --query "DetectorIds[0]" --output text)', 'Guardamos su identificador'],
          ['aws guardduty create-sample-findings --detector-id $DET --finding-types CryptoCurrency:EC2/BitcoinTool.B!DNS Recon:EC2/PortProbeUnprotectedPort', 'Hallazgos de ejemplo (sirven para probar tus alertas sin esperar a un ataque)'],
          [`aws guardduty list-findings --detector-id $DET --finding-criteria '{"Criterion":{"severity":{"Gte":7}}}' --query "length(FindingIds)"`, 'Solo los de gravedad alta (7 o más)'],
          ['aws guardduty get-findings-statistics --detector-id $DET --finding-statistic-types COUNT_BY_SEVERITY --query FindingStatistics.CountBySeverity', 'Cuántos hay de cada gravedad'],
          ['aws guardduty create-detector --enable', 'Solo se permite un detector por región', 'error'],
        ],
        A('sec-gd'),
        'La cuenta tiene un servidor `web-1` y un tema SNS `alertas` con una cola `guardia` suscrita.',
      ),
      practice({
        prompt: 'GuardDuty está **apagado** en la cuenta y el servidor `web-1` está expuesto a internet. Quieres enterarte **solo de las amenazas graves** (gravedad **7 o más**) por el tema SNS **`alertas`** (la cola `guardia` es lo que recibe los avisos). Activa **GuardDuty** en la región y crea la regla de EventBridge **`gd-graves`** que reaccione a los hallazgos de GuardDuty de gravedad **≥ 7** y los envíe a `alertas`. Los hallazgos leves **no deben** generar aviso.',
        goal: 'GuardDuty activo y los hallazgos de gravedad alta llegan a alertas; los leves no',
        setup: A('sec-gd'),
        check: all(
          awsIs('_check guardduty --query Enabled', true, 'GuardDuty todavía no está activado en la región'),
          awsAfter(['_check attack --kind cryptominer --instance web-1'], awsMatches(AVISOS, HAY_AVISO, 'Un minero de criptomonedas en web-1 (gravedad alta) debería generar un aviso en alertas (¿regla de EventBridge con destino el tema alertas?)')),
          awsAfter(['_check attack --kind tor-login'], awsIs('_check guardduty --query Active', 1, 'El acceso desde Tor debería detectarse (gravedad media) pero sin aviso')),
          awsAfter(['_check attack --kind tor-login'], awsIs(AVISOS, '0', 'Un hallazgo de gravedad media no debe avisar a nadie: filtra por gravedad 7 o más en el patrón de la regla')),
        ),
        solution: [
          'aws guardduty create-detector --enable',
          "TOPIC=$(aws sns list-topics --query 'Topics[0].TopicArn' --output text)",
          `aws events put-rule --name gd-graves --event-pattern '{"source":["aws.guardduty"],"detail-type":["GuardDuty Finding"],"detail":{"severity":[{"numeric":[">=",7]}]}}'`,
          'aws events put-targets --rule gd-graves --targets Id=alertas,Arn=$TOPIC',
          'aws events list-targets-by-rule --rule gd-graves --query "Targets[].Arn" --output text',
        ],
        hints: ['Activa el servicio con `aws guardduty create-detector --enable`. El ARN del tema `alertas` sale de `aws sns list-topics`.', 'La regla: `aws events put-rule --name gd-graves --event-pattern \'{"source":["aws.guardduty"],"detail-type":["GuardDuty Finding"],"detail":{"severity":[{"numeric":[">=",7]}]}}\'`. El filtro numérico `[">=",7]` es lo que deja fuera los hallazgos leves.', 'El destino: `aws events put-targets --rule gd-graves --targets Id=alertas,Arn=<ARN del tema>`. El tema ya tiene la política que deja publicar a EventBridge; si creas uno nuevo, tendrías que añadirla.'],
        explain: 'Es la tubería clásica: **GuardDuty detecta → EventBridge filtra → SNS avisa**. El patrón con `{"numeric":[">=",7]}` es lo que separa un minero de criptomonedas (gravedad alta) de un acceso desde Tor (media): sin él, cada hallazgo menor despertaría a alguien y acabarías ignorando los avisos. Y recuerda que el tema SNS necesita una política que permita publicar a `events.amazonaws.com`.',
        par: 5,
        commands: ['Amazon GuardDuty', 'Qué servicio de seguridad usar'],
      }),
      practice({
        prompt: 'GuardDuty ya está activo y muestra **dos** hallazgos activos de tipo **`Recon:EC2/PortProbeUnprotectedPort`**: uno en **`bastion`** y otro en **`web-1`**. El bastión **tiene el SSH abierto a propósito** y los sondeos son esperados; `web-1` **no debería tenerlo abierto** y su hallazgo hay que seguir viéndolo. Crea un **filtro `ARCHIVE`** llamado **`bastion-esperado`** que archive **solo** los sondeos del bastión.',
        goal: 'El hallazgo del bastión queda archivado y el de web-1 sigue activo',
        setup: A('sec-gd-ruido'),
        check: all(
          awsIs('_check guardduty --query "[Active,Archived]"', [1, 1], 'Debe quedar 1 hallazgo activo y 1 archivado (el filtro es demasiado ancho o no existe)'),
          awsIs('_check guardduty --query ActiveNames', ['web-1'], 'El hallazgo que sigue activo debe ser el de web-1: el filtro tiene que archivar solo el del bastión'),
        ),
        solution: ['DET=$(aws guardduty list-detectors --query "DetectorIds[0]" --output text)', 'BAST=$(aws ec2 describe-instances --filters Name=tag:Name,Values=bastion --query "Reservations[0].Instances[0].InstanceId" --output text)', FILTRO_BASTION, `aws guardduty list-findings --detector-id $DET --finding-criteria '{"Criterion":{"service.archived":{"Eq":["false"]}}}' --query "length(FindingIds)"`],
        hints: ['Un filtro se crea con `aws guardduty create-filter --detector-id <id> --name bastion-esperado --action ARCHIVE --finding-criteria \'{…}\'`. El id del detector sale de `aws guardduty list-detectors`.', 'Los criterios son un objeto `{"Criterion":{…}}` con atributos y operadores: `"type":{"Eq":["Recon:EC2/PortProbeUnprotectedPort"]}` **y** `"resource.instanceDetails.instanceId":{"Eq":["<id del bastión>"]}`. Todos los criterios deben cumplirse.', 'Con solo el tipo archivarías también el de web-1. El id del bastión: `aws ec2 describe-instances --filters Name=tag:Name,Values=bastion`. Comprueba con `list-findings … "service.archived":{"Eq":["false"]}`.'],
        explain: 'Archivar silencia el ruido **sin apagar la detección**. La clave está en ser **específico**: un filtro «todos los PortProbe» habría escondido también el hallazgo de `web-1`, que es justo el que importa (alguien dejó abierto lo que no debía). Un buen filtro describe **por qué ese hallazgo es esperado**: este tipo, en este recurso.',
        par: 5,
        commands: ['Filtros y supresión en GuardDuty', 'Amazon GuardDuty'],
      }),
      learn(
        'Inspector: las vulnerabilidades que ya tienes',
        `
**Amazon Inspector** busca **vulnerabilidades conocidas** (CVE) de forma continua en cuanto lo activas, y no necesita que lances ningún escaneo:

- **EC2**: compara los **paquetes instalados** con la base de vulnerabilidades. ⚠️ **Necesita el agente de Systems Manager**: si la instancia no aparece como administrada en SSM, Inspector la lista como *sin cobertura*. También revisa la **alcanzabilidad de red** (SSH, RDP o bases de datos abiertas al mundo), sin agente.
- **ECR**: las imágenes de contenedor, al subirlas y cada vez que sale un CVE nuevo.
- **Lambda**: dependencias y código.

Cada hallazgo trae **gravedad** (\`CRITICAL\` … \`LOW\`), si hay **exploit disponible**, si hay **corrección**, el paquete afectado y la versión que lo arregla. Cuando parcheas, el hallazgo se **cierra solo** (\`CLOSED\`); si necesitas ignorarlo, un filtro \`SUPPRESS\` lo marca como \`SUPPRESSED\`.

Cierra el círculo con **Systems Manager Patch Manager**: Inspector **encuentra** lo que falta; Patch Manager lo **aplica** (\`AWS-RunPatchBaseline\` con \`Operation=Install\`). Ojo: la línea base por defecto **aprueba los parches a los 7 días** de publicarse, así que un parche crítico de ayer no se instalará hasta dentro de una semana. Una línea base propia (\`ApproveAfterDays=0\` para seguridad) lo cambia.
`,
        '🔬',
      ),
      practice({
        prompt: 'Los servidores **`web-1`** y **`web-2`** (etiqueta `Env=prod`, Amazon Linux 2023, administrados por Systems Manager) llevan semanas sin parchear. **Activa Inspector para EC2**, mira qué vulnerabilidades **críticas** tiene y déjalo con **cero hallazgos críticos activos**. Aviso: la línea base de parches por defecto solo aprueba parches con **7 días** de antigüedad, y algunos parches críticos son más recientes.',
        goal: 'Inspector activo para EC2 y ningún hallazgo CRITICAL activo',
        setup: A('sec-inspector'),
        check: all(
          awsIs('inspector2 batch-get-account-status --query "accounts[0].resourceState.ec2.status"', 'ENABLED', 'Inspector todavía no está activado para EC2'),
          awsIs(CRITICAS_ACTIVAS, 0, 'Quedan hallazgos críticos activos: ¿has aprobado los parches de seguridad recientes y ejecutado Install en las dos instancias?'),
        ),
        solution: [
          'aws inspector2 enable --resource-types EC2',
          `aws inspector2 list-findings --filter-criteria '{"severity":[{"comparison":"EQUALS","value":"CRITICAL"}]}' --query "findings[].title" --output text`,
          'cat > reglas.json <<EOF\n{"PatchRules":[{"PatchFilterGroup":{"PatchFilters":[{"Key":"CLASSIFICATION","Values":["Security"]}]},"ApproveAfterDays":0}]}\nEOF',
          'B=$(aws ssm create-patch-baseline --name seguridad-ya --operating-system AMAZON_LINUX_2023 --approval-rules file://reglas.json --query BaselineId --output text)',
          'aws ssm register-default-patch-baseline --baseline-id $B',
          'aws ssm send-command --document-name AWS-RunPatchBaseline --parameters Operation=Install --targets Key=tag:Env,Values=prod',
          'sleep 60',
          `aws ${CRITICAS_ACTIVAS}`,
        ],
        hints: ['Actívalo con `aws inspector2 enable --resource-types EC2`. Los críticos: `aws inspector2 list-findings --filter-criteria \'{"severity":[{"comparison":"EQUALS","value":"CRITICAL"}]}\'` (cada hallazgo dice el paquete y la versión que lo arregla).', 'Parchear es cosa de Systems Manager: `aws ssm send-command --document-name AWS-RunPatchBaseline --parameters Operation=Install --targets Key=tag:Env,Values=prod`. Pero con la línea base por defecto (aprueba a los 7 días) algunos parches críticos quedan «no aprobados».', 'Crea una línea base propia: `aws ssm create-patch-baseline --name seguridad-ya --operating-system AMAZON_LINUX_2023 --approval-rules file://reglas.json` (reglas: clasificación `Security` con `ApproveAfterDays` 0), hazla la de por defecto con `aws ssm register-default-patch-baseline --baseline-id …` y vuelve a ejecutar Install. Sin `--operating-system`, la línea base sería de Windows.'],
        explain: 'Inspector **encuentra**, Patch Manager **arregla**: sin el segundo, la lista de hallazgos solo crece. La trampa del ejercicio es un clásico real: la línea base por defecto espera 7 días antes de aprobar un parche, así que un hallazgo crítico reciente **no se cierra** aunque ejecutes `Install`. Cuando el parche se instala, el hallazgo pasa a `CLOSED` solo: no hay que marcarlo a mano.',
        par: 8,
        commands: ['Amazon Inspector', 'Qué servicio de seguridad usar'],
      }),
      learn(
        'Macie: datos sensibles en S3',
        `
Un bucket con permisos perfectos puede seguir siendo un problema si **guarda lo que no debería**: un CSV de clientes con DNI y tarjetas en un bucket de «exportaciones», una copia de seguridad con una clave de AWS dentro. **Amazon Macie** lo descubre:

1. **Inventario** (automático): para cada bucket sabe si es **público**, está **compartido** con otra cuenta, tiene desactivado Block Public Access, cómo cifra…
2. **Trabajos de clasificación** (los lanzas tú): leen los objetos y buscan **identificadores de datos gestionados** (tarjetas con verificación de Luhn, claves de acceso de AWS, DNI, IBAN, claves privadas…) o **propios** (una expresión regular + palabras clave). Cada objeto con coincidencias genera un hallazgo (\`SensitiveData:S3Object/Financial\`, \`/Personal\`, \`/Credentials\`, \`/Multiple\`).

Lo que **no** hace: no borra ni mueve nada. Te dice **dónde** está el dato; la decisión es tuya: **cifrarlo** con una clave propia, **moverlo** a un bucket restringido, cerrar el acceso o borrarlo. Si el hallazgo es una **clave de acceso**, además hay que **desactivarla y rotarla**: aunque borres el fichero, la clave pudo copiarse.

Solo analiza **S3** (no bases de datos) y formatos conocidos (texto, CSV, JSON, PDF, documentos). Los trabajos tardan según el volumen: en esta cuenta simulada, un par de minutos (\`sleep 120\`).
`,
        '🔍',
      ),
      practice({
        prompt: 'El bucket **`exportaciones`** mezcla ficheros inocuos (`ventas.csv`, `logo.png`) con otros que, según el equipo, **podrían** contener datos de clientes (`clientes.csv`, `claves.txt`). No lo des por hecho: **activa Macie**, lanza un **trabajo de clasificación** de una sola vez (**`revisar-exportaciones`**) sobre ese bucket y espera a que termine. Con lo que encuentre, **mueve los objetos con datos sensibles** a un bucket privado nuevo llamado **`datos-restringidos`** y deja en `exportaciones` solo lo inocuo.',
        goal: 'Macie activo, trabajo completado y los objetos sensibles fuera de exportaciones, en un bucket privado',
        setup: A('sec-macie'),
        check: all(
          awsIs('_check macie --query "[Enabled,Jobs[0].Name,Jobs[0].Status,Jobs[0].Buckets[0]]"', [true, 'revisar-exportaciones', 'COMPLETE', 'exportaciones'], 'Falta el trabajo de clasificación revisar-exportaciones sobre el bucket exportaciones (y Macie activo), ya completado'),
          awsIs('s3api list-objects-v2 --bucket exportaciones --query "Contents[].Key"', ['logo.png', 'ventas.csv'], 'En exportaciones solo deben quedar los objetos inocuos: logo.png y ventas.csv'),
          awsIs('s3api list-objects-v2 --bucket datos-restringidos --query "Contents[].Key"', ['claves.txt', 'clientes.csv'], 'Los dos objetos con datos sensibles deberían estar en el bucket datos-restringidos'),
        ),
        solution: [
          'aws macie2 enable-macie',
          `aws macie2 create-classification-job --job-type ONE_TIME --name revisar-exportaciones --s3-job-definition '{"bucketDefinitions":[{"accountId":"123456789012","buckets":["exportaciones"]}]}' --query jobId --output text`,
          'sleep 180',
          'aws macie2 list-classification-jobs --query "items[].[name,jobStatus]" --output text',
          'aws macie2 get-findings --finding-ids $(aws macie2 list-findings --query "findingIds" --output text) --query "findings[].[type,resourcesAffected.s3Object.key]" --output text',
          'aws s3 mb s3://datos-restringidos',
          'aws s3 mv s3://exportaciones/clientes.csv s3://datos-restringidos/',
          'aws s3 mv s3://exportaciones/claves.txt s3://datos-restringidos/',
        ],
        hints: ['Activa el servicio con `aws macie2 enable-macie` y lanza el trabajo con `aws macie2 create-classification-job --job-type ONE_TIME --name revisar-exportaciones --s3-job-definition \'{"bucketDefinitions":[{"accountId":"123456789012","buckets":["exportaciones"]}]}\'`.', 'El trabajo tarda un poco: `sleep 120` y mira `aws macie2 list-classification-jobs` hasta que ponga `COMPLETE`. Los hallazgos: `aws macie2 list-findings` y `aws macie2 get-findings --finding-ids …` (el tipo y `resourcesAffected.s3Object.key`).', 'Crea el bucket con `aws s3 mb s3://datos-restringidos` y mueve cada objeto sensible con `aws s3 mv s3://exportaciones/<objeto> s3://datos-restringidos/`. Los dos que Macie marca son un CSV con tarjetas y DNI, y un fichero con una clave de acceso de AWS.'],
        explain: 'Macie **encuentra**; tú **decides**. Mover los objetos a un bucket con acceso restringido (idealmente cifrado con una clave propia, como en la primera lección) corrige el problema de ubicación sin perder los datos. Pero fíjate en `claves.txt`: contiene una **clave de acceso de AWS**, y mover el fichero no la protege: hay que **desactivarla y crear otra** (`aws iam update-access-key --status Inactive`), porque pudo copiarse antes de que lo supieras.',
        par: 8,
        commands: ['Amazon Macie', 'Qué servicio de seguridad usar'],
      }),
      learn(
        'Access Analyzer y Security Hub: el mapa y el panel',
        `
**IAM Access Analyzer** responde a «¿qué recursos de mi cuenta puede usar alguien **de fuera**?». Revisa las **políticas de recursos** (buckets de S3, relaciones de confianza de roles, claves de KMS, secretos, colas, temas, funciones Lambda) y abre un **hallazgo** por cada entidad externa con acceso: otra cuenta, o \`"Principal": "*"\` (público). Cuando corriges la política, el hallazgo pasa solo a \`RESOLVED\`. Para accesos **esperados** (un socio legítimo) creas una **regla de archivo** que archiva sola los hallazgos que coinciden **sin tocar el acceso**. Además, \`validate-policy\` revisa una política **antes** de aplicarla (errores de sintaxis, acciones con erratas, \`iam:PassRole\` con \`*\`).

**AWS Security Hub** es el **panel único**: **agrega** los hallazgos de GuardDuty, Inspector, Macie y Access Analyzer en un formato común y evalúa tu cuenta con **controles** de buenas prácticas (*AWS Foundational Security Best Practices* y *CIS*): \`S3.2\`, \`EC2.13\`, \`KMS.4\`, \`CloudTrail.1\`… cada uno \`PASSED\` o \`FAILED\` por recurso, con la gravedad y cómo arreglarlo. ⚠️ **Necesita AWS Config grabando**: sin él, los estándares quedan \`INCOMPLETE\`. Es un **agregador y auditor**: no detecta amenazas por sí mismo, ordena y prioriza lo que encuentran los demás.

**El camino típico de un hallazgo:** *detectar* (GuardDuty, Inspector, Macie, Analyzer) → *agregar* (Security Hub) → *notificar* (EventBridge → SNS) → *remediar* (Lambda o Systems Manager).
`,
        '🗺️',
      ),
      demo(
        'Validar una política antes de aplicarla',
        [
          [`echo '{"Statement":[{"Effect":"Allow","Action":["iam:PassRole"],"Resource":"*"},{"Effect":"Allow","Action":"s3:GetObjects","Resource":"arn:aws:s3:::b/*"}]}' > politica.json`, 'Una política con tres problemas escondidos'],
          ['aws accessanalyzer validate-policy --policy-document file://politica.json --policy-type IDENTITY_POLICY --query "findings[].[findingType,issueCode]" --output text', 'Falta la versión, un `PassRole` abierto a todo y una acción con errata (`GetObjects`)'],
        ],
        A('base'),
        '`validate-policy` no necesita ningún analizador creado y es gratis: puedes llamarlo desde tu integración continua antes de desplegar.',
      ),
      practice({
        prompt: 'Revisa quién de fuera tiene acceso a tus recursos. **Crea un analizador de cuenta llamado `cuenta`** y míralo: hay un bucket **`facturas`** compartido por error con una cuenta desconocida (**`999999999999`**), y un socio de confianza (**`888888888888`**) con acceso **esperado** al bucket **`intercambio`** y al rol **`socio-rol`**. **Corrige** el acceso del bucket `facturas` (que el hallazgo quede *resuelto*) y **archiva automáticamente** los hallazgos del socio con una **regla de archivo `socio-esperado`**, sin quitarle el acceso.',
        goal: 'Sin hallazgos activos: facturas resuelto, y el socio archivado sin perder su acceso',
        setup: A('sec-analyzer'),
        check: all(
          awsIs(`accessanalyzer list-findings --analyzer-arn ${ANALIZADOR} --filter '{"status":{"eq":["ACTIVE"]}}' --query "length(findings)"`, 0, 'Quedan hallazgos activos: ¿analizador `cuenta` creado, facturas corregido y regla de archivo para el socio?'),
          awsIs(`accessanalyzer list-findings --analyzer-arn ${ANALIZADOR} --filter '{"resource":{"eq":["arn:aws:s3:::facturas"]}}' --query "findings[0].status"`, 'RESOLVED', 'El hallazgo de facturas debería estar RESOLVED (corrige la política del bucket, no lo archives)'),
          awsHas('s3api get-bucket-policy --bucket intercambio --query Policy --output text', '888888888888', 'El socio ha perdido el acceso al bucket intercambio: la regla de archivo no debe cambiar la política'),
        ),
        solution: [
          'aws accessanalyzer create-analyzer --analyzer-name cuenta --type ACCOUNT --query arn --output text',
          'AN=$(aws accessanalyzer list-analyzers --query "analyzers[0].arn" --output text)',
          'aws accessanalyzer list-findings --analyzer-arn $AN --query "findings[].[resource,principal.AWS,status]" --output text',
          'aws s3api delete-bucket-policy --bucket facturas',
          `aws accessanalyzer create-archive-rule --analyzer-name cuenta --rule-name socio-esperado --filter '{"principal.AWS":{"eq":["888888888888"]}}'`,
          'aws accessanalyzer list-findings --analyzer-arn $AN --query "findings[].[resource,status]" --output text',
        ],
        hints: ['El analizador: `aws accessanalyzer create-analyzer --analyzer-name cuenta --type ACCOUNT`. Después `aws accessanalyzer list-findings --analyzer-arn <arn>` muestra recurso, principal externo y estado.', 'Para `facturas`, la causa es su política de bucket: quita la sentencia que da acceso a `999999999999` (por ejemplo `aws s3api delete-bucket-policy --bucket facturas`). El hallazgo se resuelve solo al volver a analizar.', 'La regla de archivo: `aws accessanalyzer create-archive-rule --analyzer-name cuenta --rule-name socio-esperado --filter \'{"principal.AWS":{"eq":["888888888888"]}}\'`. Filtra por el principal del socio, no por tipo de recurso, para no esconder otros hallazgos.'],
        explain: 'Hay dos respuestas distintas a un hallazgo: **corregir** (el acceso no debía existir: se arregla la política y el hallazgo pasa a `RESOLVED`) y **archivar** (el acceso es legítimo: se deja constancia y no vuelve a molestar). Confundirlas es peligroso: archivar `facturas` habría dejado abierto el bucket a una cuenta desconocida. Y una regla de archivo bien hecha es **específica** (el principal del socio), igual que los filtros de GuardDuty.',
        par: 7,
        commands: ['IAM Access Analyzer', 'aws accessanalyzer validate-policy'],
      }),
      mc('Un hallazgo de Access Analyzer dice que un socio de confianza tiene acceso de lectura a un bucket, y es lo acordado. ¿Qué haces?', ['Quitar la política del bucket para que el hallazgo desaparezca', 'Crear una regla de archivo que archive los hallazgos de ese principal, sin tocar el acceso', 'Desactivar Access Analyzer', 'Ignorarlo: no se puede hacer nada'], 1, 'Un acceso esperado se archiva (con una regla específica); no se «arregla» quitándolo, porque romperías la colaboración. Los accesos **no** esperados sí se corrigen en la política.'),
      multi('¿Qué servicios de seguridad dependen de AWS Config o del agente de Systems Manager para funcionar bien? (elige todos los correctos)', ['Security Hub necesita Config grabando para evaluar sus controles', 'Inspector necesita el agente de Systems Manager para los paquetes de EC2', 'GuardDuty necesita instalar un agente en cada instancia', 'Macie necesita Config para leer los objetos de S3'], [0, 1], 'Security Hub se apoya en Config; Inspector (paquetes de EC2) en el agente de Systems Manager. GuardDuty no usa agentes (lee CloudTrail, flow logs y DNS) y Macie lee los objetos directamente.'),
      order('Ordena el camino de un hallazgo de seguridad, de la detección a la solución', ['detectar', 'agregar', 'notificar', 'remediar'], 'detectar agregar notificar remediar', 'Un servicio **detecta** (GuardDuty, Inspector…), Security Hub lo **agrega** con los demás, EventBridge y SNS **notifican** y, si procede, una Lambda o Systems Manager **remedia**.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a15-5', { title: 'Organizations, SCP y gobierno', summary: 'Un techo de permisos para toda la organización, y cómo se apilan todas las capas', emoji: '🏛️', commands: ['AWS Organizations', 'SCP', 'Evaluación de SCP: raíz, unidades y cuenta', 'AWS Control Tower', 'Defensa en profundidad'], minutes: 40 }, [
      learn(
        'Un techo de permisos para toda la organización',
        `
Con **una** cuenta, IAM basta. Con **cincuenta**, necesitas algo por encima: unas reglas que **ningún administrador de una cuenta pueda saltarse**. Eso son las **políticas de control de servicios** (**SCP**) de **AWS Organizations**.

Una organización es un árbol: la **raíz**, **unidades organizativas** (OU: \`Produccion\`, \`Sandbox\`) y **cuentas**. Las SCP se **adjuntan** a la raíz, a una OU o a una cuenta y fijan **el máximo que se puede hacer** por debajo. Tres ideas que lo resumen todo:

1. **Una SCP nunca concede permisos**: solo recorta. Para hacer algo hace falta que **la SCP lo permita *y* que IAM lo permita**.
2. **Se evalúa cada nivel del camino** (raíz → OU → cuenta): en **cada uno** tiene que haber una SCP con \`Allow\` que cubra la acción, y **ninguna** con \`Deny\` que la alcance, en **ningún** nivel. Un \`Deny\` en cualquier punto gana.
3. **Toda cuenta y OU nace con \`FullAWSAccess\`** (un \`Allow *\`). Si la quitas de un nivel sin poner otro \`Allow\`, **nadie puede hacer nada** por debajo.

Dos estrategias:

- **Lista de denegados** (la normal): se mantiene \`FullAWSAccess\` y se añaden \`Deny\` concretos (regiones prohibidas, no apagar CloudTrail…). Sencilla y difícil de romper.
- **Lista de permitidos**: se quita \`FullAWSAccess\` y se permite solo lo necesario. Muy estricta, pero fácil dejarse algo (servicios globales, servicios vinculados).

Detalles que importan:

- **La cuenta de administración no se ve afectada** por las SCP (por eso no debe usarse para cargas de trabajo). El resto de cuentas —incluido su usuario *root*— sí.
- Limitar regiones con \`Deny\` + **\`NotAction\`** (los servicios globales: \`iam\`, \`organizations\`, \`sts\`, \`route53\`, \`cloudfront\`, \`support\`) y la condición \`aws:RequestedRegion\`.
- Una **excepción** para un rol de seguridad: condición \`ArnNotLike\` sobre \`aws:PrincipalArn\`.
`,
        '🏛️',
      ),
      illus('aws-scp-chain', 'Los tres niveles de la cadena', 'Cambia la SCP de cada nivel (FullAWSAccess, solo Irlanda, lista de permitidos, protección de CloudTrail, sin Allow) y prueba acciones distintas: mira en qué nivel se corta y por qué.'),
      mc('Quitas `FullAWSAccess` de la OU `Produccion` y no añades ninguna otra SCP. ¿Qué puede hacer la cuenta `web-prod` (dentro de esa OU)?', ['Todo, porque la raíz sí tiene FullAWSAccess', 'Nada: en ese nivel no hay ninguna SCP con Allow, y cada nivel del camino necesita una', 'Solo lo que permita IAM', 'Solo las acciones de lectura'], 1, 'Cada nivel del camino necesita su propio `Allow`. Sin `FullAWSAccess` (ni otra SCP que permita) en la OU, todo lo que hay por debajo queda denegado, aunque la raíz sí permita y aunque IAM también.'),
      demo(
        'Una SCP de regiones, paso a paso',
        [
          ['ROOT=$(aws organizations list-roots --query "Roots[0].Id" --output text)', 'El identificador de la raíz de la organización'],
          ['aws organizations list-accounts --query "Accounts[].Name" --output text', 'Cuatro cuentas: la de administración y tres miembros'],
          ['aws organizations list-policies --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text', 'De momento solo existe `FullAWSAccess`'],
          [`P=$(aws organizations create-policy --name solo-irlanda --description "Solo eu-west-1" --type SERVICE_CONTROL_POLICY --content '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","NotAction":["iam:*","organizations:*","sts:*","route53:*","cloudfront:*","support:*"],"Resource":"*","Condition":{"StringNotEquals":{"aws:RequestedRegion":["eu-west-1"]}}}]}' --query Policy.PolicySummary.Id --output text)`, 'Denegar todo fuera de Irlanda, excepto los servicios globales'],
          ['aws organizations attach-policy --policy-id $P --target-id $ROOT', 'Se adjunta a la raíz: afecta a toda la organización'],
          ['aws organizations list-policies-for-target --target-id $ROOT --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text', 'La raíz tiene ahora `FullAWSAccess` (el Allow) y `solo-irlanda` (el Deny)'],
          ['aws organizations detach-policy --policy-id p-FullAWSAccess --target-id $ROOT --query x', 'Quitar `FullAWSAccess` de la raíz no da error…'],
          ['aws organizations list-policies-for-target --target-id $ROOT --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text', '…pero ahora el único nivel con SCP solo tiene un Deny: nadie podrá hacer nada'],
        ],
        A('sec-scp'),
        'La organización tiene las unidades `Produccion` (cuenta `web-prod`) y `Sandbox` (cuenta `lab-1`), y la cuenta `seguridad` colgando de la raíz.',
      ),
      practice({
        prompt: 'La empresa solo opera en **Irlanda (`eu-west-1`)** y cada cierto tiempo aparece una instancia olvidada en otra región. Crea la SCP **`solo-irlanda`** que **niegue todo lo que se haga fuera de `eu-west-1`**, **salvo los servicios globales** (`iam`, `organizations`, `sts`, `route53`, `cloudfront` y `support`, que no dependen de región) y **adjúntala a toda la organización** (la raíz). **No** quites `FullAWSAccess`.',
        goal: 'Fuera de eu-west-1 no se puede lanzar nada en ninguna cuenta, pero IAM y los servicios globales siguen funcionando',
        setup: A('sec-scp'),
        check: all(
          awsIs('_check scp --account web-prod --action ec2:RunInstances --context aws:RequestedRegion=us-east-1 --query Allowed', false, 'Lanzar instancias en Virginia (us-east-1) debería estar denegado en web-prod'),
          awsIs('_check scp --account lab-1 --action ec2:RunInstances --context aws:RequestedRegion=us-east-1 --query Allowed', false, 'La restricción debe aplicarse a toda la organización: lab-1 también debe quedar sin Virginia'),
          awsIs('_check scp --account web-prod --action ec2:RunInstances --context aws:RequestedRegion=eu-west-1 --query Allowed', true, 'En Irlanda (eu-west-1) sí debe seguir permitido'),
          awsIs('_check scp --account web-prod --action iam:CreateUser --context aws:RequestedRegion=us-east-1 --query Allowed', true, 'IAM es un servicio global (su punto de enlace está en us-east-1): no debe quedar denegado; usa NotAction para excluir los servicios globales'),
        ),
        solution: [
          'ROOT=$(aws organizations list-roots --query "Roots[0].Id" --output text)',
          `P=$(aws organizations create-policy --name solo-irlanda --description "Solo eu-west-1" --type SERVICE_CONTROL_POLICY --content '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","NotAction":["iam:*","organizations:*","sts:*","route53:*","cloudfront:*","support:*"],"Resource":"*","Condition":{"StringNotEquals":{"aws:RequestedRegion":["eu-west-1"]}}}]}' --query Policy.PolicySummary.Id --output text)`,
          'aws organizations attach-policy --policy-id $P --target-id $ROOT',
          'aws organizations list-policies-for-target --target-id $ROOT --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text',
        ],
        hints: ['Una SCP se crea con `aws organizations create-policy --name solo-irlanda --description "…" --type SERVICE_CONTROL_POLICY --content \'{…}\'` y devuelve su id en `Policy.PolicySummary.Id`.', 'El contenido es un `Deny` con `NotAction` (lista de servicios globales: `iam:*`, `organizations:*`, `sts:*`, `route53:*`, `cloudfront:*`, `support:*`), `Resource` `*` y la condición `StringNotEquals` sobre `aws:RequestedRegion` con `["eu-west-1"]`.', 'Se aplica con `aws organizations attach-policy --policy-id <id> --target-id <id de la raíz>`. La raíz: `aws organizations list-roots`. Comprueba con `list-policies-for-target`.'],
        explain: 'Es el patrón clásico para **limitar regiones**. `Deny` + `StringNotEquals` sobre `aws:RequestedRegion` niega lo que se pida a cualquier otra región; **`NotAction`** deja fuera a los servicios globales, porque si denegaras `iam:*` fuera de Irlanda romperías IAM, Organizations y STS (viven en us-east-1). Como `FullAWSAccess` sigue ahí, el resto funciona: es una **lista de denegados**.',
        par: 5,
        commands: ['SCP', 'Evaluación de SCP: raíz, unidades y cuenta', 'AWS Organizations'],
      }),
      practice({
        prompt: 'Un día alguien con demasiados permisos apaga CloudTrail en una cuenta de producción para «hacer una prueba» y nadie se entera. Crea la SCP **`proteger-auditoria`** que **niegue** `cloudtrail:StopLogging`, `cloudtrail:DeleteTrail` y `guardduty:DeleteDetector` **a todos menos al rol `SecurityAdmin`** (condición `ArnNotLike` sobre `aws:PrincipalArn` con `arn:aws:iam::*:role/SecurityAdmin`) y adjúntala **solo a la unidad `Produccion`**: el Sandbox no se toca.',
        goal: 'En Produccion nadie salvo SecurityAdmin puede apagar la auditoría; el Sandbox no se ve afectado',
        setup: A('sec-scp'),
        check: all(
          awsIs('_check scp --account web-prod --action cloudtrail:StopLogging --context aws:PrincipalArn=arn:aws:iam::123456789012:user/becario --query Allowed', false, 'Un usuario cualquiera de web-prod no debería poder apagar CloudTrail'),
          awsIs('_check scp --account web-prod --action guardduty:DeleteDetector --context aws:PrincipalArn=arn:aws:iam::123456789012:user/becario --query Allowed', false, 'Tampoco debería poder borrar el detector de GuardDuty'),
          awsIs('_check scp --account web-prod --action cloudtrail:StopLogging --context aws:PrincipalArn=arn:aws:iam::123456789012:role/SecurityAdmin --query Allowed', true, 'El rol SecurityAdmin debe quedar fuera del bloqueo (ArnNotLike)'),
          awsIs('_check scp --account lab-1 --action cloudtrail:StopLogging --query Allowed', true, 'La SCP solo debe aplicarse a la unidad Produccion: el Sandbox no se toca'),
        ),
        solution: [
          'ROOT=$(aws organizations list-roots --query "Roots[0].Id" --output text)',
          "OU=$(aws organizations list-organizational-units-for-parent --parent-id $ROOT --query 'OrganizationalUnits[?Name==`Produccion`].Id | [0]' --output text)",
          `T=$(aws organizations create-policy --name proteger-auditoria --description "No apagar la auditoria" --type SERVICE_CONTROL_POLICY --content '{"Version":"2012-10-17","Statement":[{"Sid":"ProtegerAuditoria","Effect":"Deny","Action":["cloudtrail:StopLogging","cloudtrail:DeleteTrail","guardduty:DeleteDetector"],"Resource":"*","Condition":{"ArnNotLike":{"aws:PrincipalArn":"arn:aws:iam::*:role/SecurityAdmin"}}}]}' --query Policy.PolicySummary.Id --output text)`,
          'aws organizations attach-policy --policy-id $T --target-id $OU',
          'aws organizations list-policies-for-target --target-id $OU --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text',
        ],
        hints: ['La SCP es un `Deny` con `Action` [`cloudtrail:StopLogging`, `cloudtrail:DeleteTrail`, `guardduty:DeleteDetector`], `Resource` `*` y la condición `ArnNotLike` → `aws:PrincipalArn` → `arn:aws:iam::*:role/SecurityAdmin`. Es una **excepción por identidad**: el `Deny` solo se aplica si el principal **no** es ese rol.', 'Las unidades de la raíz: `aws organizations list-organizational-units-for-parent --parent-id <raíz>`. Necesitas el id de `Produccion` (no el de la raíz: así el Sandbox queda fuera).', 'Se crea con `create-policy` (tipo `SERVICE_CONTROL_POLICY`) y se aplica con `aws organizations attach-policy --policy-id … --target-id <id de la OU>`.'],
        explain: 'Las SCP se heredan **hacia abajo**: adjuntada a `Produccion`, afecta a `web-prod` y a cualquier cuenta que se añada a esa unidad en el futuro, y no toca al Sandbox. La condición `ArnNotLike` es la forma de dejar **una puerta de servicio**: el equipo de seguridad conserva el control mientras nadie más puede apagar la auditoría. Esto es lo que se llama un **guardarraíl preventivo**: no avisa de que alguien lo ha hecho, **lo impide**.',
        par: 6,
        commands: ['SCP', 'Evaluación de SCP: raíz, unidades y cuenta'],
      }),
      learn(
        'Cuando las SCP bloquean de más, Control Tower y las capas',
        `
**Depurar una acción denegada:** si IAM lo permite y aun así da \`AccessDenied\`, mira las SCP del camino (**raíz → OU → cuenta**): ¿hay algún \`Deny\` que la alcance? ¿Falta un \`Allow\` en algún nivel (una OU sin \`FullAWSAccess\`)? El mensaje suele decir *«with an explicit deny in a service control policy»* o *«no service control policy allows»*. Un cambio en una SCP de la raíz afecta a **todas** las cuentas: pruébalo antes en una OU de pruebas.

**AWS Control Tower** automatiza montar una organización segura: una **landing zone** (OU \`Security\` con las cuentas *Audit* y *Log Archive*, CloudTrail y Config centralizados), **guardarraíles** (preventivos con SCP, detectivos con Config) y **Account Factory** (cuentas nuevas ya configuradas). Compensa cuando vas a tener **muchas cuentas**; para dos, Organizations y unas SCP a mano bastan. Lo que montas con Control Tower **se gestiona con Control Tower** (si cambias sus SCP a mano, derivan).

**Defensa en profundidad:** ninguna capa es perfecta, así que se **apilan**, cada una independiente de las demás:

| Capa | Pregunta | Herramientas |
| --- | --- | --- |
| **Gobierno** | ¿Qué está permitido en toda la organización? | Organizations + **SCP**, Control Tower |
| **Identidad** | ¿Quién puede hacer qué? | IAM (mínimo privilegio, roles, MFA) |
| **Red** | ¿Quién puede llegar hasta aquí? | VPC, grupos de seguridad, NACL, endpoints |
| **Aplicación** | ¿Qué peticiones son legítimas? | **WAF**, **Shield**, CloudFront |
| **Datos** | ¿Está protegido lo que guardo? | **KMS**, **Secrets Manager**, **ACM**, Macie |
| **Detección** | ¿Me entero si algo falla? | **GuardDuty**, **Inspector**, **Access Analyzer**, CloudTrail, Config |
| **Respuesta** | ¿Qué hago cuando pasa? | EventBridge, Lambda, Systems Manager, **Security Hub** |

Y el principio que lo une: **asume que alguien se saltará una capa**, y que la siguiente contenga el daño.
`,
        '🧅',
      ),
      practice({
        prompt: 'Los desarrolladores de **`web-prod`** (unidad `Produccion`) no pueden lanzar **ninguna instancia**: `ec2:RunInstances` sale denegado aunque IAM lo permite. Investiga: la unidad tiene solo una SCP de **lista de permitidos** llamada **`solo-s3`** (y no tiene `FullAWSAccess`, a propósito: quieres una lista cerrada). **Sin volver a poner `FullAWSAccess`**, modifica la SCP `solo-s3` para permitir **también EC2 y CloudWatch**. Otros servicios (como IAM) deben seguir sin permitirse.',
        goal: 'web-prod puede usar S3, EC2 y CloudWatch, y nada más (lista cerrada)',
        setup: A('sec-scp-lista'),
        check: all(
          awsIs('_check scp --account web-prod --action ec2:RunInstances --query Allowed', true, 'ec2:RunInstances sigue denegado en web-prod: añade ec2 a la SCP de lista de permitidos'),
          awsIs('_check scp --account web-prod --action cloudwatch:PutMetricData --query Allowed', true, 'CloudWatch también debería quedar permitido'),
          awsIs('_check scp --account web-prod --action s3:GetObject --query Allowed', true, 'S3 debe seguir permitido'),
          awsIs('_check scp --account web-prod --action iam:CreateUser --query Allowed', false, 'IAM no debería estar permitido: es una lista cerrada (¿has vuelto a poner FullAWSAccess?)'),
        ),
        solution: [
          'aws organizations list-policies --filter SERVICE_CONTROL_POLICY --query "Policies[].[Id,Name]" --output text',
          "P=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY --query 'Policies[?Name==`solo-s3`].Id | [0]' --output text)",
          'aws organizations describe-policy --policy-id $P --query Policy.Content --output text',
          `aws organizations update-policy --policy-id $P --content '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*","ec2:*","cloudwatch:*"],"Resource":"*"}]}'`,
          'aws organizations describe-policy --policy-id $P --query Policy.Content --output text',
        ],
        hints: ['Primero mira qué hay: `aws organizations list-policies --filter SERVICE_CONTROL_POLICY` y `aws organizations describe-policy --policy-id <id> --query Policy.Content --output text` (verás un `Allow` solo de `s3:*`).', 'Una SCP existente se modifica con `aws organizations update-policy --policy-id <id> --content \'{…}\'`: el contenido **sustituye** al anterior, así que incluye `s3:*` además de los servicios nuevos.', 'En el `Allow`, `Action` es una lista: `["s3:*","ec2:*","cloudwatch:*"]`, con `Resource` `*`. Con una lista de permitidos, lo que no aparezca queda denegado (por eso `iam:*` sigue sin poder usarse).'],
        explain: 'Con una **lista de permitidos**, cada servicio nuevo que necesite el equipo hay que añadirlo a la SCP: es más trabajo y más seguro (todo lo que no nombras, no existe). Es el mismo motivo por el que la solución de «poner `FullAWSAccess` otra vez» **resolvería el síntoma pero cambiaría la estrategia**: pasarías a lista de denegados sin darte cuenta. Fíjate también en que `update-policy` **sustituye** el contenido: si omites `s3:*`, lo habrías roto.',
        par: 6,
        commands: ['SCP', 'AWS Organizations'],
      }),
      practice({
        prompt: '**Nadie** puede hacer nada en ninguna cuenta de la organización desde ayer (ni `lab-1` ni `web-prod`). La causa: alguien **quitó `FullAWSAccess` de la raíz** y solo quedó la SCP **`solo-irlanda`**, que únicamente **niega** (no permite nada). Devuelve el servicio **sin quitar la restricción de región**: debe poderse usar S3 en Irlanda, pero **seguir sin poder lanzar instancias en Virginia**.',
        goal: 'Las cuentas vuelven a funcionar en Irlanda y la restricción de región sigue activa',
        setup: A('sec-scp-sinallow'),
        check: all(
          awsIs('_check scp --account lab-1 --action s3:GetObject --context aws:RequestedRegion=eu-west-1 --query Allowed', true, 'lab-1 sigue sin poder usar S3 en Irlanda: falta un Allow en la raíz'),
          awsIs('_check scp --account web-prod --action s3:GetObject --context aws:RequestedRegion=eu-west-1 --query Allowed', true, 'web-prod sigue sin poder usar S3 en Irlanda'),
          awsIs('_check scp --account lab-1 --action ec2:RunInstances --context aws:RequestedRegion=us-east-1 --query Allowed', false, 'La restricción de región debe seguir activa: en Virginia no se puede lanzar nada'),
        ),
        solution: [
          'ROOT=$(aws organizations list-roots --query "Roots[0].Id" --output text)',
          'aws organizations list-policies-for-target --target-id $ROOT --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text',
          'aws organizations attach-policy --policy-id p-FullAWSAccess --target-id $ROOT',
          'aws organizations list-policies-for-target --target-id $ROOT --filter SERVICE_CONTROL_POLICY --query "Policies[].Name" --output text',
        ],
        hints: ['Mira qué SCP tiene la raíz: `aws organizations list-policies-for-target --target-id <raíz> --filter SERVICE_CONTROL_POLICY`. Solo hay un `Deny`: sin ningún `Allow` en ese nivel, todo queda denegado.', 'La SCP que permite todo es la que viene por defecto: se llama `FullAWSAccess` y su identificador es `p-FullAWSAccess`.', 'Vuelve a adjuntarla a la raíz: `aws organizations attach-policy --policy-id p-FullAWSAccess --target-id <id de la raíz>`. `solo-irlanda` se queda donde está.'],
        explain: 'Una SCP de solo `Deny` **no basta**: cada nivel necesita un `Allow` además. Por eso `FullAWSAccess` viene adjunta a todo por defecto, y por eso quitarla sin sustituirla corta el servicio a toda la organización. Es una de las causas más serias de «ha dejado de funcionar todo»: **cambia las SCP de la raíz con mucho cuidado y siempre prueba antes en una OU**.',
        par: 4,
        commands: ['SCP', 'Evaluación de SCP: raíz, unidades y cuenta'],
      }),
      tf('«Una SCP que permite `s3:*` da permiso a todos los usuarios de la cuenta para usar S3.»', false, 'Las SCP nunca conceden permisos: solo fijan el máximo. Para que un usuario use S3 hace falta, además, que IAM se lo permita.'),
      multi('¿Qué afirmaciones sobre las SCP son ciertas? (elige todas las correctas)', ['No afectan a la cuenta de administración de la organización', 'Un Deny en cualquier nivel del camino gana siempre', 'Una SCP puede dar permisos a un usuario que no los tiene en IAM', 'Toda cuenta y unidad nace con FullAWSAccess'], [0, 1, 3], 'La cuenta de administración queda fuera de las SCP; un `Deny` en cualquier nivel prevalece; y `FullAWSAccess` viene por defecto. Lo que una SCP **nunca** hace es conceder permisos.'),
      match(
        'Une cada capa de la defensa en profundidad con su herramienta',
        [
          ['Gobierno de toda la organización', 'SCP'],
          ['Aplicación web', 'WAF'],
          ['Datos en reposo', 'KMS'],
          ['Detección de amenazas', 'GuardDuty'],
        ],
        'Cada capa tiene su herramienta: SCP para el gobierno, WAF para la aplicación, KMS para los datos y GuardDuty para detectar lo que se cuela.',
      ),
    ]),
  ],
  boss: {
    prompt:
      'Misión final: **«La auditoría de seguridad»**. Mañana viene el auditor y tu cuenta de producción no está para enseñarla. **AWS Config ya está grabando** (hace falta para Security Hub), hay un balanceador **`tienda-alb`** con servidores detrás y un bucket **`auditoria-logs`** con la política lista para CloudTrail. Haz lo siguiente: **(1)** **activa Security Hub** y usa sus **controles fallidos** para encontrar los problemas: déjalo **sin ningún control fallido de gravedad ALTA o CRÍTICA** (pista: hay datos de clientes expuestos, un puerto de administración abierto al mundo, ninguna auditoría registrando y ninguna detección activa); **(2)** la clave **`alias/clientes`** debe **rotar sola**; **(3)** el balanceador debe quedar **protegido por WAF** contra la inyección SQL con el grupo gestionado **`AWSManagedRulesSQLiRuleSet`**, sin bloquear la portada. **No borres nada que no tengas que borrar**: los datos de `clientes-datos` tienen que seguir ahí, privados.',
    goal: 'Security Hub sin controles graves fallidos, clave rotando, WAF activo y los datos de clientes intactos y privados',
    setup: A('sec-boss'),
    check: all(
      awsIs('_check securityhub --query Enabled', true, 'Security Hub todavía no está activado'),
      awsIs('_check securityhub --query FailedHigh', [], 'Aún fallan controles de gravedad alta o crítica en Security Hub: mira cuáles con `get-findings` (estado FAILED) y arregla los recursos que señalan'),
      awsIs('kms get-key-rotation-status --key-id alias/clientes --query KeyRotationEnabled', true, 'La clave alias/clientes todavía no rota sola'),
      awsIs(HTTP(SQLI, '--query Status'), 403, 'La inyección SQL llega a la aplicación: asocia al balanceador una ACL con AWSManagedRulesSQLiRuleSet'),
      awsIs(HTTP('/', '--query Status'), 200, 'La portada debería seguir respondiendo 200'),
      awsIs('s3api list-objects-v2 --bucket clientes-datos --query "Contents[].Key"', ['clientes.csv'], 'Los datos de clientes tienen que seguir en el bucket clientes-datos (privado, no borrado)'),
    ),
    solution: [
      'aws securityhub enable-security-hub',
      `aws securityhub get-findings --filters '{"ComplianceStatus":[{"Value":"FAILED","Comparison":"EQUALS"}],"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"}]}' --query "Findings[].[ProductFields.ControlId,Resources[0].Id]" --output text`,
      'aws s3api put-public-access-block --bucket clientes-datos --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
      'aws s3api delete-bucket-policy --bucket clientes-datos',
      'SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text)',
      'aws ec2 revoke-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 0.0.0.0/0',
      'aws guardduty create-detector --enable',
      'aws cloudtrail create-trail --name auditoria --s3-bucket-name auditoria-logs --is-multi-region-trail --enable-log-file-validation',
      'aws cloudtrail start-logging --name auditoria',
      'aws kms enable-key-rotation --key-id alias/clientes',
      SQLI_BLOQUEA,
      'aws wafv2 create-web-acl --name tienda-waf --scope REGIONAL --default-action Allow={} --rules file://reglas.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=tienda-waf',
      'ACL=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].ARN" --output text)',
      'LB=$(aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)',
      'aws wafv2 associate-web-acl --web-acl-arn $ACL --resource-arn $LB',
    ],
    hints: [
      'Empieza por `aws securityhub enable-security-hub` y mira lo que falla: `aws securityhub get-findings --filters \'{"ComplianceStatus":[{"Value":"FAILED","Comparison":"EQUALS"}],"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"}]}\' --query "Findings[].[ProductFields.ControlId,Title,Resources[0].Id]" --output text` (repite con `HIGH`). Cada control dice **qué recurso** falla y cómo arreglarlo.',
      'Los problemas graves: **bucket `clientes-datos` público** (Block Public Access desactivado y una política con `Principal: "*"`: `put-public-access-block` con las cuatro opciones en `true` y `delete-bucket-policy`), **SSH abierto a `0.0.0.0/0` en `web-sg`** (`revoke-security-group-ingress … --port 22`), **sin GuardDuty** (`create-detector --enable`) y **sin trail** (`create-trail --is-multi-region-trail --s3-bucket-name auditoria-logs` + `start-logging`).',
      'La rotación: `aws kms enable-key-rotation --key-id alias/clientes`. El WAF: una ACL regional con una regla `ManagedRuleGroupStatement` (`AWS` / `AWSManagedRulesSQLiRuleSet`, `OverrideAction` `{"None":{}}`), creada con `create-web-acl --rules file://reglas.json` y asociada con `associate-web-acl --web-acl-arn … --resource-arn <ARN del balanceador>`.',
    ],
    explain: 'Has hecho una auditoría de seguridad de principio a fin con lo que aprendiste en la zona: **Security Hub** te dio la lista priorizada (apoyado en **Config**), y cada problema grave pertenecía a una **capa** distinta: **datos** (un bucket público con datos de clientes), **red** (SSH abierto al mundo), **detección** (sin GuardDuty) y **auditoría** (sin un trail multirregión). Además cerraste la **clave** (rotación de KMS) y la **aplicación** (WAF con el grupo de inyección SQL). Fíjate en dos detalles de oficio: no borraste los datos (se **protegen**, no se destruyen) y los controles de gravedad media que quedan (cifrado del trail, SSL obligatorio en los buckets…) son tu lista de trabajo para mañana. **Ninguna capa habría sido suficiente sola; juntas, sí.**',
    commands: ['AWS Security Hub', 'Defensa en profundidad', 'AWS WAF', 'AWS KMS', 'Amazon GuardDuty', 'Qué servicio de seguridad usar'],
  },
});
