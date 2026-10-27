/** Escenarios de la zona «Seguridad en profundidad» (Z15): KMS, Secrets Manager, ACM, WAF, detección (GuardDuty, Inspector, Macie, Access Analyzer), Security Hub y SCP. */
import type { Scenario } from './scenarios';
import { haWorld } from './scenarios-c';
import { BASIC, TRUST, call, fn, policy, role } from './scenarios-srv';
import { ec2CreateSg, ec2Launch } from './services/ec2';
import { orgAddAccount, orgCreate } from './services/govern';
import { iamCreateRole, iamCreateUser } from './services/iam';
import { r53CreateZone } from './services/route53';
import { s3CreateBucket, s3Put } from './services/s3';
import { tick } from './tick';
import type { Account, PolicyDoc } from './types';

const R = 'us-east-1';
const ACCT = '123456789012';
const MIN = 60000;

/** Nombres que usan los escenarios (y sus tests). */
export const SEC = {
  clave: 'alias/datos-clientes',
  bucketInformes: 'informes-clientes',
  objeto: 'balance.csv',
  zona: 'tienda.test',
  lb: 'tienda-alb',
} as const;

/** Función de rotación de un secreto (los cuatro pasos de Secrets Manager). */
export const ROTATE_CODE = `import json

import boto3

sm = boto3.client('secretsmanager')


def lambda_handler(event, context):
    arn, token, step = event['SecretId'], event['ClientRequestToken'], event['Step']
    versions = sm.describe_secret(SecretId=arn)['VersionIdsToStages']
    if token not in versions:
        raise ValueError('La version %s no esta preparada para la rotacion' % token)
    if 'AWSCURRENT' in versions[token]:
        return
    if step == 'createSecret':
        actual = json.loads(sm.get_secret_value(SecretId=arn, VersionStage='AWSCURRENT')['SecretString'])
        try:
            sm.get_secret_value(SecretId=arn, VersionId=token, VersionStage='AWSPENDING')
        except sm.exceptions.ResourceNotFoundException:
            actual['password'] = sm.get_random_password(PasswordLength=24, ExcludePunctuation=True)['RandomPassword']
            sm.put_secret_value(SecretId=arn, ClientRequestToken=token, SecretString=json.dumps(actual), VersionStages=['AWSPENDING'])
    elif step == 'setSecret':
        print('Aqui se cambiaria la contrasena en la base de datos')
    elif step == 'testSecret':
        nueva = json.loads(sm.get_secret_value(SecretId=arn, VersionId=token, VersionStage='AWSPENDING')['SecretString'])
        if not nueva.get('password'):
            raise ValueError('La contrasena nueva esta vacia')
    elif step == 'finishSecret':
        actual = [v for v, st in versions.items() if 'AWSCURRENT' in st][0]
        sm.update_secret_version_stage(SecretId=arn, VersionStage='AWSCURRENT', MoveToVersionId=token, RemoveFromVersionId=actual)
`;

// ───────────────────────── piezas ─────────────────────────

/** Una clave gestionada por el cliente con su alias. */
function cmk(a: Account, alias: string, description: string, keyPolicy?: PolicyDoc): { id: string; arn: string } {
  const m = call(a, 'kms', 'create-key', { Description: description, ...(keyPolicy ? { Policy: JSON.stringify(keyPolicy), BypassPolicyLockoutSafetyCheck: true } : {}) }).KeyMetadata as { KeyId: string; Arn: string };
  call(a, 'kms', 'create-alias', { AliasName: alias, TargetKeyId: m.KeyId });
  return { id: m.KeyId, arn: m.Arn };
}

/** Un tema SNS (`alertas`) que EventBridge puede usar, con una cola SQS (`guardia`) suscrita para ver si llegó el aviso. */
function alertas(a: Account): string {
  const t = call(a, 'sns', 'create-topic', { Name: 'alertas' }).TopicArn as string;
  const url = call(a, 'sqs', 'create-queue', { QueueName: 'guardia' }).QueueUrl as string;
  const qArn = `arn:aws:sqs:${R}:${ACCT}:guardia`;
  const qPol = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qArn, Condition: { ArnEquals: { 'aws:SourceArn': t } } }] };
  call(a, 'sqs', 'set-queue-attributes', { QueueUrl: url, Attributes: { Policy: JSON.stringify(qPol) } });
  call(a, 'sns', 'subscribe', { TopicArn: t, Protocol: 'sqs', NotificationEndpoint: qArn });
  const tPol = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sns:Publish', Resource: t }] };
  call(a, 'sns', 'set-topic-attributes', { TopicArn: t, AttributeName: 'Policy', AttributeValue: JSON.stringify(tPol) });
  return t;
}

const WEB_UD = '#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Tienda</h1>" > /var/www/html/index.html\n';

function ssmProfile(a: Account): void {
  iamCreateRole(a, 'ssm-ec2', TRUST('ec2.amazonaws.com'), { attached: ['AmazonSSMManagedInstanceCore'], description: 'Systems Manager para EC2' });
  a.iam.instanceProfiles['ssm-ec2'] = { InstanceProfileName: 'ssm-ec2', InstanceProfileId: 'AIPAEXAMPLE0SSMEC2', Arn: `arn:aws:iam::${a.id}:instance-profile/ssm-ec2`, Path: '/', CreateDate: new Date(a.clock).toISOString(), roles: ['ssm-ec2'] };
}

/** AWS Config grabando (hace falta para que Security Hub evalúe controles). */
function configOn(a: Account): void {
  const b = s3CreateBucket(a, 'config-logs', R);
  b.policy = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: 'arn:aws:s3:::config-logs' },
      { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::config-logs/AWSLogs/${ACCT}/Config/*` },
    ],
  };
  const r = iamCreateRole(a, 'config-rol', TRUST('config.amazonaws.com'), { attached: ['service-role/AWS_ConfigRole'] });
  call(a, 'configservice', 'put-configuration-recorder', { ConfigurationRecorder: { name: 'default', roleARN: r.Arn, recordingGroup: { allSupported: true, includeGlobalResourceTypes: true } } });
  call(a, 'configservice', 'put-delivery-channel', { DeliveryChannel: { name: 'default', s3BucketName: 'config-logs' } });
  call(a, 'configservice', 'start-configuration-recorder', { ConfigurationRecorderName: 'default' });
}

/** Rellena un bucket con objetos de texto. */
function fill(a: Account, bucket: string, files: Record<string, string>): void {
  const b = a.s3.buckets[bucket];
  for (const [k, v] of Object.entries(files)) s3Put(a, b, k, v);
}

const PERMITE = (principal: string, bucket: string, actions: string[]): PolicyDoc => ({ Version: '2012-10-17', Statement: [{ Sid: 'Acceso', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${principal}:root` }, Action: actions, Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`] }] });

/** La organización de los ejercicios de SCP: dos unidades y tres cuentas miembro. */
function org(a: Account): { root: string; prod: string; sandbox: string; web: string; lab: string; seg: string } {
  const o = orgCreate(a, 'ALL');
  const prod = call(a, 'organizations', 'create-organizational-unit', { ParentId: o.rootId, Name: 'Produccion' }).OrganizationalUnit.Id as string;
  const sandbox = call(a, 'organizations', 'create-organizational-unit', { ParentId: o.rootId, Name: 'Sandbox' }).OrganizationalUnit.Id as string;
  const web = orgAddAccount(a, 'web-prod', 'web-prod@ejemplo.com', prod).Id;
  const lab = orgAddAccount(a, 'lab-1', 'lab-1@ejemplo.com', sandbox).Id;
  const seg = orgAddAccount(a, 'seguridad', 'seguridad@ejemplo.com').Id;
  return { root: o.rootId, prod, sandbox, web, lab, seg };
}

const scp = (name: string, statements: unknown[]) => ({ name, content: JSON.stringify({ Version: '2012-10-17', Statement: statements }) });

function makeScp(a: Account, name: string, statements: unknown[]): string {
  const { content } = scp(name, statements);
  return call(a, 'organizations', 'create-policy', { Name: name, Description: name, Type: 'SERVICE_CONTROL_POLICY', Content: content }).Policy.PolicySummary.Id as string;
}

// ───────────────────────── escenarios ─────────────────────────

export function makeSecScenarios(base: Scenario): Record<string, Scenario> {
  /** Una clave `alias/datos-clientes` y un bucket de informes con cifrado por defecto SSE-S3. */
  const kmsS3: Scenario = (a) => {
    base(a);
    cmk(a, SEC.clave, 'Datos de clientes');
    s3CreateBucket(a, SEC.bucketInformes, R);
  };

  /** El bucket ya cifra con la clave y tiene `balance.csv`; la aplicación `app-informes` lee S3 pero no puede usar la clave. */
  const kmsApp: Scenario = (a) => {
    base(a);
    const k = cmk(a, SEC.clave, 'Datos de clientes');
    s3CreateBucket(a, SEC.bucketInformes, R);
    call(a, 's3api', 'put-bucket-encryption', { Bucket: SEC.bucketInformes, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: k.arn }, BucketKeyEnabled: true }] } });
    s3Put(a, a.s3.buckets[SEC.bucketInformes], SEC.objeto, 'mes,total\nene,1200\nfeb,1350\n', { sse: 'aws:kms', kmsKeyId: k.arn });
    iamCreateUser(a, 'app-informes', { attached: ['AmazonS3ReadOnlyAccess'], keys: 1 });
  };

  /** Una clave cuya política solo deja administrar a `alumno`: la aplicación tiene permiso en IAM, pero la política de la clave no la nombra. */
  const kmsPolitica: Scenario = (a) => {
    base(a);
    cmk(a, 'alias/pagos', 'Cifrado de pagos', {
      Version: '2012-10-17',
      Id: 'key-pagos',
      Statement: [{ Sid: 'Administradores', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:user/alumno` }, Action: ['kms:Create*', 'kms:Describe*', 'kms:Enable*', 'kms:List*', 'kms:Put*', 'kms:Update*', 'kms:Revoke*', 'kms:Disable*', 'kms:Get*', 'kms:Delete*', 'kms:TagResource', 'kms:UntagResource', 'kms:ScheduleKeyDeletion', 'kms:CancelKeyDeletion'], Resource: '*' }],
    });
    iamCreateUser(a, 'app-pagos', { keys: 1, inline: { 'usar-kms': policy([{ Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: '*' }]) } });
  };

  /** La función de rotación `rotar-db` ya está desplegada; falta el secreto y la rotación. */
  const secreto: Scenario = (a) => {
    base(a);
    const r = role(a, 'rotar-rol', { attached: [BASIC, 'SecretsManagerReadWrite'] });
    fn(a, 'rotar-db', ROTATE_CODE, r, { timeout: 10, handler: 'lambda_function.lambda_handler' });
  };

  /** Un secreto en cuenta atrás para borrarse. */
  const secretoBorrado: Scenario = (a) => {
    base(a);
    call(a, 'secretsmanager', 'create-secret', { Name: 'tienda/db', SecretString: '{"username":"app","password":"Tienda-2024!"}' });
    call(a, 'secretsmanager', 'delete-secret', { SecretId: 'tienda/db', RecoveryWindowInDays: 7 });
  };

  /** Balanceador con dos servidores, zona `tienda.test` con el apex y `www` apuntando a él, y el 443 abierto en el grupo de seguridad. */
  const world = (a: Account) => {
    base(a);
    const w = haWorld(a, { servers: true, alb: true });
    const sg = a.regions[R].ec2.securityGroups[w.albSg.GroupId];
    sg.IpPermissions.push({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], UserIdGroupPairs: [] });
    const z = r53CreateZone(a, SEC.zona);
    const lb = call(a, 'elbv2', 'describe-load-balancers', { Names: [SEC.lb] }).LoadBalancers[0] as { DNSName: string; CanonicalHostedZoneId: string; LoadBalancerArn: string };
    for (const n of [SEC.zona, `www.${SEC.zona}`]) call(a, 'route53', 'change-resource-record-sets', { HostedZoneId: z.Id, ChangeBatch: { Changes: [{ Action: 'UPSERT', ResourceRecordSet: { Name: n, Type: 'A', AliasTarget: { HostedZoneId: lb.CanonicalHostedZoneId, DNSName: lb.DNSName, EvaluateTargetHealth: false } } }] } });
    return { zone: z.Id, lb };
  };

  const acm: Scenario = (a) => void world(a);

  /** El balanceador ya sirve HTTPS con un certificado de `tienda.test` (sin comodín): `www.tienda.test` da error de nombre. */
  const acmNombre: Scenario = (a) => {
    const { zone, lb } = world(a);
    const arn = call(a, 'acm', 'request-certificate', { DomainName: SEC.zona, ValidationMethod: 'DNS' }).CertificateArn as string;
    const rec = call(a, 'acm', 'describe-certificate', { CertificateArn: arn }).Certificate.DomainValidationOptions[0].ResourceRecord as { Name: string; Value: string };
    call(a, 'route53', 'change-resource-record-sets', { HostedZoneId: zone, ChangeBatch: { Changes: [{ Action: 'UPSERT', ResourceRecordSet: { Name: rec.Name, Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: rec.Value }] } }] } });
    const tg = call(a, 'elbv2', 'describe-target-groups', { Names: ['web-tg'] }).TargetGroups[0].TargetGroupArn as string;
    call(a, 'elbv2', 'create-listener', { LoadBalancerArn: lb.LoadBalancerArn, Protocol: 'HTTPS', Port: 443, Certificates: [{ CertificateArn: arn }], DefaultActions: [{ Type: 'forward', TargetGroupArn: tg }] });
  };

  /** Balanceador con dos servidores y nada más (ni ACL ni reglas). */
  const waf: Scenario = (a) => {
    base(a);
    haWorld(a, { servers: true, alb: true });
  };

  /** Ya existe `tienda-waf`, sin reglas y asociada al balanceador: falta ponerle protección. */
  const wafGrupos: Scenario = (a) => {
    base(a);
    haWorld(a, { servers: true, alb: true });
    const lb = call(a, 'elbv2', 'describe-load-balancers', { Names: [SEC.lb] }).LoadBalancers[0].LoadBalancerArn as string;
    const acl = call(a, 'wafv2', 'create-web-acl', { Name: 'tienda-waf', Scope: 'REGIONAL', DefaultAction: { Allow: {} }, Rules: [], VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: 'tienda-waf' } }).Summary.ARN as string;
    call(a, 'wafv2', 'associate-web-acl', { WebAclArn: acl, ResourceArn: lb });
  };

  /** Un servidor expuesto, GuardDuty apagado y un tema de alertas con su cola. */
  const gd: Scenario = (a) => {
    base(a);
    alertas(a);
    ec2Launch(a, R, { type: 't3.micro', tags: [{ Key: 'Name', Value: 'web-1' }] });
    a.clock += 5 * MIN;
  };

  /** Dos servidores con el SSH abierto (uno es el bastión, a propósito), GuardDuty ya activo y los sondeos ya detectados. */
  const gdRuido: Scenario = (a) => {
    base(a);
    const sg = ec2CreateSg(a, R, 'ssh-abierto', 'SSH desde cualquier sitio', [{ proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }]);
    for (const n of ['bastion', 'web-1']) ec2Launch(a, R, { type: 't3.micro', sgIds: [sg.GroupId], tags: [{ Key: 'Name', Value: n }] });
    a.clock += 5 * MIN;
    call(a, 'guardduty', 'create-detector', { Enable: true });
    tick(a);
    a.clock += 25 * MIN;
    tick(a);
  };

  /** Dos servidores de producción administrados por Systems Manager, con parches de seguridad pendientes. */
  const inspector: Scenario = (a) => {
    base(a);
    ssmProfile(a);
    for (const n of [1, 2]) ec2Launch(a, R, { type: 't3.micro', profile: 'ssm-ec2', userData: WEB_UD, tags: [{ Key: 'Name', Value: `web-${n}` }, { Key: 'Env', Value: 'prod' }] });
    a.clock += 10 * MIN;
  };

  /** Un bucket de exportaciones con datos de clientes mezclados con ficheros inocuos. */
  const macie: Scenario = (a) => {
    base(a);
    s3CreateBucket(a, 'exportaciones', R);
    fill(a, 'exportaciones', {
      'clientes.csv': 'nombre,dni,tarjeta\nAna Ruiz,12345678Z,4111 1111 1111 1111\nLuis Gil,87654321X,5500 0000 0000 0004\n',
      'claves.txt': '# copia de seguridad\naws_access_key_id=AKIAIOSFODNN7EXAMPLE\n',
      'ventas.csv': 'mes,total\nene,1200\nfeb,1350\n',
      'logo.png': 'PNGDATA',
    });
  };

  /** Un bucket compartido por error con una cuenta desconocida y otro compartido, a propósito, con un socio (por bucket y por rol). */
  const analyzer: Scenario = (a) => {
    base(a);
    s3CreateBucket(a, 'facturas', R).policy = PERMITE('999999999999', 'facturas', ['s3:GetObject', 's3:ListBucket']);
    s3CreateBucket(a, 'intercambio', R).policy = PERMITE('888888888888', 'intercambio', ['s3:GetObject', 's3:PutObject']);
    iamCreateRole(a, 'socio-rol', { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::888888888888:root' }, Action: 'sts:AssumeRole' }] }, { attached: ['AmazonS3ReadOnlyAccess'] });
    s3Put(a, a.s3.buckets.facturas, '2025-001.pdf', 'FACTURA');
  };

  /** Organización con Produccion (cuenta `web-prod`), Sandbox (`lab-1`) y la cuenta `seguridad`, sin más SCP que FullAWSAccess. */
  const scpBase: Scenario = (a) => {
    base(a);
    org(a);
  };

  /** Produccion solo tiene una SCP de lista de permitidos (`solo-s3`) y no tiene FullAWSAccess: web-prod no puede lanzar nada. */
  const scpLista: Scenario = (a) => {
    base(a);
    const o = org(a);
    const id = makeScp(a, 'solo-s3', [{ Effect: 'Allow', Action: ['s3:*'], Resource: '*' }]);
    call(a, 'organizations', 'attach-policy', { PolicyId: id, TargetId: o.prod });
    call(a, 'organizations', 'detach-policy', { PolicyId: 'p-FullAWSAccess', TargetId: o.prod });
  };

  /** Alguien quitó FullAWSAccess de la raíz y dejó solo una SCP de denegación: ninguna cuenta puede hacer nada. */
  const scpSinAllow: Scenario = (a) => {
    base(a);
    const o = org(a);
    const id = makeScp(a, 'solo-irlanda', [{ Effect: 'Deny', NotAction: ['iam:*', 'organizations:*', 'sts:*', 'route53:*', 'cloudfront:*', 'support:*'], Resource: '*', Condition: { StringNotEquals: { 'aws:RequestedRegion': ['eu-west-1'] } } }]);
    call(a, 'organizations', 'attach-policy', { PolicyId: id, TargetId: o.root });
    call(a, 'organizations', 'detach-policy', { PolicyId: 'p-FullAWSAccess', TargetId: o.root });
  };

  /** La auditoría final: nada de lo importante está bien. Config graba (para Security Hub) y el bucket del trail está listo. */
  const boss: Scenario = (a) => {
    base(a);
    configOn(a);
    const sg = ec2CreateSg(a, R, 'web-sg', 'Servidores web', [{ proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }, { proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }]);
    haWorld(a, { servers: true, alb: true });
    // los grupos de seguridad por defecto ya están endurecidos (sin reglas): el reto se centra en lo demás
    for (const r of Object.values(a.regions)) for (const g of Object.values(r.ec2.securityGroups)) if (g.GroupName === 'default') g.IpPermissions = g.IpPermissionsEgress = [];
    ec2Launch(a, R, { type: 't3.micro', sgIds: [sg.GroupId], tags: [{ Key: 'Name', Value: 'web-extra' }] });
    const d = s3CreateBucket(a, 'clientes-datos', R, { publicAccessBlock: null });
    s3Put(a, d, 'clientes.csv', 'nombre,email\nana,ana@tienda.es\n');
    d.policy = { Version: '2012-10-17', Statement: [{ Sid: 'Publico', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::clientes-datos/*' }] };
    const t = s3CreateBucket(a, 'auditoria-logs', R);
    t.policy = {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: 'arn:aws:s3:::auditoria-logs' },
        { Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::auditoria-logs/AWSLogs/${ACCT}/*`, Condition: { StringEquals: { 's3:x-amz-acl': 'bucket-owner-full-control' } } },
      ],
    };
    cmk(a, 'alias/clientes', 'Clave de los datos de clientes');
    a.clock += 5 * MIN;
  };

  return { 'sec-kms-s3': kmsS3, 'sec-kms-app': kmsApp, 'sec-kms-politica': kmsPolitica, 'sec-secreto': secreto, 'sec-secreto-borrado': secretoBorrado, 'sec-acm': acm, 'sec-acm-nombre': acmNombre, 'sec-waf': waf, 'sec-waf-grupos': wafGrupos, 'sec-gd': gd, 'sec-gd-ruido': gdRuido, 'sec-inspector': inspector, 'sec-macie': macie, 'sec-analyzer': analyzer, 'sec-scp': scpBase, 'sec-scp-lista': scpLista, 'sec-scp-sinallow': scpSinAllow, 'sec-boss': boss };
}
