/** VPC Flow Logs (registros de tráfico) y Reachability Analyzer (analizador de conectividad de la red). */
import { regional } from '../account';
import { evaluate, principalPolicies } from '../policy';
import { pathBetween, pathFromInstance, pathInternet, pathToEndpoint, eniOfInstance, instanceById, type PathResult } from '../netpath';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Ec2Instance, Ec2Region, FlowLog, InsightsAnalysis, InsightsPath } from '../types';
import { cidrContainsIp, ec2Id, iso, mkArn, stableId } from '../util';
import { filterOk, refreshEc2, tagGetter, tagsFor } from './ec2';
import { logsPut } from './logs';
import { getBucket, s3Current, s3Put } from './s3';

const arn = (c: Pick<OpCtx, 'acct' | 'region'>, type: string, id = '*') => mkArn('ec2', c.region, c.acct.id, `${type}/${id}`);
const flows = (r: Ec2Region) => (r.flowLogs ??= {});

// ───────────────────────── entrega ─────────────────────────

/** ¿Puede ese rol (ARN) hacer esas acciones? Sirve para ver si el servicio podrá escribir los registros. */
export function roleCan(a: Account, roleArn: string, actions: string[], resource = '*'): boolean {
  const pp = principalPolicies(a, roleArn);
  if (!pp) return false;
  return actions.every((action) => evaluate({ action, resource, principalArn: roleArn, principalAccount: a.id, policies: pp.policies, root: pp.root }).decision === 'allowed');
}

/** ¿Confía el rol en ese servicio (`vpc-flow-logs.amazonaws.com`, `ssm.amazonaws.com`…)? */
export function roleTrusts(a: Account, roleArn: string, service: string): boolean {
  const name = roleArn.split('/').pop() ?? '';
  const role = a.iam.roles[name];
  if (!role) return false;
  const st = role.AssumeRolePolicyDocument.Statement;
  return (Array.isArray(st) ? st : [st]).some((s) => {
    const p = (s.Principal as { Service?: string | string[] } | undefined)?.Service;
    return s.Effect === 'Allow' && (Array.isArray(p) ? p : [p]).includes(service);
  });
}

/** Estado de la entrega de un flow log: `null` si va bien o el motivo del fallo. */
export function deliveryError(a: Account, f: FlowLog): string | null {
  if (f.LogDestinationType === 's3') {
    const bucket = (f.LogDestination ?? '').replace('arn:aws:s3:::', '').split('/')[0];
    return a.s3?.buckets?.[bucket] ? null : 'LogDestination: ' + bucket + ' does not exist';
  }
  const role = f.DeliverLogsPermissionArn ?? '';
  if (!roleTrusts(a, role, 'vpc-flow-logs.amazonaws.com') || !roleCan(a, role, ['logs:CreateLogStream', 'logs:PutLogEvents'])) return 'Access error';
  return null;
}

const FIELDS: Record<string, (e: FlowEvent, a: Account, r: Ec2Region, start: number) => string> = {
  version: () => '2',
  'account-id': (_e, a) => a.id,
  'interface-id': (e) => eniOfInstance(e.inst),
  srcaddr: (e) => e.srcIp,
  dstaddr: (e) => e.dstIp,
  srcport: (e) => String(e.srcPort),
  dstport: (e) => String(e.dstPort),
  protocol: (e) => String(e.proto),
  packets: (e) => String(e.packets ?? 6),
  bytes: (e) => String(e.bytes ?? 520),
  start: (_e, _a, _r, s) => String(Math.floor(s / 1000)),
  end: (_e, _a, _r, s) => String(Math.floor(s / 1000) + 60),
  action: (e) => (e.accepted ? 'ACCEPT' : 'REJECT'),
  'log-status': () => 'OK',
  'vpc-id': (e) => e.inst.VpcId,
  'subnet-id': (e) => e.inst.SubnetId,
  'instance-id': (e) => e.inst.InstanceId,
  'pkt-srcaddr': (e) => e.srcIp,
  'pkt-dstaddr': (e) => e.dstIp,
  'flow-direction': (e) => e.direction,
  'tcp-flags': (e) => (e.proto === 6 ? (e.accepted ? '2' : '2') : '0'),
  type: () => 'IPv4',
  'az-id': (e) => e.inst.AvailabilityZone,
  region: () => '',
  'traffic-path': () => '-',
};

export const DEFAULT_FORMAT = '${version} ${account-id} ${interface-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${action} ${log-status}';

export interface FlowEvent {
  inst: Ec2Instance;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  /** Número de protocolo IANA (6 tcp, 17 udp, 1 icmp). */
  proto: number;
  accepted: boolean;
  direction: 'ingress' | 'egress';
  packets?: number;
  bytes?: number;
}

const covers = (f: FlowLog, e: FlowEvent) => f.ResourceId === e.inst.VpcId || f.ResourceId === e.inst.SubnetId || f.ResourceId === eniOfInstance(e.inst);

/** Anota un paso de tráfico en todos los flow logs que cubren la instancia (si la entrega funciona). */
export function emitFlow(a: Account, region: string, e: FlowEvent): void {
  const r = regional(a, region).ec2;
  for (const f of Object.values(flows(r))) {
    if (!covers(f, e) || (f.TrafficType !== 'ALL' && f.TrafficType !== (e.accepted ? 'ACCEPT' : 'REJECT'))) continue;
    if (deliveryError(a, f)) continue;
    const start = a.clock - (a.clock % 60000);
    const line = f.LogFormat.replace(/\$\{([a-z-]+)\}/g, (_m, k: string) => (FIELDS[k] ? FIELDS[k](e, a, r, start) : '-'));
    if (f.LogDestinationType === 'cloud-watch-logs') {
      logsPut(a, region, f.LogGroupName ?? 'flow-logs', `${eniOfInstance(e.inst)}-${f.TrafficType.toLowerCase()}`, line, a.clock);
    } else {
      const bucket = getBucket(a, (f.LogDestination ?? '').replace('arn:aws:s3:::', '').split('/')[0]);
      const day = iso(a.clock).slice(0, 10).replace(/-/g, '/');
      const prefix = (f.LogDestination ?? '').replace('arn:aws:s3:::', '').split('/').slice(1).join('/');
      const key = `${prefix ? prefix.replace(/\/$/, '') + '/' : ''}AWSLogs/${a.id}/vpcflowlogs/${region}/${day}/${a.id}_vpcflowlogs_${region}_${f.FlowLogId}_${iso(a.clock).slice(0, 10).replace(/-/g, '')}.log`;
      const cur = s3Current(bucket, key);
      s3Put(a, bucket, key, (cur ? cur.body + '\n' : '') + line, { contentType: 'text/plain' });
    }
  }
}

// ───────────────────────── flow logs ─────────────────────────

const flowView = (c: OpCtx, f: FlowLog) => {
  const err = deliveryError(c.acct, f);
  return {
    CreationTime: f.CreationTime,
    DeliverLogsStatus: err ? 'FAILED' : 'SUCCESS',
    ...(err ? { DeliverLogsErrorMessage: err } : {}),
    ...(f.DeliverLogsPermissionArn ? { DeliverLogsPermissionArn: f.DeliverLogsPermissionArn } : {}),
    FlowLogId: f.FlowLogId,
    FlowLogStatus: 'ACTIVE',
    ...(f.LogGroupName ? { LogGroupName: f.LogGroupName } : {}),
    ResourceId: f.ResourceId,
    TrafficType: f.TrafficType,
    LogDestinationType: f.LogDestinationType,
    ...(f.LogDestination ? { LogDestination: f.LogDestination } : {}),
    LogFormat: f.LogFormat,
    Tags: f.Tags,
    MaxAggregationInterval: f.MaxAggregationInterval,
  };
};

export function ec2CreateFlowLog(a: Account, region: string, o: { resourceId: string; traffic?: FlowLog['TrafficType']; group?: string; role?: string; s3?: string; format?: string; tags?: FlowLog['Tags'] }): FlowLog {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'fl');
  flows(r)[id] = {
    FlowLogId: id,
    ResourceId: o.resourceId,
    TrafficType: o.traffic ?? 'ALL',
    LogDestinationType: o.s3 ? 's3' : 'cloud-watch-logs',
    ...(o.s3 ? { LogDestination: o.s3 } : { LogGroupName: o.group ?? 'vpc-flow-logs', DeliverLogsPermissionArn: o.role }),
    LogFormat: o.format ?? DEFAULT_FORMAT,
    MaxAggregationInterval: 600,
    CreationTime: iso(a.clock),
    Tags: o.tags ?? [],
  };
  return flows(r)[id];
}

op('ec2', 'create-flow-logs', 'resource-ids:l! resource-type:s! traffic-type:s deliver-logs-permission-arn:s log-group-name:s log-destination-type:s log-destination:s log-format:s max-aggregation-interval:i tag-specifications:f dry-run:b', 'Crea un flow log: registra el tráfico (aceptado o rechazado) de una VPC, una subred o una interfaz de red.', { dryRun: true, res: (c) => arn(c, 'vpc-flow-log') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const type = String(c.p.ResourceType);
  if (!['VPC', 'Subnet', 'NetworkInterface'].includes(type)) throw new AwsError('InvalidParameterValue', `Value (${type}) for parameter resourceType is invalid. Valid values: VPC | Subnet | NetworkInterface`, 400);
  if (!c.p.TrafficType) throw new AwsError('MissingParameter', 'The request must contain the parameter TrafficType (ACCEPT | REJECT | ALL).', 400);
  const traffic = String(c.p.TrafficType).toUpperCase() as FlowLog['TrafficType'];
  if (!['ACCEPT', 'REJECT', 'ALL'].includes(traffic)) throw new AwsError('InvalidParameterValue', `Value (${c.p.TrafficType}) for parameter trafficType is invalid. Valid values: ACCEPT | REJECT | ALL`, 400);
  const dest = c.p.LogDestinationType ?? 'cloud-watch-logs';
  if (!['cloud-watch-logs', 's3'].includes(dest)) throw new AwsError('InvalidParameterValue', `Value (${dest}) for parameter logDestinationType is invalid. Valid values: cloud-watch-logs | s3 | kinesis-data-firehose`, 400);
  if (dest === 'cloud-watch-logs' && !c.p.DeliverLogsPermissionArn) throw new AwsError('InvalidParameter', 'DeliverLogsPermissionArn can not be empty if LogDestinationType is cloud-watch-logs.', 400);
  if (dest === 'cloud-watch-logs' && !c.p.LogGroupName && !c.p.LogDestination) throw new AwsError('InvalidParameter', 'LogGroupName can not be empty if LogDestinationType is cloud-watch-logs.', 400);
  if (dest === 's3' && !c.p.LogDestination) throw new AwsError('InvalidParameter', 'LogDestination can not be empty if LogDestinationType is s3.', 400);
  const fmt = c.p.LogFormat ? String(c.p.LogFormat) : DEFAULT_FORMAT;
  for (const m of fmt.matchAll(/\$\{([^}]*)\}/g)) if (!FIELDS[m[1]]) throw new AwsError('InvalidParameter', `Unknown field in log format: ${m[1]}`, 400);
  const ids: string[] = [];
  const unsuccessful: unknown[] = [];
  for (const rid of c.p.ResourceIds as string[]) {
    const exists = type === 'VPC' ? r.vpcs[rid] : type === 'Subnet' ? r.subnets[rid] : instanceById(c.acct, rid);
    if (!exists || !rid.startsWith(type === 'VPC' ? 'vpc-' : type === 'Subnet' ? 'subnet-' : 'eni-')) {
      unsuccessful.push({ ResourceId: rid, Error: { Code: 'InvalidParameter', Message: `Resource ${rid} does not exist or is not a ${type}.` } });
      continue;
    }
    const f = ec2CreateFlowLog(c.acct, c.region, { resourceId: rid, traffic, group: c.p.LogGroupName, role: c.p.DeliverLogsPermissionArn, s3: dest === 's3' ? c.p.LogDestination : undefined, format: fmt, tags: tagsFor(c.p.TagSpecifications, 'vpc-flow-log') });
    if (c.p.MaxAggregationInterval) f.MaxAggregationInterval = c.p.MaxAggregationInterval;
    ids.push(f.FlowLogId);
  }
  return { ClientToken: stableId(c.acct.id + ids.join(), '', 28), FlowLogIds: ids, Unsuccessful: unsuccessful };
});

op('ec2', 'describe-flow-logs', 'flow-log-ids:l filter:f dry-run:b', 'Lista los flow logs y si la entrega funciona (DeliverLogsStatus).', { dryRun: true, paginate: 'FlowLogs' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return { FlowLogs: Object.values(flows(r)).filter((f) => (!c.p.FlowLogIds || c.p.FlowLogIds.includes(f.FlowLogId)) && filterOk(c.p.Filter, (n) => (n === 'resource-id' ? [f.ResourceId] : n === 'traffic-type' ? [f.TrafficType] : n === 'log-destination-type' ? [f.LogDestinationType] : n === 'flow-log-id' ? [f.FlowLogId] : tagGetter(f.Tags)(n)))).map((f) => flowView(c, f)) };
});

op('ec2', 'delete-flow-logs', 'flow-log-ids:l! dry-run:b', 'Borra flow logs (los registros ya entregados se conservan en su destino).', { dryRun: true, res: (c) => arn(c, 'vpc-flow-log') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const bad: unknown[] = [];
  for (const id of c.p.FlowLogIds as string[]) {
    if (flows(r)[id]) delete flows(r)[id];
    else bad.push({ ResourceId: id, Error: { Code: 'InvalidFlowLogId.NotFound', Message: `Flow log ${id} is not found` } });
  }
  return { Unsuccessful: bad };
});

// ───────────────────────── Reachability Analyzer ─────────────────────────

const paths = (r: Ec2Region) => (r.insightsPaths ??= {});
const analyses = (r: Ec2Region) => (r.insightsAnalyses ??= {});

const pathView = (c: OpCtx, p: InsightsPath) => ({
  NetworkInsightsPathId: p.NetworkInsightsPathId,
  NetworkInsightsPathArn: mkArn('ec2', c.region, c.acct.id, `network-insights-path/${p.NetworkInsightsPathId}`),
  CreatedDate: p.CreatedDate,
  Source: p.Source,
  ...(p.Destination ? { Destination: p.Destination } : {}),
  ...(p.DestinationIp ? { DestinationIp: p.DestinationIp } : {}),
  Protocol: p.Protocol,
  ...(p.DestinationPort ? { DestinationPort: p.DestinationPort } : {}),
  Tags: p.Tags,
});

const isPrivate = (ip: string) => cidrContainsIp('10.0.0.0/8', ip) || cidrContainsIp('172.16.0.0/12', ip) || cidrContainsIp('192.168.0.0/16', ip);

/** Hace el análisis (solo mira la configuración; no envía paquetes). */
export function analyze(a: Account, region: string, p: InsightsPath): { found: boolean; forward: string[]; explanations: InsightsAnalysis['explanations'] } {
  const r = regional(a, region).ec2;
  const proto = (p.Protocol === 'udp' ? 'udp' : 'tcp') as 'tcp' | 'udp';
  const port = p.DestinationPort ?? 0;
  const src = p.Source.startsWith('igw-') ? null : instanceById(a, p.Source);
  let res: PathResult;
  if (p.Source.startsWith('igw-')) {
    const dst = p.Destination ? instanceById(a, p.Destination) : null;
    if (!dst) throw new AwsError('InvalidParameterValue', 'When the source is an internet gateway, the destination must be an instance or a network interface.', 400);
    res = pathInternet(a, region, dst.inst, 'in', proto, port);
  } else if (!src) {
    throw new AwsError('InvalidParameterValue', `The source ${p.Source} is not an instance, a network interface or an internet gateway.`, 400);
  } else if (p.Destination?.startsWith('vpce-')) {
    res = pathToEndpoint(a, region, src.inst, p.Destination, port || 443);
  } else if (p.Destination?.startsWith('igw-')) {
    res = pathInternet(a, region, src.inst, 'out', proto, port, p.DestinationIp);
  } else if (p.Destination) {
    const dst = instanceById(a, p.Destination);
    if (!dst) throw new AwsError('InvalidParameterValue', `The destination ${p.Destination} is not supported by this analyzer.`, 400);
    res = pathBetween(a, region, src.inst, dst.inst, proto, port);
  } else if (p.DestinationIp) {
    const ip = p.DestinationIp;
    const dstInst = Object.values(r.instances).find((i) => i.state !== 'terminated' && i.PrivateIpAddress === ip) ?? null;
    res = dstInst ? pathBetween(a, region, src.inst, dstInst, proto, port) : isPrivate(ip) ? pathFromInstance(a, region, src.inst, ip, null, proto, port) : pathInternet(a, region, src.inst, 'out', proto, port, ip);
  } else {
    throw new AwsError('InvalidParameterValue', 'A path needs a destination or a destination IP address.', 400);
  }
  if (res.reachable) return { found: true, forward: res.path, explanations: [] };
  return { found: false, forward: res.path, explanations: [{ code: res.code ?? 'UNKNOWN', component: res.component ?? blockerComponent(a, region, res, src?.inst, p), detail: res.why ?? '' }] };
}

/** Recurso que causa el bloqueo cuando el trazador no lo nombra (rutas, NACL y grupos de la VPC). */
function blockerComponent(a: Account, region: string, res: PathResult, src: Ec2Instance | undefined, p: InsightsPath): string | undefined {
  const r = regional(a, region).ec2;
  const dst = p.Destination ? instanceById(a, p.Destination)?.inst : undefined;
  const inst = src ?? dst;
  const outbound = res.hops.at(-1)?.step.includes('salida');
  switch (res.blocker) {
    case 'sg': return (outbound ? src : dst ?? src)?.SecurityGroupIds[0];
    case 'nacl': {
      const sn = (outbound ? src : dst ?? src)?.SubnetId;
      return Object.values(r.networkAcls).find((n) => n.subnets.includes(sn ?? ''))?.NetworkAclId;
    }
    case 'igw': return Object.values(r.internetGateways).find((g) => g.VpcId === inst?.VpcId)?.InternetGatewayId ?? inst?.VpcId;
    case 'route': return Object.values(r.routeTables).find((t) => t.associations.some((x) => x.SubnetId === src?.SubnetId))?.RouteTableId;
    default: return inst?.InstanceId;
  }
}

op('ec2', 'create-network-insights-path', 'source:s! destination:s destination-ip:s protocol:s! destination-port:i source-ip:s tag-specifications:f dry-run:b client-token:s', 'Define un camino que analizar: de un origen (instancia, interfaz o puerta de internet) a un destino (instancia, endpoint o IP) por un protocolo y puerto.', { dryRun: true, res: (c) => arn(c, 'network-insights-path') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!['tcp', 'udp'].includes(String(c.p.Protocol))) throw new AwsError('InvalidParameterValue', `Value (${c.p.Protocol}) for parameter protocol is invalid. Valid values: tcp | udp`, 400);
  if (!c.p.Destination && !c.p.DestinationIp) throw new AwsError('MissingParameter', 'The request must contain the parameter Destination or DestinationIp.', 400);
  const id = ec2Id(c.acct, 'nip');
  const p: InsightsPath = { NetworkInsightsPathId: id, Source: c.p.Source, Destination: c.p.Destination, DestinationIp: c.p.DestinationIp, Protocol: c.p.Protocol, DestinationPort: c.p.DestinationPort, CreatedDate: iso(c.acct.clock), Tags: tagsFor(c.p.TagSpecifications, 'network-insights-path') };
  paths(r)[id] = p;
  return { NetworkInsightsPath: pathView(c, p) };
});

op('ec2', 'describe-network-insights-paths', 'network-insights-path-ids:l filters:f dry-run:b', 'Lista los caminos definidos.', { dryRun: true, paginate: 'NetworkInsightsPaths' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return { NetworkInsightsPaths: Object.values(paths(r)).filter((p) => !c.p.NetworkInsightsPathIds || c.p.NetworkInsightsPathIds.includes(p.NetworkInsightsPathId)).map((p) => pathView(c, p)) };
});

op('ec2', 'delete-network-insights-path', 'network-insights-path-id:s! dry-run:b', 'Borra un camino (y sus análisis).', { dryRun: true, res: (c) => arn(c, 'network-insights-path', c.p.NetworkInsightsPathId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!paths(r)[c.p.NetworkInsightsPathId]) throw new AwsError('InvalidNetworkInsightsPathId.NotFound', `The network insights path '${c.p.NetworkInsightsPathId}' does not exist.`, 400);
  delete paths(r)[c.p.NetworkInsightsPathId];
  for (const [k, v] of Object.entries(analyses(r))) if (v.NetworkInsightsPathId === c.p.NetworkInsightsPathId) delete analyses(r)[k];
  return { NetworkInsightsPathId: c.p.NetworkInsightsPathId };
});

const component = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => {
  const t = id.startsWith('i-') ? 'instance' : id.startsWith('sg-') ? 'security-group' : id.startsWith('acl-') ? 'network-acl' : id.startsWith('rtb-') ? 'route-table' : id.startsWith('igw-') ? 'internet-gateway' : id.startsWith('subnet-') ? 'subnet' : id.startsWith('vpce-') ? 'vpc-endpoint' : id.startsWith('pcx-') ? 'vpc-peering-connection' : id.startsWith('tgw-') ? 'transit-gateway' : id.startsWith('vgw-') ? 'vpn-gateway' : 'network-interface';
  return { Id: id, Arn: mkArn('ec2', c.region, c.acct.id, `${t}/${id}`) };
};

const analysisView = (c: OpCtx, x: InsightsAnalysis) => ({
  NetworkInsightsAnalysisId: x.NetworkInsightsAnalysisId,
  NetworkInsightsAnalysisArn: mkArn('ec2', c.region, c.acct.id, `network-insights-analysis/${x.NetworkInsightsAnalysisId}`),
  NetworkInsightsPathId: x.NetworkInsightsPathId,
  StartDate: x.StartDate,
  Status: 'succeeded',
  NetworkPathFound: x.NetworkPathFound,
  ForwardPathComponents: x.forward.filter(Boolean).map((id, i) => ({ SequenceNumber: i + 1, Component: component(c, id) })),
  Explanations: x.explanations.map((e) => {
    const sgs = e.component?.startsWith('sg-') ? { SecurityGroups: [component(c, e.component)] } : {};
    const acl = e.component?.startsWith('acl-') ? { Acl: component(c, e.component) } : {};
    const rt = e.component?.startsWith('rtb-') ? { RouteTable: component(c, e.component) } : {};
    return { ExplanationCode: e.code, ...(e.component ? { Component: component(c, e.component) } : {}), ...sgs, ...acl, ...rt };
  }),
  Tags: [],
});

op('ec2', 'start-network-insights-analysis', 'network-insights-path-id:s! tag-specifications:f dry-run:b client-token:s', 'Analiza un camino: dice si hay conectividad y, si no, qué componente la corta (sin enviar ningún paquete).', { dryRun: true, res: (c) => arn(c, 'network-insights-analysis') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const p = paths(r)[c.p.NetworkInsightsPathId];
  if (!p) throw new AwsError('InvalidNetworkInsightsPathId.NotFound', `The network insights path '${c.p.NetworkInsightsPathId}' does not exist.`, 400);
  const out = analyze(c.acct, c.region, p);
  const id = ec2Id(c.acct, 'nia');
  const x: InsightsAnalysis = { NetworkInsightsAnalysisId: id, NetworkInsightsPathId: p.NetworkInsightsPathId, StartDate: iso(c.acct.clock), NetworkPathFound: out.found, forward: out.forward, explanations: out.explanations };
  analyses(r)[id] = x;
  return { NetworkInsightsAnalysis: analysisView(c, x) };
});

op('ec2', 'describe-network-insights-analyses', 'network-insights-analysis-ids:l network-insights-path-id:s filters:f dry-run:b', 'Resultados de los análisis (NetworkPathFound y las explicaciones).', { dryRun: true, paginate: 'NetworkInsightsAnalyses' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return { NetworkInsightsAnalyses: Object.values(analyses(r)).filter((x) => (!c.p.NetworkInsightsAnalysisIds || c.p.NetworkInsightsAnalysisIds.includes(x.NetworkInsightsAnalysisId)) && (!c.p.NetworkInsightsPathId || c.p.NetworkInsightsPathId === x.NetworkInsightsPathId)).map((x) => analysisView(c, x)) };
});

op('ec2', 'delete-network-insights-analysis', 'network-insights-analysis-id:s! dry-run:b', 'Borra un análisis.', { dryRun: true, res: (c) => arn(c, 'network-insights-analysis', c.p.NetworkInsightsAnalysisId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!analyses(r)[c.p.NetworkInsightsAnalysisId]) throw new AwsError('InvalidNetworkInsightsAnalysisId.NotFound', `The network insights analysis '${c.p.NetworkInsightsAnalysisId}' does not exist.`, 400);
  delete analyses(r)[c.p.NetworkInsightsAnalysisId];
  return { NetworkInsightsAnalysisId: c.p.NetworkInsightsAnalysisId };
});

