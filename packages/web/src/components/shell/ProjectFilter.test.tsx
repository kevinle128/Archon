import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';
import { ProjectFilter } from './ProjectFilter';

const CODEBASES = [
  { id: 'cb-1', name: 'api', repository_url: 'https://github.com/acme/api' },
  { id: 'cb-2', name: 'ops-folder', repository_url: null },
];

describe('ProjectFilter markup', () => {
  test('lists All projects first, then each project by display name', () => {
    const html = renderToStaticMarkup(
      <ProjectFilter codebases={CODEBASES} value={null} onChange={(): void => undefined} />
    );
    expect(html).toContain('Project');
    expect(html.indexOf('All projects')).toBeLessThan(html.indexOf('acme/api'));
    expect(html).toContain('ops-folder');
  });
});

describe('ProjectFilter change', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
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

  async function select(value: string, initial: string | null): Promise<(string | null)[]> {
    const calls: (string | null)[] = [];
    await act(async () => {
      root.render(
        <ProjectFilter
          codebases={CODEBASES}
          value={initial}
          onChange={(id): void => {
            calls.push(id);
          }}
        />
      );
    });
    const el = host.querySelector('select') as unknown as HTMLSelectElement;
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
    });
    return calls;
  }

  test('writes the codebase ID of the chosen project', async () => {
    expect(await select('cb-2', null)).toEqual(['cb-2']);
  });

  test('writes null for All projects', async () => {
    expect(await select('', 'cb-1')).toEqual([null]);
  });
});
