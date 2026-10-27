import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AWS_REF_CATEGORY, awsRefByName, type AwsExample, type AwsRef } from '@/content/aws/reference';
import { Terminal } from '@/engine';
import { useGame } from '@/game/store';
import { useStudyContext } from '@/lib/studyClock';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { RichText, CodeBlock } from './RichText';
import { Screen } from './Screen';
import { T } from './Text';
import { courseColor } from './courseColors';
import { colors, darkColors, fonts, ink, radius } from './theme';

function Example({ run: exec, ex }: { run: (cmd: string) => Promise<string>; ex: AwsExample }) {
  const [cmd, note, kind] = ex;
  const [out, setOut] = useState<string | null>(null);
  const run = async () => setOut((await exec(cmd)) || '(sin salida)');
  return (
    <Card pad={12}>
      {note ? <T v="small" color={colors.dim} style={{ marginBottom: 8 }}>{note}</T> : null}
      <CodeBlock lines={[`$ ${cmd}`]} lang="sh" />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={kind === 'error' ? '▶ Ver el error' : '▶ Ejecutar'} small kind="accent" onPress={run} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Probar en el laboratorio"
            small
            kind="secondary"
            onPress={() => {
              useGame.getState().setActive('aws');
              router.push('/(tabs)/lab');
            }}
          />
        </View>
      </View>
      {out !== null && (
        <View style={{ marginTop: 10, backgroundColor: darkColors.termBg, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: darkColors.line }}>
          <T selectable style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 }} color={kind === 'error' ? '#FF9AA5' : darkColors.termText}>{out}</T>
        </View>
      )}
    </Card>
  );
}

const Bullets = ({ title, items, color }: { title: string; items: string[]; color: string }) => (
  <View style={{ gap: 4 }}>
    <T v="label" color={color}>{title}</T>
    {items.map((x, i) => (
      <T key={i} v="small" color={colors.text}>• {x}</T>
    ))}
  </View>
);

/** Ficha de la biblioteca de AWS. */
export function AwsRefSheet({ name }: { name: string }) {
  useStudyContext('aws');
  const ref: AwsRef | undefined = useMemo(() => awsRefByName(name), [name]);
  useEffect(() => {
    if (ref) useGame.getState().bump('aws', { libraryViews: 1 });
  }, [ref]);
  const col = ink(courseColor('aws'));
  // los ejemplos de una ficha comparten cuenta y shell: variables y recursos creados por uno los ve el siguiente
  const term = useRef<Terminal | null>(null);
  const exec = async (cmd: string) => {
    term.current ??= new Terminal({ instant: true, cols: 60, aws: ref?.scenario ?? 'base', packages: ['zip', 'unzip'] });
    const r = await term.current.exec(cmd);
    return r.text.trimEnd();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="tiny" color={colors.dim}>Biblioteca de AWS</T>
      </View>
      {!ref ? (
        <View style={{ gap: 16, paddingTop: 30 }}>
          <T v="h2" center>No encuentro «{name}»</T>
          <Button label="Volver" onPress={() => router.back()} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          <View style={{ gap: 6 }}>
            <T style={{ fontFamily: ref.kind === 'comando' ? fonts.monoBold : undefined, fontWeight: ref.kind === 'comando' ? undefined : '800', fontSize: 28, lineHeight: 36 }} color={col}>{ref.name}</T>
            <T color={colors.dim}>{ref.summary}</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <Chip label={AWS_REF_CATEGORY[ref.category]} color={colors.cyan} />
              <Chip label={ref.kind} color={colors.violet} />
              <Chip label={['', 'Básico', 'Intermedio', 'Avanzado'][ref.level]} color={colors.mint} />
            </View>
          </View>
          {ref.usage ? (
            <View>
              <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Forma de uso</T>
              <CodeBlock lines={ref.usage.split('\n')} lang="sh" />
            </View>
          ) : null}
          {ref.details ? <RichText body={ref.details} size={15} /> : null}
          {ref.whenUse?.length ? <Bullets title="✅ Cuándo usarlo" items={ref.whenUse} color={colors.green} /> : null}
          {ref.whenNot?.length ? <Bullets title="🚫 Cuándo NO" items={ref.whenNot} color={colors.rose} /> : null}
          {ref.pricing ? (
            <Card pad={12} accent={colors.amber}>
              <T v="label" color={colors.amber}>💰 Cómo se cobra</T>
              <T v="small" color={colors.text}>{ref.pricing}</T>
            </Card>
          ) : null}
          {ref.limits?.length ? <Bullets title="📏 Límites típicos" items={ref.limits} color={colors.cyan} /> : null}
          {ref.versus?.length ? (
            <View style={{ gap: 6 }}>
              <T v="label" color={colors.violet}>⚖️ Frente a…</T>
              {ref.versus.map(([k, v]) => (
                <T key={k} v="small" color={colors.text}><T v="small" bold color={colors.violet}>{k}: </T>{v}</T>
              ))}
            </View>
          ) : null}
          {ref.examples?.length ? (
            <>
              <T v="label" color={colors.dim}>Ejemplos <T v="tiny" color={colors.faint}>(en una cuenta de prueba)</T></T>
              {ref.examples.map((ex, i) => (
                <Example key={i} run={exec} ex={ex} />
              ))}
            </>
          ) : null}
          {ref.seeAlso?.length ? (
            <View>
              <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Mira también</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ref.seeAlso.map((s) => (
                  <Chip key={s} label={s} mono color={colors.cyan} onPress={() => router.push({ pathname: '/library/[cmd]', params: { cmd: s, course: 'aws' } })} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
