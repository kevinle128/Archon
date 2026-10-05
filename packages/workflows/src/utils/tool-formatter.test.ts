import { describe, expect, test } from 'bun:test';
import { formatThinking, formatToolCall } from './tool-formatter';

describe('tool-formatter', () => {
  describe('formatToolCall', () => {
    describe('Bash tool', () => {
      test('formats a short command with the running glyph and no redundant state badge', () => {
        const result = formatToolCall('Bash', { command: 'npm test' });
        expect(result).toBe('◐ [Bash] npm test');
      });

      test('a long single-line command is shown in full — elision belongs to the renderer, not this resolver', () => {
        const longCommand = 'a'.repeat(120);
        const result = formatToolCall('Bash', { command: longCommand });
        expect(result).toBe(`◐ [Bash] ${longCommand}`);
      });

      test('an exact-100-char command survives unmodified', () => {
        const exactCommand = 'a'.repeat(100);
        const result = formatToolCall('Bash', { command: exactCommand });
        expect(result).toBe(`◐ [Bash] ${exactCommand}`);
      });
    });

    describe('Read tool', () => {
      test('formats the file path as the headline, family file', () => {
        const result = formatToolCall('Read', { file_path: '/path/to/file.ts' });
        expect(result).toBe('◐ [Read] /path/to/file.ts');
      });
    });

    describe('Write tool', () => {
      test('formats the file path as the headline, family file', () => {
        const result = formatToolCall('Write', { file_path: '/path/to/file.ts' });
        expect(result).toBe('◐ [Write] /path/to/file.ts');
      });
    });

    describe('Edit tool', () => {
      test('formats the file path as the headline, family file', () => {
        const result = formatToolCall('Edit', { file_path: '/path/to/file.ts' });
        expect(result).toBe('◐ [Edit] /path/to/file.ts');
      });
    });

    describe('Glob tool', () => {
      test('formats the pattern as the headline, family glob', () => {
        const result = formatToolCall('Glob', { pattern: '**/*.ts' });
        expect(result).toBe('◐ [Glob] **/*.ts');
      });
    });

    describe('Grep tool', () => {
      test('formats the pattern as the headline, family search', () => {
        const result = formatToolCall('Grep', { pattern: 'TODO' });
        expect(result).toBe('◐ [Grep] TODO');
      });
    });

    describe('MCP tools', () => {
      test('a well-formed mcp__server__tool name resolves the server · tool label; a scalar input field still leads the headline', () => {
        const result = formatToolCall('mcp__github__create_issue', { title: 'test' });
        expect(result).toBe('◐ [github · create_issue] title: test');
      });

      test('a two-token mcp__tool name has no second separator, so it is not a qualifying MCP shape and degrades to generic', () => {
        const result = formatToolCall('mcp__tool', { arg: 'value' });
        expect(result).toBe('◐ [mcp__tool] arg: value');
      });
    });

    describe('unknown tools', () => {
      test('an unrecognized tool shows its scalar input fields as key: value text, never a JSON dump', () => {
        const result = formatToolCall('CustomTool', { arg: 'value' });
        expect(result).toBe('◐ [CustomTool] arg: value');
        expect(result).not.toContain('{"');
      });

      test('a long scalar value is truncated at 80 code points with an ellipsis, never mid-JSON', () => {
        const longValue = 'x'.repeat(100);
        const result = formatToolCall('CustomTool', { arg: longValue });
        expect(result).toBe(`◐ [CustomTool] arg: ${'x'.repeat(80)}…`);
        expect(result).not.toContain('{"');
      });
    });

    describe('no toolInput', () => {
      test('falls back to the tool name as both chip and headline when toolInput is undefined', () => {
        const result = formatToolCall('SomeTool');
        expect(result).toBe('◐ [SomeTool] SomeTool');
      });

      test('falls back the same way when toolInput is explicitly undefined', () => {
        const result = formatToolCall('SomeTool', undefined);
        expect(result).toBe('◐ [SomeTool] SomeTool');
      });
    });

    describe('empty toolInput', () => {
      test('an empty object carries no scalar fact, so it falls back the same way as no input at all', () => {
        const result = formatToolCall('SomeTool', {});
        expect(result).toBe('◐ [SomeTool] SomeTool');
      });
    });
  });

  describe('formatThinking', () => {
    test('formats thinking under 200 chars', () => {
      const thinking = 'I need to analyze this code';
      const result = formatThinking(thinking);
      expect(result).toBe(`💭 ${thinking}`);
    });

    test('formats thinking at exactly 200 chars', () => {
      const thinking = 'a'.repeat(200);
      const result = formatThinking(thinking);
      expect(result).toBe(`💭 ${thinking}`);
    });

    test('truncates thinking over 200 chars', () => {
      const thinking = 'a'.repeat(250);
      const result = formatThinking(thinking);
      expect(result).toBe(`💭 ${'a'.repeat(200)}...`);
    });

    test('handles empty string', () => {
      const result = formatThinking('');
      expect(result).toBe('💭 ');
    });
  });
});
