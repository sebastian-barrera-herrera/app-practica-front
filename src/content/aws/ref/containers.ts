import type { AwsRef } from '../reference';

const REG = '123456789012.dkr.ecr.us-east-1.amazonaws.com';
const LOGIN = `aws ecr get-login-password | docker login --username AWS --password-stdin ${REG}`;

/** Crea la aplicación de ejemplo (Flask) con su Dockerfile en ./app. */
const MK_APP = String.raw`mkdir -p app
cat > app/app.py <<'EOF'
from flask import Flask
app = Flask(__name__)

@app.route('/')
def home():
    return 'Hola desde un contenedor'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
EOF
echo 'flask==3.0.3' > app/requirements.txt
cat > app/Dockerfile <<'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
EOF`;

const SUBNETS = [
  'S1=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[0].SubnetId" --output text)',
  'S2=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[1].SubnetId" --output text)',
] as const;
const TSG = 'TSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=task-sg --query "SecurityGroups[0].GroupId" --output text)';
const TD = String.raw`cat > td.json <<'EOF'
{
  "family": "demo-web",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "containerDefinitions": [{
    "name": "web",
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda:1.0",
    "essential": true,
    "portMappings": [{"containerPort": 5000}],
    "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "/ecs/tienda", "awslogs-region": "us-east-1", "awslogs-stream-prefix": "web"}}
  }]
}
EOF`;

export const AWS_REF_CONTAINERS: AwsRef[] = [
  // ───────────────────────── Docker ─────────────────────────
  {
    name: 'Contenedores y Docker',
    kind: 'concepto',
    category: 'contenedores',
    level: 1,
    summary: 'Un contenedor empaqueta tu programa con todo lo que necesita (intérprete, librerías, configuración) y se ejecuta igual en tu portátil, en el servidor de pruebas y en AWS.',
    details: `
**Imagen** y **contenedor** no son lo mismo:

- La **imagen** es la receta congelada: capas de solo lectura con el sistema base, las dependencias y tu código. Se identifica por un nombre y una **etiqueta** (\`tienda:1.0\`) y por un **digest** (\`sha256:…\`) que cambia si cambia cualquier byte.
- El **contenedor** es una imagen **en marcha**: un proceso aislado (con su propio sistema de archivos, red y usuarios) que comparte el núcleo del sistema anfitrión. Arranca en segundos, pesa megas y se tira sin pena.
- El **registro** (*registry*) es donde viven las imágenes: Docker Hub, **Amazon ECR**, GitHub…

Frente a una máquina virtual, un contenedor no lleva su propio sistema operativo completo: por eso es más ligero, pero comparte el núcleo (y la arquitectura de CPU: una imagen \`arm64\` no corre en un servidor \`x86\`).

El ciclo de trabajo: **escribir un Dockerfile → \`docker build\` → \`docker run\` para probar → \`docker push\` al registro → el servicio (ECS, EKS, App Runner) descarga la imagen y la ejecuta**.
`,
    whenUse: ['Cuando quieres que «funciona en mi máquina» signifique «funciona en producción»', 'Para desplegar varias copias idénticas de una misma aplicación', 'Para empaquetar dependencias que no quieres instalar a mano en cada servidor'],
    whenNot: ['Para guardar datos que deben sobrevivir: el sistema de archivos del contenedor desaparece con él (usa S3, EFS, una base de datos)', 'Si el programa son tres líneas que se ejecutan de vez en cuando: una función Lambda es más simple', 'Como sustituto de seguridad: el aislamiento es bueno, no es una máquina virtual'],
    versus: [
      ['Máquina virtual (EC2)', 'Incluye su propio sistema operativo: más pesada y lenta de arrancar, pero con aislamiento total.'],
      ['Función Lambda', 'Tú solo subes código; AWS decide cómo ejecutarlo. Con contenedores controlas todo el entorno.'],
    ],
    scenario: 'base',
    examples: [
      [MK_APP, 'La aplicación de ejemplo y su Dockerfile'],
      ['docker build -t tienda:1.0 app', 'Construye la imagen: una capa por instrucción del Dockerfile'],
      ['docker images', 'Las imágenes locales, con su etiqueta y tamaño'],
      ['docker run -d --name web -p 8080:5000 tienda:1.0', 'Arranca un contenedor: el puerto 8080 de tu máquina apunta al 5000 del contenedor'],
      ['curl -s http://localhost:8080/', 'Responde la aplicación del contenedor'],
      ['docker ps', 'Los contenedores en marcha'],
      ['docker logs web', 'Lo que ha escrito el proceso por la salida estándar'],
      ['docker stop web', 'Para el contenedor (la imagen sigue ahí)'],
      ['docker run --rm tienda:1.0 python -c "print(2 + 3)"', 'Se puede cambiar el comando de la imagen; `--rm` borra el contenedor al terminar'],
    ],
    seeAlso: ['Dockerfile', 'Amazon ECR', 'Amazon ECS'],
  },
  {
    name: 'Dockerfile',
    kind: 'concepto',
    category: 'contenedores',
    level: 1,
    summary: 'El archivo de texto que describe cómo construir una imagen: de qué base partir, qué copiar, qué instalar y qué ejecutar. Cada instrucción crea una capa.',
    details: `
\`\`\`
FROM python:3.12-slim          # imagen base
WORKDIR /app                   # directorio de trabajo
COPY requirements.txt .        # copia solo las dependencias…
RUN pip install -r requirements.txt   # …y las instala
COPY . .                       # ahora el código
EXPOSE 5000                    # documenta el puerto
CMD ["python", "app.py"]       # qué se ejecuta al arrancar
\`\`\`

- Cada instrucción (\`RUN\`, \`COPY\`, \`ADD\`) genera una **capa** que se guarda en caché. Si no cambia ni la instrucción ni lo que copia, Docker reutiliza la capa: **por eso se copian primero las dependencias y después el código** (el código cambia cada día; las dependencias, casi nunca).
- \`CMD\` es lo que se ejecuta por defecto (se puede sustituir al hacer \`docker run imagen otro-comando\`); \`ENTRYPOINT\` fija el programa y \`CMD\` sus argumentos por defecto.
- \`ENV\` define variables de entorno; \`ARG\`, variables solo para la construcción.
- La aplicación **debe escuchar en \`0.0.0.0\`**: si escucha solo en \`127.0.0.1\` (el valor por defecto de Flask), nadie desde fuera del contenedor puede conectarse.
- Un \`.dockerignore\` evita copiar \`.git\`, \`__pycache__\`, secretos…
`,
    whenUse: ['Siempre que construyas una imagen propia'],
    whenNot: ['No metas secretos en el Dockerfile (acaban en las capas): pásalos al ejecutar, con Secrets Manager o variables de entorno del servicio'],
    scenario: 'base',
    examples: [
      [MK_APP, 'Un Dockerfile con las dependencias antes que el código'],
      ['docker build -t tienda:1.0 app', 'Primera construcción: todas las capas se crean'],
      ['echo "# cambio" >> app/app.py && docker build -t tienda:1.1 app', 'Solo cambia el código: las capas anteriores se reutilizan (`Using cache`)'],
      ['docker history tienda:1.1', 'Las capas de la imagen y lo que ocupa cada una'],
      ['sed -i "s/COPY requirements.txt/COPY requirments.txt/" app/Dockerfile && docker build -t tienda:rota app', 'Una errata en el nombre de un archivo: la construcción falla', 'error'],
    ],
    seeAlso: ['Contenedores y Docker', 'docker build'],
  },
  {
    name: 'docker build',
    kind: 'comando',
    category: 'contenedores',
    level: 1,
    summary: 'Construye una imagen a partir de un Dockerfile y de los archivos de una carpeta (el «contexto»).',
    usage: 'docker build -t nombre:etiqueta [--platform linux/arm64] [--build-arg K=V] carpeta',
    details: `
- \`-t nombre:etiqueta\` pone nombre a la imagen. Sin etiqueta se usa \`latest\`: **evítala en producción**, porque no dice qué versión es.
- \`--platform linux/arm64\` construye para procesadores ARM (**Graviton**); sin él se construye para la arquitectura de tu máquina. Una imagen \`arm64\` en un servidor \`x86\` falla con *exec format error*.
- El **contexto** es la carpeta que le pasas: todo lo que \`COPY\` puede ver.
`,
    scenario: 'base',
    examples: [
      [MK_APP, 'La aplicación y su Dockerfile'],
      ['docker build -t tienda:1.0 app', 'Construcción normal'],
      ['docker build -t tienda:arm --platform linux/arm64 app', 'Para Graviton (arm64)'],
      ['docker images --format "{{.Repository}}:{{.Tag}}"', 'Las dos etiquetas'],
    ],
    seeAlso: ['Dockerfile', 'docker run'],
  },
  {
    name: 'docker run',
    kind: 'comando',
    category: 'contenedores',
    level: 1,
    summary: 'Arranca un contenedor a partir de una imagen: publica puertos, pasa variables de entorno y puede sustituir el comando.',
    usage: 'docker run [-d] [--name n] [-p host:contenedor] [-e K=V] [--rm] imagen [comando]',
    details: `
- \`-d\` lo deja en segundo plano; sin él, la terminal se queda enganchada a su salida.
- \`-p 8080:5000\` publica el puerto 5000 del contenedor en el 8080 de tu máquina.
- \`-e VERSION=2\` define una variable de entorno (también \`--env-file\`).
- \`--rm\` borra el contenedor al terminar.
- Después de la imagen puedes escribir otro comando: sustituye al \`CMD\` del Dockerfile.

Si el contenedor se para solo: \`docker ps -a\` (aparece con su código de salida) y \`docker logs nombre\` (el porqué).
`,
    scenario: 'base',
    examples: [
      [MK_APP, 'La aplicación de ejemplo'],
      ['docker build -t tienda:1.0 app', 'Construye la imagen'],
      ['docker run -d --name v2 -e VERSION=2 -p 8081:5000 tienda:1.0', 'Segundo plano, puerto publicado y una variable de entorno'],
      ['curl -sf http://localhost:8081/health', 'Una ruta que no existe: 404 (con `-f`, curl falla)', 'error'],
      ['docker ps --format "{{.Names}} {{.Ports}}"', 'Nombre y puertos'],
      ['docker run --rm tienda:1.0 python -c "raise SystemExit(3)"', 'Un comando que falla: el código de salida de `docker run` es el del proceso', 'error'],
      ['docker ps -a', 'Con `-a` aparecen también los contenedores parados'],
    ],
    seeAlso: ['docker build', 'Contenedores y Docker'],
  },
  {
    name: 'docker push',
    kind: 'comando',
    category: 'contenedores',
    level: 1,
    summary: 'Sube una imagen a un registro. Para ECR hay que iniciar sesión primero y nombrar la imagen con la dirección completa del repositorio.',
    usage: 'aws ecr get-login-password | docker login --username AWS --password-stdin <cuenta>.dkr.ecr.<región>.amazonaws.com\ndocker tag tienda:1.0 <cuenta>.dkr.ecr.<región>.amazonaws.com/tienda:1.0\ndocker push <cuenta>.dkr.ecr.<región>.amazonaws.com/tienda:1.0',
    details: `
1. **\`aws ecr get-login-password\`** pide a AWS un token de 12 horas **a nombre de la identidad que ejecuta la CLI**. \`docker login\` lo guarda. Sin sesión: *no basic auth credentials*.
2. **\`docker tag\`** da a la imagen local el nombre completo del repositorio (\`registro/repositorio:etiqueta\`).
3. **\`docker push\`** sube solo las capas que el registro no tiene.

Para subir hace falta permiso de IAM sobre ese repositorio (\`ecr:PutImage\`, \`ecr:InitiateLayerUpload\`…). Si el repositorio no existe: *repository does not exist*.
`,
    scenario: 'base',
    examples: [
      [MK_APP, 'La aplicación de ejemplo'],
      ['docker build -t tienda:1.0 app', 'Construye la imagen'],
      [`docker push ${REG}/tienda:1.0`, 'Sin tag con el nombre del repositorio ni sesión iniciada: falla', 'error'],
      ['aws ecr create-repository --repository-name tienda --query repository.repositoryUri --output text', 'El repositorio, con la dirección que hay que usar'],
      [LOGIN, 'Inicia sesión en el registro de tu cuenta'],
      [`docker tag tienda:1.0 ${REG}/tienda:1.0`, 'El nombre completo'],
      [`docker push ${REG}/tienda:1.0`, 'Sube las capas'],
      ['aws ecr list-images --repository-name tienda --query "imageIds[].imageTag" --output text', 'La etiqueta ya está en ECR'],
    ],
    seeAlso: ['Amazon ECR', 'docker build'],
  },

  // ───────────────────────── ECR ─────────────────────────
  {
    name: 'Amazon ECR',
    kind: 'servicio',
    category: 'contenedores',
    level: 1,
    summary: 'El registro privado de imágenes de contenedor de AWS: guarda, versiona y escanea tus imágenes, y ECS, EKS, Lambda y App Runner las descargan con permisos de IAM.',
    details: `
- Un **repositorio** por aplicación: \`123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda\`. Dentro, imágenes con **etiquetas** (\`1.0\`, \`1.1\`…) y un **digest** inmutable.
- **Etiquetas inmutables** (\`IMMUTABLE\`): una etiqueta no se puede volver a escribir con otra imagen. Evita que \`1.0\` signifique cosas distintas con el tiempo.
- **Escaneo al subir** (\`scanOnPush\`): busca vulnerabilidades conocidas en los paquetes de la imagen. El escaneo mejorado (Inspector) es continuo.
- **Ciclo de vida**: reglas que borran imágenes viejas o sin etiqueta («conserva las 10 últimas»).
- **Permisos**: de IAM (identidad) y del propio repositorio (política de recurso, p. ej. otra cuenta). Quien **descarga** necesita \`ecr:GetAuthorizationToken\` + \`ecr:BatchGetImage\` + \`ecr:GetDownloadUrlForLayer\`; el rol de ejecución de ECS y el rol de los nodos de EKS los obtienen de políticas administradas (\`AmazonECSTaskExecutionRolePolicy\`, \`AmazonEC2ContainerRegistryReadOnly\`).
- **Red**: desde subredes privadas sin NAT hacen falta **endpoints de VPC** (\`ecr.api\`, \`ecr.dkr\` y el de S3, porque las capas están en S3).
`,
    whenUse: ['Para guardar las imágenes que ejecutas en AWS', 'Cuando quieres escaneo de vulnerabilidades y control de acceso con IAM', 'Para replicar imágenes entre regiones o cuentas'],
    whenNot: ['Si necesitas distribuir imágenes públicamente: ECR Public', 'Para guardar archivos que no son imágenes de contenedor: S3'],
    pricing: 'Pagas el almacenamiento (por GB al mes) y la transferencia de datos hacia fuera de la región. Descargar dentro de la misma región es gratis. Borra imágenes viejas con reglas de ciclo de vida.',
    limits: ['Hasta 10.000 repositorios por región y 100.000 imágenes por repositorio (por defecto)', 'Una imagen puede tener hasta 1.000 etiquetas'],
    versus: [
      ['Docker Hub', 'Público y gratuito con límites de descargas; ECR se integra con IAM y no tiene límites de descarga desde AWS.'],
      ['S3', 'Guarda archivos; ECR entiende capas e imágenes y habla el protocolo del registro.'],
    ],
    scenario: 'cont-ecr',
    examples: [
      ['aws ecr describe-repositories --query "repositories[0].[repositoryName,imageTagMutability,imageScanningConfiguration.scanOnPush]" --output text', 'Por defecto: etiquetas mutables y sin escaneo'],
      ['aws ecr put-image-tag-mutability --repository-name tienda --image-tag-mutability IMMUTABLE', 'Ahora una etiqueta no puede reescribirse'],
      ['aws ecr put-image-scanning-configuration --repository-name tienda --image-scanning-configuration scanOnPush=true', 'Escanea cada imagen nueva'],
      ['aws ecr describe-images --repository-name tienda --query "length(imageDetails)"', 'Siete imágenes'],
      ['aws ecr describe-images --repository-name tienda --query "sort_by(imageDetails,&imagePushedAtTime)[-1].imageTags" --output text', 'La última subida'],
      ['aws ecr get-login-password | wc -c', 'El token de `docker login`: una cadena larga que vale 12 horas'],
    ],
    seeAlso: ['docker push', 'Políticas de ciclo de vida de ECR', 'Escaneo de imágenes en ECR'],
  },
  {
    name: 'Políticas de ciclo de vida de ECR',
    kind: 'concepto',
    category: 'contenedores',
    level: 2,
    summary: 'Reglas que borran automáticamente imágenes antiguas o sin etiqueta para que el repositorio no crezca (ni cueste) sin límite.',
    details: `
Cada regla tiene una **prioridad** (se evalúan de menor a mayor número), una **selección** y una **acción** (\`expire\`):

\`\`\`json
{"rules":[{"rulePriority":1,"description":"Conserva las 3 últimas",
  "selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},
  "action":{"type":"expire"}}]}
\`\`\`

- \`tagStatus\`: \`tagged\` (con \`tagPrefixList\`), \`untagged\` o \`any\` (la regla \`any\` debe tener la prioridad más alta).
- \`countType\`: \`imageCountMoreThan\` (conserva las N más recientes) o \`sinceImagePushed\` (borra las anteriores a N días).

**Primero la vista previa**: \`start-lifecycle-policy-preview\` te dice qué se borraría sin borrar nada. Una regla mal escrita (\`any\` con \`countNumber 1\`) puede dejarte sin la imagen que está en producción.
`,
    whenUse: ['En todos los repositorios que reciben imágenes de una canalización de CI', 'Para limpiar imágenes sin etiqueta que dejan los `push` repetidos'],
    whenNot: ['Sin revisar antes la vista previa', 'Si necesitas conservar imágenes por auditoría: etiquétalas con un prefijo y exclúyelas con otra regla'],
    scenario: 'cont-ecr',
    examples: [
      ['echo \'{"rules":[{"rulePriority":1,"description":"Conserva las 3 ultimas","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}\' > ciclo.json', 'La regla en un archivo'],
      ['aws ecr start-lifecycle-policy-preview --repository-name tienda --lifecycle-policy-text file://ciclo.json', 'Vista previa: no borra nada'],
      ['aws ecr get-lifecycle-policy-preview --repository-name tienda --query "previewResults[].imageTags[0]" --output text', 'Lo que se borraría (las 4 más antiguas)'],
      ['aws ecr put-lifecycle-policy --repository-name tienda --lifecycle-policy-text file://ciclo.json --query lifecyclePolicyText --output text', 'La política queda guardada'],
      ['sleep 120', 'ECR la aplica en pocos minutos (aquí, dos de reloj virtual)'],
      ['aws ecr describe-images --repository-name tienda --query "length(imageDetails)"', 'Quedan 3'],
      ['aws ecr put-lifecycle-policy --repository-name tienda --lifecycle-policy-text \'{"rules":[]}\'', 'Sin reglas no es una política válida', 'error'],
    ],
    seeAlso: ['Amazon ECR'],
  },
  {
    name: 'Escaneo de imágenes en ECR',
    kind: 'concepto',
    category: 'contenedores',
    level: 2,
    summary: 'ECR compara los paquetes de cada imagen con una base de vulnerabilidades conocidas (CVE) y te dice cuáles tiene, con su gravedad y la versión que lo arregla.',
    details: `
- **Escaneo básico**: se lanza al subir (\`scanOnPush\`) o a mano (\`start-image-scan\`); es gratis.
- **Escaneo mejorado** (Amazon Inspector): continuo, también para dependencias del lenguaje (pip, npm…); tiene coste.
- Resultado: recuento por gravedad (\`CRITICAL\`, \`HIGH\`, \`MEDIUM\`, \`LOW\`) y lista de hallazgos con el paquete, la versión instalada y, si existe, la versión corregida.

Una imagen con vulnerabilidades críticas **no debería llegar a producción**: engancha el resultado a la canalización (falla el paso si hay \`CRITICAL\`). Y recuerda que las vulnerabilidades aparecen *después* de construir: reconstruye periódicamente sobre la base actualizada.
`,
    whenUse: ['En todos los repositorios de producción (activa `scanOnPush`)', 'Antes de promocionar una imagen a producción'],
    whenNot: ['No sustituye a revisar tu propio código ni a los permisos del contenedor'],
    scenario: 'cont-ecr',
    examples: [
      ['aws ecr start-image-scan --repository-name tienda --image-id imageTag=v1', 'Escanea una imagen concreta'],
      ['sleep 30', 'El escaneo tarda un poco'],
      ['aws ecr describe-image-scan-findings --repository-name tienda --image-id imageTag=v1 --query "imageScanStatus.status" --output text', '`COMPLETE`'],
      ['aws ecr describe-image-scan-findings --repository-name tienda --image-id imageTag=v1 --query "imageScanFindings.findingSeverityCounts"', 'Cuántos hallazgos de cada gravedad'],
    ],
    seeAlso: ['Amazon ECR'],
  },

  // ───────────────────────── ECS ─────────────────────────
  {
    name: 'Amazon ECS',
    kind: 'servicio',
    category: 'contenedores',
    level: 2,
    summary: 'El orquestador de contenedores propio de AWS: tú describes qué contenedores quieres y cuántos, y ECS los coloca, los vigila y los sustituye si fallan. Más simple que Kubernetes y muy integrado con IAM, ALB y CloudWatch.',
    details: `
Cuatro piezas:

| Pieza | Qué es |
| --- | --- |
| **Definición de tarea** (*task definition*) | La receta versionada: imágenes, CPU y memoria, puertos, variables, roles y registros |
| **Tarea** (*task*) | Una ejecución de esa receta (uno o varios contenedores que viven juntos) |
| **Servicio** (*service*) | Mantiene N tareas en marcha, las repone y las conecta a un balanceador; hace los despliegues por tandas |
| **Clúster** | La agrupación lógica de tareas y servicios |

Dónde corren las tareas: en **Fargate** (sin servidores) o en **instancias EC2** tuyas que se registran en el clúster. Con la red \`awsvpc\` **cada tarea tiene su propia interfaz de red**, su IP y sus grupos de seguridad.

Tareas sueltas (\`run-task\`: procesos por lotes, migraciones) frente a servicios (\`create-service\`: aplicaciones que deben estar siempre arriba).
`,
    whenUse: ['Contenedores en AWS sin la complejidad de Kubernetes', 'Aplicaciones web detrás de un ALB y tareas por lotes', 'Cuando quieres integración directa con IAM, CloudWatch y Auto Scaling'],
    whenNot: ['Si necesitas el ecosistema de Kubernetes (Helm, operadores) o portabilidad entre nubes: EKS', 'Si solo quieres una URL para tu imagen y nada más: App Runner'],
    pricing: 'El clúster y el servicio ECS no cuestan nada. Pagas el cómputo: por vCPU y GB por segundo en Fargate, o las instancias EC2 que uses. Más balanceador, registros y transferencia.',
    limits: ['Hasta 5.000 servicios por clúster y 5.000 tareas por servicio (por defecto)', 'Hasta 10 contenedores por definición de tarea'],
    versus: [
      ['EKS', 'Kubernetes gestionado: más potente y más complejo; tienes que aprender sus conceptos.'],
      ['App Runner', 'Aún más simple: sin red ni balanceador que montar; menos control.'],
      ['Lambda', 'Sin contenedor permanente; límite de 15 minutos por ejecución.'],
    ],
    scenario: 'cont-ecs',
    examples: [
      ['aws ecs describe-clusters --clusters demo --query "clusters[0].[clusterName,status,runningTasksCount]" --output text', 'El clúster, vacío'],
      ['aws ecs list-task-definitions --query "taskDefinitionArns" --output text', 'Hay una definición de tarea registrada'],
      ['aws ecs describe-task-definition --task-definition tienda --query "taskDefinition.[family,revision,cpu,memory,networkMode]" --output text', 'Familia, revisión, CPU, memoria y modo de red'],
      [SUBNETS[0], 'Una subred'],
      [TSG, 'El grupo de seguridad de las tareas'],
      ['aws ecs run-task --cluster demo --task-definition tienda --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$S1],securityGroups=[$TSG],assignPublicIp=ENABLED}" --query "tasks[0].lastStatus" --output text', 'Una tarea suelta: empieza en PROVISIONING'],
      ['sleep 90', 'Descargar la imagen y arrancar lleva un rato'],
      ['aws ecs list-tasks --cluster demo --query "length(taskArns)"', 'Una tarea en el clúster'],
    ],
    seeAlso: ['Definición de tarea de ECS', 'Servicios de ECS y despliegues', 'AWS Fargate'],
  },
  {
    name: 'Definición de tarea de ECS',
    kind: 'concepto',
    category: 'contenedores',
    level: 2,
    summary: 'La receta de una tarea: qué imágenes, cuánta CPU y memoria, qué puertos, variables, registros y roles. Es inmutable: cada cambio crea una nueva revisión (`familia:3`).',
    details: `
Lo esencial de una definición para Fargate:

- **\`family\`**: el nombre; cada registro crea la revisión siguiente (\`tienda:1\`, \`tienda:2\`…). Las revisiones no se editan.
- **\`cpu\` y \`memory\`** de la tarea (combinaciones válidas: 256 → 512 MB–2 GB; 512 → 1–4 GB; 1024 → 2–8 GB…). Una combinación imposible se rechaza al registrar.
- **\`networkMode: awsvpc\`** (obligatorio en Fargate) y **\`requiresCompatibilities\`**.
- **\`containerDefinitions\`**: \`image\`, \`portMappings\`, \`environment\`, \`secrets\` (valores de Secrets Manager o Parameter Store), \`healthCheck\`, \`logConfiguration\` (\`awslogs\`), \`essential\` (si el contenedor muere, muere la tarea).
- **\`executionRoleArn\`** (rol de ejecución) y **\`taskRoleArn\`** (rol de la tarea): ver la ficha de roles.
- **\`runtimePlatform\`**: \`X86_64\` o \`ARM64\` (Graviton).

Un servicio apunta a una revisión concreta: **para desplegar una versión nueva se registra una revisión y se actualiza el servicio**, no se edita nada.
`,
    whenUse: ['Siempre que ejecutes algo en ECS'],
    whenNot: ['No pongas secretos en `environment`: usa `secrets` con Secrets Manager'],
    scenario: 'cont-ecs',
    examples: [
      [TD, 'Una definición de tarea para Fargate en un archivo'],
      ['aws ecs register-task-definition --cli-input-json file://td.json --query "taskDefinition.[family,revision]" --output text', 'Se registra como `demo-web:1`'],
      ['aws ecs register-task-definition --cli-input-json file://td.json --query "taskDefinition.revision" --output text', 'Registrar de nuevo crea la revisión 2'],
      ['sed -i \'s/"memory": "512"/"memory": "4096"/\' td.json && aws ecs register-task-definition --cli-input-json file://td.json', '256 de CPU no admite 4 GB de memoria', 'error'],
      ['aws ecs deregister-task-definition --task-definition demo-web:1 --query "taskDefinition.status" --output text', 'Una revisión se puede dar de baja (`INACTIVE`); no se edita'],
    ],
    seeAlso: ['Amazon ECS', 'Rol de ejecución y rol de tarea'],
  },
  {
    name: 'Rol de ejecución y rol de tarea',
    kind: 'comparativa',
    category: 'contenedores',
    level: 2,
    summary: 'ECS usa dos roles de IAM distintos: el de ejecución lo usa ECS para preparar la tarea (descargar la imagen, escribir registros) y el de tarea lo usa tu aplicación para llamar a AWS.',
    details: `
| | **Rol de ejecución** (\`executionRoleArn\`) | **Rol de tarea** (\`taskRoleArn\`) |
| --- | --- | --- |
| Quién lo usa | El agente de ECS / Fargate | **Tu código** (\`boto3\`, SDK) |
| Para qué | Descargar de ECR, crear el flujo de registros, leer \`secrets\` | Leer S3, escribir en DynamoDB, publicar en SQS… |
| Cuándo | **Antes** de que arranque el contenedor | Mientras corre |
| Política típica | \`AmazonECSTaskExecutionRolePolicy\` | La que tu aplicación necesite, **mínima** |
| Confía en | \`ecs-tasks.amazonaws.com\` | \`ecs-tasks.amazonaws.com\` |

Los errores se distinguen por el momento: si la tarea **ni arranca** con \`CannotPullContainerError\` o *unable to pull secrets or registry auth*, falta algo en el rol de **ejecución**. Si arranca pero tu código recibe \`AccessDenied\`, falta algo en el rol de **tarea**. Las claves de acceso nunca van dentro de la imagen.
`,
    whenUse: ['Siempre: dos roles, cada uno con lo mínimo que necesita'],
    whenNot: ['No des al rol de tarea los permisos del de ejecución «por si acaso», ni al revés'],
    scenario: 'cont-ecs',
    examples: [
      ['aws iam list-attached-role-policies --role-name ecsTaskExecutionRole --query "AttachedPolicies[].PolicyName" --output text', 'El rol de ejecución tiene la política administrada de ECS'],
      ['aws iam get-role --role-name ecsTaskExecutionRole --query "Role.AssumeRolePolicyDocument.Statement[0].Principal.Service" --output text', 'Confía en `ecs-tasks.amazonaws.com`'],
      ['aws iam get-policy-version --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy --version-id v1 --query "PolicyVersion.Document.Statement[0].Action" --output text', 'Lo que permite: ECR, CloudWatch Logs'],
    ],
    seeAlso: ['Definición de tarea de ECS', 'Amazon ECS'],
  },
  {
    name: 'Servicios de ECS y despliegues',
    kind: 'concepto',
    category: 'contenedores',
    level: 2,
    summary: 'Un servicio mantiene N tareas, las repone si mueren, las registra en un balanceador y despliega versiones nuevas por tandas sin cortar el servicio; un interruptor automático puede revertir un despliegue que falla.',
    details: `
- **\`desiredCount\`**: cuántas tareas quieres. El planificador lanza las que faltan y retira las que sobran.
- **Despliegue gradual** (*rolling update*): al cambiar la definición de tarea (o \`--force-new-deployment\`), ECS lanza tareas nuevas y retira las viejas respetando dos límites: **\`minimumHealthyPercent\`** (cuánto debe seguir sano; 100 = nunca bajar) y **\`maximumPercent\`** (cuánto puede haber a la vez; 200 = el doble).
- **Con balanceador**: ECS registra cada tarea como destino por su IP y solo da una tarea por buena cuando el grupo de destino la da por sana. El **periodo de gracia** (\`healthCheckGracePeriodSeconds\`) evita que se mate una tarea que aún está arrancando.
- **Interruptor de despliegue** (*circuit breaker*) con \`rollback\`: si las tareas nuevas fallan repetidamente, el despliegue se marca \`FAILED\` y vuelve a la versión anterior.
- **Dónde mirar cuando algo va mal**: \`describe-services\` → \`events\` (las frases de ECS), \`describe-tasks\` → \`stoppedReason\`/\`stopCode\` de las tareas paradas, los registros de CloudWatch y \`elbv2 describe-target-health\` (por qué el balanceador no las da por sanas).
`,
    whenUse: ['Para toda aplicación que debe estar siempre arriba'],
    whenNot: ['Para trabajos que terminan solos (usa `run-task` o EventBridge Scheduler)'],
    scenario: 'cont-ecs-etiqueta',
    examples: [
      ['aws ecs describe-services --cluster demo --services tienda --query "services[0].[desiredCount,runningCount,pendingCount]" --output text', 'Quiere 2 y no hay ninguna en marcha'],
      ['aws ecs describe-services --cluster demo --services tienda --query "services[0].events[0].message" --output text', 'La última frase de ECS sobre el servicio'],
      ['aws ecs list-tasks --cluster demo --desired-status STOPPED --query "taskArns[0]" --output text', 'Las tareas paradas guardan el motivo'],
      ['T=$(aws ecs list-tasks --cluster demo --desired-status STOPPED --query "taskArns[0]" --output text) && aws ecs describe-tasks --cluster demo --tasks $T --query "tasks[0].[stopCode,stoppedReason]" --output text', 'Por qué paró: no puede descargar la imagen (la etiqueta 1.1 no existe)'],
      ['aws ecs update-service --cluster demo --service tienda --desired-count 0 --query "services[0].desiredCount" --output text', 'Para dejar de intentarlo: 0 tareas'],
    ],
    seeAlso: ['Amazon ECS', 'Definición de tarea de ECS', 'Application Auto Scaling'],
  },

  // ───────────────────────── Fargate ─────────────────────────
  {
    name: 'AWS Fargate',
    kind: 'servicio',
    category: 'contenedores',
    level: 2,
    summary: 'El motor «sin servidores» para contenedores de ECS y EKS: dices cuánta CPU y memoria necesita cada tarea y AWS pone el servidor, lo parchea y lo aísla. No hay instancias que gestionar.',
    details: `
- Pagas por **vCPU y GB de memoria por segundo** mientras la tarea corre (mínimo 1 minuto). No pagas por capacidad ociosa que no tienes.
- **Cada tarea está aislada** en su propio entorno y tiene su interfaz de red (modo \`awsvpc\`).
- Arrancar una tarea tarda **decenas de segundos** (asignar servidor, descargar la imagen, arrancar).
- Admite **x86 y ARM (Graviton)**, que es más barato por vCPU.
- **Fargate Spot**: capacidad sobrante con descuento (hasta ~70 %), pero AWS puede interrumpir la tarea con 2 minutos de aviso. Para trabajos tolerantes a fallos.
- Límites: hasta 16 vCPU y 120 GB por tarea; sin acceso al anfitrión (no se pueden ejecutar contenedores privilegiados ni elegir el tipo de instancia); almacenamiento efímero de 20 GB (ampliable a 200).
`,
    whenUse: ['Quieres contenedores sin gestionar servidores, parches ni capacidad', 'Cargas variables o poco predecibles', 'Equipos pequeños'],
    whenNot: ['Cargas muy grandes y estables donde EC2 con Savings Plans o Spot sale bastante más barato', 'Si necesitas GPU, un kernel concreto o acceso al anfitrión: EC2'],
    pricing: 'Por vCPU y GB por segundo (la facturación empieza al descargar la imagen). Spot con descuento; Graviton más barato; Savings Plans de cómputo.',
    versus: [
      ['ECS en EC2', 'Tú gestionas instancias; más barato a gran escala y más control, pero más trabajo.'],
      ['Lambda', 'Hasta 15 min por ejecución y facturación por milisegundo; Fargate para procesos largos o servidores.'],
    ],
    scenario: 'cont-ecs-spot',
    examples: [
      ['aws ecs describe-services --cluster demo --services tienda --query "services[0].[launchType,platformVersion]" --output text', 'El servicio usa `FARGATE`'],
      ['aws ecs describe-clusters --clusters demo --query "clusters[0].capacityProviders" --output text', 'Proveedores de capacidad disponibles en el clúster'],
      ['aws ecs describe-task-definition --task-definition tienda --query "taskDefinition.[cpu,memory]" --output text', 'CPU y memoria de cada tarea (se factura esto)'],
    ],
    seeAlso: ['Fargate frente a EC2 en ECS', 'Capacity providers y Fargate Spot'],
  },
  {
    name: 'Fargate frente a EC2 en ECS',
    kind: 'comparativa',
    category: 'contenedores',
    level: 2,
    summary: 'Los dos «tipos de lanzamiento» de ECS: Fargate (AWS pone el servidor) frente a EC2 (tú pones y mantienes las instancias del clúster).',
    details: `
| | **Fargate** | **EC2** |
| --- | --- | --- |
| Servidores | Ninguno que gestionar | Tus instancias: AMI optimizada para ECS, parches, escalado |
| Facturación | CPU y memoria **de cada tarea** | Las **instancias**, estén llenas o vacías |
| Aprovechamiento | Exacto | Depende de cómo llenes las instancias («empaquetado») |
| Arranque de una tarea | ~30–60 s (descarga la imagen) | Rápido si hay hueco; lento si hay que añadir una instancia |
| Red | \`awsvpc\`: una interfaz por tarea | \`awsvpc\`, \`bridge\` o \`host\` |
| Control | Limitado | Total: GPU, discos, daemons, tamaños raros |
| Descuentos | Savings Plans, Spot, Graviton | Savings Plans, Reserved, Spot, Graviton |

**Regla práctica**: empieza por Fargate. Pasa a EC2 cuando el volumen es grande y estable (el coste por vCPU compensa el trabajo), necesitas hardware especial (GPU) o capacidad que Fargate no ofrece. Puedes **mezclarlos en un mismo clúster** con proveedores de capacidad.

Una tarea en EC2 solo arranca si hay **instancias registradas** en el clúster con hueco libre; si no, *No Container Instances were found in your cluster*.
`,
    whenUse: ['Fargate para casi todo al principio; EC2 cuando el coste o el hardware lo exijan'],
    whenNot: ['No elijas EC2 «por ahorrar» si no tienes quien mantenga los servidores: el coste operativo supera el ahorro'],
    scenario: 'cont-ecs',
    examples: [
      [SUBNETS[0], 'Una subred'],
      [TSG, 'El grupo de seguridad de las tareas'],
      ['aws ecs run-task --cluster demo --task-definition tienda --launch-type EC2 --network-configuration "awsvpcConfiguration={subnets=[$S1],securityGroups=[$TSG]}" --query "failures[0].reason" --output text', 'En EC2 sin instancias registradas en el clúster, no hay dónde ejecutar'],
      ['aws ecs list-container-instances --cluster demo --query "length(containerInstanceArns)"', 'Cero instancias de contenedor'],
    ],
    seeAlso: ['AWS Fargate', 'Capacity providers y Fargate Spot'],
  },
  {
    name: 'Capacity providers y Fargate Spot',
    kind: 'concepto',
    category: 'contenedores',
    level: 3,
    summary: 'Una estrategia que reparte las tareas de un servicio entre proveedores de capacidad: por ejemplo, unas pocas en Fargate bajo demanda (fiables) y el resto en Fargate Spot (baratas).',
    details: `
Cada servicio puede declarar una **estrategia** con una lista de proveedores y, para cada uno, dos números:

- **\`base\`**: cuántas tareas, como mínimo, van a ese proveedor (solo uno de la estrategia puede tener base).
- **\`weight\`**: la proporción en que se reparte **lo que queda** una vez cubierta la base.

Ejemplo con 4 tareas y \`FARGATE base=1 weight=1\` + \`FARGATE_SPOT weight=3\`: 1 tarea fija en Fargate + el resto (3) repartido 1:3 → **1 en Fargate y 3 en Spot**, de modo que el servicio sigue vivo aunque AWS recupere toda la capacidad Spot.

Para usar Spot, el clúster debe tener asociados \`FARGATE\` y \`FARGATE_SPOT\` (\`put-cluster-capacity-providers\`). Cambiar de \`launchType\` a una estrategia obliga a un **nuevo despliegue** (\`--force-new-deployment\`). Cuando AWS interrumpe una tarea Spot recibe SIGTERM y 2 minutos; ECS lanza otra (si hay capacidad).
`,
    whenUse: ['Trabajadores de colas, procesos por lotes y entornos de pruebas tolerantes a interrupciones', 'Para bajar el coste de un servicio sin renunciar a una base fiable'],
    whenNot: ['Para una única tarea crítica: sin base en bajo demanda, puede quedarse sin capacidad de golpe'],
    scenario: 'cont-ecs-spot',
    examples: [
      ['aws ecs update-service --cluster demo --service tienda --capacity-provider-strategy capacityProvider=FARGATE,weight=1,base=1 capacityProvider=FARGATE_SPOT,weight=3 --force-new-deployment --query "services[0].capacityProviderStrategy" --output json', 'Una base fija en Fargate y el resto en Spot (1:3)'],
      ['aws ecs describe-services --cluster demo --services tienda --query "services[0].capacityProviderStrategy[].[capacityProvider,weight,base]" --output text', 'La estrategia guardada'],
    ],
    seeAlso: ['AWS Fargate', 'Amazon ECS'],
  },
];
