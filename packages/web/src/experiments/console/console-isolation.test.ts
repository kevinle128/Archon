import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONSOLE_ROOT = import.meta.dir;

const FORBIDDEN_SPEC_PREFIXES = [
  '@/components',
  '@/stores',
  '@/contexts',
  '@/routes',
  '@/hooks',
  '@tanstack/react-query',
] as const;

interface ImportSite {
  spec: string;
  typeOnly: boolean;
}

function isTestFile(relativePath: string): boolean {
  return relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx');
}

function isProductionSource(relativePath: string): boolean {
  return (
    (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) && !isTestFile(relativePath)
  );
}

function compact(source: string): string {
  return source.replace(/\s+/g, '');
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

function isForbiddenSpec(spec: string): boolean {
  if (spec === '@/lib/api' || spec.startsWith('@/lib/api/')) return true;
  return FORBIDDEN_SPEC_PREFIXES.some(
    prefix => spec === prefix || spec.startsWith(`${prefix}/`) || spec.startsWith(`${prefix}?`)
  );
}

async function productionFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const path of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: CONSOLE_ROOT })) {
    const relativePath = path.replaceAll('\\', '/');
    if (isProductionSource(relativePath)) files.push(relativePath);
  }
  files.sort();
  return files;
}

describe('console NFR4 isolation', () => {
  test('production files do not import legacy UI, React Query, or runtime API modules', async () => {
    const violations: string[] = [];
    for (const relativePath of await productionFiles()) {
      const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
      for (const site of parseImports(source)) {
        if (isForbiddenSpec(site.spec)) {
          violations.push(`${relativePath} imports ${site.spec}`);
          continue;
        }
        if (site.spec === '@/lib/api.generated' || site.spec.startsWith('@/lib/api.generated/')) {
          if (!site.typeOnly) {
            violations.push(`${relativePath} runtime-imports ${site.spec}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('run-room files import approved shared lib modules and no Legacy components', async () => {
    const roomFiles = [
      'components/ConsoleInspectPane.tsx',
      'components/ConsoleNodeRoom.tsx',
      'components/ConsoleComposerDock.tsx',
      'components/inspect/ConsoleRoomHeader.tsx',
      'components/inspect/ConsoleAgentHistoryList.tsx',
      'components/inspect/ConsoleExecutionHistory.tsx',
      'components/inspect/execution-interactions.ts',
      'components/NodeDivider.tsx',
      'routes/RunDetailPage.tsx',
    ];
    const approved = new Set([
      '@/lib/agent-history',
      '@/lib/execution-room-model',
      '@/lib/node-message-pages',
      '@/lib/occurrence-groups',
      '@/lib/room-scroll-follow',
      '@/lib/room-split-layout',
      '@/lib/use-container-split-mode',
      '@/lib/pair-tool-transcript',
      '@/lib/project-text-transcript',
      '@/lib/tool-presentation',
      // Concrete need (issue #176): the body bar's sent-name fallback must run
      // the same bounded ANSI/control sanitization as the Legacy renderer;
      // tool-presentation does not re-export it.
      '@/lib/tool-output',
      '@/lib/run-graph',
      '@/lib/run-graph/constants',
      '@/lib/api.generated',
      '@/lib/steering-dock',
    ]);
    const violations: string[] = [];
    const seen = new Set<string>();
    for (const relativePath of roomFiles) {
      const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
      for (const site of parseImports(source)) {
        if (site.spec.includes('components/workflows') || site.spec.startsWith('@/components')) {
          violations.push(`${relativePath} imports ${site.spec}`);
        }
        if (site.spec.startsWith('@/lib/')) {
          seen.add(site.spec);
          const allowed = approved.has(site.spec) || site.spec.startsWith('@/lib/run-graph/');
          if (!allowed) {
            violations.push(`${relativePath} imports unapproved ${site.spec}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
    expect(seen.has('@/lib/execution-room-model')).toBe(true);
    expect(seen.has('@/lib/agent-history')).toBe(true);
    expect(seen.has('@/lib/node-message-pages')).toBe(true);
    expect(seen.has('@/lib/room-scroll-follow')).toBe(true);
    expect(seen.has('@/lib/room-split-layout')).toBe(true);
    expect(seen.has('@/lib/use-container-split-mode')).toBe(true);
  });

  test('status cards wire consoleRunHref to current-node or approval-node ids', async () => {
    const card = compact(
      await readFile(join(CONSOLE_ROOT, 'components/ConsoleWorkflowResultCard.tsx'), 'utf8')
    );
    const dock = compact(await readFile(join(CONSOLE_ROOT, 'components/WorkflowDock.tsx'), 'utf8'));
    expect(card).toContain("from'./console-run-href'");
    expect(card).toContain('consoleRunHref(run.projectId,run.id,run.currentNode??null)');
    expect(dock).toContain("from'./console-run-href'");
    expect(dock).toContain('consoleRunHref(run.projectId,run.id,run.currentNode??null)');
    expect(dock).toContain(
      'consoleRunHref(run.projectId,run.id,run.approval?.nodeId??run.currentNode??null)'
    );
  });

  test('Ask UI stays console-owned and out of the conversation composer', async () => {
    const askSurfaceFiles = [
      'components/ConsoleNodeRoom.tsx',
      'components/ConsoleInspectPane.tsx',
      'routes/RunDetailPage.tsx',
    ];
    const importViolations: string[] = [];
    for (const relativePath of askSurfaceFiles) {
      const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
      for (const site of parseImports(source)) {
        if (site.spec.includes('components/workflows') || site.spec.endsWith('/ChatComposer')) {
          importViolations.push(`${relativePath} imports ${site.spec}`);
        }
      }
    }
    expect(importViolations).toEqual([]);

    const room = compact(
      await readFile(join(CONSOLE_ROOT, 'components/ConsoleNodeRoom.tsx'), 'utf8')
    );
    const page = compact(await readFile(join(CONSOLE_ROOT, 'routes/RunDetailPage.tsx'), 'utf8'));
    expect(room).toContain("from'./ask/ConsoleAskCard'");
    expect(page).toContain("from'../components/ask/ConsoleAskChrome'");

    const chatViolations: string[] = [];
    for (const relativePath of ['components/ChatComposer.tsx', 'routes/ChatPage.tsx']) {
      const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
      for (const identifier of [
        'pendingInteractions',
        'answerAskHuman',
        'ConsoleAskCard',
        'ConsoleAskChrome',
      ]) {
        if (source.includes(identifier)) {
          chatViolations.push(`${relativePath} contains ${identifier}`);
        }
      }
    }
    expect(chatViolations).toEqual([]);
  });
});
