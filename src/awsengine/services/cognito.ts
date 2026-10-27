/** Amazon Cognito (grupos de usuarios): registro, confirmación, inicio de sesión y tokens JWT que verifica API Gateway. */
import { b64decode, b64encode, md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, CognitoClient, CognitoPool, CognitoState, CognitoUser } from '../types';
import { mkArn, newId, toArr } from '../util';

export const cognitoOf = (a: Account, region: string): CognitoState => {
  const r = regional(a, region);
  return (r.cognito ??= { pools: {} });
};

const uuid = (a: Account, k: string) => newId(a, k, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
const b64u = (s: string) => b64encode(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => b64decode(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export const issuer = (region: string, poolId: string) => `https://cognito-idp.${region}.amazonaws.com/${poolId}`;

function mkJwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ kid: 'simKeyId0000000000000000=', alg: 'RS256' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${b64u(md5(h + '.' + p) + md5(p + h))}`;
}

/** Lee y comprueba (firma simulada y caducidad) un token del simulador. `null` si no es válido. */
export function readJwt(a: Account, token: string): Record<string, unknown> | null {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig || sig !== b64u(md5(h + '.' + p) + md5(p + h))) return null;
  try {
    const claims = JSON.parse(unb64u(p) ?? '') as Record<string, unknown>;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < a.clock) return null;
    return claims;
  } catch {
    return null;
  }
}

function tokens(a: Account, region: string, pool: CognitoPool, client: CognitoClient, u: CognitoUser, refresh = true) {
  const now = Math.floor(a.clock / 1000);
  const base = { sub: u.sub, iss: issuer(region, pool.Id), auth_time: now, iat: now, exp: now + 3600, ...(u.groups.length ? { 'cognito:groups': u.groups } : {}) };
  const attrs = Object.fromEntries(Object.entries(u.attrs).filter(([k]) => k !== 'sub'));
  return {
    AccessToken: mkJwt({ ...base, client_id: client.ClientId, origin_jti: uuid(a, 'jti1'), event_id: uuid(a, 'evt'), token_use: 'access', scope: 'aws.cognito.signin.user.admin', jti: uuid(a, 'jti2'), username: u.Username }),
    ExpiresIn: 3600,
    TokenType: 'Bearer',
    ...(refresh ? { RefreshToken: mkJwt({ sub: u.sub, token_use: 'refresh', client_id: client.ClientId, pool: pool.Id, user: u.Username, exp: now + 30 * 86400 }) } : {}),
    IdToken: mkJwt({ ...base, ...attrs, 'cognito:username': u.Username, origin_jti: uuid(a, 'jti3'), aud: client.ClientId, event_id: uuid(a, 'evt2'), token_use: 'id' }),
  };
}

/** Token de identidad de un usuario (lo usa el corrector para pedir una API protegida «como» ese usuario). `null` si no existe. */
export function mintIdToken(a: Account, username: string): string | null {
  for (const [region, r] of Object.entries(a.regions))
    for (const pool of Object.values(r.cognito?.pools ?? {})) {
      const u = pool.users[username] ?? Object.values(pool.users).find((x) => x.attrs.email === username);
      const client = Object.values(pool.clients)[0];
      if (u && client && u.status === 'CONFIRMED') return tokens(a, region, pool, client, u, false).IdToken;
    }
  return null;
}

const findPool = (c: OpCtx, id: string): CognitoPool => {
  const p = cognitoOf(c.acct, c.region).pools[id];
  if (!p) throw new AwsError('ResourceNotFoundException', `User pool ${id} does not exist.`, 400);
  return p;
};

function findClient(c: OpCtx, id: string): { pool: CognitoPool; client: CognitoClient } {
  for (const pool of Object.values(cognitoOf(c.acct, c.region).pools)) if (pool.clients[id]) return { pool, client: pool.clients[id] };
  throw new AwsError('ResourceNotFoundException', `User pool client ${id} does not exist.`, 400);
}

const findUser = (pool: CognitoPool, name: string): CognitoUser => {
  const u = pool.users[name] ?? Object.values(pool.users).find((x) => x.attrs.email === name);
  if (!u) throw new AwsError('UserNotFoundException', 'User does not exist.', 400);
  return u;
};

function checkPassword(pool: CognitoPool, pw: string): void {
  const p = pool.passwordPolicy;
  const fail = (m: string) => {
    throw new AwsError('InvalidPasswordException', `Password did not conform with policy: ${m}`, 400);
  };
  if (pw.length < p.MinimumLength) fail('Password not long enough');
  if (p.RequireNumbers && !/\d/.test(pw)) fail('Password must have numeric characters');
  if (p.RequireSymbols && !/[^\w\s]|_/.test(pw)) fail('Password must have symbol characters');
  if (p.RequireUppercase && !/[A-Z]/.test(pw)) fail('Password must have uppercase characters');
  if (p.RequireLowercase && !/[a-z]/.test(pw)) fail('Password must have lowercase characters');
}

const attrsOf = (list: unknown): Record<string, string> => Object.fromEntries(toArr<{ Name: string; Value: string }>(list as never).map((x) => [x.Name, x.Value]));

const poolView = (c: OpCtx, p: CognitoPool) => ({ Id: p.Id, Name: p.Name, Policies: { PasswordPolicy: { MinimumLength: p.passwordPolicy.MinimumLength, RequireUppercase: p.passwordPolicy.RequireUppercase, RequireLowercase: p.passwordPolicy.RequireLowercase, RequireNumbers: p.passwordPolicy.RequireNumbers, RequireSymbols: p.passwordPolicy.RequireSymbols, TemporaryPasswordValidityDays: 7 } }, LastModifiedDate: p.created / 1000, CreationDate: p.created / 1000, ...(p.usernameAttributes.length ? { UsernameAttributes: p.usernameAttributes } : {}), ...(p.autoVerified.length ? { AutoVerifiedAttributes: p.autoVerified } : {}), MfaConfiguration: 'OFF', EstimatedNumberOfUsers: Object.keys(p.users).length, Arn: mkArn('cognito-idp', c.region, c.acct.id, `userpool/${p.Id}`) });

const clientView = (p: CognitoPool, k: CognitoClient) => ({ UserPoolId: p.Id, ClientName: k.ClientName, ClientId: k.ClientId, ...(k.GenerateSecret ? { ClientSecret: md5(k.ClientId).slice(0, 32) } : {}), LastModifiedDate: p.created / 1000, CreationDate: p.created / 1000, RefreshTokenValidity: 30, ExplicitAuthFlows: k.ExplicitAuthFlows, AllowedOAuthFlowsUserPoolClient: false });

const userView = (u: CognitoUser) => ({ Username: u.Username, Attributes: [{ Name: 'sub', Value: u.sub }, ...Object.entries(u.attrs).map(([Name, Value]) => ({ Name, Value }))], UserCreateDate: u.created / 1000, UserLastModifiedDate: u.created / 1000, Enabled: u.enabled, UserStatus: u.status });

// ───────────────────────── grupos de usuarios ─────────────────────────

op('cognito-idp', 'create-user-pool', 'pool-name:s! policies:j auto-verified-attributes:l username-attributes:l mfa-configuration:s schema:f', 'Crea un grupo de usuarios (el directorio de usuarios de tu aplicación).', { res: () => '*' }, (c) => {
  const pp = ((c.p.Policies as { PasswordPolicy?: Partial<CognitoPool['passwordPolicy']> } | undefined)?.PasswordPolicy ?? {}) as Partial<CognitoPool['passwordPolicy']>;
  const id = `${c.region}_${newId(c.acct, 'cogpool', '', 9, 'up')}`;
  const pool: CognitoPool = { Id: id, Name: c.p.PoolName, created: c.acct.clock, usernameAttributes: toArr<string>(c.p.UsernameAttributes), autoVerified: toArr<string>(c.p.AutoVerifiedAttributes), passwordPolicy: { MinimumLength: pp.MinimumLength ?? 8, RequireUppercase: pp.RequireUppercase ?? true, RequireLowercase: pp.RequireLowercase ?? true, RequireNumbers: pp.RequireNumbers ?? true, RequireSymbols: pp.RequireSymbols ?? true }, users: {}, clients: {}, groups: {} };
  cognitoOf(c.acct, c.region).pools[id] = pool;
  return { UserPool: poolView(c, pool) };
});

op('cognito-idp', 'describe-user-pool', 'user-pool-id:s!', 'Datos de un grupo de usuarios.', { res: () => '*' }, (c) => ({ UserPool: poolView(c, findPool(c, c.p.UserPoolId)) }));

op('cognito-idp', 'list-user-pools', 'max-results:i!', 'Lista los grupos de usuarios.', { paginate: 'UserPools', res: () => '*' }, (c) => ({ UserPools: Object.values(cognitoOf(c.acct, c.region).pools).map((p) => ({ Id: p.Id, Name: p.Name, CreationDate: p.created / 1000, LastModifiedDate: p.created / 1000 })) }));

op('cognito-idp', 'delete-user-pool', 'user-pool-id:s!', 'Borra un grupo de usuarios con todos sus usuarios.', { res: () => '*' }, (c) => {
  findPool(c, c.p.UserPoolId);
  delete cognitoOf(c.acct, c.region).pools[c.p.UserPoolId];
  return undefined;
});

op('cognito-idp', 'create-user-pool-client', 'user-pool-id:s! client-name:s! generate-secret:b explicit-auth-flows:l', 'Crea un cliente de aplicación. Para iniciar sesión con usuario y contraseña activa `ALLOW_USER_PASSWORD_AUTH` (no viene por defecto).', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  const id = newId(c.acct, 'cogcli', '', 26, 'hex').replace(/[A-F]/g, (x) => x.toLowerCase());
  const flows = toArr<string>(c.p.ExplicitAuthFlows);
  const k: CognitoClient = { ClientId: id, ClientName: c.p.ClientName, GenerateSecret: !!c.p.GenerateSecret, ExplicitAuthFlows: flows.length ? flows : ['ALLOW_USER_SRP_AUTH', 'ALLOW_CUSTOM_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'] };
  pool.clients[id] = k;
  return { UserPoolClient: clientView(pool, k) };
});

op('cognito-idp', 'describe-user-pool-client', 'user-pool-id:s! client-id:s!', 'Datos de un cliente de aplicación.', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  const k = pool.clients[c.p.ClientId];
  if (!k) throw new AwsError('ResourceNotFoundException', `User pool client ${c.p.ClientId} does not exist.`, 400);
  return { UserPoolClient: clientView(pool, k) };
});

op('cognito-idp', 'list-user-pool-clients', 'user-pool-id:s! max-results:i', 'Lista los clientes de aplicación.', { paginate: 'UserPoolClients', res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  return { UserPoolClients: Object.values(pool.clients).map((k) => ({ ClientId: k.ClientId, UserPoolId: pool.Id, ClientName: k.ClientName })) };
});

op('cognito-idp', 'update-user-pool-client', 'user-pool-id:s! client-id:s! explicit-auth-flows:l client-name:s', 'Cambia los flujos de autenticación o el nombre de un cliente.', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  const k = pool.clients[c.p.ClientId];
  if (!k) throw new AwsError('ResourceNotFoundException', `User pool client ${c.p.ClientId} does not exist.`, 400);
  if (c.p.ExplicitAuthFlows) k.ExplicitAuthFlows = toArr<string>(c.p.ExplicitAuthFlows);
  if (c.p.ClientName) k.ClientName = c.p.ClientName;
  return { UserPoolClient: clientView(pool, k) };
});

op('cognito-idp', 'delete-user-pool-client', 'user-pool-id:s! client-id:s!', 'Borra un cliente de aplicación.', { res: () => '*' }, (c) => {
  delete findPool(c, c.p.UserPoolId).clients[c.p.ClientId];
  return undefined;
});

// ───────────────────────── usuarios ─────────────────────────

function addUser(c: OpCtx, pool: CognitoPool, username: string, password: string, attrs: Record<string, string>, status: CognitoUser['status']): CognitoUser {
  if (pool.users[username]) throw new AwsError('UsernameExistsException', 'User already exists', 400);
  const a = { ...attrs };
  if (pool.usernameAttributes.includes('email') && !a.email) a.email = username;
  const u: CognitoUser = { Username: username, sub: uuid(c.acct, 'cogsub'), attrs: a, password, status, enabled: true, created: c.acct.clock, groups: [] };
  pool.users[username] = u;
  return u;
}

op('cognito-idp', 'sign-up', 'client-id:s! username:s! password:s! user-attributes:f', 'Registra a un usuario (queda `UNCONFIRMED` hasta que confirme su correo con el código; en el simulador es `123456`).', { anon: true, authz: false, res: () => '*' }, (c) => {
  const { pool, client } = findClient(c, c.p.ClientId);
  void client;
  checkPassword(pool, c.p.Password);
  const u = addUser(c, pool, c.p.Username, c.p.Password, attrsOf(c.p.UserAttributes), 'UNCONFIRMED');
  return { UserConfirmed: false, CodeDeliveryDetails: { Destination: u.attrs.email ? u.attrs.email.replace(/^(.).*(@.*)$/, '$1***$2') : '', DeliveryMedium: 'EMAIL', AttributeName: 'email' }, UserSub: u.sub };
});

op('cognito-idp', 'confirm-sign-up', 'client-id:s! username:s! confirmation-code:s!', 'Confirma el registro con el código recibido (en el simulador: `123456`).', { anon: true, authz: false, res: () => '*' }, (c) => {
  const { pool } = findClient(c, c.p.ClientId);
  const u = findUser(pool, c.p.Username);
  if (c.p.ConfirmationCode !== '123456') throw new AwsError('CodeMismatchException', 'Invalid verification code provided, please try again.', 400);
  u.status = 'CONFIRMED';
  return undefined;
});

op('cognito-idp', 'admin-confirm-sign-up', 'user-pool-id:s! username:s!', 'Confirma a un usuario sin que tenga que introducir el código.', { res: () => '*' }, (c) => {
  findUser(findPool(c, c.p.UserPoolId), c.p.Username).status = 'CONFIRMED';
  return {};
});

op('cognito-idp', 'admin-create-user', 'user-pool-id:s! username:s! temporary-password:s user-attributes:f message-action:s', 'Crea un usuario como administrador: queda `FORCE_CHANGE_PASSWORD` con una contraseña temporal.', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  const pw = c.p.TemporaryPassword ?? 'Tmp#' + newId(c.acct, 'cogtmp', '', 8, 'hex');
  checkPassword(pool, pw);
  return { User: userView(addUser(c, pool, c.p.Username, pw, attrsOf(c.p.UserAttributes), 'FORCE_CHANGE_PASSWORD')) };
});

op('cognito-idp', 'admin-set-user-password', 'user-pool-id:s! username:s! password:s! permanent:b', 'Fija la contraseña de un usuario (`--permanent` para que no tenga que cambiarla).', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  const u = findUser(pool, c.p.Username);
  checkPassword(pool, c.p.Password);
  u.password = c.p.Password;
  u.status = c.p.Permanent ? 'CONFIRMED' : 'FORCE_CHANGE_PASSWORD';
  return {};
});

op('cognito-idp', 'admin-get-user', 'user-pool-id:s! username:s!', 'Datos de un usuario.', { res: () => '*' }, (c) => {
  const u = findUser(findPool(c, c.p.UserPoolId), c.p.Username);
  const v = userView(u);
  return { Username: v.Username, UserAttributes: v.Attributes, UserCreateDate: v.UserCreateDate, UserLastModifiedDate: v.UserLastModifiedDate, Enabled: v.Enabled, UserStatus: v.UserStatus };
});

op('cognito-idp', 'list-users', 'user-pool-id:s! filter:s limit:i', 'Lista los usuarios de un grupo (con `--filter \'email = "a@b.c"\'`).', { paginate: 'Users', res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  let list = Object.values(pool.users);
  const f = /^\s*(\w+)\s*(=|\^=)\s*"(.*)"\s*$/.exec(c.p.Filter ?? '');
  if (c.p.Filter && !f) throw new AwsError('InvalidParameterException', 'Error while parsing filter. Please check your filter syntax.', 400);
  if (f) {
    const get = (u: CognitoUser) => (f[1] === 'username' ? u.Username : f[1] === 'status' || f[1] === 'cognito:user_status' ? u.status : (u.attrs[f[1]] ?? ''));
    list = list.filter((u) => (f[2] === '=' ? get(u) === f[3] : get(u).startsWith(f[3])));
  }
  return { Users: list.map(userView) };
});

op('cognito-idp', 'admin-delete-user', 'user-pool-id:s! username:s!', 'Borra un usuario.', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  delete pool.users[findUser(pool, c.p.Username).Username];
  return undefined;
});

// ───────────────────────── grupos ─────────────────────────

op('cognito-idp', 'create-group', 'user-pool-id:s! group-name:s! description:s', 'Crea un grupo de usuarios (aparece en el claim `cognito:groups` del token).', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  if (pool.groups[c.p.GroupName]) throw new AwsError('GroupExistsException', 'A group with the name already exists.', 400);
  pool.groups[c.p.GroupName] = { GroupName: c.p.GroupName, Description: c.p.Description ?? '' };
  return { Group: { GroupName: c.p.GroupName, UserPoolId: pool.Id, Description: c.p.Description ?? '', CreationDate: c.acct.clock / 1000 } };
});

op('cognito-idp', 'list-groups', 'user-pool-id:s!', 'Lista los grupos.', { paginate: 'Groups', res: () => '*' }, (c) => ({ Groups: Object.values(findPool(c, c.p.UserPoolId).groups).map((g) => ({ GroupName: g.GroupName, UserPoolId: c.p.UserPoolId, Description: g.Description })) }));

op('cognito-idp', 'admin-add-user-to-group', 'user-pool-id:s! username:s! group-name:s!', 'Añade un usuario a un grupo.', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  if (!pool.groups[c.p.GroupName]) throw new AwsError('ResourceNotFoundException', 'Group not found.', 400);
  const u = findUser(pool, c.p.Username);
  if (!u.groups.includes(c.p.GroupName)) u.groups.push(c.p.GroupName);
  return undefined;
});

op('cognito-idp', 'admin-remove-user-from-group', 'user-pool-id:s! username:s! group-name:s!', 'Quita a un usuario de un grupo.', { res: () => '*' }, (c) => {
  const u = findUser(findPool(c, c.p.UserPoolId), c.p.Username);
  u.groups = u.groups.filter((g) => g !== c.p.GroupName);
  return undefined;
});

op('cognito-idp', 'admin-list-groups-for-user', 'user-pool-id:s! username:s!', 'Grupos de un usuario.', { res: () => '*' }, (c) => ({ Groups: findUser(findPool(c, c.p.UserPoolId), c.p.Username).groups.map((g) => ({ GroupName: g, UserPoolId: c.p.UserPoolId })) }));

// ───────────────────────── inicio de sesión ─────────────────────────

function authenticate(c: OpCtx, pool: CognitoPool, client: CognitoClient, flow: string, params: Record<string, string>, admin: boolean) {
  const allow = (n: string) => client.ExplicitAuthFlows.includes(`ALLOW_${n}`) || client.ExplicitAuthFlows.includes(n);
  if (flow === 'REFRESH_TOKEN_AUTH' || flow === 'REFRESH_TOKEN') {
    if (!allow('REFRESH_TOKEN_AUTH')) throw new AwsError('InvalidParameterException', 'REFRESH_TOKEN_AUTH is not enabled for this client', 400);
    const claims = readJwt(c.acct, params.REFRESH_TOKEN ?? '');
    if (!claims || claims.token_use !== 'refresh') throw new AwsError('NotAuthorizedException', 'Invalid Refresh Token', 400);
    const u = findUser(pool, String(claims.user));
    return { AuthenticationResult: tokens(c.acct, c.region, pool, client, u, false) };
  }
  const need = admin ? ['ADMIN_USER_PASSWORD_AUTH', 'ADMIN_NO_SRP_AUTH'] : ['USER_PASSWORD_AUTH'];
  if (flow === 'USER_SRP_AUTH') throw new AwsError('InvalidParameterException', 'USER_SRP_AUTH needs the SRP protocol, which this simulator does not implement. Use USER_PASSWORD_AUTH.', 400);
  if (!need.includes(flow)) throw new AwsError('InvalidParameterException', `Unknown auth flow ${flow}`, 400);
  if (!need.some((f) => allow(f))) throw new AwsError('InvalidParameterException', `${flow} flow not enabled for this client`, 400);
  let u: CognitoUser;
  try {
    u = findUser(pool, params.USERNAME ?? '');
  } catch {
    throw new AwsError('NotAuthorizedException', 'Incorrect username or password.', 400);
  }
  if (u.password !== params.PASSWORD || !u.enabled) throw new AwsError('NotAuthorizedException', 'Incorrect username or password.', 400);
  if (u.status === 'UNCONFIRMED') throw new AwsError('UserNotConfirmedException', 'User is not confirmed.', 400);
  if (u.status === 'FORCE_CHANGE_PASSWORD') return { ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: b64u(JSON.stringify({ u: u.Username, c: client.ClientId, p: pool.Id })), ChallengeParameters: { USER_ID_FOR_SRP: u.Username, requiredAttributes: '[]', userAttributes: JSON.stringify(u.attrs) } };
  return { ChallengeParameters: {}, AuthenticationResult: tokens(c.acct, c.region, pool, client, u) };
}

op('cognito-idp', 'initiate-auth', 'auth-flow:s! auth-parameters:j client-id:s!', 'Inicia sesión y devuelve los tokens (`IdToken`, `AccessToken`, `RefreshToken`). Flujo `USER_PASSWORD_AUTH` (hay que habilitarlo en el cliente).', { anon: true, authz: false, res: () => '*' }, (c) => {
  const { pool, client } = findClient(c, c.p.ClientId);
  return authenticate(c, pool, client, c.p.AuthFlow, (c.p.AuthParameters ?? {}) as Record<string, string>, false);
});

op('cognito-idp', 'admin-initiate-auth', 'user-pool-id:s! client-id:s! auth-flow:s! auth-parameters:j', 'Inicia sesión desde el servidor (`ADMIN_USER_PASSWORD_AUTH`).', { res: () => '*' }, (c) => {
  const pool = findPool(c, c.p.UserPoolId);
  const client = pool.clients[c.p.ClientId];
  if (!client) throw new AwsError('ResourceNotFoundException', `User pool client ${c.p.ClientId} does not exist.`, 400);
  return authenticate(c, pool, client, c.p.AuthFlow, (c.p.AuthParameters ?? {}) as Record<string, string>, true);
});

op('cognito-idp', 'respond-to-auth-challenge', 'client-id:s! challenge-name:s! challenge-responses:j session:s', 'Responde a un desafío (p. ej. `NEW_PASSWORD_REQUIRED` en el primer inicio de sesión de un usuario creado por el administrador).', { anon: true, authz: false, res: () => '*' }, (c) => {
  const { pool, client } = findClient(c, c.p.ClientId);
  if (c.p.ChallengeName !== 'NEW_PASSWORD_REQUIRED') throw new AwsError('InvalidParameterException', `Challenge ${c.p.ChallengeName} is not supported by this simulator.`, 400);
  const r = (c.p.ChallengeResponses ?? {}) as Record<string, string>;
  const u = findUser(pool, r.USERNAME ?? '');
  if (u.status !== 'FORCE_CHANGE_PASSWORD' || !c.p.Session) throw new AwsError('NotAuthorizedException', 'Invalid session for the user, session is expired.', 400);
  checkPassword(pool, r.NEW_PASSWORD ?? '');
  u.password = r.NEW_PASSWORD;
  u.status = 'CONFIRMED';
  return { ChallengeParameters: {}, AuthenticationResult: tokens(c.acct, c.region, pool, client, u) };
});

op('cognito-idp', 'get-user', 'access-token:s!', 'Datos del usuario al que pertenece un token de acceso.', { anon: true, authz: false, res: () => '*' }, (c) => {
  const claims = readJwt(c.acct, c.p.AccessToken);
  if (!claims || claims.token_use !== 'access') throw new AwsError('NotAuthorizedException', 'Invalid Access Token', 400);
  const pool = cognitoOf(c.acct, c.region).pools[String(claims.iss).split('/').pop() ?? ''];
  const u = pool && Object.values(pool.users).find((x) => x.sub === claims.sub);
  if (!u) throw new AwsError('UserNotFoundException', 'User does not exist.', 400);
  const v = userView(u);
  return { Username: v.Username, UserAttributes: v.Attributes };
});

