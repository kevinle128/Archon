import { afterEach, describe, expect, test } from 'bun:test';
import { installHappyDom, restoreHappyDom } from './install-happy-dom';

function expectSameRef(actual: unknown, expected: unknown): void {
  expect(actual === expected).toBe(true);
}

describe('installHappyDom', () => {
  afterEach(() => {
    restoreHappyDom();
  });

  test('installs a document that createRoot can use after readonly globals exist', () => {
    const priorEvent = Object.getOwnPropertyDescriptor(globalThis, 'Event');
    Object.defineProperty(globalThis, 'Event', {
      configurable: true,
      enumerable: true,
      writable: false,
      value: priorEvent && 'value' in priorEvent ? priorEvent.value : undefined,
    });

    expect(() => {
      Object.assign(globalThis as object, { Event: class ReadonlyProbe {} });
    }).toThrow(/readonly property/i);

    const win = installHappyDom();
    expectSameRef(globalThis.document, win.document);
    expectSameRef(globalThis.Event, win.Event);
    expect(win.document.createElement('div').nodeName).toBe('DIV');
    win.close();
    restoreHappyDom();
    if (priorEvent === undefined) {
      Reflect.deleteProperty(globalThis, 'Event');
    } else {
      Object.defineProperty(globalThis, 'Event', priorEvent);
    }
  });

  test('a second install in the same process does not throw', () => {
    const first = installHappyDom();
    const second = installHappyDom();
    expectSameRef(globalThis.document, second.document);
    expect(second).not.toBe(first);
    second.close();
    restoreHappyDom();
    first.close();
  });
});
