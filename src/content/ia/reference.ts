/** Referencia del curso de IA para la «Biblioteca» (NumPy, gráficas, aprendizaje automático, LLMs…), con ejemplos ejecutables. */
import type { PyRef } from '../py/reference';
import { CONCEPTOS_REFS } from './ref/conceptos';
import { MATEMATICAS_REFS } from './ref/matematicas';
import { NUMPY_REFS } from './ref/numpy';

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

export const IA_REFERENCE: IaRef[] = [...CONCEPTOS_REFS, ...NUMPY_REFS, ...MATEMATICAS_REFS];

export const iaRefByName = (name: string): IaRef | undefined => IA_REFERENCE.find((r) => r.name === name);
