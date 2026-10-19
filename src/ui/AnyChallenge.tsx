import React from 'react';
import { isPyChallenge, type AnyChallenge, type CourseId } from '@/content/types';
import { ChallengeView, type SolvedInfo } from './ChallengeView';
import { PyChallengeView } from './PyChallengeView';

interface Props {
  course: CourseId;
  challenge: AnyChallenge;
  onSolved: (info: SolvedInfo) => void;
  /** Se invoca por cada ejecución (comando o programa) para las estadísticas. */
  onRun?: (line: string) => void;
  continueLabel?: string;
  /** Examen: sin pistas ni solución. */
  strict?: boolean;
}

/** Muestra el reto con el entorno de su curso: terminal (Linux) o editor de código (Python). */
export function AnyChallengeView({ challenge, ...rest }: Props) {
  if (isPyChallenge(challenge)) return <PyChallengeView challenge={challenge} {...rest} />;
  return <ChallengeView challenge={challenge} {...rest} />;
}
