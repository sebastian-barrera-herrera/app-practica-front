import { renderTable } from '../render';

const DATA = { Users: [{ UserName: 'carla', Arn: 'arn:aws:iam::123456789012:user/equipo/carla', CreateDate: '2026-03-14T10:00:00+00:00' }] };

describe('--output table', () => {
  test('a su anchura natural cuando no hay límite', () => {
    const lines = renderTable(DATA.Users, 'ListUsers').trimEnd().split('\n');
    expect(Math.max(...lines.map((l) => l.length))).toBeGreaterThan(80);
    expect(lines.some((l) => l.includes('arn:aws:iam::123456789012:user/equipo/carla'))).toBe(true);
  });

  test('con límite de anchura parte las celdas en varias líneas y no se pasa', () => {
    const lines = renderTable(DATA.Users, 'ListUsers', 44).trimEnd().split('\n');
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(44);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    // ningún dato se pierde: al juntar los trozos de la columna Arn sale el ARN completo
    const arn = lines.filter((l) => /^\|\s/.test(l)).map((l) => (l.split('|')[1] ?? '').trim()).join('');
    expect(arn).toContain('arn:aws:iam::123456789012:user/equipo/carla');
  });
});
