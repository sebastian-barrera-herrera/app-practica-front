/** Almacén de métricas de CloudWatch: lo que publica el alumno con `put-metric-data` y lo que registran los servicios (Lambda, SQS…). */
import { regional } from '../account';
import type { Account } from '../types';
import type { CwMetric, CwSample, CwState } from '../types-ops';

export const cwOf = (a: Account, region: string): CwState => {
  const r = regional(a, region);
  return (r.cw ??= { metrics: {}, dashboards: {}, composites: {}, history: [] });
};

export const metricKey = (ns: string, name: string, dims: Record<string, string>): string => `${ns}\u0001${name}\u0001${Object.keys(dims).sort().map((k) => `${k}=${dims[k]}`).join('\u0002')}`;

const MAX_SAMPLES = 6000;
const RETENTION_MS = 15 * 24 * 3600 * 1000;

export interface PutSample {
  t?: number;
  value?: number;
  sum?: number;
  n?: number;
  min?: number;
  max?: number;
  unit?: string;
}

/** Añade una muestra a una métrica (la crea si no existe). */
export function cwPut(a: Account, region: string, ns: string, name: string, dims: Record<string, string>, s: PutSample): void {
  const st = cwOf(a, region);
  const key = metricKey(ns, name, dims);
  const m: CwMetric = (st.metrics[key] ??= { ns, name, dims, unit: s.unit, samples: [] });
  if (s.unit && !m.unit) m.unit = s.unit;
  const t = s.t ?? a.clock;
  const sample: CwSample =
    s.value !== undefined
      ? { t, sum: s.value * (s.n ?? 1), n: s.n ?? 1, min: s.value, max: s.value }
      : { t, sum: s.sum ?? 0, n: s.n ?? 1, min: s.min ?? 0, max: s.max ?? 0 };
  const last = m.samples[m.samples.length - 1];
  m.samples.push(sample);
  if (last && last.t > t) m.samples.sort((x, y) => x.t - y.t);
  if (m.samples.length > MAX_SAMPLES) m.samples.splice(0, m.samples.length - MAX_SAMPLES);
  const cut = a.clock - RETENTION_MS;
  while (m.samples.length && m.samples[0].t < cut) m.samples.shift();
}

export const cwFind = (a: Account, region: string, ns: string, name: string, dims: Record<string, string>): CwMetric | undefined => cwOf(a, region).metrics[metricKey(ns, name, dims)];
