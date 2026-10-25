import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { Category } from '@/engine';
import { CATEGORY_LABEL, levelColor, LEVEL_LABEL, libraryEntries } from '@/lib/library';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { PyLibrary } from '@/ui/PyLibrary';
import { SqlLibrary } from '@/ui/SqlLibrary';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';

export default function LibraryRoute() {
  const { course } = useLocalSearchParams<{ course?: string }>();
  if (course === 'sql') return <SqlLibrary />;
  return course === 'python' ? <PyLibrary /> : <Library />;
}

function Library() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | null>(null);
  const all = useMemo(libraryEntries, []);
  const cats = useMemo(() => [...new Set(all.map((e) => e.def.category))], [all]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter(({ def, aliases }) => {
      if (cat && def.category !== cat) return false;
      if (!t) return true;
      return def.name.includes(t) || aliases.some((a) => a.includes(t)) || def.summary.toLowerCase().includes(t);
    });
  }, [all, q, cat]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Biblioteca</T>
          <T v="tiny" color={colors.dim}>{all.length} comandos disponibles en el laboratorio</T>
        </View>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Buscar comando o palabra…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, color: colors.text, fontFamily: fonts.mono, fontSize: 15, paddingHorizontal: 16, paddingVertical: 12 }}
      />
      <View style={{ height: 58 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingVertical: 10 }}>
          <Chip label="Todos" active={cat === null} onPress={() => setCat(null)} />
          {cats.map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} color={colors.cyan} active={cat === c} onPress={() => setCat(cat === c ? null : c)} />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(e) => e.def.name}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 30 }}
        ListEmptyComponent={<T color={colors.dim} center style={{ marginTop: 30 }}>Nada coincide con «{q}».</T>}
        renderItem={({ item: { def, aliases } }) => (
          <Card pad={12} onPress={() => router.push({ pathname: '/library/[cmd]', params: { cmd: def.name } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 16 }} color={colors.mint}>
                  {def.name}
                  {aliases.length ? <T v="tiny" color={colors.faint}>  ({aliases.join(', ')})</T> : null}
                </T>
                <T v="small" color={colors.dim} numberOfLines={2}>{def.summary}</T>
              </View>
              {def.level ? <Chip label={LEVEL_LABEL[def.level]} color={levelColor(def.level)} /> : null}
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
