import { Window } from 'happy-dom';

/**
 * `@radix-ui/react-use-layout-effect` binds once, at first import:
 * `globalThis.document ? React.useLayoutEffect : () => {}`.
 * Component tests import Radix in filesystem order. A file that imports a
 * dialog before any happy-dom window exists permanently no-ops Presence, so
 * later dialogs never mount. Individual interactive tests install their own
 * window on top of the preload; this is that per-test install/restore pair.
 */
const INSTALLED_GLOBAL_KEYS = [
  'window',
  'document',
  'self',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'SVGElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLFormElement',
  'HTMLIFrameElement',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

const previousGlobalsStack: Map<string, PropertyDescriptor | undefined>[] = [];

function snapshotGlobals(): void {
  const snapshot = new Map<string, PropertyDescriptor | undefined>();
  for (const key of INSTALLED_GLOBAL_KEYS) {
    snapshot.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  previousGlobalsStack.push(snapshot);
}

/**
 * Install one happy-dom binding onto `globalThis`.
 *
 * Bun (and some happy-dom installs) expose DOM keys as readonly or accessor
 * properties. `Object.assign` uses [[Set]] and throws
 * `TypeError: Attempted to assign to readonly property.` for those keys.
 * `defineProperty` uses [[DefineOwnProperty]] and can replace configurable
 * bindings; non-configurable readonly keys are skipped rather than aborting
 * the rest of the install.
 */
function installGlobalValue(key: string, value: unknown): void {
  const existing = Object.getOwnPropertyDescriptor(globalThis, key);
  if (existing?.configurable === false) {
    if (existing.writable === true) {
      (globalThis as Record<string, unknown>)[key] = value;
      return;
    }
    if (typeof existing.set === 'function') {
      Reflect.set(globalThis, key, value);
    }
    return;
  }
  Object.defineProperty(globalThis, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function installGlobalBag(bag: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(bag)) {
    installGlobalValue(key, value);
  }
}

export function restoreHappyDom(): void {
  const snapshot = previousGlobalsStack.pop();
  if (snapshot === undefined) {
    return;
  }
  for (const key of INSTALLED_GLOBAL_KEYS) {
    const descriptor = snapshot.get(key);
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, descriptor);
    }
  }
}

export function installHappyDom(): Window {
  snapshotGlobals();
  const win = new Window({ url: 'https://localhost/' });
  const bag: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    SVGElement: win.SVGElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLButtonElement: win.HTMLButtonElement,
    HTMLSelectElement: win.HTMLSelectElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLFormElement: win.HTMLFormElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    navigator: win.navigator,
    location: win.location,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      const handle = win.requestAnimationFrame(cb as unknown as (time: number) => void);
      return Number(handle);
    },
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    FocusEvent: win.FocusEvent,
    InputEvent: win.InputEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  installGlobalBag(bag);
  return win;
}
