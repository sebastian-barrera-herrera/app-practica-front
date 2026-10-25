import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Terminal, restoreTerminal } from '@/engine';
import { useCourse, useGame } from '@/game/store';
import { openEditor } from '@/lib/editorBus';
import { useStudyContext } from '@/lib/studyClock';
import { Card } from '@/ui/Card';
import { ConfirmModal } from '@/ui/ConfirmModal';
import { CourseHeader, CourseSwitcher } from '@/ui/CourseSwitcher';
import { PyLab } from '@/ui/PyLab';
import { SqlLab } from '@/ui/SqlLab';
import { Screen } from '@/ui/Screen';
import { TerminalView } from '@/ui/TerminalView';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';

const IDEAS = [
  'ls -la ~  ·  mira tu carpeta personal',
  'cat /etc/passwd | cut -d: -f1  ·  lista usuarios',
  'ps aux | grep ssh  ·  busca procesos',
  'sudo apt install tree  ·  instala un paquete',
  'find / -name "*.log" 2>/dev/null  ·  busca logs',
  'ping -c2 example.com  ·  prueba la red',
  'history | tail  ·  tus últimos comandos',
];

/** La terminal libre vive mientras la app esté abierta; el estado se guarda en disco. */
let live: Terminal | null = null;

function build(): Terminal {
  const g = useGame.getState();
  const cols = g.settings.terminalCols;
  const snap = g.courses.linux.sandbox;
  const t = snap ? restoreTerminal(snap, { cols }) : new Terminal({ cols, lab: true });
  t.setEditor(openEditor);
  return t;
}

export default function LabTab() {
  const { course } = useCourse();
  if (course.lab.kind === 'sql') return <SqlLab />;
  return course.lab.kind === 'terminal' ? <TerminalLab /> : <PyLab />;
}

function TerminalLab() {
  const { course } = useCourse('linux');
  useStudyContext('linux');
  const [term, setTerm] = useState<Terminal>(() => (live ??= build()));
  const [confirm, setConfirm] = useState(false);
  const [ideas, setIdeas] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    try {
      useGame.getState().setSandbox('linux', term.snapshot());
    } catch {
      /* si el estado no se puede serializar, se conserva el anterior */
    }
  }, [term]);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 1500);
  }, [save]);

  useFocusEffect(
    useCallback(() => {
      return () => save();
    }, [save]),
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const reset = () => {
    useGame.getState().setSandbox('linux', null);
    live = null;
    live = build();
    setTerm(live);
    setConfirm(false);
  };

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 10 }}>
        <CourseSwitcher />
        <CourseHeader
          course={course}
          title="Terminal libre"
          subtitle="Tu laboratorio: rompe, borra, prueba. Todo es simulado."
          right={
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={() => setIdeas((v) => !v)} hitSlop={8} style={{ padding: 8 }} accessibilityLabel="Ideas">
                <T style={{ fontSize: 22 }}>💡</T>
              </Pressable>
              <Pressable onPress={() => setConfirm(true)} hitSlop={8} style={{ padding: 8 }} accessibilityLabel="Reiniciar laboratorio">
                <T style={{ fontSize: 22 }}>♻️</T>
              </Pressable>
            </View>
          }
        />
      </View>
      {ideas && (
        <Animated.View entering={FadeIn} style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Card pad={12} accent={colors.amber}>
            <T v="label" color={colors.amber}>Ideas para probar</T>
            {IDEAS.map((i) => (
              <T key={i} v="mono" style={{ fontSize: 12 }} color={colors.dim}>{i}</T>
            ))}
          </Card>
        </Animated.View>
      )}
      <View style={{ flex: 1 }}>
        <TerminalView
          key={String(live === term)}
          term={term}
          onRun={(line) => {
            useGame.getState().trackCommands('linux', [line], true);
            useGame.getState().checkAchievements();
            scheduleSave();
          }}
          onSignal={(sig) => {
            if (sig === 'INT') useGame.getState().bump('linux', { ctrlC: 1 });
          }}
          banner={['\x1b[2mLaboratorio con usuarios, procesos, servicios, red y paquetes. Prueba "help" o "man ls".\x1b[0m']}
        />
      </View>
      <ConfirmModal
        visible={confirm}
        title="¿Reiniciar el laboratorio?"
        message="Se borrarán tus archivos, usuarios, paquetes y el historial de esta terminal. Tu progreso y XP no cambian."
        confirmLabel="Reiniciar"
        danger
        onConfirm={reset}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}
