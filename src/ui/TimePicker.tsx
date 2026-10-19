import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { select } from '@/lib/haptics';
import { Button } from './Button';
import { T } from './Text';
import { colors, radius } from './theme';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const p2 = (n: number) => String(n).padStart(2, '0');

/** Selector de hora «HH:MM» (24 h) en una hoja modal: rejilla de horas y de minutos. */
export function TimePicker({ visible, value, title = 'Elige la hora', onCancel, onConfirm }: { visible: boolean; value: string; title?: string; onCancel: () => void; onConfirm: (hhmm: string) => void }) {
  const [h, setH] = useState(8);
  const [m, setM] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const [hh, mm] = value.split(':').map(Number);
    setH(Number.isFinite(hh) ? hh : 8);
    setM(Number.isFinite(mm) ? Math.round(mm / 5) * 5 % 60 : 0);
  }, [visible, value]);

  const cell = (label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={() => {
        select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{ width: 52, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.mint : colors.card2, borderWidth: 1, borderColor: on ? colors.mint : colors.line }}
    >
      <T bold color={on ? '#04120D' : colors.text}>{label}</T>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(3,6,16,0.75)', justifyContent: 'center', padding: 20 }} onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: 20, gap: 14, borderWidth: 1, borderColor: colors.line, maxHeight: '90%' }}>
          <T v="h2">{title}</T>
          <T v="title" center color={colors.mint}>{p2(h)}:{p2(m)}</T>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <T v="label" color={colors.dim} style={{ marginBottom: 6 }}>Hora</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>{HOURS.map((x) => cell(p2(x), x === h, () => setH(x)))}</View>
            <T v="label" color={colors.dim} style={{ marginTop: 12, marginBottom: 6 }}>Minutos</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>{MINUTES.map((x) => cell(p2(x), x === m, () => setM(x)))}</View>
          </ScrollView>
          <View style={{ gap: 8 }}>
            <Button label="Guardar" onPress={() => onConfirm(`${p2(h)}:${p2(m)}`)} />
            <Button label="Cancelar" kind="ghost" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
