/** Normaliza lo que cambia entre ejecuciones (tiempos, direcciones de memoria). */
export const norm = (t: string): string => t.replace(/(Ran \d+ tests? in )[\d.]+s/g, '$1Xs').replace(/ at 0x[0-9a-f]+>/g, ' at 0xADDR>').replace(/0x[0-9a-f]{8,}/g, '0xADDR');
