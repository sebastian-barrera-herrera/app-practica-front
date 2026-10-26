import { A, all, any, awsEmpty, awsFails, awsHas, awsIs, awsWorld, demo, illus, learn, lesson, match, mc, multi, out, practice, predict, ran, tf, typeCmd } from './awsbuild';

const FILES = {
  '/home/alumno/informe.txt': 'Ventas del trimestre: 1250 unidades\n',
  '/home/alumno/fotos/gato.jpg': { content: 'JPEGDATA', size: 482113 },
  '/home/alumno/fotos/perro.jpg': { content: 'JPEGDATA', size: 311240 },
};
const LIFECYCLE_JSON = '{"Rules":[{"ID":"archivar","Status":"Enabled","Filter":{"Prefix":""},"Transitions":[{"Days":30,"StorageClass":"STANDARD_IA"},{"Days":90,"StorageClass":"GLACIER"}],"Expiration":{"Days":730}}]}';
const HTTPS_ONLY = '{"Version":"2012-10-17","Statement":[{"Sid":"SoloHTTPS","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::privado-demo","arn:aws:s3:::privado-demo/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}';
const PUBLIC_READ = (b: string) => `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::${b}/*"}]}`;

export const a4 = awsWorld({
  id: 'a4',
  index: 4,
  title: 'Almacenamiento: S3 y compañía',
  subtitle: 'Guardar datos sin límite y sin sustos',
  emoji: '🪣',
  color: '#34D399',
  level: 'basico',
  intro:
    'Amazon S3 es el servicio más antiguo y más usado de AWS: un almacén de objetos prácticamente ilimitado, barato y con una durabilidad de once nueves. Sirve para copias de seguridad, imágenes de tu web, registros, datos para análisis… y también protagoniza muchas filtraciones de datos, casi siempre por una configuración descuidada. En esta zona aprenderás a usarlo, a abaratarlo con clases de almacenamiento, a protegerlo bien y a distinguirlo de sus «primos» EBS, EFS y FSx.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a4-1', { title: 'Buckets y objetos', summary: 'Subir, listar, bajar y entender los prefijos', emoji: '🪣', commands: ['S3', 'Bucket', 'aws s3 cp', 'aws s3 ls'], minutes: 12 }, [
      learn(
        'Almacenamiento de objetos',
        `
**Amazon S3** (_Simple Storage Service_) guarda **objetos** dentro de **buckets**:

- **Bucket**: el contenedor. Su nombre es **único en todo el mundo** (entre todos los clientes de AWS), solo admite minúsculas, números, puntos y guiones (3-63 caracteres) y vive en **una región**.
- **Objeto**: un archivo más su **clave** (su «nombre completo», por ejemplo \`fotos/2025/gato.jpg\`) y sus metadatos. Puede pesar hasta **5 TB**.

No hay carpetas de verdad: la \`/\` de la clave es solo un carácter. Lo que parecen carpetas son **prefijos**, y la consola (o \`aws s3 ls\`) los agrupa para que lo veas ordenado.

Datos que conviene saber (y que salen en el examen):

- **Durabilidad de 99,999999999 %** (11 nueves): AWS replica cada objeto en varias zonas de disponibilidad.
- **Consistencia fuerte**: tras subir o borrar un objeto, la siguiente lectura ya ve el cambio.
- Es **almacenamiento de objetos**, no un disco: no se «monta» como una unidad (para eso, EBS o EFS).
`,
        '🪣',
      ),
      mc('En S3, la clave `fotos/2025/gato.jpg` indica que existe una carpeta `fotos` dentro del bucket.', ['Verdadero: S3 tiene carpetas reales', 'Falso: `fotos/2025/` es solo un prefijo de la clave', 'Verdadero, pero solo en us-east-1', 'Falso: las claves no pueden tener barras'], 1, 'S3 es una tienda plana de objetos. Los prefijos con `/` sirven para organizar y para listar por «carpeta», pero no existen como entidad.'),
      learn(
        'Dos familias de comandos',
        `
La CLI ofrece **dos niveles** para S3:

- \`aws s3 …\` (alto nivel): comandos cómodos, parecidos a los de Linux: \`mb\`, \`ls\`, \`cp\`, \`mv\`, \`rm\`, \`sync\`, \`presign\`.
- \`aws s3api …\` (la API completa): una operación por comando (\`list-objects-v2\`, \`put-bucket-policy\`, \`get-public-access-block\`…). Es lo que usas para todo lo que el alto nivel no cubre.

Se combinan sin problema.
`,
        '⌨️',
      ),
      demo(
        'Subir, listar y bajar',
        [
          ['aws s3 mb s3://copia-demo-2026', 'Un bucket nuevo'],
          ['aws s3 cp informe.txt s3://copia-demo-2026/', 'Subimos un archivo (`upload:`)'],
          ['aws s3 cp fotos s3://copia-demo-2026/fotos --recursive', 'Subimos una carpeta entera con `--recursive`'],
          ['aws s3 ls s3://copia-demo-2026/', 'La raíz: un objeto y un prefijo (`PRE fotos/`)'],
          ['aws s3 ls s3://copia-demo-2026/fotos/', 'Dentro del prefijo'],
          ['aws s3api list-objects-v2 --bucket copia-demo-2026 --query "Contents[].[Key,Size]" --output text', 'Con la API completa: las claves reales y su tamaño en bytes'],
          ['aws s3 cp s3://copia-demo-2026/informe.txt descarga.txt', 'Descargar es copiar al revés'],
          ['cat descarga.txt'],
        ],
        A('base', { files: FILES }),
      ),
      predict(
        '¿Cuántos objetos devuelve este comando?',
        'aws s3api list-objects-v2 --bucket fotos-demo --prefix 2025/enero/ --query "length(Contents)" --output text',
        ['1', '3', '4'],
        'Hay dos objetos con el prefijo `2025/enero/` (a.jpg y b.jpg). `c.jpg` está en `2025/febrero/` y `portada.jpg` no tiene ese prefijo.',
        A('s3demo'),
      ),
      typeCmd('Escribe el comando que lista los objetos del bucket `informes-empresa`.', ['aws s3 ls s3://informes-empresa'], 'Con `aws s3 ls s3://bucket` ves los objetos y prefijos de la raíz.', { setup: A('equipo'), check: all(ran('s3 ls'), out('q1.txt')), regex: '^aws s3 ls s3://informes-empresa/?$' }),
      tf('«Una vez subido un objeto a S3, solo puede leerse desde la misma región del bucket.»', false, 'S3 se accede por HTTPS desde cualquier sitio de internet (si los permisos lo permiten). La región solo importa para la latencia, el coste y el cumplimiento.'),
      practice({
        prompt: 'Crea el bucket **`mi-copia-2026`**, sube `informe.txt` a su raíz y la carpeta `fotos` dentro del prefijo **`fotos/`**.',
        goal: 'Bucket con informe.txt y fotos/*.jpg',
        setup: A('base', { files: FILES }),
        check: awsIs('s3api list-objects-v2 --bucket mi-copia-2026 --query "Contents[].Key"', ['fotos/gato.jpg', 'fotos/perro.jpg', 'informe.txt'], 'Faltan objetos en mi-copia-2026'),
        solution: ['aws s3 mb s3://mi-copia-2026', 'aws s3 cp informe.txt s3://mi-copia-2026/', 'aws s3 cp fotos s3://mi-copia-2026/fotos --recursive'],
        hints: ['`aws s3 mb s3://mi-copia-2026` crea el bucket.', '`aws s3 cp informe.txt s3://mi-copia-2026/`', 'Para la carpeta: `aws s3 cp fotos s3://mi-copia-2026/fotos --recursive`.'],
        explain: 'Con `--recursive`, `cp` copia toda la carpeta y la clave de cada archivo conserva su ruta bajo el prefijo `fotos/`.',
        par: 3,
        commands: ['aws s3 cp'],
      }),
      practice({
        prompt: 'En el bucket `informes-empresa` está el informe `q1.txt`. **Muéstralo por pantalla** sin guardarlo en disco (usa `-` como destino).',
        goal: 'Ver el contenido de q1.txt',
        setup: A('equipo'),
        check: out('Informe del primer trimestre'),
        solution: ['aws s3 cp s3://informes-empresa/q1.txt -'],
        hints: ['Descargar es `aws s3 cp s3://… destino`.', 'Si el destino es `-`, el contenido va a la salida estándar.'],
        explain: 'Con `-` como destino, `cp` escribe a la salida estándar, y puedes encadenarlo con `grep`, `head`… como cualquier otro comando.',
        par: 1,
        commands: ['aws s3 ls'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a4-2', { title: 'Clases de almacenamiento y ciclo de vida', summary: 'Pagar menos por lo que casi no usas', emoji: '🧊', commands: ['Clases de almacenamiento', 'Ciclo de vida de S3', 'aws s3api put-bucket-lifecycle-configuration', 'S3 Glacier'], minutes: 13 }, [
      learn(
        'No todos los datos valen lo mismo… ni se leen igual',
        `
S3 ofrece **clases de almacenamiento**: cuanto menos accedes a un dato, más barato es guardarlo, pero más caro (o lento) recuperarlo.

| Clase | Para qué | Recuperación | Duración mínima |
| --- | --- | --- | --- |
| **Standard** | Acceso frecuente | Inmediata | — |
| **Intelligent-Tiering** | No sabes cuánto se usará: S3 lo mueve solo | Inmediata | — |
| **Standard-IA** | Acceso poco frecuente, pero rápido cuando hace falta | Inmediata (con coste por GB recuperado) | 30 días |
| **One Zone-IA** | Igual, en **una sola** zona (más barata, menos resistente) | Inmediata | 30 días |
| **Glacier Instant Retrieval** | Archivo con acceso raro pero inmediato | Milisegundos | 90 días |
| **Glacier Flexible Retrieval** | Archivo | Minutos a horas | 90 días |
| **Glacier Deep Archive** | Archivo a largo plazo, lo más barato | 12–48 horas | 180 días |

Las «IA» también cobran un tamaño mínimo por objeto (128 KB). Los datos se pueden mover de una clase a otra: a mano o con reglas de **ciclo de vida**.
`,
        '🧊',
      ),
      illus('aws-s3-classes', 'Precio de guardar frente a facilidad de recuperar', 'Toca una clase: cuanto más barata de guardar, más cuesta o tarda recuperar.'),
      match(
        'Une cada situación con la clase más adecuada',
        [
          ['Imágenes de tu web, visitadas todo el día', 'Standard'],
          ['No sabes qué datos se usarán y cuáles no', 'Intelligent-Tiering'],
          ['Copias de seguridad que casi nunca se leen pero deben estar disponibles al momento', 'Standard-IA'],
          ['Registros de auditoría a guardar 7 años', 'Glacier Deep Archive'],
        ],
        'Frecuente → Standard; incierto → Intelligent-Tiering; raro pero urgente → IA; archivo de años → Deep Archive.',
      ),
      mc('Quieres guardar durante 10 años documentos legales que probablemente no se leerán nunca y, si hiciera falta, pueden esperar un día. ¿Qué clase eliges?', ['Standard', 'Standard-IA', 'Glacier Deep Archive', 'One Zone-IA'], 2, 'Deep Archive es la más barata para archivo a largo plazo; la recuperación tarda hasta 48 horas.'),
      learn(
        'Ciclo de vida: que S3 lo haga solo',
        `
Una **regla de ciclo de vida** mueve o borra objetos según su antigüedad:

- **Transition**: pasa a otra clase tras N días.
- **Expiration**: borra el objeto tras N días.
- También sobre **versiones antiguas** (\`NoncurrentVersion…\`) y para limpiar subidas multiparte incompletas.

\`\`\`
{
  "Rules": [{
    "ID": "archivar",
    "Status": "Enabled",
    "Filter": { "Prefix": "" },
    "Transitions": [
      { "Days": 30, "StorageClass": "STANDARD_IA" },
      { "Days": 90, "StorageClass": "GLACIER" }
    ],
    "Expiration": { "Days": 730 }
  }]
}
\`\`\`

Reglas de sentido común que S3 comprueba: a Standard-IA no se pasa antes de los 30 días, y la expiración debe llegar **después** de las transiciones.
`,
        '⏳',
      ),
      demo(
        'Aplicar una regla de ciclo de vida',
        [
          ['cat ciclo.json', 'La regla en un archivo'],
          ['aws s3api put-bucket-lifecycle-configuration --bucket logs-app --lifecycle-configuration file://ciclo.json', 'La aplicamos al bucket de registros'],
          ['aws s3api get-bucket-lifecycle-configuration --bucket logs-app --query "Rules[0].Transitions[].[Days,StorageClass]" --output text', 'Comprobamos las transiciones'],
          ['aws s3 cp s3://logs-app/archivo/viejo.txt .', 'Un objeto archivado en Glacier no se puede leer sin restaurarlo antes', 'error'],
        ],
        A('s3demo', { files: { '/home/alumno/ciclo.json': LIFECYCLE_JSON } }),
      ),
      predict(
        '¿A qué clases pasan los objetos de este bucket, y en ese orden?',
        'aws s3api get-bucket-lifecycle-configuration --bucket logs-viejos --query "Rules[0].Transitions[].StorageClass" --output text',
        ['STANDARD_IA', 'GLACIER STANDARD_IA', 'GLACIER'],
        'Primero a `STANDARD_IA` (30 días) y después a `GLACIER` (90 días).',
        A('s3demo'),
      ),
      tf('«Un objeto en la clase Glacier Deep Archive se puede descargar al instante.»', false, 'Hay que **restaurarlo** primero (12 a 48 horas con Deep Archive). Si lo necesitas rápido, usa Glacier Instant Retrieval.'),
      practice({
        prompt:
          'Ahorra en el bucket **`logs-app`**: crea una regla de ciclo de vida activa que pase los objetos a **`GLACIER`** a los **60 días** y los **borre a los 180**. (Usa `"Filter": {"Prefix": ""}` para que afecte a todo el bucket.)',
        goal: 'Regla: GLACIER a 60 días y expiración a 180',
        setup: A('s3demo'),
        check: awsIs('s3api get-bucket-lifecycle-configuration --bucket logs-app --query "Rules[0].[Status,Transitions[0].Days,Transitions[0].StorageClass,Expiration.Days]"', ['Enabled', 60, 'GLACIER', 180], 'La regla no coincide: Enabled, GLACIER a 60 días, expiración a 180'),
        solution: [
          `echo '{"Rules":[{"ID":"archivar","Status":"Enabled","Filter":{"Prefix":""},"Transitions":[{"Days":60,"StorageClass":"GLACIER"}],"Expiration":{"Days":180}}]}' > ciclo.json`,
          'aws s3api put-bucket-lifecycle-configuration --bucket logs-app --lifecycle-configuration file://ciclo.json',
        ],
        hints: ['Escribe el JSON con `echo \'{…}\' > ciclo.json` o directamente en `--lifecycle-configuration \'{…}\'`.', 'La estructura: `Rules[0]` con `Status`, `Filter`, `Transitions` y `Expiration`.', 'Aplícala con `aws s3api put-bucket-lifecycle-configuration --bucket logs-app --lifecycle-configuration file://ciclo.json`.'],
        explain: 'Con la regla, S3 archiva y limpia sin que nadie tenga que acordarse. Ojo: los objetos que pasan a Glacier ya no son de lectura inmediata.',
        par: 2,
        commands: ['Ciclo de vida de S3', 'aws s3api put-bucket-lifecycle-configuration'],
      }),
      practice({
        prompt: 'Sube el archivo `copia.zip` al bucket `logs-app` indicando desde el principio la clase **`STANDARD_IA`**.',
        goal: 'copia.zip en STANDARD_IA',
        setup: A('s3demo', { files: { '/home/alumno/copia.zip': 'ZIPDATA' } }),
        check: awsIs('s3api head-object --bucket logs-app --key copia.zip --query StorageClass', 'STANDARD_IA', 'copia.zip debe estar en STANDARD_IA'),
        solution: ['aws s3 cp copia.zip s3://logs-app/ --storage-class STANDARD_IA'],
        hints: ['`aws s3 cp archivo s3://bucket/ --storage-class <clase>`'],
        explain: 'Con `--storage-class` eliges la clase al subir; sin ella, el objeto entra en Standard.',
        par: 1,
        commands: ['Clases de almacenamiento', 'S3 Glacier'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a4-3', { title: 'Seguridad en S3', summary: 'Block Public Access, políticas, cifrado y URLs prefirmadas', emoji: '🔒', commands: ['Block Public Access', 'Política de bucket', 'Cifrado en S3', 'URL prefirmada', 'aws s3api put-bucket-policy', 'aws s3 presign'], minutes: 16 }, [
      learn(
        'Las capas que protegen un bucket',
        `
Los buckets de S3 son **privados por defecto**. Las filtraciones suceden cuando alguien los abre sin querer. Estas son las capas de control:

1. **Block Public Access (BPA)**: cuatro interruptores por bucket (y por cuenta) que impiden el acceso público **aunque** una política o ACL lo permita. Los buckets nuevos nacen con todo activado.
2. **Políticas de IAM** (identidad): lo que puede hacer cada usuario o rol.
3. **Política de bucket** (recurso): un JSON en el bucket que dice quién (_Principal_) puede hacer qué. Sirve para dar acceso a otras cuentas o a todo el mundo.
4. **ACL**: mecanismo antiguo, **desactivado** por defecto en buckets nuevos (propiedad del bucket = _BucketOwnerEnforced_). Evítalas.
5. **URLs prefirmadas**: enlaces temporales para leer (o subir) un objeto privado sin dar acceso permanente.

Dentro de la misma cuenta basta con que **IAM o la política del bucket** lo permita (y ningún Deny lo impida). Para el acceso **anónimo** (sin credenciales) hace falta una política pública **y** que BPA no la bloquee.
`,
        '🔒',
      ),
      illus('aws-s3-security', '¿Quién puede leer este objeto?', 'Juega con los interruptores y con el tipo de petición.'),
      mc('Un bucket tiene una política con `Principal: "*"` (público) pero Block Public Access está activado. ¿Puede un usuario anónimo leer los objetos?', ['Sí, la política lo permite', 'No: Block Public Access lo bloquea', 'Solo desde la región del bucket', 'Sí, si usa HTTPS'], 1, 'BPA es un interruptor maestro que anula el efecto público de políticas y ACL. Por eso las filtraciones empiezan casi siempre desactivándolo.'),
      learn(
        'Cifrado',
        `
- **En reposo**: todos los objetos nuevos se cifran por defecto con **SSE-S3** (claves gestionadas por S3, AES-256), sin coste. Alternativas: **SSE-KMS** (claves de AWS KMS: control y auditoría en CloudTrail, con coste por petición) y **SSE-C** (la clave la aportas tú en cada petición).
- **En tránsito**: HTTPS. Puedes **obligarlo** con una política de bucket que deniegue las peticiones donde \`aws:SecureTransport\` sea \`false\`.

\`\`\`
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::mi-bucket", "arn:aws:s3:::mi-bucket/*"],
  "Condition": { "Bool": { "aws:SecureTransport": "false" } }
}
\`\`\`
`,
        '🗝️',
      ),
      demo(
        'Privado por defecto, compartido con control',
        [
          ['aws s3api get-public-access-block --bucket privado-demo --query PublicAccessBlockConfiguration', 'Los cuatro bloqueos, activados'],
          ['aws s3api get-bucket-encryption --bucket privado-demo --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm" --output text', 'Cifrado por defecto: AES256 (SSE-S3)'],
          ['curl -s https://privado-demo.s3.amazonaws.com/informe.txt', 'Desde internet, sin credenciales: Access Denied'],
          ['aws s3api put-bucket-policy --bucket privado-demo --policy \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::privado-demo/*"}]}\'', 'Hacerlo público a lo bruto: BPA lo impide', 'error'],
          ['URL=$(aws s3 presign s3://privado-demo/informe.txt --expires-in 300)', 'Una URL prefirmada: da acceso temporal a ESE objeto (5 minutos)'],
          ['curl -s "$URL"', 'Con la URL, el objeto se descarga sin credenciales'],
        ],
        A('s3demo'),
      ),
      predict(
        '¿Qué algoritmo de cifrado tiene por defecto un bucket recién creado?',
        'aws s3api get-bucket-encryption --bucket privado-demo --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm" --output text',
        ['aws:kms', 'ninguno', 'AES128'],
        'Desde 2023 todos los objetos nuevos se cifran con SSE-S3 (AES-256) automáticamente.',
        A('s3demo'),
      ),
      multi(
        'Marca las formas **seguras** de dar acceso temporal a un objeto privado a alguien sin cuenta de AWS.',
        ['Generar una URL prefirmada con caducidad corta', 'Desactivar Block Public Access y hacer público todo el bucket', 'Darle las claves de acceso de tu usuario', 'Compartir el objeto detrás de CloudFront con acceso firmado'],
        [0, 3],
        'Prefirmada o contenido firmado: acceso acotado en el tiempo y al objeto. Nunca compartas claves ni abras el bucket entero.',
      ),
      practice({
        prompt: 'Obliga a usar **HTTPS** en el bucket `privado-demo`: aplica una política de bucket con un **Deny** de `s3:*` para cualquier `Principal` cuando `aws:SecureTransport` sea `"false"`.',
        goal: 'Política que deniega peticiones sin HTTPS',
        setup: A('s3demo'),
        check: all(awsHas('s3api get-bucket-policy --bucket privado-demo --query Policy --output text', 'aws:SecureTransport', 'Falta la condición aws:SecureTransport'), awsHas('s3api get-bucket-policy --bucket privado-demo --query Policy --output text', '"Effect":"Deny"', 'La sentencia debe ser un Deny')),
        solution: [`aws s3api put-bucket-policy --bucket privado-demo --policy '${HTTPS_ONLY}'`],
        hints: ['`aws s3api put-bucket-policy --bucket privado-demo --policy \'{…}\'`', 'El `Resource` debe incluir el bucket y `arn:aws:s3:::privado-demo/*`.', 'La condición es `"Condition": {"Bool": {"aws:SecureTransport": "false"}}`.'],
        explain: 'Un Deny con condición es la forma de imponer reglas obligatorias (HTTPS, cifrado, MFA…): gana siempre sobre cualquier Allow.',
        par: 1,
        commands: ['Política de bucket', 'aws s3api put-bucket-policy'],
      }),
      practice({
        prompt: 'Genera una **URL prefirmada** de **10 minutos** (600 segundos) para el objeto `informe.txt` del bucket `privado-demo`.',
        goal: 'URL prefirmada con X-Amz-Expires=600',
        setup: A('s3demo'),
        check: all(ran('s3 presign'), out('X-Amz-Expires=600')),
        solution: ['aws s3 presign s3://privado-demo/informe.txt --expires-in 600'],
        hints: ['`aws s3 presign s3://bucket/clave`', 'La caducidad en segundos: `--expires-in 600`.'],
        explain: 'La URL incluye la firma y la caducidad. Quien la tenga puede descargar el objeto hasta que expire, o hasta que la clave del firmante deje de valer.',
        par: 1,
        commands: ['URL prefirmada', 'aws s3 presign'],
      }),
      practice({
        prompt: 'Cambia el cifrado por defecto del bucket `privado-demo` a **SSE-KMS** (`aws:kms`), con `BucketKeyEnabled` activado para reducir costes.',
        goal: 'Cifrado por defecto aws:kms',
        setup: A('s3demo'),
        check: awsIs('s3api get-bucket-encryption --bucket privado-demo --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm"', 'aws:kms', 'El cifrado por defecto debe ser aws:kms'),
        solution: [`aws s3api put-bucket-encryption --bucket privado-demo --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"},"BucketKeyEnabled":true}]}'`],
        hints: ['`aws s3api put-bucket-encryption --bucket … --server-side-encryption-configuration \'{…}\'`', 'Dentro: `Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm = "aws:kms"`.'],
        explain: 'SSE-KMS añade control (quién puede usar la clave) y auditoría (cada uso queda en CloudTrail). La _bucket key_ reduce las llamadas a KMS y, con ellas, el coste.',
        par: 1,
        commands: ['Cifrado en S3'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a4-4', { title: 'Versionado, replicación y web estática', summary: 'Recuperar borrados, copiar entre regiones y publicar una web', emoji: '🔁', commands: ['Versionado de S3', 'Replicación de S3', 'Sitio web estático en S3', 'aws s3api put-bucket-versioning', 'aws s3 website'], minutes: 15 }, [
      learn(
        'Versionado: la máquina del tiempo de S3',
        `
Con el **versionado** activado, S3 conserva **todas las versiones** de cada objeto:

- Subir un objeto con la misma clave **no sobrescribe**: crea una versión nueva (con su \`VersionId\`).
- **Borrar** un objeto (sin indicar versión) no lo elimina: añade un **marcador de borrado** que lo oculta. Para recuperarlo basta con **borrar el marcador**.
- Borrar una **versión concreta** (con \`--version-id\`) sí la elimina para siempre.

Detalles: una vez activado, el versionado solo se puede **suspender**, no volver a «no versionado». Cada versión se factura, así que conviene una regla de ciclo de vida que borre las versiones antiguas.
`,
        '⏪',
      ),
      mc('En un bucket con versionado activado, ejecutas `aws s3 rm s3://bucket/informe.txt`. ¿Qué ocurre?', ['El objeto se elimina para siempre', 'Se crea un marcador de borrado: el objeto queda oculto pero sus versiones siguen ahí', 'Falla: no se permite borrar', 'Se borra solo la última versión'], 1, 'Sin `--version-id`, S3 solo añade un marcador de borrado. Se puede recuperar el objeto eliminando ese marcador.'),
      demo(
        'Subir dos veces, borrar y recuperar',
        [
          ['aws s3 mb s3://tiempo-demo-2026', 'Un bucket nuevo'],
          ['aws s3api put-bucket-versioning --bucket tiempo-demo-2026 --versioning-configuration Status=Enabled', 'Activamos el versionado'],
          ['echo "primera versión" > nota.txt && aws s3 cp nota.txt s3://tiempo-demo-2026/'],
          ['echo "segunda versión" > nota.txt && aws s3 cp nota.txt s3://tiempo-demo-2026/', 'Misma clave: no sobrescribe, crea otra versión'],
          ['aws s3api list-object-versions --bucket tiempo-demo-2026 --query "Versions[].[VersionId,IsLatest]" --output text', 'Dos versiones; solo una es la última'],
          ['aws s3 rm s3://tiempo-demo-2026/nota.txt', 'Borrado "normal": crea un marcador'],
          ['aws s3 ls s3://tiempo-demo-2026/', 'El objeto ya no aparece…'],
          ['aws s3api list-object-versions --bucket tiempo-demo-2026 --query "DeleteMarkers[].[Key,IsLatest]" --output text', '…pero hay un marcador de borrado'],
        ],
        A('base'),
      ),
      practice({
        prompt: 'Alguien borró **`contrato.pdf`** del bucket versionado **`documentos`**. **Recupéralo**: elimina el marcador de borrado para que vuelva a aparecer en el listado.',
        goal: 'contrato.pdf vuelve a estar en documentos',
        setup: A('s3versiones'),
        check: awsHas('s3api list-objects-v2 --bucket documentos --query "Contents[].Key"', 'contrato.pdf', 'contrato.pdf sigue oculto por el marcador de borrado'),
        solution: ['VID=$(aws s3api list-object-versions --bucket documentos --prefix contrato.pdf --query "DeleteMarkers[0].VersionId" --output text)', 'aws s3api delete-object --bucket documentos --key contrato.pdf --version-id $VID'],
        hints: ['Mira los marcadores con `aws s3api list-object-versions --bucket documentos`.', 'Se elimina con `aws s3api delete-object --bucket documentos --key contrato.pdf --version-id <id del marcador>`.'],
        explain: 'Borrar el marcador «deshace» el borrado: la última versión real vuelve a ser la actual. Es la gran ventaja del versionado frente a errores humanos.',
        par: 2,
        commands: ['Versionado de S3', 'aws s3api put-bucket-versioning'],
      }),
      learn(
        'Replicación entre buckets',
        `
La **replicación** copia automáticamente los objetos **nuevos** de un bucket a otro:

- **CRR** (_Cross-Region_): a otra región. Para recuperación ante desastres, menor latencia o cumplimiento.
- **SRR** (_Same-Region_): a otro bucket de la misma región (por ejemplo, para otra cuenta).

Requisitos: **versionado activado en origen y destino** y un **rol de IAM** que permita replicar. Solo se replican los objetos creados **después** de activar la regla (los anteriores, con _Batch Replication_).
`,
        '🌍',
      ),
      mc('¿Qué debe estar activado en los buckets de origen y destino para poder configurar la replicación?', ['Block Public Access', 'El versionado', 'El sitio web estático', 'La clase Glacier'], 1, 'La replicación trabaja con versiones, así que ambos buckets deben tener el versionado activado.'),
      learn(
        'Alojar una web estática',
        `
Un bucket puede servir una **web estática** (HTML, CSS, JS, imágenes) sin ningún servidor:

1. Activa el **alojamiento de sitio web** con documento de índice (\`index.html\`) y, opcionalmente, de error.
2. Los objetos deben poder leerse públicamente: desactivar el bloqueo de políticas públicas y aplicar una política de lectura. Esto es lo que muchos tutoriales enseñan… y es **un riesgo**: cualquier objeto nuevo queda público.
3. El endpoint del sitio web de S3 **solo habla HTTP**. Para **HTTPS**, dominio propio y mejor rendimiento se pone **CloudFront** delante.

> TIP: La opción moderna y segura es dejar el bucket **privado** y servirlo con **CloudFront + OAC** (_Origin Access Control_): solo CloudFront puede leerlo, y tu web tiene HTTPS.
`,
        '🌐',
      ),
      tf('«El endpoint de sitio web de S3 (`bucket.s3-website-…`) sirve las páginas por HTTPS directamente.»', false, 'Solo usa HTTP. Para HTTPS se coloca Amazon CloudFront delante.'),
      practice({
        prompt:
          'Publica **`index.html`** como sitio web estático en un bucket llamado **`mi-sitio-2026`**:\n\n1. Crea el bucket y sube `index.html`.\n2. Actívale el alojamiento de sitio web con `index.html` como documento de índice.\n3. Desactiva el bloqueo de **políticas públicas** (`BlockPublicPolicy` y `RestrictPublicBuckets` a `false`).\n4. Aplica una política que permita a todos `s3:GetObject` sobre `mi-sitio-2026/*`.\n5. Comprueba con `curl` la dirección `http://mi-sitio-2026.s3-website-us-east-1.amazonaws.com/`.',
        goal: 'Sitio web estático funcionando',
        setup: A('base', { files: { '/home/alumno/index.html': '<h1>Mi sitio en S3</h1>\n' } }),
        check: all(awsIs('s3api get-bucket-website --bucket mi-sitio-2026 --query IndexDocument.Suffix', 'index.html', 'Falta activar el sitio web con index.html'), out('Mi sitio en S3')),
        solution: [
          'aws s3 mb s3://mi-sitio-2026',
          'aws s3 cp index.html s3://mi-sitio-2026/',
          'aws s3 website s3://mi-sitio-2026/ --index-document index.html',
          'aws s3api put-public-access-block --bucket mi-sitio-2026 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false',
          `aws s3api put-bucket-policy --bucket mi-sitio-2026 --policy '${PUBLIC_READ('mi-sitio-2026')}'`,
          'curl -s http://mi-sitio-2026.s3-website-us-east-1.amazonaws.com/',
        ],
        hints: ['`aws s3 website s3://mi-sitio-2026/ --index-document index.html`', 'Antes de poder poner una política pública hay que quitar `BlockPublicPolicy` con `put-public-access-block`.', 'La política: `Effect Allow`, `Principal "*"`, `Action s3:GetObject`, `Resource arn:aws:s3:::mi-sitio-2026/*`.'],
        explain: 'Funciona, pero deja el bucket legible por cualquiera. En producción es mejor CloudFront con OAC y el bucket privado.',
        par: 6,
        commands: ['Sitio web estático en S3', 'aws s3 website'],
      }),
      practice({
        prompt: 'Prepara la replicación: activa el **versionado** en el bucket **`origen-2026`** (ya existe).',
        goal: 'Versionado activado en origen-2026',
        setup: A('base'),
        check: awsIs('s3api get-bucket-versioning --bucket origen-2026 --query Status', 'Enabled', 'El versionado de origen-2026 debe estar Enabled'),
        solution: ['aws s3 mb s3://origen-2026', 'aws s3api put-bucket-versioning --bucket origen-2026 --versioning-configuration Status=Enabled'],
        hints: ['El bucket aún no existe en esta cuenta de práctica: créalo con `aws s3 mb`.', '`aws s3api put-bucket-versioning --bucket … --versioning-configuration Status=Enabled`'],
        explain: 'Con el versionado activo en origen y destino ya podrías crear la regla de replicación con `put-bucket-replication`.',
        par: 2,
        commands: ['Replicación de S3'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a4-5', { title: 'EBS, EFS, FSx y Storage Gateway: cuál usar', summary: 'Elegir el almacenamiento adecuado para cada caso', emoji: '🗂️', commands: ['Elegir almacenamiento', 'EFS', 'FSx', 'Storage Gateway', 'AWS Backup'], minutes: 11 }, [
      learn(
        'Tres tipos de almacenamiento',
        `
AWS ofrece muchos servicios de almacenamiento porque hay tres **formas** de guardar datos:

- **Bloque** (_block_): un disco crudo que un servidor formatea y monta. → **EBS**, instance store.
- **Archivos** (_file_): un sistema de archivos de red que varios servidores comparten. → **EFS** (Linux, NFS), **FSx** (Windows SMB, Lustre, NetApp ONTAP, OpenZFS).
- **Objetos** (_object_): archivos + metadatos accedidos por HTTP con una API, sin montar nada. → **S3**.

Y para **conectar tu centro de datos** con la nube: **Storage Gateway** (puertas de enlace que presentan S3/EBS como NAS, volúmenes o cintas), **DataSync** y **Transfer Family** para mover datos, y la familia **Snow** para transportarlos físicamente cuando no hay ancho de banda.
`,
        '🗂️',
      ),
      learn(
        'La tabla de decisión',
        `
| Necesito… | Elijo |
| --- | --- |
| Disco de arranque o de datos de **una** instancia EC2 | **EBS** |
| Sistema de archivos **compartido** por muchas instancias Linux | **EFS** |
| Servidor de archivos **Windows** (SMB, Active Directory) | **FSx for Windows File Server** |
| Rendimiento extremo para HPC o machine learning | **FSx for Lustre** |
| Guardar copias, imágenes, logs, datos para análisis, web estática | **S3** |
| Que mis servidores locales vean S3 como un NAS | **Storage Gateway (File Gateway)** |
| Copias de seguridad centralizadas y con políticas | **AWS Backup** |
| Mover terabytes sin red suficiente | **Snowball / Snow Family** |
`,
        '🧭',
      ),
      match(
        'Une cada necesidad con el servicio',
        [
          ['Disco de una instancia EC2', 'EBS'],
          ['Archivos compartidos para flotas de servidores Linux', 'EFS'],
          ['Archivos para servidores Windows con SMB', 'FSx for Windows'],
          ['Objetos accesibles por HTTP, ilimitados y baratos', 'S3'],
        ],
        'Bloque → EBS; archivos Linux compartidos → EFS; archivos Windows → FSx; objetos → S3.',
      ),
      mc('Varios servidores Linux de una aplicación web necesitan leer y escribir los **mismos archivos** a la vez. ¿Qué eliges?', ['EBS', 'EFS', 'Instance store', 'Glacier'], 1, 'EFS es un sistema de archivos NFS compartido y elástico. Un volumen EBS solo se conecta a una instancia (salvo Multi-Attach en casos concretos).'),
      mc('Tu empresa quiere que sus oficinas vean un bucket de S3 como una carpeta de red (NAS) con caché local. ¿Qué usarías?', ['AWS Backup', 'Storage Gateway (File Gateway)', 'EBS Multi-Attach', 'DataSync'], 1, 'File Gateway expone S3 como recurso compartido SMB/NFS con caché local en tu centro de datos.'),
      tf('«Un volumen EBS puede conectarse a instancias EC2 de cualquier zona de disponibilidad de la región.»', false, 'EBS vive en una zona y solo se conecta a instancias de esa misma zona. Para moverlo: snapshot y nuevo volumen en la otra zona.'),
      learn(
        'Orden en tu cuenta: el almacenamiento huérfano también cobra',
        `
Es muy habitual olvidar discos EBS sueltos (**\`available\`**: no conectados a nada) tras terminar instancias o hacer pruebas. Siguen cobrando cada mes. Un repaso periódico del estado **\`available\`** y de los snapshots antiguos es una de las formas más rápidas de ahorrar.

\`\`\`
aws ec2 describe-volumes --filters Name=status,Values=available \\
  --query "Volumes[].[VolumeId,Size]" --output text
\`\`\`
`,
        '🧹',
      ),
      practice({
        prompt: 'Haz limpieza de **almacenamiento huérfano**: elimina todos los volúmenes EBS que estén en estado `available` (no conectados a ninguna instancia). No toques los que sí están en uso.',
        goal: 'Sin volúmenes available y el volumen en uso sigue ahí',
        setup: A('huerfanos'),
        check: all(awsEmpty('ec2 describe-volumes --filters Name=status,Values=available --query "Volumes[].VolumeId"', 'Todavía quedan volúmenes sin usar'), awsIs('ec2 describe-volumes --filters Name=status,Values=in-use --query "length(Volumes)"', 3, 'Has borrado un volumen que estaba en uso')),
        solution: ['for V in $(aws ec2 describe-volumes --filters Name=status,Values=available --query "Volumes[].VolumeId" --output text); do aws ec2 delete-volume --volume-id $V; done'],
        hints: ['Lista los `available`: `aws ec2 describe-volumes --filters Name=status,Values=available`.', 'Bórralos de uno en uno con `aws ec2 delete-volume --volume-id <id>` (o con un bucle `for`).'],
        explain: 'Antes de borrar un volumen, asegúrate de que no lo necesitas (o haz un snapshot). Etiquetar los recursos ayuda mucho a saber de quién son.',
        par: 3,
        commands: ['EBS', 'Elegir almacenamiento'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Auditoría urgente: el bucket **`documentos-rrhh`** (nóminas y contratos) está **abierto a todo internet** y sin protección. Arréglalo:\n\n1. **Elimina la política de bucket** pública.\n2. Activa **Block Public Access** completo (los cuatro bloqueos a `true`).\n3. Activa el **versionado**.\n4. Añade una regla de ciclo de vida: pasar a **`GLACIER`** a los **180 días**.',
    goal: 'Bucket de RR. HH. cerrado, versionado y con ciclo de vida',
    setup: A('s3fugas'),
    check: all(
      any(awsFails('s3api get-bucket-policy-status --bucket documentos-rrhh'), awsIs('s3api get-bucket-policy-status --bucket documentos-rrhh --query PolicyStatus.IsPublic', false)),
      awsIs('s3api get-public-access-block --bucket documentos-rrhh --query "PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]"', [true, true, true, true], 'Los cuatro bloqueos deben estar a true'),
      awsIs('s3api get-bucket-versioning --bucket documentos-rrhh --query Status', 'Enabled', 'Falta activar el versionado'),
      awsIs('s3api get-bucket-lifecycle-configuration --bucket documentos-rrhh --query "Rules[0].Transitions[0].[Days,StorageClass]"', [180, 'GLACIER'], 'Falta la regla: GLACIER a 180 días'),
    ),
    solution: [
      'aws s3api delete-bucket-policy --bucket documentos-rrhh',
      'aws s3api put-public-access-block --bucket documentos-rrhh --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
      'aws s3api put-bucket-versioning --bucket documentos-rrhh --versioning-configuration Status=Enabled',
      `aws s3api put-bucket-lifecycle-configuration --bucket documentos-rrhh --lifecycle-configuration '{"Rules":[{"ID":"archivar","Status":"Enabled","Filter":{"Prefix":""},"Transitions":[{"Days":180,"StorageClass":"GLACIER"}]}]}'`,
    ],
    hints: [
      'Primero cierra la fuga: `delete-bucket-policy` y `put-public-access-block` con los cuatro valores a `true`.',
      'Después `put-bucket-versioning --versioning-configuration Status=Enabled`.',
      'La regla de ciclo de vida lleva `Status`, `Filter` (con `Prefix` vacío) y `Transitions` con `Days` 180 y `StorageClass` GLACIER.',
    ],
    explain: 'Cerrar el acceso público, protegerse contra borrados con versionado y abaratar el histórico con ciclo de vida: la receta básica para un bucket con datos sensibles.',
    commands: ['Block Public Access', 'Versionado de S3', 'Ciclo de vida de S3'],
  },
});
