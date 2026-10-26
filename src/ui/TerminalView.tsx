import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View, type LayoutChangeEvent, type TextInputInstance } from 'react-native';
import { parseAnsi, type Terminal } from '@/engine';
import type { AnsiSpan } from '@/engine/ansi';
import { stripAnsi } from '@/engine';
import { error as hapticError, select, tap } from '@/lib/haptics';
import { Chip } from './Chip';
import { T } from './Text';
import { ansi, ansi256, darkColors as colors, fonts, makeStyles } from './theme';

interface Line {
  id: number;
  raw: string;
  err: boolean;
}

interface Transcript {
  lines: Line[];
  partial: string;
  partialErr: boolean;
  nextId: number;
  ver: number;
  listeners: Set<() => void>;
}

const transcripts = new WeakMap<Terminal, Transcript>();
const MAX_LINES = 900;

function getTranscript(term: Terminal): Transcript {
  let t = transcripts.get(term);
  if (!t) {
    t = { lines: [], partial: '', partialErr: false, nextId: 1, ver: 0, listeners: new Set() };
    transcripts.set(term, t);
    attach(term, t);
  }
  return t;
}

function attach(term: Terminal, t: Transcript) {
  const push = (raw: string, err: boolean) => {
    t.lines.push({ id: t.nextId++, raw, err });
    if (t.lines.length > MAX_LINES) t.lines.splice(0, t.lines.length - MAX_LINES);
  };
  term.onOutput = ({ s, err }) => {
    let text = s;
    const clr = text.lastIndexOf('\x1b[2J');
    if (clr >= 0) {
      t.lines = [];
      t.partial = '';
      text = text.slice(clr + 4);
    }
    text = text.replace(/\x1b\[H/g, '').replace(/\r\n/g, '\n');
    // retorno de carro suelto: sobrescribe la línea parcial
    const crParts = text.split('\r');
    if (crParts.length > 1) {
      text = crParts[crParts.length - 1];
      t.partial = '';
    }
    if (t.partial !== '' && t.partialErr !== err) {
      push(t.partial, t.partialErr);
      t.partial = '';
    }
    const pieces = text.split('\n');
    for (let i = 0; i < pieces.length; i++) {
      t.partial += pieces[i];
      t.partialErr = err;
      if (i < pieces.length - 1) {
        push(t.partial, err);
        t.partial = '';
      }
    }
    notify(t);
  };
}

function notify(t: Transcript) {
  t.ver++;
  t.listeners.forEach((l) => l());
}

export function transcriptLines(term: Terminal): string[] {
  const t = getTranscript(term);
  return [...t.lines.map((l) => stripAnsi(l.raw)), ...(t.partial ? [stripAnsi(t.partial)] : [])];
}

export function echoToTranscript(term: Terminal, raw: string) {
  const t = getTranscript(term);
  if (t.partial) {
    t.lines.push({ id: t.nextId++, raw: t.partial, err: t.partialErr });
    t.partial = '';
  }
  t.lines.push({ id: t.nextId++, raw, err: false });
  notify(t);
}

function colorOf(name?: string): string | undefined {
  if (!name) return undefined;
  if (name.startsWith('c')) return ansi256(parseInt(name.slice(1), 10));
  return ansi[name];
}

export const AnsiText = memo(function AnsiText({ raw, err, size = 13 }: { raw: string; err?: boolean; size?: number }) {
  const spans = useMemo(() => parseAnsi(raw), [raw]);
  const base = err ? '#FF9AA5' : colors.termText;
  return (
    <T selectable style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size * 1.45, color: base }}>
      {spans.length === 0 ? ' ' : spans.map((s, i) => <Span key={i} s={s} base={base} size={size} />)}
    </T>
  );
});

function Span({ s, base, size }: { s: AnsiSpan; base: string; size: number }) {
  let fg = colorOf(s.fg) ?? base;
  let bg = colorOf(s.bg);
  if (s.inverse) {
    const t = fg;
    fg = bg ?? colors.termBg;
    bg = t;
  }
  return (
    <T
      style={{
        fontFamily: s.bold ? fonts.monoBold : fonts.mono,
        fontSize: size,
        color: fg,
        backgroundColor: bg,
        opacity: s.dim ? 0.6 : 1,
        textDecorationLine: s.underline ? 'underline' : 'none',
      }}
    >
      {s.text}
    </T>
  );
}

const LineView = memo(function LineView({ item }: { item: Line }) {
  return <AnsiText raw={item.raw} err={item.err} />;
});

const KEYS: { label: string; k: string; kind?: 'sig' | 'text' | 'nav' }[] = [
  { label: 'Tab', k: 'tab', kind: 'nav' },
  { label: '↑', k: 'up', kind: 'nav' },
  { label: '↓', k: 'down', kind: 'nav' },
  { label: '⌃C', k: 'ctrl-c', kind: 'sig' },
  { label: '⌃D', k: 'ctrl-d', kind: 'sig' },
  { label: '⌃Z', k: 'ctrl-z', kind: 'sig' },
  { label: '⌃L', k: 'ctrl-l', kind: 'sig' },
  { label: '|', k: '|' },
  { label: '>', k: '>' },
  { label: '<', k: '<' },
  { label: '~', k: '~' },
  { label: '/', k: '/' },
  { label: '-', k: '-' },
  { label: '*', k: '*' },
  { label: '$', k: '$' },
  { label: '&', k: '&' },
  { label: ';', k: ';' },
  { label: '"', k: '"' },
  { label: "'", k: "'" },
  { label: '\\', k: '\\' },
  { label: '{', k: '{' },
  { label: '}', k: '}' },
  { label: '(', k: '(' },
  { label: ')', k: ')' },
  { label: '[', k: '[' },
  { label: ']', k: ']' },
  { label: '=', k: '=' },
  { label: '_', k: '_' },
  { label: '.', k: '.' },
];

export interface TerminalViewProps {
  term: Terminal;
  /** Se invoca al terminar cada línea ejecutada. */
  onRun?: (line: string) => void;
  onSignal?: (sig: 'INT' | 'TSTP' | 'EOF') => void;
  autoFocus?: boolean;
  hideKeys?: boolean;
  placeholder?: string;
  /** Texto de bienvenida (solo si el transcript está vacío). */
  banner?: string[];
  disabled?: boolean;
  onCols?: (cols: number) => void;
  /** Deja este texto escrito en la línea de entrada (cada objeto nuevo lo vuelve a poner), listo para pulsar Intro. */
  prefill?: { text: string };
}

export function TerminalView({ term, onRun, onSignal, autoFocus, hideKeys, placeholder, banner, disabled, onCols, prefill }: TerminalViewProps) {
  const tr = getTranscript(term);
  const [, force] = useState(0);
  const [input, setInput] = useState('');
  const [cont, setCont] = useState<string[]>([]);
  const [busy, setBusy] = useState(term.busy);
  const [options, setOptions] = useState<string[]>([]);
  const [, setSession] = useState(0);
  const histIdx = useRef<number | null>(null);
  const draft = useRef('');
  const sel = useRef({ start: 0, end: 0 });
  const listRef = useRef<FlatList<Line>>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const [colsMeasured, setColsMeasured] = useState(false);
  const bannerRef = useRef(banner);
  bannerRef.current = banner;

  // suscripción al transcript y al estado del motor
  useEffect(() => {
    const l = () => force((n) => n + 1);
    tr.listeners.add(l);
    term.onBusy = (b) => setBusy(b);
    term.onSession = () => setSession((n) => n + 1);
    const intro = bannerRef.current;
    if (tr.lines.length === 0 && !tr.partial && intro?.length) {
      for (const b of intro) tr.lines.push({ id: tr.nextId++, raw: b, err: false });
      notify(tr);
    }
    return () => {
      tr.listeners.delete(l);
      term.onBusy = () => {};
      term.onSession = () => {};
    };
  }, [term, tr]);

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 250);
  }, [autoFocus]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    sel.current = { start: prefill.text.length, end: prefill.text.length };
    setOptions([]);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [prefill]);

  const lastText = tr.partial ? stripAnsi(tr.partial) : tr.lines.length ? stripAnsi(tr.lines[tr.lines.length - 1].raw) : '';
  const secret = busy && /(password|passphrase|contraseña)[^\n]*:\s*$/i.test(lastText);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => (tr.partial ? [...tr.lines, { id: -1, raw: tr.partial, err: tr.partialErr }] : [...tr.lines]), [tr.ver]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width - 24;
      const cols = Math.max(24, Math.floor(w / (13 * 0.6)));
      term.setCols(cols);
      onCols?.(cols);
      setColsMeasured(true);
    },
    [term, onCols],
  );
  void colsMeasured;

  const scrollEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  const echo = useCallback(
    (text: string, withPrompt: boolean) => {
      const raw = (withPrompt ? (cont.length ? '> ' : term.prompt()) : '') + text;
      echoToTranscript(term, raw);
    },
    [term, cont.length],
  );

  const submit = useCallback(async () => {
    if (disabled) return;
    const line = input;
    histIdx.current = null;
    setOptions([]);
    if (term.ended) return;
    if (term.busy) {
      echoToTranscript(term, secret ? '' : line);
      setInput('');
      void term.run(line);
      return;
    }
    const full = cont.length ? cont.join('\n') + '\n' + line : line;
    if (full.trim() !== '' && term.isIncomplete(full)) {
      echo(line, true);
      setCont((c) => [...c, line]);
      setInput('');
      return;
    }
    echo(line, true);
    setCont([]);
    setInput('');
    if (full.trim() === '') return;
    const rec = await term.run(full);
    // un comando que falla avisa con una vibración corta
    if (rec && rec.stderr.trim() !== '') hapticError();
    onRun?.(full);
    scrollEnd();
  }, [input, cont, term, secret, disabled, echo, onRun, scrollEnd]);

  const insertAtCursor = useCallback((txt: string) => {
    setInput((cur) => {
      const { start, end } = sel.current;
      const s = Math.min(start, cur.length);
      const e = Math.min(end, cur.length);
      const next = cur.slice(0, s) + txt + cur.slice(e);
      const pos = s + txt.length;
      sel.current = { start: pos, end: pos };
      return next;
    });
  }, []);

  const doTab = useCallback(() => {
    const r = term.complete(input);
    if (!r.options.length) return;
    const word = input.slice(r.start);
    if (r.options.length === 1) {
      const o = r.options[0];
      const next = input.slice(0, r.start) + o + (o.endsWith('/') ? '' : ' ');
      setInput(next);
      sel.current = { start: next.length, end: next.length };
      setOptions([]);
      return;
    }
    // prefijo común
    let prefix = r.options[0];
    for (const o of r.options) while (!o.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (prefix.length > word.length) {
      const next = input.slice(0, r.start) + prefix;
      setInput(next);
      sel.current = { start: next.length, end: next.length };
    }
    setOptions(r.options.slice(0, 24));
  }, [term, input]);

  const press = useCallback(
    (k: string) => {
      select();
      if (k === 'tab') return doTab();
      if (k === 'up' || k === 'down') {
        const h = term.history;
        if (!h.length) return;
        if (histIdx.current === null) {
          draft.current = input;
          histIdx.current = k === 'up' ? h.length - 1 : null;
        } else {
          const n = histIdx.current + (k === 'up' ? -1 : 1);
          histIdx.current = n < 0 ? 0 : n >= h.length ? null : n;
        }
        const v = histIdx.current === null ? draft.current : h[histIdx.current];
        setInput(v);
        sel.current = { start: v.length, end: v.length };
        return;
      }
      if (k === 'ctrl-c') {
        onSignal?.('INT');
        if (term.busy) term.signal('INT');
        else {
          echoToTranscript(term, (cont.length ? '> ' : term.prompt()) + input + '^C');
          setInput('');
          setCont([]);
        }
        return;
      }
      if (k === 'ctrl-z') {
        onSignal?.('TSTP');
        if (term.busy) term.signal('TSTP');
        return;
      }
      if (k === 'ctrl-d') {
        onSignal?.('EOF');
        if (term.busy) term.signal('EOF');
        else if (input === '' && (term.shell.userStack.length || term.remoteLabel)) void term.run('exit');
        return;
      }
      if (k === 'ctrl-l') {
        tr.lines = [];
        tr.partial = '';
        notify(tr);
        return;
      }
      insertAtCursor(k);
    },
    [doTab, term, input, cont.length, tr, insertAtCursor, onSignal],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula al cambiar el historial o las líneas del terminal
  const promptSpans = useMemo(() => (busy ? [] : parseAnsi(cont.length ? '> ' : term.prompt())), [busy, term, cont.length, tr.lines.length, term.history.length]);

  return (
    <View style={styles.root}>
      <View style={styles.screen} onLayout={onLayout}>
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(l) => String(l.id)}
          renderItem={({ item }) => <LineView item={item} />}
          onContentSizeChange={scrollEnd}
          contentContainerStyle={{ padding: 12, paddingBottom: 6 }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={40}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
        />
      </View>
      {options.length > 0 && (
        <View style={styles.options}>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 10 }}>
            {options.map((o) => (
              <Chip
                key={o}
                label={o}
                mono
                color={colors.cyan}
                onPress={() => {
                  const r = term.complete(input);
                  const next = input.slice(0, r.start) + o + (o.endsWith('/') ? '' : ' ');
                  setInput(next);
                  sel.current = { start: next.length, end: next.length };
                  setOptions([]);
                  inputRef.current?.focus();
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
      <View style={styles.inputWrap}>
        {!busy && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {promptSpans.map((s, i) => (
              <T key={i} numberOfLines={1} style={{ fontFamily: s.bold ? fonts.monoBold : fonts.mono, fontSize: 12, color: colorOf(s.fg) ?? colors.dim }}>
                {s.text}
              </T>
            ))}
          </View>
        )}
        <View style={styles.inputRow}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 15, marginRight: 8 }} color={busy ? colors.amber : colors.mint}>{busy ? '⏵' : '›'}</T>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={(v) => {
              setInput(v);
              if (options.length) setOptions([]);
            }}
            onSelectionChange={(e) => {
              sel.current = e.nativeEvent.selection;
            }}
            onSubmitEditing={submit}
            submitBehavior="submit"
            blurOnSubmit={false}
            returnKeyType="send"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            keyboardAppearance="dark"
            secureTextEntry={secret}
            selectionColor={colors.mint}
            placeholder={placeholder ?? (busy ? 'el comando espera tu entrada…' : 'escribe un comando…')}
            placeholderTextColor={colors.faint}
            editable={!disabled}
            style={styles.input}
          />
          <Pressable onPress={submit} hitSlop={10} style={styles.send} accessibilityLabel="Ejecutar">
            <T bold color="#04120D">↵</T>
          </Pressable>
        </View>
      </View>
      {!hideKeys && (
        <View style={styles.keys}>
          <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, gap: 6, alignItems: 'center' }}>
            {KEYS.map((k) => (
              <Pressable
                key={k.k}
                onPress={() => press(k.k)}
                style={({ pressed }) => [styles.key, k.kind === 'sig' && styles.keySig, k.kind === 'nav' && styles.keyNav, pressed && { opacity: 0.6 }]}
                accessibilityLabel={`tecla ${k.label}`}
              >
                <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={k.kind === 'sig' ? colors.rose : k.kind === 'nav' ? colors.cyan : colors.text}>{k.label}</T>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = makeStyles(() => ({
  root: { flex: 1, backgroundColor: colors.termBg },
  screen: { flex: 1 },
  options: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg2 },
  inputWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: '#0A1022' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, fontFamily: fonts.mono, fontSize: 15, color: colors.white, paddingVertical: 8, minHeight: 40 },
  send: { backgroundColor: colors.mint, borderRadius: 10, width: 38, height: 34, alignItems: 'center', justifyContent: 'center' },
  keys: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg2, paddingVertical: 6 },
  key: { minWidth: 34, height: 32, paddingHorizontal: 9, borderRadius: 8, backgroundColor: colors.card2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  keySig: { borderColor: colors.rose + '88', backgroundColor: colors.rose + '18' },
  keyNav: { borderColor: colors.cyan + '77', backgroundColor: colors.cyan + '14' },
}));

export { tap };
