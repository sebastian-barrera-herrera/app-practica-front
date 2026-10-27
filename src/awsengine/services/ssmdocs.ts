/**
 * Systems Manager: documentos (de comandos y de automatización, públicos y propios) y Automation (runbooks que cambian
 * recursos paso a paso con los permisos de un rol).
 */
import { PySession } from '../../pyengine/session';
import { regional } from '../account';
import { AwsError, op, type Caller, type OpCtx } from '../registry';
import { roleCaller, sdkCall } from '../sdk';
import type { Account } from '../types';
import type { SsmAutomation, SsmAutomationStep, SsmDocument } from '../types-ops';
import { parseTemplate } from '../yaml';
import { iso, mkArn, newId, toArr } from '../util';
import { settleEc2 } from './ec2';
import { invokeSync } from './lambda';
import { roleTrusts } from './flowlogs';
import { jsonPath } from './logpattern';
import { remediationRunner } from './config';
import { commandDocs, customCommandDoc, normTargets, resolveTargets, sendCommand, ssmOf, type CmdResult } from './ssm';
import { paramsOf, tagHooks } from './ssmparams';
import { targetHooks } from './events';

type V = unknown;

// ───────────────────────── documentos públicos ─────────────────────────

interface ParamDef {
  type: string;
  description?: string;
  default?: V;
  allowedValues?: string[];
}
interface StepDef {
  name: string;
  action: string;
  inputs: Record<string, V>;
  outputs?: OutDef[];
  onFailure?: string;
}
interface PublicDoc {
  type: 'Command' | 'Automation';
  description: string;
  params: Record<string, ParamDef>;
  steps: StepDef[];
}

const S = (description: string, extra: Partial<ParamDef> = {}): ParamDef => ({ type: 'String', description, ...extra });
const ROLE = S('(Optional) The ARN of the role that allows Automation to perform the actions on your behalf.', { default: '' });
const instStep = (name: string, state: string): StepDef => ({ name, action: 'aws:changeInstanceState', inputs: { InstanceIds: ['{{ InstanceId }}'], DesiredState: state } });

const PUBLIC: Record<string, PublicDoc> = {
  'AWS-RunShellScript': { type: 'Command', description: 'Run a shell script or specify the commands to run.', params: { commands: { type: 'StringList', description: '(Required) Specify a shell script or a command to run.' }, workingDirectory: S('(Optional) The path to the working directory.', { default: '' }), executionTimeout: S('(Optional) The time in seconds for a command to complete.', { default: '3600' }) }, steps: [{ name: 'runShellScript', action: 'aws:runShellScript', inputs: { runCommand: ['{{ commands }}'] } }] },
  'AWS-RunPatchBaseline': { type: 'Command', description: 'Scans for or installs patches from the patch baseline that applies to the instance.', params: { Operation: S('Scan: report on missing patches. Install: install the missing ones.', { allowedValues: ['Scan', 'Install'] }), RebootOption: S('RebootIfNeeded or NoReboot.', { default: 'RebootIfNeeded', allowedValues: ['RebootIfNeeded', 'NoReboot'] }), SnapshotId: S('(Optional) Patch baseline snapshot id.', { default: '' }) }, steps: [{ name: 'PatchLinux', action: 'aws:runShellScript', inputs: {} }] },
  'AWS-UpdateSSMAgent': { type: 'Command', description: 'Update the SSM Agent to the latest version.', params: { version: S('(Optional) A specific version.', { default: '' }), allowDowngrade: S('Allow downgrade.', { default: 'false' }) }, steps: [{ name: 'updateAgent', action: 'aws:updateSsmAgent', inputs: {} }] },
  'AWS-GatherSoftwareInventory': { type: 'Command', description: 'Collect software inventory from the instance.', params: {}, steps: [{ name: 'collect', action: 'aws:softwareInventory', inputs: {} }] },
  'AWS-StopEC2Instance': { type: 'Automation', description: 'Stop an Amazon EC2 instance.', params: { InstanceId: S('(Required) The ID of the instance.'), AutomationAssumeRole: ROLE }, steps: [instStep('stopInstances', 'stopped')] },
  'AWS-StartEC2Instance': { type: 'Automation', description: 'Start an Amazon EC2 instance.', params: { InstanceId: S('(Required) The ID of the instance.'), AutomationAssumeRole: ROLE }, steps: [instStep('startInstances', 'running')] },
  'AWS-RestartEC2Instance': { type: 'Automation', description: 'Restart an Amazon EC2 instance (stop and start).', params: { InstanceId: S('(Required) The ID of the instance.'), AutomationAssumeRole: ROLE }, steps: [instStep('restartInstances', 'restarted')] },
  'AWS-TerminateEC2Instance': { type: 'Automation', description: 'Terminate an Amazon EC2 instance.', params: { InstanceId: S('(Required) The ID of the instance.'), AutomationAssumeRole: ROLE }, steps: [instStep('terminateInstances', 'terminated')] },
  'AWS-CreateImage': { type: 'Automation', description: 'Create an AMI from an instance.', params: { InstanceId: S('(Required) The ID of the instance.'), NoReboot: S('Do not reboot the instance.', { default: 'true' }), AutomationAssumeRole: ROLE }, steps: [{ name: 'createImage', action: 'aws:executeAwsApi', inputs: { Service: 'ec2', Api: 'CreateImage', InstanceId: '{{ InstanceId }}', Name: 'AWS-CreateImage-{{ global:DATE_TIME }}', NoReboot: true } }] },
  'AWS-DisablePublicAccessForSecurityGroup': { type: 'Automation', description: 'Remove the rules that open ports 22 and 3389 to the whole internet (0.0.0.0/0 and ::/0).', params: { GroupId: S('(Required) The ID of the security group.'), AutomationAssumeRole: ROLE }, steps: [{ name: 'revokePublicRules', action: 'aws:executeScript', inputs: { Native: 'revokePublicSg', GroupId: '{{ GroupId }}' } }] },
  'AWS-DisableS3BucketPublicReadWrite': { type: 'Automation', description: 'Turn on Block Public Access for an S3 bucket.', params: { S3BucketName: S('(Required) The name of the bucket.'), AutomationAssumeRole: ROLE }, steps: [{ name: 'blockPublicAccess', action: 'aws:executeAwsApi', inputs: { Service: 's3', Api: 'PutPublicAccessBlock', Bucket: '{{ S3BucketName }}', PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } } }] },
  'AWS-ConfigureS3BucketVersioning': { type: 'Automation', description: 'Enable or suspend versioning on an S3 bucket.', params: { BucketName: S('(Required) The name of the bucket.'), VersioningState: S('Enabled or Suspended.', { allowedValues: ['Enabled', 'Suspended'] }), AutomationAssumeRole: ROLE }, steps: [{ name: 'setVersioning', action: 'aws:executeAwsApi', inputs: { Service: 's3', Api: 'PutBucketVersioning', Bucket: '{{ BucketName }}', VersioningConfiguration: { Status: '{{ VersioningState }}' } } }] },
  'AWS-EnableS3BucketEncryption': { type: 'Automation', description: 'Set default encryption on an S3 bucket.', params: { BucketName: S('(Required) The name of the bucket.'), SSEAlgorithm: S('AES256 or aws:kms.', { default: 'AES256', allowedValues: ['AES256', 'aws:kms'] }), AutomationAssumeRole: ROLE }, steps: [{ name: 'setEncryption', action: 'aws:executeAwsApi', inputs: { Service: 's3', Api: 'PutBucketEncryption', Bucket: '{{ BucketName }}', ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: '{{ SSEAlgorithm }}' } }] } } }] },
  'AWS-PublishSNSNotification': { type: 'Automation', description: 'Publish a message to an SNS topic.', params: { TopicArn: S('(Required) The topic ARN.'), Message: S('(Required) The message.'), AutomationAssumeRole: ROLE }, steps: [{ name: 'publish', action: 'aws:executeAwsApi', inputs: { Service: 'sns', Api: 'Publish', TopicArn: '{{ TopicArn }}', Message: '{{ Message }}' } }] },
};

const ACTIONS_OK = ['aws:executeAwsApi', 'aws:changeInstanceState', 'aws:runCommand', 'aws:sleep', 'aws:invokeLambdaFunction', 'aws:assertAwsResourceProperty', 'aws:createTags', 'aws:executeScript', 'aws:runShellScript', 'aws:updateSsmAgent', 'aws:softwareInventory', 'aws:branch', 'aws:pause'];

// ───────────────────────── documentos propios ─────────────────────────

const docsOf = (a: Account, region: string): Record<string, SsmDocument> => (ssmOf(a, region).documents ??= {});
const docArn = (c: { acct: Account; region: string }, name: string, owner = true) => mkArn('ssm', c.region, owner ? c.acct.id : '', `document/${name}`);

interface Parsed {
  schemaVersion: string;
  description?: string;
  parameters: Record<string, ParamDef>;
  steps: StepDef[];
  assumeRole?: string;
}

function parseDoc(content: string, format: string, type: string): Parsed {
  let j: Record<string, any>;
  try {
    j = format === 'JSON' ? JSON.parse(content) : (parseTemplate(content) as Record<string, any>);
  } catch (e) {
    throw new AwsError('InvalidDocumentContent', format === 'JSON' ? `JSON not well-formed. ${(e as Error).message}` : `YAML not well-formed. ${(e as Error).message}`, 400);
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new AwsError('InvalidDocumentContent', 'The document content must be an object.', 400);
  const want = type === 'Automation' ? ['0.3'] : ['2.2', '1.2'];
  if (!j.schemaVersion || !want.includes(String(j.schemaVersion))) throw new AwsError('InvalidDocumentSchemaVersion', `The schema version ${j.schemaVersion ?? '(missing)'} is not valid for a ${type} document. Use ${want.join(' or ')}.`, 400);
  const steps = (j.mainSteps ?? j.runtimeConfig) as Record<string, any>[] | undefined;
  if (!Array.isArray(steps) || !steps.length) throw new AwsError('InvalidDocumentContent', 'Schema validation failed: mainSteps must be a non-empty list.', 400);
  const names = new Set<string>();
  const out: StepDef[] = steps.map((s, i) => {
    if (!s.name || typeof s.name !== 'string') throw new AwsError('InvalidDocumentContent', `Schema validation failed: step ${i + 1} has no name.`, 400);
    if (names.has(s.name)) throw new AwsError('InvalidDocumentContent', `Schema validation failed: the step name ${s.name} is repeated.`, 400);
    names.add(s.name);
    if (!ACTIONS_OK.includes(s.action)) throw new AwsError('InvalidDocumentContent', `Schema validation failed: step ${s.name}: the action ${s.action} is not supported (${ACTIONS_OK.slice(0, 8).join(', ')}…).`, 400);
    return { name: s.name, action: s.action, inputs: (s.inputs ?? {}) as Record<string, V>, outputs: s.outputs as OutDef[] | undefined, onFailure: s.onFailure };
  });
  for (const [k, d] of Object.entries((j.parameters ?? {}) as Record<string, ParamDef>)) if (!d || typeof d !== 'object' || !d.type) throw new AwsError('InvalidDocumentContent', `Schema validation failed: the parameter ${k} needs a type.`, 400);
  return { schemaVersion: String(j.schemaVersion), description: j.description, parameters: (j.parameters ?? {}) as Record<string, ParamDef>, steps: out, assumeRole: j.assumeRole };
}

const docView = (c: Pick<OpCtx, 'acct' | 'region'>, d: SsmDocument, p: Parsed) => ({
  Hash: iso(d.created).replace(/\W/g, '').padEnd(64, '0'),
  HashType: 'Sha256',
  Name: d.Name,
  Owner: d.Owner,
  CreatedDate: iso(d.created),
  Status: 'Active',
  DocumentVersion: String(d.DocumentVersion),
  ...(p.description ? { Description: p.description } : {}),
  Parameters: Object.entries(p.parameters).map(([Name, v]) => ({ Name, Type: v.type, ...(v.description ? { Description: v.description } : {}), ...(v.default !== undefined ? { DefaultValue: Array.isArray(v.default) ? JSON.stringify(v.default) : String(v.default) } : {}) })),
  PlatformTypes: ['Linux', 'MacOS', 'Windows'],
  DocumentType: d.DocumentType,
  SchemaVersion: p.schemaVersion,
  LatestVersion: String(d.DocumentVersion),
  DefaultVersion: '1',
  DocumentFormat: d.DocumentFormat,
  Tags: Object.entries(d.tags).map(([Key, Value]) => ({ Key, Value })),
});

const publicParsed = (name: string): Parsed => {
  const d = PUBLIC[name];
  return { schemaVersion: d.type === 'Automation' ? '0.3' : '2.2', description: d.description, parameters: d.params, steps: d.steps };
};

function findDoc(c: Pick<OpCtx, 'acct' | 'region'>, name: string): { doc?: SsmDocument; parsed: Parsed; owner: string; type: string } {
  const own = docsOf(c.acct, c.region)[name];
  if (own) return { doc: own, parsed: parseDoc(own.Content, own.DocumentFormat, own.DocumentType), owner: own.Owner, type: own.DocumentType };
  if (PUBLIC[name]) return { parsed: publicParsed(name), owner: 'Amazon', type: PUBLIC[name].type };
  throw new AwsError('InvalidDocument', `Document with name ${name} does not exist.`, 400);
}

tagHooks.Document = (c, id) => docsOf(c.acct, c.region)[id]?.tags;

op('ssm', 'create-document', 'content:s! requires:f attachments:f name:s! display-name:s version-name:s document-type:s document-format:s target-type:s tags:f', 'Crea un documento propio: de comandos (`Command`) o un runbook de automatización (`Automation`), en JSON o YAML.', { action: 'ssm:CreateDocument', res: (c) => docArn(c, String(c.p.Name)) }, (c) => {
  const name = String(c.p.Name);
  if (!/^[a-zA-Z0-9_\-.]{3,128}$/.test(name)) throw new AwsError('ValidationException', `1 validation error detected: Value '${name}' at 'name' failed to satisfy constraint: Member must satisfy regular expression pattern: ^[a-zA-Z0-9_\\-.]{3,128}$`, 400);
  if (/^(aws|amazon|amzn)/i.test(name)) throw new AwsError('ValidationException', 'Document names can\'t start with "aws", "amazon" or "amzn".', 400);
  const type = (c.p.DocumentType as string | undefined) ?? 'Command';
  if (!['Command', 'Automation', 'Session', 'Policy'].includes(type)) throw new AwsError('ValidationException', `Invalid document type ${type}.`, 400);
  const format = (c.p.DocumentFormat as string | undefined) ?? 'JSON';
  if (!['JSON', 'YAML'].includes(format)) throw new AwsError('ValidationException', `Invalid document format ${format}.`, 400);
  const docs = docsOf(c.acct, c.region);
  if (docs[name]) throw new AwsError('DocumentAlreadyExists', 'The specified document already exists.', 400);
  if (type !== 'Command' && type !== 'Automation') throw new AwsError('ValidationException', 'Only Command and Automation documents can be created in this simulator.', 400);
  const parsed = parseDoc(String(c.p.Content), format, type);
  const d: SsmDocument = { Name: name, DocumentType: type as SsmDocument['DocumentType'], Content: String(c.p.Content), DocumentFormat: format as 'JSON' | 'YAML', DocumentVersion: 1, Owner: c.acct.id, created: c.acct.clock, Description: parsed.description, tags: Object.fromEntries(toArr<{ Key: string; Value: string }>(c.p.Tags).map((t) => [t.Key, t.Value])) };
  docs[name] = d;
  return { DocumentDescription: { ...docView(c, d, parsed), Status: 'Creating' } };
});

op('ssm', 'update-document', 'content:s! name:s! document-version:s document-format:s target-type:s', 'Sube una versión nueva de un documento propio.', { action: 'ssm:UpdateDocument', res: (c) => docArn(c, String(c.p.Name)) }, (c) => {
  const d = docsOf(c.acct, c.region)[c.p.Name];
  if (!d) throw new AwsError('InvalidDocument', `Document with name ${c.p.Name} does not exist.`, 400);
  const fmt = (c.p.DocumentFormat as string | undefined) ?? d.DocumentFormat;
  const parsed = parseDoc(String(c.p.Content), fmt, d.DocumentType);
  d.Content = String(c.p.Content);
  d.DocumentFormat = fmt as 'JSON' | 'YAML';
  d.DocumentVersion++;
  return { DocumentDescription: docView(c, d, parsed) };
});

op('ssm', 'delete-document', 'name:s! document-version:s version-name:s force:b', 'Borra un documento propio.', { action: 'ssm:DeleteDocument', res: (c) => docArn(c, String(c.p.Name)) }, (c) => {
  const docs = docsOf(c.acct, c.region);
  if (!docs[c.p.Name]) throw new AwsError('InvalidDocument', `Document with name ${c.p.Name} does not exist.`, 400);
  const inUse = Object.values(ssmOf(c.acct, c.region).assocs ?? {}).some((x) => x.Name === c.p.Name);
  if (inUse && !c.p.Force) throw new AwsError('AssociatedInstances', 'You must disassociate the document from all instances before deleting it.', 400);
  delete docs[c.p.Name];
  return {};
});

op('ssm', 'describe-document', 'name:s! document-version:s version-name:s', 'Datos de un documento: tipo, parámetros, versión…', { action: 'ssm:DescribeDocument', res: (c) => docArn(c, String(c.p.Name)) }, (c) => {
  const f = findDoc(c, c.p.Name);
  if (f.doc) return { Document: docView(c, f.doc, f.parsed) };
  return { Document: { Hash: 'a'.repeat(64), HashType: 'Sha256', Name: c.p.Name, Owner: 'Amazon', CreatedDate: iso(c.acct.clock - 400 * 86400000), Status: 'Active', DocumentVersion: '1', Description: f.parsed.description, Parameters: Object.entries(f.parsed.parameters).map(([Name, v]) => ({ Name, Type: v.type, Description: v.description, ...(v.default !== undefined ? { DefaultValue: String(v.default) } : {}) })), PlatformTypes: ['Linux'], DocumentType: f.type, SchemaVersion: f.parsed.schemaVersion, LatestVersion: '1', DefaultVersion: '1', DocumentFormat: 'JSON', Tags: [] } };
});

op('ssm', 'get-document', 'name:s! version-name:s document-version:s document-format:s', 'Contenido (JSON o YAML) de un documento.', { action: 'ssm:GetDocument', res: (c) => docArn(c, String(c.p.Name)) }, (c) => {
  const f = findDoc(c, c.p.Name);
  const content = f.doc ? f.doc.Content : JSON.stringify({ schemaVersion: f.parsed.schemaVersion, description: f.parsed.description, parameters: f.parsed.parameters, mainSteps: f.parsed.steps.map((s) => ({ name: s.name, action: s.action, inputs: s.inputs })) }, null, 2);
  return { Name: c.p.Name, CreatedDate: iso(f.doc?.created ?? c.acct.clock - 400 * 86400000), DocumentVersion: String(f.doc?.DocumentVersion ?? 1), Status: 'Active', Content: content, DocumentType: f.type, DocumentFormat: f.doc?.DocumentFormat ?? 'JSON' };
});

op('ssm', 'list-documents', 'document-filter-list:f filters:f max-results:i', 'Lista los documentos (`--filters Key=Owner,Values=Self` para los tuyos).', { paginate: 'DocumentIdentifiers', action: 'ssm:ListDocuments', res: () => '*' }, (c) => {
  const fl = normTargets(c.p.Filters);
  const own = Object.values(docsOf(c.acct, c.region)).map((d) => ({ Name: d.Name, Owner: d.Owner, VersionName: '', PlatformTypes: ['Linux'], DocumentVersion: String(d.DocumentVersion), DocumentType: d.DocumentType, SchemaVersion: d.DocumentType === 'Automation' ? '0.3' : '2.2', DocumentFormat: d.DocumentFormat, TargetType: '', Tags: Object.entries(d.tags).map(([Key, Value]) => ({ Key, Value })) }));
  const pub = Object.entries(PUBLIC).map(([Name, d]) => ({ Name, Owner: 'Amazon', VersionName: '', PlatformTypes: ['Linux'], DocumentVersion: '1', DocumentType: d.type, SchemaVersion: d.type === 'Automation' ? '0.3' : '2.2', DocumentFormat: 'JSON', TargetType: '', Tags: [] as { Key: string; Value: string }[] }));
  const ownerFilter = fl.find((f) => f.Key === 'Owner')?.Values ?? [];
  let list = [...own, ...pub];
  if (ownerFilter.length) list = list.filter((d) => ownerFilter.some((o) => (o === 'Self' ? d.Owner === c.acct.id : o === 'Amazon' ? d.Owner === 'Amazon' : o === 'All' || o === d.Owner)));
  const typeFilter = fl.find((f) => f.Key === 'DocumentType')?.Values;
  if (typeFilter) list = list.filter((d) => typeFilter.includes(d.DocumentType));
  const nameFilter = fl.find((f) => f.Key === 'Name')?.Values;
  if (nameFilter) list = list.filter((d) => nameFilter.includes(d.Name));
  return { DocumentIdentifiers: list.sort((x, y) => (x.Name < y.Name ? -1 : 1)) };
});

op('ssm', 'list-document-versions', 'name:s! max-results:i', 'Versiones de un documento propio.', { paginate: 'DocumentVersions', action: 'ssm:ListDocumentVersions', res: (c) => docArn(c, String(c.p.Name)) }, (c) => {
  const d = docsOf(c.acct, c.region)[c.p.Name];
  if (!d) throw new AwsError('InvalidDocument', `Document with name ${c.p.Name} does not exist.`, 400);
  return { DocumentVersions: Array.from({ length: d.DocumentVersion }, (_, i) => ({ Name: d.Name, DocumentVersion: String(i + 1), CreatedDate: iso(d.created), IsDefaultVersion: i === 0, DocumentFormat: d.DocumentFormat, Status: 'Active' })) };
});

// ───────────────────────── documentos de comandos propios ─────────────────────────

const lookupParam = (params: Record<string, string[]>, def: Record<string, ParamDef>, name: string): V => {
  const given = params[name];
  if (given !== undefined) return def[name]?.type === 'StringList' ? given : given.length === 1 ? given[0] : given;
  return def[name]?.default;
};

function substStr(s: string, get: (k: string) => V | undefined): V {
  const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(s);
  if (whole) {
    const v = get(whole[1]);
    return v === undefined ? s : v;
  }
  return s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => {
    const v = get(k);
    return v === undefined ? m : Array.isArray(v) ? v.join(',') : String(v);
  });
}

function deepSubst(v: V, get: (k: string) => V | undefined): V {
  if (typeof v === 'string') return substStr(v, get);
  if (Array.isArray(v)) return v.flatMap((x) => {
    const r = deepSubst(x, get);
    return typeof x === 'string' && /^\{\{\s*[^{}]+\s*\}\}$/.test(x) && Array.isArray(r) ? r : [r];
  });
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, V>).map(([k, x]) => [k, deepSubst(x, get)]));
  return v;
}

customCommandDoc.find = (a, region, name) => {
  const d = docsOf(a, region)[name];
  if (!d || d.DocumentType !== 'Command') return undefined;
  const p = parseDoc(d.Content, d.DocumentFormat, 'Command');
  return (acc, reg, inst, given): CmdResult => {
    for (const k of Object.keys(p.parameters)) if (p.parameters[k].default === undefined && given[k] === undefined) throw new AwsError('InvalidParameters', `Parameter ${k} is required for document ${name}.`, 400);
    const get = (k: string): V | undefined => (k.startsWith('global:') ? undefined : lookupParam(given, p.parameters, k));
    let out = '';
    let err = '';
    let code = 0;
    for (const st of p.steps) {
      if (st.action !== 'aws:runShellScript') continue;
      const lines = toArr(deepSubst(st.inputs.runCommand, get) as string | string[]).map(String);
      const r = commandDocs['AWS-RunShellScript'](acc, reg, inst, { commands: lines });
      out += r.out;
      err += r.err;
      code = r.code;
      if (code !== 0) break;
    }
    return { out, err, code };
  };
};

// ───────────────────────── Automation ─────────────────────────

class StepFail extends Error {}

interface RunCtx {
  a: Account;
  region: string;
  caller: Caller | null;
  params: Record<string, V>;
  outputs: Record<string, Record<string, V>>;
  /** Milisegundos «virtuales» que dura la ejecución (no avanzan el reloj). */
  spent: number;
}

const kebab = (api: string) => api.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase();

function call(ctx: RunCtx, service: string, api: string, params: Record<string, V>): Record<string, any> {
  const r = sdkCall(ctx.a, ctx.region, ctx.caller, service, kebab(api), params);
  if (!r.ok) throw new StepFail(`Step fails when it is Poll action status for completion. Error: ${r.error!.Code}: ${r.error!.Message}`);
  return r.data ?? {};
}

const dur = (iso8601: string): number => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso8601);
  if (!m) throw new StepFail(`Invalid Duration ${iso8601}: use an ISO 8601 duration such as PT30S.`);
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
};

const STATE_API: Record<string, string> = { running: 'start-instances', stopped: 'stop-instances', terminated: 'terminate-instances' };

type Handler = (ctx: RunCtx, inputs: Record<string, V>) => Record<string, V>;

const NATIVE: Record<string, Handler> = {
  revokePublicSg: (ctx, inp) => {
    const id = String(inp.GroupId);
    const sg = regional(ctx.a, ctx.region).ec2.securityGroups[id];
    if (!sg) throw new StepFail(`Step fails when it is Poll action status for completion. Error: InvalidGroup.NotFound: The security group '${id}' does not exist`);
    let n = 0;
    for (const p of [...sg.IpPermissions]) {
      const world = p.IpRanges.some((r) => r.CidrIp === '0.0.0.0/0') || p.Ipv6Ranges.some((r) => r.CidrIpv6 === '::/0');
      const risky = p.IpProtocol === '-1' || [22, 3389].some((x) => (p.FromPort ?? 0) <= x && x <= (p.ToPort ?? 65535));
      if (!world || !risky) continue;
      const perm: Record<string, V> = { IpProtocol: p.IpProtocol, ...(p.FromPort !== undefined ? { FromPort: p.FromPort, ToPort: p.ToPort } : {}), IpRanges: p.IpRanges.filter((r) => r.CidrIp === '0.0.0.0/0').map((r) => ({ CidrIp: r.CidrIp })), Ipv6Ranges: p.Ipv6Ranges.filter((r) => r.CidrIpv6 === '::/0').map((r) => ({ CidrIpv6: r.CidrIpv6 })) };
      call(ctx, 'ec2', 'RevokeSecurityGroupIngress', { GroupId: id, IpPermissions: [perm] });
      n++;
    }
    return { RevokedRules: [String(n)] };
  },
};

const instancesOf = (ctx: RunCtx, raw: V): string[] => toArr(raw as string | string[]).map(String);

const ACTIONS: Record<string, Handler> = {
  'aws:executeAwsApi': (ctx, inp) => {
    const { Service, Api, ...rest } = inp as { Service: string; Api: string } & Record<string, V>;
    if (!Service || !Api) throw new StepFail('aws:executeAwsApi needs Service and Api.');
    const data = call(ctx, String(Service), String(Api), rest);
    return { __data: data } as Record<string, V>;
  },
  'aws:changeInstanceState': (ctx, inp) => {
    const state = String(inp.DesiredState);
    // `restarted`: parar, esperar a que pare del todo y volver a arrancar (todo en un paso, como en AWS)
    if (state === 'restarted') {
      const ids = instancesOf(ctx, inp.InstanceIds);
      call(ctx, 'ec2', 'stop-instances', { InstanceIds: ids });
      settleEc2(ctx.a);
      call(ctx, 'ec2', 'start-instances', { InstanceIds: ids });
      ctx.spent += 30000;
      return { __data: { InstanceIds: ids } } as Record<string, V>;
    }
    const api = STATE_API[state];
    if (!api) throw new StepFail(`DesiredState ${state} is not supported (running, stopped, restarted, terminated).`);
    const ids = instancesOf(ctx, inp.InstanceIds);
    call(ctx, 'ec2', api, { InstanceIds: ids });
    ctx.spent += 12000;
    return { __data: { InstanceIds: ids } } as Record<string, V>;
  },
  'aws:runCommand': (ctx, inp) => {
    const ids = instancesOf(ctx, inp.InstanceIds);
    if (!ids.length) throw new StepFail('aws:runCommand needs InstanceIds.');
    let list;
    try {
      list = sendCommand(ctx.a, ctx.region, String(inp.DocumentName), inp.Parameters, ids).list;
    } catch (e) {
      throw new StepFail(`Step fails when it is Poll action status for completion. Error: ${(e as Error).message}`);
    }
    ctx.spent += 7000;
    const bad = list.find((x) => x.Status !== 'Success');
    if (bad) throw new StepFail(`Step fails when it is verifying the command has completed. Command ${bad.CommandId} on ${bad.InstanceId} finished with Failed: ${bad.StandardErrorContent.trim()}`);
    return { CommandId: [list[0].CommandId], Output: [list.map((x) => x.StandardOutputContent).join('\n')] };
  },
  'aws:sleep': (ctx, inp) => {
    ctx.spent += dur(String(inp.Duration));
    return {};
  },
  'aws:invokeLambdaFunction': (ctx, inp) => {
    let out;
    try {
      out = invokeSync(ctx.a, ctx.region, String(inp.FunctionName), inp.Payload === undefined ? {} : typeof inp.Payload === 'string' ? JSON.parse(inp.Payload) : inp.Payload, { service: 'ssm.amazonaws.com' });
    } catch (e) {
      throw new StepFail(`Step fails when it is invoking the function. Error: ${(e as Error).message}`);
    }
    ctx.spent += Math.ceil(out.durationMs);
    if (out.functionError) throw new StepFail(`Step fails when it is invoking the function. The function returned an error: ${out.payload}`);
    return { Payload: [out.payload], StatusCode: [String(out.statusCode)] };
  },
  'aws:assertAwsResourceProperty': (ctx, inp) => {
    const { Service, Api, PropertySelector, DesiredValues, ...rest } = inp as Record<string, V>;
    const data = call(ctx, String(Service), String(Api), rest as Record<string, V>);
    const got = jsonPath(data, String(PropertySelector)).map(String);
    const want = toArr(DesiredValues as string | string[]).map(String);
    if (!got.some((g) => want.includes(g))) throw new StepFail(`Step fails when it is verifying the property: ${PropertySelector} is ${got.join(',') || '(empty)'} but one of [${want.join(', ')}] was expected.`);
    return {};
  },
  'aws:createTags': (ctx, inp) => {
    call(ctx, 'ec2', 'CreateTags', { Resources: toArr(inp.ResourceIds as string | string[]), Tags: inp.Tags as V });
    return {};
  },
  'aws:executeScript': (ctx, inp) => {
    if (inp.Native) return NATIVE[String(inp.Native)](ctx, inp);
    if (!String(inp.Runtime ?? '').startsWith('python')) throw new StepFail(`The runtime ${inp.Runtime ?? '(missing)'} is not supported: this simulator runs Python scripts.`);
    const handler = String(inp.Handler ?? 'script_handler');
    const session = new PySession({ files: {}, now: ctx.a.clock, seed: 7, maxSteps: 2_000_000 });
    const payload = JSON.stringify(inp.InputPayload ?? {});
    const code = `${String(inp.Script)}\nimport json as __j\n__out__ = None\n__err__ = None\ntry:\n    __out__ = __j.dumps(${handler}(__j.loads(${JSON.stringify(payload)}), {}))\nexcept BaseException as __e:\n    __err__ = type(__e).__name__ + ': ' + str(__e)\n`;
    const run = session.runSync(code);
    const err = session.I.mainGlobals!.get('__err__');
    if (!run.ok || (typeof err === 'string' && err)) throw new StepFail(`Step fails when it is executing the script. ${typeof err === 'string' && err ? err : run.stderr.trim()}`);
    const out = session.I.mainGlobals!.get('__out__');
    ctx.spent += 3000;
    let parsed: unknown = null;
    try {
      parsed = typeof out === 'string' ? JSON.parse(out) : null;
    } catch {
      /* sin salida */
    }
    return { __data: { Payload: parsed } } as Record<string, V>;
  },
  'aws:pause': () => {
    throw new StepFail('Step is waiting for a signal that this simulator cannot send.');
  },
};

interface OutDef {
  Name: string;
  Selector: string;
  Type?: string;
}

/** Ejecuta un documento de automatización con unos parámetros; devuelve la ejecución ya calculada. */
export function automationStart(a: Account, region: string, caller: Caller | null, docName: string, rawParams: Record<string, unknown>, o: { by?: string } = {}): SsmAutomation {
  const f = ((): { parsed: Parsed; version: string } => {
    const own = docsOf(a, region)[docName];
    if (own) {
      if (own.DocumentType !== 'Automation') throw new AwsError('InvalidDocumentType', `The document ${docName} is not an Automation document.`, 400);
      return { parsed: parseDoc(own.Content, own.DocumentFormat, 'Automation'), version: String(own.DocumentVersion) };
    }
    if (PUBLIC[docName]?.type === 'Automation') return { parsed: publicParsed(docName), version: '1' };
    throw new AwsError('InvalidDocument', `Automation definition ${docName} could not be found.`, 400);
  })();
  const p = f.parsed;
  const params: Record<string, V> = {};
  const given = Object.fromEntries(Object.entries(rawParams ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]));
  for (const k of Object.keys(given)) if (!p.parameters[k]) throw new AwsError('InvalidAutomationExecutionParametersException', `The parameter ${k} is not defined in the document ${docName}.`, 400);
  for (const [k, d] of Object.entries(p.parameters)) {
    let v: V = given[k] !== undefined ? (d.type === 'StringList' ? given[k] : given[k].length === 1 ? given[k][0] : given[k]) : d.default;
    if (v === undefined) throw new AwsError('InvalidAutomationExecutionParametersException', `Automation Execution Parameters for ${docName} are invalid: ${k} is required.`, 400);
    if (d.allowedValues && !d.allowedValues.includes(String(v))) throw new AwsError('InvalidAutomationExecutionParametersException', `Automation Execution Parameters for ${docName} are invalid: ${k} must be one of [${d.allowedValues.join(', ')}].`, 400);
    if (d.type === 'Integer' && !/^-?\d+$/.test(String(v))) throw new AwsError('InvalidAutomationExecutionParametersException', `Automation Execution Parameters for ${docName} are invalid: ${k} must be an integer.`, 400);
    if (d.type === 'Boolean') v = String(v) === 'true';
    if (d.type === 'Integer') v = Number(v);
    params[k] = v;
  }
  const id = newId(a, 'ssmauto', '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  const exec: SsmAutomation = { AutomationExecutionId: id, DocumentName: docName, DocumentVersion: f.version, Status: 'Success', StartTime: a.clock, EndTime: a.clock, Parameters: Object.fromEntries(Object.entries(given)), Outputs: {}, Steps: [], ExecutedBy: o.by ?? caller?.arn ?? `arn:aws:iam::${a.id}:root` };
  const stateOf = ssmOf(a, region);
  (stateOf.automations ??= {})[id] = exec;
  // identidad con la que se ejecutan los pasos
  let runAs: Caller | null = caller;
  const role = String(params.AutomationAssumeRole ?? p.assumeRole ?? '');
  if (role) {
    const roleName = role.split('/').pop() ?? '';
    if (!a.iam.roles[roleName] || !roleTrusts(a, role, 'ssm.amazonaws.com')) {
      exec.Status = 'Failed';
      exec.FailureMessage = `Step fails when it is Initializing action. Unable to assume role ${role}: the role must exist and trust ssm.amazonaws.com.`;
      exec.EndTime = a.clock + 2000;
      return exec;
    }
    runAs = roleCaller(a, role, 'Automation');
  }
  const ctx: RunCtx = { a, region, caller: runAs, params, outputs: {}, spent: 0 };
  const get = (k: string): V | undefined => {
    if (k === 'global:REGION') return region;
    if (k === 'global:ACCOUNT_ID') return a.id;
    if (k === 'global:DATE_TIME') return iso(a.clock).replace(/[-:+T]/g, '').slice(0, 14);
    if (k === 'global:DATE') return iso(a.clock).slice(0, 10);
    if (k.startsWith('ssm:')) return paramsOf(a, region)[k.slice(4)]?.Value;
    if (k in params) return params[k];
    const [step, out] = k.split('.');
    return ctx.outputs[step]?.[out];
  };
  for (const st of p.steps) {
    const step: SsmAutomationStep = { StepName: st.name, Action: st.action, StepStatus: 'Pending', StartTime: a.clock + ctx.spent, EndTime: a.clock + ctx.spent, Outputs: {} };
    exec.Steps.push(step);
  }
  let failed = false;
  p.steps.forEach((st, i) => {
    const step = exec.Steps[i];
    if (failed) {
      step.StepStatus = 'Cancelled';
      return;
    }
    step.StartTime = a.clock + ctx.spent;
    step.StepStatus = 'InProgress';
    try {
      const inputs = deepSubst(st.inputs, get) as Record<string, V>;
      const handler = ACTIONS[st.action];
      if (!handler) throw new StepFail(`The action ${st.action} is not supported by this simulator.`);
      const res = handler(ctx, inputs);
      const data = (res as { __data?: unknown }).__data;
      const outs: Record<string, V> = {};
      for (const [k, v] of Object.entries(res)) if (k !== '__data') outs[k] = v;
      for (const od of toArr(st.outputs ?? [])) {
        if (data !== undefined) outs[od.Name] = jsonPath(data, od.Selector).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
      }
      ctx.outputs[st.name] = outs;
      step.Outputs = Object.fromEntries(Object.entries(outs).map(([k, v]) => [k, toArr(v as string | string[]).map(String)]));
      ctx.spent += 3000;
      step.StepStatus = 'Success';
    } catch (e) {
      if (!(e instanceof StepFail) && !(e instanceof AwsError)) throw e;
      step.StepStatus = 'Failed';
      step.FailureMessage = e.message;
      ctx.spent += 2000;
      if (st.onFailure === 'Continue') return;
      failed = true;
      exec.Status = 'Failed';
      exec.FailureMessage = `Step fails when it is ${step.FailureMessage.replace(/^Step fails when it is /, '')} Please refer to Automation Service Troubleshooting Guide for more diagnosis details.`;
    }
    step.EndTime = a.clock + ctx.spent;
  });
  for (const step of exec.Steps) if (step.EndTime < step.StartTime) step.EndTime = step.StartTime;
  exec.EndTime = a.clock + ctx.spent;
  if (!failed) exec.Outputs = Object.fromEntries(Object.entries(ctx.outputs).flatMap(([s, o]) => Object.entries(o).map(([k, v]) => [`${s}.${k}`, toArr(v as string | string[]).map(String)])));
  return exec;
}

/** Estado según el reloj: mientras no pase el tiempo que dura, sigue «en marcha». */
const statusNow = (a: Account, x: SsmAutomation): SsmAutomation['Status'] => (x.Status === 'Cancelled' ? 'Cancelled' : a.clock < x.EndTime ? (a.clock <= x.StartTime ? 'Pending' : 'InProgress') : x.Status);

const execView = (a: Account, x: SsmAutomation, detail = true) => {
  const st = statusNow(a, x);
  return {
    AutomationExecutionId: x.AutomationExecutionId,
    DocumentName: x.DocumentName,
    DocumentVersion: x.DocumentVersion,
    ExecutionStartTime: iso(x.StartTime),
    ...(st === 'Pending' || st === 'InProgress' ? {} : { ExecutionEndTime: iso(x.EndTime) }),
    AutomationExecutionStatus: st,
    ...(detail
      ? {
          StepExecutions: x.Steps.map((s) => ({
            StepName: s.StepName,
            Action: s.Action,
            ExecutionStartTime: iso(s.StartTime),
            ExecutionEndTime: iso(s.EndTime),
            StepStatus: a.clock < s.EndTime && s.StepStatus === 'Success' ? 'InProgress' : s.StepStatus,
            ResponseCode: s.StepStatus === 'Success' ? '200' : s.StepStatus === 'Failed' ? '400' : '',
            Inputs: {},
            Outputs: s.Outputs,
            ...(s.FailureMessage ? { FailureMessage: s.FailureMessage } : {}),
          })),
        }
      : {}),
    Parameters: x.Parameters,
    Outputs: x.Outputs,
    ...(x.FailureMessage && st === 'Failed' ? { FailureMessage: x.FailureMessage } : {}),
    Mode: 'Auto',
    ExecutedBy: x.ExecutedBy,
    CurrentStepName: x.Steps.find((s) => s.StepStatus === 'Failed' || a.clock < s.EndTime)?.StepName,
  };
};

const automationArn = (c: Pick<OpCtx, 'acct' | 'region'>, name: string) => mkArn('ssm', c.region, c.acct.id, `automation-definition/${name}:$DEFAULT`);
const publicAutomationArn = (c: Pick<OpCtx, 'acct' | 'region'>, name: string) => mkArn('ssm', c.region, '', `automation-definition/${name}:$DEFAULT`);

op(
  'ssm',
  'start-automation-execution',
  'document-name:s! document-version:s parameters:j client-token:s mode:s target-parameter-name:s targets:f tags:f',
  'Ejecuta un runbook de Automation (`AWS-StopEC2Instance`, el tuyo…) con los permisos de `AutomationAssumeRole`.',
  {
    authz: (c) => [
      { action: 'ssm:StartAutomationExecution', resource: PUBLIC[String(c.p.DocumentName)] ? publicAutomationArn(c, String(c.p.DocumentName)) : automationArn(c, String(c.p.DocumentName)) },
      ...(((c.p.Parameters as Record<string, unknown> | undefined)?.AutomationAssumeRole) ? [{ action: 'iam:PassRole', resource: String(toArr((c.p.Parameters as Record<string, string | string[]>).AutomationAssumeRole)[0]), context: { 'iam:PassedToService': 'ssm.amazonaws.com' } }] : []),
    ],
  },
  (c) => {
    const x = automationStart(c.acct, c.region, c.caller, String(c.p.DocumentName), (c.p.Parameters ?? {}) as Record<string, unknown>);
    return { AutomationExecutionId: x.AutomationExecutionId };
  },
);

op('ssm', 'get-automation-execution', 'automation-execution-id:s!', 'Estado de una ejecución de Automation: cada paso, sus salidas y el motivo de un fallo.', { action: 'ssm:GetAutomationExecution', res: () => '*' }, (c) => {
  const x = ssmOf(c.acct, c.region).automations?.[c.p.AutomationExecutionId];
  if (!x) throw new AwsError('AutomationExecutionNotFoundException', `Automation Execution ${c.p.AutomationExecutionId} not found.`, 400);
  return { AutomationExecution: execView(c.acct, x) };
});

op('ssm', 'describe-automation-executions', 'filters:f max-results:i', 'Lista las ejecuciones de Automation.', { paginate: 'AutomationExecutionMetadataList', action: 'ssm:DescribeAutomationExecutions', res: () => '*' }, (c) => {
  const fl = normTargets(c.p.Filters);
  const list = Object.values(ssmOf(c.acct, c.region).automations ?? {}).filter((x) => fl.every((f) => (f.Key === 'DocumentNamePrefix' ? f.Values.some((v) => x.DocumentName.startsWith(v)) : f.Key === 'ExecutionStatus' ? f.Values.includes(statusNow(c.acct, x)) : true)));
  return { AutomationExecutionMetadataList: list.sort((x, y) => y.StartTime - x.StartTime).map((x) => ({ ...execView(c.acct, x, false), LogFile: '' })) };
});

op('ssm', 'describe-automation-step-executions', 'automation-execution-id:s! filters:f reverse-order:b', 'Los pasos de una ejecución.', { action: 'ssm:DescribeAutomationStepExecutions', res: () => '*' }, (c) => {
  const x = ssmOf(c.acct, c.region).automations?.[c.p.AutomationExecutionId];
  if (!x) throw new AwsError('AutomationExecutionNotFoundException', `Automation Execution ${c.p.AutomationExecutionId} not found.`, 400);
  return { StepExecutions: (execView(c.acct, x) as { StepExecutions: unknown[] }).StepExecutions };
});

op('ssm', 'stop-automation-execution', 'automation-execution-id:s! type:s', 'Cancela una ejecución que sigue en marcha.', { action: 'ssm:StopAutomationExecution', res: () => '*' }, (c) => {
  const x = ssmOf(c.acct, c.region).automations?.[c.p.AutomationExecutionId];
  if (!x) throw new AwsError('AutomationExecutionNotFoundException', `Automation Execution ${c.p.AutomationExecutionId} not found.`, 400);
  if (c.acct.clock >= x.EndTime) throw new AwsError('InvalidAutomationStatusUpdateException', `Automation Execution ${x.AutomationExecutionId} is already ${x.Status}.`, 400);
  x.Status = 'Cancelled';
  x.EndTime = c.acct.clock;
  return {};
});

// ───────────────────────── enlaces con Config y EventBridge ─────────────────────────

remediationRunner.run = (a, region, doc, params) => {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v]));
  const role = flat.AutomationAssumeRole?.[0];
  if (!role) throw new Error('AutomationAssumeRole is required for the remediation to run.');
  const x = automationStart(a, region, null, doc, flat, { by: `arn:aws:iam::${a.id}:role/aws-service-role/ssm.amazonaws.com/AWSServiceRoleForAmazonSSM` });
  if (x.Status === 'Failed' && x.Steps.every((s) => s.StepStatus !== 'Success')) throw new Error(x.FailureMessage ?? 'The automation failed.');
  return x.AutomationExecutionId;
};

targetHooks.push((a, region, t, input) => {
  const m = /^arn:aws:ssm:([^:]*):(\d*):(automation-definition|document)\/([^:/]+)/.exec(t.Arn);
  if (!m) return false;
  const reg = m[1] || region;
  if (m[3] === 'automation-definition') {
    const params = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const caller = t.RoleArn ? roleCaller(a, t.RoleArn, 'EventBridge') : null;
    automationStart(a, reg, caller, m[4], params, { by: t.RoleArn ?? undefined });
    return true;
  }
  // Run Command como destino: documento + etiquetas de las instancias
  const targets = (t as unknown as { RunCommandParameters?: { RunCommandTargets?: { Key: string; Values: string[] }[] } }).RunCommandParameters?.RunCommandTargets;
  const ids = resolveTargets(a, reg, [], targets);
  if (ids.length) sendCommand(a, reg, m[4], typeof input === 'object' && input !== null ? input : {}, ids);
  return true;
});

