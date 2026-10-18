import { mk, out, seq, sh } from './helpers';

describe('shell básico', () => {
  test('echo, comillas y variables', async () => {
    const t = mk();
    expect(await out(t, 'echo hola mundo')).toBe('hola mundo\n');
    expect(await out(t, 'echo "a   b"')).toBe('a   b\n');
    expect(await out(t, "echo 'no $expande'")).toBe('no $expande\n');
    expect(await out(t, 'echo $USER $HOME')).toBe('alumno /home/alumno\n');
    expect(await out(t, 'X=5; echo $X ${X}0')).toBe('5 50\n');
    expect(await out(t, 'echo -n hola')).toBe('hola');
    expect(await out(t, 'echo -e "a\\tb\\nc"')).toBe('a\tb\nc\n');
  });

  test('pwd, cd y rutas', async () => {
    const t = mk();
    expect(await out(t, 'pwd')).toBe('/home/alumno\n');
    await sh(t, 'cd Documents');
    expect(await out(t, 'pwd')).toBe('/home/alumno/Documents\n');
    await sh(t, 'cd ..');
    expect(await out(t, 'pwd')).toBe('/home/alumno\n');
    await sh(t, 'cd /var/log');
    expect(await out(t, 'pwd')).toBe('/var/log\n');
    await sh(t, 'cd -');
    expect(await out(t, 'pwd')).toBe('/home/alumno\n');
    await sh(t, 'cd');
    await sh(t, 'cd /tmp');
    await sh(t, 'cd ~');
    expect(await out(t, 'pwd')).toBe('/home/alumno\n');
    const r = await sh(t, 'cd /noexiste');
    expect(r.err).toContain('No such file or directory');
    expect(r.status).toBe(1);
  });

  test('pipes y redirecciones', async () => {
    const t = mk();
    await sh(t, 'echo uno > a.txt');
    await sh(t, 'echo dos >> a.txt');
    expect(await out(t, 'cat a.txt')).toBe('uno\ndos\n');
    expect(await out(t, 'cat a.txt | wc -l')).toBe('2\n');
    expect(await out(t, 'wc -l < a.txt')).toBe('2\n');
    const r = await sh(t, 'ls /noexiste 2> err.txt');
    expect(r.text).toBe('');
    expect(await out(t, 'cat err.txt')).toContain('No such file or directory');
    const r2 = await sh(t, 'ls /noexiste 2>&1 | wc -l');
    expect(r2.out).toBe('1\n');
    await sh(t, 'ls /noexiste /tmp &> todo.txt');
    expect(await out(t, 'cat todo.txt')).toContain('cannot access');
    expect(await out(t, 'echo x > /dev/null; echo ok')).toBe('ok\n');
  });

  test('&& || ; y códigos de salida', async () => {
    const t = mk();
    expect(await out(t, 'true && echo si')).toBe('si\n');
    expect(await out(t, 'false && echo si')).toBe('');
    expect(await out(t, 'false || echo no')).toBe('no\n');
    expect(await out(t, 'false; echo $?')).toBe('1\n');
    expect(await out(t, 'ls /noexiste 2>/dev/null; echo $?')).toBe('2\n');
    expect(await out(t, 'nocomando; echo $?')).toContain('127');
    expect((await sh(t, 'nocomando')).err).toContain('command not found');
    expect(await out(t, '! false && echo neg')).toBe('neg\n');
  });

  test('globs y llaves', async () => {
    const t = mk();
    await sh(t, 'mkdir g && cd g && touch a.txt b.txt c.md .oculto');
    expect(await out(t, 'echo *.txt')).toBe('a.txt b.txt\n');
    expect(await out(t, 'echo *')).toBe('a.txt b.txt c.md\n');
    expect(await out(t, 'echo ?.md')).toBe('c.md\n');
    expect(await out(t, 'echo [ab].txt')).toBe('a.txt b.txt\n');
    expect(await out(t, 'echo {1..3}')).toBe('1 2 3\n');
    expect(await out(t, 'echo {a,b,c}x')).toBe('ax bx cx\n');
    expect(await out(t, 'echo f{01..03}.log')).toBe('f01.log f02.log f03.log\n');
    expect(await out(t, 'echo *.zip')).toBe('*.zip\n');
    expect(await out(t, 'echo ".*"')).toBe('.*\n');
  });

  test('sustitución de comandos y aritmética', async () => {
    const t = mk();
    expect(await out(t, 'echo $(echo hola)')).toBe('hola\n');
    expect(await out(t, 'echo `echo viejo`')).toBe('viejo\n');
    expect(await out(t, 'echo $((2+3*4))')).toBe('14\n');
    expect(await out(t, 'x=7; echo $((x*x)) $((x%4)) $((x**2))')).toBe('49 3 49\n');
    expect(await out(t, 'echo "hoy: $(date +%Y)"')).toBe('hoy: 2026\n');
    expect(await out(t, 'n=$(ls / | wc -l); echo $n')).toMatch(/^\d+\n$/);
  });

  test('expansión de parámetros', async () => {
    const t = mk();
    expect(await out(t, 'f=archivo.tar.gz; echo ${f%.gz} ${f%%.*} ${f#*.} ${f##*.}')).toBe('archivo.tar archivo tar.gz gz\n');
    expect(await out(t, 'v=hola; echo ${v^^} ${#v} ${v:1:2} ${v/o/0}')).toBe('HOLA 4 ol h0la\n');
    expect(await out(t, 'echo ${vacio:-defecto} ${vacio:=asignado} $vacio')).toBe('defecto asignado asignado\n');
    expect(await out(t, 'x=1; echo ${x:+presente}${y:+ausente}')).toBe('presente\n');
  });

  test('control de flujo: if, for, while, case', async () => {
    const t = mk();
    expect(await out(t, 'if [ 3 -gt 2 ]; then echo mayor; else echo menor; fi')).toBe('mayor\n');
    expect(await out(t, 'for i in 1 2 3; do echo n$i; done')).toBe('n1\nn2\nn3\n');
    expect(await out(t, 'i=0; while [ $i -lt 3 ]; do i=$((i+1)); echo $i; done')).toBe('1\n2\n3\n');
    expect(await out(t, 'for ((i=0;i<3;i++)); do echo $i; done')).toBe('0\n1\n2\n');
    expect(await out(t, 'x=b; case $x in a) echo A;; b|c) echo BC;; *) echo otro;; esac')).toBe('BC\n');
    expect(await out(t, 'for i in 1 2 3 4; do [ $i -eq 2 ] && continue; [ $i -eq 4 ] && break; echo $i; done')).toBe('1\n3\n');
    expect(await out(t, 'if [[ "hola" == h* ]]; then echo glob; fi')).toBe('glob\n');
    expect(await out(t, 'if [[ "abc123" =~ [0-9]+ ]]; then echo re; fi')).toBe('re\n');
    expect(await out(t, '[ -d /tmp ] && echo dir; [ -f /tmp ] || echo nofile')).toBe('dir\nnofile\n');
  });

  test('funciones y variables locales', async () => {
    const t = mk();
    await sh(t, 'saludar() { local n=$1; echo "Hola $n"; }');
    expect(await out(t, 'saludar Ana')).toBe('Hola Ana\n');
    await sh(t, 'sumar() { echo $(($1+$2)); }');
    expect(await out(t, 'r=$(sumar 4 5); echo $r')).toBe('9\n');
    expect(await out(t, 'x=global; f() { local x=local; echo $x; }; f; echo $x')).toBe('local\nglobal\n');
    expect(await out(t, 'f() { return 3; }; f; echo $?')).toBe('3\n');
    expect(await out(t, 'f() { echo "$#:$@"; }; f a b c')).toBe('3:a b c\n');
  });

  test('arrays', async () => {
    const t = mk();
    expect(await out(t, 'a=(uno dos tres); echo ${a[1]} ${#a[@]}')).toBe('dos 3\n');
    expect(await out(t, 'a=(x y z); for e in "${a[@]}"; do echo -$e; done')).toBe('-x\n-y\n-z\n');
    expect(await out(t, 'a=(1 2); a+=(3); echo ${a[@]}')).toBe('1 2 3\n');
  });

  test('heredoc y here-string', async () => {
    const t = mk();
    await sh(t, 'nombre=Ana');
    await sh(t, 'cat <<EOF > saludo.txt\nHola $nombre\nSegunda línea\nEOF');
    expect(await out(t, 'cat saludo.txt')).toBe('Hola Ana\nSegunda línea\n');
    expect(await out(t, "cat <<'X'\n$no\nX")).toBe('$no\n');
    expect(await out(t, 'tr a-z A-Z <<< "hola"')).toBe('HOLA\n');
  });

  test('alias, type, which y history', async () => {
    const t = mk();
    expect(await out(t, 'type cd')).toBe('cd is a shell builtin\n');
    expect(await out(t, 'type ls')).toMatch(/ls is aliased|ls is \/usr\/bin\/ls/);
    expect(await out(t, 'which ls')).toBe('/usr/bin/ls\n');
    await sh(t, "alias gs='git status'");
    expect(await out(t, 'alias gs')).toBe("alias gs='git status'\n");
    expect(await out(t, 'type gs')).toContain('aliased');
    await sh(t, 'echo uno');
    expect(await out(t, 'history | tail -2')).toContain('echo uno');
    expect(await out(t, '!!')).toContain('history');
  });

  test('export y env', async () => {
    const t = mk();
    await sh(t, 'export MIVAR=hola');
    expect(await out(t, 'env | grep MIVAR')).toBe('MIVAR=hola\n');
    expect(await out(t, 'bash -c "echo $MIVAR"')).toBe('hola\n');
    expect(await out(t, 'NOEXP=1; bash -c \'echo "[$NOEXP]"\'')).toBe('[]\n');
    expect(await out(t, 'FOO=bar env | grep FOO')).toBe('FOO=bar\n');
    expect(await out(t, 'printf "%s-%03d|%5.1f\\n" ab 7 3.14159')).toBe('ab-007|  3.1\n');
  });

  test('read y entrada interactiva', async () => {
    const t = mk();
    const p = t.exec('read -p "nombre? " n; echo "hola $n"');
    await new Promise((r) => setTimeout(r, 10));
    expect(t.waitingForInput).toBe(true);
    await t.run('Ana');
    const r = await p;
    expect(r.out).toBe('hola Ana\n');
  });

  test('cat sin argumentos lee del teclado hasta Ctrl+D', async () => {
    const t = mk();
    const p = t.exec('cat > escrito.txt');
    await new Promise((r) => setTimeout(r, 10));
    await t.run('linea 1');
    await t.run('linea 2');
    t.signal('EOF');
    await p;
    expect(await out(t, 'cat escrito.txt')).toBe('linea 1\nlinea 2\n');
  });

  test('scripts: shebang, permisos y argumentos', async () => {
    const t = mk();
    await sh(t, 'printf \'#!/bin/bash\\necho "arg1=$1 total=$#"\\nexit 3\\n\' > s.sh');
    const r = await sh(t, './s.sh');
    expect(r.err).toContain('Permission denied');
    expect(r.status).toBe(126);
    await sh(t, 'chmod +x s.sh');
    const r2 = await sh(t, './s.sh uno dos');
    expect(r2.out).toBe('arg1=uno total=2\n');
    expect(r2.status).toBe(3);
    expect(await out(t, 'bash s.sh x')).toBe('arg1=x total=1\n');
    expect((await sh(t, 's.sh')).err).toContain('command not found');
    await sh(t, 'export PATH=$PATH:.');
    expect((await sh(t, 's.sh a')).out).toBe('arg1=a total=1\n');
  });

  test('errores de sintaxis y entrada incompleta', async () => {
    const t = mk();
    expect(t.isIncomplete('echo "abc')).toBe(true);
    expect(t.isIncomplete('if true; then')).toBe(true);
    expect(t.isIncomplete('echo hola |')).toBe(true);
    expect(t.isIncomplete('echo hola')).toBe(false);
    const r = await sh(t, 'echo )');
    expect(r.err).toContain('syntax error');
  });

  test('segundo plano, jobs y kill', async () => {
    const t = mk();
    const r = await sh(t, 'sleep 100 &');
    expect(r.text).toMatch(/\[1\] \d+/);
    expect((await sh(t, 'jobs')).out).toMatch(/\[1\]\+\s+Running\s+sleep 100 &/);
    expect((await sh(t, 'ps')).out).toContain('sleep');
    const pid = (await out(t, 'pgrep sleep')).trim();
    expect(pid).toMatch(/^\d+$/);
    const killed = await sh(t, `kill ${pid}`);
    expect(killed.text).toContain('Terminated');
    expect((await sh(t, 'pgrep sleep')).status).toBe(1);
  });

  test('Ctrl+C y Ctrl+Z sobre un sleep en primer plano', async () => {
    const t = mk();
    t.rt.timeScale = 0.01;
    const p = t.exec('sleep 100');
    await new Promise((r) => setTimeout(r, 30));
    t.signal('INT');
    const r = await p;
    expect(r.status).toBe(130);
    const p2 = t.exec('sleep 200');
    await new Promise((r2) => setTimeout(r2, 30));
    t.signal('TSTP');
    const r2 = await p2;
    expect(r2.text).toContain('Stopped');
    expect((await sh(t, 'jobs')).out).toMatch(/Stopped\s+sleep 200/);
    await sh(t, 'bg');
    expect((await sh(t, 'jobs')).out).toMatch(/Running\s+sleep 200/);
  });
  test('sustitución de procesos <( )', async () => {
    const t = mk();
    await sh(t, 'printf "uno\\ndos\\ntres\\n" > a.txt; printf "dos\\ntres\\ncuatro\\n" > b.txt');
    expect(await out(t, 'comm -12 <(sort a.txt) <(sort b.txt)')).toBe('dos\ntres\n');
    expect(await out(t, 'diff <(sort a.txt) <(sort b.txt)')).toBe('0a1\n> cuatro\n3d3\n< uno\n');
    expect(await out(t, 'while read l; do echo "-> $l"; done < <(head -n 2 a.txt)')).toBe('-> uno\n-> dos\n');
    expect(await out(t, 'cat <(echo hola) <(echo mundo)')).toBe('hola\nmundo\n');
    // los ficheros temporales se limpian al terminar la línea
    expect(await out(t, 'ls /dev/fd')).toBe('');
  });
  test('la expansión de historial ignora comentarios y cuerpos de heredoc', async () => {
    const t = mk();
    await t.exec("cat > s.sh <<'EOF'\n#!/bin/bash\necho hola\nEOF");
    expect(await out(t, 'cat s.sh')).toBe('#!/bin/bash\necho hola\n');
    expect(await out(t, 'echo ok # !!')).toBe('ok\n');
    await sh(t, 'echo uno');
    expect(await out(t, 'echo "!!"')).toContain('echo uno');
  });
});
