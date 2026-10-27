/** Escenarios de la zona «Datos a fondo» (Z11): DynamoDB avanzado, RDS y Aurora, ElastiCache y migración (DMS y DataSync). */
import { regional } from './account';
import { BASIC, TRUST, call, fn, policy, role } from './scenarios-srv';
import type { Scenario } from './scenarios';
import { ddbCreate } from './services/dynamodb';
import { ec2CreateSg } from './services/ec2';
import { iamCreateRole } from './services/iam';
import { rdsCreate } from './services/rds';
import { s3CreateBucket } from './services/s3';
import { ec2CreateSubnet, ec2CreateVpc } from './services/vpc';
import type { Account, Tag } from './types';

const R = 'us-east-1';
const S = (s: string) => ({ S: s });
const N = (n: number) => ({ N: String(n) });
const name = (n: string): Tag[] => [{ Key: 'Name', Value: n }];

export const DATA_PASSWORD = 'Secreto123';

/** Código en Python de las funciones de la zona. */
export const DATA_CODE = {
  auditoria: `import json


def lambda_handler(event, context):
    for registro in event['Records']:
        datos = registro['dynamodb']
        print(registro['eventName'], json.dumps(datos['Keys']))
    return {'registros': len(event['Records'])}
`,
  catalogoCache: `import os
import time
import redis

r = redis.Redis(host=os.environ['CACHE'], port=6379, decode_responses=True, socket_connect_timeout=2)


def lambda_handler(event, context):
    clave = 'producto:' + event['id']
    valor = r.get(clave)
    if valor:
        return {'origen': 'cache', 'producto': valor}
    time.sleep(0.4)  # consulta lenta a la base de datos
    valor = 'Producto ' + event['id']
    r.setex(clave, 300, valor)
    return {'origen': 'base de datos', 'producto': valor}
`,
  catalogoBoss: `import os
import boto3
import redis

r = redis.Redis(host=os.environ['CACHE'], port=6379, decode_responses=True, socket_connect_timeout=2)
tabla = boto3.resource('dynamodb').Table('productos')


def lambda_handler(event, context):
    clave = 'producto:' + event['id']
    valor = r.get(clave)
    if valor:
        return {'origen': 'cache', 'producto': valor}
    item = tabla.get_item(Key={'id': event['id']}).get('Item')
    if not item:
        return {'origen': 'base de datos', 'producto': None}
    r.setex(clave, 300, item['nombre'])
    return {'origen': 'base de datos', 'producto': item['nombre']}
`,
};

/** VPC «app» sin salida a Internet: dos subredes privadas en zonas distintas y dos grupos de seguridad vacíos. */
function appVpc(a: Account) {
  const vpc = ec2CreateVpc(a, R, '10.0.0.0/16', name('app'));
  const s1 = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.1.0/24', 0, { tags: name('app-a') });
  const s2 = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.2.0/24', 1, { tags: name('app-b') });
  const appSg = ec2CreateSg(a, R, 'app-sg', 'Funciones de la aplicación', [], vpc.VpcId);
  const cacheSg = ec2CreateSg(a, R, 'cache-sg', 'Cachés de la aplicación', [], vpc.VpcId);
  return { vpc, s1, s2, appSg, cacheSg };
}

const defaultVpcId = (a: Account) => Object.values(regional(a, R).ec2.vpcs).find((v) => v.IsDefault)!.VpcId;

export function makeDataScenarios(base: Scenario): Record<string, Scenario> {
  // ───────────── DynamoDB ─────────────

  /** `pedidos` (cliente + fecha) sin índices y `lecturas` en capacidad provisionada mínima. */
  const ddbTienda: Scenario = (a) => {
    base(a);
    const pedidos: [string, string, string, number][] = [
      ['ana', '2026-01-05', 'entregado', 40],
      ['ana', '2026-02-10', 'enviado', 25],
      ['ana', '2026-03-02', 'pendiente', 60],
      ['bob', '2026-01-20', 'entregado', 15],
      ['bob', '2026-03-01', 'pendiente', 90],
      ['eva', '2026-02-14', 'enviado', 33],
      ['eva', '2026-02-28', 'pendiente', 12],
      ['eva', '2026-03-05', 'pendiente', 70],
    ];
    ddbCreate(a, R, 'pedidos', { pk: ['cliente', 'S'], sk: ['fecha', 'S'], items: pedidos.map(([cliente, fecha, estado, total]) => ({ cliente: S(cliente), fecha: S(fecha), estado: S(estado), total: N(total) })) });
    ddbCreate(a, R, 'lecturas', { pk: ['sensor', 'S'], sk: ['marca', 'N'], provisioned: [1, 1], items: [{ sensor: S('s1'), marca: N(1), valor: N(20) }] });
  };

  /** Tablas sin stream, con sesiones caducadas y cuentas; una función de auditoría con un rol que aún no puede leer streams. */
  const ddbEventos: Scenario = (a) => {
    base(a);
    const ahora = Math.floor(a.clock / 1000);
    ddbCreate(a, R, 'pedidos', { pk: ['id', 'S'] });
    ddbCreate(a, R, 'sesiones', {
      pk: ['id', 'S'],
      items: [
        { id: S('s1'), usuario: S('ana'), expira: N(ahora - 86400) },
        { id: S('s2'), usuario: S('bob'), expira: N(ahora - 7200) },
        { id: S('s3'), usuario: S('eva'), expira: N(ahora - 3600) },
        { id: S('s4'), usuario: S('ivo'), expira: N(ahora + 86400) },
        { id: S('s5'), usuario: S('mar'), expira: N(ahora + 7 * 86400) },
      ],
    });
    ddbCreate(a, R, 'cuentas', { pk: ['id', 'S'], items: [{ id: S('ana'), saldo: N(100) }, { id: S('bob'), saldo: N(0) }] });
    const r = role(a, 'auditoria-role', { attached: [BASIC] });
    fn(a, 'auditoria', DATA_CODE.auditoria, r);
  };

  // ───────────── RDS y Aurora ─────────────

  /** Una MySQL que se queda sin conexiones, un clúster Aurora vacío y todo lo necesario para un RDS Proxy (el rol aún no lee el secreto). */
  const rds: Scenario = (a) => {
    base(a);
    const vpc = defaultVpcId(a);
    const dbSg = ec2CreateSg(a, R, 'db-sg', 'Base de datos de la tienda', [], vpc);
    const db = rdsCreate(a, R, 'tienda-db', { cls: 'db.t3.micro', engine: 'mysql', storage: 20, backup: 7, sgIds: [dbSg.GroupId], tags: [{ Key: 'Entorno', Value: 'prod' }] });
    db.pw = DATA_PASSWORD;
    call(a, 'rds', 'create-db-cluster', { DbClusterIdentifier: 'aurora-tienda', Engine: 'aurora-mysql', MasterUsername: 'admin', MasterUserPassword: DATA_PASSWORD });
    call(a, 'secretsmanager', 'create-secret', { Name: 'prod/tienda', SecretString: JSON.stringify({ username: 'admin', password: DATA_PASSWORD }) });
    iamCreateRole(a, 'proxy-role', TRUST('rds.amazonaws.com'), { attached: [] });
  };

  // ───────────── ElastiCache ─────────────

  /** VPC `app`, una función que usa Redis como caché (sin VPC ni variable de entorno todavía) y un grupo de sesiones sin réplicas. */
  const cache: Scenario = (a) => {
    base(a);
    const v = appVpc(a);
    const r = role(a, 'catalogo-role', { attached: [BASIC] });
    fn(a, 'catalogo', DATA_CODE.catalogoCache, r, { timeout: 10 });
    call(a, 'elasticache', 'create-cache-subnet-group', { CacheSubnetGroupName: 'sesiones-subredes', CacheSubnetGroupDescription: 'Sesiones', SubnetIds: [v.s1.SubnetId, v.s2.SubnetId] });
    call(a, 'elasticache', 'create-replication-group', { ReplicationGroupId: 'sesiones', ReplicationGroupDescription: 'Sesiones de usuario', Engine: 'redis', CacheNodeType: 'cache.t4g.micro', NumCacheClusters: 1, CacheSubnetGroupName: 'sesiones-subredes', SecurityGroupIds: [v.cacheSg.GroupId] });
    a.clock += 10 * 60000;
  };

  // ───────────── Migración ─────────────

  /** Una base de datos MySQL «heredada» con tablas, un lago de datos en S3 y un rol de DMS al que le faltan permisos. */
  const dms: Scenario = (a) => {
    base(a);
    const vpc = defaultVpcId(a);
    const sg = ec2CreateSg(a, R, 'legado-sg', 'Base de datos heredada', [], vpc);
    const db = rdsCreate(a, R, 'legado', { cls: 'db.t3.small', engine: 'mysql', storage: 50, backup: 7, sgIds: [sg.GroupId] });
    db.pw = DATA_PASSWORD;
    db.tables = [
      { schema: 'tienda', name: 'pedidos', rows: 4000 },
      { schema: 'tienda', name: 'clientes', rows: 800 },
      { schema: 'sistema', name: 'auditoria', rows: 1500 },
    ];
    s3CreateBucket(a, 'lago-datos', R);
    iamCreateRole(a, 'dms-s3-role', TRUST('dms.amazonaws.com'), { attached: [] });
  };

  /** Una carpeta compartida (NFS) en la oficina, un agente de DataSync conectado y un bucket de destino; el rol aún no tiene permisos. */
  const sync: Scenario = (a) => {
    base(a);
    s3CreateBucket(a, 'archivo-oficina', R);
    iamCreateRole(a, 'datasync-role', TRUST('datasync.amazonaws.com'), { attached: [] });
    a.onpremShares = {
      '10.0.0.5:/exports/ventas': {
        'ventas/2024.csv': 'mes,total\nene,100\nfeb,120\n',
        'ventas/2025.csv': 'mes,total\nene,130\nfeb,150\n',
        'logs/app.log': 'arranque\nerror leve\n',
        'logs/acceso.log': '10.0.0.9 GET /\n',
      },
    };
    const arn = `arn:aws:datasync:${R}:${a.id}:agent/agent-0a1b2c3d4e5f6a7b8`;
    regional(a, R).datasync = { agents: { [arn]: { arn, name: 'agente-oficina', status: 'ONLINE' } }, locations: {}, tasks: {}, executions: {} };
  };

  // ───────────── Jefe de la zona ─────────────

  /** La API del catálogo en una VPC sin salida: la función aún no está en la VPC, no hay caché, ni punto de enlace de DynamoDB. */
  const boss: Scenario = (a) => {
    base(a);
    appVpc(a);
    ddbCreate(a, R, 'productos', {
      pk: ['id', 'S'],
      items: [
        { id: S('p1'), nombre: S('Camiseta') },
        { id: S('p2'), nombre: S('Taza') },
        { id: S('p3'), nombre: S('Gorra') },
      ],
    });
    const ahora = Math.floor(a.clock / 1000);
    ddbCreate(a, R, 'carritos', {
      pk: ['id', 'S'],
      items: [
        { id: S('c1'), expira: N(ahora - 86400) },
        { id: S('c2'), expira: N(ahora - 7200) },
        { id: S('c3'), expira: N(ahora + 86400) },
      ],
    });
    const r = role(a, 'catalogo-role', { attached: [BASIC, 'service-role/AWSLambdaVPCAccessExecutionRole'], inline: { 'lee-productos': policy([{ Action: ['dynamodb:GetItem'], Resource: `arn:aws:dynamodb:${R}:${a.id}:table/productos` }]) } });
    fn(a, 'catalogo', DATA_CODE.catalogoBoss, r, { timeout: 10 });
  };

  return {
    'data-ddb-tienda': ddbTienda,
    'data-ddb-eventos': ddbEventos,
    'data-rds': rds,
    'data-cache': cache,
    'data-dms': dms,
    'data-sync': sync,
    'data-boss': boss,
  };
}
