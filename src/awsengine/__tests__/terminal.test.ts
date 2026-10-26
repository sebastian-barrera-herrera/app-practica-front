import { Terminal, restoreTerminal } from '../../engine/terminal';
import { evaluate } from '../../engine/check';
import { imageId } from '../catalog';
import { secretFor } from '../util';

const mk = (aws: any = 'base', extra: any = {}) => new Terminal({ instant: true, aws, ...extra });

describe('aws dentro del shell de Linux', () => {
  test('aws no existe en un mundo sin cuenta', async () => {
    const t = new Terminal({ instant: true });
    const r = await t.exec('aws --version');
    expect(r.status).toBe(127);
    expect(r.err).toContain('aws: command not found');
  });

  test('comandos, tuberías y redirecciones', async () => {
    const t = mk('equipo');
    expect((await t.exec('aws sts get-caller-identity --query Arn --output text')).out).toBe('arn:aws:iam::123456789012:user/alumno\n');
    expect((await t.exec('aws iam list-users --query "Users[].UserName" --output text | tr "\\t" "\\n" | sort')).out).toBe('alumno\nana\nbob\ncarla\n');
    expect((await t.exec('aws iam list-users --output json > usuarios.json && grep -c UserName usuarios.json')).out).toBe('4\n');
    expect((await t.exec('aws iam get-user --user-name ana | grep -i username')).out).toContain('"UserName": "ana"');
    // $(…) y variables
    await t.exec('ACCOUNT=$(aws sts get-caller-identity --query Account --output text)');
    expect((await t.exec('echo $ACCOUNT')).out).toBe('123456789012\n');
    const r = await t.exec('aws iam get-user --user-name nadie');
    expect(r.status).toBe(254);
    expect(r.err).toContain('NoSuchEntity');
    expect((await t.exec('echo $?')).out).toBe('254\n');
  });

  test('credenciales en ~/.aws, perfiles y variables de entorno', async () => {
    const t = mk('equipo');
    const cred = (await t.exec('cat ~/.aws/credentials')).out;
    expect(cred).toContain('[default]');
    expect(cred).toContain('[ana]');
    expect(cred).toMatch(/aws_access_key_id = AKIA/);
    expect((await t.exec('ls -l ~/.aws/credentials')).out).toMatch(/^-rw-------/);
    expect((await t.exec('cat ~/.aws/config')).out).toContain('[profile ana]');
    expect((await t.exec('aws sts get-caller-identity --profile ana --query Arn --output text')).out).toContain('user/ana');
    await t.exec('export AWS_PROFILE=bob');
    expect((await t.exec('aws sts get-caller-identity --query Arn --output text')).out).toContain('user/bob');
    expect((await t.exec('AWS_PROFILE=carla aws sts get-caller-identity --query Arn --output text')).out).toContain('user/carla');
    expect((await t.exec('aws configure list')).out).toContain('profile                      bob');
    await t.exec('unset AWS_PROFILE');
    const list = (await t.exec('aws configure list')).out;
    expect(list).toContain('access_key');
    expect(list).toContain('shared-credentials-file');
    expect(list).toContain('~/.aws/credentials');
    expect(list).toContain('us-east-1');
    expect((await t.exec('aws configure get region')).out).toBe('us-east-1\n');
    await t.exec('aws configure set region eu-west-1');
    expect((await t.exec('aws configure get region')).out).toBe('eu-west-1\n');
    expect((await t.exec('aws configure list-profiles')).out).toBe('default\nana\nbob\ncarla\n');
  });

  test('aws configure interactivo', async () => {
    const t = mk({ scenario: 'base', noCredentials: true, region: '' });
    expect((await t.exec('aws sts get-caller-identity')).err).toContain('Unable to locate credentials');
    // la clave real del alumno
    const acct = (t.world.sys.ext as any).aws;
    const key = acct.iam.users.alumno.accessKeys[0].AccessKeyId;
    const p = t.run('aws configure');
    await new Promise((r) => setTimeout(r, 10));
    expect(t.awaitingInput).toBe(true);
    await t.run(key);
    await new Promise((r) => setTimeout(r, 10));
    await t.run(secretFor(key));
    await new Promise((r) => setTimeout(r, 10));
    await t.run('us-east-1');
    await new Promise((r) => setTimeout(r, 10));
    await t.run('json');
    await p;
    expect((await t.exec('aws sts get-caller-identity --query Account --output text')).out).toBe('123456789012\n');
    expect((await t.exec('cat ~/.aws/config')).out).toContain('region = us-east-1');
  });

  test('archivos locales con file:// y s3 cp entre el VFS y S3', async () => {
    const t = mk('base', { files: { '/home/alumno/politica.json': JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] }), '/home/alumno/notas.txt': 'hola nube\n' } });
    expect((await t.exec('aws iam create-policy --policy-name Leer --policy-document file://politica.json --query Policy.Arn --output text')).out).toBe('arn:aws:iam::123456789012:policy/Leer\n');
    await t.exec('aws s3 mb s3://mi-bucket-lab');
    expect((await t.exec('aws s3 cp notas.txt s3://mi-bucket-lab/')).out).toBe('upload: ./notas.txt to s3://mi-bucket-lab/notas.txt\n');
    await t.exec('mkdir bajadas && cd bajadas');
    expect((await t.exec('aws s3 cp s3://mi-bucket-lab/notas.txt .')).out).toBe('download: s3://mi-bucket-lab/notas.txt to ./notas.txt\n');
    expect((await t.exec('cat notas.txt')).out).toBe('hola nube\n');
    expect((await t.exec('aws s3 ls s3://mi-bucket-lab')).out).toMatch(/2026-03-14 \d\d:\d\d:\d\d +10 notas\.txt/);
    // el reloj de la cuenta y el del sistema avanzan juntos
    expect((await t.exec('date +%Y')).out).toBe('2026\n');
  });

  test('comprobaciones de estado con check aws', async () => {
    const t = mk('base');
    const check = { t: 'aws' as const, cmd: 'iam list-users --query "Users[].UserName"', json: ['alumno', 'lucia'] };
    expect(evaluate(check, t).ok).toBe(false);
    await t.exec('aws iam create-user --user-name lucia');
    expect(evaluate(check, t).ok).toBe(true);
    // la comprobación no cambia nada ni cuenta como comando del alumno
    expect(t.runs.filter((r) => r.line.includes('list-users'))).toHaveLength(0);
    expect(evaluate({ t: 'aws', cmd: 'iam get-user --user-name lucia', fails: true }, t).ok).toBe(false);
    expect(evaluate({ t: 'aws', cmd: 'iam get-user --user-name nadie', fails: true, includes: 'NoSuchEntity' }, t).ok).toBe(true);
    expect(evaluate({ t: 'aws', cmd: 'iam list-access-keys --user-name lucia --query "AccessKeyMetadata[]"', empty: true }, t).ok).toBe(true);
    await t.exec('aws iam create-access-key --user-name lucia');
    expect(evaluate({ t: 'aws', cmd: 'iam list-access-keys --user-name lucia --query "AccessKeyMetadata[]"', empty: true }, t).ok).toBe(false);
    // EC2: las transiciones se dan por asentadas
    await t.exec(`aws ec2 run-instances --image-id ${imageId('us-east-1', 'al2023-x86')} --instance-type t3.micro`);
    expect(evaluate({ t: 'aws', cmd: 'ec2 describe-instances --query "Reservations[].Instances[].State.Name"', json: ['running'] }, t).ok).toBe(true);
  });

  test('el estado de AWS sobrevive a snapshot y restore', async () => {
    const t = mk('equipo');
    await t.exec('aws iam create-user --user-name persistente');
    const snap = JSON.parse(JSON.stringify(t.snapshot()));
    const r = restoreTerminal(snap);
    const out = await r.exec('aws iam get-user --user-name persistente --query User.UserName --output text');
    expect(out.out).toBe('persistente\n');
    expect((await r.exec('aws sts get-caller-identity --query Arn --output text')).out).toContain('user/alumno');
  });
});
