/** Referencia de SQL para la «Biblioteca»: cláusulas, funciones y patrones con ejemplos que se ejecutan sobre una base de datos de ejemplo. */
import { SQL_REF_CORE } from './ref/core';
import { SQL_REF_FUNCS } from './ref/funcs';
import { SQL_REF_ADV } from './ref/adv';

export type SqlRefCategory = 'consultar' | 'filtrar' | 'resumir' | 'unir' | 'texto' | 'numeros' | 'fechas' | 'modificar' | 'disenar' | 'ventanas' | 'rendimiento' | 'transacciones' | 'valores';

export const SQL_REF_CATEGORY: Record<SqlRefCategory, string> = {
  consultar: '🔎 Consultar',
  filtrar: '🧲 Filtrar',
  resumir: '📊 Resumir y agrupar',
  unir: '🔗 Unir tablas',
  texto: '📝 Texto',
  numeros: '🔢 Números',
  fechas: '📅 Fechas',
  modificar: '✏️ Modificar datos',
  disenar: '🏗️ Diseñar tablas',
  ventanas: '🪟 Ventanas y avanzado',
  rendimiento: '⚡ Rendimiento',
  transacciones: '🔒 Transacciones',
  valores: '🪄 Condiciones y tipos',
};

export interface SqlRef {
  /** Nombre único: «SELECT», «LEFT JOIN», «COALESCE», «ROW_NUMBER»… */
  name: string;
  kind: 'cláusula' | 'función' | 'operador' | 'sentencia' | 'patrón' | 'concepto';
  category: SqlRefCategory;
  /** 1 = básico · 2 = intermedio · 3 = avanzado */
  level: 1 | 2 | 3;
  summary: string;
  /** Forma de uso, p. ej. «COALESCE(a, b, …)». */
  usage: string;
  /** Texto enriquecido opcional (mismo formato que las lecciones). */
  details?: string;
  /** Base de datos de ejemplo sobre la que se ejecutan los ejemplos. */
  db: string;
  /** Ejemplos [sql, nota]: se pueden ejecutar desde la ficha. */
  examples: ([string] | [string, string])[];
  seeAlso?: string[];
}

export const SQL_REFERENCE: SqlRef[] = [...SQL_REF_CORE, ...SQL_REF_FUNCS, ...SQL_REF_ADV];

export const sqlRefByName = (name: string): SqlRef | undefined => SQL_REFERENCE.find((r) => r.name === name);
