import { describe, expect, test } from 'bun:test';

import { parseOmpConfig } from './config';

describe('parseOmpConfig', () => {
  test('parses the supported OMP defaults', () => {
    expect(
      parseOmpConfig({
        model: 'openai-codex/gpt-6-sol',
        modelReasoningEffort: '  future-omp  ',
        ompBinaryPath: ' /opt/omp/bin/omp ',
        enableExtensions: true,
        ignored: 'value',
      })
    ).toEqual({
      model: 'openai-codex/gpt-6-sol',
      modelReasoningEffort: '  future-omp  ',
      ompBinaryPath: '/opt/omp/bin/omp',
      enableExtensions: true,
    });
  });

  test('rejects blank or non-string model fields', () => {
    expect(() => parseOmpConfig({ model: '   ' })).toThrow('assistants.omp.model');
    expect(() => parseOmpConfig({ ompBinaryPath: 42 })).toThrow('assistants.omp.ompBinaryPath');
  });

  test('preserves non-empty provider-owned effort exactly', () => {
    expect(parseOmpConfig({ modelReasoningEffort: '  future-omp  ' })).toEqual({
      modelReasoningEffort: '  future-omp  ',
    });
    expect(() => parseOmpConfig({ modelReasoningEffort: '' })).toThrow('non-empty string');
  });

  test('rejects non-boolean extension opt-in', () => {
    expect(() => parseOmpConfig({ enableExtensions: 'yes' })).toThrow(
      'assistants.omp.enableExtensions'
    );
  });
});
