import { REGISTRY, type Category, type CommandDef } from '@/engine';
import { colors } from '@/ui/theme';

export const CATEGORY_LABEL: Record<Category, string> = {
  navegacion: '🧭 Navegación',
  archivos: '📁 Archivos',
  texto: '📝 Texto',
  busqueda: '🔎 Búsqueda',
  permisos: '🔐 Permisos',
  usuarios: '👥 Usuarios',
  procesos: '⚙️ Procesos',
  sistema: '🖥️ Sistema',
  redes: '🌐 Redes',
  paquetes: '📦 Paquetes',
  compresion: '🗜️ Compresión',
  scripting: '📜 Scripting',
  ayuda: '❓ Ayuda',
};

export const LEVEL_LABEL = ['', 'Básico', 'Intermedio', 'Avanzado', 'Experto'];
export const LEVEL_COLOR = ['', colors.mint, colors.cyan, colors.violet, colors.rose];

/** Un comando por entrada (los alias comparten implementación). */
export function libraryEntries(): { def: CommandDef; aliases: string[] }[] {
  const byRun = new Map<unknown, { def: CommandDef; aliases: string[] }>();
  for (const def of REGISTRY.values()) {
    const e = byRun.get(def.run);
    if (e) e.aliases.push(def.name);
    else byRun.set(def.run, { def, aliases: [] });
  }
  return [...byRun.values()].sort((a, b) => a.def.name.localeCompare(b.def.name));
}
