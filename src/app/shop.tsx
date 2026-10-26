import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { balance, boostActive, COINS, levelReward, owned } from '@/game/economy';
import { canBuy, MAX_SHIELDS, SHOP } from '@/game/shop';
import { useGame } from '@/game/store';
import { success, warn } from '@/lib/haptics';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Screen } from '@/ui/Screen';
import { showToast } from '@/ui/Toast';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const EARN: [string, string][] = [
  ['📘', `Terminar una lección: 🪙 ${COINS.lessonFirst(1)} a ${COINS.lessonFirst(3)} (según las estrellas)`],
  ['🧩', `Resolver un reto práctico por primera vez: 🪙 ${COINS.challenge}`],
  ['🔁', 'Terminar un repaso: 🪙 1 por acierto (hasta 10)'],
  ['⏱️', `Cumplir la meta diaria de un curso: 🪙 ${COINS.goal}`],
  ['📝', `Aprobar un examen de zona: 🪙 ${COINS.examPass} · de salto: 🪙 ${COINS.skipPass} · certificación: 🪙 ${COINS.certPass}`],
  ['🎯', 'Misiones diarias: 🪙 10, 15 y 25 (+30 si completas las tres)'],
  ['🏅', 'Cada logro desbloqueado da monedas'],
  ['⭐', `Subir de nivel: 🪙 ${levelReward(2)} y más cuanto más subes`],
  ['🥋', 'Las monedas se acumulan: ahorra para los avatares épicos y legendarios'],
];

function minutesLeft(until: number, now: number) {
  const m = Math.max(0, Math.ceil((until - now) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export default function Shop() {
  const root = useGame();
  const [now, setNow] = useState(Date.now());
  const coins = balance(root.xp, root.extras);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);
  const boosting = boostActive(root.extras, now);
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Volver"><T style={{ fontSize: 22 }} color={colors.dim}>←</T></Pressable>
        <View style={{ flex: 1 }}>
          <T v="h1">Tienda</T>
          <T v="tiny" color={colors.dim}>Gasta tus monedas en ventajas</T>
        </View>
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.amber + '22', borderWidth: 1.5, borderColor: colors.amber }} accessibilityLabel={`${coins} monedas`}>
          <T bold color={colors.amber}>🪙 {coins.toLocaleString('es')}</T>
        </View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
        {boosting && (
          <Card accent={colors.amber}>
            <T bold color={colors.amber}>⚡ XP doble activo · quedan {minutesLeft(root.extras.boostUntil, now)}</T>
            <T v="small" color={colors.dim}>Todo el XP que ganes ahora vale el doble.</T>
          </Card>
        )}
        <Card accent={colors.violet}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar size={70} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="h3">Personaliza tu perfil</T>
              <T v="small" color={colors.dim}>Avatares, marcos, fondos y accesorios: de comunes a legendarios.</T>
            </View>
          </View>
          <Button style={{ marginTop: 12 }} label="Ver avatares y accesorios" onPress={() => router.push('/avatar')} />
        </Card>
        {SHOP.map((item) => {
          const can = canBuy(root, item.id);
          const have = item.id === 'shield' ? root.streak.freezes : item.id === 'pass' ? owned(root.extras, 'pass') : undefined;
          return (
            <Card key={item.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.amber + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontSize: 30 }}>{item.emoji}</T>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="h3">{item.title}</T>
                  <T v="small" color={colors.dim}>{item.desc}</T>
                  {have !== undefined ? <T v="tiny" bold color={colors.cyan}>Tienes {have}{item.id === 'shield' ? ` de ${MAX_SHIELDS}` : ''}</T> : null}
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <Button
                  label={`Comprar · 🪙 ${item.price}`}
                  kind={can.ok ? 'primary' : 'secondary'}
                  disabled={!can.ok}
                  onPress={() => {
                    const r = useGame.getState().buyItem(item.id);
                    if (r.ok) {
                      success();
                      showToast({ emoji: item.emoji, title: `${item.title} conseguido`, body: item.id === 'boost' ? 'Ya está activo: ¡a por todo!' : undefined, color: colors.amber, ms: 2400 });
                    } else warn();
                  }}
                />
                {!can.ok ? <T v="tiny" color={colors.faint} style={{ marginTop: 6 }}>{can.reason}</T> : null}
              </View>
            </Card>
          );
        })}
        <Card>
          <T v="h3">Cómo ganar monedas</T>
          <View style={{ gap: 8, marginTop: 10 }}>
            {EARN.map(([e, t]) => (
              <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <T style={{ fontSize: 20 }}>{e}</T>
                <T v="small" style={{ flex: 1 }}>{t}</T>
              </View>
            ))}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
