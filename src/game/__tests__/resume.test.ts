import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { lessonResumeLabel, RESUME_MAX_AGE, validExam, validLesson, validRun, type ExamResume, type LessonResume, type RunResume } from '../resume';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

const NOW = 1_800_000_000_000;
const stats = { quizTotal: 2, quizFirstTry: 1, practices: 0, hintsUsed: 0 };
const lesson = (over: Partial<LessonResume> = {}): LessonResume => ({ n: 6, queue: ['0', '1', '2', '3', '2-retry', '4', '5'], pos: 4, stats, ts: NOW - 1000, ...over });

describe('reanudar lección', () => {
  it('acepta un avance guardado que encaja con la lección', () => {
    expect(validLesson(lesson(), 6, NOW)?.pos).toBe(4);
    expect(lessonResumeLabel(lesson(), 6)).toMatch(/^Paso 5 de 7$/);
  });
  it('descarta lo guardado si el contenido cambió, caducó o está corrupto', () => {
    expect(validLesson(lesson(), 7, NOW)).toBeUndefined();
    expect(validLesson(lesson({ ts: NOW - RESUME_MAX_AGE - 1 }), 6, NOW)).toBeUndefined();
    expect(validLesson(lesson({ pos: 99 }), 6, NOW)).toBeUndefined();
    expect(validLesson(lesson({ queue: ['0', '9'] }), 6, NOW)).toBeUndefined();
    expect(validLesson(lesson({ queue: ['0', 'x'] }), 6, NOW)).toBeUndefined();
    expect(validLesson(undefined, 6, NOW)).toBeUndefined();
  });
});

describe('reanudar repaso', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const run = (over: Partial<RunResume> = {}): RunResume => ({ ids, pos: 2, results: [{ id: 'a', correct: true }, { id: 'b', correct: false }], ts: NOW - 5, ...over });
  it('exige las mismas preguntas y tantos resultados como la posición', () => {
    expect(validRun(run(), ids, NOW)?.pos).toBe(2);
    expect(validRun(run(), ['a', 'b', 'x', 'd'], NOW)).toBeUndefined();
    expect(validRun(run({ results: [] }), ids, NOW)).toBeUndefined();
    expect(validRun(run({ pos: 4, results: [] }), ids, NOW)).toBeUndefined();
  });
});

describe('reanudar examen', () => {
  const qids = ['q1', 'q2', 'q3'];
  const ex = (over: Partial<ExamResume> = {}): ExamResume => ({ seed: '1', qids, phase: 'q', pos: 1, cpos: 0, results: [{ id: 'q1', correct: true }], solved: 0, left: 400, ts: NOW - 5, ...over });
  it('acepta el avance de un examen idéntico', () => {
    expect(validExam(ex(), qids, 1, NOW)?.left).toBe(400);
    expect(validExam(ex({ phase: 'c', pos: 3 }), qids, 1, NOW)?.phase).toBe('c');
  });
  it('rechaza un examen distinto o incoherente', () => {
    expect(validExam(ex(), ['q1', 'q2'], 1, NOW)).toBeUndefined();
    expect(validExam(ex({ pos: 3 }), qids, 1, NOW)).toBeUndefined();
    expect(validExam(ex({ phase: 'c' }), qids, 0, NOW)).toBeUndefined();
    expect(validExam(ex({ cpos: 5 }), qids, 1, NOW)).toBeUndefined();
  });
});
