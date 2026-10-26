import type { Check } from '@/engine/check';
import type { Files, WorldOptions } from '@/engine/world';
import type { PyCheck, PyOptions } from '@/pyengine/types';
import type { SqlCheck, SqlSetup } from '@/sqlengine/judge';

/** Cursos disponibles. Cada curso tiene su ruta, su laboratorio, su progreso y su meta diaria. */
export type CourseId = 'linux' | 'python' | 'sql' | 'aws';

export type LevelId = 'basico' | 'intermedio' | 'avanzado';

export type IllustrationId =
  | 'terminal-anatomy'
  | 'fs-tree'
  | 'path-walk'
  | 'pipe-flow'
  | 'streams'
  | 'perm-bits'
  | 'process-states'
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
  | 'signals'
  | 'regex-cheat'
  | 'awk-fields'
  | 'script-anatomy'
  | 'sudo-flow'
  | 'dns-lookup'
  | 'py-variables-labels'
  | 'py-types-map'
  | 'py-str-index'
  | 'py-precedence'
  | 'py-if-flow'
  | 'py-loop-flow'
  | 'py-collections'
  | 'py-mutability'
  | 'py-call-stack'
  | 'py-scope-legb'
  | 'py-comprehension'
  | 'py-exceptions-flow'
  | 'py-file-modes'
  | 'py-import-path'
  | 'py-class-instance'
  | 'py-mro'
  | 'py-iterator-protocol'
  | 'py-generator-pause'
  | 'py-decorator-wrap'
  | 'py-event-loop'
  | 'py-recursion-tree'
  | 'py-big-o'
  | 'sql-table-anatomy'
  | 'sql-eval-order'
  | 'sql-join-types'
  | 'sql-group-flow'
  | 'sql-window-frame'
  | 'sql-index-tree'
  | 'sql-transaction'
  | 'sql-er-model'
  | 'sql-normalization'
  | 'sql-set-ops'
  | 'aws-service-models'
  | 'aws-global-infra'
  | 'aws-shared-responsibility'
  | 'aws-policy-eval'
  | 'aws-sts-assume'
  | 'aws-ec2-lifecycle'
  | 'aws-ebs-vs-store'
  | 'aws-purchase-models'
  | 'aws-s3-classes'
  | 'aws-s3-security'
  | 'aws-cidr-calc'
  | 'aws-vpc-layout'
  | 'aws-packet-trace'
  | 'aws-sg-vs-nacl'
  | 'aws-dns-flow'
  | 'aws-db-chooser'
  | 'aws-multi-az'
  | 'aws-ddb-partition'
  | 'aws-price-calc'
  | 'aws-support-plans'
  | 'aws-org-tree'
  | 'aws-elb-flow'
  | 'aws-asg-scale'
  | 'aws-spof'
  | 'aws-r53-policies'
  | 'aws-cloudfront-flow';

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
  | { t: 'output'; q: string; cmd: string; setup?: WorldOptions; wrong: string[]; why: string }
  /** Python: escribir código que cumpla `check` (mini reto dentro del quiz). */
  | { t: 'pycode'; q: string; starter?: string; setup?: PyOptions; check: PyCheck; solution: string; hint?: string; why: string }
  /** Python: predecir la salida. La respuesta correcta se obtiene ejecutando `code` con el intérprete. */
  | { t: 'pyout'; q: string; code: string; setup?: PyOptions; wrong: string[]; why: string }
  /** SQL: escribir una consulta (o sentencia) que se comprueba ejecutándola contra la base de datos del ejercicio. */
  | { t: 'sqlcode'; q: string; setup: SqlSetup; starter?: string; check: SqlCheck; solution: string; hint?: string; why: string }
  /** SQL: predecir el resultado de una consulta. La respuesta correcta es lo que devuelve `sql`; `wrong` son resultados falsos (en texto). */
  | { t: 'sqlout'; q: string; setup: SqlSetup; sql: string; wrong: string[]; why: string };

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

/** Reto de código Python: el alumno escribe un programa que cumple `check`. */
export interface PyChallenge {
  lang: 'py';
  id: string;
  prompt: string;
  goal: string;
  setup?: PyOptions;
  /** Código inicial del editor. */
  starter?: string;
  check: PyCheck;
  /** Solución de referencia (se verifica en los tests). */
  solution: string;
  hints: string[];
  explain: string;
  par?: number;
  /** Funciones/conceptos que se practican aquí. */
  commands?: string[];
  expectInitialFail?: boolean;
}

/** Reto de SQL: el alumno escribe una consulta o sentencia que se corrige comparando con la solución sobre la misma base de datos. */
export interface SqlChallenge {
  lang: 'sql';
  id: string;
  prompt: string;
  goal: string;
  setup: SqlSetup;
  starter?: string;
  check: SqlCheck;
  /** Solución de referencia (se verifica en los tests). */
  solution: string;
  hints: string[];
  explain: string;
  par?: number;
  commands?: string[];
  expectInitialFail?: boolean;
}

export type AnyChallenge = Challenge | PyChallenge | SqlChallenge;
export const isPyChallenge = (c: AnyChallenge): c is PyChallenge => (c as PyChallenge).lang === 'py';
export const isSqlChallenge = (c: AnyChallenge): c is SqlChallenge => (c as SqlChallenge).lang === 'sql';

// ───────────────────────── pasos de lección ─────────────────────────

export interface DemoLine {
  /** Comando que se escribe y ejecuta. */
  cmd: string;
  /** Explicación bajo la salida. */
  note?: string;
  /** true ⇒ el comando falla A PROPÓSITO (para enseñar a leer errores); el test de contenido lo exige. */
  error?: boolean;
}

export type Step =
  | { type: 'learn'; title?: string; body: string; emoji?: string }
  | { type: 'demo'; title?: string; lines: DemoLine[]; setup?: WorldOptions; intro?: string }
  | { type: 'illustration'; id: IllustrationId; title?: string; caption?: string }
  | { type: 'quiz'; q: Question }
  | { type: 'practice'; challenge: Challenge }
  /** Python: celdas de código que se ejecutan una a una en una sesión compartida (como un cuaderno). */
  | { type: 'pydemo'; title?: string; intro?: string; setup?: PyOptions; cells: PyCell[] }
  | { type: 'pypractice'; challenge: PyChallenge }
  /** SQL: sentencias que se ejecutan una a una sobre una base de datos de ejemplo, mostrando cada resultado. */
  | { type: 'sqldemo'; title?: string; intro?: string; setup: SqlSetup; cells: SqlCell[]; /** Enseña también «N filas leídas de las tablas» bajo cada resultado (zona de rendimiento). */ stats?: boolean }
  | { type: 'sqlpractice'; challenge: SqlChallenge };

export interface SqlCell {
  sql: string;
  /** Explicación bajo el resultado. */
  note?: string;
  /** true ⇒ la sentencia falla A PROPÓSITO (para enseñar a leer errores); el test lo exige. */
  error?: boolean;
}

export interface PyCell {
  code: string;
  /** Explicación bajo la salida. */
  note?: string;
  /** true ⇒ se ejecuta como en el intérprete interactivo (>>>): cada sentencia con su eco. false ⇒ como un script. */
  repl?: boolean;
  /** true ⇒ la celda provoca un error A PROPÓSITO (para enseñar a leer tracebacks); el test lo exige. */
  error?: boolean;
}

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
  /** Curso al que pertenece (por defecto 'linux'). */
  course: CourseId;
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
  boss?: AnyChallenge;
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
