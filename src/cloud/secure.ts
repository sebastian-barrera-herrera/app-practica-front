/** Almacén para el token de sesión: SecureStore en el móvil, AsyncStorage en web. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = 'devdojo.session.v1';

export interface StoredSession {
  name: string;
  value: string;
}

export async function saveSession(s: StoredSession | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (s) await AsyncStorage.setItem(KEY, JSON.stringify(s));
      else await AsyncStorage.removeItem(KEY);
      return;
    }
    const SS = await import('expo-secure-store');
    if (s) await SS.setItemAsync(KEY, JSON.stringify(s));
    else await SS.deleteItemAsync(KEY);
  } catch {
    /* nada */
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = Platform.OS === 'web' ? await AsyncStorage.getItem(KEY) : await (await import('expo-secure-store')).getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}
