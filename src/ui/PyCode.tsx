import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { T } from './Text';
import { highlightPython, highlightRepl, isReplTranscript } from './pyhighlight';
import { tokColor } from './pycolors';
import { highlightSql } from './sqlhighlight';
import { sqlTokColor } from './sqlcolors';
import { darkColors, fonts, radius } from './theme';

/** Código de Python con resaltado. Reconoce transcripciones de REPL («>>> »). */
export function PyCode({ code, size = 13, flush, lang = 'py' }: { code: string; size?: number; /** sin caja (dentro de otra) */ flush?: boolean; lang?: 'py' | 'sql' }) {
  const lines = useMemo(() => {
    const src = code.replace(/\n$/, '');
    if (lang === 'sql') return highlightSql(src);
    return isReplTranscript(src) ? highlightRepl(src) : highlightPython(src);
  }, [code, lang]);
  const color = lang === 'sql' ? sqlTokColor : tokColor;
  const body = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {lines.map((line, i) => (
          <T key={i} style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size * 1.55 }} color={darkColors.termText}>
            {line.length ? line.map((t, j) => (
              <T key={j} style={{ fontFamily: t.k === 'kw' || t.k === 'prompt' || (lang === 'sql' && t.k === 'dec') ? fonts.monoBold : fonts.mono, fontSize: size, fontStyle: t.k === 'com' ? 'italic' : 'normal' }} color={color(t)}>{t.s}</T>
            )) : ' '}
          </T>
        ))}
      </View>
    </ScrollView>
  );
  if (flush) return body;
  return <View style={{ backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: darkColors.line }}>{body}</View>;
}
