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
  const settles = Object.values(acct.regions).some((r) => Object.keys(r.elb?.lbs ?? {}).length || Object.keys(r.asg?.groups ?? {}).length || Object.keys(r.tgw?.gateways ?? {}).length || Object.keys(r.ec2.vpns ?? {}).length || Object.keys(r.ec2.endpoints ?? {}).length);
  if (settles || Object.keys(acct.route53?.healthChecks ?? {}).length || Object.keys(acct.cloudfront?.distributions ?? {}).length) {
    for (let k = 0; k < 8; k++) {
      acct.clock += 60000;
      tick(acct);
    }
  }
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
