import { describe, expect, test } from 'bun:test';
import type { StructuredPatch } from 'diff';
import { structuredPatch } from 'diff';

import { createDiffHunks, diffHunks, MAX_DIFF_SIDE_BYTES, MAX_DIFF_SIDE_LINES } from './diff-hunks';
import { toHunkData } from './git-hunk-adapter';

type Patch = typeof structuredPatch;

// `typeof structuredPatch` is overloaded; a plain test stub is cast once here.
const asPatch = (impl: (...args: never[]) => unknown): Patch => impl as Patch;

const EMPTY_PATCH: StructuredPatch = {
  oldFileName: '',
  newFileName: '',
  oldHeader: '',
  newHeader: '',
  hunks: [],
};

/** `count` lines `prefix0`…`prefix{count-1}` joined by `\n` with no trailing newline. */
function lines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n');
}

describe('factory validation', () => {
  test('numeric options must be positive finite integers', () => {
    expect(() => createDiffHunks({ memoEntries: 0 })).toThrow();
    expect(() => createDiffHunks({ memoEntries: -3 })).toThrow();
    expect(() => createDiffHunks({ memoEntries: 1.5 })).toThrow();
    expect(() => createDiffHunks({ memoEntries: Number.NaN })).toThrow();
    expect(() => createDiffHunks({ memoSourceCodeUnits: 0 })).toThrow();
    expect(() => createDiffHunks({ memoSourceCodeUnits: -1 })).toThrow();
    expect(() => createDiffHunks({ memoSourceCodeUnits: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => createDiffHunks({ memoEntries: 1, memoSourceCodeUnits: 1 })).not.toThrow();
  });
});

describe('byte bound', () => {
  test('ASCII sides at the exact byte limit are accepted', () => {
    const side = 'x'.repeat(MAX_DIFF_SIDE_BYTES);
    expect(diffHunks(side, side)).toEqual({ hunks: [], added: 0, deleted: 0 });
  });

  test('one code unit over the byte limit refuses before patch, on either side', () => {
    let calls = 0;
    const diff = createDiffHunks({
      patch: asPatch(() => {
        calls++;
        return EMPTY_PATCH;
      }),
    });
    expect(diff('x'.repeat(MAX_DIFF_SIDE_BYTES + 1), 'y')).toBeNull();
    expect(diff('y', 'x'.repeat(MAX_DIFF_SIDE_BYTES + 1))).toBeNull();
    expect(calls).toBe(0);
  });

  test('a multibyte side under the code-unit precheck but over UTF-8 is measured once per side and the refusal is cached', () => {
    const measured: string[] = [];
    const byteLength = (value: string): number => {
      measured.push(value);
      return new TextEncoder().encode(value).length;
    };
    // '€' is 1 UTF-16 code unit and 3 UTF-8 bytes: 22000 units pass the
    // .length precheck, 66000 bytes fail the measured check.
    const heavy = '€'.repeat(22_000);
    expect(heavy.length).toBeLessThanOrEqual(MAX_DIFF_SIDE_BYTES);
    const diff = createDiffHunks({ byteLength });
    expect(diff(heavy, 'a')).toBeNull();
    expect(diff(heavy, 'a')).toBeNull();
    expect(measured).toEqual([heavy, 'a']);
  });
});

describe('line bound', () => {
  test('exactly 2000 logical lines are accepted', () => {
    const before = lines('l', MAX_DIFF_SIDE_LINES);
    const after = before.replace('l0', 'X');
    expect(diffHunks(before, after)).not.toBeNull();
  });

  test('a trailing newline does not add a phantom line at the limit', () => {
    const side = `${lines('l', MAX_DIFF_SIDE_LINES)}\n`;
    let calls = 0;
    const diff = createDiffHunks({
      patch: asPatch(() => {
        calls++;
        return EMPTY_PATCH;
      }),
    });
    expect(diff(side, 'a')).not.toBeNull();
    expect(calls).toBe(1);
  });

  test('2001 logical lines refuse without patch, including the no-trailing-newline off-by-one', () => {
    let calls = 0;
    const diff = createDiffHunks({
      patch: asPatch(() => {
        calls++;
        return EMPTY_PATCH;
      }),
    });
    const withTrail = `${lines('l', MAX_DIFF_SIDE_LINES)}\nextra`;
    const noTrail = lines('l', MAX_DIFF_SIDE_LINES + 1);
    expect(diff(withTrail, 'a')).toBeNull();
    expect(diff('a', withTrail)).toBeNull();
    expect(diff(noTrail, 'a')).toBeNull();
    expect(diff('a', noTrail)).toBeNull();
    expect(calls).toBe(0);
  });
});

describe('edit bound', () => {
  test('a disjoint 1000-old/1000-new fixture is accepted at edit length 2000', () => {
    const result = diffHunks(lines('o', 1_000), lines('n', 1_000));
    expect(result).not.toBeNull();
    expect(result?.added).toBe(1_000);
    expect(result?.deleted).toBe(1_000);
  });

  test('1001-old/1000-new refuses at 2001 while both sides stay under the line and byte caps', () => {
    const before = lines('o', 1_001);
    const after = lines('n', 1_000);
    expect(before.length).toBeLessThanOrEqual(MAX_DIFF_SIDE_BYTES);
    expect(after.length).toBeLessThanOrEqual(MAX_DIFF_SIDE_BYTES);
    expect(diffHunks(before, after)).toBeNull();
  });

  test('an injected undefined patch result refuses and caches null', () => {
    let calls = 0;
    const diff = createDiffHunks({
      patch: asPatch(() => {
        calls++;
        return undefined;
      }),
    });
    expect(diff('a', 'b')).toBeNull();
    expect(diff('a', 'b')).toBeNull();
    expect(calls).toBe(1);
  });

  test('a thrown patch error returns and caches null', () => {
    let calls = 0;
    const diff = createDiffHunks({
      patch: asPatch(() => {
        calls++;
        throw new Error('boom');
      }),
    });
    expect(diff('a', 'b')).toBeNull();
    expect(diff('a', 'b')).toBeNull();
    expect(calls).toBe(1);
  });
});

describe('hunk conversion', () => {
  test('empty-to-content produces insert changes only', () => {
    const result = diffHunks('', 'a\nb');
    expect(result).not.toBeNull();
    expect(result?.added).toBe(2);
    expect(result?.deleted).toBe(0);
    const changes = result?.hunks[0]?.changes ?? [];
    expect(changes.map(change => change.type)).toEqual(['insert', 'insert']);
  });

  test('deletion-to-empty produces delete changes only', () => {
    const result = diffHunks('a\nb', '');
    expect(result).not.toBeNull();
    expect(result?.added).toBe(0);
    expect(result?.deleted).toBe(2);
    const changes = result?.hunks[0]?.changes ?? [];
    expect(changes.map(change => change.type)).toEqual(['delete', 'delete']);
  });

  test('identical sides produce an empty hunk list', () => {
    expect(diffHunks('a\nb', 'a\nb')).toEqual({ hunks: [], added: 0, deleted: 0 });
  });

  test('repeated content keeps jsdiff hunk/change order — deletes before inserts', () => {
    const before = `${'x\n'.repeat(50)}a\n${'x\n'.repeat(50)}`;
    const after = `${'x\n'.repeat(50)}b\n${'x\n'.repeat(50)}`;
    const result = diffHunks(before, after);
    expect(result).not.toBeNull();
    const types = (result?.hunks ?? []).flatMap(hunk => hunk.changes.map(change => change.type));
    expect(types).toContain('delete');
    expect(types).toContain('insert');
    expect(types.lastIndexOf('delete')).toBeLessThan(types.indexOf('insert'));
  });

  test('CRLF-vs-LF is a raw change: changed rows whose content differs only by the carriage return', () => {
    const result = diffHunks('a\nb', 'a\r\nb');
    expect(result).not.toBeNull();
    expect(result?.added).toBeGreaterThan(0);
    expect(result?.deleted).toBeGreaterThan(0);
  });

  test('mid-array and doubled no-newline markers advance neither counter', () => {
    // Both sides lack a trailing newline: jsdiff 9 emits the marker after the
    // delete and again after the insert — mid-array and twice in one hunk.
    const result = diffHunks('a\nb', 'a\nc');
    expect(result).not.toBeNull();
    const hunk = result?.hunks[0];
    expect(hunk?.header).toBe('@@ -1,2 +1,2 @@');
    expect(hunk?.changes.map(change => change.type)).toEqual(['normal', 'delete', 'insert']);
    const normal = hunk?.changes[0];
    const deleted = hunk?.changes[1];
    const inserted = hunk?.changes[2];
    if (normal?.type !== 'normal' || deleted?.type !== 'delete' || inserted?.type !== 'insert') {
      throw new Error('unexpected change order');
    }
    expect(normal.oldLine).toBe(1);
    expect(normal.newLine).toBe(1);
    expect(deleted.oldLine).toBe(2);
    expect(inserted.newLine).toBe(2);
  });

  test('two distant edits produce two hunks with deterministic synthesized headers', () => {
    const before = lines('l', 20);
    const after = before.replace('l2', 'X').replace('l17', 'Y');
    const result = diffHunks(before, after);
    expect(result?.hunks).toHaveLength(2);
    expect(result?.hunks[0]?.header).toBe('@@ -1,7 +1,7 @@');
    expect(result?.hunks[1]?.header).toBe('@@ -14,7 +14,7 @@');
  });

  test('every emitted line number is positive and toHunkData accepts every result', () => {
    const fixtures: [string, string][] = [
      ['', 'a\nb'],
      ['a\nb', ''],
      ['a\nb', 'a\nc'],
      ['a\nb', 'a\nc\nd'],
      [lines('o', 40), lines('o', 40).replace('o10', 'X').replace('o30', 'Y')],
      ['a\nb', 'a\r\nb'],
      ['same', 'same'],
    ];
    for (const [before, after] of fixtures) {
      const result = diffHunks(before, after);
      expect(result).not.toBeNull();
      for (const hunk of result?.hunks ?? []) {
        expect(() => toHunkData(hunk)).not.toThrow();
        for (const change of hunk.changes) {
          if (change.type === 'insert') expect(change.newLine).toBeGreaterThan(0);
          if (change.type === 'delete') expect(change.oldLine).toBeGreaterThan(0);
          if (change.type === 'normal') {
            expect(change.oldLine).toBeGreaterThan(0);
            expect(change.newLine).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe('display safety', () => {
  test('Cf controls, U+2028/U+2029, ANSI, C0/C1, and BOM cannot create hidden or fake display lines', () => {
    const hostile = [
      'bad',
      '\u{2028}', // LINE SEPARATOR
      '\u{200B}', // ZERO WIDTH SPACE
      '\u{FEFF}', // BOM
      '\u{202E}', // RIGHT-TO-LEFT OVERRIDE
      '\u{2066}', // LEFT-TO-RIGHT ISOLATE
      'end',
      '\u{0007}', // BEL (C0)
      'tail',
      '\u{001B}[31m', // ANSI colour sequence (ESC leader)
      '\u{0085}', // NEL (C1)
      '\u{009B}9z', // CSI (C1) — consumes through the next final byte
    ].join('');
    const result = diffHunks('a\nkeep', `a\n${hostile}`);
    const inserted = (result?.hunks ?? [])
      .flatMap(hunk => hunk.changes)
      .filter(change => change.type === 'insert');
    expect(inserted).toHaveLength(1);
    const content = inserted[0]?.content ?? '';
    for (const point of ['2028', '200B', 'FEFF', '202E', '2066']) {
      expect(content).toContain(`\\u{${point}}`);
    }
    expect(content).not.toMatch(/[\u{2028}\u{2029}\u{200B}\u{FEFF}\u{202E}\u{2066}]/u);
    expect(content).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/u);
    expect(content.length).toBeLessThanOrEqual(1_024);
  });

  test('escapes and the ellipsis stay inside the 1024-code-unit ceiling', () => {
    const result = diffHunks('', `a\n${'x'.repeat(1_020)}\u{200B}`);
    const escaped = (result?.hunks ?? [])
      .flatMap(hunk => hunk.changes)
      .find(change => change.type === 'insert' && change.content.includes('x'));
    expect(escaped?.content.endsWith('…')).toBe(true);
    expect(escaped?.content.length).toBeLessThanOrEqual(1_024);
    const long = diffHunks('', `a\n${'y'.repeat(2_000)}`);
    const truncated = (long?.hunks ?? [])
      .flatMap(hunk => hunk.changes)
      .find(change => change.type === 'insert' && change.content.includes('y'));
    expect(truncated?.content).toHaveLength(1_024);
    expect(truncated?.content.endsWith('…')).toBe(true);
  });
});

describe('memoization', () => {
  test('the same pair returns the identical result object and calls patch once', () => {
    let calls = 0;
    const diff = createDiffHunks({
      patch: asPatch(() => {
        calls++;
        return EMPTY_PATCH;
      }),
    });
    const first = diff('a', 'b');
    const second = diff('a', 'b');
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });

  test('a hit refreshes LRU order; count eviction recomputes only the evicted pair', () => {
    const calls: string[] = [];
    const diff = createDiffHunks({
      memoEntries: 2,
      patch: asPatch((_oldFile: string, _newFile: string, before: string) => {
        calls.push(before);
        return EMPTY_PATCH;
      }),
    });
    diff('A', 'x');
    diff('B', 'x');
    diff('A', 'x'); // hit — refresh, cache order becomes B, A
    diff('C', 'x'); // miss — evicts B
    expect(calls).toEqual(['A', 'B', 'C']);
    diff('A', 'x'); // still cached
    diff('B', 'x'); // evicted — recompute
    expect(calls).toEqual(['A', 'B', 'C', 'B']);
  });

  test('source-weight eviction recomputes only the evicted pair', () => {
    const calls: string[] = [];
    const diff = createDiffHunks({
      memoSourceCodeUnits: 10,
      patch: asPatch((_oldFile: string, _newFile: string, before: string) => {
        calls.push(before);
        return EMPTY_PATCH;
      }),
    });
    diff('12345', 'x'); // weight 6
    diff('abcdef', 'y'); // weight 7 — total 13 over budget, evicts '12345'
    expect(calls).toEqual(['12345', 'abcdef']);
    diff('abcdef', 'y'); // still cached
    diff('12345', 'x'); // evicted — recompute
    expect(calls).toEqual(['12345', 'abcdef', '12345']);
  });

  test('the singleton carries the declared bounds', () => {
    expect(diffHunks('x'.repeat(MAX_DIFF_SIDE_BYTES + 1), 'a')).toBeNull();
    expect(diffHunks('a', 'b')).not.toBeNull();
  });
});
