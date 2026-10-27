import { b64decode, b64encode } from '../../engine/commands/hash';
import { mkEnv, type TestEnv } from './helpers';

const RAW = '--cli-binary-format raw-in-base64-out';
const b64 = (s: string) => b64encode(s);
const un64 = (s: string) => b64decode(s) ?? '';
const day = (e: TestEnv, n: number) => {
  e.acct.clock += n * 86400000;
};

async function newKey(e: TestEnv, extra = '') {
  return (await e.json(`kms create-key --description prueba ${extra}`)).KeyMetadata as { KeyId: string; Arn: string };
}

describe('KMS: claves y alias', () => {
  test('crear, describir, alias y política por defecto', async () => {
    const e = mkEnv();
    const k = await newKey(e);
    expect(k.Arn).toBe(`arn:aws:kms:us-east-1:123456789012:key/${k.KeyId}`);
    const d = (await e.json(`kms describe-key --key-id ${k.KeyId}`)).KeyMetadata;
    expect(d).toMatchObject({ KeyState: 'Enabled', KeyUsage: 'ENCRYPT_DECRYPT', KeySpec: 'SYMMETRIC_DEFAULT', KeyManager: 'CUSTOMER', Enabled: true, Description: 'prueba' });
    const pol = JSON.parse((await e.json(`kms get-key-policy --key-id ${k.KeyId} --policy-name default`)).Policy);
    expect(pol.Statement[0]).toMatchObject({ Sid: 'Enable IAM User Permissions', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'kms:*' });
    await e.run(`kms create-alias --alias-name alias/tienda --target-key-id ${k.KeyId}`);
    expect((await e.json('kms describe-key --key-id alias/tienda')).KeyMetadata.KeyId).toBe(k.KeyId);
    expect((await e.json('kms list-aliases')).Aliases.map((a: { AliasName: string }) => a.AliasName)).toEqual(['alias/tienda']);
    expect((await e.run(`kms create-alias --alias-name alias/tienda --target-key-id ${k.KeyId}`)).stderr).toContain('AlreadyExistsException');
    expect((await e.run(`kms create-alias --alias-name tienda --target-key-id ${k.KeyId}`)).stderr).toContain('must start with the prefix "alias/"');
    expect((await e.run(`kms create-alias --alias-name alias/aws/s3 --target-key-id ${k.KeyId}`)).stderr).toContain('alias/aws/');
    const k2 = await newKey(e);
    await e.run(`kms update-alias --alias-name alias/tienda --target-key-id ${k2.KeyId}`);
    expect((await e.json('kms describe-key --key-id alias/tienda')).KeyMetadata.KeyId).toBe(k2.KeyId);
    expect((await e.run('kms describe-key --key-id alias/nada')).stderr).toContain('NotFoundException');
    expect((await e.json('kms list-keys')).Keys).toHaveLength(2);
    await e.run(`kms tag-resource --key-id ${k.KeyId} --tags TagKey=equipo,TagValue=pagos`);
    expect((await e.json(`kms list-resource-tags --key-id ${k.KeyId}`)).Tags).toEqual([{ TagKey: 'equipo', TagValue: 'pagos' }]);
  });

  test('validaciones de create-key', async () => {
    const e = mkEnv();
    expect((await e.run('kms create-key --key-spec RSA_9999')).stderr).toContain('ValidationException');
    expect((await e.run('kms create-key --key-spec SYMMETRIC_DEFAULT --key-usage SIGN_VERIFY')).stderr).toContain('incompatible');
    expect((await e.run('kms create-key --policy "no json"')).stderr).toContain('MalformedPolicyDocumentException');
  });
});

describe('KMS: cifrar y descifrar', () => {
  test('ida y vuelta, formato base64 y contexto de cifrado', async () => {
    const e = mkEnv();
    const k = await newKey(e);
    const c1 = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext "hola mundo" ${RAW} --encryption-context proyecto=tienda`);
    expect(c1.KeyId).toBe(k.Arn);
    expect(c1.CiphertextBlob).not.toContain('hola');
    const ok = await e.json(`kms decrypt --ciphertext-blob ${c1.CiphertextBlob} --encryption-context proyecto=tienda`);
    expect(un64(ok.Plaintext)).toBe('hola mundo');
    expect(ok.KeyId).toBe(k.Arn);
    // sin el contexto, o con otro, no se abre
    expect((await e.run(`kms decrypt --ciphertext-blob ${c1.CiphertextBlob}`)).stderr).toContain('InvalidCiphertextException');
    expect((await e.run(`kms decrypt --ciphertext-blob ${c1.CiphertextBlob} --encryption-context proyecto=otro`)).stderr).toContain('InvalidCiphertextException');
    // con la clave que no es
    const k2 = await newKey(e);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c1.CiphertextBlob} --encryption-context proyecto=tienda --key-id ${k2.KeyId}`)).stderr).toContain('IncorrectKeyException');
    // por defecto el texto en claro va en base64
    const c2 = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext ${b64('secreto ñ')}`);
    expect(un64((await e.json(`kms decrypt --ciphertext-blob ${c2.CiphertextBlob}`)).Plaintext)).toBe('secreto ñ');
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext "texto con espacios"`)).stderr).toContain('Invalid base64');
    expect((await e.run(`kms decrypt --ciphertext-blob basura`)).stderr).toContain('InvalidCiphertextException');
    // un archivo con el blob binario
    e.write('c.b64', c2.CiphertextBlob);
    expect((await e.run('kms decrypt --ciphertext-blob fileb://c.b64')).code).toBe(0);
    const big = 'x'.repeat(5000);
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext ${big} ${RAW}`)).stderr).toContain('4096');
  });

  test('re-encrypt cambia de clave', async () => {
    const e = mkEnv();
    const k1 = await newKey(e);
    const k2 = await newKey(e);
    const c = await e.json(`kms encrypt --key-id ${k1.KeyId} --plaintext datos ${RAW}`);
    const r = await e.json(`kms re-encrypt --ciphertext-blob ${c.CiphertextBlob} --destination-key-id ${k2.KeyId}`);
    expect(r).toMatchObject({ SourceKeyId: k1.Arn, KeyId: k2.Arn });
    const d = await e.json(`kms decrypt --ciphertext-blob ${r.CiphertextBlob}`);
    expect(d.KeyId).toBe(k2.Arn);
    expect(un64(d.Plaintext)).toBe('datos');
  });

  test('cifrado de sobre: la clave de datos', async () => {
    const e = mkEnv();
    const k = await newKey(e);
    const dk = await e.json(`kms generate-data-key --key-id ${k.KeyId} --key-spec AES_256`);
    expect(un64(dk.Plaintext)).toHaveLength(32);
    expect((await e.json(`kms decrypt --ciphertext-blob ${dk.CiphertextBlob}`)).Plaintext).toBe(dk.Plaintext);
    const sin = await e.json(`kms generate-data-key-without-plaintext --key-id ${k.KeyId} --number-of-bytes 16`);
    expect(sin.Plaintext).toBeUndefined();
    expect(un64((await e.json(`kms decrypt --ciphertext-blob ${sin.CiphertextBlob}`)).Plaintext)).toHaveLength(16);
    expect((await e.run(`kms generate-data-key --key-id ${k.KeyId}`)).stderr).toContain('Either KeySpec or NumberOfBytes');
    expect((await e.run(`kms generate-data-key --key-id ${k.KeyId} --key-spec AES_256 --number-of-bytes 5`)).stderr).toContain('cannot be specified together');
    expect(un64((await e.json('kms generate-random --number-of-bytes 24')).Plaintext)).toHaveLength(24);
  });

  test('firmar y verificar con una clave asimétrica', async () => {
    const e = mkEnv();
    const k = await newKey(e, '--key-spec RSA_2048 --key-usage SIGN_VERIFY');
    const s = await e.json(`kms sign --key-id ${k.KeyId} --message "contrato" ${RAW} --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256`);
    expect((await e.json(`kms verify --key-id ${k.KeyId} --message contrato ${RAW} --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 --signature ${s.Signature}`)).SignatureValid).toBe(true);
    expect((await e.run(`kms verify --key-id ${k.KeyId} --message otro ${RAW} --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 --signature ${s.Signature}`)).stderr).toContain('KMSInvalidSignatureException');
    const sym = await newKey(e);
    expect((await e.run(`kms sign --key-id ${sym.KeyId} --message x ${RAW} --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256`)).stderr).toContain('InvalidKeyUsageException');
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW}`)).stderr).toContain('InvalidKeyUsageException');
  });
});

describe('KMS: estados, borrado y rotación', () => {
  test('deshabilitar y borrado programado', async () => {
    const e = mkEnv();
    const k = await newKey(e);
    const c = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW}`);
    await e.run(`kms disable-key --key-id ${k.KeyId}`);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob}`)).stderr).toContain('DisabledException');
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW}`)).stderr).toContain('is disabled');
    await e.run(`kms enable-key --key-id ${k.KeyId}`);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob}`)).code).toBe(0);
    expect((await e.run(`kms schedule-key-deletion --key-id ${k.KeyId} --pending-window-in-days 3`)).stderr).toContain('greater than or equal to 7');
    const del = await e.json(`kms schedule-key-deletion --key-id ${k.KeyId} --pending-window-in-days 7`);
    expect(del).toMatchObject({ KeyState: 'PendingDeletion', PendingWindowInDays: 7 });
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob}`)).stderr).toContain('pending deletion');
    expect((await e.run(`kms enable-key --key-id ${k.KeyId}`)).stderr).toContain('pending deletion');
    // cancelar deja la clave deshabilitada
    await e.run(`kms cancel-key-deletion --key-id ${k.KeyId}`);
    expect((await e.json(`kms describe-key --key-id ${k.KeyId}`)).KeyMetadata.KeyState).toBe('Disabled');
    await e.run(`kms enable-key --key-id ${k.KeyId}`);
    await e.run(`kms create-alias --alias-name alias/x --target-key-id ${k.KeyId}`);
    await e.run(`kms schedule-key-deletion --key-id ${k.KeyId} --pending-window-in-days 7`);
    day(e, 8);
    expect((await e.run(`kms describe-key --key-id ${k.KeyId}`)).stderr).toContain('NotFoundException');
    expect((await e.json('kms list-aliases')).Aliases).toEqual([]);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob}`)).stderr).toContain('NotFoundException');
  });

  test('rotación automática y a demanda: lo antiguo se sigue abriendo', async () => {
    const e = mkEnv();
    const k = await newKey(e);
    const old = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext viejo ${RAW}`);
    expect((await e.json(`kms get-key-rotation-status --key-id ${k.KeyId}`)).KeyRotationEnabled).toBe(false);
    expect((await e.run(`kms enable-key-rotation --key-id ${k.KeyId} --rotation-period-in-days 30`)).stderr).toContain('between 90 and 2560');
    await e.run(`kms enable-key-rotation --key-id ${k.KeyId}`);
    const st = await e.json(`kms get-key-rotation-status --key-id ${k.KeyId}`);
    expect(st).toMatchObject({ KeyRotationEnabled: true, RotationPeriodInDays: 365 });
    const fresh1 = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext nuevo ${RAW}`);
    day(e, 400);
    await e.run('sts get-caller-identity');
    const fresh2 = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext nuevo ${RAW}`);
    // el texto cifrado con el material nuevo es distinto, y todo se abre
    expect(fresh2.CiphertextBlob).not.toBe(fresh1.CiphertextBlob);
    for (const c of [old, fresh1, fresh2]) expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob}`)).code).toBe(0);
    expect((await e.json(`kms get-key-rotation-status --key-id ${k.KeyId}`)).NextRotationDate).toBeTruthy();
    expect((await e.json(`kms rotate-key-on-demand --key-id ${k.KeyId}`)).KeyId).toBe(k.Arn);
    await e.run(`kms disable-key-rotation --key-id ${k.KeyId}`);
    expect((await e.json(`kms get-key-rotation-status --key-id ${k.KeyId}`)).KeyRotationEnabled).toBe(false);
    const asym = await newKey(e, '--key-spec RSA_2048 --key-usage SIGN_VERIFY');
    expect((await e.run(`kms enable-key-rotation --key-id ${asym.KeyId}`)).stderr).toContain('UnsupportedOperationException');
  });
});

describe('KMS: quién puede usar la clave', () => {
  const policy = (statements: unknown[]) => JSON.stringify({ Version: '2012-10-17', Statement: statements });
  const ROOT = 'arn:aws:iam::123456789012:root';
  const ALUMNO = 'arn:aws:iam::123456789012:user/alumno';
  const BOB = 'arn:aws:iam::123456789012:user/bob';
  const ALLOW_ALL = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'kms:*', Resource: '*' }] };
  const as = (who: string) => `--profile ${who}`;

  test('con IAM habilitado en la clave hace falta además el permiso de identidad', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const k = await newKey(e);
    const c = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW}`);
    // bob no tiene ningún permiso de KMS en IAM
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} ${as('bob')}`)).stderr).toContain(`User: ${BOB} is not authorized to perform: kms:Decrypt on resource: ${k.Arn} because no identity-based policy allows the kms:Decrypt action`);
    e.write('p.json', JSON.stringify(ALLOW_ALL));
    await e.run('iam put-user-policy --user-name bob --policy-name kms --policy-document file://p.json');
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} ${as('bob')}`)).code).toBe(0);
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW} ${as('bob')}`)).code).toBe(0);
  });

  test('una política de clave sin la cuenta no deja entrar ni al administrador de IAM', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const pol = policy([
      { Sid: 'Admin', Effect: 'Allow', Principal: { AWS: ALUMNO }, Action: 'kms:*', Resource: '*' },
      { Sid: 'Bob descifra', Effect: 'Allow', Principal: { AWS: BOB }, Action: 'kms:Decrypt', Resource: '*' },
    ]);
    const k = await newKey(e, `--policy '${pol}'`);
    const c = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW}`);
    // bob, aunque no tenga permisos en IAM, descifra porque la política lo nombra; cifrar no
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} ${as('bob')}`)).code).toBe(0);
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW} ${as('bob')}`)).stderr).toContain('because no resource-based policy allows the kms:Encrypt action');
    // carla es administradora de IAM, pero la clave no delega en IAM
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} ${as('carla')}`)).stderr).toContain('no resource-based policy allows the kms:Decrypt action');
    // las claves de otros no se ven: describe-key también pide permiso
    expect((await e.run(`kms describe-key --key-id ${k.KeyId} ${as('carla')}`)).stderr).toContain('AccessDeniedException');
  });

  test('condiciones sobre el contexto de cifrado y denegaciones explícitas', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const pol = policy([
      { Sid: 'Admin', Effect: 'Allow', Principal: { AWS: [ALUMNO, ROOT] }, Action: 'kms:*', Resource: '*' },
      { Sid: 'Solo tienda', Effect: 'Allow', Principal: { AWS: BOB }, Action: ['kms:Decrypt', 'kms:Encrypt'], Resource: '*', Condition: { StringEquals: { 'kms:EncryptionContext:proyecto': 'tienda' } } },
    ]);
    const k = await newKey(e, `--policy '${pol}'`);
    const c = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW} --encryption-context proyecto=tienda`);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} --encryption-context proyecto=tienda ${as('bob')}`)).code).toBe(0);
    // otro contexto: KMS ni siquiera llega a abrirlo, la política lo corta antes
    const c2 = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW} --encryption-context proyecto=rrhh`);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c2.CiphertextBlob} --encryption-context proyecto=rrhh ${as('bob')}`)).stderr).toContain('AccessDeniedException');
    // un Deny en IAM gana a todo
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: 'kms:Decrypt', Resource: '*' }] }));
    await e.run('iam put-user-policy --user-name bob --policy-name no --policy-document file://p.json');
    expect((await e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} --encryption-context proyecto=tienda ${as('bob')}`)).stderr).toContain('with an explicit deny in an identity-based policy');
  });

  test('la política nueva no puede dejar a quien la cambia sin acceso', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const k = await newKey(e);
    const solo = policy([{ Effect: 'Allow', Principal: { AWS: BOB }, Action: 'kms:*', Resource: '*' }]);
    e.write('solo-bob.json', solo);
    expect((await e.run(`kms put-key-policy --key-id ${k.KeyId} --policy-name default --policy file://solo-bob.json`)).stderr).toContain('will not allow you to update the key policy in the future');
    expect((await e.run(`kms create-key --policy '${solo}'`)).stderr).toContain('will not allow you to update the key policy');
    expect((await e.run(`kms put-key-policy --key-id ${k.KeyId} --policy-name default --policy file://solo-bob.json --bypass-policy-lockout-safety-check`)).code).toBe(0);
    // ahora el administrador de IAM ya no puede ni leer la política
    expect((await e.run(`kms get-key-policy --key-id ${k.KeyId} --policy-name default`)).stderr).toContain('AccessDeniedException');
    expect((await e.run(`kms put-key-policy --key-id ${k.KeyId} --policy-name nombre --policy file://solo-bob.json ${as('bob')}`)).stderr).toContain("The only valid policy name is 'default'");
  });

  test('las concesiones (grants) dan acceso sin tocar la política', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const k = await newKey(e);
    const c = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW} --encryption-context proyecto=tienda`);
    const dec = (ctx = 'proyecto=tienda') => e.run(`kms decrypt --ciphertext-blob ${c.CiphertextBlob} --encryption-context ${ctx} ${as('bob')}`);
    expect((await dec()).code).not.toBe(0);
    const g = await e.json(`kms create-grant --key-id ${k.KeyId} --grantee-principal ${BOB} --operations Decrypt --constraints EncryptionContextSubset={proyecto=tienda}`);
    expect(g.GrantId).toHaveLength(64);
    expect((await dec()).code).toBe(0);
    // la restricción también cuenta
    const c2 = await e.json(`kms encrypt --key-id ${k.KeyId} --plaintext y ${RAW} --encryption-context proyecto=rrhh`);
    expect((await e.run(`kms decrypt --ciphertext-blob ${c2.CiphertextBlob} --encryption-context proyecto=rrhh ${as('bob')}`)).code).not.toBe(0);
    // y solo la operación concedida
    expect((await e.run(`kms encrypt --key-id ${k.KeyId} --plaintext x ${RAW} ${as('bob')}`)).code).not.toBe(0);
    const list = (await e.json(`kms list-grants --key-id ${k.KeyId}`)).Grants;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ GranteePrincipal: BOB, Operations: ['Decrypt'], Constraints: { EncryptionContextSubset: { proyecto: 'tienda' } } });
    await e.run(`kms revoke-grant --key-id ${k.KeyId} --grant-id ${g.GrantId}`);
    expect((await dec()).code).not.toBe(0);
    expect((await e.run(`kms revoke-grant --key-id ${k.KeyId} --grant-id ${g.GrantId}`)).stderr).toContain('InvalidGrantIdException');
    expect((await e.run(`kms create-grant --key-id ${k.KeyId} --grantee-principal ${BOB} --operations Mirar`)).stderr).toContain('ValidationException');
    const g2 = await e.json(`kms create-grant --key-id ${k.KeyId} --grantee-principal ${BOB} --operations Decrypt --retiring-principal ${BOB}`);
    expect((await e.json(`kms list-retirable-grants --retiring-principal ${BOB}`)).Grants).toHaveLength(1);
    await e.run(`kms retire-grant --grant-token ${g2.GrantToken}`);
    expect((await e.json(`kms list-grants --key-id ${k.KeyId}`)).Grants).toHaveLength(0);
  });
});

describe('KMS: integración con S3 y Parameter Store', () => {
  const ALLOW = (action: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: action, Resource: '*' }] });

  async function setup() {
    const e = mkEnv({ scenario: 'equipo' });
    const k = await newKey(e);
    await e.run(`kms create-alias --alias-name alias/datos --target-key-id ${k.KeyId}`);
    await e.run('s3 mb s3://cifrado');
    e.write('nota.txt', 'datos privados\n');
    return { e, k };
  }

  test('SSE-KMS: la clave elegida, la del bucket y la administrada por AWS', async () => {
    const { e, k } = await setup();
    await e.run('s3 cp nota.txt s3://cifrado/a.txt --sse aws:kms --sse-kms-key-id alias/datos');
    const h = await e.json('s3api head-object --bucket cifrado --key a.txt');
    expect(h).toMatchObject({ ServerSideEncryption: 'aws:kms', SSEKMSKeyId: k.Arn });
    // por defecto del bucket
    await e.run(`s3api put-bucket-encryption --bucket cifrado --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"${k.Arn}"}}]}'`);
    await e.run('s3 cp nota.txt s3://cifrado/b.txt');
    expect((await e.json('s3api head-object --bucket cifrado --key b.txt')).SSEKMSKeyId).toBe(k.Arn);
    expect((await e.run(`s3api put-bucket-encryption --bucket cifrado --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"alias/no-existe"}}]}'`)).stderr).toContain('KMS.NotFoundException');
    // sin indicar clave: la administrada por AWS, que se crea al usarla
    await e.run('s3api put-bucket-encryption --bucket cifrado --server-side-encryption-configuration \'{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}\'');
    await e.run('s3 cp nota.txt s3://cifrado/c.txt');
    const managed = (await e.json('s3api head-object --bucket cifrado --key c.txt')).SSEKMSKeyId as string;
    expect(managed).toContain(':key/');
    expect((await e.json('kms list-aliases')).Aliases.map((a: { AliasName: string }) => a.AliasName)).toContain('alias/aws/s3');
    expect((await e.json(`kms describe-key --key-id ${managed}`)).KeyMetadata.KeyManager).toBe('AWS');
    // y el texto en claro se lee con normalidad
    expect((await e.run('s3 cp s3://cifrado/a.txt -')).stdout).toContain('datos privados');
  });

  test('sin permiso sobre la clave, S3 no deja escribir ni leer', async () => {
    const { e, k } = await setup();
    await e.run(`s3 cp nota.txt s3://cifrado/a.txt --sse aws:kms --sse-kms-key-id ${k.KeyId}`);
    e.write('s3.json', ALLOW('s3:*'));
    await e.run('iam put-user-policy --user-name bob --policy-name s3 --policy-document file://s3.json');
    const bob = (cmd: string) => e.run(`${cmd} --profile bob`);
    const up = await bob(`s3 cp nota.txt s3://cifrado/bob.txt --sse aws:kms --sse-kms-key-id ${k.KeyId}`);
    expect(up.stderr).toContain('AccessDenied');
    expect(up.stderr).toContain('kms:GenerateDataKey');
    // cifrado con AES256 sí puede, y leer lo cifrado con KMS no
    expect((await bob('s3 cp nota.txt s3://cifrado/aes.txt')).code).toBe(0);
    const down = await bob('s3 cp s3://cifrado/a.txt -');
    expect(down.stderr).toContain('AccessDenied');
    expect(down.stderr).toContain('kms:Decrypt');
    expect((await bob('s3api head-object --bucket cifrado --key a.txt')).stderr).toContain('AccessDenied');
    // con permisos de KMS en IAM (la política de la clave delega en IAM), sí
    e.write('kms.json', ALLOW('kms:Decrypt'));
    await e.run('iam put-user-policy --user-name bob --policy-name kms --policy-document file://kms.json');
    expect((await bob('s3 cp s3://cifrado/a.txt -')).stdout).toContain('datos privados');
  });

  test('con la clave deshabilitada o pendiente de borrado los objetos no se pueden leer', async () => {
    const { e, k } = await setup();
    await e.run(`s3 cp nota.txt s3://cifrado/a.txt --sse aws:kms --sse-kms-key-id ${k.KeyId}`);
    await e.run(`kms disable-key --key-id ${k.KeyId}`);
    expect((await e.run('s3 cp s3://cifrado/a.txt -')).stderr).toContain('KMS.DisabledException');
    expect((await e.run(`s3 cp nota.txt s3://cifrado/b.txt --sse aws:kms --sse-kms-key-id ${k.KeyId}`)).stderr).toContain('KMS.DisabledException');
    await e.run(`kms enable-key --key-id ${k.KeyId}`);
    expect((await e.run('s3 cp s3://cifrado/a.txt -')).code).toBe(0);
    await e.run(`kms schedule-key-deletion --key-id ${k.KeyId} --pending-window-in-days 7`);
    expect((await e.run('s3api get-object --bucket cifrado --key a.txt /dev/stdout')).stderr).toContain('KMS.KMSInvalidStateException');
    // copiar a otro objeto con otra clave
    await e.run(`kms cancel-key-deletion --key-id ${k.KeyId}`);
    await e.run(`kms enable-key --key-id ${k.KeyId}`);
    const k2 = await newKey(e);
    await e.run(`s3 cp s3://cifrado/a.txt s3://cifrado/copia.txt --sse aws:kms --sse-kms-key-id ${k2.KeyId}`);
    expect((await e.json('s3api head-object --bucket cifrado --key copia.txt')).SSEKMSKeyId).toBe(k2.Arn);
  });

  test('Parameter Store: un SecureString con una clave propia exige permisos sobre ella', async () => {
    const { e, k } = await setup();
    await e.run(`ssm put-parameter --name /app/clave --value Secreta1 --type SecureString --key-id alias/datos`);
    expect((await e.json('ssm get-parameter --name /app/clave --with-decryption')).Parameter.Value).toBe('Secreta1');
    expect((await e.json('ssm describe-parameters')).Parameters[0]).toMatchObject({ Type: 'SecureString', KeyId: 'alias/datos' });
    e.write('ssm.json', ALLOW('ssm:*'));
    await e.run('iam put-user-policy --user-name bob --policy-name ssm --policy-document file://ssm.json');
    const r = await e.run('ssm get-parameter --name /app/clave --with-decryption --profile bob');
    expect(r.stderr).toContain('kms:Decrypt');
    expect((await e.run(`ssm put-parameter --name /app/otra --value x --type SecureString --key-id alias/datos --profile bob`)).stderr).toContain('kms:Encrypt');
    expect((await e.run('ssm put-parameter --name /app/mala --value x --type SecureString --key-id alias/nada')).stderr).toContain('Invalid keyId');
    void k;
  });
});

describe('KMS: volúmenes de EBS', () => {
  test('cifrado con una clave propia y cifrado por defecto', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const k = await newKey(e);
    const az = (await e.json('ec2 describe-availability-zones --query AvailabilityZones[0].ZoneName')) as string;
    const v = await e.json(`ec2 create-volume --availability-zone ${az} --size 8 --encrypted --kms-key-id ${k.KeyId}`);
    expect(v).toMatchObject({ Encrypted: true, KmsKeyId: k.Arn });
    const snap = await e.json(`ec2 create-snapshot --volume-id ${v.VolumeId}`);
    expect(snap).toMatchObject({ Encrypted: true, KmsKeyId: k.Arn });
    expect((await e.run(`ec2 create-volume --availability-zone ${az} --size 8 --kms-key-id alias/nada`)).stderr).toContain('InvalidKeyId.NotFound');
    // sin permisos sobre la clave no se puede usar
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ec2:*', Resource: '*' }] }));
    await e.run('iam put-user-policy --user-name bob --policy-name ec2 --policy-document file://p.json');
    expect((await e.run(`ec2 create-volume --availability-zone ${az} --size 8 --encrypted --kms-key-id ${k.KeyId} --profile bob`)).stderr).toContain('AccessDeniedException');
    // por defecto
    expect((await e.json('ec2 get-ebs-encryption-by-default')).EbsEncryptionByDefault).toBe(false);
    expect((await e.json(`ec2 create-volume --availability-zone ${az} --size 8`)).Encrypted).toBe(false);
    await e.run('ec2 enable-ebs-encryption-by-default');
    expect((await e.json('ec2 get-ebs-encryption-by-default')).EbsEncryptionByDefault).toBe(true);
    expect((await e.json(`ec2 create-volume --availability-zone ${az} --size 8`)).Encrypted).toBe(true);
    await e.run(`ec2 modify-ebs-default-kms-key-id --kms-key-id ${k.KeyId}`);
    expect((await e.json('ec2 get-ebs-default-kms-key-id')).KmsKeyId).toBe(k.Arn);
    await e.run('ec2 reset-ebs-default-kms-key-id');
    expect((await e.json('ec2 get-ebs-default-kms-key-id')).KmsKeyId).toBe('alias/aws/ebs');
  });
});
