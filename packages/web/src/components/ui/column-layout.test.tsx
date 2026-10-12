process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ColumnLayout } from './column-layout';

describe('ColumnLayout', () => {
  test('applies the column template and lets columns scroll alone', () => {
    const markup = renderToStaticMarkup(
      <ColumnLayout columns="minmax(240px,300px) minmax(0,1fr)">
        <div>List</div>
        <div>Detail</div>
      </ColumnLayout>
    );
    expect(markup).toContain('grid-template-columns:minmax(240px,300px) minmax(0,1fr)');
    expect(markup).toContain('[&amp;&gt;*]:overflow-auto');
    expect(markup).toContain('[&amp;&gt;*]:min-h-0');
    expect(markup).toContain('border-r-2');
  });
});
