/**
 * Package-boundary guard for the backend tool formatter: `@archon/workflows`
 * runs upstream of `@archon/web` in the package dependency order, so it must
 * never import Web code. `@archon/web` isn't declared as a dependency here,
 * which already blocks a bare `@archon/web` import at module resolution —
 * this test catches the other way a boundary violation could sneak in: a
 * relative path that reaches across into `packages/web` on disk.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FORBIDDEN_IMPORT_PATTERNS = [/@archon\/web/, /packages\/web/, /\.\.\/web\//] as const;

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const fromImport = /(?:^|;)\s*(?:import|export)\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm;
  const sideEffect = /(?:^|;)\s*import\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(fromImport)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  for (const match of source.matchAll(sideEffect)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

describe('tool-formatter package boundary', () => {
  test('imports no Web code, by bare specifier or by relative path', async () => {
    const path = join(import.meta.dir, 'tool-formatter.ts');
    const source = await readFile(path, 'utf-8');
    const specs = importSpecifiers(source);

    for (const spec of specs) {
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        expect(pattern.test(spec)).toBe(false);
      }
    }
  });

  test('the file has no import statements at all — it is a leaf module by design', async () => {
    // Not a strict requirement of the boundary itself, but this module was
    // deliberately written dependency-free (see its docblock) so the parity
    // fixtures test only the resolver, never a supporting import graph.
    // Guards against silent scope creep back toward a shared module.
    const path = join(import.meta.dir, 'tool-formatter.ts');
    const source = await readFile(path, 'utf-8');
    expect(importSpecifiers(source)).toEqual([]);
  });
});
