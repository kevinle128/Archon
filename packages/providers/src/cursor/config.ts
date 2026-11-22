import type { CursorProviderDefaults } from '../types';

export type { CursorProviderDefaults } from '../types';

export function parseCursorConfig(raw: Record<string, unknown>): CursorProviderDefaults {
  const result: CursorProviderDefaults = {};

  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || raw.model.trim().length === 0) {
      throw new Error('Invalid assistants.cursor.model: expected a non-empty string.');
    }
    result.model = raw.model;
  }

  return result;
}
