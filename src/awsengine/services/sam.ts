/** AWS SAM: la transformación `AWS::Serverless-2016-10-31` que convierte `AWS::Serverless::Function` y `SimpleTable` en recursos de CloudFormation. */
import { AwsError } from '../registry';
import type { Rec } from '../types';
import { clone, isObj, stableId, toArr } from '../util';

export const SAM_TRANSFORM = 'AWS::Serverless-2016-10-31';

const err = (id: string, msg: string) => new AwsError('ValidationError', `Transform ${SAM_TRANSFORM} failed with: Invalid Serverless Application Specification document. Number of errors found: 1. Resource with id [${id}] is invalid. ${msg}`, 400);

const SERVICE_ROLE = new Set(['AWSLambdaBasicExecutionRole', 'AWSLambdaVPCAccessExecutionRole', 'AWSLambdaSQSQueueExecutionRole', 'AWSLambdaDynamoDBExecutionRole', 'AWSLambdaKinesisExecutionRole']);

/** Plantillas de políticas de SAM (`DynamoDBCrudPolicy`, `S3ReadPolicy`…) → documentos de política. */
function policyTemplate(name: string, args: Rec): Rec | undefined {
  const table = (x: unknown) => [{ 'Fn::Sub': ['arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${T}', { T: x }] }, { 'Fn::Sub': ['arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${T}/index/*', { T: x }] }];
  const bucket = (x: unknown) => [{ 'Fn::Sub': ['arn:aws:s3:::${B}', { B: x }] }, { 'Fn::Sub': ['arn:aws:s3:::${B}/*', { B: x }] }];
  const queue = (x: unknown) => ({ 'Fn::Sub': ['arn:aws:sqs:${AWS::Region}:${AWS::AccountId}:${Q}', { Q: x }] });
  const doc = (action: string[], resource: unknown) => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: action, Resource: resource }] });
  switch (name) {
    case 'DynamoDBCrudPolicy':
      return doc(['dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:Query', 'dynamodb:UpdateItem', 'dynamodb:BatchWriteItem', 'dynamodb:BatchGetItem', 'dynamodb:DescribeTable', 'dynamodb:ConditionCheckItem'], table(args.TableName));
    case 'DynamoDBReadPolicy':
      return doc(['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:DescribeTable'], table(args.TableName));
    case 'DynamoDBWritePolicy':
      return doc(['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:BatchWriteItem'], table(args.TableName));
    case 'S3ReadPolicy':
      return doc(['s3:GetObject', 's3:ListBucket', 's3:GetBucketLocation', 's3:GetObjectVersion'], bucket(args.BucketName));
    case 'S3CrudPolicy':
      return doc(['s3:GetObject', 's3:ListBucket', 's3:GetBucketLocation', 's3:GetObjectVersion', 's3:PutObject', 's3:PutObjectAcl', 's3:DeleteObject'], bucket(args.BucketName));
    case 'SQSSendMessagePolicy':
      return doc(['sqs:SendMessage*'], queue(args.QueueName));
    case 'SQSPollerPolicy':
      return doc(['sqs:ChangeMessageVisibility', 'sqs:ChangeMessageVisibilityBatch', 'sqs:DeleteMessage', 'sqs:DeleteMessageBatch', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'], queue(args.QueueName));
    case 'SNSPublishMessagePolicy':
      return doc(['sns:Publish'], { 'Fn::Sub': ['arn:aws:sns:${AWS::Region}:${AWS::AccountId}:${T}', { T: args.TopicName }] });
    case 'LambdaInvokePolicy':
      return doc(['lambda:InvokeFunction'], { 'Fn::Sub': ['arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${F}', { F: args.FunctionName }] });
    default:
      return undefined;
  }
}

function expandFunction(id: string, def: Rec, globals: Rec, out: Rec, state: { api: boolean }): void {
  const g = (globals.Function ?? {}) as Rec;
  const p: Rec = { ...g, ...((def.Properties ?? {}) as Rec) };
  if (isObj(g.Environment) && isObj((def.Properties as Rec | undefined)?.Environment)) p.Environment = { Variables: { ...((g.Environment as Rec).Variables as Rec), ...(((def.Properties as Rec).Environment as Rec).Variables as Rec) } };
  const fnProps: Rec = {};
  for (const k of ['Handler', 'Runtime', 'Timeout', 'MemorySize', 'Description', 'Environment', 'VpcConfig', 'FunctionName', 'Layers', 'ReservedConcurrentExecutions', 'DeadLetterConfig', 'TracingConfig']) if (p[k] !== undefined) fnProps[k] = p[k];
  if (!fnProps.Handler && !p.ImageUri) throw err(id, "Missing required property 'Handler'.");
  if (!fnProps.Runtime) throw err(id, "Missing required property 'Runtime'.");
  if (p.Tags) fnProps.Tags = Object.entries(p.Tags as Rec).map(([Key, Value]) => ({ Key, Value }));
  // código
  if (p.InlineCode !== undefined) fnProps.Code = { ZipFile: p.InlineCode };
  else if (p.CodeUri !== undefined) {
    const u = p.CodeUri;
    if (isObj(u) && (u.Bucket || u.Key)) fnProps.Code = { S3Bucket: u.Bucket, S3Key: u.Key };
    else if (typeof u === 'string' && /^s3:\/\//.test(u)) {
      const m = /^s3:\/\/([^/]+)\/(.+?)(?:\?.*)?$/.exec(u);
      if (!m) throw err(id, `'CodeUri' is not a valid S3 Uri of the form "s3://bucket/key" with optional versionId query parameter.`);
      fnProps.Code = { S3Bucket: m[1], S3Key: m[2] };
    } else throw err(id, `'CodeUri' is not a valid S3 Uri of the form "s3://bucket/key" with optional versionId query parameter.`);
  } else throw err(id, "Missing required property 'CodeUri' or 'InlineCode'.");
  // rol
  if (p.Role) fnProps.Role = p.Role;
  else {
    const managed: unknown[] = [];
    const inline: Rec[] = [];
    for (const [i, pol] of toArr<unknown>(p.Policies).entries()) {
      if (typeof pol === 'string') managed.push(pol.startsWith('arn:') ? pol : `arn:aws:iam::aws:policy/${SERVICE_ROLE.has(pol) ? 'service-role/' : ''}${pol}`);
      else if (isObj(pol) && pol.Statement) inline.push({ PolicyName: `${id}RolePolicy${i}`, PolicyDocument: pol });
      else if (isObj(pol)) {
        const [name] = Object.keys(pol);
        const doc = policyTemplate(name, (pol[name] ?? {}) as Rec);
        if (!doc) throw err(id, `'${name}' is not a supported policy template in this simulator.`);
        inline.push({ PolicyName: `${id}RolePolicy${i}`, PolicyDocument: doc });
      } else managed.push(pol);
    }
    out[`${id}Role`] = {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Action: ['sts:AssumeRole'], Effect: 'Allow', Principal: { Service: ['lambda.amazonaws.com'] } }] },
        ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', ...managed],
        ...(inline.length ? { Policies: inline } : {}),
      },
    };
    fnProps.Role = { 'Fn::GetAtt': [`${id}Role`, 'Arn'] };
  }
  out[id] = { Type: 'AWS::Lambda::Function', Properties: fnProps, ...(def.DependsOn ? { DependsOn: def.DependsOn } : {}), ...(def.Condition ? { Condition: def.Condition } : {}) };
  // alias con versión publicada
  if (p.AutoPublishAlias) {
    const hash = stableId(JSON.stringify([fnProps.Code, fnProps.Handler, fnProps.Runtime, fnProps.Timeout, fnProps.MemorySize, fnProps.Environment]), '', 10, 'hex');
    const vid = `${id}Version${hash}`;
    out[vid] = { Type: 'AWS::Lambda::Version', DeletionPolicy: 'Retain', Properties: { FunctionName: { Ref: id } } };
    out[`${id}Alias${String(p.AutoPublishAlias)}`] = { Type: 'AWS::Lambda::Alias', Properties: { FunctionName: { Ref: id }, FunctionVersion: { 'Fn::GetAtt': [vid, 'Version'] }, Name: p.AutoPublishAlias } };
  }
  // eventos
  for (const [evName, ev] of Object.entries((p.Events ?? {}) as Record<string, Rec>)) {
    const t = String(ev.Type);
    const ep = (ev.Properties ?? {}) as Rec;
    if (t !== 'HttpApi' && t !== 'Api') throw err(id, `Event with id [${evName}] is invalid. Event type '${t}' is not supported in this simulator (use HttpApi).`);
    const path = String(ep.Path ?? '/');
    const method = String(ep.Method ?? 'ANY').toUpperCase();
    const apiRef = ep.ApiId ?? { Ref: 'ServerlessHttpApi' };
    if (!ep.ApiId && !state.api) {
      state.api = true;
      out.ServerlessHttpApi = { Type: 'AWS::ApiGatewayV2::Api', Properties: { Name: { Ref: 'AWS::StackName' }, ProtocolType: 'HTTP' } };
      out.ServerlessHttpApiApiGatewayDefaultStage = { Type: 'AWS::ApiGatewayV2::Stage', Properties: { ApiId: { Ref: 'ServerlessHttpApi' }, StageName: '$default', AutoDeploy: true } };
    }
    const base = `${id}${evName}`;
    out[`${base}Integration`] = { Type: 'AWS::ApiGatewayV2::Integration', Properties: { ApiId: apiRef, IntegrationType: 'AWS_PROXY', IntegrationUri: { 'Fn::GetAtt': [id, 'Arn'] }, PayloadFormatVersion: '2.0' } };
    out[`${base}Route`] = { Type: 'AWS::ApiGatewayV2::Route', Properties: { ApiId: apiRef, RouteKey: `${method} ${path}`, Target: { 'Fn::Sub': ['integrations/${I}', { I: { Ref: `${base}Integration` } }] } } };
    out[`${base}Permission`] = {
      Type: 'AWS::Lambda::Permission',
      Properties: { FunctionName: { Ref: id }, Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com', SourceArn: { 'Fn::Sub': ['arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${A}/*/*', { A: apiRef }] } },
    };
  }
}

function expandTable(id: string, def: Rec, out: Rec): void {
  const p = (def.Properties ?? {}) as Rec;
  const pk = (p.PrimaryKey ?? { Name: 'id', Type: 'String' }) as Rec;
  const type = ({ String: 'S', Number: 'N', Binary: 'B' } as Record<string, string>)[String(pk.Type)] ?? 'S';
  const props: Rec = { AttributeDefinitions: [{ AttributeName: pk.Name, AttributeType: type }], KeySchema: [{ AttributeName: pk.Name, KeyType: 'HASH' }] };
  if (p.ProvisionedThroughput) {
    props.BillingMode = 'PROVISIONED';
    props.ProvisionedThroughput = p.ProvisionedThroughput;
  } else props.BillingMode = 'PAY_PER_REQUEST';
  if (p.TableName) props.TableName = p.TableName;
  if (p.Tags) props.Tags = Object.entries(p.Tags as Rec).map(([Key, Value]) => ({ Key, Value }));
  out[id] = { Type: 'AWS::DynamoDB::Table', Properties: props };
}

/** Expande una plantilla SAM a CloudFormation puro. */
export function expandSam(tpl: Rec): Rec {
  const src = clone(tpl);
  delete src.Transform;
  const globals = (src.Globals ?? {}) as Rec;
  delete src.Globals;
  const out: Rec = {};
  const state = { api: false };
  for (const [id, def] of Object.entries((src.Resources ?? {}) as Record<string, Rec>)) {
    if (def.Type === 'AWS::Serverless::Function') expandFunction(id, def, globals, out, state);
    else if (def.Type === 'AWS::Serverless::SimpleTable') expandTable(id, def, out);
    else if (typeof def.Type === 'string' && def.Type.startsWith('AWS::Serverless::')) throw err(id, `Resource type '${def.Type}' is not supported in this simulator (use AWS::Serverless::Function or SimpleTable).`);
    else out[id] = def;
  }
  src.Resources = out;
  return src;
}

