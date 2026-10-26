import { Terminal } from '../../engine/terminal';
import { imageId } from '../catalog';

const mk = (files: Record<string, string> = {}, aws: any = 'base') => new Terminal({ instant: true, aws, files });
const PUBLIC = (b: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${b}/*` }] });

describe('curl contra S3', () => {
  test('un objeto privado da 403; uno público con política, 200', async () => {
    const t = mk({ '/home/alumno/hola.txt': 'hola desde S3\n' });
    await t.exec('aws s3 mb s3://web-demo-1');
    await t.exec('aws s3 cp hola.txt s3://web-demo-1/hola.txt');
    const priv = await t.exec('curl -s https://web-demo-1.s3.amazonaws.com/hola.txt');
    expect(priv.out).toContain('<Code>AccessDenied</Code>');
    expect((await t.exec('curl -s -o /dev/null -w "%{http_code}" https://web-demo-1.s3.amazonaws.com/hola.txt')).out).toBe('403');
    // aunque la política sea pública, Block Public Access la bloquea mientras esté activo
    await t.exec('aws s3api put-public-access-block --bucket web-demo-1 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false');
    await t.exec(`aws s3api put-bucket-policy --bucket web-demo-1 --policy '${PUBLIC('web-demo-1')}'`);
    expect((await t.exec('curl -s https://web-demo-1.s3.amazonaws.com/hola.txt')).out).toBe('hola desde S3\n');
    // path-style
    expect((await t.exec('curl -s https://s3.amazonaws.com/web-demo-1/hola.txt')).out).toBe('hola desde S3\n');
    // un objeto que no existe, sin ListBucket público, también da 403 (no 404)
    expect((await t.exec('curl -s https://web-demo-1.s3.amazonaws.com/nada.txt')).out).toContain('AccessDenied');
    // RestrictPublicBuckets lo vuelve a cerrar
    await t.exec('aws s3api put-public-access-block --bucket web-demo-1 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=true');
    expect((await t.exec('curl -s https://web-demo-1.s3.amazonaws.com/hola.txt')).out).toContain('AccessDenied');
    expect((await t.exec('curl -s https://bucket-que-no-existe-1.s3.amazonaws.com/x')).out).toContain('NoSuchBucket');
  });

  test('URL prefirmada: funciona, caduca y no se puede manipular', async () => {
    const t = mk({ '/home/alumno/secreto.txt': 'solo con permiso\n' });
    await t.exec('aws s3 mb s3://firma-demo-1');
    await t.exec('aws s3 cp secreto.txt s3://firma-demo-1/secreto.txt');
    const url = (await t.exec('aws s3 presign s3://firma-demo-1/secreto.txt --expires-in 300')).out.trim();
    expect((await t.exec(`curl -s "${url}"`)).out).toBe('solo con permiso\n');
    // alterar la URL (otro objeto) rompe la firma
    expect((await t.exec(`curl -s "${url.replace('secreto.txt', 'otro.txt')}"`)).out).toContain('SignatureDoesNotMatch');
    // pasados los 300 s caduca
    t.sys.clock.now += 301_000;
    const late = await t.exec(`curl -s "${url}"`);
    expect(late.out).toContain('Request has expired');
    // si se borra la clave del firmante, deja de funcionar aunque no haya caducado
    const url2 = (await t.exec('aws s3 presign s3://firma-demo-1/secreto.txt --expires-in 3600')).out.trim();
    expect((await t.exec(`curl -s "${url2}"`)).out).toBe('solo con permiso\n');
    const acct = (t.world.sys.ext as any).aws;
    const key = acct.iam.users.alumno.accessKeys[0].AccessKeyId;
    acct.iam.users.alumno.accessKeys[0].Status = 'Inactive';
    expect((await t.exec(`curl -s "${url2}"`)).out).toContain('InvalidAccessKeyId');
    void key;
  });

  test('sitio web estático', async () => {
    const t = mk({ '/home/alumno/index.html': '<h1>Mi sitio</h1>\n', '/home/alumno/error.html': '<h1>No existe</h1>\n' });
    await t.exec('aws s3 mb s3://sitio-demo-1');
    await t.exec('aws s3 cp index.html s3://sitio-demo-1/ && aws s3 cp error.html s3://sitio-demo-1/');
    const url = 'http://sitio-demo-1.s3-website-us-east-1.amazonaws.com/';
    expect((await t.exec(`curl -s ${url}`)).out).toContain('NoSuchWebsiteConfiguration');
    await t.exec('aws s3 website s3://sitio-demo-1/ --index-document index.html --error-document error.html');
    expect((await t.exec(`curl -s ${url}`)).out).toContain('403 Forbidden');
    await t.exec('aws s3api put-public-access-block --bucket sitio-demo-1 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false');
    await t.exec(`aws s3api put-bucket-policy --bucket sitio-demo-1 --policy '${PUBLIC('sitio-demo-1')}'`);
    expect((await t.exec(`curl -s ${url}`)).out).toBe('<h1>Mi sitio</h1>\n');
    expect((await t.exec(`curl -s ${url}index.html`)).out).toBe('<h1>Mi sitio</h1>\n');
    // sin permiso s3:ListBucket, un objeto que no existe da 403 en vez de 404
    expect((await t.exec(`curl -s ${url}nada.html`)).out).toContain('403 Forbidden');
    const both = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::sitio-demo-1', 'arn:aws:s3:::sitio-demo-1/*'] }] });
    await t.exec(`aws s3api put-bucket-policy --bucket sitio-demo-1 --policy '${both}'`);
    expect((await t.exec(`curl -s ${url}nada.html`)).out).toBe('<h1>No existe</h1>\n');
    expect((await t.exec(`curl -s -o /dev/null -w "%{http_code}" ${url}nada.html`)).out).toBe('404');
    // los sitios web de S3 no hablan HTTPS
    expect((await t.exec('curl -s https://sitio-demo-1.s3-website-us-east-1.amazonaws.com/')).status).not.toBe(0);
  });
});

describe('curl contra EC2', () => {
  test('timeout si el grupo de seguridad lo bloquea, rechazo si no hay servidor y página si lo hay', async () => {
    const t = mk();
    const AMI = imageId('us-east-1', 'al2023-x86');
    const sg = JSON.parse((await t.exec('aws ec2 create-security-group --group-name web --description web')).out).GroupId;
    const ud = '#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Hola desde EC2</h1>" > /var/www/html/index.html\n';
    t.world.fs.writeFile('/home/alumno/ud.sh', ud, { cred: null });
    const run = JSON.parse((await t.exec(`aws ec2 run-instances --image-id ${AMI} --instance-type t3.micro --security-group-ids ${sg} --user-data file://ud.sh`)).out);
    const id = run.Instances[0].InstanceId;
    await t.exec(`aws ec2 wait instance-running --instance-ids ${id}`);
    const ip = (await t.exec(`aws ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].PublicIpAddress" --output text`)).out.trim();
    const dns = (await t.exec(`aws ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].PublicDnsName" --output text`)).out.trim();
    const timeout = await t.exec(`curl -s --max-time 5 http://${ip}`);
    expect(timeout.status).toBe(0 + timeout.status);
    const e1 = await t.exec(`curl http://${ip}`);
    expect(e1.status).toBe(28);
    await t.exec(`aws ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
    expect((await t.exec(`curl -s http://${ip}`)).out).toBe('<h1>Hola desde EC2</h1>\n');
    expect((await t.exec(`curl -s http://${dns}`)).out).toBe('<h1>Hola desde EC2</h1>\n');
    // el puerto 443 no está abierto
    expect((await t.exec(`curl http://${ip}:8080`)).status).toBe(28);
    // parar la instancia: ya no responde
    await t.exec(`aws ec2 stop-instances --instance-ids ${id}`);
    await t.exec(`aws ec2 wait instance-stopped --instance-ids ${id}`);
    expect((await t.exec(`curl http://${ip}`)).status).not.toBe(0);
  });

  test('sin servidor web instalado: conexión rechazada', async () => {
    const t = mk();
    const AMI = imageId('us-east-1', 'al2023-x86');
    const sg = JSON.parse((await t.exec('aws ec2 create-security-group --group-name abierto --description x')).out).GroupId;
    await t.exec(`aws ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
    const id = JSON.parse((await t.exec(`aws ec2 run-instances --image-id ${AMI} --instance-type t3.micro --security-group-ids ${sg}`)).out).Instances[0].InstanceId;
    await t.exec(`aws ec2 wait instance-running --instance-ids ${id}`);
    const ip = (await t.exec(`aws ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].PublicIpAddress" --output text`)).out.trim();
    const r = await t.exec(`curl http://${ip}`);
    expect(r.status).toBe(7);
    expect(r.err).toContain("Couldn't connect to server");
  });
});
