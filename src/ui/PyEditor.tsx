import React, { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View, type TextInputSelectionChangeEvent } from 'react-native';
import { select } from '@/lib/haptics';
import { T } from './Text';
import { darkColors, fonts, radius } from './theme';

const KEYS: { label: string; text?: string; pair?: string; act?: 'dedent' }[] = [
  { label: '⇥', text: '    ' },
  { label: '⇤', act: 'dedent' },
  { label: '( )', text: '()', pair: ')' },
  { label: '[ ]', text: '[]', pair: ']' },
  { label: '{ }', text: '{}', pair: '}' },
  { label: ':', text: ':' },
  { label: '" "', text: '""', pair: '"' },
  { label: "' '", text: "''", pair: "'" },
  { label: '=', text: ' = ' },
  { label: '#', text: '# ' },
  { label: ',', text: ', ' },
  { label: '.', text: '.' },
  { label: '_', text: '_' },
  { label: '+', text: ' + ' },
  { label: '-', text: ' - ' },
  { label: '*', text: '*' },
  { label: '/', text: ' / ' },
  { label: '%', text: ' % ' },
  { label: '<', text: ' < ' },
  { label: '>', text: ' > ' },
  { label: '!', text: '!' },
  { label: '\\', text: '\\' },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
  maxHeight?: number;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Muestra la barra de símbolos sobre el teclado. */
  keys?: boolean;
}

/** Editor de código sencillo y cómodo en el móvil: sangrado automático tras «:», barra de símbolos y pares. */
export function PyEditor({ value, onChange, minHeight = 150, maxHeight, placeholder, readOnly, autoFocus, keys = true }: Props) {
  const sel = useRef({ start: value.length, end: value.length });
  const [forced, setForced] = useState<{ start: number; end: number } | undefined>(undefined);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  const place = useCallback((cursor: number) => {
    sel.current = { start: cursor, end: cursor };
    setForced({ start: cursor, end: cursor });
    // se suelta el control del cursor tras aplicarlo para que el usuario pueda moverlo libremente
    setTimeout(() => setForced(undefined), 30);
  }, []);

  const onSel = (e: TextInputSelectionChangeEvent) => {
    sel.current = e.nativeEvent.selection;
  };

  const insert = (text: string, pair?: string) => {
    const { start, end } = sel.current;
    const chosen = value.slice(start, end);
    // con texto seleccionado, los pares lo envuelven
    const ins = pair && chosen ? text[0] + chosen + pair : text;
    const next = value.slice(0, start) + ins + value.slice(end);
    onChange(next);
    place(pair && !chosen ? start + 1 : start + ins.length);
    input.current?.focus();
  };

  const dedent = () => {
    const { start } = sel.current;
    const ls = value.lastIndexOf('\n', start - 1) + 1;
    const m = /^ {1,4}/.exec(value.slice(ls));
    if (!m) return;
    onChange(value.slice(0, ls) + value.slice(ls + m[0].length));
    place(Math.max(ls, start - m[0].length));
  };

  const handleChange = (text: string) => {
    // sangrado automático: se acaba de insertar un salto de línea
    if (text.length === value.length + 1) {
      let p = 0;
      while (p < value.length && value[p] === text[p]) p++;
      if (text[p] === '\n') {
        const ls = value.lastIndexOf('\n', p - 1) + 1;
        const line = value.slice(ls, p);
        let indent = /^[ \t]*/.exec(line)![0];
        if (/:\s*(#.*)?$/.test(line.trimEnd())) indent += '    ';
        if (indent) {
          onChange(text.slice(0, p + 1) + indent + text.slice(p + 1));
          place(p + 1 + indent.length);
          return;
        }
      }
    }
    onChange(text);
  };

  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: darkColors.line, backgroundColor: darkColors.termBg, overflow: 'hidden' }}>
      <TextInput
        ref={input}
        value={value}
        onChangeText={handleChange}
        onSelectionChange={onSel}
        selection={forced}
        multiline
        editable={!readOnly}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textAlignVertical="top"
        placeholder={placeholder}
        placeholderTextColor={darkColors.faint}
        selectionColor={darkColors.mint}
        scrollEnabled={!!maxHeight}
        onKeyPress={(e) => {
          if (Platform.OS === 'web' && (e.nativeEvent as { key?: string }).key === 'Tab') {
            (e as unknown as { preventDefault?: () => void }).preventDefault?.();
            insert('    ');
          }
        }}
        accessibilityLabel="Editor de código"
        style={{ minHeight, maxHeight, padding: 12, color: darkColors.termText, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21, outlineStyle: 'none' } as object}
      />
      {keys && !readOnly && (
        <View style={{ borderTopWidth: 1, borderTopColor: darkColors.line, backgroundColor: darkColors.bg2 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
            {KEYS.map((k) => (
              <Pressable
                key={k.label}
                onPress={() => {
                  select();
                  if (k.act === 'dedent') dedent();
                  else insert(k.text ?? '', k.pair);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Insertar ${k.label}`}
                style={{ minWidth: 38, height: 34, paddingHorizontal: 10, borderRadius: 8, backgroundColor: darkColors.card2, borderWidth: 1, borderColor: darkColors.line, alignItems: 'center', justifyContent: 'center' }}
              >
                <T style={{ fontFamily: fonts.monoBold, fontSize: 14 }} color={darkColors.termText}>{k.label}</T>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
