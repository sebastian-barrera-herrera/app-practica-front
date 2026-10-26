import type { CourseDef } from '@/content';
import type { CourseId } from '@/content/types';
import type { ProgressState } from './progress';
import type { RootState } from './root';
import { levelFromXp } from './xp';

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  emoji: string;
  xp: number;
  /** Curso al que pertenece (undefined = logro general de toda la app). */
  course?: CourseId;
  /** `s` es la vista plana del curso del logro (o del curso activo si es general). */
  check: (s: ProgressState, root: RootState) => boolean;
  /** Progreso 0..1 para mostrar barra (opcional). */
  progress?: (s: ProgressState, root: RootState) => number;
}

const doneCount = (s: ProgressState) => Object.values(s.lessons).filter((l) => l.done).length;
const threeStars = (s: ProgressState) => Object.values(s.lessons).filter((l) => l.stars >= 3).length;
const frac = (n: number, of: number) => Math.min(1, n / of);

/** Logros de toda la app (no pertenecen a un curso concreto). */
export function generalAchievements(): Achievement[] {
  return [
    { id: 'streak-3', title: 'Calentando', desc: 'Racha de 3 días', emoji: '🔥', xp: 15, check: (s) => s.streak.best >= 3, progress: (s) => frac(s.streak.best, 3) },
    { id: 'streak-7', title: 'Una semana', desc: 'Racha de 7 días', emoji: '📅', xp: 40, check: (s) => s.streak.best >= 7, progress: (s) => frac(s.streak.best, 7) },
    { id: 'streak-30', title: 'Hábito de acero', desc: 'Racha de 30 días', emoji: '🛡️', xp: 150, check: (s) => s.streak.best >= 30, progress: (s) => frac(s.streak.best, 30) },
    { id: 'xp-500', title: 'Medio millar', desc: 'Gana 500 XP', emoji: '💎', xp: 20, check: (s) => s.xp >= 500, progress: (s) => frac(s.xp, 500) },
    { id: 'xp-2000', title: 'Veterano', desc: 'Gana 2.000 XP', emoji: '🏅', xp: 50, check: (s) => s.xp >= 2000, progress: (s) => frac(s.xp, 2000) },
    { id: 'xp-5000', title: 'Leyenda viva', desc: 'Gana 5.000 XP', emoji: '👑', xp: 100, check: (s) => s.xp >= 5000, progress: (s) => frac(s.xp, 5000) },
    { id: 'level-5', title: 'Nivel 5', desc: 'Alcanza el nivel 5', emoji: '🔼', xp: 20, check: (s) => levelFromXp(s.xp) >= 5 },
    { id: 'level-10', title: 'Nivel 10', desc: 'Alcanza el nivel 10', emoji: '⏫', xp: 60, check: (s) => levelFromXp(s.xp) >= 10 },
    { id: 'night-owl', title: 'Búho nocturno', desc: 'Estudia pasada la medianoche', emoji: '🦉', xp: 15, check: (s, r) => anyCourse(r, (c) => c.stats.nightSessions >= 1) },
    { id: 'early-bird', title: 'Madrugador', desc: 'Estudia antes de las 7:00', emoji: '🐦', xp: 15, check: (s, r) => anyCourse(r, (c) => c.stats.earlySessions >= 1) },
    // —— constancia (meta diaria de tiempo) ——
    { id: 'goal-1', title: 'Hora cumplida', desc: 'Alcanza tu meta diaria de práctica', emoji: '⏱️', xp: 30, check: (_s, r) => goalDayCount(r) >= 1 },
    { id: 'goal-7', title: 'Semana de acero', desc: '7 días cumpliendo la meta', emoji: '🗓️', xp: 80, check: (_s, r) => goalDayCount(r) >= 7, progress: (_s, r) => frac(goalDayCount(r), 7) },
    { id: 'goal-30', title: 'Disciplina total', desc: '30 días cumpliendo la meta', emoji: '🏆', xp: 250, check: (_s, r) => goalDayCount(r) >= 30, progress: (_s, r) => frac(goalDayCount(r), 30) },
    { id: 'goal-both', title: 'Doble dojo', desc: 'Cumple la meta de dos cursos el mismo día', emoji: '☯️', xp: 80, check: (_s, r) => Object.values(r.goalDays).some((d) => d.length >= 2) },
    { id: 'combo-8', title: 'En racha', desc: 'Encadena 8 aciertos a la primera', emoji: '🔥', xp: 30, check: (_s, r) => r.extras.bestCombo >= 8, progress: (_s, r) => frac(r.extras.bestCombo, 8) },
    { id: 'combo-12', title: 'Sin fallos', desc: 'Encadena 12 aciertos a la primera', emoji: '☄️', xp: 70, check: (_s, r) => r.extras.bestCombo >= 12, progress: (_s, r) => frac(r.extras.bestCombo, 12) },
    { id: 'polyglot', title: 'Políglota', desc: 'Completa una lección en dos cursos distintos', emoji: '🌐', xp: 40, check: (_s, r) => Object.values(r.courses).filter((c) => Object.values(c.lessons).some((l) => l.done)).length >= 2 },
  ];
}

const anyCourse = (r: RootState, f: (c: RootState['courses'][CourseId]) => boolean) => Object.values(r.courses).some(f);
const goalDayCount = (r: RootState) => Object.values(r.goalDays).filter((d) => d.length > 0).length;

/** Logros propios de un curso. Los ids llevan el prefijo del curso (`linux:first-step`). */
export function courseAchievements(course: CourseDef): Achievement[] {
  const id = (x: string) => `${course.id}:${x}`;
  const c = course.id;
  const N = course.nouns;
  const list: Achievement[] = [
    { id: id('first-step'), course: c, title: 'Primer paso', desc: `Completa tu primera lección de ${course.name}`, emoji: '🥋', xp: 10, check: (s) => doneCount(s) >= 1, progress: (s) => frac(doneCount(s), 1) },
    { id: id('lessons-5'), course: c, title: 'En marcha', desc: `Completa 5 lecciones de ${course.name}`, emoji: '🚶', xp: 20, check: (s) => doneCount(s) >= 5, progress: (s) => frac(doneCount(s), 5) },
    { id: id('lessons-15'), course: c, title: 'Constante', desc: `Completa 15 lecciones de ${course.name}`, emoji: '🏃', xp: 40, check: (s) => doneCount(s) >= 15, progress: (s) => frac(doneCount(s), 15) },
    { id: id('lessons-30'), course: c, title: 'Imparable', desc: `Completa 30 lecciones de ${course.name}`, emoji: '🚀', xp: 80, check: (s) => doneCount(s) >= 30, progress: (s) => frac(doneCount(s), 30) },
    { id: id('perfect'), course: c, title: 'Impecable', desc: 'Consigue 3 estrellas en una lección', emoji: '⭐', xp: 15, check: (s) => threeStars(s) >= 1 },
    { id: id('perfect-5'), course: c, title: 'Perfeccionista', desc: '3 estrellas en 5 lecciones', emoji: '🌟', xp: 40, check: (s) => threeStars(s) >= 5, progress: (s) => frac(threeStars(s), 5) },
    { id: id('challenges-10'), course: c, title: 'Manos a la obra', desc: `Resuelve 10 ${N.challenges}`, emoji: c === 'python' ? '🖥️' : c === 'sql' ? '🗃️' : c === 'aws' ? '☁️' : '⌨️', xp: 25, check: (s) => s.stats.challenges >= 10, progress: (s) => frac(s.stats.challenges, 10) },
    { id: id('challenges-50'), course: c, title: 'Hacker en prácticas', desc: `Resuelve 50 ${N.challenges}`, emoji: '🧑‍💻', xp: 80, check: (s) => s.stats.challenges >= 50, progress: (s) => frac(s.stats.challenges, 50) },
    { id: id('exam-pass'), course: c, title: 'Aprobado', desc: `Aprueba tu primer examen de ${course.name}`, emoji: '📝', xp: 30, check: (s) => s.stats.examsPassed >= 1 },
    { id: id('exams-5'), course: c, title: 'Estudiante modelo', desc: `Aprueba 5 exámenes de ${course.name}`, emoji: '🎓', xp: 80, check: (s) => s.stats.examsPassed >= 5, progress: (s) => frac(s.stats.examsPassed, 5) },
    { id: id('cert-basico'), course: c, title: `${course.name}: Certificación Básica`, desc: 'Aprueba el examen final del nivel Básico', emoji: '🥉', xp: 100, check: (s) => !!s.exams['cert-basico']?.passed },
    { id: id('cert-intermedio'), course: c, title: `${course.name}: Certificación Intermedia`, desc: 'Aprueba el examen final del nivel Intermedio', emoji: '🥈', xp: 150, check: (s) => !!s.exams['cert-intermedio']?.passed },
    { id: id('cert-avanzado'), course: c, title: `${course.name}: Certificación Avanzada`, desc: 'Aprueba el examen final del nivel Avanzado', emoji: '🥇', xp: 250, check: (s) => !!s.exams['cert-avanzado']?.passed },
    { id: id('blitz-10'), course: c, title: 'Rayo', desc: '10 aciertos en una prueba rápida', emoji: '⚡', xp: 25, check: (s) => s.stats.blitzBest >= 10, progress: (s) => frac(s.stats.blitzBest, 10) },
    { id: id('blitz-20'), course: c, title: 'Relámpago', desc: '20 aciertos en una prueba rápida', emoji: '🌩️', xp: 60, check: (s) => s.stats.blitzBest >= 20, progress: (s) => frac(s.stats.blitzBest, 20) },
    { id: id('reviews-50'), course: c, title: 'Memoria de elefante', desc: `Haz 50 repasos de ${course.name}`, emoji: '🐘', xp: 40, check: (s) => s.stats.reviews >= 50, progress: (s) => frac(s.stats.reviews, 50) },
    { id: id('surprise-3'), course: c, title: 'Siempre alerta', desc: 'Resuelve 3 exámenes sorpresa', emoji: '🎯', xp: 40, check: (s) => s.stats.surprises >= 3, progress: (s) => frac(s.stats.surprises, 3) },
    { id: id('library-10'), course: c, title: 'Ratón de biblioteca', desc: `Consulta 10 fichas en la ${N.library.toLowerCase()}`, emoji: '📚', xp: 20, check: (s) => s.stats.libraryViews >= 10, progress: (s) => frac(s.stats.libraryViews, 10) },
    { id: id('daily-7'), course: c, title: 'Reto diario ×7', desc: 'Resuelve 7 retos diarios', emoji: '🗓️', xp: 40, check: (s) => s.stats.dailySolved >= 7, progress: (s) => frac(s.stats.dailySolved, 7) },
    { id: id('sandbox-100'), course: c, title: 'Aventurero', desc: `100 ${c === 'linux' || c === 'aws' ? 'comandos' : c === 'sql' ? 'consultas' : 'ejecuciones'} en el laboratorio libre`, emoji: '🧭', xp: 40, check: (s) => s.stats.sandboxCommands >= 100, progress: (s) => frac(s.stats.sandboxCommands, 100) },
  ];
  if (c === 'linux') {
    list.push(
      { id: id('pipes-20'), course: c, title: 'Fontanero', desc: 'Usa 20 tuberías (|)', emoji: '🚰', xp: 30, check: (s) => s.stats.pipes >= 20, progress: (s) => frac(s.stats.pipes, 20) },
      { id: id('sudo-10'), course: c, title: 'Un gran poder…', desc: 'Usa sudo 10 veces', emoji: '🦸', xp: 30, check: (s) => s.stats.sudo >= 10, progress: (s) => frac(s.stats.sudo, 10) },
      { id: id('ctrl-c'), course: c, title: 'Ninja del Ctrl+C', desc: 'Cancela un comando con Ctrl+C', emoji: '🥷', xp: 15, check: (s) => s.stats.ctrlC >= 1 },
    );
  }
  if (c === 'sql') {
    list.push(
      { id: id('queries-100'), course: c, title: 'Curioso de datos', desc: 'Ejecuta 100 consultas', emoji: '🔭', xp: 30, check: (s) => s.stats.commands >= 100, progress: (s) => frac(s.stats.commands, 100) },
      { id: id('queries-500'), course: c, title: 'Analista', desc: 'Ejecuta 500 consultas', emoji: '🧮', xp: 90, check: (s) => s.stats.commands >= 500, progress: (s) => frac(s.stats.commands, 500) },
    );
  }
  for (const w of course.worlds) {
    list.push({
      id: id(`world-${w.id}`),
      course: c,
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

/** Todos los logros de la app. */
export function allAchievements(courses: CourseDef[]): Achievement[] {
  return [...generalAchievements(), ...courses.flatMap((c) => courseAchievements(c))];
}

/** Ids antiguos (versión de un solo curso) → ids actuales de Linux. */
export const LEGACY_ACHIEVEMENT_IDS: Record<string, string> = Object.fromEntries(
  [
    'first-step', 'lessons-5', 'lessons-15', 'lessons-30', 'perfect', 'perfect-5', 'challenges-10', 'challenges-50', 'exam-pass', 'exams-5',
    'cert-basico', 'cert-intermedio', 'cert-avanzado', 'blitz-10', 'blitz-20', 'reviews-50', 'pipes-20', 'sudo-10', 'sandbox-100', 'ctrl-c',
    'surprise-3', 'library-10', 'daily-7',
  ].map((id) => [id, `linux:${id}`]),
);
