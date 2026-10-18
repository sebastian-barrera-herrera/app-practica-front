import React from 'react';
import type { IllustrationId } from '@/content/types';
import { FsTree } from './FsTree';
import { PathWalk } from './PathWalk';
import { ShellVsKernel } from './ShellVsKernel';
import { TerminalAnatomy } from './TerminalAnatomy';
import { Missing } from './Missing';

const MAP: Partial<Record<IllustrationId, React.ComponentType>> = {
  'shell-vs-kernel': ShellVsKernel,
  'terminal-anatomy': TerminalAnatomy,
  'fs-tree': FsTree,
  'path-walk': PathWalk,
};

export function Illustration({ id }: { id: IllustrationId }) {
  const C = MAP[id];
  if (!C) return <Missing id={id} />;
  return <C />;
}

export const IMPLEMENTED = Object.keys(MAP);
