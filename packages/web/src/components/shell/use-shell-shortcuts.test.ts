import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';
import { handleShellKey } from './use-shell-shortcuts';

describe('handleShellKey', () => {
  let win: ReturnType<typeof installHappyDom>;
  let doc: Document;

  beforeEach(() => {
    win = installHappyDom();
    doc = win.document as unknown as Document;
    doc.body.innerHTML = '<input data-list-filter /><textarea></textarea>';
  });

  afterEach(() => {
    win.close();
    restoreHappyDom();
  });

  function key(name: string, target: EventTarget): KeyboardEvent {
    const event = new win.KeyboardEvent('keydown', { key: name }) as unknown as KeyboardEvent;
    Object.defineProperty(event, 'target', { value: target });
    return event;
  }

  test('/ focuses the list filter', () => {
    const filter = doc.querySelector('[data-list-filter]') as HTMLElement;
    expect(handleShellKey(key('/', doc.body), doc)).toBe(true);
    expect(doc.activeElement).toBe(filter);
  });

  test('/ inside a text field types normally', () => {
    const area = doc.querySelector('textarea') as HTMLElement;
    expect(handleShellKey(key('/', area), doc)).toBe(false);
  });

  test('Escape blurs the focused list filter', () => {
    const filter = doc.querySelector('[data-list-filter]') as HTMLElement;
    filter.focus();
    expect(handleShellKey(key('Escape', filter), doc)).toBe(true);
    expect(doc.activeElement).not.toBe(filter);
  });

  test('Escape elsewhere is not handled', () => {
    expect(handleShellKey(key('Escape', doc.body), doc)).toBe(false);
  });
});
