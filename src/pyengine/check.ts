/**
 * Evaluación de las comprobaciones de los retos (`PyCheck`) sobre la última ejecución de una sesión.
 */
import type { PyCheck, PyCheckContext, PyCheckResult, TextSpec } from './types';
import { PySession } from './session';
import { analyze } from './analyze';

const OK: PyCheckResult = { ok: true };
const fail = (why: string): PyCheckResult => ({ ok: false, why });

function show(s: string): string {
  const t = s.length > 80 ? s.slice(0, 77) + '…' : s;
  return JSON.stringify(t);
}

function checkText(text: string, spec: TextSpec, what: string): PyCheckResult {
  const t = text;
  if (spec.equals !== undefined) {
    if (t.trimEnd() !== spec.equals.trimEnd()) return fail(`${what} no coincide con lo esperado (esperaba ${show(spec.equals.trimEnd())}, obtuve ${show(t.trimEnd())})`);
  }
  if (spec.includes !== undefined) {
    const list = Array.isArray(spec.includes) ? spec.includes : [spec.includes];
    if (spec.any) {
      if (!list.some((x) => t.includes(x))) return fail(`${what} debería contener alguno de: ${list.map(show).join(', ')}`);
    } else {
      for (const x of list) if (!t.includes(x)) return fail(`${what} debería contener ${show(x)}`);
    }
  }
  if (spec.notIncludes !== undefined) {
    const list = Array.isArray(spec.notIncludes) ? spec.notIncludes : [spec.notIncludes];
    for (const x of list) if (t.includes(x)) return fail(`${what} no debería contener ${show(x)}`);
  }
  if (spec.matches !== undefined) {
    if (!new RegExp(spec.matches, 'm').test(t)) return fail(`${what} no tiene el formato esperado`);
  }
  if (spec.lines !== undefined) {
    const n = t.split('\n').filter((l) => l.trim() !== '').length;
    if (n !== spec.lines) return fail(`${what} debería tener ${spec.lines} línea${spec.lines === 1 ? '' : 's'} (tiene ${n})`);
  }
  return OK;
}

function lastRun(ctx: PyCheckContext): { stdout: string; stderr: string; ok: boolean; errType?: string; errMsg?: string } | undefined {
  const r = ctx.session.last();
  if (!r) return undefined;
  return { stdout: r.stdout, stderr: r.stderr, ok: r.ok, errType: r.error?.type, errMsg: r.error?.message };
}

function evalIn(ctx: PyCheckContext, expr: string): { ok: true; value: string } | { ok: false; why: string } {
  const r = ctx.session.evalRepr(expr);
  if (r.ok) return { ok: true, value: r.value };
  return { ok: false, why: `${r.error.type}: ${r.error.message}` };
}

export function evaluate(check: PyCheck, ctx: PyCheckContext): PyCheckResult {
  switch (check.t) {
    case 'stdout': {
      const r = lastRun(ctx);
      if (!r) return fail('Aún no has ejecutado tu código');
      return checkText(r.stdout, check, 'La salida');
    }
    case 'stderr': {
      const r = lastRun(ctx);
      if (!r) return fail('Aún no has ejecutado tu código');
      return checkText(r.stderr, check, 'El mensaje de error');
    }
    case 'ok': {
      const r = lastRun(ctx);
      if (!r) return fail('Aún no has ejecutado tu código');
      return r.ok ? OK : fail(`Tu código termina con un error (${r.errType}: ${r.errMsg})`);
    }
    case 'raises': {
      const r = lastRun(ctx);
      if (!r) return fail('Aún no has ejecutado tu código');
      if (r.ok) return fail(`Se esperaba un ${check.type} y el código terminó sin errores`);
      if (r.errType !== check.type) return fail(`Se esperaba un ${check.type} pero apareció ${r.errType}`);
      if (check.message !== undefined && !(r.errMsg ?? '').includes(check.message)) return fail(`El mensaje del ${check.type} no es el esperado`);
      return OK;
    }
    case 'var': {
      const r = evalIn(ctx, check.name);
      if (!r.ok) return fail(`La variable «${check.name}» no existe todavía`);
      return r.value === check.equals ? OK : fail(`«${check.name}» vale ${show(r.value)} y debería valer ${show(check.equals)}`);
    }
    case 'expr': {
      const r = evalIn(ctx, check.expr);
      if (!r.ok) return fail(`${check.expr} produce un error: ${r.why}`);
      return r.value === check.equals ? OK : fail(`${check.expr} devuelve ${show(r.value)} y debería devolver ${show(check.equals)}`);
    }
    case 'calls': {
      let sess = ctx.session;
      for (const t of check.tests) {
        if (check.isolate) {
          const s = new PySession();
          // sesión limpia: se vuelve a ejecutar el código del alumno sin su salida
          void s.run(ctx.code, { mode: 'exec' });
          sess = s;
        }
        const r = sess.evalRepr(t.expr);
        if (!r.ok) return fail(`${t.expr} produce un error: ${r.error.type}: ${r.error.message}`);
        if (r.value !== t.equals) return fail(`${t.expr} devuelve ${show(r.value)} y debería devolver ${show(t.equals)}`);
      }
      return OK;
    }
    case 'true': {
      const r = evalIn(ctx, `bool(${check.expr})`);
      if (!r.ok) return fail(`${check.expr} produce un error: ${r.why}`);
      return r.value === 'True' ? OK : fail(check.why ?? `Debería cumplirse: ${check.expr}`);
    }
    case 'file': {
      const text = ctx.session.readFile(check.path);
      if (check.exists === false) return text === undefined ? OK : fail(`El archivo ${check.path} no debería existir`);
      if (text === undefined) return fail(`Falta el archivo ${check.path}`);
      return checkText(text, check, `El archivo ${check.path}`);
    }
    case 'uses': {
      const a = analyze(ctx.code);
      if (!a.ok) return fail('El código tiene un error de sintaxis');
      const n = a.features[check.feature] ?? 0;
      return n >= (check.min ?? 1) ? OK : fail(`Tu solución debe usar ${describeFeature(check.feature)}`);
    }
    case 'forbids': {
      const a = analyze(ctx.code);
      if (!a.ok) return fail('El código tiene un error de sintaxis');
      return (a.features[check.feature] ?? 0) === 0 ? OK : fail(`Tu solución no debe usar ${describeFeature(check.feature)}`);
    }
    case 'func': {
      const r = evalIn(ctx, `callable(${check.name}) and type(${check.name}).__name__ == 'function'`);
      if (!r.ok || r.value !== 'True') return fail(`Falta definir la función «${check.name}»`);
      if (check.params !== undefined) {
        const n = evalIn(ctx, `${check.name}.__code__.co_argcount`);
        if (!n.ok || Number(n.value) !== check.params) return fail(`La función «${check.name}» debería tener ${check.params} parámetro${check.params === 1 ? '' : 's'}`);
      }
      return OK;
    }
    case 'class': {
      const r = evalIn(ctx, `isinstance(${check.name}, type)`);
      if (!r.ok || r.value !== 'True') return fail(`Falta definir la clase «${check.name}»`);
      for (const h of check.has ?? []) {
        const x = evalIn(ctx, `hasattr(${check.name}, ${JSON.stringify(h)})`);
        if (!x.ok || x.value !== 'True') return fail(`A la clase «${check.name}» le falta «${h}»`);
      }
      return OK;
    }
    case 'all': {
      for (const c of check.checks) {
        const r = evaluate(c, ctx);
        if (!r.ok) return r;
      }
      return OK;
    }
    case 'any': {
      let last: PyCheckResult = fail('Ninguna comprobación se cumple');
      for (const c of check.checks) {
        const r = evaluate(c, ctx);
        if (r.ok) return OK;
        last = r;
      }
      return last;
    }
    case 'not': {
      const r = evaluate(check.check, ctx);
      return r.ok ? fail('Se cumple algo que no debería cumplirse') : OK;
    }
  }
}

function describeFeature(f: string): string {
  if (f.startsWith('call:')) return `la función ${f.slice(5)}()`;
  if (f.startsWith('method:')) return `el método .${f.slice(7)}()`;
  if (f.startsWith('import:')) return `el módulo ${f.slice(7)}`;
  if (f.startsWith('op:')) return `el operador ${f.slice(3)}`;
  if (f.startsWith('name:')) return `«${f.slice(5)}»`;
  if (f.startsWith('def:')) return `la función ${f.slice(4)}`;
  if (f.startsWith('class:')) return `la clase ${f.slice(6)}`;
  if (f.startsWith('decorator:')) return `el decorador @${f.slice(10)}`;
  const names: Record<string, string> = {
    For: 'un bucle for', While: 'un bucle while', If: 'un if', FunctionDef: 'una función (def)', ClassDef: 'una clase', Lambda: 'una lambda',
    ListComp: 'una list comprehension', SetComp: 'una set comprehension', DictComp: 'una dict comprehension', GeneratorExp: 'una expresión generadora',
    Try: 'try/except', With: 'with', Raise: 'raise', Assert: 'assert', Yield: 'yield', YieldFrom: 'yield from', Await: 'await', Import: 'import',
    ImportFrom: 'from … import', Return: 'return', Global: 'global', Nonlocal: 'nonlocal', Match: 'match/case', JoinedStr: 'una f-string',
    Slice: 'una rebanada', Starred: 'el operador *', NamedExpr: 'el operador :=', IfExp: 'una expresión condicional', Delete: 'del',
    AugAssign: 'una asignación aumentada (+=, …)', AnnAssign: 'una anotación de tipo', Break: 'break', Continue: 'continue', Pass: 'pass',
    Dict: 'un diccionario', Set: 'un conjunto', List: 'una lista', Tuple: 'una tupla', Subscript: 'un índice []', BoolOp: 'and/or', Compare: 'una comparación',
    BinOp: 'una operación', UnaryOp: 'un operador unario', Call: 'una llamada', Attribute: 'un atributo (.)', AsyncFunctionDef: 'async def',
  };
  return names[f] ?? f;
}
