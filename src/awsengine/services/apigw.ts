/** Amazon API Gateway (APIs HTTP): rutas, integraciones proxy con Lambda, etapas, autorizadores JWT y el «servidor» que responde a `curl`. */
import type { Fetched } from '../../engine/commands/internet';
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, ApiGw, ApiRoute, ApiStage, ApiGwState } from '../types';
import { iso, mkArn, newId, toArr } from '../util';
import { readJwt } from './cognito';
import { apiMetrics } from './cwbuiltin';
import { fnArn, lambdaAllows, resolveFn, runFunction } from './lambda';

export const apigwOf = (a: Account, region: string): ApiGwState => {
  const r = regional(a, region);
  return (r.apigw ??= { apis: {} });
};

export const apiHost = (id: string, region: string) => `${id}.execute-api.${region}.amazonaws.com`;
const gwId = (a: Account, k: string) => newId(a, k, '', 10, 'hex').toLowerCase();
const execArn = (a: Account, region: string, apiId: string, rest = '*') => mkArn('execute-api', region, a.id, `${apiId}/${rest}`);

// ───────────────────────── operaciones ─────────────────────────

const apiView = (c: Pick<OpCtx, 'acct' | 'region'>, x: ApiGw) => ({ ApiId: x.ApiId, Name: x.Name, ProtocolType: x.ProtocolType, ApiEndpoint: `https://${apiHost(x.ApiId, c.region)}`, CreatedDate: iso(x.CreatedDate).replace('+00:00', 'Z'), RouteSelectionExpression: '$request.method $request.path', ApiKeySelectionExpression: '$request.header.x-api-key', DisableExecuteApiEndpoint: false, ...(x.cors ? { CorsConfiguration: x.cors } : {}) });

const findApi = (c: OpCtx, id: string): ApiGw => {
  const x = apigwOf(c.acct, c.region).apis[id];
  if (!x) throw new AwsError('NotFoundException', `Invalid API identifier specified ${c.acct.id}:${id}`, 404);
  return x;
};

const stageView = (x: ApiStage) => ({ StageName: x.StageName, AutoDeploy: x.AutoDeploy, ...(x.ThrottlingBurstLimit ? { DefaultRouteSettings: { ThrottlingBurstLimit: x.ThrottlingBurstLimit, ThrottlingRateLimit: x.ThrottlingRateLimit } } : {}), CreatedDate: '2026-03-14T10:00:00Z', LastUpdatedDate: '2026-03-14T10:00:00Z', RouteSettings: {}, StageVariables: {}, DefaultRouteSettings_: undefined });

const targetOf = (x: ApiGw, t?: string) => (t?.startsWith('integrations/') ? x.integrations[t.slice(13)] : undefined);

function addPermission(c: OpCtx, apiId: string, lambdaRef: string): void {
  try {
    const { fn } = resolveFn(c.acct, c.region, lambdaRef);
    const sid = `apigateway-${apiId}`;
    if (!fn.policy.some((s) => s.Sid === sid)) fn.policy.push({ Sid: sid, Effect: 'Allow', Principal: { Service: 'apigateway.amazonaws.com' }, Action: 'lambda:InvokeFunction', Resource: fnArn(c.acct, c.region, fn.FunctionName), Condition: { ArnLike: { 'AWS:SourceArn': execArn(c.acct, c.region, apiId) } } });
  } catch {
    /* función inexistente: el API se crea igual */
  }
}

op('apigatewayv2', 'create-api', 'name:s! protocol-type:s! target:s route-key:s cors-configuration:j description:s tags:j', 'Crea una API HTTP. Con `--target <ARN de Lambda>` hace la «creación rápida»: ruta `$default`, integración, etapa `$default` con despliegue automático y el permiso de invocación.', { res: () => '*' }, (c) => {
  if (c.p.ProtocolType !== 'HTTP') throw new AwsError('BadRequestException', `Protocol ${c.p.ProtocolType} is not supported by this simulator: use HTTP (HTTP API).`, 400);
  const id = gwId(c.acct, 'apigw');
  const x: ApiGw = { ApiId: id, Name: c.p.Name, ProtocolType: 'HTTP', CreatedDate: c.acct.clock, routes: {}, integrations: {}, authorizers: {}, stages: {}, cors: c.p.CorsConfiguration };
  apigwOf(c.acct, c.region).apis[id] = x;
  if (c.p.Target) {
    const iid = gwId(c.acct, 'apiint');
    x.integrations[iid] = { IntegrationId: iid, IntegrationType: 'AWS_PROXY', IntegrationUri: c.p.Target, PayloadFormatVersion: '2.0' };
    const key = c.p.RouteKey ?? '$default';
    const rid = gwId(c.acct, 'apirt');
    x.routes[rid] = { RouteId: rid, RouteKey: key, Target: `integrations/${iid}`, AuthorizationType: 'NONE' };
    x.stages.$default = { StageName: '$default', AutoDeploy: true, Deployed: true };
    addPermission(c, id, c.p.Target);
  }
  return apiView(c, x);
});

op('apigatewayv2', 'get-apis', '', 'Lista las APIs.', { res: () => '*' }, (c) => ({ Items: Object.values(apigwOf(c.acct, c.region).apis).map((x) => apiView(c, x)) }));
op('apigatewayv2', 'get-api', 'api-id:s!', 'Datos de una API (incluye `ApiEndpoint`, la URL base).', { res: () => '*' }, (c) => apiView(c, findApi(c, c.p.ApiId)));
op('apigatewayv2', 'delete-api', 'api-id:s!', 'Borra una API.', { res: () => '*' }, (c) => {
  findApi(c, c.p.ApiId);
  delete apigwOf(c.acct, c.region).apis[c.p.ApiId];
  return undefined;
});

op('apigatewayv2', 'create-integration', 'api-id:s! integration-type:s! integration-uri:s payload-format-version:s integration-method:s description:s', 'Crea una integración (p. ej. `AWS_PROXY` hacia una función Lambda). Ojo: no añade el permiso de invocación a la función.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (!['AWS_PROXY', 'HTTP_PROXY', 'AWS', 'HTTP', 'MOCK'].includes(c.p.IntegrationType)) throw new AwsError('BadRequestException', `Invalid integration type: ${c.p.IntegrationType}`, 400);
  const id = gwId(c.acct, 'apiint');
  x.integrations[id] = { IntegrationId: id, IntegrationType: c.p.IntegrationType, IntegrationUri: c.p.IntegrationUri ?? '', PayloadFormatVersion: c.p.PayloadFormatVersion ?? '1.0', IntegrationMethod: c.p.IntegrationMethod };
  return { IntegrationId: id, IntegrationType: c.p.IntegrationType, IntegrationUri: c.p.IntegrationUri, PayloadFormatVersion: x.integrations[id].PayloadFormatVersion, ConnectionType: 'INTERNET', TimeoutInMillis: 30000 };
});

op('apigatewayv2', 'get-integrations', 'api-id:s!', 'Lista las integraciones.', { res: () => '*' }, (c) => ({ Items: Object.values(findApi(c, c.p.ApiId).integrations).map((i) => ({ IntegrationId: i.IntegrationId, IntegrationType: i.IntegrationType, IntegrationUri: i.IntegrationUri, PayloadFormatVersion: i.PayloadFormatVersion, ConnectionType: 'INTERNET' })) }));

const routeView = (r: ApiRoute) => ({ RouteId: r.RouteId, RouteKey: r.RouteKey, ...(r.Target ? { Target: r.Target } : {}), ApiKeyRequired: false, AuthorizationType: r.AuthorizationType, ...(r.AuthorizerId ? { AuthorizerId: r.AuthorizerId } : {}) });

op('apigatewayv2', 'create-route', 'api-id:s! route-key:s! target:s authorization-type:s authorizer-id:s', 'Crea una ruta (`GET /items`, `POST /items/{id}`, `ANY /{proxy+}`, `$default`) que apunta a `integrations/<id>`.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  const key = String(c.p.RouteKey);
  if (key !== '$default' && !/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|ANY) \/\S*$/.test(key) && !/^\/\S*$/.test(key)) throw new AwsError('BadRequestException', `Invalid route key: ${key}. Use "METHOD /path", for example "GET /items".`, 400);
  if (Object.values(x.routes).some((r) => r.RouteKey === key)) throw new AwsError('ConflictException', `Route with key ${key} already exists`, 409);
  if (c.p.Target && !targetOf(x, c.p.Target)) throw new AwsError('NotFoundException', `Integration not found: ${c.p.Target}`, 404);
  const at = (c.p.AuthorizationType ?? 'NONE') as ApiRoute['AuthorizationType'];
  if (at === 'JWT' && !(c.p.AuthorizerId && x.authorizers[c.p.AuthorizerId])) throw new AwsError('BadRequestException', 'Authorizer not found for the JWT authorization type.', 400);
  const id = gwId(c.acct, 'apirt');
  x.routes[id] = { RouteId: id, RouteKey: key, Target: c.p.Target, AuthorizationType: at, AuthorizerId: c.p.AuthorizerId };
  return routeView(x.routes[id]);
});

op('apigatewayv2', 'update-route', 'api-id:s! route-id:s! route-key:s target:s authorization-type:s authorizer-id:s', 'Cambia una ruta: su destino o el autorizador que la protege (`--authorization-type JWT --authorizer-id <id>`).', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  const r = x.routes[c.p.RouteId];
  if (!r) throw new AwsError('NotFoundException', `Invalid Route identifier specified ${c.p.RouteId}`, 404);
  if (c.p.Target) {
    if (!targetOf(x, c.p.Target)) throw new AwsError('NotFoundException', `Integration not found: ${c.p.Target}`, 404);
    r.Target = c.p.Target;
  }
  if (c.p.RouteKey) r.RouteKey = c.p.RouteKey;
  if (c.p.AuthorizationType) r.AuthorizationType = c.p.AuthorizationType as ApiRoute['AuthorizationType'];
  if (c.p.AuthorizerId) r.AuthorizerId = c.p.AuthorizerId;
  if (r.AuthorizationType === 'JWT' && !(r.AuthorizerId && x.authorizers[r.AuthorizerId])) throw new AwsError('BadRequestException', 'Authorizer not found for the JWT authorization type.', 400);
  return routeView(r);
});

op('apigatewayv2', 'get-routes', 'api-id:s!', 'Lista las rutas.', { res: () => '*' }, (c) => ({ Items: Object.values(findApi(c, c.p.ApiId).routes).map(routeView) }));
op('apigatewayv2', 'delete-route', 'api-id:s! route-id:s!', 'Borra una ruta.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (!x.routes[c.p.RouteId]) throw new AwsError('NotFoundException', `Invalid Route identifier specified ${c.p.RouteId}`, 404);
  delete x.routes[c.p.RouteId];
  return undefined;
});

op('apigatewayv2', 'delete-integration', 'api-id:s! integration-id:s!', 'Borra una integración.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (!x.integrations[c.p.IntegrationId]) throw new AwsError('NotFoundException', `Invalid Integration identifier specified ${c.p.IntegrationId}`, 404);
  delete x.integrations[c.p.IntegrationId];
  return undefined;
});

op('apigatewayv2', 'create-stage', 'api-id:s! stage-name:s! auto-deploy:b default-route-settings:j', 'Crea una etapa (`prod`, `dev`…). Sin `--auto-deploy` hay que desplegar con `create-deployment`.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (x.stages[c.p.StageName]) throw new AwsError('ConflictException', `Stage already exists: ${c.p.StageName}`, 409);
  const d = (c.p.DefaultRouteSettings ?? {}) as { ThrottlingBurstLimit?: number; ThrottlingRateLimit?: number };
  x.stages[c.p.StageName] = { StageName: c.p.StageName, AutoDeploy: !!c.p.AutoDeploy, Deployed: !!c.p.AutoDeploy, ThrottlingBurstLimit: d.ThrottlingBurstLimit, ThrottlingRateLimit: d.ThrottlingRateLimit };
  return stageView(x.stages[c.p.StageName]);
});

op('apigatewayv2', 'get-stages', 'api-id:s!', 'Lista las etapas.', { res: () => '*' }, (c) => ({ Items: Object.values(findApi(c, c.p.ApiId).stages).map(stageView) }));
op('apigatewayv2', 'delete-stage', 'api-id:s! stage-name:s!', 'Borra una etapa.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (!x.stages[c.p.StageName]) throw new AwsError('NotFoundException', `Invalid stage identifier specified: ${c.p.StageName}`, 404);
  delete x.stages[c.p.StageName];
  return undefined;
});

op('apigatewayv2', 'create-deployment', 'api-id:s! stage-name:s description:s', 'Despliega los cambios de la API en una etapa (con `AutoDeploy` no hace falta).', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (c.p.StageName) {
    if (!x.stages[c.p.StageName]) throw new AwsError('NotFoundException', `Invalid stage identifier specified: ${c.p.StageName}`, 404);
    x.stages[c.p.StageName].Deployed = true;
  }
  return { DeploymentId: gwId(c.acct, 'apidep'), DeploymentStatus: 'DEPLOYED', CreatedDate: iso(c.acct.clock).replace('+00:00', 'Z'), AutoDeployed: false };
});

op('apigatewayv2', 'create-authorizer', 'api-id:s! authorizer-type:s! identity-source:l! name:s! jwt-configuration:j', 'Crea un autorizador JWT (un grupo de usuarios de Cognito u otro proveedor OIDC): `JwtConfiguration={Audience=[<client-id>],Issuer=<url>}`.', { res: () => '*' }, (c) => {
  const x = findApi(c, c.p.ApiId);
  if (c.p.AuthorizerType !== 'JWT') throw new AwsError('BadRequestException', `Authorizer type ${c.p.AuthorizerType} is not supported by this simulator: use JWT.`, 400);
  const j = (c.p.JwtConfiguration ?? {}) as { Audience?: string | string[]; Issuer?: string };
  if (!j.Issuer || !j.Audience) throw new AwsError('BadRequestException', 'JwtConfiguration with Issuer and Audience is required.', 400);
  const id = gwId(c.acct, 'apiauth');
  x.authorizers[id] = { AuthorizerId: id, Name: c.p.Name, AuthorizerType: 'JWT', IdentitySource: toArr<string>(c.p.IdentitySource), JwtConfiguration: { Audience: toArr<string>(j.Audience), Issuer: j.Issuer } };
  return { AuthorizerId: id, AuthorizerType: 'JWT', IdentitySource: x.authorizers[id].IdentitySource, Name: c.p.Name, JwtConfiguration: x.authorizers[id].JwtConfiguration };
});

op('apigatewayv2', 'get-authorizers', 'api-id:s!', 'Lista los autorizadores.', { res: () => '*' }, (c) => ({ Items: Object.values(findApi(c, c.p.ApiId).authorizers).map((z) => ({ AuthorizerId: z.AuthorizerId, AuthorizerType: z.AuthorizerType, IdentitySource: z.IdentitySource, Name: z.Name, JwtConfiguration: z.JwtConfiguration })) }));

// ───────────────────────── el «servidor» ─────────────────────────

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Fetched => ({ ok: true, status, type: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Server: 'Apigw', 'apigw-requestid': 'Xk3dLhzQIAMEJ6A=', ...headers } });

const sepa = (s: string) => s.split('/').filter(Boolean);

/** ¿Encaja la ruta (`GET /items/{id}`) con el método y la ruta pedidos? Devuelve la «especificidad» y los parámetros. */
function matchRoute(key: string, method: string, path: string): { score: number; params: Record<string, string> } | null {
  if (key === '$default') return { score: 1, params: {} };
  const m = /^(?:(\S+) )?(\/\S*)$/.exec(key);
  if (!m) return null;
  if (m[1] && m[1] !== 'ANY' && m[1] !== method) return null;
  const pat = sepa(m[2]);
  const got = sepa(path);
  const params: Record<string, string> = {};
  let score = m[1] && m[1] !== 'ANY' ? 5 : 3;
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    if (/^\{[^}]+\+\}$/.test(p)) {
      params[p.slice(1, -2)] = got.slice(i).join('/');
      return { score, params };
    }
    if (i >= got.length) return null;
    if (/^\{[^}]+\}$/.test(p)) {
      params[p.slice(1, -1)] = got[i];
      score += 2;
    } else if (p === got[i]) score += 4;
    else return null;
  }
  return got.length === pat.length ? { score, params } : null;
}

/** Atiende una petición a `https://<id>.execute-api.<región>.amazonaws.com/…`. Devuelve null si el nombre no es de una API. */
type ApiReq = { host: string; path: string; query: string; method: string; body?: string; headers?: Record<string, string> };

export function apiRequest(a: Account, req: ApiReq): Fetched | null {
  const t0 = a.clock;
  const res = apiRequestInner(a, req);
  if (res) apiMetrics(a, req.host, res.status ?? 0, a.clock - t0 + 3);
  return res;
}

function apiRequestInner(a: Account, req: ApiReq): Fetched | null {
  const m = /^([a-z0-9]{10})\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/.exec(req.host);
  if (!m) return null;
  const x = apigwOf(a, m[2]).apis[m[1]];
  if (!x) return json(403, { message: 'Forbidden' });
  // etapa: el primer segmento de la ruta si coincide con una etapa con nombre; si no, `$default`
  const segs = sepa(req.path);
  let stage = x.stages[segs[0] ?? ''];
  let path = '/' + segs.slice(1).join('/');
  if (!stage || segs[0] === '$default') {
    stage = x.stages.$default;
    path = '/' + segs.join('/');
  }
  if (!stage || !stage.Deployed) return json(404, { message: 'Not Found' });
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  let best: { r: ApiRoute; score: number; params: Record<string, string> } | undefined;
  for (const r of Object.values(x.routes)) {
    const k = matchRoute(r.RouteKey, method, path);
    if (k && (!best || k.score > best.score)) best = { r, ...k };
  }
  if (!best) return json(404, { message: 'Not Found' });
  const headers: Record<string, string> = { ...(req.headers ?? {}), host: req.host };
  let claims: Record<string, unknown> | undefined;
  if (best.r.AuthorizationType === 'JWT') {
    const z = x.authorizers[best.r.AuthorizerId ?? ''];
    const tok = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    claims = tok ? (readJwt(a, tok) ?? undefined) : undefined;
    const aud = claims ? String(claims.aud ?? claims.client_id ?? '') : '';
    if (!z || !claims || claims.iss !== z.JwtConfiguration.Issuer || !z.JwtConfiguration.Audience.includes(aud)) return json(401, { message: 'Unauthorized' }, { 'www-authenticate': 'Bearer scope="" error="invalid_token"' });
  }
  const integ = targetOf(x, best.r.Target);
  if (!integ) return json(500, { message: 'Internal Server Error' });
  const region = m[2];
  const rawPath = req.path;
  const event = {
    version: '2.0',
    routeKey: best.r.RouteKey,
    rawPath,
    rawQueryString: req.query,
    headers: { accept: '*/*', 'content-length': String((req.body ?? '').length), host: req.host, 'user-agent': 'curl/8.5.0', 'x-amzn-trace-id': 'Root=1-67891233-abcdef012345678912345678', 'x-forwarded-for': a.sourceIp, 'x-forwarded-port': '443', 'x-forwarded-proto': 'https', ...headers },
    ...(req.query ? { queryStringParameters: Object.fromEntries(new URLSearchParams(req.query).entries()) } : {}),
    requestContext: { accountId: a.id, apiId: x.ApiId, domainName: req.host, domainPrefix: x.ApiId, http: { method: req.method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: a.sourceIp, userAgent: 'curl/8.5.0' }, requestId: 'Xk3dLhzQIAMEJ6A=', routeKey: best.r.RouteKey, stage: stage.StageName, time: new Date(a.clock).toUTCString().replace('GMT', '+0000'), timeEpoch: a.clock, ...(claims ? { authorizer: { jwt: { claims, scopes: null } } } : {}) },
    ...(Object.keys(best.params).length ? { pathParameters: best.params } : {}),
    body: req.body ?? undefined,
    isBase64Encoded: false,
  };
  let target;
  try {
    target = resolveFn(a, region, integ.IntegrationUri);
  } catch {
    return json(500, { message: 'Internal Server Error' });
  }
  if (!lambdaAllows(target.fn, 'apigateway.amazonaws.com', execArn(a, region, x.ApiId, `${stage.StageName}/${method}${path}`))) return json(500, { message: 'Internal Server Error' });
  if (target.fn.reserved === 0) return json(429, { message: 'Too Many Requests' });
  const out = runFunction(a, target.region, target.fn, target.qualifier, JSON.stringify(event));
  a.clock += Math.ceil(out.durationMs);
  if (out.functionError) return json(500, { message: 'Internal Server Error' });
  let res: unknown;
  try {
    res = JSON.parse(out.payload);
  } catch {
    return json(500, { message: 'Internal Server Error' });
  }
  if (res && typeof res === 'object' && !Array.isArray(res) && 'statusCode' in res) {
    const r = res as { statusCode: number; headers?: Record<string, string>; body?: unknown; isBase64Encoded?: boolean };
    if (typeof r.statusCode !== 'number' || (r.body !== undefined && typeof r.body !== 'string')) return json(500, { message: 'Internal Server Error' });
    const h = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k, String(v)]));
    const type = Object.entries(h).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? 'application/json';
    return { ok: true, status: r.statusCode, type, body: r.body ?? '', headers: { Server: 'Apigw', 'apigw-requestid': 'Xk3dLhzQIAMEJ6A=', ...Object.fromEntries(Object.entries(h).filter(([k]) => k.toLowerCase() !== 'content-type')) } };
  }
  // formato 2.0: cualquier otro JSON válido se devuelve tal cual con estado 200
  return { ok: true, status: 200, type: 'application/json', body: JSON.stringify(res), headers: { Server: 'Apigw', 'apigw-requestid': 'Xk3dLhzQIAMEJ6A=' } };
}

