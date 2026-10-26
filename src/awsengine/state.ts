/** Dónde guarda el mundo de Linux la cuenta de AWS simulada. */
import type { Account } from './types';

export const AWS_KEY = 'aws';

export const awsAccountOf = (sys: { ext: Record<string, unknown> }): Account | undefined => sys.ext[AWS_KEY] as Account | undefined;
