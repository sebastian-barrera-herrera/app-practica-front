import { Platform } from 'react-native';
import { NATIVE_ORIGIN } from './config';

export class CloudError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

/** Mensajes en español para los códigos de error de Neon Auth. */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Correo o contraseña incorrectos.',
  INVALID_PASSWORD: 'La contraseña no es correcta.',
  USER_NOT_FOUND: 'No encontramos una cuenta con ese correo.',
  USER_ALREADY_EXISTS: 'Ya existe una cuenta con ese correo. Prueba a iniciar sesión.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe una cuenta con ese correo. Prueba a iniciar sesión.',
  PASSWORD_TOO_SHORT: 'La contraseña es demasiado corta (mínimo 8 caracteres).',
  PASSWORD_TOO_LONG: 'La contraseña es demasiado larga (máximo 128 caracteres).',
  INVALID_EMAIL: 'Ese correo no parece válido.',
  INVALID_OTP: 'El código no es correcto.',
  OTP_EXPIRED: 'El código caducó. Pide uno nuevo.',
  TOO_MANY_ATTEMPTS: 'Demasiados intentos. Espera un momento y vuelve a probar.',
  EMAIL_NOT_VERIFIED: 'Verifica tu correo para continuar.',
  FAILED_TO_CREATE_USER: 'No pudimos crear la cuenta. Inténtalo de nuevo.',
  SESSION_EXPIRED: 'Tu sesión caducó. Vuelve a iniciar sesión.',
  RATE_LIMITED: 'Demasiadas solicitudes. Espera un momento.',
};

export const OFFLINE = new CloudError('OFFLINE', 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');

export function explain(code: string | undefined, fallback?: string, status = 0): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (status === 429) return MESSAGES.RATE_LIMITED;
  return fallback ?? 'Algo salió mal. Inténtalo de nuevo.';
}

/** fetch con tiempo máximo y errores normalizados. */
export async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15000, headers, ...rest } = init;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      ...rest,
      signal: ctrl?.signal,
      headers: { ...(Platform.OS === 'web' ? {} : { Origin: NATIVE_ORIGIN }), ...(headers as Record<string, string> | undefined) },
    });
  } catch {
    throw OFFLINE;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readJson<T = any>(res: Response): Promise<T | null> {
  try {
    const t = await res.text();
    return t ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}
