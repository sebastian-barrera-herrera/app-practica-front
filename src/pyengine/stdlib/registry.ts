/**
 * Registro (estático) de módulos de la biblioteca estándar: nativos (TS), escritos en Python y no soportados.
 */
import type { Interp } from '../runtime/interp';
import type { PyModule } from '../runtime/objects';

export type NativeInit = (I: Interp, m: PyModule) => void;

export const NATIVE: Record<string, NativeInit> = {};
export const PYSRC: Record<string, () => string> = {};
export const UNSUPPORTED: Record<string, string> = {
  subprocess: 'no se pueden lanzar procesos',
  socket: 'no hay acceso a la red',
  urllib: 'no hay acceso a la red',
  'urllib.request': 'no hay acceso a la red',
  'urllib.parse': '',
  http: 'no hay acceso a la red',
  'http.client': 'no hay acceso a la red',
  'http.server': 'no hay acceso a la red',
  sqlite3: 'no hay bases de datos nativas',
  ctypes: 'no hay código nativo',
  multiprocessing: 'no se pueden crear procesos',
  ssl: 'no hay acceso a la red',
  smtplib: 'no hay acceso a la red',
  ftplib: 'no hay acceso a la red',
  telnetlib: 'no hay acceso a la red',
  asyncio_subprocess: 'no se pueden lanzar procesos',
  tkinter: 'no hay interfaz gráfica',
  turtle: 'no hay interfaz gráfica',
  webbrowser: 'no hay navegador',
  pickle: 'no soportado',
  shelve: 'no soportado',
  zipfile: 'no soportado',
  tarfile: 'no soportado',
  gzip: 'no soportado',
  signal: 'no soportado',
  select: 'no soportado',
  mmap: 'no soportado',
  curses: 'no soportado',
};

export function registerNative(name: string, init: NativeInit): void {
  NATIVE[name] = init;
}
export function registerPy(name: string, src: () => string): void {
  PYSRC[name] = src;
}
