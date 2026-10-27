/** AWS CodeBuild: proyectos y compilaciones que ejecutan el `buildspec` con un shell mínimo y `aws` con las credenciales del rol del proyecto. */
import { md5 } from '../../engine/commands/hash';
import { makeZip, zipFiles } from '../../engine/commands/archive';
import { regional } from '../account';
import { MiniShell } from '../minish';
import { AwsError, op, type OpCtx } from '../registry';
import { sdkCall } from '../sdk';
import { tickers } from '../tick';
import type { Account, CbBuild, CbProject, CicdState, Rec } from '../types';
import { isObj, iso, secretFor, sessionTokenFor, stableId, tempKeyId, toArr } from '../util';
import { parseTemplate } from '../yaml';
import { roleCan, roleTrusts } from './flowlogs';
import { logsPut } from './logs';
import { s3Current, s3Put } from './s3';

export const cicdOf = (a: Account, region: string): CicdState => {
  const r = regional(a, region);
  r.cicd ??= { projects: {}, builds: {}, pipelines: {}, cd: { apps: {}, deployments: {} } };
  return r.cicd;
};

const uuid = (seed: string) => {
  const h = stableId(seed, '', 32, 'hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const cbErr = {
  invalid: (m: string) => new AwsError('InvalidInputException', m, 400),
  notFound: (m: string) => new AwsError('ResourceNotFoundException', m, 400),
  exists: (m: string) => new AwsError('ResourceAlreadyExistsException', m, 400),
};

/** Credenciales temporales de un rol (las de una sesión asumida por un servicio). */
export function roleSession(a: Account, roleArn: string, session: string): Record<string, string> {
  const akid = tempKeyId(a);
  a.sessions[akid] = { AccessKeyId: akid, roleArn, roleSessionName: session, source: 'service', expires: a.clock + 8 * 3600000, mfa: false, tags: [] };
  return { AWS_ACCESS_KEY_ID: akid, AWS_SECRET_ACCESS_KEY: secretFor(akid), AWS_SESSION_TOKEN: sessionTokenFor(akid) };
}

const projArn = (a: Account, region: string, name: string) => `arn:aws:codebuild:${region}:${a.id}:project/${name}`;
const isRoleArn = (a: Account, arn: string) => !!a.iam.roles[arn.split('/').pop() ?? ''] && arn.startsWith(`arn:aws:iam::${a.id}:role/`);

// ───────────────────────── ejecución de una compilación ─────────────────────────

export interface BuildInput {
  /** Código fuente (ruta → contenido). */
  files: Record<string, string>;
  env?: Record<string, string>;
  buildspec?: string;
  sourceVersion?: string;
  trigger?: string;
}

interface Phase {
  phaseType: string;
  status: 'SUCCEEDED' | 'FAILED' | 'FAULT' | 'SKIPPED';
  secs: number;
  message?: string;
  code?: string;
}

const SRC_DIR = '/codebuild/output/src123456789/src';

const globRe = (p: string) =>
  new RegExp(
    '^' +
      p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '(?:.*/)?')
        .replace(/\u0001/g, '.*') +
      '$',
  );

export function executeBuild(a: Account, region: string, proj: CbProject, input: BuildInput): CbBuild {
  const state = cicdOf(a, region);
  const t0 = a.clock;
  const number = Object.values(state.builds).filter((b) => b.project === proj.name).length + 1;
  const bid = uuid(`${a.id}:${proj.name}:${number}:${t0}`);
  const build: CbBuild = { id: `${proj.name}:${bid}`, arn: `arn:aws:codebuild:${region}:${a.id}:build/${proj.name}:${bid}`, project: proj.name, startedAt: t0, endsAt: t0, status: 'IN_PROGRESS', phases: [], logs: [], artifacts: {}, sourceVersion: input.sourceVersion, initiator: input.trigger ?? 'user' };
  state.builds[build.id] = build;
  const phases: Phase[] = [];
  const stamp = () => `[Container] ${iso(a.clock).slice(0, 19).replace('T', ' ').replace(/-/g, '/')}.000000 `;
  const log = (l: string) => build.logs.push(l);
  const sys = (l: string) => log(stamp() + l);
  const addPhase = (p: Phase) => phases.push(p);
  const fail = (phase: string, code: string, msg: string, secs = 1): CbBuild => {
    addPhase({ phaseType: phase, status: 'FAILED', secs, code, message: msg });
    sys(`Phase complete: ${phase} State: FAILED`);
    sys(`Phase context status code: ${code} Message: ${msg}`);
    return finish('FAILED', phase, `${code}: ${msg}`);
  };
  const roleName = proj.serviceRole.split('/').pop() ?? '';
  const finish = (status: 'SUCCEEDED' | 'FAILED', failedPhase?: string, reason?: string): CbBuild => {
    // las fases se reparten por el calendario: encolada, aprovisionando… y las que se ejecutaron
    let t = t0;
    const timeline: { phaseType: string; status: string; secs: number }[] = [
      { phaseType: 'SUBMITTED', status: 'SUCCEEDED', secs: 0 },
      { phaseType: 'QUEUED', status: 'SUCCEEDED', secs: 2 },
      { phaseType: 'PROVISIONING', status: 'SUCCEEDED', secs: 24 },
    ];
    for (const p of phases) timeline.push({ phaseType: p.phaseType, status: p.status, secs: Math.max(1, p.secs) });
    timeline.push({ phaseType: 'FINALIZING', status: 'SUCCEEDED', secs: 2 });
    build.phases = timeline.map((p) => {
      const start = t;
      t += p.secs * 1000;
      return { ...p, start, end: t };
    });
    build.endsAt = t;
    build.status = status;
    build.failedPhase = failedPhase;
    build.reason = reason;
    // los registros llegan a CloudWatch Logs si el rol puede escribir
    if (roleCan(a, proj.serviceRole, ['logs:CreateLogStream', 'logs:PutLogEvents'], `arn:aws:logs:${region}:${a.id}:log-group:/aws/codebuild/${proj.name}:log-stream:${bid}`)) {
      const group = `/aws/codebuild/${proj.name}`;
      build.logs.forEach((l, i) => logsPut(a, region, group, bid, l, t0 + 26000 + i * 400));
    }
    a.clock = t0;
    return build;
  };

  sys('Waiting for agent ping');
  sys('Phase is DOWNLOAD_SOURCE');
  // ── código fuente
  let files = input.files;
  const src = proj.source;
  if (src.type === 'S3') {
    const loc = String(src.location ?? '');
    const bucket = loc.split('/')[0];
    const key = loc.split('/').slice(1).join('/');
    if (!roleCan(a, proj.serviceRole, ['s3:GetObject'], `arn:aws:s3:::${bucket}/${key}`)) return fail('DOWNLOAD_SOURCE', 'CLIENT_ERROR', `error while downloading source from S3: AccessDenied: Access Denied (role ${roleName} cannot s3:GetObject on ${loc})`, 3);
    const b = a.s3.buckets[bucket];
    const o = b ? s3Current(b, key) : undefined;
    if (!o) return fail('DOWNLOAD_SOURCE', 'CLIENT_ERROR', `error while downloading source from S3: NoSuchKey: The specified key does not exist (${loc})`, 3);
    files = zipFiles(o.body) ?? { [key.split('/').pop() ?? 'source']: o.body };
  } else if (src.type === 'NO_SOURCE') files = {};
  // ── buildspec
  let specText = input.buildspec;
  if (specText === undefined && src.buildspec) specText = src.buildspec.includes('\n') || /^\s*(version|phases)\s*:/m.test(src.buildspec) ? src.buildspec : files[src.buildspec];
  if (specText === undefined && src.type !== 'NO_SOURCE') specText = files['buildspec.yml'] ?? files['buildspec.yaml'];
  if (specText === undefined) return fail('DOWNLOAD_SOURCE', 'YAML_FILE_ERROR', `stat ${SRC_DIR}/buildspec.yml: no such file or directory`, 3);
  let spec: Rec;
  try {
    spec = parseTemplate(specText);
  } catch (e) {
    return fail('DOWNLOAD_SOURCE', 'YAML_FILE_ERROR', `YAML parse error: ${(e as Error).message}`, 3);
  }
  if (String(spec.version) !== '0.2' && String(spec.version) !== '0.1') return fail('DOWNLOAD_SOURCE', 'YAML_FILE_ERROR', `wrong buildspec version: ${String(spec.version ?? 'missing')} (use version: 0.2)`, 3);
  // ── entorno
  const vars: Record<string, string> = {
    AWS_DEFAULT_REGION: region,
    AWS_REGION: region,
    CODEBUILD_BUILD_ID: build.id,
    CODEBUILD_BUILD_ARN: build.arn,
    CODEBUILD_BUILD_NUMBER: String(number),
    CODEBUILD_SRC_DIR: SRC_DIR,
    CODEBUILD_INITIATOR: input.trigger ?? 'user',
    CODEBUILD_RESOLVED_SOURCE_VERSION: input.sourceVersion ?? md5(JSON.stringify(files)).slice(0, 40),
    CODEBUILD_BUILD_SUCCEEDING: '1',
    HOME: '/root',
    ...roleSession(a, proj.serviceRole, `AWSCodeBuild-${bid}`),
  };
  for (const e of proj.environment.environmentVariables ?? []) vars[e.name] = e.value;
  for (const [k, v] of Object.entries(isObj(spec.env) && isObj((spec.env as Rec).variables) ? ((spec.env as Rec).variables as Rec) : {})) vars[k] = String(v);
  for (const [k, v] of Object.entries(input.env ?? {})) vars[k] = v;
  // secretos de Secrets Manager (`tipo SECRETS_MANAGER`) y parámetros
  for (const [k, v] of Object.entries(isObj(spec.env) && isObj((spec.env as Rec)['secrets-manager']) ? ((spec.env as Rec)['secrets-manager'] as Rec) : {})) {
    const [id, key] = String(v).split(':');
    const r = sdkCall(a, region, { arn: `arn:aws:sts::${a.id}:assumed-role/${roleName}/AWSCodeBuild-${bid}`, account: a.id, type: 'AssumedRole', userId: 'AROACODEBUILD:build', root: false, mfa: false, accessKeyId: vars.AWS_ACCESS_KEY_ID, roleName, sessionName: `AWSCodeBuild-${bid}` }, 'secretsmanager', 'get-secret-value', { SecretId: id });
    if (!r.ok) return fail('DOWNLOAD_SOURCE', 'CLIENT_ERROR', `Error while retrieving secret ${id}: ${r.error?.Code}: ${r.error?.Message}`, 3);
    try {
      vars[k] = key ? String((JSON.parse(String((r.data as Rec).SecretString)) as Rec)[key]) : String((r.data as Rec).SecretString);
    } catch {
      vars[k] = String((r.data as Rec).SecretString);
    }
  }
  addPhase({ phaseType: 'DOWNLOAD_SOURCE', status: 'SUCCEEDED', secs: 3 });
  sys('Phase complete: DOWNLOAD_SOURCE State: SUCCEEDED');
  // ── fases
  const fs = new Map<string, string>(Object.entries(files).map(([k, v]) => [`${SRC_DIR}/${k}`, v]));
  fs.set('/root/.aws/config', `[default]\nregion = ${region}\n`);
  const sh = new MiniShell({ acct: a, files: fs, vars, cwd: SRC_DIR, log });
  let failedPhase: string | undefined;
  let failure = '';
  const phaseDefs = isObj(spec.phases) ? (spec.phases as Record<string, Rec>) : {};
  for (const name of ['install', 'pre_build', 'build', 'post_build']) {
    const def = phaseDefs[name];
    const type = name.toUpperCase();
    if (!def) continue;
    if (failedPhase && name !== 'post_build') {
      addPhase({ phaseType: type, status: 'SKIPPED', secs: 0 });
      continue;
    }
    sh.vars.CODEBUILD_BUILD_SUCCEEDING = failedPhase ? '0' : '1';
    sys(`Entering phase ${type}`);
    const start = a.clock;
    let phaseFailed = false;
    let msg = '';
    for (const cmd of toArr<unknown>(def.commands).map(String)) {
      sys(`Running command ${cmd}`);
      const code = sh.run(cmd);
      if (code !== 0) {
        sys(`Command did not exit successfully ${cmd} exit status ${code}`);
        phaseFailed = true;
        msg = `Error while executing command: ${cmd}. Reason: exit status ${code}`;
        break;
      }
    }
    for (const cmd of toArr<unknown>(def.finally).map(String)) {
      sys(`Running command ${cmd}`);
      sh.run(cmd);
    }
    const secs = Math.max(1, Math.round((a.clock - start) / 1000));
    if (phaseFailed) {
      addPhase({ phaseType: type, status: 'FAILED', secs, code: 'COMMAND_EXECUTION_ERROR', message: msg });
      sys(`Phase complete: ${type} State: FAILED`);
      sys(`Phase context status code: COMMAND_EXECUTION_ERROR Message: ${msg}`);
      if (!failedPhase) {
        failedPhase = type;
        failure = `COMMAND_EXECUTION_ERROR: ${msg}`;
      }
    } else {
      addPhase({ phaseType: type, status: 'SUCCEEDED', secs });
      sys(`Phase complete: ${type} State: SUCCEEDED`);
    }
  }
  if (failedPhase) return finish('FAILED', failedPhase, failure);
  // ── artefactos
  const art = isObj(spec.artifacts) ? (spec.artifacts as Rec) : undefined;
  if (art && proj.artifacts.type !== 'NO_ARTIFACTS') {
    sys('Phase is UPLOAD_ARTIFACTS');
    const baseDir = art['base-directory'] ? `${SRC_DIR}/${String(art['base-directory']).replace(/^\.?\//, '')}` : SRC_DIR;
    const pats = toArr<unknown>(art.files).map(String).map((p) => globRe(p.replace(/^\.\//, '')));
    const picked: Record<string, string> = {};
    for (const [path, content] of fs) {
      if (!path.startsWith(baseDir + '/') || path.endsWith('/.keep') || path.startsWith('/root/')) continue;
      const rel = path.slice(baseDir.length + 1);
      if (pats.some((r) => r.test(rel))) picked[art['discard-paths'] === 'yes' ? rel.split('/').pop()! : rel] = content;
    }
    if (!Object.keys(picked).length) return fail('UPLOAD_ARTIFACTS', 'CLIENT_ERROR', 'no matching artifact paths found', 2);
    if (proj.artifacts.type === 'S3') {
      const bucket = String(proj.artifacts.location ?? '').split('/')[0];
      if (!roleCan(a, proj.serviceRole, ['s3:PutObject'], `arn:aws:s3:::${bucket}/x`)) return fail('UPLOAD_ARTIFACTS', 'CLIENT_ERROR', `error while uploading artifacts to S3: AccessDenied: Access Denied (role ${roleName} cannot s3:PutObject on ${bucket})`, 2);
      const b = a.s3.buckets[bucket];
      if (!b) return fail('UPLOAD_ARTIFACTS', 'CLIENT_ERROR', `error while uploading artifacts to S3: NoSuchBucket: The specified bucket does not exist (${bucket})`, 2);
      const name = String(art.name ?? proj.name);
      const path = proj.artifactPath ? proj.artifactPath.replace(/\/$/, '') + '/' : '';
      if (proj.artifacts.packaging === 'ZIP') s3Put(a, b, `${path}${name}.zip`, makeZip(picked));
      else for (const [k, v] of Object.entries(picked)) s3Put(a, b, `${path}${name}/${k}`, v);
    }
    build.artifacts = picked;
    addPhase({ phaseType: 'UPLOAD_ARTIFACTS', status: 'SUCCEEDED', secs: 2 });
    sys('Phase complete: UPLOAD_ARTIFACTS State: SUCCEEDED');
  }
  return finish('SUCCEEDED');
}

// ───────────────────────── vistas ─────────────────────────

const stateAt = (a: Account, b: CbBuild) => {
  const done = a.clock >= b.endsAt;
  const phases = b.phases;
  const cur = phases.find((p) => a.clock < p.end) ?? phases[phases.length - 1];
  return { done, phases, cur };
};

function buildView(c: Pick<OpCtx, 'acct' | 'region'>, b: CbBuild) {
  const a = c.acct;
  const { done, phases, cur } = stateAt(a, b);
  const status = b.status === 'STOPPED' ? 'STOPPED' : done ? b.status : 'IN_PROGRESS';
  const proj = cicdOf(a, c.region).projects[b.project];
  const group = `/aws/codebuild/${b.project}`;
  const bid = b.id.split(':')[1];
  return {
    id: b.id,
    arn: b.arn,
    buildNumber: Number(b.arn.split('/').length) && Object.values(cicdOf(a, c.region).builds).filter((x) => x.project === b.project && x.startedAt <= b.startedAt).length,
    startTime: b.startedAt / 1000,
    ...(done ? { endTime: b.endsAt / 1000 } : {}),
    currentPhase: done ? 'COMPLETED' : cur.phaseType,
    buildStatus: status,
    ...(b.sourceVersion ? { sourceVersion: b.sourceVersion } : {}),
    projectName: b.project,
    phases: [...phases.filter((p) => p.start <= a.clock).map((p) => ({ phaseType: p.phaseType, phaseStatus: a.clock >= p.end ? p.status : undefined, startTime: p.start / 1000, ...(a.clock >= p.end ? { endTime: p.end / 1000, durationInSeconds: Math.round((p.end - p.start) / 1000) } : {}), ...(p.status === 'FAILED' ? { contexts: [{ statusCode: (b.reason ?? '').split(':')[0], message: (b.reason ?? '').split(': ').slice(1).join(': ') }] } : {}) })), ...(done ? [{ phaseType: 'COMPLETED', startTime: b.endsAt / 1000 }] : [])],
    source: proj ? { type: proj.source.type, ...(proj.source.location ? { location: proj.source.location } : {}) } : {},
    artifacts: { location: proj?.artifacts.location ?? '' },
    environment: proj?.environment,
    serviceRole: proj?.serviceRole,
    logs: { groupName: group, streamName: bid, deepLink: `https://console.aws.amazon.com/cloudwatch/home?region=${c.region}#logEventViewer:group=${group};stream=${bid}`, cloudWatchLogsArn: `arn:aws:logs:${c.region}:${a.id}:log-group:${group}:log-stream:${bid}`, cloudWatchLogs: { status: 'ENABLED', groupName: group, streamName: bid } },
    timeoutInMinutes: proj?.timeoutInMinutes ?? 60,
    buildComplete: done,
    initiator: b.initiator ?? 'user',
  };
}

const projView = (a: Account, region: string, p: CbProject) => ({
  name: p.name,
  arn: p.arn,
  description: p.description,
  source: p.source,
  artifacts: p.artifacts,
  environment: { type: p.environment.type ?? 'LINUX_CONTAINER', image: p.environment.image, computeType: p.environment.computeType, environmentVariables: p.environment.environmentVariables ?? [], privilegedMode: false },
  serviceRole: p.serviceRole,
  timeoutInMinutes: p.timeoutInMinutes,
  queuedTimeoutInMinutes: 480,
  created: p.created / 1000,
  lastModified: p.created / 1000,
  badge: { badgeEnabled: false },
  logsConfig: { cloudWatchLogs: { status: 'ENABLED' } },
  encryptionKey: `arn:aws:kms:${region}:${a.id}:alias/aws/s3`,
});

const COMPUTE = ['BUILD_GENERAL1_SMALL', 'BUILD_GENERAL1_MEDIUM', 'BUILD_GENERAL1_LARGE', 'BUILD_LAMBDA_1GB'];

function checkProject(c: OpCtx, p: Rec): CbProject {
  const src = (p.Source ?? {}) as Rec;
  const art = (p.Artifacts ?? {}) as Rec;
  const env = (p.Environment ?? {}) as Rec;
  const role = String(p.ServiceRole);
  if (!['S3', 'CODEPIPELINE', 'NO_SOURCE', 'GITHUB', 'CODECOMMIT', 'BITBUCKET'].includes(String(src.type))) throw cbErr.invalid(`Invalid source type: ${src.type}`);
  if (['GITHUB', 'CODECOMMIT', 'BITBUCKET'].includes(String(src.type))) throw cbErr.invalid(`Source type ${src.type} is not available in this simulator (use S3, CODEPIPELINE or NO_SOURCE).`);
  if (src.type === 'S3' && !src.location) throw cbErr.invalid('Source location is required for source type S3 (bucket/key).');
  if (src.type === 'NO_SOURCE' && !src.buildspec) throw cbErr.invalid('Buildspec is required for NO_SOURCE.');
  if (!['S3', 'CODEPIPELINE', 'NO_ARTIFACTS'].includes(String(art.type))) throw cbErr.invalid(`Invalid artifacts type: ${art.type}`);
  if (art.type === 'S3' && !art.location) throw cbErr.invalid('Artifacts location is required for type S3 (bucket name).');
  if (!env.image) throw cbErr.invalid('Environment image is required.');
  if (!COMPUTE.includes(String(env.computeType))) throw cbErr.invalid(`Invalid compute type ${env.computeType}. Valid: ${COMPUTE.join(', ')}.`);
  if (!isRoleArn(c.acct, role)) throw cbErr.invalid(`Invalid service role: ${role}`);
  if (!roleTrusts(c.acct, role, 'codebuild.amazonaws.com')) throw cbErr.invalid(`CodeBuild is not authorized to perform: sts:AssumeRole on ${role}`);
  return {
    name: String(p.Name),
    arn: projArn(c.acct, c.region, String(p.Name)),
    serviceRole: role,
    source: { type: String(src.type), location: src.location as string | undefined, buildspec: src.buildspec as string | undefined },
    environment: { image: String(env.image), computeType: String(env.computeType), type: (env.type as string | undefined) ?? 'LINUX_CONTAINER', environmentVariables: toArr<Rec>(env.environmentVariables as Rec[]).map((e) => ({ name: String(e.name), value: String(e.value) })) },
    artifacts: { type: String(art.type), location: art.location as string | undefined, ...(art.packaging ? { packaging: String(art.packaging) } : {}), ...(art.name ? { name: String(art.name) } : {}) },
    created: c.acct.clock,
    timeoutInMinutes: Number(p.TimeoutInMinutes ?? 60),
    ...(art.path ? { artifactPath: String(art.path) } : {}),
    ...(p.Description ? { description: String(p.Description) } : {}),
  };
}

const findProject = (c: OpCtx, name: string): CbProject => {
  const p = cicdOf(c.acct, c.region).projects[name];
  if (!p) throw cbErr.notFound(`Project cannot be found: ${projArn(c.acct, c.region, name)}`);
  return p;
};

op('codebuild', 'create-project', 'name:s! source:j! artifacts:j! environment:j! service-role:s! description:s timeout-in-minutes:i', 'Crea un proyecto de compilación: de dónde sale el código, el contenedor, el `buildspec`, dónde van los artefactos y qué rol usa.', { res: () => '*' }, (c) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,254}$/.test(String(c.p.Name))) throw cbErr.invalid(`Invalid project name: ${c.p.Name}`);
  const s = cicdOf(c.acct, c.region);
  if (s.projects[c.p.Name]) throw cbErr.exists(`Project already exists: ${projArn(c.acct, c.region, c.p.Name)}`);
  const p = checkProject(c, c.p);
  s.projects[p.name] = p;
  return { project: projView(c.acct, c.region, p) };
});

op('codebuild', 'update-project', 'name:s! source:j artifacts:j environment:j service-role:s description:s timeout-in-minutes:i', 'Cambia la configuración de un proyecto.', { res: () => '*' }, (c) => {
  const old = findProject(c, c.p.Name);
  const merged = { Name: old.name, Source: c.p.Source ?? old.source, Artifacts: c.p.Artifacts ?? old.artifacts, Environment: c.p.Environment ?? old.environment, ServiceRole: c.p.ServiceRole ?? old.serviceRole, TimeoutInMinutes: c.p.TimeoutInMinutes ?? old.timeoutInMinutes, Description: c.p.Description };
  const p = checkProject(c, merged);
  p.created = old.created;
  cicdOf(c.acct, c.region).projects[p.name] = p;
  return { project: projView(c.acct, c.region, p) };
});

op('codebuild', 'batch-get-projects', 'names:l!', 'Datos de uno o varios proyectos.', { res: () => '*' }, (c) => {
  const s = cicdOf(c.acct, c.region);
  const names = toArr<string>(c.p.Names);
  return { projects: names.filter((n) => s.projects[n]).map((n) => projView(c.acct, c.region, s.projects[n])), projectsNotFound: names.filter((n) => !s.projects[n]) };
});
op('codebuild', 'list-projects', 'sort-by:s sort-order:s', 'Nombres de los proyectos.', { res: () => '*', paginate: 'projects' }, (c) => ({ projects: Object.keys(cicdOf(c.acct, c.region).projects).sort() }));
op('codebuild', 'delete-project', 'name:s!', 'Borra un proyecto.', { res: () => '*' }, (c) => {
  findProject(c, c.p.Name);
  delete cicdOf(c.acct, c.region).projects[c.p.Name];
  return {};
});

op('codebuild', 'start-build', 'project-name:s! environment-variables-override:f source-version:s buildspec-override:s', 'Lanza una compilación. Pasa por las fases (descargar, instalar, compilar…) y termina en `SUCCEEDED` o `FAILED`.', { res: () => '*' }, (c) => {
  const p = findProject(c, c.p.ProjectName);
  if (p.source.type === 'CODEPIPELINE') throw cbErr.invalid('Cannot start a build for a project with source type CODEPIPELINE: only CodePipeline can start it.');
  const env: Record<string, string> = {};
  for (const e of toArr<Rec>(c.p.EnvironmentVariablesOverride as Rec[])) env[String(e.name)] = String(e.value);
  const b = executeBuild(c.acct, c.region, p, { files: {}, env, buildspec: c.p.BuildspecOverride, sourceVersion: c.p.SourceVersion });
  return { build: buildView(c, b) };
});

op('codebuild', 'batch-get-builds', 'ids:l!', 'Estado de las compilaciones: fase actual, resultado y por qué falló.', { res: () => '*' }, (c) => {
  const s = cicdOf(c.acct, c.region);
  const ids = toArr<string>(c.p.Ids);
  return { builds: ids.filter((i) => s.builds[i]).map((i) => buildView(c, s.builds[i])), buildsNotFound: ids.filter((i) => !s.builds[i]) };
});
op('codebuild', 'list-builds-for-project', 'project-name:s! sort-order:s', 'Ids de las compilaciones de un proyecto, la más reciente primero.', { res: () => '*', paginate: 'ids' }, (c) => {
  findProject(c, c.p.ProjectName);
  return { ids: Object.values(cicdOf(c.acct, c.region).builds).filter((b) => b.project === c.p.ProjectName).sort((x, y) => y.startedAt - x.startedAt).map((b) => b.id) };
});
op('codebuild', 'list-builds', 'sort-order:s', 'Ids de todas las compilaciones.', { res: () => '*', paginate: 'ids' }, (c) => ({ ids: Object.values(cicdOf(c.acct, c.region).builds).sort((x, y) => y.startedAt - x.startedAt).map((b) => b.id) }));
op('codebuild', 'stop-build', 'id:s!', 'Detiene una compilación en curso.', { res: () => '*' }, (c) => {
  const b = cicdOf(c.acct, c.region).builds[c.p.Id];
  if (!b) throw cbErr.notFound(`Build cannot be found: ${c.p.Id}`);
  if (c.acct.clock < b.endsAt) {
    b.endsAt = c.acct.clock;
    b.status = 'STOPPED';
  }
  return { build: buildView(c, b) };
});

tickers.push(() => {
  /* las compilaciones se calculan al lanzarlas; su estado se deduce del reloj */
});
