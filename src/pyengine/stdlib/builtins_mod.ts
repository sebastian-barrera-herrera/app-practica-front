import type { Interp } from '../runtime/interp';
import type { PyModule } from '../runtime/objects';
import { registerNative } from './registry';

/** El módulo `builtins` comparte el diccionario de builtins de la sesión. */
registerNative('builtins', (I: Interp, m: PyModule) => {
  m.dict = I.builtins;
});
