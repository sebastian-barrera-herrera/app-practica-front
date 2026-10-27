import { Terminal } from '../../engine/terminal';
import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });

async function role(e: TestEnv, name: string, svc: string, policies: string[] = []) {
  e.write(`${name}.json`, TRUST(svc));
  const r = await e.json(`iam create-role --role-name ${name} --assume-role-policy-document file://${name}.json`);
  for (const p of policies) await e.run(`iam attach-role-policy --role-name ${name} --policy-arn arn:aws:iam::aws:policy/${p}`);
  return r.Role.Arn as string;
}
async function fn(e: TestEnv, name: string, code: string) {
  e.write(`${name}.zip`, zip({ 'lambda_function.py': code }));
  const r = await role(e, `${name}-role`, 'lambda.amazonaws.com', ['service-role/AWSLambdaBasicExecutionRole']);
  await e.json(`lambda create-function --function-name ${name} --runtime python3.12 --role ${r} --handler lambda_function.lambda_handler --zip-file fileb://${name}.zip`);
  return `arn:aws:lambda:us-east-1:123456789012:function:${name}`;
}

describe('Cognito', () => {
  test('registro, confirmación, inicio de sesión y flujo no habilitado', async () => {
    const e = mkEnv();
    const pool = (await e.json('cognito-idp create-user-pool --pool-name tienda --auto-verified-attributes email --username-attributes email')).UserPool;
    expect(pool.Id).toMatch(/^us-east-1_[A-Za-z0-9]{9}$/);
    const cli = (await e.json(`cognito-idp create-user-pool-client --user-pool-id ${pool.Id} --client-name web`)).UserPoolClient;
    // sin ALLOW_USER_PASSWORD_AUTH no se puede iniciar sesión con usuario y contraseña
    const su = await e.json(`cognito-idp sign-up --client-id ${cli.ClientId} --username ana@tienda.es --password 'Secreto#123'`);
    expect(su.UserConfirmed).toBe(false);
    const args = `--client-id ${cli.ClientId} --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD='Secreto#123'`;
    expect((await e.run(`cognito-idp initiate-auth ${args}`)).stderr).toContain('USER_PASSWORD_AUTH flow not enabled for this client');
    await e.run(`cognito-idp update-user-pool-client --user-pool-id ${pool.Id} --client-id ${cli.ClientId} --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH`);
    // sin confirmar
    expect((await e.run(`cognito-idp initiate-auth ${args}`)).stderr).toContain('UserNotConfirmedException');
    expect((await e.run(`cognito-idp confirm-sign-up --client-id ${cli.ClientId} --username ana@tienda.es --confirmation-code 111111`)).stderr).toContain('CodeMismatchException');
    await e.run(`cognito-idp confirm-sign-up --client-id ${cli.ClientId} --username ana@tienda.es --confirmation-code 123456`);
    expect((await e.run(`cognito-idp initiate-auth --client-id ${cli.ClientId} --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD=mala`)).stderr).toContain('Incorrect username or password');
    const t = (await e.json(`cognito-idp initiate-auth ${args}`)).AuthenticationResult;
    expect(t.TokenType).toBe('Bearer');
    const claims = JSON.parse(atob(t.IdToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims.iss).toBe(`https://cognito-idp.us-east-1.amazonaws.com/${pool.Id}`);
    expect(claims.aud).toBe(cli.ClientId);
    expect(claims.email).toBe('ana@tienda.es');
    const me = await e.json(`cognito-idp get-user --access-token ${t.AccessToken}`);
    expect(me.UserAttributes.find((a: any) => a.Name === 'email').Value).toBe('ana@tienda.es');
    // renovar con el token de refresco
    const r = (await e.json(`cognito-idp initiate-auth --client-id ${cli.ClientId} --auth-flow REFRESH_TOKEN_AUTH --auth-parameters REFRESH_TOKEN=${t.RefreshToken}`)).AuthenticationResult;
    expect(r.AccessToken).toBeTruthy();
    expect(r.RefreshToken).toBeUndefined();
    // la política de contraseñas
    expect((await e.run(`cognito-idp sign-up --client-id ${cli.ClientId} --username bea@tienda.es --password abc`)).stderr).toContain('InvalidPasswordException');
    // y los tokens caducan al cabo de una hora
    e.acct.clock += 61 * 60000;
    expect((await e.run(`cognito-idp get-user --access-token ${t.AccessToken}`)).stderr).toContain('NotAuthorizedException');
  });

  test('usuarios creados por el administrador y grupos', async () => {
    const e = mkEnv();
    const pool = (await e.json('cognito-idp create-user-pool --pool-name admin')).UserPool;
    const cli = (await e.json(`cognito-idp create-user-pool-client --user-pool-id ${pool.Id} --client-name srv --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH`)).UserPoolClient;
    await e.run(`cognito-idp admin-create-user --user-pool-id ${pool.Id} --username carlos --temporary-password 'Temporal#1'`);
    await e.run(`cognito-idp create-group --user-pool-id ${pool.Id} --group-name admins`);
    await e.run(`cognito-idp admin-add-user-to-group --user-pool-id ${pool.Id} --username carlos --group-name admins`);
    const first = await e.json(`cognito-idp admin-initiate-auth --user-pool-id ${pool.Id} --client-id ${cli.ClientId} --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME=carlos,PASSWORD='Temporal#1'`);
    expect(first.ChallengeName).toBe('NEW_PASSWORD_REQUIRED');
    const ok = await e.json(`cognito-idp respond-to-auth-challenge --client-id ${cli.ClientId} --challenge-name NEW_PASSWORD_REQUIRED --session ${first.Session} --challenge-responses USERNAME=carlos,NEW_PASSWORD='Definitiva#9'`);
    const claims = JSON.parse(atob(ok.AuthenticationResult.IdToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims['cognito:groups']).toEqual(['admins']);
    expect(await e.json(`cognito-idp admin-get-user --user-pool-id ${pool.Id} --username carlos --query UserStatus`)).toBe('CONFIRMED');
    expect(await e.json(`cognito-idp list-users --user-pool-id ${pool.Id} --query "length(Users)"`)).toBe(1);
    expect((await e.run(`cognito-idp admin-add-user-to-group --user-pool-id ${pool.Id} --username carlos --group-name nada`)).stderr).toContain('ResourceNotFoundException');
  });
});

describe('API Gateway (API HTTP)', () => {
  async function setup() {
    const t = new Terminal({ instant: true, aws: 'base' });
    return t;
  }
  const put = async (t: Terminal, name: string, content: string) => void t.fs.writeFile(`${(await t.exec('echo $HOME')).out.trim()}/${name}`, content);
  const aws = async (t: Terminal, line: string) => (await t.exec(`aws ${line}`)).out;
  const awsJson = async (t: Terminal, line: string) => JSON.parse(await aws(t, line));

  test('creación rápida: la API responde con lo que devuelve la función', async () => {
    const e = mkEnv();
    const arn = await fn(e, 'hola', "import json\ndef lambda_handler(event, context):\n    name = (event.get('queryStringParameters') or {}).get('name', 'mundo')\n    return {'statusCode': 200, 'headers': {'Content-Type': 'application/json'}, 'body': json.dumps({'hola': name, 'ruta': event['rawPath'], 'metodo': event['requestContext']['http']['method']})}\n");
    const api = await e.json(`apigatewayv2 create-api --name hola-api --protocol-type HTTP --target ${arn}`);
    expect(api.ApiEndpoint).toMatch(/^https:\/\/[a-z0-9]{10}\.execute-api\.us-east-1\.amazonaws\.com$/);
    // la creación rápida añade el permiso de invocación
    const pol = JSON.parse((await e.json('lambda get-policy --function-name hola')).Policy);
    expect(pol.Statement[0].Principal.Service).toBe('apigateway.amazonaws.com');
    expect(await e.json(`apigatewayv2 get-routes --api-id ${api.ApiId} --query "Items[0].RouteKey"`)).toBe('$default');
    expect(await e.json(`apigatewayv2 get-stages --api-id ${api.ApiId} --query "Items[0].StageName"`)).toBe('$default');
  });

  test('curl: rutas, parámetros, cuerpo, 404 y la respuesta mal formada', async () => {
    const t = await setup();
    const sh = async (c: string) => (await t.exec(c)).out;
    const trust = TRUST('lambda.amazonaws.com');
    await t.exec(`echo '${trust}' > trust.json`);
    const role = (await awsJson(t, 'iam create-role --role-name api-role --assume-role-policy-document file://trust.json')).Role.Arn;
    await t.exec(`aws iam attach-role-policy --role-name api-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
    // la función guarda en un fichero el código; usamos python3 del terminal para generar el zip no es posible: creamos el zip con el formato del simulador
    const code = "import json\ndef lambda_handler(event, context):\n    m = event['requestContext']['http']['method']\n    if event['rawPath'].endswith('/roto'):\n        return {'statusCode': 200, 'body': {'a': 1}}\n    if event['rawPath'].endswith('/texto'):\n        return 'solo texto'\n    if m == 'POST':\n        d = json.loads(event.get('body') or '{}')\n        return {'statusCode': 201, 'body': json.dumps({'recibido': d, 'tipo': event['headers'].get('content-type')})}\n    return {'statusCode': 200, 'body': json.dumps({'id': (event.get('pathParameters') or {}).get('id'), 'ruta': event['routeKey']})}\n";
    // el terminal puede ver los ficheros del entorno: escribimos el zip a través del sistema de archivos virtual
    await put(t, 'api.zip', zip({ 'lambda_function.py': code }));
    await t.exec(`aws lambda create-function --function-name api --runtime python3.12 --role ${role} --handler lambda_function.lambda_handler --zip-file fileb://api.zip`);
    const api = await awsJson(t, 'apigatewayv2 create-api --name tienda --protocol-type HTTP');
    const fnArn = 'arn:aws:lambda:us-east-1:123456789012:function:api';
    const integ = await awsJson(t, `apigatewayv2 create-integration --api-id ${api.ApiId} --integration-type AWS_PROXY --integration-uri ${fnArn} --payload-format-version 2.0`);
    await aws(t, `apigatewayv2 create-route --api-id ${api.ApiId} --route-key 'GET /items/{id}' --target integrations/${integ.IntegrationId}`);
    await aws(t, `apigatewayv2 create-route --api-id ${api.ApiId} --route-key 'POST /items' --target integrations/${integ.IntegrationId}`);
    await aws(t, `apigatewayv2 create-route --api-id ${api.ApiId} --route-key 'GET /roto' --target integrations/${integ.IntegrationId}`);
    await aws(t, `apigatewayv2 create-route --api-id ${api.ApiId} --route-key 'GET /texto' --target integrations/${integ.IntegrationId}`);
    const base = api.ApiEndpoint;
    // sin etapa desplegada: no hay nada
    await aws(t, `apigatewayv2 create-stage --api-id ${api.ApiId} --stage-name prod`);
    expect(await sh(`curl -s ${base}/prod/items/7`)).toContain('Not Found');
    await aws(t, `apigatewayv2 create-deployment --api-id ${api.ApiId} --stage-name prod`);
    // sin permiso en la función: 500
    expect(await sh(`curl -s ${base}/prod/items/7`)).toContain('Internal Server Error');
    await aws(t, `lambda add-permission --function-name api --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:123456789012:${api.ApiId}/*/*/*"`);
    const ok = JSON.parse(await sh(`curl -s ${base}/prod/items/7`));
    expect(ok).toEqual({ id: '7', ruta: 'GET /items/{id}' });
    const post = JSON.parse(await sh(`curl -s -X POST -H "Content-Type: application/json" -d '{"sku":"A1"}' ${base}/prod/items`));
    expect(post).toEqual({ recibido: { sku: 'A1' }, tipo: 'application/json' });
    const code2 = await sh(`curl -s -o /dev/null -w "%{http_code}" -X POST -d '{}' ${base}/prod/items`);
    expect(code2).toBe('201');
    expect(await sh(`curl -s ${base}/prod/nada`)).toContain('Not Found');
    // el cuerpo debe ser una cadena y la respuesta, un JSON con statusCode
    expect(await sh(`curl -s ${base}/prod/roto`)).toContain('Internal Server Error');
    expect(await sh(`curl -s ${base}/prod/texto`)).toBe('"solo texto"');
    // un método no definido para la ruta
    expect(await sh(`curl -s -X DELETE ${base}/prod/items/7`)).toContain('Not Found');
  });

  test('autorizador JWT con Cognito: sin token 401, con token y audiencia correcta 200', async () => {
    const t = await setup();
    const sh = async (c: string) => (await t.exec(c)).out;
    await t.exec(`echo '${TRUST('lambda.amazonaws.com')}' > trust.json`);
    const role = (await awsJson(t, 'iam create-role --role-name priv-role --assume-role-policy-document file://trust.json')).Role.Arn;
    await put(t, 'priv.zip', zip({ 'lambda_function.py': "import json\ndef lambda_handler(event, context):\n    c = event['requestContext']['authorizer']['jwt']['claims']\n    return {'statusCode': 200, 'body': json.dumps({'usuario': c.get('email', c.get('username'))})}\n" }));
    await t.exec(`aws lambda create-function --function-name priv --runtime python3.12 --role ${role} --handler lambda_function.lambda_handler --zip-file fileb://priv.zip`);
    const fnArn = 'arn:aws:lambda:us-east-1:123456789012:function:priv';
    const pool = (await awsJson(t, 'cognito-idp create-user-pool --pool-name p --username-attributes email')).UserPool;
    const cli = (await awsJson(t, `cognito-idp create-user-pool-client --user-pool-id ${pool.Id} --client-name web --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH`)).UserPoolClient;
    const api = await awsJson(t, `apigatewayv2 create-api --name privada --protocol-type HTTP`);
    const integ = await awsJson(t, `apigatewayv2 create-integration --api-id ${api.ApiId} --integration-type AWS_PROXY --integration-uri ${fnArn} --payload-format-version 2.0`);
    const iss = `https://cognito-idp.us-east-1.amazonaws.com/${pool.Id}`;
    const auth = await awsJson(t, `apigatewayv2 create-authorizer --api-id ${api.ApiId} --authorizer-type JWT --identity-source '$request.header.Authorization' --name cognito --jwt-configuration Audience=${cli.ClientId},Issuer=${iss}`);
    await aws(t, `apigatewayv2 create-route --api-id ${api.ApiId} --route-key 'GET /perfil' --target integrations/${integ.IntegrationId} --authorization-type JWT --authorizer-id ${auth.AuthorizerId}`);
    await aws(t, `apigatewayv2 create-stage --api-id ${api.ApiId} --stage-name '$default' --auto-deploy`);
    await aws(t, `lambda add-permission --function-name priv --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:123456789012:${api.ApiId}/*/*/perfil"`);
    const url = `${api.ApiEndpoint}/perfil`;
    expect(await sh(`curl -s -o /dev/null -w "%{http_code}" ${url}`)).toBe('401');
    expect(await sh(`curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer abc.def.ghi" ${url}`)).toBe('401');
    await aws(t, `cognito-idp sign-up --client-id ${cli.ClientId} --username ana@tienda.es --password 'Secreto#123'`);
    await aws(t, `cognito-idp admin-confirm-sign-up --user-pool-id ${pool.Id} --username ana@tienda.es`);
    const tok = (await awsJson(t, `cognito-idp initiate-auth --client-id ${cli.ClientId} --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD='Secreto#123'`)).AuthenticationResult;
    // el token de acceso no lleva `aud` (lleva client_id): también vale
    expect(await sh(`curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${tok.AccessToken}" ${url}`)).toBe('200');
    expect(JSON.parse(await sh(`curl -s -H "Authorization: Bearer ${tok.IdToken}" ${url}`))).toEqual({ usuario: 'ana@tienda.es' });
    // otro cliente de aplicación → audiencia que no coincide
    const other = (await awsJson(t, `cognito-idp create-user-pool-client --user-pool-id ${pool.Id} --client-name otra --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH`)).UserPoolClient;
    const tok2 = (await awsJson(t, `cognito-idp initiate-auth --client-id ${other.ClientId} --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=ana@tienda.es,PASSWORD='Secreto#123'`)).AuthenticationResult;
    expect(await sh(`curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${tok2.IdToken}" ${url}`)).toBe('401');
  });
});
