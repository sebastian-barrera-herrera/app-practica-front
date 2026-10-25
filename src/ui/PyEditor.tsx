import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type TextInputSelectionChangeEvent } from 'react-native';
import { select } from '@/lib/haptics';
import { LANGS } from './editorLang';
import type { Completion } from './pycomplete';
import type { SqlSchema } from './sqlcomplete';
import { T } from './Text';
import { darkColors, fonts, radius } from './theme';

// Medidas del texto. El código se dibuja dos veces con EXACTAMENTE la misma tipografía y relleno: el campo de texto
// (con letra transparente, para escribir) y, debajo, el texto coloreado. Por eso no hay ajuste de línea: cada línea
// del código es una sola línea en pantalla y los números de línea cuadran siempre. Las líneas largas se desplazan en horizontal.
const FS = 14;
const LH = 21;
const PAD = 12;
/** Ancho de un carácter de JetBrains Mono: 600/1000 de em. */
const CHAR = FS * 0.6;
const TEXT = { fontFamily: fonts.mono, fontSize: FS, lineHeight: LH, includeFontPadding: false } as const;
const NUM_COLOR = '#6E7681';
const NUM_ACTIVE = '#C6C6C6';

interface Props {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
  maxHeight?: number;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Muestra las barras de atajos, sugerencias y símbolos sobre el teclado. */
  keys?: boolean;
  /** Números de línea (por defecto, sí). */
  lineNumbers?: boolean;
  /** Lenguaje del editor (por defecto, Python). */
  lang?: 'py' | 'sql';
  /** Tablas y columnas para autocompletar (solo SQL). */
  schema?: SqlSchema;
}

/** Editor de código del móvil: números de línea, colores como en VS Code, autocompletado, atajos, sangrado automático y pares. */
export function PyEditor({ value, onChange, minHeight = 150, maxHeight, placeholder, readOnly, autoFocus, keys = true, lineNumbers = true, lang = 'py', schema }: Props) {
  const L = LANGS[lang];
  const sel = useRef({ start: value.length, end: value.length });
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const [forced, setForced] = useState<{ start: number; end: number } | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const [viewW, setViewW] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback((cursor: number) => {
    const s = { start: cursor, end: cursor };
    sel.current = s;
    setSelection(s);
    setForced(s);
    // se suelta el control del cursor tras aplicarlo para que el usuario pueda moverlo libremente
    setTimeout(() => setForced(undefined), 30);
  }, []);

  const onSel = (e: TextInputSelectionChangeEvent) => {
    sel.current = e.nativeEvent.selection;
    setSelection(e.nativeEvent.selection);
  };

  // ───── lo que se dibuja ─────
  const lines = useMemo(() => L.highlight(value), [value, L]);
  const longest = useMemo(() => value.split('\n').reduce((m, l) => Math.max(m, l.length), 0), [value]);
  const contentW = Math.max(viewW, Math.ceil((longest + 3) * CHAR) + PAD * 2);
  const cursor = Math.min(selection.start, value.length);
  const cursorLine = value.slice(0, cursor).split('\n').length - 1;
  const gutterW = Math.max(2, String(lines.length).length) * CHAR + 18;

  // ───── autocompletado ─────
  const sugg = useMemo(() => (focused && !readOnly && selection.start === selection.end ? L.suggest(value, cursor, schema) : null), [focused, readOnly, value, cursor, selection.start, selection.end, L, schema]);
  const items = sugg?.items ?? [];

  const replace = (start: number, end: number, text: string, caret: number) => {
    onChange(value.slice(0, start) + text + value.slice(end));
    place(start + caret);
    input.current?.focus();
  };

  const accept = (c: Completion) => {
    select();
    const { start: s, end: e } = sel.current;
    // las sugerencias sustituyen a la palabra que se está escribiendo; los atajos, a lo seleccionado (o se insertan)
    const from = c.kind === 'snippet' ? s : sugg?.start ?? s;
    const ls = value.lastIndexOf('\n', from - 1) + 1;
    const indent = /^[ \t]*/.exec(value.slice(ls))![0];
    // los atajos de varias líneas heredan el sangrado de la línea donde se insertan
    const text = c.insert.replace(/\n/g, '\n' + indent);
    // el cursor se desplaza el sangrado añadido en cada salto de línea que queda antes de él
    const caret = c.caret ?? c.insert.length;
    const breaks = c.insert.slice(0, caret).split('\n').length - 1;
    replace(from, Math.max(e, from), text, caret + indent.length * breaks);
  };

  // ───── teclas y pares ─────
  const insert = (text: string, pair?: string) => {
    const { start, end } = sel.current;
    const chosen = value.slice(start, end);
    // con texto seleccionado, los pares lo envuelven
    const ins = pair && chosen ? text[0] + chosen + pair : text;
    onChange(value.slice(0, start) + ins + value.slice(end));
    place(pair && !chosen ? start + 1 : start + ins.length);
    input.current?.focus();
  };

  const tab = () => {
    // con una sugerencia a la vista, «⇥» la acepta; si no, sangra
    if (items.length) accept(items[0]);
    else insert('    ');
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
        if (L.indentAfter(line)) indent += '    ';
        if (indent) {
          onChange(text.slice(0, p + 1) + indent + text.slice(p + 1));
          place(p + 1 + indent.length);
          return;
        }
      }
    }
    onChange(text);
  };

  const onLayout = (e: LayoutChangeEvent) => setViewW(Math.floor(e.nativeEvent.layout.width));

  const body = (
    <View style={{ flexDirection: 'row' }}>
      {lineNumbers && (
        <View style={{ width: gutterW, paddingTop: PAD, paddingBottom: PAD, paddingRight: 8, backgroundColor: darkColors.bg2, borderRightWidth: 1, borderRightColor: darkColors.line, alignItems: 'flex-end' }}>
          {lines.map((_, i) => (
            <Text key={i} allowFontScaling={false} style={[TEXT, { color: focused && i === cursorLine ? NUM_ACTIVE : NUM_COLOR }]}>
              {i + 1}
            </Text>
          ))}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={{ flex: 1, minWidth: 0 }} onLayout={onLayout}>
        <View style={{ width: contentW, minHeight }}>
          {focused && !readOnly && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: PAD + cursorLine * LH, height: LH, backgroundColor: 'rgba(255,255,255,0.045)' }} />}
          <TextInput
            ref={input}
            value={value}
            onChangeText={handleChange}
            onSelectionChange={onSel}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setFocused(true);
            }}
            // un instante de gracia: al tocar un botón de sugerencias el campo puede perder el foco un momento
            onBlur={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              blurTimer.current = setTimeout(() => setFocused(false), 250);
            }}
            selection={forced}
            multiline
            editable={!readOnly}
            autoFocus={autoFocus}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            allowFontScaling={false}
            textAlignVertical="top"
            scrollEnabled={false}
            placeholder={placeholder ?? L.placeholder}
            placeholderTextColor={darkColors.faint}
            selectionColor={darkColors.mint}
            cursorColor={darkColors.mint}
            onKeyPress={(e) => {
              if (Platform.OS === 'web' && (e.nativeEvent as { key?: string }).key === 'Tab') {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                tab();
              }
            }}
            accessibilityLabel={lang === 'sql' ? 'Editor de SQL' : 'Editor de código'}
            style={[
              TEXT,
              // «transparent» no vale en Android: lo toma como «sin color» y pinta la letra en negro; un alfa mínimo sí se respeta
              { color: 'rgba(0,0,0,0.004)', padding: PAD, margin: 0, width: contentW, minHeight },
              (Platform.OS === 'web' ? { outlineStyle: 'none', caretColor: darkColors.mint, resize: 'none', overflow: 'hidden' } : null) as object,
            ]}
          />
          {/* el texto coloreado va ENCIMA del campo (que no recibe toques): si el sistema pintara la letra del campo, quedaría tapada */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Text allowFontScaling={false} style={[TEXT, { position: 'absolute', left: PAD, top: PAD, width: contentW - PAD * 2, color: L.base }]}>
              {lines.map((line, i) => (
                <React.Fragment key={i}>
                  {line.map((t, j) => (
                    <Text key={j} style={{ color: L.color(t) }}>{t.s}</Text>
                  ))}
                  {i < lines.length - 1 ? '\n' : ' '}
                </React.Fragment>
              ))}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );

  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: darkColors.line, backgroundColor: darkColors.termBg, overflow: 'hidden' }}>
      {maxHeight ? (
        <ScrollView style={{ maxHeight }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        body
      )}
      {keys && !readOnly && (
        <View style={{ borderTopWidth: 1, borderTopColor: darkColors.line, backgroundColor: darkColors.bg2 }}>
          {/* sugerencias de lo que estás escribiendo o, si no hay, atajos (print(), input(), for…) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 6, gap: 6, alignItems: 'center' }}>
            {(items.length ? items : L.snippets).map((c) => (
              <Pressable
                key={`${c.kind}-${c.label}`}
                onPress={() => accept(c)}
                accessibilityRole="button"
                accessibilityLabel={items.length ? `Autocompletar ${c.label}` : `Insertar ${c.label}`}
                style={{ height: 34, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, backgroundColor: c.kind === 'snippet' && c.label === L.primary ? darkColors.mint + '22' : darkColors.card2, borderWidth: 1, borderColor: c.kind === 'snippet' && c.label === L.primary ? darkColors.mint : items.length ? L.candColor(c) + '88' : darkColors.line }}
              >
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={L.candColor(c)}>{items.length && (c.kind === 'fn' || c.kind === 'bi' || c.kind === 'method') ? `${c.label}()` : c.label}</T>
                {!items.length && c.hint ? <T style={{ fontSize: 11 }} color={darkColors.faint}>{c.hint}</T> : null}
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
            {L.keys.map((k) => (
              <Pressable
                key={k.label}
                onPress={() => {
                  select();
                  if (k.act === 'dedent') dedent();
                  else if (k.act === 'tab') tab();
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
