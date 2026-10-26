import { Platform, Share } from 'react-native';

/**
 * Copia un texto.
 * - Web: al portapapeles.
 * - Móvil: abre la hoja de compartir del sistema, que ofrece «Copiar» (React Native no trae portapapeles propio y un módulo nativo exigiría otro APK).
 * Devuelve `copied` si ya está en el portapapeles, `shared` si se abrió la hoja del sistema y `failed` si no se pudo.
 */
export async function copyText(text: string): Promise<'copied' | 'shared' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        return ok ? 'copied' : 'failed';
      } catch {
        return 'failed';
      }
    }
  }
  try {
    await Share.share({ message: text });
    return 'shared';
  } catch {
    return 'failed';
  }
}
