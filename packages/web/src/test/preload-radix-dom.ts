import { Window } from 'happy-dom';

/**
 * `@radix-ui/react-use-layout-effect` binds once, at first import:
 * `globalThis.document ? React.useLayoutEffect : () => {}`.
 * Component tests import Radix in filesystem order. A file that imports a
 * dialog before any happy-dom window exists permanently no-ops Presence, so
 * later Ask dialogs never mount. Install a document before those imports.
 * Individual tests still swap in their own window.
 */
if (Object.getOwnPropertyDescriptor(globalThis, 'document') === undefined) {
  const domWindow = new Window({ url: 'https://localhost/' });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: domWindow,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: domWindow.document,
  });
}
