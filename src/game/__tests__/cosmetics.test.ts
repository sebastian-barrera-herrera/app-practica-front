import { mergeRoots } from '@/cloud/merge';
import { addCoins, balance, defaultLook, mergeExtras } from '../economy';
import { buyCosmetic, canBuyCosmetic, collection, COSMETICS, cosmeticById, cosmeticsOf, equipCosmetic, hasCosmetic, resolveLook, type CosKind } from '../cosmetics';
import { initialRoot, type RootState } from '../root';

const rich = (n: number): RootState => {
  const r = initialRoot();
  return { ...r, extras: addCoins(r.extras, n) };
};
const KINDS: CosKind[] = ['avatar', 'frame', 'bg', 'acc'];

describe('catálogo de personalización', () => {
  test('ids únicos por categoría y siempre hay uno de serie gratis', () => {
    for (const k of KINDS) {
      const list = cosmeticsOf(k);
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
      expect(list.some((c) => c.price === 0)).toBe(true);
      expect(cosmeticById(k, defaultLook()[k])?.price).toBe(0);
    }
  });

  test('hay variedad real y los precios suben con la rareza', () => {
    expect(cosmeticsOf('avatar').length).toBeGreaterThanOrEqual(15);
    expect(cosmeticsOf('frame').length).toBeGreaterThanOrEqual(6);
    expect(cosmeticsOf('bg').length).toBeGreaterThanOrEqual(6);
    expect(cosmeticsOf('acc').length).toBeGreaterThanOrEqual(8);
    const price = (r: string) => COSMETICS.filter((c) => c.rarity === r && c.price > 0).map((c) => c.price);
    expect(Math.max(...price('comun'))).toBeLessThan(Math.min(...price('epico')));
    expect(Math.max(...price('raro'))).toBeLessThanOrEqual(Math.min(...price('legendario')));
    expect(Math.max(...price('legendario'))).toBeGreaterThanOrEqual(900);
  });

  test('marcos y fondos llevan colores y los accesorios una posición', () => {
    for (const c of COSMETICS) {
      if (c.kind === 'bg' || (c.kind === 'frame' && c.id !== 'none')) expect((c.colors ?? []).length).toBeGreaterThanOrEqual(2);
      if (c.kind === 'acc') expect(['top', 'eyes', 'corner']).toContain(c.place);
      expect(c.name.length).toBeGreaterThan(1);
      expect(c.desc.length).toBeGreaterThan(5);
    }
  });
});

describe('comprar y ponerse cosas', () => {
  test('sin monedas no se puede, y dice cuántas faltan', () => {
    const c = cosmeticById('avatar', 'gato')!;
    const can = canBuyCosmetic(initialRoot(), c);
    expect(can).toEqual({ ok: false, reason: 'Te faltan 🪙 60' });
    const r = buyCosmetic(initialRoot(), 'gato', 'avatar');
    expect(r.ok).toBe(false);
    expect(hasCosmetic(r.root.extras, c)).toBe(false);
  });

  test('comprar descuenta las monedas y deja el objeto en la colección sin ponerlo', () => {
    const r = buyCosmetic(rich(100), 'gato', 'avatar');
    expect(r.ok).toBe(true);
    expect(balance(r.root.xp, r.root.extras)).toBe(40);
    expect(hasCosmetic(r.root.extras, cosmeticById('avatar', 'gato')!)).toBe(true);
    expect(r.root.extras.look.avatar).toBe('penguin');
    expect(collection(r.root.extras, 'avatar').have).toBe(2);
  });

  test('no se compra dos veces ni se paga de más', () => {
    const a = buyCosmetic(rich(500), 'gato', 'avatar').root;
    const b = buyCosmetic(a, 'gato', 'avatar');
    expect(b.ok).toBe(false);
    expect(b.reason).toBe('Ya lo tienes');
    expect(balance(b.root.xp, b.root.extras)).toBe(440);
  });

  test('un mismo id en categorías distintas no se confunde', () => {
    const r = buyCosmetic(rich(500), 'oro', 'frame').root;
    expect(hasCosmetic(r.extras, cosmeticById('frame', 'oro')!)).toBe(true);
    // «none» existe en marco, fondo y accesorio y es gratis en los tres
    for (const k of ['frame', 'bg', 'acc'] as const) expect(hasCosmetic(r.extras, cosmeticById(k, 'none')!)).toBe(true);
  });

  test('solo se pone lo que se tiene', () => {
    expect(equipCosmetic(initialRoot(), 'dragon', 'avatar').ok).toBe(false);
    const bought = buyCosmetic(rich(700), 'dragon', 'avatar').root;
    const eq = equipCosmetic(bought, 'dragon', 'avatar');
    expect(eq.ok).toBe(true);
    expect(resolveLook(eq.root.extras).avatar).toBe('dragon');
    // volver al de serie siempre se puede
    expect(equipCosmetic(eq.root, 'penguin', 'avatar').root.extras.look.avatar).toBe('penguin');
    expect(equipCosmetic(eq.root, 'inventado', 'avatar').ok).toBe(false);
  });

  test('un aspecto con algo que no se tiene o no existe vuelve a lo de serie al dibujarse', () => {
    const r = initialRoot();
    const ex = { ...r.extras, look: { avatar: 'leon', frame: 'oro', bg: 'nada', acc: 'corona' } };
    expect(resolveLook(ex)).toEqual(defaultLook());
  });
});

describe('sincronización', () => {
  test('lo comprado se une entre dispositivos y lo puesto lo decide la copia más reciente', () => {
    const base = initialRoot();
    const a: RootState = { ...buyCosmetic(rich(300), 'gato', 'avatar').root, updatedAt: 100 };
    const b0 = buyCosmetic(rich(300), 'oro', 'frame').root;
    const b: RootState = { ...equipCosmetic(b0, 'oro', 'frame').root, updatedAt: 200 };
    const m = mergeRoots(a, b);
    expect(hasCosmetic(m.extras, cosmeticById('avatar', 'gato')!)).toBe(true);
    expect(hasCosmetic(m.extras, cosmeticById('frame', 'oro')!)).toBe(true);
    expect(m.extras.look).toEqual(b.extras.look);
    expect(base.extras.look).toEqual(defaultLook());
  });

  test('un guardado antiguo sin aspecto se completa y uno corrupto se sanea', () => {
    expect(mergeExtras({}).look).toEqual(defaultLook());
    expect(mergeExtras({ look: { avatar: '', frame: 5 as unknown as string, bg: 'x'.repeat(100), acc: 'gorra' } }).look).toEqual({ ...defaultLook(), acc: 'gorra' });
  });
});
