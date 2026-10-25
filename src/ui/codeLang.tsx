import React, { createContext, useContext } from 'react';
import type { CourseId } from '@/content/types';

export type CodeLang = 'sh' | 'py' | 'sql';

const Ctx = createContext<CodeLang>('sh');

/** Idioma de los bloques de código por defecto (según el curso que se está estudiando). */
export function CodeLangProvider({ course, children }: { course: CourseId; children: React.ReactNode }) {
  return <Ctx.Provider value={course === 'python' ? 'py' : course === 'sql' ? 'sql' : 'sh'}>{children}</Ctx.Provider>;
}

export const useCodeLang = () => useContext(Ctx);
