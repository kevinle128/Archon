process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import type { ToolCallDisplay } from '@/lib/types';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';
import { ToolCallCard } from './ToolCallCard';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const STARTED_AT = Date.parse('2026-09-07T12:00:00.000Z');

function tool(overrides: Partial<ToolCallDisplay> = {}): ToolCallDisplay {
  return {
    id: 'tool-1',
    name: 'Bash',
    input: { command: 'npm test' },
    startedAt: STARTED_AT,
    isExpanded: false,
    ...overrides,
  };
}

function markup(display: ToolCallDisplay): string {
  return renderToStaticMarkup(createElement(ToolCallCard, { tool: display }));
}

describe('ToolCallCard — collapsed row', () => {
  test('a succeeded call collapses by default and shows no raw JSON', () => {
    const html = markup(tool({ output: 'ok', duration: 120 }));
    expect(html).not.toContain('"command"');
    expect(html).not.toContain('{&quot;');
    expect(html).toContain('✓');
  });

  test('a running call has no output/duration yet and shows the running glyph', () => {
    const html = markup(tool());
    expect(html).toContain('◐');
  });

  test('an operator-cancelled call proves interruption', () => {
    const html = markup(tool({ status: 'cancelled' }));
    expect(html).toContain('⚠');
    expect(html).toContain('interrupted');
  });

  test('a stopped call (run ended, tool never returned) is unknown, not a guessed interrupted', () => {
    const html = markup(tool({ status: 'stopped' }));
    expect(html).toContain('–');
    expect(html).not.toContain('⚠');
  });

  test('a provider-reported error outcome renders as failed and opens by default', () => {
    const html = markup(tool({ output: 'boom', duration: 40, outcome: 'error' }));
    expect(html).toContain('✕');
    expect(html).toContain('aria-expanded="true"');
  });

  test('a non-zero exit code renders as failed with an exit badge', () => {
    const html = markup(tool({ output: 'fail', duration: 40, exitCode: 101 }));
    expect(html).toContain('✕');
    expect(html).toContain('exit 101');
  });

  test('a provider-reported unknown outcome is not shown as succeeded', () => {
    const html = markup(tool({ output: '', duration: 40, outcome: 'unknown' }));
    expect(html).not.toContain('✓');
  });

  test('status is decodable from a glyph and a screen-reader label, not colour alone', () => {
    const html = markup(tool({ output: 'ok', duration: 5 }));
    expect(html).toContain('>succeeded<');
  });

  test('an unrecognized tool degrades to the safe generic fallback, never a JSON dump', () => {
    const html = markup(tool({ name: 'totally_unknown_tool', input: { one: 1, two: 2 } }));
    expect(html).not.toContain('{&quot;one&quot;');
    expect(html).toContain('one: 1');
  });
});

describe('ToolCallCard — disclosure interaction', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  test('clicking the row opens it, and Raw is closed until explicitly toggled', async () => {
    await act(async () => {
      root.render(createElement(ToolCallCard, { tool: tool({ output: 'ok', duration: 5 }) }));
    });

    const summaryButton = host.querySelector('button');
    if (!(summaryButton instanceof HTMLButtonElement)) throw new Error('summary button');
    await act(async () => {
      summaryButton.click();
    });

    expect(host.textContent).not.toContain('"name"');
    const rawButton = [...host.querySelectorAll('button')].find(b =>
      b.textContent?.startsWith('Raw')
    );
    if (!(rawButton instanceof HTMLButtonElement)) throw new Error('raw button');

    await act(async () => {
      rawButton.click();
    });
    expect(host.textContent).toContain('"name"');
    expect(host.textContent).toContain('"command": "npm test"');

    await act(async () => {
      rawButton.click();
    });
    expect(host.textContent).not.toContain('"name"');
  });
});
