import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { parseInline, parseRich } from '@/content/richtext';
import type { Block } from '@/content/types';
import { useCodeLang, type CodeLang } from './codeLang';
import { PyCode } from './PyCode';
import { OnDark, T } from './Text';
import { colors, fonts, radius, makeStyles } from './theme';

export function Inline({ text, color = colors.text, size = 16 }: { text: string; color?: string; size?: number }) {
  const spans = useMemo(() => parseInline(text), [text]);
  return (
    <T style={{ fontSize: size, lineHeight: size * 1.5 }} color={color}>
      {spans.map((s, i) => {
        if (s.t === 'b') return <T key={i} bold color={colors.text} style={{ fontSize: size, lineHeight: size * 1.5 }}>{s.s}</T>;
        if (s.t === 'i') return <T key={i} color={colors.dim} style={{ fontSize: size, fontStyle: 'italic' }}>{s.s}</T>;
        if (s.t === 'code')
          return (
            <T key={i} style={{ fontFamily: fonts.mono, fontSize: size - 2, backgroundColor: 'rgba(56,189,248,0.13)', color: colors.cyan }}>
              {` ${s.s} `}
            </T>
          );
        return <React.Fragment key={i}>{s.s}</React.Fragment>;
      })}
    </T>
  );
}

const CALLOUT = {
  tip: { icon: '💡', get color() { return colors.mint; }, label: 'Consejo' },
  warn: { icon: '⚠️', get color() { return colors.amber; }, label: 'Cuidado' },
  note: { icon: 'ℹ️', get color() { return colors.cyan; }, label: 'Nota' },
  key: { icon: '🔑', get color() { return colors.violet; }, label: 'Clave' },
};

export function CodeBlock({ lines, lang }: { lines: string[]; lang?: CodeLang }) {
  const ctx = useCodeLang();
  const l = lang ?? ctx;
  if (l === 'py') return <PyCode code={lines.join('\n')} />;
  if (l === 'sql') return <PyCode code={lines.join('\n')} lang="sql" />;
  return (
    <View style={styles.code}>
      <OnDark>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((l, i) => {
            const isCmd = l.startsWith('$ ');
            const isComment = l.trimStart().startsWith('#');
            return (
              <T key={i} style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 20 }} color={isComment ? colors.faint : colors.termText}>
                {isCmd ? <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.mint}>{'$ '}</T> : null}
                {isCmd ? l.slice(2) : l || ' '}
              </T>
            );
          })}
        </View>
      </ScrollView>
      </OnDark>
    </View>
  );
}

export function RichText({ body, size = 16 }: { body: string; size?: number }) {
  const blocks = useMemo(() => parseRich(body), [body]);
  return (
    <View style={{ gap: 14 }}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} size={size} />
      ))}
    </View>
  );
}

function BlockView({ b, size }: { b: Block; size: number }) {
  switch (b.k) {
    case 'h':
      return <T v="h2" style={{ marginTop: 4 }}>{b.t}</T>;
    case 'p':
      return <Inline text={b.t} size={size} />;
    case 'list':
      return (
        <View style={{ gap: 8 }}>
          {b.items.map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
              <T color={colors.mint} bold style={{ width: 18, textAlign: 'center' }}>{b.ordered ? `${i + 1}.` : '•'}</T>
              <View style={{ flex: 1 }}>
                <Inline text={it} size={size} />
              </View>
            </View>
          ))}
        </View>
      );
    case 'code':
      return <CodeBlock lines={b.lines} />;
    case 'callout': {
      const c = CALLOUT[b.kind];
      return (
        <View style={[styles.callout, { borderColor: c.color + '88', backgroundColor: c.color + '14' }]}>
          <T style={{ fontSize: 20 }}>{c.icon}</T>
          <View style={{ flex: 1 }}>
            <T v="label" color={c.color} style={{ marginBottom: 2 }}>{c.label}</T>
            <Inline text={b.t} size={size - 1} />
          </View>
        </View>
      );
    }
    case 'table':
      return (
        <View style={styles.table}>
          {b.head.length > 0 && (
            <View style={[styles.tr, { backgroundColor: colors.card2 }]}>
              {b.head.map((h, i) => (
                <View key={i} style={[styles.td, i === 0 && { flex: 1.1 }]}>
                  <T v="tiny" bold color={colors.dim}>{h}</T>
                </View>
              ))}
            </View>
          )}
          {b.rows.map((r, ri) => (
            <View key={ri} style={[styles.tr, ri % 2 === 1 && { backgroundColor: 'rgba(255,255,255,0.025)' }]}>
              {r.map((c, ci) => (
                <View key={ci} style={[styles.td, ci === 0 && { flex: 1.1 }]}>
                  <Inline text={c} size={14} />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

const styles = makeStyles(() => ({
  code: { backgroundColor: colors.termBg, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line },
  callout: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1 },
  table: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  td: { flex: 1, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
}));
