import type { AwsRef } from '../reference';

export const AWS_REF_S3: AwsRef[] = [
  {
    name: 'aws s3 mb',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Crea un bucket (`make bucket`). El nombre debe ser único en todo AWS y el bucket vive en una región.',
    usage: 'aws s3 mb s3://nombre-del-bucket [--region eu-west-1]',
    details: `
Reglas del nombre: entre 3 y 63 caracteres, solo minúsculas, números, puntos y guiones, y empezar y terminar por letra o número.

Los buckets nuevos nacen con **Block Public Access** activado, ACL desactivadas y cifrado SSE-S3.
`,
    examples: [
      ['aws s3 mb s3://mi-bucket-de-prueba-2026'],
      ['aws s3 mb s3://MiBucket', 'Las mayúsculas no valen en el nombre', 'error'],
    ],
    seeAlso: ['aws s3api get-public-access-block', 'Elegir una región'],
  },
  {
    name: 'aws s3api get-public-access-block',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Muestra los cuatro interruptores de Block Public Access de un bucket (acls, política, ignorar y restringir).',
    usage: 'aws s3api get-public-access-block --bucket <nombre>',
    examples: [['aws s3 mb s3://ejemplo-bpa-2026'], ['aws s3api get-public-access-block --bucket ejemplo-bpa-2026']],
    seeAlso: ['aws s3 mb', 'Responsabilidad compartida'],
  },
  {
    name: 'S3',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 1,
    summary: 'Almacenamiento de objetos prácticamente ilimitado, con durabilidad de 99,999999999 % (11 nueves) y acceso por HTTPS desde cualquier lugar.',
    details: `
Guardas **objetos** (archivos de hasta 5 TB más sus metadatos) en **buckets**. No hay carpetas reales: la \`/\` de la clave es solo un carácter y los «directorios» son **prefijos**.

- **Consistencia fuerte**: tras escribir o borrar, la siguiente lectura ya ve el cambio.
- **Privado por defecto**: Block Public Access activado y cifrado SSE-S3 en todo objeto nuevo.
- Varias **clases de almacenamiento** según la frecuencia de acceso, **ciclo de vida**, **versionado**, **replicación**, notificaciones de eventos, sitio web estático…
- Es la base de casi todo: _data lakes_, copias de seguridad, registros, imágenes de aplicaciones, artefactos de despliegue.
`,
    whenUse: ['Copias de seguridad y archivado', 'Imágenes, vídeos y descargas de una aplicación', 'Registros y datos para análisis (Athena, EMR, Redshift Spectrum)', 'Webs estáticas (mejor con CloudFront delante)'],
    whenNot: ['Un disco para una instancia EC2 → EBS', 'Sistema de archivos compartido con bloqueos POSIX → EFS (Linux) o FSx', 'Base de datos transaccional → RDS, Aurora o DynamoDB', 'Muchas escrituras diminutas que modifican partes de un archivo: S3 reescribe el objeto entero'],
    pricing: 'Por GB almacenado al mes (según la clase), por peticiones (PUT/GET…), por recuperación en las clases de archivo y por transferencia de datos hacia internet (la entrada es gratis). Gran parte de la factura suele ser el almacenamiento: elige bien la clase.',
    limits: ['Objeto: hasta 5 TB (una sola subida PUT: 5 GB; usa subida multiparte por encima)', 'Hasta 100 buckets por cuenta por defecto (ampliable)', 'Sin límite de objetos por bucket'],
    versus: [
      ['S3 frente a EBS', 'S3: objetos accesibles por HTTP, sin montar. EBS: disco de bloque para una instancia, de baja latencia.'],
      ['S3 frente a EFS', 'EFS es un sistema de archivos NFS compartido (más caro por GB). S3 es mucho más barato para datos que no necesitan semántica de archivo.'],
    ],
    scenario: 's3demo',
    examples: [['aws s3 ls', 'Los buckets de la cuenta de práctica'], ['aws s3 ls s3://fotos-demo --recursive', 'Todos los objetos de un bucket']],
    seeAlso: ['Bucket', 'Clases de almacenamiento', 'Block Public Access', 'Versionado de S3', 'Elegir almacenamiento'],
  },
  {
    name: 'Bucket',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Contenedor de objetos de S3. Su nombre es único en todo AWS y vive en una región.',
    details: `
- Nombre: 3-63 caracteres, minúsculas, números, puntos y guiones; empieza y acaba por letra o número.
- **Global en nombre, regional en datos**: dos clientes no pueden tener el mismo nombre, pero los objetos se guardan solo en la región elegida (y no salen de ella salvo que tú lo pidas).
- El nombre forma parte de la URL: \`https://mi-bucket.s3.eu-west-1.amazonaws.com/clave\`.
- Para borrar un bucket debe estar **vacío** (con versionado, incluidas las versiones y los marcadores de borrado).
`,
    whenUse: ['Un bucket por aplicación o entorno, con un prefijo por tipo de dato', 'Separar buckets cuando necesitas políticas, cifrado o regiones distintas'],
    whenNot: ['No pongas datos sensibles en el nombre del bucket (es visible en las URLs)', 'Evita un bucket por usuario: usa prefijos y políticas'],
    scenario: 's3demo',
    examples: [['aws s3api list-buckets --query "Buckets[].Name" --output text'], ['aws s3api get-bucket-location --bucket fotos-demo']],
    seeAlso: ['S3', 'aws s3 mb', 'Elegir una región'],
  },
  {
    name: 'aws s3 cp',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Copia archivos entre tu disco y S3 (en cualquier sentido) o entre buckets. Con `--recursive` copia carpetas enteras.',
    usage: 'aws s3 cp <origen> <destino> [--recursive] [--storage-class <clase>] [--exclude "*.log"] [--include "*.txt"] [--dryrun]',
    details: `
Cualquiera de los dos lados puede ser \`s3://bucket/clave\`. Con \`-\` como origen o destino se usa la entrada o salida estándar, y puedes combinarlo con pipes.

\`--dryrun\` muestra qué haría sin copiar nada.
`,
    scenario: 's3demo',
    examples: [
      ['echo "hola" > saludo.txt && aws s3 cp saludo.txt s3://fotos-demo/notas/'],
      ['aws s3 cp s3://fotos-demo/notas/saludo.txt -', 'A la salida estándar'],
      ['aws s3 cp s3://fotos-demo/ ./bajada --recursive --dryrun', 'Simulacro: solo lista lo que copiaría'],
    ],
    seeAlso: ['aws s3 ls', 'aws s3 sync', 'Clases de almacenamiento'],
  },
  {
    name: 'aws s3 sync',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Sincroniza una carpeta con un prefijo de S3 copiando solo lo que ha cambiado. Con `--delete` también borra lo que sobra en el destino.',
    usage: 'aws s3 sync <origen> <destino> [--delete] [--exclude "…"] [--dryrun]',
    details: 'Compara tamaño y fecha de modificación. Es ideal para copias de seguridad incrementales y para publicar una web estática. **Usa `--dryrun` antes de `--delete`.**',
    scenario: 's3demo',
    examples: [['mkdir docs && echo uno > docs/a.txt && echo dos > docs/b.txt'], ['aws s3 sync docs s3://fotos-demo/docs'], ['aws s3 sync docs s3://fotos-demo/docs', 'La segunda vez no hay nada que copiar']],
    seeAlso: ['aws s3 cp', 'aws s3 ls'],
  },
  {
    name: 'aws s3 ls',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Lista buckets, o los objetos y prefijos de un bucket. Con `--recursive` baja por los prefijos; con `--human-readable --summarize` resume tamaños.',
    usage: 'aws s3 ls [s3://bucket[/prefijo/]] [--recursive] [--human-readable] [--summarize]',
    scenario: 's3demo',
    examples: [['aws s3 ls'], ['aws s3 ls s3://fotos-demo/'], ['aws s3 ls s3://fotos-demo --recursive --human-readable --summarize']],
    seeAlso: ['aws s3 cp', 'S3'],
  },
  {
    name: 'Clases de almacenamiento',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Cada objeto de S3 tiene una clase: cuanto menos accedes, más barato es guardarlo y más cuesta (o tarda) recuperarlo.',
    details: `
| Clase | Uso | Recuperación |
| --- | --- | --- |
| **Standard** | Acceso frecuente | Inmediata |
| **Intelligent-Tiering** | Patrón desconocido: mueve solo | Inmediata |
| **Standard-IA** | Poco frecuente, 3 zonas | Inmediata (+ cuota por GB) |
| **One Zone-IA** | Poco frecuente, 1 zona | Inmediata (+ cuota por GB) |
| **Glacier Instant Retrieval** | Archivo, acceso rarísimo | Milisegundos |
| **Glacier Flexible Retrieval** | Archivo | Minutos a horas |
| **Glacier Deep Archive** | Archivo largo plazo | 12-48 horas |

Duraciones mínimas de cobro: 30 días (IA), 90 (Glacier IR y Flexible), 180 (Deep Archive). Tamaño mínimo facturable de 128 KB en las IA.
`,
    whenUse: ['Standard: webs, aplicaciones, análisis', 'Intelligent-Tiering: cuando no sabes el patrón de acceso', 'IA: copias y datos antiguos que a veces se necesitan ya', 'Glacier / Deep Archive: archivo y cumplimiento normativo'],
    whenNot: ['No pongas datos que se leen a diario en Glacier: las recuperaciones cuestan y tardan', 'No pongas objetos diminutos en IA (se facturan como 128 KB)'],
    pricing: 'Precio por GB/mes decreciente desde Standard hasta Deep Archive; a cambio suben el coste de recuperación y las duraciones mínimas.',
    versus: [
      ['Intelligent-Tiering frente a reglas de ciclo de vida', 'Intelligent-Tiering se adapta al acceso real (con una pequeña cuota de supervisión); el ciclo de vida mueve por antigüedad, sin mirar el uso.'],
      ['One Zone-IA frente a Standard-IA', 'One Zone-IA guarda en una sola zona de disponibilidad (más barata), así que si esa zona se pierde, pierdes los datos.'],
    ],
    scenario: 's3demo',
    examples: [['echo datos > copia.zip && aws s3 cp copia.zip s3://logs-app/ --storage-class STANDARD_IA'], ['aws s3api head-object --bucket logs-app --key copia.zip --query StorageClass', 'La clase del objeto'], ['aws s3api list-objects-v2 --bucket logs-app --query "Contents[].[Key,StorageClass]" --output table']],
    seeAlso: ['Ciclo de vida de S3', 'S3 Glacier', 'S3'],
  },
  {
    name: 'S3 Glacier',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 2,
    summary: 'Familia de clases de S3 para archivo a largo plazo: Instant Retrieval, Flexible Retrieval y Deep Archive.',
    details: `
Los objetos en Flexible Retrieval y Deep Archive **no se pueden leer directamente**: hay que lanzar una **restauración** (\`aws s3api restore-object\`) y esperar. Opciones de velocidad: _Expedited_ (minutos), _Standard_ (horas), _Bulk_ (el más barato, más lento).

Glacier Instant Retrieval sí devuelve el objeto en milisegundos, con precio de almacenamiento bajo y coste de recuperación más alto.
`,
    whenUse: ['Archivos legales y contables que se conservan años', 'Copias de seguridad de largo plazo', 'Datos de medios o científicos que se guardan «por si acaso»'],
    whenNot: ['Datos a los que accederás con frecuencia o con urgencia (salvo Instant Retrieval)', 'Objetos muy pequeños: la sobrecarga de metadatos los encarece'],
    pricing: 'Muy barato por GB almacenado; se pagan las restauraciones, las peticiones y una duración mínima (90-180 días). Borrar antes de ese plazo cobra los días restantes.',
    versus: [['Glacier frente a Standard-IA', 'IA: lectura inmediata y barata de almacenar. Glacier: aún más barato de almacenar, pero con restauración (salvo Instant Retrieval).']],
    scenario: 's3demo',
    examples: [['aws s3 cp s3://logs-app/archivo/viejo.txt .', 'No se puede leer sin restaurarlo', 'error'], ['aws s3api head-object --bucket logs-app --key archivo/viejo.txt --query StorageClass']],
    seeAlso: ['Clases de almacenamiento', 'Ciclo de vida de S3'],
  },
  {
    name: 'Ciclo de vida de S3',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Reglas que mueven objetos a clases más baratas o los borran tras N días, sin intervención humana.',
    details: `
Cada regla tiene un **filtro** (prefijo y/o etiquetas), un **estado** (\`Enabled\`/\`Disabled\`) y acciones:

- \`Transitions\`: pasar a otra clase tras N días.
- \`Expiration\`: borrar tras N días (en un bucket versionado crea un marcador de borrado).
- \`NoncurrentVersionTransitions\` / \`NoncurrentVersionExpiration\`: lo mismo para versiones antiguas.
- \`AbortIncompleteMultipartUpload\`: limpia subidas a medias que siguen cobrando.

Orden obligatorio: Standard-IA no antes de 30 días y la expiración tras las transiciones.
`,
    whenUse: ['Logs que solo importan unas semanas', 'Archivar a Glacier tras un periodo', 'Limpiar versiones antiguas en buckets versionados'],
    whenNot: ['Si no conoces el patrón de acceso, Intelligent-Tiering es más seguro que una regla fija', 'Reglas de expiración sin copia previa: el borrado es definitivo'],
    scenario: 's3demo',
    examples: [['aws s3api get-bucket-lifecycle-configuration --bucket logs-viejos --query "Rules[0].[ID,Status]" --output text']],
    seeAlso: ['Clases de almacenamiento', 'aws s3api put-bucket-lifecycle-configuration', 'Versionado de S3'],
  },
  {
    name: 'aws s3api put-bucket-lifecycle-configuration',
    kind: 'comando',
    category: 'almacenamiento',
    level: 2,
    summary: 'Aplica (reemplazando todas las reglas anteriores) la configuración de ciclo de vida de un bucket.',
    usage: "aws s3api put-bucket-lifecycle-configuration --bucket <nombre> \\\n  --lifecycle-configuration file://ciclo.json",
    details: `
\`\`\`
{"Rules":[{"ID":"archivar","Status":"Enabled","Filter":{"Prefix":""},
 "Transitions":[{"Days":30,"StorageClass":"STANDARD_IA"},{"Days":90,"StorageClass":"GLACIER"}],
 "Expiration":{"Days":730}}]}
\`\`\`

Es una operación de **reemplazo**: si ya había reglas y solo envías una, las demás desaparecen. Léelas antes con \`get-bucket-lifecycle-configuration\`.
`,
    scenario: 's3demo',
    examples: [
      [`echo '{"Rules":[{"ID":"limpiar","Status":"Enabled","Filter":{"Prefix":"tmp/"},"Expiration":{"Days":7}}]}' > ciclo.json`],
      ['aws s3api put-bucket-lifecycle-configuration --bucket logs-app --lifecycle-configuration file://ciclo.json'],
      ['aws s3api get-bucket-lifecycle-configuration --bucket logs-app --query "Rules[].ID" --output text'],
    ],
    seeAlso: ['Ciclo de vida de S3', 'Clases de almacenamiento'],
  },
  {
    name: 'Block Public Access',
    kind: 'buena práctica',
    category: 'almacenamiento',
    level: 1,
    summary: 'Cuatro interruptores que impiden el acceso público a un bucket, aunque una política o una ACL intenten abrirlo. Actívalos siempre salvo necesidad probada.',
    details: `
| Interruptor | Qué impide |
| --- | --- |
| \`BlockPublicAcls\` | Aplicar ACL públicas nuevas |
| \`IgnorePublicAcls\` | Ignora las ACL públicas existentes |
| \`BlockPublicPolicy\` | Aplicar políticas de bucket públicas |
| \`RestrictPublicBuckets\` | Limita el acceso de un bucket con política pública a usuarios autorizados de la cuenta |

Existe a nivel de **bucket** y de **cuenta** (el de cuenta prevalece). Los buckets nuevos nacen con los cuatro activados.
`,
    whenUse: ['Siempre, a nivel de cuenta y de bucket', 'En buckets que contienen datos de clientes o internos'],
    whenNot: ['Desactívalo solo en buckets que de verdad deban ser públicos, y mejor aún sírvelos con CloudFront + OAC'],
    scenario: 's3demo',
    examples: [['aws s3api get-public-access-block --bucket privado-demo --query PublicAccessBlockConfiguration'], ['aws s3api put-public-access-block --bucket privado-demo --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true']],
    seeAlso: ['aws s3api get-public-access-block', 'Política de bucket', 'Responsabilidad compartida'],
  },
  {
    name: 'Política de bucket',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 2,
    summary: 'Política JSON que se adjunta al bucket (basada en recurso) y dice quién puede hacer qué con él, incluyendo otras cuentas o el público.',
    details: `
A diferencia de una política de IAM, incluye **\`Principal\`** (a quién se aplica). Casos típicos:

- Dar acceso a **otra cuenta** de AWS.
- Hacer públicos los objetos (peligroso).
- **Imponer reglas** con \`Deny\` y condiciones: solo HTTPS (\`aws:SecureTransport\`), solo desde una VPC o rango de IP (\`aws:SourceIp\`, \`aws:SourceVpce\`), cifrado obligatorio (\`s3:x-amz-server-side-encryption\`).

Dentro de la misma cuenta basta con que lo permita **IAM o la política del bucket**; un \`Deny\` explícito gana siempre. Tamaño máximo: 20 KB.
`,
    whenUse: ['Acceso entre cuentas', 'Reglas obligatorias de seguridad con Deny', 'Permitir a CloudFront (OAC) o a servicios de AWS escribir logs'],
    whenNot: ['Para permisos de usuarios de tu cuenta, prefiere IAM', 'Evita `Principal: "*"` con Allow salvo contenido realmente público'],
    scenario: 's3demo',
    examples: [['aws s3api get-bucket-policy-status --bucket privado-demo --query PolicyStatus.IsPublic', 'Si la política deja el bucket público', 'error']],
    seeAlso: ['aws s3api put-bucket-policy', 'Block Public Access', 'Política JSON', 'Mínimo privilegio'],
  },
  {
    name: 'aws s3api put-bucket-policy',
    kind: 'comando',
    category: 'almacenamiento',
    level: 2,
    summary: 'Adjunta (o reemplaza) la política de un bucket. Si Block Public Access lo impide, la política pública se rechaza.',
    usage: "aws s3api put-bucket-policy --bucket <nombre> --policy file://politica.json",
    details: 'Para quitarla: `aws s3api delete-bucket-policy --bucket <nombre>`. Para verla: `get-bucket-policy`.',
    scenario: 's3demo',
    examples: [
      [`aws s3api put-bucket-policy --bucket privado-demo --policy '{"Version":"2012-10-17","Statement":[{"Sid":"SoloHTTPS","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::privado-demo","arn:aws:s3:::privado-demo/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}'`],
      ['aws s3api get-bucket-policy --bucket privado-demo --query Policy --output text'],
      [`aws s3api put-bucket-policy --bucket privado-demo --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::privado-demo/*"}]}'`, 'Una política pública con BPA activado se rechaza', 'error'],
    ],
    seeAlso: ['Política de bucket', 'Block Public Access'],
  },
  {
    name: 'Cifrado en S3',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 2,
    summary: 'Todos los objetos nuevos se cifran en reposo por defecto (SSE-S3). Puedes subir de nivel con SSE-KMS o SSE-C, y forzar HTTPS en tránsito.',
    details: `
| Opción | Quién gestiona la clave | Cuándo |
| --- | --- | --- |
| **SSE-S3** | S3 (AES-256) | Por defecto, sin coste |
| **SSE-KMS** | AWS KMS (tu clave) | Auditoría en CloudTrail, control de quién usa la clave |
| **SSE-C** | Tú, en cada petición | Control total (complejo) |
| **Cliente** | Tú, antes de subir | El dato nunca llega en claro a AWS |

Con SSE-KMS activa **Bucket Keys** para reducir las llamadas a KMS (y su coste).
`,
    whenUse: ['SSE-S3 por defecto', 'SSE-KMS cuando haya requisitos de auditoría o separación de funciones'],
    whenNot: ['SSE-KMS en buckets con millones de peticiones sin Bucket Keys: encarece y puede limitar el rendimiento'],
    scenario: 's3demo',
    examples: [['aws s3api get-bucket-encryption --bucket privado-demo --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm" --output text']],
    seeAlso: ['Política de bucket', 'S3'],
  },
  {
    name: 'URL prefirmada',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 2,
    summary: 'Enlace temporal que permite descargar (o subir) un objeto privado sin tener credenciales de AWS. Caduca solo.',
    details: `
La URL incluye la firma de quien la generó y una caducidad (\`X-Amz-Expires\`, hasta 7 días con claves de IAM; menos si se firma con credenciales temporales). Los permisos son **los del firmante**: si ese usuario pierde acceso, la URL deja de valer.

Úsala para: descargas privadas desde una web, enviar un informe a un cliente, subir un archivo directamente desde el navegador a S3 (_presigned PUT_).
`,
    whenUse: ['Compartir un objeto privado durante un tiempo limitado', 'Que el navegador suba/baje sin pasar por tu servidor'],
    whenNot: ['Contenido público permanente → CloudFront', 'Cualquiera con la URL puede usarla: ponle caducidad corta'],
    scenario: 's3demo',
    examples: [['aws s3 presign s3://privado-demo/informe.txt --expires-in 300'], ['URL=$(aws s3 presign s3://privado-demo/informe.txt) && curl -s "$URL"']],
    seeAlso: ['aws s3 presign', 'Block Public Access'],
  },
  {
    name: 'aws s3 presign',
    kind: 'comando',
    category: 'almacenamiento',
    level: 2,
    summary: 'Genera una URL prefirmada para descargar un objeto. `--expires-in` indica los segundos de validez (por defecto 3600).',
    usage: 'aws s3 presign s3://bucket/clave [--expires-in 600]',
    scenario: 's3demo',
    examples: [['aws s3 presign s3://privado-demo/informe.txt --expires-in 600']],
    seeAlso: ['URL prefirmada'],
  },
  {
    name: 'Versionado de S3',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Guarda todas las versiones de cada objeto: puedes recuperar sobrescrituras y borrados accidentales.',
    details: `
- Subir de nuevo la misma clave crea una **versión nueva**.
- Borrar sin \`--version-id\` añade un **marcador de borrado**; borrando el marcador, el objeto reaparece.
- Borrar con \`--version-id\` elimina esa versión para siempre.
- Una vez activado, solo se puede **suspender**.
- Combina con **MFA Delete** (solo root) y con reglas de ciclo de vida para versiones antiguas.
`,
    whenUse: ['Datos importantes que no deben perderse por error', 'Requisito previo de la replicación'],
    whenNot: ['Buckets de datos temporales: acumularías versiones facturables sin utilidad'],
    pricing: 'Cada versión se factura como un objeto. Añade una regla de ciclo de vida que borre las versiones antiguas.',
    scenario: 's3versiones',
    examples: [['aws s3api get-bucket-versioning --bucket documentos'], ['aws s3api list-object-versions --bucket documentos --query "DeleteMarkers[].[Key,IsLatest]" --output text']],
    seeAlso: ['aws s3api put-bucket-versioning', 'Replicación de S3', 'Ciclo de vida de S3'],
  },
  {
    name: 'aws s3api put-bucket-versioning',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Activa (`Enabled`) o suspende (`Suspended`) el versionado de un bucket.',
    usage: 'aws s3api put-bucket-versioning --bucket <nombre> --versioning-configuration Status=Enabled',
    scenario: 's3demo',
    examples: [['aws s3api put-bucket-versioning --bucket fotos-demo --versioning-configuration Status=Enabled'], ['aws s3api get-bucket-versioning --bucket fotos-demo']],
    seeAlso: ['Versionado de S3'],
  },
  {
    name: 'Replicación de S3',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 2,
    summary: 'Copia automáticamente los objetos nuevos de un bucket a otro, en otra región (CRR) o en la misma (SRR).',
    details: `
Requisitos: **versionado en origen y destino** y un **rol de IAM** que S3 asume para replicar. Solo se replican objetos **nuevos** (para los existentes, _Batch Replication_). Los marcadores de borrado no se replican por defecto.

Casos: recuperación ante desastres entre regiones, latencia cercana a usuarios, copias en otra cuenta por aislamiento, agregación de logs.
`,
    whenUse: ['Cumplir requisitos de recuperación ante desastres', 'Copia en otra cuenta para protegerse de borrados maliciosos'],
    whenNot: ['Una copia de seguridad puntual → AWS Backup o `aws s3 sync`', 'La replicación copia también los errores (un objeto corrupto o un borrado de versión) → no sustituye al versionado'],
    pricing: 'Pagas el almacenamiento en el destino, las peticiones de replicación y, entre regiones, la transferencia.',
    seeAlso: ['Versionado de S3', 'Rol de IAM'],
  },
  {
    name: 'Sitio web estático en S3',
    kind: 'concepto',
    category: 'almacenamiento',
    level: 1,
    summary: 'Un bucket puede servir HTML, CSS, JS e imágenes como sitio web sin servidores. El endpoint de S3 solo habla HTTP: para HTTPS, usa CloudFront.',
    details: `
1. Activa el alojamiento de sitio web con \`index.html\` (y opcionalmente \`error.html\`).
2. Haz los objetos legibles (política pública + BPA parcialmente desactivado)… o, mejor, deja el bucket **privado** y publícalo con **CloudFront + OAC**.
3. El endpoint tiene la forma \`http://bucket.s3-website-<región>.amazonaws.com\`.
`,
    whenUse: ['Webs de documentación, landing pages y aplicaciones de una sola página (SPA)'],
    whenNot: ['Si necesitas HTTPS directo, cabeceras personalizadas o dominio propio → CloudFront delante', 'Aplicaciones con lógica de servidor → EC2, contenedores o Lambda'],
    pricing: 'Almacenamiento + peticiones + transferencia de salida. Muy barato para webs pequeñas.',
    seeAlso: ['aws s3 website', 'Block Public Access', 'Política de bucket'],
  },
  {
    name: 'aws s3 website',
    kind: 'comando',
    category: 'almacenamiento',
    level: 1,
    summary: 'Activa el alojamiento de sitio web en un bucket e indica el documento de índice (y el de error).',
    usage: 'aws s3 website s3://bucket/ --index-document index.html [--error-document error.html]',
    scenario: 's3demo',
    examples: [['aws s3 website s3://fotos-demo/ --index-document index.html'], ['aws s3api get-bucket-website --bucket fotos-demo --query IndexDocument.Suffix --output text']],
    seeAlso: ['Sitio web estático en S3'],
  },
  {
    name: 'Elegir almacenamiento',
    kind: 'comparativa',
    category: 'almacenamiento',
    level: 1,
    summary: 'Bloque, archivos u objetos: qué servicio de AWS encaja con cada necesidad.',
    details: `
| Necesito… | Servicio |
| --- | --- |
| Disco de una instancia EC2 | **EBS** (bloque) |
| Disco de altísima velocidad pero efímero | **Instance store** |
| Archivos compartidos para Linux | **EFS** |
| Archivos Windows (SMB, AD) | **FSx for Windows** |
| HPC / machine learning de alto rendimiento | **FSx for Lustre** |
| Objetos, backups, datos, web estática | **S3** |
| Archivo a muy largo plazo | **S3 Glacier** |
| Ver S3 como NAS desde mi oficina | **Storage Gateway** |
| Copias centralizadas con políticas | **AWS Backup** |
`,
    versus: [
      ['EBS frente a EFS', 'EBS: un disco para una instancia (una zona). EFS: un sistema de archivos compartido entre muchas instancias y zonas.'],
      ['EFS frente a S3', 'EFS se monta y permite leer/escribir partes de archivos; S3 es por API HTTP, mucho más barato y sin límite.'],
    ],
    seeAlso: ['EBS', 'EFS', 'FSx', 'S3', 'Storage Gateway', 'Instance store'],
  },
  {
    name: 'EFS',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 1,
    summary: 'Sistema de archivos de red elástico (NFS) para Linux, compartido por miles de instancias de varias zonas.',
    details: `
Crece y se reduce solo (sin aprovisionar tamaño). Se monta como una carpeta (\`mount -t efs\`). Clases: Standard, Infrequent Access y Archive, con **ciclo de vida** que las mueve solo. Modos de rendimiento: _elastic_, _bursting_ o _provisioned throughput_.
`,
    whenUse: ['Contenido compartido entre servidores web', 'Directorios personales, herramientas de CI, aplicaciones heredadas que esperan un sistema de archivos'],
    whenNot: ['Windows → FSx for Windows', 'Datos que solo lee una instancia → EBS', 'Objetos baratos → S3 (EFS cuesta bastante más por GB)'],
    pricing: 'Por GB al mes realmente usado (según la clase) y, opcionalmente, rendimiento aprovisionado.',
    seeAlso: ['Elegir almacenamiento', 'EBS', 'S3'],
  },
  {
    name: 'FSx',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 2,
    summary: 'Sistemas de archivos gestionados de terceros: Windows File Server, Lustre, NetApp ONTAP y OpenZFS.',
    details: `
- **FSx for Windows File Server**: SMB nativo, integración con Active Directory, cuotas, shadow copies.
- **FSx for Lustre**: rendimiento extremo para HPC y ML; se integra con S3 (carga datos de un bucket y escribe resultados de vuelta).
- **FSx for NetApp ONTAP** y **OpenZFS**: migrar cargas que ya usan esos sistemas con sus funciones (snapshots, clones, protocolos NFS/SMB/iSCSI).
`,
    whenUse: ['Migrar servidores de archivos Windows', 'Entrenamiento de ML o HPC con datos de S3', 'Cargas que ya usan ONTAP u OpenZFS'],
    whenNot: ['Linux con NFS genérico → EFS (más simple)', 'Archivado barato → S3'],
    pricing: 'Por capacidad aprovisionada y por rendimiento, además de las copias de seguridad.',
    seeAlso: ['Elegir almacenamiento', 'EFS'],
  },
  {
    name: 'Storage Gateway',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 2,
    summary: 'Dispositivo (virtual o físico) en tu centro de datos que conecta tus sistemas locales con S3, EBS y Glacier como si fueran un NAS, un SAN o una cinta.',
    details: `
Tipos: **File Gateway** (recursos NFS/SMB respaldados por S3), **Volume Gateway** (volúmenes iSCSI con copias en EBS/S3) y **Tape Gateway** (biblioteca de cintas virtual que archiva en Glacier). Mantiene una caché local de los datos recientes.

Para **migrar** datos en bloque, mejor **DataSync**; para transportarlos físicamente, la familia **Snow**.
`,
    whenUse: ['Híbrido: seguir con aplicaciones locales usando almacenamiento de AWS', 'Sustituir una infraestructura de cintas por Glacier'],
    whenNot: ['Una migración única de datos → DataSync / Snowball', 'Aplicaciones totalmente en AWS → S3 / EFS directamente'],
    seeAlso: ['Elegir almacenamiento', 'S3', 'AWS Backup'],
  },
  {
    name: 'AWS Backup',
    kind: 'servicio',
    category: 'almacenamiento',
    level: 2,
    summary: 'Servicio centralizado para programar, conservar y auditar copias de seguridad de EBS, EC2, RDS, DynamoDB, EFS, FSx, S3 y más.',
    details: `
Defines **planes** (frecuencia, ventana, retención, copia a otra región o cuenta) y los asignas a recursos por **etiquetas**. Los datos se guardan en **bóvedas** cifradas; con **Vault Lock** puedes hacerlas inmutables (WORM) para cumplir normativas o protegerte de ransomware.
`,
    whenUse: ['Una política de copias única para muchos servicios', 'Auditoría y cumplimiento de retención'],
    whenNot: ['Una copia puntual de un disco → un snapshot de EBS directamente', 'Versionado y replicación de S3 ya cubren otros casos (no son lo mismo que una copia con retención)'],
    pricing: 'Por GB de copia almacenada (según el servicio de origen) y por restauración.',
    seeAlso: ['Snapshot de EBS', 'Elegir almacenamiento', 'Storage Gateway'],
  },
];
