import React from 'react';
import { isPyChallenge, isSqlChallenge, type AnyChallenge, type CourseId } from '@/content/types';
import { ChallengeView, type SolvedInfo } from './ChallengeView';
import { PyChallengeView } from './PyChallengeView';
import { SqlChallengeView } from './SqlChallengeView';

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

/** Muestra el reto con el entorno de su curso: terminal (Linux), editor de código (Python) o editor de SQL. */
export function AnyChallengeView({ challenge, ...rest }: Props) {
  if (isPyChallenge(challenge)) return <PyChallengeView challenge={challenge} {...rest} />;
  if (isSqlChallenge(challenge)) return <SqlChallengeView challenge={challenge} {...rest} />;
  return <ChallengeView challenge={challenge} {...rest} />;
}
