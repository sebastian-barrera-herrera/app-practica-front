import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Terminal } from '@/engine/terminal';
import type { DemoLine } from '@/content/types';
import type { WorldOptions } from '@/engine/world';
import { Button } from './Button';
import { Inline } from './RichText';
import { AnsiText } from './TerminalView';
import { T } from './Text';
import { colors, fonts, radius } from './theme';

interface Block {
  cmd: string;
  prompt: string;
  out: { s: string; err: boolean }[];
  note?: string;
}

/** Terminal de demostración: escribe y ejecuta los comandos paso a paso con el motor real. */
export function DemoView({ lines, setup, intro, onComplete }: { lines: DemoLine[]; setup?: WorldOptions; intro?: string; onComplete?: () => void }) {
  const term = useMemo(() => new Terminal({ instant: true, cols: 44, ...(setup ?? {}) }), [setup]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const countRef = useRef(0);
  const busyRef = useRef(false);
  const idx = blocks.length;
  const done = idx >= lines.length && typing === null;

  useEffect(() => {
    if (done) onComplete?.();
  }, [done, onComplete]);

  const runNext = useCallback(async () => {
    const at = countRef.current;
    if (busyRef.current || at >= lines.length) return;
    busyRef.current = true;
    const l = lines[at];
    setRunning(true);
    const prompt = term.prompt();
    // efecto de escritura
    for (let i = 1; i <= l.cmd.length; i++) {
      setTyping(l.cmd.slice(0, i));
      await new Promise((r) => setTimeout(r, l.cmd.length > 30 ? 10 : 22));
    }
    await new Promise((r) => setTimeout(r, 160));
    const out: { s: string; err: boolean }[] = [];
    term.onOutput = (c) => out.push(c);
    await term.run(l.cmd);
    term.onOutput = () => {};
    setTyping(null);
    countRef.current = at + 1;
    setBlocks((b) => [...b, { cmd: l.cmd, prompt, out, note: l.note }]);
    busyRef.current = false;
    setRunning(false);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  }, [lines, term]);

  const runAll = useCallback(async () => {
    while (countRef.current < lines.length) {
       
      await runNext();
       
      await new Promise((r) => setTimeout(r, 250));
    }
  }, [lines.length, runNext]);

  return (
    <View style={{ gap: 14 }}>
      {intro ? <Inline text={intro} /> : null}
      <View style={styles.term}>
        <View style={styles.titleBar}>
          <View style={[styles.dot, { backgroundColor: '#FF5F57' }]} />
          <View style={[styles.dot, { backgroundColor: '#FEBC2E' }]} />
          <View style={[styles.dot, { backgroundColor: '#28C840' }]} />
          <T v="tiny" color={colors.faint} style={{ marginLeft: 10 }}>demo · bash</T>
        </View>
        <ScrollView ref={scroll} style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 12, gap: 10 }} nestedScrollEnabled>
          {blocks.map((b, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(220)} style={{ gap: 2 }}>
              <AnsiText raw={b.prompt + b.cmd} />
              {b.out.map((c, k) => (
                <AnsiText key={k} raw={c.s.replace(/\n$/, '')} err={c.err} />
              ))}
              {b.note ? (
                <View style={styles.note}>
                  <T v="small" color={colors.cyan}>→ {b.note}</T>
                </View>
              ) : null}
            </Animated.View>
          ))}
          {typing !== null && <AnsiText raw={term.prompt() + typing + '▌'} />}
          {blocks.length === 0 && typing === null && <T v="small" color={colors.faint}>Pulsa «Ejecutar» para ver el primer comando…</T>}
        </ScrollView>
      </View>
      {!done ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 2 }}>
            <Button label={idx === 0 ? '▶  Ejecutar' : '▶  Siguiente comando'} onPress={runNext} disabled={running} kind="accent" />
          </View>
          {idx < lines.length - 1 && (
            <View style={{ flex: 1 }}>
              <Button label="Todo" onPress={runAll} disabled={running} kind="secondary" />
            </View>
          )}
        </View>
      ) : (
        <T v="small" color={colors.green} center>✓ Demostración completa</T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  term: { backgroundColor: colors.termBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  titleBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.line },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  note: { marginTop: 4, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: colors.cyan },
});

export { fonts };
