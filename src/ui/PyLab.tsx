import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { PY_SAMPLES } from '@/content/py/samples';
import { useCourse, useGame } from '@/game/store';
import { pyEngine } from '@/lib/pyrun';
import { useStudyContext } from '@/lib/studyClock';
import type { PySessionApi } from '@/pyengine/types';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { ConfirmModal } from './ConfirmModal';
import { CourseHeader, CourseSwitcher } from './CourseSwitcher';
import { PyEditor } from './PyEditor';
import { PyOutput } from './PyOutput';
import { Screen } from './Screen';
import { T } from './Text';
import { colors, darkColors, fonts, radius } from './theme';
import { usePyRunner } from './usePyRunner';

type Mode = 'editor' | 'repl';

interface Saved {
  code?: string;
  mode?: Mode;
  history?: string[];
}

const DEFAULT_CODE = `# Escribe tu programa y pulsa Ejecutar
nombre = "Dojo"
print(f"¡Hola, {nombre}!")
`;

/** Laboratorio de Python: un editor con salida y un intérprete interactivo (REPL). Todo corre en el móvil. */
export function PyLab() {
  const { course } = useCourse('python');
  useStudyContext('python');
  const saved = (useGame.getState().courses.python.sandbox ?? {}) as Saved;
  const [mode, setMode] = useState<Mode>(saved.mode ?? 'editor');
  const [code, setCode] = useState(saved.code ?? DEFAULT_CODE);
  const [samples, setSamples] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const history = useRef<string[]>(saved.history ?? []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (patch: Saved) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const cur = (useGame.getState().courses.python.sandbox ?? {}) as Saved;
        useGame.getState().setSandbox('python', { ...cur, ...patch, history: history.current.slice(-60) });
      }, 1200);
    },
    [],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const count = () => {
    const g = useGame.getState();
    g.bump('python', { commands: 1, sandboxCommands: 1 });
  };

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 12 }}>
        <CourseSwitcher />
        <CourseHeader course={course} title={mode === 'editor' ? 'Editor de Python' : 'Intérprete (REPL)'} subtitle="Escribe y ejecuta Python al instante, sin conexión." />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="📝 Editor" active={mode === 'editor'} color={colors.cyan} onPress={() => { setMode('editor'); persist({ mode: 'editor' }); }} />
          <Chip label="⌨️ REPL" active={mode === 'repl'} color={colors.violet} onPress={() => { setMode('repl'); persist({ mode: 'repl' }); }} />
        </View>
        {mode === 'editor' ? (
          <EditorMode
            code={code}
            onChange={(c) => { setCode(c); persist({ code: c }); }}
            onSamples={() => setSamples(true)}
            onClear={() => setConfirm(true)}
            onRun={count}
          />
        ) : (
          <ReplMode onRun={count} onHistory={(h) => { history.current = h; persist({}); }} initialHistory={history.current} />
        )}
      </ScrollView>

      <Modal visible={samples} transparent animationType="fade" onRequestClose={() => setSamples(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(3,6,16,0.75)', justifyContent: 'center', padding: 20 }} onPress={() => setSamples(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line, maxHeight: '85%' }}>
            <T v="h2">Programas de ejemplo</T>
            <T v="small" color={colors.dim}>Se cargan en el editor (tu código actual se sustituye).</T>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {PY_SAMPLES.map((s) => (
                <Card
                  key={s.id}
                  pad={12}
                  onPress={() => {
                    setCode(s.code);
                    persist({ code: s.code, mode: 'editor' });
                    setMode('editor');
                    setSamples(false);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <T style={{ fontSize: 26 }}>{s.emoji}</T>
                    <View style={{ flex: 1 }}>
                      <T v="h3">{s.title}</T>
                      <T v="tiny" color={colors.dim}>{s.blurb}</T>
                    </View>
                  </View>
                </Card>
              ))}
            </ScrollView>
            <Button label="Cerrar" kind="ghost" onPress={() => setSamples(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmModal
        visible={confirm}
        title="¿Vaciar el editor?"
        message="Se borrará el código del editor. Tu progreso no cambia."
        confirmLabel="Vaciar"
        danger
        onConfirm={() => {
          setCode('');
          persist({ code: '' });
          setConfirm(false);
        }}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}

// ───────────────────────── editor ─────────────────────────

function EditorMode({ code, onChange, onSamples, onClear, onRun }: { code: string; onChange: (c: string) => void; onSamples: () => void; onClear: () => void; onRun: () => void }) {
  const runner = usePyRunner();
  const [ran, setRan] = useState<null | { ok: boolean; line?: number }>(null);

  const run = async () => {
    if (runner.running || !code.trim()) return;
    onRun();
    setRan(null);
    const { result } = await runner.run(code, { filename: 'main.py' });
    setRan({ ok: result.ok, line: result.error?.line });
  };

  return (
    <View style={{ gap: 12 }}>
      <PyEditor value={code} onChange={onChange} minHeight={230} placeholder="# Escribe tu código aquí" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}>
          <Button label={runner.running ? 'Ejecutando…' : '▶  Ejecutar'} kind="accent" disabled={runner.running || !code.trim()} onPress={run} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Ejemplos" kind="secondary" onPress={onSamples} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Vaciar" kind="ghost" onPress={onClear} />
        </View>
      </View>
      <PyOutput chunks={runner.chunks} running={runner.running} asking={!!runner.request} onSubmitInput={runner.submitInput} onStop={runner.stop} maxHeight={320} />
      {ran && (
        <T v="small" color={ran.ok ? colors.green : colors.rose}>
          {ran.ok ? '✓ El programa terminó sin errores.' : `✗ El programa terminó con un error${ran.line ? ` (línea ${ran.line})` : ''}. Lee el mensaje de arriba: te dice qué pasó.`}
        </T>
      )}
    </View>
  );
}

// ───────────────────────── REPL ─────────────────────────

const REPL_KEYS = [':', '(', ')', '[', ']', '{', '}', '"', "'", '=', ',', '.'];

function ReplMode({ onRun, onHistory, initialHistory }: { onRun: () => void; onHistory: (h: string[]) => void; initialHistory: string[] }) {
  const runner = usePyRunner();
  const session = useRef<PySessionApi | null>(null);
  const pending = useRef<string[]>([]);
  const [line, setLine] = useState('');
  const [prompt, setPrompt] = useState('>>> ');
  const hist = useRef<string[]>(initialHistory);
  const hpos = useRef(initialHistory.length);
  const welcome = useMemo(() => 'Python 3.13 (Dev Dojo) · escribe código y pulsa Enter.\nPrueba: 2 ** 10   ·   "hola".upper()   ·   [x * x for x in range(5)]\n', []);

  useEffect(() => {
    runner.push({ text: welcome, err: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, []);

  const submit = async () => {
    if (runner.running) return;
    const text = line;
    setLine('');
    const eng = pyEngine();
    session.current ??= new eng.PySession();
    if (pending.current.length === 0 && !text.trim()) {
      runner.push({ text: '>>> \n', err: false, kind: 'echo' });
      return;
    }
    runner.push({ text: prompt + text + '\n', err: false, kind: 'echo' });
    pending.current.push(text);
    const src = pending.current.join('\n');
    if (eng.isIncomplete(src)) {
      setPrompt('... ');
      return;
    }
    pending.current = [];
    setPrompt('>>> ');
    if (src.trim()) {
      hist.current = [...hist.current.filter((h) => h !== src), src].slice(-60);
      hpos.current = hist.current.length;
      onHistory(hist.current);
    }
    onRun();
    const { result } = await runner.run(src + '\n', { session: session.current, mode: 'repl', keep: true, filename: '<stdin>' });
    if (result.value !== undefined) runner.push({ text: result.value + '\n', err: false });
  };

  const recall = (dir: -1 | 1) => {
    const next = Math.max(0, Math.min(hist.current.length, hpos.current + dir));
    hpos.current = next;
    setLine(hist.current[next] ?? '');
  };

  const reset = () => {
    session.current = null;
    pending.current = [];
    setPrompt('>>> ');
    runner.clear();
    runner.push({ text: 'Sesión reiniciada.\n', err: false });
  };

  return (
    <View style={{ gap: 10 }}>
      <PyOutput chunks={runner.chunks} running={runner.running} asking={!!runner.request} onSubmitInput={runner.submitInput} onStop={runner.stop} title="Intérprete" maxHeight={380} emptyText="" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: darkColors.termBg, borderRadius: radius.md, borderWidth: 1, borderColor: darkColors.line, paddingHorizontal: 12 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 15 }} color={darkColors.mint}>{prompt}</T>
        <TextInput
          value={line}
          onChangeText={setLine}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={!runner.running && !runner.request}
          placeholder="escribe Python…"
          placeholderTextColor={darkColors.faint}
          returnKeyType="send"
          accessibilityLabel="Línea del intérprete"
          style={{ flex: 1, color: darkColors.white, fontFamily: fonts.mono, fontSize: 15, paddingVertical: 12, outlineStyle: 'none' } as object}
        />
        <Pressable onPress={submit} accessibilityLabel="Ejecutar línea" hitSlop={6} style={{ width: 38, height: 34, borderRadius: 10, backgroundColor: darkColors.mint, alignItems: 'center', justifyContent: 'center' }}>
          <T bold color="#04120D">↵</T>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }}>
        <Pressable onPress={() => recall(-1)} accessibilityLabel="Anterior" style={keyStyle}><T bold color={colors.text}>↑</T></Pressable>
        <Pressable onPress={() => recall(1)} accessibilityLabel="Siguiente" style={keyStyle}><T bold color={colors.text}>↓</T></Pressable>
        <Pressable onPress={() => setLine((l) => l + '    ')} accessibilityLabel="Sangría" style={keyStyle}><T bold color={colors.text}>⇥</T></Pressable>
        {REPL_KEYS.map((k) => (
          <Pressable key={k} onPress={() => setLine((l) => l + k)} accessibilityLabel={`Insertar ${k}`} style={keyStyle}>
            <T style={{ fontFamily: fonts.monoBold }} color={colors.text}>{k}</T>
          </Pressable>
        ))}
        <Pressable onPress={reset} accessibilityLabel="Reiniciar sesión" style={[keyStyle, { paddingHorizontal: 12 }]}><T v="small" bold color={colors.rose}>↺ Reiniciar</T></Pressable>
      </ScrollView>
      <T v="tiny" color={colors.faint}>Los bloques (if, for, def…) terminan con una línea en blanco, como en Python real.</T>
    </View>
  );
}

const keyStyle = { minWidth: 38, height: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(128,140,180,0.18)', alignItems: 'center', justifyContent: 'center' } as const;
