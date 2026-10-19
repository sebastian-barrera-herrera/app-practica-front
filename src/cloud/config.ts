/**
 * Endpoints públicos de la nube (Neon Auth + Data API). No son secretos: el acceso lo protegen la autenticación
 * y las políticas RLS de la base de datos (cada usuario solo ve sus filas). Se pueden sobrescribir con variables
 * EXPO_PUBLIC_* para apuntar a otro proyecto de Neon.
 */
export const AUTH_URL =
  process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://ep-autumn-dust-b704y8sh.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://ep-autumn-dust-b704y8sh.apirest.c-13.us-east-1.aws.neon.tech/neondb/rest/v1';

/** Origen que se envía desde la app nativa (localhost está siempre permitido en Neon Auth). */
export const NATIVE_ORIGIN = 'http://localhost';

export const MIN_PASSWORD = 8;
