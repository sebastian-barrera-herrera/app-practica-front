import { A, all, awsHas, awsIs, awsWorld, demo, fill, illus, learn, lesson, match, mc, multi, out, practice, predict, ran, tf, typeCmd } from './awsbuild';

const sim = (user: string, action: string, resource: string) => `iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:user/${user} --action-names ${action} --resource-arns ${resource} --query EvaluationResults[0].EvalDecision`;

export const a2 = awsWorld({
  id: 'a2',
  index: 2,
  title: 'Identidad y acceso (IAM)',
  subtitle: 'Quién puede hacer qué',
  emoji: '🔐',
  color: '#FF9900',
  level: 'basico',
  intro:
    'IAM es el servicio que decide **quién puede hacer qué** en tu cuenta de AWS. Es gratis, es global y es el que más importa: casi todos los incidentes de seguridad en la nube empiezan con un permiso demasiado amplio o una clave que se filtró. En esta zona aprenderás a proteger la cuenta, a organizar usuarios, grupos y roles, a leer y escribir políticas JSON sin miedo y a aplicar el principio del mínimo privilegio.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a2-1', { title: 'El usuario root y los primeros pasos seguros', summary: 'Proteger la cuenta desde el minuto uno', emoji: '🛡️', commands: ['Usuario root', 'MFA', 'aws iam get-account-summary', 'aws iam create-virtual-mfa-device'], minutes: 10 }, [
      learn(
        'La llave maestra de la cuenta',
        `
Cuando creas una cuenta de AWS entras con el **correo y la contraseña** con que te registraste. Esa identidad es el **usuario root** y tiene un poder total: puede hacerlo todo, incluso cerrar la cuenta, y **no se le pueden quitar permisos con políticas de IAM**.

Por eso la regla es:

1. Activa **MFA** (autenticación multifactor) en el root nada más crear la cuenta. AWS ya lo exige a los usuarios root.
2. **No crees claves de acceso para root.** Si ya existen, bórralas.
3. **No uses el root a diario.** Crea un usuario administrador (o, mejor, entra con IAM Identity Center) y guarda el root en un cajón.
4. Usa el root solo para las pocas tareas que lo exigen: cambiar el correo o la contraseña de root, cerrar la cuenta o recuperar el acceso si te quedas sin ningún administrador.

> OJO: Una clave de acceso de root filtrada (por ejemplo, subida a GitHub) da a quien la encuentre **control absoluto** de tu cuenta y de tu factura.
`,
        '👑',
      ),
      mc('¿Para cuál de estas tareas SÍ hace falta entrar como usuario root?', ['Crear un bucket de S3', 'Lanzar una instancia EC2', 'Cerrar la cuenta de AWS', 'Crear un usuario de IAM'], 2, 'Casi todo se hace con usuarios y roles de IAM. Cerrar la cuenta, cambiar el correo o la contraseña de root son de las pocas tareas que solo puede hacer el root.'),
      learn(
        'MFA: algo que sabes y algo que tienes',
        `
Una contraseña robada es suficiente para entrar. Con **MFA** hace falta además un segundo factor que solo tú tienes. Tipos que admite AWS:

- **Aplicación autenticadora** (_virtual MFA_): una app en el móvil que genera un código de 6 dígitos cada 30 segundos.
- **Llave de seguridad FIDO2 / passkey**: un dispositivo físico (o el propio móvil/portátil) que firma el inicio de sesión. Es la opción más segura porque **resiste al phishing**.
- **Token físico** que genera códigos.

Para el usuario root y para los administradores es obligatorio en la práctica; para el resto del equipo, muy recomendable.
`,
        '📲',
      ),
      tf('«Si activo MFA, para entrar basta con la contraseña: el código solo se pide si se detecta algo raro.»', false, 'Con MFA activado, el inicio de sesión de la consola pide siempre contraseña **y** el segundo factor.'),
      demo(
        'La foto de seguridad de una cuenta',
        [
          ['aws iam get-account-summary --query "SummaryMap.[AccountMFAEnabled,AccountAccessKeysPresent]"', 'Primer número: ¿tiene MFA el root? Segundo: ¿cuántas claves de acceso de root hay? Aquí: sin MFA y con 1 clave, justo lo que NO hay que hacer'],
          ['aws iam get-account-summary --query "SummaryMap.Users"', 'Cuántos usuarios de IAM existen'],
        ],
        A('root-inseguro'),
        'Esta cuenta se abrió con prisas. Mira qué te cuenta IAM sobre su estado de seguridad.',
      ),
      predict(
        '¿Qué imprime este comando en la cuenta del ejemplo?',
        'aws iam get-account-summary --query "SummaryMap.AccountAccessKeysPresent"',
        ['0', '2', 'true'],
        'Hay **1** clave de acceso de root: un riesgo grave. Lo correcto es que este número sea 0.',
        A('root-inseguro'),
      ),
      multi(
        'Marca las buenas prácticas con el usuario root.',
        ['Activar MFA', 'Crear una clave de acceso para usarla en tus scripts', 'Usarlo solo para las tareas que lo exigen', 'Compartir su contraseña con todo el equipo', 'Crear un usuario administrador para el trabajo diario'],
        [0, 2, 4],
        'MFA, uso mínimo y un administrador de IAM para el día a día. Nunca claves de acceso de root ni compartir la contraseña.',
      ),
      learn(
        'Activar MFA desde la CLI',
        `
A un usuario de IAM le activas un MFA virtual en dos pasos. La CLI crea el dispositivo y te devuelve su **número de serie**; luego lo activas con **dos códigos consecutivos** de la app:

\`\`\`
aws iam create-virtual-mfa-device --virtual-mfa-device-name alumno
aws iam enable-mfa-device --user-name alumno \\
  --serial-number arn:aws:iam::123456789012:mfa/alumno \\
  --authentication-code1 123456 --authentication-code2 654321
\`\`\`

En esta cuenta de práctica cualquier pareja de códigos de 6 dígitos vale (en la real, los dos últimos que muestra tu app).
`,
        '🔢',
      ),
      practice({
        prompt: 'El usuario **`alumno`** (administrador de la cuenta) aún no tiene MFA. Crea un dispositivo MFA virtual llamado `alumno` y **actívalo** para ese usuario con los códigos `123456` y `654321`.',
        goal: 'MFA activado en el usuario alumno',
        setup: A('base'),
        check: awsIs('iam list-mfa-devices --user-name alumno --query "MFADevices[].SerialNumber"', ['arn:aws:iam::123456789012:mfa/alumno'], 'El usuario alumno aún no tiene un MFA activado'),
        solution: [
          'aws iam create-virtual-mfa-device --virtual-mfa-device-name alumno',
          'aws iam enable-mfa-device --user-name alumno --serial-number arn:aws:iam::123456789012:mfa/alumno --authentication-code1 123456 --authentication-code2 654321',
        ],
        hints: ['Primero se crea el dispositivo: `aws iam create-virtual-mfa-device --virtual-mfa-device-name alumno`.', 'El número de serie sale en la respuesta: `arn:aws:iam::123456789012:mfa/alumno`.', 'Después `aws iam enable-mfa-device --user-name alumno --serial-number … --authentication-code1 … --authentication-code2 …`.'],
        explain: 'Crear el dispositivo genera la semilla; activarlo lo vincula al usuario con dos códigos consecutivos. A partir de entonces la consola le pedirá siempre el segundo factor.',
        par: 2,
        commands: ['MFA', 'aws iam create-virtual-mfa-device'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a2-2', { title: 'Usuarios, grupos y políticas', summary: 'Crear identidades y darles permisos', emoji: '👥', commands: ['Usuario de IAM', 'Grupo de IAM', 'Política de IAM', 'aws iam create-user', 'aws iam attach-group-policy'], minutes: 11 }, [
      learn(
        'Por defecto, nadie puede nada',
        `
En IAM hay tres piezas básicas:

- **Usuario**: una persona o aplicación con credenciales propias (contraseña para la consola y/o claves de acceso para la CLI).
- **Grupo**: un conjunto de usuarios al que das permisos de golpe. Un usuario puede estar en varios grupos; los grupos **no se pueden anidar**.
- **Política**: un documento (JSON) que dice qué acciones se permiten o se deniegan sobre qué recursos. Se **asocia** a usuarios, grupos o roles.

Una regla lo cambia todo: **un usuario nuevo no puede hacer absolutamente nada** hasta que le des permisos (denegado por defecto).

> CLAVE: No des permisos usuario por usuario. Crea **grupos por función** (desarrolladores, soporte, administradores), asocia las políticas a los grupos y mete a las personas en ellos. Al cambiar de puesto, cambias de grupo.
`,
        '👥',
      ),
      mc('Acabas de crear un usuario de IAM sin asociarle ninguna política. ¿Qué puede hacer?', ['Todo lo que hace su creador', 'Solo lectura', 'Nada', 'Lo que permita el grupo "default"'], 2, 'IAM deniega por defecto. Sin políticas, el usuario ni siquiera puede listar buckets.'),
      demo(
        'Una cuenta con un equipo',
        [
          ['aws iam list-users --query "Users[].UserName" --output text', 'Los usuarios de la cuenta'],
          ['aws iam list-groups-for-user --user-name ana --query "Groups[].GroupName" --output text', 'Ana pertenece al grupo desarrolladores'],
          ['aws iam list-attached-group-policies --group-name desarrolladores --query "AttachedPolicies[].PolicyName" --output text', 'Y ese grupo tiene una política de AWS asociada'],
          ['aws s3 ls --profile ana', 'Ana puede listar buckets gracias al grupo (aunque ella no tenga nada directo)'],
          ['aws iam list-users --profile ana', 'Pero no puede mirar los usuarios: su política no lo incluye', 'error'],
        ],
        A('equipo'),
        '`--profile ana` ejecuta el comando con las credenciales de Ana, no con las tuyas.',
      ),
      match(
        'Une cada elemento de IAM con su función',
        [
          ['Usuario', 'Una persona o aplicación con credenciales'],
          ['Grupo', 'Varios usuarios con los mismos permisos'],
          ['Política', 'Documento que permite o deniega acciones'],
        ],
        'Los usuarios se agrupan para repartir permisos; las políticas son el contenido de esos permisos.',
      ),
      learn(
        'Tipos de política',
        `
- **Políticas administradas por AWS**: ya hechas, mantenidas por AWS. Por ejemplo \`AmazonS3ReadOnlyAccess\`, \`AmazonEC2FullAccess\`, \`AdministratorAccess\`. Empieza por aquí.
- **Políticas administradas por el cliente**: las escribes tú y las reutilizas en varios usuarios, grupos o roles.
- **Políticas en línea (_inline_)**: incrustadas en un solo usuario, grupo o rol. Útiles para algo único; no se reutilizan.

Cada usuario, grupo o rol admite hasta **10 políticas administradas** asociadas (cuota por defecto).
`,
        '📚',
      ),
      tf('«Los grupos de IAM pueden contener otros grupos.»', false, 'Los grupos solo contienen usuarios; no existen grupos anidados en IAM.'),
      predict(
        '¿Qué imprime este comando?',
        'aws iam list-groups-for-user --user-name ana --query "Groups[].GroupName" --output text',
        ['admins', 'ana', 'desarrolladores admins'],
        'Ana solo está en el grupo `desarrolladores`.',
        A('equipo'),
      ),
      typeCmd('Escribe el comando que crea un usuario de IAM llamado `pedro`.', ['aws iam create-user --user-name pedro'], 'La operación es `create-user` del servicio `iam`, con `--user-name`.', { setup: A('base'), check: awsHas('iam list-users --query "Users[].UserName"', 'pedro'), hint: 'aws iam create-user --user-name …' }),
      practice({
        prompt:
          'Monta el equipo de soporte:\n\n1. Crea el usuario **`lucia`**.\n2. Crea el grupo **`soporte`**.\n3. Mete a `lucia` en `soporte`.\n4. Dale al grupo permisos de **solo lectura de EC2** con la política de AWS `AmazonEC2ReadOnlyAccess`.',
        goal: 'lucia en el grupo soporte con EC2 solo lectura',
        setup: A('base'),
        check: all(
          awsIs('iam list-groups-for-user --user-name lucia --query "Groups[].GroupName"', ['soporte'], 'lucia debe estar en el grupo soporte'),
          awsIs('iam list-attached-group-policies --group-name soporte --query "AttachedPolicies[].PolicyName"', ['AmazonEC2ReadOnlyAccess'], 'El grupo soporte necesita la política AmazonEC2ReadOnlyAccess'),
        ),
        solution: [
          'aws iam create-user --user-name lucia',
          'aws iam create-group --group-name soporte',
          'aws iam add-user-to-group --group-name soporte --user-name lucia',
          'aws iam attach-group-policy --group-name soporte --policy-arn arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess',
        ],
        hints: ['Usa `create-user`, `create-group`, `add-user-to-group` y `attach-group-policy`.', 'El ARN de la política de AWS es `arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess`.'],
        explain: 'Lucia hereda los permisos del grupo: si mañana hay otra persona de soporte, basta con meterla en `soporte`. Es la forma escalable de dar permisos.',
        par: 4,
        commands: ['Usuario de IAM', 'Grupo de IAM', 'aws iam create-user', 'aws iam attach-group-policy'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a2-3', { title: 'Leer y escribir políticas JSON', summary: 'Effect, Action, Resource y quién gana', emoji: '📜', commands: ['Política JSON', 'aws iam create-policy', 'aws iam simulate-principal-policy', 'aws iam put-user-policy'], minutes: 14 }, [
      learn(
        'Anatomía de una política',
        `
Una política es un JSON con una lista de **sentencias** (_statements_). Cada sentencia responde a: **¿se permite o se deniega (Effect), qué acciones (Action), sobre qué recursos (Resource) y bajo qué condiciones (Condition)?**

\`\`\`
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::informes-empresa",
        "arn:aws:s3:::informes-empresa/*"
      ]
    }
  ]
}
\`\`\`

- **Version**: siempre \`"2012-10-17"\` (la versión actual del lenguaje).
- **Effect**: \`Allow\` o \`Deny\`.
- **Action**: \`servicio:Operación\`, con comodines (\`s3:Get*\`, \`s3:*\`).
- **Resource**: el [ARN](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html) del recurso. Los de S3 son \`arn:aws:s3:::bucket\` (el bucket) y \`arn:aws:s3:::bucket/*\` (los objetos).
- **Condition** (opcional): restringe cuándo vale (desde qué IP, con MFA, solo en una región…).

> OJO: \`s3:ListBucket\` actúa sobre el **bucket**; \`s3:GetObject\`, sobre los **objetos** (\`/*\`). Mezclar los ARN es el error más habitual al escribir políticas de S3.
`,
        '📜',
      ),
      illus('aws-policy-eval', 'Cómo decide IAM', 'Activa o desactiva sentencias y mira quién gana.'),
      learn(
        'Las tres reglas de la evaluación',
        `
1. **Todo está denegado por defecto** (denegación implícita).
2. Un **Allow explícito** que coincida con la petición la permite…
3. …salvo que haya un **Deny explícito**, que **siempre gana**, sin importar cuántos Allow existan.

Después hay más capas que pueden **recortar** (nunca ampliar) los permisos: límites de permisos, políticas de sesión y SCP de AWS Organizations. Las verás en zonas avanzadas.

Los resultados posibles son tres: **allowed**, **implicitDeny** (nadie lo permitió) y **explicitDeny** (alguien lo prohibió).
`,
        '⚖️',
      ),
      mc('Un usuario tiene una política con `Allow s3:*` sobre todo y otra con `Deny s3:DeleteObject`. ¿Puede borrar un objeto?', ['Sí, porque Allow s3:* incluye DeleteObject', 'No: el Deny explícito siempre gana', 'Depende del orden de las políticas', 'Sí, si es administrador de la cuenta'], 1, 'Un Deny explícito vence a cualquier Allow, estén donde estén y en el orden que sea.'),
      fill(
        'Completa la sentencia para permitir leer los objetos del bucket `informes-empresa`:\n"Effect": "___", "Action": "s3:___", "Resource": "arn:aws:s3:::informes-empresa/___"',
        '"Effect": "___", "Action": "s3:___", "Resource": "arn:aws:s3:::informes-empresa/___"',
        ['Allow', 'Deny', 'GetObject', 'PutObject', '*', 'objetos'],
        ['Allow', 'GetObject', '*'],
        '`Allow` permite, `s3:GetObject` lee objetos y `/*` abarca todos los objetos del bucket.',
      ),
      learn(
        'Probar antes de aplicar: el simulador de políticas',
        `
En vez de adivinar si un usuario puede hacer algo, **pregúntaselo a IAM**. \`simulate-principal-policy\` evalúa las políticas reales de un usuario o rol contra las acciones y recursos que le indiques, **sin ejecutarlas**:

\`\`\`
aws iam simulate-principal-policy \\
  --policy-source-arn arn:aws:iam::123456789012:user/ana \\
  --action-names s3:GetObject s3:PutObject \\
  --resource-arns arn:aws:s3:::informes-empresa/q1.txt
\`\`\`

Y \`simulate-custom-policy\` hace lo mismo con una política que aún no has creado.
`,
        '🧪',
      ),
      demo(
        '¿Podría Ana…?',
        [
          [`aws ${sim('ana', 's3:GetObject', 'arn:aws:s3:::informes-empresa/q1.txt')} --output text`, 'Leer un informe: permitido (su grupo tiene S3 de solo lectura)'],
          [`aws ${sim('ana', 's3:PutObject', 'arn:aws:s3:::informes-empresa/q1.txt')} --output text`, 'Escribir: nadie se lo permitió → implicitDeny'],
          ['aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:user/ana --action-names iam:CreateUser --query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text', 'Crear usuarios: también denegado por defecto'],
        ],
        A('equipo'),
      ),
      predict(
        '¿Qué imprime esta simulación?',
        `aws ${sim('ana', 's3:PutObject', 'arn:aws:s3:::informes-empresa/q1.txt')} --output text`,
        ['allowed', 'explicitDeny', 'denied'],
        'Ana solo tiene lectura de S3. Escribir no está permitido en ninguna política, pero tampoco prohibido expresamente: es **implicitDeny**.',
        A('equipo'),
      ),
      practice({
        prompt:
          'La usuaria **`lucia`** no tiene ningún permiso. Escribe y crea una política llamada **`leer-informes`** que permita **solo** `s3:GetObject` sobre los objetos del bucket `informes-empresa` y **asóciala a lucia**.\n\nTip: puedes escribir el JSON en una línea con `echo \'{…}\' > politica.json` y usar `--policy-document file://politica.json`.',
        goal: 'lucia puede leer informes-empresa pero nada más',
        setup: A('politicas'),
        check: all(
          awsIs(sim('lucia', 's3:GetObject', 'arn:aws:s3:::informes-empresa/q1.txt'), 'allowed', 'Lucia debería poder leer los informes'),
          awsIs(sim('lucia', 's3:PutObject', 'arn:aws:s3:::informes-empresa/q1.txt'), 'implicitDeny', 'Lucia no debería poder escribir'),
          awsIs(sim('lucia', 's3:GetObject', 'arn:aws:s3:::otros-datos/notas.txt'), 'implicitDeny', 'Lucia no debería poder leer otros buckets'),
        ),
        solution: [
          `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"arn:aws:s3:::informes-empresa/*"}]}' > politica.json`,
          'aws iam create-policy --policy-name leer-informes --policy-document file://politica.json',
          'aws iam attach-user-policy --user-name lucia --policy-arn arn:aws:iam::123456789012:policy/leer-informes',
        ],
        hints: ['El Resource debe ser `arn:aws:s3:::informes-empresa/*` (los objetos).', 'Crea la política con `aws iam create-policy --policy-name leer-informes --policy-document …`.', 'Asóciala con `aws iam attach-user-policy --user-name lucia --policy-arn …`.'],
        explain: 'Tres comprobaciones lo confirman: leer informes (permitido), escribir (implícitamente denegado) y leer otro bucket (denegado). Eso es **mínimo privilegio**: solo lo imprescindible.',
        par: 3,
        commands: ['Política JSON', 'aws iam create-policy'],
      }),
      practice({
        prompt:
          'El usuario **`mario`** tiene `AmazonS3FullAccess` (puede todo en S3). Su jefe quiere que **no pueda borrar objetos** del bucket `informes-empresa` aunque conserve todo lo demás. Añádele una política **en línea** (`put-user-policy`) con un **Deny** de `s3:DeleteObject`.',
        goal: 'mario lee pero no puede borrar',
        setup: A('politicas'),
        check: all(
          awsIs(sim('mario', 's3:DeleteObject', 'arn:aws:s3:::informes-empresa/q1.txt'), 'explicitDeny', 'Mario no debería poder borrar'),
          awsIs(sim('mario', 's3:GetObject', 'arn:aws:s3:::informes-empresa/q1.txt'), 'allowed', 'Mario debería seguir pudiendo leer'),
        ),
        solution: [
          `aws iam put-user-policy --user-name mario --policy-name no-borrar --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"s3:DeleteObject","Resource":"arn:aws:s3:::informes-empresa/*"}]}'`,
        ],
        hints: ['`aws iam put-user-policy --user-name mario --policy-name … --policy-document …`', 'La sentencia lleva `"Effect": "Deny"` y `"Action": "s3:DeleteObject"`.'],
        explain: 'Un Deny explícito gana al Allow de `AmazonS3FullAccess`. Es la forma de poner una excepción sin tocar la política de AWS.',
        par: 1,
        commands: ['aws iam put-user-policy', 'aws iam simulate-principal-policy'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a2-4', { title: 'Roles y credenciales temporales', summary: 'Asumir un rol en vez de repartir claves', emoji: '🎭', commands: ['Rol de IAM', 'STS', 'aws sts assume-role', 'aws iam create-role'], minutes: 13 }, [
      learn(
        'Un rol es un disfraz que te pones',
        `
Un **rol de IAM** es una identidad que **no tiene credenciales propias**: alguien (o algo) la **asume** durante un rato y recibe **credenciales temporales** que caducan solas (entre 15 minutos y 12 horas).

Cada rol tiene dos políticas con funciones distintas:

- **Política de confianza** (_trust policy_): dice **quién puede asumir** el rol (otro usuario, otra cuenta, un servicio como EC2 o Lambda).
- **Políticas de permisos**: dicen **qué puede hacer** quien lo asuma.

Casos típicos: una **instancia EC2** que necesita leer de S3 (se le asigna un rol, no se le copian claves), una **Lambda**, un tercero que accede a tu cuenta, o tú mismo para entrar con permisos elevados solo cuando hace falta.

> CLAVE: **Roles mejor que claves de acceso.** Una clave fija puede filtrarse y vale para siempre; unas credenciales temporales caducan solas y no hay nada que rotar.
`,
        '🎭',
      ),
      illus('aws-sts-assume', 'Asumir un rol paso a paso', 'Pulsa «siguiente» para ver cómo STS entrega credenciales temporales.'),
      mc('¿Cuál es la ventaja principal de usar un rol en una instancia EC2 en vez de guardar una clave de acceso en el servidor?', ['El rol es más rápido', 'Las credenciales son temporales y se renuevan solas; no hay secretos que se puedan filtrar', 'Los roles son gratuitos y las claves no', 'Con un rol no hace falta política'], 1, 'No hay clave fija que robar: AWS entrega credenciales temporales a la instancia y las rota automáticamente.'),
      match(
        'Une cada parte de un rol con su función',
        [
          ['Política de confianza', 'Quién puede asumir el rol'],
          ['Política de permisos', 'Qué puede hacer quien lo asuma'],
          ['Credenciales temporales', 'Clave, secreto y token que caducan'],
        ],
        'La confianza controla la entrada; los permisos, lo que se puede hacer una vez dentro; las credenciales temporales son lo que entrega STS.',
      ),
      learn(
        'STS: el servicio que reparte credenciales temporales',
        `
**AWS STS** (_Security Token Service_) es quien emite las credenciales temporales. La llamada clave es \`aws sts assume-role\`:

\`\`\`
aws sts assume-role \\
  --role-arn arn:aws:iam::123456789012:role/Auditor \\
  --role-session-name curso
\`\`\`

La respuesta incluye un **AccessKeyId que empieza por \`ASIA\`** (las claves permanentes empiezan por \`AKIA\`), una **SecretAccessKey**, un **SessionToken** y la fecha de caducidad (\`Expiration\`). Las tres primeras se deben usar **juntas**.

Quien llama necesita dos cosas: que la **política de confianza** del rol lo admita y, si es de otra cuenta o la confianza nombra solo la cuenta, un permiso \`sts:AssumeRole\` en su propia política.
`,
        '🎫',
      ),
      demo(
        'Mirar un rol y asumirlo',
        [
          ['aws iam get-role --role-name Auditor --query Role.AssumeRolePolicyDocument', 'La política de confianza de Auditor: confía en la propia cuenta'],
          ['aws iam list-attached-role-policies --role-name Auditor --query "AttachedPolicies[].PolicyName" --output text', 'Y lo que puede hacer quien lo asuma: auditar (SecurityAudit)'],
          ['aws sts assume-role --role-arn arn:aws:iam::123456789012:role/Auditor --role-session-name curso --query "AssumedRoleUser.Arn" --output text', 'Asumimos el rol: la identidad de la sesión es un «assumed-role»'],
          ['aws sts assume-role --role-arn arn:aws:iam::123456789012:role/ServidorWeb --role-session-name intento', 'ServidorWeb solo confía en EC2: nosotros no podemos asumirlo', 'error'],
        ],
        A('equipo'),
      ),
      predict(
        '¿Qué imprime este comando?',
        'aws sts assume-role --role-arn arn:aws:iam::123456789012:role/Auditor --role-session-name curso --query "AssumedRoleUser.Arn" --output text',
        ['arn:aws:iam::123456789012:role/Auditor', 'arn:aws:iam::123456789012:user/alumno', 'arn:aws:sts::123456789012:assumed-role/curso/Auditor'],
        'La identidad de la sesión tiene la forma `assumed-role/<rol>/<nombre-de-sesión>`.',
        A('equipo'),
      ),
      tf('«Las credenciales que devuelve assume-role caducan solas.»', true, 'Por eso son más seguras que una clave fija: aunque se filtren, dejan de valer.'),
      practice({
        prompt:
          'Crea un rol llamado **`LectorS3`** que **cualquier identidad de esta cuenta autorizada pueda asumir** (política de confianza con `"Principal": {"AWS": "arn:aws:iam::123456789012:root"}` y acción `sts:AssumeRole`) y dale permisos de solo lectura de S3 (`AmazonS3ReadOnlyAccess`).',
        goal: 'Rol LectorS3 con confianza en la cuenta y S3 solo lectura',
        setup: A('base'),
        check: all(
          awsIs('iam get-role --role-name LectorS3 --query Role.AssumeRolePolicyDocument.Statement[0].Principal.AWS', 'arn:aws:iam::123456789012:root', 'El rol debe confiar en arn:aws:iam::123456789012:root'),
          awsIs('iam list-attached-role-policies --role-name LectorS3 --query "AttachedPolicies[].PolicyName"', ['AmazonS3ReadOnlyAccess'], 'Falta asociar AmazonS3ReadOnlyAccess al rol'),
        ),
        solution: [
          `aws iam create-role --role-name LectorS3 --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::123456789012:root"},"Action":"sts:AssumeRole"}]}'`,
          'aws iam attach-role-policy --role-name LectorS3 --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
        ],
        hints: ['`aws iam create-role --role-name LectorS3 --assume-role-policy-document …` (la política de confianza va en JSON).', 'Después `aws iam attach-role-policy --role-name LectorS3 --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess`.'],
        explain: 'La política de confianza dice quién entra; la de permisos, qué hace. Confiar en `:root` de la cuenta significa «las identidades de esta cuenta a las que su propia política les permita `sts:AssumeRole`».',
        par: 2,
        commands: ['Rol de IAM', 'aws iam create-role'],
      }),
      learn(
        'Usar un rol desde la CLI con un perfil',
        `
Hay dos formas de trabajar con las credenciales temporales de un rol:

1. **A mano**: ejecutas \`assume-role\` y copias \`AccessKeyId\`, \`SecretAccessKey\` y \`SessionToken\` a las variables \`AWS_ACCESS_KEY_ID\`, \`AWS_SECRET_ACCESS_KEY\` y \`AWS_SESSION_TOKEN\`.
2. **Con un perfil** (lo cómodo): en \`~/.aws/config\` defines un perfil con \`role_arn\` y \`source_profile\`. La CLI llama a \`assume-role\` por ti cada vez que lo necesita.

\`\`\`
[profile auditor]
role_arn = arn:aws:iam::123456789012:role/Auditor
source_profile = default
\`\`\`
`,
        '🧩',
      ),
      practice({
        prompt: 'Configura un perfil llamado **`auditor`** que asuma el rol `Auditor` (`arn:aws:iam::123456789012:role/Auditor`) usando como origen el perfil `default`, y comprueba con `get-caller-identity` que ahora eres ese rol.',
        goal: 'get-caller-identity con el perfil auditor muestra el rol',
        setup: A('equipo'),
        check: all(ran('--profile auditor'), out('assumed-role/Auditor')),
        solution: [
          'aws configure set role_arn arn:aws:iam::123456789012:role/Auditor --profile auditor',
          'aws configure set source_profile default --profile auditor',
          'aws sts get-caller-identity --profile auditor',
        ],
        hints: ['`aws configure set role_arn <arn> --profile auditor`', 'Y `aws configure set source_profile default --profile auditor`.', 'Prueba con `aws sts get-caller-identity --profile auditor`.'],
        explain: 'La CLI asume el rol automáticamente al usar el perfil. Verás un ARN con `assumed-role/Auditor/…` en vez del de tu usuario.',
        par: 3,
        commands: ['STS', 'aws sts assume-role'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a2-5', { title: 'Mínimo privilegio y buenas prácticas', summary: 'Auditar y dejar solo los permisos necesarios', emoji: '🧱', commands: ['Mínimo privilegio', 'IAM Access Analyzer', 'IAM Identity Center', 'aws iam get-credential-report'], minutes: 12 }, [
      learn(
        'El principio del mínimo privilegio',
        `
**Da a cada identidad solo los permisos que necesita para su tarea, y nada más.** Parece obvio, pero lo normal es lo contrario: «para que funcione, dale \`AdministratorAccess\`». El día que esas claves se filtran, el atacante tiene el mismo poder.

Cómo aplicarlo:

1. **Empieza con nada** y ve añadiendo lo que falte, en vez de empezar con todo y recortar.
2. **Evita \`"Action": "*"\` y \`"Resource": "*"\`** salvo que sea imprescindible.
3. Usa **condiciones** (IP, MFA, región, etiquetas) para acotar aún más.
4. **Revisa a menudo**: quita lo que no se usa. IAM guarda cuándo se usó cada permiso (_last accessed_).
5. Prefiere **roles** y credenciales temporales; rota o elimina las claves de acceso antiguas.
`,
        '🧱',
      ),
      mc('Una aplicación solo necesita leer objetos de un bucket. ¿Qué política respeta el mínimo privilegio?', ['AdministratorAccess', 'AmazonS3FullAccess', 'Allow s3:GetObject sobre ese bucket', 'Allow s3:* sobre *'], 2, 'Solo la acción necesaria (`s3:GetObject`) y solo sobre el recurso concreto.'),
      learn(
        'Herramientas de apoyo',
        `
- **Informe de credenciales** (_credential report_): un CSV con todos los usuarios, si tienen contraseña y MFA, y cuándo se rotaron/usaron sus claves. Es el primer paso de cualquier auditoría.
- **IAM Access Analyzer**: avisa de recursos compartidos con el exterior (buckets, roles…), de permisos sin usar y puede **generar una política** ajustada a lo que un rol realmente hizo según CloudTrail.
- **IAM Identity Center**: la forma recomendada de dar acceso a **personas**, con inicio de sesión único para varias cuentas y credenciales temporales. Reduce la necesidad de usuarios de IAM con contraseña y claves.
- **Límites de permisos** (_permission boundaries_): tope máximo de permisos que un usuario o rol puede llegar a tener (los verás en la zona de seguridad avanzada).
`,
        '🧰',
      ),
      demo(
        'Auditar con el informe de credenciales',
        [
          ['aws iam generate-credential-report --query State --output text', 'Pides a IAM que genere el informe'],
          ['aws iam get-credential-report --query Content --output text | base64 -d | cut -d, -f1,4,8', 'El contenido viene en base64: lo decodificas y te quedas con las columnas usuario, password_enabled y mfa_active'],
        ],
        A('equipo'),
        'Este comando combina la CLI de AWS con herramientas de Linux: justo como se hace en el trabajo real.',
      ),
      tf('«IAM Identity Center permite dar a las personas acceso a varias cuentas sin crear un usuario de IAM en cada una.»', true, 'Es su gran ventaja: un único inicio de sesión y credenciales temporales para cada cuenta y rol.'),
      multi(
        'Marca lo que reduce el riesgo si se filtra una clave de acceso.',
        ['Usar roles y credenciales temporales', 'Darle AdministratorAccess para evitar errores de permisos', 'Rotar y eliminar las claves que no se usan', 'Limitar sus permisos al mínimo imprescindible', 'Compartir la clave entre varias personas'],
        [0, 2, 3],
        'Cuanto menos poder y menos vida tenga la credencial, menos daño puede hacer.',
      ),
      practice({
        prompt:
          'Auditoría rápida: usa el **informe de credenciales** para listar los usuarios que **no tienen MFA activado**. Debe aparecer `ana` y `bob`, pero no `carla`.\n\nPista: la columna 8 del CSV (`mfa_active`) vale `false` o `true`.',
        goal: 'Mostrar los usuarios sin MFA',
        setup: A('equipo'),
        check: all(ran('get-credential-report'), out(['ana', 'bob']), { t: 'output', notIncludes: 'carla' }),
        solution: ['aws iam generate-credential-report', "aws iam get-credential-report --query Content --output text | base64 -d | awk -F, 'NR>1 && $8==\"false\" {print $1}'"],
        hints: ['Genera el informe y luego `aws iam get-credential-report --query Content --output text`.', 'Decodifica con `base64 -d`.', 'Filtra con `awk -F, \'$8=="false" {print $1}\'`.'],
        explain: 'Un informe de credenciales + `awk` bastan para detectar quién se salta el MFA. Con AWS Config o Security Hub puedes automatizar esta comprobación.',
        par: 2,
        commands: ['aws iam get-credential-report'],
      }),
      practice({
        prompt: 'A **`bob`** le pusieron `AdministratorAccess` directamente «para ir más rápido». Quítaselo y dale en su lugar **solo** la política propia `LeerInformes` (`arn:aws:iam::123456789012:policy/LeerInformes`).',
        goal: 'bob solo con la política LeerInformes',
        setup: A('exceso'),
        check: awsIs('iam list-attached-user-policies --user-name bob --query "AttachedPolicies[].PolicyName"', ['LeerInformes'], 'bob debe tener asociada únicamente LeerInformes'),
        solution: [
          'aws iam detach-user-policy --user-name bob --policy-arn arn:aws:iam::aws:policy/AdministratorAccess',
          'aws iam attach-user-policy --user-name bob --policy-arn arn:aws:iam::123456789012:policy/LeerInformes',
        ],
        hints: ['Usa `detach-user-policy` con el ARN de AdministratorAccess.', 'Y `attach-user-policy` con el ARN de LeerInformes.'],
        explain: 'Quitar permisos sobrantes es tan importante como dar los necesarios. Hazlo siempre que descubras un exceso.',
        par: 2,
        commands: ['Mínimo privilegio', 'aws iam attach-group-policy'],
      }),
    ]),
  ],
  boss: {
    prompt:
      'Eres el nuevo responsable de seguridad. Auditando la cuenta encuentras tres fallos:\n\n1. **`dev1`** tiene `AdministratorAccess` asociado directamente a su usuario. Quítaselo y mételo en el grupo **`desarrolladores`** (que ya tiene los permisos adecuados).\n2. **`exempleado`** ya no trabaja aquí, pero su clave de acceso sigue **activa**. Desactívala (Inactive).\n3. La cuenta no tiene política de contraseñas. Pon una de **mínimo 14 caracteres** que exija números y símbolos.',
    goal: 'Corregir los tres fallos de seguridad',
    setup: A('auditoria'),
    check: all(
      awsIs('iam list-attached-user-policies --user-name dev1 --query "AttachedPolicies[]"', [], 'dev1 no debe tener AdministratorAccess directo'),
      awsIs('iam list-groups-for-user --user-name dev1 --query "Groups[].GroupName"', ['desarrolladores'], 'dev1 debe estar en desarrolladores'),
      awsIs('iam list-access-keys --user-name exempleado --query "AccessKeyMetadata[].Status"', ['Inactive'], 'La clave de exempleado debe estar Inactive'),
      awsIs('iam get-account-password-policy --query "PasswordPolicy.[MinimumPasswordLength,RequireNumbers,RequireSymbols]"', [14, true, true], 'Falta la política de contraseñas (14, números y símbolos)'),
    ),
    solution: [
      'aws iam detach-user-policy --user-name dev1 --policy-arn arn:aws:iam::aws:policy/AdministratorAccess',
      'aws iam add-user-to-group --user-name dev1 --group-name desarrolladores',
      'KEY=$(aws iam list-access-keys --user-name exempleado --query "AccessKeyMetadata[0].AccessKeyId" --output text)',
      'aws iam update-access-key --user-name exempleado --access-key-id $KEY --status Inactive',
      'aws iam update-account-password-policy --minimum-password-length 14 --require-numbers --require-symbols',
    ],
    hints: [
      'Para dev1: `detach-user-policy` y luego `add-user-to-group`.',
      'Para la clave: primero `aws iam list-access-keys --user-name exempleado` para ver su ID; luego `update-access-key --status Inactive`.',
      'La política de contraseñas: `aws iam update-account-password-policy --minimum-password-length 14 --require-numbers --require-symbols`.',
    ],
    explain: 'Permisos directos en vez de grupos, claves de personas que se fueron y contraseñas débiles: los tres fallos más típicos de una auditoría de IAM, y los tres se corrigen en un par de comandos.',
    commands: ['Mínimo privilegio', 'aws iam attach-group-policy'],
  },
});

