/** Efectos de sonido dentro de la app (expo-audio). Falla en silencio donde no haya audio. */
import { Platform } from 'react-native';
import type { SoundId } from '@/game/progress';

type AudioMod = typeof import('expo-audio');
type Player = ReturnType<AudioMod['createAudioPlayer']>;

const SOURCES = {
  correct: require('../../assets/sounds/correct.wav'),
  wrong: require('../../assets/sounds/wrong.wav'),
  complete: require('../../assets/sounds/complete.wav'),
  levelup: require('../../assets/sounds/levelup.wav'),
  goal: require('../../assets/sounds/goal.wav'),
  campana: require('../../assets/sounds/campana.wav'),
  gota: require('../../assets/sounds/gota.wav'),
  zen: require('../../assets/sounds/zen.wav'),
  pulso: require('../../assets/sounds/pulso.wav'),
  arcade: require('../../assets/sounds/arcade.wav'),
} as const;

export type SfxName = 'correct' | 'wrong' | 'complete' | 'levelup' | 'goal';

let enabled = true;
let audio: AudioMod | null | undefined;
const players = new Map<string, Player>();

export const setSfxEnabled = (v: boolean) => {
  enabled = v;
};

async function load(): Promise<AudioMod | null> {
  if (audio !== undefined) return audio;
  try {
    audio = await import('expo-audio');
    // se mezcla con la música del usuario y respeta el modo silencio
    await audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  } catch {
    audio = null;
  }
  return audio;
}

async function play(name: keyof typeof SOURCES, volume = 1) {
  const A = await load();
  if (!A) return;
  try {
    let p = players.get(name);
    if (!p) {
      p = A.createAudioPlayer(SOURCES[name]);
      players.set(name, p);
    }
    p.volume = volume;
    await p.seekTo(0);
    p.play();
  } catch {
    /* nada */
  }
}

export function sfx(name: SfxName) {
  if (!enabled || Platform.OS === 'web') return;
  void play(name, name === 'wrong' ? 0.7 : 0.9);
}

/** Oye un tono de notificación (selector de sonidos). Suena aunque los efectos estén desactivados. */
export function previewSound(id: SoundId) {
  if (id === 'silencio') return;
  void play(id, 1);
}
