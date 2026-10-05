import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { GitChangedFile, GitReadyDiffResponse } from '@/lib/api';

import { FileViewer, type FileViewerState } from './file-viewer';

const MODIFIED: GitChangedFile = { path: 'src/a.ts', status: 'M' };
const ADDED: GitChangedFile = { path: 'new.ts', status: 'A' };
const DELETED: GitChangedFile = { path: 'gone.ts', status: 'D' };
const BINARY: GitChangedFile = { path: 'blob.bin', status: 'A' };
const ATTACKER = '<img src=x onerror=alert(1)>';
const DOWNLOAD_HREF = '/api/workflows/runs/run-1/git/file/blob.bin?source=worktree';

const MARKER_HUNK_DIFF: GitReadyDiffResponse = {
  path: 'src/a.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  cursor: '',
  truncated: false,
  binary: false,
  fileFallback: false,
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      changes: [
        { type: 'normal', content: 'same', oldLine: 1, newLine: 1 },
        { type: 'delete', content: 'old', oldLine: 2 },
        { type: 'insert', content: 'new', newLine: 2 },
        { type: 'normal', content: 'tail', oldLine: 3, newLine: 3 },
      ],
    },
  ],
};

const LINE_TRAP_DIFF: GitReadyDiffResponse = {
  path: 'src/a.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  cursor: '',
  truncated: false,
  binary: false,
  fileFallback: false,
  hunks: [
    {
      header: '@@ -4,1 +9,1 @@',
      oldStart: 4,
      oldLines: 1,
      newStart: 9,
      newLines: 1,
      changes: [{ type: 'normal', content: 'context', oldLine: 4, newLine: 9 }],
    },
  ],
};

type ViewerProps = ComponentProps<typeof FileViewer>;

function renderViewer(
  state: FileViewerState,
  overrides: Partial<Pick<ViewerProps, 'stacked'>> = {}
): string {
  return renderToStaticMarkup(
    <FileViewer
      state={state}
      stacked={overrides.stacked ?? false}
      onCancel={(): void => undefined}
      onReload={(): void => undefined}
      onClose={(): void => undefined}
      onLoadMore={(): void => undefined}
    />
  );
}

type HappyDocument = InstanceType<typeof Window>['document'];
type HappyElement = NonNullable<ReturnType<HappyDocument['querySelector']>>;

function parseDocument(html: string): HappyDocument {
  const win = new Window();
  win.document.body.innerHTML = html;
  return win.document;
}

function pane(html: string, label: 'Before' | 'After'): HappyElement {
  const named = parseDocument(html).querySelector(`[aria-label="${label}"]`);
  if (!named) throw new Error(`Missing ${label} pane`);
  return named;
}

function assertQuietChrome(html: string): void {
  expect(html).not.toContain('Snapshot');
  expect(html).not.toContain('>Stage<');
  expect(html).not.toContain('>Edit<');
  expect(html).not.toContain('>Discard<');
  expect(html).not.toContain('>Commit<');
  expect(html).not.toContain('History');
  expect(html).not.toContain('Error:');
  expect(html).not.toContain('unsupported');
  expect(html).not.toContain('⚠️');
  expect(html).not.toContain('⚠');
}

const STATES: readonly FileViewerState[] = [
  { kind: 'idle' },
  { kind: 'loading', file: MODIFIED },
  {
    kind: 'diff',
    file: MODIFIED,
    response: MARKER_HUNK_DIFF,
    reloadFingerprint: JSON.stringify(MARKER_HUNK_DIFF),
  },
  {
    kind: 'text',
    file: ADDED,
    text: 'const x = 1;\n',
    contentHash: 'a'.repeat(64),
    truncated: false,
    cursor: '',
  },
  {
    kind: 'hex',
    file: BINARY,
    contentHash: 'b'.repeat(64),
    hex: '00000000  00 41 ff                                         |.A.             |',
    downloadHref: DOWNLOAD_HREF + '&download=1',
  },
  {
    kind: 'download',
    file: BINARY,
    contentHash: 'b'.repeat(64),
    downloadHref: DOWNLOAD_HREF + '&download=1',
  },
  { kind: 'unavailable', file: MODIFIED, emptyReason: 'no_checkout' },
  { kind: 'unavailable', file: MODIFIED, emptyReason: 'container' },
  { kind: 'error', file: MODIFIED },
];

describe('FileViewer', () => {
  test('idle says Select a file to view', () => {
    const html = renderViewer({ kind: 'idle' });
    expect(html).toContain('Select a file to view');
    expect(html).toContain('No file selected');
    expect(html).not.toContain('>Cancel<');
    expect(html).not.toContain('aria-label="Close"');
    assertQuietChrome(html);
  });

  test('loading has a status skeleton and a native Cancel button', () => {
    const html = renderViewer({ kind: 'loading', file: MODIFIED });
    expect(html).toContain('src/a.ts');
    expect(html).toContain('role="status"');
    expect(html).toContain('>Cancel<');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('>Reload<');
    assertQuietChrome(html);
  });

  test('modified text has labelled Before and After panes, one minus, one plus, and no Snapshot', () => {
    const html = renderViewer({
      kind: 'diff',
      file: MODIFIED,
      response: MARKER_HUNK_DIFF,
      reloadFingerprint: JSON.stringify(MARKER_HUNK_DIFF),
    });
    const before = pane(html, 'Before').innerHTML;
    const after = pane(html, 'After').innerHTML;
    expect(html).toContain('Before');
    expect(html).toContain('After');
    expect(html).toContain('sc-diff-before');
    expect(html).toContain('sc-diff-after');
    expect(before).toContain('class="sc-diff-marker">-</span>');
    expect(before).not.toContain('class="sc-diff-marker">+</span>');
    expect(after).toContain('class="sc-diff-marker">+</span>');
    expect(after).not.toContain('class="sc-diff-marker">-</span>');
    expect(html).not.toContain('Snapshot');
    assertQuietChrome(html);
  });

  test('a normal context line renders oldLine 4 in Before and newLine 9 in After', () => {
    const html = renderViewer({
      kind: 'diff',
      file: MODIFIED,
      response: LINE_TRAP_DIFF,
      reloadFingerprint: JSON.stringify(LINE_TRAP_DIFF),
    });
    const beforeGutters = pane(html, 'Before').querySelectorAll(
      '.diff-gutter:not(.diff-gutter-omit)'
    );
    const afterGutters = pane(html, 'After').querySelectorAll(
      '.diff-gutter:not(.diff-gutter-omit)'
    );
    const firstBefore = beforeGutters[0];
    const lastAfter = afterGutters[afterGutters.length - 1];
    if (!firstBefore || !lastAfter) throw new Error('Missing gutters');
    expect(html).toContain('diff-split');
    expect(html).not.toContain('diff-unified');
    expect(firstBefore.textContent).toContain('4');
    expect(lastAfter.textContent).toContain('9');
  });

  test('wide modified mode is side-by-side and stacked mode is before-over-after', () => {
    const wide = renderViewer({
      kind: 'diff',
      file: MODIFIED,
      response: MARKER_HUNK_DIFF,
      reloadFingerprint: JSON.stringify(MARKER_HUNK_DIFF),
    });
    const stacked = renderViewer(
      {
        kind: 'diff',
        file: MODIFIED,
        response: MARKER_HUNK_DIFF,
        reloadFingerprint: JSON.stringify(MARKER_HUNK_DIFF),
      },
      { stacked: true }
    );
    expect(wide).toContain('flex-row');
    expect(stacked).not.toContain('flex-row');
  });

  test('each modified pane has its own two-axis scroll container and tabIndex 0', () => {
    const html = renderViewer({
      kind: 'diff',
      file: MODIFIED,
      response: MARKER_HUNK_DIFF,
      reloadFingerprint: JSON.stringify(MARKER_HUNK_DIFF),
    });
    const before = pane(html, 'Before');
    const after = pane(html, 'After');
    expect(before.getAttribute('tabindex')).toBe('0');
    expect(after.getAttribute('tabindex')).toBe('0');
    expect(before.className).toContain('overflow-auto');
    expect(after.className).toContain('overflow-auto');
    expect(before).not.toBe(after);
  });

  test('added and deleted text use one highlighted pane with no diff insert or delete classes', () => {
    const added = renderViewer({
      kind: 'text',
      file: ADDED,
      text: 'function greet(name: string): string {\n  return name;\n}',
      contentHash: 'a'.repeat(64),
      truncated: false,
      cursor: '',
    });
    const deleted = renderViewer({
      kind: 'text',
      file: DELETED,
      text: 'const gone = true;\n',
      contentHash: 'c'.repeat(64),
      truncated: false,
      cursor: '',
    });
    expect(added).toContain('class="hljs"');
    expect(added).toContain('<pre');
    expect(added).toContain('hljs-');
    expect(added).not.toContain('diff-code-insert');
    expect(added).not.toContain('diff-code-delete');
    expect(added).not.toContain('sc-diff-before');
    expect(deleted).toContain('class="hljs"');
    expect(deleted).not.toContain('diff-code-insert');
    expect(deleted).not.toContain('diff-code-delete');
    assertQuietChrome(added);
    assertQuietChrome(deleted);
  });

  test('attacker-controlled source renders as text and creates no image element', () => {
    const textHtml = renderViewer({
      kind: 'text',
      file: ADDED,
      text: ATTACKER,
      contentHash: 'a'.repeat(64),
      truncated: false,
      cursor: '',
    });
    const diffHtml = renderViewer({
      kind: 'diff',
      file: MODIFIED,
      response: {
        ...MARKER_HUNK_DIFF,
        hunks: [
          {
            header: '@@ -1,1 +1,1 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            changes: [{ type: 'insert', content: ATTACKER, newLine: 1 }],
          },
        ],
      },
      reloadFingerprint: JSON.stringify(MARKER_HUNK_DIFF),
    });
    expect(textHtml).toContain('&lt;');
    expect(textHtml).not.toContain('<img');
    expect(parseDocument(textHtml).querySelector('img')).toBeNull();
    expect(diffHtml).toContain('&lt;');
    expect(parseDocument(diffHtml).querySelector('img')).toBeNull();
  });

  test('no_checkout has distinct copy with Reload while container has none', () => {
    const missing = renderViewer({
      kind: 'unavailable',
      file: MODIFIED,
      emptyReason: 'no_checkout',
    });
    const hosted = renderViewer({ kind: 'unavailable', file: MODIFIED, emptyReason: 'container' });
    expect(missing).toContain('This run&#x27;s checkout isn&#x27;t available right now.');
    expect(missing).toContain('aria-label="Reload"');
    expect(hosted).toContain('This run&#x27;s files aren&#x27;t available on the host.');
    expect(hosted).not.toContain('aria-label="Reload"');
    expect(hosted).not.toContain('This run&#x27;s checkout isn&#x27;t available right now.');
    assertQuietChrome(missing);
    assertQuietChrome(hosted);
  });

  test('error keeps the file heading and quiet Could not open this file copy plus Reload', () => {
    const html = renderViewer({ kind: 'error', file: MODIFIED });
    expect(html).toContain('src/a.ts');
    expect(html).toContain('Could not open this file.');
    expect(html).toContain('aria-label="Reload"');
    expect(html).not.toContain('Error:');
    expect(html).not.toContain('TypeError');
    assertQuietChrome(html);
  });

  test('Close is a native button with an accessible label on non-idle states', () => {
    for (const state of STATES) {
      const html = renderViewer(state);
      if (state.kind === 'idle') {
        expect(html).not.toContain('aria-label="Close"');
        continue;
      }
      expect(html).toContain('aria-label="Close"');
      expect(html).toContain('type="button"');
      assertQuietChrome(html);
    }
  });

  test('a truncated text page and truncated diff expose Load more', () => {
    const text = renderViewer({
      kind: 'text',
      file: ADDED,
      text: 'hello\n',
      contentHash: 'a'.repeat(64),
      truncated: true,
      cursor: 'next',
    });
    expect(text).toContain('>Load more<');
    const diff = renderViewer({
      kind: 'diff',
      file: MODIFIED,
      response: { ...MARKER_HUNK_DIFF, truncated: true, cursor: 'next' },
      reloadFingerprint: 'next',
    });
    expect(diff).toContain('>Load more<');
  });

  test('loadingMore replaces Load more with Cancel without hiding painted text', () => {
    const html = renderToStaticMarkup(
      <FileViewer
        state={{
          kind: 'text',
          file: ADDED,
          text: 'painted\n',
          contentHash: 'a'.repeat(64),
          truncated: true,
          cursor: 'next',
        }}
        stacked={false}
        loadingMore={true}
        onCancel={(): void => undefined}
        onReload={(): void => undefined}
        onClose={(): void => undefined}
        onLoadMore={(): void => undefined}
      />
    );
    expect(html).toContain('painted');
    expect(html).toContain('>Cancel<');
    expect(html).not.toContain('>Load more<');
  });

  test('image state offers Download without highlighting or inline SVG markup', () => {
    const html = renderViewer({
      kind: 'image',
      file: { path: 'tiny.svg', status: 'A' },
      contentHash: 'b'.repeat(64),
      bytes: Buffer.from('<svg><script>bad()</script></svg>'),
      mediaType: 'image/svg+xml',
      downloadHref: DOWNLOAD_HREF + '&download=1',
    });
    expect(html).toContain('>Download<');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('class="hljs"');
  });

  test('hex renders a plain preformatted peek and a download link', () => {
    const html = renderViewer({
      kind: 'hex',
      file: BINARY,
      contentHash: 'b'.repeat(64),
      hex: '00000000  00 41 ff                                         |.A.             |',
      downloadHref: DOWNLOAD_HREF + '&download=1',
    });
    expect(html).toContain('00000000');
    expect(html).toContain('>Download<');
    expect(html).not.toContain('class="hljs"');
    expect(html).not.toContain('sc-diff-before');
  });

  test('download-only has no preformatted body', () => {
    const html = renderViewer({
      kind: 'download',
      file: BINARY,
      contentHash: 'b'.repeat(64),
      downloadHref: DOWNLOAD_HREF + '&download=1',
    });
    expect(html).toContain('This file is too large to open here.');
    expect(html).toContain('>Download<');
    expect(html).not.toContain('<pre');
  });
});
