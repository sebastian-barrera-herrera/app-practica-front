/** AWS IAM: usuarios, grupos, roles, políticas, claves, MFA y simulación. */
import { b64encode } from '../../engine/commands/hash';
import { evaluate, principalPolicies, validatePolicy, type Context, type PolicySource } from '../policy';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, IamGroup, IamRole, IamUser, ManagedPolicy, PolicyDoc, Tag } from '../types';
import { accessKeyId, clone, iamArn, iamId, iso, mergeTags, newId, pascal, secretFor, sortBy, stableId, toArr } from '../util';

const NAME_RE = /^[\w+=,.@-]+$/;

const nameCheck = (what: string, field: string, v: string, max = 64) => {
  if (v.length > max) throw new AwsError('ValidationError', `1 validation error detected: Value '${v}' at '${field}' failed to satisfy constraint: Member must have length less than or equal to ${max}`);
  if (!NAME_RE.test(v)) throw new AwsError('ValidationError', `1 validation error detected: Value '${v}' at '${field}' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\w+=,.@-]+`);
  void what;
};

const noUser = (n: string) => new AwsError('NoSuchEntity', `The user with name ${n} cannot be found.`, 404);
const noGroup = (n: string) => new AwsError('NoSuchEntity', `The group with name ${n} cannot be found.`, 404);
const noRole = (n: string) => new AwsError('NoSuchEntity', `The role with name ${n} cannot be found.`, 404);
const noPolicy = (arn: string) => new AwsError('NoSuchEntity', `Policy ${arn} was not found.`, 404);

const normPath = (p: string | undefined): string => {
  if (!p) return '/';
  if (!/^\/([!-~]+\/)?$/.test(p)) throw new AwsError('ValidationError', `1 validation error detected: Value '${p}' at 'path' failed to satisfy constraint: Member must satisfy regular expression pattern: (\\u002F)|(\\u002F[\\u0021-\\u007E]+\\u002F)`);
  return p;
};

function parseDoc(raw: unknown, kind: 'identity' | 'trust' = 'identity'): PolicyDoc {
  let doc: unknown;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new AwsError('MalformedPolicyDocument', 'Syntax errors in policy.', 400);
    }
  } else doc = raw;
  const err = validatePolicy(doc, kind);
  if (err) throw new AwsError('MalformedPolicyDocument', err, 400);
  return doc as PolicyDoc;
}

// ───────────────────────── acceso al estado ─────────────────────────

const user = (a: Account, n: string): IamUser => a.iam.users[n] ?? (() => { throw noUser(n); })();
const group = (a: Account, n: string): IamGroup => a.iam.groups[n] ?? (() => { throw noGroup(n); })();
const role = (a: Account, n: string): IamRole => a.iam.roles[n] ?? (() => { throw noRole(n); })();

function managed(a: Account, arn: string): ManagedPolicy {
  const p = a.iam.policies[arn];
  if (!p) throw noPolicy(arn);
  return p;
}

const lastName = (arn: string) => arn.split('/').pop() ?? arn;

/** Nombre de usuario por defecto: el que llama. */
function whom(c: OpCtx, name: string | undefined): string {
  if (name) return name;
  if (c.caller.userName) return c.caller.userName;
  throw new AwsError('ValidationError', 'Must specify userName when calling with non-User credentials');
}

// ───────────────────────── vistas JSON ─────────────────────────

const userView = (u: IamUser, full = false) => {
  const o: Record<string, unknown> = { Path: u.Path, UserName: u.UserName, UserId: u.UserId, Arn: u.Arn, CreateDate: u.CreateDate };
  if (u.boundary && full) o.PermissionsBoundary = { PermissionsBoundaryType: 'Policy', PermissionsBoundaryArn: u.boundary };
  if (u.Tags.length && full) o.Tags = u.Tags;
  return o;
};

const groupView = (g: IamGroup) => ({ Path: g.Path, GroupName: g.GroupName, GroupId: g.GroupId, Arn: g.Arn, CreateDate: g.CreateDate });

const roleView = (r: IamRole, full = true) => {
  const o: Record<string, unknown> = { Path: r.Path, RoleName: r.RoleName, RoleId: r.RoleId, Arn: r.Arn, CreateDate: r.CreateDate, AssumeRolePolicyDocument: r.AssumeRolePolicyDocument };
  if (full) {
    if (r.Description) o.Description = r.Description;
    o.MaxSessionDuration = r.MaxSessionDuration;
  }
  if (r.boundary) o.PermissionsBoundary = { PermissionsBoundaryType: 'Policy', PermissionsBoundaryArn: r.boundary };
  if (r.Tags.length) o.Tags = r.Tags;
  return o;
};

function attachCount(a: Account, arn: string): number {
  const { users, groups, roles } = a.iam;
  return [...Object.values(users), ...Object.values(groups), ...Object.values(roles)].filter((e) => e.attached.includes(arn)).length;
}

const policyView = (a: Account, p: ManagedPolicy) => ({
  PolicyName: p.PolicyName,
  PolicyId: p.PolicyId,
  Arn: p.Arn,
  Path: p.Path,
  DefaultVersionId: p.DefaultVersionId,
  AttachmentCount: attachCount(a, p.Arn),
  PermissionsBoundaryUsageCount: [...Object.values(a.iam.users), ...Object.values(a.iam.roles)].filter((e) => e.boundary === p.Arn).length,
  IsAttachable: true,
  CreateDate: p.CreateDate,
  UpdateDate: p.CreateDate,
});

// ───────────────────────── funciones de construcción (las usan los escenarios) ─────────────────────────

export function iamCreateUser(a: Account, name: string, o: { path?: string; tags?: Tag[]; groups?: string[]; attached?: string[]; inline?: Record<string, PolicyDoc>; keys?: number; password?: boolean; mfa?: boolean } = {}): IamUser {
  const path = o.path ?? '/';
  const u: IamUser = {
    UserName: name,
    UserId: iamId(a, 'AIDA'),
    Arn: iamArn(a, 'user', name, path),
    Path: path,
    CreateDate: iso(a.clock),
    groups: [],
    attached: [],
    inline: {},
    Tags: o.tags ?? [],
    accessKeys: [],
    loginProfile: !!o.password,
    mfa: [],
  };
  a.iam.users[name] = u;
  for (const g of o.groups ?? []) iamAddToGroup(a, g, name);
  for (const p of o.attached ?? []) u.attached.push(p.startsWith('arn:') ? p : `arn:aws:iam::aws:policy/${p}`);
  Object.assign(u.inline, o.inline ?? {});
  for (let i = 0; i < (o.keys ?? 0); i++) iamCreateKey(a, name);
  if (o.mfa) {
    const serial = `arn:aws:iam::${a.id}:mfa/${name}`;
    a.iam.mfaDevices[serial] = { SerialNumber: serial, User: name, EnableDate: iso(a.clock) };
    u.mfa.push(serial);
  }
  return u;
}

export function iamCreateKey(a: Account, userName: string): { AccessKeyId: string; SecretAccessKey: string } {
  const u = user(a, userName);
  const id = accessKeyId(a);
  u.accessKeys.push({ AccessKeyId: id, Status: 'Active', CreateDate: iso(a.clock) });
  return { AccessKeyId: id, SecretAccessKey: secretFor(id) };
}

export function iamCreateGroup(a: Account, name: string, o: { path?: string; attached?: string[]; inline?: Record<string, PolicyDoc> } = {}): IamGroup {
  const path = o.path ?? '/';
  const g: IamGroup = { GroupName: name, GroupId: iamId(a, 'AGPA'), Arn: iamArn(a, 'group', name, path), Path: path, CreateDate: iso(a.clock), attached: [], inline: o.inline ?? {} };
  for (const p of o.attached ?? []) g.attached.push(p.startsWith('arn:') ? p : `arn:aws:iam::aws:policy/${p}`);
  a.iam.groups[name] = g;
  return g;
}

export function iamAddToGroup(a: Account, groupName: string, userName: string): void {
  const u = user(a, userName);
  group(a, groupName);
  if (!u.groups.includes(groupName)) u.groups.push(groupName);
}

export function iamCreateRole(a: Account, name: string, trust: PolicyDoc, o: { path?: string; description?: string; attached?: string[]; inline?: Record<string, PolicyDoc>; maxSession?: number; tags?: Tag[] } = {}): IamRole {
  const path = o.path ?? '/';
  const r: IamRole = {
    RoleName: name,
    RoleId: iamId(a, 'AROA'),
    Arn: iamArn(a, 'role', name, path),
    Path: path,
    CreateDate: iso(a.clock),
    AssumeRolePolicyDocument: trust,
    Description: o.description,
    MaxSessionDuration: o.maxSession ?? 3600,
    attached: (o.attached ?? []).map((p) => (p.startsWith('arn:') ? p : `arn:aws:iam::aws:policy/${p}`)),
    inline: o.inline ?? {},
    Tags: o.tags ?? [],
  };
  a.iam.roles[name] = r;
  return r;
}

export function iamCreatePolicy(a: Account, name: string, document: PolicyDoc, o: { path?: string; description?: string } = {}): ManagedPolicy {
  const path = o.path ?? '/';
  const arn = iamArn(a, 'policy', name, path);
  const p: ManagedPolicy = { PolicyName: name, PolicyId: iamId(a, 'ANPA'), Arn: arn, Path: path, aws: false, Description: o.description, CreateDate: iso(a.clock), document, DefaultVersionId: 'v1', versions: {} };
  a.iam.policies[arn] = p;
  return p;
}

// ───────────────────────── usuarios ─────────────────────────

op('iam', 'create-user', 'user-name:s! path:s permissions-boundary:s tags:t', 'Crea un usuario de IAM.', {
  res: (c) => iamArn(c.acct, 'user', c.p.UserName, c.p.Path ?? '/'),
  ctx: (c) => Object.fromEntries((c.p.Tags ?? []).map((t: Tag) => [`aws:RequestTag/${t.Key}`, t.Value])),
}, (c) => {
  const n = c.p.UserName as string;
  nameCheck('user', 'userName', n);
  if (c.acct.iam.users[n]) throw new AwsError('EntityAlreadyExists', `User with name ${n} already exists.`, 409);
  if (c.p.PermissionsBoundary) managed(c.acct, c.p.PermissionsBoundary);
  const u = iamCreateUser(c.acct, n, { path: normPath(c.p.Path), tags: c.p.Tags });
  if (c.p.PermissionsBoundary) u.boundary = c.p.PermissionsBoundary;
  return { User: userView(u, true) };
});

op('iam', 'get-user', 'user-name:s', 'Datos de un usuario (sin nombre: el usuario con el que llamas).', { res: (c) => iamArn(c.acct, 'user', whom(c, c.p.UserName)) }, (c) => {
  const u = user(c.acct, whom(c, c.p.UserName));
  return { User: userView(u, true) };
});

op('iam', 'list-users', 'path-prefix:s', 'Lista los usuarios de la cuenta.', { paginate: 'Users', res: (c) => `arn:aws:iam::${c.acct.id}:user${c.p.PathPrefix ?? '/'}` }, (c) => {
  const pre = c.p.PathPrefix ?? '/';
  return { Users: sortBy(Object.values(c.acct.iam.users).filter((u) => u.Path.startsWith(pre)), (u) => u.CreateDate + u.UserName).map((u) => userView(u)) };
});

op('iam', 'delete-user', 'user-name:s!', 'Borra un usuario (antes hay que quitarle claves, políticas, MFA y grupos).', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  const conflict = (m: string) => new AwsError('DeleteConflict', `Cannot delete entity, must ${m} first.`, 409);
  if (u.accessKeys.length) throw conflict('delete access keys');
  if (u.loginProfile) throw conflict('delete login profile');
  if (u.mfa.length) throw conflict('delete its MFA device');
  if (Object.keys(u.inline).length) throw conflict('delete policies');
  if (u.attached.length) throw conflict('detach all policies');
  if (u.groups.length) throw conflict('remove user from all groups');
  delete c.acct.iam.users[u.UserName];
  return undefined;
});

op('iam', 'update-user', 'user-name:s! new-user-name:s new-path:s', 'Cambia el nombre o la ruta de un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  if (c.p.NewUserName) {
    nameCheck('user', 'newUserName', c.p.NewUserName);
    if (c.acct.iam.users[c.p.NewUserName]) throw new AwsError('EntityAlreadyExists', `User with name ${c.p.NewUserName} already exists.`, 409);
    delete c.acct.iam.users[u.UserName];
    u.UserName = c.p.NewUserName;
    c.acct.iam.users[u.UserName] = u;
  }
  if (c.p.NewPath) u.Path = normPath(c.p.NewPath);
  u.Arn = iamArn(c.acct, 'user', u.UserName, u.Path);
  return undefined;
});

op('iam', 'tag-user', 'user-name:s! tags:t!', 'Añade etiquetas a un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  u.Tags = mergeTags(u.Tags, c.p.Tags);
  return undefined;
});
op('iam', 'untag-user', 'user-name:s! tag-keys:l!', 'Quita etiquetas de un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  u.Tags = u.Tags.filter((t) => !c.p.TagKeys.includes(t.Key));
  return undefined;
});
op('iam', 'list-user-tags', 'user-name:s!', 'Lista las etiquetas de un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => ({ Tags: user(c.acct, c.p.UserName).Tags, IsTruncated: false }));

// ───────────────────────── claves de acceso ─────────────────────────

op('iam', 'create-access-key', 'user-name:s', 'Crea una clave de acceso (máximo 2 por usuario). El secreto solo se ve ahora.', { res: (c) => iamArn(c.acct, 'user', whom(c, c.p.UserName)) }, (c) => {
  const n = whom(c, c.p.UserName);
  const u = user(c.acct, n);
  if (u.accessKeys.length >= 2) throw new AwsError('LimitExceeded', 'Cannot exceed quota for AccessKeysPerUser: 2', 409);
  const k = iamCreateKey(c.acct, n);
  return { AccessKey: { UserName: n, AccessKeyId: k.AccessKeyId, Status: 'Active', SecretAccessKey: k.SecretAccessKey, CreateDate: iso(c.acct.clock) } };
});

op('iam', 'list-access-keys', 'user-name:s', 'Lista las claves de acceso de un usuario (sin los secretos).', { paginate: 'AccessKeyMetadata', res: (c) => iamArn(c.acct, 'user', whom(c, c.p.UserName)) }, (c) => {
  const n = whom(c, c.p.UserName);
  const u = user(c.acct, n);
  return { AccessKeyMetadata: u.accessKeys.map((k) => ({ UserName: n, AccessKeyId: k.AccessKeyId, Status: k.Status, CreateDate: k.CreateDate })) };
});

op('iam', 'update-access-key', 'user-name:s access-key-id:s! status:s!', 'Activa o desactiva una clave (Active / Inactive).', { res: (c) => iamArn(c.acct, 'user', whom(c, c.p.UserName)) }, (c) => {
  const u = user(c.acct, whom(c, c.p.UserName));
  const k = u.accessKeys.find((x) => x.AccessKeyId === c.p.AccessKeyId);
  if (!k) throw new AwsError('NoSuchEntity', `The Access Key with id ${c.p.AccessKeyId} cannot be found.`, 404);
  if (c.p.Status !== 'Active' && c.p.Status !== 'Inactive') throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.Status}' at 'status' failed to satisfy constraint: Member must satisfy enum value set: [Inactive, Active]`);
  k.Status = c.p.Status;
  return undefined;
});

op('iam', 'delete-access-key', 'user-name:s access-key-id:s!', 'Borra una clave de acceso.', { res: (c) => iamArn(c.acct, 'user', whom(c, c.p.UserName)) }, (c) => {
  const u = user(c.acct, whom(c, c.p.UserName));
  const i = u.accessKeys.findIndex((x) => x.AccessKeyId === c.p.AccessKeyId);
  if (i < 0) throw new AwsError('NoSuchEntity', `The Access Key with id ${c.p.AccessKeyId} cannot be found.`, 404);
  u.accessKeys.splice(i, 1);
  return undefined;
});

op('iam', 'get-access-key-last-used', 'access-key-id:s!', 'Cuándo y dónde se usó por última vez una clave.', { res: () => '*' }, (c) => {
  for (const u of Object.values(c.acct.iam.users)) {
    const k = u.accessKeys.find((x) => x.AccessKeyId === c.p.AccessKeyId);
    if (k) return { UserName: u.UserName, AccessKeyLastUsed: { LastUsedDate: k.CreateDate, ServiceName: 'N/A', Region: 'N/A' } };
  }
  throw new AwsError('NoSuchEntity', `The Access Key with id ${c.p.AccessKeyId} cannot be found.`, 404);
});

// ───────────────────────── contraseña de consola ─────────────────────────

op('iam', 'create-login-profile', 'user-name:s! password:s! password-reset-required:b', 'Da acceso a la consola web a un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  if (u.loginProfile) throw new AwsError('EntityAlreadyExists', `Login Profile for User ${u.UserName} already exists.`, 409);
  const pp = c.acct.iam.passwordPolicy;
  const pw = String(c.p.Password);
  const min = pp?.MinimumPasswordLength ?? 8;
  if (pw.length < min) throw new AwsError('PasswordPolicyViolation', `Password does not conform to the account password policy.`, 400);
  if (pp?.RequireNumbers && !/\d/.test(pw)) throw new AwsError('PasswordPolicyViolation', 'Password does not conform to the account password policy.', 400);
  if (pp?.RequireSymbols && !/[^\w\s]/.test(pw)) throw new AwsError('PasswordPolicyViolation', 'Password does not conform to the account password policy.', 400);
  if (pp?.RequireUppercaseCharacters && !/[A-Z]/.test(pw)) throw new AwsError('PasswordPolicyViolation', 'Password does not conform to the account password policy.', 400);
  if (pp?.RequireLowercaseCharacters && !/[a-z]/.test(pw)) throw new AwsError('PasswordPolicyViolation', 'Password does not conform to the account password policy.', 400);
  u.loginProfile = true;
  return { LoginProfile: { UserName: u.UserName, CreateDate: iso(c.acct.clock), PasswordResetRequired: !!c.p.PasswordResetRequired } };
});
op('iam', 'get-login-profile', 'user-name:s!', 'Comprueba si un usuario tiene contraseña de consola.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  if (!u.loginProfile) throw new AwsError('NoSuchEntity', `Login Profile for User ${u.UserName} cannot be found.`, 404);
  return { LoginProfile: { UserName: u.UserName, CreateDate: u.CreateDate, PasswordResetRequired: false } };
});
op('iam', 'delete-login-profile', 'user-name:s!', 'Quita la contraseña de consola a un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  if (!u.loginProfile) throw new AwsError('NoSuchEntity', `Login Profile for User ${u.UserName} cannot be found.`, 404);
  u.loginProfile = false;
  return undefined;
});

// ───────────────────────── grupos ─────────────────────────

op('iam', 'create-group', 'group-name:s! path:s', 'Crea un grupo de IAM.', { res: (c) => iamArn(c.acct, 'group', c.p.GroupName, c.p.Path ?? '/') }, (c) => {
  nameCheck('group', 'groupName', c.p.GroupName, 128);
  if (c.acct.iam.groups[c.p.GroupName]) throw new AwsError('EntityAlreadyExists', `Group with name ${c.p.GroupName} already exists.`, 409);
  return { Group: groupView(iamCreateGroup(c.acct, c.p.GroupName, { path: normPath(c.p.Path) })) };
});
op('iam', 'get-group', 'group-name:s!', 'Datos de un grupo y de sus miembros.', { res: (c) => iamArn(c.acct, 'group', c.p.GroupName) }, (c) => {
  const g = group(c.acct, c.p.GroupName);
  return { Users: Object.values(c.acct.iam.users).filter((u) => u.groups.includes(g.GroupName)).map((u) => userView(u)), Group: groupView(g), IsTruncated: false };
});
op('iam', 'list-groups', 'path-prefix:s', 'Lista los grupos.', { paginate: 'Groups', res: (c) => `arn:aws:iam::${c.acct.id}:group${c.p.PathPrefix ?? '/'}` }, (c) => ({ Groups: sortBy(Object.values(c.acct.iam.groups), (g) => g.GroupName).map(groupView) }));
op('iam', 'delete-group', 'group-name:s!', 'Borra un grupo (debe estar vacío y sin políticas).', { res: (c) => iamArn(c.acct, 'group', c.p.GroupName) }, (c) => {
  const g = group(c.acct, c.p.GroupName);
  if (Object.values(c.acct.iam.users).some((u) => u.groups.includes(g.GroupName))) throw new AwsError('DeleteConflict', 'Cannot delete entity, must remove users from group first.', 409);
  if (g.attached.length || Object.keys(g.inline).length) throw new AwsError('DeleteConflict', 'Cannot delete entity, must detach all policies first.', 409);
  delete c.acct.iam.groups[g.GroupName];
  return undefined;
});
op('iam', 'add-user-to-group', 'group-name:s! user-name:s!', 'Mete a un usuario en un grupo (hereda sus políticas).', { res: (c) => iamArn(c.acct, 'group', c.p.GroupName) }, (c) => {
  iamAddToGroup(c.acct, c.p.GroupName, c.p.UserName);
  return undefined;
});
op('iam', 'remove-user-from-group', 'group-name:s! user-name:s!', 'Saca a un usuario de un grupo.', { res: (c) => iamArn(c.acct, 'group', c.p.GroupName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  group(c.acct, c.p.GroupName);
  u.groups = u.groups.filter((g) => g !== c.p.GroupName);
  return undefined;
});
op('iam', 'list-groups-for-user', 'user-name:s!', 'Grupos a los que pertenece un usuario.', { paginate: 'Groups', res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => ({
  Groups: user(c.acct, c.p.UserName).groups.map((g) => groupView(c.acct.iam.groups[g])).filter(Boolean),
}));

// ───────────────────────── políticas administradas ─────────────────────────

op('iam', 'create-policy', 'policy-name:s! policy-document:s! path:s description:s tags:t', 'Crea una política administrada por el cliente.', { res: (c) => iamArn(c.acct, 'policy', c.p.PolicyName, c.p.Path ?? '/') }, (c) => {
  nameCheck('policy', 'policyName', c.p.PolicyName, 128);
  const arn = iamArn(c.acct, 'policy', c.p.PolicyName, normPath(c.p.Path));
  if (c.acct.iam.policies[arn]) throw new AwsError('EntityAlreadyExists', `A policy called ${c.p.PolicyName} already exists. Duplicate names are not allowed.`, 409);
  const doc = parseDoc(c.p.PolicyDocument);
  const p = iamCreatePolicy(c.acct, c.p.PolicyName, doc, { path: normPath(c.p.Path), description: c.p.Description });
  return { Policy: policyView(c.acct, p) };
});
op('iam', 'get-policy', 'policy-arn:s!', 'Datos de una política (no su contenido: eso es get-policy-version).', { res: (c) => c.p.PolicyArn }, (c) => ({ Policy: policyView(c.acct, managed(c.acct, c.p.PolicyArn)) }));
op('iam', 'get-policy-version', 'policy-arn:s! version-id:s!', 'El documento JSON de una versión de una política.', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  const v = c.p.VersionId as string;
  const doc = v === p.DefaultVersionId ? p.document : p.versions[v];
  if (!doc) throw new AwsError('NoSuchEntity', `Policy ${p.Arn} version ${v} does not exist.`, 404);
  return { PolicyVersion: { Document: doc, VersionId: v, IsDefaultVersion: v === p.DefaultVersionId, CreateDate: p.CreateDate } };
});
op('iam', 'list-policies', 'scope:s only-attached:b path-prefix:s', 'Lista políticas (All, AWS o Local).', { paginate: 'Policies', res: (c) => `arn:aws:iam::${c.acct.id}:policy${c.p.PathPrefix ?? '/'}` }, (c) => {
  const scope = c.p.Scope ?? 'All';
  if (!['All', 'AWS', 'Local'].includes(scope)) throw new AwsError('ValidationError', `1 validation error detected: Value '${scope}' at 'scope' failed to satisfy constraint: Member must satisfy enum value set: [All, AWS, Local]`);
  let list = Object.values(c.acct.iam.policies).filter((p) => scope === 'All' || (scope === 'AWS' ? p.aws : !p.aws));
  if (c.p.OnlyAttached) list = list.filter((p) => attachCount(c.acct, p.Arn) > 0);
  if (c.p.PathPrefix) list = list.filter((p) => p.Path.startsWith(c.p.PathPrefix));
  return { Policies: sortBy(list, (p) => p.PolicyName).map((p) => policyView(c.acct, p)) };
});
op('iam', 'delete-policy', 'policy-arn:s!', 'Borra una política (no puede estar asociada a nadie ni tener versiones extra).', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  if (p.aws) throw new AwsError('AccessDenied', `Cannot delete AWS managed policy ${p.Arn}`, 403);
  if (attachCount(c.acct, p.Arn) > 0) throw new AwsError('DeleteConflict', 'Cannot delete a policy attached to entities.', 409);
  if (Object.keys(p.versions).length) throw new AwsError('DeleteConflict', 'Cannot delete a policy with non-default versions. Delete the other versions first.', 409);
  delete c.acct.iam.policies[p.Arn];
  return undefined;
});
op('iam', 'list-policy-versions', 'policy-arn:s!', 'Versiones de una política.', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  const vs = [p.DefaultVersionId, ...Object.keys(p.versions)];
  return { Versions: vs.map((v) => ({ VersionId: v, IsDefaultVersion: v === p.DefaultVersionId, CreateDate: p.CreateDate })) };
});
op('iam', 'create-policy-version', 'policy-arn:s! policy-document:s! set-as-default:b', 'Crea una versión nueva de una política (máximo 5).', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  if (p.aws) throw new AwsError('AccessDenied', `Cannot modify AWS managed policy ${p.Arn}`, 403);
  const doc = parseDoc(c.p.PolicyDocument);
  if (1 + Object.keys(p.versions).length >= 5) throw new AwsError('LimitExceeded', 'A managed policy can have up to 5 versions. Before you create a new version, you must delete an existing version.', 409);
  const n = c.acct.counters['pv:' + p.Arn] = (c.acct.counters['pv:' + p.Arn] ?? 1) + 1;
  const id = `v${n}`;
  if (c.p.SetAsDefault) {
    p.versions[p.DefaultVersionId] = p.document;
    p.document = doc;
    p.DefaultVersionId = id;
    delete p.versions[id];
  } else p.versions[id] = doc;
  return { PolicyVersion: { VersionId: id, IsDefaultVersion: !!c.p.SetAsDefault, CreateDate: iso(c.acct.clock) } };
});
op('iam', 'set-default-policy-version', 'policy-arn:s! version-id:s!', 'Elige qué versión de la política está en vigor.', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  const v = c.p.VersionId as string;
  if (v === p.DefaultVersionId) return undefined;
  const doc = p.versions[v];
  if (!doc) throw new AwsError('NoSuchEntity', `Policy ${p.Arn} version ${v} does not exist.`, 404);
  p.versions[p.DefaultVersionId] = p.document;
  p.document = doc;
  delete p.versions[v];
  p.DefaultVersionId = v;
  return undefined;
});
op('iam', 'delete-policy-version', 'policy-arn:s! version-id:s!', 'Borra una versión que no sea la activa.', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  if (c.p.VersionId === p.DefaultVersionId) throw new AwsError('DeleteConflict', 'Cannot delete the default version of a policy.', 409);
  if (!p.versions[c.p.VersionId]) throw new AwsError('NoSuchEntity', `Policy ${p.Arn} version ${c.p.VersionId} does not exist.`, 404);
  delete p.versions[c.p.VersionId];
  return undefined;
});
op('iam', 'list-entities-for-policy', 'policy-arn:s! entity-filter:s', 'Quién tiene asociada una política.', { res: (c) => c.p.PolicyArn }, (c) => {
  const p = managed(c.acct, c.p.PolicyArn);
  const f = c.p.EntityFilter as string | undefined;
  const has = (e: { attached: string[] }) => e.attached.includes(p.Arn);
  return {
    PolicyGroups: !f || f === 'Group' ? Object.values(c.acct.iam.groups).filter(has).map((g) => ({ GroupName: g.GroupName, GroupId: g.GroupId })) : [],
    PolicyUsers: !f || f === 'User' ? Object.values(c.acct.iam.users).filter(has).map((u) => ({ UserName: u.UserName, UserId: u.UserId })) : [],
    PolicyRoles: !f || f === 'Role' ? Object.values(c.acct.iam.roles).filter(has).map((r) => ({ RoleName: r.RoleName, RoleId: r.RoleId })) : [],
    IsTruncated: false,
  };
});

// ───────────────────────── asociar políticas ─────────────────────────

type Holder = { attached: string[]; inline: Record<string, PolicyDoc> };
const holders: [string, string, string, (a: Account, n: string) => Holder, (a: Account, n: string, p: OpCtx['p']) => string][] = [
  ['user', 'User', 'user-name', (a, n) => user(a, n), (a, n) => iamArn(a, 'user', n)],
  ['group', 'Group', 'group-name', (a, n) => group(a, n), (a, n) => iamArn(a, 'group', n)],
  ['role', 'Role', 'role-name', (a, n) => role(a, n), (a, n) => iamArn(a, 'role', n)],
];

for (const [kind, Kind, flag, get, arnOf] of holders) {
  const key = pascal(flag);
  const arnFor = (c: OpCtx) => arnOf(c.acct, c.p[key], c.p);

  op('iam', `attach-${kind}-policy`, `${flag}:s! policy-arn:s!`, `Asocia una política administrada a ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { res: arnFor, ctx: (c) => ({ 'iam:PolicyARN': c.p.PolicyArn }) }, (c) => {
    const h = get(c.acct, c.p[key]);
    if (!c.acct.iam.policies[c.p.PolicyArn]) throw new AwsError('NoSuchEntity', `Policy ${c.p.PolicyArn} does not exist or is not attachable.`, 404);
    if (h.attached.length >= 10 && !h.attached.includes(c.p.PolicyArn)) throw new AwsError('LimitExceeded', `Cannot exceed quota for PolicyPerUser: 10`, 409);
    if (!h.attached.includes(c.p.PolicyArn)) h.attached.push(c.p.PolicyArn);
    return undefined;
  });
  op('iam', `detach-${kind}-policy`, `${flag}:s! policy-arn:s!`, `Quita una política administrada de ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { res: arnFor, ctx: (c) => ({ 'iam:PolicyARN': c.p.PolicyArn }) }, (c) => {
    const h = get(c.acct, c.p[key]);
    if (!h.attached.includes(c.p.PolicyArn)) throw new AwsError('NoSuchEntity', `Policy ${c.p.PolicyArn} was not found.`, 404);
    h.attached = h.attached.filter((x) => x !== c.p.PolicyArn);
    return undefined;
  });
  op('iam', `list-attached-${kind}-policies`, `${flag}:s! path-prefix:s`, `Políticas administradas asociadas a ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { paginate: 'AttachedPolicies', res: arnFor }, (c) => ({
    AttachedPolicies: get(c.acct, c.p[key]).attached.map((arn) => ({ PolicyName: lastName(arn), PolicyArn: arn })),
  }));
  op('iam', `put-${kind}-policy`, `${flag}:s! policy-name:s! policy-document:s!`, `Crea o reemplaza una política en línea (inline) de ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { res: arnFor }, (c) => {
    const h = get(c.acct, c.p[key]);
    nameCheck('policy', 'policyName', c.p.PolicyName, 128);
    h.inline[c.p.PolicyName] = parseDoc(c.p.PolicyDocument);
    return undefined;
  });
  op('iam', `get-${kind}-policy`, `${flag}:s! policy-name:s!`, `Lee una política en línea de ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { res: arnFor }, (c) => {
    const h = get(c.acct, c.p[key]);
    const d = h.inline[c.p.PolicyName];
    if (!d) throw new AwsError('NoSuchEntity', `The ${kind} policy with name ${c.p.PolicyName} cannot be found.`, 404);
    return { [key]: c.p[key], PolicyName: c.p.PolicyName, PolicyDocument: d };
  });
  op('iam', `delete-${kind}-policy`, `${flag}:s! policy-name:s!`, `Borra una política en línea de ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { res: arnFor }, (c) => {
    const h = get(c.acct, c.p[key]);
    if (!h.inline[c.p.PolicyName]) throw new AwsError('NoSuchEntity', `The ${kind} policy with name ${c.p.PolicyName} cannot be found.`, 404);
    delete h.inline[c.p.PolicyName];
    return undefined;
  });
  op('iam', `list-${kind}-policies`, `${flag}:s!`, `Nombres de las políticas en línea de ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`, { paginate: 'PolicyNames', res: arnFor }, (c) => ({ PolicyNames: Object.keys(get(c.acct, c.p[key]).inline), IsTruncated: false }));
  void Kind;
}

// ───────────────────────── roles ─────────────────────────

op('iam', 'create-role', 'role-name:s! assume-role-policy-document:s! path:s description:s max-session-duration:i permissions-boundary:s tags:t', 'Crea un rol y su política de confianza (quién puede asumirlo).', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName, c.p.Path ?? '/') }, (c) => {
  nameCheck('role', 'roleName', c.p.RoleName, 64);
  if (c.acct.iam.roles[c.p.RoleName]) throw new AwsError('EntityAlreadyExists', `Role with name ${c.p.RoleName} already exists.`, 409);
  const trust = parseDoc(c.p.AssumeRolePolicyDocument, 'trust');
  const max = c.p.MaxSessionDuration ?? 3600;
  if (max < 3600 || max > 43200) throw new AwsError('ValidationError', `1 validation error detected: Value '${max}' at 'maxSessionDuration' failed to satisfy constraint: Member must have value ${max < 3600 ? 'greater than or equal to 3600' : 'less than or equal to 43200'}`);
  const r = iamCreateRole(c.acct, c.p.RoleName, trust, { path: normPath(c.p.Path), description: c.p.Description, maxSession: max, tags: c.p.Tags });
  if (c.p.PermissionsBoundary) r.boundary = c.p.PermissionsBoundary;
  return { Role: roleView(r, false) };
});
op('iam', 'get-role', 'role-name:s!', 'Datos de un rol (incluida su política de confianza).', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => ({ Role: { ...roleView(role(c.acct, c.p.RoleName)), RoleLastUsed: {} } }));
op('iam', 'list-roles', 'path-prefix:s', 'Lista los roles.', { paginate: 'Roles', res: (c) => `arn:aws:iam::${c.acct.id}:role${c.p.PathPrefix ?? '/'}` }, (c) => ({ Roles: sortBy(Object.values(c.acct.iam.roles).filter((r) => r.Path.startsWith(c.p.PathPrefix ?? '/')), (r) => r.RoleName).map((r) => roleView(r)) }));
op('iam', 'delete-role', 'role-name:s!', 'Borra un rol (sin políticas ni perfiles de instancia).', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => {
  const r = role(c.acct, c.p.RoleName);
  if (r.attached.length || Object.keys(r.inline).length) throw new AwsError('DeleteConflict', 'Cannot delete entity, must detach all policies first.', 409);
  if (Object.values(c.acct.iam.instanceProfiles).some((i) => i.roles.includes(r.RoleName))) throw new AwsError('DeleteConflict', 'Cannot delete entity, must remove roles from instance profile first.', 409);
  delete c.acct.iam.roles[r.RoleName];
  return undefined;
});
op('iam', 'update-assume-role-policy', 'role-name:s! policy-document:s!', 'Cambia la política de confianza de un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => {
  const r = role(c.acct, c.p.RoleName);
  r.AssumeRolePolicyDocument = parseDoc(c.p.PolicyDocument, 'trust');
  return undefined;
});
op('iam', 'update-role', 'role-name:s! description:s max-session-duration:i', 'Cambia la descripción o la duración máxima de sesión de un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => {
  const r = role(c.acct, c.p.RoleName);
  if (c.p.Description !== undefined) r.Description = c.p.Description;
  if (c.p.MaxSessionDuration !== undefined) r.MaxSessionDuration = c.p.MaxSessionDuration;
  return {};
});
op('iam', 'tag-role', 'role-name:s! tags:t!', 'Añade etiquetas a un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => {
  const r = role(c.acct, c.p.RoleName);
  r.Tags = mergeTags(r.Tags, c.p.Tags);
  return undefined;
});
op('iam', 'list-role-tags', 'role-name:s!', 'Lista las etiquetas de un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => ({ Tags: role(c.acct, c.p.RoleName).Tags, IsTruncated: false }));

// ───────────────────────── límites de permisos ─────────────────────────

op('iam', 'put-user-permissions-boundary', 'user-name:s! permissions-boundary:s!', 'Pone un límite de permisos a un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  managed(c.acct, c.p.PermissionsBoundary);
  u.boundary = c.p.PermissionsBoundary;
  return undefined;
});
op('iam', 'delete-user-permissions-boundary', 'user-name:s!', 'Quita el límite de permisos de un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  user(c.acct, c.p.UserName).boundary = undefined;
  return undefined;
});
op('iam', 'put-role-permissions-boundary', 'role-name:s! permissions-boundary:s!', 'Pone un límite de permisos a un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => {
  const r = role(c.acct, c.p.RoleName);
  managed(c.acct, c.p.PermissionsBoundary);
  r.boundary = c.p.PermissionsBoundary;
  return undefined;
});
op('iam', 'delete-role-permissions-boundary', 'role-name:s!', 'Quita el límite de permisos de un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => {
  role(c.acct, c.p.RoleName).boundary = undefined;
  return undefined;
});

// ───────────────────────── perfiles de instancia ─────────────────────────

op('iam', 'create-instance-profile', 'instance-profile-name:s! path:s', 'Crea un perfil de instancia (el «contenedor» que lleva un rol a una EC2).', { res: (c) => iamArn(c.acct, 'instance-profile', c.p.InstanceProfileName) }, (c) => {
  const n = c.p.InstanceProfileName as string;
  nameCheck('instance profile', 'instanceProfileName', n, 128);
  if (c.acct.iam.instanceProfiles[n]) throw new AwsError('EntityAlreadyExists', `Instance Profile ${n} already exists.`, 409);
  const path = normPath(c.p.Path);
  const ip = { InstanceProfileName: n, InstanceProfileId: iamId(c.acct, 'AIPA'), Arn: iamArn(c.acct, 'instance-profile', n, path), Path: path, CreateDate: iso(c.acct.clock), roles: [] as string[] };
  c.acct.iam.instanceProfiles[n] = ip;
  return { InstanceProfile: { Path: ip.Path, InstanceProfileName: n, InstanceProfileId: ip.InstanceProfileId, Arn: ip.Arn, CreateDate: ip.CreateDate, Roles: [] } };
});
const ipView = (a: Account, n: string) => {
  const ip = a.iam.instanceProfiles[n];
  return { Path: ip.Path, InstanceProfileName: ip.InstanceProfileName, InstanceProfileId: ip.InstanceProfileId, Arn: ip.Arn, CreateDate: ip.CreateDate, Roles: ip.roles.map((r) => roleView(a.iam.roles[r], false)) };
};
const ipGet = (a: Account, n: string) => {
  if (!a.iam.instanceProfiles[n]) throw new AwsError('NoSuchEntity', `Instance Profile ${n} cannot be found.`, 404);
  return a.iam.instanceProfiles[n];
};
op('iam', 'get-instance-profile', 'instance-profile-name:s!', 'Datos de un perfil de instancia.', { res: (c) => iamArn(c.acct, 'instance-profile', c.p.InstanceProfileName) }, (c) => (ipGet(c.acct, c.p.InstanceProfileName), { InstanceProfile: ipView(c.acct, c.p.InstanceProfileName) }));
op('iam', 'list-instance-profiles', 'path-prefix:s', 'Lista los perfiles de instancia.', { paginate: 'InstanceProfiles', res: (c) => `arn:aws:iam::${c.acct.id}:instance-profile/` }, (c) => ({ InstanceProfiles: Object.keys(c.acct.iam.instanceProfiles).sort().map((n) => ipView(c.acct, n)) }));
op('iam', 'add-role-to-instance-profile', 'instance-profile-name:s! role-name:s!', 'Mete un rol en un perfil de instancia (solo cabe uno).', { res: (c) => iamArn(c.acct, 'instance-profile', c.p.InstanceProfileName) }, (c) => {
  const ip = ipGet(c.acct, c.p.InstanceProfileName);
  role(c.acct, c.p.RoleName);
  if (ip.roles.length >= 1) throw new AwsError('LimitExceeded', 'Cannot exceed quota for InstanceSessionsPerInstanceProfile: 1', 409);
  ip.roles.push(c.p.RoleName);
  return undefined;
});
op('iam', 'remove-role-from-instance-profile', 'instance-profile-name:s! role-name:s!', 'Saca un rol de un perfil de instancia.', { res: (c) => iamArn(c.acct, 'instance-profile', c.p.InstanceProfileName) }, (c) => {
  const ip = ipGet(c.acct, c.p.InstanceProfileName);
  ip.roles = ip.roles.filter((r) => r !== c.p.RoleName);
  return undefined;
});
op('iam', 'delete-instance-profile', 'instance-profile-name:s!', 'Borra un perfil de instancia (vacío).', { res: (c) => iamArn(c.acct, 'instance-profile', c.p.InstanceProfileName) }, (c) => {
  const ip = ipGet(c.acct, c.p.InstanceProfileName);
  if (ip.roles.length) throw new AwsError('DeleteConflict', 'Cannot delete entity, must remove roles from instance profile first.', 409);
  delete c.acct.iam.instanceProfiles[ip.InstanceProfileName];
  return undefined;
});
op('iam', 'list-instance-profiles-for-role', 'role-name:s!', 'Perfiles de instancia que contienen un rol.', { res: (c) => iamArn(c.acct, 'role', c.p.RoleName) }, (c) => ({
  InstanceProfiles: Object.values(c.acct.iam.instanceProfiles).filter((i) => i.roles.includes(c.p.RoleName)).map((i) => ipView(c.acct, i.InstanceProfileName)),
}));

// ───────────────────────── MFA ─────────────────────────

op('iam', 'create-virtual-mfa-device', 'virtual-mfa-device-name:s! outfile:s bootstrap-method:s', 'Crea un dispositivo MFA virtual (la semilla para la app autenticadora).', { res: (c) => `arn:aws:iam::${c.acct.id}:mfa/${c.p.VirtualMfaDeviceName}`, positional: ['outfile'] }, (c) => {
  const n = c.p.VirtualMfaDeviceName as string;
  nameCheck('mfa', 'virtualMFADeviceName', n, 226);
  const serial = `arn:aws:iam::${c.acct.id}:mfa/${n}`;
  if (c.acct.iam.mfaDevices[serial]) throw new AwsError('EntityAlreadyExists', `MFADevice entity at the same path and name already exists.`, 409);
  c.acct.iam.mfaDevices[serial] = { SerialNumber: serial };
  const seed = stableId(`seed:${serial}`, '', 32, 'up');
  if (c.p.Outfile) {
    c.io.writeFile(c.io.abs(c.p.Outfile), b64encode(`PNG-SIM:${seed}`));
    return { VirtualMFADevice: { SerialNumber: serial } };
  }
  return { VirtualMFADevice: { SerialNumber: serial } };
});
op('iam', 'enable-mfa-device', 'user-name:s! serial-number:s! authentication-code1:s! authentication-code2:s!', 'Activa un MFA en un usuario con dos códigos consecutivos.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  const d = c.acct.iam.mfaDevices[c.p.SerialNumber];
  if (!d) throw new AwsError('NoSuchEntity', `VirtualMFADevice with serial number ${c.p.SerialNumber} doesn't exist.`, 404);
  if (d.User) throw new AwsError('EntityAlreadyExists', `Device with serial number ${c.p.SerialNumber} is already enabled.`, 409);
  for (const k of ['AuthenticationCode1', 'AuthenticationCode2']) if (!/^\d{6}$/.test(String(c.p[k]))) throw new AwsError('InvalidAuthenticationCode', 'Authentication code for device is not valid.', 403);
  d.User = u.UserName;
  d.EnableDate = iso(c.acct.clock);
  u.mfa.push(d.SerialNumber);
  return undefined;
});
op('iam', 'deactivate-mfa-device', 'user-name:s! serial-number:s!', 'Desactiva el MFA de un usuario.', { res: (c) => iamArn(c.acct, 'user', c.p.UserName) }, (c) => {
  const u = user(c.acct, c.p.UserName);
  if (!u.mfa.includes(c.p.SerialNumber)) throw new AwsError('NoSuchEntity', `MFA Device with serial number ${c.p.SerialNumber} does not exist.`, 404);
  u.mfa = u.mfa.filter((s) => s !== c.p.SerialNumber);
  const d = c.acct.iam.mfaDevices[c.p.SerialNumber];
  if (d) {
    d.User = undefined;
    d.EnableDate = undefined;
  }
  return undefined;
});
op('iam', 'delete-virtual-mfa-device', 'serial-number:s!', 'Borra un dispositivo MFA virtual.', { res: (c) => c.p.SerialNumber }, (c) => {
  const d = c.acct.iam.mfaDevices[c.p.SerialNumber];
  if (!d) throw new AwsError('NoSuchEntity', `VirtualMFADevice with serial number ${c.p.SerialNumber} doesn't exist.`, 404);
  if (d.User) throw new AwsError('DeleteConflict', 'Cannot delete a virtual MFA device that is enabled.', 409);
  delete c.acct.iam.mfaDevices[c.p.SerialNumber];
  return undefined;
});
op('iam', 'list-mfa-devices', 'user-name:s', 'MFA activados en un usuario.', { paginate: 'MFADevices', res: (c) => iamArn(c.acct, 'user', whom(c, c.p.UserName)) }, (c) => {
  const u = user(c.acct, whom(c, c.p.UserName));
  return { MFADevices: u.mfa.map((s) => ({ UserName: u.UserName, SerialNumber: s, EnableDate: c.acct.iam.mfaDevices[s]?.EnableDate ?? u.CreateDate })), IsTruncated: false };
});
op('iam', 'list-virtual-mfa-devices', 'assignment-status:s', 'Todos los MFA virtuales de la cuenta.', { paginate: 'VirtualMFADevices', res: () => '*' }, (c) => {
  const st = c.p.AssignmentStatus as string | undefined;
  return {
    VirtualMFADevices: Object.values(c.acct.iam.mfaDevices)
      .filter((d) => !st || st === 'Any' || (st === 'Assigned') === !!d.User)
      .map((d) => ({ SerialNumber: d.SerialNumber, ...(d.User ? { User: userView(c.acct.iam.users[d.User]), EnableDate: d.EnableDate } : {}) })),
    IsTruncated: false,
  };
});

// ───────────────────────── cuenta ─────────────────────────

op('iam', 'update-account-password-policy', 'minimum-password-length:i require-symbols:b require-numbers:b require-uppercase-characters:b require-lowercase-characters:b allow-users-to-change-password:b max-password-age:i password-reuse-prevention:i hard-expiry:b', 'Define la política de contraseñas de la cuenta.', {}, (c) => {
  const cur = c.acct.iam.passwordPolicy ?? { MinimumPasswordLength: 6, RequireSymbols: false, RequireNumbers: false, RequireUppercaseCharacters: false, RequireLowercaseCharacters: false, AllowUsersToChangePassword: false };
  const p = c.p;
  c.acct.iam.passwordPolicy = {
    MinimumPasswordLength: p.MinimumPasswordLength ?? cur.MinimumPasswordLength,
    RequireSymbols: p.RequireSymbols ?? false,
    RequireNumbers: p.RequireNumbers ?? false,
    RequireUppercaseCharacters: p.RequireUppercaseCharacters ?? false,
    RequireLowercaseCharacters: p.RequireLowercaseCharacters ?? false,
    AllowUsersToChangePassword: p.AllowUsersToChangePassword ?? false,
    ...(p.MaxPasswordAge ? { MaxPasswordAge: p.MaxPasswordAge } : {}),
    ...(p.PasswordReusePrevention ? { PasswordReusePrevention: p.PasswordReusePrevention } : {}),
  };
  if (c.acct.iam.passwordPolicy.MinimumPasswordLength < 6 || c.acct.iam.passwordPolicy.MinimumPasswordLength > 128) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.acct.iam.passwordPolicy.MinimumPasswordLength}' at 'minimumPasswordLength' failed to satisfy constraint: Member must have value ${c.acct.iam.passwordPolicy.MinimumPasswordLength < 6 ? 'greater than or equal to 6' : 'less than or equal to 128'}`);
  return undefined;
});
op('iam', 'get-account-password-policy', '', 'Lee la política de contraseñas.', {}, (c) => {
  const p = c.acct.iam.passwordPolicy;
  if (!p) throw new AwsError('NoSuchEntity', 'The Password Policy with domain name ' + c.acct.id + ' cannot be found.', 404);
  return { PasswordPolicy: { ...p, ExpirePasswords: !!p.MaxPasswordAge } };
});
op('iam', 'delete-account-password-policy', '', 'Borra la política de contraseñas (vuelve a la de AWS por defecto).', {}, (c) => {
  if (!c.acct.iam.passwordPolicy) throw new AwsError('NoSuchEntity', 'The account policy with name PasswordPolicy cannot be found.', 404);
  c.acct.iam.passwordPolicy = undefined;
  return undefined;
});
op('iam', 'create-account-alias', 'account-alias:s!', 'Pone un alias a la cuenta (para la URL de inicio de sesión).', {}, (c) => {
  if (!/^[a-z0-9](([a-z0-9]|-(?!-))*[a-z0-9])?$/.test(c.p.AccountAlias) || c.p.AccountAlias.length < 3) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.AccountAlias}' at 'accountAlias' failed to satisfy constraint: Member must satisfy regular expression pattern: ^[a-z0-9](([a-z0-9]|-(?!-))*[a-z0-9])?$`);
  if (c.acct.iam.aliases.length) throw new AwsError('EntityAlreadyExists', 'The account alias already exists.', 409);
  c.acct.iam.aliases = [c.p.AccountAlias];
  return undefined;
});
op('iam', 'list-account-aliases', '', 'Alias de la cuenta.', {}, (c) => ({ AccountAliases: c.acct.iam.aliases, IsTruncated: false }));
op('iam', 'delete-account-alias', 'account-alias:s!', 'Borra el alias de la cuenta.', {}, (c) => {
  if (!c.acct.iam.aliases.includes(c.p.AccountAlias)) throw new AwsError('NoSuchEntity', 'The account alias ' + c.p.AccountAlias + ' does not exist.', 404);
  c.acct.iam.aliases = [];
  return undefined;
});

op('iam', 'get-account-summary', '', 'Resumen de IAM: usuarios, grupos, MFA, claves de root…', {}, (c) => {
  const i = c.acct.iam;
  const mfaUsers = Object.values(i.users).reduce((n, u) => n + u.mfa.length, 0);
  return {
    SummaryMap: {
      GroupPolicySizeQuota: 5120,
      InstanceProfiles: Object.keys(i.instanceProfiles).length,
      Policies: Object.values(i.policies).filter((p) => !p.aws).length,
      GroupsPerUserQuota: 10,
      InstanceProfilesQuota: 1000,
      UserPolicySizeQuota: 2048,
      GlobalEndpointTokenVersion: 1,
      ServerCertificates: 0,
      ServerCertificatesQuota: 20,
      MFADevices: Object.keys(i.mfaDevices).length,
      MFADevicesInUse: mfaUsers + (i.rootMfa ? 1 : 0),
      AccountMFAEnabled: i.rootMfa ? 1 : 0,
      AccountAccessKeysPresent: i.rootKeys.length,
      AccountPasswordPresent: 1,
      AccountSigningCertificatesPresent: 0,
      AttachedPoliciesPerGroupQuota: 10,
      PoliciesQuota: 1500,
      AttachedPoliciesPerRoleQuota: 10,
      AttachedPoliciesPerUserQuota: 10,
      PolicySizeQuota: 6144,
      Groups: Object.keys(i.groups).length,
      AccessKeysPerUserQuota: 2,
      SigningCertificatesPerUserQuota: 2,
      PolicyVersionsInUse: Object.values(i.policies).filter((p) => !p.aws).length,
      RolePolicySizeQuota: 10240,
      UsersQuota: 5000,
      RolesQuota: 1000,
      Users: Object.keys(i.users).length,
      GroupsQuota: 300,
      VersionsPerPolicyQuota: 5,
      Providers: 0,
      Roles: Object.keys(i.roles).length,
      PolicyVersionsInUseQuota: 10000,
    },
  };
});

op('iam', 'generate-credential-report', '', 'Pide a IAM que genere el informe de credenciales de la cuenta.', {}, (c) => {
  c.acct.counters.credreport = 1;
  return { State: 'COMPLETE' };
});
op('iam', 'get-credential-report', '', 'Descarga el informe de credenciales (CSV en base64).', {}, (c) => {
  if (!c.acct.counters.credreport) throw new AwsError('CredentialReportNotPresent', 'Credential report not present', 410);
  const head = 'user,arn,user_creation_time,password_enabled,password_last_used,password_last_changed,password_next_rotation,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_1_last_used_region,access_key_1_last_used_service,access_key_2_active,access_key_2_last_rotated,access_key_2_last_used_date,access_key_2_last_used_region,access_key_2_last_used_service,cert_1_active,cert_1_last_rotated,cert_2_active,cert_2_last_rotated';
  const i = c.acct.iam;
  const rows: string[] = [`<root_account>,arn:aws:iam::${c.acct.id}:root,2025-01-10T09:00:00+00:00,not_supported,${iso(c.acct.clock)},not_supported,not_supported,${i.rootMfa},${i.rootKeys.length > 0},${i.rootKeys[0]?.CreateDate ?? 'N/A'},N/A,N/A,N/A,false,N/A,N/A,N/A,N/A,false,N/A,false,N/A`];
  for (const u of Object.values(i.users)) {
    const k1 = u.accessKeys[0];
    const k2 = u.accessKeys[1];
    rows.push([u.UserName, u.Arn, u.CreateDate, u.loginProfile, u.loginProfile ? u.CreateDate : 'N/A', u.loginProfile ? u.CreateDate : 'N/A', 'N/A', u.mfa.length > 0, k1 ? k1.Status === 'Active' : false, k1?.CreateDate ?? 'N/A', 'N/A', 'N/A', 'N/A', k2 ? k2.Status === 'Active' : false, k2?.CreateDate ?? 'N/A', 'N/A', 'N/A', 'N/A', false, 'N/A', false, 'N/A'].join(','));
  }
  return { Content: b64encode([head, ...rows].join('\n') + '\n'), ReportFormat: 'text/csv', GeneratedTime: iso(c.acct.clock) };
});

// ───────────────────────── simulación ─────────────────────────

function ctxFromEntries(entries: any[] | undefined): Context {
  const ctx: Context = {};
  for (const e of entries ?? []) {
    const vals = toArr(e.ContextKeyValues as string | string[]);
    const type = String(e.ContextKeyType ?? 'string');
    const conv = (v: string) => (type === 'boolean' ? v === 'true' : type === 'numeric' ? Number(v) : v);
    ctx[e.ContextKeyName] = vals.length === 1 && !type.endsWith('List') ? (conv(vals[0]) as string) : (vals.map(String) as string[]);
  }
  return ctx;
}

function simulate(c: OpCtx, policies: PolicySource[], principalArn: string, root: boolean) {
  const actions: string[] = c.p.ActionNames;
  const resources: string[] = c.p.ResourceArns ?? ['*'];
  const ctx = { ...ctxFromEntries(c.p.ContextEntries) };
  const results = [];
  for (const action of actions) {
    for (const resource of resources) {
      const r = evaluate({ action, resource, principalArn, principalAccount: c.acct.id, context: ctx, policies, root });
      results.push({
        EvalActionName: action,
        EvalResourceName: resource,
        EvalDecision: r.decision,
        MatchedStatements: r.matched.map((m) => ({ SourcePolicyId: m.source, SourcePolicyType: m.kind === 'boundary' ? 'IAM Policy' : m.kind === 'resource' ? 'Resource Policy' : 'IAM Policy', StartPosition: { Line: 1, Column: 1 }, EndPosition: { Line: 1, Column: 1 } })),
        MissingContextValues: r.missingContext,
        ...(r.decision === 'allowed' ? {} : {}),
      });
    }
  }
  return { EvaluationResults: results, IsTruncated: false };
}

op('iam', 'simulate-principal-policy', 'policy-source-arn:s! action-names:l! resource-arns:l context-entries:f policy-input-list:l caller-arn:s', 'Simula si un usuario o rol podría hacer unas acciones, sin hacerlas de verdad.', { res: () => '*', action: 'iam:SimulatePrincipalPolicy' }, (c) => {
  const arn = c.p.PolicySourceArn as string;
  const pp = principalPolicies(c.acct, arn);
  if (!pp) throw new AwsError('NoSuchEntity', `Entity ${arn} not found.`, 404);
  const extra: PolicySource[] = (c.p.PolicyInputList ?? []).map((d: string, i: number) => ({ name: `PolicyInputList.${i + 1}`, kind: 'identity' as const, doc: parseDoc(d) }));
  return simulate(c, [...pp.policies, ...extra], arn, pp.root);
});

op('iam', 'simulate-custom-policy', 'policy-input-list:l! action-names:l! resource-arns:l context-entries:f permissions-boundary-policy-input-list:l', 'Simula acciones contra unos documentos de política que le pasas (sin crear nada).', { res: () => '*', action: 'iam:SimulateCustomPolicy' }, (c) => {
  const pol: PolicySource[] = (c.p.PolicyInputList as string[]).map((d, i) => ({ name: `PolicyInputList.${i + 1}`, kind: 'identity' as const, doc: parseDoc(d) }));
  for (const [i, d] of ((c.p.PermissionsBoundaryPolicyInputList as string[] | undefined) ?? []).entries()) pol.push({ name: `PermissionsBoundaryPolicyInputList.${i + 1}`, kind: 'boundary', doc: parseDoc(d) });
  return simulate(c, pol, c.caller.arn, false);
});

op('iam', 'get-account-authorization-details', 'filter:l', 'Volcado completo de usuarios, grupos, roles y políticas (para auditar).', {}, (c) => {
  const i = c.acct.iam;
  const pol = (inline: Record<string, PolicyDoc>) => Object.entries(inline).map(([PolicyName, PolicyDocument]) => ({ PolicyName, PolicyDocument }));
  const att = (l: string[]) => l.map((arn) => ({ PolicyName: lastName(arn), PolicyArn: arn }));
  return {
    UserDetailList: Object.values(i.users).map((u) => ({ Path: u.Path, UserName: u.UserName, UserId: u.UserId, Arn: u.Arn, CreateDate: u.CreateDate, UserPolicyList: pol(u.inline), GroupList: u.groups, AttachedManagedPolicies: att(u.attached), Tags: u.Tags })),
    GroupDetailList: Object.values(i.groups).map((g) => ({ Path: g.Path, GroupName: g.GroupName, GroupId: g.GroupId, Arn: g.Arn, CreateDate: g.CreateDate, GroupPolicyList: pol(g.inline), AttachedManagedPolicies: att(g.attached) })),
    RoleDetailList: Object.values(i.roles).map((r) => ({ ...roleView(r, false), InstanceProfileList: [], RolePolicyList: pol(r.inline), AttachedManagedPolicies: att(r.attached), RoleLastUsed: {} })),
    Policies: Object.values(i.policies).filter((p) => !p.aws).map((p) => ({ ...policyView(c.acct, p), PolicyVersionList: [{ Document: p.document, VersionId: p.DefaultVersionId, IsDefaultVersion: true, CreateDate: p.CreateDate }] })),
    IsTruncated: false,
  };
});

export { clone, newId };
