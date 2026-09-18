/**
 * Pure, React-free, provider-agnostic normalization of a tool call's stored
 * output into simultaneous bounded semantic channels. One payload can supply
 * text, paths, structured matches, counts, web results, scalar fields, and a
 * grep mode at the same time; callers pick the channels their family body
 * renders. Recognition is structural only — documented key/shape paths, no
 * provider-name branching, no recursive scans, no natural-language parsing.
 * Every string and list returned is already display-bounded; adversarial or
 * truncated input degrades to `unreadable` instead of throwing.
 */

/** Approx 64 Ki code units of parsed/displayed text per output. */
export const MAX_OUTPUT_TEXT_CODE_UNITS = 65_536;
/** JSON-looking strings at or below this many code units use `JSON.parse`. */
export const MAX_JSON_PARSE_CODE_UNITS = 65_536;
/** Failed/over-cap JSON salvage scans only this leading window of code units. */
export const MAX_SALVAGE_SCAN_CODE_UNITS = 65_536;
/** Rendered items per list channel (paths, matches, web results). */
export const MAX_LIST_ITEMS = 500;
/** Per-item text bound inside list channels. */
export const MAX_LIST_ITEM_TEXT_CODE_UNITS = 1_024;
/** Own top-level keys inspected for generic fields. */
export const MAX_FIELD_KEYS_SCANNED = 32;
/** Generic fields emitted. */
export const MAX_OUTPUT_FIELDS = 32;
/** Per-field scalar text bound. */
export const MAX_FIELD_VALUE_CODE_UNITS = 1_024;

export interface ToolOutputMatch {
  path: string | null;
  line: number | null;
  text: string;
}

export interface ToolOutputField {
  key: string;
  value: string;
}

export interface BoundedList<T> {
  items: T[];
  /** 0 when complete, a positive exact count when known, null when inexact. */
  omitted: number | null;
  truncated: boolean;
}

export interface NormalizedToolOutput {
  text: string | null;
  paths: BoundedList<string>;
  matches: BoundedList<ToolOutputMatch>;
  webResults: BoundedList<{ title: string | null; url: string }>;
  fields: ToolOutputField[];
  counts: { matches: number | null; files: number | null };
  mode: 'content' | 'files_with_matches' | 'count' | null;
  unreadable: boolean;
}

/** Scanning a source list stops after this many examined entries, so a hostile list cannot force unbounded work. */
const LIST_SCAN_LIMIT = MAX_LIST_ITEMS * 4;
/** Failed-JSON salvage only recovers string values under these keys. */
const SALVAGE_KEYS: ReadonlySet<string> = new Set([
  'stdout',
  'stderr',
  'text',
  'content',
  'result',
]);
const REPLACEMENT_CHAR = '\uFFFD';
const ANSI_ESC = 0x1b;

interface TextAcc {
  parts: string[];
  units: number;
  truncated: boolean;
}

function createTextAcc(): TextAcc {
  return { parts: [], units: 0, truncated: false };
}

function emptyList<T>(): BoundedList<T> {
  return { items: [], omitted: 0, truncated: false };
}

function emptyNormalized(unreadable: boolean): NormalizedToolOutput {
  return {
    text: null,
    paths: emptyList(),
    matches: emptyList(),
    webResults: emptyList(),
    fields: [],
    counts: { matches: null, files: null },
    mode: null,
    unreadable,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Property read that cannot throw: hostile getters/proxies yield undefined. */
function safeGet(record: Record<string, unknown>, key: string): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

/** Own enumerable keys; null when enumeration itself throws (hostile proxy). */
function ownKeys(record: Record<string, unknown>): string[] | null {
  try {
    const keys: string[] = [];
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) keys.push(key);
    }
    return keys;
  } catch {
    return null;
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Skip one terminal escape/control sequence starting at `raw[i]` (ESC or a C1
 * CSI/OSC leader). Returns the index just past the sequence; an unterminated
 * sequence consumes the rest of the string, matching terminal behavior.
 */
function skipEscapeSequence(raw: string, i: number): number {
  const n = raw.length;
  const first = raw.charCodeAt(i);
  if (i + 1 >= n) return n;
  const next = raw.charCodeAt(i + 1);
  // C1 CSI (0x9B) or ESC [ ... final byte in 0x40–0x7E.
  if (first === 0x9b || next === 0x5b) {
    let j = first === 0x9b ? i + 1 : i + 2;
    while (j < n) {
      const code = raw.charCodeAt(j);
      if (code >= 0x40 && code <= 0x7e) return j + 1;
      j++;
    }
    return n;
  }
  // C1 OSC (0x9D) or ESC ], plus DCS/SOS/PM/APC leaders: until BEL or ST.
  if (first === 0x9d || next === 0x5d || (next >= 0x50 && next <= 0x5f)) {
    let j = first === 0x9d ? i + 1 : i + 2;
    while (j < n) {
      const code = raw.charCodeAt(j);
      if (code === 0x07) return j + 1;
      if (code === ANSI_ESC && j + 1 < n && raw.charCodeAt(j + 1) === 0x5c) return j + 2;
      j++;
    }
    return n;
  }
  // Other ESC sequence: optional intermediates (0x20–0x2F) then one final byte.
  let j = i + 1;
  while (j < n && raw.charCodeAt(j) >= 0x20 && raw.charCodeAt(j) <= 0x2f) j++;
  return j < n ? j + 1 : n;
}

/**
 * Copy `raw` into a bounded string of at most `maxUnits` code units while
 * stripping ANSI CSI/OSC (including OSC-8 links), other escape sequences, and
 * control characters — no unbounded intermediate is ever created. Newline and
 * tab survive; surrogate pairs are never split at the boundary.
 */
function sanitizeBounded(raw: string, maxUnits: number): { text: string; truncated: boolean } {
  const parts: string[] = [];
  let units = 0;
  let truncated = false;
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const code = raw.charCodeAt(i);
    if (code === ANSI_ESC || code === 0x9b || code === 0x9d) {
      i = skipEscapeSequence(raw, i);
      continue;
    }
    if ((code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f)) {
      i++;
      continue;
    }
    let width = 1;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < n) {
      const lo = raw.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) width = 2;
    }
    if (units + width > maxUnits) {
      truncated = true;
      break;
    }
    parts.push(raw.slice(i, i + width));
    units += width;
    i += width;
  }
  return { text: parts.join(''), truncated };
}

/** Append one source to the channel text, `\n`-separated, inside the global text budget. */
function pushText(acc: TextAcc, raw: string): void {
  if (acc.units >= MAX_OUTPUT_TEXT_CODE_UNITS) {
    acc.truncated = true;
    return;
  }
  const separator = acc.units > 0 ? 1 : 0;
  const budget = MAX_OUTPUT_TEXT_CODE_UNITS - acc.units - separator;
  const { text, truncated } = sanitizeBounded(raw, budget);
  if (truncated) acc.truncated = true;
  if (text.length === 0) return;
  if (separator === 1) acc.parts.push('\n');
  acc.parts.push(text);
  acc.units += separator + text.length;
}

function itemText(raw: string): string {
  return sanitizeBounded(raw, MAX_LIST_ITEM_TEXT_CODE_UNITS).text;
}

interface ListOptions {
  /** Explicit exact total from the source (e.g. `totalMatches` with `countIsComplete`). */
  trustedTotal?: number | null;
  /** The source itself declares truncation without an exact total. */
  upstreamTruncated?: boolean;
  /**
   * Flat sources (one item per entry) can report an exact omitted count from
   * `source.length` without scanning the tail; nested sources cannot.
   */
  flat: boolean;
}

/**
 * Bounded list production. `map` returns the display items for one source
 * entry (empty array = the entry contributes nothing). `+n more` is only
 * honest when the omitted count is exact — a trusted total or a clean flat
 * prefix; otherwise `truncated`/`omitted: null` asks the UI for the vaguer
 * "more results omitted".
 */
function boundList<S, T>(
  source: readonly S[],
  map: (entry: S) => readonly T[],
  options: ListOptions
): BoundedList<T> {
  const items: T[] = [];
  let scanned = 0;
  let sawSkipped = false;
  const scanLimit = Math.min(source.length, LIST_SCAN_LIMIT);
  while (scanned < scanLimit && items.length < MAX_LIST_ITEMS) {
    const produced = map(source[scanned]);
    scanned++;
    if (produced.length === 0) {
      sawSkipped = true;
      continue;
    }
    for (const item of produced) {
      if (items.length >= MAX_LIST_ITEMS) break;
      items.push(item);
    }
  }
  const reachedEnd = scanned >= source.length;
  const upstream = options.upstreamTruncated === true;
  const trusted = options.trustedTotal;
  if (typeof trusted === 'number' && Number.isInteger(trusted) && trusted >= items.length) {
    const omitted = trusted - items.length;
    return { items, omitted, truncated: omitted > 0 || upstream };
  }
  if (reachedEnd) {
    return upstream
      ? { items, omitted: null, truncated: true }
      : { items, omitted: 0, truncated: false };
  }
  if (options.flat && !sawSkipped) {
    return { items, omitted: source.length - items.length, truncated: true };
  }
  return { items, omitted: null, truncated: true };
}

function toOne<T>(item: T | null): readonly T[] {
  return item === null ? [] : [item];
}

/** Anchored `path<sep>digits<sep>text` split; first separator whose following segment is digits wins. */
function anchoredMatch(line: string, separator: ':' | '-'): ToolOutputMatch | null {
  let p = line.indexOf(separator);
  while (p !== -1) {
    if (p > 0) {
      const q = line.indexOf(separator, p + 1);
      if (q > p + 1) {
        const digits = line.slice(p + 1, q);
        if (/^\d+$/.test(digits)) {
          const parsed = Number(digits);
          if (Number.isSafeInteger(parsed)) {
            return {
              path: line.slice(0, p),
              line: parsed,
              text: line.slice(q + 1),
            };
          }
        }
      }
    }
    p = line.indexOf(separator, p + 1);
  }
  return null;
}

/**
 * `path:line:text` first, then `path-line-text`; a line matching neither shape
 * is retained as a text-only item rather than mis-split (Windows paths carry
 * their own colons).
 */
function parseMatchLine(line: string): ToolOutputMatch | null {
  if (line.length === 0) return null;
  return (
    anchoredMatch(line, ':') ?? anchoredMatch(line, '-') ?? { path: null, line: null, text: line }
  );
}

type ByteVerdict = 'not-bytes' | 'ok' | 'corrupt';

/**
 * Devin terminal output arrives as `output: number[]`. Only an all-number
 * array qualifies as bytes at all; within the decoded prefix every value must
 * be an integer 0–255 — never coerced. Values past the decode bound are not
 * examined because they are never decoded.
 */
function inspectBytes(value: readonly unknown[]): { verdict: ByteVerdict; bytes?: Uint8Array } {
  if (value.length === 0) return { verdict: 'not-bytes' };
  const limit = Math.min(value.length, MAX_OUTPUT_TEXT_CODE_UNITS);
  for (let i = 0; i < limit; i++) {
    if (typeof value[i] !== 'number') return { verdict: 'not-bytes' };
  }
  const bytes = new Uint8Array(limit);
  for (let i = 0; i < limit; i++) {
    const v = value[i] as number;
    if (!Number.isInteger(v) || v < 0 || v > 255) return { verdict: 'corrupt' };
    bytes[i] = v;
  }
  return { verdict: 'ok', bytes };
}

const BYTE_DECODER = new TextDecoder('utf-8', { fatal: false });

// --- Failed-JSON salvage: a bounded state-machine tokenizer ---

type SalvageFrame =
  | { kind: 'object'; state: 'key' | 'colon' | 'value' | 'comma'; pendingKey: string | null }
  | { kind: 'array'; state: 'element' | 'comma' };

interface SalvageString {
  text: string;
  next: number;
  terminated: boolean;
}

const HEX = /^[0-9a-fA-F]{4}$/;

/** Read a JSON string starting at `s[i] === '"'`, decoding escapes; a cut escape or lone surrogate ends with U+FFFD. */
function salvageReadString(s: string, i: number, limit: number): SalvageString {
  let out = '';
  let j = i + 1;
  while (j < limit) {
    const code = s.charCodeAt(j);
    if (code === 0x22) return { text: out, next: j + 1, terminated: true };
    if (code === 0x5c) {
      if (j + 1 >= limit) return { text: out + REPLACEMENT_CHAR, next: limit, terminated: false };
      const esc = s[j + 1];
      if (esc === 'u') {
        const hex = s.slice(j + 2, j + 6);
        if (j + 6 > limit) {
          return { text: out + REPLACEMENT_CHAR, next: limit, terminated: false };
        }
        if (!HEX.test(hex)) {
          out += 'u';
          j += 2;
          continue;
        }
        const unit = parseInt(hex, 16);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const tail = s.slice(j + 6, j + 12);
          if (/^\\u[0-9a-fA-F]{4}$/.test(tail)) {
            const low = parseInt(tail.slice(2), 16);
            if (low >= 0xdc00 && low <= 0xdfff) {
              out += String.fromCharCode(unit, low);
              j += 12;
              continue;
            }
          }
          out += REPLACEMENT_CHAR;
          j += 6;
          continue;
        }
        if (unit >= 0xdc00 && unit <= 0xdfff) {
          out += REPLACEMENT_CHAR;
          j += 6;
          continue;
        }
        out += String.fromCharCode(unit);
        j += 6;
        continue;
      }
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      out += simple[esc] ?? esc;
      j += 2;
      continue;
    }
    out += s[j];
    j++;
  }
  return { text: out, next: limit, terminated: false };
}

function isWs(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDelimiter(code: number): boolean {
  return (
    isWs(code) ||
    code === 0x2c || // ,
    code === 0x3a || // :
    code === 0x7b || // {
    code === 0x7d || // }
    code === 0x5b || // [
    code === 0x5d || // ]
    code === 0x22 // "
  );
}

/**
 * Narrow prefix salvage for JSON that failed to parse or exceeded the parse
 * cap. A forgiving state machine tracks object/array nesting so a string only
 * counts as a key in key position — an arbitrary last literal never leaks —
 * and only the allowlisted semantic keys are recovered. The scan is bounded
 * to MAX_SALVAGE_SCAN_CODE_UNITS; recovered string values are bounded by the
 * same window.
 */
function salvageJson(raw: string): Record<string, string> | null {
  const limit = Math.min(raw.length, MAX_SALVAGE_SCAN_CODE_UNITS);
  const recovered = new Map<string, string>();
  const stack: SalvageFrame[] = [];
  let topValueDone = false;
  let i = 0;

  const takeValue = (frame: SalvageFrame | null): void => {
    if (frame === null) {
      topValueDone = true;
    } else {
      frame.state = 'comma';
      if (frame.kind === 'object') frame.pendingKey = null;
    }
  };

  while (i < limit && !topValueDone) {
    const code = raw.charCodeAt(i);
    if (isWs(code)) {
      i++;
      continue;
    }
    const frame = stack.length > 0 ? stack[stack.length - 1] : null;
    const state = frame === null ? 'top-value' : frame.state;

    if (state === 'key' && frame?.kind === 'object') {
      if (code === 0x7d) {
        stack.pop();
        takeValue(stack.length > 0 ? stack[stack.length - 1] : null);
        i++;
        continue;
      }
      if (code === 0x22) {
        const read = salvageReadString(raw, i, limit);
        if (!read.terminated) break;
        frame.pendingKey = read.text;
        frame.state = 'colon';
        i = read.next;
        continue;
      }
      if (code === 0x2c) {
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state === 'colon' && frame?.kind === 'object') {
      if (code === 0x3a) frame.state = 'value';
      i++;
      continue;
    }

    if (state === 'comma' && frame !== null) {
      if (code === 0x2c) {
        frame.state = frame.kind === 'object' ? 'key' : 'element';
        i++;
        continue;
      }
      if (code === 0x7d && frame.kind === 'object') {
        stack.pop();
        takeValue(stack.length > 0 ? stack[stack.length - 1] : null);
        i++;
        continue;
      }
      if (code === 0x5d && frame.kind === 'array') {
        stack.pop();
        takeValue(stack.length > 0 ? stack[stack.length - 1] : null);
        i++;
        continue;
      }
      i++;
      continue;
    }

    // 'value' inside an object, 'element' inside an array, or the top-level value.
    const expecting =
      state === 'top-value' ||
      (frame?.kind === 'object' && state === 'value') ||
      (frame?.kind === 'array' && state === 'element');
    if (!expecting) {
      i++;
      continue;
    }

    if (code === 0x22) {
      const read = salvageReadString(raw, i, limit);
      if (
        frame?.kind === 'object' &&
        frame.pendingKey !== null &&
        SALVAGE_KEYS.has(frame.pendingKey) &&
        !recovered.has(frame.pendingKey)
      ) {
        recovered.set(frame.pendingKey, read.text);
      }
      i = read.next;
      if (!read.terminated) break;
      takeValue(frame);
      continue;
    }
    if (code === 0x7b) {
      stack.push({ kind: 'object', state: 'key', pendingKey: null });
      i++;
      continue;
    }
    if (code === 0x5b) {
      stack.push({ kind: 'array', state: 'element' });
      i++;
      continue;
    }
    if (code === 0x7d && frame?.kind === 'object') {
      stack.pop();
      takeValue(stack.length > 0 ? stack[stack.length - 1] : null);
      i++;
      continue;
    }
    if (code === 0x5d && frame?.kind === 'array') {
      stack.pop();
      takeValue(stack.length > 0 ? stack[stack.length - 1] : null);
      i++;
      continue;
    }
    // Literal token (number, true, false, null, or junk): skip to a delimiter.
    while (i < limit && !isDelimiter(raw.charCodeAt(i))) i++;
    takeValue(frame);
  }

  if (recovered.size === 0) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of recovered) out[key] = value;
  return out;
}

// --- Semantic channel extraction ---

interface NormState {
  acc: TextAcc;
  paths: BoundedList<string>;
  matches: BoundedList<ToolOutputMatch>;
  webResults: BoundedList<{ title: string | null; url: string }>;
  fields: ToolOutputField[];
  counts: { matches: number | null; files: number | null };
  mode: 'content' | 'files_with_matches' | 'count' | null;
  unreadable: boolean;
  accessError: boolean;
}

function freshState(): NormState {
  return {
    acc: createTextAcc(),
    paths: emptyList(),
    matches: emptyList(),
    webResults: emptyList(),
    fields: [],
    counts: { matches: null, files: null },
    mode: null,
    unreadable: false,
    accessError: false,
  };
}

function isGrepShaped(get: (key: string) => unknown): boolean {
  const mode = get('mode');
  if (mode === 'content' || mode === 'files_with_matches' || mode === 'count') return true;
  if (isNonNegativeInteger(get('numMatches'))) return true;
  if (isNonNegativeInteger(get('numFiles'))) return true;
  if (isNonNegativeInteger(get('numLines'))) return true;
  if (Array.isArray(get('filenames'))) return true;
  return Array.isArray(get('file_matches'));
}

/** A `{type:'text', text}` content block contributes its text; anything else contributes nothing. */
function contentBlockText(block: unknown): string | null {
  const record = asRecord(block);
  if (record === null || safeGet(record, 'type') !== 'text') return null;
  return nonEmptyString(safeGet(record, 'text'));
}

function applyContentArray(acc: TextAcc, blocks: readonly unknown[]): void {
  const limit = Math.min(blocks.length, LIST_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const text = contentBlockText(blocks[i]);
    if (text !== null) pushText(acc, text);
  }
}

function stringListItem(entry: unknown): string | null {
  const text = nonEmptyString(entry);
  return text === null ? null : itemText(text);
}

function fileMatchItems(entry: unknown): ToolOutputMatch[] {
  const record = asRecord(entry);
  if (record === null) return [];
  const path = nonEmptyString(safeGet(record, 'path'));
  const sub = safeGet(record, 'matches');
  if (!Array.isArray(sub)) return [];
  const out: ToolOutputMatch[] = [];
  const limit = Math.min(sub.length, LIST_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const row = asRecord(sub[i]);
    if (row === null) continue;
    const content = nonEmptyString(safeGet(row, 'content'));
    if (content === null) continue;
    const line = safeGet(row, 'line_number');
    out.push({
      path: path === null ? null : itemText(path),
      line: isNonNegativeInteger(line) ? line : null,
      text: itemText(content),
    });
  }
  return out;
}

function webResultItems(entry: unknown): { title: string | null; url: string }[] {
  const record = asRecord(entry);
  if (record === null) return [];
  const single = webHit(record);
  if (single !== null) return [single];
  const content = safeGet(record, 'content');
  if (!Array.isArray(content)) return [];
  const out: { title: string | null; url: string }[] = [];
  const limit = Math.min(content.length, LIST_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const hit = webHit(asRecord(content[i]));
    if (hit !== null) out.push(hit);
  }
  return out;
}

function webHit(
  record: Record<string, unknown> | null
): { title: string | null; url: string } | null {
  if (record === null) return null;
  const url = nonEmptyString(safeGet(record, 'url'));
  if (url === null) return null;
  const title = nonEmptyString(safeGet(record, 'title'));
  return { url: itemText(url), title: title === null ? null : itemText(title) };
}

/** Scalar → field text; `{…}` for records, `[n]` for arrays, null for values that contribute nothing. */
function fieldValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return sanitizeBounded(value, MAX_FIELD_VALUE_CODE_UNITS).text;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${String(value.length)}]`;
  if (asRecord(value) !== null) return '{…}';
  return null;
}

function applyFields(
  record: Record<string, unknown>,
  state: NormState,
  get: (key: string) => unknown
): void {
  const keys = ownKeys(record);
  if (keys === null) {
    state.accessError = true;
    return;
  }
  let scanned = 0;
  for (const key of keys) {
    if (scanned >= MAX_FIELD_KEYS_SCANNED || state.fields.length >= MAX_OUTPUT_FIELDS) break;
    scanned++;
    const text = fieldValue(get(key));
    if (text === null) continue;
    state.fields.push({ key, value: text });
  }
}

function applyRecord(record: Record<string, unknown>, state: NormState): void {
  // Direct reads on this record funnel through `get` so a throwing getter/proxy
  // marks accessError instead of silently fabricating an empty output.
  const get = (key: string): unknown => {
    try {
      return record[key];
    } catch {
      state.accessError = true;
      return undefined;
    }
  };
  const grepShaped = isGrepShaped(get);

  // Terminal text: stdout then non-empty stderr, then a decoded byte output.
  const stdout = nonEmptyString(get('stdout'));
  if (stdout !== null) pushText(state.acc, stdout);
  const stderr = nonEmptyString(get('stderr'));
  if (stderr !== null) pushText(state.acc, stderr);
  const rawBytes = get('output');
  if (Array.isArray(rawBytes)) {
    const inspected = inspectBytes(rawBytes);
    if (inspected.verdict === 'corrupt') {
      state.unreadable = true;
    } else if (inspected.verdict === 'ok' && inspected.bytes !== undefined) {
      if (rawBytes.length > inspected.bytes.length) state.acc.truncated = true;
      const decoded = BYTE_DECODER.decode(inspected.bytes);
      if (decoded.length > 0) pushText(state.acc, decoded);
    }
  }

  // File preview text: file.content, FileContent.content, Content.content, or create + content.
  for (const wrapKey of ['file', 'FileContent', 'Content'] as const) {
    const wrap = asRecord(get(wrapKey));
    const content = wrap === null ? null : nonEmptyString(safeGet(wrap, 'content'));
    if (content !== null) pushText(state.acc, content);
  }
  const contentValue = get('content');
  const contentString = nonEmptyString(contentValue);
  if (get('type') === 'create' && contentString !== null) {
    pushText(state.acc, contentString);
  }

  // Web fetch result.
  const result = nonEmptyString(get('result'));
  if (result !== null) pushText(state.acc, result);

  // Bare semantic text key (also the channel a salvaged `text` lands on).
  const textValue = nonEmptyString(get('text'));
  if (textValue !== null) pushText(state.acc, textValue);

  // A non-grep `content` string is preview text; an array is text blocks.
  if (Array.isArray(contentValue)) {
    applyContentArray(state.acc, contentValue);
  } else if (contentString !== null && !grepShaped && get('type') !== 'create') {
    pushText(state.acc, contentString);
  }

  // Grep mode + counts.
  const mode = get('mode');
  if (mode === 'content' || mode === 'files_with_matches' || mode === 'count') {
    state.mode = mode;
  }
  const numMatches = get('numMatches');
  if (isNonNegativeInteger(numMatches)) state.counts.matches ??= numMatches;
  const count = get('count');
  if (isNonNegativeInteger(count)) state.counts.matches ??= count;
  const numFiles = get('numFiles');
  if (isNonNegativeInteger(numFiles)) state.counts.files ??= numFiles;

  // Paths: filenames with exact omission from the array length or a trusted total.
  const filenames = get('filenames');
  if (Array.isArray(filenames)) {
    const totalMatches = get('totalMatches');
    const trusted =
      get('countIsComplete') === true && isNonNegativeInteger(totalMatches) ? totalMatches : null;
    const upstream =
      get('truncated') === true ||
      (isNonNegativeInteger(totalMatches) && totalMatches > filenames.length);
    state.paths = boundList(filenames, entry => toOne(stringListItem(entry)), {
      trustedTotal: trusted,
      upstreamTruncated: upstream,
      flat: true,
    });
  }

  // Matches: Devin structured file_matches win over line-parsed grep content.
  const fileMatches = get('file_matches');
  if (Array.isArray(fileMatches)) {
    state.matches = boundList(fileMatches, fileMatchItems, { flat: false });
  } else if (grepShaped && contentString !== null) {
    const sanitized = sanitizeBounded(contentString, MAX_OUTPUT_TEXT_CODE_UNITS);
    const lines = sanitized.text.split('\n');
    state.matches = boundList(lines, line => toOne(parseMatchLine(line)), { flat: true });
  }

  // Web search results: string entries are model commentary; items with url are results.
  const results = get('results');
  if (Array.isArray(results)) {
    state.webResults = boundList(
      results,
      entry => {
        if (typeof entry === 'string') {
          pushText(state.acc, entry);
          return [];
        }
        return webResultItems(entry);
      },
      { flat: false }
    );
  }

  applyFields(record, state, get);
}

function applyTopArray(value: readonly unknown[], state: NormState): void {
  applyContentArray(state.acc, value);
}

function applyDigitString(raw: string, state: NormState): void {
  if (raw.length > MAX_OUTPUT_TEXT_CODE_UNITS) return;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return;
  const parsed = Number(trimmed);
  if (isNonNegativeInteger(parsed)) state.counts.matches ??= parsed;
}

function looksLikeJson(raw: string): boolean {
  const limit = Math.min(raw.length, 256);
  for (let i = 0; i < limit; i++) {
    const code = raw.charCodeAt(i);
    if (isWs(code)) continue;
    return code === 0x7b || code === 0x5b;
  }
  return false;
}

function applyString(raw: string, state: NormState): void {
  if (!looksLikeJson(raw)) {
    pushText(state.acc, raw);
    applyDigitString(raw, state);
    return;
  }
  if (raw.length <= MAX_JSON_PARSE_CODE_UNITS) {
    try {
      applyValue(JSON.parse(raw), state);
      return;
    } catch {
      // Fall through to salvage.
    }
  }
  const salvaged = salvageJson(raw);
  if (salvaged === null) {
    state.unreadable = true;
    return;
  }
  applyRecord(salvaged, state);
}

function applyValue(value: unknown, state: NormState): void {
  if (value === null || value === undefined) return;
  switch (typeof value) {
    case 'string':
      applyString(value, state);
      return;
    case 'number':
      if (Number.isFinite(value)) {
        pushText(state.acc, String(value));
        if (isNonNegativeInteger(value)) state.counts.matches ??= value;
      }
      return;
    case 'boolean':
      pushText(state.acc, String(value));
      return;
    case 'object': {
      if (Array.isArray(value)) {
        applyTopArray(value, state);
      } else {
        const record = value as Record<string, unknown>;
        try {
          applyRecord(record, state);
        } catch {
          state.accessError = true;
        }
      }
      return;
    }
    default:
      // symbol, function, bigint, undefined: contribute nothing.
      return;
  }
}

function producedAnyChannel(state: NormState): boolean {
  return (
    state.acc.units > 0 ||
    state.paths.items.length > 0 ||
    state.matches.items.length > 0 ||
    state.webResults.items.length > 0 ||
    state.fields.length > 0 ||
    state.counts.matches !== null ||
    state.counts.files !== null ||
    state.mode !== null
  );
}

export function normalizeToolOutput(output: unknown): NormalizedToolOutput {
  const state = freshState();
  try {
    applyValue(output, state);
  } catch {
    return emptyNormalized(true);
  }
  const text = state.acc.units > 0 ? state.acc.parts.join('') : null;
  const unreadable = state.unreadable || (state.accessError && !producedAnyChannel(state));
  return {
    text,
    paths: state.paths,
    matches: state.matches,
    webResults: state.webResults,
    fields: state.fields,
    counts: state.counts,
    mode: state.mode,
    unreadable,
  };
}
