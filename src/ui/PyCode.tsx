import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { T } from './Text';
import { highlightPython, highlightRepl, isReplTranscript, type TokKind } from './pyhighlight';
import { darkColors, fonts, radius } from './theme';

/** Colores del resaltado (la caja de código es oscura en los dos temas). */
const COLOR: Record<TokKind, string> = {
  kw: '#C792EA',
  str: '#C3E88D',
  num: '#F78C6C',
  com: '#6B7AA8',
  fn: '#82AAFF',
  cls: '#FFCB6B',
  dec: '#FF9AA5',
  bi: '#5EEAD4',
  op: '#89DDFF',
  prompt: '#22D3A6',
  out: '#A6B6E0',
  text: darkColors.termText,
};

/** Código de Python con resaltado. Reconoce transcripciones de REPL («>>> »). */
export function PyCode({ code, size = 13, flush }: { code: string; size?: number; /** sin caja (dentro de otra) */ flush?: boolean }) {
  const lines = useMemo(() => {
    const src = code.replace(/\n$/, '');
    return isReplTranscript(src) ? highlightRepl(src) : highlightPython(src);
  }, [code]);
  const body = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {lines.map((line, i) => (
          <T key={i} style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size * 1.55 }} color={darkColors.termText}>
            {line.length ? line.map((t, j) => (
              <T key={j} style={{ fontFamily: t.k === 'kw' || t.k === 'prompt' ? fonts.monoBold : fonts.mono, fontSize: size, fontStyle: t.k === 'com' ? 'italic' : 'normal' }} color={COLOR[t.k]}>{t.s}</T>
            )) : ' '}
          </T>
        ))}
      </View>
    </ScrollView>
  );
  if (flush) return body;
  return <View style={{ backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: darkColors.line }}>{body}</View>;
}
