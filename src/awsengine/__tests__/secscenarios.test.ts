import { Terminal } from '../../engine/terminal';
import { awsQuery } from '../check';

const mk = (aws: string) => new Terminal({ instant: true, aws, cols: 200 });
const out = async (t: Terminal, cmd: string) => (await t.exec(cmd)).out.trim();
const god = (t: Terminal, cmd: string) => (awsQuery(t, cmd)?.stdout ?? '').trim();

describe('escenarios de seguridad', () => {
  test('sec-kms-s3 y sec-kms-app: la clave, el bucket y el usuario sin permiso sobre la clave', async () => {
    const t = mk('sec-kms-s3');
    expect(await out(t, 'aws kms list-aliases --query \'length(Aliases[?AliasName==`alias/datos-clientes`])\'')).toBe('1');
    expect(await out(t, 'aws s3api list-buckets --query "Buckets[].Name" --output text')).toContain('informes-clientes');
    const a = mk('sec-kms-app');
    expect(god(a, `_check kmsuse --bucket informes-clientes --key balance.csv --query KeyAlias`)).toBe('"alias/datos-clientes"');
    expect(god(a, `_check act --user app-informes --service s3api --op get-object --params '{"Bucket":"informes-clientes","Key":"balance.csv"}' --query Ok`)).toBe('false');
  });

  test('sec-kms-politica: la política de la clave solo nombra al administrador', async () => {
    const t = mk('sec-kms-politica');
    expect(god(t, `_check act --user app-pagos --service kms --op generate-data-key --params '{"KeyId":"alias/pagos","KeySpec":"AES_256"}' --query Ok`)).toBe('false');
    expect(await out(t, 'aws kms get-key-policy --key-id alias/pagos --policy-name default --query Policy --output text')).toContain('Administradores');
  });

  test('sec-secreto y sec-secreto-borrado', async () => {
    const t = mk('sec-secreto');
    expect(await out(t, 'aws lambda get-function --function-name rotar-db --query Configuration.Runtime --output text')).toBe('python3.12');
    const b = mk('sec-secreto-borrado');
    expect(await out(b, 'aws secretsmanager describe-secret --secret-id tienda/db --query "DeletedDate!=null"')).toBe('true');
  });

  test('sec-acm y sec-acm-nombre: HTTPS por el nombre propio falla hasta cubrirlo con un certificado', async () => {
    const t = mk('sec-acm');
    expect(god(t, '_check http --url http://www.tienda.test/ --query Status')).toBe('200');
    expect(god(t, '_check http --url https://www.tienda.test/ --query CurlCode')).not.toBe('0');
    const n = mk('sec-acm-nombre');
    expect(god(n, '_check http --url https://tienda.test/ --query Status')).toBe('200');
    expect(god(n, '_check http --url https://www.tienda.test/ --query CurlCode')).toBe('60');
  });

  test('sec-waf y sec-waf-grupos', async () => {
    const t = mk('sec-waf');
    expect(await out(t, 'aws wafv2 list-web-acls --scope REGIONAL --query "length(WebACLs)"')).toBe('0');
    expect(god(t, '_check http --url lb:tienda-alb/ --query Status')).toBe('200');
    const g = mk('sec-waf-grupos');
    expect(await out(g, 'aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[0].Name" --output text')).toBe('tienda-waf');
    expect(god(g, `_check http --url "lb:tienda-alb/buscar?q=1'%20OR%20'1'='1" --query Status`)).toBe('404');
  });

  test('sec-gd, sec-gd-ruido, sec-inspector, sec-macie', async () => {
    const g = mk('sec-gd');
    expect(await out(g, 'aws guardduty list-detectors --query "length(DetectorIds)"')).toBe('0');
    expect(await out(g, 'aws sns list-topics --query "Topics[0].TopicArn" --output text')).toContain(':alertas');
    const r = mk('sec-gd-ruido');
    const chk = god(r, '_check guardduty');
    expect(JSON.parse(chk)).toMatchObject({ Enabled: true, Active: 2, Types: ['Recon:EC2/PortProbeUnprotectedPort'] });
    const i = mk('sec-inspector');
    expect(await out(i, 'aws ssm describe-instance-information --query "length(InstanceInformationList)"')).toBe('2');
    const m = mk('sec-macie');
    expect(await out(m, 'aws s3api list-objects-v2 --bucket exportaciones --query "length(Contents)"')).toBe('4');
  });

  test('sec-analyzer y la organización de sec-scp*', async () => {
    const a = mk('sec-analyzer');
    expect(await out(a, 'aws s3api list-buckets --query "length(Buckets)"')).toBe('2');
    const s = mk('sec-scp');
    expect(god(s, '_check scp --account web-prod --action ec2:RunInstances --query Allowed')).toBe('true');
    expect(await out(s, 'aws organizations list-accounts --query "length(Accounts)"')).toBe('4');
    const l = mk('sec-scp-lista');
    expect(god(l, '_check scp --account web-prod --action ec2:RunInstances --query Reason')).toBe('"noAllow"');
    expect(god(l, '_check scp --account web-prod --action s3:GetObject --query Allowed')).toBe('true');
    expect(god(l, '_check scp --account lab-1 --action ec2:RunInstances --query Allowed')).toBe('true');
    const n = mk('sec-scp-sinallow');
    expect(god(n, '_check scp --account lab-1 --action s3:GetObject --query Level')).toBe('"Root"');
  });

  test('sec-boss: lo importante está mal', async () => {
    const t = mk('sec-boss');
    expect(await out(t, 'aws configservice describe-configuration-recorder-status --query "ConfigurationRecordersStatus[0].recording"')).toBe('true');
    expect(await out(t, 'aws cloudtrail describe-trails --query "length(trailList)"')).toBe('0');
    expect(await out(t, 'aws s3api get-bucket-policy --bucket clientes-datos --query Policy --output text')).toContain('Publico');
  });
});
