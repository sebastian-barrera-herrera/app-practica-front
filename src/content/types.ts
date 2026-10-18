import type { Check } from '@/engine/check';
import type { Files, WorldOptions } from '@/engine/world';

export type LevelId = 'basico' | 'intermedio' | 'avanzado';

export type IllustrationId =
  | 'terminal-anatomy'
  | 'fs-tree'
  | 'path-walk'
  | 'pipe-flow'
  | 'streams'
  | 'perm-bits'
  | 'process-states'
  | 'links'
  | 'net-route'
  | 'grep-scan'
  | 'boot-sequence'
  | 'cron-fields'
  | 'apt-flow'
  | 'glob-expansion'
  | 'ssh-handshake'
  | 'users-groups'
  | 'exit-status'
  | 'env-inherit'
  | 'tar-box'
  | 'shell-vs-kernel'
  | 'ls-long'
  | 'redirect-targets'
  | 'signals'
  | 'regex-cheat'
  | 'awk-fields'
  | 'script-anatomy'
  | 'sudo-flow'
  | 'dns-lookup';

// ───────────────────────── preguntas ─────────────────────────

export type Question =
  | { t: 'mc'; q: string; options: string[]; answer: number; why: string; code?: string }
  | { t: 'multi'; q: string; options: string[]; answers: number[]; why: string }
  | { t: 'tf'; q: string; answer: boolean; why: string }
  /** Escribir un comando. `answers` son formas aceptadas exactas; `check` valida estado/salida ejecutándolo. */
  | { t: 'cmd'; q: string; answers: string[]; why: string; hint?: string; regex?: string; setup?: WorldOptions; check?: Check }
  /** Ordenar piezas para formar un comando. */
  | { t: 'order'; q: string; pieces: string[]; answer: string; why: string; alt?: string[] }
  /** Unir pares. */
  | { t: 'match'; q: string; pairs: [string, string][]; why: string }
  /** Rellenar huecos con opciones. */
  | { t: 'fill'; q: string; template: string; options: string[]; answers: string[]; why: string }
  /** Predecir la salida: la respuesta correcta se obtiene ejecutando `cmd` en `setup`. */
  | { t: 'output'; q: string; cmd: string; setup?: WorldOptions; wrong: string[]; why: string };

export type QuestionKind = Question['t'];

// ───────────────────────── retos de terminal ─────────────────────────

export interface Challenge {
  id: string;
  /** Enunciado en Markdown ligero. */
  prompt: string;
  /** Meta corta, una línea. */
  goal: string;
  setup?: WorldOptions;
  check: Check;
  /** Solución de referencia (se verifica en los tests). */
  solution: string[];
  hints: string[];
  /** Explicación que se muestra al resolver. */
  explain: string;
  /** Nº óptimo de comandos (para bonificación de eficiencia). */
  par?: number;
  /** Comandos que se enseñan/practican aquí. */
  commands?: string[];
  /** El reto debe estar completo tras ejecutar los comandos, y no antes. */
  expectInitialFail?: boolean;
}

// ───────────────────────── pasos de lección ─────────────────────────

export interface DemoLine {
  /** Comando que se escribe y ejecuta. */
  cmd: string;
  /** Explicación bajo la salida. */
  note?: string;
}

export type Step =
  | { type: 'learn'; title?: string; body: string; emoji?: string }
  | { type: 'demo'; title?: string; lines: DemoLine[]; setup?: WorldOptions; intro?: string }
  | { type: 'illustration'; id: IllustrationId; title?: string; caption?: string }
  | { type: 'quiz'; q: Question }
  | { type: 'practice'; challenge: Challenge };

export interface Lesson {
  id: string;
  title: string;
  /** Una línea: qué vas a aprender. */
  summary: string;
  emoji: string;
  /** Comandos que cubre (para la biblioteca y el repaso). */
  commands: string[];
  steps: Step[];
  /** Minutos estimados. */
  minutes: number;
}

export interface WorldDef {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  emoji: string;
  /** Color de acento (hex). */
  color: string;
  level: LevelId;
  lessons: Lesson[];
  /** Presentación narrativa de la zona. */
  intro: string;
  /** Misión final integradora (opcional). */
  boss?: Challenge;
}

export interface LevelDef {
  id: LevelId;
  title: string;
  subtitle: string;
  color: string;
  emoji: string;
}

// ───────────────────────── texto enriquecido ─────────────────────────

export type Block =
  | { k: 'h'; t: string }
  | { k: 'p'; t: string }
  | { k: 'list'; items: string[]; ordered?: boolean }
  | { k: 'code'; lines: string[] }
  | { k: 'callout'; kind: 'tip' | 'warn' | 'note' | 'key'; t: string }
  | { k: 'table'; head: string[]; rows: string[][] };

export type InlineSpan = { t: 'text' | 'b' | 'i' | 'code'; s: string };

export type { Check, Files, WorldOptions };
