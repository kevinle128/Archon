import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useKeymap, type Binding } from '../lib/keymap';
import { RunDetailHeader } from '../components/RunDetailHeader';
import { WorkflowEnvResolvedTable } from '../components/WorkflowEnvResolvedTable';
import { RunActionBar } from '../components/RunActionBar';
import { StreamToolbar, type DetailView } from '../components/StreamToolbar';
import { ConsoleInspectPane } from '../components/ConsoleInspectPane';
import {
  ConsoleReplyComposer,
  type ReplyDestinationState,
} from '../components/ConsoleReplyComposer';
import { ConsoleAskChrome } from '../components/ask/ConsoleAskChrome';
import {
  createAskAnswerController,
  type AskActionState,
  type AskActionStateByRequest,
} from '../components/ask/ask-answer-controller';
import {
  firstPendingAskAwaitingInteraction,
  isAskAwaitingRun,
} from '../components/ask/awaiting-chrome';
import { RunStartedLine, RunFinishedLine } from '../components/RunLifecycle';
import { buildConsoleLogEntries } from '../components/inspect/build-console-log-entries';
import { buildLogRows } from '../components/inspect/build-log-rows';
import { readNodeSearchParam } from '../components/inspect/console-inspect-selection';
import type { AskDraftByRequest } from '../components/ask/parse-ask-envelope';
import { synthesizeLogNodeStates } from '../components/inspect/synthesize-log-node-states';
import { StreamContextProvider } from '../lib/stream-context';
import { useRunStreamSSE } from '../lib/sse';
import { useEntity, invalidate } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import { runMessageConversationId, type Run, type RunEnvOverlay } from '../primitives/run';
import type { ConversationSummary } from '../primitives/conversation';
import {
  applyRoomDeepLink,
  askCardId,
  chooseExecutionForInteraction,
  chooseExecutionForNode,
  closeRoom,
  hasUnsettledNodeExecutions,
  openRoom,
  openExplicitRoom,
  rememberRoomScroll,
  resetRoomVisit,
  roomOpenerId,
  type RoomVisitState,
} from '@/lib/execution-room-model';
import { nodeMessageScopeKey } from '@/lib/node-message-pages';
import { readRoomRatio, writeRoomRatio } from '@/lib/room-split-layout';
import { foldNodeRuns } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { Project } from '../primitives/project';
import type { AskAnswerBody, ArtifactFile, ConsoleRunDetail } from '../skills/runs';

/**
 * Run detail — the "logs" page, promoted out of a hidden tab.
 *
 * Data sources:
 *   - skill.getRun(id)     → run metadata + workflow_events
 *   - skill.listMessages() → conversation messages (assistant text, user input,
 *                            persisted tool calls in metadata)
 *
 * RunStream merges both into one timeline. Approval controls render inside
 * the exact execution section and the selected execution room.
 *
 * Updates flow through SSE (lib/sse.ts) with a 30s safety-net refetch
 * for runs that are still running/paused.
 */
const TOGGLE_KEYS = {
  toolCalls: 'archon.console.showToolCalls',
  system: 'archon.console.showSystem',
  view: 'archon.console.detailView',
  node: 'archon.console.runNodeFilter',
} as const;

function focusAskCard(requestId: string): void {
  let attempts = 0;
  const focusAsk = (): void => {
    const card = document.getElementById(askCardId(requestId, 'room'));
    if (card !== null) {
      card.focus();
      if (document.activeElement === card) return;
    }
    if (attempts < 30) {
      attempts += 1;
      requestAnimationFrame(focusAsk);
    }
  };
  requestAnimationFrame(focusAsk);
}

function readToggle(key: string, defaultOn: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultOn;
    return stored === '1';
  } catch {
    return defaultOn;
  }
}

function writeToggle(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readView(): DetailView {
  try {
    const stored = localStorage.getItem(TOGGLE_KEYS.view);
    return stored === 'graph' ? 'graph' : 'log';
  } catch {
    return 'log';
  }
}

function writeView(v: DetailView): void {
  try {
    localStorage.setItem(TOGGLE_KEYS.view, v);
  } catch {
    /* ignore */
  }
}

function readNodeFilter(): string {
  try {
    return localStorage.getItem(TOGGLE_KEYS.node) ?? 'all';
  } catch {
    return 'all';
  }
}

function writeNodeFilter(v: string): void {
  try {
    localStorage.setItem(TOGGLE_KEYS.node, v);
  } catch {
    /* ignore */
  }
}

/**
 * ENV chip/table gate for run detail. Malformed/legacy `metadata.envOverlay`
 * stays `null` on the Run primitive — never render false audit UI from hybrids.
 */
export function hasRunEnvOverlayUi(
  run: Pick<Run, 'envOverlay'>
): run is Pick<Run, 'envOverlay'> & { envOverlay: RunEnvOverlay } {
  return run.envOverlay !== null;
}
export function RunDetailPage(): ReactElement {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showToolCalls, setShowToolCalls] = useState<boolean>(() =>
    readToggle(TOGGLE_KEYS.toolCalls, true)
  );
  const [showSystem, setShowSystem] = useState<boolean>(() =>
    readToggle(TOGGLE_KEYS.system, false)
  );
  const [view, setView] = useState<DetailView>(() => readView());
  const [streamNodeFilter, setStreamNodeFilter] = useState<string>(() => readNodeFilter());
  const [room, setRoom] = useState<RoomVisitState>(() => resetRoomVisit(runId ?? ''));
  const [roomRatio, setRoomRatio] = useState(() =>
    typeof window === 'undefined' ? 40 : readRoomRatio('console', window.localStorage)
  );
  const [askDrafts, setAskDrafts] = useState<AskDraftByRequest>({});
  const [askActions, setAskActions] = useState<{
    runId: string | undefined;
    states: AskActionStateByRequest;
  }>({ runId, states: {} });
  const actionStates = askActions.runId === runId ? askActions.states : {};
  const selectedNodeIdRef = useRef<string | null>(null);
  const roomOpenerToRestoreRef = useRef<string | null>(null);
  const logScrollTopBeforeRoomRef = useRef<number | null>(null);

  // `Project | null` / `ConsoleRunDetail | null` rather than the `as unknown as T`
  // casts the original sentinel used — keeps the null path honest for
  // downstream readers (they can guard explicitly instead of meeting a
  // mis-typed value).
  const { data: project } = useEntity<Project | null>(
    projectId !== undefined ? K.project(projectId) : 'noop:no-project-id',
    () => (projectId !== undefined ? skill.getProject(projectId) : Promise.resolve(null))
  );

  const { data: detail, error: detailError } = useEntity<ConsoleRunDetail | null>(
    runId !== undefined ? K.run(runId) : 'noop:no-run-id',
    () => (runId !== undefined ? skill.getRun(runId) : Promise.resolve(null))
  );

  const parentPlatformId = detail?.parentPlatformId ?? null;
  const parentConversation = useEntity<ConversationSummary | null>(
    K.parentConversation(parentPlatformId),
    () =>
      parentPlatformId === null ? Promise.resolve(null) : skill.getConversation(parentPlatformId)
  );

  // Messages are tied to the run's conversation — and the /messages endpoint
  // takes the *platform* conversation id, not the DB id. CLI runs expose it as
  // conversationPlatformId; chat-dispatched runs only expose the worker
  // conversation (workerPlatformId), which holds their messages (#2048). The
  // helper picks whichever is present.
  const conversationPlatformId = runMessageConversationId(detail?.run);

  const { data: messages } = useEntity<Message[]>(
    conversationPlatformId !== null
      ? K.messages(conversationPlatformId)
      : 'noop:no-conversation-id',
    () =>
      conversationPlatformId !== null
        ? skill.listMessages(conversationPlatformId)
        : Promise.resolve([])
  );

  // Live updates: subscribe to the conversation SSE stream. Events here
  // invalidate the run and messages caches; useEntity refetches authoritative
  // state. Auto-reconnects on disconnect. The hook itself no-ops while the
  // conversation id is still unknown.
  useRunStreamSSE(conversationPlatformId, runId ?? null);

  // SSE-drop safety net: if the stream silently dies (network hiccup,
  // sleep/wake, mobile transitions) the EventSource will reconnect but we
  // may have missed terminal events in the meantime. A 30s heartbeat refetch
  // while status is non-terminal catches that without being polling proper —
  // it stops the moment the run hits a terminal state.
  const status = detail?.run.status;
  useEffect(() => {
    if (runId === undefined) return;
    if (status !== 'running' && status !== 'paused') return;
    const id = setInterval(() => {
      invalidate(K.run(runId));
      if (conversationPlatformId !== null) {
        invalidate(K.messages(conversationPlatformId));
      }
    }, 30000);
    return (): void => {
      clearInterval(id);
    };
  }, [runId, status, conversationPlatformId]);

  // Terminal catch-up: after cancel/complete/fail the run can settle before the
  // executor writes node_failed (or the read projection closes a purged Ask).
  // Poll raw history every 3s until every execution is terminal — read-only,
  // never stacked with the live 30s heartbeat, no timeout inference.
  const terminalCatchUpUnsettled = hasUnsettledNodeExecutions(detail?.nodeExecutions);
  useEffect(() => {
    if (runId === undefined) return;
    if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return;
    if (!terminalCatchUpUnsettled) return;
    const id = setInterval(() => {
      invalidate(K.run(runId));
    }, 3000);
    return (): void => {
      clearInterval(id);
    };
  }, [runId, status, terminalCatchUpUnsettled]);

  // Surface the artifact count on the tab even when the user hasn't visited
  // the panel yet. Cheap call — the server walks one directory. Must live
  // above any early return so the hook order stays stable across renders.
  const { data: artifactFiles } = useEntity<ArtifactFile[]>(
    runId !== undefined ? K.artifacts(runId) : 'noop:no-run-id',
    () =>
      runId !== undefined ? skill.listRunArtifacts(runId) : Promise.resolve([] as ArtifactFile[])
  );

  const inspectNodeStates = useMemo(() => {
    if (detail === undefined || detail === null) return [];
    return synthesizeLogNodeStates(
      detail.nodeStates,
      detail.rawEvents,
      detail.run.status,
      detail.approval
    );
  }, [detail]);

  const logRows = useMemo(
    () =>
      buildLogRows(
        inspectNodeStates,
        detail?.rawEvents ?? [],
        detail?.nodeExecutions,
        detail?.run.startedAt
      ),
    [inspectNodeStates, detail]
  );

  const logEntries = useMemo(
    () =>
      buildConsoleLogEntries({
        rows: logRows,
        rawEvents: detail?.rawEvents ?? [],
        nodeRuns: foldNodeRuns(detail?.events ?? []),
        runStartedAt: detail?.run.startedAt ?? '',
      }),
    [logRows, detail]
  );

  // Distinct nodes drive the node-filter dropdown — derived from the same fold
  // the stream renders, so the options match the dividers exactly.
  const nodeOptions = useMemo(
    () => foldNodeRuns(detail?.events ?? []).map(r => ({ id: r.nodeId, name: r.nodeName })),
    [detail?.events]
  );

  // Drop a persisted node selection that doesn't apply to this run (e.g. after
  // navigating to a different workflow). Guarded on the run being loaded so the
  // empty list during loading can't clobber a still-valid stored selection.
  // useLayoutEffect (not useEffect) so the reset lands before paint — navigating
  // to a cached run whose node set lacks the selection never flashes an empty
  // "Waiting for first event…" frame.
  useLayoutEffect(() => {
    if (detail === undefined || detail === null) return;
    if (streamNodeFilter !== 'all' && !nodeOptions.some(o => o.id === streamNodeFilter)) {
      setStreamNodeFilter('all');
    }
  }, [detail, nodeOptions, streamNodeFilter]);

  useEffect(() => {
    if (runId === undefined) return;
    setAskDrafts({});
  }, [runId]);

  useEffect(() => {
    if (detail === undefined || detail === null || runId === undefined) return;
    const queryNode = readNodeSearchParam(location.search);
    setRoom(previous => {
      const base = previous.runId === runId ? previous : resetRoomVisit(runId);
      const next = applyRoomDeepLink(base, queryNode, logRows);
      if (
        next.selection !== null &&
        next.selection.openerId === null &&
        next.appliedDeepLinkNode !== null
      ) {
        return {
          ...next,
          selection: {
            ...next.selection,
            openerId: roomOpenerId('console', 'log', next.selection.rowId),
          },
        };
      }
      return next;
    });
  }, [detail, runId, logRows, location.search]);

  const replaceNodeSearch = useCallback(
    (nodeId: string | null): void => {
      const params = new URLSearchParams(location.search);
      if (nodeId === null || nodeId === '') params.delete('node');
      else params.set('node', nodeId);
      const next = params.toString();
      const search = next === '' ? '' : `?${next}`;
      if (search === location.search) return;
      navigate({ search }, { replace: true });
    },
    [location.search, navigate]
  );

  const onInspectSelect = useCallback(
    (
      nodeId: string,
      rowId?: string,
      openerId: string | null = null,
      rememberExplicit = rowId !== undefined
    ): void => {
      if (selectedNodeIdRef.current === null) {
        logScrollTopBeforeRoomRef.current = scrollRef.current?.scrollTop ?? null;
      }
      setRoom(previous => {
        const lastExplicit = previous.lastExplicitRowByNode[nodeId] ?? null;
        const chosen =
          rowId !== undefined
            ? (logRows.find(row => row.id === rowId && row.nodeId === nodeId) ?? null)
            : chooseExecutionForNode(logRows, nodeId, lastExplicit);
        if (chosen === null) return previous;
        const nextOpener =
          openerId ??
          (rowId !== undefined
            ? roomOpenerId('console', 'log', rowId)
            : roomOpenerId('console', 'graph', nodeId));
        const selection = { nodeId, rowId: chosen.id, openerId: nextOpener };
        return rememberExplicit
          ? openExplicitRoom(previous, selection)
          : openRoom(previous, selection);
      });
      replaceNodeSearch(nodeId);
    },
    [logRows, replaceNodeSearch]
  );

  selectedNodeIdRef.current = room.selection?.nodeId ?? null;

  const setAskActionState = useCallback(
    (requestId: string, state: AskActionState): void => {
      setAskActions(current => ({
        runId,
        states: {
          ...(current.runId === runId ? current.states : {}),
          [requestId]: state,
        },
      }));
    },
    [runId]
  );

  const askController = useMemo(
    () =>
      runId === undefined
        ? null
        : createAskAnswerController({
            runId,
            postAnswer: skill.answerAskHuman,
            setActionState: setAskActionState,
            invalidate: async (): Promise<void> => {
              invalidate(K.run(runId));
              const selectedNodeId = selectedNodeIdRef.current;
              if (selectedNodeId !== null) {
                invalidate(K.nodeMessages(runId, selectedNodeId));
              }
            },
            now: (): Date => new Date(),
          }),
    [runId, setAskActionState]
  );

  const submitAsk = useCallback(
    (requestId: string, body: AskAnswerBody): Promise<void> =>
      askController?.submit(requestId, body) ?? Promise.resolve(),
    [askController]
  );

  useLayoutEffect(() => {
    if (room.selection !== null) return;
    const openerId = roomOpenerToRestoreRef.current;
    const scrollTop = logScrollTopBeforeRoomRef.current;
    if (openerId === null && scrollTop === null) return;
    roomOpenerToRestoreRef.current = null;
    logScrollTopBeforeRoomRef.current = null;
    let restoreFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(() => {
        if (scrollTop !== null && scrollRef.current !== null) {
          scrollRef.current.scrollTop = scrollTop;
        }
        if (openerId !== null) {
          document.getElementById(openerId)?.focus({ preventScroll: true });
        }
      });
    });
    return (): void => {
      cancelAnimationFrame(frame);
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
    };
  }, [room.selection]);

  const onCloseRoom = useCallback((): void => {
    roomOpenerToRestoreRef.current = room.selection?.openerId ?? null;
    setRoom(closeRoom);
  }, [room.selection?.openerId]);

  const onRoomRatioChange = useCallback((ratio: number): void => {
    setRoomRatio(ratio);
    if (typeof window !== 'undefined') {
      writeRoomRatio('console', ratio, window.localStorage);
    }
  }, []);

  // Auto-scroll to bottom on new content IF user is already near the bottom.
  const lastBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    // Near-bottom heuristic: within 120px of the end.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    lastBottomRef.current = atBottom;
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !lastBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length, detail?.events.length]);

  // Keymap bindings: hoisted above early returns so the hook order is stable
  // across all render paths (loading, error, ready).
  const detailStatus = detail?.run.status ?? null;
  const isPaused = detailStatus === 'paused';
  const hasDeclaredGate = isPaused && detail?.run.approval != null;
  const goBack = useCallback((): void => {
    if (projectId !== undefined) navigate(`/console/p/${projectId}`);
    else navigate('/console');
  }, [navigate, projectId]);
  const setViewPersist = useCallback((next: DetailView): void => {
    setView(next);
    writeView(next);
  }, []);
  const toggleToolCalls = useCallback((): void => {
    setShowToolCalls(v => {
      const next = !v;
      writeToggle(TOGGLE_KEYS.toolCalls, next);
      return next;
    });
  }, []);
  const toggleSystem = useCallback((): void => {
    setShowSystem(v => {
      const next = !v;
      writeToggle(TOGGLE_KEYS.system, next);
      return next;
    });
  }, []);
  // Approve/Reject keymap bindings fire the matching button's click event
  // rather than lifting ApprovalPanel's internal state — keeps the panel
  // self-contained and avoids prop drilling for a paused-only shortcut.
  const clickApprove = useCallback((): void => {
    const el = document.querySelector<HTMLButtonElement>('[data-keymap-approve]');
    if (el !== null && !el.disabled) el.click();
  }, []);
  const clickReject = useCallback((): void => {
    const el = document.querySelector<HTMLButtonElement>('[data-keymap-reject]');
    if (el !== null && !el.disabled) el.click();
  }, []);
  const bindings = useMemo<readonly Binding[]>(
    () => [
      {
        keys: ['1'],
        label: 'Log tab',
        run: (): void => {
          setViewPersist('log');
        },
      },
      {
        keys: ['2'],
        label: 'Graph tab',
        run: (): void => {
          setViewPersist('graph');
        },
      },
      {
        keys: ['3'],
        label: 'Artifacts tab',
        run: (): void => {
          setViewPersist('artifacts');
        },
      },
      { keys: ['t'], label: 'Toggle tool calls', run: toggleToolCalls },
      { keys: ['s'], label: 'Toggle system', run: toggleSystem },
      {
        keys: ['a'],
        label: 'Approve',
        when: (): boolean => hasDeclaredGate,
        run: clickApprove,
      },
      {
        keys: ['r'],
        label: 'Reject',
        when: (): boolean => hasDeclaredGate,
        run: clickReject,
      },
      { keys: ['Escape'], label: 'Back to runs', run: goBack },
      { keys: ['h'], label: 'Back to runs', run: goBack },
    ],
    [
      hasDeclaredGate,
      goBack,
      setViewPersist,
      toggleToolCalls,
      toggleSystem,
      clickApprove,
      clickReject,
    ]
  );
  useKeymap({ bindings });
  const selectedNodeId = room.selection?.nodeId ?? null;
  const selectedLogRowId = room.selection?.rowId ?? null;
  const selectedRow = logRows.find(row => row.id === selectedLogRowId) ?? null;
  const transcriptScopeKey =
    selectedRow === null
      ? 'run:none|node:none|sel:node:none'
      : nodeMessageScopeKey(
          runId ?? '',
          selectedRow.nodeId,
          selectedRow.selection.kind === 'occurrence'
            ? {
                kind: 'occurrence',
                occurrenceId: selectedRow.selection.occurrenceId,
                ...(selectedRow.selection.attemptId !== undefined
                  ? { attemptId: selectedRow.selection.attemptId }
                  : {}),
              }
            : { kind: 'node', rowId: selectedRow.id }
        );
  const onRoomScrollTopChange = useCallback(
    (scrollTop: number): void => {
      setRoom(previous => rememberRoomScroll(previous, transcriptScopeKey, scrollTop));
    },
    [transcriptScopeKey]
  );

  if (projectId === undefined || runId === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
        Invalid run URL.
      </div>
    );
  }

  if (detailError !== undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-text-primary">Could not load run.</p>
        <p className="font-mono text-[11px] text-text-tertiary">{detailError.message}</p>
      </div>
    );
  }

  if (detail === undefined || detail === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
        Loading run…
      </div>
    );
  }

  const { run, events } = detail;
  const messageList = messages ?? [];
  const inlineToolCount = messageList.reduce((acc, m) => acc + m.toolCalls.length, 0);
  // Mirror RunStream's source-of-truth rule: when no inline tool calls exist
  // on messages, the workflow tool_called events become the canonical count.
  const workflowToolCount =
    inlineToolCount === 0
      ? events.filter(e => e.kind === 'tool_call' && e.result === null).length
      : 0;
  const toolCallCount = inlineToolCount + workflowToolCount;

  const toolbar = (
    <StreamToolbar
      view={view}
      onChangeView={next => {
        setView(next);
        writeView(next);
      }}
      showToolCalls={showToolCalls}
      onToggleToolCalls={next => {
        setShowToolCalls(next);
        writeToggle(TOGGLE_KEYS.toolCalls, next);
      }}
      showSystem={showSystem}
      onToggleSystem={next => {
        setShowSystem(next);
        writeToggle(TOGGLE_KEYS.system, next);
      }}
      toolCallCount={toolCallCount}
      messageCount={messageList.length}
      artifactCount={artifactFiles?.length ?? null}
      nodeOptions={nodeOptions}
      selectedNodeId={streamNodeFilter}
      onSelectNode={next => {
        setStreamNodeFilter(next);
        writeNodeFilter(next);
      }}
    />
  );

  const logHeader: ReactNode = (
    <>
      <div className="sticky top-0 z-10 bg-surface px-6">{toolbar}</div>
      <div className="px-6 pt-4">
        {detail.usage === null ? (
          <div
            className="mb-3 rounded-[10px] border border-warning/40 bg-warning/[0.06] px-3 py-2 text-[12px] text-warning"
            role="status"
          >
            Usage report unavailable for this run. This is not zero cost.
          </div>
        ) : null}
        {hasRunEnvOverlayUi(run) ? <WorkflowEnvResolvedTable overlay={run.envOverlay} /> : null}
        <RunStartedLine run={run} />
      </div>
    </>
  );

  const logFooter: ReactNode = (
    <div className="px-6 pb-4">
      <RunFinishedLine run={run} />
    </div>
  );

  const projectCwd = project?.path;

  const replyState: ReplyDestinationState =
    parentPlatformId === null
      ? { kind: 'missing' }
      : parentConversation.error !== undefined
        ? { kind: 'error' }
        : parentConversation.loading
          ? { kind: 'loading' }
          : parentConversation.data?.platformType === 'web'
            ? { kind: 'ready', parentPlatformId }
            : { kind: 'non_web' };

  return (
    <StreamContextProvider value={{ runStartedAt: run.startedAt }}>
      <section
        className="console-run-view flex h-full flex-col"
        data-ask-draft-count={String(Object.keys(askDrafts).length)}
      >
        <RunDetailHeader
          run={run}
          projectId={projectId}
          projectName={project?.name ?? projectId}
          usage={detail.usage}
          askAwaiting={isAskAwaitingRun(run.status, detail.pendingInteractions)}
          onAwaitingInput={(): void => {
            const interaction = firstPendingAskAwaitingInteraction({
              pending: detail.pendingInteractions,
              nodes: inspectNodeStates,
            });
            if (interaction === null) return;
            const row = chooseExecutionForInteraction(logRows, interaction);
            if (row === null) return;
            onInspectSelect(interaction.node_id, row.id, null, false);
            focusAskCard(interaction.tool_use_id);
          }}
        />
        <ConsoleAskChrome
          status={run.status}
          pendingInteractions={detail.pendingInteractions}
          nodeStates={inspectNodeStates}
          runError={detail.runError}
          onRequestGraphView={(): void => {
            setViewPersist('graph');
          }}
          onSelectAwaitingNode={(nodeId, interaction): void => {
            const row = chooseExecutionForInteraction(logRows, interaction);
            if (row === null) return;
            onInspectSelect(nodeId, row.id, null, false);
            focusAskCard(interaction.tool_use_id);
          }}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {projectCwd !== undefined ? (
            <>
              {view !== 'log' ? <div className="px-6">{toolbar}</div> : null}
              <ConsoleInspectPane
                view={view}
                run={run}
                projectId={projectId}
                projectCwd={projectCwd}
                messages={messageList}
                events={events}
                rawEvents={detail.rawEvents}
                nodeStates={inspectNodeStates}
                approval={detail.approval}
                logEntries={logEntries}
                usage={detail.usage}
                streamNodeFilter={streamNodeFilter}
                selectedNodeId={selectedNodeId}
                selectedLogRowId={selectedLogRowId}
                showToolCalls={showToolCalls}
                showSystem={showSystem}
                logHeader={logHeader}
                logFooter={logFooter}
                logScrollRef={scrollRef}
                onSelectNode={(nodeId: string, rowId?: string): void => {
                  onInspectSelect(
                    nodeId,
                    rowId,
                    rowId !== undefined
                      ? roomOpenerId('console', 'log', rowId)
                      : roomOpenerId('console', 'graph', nodeId)
                  );
                }}
                onCloseRoom={onCloseRoom}
                roomRatio={roomRatio}
                onRoomRatioChange={onRoomRatioChange}
                loadDefinition={skill.getWorkflowDagNodes}
                loadMessages={skill.getNodeMessages}
                loadMessage={skill.getNodeMessage}
                pendingInteractions={detail.pendingInteractions}
                viewerIsStarter={detail.viewerIsStarter}
                starterDisplayName={detail.starterDisplayName}
                actionStates={actionStates}
                onSubmitAsk={submitAsk}
                scopeKey={transcriptScopeKey}
                initialScrollTop={room.scrollTopByScope[transcriptScopeKey]}
                onScrollTopChange={onRoomScrollTopChange}
                askDrafts={askDrafts}
                onAskDraftChange={(requestId: string, draft): void => {
                  setAskDrafts(previous => ({ ...previous, [requestId]: draft }));
                }}
              />
            </>
          ) : (
            <>
              <div className="px-6">{toolbar}</div>
              <div className="p-6 text-[12px] text-text-tertiary">Loading project…</div>
            </>
          )}
        </div>

        <ConsoleReplyComposer
          state={replyState}
          onSend={async (message: string): Promise<void> => {
            if (replyState.kind !== 'ready') return;
            await skill.sendMessage(replyState.parentPlatformId, message);
          }}
        />
        <RunActionBar run={run} />
      </section>
    </StreamContextProvider>
  );
}
