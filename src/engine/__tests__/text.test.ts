import { mk, out, sh } from './helpers';

const DATA = 'manzana 5 rojo\nbanana 12 amarillo\ncereza 7 rojo\nbanana 3 verde\n';

async function withData() {
  const t = mk();
  await sh(t, `printf '${DATA.replace(/\n/g, '\\n')}' > frutas.txt`);
  return t;
}

describe('grep', () => {
  test('básico, -i -v -n -c -w -o -E', async () => {
    const t = await withData();
    expect(await out(t, 'grep banana frutas.txt')).toBe('banana 12 amarillo\nbanana 3 verde\n');
    expect(await out(t, 'grep -c rojo frutas.txt')).toBe('2\n');
    expect(await out(t, 'grep -n cereza frutas.txt')).toBe('3:cereza 7 rojo\n');
    expect(await out(t, 'grep -v rojo frutas.txt')).toBe('banana 12 amarillo\nbanana 3 verde\n');
    expect(await out(t, 'grep -i MANZANA frutas.txt')).toBe('manzana 5 rojo\n');
    expect(await out(t, 'grep -o "[0-9]\\+" frutas.txt')).toBe('5\n12\n7\n3\n');
    expect(await out(t, 'grep -E "^(manzana|cereza)" frutas.txt')).toBe('manzana 5 rojo\ncereza 7 rojo\n');
    expect(await out(t, 'grep -w "an" frutas.txt')).toBe('');
    expect((await sh(t, 'grep zzz frutas.txt')).status).toBe(1);
    expect(await out(t, 'cat frutas.txt | grep rojo | wc -l')).toBe('2\n');
    expect(await out(t, 'grep -e manzana -e verde frutas.txt')).toBe('manzana 5 rojo\nbanana 3 verde\n');
    expect(await out(t, 'grep -A1 manzana frutas.txt')).toBe('manzana 5 rojo\nbanana 12 amarillo\n');
    expect(await out(t, 'grep -l rojo frutas.txt Documents/ 2>/dev/null')).toBe('frutas.txt\n');
  });

  test('recursivo y varios archivos', async () => {
    const t = mk({ lab: true });
    expect(await out(t, 'grep -rn "TODO" projects')).toBe('projects/web/app.js:2:// TODO: añadir interactividad\n');
    expect(await out(t, 'grep -rl "Hola" projects | sort')).toContain('projects/web/index.html');
    expect(await out(t, 'grep -c ERROR logs/app.log')).toMatch(/^\d+\n$/);
    expect(await out(t, 'grep -r --include="*.css" color projects')).toContain('style.css');
    expect(await out(t, 'grep error Documents/notes.txt Documents/todo.md')).toBe('');
    expect(await out(t, 'grep -H Linux Documents/notes.txt | head -1')).toMatch(/^Documents\/notes\.txt:Linux es/);
  });
});

describe('sed', () => {
  test('sustituciones y borrados', async () => {
    const t = await withData();
    expect(await out(t, "sed 's/banana/pera/' frutas.txt")).toBe('manzana 5 rojo\npera 12 amarillo\ncereza 7 rojo\npera 3 verde\n');
    expect(await out(t, "echo aaa | sed 's/a/b/g'")).toBe('bbb\n');
    expect(await out(t, "echo aaa | sed 's/a/b/2'")).toBe('aba\n');
    expect(await out(t, "sed -n '2,3p' frutas.txt")).toBe('banana 12 amarillo\ncereza 7 rojo\n');
    expect(await out(t, "sed '2d' frutas.txt | wc -l")).toBe('3\n');
    expect(await out(t, "sed '/rojo/d' frutas.txt")).toBe('banana 12 amarillo\nbanana 3 verde\n');
    expect(await out(t, "sed -E 's/([a-z]+) ([0-9]+)/\\2 \\1/' frutas.txt | head -1")).toBe('5 manzana rojo\n');
    expect(await out(t, "echo 'hola mundo' | sed 's/\\(hola\\) \\(mundo\\)/\\2 \\1/'")).toBe('mundo hola\n');
    expect(await out(t, "echo hola | sed 's/hola/\\U&/'")).toBe('HOLA\n');
    expect(await out(t, "sed -n '$p' frutas.txt")).toBe('banana 3 verde\n');
    expect(await out(t, "sed '1i\\ENCABEZADO' frutas.txt | head -2")).toBe('ENCABEZADO\nmanzana 5 rojo\n');
    expect(await out(t, "printf 'a\\nb\\n' | sed 'y/ab/AB/'")).toBe('A\nB\n');
    await sh(t, "sed -i 's/rojo/ROJO/' frutas.txt");
    expect(await out(t, 'grep -c ROJO frutas.txt')).toBe('2\n');
    await sh(t, "sed -i.bak 's/ROJO/rojo/' frutas.txt");
    expect(await out(t, 'ls frutas.txt.bak')).toBe('frutas.txt.bak\n');
    expect(await out(t, "seq 5 | sed -n '2~2p'")).toBe('2\n4\n');
    expect(await out(t, "seq 3 | sed '2s/.*/dos/;3d'")).toBe('1\ndos\n');
  });
});

describe('awk', () => {
  test('campos, patrones y acumuladores', async () => {
    const t = await withData();
    expect(await out(t, "awk '{print $1}' frutas.txt")).toBe('manzana\nbanana\ncereza\nbanana\n');
    expect(await out(t, "awk '{print $2, $1}' frutas.txt | head -1")).toBe('5 manzana\n');
    expect(await out(t, "awk '$2 > 6' frutas.txt")).toBe('banana 12 amarillo\ncereza 7 rojo\n');
    expect(await out(t, "awk '{s+=$2} END {print s}' frutas.txt")).toBe('27\n');
    expect(await out(t, "awk '/rojo/ {n++} END {print n}' frutas.txt")).toBe('2\n');
    expect(await out(t, "awk 'NR==2 {print $1}' frutas.txt")).toBe('banana\n');
    expect(await out(t, "awk 'END {print NR, NF}' frutas.txt")).toBe('4 3\n');
    expect(await out(t, "awk -F: '{print $1}' /etc/passwd | head -2")).toBe('root\ndaemon\n');
    expect(await out(t, "awk 'BEGIN {print \"inicio\"} {c++} END {print c, \"líneas\"}' frutas.txt")).toBe('inicio\n4 líneas\n');
    expect(await out(t, "awk '{a[$1]+=$2} END {for (k in a) print k, a[k]}' frutas.txt | sort")).toBe('banana 15\ncereza 7\nmanzana 5\n');
    expect(await out(t, "awk '{printf \"%-10s|%3d\\n\", $1, $2}' frutas.txt | head -1")).toBe('manzana   |  5\n');
    expect(await out(t, "awk '{print length($1)}' frutas.txt | head -1")).toBe('7\n');
    expect(await out(t, "awk '{print toupper(substr($1,1,1)) substr($1,2)}' frutas.txt | head -1")).toBe('Manzana\n');
    expect(await out(t, "echo 'a,b,c' | awk -F, '{print $NF}'")).toBe('c\n');
    expect(await out(t, "awk 'NR>1 && NR<4' frutas.txt | wc -l")).toBe('2\n');
    expect(await out(t, "awk -v n=10 '{print $2*n}' frutas.txt | head -1")).toBe('50\n');
    expect(await out(t, "echo 3 4 | awk '{print $1+$2, $1*$2, $1/$2}'")).toBe('7 12 0.75\n');
    expect(await out(t, "awk '{gsub(/a/,\"A\"); print}' frutas.txt | head -1")).toBe('mAnzAnA 5 rojo\n');
    expect(await out(t, "awk 'length > 15' frutas.txt")).toBe('banana 12 amarillo\n');
    expect(await out(t, "awk '$3==\"rojo\" {print $1}' frutas.txt")).toBe('manzana\ncereza\n');
  });
});

describe('sort, uniq, cut, tr y compañía', () => {
  test('sort y uniq', async () => {
    const t = await withData();
    expect(await out(t, 'cut -d" " -f1 frutas.txt | sort | uniq -c')).toBe('      2 banana\n      1 cereza\n      1 manzana\n');
    expect(await out(t, 'sort -k2 -n frutas.txt | head -1')).toBe('banana 3 verde\n');
    expect(await out(t, 'sort -k2,2nr frutas.txt | head -1')).toBe('banana 12 amarillo\n');
    expect(await out(t, 'printf "b\\na\\nb\\nc\\n" | sort -u')).toBe('a\nb\nc\n');
    expect(await out(t, 'printf "10\\n9\\n100\\n" | sort -n')).toBe('9\n10\n100\n');
    expect(await out(t, 'printf "10\\n9\\n100\\n" | sort')).toBe('10\n100\n9\n');
    expect(await out(t, 'printf "b\\nA\\nc\\n" | sort')).toBe('A\nb\nc\n');
    expect(await out(t, 'printf "a\\na\\nb\\n" | uniq -d')).toBe('a\n');
    expect(await out(t, 'sort frutas.txt | uniq -c | sort -rn | head -1')).toMatch(/1 /);
    expect(await out(t, "printf '2 b\\n1 a\\n' | sort -k1,1n")).toBe('1 a\n2 b\n');
    expect(await out(t, "printf 'x,2\\ny,1\\n' | sort -t, -k2 -n")).toBe('y,1\nx,2\n');
  });

  test('cut, tr, tee, rev, tac, nl, paste, column', async () => {
    const t = await withData();
    expect(await out(t, 'cut -c1-3 frutas.txt | head -2')).toBe('man\nban\n');
    expect(await out(t, "cut -d' ' -f1,3 frutas.txt | head -1")).toBe('manzana rojo\n');
    expect(await out(t, "echo 'Hola Mundo' | tr 'a-z' 'A-Z'")).toBe('HOLA MUNDO\n');
    expect(await out(t, "echo 'hola' | tr -d 'l'")).toBe('hoa\n');
    expect(await out(t, "echo 'a   b' | tr -s ' '")).toBe('a b\n');
    expect(await out(t, "echo 'hola' | tr '[:lower:]' '[:upper:]'")).toBe('HOLA\n');
    expect(await out(t, 'echo abc | rev')).toBe('cba\n');
    expect(await out(t, 'printf "1\\n2\\n" | tac')).toBe('2\n1\n');
    expect(await out(t, 'echo hola | tee copia.txt')).toBe('hola\n');
    expect(await out(t, 'cat copia.txt')).toBe('hola\n');
    expect(await out(t, 'printf "a\\nb\\n" | nl')).toBe('     1\ta\n     2\tb\n');
    expect(await out(t, 'printf "a\\nb\\n" > l1; printf "1\\n2\\n" > l2; paste l1 l2')).toBe('a\t1\nb\t2\n');
    expect(await out(t, 'printf "a b\\nccc d\\n" | column -t')).toBe('a    b\nccc  d\n');
    expect(await out(t, 'seq -s, 1 5')).toBe('1,2,3,4,5\n');
    expect(await out(t, 'expr 2 + 3')).toBe('5\n');
    expect(await out(t, 'expr length hello')).toBe('5\n');
    expect(await out(t, 'echo hola | base64')).toBe('aG9sYQo=\n');
    expect(await out(t, 'echo aG9sYQo= | base64 -d')).toBe('hola\n');
    expect(await out(t, 'echo hello | md5sum')).toBe('b1946ac92492d2347c6235b4d2611184  -\n');
    expect(await out(t, 'echo -n abc | sha256sum')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n');
    expect(await out(t, 'echo hello | sha1sum')).toBe('f572d396fae9206628714fb2ce00f72e94f2258f  -\n');
  });

  test('diff, comm, xargs', async () => {
    const t = mk();
    await sh(t, 'printf "a\\nb\\nc\\n" > x; printf "a\\nB\\nc\\nd\\n" > y');
    expect(await out(t, 'diff x y')).toBe('2c2\n< b\n---\n> B\n3a4\n> d\n');
    expect((await sh(t, 'diff x x')).status).toBe(0);
    expect((await sh(t, 'diff x y')).status).toBe(1);
    expect(await out(t, 'diff -u x y | tail -n +3')).toBe('@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n');
    expect(await out(t, 'diff -q x y')).toBe('Files x and y differ\n');
    expect(await out(t, 'printf "1\\n2\\n3\\n" > p; printf "2\\n3\\n4\\n" > q; comm -12 p q')).toBe('2\n3\n');
    expect(await out(t, 'echo a b c | xargs -n1')).toBe('a\nb\nc\n');
    expect(await out(t, 'echo a b c | xargs echo x')).toBe('x a b c\n');
    expect(await out(t, 'printf "1\\n2\\n" | xargs -I{} echo n={}')).toBe('n=1\nn=2\n');
    await sh(t, 'touch f1.tmp f2.tmp');
    await sh(t, 'ls *.tmp | xargs rm');
    expect((await sh(t, 'ls *.tmp')).status).toBe(2);
    expect(await out(t, 'find / -name hosts -type f 2>/dev/null | xargs grep -l localhost')).toContain('/etc/hosts');
  });
});

describe('fecha y misc', () => {
  test('date, cal, seq, printf', async () => {
    const t = mk();
    expect(await out(t, 'date +%F')).toBe('2026-03-14\n');
    expect(await out(t, 'date +"%H:%M"')).toMatch(/^10:\d\d\n$/);
    expect(await out(t, 'date -d "yesterday" +%F')).toBe('2026-03-13\n');
    expect(await out(t, 'date -d "2 days ago" +%A')).toBe('Thursday\n');
    expect(await out(t, 'date')).toMatch(/^Sat Mar 14 \d\d:\d\d:\d\d UTC 2026\n$/);
    expect(await out(t, 'cal 3 2026')).toContain('March 2026');
    expect(await out(t, 'uname -r')).toBe('6.8.0-45-generic\n');
    expect(await out(t, 'whoami; hostname')).toBe('alumno\ndojo\n');
    expect(await out(t, 'echo $RANDOM | grep -c "^[0-9]*$"')).toBe('1\n');
  });
});
