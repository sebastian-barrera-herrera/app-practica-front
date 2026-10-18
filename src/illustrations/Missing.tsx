import React from 'react';
import { T } from '@/ui/Text';
import { Frame } from './common';

export function Missing({ id }: { id: string }) {
  return (
    <Frame>
      <T color="#9FB0DD">Ilustración «{id}» pendiente</T>
    </Frame>
  );
}
