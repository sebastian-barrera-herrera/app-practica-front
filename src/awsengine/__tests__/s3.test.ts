import { mkEnv } from './helpers';

const lines = (s: string) => s.split('\n').filter(Boolean);

describe('S3: buckets', () => {
  test('mb, ls, rb', async () => {
    const e = mkEnv();
    expect((await e.run('s3 mb s3://mis-fotos-2026')).stdout).toBe('make_bucket: mis-fotos-2026\n');
    const ls = await e.run('s3 ls');
    expect(ls.stdout).toMatch(/^2026-03-14 \d\d:\d\d:\d\d mis-fotos-2026\n$/);
    expect((await e.run('s3 rb s3://mis-fotos-2026')).stdout).toBe('remove_bucket: mis-fotos-2026\n');
    expect((await e.run('s3 ls')).stdout).toBe('');
  });

  test('nombres inválidos, repetidos y ya usados en el mundo', async () => {
    const e = mkEnv();
    const bad = await e.run('s3 mb s3://MiBucket');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('InvalidBucketName');
    const taken = await e.run('s3 mb s3://test');
    expect(taken.stderr).toContain('(BucketAlreadyExists)');
    await e.run('s3 mb s3://propio-123');
    expect((await e.run('s3 mb s3://propio-123')).stderr).toContain('BucketAlreadyOwnedByYou');
    expect((await e.run('s3 mb s3://ab')).stderr).toContain('InvalidBucketName');
  });

  test('fuera de us-east-1 se necesita la región', async () => {
    const e = mkEnv({ region: 'eu-west-1' });
    const r = await e.run('s3api create-bucket --bucket euro-datos');
    expect(r.stderr).toContain('IllegalLocationConstraintException');
    const ok = await e.json('s3api create-bucket --bucket euro-datos --create-bucket-configuration LocationConstraint=eu-west-1');
    expect(ok.Location).toBe('http://euro-datos.s3.amazonaws.com/');
    expect((await e.json('s3api get-bucket-location --bucket euro-datos')).LocationConstraint).toBe('eu-west-1');
    // y desde la CLI de alto nivel
    expect((await e.run('s3 mb s3://euro-datos-2')).stdout).toContain('make_bucket');
    const u = mkEnv();
    await u.run('s3 mb s3://virginia-1');
    expect((await u.json('s3api get-bucket-location --bucket virginia-1')).LocationConstraint).toBeNull();
  });

  test('un bucket nuevo trae Block Public Access, cifrado y sin versionado', async () => {
    const e = mkEnv();
    await e.run('s3 mb s3://nuevo-1');
    const pab = await e.json('s3api get-public-access-block --bucket nuevo-1');
    expect(pab.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true });
    const enc = await e.json('s3api get-bucket-encryption --bucket nuevo-1');
    expect(enc.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm).toBe('AES256');
    expect(await e.json('s3api get-bucket-versioning --bucket nuevo-1')).toEqual({});
    const acl = await e.run('s3api put-bucket-acl --bucket nuevo-1 --acl public-read');
    expect(acl.stderr).toContain('AccessControlListNotSupported');
  });

  test('rb con objetos exige --force', async () => {
    const e = mkEnv({}, { 'a.txt': 'hola' });
    await e.run('s3 mb s3://con-datos');
    await e.run('s3 cp a.txt s3://con-datos/');
    const r = await e.run('s3 rb s3://con-datos');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('(BucketNotEmpty)');
    const f = await e.run('s3 rb s3://con-datos --force');
    expect(f.stdout).toBe('delete: s3://con-datos/a.txt\nremove_bucket: con-datos\n');
  });
});

describe('S3: objetos con cp, ls y rm', () => {
  test('subir, listar, bajar y borrar', async () => {
    const e = mkEnv({}, { 'notas.txt': 'una nota\n', 'fotos/gato.jpg': 'JPEGDATA', 'fotos/perro.jpg': 'JPEG2' });
    await e.run('s3 mb s3://mi-nube-1');
    const up = await e.run('s3 cp notas.txt s3://mi-nube-1/');
    expect(up.stdout).toBe('upload: ./notas.txt to s3://mi-nube-1/notas.txt\n');
    const up2 = await e.run('s3 cp fotos s3://mi-nube-1/fotos --recursive');
    expect(lines(up2.stdout)).toEqual(['upload: fotos/gato.jpg to s3://mi-nube-1/fotos/gato.jpg', 'upload: fotos/perro.jpg to s3://mi-nube-1/fotos/perro.jpg']);

    const ls = await e.run('s3 ls s3://mi-nube-1/');
    expect(ls.stdout).toMatch(/ +PRE fotos\/\n2026-03-14 \d\d:\d\d:\d\d +9 notas\.txt\n/);
    const lr = await e.run('s3 ls s3://mi-nube-1 --recursive --summarize');
    expect(lr.stdout).toContain('fotos/gato.jpg');
    expect(lr.stdout).toContain('Total Objects: 3');
    expect(lr.stdout).toContain('Total Size: 22');
    expect((await e.run('s3 ls s3://mi-nube-1/fotos/ --human-readable')).stdout).toContain('8 Bytes gato.jpg');

    const down = await e.run('s3 cp s3://mi-nube-1/notas.txt copia.txt');
    expect(down.stdout).toBe('download: s3://mi-nube-1/notas.txt to ./copia.txt\n');
    expect(e.files.get('/home/alumno/copia.txt')).toBe('una nota\n');
    expect((await e.run('s3 cp s3://mi-nube-1/nada.txt .')).stderr).toContain('(404) when calling the HeadObject operation');

    const rm = await e.run('s3 rm s3://mi-nube-1/notas.txt');
    expect(rm.stdout).toBe('delete: s3://mi-nube-1/notas.txt\n');
    const rmr = await e.run('s3 rm s3://mi-nube-1/fotos/ --recursive');
    expect(lines(rmr.stdout)).toHaveLength(2);
    expect((await e.run('s3 ls s3://mi-nube-1')).stdout).toBe('');
  });

  test('archivo inexistente, exclude/include y dryrun', async () => {
    const e = mkEnv({}, { 'd/a.log': 'x', 'd/b.txt': 'y', 'd/c.txt': 'z' });
    await e.run('s3 mb s3://filtros-1');
    const no = await e.run('s3 cp nada.txt s3://filtros-1/');
    expect(no.stderr).toContain('The user-provided path nada.txt does not exist.');
    const dry = await e.run('s3 cp d s3://filtros-1/d --recursive --dryrun');
    expect(dry.stdout).toContain('(dryrun) upload:');
    expect((await e.run('s3 ls s3://filtros-1')).stdout).toBe('');
    const f = await e.run('s3 cp d s3://filtros-1/d --recursive --exclude "*" --include "*.txt"');
    expect(lines(f.stdout)).toHaveLength(2);
    expect((await e.run('s3 ls s3://filtros-1/d/')).stdout).not.toContain('a.log');
  });

  test('s3 cp entre buckets, mv y stdin/stdout', async () => {
    const e = mkEnv({}, { 'x.txt': 'contenido' });
    await e.run('s3 mb s3://origen-1');
    await e.run('s3 mb s3://destino-1');
    await e.run('s3 cp x.txt s3://origen-1/x.txt');
    expect((await e.run('s3 cp s3://origen-1/x.txt s3://destino-1/y.txt')).stdout).toBe('copy: s3://origen-1/x.txt to s3://destino-1/y.txt\n');
    expect((await e.run('s3 mv s3://destino-1/y.txt s3://destino-1/z.txt')).stdout).toBe('move: s3://destino-1/y.txt to s3://destino-1/z.txt\n');
    expect((await e.run('s3 ls s3://destino-1/')).stdout).toContain('z.txt');
    expect((await e.run('s3 ls s3://destino-1/')).stdout).not.toContain('y.txt');
    expect((await e.run('s3 cp s3://origen-1/x.txt -')).stdout).toBe('contenido');
    const m = await e.run('s3 mv x.txt s3://destino-1/subido.txt');
    expect(m.stdout).toBe('move: ./x.txt to s3://destino-1/subido.txt\n');
    expect(e.files.has('/home/alumno/x.txt')).toBe(false);
  });

  test('sync solo transfiere lo nuevo o cambiado', async () => {
    const e = mkEnv({}, { 'web/index.html': '<h1>hola</h1>', 'web/css/s.css': 'body{}' });
    await e.run('s3 mb s3://sitio-1');
    const first = await e.run('s3 sync web s3://sitio-1/');
    expect(lines(first.stdout)).toHaveLength(2);
    expect((await e.run('s3 sync web s3://sitio-1/')).stdout).toBe('');
    e.acct.clock += 60000;
    e.write('web/index.html', '<h1>hola mundo</h1>');
    e.acct.clock += 1000;
    const again = await e.run('s3 sync web s3://sitio-1/');
    expect(lines(again.stdout)).toEqual(['upload: web/index.html to s3://sitio-1/index.html']);
    e.files.delete('/home/alumno/web/css/s.css');
    const del = await e.run('s3 sync web s3://sitio-1/ --delete');
    expect(del.stdout).toBe('delete: s3://sitio-1/css/s.css\n');
    // al revés: bajar
    const dl = await e.run('s3 sync s3://sitio-1/ copia');
    expect(lines(dl.stdout)).toEqual(['download: s3://sitio-1/index.html to copia/index.html']);
  });

  test('permisos: un desarrollador solo lee', async () => {
    const e = mkEnv({ scenario: 'equipo' }, { 'a.txt': 'hola' });
    await e.run('s3 mb s3://equipo-1');
    await e.run('s3 cp a.txt s3://equipo-1/a.txt');
    const ls = await e.run('s3 ls s3://equipo-1/ --profile ana');
    expect(ls.code).toBe(0);
    expect(ls.stdout).toContain('a.txt');
    const up = await e.run('s3 cp a.txt s3://equipo-1/b.txt --profile ana');
    expect(up.code).toBe(1);
    expect(up.stderr).toContain('upload failed: ./a.txt to s3://equipo-1/b.txt An error occurred (AccessDenied) when calling the PutObject operation: Access Denied');
    const mb = await e.run('s3 mb s3://ana-nuevo --profile ana');
    expect(mb.stderr).toContain('make_bucket failed: s3://ana-nuevo');
  });

  test('presign', async () => {
    const e = mkEnv({}, { 'a.txt': 'hola' });
    await e.run('s3 mb s3://firmado-1');
    await e.run('s3 cp a.txt s3://firmado-1/a.txt');
    const r = await e.run('s3 presign s3://firmado-1/a.txt --expires-in 600');
    expect(r.stdout).toMatch(/^https:\/\/firmado-1\.s3\.amazonaws\.com\/a\.txt\?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA/);
    expect(r.stdout).toContain('X-Amz-Expires=600');
    expect(r.stdout).toMatch(/X-Amz-Signature=[0-9a-f]{64}\n$/);
  });

  test('glacier no se puede descargar sin restaurar', async () => {
    const e = mkEnv({}, { 'old.txt': 'viejo' });
    await e.run('s3 mb s3://frio-1');
    await e.run('s3 cp old.txt s3://frio-1/old.txt --storage-class GLACIER');
    const r = await e.run('s3 cp s3://frio-1/old.txt .');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Object is of storage class GLACIER');
  });
});

describe('S3: s3api', () => {
  test('put-object, get-object, head-object, list-objects-v2 y --query', async () => {
    const e = mkEnv({}, { 'datos.csv': 'a,b\n1,2\n' });
    await e.run('s3api create-bucket --bucket api-1');
    const put = await e.json('s3api put-object --bucket api-1 --key informes/datos.csv --body datos.csv');
    expect(put.ETag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(put.ServerSideEncryption).toBe('AES256');
    const head = await e.json('s3api head-object --bucket api-1 --key informes/datos.csv');
    expect(head.ContentLength).toBe(8);
    expect(head.ContentType).toBe('binary/octet-stream');
    const list = await e.json('s3api list-objects-v2 --bucket api-1 --prefix informes/');
    expect(list.Contents[0].Key).toBe('informes/datos.csv');
    expect(list.Contents[0].Size).toBe(8);
    expect((await e.run('s3api list-objects-v2 --bucket api-1 --query "Contents[].Key" --output text')).stdout).toBe('informes/datos.csv\n');
    const dl = await e.json('s3api get-object --bucket api-1 --key informes/datos.csv salida.csv');
    expect(dl.ContentLength).toBe(8);
    expect(e.files.get('/home/alumno/salida.csv')).toBe('a,b\n1,2\n');
    const miss = await e.run('s3api get-object --bucket api-1 --key nada salida2');
    expect(miss.stderr).toContain('(NoSuchKey) when calling the GetObject operation: The specified key does not exist.');
    const nb = await e.run('s3api list-objects-v2 --bucket no-existe');
    expect(nb.stderr).toContain('(NoSuchBucket) when calling the ListObjectsV2 operation: The specified bucket does not exist');
    const hm = await e.run('s3api head-object --bucket api-1 --key nada');
    expect(hm.stderr).toContain('(404) when calling the HeadObject operation: Not Found');
  });

  test('delimitador y prefijos comunes', async () => {
    const e = mkEnv({}, { 'f': 'x' });
    await e.run('s3api create-bucket --bucket dir-1');
    for (const k of ['a/1.txt', 'a/2.txt', 'b/3.txt', 'raiz.txt']) await e.run(`s3api put-object --bucket dir-1 --key ${k} --body f`);
    const r = await e.json('s3api list-objects-v2 --bucket dir-1 --delimiter /');
    expect(r.CommonPrefixes.map((p: any) => p.Prefix)).toEqual(['a/', 'b/']);
    expect(r.Contents.map((o: any) => o.Key)).toEqual(['raiz.txt']);
  });

  test('versionado: marcadores de borrado y versiones', async () => {
    const e = mkEnv({}, { 'v1.txt': 'uno', 'v2.txt': 'dos' });
    await e.run('s3api create-bucket --bucket vers-1');
    await e.run('s3api put-bucket-versioning --bucket vers-1 --versioning-configuration Status=Enabled');
    expect((await e.json('s3api get-bucket-versioning --bucket vers-1')).Status).toBe('Enabled');
    const p1 = await e.json('s3api put-object --bucket vers-1 --key doc --body v1.txt');
    const p2 = await e.json('s3api put-object --bucket vers-1 --key doc --body v2.txt');
    expect(p1.VersionId).toBeTruthy();
    expect(p1.VersionId).not.toBe(p2.VersionId);
    const del = await e.json('s3api delete-object --bucket vers-1 --key doc');
    expect(del.DeleteMarker).toBe(true);
    expect((await e.run('s3api get-object --bucket vers-1 --key doc out')).stderr).toContain('NoSuchKey');
    const vs = await e.json('s3api list-object-versions --bucket vers-1');
    expect(vs.Versions).toHaveLength(2);
    expect(vs.DeleteMarkers).toHaveLength(1);
    // recuperar: borrar el marcador
    await e.run(`s3api delete-object --bucket vers-1 --key doc --version-id ${del.VersionId}`);
    const back = await e.json('s3api get-object --bucket vers-1 --key doc out');
    expect(back.VersionId).toBe(p2.VersionId);
    expect(e.files.get('/home/alumno/out')).toBe('dos');
    // una versión antigua sigue accesible
    await e.run(`s3api get-object --bucket vers-1 --key doc --version-id ${p1.VersionId} viejo`);
    expect(e.files.get('/home/alumno/viejo')).toBe('uno');
    // el bucket con versiones no se puede borrar
    expect((await e.run('s3api delete-bucket --bucket vers-1')).stderr).toContain('BucketNotEmpty');
  });

  test('delete-objects y copy-object', async () => {
    const e = mkEnv({}, { 'f': 'x' });
    await e.run('s3api create-bucket --bucket multi-1');
    for (const k of ['a', 'b', 'c']) await e.run(`s3api put-object --bucket multi-1 --key ${k} --body f`);
    const cp = await e.json('s3api copy-object --bucket multi-1 --key copia --copy-source multi-1/a');
    expect(cp.CopyObjectResult.ETag).toBeTruthy();
    const del = await e.json(`s3api delete-objects --bucket multi-1 --delete 'Objects=[{Key=a},{Key=b}],Quiet=false'`);
    expect(del.Deleted.map((d: any) => d.Key)).toEqual(['a', 'b']);
    expect(await e.json('s3api list-objects-v2 --bucket multi-1 --query "Contents[].Key"')).toEqual(['c', 'copia']);
  });

  test('ACL no permitidas y SSE', async () => {
    const e = mkEnv({}, { 'f': 'x' });
    await e.run('s3api create-bucket --bucket acl-1');
    const r = await e.run('s3api put-object --bucket acl-1 --key k --body f --acl public-read');
    expect(r.stderr).toContain('AccessControlListNotSupported');
    const kms = await e.json('s3api put-object --bucket acl-1 --key k --body f --server-side-encryption aws:kms');
    expect(kms.ServerSideEncryption).toBe('aws:kms');
    expect(kms.SSEKMSKeyId).toMatch(/:key\//); // la clave administrada por AWS (alias/aws/s3)
  });
});

describe('S3: políticas y configuración', () => {
  const PUBLIC = JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'Publico', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::pol-1/*' }] });

  test('una política pública se bloquea mientras BlockPublicPolicy esté activo', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket pol-1');
    const r = await e.run(`s3api put-bucket-policy --bucket pol-1 --policy '${PUBLIC}'`);
    expect(r.stderr).toContain('because public policies are blocked by the BlockPublicPolicy block public access setting');
    await e.run('s3api put-public-access-block --bucket pol-1 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false');
    expect((await e.run(`s3api put-bucket-policy --bucket pol-1 --policy '${PUBLIC}'`)).code).toBe(0);
    const got = await e.json('s3api get-bucket-policy --bucket pol-1');
    expect(typeof got.Policy).toBe('string');
    expect(JSON.parse(got.Policy).Statement[0].Sid).toBe('Publico');
    expect((await e.json('s3api get-bucket-policy-status --bucket pol-1')).PolicyStatus.IsPublic).toBe(true);
    await e.run('s3api delete-bucket-policy --bucket pol-1');
    expect((await e.run('s3api get-bucket-policy --bucket pol-1')).stderr).toContain('NoSuchBucketPolicy');
  });

  test('una política de bucket puede dar acceso a un usuario sin permisos propios', async () => {
    const e = mkEnv({ scenario: 'equipo' }, { 'f': 'x' });
    await e.run('s3api create-bucket --bucket compartido-1');
    await e.run('s3api put-object --bucket compartido-1 --key k --body f');
    // bob está en desarrolladores (lee S3), pero a un usuario sin nada…
    await e.run('iam create-user --user-name dani');
    const key = await e.json('iam create-access-key --user-name dani');
    e.files.set('/home/alumno/.aws/credentials', e.files.get('/home/alumno/.aws/credentials') + `\n[dani]\naws_access_key_id = ${key.AccessKey.AccessKeyId}\naws_secret_access_key = ${key.AccessKey.SecretAccessKey}\n`);
    expect((await e.run('s3 ls s3://compartido-1 --profile dani')).code).toBe(254);
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:user/dani' }, Action: ['s3:ListBucket'], Resource: 'arn:aws:s3:::compartido-1' }] });
    await e.run(`s3api put-bucket-policy --bucket compartido-1 --policy '${pol}'`);
    expect((await e.run('s3 ls s3://compartido-1 --profile dani')).code).toBe(0);
    // pero leer objetos no está permitido
    expect((await e.run('s3 cp s3://compartido-1/k . --profile dani')).code).toBe(1);
  });

  test('un Deny en la política del bucket gana', async () => {
    const e = mkEnv({}, { 'f': 'x' });
    await e.run('s3api create-bucket --bucket deny-1');
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Deny', Principal: '*', Action: 's3:PutObject', Resource: 'arn:aws:s3:::deny-1/*', Condition: { StringNotEquals: { 's3:x-amz-server-side-encryption': 'aws:kms' } } }] });
    await e.run(`s3api put-bucket-policy --bucket deny-1 --policy '${pol}'`);
    // la política pública (Deny) no se bloquea porque solo se bloquean los Allow públicos
    const r = await e.run('s3api put-object --bucket deny-1 --key k --body f');
    expect(r.stderr).toContain('AccessDenied');
    const ok = await e.run('s3api put-object --bucket deny-1 --key k --body f --server-side-encryption aws:kms');
    expect(ok.code).toBe(0);
  });

  test('ciclo de vida, etiquetas, web estática y cifrado', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket cfg-1');
    const lc = JSON.stringify({ Rules: [{ ID: 'archivar', Status: 'Enabled', Filter: { Prefix: 'logs/' }, Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }, { Days: 90, StorageClass: 'GLACIER' }], Expiration: { Days: 365 } }] });
    expect((await e.run(`s3api put-bucket-lifecycle-configuration --bucket cfg-1 --lifecycle-configuration '${lc}'`)).code).toBe(0);
    expect((await e.json('s3api get-bucket-lifecycle-configuration --bucket cfg-1 --query "Rules[0].Transitions[].StorageClass"'))).toEqual(['STANDARD_IA', 'GLACIER']);
    const bad = JSON.stringify({ Rules: [{ ID: 'mal', Status: 'Enabled', Filter: { Prefix: '' }, Transitions: [{ Days: 7, StorageClass: 'STANDARD_IA' }] }] });
    expect((await e.run(`s3api put-bucket-lifecycle-configuration --bucket cfg-1 --lifecycle-configuration '${bad}'`)).stderr).toContain('must be 30 days or more');
    const bad2 = JSON.stringify({ Rules: [{ ID: 'mal2', Status: 'Enabled', Filter: { Prefix: '' }, Transitions: [{ Days: 90, StorageClass: 'GLACIER' }], Expiration: { Days: 30 } }] });
    expect((await e.run(`s3api put-bucket-lifecycle-configuration --bucket cfg-1 --lifecycle-configuration '${bad2}'`)).stderr).toContain("greater than 'Days' in the Transition");
    await e.run('s3api put-bucket-tagging --bucket cfg-1 --tagging "TagSet=[{Key=entorno,Value=prueba}]"');
    expect(await e.json('s3api get-bucket-tagging --bucket cfg-1')).toEqual({ TagSet: [{ Key: 'entorno', Value: 'prueba' }] });
    await e.run('s3 website s3://cfg-1/ --index-document index.html --error-document error.html');
    expect((await e.json('s3api get-bucket-website --bucket cfg-1')).IndexDocument.Suffix).toBe('index.html');
    const kms = JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms' }, BucketKeyEnabled: true }] });
    await e.run(`s3api put-bucket-encryption --bucket cfg-1 --server-side-encryption-configuration '${kms}'`);
    expect((await e.json('s3api get-bucket-encryption --bucket cfg-1 --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm"'))).toBe('aws:kms');
  });

  test('replicación necesita versionado en los dos buckets', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket rep-origen');
    await e.run('s3api create-bucket --bucket rep-destino');
    const cfg = JSON.stringify({ Role: 'arn:aws:iam::123456789012:role/rep', Rules: [{ Status: 'Enabled', Priority: 1, Filter: {}, Destination: { Bucket: 'arn:aws:s3:::rep-destino' } }] });
    expect((await e.run(`s3api put-bucket-replication --bucket rep-origen --replication-configuration '${cfg}'`)).stderr).toContain("Versioning must be 'Enabled'");
    await e.run('s3api put-bucket-versioning --bucket rep-origen --versioning-configuration Status=Enabled');
    expect((await e.run(`s3api put-bucket-replication --bucket rep-origen --replication-configuration '${cfg}'`)).stderr).toContain('Destination bucket must have versioning enabled');
    await e.run('s3api put-bucket-versioning --bucket rep-destino --versioning-configuration Status=Enabled');
    expect((await e.run(`s3api put-bucket-replication --bucket rep-origen --replication-configuration '${cfg}'`)).code).toBe(0);
  });
});
