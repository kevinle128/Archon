/**
 * The only production module allowed to call `structuredPatch`. Converts a
 * before/after string pair into `GitDiffHunk[]` plus added/deleted counts for
 * the CAP-5 inline file-edit diff. Every path is deterministic: jsdiff ships
 * no default timeout and no default edit-length limit, so an unbounded
 * synchronous Myers diff would hang the thread rather than fail — the module
 * refuses by byte, line, and edit-length bounds instead, all functions of the
 * inputs. `null` means not qualified or refused; the renderer falls back to
 * path plus preview. `{ hunks: [] }` means an identical pair.
 */
import { structuredPatch } from 'diff';

import type { components } from '@/lib/api.generated';

import { sanitizeBounded } from './tool-output';

type GitDiffChange = components['schemas']['GitDiffChange'];
type GitDiffHunk = components['schemas']['GitDiffHunk'];

export const MAX_DIFF_SIDE_BYTES = 65_536;
export const MAX_DIFF_SIDE_LINES = 2_000;
export const MAX_DIFF_EDIT_LENGTH = 2_000;
export const DIFF_CONTEXT_LINES = 4;
export const DIFF_MEMO_ENTRIES = 256;
export const DIFF_MEMO_SOURCE_CODE_UNITS = 1_048_576;

/** Per-line display cap: sanitized text plus escapes plus ellipsis, in UTF-16 code units. */
const DIFF_LINE_CODE_UNITS = 1_024;

const UTF8 = new TextEncoder();

/** Cf format controls plus the two JS-hostile separators — everything a renderer must show, never execute. */
const ESCAPE_POINT = /[\p{Cf}\u{2028}\u{2029}]/u;

export interface DiffHunksResult {
  hunks: GitDiffHunk[];
  added: number;
  deleted: number;
}

export type DiffHunksFn = (before: string, after: string) => DiffHunksResult | null;

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`diff-hunks: ${name} must be a positive finite integer`);
  }
  return value;
}

/**
 * Logical line count without `split`: `''` has zero lines; otherwise the
 * newline count plus one only when the string lacks a trailing newline.
 * Stops counting as soon as `limit` is provably exceeded.
 */
function logicalLines(value: string, limit: number): number {
  if (value.length === 0) return 0;
  let newlines = 0;
  let cursor = 0;
  while (true) {
    const newline = value.indexOf('\n', cursor);
    if (newline === -1) break;
    newlines++;
    if (newlines > limit) return newlines;
    cursor = newline + 1;
  }
  return value.endsWith('\n') ? newlines : newlines + 1;
}

/** Escape an ASCII hex code point as literal `\u{HEX}` text (uppercase). */
function escapePoint(point: number): string {
  return `\\u{${point.toString(16).toUpperCase()}}`;
}

/**
 * Display-only line content: `sanitizeBounded` strips ANSI/C0/C1 inside the
 * ceiling, then every surviving Cf control and U+2028/U+2029 is escaped as
 * visible ASCII `\u{HEX}` under a bounded code-point accumulator. An ellipsis
 * marks either truncation and always fits inside the same ceiling. The raw
 * pair is what gets diffed — this shapes only the stored display text.
 */
function displayLine(raw: string): string {
  const bounded = sanitizeBounded(raw, DIFF_LINE_CODE_UNITS);
  let out = '';
  let cut = bounded.truncated;
  for (const char of bounded.text) {
    const point = char.codePointAt(0) ?? 0;
    const piece = ESCAPE_POINT.test(char) ? escapePoint(point) : char;
    if (out.length + piece.length > DIFF_LINE_CODE_UNITS) {
      cut = true;
      break;
    }
    out += piece;
  }
  if (!cut) return out;
  if (out.length < DIFF_LINE_CODE_UNITS) return `${out}…`;
  const last = out.charCodeAt(DIFF_LINE_CODE_UNITS - 1);
  const cutAt =
    last >= 0xdc00 && last <= 0xdfff ? DIFF_LINE_CODE_UNITS - 2 : DIFF_LINE_CODE_UNITS - 1;
  return `${out.slice(0, Math.max(0, cutAt))}…`;
}

/**
 * Bounded, memoized before/after → `GitDiffHunk[]` conversion.
 *
 * Bounds: a `.length` precheck refuses sides that cannot fit the byte cap
 * (UTF-8 is never shorter than UTF-16) before any work — deliberately
 * uncached so an oversized pair is never retained. Cache hits refresh LRU
 * order by delete/reinsert. On a miss both sides are measured with the
 * injected `byteLength` or a shared `TextEncoder`, logical lines are counted
 * without `split`, and the patch runs with fixed `context`/`maxEditLength` —
 * never a timeout or normalization option. `undefined`, thrown, and refused
 * results all cache `null`; every computed result is cached. Insertion
 * evicts least-recently-used entries until both the entry-count and the
 * source-code-unit budgets hold — the key retains source text, so the weight
 * budget caps retained input at roughly eight maximum-size pairs instead of
 * 256.
 */
export function createDiffHunks(options?: {
  memoEntries?: number;
  memoSourceCodeUnits?: number;
  patch?: typeof structuredPatch;
  byteLength?: (value: string) => number;
}): DiffHunksFn {
  const memoEntries = positiveInteger(options?.memoEntries, DIFF_MEMO_ENTRIES, 'memoEntries');
  const memoUnits = positiveInteger(
    options?.memoSourceCodeUnits,
    DIFF_MEMO_SOURCE_CODE_UNITS,
    'memoSourceCodeUnits'
  );
  const patch = options?.patch ?? structuredPatch;
  const measure = options?.byteLength ?? ((value: string): number => UTF8.encode(value).length);
  if (typeof patch !== 'function' || typeof measure !== 'function') {
    throw new Error('diff-hunks: patch and byteLength must be functions');
  }

  interface MemoEntry {
    result: DiffHunksResult | null;
    weight: number;
  }
  const cache = new Map<string, MemoEntry>();
  let totalWeight = 0;

  function convert(
    patchHunks: readonly {
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: string[];
    }[]
  ): DiffHunksResult {
    const hunks: GitDiffHunk[] = [];
    let added = 0;
    let deleted = 0;
    for (const hunk of patchHunks) {
      const changes: GitDiffChange[] = [];
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      for (const entry of hunk.lines) {
        const marker = entry.charAt(0);
        // `\ No newline at end of file` may appear mid-array and more than
        // once; it advances neither counter and is no display line.
        if (marker === '\\') continue;
        const content = displayLine(entry.slice(1));
        if (marker === ' ') {
          changes.push({ type: 'normal', content, oldLine, newLine });
          oldLine++;
          newLine++;
        } else if (marker === '-') {
          changes.push({ type: 'delete', content, oldLine });
          oldLine++;
          deleted++;
        } else if (marker === '+') {
          changes.push({ type: 'insert', content, newLine });
          newLine++;
          added++;
        }
      }
      hunks.push({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        header: `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
        changes,
      });
    }
    return { hunks, added, deleted };
  }

  function compute(before: string, after: string): DiffHunksResult | null {
    const beforeBytes = measure(before);
    const afterBytes = measure(after);
    if (beforeBytes > MAX_DIFF_SIDE_BYTES || afterBytes > MAX_DIFF_SIDE_BYTES) return null;
    if (logicalLines(before, MAX_DIFF_SIDE_LINES) > MAX_DIFF_SIDE_LINES) return null;
    if (logicalLines(after, MAX_DIFF_SIDE_LINES) > MAX_DIFF_SIDE_LINES) return null;
    let result;
    try {
      result = patch('', '', before, after, '', '', {
        context: DIFF_CONTEXT_LINES,
        maxEditLength: MAX_DIFF_EDIT_LENGTH,
      });
    } catch {
      return null;
    }
    if (result === undefined) return null;
    return convert(result.hunks);
  }

  return (before: string, after: string): DiffHunksResult | null => {
    if (before.length > MAX_DIFF_SIDE_BYTES || after.length > MAX_DIFF_SIDE_BYTES) {
      return null;
    }
    const key = `${String(before.length)}:${before}${String(after.length)}:${after}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.result;
    }
    const result = compute(before, after);
    const weight = before.length + after.length;
    cache.set(key, { result, weight });
    totalWeight += weight;
    while (cache.size > 1 && (cache.size > memoEntries || totalWeight > memoUnits)) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      totalWeight -= cache.get(oldest.value)?.weight ?? 0;
      cache.delete(oldest.value);
    }
    return result;
  };
}

export const diffHunks: DiffHunksFn = createDiffHunks();
