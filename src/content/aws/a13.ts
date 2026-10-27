import { CONT_FILES, CONT_REPO } from '@/awsengine/scenarios-cont';
import { A, all, awsAfter, awsHas, awsIs, awsMatches, awsWorld, demo, illus, learn, lesson, match, mc, multi, order, practice, predict, tf } from './awsbuild';

const REG = '123456789012.dkr.ecr.us-east-1.amazonaws.com';
const LOGIN = `aws ecr get-login-password | docker login --username AWS --password-stdin ${REG}`;
const HOLA = '_check http --url http://lb:web/';
const SVC = 'ecs describe-services --cluster demo --services tienda';
const SUBNET_VARS = ['S1=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[0].SubnetId" --output text)', 'S2=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[1].SubnetId" --output text)'];
const TSG = 'TSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=task-sg --query "SecurityGroups[0].GroupId" --output text)';
const STOPPED = 'T=$(aws ecs list-tasks --cluster demo --desired-status STOPPED --query "taskArns[0]" --output text)';
const LIFECYCLE = `echo '{"rules":[{"rulePriority":1,"description":"Conserva las 3 ultimas","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}' > ciclo.json`;
const AR_SOURCE = (port: string) => `'{"ImageRepository":{"ImageIdentifier":"${CONT_REPO}:1.0","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"${port}"}},"AuthenticationConfiguration":{"AccessRoleArn":"arn:aws:iam::123456789012:role/apprunner-ecr"}}'`;
const SCALE_TARGET = 'aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --min-capacity 2 --max-capacity 6';
const CPU_POLICY = `aws application-autoscaling put-scaling-policy --policy-name cpu50 --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --policy-type TargetTrackingScaling --target-tracking-scaling-policy-configuration '{"TargetValue":50,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"ScaleOutCooldown":60,"ScaleInCooldown":60}'`;

export const a13 = awsWorld({
  id: 'a13',
  index: 13,
  title: 'Contenedores',
  subtitle: 'Docker, ECR, ECS, Fargate, EKS y App Runner',
  emoji: '📦',
  color: '#38BDF8',
  level: 'intermedio',
  intro:
    'Un contenedor empaqueta tu aplicación con todo lo que necesita y se ejecuta igual en cualquier sitio. En esta zona construyes una imagen con **Docker**, la subes a **ECR** y la ejecutas de tres maneras: **ECS** (el orquestador de AWS) en **Fargate** o en EC2, **EKS** (Kubernetes gestionado) y **App Runner** (de la imagen a una URL sin infraestructura). Aprenderás a repartir las tareas, desplegar sin cortes, depurar los fallos clásicos (etiqueta que no existe, permisos, salud del balanceador, arquitectura equivocada) y a hacer que el servicio escale solo. Todo corre en tu cuenta simulada, con un `docker`, un `aws ecs`/`aws eks` y un `kubectl` que ejecutan de verdad tu aplicación Flask.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('a13-1', { title: 'Contenedores en 10 minutos y ECR', summary: 'Construir una imagen, probarla y subirla al registro privado de AWS', emoji: '🐳', commands: ['Contenedores y Docker', 'Dockerfile', 'docker build', 'docker run', 'docker push', 'Amazon ECR', 'Políticas de ciclo de vida de ECR', 'Escaneo de imágenes en ECR', 'Buenas prácticas con imágenes de contenedor'], minutes: 32 }, [
      learn(
        '«En mi máquina funciona»',
        `
La frase que más tiempo ha hecho perder a los equipos. La causa casi siempre es la misma: *el programa no es solo tu código*; depende del intérprete, de la versión de cada librería, de variables de entorno… y todo eso cambia entre tu portátil, el servidor de pruebas y producción.

Un **contenedor** soluciona esto empaquetando **el programa y su entorno** en una unidad que se ejecuta igual en cualquier sitio con Docker:

- La **imagen** es la receta congelada: capas de solo lectura con el sistema base, las dependencias y tu código. Se nombra \`tienda:1.0\` (nombre y *etiqueta*).
- El **contenedor** es la imagen **en marcha**: un proceso aislado que arranca en segundos y se tira sin pena.
- El **registro** es donde se guardan las imágenes. En AWS: **Amazon ECR**.

No es una máquina virtual: no lleva un sistema operativo completo, comparte el núcleo con el anfitrión. Por eso pesa megas, no gigas… y por eso una imagen para procesadores ARM no corre en un servidor x86.

El ciclo: **Dockerfile → \`docker build\` → \`docker run\` (probar) → \`docker push\` (al registro) → ECS/EKS/App Runner la descargan y la ejecutan.**
`,
        '🐳',
      ),
      illus('aws-container-layers', 'Un Dockerfile son capas con caché', 'Cambia el código, las dependencias y el orden de las instrucciones: mira qué capas se reconstruyen y cuánto se sube a ECR.'),
      mc('¿Qué diferencia a una imagen de un contenedor?', ['Son lo mismo con distinto nombre', 'La imagen es la receta congelada; el contenedor, esa imagen en ejecución', 'El contenedor es la copia de seguridad de la imagen', 'La imagen solo existe en ECR'], 1, 'De una misma imagen puedes arrancar muchos contenedores. La imagen no cambia; el contenedor es un proceso vivo (y su sistema de archivos desaparece al borrarlo).'),
      demo(
        'Tu primer contenedor',
        [
          ['cat app/Dockerfile', 'La receta: base, dependencias antes que el código, y qué ejecutar'],
          ['docker build -t tienda:1.0 app', 'Construye la imagen `tienda:1.0` (una capa por instrucción)'],
          ['docker images', 'Está en tu máquina, con su tamaño'],
          ['docker run -d --name web -p 8080:5000 tienda:1.0', 'Arranca un contenedor: tu puerto 8080 apunta al 5000 de dentro'],
          ['curl -s http://localhost:8080/', 'Responde la aplicación del contenedor'],
          ['docker ps', 'El contenedor en marcha'],
          ['docker logs web', 'Lo que ha escrito el programa por su salida estándar'],
          ['docker stop web', 'Se para; la imagen sigue ahí'],
        ],
        A('base', { files: CONT_FILES.app }),
        'La aplicación es un servidor Flask de cinco líneas. Fíjate en `host=\'0.0.0.0\'` dentro de `app.py`: si escuchara solo en `127.0.0.1`, el puerto publicado no respondería.',
      ),
      predict('¿Qué imprime este contenedor desechable (`--rm`)?', 'docker run --rm python:3.12-slim python -c "print(6 * 7)"', ['6 * 7', 'Hola mundo', 'Error: image not found'], 'Se descarga la imagen base `python:3.12-slim`, se ejecuta el comando que le pasas (sustituye al `CMD` de la imagen), imprime 42 y el contenedor se borra solo por `--rm`.', A('base')),
      practice({
        prompt: 'La carpeta **`app/`** tiene una aplicación Flask con su `Dockerfile`, pero alguien le ha dejado una **errata** y la construcción falla. Arréglala, construye la imagen **`tienda:1.0`**, crea en ECR un repositorio llamado **`tienda`** e **inicia sesión** en el registro con `docker login`, etiqueta la imagen con la dirección del repositorio y **súbela** como `1.0`.',
        goal: 'La imagen tienda:1.0 está en el repositorio de ECR tienda',
        setup: A('base', { files: CONT_FILES.rota }),
        check: awsIs('ecr describe-images --repository-name tienda --query "imageDetails[].imageTags[]"', ['1.0'], 'Todavía no hay una imagen con la etiqueta 1.0 en el repositorio tienda'),
        solution: ["sed -i 's/requirments/requirements/' app/Dockerfile", 'docker build -t tienda:1.0 app', 'aws ecr create-repository --repository-name tienda', LOGIN, `docker tag tienda:1.0 ${REG}/tienda:1.0`, `docker push ${REG}/tienda:1.0`, 'aws ecr list-images --repository-name tienda'],
        hints: ['`docker build -t tienda:1.0 app` te dice qué archivo no encuentra: mira bien cómo se escribe `requirements.txt` en el `Dockerfile` (puedes corregirlo con `sed -i`).', 'Crea el repositorio con `aws ecr create-repository --repository-name tienda`. El registro es `123456789012.dkr.ecr.us-east-1.amazonaws.com`.', `Inicia sesión con \`${LOGIN}\`, etiqueta con \`docker tag tienda:1.0 ${REG}/tienda:1.0\` y sube con \`docker push ${REG}/tienda:1.0\`.`],
        explain: 'La errata (`requirments.txt`) hacía fallar el `COPY`. Para subir a ECR hacen falta tres cosas: el repositorio creado, una sesión de `docker login` (el token lo pide `aws ecr get-login-password` con tu identidad) y un nombre de imagen que lleve la dirección completa del repositorio.',
        par: 6,
        commands: ['docker build', 'docker push', 'Amazon ECR'],
      }),
      learn(
        'ECR: etiquetas, escaneo y limpieza',
        `
**Amazon ECR** es el registro privado de AWS: un **repositorio por aplicación**, con permisos de IAM y sin límites de descarga desde AWS. Cuatro ajustes que conviene conocer:

- **Etiquetas inmutables** (\`IMMUTABLE\`): una etiqueta ya publicada no se puede sobrescribir con otra imagen. Así \`1.0\` siempre significa lo mismo. Evita \`latest\` en producción: no sabes qué versión es ni puedes volver atrás.
- **Escaneo al subir** (\`scanOnPush\`): busca vulnerabilidades conocidas en los paquetes de la imagen.
- **Política de ciclo de vida**: borra imágenes viejas o sin etiqueta («conserva las 3 últimas»). Antes de activarla, mira la **vista previa** (\`start-lifecycle-policy-preview\`).
- **Quién puede descargar**: un servicio necesita \`ecr:GetAuthorizationToken\` y permisos de lectura sobre el repositorio. Las políticas administradas \`AmazonECSTaskExecutionRolePolicy\` y \`AmazonEC2ContainerRegistryReadOnly\` los dan.

Cada imagen tiene además un **digest** (\`sha256:…\`) que identifica su contenido exacto; es lo único realmente inmutable.
`,
        '📦',
      ),
      tf('«Si siempre despliegas la etiqueta `latest`, estás seguro de ejecutar la versión más reciente y puedes volver atrás cuando quieras.»', false, '`latest` es solo una etiqueta que apunta a lo último que alguien subió con ese nombre: no dice qué versión es y, al moverse, no puedes volver a «la de ayer». En producción usa versiones (`1.4.2`) o el hash del commit, y etiquetas inmutables.'),
      practice({
        prompt: 'El repositorio **`tienda`** acumula versiones (de `v1` a `v7`) y ocupa de más. Quieres conservar **solo las 3 más recientes** (sea cual sea su etiqueta) con una política de ciclo de vida —mira antes la vista previa—, y además que las **etiquetas sean inmutables** y que cada imagen nueva **se escanee al subirla**.',
        goal: 'Quedan 3 imágenes, etiquetas inmutables y escaneo al subir activado',
        setup: A('cont-ecr'),
        check: all(awsIs('ecr describe-images --repository-name tienda --query "length(imageDetails)"', 3, 'Deberían quedar solo 3 imágenes (¿la política de ciclo de vida guardada?)'), awsIs('ecr describe-repositories --query "repositories[0].imageTagMutability"', 'IMMUTABLE', 'Las etiquetas del repositorio deberían ser inmutables'), awsIs('ecr describe-repositories --query "repositories[0].imageScanningConfiguration.scanOnPush"', true, 'Falta activar el escaneo al subir')),
        solution: [LIFECYCLE, 'aws ecr start-lifecycle-policy-preview --repository-name tienda --lifecycle-policy-text file://ciclo.json', 'aws ecr put-lifecycle-policy --repository-name tienda --lifecycle-policy-text file://ciclo.json', 'aws ecr put-image-tag-mutability --repository-name tienda --image-tag-mutability IMMUTABLE', 'aws ecr put-image-scanning-configuration --repository-name tienda --image-scanning-configuration scanOnPush=true', 'sleep 120', 'aws ecr describe-images --repository-name tienda --query "length(imageDetails)"'],
        hints: ['Escribe la regla en un archivo: `{"rules":[{"rulePriority":1,"selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}` y pásala con `--lifecycle-policy-text file://ciclo.json`.', '`aws ecr start-lifecycle-policy-preview …` calcula qué se borraría sin borrar nada; `aws ecr put-lifecycle-policy …` guarda la política (ECR la aplica en unos minutos).', 'Las otras dos cosas: `aws ecr put-image-tag-mutability --repository-name tienda --image-tag-mutability IMMUTABLE` y `aws ecr put-image-scanning-configuration --repository-name tienda --image-scanning-configuration scanOnPush=true`.'],
        explain: 'La regla `imageCountMoreThan 3` con `tagStatus any` conserva las 3 imágenes más recientes y marca las demás para borrarse. La vista previa evita sorpresas (borrar la que está en producción). Las etiquetas inmutables y el escaneo al subir son dos protecciones que cuestan una línea cada una.',
        par: 6,
        commands: ['Políticas de ciclo de vida de ECR', 'Amazon ECR', 'Escaneo de imágenes en ECR'],
      }),
      order('Ordena la subida de una imagen a ECR', ['build', 'login', 'tag', 'push'], 'build login tag push', 'Se construye la imagen, se inicia sesión en el registro, se le pone el nombre completo del repositorio (`tag`) y se sube (`push`). El `login` también podría ir antes del `build`, pero siempre antes del `push`.', ['login build tag push']),
      match(
        'Une cada término con su descripción',
        [
          ['Dockerfile', 'La receta de texto para construir la imagen'],
          ['Imagen', 'Capas de solo lectura con tu programa y su entorno'],
          ['Contenedor', 'Una imagen en ejecución, como un proceso aislado'],
          ['Registro', 'El lugar donde se guardan y se descargan las imágenes'],
        ],
        'La cadena completa: el Dockerfile se convierte en una imagen con `docker build`, la imagen se sube a un registro (ECR) con `docker push` y se ejecuta como contenedor con `docker run` o con un servicio de AWS.',
      ),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('a13-2', { title: 'ECS: tareas, servicios y clústeres', summary: 'Las cuatro piezas de ECS, los despliegues graduales y cómo depurar un servicio que no arranca', emoji: '🧩', commands: ['Amazon ECS', 'Definición de tarea de ECS', 'Rol de ejecución y rol de tarea', 'Servicios de ECS y despliegues', 'Registros y métricas de contenedores'], minutes: 36 }, [
      learn(
        'Las cuatro piezas de ECS',
        `
**Amazon ECS** decide *dónde* corre cada contenedor y lo vigila. Hay cuatro conceptos:

| Pieza | Qué es |
| --- | --- |
| **Definición de tarea** | La receta versionada: imágenes, CPU y memoria, puertos, variables, roles y registros. **Inmutable**: cada cambio es una revisión nueva (\`tienda:1\`, \`tienda:2\`…) |
| **Tarea** | Una ejecución de esa receta (uno o varios contenedores juntos) |
| **Servicio** | Mantiene N tareas en marcha, las repone si mueren y las conecta a un balanceador. Hace los despliegues por tandas |
| **Clúster** | La agrupación lógica de tareas y servicios |

Dos formas de ejecutar: **\`run-task\`** (una vez, para procesos por lotes o migraciones) y **\`create-service\`** (siempre arriba, para aplicaciones).

Con la red \`awsvpc\` —obligatoria en Fargate— **cada tarea recibe su propia interfaz de red**, su IP privada y sus grupos de seguridad. Por eso el grupo de seguridad de la tarea es el sitio donde se abre el puerto al balanceador.

Y dos roles de IAM distintos: el **de ejecución** (lo usa ECS para descargar la imagen y escribir los registros) y el **de tarea** (lo usa tu código para llamar a AWS).
`,
        '🧩',
      ),
      mc('Hay que desplegar la versión 2 de la imagen en un servicio de ECS. ¿Qué se hace?', ['Editar la definición de tarea existente', 'Registrar una nueva revisión de la definición y actualizar el servicio para que la use', 'Borrar el clúster y crearlo de nuevo', 'Subir la imagen y esperar: ECS la detecta sola'], 1, 'Las definiciones son inmutables: se registra una revisión (`tienda:2`) con la imagen nueva y se hace `update-service --task-definition tienda:2`. ECS despliega por tandas.'),
      demo(
        'Una tarea suelta en Fargate',
        [
          [SUBNET_VARS[0], 'Una subred de la VPC por defecto'],
          [TSG, 'El grupo de seguridad de las tareas'],
          ['aws ecs describe-task-definition --task-definition tienda --query "taskDefinition.[family,revision,cpu,memory]" --output text', 'La receta: familia, revisión, CPU y memoria'],
          ['aws ecs run-task --cluster demo --task-definition tienda --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$S1],securityGroups=[$TSG],assignPublicIp=ENABLED}" --query "tasks[0].lastStatus" --output text', 'Lanza una tarea: empieza en `PROVISIONING`'],
          ['sleep 90', 'Asignar el servidor, descargar la imagen y arrancar'],
          ['T=$(aws ecs list-tasks --cluster demo --query "taskArns[0]" --output text)', 'El identificador de la tarea'],
          ['aws ecs describe-tasks --cluster demo --tasks $T --query "tasks[0].[lastStatus,containers[0].name]" --output text', '`RUNNING`'],
          ['aws logs filter-log-events --log-group-name /ecs/tienda --query "events[].message" --output text', 'Lo que ha escrito el contenedor, en CloudWatch Logs'],
          ['aws ecs stop-task --cluster demo --task $T --reason "fin de la prueba" --query task.desiredStatus --output text', 'Detiene la tarea'],
        ],
        A('cont-ecs'),
        'Una tarea suelta no se repone al terminar o morir: eso es lo que añade un **servicio**.',
      ),
      predict('¿En qué modo de red está la definición de tarea `tienda`?', 'aws ecs describe-task-definition --task-definition tienda --query "taskDefinition.networkMode" --output text', ['bridge', 'host', 'nat'], 'Fargate solo admite `awsvpc`: cada tarea tiene su propia interfaz de red, su IP y sus grupos de seguridad.', A('cont-ecs')),
      learn(
        'Servicios, balanceador y despliegues',
        `
Un **servicio** convierte tareas sueltas en una aplicación fiable:

- **\`desiredCount\`**: cuántas tareas quieres. Si una muere, ECS lanza otra.
- **Balanceador**: ECS registra cada tarea como destino **por su IP** y solo la da por buena cuando el balanceador la ve sana. El **periodo de gracia** evita que se mate una tarea que aún está arrancando.
- **Despliegue gradual** (*rolling update*): al registrar una revisión nueva y actualizar el servicio, ECS lanza tareas nuevas y retira las viejas respetando dos límites: **\`minimumHealthyPercent\`** (cuánto debe seguir sano) y **\`maximumPercent\`** (cuánto puede haber a la vez).
- **Interruptor de despliegue** (*circuit breaker*) con *rollback*: si las tareas nuevas fallan una y otra vez, el despliegue se marca \`FAILED\` y vuelve a la versión anterior.

**Cuando algo no arranca, el orden de mirada es siempre el mismo:**
1. \`describe-services\` → \`events\` (las frases de ECS: «was unable to place a task», «has started 2 tasks», «is unhealthy in target-group»).
2. \`describe-tasks\` de una tarea **parada** → \`stoppedReason\` y \`stopCode\` (por qué paró).
3. Los registros de CloudWatch de esa tarea.
4. \`elbv2 describe-target-health\`: por qué el balanceador no la da por sana.
`,
        '🚦',
      ),
      illus('aws-ecs-deploy', 'Despliegue gradual de un servicio', 'Cambia los porcentajes y rompe la versión nueva: mira cómo avanza ECS, cuándo se atasca y qué hace el interruptor de despliegue.'),
      mc('Un servicio tiene `minimumHealthyPercent=100` y `maximumPercent=100`. Lanzas un despliegue. ¿Qué ocurre?', ['Se despliega igual de rápido', 'No avanza: no puede lanzar tareas nuevas (no cabe) ni retirar viejas (bajaría de lo sano)', 'Se despliega todo de golpe', 'ECS usa 200 % automáticamente'], 1, 'Con 100/100 no hay margen: lanzar una nueva supera el máximo y retirar una vieja baja de lo sano. Hace falta algo de holgura (p. ej. 100 % mínimo y 200 % máximo, o 50 % mínimo).'),
      practice({
        prompt: 'El servicio **`tienda`** del clúster `demo` no consigue arrancar ninguna tarea (y debería tener **2** atendiendo detrás del balanceador `web`). Averigua **por qué** mirando los eventos del servicio y una tarea parada, y arréglalo **sin tocar la imagen**. En tu directorio tienes `taskdef.json`, una definición correcta de la familia `tienda`.',
        goal: '2 tareas en marcha y la aplicación responde por el balanceador',
        setup: A('cont-ecs-etiqueta', { files: CONT_FILES.taskdef }),
        check: all(awsIs(`${SVC} --query "services[0].runningCount"`, 2, 'Deberían estar en marcha las 2 tareas del servicio'), awsHas(HOLA, 'Hola desde la versi', 'La aplicación debería responder por el balanceador web')),
        solution: [`aws ecs describe-services --cluster demo --services tienda --query "services[0].events[0].message" --output text`, STOPPED, 'aws ecs describe-tasks --cluster demo --tasks $T --query "tasks[0].stoppedReason" --output text', 'aws ecr list-images --repository-name tienda --query "imageIds[].imageTag" --output text', 'aws ecs register-task-definition --cli-input-json file://taskdef.json --query taskDefinition.revision', 'aws ecs update-service --cluster demo --service tienda --task-definition tienda:2', 'aws ecs wait services-stable --cluster demo --services tienda'],
        hints: ['`aws ecs describe-services --cluster demo --services tienda --query "services[0].events[0].message"` y, de una tarea parada (`list-tasks --desired-status STOPPED`), `describe-tasks … --query "tasks[0].stoppedReason"`.', 'El motivo es `CannotPullContainerError … 1.1: not found`: la definición de tarea apunta a una etiqueta que no existe en ECR. Compruébalo con `aws ecr list-images --repository-name tienda`.', 'Registra una revisión correcta con `aws ecs register-task-definition --cli-input-json file://taskdef.json`, actualiza el servicio con `--task-definition tienda:2` y espera con `aws ecs wait services-stable --cluster demo --services tienda`.'],
        explain: 'La definición `tienda:1` apuntaba a la etiqueta `1.1`, que nunca se subió. Cada tarea moría al descargar la imagen y ECS lo iba reintentando con esperas crecientes. Las definiciones no se editan: se registra la revisión 2 con la etiqueta correcta y se actualiza el servicio.',
        par: 6,
        commands: ['Servicios de ECS y despliegues', 'Definición de tarea de ECS', 'Amazon ECS'],
      }),
      learn(
        'Salud del balanceador: tareas que se matan solas',
        `
Otro fallo clásico: las tareas **arrancan bien**, pero ECS las detiene una y otra vez. En \`describe-services\` ves frases como *«(port 5000) is unhealthy in (target-group …) due to (reason Health checks failed with these codes: [404])»*. Quien las mata es ECS, porque el balanceador las da por **no sanas**.

Causas típicas, de más a menos frecuente:

1. **Ruta de salud equivocada**: el grupo de destino pregunta por \`/healthz\` y tu aplicación solo tiene \`/health\` → 404.
2. **La aplicación escucha en \`127.0.0.1\`** (el valor por defecto de Flask) en vez de \`0.0.0.0\`: nadie desde fuera del contenedor puede conectar.
3. **Grupo de seguridad**: el de la tarea no permite el puerto desde el del balanceador (*Target.Timeout*).
4. **Periodo de gracia demasiado corto**: la tarea tarda en arrancar y se mata antes de estar lista.

La pista exacta la da \`aws elbv2 describe-target-health --target-group-arn …\`: \`Target.ResponseCodeMismatch\`, \`Target.FailedHealthChecks\` o \`Target.Timeout\` apuntan a cada causa.
`,
        '🩺',
      ),
      practice({
        prompt: 'El servicio **`tienda`** arranca sus tareas, pero **ECS las sustituye sin parar** y la web `web` casi nunca responde. Descubre qué dice el balanceador sobre las tareas (`describe-target-health`) y corrige la causa **en el grupo de destino `web-tg`** (la aplicación expone `/health`). Al final, el servicio debe estar estable con 2 tareas.',
        goal: 'Servicio estable con 2 tareas y la ruta de salud correcta',
        setup: A('cont-ecs-salud'),
        check: all(awsIs('elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].HealthCheckPath"', '/health', 'La ruta de salud del grupo de destino debería ser /health'), awsIs(`${SVC} --query "services[0].[runningCount,desiredCount]"`, [2, 2], 'El servicio debería tener 2 de 2 tareas en marcha'), awsHas(HOLA, 'Hola desde la versi', 'La web debería responder por el balanceador')),
        solution: ['TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)', 'aws elbv2 describe-target-health --target-group-arn $TG --query "TargetHealthDescriptions[].TargetHealth.[State,Reason]" --output text', 'aws elbv2 modify-target-group --target-group-arn $TG --health-check-path /health', 'sleep 600', 'aws ecs wait services-stable --cluster demo --services tienda'],
        hints: ['`TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)` y luego `aws elbv2 describe-target-health --target-group-arn $TG`: el motivo dice que la ruta responde 404.', 'La aplicación solo tiene `/health`; el grupo de destino pregunta por `/healthz`. Cámbialo con `aws elbv2 modify-target-group --target-group-arn $TG --health-check-path /health`.', 'ECS reintenta con esperas cada vez mayores: dale unos minutos (`sleep 600`) o usa `aws ecs wait services-stable --cluster demo --services tienda`.'],
        explain: 'El balanceador preguntaba por `/healthz` y la aplicación respondía 404, así que daba cada tarea por no sana y ECS la sustituía en bucle (cada vez con más espera). Al corregir la ruta, las tareas nuevas pasan la comprobación y el servicio se estabiliza. Con un interruptor de despliegue y un periodo de gracia razonable el bucle habría sido más corto.',
        par: 4,
        commands: ['Servicios de ECS y despliegues', 'Amazon ECS'],
      }),
      match(
        'Une cada pieza de ECS con su función',
        [
          ['Definición de tarea', 'La receta versionada e inmutable'],
          ['Tarea', 'Una ejecución de esa receta'],
          ['Servicio', 'Mantiene N tareas y las repone'],
          ['Clúster', 'La agrupación lógica donde viven'],
        ],
        'La definición es la receta; la tarea, un plato; el servicio, el que se asegura de que siempre haya N platos; y el clúster, la cocina.',
      ),
      multi('¿Cuáles de estas causas pueden hacer que una tarea de Fargate no llegue a arrancar? (elige todas las correctas)', ['La etiqueta de la imagen no existe en ECR', 'El rol de ejecución no puede descargar de ECR', 'El grupo de registros indicado en `awslogs` no existe', 'El código tiene un error de lógica en una ruta rara'], [0, 1, 2], 'Las tres primeras fallan **antes** de que arranque el contenedor (descarga de la imagen, registros). Un error de lógica en el código solo se ve cuando se ejecuta esa ruta, con la tarea ya en marcha.'),
      tf('«El rol de tarea es el que usa ECS para descargar la imagen de ECR.»', false, 'Eso es el **rol de ejecución**. El rol de tarea lo usa tu código (`boto3`) para llamar a AWS: leer de S3, escribir en DynamoDB…'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('a13-3', { title: 'Fargate frente a EC2, Graviton y Spot', summary: 'Dónde corren las tareas, cuánto cuesta cada opción y cómo ahorrar sin perder fiabilidad', emoji: '🚀', commands: ['AWS Fargate', 'Fargate frente a EC2 en ECS', 'Capacity providers y Fargate Spot'], minutes: 30 }, [
      learn(
        'Dónde corren las tareas',
        `
Una tarea de ECS necesita un servidor donde ejecutarse. Hay dos opciones, el **tipo de lanzamiento**:

- **Fargate**: dices cuánta CPU y memoria necesita la tarea y AWS pone el servidor, lo parchea y lo aísla. **No hay instancias que gestionar**; pagas por vCPU y GB **de cada tarea** y por segundo.
- **EC2**: tú aportas instancias que se registran en el clúster (con el agente de ECS, una AMI optimizada y el nombre del clúster en los datos de usuario). Pagas **las instancias**, estén llenas o vacías, y decides el tamaño, el disco, la GPU… A cambio, mantienes parches, escalado y «empaquetado».

| | Fargate | EC2 |
| --- | --- | --- |
| Servidores | Ninguno | Los tuyos |
| Facturación | Por tarea | Por instancia |
| Arranque | ~30–60 s (descarga la imagen) | Rápido si hay hueco |
| Control | Limitado | Total |

La regla práctica: **empieza por Fargate**. Pasa a EC2 cuando el volumen es grande y estable, necesitas hardware especial (GPU) o el coste justifica el trabajo. Y se pueden **mezclar en el mismo clúster** con *capacity providers*.

Dos palancas más para bajar el coste: **Graviton (ARM)**, ~20 % más barato por vCPU, y **Fargate Spot**, hasta ~70 % más barato a cambio de que AWS pueda interrumpir la tarea con 2 minutos de aviso.
`,
        '🚀',
      ),
      illus('aws-fargate-cost', 'Fargate, Spot, ARM o EC2: ¿cuánto cuesta?', 'Mueve el número de tareas y las horas al día: cuándo gana cada opción y qué trabajo extra tiene EC2.'),
      mc('Tienes 40 tareas pequeñas encendidas 24 horas todos los días, de forma estable durante años. ¿Qué suele salir más barato?', ['Fargate bajo demanda siempre', 'EC2 con Savings Plans, llenando bien las instancias', 'Lambda', 'Da exactamente igual'], 1, 'Con volumen alto y estable, comprometerte con Savings Plans y empaquetar bien las tareas en instancias EC2 baja el coste por vCPU. A cambio gestionas parches, escalado y capacidad desaprovechada. Con poca carga o variable, Fargate suele ganar.'),
      demo(
        'EC2 sin instancias no tiene dónde ejecutar',
        [
          [SUBNET_VARS[0], 'Una subred'],
          [TSG, 'El grupo de seguridad de las tareas'],
          ['aws ecs list-container-instances --cluster demo --query "length(containerInstanceArns)"', 'El clúster no tiene instancias registradas'],
          ['aws ecs run-task --cluster demo --task-definition tienda --launch-type EC2 --network-configuration "awsvpcConfiguration={subnets=[$S1],securityGroups=[$TSG]}" --query "failures[0].reason" --output text', 'En EC2 no hay dónde colocar la tarea'],
          ['aws ecs run-task --cluster demo --task-definition tienda --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$S1],securityGroups=[$TSG],assignPublicIp=ENABLED}" --query "failures" --output text', 'Con Fargate no hay nada previo que preparar: se lanza'],
        ],
        A('cont-ecs'),
        'Con el tipo de lanzamiento EC2 el trabajo previo es tuyo: instancias, AMI de ECS, agente y `ECS_CLUSTER` en los datos de usuario. Con Fargate, ninguno.',
      ),
      learn(
        'Graviton y «exec format error»',
        `
Los procesadores **Graviton** de AWS son ARM (\`arm64\`), no x86. Fargate y EC2 los admiten, y salen más baratos por vCPU. El detalle: **la imagen debe construirse para esa arquitectura**.

\`docker build --platform linux/arm64 -t tienda:arm app\`

Y la definición de tarea tiene que decir dónde se ejecuta:

\`"runtimePlatform": {"cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX"}\`

Si no coinciden (imagen \`arm64\` con tarea \`X86_64\`, o al revés), el contenedor muere **al arrancar** con \`exec format error\` y código de salida 255: el sistema no sabe ejecutar binarios de otra arquitectura. En ECS lo verás como *Essential container in task exited* y, en los registros, \`exec … exec format error\`.

Para soportar las dos arquitecturas con un solo nombre existe la **imagen multiarquitectura** (un *manifest list* con una imagen por plataforma).
`,
        '🔩',
      ),
      practice({
        prompt: 'El servicio **`tienda`** no logra arrancar tareas: acaban de golpe. Mira por qué paran (el motivo de la tarea y los registros de `/ecs/tienda`). La imagen `tienda:arm` está construida **para ARM (Graviton)**, pero la definición de tarea no lo dice. Arréglalo **sin reconstruir la imagen**: en tu directorio tienes `taskdef.json`, la definición de la familia `tienda`.',
        goal: 'La definición de tarea indica ARM64 y las 2 tareas responden',
        setup: A('cont-ecs-arm', { files: CONT_FILES.arm }),
        check: all(awsIs('ecs describe-task-definition --task-definition tienda --query "taskDefinition.runtimePlatform.cpuArchitecture"', 'ARM64', 'La definición de tarea debería indicar la arquitectura ARM64'), awsIs(`${SVC} --query "services[0].runningCount"`, 2, 'Deberían estar en marcha las 2 tareas'), awsHas(HOLA, 'Hola desde la versi', 'La aplicación debería responder por el balanceador')),
        solution: [STOPPED, 'aws ecs describe-tasks --cluster demo --tasks $T --query "tasks[0].[stopCode,containers[0].exitCode]" --output text', 'aws logs filter-log-events --log-group-name /ecs/tienda --query "events[0].message" --output text', `sed -i 's/"memory": "512",/"memory": "512", "runtimePlatform": {"cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX"},/' taskdef.json`, 'aws ecs register-task-definition --cli-input-json file://taskdef.json --query taskDefinition.revision', 'aws ecs update-service --cluster demo --service tienda --task-definition tienda:2', 'aws ecs wait services-stable --cluster demo --services tienda'],
        hints: ['De una tarea parada (`list-tasks --desired-status STOPPED`): `describe-tasks … --query "tasks[0].containers[0].exitCode"` da 255, y los registros dicen `exec format error`.', 'La imagen es `arm64` y la tarea se ejecuta en `X86_64`. En `taskdef.json` añade `"runtimePlatform": {"cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX"}` (por ejemplo con `sed -i` tras la línea `"memory": "512",`).', 'Regístrala con `aws ecs register-task-definition --cli-input-json file://taskdef.json`, actualiza con `aws ecs update-service --cluster demo --service tienda --task-definition tienda:2` y espera con `aws ecs wait services-stable --cluster demo --services tienda`.'],
        explain: '`exec format error` casi siempre significa arquitectura equivocada: un binario `arm64` no se puede ejecutar en un procesador `x86_64`. Al declarar `cpuArchitecture: ARM64` en la definición de tarea, Fargate coloca la tarea en un servidor Graviton, donde la imagen sí funciona (y además sale más barato por vCPU).',
        par: 5,
        commands: ['AWS Fargate', 'Definición de tarea de ECS'],
      }),
      learn(
        'Proveedores de capacidad y Fargate Spot',
        `
Un servicio puede repartir sus tareas entre **proveedores de capacidad** con una **estrategia**. Cada proveedor lleva dos números:

- **\`base\`**: las primeras N tareas van ahí (solo un proveedor puede tener base).
- **\`weight\`**: cómo se reparte **el resto**.

Con 4 tareas, \`FARGATE base=1 weight=1\` y \`FARGATE_SPOT weight=3\`: 1 tarea fija en Fargate bajo demanda y las otras 3 en Spot → **1 + 3**. Si AWS recupera la capacidad Spot, la tarea de base mantiene el servicio vivo mientras ECS repone el resto.

Requisitos y trampas:

- El clúster debe tener asociados \`FARGATE\` y \`FARGATE_SPOT\` (\`put-cluster-capacity-providers\`).
- Pasar de \`launchType\` a una estrategia obliga a un **nuevo despliegue**: \`--force-new-deployment\`.
- Spot es ideal para trabajadores de colas y procesos tolerantes a fallos. **No para una única tarea crítica**: sin base en bajo demanda, un día puede no haber capacidad.
`,
        '🧮',
      ),
      practice({
        prompt: 'El servicio **`tienda`** tiene **4 tareas** en Fargate bajo demanda y cuesta de más. Reconfigura su estrategia de capacidad: **1 tarea fija en `FARGATE`** (base 1, peso 1) y el resto en **`FARGATE_SPOT`** (peso 3). El clúster ya tiene ambos proveedores asociados. Al terminar, deben seguir en marcha las 4 tareas.',
        goal: 'Estrategia FARGATE base 1 + FARGATE_SPOT peso 3 con 4 tareas en marcha',
        setup: A('cont-ecs-spot'),
        check: all(awsIs(`${SVC} --query "services[0].capacityProviderStrategy"`, [{ capacityProvider: 'FARGATE', weight: 1, base: 1 }, { capacityProvider: 'FARGATE_SPOT', weight: 3, base: 0 }], 'La estrategia debería ser FARGATE (base 1, peso 1) y FARGATE_SPOT (peso 3)'), awsIs(`${SVC} --query "services[0].runningCount"`, 4, 'Deberían seguir en marcha las 4 tareas')),
        solution: ['aws ecs update-service --cluster demo --service tienda --capacity-provider-strategy capacityProvider=FARGATE,weight=1,base=1 capacityProvider=FARGATE_SPOT,weight=3 --force-new-deployment', 'aws ecs wait services-stable --cluster demo --services tienda'],
        hints: ['Se cambia con `aws ecs update-service --cluster demo --service tienda --capacity-provider-strategy …` (varios proveedores separados por espacios).', 'Cada proveedor: `capacityProvider=FARGATE,weight=1,base=1` y `capacityProvider=FARGATE_SPOT,weight=3`.', 'Como pasas de `launchType` a una estrategia, añade `--force-new-deployment` y espera con `aws ecs wait services-stable --cluster demo --services tienda`.'],
        explain: 'Con la estrategia, ECS coloca primero la tarea de base en bajo demanda y reparte las 3 restantes en Spot. Si AWS recuperase la capacidad Spot, el servicio nunca se quedaría sin su tarea de base. Es la forma habitual de abaratar un servicio sin jugársela.',
        par: 2,
        commands: ['Capacity providers y Fargate Spot', 'AWS Fargate'],
      }),
      tf('«Fargate Spot es la mejor opción para el único contenedor de un servicio crítico.»', false, 'AWS puede recuperar la capacidad Spot con 2 minutos de aviso, y a veces no hay capacidad disponible. Para un servicio crítico, deja al menos una tarea base en Fargate bajo demanda y usa Spot para el resto.'),
      match(
        'Une cada opción con su característica principal',
        [
          ['Fargate', 'Sin servidores que gestionar; pagas por tarea'],
          ['EC2', 'Instancias tuyas; control total y más trabajo'],
          ['Fargate Spot', 'Muy barato, pero interrumpible con aviso'],
          ['Graviton (ARM)', 'Más barato por vCPU; exige imagen arm64'],
        ],
        'No son excluyentes: un mismo clúster puede mezclar Fargate, Fargate Spot y EC2, y puedes escoger ARM o x86 para cada servicio.',
      ),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('a13-4', { title: 'EKS y Kubernetes en AWS', summary: 'Visión de Kubernetes gestionado: clúster, nodos, manifiestos, acceso y los fallos más comunes', emoji: '☸️', commands: ['Amazon EKS', 'Kubernetes: pods, deployments y servicios', 'kubectl', 'Acceso a EKS'], minutes: 38 }, [
      learn(
        'Kubernetes en cinco minutos',
        `
**Kubernetes** es otro orquestador de contenedores: el más extendido fuera de AWS y con un enorme ecosistema. **Amazon EKS** es Kubernetes gestionado: AWS mantiene el **plano de control** (la API, \`etcd\`, el planificador) en varias zonas; tú aportas los **nodos** donde corren los pods.

| Kubernetes | Qué es | En ECS sería… |
| --- | --- | --- |
| **Pod** | Uno o más contenedores que comparten red y viven juntos | Tarea |
| **Deployment** | «Quiero 3 pods de esta imagen» + actualizaciones graduales | Servicio |
| **Service** | Dirección estable delante de los pods con unas etiquetas; \`LoadBalancer\` crea un balanceador de AWS | Balanceador + grupo de destino |
| **Nodo** | La máquina (EC2 o Fargate) donde corren los pods | Instancia del clúster |

Todo se describe en **manifiestos YAML** y se aplica con \`kubectl apply -f\`. Los objetos se enlazan por **etiquetas**: el \`selector\` del deployment y del servicio debe coincidir con las etiquetas del pod.

**Tres tipos de nodos** en EKS: **grupos de nodos administrados** (EC2 que EKS lanza y repone, lo habitual), **Fargate** (un entorno por pod) y **autogestionados**. Los nodos necesitan un rol de IAM con tres políticas, entre ellas la de **solo lectura de ECR** para poder descargar tus imágenes.
`,
        '☸️',
      ),
      illus('aws-eks-arch', 'Quién gestiona qué en EKS, y quién entra', 'Compara los tipos de nodos y prueba las combinaciones de acceso: sin access entry, con solo lectura o con edición.'),
      mc('En EKS, ¿quién mantiene la API de Kubernetes y su base de datos (etcd)?', ['Tú, en instancias EC2 que reservas', 'AWS: es el plano de control gestionado', 'El grupo de nodos', 'Nadie: no son necesarios'], 1, 'El plano de control lo gestiona AWS en varias zonas (se cobra por hora aunque no haya nodos). Tú te ocupas de los nodos —o de nada, con Fargate— y de tus aplicaciones.'),
      demo(
        'Hablar con el clúster',
        [
          ['aws eks describe-cluster --name tienda --query "cluster.[status,version]" --output text', 'El clúster del laboratorio está activo'],
          ['aws eks list-nodegroups --cluster-name tienda --query nodegroups --output text', 'Un grupo de nodos administrado'],
          ['kubectl get nodes', 'Sin kubeconfig, `kubectl` no sabe adónde ir', 'error'],
          ['aws eks update-kubeconfig --name tienda', 'Escribe en `~/.kube/config` la dirección del clúster y cómo pedir el token'],
          ['kubectl get nodes', 'Dos nodos `Ready` (las instancias del grupo)'],
          ['kubectl get pods -A', 'Los pods del propio EKS (red, proxy, DNS) en `kube-system`'],
        ],
        A('cont-eks'),
        '`kubectl` usa tus credenciales de AWS: ejecuta `aws eks get-token`, que genera un token temporal firmado con tu identidad de IAM. Quien creó el clúster es administrador de Kubernetes.',
      ),
      learn(
        'Desplegar con un manifiesto',
        `
Un manifiesto típico tiene dos objetos separados por \`---\`:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: web}
spec:
  replicas: 2
  selector:
    matchLabels: {app: web}      # a qué pods gestiona
  template:
    metadata:
      labels: {app: web}         # debe coincidir con el selector
    spec:
      containers:
      - name: web
        image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda:1.0
        ports: [{containerPort: 5000}]
        resources: {requests: {cpu: 100m, memory: 128Mi}}
---
apiVersion: v1
kind: Service
metadata: {name: web}
spec:
  type: LoadBalancer             # crea un balanceador de AWS
  selector: {app: web}
  ports: [{port: 80, targetPort: 5000}]
\`\`\`

\`kubectl apply -f app.yaml\` crea (o actualiza) ambos. Un *Service* \`LoadBalancer\` crea un balanceador de red de AWS; su dirección aparece en \`kubectl get svc\` como \`EXTERNAL-IP\` (primero \`<pending>\`, unos minutos después el nombre DNS). Cada pod recibe una **IP de tu subred** (CNI de Amazon VPC) y el balanceador apunta directamente a esas IP.

Para ver cómo va: \`kubectl get pods\`, \`kubectl rollout status deployment/web\`, \`kubectl logs deploy/web\`.
`,
        '📜',
      ),
      practice({
        prompt: 'En tu directorio está **`app.yaml`**: un deployment de la aplicación (2 réplicas, imagen de ECR) y un servicio de tipo `LoadBalancer`. Configura `kubectl` para el clúster **`tienda`**, **despliégalo** y espera a que la aplicación responda a través del balanceador que se crea (tarda unos minutos en tener nombre).',
        goal: 'La aplicación responde por el balanceador del servicio web',
        setup: A('cont-eks', { files: CONT_FILES.manifest }),
        check: awsHas('_check http --url http://k8s:web/', 'Hola desde la versi', 'La aplicación debería responder a través del balanceador del servicio web'),
        solution: ['aws eks update-kubeconfig --name tienda', 'kubectl apply -f app.yaml', 'kubectl rollout status deployment/web', 'sleep 200', 'kubectl get svc web', 'kubectl get pods'],
        hints: ['Primero `aws eks update-kubeconfig --name tienda` (si no, `kubectl` no sabe adónde conectarse).', '`kubectl apply -f app.yaml` crea el deployment y el servicio; sigue el arranque con `kubectl get pods` o `kubectl rollout status deployment/web`.', 'El balanceador tarda un par de minutos: `kubectl get svc web` muestra `<pending>` hasta que aparece su nombre DNS en `EXTERNAL-IP`.'],
        explain: 'El kubeconfig te conecta al clúster, `apply` crea los objetos y el controlador de servicios de EKS crea un balanceador de red con los pods como destinos (por IP). La aplicación responde cuando los pods están listos y el balanceador activo.',
        par: 4,
        commands: ['kubectl', 'Kubernetes: pods, deployments y servicios', 'Amazon EKS'],
      }),
      learn(
        'Cuando un pod no arranca',
        `
Los estados de un pod cuentan lo que pasa (\`kubectl get pods\`):

- **\`Pending\`**: ningún nodo puede alojarlo (\`describe pod\` → *0/2 nodes are available: Insufficient cpu*). Pidió más CPU o memoria de la que cabe, o no hay nodos.
- **\`ContainerCreating\`**: descargando la imagen y preparando la red.
- **\`ImagePullBackOff\`** / **\`ErrImagePull\`**: no puede descargar la imagen. Causas: etiqueta que no existe (*not found*), o el **rol de los nodos no puede leer de ECR** (*401 Unauthorized*).
- **\`CrashLoopBackOff\`**: el contenedor arranca y se cae, y Kubernetes lo reintenta con esperas crecientes. Mira \`kubectl logs\` (y \`--previous\`).
- **\`Running\`** pero sin respuesta: probablemente escucha en \`127.0.0.1\` o el servicio no coincide en etiquetas.

**El primer comando siempre es \`kubectl describe pod <nombre>\`**: la sección *Events* del final cuenta lo que ha ido pasando. Para ver todo lo reciente: \`kubectl get events\`.
`,
        '🔎',
      ),
      mc('Un pod está en `ImagePullBackOff`. ¿Qué comando te da más información sobre el motivo?', ['`kubectl get nodes`', '`kubectl describe pod <nombre>` y leer la sección Events', '`kubectl scale deployment web --replicas=0`', '`aws eks list-clusters`'], 1, '`describe pod` enseña los eventos en orden: *Failed to pull image … not found* (etiqueta) o *401 Unauthorized* (permisos de los nodos). Es la primera parada para cualquier pod que no arranca.'),
      practice({
        prompt: 'Un compañero ha desplegado **`app.yaml`** en el clúster **`tienda`**, pero sus pods se quedan sin arrancar (`ImagePullBackOff`). Haz lo mismo (configura `kubectl` y aplica el manifiesto), averigua **qué dicen los eventos** del pod y **arréglalo sin tocar el manifiesto**: es un problema de **permisos del rol de los nodos (`eksNodeRole`)**. Cuando se resuelva, la aplicación debe responder por el balanceador del servicio `web`.',
        goal: 'Los pods se descargan y arrancan, y la aplicación responde',
        setup: A('cont-eks-roto', { files: CONT_FILES.manifest }),
        check: awsHas('_check http --url http://k8s:web/', 'Hola desde la versi', 'La aplicación debería responder a través del balanceador del servicio web'),
        solution: ['aws eks update-kubeconfig --name tienda', 'kubectl apply -f app.yaml', 'sleep 60', 'kubectl get pods', 'kubectl describe pod -l app=web', 'aws iam attach-role-policy --role-name eksNodeRole --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly', 'sleep 300', 'kubectl get pods', 'kubectl rollout status deployment/web'],
        hints: ['`aws eks update-kubeconfig --name tienda`, `kubectl apply -f app.yaml` y `kubectl get pods`: verás `ErrImagePull` / `ImagePullBackOff`.', '`kubectl describe pod -l app=web`: en Events, *401 Unauthorized* al descargar de ECR. Los nodos usan el rol `eksNodeRole` y le falta la política de **solo lectura de ECR**.', 'Adjúntala: `aws iam attach-role-policy --role-name eksNodeRole --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly`. Kubernetes reintenta la descarga solo (con esperas): espera unos minutos y mira `kubectl get pods`.'],
        explain: 'Los nodos descargan las imágenes con el rol de sus instancias. Sin `AmazonEC2ContainerRegistryReadOnly` ni siquiera pueden pedir el token de ECR (401). Al añadirla, el siguiente reintento de la descarga funciona y los pods arrancan, sin tocar el manifiesto. Es el equivalente en EKS del rol de ejecución de ECS.',
        par: 5,
        commands: ['kubectl', 'Amazon EKS', 'Amazon ECR'],
      }),
      practice({
        prompt: '**Ana** (usuario `ana` de IAM) puede llamar a la API de EKS (`eks:*`), pero `kubectl` le responde *Unauthorized* en el clúster **`tienda`**. Dale acceso de **solo lectura en todo el clúster** usando las entradas de acceso de EKS (*access entries*).',
        goal: 'ana tiene una access entry con la política de solo lectura',
        setup: A('cont-eks-acceso'),
        check: awsIs('eks list-associated-access-policies --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana --query "associatedAccessPolicies[].policyArn"', ['arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy'], 'Ana debería tener asociada la política AmazonEKSViewPolicy'),
        solution: ['aws eks create-access-entry --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana', 'aws eks associate-access-policy --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy --access-scope type=cluster', 'aws eks list-associated-access-policies --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana'],
        hints: ['Primero dala de alta: `aws eks create-access-entry --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana`.', 'Después asóciale una política: `aws eks associate-access-policy … --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy --access-scope type=cluster`.', 'Comprueba con `aws eks list-associated-access-policies --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana`.'],
        explain: 'IAM autentica (quién eres) pero no decide nada dentro de Kubernetes. La *access entry* da de alta a Ana en el clúster y la política `AmazonEKSViewPolicy` con ámbito de clúster le permite leer todo. Sin entrada: *Unauthorized*. Con entrada pero sin política: *Forbidden*.',
        par: 2,
        commands: ['Acceso a EKS', 'Amazon EKS'],
      }),
      tf('«Si un usuario tiene el permiso `eks:*` en IAM, ya puede ejecutar `kubectl get pods` en el clúster.»', false, '`eks:*` solo permite llamar a la **API de AWS** de EKS (crear y describir clústeres…). Para usar la API de **Kubernetes** hay que estar dado de alta en el clúster (access entry) con una política de acceso.'),
      match(
        'Une cada estado de un pod con su causa más probable',
        [
          ['Pending', 'Ningún nodo tiene hueco para él'],
          ['ImagePullBackOff', 'No puede descargar la imagen'],
          ['CrashLoopBackOff', 'El contenedor arranca y se cae una y otra vez'],
          ['ContainerCreating', 'Se está descargando la imagen y preparando la red'],
        ],
        'Cada estado apunta a una fase distinta: planificación (Pending), descarga (ContainerCreating / ImagePullBackOff) y ejecución (CrashLoopBackOff). `describe pod` te dice cuál.',
      ),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('a13-5', { title: 'App Runner, escalado y observabilidad', summary: 'La opción más simple, hacer que un servicio escale solo y cómo elegir entre todas las opciones', emoji: '📈', commands: ['AWS App Runner', 'Application Auto Scaling', 'Registros y métricas de contenedores', 'Contenedores en AWS: cuál elegir'], minutes: 34 }, [
      learn(
        'App Runner: de la imagen a una URL',
        `
**AWS App Runner** es la forma más corta de poner un contenedor en internet: le das la imagen, el puerto en el que escucha, CPU y memoria, y te devuelve una **URL HTTPS** con certificado. No hay VPC, balanceador, clúster ni servidores que configurar. Escala solo según las peticiones simultáneas.

Lo que necesitas:

- La **imagen** en ECR.
- Un **rol de acceso** (confía en \`build.apprunner.amazonaws.com\`, con la política \`AWSAppRunnerServicePolicyForECRAccess\`): lo usa App Runner para **descargar** la imagen.
- El **puerto** de tu aplicación. **El valor por defecto es 8080**: si tu aplicación escucha en otro, App Runner no conseguirá conectar y la creación **falla** (*Health check failed on port '8080'*).

La creación tarda unos minutos (\`OPERATION_IN_PROGRESS\` → \`RUNNING\`). Si falla, el motivo está en el grupo de registros \`/aws/apprunner/<servicio>/<id>/service\` y, la salida de tu aplicación, en el de \`…/application\`. Un servicio \`CREATE_FAILED\` **no se puede arreglar**: se borra y se crea de nuevo bien.
`,
        '🏃',
      ),
      mc('Creas un servicio de App Runner para una aplicación Flask que escucha en el puerto 5000 y no indicas puerto. ¿Qué pasa?', ['Funciona: App Runner detecta el puerto', 'Falla la creación: comprueba el 8080 por defecto y no hay nada escuchando', 'El servicio se crea y devuelve 404 en todo', 'AWS te pide el puerto por consola'], 1, 'El puerto por defecto es 8080. La comprobación de salud intenta conectar ahí, no hay nadie escuchando, y el servicio acaba en CREATE_FAILED con «Health check failed on port 8080».'),
      practice({
        prompt: 'La imagen **`tienda:1.0`** está en ECR y el rol **`apprunner-ecr`** ya existe con permisos para descargarla. Crea un servicio de App Runner llamado **`tienda`** que la sirva (la aplicación escucha en el puerto **5000**) y espera a que esté `RUNNING` y responda por su URL HTTPS.',
        goal: 'El servicio tienda está RUNNING y responde por HTTPS',
        setup: A('cont-apprunner'),
        check: all(awsIs('apprunner list-services --query "ServiceSummaryList[0].Status"', 'RUNNING', 'El servicio tienda debería estar RUNNING'), awsHas('_check http --url https://apprunner:tienda/', 'Hola desde la versi', 'La URL del servicio debería responder')),
        solution: [`aws apprunner create-service --service-name tienda --source-configuration ${AR_SOURCE('5000')} --query Service.Status --output text`, 'sleep 300', 'aws apprunner list-services --query "ServiceSummaryList[0].[ServiceName,Status,ServiceUrl]" --output text', 'U=$(aws apprunner list-services --query "ServiceSummaryList[0].ServiceUrl" --output text)', 'curl -s https://$U/'],
        hints: ['`aws apprunner create-service --service-name tienda --source-configuration …` con el JSON: `ImageRepository` (`ImageIdentifier`, `ImageRepositoryType`, `ImageConfiguration` con el `Port`) y `AuthenticationConfiguration` con `AccessRoleArn`.', `La imagen es \`${CONT_REPO}:1.0\`, el tipo \`ECR\`, el puerto \`"5000"\` y el rol \`arn:aws:iam::123456789012:role/apprunner-ecr\`.`, 'Tarda unos minutos: `sleep 300` y después `aws apprunner list-services`. La URL es `ServiceUrl` (con HTTPS).'],
        explain: 'App Runner descarga la imagen con el rol de acceso, la arranca y comprueba que algo escucha en el puerto configurado; solo entonces publica la URL HTTPS. Con el puerto por defecto (8080) la comprobación habría fallado.',
        par: 3,
        commands: ['AWS App Runner', 'Amazon ECR'],
      }),
      practice({
        prompt: 'El servicio de App Runner **`tienda`** quedó en `CREATE_FAILED`. Averigua **por qué** leyendo los eventos del grupo de registros del servicio (`/aws/apprunner/tienda/…/service`) y déjalo **funcionando**. Recuerda que un servicio fallido no se repara: bórralo y vuelve a crearlo. (La imagen está en ECR y el rol de acceso es `apprunner-ecr`; la aplicación escucha en el 5000.)',
        goal: 'Hay un servicio tienda RUNNING que responde por HTTPS',
        setup: A('cont-apprunner-roto'),
        check: all(awsIs('apprunner list-services --query "length(ServiceSummaryList[?Status==\'RUNNING\'])"', 1, 'Debería haber un servicio en RUNNING'), awsHas('_check http --url https://apprunner:tienda/', 'Hola desde la versi', 'La URL del servicio debería responder')),
        solution: ['G=$(aws logs describe-log-groups --log-group-name-prefix /aws/apprunner/tienda --query "logGroups[0].logGroupName" --output text)', 'aws logs filter-log-events --log-group-name $G --query "events[].message" --output text', 'ARN=$(aws apprunner list-services --query "ServiceSummaryList[0].ServiceArn" --output text)', 'aws apprunner delete-service --service-arn $ARN', 'sleep 120', `aws apprunner create-service --service-name tienda --source-configuration ${AR_SOURCE('5000')} --query Service.Status --output text`, 'sleep 300', 'aws apprunner list-services --query "ServiceSummaryList[].Status" --output text'],
        hints: ['`aws logs describe-log-groups --log-group-name-prefix /aws/apprunner/tienda` y `aws logs filter-log-events --log-group-name <el grupo que acaba en /service>`: dice «Health check failed on port 8080».', 'El servicio se creó con el puerto por defecto (8080) y la aplicación escucha en el 5000. Un `CREATE_FAILED` no se actualiza: `aws apprunner delete-service --service-arn …` (espera un par de minutos).', 'Créalo de nuevo con `ImageConfiguration` con `"Port":"5000"` y espera unos minutos hasta `RUNNING`.'],
        explain: 'Los eventos del servicio lo dejan claro: la comprobación de salud intentó el puerto 8080 y nadie escuchaba. Como un servicio fallido no puede actualizarse, se borra y se crea de nuevo con el puerto correcto. En un servicio sano, un puerto mal puesto se corrige con `update-service`.',
        par: 6,
        commands: ['AWS App Runner', 'Registros y métricas de contenedores'],
      }),
      learn(
        'Que el servicio escale solo',
        `
Con un número fijo de tareas, o pagas el pico todo el día o te quedas corto cuando llega. **Application Auto Scaling** ajusta el \`desiredCount\` del servicio de ECS. Tres pasos:

1. **Registrar el objetivo escalable** con un mínimo y un máximo:
   \`aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --min-capacity 2 --max-capacity 6\`
2. **Crear una política de seguimiento de objetivo** («mantén la CPU media en el 50 %»). Application Auto Scaling calcula cuántas tareas hacen falta y crea por ti las alarmas de CloudWatch.
3. (Opcional) **Acciones programadas** para subir el mínimo antes de un pico conocido.

Cómo se comporta: **sube rápido y baja despacio**. Para subir basta con unos minutos de CPU alta; para bajar exige unos 15 minutos de métrica claramente por debajo del objetivo. Los **enfriamientos** (\`ScaleOutCooldown\`, \`ScaleInCooldown\`) evitan que oscile.

Tres trampas: el **máximo** es un techo duro (si la carga lo supera, la CPU se queda alta); el **mínimo** debe cubrir una subida repentina mientras arrancan tareas nuevas (30–60 s); y con la métrica de peticiones por tarea (\`ALBRequestCountPerTarget\`) hay que dar la **etiqueta exacta** del balanceador y el grupo de destino.
`,
        '📈',
      ),
      illus('aws-container-scaling', 'Seguimiento de objetivo', 'Sube la carga y cambia el objetivo, el mínimo y el máximo: mira cuántas tareas hacen falta y cuándo se queda sin margen.'),
      practice({
        prompt: 'El servicio **`tienda`** (clúster `demo`) tiene 2 tareas fijas. Configura el **escalado automático**: que pueda tener entre **2 y 6** tareas y que una política de **seguimiento de objetivo** mantenga la **CPU media en el 50 %**. Si hay carga sostenida (se comprobará con tráfico), el servicio debe **añadir tareas**.',
        goal: 'Objetivo escalable 2-6 con política de CPU al 50 %; con carga, el servicio sube de 2 tareas',
        setup: A('cont-ecs-vivo'),
        check: all(
          awsIs('application-autoscaling describe-scalable-targets --service-namespace ecs --query "ScalableTargets[0].[MinCapacity,MaxCapacity]"', [2, 6], 'El servicio debería poder escalar entre 2 y 6 tareas'),
          awsIs('application-autoscaling describe-scaling-policies --service-namespace ecs --query "ScalingPolicies[0].TargetTrackingScalingPolicyConfiguration.TargetValue"', 50, 'Falta una política de seguimiento de objetivo con valor 50'),
          awsAfter(['_check load --lb web --rps 150 --minutes 30'], awsMatches(`${SVC} --query "services[0].desiredCount" --output text`, '^[3-6]$', 'Con carga sostenida, el servicio debería haber añadido tareas')),
        ),
        solution: [SCALE_TARGET, CPU_POLICY, 'aws application-autoscaling describe-scaling-policies --service-namespace ecs --query "ScalingPolicies[0].[PolicyName,PolicyType]" --output text'],
        hints: ['Primero se registra el objetivo: `aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --min-capacity 2 --max-capacity 6`.', 'Después la política: `aws application-autoscaling put-scaling-policy --policy-name cpu50 --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --policy-type TargetTrackingScaling --target-tracking-scaling-policy-configuration …`.', 'La configuración: `{"TargetValue":50,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"}}` (puedes añadir `ScaleOutCooldown` y `ScaleInCooldown`).'],
        explain: 'El objetivo escalable fija el rango (2–6) y la política de seguimiento de objetivo calcula cuántas tareas hacen falta para mantener la CPU en el 50 %. Con una carga de 150 peticiones por segundo, 2 tareas se saturan (CPU al 100 %), así que la política sube a 4 en cuanto la alarma de CloudWatch salta; si sigue alta, seguirá subiendo hasta el máximo.',
        par: 2,
        commands: ['Application Auto Scaling', 'Servicios de ECS y despliegues'],
      }),
      learn(
        'Observabilidad y cómo elegir',
        `
**Observabilidad básica de contenedores:**

- **Registros**: el controlador \`awslogs\` envía la salida estándar a CloudWatch Logs. El grupo debe existir y el rol de ejecución debe poder escribir en él. Fija una retención (14 días suele bastar).
- **Métricas del servicio** (\`AWS/ECS\`): \`CPUUtilization\` y \`MemoryUtilization\`; son las que usa el escalado. **Container Insights** añade métricas por tarea (con coste).
- **Del balanceador**: destinos sanos y no sanos, tiempo de respuesta y errores 5xx.
- **Alarmas**: tareas en marcha por debajo de las deseadas, 5xx, CPU alta sostenida.

**Elegir la herramienta** (la más simple que cumpla lo que necesitas):

| Si necesitas… | Elige |
| --- | --- |
| Una función corta disparada por eventos | **Lambda** |
| Una web o API en un contenedor sin infraestructura | **App Runner** |
| Red propia, varios contenedores, tareas por lotes | **ECS con Fargate** |
| Mucho volumen estable, GPU o hardware concreto | **ECS/EKS en EC2** |
| El ecosistema de Kubernetes o portabilidad entre nubes | **EKS** |

Todas usan la **misma imagen de contenedor**: subir de nivel más adelante es posible.
`,
        '🧭',
      ),
      mc('Tienes una API sencilla en un contenedor, un equipo de dos personas y nadie con experiencia en redes ni en Kubernetes. ¿Qué empezarías usando?', ['EKS con nodos autogestionados', 'App Runner', 'ECS en EC2 con tus propias AMI', 'Una instancia EC2 con Docker instalado a mano'], 1, 'App Runner da la URL HTTPS, el balanceo y el escalado sin infraestructura que mantener. Si más adelante necesitas control de red, varios contenedores o tareas por lotes, puedes pasar a ECS con la misma imagen.'),
      multi('Tu servicio escala hasta el máximo (6 tareas) y la CPU sigue por encima del objetivo. ¿Qué puede ayudar? (elige todas las correctas)', ['Subir el máximo de tareas', 'Dar más CPU a cada tarea (otra revisión de la definición)', 'Bajar el mínimo a 1', 'Revisar si la aplicación tiene un cuello de botella (consultas lentas, bucles)'], [0, 1, 3], 'El máximo es un techo duro: subirlo permite más tareas; más CPU por tarea o arreglar un cuello de botella también baja la carga por tarea. Bajar el mínimo no ayuda con la sobrecarga.'),
      match(
        'Une cada servicio con su descripción',
        [
          ['App Runner', 'De la imagen a una URL HTTPS sin infraestructura'],
          ['ECS en Fargate', 'Orquestador de AWS sin servidores que gestionar'],
          ['EKS', 'Kubernetes gestionado por AWS'],
          ['Application Auto Scaling', 'Ajusta el número de tareas según la carga'],
        ],
        'Los tres primeros ejecutan contenedores con distinto equilibrio entre simplicidad y control; el último no ejecuta nada: ajusta cuántas tareas hay.',
      ),
    ]),

  ],
  boss: {
    prompt:
      'Misión final: **«De tu portátil a producción»**. En `app/` tienes el código de la tienda (Flask) con su `Dockerfile`, y `taskdef.json` con la definición de tarea. En la cuenta ya está montado el clúster **`demo`**, el repositorio **`tienda`** de ECR (vacío), el balanceador **`web`** con su grupo de destino **`web-tg`** (puerto 5000, ruta de salud `/health`), los grupos de seguridad `alb-sg` y `task-sg`, el grupo de registros `/ecs/tienda` y el rol `ecsTaskExecutionRole`. Falta **construir, subir y desplegar**. Esto es un despliegue real: según avances te irás encontrando los fallos **de uno en uno** (mira siempre los eventos del servicio, el motivo de las tareas paradas, los registros y la salud de los destinos). Al terminar: la imagen estará en ECR, el servicio **`tienda`** tendrá **2 tareas** estables en Fargate detrás del balanceador (la web responderá), con el **interruptor de despliegue y *rollback*** activado, y **escalará solo entre 2 y 6 tareas** manteniendo la CPU al 50 %.',
    goal: 'Servicio tienda estable con 2 tareas, web respondiendo, interruptor de despliegue y escalado 2-6',
    setup: A('cont-boss', { files: CONT_FILES.boss }),
    check: all(
      awsHas(HOLA, 'Hola desde la versi', 'La web debería responder por el balanceador'),
      awsIs(`${SVC} --query "services[0].[runningCount,deployments[0].rolloutState]"`, [2, 'COMPLETED'], 'El servicio debería tener 2 tareas en marcha y el despliegue completado'),
      awsIs(`${SVC} --query "services[0].deploymentConfiguration.deploymentCircuitBreaker.enable"`, true, 'Falta activar el interruptor de despliegue (con rollback)'),
      awsIs('application-autoscaling describe-scalable-targets --service-namespace ecs --query "ScalableTargets[0].[MinCapacity,MaxCapacity]"', [2, 6], 'El servicio debería escalar entre 2 y 6 tareas'),
      awsIs('application-autoscaling describe-scaling-policies --service-namespace ecs --query "ScalingPolicies[0].PolicyType"', 'TargetTrackingScaling', 'Falta la política de seguimiento de objetivo'),
    ),
    solution: [
      "sed -i \"s/host='127.0.0.1'/host='0.0.0.0'/\" app/app.py",
      'docker build -t tienda:1.0 app',
      LOGIN,
      `docker tag tienda:1.0 ${REG}/tienda:1.0`,
      `docker push ${REG}/tienda:1.0`,
      'aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
      'ALB=$(aws ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId" --output text)',
      TSG,
      'aws ec2 authorize-security-group-ingress --group-id $TSG --protocol tcp --port 5000 --source-group $ALB',
      'aws ecs register-task-definition --cli-input-json file://taskdef.json --query taskDefinition.revision',
      ...SUBNET_VARS,
      'TG=$(aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text)',
      'aws ecs create-service --cluster demo --service-name tienda --task-definition tienda:1 --desired-count 2 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$S1,$S2],securityGroups=[$TSG],assignPublicIp=ENABLED}" --load-balancers targetGroupArn=$TG,containerName=web,containerPort=5000 --health-check-grace-period-seconds 30 --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}"',
      'aws ecs wait services-stable --cluster demo --services tienda',
      SCALE_TARGET,
      CPU_POLICY,
      'DNS=$(aws elbv2 describe-load-balancers --names web --query "LoadBalancers[0].DNSName" --output text)',
      'curl -s http://$DNS/',
    ],
    hints: [
      'Empieza por la imagen: `docker build -t tienda:1.0 app`, `aws ecr get-login-password | docker login …`, `docker tag` con la dirección de tu repositorio y `docker push`. Después registra la definición (`aws ecs register-task-definition --cli-input-json file://taskdef.json`) y crea el servicio con `create-service` (Fargate, red `awsvpc` con las dos subredes por defecto y el grupo `task-sg`, `--load-balancers targetGroupArn=…,containerName=web,containerPort=5000`).',
      'Primer fallo probable: las tareas no arrancan (`stoppedReason`: *unable to pull secrets or registry auth … AccessDenied*): el rol de ejecución no tiene permisos. Añade la política `service-role/AmazonECSTaskExecutionRolePolicy` a `ecsTaskExecutionRole`. Segundo: el balanceador las da por no sanas con *Target.Timeout*: el grupo `task-sg` no deja entrar el puerto 5000 desde `alb-sg` (`aws ec2 authorize-security-group-ingress --group-id … --protocol tcp --port 5000 --source-group …`).',
      'Tercer fallo: *Target.FailedHealthChecks* aunque la red está bien. Mira los registros de `/ecs/tienda`: el servidor dice `Running on http://127.0.0.1:5000`; escucha solo dentro del contenedor. Cambia `host=\'127.0.0.1\'` por `0.0.0.0` en `app.py`, reconstruye, sube (por ejemplo como `1.1`), registra otra revisión con esa imagen y actualiza el servicio. Por último, `register-scalable-target` (2–6) y `put-scaling-policy` de CPU al 50 %; el interruptor se activa con `--deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}"`.',
    ],
    explain: 'Has hecho el recorrido completo de un despliegue en contenedores: Dockerfile → imagen → ECR → definición de tarea → servicio de ECS detrás de un ALB → escalado. Y has depurado los tres fallos más clásicos, cada uno con su pista: **permisos del rol de ejecución** (la tarea ni arranca), **grupo de seguridad** (el balanceador no llega: *Target.Timeout*) y **la aplicación escuchando solo en 127.0.0.1** (llega pero no responde: *FailedHealthChecks*). El interruptor de despliegue con *rollback* protege las próximas versiones, y la política de seguimiento de objetivo ajusta las tareas a la carga.',
    commands: ['Amazon ECS', 'Amazon ECR', 'Application Auto Scaling', 'Servicios de ECS y despliegues'],
  },
});
