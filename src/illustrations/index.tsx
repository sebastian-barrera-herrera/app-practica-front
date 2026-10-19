import React from 'react';
import type { IllustrationId } from '@/content/types';
import { AptFlow, BootSequence, DnsLookup, NetRoute, SshHandshake, SudoFlow } from './Flows';
import { FsTree } from './FsTree';
import { Missing } from './Missing';
import { PathWalk } from './PathWalk';
import { ShellVsKernel } from './ShellVsKernel';
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
};

export function Illustration({ id }: { id: IllustrationId }) {
  const C = MAP[id];
  if (!C) return <Missing id={id} />;
  return <C />;
}

export const IMPLEMENTED = Object.keys(MAP);
