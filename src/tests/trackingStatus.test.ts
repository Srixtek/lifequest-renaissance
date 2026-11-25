import {
  deriveTrackingStatus,
  parseLogValue,
  statusFromLog,
  usesNumericLog,
} from '../domain/rules/trackingStatus';

describe('parseLogValue', () => {
  test('empty is not zero', () => {
    expect(parseLogValue('').ok).toBe(false);
    expect(parseLogValue('   ').ok).toBe(false);
  });

  test('accepts zero and decimals', () => {
    expect(parseLogValue('0')).toEqual({ ok: true, value: 0 });
    expect(parseLogValue('2,5')).toEqual({ ok: true, value: 2.5 });
  });

  test('rejects negative', () => {
    expect(parseLogValue('-1').ok).toBe(false);
  });
});

describe('deriveTrackingStatus', () => {
  test('limit: under target is success', () => {
    expect(deriveTrackingStatus('limit', 2, 5)).toBe('success');
    expect(deriveTrackingStatus('limit', 6, 5)).toBe('partial');
  });

  test('duration: partial progress below target', () => {
    expect(deriveTrackingStatus('duration', 15, 30)).toBe('partial');
    expect(deriveTrackingStatus('duration', 30, 30)).toBe('success');
    expect(deriveTrackingStatus('duration', 0, 30)).toBe('miss');
  });

  test('abstinence: zero is success, positive is miss', () => {
    expect(deriveTrackingStatus('abstinence', 0, null)).toBe('success');
    expect(deriveTrackingStatus('abstinence', 1, null)).toBe('miss');
  });
});

describe('mission templates kinds', () => {
  test('vape and alcohol use numeric limit', () => {
    expect(usesNumericLog('limit')).toBe(true);
    expect(usesNumericLog('habit')).toBe(false);
  });

  test('statusFromLog for reduce', () => {
    expect(statusFromLog({ kind: 'reduce' }, { targetValue: 1 } as any, 0)).toBe('success');
  });
});