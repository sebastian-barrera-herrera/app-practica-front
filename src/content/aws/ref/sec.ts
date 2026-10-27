import type { AwsRef } from '../reference';

export const AWS_REF_SEC: AwsRef[] = [
  // ───────────────────────── KMS ─────────────────────────
  {
    name: 'AWS KMS',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'El servicio de claves de cifrado de AWS: crea y guarda las claves en equipos protegidos, cifra y descifra con ellas sin que la clave salga nunca en claro, y deja un rastro en CloudTrail de cada uso.',
    details: `
KMS (Key Management Service) es el sitio donde viven las **claves de cifrado** de casi todos los servicios de AWS (S3, EBS, RDS, Secrets Manager, Lambda…). La clave **nunca sale de KMS en claro**: le mandas los datos (hasta 4 KB) y te devuelve el resultado, o le pides una *clave de datos* para cifrar tú objetos grandes (cifrado de sobre).

- Una **clave de KMS** (antes «CMK») tiene identificador, ARN, una **política de clave** y, opcionalmente, **alias** (\`alias/datos-clientes\`), **concesiones** (grants) y **rotación**.
- **Quién la puede usar** se decide con la política de la clave, que manda sobre IAM: si la política no «activa» IAM, un permiso de IAM por sí solo no basta.
- Cada uso (\`Encrypt\`, \`Decrypt\`, \`GenerateDataKey\`…) queda en **CloudTrail**: sabes quién descifró qué y cuándo.
- Se puede **desactivar** una clave (reversible) o **programar su borrado** (7–30 días de espera). Borrarla de verdad deja **ilegible todo lo que cifraste con ella**.

Lo que **no** es: no guarda tus datos ni tus contraseñas (eso es S3 o Secrets Manager); guarda las claves que los protegen.
`,
    whenUse: ['Cifrar en reposo S3, EBS, RDS, DynamoDB, secretos…', 'Controlar y auditar quién puede descifrar unos datos concretos', 'Cifrar pequeños secretos o claves de datos en tu aplicación'],
    whenNot: ['Para cifrar ficheros grandes directamente (usa cifrado de sobre)', 'Si necesitas que la clave esté en un equipo tuyo bajo tu control físico exclusivo (CloudHSM)', 'Para guardar contraseñas de aplicaciones (Secrets Manager)'],
    pricing: 'Cada clave gestionada por ti cuesta 1 $ al mes (más por las versiones rotadas) y cada 10 000 peticiones cuestan unos céntimos. Las claves administradas por AWS (`aws/s3`, `aws/ebs`…) no tienen cuota mensual.',
    limits: ['Cifrar directamente: hasta 4 KB de datos', 'Espera de borrado: de 7 a 30 días', 'La política de clave puede pesar hasta 32 KB'],
    versus: [
      ['CloudHSM', 'KMS es gestionado y comparte infraestructura (con aislamiento); CloudHSM te da un HSM dedicado bajo tu control exclusivo, para requisitos regulatorios estrictos.'],
      ['Cifrar en la aplicación con una librería', 'Funciona, pero tienes que guardar y proteger la clave tú. KMS la guarda por ti y audita cada uso.'],
    ],
    scenario: 'sec-kms-s3',
    examples: [
      ['aws kms list-aliases --query "Aliases[].AliasName"', 'Las claves con nombre (aquí, la tuya)'],
      ['aws kms describe-key --key-id alias/datos-clientes --query KeyMetadata.[KeyManager,KeyState,Origin]', 'Una clave de cliente, activa'],
      ['aws kms encrypt --key-id alias/datos-clientes --plaintext "$(echo -n hola | base64)" --query CiphertextBlob --output text', 'Cifra (el texto va en base64)'],
      ['aws kms get-key-rotation-status --key-id alias/datos-clientes', 'La rotación está apagada por defecto'],
    ],
    seeAlso: ['Claves de KMS: administradas y propias', 'Cifrado de sobre (envelope encryption)', 'Política de clave y concesiones (grants)', 'Cifrado en reposo y en tránsito'],
  },
  {
    name: 'Claves de KMS: administradas y propias',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Hay claves administradas por AWS (gratis, la política es de AWS y no la puedes tocar) y claves gestionadas por ti (1 $/mes, tú decides política, rotación, alias y quién las usa).',
    details: `
| | Administrada por AWS | Gestionada por el cliente |
| --- | --- | --- |
| Quién la crea | El servicio, la primera vez que la usas (\`aws/s3\`, \`aws/ebs\`) | Tú (\`create-key\`) |
| Política | La fija AWS: solo la usa el servicio en tu cuenta | La escribes tú |
| Coste | Gratis | 1 $/mes + peticiones |
| Rotación | Automática anual, no configurable | Opcional (\`enable-key-rotation\`) |
| Compartir con otra cuenta | No | Sí |
| Borrarla / desactivarla | No | Sí |

Úsala **propia** cuando necesites: compartir datos cifrados con **otra cuenta**, restringir descifrado a **ciertos roles**, poder **desactivar** la clave de golpe (cortar el acceso), o requisitos de **cumplimiento**.

La clave administrada por AWS es un buen punto de partida (cifras sin hacer nada), pero **no te deja controlar quién descifra**: cualquiera con acceso al bucket lee los objetos.
`,
    whenUse: ['Clave propia: datos sensibles, acceso entre cuentas, control fino y auditoría', 'Clave de AWS: cifrado por defecto sin complicaciones'],
    whenNot: ['Una clave propia por cada objeto o usuario (inmanejable: usa claves de datos o contexto de cifrado)'],
    pricing: 'Propia: 1 $/mes por clave. De AWS: sin cuota.',
    scenario: 'sec-kms-s3',
    examples: [
      ['aws kms describe-key --key-id alias/datos-clientes --query KeyMetadata.KeyManager', 'CUSTOMER: la gestionas tú'],
      ['aws s3api put-bucket-encryption --bucket informes-clientes --server-side-encryption-configuration \'{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}\'', 'Sin indicar clave usa la administrada por AWS (aws/s3)'],
      ['aws kms list-aliases --query "Aliases[].AliasName"', 'Ahora aparece también alias/aws/s3'],
    ],
    seeAlso: ['AWS KMS', 'Cifrado en S3'],
  },
  {
    name: 'Cifrado de sobre (envelope encryption)',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Para cifrar datos grandes no se mandan a KMS: se le pide una clave de datos, se cifra localmente con ella y se guarda la clave de datos cifrada junto a los datos. KMS solo abre la «llave pequeña».',
    details: `
KMS solo cifra hasta **4 KB** y no es buena idea mandarle gigas por la red. La solución es el **cifrado de sobre**:

1. Pides una **clave de datos** con \`GenerateDataKey\`: KMS te devuelve la clave **en claro** y **cifrada** con tu clave de KMS.
2. Cifras tu fichero **localmente** con la clave en claro (AES-256) y **la olvidas** de memoria.
3. Guardas junto al fichero la **clave de datos cifrada**.
4. Para descifrar: mandas la clave de datos cifrada a KMS (\`Decrypt\`), recibes la clave en claro y descifras tú el fichero.

Ventajas: los datos grandes nunca viajan a KMS, cada fichero puede tener **su propia clave de datos**, y **para revocar el acceso basta con negar \`kms:Decrypt\`** sobre la clave: sin poder abrir la «llave pequeña», los datos son inservibles.

S3 (SSE-KMS), EBS, RDS… lo hacen por ti con este mismo esquema.
`,
    whenUse: ['Cifrar ficheros o mensajes grandes en tu aplicación', 'Entender qué hacen S3, EBS y RDS por dentro'],
    whenNot: ['Para datos de menos de 4 KB (cifra directamente con `Encrypt`)'],
    scenario: 'sec-kms-s3',
    examples: [
      ['aws kms generate-data-key --key-id alias/datos-clientes --key-spec AES_256 --query "[KeyId]" --output text', 'KMS devuelve la clave de datos (en claro y cifrada); aquí solo vemos con qué clave se cifró'],
      ['aws kms generate-data-key-without-plaintext --key-id alias/datos-clientes --key-spec AES_256 --query KeyId --output text', 'Solo la versión cifrada (para guardarla y pedir la clave en claro más tarde)'],
    ],
    seeAlso: ['AWS KMS', 'Contexto de cifrado'],
  },
  {
    name: 'Política de clave y concesiones (grants)',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'La política de la clave es el control principal de KMS: sin ella (o sin que active IAM) nadie la usa. Las concesiones dan permisos temporales y revocables a un principal concreto.',
    details: `
En KMS hay **tres maneras** de dar acceso a una clave:

1. **Política de clave** (siempre existe). Si incluye la sentencia que da \`kms:*\` a la **raíz de la cuenta**, «delega» en IAM: entonces los permisos de IAM también funcionan. Si **no** la incluye, solo valen las sentencias de la propia política.
2. **Políticas de IAM**, siempre que la política de clave lo permita (delegación a IAM).
3. **Concesiones** (\`create-grant\`): permisos concretos (\`Decrypt\`, \`GenerateDataKey\`…) para un principal, con **restricciones** (contexto de cifrado) y que se pueden **retirar** (\`revoke-grant\`, \`retire-grant\`). Las usan los servicios de AWS (EBS, RDS…) y las aplicaciones que dan acceso temporal.

⚠️ **Trampa clásica:** un administrador de la clave **no** puede usarla para descifrar si la política no se lo concede, y una aplicación con \`kms:Decrypt\` en IAM **no** puede usar una clave cuya política no activa IAM ni la nombra. **Separar administración y uso** es una buena práctica: quien administra no descifra, quien descifra no administra.

Entre cuentas: la política de la clave tiene que permitir a la **otra cuenta**, y esa cuenta tiene que dar permiso a sus usuarios en IAM (dos llaves).
`,
    whenUse: ['Separar administradores de usuarios de la clave', 'Dar acceso temporal con una concesión que se pueda retirar', 'Compartir una clave con otra cuenta'],
    whenNot: ['Dar `kms:*` sobre `*` a una aplicación: solo necesita Decrypt/GenerateDataKey sobre su clave'],
    scenario: 'sec-kms-politica',
    examples: [
      ['aws kms get-key-policy --key-id alias/pagos --policy-name default --query Policy --output text', 'Solo nombra a un administrador: no hay delegación a IAM'],
      ['aws kms list-grants --key-id alias/pagos --query "length(Grants)"', 'Ninguna concesión todavía'],
      ['aws kms list-key-policies --key-id alias/pagos --query PolicyNames', 'Solo existe la política "default"'],
    ],
    seeAlso: ['AWS KMS', 'Mínimo privilegio', 'Política de IAM'],
  },
  {
    name: 'Contexto de cifrado',
    kind: 'concepto',
    category: 'seguridad',
    level: 3,
    summary: 'Pares clave=valor no secretos que atas al cifrado: para descifrar hay que presentar el mismo contexto. Sirve para que un texto cifrado solo se abra «en su sitio» y queda registrado en CloudTrail.',
    details: `
El **contexto de cifrado** es un conjunto de pares (\`app=tienda\`, \`pedido=1234\`) que se pasa a \`Encrypt\`/\`GenerateDataKey\` y **debe ser idéntico** en \`Decrypt\`. No es secreto (aparece en CloudTrail), pero:

- Es **autenticación adicional**: si alguien copia el texto cifrado a otro contexto, no se abre (\`InvalidCiphertextException\`).
- Permite **condiciones** en políticas (\`kms:EncryptionContext:app\` = \`tienda\`) para que una aplicación solo descifre lo suyo.
- Deja un rastro útil en **CloudTrail** («¿para qué pedido se descifró esto?»).

S3 usa el ARN del objeto o del bucket como contexto; EBS, el id del volumen.
`,
    whenUse: ['Atar un texto cifrado a un pedido, un usuario o una aplicación', 'Políticas que limitan qué contexto puede descifrar cada rol'],
    whenNot: ['No pongas secretos en el contexto: se ve en los registros'],
    scenario: 'sec-kms-s3',
    examples: [
      ['aws kms encrypt --key-id alias/datos-clientes --plaintext "$(echo -n hola | base64)" --encryption-context app=tienda --query CiphertextBlob --output text > cifrado.txt', 'Cifra con contexto app=tienda'],
      ['aws kms decrypt --ciphertext-blob "$(cat cifrado.txt)" --encryption-context app=tienda --query Plaintext --output text', 'Con el mismo contexto se abre'],
      ['aws kms decrypt --ciphertext-blob "$(cat cifrado.txt)" --encryption-context app=otra', 'Con otro contexto, no', 'error'],
    ],
    seeAlso: ['AWS KMS', 'Política de clave y concesiones (grants)'],
  },
  {
    name: 'Rotación de claves de KMS',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'Cambiar el material criptográfico de una clave cada cierto tiempo. En KMS es automática y transparente: el identificador no cambia y lo cifrado antes sigue abriéndose.',
    details: `
Con \`enable-key-rotation\` KMS genera un **material nuevo** cada año (configurable de 90 a 2560 días) y lo usa para cifrar de ahí en adelante. Lo cifrado con material anterior se sigue descifrando: KMS guarda todas las versiones. **No hay que re-cifrar nada** ni cambiar el ARN.

- Solo claves **simétricas** de cliente. Las administradas por AWS rotan solas.
- **Rotar no es lo mismo que cambiar de clave:** si se filtra la clave, rotar no protege lo ya cifrado con material antiguo (por eso hay controles de Security Hub y Config que exigen rotación como higiene, no como remedio).
- La **rotación bajo demanda** (\`rotate-key-on-demand\`) crea material nuevo ya.
- Cuesta: cada versión de material rotada añade una pequeña cuota mensual.
`,
    whenUse: ['Cumplir políticas de higiene criptográfica (PCI, CIS, FSBP piden rotación)', 'Limitar el volumen de datos cifrado con un mismo material'],
    whenNot: ['No sustituye a cambiar de clave si crees que ha sido comprometida'],
    pricing: 'Cada versión de material rotada añade una cuota mensual pequeña.',
    scenario: 'sec-kms-s3',
    examples: [
      ['aws kms enable-key-rotation --key-id alias/datos-clientes --rotation-period-in-days 180', 'Rotación cada 180 días'],
      ['aws kms get-key-rotation-status --key-id alias/datos-clientes --query [KeyRotationEnabled,RotationPeriodInDays]', 'Activada'],
      ['aws kms rotate-key-on-demand --key-id alias/datos-clientes --query KeyId --output text', 'Material nuevo ahora mismo'],
    ],
    seeAlso: ['AWS KMS', 'Rotación de secretos'],
  },
  {
    name: 'Cifrado en reposo y en tránsito',
    kind: 'buena práctica',
    category: 'seguridad',
    level: 1,
    summary: 'En reposo: los datos guardados (discos, buckets, bases de datos) van cifrados con claves de KMS. En tránsito: la conexión usa TLS (HTTPS) para que nadie lea ni cambie los datos por el camino.',
    details: `
Hay dos momentos en los que un dato puede ser leído por quien no debe:

| | Qué protege | Cómo en AWS |
| --- | --- | --- |
| **En reposo** | Que alguien con acceso al disco, a una copia o a un backup lea los datos | KMS: S3 (SSE-S3 / SSE-KMS), EBS, RDS, DynamoDB, EFS… |
| **En tránsito** | Que alguien en la red lea o modifique la comunicación | TLS: certificados de **ACM** en ALB, CloudFront y API Gateway; condición \`aws:SecureTransport\` en políticas de bucket |

Buenas prácticas:

- **Cifra siempre en reposo** (hoy S3 ya lo hace por defecto con SSE-S3; elige SSE-KMS si necesitas controlar quién descifra).
- **Fuerza HTTPS**: redirige HTTP→HTTPS en el balanceador y añade a los buckets una sentencia \`Deny\` cuando \`aws:SecureTransport\` es \`false\`.
- **Cifrado de extremo a extremo** cuando el balanceador termina TLS pero los datos son muy sensibles: vuelve a cifrar hasta el destino.
- Cifrar **no sustituye** a los permisos: un usuario con permiso de lectura y de la clave lee el dato en claro.
`,
    whenUse: ['Siempre: es el mínimo de cualquier producción'],
    whenNot: ['Pensar que «cifrado» significa «seguro»: sin control de acceso, el cifrado solo protege del robo del medio'],
    scenario: 'sec-kms-s3',
    examples: [
      ['aws s3api get-bucket-encryption --bucket informes-clientes --query ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm --output text', 'Hoy todos los buckets cifran por defecto (AES256 = SSE-S3)'],
      ['aws ec2 get-ebs-encryption-by-default --query EbsEncryptionByDefault', 'El cifrado por defecto de EBS está apagado en esta región'],
      ['aws ec2 enable-ebs-encryption-by-default --query EbsEncryptionByDefault', 'Se enciende para todos los volúmenes nuevos'],
    ],
    seeAlso: ['AWS KMS', 'Cifrado en S3', 'EBS'],
  },
  {
    name: 'aws kms encrypt',
    kind: 'comando',
    category: 'seguridad',
    level: 2,
    summary: 'Cifra hasta 4 KB con una clave de KMS y devuelve el texto cifrado (`CiphertextBlob`, en base64). `aws kms decrypt` hace lo contrario; el contexto de cifrado tiene que coincidir.',
    usage: 'aws kms encrypt --key-id alias/mi-clave --plaintext fileb://dato.txt [--encryption-context k=v] --query CiphertextBlob --output text',
    details: `
- \`--plaintext\` espera **base64** por defecto en la CLI v2: o lo pasas codificado (\`$(echo -n hola | base64)\`), o lees un fichero binario con \`fileb://fichero\` (que se envía tal cual).
- \`CiphertextBlob\` sale en base64; para guardarlo en bruto: \`| base64 --decode > dato.cifrado\` y para descifrar \`--ciphertext-blob fileb://dato.cifrado\`.
- \`decrypt\` no necesita \`--key-id\`: el texto cifrado ya dice con qué clave se hizo (pero tu identidad debe poder usar esa clave).
- \`Plaintext\` también vuelve en base64: \`... --query Plaintext --output text | base64 --decode\`.
`,
    scenario: 'sec-kms-s3',
    examples: [
      ['echo -n "clave-de-la-caja-fuerte" > secreto.txt'],
      ['aws kms encrypt --key-id alias/datos-clientes --plaintext fileb://secreto.txt --query CiphertextBlob --output text | base64 --decode > secreto.cifrado', 'Cifra el fichero y guarda el resultado en bruto'],
      ['aws kms decrypt --ciphertext-blob fileb://secreto.cifrado --query Plaintext --output text | base64 --decode', 'Vuelve a salir el texto original'],
      ['aws kms encrypt --key-id alias/no-existe --plaintext "$(echo -n x | base64)"', 'La clave tiene que existir', 'error'],
    ],
    seeAlso: ['AWS KMS', 'Contexto de cifrado', 'Cifrado de sobre (envelope encryption)'],
  },

  // ───────────────────────── Secrets Manager ─────────────────────────
  {
    name: 'Rotación de secretos',
    kind: 'concepto',
    category: 'seguridad',
    level: 3,
    summary: 'Secrets Manager puede cambiar solo la contraseña cada cierto tiempo con una función Lambda en cuatro pasos (createSecret, setSecret, testSecret, finishSecret), sin parar la aplicación.',
    details: `
La rotación automática funciona así:

1. Secrets Manager invoca a tu **función de rotación** con \`Step\` = \`createSecret\`: genera la contraseña nueva y la guarda como versión **\`AWSPENDING\`**.
2. \`setSecret\`: la función **cambia la contraseña en la base de datos** (o el servicio de terceros).
3. \`testSecret\`: comprueba que la contraseña nueva funciona.
4. \`finishSecret\`: mueve la etiqueta **\`AWSCURRENT\`** a la versión nueva (la antigua queda como \`AWSPREVIOUS\`).

Detalles que hay que cuidar:

- La función necesita el permiso **\`lambda:InvokeFunction\`** para el servicio \`secretsmanager.amazonaws.com\` (política de recursos de la función) y un rol con acceso al secreto y a la clave KMS.
- La aplicación debe **leer el secreto en cada arranque o con caché corta**, no copiarlo: si no, tras rotar queda con la contraseña vieja. (Con *dos usuarios alternos* se evita el corte: mientras uno rota, el otro sigue válido.)
- Para RDS, Aurora y Redshift AWS ofrece funciones de rotación ya hechas.
- Si una rotación falla, el secreto sigue con la versión actual (\`AWSCURRENT\`) y se puede reintentar: mira los registros de la función.
`,
    whenUse: ['Credenciales de bases de datos y servicios externos que deben cambiar periódicamente', 'Cumplir requisitos de rotación (PCI, ISO 27001)'],
    whenNot: ['Contraseñas que no puedas cambiar sin tocar el código de la aplicación (primero arregla la lectura del secreto)'],
    scenario: 'sec-secreto',
    examples: [
      ['aws lambda get-function-configuration --function-name rotar-db --query [Runtime,Timeout] --output text', 'La función de rotación ya está desplegada'],
      [`aws secretsmanager create-secret --name tienda/db --secret-string '{"username":"app","password":"inicial"}' --query Name --output text`, 'El secreto con la contraseña actual'],
      ['aws secretsmanager rotate-secret --secret-id tienda/db --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:rotar-db --rotation-rules AutomaticallyAfterDays=30', 'Sin permiso de invocación, Secrets Manager no puede llamar a la función', 'error'],
      ['aws lambda add-permission --function-name rotar-db --statement-id secretsmanager --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com --query Statement --output text', 'El permiso que faltaba'],
      ['aws secretsmanager rotate-secret --secret-id tienda/db --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:rotar-db --rotation-rules AutomaticallyAfterDays=30 --query Name --output text', 'Ahora sí'],
    ],
    seeAlso: ['AWS Secrets Manager', 'aws secretsmanager rotate-secret', 'Rol de ejecución y política de recursos'],
  },
  {
    name: 'Secrets Manager frente a Parameter Store',
    kind: 'comparativa',
    category: 'seguridad',
    level: 2,
    summary: 'Los dos guardan valores cifrados; Secrets Manager está pensado para secretos que se rotan, Parameter Store para configuración (barata o gratuita).',
    details: `
| | Secrets Manager | Parameter Store |
| --- | --- | --- |
| Pensado para | Contraseñas, claves de API, tokens | Configuración (URL, flags) y secretos sencillos |
| Rotación automática | **Sí** (Lambda; RDS integrado) | No |
| Cifrado | Siempre con KMS | \`SecureString\` con KMS (opcional) |
| Versiones y etapas | Sí (\`AWSCURRENT\`, \`AWSPREVIOUS\`) | Versiones numéricas |
| Política de recursos / entre cuentas | Sí | Solo parámetros avanzados |
| Réplica entre regiones | Sí | No |
| Coste | ≈ 0,40 $/secreto/mes + llamadas | Gratis (estándar) o ≈ 0,05 $ (avanzado) |
| Tamaño | 64 KB | 4 KB (estándar) / 8 KB (avanzado) |

Regla práctica: **si tiene que rotar o se comparte entre cuentas, Secrets Manager**; si es configuración o un secreto que casi no cambia y quieres ahorrar, **Parameter Store SecureString**.
`,
    whenUse: ['Secrets Manager: credenciales de BD rotadas, tokens de terceros', 'Parameter Store: configuración por entorno, flags, secretos estáticos'],
    whenNot: ['Guardar secretos en variables de entorno de Lambda o en el código: acaban en repositorios y registros'],
    seeAlso: ['AWS Secrets Manager', 'Parameter Store'],
  },
  {
    name: 'aws secretsmanager rotate-secret',
    kind: 'comando',
    category: 'seguridad',
    level: 3,
    summary: 'Configura (o lanza ahora) la rotación automática de un secreto con una función Lambda y una periodicidad en días.',
    usage: 'aws secretsmanager rotate-secret --secret-id tienda/db --rotation-lambda-arn <arn> --rotation-rules AutomaticallyAfterDays=30',
    details: `
- La función necesita permiso de invocación para \`secretsmanager.amazonaws.com\` (\`aws lambda add-permission\`); si no, el error dice que *Ensure that the function policy grants access to the principal secretsmanager.amazonaws.com*.
- Al configurarla se hace una **primera rotación inmediata** (salvo \`--no-rotate-immediately\`).
- \`--rotation-rules AutomaticallyAfterDays=N\` acepta de 1 a 1000 días; \`cancel-rotate-secret\` la apaga.
- \`describe-secret\` muestra \`RotationEnabled\`, \`LastRotatedDate\` y \`VersionIdsToStages\`.
`,
    scenario: 'sec-secreto',
    examples: [
      [`aws secretsmanager create-secret --name tienda/db --secret-string '{"username":"app","password":"inicial"}' --query Name --output text`],
      ['aws lambda add-permission --function-name rotar-db --statement-id secretsmanager --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com --query Statement --output text'],
      ['aws secretsmanager rotate-secret --secret-id tienda/db --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:rotar-db --rotation-rules AutomaticallyAfterDays=30 --query Name --output text', 'Configura y rota ahora'],
      ['aws secretsmanager describe-secret --secret-id tienda/db --query [RotationEnabled,RotationRules.AutomaticallyAfterDays] --output text', 'Activada, cada 30 días'],
    ],
    seeAlso: ['Rotación de secretos', 'AWS Secrets Manager'],
  },

  // ───────────────────────── ACM ─────────────────────────
  {
    name: 'AWS Certificate Manager (ACM)',
    kind: 'servicio',
    category: 'seguridad',
    level: 2,
    summary: 'Emite certificados TLS públicos gratuitos, los renueva solos y los instala en balanceadores, CloudFront y API Gateway. La clave privada nunca sale de AWS.',
    details: `
Un certificado TLS permite a los navegadores comprobar que hablan con **tu** dominio y cifra la conexión (HTTPS). Con ACM:

- Pides el certificado (\`request-certificate\`) con el dominio principal y nombres alternativos (\`tienda.es\`, \`*.tienda.es\`).
- **Demuestras que el dominio es tuyo** (validación por **DNS**: un registro CNAME en Route 53; o por correo).
- Lo usas en un **oyente HTTPS** del ALB, una distribución de CloudFront o API Gateway. **No puedes descargar** la clave privada (si necesitas el certificado en una instancia EC2, usa Let's Encrypt o ACM Private CA con exportación).
- Dura **13 meses** y se **renueva solo** si sigue en uso y la validación DNS sigue publicada.

⚠️ Detalles que muerden:
- El certificado es **regional**: para un ALB tiene que estar en la **misma región**; para CloudFront, en **us-east-1**.
- Un comodín \`*.tienda.es\` cubre **un solo nivel** (\`www.tienda.es\`, no \`a.b.tienda.es\`) y **no** cubre el dominio desnudo (\`tienda.es\`): pide los dos nombres.
- Un certificado importado no se renueva solo.
`,
    whenUse: ['HTTPS en ALB, CloudFront y API Gateway sin gestionar certificados a mano', 'Renovación automática sin sustos de caducidad'],
    whenNot: ['Instalar el certificado en un servidor propio (no se puede exportar un certificado público de ACM)', 'Certificados de validación extendida (EV)'],
    pricing: 'Los certificados públicos son gratuitos. La CA privada (ACM Private CA) tiene cuota mensual.',
    limits: ['Validez de 13 meses con renovación automática', 'Hasta 10 nombres por certificado (ampliable)'],
    versus: [['Let\'s Encrypt', 'También gratuito, pero renuevas e instalas tú (certbot); ACM lo hace solo, solo dentro de servicios de AWS.']],
    scenario: 'sec-acm',
    examples: [
      ['aws acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS --query CertificateArn --output text', 'Pide el certificado para el dominio y su comodín'],
      ['aws acm list-certificates --query "CertificateSummaryList[].[DomainName,Status]" --output text', 'Pendiente de validar hasta que exista el registro DNS'],
      ['aws acm describe-certificate --certificate-arn $(aws acm list-certificates --query "CertificateSummaryList[0].CertificateArn" --output text) --query Certificate.DomainValidationOptions[0].ResourceRecord', 'El CNAME que hay que publicar (es el mismo para tienda.test y *.tienda.test)'],
    ],
    seeAlso: ['Validación de dominio en ACM', 'Elastic Load Balancing', 'CloudFront', 'Cifrado en reposo y en tránsito'],
  },
  {
    name: 'Validación de dominio en ACM',
    kind: 'concepto',
    category: 'seguridad',
    level: 2,
    summary: 'ACM emite el certificado solo cuando demuestras que controlas el dominio. Con DNS basta con publicar un CNAME que ACM te da; si el registro desaparece, el certificado deja de renovarse.',
    details: `
Dos métodos:

- **DNS (recomendado):** ACM te da un registro **CNAME** (\`_abc….tienda.es\` → \`_def….acm-validations.aws.\`). Lo creas en la zona pública de Route 53 y ACM lo detecta en minutos. **Un solo registro** vale para el dominio y su comodín, y vale para **todas las renovaciones**.
- **Correo:** ACM escribe a direcciones estándar del dominio (\`admin@\`, \`postmaster@\`…) y hay que pulsar un enlace **en cada renovación**.

Estados: \`PENDING_VALIDATION\` → \`ISSUED\`. Si no validas en **72 horas**, la solicitud pasa a \`VALIDATION_TIMED_OUT\` y hay que pedirla de nuevo.

⚠️ **Mantén el CNAME** mientras uses el certificado: borrarlo (por «limpiar») impide la renovación automática y dentro de ~13 meses el sitio mostrará un error de certificado caducado.

Si la zona está en Route 53 de **la misma cuenta**, la consola ofrece «crear el registro» con un clic; por CLI lo haces con \`change-resource-record-sets\`.
`,
    whenUse: ['Siempre DNS si el dominio está en Route 53 (o en cualquier DNS donde puedas crear un CNAME)'],
    whenNot: ['Validación por correo en sistemas automatizados: exige una persona en cada renovación'],
    scenario: 'sec-acm',
    examples: [
      ['CERT=$(aws acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS --query CertificateArn --output text)'],
      ['aws acm describe-certificate --certificate-arn $CERT --query Certificate.Status --output text', 'PENDING_VALIDATION'],
      ['aws acm describe-certificate --certificate-arn $CERT --query "Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]" --output text', 'Nombre y valor del CNAME'],
    ],
    seeAlso: ['AWS Certificate Manager (ACM)', 'Registros DNS', 'Route 53'],
  },
];
