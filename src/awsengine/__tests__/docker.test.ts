import { Terminal } from '../../engine/terminal';

const APP = `from flask import Flask, jsonify

app = Flask(__name__)


@app.route('/')
def home():
    return 'Hola desde el contenedor'


@app.route('/health')
def health():
    return jsonify(status='ok')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
`;
const DOCKERFILE = `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
`;
const files = (over: Record<string, string> = {}) => ({ '/home/alumno/app/Dockerfile': DOCKERFILE, '/home/alumno/app/app.py': APP, '/home/alumno/app/requirements.txt': 'flask==3.0.3\n', ...Object.fromEntries(Object.entries(over).map(([k, v]) => [`/home/alumno/app/${k}`, v])) });
const mk = (over: Record<string, string> = {}) => new Terminal({ instant: true, aws: 'base', files: files(over), cols: 120 });

describe('docker build y run', () => {
  test('construye una imagen con su Dockerfile y la lista con su tamaño', async () => {
    const t = mk();
    const b = await t.exec('docker build -t tienda:1.0 app');
    expect(b.status).toBe(0);
    expect(b.err).toContain('FROM docker.io/library/python:3.12-slim');
    expect(b.err).toContain('RUN pip install -r requirements.txt');
    expect(b.err).toContain('naming to docker.io/library/tienda:1.0');
    const imgs = (await t.exec('docker images')).out;
    expect(imgs).toMatch(/REPOSITORY\s+TAG\s+IMAGE ID\s+CREATED\s+SIZE/);
    expect(imgs).toMatch(/tienda\s+1\.0\s+[0-9a-f]{12}/);
    const h = (await t.exec('docker history tienda:1.0')).out;
    expect(h).toContain('pip install');
    expect((await t.exec('docker inspect tienda:1.0 --format x')).out).toContain('"WorkingDir": "/app"');
  });

  test('un Dockerfile con un archivo que no existe falla al copiar; sin FROM no hay construcción', async () => {
    const t = mk({ requirements: '' });
    await t.exec('rm app/requirements.txt');
    const b = await t.exec('docker build -t tienda:1.0 app');
    expect(b.status).toBe(1);
    expect(b.err).toContain('"/requirements.txt": not found');
    const t2 = mk({ Dockerfile: 'RUN echo hola\n' });
    expect((await t2.exec('docker build -t x app')).err).toContain('FROM');
    const t3 = mk({ Dockerfile: 'FROM python:3.99\n' });
    expect((await t3.exec('docker build -t x app')).err).toContain('not found');
  });

  test('el contenedor sirve la aplicación en el puerto publicado y registra los accesos', async () => {
    const t = mk();
    await t.exec('docker build -t tienda:1.0 app');
    const run = await t.exec('docker run -d -p 8080:5000 --name web tienda:1.0');
    expect(run.status).toBe(0);
    expect(run.out).toMatch(/^[0-9a-f]{64}\n$/);
    expect((await t.exec('docker ps')).out).toMatch(/web/);
    expect((await t.exec('curl -s localhost:8080/')).out).toBe('Hola desde el contenedor');
    expect((await t.exec('curl -s localhost:8080/health')).out).toContain('"status":"ok"');
    const nf = await t.exec('curl -s -o /dev/null -w "%{http_code}" localhost:8080/nada');
    expect(nf.out).toBe('404');
    const logs = (await t.exec('docker logs web')).out;
    expect(logs).toContain('Running on all addresses (0.0.0.0)');
    expect(logs).toContain('"GET /health HTTP/1.1" 200');
    expect(logs).toContain('"GET /nada HTTP/1.1" 404');
    // otro contenedor en el mismo puerto: error; parar y borrar
    expect((await t.exec('docker run -d -p 8080:5000 tienda:1.0')).err).toContain('port is already allocated');
    expect((await t.exec('docker rm web')).err).toContain('stop the container');
    await t.exec('docker stop web');
    expect((await t.exec('curl -s localhost:8080/')).status).not.toBe(0);
    expect((await t.exec('docker rm web')).status).toBe(0);
  });

  test('si la aplicación escucha en 127.0.0.1 no se puede llegar desde fuera del contenedor', async () => {
    const t = mk({ 'app.py': APP.replace("host='0.0.0.0', ", '') });
    await t.exec('docker build -t tienda:1.0 app');
    await t.exec('docker run -d -p 8080:5000 --name web tienda:1.0');
    expect((await t.exec('docker logs web')).out).not.toContain('all addresses');
    const r = await t.exec('curl -s localhost:8080/');
    expect(r.status).toBe(52);
  });

  test('sin instalar flask el contenedor se cae con el error de Python', async () => {
    const t = mk({ requirements: '' });
    await t.exec('echo "" > app/requirements.txt');
    // `RUN pip install -r` con un archivo vacío falla; sin esa línea la importación falla al arrancar
    const t2 = mk({ Dockerfile: DOCKERFILE.replace('RUN pip install -r requirements.txt\n', '') });
    expect((await t2.exec('docker build -t tienda:1.0 app')).status).toBe(0);
    const r = await t2.exec('docker run --name web tienda:1.0');
    expect(r.status).toBe(1);
    expect(r.out).toContain("ModuleNotFoundError: No module named 'flask'");
    const ps = (await t2.exec('docker ps -a')).out;
    expect(ps).toContain('Exited (1)');
    await t.exec('true');
  });

  test('imagen arm64 en un anfitrión amd64: exec format error', async () => {
    const t = mk();
    await t.exec('docker build --platform linux/arm64 -t tienda:arm app');
    const r = await t.exec('docker run --name arm tienda:arm');
    expect(r.err).toContain('does not match the detected host platform');
    expect(r.out).toContain('exec format error');
    expect(r.status).toBe(255);
  });

  test('argumentos y otros comandos: python -c, variables de entorno y nginx estático', async () => {
    const t = mk({ Dockerfile: 'FROM python:3.12-slim\nENV SALUDO=hola\nCMD ["python", "-c", "print(1)"]\n' });
    await t.exec('docker build -t py app');
    expect((await t.exec('docker run --rm py')).status).toBe(0);
    const n = new Terminal({ instant: true, aws: 'base', files: { '/home/alumno/web/Dockerfile': 'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/index.html\n', '/home/alumno/web/index.html': '<h1>Mi tienda</h1>\n' }, cols: 120 });
    await n.exec('docker build -t sitio web');
    await n.exec('docker run -d -p 8081:80 --name sitio sitio');
    expect((await n.exec('curl -s localhost:8081/')).out).toContain('Mi tienda');
    expect((await n.exec('curl -s localhost:8081/nada.html')).out).toContain('404 Not Found');
  });
});

describe('docker con ECR', () => {
  const login = 'aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com';
  const REPO = '123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda';

  test('crear el repositorio, iniciar sesión, etiquetar y subir', async () => {
    const t = mk();
    await t.exec('docker build -t tienda:1.0 app');
    // sin repositorio ni sesión
    expect((await t.exec(`docker tag tienda:1.0 ${REPO}:1.0`)).status).toBe(0);
    expect((await t.exec(`docker push ${REPO}:1.0`)).err).toContain('no basic auth credentials');
    const l = await t.exec(login);
    expect(l.status).toBe(0);
    expect(l.out).toContain('Login Succeeded');
    const p = await t.exec(`docker push ${REPO}:1.0`);
    expect(p.status).toBe(1);
    expect(p.err).toContain("name unknown: The repository with name 'tienda' does not exist");
    expect((await t.exec('aws ecr create-repository --repository-name tienda --query repository.repositoryUri --output text')).out.trim()).toBe(REPO);
    const ok = await t.exec(`docker push ${REPO}:1.0`);
    expect(ok.status).toBe(0);
    expect(ok.out).toMatch(/1\.0: digest: sha256:[0-9a-f]{64} size: \d+/);
    expect((await t.exec('aws ecr list-images --repository-name tienda --query "imageIds[].imageTag" --output text')).out.trim()).toBe('1.0');
    const d = JSON.parse((await t.exec('aws ecr describe-images --repository-name tienda')).out).imageDetails[0];
    expect(d.imageTags).toEqual(['1.0']);
    expect(d.imageSizeInBytes).toBeGreaterThan(10_000_000);
    // la misma imagen con otra etiqueta no crea otra imagen
    await t.exec(`docker tag tienda:1.0 ${REPO}:latest`);
    await t.exec(`docker push ${REPO}:latest`);
    expect((await t.exec('aws ecr describe-images --repository-name tienda --query "length(imageDetails)"')).out.trim()).toBe('1');
    expect((await t.exec('aws ecr describe-images --repository-name tienda --query "imageDetails[0].imageTags" --output text')).out).toMatch(/1\.0\s+latest|latest\s+1\.0/);
    // bajar la imagen y ejecutarla desde ECR
    await t.exec(`docker rmi ${REPO}:1.0 ${REPO}:latest tienda:1.0`);
    const run = await t.exec(`docker run -d -p 9000:5000 ${REPO}:latest`);
    expect(run.status).toBe(0);
    expect(run.err).toContain('Unable to find image');
    expect((await t.exec('curl -s localhost:9000/')).out).toBe('Hola desde el contenedor');
  });

  test('etiquetas inmutables, escaneo al subir y política de ciclo de vida', async () => {
    const t = mk();
    await t.exec('docker build -t tienda:1.0 app');
    await t.exec('aws ecr create-repository --repository-name tienda --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true');
    await t.exec(login);
    await t.exec(`docker tag tienda:1.0 ${REPO}:1.0`);
    expect((await t.exec(`docker push ${REPO}:1.0`)).status).toBe(0);
    // una imagen distinta con la misma etiqueta
    await t.exec('echo "# cambio" >> app/app.py');
    await t.exec('docker build -t tienda:1.1 app');
    await t.exec(`docker tag tienda:1.1 ${REPO}:1.0`);
    const re = await t.exec(`docker push ${REPO}:1.0`);
    expect(re.status).toBe(1);
    expect(re.err).toContain('immutable');
    // escaneo
    await t.exec('sleep 60');
    const sc = JSON.parse((await t.exec('aws ecr describe-image-scan-findings --repository-name tienda --image-id imageTag=1.0')).out);
    expect(sc.imageScanStatus.status).toBe('COMPLETE');
    expect(Object.keys(sc.imageScanFindings.findingSeverityCounts).every((k) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(k))).toBe(true);
    // ciclo de vida: conservar solo las 2 últimas
    await t.exec('aws ecr put-image-tag-mutability --repository-name tienda --image-tag-mutability MUTABLE');
    for (const v of ['1.1', '1.2', '1.3']) {
      await t.exec(`echo "# ${v}" >> app/app.py`);
      await t.exec(`docker build -t tienda:${v} app`);
      await t.exec(`docker tag tienda:${v} ${REPO}:${v}`);
      await t.exec(`docker push ${REPO}:${v}`);
      await t.exec('sleep 5');
    }
    expect((await t.exec('aws ecr list-images --repository-name tienda --query "length(imageIds)"')).out.trim()).toBe('4');
    const pol = JSON.stringify({ rules: [{ rulePriority: 1, description: 'solo 2', selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 2 }, action: { type: 'expire' } }] });
    await t.exec(`aws ecr start-lifecycle-policy-preview --repository-name tienda --lifecycle-policy-text '${pol}'`);
    const pr = JSON.parse((await t.exec('aws ecr get-lifecycle-policy-preview --repository-name tienda')).out);
    expect(pr.summary.expiringImageTotalCount).toBe(2);
    await t.exec(`aws ecr put-lifecycle-policy --repository-name tienda --lifecycle-policy-text '${pol}'`);
    await t.exec('sleep 120');
    expect((await t.exec('aws ecr list-images --repository-name tienda --query "length(imageIds)"')).out.trim()).toBe('2');
    const bad = JSON.stringify({ rules: [{ rulePriority: 1, selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 1 }, action: { type: 'expire' } }, { rulePriority: 2, selection: { tagStatus: 'untagged', countType: 'imageCountMoreThan', countNumber: 1 }, action: { type: 'expire' } }] });
    expect((await t.exec(`aws ecr put-lifecycle-policy --repository-name tienda --lifecycle-policy-text '${bad}'`)).err).toContain('highest rulePriority');
  });

  test('un usuario sin permisos de ECR no puede subir imágenes', async () => {
    const t = new Terminal({ instant: true, aws: { scenario: 'equipo', as: 'ana' }, files: files(), cols: 120 });
    await t.exec('docker build -t tienda:1.0 app');
    const who = (await t.exec('aws sts get-caller-identity --query Arn --output text')).out;
    expect(who).toContain('ana');
    const mkRepo = await t.exec('aws ecr create-repository --repository-name tienda');
    expect(mkRepo.status).not.toBe(0);
    expect(mkRepo.err).toContain('not authorized');
  });
});
