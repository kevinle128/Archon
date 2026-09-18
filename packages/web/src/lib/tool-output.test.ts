import { describe, expect, test } from 'bun:test';

import {
  MAX_FIELD_KEYS_SCANNED,
  MAX_FIELD_KEY_CODE_UNITS,
  MAX_FIELD_VALUE_CODE_UNITS,
  MAX_JSON_PARSE_CODE_UNITS,
  MAX_LIST_ITEM_TEXT_CODE_UNITS,
  MAX_LIST_ITEMS,
  MAX_OUTPUT_FIELDS,
  MAX_OUTPUT_TEXT_CODE_UNITS,
  MAX_SANITIZE_SCAN_CODE_UNITS,
  MAX_SALVAGE_SCAN_CODE_UNITS,
  normalizeToolOutput,
} from './tool-output';

const ESC = '\u001b';
const BEL = '\u0007';
const ST = '\u001b\\';

function normalize(output: unknown): ReturnType<typeof normalizeToolOutput> {
  return normalizeToolOutput(output);
}

describe('terminal text channels', () => {
  test('claude Bash JSON string yields stdout text', () => {
    const output = JSON.stringify({ stdout: 'hello\nworld', stderr: '', interrupted: false });
    const normalized = normalize(output);
    expect(normalized.text).toBe('hello\nworld');
    expect(normalized.unreadable).toBe(false);
  });

  test('stdout plus non-empty stderr append in order', () => {
    const normalized = normalize({ stdout: 'out', stderr: 'err' });
    expect(normalized.text).toBe('out\nerr');
  });

  test('empty stderr contributes nothing', () => {
    const normalized = normalize({ stdout: 'only', stderr: '' });
    expect(normalized.text).toBe('only');
  });

  test('devin byte array decodes as utf-8', () => {
    const bytes = [104, 105, 226, 128, 166]; // "hi…"
    const normalized = normalize({ output: bytes });
    expect(normalized.text).toBe('hi…');
    expect(normalized.unreadable).toBe(false);
  });

  test('devin byte array survives serialized JSON', () => {
    const normalized = normalize(JSON.stringify({ output: [116, 101, 115, 116] }));
    expect(normalized.text).toBe('test');
  });

  test('invalid byte values never decode or coerce', () => {
    for (const output of [
      { output: [256] },
      { output: [-1] },
      { output: [1.5] },
      { output: [72, 300] },
    ]) {
      const normalized = normalize(output);
      expect(normalized.text).toBeNull();
      expect(normalized.unreadable).toBe(true);
    }
  });

  test('non-number array elements are not a byte array at all', () => {
    const normalized = normalize({ output: ['a', 'b'] });
    expect(normalized.text).toBeNull();
    expect(normalized.unreadable).toBe(false);
    expect(normalized.fields).toContainEqual({ key: 'output', value: '[2]' });
  });

  test('codex plain text output is bounded text', () => {
    const normalized = normalize('total 164\ndrwxr-xr-x  12 user  staff   384 Sep 18');
    expect(normalized.text).toContain('total 164');
    expect(normalized.unreadable).toBe(false);
  });
});

describe('ansi and control stripping', () => {
  test('CSI color sequences are stripped inline', () => {
    const normalized = normalize(`ok ${ESC}[31mred${ESC}[0m done`);
    expect(normalized.text).toBe('ok red done');
  });

  test('OSC-8 hyperlinks strip sequences but keep link text', () => {
    const normalized = normalize(
      `see ${ESC}]8;;https://example.com${BEL}the site${ESC}]8;;${BEL}!`
    );
    expect(normalized.text).toBe('see the site!');
  });

  test('OSC terminated by ST is stripped', () => {
    const normalized = normalize(`a${ESC}]8;;https://x${ST}tail`);
    expect(normalized.text).toBe('atail');
  });

  test('charset and other escape sequences are stripped', () => {
    const normalized = normalize(`a${ESC}(Bb`);
    expect(normalized.text).toBe('ab');
  });

  test('control characters drop but newline and tab survive', () => {
    const normalized = normalize('a\rb\nc\td\u007fe\u0007f\u0001');
    expect(normalized.text).toBe('ab\nc\tdef');
  });

  test('discarded controls and unterminated escapes cannot make sanitization scan an unbounded tail', () => {
    const controls = '\u0001'.repeat(MAX_SANITIZE_SCAN_CODE_UNITS + 1);
    const normalizedControls = normalize(controls);
    expect(normalizedControls.text).toBeNull();
    expect(normalizedControls.textTruncated).toBe(true);

    const unterminatedOsc = `${ESC}]8;;${'x'.repeat(MAX_SANITIZE_SCAN_CODE_UNITS + 1)}`;
    const normalizedOsc = normalize(unterminatedOsc);
    expect(normalizedOsc.text).toBeNull();
    expect(normalizedOsc.textTruncated).toBe(true);
  });
});

describe('json string handling', () => {
  test('json object string parses and exposes channels', () => {
    const normalized = normalize('{"filenames":["a.ts"],"numFiles":1}');
    expect(normalized.paths.items).toEqual(['a.ts']);
    expect(normalized.counts.files).toBe(1);
  });

  test('json array of content blocks joins text', () => {
    const normalized = normalize(
      '[{"type":"text","text":"hello"},{"type":"image"},{"type":"text","text":"bye"}]'
    );
    expect(normalized.text).toBe('hello\nbye');
  });

  test('record content block array joins text', () => {
    const normalized = normalize({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
    expect(normalized.text).toBe('a\nb');
  });

  test('json-looking string at the parse cap still parses', () => {
    const inner = 'x'.repeat(MAX_JSON_PARSE_CODE_UNITS - 13);
    const raw = `{"stdout":"${inner}"}`;
    expect(raw.length).toBe(MAX_JSON_PARSE_CODE_UNITS);
    const normalized = normalize(raw);
    expect(normalized.text).toBe(inner);
    expect(normalized.unreadable).toBe(false);
  });

  test('over-cap json-looking string salvages the prefix instead of parsing', () => {
    const inner = 'y'.repeat(MAX_JSON_PARSE_CODE_UNITS);
    const raw = `{"stdout":"${inner}"}`;
    expect(raw.length).toBeGreaterThan(MAX_JSON_PARSE_CODE_UNITS);
    const normalized = normalize(raw);
    expect(normalized.unreadable).toBe(false);
    expect(normalized.text).not.toBeNull();
    expect(normalized.text!.length).toBeLessThanOrEqual(MAX_OUTPUT_TEXT_CODE_UNITS);
    expect(normalized.text!.startsWith('yyy')).toBe(true);
  });

  test('over-cap json-looking string with no salvageable key is unreadable', () => {
    const raw = `{"other":"${'z'.repeat(MAX_JSON_PARSE_CODE_UNITS)}"}`;
    const normalized = normalize(raw);
    expect(normalized.unreadable).toBe(true);
    expect(normalized.text).toBeNull();
  });

  test('json-looking string with whitespace prefix is still treated as json', () => {
    const normalized = normalize('   {"stdout":"padded"}');
    expect(normalized.text).toBe('padded');
  });
});

describe('failed-json salvage', () => {
  test('recovers an allowlisted value from truncated json', () => {
    const normalized = normalize('{"stdout":"partial output","more":"');
    expect(normalized.text).toBe('partial output');
    expect(normalized.unreadable).toBe(false);
  });

  test('recovers nested allowlisted keys', () => {
    const normalized = normalize('{"outer":{"content":"deep value"}');
    expect(normalized.text).toBe('deep value');
  });

  test('recovered stderr joins after stdout', () => {
    const normalized = normalize('{"stdout":"out","stderr":"err","tail":');
    expect(normalized.text).toBe('out\nerr');
  });

  test('result and text keys are recovered', () => {
    expect(normalize('{"result":"fetched","x"').text).toBe('fetched');
    expect(normalize('{"text":"body"').text).toBe('body');
  });

  test('a cut trailing escape ends with the replacement char', () => {
    const normalized = normalize('{"stdout":"abc\\');
    expect(normalized.text).toBe('abc\ufffd');
  });

  test('a cut unicode escape ends with the replacement char', () => {
    const normalized = normalize('{"stdout":"A\\u0041\\uD8');
    expect(normalized.text).toBe('AA\ufffd');
  });

  test('a lone high surrogate ends with the replacement char', () => {
    const normalized = normalize('{"stdout":"\\uD800"');
    expect(normalized.text).toBe('\ufffd');
  });

  test('a lone low surrogate becomes the replacement char', () => {
    const normalized = normalize('{"stdout":"\\uDC00x"');
    expect(normalized.text).toBe('\ufffdx');
  });

  test('a high surrogate followed by a low surrogate combines', () => {
    const normalized = normalize('{"stdout":"\\uD83D\\uDE00x"');
    expect(normalized.text).toBe('😀x');
  });

  test('decoded escapes land in the recovered value', () => {
    const normalized = normalize('{"stdout":"a\\nb\\t\\"q\\""');
    expect(normalized.text).toBe('a\nb\t"q"');
  });

  test('never returns an arbitrary last literal', () => {
    const normalized = normalize('{"other":"zzz","tail":"nope"');
    expect(normalized.text).toBeNull();
    expect(normalized.unreadable).toBe(true);
  });

  test('non-string allowlisted values are not recovered', () => {
    const normalized = normalize('{"stdout":42,"data":"');
    expect(normalized.unreadable).toBe(true);
  });

  test('strings in value position are not treated as keys', () => {
    const normalized = normalize('{"a":"stdout","b":"');
    expect(normalized.unreadable).toBe(true);
  });

  test('salvage scan is bounded to the scan window', () => {
    const inner = 'k'.repeat(MAX_SALVAGE_SCAN_CODE_UNITS);
    const raw = `{"pad":"${inner}","stdout":"after"}`;
    const normalized = normalize(raw);
    // "stdout" sits past the scan window and is never reached.
    expect(normalized.text).toBeNull();
    expect(normalized.unreadable).toBe(true);
  });
});

describe('paths and matches channels', () => {
  test('claude Glob filenames become paths with counts', () => {
    const normalized = normalize({
      filenames: ['src/a.ts', 'src/b.ts'],
      numFiles: 2,
      truncated: false,
      durationMs: 3,
    });
    expect(normalized.paths.items).toEqual(['src/a.ts', 'src/b.ts']);
    expect(normalized.paths.omitted).toBe(0);
    expect(normalized.paths.truncated).toBe(false);
    expect(normalized.counts.files).toBe(2);
  });

  test('glob truncation without a trusted total reports inexact omission', () => {
    const normalized = normalize({ filenames: ['a.ts'], numFiles: 1, truncated: true });
    expect(normalized.paths.truncated).toBe(true);
    expect(normalized.paths.omitted).toBeNull();
  });

  test('glob trusted total yields an exact omitted count', () => {
    const normalized = normalize({
      filenames: ['a.ts'],
      numFiles: 1,
      truncated: true,
      totalMatches: 10,
      countIsComplete: true,
    });
    expect(normalized.paths.omitted).toBe(9);
    expect(normalized.paths.truncated).toBe(true);
  });

  test('untrusted totalMatches is not exact', () => {
    const normalized = normalize({
      filenames: ['a.ts'],
      numFiles: 1,
      truncated: true,
      totalMatches: 10,
      countIsComplete: false,
    });
    expect(normalized.paths.omitted).toBeNull();
    expect(normalized.paths.truncated).toBe(true);
  });

  test('grep files_with_matches mode carries paths plus mode and counts', () => {
    const normalized = normalize({
      mode: 'files_with_matches',
      numFiles: 2,
      filenames: ['a.ts', 'b.ts'],
    });
    expect(normalized.mode).toBe('files_with_matches');
    expect(normalized.paths.items).toEqual(['a.ts', 'b.ts']);
    expect(normalized.counts.files).toBe(2);
  });

  test('grep content mode parses anchored path:line:text items', () => {
    const normalized = normalize({
      mode: 'content',
      numFiles: 1,
      filenames: ['a.ts'],
      content: 'a.ts:3: hit me\na.ts:9: second',
      numMatches: 2,
    });
    expect(normalized.mode).toBe('content');
    expect(normalized.matches.items).toEqual([
      { path: 'a.ts', line: 3, text: ' hit me' },
      { path: 'a.ts', line: 9, text: ' second' },
    ]);
    expect(normalized.counts.matches).toBe(2);
    expect(normalized.text).toBeNull();
  });

  test('grep content keeps unmatched lines as text-only items', () => {
    const normalized = normalize({
      mode: 'content',
      content: 'a.ts:3: hit\n--\nnot a match line\n',
      numMatches: 1,
    });
    expect(normalized.matches.items).toEqual([
      { path: 'a.ts', line: 3, text: ' hit' },
      { path: null, line: null, text: '--' },
      { path: null, line: null, text: 'not a match line' },
    ]);
  });

  test('windows paths and colons in match text split correctly', () => {
    const normalized = normalize({
      mode: 'content',
      content: 'C:\\src\\a.ts:12: has: colon\n',
      numMatches: 1,
    });
    expect(normalized.matches.items).toEqual([
      { path: 'C:\\src\\a.ts', line: 12, text: ' has: colon' },
    ]);
  });

  test('dash-anchored lines parse when colon form fails', () => {
    const normalized = normalize({
      mode: 'content',
      content: 'my-file.ts-7- hit',
      numMatches: 1,
    });
    expect(normalized.matches.items).toEqual([{ path: 'my-file.ts', line: 7, text: ' hit' }]);
  });

  test('colon form wins over dash form', () => {
    const normalized = normalize({ mode: 'content', content: 'a-b:12:x', numMatches: 1 });
    expect(normalized.matches.items).toEqual([{ path: 'a-b', line: 12, text: 'x' }]);
  });

  test('a single colon with digits is not a match line', () => {
    const normalized = normalize({ mode: 'content', content: '12:34', numMatches: 0 });
    expect(normalized.matches.items).toEqual([{ path: null, line: null, text: '12:34' }]);
  });

  test('devin file_matches keep path line and content structure', () => {
    const normalized = normalize({
      file_matches: [
        { path: 'a.ts', matches: [{ line_number: 4, content: 'four' }] },
        { path: 'b.ts', matches: [{ line_number: 9, content: 'nine' }] },
      ],
    });
    expect(normalized.matches.items).toEqual([
      { path: 'a.ts', line: 4, text: 'four' },
      { path: 'b.ts', line: 9, text: 'nine' },
    ]);
  });

  test('structured file_matches win over content line parsing', () => {
    const normalized = normalize({
      file_matches: [{ path: 'a.ts', matches: [{ line_number: 1, content: 's' }] }],
      content: 'z.ts:9: not parsed',
      numMatches: 1,
    });
    expect(normalized.matches.items).toEqual([{ path: 'a.ts', line: 1, text: 's' }]);
  });

  test('file_matches entry without line number keeps content', () => {
    const normalized = normalize({
      file_matches: [{ path: 'a.ts', matches: [{ content: 'loose' }] }],
    });
    expect(normalized.matches.items).toEqual([{ path: 'a.ts', line: null, text: 'loose' }]);
  });

  test('count mode record exposes mode and counts', () => {
    const normalized = normalize({ mode: 'count', numFiles: 1, filenames: [], numMatches: 7 });
    expect(normalized.mode).toBe('count');
    expect(normalized.counts.matches).toBe(7);
  });

  test('a bare count field lands on matches', () => {
    const normalized = normalize({ count: 14 });
    expect(normalized.counts.matches).toBe(14);
  });

  test('a digit-only string output contributes a count', () => {
    const normalized = normalize('42');
    expect(normalized.counts.matches).toBe(42);
    expect(normalized.text).toBe('42');
  });

  test('simultaneous channels expose more than one channel at once', () => {
    const normalized = normalize({
      mode: 'content',
      content: 'a.ts:1:x',
      numMatches: 1,
      numFiles: 1,
      filenames: ['a.ts'],
      stdout: 'extra',
    });
    expect(normalized.mode).toBe('content');
    expect(normalized.matches.items).toHaveLength(1);
    expect(normalized.counts).toEqual({ matches: 1, files: 1 });
    expect(normalized.paths.items).toEqual(['a.ts']);
    expect(normalized.text).toBe('extra');
    expect(normalized.fields.length).toBeGreaterThan(0);
  });
});

describe('file and web channels', () => {
  test('claude read file.content becomes text', () => {
    const normalized = normalize({
      type: 'text',
      file: { filePath: 'a.ts', content: 'FILE BODY', numLines: 1, startLine: 1, totalLines: 1 },
    });
    expect(normalized.text).toBe('FILE BODY');
  });

  test('create type plus content becomes text', () => {
    const normalized = normalize({ type: 'create', filePath: 'a.ts', content: 'NEW FILE' });
    expect(normalized.text).toBe('NEW FILE');
  });

  test('capitalized content wrappers become text', () => {
    expect(normalize({ FileContent: { content: 'FC' } }).text).toBe('FC');
    expect(normalize({ Content: { content: 'C' } }).text).toBe('C');
  });

  test('bare content string on a non-grep record becomes text', () => {
    expect(normalize({ content: 'loose text' }).text).toBe('loose text');
  });

  test('edit outputs contribute fields but no fabricated preview', () => {
    const normalized = normalize({
      filePath: 'a.ts',
      oldString: 'x',
      newString: 'y',
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] },
      ],
    });
    expect(normalized.text).toBeNull();
    expect(normalized.fields).toContainEqual({ key: 'filePath', value: 'a.ts' });
    expect(normalized.fields).toContainEqual({ key: 'structuredPatch', value: '[1]' });
  });

  test('webfetch result and url surface', () => {
    const normalized = normalize({
      bytes: 100,
      code: 200,
      codeText: 'OK',
      result: 'processed content',
      durationMs: 5,
      url: 'https://example.com/page',
    });
    expect(normalized.text).toBe('processed content');
    expect(normalized.fields).toContainEqual({ key: 'url', value: 'https://example.com/page' });
    expect(normalized.fields).toContainEqual({ key: 'code', value: '200' });
  });

  test('websearch nested content items become web results, strings become text', () => {
    const normalized = normalize({
      query: 'archon',
      results: [
        'model commentary',
        { tool_use_id: 't1', content: [{ title: 'Title', url: 'https://a.dev' }] },
      ],
      searchCount: 1,
    });
    expect(normalized.webResults.items).toEqual([{ title: 'Title', url: 'https://a.dev' }]);
    expect(normalized.text).toBe('model commentary');
    expect(normalized.fields).toContainEqual({ key: 'query', value: 'archon' });
  });

  test('websearch direct title/url entries are accepted', () => {
    const normalized = normalize({ results: [{ title: 'T', url: 'https://b.dev' }] });
    expect(normalized.webResults.items).toEqual([{ title: 'T', url: 'https://b.dev' }]);
  });

  test('web result without a url contributes nothing', () => {
    const normalized = normalize({ results: [{ title: 'no url' }] });
    expect(normalized.webResults.items).toHaveLength(0);
  });
});

describe('generic fields', () => {
  test('unknown object yields bounded scalar fields with markers', () => {
    const normalized = normalize({
      alpha: 1,
      beta: 'two',
      gamma: true,
      nested: { deep: [1, 2] },
      list: [1, 2, 3],
    });
    expect(normalized.fields).toEqual([
      { key: 'alpha', value: '1' },
      { key: 'beta', value: 'two' },
      { key: 'gamma', value: 'true' },
      { key: 'nested', value: '{…}' },
      { key: 'list', value: '[3]' },
    ]);
  });

  test('fields keep stable source order', () => {
    const normalized = normalize({ z: 1, a: 2, m: 3 });
    expect(normalized.fields.map(f => f.key)).toEqual(['z', 'a', 'm']);
  });

  test('non-finite numbers and symbol/function values contribute nothing', () => {
    const normalized = normalize({
      inf: Infinity,
      nan: NaN,
      fn: () => 1,
      sym: Symbol('s'),
      big: 10n,
      nil: null,
      real: 'yes',
    });
    expect(normalized.fields).toEqual([{ key: 'real', value: 'yes' }]);
    expect(normalized.text).toBeNull();
    expect(normalized.unreadable).toBe(false);
  });

  test('prototype properties are never scanned', () => {
    const proto = { inherited: 'nope' };
    const record = Object.create(proto) as Record<string, unknown>;
    record.own = 'mine';
    const normalized = normalize(record);
    expect(normalized.fields).toEqual([{ key: 'own', value: 'mine' }]);
  });

  test('fields stop at the scanned-key bound', () => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < MAX_FIELD_KEYS_SCANNED; i++) record[`k${String(i)}`] = i;
    record.late = 'never';
    const normalized = normalize(record);
    expect(normalized.fields).toHaveLength(MAX_FIELD_KEYS_SCANNED);
    expect(normalized.fields.some(f => f.key === 'late')).toBe(false);
  });

  test('fields stop at the emitted-field bound', () => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OUTPUT_FIELDS + 10; i++) record[`f${String(i)}`] = i;
    expect(MAX_OUTPUT_FIELDS).toBeLessThanOrEqual(MAX_FIELD_KEYS_SCANNED);
    const normalized = normalize(record);
    expect(normalized.fields).toHaveLength(MAX_OUTPUT_FIELDS);
  });
});

describe('bounds and adversarial inputs', () => {
  test('text at the code-unit cap is kept whole', () => {
    const raw = 'a'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS);
    const normalized = normalize(raw);
    expect(normalized.text).toBe(raw);
  });

  test('text over the cap is cut to the cap', () => {
    const raw = 'b'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS + 1);
    const normalized = normalize(raw);
    expect(normalized.text).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
  });

  test('ansi sequences do not consume the text budget', () => {
    const raw = `${'x'.repeat(100)}${`${ESC}[31m`.repeat(1000)}${'y'.repeat(100)}`;
    const normalized = normalize(raw);
    expect(normalized.text).toBe('x'.repeat(100) + 'y'.repeat(100));
  });

  test('a surrogate pair is never split at the text cap', () => {
    const raw = `${'a'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS - 1)}😀tail`;
    const normalized = normalize(raw);
    expect(normalized.text).toBe('a'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS - 1));
  });

  test('list items stop at the item cap with exact omission', () => {
    const filenames = Array.from({ length: MAX_LIST_ITEMS + 25 }, (_, i) => `f${String(i)}.ts`);
    const normalized = normalize({ filenames });
    expect(normalized.paths.items).toHaveLength(MAX_LIST_ITEMS);
    expect(normalized.paths.omitted).toBe(25);
    expect(normalized.paths.truncated).toBe(true);
  });

  test('list items at exactly the cap are complete', () => {
    const filenames = Array.from({ length: MAX_LIST_ITEMS }, (_, i) => `f${String(i)}.ts`);
    const normalized = normalize({ filenames });
    expect(normalized.paths.items).toHaveLength(MAX_LIST_ITEMS);
    expect(normalized.paths.omitted).toBe(0);
    expect(normalized.paths.truncated).toBe(false);
  });

  test('huge lists stay bounded', () => {
    const filenames = Array.from({ length: 100_000 }, (_, i) => `f${String(i)}.ts`);
    const normalized = normalize({ filenames });
    expect(normalized.paths.items).toHaveLength(MAX_LIST_ITEMS);
    expect(normalized.paths.omitted).toBe(100_000 - MAX_LIST_ITEMS);
  });

  test('non-string entries in a list make omission inexact', () => {
    const filenames: unknown[] = Array.from({ length: MAX_LIST_ITEMS + 5 }, (_, i) =>
      i === 2 ? 42 : `f${String(i)}.ts`
    );
    const normalized = normalize({ filenames });
    expect(normalized.paths.items).toHaveLength(MAX_LIST_ITEMS);
    expect(normalized.paths.truncated).toBe(true);
    expect(normalized.paths.omitted).toBeNull();
  });

  test('per-item text is bounded', () => {
    const long = 'p'.repeat(MAX_LIST_ITEM_TEXT_CODE_UNITS + 10);
    const normalized = normalize({ filenames: [long] });
    expect(normalized.paths.items[0]).toHaveLength(MAX_LIST_ITEM_TEXT_CODE_UNITS);
  });

  test('grep match paths and text are bounded per item', () => {
    const longPath = 'p'.repeat(MAX_LIST_ITEM_TEXT_CODE_UNITS + 50);
    const longText = 't'.repeat(MAX_LIST_ITEM_TEXT_CODE_UNITS + 50);
    const normalized = normalize({ mode: 'content', content: `${longPath}:7:${longText}` });
    expect(normalized.matches.items).toEqual([
      {
        path: 'p'.repeat(MAX_LIST_ITEM_TEXT_CODE_UNITS),
        line: 7,
        text: 't'.repeat(MAX_LIST_ITEM_TEXT_CODE_UNITS),
      },
    ]);
  });

  test('truncated grep content reports an inexact omitted tail', () => {
    const normalized = normalize({
      mode: 'content',
      content: `a.ts:1:${'x'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS)}`,
    });
    expect(normalized.matches.truncated).toBe(true);
    expect(normalized.matches.omitted).toBeNull();
  });

  test('nested match and web-result lists cannot silently overflow the item cap', () => {
    const matches = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, i) => ({
      line_number: i + 1,
      content: `hit-${String(i)}`,
    }));
    const normalizedMatches = normalize({ file_matches: [{ path: 'a.ts', matches }] });
    expect(normalizedMatches.matches.items).toHaveLength(MAX_LIST_ITEMS);
    expect(normalizedMatches.matches.truncated).toBe(true);
    expect(normalizedMatches.matches.omitted).toBeNull();

    const content = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, i) => ({
      title: `result-${String(i)}`,
      url: `https://example.com/${String(i)}`,
    }));
    const normalizedWeb = normalize({ results: [{ content }] });
    expect(normalizedWeb.webResults.items).toHaveLength(MAX_LIST_ITEMS);
    expect(normalizedWeb.webResults.truncated).toBe(true);
    expect(normalizedWeb.webResults.omitted).toBeNull();
  });

  test('field values are bounded', () => {
    const big = 'v'.repeat(MAX_FIELD_VALUE_CODE_UNITS + 50);
    const normalized = normalize({ big });
    const field = normalized.fields.find(f => f.key === 'big');
    expect(field).toBeDefined();
    expect(field!.value).toHaveLength(MAX_FIELD_VALUE_CODE_UNITS);
  });

  test('field keys are sanitized and bounded', () => {
    const key = `\u001b[31m${'k'.repeat(MAX_FIELD_KEY_CODE_UNITS + 50)}`;
    const normalized = normalize({ [key]: 'value' });
    expect(normalized.fields).toHaveLength(1);
    expect(normalized.fields[0]?.key).toBe('k'.repeat(MAX_FIELD_KEY_CODE_UNITS));
  });

  test('byte arrays decode at most the text-cap prefix', () => {
    const bytes = Array.from({ length: MAX_OUTPUT_TEXT_CODE_UNITS + 100 }, () => 65);
    const normalized = normalize({ output: bytes });
    expect(normalized.text).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
  });

  test('byte array at exactly the cap decodes fully', () => {
    const bytes = Array.from({ length: MAX_OUTPUT_TEXT_CODE_UNITS }, () => 65);
    const normalized = normalize({ output: bytes });
    expect(normalized.text).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
  });

  test('adversarially large text and json inputs never throw', () => {
    const hugeText = 'x'.repeat(2_000_000);
    expect(() => normalize(hugeText)).not.toThrow();
    expect(normalize(hugeText).text).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
    const hugeJson = `{"stdout":"${'q'.repeat(2_000_000)}"}`;
    expect(() => normalize(hugeJson)).not.toThrow();
  });

  test('hostile inputs never throw', () => {
    for (const output of [undefined, null, 42, 3.14, -7, true, false, [1, 2, 3], '']) {
      expect(() => normalize(output)).not.toThrow();
    }
    const poisoned = new Proxy(
      { stdout: 'hidden' },
      {
        get(): never {
          throw new Error('nope');
        },
      }
    );
    expect(() => normalize(poisoned)).not.toThrow();
  });

  test('a throwing proxy yields unreadable rather than a fabricated channel', () => {
    const poisoned = new Proxy(
      {},
      {
        get(): never {
          throw new Error('nope');
        },
        ownKeys(): never {
          throw new Error('nope');
        },
        getOwnPropertyDescriptor(): never {
          throw new Error('nope');
        },
      }
    );
    const normalized = normalize(poisoned);
    expect(normalized.unreadable).toBe(true);
    expect(normalized.fields).toEqual([]);
  });

  test('bare numbers and booleans produce bounded text', () => {
    expect(normalize(3.5).text).toBe('3.5');
    expect(normalize(true).text).toBe('true');
    const counted = normalize(17);
    expect(counted.text).toBe('17');
    expect(counted.counts.matches).toBe(17);
  });

  test('non-finite bare numbers contribute nothing', () => {
    for (const output of [Infinity, -Infinity, NaN]) {
      const normalized = normalize(output);
      expect(normalized.text).toBeNull();
      expect(normalized.counts.matches).toBeNull();
      expect(normalized.unreadable).toBe(false);
    }
  });

  test('undefined and null produce an empty non-unreadable result', () => {
    for (const output of [undefined, null]) {
      const normalized = normalize(output);
      expect(normalized.text).toBeNull();
      expect(normalized.fields).toEqual([]);
      expect(normalized.unreadable).toBe(false);
    }
  });

  test('records are inspected directly and never stringified', () => {
    const record = {
      stdout: 'kept',
      toJSON(): never {
        throw new Error('stringify must not run');
      },
    };
    const normalized = normalize(record);
    expect(normalized.text).toBe('kept');
  });

  test('a bigint value survives where JSON.stringify would throw', () => {
    const normalized = normalize({ count: 5, big: 10n });
    expect(normalized.fields).toContainEqual({ key: 'count', value: '5' });
    expect(normalized.fields.some(f => f.key === 'big')).toBe(false);
  });

  test('deeply nested records do not recurse', () => {
    let nested: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 100; i++) nested = { next: nested };
    const normalized = normalize(nested);
    expect(normalized.fields).toEqual([{ key: 'next', value: '{…}' }]);
  });
});

describe('mode channel discipline', () => {
  test('unrecognized mode values do not set the channel', () => {
    const normalized = normalize({ mode: 'weird', filenames: ['a'] });
    expect(normalized.mode).toBeNull();
    expect(normalized.paths.items).toEqual(['a']);
  });

  test('mode from a serialized grep record', () => {
    const normalized = normalize('{"mode":"files_with_matches","numFiles":1,"filenames":["a.ts"]}');
    expect(normalized.mode).toBe('files_with_matches');
  });
});

describe('textTruncated flag', () => {
  test('text at the exact display cap is not flagged', () => {
    const normalized = normalize('x'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS));
    expect(normalized.text).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
    expect(normalized.textTruncated).toBe(false);
  });

  test('text one unit over the cap is flagged and bounded', () => {
    const normalized = normalize('x'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS + 1));
    expect(normalized.text).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
    expect(normalized.textTruncated).toBe(true);
  });

  test('absent or short text is not flagged', () => {
    expect(normalize(null).textTruncated).toBe(false);
    expect(normalize('short').textTruncated).toBe(false);
  });
});
