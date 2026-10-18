/** Builtins del shell: cd, echo, printf, export, read, kill, jobs… */
import { ParseError, parse } from '../parser';
import { REGISTRY, defineCommand, parseOpts, type Ctx } from '../registry';
import { type Job, BreakEx, ContinueEx, ExitEx, ReturnEx, ShellError, SHELL_BUILTINS } from '../shell';
import { evalTest, type TestTok } from '../testexpr';
import { formatPrintf, unescapeC } from './util';
import { shellQuote } from '../format';
import { basename } from '../path';
import { FsError } from '../vfs';
import { helpText } from '../help';

const berr = (c: Ctx, msg: string, code = 1) => {
  c.err(`bash: ${c.name}: ${msg}\n`);
  return code;
};

// ───────────────────────── navegación ─────────────────────────

defineCommand('cd', {
  summary: 'Cambia el directorio de trabajo',
  usage: 'cd [DIRECTORIO]',
  category: 'navegacion',
  builtin: true,
  noHelp: true,
  level: 1,
  options: [
    ['cd', 'Va a tu directorio personal (HOME)'],
    ['cd -', 'Vuelve al directorio anterior'],
    ['cd ..', 'Sube un nivel'],
    ['cd ~', 'Va a tu directorio personal'],
  ],
  examples: [['cd /var/log', 'Entra en /var/log (ruta absoluta)'], ['cd ../docs', 'Ruta relativa: sube y entra en docs']],
}, (c) => {
  const args = c.args.filter((a) => a !== '--' && a !== '-L' && a !== '-P');
  if (args.length > 1) return berr(c, 'too many arguments');
  let target = args[0];
  let print = false;
  if (target === undefined || target === '~') target = c.sh.home();
  else if (target === '-') {
    target = c.sh.getVar('OLDPWD') ?? c.sh.cwd;
    print = true;
  } else if (target.startsWith('~') && !target.startsWith('~/')) {
    const u = c.sh.sys.user(target.slice(1));
    if (u) target = u.home;
  }
  if (target === '') return 0;
  const abs = c.abs(target);
  try {
    const r = c.fs.walk(abs, { cred: c.cred });
    if (!r.node) throw new FsError('ENOENT', abs);
    if (r.node.kind !== 'dir') throw new FsError('ENOTDIR', abs);
    if (!c.fs.can(r.node, c.cred, 'x')) throw new FsError('EACCES', abs);
  } catch (e) {
    return berr(c, `${args[0] ?? target}: ${(e as Error).message}`);
  }
  c.sh.setCwd(abs);
  if (print) c.out(abs + '\n');
  return 0;
});

defineCommand('pwd', {
  summary: 'Muestra el directorio de trabajo actual',
  usage: 'pwd [-LP]',
  category: 'navegacion',
  level: 1,
  options: [['-L', 'Muestra la ruta lógica (por defecto)'], ['-P', 'Muestra la ruta física (sin enlaces simbólicos)']],
  examples: [['pwd', 'Imprime, por ejemplo, /home/alumno']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'LP' });
  if (o.has('P')) {
    const r = c.fs.walk(c.sh.cwd, { cred: null });
    c.out(r.path + '\n');
  } else c.out(c.sh.cwd + '\n');
});

defineCommand('pushd', { summary: 'Guarda el directorio actual en una pila y cambia a otro', usage: 'pushd [DIR]', category: 'navegacion', builtin: true, level: 3 }, async (c) => {
  const target = c.args[0];
  if (!target) {
    if (!c.sh.dirStack.length) return berr(c, 'no other directory');
    const top = c.sh.dirStack.shift()!;
    c.sh.dirStack.unshift(c.sh.cwd);
    c.sh.setCwd(top);
  } else {
    const abs = c.abs(target);
    if (!c.fs.isDir(abs)) return berr(c, `${target}: No such file or directory`);
    c.sh.dirStack.unshift(c.sh.cwd);
    c.sh.setCwd(abs);
  }
  c.out([c.sh.cwd, ...c.sh.dirStack].map((d) => d.replace(c.sh.home(), '~')).join(' ') + '\n');
});

defineCommand('popd', { summary: 'Vuelve al directorio guardado con pushd', usage: 'popd', category: 'navegacion', builtin: true, level: 3 }, (c) => {
  const top = c.sh.dirStack.shift();
  if (!top) return berr(c, 'directory stack empty');
  c.sh.setCwd(top);
  c.out([c.sh.cwd, ...c.sh.dirStack].map((d) => d.replace(c.sh.home(), '~')).join(' ') + '\n');
});

defineCommand('dirs', { summary: 'Muestra la pila de directorios', usage: 'dirs', category: 'navegacion', builtin: true, level: 3 }, (c) => {
  c.out([c.sh.cwd, ...c.sh.dirStack].map((d) => d.replace(c.sh.home(), '~')).join(' ') + '\n');
});

// ───────────────────────── salida ─────────────────────────

defineCommand('echo', {
  summary: 'Muestra texto en la salida estándar',
  usage: 'echo [-neE] [TEXTO]...',
  category: 'archivos',
  noHelp: true,
  level: 1,
  options: [['-n', 'No añade salto de línea final'], ['-e', 'Interpreta secuencias como \\n y \\t'], ['-E', 'No interpreta secuencias (por defecto)']],
  examples: [['echo "Hola mundo"', 'Imprime Hola mundo'], ['echo -e "a\\nb"', 'Imprime a y b en líneas distintas'], ['echo $HOME', 'Imprime el valor de la variable HOME']],
}, (c) => {
  let nl = true;
  let esc = false;
  let i = 0;
  for (; i < c.args.length; i++) {
    const a = c.args[i];
    if (/^-[neE]+$/.test(a)) {
      if (a.includes('n')) nl = false;
      if (a.includes('e')) esc = true;
      if (a.includes('E')) esc = false;
    } else break;
  }
  let text = c.args.slice(i).join(' ');
  if (esc) {
    const [t, stop] = unescapeC(text);
    text = t;
    if (stop) nl = false;
  }
  c.out(text + (nl ? '\n' : ''));
});

defineCommand('printf', {
  summary: 'Imprime texto con formato (como en C)',
  usage: 'printf FORMATO [ARGUMENTO]...',
  category: 'scripting',
  noHelp: true,
  level: 2,
  options: [['%s', 'Cadena'], ['%d', 'Entero'], ['%f', 'Decimal'], ['%5s / %-5s', 'Ancho 5, alineado a derecha/izquierda'], ['\\n', 'Salto de línea']],
  examples: [['printf "%s tiene %d años\\n" Ana 30', 'Ana tiene 30 años'], ['printf "%05.1f\\n" 3.14159', 'Imprime 003.1']],
}, (c) => {
  if (c.args.length === 0) return c.fail('usage: printf format [arguments]');
  let args = c.args;
  if (args[0] === '-v') args = args.slice(2);
  const r = formatPrintf(args[0], args.slice(1));
  if (c.args[0] === '-v') c.sh.setVar(c.args[1], r.out);
  else c.out(r.out);
  if (r.error) {
    c.err(`bash: ${r.error}\n`);
    return 1;
  }
});

defineCommand('true', { summary: 'No hace nada y termina con éxito (código 0)', usage: 'true', category: 'scripting', noHelp: true, level: 2 }, () => 0);
defineCommand('false', { summary: 'No hace nada y termina con fallo (código 1)', usage: 'false', category: 'scripting', noHelp: true, level: 2 }, () => 1);
defineCommand(':', { summary: 'Comando nulo: no hace nada y devuelve 0', usage: ':', category: 'scripting', builtin: true, noHelp: true, level: 3 }, () => 0);

// ───────────────────────── variables ─────────────────────────

defineCommand('export', {
  summary: 'Marca variables para que las hereden los procesos hijos',
  usage: 'export [-p] [NOMBRE[=VALOR]]...',
  category: 'scripting',
  builtin: true,
  level: 2,
  options: [['-p', 'Lista todas las variables exportadas'], ['-n', 'Quita la marca de exportación']],
  examples: [['export EDITOR=vim', 'Define y exporta EDITOR'], ['export PATH=$PATH:~/bin', 'Añade ~/bin al PATH']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'pnf' });
  if (o.rest.length === 0) {
    for (const [k, v] of c.sh.exportedEnv()) c.out(`declare -x ${k}="${v.replace(/(["\\$`])/g, '\\$1')}"\n`);
    return 0;
  }
  let st = 0;
  for (const a of o.rest) {
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      c.err(`bash: export: \`${a}': not a valid identifier\n`);
      st = 1;
      continue;
    }
    if (o.has('n')) {
      const v = c.sh.vars.get(name);
      if (v) v.exported = false;
      continue;
    }
    if (eq >= 0) c.sh.setVar(name, a.slice(eq + 1), true);
    else {
      const v = c.sh.vars.get(name);
      if (v) v.exported = true;
      else c.sh.vars.set(name, { value: '', exported: true });
    }
  }
  return st;
});

defineCommand('unset', { summary: 'Elimina variables o funciones', usage: 'unset [-fv] NOMBRE...', category: 'scripting', builtin: true, level: 2 }, (c) => {
  const o = parseOpts(c, c.args, { flags: 'fv' });
  for (const n of o.rest) {
    if (o.has('f')) c.sh.funcs.delete(n);
    else {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/.exec(n);
      if (m) {
        const v = c.sh.vars.get(m[1]);
        if (v?.arr) {
          const arr = [...v.arr];
          arr.splice(parseInt(m[2], 10), 1);
          c.sh.setArray(m[1], arr);
        }
      } else c.sh.unsetVar(n);
    }
  }
});

defineCommand(['declare', 'typeset'], {
  summary: 'Declara variables y les da atributos',
  usage: 'declare [-ixrp] [NOMBRE[=VALOR]]...',
  category: 'scripting',
  builtin: true,
  level: 3,
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'aixrpAf' });
  if (o.has('p') || o.rest.length === 0) {
    const names = o.rest.length ? o.rest : [...c.sh.vars.keys()].sort();
    for (const n of names) {
      const v = c.sh.vars.get(n);
      if (!v) continue;
      const flags = (v.arr ? 'a' : '-') + (v.readonly ? 'r' : '') + (v.exported ? 'x' : '');
      if (v.arr) c.out(`declare -${flags === 'a' ? 'a' : flags} ${n}=(${v.arr.map((x, i) => `[${i}]="${x}"`).join(' ')})\n`);
      else c.out(`declare -${flags === '-' ? '-' : flags.replace(/^-/, '')} ${n}="${v.value}"\n`);
    }
    return 0;
  }
  for (const a of o.rest) {
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (c.sh.localStack.length) c.sh.declareLocal(name);
    if (eq >= 0) {
      let val = a.slice(eq + 1);
      if (o.has('i')) val = String(c.sh.arith(val));
      c.sh.setVar(name, val, o.has('x') ? true : undefined);
    } else if (!c.sh.vars.has(name)) c.sh.vars.set(name, { value: '', exported: o.has('x') });
    const v = c.sh.vars.get(name);
    if (v) {
      if (o.has('x')) v.exported = true;
      if (o.has('r')) v.readonly = true;
    }
  }
});

defineCommand('local', { summary: 'Declara una variable local dentro de una función', usage: 'local NOMBRE[=VALOR]...', category: 'scripting', builtin: true, level: 3 }, (c) => {
  if (!c.sh.localStack.length) return berr(c, 'can only be used in a function');
  for (const a of c.args) {
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    c.sh.declareLocal(name);
    if (eq >= 0) c.sh.setVar(name, a.slice(eq + 1));
    else c.sh.vars.set(name, { value: '', exported: false });
  }
});

defineCommand('readonly', { summary: 'Marca variables como de solo lectura', usage: 'readonly NOMBRE[=VALOR]...', category: 'scripting', builtin: true, level: 3 }, (c) => {
  for (const a of c.args) {
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (eq >= 0) c.sh.setVar(name, a.slice(eq + 1));
    const v = c.sh.vars.get(name) ?? { value: '', exported: false };
    v.readonly = true;
    c.sh.vars.set(name, v);
  }
});

defineCommand('let', { summary: 'Evalúa expresiones aritméticas', usage: 'let EXPR...', category: 'scripting', builtin: true, level: 3 }, (c) => {
  let last = 0;
  for (const a of c.args) last = c.sh.arith(a);
  return last !== 0 ? 0 : 1;
});

defineCommand('set', {
  summary: 'Cambia opciones del shell o los parámetros posicionales',
  usage: 'set [-euxo] [--] [ARG]...',
  category: 'scripting',
  builtin: true,
  level: 3,
  options: [['-e', 'Salir si un comando falla'], ['-u', 'Error al usar variables sin definir'], ['-x', 'Muestra cada comando antes de ejecutarlo'], ['-o pipefail', 'El pipeline falla si falla cualquier parte']],
}, (c) => {
  const a = [...c.args];
  if (a.length === 0) {
    for (const [k, v] of [...c.sh.vars].sort()) c.out(`${k}=${shellQuote(v.arr ? v.arr[0] ?? '' : v.value)}\n`);
    return 0;
  }
  while (a.length) {
    const x = a.shift()!;
    if (x === '--') {
      c.sh.positional = a.splice(0);
      break;
    }
    if (x === '-o' || x === '+o') {
      const name = a.shift();
      if (name === 'pipefail') x === '-o' ? c.sh.opts.add('pipefail') : c.sh.opts.delete('pipefail');
      continue;
    }
    if (/^[-+][a-zA-Z]+$/.test(x)) {
      for (const ch of x.slice(1)) x[0] === '-' ? c.sh.opts.add(ch) : c.sh.opts.delete(ch);
      continue;
    }
    c.sh.positional = [x, ...a.splice(0)];
  }
});

defineCommand('shift', { summary: 'Desplaza los parámetros posicionales', usage: 'shift [N]', category: 'scripting', builtin: true, level: 3 }, (c) => {
  const n = c.args[0] ? parseInt(c.args[0], 10) : 1;
  if (n > c.sh.positional.length) return 1;
  c.sh.positional = c.sh.positional.slice(n);
});

defineCommand('read', {
  summary: 'Lee una línea de la entrada y la guarda en variables',
  usage: 'read [-r] [-p PROMPT] [-s] [-n N] [-a ARRAY] [VARIABLE]...',
  category: 'scripting',
  builtin: true,
  level: 2,
  options: [['-p TEXTO', 'Muestra un mensaje antes de leer'], ['-r', 'No interpreta barras invertidas'], ['-s', 'No muestra lo que se escribe (contraseñas)'], ['-n N', 'Lee solo N caracteres'], ['-a ARR', 'Guarda las palabras en un array']],
  examples: [['read -p "Nombre: " nombre', 'Pide el nombre y lo guarda en $nombre'], ['read a b c <<< "uno dos tres"', 'Reparte palabras en variables']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'rsu', values: 'pndat' });
  if (o.val('p') !== undefined && c.stdin.isTTY) c.err(o.val('p')!);
  let line = await c.stdin.readLine();
  if (line === null) return 1;
  if (!o.has('r')) line = line.replace(/\\(.)/g, '$1');
  const n = o.val('n');
  if (n) line = line.slice(0, parseInt(n, 10));
  const names = o.rest;
  if (o.val('a')) {
    c.sh.setArray(o.val('a')!, line.split(/[ \t]+/).filter(Boolean));
    return 0;
  }
  if (names.length === 0) {
    c.sh.setVar('REPLY', line);
    return 0;
  }
  const ifs = c.sh.getVar('IFS') ?? ' \t\n';
  const words: string[] = [];
  let rest = line.replace(new RegExp(`^[${ifs.replace(/[\]\\^-]/g, '\\$&')}]+`), '');
  for (let i = 0; i < names.length; i++) {
    if (i === names.length - 1) {
      words.push(rest.replace(new RegExp(`[${ifs.replace(/[\]\\^-]/g, '\\$&')}]+$`), ''));
      break;
    }
    const m = new RegExp(`^(.*?)[${ifs.replace(/[\]\\^-]/g, '\\$&')}]+(.*)$`, 's').exec(rest);
    if (!m) {
      words.push(rest);
      rest = '';
    } else {
      words.push(m[1]);
      rest = m[2];
    }
  }
  names.forEach((nm, i) => c.sh.setVar(nm, words[i] ?? ''));
  return 0;
});

defineCommand('getopts', { summary: 'Procesa las opciones de un script', usage: 'getopts OPCIONES VARIABLE [ARGS]', category: 'scripting', builtin: true, level: 4 }, (c) => {
  const [optstring, name] = c.args;
  const args = c.args.length > 2 ? c.args.slice(2) : c.sh.positional;
  const silent = optstring.startsWith(':');
  const spec = optstring.replace(/^:/, '');
  let idx = parseInt(c.sh.getVar('OPTIND') ?? '1', 10);
  const sub = parseInt(c.sh.getVar('__optsub') ?? '0', 10);
  const arg = args[idx - 1];
  if (arg === undefined || !arg.startsWith('-') || arg === '-' ) {
    c.sh.setVar(name, '?');
    return 1;
  }
  if (arg === '--') {
    c.sh.setVar('OPTIND', String(idx + 1));
    c.sh.setVar(name, '?');
    return 1;
  }
  const ch = arg[sub + 1];
  const pos = spec.indexOf(ch);
  const advance = () => {
    if (sub + 2 >= arg.length) {
      c.sh.setVar('OPTIND', String(idx + 1));
      c.sh.setVar('__optsub', '0');
    } else c.sh.setVar('__optsub', String(sub + 1));
  };
  if (pos < 0) {
    if (silent) c.sh.setVar('OPTARG', ch);
    else c.err(`bash: illegal option -- ${ch}\n`);
    c.sh.setVar(name, '?');
    advance();
    return 0;
  }
  if (spec[pos + 1] === ':') {
    let val = arg.slice(sub + 2);
    if (val === '') {
      val = args[idx] ?? '';
      if (args[idx] === undefined) {
        if (silent) {
          c.sh.setVar('OPTARG', ch);
          c.sh.setVar(name, ':');
        } else {
          c.err(`bash: option requires an argument -- ${ch}\n`);
          c.sh.setVar(name, '?');
        }
        c.sh.setVar('OPTIND', String(idx + 1));
        c.sh.setVar('__optsub', '0');
        return 0;
      }
      idx++;
      c.sh.setVar('OPTIND', String(idx + 1));
    } else c.sh.setVar('OPTIND', String(idx + 1));
    c.sh.setVar('__optsub', '0');
    c.sh.setVar('OPTARG', val);
    c.sh.setVar(name, ch);
    return 0;
  }
  c.sh.setVar('OPTARG', '');
  c.sh.setVar(name, ch);
  advance();
  return 0;
});

// ───────────────────────── test / [ ───────────────────────

const runTest = (c: Ctx, args: string[], name: string) => {
  const toks: TestTok[] = args.map((s) => ({ s, pat: s }));
  try {
    return evalTest(c.sh, toks, false, name);
  } catch (e) {
    if (e instanceof ShellError) {
      c.err(`bash: ${e.message}\n`);
      return e.code;
    }
    throw e;
  }
};

defineCommand('test', {
  summary: 'Evalúa una condición (archivos, textos, números)',
  usage: 'test EXPRESIÓN   |   [ EXPRESIÓN ]',
  category: 'scripting',
  noHelp: true,
  level: 2,
  options: [['-e F', 'F existe'], ['-f F', 'F es un archivo normal'], ['-d F', 'F es un directorio'], ['-r/-w/-x F', 'F es legible/escribible/ejecutable'], ['-s F', 'F no está vacío'], ['-z S / -n S', 'S está vacía / no vacía'], ['A = B', 'Textos iguales'], ['N -eq/-ne/-lt/-gt/-le/-ge M', 'Comparaciones numéricas']],
  examples: [['test -f /etc/passwd && echo existe', 'Comprueba un archivo'], ['[ "$a" -gt 5 ]', 'Compara números']],
}, (c) => runTest(c, c.args, 'test'));

defineCommand('[', { summary: 'Sinónimo de test (termina con ])', usage: '[ EXPRESIÓN ]', category: 'scripting', noHelp: true, level: 2 }, (c) => {
  if (c.args[c.args.length - 1] !== ']') {
    c.err('bash: [: missing `]\'\n');
    return 2;
  }
  return runTest(c, c.args.slice(0, -1), '[');
});

// ───────────────────────── control ─────────────────────────

defineCommand('exit', { summary: 'Termina el shell o el script', usage: 'exit [CÓDIGO]', category: 'scripting', builtin: true, noHelp: true, level: 1 }, (c) => {
  const code = c.args[0] !== undefined ? parseInt(c.args[0], 10) & 255 : c.sh.lastStatus;
  throw new ExitEx(Number.isNaN(code) ? 2 : code);
});
defineCommand('logout', { summary: 'Cierra la sesión', usage: 'logout', category: 'sistema', builtin: true, level: 1 }, () => {
  throw new ExitEx(0);
});
defineCommand('return', { summary: 'Sale de una función con un código', usage: 'return [CÓDIGO]', category: 'scripting', builtin: true, level: 3 }, (c) => {
  if (c.sh.funcDepth === 0 && c.sh.interactive) return berr(c, 'can only `return\' from a function or sourced script');
  throw new ReturnEx(c.args[0] !== undefined ? parseInt(c.args[0], 10) & 255 : c.sh.lastStatus);
});
defineCommand('break', { summary: 'Sale de un bucle', usage: 'break [N]', category: 'scripting', builtin: true, level: 3 }, (c) => {
  throw new BreakEx(c.args[0] ? parseInt(c.args[0], 10) : 1);
});
defineCommand('continue', { summary: 'Salta a la siguiente iteración de un bucle', usage: 'continue [N]', category: 'scripting', builtin: true, level: 3 }, (c) => {
  throw new ContinueEx(c.args[0] ? parseInt(c.args[0], 10) : 1);
});

defineCommand(['source', '.'], {
  summary: 'Ejecuta un archivo en el shell actual',
  usage: 'source ARCHIVO [ARGS]',
  category: 'scripting',
  builtin: true,
  level: 2,
  examples: [['source ~/.bashrc', 'Recarga la configuración sin abrir otra terminal']],
}, async (c) => {
  if (!c.args[0]) return berr(c, 'filename argument required', 2);
  let abs = c.abs(c.args[0]);
  if (!c.args[0].includes('/')) {
    const f = c.sh.findInPath(c.args[0]);
    if (f && !f.def) abs = f.path;
  }
  let content: string;
  try {
    content = c.fs.readFile(abs, c.cred);
  } catch (e) {
    return berr(c, `${c.args[0]}: ${(e as Error).message}`);
  }
  const saved = c.sh.positional;
  if (c.args.length > 1) c.sh.positional = c.args.slice(1);
  try {
    const node = parse(content);
    return await c.sh.execNode(node, c.io);
  } catch (e) {
    if (e instanceof ParseError) {
      c.err(`bash: ${c.args[0]}: ${e.message}\n`);
      return 2;
    }
    if (e instanceof ReturnEx) return e.code;
    throw e;
  } finally {
    c.sh.positional = saved;
  }
});

defineCommand('eval', { summary: 'Ejecuta los argumentos como un comando', usage: 'eval [ARG]...', category: 'scripting', builtin: true, level: 4 }, (c) => c.sh.runLine(c.args.join(' '), c.io));

defineCommand('exec', { summary: 'Reemplaza el shell por un comando', usage: 'exec COMANDO [ARGS]', category: 'scripting', builtin: true, level: 4 }, async (c) => {
  if (!c.args.length) return 0;
  const st = await c.sh.runArgv(c.args, c.io);
  throw new ExitEx(st);
});

defineCommand('trap', { summary: 'Ejecuta un comando cuando llega una señal', usage: "trap 'COMANDO' SEÑAL...", category: 'scripting', builtin: true, level: 4 }, (c) => {
  if (c.args.length < 2) {
    for (const [s, cmd] of c.sh.traps) c.out(`trap -- '${cmd}' ${s}\n`);
    return 0;
  }
  const [cmd, ...sigs] = c.args;
  for (const s of sigs) c.sh.traps.set(s.replace(/^SIG/, ''), cmd);
});

defineCommand('hash', { summary: 'Recuerda las rutas de los comandos usados', usage: 'hash [-r]', category: 'scripting', builtin: true, level: 4 }, (c) => {
  if (c.args.includes('-r')) c.sh.hashTable.clear();
});
defineCommand('builtin', { summary: 'Ejecuta un builtin del shell', usage: 'builtin NOMBRE [ARGS]', category: 'scripting', builtin: true, level: 4 }, (c) => {
  const def = REGISTRY.get(c.args[0]);
  if (!def || !SHELL_BUILTINS.has(c.args[0])) return berr(c, `${c.args[0]}: not a shell builtin`);
  return c.sh.runDef(def, c.args[0], c.args.slice(1), c.io);
});
defineCommand('times', { summary: 'Muestra los tiempos de CPU acumulados', usage: 'times', category: 'procesos', builtin: true, level: 4 }, (c) => {
  c.out('0m0.045s 0m0.030s\n0m0.120s 0m0.080s\n');
});
defineCommand('umask', {
  summary: 'Muestra o cambia la máscara de permisos por defecto',
  usage: 'umask [-S] [MODO]',
  category: 'permisos',
  builtin: true,
  level: 3,
  options: [['-S', 'Muestra la máscara en forma simbólica']],
  examples: [['umask', 'Muestra 0022'], ['umask 077', 'Los archivos nuevos serán solo para ti']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'Sp' });
  if (o.rest.length) {
    if (!/^[0-7]{1,4}$/.test(o.rest[0])) return berr(c, `${o.rest[0]}: octal number out of range`);
    c.sh.umask = parseInt(o.rest[0], 8);
    return 0;
  }
  if (o.has('S')) {
    const m = c.sh.umask;
    const f = (b: number) => ((b & 4) ? '' : 'r') + ((b & 2) ? '' : 'w') + ((b & 1) ? '' : 'x');
    c.out(`u=${f((m >> 6) & 7)},g=${f((m >> 3) & 7)},o=${f(m & 7)}\n`);
  } else c.out(c.sh.umask.toString(8).padStart(4, '0') + '\n');
});

// ───────────────────────── alias / type / command ─────────────────────────

defineCommand('alias', {
  summary: 'Crea atajos para comandos largos',
  usage: "alias [NOMBRE[='COMANDO']]...",
  category: 'scripting',
  builtin: true,
  level: 2,
  examples: [["alias ll='ls -alF'", 'll ahora ejecuta ls -alF'], ['alias', 'Lista los alias definidos']],
}, (c) => {
  if (c.args.length === 0 || c.args[0] === '-p') {
    for (const [k, v] of [...c.sh.aliases].sort()) c.out(`alias ${k}='${v}'\n`);
    return 0;
  }
  let st = 0;
  for (const a of c.args) {
    const eq = a.indexOf('=');
    if (eq < 0) {
      const v = c.sh.aliases.get(a);
      if (v === undefined) {
        c.err(`bash: alias: ${a}: not found\n`);
        st = 1;
      } else c.out(`alias ${a}='${v}'\n`);
    } else c.sh.aliases.set(a.slice(0, eq), a.slice(eq + 1));
  }
  return st;
});

defineCommand('unalias', { summary: 'Elimina un alias', usage: 'unalias [-a] NOMBRE...', category: 'scripting', builtin: true, level: 2 }, (c) => {
  if (c.args[0] === '-a') {
    c.sh.aliases.clear();
    return 0;
  }
  let st = 0;
  for (const a of c.args) {
    if (!c.sh.aliases.delete(a)) {
      c.err(`bash: unalias: ${a}: not found\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand('type', {
  summary: 'Indica cómo interpretaría el shell un nombre de comando',
  usage: 'type [-atp] NOMBRE...',
  category: 'ayuda',
  builtin: true,
  level: 2,
  options: [['-t', 'Imprime solo el tipo: alias, builtin, file, function'], ['-a', 'Muestra todas las ubicaciones'], ['-p', 'Muestra la ruta del archivo']],
  examples: [['type cd', 'cd is a shell builtin'], ['type ls', 'ls is /usr/bin/ls']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'atpP' });
  let st = 0;
  for (const name of o.rest) {
    const r = c.sh.resolveCommand(name);
    let printed = false;
    const emit = (kind: string, text: string) => {
      printed = true;
      c.out(o.has('t') ? kind + '\n' : text + '\n');
    };
    if (r.kind === 'alias' && !o.has('p')) emit('alias', `${name} is aliased to \`${c.sh.aliases.get(name)}'`);
    if ((r.kind === 'function' || c.sh.funcs.has(name)) && !o.has('p')) emit('function', `${name} is a function`);
    if (SHELL_BUILTINS.has(name) && REGISTRY.has(name) && !o.has('p')) emit('builtin', `${name} is a shell builtin`);
    if (o.has('a') || (!printed && r.kind !== 'alias')) {
      const f = c.sh.findInPath(name);
      if (f) {
        if (o.has('p')) c.out(f.path + '\n');
        else emit('file', `${name} is ${f.path}`);
      }
    }
    if (!printed && !o.has('p')) {
      st = 1;
      if (!o.has('t')) c.err(`bash: type: ${name}: not found\n`);
    }
  }
  return st;
});

defineCommand('command', {
  summary: 'Ejecuta un comando ignorando alias y funciones, o consulta su ruta',
  usage: 'command [-vV] COMANDO [ARGS]',
  category: 'ayuda',
  builtin: true,
  level: 3,
  options: [['-v', 'Muestra cómo se resolvería el comando']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'vVp', stopAtOperand: true });
  if (o.has('v') || o.has('V')) {
    let st = 0;
    for (const name of o.rest) {
      const r = c.sh.resolveCommand(name);
      if (r.kind === 'none') st = 1;
      else if (r.kind === 'file') c.out(r.path + '\n');
      else if (r.kind === 'alias') c.out(`alias ${name}='${c.sh.aliases.get(name)}'\n`);
      else c.out(name + '\n');
    }
    return st;
  }
  if (!o.rest.length) return 0;
  const sub = c.sh.clone();
  sub.aliases.clear();
  sub.funcs.delete(o.rest[0]);
  return sub.dispatch(o.rest, c.io);
});

// ───────────────────────── historial ─────────────────────────

defineCommand('history', {
  summary: 'Muestra o gestiona el historial de comandos',
  usage: 'history [N] [-c]',
  category: 'ayuda',
  builtin: true,
  level: 1,
  options: [['N', 'Muestra solo los últimos N comandos'], ['-c', 'Borra el historial']],
  examples: [['history | grep ssh', 'Busca comandos anteriores con ssh'], ['!!', 'Repite el último comando'], ['!42', 'Repite el comando número 42']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'cdw', values: 'd' });
  if (o.has('c')) {
    c.sh.history = [];
    return 0;
  }
  const h = c.sh.history;
  let from = 0;
  if (o.rest[0] && /^\d+$/.test(o.rest[0])) from = Math.max(0, h.length - parseInt(o.rest[0], 10));
  for (let i = from; i < h.length; i++) c.out(`${String(i + 1).padStart(5)}  ${h[i]}\n`);
});

defineCommand('help', {
  summary: 'Muestra ayuda sobre los comandos internos del shell',
  usage: 'help [COMANDO]',
  category: 'ayuda',
  builtin: true,
  level: 1,
}, (c) => {
  if (c.args[0]) {
    const def = REGISTRY.get(c.args[0]);
    if (!def) {
      c.err(`bash: help: no help topics match \`${c.args[0]}'.  Try \`help help' or \`man -k ${c.args[0]}' or \`info ${c.args[0]}'.\n`);
      return 1;
    }
    c.out(helpText(def));
    return 0;
  }
  c.out('GNU bash (simulador Linux Dojo)\nEstos son los comandos internos del shell. Escribe `help nombre` para saber más.\n\n');
  const names = [...SHELL_BUILTINS].filter((n) => REGISTRY.has(n)).sort();
  c.out(names.join('  ') + '\n');
});

// ───────────────────────── jobs ─────────────────────────

const jobLine = (c: Ctx, j: Job, long = false) => {
  const mark = c.sh.jobMark(j);
  const st = j.state === 'stopped' ? 'Stopped' : 'Running';
  const pid = long ? `${j.pid} ` : '';
  return `[${j.id}]${mark} ${pid}${st.padEnd(22)}${j.text}${j.state === 'running' ? ' &' : ''}\n`;
};

defineCommand('jobs', {
  summary: 'Lista los trabajos en segundo plano o detenidos',
  usage: 'jobs [-lp]',
  category: 'procesos',
  builtin: true,
  level: 2,
  options: [['-l', 'Incluye el PID'], ['-p', 'Solo los PID']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'lprsn' });
  for (const j of c.sh.rt.jobs.filter((x) => x.state === 'running' || x.state === 'stopped')) {
    if (o.has('p')) c.out(j.pid + '\n');
    else c.out(jobLine(c, j, o.has('l')));
  }
});

defineCommand('fg', { summary: 'Trae un trabajo al primer plano', usage: 'fg [%N]', category: 'procesos', builtin: true, level: 2 }, async (c) => {
  const j = c.sh.findJob(c.args[0]);
  if (!j) return berr(c, `${c.args[0] ?? 'current'}: no such job`);
  c.out(j.text + '\n');
  const sys = c.sh.sys;
  j.state = 'done';
  c.sh.rt.jobs.splice(c.sh.rt.jobs.indexOf(j), 1);
  sys.killProc(j.pid);
  if (j.remainingMs !== undefined) {
    await c.sh.sleep(j.remainingMs);
    return 0;
  }
  if (j.endsAt > sys.clock.now) await c.sh.sleep(j.endsAt - sys.clock.now);
  for (const b of j.buf) (b.err ? c.err : c.out)(b.s);
  return j.status;
});

defineCommand('bg', { summary: 'Reanuda un trabajo detenido en segundo plano', usage: 'bg [%N]', category: 'procesos', builtin: true, level: 2 }, (c) => {
  const j = c.sh.findJob(c.args[0]);
  if (!j) return berr(c, `${c.args[0] ?? 'current'}: no such job`);
  if (j.state !== 'stopped') return berr(c, `job ${j.id} already in background`, 0);
  j.state = 'running';
  const p = c.sh.sys.procs.get(j.pid);
  if (p) p.state = 'S';
  j.endsAt = c.sh.sys.clock.now + (j.remainingMs ?? 600000);
  j.remainingMs = undefined;
  c.out(`[${j.id}]${c.sh.jobMark(j)} ${j.text} &\n`);
});

defineCommand('wait', { summary: 'Espera a que terminen los trabajos en segundo plano', usage: 'wait [%N]', category: 'procesos', builtin: true, level: 3 }, async (c) => {
  const jobs = c.args.length ? c.args.map((a) => c.sh.findJob(a)).filter((x): x is Job => !!x) : c.sh.rt.jobs.filter((j) => j.state === 'running');
  let max = 0;
  for (const j of jobs) max = Math.max(max, j.endsAt - c.sh.sys.clock.now);
  if (max > 0) await c.sh.sleep(max);
  return 0;
});

defineCommand('disown', { summary: 'Quita un trabajo de la lista de trabajos', usage: 'disown [%N]', category: 'procesos', builtin: true, level: 4 }, (c) => {
  const j = c.sh.findJob(c.args[0]);
  if (j) c.sh.rt.jobs.splice(c.sh.rt.jobs.indexOf(j), 1);
});

defineCommand('suspend', { summary: 'Suspende el shell', usage: 'suspend', category: 'procesos', builtin: true, level: 4 }, () => 0);
defineCommand('enable', { summary: 'Activa o desactiva builtins', usage: 'enable', category: 'ayuda', builtin: true, level: 4 }, () => 0);

export { basename };
