import { MiniShell } from '../minish';
import { mkEnv } from './helpers';

function shell(files: Record<string, string> = {}, vars: Record<string, string> = {}) {
  const e = mkEnv();
  const fs = new Map<string, string>(Object.entries(files).map(([k, v]) => [k.startsWith('/') ? k : `/src/${k}`, v]));
  fs.set('/root/.aws/credentials', e.files.get('/home/alumno/.aws/credentials')!);
  fs.set('/root/.aws/config', e.files.get('/home/alumno/.aws/config') ?? '[default]\nregion = us-east-1\n');
  const log: string[] = [];
  const sh = new MiniShell({ acct: e.acct, files: fs, vars: { AWS_DEFAULT_REGION: 'us-east-1', ...vars }, cwd: '/src', log: (l) => log.push(l) });
  return { sh, log, fs, e };
}

describe('intérprete de shell de CodeBuild', () => {
  test('variables, operadores, sustitución y comillas', () => {
    const { sh, log } = shell({}, { NOMBRE: 'tienda' });
    expect(sh.run('echo hola $NOMBRE')).toBe(0);
    expect(sh.run('X=5 && echo "x=$X" && false || echo alternativa')).toBe(0);
    sh.run('Y=$(echo uno dos)');
    sh.run('for w in $Y; do echo "[$w]"; done');
    sh.run("echo 'sin $expandir' \"con ${NOMBRE}\" ${NADA:-defecto}");
    sh.run('if [ "$NOMBRE" = "tienda" ]; then echo es-tienda; else echo no; fi');
    sh.run('if [ -z "$NOMBRE" ]; then echo vacio; elif [ -n "$NOMBRE" ]; then echo lleno; fi');
    expect(log).toEqual(['hola tienda', 'x=5', 'alternativa', '[uno]', '[dos]', 'sin $expandir con tienda defecto', 'es-tienda', 'lleno']);
    expect(sh.run('exit 3')).toBe(3);
    expect(sh.run('nada-existe')).toBe(127);
    expect(log.at(-1)).toContain('command not found');
  });

  test('archivos: redirecciones, tuberías, zip y unzip', () => {
    const { sh, log, fs } = shell({ 'app.py': 'x=1\n', 'lib/util.py': 'y=2\n' });
    sh.run('echo uno > a.txt && echo dos >> a.txt && cat a.txt | head -n 1');
    expect(fs.get('/src/a.txt')).toBe('uno\ndos\n');
    expect(log).toEqual(['uno']);
    sh.run('mkdir -p build && zip -qr build/app.zip app.py lib');
    expect(fs.get('/src/build/app.zip')).toMatch(/^PK/);
    sh.run('mkdir out && unzip -q build/app.zip -d out && ls out');
    expect(fs.get('/src/out/lib/util.py')).toBe('y=2\n');
    expect(log.slice(1)).toEqual(['app.py', 'lib']);
    expect(sh.run('cat falta.txt 2>/dev/null')).toBe(1);
    expect(sh.run('[ -f app.py ] && echo existe')).toBe(0);
    expect(sh.run('cd lib && pwd')).toBe(0);
    expect(log.at(-1)).toBe('/src/lib');
  });

  test('aws con las credenciales de la cuenta, y su salida se captura', () => {
    const { sh, log } = shell();
    expect(sh.run('ACCOUNT=$(aws sts get-caller-identity --query Account --output text) && echo cuenta=$ACCOUNT')).toBe(0);
    expect(log).toEqual(['cuenta=123456789012']);
    expect(sh.run('aws s3 mb s3://bucket-de-build')).toBe(0);
    expect(sh.run('aws s3 ls | grep bucket-de')).toBe(0);
    expect(sh.run('aws s3 mb s3://bucket-de-build')).not.toBe(0);
    sh.run('echo hola > f.txt && aws s3 cp f.txt s3://bucket-de-build/f.txt');
    expect(sh.run('aws s3 ls s3://bucket-de-build/')).toBe(0);
    expect(log.join('\n')).toContain('f.txt');
  });

  test('pytest y pip', () => {
    const files = { 'app.py': 'def suma(a, b):\n    return a + b\n', 'test_app.py': 'from app import suma\n\ndef test_ok():\n    assert suma(1, 2) == 3\n\ndef test_mal():\n    assert suma(1, 2) == 4\n', 'requirements.txt': 'boto3\npytest==8.1.1\n' };
    const { sh, log } = shell(files);
    expect(sh.run('pip install -r requirements.txt')).toBe(0);
    expect(log.join('\n')).toContain('Successfully installed boto3-1.0.0 pytest-1.0.0');
    expect(sh.run('pytest')).toBe(1);
    const out = log.join('\n');
    expect(out).toContain('test_app.py .F');
    expect(out).toContain('FAILED test_app.py::test_mal');
    expect(out).toContain('1 failed, 1 passed');
    const ok = shell({ ...files, 'test_app.py': files['test_app.py'].replace('== 4', '== 3') });
    expect(ok.sh.run('python3 -m pytest')).toBe(0);
    expect(ok.log.join('\n')).toContain('2 passed');
    const none = shell({ 'app.py': 'x=1\n' });
    expect(none.sh.run('pytest')).toBe(5);
    expect(none.sh.run('python3 app.py')).toBe(0);
    expect(none.sh.run('python3 -c "print(1+1)"')).toBe(0);
    expect(none.log.at(-1)).toBe('2');
    expect(none.sh.run('pip install -r nada.txt')).toBe(1);
  });
});
