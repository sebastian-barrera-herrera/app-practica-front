/**
 * `kubectl` (simulado): el cliente de Kubernetes. Lee ~/.kube/config (lo que escribe `aws eks update-kubeconfig`), pide el token con
 * `aws eks get-token`, se identifica ante el clúster y permite desplegar y consultar aplicaciones.
 */
import { defineCommand, type Ctx } from '../engine/registry';
import { md5 } from '../engine/commands/hash';
import { ioFromCtx } from './command';
import { runAwsSync } from './cli';
import { clusterNodes, fargateNodes, hashOf, k8sSync, lbHostname, matches, newPod, podReady, podStatus, terminate, type K8sNode } from './k8s';
import { elb } from './services/elb';
import { k8sAccess, parseEksToken, principalOf, readKubeconfig } from './services/eks';
import { awsAccountOf } from './state';
import { tick } from './tick';
import type { Account } from './types';
import type { AwsIO, Caller } from './registry';
import type { EksCluster, K8sContainer, K8sDeployment, K8sPod, K8sService } from './types-containers';
import { dumpYaml, parseTemplate } from './yaml';

class KErr extends Error {
  constructor(msg: string, public code = 1) {
    super(msg);
  }
}

const KINDS: Record<string, string> = { po: 'pods', pod: 'pods', pods: 'pods', deploy: 'deployments', deployment: 'deployments', deployments: 'deployments', 'deployment.apps': 'deployments', 'deployments.apps': 'deployments', svc: 'services', service: 'services', services: 'services', no: 'nodes', node: 'nodes', nodes: 'nodes', ns: 'namespaces', namespace: 'namespaces', namespaces: 'namespaces', rs: 'replicasets', replicaset: 'replicasets', replicasets: 'replicasets', ev: 'events', event: 'events', events: 'events', ep: 'endpoints', endpoints: 'endpoints', all: 'all' };
const SINGULAR: Record<string, string> = { pods: 'pod', deployments: 'deployment.apps', services: 'service', nodes: 'node', namespaces: 'namespace', replicasets: 'replicaset.apps' };
const VALUED = new Set(['n', 'o', 'l', 'f', 'c', 'namespace', 'output', 'selector', 'filename', 'container', 'replicas', 'image', 'port', 'target-port', 'type', 'name', 'tail', 'timeout', 'context', 'kubeconfig', 'for', 'to-revision', 'since', 'env', 'labels', 'dry-run', 'restart', 'field-selector', 'sort-by']);

interface Parsed {
  pos: string[];
  f: Record<string, string>;
  b: Set<string>;
  rest: string[];
}

function parse(args: string[]): Parsed {
  const out: Parsed = { pos: [], f: {}, b: new Set(), rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out.rest = args.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) out.f[key] = a.slice(eq + 1);
      else if (VALUED.has(key)) out.f[key] = args[++i] ?? '';
      else out.b.add(key);
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const key = a.slice(1, 2);
      if (VALUED.has(key)) out.f[key] = a.length > 2 ? a.slice(a[2] === '=' ? 3 : 2) : args[++i] ?? '';
      else for (const ch of a.slice(1)) out.b.add(ch);
    } else out.pos.push(a);
  }
  const alias: [string, string][] = [['n', 'namespace'], ['o', 'output'], ['l', 'selector'], ['f', 'filename'], ['c', 'container']];
  for (const [s, l] of alias) if (out.f[s] !== undefined && out.f[l] === undefined) out.f[l] = out.f[s];
  if (out.b.has('A')) out.b.add('all-namespaces');
  return out;
}

// ───────────────────────── formato ─────────────────────────

function humanAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 120) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m${s % 60 ? `${s % 60}s` : ''}`;
  if (m < 180) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 8) return `${h}h${m % 60 ? `${m % 60}m` : ''}`;
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 8 ? `${d}d${h % 24 ? `${h % 24}h` : ''}` : `${d}d`;
}

function table(rows: string[][]): string {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(w[i] + 3))).join('')).join('\n') + '\n';
}

const isoTs = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

// ───────────────────────── conexión ─────────────────────────

interface K {
  a: Account;
  region: string;
  cl: EksCluster;
  caller: Caller;
  principal: string;
  ns: string;
  io: AwsIO;
  all: boolean;
}

function kubeconfigPath(io: AwsIO): string {
  return (io.env.KUBECONFIG ?? '').split(':')[0] || `${io.home}/.kube/config`;
}

function connect(a: Account, io: AwsIO, p: Parsed): K {
  const cfg = readKubeconfig(io.readFile(kubeconfigPath(io)));
  if (!cfg) throw new KErr('E: The connection to the server localhost:8080 was refused - did you specify the right host or port?'.replace(/^E: /, ''));
  const name = p.f.context ?? cfg.current;
  if (!name) throw new KErr('error: current-context is not set');
  const ctx = cfg.contexts[name];
  if (!ctx) throw new KErr(`error: context "${name}" does not exist`);
  const host = ctx.server.replace(/^https?:\/\//, '');
  const cl = a.regions[ctx.region]?.eks?.clusters[ctx.cluster];
  if (!cl || cl.endpoint !== ctx.server || cl.status !== 'ACTIVE') throw new KErr(`Unable to connect to the server: dial tcp: lookup ${host} on 127.0.0.53:53: no such host`);
  // el token: lo que hace el plugin `aws eks get-token` del kubeconfig
  const res = runAwsSync(['eks', 'get-token', '--cluster-name', ctx.cluster, '--region', ctx.region, '--output', 'json'], io);
  if (res.code !== 0) throw new KErr(`${res.stderr.trim()}\nUnable to connect to the server: getting credentials: exec: executable aws failed with exit code ${res.code}`);
  let token = '';
  try {
    token = JSON.parse(res.stdout).status.token as string;
  } catch {
    throw new KErr('Unable to connect to the server: getting credentials: exec: executable aws returned invalid output');
  }
  const t = parseEksToken(a, token);
  if (!t) throw new KErr('error: You must be logged in to the server (Unauthorized)');
  if (!cl.publicAccess) throw new KErr(`Unable to connect to the server: dial tcp 10.0.12.41:443: i/o timeout`);
  const ns = p.f.namespace ?? 'default';
  return { a, region: ctx.region, cl, caller: t.caller, principal: principalOf(a, t.caller.arn), ns, io, all: p.b.has('all-namespaces') };
}

type Level = 'read' | 'write';

function allowed(k: K, level: Level, ns: string | null): boolean {
  const acc = k8sAccess(k.cl, k.principal);
  if (!acc) return false;
  return acc.some((p) => (level === 'read' || p.level !== 'view') && (p.namespaces === null || (ns !== null && p.namespaces.includes(ns))));
}

const GROUPS: Record<string, string> = { deployments: 'apps', replicasets: 'apps', pods: '', services: '', nodes: '', namespaces: '', events: '', endpoints: '' };
function forbid(k: K, verb: string, resource: string, ns: string | null): never {
  const group = GROUPS[resource] ?? '';
  const res = group ? `${resource}.${group}` : resource;
  throw new KErr(`Error from server (Forbidden): ${res} is forbidden: User "${k.caller.arn}" cannot ${verb} resource "${resource}" in API group "${group}" ${ns === null ? 'at the cluster scope' : `in the namespace "${ns}"`}`);
}
function need(k: K, level: Level, verb: string, resource: string, ns: string | null) {
  if (!allowed(k, level, ns)) {
    if (!k8sAccess(k.cl, k.principal)) throw new KErr('error: You must be logged in to the server (Unauthorized)');
    forbid(k, verb, resource, ns);
  }
}

// ───────────────────────── objetos ─────────────────────────

const parseCpu = (v: unknown): number => {
  const s = String(v ?? '0');
  return s.endsWith('m') ? Math.round(Number(s.slice(0, -1))) : Math.round(Number(s) * 1000);
};
const parseMemMi = (v: unknown): number => {
  const s = String(v ?? '0');
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  const mult: Record<string, number> = { Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1048576, k: 1000 / 1048576, M: 1e6 / 1048576, G: 1e9 / 1048576, T: 1e12 / 1048576 };
  return Math.round(n * (m[2] ? mult[m[2]] : 1 / 1048576));
};

function containersFrom(spec: any, where: string): K8sContainer[] {
  const list = spec?.containers;
  if (!Array.isArray(list) || !list.length) throw new KErr(`${where}: spec.template.spec.containers: Required value`);
  return list.map((c: any, i: number) => {
    if (!c.name) throw new KErr(`${where}: spec.template.spec.containers[${i}].name: Required value`);
    if (!c.image) throw new KErr(`${where}: spec.template.spec.containers[${i}].image: Required value`);
    return {
      name: String(c.name),
      image: String(c.image),
      ...(c.command ? { command: (c.command as unknown[]).map(String) } : {}),
      ...(c.args ? { args: (c.args as unknown[]).map(String) } : {}),
      env: ((c.env ?? []) as { name: string; value?: unknown }[]).map((e) => ({ name: String(e.name), value: String(e.value ?? '') })),
      ports: ((c.ports ?? []) as { containerPort: number }[]).map((p) => Number(p.containerPort)),
      cpu: parseCpu(c.resources?.requests?.cpu),
      mem: parseMemMi(c.resources?.requests?.memory),
      ...(c.resources?.limits?.memory ? { memLimit: parseMemMi(c.resources.limits.memory) } : {}),
    };
  });
}

const labelsOf = (m: any): Record<string, string> => Object.fromEntries(Object.entries((m?.labels ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));

function percent(v: unknown, of: number, up: boolean, dflt: number): number {
  if (v === undefined) return dflt;
  const s = String(v);
  if (s.endsWith('%')) return up ? Math.ceil((of * Number(s.slice(0, -1))) / 100) : Math.floor((of * Number(s.slice(0, -1))) / 100);
  return Number(s);
}

function makeDeployment(obj: any, ns: string, now: number, old?: K8sDeployment): K8sDeployment {
  const name = String(obj.metadata?.name ?? '');
  const where = `Deployment.apps "${name}" is invalid`;
  const tmpl = obj.spec?.template;
  const labels = labelsOf(tmpl?.metadata);
  const selector = (obj.spec?.selector?.matchLabels ?? {}) as Record<string, string>;
  if (!Object.keys(selector).length) throw new KErr(`The Deployment "${name}" is invalid: spec.selector: Required value`);
  if (!Object.entries(selector).every(([k, v]) => labels[k] === String(v))) throw new KErr(`The Deployment "${name}" is invalid: spec.template.metadata.labels: Invalid value: map[string]string{${Object.entries(labels).map(([k, v]) => `"${k}":"${v}"`).join(', ')}}: \`selector\` does not match template \`labels\``);
  const containers = containersFrom(tmpl?.spec, `The Deployment "${name}" is invalid`);
  void where;
  const replicas = obj.spec?.replicas === undefined ? 1 : Number(obj.spec.replicas);
  const ru = obj.spec?.strategy?.rollingUpdate;
  const hash = hashOf(containers, old?.restartNonce ?? '');
  const d: K8sDeployment = {
    name,
    ns,
    labels: labelsOf(obj.metadata),
    selector,
    replicas,
    containers,
    hash,
    revision: old ? (old.hash === hash ? old.revision : old.revision + 1) : 1,
    history: old ? (old.hash === hash ? old.history : [...old.history, { revision: old.revision, hash: old.hash, containers: old.containers }].slice(-10)) : [],
    created: old?.created ?? now,
    generation: old ? old.generation + (old.hash === hash && old.replicas === replicas ? 0 : 1) : 1,
    simAt: old?.simAt ?? now,
    maxSurge: percent(ru?.maxSurge, replicas, true, Math.ceil(replicas * 0.25)),
    maxUnavailable: percent(ru?.maxUnavailable, replicas, false, Math.floor(replicas * 0.25)),
    restartNonce: old?.restartNonce,
  };
  return d;
}

function makeService(obj: any, ns: string, now: number, old?: K8sService, k?: K): K8sService {
  const name = String(obj.metadata?.name ?? '');
  const type = String(obj.spec?.type ?? 'ClusterIP');
  if (!['ClusterIP', 'NodePort', 'LoadBalancer'].includes(type)) throw new KErr(`The Service "${name}" is invalid: spec.type: Unsupported value: "${type}": supported values: "ClusterIP", "LoadBalancer", "NodePort"`);
  const ports = ((obj.spec?.ports ?? []) as any[]).map((p) => ({ port: Number(p.port), targetPort: Number(p.targetPort ?? p.port) || Number(p.port), ...(p.nodePort ? { nodePort: Number(p.nodePort) } : {}) }));
  if (!ports.length) throw new KErr(`The Service "${name}" is invalid: spec.ports: Required value`);
  const n = k ? Object.keys(k.cl.k8s.services).length : 0;
  const clusterIp = old?.clusterIp ?? `172.20.${100 + (parseInt(md5(`${ns}/${name}`).slice(0, 2), 16) % 100)}.${10 + ((parseInt(md5(`${name}/${ns}`).slice(0, 2), 16) + n) % 200)}`;
  for (const p of ports) if (type !== 'ClusterIP' && !p.nodePort) p.nodePort = 30000 + (parseInt(md5(`${ns}/${name}/${p.port}`).slice(0, 4), 16) % 2767);
  return {
    name,
    ns,
    type: type as K8sService['type'],
    selector: Object.fromEntries(Object.entries((obj.spec?.selector ?? {}) as Record<string, unknown>).map(([a, b]) => [a, String(b)])),
    ports,
    clusterIp,
    created: old?.created ?? now,
    annotations: Object.fromEntries(Object.entries((obj.metadata?.annotations ?? {}) as Record<string, unknown>).map(([a, b]) => [a, String(b)])),
    lb: old?.lb,
    lbError: old?.lbError,
    events: old?.events ?? [],
  };
}

/** Aplica un manifiesto (uno o varios documentos). Devuelve las líneas de resultado. */
function applyDocs(k: K, text: string, create: boolean, now: number): string[] {
  const out: string[] = [];
  const docs = text.split(/^---\s*$/m).map((d) => d.trim()).filter(Boolean);
  if (!docs.length) throw new KErr('error: no objects passed to apply');
  for (const src of docs) {
    let obj: any;
    try {
      obj = parseTemplate(src);
    } catch (e) {
      throw new KErr(`error: error parsing manifest: ${(e as Error).message}`);
    }
    if (!obj || typeof obj !== 'object') continue;
    const kind = String(obj.kind ?? '');
    if (!kind) throw new KErr('error: unable to decode manifest: Object \'Kind\' is missing');
    const name = String(obj.metadata?.name ?? '');
    if (!name) throw new KErr(`error: error validating data: metadata.name: Required value`);
    const ns = String(obj.metadata?.namespace ?? k.ns);
    const key = `${ns}/${name}`;
    const st = k.cl.k8s;
    if (kind === 'Namespace') {
      need(k, 'write', 'create', 'namespaces', null);
      if (st.namespaces.includes(name)) {
        if (create) throw new KErr(`Error from server (AlreadyExists): namespaces "${name}" already exists`);
        out.push(`namespace/${name} unchanged`);
      } else {
        st.namespaces.push(name);
        out.push(`namespace/${name} created`);
      }
    } else if (kind === 'Deployment') {
      need(k, 'write', create ? 'create' : 'patch', 'deployments', ns);
      if (!st.namespaces.includes(ns)) throw new KErr(`Error from server (NotFound): error when creating "manifest": namespaces "${ns}" not found`);
      const old = st.deployments[key];
      if (old && create) throw new KErr(`Error from server (AlreadyExists): error when creating "manifest": deployments.apps "${name}" already exists`);
      const d = makeDeployment(obj, ns, now, old);
      st.deployments[key] = d;
      out.push(`deployment.apps/${name} ${!old ? 'created' : old.hash === d.hash && old.replicas === d.replicas ? 'unchanged' : 'configured'}`);
    } else if (kind === 'Service') {
      need(k, 'write', create ? 'create' : 'patch', 'services', ns);
      if (!st.namespaces.includes(ns)) throw new KErr(`Error from server (NotFound): error when creating "manifest": namespaces "${ns}" not found`);
      const old = st.services[key];
      if (old && create) throw new KErr(`Error from server (AlreadyExists): error when creating "manifest": services "${name}" already exists`);
      const s = makeService(obj, ns, now, old, k);
      st.services[key] = s;
      out.push(`service/${name} ${!old ? 'created' : JSON.stringify([old.type, old.ports, old.selector]) === JSON.stringify([s.type, s.ports, s.selector]) ? 'unchanged' : 'configured'}`);
    } else if (kind === 'Pod') {
      need(k, 'write', 'create', 'pods', ns);
      if (st.pods[key]) throw new KErr(`Error from server (AlreadyExists): error when creating "manifest": pods "${name}" already exists`);
      const containers = containersFrom(obj.spec, `The Pod "${name}" is invalid`.replace('spec.template.spec', 'spec'));
      newPod(k.cl, { name, ns, labels: labelsOf(obj.metadata), containers, hash: hashOf(containers) }, now);
      out.push(`pod/${name} created`);
    } else if (kind === 'ConfigMap' || kind === 'Secret' || kind === 'ServiceAccount') {
      out.push(`${kind.toLowerCase()}/${name} ${create ? 'created' : 'configured'}`);
    } else {
      const v = String(obj.apiVersion ?? 'v1');
      throw new KErr(`error: resource mapping not found for name: "${name}" namespace: "${ns}" from "manifest": no matches for kind "${kind}" in version "${v}"\nensure CRDs are installed first`);
    }
  }
  return out;
}

// ───────────────────────── vistas JSON ─────────────────────────

const VERSION = 'v1.32.3-eks-473151a';

function podObj(p: K8sPod, now: number) {
  const s = podStatus(p, now);
  const c = p.containers;
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: p.name, namespace: p.ns, labels: p.labels, uid: p.uid, creationTimestamp: isoTs(p.created) },
    spec: { containers: c.map((x) => ({ name: x.name, image: x.image, ...(x.ports.length ? { ports: x.ports.map((n) => ({ containerPort: n, protocol: 'TCP' })) } : {}), ...(x.env.length ? { env: x.env } : {}), resources: { requests: { cpu: `${x.cpu}m`, memory: `${x.mem}Mi` } } })), ...(p.node ? { nodeName: p.node } : {}) },
    status: { phase: s.running ? 'Running' : s.status === 'Terminating' ? 'Running' : 'Pending', ...(p.ip ? { podIP: p.ip, hostIP: p.ip } : {}), containerStatuses: c.map((x) => ({ name: x.name, ready: s.running, restartCount: s.restarts, image: x.image, state: s.running ? { running: { startedAt: isoTs(p.startedAt ?? p.created) } } : { waiting: { reason: s.status } } })) },
  };
}

function deployStatus(k: K, d: K8sDeployment, now: number) {
  const pods = Object.values(k.cl.k8s.pods).filter((p) => p.ns === d.ns && p.owner === d.name && !(p.terminatingAt !== undefined && now >= p.terminatingAt));
  const cur = pods.filter((p) => p.hash === d.hash);
  return { total: pods.length, updated: cur.length, ready: pods.filter((p) => podReady(p, now)).length, available: pods.filter((p) => podReady(p, now)).length, readyNew: cur.filter((p) => podReady(p, now)).length };
}

function deployObj(k: K, d: K8sDeployment, now: number) {
  const s = deployStatus(k, d, now);
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: d.name, namespace: d.ns, labels: d.labels, creationTimestamp: isoTs(d.created), generation: d.generation },
    spec: { replicas: d.replicas, selector: { matchLabels: d.selector }, template: { metadata: { labels: d.selector }, spec: { containers: d.containers.map((x) => ({ name: x.name, image: x.image })) } } },
    status: { replicas: s.total, updatedReplicas: s.updated, readyReplicas: s.ready, availableReplicas: s.available },
  };
}

function svcObj(k: K, s: K8sService, now: number) {
  const host = lbHostname(k.a, k.region, s);
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: s.name, namespace: s.ns, creationTimestamp: isoTs(s.created), ...(Object.keys(s.annotations).length ? { annotations: s.annotations } : {}) },
    spec: { type: s.type, clusterIP: s.clusterIp, selector: s.selector, ports: s.ports.map((p) => ({ port: p.port, protocol: 'TCP', targetPort: p.targetPort, ...(p.nodePort ? { nodePort: p.nodePort } : {}) })) },
    status: { loadBalancer: host ? { ingress: [{ hostname: host }] } : {} },
    _now: now,
  };
}

const nodeObj = (n: K8sNode, now: number) => ({
  apiVersion: 'v1',
  kind: 'Node',
  metadata: { name: n.name, labels: { 'kubernetes.io/hostname': n.name, 'node.kubernetes.io/instance-type': n.type, 'eks.amazonaws.com/nodegroup': n.ng } },
  status: { addresses: [{ type: 'InternalIP', address: n.ip }, ...(n.publicIp ? [{ type: 'ExternalIP', address: n.publicIp }] : []), { type: 'Hostname', address: n.name }], conditions: [{ type: 'Ready', status: now >= n.readyAt ? 'True' : 'False' }], nodeInfo: { kubeletVersion: VERSION, architecture: n.arch } },
});

/** Evalúa una expresión `{.a.b[0].c}`; `[*]` recorre listas. */
function jsonpath(obj: unknown, expr: string): string {
  const eval1 = (e: string): string => {
    let cur: unknown[] = [obj];
    const re = /\.([A-Za-z0-9_\-/]+)|\[(\d+|\*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(e))) {
      const next: unknown[] = [];
      for (const v of cur) {
        if (m[1] !== undefined) {
          if (v && typeof v === 'object') {
            const x = (v as Record<string, unknown>)[m[1]];
            if (x !== undefined) next.push(x);
          }
        } else if (Array.isArray(v)) {
          if (m[2] === '*') next.push(...v);
          else if (v[Number(m[2])] !== undefined) next.push(v[Number(m[2])]);
        }
      }
      cur = next;
    }
    return cur.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ');
  };
  return expr.replace(/\{([^}]*)\}/g, (_, e) => eval1(e)).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function render(items: any[], list: boolean, fmt: string, c: Ctx): boolean {
  const body = list ? { apiVersion: 'v1', kind: 'List', items, metadata: { resourceVersion: '' } } : items[0];
  if (fmt === 'json') c.out(JSON.stringify(body, (k, v) => (k === '_now' ? undefined : v), 4) + '\n');
  else if (fmt === 'yaml') c.out(dumpYaml(JSON.parse(JSON.stringify(body, (k, v) => (k === '_now' ? undefined : v)))));
  else if (fmt.startsWith('jsonpath=')) c.out(jsonpath(body, fmt.slice(9).replace(/^'|'$/g, '')));
  else return false;
  return true;
}

// ───────────────────────── get ─────────────────────────

const nsNames = (k: K, p: Parsed): string[] | null => (k.all ? null : [p.f.namespace ?? 'default']);

function selectorOf(p: Parsed): Record<string, string> | null {
  const s = p.f.selector;
  if (!s) return null;
  return Object.fromEntries(s.split(',').map((x) => x.split('=')).filter((x) => x.length === 2).map(([a, b]) => [a.trim(), b.trim().replace(/^=/, '')]));
}

function podsOf(k: K, p: Parsed, now: number): K8sPod[] {
  const nss = nsNames(k, p);
  const sel = selectorOf(p);
  return Object.values(k.cl.k8s.pods)
    .filter((x) => (!nss || nss.includes(x.ns)) && (!sel || matches(sel, x.labels)) && !(x.deletedAt !== undefined && now >= x.deletedAt))
    .sort((x, y) => x.ns.localeCompare(y.ns) || x.name.localeCompare(y.name));
}

const svcPorts = (s: K8sService) => s.ports.map((p) => (s.type === 'ClusterIP' || !p.nodePort ? `${p.port}/TCP` : `${p.port}:${p.nodePort}/TCP`)).join(',');

function resourceRows(k: K, kind: string, p: Parsed, now: number, wide: boolean, names: string[]): { head: string[]; rows: string[][]; objs: any[]; raw: unknown[] } {
  const showNs = k.all;
  const nss = nsNames(k, p);
  const st = k.cl.k8s;
  const filt = <T extends { name: string }>(l: T[]) => (names.length ? l.filter((x) => names.includes(x.name)) : l);
  if (kind === 'pods') {
    const pods = podsOf(k, p, now).filter((x) => !names.length || names.includes(x.name));
    const head = [...(showNs ? ['NAMESPACE'] : []), 'NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', ...(wide ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : []), ...(p.b.has('show-labels') ? ['LABELS'] : [])];
    const rows = pods.map((x) => {
      const s = podStatus(x, now);
      return [...(showNs ? [x.ns] : []), x.name, s.ready, s.status, s.restarts && s.lastRestart ? `${s.restarts} (${humanAge(now - s.lastRestart)} ago)` : String(s.restarts), humanAge(now - x.created), ...(wide ? [x.ip ?? '<none>', x.node ?? '<none>', '<none>', '<none>'] : []), ...(p.b.has('show-labels') ? [Object.entries(x.labels).map(([a, b]) => `${a}=${b}`).join(',') || '<none>'] : [])];
    });
    return { head, rows, objs: pods.map((x) => podObj(x, now)), raw: pods };
  }
  if (kind === 'deployments') {
    const ds = filt(Object.values(st.deployments).filter((d) => !nss || nss.includes(d.ns)));
    const head = [...(showNs ? ['NAMESPACE'] : []), 'NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])];
    const rows = ds.map((d) => {
      const s = deployStatus(k, d, now);
      return [...(showNs ? [d.ns] : []), d.name, `${s.ready}/${d.replicas}`, String(s.updated), String(s.available), humanAge(now - d.created), ...(wide ? [d.containers.map((x) => x.name).join(','), d.containers.map((x) => x.image).join(','), Object.entries(d.selector).map(([a, b]) => `${a}=${b}`).join(',')] : [])];
    });
    return { head, rows, objs: ds.map((d) => deployObj(k, d, now)), raw: ds };
  }
  if (kind === 'services') {
    const ss = filt(Object.values(st.services).filter((s) => !nss || nss.includes(s.ns)));
    const head = [...(showNs ? ['NAMESPACE'] : []), 'NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : [])];
    const rows = ss.map((s) => [...(showNs ? [s.ns] : []), s.name, s.type, s.clusterIp, s.type === 'LoadBalancer' ? lbHostname(k.a, k.region, s) ?? '<pending>' : '<none>', s.name === 'kube-dns' ? '53/UDP,53/TCP' : svcPorts(s), humanAge(now - s.created), ...(wide ? [Object.entries(s.selector).map(([a, b]) => `${a}=${b}`).join(',') || '<none>'] : [])]);
    return { head, rows, objs: ss.map((s) => svcObj(k, s, now)), raw: ss };
  }
  if (kind === 'nodes') {
    const nodes = filt([...clusterNodes(k.a, k.region, k.cl), ...fargateNodes(k.cl, now)]);
    const head = ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION', ...(wide ? ['INTERNAL-IP', 'EXTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION', 'CONTAINER-RUNTIME'] : [])];
    const rows = nodes.map((n) => [n.name, now >= n.readyAt ? 'Ready' : 'NotReady', '<none>', humanAge(now - n.createdAt), n.fargate ? 'v1.32.3-eks-473151a' : VERSION, ...(wide ? [n.ip, n.publicIp ?? '<none>', 'Amazon Linux 2023.6.20250609', '6.1.134-152.225.amzn2023.x86_64', 'containerd://1.7.27'] : [])]);
    return { head, rows, objs: nodes.map((n) => nodeObj(n, now)), raw: nodes };
  }
  if (kind === 'namespaces') {
    const list = st.namespaces.filter((n) => !names.length || names.includes(n));
    return { head: ['NAME', 'STATUS', 'AGE'], rows: list.map((n) => [n, 'Active', humanAge(now - k.cl.activeAt)]), objs: list.map((n) => ({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: n } })), raw: list };
  }
  if (kind === 'replicasets') {
    const rs: { ns: string; name: string; desired: number; cur: number; ready: number; age: number }[] = [];
    for (const d of Object.values(st.deployments).filter((x) => !nss || nss.includes(x.ns))) {
      const pods = Object.values(st.pods).filter((x) => x.ns === d.ns && x.owner === d.name && !(x.terminatingAt !== undefined && now >= x.terminatingAt));
      const hashes = new Set([d.hash, ...d.history.map((h) => h.hash), ...pods.map((x) => x.hash)]);
      for (const h of hashes) {
        const mine = pods.filter((x) => x.hash === h);
        rs.push({ ns: d.ns, name: `${d.name}-${h}`, desired: h === d.hash ? d.replicas : 0, cur: mine.length, ready: mine.filter((x) => podReady(x, now)).length, age: now - d.created });
      }
    }
    const list = filt(rs);
    return { head: [...(showNs ? ['NAMESPACE'] : []), 'NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE'], rows: list.map((r) => [...(showNs ? [r.ns] : []), r.name, String(r.desired), String(r.cur), String(r.ready), humanAge(r.age)]), objs: list.map((r) => ({ apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: r.name, namespace: r.ns } })), raw: list };
  }
  if (kind === 'endpoints') {
    const ss = filt(Object.values(st.services).filter((s) => !nss || nss.includes(s.ns)));
    return { head: [...(showNs ? ['NAMESPACE'] : []), 'NAME', 'ENDPOINTS', 'AGE'], rows: ss.map((s) => [...(showNs ? [s.ns] : []), s.name, endpoints(k, s, now).join(',') || '<none>', humanAge(now - s.created)]), objs: [], raw: ss };
  }
  throw new KErr(`error: the server doesn't have a resource type "${kind}"`);
}

function endpoints(k: K, s: K8sService, now: number): string[] {
  if (s.name === 'kubernetes') return ['10.0.12.41:443', '10.0.28.7:443'];
  return Object.values(k.cl.k8s.pods)
    .filter((x) => x.ns === s.ns && matches(s.selector, x.labels) && !!x.ip && podReady(x, now))
    .flatMap((x) => s.ports.map((p) => `${x.ip}:${p.targetPort}`));
}

function eventRows(k: K, p: Parsed, now: number): string[][] {
  const nss = nsNames(k, p);
  const rows: { t: number; r: string[] }[] = [];
  for (const x of Object.values(k.cl.k8s.pods)) if (!nss || nss.includes(x.ns)) for (const e of x.events) if (e.t <= now) rows.push({ t: e.t, r: [...(k.all ? [x.ns] : []), humanAge(now - e.t), e.type, e.reason, `pod/${x.name}`, e.message] });
  for (const s of Object.values(k.cl.k8s.services)) if (!nss || nss.includes(s.ns)) for (const e of s.events) if (e.t <= now) rows.push({ t: e.t, r: [...(k.all ? [s.ns] : []), humanAge(now - e.t), e.type, e.reason, `service/${s.name}`, e.message] });
  return rows.sort((a, b) => a.t - b.t).map((x) => x.r);
}

function cmdGet(c: Ctx, k: K, p: Parsed, now: number): number {
  const first = p.pos[0];
  if (!first) throw new KErr('You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.');
  let types = first.split(',');
  let names = p.pos.slice(1);
  if (first.includes('/')) {
    const [t, n] = first.split('/');
    types = [t];
    names = [n];
  }
  if (types.includes('all')) types = ['pods', 'services', 'deployments', 'replicasets'];
  const kinds = types.map((t) => {
    const kk = KINDS[t.toLowerCase()];
    if (!kk) throw new KErr(`error: the server doesn't have a resource type "${t}"`);
    return kk;
  });
  const fmt = p.f.output ?? '';
  const wide = fmt === 'wide';
  for (const kind of kinds) {
    if (kind === 'nodes') need(k, 'read', 'list', 'nodes', null);
    else if (kind === 'namespaces') need(k, 'read', 'list', 'namespaces', null);
    else if (k.all) {
      if (!allowed(k, 'read', null)) forbid(k, 'list', kind, null);
    } else need(k, 'read', names.length ? 'get' : 'list', kind, p.f.namespace ?? 'default');
  }
  if (!k.all && !k.cl.k8s.namespaces.includes(p.f.namespace ?? 'default') && !kinds.every((x) => x === 'nodes' || x === 'namespaces')) {
    c.err(`No resources found in ${p.f.namespace} namespace.\n`);
    return 0;
  }
  if (kinds.length === 1 && kinds[0] === 'events') {
    const rows = eventRows(k, p, now);
    if (!rows.length) {
      c.err(`No resources found in ${p.f.namespace ?? 'default'} namespace.\n`);
      return 0;
    }
    c.out(table([[...(k.all ? ['NAMESPACE'] : []), 'LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], ...rows]));
    return 0;
  }
  const multi = kinds.length > 1;
  let printed = false;
  for (const kind of kinds) {
    const r = resourceRows(k, kind, p, now, wide, names);
    if (names.length && !r.rows.length) throw new KErr(`Error from server (NotFound): ${kind} "${names[0]}" not found`);
    if (fmt && !wide && fmt !== 'name') {
      if (!r.objs.length && !names.length && fmt.startsWith('json')) {
        render([], true, fmt, c);
        continue;
      }
      if (!render(r.objs, names.length !== 1 || kinds.length > 1, fmt, c)) throw new KErr(`error: unable to match a printer suitable for the output format "${fmt}", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml`);
      printed = true;
      continue;
    }
    if (fmt === 'name') {
      for (const row of r.rows) c.out(`${SINGULAR[kind] ?? kind}/${row[k.all && kind !== 'nodes' && kind !== 'namespaces' ? 1 : 0]}\n`);
      printed = printed || r.rows.length > 0;
      continue;
    }
    if (!r.rows.length) {
      if (!multi) c.err(k.all || kind === 'nodes' || kind === 'namespaces' ? 'No resources found\n' : `No resources found in ${p.f.namespace ?? 'default'} namespace.\n`);
      continue;
    }
    printed = true;
    const prefix = multi ? (kind === 'pods' ? 'pod' : kind === 'services' ? 'service' : kind === 'deployments' ? 'deployment.apps' : 'replicaset.apps') : '';
    if (multi) {
      const nameCol = k.all ? 1 : 0;
      const body = table([r.head, ...r.rows.map((row) => row.map((cell, i) => (i === nameCol ? `${prefix}/${cell}` : cell)))]);
      c.out(body + '\n');
    } else c.out(table([r.head, ...r.rows]));
  }
  if (multi && !printed) c.err(`No resources found in ${p.f.namespace ?? 'default'} namespace.\n`);
  return 0;
}

// ───────────────────────── describe ─────────────────────────

function evTable(events: { t: number; type: string; reason: string; message: string }[], now: number, from: string): string {
  const list = events.filter((e) => e.t <= now).sort((a, b) => a.t - b.t);
  if (!list.length) return 'Events:                <none>\n';
  const agoOf = (t: number) => humanAge(now - t);
  return 'Events:\n' + table([['  Type', 'Reason', 'Age', 'From', 'Message'], ...list.map((e) => ['  ' + e.type, e.reason, agoOf(e.t), from, e.message])]);
}

function describePod(k: K, pod: K8sPod, now: number): string {
  const s = podStatus(pod, now);
  const cn = pod.containers[0];
  const state = s.running ? `Running\n      Started:      ${new Date(pod.startedAt ?? now).toUTCString().replace('GMT', '+0000')}` : s.status === 'ContainerCreating' ? 'Waiting\n      Reason:       ContainerCreating' : s.status === 'ErrImagePull' || s.status === 'ImagePullBackOff' ? `Waiting\n      Reason:       ${s.status}` : s.status === 'Pending' ? 'Waiting\n      Reason:       ContainerCreating' : `Waiting\n      Reason:       CrashLoopBackOff\n    Last State:     Terminated\n      Reason:       ${pod.failure?.reason ?? 'Error'}\n      Exit Code:    ${pod.failure?.code ?? 1}`;
  const statusLine = s.status === 'Pending' || s.status === 'ContainerCreating' || s.status === 'ErrImagePull' || s.status === 'ImagePullBackOff' ? 'Pending' : s.status === 'Terminating' ? 'Running' : 'Running';
  const own = pod.ownerRef ?? (pod.owner ? `ReplicaSet/${pod.owner}-${pod.hash}` : '');
  let t = `Name:             ${pod.name}\nNamespace:        ${pod.ns}\nPriority:         0\nService Account:  default\nNode:             ${pod.node ? `${pod.node}/${pod.ip ?? ''}` : '<none>'}\n`;
  if (pod.scheduledAt) t += `Start Time:       ${new Date(pod.scheduledAt).toUTCString().replace('GMT', '+0000')}\n`;
  t += `Labels:           ${Object.entries(pod.labels).map(([a, b]) => `${a}=${b}`).join('\n                  ') || '<none>'}\nAnnotations:      <none>\nStatus:           ${statusLine}\nIP:               ${pod.ip ?? ''}\nIPs:\n${pod.ip ? `  IP:           ${pod.ip}\n` : ''}${own ? `Controlled By:    ${own}\n` : ''}Containers:\n  ${cn.name}:\n    Container ID:   ${s.running ? 'containerd://' + md5(pod.uid).slice(0, 32) : ''}\n    Image:          ${cn.image}\n    Image ID:       \n    Port:           ${cn.ports.length ? cn.ports.map((x) => `${x}/TCP`).join(', ') : '<none>'}\n    Host Port:      0/TCP\n    State:          ${state}\n    Ready:          ${s.ready.startsWith(`${pod.containers.length}/`) && s.running ? 'True' : 'False'}\n    Restart Count:  ${s.restarts}\n    Requests:\n      cpu:        ${cn.cpu}m\n      memory:     ${cn.mem}Mi\n    Environment:  ${cn.env.length ? '\n' + cn.env.map((e) => `      ${e.name}:  ${e.value}`).join('\n') : '<none>'}\nConditions:\n  Type                        Status\n  PodScheduled                ${pod.node ? 'True' : 'False'}\n  Ready                       ${s.running ? 'True' : 'False'}\nQoS Class:                    ${cn.cpu || cn.mem ? 'Burstable' : 'BestEffort'}\nNode-Selectors:               <none>\nTolerations:                  node.kubernetes.io/not-ready:NoExecute op=Exists for 300s\n                              node.kubernetes.io/unreachable:NoExecute op=Exists for 300s\n`;
  t += evTable(pod.events, now, pod.node && pod.node.startsWith('fargate') ? 'fargate-scheduler' : pod.node ? 'kubelet' : 'default-scheduler');
  return t;
}

function describeDeployment(k: K, d: K8sDeployment, now: number): string {
  const s = deployStatus(k, d, now);
  const cn = d.containers[0];
  return `Name:                   ${d.name}\nNamespace:              ${d.ns}\nCreationTimestamp:      ${new Date(d.created).toUTCString().replace('GMT', '+0000')}\nLabels:                 ${Object.entries(d.labels).map(([a, b]) => `${a}=${b}`).join(',') || '<none>'}\nAnnotations:            deployment.kubernetes.io/revision: ${d.revision}\nSelector:               ${Object.entries(d.selector).map(([a, b]) => `${a}=${b}`).join(',')}\nReplicas:               ${d.replicas} desired | ${s.updated} updated | ${s.total} total | ${s.available} available | ${Math.max(0, d.replicas - s.available)} unavailable\nStrategyType:           RollingUpdate\nMinReadySeconds:        0\nRollingUpdateStrategy:  ${d.maxUnavailable} max unavailable, ${d.maxSurge} max surge\nPod Template:\n  Labels:  ${Object.entries(d.selector).map(([a, b]) => `${a}=${b}`).join(',')}\n  Containers:\n   ${cn.name}:\n    Image:      ${cn.image}\n    Port:       ${cn.ports.length ? cn.ports.map((x) => `${x}/TCP`).join(', ') : '<none>'}\n    Host Port:  0/TCP\n    Requests:\n      cpu:        ${cn.cpu}m\n      memory:     ${cn.mem}Mi\n    Environment:  <none>\n    Mounts:       <none>\n  Volumes:        <none>\nConditions:\n  Type           Status  Reason\n  Available      ${s.available >= Math.max(0, d.replicas - d.maxUnavailable) ? 'True' : 'False'}    ${s.available >= Math.max(0, d.replicas - d.maxUnavailable) ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable'}\n  Progressing    True    ${s.readyNew >= d.replicas ? 'NewReplicaSetAvailable' : 'ReplicaSetUpdated'}\nNewReplicaSet:   ${d.name}-${d.hash} (${s.updated}/${d.replicas} replicas created)\nEvents:          <none>\n`;
}

function describeService(k: K, s: K8sService, now: number): string {
  const host = lbHostname(k.a, k.region, s);
  const eps = endpoints(k, s, now);
  let t = `Name:                     ${s.name}\nNamespace:                ${s.ns}\nLabels:                   <none>\nAnnotations:              ${Object.entries(s.annotations).map(([a, b]) => `${a}: ${b}`).join('\n                          ') || '<none>'}\nSelector:                 ${Object.entries(s.selector).map(([a, b]) => `${a}=${b}`).join(',') || '<none>'}\nType:                     ${s.type}\nIP Family Policy:         SingleStack\nIP Families:              IPv4\nIP:                       ${s.clusterIp}\nIPs:                      ${s.clusterIp}\n`;
  if (s.type === 'LoadBalancer') t += `LoadBalancer Ingress:     ${host ?? ''}\n`;
  for (const p of s.ports) t += `Port:                     <unset>  ${p.port}/TCP\nTargetPort:               ${p.targetPort}/TCP\n${p.nodePort ? `NodePort:                 <unset>  ${p.nodePort}/TCP\n` : ''}`;
  t += `Endpoints:                ${eps.join(',') || '<none>'}\nSession Affinity:         None\n`;
  if (s.type !== 'ClusterIP') t += 'External Traffic Policy:  Cluster\n';
  t += evTable(s.events, now, 'service-controller');
  return t;
}

function cmdDescribe(c: Ctx, k: K, p: Parsed, now: number): number {
  const first = p.pos[0];
  if (!first) throw new KErr('error: You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.');
  let kind: string | undefined;
  let name: string | undefined = p.pos[1];
  if (first.includes('/')) {
    const [t, n] = first.split('/');
    kind = KINDS[t];
    name = n;
  } else kind = KINDS[first.toLowerCase()];
  if (!kind) throw new KErr(`error: the server doesn't have a resource type "${first}"`);
  const ns = p.f.namespace ?? 'default';
  if (kind !== 'nodes') need(k, 'read', 'get', kind, ns);
  else need(k, 'read', 'get', 'nodes', null);
  const st = k.cl.k8s;
  if (kind === 'pods') {
    const list = name ? [st.pods[`${ns}/${name}`]].filter(Boolean) : podsOf(k, { ...p, b: new Set() }, now);
    if (name && !list.length) throw new KErr(`Error from server (NotFound): pods "${name}" not found`);
    c.out(list.map((x) => describePod(k, x, now)).join('\n\n'));
  } else if (kind === 'deployments') {
    const d = name ? st.deployments[`${ns}/${name}`] : undefined;
    if (!d) throw new KErr(`Error from server (NotFound): deployments.apps "${name}" not found`);
    c.out(describeDeployment(k, d, now));
  } else if (kind === 'services') {
    const s = name ? st.services[`${ns}/${name}`] : undefined;
    if (!s) throw new KErr(`Error from server (NotFound): services "${name}" not found`);
    c.out(describeService(k, s, now));
  } else if (kind === 'nodes') {
    const n = [...clusterNodes(k.a, k.region, k.cl), ...fargateNodes(k.cl, now)].find((x) => x.name === name);
    if (!n) throw new KErr(`Error from server (NotFound): nodes "${name}" not found`);
    const pods = Object.values(st.pods).filter((x) => x.node === n.name);
    const cpu = pods.reduce((s, x) => s + x.containers.reduce((y, z) => y + z.cpu, 0), 0);
    const mem = pods.reduce((s, x) => s + x.containers.reduce((y, z) => y + z.mem, 0), 0);
    c.out(`Name:               ${n.name}\nRoles:              <none>\nLabels:             node.kubernetes.io/instance-type=${n.type}\n                    eks.amazonaws.com/nodegroup=${n.ng}\nAddresses:\n  InternalIP:  ${n.ip}\n  Hostname:    ${n.name}\nConditions:\n  Type    Status  Reason\n  Ready   ${now >= n.readyAt ? 'True' : 'False'}    KubeletReady\nCapacity:\n  cpu:     ${Math.round((n.cpu + 70) / 1000)}\n  memory:  ${Math.round((n.mem + 255) / 0.88)}Mi\n  pods:    ${n.maxPods}\nAllocatable:\n  cpu:     ${n.cpu}m\n  memory:  ${n.mem}Mi\n  pods:    ${n.maxPods}\nSystem Info:\n  Kubelet Version:            ${VERSION}\nNon-terminated Pods:          (${pods.length} in total)\nAllocated resources:\n  Resource  Requests\n  cpu       ${cpu}m (${n.cpu ? Math.round((cpu / n.cpu) * 100) : 0}%)\n  memory    ${mem}Mi (${n.mem ? Math.round((mem / n.mem) * 100) : 0}%)\n`);
  } else throw new KErr(`error: describe is not supported for "${kind}" in this simulator`);
  return 0;
}

// ───────────────────────── resto de órdenes ─────────────────────────

const readManifest = async (c: Ctx, io: AwsIO, file: string): Promise<string> => {
  if (file === '-') return await c.stdin.readAll();
  const text = io.readFile(io.abs(file));
  if (text === null) throw new KErr(`error: the path "${file}" does not exist`);
  return text;
};

function findDeploy(k: K, ref: string, ns: string): K8sDeployment {
  const name = ref.includes('/') ? ref.split('/')[1] : ref;
  const d = k.cl.k8s.deployments[`${ns}/${name}`];
  if (!d) throw new KErr(`Error from server (NotFound): deployments.apps "${name}" not found`);
  return d;
}

function deleteLb(k: K, s: K8sService) {
  if (!s.lb) return;
  const e = elb(k.a, k.region);
  delete e.lbs[s.lb.arn];
  delete e.tgs[s.lb.tgArn];
  s.lb = undefined;
}

function removeObject(k: K, kind: string, name: string, ns: string, now: number): string {
  const st = k.cl.k8s;
  const key = `${ns}/${name}`;
  if (kind === 'deployments') {
    need(k, 'write', 'delete', 'deployments', ns);
    if (!st.deployments[key]) throw new KErr(`Error from server (NotFound): deployments.apps "${name}" not found`);
    delete st.deployments[key];
    for (const p of Object.values(st.pods)) if (p.ns === ns && p.owner === name) terminate(p, now);
    return `deployment.apps "${name}" deleted`;
  }
  if (kind === 'services') {
    need(k, 'write', 'delete', 'services', ns);
    const s = st.services[key];
    if (!s) throw new KErr(`Error from server (NotFound): services "${name}" not found`);
    deleteLb(k, s);
    delete st.services[key];
    return `service "${name}" deleted`;
  }
  if (kind === 'pods') {
    need(k, 'write', 'delete', 'pods', ns);
    const p = st.pods[key];
    if (!p) throw new KErr(`Error from server (NotFound): pods "${name}" not found`);
    terminate(p, now, 8000);
    return `pod "${name}" deleted`;
  }
  if (kind === 'namespaces') {
    need(k, 'write', 'delete', 'namespaces', null);
    if (!st.namespaces.includes(name)) throw new KErr(`Error from server (NotFound): namespaces "${name}" not found`);
    if (['default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(name)) throw new KErr(`Error from server (Forbidden): namespaces "${name}" is forbidden: this namespace may not be deleted`);
    for (const d of Object.values(st.deployments)) if (d.ns === name) removeObject(k, 'deployments', d.name, name, now);
    for (const s of Object.values(st.services)) if (s.ns === name) removeObject(k, 'services', s.name, name, now);
    for (const p of Object.values(st.pods)) if (p.ns === name) terminate(p, now);
    st.namespaces = st.namespaces.filter((x) => x !== name);
    return `namespace "${name}" deleted`;
  }
  throw new KErr(`error: cannot delete "${kind}" in this simulator`);
}

function cmdDelete(c: Ctx, k: K, p: Parsed, now: number, text?: string): number {
  const ns = p.f.namespace ?? 'default';
  const lines: string[] = [];
  if (text !== undefined) {
    for (const src of text.split(/^---\s*$/m).map((d) => d.trim()).filter(Boolean)) {
      const obj = parseTemplate(src) as any;
      const kind = { Deployment: 'deployments', Service: 'services', Pod: 'pods', Namespace: 'namespaces' }[String(obj.kind)];
      if (!kind) continue;
      lines.push(removeObject(k, kind, String(obj.metadata?.name), String(obj.metadata?.namespace ?? ns), now));
    }
  } else {
    const first = p.pos[0];
    if (!first) throw new KErr('error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   \'-f rsrc.yaml\'\n   \'--filename=rsrc.json\'\n   \'<resource> <name>\'\n   \'<resource>\'');
    let kind: string | undefined;
    let names = p.pos.slice(1);
    if (first.includes('/')) {
      kind = KINDS[first.split('/')[0]];
      names = [first.split('/')[1]];
    } else kind = KINDS[first.toLowerCase()];
    if (!kind) throw new KErr(`error: the server doesn't have a resource type "${first}"`);
    if (p.b.has('all')) {
      const rows = resourceRows(k, kind, p, now, false, []);
      names = rows.rows.map((r) => r[0]);
    }
    if (!names.length) throw new KErr('error: resource(s) were provided, but no name was specified');
    for (const n of names) lines.push(removeObject(k, kind, n, ns, now));
  }
  c.out(lines.join('\n') + '\n');
  return 0;
}

function cmdLogs(c: Ctx, k: K, p: Parsed, now: number): number {
  const ns = p.f.namespace ?? 'default';
  const ref = p.pos[0];
  if (!ref) throw new KErr('error: expected \'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]\'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee \'kubectl logs -h\' for help and examples');
  need(k, 'read', 'get', 'pods', ns);
  let pod: K8sPod | undefined;
  if (ref.startsWith('deploy/') || ref.startsWith('deployment/')) {
    const d = findDeploy(k, ref, ns);
    pod = Object.values(k.cl.k8s.pods).find((x) => x.ns === ns && x.owner === d.name && x.hash === d.hash && x.terminatingAt === undefined) ?? Object.values(k.cl.k8s.pods).find((x) => x.ns === ns && x.owner === d.name);
    if (!pod) throw new KErr(`error: no pods found for deployment ${d.name}`);
  } else {
    pod = k.cl.k8s.pods[`${ns}/${ref.replace(/^pods?\//, '')}`];
    if (!pod) throw new KErr(`Error from server (NotFound): pods "${ref}" not found`);
  }
  const s = podStatus(pod, now);
  const cn = pod.containers[0].name;
  if (p.f.container && !pod.containers.some((x) => x.name === p.f.container)) throw new KErr(`Error from server (BadRequest): container ${p.f.container} is not valid for pod ${pod.name}`);
  if (['Pending', 'ContainerCreating', 'ErrImagePull', 'ImagePullBackOff'].includes(s.status)) throw new KErr(`Error from server (BadRequest): container "${cn}" in pod "${pod.name}" is waiting to start: ${s.status === 'ErrImagePull' || s.status === 'ImagePullBackOff' ? 'trying and failing to pull image' : 'ContainerCreating'}`);
  if (p.b.has('previous') && !s.restarts) throw new KErr(`Error from server (BadRequest): previous terminated container "${cn}" in pod "${pod.name}" not found`);
  let lines = pod.lines;
  const tail = p.f.tail ? Number(p.f.tail) : undefined;
  if (tail !== undefined && tail >= 0) lines = lines.slice(-tail);
  c.out(lines.length ? lines.join('\n') + '\n' : '');
  return 0;
}

function cmdScale(c: Ctx, k: K, p: Parsed, now: number): number {
  const ns = p.f.namespace ?? 'default';
  const ref = p.pos[0] === 'deployment' || p.pos[0] === 'deploy' ? p.pos[1] : p.pos[0];
  if (!ref) throw new KErr('error: required resource not specified');
  need(k, 'write', 'patch', 'deployments', ns);
  const d = findDeploy(k, ref, ns);
  if (p.f.replicas === undefined || Number.isNaN(Number(p.f.replicas))) throw new KErr('error: required flag(s) "replicas" not set');
  d.replicas = Number(p.f.replicas);
  d.generation++;
  d.maxSurge = Math.ceil(d.replicas * 0.25);
  d.maxUnavailable = Math.floor(d.replicas * 0.25);
  void now;
  c.out(`deployment.apps/${d.name} scaled\n`);
  return 0;
}

function cmdSet(c: Ctx, k: K, p: Parsed, now: number): number {
  if (p.pos[0] !== 'image') throw new KErr(`error: unknown command "${p.pos[0] ?? ''}" for "kubectl set"`);
  const ns = p.f.namespace ?? 'default';
  const [ref, ...assigns] = p.pos.slice(1);
  need(k, 'write', 'patch', 'deployments', ns);
  const d = findDeploy(k, ref ?? '', ns);
  if (!assigns.length) throw new KErr('error: at least one image update is required');
  const containers = d.containers.map((x) => ({ ...x }));
  for (const as of assigns) {
    const [cn, img] = as.split('=');
    const target = cn === '*' ? containers : containers.filter((x) => x.name === cn);
    if (!target.length) throw new KErr(`error: unable to find container named "${cn}"`);
    for (const t of target) t.image = img;
  }
  roll(d, containers, now);
  c.out(`deployment.apps/${d.name} image updated\n`);
  return 0;
}

function roll(d: K8sDeployment, containers: K8sContainer[], now: number) {
  const hash = hashOf(containers, d.restartNonce ?? '');
  if (hash !== d.hash) {
    d.history = [...d.history, { revision: d.revision, hash: d.hash, containers: d.containers }].slice(-10);
    d.revision++;
    d.generation++;
    d.containers = containers;
    d.hash = hash;
  }
  void now;
}

async function cmdRollout(c: Ctx, k: K, p: Parsed, now: number): Promise<number> {
  const sub = p.pos[0];
  const ns = p.f.namespace ?? 'default';
  const ref = p.pos[1] ?? '';
  need(k, sub === 'status' || sub === 'history' ? 'read' : 'write', sub === 'status' || sub === 'history' ? 'get' : 'patch', 'deployments', ns);
  const d = findDeploy(k, ref, ns);
  if (sub === 'status') {
    const timeoutMs = (p.f.timeout ? parseDuration(p.f.timeout) : 600) * 1000;
    const start = k.a.clock;
    let last = '';
    for (;;) {
      k8sSync(k.a, k.region, k.cl, k.a.clock);
      const s = deployStatus(k, d, k.a.clock);
      if (s.updated >= d.replicas && s.total === s.updated && s.available >= d.replicas) {
        c.out(`deployment "${d.name}" successfully rolled out\n`);
        return 0;
      }
      const msg = s.updated < d.replicas ? `Waiting for deployment "${d.name}" rollout to finish: ${s.updated} out of ${d.replicas} new replicas have been updated...` : s.total > s.updated ? `Waiting for deployment "${d.name}" rollout to finish: ${s.total - s.updated} old replicas are pending termination...` : `Waiting for deployment "${d.name}" rollout to finish: ${s.available} of ${d.replicas} updated replicas are available...`;
      if (msg !== last) c.out(msg + '\n');
      last = msg;
      if (k.a.clock - start >= timeoutMs) throw new KErr('error: timed out waiting for the condition');
      k.a.clock += 5000;
      tick(k.a);
    }
  }
  if (sub === 'history') {
    c.out(`deployment.apps/${d.name}\nREVISION  CHANGE-CAUSE\n${[...d.history.map((h) => h.revision), d.revision].map((r) => `${r}         <none>`).join('\n')}\n`);
    return 0;
  }
  if (sub === 'undo') {
    const target = p.f['to-revision'] ? d.history.find((h) => h.revision === Number(p.f['to-revision'])) : d.history[d.history.length - 1];
    if (!target) throw new KErr(`error: no rollout history found for deployment "${d.name}"`);
    d.history = d.history.filter((h) => h !== target);
    roll(d, target.containers, now);
    c.out(`deployment.apps/${d.name} rolled back\n`);
    return 0;
  }
  if (sub === 'restart') {
    d.restartNonce = String(now);
    roll(d, d.containers, now);
    d.hash = hashOf(d.containers, d.restartNonce);
    d.revision++;
    c.out(`deployment.apps/${d.name} restarted\n`);
    return 0;
  }
  throw new KErr(`error: unknown subcommand "${sub ?? ''}" for "kubectl rollout"`);
}

const parseDuration = (s: string): number => {
  const m = /^(\d+)(s|m|h)?$/.exec(s);
  return m ? Number(m[1]) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1) : 30;
};

function cmdCreate(c: Ctx, k: K, p: Parsed, now: number): number {
  const ns = p.f.namespace ?? 'default';
  const what = p.pos[0];
  if (what === 'namespace' || what === 'ns') {
    const name = p.pos[1];
    c.out(applyDocs(k, `kind: Namespace\nmetadata:\n  name: ${name}\n`, true, now).join('\n') + '\n');
    return 0;
  }
  if (what !== 'deployment' && what !== 'deploy') throw new KErr(`error: unknown resource "${what ?? ''}" for "kubectl create" in this simulator (use deployment, namespace or -f)`);
  const name = p.pos[1];
  const image = p.f.image;
  if (!name) throw new KErr('error: NAME is required for create deployment');
  if (!image) throw new KErr('error: required flag(s) "image" not set');
  need(k, 'write', 'create', 'deployments', ns);
  const cn = (image.split('/').pop() ?? image).split(':')[0].split('@')[0];
  const doc = { kind: 'Deployment', metadata: { name, namespace: ns, labels: { app: name } }, spec: { replicas: p.f.replicas ? Number(p.f.replicas) : 1, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name: cn, image, ...(p.f.port ? { ports: [{ containerPort: Number(p.f.port) }] } : {}) }] } } } };
  if (k.cl.k8s.deployments[`${ns}/${name}`]) throw new KErr(`Error from server (AlreadyExists): deployments.apps "${name}" already exists`);
  k.cl.k8s.deployments[`${ns}/${name}`] = makeDeployment(doc, ns, now);
  c.out(`deployment.apps/${name} created\n`);
  return 0;
}

function cmdExpose(c: Ctx, k: K, p: Parsed, now: number): number {
  const ns = p.f.namespace ?? 'default';
  const kindArg = p.pos[0];
  const ref = p.pos[1];
  if (!kindArg || !ref) throw new KErr('error: you must provide one or more resources by argument or filename');
  need(k, 'write', 'create', 'services', ns);
  let selector: Record<string, string>;
  let containerPort: number | undefined;
  if (kindArg.startsWith('deploy')) {
    const d = findDeploy(k, ref, ns);
    selector = d.selector;
    containerPort = d.containers[0].ports[0];
  } else if (kindArg === 'pod' || kindArg === 'pods' || kindArg === 'po') {
    const pod = k.cl.k8s.pods[`${ns}/${ref}`];
    if (!pod) throw new KErr(`Error from server (NotFound): pods "${ref}" not found`);
    selector = pod.labels;
    containerPort = pod.containers[0].ports[0];
  } else throw new KErr(`error: cannot expose a ${kindArg}`);
  const port = p.f.port ? Number(p.f.port) : containerPort;
  if (!port) throw new KErr('error: couldn\'t find port via --port flag or introspection\nSee \'kubectl expose -h\' for help and examples');
  const name = p.f.name ?? ref.split('/').pop()!;
  const key = `${ns}/${name}`;
  if (k.cl.k8s.services[key]) throw new KErr(`Error from server (AlreadyExists): services "${name}" already exists`);
  k.cl.k8s.services[key] = makeService({ metadata: { name }, spec: { type: p.f.type ?? 'ClusterIP', selector, ports: [{ port, targetPort: p.f['target-port'] ? Number(p.f['target-port']) : port }] } }, ns, now, undefined, k);
  c.out(`service/${name} exposed\n`);
  return 0;
}

function cmdRun(c: Ctx, k: K, p: Parsed, now: number): number {
  const ns = p.f.namespace ?? 'default';
  const name = p.pos[0];
  if (!name) throw new KErr('error: NAME is required for run');
  if (!p.f.image) throw new KErr('error: required flag(s) "image" not set');
  need(k, 'write', 'create', 'pods', ns);
  if (k.cl.k8s.pods[`${ns}/${name}`]) throw new KErr(`Error from server (AlreadyExists): pods "${name}" already exists`);
  const containers: K8sContainer[] = [{ name, image: p.f.image, env: [], ports: p.f.port ? [Number(p.f.port)] : [], cpu: 0, mem: 0, ...(p.rest.length ? { args: p.rest } : {}) }];
  newPod(k.cl, { name, ns, labels: { run: name }, containers, hash: hashOf(containers) }, now);
  c.out(`pod/${name} created\n`);
  return 0;
}

function cmdWait(c: Ctx, k: K, p: Parsed): number {
  const cond = (p.f.for ?? '').replace(/^condition=/, '').toLowerCase();
  if (!['available', 'ready'].includes(cond)) throw new KErr(`error: unrecognized condition: "${p.f.for ?? ''}"`);
  const ns = p.f.namespace ?? 'default';
  const timeout = parseDuration(p.f.timeout ?? '30s') * 1000;
  const start = k.a.clock;
  const first = p.pos[0] ?? '';
  const check = (): string[] | null => {
    if (first.startsWith('deploy')) {
      const d = findDeploy(k, first, ns);
      const s = deployStatus(k, d, k.a.clock);
      return s.available >= d.replicas && s.updated >= d.replicas && s.total === s.updated ? [`deployment.apps/${d.name}`] : null;
    }
    const pods = first.startsWith('pod/') ? [k.cl.k8s.pods[`${ns}/${first.slice(4)}`]].filter(Boolean) : podsOf(k, p, k.a.clock);
    if (!pods.length) throw new KErr(`error: no matching resources found`);
    return pods.every((x) => podReady(x, k.a.clock)) ? pods.map((x) => `pod/${x.name}`) : null;
  };
  for (;;) {
    k8sSync(k.a, k.region, k.cl, k.a.clock);
    const ok = check();
    if (ok) {
      c.out(ok.map((x) => `${x} condition met`).join('\n') + '\n');
      return 0;
    }
    if (k.a.clock - start >= timeout) throw new KErr(`error: timed out waiting for the condition on ${first.includes('/') ? first.replace('deploy/', 'deployments/').replace('deployment/', 'deployments/') : 'pods'}`);
    k.a.clock += 5000;
    tick(k.a);
  }
}

function cmdConfig(c: Ctx, io: AwsIO, p: Parsed): number {
  const path = kubeconfigPath(io);
  const text = io.readFile(path);
  const cfg = readKubeconfig(text);
  const sub = p.pos[0];
  if (sub === 'current-context') {
    if (!cfg || !cfg.current) throw new KErr('error: current-context is not set');
    c.out(cfg.current + '\n');
    return 0;
  }
  if (sub === 'get-contexts') {
    const names = Object.keys(cfg?.contexts ?? {});
    c.out(table([['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'], ...names.map((n) => [cfg!.current === n ? '*' : '', n, n, n, ''])]));
    return 0;
  }
  if (sub === 'use-context') {
    const name = p.pos[1];
    if (!cfg || !name || !cfg.contexts[name]) throw new KErr(`error: no context exists with the name: "${name ?? ''}"`);
    io.writeFile(path, (text ?? '').replace(/^current-context:.*$/m, `current-context: ${name}`));
    c.out(`Switched to context "${name}".\n`);
    return 0;
  }
  if (sub === 'view') {
    c.out(text ?? 'apiVersion: v1\nclusters: null\ncontexts: null\ncurrent-context: ""\nkind: Config\npreferences: {}\nusers: null\n');
    return 0;
  }
  throw new KErr(`error: unknown command "${sub ?? ''}" for "kubectl config"`);
}

const USAGE = `kubectl controls the Kubernetes cluster manager.

 Basic Commands (Beginner):
  create        Create a resource from a file or from stdin
  expose        Take a replication controller, service, deployment or pod and expose it as a new Kubernetes service
  run           Run a particular image on the cluster

 Basic Commands (Intermediate):
  get           Display one or many resources
  delete        Delete resources by file names, stdin, resources and names, or by resources and label selector

 Deploy Commands:
  rollout       Manage the rollout of a resource
  scale         Set a new size for a deployment, replica set, or replication controller

 Cluster Management Commands:
  cluster-info  Display cluster information

 Troubleshooting and Debugging Commands:
  describe      Show details of a specific resource or group of resources
  logs          Print the logs for a container in a pod
  wait          Wait for a specific condition on one or many resources

 Advanced Commands:
  apply         Apply a configuration to a resource by file name or stdin

 Settings Commands:
  set           Set specific features on objects

 Other Commands:
  config        Modify kubeconfig files
  version       Print the client and server version information

Usage:
  kubectl [flags] [options]
`;

async function run(c: Ctx, acct: Account): Promise<number> {
  const io = ioFromCtx(c, acct);
  const [sub, ...rest] = c.args;
  const p = parse(rest);
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    c.out(USAGE);
    return 0;
  }
  if (sub === 'config') return cmdConfig(c, io, p);
  if (sub === 'version' && (p.b.has('client') || p.b.has('short') && false)) {
    c.out('Client Version: v1.32.3\nKustomize Version: v5.5.0\n');
    return 0;
  }
  const k = connect(acct, io, p);
  const now = acct.clock;
  k8sSync(acct, k.region, k.cl, now);
  switch (sub) {
    case 'version':
      c.out(`Client Version: v1.32.3\nKustomize Version: v5.5.0\nServer Version: ${VERSION.replace('-eks-473151a', '-eks-473151a')}\n`);
      return 0;
    case 'cluster-info':
      c.out(`Kubernetes control plane is running at ${k.cl.endpoint}\nCoreDNS is running at ${k.cl.endpoint}/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.\n`);
      return 0;
    case 'get':
      return cmdGet(c, k, p, now);
    case 'describe':
      return cmdDescribe(c, k, p, now);
    case 'apply':
    case 'create': {
      if (sub === 'create' && !p.f.filename) return cmdCreate(c, k, p, now);
      if (!p.f.filename) throw new KErr(`error: must specify one of -f and -k\n\nSee 'kubectl ${sub} -h' for help and examples`);
      const text = await readManifest(c, io, p.f.filename);
      c.out(applyDocs(k, text, sub === 'create', now).join('\n') + '\n');
      return 0;
    }
    case 'delete': {
      if (p.f.filename) return cmdDelete(c, k, p, now, await readManifest(c, io, p.f.filename));
      return cmdDelete(c, k, p, now);
    }
    case 'logs':
      return cmdLogs(c, k, p, now);
    case 'scale':
      return cmdScale(c, k, p, now);
    case 'set':
      return cmdSet(c, k, p, now);
    case 'rollout':
      return await cmdRollout(c, k, p, now);
    case 'expose':
      return cmdExpose(c, k, p, now);
    case 'run':
      return cmdRun(c, k, p, now);
    case 'wait':
      return cmdWait(c, k, p);
    case 'top':
      throw new KErr('error: Metrics API not available');
    case 'exec':
    case 'port-forward':
    case 'cp':
      throw new KErr(`error: ${sub} is not available in this simulator (use the AWS CLI and the service URL instead)`);
    case 'auth': {
      if (p.pos[0] !== 'can-i') throw new KErr(`error: unknown command "${p.pos[0] ?? ''}" for "kubectl auth"`);
      const verb = p.pos[1] ?? 'get';
      const res = KINDS[(p.pos[2] ?? '').toLowerCase()] ?? p.pos[2] ?? 'pods';
      c.out(allowed(k, ['get', 'list', 'watch'].includes(verb) ? 'read' : 'write', p.b.has('all-namespaces') || res === 'nodes' ? null : p.f.namespace ?? 'default') ? 'yes\n' : 'no\n');
      return 0;
    }
    default:
      throw new KErr(`error: unknown command "${sub}" for "kubectl"\n\nDid you mean this?\n\tget\nRun 'kubectl --help' for usage.`);
  }
}

defineCommand(
  'kubectl',
  {
    summary: 'kubectl (simulado): el cliente de Kubernetes para clústeres de EKS',
    usage: 'kubectl <orden> [opciones]',
    category: 'redes',
    noHelp: true,
    level: 3,
    examples: [['kubectl get nodes', 'lista los nodos del clúster'], ['kubectl apply -f app.yaml', 'crea o actualiza lo que describe el manifiesto']],
  },
  async (c) => {
    const acct = awsAccountOf(c.sh.sys);
    if (!acct) return c.fail('command not found', 127);
    const sysClock = c.sh.sys.clock;
    acct.clock = Math.max(acct.clock, sysClock.now);
    tick(acct);
    let rc: number;
    try {
      rc = await run(c, acct);
    } catch (e) {
      if (!(e instanceof KErr)) throw e;
      c.err(e.message + '\n');
      rc = e.code;
    }
    sysClock.now = Math.max(sysClock.now, acct.clock);
    return rc;
  },
);

