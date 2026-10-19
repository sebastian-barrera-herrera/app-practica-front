import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { PyCell } from '@/content/types';
import { pyEngine } from '@/lib/pyrun';
import { splitReplChunks, withPrompts } from '@/lib/pyrepl';
import type { PyOptions, PySessionApi } from '@/pyengine/types';
import { Button } from './Button';
import { PyCode } from './PyCode';
import { Inline } from './RichText';
import { T } from './Text';
import { colors, darkColors, radius } from './theme';

interface Done {
  cell: PyCell;
  /** Texto mostrado: el código (con prompts si es REPL). */
  shown: string;
  out: { text: string; err: boolean }[];
}

/** Celdas de Python que se ejecutan una a una con el intérprete real, compartiendo estado (como un cuaderno). */
export function PyDemoView({ cells, setup, intro, onComplete }: { cells: PyCell[]; setup?: PyOptions; intro?: string; onComplete?: () => void }) {
  const [done, setDone] = useState<Done[]>([]);
  const [running, setRunning] = useState(false);
  const session = useRef<PySessionApi | null>(null);
  const idxRef = useRef(0);
  const busy = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const finished = done.length >= cells.length;
  const stdin = useMemo(() => setup?.stdin, [setup]);

  useEffect(() => {
    session.current = null;
    idxRef.current = 0;
    setDone([]);
  }, [cells, setup]);

  useEffect(() => {
    if (finished) onComplete?.();
  }, [finished, onComplete]);

  const runNext = useCallback(async () => {
    const at = idxRef.current;
    if (busy.current || at >= cells.length) return;
    busy.current = true;
    setRunning(true);
    const cell = cells[at];
    const eng = pyEngine();
    session.current ??= new eng.PySession(setup);
    const s = session.current;
    const out: { text: string; err: boolean }[] = [];
    let shown = cell.code.replace(/\n$/, '');
    try {
      if (cell.repl) {
        const chunks = splitReplChunks(cell.code, eng.isIncomplete);
        shown = chunks.map(withPrompts).join('\n');
        for (const chunk of chunks) {
          const r = await s.run(chunk + '\n', { mode: 'repl', onOutput: (text, err) => out.push({ text, err }) });
          if (r.value !== undefined) out.push({ text: r.value + '\n', err: false });
          if (!r.ok && r.error && !out.some((o) => o.err)) out.push({ text: r.error.traceback + '\n', err: true });
        }
      } else {
        const r = await s.run(cell.code, { mode: 'exec', filename: 'demo.py', onOutput: (text, err) => out.push({ text, err }) });
        if (!r.ok && r.error && !out.some((o) => o.err)) out.push({ text: r.error.traceback + '\n', err: true });
      }
    } catch (e) {
      out.push({ text: String(e instanceof Error ? e.message : e) + '\n', err: true });
    }
    idxRef.current = at + 1;
    setDone((d) => [...d, { cell, shown, out }]);
    busy.current = false;
    setRunning(false);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
  }, [cells, setup]);

  const runAll = useCallback(async () => {
    while (idxRef.current < cells.length) {
      await runNext();
      await new Promise((r) => setTimeout(r, 250));
    }
  }, [cells.length, runNext]);

  return (
    <View style={{ gap: 14 }}>
      {intro ? <Inline text={intro} /> : null}
      <View style={{ backgroundColor: darkColors.termBg, borderRadius: radius.lg, borderWidth: 1, borderColor: darkColors.line, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: darkColors.bg2, borderBottomWidth: 1, borderBottomColor: darkColors.line }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <View key={c} style={{ width: 10, height: 10, borderRadius: 5, marginRight: 6, backgroundColor: c }} />
          ))}
          <T v="tiny" color={darkColors.faint} style={{ marginLeft: 10 }}>demo · python</T>
        </View>
        <ScrollView ref={scroll} style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 12, gap: 14 }} nestedScrollEnabled>
          {done.map((d, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(220)} style={{ gap: 6 }}>
              <PyCode code={d.shown} flush />
              {d.out.length > 0 && (
                <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: d.out.some((o) => o.err) ? '#FF9AA5' : darkColors.mint + '88' }}>
                  <T selectable style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 13, lineHeight: 19 }} color={darkColors.termText}>
                    {d.out.map((o, k) => (
                      <T key={k} selectable style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 13, lineHeight: 19 }} color={o.err ? '#FF9AA5' : darkColors.termText}>{o.text}</T>
                    ))}
                  </T>
                </View>
              )}
              {d.cell.note ? (
                <View style={{ marginTop: 2, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: darkColors.cyan }}>
                  <T v="small" color={darkColors.cyan}>→ {d.cell.note}</T>
                </View>
              ) : null}
            </Animated.View>
          ))}
          {done.length === 0 && <T v="small" color={darkColors.faint}>Pulsa «Ejecutar» para ver la primera celda…</T>}
        </ScrollView>
      </View>
      {stdin && stdin.length > 0 && !finished && (
        <T v="tiny" color={colors.dim}>⌨ Entrada simulada: {stdin.map((l) => `«${l}»`).join(' · ')}</T>
      )}
      {!finished ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 2 }}>
            <Button label={done.length === 0 ? '▶  Ejecutar' : '▶  Siguiente celda'} onPress={runNext} disabled={running} kind="accent" />
          </View>
          {done.length < cells.length - 1 && (
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
