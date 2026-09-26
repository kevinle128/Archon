/**
 * Awaited fail-open transcript writer.
 *
 * The executor must await appends to preserve provider-chunk order, but a
 * persistence failure must not fail the node. This is the sole fail-open
 * boundary: log only identity and error type, never payload bodies.
 */
import { createLogger } from '@archon/paths';
import type { AppendNodeMessageInput } from './schemas/node-message';
import type { PromptTranscriptSource, TranscriptExecutionScope } from './schemas/node-execution';
import type { IWorkflowNodeMessageStore } from './store';
import type { QueuedOperatorMessage } from './steering-registry';
import { transcriptMetadata } from './transcript-execution-scope';

const log = createLogger('workflows.node-transcript');

export async function appendNodeTranscript(
  store: IWorkflowNodeMessageStore,
  input: AppendNodeMessageInput
): Promise<void> {
  try {
    await store.appendNodeMessage(input);
  } catch (error: unknown) {
    log.error(
      {
        workflowRunId: input.workflow_run_id,
        nodeId: input.node_id,
        kind: input.kind,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      'workflow.node_message_append_failed'
    );
  }
}

/**
 * Append a tool completion as a second `tool` row with the same legacy payload
 * shape as the call. Do not mutate the call row or introduce a new kind.
 */
export async function appendToolResultTranscript(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    name: string;
    id: string;
    output?: unknown;
    metadata?: AppendNodeMessageInput['metadata'];
  }
): Promise<void> {
  await appendNodeTranscript(store, {
    workflow_run_id: input.workflow_run_id,
    node_id: input.node_id,
    kind: 'tool',
    payload: {
      name: input.name,
      id: input.id,
      ...(input.output !== undefined ? { output: input.output } : {}),
    },
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

/**
 * Append one verbatim operator text row per drained guidance message, in array
 * order, under the caused turn's transcript attempt. Fail-open per row via
 * appendNodeTranscript — no extra catch/log layer.
 */
export async function appendOperatorTranscript(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    scope: TranscriptExecutionScope;
    messages: readonly QueuedOperatorMessage[];
  }
): Promise<void> {
  for (const message of input.messages) {
    await appendNodeTranscript(store, {
      workflow_run_id: input.workflow_run_id,
      node_id: input.node_id,
      kind: 'text',
      payload: { text: message.message },
      metadata: transcriptMetadata(input.scope, {
        origin: 'operator',
        operator_user_id: message.operatorUserId,
        message_id: message.messageId,
      }),
    });
  }
}

/**
 * Append displayable provider thinking as a `thinking`-origin text row.
 * Callers must pass only content the provider explicitly marked safe to
 * show — hidden or redacted reasoning is never a valid input here.
 */
export async function appendThinkingTranscript(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    scope: TranscriptExecutionScope;
    text: string;
  }
): Promise<void> {
  await appendNodeTranscript(store, {
    workflow_run_id: input.workflow_run_id,
    node_id: input.node_id,
    kind: 'text',
    payload: { text: input.text },
    metadata: transcriptMetadata(input.scope, { origin: 'thinking' }),
  });
}

/**
 * Append the exact text that triggered one agent turn as a `prompt`-origin
 * text row. Callers must skip this for a redirect turn's first pass — that
 * text is already persisted as the caused operator row; see
 * `promptTranscriptSourceSchema` for the cases this covers.
 */
export async function appendPromptTranscript(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    scope: TranscriptExecutionScope;
    text: string;
    actorUserId: string | null;
    source: PromptTranscriptSource;
  }
): Promise<void> {
  await appendNodeTranscript(store, {
    workflow_run_id: input.workflow_run_id,
    node_id: input.node_id,
    kind: 'text',
    payload: { text: input.text },
    metadata: transcriptMetadata(input.scope, {
      origin: 'prompt',
      actor_user_id: input.actorUserId,
      prompt_source: input.source,
    }),
  });
}

/**
 * Append one advisor notification as an `advisor`-origin text row.
 * `advisorModel` is the model Archon configured (`assistants.claude.advisorModel`),
 * omitted when Archon did not set it and the provider does not echo it back.
 */
export async function appendAdvisorTranscript(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    scope: TranscriptExecutionScope;
    text: string;
    advisorModel?: string;
  }
): Promise<void> {
  await appendNodeTranscript(store, {
    workflow_run_id: input.workflow_run_id,
    node_id: input.node_id,
    kind: 'text',
    payload: { text: input.text },
    metadata: transcriptMetadata(input.scope, {
      origin: 'advisor',
      ...(input.advisorModel !== undefined ? { advisor_model: input.advisorModel } : {}),
    }),
  });
}
