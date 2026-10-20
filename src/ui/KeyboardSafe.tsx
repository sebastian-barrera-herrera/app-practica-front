import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Altura (dp) del teclado según los eventos de React Native. En Android con la pantalla «de borde a borde» es la del
 * teclado SIN la barra de navegación; en iOS es la total.
 */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

/**
 * Sube el contenido para que el teclado no lo tape (y se vea lo que se escribe y las teclas especiales).
 *
 * Con la pantalla de borde a borde de Android el sistema ya no encoge la ventana al abrir el teclado, así que el
 * contenido quedaba debajo. Aquí se mide cuánto de este bloque queda realmente cubierto y se añade ese relleno por abajo.
 * Si el sistema SÍ encogió la ventana (Android antiguo), no queda nada cubierto y no se añade nada. Se puede anidar.
 */
export function KeyboardSafe({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const kb = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [overlap, setOverlap] = useState(0);
  const total = kb > 0 ? (Platform.OS === 'ios' ? kb : kb + insets.bottom) : 0;

  const measure = useCallback(() => {
    if (total <= 0) {
      setOverlap(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _w, h) => {
      const screenH = Dimensions.get('screen').height;
      const covered = Math.round(y + h - (screenH - total));
      setOverlap(Math.min(Math.max(0, covered), Math.round(screenH * 0.6)));
    });
  }, [total]);

  useEffect(() => {
    measure();
    // el teclado anuncia su altura antes de que el diseño termine de moverse: se vuelve a medir un instante después
    const t = setTimeout(measure, 80);
    return () => clearTimeout(t);
  }, [measure]);

  return (
    <View ref={ref} onLayout={measure} collapsable={false} style={[{ flex: 1, paddingBottom: overlap }, style]}>
      {children}
    </View>
  );
}
