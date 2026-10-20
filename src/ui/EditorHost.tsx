import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { registerEditorHost, type EditorRequest } from '@/lib/editorBus';
import { Button } from './Button';
import { KeyboardSafe } from './KeyboardSafe';
import { T } from './Text';
import { darkColors as colors, fonts, makeStyles } from './theme';

export function EditorHost() {
  const [req, setReq] = useState<EditorRequest | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const insets = useSafeAreaInsets();
  useEffect(() => {
    registerEditorHost((r) => {
      setReq(r);
      setText(r.content);
      setMsg('');
    });
    return () => registerEditorHost(null);
  }, []);
  if (!req) return null;
  const isVim = req.name === 'vim' || req.name === 'vi';
  const close = (save: boolean) => {
    req.resolve(save ? text : null);
    setReq(null);
  };
  const modified = text !== req.content;
  return (
    <Modal visible animationType="slide" onRequestClose={() => close(false)}>
      <View style={{ flex: 1, backgroundColor: colors.termBg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <KeyboardSafe>
        <View style={[styles.bar, { backgroundColor: isVim ? '#12301f' : '#1c2540' }]}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.termText}>
            {isVim ? 'VIM' : 'GNU nano 7.2'}  {req.path.split('/').pop()}
          </T>
          <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={modified ? colors.amber : colors.faint}>{modified ? 'Modificado' : ''}</T>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardAppearance="dark"
            selectionColor={colors.mint}
            style={{ flexGrow: 1, minHeight: 300, padding: 14, color: colors.termText, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21, textAlignVertical: 'top' }}
          />
        </ScrollView>
        {msg ? <T v="small" color={colors.cyan} style={{ paddingHorizontal: 14, paddingBottom: 6 }}>{msg}</T> : null}
        <View style={styles.help}>
          {isVim ? (
            <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.dim}>vim: edita el texto y usa «:wq» (guardar y salir) o «:q!» (salir sin guardar)</T>
          ) : (
            <T style={{ fontFamily: fonts.mono, fontSize: 12 }} color={colors.dim}>^O Guardar   ^X Salir   (en la app: usa los botones)</T>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" label={isVim ? ':q!  Descartar' : '^X  Descartar'} onPress={() => close(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button small label={isVim ? ':wq  Guardar y salir' : '^O  Guardar y salir'} onPress={() => close(true)} />
            </View>
          </View>
        </View>
      </KeyboardSafe>
      </View>
    </Modal>
  );
}

const styles = makeStyles(() => ({
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
  help: { padding: 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg2 },
}));
