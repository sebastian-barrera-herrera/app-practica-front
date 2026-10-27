import { imageId } from '../catalog';
import { mkEnv, type TestEnv } from './helpers';

const ACCT = '123456789012';
const TRUST = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const minutes = (e: TestEnv, n: number) => {
  e.acct.clock += n * 60000;
};

/** Entorno con una instancia ya administrada por Systems Manager (`app-1`, con la etiqueta Patch Group=web). */
async function managed() {
  const e = mkEnv({ scenario: 'net-ssm-rol' });
  const id = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=app-1 --query Reservations[0].Instances[0].InstanceId')) as string;
  await e.run(`ec2 associate-iam-instance-profile --instance-id ${id} --iam-instance-profile Name=ssm-ec2`);
  await e.run(`ec2 create-tags --resources ${id} --tags 'Key=Patch Group,Value=web'`);
  minutes(e, 4);
  return { e, id };
}
const withKeys = async (e: TestEnv, user: string, policy: unknown, run: () => Promise<void>) => {
  await e.run(`iam create-user --user-name ${user}`);
  e.write('pol.json', JSON.stringify(policy));
  await e.run(`iam put-user-policy --user-name ${user} --policy-name p --policy-document file://pol.json`);
  const k = await e.json(`iam create-access-key --user-name ${user}`);
  const saved = { ...e.env };
  e.env.AWS_ACCESS_KEY_ID = k.AccessKey.AccessKeyId;
  e.env.AWS_SECRET_ACCESS_KEY = k.AccessKey.SecretAccessKey;
  try {
    await run();
  } finally {
    delete e.env.AWS_ACCESS_KEY_ID;
    delete e.env.AWS_SECRET_ACCESS_KEY;
    Object.assign(e.env, saved);
  }
};

describe('Parameter Store', () => {
  test('parámetros, versiones, etiquetas y jerarquías', async () => {
    const e = mkEnv();
    expect(await e.json('ssm put-parameter --name /app/prod/db/host --value db.interno --type String')).toEqual({ Version: 1, Tier: 'Standard' });
    expect((await e.run('ssm put-parameter --name /app/prod/db/host --value otro --type String')).stderr).toContain('ParameterAlreadyExists');
    expect((await e.json('ssm put-parameter --name /app/prod/db/host --value db2.interno --type String --overwrite')).Version).toBe(2);
    await e.run('ssm put-parameter --name /app/prod/db/port --value 5432 --type String');
    await e.run('ssm put-parameter --name /app/prod/flags --value a,b,c --type StringList');
    await e.run('ssm put-parameter --name /app/dev/db/host --value localhost --type String');
    const p = (await e.json('ssm get-parameter --name /app/prod/db/host')).Parameter;
    expect(p).toMatchObject({ Name: '/app/prod/db/host', Type: 'String', Value: 'db2.interno', Version: 2, ARN: `arn:aws:ssm:us-east-1:${ACCT}:parameter/app/prod/db/host` });
    expect((await e.json('ssm get-parameter --name /app/prod/db/host:1')).Parameter.Value).toBe('db.interno');
    expect((await e.run('ssm get-parameter --name /app/prod/db/host:9')).stderr).toContain('ParameterVersionNotFound');
    expect((await e.run('ssm get-parameter --name /no/existe')).stderr).toContain('ParameterNotFound');
    // etiquetas
    await e.run('ssm label-parameter-version --name /app/prod/db/host --parameter-version 1 --labels estable');
    expect((await e.json('ssm get-parameter --name /app/prod/db/host:estable')).Parameter.Value).toBe('db.interno');
    expect((await e.json('ssm label-parameter-version --name /app/prod/db/host --labels 1mala')).InvalidLabels).toEqual(['1mala']);
    // por ruta
    const level = (await e.json('ssm get-parameters-by-path --path /app/prod')).Parameters.map((x: { Name: string }) => x.Name);
    expect(level).toEqual(['/app/prod/flags']);
    const rec = (await e.json('ssm get-parameters-by-path --path /app/prod --recursive')).Parameters.map((x: { Name: string }) => x.Name);
    expect(rec).toEqual(['/app/prod/db/host', '/app/prod/db/port', '/app/prod/flags']);
    const many = await e.json('ssm get-parameters --names /app/prod/db/port /app/prod/nada');
    expect(many.Parameters).toHaveLength(1);
    expect(many.InvalidParameters).toEqual(['/app/prod/nada']);
    const hist = (await e.json('ssm get-parameter-history --name /app/prod/db/host')).Parameters;
    expect(hist.map((h: { Version: number }) => h.Version)).toEqual([1, 2]);
    expect(hist[0].Labels).toEqual(['estable']);
    const d = (await e.json('ssm describe-parameters --parameter-filters Key=Name,Option=BeginsWith,Values=/app/dev')).Parameters;
    expect(d.map((x: { Name: string }) => x.Name)).toEqual(['/app/dev/db/host']);
    expect(d[0].Value).toBeUndefined();
    await e.run('ssm delete-parameter --name /app/dev/db/host');
    expect((await e.json('ssm delete-parameters --names /app/prod/flags /app/prod/nada'))).toEqual({ DeletedParameters: ['/app/prod/flags'], InvalidParameters: ['/app/prod/nada'] });
  });

  test('validaciones de nombre, tipo y patrón', async () => {
    const e = mkEnv();
    expect((await e.run('ssm put-parameter --name /aws/mio --value x --type String')).stderr).toContain("can't be prefixed");
    expect((await e.run('ssm put-parameter --name app/host --value x --type String')).stderr).toContain('hierarchy must start with a slash');
    expect((await e.run('ssm put-parameter --name /app/host --value x --type Cadena')).stderr).toContain('enum value set');
    expect((await e.run('ssm put-parameter --name /app/host --value x --type String --key-id alias/mia')).stderr).toContain('SecureString');
    await e.run('ssm put-parameter --name /app/env --value prod --type String --allowed-pattern "^(dev|prod)$"');
    expect((await e.run('ssm put-parameter --name /app/env --value test --type String --allowed-pattern "^(dev|prod)$" --overwrite')).stderr).toContain('ParameterPatternMismatchException');
    expect((await e.run('ssm put-parameter --name /app/env --value x --type SecureString --overwrite')).stderr).toContain('HierarchyTypeMismatchException');
    const big = 'x'.repeat(5000);
    expect((await e.run(`ssm put-parameter --name /app/grande --value ${big} --type String`)).stderr).toContain('maximum value size');
    expect((await e.json(`ssm put-parameter --name /app/grande --value ${big} --type String --tier Advanced`)).Tier).toBe('Advanced');
  });

  test('SecureString: sin descifrar solo se ve el texto cifrado', async () => {
    const e = mkEnv();
    await e.run('ssm put-parameter --name /app/prod/db/password --value Secreta#123 --type SecureString');
    const raw = (await e.json('ssm get-parameter --name /app/prod/db/password')).Parameter;
    expect(raw.Type).toBe('SecureString');
    expect(raw.Value).toMatch(/^AQICAH/);
    expect(raw.Value).not.toContain('Secreta');
    expect((await e.json('ssm get-parameter --name /app/prod/db/password --with-decryption')).Parameter.Value).toBe('Secreta#123');
    expect((await e.json('ssm describe-parameters --parameter-filters Key=Type,Values=SecureString')).Parameters[0].KeyId).toBe('alias/aws/ssm');
  });

  test('IAM por ruta: un usuario solo lee lo que cuelga de su carpeta', async () => {
    const e = mkEnv();
    await e.run('ssm put-parameter --name /app/prod/db/host --value h --type String');
    await e.run('ssm put-parameter --name /app/dev/db/host --value d --type String');
    await withKeys(e, 'lector', { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['ssm:GetParameter', 'ssm:GetParametersByPath'], Resource: `arn:aws:ssm:us-east-1:${ACCT}:parameter/app/dev/*` }] }, async () => {
      expect((await e.json('ssm get-parameter --name /app/dev/db/host')).Parameter.Value).toBe('d');
      expect((await e.run('ssm get-parameter --name /app/prod/db/host')).stderr).toContain('AccessDeniedException');
      expect((await e.run('ssm get-parameters-by-path --path /app/prod --recursive')).stderr).toContain('AccessDeniedException');
    });
  });

  test('etiquetas en parámetros', async () => {
    const e = mkEnv();
    await e.run('ssm put-parameter --name /app/x --value 1 --type String --tags Key=equipo,Value=pagos');
    expect((await e.json('ssm list-tags-for-resource --resource-type Parameter --resource-id /app/x')).TagList).toEqual([{ Key: 'equipo', Value: 'pagos' }]);
    await e.run('ssm add-tags-to-resource --resource-type Parameter --resource-id /app/x --tags Key=entorno,Value=prod');
    await e.run('ssm remove-tags-from-resource --resource-type Parameter --resource-id /app/x --tag-keys equipo');
    expect((await e.json('ssm list-tags-for-resource --resource-type Parameter --resource-id /app/x')).TagList).toEqual([{ Key: 'entorno', Value: 'prod' }]);
    expect((await e.run('ssm add-tags-to-resource --resource-type Parameter --resource-id /nada --tags Key=a,Value=b')).stderr).toContain('InvalidResourceId');
  });

  test('el parámetro público de AMI sigue funcionando', async () => {
    const e = mkEnv();
    const v = (await e.json('ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64')).Parameter;
    expect(v.Value).toBe(imageId('us-east-1', 'al2023-x86'));
  });
});

describe('Documentos y Run Command', () => {
  test('un documento propio con parámetros se ejecuta en la instancia', async () => {
    const { e, id } = await managed();
    const doc = { schemaVersion: '2.2', description: 'Saluda', parameters: { nombre: { type: 'String', default: 'mundo' } }, mainSteps: [{ action: 'aws:runShellScript', name: 'saluda', inputs: { runCommand: ['echo Hola {{ nombre }}'] } }] };
    e.write('doc.json', JSON.stringify(doc));
    expect((await e.json('ssm create-document --name Saluda --document-type Command --content file://doc.json')).DocumentDescription.Name).toBe('Saluda');
    expect((await e.run('ssm create-document --name Saluda --document-type Command --content file://doc.json')).stderr).toContain('DocumentAlreadyExists');
    expect((await e.run('ssm create-document --name AWS-Mio --document-type Command --content file://doc.json')).stderr).toContain('can\'t start with');
    e.write('mal.json', '{"schemaVersion":"9.9","mainSteps":[]}');
    expect((await e.run('ssm create-document --name Mala --document-type Command --content file://mal.json')).stderr).toContain('InvalidDocumentSchemaVersion');
    const cmd = (await e.json(`ssm send-command --document-name Saluda --instance-ids ${id} --parameters nombre=Ana`)).Command.CommandId;
    expect((await e.json(`ssm get-command-invocation --command-id ${cmd} --instance-id ${id}`)).StandardOutputContent.trim()).toBe('Hola Ana');
    const cmd2 = (await e.json(`ssm send-command --document-name Saluda --instance-ids ${id}`)).Command.CommandId;
    expect((await e.json(`ssm get-command-invocation --command-id ${cmd2} --instance-id ${id}`)).StandardOutputContent.trim()).toBe('Hola mundo');
    expect((await e.json('ssm list-documents --filters Key=Owner,Values=Self')).DocumentIdentifiers.map((d: { Name: string }) => d.Name)).toEqual(['Saluda']);
    expect((await e.json('ssm get-document --name Saluda')).Content).toContain('Saluda'.length ? 'runShellScript' : '');
    expect((await e.json('ssm describe-document --name AWS-RunPatchBaseline')).Document.Parameters.map((p: { Name: string }) => p.Name)).toContain('Operation');
    await e.run('ssm delete-document --name Saluda');
    expect((await e.run(`ssm send-command --document-name Saluda --instance-ids ${id}`)).stderr).toContain('InvalidDocument');
  });
});

describe('Automation', () => {
  const stopper = (role = '') =>
    JSON.stringify({
      schemaVersion: '0.3',
      description: 'Para una instancia y comprueba que se ha parado',
      assumeRole: role || undefined,
      parameters: { InstanceId: { type: 'String' } },
      mainSteps: [
        { name: 'describe', action: 'aws:executeAwsApi', inputs: { Service: 'ec2', Api: 'DescribeInstances', InstanceIds: ['{{ InstanceId }}'] }, outputs: [{ Name: 'estado', Selector: '$.Reservations[0].Instances[0].State.Name', Type: 'String' }] },
        { name: 'stop', action: 'aws:changeInstanceState', inputs: { InstanceIds: ['{{ InstanceId }}'], DesiredState: 'stopped' } },
        { name: 'verifica', action: 'aws:assertAwsResourceProperty', inputs: { Service: 'ec2', Api: 'DescribeInstances', InstanceIds: ['{{ InstanceId }}'], PropertySelector: '$.Reservations[0].Instances[0].State.Name', DesiredValues: ['stopping', 'stopped'] } },
      ],
    });

  test('un runbook propio encadena pasos y devuelve las salidas', async () => {
    const { e, id } = await managed();
    e.write('rb.json', stopper());
    await e.run('ssm create-document --name ParaInstancia --document-type Automation --content file://rb.json');
    const exId = (await e.json(`ssm start-automation-execution --document-name ParaInstancia --parameters InstanceId=${id}`)).AutomationExecutionId;
    const first = (await e.json(`ssm get-automation-execution --automation-execution-id ${exId}`)).AutomationExecution;
    expect(['InProgress', 'Pending']).toContain(first.AutomationExecutionStatus);
    minutes(e, 2);
    const done = (await e.json(`ssm get-automation-execution --automation-execution-id ${exId}`)).AutomationExecution;
    expect(done.AutomationExecutionStatus).toBe('Success');
    expect(done.StepExecutions.map((s: { StepName: string; StepStatus: string }) => [s.StepName, s.StepStatus])).toEqual([['describe', 'Success'], ['stop', 'Success'], ['verifica', 'Success']]);
    expect(done.StepExecutions[0].Outputs.estado).toEqual(['running']);
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query Reservations[0].Instances[0].State.Name`)).toMatch(/stop/);
    expect((await e.run('ssm start-automation-execution --document-name ParaInstancia')).stderr).toContain('InstanceId is required');
    expect((await e.run(`ssm start-automation-execution --document-name ParaInstancia --parameters InstanceId=${id},Otro=1`)).stderr).toContain('not defined in the document');
    expect((await e.run('ssm start-automation-execution --document-name NoExiste')).stderr).toContain('could not be found');
    const list = (await e.json('ssm describe-automation-executions --filters Key=DocumentNamePrefix,Values=Para')).AutomationExecutionMetadataList;
    expect(list).toHaveLength(1);
  });

  test('un paso que falla corta la ejecución y las siguientes quedan canceladas', async () => {
    const { e, id } = await managed();
    e.write('rb.json', JSON.stringify({ schemaVersion: '0.3', parameters: {}, mainSteps: [{ name: 'a', action: 'aws:executeAwsApi', inputs: { Service: 'ec2', Api: 'DescribeInstances', InstanceIds: ['i-00000000000000000'] } }, { name: 'b', action: 'aws:sleep', inputs: { Duration: 'PT10S' } }] }));
    await e.run('ssm create-document --name Roto --document-type Automation --content file://rb.json');
    const exId = (await e.json('ssm start-automation-execution --document-name Roto')).AutomationExecutionId;
    minutes(e, 1);
    const x = (await e.json(`ssm get-automation-execution --automation-execution-id ${exId}`)).AutomationExecution;
    expect(x.AutomationExecutionStatus).toBe('Failed');
    expect(x.StepExecutions.map((s: { StepStatus: string }) => s.StepStatus)).toEqual(['Failed', 'Cancelled']);
    expect(x.FailureMessage).toContain('InvalidInstanceID');
    void id;
  });

  test('los documentos públicos y el rol de automatización', async () => {
    const { e, id } = await managed();
    // sin rol: se usan los permisos de quien lanza (administrador)
    const ok = (await e.json(`ssm start-automation-execution --document-name AWS-StopEC2Instance --parameters InstanceId=${id}`)).AutomationExecutionId;
    minutes(e, 1);
    expect((await e.json(`ssm get-automation-execution --automation-execution-id ${ok}`)).AutomationExecution.AutomationExecutionStatus).toBe('Success');
    // con un rol que no confía en ssm.amazonaws.com
    e.write('t.json', TRUST('ec2.amazonaws.com'));
    const bad = (await e.json('iam create-role --role-name rol-malo --assume-role-policy-document file://t.json')).Role.Arn;
    const exBad = (await e.json(`ssm start-automation-execution --document-name AWS-StartEC2Instance --parameters InstanceId=${id},AutomationAssumeRole=${bad}`)).AutomationExecutionId;
    minutes(e, 1);
    const xb = (await e.json(`ssm get-automation-execution --automation-execution-id ${exBad}`)).AutomationExecution;
    expect(xb.AutomationExecutionStatus).toBe('Failed');
    expect(xb.FailureMessage).toContain('trust ssm.amazonaws.com');
    // con un rol correcto pero sin permisos sobre EC2
    e.write('t.json', TRUST('ssm.amazonaws.com'));
    const role = (await e.json('iam create-role --role-name rol-auto --assume-role-policy-document file://t.json')).Role.Arn;
    const exNo = (await e.json(`ssm start-automation-execution --document-name AWS-StartEC2Instance --parameters InstanceId=${id},AutomationAssumeRole=${role}`)).AutomationExecutionId;
    minutes(e, 1);
    const xn = (await e.json(`ssm get-automation-execution --automation-execution-id ${exNo}`)).AutomationExecution;
    expect(xn.AutomationExecutionStatus).toBe('Failed');
    expect(xn.FailureMessage).toMatch(/UnauthorizedOperation|not authorized/);
    // le damos permisos y funciona
    await e.run(`iam attach-role-policy --role-name rol-auto --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess`);
    const exYes = (await e.json(`ssm start-automation-execution --document-name AWS-StartEC2Instance --parameters InstanceId=${id},AutomationAssumeRole=${role}`)).AutomationExecutionId;
    minutes(e, 1);
    expect((await e.json(`ssm get-automation-execution --automation-execution-id ${exYes}`)).AutomationExecution.AutomationExecutionStatus).toBe('Success');
    expect((await e.json('ssm list-documents --filters Key=Owner,Values=Amazon')).DocumentIdentifiers.map((d: { Name: string }) => d.Name)).toContain('AWS-StopEC2Instance');
  });

  test('aws:executeScript ejecuta Python y aws:invokeLambdaFunction llama a una función', async () => {
    const { e } = await managed();
    e.write('rb.json', JSON.stringify({ schemaVersion: '0.3', parameters: { N: { type: 'Integer', default: 3 } }, mainSteps: [{ name: 'doble', action: 'aws:executeScript', inputs: { Runtime: 'python3.12', Handler: 'script_handler', Script: 'def script_handler(events, context):\n    return {"doble": events["n"] * 2}', InputPayload: { n: '{{ N }}' } }, outputs: [{ Name: 'valor', Selector: '$.Payload.doble', Type: 'Integer' }] }] }));
    await e.run('ssm create-document --name Doble --document-type Automation --content file://rb.json');
    const x = (await e.json('ssm start-automation-execution --document-name Doble --parameters N=21')).AutomationExecutionId;
    minutes(e, 1);
    const r = (await e.json(`ssm get-automation-execution --automation-execution-id ${x}`)).AutomationExecution;
    expect(r.AutomationExecutionStatus).toBe('Success');
    expect(r.StepExecutions[0].Outputs.valor).toEqual(['42']);
    e.write('rb2.json', JSON.stringify({ schemaVersion: '0.3', parameters: {}, mainSteps: [{ name: 'mal', action: 'aws:executeScript', inputs: { Runtime: 'python3.12', Handler: 'script_handler', Script: 'def script_handler(events, context):\n    raise ValueError("boom")', InputPayload: {} } }] }));
    await e.run('ssm create-document --name Falla --document-type Automation --content file://rb2.json');
    const y = (await e.json('ssm start-automation-execution --document-name Falla')).AutomationExecutionId;
    minutes(e, 1);
    expect((await e.json(`ssm get-automation-execution --automation-execution-id ${y}`)).AutomationExecution.FailureMessage).toContain('ValueError: boom');
  });
});

describe('Patch Manager', () => {
  test('líneas base: la trampa del sistema operativo y el grupo de parches', async () => {
    const { e, id } = await managed();
    const def = (await e.json('ssm get-default-patch-baseline --operating-system AMAZON_LINUX_2023')).BaselineId;
    expect(def).toBe('pb-0e3a4d5c6b7a89012');
    const rules = JSON.stringify({ PatchRules: [{ PatchFilterGroup: { PatchFilters: [{ Key: 'CLASSIFICATION', Values: ['Security'] }, { Key: 'SEVERITY', Values: ['Critical', 'Important'] }] }, ApproveAfterDays: 0, ComplianceLevel: 'CRITICAL' }] });
    // sin --operating-system el valor por defecto es WINDOWS
    const win = (await e.json(`ssm create-patch-baseline --name solo-seguridad --approval-rules '${rules}'`)).BaselineId;
    expect((await e.json(`ssm get-patch-baseline --baseline-id ${win}`)).OperatingSystem).toBe('WINDOWS');
    expect((await e.run(`ssm create-patch-baseline --name solo-seguridad --operating-system AMAZON_LINUX_2023 --approval-rules '${rules}'`)).stderr).toContain('AlreadyExistsException');
    const lin = (await e.json(`ssm create-patch-baseline --name seguridad-linux --operating-system AMAZON_LINUX_2023 --approval-rules '${rules}'`)).BaselineId;
    await e.run(`ssm register-patch-baseline-for-patch-group --baseline-id ${win} --patch-group web`);
    // la instancia es Linux: la línea base de Windows no le afecta
    expect((await e.json(`ssm get-patch-baseline-for-patch-group --patch-group web --operating-system AMAZON_LINUX_2023`)).BaselineId).toBe(def);
    expect((await e.run(`ssm delete-patch-baseline --baseline-id ${win}`)).stderr).toContain('registered with the patch groups');
    await e.run(`ssm register-patch-baseline-for-patch-group --baseline-id ${lin} --patch-group web`);
    expect((await e.json(`ssm get-patch-baseline-for-patch-group --patch-group web --operating-system AMAZON_LINUX_2023`)).BaselineId).toBe(lin);
    expect((await e.run(`ssm register-patch-baseline-for-patch-group --baseline-id ${def} --patch-group web`)).stderr).toContain('AlreadyExistsException');
    expect((await e.json('ssm describe-patch-groups')).Mappings.map((m: { PatchGroup: string }) => m.PatchGroup).sort()).toEqual(['web', 'web']);
    expect((await e.run(`ssm delete-patch-baseline --baseline-id ${def}`)).stderr).toContain('default patch baseline');
    const eff = (await e.json(`ssm describe-effective-patches-for-patch-baseline --baseline-id ${lin}`)).EffectivePatches.map((p: { Patch: { Id: string } }) => p.Patch.Id);
    expect(eff).toEqual(['ALAS2023-2026-0151', 'ALAS2023-2026-0160', 'ALAS2023-2026-0195', 'ALAS2023-2026-0210']);
    void id;
  });

  test('Scan descubre lo que falta; Install lo aplica según la línea base', async () => {
    const { e, id } = await managed();
    const run = async (op: string, extra = '') => {
      const c = (await e.json(`ssm send-command --document-name AWS-RunPatchBaseline --instance-ids ${id} --parameters Operation=${op}${extra}`)).Command.CommandId;
      return (await e.json(`ssm get-command-invocation --command-id ${c} --instance-id ${id}`)) as { StandardOutputContent: string; Status: string };
    };
    expect((await e.run(`ssm send-command --document-name AWS-RunPatchBaseline --instance-ids ${id} --parameters Operation=Otra`)).code).toBe(0);
    const scan = await run('Scan');
    expect(scan.Status).toBe('Success');
    expect(scan.StandardOutputContent).toContain('Missing ALAS2023-2026-0160');
    const st = (await e.json(`ssm describe-instance-patch-states --instance-ids ${id}`)).InstancePatchStates[0];
    expect(st).toMatchObject({ InstanceId: id, PatchGroup: 'web', Operation: 'Scan', InstalledCount: 0 });
    expect(st.MissingCount).toBeGreaterThan(0);
    const missing = st.MissingCount;
    const inst = await run('Install');
    expect(inst.StandardOutputContent).toContain('Installed ALAS2023-2026-0160');
    const after = (await e.json(`ssm describe-instance-patch-states --instance-ids ${id}`)).InstancePatchStates[0];
    expect(after).toMatchObject({ Operation: 'Install', MissingCount: 0, InstalledCount: missing });
    const patches = (await e.json(`ssm describe-instance-patches --instance-id ${id} --filters Key=State,Values=Installed`)).Patches;
    expect(patches.length).toBe(missing);
    expect(patches[0]).toMatchObject({ State: 'Installed' });
    expect((await e.json(`ssm describe-instance-patch-states-for-patch-group --patch-group web`)).InstancePatchStates).toHaveLength(1);
  });

  test('ApproveAfterDays y parches rechazados', async () => {
    const { e, id } = await managed();
    const rules = (days: number) => JSON.stringify({ PatchRules: [{ PatchFilterGroup: { PatchFilters: [{ Key: 'CLASSIFICATION', Values: ['Security'] }] }, ApproveAfterDays: days }] });
    const b = (await e.json(`ssm create-patch-baseline --name espera --operating-system AMAZON_LINUX_2023 --approval-rules '${rules(10)}' --rejected-patches ALAS2023-2026-0160`)).BaselineId;
    await e.run(`ssm register-patch-baseline-for-patch-group --baseline-id ${b} --patch-group web`);
    const eff = (await e.json(`ssm describe-effective-patches-for-patch-baseline --baseline-id ${b}`)).EffectivePatches.map((p: { Patch: { Id: string } }) => p.Patch.Id);
    // los publicados hace menos de 10 días (0195: 12, 0210: 4) → solo los de hace 12+ días; el 0160 está rechazado
    expect(eff).toEqual(['ALAS2023-2026-0151', 'ALAS2023-2026-0172', 'ALAS2023-2026-0195']);
    await e.run(`ssm update-patch-baseline --baseline-id ${b} --approval-rules '${rules(0)}'`);
    const eff0 = (await e.json(`ssm describe-effective-patches-for-patch-baseline --baseline-id ${b}`)).EffectivePatches.map((p: { Patch: { Id: string } }) => p.Patch.Id);
    expect(eff0).toContain('ALAS2023-2026-0210');
    expect(eff0).not.toContain('ALAS2023-2026-0160');
    void id;
  });
});

describe('Ventanas de mantenimiento y asociaciones', () => {
  async function window(e: TestEnv, schedule = 'rate(30 minutes)') {
    const w = (await e.json(`ssm create-maintenance-window --name parches --schedule "${schedule}" --duration 2 --cutoff 1 --no-allow-unassociated-targets`)).WindowId as string;
    const t = (await e.json(`ssm register-target-with-maintenance-window --window-id ${w} --resource-type INSTANCE --targets "Key=tag:Patch Group,Values=web"`)).WindowTargetId as string;
    await e.run(`ssm register-task-with-maintenance-window --window-id ${w} --targets Key=WindowTargetIds,Values=${t} --task-arn AWS-RunPatchBaseline --task-type RUN_COMMAND --priority 1 --max-concurrency 50% --max-errors 0 --task-invocation-parameters 'RunCommand={Parameters={Operation=[Install]}}'`);
    return { w, t };
  }

  test('la ventana se ejecuta sola según su horario y aplica los parches', async () => {
    const { e, id } = await managed();
    const { w } = await window(e);
    expect((await e.json(`ssm get-maintenance-window --window-id ${w}`))).toMatchObject({ Name: 'parches', Duration: 2, Cutoff: 1, Enabled: true });
    expect((await e.json(`ssm describe-maintenance-window-tasks --window-id ${w}`)).Tasks[0]).toMatchObject({ TaskArn: 'AWS-RunPatchBaseline', Type: 'RUN_COMMAND' });
    expect((await e.json(`ssm describe-maintenance-window-executions --window-id ${w}`)).WindowExecutions).toEqual([]);
    minutes(e, 65);
    const ex = (await e.json(`ssm describe-maintenance-window-executions --window-id ${w}`)).WindowExecutions;
    expect(ex.length).toBeGreaterThanOrEqual(2);
    expect(ex[0].Status).toBe('SUCCESS');
    const tasks = (await e.json(`ssm describe-maintenance-window-execution-tasks --window-execution-id ${ex[0].WindowExecutionId}`)).WindowExecutionTaskIdentities;
    expect(tasks[0]).toMatchObject({ TaskArn: 'AWS-RunPatchBaseline', Status: 'SUCCESS' });
    expect((await e.json(`ssm describe-instance-patch-states --instance-ids ${id}`)).InstancePatchStates[0]).toMatchObject({ Operation: 'Install', MissingCount: 0 });
    // desactivada, no se ejecuta más
    await e.run(`ssm update-maintenance-window --window-id ${w} --no-enabled`);
    const n = ex.length;
    minutes(e, 120);
    expect((await e.json(`ssm describe-maintenance-window-executions --window-id ${w}`)).WindowExecutions).toHaveLength(n);
    await e.run(`ssm delete-maintenance-window --window-id ${w}`);
    expect((await e.run(`ssm get-maintenance-window --window-id ${w}`)).stderr).toContain('DoesNotExistException');
  });

  test('si la instancia no está administrada, la tarea falla', async () => {
    const e = mkEnv({ scenario: 'net-ssm-rol' });
    const id = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=app-1 --query Reservations[0].Instances[0].InstanceId')) as string;
    await e.run(`ec2 create-tags --resources ${id} --tags 'Key=Patch Group,Value=web'`);
    const { w } = await window(e);
    minutes(e, 35);
    const ex = (await e.json(`ssm describe-maintenance-window-executions --window-id ${w}`)).WindowExecutions;
    expect(ex[0].Status).toBe('FAILED');
  });

  test('validaciones de ventanas', async () => {
    const { e } = await managed();
    expect((await e.run('ssm create-maintenance-window --name x --schedule "cada dia" --duration 2 --cutoff 1 --no-allow-unassociated-targets')).stderr).toContain('Schedule expression');
    expect((await e.run('ssm create-maintenance-window --name x --schedule "rate(1 day)" --duration 2 --cutoff 2 --no-allow-unassociated-targets')).stderr).toContain('Cutoff must be at least one hour smaller');
    const w = (await e.json('ssm create-maintenance-window --name x --schedule "cron(0 2 ? * SUN *)" --duration 3 --cutoff 1 --no-allow-unassociated-targets')).WindowId;
    expect((await e.run(`ssm register-task-with-maintenance-window --window-id ${w} --task-arn AWS-RunPatchBaseline --task-type RUN_COMMAND`)).stderr).toContain('does not allow unassociated targets');
    expect((await e.run(`ssm register-task-with-maintenance-window --window-id ${w} --task-arn AWS-StopEC2Instance --task-type RUN_COMMAND --targets Key=WindowTargetIds,Values=00000000-0000-0000-0000-000000000000`)).stderr).toBeTruthy();
  });

  test('State Manager: una asociación aplica un documento ahora y por horario', async () => {
    const { e, id } = await managed();
    const a = (await e.json(`ssm create-association --name AWS-RunShellScript --targets "Key=tag:Patch Group,Values=web" --parameters commands=hostname --schedule-expression "rate(1 hour)" --association-name higiene`)).AssociationDescription;
    expect(a).toMatchObject({ Name: 'AWS-RunShellScript', AssociationName: 'higiene', ScheduleExpression: 'rate(1 hour)' });
    expect(a.Overview.Status).toBe('Pending');
    const d = (await e.json(`ssm describe-association --association-id ${a.AssociationId}`)).AssociationDescription;
    expect(d.Overview.Status).toBe('Success');
    expect(d.LastExecutionDate).toBeTruthy();
    minutes(e, 130);
    const d2 = (await e.json(`ssm describe-association --association-id ${a.AssociationId}`)).AssociationDescription;
    expect(Date.parse(d2.LastExecutionDate)).toBeGreaterThan(Date.parse(d.LastExecutionDate));
    expect((await e.json('ssm list-associations')).Associations).toHaveLength(1);
    await e.run(`ssm start-associations-once --association-ids ${a.AssociationId}`);
    expect((await e.run('ssm create-association --name NoExiste --instance-id i-1')).stderr).toContain('InvalidDocument');
    expect((await e.run(`ssm create-association --name AWS-RunShellScript --parameters commands=hostname`)).stderr).toContain('InvalidTarget');
    await e.run(`ssm delete-association --association-id ${a.AssociationId}`);
    expect((await e.json('ssm list-associations')).Associations).toEqual([]);
    void id;
  });
});

describe('X-Ray', () => {
  const trace = (id: string, name: string, start: number, extra: Record<string, unknown> = {}) => JSON.stringify({ trace_id: id, id: '70de5b6f19ff9a0a', name, start_time: start, end_time: start + 0.5, ...extra });

  test('segmentos propios: validación, trazas, resumen con filtros y grafo', async () => {
    const e = mkEnv();
    const now = e.acct.clock / 1000;
    const t1 = `1-${Math.floor(now).toString(16).padStart(8, '0')}-a0000000000000000000000a`;
    const t2 = `1-${Math.floor(now).toString(16).padStart(8, '0')}-b0000000000000000000000b`;
    const docs = [
      trace(t1, 'api', now, { http: { request: { method: 'GET', url: 'https://tienda.es/pedidos' }, response: { status: 200 } }, annotations: { cliente: 'ana' } }),
      trace(t2, 'api', now + 1, { fault: true, http: { request: { method: 'POST', url: 'https://tienda.es/pago' }, response: { status: 500 } }, annotations: { cliente: 'luis' } }),
    ];
    expect((await e.json(`xray put-trace-segments --trace-segment-documents '${docs[0]}' '${docs[1].replace('70de5b6f19ff9a0a', '80de5b6f19ff9a0b')}'`)).UnprocessedTraceSegments).toEqual([]);
    const bad = await e.json(`xray put-trace-segments --trace-segment-documents '{"name":"x"}' 'no json' '${trace('mal', 'y', now)}'`);
    expect(bad.UnprocessedTraceSegments.map((b: { ErrorCode: string }) => b.ErrorCode)).toEqual(['MissingRequiredFields', 'ParseError', 'InvalidTraceId']);
    const range = `--start-time ${Math.floor(now - 60)} --end-time ${Math.floor(now + 60)}`;
    const all = (await e.json(`xray get-trace-summaries ${range}`)).TraceSummaries;
    expect(all).toHaveLength(2);
    expect(all[0].Id).toBe(t2);
    expect(all[0]).toMatchObject({ HasFault: true });
    expect((await e.json(`xray get-trace-summaries ${range} --filter-expression fault`)).TraceSummaries.map((x: { Id: string }) => x.Id)).toEqual([t2]);
    expect((await e.json(`xray get-trace-summaries ${range} --filter-expression 'annotation.cliente = "ana"'`)).TraceSummaries.map((x: { Id: string }) => x.Id)).toEqual([t1]);
    expect((await e.json(`xray get-trace-summaries ${range} --filter-expression 'http.status = 500 AND service("api")'`)).TraceSummaries).toHaveLength(1);
    expect((await e.json(`xray get-trace-summaries ${range} --filter-expression 'service("otra")'`)).TraceSummaries).toHaveLength(0);
    expect((await e.run(`xray get-trace-summaries ${range} --filter-expression 'colorrojo = 1'`)).stderr).toContain('Invalid filter expression');
    const got = await e.json(`xray batch-get-traces --trace-ids ${t1} 1-00000000-000000000000000000000000`);
    expect(got.Traces).toHaveLength(1);
    expect(got.UnprocessedTraceIds).toEqual(['1-00000000-000000000000000000000000']);
    const g = (await e.json(`xray get-service-graph ${range}`)).Services as { Name: string; SummaryStatistics: { TotalCount: number; FaultStatistics: { TotalCount: number } } }[];
    const api = g.find((s) => s.Name === 'api')!;
    expect(api.SummaryStatistics.TotalCount).toBe(2);
    expect(api.SummaryStatistics.FaultStatistics.TotalCount).toBe(1);
  });

  test('reglas de muestreo', async () => {
    const e = mkEnv();
    expect((await e.json('xray get-sampling-rules')).SamplingRuleRecords.map((r: { SamplingRule: { RuleName: string } }) => r.SamplingRule.RuleName)).toEqual(['Default']);
    const rule = JSON.stringify({ RuleName: 'pagos', ResourceARN: '*', Priority: 5, FixedRate: 1, ReservoirSize: 10, ServiceName: 'pagos-*', ServiceType: '*', Host: '*', HTTPMethod: '*', URLPath: '*', Version: 1 });
    expect((await e.json(`xray create-sampling-rule --sampling-rule '${rule}'`)).SamplingRuleRecord.SamplingRule.FixedRate).toBe(1);
    expect((await e.run(`xray create-sampling-rule --sampling-rule '${rule}'`)).stderr).toContain('already exists');
    expect((await e.run(`xray create-sampling-rule --sampling-rule '${rule.replace('"FixedRate":1', '"FixedRate":7')}'`)).stderr).toContain('FixedRate must be between 0 and 1');
    expect((await e.run('xray delete-sampling-rule --rule-name Default')).stderr).toContain('cannot be deleted');
    await e.run('xray delete-sampling-rule --rule-name pagos');
  });
});

describe('X-Ray con Lambda', () => {
  const ZIP = 'PK\x03\x04@@ZIP@@';
  const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
  async function fn(e: TestEnv, name: string, code: string, policies: string[], tracing = true) {
    e.write(`${name}.zip`, zip({ 'lambda_function.py': code }));
    e.write('t.json', TRUST('lambda.amazonaws.com'));
    const r = (await e.json(`iam create-role --role-name ${name}-rol --assume-role-policy-document file://t.json`)).Role.Arn;
    for (const p of policies) await e.run(`iam attach-role-policy --role-name ${name}-rol --policy-arn arn:aws:iam::aws:policy/${p}`);
    await e.json(`lambda create-function --function-name ${name} --runtime python3.12 --role ${r} --handler lambda_function.lambda_handler --zip-file fileb://${name}.zip ${tracing ? '--tracing-config Mode=Active' : ''}`);
  }
  const invoke = (e: TestEnv, name: string, payload = '{}') => e.run(`lambda invoke --function-name ${name} --payload '${payload}' --cli-binary-format raw-in-base64-out out.json`);
  const summaries = async (e: TestEnv, extra = '') => (await e.json(`xray get-trace-summaries --start-time ${Math.floor(e.acct.clock / 1000) - 600} --end-time ${Math.floor(e.acct.clock / 1000) + 600} ${extra}`)).TraceSummaries as { Id: string; HasFault: boolean; ServiceIds: { Name: string; Type: string }[] }[];

  test('Active tracing exige permisos de X-Ray en el rol', async () => {
    const e = mkEnv();
    await fn(e, 'sin-permiso', 'def lambda_handler(e, c):\n    return 1\n', ['service-role/AWSLambdaBasicExecutionRole']);
    await invoke(e, 'sin-permiso');
    expect(await summaries(e)).toHaveLength(0);
    await fn(e, 'con-permiso', 'def lambda_handler(e, c):\n    return 1\n', ['service-role/AWSLambdaBasicExecutionRole', 'AWSXRayDaemonWriteAccess']);
    expect((await e.json('lambda get-function-configuration --function-name con-permiso --query TracingConfig.Mode'))).toBe('Active');
    await invoke(e, 'con-permiso');
    const s = await summaries(e);
    expect(s).toHaveLength(1);
    expect(s[0].ServiceIds.map((x) => x.Type).sort()).toEqual(['AWS::Lambda', 'AWS::Lambda::Function']);
    // sin Active, nada
    await fn(e, 'pasiva', 'def lambda_handler(e, c):\n    return 1\n', ['AWSXRayDaemonWriteAccess'], false);
    await invoke(e, 'pasiva');
    expect(await summaries(e)).toHaveLength(1);
    expect((await e.run('lambda update-function-configuration --function-name pasiva --tracing-config Mode=Mitad')).stderr).toContain('PassThrough, Active');
    await e.run('lambda update-function-configuration --function-name pasiva --tracing-config Mode=Active');
    expect(await e.json('lambda get-function-configuration --function-name pasiva --query TracingConfig.Mode')).toBe('Active');
  });

  test('con el SDK de X-Ray, las llamadas a otros servicios salen en el grafo', async () => {
    const e = mkEnv();
    const code = `import boto3
from aws_xray_sdk.core import xray_recorder, patch_all
patch_all()
ddb = boto3.client('dynamodb')

@xray_recorder.capture('calcula')
def calcula(n):
    return n * 2

def lambda_handler(event, context):
    xray_recorder.put_annotation('cliente', event.get('cliente', 'anon'))
    calcula(4)
    ddb.list_tables()
    if event.get('romper'):
        raise RuntimeError('fallo a propósito')
    return 'ok'
`;
    await fn(e, 'pedidos', code, ['service-role/AWSLambdaBasicExecutionRole', 'AWSXRayDaemonWriteAccess', 'AmazonDynamoDBReadOnlyAccess']);
    await invoke(e, 'pedidos', '{"cliente":"ana"}');
    e.acct.clock += 2000;
    await invoke(e, 'pedidos', '{"cliente":"luis","romper":true}');
    const all = await summaries(e);
    expect(all).toHaveLength(2);
    expect(all.filter((s) => s.HasFault)).toHaveLength(1);
    expect(all[0].ServiceIds.map((x) => x.Name)).toContain('DynamoDB');
    const ana = await summaries(e, `--filter-expression 'annotation.cliente = "ana"'`);
    expect(ana).toHaveLength(1);
    expect(ana[0].HasFault).toBe(false);
    const tr = (await e.json(`xray batch-get-traces --trace-ids ${ana[0].Id}`)).Traces[0];
    const docs = tr.Segments.map((s: { Document: string }) => JSON.parse(s.Document));
    const fnDoc = docs.find((d: { origin: string }) => d.origin === 'AWS::Lambda::Function');
    expect(fnDoc.annotations).toEqual({ cliente: 'ana' });
    const inv = fnDoc.subsegments.find((s: { name: string }) => s.name === 'Invocation');
    expect(inv.subsegments.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['calcula', 'DynamoDB']));
    const graph = (await e.json(`xray get-service-graph --start-time ${Math.floor(e.acct.clock / 1000) - 600} --end-time ${Math.floor(e.acct.clock / 1000) + 600}`)).Services as { Name: string; Type: string; Edges: { ReferenceId: number }[]; SummaryStatistics: { TotalCount: number }; ReferenceId: number }[];
    const names = graph.map((s) => `${s.Name}:${s.Type}`);
    expect(names).toEqual(expect.arrayContaining(['client:client', 'pedidos:AWS::Lambda', 'pedidos:AWS::Lambda::Function', 'DynamoDB:AWS::DynamoDB']));
    const ddb = graph.find((s) => s.Name === 'DynamoDB')!;
    expect(ddb.SummaryStatistics.TotalCount).toBe(2);
    const fnNode = graph.find((s) => s.Type === 'AWS::Lambda::Function')!;
    expect(fnNode.Edges.some((x) => x.ReferenceId === ddb.ReferenceId)).toBe(true);
  });

  test('el muestreo: una por segundo y el resto según la regla', async () => {
    const e = mkEnv();
    await fn(e, 'ruidosa', 'def lambda_handler(e, c):\n    return 1\n', ['service-role/AWSLambdaBasicExecutionRole', 'AWSXRayDaemonWriteAccess']);
    // ráfaga: todas las invocaciones caen en el mismo segundo
    const t = e.acct.clock;
    for (let i = 0; i < 40; i++) {
      e.acct.clock = t;
      await invoke(e, 'ruidosa');
    }
    e.acct.clock = t + 5000;
    const n = (await summaries(e)).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(15);
    const rule = JSON.stringify({ RuleName: 'todas', ResourceARN: '*', Priority: 1, FixedRate: 1, ReservoirSize: 0, ServiceName: 'ruidosa', ServiceType: '*', Host: '*', HTTPMethod: '*', URLPath: '*', Version: 1 });
    await e.run(`xray create-sampling-rule --sampling-rule '${rule}'`);
    for (let i = 0; i < 10; i++) {
      e.acct.clock = t;
      await invoke(e, 'ruidosa');
    }
    e.acct.clock = t + 5000;
    expect((await summaries(e)).length).toBe(n + 10);
  });
});

describe('Config: remediación con Systems Manager', () => {
  const bucketPolicy = (b: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: `arn:aws:s3:::${b}` }, { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::${b}/AWSLogs/${ACCT}/Config/*` }] });
  async function setup() {
    const e = mkEnv();
    await e.run('s3 mb s3://cfg-logs');
    e.write('p.json', bucketPolicy('cfg-logs'));
    await e.run('s3api put-bucket-policy --bucket cfg-logs --policy file://p.json');
    e.write('t.json', TRUST('config.amazonaws.com'));
    const role = (await e.json('iam create-role --role-name cfg-role --assume-role-policy-document file://t.json')).Role.Arn;
    await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=${role} --recording-group allSupported=true`);
    await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=cfg-logs');
    await e.run('configservice start-configuration-recorder --configuration-recorder-name default');
    const vpc = await e.json('ec2 describe-vpcs --query Vpcs[0].VpcId');
    const sg = (await e.json(`ec2 create-security-group --group-name web --description web --vpc-id ${vpc}`)).GroupId as string;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    e.write('t.json', TRUST('ssm.amazonaws.com'));
    const auto = (await e.json('iam create-role --role-name auto-rol --assume-role-policy-document file://t.json')).Role.Arn as string;
    await e.run(`configservice put-config-rule --config-rule '{"ConfigRuleName":"sin-ssh","Source":{"Owner":"AWS","SourceIdentifier":"INCOMING_SSH_DISABLED"}}'`);
    return { e, sg, auto };
  }
  const remediation = (role: string, automatic = true) => JSON.stringify([{ ConfigRuleName: 'sin-ssh', TargetType: 'SSM_DOCUMENT', TargetId: 'AWS-DisablePublicAccessForSecurityGroup', Parameters: { GroupId: { ResourceValue: { Value: 'RESOURCE_ID' } }, AutomationAssumeRole: { StaticValue: { Values: [role] } } }, Automatic: automatic, MaximumAutomaticAttempts: 3, RetryAttemptSeconds: 60 }]);

  test('la remediación automática cierra el puerto 22 abierto al mundo', async () => {
    const { e, sg, auto } = await setup();
    await e.run('sts get-caller-identity');
    expect(await e.json('configservice describe-compliance-by-config-rule --config-rule-names sin-ssh --query ComplianceByConfigRules[0].Compliance.ComplianceType')).toBe('NON_COMPLIANT');
    // la remediación necesita un rol con permisos sobre EC2
    await e.run(`iam attach-role-policy --role-name auto-rol --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess`);
    expect((await e.json(`configservice put-remediation-configurations --remediation-configurations '${remediation(auto)}'`)).FailedBatches).toEqual([]);
    minutes(e, 1);
    // automática: lo que ya incumplía se corrige en cuanto se activa la remediación
    expect(await e.json(`ec2 describe-security-groups --group-ids ${sg} --query SecurityGroups[0].IpPermissions`)).toEqual([]);
    expect(await e.json('configservice describe-compliance-by-config-rule --config-rule-names sin-ssh --query ComplianceByConfigRules[0].Compliance.ComplianceType')).toBe('COMPLIANT');
    const ex = (await e.json('configservice describe-remediation-execution-status --config-rule-name sin-ssh')).RemediationExecutionStatuses;
    expect(ex[0]).toMatchObject({ State: 'SUCCEEDED', ResourceKey: { resourceId: sg } });
    expect((await e.json('ssm describe-automation-executions')).AutomationExecutionMetadataList[0].DocumentName).toBe('AWS-DisablePublicAccessForSecurityGroup');
    // si alguien vuelve a abrir el puerto, vuelve a cerrarse
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    minutes(e, 2);
    await e.run('sts get-caller-identity');
    expect(await e.json(`ec2 describe-security-groups --group-ids ${sg} --query "length(SecurityGroups[0].IpPermissions)"`)).toBe(0);
  });

  test('automática: cada recurso que incumple se corrige solo; sin permisos la remediación falla', async () => {
    const { e, sg, auto } = await setup();
    await e.run(`configservice put-remediation-configurations --remediation-configurations '${remediation(auto)}'`);
    // el rol no tiene permisos: la automatización falla y el recurso sigue incumpliendo
    await e.run('configservice start-config-rules-evaluation --config-rule-names sin-ssh');
    minutes(e, 1);
    expect(await e.json(`ec2 describe-security-groups --group-ids ${sg} --query "length(SecurityGroups[0].IpPermissions)"`)).toBe(1);
    const failed = (await e.json('ssm describe-automation-executions')).AutomationExecutionMetadataList;
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].AutomationExecutionStatus).toBe('Failed');
    // sin AutomationAssumeRole tampoco
    await e.run('configservice delete-remediation-configuration --config-rule-name sin-ssh');
    const noRole = JSON.stringify([{ ConfigRuleName: 'sin-ssh', TargetType: 'SSM_DOCUMENT', TargetId: 'AWS-DisablePublicAccessForSecurityGroup', Parameters: { GroupId: { ResourceValue: { Value: 'RESOURCE_ID' } } }, Automatic: false }]);
    await e.run(`configservice put-remediation-configurations --remediation-configurations '${noRole}'`);
    await e.run(`configservice start-remediation-execution --config-rule-name sin-ssh --resource-keys resourceType=AWS::EC2::SecurityGroup,resourceId=${sg}`);
    const ex = (await e.json('configservice describe-remediation-execution-status --config-rule-name sin-ssh')).RemediationExecutionStatuses;
    expect(ex[ex.length - 1].State).toBe('FAILED');
    // arreglamos el rol y se corrige
    await e.run('iam attach-role-policy --role-name auto-rol --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess');
    await e.run(`configservice put-remediation-configurations --remediation-configurations '${remediation(auto, false)}'`);
    await e.run(`configservice start-remediation-execution --config-rule-name sin-ssh --resource-keys resourceType=AWS::EC2::SecurityGroup,resourceId=${sg}`);
    minutes(e, 1);
    expect(await e.json(`ec2 describe-security-groups --group-ids ${sg} --query "length(SecurityGroups[0].IpPermissions)"`)).toBe(0);
  });
});

describe('CloudFormation y referencias dinámicas', () => {
  const tpl = (body: unknown) => JSON.stringify(body);
  test('AWS::SSM::Parameter y {{resolve:ssm}}', async () => {
    const e = mkEnv();
    await e.run('ssm put-parameter --name /app/ami --value ami-0abc --type String');
    await e.run('ssm put-parameter --name /app/secreto --value s3cr3t --type SecureString');
    e.write('t.json', tpl({ Resources: { P: { Type: 'AWS::SSM::Parameter', Properties: { Name: '/app/copia', Type: 'String', Value: '{{resolve:ssm:/app/ami}}' } } } }));
    await e.run('cloudformation create-stack --stack-name ops --template-body file://t.json');
    minutes(e, 2);
    expect((await e.json('ssm get-parameter --name /app/copia')).Parameter.Value).toBe('ami-0abc');
    e.write('t2.json', tpl({ Resources: { P: { Type: 'AWS::SSM::Parameter', Properties: { Name: '/app/seguro', Type: 'SecureString', Value: 'x' } } } }));
    await e.run('cloudformation create-stack --stack-name ops2 --template-body file://t2.json');
    minutes(e, 2);
    expect(await e.json('cloudformation describe-stacks --stack-name ops2 --query Stacks[0].StackStatus')).toBe('ROLLBACK_COMPLETE');
    e.write('t3.json', tpl({ Resources: { P: { Type: 'AWS::SSM::Parameter', Properties: { Name: '/app/c3', Type: 'String', Value: '{{resolve:ssm:/app/secreto}}' } } } }));
    await e.run('cloudformation create-stack --stack-name ops3 --template-body file://t3.json');
    minutes(e, 2);
    expect(await e.json('cloudformation describe-stacks --stack-name ops3 --query Stacks[0].StackStatus')).toBe('ROLLBACK_COMPLETE');
  });

  test('alarma, filtro de métrica y panel desde una plantilla', async () => {
    const e = mkEnv();
    e.write('t.json', tpl({
      Resources: {
        Grupo: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: '/app/api' } },
        Filtro: { Type: 'AWS::Logs::MetricFilter', Properties: { LogGroupName: { Ref: 'Grupo' }, FilterPattern: 'ERROR', MetricTransformations: [{ MetricName: 'Errores', MetricNamespace: 'App', MetricValue: '1' }] } },
        Alarma: { Type: 'AWS::CloudWatch::Alarm', Properties: { AlarmName: 'api-errores', Namespace: 'App', MetricName: 'Errores', Statistic: 'Sum', Period: 60, EvaluationPeriods: 1, Threshold: 5, ComparisonOperator: 'GreaterThanThreshold' } },
        Panel: { Type: 'AWS::CloudWatch::Dashboard', Properties: { DashboardName: 'api', DashboardBody: JSON.stringify({ widgets: [{ type: 'text', properties: { markdown: '# API' } }] }) } },
      },
    }));
    await e.run('cloudformation create-stack --stack-name obs --template-body file://t.json');
    minutes(e, 3);
    expect(await e.json('cloudformation describe-stacks --stack-name obs --query Stacks[0].StackStatus')).toBe('CREATE_COMPLETE');
    expect((await e.json('logs describe-metric-filters --log-group-name /app/api')).metricFilters).toHaveLength(1);
    expect(await e.json('cloudwatch describe-alarms --alarm-names api-errores --query MetricAlarms[0].Threshold')).toBe(5);
    expect((await e.json('cloudwatch list-dashboards')).DashboardEntries[0].DashboardName).toBe('api');
  });

  test('un trail desde CloudFormation exige IsLogging', async () => {
    const e = mkEnv();
    await e.run('s3 mb s3://trail-logs');
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: 'arn:aws:s3:::trail-logs' }, { Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::trail-logs/AWSLogs/${ACCT}/*` }] }));
    await e.run('s3api put-bucket-policy --bucket trail-logs --policy file://p.json');
    e.write('t.json', tpl({ Resources: { T: { Type: 'AWS::CloudTrail::Trail', Properties: { TrailName: 'auditoria', S3BucketName: 'trail-logs' } } } }));
    await e.run('cloudformation create-stack --stack-name ct --template-body file://t.json');
    minutes(e, 3);
    expect(await e.json('cloudformation describe-stacks --stack-name ct --query Stacks[0].StackStatus')).toBe('ROLLBACK_COMPLETE');
    e.write('t2.json', tpl({ Resources: { T: { Type: 'AWS::CloudTrail::Trail', Properties: { TrailName: 'auditoria', S3BucketName: 'trail-logs', IsLogging: true } } } }));
    await e.run('cloudformation create-stack --stack-name ct2 --template-body file://t2.json');
    minutes(e, 3);
    expect(await e.json('cloudtrail get-trail-status --name auditoria --query IsLogging')).toBe(true);
  });
});
