import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';

const NODES = [
  { p: '/', depth: 0, desc: 'La raíz: de aquí cuelga absolutamente todo.', emoji: '🌳' },
  { p: 'bin', depth: 1, desc: 'Programas esenciales (ls, cp, cat…). Hoy es un enlace a /usr/bin.', emoji: '⚙️' },
  { p: 'etc', depth: 1, desc: 'Archivos de configuración del sistema (usuarios, red, servicios).', emoji: '🔧' },
  { p: 'home', depth: 1, desc: 'Las carpetas personales de los usuarios. Aquí vive todo lo tuyo.', emoji: '🏠' },
  { p: 'alumno', depth: 2, desc: 'Tu carpeta personal (~). Aquí empiezas cada sesión.', emoji: '🧑', you: true },
  { p: 'tmp', depth: 1, desc: 'Archivos temporales: se borran al reiniciar. Todos pueden escribir.', emoji: '🗑️' },
  { p: 'usr', depth: 1, desc: 'Programas, librerías y documentación instalados.', emoji: '📦' },
  { p: 'var', depth: 1, desc: 'Datos que cambian: logs (/var/log), cachés, colas de correo.', emoji: '📈' },
  { p: 'root', depth: 1, desc: 'La casa del superusuario (root). No es /home/root.', emoji: '👑' },
  { p: 'dev', depth: 1, desc: 'Dispositivos como archivos: discos, terminal, /dev/null.', emoji: '🔌' },
  { p: 'proc', depth: 1, desc: 'Ventana virtual al kernel y a los procesos en marcha.', emoji: '🧠' },
];

export function FsTree() {
  const [sel, setSel] = useState(3);
  const n = NODES[sel];
  return (
    <Frame title="El árbol de directorios">
      <View style={{ gap: 4 }}>
        {NODES.map((x, i) => (
          <Animated.View key={i} entering={FadeInLeft.delay(i * 40).duration(260)}>
            <Pressable onPress={() => { tap(); setSel(i); }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: x.depth * 22, paddingVertical: 5, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: sel === i ? colors.cyan + '22' : 'transparent', borderWidth: 1, borderColor: sel === i ? colors.cyan : 'transparent' }}>
                {x.depth > 0 && <T style={{ fontFamily: fonts.mono }} color={colors.faint}>{'└─ '}</T>}
                <T style={{ marginRight: 6 }}>{x.emoji}</T>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 15 }} color={x.you ? colors.mint : colors.cyan}>{x.p === '/' ? '/' : x.p + '/'}</T>
                {x.you && <T v="tiny" color={colors.mint} style={{ marginLeft: 8 }}>← estás aquí</T>}
              </View>
            </Pressable>
          </Animated.View>
        ))}
      </View>
      <View style={{ backgroundColor: colors.bg2, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }}>
        <T v="small" color={colors.text}><T v="small" bold color={colors.cyan}>{n.p === '/' ? '/' : '/' + (n.depth === 2 ? 'home/' : '') + n.p}</T> — {n.desc}</T>
      </View>
    </Frame>
  );
}
