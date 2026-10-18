import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { REGISTRY } from '@/engine';
import { useGame } from '@/game/store';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { CodeBlock } from '@/ui/RichText';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, fonts } from '@/ui/theme';
import { CATEGORY_LABEL, LEVEL_COLOR, LEVEL_LABEL } from '@/lib/library';

export default function CommandSheet() {
  const { cmd } = useLocalSearchParams<{ cmd: string }>();
  const def = cmd ? REGISTRY.get(cmd) : undefined;
  const aliases = def ? [...REGISTRY.values()].filter((d) => d.run === def.run && d.name !== def.name).map((d) => d.name) : [];
  const practiced = useGame((s) => (cmd ? s.seenCommands[cmd] ?? 0 : 0));

  useEffect(() => {
    if (def) useGame.getState().bump({ libraryViews: 1 });
  }, [def]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <T v="tiny" color={colors.dim}>Biblioteca</T>
      </View>
      {!def ? (
        <View style={{ gap: 16, paddingTop: 30 }}>
          <T v="h2" center>No encuentro «{cmd}»</T>
          <Button label="Volver" onPress={() => router.back()} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          <View style={{ gap: 6 }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 34, lineHeight: 42 }} color={colors.mint}>{def.name}</T>
            <T color={colors.dim}>{def.summary}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <Chip label={CATEGORY_LABEL[def.category]} color={colors.cyan} />
              {def.level ? <Chip label={LEVEL_LABEL[def.level]} color={LEVEL_COLOR[def.level]} /> : null}
              {def.builtin ? <Chip label="builtin" color={colors.violet} /> : null}
              {def.package ? <Chip label={`apt: ${def.package}`} color={colors.amber} mono /> : null}
              {practiced > 0 ? <Chip label={`usado ${practiced}×`} color={colors.green} /> : null}
            </View>
            {aliases.length > 0 && <T v="small" color={colors.dim}>También: <T v="small" bold color={colors.text}>{aliases.join(', ')}</T></T>}
          </View>

          {def.usage ? (
            <View style={{ gap: 6 }}>
              <T v="label" color={colors.dim}>Uso</T>
              <CodeBlock lines={[def.usage]} />
            </View>
          ) : null}

          {def.options && def.options.length > 0 && (
            <View style={{ gap: 6 }}>
              <T v="label" color={colors.dim}>Opciones útiles</T>
              <Card pad={12}>
                <View style={{ gap: 10 }}>
                  {def.options.map(([o, d]) => (
                    <View key={o} style={{ flexDirection: 'row', gap: 12 }}>
                      <T style={{ fontFamily: fonts.monoBold, fontSize: 13, width: 92 }} color={colors.amber}>{o}</T>
                      <T v="small" color={colors.dim} style={{ flex: 1 }}>{d}</T>
                    </View>
                  ))}
                </View>
              </Card>
            </View>
          )}

          {def.examples && def.examples.length > 0 && (
            <View style={{ gap: 6 }}>
              <T v="label" color={colors.dim}>Ejemplos</T>
              {def.examples.map(([c, d]) => (
                <View key={c} style={{ gap: 4 }}>
                  <CodeBlock lines={[`$ ${c}`]} />
                  <T v="small" color={colors.dim}>↳ {d}</T>
                </View>
              ))}
            </View>
          )}

          <Card pad={12} accent={colors.mint}>
            <T v="small" color={colors.dim}>
              💡 Pruébalo tú mismo en la pestaña <T v="small" bold color={colors.mint}>Terminal</T>. También puedes escribir <T v="small" bold style={{ fontFamily: fonts.monoBold }} color={colors.mint}>{def.name} --help</T> o <T v="small" bold style={{ fontFamily: fonts.monoBold }} color={colors.mint}>man {def.name}</T>.
            </T>
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}
