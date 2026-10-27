/** Tipos de la zona «Contenedores» (Z13): Docker local, ECR, ECS, EKS, App Runner y Application Auto Scaling. */
import type { Tag } from './types';

// ───────────────────────── Docker local ─────────────────────────

export interface ImageCfg {
  env: Record<string, string>;
  cmd: string[] | null;
  entrypoint: string[] | null;
  workdir: string;
  user: string;
  ports: number[];
  health?: { cmd: string; interval: number; timeout: number; retries: number; startPeriod: number };
}

export interface ImageData {
  /** `sha256:…` (64 hexadecimales). */
  id: string;
  arch: 'amd64' | 'arm64';
  base: string;
  created: number;
  /** Bytes, sumando las capas. */
  size: number;
  layers: { cmd: string; size: number }[];
  config: ImageCfg;
  /** Archivos añadidos sobre la imagen base: ruta absoluta → contenido. */
  files: Record<string, string>;
  /** Paquetes instalados (para el escaneo de vulnerabilidades y para saber qué se puede importar en Python). */
  pkgs: { name: string; version: string }[];
  runtime: 'python' | 'nginx' | 'shell' | 'none';
}

export interface DockerContainer {
  id: string;
  name: string;
  /** Imagen tal y como se pidió (`repo:tag`). */
  image: string;
  imageId: string;
  createdAt: number;
  status: 'running' | 'exited';
  exitCode?: number;
  ports: { host: number; container: number }[];
  logs: string[];
  env: Record<string, string>;
  command: string;
  /** Si es un servidor web: puerto en el que escucha dentro del contenedor, si lo hace en todas las interfaces y qué servidor es. */
  serverPort?: number;
  bindAll?: boolean;
  kind?: 'flask' | 'gunicorn' | 'nginx';
}

export interface DockerState {
  images: Record<string, ImageData>;
  tags: { repo: string; tag: string; id: string }[];
  containers: DockerContainer[];
  /** Registro → quién hizo `docker login` y cuándo caduca la sesión (ms). */
  logins: Record<string, { principal: string; expiresAt: number }>;
  counter: number;
}

// ───────────────────────── ECR ─────────────────────────

export interface EcrFinding {
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL';
  description: string;
  package: string;
  version: string;
  fixedIn?: string;
}

export interface EcrImage {
  digest: string;
  tags: string[];
  pushedAt: number;
  size: number;
  image: ImageData;
  scan?: { status: 'IN_PROGRESS' | 'COMPLETE'; startedAt: number; findings: EcrFinding[] };
  lastPulled?: number;
}

export interface EcrRepo {
  name: string;
  arn: string;
  uri: string;
  created: number;
  mutability: 'MUTABLE' | 'IMMUTABLE';
  scanOnPush: boolean;
  encryption: 'AES256' | 'KMS';
  kmsKey?: string;
  policy?: string;
  lifecycle?: string;
  lifecycleSetAt?: number;
  /** Política de la última vista previa. */
  previewText?: string;
  images: EcrImage[];
  tags: Tag[];
}

export interface EcrState {
  repos: Record<string, EcrRepo>;
  /** Escaneo mejorado del registro (Inspector). */
  scanType?: 'BASIC' | 'ENHANCED';
}

// ───────────────────────── ECS ─────────────────────────

export interface EcsContainerDef {
  name: string;
  image: string;
  cpu?: number;
  memory?: number;
  memoryReservation?: number;
  essential: boolean;
  portMappings: { containerPort: number; hostPort?: number; protocol?: string }[];
  environment: { name: string; value: string }[];
  secrets: { name: string; valueFrom: string }[];
  command?: string[];
  entryPoint?: string[];
  workingDirectory?: string;
  logConfiguration?: { logDriver: string; options?: Record<string, string> };
  healthCheck?: { command: string[]; interval?: number; timeout?: number; retries?: number; startPeriod?: number };
}

export interface EcsTaskDef {
  family: string;
  revision: number;
  arn: string;
  containerDefinitions: EcsContainerDef[];
  cpu?: string;
  memory?: string;
  networkMode: 'awsvpc' | 'bridge' | 'host' | 'none';
  requiresCompatibilities: string[];
  executionRoleArn?: string;
  taskRoleArn?: string;
  runtimePlatform?: { cpuArchitecture?: 'X86_64' | 'ARM64'; operatingSystemFamily?: string };
  status: 'ACTIVE' | 'INACTIVE';
  registeredAt: number;
  deregisteredAt?: number;
  tags: Tag[];
}

export interface EcsNet {
  subnets: string[];
  securityGroups: string[];
  assignPublicIp: 'ENABLED' | 'DISABLED';
}

export interface EcsTask {
  id: string;
  arn: string;
  cluster: string;
  taskDef: string;
  group: string;
  startedBy?: string;
  serviceName?: string;
  deploymentId?: string;
  launchType: 'FARGATE' | 'EC2';
  capacity?: 'FARGATE' | 'FARGATE_SPOT';
  createdAt: number;
  pendingAt: number;
  pullDoneAt?: number;
  runningAt?: number;
  stopRequestedAt?: number;
  stoppedAt?: number;
  stopCode?: string;
  stoppedReason?: string;
  desiredStatus: 'RUNNING' | 'STOPPED';
  net?: EcsNet;
  eniId?: string;
  privateIp?: string;
  publicIp?: string;
  subnetId?: string;
  az?: string;
  containerInstance?: string;
  cpu: string;
  memory: string;
  containers: { name: string; image: string; imageDigest?: string; exitCode?: number; reason?: string; health: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN' }[];
  server?: { port: number; bindAll: boolean; kind: 'flask' | 'gunicorn' | 'nginx' };
  /** Instante (si lo hay) en que el healthcheck del contenedor lo da por no sano. */
  unhealthyAt?: number;
  /** Cuándo empezó a estar sano (para reiniciar el contador de fallos consecutivos de su despliegue). */
  steadyAt?: number;
  logGroup?: string;
  logStream?: string;
  imageRef?: ImageData;
  roleArn?: string;
  env: Record<string, string>;
  tags: Tag[];
  /** Instante de la última comprobación del balanceador anotada en los registros. */
  lastProbeLog?: number;
  /** Líneas de registro todavía «en el futuro» (se escriben en CloudWatch cuando pase su hora). */
  pendingLogs?: { ts: number; msg: string }[];
  /** El planificador ya contó el fallo de esta tarea. */
  counted?: boolean;
  /** Destino registrado en el balanceador. */
  registered?: { targetGroupArn: string; port: number };
  /** Aviso de «unhealthy» ya anotado en los eventos del servicio. */
  noticed?: boolean;
  containerName?: string;
}

export interface EcsDeployment {
  id: string;
  status: 'PRIMARY' | 'ACTIVE' | 'INACTIVE';
  taskDefinition: string;
  desiredCount: number;
  createdAt: number;
  updatedAt: number;
  failedTasks: number;
  consecutiveFails: number;
  rolloutState: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  rolloutStateReason: string;
  launchType?: string;
  /** Si fue un retroceso del interruptor automático. */
  rollback?: boolean;
}

export interface EcsService {
  name: string;
  arn: string;
  cluster: string;
  status: 'ACTIVE' | 'DRAINING' | 'INACTIVE';
  desiredCount: number;
  launchType?: 'FARGATE' | 'EC2';
  capacityProviderStrategy?: { capacityProvider: string; weight?: number; base?: number }[];
  platformVersion: string;
  loadBalancers: { targetGroupArn: string; containerName: string; containerPort: number }[];
  net?: EcsNet;
  minHealthyPercent: number;
  maxPercent: number;
  circuitBreaker: { enable: boolean; rollback: boolean };
  healthCheckGracePeriodSeconds: number;
  deployments: EcsDeployment[];
  events: { id: string; createdAt: number; message: string }[];
  createdAt: number;
  roleArn?: string;
  tags: Tag[];
  /** Hasta qué instante del reloj se ha simulado el planificador. */
  simAt: number;
  /** No lanzar tareas nuevas antes de este instante (espera creciente tras fallos). */
  holdUntil: number;
  steady?: boolean;
  enableExecuteCommand?: boolean;
  /** Última definición de tarea que llegó a estado estable (para el retroceso automático). */
  lastGood?: { taskDefinition: string; desiredCount: number };
}

export interface EcsCluster {
  name: string;
  arn: string;
  status: 'ACTIVE' | 'INACTIVE';
  created: number;
  insights: boolean;
  capacityProviders: string[];
  defaultStrategy: { capacityProvider: string; weight?: number; base?: number }[];
  tags: Tag[];
}

export interface EcsEni {
  id: string;
  subnetId: string;
  vpcId: string;
  az: string;
  privateIp: string;
  publicIp?: string;
  sgIds: string[];
  taskArn: string;
}

export interface EcsState {
  clusters: Record<string, EcsCluster>;
  taskDefs: Record<string, EcsTaskDef>;
  families: Record<string, number>;
  services: Record<string, EcsService>;
  tasks: Record<string, EcsTask>;
  enis: Record<string, EcsEni>;
  counter: number;
}

// ───────────────────────── Application Auto Scaling ─────────────────────────

export interface AasPolicy {
  name: string;
  arn: string;
  type: 'TargetTrackingScaling' | 'StepScaling';
  created: number;
  /** Seguimiento de objetivo. */
  tt?: {
    TargetValue: number;
    PredefinedMetricSpecification?: { PredefinedMetricType: string; ResourceLabel?: string };
    ScaleInCooldown: number;
    ScaleOutCooldown: number;
    DisableScaleIn: boolean;
  };
  /** Por pasos. */
  step?: {
    AdjustmentType: 'ChangeInCapacity' | 'PercentChangeInCapacity' | 'ExactCapacity';
    StepAdjustments: { MetricIntervalLowerBound?: number; MetricIntervalUpperBound?: number; ScalingAdjustment: number }[];
    Cooldown: number;
    MetricAggregationType: string;
  };
  alarms: { AlarmName: string; AlarmARN: string }[];
}

export interface AasScheduled {
  name: string;
  arn: string;
  schedule: string;
  timezone: string;
  start?: string;
  end?: string;
  action: { MinCapacity?: number; MaxCapacity?: number };
  created: number;
  lastRun?: number;
}

export interface AasActivity {
  id: string;
  start: number;
  end: number;
  description: string;
  cause: string;
  status: 'Successful' | 'Failed';
  message: string;
}

export interface AasTarget {
  ns: string;
  resourceId: string;
  dimension: string;
  min: number;
  max: number;
  roleArn: string;
  arn: string;
  created: number;
  suspended: { DynamicScalingInSuspended: boolean; DynamicScalingOutSuspended: boolean; ScheduledScalingSuspended: boolean };
  policies: Record<string, AasPolicy>;
  scheduled: Record<string, AasScheduled>;
  activities: AasActivity[];
  /** Último minuto simulado. */
  lastEval: number;
  lastOut: number;
  lastIn: number;
  lowMinutes: number;
}

export interface AasState {
  targets: Record<string, AasTarget>;
}

// ───────────────────────── App Runner ─────────────────────────

export interface ArAutoScaling {
  name: string;
  arn: string;
  revision: number;
  latest: boolean;
  maxConcurrency: number;
  minSize: number;
  maxSize: number;
  created: number;
  active: boolean;
}

export interface ArOperation {
  Id: string;
  Type: 'CREATE_SERVICE' | 'UPDATE_SERVICE' | 'START_DEPLOYMENT' | 'PAUSE_SERVICE' | 'RESUME_SERVICE' | 'DELETE_SERVICE';
  Status: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  TargetArn: string;
  StartedAt: number;
  EndedAt?: number;
}

export interface ArService {
  name: string;
  id: string;
  arn: string;
  url: string;
  status: 'OPERATION_IN_PROGRESS' | 'RUNNING' | 'PAUSED' | 'CREATE_FAILED' | 'DELETED' | 'DELETE_FAILED';
  created: number;
  updated: number;
  deleted?: number;
  /** Imagen (`repo:tag`) y cómo se identifica. */
  image: string;
  imageType: 'ECR' | 'ECR_PUBLIC';
  accessRoleArn?: string;
  instanceRoleArn?: string;
  autoDeploy: boolean;
  port: string;
  startCommand?: string;
  env: Record<string, string>;
  secretsMap?: Record<string, string>;
  cpu: string;
  memory: string;
  health: { Protocol: 'TCP' | 'HTTP'; Path: string; Interval: number; Timeout: number; HealthyThreshold: number; UnhealthyThreshold: number };
  scalingArn: string;
  /** Lo que está sirviendo ahora (la versión anterior sigue en pie mientras se despliega otra). */
  live?: { img: ImageData; digest: string; since: number; env: Record<string, string>; args: string[] | null; role?: string; server: { port: number; bindAll: boolean; kind: 'flask' | 'gunicorn' | 'nginx' } };
  operations: ArOperation[];
  /** Lo que ocurrirá y cuándo: la operación en curso termina en `settleAt` con ese resultado. */
  pending?: { op: string; settleAt: number; ok: boolean; reason?: string; next?: ArService['live']; nextStatus: ArService['status'] };
  pendingLogs: { ts: number; msg: string; stream: 'service' | 'application' }[];
  tags: { Key: string; Value: string }[];
}

export interface ArState {
  services: Record<string, ArService>;
  scaling: Record<string, ArAutoScaling>;
  counter: number;
}

// ───────────────────────── EKS y Kubernetes ─────────────────────────

export interface EksNodegroup {
  name: string;
  arn: string;
  status: 'CREATING' | 'ACTIVE' | 'DELETING' | 'CREATE_FAILED' | 'UPDATING';
  instanceTypes: string[];
  amiType: string;
  capacityType: 'ON_DEMAND' | 'SPOT';
  diskSize: number;
  min: number;
  max: number;
  desired: number;
  subnets: string[];
  nodeRole: string;
  labels: Record<string, string>;
  created: number;
  activeAt: number;
  /** Si los nodos llegan a unirse al clúster y, si no, por qué. */
  joinFail?: { Code: string; Message: string };
  failedIds?: string[];
  deleteAt?: number;
  instanceIds: string[];
  version: string;
  tags: { Key: string; Value: string }[];
}

export interface EksFargateProfile {
  name: string;
  arn: string;
  podExecutionRoleArn: string;
  subnets: string[];
  selectors: { namespace: string; labels?: Record<string, string> }[];
  created: number;
  activeAt: number;
  deleting?: number;
  tags: { Key: string; Value: string }[];
}

export interface EksAccessEntry {
  principalArn: string;
  arn: string;
  type: string;
  kubernetesGroups: string[];
  policies: { policyArn: string; accessScope: { type: 'cluster' | 'namespace'; namespaces?: string[] } }[];
  created: number;
}

export interface K8sContainer {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  env: { name: string; value: string }[];
  ports: number[];
  /** Milicores y MiB pedidos. */
  cpu: number;
  mem: number;
  memLimit?: number;
}

export interface K8sDeployment {
  name: string;
  ns: string;
  labels: Record<string, string>;
  selector: Record<string, string>;
  replicas: number;
  containers: K8sContainer[];
  /** Resumen de la plantilla de pods (cambia cuando cambia la imagen o la configuración). */
  hash: string;
  revision: number;
  history: { revision: number; hash: string; containers: K8sContainer[] }[];
  created: number;
  generation: number;
  simAt: number;
  maxSurge: number;
  maxUnavailable: number;
  system?: boolean;
  restartNonce?: string;
}

export interface K8sPod {
  name: string;
  ns: string;
  labels: Record<string, string>;
  owner?: string;
  hash: string;
  containers: K8sContainer[];
  node?: string;
  nodeInstance?: string;
  fargate?: boolean;
  ip?: string;
  subnetId?: string;
  created: number;
  scheduledAt?: number;
  pullDoneAt?: number;
  startedAt?: number;
  /** Horas de los fallos del contenedor (el primero y los reinicios). */
  crashAt?: number[];
  failure?: { kind: 'Unschedulable' | 'ImagePull' | 'Crash'; reason: string; message: string; code?: number };
  terminatingAt?: number;
  deletedAt?: number;
  img?: ImageData;
  server?: { port: number; bindAll: boolean; kind: 'flask' | 'gunicorn' | 'nginx' };
  lines: string[];
  events: { t: number; type: 'Normal' | 'Warning'; reason: string; message: string }[];
  /** Cuándo vuelve a intentar descargar la imagen (tras un fallo). */
  retryAt?: number;
  uid: string;
  /** Pods del propio EKS (aws-node, kube-proxy, coredns). */
  system?: boolean;
  ownerRef?: string;
}

export interface K8sService {
  name: string;
  ns: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  selector: Record<string, string>;
  ports: { port: number; targetPort: number; nodePort?: number }[];
  clusterIp: string;
  created: number;
  annotations: Record<string, string>;
  lb?: { arn: string; dns: string; tgArn: string; readyAt: number };
  /** Por qué no se pudo crear el balanceador (si no pudo). */
  lbError?: string;
  events: { t: number; type: 'Normal' | 'Warning'; reason: string; message: string }[];
}

export interface K8sState {
  namespaces: string[];
  deployments: Record<string, K8sDeployment>;
  pods: Record<string, K8sPod>;
  services: Record<string, K8sService>;
  counter: number;
  simAt: number;
}

export interface EksCluster {
  name: string;
  arn: string;
  version: string;
  roleArn: string;
  status: 'CREATING' | 'ACTIVE' | 'DELETING' | 'FAILED';
  created: number;
  activeAt: number;
  endpoint: string;
  ca: string;
  vpcId: string;
  subnetIds: string[];
  securityGroupIds: string[];
  clusterSg: string;
  publicAccess: boolean;
  privateAccess: boolean;
  failure?: { Code: string; Message: string };
  deleteAt?: number;
  /** Quién creó el clúster: administrador implícito. */
  creator: string;
  accessEntries: Record<string, EksAccessEntry>;
  nodegroups: Record<string, EksNodegroup>;
  fargateProfiles: Record<string, EksFargateProfile>;
  logging: string[];
  tags: { Key: string; Value: string }[];
  k8s: K8sState;
}

export interface EksState {
  clusters: Record<string, EksCluster>;
  counter: number;
}
