import React from 'react';
import type { IllustrationId } from '@/content/types';
import { GlobalInfra, ServiceModels, SharedResponsibility } from './AwsFoundations';
import { Ec2Lifecycle, EbsVsStore, PurchaseModels } from './AwsCompute';
import { PolicyEval, StsAssume } from './AwsIam';
import { DbChooser, DdbPartition, MultiAz } from './AwsData';
import { OrgTree, PriceCalc, SupportPlans } from './AwsCosts';
import { EndpointPaths, FlowReach, HybridChooser, PeeringTgw, SsmAccess } from './AwsConnect';
import { CachePatterns, DdbHotKey, DdbStreams, MigrationPaths, RdsProxyPool } from './AwsDeepData';
import { ApiFlow, CognitoFlow, EventRouting, LambdaLifecycle, SqsVisibility } from './AwsServerless';
import { AsgScale, CloudfrontFlow, ElbFlow, R53Policies, Spof } from './AwsHa';
import { CidrCalc, DnsFlow, PacketTrace, SgVsNacl, VpcLayout } from './AwsNetwork';
import { S3Classes, S3Security } from './AwsStorage';
import { AptFlow, BootSequence, DnsLookup, NetRoute, SshHandshake, SudoFlow } from './Flows';
import { FsTree } from './FsTree';
import { Missing } from './Missing';
import { CallStack, Collections, Comprehension, ExceptionsFlow, FileModes, IfFlow, ImportPath, LoopFlow, Mutability, Precedence, ScopeLegb, StrIndex, TypesMap, VariablesLabels } from './PyBasics';
import { BigO, ClassInstance, DecoratorWrap, EventLoop, GeneratorPause, IteratorProtocol, Mro, RecursionTree } from './PyAdvanced';
import { PathWalk } from './PathWalk';
import { ShellVsKernel } from './ShellVsKernel';
import { TableAnatomy } from './SqlBasics';
import { EvalOrder, GroupFlow, JoinTypes, SetOps } from './SqlQuery';
import { ErModel, Normalization } from './SqlDesign';
import { IndexTree, Transaction, WindowFrame } from './SqlAdvanced';
import { CronFields, ProcessStates, Signals, TarBox, UsersGroups } from './SystemViz';
import { TerminalAnatomy } from './TerminalAnatomy';
import { AwkFields, EnvInherit, ExitStatus, GlobExpansion, GrepScan, LsLong, PermBits, PipeFlow, RegexCheat, ScriptAnatomy, Streams } from './TextTools';

const MAP: Partial<Record<IllustrationId, React.ComponentType>> = {
  'shell-vs-kernel': ShellVsKernel,
  'terminal-anatomy': TerminalAnatomy,
  'fs-tree': FsTree,
  'path-walk': PathWalk,
  'ls-long': LsLong,
  'perm-bits': PermBits,
  'glob-expansion': GlobExpansion,
  streams: Streams,
  'pipe-flow': PipeFlow,
  'grep-scan': GrepScan,
  'regex-cheat': RegexCheat,
  'awk-fields': AwkFields,
  'exit-status': ExitStatus,
  'env-inherit': EnvInherit,
  'script-anatomy': ScriptAnatomy,
  'process-states': ProcessStates,
  signals: Signals,
  'cron-fields': CronFields,
  'users-groups': UsersGroups,
  'tar-box': TarBox,
  'net-route': NetRoute,
  'dns-lookup': DnsLookup,
  'ssh-handshake': SshHandshake,
  'sudo-flow': SudoFlow,
  'apt-flow': AptFlow,
  'boot-sequence': BootSequence,
  // Python
  'py-variables-labels': VariablesLabels,
  'py-mutability': Mutability,
  'py-types-map': TypesMap,
  'py-precedence': Precedence,
  'py-str-index': StrIndex,
  'py-if-flow': IfFlow,
  'py-loop-flow': LoopFlow,
  'py-call-stack': CallStack,
  'py-scope-legb': ScopeLegb,
  'py-comprehension': Comprehension,
  'py-collections': Collections,
  'py-exceptions-flow': ExceptionsFlow,
  'py-file-modes': FileModes,
  'py-import-path': ImportPath,
  'py-class-instance': ClassInstance,
  'py-mro': Mro,
  'py-iterator-protocol': IteratorProtocol,
  'py-generator-pause': GeneratorPause,
  'py-decorator-wrap': DecoratorWrap,
  'py-event-loop': EventLoop,
  'py-recursion-tree': RecursionTree,
  'py-big-o': BigO,
  // SQL
  'sql-table-anatomy': TableAnatomy,
  'sql-eval-order': EvalOrder,
  'sql-group-flow': GroupFlow,
  'sql-join-types': JoinTypes,
  'sql-set-ops': SetOps,
  'sql-er-model': ErModel,
  'sql-normalization': Normalization,
  'sql-window-frame': WindowFrame,
  'sql-index-tree': IndexTree,
  'sql-transaction': Transaction,
  // AWS
  'aws-service-models': ServiceModels,
  'aws-global-infra': GlobalInfra,
  'aws-shared-responsibility': SharedResponsibility,
  'aws-policy-eval': PolicyEval,
  'aws-sts-assume': StsAssume,
  'aws-ec2-lifecycle': Ec2Lifecycle,
  'aws-ebs-vs-store': EbsVsStore,
  'aws-purchase-models': PurchaseModels,
  'aws-s3-classes': S3Classes,
  'aws-s3-security': S3Security,
  'aws-cidr-calc': CidrCalc,
  'aws-vpc-layout': VpcLayout,
  'aws-packet-trace': PacketTrace,
  'aws-sg-vs-nacl': SgVsNacl,
  'aws-dns-flow': DnsFlow,
  'aws-db-chooser': DbChooser,
  'aws-multi-az': MultiAz,
  'aws-ddb-partition': DdbPartition,
  'aws-price-calc': PriceCalc,
  'aws-support-plans': SupportPlans,
  'aws-org-tree': OrgTree,
  'aws-elb-flow': ElbFlow,
  'aws-asg-scale': AsgScale,
  'aws-spof': Spof,
  'aws-r53-policies': R53Policies,
  'aws-cloudfront-flow': CloudfrontFlow,
  'aws-peering-tgw': PeeringTgw,
  'aws-endpoint-paths': EndpointPaths,
  'aws-hybrid-chooser': HybridChooser,
  'aws-flow-reach': FlowReach,
  'aws-ssm-access': SsmAccess,
  'aws-lambda-lifecycle': LambdaLifecycle,
  'aws-apigw-flow': ApiFlow,
  'aws-sqs-visibility': SqsVisibility,
  'aws-event-routing': EventRouting,
  'aws-cognito-flow': CognitoFlow,
  'aws-ddb-hotkey': DdbHotKey,
  'aws-ddb-streams': DdbStreams,
  'aws-rds-proxy': RdsProxyPool,
  'aws-cache-patterns': CachePatterns,
  'aws-migration': MigrationPaths,
};

export function Illustration({ id }: { id: IllustrationId }) {
  const C = MAP[id];
  if (!C) return <Missing id={id} />;
  return <C />;
}

export const IMPLEMENTED = Object.keys(MAP);
