/** Amazon ECR: repositorios privados de imágenes con etiquetas, escaneo de vulnerabilidades, políticas de ciclo de vida y `docker login`. */
import { b64decode, b64encode } from '../../engine/commands/hash';
import { regional } from '../account';
import { authorize } from '../authz';
import { scanPackages } from '../containers/catalog';
import { AwsError, Raw, op, type Caller, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, Tag } from '../types';
import type { EcrFinding, EcrImage, EcrRepo, EcrState, ImageData } from '../types-containers';
import { mergeTags, mkArn, stableId } from '../util';
import { roleCaller } from '../sdk';

const DAY = 86400000;
const TOKEN_TTL = 12 * 3600000;
const SCAN_MS = 25000;

export const ecrOf = (a: Account, region: string): EcrState => (regional(a, region).ecr ??= { repos: {} });
export const registryHost = (a: Account, region: string) => `${a.id}.dkr.ecr.${region}.amazonaws.com`;
const repoArn = (a: Account, region: string, name: string) => mkArn('ecr', region, a.id, `repository/${name}`);

const E = {
  repoNotFound: (a: Account, name: string) => new AwsError('RepositoryNotFoundException', `The repository with name '${name}' does not exist in the registry with id '${a.id}'`, 400),
  imageNotFound: (a: Account, name: string, ref: string) => new AwsError('ImageNotFoundException', `The image with imageId '${ref}' does not exist within the repository with name '${name}' in the registry with id '${a.id}'`, 400),
  invalid: (m: string) => new AwsError('InvalidParameterException', m, 400),
};

const digestOf = (img: ImageData) => 'sha256:' + stableId('manifest:' + img.id, '', 64, 'hex');
export const imageSizeInEcr = (img: ImageData) => Math.round(img.size * 0.42);

export function findRepo(a: Account, region: string, name: string): EcrRepo {
  const r = ecrOf(a, region).repos[name];
  if (!r) throw E.repoNotFound(a, name);
  return r;
}

// ───────────────────────── identidad de `docker login` ─────────────────────────

/** El «password» de `get-login-password`: lleva dentro quién lo pidió y cuándo (caduca a las 12 horas). */
export function makeToken(a: Account, caller: Caller): string {
  const body = JSON.stringify({ p: caller.arn, a: a.id, t: a.clock, k: stableId('tok:' + caller.arn + a.clock, '', 10, 'hex') });
  return b64encode(body).replace(/=+$/, '');
}

export function parseToken(a: Account, token: string): { principal: string; issuedAt: number } | null {
  try {
    const raw = b64decode(token.trim());
    if (raw === null) return null;
    const j = JSON.parse(raw) as { p: string; a: string; t: number };
    if (j.a !== a.id || typeof j.p !== 'string') return null;
    return { principal: j.p, issuedAt: j.t };
  } catch {
    return null;
  }
}

/** Quien hizo `docker login`: usuario o rol (para comprobar sus permisos al subir o bajar imágenes). */
export function callerFromArn(a: Account, arn: string): Caller {
  const role = /:assumed-role\/([^/]+)\/(.+)$/.exec(arn);
  if (role) return { arn, account: a.id, type: 'AssumedRole', userId: 'AROATOKEN:' + role[2], root: false, mfa: false, accessKeyId: 'ASIATOKEN', roleName: role[1], sessionName: role[2] };
  if (arn.endsWith(':root')) return { arn, account: a.id, type: 'Account', userId: a.id, root: true, mfa: false, accessKeyId: 'AKIAROOT' };
  const user = arn.split('/').pop() ?? '';
  return { arn, account: a.id, type: 'User', userName: user, userId: a.iam.users[user]?.UserId ?? 'AIDATOKEN', root: false, mfa: false, accessKeyId: 'AKIATOKEN' };
}

/** ¿Puede esta identidad hacer estas acciones sobre el repositorio? Devuelve el mensaje de denegación o null. */
export function ecrDenied(a: Account, region: string, who: Caller, actions: string[], repo: string): string | null {
  try {
    authorize({ acct: a, caller: who, region, service: 'ecr' }, actions.map((action) => ({ action, resource: repoArn(a, region, repo) })));
    return null;
  } catch (e) {
    return e instanceof AwsError ? e.message : String(e);
  }
}

// ───────────────────────── subir y bajar imágenes ─────────────────────────

function startScan(repo: EcrRepo, im: EcrImage, now: number) {
  im.scan = { status: 'IN_PROGRESS', startedAt: now, findings: scanPackages(im.image.pkgs) };
}

export interface PushResult {
  digest: string;
  tag: string;
  newLayers: number;
}

/** `docker push`: guarda la imagen en el repositorio con esa etiqueta. Lanza AwsError con el mensaje que mostraría Docker. */
export function ecrPush(a: Account, region: string, principalArn: string, repoName: string, tag: string, image: ImageData): PushResult {
  const repo = ecrOf(a, region).repos[repoName];
  if (!repo) throw new AwsError('RepositoryNotFound', `name unknown: The repository with name '${repoName}' does not exist in the registry with id '${a.id}'`, 404);
  const who = callerFromArn(a, principalArn);
  const denied = ecrDenied(a, region, who, ['ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:BatchCheckLayerAvailability'], repoName);
  if (denied) throw new AwsError('Denied', `denied: ${denied}`, 403);
  const digest = digestOf(image);
  const prev = repo.images.find((i) => i.tags.includes(tag));
  if (prev && prev.digest !== digest && repo.mutability === 'IMMUTABLE') throw new AwsError('ImageTagAlreadyExistsException', `tag invalid: The image tag '${tag}' already exists in the '${repoName}' repository and cannot be overwritten because the repository is immutable.`, 400);
  let im = repo.images.find((i) => i.digest === digest);
  const fresh = !im;
  if (prev && prev !== im) prev.tags = prev.tags.filter((t) => t !== tag);
  if (!im) {
    im = { digest, tags: [], pushedAt: a.clock, size: imageSizeInEcr(image), image: { ...image, created: a.clock } };
    repo.images.push(im);
    if (repo.scanOnPush) startScan(repo, im, a.clock);
  }
  if (!im.tags.includes(tag)) im.tags.push(tag);
  return { digest, tag, newLayers: fresh ? image.layers.filter((l) => l.size > 0).length : 0 };
}

/** Busca una imagen por etiqueta (`latest`) o por resumen (`sha256:…`). */
export function ecrFind(repo: EcrRepo, ref: string): EcrImage | undefined {
  return ref.startsWith('sha256:') ? repo.images.find((i) => i.digest === ref) : repo.images.find((i) => i.tags.includes(ref));
}

/** `docker pull` con las credenciales de quien hizo login. */
export function ecrPull(a: Account, region: string, principalArn: string, repoName: string, ref: string): ImageData {
  const repo = ecrOf(a, region).repos[repoName];
  if (!repo) throw new AwsError('RepositoryNotFound', `Error response from daemon: pull access denied for ${registryHost(a, region)}/${repoName}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied`, 404);
  const denied = ecrDenied(a, region, callerFromArn(a, principalArn), ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], repoName);
  if (denied) throw new AwsError('Denied', `denied: ${denied}`, 403);
  const im = ecrFind(repo, ref);
  if (!im) throw new AwsError('ImageNotFound', `manifest for ${registryHost(a, region)}/${repoName}:${ref} not found: manifest unknown: Requested image not found`, 404);
  im.lastPulled = a.clock;
  return im.image;
}

export type PullFail = { reason: 'no-repo' | 'no-image' | 'denied'; message: string };

/** Descarga de una imagen por un rol (el rol de ejecución de una tarea de ECS o la instancia de App Runner). */
export function ecrPullAs(a: Account, region: string, roleArn: string | undefined, image: string, o: { skipAuth?: boolean } = {}): { image?: ImageData; fail?: PullFail } {
  const m = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([^:@]+)(?::([^@]+))?(?:@(sha256:[0-9a-f]+))?$/.exec(image);
  if (!m) return {};
  const [, acct, reg, name, tag, dig] = m;
  const repo = regional(a, reg).ecr?.repos[name];
  if (acct !== a.id || !repo) return { fail: { reason: 'no-repo', message: `pull access denied for ${image}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied` } };
  const ref = dig ?? tag ?? 'latest';
  const im = ecrFind(repo, ref);
  if (!im) return { fail: { reason: 'no-image', message: `${image}: not found: manifest unknown: Requested image not found` } };
  if (!o.skipAuth && roleArn) {
    const rn = roleArn.split('/').pop() ?? '';
    const who = roleCaller(a, roleArn, 'ecs-tasks');
    void rn;
    const denied = ecrDenied(a, reg, who, ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], name);
    if (denied) return { fail: { reason: 'denied', message: denied } };
  }
  im.lastPulled = a.clock;
  return { image: im.image };
}

// ───────────────────────── ciclo de vida ─────────────────────────

interface Rule {
  rulePriority: number;
  description?: string;
  selection: { tagStatus: 'tagged' | 'untagged' | 'any'; tagPrefixList?: string[]; countType: 'imageCountMoreThan' | 'sinceImagePushed'; countUnit?: string; countNumber: number };
  action: { type: 'expire' };
}

function parsePolicy(text: string): Rule[] {
  let j: { rules?: Rule[] };
  try {
    j = JSON.parse(text) as { rules?: Rule[] };
  } catch {
    throw E.invalid('Invalid parameter at \'LifecyclePolicyText\' failed to satisfy constraint: \'Lifecycle policy validation failure: Could not map policyString into LifecyclePolicy.\'');
  }
  const rules = j.rules;
  if (!Array.isArray(rules) || !rules.length) throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: Rules must be specified'");
  const prios = new Set<number>();
  for (const r of rules) {
    if (typeof r.rulePriority !== 'number') throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: rulePriority is required'");
    if (prios.has(r.rulePriority)) throw E.invalid(`Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: Rule priorities must be unique (duplicate: ${r.rulePriority})'`);
    prios.add(r.rulePriority);
    const s = r.selection;
    if (!s || !['tagged', 'untagged', 'any'].includes(s.tagStatus)) throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: tagStatus must be one of tagged, untagged, any'");
    if (s.tagStatus === 'tagged' && !s.tagPrefixList?.length) throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: tagPrefixList is required when tagStatus is tagged'");
    if (!['imageCountMoreThan', 'sinceImagePushed'].includes(s.countType)) throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: countType must be imageCountMoreThan or sinceImagePushed'");
    if (s.countType === 'sinceImagePushed' && s.countUnit !== 'days') throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: countUnit must be days for sinceImagePushed'");
    if (!(s.countNumber >= 1)) throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: countNumber must be at least 1'");
  }
  const any = rules.filter((r) => r.selection.tagStatus === 'any');
  const maxPrio = Math.max(...rules.map((r) => r.rulePriority));
  if (any.length && any[0].rulePriority !== maxPrio) throw E.invalid("Invalid parameter at 'LifecyclePolicyText' failed to satisfy constraint: 'Lifecycle policy validation failure: Rules with tagStatus any must have the highest rulePriority number'");
  return [...rules].sort((x, y) => x.rulePriority - y.rulePriority);
}

/** Qué imágenes expiraría la política ahora mismo (y por qué regla). */
export function lifecyclePreview(repo: EcrRepo, now: number): { image: EcrImage; priority: number }[] {
  if (!repo.lifecycle) return [];
  const rules = parsePolicy(repo.lifecycle);
  const gone = new Map<EcrImage, number>();
  for (const r of rules) {
    const s = r.selection;
    const cand = repo.images
      .filter((i) => !gone.has(i))
      .filter((i) => (s.tagStatus === 'any' ? true : s.tagStatus === 'untagged' ? i.tags.length === 0 : i.tags.length > 0 && (s.tagPrefixList ?? []).some((p) => i.tags.some((t) => t.startsWith(p)))))
      .sort((x, y) => y.pushedAt - x.pushedAt);
    if (s.countType === 'imageCountMoreThan') for (const i of cand.slice(s.countNumber)) gone.set(i, r.rulePriority);
    else for (const i of cand) if (now - i.pushedAt > s.countNumber * DAY) gone.set(i, r.rulePriority);
  }
  return [...gone].map(([image, priority]) => ({ image, priority }));
}

tickers.push((a) => {
  for (const r of Object.values(a.regions)) {
    for (const repo of Object.values(r.ecr?.repos ?? {})) {
      for (const im of repo.images) if (im.scan?.status === 'IN_PROGRESS' && a.clock >= im.scan.startedAt + SCAN_MS) im.scan.status = 'COMPLETE';
      if (repo.lifecycle && repo.lifecycleSetAt !== undefined && a.clock >= repo.lifecycleSetAt + 60000) {
        const expire = new Set(lifecyclePreview(repo, a.clock).map((x) => x.image));
        if (expire.size) repo.images = repo.images.filter((i) => !expire.has(i));
      }
    }
  }
});

// ───────────────────────── vistas ─────────────────────────

const sevCounts = (f: EcrFinding[]) => {
  const out: Record<string, number> = {};
  for (const x of f) out[x.severity] = (out[x.severity] ?? 0) + 1;
  return out;
};

const repoView = (a: Account, region: string, r: EcrRepo) => ({
  repositoryArn: r.arn,
  registryId: a.id,
  repositoryName: r.name,
  repositoryUri: r.uri,
  createdAt: r.created / 1000,
  imageTagMutability: r.mutability,
  imageScanningConfiguration: { scanOnPush: r.scanOnPush },
  encryptionConfiguration: { encryptionType: r.encryption, ...(r.kmsKey ? { kmsKey: r.kmsKey } : {}) },
});

const scanStatus = (a: Account, im: EcrImage) => (im.scan ? { status: im.scan.status === 'COMPLETE' && a.clock >= im.scan.startedAt ? 'COMPLETE' : 'IN_PROGRESS', description: im.scan.status === 'COMPLETE' ? 'The scan was completed successfully.' : 'The scan is in progress.' } : undefined);

const detail = (a: Account, region: string, repo: EcrRepo, im: EcrImage) => ({
  registryId: a.id,
  repositoryName: repo.name,
  imageDigest: im.digest,
  ...(im.tags.length ? { imageTags: [...im.tags] } : {}),
  imageSizeInBytes: im.size,
  imagePushedAt: im.pushedAt / 1000,
  imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  artifactMediaType: 'application/vnd.docker.container.image.v1+json',
  ...(im.scan ? { imageScanStatus: scanStatus(a, im), ...(im.scan.status === 'COMPLETE' ? { imageScanFindingsSummary: { imageScanCompletedAt: (im.scan.startedAt + SCAN_MS) / 1000, vulnerabilitySourceUpdatedAt: im.scan.startedAt / 1000, findingSeverityCounts: sevCounts(im.scan.findings) } } : {}) } : {}),
  ...(im.lastPulled ? { lastRecordedPullTime: im.lastPulled / 1000 } : {}),
});

const manifestOf = (im: EcrImage) =>
  JSON.stringify(
    {
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      config: { mediaType: 'application/vnd.docker.container.image.v1+json', size: 1432, digest: im.image.id },
      layers: im.image.layers.filter((l) => l.size > 0).map((l, k) => ({ mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: Math.round(l.size * 0.42), digest: 'sha256:' + stableId(`layer:${im.image.id}:${k}`, '', 64, 'hex') })),
      annotations: { 'sim.digest': im.digest },
    },
    null,
    3,
  );

type IdSpec = { imageTag?: string; imageDigest?: string };
const pick = (repo: EcrRepo, ids: IdSpec[] | undefined): { id: IdSpec; im?: EcrImage }[] =>
  ids?.length ? ids.map((id) => ({ id, im: id.imageDigest ? repo.images.find((i) => i.digest === id.imageDigest) : repo.images.find((i) => i.tags.includes(id.imageTag ?? '')) })) : repo.images.map((im) => ({ id: { imageDigest: im.digest }, im }));

// ───────────────────────── operaciones ─────────────────────────

const resRepo = (c: OpCtx) => repoArn(c.acct, c.region, String(c.p.RepositoryName ?? '*'));

op('ecr', 'create-repository', 'repository-name:s! image-tag-mutability:s image-scanning-configuration:j encryption-configuration:j tags:t', 'Crea un repositorio privado de imágenes. Su URI es `<cuenta>.dkr.ecr.<región>.amazonaws.com/<nombre>`.', { res: resRepo }, (c) => {
  const name = String(c.p.RepositoryName);
  if (!/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name) || name.length < 2 || name.length > 256) throw E.invalid(`Invalid parameter at 'repositoryName' failed to satisfy constraint: 'must satisfy regular expression pattern: (?:[a-z0-9]+(?:[._-][a-z0-9]+)*/)*[a-z0-9]+(?:[._-][a-z0-9]+)*'`);
  const st = ecrOf(c.acct, c.region);
  if (st.repos[name]) throw new AwsError('RepositoryAlreadyExistsException', `The repository with name '${name}' already exists in the registry with id '${c.acct.id}'`, 400);
  const mut = String(c.p.ImageTagMutability ?? 'MUTABLE');
  if (!['MUTABLE', 'IMMUTABLE'].includes(mut)) throw E.invalid(`Invalid parameter at 'imageTagMutability' failed to satisfy constraint: 'Member must satisfy enum value set: [IMMUTABLE, MUTABLE]'`);
  const enc = (c.p.EncryptionConfiguration ?? {}) as { encryptionType?: string; kmsKey?: string };
  const repo: EcrRepo = { name, arn: repoArn(c.acct, c.region, name), uri: `${registryHost(c.acct, c.region)}/${name}`, created: c.acct.clock, mutability: mut as EcrRepo['mutability'], scanOnPush: !!(c.p.ImageScanningConfiguration as { scanOnPush?: boolean } | undefined)?.scanOnPush, encryption: enc.encryptionType === 'KMS' ? 'KMS' : 'AES256', ...(enc.kmsKey ? { kmsKey: enc.kmsKey } : {}), images: [], tags: (c.p.Tags as Tag[]) ?? [] };
  st.repos[name] = repo;
  return { repository: repoView(c.acct, c.region, repo) };
});

op('ecr', 'describe-repositories', 'repository-names:l registry-id:s max-results:i', 'Lista tus repositorios (o los que pidas por nombre).', { res: () => '*', paginate: 'repositories' }, (c) => {
  const names = c.p.RepositoryNames as string[] | undefined;
  const st = ecrOf(c.acct, c.region);
  if (names) for (const n of names) if (!st.repos[n]) throw E.repoNotFound(c.acct, n);
  return { repositories: Object.values(st.repos).filter((r) => !names || names.includes(r.name)).map((r) => repoView(c.acct, c.region, r)) };
});

op('ecr', 'delete-repository', 'repository-name:s! force:b', 'Borra un repositorio. Si tiene imágenes hace falta `--force`.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (r.images.length && !c.p.Force) throw new AwsError('RepositoryNotEmptyException', `The repository with name '${r.name}' in registry with id '${c.acct.id}' cannot be deleted because it still contains images`, 400);
  delete ecrOf(c.acct, c.region).repos[r.name];
  return { repository: repoView(c.acct, c.region, r) };
});

op('ecr', 'put-image-tag-mutability', 'repository-name:s! image-tag-mutability:s!', 'Cambia si las etiquetas se pueden sobrescribir (`MUTABLE`) o no (`IMMUTABLE`).', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (!['MUTABLE', 'IMMUTABLE'].includes(String(c.p.ImageTagMutability))) throw E.invalid(`Invalid parameter at 'imageTagMutability' failed to satisfy constraint: 'Member must satisfy enum value set: [IMMUTABLE, MUTABLE]'`);
  r.mutability = c.p.ImageTagMutability;
  return { registryId: c.acct.id, repositoryName: r.name, imageTagMutability: r.mutability };
});

op('ecr', 'put-image-scanning-configuration', 'repository-name:s! image-scanning-configuration:j!', 'Activa o desactiva el escaneo automático de cada imagen que se sube (`scanOnPush=true`).', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  r.scanOnPush = !!(c.p.ImageScanningConfiguration as { scanOnPush?: boolean }).scanOnPush;
  return { registryId: c.acct.id, repositoryName: r.name, imageScanningConfiguration: { scanOnPush: r.scanOnPush } };
});

op('ecr', 'list-images', 'repository-name:s! filter:j max-results:i', 'Lista las imágenes de un repositorio (una entrada por etiqueta).', { res: resRepo, paginate: 'imageIds' }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const status = (c.p.Filter as { tagStatus?: string } | undefined)?.tagStatus;
  const out: { imageDigest: string; imageTag?: string }[] = [];
  for (const im of [...r.images].sort((x, y) => x.pushedAt - y.pushedAt)) {
    if (status === 'TAGGED' && !im.tags.length) continue;
    if (status === 'UNTAGGED' && im.tags.length) continue;
    if (im.tags.length) for (const t of im.tags) out.push({ imageDigest: im.digest, imageTag: t });
    else out.push({ imageDigest: im.digest });
  }
  return { imageIds: out };
});

op('ecr', 'describe-images', 'repository-name:s! image-ids:f filter:j max-results:i', 'Detalle de las imágenes: etiquetas, tamaño, fecha de subida y resumen del escaneo.', { res: resRepo, paginate: 'imageDetails' }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const hits = pick(r, c.p.ImageIds as IdSpec[] | undefined);
  const miss = hits.find((h) => !h.im);
  if (miss) throw E.imageNotFound(c.acct, r.name, `{imageDigest:'${miss.id.imageDigest ?? 'null'}', imageTag:'${miss.id.imageTag ?? 'null'}'}`);
  const status = (c.p.Filter as { tagStatus?: string } | undefined)?.tagStatus;
  return { imageDetails: hits.map((h) => h.im!).filter((im) => !status || status === 'ANY' || (status === 'TAGGED') === im.tags.length > 0).sort((x, y) => x.pushedAt - y.pushedAt).map((im) => detail(c.acct, c.region, r, im)) };
});

op('ecr', 'batch-get-image', 'repository-name:s! image-ids:f! accepted-media-types:l', 'Devuelve el manifiesto de las imágenes (sirve para añadir otra etiqueta con `put-image`).', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const images: unknown[] = [];
  const failures: unknown[] = [];
  for (const h of pick(r, c.p.ImageIds as IdSpec[])) {
    if (h.im) {
      images.push({ registryId: c.acct.id, repositoryName: r.name, imageId: { imageDigest: h.im.digest, ...(h.id.imageTag ? { imageTag: h.id.imageTag } : {}) }, imageManifest: manifestOf(h.im), imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json' });
      h.im.lastPulled = c.acct.clock;
    } else failures.push({ imageId: h.id, failureCode: 'ImageNotFound', failureReason: 'Requested image not found' });
  }
  return { images, failures };
});

op('ecr', 'put-image', 'repository-name:s! image-manifest:s! image-tag:s image-manifest-media-type:s', 'Registra un manifiesto en el repositorio (con una etiqueta nueva si se indica): así se «reetiqueta» una imagen sin bajarla.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  let m: { annotations?: Record<string, string> };
  try {
    m = JSON.parse(String(c.p.ImageManifest)) as typeof m;
  } catch {
    throw new AwsError('InvalidParameterException', 'Invalid parameter at \'imageManifest\' failed to satisfy constraint: \'Invalid JSON in image manifest\'', 400);
  }
  const dig = m.annotations?.['sim.digest'];
  const im = r.images.find((i) => i.digest === dig);
  if (!im) throw new AwsError('ImageNotFoundException', 'The manifest does not reference any image of this repository (layers missing).', 400);
  const tag = c.p.ImageTag as string | undefined;
  if (tag) {
    const prev = r.images.find((i) => i.tags.includes(tag));
    if (prev && prev !== im && r.mutability === 'IMMUTABLE') throw new AwsError('ImageTagAlreadyExistsException', `The image tag '${tag}' already exists in the '${r.name}' repository and cannot be overwritten because the repository is immutable.`, 400);
    if (prev && prev !== im) prev.tags = prev.tags.filter((t) => t !== tag);
    if (!im.tags.includes(tag)) im.tags.push(tag);
  }
  return { image: { registryId: c.acct.id, repositoryName: r.name, imageId: { imageDigest: im.digest, ...(tag ? { imageTag: tag } : {}) }, imageManifest: String(c.p.ImageManifest) } };
});

op('ecr', 'batch-delete-image', 'repository-name:s! image-ids:f!', 'Borra imágenes por etiqueta (quita solo la etiqueta si la imagen tiene más) o por resumen.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const imageIds: unknown[] = [];
  const failures: unknown[] = [];
  for (const h of pick(r, c.p.ImageIds as IdSpec[])) {
    if (!h.im) {
      failures.push({ imageId: h.id, failureCode: 'ImageNotFound', failureReason: 'Requested image not found' });
      continue;
    }
    if (h.id.imageTag && h.im.tags.length > 1) h.im.tags = h.im.tags.filter((t) => t !== h.id.imageTag);
    else r.images = r.images.filter((i) => i !== h.im);
    imageIds.push(h.id);
  }
  return { imageIds, failures };
});

op('ecr', 'get-authorization-token', 'registry-ids:l', 'Token temporal (12 horas) para `docker login`, en base64 como `AWS:<contraseña>`.', { res: () => '*', action: 'ecr:GetAuthorizationToken' }, (c) => {
  const pw = makeToken(c.acct, c.caller);
  return { authorizationData: [{ authorizationToken: b64encode(`AWS:${pw}`), expiresAt: (c.acct.clock + TOKEN_TTL) / 1000, proxyEndpoint: `https://${registryHost(c.acct, c.region)}` }] };
});

op('ecr', 'get-login-password', '', 'Imprime la contraseña de `docker login` (usuario `AWS`): `aws ecr get-login-password | docker login --username AWS --password-stdin <registro>`.', { res: () => '*', action: 'ecr:GetAuthorizationToken' }, (c) => new Raw(makeToken(c.acct, c.caller) + '\n', '', 0));

op('ecr', 'set-repository-policy', 'repository-name:s! policy-text:s! force:b', 'Fija la política de acceso del repositorio (quién más puede subir o bajar imágenes, p. ej. otra cuenta).', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  try {
    JSON.parse(String(c.p.PolicyText));
  } catch {
    throw E.invalid("Invalid parameter at 'PolicyText' failed to satisfy constraint: 'Invalid repository policy provided'");
  }
  r.policy = String(c.p.PolicyText);
  return { registryId: c.acct.id, repositoryName: r.name, policyText: r.policy };
});

op('ecr', 'get-repository-policy', 'repository-name:s!', 'Lee la política del repositorio.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (!r.policy) throw new AwsError('RepositoryPolicyNotFoundException', `Repository policy does not exist for the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  return { registryId: c.acct.id, repositoryName: r.name, policyText: r.policy };
});

op('ecr', 'delete-repository-policy', 'repository-name:s!', 'Quita la política del repositorio.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (!r.policy) throw new AwsError('RepositoryPolicyNotFoundException', `Repository policy does not exist for the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  const text = r.policy;
  r.policy = undefined;
  return { registryId: c.acct.id, repositoryName: r.name, policyText: text };
});

op('ecr', 'put-lifecycle-policy', 'repository-name:s! lifecycle-policy-text:s!', 'Fija las reglas que borran imágenes antiguas o sin etiqueta (por número de imágenes o por días).', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  parsePolicy(String(c.p.LifecyclePolicyText));
  r.lifecycle = String(c.p.LifecyclePolicyText);
  r.lifecycleSetAt = c.acct.clock;
  return { registryId: c.acct.id, repositoryName: r.name, lifecyclePolicyText: r.lifecycle };
});

op('ecr', 'get-lifecycle-policy', 'repository-name:s!', 'Lee la política de ciclo de vida.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (!r.lifecycle) throw new AwsError('LifecyclePolicyNotFoundException', `Lifecycle policy does not exist for the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  return { registryId: c.acct.id, repositoryName: r.name, lifecyclePolicyText: r.lifecycle, lastEvaluatedAt: (r.lifecycleSetAt ?? 0) / 1000 };
});

op('ecr', 'delete-lifecycle-policy', 'repository-name:s!', 'Quita la política de ciclo de vida.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (!r.lifecycle) throw new AwsError('LifecyclePolicyNotFoundException', `Lifecycle policy does not exist for the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  const text = r.lifecycle;
  r.lifecycle = undefined;
  r.lifecycleSetAt = undefined;
  return { registryId: c.acct.id, repositoryName: r.name, lifecyclePolicyText: text };
});

op('ecr', 'start-lifecycle-policy-preview', 'repository-name:s! lifecycle-policy-text:s', 'Calcula qué imágenes borraría una política sin borrar nada (usa la política guardada o la que le pases).', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const text = String(c.p.LifecyclePolicyText ?? r.lifecycle ?? '');
  if (!text) throw new AwsError('LifecyclePolicyNotFoundException', `Lifecycle policy does not exist for the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  parsePolicy(text);
  r.previewText = text;
  return { registryId: c.acct.id, repositoryName: r.name, lifecyclePolicyText: text, status: 'IN_PROGRESS' };
});

op('ecr', 'get-lifecycle-policy-preview', 'repository-name:s! image-ids:f filter:j max-results:i', 'Resultado de la vista previa: las imágenes que se expirarían y la regla que las alcanza.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  if (!r.previewText) throw new AwsError('LifecyclePolicyPreviewNotFoundException', `Lifecycle policy preview does not exist for the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  const keep = r.lifecycle;
  r.lifecycle = r.previewText;
  const hits = lifecyclePreview(r, c.acct.clock);
  r.lifecycle = keep;
  return {
    registryId: c.acct.id,
    repositoryName: r.name,
    lifecyclePolicyText: r.previewText,
    status: 'COMPLETE',
    previewResults: hits.map((h) => ({ ...(h.image.tags.length ? { imageTags: h.image.tags } : {}), imageDigest: h.image.digest, imagePushedAt: h.image.pushedAt / 1000, action: { type: 'EXPIRE' }, appliedRulePriority: h.priority })),
    summary: { expiringImageTotalCount: hits.length },
  };
});

op('ecr', 'start-image-scan', 'repository-name:s! image-id:j!', 'Lanza un escaneo de vulnerabilidades de una imagen.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const id = c.p.ImageId as IdSpec;
  const im = id.imageDigest ? r.images.find((i) => i.digest === id.imageDigest) : r.images.find((i) => i.tags.includes(id.imageTag ?? ''));
  if (!im) throw E.imageNotFound(c.acct, r.name, `{imageDigest:'${id.imageDigest ?? 'null'}', imageTag:'${id.imageTag ?? 'null'}'}`);
  if (im.scan && im.scan.status === 'COMPLETE' && c.acct.clock - im.scan.startedAt < DAY) throw new AwsError('LimitExceededException', 'The scan quota per image has been exceeded. Wait and try again.', 400);
  startScan(r, im, c.acct.clock);
  return { registryId: c.acct.id, repositoryName: r.name, imageId: { imageDigest: im.digest, ...(id.imageTag ? { imageTag: id.imageTag } : {}) }, imageScanStatus: { status: 'IN_PROGRESS' } };
});

op('ecr', 'describe-image-scan-findings', 'repository-name:s! image-id:j! max-results:i', 'Hallazgos del escaneo: cada CVE con su gravedad, el paquete afectado y la versión que lo corrige.', { res: resRepo }, (c) => {
  const r = findRepo(c.acct, c.region, String(c.p.RepositoryName));
  const id = c.p.ImageId as IdSpec;
  const im = id.imageDigest ? r.images.find((i) => i.digest === id.imageDigest) : r.images.find((i) => i.tags.includes(id.imageTag ?? ''));
  if (!im) throw E.imageNotFound(c.acct, r.name, `{imageDigest:'${id.imageDigest ?? 'null'}', imageTag:'${id.imageTag ?? 'null'}'}`);
  if (!im.scan) throw new AwsError('ScanNotFoundException', `Image scan does not exist for the image with '{imageDigest:'${im.digest}', imageTag:'${id.imageTag ?? 'null'}'}' in the repository with name '${r.name}' in the registry with id '${c.acct.id}'`, 400);
  const done = im.scan.status === 'COMPLETE';
  const f = done ? im.scan.findings : [];
  return {
    registryId: c.acct.id,
    repositoryName: r.name,
    imageId: { imageDigest: im.digest, ...(id.imageTag ? { imageTag: id.imageTag } : {}) },
    imageScanStatus: scanStatus(c.acct, im),
    ...(done ? { imageScanFindings: { imageScanCompletedAt: (im.scan.startedAt + SCAN_MS) / 1000, vulnerabilitySourceUpdatedAt: im.scan.startedAt / 1000, findingSeverityCounts: sevCounts(f), findings: f.map((x) => ({ name: x.name, description: x.description, uri: `https://security-tracker.debian.org/tracker/${x.name}`, severity: x.severity, attributes: [{ key: 'package_version', value: x.version }, { key: 'package_name', value: x.package }, { key: 'CVSS2_SCORE', value: x.severity === 'CRITICAL' ? '7.5' : '5.0' }, ...(x.fixedIn ? [{ key: 'fixed_in', value: x.fixedIn }] : [])] })) } } : {}),
  };
});

op('ecr', 'tag-resource', 'resource-arn:s! tags:t!', 'Añade etiquetas al repositorio.', { res: (c) => c.p.ResourceArn }, (c) => {
  const r = Object.values(ecrOf(c.acct, c.region).repos).find((x) => x.arn === c.p.ResourceArn);
  if (!r) throw new AwsError('RepositoryNotFoundException', `The repository with arn '${c.p.ResourceArn}' does not exist.`, 400);
  r.tags = mergeTags(r.tags, c.p.Tags as Tag[]);
  return {};
});

op('ecr', 'untag-resource', 'resource-arn:s! tag-keys:l!', 'Quita etiquetas del repositorio.', { res: (c) => c.p.ResourceArn }, (c) => {
  const r = Object.values(ecrOf(c.acct, c.region).repos).find((x) => x.arn === c.p.ResourceArn);
  if (!r) throw new AwsError('RepositoryNotFoundException', `The repository with arn '${c.p.ResourceArn}' does not exist.`, 400);
  r.tags = r.tags.filter((t) => !(c.p.TagKeys as string[]).includes(t.Key));
  return {};
});

op('ecr', 'list-tags-for-resource', 'resource-arn:s!', 'Lista las etiquetas del repositorio.', { res: (c) => c.p.ResourceArn }, (c) => {
  const r = Object.values(ecrOf(c.acct, c.region).repos).find((x) => x.arn === c.p.ResourceArn);
  if (!r) throw new AwsError('RepositoryNotFoundException', `The repository with arn '${c.p.ResourceArn}' does not exist.`, 400);
  return { tags: r.tags.map((t) => ({ Key: t.Key, Value: t.Value })) };
});

