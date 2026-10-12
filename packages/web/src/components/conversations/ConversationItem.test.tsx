import { describe, expect, test } from 'bun:test';

import { shortActivityTime } from './ConversationItem';

describe('shortActivityTime', () => {
  const now = new Date(2026, 9, 12, 15, 30);

  test('shows the time for activity today', () => {
    const today = new Date(2026, 9, 12, 10, 3).toISOString();
    expect(shortActivityTime(today, now)).toMatch(/^10:03$/);
  });

  test('shows the weekday for activity this week', () => {
    const friday = new Date(2026, 9, 9, 9, 0).toISOString();
    const expected = new Date(2026, 9, 9).toLocaleDateString(undefined, { weekday: 'short' });
    expect(shortActivityTime(friday, now)).toBe(expected);
  });

  test('shows month and day for older activity', () => {
    const older = new Date(2026, 8, 29, 9, 0).toISOString();
    const expected = new Date(2026, 8, 29).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    expect(shortActivityTime(older, now)).toBe(expected);
  });

  test('returns empty text for an unreadable timestamp', () => {
    expect(shortActivityTime('not a date', now)).toBe('');
  });
});
