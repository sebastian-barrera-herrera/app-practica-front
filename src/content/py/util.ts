/** Ayudas compartidas por los archivos de contenido del curso de Python. */

/** Código de Python tal cual (las barras invertidas no se interpretan), sin el salto inicial ni el final. */
export const c = (s: TemplateStringsArray): string => s.raw[0].replace(/^\n/, '').replace(/\s+$/, '');

/** Expresión que vale True si ejecutar `stmt` (con las clases y funciones del alumno) lanza `tipo`. */
export const lanza = (stmt: string, tipo: string): string =>
  `(lambda g: (exec(${JSON.stringify(`try:\n    ${stmt}\nexcept ${tipo}:\n    ok = True\nelse:\n    ok = False`)}, g), g['ok'])[1])(dict(globals()))`;
