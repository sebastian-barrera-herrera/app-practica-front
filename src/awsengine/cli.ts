/** `aws …`: despacha la línea de comandos contra la cuenta simulada. */
import './services';
import { authorize, baseContext } from './authz';
import { parseOpParams, splitArgs, suggest } from './args';
import { authenticate, CredError, resolveCredentials, resolveRegion, type Resolved } from './creds';
import { JmesError, search } from './jmespath';
import { OUTPUT_FORMATS, renderOutput, type OutputFormat } from './render';
import { AwsError, OPS, Raw, SERVICE_SUMMARY, UsageErr, iamAction, opsOf, servicesList, type AuthzTarget, type AwsIO, type Caller, type GlobalOpts, type OpCtx, type OpDef } from './registry';
import { assumeRoleCore } from './services/sts';
import { pascal } from './util';

export const CLI_VERSION = 'aws-cli/2.27.5 Python/3.13.3 Linux/6.8.0-45-generic exe/x86_64.ubuntu.24';

export interface AwsResult {
  stdout: string;
  stderr: string;
  code: number;
}

const USAGE = `usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]
To see help text, you can run:

  aws help
  aws <command> help
  aws <command> <subcommand> help
`;

const done = (stdout = '', stderr = '', code = 0): AwsResult => ({ stdout, stderr, code });

function chunks(list: string[], width: number): string {
  const w = Math.max(...list.map((x) => x.length)) + 3;
  const per = Math.max(1, Math.floor(width / w) || 1);
  const rows: string[] = [];
  for (let i = 0; i < list.length; i += per) rows.push(list.slice(i, i + per).map((x) => x.padEnd(w)).join('| ').trimEnd());
  return rows.join('\n');
}

function invalidChoice(kind: 'command' | 'operation', word: string, choices: string[], cols: number): AwsResult {
  const sug = suggest(word, choices);
  let msg = `${USAGE}\naws: error: argument ${kind}: Invalid choice, valid choices are:\n\n${chunks(choices, Math.max(40, cols))}\n\n`;
  if (sug.length) msg += `\nInvalid choice: '${word}', maybe you meant:\n\n${sug.map((s) => `  * ${s}`).join('\n')}\n`;
  else msg += `\nInvalid choice: '${word}'\n`;
  return done('', msg, 252);
}

// ───────────────────────── ayuda ─────────────────────────

const typeHint = (t: string) => (t === 's' ? '<value>' : t === 'i' ? '<value>' : t === 'n' ? '<value>' : t === 'l' ? '<value> <value>...' : t === 'b' ? '' : t === 't' || t === 'f' ? '<value> <value>...' : '<value>');

function helpTop(): string {
  return `AWS()                                                                    AWS()

NAME
       aws -

DESCRIPTION
       La interfaz de línea de comandos de AWS (CLI) es una herramienta única
       para administrar todos los servicios de AWS.

SYNOPSIS
            aws [options] <command> <subcommand> [parameters]

       Usa  aws command help  para ver la ayuda de un servicio y
       aws command subcommand help  para ver la de una operación.

OPTIONS
       --debug (boolean)       Salida de depuración.
       --endpoint-url (string) Cambia la URL a la que se envía la petición.
       --no-verify-ssl         No verifica los certificados SSL.
       --no-paginate           Desactiva la paginación automática.
       --output (string)       Formato de salida: json, text, table, yaml, yaml-stream.
       --query (string)        Filtro JMESPath para la salida.
       --profile (string)      Perfil de ~/.aws/credentials o ~/.aws/config.
       --region (string)       Región a la que se envía la petición.
       --version               Muestra la versión de la CLI.

AVAILABLE SERVICES
${servicesList().map((s) => `       o ${s}`).join('\n')}
`;
}

function helpService(svc: string): string {
  const ops = opsOf(svc);
  return `${svc.toUpperCase()}()                                                                ${svc.toUpperCase()}()

NAME
       ${svc} -

DESCRIPTION
       ${SERVICE_SUMMARY[svc] ?? svc}

SYNOPSIS
            aws ${svc} <command> [<args>]

AVAILABLE COMMANDS
${ops.map((o) => `       o ${o.name}`).join('\n')}
`;
}

function helpOp(o: OpDef): string {
  const syn = o.params.map((p) => (p.required ? '' : '[') + `--${p.name}${p.type === 'b' ? '' : ' ' + typeHint(p.type)}` + (p.required ? '' : ']'));
  const NAME = `${o.service.toUpperCase()}-${o.name.toUpperCase()}`;
  return `${NAME}()${' '.repeat(Math.max(1, 72 - NAME.length * 2 - 4))}${NAME}()

NAME
       ${o.name} -

DESCRIPTION
       ${o.summary}

SYNOPSIS
            ${o.service === 'configure' ? 'aws configure' : `aws ${o.service} ${o.name}`}
${syn.map((s) => `          ${s}`).join('\n')}

OPTIONS
${o.params.map((p) => `       --${p.name}${p.type === 'b' ? ' (boolean)' : p.type === 'i' ? ' (integer)' : p.type === 'l' ? ' (list)' : p.type === 't' || p.type === 'f' ? ' (list)' : p.type === 'j' ? ' (structure)' : ' (string)'}${p.required ? '  [obligatorio]' : ''}`).join('\n')}
${o.examples?.length ? `\nEXAMPLES\n${o.examples.map((e) => `       $ ${e}`).join('\n')}\n` : ''}`;
}

function defaultTargets(o: OpDef, c: OpCtx): AuthzTarget[] {
  if (o.authz === false) return [];
  if (o.authz) return o.authz(c);
  const action = o.action ?? iamAction(o.service, o.api);
  const res = o.res ? o.res(c) : '*';
  const context = o.ctx?.(c);
  return (Array.isArray(res) ? res : [res]).map((resource) => ({ action, resource, context }));
}

// ───────────────────────── skeleton ─────────────────────────

function skeleton(o: OpDef): unknown {
  const out: Record<string, unknown> = {};
  for (const p of o.params) {
    if (p.type === 'b') out[p.key] = true;
    else if (p.type === 'i' || p.type === 'n') out[p.key] = 0;
    else if (p.type === 'l') out[p.key] = [''];
    else if (p.type === 't') out[p.key] = [{ Key: '', Value: '' }];
    else if (p.type === 'f') out[p.key] = [{}];
    else if (p.type === 'j') out[p.key] = {};
    else out[p.key] = '';
  }
  return out;
}

// ───────────────────────── paginación ─────────────────────────

function paginate(o: OpDef, data: unknown, opts: GlobalOpts): unknown {
  if (!o.paginate || opts.maxItems === null || typeof data !== 'object' || data === null) return data;
  const d = data as Record<string, unknown>;
  const list = d[o.paginate];
  if (!Array.isArray(list)) return data;
  const start = opts.startingToken ? Number(atob(opts.startingToken)) || 0 : 0;
  const end = start + opts.maxItems;
  const out: Record<string, unknown> = { ...d, [o.paginate]: list.slice(start, end) };
  if (end < list.length) out.NextToken = btoa(String(end));
  return out;
}

// ───────────────────────── ejecución ─────────────────────────

function execAws(argv: string[], io: AwsIO): AwsResult | Promise<AwsResult> {
  let split;
  try {
    split = splitArgs(argv);
  } catch (e) {
    if (e instanceof UsageErr) return done('', `${USAGE}\naws: error: ${e.message}\n`, 252);
    throw e;
  }
  const { service, operation, rest, globals } = split;
  if (globals.version) return done(CLI_VERSION + '\n');
  if (!service) return done('', `${USAGE}\naws: error: the following arguments are required: command\n`, 252);
  if (service === 'help') return done(helpTop());
  const services = servicesList();
  if (!services.includes(service)) return invalidChoice('command', service, services, io.cols);
  if (operation === 'help') return done(helpService(service));
  if (!operation && service !== 'configure') return done('', `${USAGE}\naws: error: the following arguments are required: operation\n`, 252);
  const o: OpDef | undefined = OPS.get(`${service}/${operation ?? '$run'}`);
  let lastOpts: GlobalOpts | undefined;
  if (!o) return invalidChoice('operation', operation ?? '', opsOf(service).map((x) => x.name), io.cols);
  if (rest.length === 1 && rest[0] === 'help') return done(helpOp(o));

  const acct = io.acct;
  acct.clock += 1500;

  try {
    // formato de salida
    const profileFlag = typeof globals.profile === 'string' ? globals.profile : undefined;
    let params = parseOpParams(o, rest, io);

    if ('$generate-cli-skeleton' in params) return done(JSON.stringify(skeleton(o), null, 4) + '\n');
    if ('$cli-input-json' in params) {
      const raw = String(params['$cli-input-json']);
      const text = /^file:\/\//.test(raw) ? io.readFile(io.abs(raw.slice(7))) : raw;
      if (text === null) throw new UsageErr(`Error parsing parameter '--cli-input-json': Unable to load paramfile ${raw}: [Errno 2] No such file or directory: '${raw.slice(7)}'`, 252, false);
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(text);
      } catch (e) {
        throw new UsageErr(`Error parsing parameter '--cli-input-json': Invalid JSON: ${(e as Error).message}`, 252, false);
      }
      const { ['$cli-input-json']: _drop, ...mine } = params;
      void _drop;
      params = { ...j, ...mine };
    }
    for (const p of o.params) if (p.required && params[p.key] === undefined) {
      const missing = o.params.filter((x) => x.required && params[x.key] === undefined).map((x) => `--${x.name}`);
      throw new UsageErr(`the following arguments are required: ${missing.join(', ')}`);
    }

    // credenciales y región
    let resolved: Resolved | null = null;
    let caller: Caller | null = null;
    if (!o.anon && !io.god) {
      resolved = resolveCredentials(io, {
        profile: profileFlag,
        assume: (a, who, roleArn, session, mfa) => {
          const r = assumeRoleCore(a, who, { roleArn, sessionName: session, durationSeconds: 3600, mfa, baseCtx: baseContext(a, who, 'us-east-1') });
          return { AccessKeyId: r.AccessKeyId, token: r.SessionToken };
        },
        auth: (r) => authenticate(acct, r, service),
      });
    }
    const profile = resolved?.profile ?? profileFlag ?? io.env.AWS_PROFILE ?? 'default';
    const region = resolveRegion(io, typeof globals.region === 'string' ? globals.region : undefined, profile) ?? (io.god ? 'us-east-1' : '');
    if (!region && !o.global && !o.anon) throw new CredError('You must specify a region. You can also configure your region by running "aws configure".', 253);
    const outRaw = (typeof globals.output === 'string' ? globals.output : io.env.AWS_DEFAULT_OUTPUT || resolved?.output || 'json') as string;
    if (!OUTPUT_FORMATS.includes(outRaw as OutputFormat)) throw new UsageErr(`argument --output: Invalid choice, valid choices are:\n\n${OUTPUT_FORMATS.join(' | ')}`);
    const opts: GlobalOpts = {
      region: region || 'us-east-1',
      profile,
      output: outRaw,
      query: typeof globals.query === 'string' ? globals.query : null,
      maxItems: typeof globals['max-items'] === 'string' ? parseInt(globals['max-items'], 10) : null,
      startingToken: typeof globals['starting-token'] === 'string' ? globals['starting-token'] : null,
      dryRun: params.DryRun === true,
      noPaginate: !!globals['no-paginate'],
    };
    if (resolved) caller = authenticate(acct, resolved, service);
    if (io.god) caller = { arn: `arn:aws:iam::${acct.id}:root`, account: acct.id, type: 'Account', userId: acct.id, root: true, mfa: true, accessKeyId: 'AKIAGOD', };
    lastOpts = opts;
    const c: OpCtx = { acct, region: opts.region, io, caller: caller as Caller, p: params, opts, service, op: o };

    if (caller && !io.god) {
      authorize(c, defaultTargets(o, c));
      if (o.dryRun && opts.dryRun) throw new AwsError('DryRunOperation', 'Request would have succeeded, but DryRun flag is set.', 412);
    }
    const out = o.handler(c);
    if (out instanceof Promise) return out.then((r) => settle(r), onErr);
    return settle(out);
  } catch (e) {
    return onErr(e);
  }

  function onErr(e: unknown): AwsResult {
    if (e instanceof AwsError) return done('', `\nAn error occurred (${e.code}) when calling the ${o!.api} operation: ${e.message}\n`, 254);
    if (e instanceof UsageErr) return done('', e.showUsage ? `${USAGE}\naws: error: ${e.message}\n` : `\n${e.message}\n`, e.code);
    if (e instanceof CredError) return done('', `\n${e.message}\n`, e.code);
    throw e;
  }

  function settle(raw: unknown): AwsResult {
    try {
      return render(raw);
    } catch (e) {
      return onErr(e);
    }
  }

  function render(raw: unknown): AwsResult {
    let result = raw;
    if (result instanceof Raw) return done(result.text, result.stderr, result.code);
    if (result === undefined) return done();
    // `s3api get-object … /dev/stdout`: primero el contenido y luego los metadatos
    let prefix = '';
    if (typeof result === 'object' && result !== null && '__stdout' in result) {
      const { __stdout, ...meta } = result as Record<string, unknown>;
      prefix = String(__stdout);
      result = meta;
    }
    result = paginate(o!, result, lastOpts!);
    let data: unknown = result;
    if (lastOpts!.query !== null) {
      try {
        data = search(lastOpts!.query, result);
      } catch (e) {
        if (e instanceof JmesError) throw new UsageErr(`Bad value for --query ${lastOpts!.query}: ${e.message}`, 255, false);
        throw e;
      }
    }
    return done(prefix + renderOutput(data, lastOpts!.output as OutputFormat, o!.api));
  }
}

/** Ejecuta `aws …` (las operaciones interactivas, como `aws configure`, necesitan esta versión). */
export async function runAws(argv: string[], io: AwsIO): Promise<AwsResult> {
  return execAws(argv, io);
}

/** Versión síncrona para las comprobaciones de los retos (solo operaciones que no esperan entrada). */
export function runAwsSync(argv: string[], io: AwsIO): AwsResult {
  const r = execAws(argv, io);
  if (r instanceof Promise) throw new Error('operación asíncrona en una comprobación');
  return r;
}

export { pascal, baseContext, authorize };
