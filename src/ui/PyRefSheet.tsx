import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PY_REF_CATEGORY, refByName, type PyRef } from '@/content/py/reference';
import { useGame } from '@/game/store';
import { pyEngine } from '@/lib/pyrun';
import { splitReplChunks } from '@/lib/pyrepl';
import { useStudyContext } from '@/lib/studyClock';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { PyCode } from './PyCode';
import { PyOutput } from './PyOutput';
import { RichText } from './RichText';
import { Screen } from './Screen';
import { T } from './Text';
import { colors, fonts, ink } from './theme';
import { usePyRunner } from './usePyRunner';

/** Ejecuta el ejemplo «como en el intérprete»: cada sentencia por separado, mostrando el valor de las expresiones. */
async function runExample(runner: ReturnType<typeof usePyRunner>, code: string) {
  const eng = pyEngine();
  const session = new eng.PySession({});
  runner.clear();
  for (const chunk of splitReplChunks(code, eng.isIncomplete)) {
    const { result } = await runner.run(chunk + '\n', { session, mode: 'repl', keep: true });
    if (result.value !== undefined) runner.push({ text: result.value + '\n', err: false });
    if (!result.ok) break;
  }
}

function Example({ code, note }: { code: string; note?: string }) {
  const runner = usePyRunner();
  const [shown, setShown] = useState(false);
  return (
    <Card pad={12}>
      {note ? <T v="small" color={colors.dim} style={{ marginBottom: 8 }}>{note}</T> : null}
      <PyCode code={code} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={runner.running ? 'Ejecutando…' : '▶ Ejecutar'}
            small
            kind="accent"
            disabled={runner.running}
            onPress={() => {
              setShown(true);
              void runExample(runner, code);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Probar en el editor"
            small
            kind="secondary"
            onPress={() => {
              const g = useGame.getState();
              const cur = (g.courses.python.sandbox ?? {}) as Record<string, unknown>;
              g.setSandbox('python', { ...cur, code: code + '\n', mode: 'editor' });
              g.setActive('python');
              router.push('/(tabs)/lab');
            }}
          />
        </View>
      </View>
      {shown && (
        <View style={{ marginTop: 10 }}>
          <PyOutput chunks={runner.chunks} running={runner.running} asking={!!runner.request} onSubmitInput={runner.submitInput} onStop={runner.stop} maxHeight={160} />
        </View>
      )}
    </Card>
  );
}

/** Ficha de la biblioteca de Python. */
export function PyRefSheet({ name }: { name: string }) {
  useStudyContext('python');
  const ref: PyRef | undefined = refByName(name);
  useEffect(() => {
    if (ref) useGame.getState().bump('python', { libraryViews: 1 });
  }, [ref]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="tiny" color={colors.dim}>Biblioteca de Python</T>
      </View>
      {!ref ? (
        <View style={{ gap: 16, paddingTop: 30 }}>
          <T v="h2" center>No encuentro «{name}»</T>
          <Button label="Volver" onPress={() => router.back()} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          <View style={{ gap: 6 }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 30, lineHeight: 38 }} color={ink('#5AA9FF')}>{ref.name}</T>
            <T color={colors.dim}>{ref.summary}</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <Chip label={PY_REF_CATEGORY[ref.category]} color={colors.cyan} />
              <Chip label={ref.kind} color={colors.violet} />
              <Chip label={['', 'Básico', 'Intermedio', 'Avanzado'][ref.level]} color={colors.mint} />
            </View>
          </View>
          <View>
            <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Uso</T>
            <PyCode code={ref.usage} />
          </View>
          {ref.details ? <RichText body={ref.details} size={15} /> : null}
          <T v="label" color={colors.dim}>Ejemplos</T>
          {ref.examples.map(([code, note], i) => (
            <Example key={i} code={code} note={note} />
          ))}
          {ref.seeAlso?.length ? (
            <View>
              <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Mira también</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ref.seeAlso.map((s) => (
                  <Chip key={s} label={s} mono color={colors.cyan} onPress={() => router.push({ pathname: '/library/[cmd]', params: { cmd: s, course: 'python' } })} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
