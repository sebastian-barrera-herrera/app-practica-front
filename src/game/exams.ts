import type { CourseDef } from '@/content';
import { challengesOfLevel, challengesOfWorld, pickVaried, questionsOfLevel, questionsOfWorld, type QItem } from '@/content/pool';
import type { AnyChallenge, LevelId, WorldDef } from '@/content/types';
import { seededShuffle } from '@/lib/cmdnorm';

export interface ExamPlan {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  color: string;
  questions: QItem[];
  challenges: AnyChallenge[];
  /** Fracción mínima para aprobar. */
  passMark: number;
  /** Tiempo total en segundos (0 = sin límite). */
  seconds: number;
  bonusXp: number;
  /** Examen de salto: al aprobarlo se abre esta zona (índice en la ruta) y las anteriores. */
  unlocks?: { worldIndex: number; worldTitle: string };
}

export function worldExam(course: CourseDef, world: WorldDef, seed: string): ExamPlan {
  const questions = pickVaried(questionsOfWorld(course.id, world.id), 12, seed);
  const chs = seededShuffle(challengesOfWorld(course.id, world.id), seed).slice(0, 1);
  return {
    id: `exam-${world.id}`,
    title: `Examen: ${world.title}`,
    subtitle: `${questions.length} preguntas + ${chs.length} reto`,
    emoji: world.emoji,
    color: world.color,
    questions,
    challenges: chs,
    passMark: 0.7,
    seconds: 12 * 60,
    bonusXp: 80,
  };
}

const CERT_META: Record<LevelId, { title: string; emoji: string; color: string }> = {
  basico: { title: 'Certificación Básica', emoji: '🥉', color: '#22D3A6' },
  intermedio: { title: 'Certificación Intermedia', emoji: '🥈', color: '#38BDF8' },
  avanzado: { title: 'Certificación Avanzada', emoji: '🥇', color: '#A78BFA' },
};

export function certExam(course: CourseDef, level: LevelId, seed: string): ExamPlan {
  const m = CERT_META[level];
  const questions = pickVaried(questionsOfLevel(course.id, level), 24, seed);
  const chs = seededShuffle(challengesOfLevel(course.id, level), seed).slice(0, 2);
  return {
    id: `cert-${level}`,
    title: `${m.title} de ${course.name}`,
    subtitle: `${questions.length} preguntas + ${chs.length} retos · 75 % para aprobar`,
    emoji: m.emoji,
    color: m.color,
    questions,
    challenges: chs,
    passMark: 0.75,
    seconds: 25 * 60,
    bonusXp: level === 'basico' ? 200 : level === 'intermedio' ? 300 : 450,
  };
}

/** Tipos de pregunta que obligan a escribir, ordenar o predecir (no se aciertan por azar): el examen de salto los prefiere. */
const ACTIVE_TYPES = new Set(['cmd', 'order', 'fill', 'output', 'pycode', 'pyout', 'match', 'multi', 'sqlcode', 'sqlout']);

export const SKIP_PASS_MARK = 0.85;
export const SKIP_QUESTIONS = 20;

/**
 * Examen de salto: para abrir una zona sin haber completado las anteriores hay que demostrar que se dominan.
 * Mezcla preguntas de TODAS las zonas que se saltan (las que aún no están completas), prefiere las que no se aciertan
 * por azar, añade dos retos prácticos y exige un 85 %.
 */
export function skipExam(course: CourseDef, target: WorldDef, covered: WorldDef[], seed: string): ExamPlan {
  const pool = covered.flatMap((w) => questionsOfWorld(course.id, w.id));
  const active = pool.filter((q) => ACTIVE_TYPES.has(q.q.t));
  const passive = pool.filter((q) => !ACTIVE_TYPES.has(q.q.t));
  const nActive = Math.min(active.length, 14);
  const picked: QItem[] = [...pickVaried(active, nActive, seed), ...pickVaried(passive, Math.min(passive.length, SKIP_QUESTIONS - nActive), seed + 'p')];
  // si faltan preguntas de un tipo, se completa con las que sobren
  for (const q of seededShuffle(pool, seed + 'x')) {
    if (picked.length >= Math.min(SKIP_QUESTIONS, pool.length)) break;
    if (!picked.includes(q)) picked.push(q);
  }
  const questions = seededShuffle(picked, seed + 'o');
  const chs = seededShuffle(covered.flatMap((w) => challengesOfWorld(course.id, w.id)), seed).slice(0, 2);
  return {
    id: `skip-${target.id}`,
    title: `Examen de salto: ${target.title}`,
    subtitle: `${questions.length} preguntas + ${chs.length} retos · ${Math.round(SKIP_PASS_MARK * 100)} % para aprobar`,
    emoji: '⚡',
    color: target.color,
    questions,
    challenges: chs,
    passMark: SKIP_PASS_MARK,
    seconds: 20 * 60,
    bonusXp: 120,
    unlocks: { worldIndex: course.worlds.indexOf(target), worldTitle: target.title },
  };
}

/** Zonas anteriores a `target` que aún no se han completado (lo que cubre su examen de salto). */
export function skippedWorlds(course: CourseDef, target: WorldDef, complete: (w: WorldDef) => boolean): WorldDef[] {
  return course.worlds.slice(0, course.worlds.indexOf(target)).filter((w) => !complete(w));
}

/** Milisegundos que faltan para poder repetir un examen de salto suspendido (0 = ya se puede). */
export function skipWait(lastAt: number | undefined, passed: boolean | undefined, now: number, cooldown: number): number {
  if (passed || !lastAt) return 0;
  return Math.max(0, lastAt + cooldown - now);
}

export function levelWorlds(course: CourseDef, level: LevelId): WorldDef[] {
  return course.worlds.filter((w) => w.level === level);
}
