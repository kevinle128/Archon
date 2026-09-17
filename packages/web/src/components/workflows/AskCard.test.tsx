process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';

import type { AskAnswerBody, PendingInteraction } from '@/lib/api';
import { formatDurationMs } from '@/lib/format';

import type { AskCardProps } from './AskCard';
import type { AskCardPresentation } from './ask-card-presentation';
import type { AskQuestion } from './parse-ask-envelope';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-07T12:00:00.000Z';
const NOW_MS = Date.parse(CREATED_AT) + 5000;
const RESOLVED_AT = '2026-09-07T12:05:00.000Z';
const WAITING = formatDurationMs(5000);

const SINGLE: AskQuestion = {
  id: 'q1',
  prompt: 'Ship it?',
  selection: 'single',
  options: ['Ship', 'Hold'],
  allowOther: true,
};

const MULTI: AskQuestion = {
  id: 'q2',
  prompt: 'Who should review?',
  selection: 'multi',
  options: ['Alice', 'Bob'],
  allowOther: true,
};

const QUESTIONS: readonly AskQuestion[] = [SINGLE, MULTI];

const ANSWER_BODY: Extract<AskAnswerBody, { answers: unknown }> = {
  answers: [
    { questionId: 'q1', value: 'Ship' },
    { questionId: 'q2', value: ['Alice', 'Carol'] },
  ],
};

function interaction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-a',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: QUESTIONS },
    answer: null,
    provider_session_id: 'sess-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function pendingPresentation(overrides: Partial<AskCardPresentation> = {}): AskCardPresentation {
  return { viewState: 'pending', answer: null, error: null, resolvedAt: null, ...overrides };
}

interface CardArgs {
  interaction?: PendingInteraction;
  questions?: readonly AskQuestion[];
  presentation?: AskCardPresentation;
  viewerIsStarter?: boolean;
  starterDisplayName?: string | null;
  agentDisplayName?: string;
  nodeId?: string;
  autoFocus?: boolean;
  nowMs?: number;
  draft?: import('./parse-ask-envelope').AskDraft;
  onDraftChange?: (next: import('./parse-ask-envelope').AskDraft) => void;
  onSubmit?: (body: Extract<AskAnswerBody, { answers: unknown }>) => void;
  onDecline?: () => void;
}

function cardProps(overrides: CardArgs = {}): AskCardProps {
  return {
    interaction: overrides.interaction ?? interaction(),
    questions: overrides.questions ?? QUESTIONS,
    presentation: overrides.presentation ?? pendingPresentation(),
    viewerIsStarter: overrides.viewerIsStarter ?? true,
    starterDisplayName:
      overrides.starterDisplayName === undefined ? 'Avery' : overrides.starterDisplayName,
    agentDisplayName: overrides.agentDisplayName ?? 'Claude',
    nodeId: overrides.nodeId ?? 'review',
    autoFocus: overrides.autoFocus ?? false,
    nowMs: overrides.nowMs ?? NOW_MS,
    draft: overrides.draft ?? {},
    onDraftChange: overrides.onDraftChange ?? ((): void => undefined),
    onSubmit: overrides.onSubmit ?? ((): void => undefined),
    onDecline: overrides.onDecline ?? ((): void => undefined),
  };
}

async function renderStatic(overrides: CardArgs = {}): Promise<string> {
  const { AskCard: askCard } = await loadAskCardModule();
  return renderToStaticMarkup(createElement(askCard, cardProps(overrides)));
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

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

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

function snapshotGlobals(): void {
  previousGlobals.clear();
  for (const key of INSTALLED_GLOBAL_KEYS) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
}

function restoreGlobals(): void {
  for (const key of INSTALLED_GLOBAL_KEYS) {
    const descriptor = previousGlobals.get(key);
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, descriptor);
    }
  }
  previousGlobals.clear();
}

function installHappyDom(): Window {
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
  Object.assign(globalThis as object, bag);
  return win;
}

let askCardModulePromise: Promise<typeof import('./AskCard')> | null = null;

async function loadAskCardModule(): Promise<typeof import('./AskCard')> {
  if (askCardModulePromise === null) {
    let tempWin: Window | null = null;
    if (typeof globalThis.document === 'undefined') {
      tempWin = installHappyDom();
    }
    askCardModulePromise = import('./AskCard');
    const module = await askCardModulePromise;
    if (tempWin !== null) {
      // Radix keeps import-time DOM references; restore globals but keep the window alive.
      restoreGlobals();
    }
    return module;
  }
  return askCardModulePromise;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface ReactHandlerProps {
  onChange?: (event: { target: { value: string; checked: boolean } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  onClick?: (event: { preventDefault: () => void }) => void;
}

function reactProps(node: Element): ReactHandlerProps | null {
  const key = Object.keys(node).find(candidate => candidate.startsWith('__reactProps$'));
  if (key === undefined) {
    return null;
  }
  const props = (node as unknown as Record<string, unknown>)[key];
  if (props === null || typeof props !== 'object') {
    return null;
  }
  return props as ReactHandlerProps;
}

function setControlValue(input: Element, value: string, checked?: boolean): void {
  const onChange = reactProps(input)?.onChange;
  if (onChange !== undefined) {
    onChange({ target: { value, checked: checked ?? true } });
    return;
  }
  const el = input as unknown as HTMLInputElement;
  el.value = value;
  if (checked !== undefined) {
    el.checked = checked;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function clickEl(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

describe('AskCard static markup', () => {
  test('renders an accessible Ask form', async () => {
    const markup = await renderStatic();
    const text = visibleText(markup);

    expect(markup).toContain('aria-label="question from agent, 2 questions"');
    expect(text).toContain('Claude is asking');
    expect(text).toContain('review');
    expect(text).toContain(WAITING);
    expect(markup).toContain('<legend');
    expect(text).toContain('Ship it?');
    expect(text).toContain('Who should review?');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('type="checkbox"');
    expect(text).toContain('View payload');
    expect(text).toContain('"id": "q1"');
    expect(text).toContain('"allowOther": true');
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(text).toContain('Submit');
  });

  test('keeps Submit and Decline when the viewer is not the starter', async () => {
    const markup = await renderStatic({ viewerIsStarter: false, starterDisplayName: 'Avery' });
    const text = visibleText(markup);

    expect(text).toContain('Submit');
    expect(text).toContain('Decline');
    expect(text).not.toContain('Waiting for Avery to answer');
    expect(markup).not.toMatch(/<fieldset[^>]*disabled/);
  });

  test('renders Ask lifecycle states', async () => {
    const cases: { name: string; args: CardArgs; expectText: string[]; forbid?: string[] }[] = [
      {
        name: 'sending',
        args: { presentation: pendingPresentation({ viewState: 'sending' }) },
        expectText: ['Sending…'],
        forbid: ['Submit', 'Decline'],
      },
      {
        name: 'starter answered',
        args: {
          viewerIsStarter: true,
          presentation: {
            viewState: 'answered',
            answer: ANSWER_BODY,
            error: null,
            resolvedAt: RESOLVED_AT,
          },
        },
        expectText: ['Answered', 'Ship it?: Ship', 'Who should review?: Alice, Carol'],
        forbid: ['Answered · by you', 'Submit'],
      },
      {
        name: 'teammate answered',
        args: {
          viewerIsStarter: false,
          presentation: {
            viewState: 'answered',
            answer: ANSWER_BODY,
            error: null,
            resolvedAt: RESOLVED_AT,
          },
        },
        expectText: ['Answered', 'Ship it?: Ship'],
        forbid: ['Answered · by you', 'Submit', 'Decline'],
      },
      {
        name: 'declined',
        args: {
          presentation: {
            viewState: 'declined',
            answer: { decline: true },
            error: null,
            resolvedAt: RESOLVED_AT,
          },
        },
        expectText: ['Declined'],
        forbid: ['Submit'],
      },
      {
        name: 'already answered',
        args: {
          presentation: {
            viewState: 'rejected-late',
            answer: ANSWER_BODY,
            error: null,
            resolvedAt: RESOLVED_AT,
          },
        },
        expectText: ['Already answered'],
        forbid: ['Submit'],
      },
      {
        name: 'failed-resume',
        args: {
          presentation: {
            viewState: 'failed-resume',
            answer: ANSWER_BODY,
            error: 'Could not resume the AskHuman session: provider closed',
            resolvedAt: RESOLVED_AT,
          },
        },
        expectText: [
          'Resume failed — node failed; your answer is preserved below',
          'Could not resume the AskHuman session: provider closed',
          'Ship it?: Ship',
        ],
        forbid: ['Submit'],
      },
      {
        name: 'inline error',
        args: {
          presentation: pendingPresentation({ error: 'network down' }),
        },
        expectText: ['network down', 'Submit', 'Decline'],
      },
      {
        name: 'malformed canonical answer',
        args: {
          presentation: {
            viewState: 'answered',
            answer: null,
            error: 'Malformed canonical answer',
            resolvedAt: RESOLVED_AT,
          },
        },
        expectText: ['Answered', 'Malformed canonical answer'],
        forbid: ['Answered · by you', 'Submit'],
      },
    ];

    for (const row of cases) {
      const markup = await renderStatic(row.args);
      const text = visibleText(markup);
      for (const snippet of row.expectText) {
        expect(text).toContain(snippet);
      }
      for (const snippet of row.forbid ?? []) {
        expect(text).not.toContain(snippet);
      }
      if (
        row.args.presentation?.resolvedAt !== undefined &&
        row.args.presentation.resolvedAt !== null
      ) {
        expect(markup).toContain(`dateTime="${row.args.presentation.resolvedAt}"`);
      }
    }
  });
});

describe('InvalidAskCard', () => {
  test('renders malformed Ask data as a visible contract error', async () => {
    const row = interaction({ envelope: { broken: true } });
    const { InvalidAskCard: invalidAskCard } = await loadAskCardModule();
    const markup = renderToStaticMarkup(
      createElement(invalidAskCard, {
        interaction: row,
        agentDisplayName: 'Claude',
        nodeId: 'review',
      })
    );
    const text = visibleText(markup);

    expect(markup).toContain('role="alert"');
    expect(text).toContain('Invalid Ask payload');
    expect(text).toContain('review');
    expect(text).toContain('"broken": true');
    expect(markup).not.toContain('<form');
    expect(text).not.toContain('Submit');
    expect(text).not.toContain('Decline');
  });
});

describe('AskCard actions', () => {
  let win: Window;
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
    restoreGlobals();
  });

  async function renderCard(overrides: CardArgs = {}): Promise<void> {
    const { AskCard: askCard } = await loadAskCardModule();
    function StatefulCard(): React.ReactElement {
      const base = cardProps(overrides);
      const [draft, setDraft] = react.useState(base.draft);
      return createElement(askCard, {
        ...base,
        draft,
        onDraftChange: (next): void => {
          setDraft(next);
          base.onDraftChange(next);
        },
      });
    }
    await act(async () => {
      root.render(createElement(StatefulCard));
    });
    await flush();
  }

  function findButton(label: string, rootNode: Element = host): HTMLButtonElement {
    const button = Array.from(rootNode.querySelectorAll('button')).find(
      candidate => (candidate.textContent ?? '').trim() === label
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing button: ' + label);
    }
    return button;
  }

  function control(selector: string): HTMLInputElement {
    const el = host.querySelector(selector);
    if (!(el instanceof HTMLInputElement)) {
      throw new Error('missing control: ' + selector);
    }
    return el;
  }

  test('submits only a complete valid draft', async () => {
    const submitted: Extract<AskAnswerBody, { answers: unknown }>[] = [];
    await renderCard({
      onSubmit: (body): void => {
        submitted.push(body);
      },
    });

    await act(async () => {
      setControlValue(control('input[type="radio"][value="Ship"]'), 'Ship', true);
    });
    await act(async () => {
      setControlValue(control('input[type="checkbox"][value="Alice"]'), 'Alice', true);
    });
    await act(async () => {
      setControlValue(control('input[value="__other__"][type="checkbox"]'), '__other__', true);
    });
    await flush();

    const otherField = host.querySelector('textarea');
    if (otherField === null) {
      throw new Error('missing Other textarea');
    }
    await act(async () => {
      setControlValue(otherField, '   ');
    });
    await flush();
    expect(findButton('Submit').disabled).toBe(true);

    await act(async () => {
      setControlValue(otherField, 'Carol');
    });
    await flush();
    expect(findButton('Submit').disabled).toBe(false);

    const form = host.querySelector('form');
    if (form === null) {
      throw new Error('missing form');
    }
    await act(async () => {
      const onSubmit = reactProps(form)?.onSubmit;
      if (onSubmit !== undefined) {
        onSubmit({ preventDefault: (): void => undefined });
        return;
      }
      form.requestSubmit();
    });
    await flush();

    expect(submitted).toEqual([
      {
        answers: [
          { questionId: 'q1', value: 'Ship' },
          { questionId: 'q2', value: ['Alice', 'Carol'] },
        ],
      },
    ]);
  });

  test('unowned-run viewer can click pending Ask choices', async () => {
    // Mini: GET run.viewer_is_starter is false when workflow_runs.user_id is null.
    await renderCard({
      viewerIsStarter: false,
      starterDisplayName: null,
    });

    const ship = control('input[type="radio"][value="Ship"]');
    expect(ship.disabled).toBe(false);

    await act(async () => {
      setControlValue(ship, 'Ship', true);
    });
    await flush();

    expect(ship.checked).toBe(true);
    expect(findButton('Submit')).toBeInstanceOf(HTMLButtonElement);
    expect(findButton('Decline')).toBeInstanceOf(HTMLButtonElement);
  });

  test('selecting Other then typing a listed option selects that listed option', async () => {
    await renderCard({ questions: [SINGLE] });
    await act(async () => {
      setControlValue(control('input[value="__other__"][type="radio"]'), '__other__', true);
    });
    await flush();
    const otherField = host.querySelector('textarea');
    if (otherField === null) {
      throw new Error('missing Other textarea');
    }
    await act(async () => {
      setControlValue(otherField, 'unique-other');
    });
    await flush();
    expect(control('input[value="__other__"][type="radio"]').checked).toBe(true);

    await act(async () => {
      setControlValue(otherField, 'Ship');
    });
    await flush();
    expect(control('input[type="radio"][value="Ship"]').checked).toBe(true);
    expect(control('input[value="__other__"][type="radio"]').checked).toBe(false);
  });

  test('confirms Decline as a separate action', async () => {
    let declines = 0;
    let submits = 0;
    await renderCard({
      onDecline: (): void => {
        declines += 1;
      },
      onSubmit: (): void => {
        submits += 1;
      },
    });

    await clickEl(findButton('Decline'));
    await flush();

    const dialog = win.document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(win.document.body.textContent).toContain('Decline this ask?');
    expect(win.document.body.textContent).toContain('The agent will be told you declined');

    if (dialog === null) {
      throw new Error('missing decline dialog');
    }
    await clickEl(findButton('Cancel', dialog as unknown as Element));
    await flush();
    expect(declines).toBe(0);
    expect(submits).toBe(0);

    await clickEl(findButton('Decline'));
    await flush();
    const opened = win.document.querySelector('[role="alertdialog"]');
    if (opened === null) {
      throw new Error('dialog did not reopen');
    }
    await clickEl(findButton('Decline', opened as unknown as Element));
    await flush();
    expect(declines).toBe(1);
    expect(submits).toBe(0);
  });

  test('focuses only the requested card', async () => {
    const { AskCard: askCard } = await loadAskCardModule();
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(
            askCard,
            cardProps({
              autoFocus: true,
              interaction: interaction({ id: 'ask-focus-1' }),
            })
          ),
          createElement(
            askCard,
            cardProps({
              autoFocus: false,
              interaction: interaction({ id: 'ask-focus-2' }),
            })
          )
        )
      );
    });
    await flush();

    const first = host.querySelector('input[id="default:ask-focus-1:q1:Ship"]');
    const second = host.querySelector('input[id="default:ask-focus-2:q1:Ship"]');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const activeId = (win.document.activeElement as { id?: string } | null)?.id;
    expect(activeId).toBe('default:ask-focus-1:q1:Ship');
  });

  test('is controlled by draft and reports a copied draft on change', async () => {
    const supplied = { q1: 'Hold', q2: 'notes from parent' };
    const drafts: import('./parse-ask-envelope').AskDraft[] = [];
    const { AskCard: askCard } = await loadAskCardModule();
    const questions: readonly AskQuestion[] = [
      SINGLE,
      { id: 'q2', prompt: 'Notes', selection: 'single', options: [], allowOther: true },
    ];

    await act(async () => {
      root.render(
        createElement(
          askCard,
          cardProps({
            questions,
            draft: supplied,
            onDraftChange: (next): void => {
              drafts.push(next);
            },
          })
        )
      );
    });
    await flush();

    expect(control('input[type="radio"][value="Hold"]').checked).toBe(true);
    const notes = host.querySelector('textarea');
    if (notes === null) throw new Error('missing notes');
    expect((notes as unknown as HTMLTextAreaElement).value).toBe('notes from parent');
    const rootForm = host.querySelector('form');
    expect(rootForm?.id).toBe('run-ask-card-tool-a');
    expect(rootForm?.getAttribute('tabindex')).toBe('-1');

    await act(async () => {
      setControlValue(control('input[type="radio"][value="Ship"]'), 'Ship', true);
    });
    await flush();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toEqual({ q1: 'Ship', q2: 'notes from parent' });
    expect(drafts[0]).not.toBe(supplied);
    expect(supplied).toEqual({ q1: 'Hold', q2: 'notes from parent' });

    await act(async () => {
      root.render(
        createElement(
          askCard,
          cardProps({
            questions,
            draft: drafts[0],
            onDraftChange: (next): void => {
              drafts.push(next);
            },
          })
        )
      );
    });
    await flush();
    expect(control('input[type="radio"][value="Ship"]').checked).toBe(true);

    await act(async () => {
      setControlValue(notes, 'updated notes');
    });
    await flush();
    expect(drafts[drafts.length - 1]).toEqual({ q1: 'Ship', q2: 'updated notes' });
  });
});
