import { denialReason, evaluate, validatePolicy, type EvalRequest, type PolicySource } from '../policy';
import type { PolicyDoc } from '../types';

const ACCT = '123456789012';
const ANA = `arn:aws:iam::${ACCT}:user/ana`;

const idPolicy = (doc: PolicyDoc, name = 'p'): PolicySource => ({ name, kind: 'identity', doc });
const req = (over: Partial<EvalRequest>): EvalRequest => ({ action: 's3:GetObject', resource: 'arn:aws:s3:::datos/a.txt', principalArn: ANA, principalAccount: ACCT, policies: [], ...over });

describe('evaluador de políticas', () => {
  test('sin políticas: denegado por defecto', () => {
    const r = evaluate(req({}));
    expect(r.decision).toBe('implicitDeny');
  });

  test('Allow con comodines (acción sin distinguir mayúsculas)', () => {
    const p = idPolicy({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'S3:Get*', Resource: 'arn:aws:s3:::datos/*' }] });
    expect(evaluate(req({ policies: [p] })).decision).toBe('allowed');
    expect(evaluate(req({ policies: [p], action: 's3:PutObject' })).decision).toBe('implicitDeny');
    expect(evaluate(req({ policies: [p], resource: 'arn:aws:s3:::otro/a.txt' })).decision).toBe('implicitDeny');
  });

  test('Deny explícito gana al Allow', () => {
    const allow = idPolicy({ Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] }, 'allow');
    const deny = idPolicy({ Statement: [{ Effect: 'Deny', Action: 's3:DeleteObject', Resource: '*' }] }, 'deny');
    expect(evaluate(req({ policies: [allow, deny], action: 's3:GetObject' })).decision).toBe('allowed');
    const r = evaluate(req({ policies: [allow, deny], action: 's3:DeleteObject' }));
    expect(r.decision).toBe('explicitDeny');
    expect(r.matched[0].source).toBe('deny');
    expect(r.by).toBe('identity');
  });

  test('NotAction y NotResource', () => {
    const p = idPolicy({ Statement: [{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }] });
    expect(evaluate(req({ policies: [p] })).decision).toBe('allowed');
    expect(evaluate(req({ policies: [p], action: 'iam:CreateUser', resource: '*' })).decision).toBe('implicitDeny');
    const q = idPolicy({ Statement: [{ Effect: 'Allow', Action: 's3:*', NotResource: 'arn:aws:s3:::secreto/*' }] });
    expect(evaluate(req({ policies: [q], resource: 'arn:aws:s3:::secreto/x' })).decision).toBe('implicitDeny');
    expect(evaluate(req({ policies: [q] })).decision).toBe('allowed');
  });

  test('condiciones: IP, MFA con IfExists y variables de política', () => {
    const ip = idPolicy({ Statement: [{ Effect: 'Allow', Action: '*', Resource: '*', Condition: { IpAddress: { 'aws:SourceIp': ['203.0.113.0/24', '198.51.100.7'] } } }] });
    expect(evaluate(req({ policies: [ip], context: { 'aws:SourceIp': '203.0.113.50' } })).decision).toBe('allowed');
    expect(evaluate(req({ policies: [ip], context: { 'aws:SourceIp': '10.0.0.1' } })).decision).toBe('implicitDeny');
    expect(evaluate(req({ policies: [ip], context: { 'aws:SourceIp': '198.51.100.7' } })).decision).toBe('allowed');
    // sin la clave en el contexto la condición es falsa
    expect(evaluate(req({ policies: [ip] })).decision).toBe('implicitDeny');

    const mfa = idPolicy({ Statement: [{ Effect: 'Deny', Action: '*', Resource: '*', Condition: { BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' } } }] });
    expect(evaluate(req({ policies: [mfa], context: { 'aws:MultiFactorAuthPresent': false } })).decision).toBe('explicitDeny');
    // claves de larga duración: la clave ni existe → con IfExists la condición se da por cumplida y el Deny se aplica
    expect(evaluate(req({ policies: [mfa] })).decision).toBe('explicitDeny');
    expect(evaluate(req({ policies: [mfa], context: { 'aws:MultiFactorAuthPresent': true } })).decision).toBe('implicitDeny');

    const vars = idPolicy({ Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: 'arn:aws:s3:::datos/${aws:username}/*' }] });
    expect(evaluate(req({ policies: [vars], resource: 'arn:aws:s3:::datos/ana/x', context: { 'aws:username': 'ana' } })).decision).toBe('allowed');
    expect(evaluate(req({ policies: [vars], resource: 'arn:aws:s3:::datos/bob/x', context: { 'aws:username': 'ana' } })).decision).toBe('implicitDeny');
  });

  test('operadores negados y de conjunto', () => {
    const p = idPolicy({ Statement: [{ Effect: 'Allow', Action: 'ec2:RunInstances', Resource: '*', Condition: { StringEquals: { 'ec2:InstanceType': ['t3.micro', 't3.small'] } } }] });
    expect(evaluate(req({ policies: [p], action: 'ec2:RunInstances', resource: '*', context: { 'ec2:InstanceType': 't3.small' } })).decision).toBe('allowed');
    expect(evaluate(req({ policies: [p], action: 'ec2:RunInstances', resource: '*', context: { 'ec2:InstanceType': 'm5.large' } })).decision).toBe('implicitDeny');

    const not = idPolicy({ Statement: [{ Effect: 'Deny', Action: '*', Resource: '*', Condition: { StringNotEquals: { 'aws:RequestedRegion': ['eu-west-1', 'us-east-1'] } } }] });
    expect(evaluate(req({ policies: [not], context: { 'aws:RequestedRegion': 'sa-east-1' } })).decision).toBe('explicitDeny');
    expect(evaluate(req({ policies: [not], context: { 'aws:RequestedRegion': 'eu-west-1' } })).decision).toBe('implicitDeny');

    const all = idPolicy({ Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*', Condition: { 'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['id', 'name'] } } }] });
    expect(evaluate(req({ policies: [all], action: 'dynamodb:GetItem', resource: '*', context: { 'dynamodb:Attributes': ['id'] } })).decision).toBe('allowed');
    expect(evaluate(req({ policies: [all], action: 'dynamodb:GetItem', resource: '*', context: { 'dynamodb:Attributes': ['id', 'salary'] } })).decision).toBe('implicitDeny');

    const nul = idPolicy({ Statement: [{ Effect: 'Deny', Action: '*', Resource: '*', Condition: { Null: { 'aws:MultiFactorAuthPresent': 'true' } } }] });
    expect(evaluate(req({ policies: [nul] })).decision).toBe('explicitDeny');
    expect(evaluate(req({ policies: [nul], context: { 'aws:MultiFactorAuthPresent': true } })).decision).toBe('implicitDeny');
  });

  test('límite de permisos: la identidad concede pero el límite recorta', () => {
    const allow = idPolicy({ Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] });
    const boundary: PolicySource = { name: 'limite', kind: 'boundary', doc: { Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] } };
    expect(evaluate(req({ policies: [allow, boundary] })).decision).toBe('allowed');
    const r = evaluate(req({ policies: [allow, boundary], action: 'ec2:RunInstances', resource: '*' }));
    expect(r.decision).toBe('implicitDeny');
    expect(r.by).toBe('boundary');
  });

  test('política de recurso: misma cuenta nombrando al usuario concede sola', () => {
    const rp: PolicySource = { name: 'bucket-policy', kind: 'resource', doc: { Statement: [{ Effect: 'Allow', Principal: { AWS: ANA }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::datos/*' }] } };
    expect(evaluate(req({ policies: [rp] })).decision).toBe('allowed');
    // nombrando solo la cuenta, hace falta además un Allow en la identidad
    const rp2: PolicySource = { name: 'bp2', kind: 'resource', doc: { Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:root` }, Action: 's3:GetObject', Resource: '*' }] } };
    expect(evaluate(req({ policies: [rp2] })).decision).toBe('implicitDeny');
    // Principal "*" abre a todos
    const rp3: PolicySource = { name: 'bp3', kind: 'resource', doc: { Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: '*' }] } };
    expect(evaluate(req({ policies: [rp3], principalArn: 'arn:aws:iam::999999999999:user/x', principalAccount: '999999999999', resourceAccount: ACCT })).decision).toBe('implicitDeny');
  });

  test('entre cuentas hacen falta las dos políticas', () => {
    const other = 'arn:aws:iam::999999999999:user/ext';
    const rp: PolicySource = { name: 'bp', kind: 'resource', doc: { Statement: [{ Effect: 'Allow', Principal: { AWS: other }, Action: 's3:GetObject', Resource: '*' }] } };
    const idp = idPolicy({ Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] });
    const base = { principalArn: other, principalAccount: '999999999999', resourceAccount: ACCT };
    expect(evaluate(req({ ...base, policies: [rp] })).decision).toBe('implicitDeny');
    expect(evaluate(req({ ...base, policies: [idp] })).decision).toBe('implicitDeny');
    expect(evaluate(req({ ...base, policies: [rp, idp] })).decision).toBe('allowed');
  });

  test('root solo lo frena un Deny', () => {
    expect(evaluate(req({ root: true })).decision).toBe('allowed');
    const scp: PolicySource = { name: 'scp', kind: 'scp', doc: { Statement: [{ Effect: 'Deny', Action: 'ec2:*', Resource: '*' }] } };
    expect(evaluate(req({ root: true, policies: [scp], action: 'ec2:RunInstances', resource: '*' })).decision).toBe('explicitDeny');
  });

  test('mensajes de AccessDenied', () => {
    const r = evaluate(req({ action: 'iam:CreateUser', resource: `arn:aws:iam::${ACCT}:user/x` }));
    expect(denialReason(r, ANA, 'iam:CreateUser', `arn:aws:iam::${ACCT}:user/x`)).toBe(
      `User: ${ANA} is not authorized to perform: iam:CreateUser on resource: arn:aws:iam::${ACCT}:user/x because no identity-based policy allows the iam:CreateUser action`,
    );
    const d = evaluate(req({ policies: [idPolicy({ Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }] })] }));
    expect(denialReason(d, ANA, 's3:GetObject', 'arn:aws:s3:::datos/a.txt')).toContain('with an explicit deny in an identity-based policy');
  });

  test('validación de políticas', () => {
    expect(validatePolicy({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] })).toBeNull();
    expect(validatePolicy({ Statement: [{ Effect: 'Permit', Action: 's3:*', Resource: '*' }] })).toMatch(/Syntax/);
    expect(validatePolicy({ Statement: [{ Effect: 'Allow', Resource: '*' }] })).toMatch(/actions/);
    expect(validatePolicy({ Statement: [{ Effect: 'Allow', Action: 's3:*' }] })).toMatch(/resources/);
    expect(validatePolicy({ Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*', Principal: '*' }] })).toMatch(/principal/);
    expect(validatePolicy({ Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole' }] }, 'trust')).toMatch(/principal/);
    expect(validatePolicy({ Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: 'ec2.amazonaws.com' } }] }, 'trust')).toBeNull();
    expect(validatePolicy('texto')).toMatch(/Syntax/);
  });
});
