import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCallItem } from './ToolCallItem';
import { StreamContextProvider } from '../lib/stream-context';
import type { InlineToolCall } from '../primitives/message';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';

const TIMESTAMP = '2026-06-05T10:00:01.000Z';

function call(overrides: Partial<InlineToolCall> = {}): InlineToolCall {
  return {
    name: 'Bash',
    input: { command: 'npm test' },
    outcome: 'succeeded',
    ...overrides,
  };
}

function markup(toolCall: InlineToolCall): string {
  return renderToStaticMarkup(
    createElement(StreamContextProvider, {
      value: { runStartedAt: TIMESTAMP },
      children: createElement(ToolCallItem, { call: toolCall, timestamp: TIMESTAMP }),
    })
  );
}

describe('ToolCallItem — collapsed row', () => {
  test('a succeeded call collapses by default and shows no raw JSON', () => {
    const html = markup(call({ output: 'ok', durationMs: 120 }));
    expect(html).toContain('▸');
    expect(html).not.toContain('▾');
    expect(html).not.toContain('"command"');
    expect(html).not.toContain('{&quot;');
  });

  test('a failed call expands by default and carries an exit badge', () => {
    const html = markup(call({ outcome: 'failed', exitCode: 1, output: 'boom' }));
    expect(html).toContain('▾');
    expect(html).toContain('exit 1');
  });

  test('status is decodable from a glyph and a screen-reader label, not colour alone', () => {
    const succeededHtml = markup(call({ outcome: 'succeeded' }));
    expect(succeededHtml).toContain('✓');
    expect(succeededHtml).toContain('>succeeded<');

    const failedHtml = markup(call({ outcome: 'failed' }));
    expect(failedHtml).toContain('✕');
    expect(failedHtml).toContain('>failed<');
  });

  test('a running call shows the running badge and an interrupted call shows interrupted, not failed', () => {
    const runningHtml = markup(call({ outcome: 'running' }));
    expect(runningHtml).toContain('◐');
    expect(runningHtml).toContain('running');

    const interruptedHtml = markup(call({ outcome: 'interrupted' }));
    expect(interruptedHtml).toContain('⚠');
    expect(interruptedHtml).toContain('interrupted');
    expect(interruptedHtml).not.toContain('✕');
  });

  test('a long path headline elides in the middle, keeping the filename visible', () => {
    const html = markup(
      call({
        name: 'Read',
        input: { file_path: `/very/${'deep/'.repeat(30)}component.tsx` },
        output: 'contents',
      })
    );
    expect(html).toContain('component.tsx');
  });

  test('an unrecognized tool degrades to the safe generic fallback, never a JSON dump', () => {
    const html = markup(call({ name: 'totally_unknown_tool', input: { one: 1, two: 2 } }));
    expect(html).not.toContain('{&quot;one&quot;');
    expect(html).toContain('one: 1');
  });
});

describe('ToolCallItem — disclosure interaction', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: ReturnType<typeof createRoot>;

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
      root.render(
        createElement(StreamContextProvider, {
          value: { runStartedAt: TIMESTAMP },
          children: createElement(ToolCallItem, {
            call: call({ output: 'ok', durationMs: 5 }),
            timestamp: TIMESTAMP,
          }),
        })
      );
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
