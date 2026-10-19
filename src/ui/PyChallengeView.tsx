import React from 'react';
import type { PyChallenge } from '@/content/types';
import { Button } from './Button';
import { T } from './Text';
import type { SolvedInfo } from './ChallengeView';

interface Props {
  challenge: PyChallenge;
  onSolved: (info: SolvedInfo) => void;
  onRun?: (code: string) => void;
  continueLabel?: string;
  strict?: boolean;
}

/** Reto de código de Python (se sustituye por el editor real cuando el intérprete esté listo). */
export function PyChallengeView({ challenge, onSolved, continueLabel = 'Continuar' }: Props) {
  return (
    <>
      <T>{challenge.goal}</T>
      <Button label={continueLabel} onPress={() => onSolved({ commands: 1, hintsUsed: 0, usedSolution: false, ctrlC: false })} />
    </>
  );
}
