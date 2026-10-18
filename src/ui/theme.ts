import { Platform } from 'react-native';

export const colors = {
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
  termBg: '#070B16',
  termText: '#D6E2FF',
  white: '#FFFFFF',
  black: '#000000',
};

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

export const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 6 },
  default: { boxShadow: '0 6px 16px rgba(0,0,0,0.35)' } as object,
}) as object;

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
