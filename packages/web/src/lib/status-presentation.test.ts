import { describe, expect, test } from 'bun:test';

import {
  getStatusPresentation,
  STATUS_TONE_SEGMENT_CLASS,
  STATUS_TONE_TEXT_CLASS,
} from './status-presentation';

describe('getStatusPresentation', () => {
  test.each([
    ['running', '▶', 'Running', 'running'],
    ['paused', '!', 'Awaiting you', 'waiting'],
    ['awaiting', '!', 'Awaiting you', 'waiting'],
    ['completed', '✓', 'Completed', 'done'],
    ['done', '✓', 'Done', 'done'],
    ['failed', '✕', 'Failed', 'failed'],
    ['pending', '○', 'Pending', 'pending'],
    ['skipped', '–', 'Skipped', 'pending'],
    ['cancelled', '–', 'Cancelled', 'pending'],
  ] as const)('%s maps to %s %s', (status, glyph, label, tone) => {
    expect(getStatusPresentation(status)).toEqual({ glyph, label, tone });
  });

  test('an unknown status reads as pending', () => {
    expect(getStatusPresentation('mystery')).toEqual({
      glyph: '○',
      label: 'Pending',
      tone: 'pending',
    });
  });

  test('an inherited object key is not a status', () => {
    expect(getStatusPresentation('constructor').tone).toBe('pending');
  });

  test('every tone has a text class and a segment class', () => {
    for (const tone of ['running', 'waiting', 'done', 'failed', 'pending'] as const) {
      expect(STATUS_TONE_TEXT_CLASS[tone]).toContain('text-');
      expect(STATUS_TONE_SEGMENT_CLASS[tone]).toContain('bg-');
    }
  });
});
