import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { balance } from '@/game/economy';
import { canBuyCosmetic, collection, COSMETICS, cosmeticsOf, hasCosmetic, KIND_LABEL, RARITY, resolveLook, type CosKind, type Cosmetic } from '@/game/cosmetics';
import { useGame } from '@/game/store';
import { select, success, warn } from '@/lib/haptics';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Screen } from '@/ui/Screen';
import { showToast } from '@/ui/Toast';
import { T } from '@/ui/Text';
import { colors, ink, radius } from '@/ui/theme';

const KINDS: CosKind[] = ['avatar', 'frame', 'bg', 'acc'];

function Tile({ c, kind, equipped, have, selected, onPress }: { c: Cosmetic; kind: CosKind; equipped: boolean; have: boolean; selected: boolean; onPress: () => void }) {
  const rc = RARITY[c.rarity].color;
  const look = { [kind]: c.id };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${c.name}. ${RARITY[c.rarity].label}. ${equipped ? 'Puesto' : have ? 'Tuyo' : `Cuesta ${c.price} monedas`}`}
      style={{ width: '31.5%', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.lg, borderWidth: selected ? 2.5 : 1.5, borderColor: selected ? rc : colors.line, backgroundColor: selected ? rc + '1F' : colors.card }}
    >
      <View style={{ opacity: have ? 1 : 0.55 }}>
        <Avatar size={62} look={look} animated={false} />
      </View>
      <T v="tiny" bold center numberOfLines={1} style={{ maxWidth: '100%' }}>{c.name}</T>
      <T v="tiny" bold center color={equipped ? colors.mint : have ? colors.dim : colors.amber}>{equipped ? '✓ Puesto' : have ? 'Tuyo' : `🪙 ${c.price}`}</T>
      <View style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: rc }} />
    </Pressable>
  );
}

export default function AvatarScreen() {
  const root = useGame();
  const look = resolveLook(root.extras);
  const coins = balance(root.xp, root.extras);
  const [kind, setKind] = useState<CosKind>('avatar');
  const [picked, setPicked] = useState<Partial<Record<CosKind, string>>>({});
  const list = cosmeticsOf(kind);
  const selId = picked[kind] ?? look[kind];
  const sel = list.find((c) => c.id === selId) ?? list[0];
  const have = hasCosmetic(root.extras, sel);
  const equipped = look[kind] === sel.id;
  const can = canBuyCosmetic(root, sel);
  const rc = RARITY[sel.rarity].color;
  // lo que se ve arriba: tu aspecto actual con el objeto elegido puesto (aunque aún no sea tuyo)
  const preview = { ...look, [kind]: sel.id };

  const act = () => {
    const g = useGame.getState();
    if (have) {
      const r = g.equipCosmetic(kind, sel.id);
      if (r.ok) select();
      return;
    }
    const b = g.buyCosmetic(kind, sel.id);
    if (!b.ok) {
      warn();
      return;
    }
    g.equipCosmetic(kind, sel.id);
    success();
    showToast({ emoji: sel.emoji, title: `${sel.name} conseguido`, body: `Ya lo llevas puesto`, color: colors.amber, ms: 2400 });
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Mi avatar</T>
          <T v="tiny" color={colors.dim}>Compra y combina avatares, marcos, fondos y accesorios</T>
        </View>
        <Pressable onPress={() => router.push('/shop')} accessibilityRole="button" accessibilityLabel={`${coins} monedas. Abrir la tienda`} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.amber + '22', borderWidth: 1.5, borderColor: colors.amber }}>
          <T bold color={colors.amber}>🪙 {coins.toLocaleString('es')}</T>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
        <Card elevated accent={rc}>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Avatar size={150} look={preview} mood="cool" />
            <View style={{ alignItems: 'center', gap: 2 }}>
              <T v="h3">{sel.name}</T>
              <T v="tiny" bold color={rc}>{RARITY[sel.rarity].label.toUpperCase()} · {KIND_LABEL[kind].one.toUpperCase()}</T>
              <T v="small" color={colors.dim} center>{sel.desc}</T>
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            {equipped ? (
              <Button label="✓ Puesto" kind="secondary" disabled onPress={() => undefined} />
            ) : have ? (
              <Button label={`Ponerme ${KIND_LABEL[kind].one === 'avatar' ? 'este avatar' : `este ${KIND_LABEL[kind].one}`}`} onPress={act} />
            ) : (
              <Button label={`Comprar y ponerme · 🪙 ${sel.price}`} kind={can.ok ? 'primary' : 'secondary'} disabled={!can.ok} onPress={act} />
            )}
            {!have && !can.ok ? <T v="tiny" color={colors.faint} center style={{ marginTop: 6 }}>{can.reason}. Gana monedas con lecciones, retos, misiones y exámenes.</T> : null}
          </View>
        </Card>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {KINDS.map((k) => {
            const on = k === kind;
            const col = collection(root.extras, k);
            return (
              <Pressable
                key={k}
                onPress={() => { select(); setKind(k); }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${KIND_LABEL[k].title}, ${col.have} de ${col.total}`}
                style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.violet : colors.line, backgroundColor: on ? colors.violet + '22' : colors.card }}
              >
                <T style={{ fontSize: 20 }}>{KIND_LABEL[k].emoji}</T>
                <T v="tiny" bold color={on ? ink(colors.violet) : colors.dim} numberOfLines={1}>{KIND_LABEL[k].title}</T>
                <T v="tiny" color={colors.faint}>{col.have}/{col.total}</T>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
          {list.map((c) => (
            <Tile key={c.id} c={c} kind={kind} equipped={look[kind] === c.id} have={hasCosmetic(root.extras, c)} selected={sel.id === c.id} onPress={() => { select(); setPicked({ ...picked, [kind]: c.id }); }} />
          ))}
        </View>
        <T v="tiny" color={colors.faint} center>{COSMETICS.length} objetos · cuanto más raro, más brilla</T>
      </ScrollView>
    </Screen>
  );
}
