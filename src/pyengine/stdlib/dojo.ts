/**
 * `_dojo`: puente entre los módulos de Python del curso de IA (matplotlib, etc.) y la interfaz.
 * `_dojo.figure(json)` entrega una figura a la app, que la dibuja bajo la salida del programa.
 */
import { registerNative } from './registry';
import { mfn } from './helpers';
import { asStr } from '../runtime/util';

registerNative('_dojo', (I, m) => {
  mfn(m, 'figure', 'spec, /', (spec: any) => {
    I.emitFigure(asStr(spec));
    return null;
  });
});
