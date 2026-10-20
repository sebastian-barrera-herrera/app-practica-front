/** Referencia de Python para la «Biblioteca» (funciones, métodos, sentencias y módulos con ejemplos ejecutables). */
import { BASICOS } from './ref/basicos';
import { BUCLES } from './ref/bucles';
import { COLECCIONES } from './ref/colecciones';
import { CONTROL } from './ref/control';
import { ESTILO } from './ref/estilo';
import { FUNCIONES } from './ref/funciones';
import { TEXTO } from './ref/texto';


export type PyRefCategory = 'basicos' | 'texto' | 'listas' | 'dicts' | 'control' | 'funciones' | 'clases' | 'errores' | 'archivos' | 'stdlib' | 'avanzado';

export const PY_REF_CATEGORY: Record<PyRefCategory, string> = {
  basicos: '🔰 Básicos',
  texto: '📝 Texto',
  listas: '📋 Listas y tuplas',
  dicts: '🗂️ Diccionarios y conjuntos',
  control: '🔀 Control de flujo',
  funciones: '🧩 Funciones',
  clases: '🏛️ Clases y objetos',
  errores: '🛡️ Errores',
  archivos: '📄 Archivos',
  stdlib: '📚 Librería estándar',
  avanzado: '🚀 Avanzado',
};

export interface PyRef {
  /** Nombre único: «len», «str.split», «list.append», «for», «json.dumps»… */
  name: string;
  kind: 'función' | 'método' | 'sentencia' | 'módulo' | 'tipo' | 'concepto';
  category: PyRefCategory;
  /** 1 = básico · 2 = intermedio · 3 = avanzado */
  level: 1 | 2 | 3;
  /** Una línea: qué hace. */
  summary: string;
  /** Firma o forma de uso, p. ej. «len(objeto) → int». */
  usage: string;
  /** Texto enriquecido opcional (mismo formato que las lecciones). */
  details?: string;
  /** Ejemplos [código, nota]: se pueden ejecutar desde la ficha. */
  examples: ([string] | [string, string])[];
  seeAlso?: string[];
}

export const PY_REFERENCE: PyRef[] = [...BASICOS, ...TEXTO, ...CONTROL, ...BUCLES, ...COLECCIONES, ...FUNCIONES, ...ESTILO];

export const refByName = (name: string): PyRef | undefined => PY_REFERENCE.find((r) => r.name === name);
