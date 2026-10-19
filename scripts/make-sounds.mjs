// Sintetiza los sonidos de la app (WAV 16-bit mono). Uso: node scripts/make-sounds.mjs
// Notificaciones: campana, gota, zen, pulso, arcade · Efectos: correct, wrong, complete, levelup, goal
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
mkdirSync(out, { recursive: true });

const buf = (sec) => new Float32Array(Math.floor(SR * sec));
const env = (t, a, d, rel = 0) => {
  // ataque lineal, caída exponencial (d = constante de tiempo en s)
  const att = a > 0 ? Math.min(1, t / a) : 1;
  return att * Math.exp(-t / d) * (rel ? Math.min(1, Math.max(0, (rel - t) / 0.03)) : 1);
};
const tone = (b, f, start, dur, { a = 0.005, d = 0.2, amp = 0.5, shape = 'sine', slide = 0, harm = [] } = {}) => {
  const i0 = Math.floor(start * SR);
  const n = Math.floor(dur * SR);
  let ph = 0;
  for (let i = 0; i < n && i0 + i < b.length; i++) {
    const t = i / SR;
    const fr = f + slide * (t / dur);
    ph += (2 * Math.PI * fr) / SR;
    let s;
    if (shape === 'square') s = Math.sin(ph) > 0 ? 0.6 : -0.6;
    else if (shape === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
    else s = Math.sin(ph);
    for (const [m, g] of harm) s += g * Math.sin(ph * m);
    b[i0 + i] += s * amp * env(t, a, d, dur);
  }
};
const normalize = (b, peak = 0.85) => {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  const k = m > 0 ? peak / m : 1;
  for (let i = 0; i < b.length; i++) b[i] *= k;
  // fundido final para evitar clics
  const fade = Math.floor(SR * 0.02);
  for (let i = 0; i < fade; i++) b[b.length - 1 - i] *= i / fade;
};
const wav = (name, b) => {
  normalize(b);
  const data = Buffer.alloc(44 + b.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + b.length * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(b.length * 2, 40);
  for (let i = 0; i < b.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b[i])) * 32767), 44 + i * 2);
  writeFileSync(join(out, name + '.wav'), data);
  console.log(name, (data.length / 1024).toFixed(0) + ' KB');
};

// ── notificaciones ──
{ // campana: parciales inarmónicos con caída larga
  const b = buf(1.8);
  for (const [m, g, d] of [[1, 1, 0.9], [2.01, 0.55, 0.6], [2.76, 0.4, 0.45], [4.07, 0.25, 0.3], [5.4, 0.15, 0.2]]) tone(b, 784 * m, 0, 1.8, { a: 0.002, d, amp: 0.35 * g });
  tone(b, 988, 0.32, 1.4, { a: 0.002, d: 0.7, amp: 0.25 });
  wav('campana', b);
}
{ // gota: barrido descendente rápido + rebote
  const b = buf(1.1);
  tone(b, 1400, 0, 0.18, { a: 0.001, d: 0.06, amp: 0.7, slide: -900 });
  tone(b, 1000, 0.22, 0.2, { a: 0.001, d: 0.07, amp: 0.4, slide: -600 });
  tone(b, 520, 0.5, 0.5, { a: 0.003, d: 0.2, amp: 0.25 });
  wav('gota', b);
}
{ // zen: cuenco tibetano (dos frecuencias que laten)
  const b = buf(2.8);
  for (const [f, g] of [[220, 1], [222.5, 0.9], [440.8, 0.4], [663, 0.25]]) tone(b, f, 0, 2.8, { a: 0.06, d: 1.2, amp: 0.4 * g });
  wav('zen', b);
}
{ // pulso: dos pitidos suaves
  const b = buf(0.9);
  tone(b, 659, 0, 0.16, { a: 0.004, d: 0.1, amp: 0.6, shape: 'tri' });
  tone(b, 880, 0.2, 0.28, { a: 0.004, d: 0.18, amp: 0.6, shape: 'tri' });
  tone(b, 1319, 0.2, 0.28, { a: 0.004, d: 0.12, amp: 0.2, shape: 'tri' });
  wav('pulso', b);
}
{ // arcade: arpegio de ondas cuadradas
  const b = buf(0.95);
  [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(b, f, i * 0.085, 0.12, { a: 0.002, d: 0.1, amp: 0.35, shape: 'square' }));
  wav('arcade', b);
}

// ── efectos dentro de la app ──
{ const b = buf(0.45); tone(b, 660, 0, 0.14, { a: 0.003, d: 0.1, amp: 0.6, shape: 'tri' }); tone(b, 990, 0.1, 0.3, { a: 0.003, d: 0.14, amp: 0.6, shape: 'tri' }); wav('correct', b); }
{ const b = buf(0.55); tone(b, 220, 0, 0.25, { a: 0.003, d: 0.2, amp: 0.55, shape: 'square', slide: -60 }); tone(b, 165, 0.12, 0.38, { a: 0.003, d: 0.25, amp: 0.55, shape: 'square', slide: -50 }); wav('wrong', b); }
{ // lección completada: fanfarria corta
  const b = buf(1.5);
  [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.34]].forEach(([f, t]) => tone(b, f, t, 0.5, { a: 0.003, d: 0.28, amp: 0.4, shape: 'tri' }));
  [[1047, 0.34], [1319, 0.34], [1568, 0.34]].forEach(([f, t]) => tone(b, f, t, 1.1, { a: 0.003, d: 0.6, amp: 0.22 }));
  wav('complete', b);
}
{ // subida de nivel: barrido ascendente + acorde brillante
  const b = buf(1.7);
  tone(b, 330, 0, 0.45, { a: 0.01, d: 0.5, amp: 0.4, shape: 'tri', slide: 700 });
  [523, 659, 784, 1047].forEach((f) => tone(b, f, 0.42, 1.2, { a: 0.004, d: 0.7, amp: 0.25 }));
  wav('levelup', b);
}
{ // meta del día: campanada + acorde
  const b = buf(2.0);
  for (const [m, g, d] of [[1, 1, 0.8], [2.01, 0.5, 0.5], [2.76, 0.35, 0.35]]) tone(b, 880 * m, 0, 2.0, { a: 0.002, d, amp: 0.3 * g });
  [659, 784, 988].forEach((f) => tone(b, f, 0.25, 1.6, { a: 0.01, d: 0.9, amp: 0.2, shape: 'tri' }));
  wav('goal', b);
}
