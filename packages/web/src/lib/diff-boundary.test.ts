/**
 * Source-ownership boundaries for the CAP-5 inline file-edit diff:
 * `lib/diff-hunks.ts` is the only production caller of `structuredPatch`,
 * both node-room renderers consume `FileDiff`/`toHunkData` and never the
 * differ or the `diff` package, the moved adapter types come from generated
 * API types, and third-party diff imports stay on the v3.3.3 specifiers
 * already proven by source control.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC_ROOT = join(import.meta.dir, '..');

const LEGACY_RENDERER = 'components/workflows/NodeRoom.tsx';
const CONSOLE_RENDERER = 'experiments/console/components/inspect/ConsoleAgentHistoryList.tsx';
const DIFFER = 'lib/diff-hunks.ts';
const ADAPTER = 'lib/git-hunk-adapter.ts';

/** The three specifiers virtualized-diff.tsx proved for react-diff-view v3.3.3. */
const PROVEN_DIFF_VIEW_SPECS = [
  'react-diff-view/esm/index.js',
  'react-diff-view',
  'react-diff-view/style/index.css',
] as const;

interface ImportSite {
  spec: string;
  typeOnly: boolean;
}

function isTestFile(relativePath: string): boolean {
  return relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx');
}

function namedClauseIsTypeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  const inner = trimmed.slice(1, -1);
  const parts = inner
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  return parts.length > 0 && parts.every(part => /^type\b/.test(part));
}

function parseImports(source: string): ImportSite[] {
  const sites: ImportSite[] = [];
  const fromImport =
    /(?:^|;)\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  const sideEffect = /(?:^|;)\s*import\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(fromImport)) {
    const typeKeyword = match[1] !== undefined;
    const clause = match[2] ?? '';
    const spec = match[3] ?? '';
    sites.push({ spec, typeOnly: typeKeyword || namedClauseIsTypeOnly(clause) });
  }
  for (const match of source.matchAll(sideEffect)) {
    const spec = match[1] ?? '';
    if (spec.length === 0) continue;
    if (sites.some(site => site.spec === spec)) continue;
    sites.push({ spec, typeOnly: false });
  }
  return sites;
}

async function productionFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const path of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: SRC_ROOT })) {
    const relativePath = path.replaceAll('\\', '/');
    if (isTestFile(relativePath)) continue;
    files.push(relativePath);
  }
  files.sort();
  return files;
}

async function importsOf(relativePath: string): Promise<ImportSite[]> {
  return parseImports(await readFile(join(SRC_ROOT, relativePath), 'utf8'));
}

describe('inline diff source boundaries', () => {
  test('only lib/diff-hunks.ts imports or calls structuredPatch in production source', async () => {
    const offenders: string[] = [];
    for (const relativePath of await productionFiles()) {
      const source = await readFile(join(SRC_ROOT, relativePath), 'utf8');
      if (source.includes('structuredPatch')) offenders.push(relativePath);
    }
    expect(offenders).toEqual([DIFFER]);
  });

  test('neither node-room renderer imports diff or the differ module', async () => {
    for (const relativePath of [LEGACY_RENDERER, CONSOLE_RENDERER]) {
      const specs = (await importsOf(relativePath)).map(site => site.spec);
      const forbidden = specs.filter(
        spec =>
          spec === 'diff' ||
          spec.startsWith('diff/') ||
          spec === '@/lib/diff-hunks' ||
          spec.endsWith('/diff-hunks')
      );
      expect(forbidden).toEqual([]);
      // Each renderer still consumes the shared data contract, not the differ.
      expect(specs).toContain('@/lib/git-hunk-adapter');
      expect(specs).toContain('@/lib/tool-presentation');
    }
  });

  test('the shared adapter types come from generated API types, not the runtime module', async () => {
    const sites = await importsOf(ADAPTER);
    const generated = sites.filter(site => site.spec === '@/lib/api.generated');
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every(site => site.typeOnly)).toBe(true);
    const runtimeApi = sites.filter(
      site => site.spec === '@/lib/api' || site.spec.startsWith('@/lib/api/')
    );
    expect(runtimeApi).toEqual([]);
  });

  test('third-party diff imports stay on the proven react-diff-view specifiers', async () => {
    for (const relativePath of [LEGACY_RENDERER, CONSOLE_RENDERER]) {
      const sites = (await importsOf(relativePath)).filter(site =>
        site.spec.startsWith('react-diff-view')
      );
      expect(sites.map(site => site.spec).sort()).toEqual([...PROVEN_DIFF_VIEW_SPECS].sort());
      // Runtime values come from the esm entry; the bare specifier is types only.
      expect(sites.find(site => site.spec === 'react-diff-view')?.typeOnly).toBe(true);
      expect(sites.find(site => site.spec === 'react-diff-view/esm/index.js')?.typeOnly).toBe(
        false
      );
    }
  });
});
