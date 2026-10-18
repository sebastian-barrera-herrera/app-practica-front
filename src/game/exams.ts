import { WORLDS } from '@/content';
import { challengesOfLevel, challengesOfWorld, pickVaried, questionsOfLevel, questionsOfWorld, type QItem } from '@/content/pool';
import type { Challenge, LevelId, WorldDef } from '@/content/types';
import { seededShuffle } from '@/lib/cmdnorm';

export interface ExamPlan {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  color: string;
  questions: QItem[];
  challenges: Challenge[];
  /** Fracción mínima para aprobar. */
  passMark: number;
  /** Tiempo total en segundos (0 = sin límite). */
  seconds: number;
  bonusXp: number;
}

export function worldExam(world: WorldDef, seed: string): ExamPlan {
  const questions = pickVaried(questionsOfWorld(world.id), 12, seed);
  const chs = seededShuffle(challengesOfWorld(world.id), seed).slice(0, 1);
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

export function certExam(level: LevelId, seed: string): ExamPlan {
  const m = CERT_META[level];
  const questions = pickVaried(questionsOfLevel(level), 24, seed);
  const chs = seededShuffle(challengesOfLevel(level), seed).slice(0, 2);
  return {
    id: `cert-${level}`,
    title: m.title,
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

export function levelWorlds(level: LevelId): WorldDef[] {
  return WORLDS.filter((w) => w.level === level);
}
