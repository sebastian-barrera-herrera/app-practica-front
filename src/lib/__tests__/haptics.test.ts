import * as Haptics from 'expo-haptics';
import { celebrate, error, select, setHaptics, success, tap, warn } from '../haptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const calls = () => (Haptics.impactAsync as jest.Mock).mock.calls.length + (Haptics.selectionAsync as jest.Mock).mock.calls.length;
const alerts = () => (Haptics.notificationAsync as jest.Mock).mock.calls.length;

beforeEach(() => jest.clearAllMocks());

describe('vibración', () => {
  it('con todo activado vibra al tocar y en los avisos', () => {
    setHaptics(true, true);
    tap();
    select();
    success();
    error();
    warn();
    celebrate();
    expect(calls()).toBe(2);
    expect(alerts()).toBe(4);
  });

  it('sin «al tocar» solo vibran los avisos de acierto, error y confeti', () => {
    setHaptics(true, false);
    tap();
    select();
    expect(calls()).toBe(0);
    success();
    error();
    celebrate();
    expect(alerts()).toBe(3);
  });

  it('con la vibración apagada no vibra nada, tenga el valor que tenga «al tocar»', () => {
    for (const touch of [true, false]) {
      setHaptics(false, touch);
      tap();
      select();
      success();
      error();
      warn();
      celebrate();
    }
    expect(calls() + alerts()).toBe(0);
  });
});
