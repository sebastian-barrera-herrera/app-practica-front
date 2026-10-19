import React from 'react';
import type { PyCell } from '@/content/types';
import type { PyOptions } from '@/pyengine/types';
import { T } from './Text';

/** Celdas de Python que se ejecutan paso a paso (se sustituye por la versión real con el intérprete). */
export function PyDemoView({ cells }: { cells: PyCell[]; setup?: PyOptions; intro?: string; onComplete?: () => void }) {
  return <T>{cells.map((c) => c.code).join('\n')}</T>;
}
