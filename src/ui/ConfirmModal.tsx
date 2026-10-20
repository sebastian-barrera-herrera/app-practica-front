import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button } from './Button';
import { T } from './Text';
import { colors, radius, makeStyles } from './theme';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Tercera acción opcional (p. ej. «Empezar de cero»). */
  extraLabel?: string;
  onExtra?: () => void;
}

export function ConfirmModal({ visible, title, message, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel, extraLabel, onExtra }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.box} onPress={() => {}}>
          <T v="h2">{title}</T>
          <T color={colors.dim}>{message}</T>
          <View style={{ gap: 10, marginTop: 8 }}>
            <Button label={confirmLabel} kind={danger ? 'danger' : 'primary'} onPress={onConfirm} />
            {extraLabel && onExtra ? <Button label={extraLabel} kind="secondary" onPress={onExtra} /> : null}
            <Button label={cancelLabel} kind="ghost" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = makeStyles(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,6,16,0.75)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 22, gap: 10, borderWidth: 1, borderColor: colors.line },
}));
