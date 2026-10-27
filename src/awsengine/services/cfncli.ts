/** Órdenes de alto nivel de `aws cloudformation`: `package` (sube el código local a S3) y `deploy` (conjunto de cambios + ejecución en un solo paso). */
import { md5 } from '../../engine/commands/hash';
import { makeZip } from '../../engine/commands/archive';
import { AwsError, Raw, op } from '../registry';
import { sdkCall } from '../sdk';
import type { Rec } from '../types';
import { isObj, toArr } from '../util';
import { dumpYaml } from '../yaml';
import { activeStacks, cfnOf, createChangeSet, executeChangeSet, loadTemplate, stackStatus } from './cfn';

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.');
const join = (a: string, b: string) => (b.startsWith('/') ? b : `${a === '.' ? '' : a.replace(/\/$/, '') + '/'}${b.replace(/^\.\//, '')}`);

op('cloudformation', 'package', 'template-file:s! s3-bucket:s! s3-prefix:s output-template-file:s use-json:b force-upload:b kms-key-id:s', 'Sube a S3 el código local al que apunta la plantilla (`CodeUri` o `Code`) y escribe una plantilla nueva con las rutas de S3: lista para `deploy`.', { res: () => '*', authz: false }, (c) => {
  const file = c.io.abs(String(c.p.TemplateFile));
  const text = c.io.readFile(file);
  if (text === null) throw new AwsError('InvalidTemplatePath', `Invalid template path ${c.p.TemplateFile}`, 255);
  const l = loadTemplate(text);
  const tpl = l.tpl;
  const base = dirname(file);
  const prefix = c.p.S3Prefix ? String(c.p.S3Prefix).replace(/\/$/, '') + '/' : '';
  const upload = (path: string, owner: string): { bucket: string; key: string } => {
    const full = join(base, path);
    let zip: string;
    const files = c.io.listFiles(full);
    if (files && c.io.isDir(full)) zip = makeZip(Object.fromEntries(files.map((f) => [f.rel, f.content])));
    else {
      const body = c.io.readFile(full);
      if (body === null) throw new AwsError('InvalidTemplate', `Unable to upload artifact ${path} referenced by CodeUri parameter of ${owner} resource.\nParameter ${'CodeUri'} of resource ${owner} refers to a file or folder that does not exist ${full}`, 255);
      zip = makeZip({ [path.split('/').pop() ?? 'index']: body });
    }
    const key = prefix + md5(zip);
    const r = sdkCall(c.acct, c.region, c.caller, 's3api', 'put-object', { Bucket: c.p.S3Bucket, Key: key, Body: zip });
    if (!r.ok) throw new AwsError(r.error!.Code, `Unable to upload artifact ${path} referenced by CodeUri parameter of ${owner} resource.\n${r.error!.Message}`, 255);
    return { bucket: String(c.p.S3Bucket), key };
  };
  for (const [id, def] of Object.entries((tpl.Resources ?? {}) as Record<string, Rec>)) {
    const p = isObj(def.Properties) ? (def.Properties as Rec) : undefined;
    if (!p) continue;
    if (def.Type === 'AWS::Serverless::Function' && typeof p.CodeUri === 'string' && !p.CodeUri.startsWith('s3://')) {
      const u = upload(p.CodeUri, id);
      p.CodeUri = `s3://${u.bucket}/${u.key}`;
    } else if (def.Type === 'AWS::Lambda::Function' && isObj(p.Code) === false && typeof p.Code === 'string') {
      const u = upload(p.Code, id);
      p.Code = { S3Bucket: u.bucket, S3Key: u.key };
    }
  }
  const asJson = l.isJson || !!c.p.UseJson;
  const out = asJson ? JSON.stringify(tpl, null, 2) + '\n' : dumpYaml(tpl);
  if (c.p.OutputTemplateFile) {
    const path = c.io.abs(String(c.p.OutputTemplateFile));
    c.io.writeFile(path, out);
    return new Raw(`Successfully packaged artifacts and wrote output template to file ${c.p.OutputTemplateFile}.\nExecute the following command to deploy the packaged template\naws cloudformation deploy --template-file ${path} --stack-name <YOUR STACK NAME>\n`);
  }
  return new Raw(out);
});

op('cloudformation', 'deploy', 'template-file:s! stack-name:s! parameter-overrides:l capabilities:l fail-on-empty-changeset:b role-arn:s tags:l', 'Crea o actualiza la pila con un conjunto de cambios y lo ejecuta, esperando al final. Si no hay cambios, falla (salvo `--no-fail-on-empty-changeset`).', { res: () => '*' }, (c) => {
  const text = c.io.readFile(c.io.abs(String(c.p.TemplateFile)));
  if (text === null) return new Raw('', `\nError: Invalid template path ${c.p.TemplateFile}\n`, 255);
  const name = String(c.p.StackName);
  const live = activeStacks(c.acct, c.region).find((s) => s.name === name);
  const st = live ? stackStatus(c.acct, live).status : undefined;
  if (st === 'DELETE_COMPLETE') return new Raw('', `\nError: Stack ${name} does not exist\n`, 255);
  const create = !live || st === 'REVIEW_IN_PROGRESS';
  const overrides: Record<string, string> = {};
  for (const x of toArr<string>(c.p.ParameterOverrides)) {
    const i = x.indexOf('=');
    if (i < 0) throw new AwsError('ParamValidationError', `Parameter overrides must be Key=Value pairs (got "${x}")`, 252);
    overrides[x.slice(0, i)] = x.slice(i + 1);
  }
  const cs = createChangeSet(c, { stackName: name, name: `awscli-cloudformation-package-deploy-${Math.floor(c.acct.clock / 1000)}`, text, params: overrides, prevParams: live ? Object.keys(live.params).filter((k) => !(k in overrides)) : [], caps: toArr<string>(c.p.Capabilities), type: create ? 'CREATE' : 'UPDATE' });
  c.acct.clock += 4000;
  if (cs.status === 'FAILED') {
    cs.status = 'DELETE_COMPLETE';
    const msg = `No changes to deploy. Stack ${name} is up to date`;
    if (c.p.FailOnEmptyChangeset === false) return new Raw(`\n${msg}\n`);
    return new Raw('', `\nError: ${msg}\n`, 255);
  }
  executeChangeSet(c, cs, c.p.RoleArn);
  const s = cfnOf(c.acct, c.region).stacks[cs.stackId];
  for (let k = 0; k < 200; k++) {
    const x = stackStatus(c.acct, s).status;
    if (!x.endsWith('_IN_PROGRESS') && !s.events.some((ev) => ev.at > c.acct.clock)) break;
    c.acct.clock += 10000;
  }
  const fin = stackStatus(c.acct, s).status;
  if (fin === 'CREATE_COMPLETE' || fin === 'UPDATE_COMPLETE') return new Raw(`\nWaiting for changeset to be created..\nWaiting for stack create/update to complete\nSuccessfully created/updated stack - ${name}\n`);
  return new Raw('', `\nWaiting for changeset to be created..\nWaiting for stack create/update to complete\n\nFailed to create/update the stack. Run the following command\nto fetch the list of events leading up to the failure\naws cloudformation describe-stack-events --stack-name ${name}\n`, 1);
});
