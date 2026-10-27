/** AWS CodePipeline: canalizaciones de origen (S3) → compilación (CodeBuild) → despliegue (CloudFormation, S3, CodeDeploy) con aprobaciones manuales. */
import { zipFiles, makeZip } from '../../engine/commands/archive';
import { AwsError, op, type OpCtx } from '../registry';
import { sdkCall } from '../sdk';
import { tickers } from '../tick';
import type { Account, CpAction, CpExecution, CpPipeline, CpStage, Rec } from '../types';
import { isObj, parseDate, stableId, toArr } from '../util';
import { cfnOf, stackStatus } from './cfn';
import { executeBuild, cicdOf } from './codebuild';
import { startDeployment } from './codedeploy';
import { roleCan, roleTrusts } from './flowlogs';
import { s3Current, s3Put } from './s3';

const cpErr = {
  structure: (m: string) => new AwsError('InvalidStructureException', m, 400),
  notFound: (name: string) => new AwsError('PipelineNotFoundException', `Account '${'123456789012'}' does not have a pipeline with name '${name}'`, 400),
};

const uuid = (seed: string) => {
  const h = stableId(seed, '', 32, 'hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

type ActionKey = `${string}:${string}`;
const KNOWN: Record<ActionKey, { required: string[] }> = {
  'Source:S3': { required: ['S3Bucket', 'S3ObjectKey'] },
  'Build:CodeBuild': { required: ['ProjectName'] },
  'Test:CodeBuild': { required: ['ProjectName'] },
  'Deploy:S3': { required: ['BucketName', 'Extract'] },
  'Deploy:CloudFormation': { required: ['ActionMode', 'StackName'] },
  'Deploy:CodeDeploy': { required: ['ApplicationName', 'DeploymentGroupName'] },
  'Approval:Manual': { required: [] },
};

const pipeArn = (a: Account, region: string, name: string) => `arn:aws:codepipeline:${region}:${a.id}:${name}`;

// ───────────────────────── validación ─────────────────────────

function parsePipeline(c: OpCtx, raw: Rec): { p: CpPipeline } {
  const name = String(raw.name ?? '');
  if (!/^[A-Za-z0-9.@\-_]{1,100}$/.test(name)) throw cpErr.structure(`Pipeline name '${name}' is invalid: it can only contain letters, numbers, . @ - _`);
  const roleArn = String(raw.roleArn ?? '');
  const roleName = roleArn.split('/').pop() ?? '';
  if (!c.acct.iam.roles[roleName] || !roleArn.startsWith('arn:aws:iam::')) throw cpErr.structure(`CodePipeline is not authorized to perform AssumeRole on role ${roleArn}`);
  if (!roleTrusts(c.acct, roleArn, 'codepipeline.amazonaws.com')) throw cpErr.structure(`CodePipeline is not authorized to perform AssumeRole on role ${roleArn}: its trust policy must allow codepipeline.amazonaws.com`);
  const store = (raw.artifactStore ?? {}) as Rec;
  const bucket = String(store.location ?? '');
  if (store.type !== 'S3' || !bucket) throw cpErr.structure('The artifact store must be of type S3 with a bucket in "location".');
  if (!c.acct.s3.buckets[bucket]) throw cpErr.structure(`Pipeline '${name}' artifact bucket '${bucket}' does not exist.`);
  const stagesRaw = toArr<Rec>(raw.stages as Rec[]);
  if (stagesRaw.length < 2) throw cpErr.structure(`Pipeline '${name}' must have at least 2 stages (found ${stagesRaw.length}).`);
  const outputs = new Map<string, number>();
  const stages: CpStage[] = [];
  const stageNames = new Set<string>();
  stagesRaw.forEach((sr, si) => {
    const sname = String(sr.name ?? '');
    if (!sname) throw cpErr.structure(`Stage ${si + 1} needs a name.`);
    if (stageNames.has(sname)) throw cpErr.structure(`Stage name '${sname}' is duplicated in the pipeline.`);
    stageNames.add(sname);
    const actions: CpAction[] = [];
    const actionNames = new Set<string>();
    for (const ar of toArr<Rec>(sr.actions as Rec[])) {
      const aname = String(ar.name ?? '');
      const t = (ar.actionTypeId ?? {}) as Rec;
      const key = `${t.category}:${t.provider}` as ActionKey;
      if (!aname) throw cpErr.structure(`An action in stage '${sname}' needs a name.`);
      if (actionNames.has(aname)) throw cpErr.structure(`Action name '${aname}' is duplicated in stage '${sname}'.`);
      actionNames.add(aname);
      const def = KNOWN[key];
      if (!def || t.owner !== 'AWS') throw new AwsError('ActionTypeNotFoundException', `Action type with category '${t.category}', owner '${t.owner}', provider '${t.provider}' and version '${t.version ?? '1'}' does not exist.`, 400);
      const cfg = Object.fromEntries(Object.entries((ar.configuration ?? {}) as Rec).map(([k, v]) => [k, String(v)]));
      for (const req of def.required) if (cfg[req] === undefined) throw cpErr.structure(`Action configuration for action '${aname}' is missing required configuration '${req}'`);
      if (t.category === 'Source' && si !== 0) throw cpErr.structure(`Action '${aname}' is a source action: source actions can only be in the first stage.`);
      if (si === 0 && t.category !== 'Source') throw cpErr.structure(`The first stage of pipeline '${name}' contains non-source actions. Only source actions are allowed in the first stage.`);
      const ins = toArr<Rec>(ar.inputArtifacts as Rec[]).map((x) => String(x.name));
      const outs = toArr<Rec>(ar.outputArtifacts as Rec[]).map((x) => String(x.name));
      const runOrder = Number(ar.runOrder ?? 1);
      for (const i of ins) {
        const from = outputs.get(i);
        if (from === undefined || from > si * 1000 + runOrder - 1) throw cpErr.structure(`Stage '${sname}' action '${aname}' declares input artifact '${i}' that is not an output of any previous action.`);
      }
      for (const o of outs) {
        if (outputs.has(o)) throw cpErr.structure(`Output artifact name '${o}' is used by more than one action.`);
        outputs.set(o, si * 1000 + runOrder);
      }
      if (t.category === 'Source' && !outs.length) throw cpErr.structure(`Action '${aname}' needs at least one output artifact.`);
      if (key === 'Build:CodeBuild' && !ins.length) throw cpErr.structure(`Action '${aname}' needs an input artifact.`);
      if (key === 'Deploy:CloudFormation' && ins.length === 0 && ['CREATE_UPDATE', 'REPLACE_ON_FAILURE', 'CHANGE_SET_REPLACE'].includes(cfg.ActionMode)) throw cpErr.structure(`Action '${aname}' needs an input artifact with the template.`);
      actions.push({ name: aname, category: t.category as CpAction['category'], provider: String(t.provider), config: cfg, inputs: ins, outputs: outs, runOrder });
    }
    if (!actions.length) throw cpErr.structure(`Stage '${sname}' needs at least one action.`);
    stages.push({ name: sname, actions });
  });
  const now = c.acct.clock;
  return { p: { name, arn: pipeArn(c.acct, c.region, name), roleArn, artifactBucket: bucket, stages, version: 1, created: now, updated: now, executions: [], approvals: {}, lastSource: {} } };
}

// ───────────────────────── ejecución ─────────────────────────

/** Mensaje de falta de permiso del rol de la canalización, o `null` si puede. */
function need(a: Account, role: string, actions: string[], resource: string): string | null {
  const bad = actions.find((x) => !roleCan(a, role, [x], resource));
  return bad ? `${role} is not authorized to perform: ${bad} on resource: ${resource}` : null;
}

interface ActionResult {
  ok: boolean;
  summary?: string;
  secs: number;
  code?: string;
  outputs?: Record<string, Record<string, string>>;
  externalId?: string;
  depId?: string;
  token?: string;
}

function toFiles(body: string, key: string): Record<string, string> {
  return zipFiles(body) ?? { [key.split('/').pop() ?? 'file']: body };
}

function runAction(a: Account, region: string, p: CpPipeline, ex: CpExecution, act: CpAction, start: number): ActionResult {
  const fail = (summary: string, secs = 2, code = 'JobFailed'): ActionResult => ({ ok: false, summary, secs, code });
  const store = `arn:aws:s3:::${p.artifactBucket}/${p.name}/x`;
  const noStore = need(a, p.roleArn, ['s3:GetObject', 's3:PutObject'], store);
  if (noStore && act.category !== 'Approval') return fail(`Insufficient permissions: The provided role does not have sufficient permissions to access the artifact store. ${noStore}`, 1, 'PermissionError');
  const real = a.clock;
  a.clock = start;
  try {
    const cfg = act.config;
    const put = (name: string, files: Record<string, string>) => {
      const b = a.s3.buckets[p.artifactBucket];
      s3Put(a, b, `${p.name}/${name}/${stableId(`${ex.id}:${name}`, '', 7, 'up')}`, makeZip(files));
      ex.artifacts[name] = files;
    };
    switch (`${act.category}:${act.provider}`) {
      case 'Source:S3': {
        const denied = need(a, p.roleArn, ['s3:GetObject', 's3:GetObjectVersion', 's3:GetBucketVersioning'], `arn:aws:s3:::${cfg.S3Bucket}/${cfg.S3ObjectKey}`);
        if (denied) return fail(`Insufficient permissions: The provided role does not have the required S3 permissions on the source bucket. ${denied}`, 2, 'PermissionError');
        const b = a.s3.buckets[cfg.S3Bucket];
        if (!b) return fail(`The specified bucket '${cfg.S3Bucket}' does not exist.`, 2);
        if (b.versioning !== 'Enabled') return fail(`The versioning of the bucket '${cfg.S3Bucket}' is not enabled: CodePipeline needs a versioned bucket to detect changes in the source.`, 2);
        const o = s3Current(b, cfg.S3ObjectKey);
        if (!o) return fail(`The object with key '${cfg.S3ObjectKey}' does not exist in the bucket '${cfg.S3Bucket}'.`, 2);
        for (const out of act.outputs) put(out, toFiles(o.body, cfg.S3ObjectKey));
        ex.sourceRevision = o.versionId;
        p.lastSource[`${act.name}`] = o.versionId;
        return { ok: true, secs: 3, summary: `s3://${cfg.S3Bucket}/${cfg.S3ObjectKey} (version ${o.versionId})`, externalId: o.versionId };
      }
      case 'Build:CodeBuild':
      case 'Test:CodeBuild': {
        const denied = need(a, p.roleArn, ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'], `arn:aws:codebuild:${region}:${a.id}:project/${cfg.ProjectName}`);
        if (denied) return fail(`Insufficient permissions: ${denied}`, 2, 'PermissionError');
        const proj = cicdOf(a, region).projects[cfg.ProjectName];
        if (!proj) return fail(`Project cannot be found: arn:aws:codebuild:${region}:${a.id}:project/${cfg.ProjectName}`, 2);
        if (proj.source.type !== 'CODEPIPELINE') return fail(`The source type of the build project ${proj.name} is ${proj.source.type}: it must be CODEPIPELINE to be used in a pipeline.`, 2);
        if (act.outputs.length && proj.artifacts.type !== 'CODEPIPELINE') return fail(`The action declares output artifacts but the artifacts type of the build project ${proj.name} is ${proj.artifacts.type}: it must be CODEPIPELINE.`, 2);
        const env: Record<string, string> = {};
        try {
          for (const e of toArr<Rec>(cfg.EnvironmentVariables ? (JSON.parse(cfg.EnvironmentVariables) as Rec[]) : [])) env[String(e.name)] = String(e.value);
        } catch {
          return fail('EnvironmentVariables must be a JSON list: [{"name":"X","value":"1","type":"PLAINTEXT"}]', 1);
        }
        const files = ex.artifacts[act.inputs[0]] ?? {};
        const b = executeBuild(a, region, proj, { files, env, trigger: `codepipeline/${p.name}`, sourceVersion: ex.sourceRevision });
        const secs = Math.round((b.endsAt - b.startedAt) / 1000);
        if (b.status !== 'SUCCEEDED') return { ok: false, secs, summary: `Error in the ${b.failedPhase ?? 'BUILD'} phase of the build ${b.id}: ${b.reason ?? ''}`, code: 'JobFailed', externalId: b.id };
        for (const out of act.outputs) put(out, b.artifacts);
        return { ok: true, secs, summary: `Build ${b.id} succeeded`, externalId: b.id };
      }
      case 'Deploy:S3': {
        const denied = need(a, p.roleArn, ['s3:PutObject'], `arn:aws:s3:::${cfg.BucketName}/x`);
        if (denied) return fail(`Insufficient permissions: ${denied}`, 2, 'PermissionError');
        const b = a.s3.buckets[cfg.BucketName];
        if (!b) return fail(`The bucket '${cfg.BucketName}' does not exist.`, 2);
        const files = ex.artifacts[act.inputs[0]] ?? {};
        const prefix = cfg.ObjectKey ? cfg.ObjectKey.replace(/\/?$/, '/') : '';
        if (cfg.Extract === 'true') for (const [k, v] of Object.entries(files)) s3Put(a, b, prefix + k, v);
        else s3Put(a, b, cfg.ObjectKey || 'artifact.zip', makeZip(files));
        return { ok: true, secs: 4, summary: `Deployed ${Object.keys(files).length} file(s) to s3://${cfg.BucketName}` };
      }
      case 'Deploy:CloudFormation':
        return runCfnAction(a, region, p, ex, act, start);
      case 'Deploy:CodeDeploy': {
        const files = ex.artifacts[act.inputs[0]] ?? {};
        const text = files['appspec.yml'] ?? files['appspec.yaml'] ?? files['appspec.json'];
        if (!text) return fail('The artifact does not contain an appspec.yml file.', 2);
        const denied = need(a, p.roleArn, ['codedeploy:CreateDeployment', 'codedeploy:GetDeployment'], `arn:aws:codedeploy:${region}:${a.id}:deploymentgroup:${cfg.ApplicationName}/${cfg.DeploymentGroupName}`);
        if (denied) return fail(`Insufficient permissions: ${denied}`, 2, 'PermissionError');
        try {
          const d = startDeployment(a, region, { app: cfg.ApplicationName, group: cfg.DeploymentGroupName, spec: text });
          if (d.status === 'Failed') return { ok: false, secs: 6, summary: d.error ?? 'Deployment failed', code: 'JobFailed', externalId: d.id };
          const end = d.steps.length ? d.steps[d.steps.length - 1].at + 5000 : start + 10000;
          return { ok: true, secs: Math.max(5, Math.round((end - start) / 1000)), summary: `Deployment ${d.id}`, externalId: d.id, depId: d.id };
        } catch (e) {
          return fail((e as Error).message, 2);
        }
      }
      case 'Approval:Manual': {
        const token = uuid(`${ex.id}:${act.name}`);
        return { ok: true, secs: 0, token, summary: cfg.CustomData ?? 'Waiting for approval' };
      }
    }
    return fail(`Unsupported action ${act.category}:${act.provider}`);
  } finally {
    a.clock = real;
  }
}

function runCfnAction(a: Account, region: string, p: CpPipeline, ex: CpExecution, act: CpAction, start: number): ActionResult {
  const cfg = act.config;
  const fail = (summary: string, secs = 3): ActionResult => ({ ok: false, summary, secs, code: 'JobFailed' });
  const mode = cfg.ActionMode;
  const caller = { arn: `arn:aws:sts::${a.id}:assumed-role/${p.roleArn.split('/').pop()}/codepipeline`, account: a.id, type: 'AssumedRole' as const, userId: 'AROACODEPIPELINE:codepipeline', root: false, mfa: false, accessKeyId: 'ASIACODEPIPELINE', roleName: p.roleArn.split('/').pop(), sessionName: 'codepipeline' };
  const call = (opName: string, params: Rec) => sdkCall(a, region, caller, 'cloudformation', opName, params);
  const denied = need(a, p.roleArn, ['cloudformation:DescribeStacks'], `arn:aws:cloudformation:${region}:${a.id}:stack/${cfg.StackName}/*`);
  if (denied) return fail(`Insufficient permissions: ${denied}`, 2);
  if (cfg.RoleArn) {
    const pass = need(a, p.roleArn, ['iam:PassRole'], cfg.RoleArn);
    if (pass) return fail(`Insufficient permissions: ${pass}`, 2);
  }
  const live = Object.values(cfnOf(a, region).stacks).find((s) => s.name === cfg.StackName && (s.deleted === undefined || s.deleted > a.clock));
  const stackSt = live ? stackStatus(a, live).status : undefined;
  const wait = (sid: string) => {
    const s = cfnOf(a, region).stacks[sid];
    const last = s.events.reduce((m, e) => Math.max(m, e.at), start);
    const st = (() => {
      const real = a.clock;
      a.clock = last + 1;
      const r = stackStatus(a, s);
      a.clock = real;
      return r.status;
    })();
    const failEvent = s.events.find((e) => e.status.endsWith('_FAILED') && e.type !== 'AWS::CloudFormation::Stack');
    return { st, secs: Math.max(3, Math.round((last - start) / 1000)), reason: failEvent?.reason ?? s.events.find((e) => e.status === 'ROLLBACK_IN_PROGRESS' || e.status === 'UPDATE_ROLLBACK_IN_PROGRESS')?.reason };
  };
  if (mode === 'DELETE_ONLY') {
    if (!live) return { ok: true, secs: 2, summary: `Stack ${cfg.StackName} does not exist: nothing to delete` };
    const r = call('delete-stack', { StackName: cfg.StackName, ...(cfg.RoleArn ? { RoleArn: cfg.RoleArn } : {}) });
    if (!r.ok) return fail(r.error!.Message);
    return { ok: true, secs: 20, summary: `Deleting stack ${cfg.StackName}` };
  }
  const path = (cfg.TemplatePath ?? '').split('::');
  const files = ex.artifacts[path[0]] ?? ex.artifacts[act.inputs[0]] ?? {};
  const template = files[path[1] ?? ''];
  if (mode !== 'CHANGE_SET_EXECUTE' && template === undefined) return fail(`The template file '${cfg.TemplatePath}' was not found in the input artifact.`, 2);
  let overrides: Rec = {};
  try {
    overrides = cfg.ParameterOverrides ? (JSON.parse(cfg.ParameterOverrides) as Rec) : {};
  } catch {
    return fail('ParameterOverrides must be a JSON object: {"Param":"value"}', 1);
  }
  const params = Object.entries(overrides).map(([k, v]) => ({ ParameterKey: k, ParameterValue: String(v) }));
  const caps = cfg.Capabilities ? cfg.Capabilities.split(',').map((x) => x.trim()) : [];
  const stackParams: Rec = { StackName: cfg.StackName, TemplateBody: template, Parameters: params, Capabilities: caps, ...(cfg.RoleArn ? { RoleArn: cfg.RoleArn } : {}) };
  if (mode === 'REPLACE_ON_FAILURE' && live && ['ROLLBACK_COMPLETE', 'CREATE_FAILED', 'UPDATE_ROLLBACK_FAILED'].includes(stackSt ?? '')) {
    call('delete-stack', { StackName: cfg.StackName });
    a.clock = start + 30000;
  }
  const exists = live && !['ROLLBACK_COMPLETE', 'CREATE_FAILED', 'DELETE_COMPLETE'].includes(stackSt ?? '') && !(mode === 'REPLACE_ON_FAILURE' && stackSt === 'ROLLBACK_COMPLETE');
  if (mode === 'CREATE_UPDATE' || mode === 'REPLACE_ON_FAILURE') {
    if (exists) {
      if (stackSt && stackSt.endsWith('_IN_PROGRESS')) return fail(`Stack ${cfg.StackName} is in ${stackSt} state and can not be updated.`, 2);
      const r = call('update-stack', stackParams);
      if (!r.ok) {
        if (/No updates are to be performed/.test(r.error!.Message)) return { ok: true, secs: 3, summary: 'No updates are to be performed.' };
        return fail(r.error!.Message);
      }
      const w = wait(String((r.data as Rec).StackId));
      return w.st === 'UPDATE_COMPLETE' ? { ok: true, secs: w.secs, summary: `Stack ${cfg.StackName} updated`, externalId: cfg.StackName } : { ok: false, secs: w.secs, summary: `${w.st}: ${w.reason ?? ''}`, code: 'JobFailed', externalId: cfg.StackName };
    }
    if (live && stackSt === 'ROLLBACK_COMPLETE') return fail(`Stack ${cfg.StackName} is in ROLLBACK_COMPLETE state and can not be updated. Use ActionMode REPLACE_ON_FAILURE or delete the stack.`, 2);
    const r = call('create-stack', stackParams);
    if (!r.ok) return fail(r.error!.Message);
    const w = wait(String((r.data as Rec).StackId));
    return w.st === 'CREATE_COMPLETE' ? { ok: true, secs: w.secs, summary: `Stack ${cfg.StackName} created`, externalId: cfg.StackName } : { ok: false, secs: w.secs, summary: `${w.st}: ${w.reason ?? ''}`, code: 'JobFailed', externalId: cfg.StackName };
  }
  if (mode === 'CHANGE_SET_REPLACE') {
    const r = call('create-change-set', { ...stackParams, ChangeSetName: cfg.ChangeSetName ?? 'pipeline', ChangeSetType: exists ? 'UPDATE' : 'CREATE' });
    return r.ok ? { ok: true, secs: 5, summary: `Change set ${cfg.ChangeSetName ?? 'pipeline'} created` } : fail(r.error!.Message);
  }
  if (mode === 'CHANGE_SET_EXECUTE') {
    const r = call('execute-change-set', { StackName: cfg.StackName, ChangeSetName: cfg.ChangeSetName ?? 'pipeline' });
    if (!r.ok) return fail(r.error!.Message);
    const s2 = Object.values(cfnOf(a, region).stacks).find((s) => s.name === cfg.StackName)!;
    const w = wait(s2.id);
    return /COMPLETE$/.test(w.st) && !/ROLLBACK/.test(w.st) ? { ok: true, secs: w.secs, summary: `Change set executed on ${cfg.StackName}` } : { ok: false, secs: w.secs, summary: `${w.st}: ${w.reason ?? ''}`, code: 'JobFailed' };
  }
  return fail(`Unsupported ActionMode ${mode}`);
}

/** Ejecuta las acciones desde (stage, action) hasta una aprobación, un fallo o el final. */
function runFrom(a: Account, region: string, p: CpPipeline, ex: CpExecution, stageIdx: number, actionIdx: number, at: number): void {
  let cursor = at;
  for (let si = stageIdx; si < p.stages.length; si++) {
    const stage = p.stages[si];
    const order = [...stage.actions].sort((x, y) => x.runOrder - y.runOrder);
    let ai = si === stageIdx ? actionIdx : 0;
    while (ai < order.length) {
      const group = order.filter((x) => x.runOrder === order[ai].runOrder);
      let groupEnd = cursor;
      let failed = false;
      for (const act of group) {
        const r = runAction(a, region, p, ex, act, cursor);
        const end = cursor + r.secs * 1000;
        groupEnd = Math.max(groupEnd, end);
        if (act.category === 'Approval' && r.ok && r.token) {
          ex.actions.push({ stage: stage.name, action: act.name, status: 'InProgress', startedAt: cursor, endsAt: Infinity, summary: r.summary, token: r.token });
          ex.resume = { stage: si, action: order.indexOf(act) };
          ex.lastEnd = cursor;
          return;
        }
        ex.actions.push({ stage: stage.name, action: act.name, status: r.ok ? 'Succeeded' : 'Failed', startedAt: cursor, endsAt: end, summary: r.summary, externalId: r.externalId, code: r.code, depId: r.depId });
        if (!r.ok) failed = true;
      }
      cursor = groupEnd;
      ai += group.length;
      if (failed) {
        ex.lastEnd = cursor;
        ex.resume = undefined;
        return;
      }
    }
  }
  ex.lastEnd = cursor;
  ex.resume = undefined;
}

export function startExecution(a: Account, region: string, p: CpPipeline, trigger: string): CpExecution {
  const ex: CpExecution = { id: uuid(`${a.id}:${p.name}:${p.executions.length}:${a.clock}`), pipeline: p.name, startedAt: a.clock, status: 'InProgress', trigger, actions: [], artifacts: {} };
  p.executions.push(ex);
  runFrom(a, region, p, ex, 0, 0, a.clock + 500);
  return ex;
}

// ───────────────────────── estado en el tiempo ─────────────────────────

type ActRec = CpExecution['actions'][number];

function actionStatus(a: Account, r: ActRec): { status: ActRec['status']; since: number } {
  if (r.startedAt > a.clock) return { status: 'InProgress', since: r.startedAt };
  if (r.status === 'InProgress' || a.clock < r.endsAt) return { status: 'InProgress', since: r.startedAt };
  if (r.depId) {
    const d = cicdOf(a, 'us-east-1').cd.deployments[r.depId];
    if (d && d.status === 'Failed') return { status: 'Failed', since: r.endsAt };
  }
  return { status: r.status, since: r.endsAt };
}

function execStatus(a: Account, ex: CpExecution): CpExecution['status'] {
  if (ex.stopped) return 'Stopped';
  const acts = ex.actions.map((r) => ({ r, s: actionStatus(a, r) }));
  if (acts.some((x) => x.s.status === 'Failed' && a.clock >= x.s.since)) return 'Failed';
  if (ex.resume) return 'InProgress';
  if (acts.some((x) => x.s.status === 'InProgress')) return 'InProgress';
  return a.clock >= (ex.lastEnd ?? 0) ? 'Succeeded' : 'InProgress';
}

// ───────────────────────── disparo por cambios del origen ─────────────────────────

tickers.push((a) => {
  for (const [region, r] of Object.entries(a.regions)) {
    for (const p of Object.values(r.cicd?.pipelines ?? {})) {
      const src = p.stages[0]?.actions.find((x) => x.provider === 'S3' && x.config.PollForSourceChanges !== 'false');
      if (!src) continue;
      const b = a.s3.buckets[src.config.S3Bucket];
      const cur = b ? s3Current(b, src.config.S3ObjectKey) : undefined;
      if (!cur || b.versioning !== 'Enabled') continue;
      const known = p.lastSource[src.name];
      if (known === cur.versionId) continue;
      const changedAt = parseDate(cur.lastModified);
      if (known === undefined && changedAt <= p.created) continue;
      if (a.clock < changedAt + 15000) continue;
      if (p.executions.some((e) => execStatus(a, e) === 'InProgress' && !e.resume && e.sourceRevision === cur.versionId)) continue;
      p.lastSource[src.name] = cur.versionId;
      const real = a.clock;
      a.clock = Math.max(changedAt + 15000, p.created + 1000);
      try {
        startExecution(a, region, p, 'PollForSourceChanges');
      } finally {
        a.clock = real;
      }
    }
  }
});

// ───────────────────────── vistas y operaciones ─────────────────────────

const getPipe = (c: OpCtx, name: string): CpPipeline => {
  const p = cicdOf(c.acct, c.region).pipelines[name];
  if (!p) throw cpErr.notFound(name);
  return p;
};

const pipeView = (p: CpPipeline) => ({
  name: p.name,
  roleArn: p.roleArn,
  artifactStore: { type: 'S3', location: p.artifactBucket },
  stages: p.stages.map((s) => ({ name: s.name, actions: s.actions.map((x) => ({ name: x.name, actionTypeId: { category: x.category, owner: 'AWS', provider: x.provider, version: '1' }, runOrder: x.runOrder, configuration: x.config, outputArtifacts: x.outputs.map((name) => ({ name })), inputArtifacts: x.inputs.map((name) => ({ name })), region: 'us-east-1', namespace: undefined })) })),
  version: p.version,
});

op('codepipeline', 'create-pipeline', 'pipeline:j!', 'Crea una canalización y la ejecuta por primera vez. `--cli-input-json file://pipeline.json` con `{"pipeline": {…}}` es lo habitual.', { res: () => '*' }, (c) => {
  const raw = (c.p.Pipeline ?? {}) as Rec;
  const { p } = parsePipeline(c, isObj(raw.pipeline) ? (raw.pipeline as Rec) : raw);
  const st = cicdOf(c.acct, c.region);
  if (st.pipelines[p.name]) throw new AwsError('PipelineNameInUseException', `Pipeline with name '${p.name}' already exists.`, 400);
  st.pipelines[p.name] = p;
  startExecution(c.acct, c.region, p, 'CreatePipeline');
  return { pipeline: pipeView(p) };
});

op('codepipeline', 'get-pipeline', 'name:s! version:i', 'Definición de la canalización.', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.Name);
  return { pipeline: pipeView(p), metadata: { pipelineArn: p.arn, created: p.created / 1000, updated: p.updated / 1000 } };
});

op('codepipeline', 'update-pipeline', 'pipeline:j!', 'Cambia la definición (sube la versión). Las ejecuciones en curso no se ven afectadas.', { res: () => '*' }, (c) => {
  const raw = (c.p.Pipeline ?? {}) as Rec;
  const body = isObj(raw.pipeline) ? (raw.pipeline as Rec) : raw;
  const old = getPipe(c, String(body.name));
  const { p } = parsePipeline(c, body);
  p.version = old.version + 1;
  p.created = old.created;
  p.executions = old.executions;
  p.approvals = old.approvals;
  p.lastSource = old.lastSource;
  cicdOf(c.acct, c.region).pipelines[p.name] = p;
  return { pipeline: pipeView(p) };
});

op('codepipeline', 'delete-pipeline', 'name:s!', 'Borra la canalización.', { res: () => '*' }, (c) => {
  getPipe(c, c.p.Name);
  delete cicdOf(c.acct, c.region).pipelines[c.p.Name];
  return undefined;
});

op('codepipeline', 'list-pipelines', '', 'Lista las canalizaciones.', { res: () => '*', paginate: 'pipelines' }, (c) => ({ pipelines: Object.values(cicdOf(c.acct, c.region).pipelines).map((p) => ({ name: p.name, version: p.version, pipelineType: 'V1', executionMode: 'SUPERSEDED', created: p.created / 1000, updated: p.updated / 1000 })) }));

op('codepipeline', 'start-pipeline-execution', 'name:s!', 'Lanza la canalización con la última revisión del origen.', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.Name);
  return { pipelineExecutionId: startExecution(c.acct, c.region, p, 'StartPipelineExecution').id };
});

const stageStatus = (a: Account, ex: CpExecution, stage: CpStage) => {
  const recs = ex.actions.filter((x) => x.stage === stage.name && x.startedAt <= a.clock).map((x) => actionStatus(a, x).status);
  if (recs.includes('Failed')) return 'Failed';
  if (recs.includes('InProgress')) return 'InProgress';
  if (recs.length === stage.actions.length) return 'Succeeded';
  return recs.length ? 'InProgress' : undefined;
};

op('codepipeline', 'get-pipeline-state', 'name:s!', 'Estado de cada etapa y acción en la última ejecución: `InProgress`, `Succeeded` o `Failed` (con el motivo).', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.Name);
  const ex = p.executions[p.executions.length - 1];
  return {
    pipelineName: p.name,
    pipelineVersion: p.version,
    stageStates: p.stages.map((s) => {
      const st = ex ? stageStatus(c.acct, ex, s) : undefined;
      return {
        stageName: s.name,
        inboundTransitionState: { enabled: true },
        actionStates: s.actions.map((x) => {
          const rec = ex?.actions.find((r) => r.stage === s.name && r.action === x.name);
          if (!rec || rec.startedAt > c.acct.clock) return { actionName: x.name };
          const as = actionStatus(c.acct, rec);
          return { actionName: x.name, latestExecution: { status: as.status, summary: rec.summary, lastStatusChange: as.since / 1000, ...(rec.externalId ? { externalExecutionId: rec.externalId } : {}), ...(rec.token ? { token: rec.token } : {}), ...(as.status === 'Failed' ? { errorDetails: { code: rec.code ?? 'JobFailed', message: rec.summary } } : {}) } };
        }),
        ...(ex && st ? { latestExecution: { pipelineExecutionId: ex.id, status: st } } : {}),
      };
    }),
    created: p.created / 1000,
    updated: p.updated / 1000,
  };
});

const execView = (a: Account, p: CpPipeline, ex: CpExecution) => ({
  pipelineExecutionId: ex.id,
  status: execStatus(a, ex),
  startTime: ex.startedAt / 1000,
  lastUpdateTime: Math.min(a.clock, ex.lastEnd ?? ex.startedAt) / 1000,
  sourceRevisions: p.stages[0].actions.map((x) => ({ actionName: x.name, revisionId: ex.sourceRevision ?? '', revisionSummary: x.config.S3ObjectKey ?? '' })),
  trigger: { triggerType: ex.trigger, triggerDetail: ex.trigger === 'PollForSourceChanges' ? 'S3 object changed' : '' },
  executionMode: 'SUPERSEDED',
});

op('codepipeline', 'list-pipeline-executions', 'pipeline-name:s!', 'Ejecuciones de la canalización, la más reciente primero.', { res: () => '*', paginate: 'pipelineExecutionSummaries' }, (c) => {
  const p = getPipe(c, c.p.PipelineName);
  return { pipelineExecutionSummaries: [...p.executions].reverse().map((e) => execView(c.acct, p, e)) };
});

op('codepipeline', 'get-pipeline-execution', 'pipeline-name:s! pipeline-execution-id:s!', 'Datos de una ejecución.', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.PipelineName);
  const e = p.executions.find((x) => x.id === c.p.PipelineExecutionId);
  if (!e) throw new AwsError('PipelineExecutionNotFoundException', `Pipeline execution ${c.p.PipelineExecutionId} not found.`, 400);
  const v = execView(c.acct, p, e);
  return { pipelineExecution: { pipelineName: p.name, pipelineVersion: p.version, pipelineExecutionId: e.id, status: v.status, artifactRevisions: v.sourceRevisions.map((r) => ({ name: r.actionName, revisionId: r.revisionId, revisionSummary: r.revisionSummary })), trigger: v.trigger } };
});

op('codepipeline', 'list-action-executions', 'pipeline-name:s! filter:j', 'Cada acción de cada ejecución con su resultado y el motivo del fallo (`output.executionResult`).', { res: () => '*', paginate: 'actionExecutionDetails' }, (c) => {
  const p = getPipe(c, c.p.PipelineName);
  const only = (c.p.Filter as { pipelineExecutionId?: string } | undefined)?.pipelineExecutionId;
  const rows = [...p.executions].reverse().filter((e) => !only || e.id === only).flatMap((e) =>
    [...e.actions].reverse().map((r) => {
      const as = actionStatus(c.acct, r);
      const act = p.stages.find((s) => s.name === r.stage)!.actions.find((x) => x.name === r.action)!;
      return {
        pipelineExecutionId: e.id,
        actionExecutionId: uuid(`${e.id}:${r.action}`),
        pipelineVersion: p.version,
        stageName: r.stage,
        actionName: r.action,
        startTime: r.startedAt / 1000,
        lastUpdateTime: as.since / 1000,
        status: as.status,
        input: { actionTypeId: { category: act.category, owner: 'AWS', provider: act.provider, version: '1' }, configuration: act.config, region: c.region, inputArtifacts: act.inputs.map((name) => ({ name })) },
        output: { outputArtifacts: act.outputs.map((name) => ({ name })), executionResult: { ...(r.externalId ? { externalExecutionId: r.externalId } : {}), externalExecutionSummary: r.summary, ...(as.status === 'Failed' ? { errorDetails: { code: r.code ?? 'JobFailed', message: r.summary } } : {}) } },
      };
    }),
  );
  return { actionExecutionDetails: rows };
});

op('codepipeline', 'put-approval-result', 'pipeline-name:s! stage-name:s! action-name:s! result:j! token:s!', 'Aprueba o rechaza una acción de aprobación manual (`--result summary=…,status=Approved|Rejected`).', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.PipelineName);
  const ex = [...p.executions].reverse().find((e) => e.actions.some((r) => r.stage === c.p.StageName && r.action === c.p.ActionName && r.status === 'InProgress'));
  const rec = ex?.actions.find((r) => r.stage === c.p.StageName && r.action === c.p.ActionName && r.status === 'InProgress');
  if (!ex || !rec) throw new AwsError('ApprovalAlreadyCompletedException', `The approval action '${c.p.ActionName}' is not waiting for a result.`, 400);
  if (rec.token !== c.p.Token) throw new AwsError('InvalidApprovalTokenException', 'The approval request token is not valid: get a new one with get-pipeline-state.', 400);
  const res = c.p.Result as { status?: string; summary?: string };
  if (res.status !== 'Approved' && res.status !== 'Rejected') throw new AwsError('ValidationException', `Invalid approval status ${res.status}: use Approved or Rejected.`, 400);
  rec.endsAt = c.acct.clock;
  rec.summary = `${res.status}: ${res.summary ?? ''}`;
  if (res.status === 'Rejected') {
    rec.status = 'Failed';
    rec.code = 'ApprovalRejected';
    ex.resume = undefined;
    ex.lastEnd = c.acct.clock;
  } else {
    rec.status = 'Succeeded';
    const r = ex.resume!;
    ex.resume = undefined;
    runFrom(c.acct, c.region, p, ex, r.stage, r.action + 1, c.acct.clock + 1000);
  }
  return { approvedAt: c.acct.clock / 1000 };
});

op('codepipeline', 'stop-pipeline-execution', 'pipeline-name:s! pipeline-execution-id:s! abandon:b reason:s', 'Detiene una ejecución en curso.', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.PipelineName);
  const ex = p.executions.find((e) => e.id === c.p.PipelineExecutionId);
  if (!ex) throw new AwsError('PipelineExecutionNotFoundException', `Pipeline execution ${c.p.PipelineExecutionId} not found.`, 400);
  ex.stopped = true;
  ex.resume = undefined;
  return { pipelineExecutionId: ex.id };
});

op('codepipeline', 'retry-stage-execution', 'pipeline-name:s! stage-name:s! pipeline-execution-id:s! retry-mode:s!', 'Reintenta las acciones que fallaron en una etapa.', { res: () => '*' }, (c) => {
  const p = getPipe(c, c.p.PipelineName);
  const ex = p.executions.find((e) => e.id === c.p.PipelineExecutionId);
  if (!ex) throw new AwsError('PipelineExecutionNotFoundException', `Pipeline execution ${c.p.PipelineExecutionId} not found.`, 400);
  const si = p.stages.findIndex((s) => s.name === c.p.StageName);
  if (si < 0) throw new AwsError('StageNotFoundException', `Stage ${c.p.StageName} not found.`, 400);
  if (execStatus(c.acct, ex) !== 'Failed') throw new AwsError('StageNotRetryableException', `Stage ${c.p.StageName} has no failed actions to retry.`, 400);
  const firstFailed = p.stages[si].actions.findIndex((x) => ex.actions.some((r) => r.stage === c.p.StageName && r.action === x.name && r.status === 'Failed'));
  ex.actions = ex.actions.filter((r) => !(r.stage === c.p.StageName && r.status === 'Failed'));
  runFrom(c.acct, c.region, p, ex, si, Math.max(0, firstFailed), c.acct.clock + 1000);
  return { pipelineExecutionId: ex.id };
});

