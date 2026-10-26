import type { AnyChallenge, CourseId, LevelDef, Lesson, Step, WorldDef } from './types';
import { PY_WORLDS } from './py';
import { AWS_WORLDS } from './aws';
import { SQL_WORLDS } from './sql';
import { w1 } from './worlds/w1';
import { w2 } from './worlds/w2';
import { w3 } from './worlds/w3';
import { w4 } from './worlds/w4';
import { w5 } from './worlds/w5';
import { w6 } from './worlds/w6';
import { w7 } from './worlds/w7';
import { w8 } from './worlds/w8';
import { w9 } from './worlds/w9';
import { w10 } from './worlds/w10';
import { w11 } from './worlds/w11';
import { w12 } from './worlds/w12';

export const LEVELS: LevelDef[] = [
  { id: 'basico', title: 'Nivel Básico', subtitle: 'Cinturón blanco', color: '#22D3A6', emoji: '🥋' },
  { id: 'intermedio', title: 'Nivel Intermedio', subtitle: 'Cinturón azul', color: '#38BDF8', emoji: '🔷' },
  { id: 'avanzado', title: 'Nivel Avanzado', subtitle: 'Cinturón negro', color: '#A78BFA', emoji: '⚫' },
];

const LINUX_WORLDS: WorldDef[] = [w1, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, w12];

export interface CourseDef {
  id: CourseId;
  /** Nombre corto: «Linux», «Python». */
  name: string;
  emoji: string;
  tagline: string;
  /** Laboratorio de práctica libre. */
  lab: { title: string; emoji: string; kind: 'terminal' | 'python' | 'sql' | 'aws'; blurb: string };
  /** Sustantivos del curso para textos de la interfaz. */
  nouns: { challenge: string; challenges: string; library: string; libraryBlurb: string; item: string };
  worlds: WorldDef[];
  levels: LevelDef[];
  lessons: Lesson[];
}

const mk = (c: Omit<CourseDef, 'lessons'>): CourseDef => ({ ...c, lessons: c.worlds.flatMap((w) => w.lessons) });

export const COURSES: Record<CourseId, CourseDef> = {
  linux: mk({
    id: 'linux',
    name: 'Linux',
    emoji: '🐧',
    tagline: 'Terminal, archivos, permisos, redes y administración',
    lab: { title: 'Terminal', emoji: '⌨️', kind: 'terminal', blurb: 'Un Linux simulado donde puedes escribir lo que quieras sin romper nada.' },
    nouns: { challenge: 'reto de terminal', challenges: 'retos de terminal', library: 'Biblioteca de comandos', libraryBlurb: 'Ficha de cada comando: opciones y ejemplos', item: 'comando' },
    worlds: LINUX_WORLDS,
    levels: LEVELS,
  }),
  python: mk({
    id: 'python',
    name: 'Python',
    emoji: '🐍',
    tagline: 'De tu primer print() a clases, generadores y asyncio',
    lab: { title: 'Editor', emoji: '🧪', kind: 'python', blurb: 'Escribe y ejecuta Python al instante: editor con salida y un REPL interactivo.' },
    nouns: { challenge: 'reto de código', challenges: 'retos de código', library: 'Biblioteca de Python', libraryBlurb: 'Funciones, métodos y módulos con ejemplos', item: 'función' },
    worlds: PY_WORLDS,
    levels: LEVELS,
  }),
  sql: mk({
    id: 'sql',
    name: 'SQL',
    emoji: '🗃️',
    tagline: 'Consulta, une, agrupa y diseña bases de datos de cero a experto',
    lab: { title: 'Consultas', emoji: '🔎', kind: 'sql', blurb: 'Bases de datos de ejemplo donde puedes lanzar cualquier consulta y ver el resultado al instante.' },
    nouns: { challenge: 'reto de SQL', challenges: 'retos de SQL', library: 'Biblioteca de SQL', libraryBlurb: 'Cláusulas, funciones y patrones con ejemplos', item: 'cláusula' },
    worlds: SQL_WORLDS,
    levels: LEVELS,
  }),
  aws: mk({
    id: 'aws',
    name: 'AWS',
    emoji: '☁️',
    tagline: 'De la nube básica a arquitecturas expertas, practicando en un AWS simulado',
    lab: { title: 'Consola', emoji: '🖥️', kind: 'aws', blurb: 'Una cuenta de AWS simulada con la CLI real: crea buckets, usuarios y servidores sin pagar nada ni arriesgar nada.' },
    nouns: { challenge: 'reto de AWS', challenges: 'retos de AWS', library: 'Biblioteca de AWS', libraryBlurb: 'Servicios y conceptos: cuándo usarlos y cuándo no', item: 'servicio' },
    worlds: AWS_WORLDS,
    levels: LEVELS,
  }),
};

export const COURSE_IDS: CourseId[] = ['linux', 'python', 'sql', 'aws'];
export const COURSE_LIST: CourseDef[] = COURSE_IDS.map((id) => COURSES[id]);
export const courseDef = (id: CourseId): CourseDef => COURSES[id];

export const ALL_LESSONS: Lesson[] = COURSE_LIST.flatMap((c) => c.lessons);

export const lessonById = (id: string): Lesson | undefined => ALL_LESSONS.find((l) => l.id === id);
export const worldById = (id: string): WorldDef | undefined => COURSE_LIST.flatMap((c) => c.worlds).find((w) => w.id === id);
export const worldOfLesson = (lessonId: string): WorldDef | undefined => COURSE_LIST.flatMap((c) => c.worlds).find((w) => w.lessons.some((l) => l.id === lessonId));
export const courseOfLesson = (lessonId: string): CourseId | undefined => worldOfLesson(lessonId)?.course;

export function allChallenges(course: CourseId): { challenge: AnyChallenge; lessonId: string | null; worldId: string }[] {
  const out: { challenge: AnyChallenge; lessonId: string | null; worldId: string }[] = [];
  for (const w of COURSES[course].worlds) {
    for (const l of w.lessons) for (const s of l.steps) if (s.type === 'practice' || s.type === 'pypractice' || s.type === 'sqlpractice') out.push({ challenge: s.challenge, lessonId: l.id, worldId: w.id });
    if (w.boss) out.push({ challenge: w.boss, lessonId: null, worldId: w.id });
  }
  return out;
}

export function stepKey(lessonId: string, index: number) {
  return `${lessonId}#${index}`;
}

export type { Step };
