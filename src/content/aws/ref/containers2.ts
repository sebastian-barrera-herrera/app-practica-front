import type { AwsRef } from '../reference';

const REPO = '123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda';

const APP_YAML = String.raw`cat > app.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: web
        image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda:1.0
        ports:
        - containerPort: 5000
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  type: LoadBalancer
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 5000
EOF`;

const SCALE_TARGET = 'aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --min-capacity 2 --max-capacity 6';
const CPU_POLICY = `aws application-autoscaling put-scaling-policy --policy-name cpu50 --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/tienda --policy-type TargetTrackingScaling --target-tracking-scaling-policy-configuration '{"TargetValue":50,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"ScaleOutCooldown":60,"ScaleInCooldown":60}'`;

export const AWS_REF_CONTAINERS2: AwsRef[] = [
  // ───────────────────────── escalado ─────────────────────────
  {
    name: 'Application Auto Scaling',
    kind: 'servicio',
    category: 'contenedores',
    level: 2,
    summary: 'El servicio que sube y baja el número de tareas de un servicio de ECS (y otros recursos: DynamoDB, Lambda concurrency…) según la carga, con objetivos como «mantén la CPU al 50 %».',
    details: `
Tres pasos:

1. **Registrar el objetivo escalable** (\`register-scalable-target\`): qué recurso (\`service/clúster/servicio\`), qué dimensión (\`ecs:service:DesiredCount\`) y entre qué **mínimo y máximo**. Sin este paso no se pueden crear políticas.
2. **Crear una política**:
   - **Seguimiento de objetivo** (*target tracking*, la más cómoda): eliges una métrica y un valor (CPU media 50 %, memoria, o peticiones por tarea del ALB) y el servicio calcula cuántas tareas hacen falta. Crea por ti las alarmas de CloudWatch.
   - **Por pasos** (*step scaling*): tú defines alarmas y cuántas tareas sumar según lo lejos que estés del umbral.
3. **Acciones programadas** (\`put-scheduled-action\`): cambian el mínimo y el máximo a una hora (\`at\`, \`rate\` o \`cron\`), p. ej. subir el mínimo antes de la campaña.

Detalles que importan:

- **Enfriamientos** (\`ScaleOutCooldown\`, \`ScaleInCooldown\`): evitan que el servicio suba y baje sin parar. Se sube rápido y se baja despacio (la baja exige 15 minutos de métrica baja).
- La métrica tiene que tener datos: con \`ALBRequestCountPerTarget\` hay que dar la **etiqueta** del balanceador y el grupo de destino exactos, o la política nunca actúa.
- \`describe-scaling-activities\` cuenta qué hizo y por qué (la causa es la alarma o la acción programada).
`,
    whenUse: ['Cualquier servicio con carga que varía durante el día', 'Para pagar solo las tareas que necesitas sin que una avalancha tire el servicio'],
    whenNot: ['Con un mínimo igual al máximo (no hay nada que escalar)', 'Para cargas que tardan más en arrancar que en pasar: usa acciones programadas'],
    pricing: 'Application Auto Scaling no cuesta nada. Pagas las alarmas de CloudWatch que crea y, sobre todo, las tareas que añade.',
    versus: [
      ['Auto Scaling de EC2', 'Escala instancias (los servidores); Application Auto Scaling escala tareas (los contenedores).'],
      ['Capacidad fija', 'Más sencillo y predecible, pero pagas siempre el pico o te quedas corto.'],
    ],
    scenario: 'cont-ecs-vivo',
    examples: [
      [SCALE_TARGET, 'El servicio podrá tener entre 2 y 6 tareas'],
      ['aws application-autoscaling describe-scalable-targets --service-namespace ecs --query "ScalableTargets[0].[ResourceId,MinCapacity,MaxCapacity]" --output text', 'Lo registrado'],
      [CPU_POLICY, 'Seguimiento de objetivo: mantén la CPU media en el 50 %'],
      ['aws application-autoscaling describe-scaling-policies --service-namespace ecs --query "ScalingPolicies[0].[PolicyName,PolicyType]" --output text', 'La política'],
      ['aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking --query "length(MetricAlarms)"', 'Dos alarmas (alta y baja) creadas por el servicio'],
      ['aws application-autoscaling put-scheduled-action --service-namespace ecs --scheduled-action-name campana --resource-id service/demo/tienda --scalable-dimension ecs:service:DesiredCount --schedule "cron(0 8 * * ? *)" --scalable-target-action MinCapacity=4,MaxCapacity=6', 'Cada día a las 8:00 (UTC), mínimo 4'],
      ['aws application-autoscaling describe-scheduled-actions --service-namespace ecs --query "ScheduledActions[0].Schedule" --output text', 'La programación'],
      ['aws application-autoscaling describe-scaling-activities --service-namespace ecs --query "length(ScalingActivities)"', 'Todavía no ha hecho nada'],
    ],
    seeAlso: ['Servicios de ECS y despliegues', 'Registros y métricas de contenedores'],
  },

  // ───────────────────────── EKS ─────────────────────────
  {
    name: 'Amazon EKS',
    kind: 'servicio',
    category: 'contenedores',
    level: 2,
    summary: 'Kubernetes gestionado: AWS mantiene el plano de control (API, etcd, planificador) en varias zonas, y tú aportas los nodos —un grupo de nodos administrado, Fargate o los tuyos— y tus aplicaciones.',
    details: `
- **Plano de control**: lo gestiona AWS (alta disponibilidad, parches de la versión, copias). Se crea en ~10 minutos y se cobra por hora, **haya nodos o no**.
- **Plano de datos**: los **nodos** donde corren los pods.
  - **Grupo de nodos administrado**: instancias EC2 que EKS lanza, actualiza y repone (con un Auto Scaling Group por debajo). Lo habitual.
  - **Fargate**: un perfil dice qué pods (por *namespace* y etiquetas) corren en Fargate, cada uno en su propio entorno.
  - **Autogestionados**: tus propias instancias.
- **Los nodos necesitan** un rol de IAM con tres políticas (\`AmazonEKSWorkerNodePolicy\`, \`AmazonEKS_CNI_Policy\` y \`AmazonEC2ContainerRegistryReadOnly\` —esta última para descargar de ECR—) y **salida a internet o endpoints** para llegar al clúster.
- **Red de pods** (CNI de Amazon VPC): cada pod recibe una **IP de tu subred**, así que los grupos de seguridad y las tablas de rutas funcionan igual que con EC2. Cuenta: cuantos más pods, más IPs.
- **Acceso**: IAM decide quién entra (*access entries*); Kubernetes decide qué puede hacer dentro (políticas de acceso o RBAC).
- Los servicios \`type: LoadBalancer\` crean un balanceador de AWS por ti.
`,
    whenUse: ['Ya usas Kubernetes (Helm, operadores, herramientas del ecosistema) o necesitas portabilidad entre nubes', 'Equipos grandes con muchas aplicaciones que se benefician de un estándar común', 'Cuando necesitas capacidades de Kubernetes que ECS no tiene'],
    whenNot: ['Una o dos aplicaciones sencillas y un equipo pequeño: ECS o App Runner tienen mucha menos carga operativa', 'Si nadie en el equipo conoce Kubernetes: la curva es empinada'],
    pricing: 'El plano de control cuesta unas decenas de dólares al mes por clúster. Aparte: los nodos (EC2) o los pods de Fargate, los balanceadores y la transferencia de datos.',
    limits: ['Cada versión de Kubernetes recibe soporte unos 14 meses: hay que actualizar el clúster con regularidad', 'El número de pods por nodo depende del tipo de instancia (interfaces e IPs)'],
    versus: [
      ['Amazon ECS', 'Más simple y 100 % AWS; menos portable y con menos ecosistema.'],
      ['App Runner', 'Solo una URL para tu imagen; sin red, nodos ni conceptos de Kubernetes.'],
    ],
    scenario: 'cont-eks',
    examples: [
      ['aws eks list-clusters --query "clusters" --output text', 'El clúster del laboratorio'],
      ['aws eks describe-cluster --name tienda --query "cluster.[status,version,platformVersion]" --output text', 'Activo y con su versión de Kubernetes'],
      ['aws eks describe-cluster --name tienda --query "cluster.endpoint" --output text', 'La dirección de la API de Kubernetes'],
      ['aws eks list-nodegroups --cluster-name tienda --query "nodegroups" --output text', 'Un grupo de nodos administrado'],
      ['aws eks describe-nodegroup --cluster-name tienda --nodegroup-name general --query "nodegroup.[status,instanceTypes[0],scalingConfig.desiredSize]" --output text', 'Su estado, tipo de instancia y tamaño'],
      ['aws ec2 describe-instances --filters Name=tag:eks:nodegroup-name,Values=general --query "length(Reservations[].Instances[])"', 'Dos instancias EC2 lanzadas por EKS'],
    ],
    seeAlso: ['Kubernetes: pods, deployments y servicios', 'kubectl', 'Acceso a EKS'],
  },
  {
    name: 'Kubernetes: pods, deployments y servicios',
    kind: 'concepto',
    category: 'contenedores',
    level: 2,
    summary: 'Los cuatro objetos que necesitas para empezar: el pod (uno o más contenedores juntos), el deployment (mantiene N pods y los actualiza), el servicio (una dirección estable) y el nodo (la máquina donde corren).',
    details: `
| Objeto | Qué es | Equivalente en ECS |
| --- | --- | --- |
| **Pod** | La unidad mínima: uno o varios contenedores que comparten red y viven y mueren juntos | Tarea |
| **Deployment** | Declara «quiero 3 pods de esta imagen» y hace las actualizaciones graduales | Servicio |
| **Service** | Nombre y dirección estables delante de los pods que cumplen una etiqueta. \`ClusterIP\` (interno), \`NodePort\`, \`LoadBalancer\` (balanceador de AWS) | Balanceador + grupo de destino |
| **Nodo** | La máquina (EC2 o Fargate) donde se ejecutan los pods | Instancia del clúster |
| **Namespace** | Una «carpeta» para separar aplicaciones y permisos | — |

Las cosas se enlazan por **etiquetas** (*labels*): el \`selector\` del deployment y del servicio tiene que coincidir con las etiquetas del pod, o el servicio no encuentra a nadie.

Cada pod pide recursos (\`requests\`: lo que se reserva) y el planificador lo coloca en un nodo con hueco. Si ninguno lo tiene, el pod se queda en **Pending** («0/2 nodes are available: Insufficient cpu»).

**Estados que verás**: \`ContainerCreating\` (descargando la imagen), \`Running\`, \`ImagePullBackOff\` (no puede descargar la imagen: etiqueta que no existe o sin permiso), \`CrashLoopBackOff\` (el contenedor arranca y se cae una y otra vez), \`Pending\` (sin nodo).
`,
    whenUse: ['Para entender y diagnosticar cualquier aplicación en Kubernetes'],
    whenNot: ['No crees pods sueltos para aplicaciones reales: sin deployment nadie los repone'],
    scenario: 'cont-eks',
    examples: [
      ['aws eks update-kubeconfig --name tienda', 'Configura `kubectl` para este clúster'],
      [APP_YAML, 'Un deployment de dos pods y un servicio con balanceador'],
      ['kubectl apply -f app.yaml', 'Crea ambos objetos'],
      ['kubectl get deployments', 'El deployment, con los pods listos (`0/2` al principio)'],
      ['sleep 90', 'Descargar la imagen y arrancar lleva un minuto'],
      ['kubectl get pods', 'Dos pods `Running`'],
      ['kubectl get pods -o wide', 'Con la IP de cada pod (de tu subred) y el nodo donde corre'],
      ['kubectl describe svc web', 'El servicio y los pods a los que apunta (`Endpoints`)'],
      ['kubectl scale deployment web --replicas=3', 'Un pod más'],
      ['kubectl delete -f app.yaml', 'Borra el deployment y el servicio (y el balanceador)'],
    ],
    seeAlso: ['Amazon EKS', 'kubectl'],
  },
  {
    name: 'kubectl',
    kind: 'comando',
    category: 'contenedores',
    level: 2,
    summary: 'El cliente de Kubernetes. Lee ~/.kube/config para saber a qué clúster hablar y con qué identidad; con él creas, consultas y depuras objetos.',
    usage: 'kubectl get|describe|logs|apply|delete|scale|set|rollout|expose|run|wait … [-n namespace] [-o wide|json|yaml|jsonpath=…]',
    details: `
Los que más usarás:

- **Ver**: \`kubectl get pods|deploy|svc|nodes\`, con \`-A\` (todos los namespaces), \`-o wide\` (IP y nodo), \`-l app=web\` (por etiqueta) y \`-o jsonpath='{.status.loadBalancer.ingress[0].hostname}'\` (un dato concreto).
- **Depurar**: \`kubectl describe pod X\` (la sección **Events** al final dice por qué no arranca), \`kubectl logs X\` (la salida del contenedor) y \`kubectl get events\`.
- **Crear y cambiar**: \`kubectl apply -f archivo.yaml\` (declarativo: crea o actualiza), \`kubectl scale deploy web --replicas=4\`, \`kubectl set image deploy/web web=imagen:2.0\`.
- **Despliegues**: \`kubectl rollout status deploy/web\` (espera a que termine), \`rollout undo\` (vuelve a la versión anterior), \`rollout history\`.

**Errores de conexión y de permisos**: *The connection to the server localhost:8080 was refused* (no hay kubeconfig: \`aws eks update-kubeconfig\`); *You must be logged in to the server (Unauthorized)* (tu identidad de IAM no está dada de alta en el clúster); *Error from server (Forbidden)* (estás dado de alta, pero tu política de acceso no permite esa acción).
`,
    scenario: 'cont-eks',
    examples: [
      ['kubectl get nodes', 'Sin kubeconfig no hay a quién preguntar', 'error'],
      ['aws eks update-kubeconfig --name tienda', 'Escribe ~/.kube/config'],
      ['kubectl config current-context', 'El clúster activo'],
      ['kubectl get nodes', 'Dos nodos `Ready`'],
      ['kubectl get pods -A', 'Los pods del sistema (red, proxy, DNS) en `kube-system`'],
      ['kubectl create deployment prueba --image=' + REPO + ':1.0 --replicas=2 --port=5000', 'Un deployment sin escribir YAML'],
      ['kubectl rollout status deployment/prueba', 'Espera a que estén listos'],
      ['kubectl logs deploy/prueba', 'Lo que escribe el contenedor'],
      ['kubectl set image deployment/prueba tienda=' + REPO + ':2.0', 'Cambia la imagen: no existe la etiqueta 2.0 en este laboratorio, el pod nuevo falla'],
      ['kubectl get pods -l app=prueba', 'Los pods viejos siguen: la actualización gradual no corta el servicio'],
      ['kubectl top nodes', 'Sin el servidor de métricas instalado no hay `top`', 'error'],
    ],
    seeAlso: ['Amazon EKS', 'Kubernetes: pods, deployments y servicios', 'Acceso a EKS'],
  },
  {
    name: 'Acceso a EKS',
    kind: 'concepto',
    category: 'contenedores',
    level: 3,
    summary: 'Quién puede hablar con un clúster: IAM autentica (quién eres) y las «entradas de acceso» (access entries) con sus políticas dicen qué puedes hacer dentro de Kubernetes.',
    details: `
- **Quien crea el clúster** es administrador implícito (su identidad de IAM aparece como entrada de acceso).
- Para dar acceso a otra persona o rol: \`create-access-entry\` (el *principal* de IAM) y \`associate-access-policy\` con una de las políticas administradas:
  - \`AmazonEKSClusterAdminPolicy\`: todo.
  - \`AmazonEKSAdminPolicy\` y \`AmazonEKSEditPolicy\`: administrar / crear y modificar objetos.
  - \`AmazonEKSViewPolicy\`: solo lectura.
  - Con ámbito (\`access-scope\`) **de clúster** o de **uno o varios namespaces**.
- Un permiso de IAM como \`eks:*\` solo permite llamar a la **API de AWS** de EKS (crear clústeres, describirlos); **no** da acceso a Kubernetes.
- El token que usa \`kubectl\` lo genera \`aws eks get-token\` con las credenciales del perfil actual y caduca a los 15 minutos.

Los tres mensajes de la depuración: *Unauthorized* = IAM sí, pero sin entrada de acceso; *Forbidden* = con entrada, pero la política no permite la acción; *i/o timeout* = el endpoint del clúster no es público y estás fuera de la VPC.
`,
    whenUse: ['Para dar acceso mínimo: lectura a quien solo mira, edición en su namespace a cada equipo'],
    whenNot: ['No des `ClusterAdmin` por comodidad'],
    scenario: 'cont-eks-acceso',
    examples: [
      ['aws eks list-access-entries --cluster-name tienda --query "accessEntries" --output text', 'Solo quien creó el clúster'],
      ['aws eks create-access-entry --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana --query accessEntry.principalArn --output text', 'Ana ya existe para el clúster… aún sin permisos'],
      ['aws eks associate-access-policy --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy --access-scope type=cluster --query associatedAccessPolicy.policyArn --output text', 'Solo lectura en todo el clúster'],
      ['aws eks list-associated-access-policies --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana --query "associatedAccessPolicies[].policyArn" --output text', 'Lo que tiene Ana'],
      ['aws eks associate-access-policy --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana --policy-arn arn:aws:eks::aws:cluster-access-policy/NoExiste --access-scope type=cluster', 'Solo existen cuatro políticas administradas', 'error'],
      ['aws eks delete-access-entry --cluster-name tienda --principal-arn arn:aws:iam::123456789012:user/ana', 'Se le quita el acceso'],
    ],
    seeAlso: ['Amazon EKS', 'kubectl'],
  },

  // ───────────────────────── App Runner ─────────────────────────
  {
    name: 'AWS App Runner',
    kind: 'servicio',
    category: 'contenedores',
    level: 2,
    summary: 'Pasa de una imagen en ECR (o de código en GitHub) a una URL HTTPS que escala sola, sin servidores, balanceadores, VPC ni clústeres que configurar.',
    details: `
- Le das la **imagen**, el **puerto** en el que escucha la aplicación (por defecto **8080**: si tu aplicación escucha en otro, la creación falla), CPU y memoria (de 0,25 vCPU a 4 vCPU) y, para ECR privado, un **rol de acceso** que App Runner usa para descargar (confía en \`build.apprunner.amazonaws.com\`).
- Crea el servicio en unos **3–5 minutos**: descarga la imagen, arranca, comprueba la salud (TCP por defecto, o una ruta HTTP) y te da una **URL HTTPS** con certificado.
- **Escala solo**: una configuración de escalado dice cuántas peticiones simultáneas aguanta cada instancia (\`MaxConcurrency\`, por defecto 100) y el mínimo y máximo de instancias.
- **Despliegues sin cortes**: \`start-deployment\` (o despliegue automático al subir una imagen nueva a la etiqueta) mantiene la versión vieja hasta que la nueva está sana.
- **Pausar** el servicio detiene el cómputo.
- **Registros**: dos grupos de CloudWatch Logs, \`…/service\` (eventos de App Runner, lo primero que hay que leer si algo falla) y \`…/application\` (la salida de tu aplicación).
`,
    whenUse: ['Una API o web en un contenedor y nadie que mantenga infraestructura', 'Prototipos y aplicaciones pequeñas o medianas con tráfico variable'],
    whenNot: ['Cuando necesites control de red fino, tareas en segundo plano, GPU o varios contenedores juntos: ECS o EKS', 'Trabajos por lotes: ECS/Fargate o Lambda'],
    pricing: 'Instancias aprovisionadas (memoria, siempre encendidas con el mínimo) más instancias activas (CPU y memoria mientras atienden peticiones). Pausar el servicio detiene el cobro del cómputo.',
    limits: ['Hasta 25 instancias por defecto por servicio', 'Hasta 200 peticiones simultáneas por instancia'],
    versus: [
      ['ECS en Fargate', 'Más configurable (VPC, varios contenedores, tareas por lotes); App Runner es más simple pero menos flexible.'],
      ['Lambda con URL de función', 'Facturación por petición y escala a cero; App Runner mantiene un servidor siempre encendido.'],
    ],
    scenario: 'cont-apprunner',
    examples: [
      [`aws apprunner create-service --service-name tienda --source-configuration '{"ImageRepository":{"ImageIdentifier":"${REPO}:1.0","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"5000"}},"AuthenticationConfiguration":{"AccessRoleArn":"arn:aws:iam::123456789012:role/apprunner-ecr"}}' --query Service.Status --output text`, 'Crea el servicio con el puerto de la aplicación'],
      ['aws apprunner list-services --query "ServiceSummaryList[0].[ServiceName,Status]" --output text', 'Se está creando'],
      ['sleep 240', 'Unos minutos de aprovisionamiento'],
      ['aws apprunner list-services --query "ServiceSummaryList[0].Status" --output text', '`RUNNING`'],
      ['U=$(aws apprunner list-services --query "ServiceSummaryList[0].ServiceUrl" --output text) && curl -s https://$U/', 'La URL pública con HTTPS'],
      ['aws apprunner list-operations --service-arn $(aws apprunner list-services --query "ServiceSummaryList[0].ServiceArn" --output text) --query "OperationSummaryList[0].[Type,Status]" --output text', 'Historial de operaciones'],
      ['aws apprunner pause-service --service-arn $(aws apprunner list-services --query "ServiceSummaryList[0].ServiceArn" --output text) --query Service.Status --output text', 'Pausar para no pagar cómputo'],
    ],
    seeAlso: ['Contenedores en AWS: cuál elegir', 'Amazon ECR'],
  },

  // ───────────────────────── elegir y operar ─────────────────────────
  {
    name: 'Contenedores en AWS: cuál elegir',
    kind: 'comparativa',
    category: 'contenedores',
    level: 2,
    summary: 'App Runner, ECS con Fargate, ECS con EC2, EKS y Lambda resuelven lo mismo con distinto equilibrio entre simplicidad, control y coste. Se elige por quién lo va a operar y qué necesita.',
    details: `
| | **Lambda** | **App Runner** | **ECS + Fargate** | **ECS/EKS + EC2** | **EKS + Fargate** |
| --- | --- | --- | --- | --- | --- |
| Lo que gestionas | Solo el código | La imagen | Imagen, red, servicio | + las instancias | + Kubernetes |
| Arranque | Milisegundos–segundos | Minutos al crear | ~30–60 s por tarea | Rápido si hay hueco | ~60 s por pod |
| Escala a cero | Sí | No (pausa) | No (mínimo 0 con trabajo) | No | No |
| Duración máxima | 15 min por llamada | Servicio continuo | Continuo | Continuo | Continuo |
| Control de red | Opcional (VPC) | Básico | Total (awsvpc) | Total | Total |
| Complejidad | Muy baja | Baja | Media | Media–alta | Alta |

**Preguntas que deciden:**
1. ¿Es una función corta disparada por un evento? → **Lambda**.
2. ¿Es una web/API y quieres cero infraestructura? → **App Runner**.
3. ¿Necesitas VPC, varios contenedores, tareas por lotes o balanceador propio? → **ECS con Fargate**.
4. ¿Mucho volumen estable, GPU o hardware especial? → **EC2** (ECS o EKS).
5. ¿Ya usas Kubernetes o necesitas portabilidad? → **EKS**.

La regla general: **el servicio más simple que cumpla tus requisitos**; se puede subir de nivel más adelante porque todos usan la misma imagen de contenedor.
`,
    whenUse: ['Antes de empezar un proyecto nuevo de contenedores'],
    whenNot: ['No elijas Kubernetes porque «es lo que se lleva»'],
    scenario: 'base',
    examples: [
      ['aws ecs list-clusters --query "clusterArns" --output text', 'Los clústeres de ECS (vacío en una cuenta nueva)'],
      ['aws eks list-clusters --query "clusters" --output text', 'Los de EKS (también)'],
      ['aws apprunner list-services --query "ServiceSummaryList" --output text', 'Y los servicios de App Runner'],
    ],
    seeAlso: ['AWS App Runner', 'Amazon ECS', 'Amazon EKS', 'AWS Fargate'],
  },
  {
    name: 'Registros y métricas de contenedores',
    kind: 'buena práctica',
    category: 'contenedores',
    level: 2,
    summary: 'Los contenedores son efímeros: lo que no sale del contenedor se pierde con él. Envía los registros a CloudWatch y vigila las métricas del servicio y el balanceador.',
    details: `
- **Registros**: el contenedor escribe en la **salida estándar** y el controlador \`awslogs\` lo envía a un grupo de CloudWatch Logs (\`/ecs/tienda\`). El grupo **debe existir** (o permitir \`awslogs-create-group\`) y el rol de ejecución debe poder escribir en él; si no, la tarea ni arranca.
- **Métricas gratuitas del servicio** (\`AWS/ECS\`): \`CPUUtilization\` y \`MemoryUtilization\` por servicio. Son las que usa Application Auto Scaling.
- **Container Insights** (opcional): más métricas por tarea y contenedor (CPU, memoria, red, número de tareas en marcha) y un panel; tiene coste.
- **Del balanceador**: \`HealthyHostCount\`, \`UnHealthyHostCount\`, \`TargetResponseTime\` y los códigos 5xx del grupo de destino.
- **Alarmas** útiles: tareas en marcha por debajo de las deseadas, 5xx del ALB, CPU sostenida alta, destinos no sanos.
- **Trazas**: AWS X-Ray o OpenTelemetry añadidos como contenedor lateral.

Un buen reflejo: *si una tarea muere, lo primero es \`describe-tasks\` (motivo de la parada) y después los registros de esa tarea*.
`,
    whenUse: ['Desde el primer despliegue: sin registros, depurar contenedores es adivinar'],
    whenNot: ['No guardes registros para siempre: fija la retención del grupo (p. ej. 14 días)'],
    scenario: 'cont-ecs-vivo',
    examples: [
      ['aws logs describe-log-groups --log-group-name-prefix /ecs --query "logGroups[0].logGroupName" --output text', 'El grupo de registros de la aplicación'],
      ['aws logs put-retention-policy --log-group-name /ecs/tienda --retention-in-days 14', 'Conserva 14 días'],
      ['aws logs filter-log-events --log-group-name /ecs/tienda --query "length(events)"', 'Hay líneas de las tareas (arranque y comprobaciones del balanceador)'],
      ['aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name CPUUtilization --dimensions Name=ClusterName,Value=demo Name=ServiceName,Value=tienda --start-time 2026-03-14T10:00:00Z --end-time 2026-03-14T23:00:00Z --period 300 --statistics Average --query "length(Datapoints)"', 'La CPU del servicio, cada cinco minutos'],
    ],
    seeAlso: ['Amazon ECS', 'Application Auto Scaling'],
  },
  {
    name: 'Buenas prácticas con imágenes de contenedor',
    kind: 'buena práctica',
    category: 'contenedores',
    level: 2,
    summary: 'Imágenes pequeñas, con versiones fijas, sin secretos, escaneadas y con etiquetas que digan qué contienen: lo que sale de tu canalización debe ser reproducible y auditable.',
    details: `
1. **Base pequeña y oficial** (\`python:3.12-slim\` en vez de una imagen completa): menos descarga, arranque más rápido y menos superficie de ataque.
2. **Versiones fijas**: fija la etiqueta de la base y las dependencias (\`flask==3.0.3\`).
3. **Orden de capas**: lo que cambia poco (dependencias) antes de lo que cambia mucho (código).
4. **Nada de secretos en la imagen** ni en variables en claro: usa Secrets Manager / Parameter Store referenciados desde la definición de tarea o el pod.
5. **No ejecutes como \`root\`**: crea un usuario y usa \`USER\`.
6. **Etiquetas con significado**: versión semántica (\`1.4.2\`) o el *hash* del commit. **Evita \`latest\`** en producción: no sabes qué estás ejecutando ni puedes volver atrás.
7. **Etiquetas inmutables** en ECR y **escaneo al subir**.
8. **Una sola cosa por contenedor**, que escriba sus registros por la salida estándar y arranque rápido.
9. **Misma imagen en todos los entornos**: cambia la configuración, no la imagen.
10. **Construye para la arquitectura donde vas a ejecutar** (\`--platform linux/arm64\` para Graviton).
`,
    whenUse: ['Al escribir cualquier Dockerfile y al configurar un repositorio de ECR'],
    whenNot: ['—'],
    scenario: 'cont-ecr',
    examples: [
      ['aws ecr put-image-tag-mutability --repository-name tienda --image-tag-mutability IMMUTABLE', 'Etiquetas inmutables'],
      ['aws ecr put-image-scanning-configuration --repository-name tienda --image-scanning-configuration scanOnPush=true', 'Escaneo en cada subida'],
      ['aws ecr describe-repositories --query "repositories[0].[imageTagMutability,imageScanningConfiguration.scanOnPush]" --output text', 'Ambas protecciones activas'],
    ],
    seeAlso: ['Amazon ECR', 'Dockerfile', 'Escaneo de imágenes en ECR'],
  },
];
