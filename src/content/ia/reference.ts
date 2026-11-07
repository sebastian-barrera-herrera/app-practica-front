/** Referencia del curso de IA para la «Biblioteca» (NumPy, gráficas, aprendizaje automático, LLMs…), con ejemplos ejecutables. */
import type { PyRef } from '../py/reference';
import { CLASIFICACION_REFS } from './ref/clasificacion';
import { CONCEPTOS_REFS } from './ref/conceptos';
import { EVALUACION_REFS } from './ref/evaluacion';
import { MATEMATICAS_REFS } from './ref/matematicas';
import { NOSUPERVISADO_REFS } from './ref/nosupervisado';
import { NUMPY_REFS } from './ref/numpy';
import { PANDAS_REFS } from './ref/pandas';
import { PREPROCESADO_REFS } from './ref/preprocesado';
import { PYTORCH_REFS } from './ref/pytorch';
import { REDES_REFS } from './ref/redes';
import { VECTORES_REFS } from './ref/vectores';
import { REGRESION_REFS } from './ref/regresion';

export type IaRefCategory = 'numpy' | 'viz' | 'datos' | 'ml' | 'dl' | 'vectores' | 'llm' | 'agentes';

export const IA_REF_CATEGORY: Record<IaRefCategory, string> = {
  numpy: '🔢 NumPy',
  viz: '📈 Gráficas',
  datos: '🧹 Datos',
  ml: '🤖 Aprendizaje automático',
  dl: '🧠 Redes neuronales',
  vectores: '🧭 Vectores y embeddings',
  llm: '✨ IA generativa',
  agentes: '🛠️ RAG y agentes',
};

export type IaRef = PyRef<IaRefCategory>;

export const IA_REFERENCE: IaRef[] = [...CONCEPTOS_REFS, ...NUMPY_REFS, ...MATEMATICAS_REFS, ...PANDAS_REFS, ...PREPROCESADO_REFS, ...REGRESION_REFS, ...CLASIFICACION_REFS, ...EVALUACION_REFS, ...NOSUPERVISADO_REFS, ...REDES_REFS, ...PYTORCH_REFS, ...VECTORES_REFS];

export const iaRefByName = (name: string): IaRef | undefined => IA_REFERENCE.find((r) => r.name === name);
