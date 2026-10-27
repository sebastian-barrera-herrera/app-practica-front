/** Escenarios de la zona «Contenedores» (Z13): Docker, ECR, ECS/Fargate, EKS, App Runner y escalado. */
import { regional } from './account';
import { buildImage } from './containers/dockerfile';
import { MiniShell } from './minish';
import type { Scenario } from './scenarios';
import { TRUST, call, policy } from './scenarios-srv';
import { ecrPush } from './services/ecr';
import { iamCreateRole } from './services/iam';
import { tick } from './tick';
import type { Account } from './types';

const R = 'us-east-1';
const H = '/home/alumno';
const ACCT = '123456789012';
const REG = `${ACCT}.dkr.ecr.${R}.amazonaws.com`;
export const CONT_REPO = `${REG}/tienda`;
const ROOT = `arn:aws:iam::${ACCT}:root`;

// ───────────────────────── la aplicación de ejemplo ─────────────────────────

const APP = (host = "'0.0.0.0'") => `import os
from flask import Flask, jsonify

app = Flask(__name__)
VERSION = os.environ.get('VERSION', '1')


@app.route('/')
def home():
    return 'Hola desde la versión ' + VERSION


@app.route('/health')
def health():
    return jsonify(status='ok')


if __name__ == '__main__':
    print('Arrancando la versión', VERSION)
    app.run(host=${host}, port=5000)
`;

const DOCKERFILE = `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
`;

const REQS = 'flask==3.0.3\n';

const TASKDEF = (image = `${CONT_REPO}:1.0`, extra: Record<string, unknown> = {}) => ({
  family: 'tienda',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: `arn:aws:iam::${ACCT}:role/ecsTaskExecutionRole`,
  containerDefinitions: [
    {
      name: 'web',
      image,
      essential: true,
      portMappings: [{ containerPort: 5000 }],
      environment: [{ name: 'VERSION', value: '1' }],
      logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/tienda', 'awslogs-region': R, 'awslogs-stream-prefix': 'web' } },
    },
  ],
  ...extra,
});

/** Manifiesto de Kubernetes para la aplicación (un Deployment y un Service con balanceador). */
const MANIFEST = (image = `${CONT_REPO}:1.0`, over: { replicas?: number; selector?: string } = {}) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: ${over.replicas ?? 2}
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: ${over.selector ?? 'web'}
    spec:
      containers:
      - name: web
        image: ${image}
        ports:
        - containerPort: 5000
        env:
        - name: VERSION
          value: "1"
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
`;

const APP_FILES = (host?: string, dockerfile = DOCKERFILE) => ({ [`${H}/app/Dockerfile`]: dockerfile, [`${H}/app/app.py`]: APP(host), [`${H}/app/requirements.txt`]: REQS });

export const CONT_FILES = {
  app: APP_FILES(),
  /** El Dockerfile tiene una errata en el nombre del archivo de dependencias. */
  rota: APP_FILES(undefined, DOCKERFILE.replace('COPY requirements.txt .', 'COPY requirments.txt .')),
  taskdef: { [`${H}/taskdef.json`]: JSON.stringify(TASKDEF(), null, 2) + '\n' },
  arm: { [`${H}/taskdef.json`]: JSON.stringify(TASKDEF(`${CONT_REPO}:arm`), null, 2) + '\n' },
  manifest: { [`${H}/app.yaml`]: MANIFEST() },
  boss: { ...APP_FILES("'127.0.0.1'"), [`${H}/taskdef.json`]: JSON.stringify(TASKDEF(), null, 2) + '\n' },
} as const;

// ───────────────────────── piezas para montar escenarios ─────────────────────────

function shellRunner(a: Account) {
  return (script: string, files: Map<string, string>, cwd: string, env: Record<string, string>) => {
    const out: string[] = [];
    const clock = a.clock;
    const sh = new MiniShell({ acct: a, files, vars: { ...env }, cwd, log: (l) => out.push(l) });
    let code = 1;
    try {
      code = sh.run(script);
    } finally {
      a.clock = clock;
    }
    return { code, out: out.join('\n') };
  };
}

/** Construye la imagen de la aplicación y la sube a ECR con esa etiqueta. */
function pushImage(a: Account, tag: string, o: { host?: string; platform?: 'amd64' | 'arm64'; repo?: string; version?: string } = {}) {
  const files = new Map(Object.entries(APP_FILES(o.host)).map(([k, v]) => [k.replace(`${H}/app/`, ''), v]));
  const res = buildImage({ files, dockerfile: o.version ? DOCKERFILE.replace('EXPOSE 5000', `ENV VERSION=${o.version}\nEXPOSE 5000`) : DOCKERFILE, platform: o.platform ?? 'amd64', buildArgs: {}, local: () => undefined, shell: shellRunner(a) });
  if (!res.ok || !res.image) throw new Error('escenario: la imagen no se construye: ' + (res.error ?? res.log.join('\n')));
  ecrPush(a, R, ROOT, o.repo ?? 'tienda', tag, res.image);
}

const ecrRepo = (a: Account, name = 'tienda', extra: Record<string, unknown> = {}) => call(a, 'ecr', 'create-repository', { repositoryName: name, ...extra });

function execRole(a: Account, withPolicy = true) {
  return iamCreateRole(a, 'ecsTaskExecutionRole', TRUST('ecs-tasks.amazonaws.com'), { attached: withPolicy ? ['service-role/AmazonECSTaskExecutionRolePolicy'] : [] }).Arn;
}

interface Net {
  vpcId: string;
  subnets: string[];
  defSg: string;
}

function defaultNet(a: Account): Net {
  const r = regional(a, R).ec2;
  const subs = Object.values(r.subnets).filter((s) => s.DefaultForAz);
  const vpcId = subs[0].VpcId;
  const defSg = Object.values(r.securityGroups).find((g) => g.VpcId === vpcId && g.GroupName === 'default')!.GroupId;
  return { vpcId, subnets: subs.slice(0, 2).map((s) => s.SubnetId), defSg };
}

function sg(a: Account, vpcId: string, name: string, desc: string): string {
  return call(a, 'ec2', 'create-security-group', { GroupName: name, Description: desc, VpcId: vpcId }).GroupId as string;
}

const ingress = (a: Account, groupId: string, port: number, o: { cidr?: string; fromSg?: string }) =>
  call(a, 'ec2', 'authorize-security-group-ingress', { GroupId: groupId, IpPermissions: [{ IpProtocol: 'tcp', FromPort: port, ToPort: port, ...(o.cidr ? { IpRanges: [{ CidrIp: o.cidr }] } : {}), ...(o.fromSg ? { UserIdGroupPairs: [{ GroupId: o.fromSg }] } : {}) }] });

interface Alb {
  albSg: string;
  taskSg: string;
  tgArn: string;
  lbArn: string;
}

/** Un balanceador de aplicación público (`web`) con su grupo de destino de tipo `ip`, listo para recibir tareas de ECS. */
function alb(a: Account, net: Net, o: { healthPath?: string; taskIngress?: boolean } = {}): Alb {
  const albSg = sg(a, net.vpcId, 'alb-sg', 'Balanceador: HTTP desde internet');
  ingress(a, albSg, 80, { cidr: '0.0.0.0/0' });
  const taskSg = sg(a, net.vpcId, 'task-sg', 'Tareas de ECS');
  if (o.taskIngress !== false) ingress(a, taskSg, 5000, { fromSg: albSg });
  const lbArn = call(a, 'elbv2', 'create-load-balancer', { Name: 'web', Subnets: net.subnets, SecurityGroups: [albSg] }).LoadBalancers[0].LoadBalancerArn as string;
  const tgArn = call(a, 'elbv2', 'create-target-group', { Name: 'web-tg', Protocol: 'HTTP', Port: 5000, VpcId: net.vpcId, TargetType: 'ip', HealthCheckPath: o.healthPath ?? '/health', HealthCheckIntervalSeconds: 10, HealthyThresholdCount: 2, UnhealthyThresholdCount: 2 }).TargetGroups[0].TargetGroupArn as string;
  call(a, 'elbv2', 'create-listener', { LoadBalancerArn: lbArn, Protocol: 'HTTP', Port: 80, DefaultActions: [{ Type: 'forward', TargetGroupArn: tgArn }] });
  a.clock += 4 * 60000;
  return { albSg, taskSg, tgArn, lbArn };
}

const registerTd = (a: Account, def: Record<string, unknown>) => call(a, 'ecs', 'register-task-definition', def);

function createService(a: Account, net: Net, x: Alb, td: string, o: { desired?: number; launchType?: string; strategy?: unknown; breaker?: boolean; grace?: number } = {}) {
  call(a, 'ecs', 'create-service', {
    cluster: 'demo',
    serviceName: 'tienda',
    taskDefinition: td,
    desiredCount: o.desired ?? 2,
    ...(o.strategy ? { capacityProviderStrategy: o.strategy } : { launchType: o.launchType ?? 'FARGATE' }),
    networkConfiguration: { awsvpcConfiguration: { subnets: net.subnets, securityGroups: [x.taskSg], assignPublicIp: 'ENABLED' } },
    loadBalancers: [{ targetGroupArn: x.tgArn, containerName: 'web', containerPort: 5000 }],
    healthCheckGracePeriodSeconds: o.grace ?? 30,
    ...(o.breaker ? { deploymentConfiguration: { deploymentCircuitBreaker: { enable: true, rollback: true } } } : {}),
  });
}

/** La base de los escenarios de ECS: imágenes en ECR, rol de ejecución, registros, clúster, balanceador y definición de tarea. */
function ecsWorld(base: Scenario, a: Account, o: { tags?: string[]; roleOk?: boolean; healthPath?: string; withTd?: boolean } = {}) {
  base(a);
  ecrRepo(a);
  for (const t of o.tags ?? ['1.0']) pushImage(a, t);
  execRole(a, o.roleOk !== false);
  call(a, 'logs', 'create-log-group', { logGroupName: '/ecs/tienda' });
  call(a, 'ecs', 'create-cluster', { clusterName: 'demo' });
  const net = defaultNet(a);
  const x = alb(a, net, { healthPath: o.healthPath });
  if (o.withTd !== false) registerTd(a, TASKDEF());
  return { net, x };
}

const nodeRole = (a: Account, ecrRead: boolean) =>
  iamCreateRole(a, 'eksNodeRole', TRUST('ec2.amazonaws.com'), { attached: ['AmazonEKSWorkerNodePolicy', 'AmazonEKS_CNI_Policy', ...(ecrRead ? ['AmazonEC2ContainerRegistryReadOnly'] : [])] }).Arn;

function eksWorld(base: Scenario, a: Account, o: { ecrRead: boolean; cluster?: boolean }) {
  base(a);
  ecrRepo(a);
  pushImage(a, '1.0');
  const clusterRole = iamCreateRole(a, 'eksClusterRole', TRUST('eks.amazonaws.com'), { attached: ['AmazonEKSClusterPolicy'] }).Arn;
  const nRole = nodeRole(a, o.ecrRead);
  if (o.cluster === false) return;
  const net = defaultNet(a);
  call(a, 'eks', 'create-cluster', { name: 'tienda', roleArn: clusterRole, resourcesVpcConfig: { subnetIds: net.subnets } });
  a.clock += 10 * 60000;
  tick(a);
  call(a, 'eks', 'create-nodegroup', { clusterName: 'tienda', nodegroupName: 'general', nodeRole: nRole, subnets: net.subnets, scalingConfig: { minSize: 1, maxSize: 3, desiredSize: 2 }, instanceTypes: ['t3.medium'] });
  a.clock += 6 * 60000;
  tick(a);
}

// ───────────────────────── escenarios ─────────────────────────

export function makeContScenarios(base: Scenario): Record<string, Scenario> {
  /** Un repositorio con siete versiones de la aplicación y otras dos sin etiqueta. */
  const ecr: Scenario = (a) => {
    base(a);
    ecrRepo(a, 'tienda');
    for (let k = 1; k <= 7; k++) {
      pushImage(a, `v${k}`, { version: String(k) });
      a.clock += 3600000;
    }
  };

  /** ECS listo para crear el servicio: imagen 1.0, rol de ejecución, clúster, balanceador y definición de tarea (sin servicio). */
  const ecsListo: Scenario = (a) => {
    ecsWorld(base, a, { tags: ['1.0', '2.0'] });
  };

  /** El servicio `tienda` no arranca: su definición de tarea apunta a una etiqueta (1.1) que no existe en ECR. */
  const ecsEtiqueta: Scenario = (a) => {
    const { net, x } = ecsWorld(base, a, { tags: ['1.0'], withTd: false });
    registerTd(a, TASKDEF(`${CONT_REPO}:1.1`));
    createService(a, net, x, 'tienda:1');
    a.clock += 8 * 60000;
  };

  /** El servicio arranca pero el balanceador da las tareas por no sanas: la ruta de salud del grupo de destino es incorrecta. */
  const ecsSalud: Scenario = (a) => {
    const { net, x } = ecsWorld(base, a, { tags: ['1.0'], healthPath: '/healthz' });
    createService(a, net, x, 'tienda:1', { grace: 0 });
    a.clock += 8 * 60000;
  };

  /** Una imagen para ARM (Graviton) ejecutándose con una definición de tarea para x86: el contenedor muere al arrancar. */
  const ecsArm: Scenario = (a) => {
    const { net, x } = ecsWorld(base, a, { tags: ['1.0'], withTd: false });
    pushImage(a, 'arm', { platform: 'arm64' });
    registerTd(a, TASKDEF(`${CONT_REPO}:arm`));
    createService(a, net, x, 'tienda:1');
    a.clock += 8 * 60000;
  };

  /** Un servicio en Fargate con 4 tareas bajo demanda y los proveedores FARGATE y FARGATE_SPOT disponibles en el clúster. */
  const ecsSpot: Scenario = (a) => {
    const { net, x } = ecsWorld(base, a, { tags: ['1.0'] });
    call(a, 'ecs', 'put-cluster-capacity-providers', { cluster: 'demo', capacityProviders: ['FARGATE', 'FARGATE_SPOT'], defaultCapacityProviderStrategy: [{ capacityProvider: 'FARGATE', weight: 1 }] });
    createService(a, net, x, 'tienda:1', { desired: 4 });
    a.clock += 6 * 60000;
  };

  /** Un servicio estable con dos tareas detrás del balanceador, listo para añadirle escalado automático. */
  const ecsVivo: Scenario = (a) => {
    const { net, x } = ecsWorld(base, a, { tags: ['1.0'] });
    createService(a, net, x, 'tienda:1', { desired: 2 });
    a.clock += 6 * 60000;
  };

  /** EKS: clúster y grupo de nodos activos, imagen en ECR y nodos con permiso para descargarla. */
  const eks: Scenario = (a) => eksWorld(base, a, { ecrRead: true });

  /** EKS: los nodos no pueden descargar de ECR (al rol de los nodos le falta la política de solo lectura). */
  const eksRoto: Scenario = (a) => eksWorld(base, a, { ecrRead: false });

  /** EKS con un usuario, `ana`, que puede llamar a la API de EKS pero no está dado de alta en el clúster. */
  const eksAcceso: Scenario = (a) => {
    eksWorld(base, a, { ecrRead: true });
    call(a, 'iam', 'create-user', { UserName: 'ana' });
    call(a, 'iam', 'put-user-policy', { UserName: 'ana', PolicyName: 'eks', PolicyDocument: JSON.stringify(policy([{ Action: 'eks:*', Resource: '*' }])) });
  };

  /** App Runner: la imagen en ECR y el rol de acceso que App Runner necesita para descargarla. */
  const apprunner: Scenario = (a) => {
    base(a);
    ecrRepo(a);
    pushImage(a, '1.0');
    iamCreateRole(a, 'apprunner-ecr', TRUST('build.apprunner.amazonaws.com'), { attached: ['service-role/AWSAppRunnerServicePolicyForECRAccess'] });
  };

  /** App Runner: el servicio `tienda` se creó con el puerto por defecto (8080) y falló. */
  const apprunnerRoto: Scenario = (a) => {
    apprunner(a);
    call(a, 'apprunner', 'create-service', { ServiceName: 'tienda', SourceConfiguration: { ImageRepository: { ImageIdentifier: `${CONT_REPO}:1.0`, ImageRepositoryType: 'ECR', ImageConfiguration: { Port: '8080' } }, AuthenticationConfiguration: { AccessRoleArn: `arn:aws:iam::${ACCT}:role/apprunner-ecr` } } });
    a.clock += 10 * 60000;
  };

  /** Misión final: el código de la tienda (con un fallo), el repositorio vacío, el balanceador, los roles y la red; falta construir y desplegar. */
  const boss: Scenario = (a) => {
    base(a);
    ecrRepo(a);
    execRole(a, false);
    call(a, 'logs', 'create-log-group', { logGroupName: '/ecs/tienda' });
    call(a, 'ecs', 'create-cluster', { clusterName: 'demo' });
    const net = defaultNet(a);
    alb(a, net, { taskIngress: false });
  };

  return { 'cont-ecr': ecr, 'cont-ecs': ecsListo, 'cont-ecs-etiqueta': ecsEtiqueta, 'cont-ecs-salud': ecsSalud, 'cont-ecs-arm': ecsArm, 'cont-ecs-spot': ecsSpot, 'cont-ecs-vivo': ecsVivo, 'cont-eks': eks, 'cont-eks-roto': eksRoto, 'cont-eks-acceso': eksAcceso, 'cont-apprunner': apprunner, 'cont-apprunner-roto': apprunnerRoto, 'cont-boss': boss };
}
