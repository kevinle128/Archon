/**
 * Tracks messages a live provider turn accepted through soft injection until
 * the model actually receives them.
 *
 * A soft-injected entry is `sent` in the durable queue from the moment the
 * transport takes it, but the operator transcript row belongs at the point the
 * model reads it: after the tool that was running when the operator clicked.
 * Providers with a delivery acknowledgement (`deliveryAck`) mark that point
 * with an echo of the message id. Providers without one have no echo, so the
 * next tool completion is the boundary at which the model reads it. Only an
 * echo moves an entry to `delivered`; the boundary records the row and leaves
 * the entry `sent`.
 *
 * A message that reaches neither point before its turn ends was dropped by the
 * transport (acknowledged providers) and returns to the front of the queue as
 * `queued`, so the normal drain delivers it. A message an unacknowledged
 * provider carries into its next turn is recorded when that turn starts, and
 * one still unread when the node ends returns to the queue so terminal
 * reconciliation reports it honestly.
 */
import { createLogger } from '@archon/paths';
import type { SoftInjectionDelivery } from './steering-registry';
import type { TranscriptExecutionScope } from './schemas/node-execution';
import type { IWorkflowNodeMessageStore, IWorkflowStore } from './store';
import { appendOperatorTranscript } from './node-transcript';

const log = createLogger('workflows.soft-injection-ledger');

type LedgerStore = IWorkflowNodeMessageStore &
  Pick<IWorkflowStore, 'markSteeringMessageDelivered' | 'revertSteeringSoftInjectionClaim'>;

export class SoftInjectionLedger {
  private readonly pending = new Map<string, SoftInjectionDelivery>();
  /** Ids the transport once accepted; the provider session already holds a message stamped with each. */
  private readonly offered = new Set<string>();

  constructor(
    private readonly store: LedgerStore,
    private readonly workflowRunId: string,
    private readonly stepName: string,
    private readonly getScope: () => TranscriptExecutionScope,
    /** Whether the provider echoes a soft-injected message id when the model reads it. */
    private readonly hasDeliveryAck: boolean
  ) {}

  /** The transport accepted this message into the live turn. */
  accept(request: SoftInjectionDelivery): void {
    this.pending.set(request.messageId, request);
    this.offered.add(request.messageId);
  }

  /**
   * Whether a soft injection already put this id into the provider session. A
   * later delivery must not stamp the same uuid again: the session would treat
   * it as a duplicate and the turn would never answer.
   */
  wasOffered(messageId: string): boolean {
    return this.offered.has(messageId);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** The provider echoed `messageId`. Returns whether it was a tracked soft injection. */
  async onEcho(messageId: string): Promise<boolean> {
    const request = this.pending.get(messageId);
    if (request === undefined) return false;
    await this.record(request);
    return true;
  }

  /** A tool completed: the model reads what an unacknowledged provider accepted. */
  async onToolBoundary(): Promise<void> {
    if (this.hasDeliveryAck) return;
    await this.recordAll();
  }

  /** The next provider turn is starting: an unacknowledged provider carried the rest into it. */
  async onTurnStart(): Promise<void> {
    if (this.hasDeliveryAck) return;
    await this.recordAll();
  }

  /**
   * The provider turn ended. An acknowledged provider never echoed what is
   * left, so the transport dropped it: return it to the front of the queue.
   */
  async onTurnEnd(): Promise<void> {
    if (!this.hasDeliveryAck) return;
    await this.revertAll();
  }

  /** The node is ending: nothing further can carry the remaining messages. */
  async onNodeEnd(): Promise<void> {
    await this.revertAll();
  }

  private async recordAll(): Promise<void> {
    for (const request of [...this.pending.values()]) {
      await this.record(request);
    }
  }

  private async record(request: SoftInjectionDelivery): Promise<void> {
    this.pending.delete(request.messageId);
    await appendOperatorTranscript(this.store, {
      workflow_run_id: this.workflowRunId,
      node_id: this.stepName,
      scope: this.getScope(),
      messages: [
        {
          message_id: request.messageId,
          message: request.text,
          operator_user_id: request.operatorUserId ?? null,
        },
      ],
    });
    // `delivered` means the provider echoed the id. Without an echo the entry
    // stays `sent`, now backed by its operator row: accepted, never inferred delivered.
    if (!this.hasDeliveryAck) return;
    try {
      await this.store.markSteeringMessageDelivered(
        this.workflowRunId,
        this.stepName,
        request.messageId
      );
    } catch (err) {
      log.warn(
        { err: err as Error, workflowRunId: this.workflowRunId, nodeId: this.stepName },
        'workflow.soft_injection_mark_delivered_failed'
      );
    }
  }

  private async revertAll(): Promise<void> {
    for (const request of [...this.pending.values()]) {
      this.pending.delete(request.messageId);
      try {
        await this.store.revertSteeringSoftInjectionClaim(
          this.workflowRunId,
          this.stepName,
          request.messageId
        );
        log.info(
          { workflowRunId: this.workflowRunId, nodeId: this.stepName },
          'workflow.soft_injection_returned_to_queue'
        );
      } catch (err) {
        log.warn(
          { err: err as Error, workflowRunId: this.workflowRunId, nodeId: this.stepName },
          'workflow.soft_injection_revert_failed'
        );
      }
    }
  }
}
