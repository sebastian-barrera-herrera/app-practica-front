/**
 * Personalización del perfil: avatares, marcos, fondos y accesorios que se compran con monedas 🪙.
 * Lo comprado vive en `extras.bought` («cos:id», solo crece, así que se fusiona entre dispositivos) y lo que lleva
 * puesto el perfil en `extras.look`.
 */
import { balance, defaultLook, owned, type Extras, type Look } from './economy';
import type { RootState } from './root';

export type CosKind = 'avatar' | 'frame' | 'bg' | 'acc';
export type Rarity = 'comun' | 'raro' | 'epico' | 'legendario';

export const RARITY: Record<Rarity, { label: string; color: string }> = {
  comun: { label: 'Común', color: '#9CA3AF' },
  raro: { label: 'Raro', color: '#38BDF8' },
  epico: { label: 'Épico', color: '#A78BFA' },
  legendario: { label: 'Legendario', color: '#FBBF24' },
};

export const KIND_LABEL: Record<CosKind, { title: string; one: string; emoji: string }> = {
  avatar: { title: 'Avatares', one: 'avatar', emoji: '🧑‍🎤' },
  frame: { title: 'Marcos', one: 'marco', emoji: '🖼️' },
  bg: { title: 'Fondos', one: 'fondo', emoji: '🌄' },
  acc: { title: 'Accesorios', one: 'accesorio', emoji: '🎩' },
};

export interface Cosmetic {
  id: string;
  kind: CosKind;
  name: string;
  /** Avatar: el personaje; accesorio: lo que se coloca; marco y fondo: icono del catálogo. */
  emoji: string;
  /** 0 = viene de serie. */
  price: number;
  rarity: Rarity;
  /** Marcos y fondos: colores del degradado (de 1 a 5). */
  colors?: string[];
  /** Marcos: brillo alrededor. */
  glow?: boolean;
  /** Marco legendario con los colores girando. */
  spin?: boolean;
  /** Accesorios: dónde se coloca sobre el avatar. */
  place?: 'top' | 'eyes' | 'corner';
  desc: string;
}

const av = (id: string, emoji: string, name: string, price: number, rarity: Rarity, desc: string): Cosmetic => ({ id, kind: 'avatar', emoji, name, price, rarity, desc });
const fr = (id: string, emoji: string, name: string, price: number, rarity: Rarity, colors: string[], desc: string, o: Partial<Cosmetic> = {}): Cosmetic => ({ id, kind: 'frame', emoji, name, price, rarity, colors, desc, ...o });
const bg = (id: string, emoji: string, name: string, price: number, rarity: Rarity, colors: string[], desc: string): Cosmetic => ({ id, kind: 'bg', emoji, name, price, rarity, colors, desc });
const ac = (id: string, emoji: string, name: string, price: number, rarity: Rarity, place: 'top' | 'eyes' | 'corner', desc: string): Cosmetic => ({ id, kind: 'acc', emoji, name, price, rarity, place, desc });

export const COSMETICS: Cosmetic[] = [
  // ── avatares ──
  av('penguin', '🐧', 'Pingüi', 0, 'comun', 'El sensei del dojo. Viene contigo desde el primer día.'),
  av('gato', '🐱', 'Gato', 60, 'comun', 'Curioso y sigiloso: siempre cae de pie, hasta en un ROLLBACK.'),
  av('perro', '🐶', 'Perro', 60, 'comun', 'Leal compañero de estudio. Busca bugs como si fueran pelotas.'),
  av('rana', '🐸', 'Rana', 70, 'comun', 'Salta de lección en lección sin mojarse.'),
  av('mono', '🐵', 'Mono', 70, 'comun', 'Aprende rápido… y no se cansa de probar cosas.'),
  av('zorro', '🦊', 'Zorro', 90, 'comun', 'Astuto: encuentra el atajo en cada consulta.'),
  av('panda', '🐼', 'Panda', 90, 'comun', 'Calma total aunque falle el compilador.'),
  av('buho', '🦉', 'Búho', 220, 'raro', 'Estudia de noche y recuerda todo lo que lee.'),
  av('pulpo', '🐙', 'Pulpo', 220, 'raro', 'Ocho brazos para ocho terminales abiertas a la vez.'),
  av('unicornio', '🦄', 'Unicornio', 260, 'raro', 'Escaso, brillante y con muy buen código.'),
  av('robot', '🤖', 'Robot', 280, 'raro', 'Ejecuta sin quejarse. Cero errores de sintaxis (dicen).'),
  av('alien', '👽', 'Alien', 280, 'raro', 'Viene de otro planeta… donde todo es open source.'),
  av('ninja', '🥷', 'Ninja', 300, 'raro', 'Sigiloso: despliega a producción sin que nadie se entere.'),
  av('lobo', '🐺', 'Lobo', 500, 'epico', 'Lobo solitario: resuelve el reto antes de que acabe la pista.'),
  av('trex', '🦖', 'T-Rex', 550, 'epico', 'Código legado de verdad: lleva millones de años en producción.'),
  av('dragon', '🐉', 'Dragón', 600, 'epico', 'Guarda un tesoro de buenas prácticas y no lo comparte.'),
  av('mago', '🧙', 'Mago', 600, 'epico', 'Con un solo comando hace magia. Y no se sabe cómo.'),
  av('aguila', '🦅', 'Águila', 1000, 'legendario', 'Ve el error desde las alturas, antes de ejecutar.'),
  av('leon', '🦁', 'León', 1200, 'legendario', 'El rey de la selva… y de los exámenes de salto.'),

  // ── marcos ──
  fr('none', '⚪', 'Sin marco', 0, 'comun', [], 'Sin adorno: solo tú.'),
  fr('bronce', '🥉', 'Bronce', 80, 'comun', ['#E0A268', '#8C5A2B'], 'El primer metal: todos empiezan por aquí.'),
  fr('plata', '🥈', 'Plata', 120, 'comun', ['#F3F4F6', '#9CA3AF'], 'Brillo discreto de quien ya domina lo básico.'),
  fr('oro', '🥇', 'Oro', 250, 'raro', ['#FDE68A', '#F59E0B'], 'Dorado y con un ligero resplandor.', { glow: true }),
  fr('neon', '💠', 'Neón', 250, 'raro', ['#22D3EE', '#818CF8'], 'Luz de terminal en plena noche.', { glow: true }),
  fr('esmeralda', '💚', 'Esmeralda', 300, 'raro', ['#6EE7B7', '#047857'], 'Verde profundo, como el prompt de tu consola.', { glow: true }),
  fr('fuego', '🔥', 'Fuego', 500, 'epico', ['#FDE047', '#F97316', '#DC2626'], 'Arde cuando mantienes la racha.', { glow: true }),
  fr('arcoiris', '🌈', 'Arcoíris', 900, 'legendario', ['#F87171', '#FBBF24', '#34D399', '#38BDF8', '#A78BFA'], 'Colores que giran sin parar. El marco de las leyendas.', { glow: true, spin: true }),

  // ── fondos ──
  bg('none', '⚫', 'Sin fondo', 0, 'comun', ['#1E2A55', '#141B3A'], 'El azul noche de siempre.'),
  bg('atardecer', '🌇', 'Atardecer', 60, 'comun', ['#FB923C', '#DB2777'], 'Naranja y rosa al terminar la jornada.'),
  bg('oceano', '🌊', 'Océano', 60, 'comun', ['#38BDF8', '#1D4ED8'], 'Profundo y tranquilo, ideal para concentrarse.'),
  bg('bosque', '🌲', 'Bosque', 60, 'comun', ['#4ADE80', '#14532D'], 'Verde bosque. Respira.'),
  bg('menta', '🍃', 'Menta', 90, 'comun', ['#6EE7B7', '#0EA5E9'], 'Fresco, como una instalación limpia.'),
  bg('sakura', '🌸', 'Sakura', 120, 'comun', ['#FBCFE8', '#EC4899'], 'Cerezos en flor del dojo.'),
  bg('lava', '🌋', 'Lava', 250, 'raro', ['#FB923C', '#7F1D1D'], 'Para quienes aprenden a fuego lento.'),
  bg('galaxia', '🌌', 'Galaxia', 350, 'epico', ['#7C3AED', '#0B1020'], 'Un universo entero detrás de ti.'),
  bg('aurora', '✨', 'Aurora', 600, 'legendario', ['#22D3EE', '#A78BFA', '#34D399'], 'Luces del norte en movimiento… casi.'),

  // ── accesorios ──
  ac('none', '🚫', 'Sin accesorio', 0, 'comun', 'top', 'Sin nada extra.'),
  ac('gorra', '🧢', 'Gorra', 60, 'comun', 'top', 'Para los días de estudio informal.'),
  ac('flor', '🌸', 'Flor', 70, 'comun', 'corner', 'Un toque de primavera.'),
  ac('estrella', '⭐', 'Estrella', 100, 'comun', 'corner', 'Porque te la mereces.'),
  ac('gafas', '🕶️', 'Gafas de sol', 120, 'comun', 'eyes', 'Modo «lo tengo todo bajo control».'),
  ac('sombrero', '🎩', 'Sombrero de copa', 140, 'comun', 'top', 'Elegancia de nivel avanzado.'),
  ac('birrete', '🎓', 'Birrete', 160, 'raro', 'top', 'Graduado de la zona final (o casi).'),
  ac('cascos', '🎧', 'Cascos', 200, 'raro', 'top', 'Lo-fi para programar mejor.'),
  ac('llama', '🔥', 'Llama', 220, 'raro', 'corner', 'Tu racha, en llamas.'),
  ac('trofeo', '🏆', 'Trofeo', 400, 'epico', 'corner', 'Campeón de exámenes.'),
  ac('corona', '👑', 'Corona', 500, 'epico', 'top', 'Para quien reina en el ranking de aciertos.'),
  ac('diamante', '💎', 'Diamante', 700, 'legendario', 'corner', 'Raro, valioso y resistente a los bugs.'),
];

/** Elementos de una categoría (los de serie primero). */
export const cosmeticsOf = (kind: CosKind): Cosmetic[] => COSMETICS.filter((c) => c.kind === kind);

export const cosmeticById = (kind: CosKind, id: string): Cosmetic | undefined => COSMETICS.find((c) => c.kind === kind && c.id === id);
const find = cosmeticById;

const key = (c: Cosmetic) => `cos:${c.kind}:${c.id}`;

/** ¿Es del jugador? (lo de serie siempre lo es) */
export const hasCosmetic = (ex: Extras, c: Cosmetic): boolean => c.price === 0 || owned(ex, key(c)) >= 1;

/** El aspecto que se dibuja: lo que no existe o no se tiene vuelve a lo de serie. */
export function resolveLook(ex: Extras): Look {
  const d = defaultLook();
  const pick = (kind: CosKind, id: string, def: string) => {
    const c = find(kind, id);
    return c && hasCosmetic(ex, c) ? c.id : def;
  };
  return { avatar: pick('avatar', ex.look.avatar, d.avatar), frame: pick('frame', ex.look.frame, d.frame), bg: pick('bg', ex.look.bg, d.bg), acc: pick('acc', ex.look.acc, d.acc) };
}

export function canBuyCosmetic(root: RootState, c: Cosmetic): { ok: true } | { ok: false; reason: string } {
  if (hasCosmetic(root.extras, c)) return { ok: false, reason: 'Ya lo tienes' };
  const have = balance(root.xp, root.extras);
  if (have < c.price) return { ok: false, reason: `Te faltan 🪙 ${c.price - have}` };
  return { ok: true };
}

/** Compra un cosmético: descuenta las monedas y lo deja en la colección (sin equiparlo). */
export function buyCosmetic(root: RootState, id: string, kind: CosKind): { root: RootState; ok: boolean; reason?: string } {
  const c = find(kind, id);
  if (!c) return { root, ok: false, reason: 'Ese objeto no existe' };
  const can = canBuyCosmetic(root, c);
  if (!can.ok) return { root, ok: false, reason: can.reason };
  const ex = root.extras;
  return { root: { ...root, extras: { ...ex, coinsSpent: ex.coinsSpent + c.price, bought: { ...ex.bought, [key(c)]: (ex.bought[key(c)] ?? 0) + 1 } } }, ok: true };
}

/** Se pone un cosmético que ya se tiene. */
export function equipCosmetic(root: RootState, id: string, kind: CosKind): { root: RootState; ok: boolean; reason?: string } {
  const c = find(kind, id);
  if (!c) return { root, ok: false, reason: 'Ese objeto no existe' };
  if (!hasCosmetic(root.extras, c)) return { root, ok: false, reason: 'Primero hay que comprarlo' };
  return { root: { ...root, extras: { ...root.extras, look: { ...root.extras.look, [kind]: c.id } } }, ok: true };
}

/** Cuántos de una categoría se tienen y cuántos hay. */
export function collection(ex: Extras, kind: CosKind): { have: number; total: number } {
  const list = cosmeticsOf(kind);
  return { have: list.filter((c) => hasCosmetic(ex, c)).length, total: list.length };
}
