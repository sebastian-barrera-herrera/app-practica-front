import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import type { OutChunk } from '@/lib/pyrun';
import { T } from './Text';
import { darkColors, fonts, radius } from './theme';

interface Props {
  chunks: OutChunk[];
  running?: boolean;
  /** Hay un input() esperando respuesta. */
  asking?: boolean;
  onSubmitInput?: (line: string) => void;
  onStop?: () => void;
  emptyText?: string;
  maxHeight?: number;
  title?: string;
}

/** Panel de salida de un programa de Python (stdout en claro, errores en rojo) con entrada para input(). */
export function PyOutput({ chunks, running, asking, onSubmitInput, onStop, emptyText = 'Aquí verás la salida de tu programa.', maxHeight = 240, title = 'Salida' }: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const [line, setLine] = useState('');
  // une trozos consecutivos del mismo tipo
  const merged = useMemo(() => {
    const out: OutChunk[] = [];
    for (const c of chunks) {
      const last = out[out.length - 1];
      if (last && last.err === c.err && last.kind === c.kind) last.text += c.text;
      else out.push({ ...c });
    }
    return out;
  }, [chunks]);

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 30);
    return () => clearTimeout(t);
  }, [chunks, asking]);

  const submit = () => {
    onSubmitInput?.(line);
    setLine('');
  };

  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: darkColors.line, backgroundColor: darkColors.termBg, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: darkColors.bg2, borderBottomWidth: 1, borderBottomColor: darkColors.line }}>
        <T v="label" color={darkColors.dim} style={{ flex: 1 }}>{title}</T>
        {running ? <ActivityIndicator size="small" color={darkColors.mint} /> : null}
        {running && onStop ? (
          <Pressable onPress={onStop} hitSlop={8} accessibilityLabel="Detener" style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: darkColors.rose + '33' }}>
            <T v="tiny" bold color={darkColors.rose}>■ Detener</T>
          </Pressable>
        ) : null}
      </View>
      <ScrollView ref={scroll} style={{ maxHeight }} contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
        {merged.length === 0 ? (
          <T v="small" color={darkColors.faint}>{running ? 'Ejecutando…' : emptyText}</T>
        ) : (
          <T selectable style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 }} color={darkColors.termText}>
            {merged.map((c, i) => (
              <T key={i} selectable style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 }} color={c.err ? '#FF9AA5' : c.kind === 'echo' ? darkColors.mint : darkColors.termText}>{c.text}</T>
            ))}
          </T>
        )}
      </ScrollView>
      {asking && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: darkColors.line, backgroundColor: '#0A1022' }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={darkColors.amber}>⌨</T>
          <TextInput
            value={line}
            onChangeText={setLine}
            onSubmitEditing={submit}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Escribe tu respuesta y pulsa Enter"
            placeholderTextColor={darkColors.faint}
            returnKeyType="send"
            accessibilityLabel="Respuesta para input()"
            style={{ flex: 1, color: darkColors.white, fontFamily: fonts.mono, fontSize: 14, paddingVertical: 6, outlineStyle: 'none' } as object}
          />
          <Pressable onPress={submit} accessibilityLabel="Enviar" style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: darkColors.mint }}>
            <T bold color="#04120D">↵</T>
          </Pressable>
        </View>
      )}
    </View>
  );
}
