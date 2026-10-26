import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AWS_REF_CATEGORY, AWS_REFERENCE, type AwsRefCategory } from '@/content/aws/reference';
import { Card } from './Card';
import { Chip } from './Chip';
import { Screen } from './Screen';
import { T } from './Text';
import { courseColor } from './courseColors';
import { colors, fonts, ink, radius } from './theme';

const LEVEL_LABEL = ['', 'Básico', 'Intermedio', 'Avanzado'];
const levelColor = (l: number) => [colors.mint, colors.mint, colors.cyan, colors.violet][l] ?? colors.mint;

/** Biblioteca de AWS: servicios, conceptos y comandos con «cuándo usarlo y cuándo no». */
export function AwsLibrary() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<AwsRefCategory | null>(null);
  const cats = useMemo(() => [...new Set(AWS_REFERENCE.map((r) => r.category))], []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return AWS_REFERENCE.filter((r) => (cat ? r.category === cat : true) && (!t || r.name.toLowerCase().includes(t) || r.summary.toLowerCase().includes(t))).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }, [q, cat]);
  const col = ink(courseColor('aws'));

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Biblioteca de AWS</T>
          <T v="tiny" color={colors.dim}>{AWS_REFERENCE.length} fichas: cuándo usar cada cosa y cuándo no</T>
        </View>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Buscar servicio, concepto o comando…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Buscar en la biblioteca"
        style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, color: colors.text, fontFamily: fonts.mono, fontSize: 15, paddingHorizontal: 16, paddingVertical: 12 }}
      />
      <View style={{ height: 58 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingVertical: 10 }}>
          <Chip label="Todos" active={cat === null} onPress={() => setCat(null)} />
          {cats.map((c) => (
            <Chip key={c} label={AWS_REF_CATEGORY[c]} color={colors.cyan} active={cat === c} onPress={() => setCat(cat === c ? null : c)} />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.name}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 30 }}
        ListEmptyComponent={<T color={colors.dim} center style={{ marginTop: 30 }}>Nada coincide con «{q}».</T>}
        renderItem={({ item: r }) => (
          <Card pad={12} onPress={() => router.push({ pathname: '/library/[cmd]', params: { cmd: r.name, course: 'aws' } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: r.kind === 'comando' ? fonts.monoBold : undefined, fontSize: 16, fontWeight: r.kind === 'comando' ? undefined : '700' }} color={col}>
                  {r.name}
                  <T v="tiny" color={colors.faint}>  {r.kind}</T>
                </T>
                <T v="small" color={colors.dim} numberOfLines={2}>{r.summary}</T>
              </View>
              <Chip label={LEVEL_LABEL[r.level]} color={levelColor(r.level)} />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
