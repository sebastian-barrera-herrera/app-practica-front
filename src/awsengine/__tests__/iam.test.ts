import { mkEnv } from './helpers';

const POLICY = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::informes/*' }] });

describe('CLI: básicos', () => {
  test('sin argumentos, comando inventado y sugerencias', async () => {
    const e = mkEnv();
    let r = await e.run('');
    expect(r.code).toBe(252);
    expect(r.stderr).toContain('the following arguments are required: command');
    r = await e.run('iem list-users');
    expect(r.code).toBe(252);
    expect(r.stderr).toContain("Invalid choice: 'iem', maybe you meant:");
    expect(r.stderr).toContain('* iam');
    r = await e.run('iam create-usr --user-name x');
    expect(r.stderr).toContain('* create-user');
    r = await e.run('--version');
    expect(r.stdout).toMatch(/^aws-cli\/2\./);
  });

  test('parámetros: obligatorios y desconocidos', async () => {
    const e = mkEnv();
    let r = await e.run('iam create-user');
    expect(r.code).toBe(252);
    expect(r.stderr).toContain('the following arguments are required: --user-name');
    r = await e.run('iam create-user --user-name x --foo bar');
    expect(r.stderr).toContain('unrecognized arguments: --foo bar');
    r = await e.run('iam create-user --user-name');
    expect(r.stderr).toContain('expected one argument');
  });

  test('ayuda', async () => {
    const e = mkEnv();
    expect((await e.run('help')).stdout).toContain('AVAILABLE SERVICES');
    expect((await e.run('iam help')).stdout).toContain('o create-user');
    const h = (await e.run('iam create-user help')).stdout;
    expect(h).toContain('--user-name <value>');
    expect(h).toContain('[--path <value>]');
  });

  test('credenciales: sin configurar, perfil inexistente, clave inventada', async () => {
    const e = mkEnv({ noCredentials: true });
    let r = await e.run('sts get-caller-identity');
    expect(r.code).toBe(255);
    expect(r.stderr).toContain('Unable to locate credentials');
    r = await e.run('sts get-caller-identity --profile nadie');
    expect(r.stderr).toContain('The config profile (nadie) could not be found');

    const f = mkEnv();
    f.env.AWS_ACCESS_KEY_ID = 'AKIAINVENTADA000000';
    f.env.AWS_SECRET_ACCESS_KEY = 'x'.repeat(40);
    r = await f.run('sts get-caller-identity');
    expect(r.code).toBe(254);
    expect(r.stderr).toContain('InvalidClientTokenId');
  });

  test('región obligatoria en EC2 pero no en IAM', async () => {
    const e = mkEnv({ region: '' });
    expect((await e.run('iam list-users')).code).toBe(0);
    const r = await e.run('ec2 describe-instances');
    expect(r.code).toBe(253);
    expect(r.stderr).toContain('You must specify a region');
  });
});

describe('STS', () => {
  test('get-caller-identity', async () => {
    const e = mkEnv();
    const j = await e.json('sts get-caller-identity');
    expect(j.Account).toBe('123456789012');
    expect(j.Arn).toBe('arn:aws:iam::123456789012:user/alumno');
    expect(j.UserId).toMatch(/^AIDA[A-Z2-7]{17}$/);
    const t = await e.run('sts get-caller-identity --query Account --output text');
    expect(t.stdout).toBe('123456789012\n');
    const t2 = await e.run('sts get-caller-identity --output text');
    expect(t2.stdout.trim().split('\t')).toEqual(['123456789012', 'arn:aws:iam::123456789012:user/alumno', j.UserId]);
  });

  test('perfiles: --profile ana', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const j = await e.json('sts get-caller-identity --profile ana');
    expect(j.Arn).toBe('arn:aws:iam::123456789012:user/ana');
    e.env.AWS_PROFILE = 'bob';
    expect((await e.json('sts get-caller-identity')).Arn).toContain('user/bob');
  });

  test('assume-role y uso de las credenciales temporales', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const out = await e.json('sts assume-role --role-arn arn:aws:iam::123456789012:role/Auditor --role-session-name prueba');
    expect(out.Credentials.AccessKeyId).toMatch(/^ASIA/);
    expect(out.AssumedRoleUser.Arn).toBe('arn:aws:sts::123456789012:assumed-role/Auditor/prueba');
    // usar las credenciales temporales por entorno
    e.env.AWS_ACCESS_KEY_ID = out.Credentials.AccessKeyId;
    e.env.AWS_SECRET_ACCESS_KEY = out.Credentials.SecretAccessKey;
    e.env.AWS_SESSION_TOKEN = out.Credentials.SessionToken;
    const who = await e.json('sts get-caller-identity');
    expect(who.Arn).toBe('arn:aws:sts::123456789012:assumed-role/Auditor/prueba');
    // el rol Auditor solo tiene SecurityAudit: puede listar usuarios pero no crearlos
    expect((await e.run('iam list-users')).code).toBe(0);
    const bad = await e.run('iam create-user --user-name intruso');
    expect(bad.code).toBe(254);
    expect(bad.stderr).toContain('An error occurred (AccessDenied) when calling the CreateUser operation');
    expect(bad.stderr).toContain('assumed-role/Auditor/prueba is not authorized to perform: iam:CreateUser');
    // sin el token la clave temporal no vale
    delete e.env.AWS_SESSION_TOKEN;
    expect((await e.run('sts get-caller-identity')).stderr).toContain('InvalidClientTokenId');
  });

  test('assume-role denegado o con caducidad', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    // ServidorWeb solo confía en ec2.amazonaws.com
    const r = await e.run('sts assume-role --role-arn arn:aws:iam::123456789012:role/ServidorWeb --role-session-name xx');
    expect(r.code).toBe(254);
    expect(r.stderr).toContain('is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::123456789012:role/ServidorWeb');
    const r2 = await e.run('sts assume-role --role-arn arn:aws:iam::123456789012:role/NoExiste --role-session-name xx');
    expect(r2.stderr).toContain('AccessDenied');
    const r3 = await e.run('sts assume-role --role-arn arn:aws:iam::123456789012:role/Auditor --role-session-name xx --duration-seconds 100');
    expect(r3.stderr).toContain('durationSeconds');

    const ok = await e.json('sts assume-role --role-arn arn:aws:iam::123456789012:role/Auditor --role-session-name corto --duration-seconds 900');
    e.env.AWS_ACCESS_KEY_ID = ok.Credentials.AccessKeyId;
    e.env.AWS_SECRET_ACCESS_KEY = ok.Credentials.SecretAccessKey;
    e.env.AWS_SESSION_TOKEN = ok.Credentials.SessionToken;
    e.acct.clock += 901 * 1000;
    expect((await e.run('sts get-caller-identity')).stderr).toContain('ExpiredToken');
  });

  test('perfil con role_arn y source_profile', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    e.files.set('/home/alumno/.aws/config', '[default]\nregion = us-east-1\n\n[profile auditor]\nrole_arn = arn:aws:iam::123456789012:role/Auditor\nsource_profile = default\nregion = us-east-1\n');
    const who = await e.json('sts get-caller-identity --profile auditor');
    expect(who.Arn).toMatch(/^arn:aws:sts::123456789012:assumed-role\/Auditor\/botocore-session-/);
  });

  test('get-session-token con MFA', async () => {
    const e = mkEnv({ scenario: 'equipo', as: 'carla' });
    const r = await e.run('sts get-session-token --serial-number arn:aws:iam::123456789012:mfa/carla --token-code 123456');
    expect(r.code).toBe(0);
    const bad = await e.run('sts get-session-token --serial-number arn:aws:iam::123456789012:mfa/carla --token-code 000000');
    expect(bad.stderr).toContain('MultiFactorAuthentication failed');
    const bad2 = await e.run('sts get-session-token --serial-number arn:aws:iam::123456789012:mfa/carla --token-code 12');
    expect(bad2.stderr).toContain('tokenCode');
  });
});

describe('IAM: usuarios y claves', () => {
  test('crear, listar, etiquetar y borrar un usuario', async () => {
    const e = mkEnv();
    const c = await e.json('iam create-user --user-name lucia --tags Key=equipo,Value=web');
    expect(c.User.Arn).toBe('arn:aws:iam::123456789012:user/lucia');
    expect(c.User.Tags).toEqual([{ Key: 'equipo', Value: 'web' }]);
    const dup = await e.run('iam create-user --user-name lucia');
    expect(dup.stderr).toContain('(EntityAlreadyExists) when calling the CreateUser operation: User with name lucia already exists.');
    expect((await e.json('iam list-users --query "Users[].UserName"'))).toEqual(['alumno', 'lucia']);
    await e.run('iam tag-user --user-name lucia --tags Key=rol,Value=dev');
    expect(await e.json('iam list-user-tags --user-name lucia --query "Tags[?Key==\'rol\'].Value"')).toEqual(['dev']);
    const get = await e.run('iam get-user --user-name nadie');
    expect(get.stderr).toContain('(NoSuchEntity) when calling the GetUser operation: The user with name nadie cannot be found.');
    expect((await e.run('iam delete-user --user-name lucia')).code).toBe(0);
    expect((await e.run('iam get-user --user-name lucia')).code).toBe(254);
    const bad = await e.run('iam create-user --user-name "a b"');
    expect(bad.stderr).toContain('ValidationError');
  });

  test('claves de acceso: máximo 2, desactivar y borrar', async () => {
    const e = mkEnv();
    await e.run('iam create-user --user-name lucia');
    const k1 = await e.json('iam create-access-key --user-name lucia');
    expect(k1.AccessKey.AccessKeyId).toMatch(/^AKIA[A-Z2-7]{16}$/);
    expect(k1.AccessKey.SecretAccessKey).toHaveLength(40);
    await e.run('iam create-access-key --user-name lucia');
    const k3 = await e.run('iam create-access-key --user-name lucia');
    expect(k3.stderr).toContain('(LimitExceeded)');
    await e.run(`iam update-access-key --user-name lucia --access-key-id ${k1.AccessKey.AccessKeyId} --status Inactive`);
    const l = await e.json('iam list-access-keys --user-name lucia');
    expect(l.AccessKeyMetadata.map((k: any) => k.Status)).toEqual(['Inactive', 'Active']);
    // una clave inactiva ya no autentica
    e.env.AWS_ACCESS_KEY_ID = k1.AccessKey.AccessKeyId;
    e.env.AWS_SECRET_ACCESS_KEY = k1.AccessKey.SecretAccessKey;
    expect((await e.run('sts get-caller-identity')).stderr).toContain('InvalidClientTokenId');
    // delete-user con claves: conflicto
    delete e.env.AWS_ACCESS_KEY_ID;
    delete e.env.AWS_SECRET_ACCESS_KEY;
    const del = await e.run('iam delete-user --user-name lucia');
    expect(del.stderr).toContain('(DeleteConflict)');
  });

  test('max-items y NextToken', async () => {
    const e = mkEnv();
    for (const n of ['u1', 'u2', 'u3']) await e.run(`iam create-user --user-name ${n}`);
    const p1 = await e.json('iam list-users --max-items 2');
    expect(p1.Users).toHaveLength(2);
    expect(p1.NextToken).toBeTruthy();
    const p2 = await e.json(`iam list-users --max-items 2 --starting-token ${p1.NextToken}`);
    expect(p2.Users).toHaveLength(2);
    expect(p2.NextToken).toBeUndefined();
  });
});

describe('IAM: grupos y políticas', () => {
  test('un usuario hereda los permisos del grupo', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    // ana está en «desarrolladores» (S3 solo lectura): lista buckets ok, pero no crea usuarios
    expect((await e.run('iam create-user --user-name x --profile ana')).stderr).toContain('is not authorized to perform: iam:CreateUser');
    // quitarla del grupo y darle una política en línea
    await e.run('iam remove-user-from-group --group-name desarrolladores --user-name ana');
    expect(await e.json('iam list-groups-for-user --user-name ana --query "Groups[].GroupName"')).toEqual([]);
    await e.run('iam add-user-to-group --group-name admins --user-name ana');
    expect((await e.run('iam create-user --user-name x --profile ana')).code).toBe(0);
  });

  test('políticas administradas: crear, asociar, versiones, borrar', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const c = await e.json(`iam create-policy --policy-name LeerS3 --policy-document '${POLICY}'`);
    const arn = c.Policy.Arn;
    expect(arn).toBe('arn:aws:iam::123456789012:policy/LeerS3');
    expect(c.Policy.AttachmentCount).toBe(0);
    await e.run(`iam attach-user-policy --user-name bob --policy-arn ${arn}`);
    expect(await e.json('iam list-attached-user-policies --user-name bob --query "AttachedPolicies[].PolicyName"')).toEqual(['LeerS3']);
    expect((await e.json(`iam get-policy --policy-arn ${arn}`)).Policy.AttachmentCount).toBe(1);
    const doc = await e.json(`iam get-policy-version --policy-arn ${arn} --version-id v1`);
    expect(doc.PolicyVersion.Document.Statement[0].Action).toBe('s3:GetObject');
    // nueva versión como predeterminada
    const v2 = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] });
    const nv = await e.json(`iam create-policy-version --policy-arn ${arn} --policy-document '${v2}' --set-as-default`);
    expect(nv.PolicyVersion.VersionId).toBe('v2');
    expect((await e.json(`iam get-policy --policy-arn ${arn}`)).Policy.DefaultVersionId).toBe('v2');
    // no se puede borrar mientras está asociada
    expect((await e.run(`iam delete-policy --policy-arn ${arn}`)).stderr).toContain('(DeleteConflict)');
    await e.run(`iam detach-user-policy --user-name bob --policy-arn ${arn}`);
    expect((await e.run(`iam delete-policy --policy-arn ${arn}`)).stderr).toContain('non-default versions');
    await e.run(`iam delete-policy-version --policy-arn ${arn} --version-id v1`);
    expect((await e.run(`iam delete-policy --policy-arn ${arn}`)).code).toBe(0);
  });

  test('políticas mal escritas', async () => {
    const e = mkEnv();
    let r = await e.run(`iam create-policy --policy-name Mala --policy-document '{"Statement":[{"Effect":"Permit","Action":"s3:*","Resource":"*"}]}'`);
    expect(r.stderr).toContain('(MalformedPolicyDocument) when calling the CreatePolicy operation: Syntax errors in policy.');
    r = await e.run(`iam create-policy --policy-name Mala --policy-document 'esto no es json'`);
    expect(r.stderr).toContain('MalformedPolicyDocument');
    r = await e.run(`iam create-policy --policy-name Mala --policy-document file://nada.json`);
    expect(r.stderr).toContain('Unable to load paramfile file://nada.json');
    expect(r.code).toBe(252);
  });

  test('file:// y políticas en línea', async () => {
    const e = mkEnv({}, { 'politica.json': POLICY });
    await e.run('iam create-user --user-name lucia');
    expect((await e.run('iam put-user-policy --user-name lucia --policy-name leer --policy-document file://politica.json')).code).toBe(0);
    expect(await e.json('iam list-user-policies --user-name lucia')).toEqual({ PolicyNames: ['leer'], IsTruncated: false });
    const g = await e.json('iam get-user-policy --user-name lucia --policy-name leer');
    expect(g.PolicyDocument.Statement[0].Resource).toBe('arn:aws:s3:::informes/*');
    await e.run('iam delete-user-policy --user-name lucia --policy-name leer');
    expect((await e.json('iam list-user-policies --user-name lucia')).PolicyNames).toEqual([]);
  });

  test('simulate-principal-policy', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const r = await e.json('iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:user/ana --action-names s3:GetObject s3:PutObject --resource-arns arn:aws:s3:::x/y');
    expect(r.EvaluationResults.map((x: any) => [x.EvalActionName, x.EvalDecision])).toEqual([
      ['s3:GetObject', 'allowed'],
      ['s3:PutObject', 'implicitDeny'],
    ]);
    const custom = await e.json(`iam simulate-custom-policy --policy-input-list '{"Statement":[{"Effect":"Deny","Action":"s3:*","Resource":"*"}]}' --action-names s3:GetObject`);
    expect(custom.EvaluationResults[0].EvalDecision).toBe('explicitDeny');
  });
});

describe('IAM: roles, MFA y cuenta', () => {
  test('crear un rol con política de confianza y perfil de instancia', async () => {
    const e = mkEnv();
    const trust = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
    const r = await e.json(`iam create-role --role-name Web --assume-role-policy-document '${trust}'`);
    expect(r.Role.Arn).toBe('arn:aws:iam::123456789012:role/Web');
    expect(r.Role.AssumeRolePolicyDocument.Statement[0].Principal.Service).toBe('ec2.amazonaws.com');
    await e.run('iam attach-role-policy --role-name Web --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess');
    await e.run('iam create-instance-profile --instance-profile-name Web');
    expect((await e.run('iam add-role-to-instance-profile --instance-profile-name Web --role-name Web')).code).toBe(0);
    const ip = await e.json('iam get-instance-profile --instance-profile-name Web');
    expect(ip.InstanceProfile.Roles[0].RoleName).toBe('Web');
    expect((await e.run('iam delete-role --role-name Web')).stderr).toContain('(DeleteConflict)');
    // una trust policy sin Principal es inválida
    const bad = await e.run(`iam create-role --role-name Mal --assume-role-policy-document '{"Statement":[{"Effect":"Allow","Action":"sts:AssumeRole"}]}'`);
    expect(bad.stderr).toContain('must contain a principal');
  });

  test('MFA virtual y resumen de la cuenta', async () => {
    const e = mkEnv();
    await e.run('iam create-user --user-name lucia');
    const d = await e.json('iam create-virtual-mfa-device --virtual-mfa-device-name lucia');
    expect(d.VirtualMFADevice.SerialNumber).toBe('arn:aws:iam::123456789012:mfa/lucia');
    expect((await e.run(`iam enable-mfa-device --user-name lucia --serial-number ${d.VirtualMFADevice.SerialNumber} --authentication-code1 123456 --authentication-code2 654321`)).code).toBe(0);
    expect(await e.json('iam list-mfa-devices --user-name lucia --query "MFADevices[].SerialNumber"')).toEqual([d.VirtualMFADevice.SerialNumber]);
    const s = await e.json('iam get-account-summary');
    expect(s.SummaryMap.Users).toBe(2);
    expect(s.SummaryMap.AccountMFAEnabled).toBe(0);
    expect(s.SummaryMap.MFADevicesInUse).toBe(1);
  });

  test('política de contraseñas', async () => {
    const e = mkEnv();
    expect((await e.run('iam get-account-password-policy')).stderr).toContain('NoSuchEntity');
    await e.run('iam update-account-password-policy --minimum-password-length 12 --require-numbers --require-symbols');
    const p = await e.json('iam get-account-password-policy');
    expect(p.PasswordPolicy.MinimumPasswordLength).toBe(12);
    expect(p.PasswordPolicy.RequireNumbers).toBe(true);
    expect(p.PasswordPolicy.RequireUppercaseCharacters).toBe(false);
    await e.run('iam create-user --user-name lucia');
    const weak = await e.run('iam create-login-profile --user-name lucia --password corta');
    expect(weak.stderr).toContain('PasswordPolicyViolation');
    expect((await e.run('iam create-login-profile --user-name lucia --password "Larga-y-segura-2025!"')).code).toBe(0);
  });

  test('informe de credenciales', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    expect((await e.run('iam get-credential-report')).stderr).toContain('CredentialReportNotPresent');
    expect((await e.json('iam generate-credential-report')).State).toBe('COMPLETE');
    const r = await e.json('iam get-credential-report');
    expect(r.ReportFormat).toBe('text/csv');
    expect(r.Content.length).toBeGreaterThan(100);
  });

  test('--output table y yaml', async () => {
    const e = mkEnv();
    const t = await e.run('sts get-caller-identity --output table');
    expect(t.stdout).toContain('GetCallerIdentity');
    expect(t.stdout).toContain('| ');
    const y = await e.run('iam list-users --output yaml --query "Users[0].UserName"');
    expect(y.stdout).toBe('alumno\n');
  });

  test('--cli-input-json y --generate-cli-skeleton', async () => {
    const e = mkEnv({}, { 'in.json': '{"UserName":"desdejson"}' });
    expect((await e.run('iam create-user --cli-input-json file://in.json')).code).toBe(0);
    expect((await e.json('iam get-user --user-name desdejson')).User.UserName).toBe('desdejson');
    const sk = await e.json('iam create-user --generate-cli-skeleton');
    expect(sk).toHaveProperty('UserName');
  });
});
