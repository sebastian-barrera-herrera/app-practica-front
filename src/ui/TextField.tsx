import React, { forwardRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { T } from './Text';
import { colors, fonts, radius } from './theme';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Muestra el botón «ver/ocultar» (para contraseñas). */
  password?: boolean;
}

/** Tipo de referencia de un campo de texto (para `focus()` al pulsar «siguiente»). */
export type InputRef = React.ComponentRef<typeof TextInput>;

export const TextField = forwardRef<InputRef, Props>(function TextField({ label, error, hint, password, ...rest }, ref) {
  const [show, setShow] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <T v="small" bold color={error ? colors.rose : colors.dim}>{label}</T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.card,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: error ? colors.rose : focus ? colors.mint : colors.line,
          paddingHorizontal: 14,
        }}
      >
        <TextInput
          ref={ref}
          {...rest}
          secureTextEntry={password && !show}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={colors.faint}
          style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 16, paddingVertical: 13, outlineStyle: 'none' } as object}
          accessibilityLabel={label}
        />
        {password ? (
          <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityLabel={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
            <T v="small" bold color={colors.mint}>{show ? 'Ocultar' : 'Ver'}</T>
          </Pressable>
        ) : null}
      </View>
      {error ? <T v="tiny" color={colors.rose}>{error}</T> : hint ? <T v="tiny" color={colors.faint}>{hint}</T> : null}
    </View>
  );
});
