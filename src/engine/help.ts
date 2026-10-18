/** Texto de --help y man generado a partir de la metadata de cada comando. */
import type { CommandDef } from './registry';

export function helpText(def: CommandDef): string {
  let s = `Uso: ${def.usage ?? def.name + ' [OPCIÓN]... [ARCHIVO]...'}\n${def.summary}\n`;
  if (def.options?.length) {
    s += '\nOpciones:\n';
    const w = Math.min(24, Math.max(...def.options.map(([f]) => f.length)) + 2);
    for (const [f, d] of def.options) s += '  ' + f.padEnd(w) + d + '\n';
  }
  if (def.examples?.length) {
    s += '\nEjemplos:\n';
    for (const [c, d] of def.examples) s += `  ${c}\n      ${d}\n`;
  }
  s += `\n(ayuda simplificada del simulador; en Linux real el texto sale en inglés)\n`;
  return s;
}

export function manPage(def: CommandDef): string {
  const NAME = def.name.toUpperCase();
  let s = `${NAME}(1)${' '.repeat(10)}Manual del programador de Linux${' '.repeat(10)}${NAME}(1)\n\n`;
  s += `NOMBRE\n       ${def.name} - ${def.summary}\n\n`;
  s += `SINOPSIS\n       ${def.usage ?? def.name + ' [OPCIÓN]... [ARCHIVO]...'}\n\n`;
  s += `DESCRIPCIÓN\n       ${def.summary}\n`;
  if (def.options?.length) {
    s += '\nOPCIONES\n';
    for (const [f, d] of def.options) s += `       ${f}\n              ${d}\n\n`;
  }
  if (def.examples?.length) {
    s += 'EJEMPLOS\n';
    for (const [c, d] of def.examples) s += `       ${c}\n              ${d}\n\n`;
  }
  s += `\n(página de manual simplificada del simulador — pulsa q para salir en Linux real)\n`;
  return s;
}
