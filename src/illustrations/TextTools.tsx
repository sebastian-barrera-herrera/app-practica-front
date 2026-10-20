import React, { useEffect, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, ZoomIn } from 'react-native-reanimated';
import { select, tap } from '@/lib/haptics';
import { OnDark, T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Caption, Chips, Frame, MonoBox, TapLines, TapParts, type Part } from './common';

// ───────────────────────── ls -l ─────────────────────────

const LS_PARTS: Part[] = [
  { t: '-', get color() { return colors.faint; }, title: 'Tipo de elemento', desc: '«-» archivo normal · «d» directorio · «l» enlace simbólico.' },
  { t: 'rwx', get color() { return colors.mint; }, title: 'Permisos del DUEÑO', desc: 'r leer (4) + w escribir (2) + x ejecutar (1) = 7. El dueño puede todo.' },
  { t: 'r-x', get color() { return colors.cyan; }, title: 'Permisos del GRUPO', desc: 'Leer y ejecutar, pero no escribir: 4 + 0 + 1 = 5.' },
  { t: 'r--', get color() { return colors.rose; }, title: 'Permisos de OTROS', desc: 'Todos los demás solo pueden leer: 4. En conjunto, este archivo es 754.' },
  { t: ' 1', get color() { return colors.faint; }, title: 'Enlaces', desc: 'Número de nombres (enlaces duros) que apuntan a este archivo. Casi siempre 1.' },
  { t: ' alumno', get color() { return colors.mint; }, title: 'Usuario propietario', desc: 'El dueño del archivo. Solo él (o root) puede cambiar sus permisos.' },
  { t: ' devs', get color() { return colors.cyan; }, title: 'Grupo propietario', desc: 'El grupo al que se aplican los permisos de la segunda tripleta.' },
  { t: ' 220', get color() { return colors.amber; }, title: 'Tamaño', desc: 'En bytes. Con ls -lh se muestra legible: 220, 4.0K, 2.3M…' },
  { t: ' Mar 11 10:02', get color() { return colors.violet; }, title: 'Última modificación', desc: 'Fecha y hora del último cambio del contenido. ls -lt ordena por esta columna.' },
  { t: ' script.sh', get color() { return colors.text; }, title: 'Nombre', desc: 'Lo único que realmente ves en un gestor de archivos… aquí es la última columna.' },
];

export function LsLong() {
  return (
    <Frame title="Toca cada columna de ls -l">
      <TapParts parts={LS_PARTS} size={15} prefix="$ ls -l script.sh" />
    </Frame>
  );
}

// ───────────────────────── anatomía de un script ─────────────────────────

const SCRIPT_PARTS: Part[] = [
  { t: '#!/bin/bash', get color() { return colors.amber; }, title: 'Shebang', desc: 'Primera línea: indica con qué intérprete se ejecuta el archivo.' },
  { t: '# Copia de seguridad', get color() { return colors.faint; }, title: 'Comentario', desc: 'Todo lo que sigue a # se ignora. Documenta qué hace el script.' },
  { t: 'origen="$1"', get color() { return colors.mint; }, title: 'Variable y argumento', desc: '$1 es el primer argumento con el que se lanzó el script. Se guarda en «origen» (sin espacios alrededor del =).' },
  { t: 'if [ ! -d "$origen" ]; then', get color() { return colors.violet; }, title: 'Condición', desc: 'Si «origen» NO (!) es un directorio (-d)… Los corchetes necesitan espacios dentro.' },
  { t: '  echo "No existe $origen"; exit 1', get color() { return colors.rose; }, title: 'Salir con error', desc: 'Muestra un aviso y termina con código 1 (distinto de 0 = error).' },
  { t: 'fi', get color() { return colors.violet; }, title: 'Fin del if', desc: '«fi» es «if» al revés: cierra la condición.' },
  { t: 'for f in "$origen"/*.txt; do', get color() { return colors.cyan; }, title: 'Bucle', desc: 'Recorre cada archivo .txt de la carpeta, guardándolo en «f» en cada vuelta.' },
  { t: '  cp "$f" /tmp/backup/', get color() { return colors.text; }, title: 'Comando', desc: 'El cuerpo del bucle: copia cada archivo. Las comillas protegen nombres con espacios.' },
  { t: 'done', get color() { return colors.cyan; }, title: 'Fin del bucle', desc: 'Cierra el for (do … done).' },
  { t: 'exit 0', get color() { return colors.green; }, title: 'Código de salida', desc: '0 = éxito. Quien lance tu script (otro script, cron…) lee este código con $?.' },
];

export function ScriptAnatomy() {
  return (
    <Frame title="Anatomía de un script · toca una línea">
      <TapLines parts={SCRIPT_PARTS} size={13} />
    </Frame>
  );
}

// ───────────────────────── awk ─────────────────────────

const AWK_SAMPLES = {
  sp: { text: 'Ana 25 Madrid', fs: ' ', cmdPrefix: 'awk', fields: ['Ana', '25', 'Madrid'] },
  csv: { text: 'Ana,25,Madrid', fs: ',', cmdPrefix: 'awk -F,', fields: ['Ana', '25', 'Madrid'] },
} as const;

export function AwkFields() {
  const [kind, setKind] = useState<'sp' | 'csv'>('sp');
  const [sel, setSel] = useState<'$0' | '$1' | '$2' | '$3' | '$NF'>('$1');
  const s = AWK_SAMPLES[kind];
  const val = sel === '$0' ? s.text : sel === '$NF' ? s.fields[2] : s.fields[parseInt(sel.slice(1), 10) - 1];
  const items: ('$0' | '$1' | '$2' | '$3' | '$NF')[] = ['$1', '$2', '$3', '$NF', '$0'];
  return (
    <Frame title="Cómo awk trocea una línea">
      <Chips items={[{ id: 'sp' as const, label: 'separado por espacios' }, { id: 'csv' as const, label: 'CSV con -F,' }]} value={kind} onChange={setKind} color={colors.cyan} />
      <MonoBox size={18}>{s.text}</MonoBox>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {s.fields.map((f, i) => {
          const on = sel === (`$${i + 1}` as typeof sel) || (sel === '$NF' && i === 2) || sel === '$0';
          return (
            <Pressable key={i} style={{ flex: 1 }} onPress={() => { tap(); setSel(`$${i + 1}` as typeof sel); }}>
              <View style={{ borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.mint : colors.line, backgroundColor: on ? colors.mintSoft : colors.card2, padding: 8, alignItems: 'center' }}>
                <T style={{ fontFamily: fonts.monoBold, fontSize: 15 }} color={colors.mint}>{`$${i + 1}`}</T>
                <T v="small" bold>{f}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Chips items={items.map((x) => ({ id: x, label: x }))} value={sel} onChange={setSel} color={colors.mint} />
      <MonoBox color={colors.dim}>
        {`$ echo "${s.text}" | ${s.cmdPrefix} '{print ${sel}}'`}
      </MonoBox>
      <Animated.View key={kind + sel} entering={FadeInDown.duration(200)}>
        <MonoBox color={colors.mint} size={16}>{val}</MonoBox>
      </Animated.View>
      <Caption>NF = 3 (número de campos) · $NF = último campo · $0 = la línea entera.</Caption>
    </Frame>
  );
}

// ───────────────────────── expresiones regulares ─────────────────────────

interface RegexDemo {
  id: string;
  label: string;
  pattern: string;
  flags?: string;
  text: string;
  desc: string;
  ere?: boolean;
}
const REGEX: RegexDemo[] = [
  { id: 'caret', label: '^', pattern: '^ERROR', text: 'ERROR disco lleno\nINFO arranque\nERROR sin red\nrevisar ERROR en medio', desc: '^ ancla al INICIO de la línea: la última línea no coincide.' },
  { id: 'dollar', label: '$', pattern: 'com$', text: 'ana@correo.com\ncom.es\nluis@mail.org\nmarta@x.com', desc: '$ ancla al FINAL de la línea.' },
  { id: 'dot', label: '.', pattern: 'a.c', text: 'abc a1c ac a-c aXXc', desc: '. es UN carácter cualquiera (pero uno): «ac» y «aXXc» no coinciden.' },
  { id: 'class', label: '[ ]', pattern: '[aeiou]', text: 'linux dojo', desc: '[aeiou] es UNO de esos caracteres (aquí, las vocales).' },
  { id: 'range', label: '[0-9]', pattern: '[0-9]', text: 'tel 612 345 678', desc: '[0-9] es un dígito cualquiera. También [a-z], [A-Z]…' },
  { id: 'star', label: '*', pattern: 'ab*', text: 'a ab abb abbb b', desc: '* es «cero o más» de lo anterior: ab* = una a seguida de cero o más b.' },
  { id: 'plus', label: '+', pattern: '[0-9]+', text: 'tel 612 345 678', desc: '+ es «uno o más» (con grep -E): [0-9]+ captura números enteros completos.', ere: true },
  { id: 'rep', label: '{n}', pattern: '[0-9]{3}', text: '6123456 78 9012', desc: '{3} = exactamente tres veces (con grep -E).', ere: true },
  { id: 'alt', label: '|', pattern: 'ana|luis', text: 'ana luis marta pedro ana', desc: '| significa «o» (con grep -E).', ere: true },
];

function Highlighted({ text, re }: { text: string; re: RegExp }) {
  const lines = text.split('\n');
  return (
    <View style={{ gap: 2 }}>
      {lines.map((line, li) => {
        const parts: { s: string; hit: boolean }[] = [];
        let last = 0;
        const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m: RegExpExecArray | null;
        while ((m = r.exec(line)) !== null) {
          if (m[0] === '') {
            r.lastIndex++;
            continue;
          }
          if (m.index > last) parts.push({ s: line.slice(last, m.index), hit: false });
          parts.push({ s: m[0], hit: true });
          last = m.index + m[0].length;
        }
        if (last < line.length) parts.push({ s: line.slice(last), hit: false });
        return (
          <View key={li} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {parts.length === 0 ? <T style={{ fontFamily: fonts.mono, fontSize: 15 }}> </T> : null}
            {parts.map((p, i) => (
              <T key={i} style={{ fontFamily: p.hit ? fonts.monoBold : fonts.mono, fontSize: 15, backgroundColor: p.hit ? colors.mint + '55' : 'transparent' }} color={p.hit ? colors.green : colors.dim}>{p.s}</T>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export function RegexCheat() {
  const [id, setId] = useState('caret');
  const d = REGEX.find((x) => x.id === id)!;
  const re = new RegExp(d.pattern, 'gm');
  return (
    <Frame title="Chuleta de regex · toca un símbolo">
      <Chips items={REGEX.map((r) => ({ id: r.id, label: r.label }))} value={id} onChange={setId} color={colors.violet} />
      <MonoBox color={colors.amber}>{`grep ${d.ere ? '-E ' : ''}"${d.pattern}" archivo`}</MonoBox>
      <Animated.View key={id} entering={FadeIn.duration(200)} style={{ backgroundColor: colors.termBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line }}>
        <OnDark>
          <Highlighted text={d.text} re={re} />
        </OnDark>
      </Animated.View>
      <Caption color={colors.text}>{d.desc}</Caption>
    </Frame>
  );
}

// ───────────────────────── globbing ─────────────────────────

const FILES = ['a.txt', 'b.txt', 'foto1.jpg', 'foto2.jpg', 'foto10.jpg', 'logo.png', 'notas.md'];
const GLOBS = [
  { id: '*.txt', label: '*.txt', note: '* = cualquier cosa. Todos los que terminan en .txt.' },
  { id: 'foto?.jpg', label: 'foto?.jpg', note: '? = exactamente UN carácter: foto10.jpg tiene dos y no coincide.' },
  { id: 'foto[12].jpg', label: 'foto[12].jpg', note: '[12] = un carácter de ese conjunto: foto1 o foto2.' },
  { id: '*.jpg', label: '*.jpg', note: 'Todos los jpg, incluida foto10.jpg.' },
  { id: '*', label: '*', note: 'Todo lo que hay en la carpeta.' },
];

function globToRe(g: string): RegExp {
  let r = '^';
  for (const ch of g) {
    if (ch === '*') r += '.*';
    else if (ch === '?') r += '.';
    else if ('.+^$(){}|\\'.includes(ch)) r += '\\' + ch;
    else r += ch;
  }
  return new RegExp(r + '$');
}

export function GlobExpansion() {
  const [g, setG] = useState('*.txt');
  const re = globToRe(g);
  const hits = FILES.filter((f) => re.test(f));
  const note = GLOBS.find((x) => x.id === g)!.note;
  return (
    <Frame title="Así se expande un comodín">
      <Chips items={GLOBS.map((x) => ({ id: x.id, label: x.label }))} value={g} onChange={setG} color={colors.amber} />
      <MonoBox color={colors.amber}>{`$ ls ${g}`}</MonoBox>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FILES.map((f) => {
          const on = re.test(f);
          return (
            <Animated.View key={f + g} entering={ZoomIn.duration(220)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 2, borderColor: on ? colors.mint : colors.line, backgroundColor: on ? colors.mintSoft : colors.card2, opacity: on ? 1 : 0.45 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={on ? colors.mint : colors.dim}>{f}</T>
            </Animated.View>
          );
        })}
      </View>
      <T v="tiny" color={colors.dim}>La shell sustituye el patrón ANTES de ejecutar el comando:</T>
      <MonoBox color={colors.mint}>{`$ ls ${hits.length ? hits.join(' ') : g}`}</MonoBox>
      <Caption>{note}</Caption>
    </Frame>
  );
}

// ───────────────────────── permisos rwx ─────────────────────────

const WHO = [
  { id: 'u', label: 'Dueño', get color() { return colors.mint; } },
  { id: 'g', label: 'Grupo', get color() { return colors.cyan; } },
  { id: 'o', label: 'Otros', get color() { return colors.rose; } },
];
const BITS = ['r', 'w', 'x'] as const;
const VAL = { r: 4, w: 2, x: 1 } as const;

export function PermBits() {
  const [m, setM] = useState<boolean[][]>([[true, true, true], [true, false, true], [true, false, false]]);
  const toggle = (r: number, c: number) => setM((old) => old.map((row, i) => (i === r ? row.map((v, j) => (j === c ? !v : v)) : row)));
  const digits = m.map((row) => row.reduce((n, on, j) => n + (on ? VAL[BITS[j]] : 0), 0));
  const sym = m.map((row) => row.map((on, j) => (on ? BITS[j] : '-')).join('')).join('');
  const preset = (o: string) => setM(o.split('').map((d) => BITS.map((b) => (parseInt(d, 10) & VAL[b]) !== 0)));
  return (
    <Frame title="Construye los permisos · toca los bits">
      <View style={{ gap: 8 }}>
        {WHO.map((w, r) => (
          <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="small" bold color={w.color} style={{ width: 54 }}>{w.label}</T>
            {BITS.map((b, c) => {
              const on = m[r][c];
              return (
                <Pressable key={b} onPress={() => { select(); toggle(r, c); }} style={{ flex: 1 }}>
                  <View style={{ height: 44, borderRadius: 12, borderWidth: 2, borderColor: on ? w.color : colors.line, backgroundColor: on ? w.color + '2E' : colors.card2, alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ fontFamily: fonts.monoBold, fontSize: 18 }} color={on ? w.color : colors.faint}>{on ? b : '-'}</T>
                    <T style={{ fontSize: 9, lineHeight: 10 }} color={colors.faint}>{VAL[b]}</T>
                  </View>
                </Pressable>
              );
            })}
            <View style={{ width: 28, alignItems: 'center' }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 20 }} color={w.color}>{digits[r]}</T>
            </View>
          </View>
        ))}
      </View>
      <MonoBox color={colors.mint} size={16}>{`-${sym}  →  chmod ${digits.join('')} archivo`}</MonoBox>
      <Chips items={['644', '755', '600', '700', '777'].map((x) => ({ id: x, label: x }))} value={digits.join('')} onChange={preset} color={colors.amber} />
      <Caption>r = 4, w = 2, x = 1. Se suman por cada grupo: rwx = 7, r-x = 5, r-- = 4.</Caption>
    </Frame>
  );
}

// ───────────────────────── streams ─────────────────────────

interface Scenario {
  id: string;
  label: string;
  cmd: string;
  stdin: [string, string];
  stdout: [string, string];
  stderr: [string, string];
  note: string;
}
const SCENARIOS: Scenario[] = [
  { id: 'normal', label: 'normal', cmd: 'ls /etc /nada', stdin: ['⌨️', 'teclado'], stdout: ['🖥️', 'pantalla'], stderr: ['🖥️', 'pantalla'], note: 'Por defecto: entra el teclado, salen resultados y errores a la pantalla.' },
  { id: 'out', label: '> out.txt', cmd: 'ls /etc /nada > out.txt', stdin: ['⌨️', 'teclado'], stdout: ['📄', 'out.txt'], stderr: ['🖥️', 'pantalla'], note: '> redirige SOLO stdout. El error sigue saliendo por pantalla.' },
  { id: 'err', label: '2> err.txt', cmd: 'ls /etc /nada 2> err.txt', stdin: ['⌨️', 'teclado'], stdout: ['🖥️', 'pantalla'], stderr: ['📄', 'err.txt'], note: '2> redirige SOLO stderr: los errores a un archivo, los resultados a pantalla.' },
  { id: 'in', label: '< in.txt', cmd: 'wc -l < in.txt', stdin: ['📄', 'in.txt'], stdout: ['🖥️', 'pantalla'], stderr: ['🖥️', 'pantalla'], note: '< hace que el comando LEA de un archivo en vez del teclado.' },
  { id: 'both', label: '2>&1', cmd: 'ls /etc /nada > todo.txt 2>&1', stdin: ['⌨️', 'teclado'], stdout: ['📄', 'todo.txt'], stderr: ['📄', 'todo.txt'], note: '2>&1 manda stderr al mismo sitio que stdout: todo en un archivo.' },
  { id: 'null', label: '2> /dev/null', cmd: 'ls /etc /nada 2> /dev/null', stdin: ['⌨️', 'teclado'], stdout: ['🖥️', 'pantalla'], stderr: ['🕳️', '/dev/null'], note: '/dev/null es un agujero negro: lo que se envía allí desaparece.' },
];

export function Streams() {
  const [id, setId] = useState('normal');
  const s = SCENARIOS.find((x) => x.id === id)!;
  const rows: { name: string; n: number; color: string; dest: [string, string]; dir: 'in' | 'out' }[] = [
    { name: 'stdin', n: 0, color: colors.mint, dest: s.stdin, dir: 'in' },
    { name: 'stdout', n: 1, color: colors.cyan, dest: s.stdout, dir: 'out' },
    { name: 'stderr', n: 2, color: colors.rose, dest: s.stderr, dir: 'out' },
  ];
  return (
    <Frame title="Los tres canales de un comando">
      <Chips items={SCENARIOS.map((x) => ({ id: x.id, label: x.label }))} value={id} onChange={setId} color={colors.violet} />
      <MonoBox color={colors.amber}>{`$ ${s.cmd}`}</MonoBox>
      <View style={{ gap: 8 }}>
        {rows.map((r) => (
          <Animated.View key={r.name + id} entering={FadeIn.duration(250)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 70 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={r.color}>{r.name}</T>
              <T v="tiny" color={colors.faint}>canal {r.n}</T>
            </View>
            {r.dir === 'in' ? (
              <>
                <DestPill dest={r.dest} color={r.color} />
                <T color={r.color} bold>{'──▶'}</T>
                <View style={{ flex: 1, height: 40, borderRadius: 10, borderWidth: 2, borderColor: colors.amber, backgroundColor: colors.amber + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <T v="tiny" bold color={colors.amber}>comando</T>
                </View>
              </>
            ) : (
              <>
                <View style={{ flex: 1, height: 40, borderRadius: 10, borderWidth: 2, borderColor: colors.amber, backgroundColor: colors.amber + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <T v="tiny" bold color={colors.amber}>comando</T>
                </View>
                <T color={r.color} bold>{'──▶'}</T>
                <DestPill dest={r.dest} color={r.color} />
              </>
            )}
          </Animated.View>
        ))}
      </View>
      <Caption>{s.note}</Caption>
    </Frame>
  );
}

function DestPill({ dest, color }: { dest: [string, string]; color: string }) {
  return (
    <View style={{ width: 104, height: 40, borderRadius: 10, borderWidth: 2, borderColor: color, backgroundColor: color + '1F', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <T style={{ fontSize: 15 }}>{dest[0]}</T>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 11 }} color={color} numberOfLines={1}>{dest[1]}</T>
    </View>
  );
}

// ───────────────────────── pipes ─────────────────────────

const STAGES = [
  { cmd: 'ls /etc', lines: ['passwd', 'hosts', 'host.conf', 'fstab', 'resolv.conf', 'nsswitch.conf'], get color() { return colors.mint; } },
  { cmd: 'grep conf', lines: ['host.conf', 'resolv.conf', 'nsswitch.conf'], get color() { return colors.cyan; } },
  { cmd: 'wc -l', lines: ['3'], get color() { return colors.amber; } },
];

function Packet({ t, phase, x0, w, color }: { t: { value: number }; phase: number; x0: number; w: number; color: string }) {
  const st = useAnimatedStyle(() => {
    const k = (t.value + phase) % 1;
    return { transform: [{ translateX: x0 + k * w }], opacity: k < 0.08 || k > 0.92 ? 0.2 : 1 };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 13, width: 10, height: 10, borderRadius: 5, backgroundColor: color }, st]} />;
}

export function PipeFlow() {
  const [W, setW] = useState(300);
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1);
  }, [t]);
  const pipeW = 32;
  const boxW = (W - pipeW * 2) / 3;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return (
    <Frame title="Datos que fluyen por una tubería">
      <MonoBox color={colors.amber}>$ ls /etc | grep conf | wc -l</MonoBox>
      <View onLayout={onLayout}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {STAGES.map((s, i) => (
            <React.Fragment key={s.cmd}>
              <View style={{ width: boxW }}>
                <View style={{ height: 36, borderRadius: 10, borderWidth: 2, borderColor: s.color, backgroundColor: s.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontFamily: fonts.monoBold, fontSize: 11 }} color={s.color} numberOfLines={1}>{s.cmd}</T>
                </View>
                <View style={{ marginTop: 22, gap: 2 }}>
                  {s.lines.map((l) => (
                    <T key={l} style={{ fontFamily: fonts.mono, fontSize: 11 }} color={s.color} numberOfLines={1}>{l}</T>
                  ))}
                </View>
              </View>
              {i < STAGES.length - 1 && (
                <View style={{ width: pipeW, height: 36, justifyContent: 'center' }}>
                  <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 4 }} />
                  <T style={{ position: 'absolute', alignSelf: 'center', top: 0, fontFamily: fonts.monoBold, fontSize: 18 }} color={colors.faint}>|</T>
                </View>
              )}
            </React.Fragment>
          ))}
        </View>
        {[0, 0.33, 0.66].map((p) => (
          <Packet key={'a' + p} t={t} phase={p} x0={boxW - 2} w={pipeW - 6} color={colors.mint} />
        ))}
        {[0.15, 0.55].map((p) => (
          <Packet key={'b' + p} t={t} phase={p} x0={boxW * 2 + pipeW - 2} w={pipeW - 6} color={colors.cyan} />
        ))}
      </View>
      <Caption>La salida de cada comando entra directamente en el siguiente. ls produce 6 líneas, grep se queda con 3 y wc las cuenta: 3.</Caption>
    </Frame>
  );
}

// ───────────────────────── grep ─────────────────────────

const LOG = [
  '10:00 INFO servidor iniciado',
  '10:01 WARN disco al 85%',
  '10:02 ERROR sin conexión a la BD',
  '10:03 INFO reintentando',
  '10:04 ERROR tiempo de espera',
  '10:05 INFO conexión establecida',
  '10:06 error archivo no encontrado',
];
const GREP: { id: string; label: string; test: (l: string) => boolean }[] = [
  { id: 'e', label: 'grep ERROR', test: (l) => l.includes('ERROR') },
  { id: 'i', label: 'grep -i error', test: (l) => l.toLowerCase().includes('error') },
  { id: 'v', label: 'grep -v INFO', test: (l) => !l.includes('INFO') },
];

export function GrepScan() {
  const [id, setId] = useState('e');
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [id]);
  useEffect(() => {
    const iv = setInterval(() => setIdx((x) => (x >= LOG.length + 2 ? 0 : x + 1)), 520);
    return () => clearInterval(iv);
  }, []);
  const g = GREP.find((x) => x.id === id)!;
  const found = LOG.filter((l, i) => i < idx && g.test(l));
  return (
    <Frame title="grep recorre línea a línea">
      <Chips items={GREP.map((x) => ({ id: x.id, label: x.label }))} value={id} onChange={setId} color={colors.orange} />
      <View style={{ backgroundColor: colors.termBg, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 8 }}>
        <OnDark>
        {LOG.map((l, i) => {
          const seen = i < idx;
          const hit = seen && g.test(l);
          const scanning = i === idx;
          return (
            <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 2, backgroundColor: hit ? colors.green + '26' : scanning ? colors.amber + '2A' : 'transparent', borderLeftWidth: 3, borderLeftColor: hit ? colors.green : scanning ? colors.amber : 'transparent' }}>
              <T style={{ fontFamily: fonts.mono, fontSize: 12, opacity: seen && !hit ? 0.5 : 1 }} color={hit ? colors.green : colors.dim} numberOfLines={1}>{l}</T>
            </View>
          );
        })}
        </OnDark>
      </View>
      <View style={{ gap: 2 }}>
        <T v="label" color={colors.dim}>Salida ({found.length})</T>
        <MonoBox color={colors.green} size={12}>{found.length ? found.join('\n') : '…'}</MonoBox>
      </View>
      <Caption>Solo pasan las líneas que cumplen el patrón. -i ignora mayúsculas y -v invierte la selección.</Caption>
    </Frame>
  );
}

// ───────────────────────── código de salida ─────────────────────────

const STATUS = [
  { id: 'a', cmd: 'ls /etc', code: 0, note: 'El comando funcionó.' },
  { id: 'b', cmd: 'ls /nada', code: 2, note: 'Error: no existe esa ruta.' },
  { id: 'c', cmd: 'grep -q root /etc/passwd', code: 0, note: 'grep encontró el patrón.' },
  { id: 'd', cmd: 'grep -q zzz /etc/passwd', code: 1, note: 'grep no encontró nada (1 no siempre es un «error»).' },
];

export function ExitStatus() {
  const [id, setId] = useState('a');
  const s = STATUS.find((x) => x.id === id)!;
  const ok = s.code === 0;
  return (
    <Frame title="Todo comando termina con un código">
      <Chips items={STATUS.map((x) => ({ id: x.id, label: x.cmd.length > 14 ? x.cmd.slice(0, 13) + '…' : x.cmd }))} value={id} onChange={setId} color={colors.cyan} />
      <MonoBox color={colors.amber}>{`$ ${s.cmd}\n$ echo $?`}</MonoBox>
      <Animated.View key={id} entering={ZoomIn.duration(240)} style={{ alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, borderWidth: 2, borderColor: ok ? colors.green : colors.rose, backgroundColor: (ok ? colors.green : colors.rose) + '22', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 28 }} color={ok ? colors.green : colors.rose}>{s.code}</T>
        <T v="small" color={colors.text} style={{ maxWidth: 200 }}>{ok ? 'Éxito' : 'Fallo'} · {s.note}</T>
      </Animated.View>
      <View style={{ gap: 8 }}>
        <Branch cmd={`${s.cmd} && echo OK`} runs={ok} label="&& → solo si el código es 0" />
        <Branch cmd={`${s.cmd} || echo FALLÓ`} runs={!ok} label="|| → solo si el código NO es 0" />
      </View>
      <Caption>0 = éxito; cualquier otro número = fallo. if, while, && y || deciden según este código.</Caption>
    </Frame>
  );
}

function Branch({ cmd, runs, label }: { cmd: string; runs: boolean; label: string }) {
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: runs ? colors.green : colors.line, backgroundColor: runs ? colors.green + '14' : colors.card2, padding: 8, gap: 2, opacity: runs ? 1 : 0.6 }}>
      <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim} numberOfLines={1}>{cmd}</T>
      <T v="tiny" bold color={runs ? colors.green : colors.faint}>{runs ? '✔ se ejecuta' : '✘ se omite'} · {label}</T>
    </View>
  );
}

// ───────────────────────── variables de entorno ─────────────────────────

export function EnvInherit() {
  const [exported, setExported] = useState(false);
  const [childEdit, setChildEdit] = useState(false);
  const childVars = [
    ['HOME', '/home/alumno'],
    ['PATH', '/usr/bin:…'],
    ...(exported ? [['idioma', childEdit ? 'en' : 'es']] : []),
  ];
  return (
    <Frame title="La herencia de variables">
      <Chips items={[{ id: 'local', label: 'idioma="es"' }, { id: 'exp', label: 'export idioma="es"' }]} value={exported ? 'exp' : 'local'} onChange={(v) => setExported(v === 'exp')} color={colors.green} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, borderRadius: 12, borderWidth: 2, borderColor: colors.violet, backgroundColor: colors.violet + '14', padding: 10, gap: 3 }}>
          <T v="tiny" bold color={colors.violet}>🐚 bash (padre)</T>
          {[['nombre', 'Ana', false], ['idioma', 'es', true], ['HOME', '/home/alumno', true], ['PATH', '/usr/bin:…', true]].map(([k, v, exp]) => (
            <T key={k as string} style={{ fontFamily: fonts.mono, fontSize: 11 }} color={(k === 'idioma' ? exported : (exp as boolean)) ? colors.text : colors.faint}>
              {k}={v as string}
              {(k === 'idioma' ? exported : (exp as boolean)) ? '  ⬆' : ''}
            </T>
          ))}
        </View>
        <View style={{ justifyContent: 'center' }}>
          <T color={colors.amber} bold>{'▶'}</T>
          <T v="tiny" color={colors.faint}>copia</T>
        </View>
        <View style={{ flex: 1, borderRadius: 12, borderWidth: 2, borderColor: colors.cyan, backgroundColor: colors.cyan + '14', padding: 10, gap: 3 }}>
          <T v="tiny" bold color={colors.cyan}>🐣 bash -c (hijo)</T>
          {childVars.map(([k, v]) => (
            <Animated.View key={k + v} entering={FadeIn.duration(250)}>
              <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.text}>{k}={v}</T>
            </Animated.View>
          ))}
          <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.faint}>nombre=∅</T>
          {!exported && <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.faint}>idioma=∅</T>}
        </View>
      </View>
      {exported && (
        <Pressable onPress={() => { tap(); setChildEdit((v) => !v); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.line }}>
          <T v="tiny" bold color={colors.cyan}>{childEdit ? '↺ deshacer' : 'El hijo cambia idioma="en"'}</T>
        </Pressable>
      )}
      <Caption>
        {exported
          ? childEdit
            ? 'El hijo modificó su COPIA; el padre sigue con idioma=es. Los cambios nunca suben al padre.'
            : 'Con export, la variable pasa a los procesos que lances. Solo se copian las exportadas.'
          : 'Sin export, la variable es solo de esta shell: el proceso hijo no la ve.'}
      </Caption>
    </Frame>
  );
}
