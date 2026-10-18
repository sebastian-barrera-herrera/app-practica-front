import type { WorldDef } from '@/content/types';
import type { Ctx, ProgressState } from './progress';
import { levelFromXp } from './xp';

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  emoji: string;
  xp: number;
  check: (s: ProgressState, ctx: Ctx) => boolean;
  /** Progreso 0..1 para mostrar barra (opcional). */
  progress?: (s: ProgressState, ctx: Ctx) => number;
}

const doneCount = (s: ProgressState) => Object.values(s.lessons).filter((l) => l.done).length;
const threeStars = (s: ProgressState) => Object.values(s.lessons).filter((l) => l.stars >= 3).length;

export function ACHIEVEMENTS(worlds: WorldDef[]): Achievement[] {
  const list: Achievement[] = [
    { id: 'first-step', title: 'Primer paso', desc: 'Completa tu primera lección', emoji: '🥋', xp: 10, check: (s) => doneCount(s) >= 1, progress: (s) => Math.min(1, doneCount(s) / 1) },
    { id: 'lessons-5', title: 'En marcha', desc: 'Completa 5 lecciones', emoji: '🚶', xp: 20, check: (s) => doneCount(s) >= 5, progress: (s) => Math.min(1, doneCount(s) / 5) },
    { id: 'lessons-15', title: 'Constante', desc: 'Completa 15 lecciones', emoji: '🏃', xp: 40, check: (s) => doneCount(s) >= 15, progress: (s) => Math.min(1, doneCount(s) / 15) },
    { id: 'lessons-30', title: 'Imparable', desc: 'Completa 30 lecciones', emoji: '🚀', xp: 80, check: (s) => doneCount(s) >= 30, progress: (s) => Math.min(1, doneCount(s) / 30) },
    { id: 'perfect', title: 'Impecable', desc: 'Consigue 3 estrellas en una lección', emoji: '⭐', xp: 15, check: (s) => threeStars(s) >= 1 },
    { id: 'perfect-5', title: 'Perfeccionista', desc: '3 estrellas en 5 lecciones', emoji: '🌟', xp: 40, check: (s) => threeStars(s) >= 5, progress: (s) => Math.min(1, threeStars(s) / 5) },
    { id: 'streak-3', title: 'Calentando', desc: 'Racha de 3 días', emoji: '🔥', xp: 15, check: (s) => s.streak.best >= 3, progress: (s) => Math.min(1, s.streak.best / 3) },
    { id: 'streak-7', title: 'Una semana', desc: 'Racha de 7 días', emoji: '📅', xp: 40, check: (s) => s.streak.best >= 7, progress: (s) => Math.min(1, s.streak.best / 7) },
    { id: 'streak-30', title: 'Hábito de acero', desc: 'Racha de 30 días', emoji: '🛡️', xp: 150, check: (s) => s.streak.best >= 30, progress: (s) => Math.min(1, s.streak.best / 30) },
    { id: 'xp-500', title: 'Medio millar', desc: 'Gana 500 XP', emoji: '💎', xp: 20, check: (s) => s.xp >= 500, progress: (s) => Math.min(1, s.xp / 500) },
    { id: 'xp-2000', title: 'Veterano', desc: 'Gana 2.000 XP', emoji: '🏅', xp: 50, check: (s) => s.xp >= 2000, progress: (s) => Math.min(1, s.xp / 2000) },
    { id: 'xp-5000', title: 'Leyenda viva', desc: 'Gana 5.000 XP', emoji: '👑', xp: 100, check: (s) => s.xp >= 5000, progress: (s) => Math.min(1, s.xp / 5000) },
    { id: 'level-5', title: 'Nivel 5', desc: 'Alcanza el nivel 5', emoji: '🔼', xp: 20, check: (s) => levelFromXp(s.xp) >= 5 },
    { id: 'level-10', title: 'Nivel 10', desc: 'Alcanza el nivel 10', emoji: '⏫', xp: 60, check: (s) => levelFromXp(s.xp) >= 10 },
    { id: 'challenges-10', title: 'Manos a la terminal', desc: 'Resuelve 10 retos de terminal', emoji: '⌨️', xp: 25, check: (s) => s.stats.challenges >= 10, progress: (s) => Math.min(1, s.stats.challenges / 10) },
    { id: 'challenges-50', title: 'Hacker en prácticas', desc: 'Resuelve 50 retos de terminal', emoji: '🧑‍💻', xp: 80, check: (s) => s.stats.challenges >= 50, progress: (s) => Math.min(1, s.stats.challenges / 50) },
    { id: 'exam-pass', title: 'Aprobado', desc: 'Aprueba tu primer examen', emoji: '📝', xp: 30, check: (s) => s.stats.examsPassed >= 1 },
    { id: 'exams-5', title: 'Estudiante modelo', desc: 'Aprueba 5 exámenes', emoji: '🎓', xp: 80, check: (s) => s.stats.examsPassed >= 5, progress: (s) => Math.min(1, s.stats.examsPassed / 5) },
    { id: 'cert-basico', title: 'Certificación Básica', desc: 'Aprueba el examen final del nivel Básico', emoji: '🥉', xp: 100, check: (s) => !!s.exams['cert-basico']?.passed },
    { id: 'cert-intermedio', title: 'Certificación Intermedia', desc: 'Aprueba el examen final del nivel Intermedio', emoji: '🥈', xp: 150, check: (s) => !!s.exams['cert-intermedio']?.passed },
    { id: 'cert-avanzado', title: 'Certificación Avanzada', desc: 'Aprueba el examen final del nivel Avanzado', emoji: '🥇', xp: 250, check: (s) => !!s.exams['cert-avanzado']?.passed },
    { id: 'blitz-10', title: 'Rayo', desc: '10 aciertos en una prueba rápida', emoji: '⚡', xp: 25, check: (s) => s.stats.blitzBest >= 10, progress: (s) => Math.min(1, s.stats.blitzBest / 10) },
    { id: 'blitz-20', title: 'Relámpago', desc: '20 aciertos en una prueba rápida', emoji: '🌩️', xp: 60, check: (s) => s.stats.blitzBest >= 20, progress: (s) => Math.min(1, s.stats.blitzBest / 20) },
    { id: 'reviews-50', title: 'Memoria de elefante', desc: 'Haz 50 repasos', emoji: '🐘', xp: 40, check: (s) => s.stats.reviews >= 50, progress: (s) => Math.min(1, s.stats.reviews / 50) },
    { id: 'pipes-20', title: 'Fontanero', desc: 'Usa 20 tuberías (|)', emoji: '🚰', xp: 30, check: (s) => s.stats.pipes >= 20, progress: (s) => Math.min(1, s.stats.pipes / 20) },
    { id: 'sudo-10', title: 'Un gran poder…', desc: 'Usa sudo 10 veces', emoji: '🦸', xp: 30, check: (s) => s.stats.sudo >= 10, progress: (s) => Math.min(1, s.stats.sudo / 10) },
    { id: 'sandbox-100', title: 'Aventurero', desc: '100 comandos en el entorno libre', emoji: '🧭', xp: 40, check: (s) => s.stats.sandboxCommands >= 100, progress: (s) => Math.min(1, s.stats.sandboxCommands / 100) },
    { id: 'ctrl-c', title: 'Ninja del Ctrl+C', desc: 'Cancela un comando con Ctrl+C', emoji: '🥷', xp: 15, check: (s) => s.stats.ctrlC >= 1 },
    { id: 'night-owl', title: 'Búho nocturno', desc: 'Estudia pasada la medianoche', emoji: '🦉', xp: 15, check: (s) => s.stats.nightSessions >= 1 },
    { id: 'early-bird', title: 'Madrugador', desc: 'Estudia antes de las 7:00', emoji: '🐦', xp: 15, check: (s) => s.stats.earlySessions >= 1 },
    { id: 'surprise-3', title: 'Siempre alerta', desc: 'Resuelve 3 exámenes sorpresa', emoji: '🎯', xp: 40, check: (s) => s.stats.surprises >= 3, progress: (s) => Math.min(1, s.stats.surprises / 3) },
    { id: 'library-10', title: 'Ratón de biblioteca', desc: 'Consulta 10 comandos en la biblioteca', emoji: '📚', xp: 20, check: (s) => s.stats.libraryViews >= 10, progress: (s) => Math.min(1, s.stats.libraryViews / 10) },
    { id: 'daily-7', title: 'Reto diario ×7', desc: 'Resuelve 7 retos diarios', emoji: '🗓️', xp: 40, check: (s) => s.stats.dailySolved >= 7, progress: (s) => Math.min(1, s.stats.dailySolved / 7) },
  ];
  for (const w of worlds) {
    list.push({
      id: `world-${w.id}`,
      title: `${w.emoji} ${w.title}`,
      desc: `Completa todas las lecciones de «${w.title}»`,
      emoji: w.emoji,
      xp: 50,
      check: (s) => w.lessons.every((l) => s.lessons[l.id]?.done),
      progress: (s) => w.lessons.filter((l) => s.lessons[l.id]?.done).length / w.lessons.length,
    });
  }
  return list;
}
