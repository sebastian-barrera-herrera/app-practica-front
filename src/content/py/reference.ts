/** Referencia de Python para la «Biblioteca» (funciones, métodos, sentencias y módulos con ejemplos ejecutables). */

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
  examples: [string, string][];
  seeAlso?: string[];
}

export const PY_REFERENCE: PyRef[] = [
  {
    name: 'print',
    kind: 'función',
    category: 'basicos',
    level: 1,
    summary: 'Muestra valores en pantalla.',
    usage: 'print(*valores, sep=" ", end="\\n")',
    details: 'Acepta cualquier cantidad de valores y los separa con `sep`. Al final añade `end` (un salto de línea por defecto).',
    examples: [
      ['print("Hola", "mundo")', 'Separa con un espacio'],
      ['print("a", "b", "c", sep="-")', 'Cambia el separador'],
      ['print("sin salto", end="")\nprint(" ...continúa")', 'Cambia el final'],
    ],
    seeAlso: ['input', 'str.format'],
  },
  {
    name: 'len',
    kind: 'función',
    category: 'basicos',
    level: 1,
    summary: 'Cuenta los elementos de una colección o los caracteres de un texto.',
    usage: 'len(objeto) → int',
    examples: [
      ['len("python")', 'Caracteres de un texto'],
      ['len([10, 20, 30])', 'Elementos de una lista'],
      ['len({"a": 1, "b": 2})', 'Claves de un diccionario'],
    ],
  },
];

export const refByName = (name: string): PyRef | undefined => PY_REFERENCE.find((r) => r.name === name);
