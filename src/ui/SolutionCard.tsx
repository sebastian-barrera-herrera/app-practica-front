import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { copyText } from '@/lib/clipboard';
import { tap } from '@/lib/haptics';
import { T } from './Text';
import { colors, makeStyles } from './theme';

interface Props {
  /** Lo que se copia (el texto plano de la solución). */
  text: string;
  /** La solución dibujada. */
  children: React.ReactNode;
  /** Pega la solución en el editor (o la deja en la línea de la terminal). Si falta, solo hay «Copiar». */
  onUse?: () => void;
  useLabel?: string;
  /** Lo que se lee tras pulsar el botón de usar (mientras dura el aviso). */
  usedLabel?: string;
}

/** Solución de un reto con sus acciones: usarla directamente en el editor o copiarla. */
export function SolutionCard({ text, children, onUse, useLabel = '📥 Pasar al editor', usedLabel = '✓ Ya está en el editor' }: Props) {
  const [flash, setFlash] = useState<null | 'use' | 'copy'>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = (k: 'use' | 'copy') => {
    setFlash(k);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 2200);
  };
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <T v="label" color={colors.violet} style={{ flex: 1 }}>Solución</T>
        {onUse ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Pasar la solución al editor" style={[styles.pill, flash === 'use' && styles.pillOn]} onPress={() => { tap(); onUse(); show('use'); }}>
            <T v="tiny" bold color={flash === 'use' ? colors.green : colors.violet}>{flash === 'use' ? usedLabel : useLabel}</T>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copiar la solución"
          style={[styles.pill, flash === 'copy' && styles.pillOn]}
          onPress={async () => {
            tap();
            const r = await copyText(text);
            if (r === 'copied') show('copy');
          }}
        >
          <T v="tiny" bold color={flash === 'copy' ? colors.green : colors.violet}>{flash === 'copy' ? '✓ Copiada' : '📋 Copiar'}</T>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = makeStyles(() => ({
  pill: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line },
  pillOn: { borderColor: colors.green },
}));
