import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { T } from './Text';
import { highlightPython, highlightRepl, isReplTranscript } from './pyhighlight';
import { tokColor } from './pycolors';
import { darkColors, fonts, radius } from './theme';

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
              <T key={j} style={{ fontFamily: t.k === 'kw' || t.k === 'prompt' ? fonts.monoBold : fonts.mono, fontSize: size, fontStyle: t.k === 'com' ? 'italic' : 'normal' }} color={tokColor(t)}>{t.s}</T>
            )) : ' '}
          </T>
        ))}
      </View>
    </ScrollView>
  );
  if (flush) return body;
  return <View style={{ backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: darkColors.line }}>{body}</View>;
}
