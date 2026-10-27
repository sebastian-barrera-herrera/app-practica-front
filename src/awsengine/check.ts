/** Comprobación de retos de AWS: ejecuta una consulta de solo lectura sobre una copia de la cuenta y compara la salida. */
import type { CheckResult } from '../engine/check';
import type { Terminal } from '../engine/terminal';
import { awsAccountOf } from './state';
import { runAwsSync } from './cli';
import { settleEc2 } from './services/ec2';
import { settleRds } from './services/rds';
import { tick } from './tick';
import type { AwsIO } from './registry';
import { clone, shellSplit } from './util';

export interface AwsCheckSpec {
  t: 'aws';
  /** Comando de consulta (sin la palabra `aws`), p. ej. `iam list-users --query "Users[].UserName"`. */
  cmd: string;
  /** El resultado JSON es exactamente esto. */
  json?: unknown;
  /** La salida (texto) es exactamente esto. */
  equals?: string;
  includes?: string | string[];
  notIncludes?: string;
  matches?: string;
  /** La salida está vacía (`[]`, `null`, `{}` o nada). */
  empty?: boolean;
  /** El comando tiene que fallar (y la salida de error incluir `includes`). */
  fails?: boolean;
  /** Qué hay que conseguir, para el mensaje de pista. */
  want?: string;
  /** Órdenes que se ejecutan antes (en la copia, como «dios») y tras las que se deja pasar un rato: pedir a una API, publicar un mensaje, subir un objeto… */
  pre?: string[];
}

const isEmpty = (s: string) => ['', '[]', '{}', 'null', 'None'].includes(s.trim());

/** Quita las diferencias que no importan al comparar (orden de claves). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}

export function awsCheck(check: AwsCheckSpec, term: Terminal): CheckResult {
  const live = awsAccountOf(term.world.sys);
  if (!live) return { ok: false, why: 'No hay cuenta de AWS en este ejercicio' };
  // se consulta una copia: la comprobación nunca cambia la cuenta del alumno
  const acct = clone(live);
  settleEc2(acct);
  settleRds(acct);
  // balanceadores, grupos de Auto Scaling y comprobaciones de salud tardan minutos en asentarse
  const settles = Object.values(acct.regions).some(
    (r) =>
      Object.keys(r.elb?.lbs ?? {}).length ||
      Object.keys(r.asg?.groups ?? {}).length ||
      Object.keys(r.tgw?.gateways ?? {}).length ||
      Object.keys(r.ec2.vpns ?? {}).length ||
      Object.keys(r.ec2.endpoints ?? {}).length ||
      Object.keys(r.lambda?.esms ?? {}).length ||
      Object.keys(r.elasticache?.groups ?? {}).length ||
      Object.keys(r.elasticache?.clusters ?? {}).length ||
      Object.keys(r.dms?.instances ?? {}).length ||
      Object.keys(r.rds?.proxies ?? {}).length ||
      Object.values(r.ddb ?? {}).some((t) => t.ttl?.Enabled) ||
      Object.values(r.events?.buses ?? {}).some((b) => Object.values(b.rules).some((x) => x.ScheduleExpression)) ||
      Object.values(r.sfn?.machines ?? {}).some((m) => Object.keys(m.executions ?? {}).length),
  );
  const wait = (minutes: number) => {
    for (let k = 0; k < minutes; k++) {
      acct.clock += 60000;
      tick(acct);
    }
  };
  if (settles || Object.keys(acct.route53?.healthChecks ?? {}).length || Object.keys(acct.cloudfront?.distributions ?? {}).length) wait(8);
  const io: AwsIO = {
    acct,
    env: {},
    home: '/home/alumno',
    cwd: '/home/alumno',
    readFile: () => null,
    writeFile: () => false,
    removeFile: () => undefined,
    listFiles: () => null,
    isDir: () => false,
    size: () => null,
    abs: (p) => p,
    stdin: null,
    cols: 100,
    god: true,
  };
  if (check.pre?.length) {
    for (const line of check.pre) runAwsSync(shellSplit(line), io);
    wait(4);
  }
  const res = runAwsSync(shellSplit(check.cmd), io);
  const fail = (why: string): CheckResult => ({ ok: false, why: check.want ?? why });
  if (check.fails) {
    if (res.code === 0) return fail('Esto todavía debería dar error');
    const inc = check.includes === undefined ? [] : Array.isArray(check.includes) ? check.includes : [check.includes];
    return inc.every((x) => res.stderr.includes(x)) ? { ok: true } : fail('El error no es el esperado');
  }
  if (res.code !== 0) return fail('No se pudo comprobar el estado de la cuenta');
  const out = res.stdout.trimEnd();
  if (check.empty !== undefined) return isEmpty(out) === check.empty ? { ok: true } : fail(check.empty ? 'Todavía queda algo por quitar' : 'Todavía falta crear algo');
  if (check.json !== undefined) {
    let got: unknown;
    try {
      got = JSON.parse(out);
    } catch {
      return fail('No se pudo leer el estado');
    }
    return canon(got) === canon(check.json) ? { ok: true } : fail('El estado de la cuenta todavía no es el que se pide');
  }
  if (check.equals !== undefined && out !== check.equals.trimEnd()) return fail('El estado de la cuenta todavía no es el que se pide');
  const incs = check.includes === undefined ? [] : Array.isArray(check.includes) ? check.includes : [check.includes];
  for (const i of incs) if (!out.includes(i)) return fail(`Falta ${i}`);
  if (check.notIncludes && out.includes(check.notIncludes)) return fail(`No debería estar ${check.notIncludes}`);
  if (check.matches && !new RegExp(check.matches, 'm').test(out)) return fail('El estado de la cuenta todavía no es el que se pide');
  return { ok: true };
}
