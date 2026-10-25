import { COURSE_IDS } from '@/content';
import { joinRoot, mergeRoots, splitRoot } from '@/cloud/merge';
import { byCourse, courseHasProgress, enabledCourses, initialRoot, migrateRoot, setCourseOn, shownCourses } from '../root';

describe('mis cursos', () => {
  test('hay un trozo de progreso por curso, también para SQL', () => {
    const r = initialRoot();
    expect(Object.keys(r.courses).sort()).toEqual([...COURSE_IDS].sort());
    expect(Object.keys(r.study).sort()).toEqual([...COURSE_IDS].sort());
  });

  test('los cursos nuevos no se activan solos', () => {
    const r = initialRoot();
    expect(enabledCourses(r)).toEqual(['linux', 'python']);
    expect(r.settings.courseOn.sql).toBe(false);
  });

  test('quitar el curso activo pasa al siguiente elegido', () => {
    let r = initialRoot();
    expect(r.active).toBe('linux');
    r = setCourseOn(r, 'linux', false);
    expect(r.settings.courseOn.linux).toBe(false);
    expect(r.active).toBe('python');
    expect(enabledCourses(r)).toEqual(['python']);
  });

  test('quitar un curso que no es el activo no cambia el activo', () => {
    const r = setCourseOn(initialRoot(), 'python', false);
    expect(r.active).toBe('linux');
  });

  test('siempre queda al menos un curso', () => {
    let r = setCourseOn(initialRoot(), 'python', false);
    const same = setCourseOn(r, 'linux', false);
    expect(same).toBe(r);
    expect(enabledCourses(same)).toEqual(['linux']);
    r = setCourseOn(r, 'sql', true);
    expect(enabledCourses(r)).toEqual(['linux', 'sql']);
  });

  test('quitar un curso conserva su progreso', () => {
    let r = initialRoot();
    r = { ...r, courses: { ...r.courses, python: { ...r.courses.python, lessons: { 'py1-1': { done: true, stars: 3, bestAccuracy: 1, plays: 1 } } } } };
    expect(courseHasProgress(r, 'python')).toBe(true);
    r = setCourseOn(r, 'python', false);
    expect(courseHasProgress(r, 'python')).toBe(true);
    expect(shownCourses(r)).toEqual(['linux', 'python']);
    r = setCourseOn(r, 'python', true);
    expect(r.courses.python.lessons['py1-1'].done).toBe(true);
  });

  test('un progreso guardado antes de existir SQL se migra sin perder nada', () => {
    const old = { ...initialRoot(), courses: { linux: initialRoot().courses.linux, python: initialRoot().courses.python }, study: { linux: { '2026-10-01': 600 }, python: {} } };
    const m = migrateRoot(old);
    expect(Object.keys(m.courses).sort()).toEqual([...COURSE_IDS].sort());
    expect(m.study.linux['2026-10-01']).toBe(600);
    expect(m.study.sql).toEqual({});
    expect(m.settings.courseOn.sql).toBe(false);
  });

  test('la sincronización incluye una fila por curso y tolera filas que faltan', () => {
    const parts = splitRoot(initialRoot());
    expect(Object.keys(parts).sort()).toEqual(['global', ...COURSE_IDS].sort());
    const { sql, ...withoutSql } = parts;
    void sql;
    const joined = joinRoot(withoutSql, 'u1', 5);
    expect(joined.courses.sql).toBeDefined();
    const merged = mergeRoots(initialRoot(), joined);
    expect(merged.study).toEqual(byCourse(() => ({})));
  });
});
