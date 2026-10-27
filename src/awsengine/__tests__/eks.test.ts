import { Terminal } from '../../engine/terminal';

const APP = `import os
from flask import Flask, jsonify

app = Flask(__name__)
VERSION = os.environ.get('VERSION', '1')


@app.route('/')
def home():
    return 'Hola desde Kubernetes, versión ' + VERSION


@app.route('/health')
def health():
    return jsonify(status='ok')


if __name__ == '__main__':
    print('Arrancando la versión', VERSION)
    app.run(host='0.0.0.0', port=5000)
`;
const DOCKERFILE = `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
`;
const REG = '123456789012.dkr.ecr.us-east-1.amazonaws.com';
const REPO = `${REG}/tienda`;

const manifest = (over: { image?: string; replicas?: number; cpu?: string; version?: string; svc?: boolean; labelsOk?: boolean } = {}) => `apiVersion: apps/v1
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
        app: ${over.labelsOk === false ? 'otra' : 'web'}
    spec:
      containers:
      - name: web
        image: ${over.image ?? `${REPO}:1.0`}
        ports:
        - containerPort: 5000
        env:
        - name: VERSION
          value: "${over.version ?? '1'}"
        resources:
          requests:
            cpu: ${over.cpu ?? '100m'}
            memory: 128Mi
${over.svc === false ? '' : `---
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
`}`;

async function setup() {
  const t = new Terminal({ instant: true, aws: 'base', cols: 160, files: { '/home/alumno/app/Dockerfile': DOCKERFILE, '/home/alumno/app/app.py': APP, '/home/alumno/app/requirements.txt': 'flask==3.0.3\n' } });
  const sh = async (c: string) => await t.exec(c);
  await sh('docker build -t tienda:1.0 app');
  await sh('aws ecr create-repository --repository-name tienda');
  await sh(`aws ecr get-login-password | docker login --username AWS --password-stdin ${REG}`);
  await sh(`docker tag tienda:1.0 ${REPO}:1.0`);
  await sh(`docker push ${REPO}:1.0`);
  const trust = (svc: string) => `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"${svc}"},"Action":"sts:AssumeRole"}]}' > t.json`;
  await sh(trust('eks.amazonaws.com'));
  await sh('aws iam create-role --role-name eksClusterRole --assume-role-policy-document file://t.json');
  await sh('aws iam attach-role-policy --role-name eksClusterRole --policy-arn arn:aws:iam::aws:policy/AmazonEKSClusterPolicy');
  await sh(trust('ec2.amazonaws.com'));
  await sh('aws iam create-role --role-name eksNodeRole --assume-role-policy-document file://t.json');
  for (const p of ['AmazonEKSWorkerNodePolicy', 'AmazonEKS_CNI_Policy', 'AmazonEC2ContainerRegistryReadOnly']) await sh(`aws iam attach-role-policy --role-name eksNodeRole --policy-arn arn:aws:iam::aws:policy/${p}`);
  await sh('S1=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[0].SubnetId" --output text)');
  await sh('S2=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[1].SubnetId" --output text)');
  await sh('SUBNETS=$S1,$S2');
  return t;
}
const out = async (t: Terminal, cmd: string) => (await t.exec(cmd)).out.trim();
const CLUSTER = 'aws eks create-cluster --name demo --role-arn arn:aws:iam::123456789012:role/eksClusterRole --resources-vpc-config subnetIds=$SUBNETS';
const NG = (extra = '') => `aws eks create-nodegroup --cluster-name demo --nodegroup-name ng1 --node-role arn:aws:iam::123456789012:role/eksNodeRole --subnets $(echo $SUBNETS | tr "," " ") --scaling-config minSize=1,maxSize=3,desiredSize=2 --instance-types t3.medium ${extra}`;

async function withCluster() {
  const t = await setup();
  const c = await t.exec(CLUSTER);
  if (c.status !== 0) throw new Error('create-cluster: ' + c.err);
  await t.exec('aws eks wait cluster-active --name demo');
  await t.exec('aws eks update-kubeconfig --name demo');
  const n = await t.exec(NG());
  if (n.status !== 0) throw new Error('create-nodegroup: ' + n.err);
  await t.exec('aws eks wait nodegroup-active --cluster-name demo --nodegroup-name ng1');
  return t;
}

describe('EKS: clúster y grupos de nodos', () => {
  test('validaciones al crear el clúster', async () => {
    const t = await setup();
    expect((await t.exec('aws eks create-cluster --name demo --role-arn arn:aws:iam::123456789012:role/eksNodeRole --resources-vpc-config subnetIds=$SUBNETS')).err).toContain('could not be assumed');
    expect((await t.exec('aws eks create-cluster --name demo --role-arn arn:aws:iam::123456789012:role/eksClusterRole --resources-vpc-config subnetIds=$(echo $SUBNETS | cut -d, -f1)')).err).toContain('at least two different AZs');
    expect((await t.exec('aws eks create-cluster --name demo --kubernetes-version 1.10 --role-arn arn:aws:iam::123456789012:role/eksClusterRole --resources-vpc-config subnetIds=$SUBNETS')).err).toContain('unsupported Kubernetes version');
    const c = JSON.parse((await t.exec(CLUSTER)).out).cluster;
    expect(c.status).toBe('CREATING');
    expect(c.endpoint).toBeUndefined();
    expect(c.platformVersion).toBe('eks.5');
    expect((await t.exec(CLUSTER)).err).toContain('Cluster already exists');
    // sin clúster activo no hay nodos ni kubeconfig
    expect((await t.exec('aws eks update-kubeconfig --name demo')).err).toContain('Cluster status is CREATING');
    expect((await t.exec(NG())).err).toContain('not in ACTIVE status');
    await t.exec('sleep 300');
    expect(await out(t, 'aws eks describe-cluster --name demo --query cluster.status --output text')).toBe('CREATING');
    await t.exec('aws eks wait cluster-active --name demo');
    const d = JSON.parse((await t.exec('aws eks describe-cluster --name demo')).out).cluster;
    expect(d.status).toBe('ACTIVE');
    expect(d.endpoint).toMatch(/^https:\/\/[0-9A-F]{32}\.gr7\.us-east-1\.eks\.amazonaws\.com$/);
    expect(d.certificateAuthority.data.length).toBeGreaterThan(20);
    expect(await out(t, 'aws eks list-clusters --query "clusters[0]" --output text')).toBe('demo');
    expect(await out(t, 'aws eks list-access-entries --cluster-name demo --query "length(accessEntries)"')).toBe('1');
  });

  test('un rol de clúster sin la política AmazonEKSClusterPolicy hace fallar la creación', async () => {
    const t = await setup();
    await t.exec('aws iam detach-role-policy --role-name eksClusterRole --policy-arn arn:aws:iam::aws:policy/AmazonEKSClusterPolicy');
    await t.exec(CLUSTER);
    await t.exec('sleep 240');
    const d = JSON.parse((await t.exec('aws eks describe-cluster --name demo')).out).cluster;
    expect(d.status).toBe('FAILED');
    expect(d.health.issues[0].message).toContain('AmazonEKSClusterPolicy');
    expect((await t.exec('aws eks wait cluster-active --name demo')).err).toContain('FAILED');
  });

  test('grupo de nodos: validaciones, instancias con etiquetas y nodos que se unen al clúster', async () => {
    const t = await setup();
    await t.exec(CLUSTER);
    await t.exec('aws eks wait cluster-active --name demo');
    expect((await t.exec(NG().replace('eksNodeRole', 'eksClusterRole'))).err).toContain('ec2.amazonaws.com');
    expect((await t.exec(NG().replace('minSize=1', 'minSize=5'))).err).toContain('Minimum capacity cannot be greater than maximum capacity');
    expect((await t.exec(NG().replace('t3.medium', 't9.huge'))).err).toContain('not valid');
    expect((await t.exec(NG('--ami-type AL2023_ARM_64_STANDARD'))).err).toContain('not compatible');
    const n = JSON.parse((await t.exec(NG())).out).nodegroup;
    expect(n.status).toBe('CREATING');
    expect((await t.exec(NG())).err).toContain('already exists');
    const ids = await out(t, 'aws ec2 describe-instances --filters Name=tag:eks:nodegroup-name,Values=ng1 --query "Reservations[].Instances[].InstanceId" --output text');
    expect(ids.split(/\s+/)).toHaveLength(2);
    expect(await out(t, 'aws ec2 describe-instances --filters Name=tag:eks:cluster-name,Values=demo --query "Reservations[0].Instances[0].Tags[?Key==\'kubernetes.io/cluster/demo\'].Value | [0]" --output text')).toBe('owned');
    await t.exec('aws eks update-kubeconfig --name demo');
    expect(await out(t, 'cat ~/.kube/config | grep server:')).toContain('.eks.amazonaws.com');
    expect((await t.exec('aws eks update-kubeconfig --name demo')).out).toContain('Updated context');
    await t.exec('aws eks wait nodegroup-active --cluster-name demo --nodegroup-name ng1');
    const nodes = await out(t, 'kubectl get nodes');
    expect(nodes.split('\n')).toHaveLength(3);
    expect(nodes).toMatch(/ip-172-31-\d+-\d+\.ec2\.internal\s+Ready\s+<none>/);
    const pods = await out(t, 'kubectl get pods -A');
    expect(pods).toContain('aws-node-');
    expect(pods).toContain('kube-proxy-');
    expect(pods).toContain('coredns-');
    await t.exec('aws eks update-nodegroup-config --cluster-name demo --nodegroup-name ng1 --scaling-config minSize=1,maxSize=3,desiredSize=3');
    await t.exec('sleep 120');
    expect((await out(t, 'kubectl get nodes')).split('\n')).toHaveLength(4);
    expect((await t.exec('aws eks delete-cluster --name demo')).err).toContain('nodegroups attached');
    await t.exec('aws eks delete-nodegroup --cluster-name demo --nodegroup-name ng1');
    await t.exec('aws eks wait nodegroup-deleted --cluster-name demo --nodegroup-name ng1');
    expect(await out(t, 'aws ec2 describe-instances --filters Name=tag:eks:nodegroup-name,Values=ng1 Name=instance-state-name,Values=running --query "length(Reservations)"')).toBe('0');
    await t.exec('aws eks delete-cluster --name demo');
    await t.exec('aws eks wait cluster-deleted --name demo');
    expect(await out(t, 'aws eks list-clusters --query "length(clusters)"')).toBe('0');
  });

  test('un rol de nodos sin las políticas necesarias: los nodos no se unen y el grupo falla', async () => {
    const t = await setup();
    await t.exec(CLUSTER);
    await t.exec('aws eks wait cluster-active --name demo');
    await t.exec('aws iam detach-role-policy --role-name eksNodeRole --policy-arn arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy');
    await t.exec(NG());
    const w = await t.exec('aws eks wait nodegroup-active --cluster-name demo --nodegroup-name ng1');
    expect(w.err).toContain('CREATE_FAILED');
    const n = JSON.parse((await t.exec('aws eks describe-nodegroup --cluster-name demo --nodegroup-name ng1')).out).nodegroup;
    expect(n.status).toBe('CREATE_FAILED');
    expect(n.health.issues[0].code).toBe('NodeCreationFailure');
    expect(n.health.issues[0].message).toContain('AmazonEKS_CNI_Policy');
  });
});

describe('kubectl', () => {
  test('sin kubeconfig o sin credenciales no hay conexión', async () => {
    const t = await setup();
    expect((await t.exec('kubectl get nodes')).err).toContain('localhost:8080 was refused');
    await t.exec(CLUSTER);
    await t.exec('aws eks wait cluster-active --name demo');
    await t.exec('aws eks update-kubeconfig --name demo');
    expect((await t.exec('AWS_ACCESS_KEY_ID=AKIAINVALID000000000 AWS_SECRET_ACCESS_KEY=x kubectl get nodes')).err).toContain('getting credentials');
    expect(await out(t, 'kubectl config current-context')).toBe('arn:aws:eks:us-east-1:123456789012:cluster/demo');
    expect((await t.exec('kubectl get nodes')).err).toContain('No resources found');
  });

  test('desplegar una aplicación con balanceador: pods, servicio, curl y registros', async () => {
    const t = await withCluster();
    const bad = await t.exec('echo "' + manifest({ labelsOk: false }).replace(/"/g, '\\"') + '" > bad.yaml && kubectl apply -f bad.yaml');
    expect(bad.err).toContain('`selector` does not match template `labels`');
    await t.exec(`cat > app.yaml <<'EOF'\n${manifest()}\nEOF`);
    const ap = await out(t, 'kubectl apply -f app.yaml');
    expect(ap).toBe('deployment.apps/web created\nservice/web created');
    expect(await out(t, 'kubectl apply -f app.yaml')).toBe('deployment.apps/web unchanged\nservice/web unchanged');
    const early = await out(t, 'kubectl get pods');
    expect(early).toMatch(/web-[a-z0-9]+-[a-z0-9]{5}\s+0\/1\s+ContainerCreating/);
    expect(await out(t, 'kubectl get svc web')).toContain('<pending>');
    await t.exec('kubectl wait --for=condition=available deployment/web --timeout=120s');
    const pods = await out(t, 'kubectl get pods');
    expect(pods.split('\n')).toHaveLength(3);
    expect(pods).toMatch(/1\/1\s+Running\s+0/);
    expect(await out(t, 'kubectl get deploy')).toMatch(/web\s+2\/2\s+2\s+2/);
    const logs = await out(t, 'kubectl logs deploy/web');
    expect(logs).toContain('Arrancando la versión 1');
    await t.exec('sleep 200');
    const svc = await out(t, "kubectl get svc web -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'");
    expect(svc).toMatch(/^k8s-default-web-[0-9a-f]+-[0-9a-f]+\.elb\.us-east-1\.amazonaws\.com$/);
    expect(await out(t, 'kubectl get svc web')).toMatch(/LoadBalancer\s+172\.20\.\d+\.\d+\s+k8s-default-web/);
    expect(await out(t, `curl -s http://${svc}/`)).toBe('Hola desde Kubernetes, versión 1');
    const d = await out(t, 'kubectl describe svc web');
    expect(d).toContain('LoadBalancer Ingress:');
    expect(d).toMatch(/Endpoints:\s+172\.31\.\d+\.\d+:5000,172\.31\.\d+\.\d+:5000/);
    // escalar
    expect(await out(t, 'kubectl scale deployment web --replicas=4')).toBe('deployment.apps/web scaled');
    await t.exec('kubectl wait --for=condition=available deployment/web --timeout=120s');
    expect((await out(t, 'kubectl get pods -o wide')).split('\n')).toHaveLength(5);
    // borrar
    expect(await out(t, 'kubectl delete -f app.yaml')).toBe('deployment.apps "web" deleted\nservice "web" deleted');
    await t.exec('sleep 30');
    expect((await t.exec('kubectl get pods')).err).toContain('No resources found in default namespace.');
    expect(await out(t, 'aws elbv2 describe-load-balancers --query "length(LoadBalancers)"')).toBe('0');
  });

  test('actualización gradual: set image, rollout status y undo', async () => {
    const t = await withCluster();
    await t.exec(`docker tag tienda:1.0 ${REPO}:2.0 && docker push ${REPO}:2.0`);
    await t.exec('kubectl create deployment web --image=' + REPO + ':1.0 --replicas=3 --port=5000');
    expect(await out(t, 'kubectl rollout status deployment/web')).toContain('successfully rolled out');
    expect(await out(t, `kubectl set image deployment/web tienda=${REPO}:2.0`)).toBe('deployment.apps/web image updated');
    const st = await out(t, 'kubectl rollout status deployment/web');
    expect(st).toContain('Waiting for deployment "web" rollout to finish');
    expect(st).toContain('successfully rolled out');
    expect(await out(t, "kubectl get deploy web -o jsonpath='{.spec.template.spec.containers[0].image}'")).toBe(`${REPO}:2.0`);
    expect(await out(t, 'kubectl get rs')).toMatch(/web-[a-z0-9]+\s+0\s+0\s+0/);
    expect(await out(t, 'kubectl rollout history deployment/web')).toContain('REVISION');
    await t.exec('kubectl rollout undo deployment/web');
    expect(await out(t, 'kubectl rollout status deployment/web')).toContain('successfully rolled out');
    expect(await out(t, "kubectl get deploy web -o jsonpath='{.spec.template.spec.containers[0].image}'")).toBe(`${REPO}:1.0`);
  });

  test('errores clásicos: imagen que no existe, rol de nodos sin ECR, pod que no cabe y contenedor que se cae', async () => {
    const t = await withCluster();
    // 1. etiqueta inexistente
    await t.exec('kubectl run rota --image=' + REPO + ':9.9 --port=5000');
    await t.exec('sleep 10');
    expect(await out(t, 'kubectl get pod rota')).toMatch(/rota\s+0\/1\s+ErrImagePull/);
    await t.exec('sleep 25');
    expect(await out(t, 'kubectl get pod rota')).toMatch(/rota\s+0\/1\s+ImagePullBackOff/);
    const desc = await out(t, 'kubectl describe pod rota');
    expect(desc).toContain('Failed to pull image');
    expect(desc).toContain('not found');
    expect(desc).toContain('Back-off pulling image');
    expect((await t.exec('kubectl logs rota')).err).toContain('is waiting to start: trying and failing to pull image');
    // 2. el rol de los nodos pierde el permiso de ECR: la imagen buena tampoco se descarga hasta que se arregla
    await t.exec('aws iam detach-role-policy --role-name eksNodeRole --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly');
    await t.exec('kubectl run sinpermiso --image=' + REPO + ':1.0 --port=5000');
    await t.exec('sleep 40');
    expect(await out(t, 'kubectl describe pod sinpermiso')).toContain('401 Unauthorized');
    await t.exec('aws iam attach-role-policy --role-name eksNodeRole --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly');
    await t.exec('sleep 120');
    expect(await out(t, 'kubectl get pod sinpermiso')).toMatch(/sinpermiso\s+1\/1\s+Running/);
    // 3. no cabe
    await t.exec('cat > grande.yaml <<EOF\n' + manifest({ cpu: '3', replicas: 1, svc: false }) + '\nEOF');
    await t.exec('kubectl apply -f grande.yaml');
    await t.exec('sleep 20');
    expect(await out(t, 'kubectl get pods -l app=web')).toMatch(/Pending/);
    const pd = await out(t, 'kubectl describe pod -l app=web');
    expect(pd).toContain('FailedScheduling');
    expect(pd).toContain('Insufficient cpu');
    // 4. se cae
    await t.exec('kubectl delete deployment web');
    await t.exec('kubectl run falla --image=python:3.12-slim -- python -c "raise SystemExit(3)"');
    await t.exec('sleep 150');
    expect(await out(t, 'kubectl get pod falla')).toMatch(/falla\s+0\/1\s+CrashLoopBackOff\s+[1-9]/);
    expect(await out(t, 'kubectl describe pod falla')).toContain('Back-off restarting failed container');
  });

  test('permisos: sin acceso, solo lectura y administrador', async () => {
    const t = await withCluster();
    await t.exec('aws iam create-user --user-name ana');
    await t.exec('aws iam create-access-key --user-name ana > key.json');
    await t.exec('ANA_KEY=$(aws iam list-access-keys --user-name ana --query "AccessKeyMetadata[0].AccessKeyId" --output text)');
    await t.exec('ANA_SECRET=$(grep SecretAccessKey key.json | cut -d\\" -f4)');
    const asAna = (c: string) => `AWS_ACCESS_KEY_ID=$ANA_KEY AWS_SECRET_ACCESS_KEY=$ANA_SECRET ${c}`;
    await t.exec(`cat > p.json <<'EOF'\n{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"eks:*","Resource":"*"}]}\nEOF`);
    await t.exec('aws iam put-user-policy --user-name ana --policy-name eks --policy-document file://p.json');
    expect((await t.exec(asAna('kubectl get pods'))).err).toContain('You must be logged in to the server (Unauthorized)');
    await t.exec('aws eks create-access-entry --cluster-name demo --principal-arn arn:aws:iam::123456789012:user/ana');
    expect((await t.exec(asAna('kubectl get pods'))).err).toContain('Error from server (Forbidden): pods is forbidden: User "arn:aws:iam::123456789012:user/ana" cannot list resource "pods"');
    await t.exec('aws eks associate-access-policy --cluster-name demo --principal-arn arn:aws:iam::123456789012:user/ana --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy --access-scope type=cluster');
    expect((await t.exec(asAna('kubectl get pods'))).status).toBe(0);
    const w = await t.exec(asAna('kubectl create deployment x --image=nginx'));
    expect(w.err).toContain('Error from server (Forbidden): deployments.apps is forbidden: User "arn:aws:iam::123456789012:user/ana" cannot create resource "deployments" in API group "apps" in the namespace "default"');
    expect(await out(t, asAna('kubectl auth can-i create deployments'))).toBe('no');
    await t.exec('aws eks associate-access-policy --cluster-name demo --principal-arn arn:aws:iam::123456789012:user/ana --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy --access-scope type=namespace,namespaces=pruebas');
    expect(await out(t, asAna('kubectl auth can-i create deployments -n pruebas'))).toBe('yes');
    expect(await out(t, 'aws eks list-associated-access-policies --cluster-name demo --principal-arn arn:aws:iam::123456789012:user/ana --query "length(associatedAccessPolicies)"')).toBe('2');
  });
});

describe('EKS con Fargate', () => {
  test('perfil de Fargate: solo subredes privadas y los pods del namespace corren en Fargate', async () => {
    const t = await withCluster();
    const trustF = `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"eks-fargate-pods.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > tf.json`;
    await t.exec(trustF);
    await t.exec('aws iam create-role --role-name fargateRole --assume-role-policy-document file://tf.json');
    await t.exec('aws iam attach-role-policy --role-name fargateRole --policy-arn arn:aws:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy');
    const bad = await t.exec('aws eks create-fargate-profile --cluster-name demo --fargate-profile-name fp --pod-execution-role-arn arn:aws:iam::123456789012:role/fargateRole --subnets $(echo $SUBNETS | cut -d, -f1) --selectors namespace=serverless');
    expect(bad.err).toContain('public subnet');
  });
});
