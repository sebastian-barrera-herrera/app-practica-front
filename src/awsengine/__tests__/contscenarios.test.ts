import { Terminal } from '../../engine/terminal';
import { CONT_FILES } from '../scenarios-cont';

const mk = (aws: string, files: Record<string, string> = {}) => new Terminal({ instant: true, aws, cols: 160, files });
const out = async (t: Terminal, cmd: string) => (await t.exec(cmd)).out.trim();

describe('escenarios de contenedores', () => {
  test('cont-ecr: siete versiones en el repositorio', async () => {
    const t = mk('cont-ecr');
    expect(await out(t, 'aws ecr describe-images --repository-name tienda --query "length(imageDetails)"')).toBe('7');
  });

  test('cont-ecs: todo listo menos el servicio', async () => {
    const t = mk('cont-ecs');
    expect(await out(t, 'aws ecr list-images --repository-name tienda --query "imageIds[].imageTag" --output text')).toMatch(/1\.0/);
    expect(await out(t, 'aws ecs list-task-definitions --query "length(taskDefinitionArns)"')).toBe('1');
    expect(await out(t, 'aws elbv2 describe-load-balancers --query "LoadBalancers[0].State.Code" --output text')).toBe('active');
    expect(await out(t, 'aws ecs list-services --cluster demo --query "length(serviceArns)"')).toBe('0');
  });

  test('cont-ecs-etiqueta: las tareas no se descargan', async () => {
    const t = mk('cont-ecs-etiqueta');
    expect(await out(t, 'aws ecs describe-services --cluster demo --services tienda --query "services[0].runningCount"')).toBe('0');
    const ev = await out(t, 'aws ecs describe-services --cluster demo --services tienda --query "services[0].events[0].message" --output text');
    expect(ev).toContain('tienda');
    expect(await out(t, 'aws ecs list-tasks --cluster demo --desired-status STOPPED --query "length(taskArns)"')).not.toBe('0');
  });

  test('cont-ecs-salud y cont-ecs-vivo', async () => {
    const t = mk('cont-ecs-salud');
    expect(await out(t, 'aws ecs describe-services --cluster demo --services tienda --query "services[0].deployments[0].failedTasks"')).not.toBe('0');
    const v = mk('cont-ecs-vivo');
    expect(await out(v, 'aws ecs describe-services --cluster demo --services tienda --query "services[0].[runningCount,desiredCount]" --output text')).toBe('2\t2');
    expect(await out(v, '_check http --url http://lb:web/')).toBe('');
  });

  test('cont-ecs-arm y cont-ecs-spot', async () => {
    const t = mk('cont-ecs-arm');
    expect(await out(t, 'aws ecs describe-services --cluster demo --services tienda --query "services[0].runningCount"')).toBe('0');
    const s = mk('cont-ecs-spot');
    expect(await out(s, 'aws ecs describe-services --cluster demo --services tienda --query "services[0].runningCount"')).toBe('4');
    expect(await out(s, 'aws ecs describe-clusters --clusters demo --query "clusters[0].capacityProviders" --output text')).toContain('FARGATE_SPOT');
  });

  test('cont-eks: clúster y nodos activos', async () => {
    const t = mk('cont-eks', CONT_FILES.manifest);
    expect(await out(t, 'aws eks describe-cluster --name tienda --query cluster.status --output text')).toBe('ACTIVE');
    expect(await out(t, 'aws eks describe-nodegroup --cluster-name tienda --nodegroup-name general --query nodegroup.status --output text')).toBe('ACTIVE');
    await t.exec('aws eks update-kubeconfig --name tienda');
    expect((await out(t, 'kubectl get nodes')).split('\n')).toHaveLength(3);
  });

  test('cont-apprunner y cont-apprunner-roto', async () => {
    const t = mk('cont-apprunner');
    expect(await out(t, 'aws apprunner list-services --query "length(ServiceSummaryList)"')).toBe('0');
    const r = mk('cont-apprunner-roto');
    expect(await out(r, 'aws apprunner list-services --query "ServiceSummaryList[0].Status" --output text')).toBe('CREATE_FAILED');
  });

  test('cont-boss: balanceador listo y sin servicio', async () => {
    const t = mk('cont-boss', CONT_FILES.boss);
    expect(await out(t, 'aws ecs list-clusters --query "length(clusterArns)"')).toBe('1');
    expect(await out(t, 'aws elbv2 describe-target-groups --query "TargetGroups[0].TargetType" --output text')).toBe('ip');
  });
});
