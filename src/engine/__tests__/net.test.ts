import { mk, out, sh } from './helpers';
import type { Terminal } from '../terminal';

describe('red e internet simulada', () => {
  test('ping a DNS públicos y resolución', async () => {
    const t = mk();
    expect(await out(t, 'ping -c 1 8.8.8.8')).toContain('1 received');
    expect(await out(t, 'ping -c 1 1.1.1.1')).toContain('0% packet loss');
  });

  test('ssh-keygen -N no pregunta la contraseña', async () => {
    const t = mk();
    const r = await sh(t, 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519');
    expect(r.status).toBe(0);
    expect(await out(t, 'ls ~/.ssh')).toContain('id_ed25519.pub');
  });

  test('ssh-copy-id instala la clave y ssh/scp dejan de pedir contraseña', async () => {
    const t = mk();
    await sh(t, 'echo hola > datos.txt');
    await sh(t, 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519');
    // sin clave autorizada: pide host key y contraseña
    const copy = t.exec('ssh-copy-id server');
    const settle = async () => {
      for (let k = 0; k < 3000; k++) {
        await new Promise((r) => setTimeout(r, 1));
        if (!t.busy || t.awaitingInput) break;
      }
    };
    await settle();
    expect(t.awaitingInput).toBe(true);
    void t.exec('yes');
    await settle();
    expect(t.awaitingInput).toBe(true);
    void t.exec('alumno');
    await copy;
    expect(t.last?.stdout).toContain('Number of key(s) added: 1');
    // con la clave: sin contraseña
    const who = await sh(t, 'ssh server hostname');
    expect(who.out.trim()).toBe('server');
    expect(who.err).not.toContain('password');
    const up = await sh(t, 'scp datos.txt server:/tmp/');
    expect(up.out).toContain('datos.txt');
    expect((await sh(t, 'ssh server cat /tmp/datos.txt')).out).toBe('hola\n');
    // /etc/hostname del servidor coincide con su nombre
    expect((await sh(t, 'ssh server cat /etc/hostname')).out.trim()).toBe('server');
    // segunda vez: la clave ya existe
    expect((await sh(t, 'ssh-copy-id server')).out).toContain('already exist');
  });
});
