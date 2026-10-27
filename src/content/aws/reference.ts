/** Biblioteca de AWS: fichas de servicios, conceptos y comandos con «cuándo usarlo y cuándo no» y ejemplos que se ejecutan en el simulador. */
import { AWS_REF_BASICS } from './ref/basics';
import { AWS_REF_IAM } from './ref/iam';
import { AWS_REF_EC2 } from './ref/ec2';
import { AWS_REF_S3 } from './ref/s3';
import { AWS_REF_NET } from './ref/net';
import { AWS_REF_DATA } from './ref/data';
import { AWS_REF_COST } from './ref/cost';
import { AWS_REF_HA } from './ref/ha';
import { AWS_REF_CONN } from './ref/conn';
import { AWS_REF_SERVERLESS } from './ref/serverless';

export type AwsRefCategory = 'fundamentos' | 'identidad' | 'computo' | 'almacenamiento' | 'costes' | 'redes' | 'datos' | 'seguridad' | 'operaciones' | 'integracion' | 'cli';

export const AWS_REF_CATEGORY: Record<AwsRefCategory, string> = {
  fundamentos: '☁️ Fundamentos',
  identidad: '🔐 Identidad (IAM)',
  computo: '🖥️ Cómputo',
  almacenamiento: '🪣 Almacenamiento',
  costes: '💰 Costes',
  redes: '🌐 Redes',
  datos: '🗄️ Bases de datos',
  seguridad: '🛡️ Seguridad',
  operaciones: '🔭 Operaciones',
  integracion: '⚡ Serverless e integración',
  cli: '⌨️ CLI y herramientas',
};

/** Ejemplo ejecutable: [comando, nota?, 'error'?]. Con 'error' el comando falla a propósito (y el test lo exige). */
export type AwsExample = [string] | [string, string] | [string, string, 'error'];

export interface AwsRef {
  /** Nombre único: «IAM», «S3», «Security group», «aws s3 sync»… */
  name: string;
  kind: 'servicio' | 'concepto' | 'comando' | 'buena práctica' | 'comparativa';
  category: AwsRefCategory;
  /** 1 = básico · 2 = intermedio · 3 = avanzado */
  level: 1 | 2 | 3;
  summary: string;
  /** Texto enriquecido (mismo formato que las lecciones). */
  details?: string;
  whenUse?: string[];
  whenNot?: string[];
  /** Cómo se cobra, en palabras (los precios cambian: aquí solo el modelo). */
  pricing?: string;
  /** Límites típicos (cuotas por defecto; verifícalos en la documentación oficial). */
  limits?: string[];
  /** «X frente a Y»: una línea por alternativa. */
  versus?: [string, string][];
  /** Forma de uso (para comandos). */
  usage?: string;
  /** Escenario del simulador sobre el que se ejecutan los ejemplos. */
  scenario?: string;
  examples?: AwsExample[];
  seeAlso?: string[];
}

export const AWS_REFERENCE: AwsRef[] = [...AWS_REF_BASICS, ...AWS_REF_IAM, ...AWS_REF_EC2, ...AWS_REF_S3, ...AWS_REF_NET, ...AWS_REF_DATA, ...AWS_REF_COST, ...AWS_REF_HA, ...AWS_REF_CONN, ...AWS_REF_SERVERLESS];

export const awsRefByName = (name: string): AwsRef | undefined => AWS_REFERENCE.find((r) => r.name === name);
