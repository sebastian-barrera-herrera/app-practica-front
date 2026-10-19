import { Platform, StyleSheet } from 'react-native';

export interface Palette {
  bg: string;
  bg2: string;
  card: string;
  card2: string;
  line: string;
  text: string;
  dim: string;
  faint: string;
  mint: string;
  mintDark: string;
  mintSoft: string;
  cyan: string;
  amber: string;
  rose: string;
  violet: string;
  orange: string;
  green: string;
  red: string;
  /** Fondos de aviso: acierto / fallo. */
  okBg: string;
  badBg: string;
  /** Fondo y texto de terminales/editores: siempre oscuros, también en el tema claro. */
  termBg: string;
  termText: string;
  white: string;
  black: string;
}

export type ThemeName = 'dark' | 'light';

export const darkColors: Palette = {
  bg: '#0B1020',
  bg2: '#0F1630',
  card: '#151D3B',
  card2: '#1B2547',
  line: '#26325E',
  text: '#EAF0FF',
  dim: '#9FB0DD',
  faint: '#6B7AA8',
  mint: '#22D3A6',
  mintDark: '#0E8F70',
  mintSoft: 'rgba(34,211,166,0.14)',
  cyan: '#38BDF8',
  amber: '#FBBF24',
  rose: '#FB7185',
  violet: '#A78BFA',
  orange: '#FB923C',
  green: '#4ADE80',
  red: '#F87171',
  okBg: '#0F3B2C',
  badBg: '#43202A',
  termBg: '#070B16',
  termText: '#D6E2FF',
  white: '#FFFFFF',
  black: '#000000',
};

export const lightColors: Palette = {
  bg: '#F2F5FD',
  bg2: '#FFFFFF',
  card: '#FFFFFF',
  card2: '#E8EEFC',
  line: '#D0D9F0',
  text: '#0E1836',
  dim: '#46557F',
  faint: '#6F7DA6',
  mint: '#0E9F78',
  mintDark: '#0A765A',
  mintSoft: 'rgba(14,159,120,0.12)',
  cyan: '#0B86C4',
  amber: '#B97700',
  rose: '#DB2F57',
  violet: '#6D4FD8',
  orange: '#D45B0C',
  green: '#178F4A',
  red: '#D13434',
  okBg: '#DDF5E8',
  badBg: '#FBE3E7',
  termBg: '#070B16',
  termText: '#D6E2FF',
  white: '#FFFFFF',
  black: '#000000',
};

/**
 * Paleta ACTIVA. Es un objeto mutable: `applyTheme` copia sobre él la paleta elegida y la raíz de la app
 * se vuelve a montar al cambiar de tema. Por eso nunca debe leerse `colors.x` a nivel de módulo
 * (usa `makeStyles` o getters para las constantes).
 */
export const colors: Palette = { ...darkColors };

let current: ThemeName = 'dark';
let version = 0;

export const themeName = (): ThemeName => current;
export const themeVersion = () => version;

export function applyTheme(name: ThemeName) {
  if (name === current && version > 0) return;
  current = name;
  Object.assign(colors, name === 'light' ? lightColors : darkColors);
  Object.assign(shadow, shadowFor(name));
  version++;
}

/**
 * Color legible como TEXTO sobre el fondo del tema activo. Los colores de contenido (zonas, niveles) son pasteles
 * pensados para el tema oscuro; en el claro se oscurecen manteniendo el tono.
 */
export function ink(hex: string): string {
  if (current !== 'light' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const k = 0.62;
  const ch = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** `StyleSheet.create` que se vuelve a calcular cuando cambia el tema. */
type Styles = Parameters<typeof StyleSheet.create>[0];
export function makeStyles<S extends Styles>(factory: () => S & Styles): Readonly<S> {
  let cache: Readonly<S> | null = null;
  let ver = -1;
  return new Proxy({} as Readonly<S>, {
    get(_t, key) {
      if (cache === null || ver !== version) {
        cache = StyleSheet.create(factory());
        ver = version;
      }
      return (cache as any)[key];
    },
  });
}

export const fonts = {
  regular: 'Nunito_400Regular',
  semi: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  black: 'Nunito_800ExtraBold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
};

export const monoFallback = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

function shadowFor(name: ThemeName): object {
  const o = name === 'light' ? 0.14 : 0.35;
  return Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: o, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 6 },
    default: { boxShadow: `0 6px 16px rgba(0,0,0,${o})` } as object,
  }) as object;
}

/** Sombra activa (objeto mutable, se actualiza con el tema). */
export const shadow: object = { ...shadowFor('dark') };

/** Paleta ANSI para la terminal (tema oscuro). */
export const ansi: Record<string, string> = {
  black: '#4C566A',
  red: '#FF7B8A',
  green: '#7EE787',
  yellow: '#F5D36B',
  blue: '#6CB6FF',
  magenta: '#E39BFF',
  cyan: '#5EEAD4',
  white: '#D6E2FF',
  brightBlack: '#6B7AA8',
  brightRed: '#FF9AA5',
  brightGreen: '#A6F3AE',
  brightYellow: '#FFE48F',
  brightBlue: '#8FC8FF',
  brightMagenta: '#F0BCFF',
  brightCyan: '#8FF3E4',
  brightWhite: '#FFFFFF',
};

export function ansi256(n: number): string {
  if (n < 16) {
    const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
    return ansi[names[n]];
  }
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const r = Math.floor(i / 36), g = Math.floor((i % 36) / 6), b = i % 6;
  const f = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
