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

type LabCourse = 'linux' | 'aws';

const IDEAS: Record<LabCourse, string[]> = {
  linux: [
  'ls -la ~  ·  mira tu carpeta personal',
  'cat /etc/passwd | cut -d: -f1  ·  lista usuarios',
  'ps aux | grep ssh  ·  busca procesos',
  'sudo apt install tree  ·  instala un paquete',
  'find / -name "*.log" 2>/dev/null  ·  busca logs',
  'ping -c2 example.com  ·  prueba la red',
  'history | tail  ·  tus últimos comandos',
  ],
  aws: [
    'aws sts get-caller-identity  ·  ¿quién eres para AWS?',
    'aws s3 ls  ·  tus buckets',
    'aws iam list-users --output table  ·  usuarios en una tabla',
    'aws ec2 describe-regions --query "Regions[].RegionName" --output text',
    'aws s3 mb s3://mi-nube-2026  ·  crea un bucket (el nombre es único en el mundo)',
    'aws --profile ana s3 ls  ·  actúa como otro usuario y mira qué le deniegan',
    'aws iam simulate-principal-policy --policy-source-arn <arn> --action-names s3:GetObject',
  ],
};

const AWS_LAB_FILES = {
  '/home/alumno/politica.json': JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::informes-empresa', 'arn:aws:s3:::informes-empresa/*'] }] }, null, 2) + '\n',
  '/home/alumno/index.html': '<!doctype html>\n<html><body><h1>Mi sitio en S3</h1></body></html>\n',
  '/home/alumno/informe.txt': 'Ventas del trimestre: 1250 unidades\n',
  '/home/alumno/fotos/gato.jpg': { content: 'JPEGDATA', size: 482113 },
  '/home/alumno/fotos/perro.jpg': { content: 'JPEGDATA', size: 311240 },
};

/** Las terminales libres viven mientras la app esté abierta; el estado se guarda en disco. */
const live: Record<LabCourse, Terminal | null> = { linux: null, aws: null };

function build(id: LabCourse): Terminal {
  const g = useGame.getState();
  const cols = g.settings.terminalCols;
  const snap = g.courses[id].sandbox;
  const fresh = () => (id === 'aws' ? new Terminal({ cols, aws: { scenario: 'equipo' }, files: AWS_LAB_FILES, hostname: 'aws-lab' }) : new Terminal({ cols, lab: true }));
  const t = snap ? restoreTerminal(snap, { cols }) : fresh();
  t.setEditor(openEditor);
  return t;
}

export default function LabTab() {
  const { course } = useCourse();
  if (course.lab.kind === 'sql') return <SqlLab />;
  if (course.lab.kind === 'aws') return <TerminalLab id="aws" />;
  return course.lab.kind === 'terminal' ? <TerminalLab id="linux" /> : <PyLab />;
}

function TerminalLab({ id }: { id: LabCourse }) {
  const { course } = useCourse(id);
  useStudyContext(id);
  const [term, setTerm] = useState<Terminal>(() => (live[id] ??= build(id)));
  const [confirm, setConfirm] = useState(false);
  const [ideas, setIdeas] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    try {
      useGame.getState().setSandbox(id, term.snapshot());
    } catch {
      /* si el estado no se puede serializar, se conserva el anterior */
    }
  }, [term, id]);

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
    useGame.getState().setSandbox(id, null);
    live[id] = null;
    live[id] = build(id);
    setTerm(live[id]!);
    setConfirm(false);
  };

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 10 }}>
        <CourseSwitcher />
        <CourseHeader
          course={course}
          title={id === 'aws' ? 'Consola AWS' : 'Terminal libre'}
          subtitle={id === 'aws' ? 'Tu cuenta de AWS de prueba: crea, rompe y borra sin pagar nada.' : 'Tu laboratorio: rompe, borra, prueba. Todo es simulado.'}
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
            {IDEAS[id].map((i) => (
              <T key={i} v="mono" style={{ fontSize: 12 }} color={colors.dim}>{i}</T>
            ))}
          </Card>
        </Animated.View>
      )}
      <View style={{ flex: 1 }}>
        <TerminalView
          key={String(live[id] === term)}
          term={term}
          onRun={(line) => {
            useGame.getState().trackCommands(id, [line], true);
            useGame.getState().checkAchievements();
            scheduleSave();
          }}
          onSignal={(sig) => {
            if (sig === 'INT') useGame.getState().bump(id, { ctrlC: 1 });
          }}
          banner={[id === 'aws' ? '\x1b[2mCuenta de AWS simulada (equipo de prueba). Prueba "aws help" o "aws sts get-caller-identity".\x1b[0m' : '\x1b[2mLaboratorio con usuarios, procesos, servicios, red y paquetes. Prueba "help" o "man ls".\x1b[0m']}
        />
      </View>
      <ConfirmModal
        visible={confirm}
        title="¿Reiniciar el laboratorio?"
        message={id === 'aws' ? 'Se borrará la cuenta de prueba (usuarios, buckets, servidores) y el historial de esta terminal. Tu progreso y XP no cambian.' : 'Se borrarán tus archivos, usuarios, paquetes y el historial de esta terminal. Tu progreso y XP no cambian.'}
        confirmLabel="Reiniciar"
        danger
        onConfirm={reset}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}
