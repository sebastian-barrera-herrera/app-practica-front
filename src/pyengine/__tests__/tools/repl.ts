import { PySession, isIncomplete, analyze, evaluate } from '../../index';
async function main() {
  const s = new PySession({});
  for (const line of ['x = 5', 'x + 1', '"hola"', 'None', 'def f(a):\n    return a * 2\n\n', 'f(21)', 'print("hi")', '1/0', 'undefined']) {
    const r = await s.run(line, { mode: 'repl' });
    console.log(JSON.stringify(line), '→', JSON.stringify({ ok: r.ok, value: r.value, out: r.stdout, err: r.stderr }));
  }
  console.log(isIncomplete('if True:'), isIncomplete('if True:\n    x=1'), isIncomplete('if True:\n    x=1\n\n'), isIncomplete('x = (1,'), isIncomplete('x = 1'), isIncomplete('print("a"'));
  // input con reejecución
  const s2 = new PySession({});
  const prompts: string[] = [];
  const r2 = await s2.run('name = input("Nombre: ")\nage = int(input("Edad: "))\nprint(f"{name} tiene {age}")', {
    onInput: async (p) => { prompts.push(p); return p.startsWith('Nombre') ? 'Ana' : '30'; },
    onOutput: (t) => process.stdout.write('[out]' + JSON.stringify(t) + '\n'),
  });
  console.log(prompts, JSON.stringify(r2.stdout), r2.ok);
  const a = analyze('for i in range(3):\n    print(i)\nimport json\nx = [i for i in y]');
  console.log(JSON.stringify(a.features));
  const s3 = new PySession({});
  await s3.run('def suma(a, b):\n    return a + b\nprint(suma(1,2))');
  console.log(evaluate({ t: 'all', checks: [{ t: 'stdout', equals: '3' }, { t: 'func', name: 'suma', params: 2 }, { t: 'expr', expr: 'suma(2, 3)', equals: '5' }, { t: 'uses', feature: 'FunctionDef' }] }, { session: s3, code: 'def suma(a, b):\n    return a + b\nprint(suma(1,2))' }));
  const s4 = new PySession({});
  const r4 = await s4.run('while True:\n    pass');
  console.log(r4.timedOut, r4.stderr);
}
main();
