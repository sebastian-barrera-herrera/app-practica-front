/** AWS Systems Manager: instancias administradas, Run Command y Session Manager (sin abrir el puerto 22). */
import { regional } from '../account';
import { pathInternet, pathToEndpoint } from '../netpath';
import { webFiles, privateDns, runsWebServer } from '../hosting';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Ec2Instance, SsmCommand, SsmState } from '../types';
import { iso, newId, mkArn, toArr } from '../util';
import { refreshEc2 } from './ec2';
import { roleCan } from './flowlogs';

export const ssmOf = (a: Account, region: string): SsmState => {
  const r = regional(a, region);
  return (r.ssm ??= { commands: {}, sessions: {} });
};

const REGISTER_MS = 120000;

export type SsmReason = 'ok' | 'not-running' | 'no-profile' | 'no-permissions' | 'no-network' | 'registering';

/** ¿Está la instancia «administrada» (en línea) en Systems Manager? Y si no, por qué. */
export function ssmStatus(a: Account, region: string, inst: Ec2Instance, o: { settled?: boolean } = {}): { online: boolean; reason: SsmReason } {
  const r = regional(a, region).ec2;
  if (inst.state !== 'running') return { online: false, reason: 'not-running' };
  const prof = inst.IamInstanceProfile ? a.iam.instanceProfiles[inst.IamInstanceProfile] : undefined;
  const role = prof?.roles[0] ? a.iam.roles[prof.roles[0]] : undefined;
  if (!role) return { online: false, reason: 'no-profile' };
  if (!roleCan(a, role.Arn, ['ssm:UpdateInstanceInformation', 'ssmmessages:CreateControlChannel', 'ec2messages:GetMessages'])) return { online: false, reason: 'no-permissions' };
  // el agente tiene que llegar a tres servicios: por internet (NAT o IP pública) o por tres endpoints de interfaz con DNS privado
  const eps = Object.values(r.endpoints ?? {}).filter((e) => e.VpcId === inst.VpcId && e.VpcEndpointType === 'Interface' && e.State !== 'deleted' && e.PrivateDnsEnabled);
  const viaEndpoints = ['ssm', 'ssmmessages', 'ec2messages'].every((s) => {
    const e = eps.find((x) => x.ServiceName === `com.amazonaws.${region}.${s}`);
    return !!e && pathToEndpoint(a, region, inst, e.VpcEndpointId, 443).reachable;
  });
  if (!viaEndpoints && !pathInternet(a, region, inst, 'out', 'tcp', 443).reachable) return { online: false, reason: 'no-network' };
  if (!o.settled && a.clock - inst.stateAt < REGISTER_MS) return { online: false, reason: 'registering' };
  return { online: true, reason: 'ok' };
}

const arn = (c: Pick<OpCtx, 'acct' | 'region'>, type: string, id = '*') => mkArn('ec2', c.region, c.acct.id, `${type}/${id}`);

// ───────────────────────── instancias administradas ─────────────────────────

op('ssm', 'describe-instance-information', 'filters:f max-results:i', 'Lista las instancias administradas por Systems Manager (las que tienen agente, rol y camino de red).', { paginate: 'InstanceInformationList', action: 'ssm:DescribeInstanceInformation', res: () => '*' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const list = Object.values(r.instances).filter((i) => i.state === 'running' && ssmStatus(c.acct, c.region, i).online);
  const wanted = (c.p.Filters as { Key: string; Values: string[] }[] | undefined)?.find((f) => f.Key === 'InstanceIds')?.Values;
  return {
    InstanceInformationList: list.filter((i) => !wanted || wanted.includes(i.InstanceId)).map((i) => ({
      InstanceId: i.InstanceId,
      PingStatus: 'Online',
      LastPingDateTime: iso(c.acct.clock),
      AgentVersion: '3.3.987.0',
      IsLatestVersion: true,
      PlatformType: 'Linux',
      PlatformName: 'Amazon Linux',
      PlatformVersion: '2023',
      ResourceType: 'EC2Instance',
      IPAddress: i.PrivateIpAddress,
      ComputerName: privateDns(c.region, i.PrivateIpAddress),
      AssociationStatus: 'Success',
    })),
  };
});

// ───────────────────────── Run Command ─────────────────────────

/** Mini intérprete: lo justo para que las órdenes de ejemplo de un administrador respondan como en una instancia web. */
function runLine(a: Account, region: string, inst: Ec2Instance, line: string): { out: string; err: string; code: number } {
  const t = line.trim();
  const ok = (out: string) => ({ out: out.endsWith('\n') || !out ? out : out + '\n', err: '', code: 0 });
  const files = webFiles(inst);
  if (!t) return ok('');
  if (/^echo\b/.test(t)) return ok(t.replace(/^echo\s+/, '').replace(/^["']|["']$/g, ''));
  if (t === 'hostname' || t === 'hostname -f') return ok(privateDns(region, inst.PrivateIpAddress));
  if (t === 'hostname -i' || t === 'hostname -I') return ok(inst.PrivateIpAddress);
  if (t === 'whoami') return ok('root');
  if (t === 'id') return ok('uid=0(root) gid=0(root) groups=0(root)');
  if (t === 'pwd') return ok('/usr/bin');
  if (/^uname/.test(t)) return ok('Linux ' + privateDns(region, inst.PrivateIpAddress) + ' 6.1.102-111.182.amzn2023.x86_64 #1 SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux');
  if (t === 'uptime') return ok(` ${new Date(a.clock).toISOString().slice(11, 19)} up ${Math.max(1, Math.round((a.clock - inst.stateAt) / 60000))} min,  0 users,  load average: 0.00, 0.01, 0.00`);
  if (t === 'date') return ok(new Date(a.clock).toUTCString());
  if (/^cat \/etc\/os-release/.test(t)) return ok('NAME="Amazon Linux"\nVERSION="2023"\nID="amzn"\nVERSION_ID="2023"\nPRETTY_NAME="Amazon Linux 2023"');
  if (/^df\b/.test(t)) return ok('Filesystem      Size  Used Avail Use% Mounted on\n/dev/xvda1      8.0G  1.6G  6.4G  20% /');
  if (/^free\b/.test(t)) return ok('               total        used        free\nMem:         1006428      242388      412172');
  if (/^ls\s+\/var\/www\/html\/?$/.test(t)) return ok(Object.keys(files).join('\n'));
  const cat = /^cat\s+\/var\/www\/html\/([\w./-]+)$/.exec(t);
  if (cat) return files[cat[1]] !== undefined ? ok(files[cat[1]]) : { out: '', err: `cat: /var/www/html/${cat[1]}: No such file or directory\n`, code: 1 };
  if (/^curl\b.*(localhost|127\.0\.0\.1)/.test(t)) {
    if (!runsWebServer(inst)) return { out: '', err: 'curl: (7) Failed to connect to localhost port 80 after 0 ms: Couldn\'t connect to server\n', code: 7 };
    return ok(files['index.html'] ?? '');
  }
  const sys = /^systemctl\s+(status|is-active)\s+(httpd|nginx)/.exec(t);
  if (sys) {
    const up = runsWebServer(inst);
    if (sys[1] === 'is-active') return { out: up ? 'active\n' : 'inactive\n', err: '', code: up ? 0 : 3 };
    return { out: `● ${sys[2]}.service - The ${sys[2]} HTTP Server\n     Loaded: loaded (/usr/lib/systemd/system/${sys[2]}.service; enabled)\n     Active: ${up ? 'active (running)' : 'inactive (dead)'}\n`, err: '', code: up ? 0 : 3 };
  }
  if (/^(yum|dnf)\s+(-y\s+)?(update|upgrade|install|remove|check-update)\b/.test(t)) return ok('Last metadata expiration check: 0:00:12 ago.\nDependencies resolved.\nNothing to do.\nComplete!');
  if (/^sleep\s+\d+/.test(t) || /^(touch|mkdir|chmod|chown|systemctl\s+(start|stop|restart|enable|disable|daemon-reload))\b/.test(t)) return ok('');
  if (/^ps\b/.test(t)) return ok('USER         PID %CPU %MEM COMMAND\nroot           1  0.0  0.4 /usr/lib/systemd/systemd\nroot         812  0.0  0.3 /usr/sbin/sshd -D\nssm-user    1420  0.0  0.5 /usr/bin/amazon-ssm-agent');
  const bin = t.split(/\s+/)[0];
  return { out: '', err: `/bin/sh: line 1: ${bin}: command not found\n`, code: 127 };
}

const cmdView = (x: SsmCommand) => ({
  CommandId: x.CommandId,
  DocumentName: x.DocumentName,
  DocumentVersion: '$DEFAULT',
  Comment: '',
  RequestedDateTime: iso(x.RequestedDateTime),
  Status: x.Status,
  StatusDetails: x.Status,
  Parameters: { commands: x.commands },
  InstanceIds: [x.InstanceId],
  TargetCount: 1,
  CompletedCount: x.Status === 'Success' || x.Status === 'Failed' ? 1 : 0,
  ErrorCount: x.Status === 'Failed' ? 1 : 0,
  ServiceRole: '',
  OutputS3BucketName: '',
  OutputS3KeyPrefix: '',
  MaxConcurrency: '50',
  MaxErrors: '0',
});

export type CmdResult = { out: string; err: string; code: number };
export type CmdRunner = (a: Account, region: string, inst: Ec2Instance, params: Record<string, string[]>) => CmdResult;

/** Documentos de tipo Command que sabe ejecutar el simulador (los demás módulos añaden los suyos: parches, inventario…). */
export const commandDocs: Record<string, CmdRunner> = {
  'AWS-RunShellScript': (a, region, inst, params) => {
    const lines = params.commands ?? [];
    let out = '';
    let err = '';
    let code = 0;
    for (const line of lines) {
      const res = runLine(a, region, inst, line);
      out += res.out;
      err += res.err;
      code = res.code;
      if (res.code !== 0) break;
    }
    return { out, err, code };
  },
};

/** Documentos propios del alumno (los registra `ssmdocs.ts`). */
export const customCommandDoc: { find?: (a: Account, region: string, name: string) => CmdRunner | undefined } = {};

/** El shorthand de la CLI deja `Values=a` como texto suelto: lo normaliza a listas. */
export const normTargets = (raw: unknown): { Key: string; Values: string[] }[] => toArr<{ Key: string; Values?: string | string[] }>(raw as never).map((t) => ({ Key: t.Key, Values: toArr<string>(t.Values as string | string[]) }));

/** Expande una orden con `Targets` (`InstanceIds` o `tag:Nombre`) a los ids de instancia. */
export function resolveTargets(a: Account, region: string, ids: string[], targets: { Key: string; Values: string[] | string }[] | undefined): string[] {
  const r = refreshEc2(a, region);
  let out = [...ids];
  for (const t of normTargets(targets)) {
    if (t.Key === 'InstanceIds') out = out.concat(t.Values);
    else if (t.Key.startsWith('tag:')) out = out.concat(Object.values(r.instances).filter((i) => i.state === 'running' && i.Tags.some((x) => x.Key === t.Key.slice(4) && t.Values.includes(x.Value))).map((i) => i.InstanceId));
  }
  return [...new Set(out)];
}

const normParams = (raw: unknown): Record<string, string[]> =>
  Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]));

/** Ejecuta un documento de comandos en unas instancias (Run Command). Lo usan la CLI, las ventanas de mantenimiento y las asociaciones. */
export function sendCommand(a: Account, region: string, docName: string, rawParams: unknown, ids: string[], o: { comment?: string } = {}): { commandId: string; list: SsmCommand[] } {
  const runner = commandDocs[docName] ?? customCommandDoc.find?.(a, region, docName);
  if (!runner) throw new AwsError('InvalidDocument', `Document ${docName} does not exist or is not a Command document.`, 400);
  const params = normParams(rawParams);
  if (docName === 'AWS-RunShellScript' && !(params.commands ?? []).length) throw new AwsError('InvalidParameters', 'Parameter commands is required for document AWS-RunShellScript.', 400);
  const r = refreshEc2(a, region);
  const s = ssmOf(a, region);
  const cid = newId(a, 'ssmcmd', '', 36, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  const list: SsmCommand[] = [];
  for (const iid of ids) {
    const inst = r.instances[iid];
    if (!inst || inst.state === 'terminated') throw new AwsError('InvalidInstanceId', `Instances not in a valid state for account ${a.id}`, 400);
    if (!ssmStatus(a, region, inst).online) throw new AwsError('InvalidInstanceId', `Instances [[${iid}]] not in a valid state for account ${a.id}`, 400);
    const res = runner(a, region, inst, params);
    const cmd: SsmCommand = { CommandId: cid, InstanceId: iid, DocumentName: docName, commands: params.commands ?? [], RequestedDateTime: a.clock, Status: res.code === 0 ? 'Success' : 'Failed', StandardOutputContent: res.out, StandardErrorContent: res.err, ResponseCode: res.code };
    s.commands[`${cid}:${iid}`] = cmd;
    list.push(cmd);
  }
  void o;
  return { commandId: cid, list };
}

op('ssm', 'send-command', 'document-name:s! instance-ids:l targets:f parameters:j comment:s timeout-seconds:i', 'Ejecuta un documento (por defecto `AWS-RunShellScript` con el parámetro `commands`) en instancias administradas. Sin SSH ni puerto 22.', { action: 'ssm:SendCommand', res: (c) => ((c.p.InstanceIds as string[] | undefined) ?? []).map((i) => arn(c, 'instance', i)).concat(mkArn('ssm', c.region, '', `document/${c.p.DocumentName}`)) }, (c) => {
  const ids = resolveTargets(c.acct, c.region, c.p.InstanceIds ?? [], c.p.Targets);
  if (!ids.length) throw new AwsError('ValidationException', 'You must specify InstanceIds or Targets.', 400);
  const { list } = sendCommand(c.acct, c.region, String(c.p.DocumentName), c.p.Parameters, ids, { comment: c.p.Comment });
  return { Command: { ...cmdView(list[list.length - 1]), InstanceIds: ids, TargetCount: ids.length, Status: 'Pending', StatusDetails: 'Pending', Comment: c.p.Comment ?? '' } };
});

const inv = (x: SsmCommand) => ({
  CommandId: x.CommandId,
  InstanceId: x.InstanceId,
  DocumentName: x.DocumentName,
  Status: x.Status,
  StatusDetails: x.Status,
  ResponseCode: x.ResponseCode,
  StandardOutputContent: x.StandardOutputContent,
  StandardErrorContent: x.StandardErrorContent,
  StandardOutputUrl: '',
  StandardErrorUrl: '',
  ExecutionStartDateTime: iso(x.RequestedDateTime + 1000),
  ExecutionEndDateTime: iso(x.RequestedDateTime + 2000),
});

op('ssm', 'get-command-invocation', 'command-id:s! instance-id:s! plugin-name:s', 'Resultado de un comando en una instancia (salida, error y código de salida).', { action: 'ssm:GetCommandInvocation', res: () => '*' }, (c) => {
  const x = ssmOf(c.acct, c.region).commands[`${c.p.CommandId}:${c.p.InstanceId}`];
  if (!x) throw new AwsError('InvocationDoesNotExist', 'An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation', 400);
  return inv(x);
});

op('ssm', 'list-command-invocations', 'command-id:s instance-id:s details:b', 'Lista las ejecuciones de comandos (con `--details` incluye la salida).', { paginate: 'CommandInvocations', action: 'ssm:ListCommandInvocations', res: () => '*' }, (c) => ({
  CommandInvocations: Object.values(ssmOf(c.acct, c.region).commands).filter((x) => (!c.p.CommandId || x.CommandId === c.p.CommandId) && (!c.p.InstanceId || x.InstanceId === c.p.InstanceId)).map((x) => ({ CommandId: x.CommandId, InstanceId: x.InstanceId, DocumentName: x.DocumentName, RequestedDateTime: iso(x.RequestedDateTime), Status: x.Status, StatusDetails: x.Status, ...(c.p.Details ? { CommandPlugins: [{ Name: 'aws:runShellScript', Status: x.Status, ResponseCode: x.ResponseCode, Output: x.StandardOutputContent + x.StandardErrorContent }] } : {}) })),
}));

op('ssm', 'list-commands', 'command-id:s instance-id:s', 'Lista los comandos enviados.', { paginate: 'Commands', action: 'ssm:ListCommands', res: () => '*' }, (c) => {
  const seen = new Set<string>();
  const out: ReturnType<typeof cmdView>[] = [];
  for (const x of Object.values(ssmOf(c.acct, c.region).commands)) {
    if ((c.p.CommandId && x.CommandId !== c.p.CommandId) || (c.p.InstanceId && x.InstanceId !== c.p.InstanceId) || seen.has(x.CommandId)) continue;
    seen.add(x.CommandId);
    out.push(cmdView(x));
  }
  return { Commands: out };
});

// ───────────────────────── Session Manager ─────────────────────────

op('ssm', 'start-session', 'target:s! document-name:s', 'Abre una sesión de shell con una instancia sin SSH: va por HTTPS y se controla con IAM (y queda registrada).', { action: 'ssm:StartSession', res: (c) => arn(c, 'instance', c.p.Target) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const inst = r.instances[c.p.Target];
  if (!inst || inst.state === 'terminated') throw new AwsError('TargetNotConnected', `${c.p.Target} is not connected.`, 400);
  if (!ssmStatus(c.acct, c.region, inst).online) throw new AwsError('TargetNotConnected', `${c.p.Target} is not connected.`, 400);
  const id = `${c.caller.arn.split('/').pop() ?? 'user'}-${newId(c.acct, 'ssmsess', '', 17, 'hex')}`;
  ssmOf(c.acct, c.region).sessions[id] = { SessionId: id, Target: inst.InstanceId, Owner: c.caller.arn, StartDate: c.acct.clock, Status: 'Connected' };
  return { SessionId: id, TokenValue: newId(c.acct, 'ssmtok', '', 40, 'hex'), StreamUrl: `wss://ssmmessages.${c.region}.amazonaws.com/v1/data-channel/${id}?role=publish_subscribe` };
});

op('ssm', 'describe-sessions', 'state:s! filters:f', 'Lista las sesiones activas o pasadas.', { paginate: 'Sessions', action: 'ssm:DescribeSessions', res: () => '*' }, (c) => {
  const want = c.p.State === 'Active' ? 'Connected' : 'Terminated';
  return { Sessions: Object.values(ssmOf(c.acct, c.region).sessions).filter((s) => s.Status === want).map((s) => ({ SessionId: s.SessionId, Target: s.Target, Status: s.Status, StartDate: iso(s.StartDate), Owner: s.Owner, DocumentName: 'SSM-SessionManagerRunShell' })) };
});

op('ssm', 'terminate-session', 'session-id:s!', 'Cierra una sesión.', { action: 'ssm:TerminateSession', res: () => '*' }, (c) => {
  const s = ssmOf(c.acct, c.region).sessions[c.p.SessionId];
  if (!s) throw new AwsError('DoesNotExistException', `Session ${c.p.SessionId} does not exist.`, 400);
  s.Status = 'Terminated';
  return { SessionId: s.SessionId };
});
