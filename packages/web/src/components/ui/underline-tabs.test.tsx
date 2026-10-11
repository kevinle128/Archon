process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from './underline-tabs';

function render(size?: 'list' | 'node'): string {
  return renderToStaticMarkup(
    <UnderlineTabs defaultValue="a" size={size}>
      <UnderlineTabsList>
        <UnderlineTabsTrigger value="a">Live stream</UnderlineTabsTrigger>
        <UnderlineTabsTrigger value="b">Output</UnderlineTabsTrigger>
      </UnderlineTabsList>
      <UnderlineTabsContent value="a">First</UnderlineTabsContent>
    </UnderlineTabs>
  );
}

describe('UnderlineTabs', () => {
  test('keeps tab semantics and marks the active tab', () => {
    const markup = render();
    expect(markup).toContain('role="tablist"');
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('First');
  });

  test('list size uses a 2px underline and node size uses a 3px underline', () => {
    expect(render('list')).toContain('border-b-2');
    expect(render('node')).toContain('border-b-[3px]');
  });
});
