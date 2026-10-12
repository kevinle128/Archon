import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import { readApprovalContext } from '@/lib/approval-context';

export type NodeBodyKind =
  | 'command'
  | 'prompt'
  | 'loop'
  | 'bash'
  | 'script'
  | 'approval'
  | 'plannotator_gate'
  | 'workflow'
  | 'route_loop'
  | 'loop_group'
  | 'unknown';

export type RoomKind = 'agent' | 'stdout' | 'gate' | 'workflow' | 'route_loop' | 'loop_group';

export interface RoomResolution {
  kind: RoomKind;
  nodeType: NodeBodyKind;
  definitionNode: DagNode | null;
}

const ROOM_BY_BODY: Record<NodeBodyKind, RoomKind> = {
  command: 'agent',
  prompt: 'agent',
  loop: 'agent',
  bash: 'stdout',
  script: 'stdout',
  approval: 'gate',
  plannotator_gate: 'gate',
  workflow: 'workflow',
  route_loop: 'route_loop',
  loop_group: 'loop_group',
  unknown: 'agent',
};

function findDefinitionNode(
  nodeId: string,
  nodes: readonly DagNode[],
  prefix = ''
): DagNode | null {
  for (const node of nodes) {
    const qualifiedId = prefix.length === 0 ? node.id : prefix + '.' + node.id;
    if (qualifiedId === nodeId) return node;
    if (node.loop_group !== undefined) {
      const nested = findDefinitionNode(nodeId, node.loop_group.nodes, qualifiedId);
      if (nested !== null) return nested;
    }
  }
  return null;
}

export function nodeBodyKind(node: DagNode): NodeBodyKind {
  if (node.route_loop !== undefined) return 'route_loop';
  if (node.loop_group !== undefined) return 'loop_group';
  if (node.loop !== undefined) return 'loop';
  if (node.plannotator_gate !== undefined) return 'plannotator_gate';
  if (node.approval !== undefined) return 'approval';
  if (node.bash !== undefined) return 'bash';
  if (node.script !== undefined) return 'script';
  if (node.workflow !== undefined) return 'workflow';
  if (node.command !== undefined) return 'command';
  if (node.prompt !== undefined) return 'prompt';
  return 'unknown';
}

function eventDataRecord(event: WorkflowEventResponse): Record<string, unknown> {
  return event.data;
}

function latestMatching(
  events: readonly WorkflowEventResponse[],
  predicate: (event: WorkflowEventResponse) => boolean
): WorkflowEventResponse | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && predicate(event)) return event;
  }
  return null;
}

function resolution(
  kind: RoomKind,
  nodeType: NodeBodyKind,
  definitionNode: DagNode | null
): RoomResolution {
  return { kind, nodeType, definitionNode };
}

export function resolveRoomKind(
  nodeId: string,
  definitionNodes: readonly DagNode[],
  events: readonly WorkflowEventResponse[],
  approval: unknown
): RoomResolution {
  const definitionNode = findDefinitionNode(nodeId, definitionNodes);
  if (definitionNode !== null) {
    const nodeType = nodeBodyKind(definitionNode);
    return resolution(ROOM_BY_BODY[nodeType], nodeType, definitionNode);
  }

  const context = readApprovalContext(approval);
  if (context !== null && context.nodeId === nodeId) {
    if (context.type === 'child_workflow') {
      return resolution('workflow', 'workflow', null);
    }
    if (
      context.type === 'approval' ||
      context.type === 'plannotator_gate' ||
      context.type === undefined
    ) {
      return resolution(
        'gate',
        context.type === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
        null
      );
    }
  }

  const routed = events.find(
    event => event.step_name === nodeId && event.event_type === 'node_routed'
  );
  if (routed !== undefined) {
    return resolution('route_loop', 'route_loop', null);
  }

  const stdoutEvent = latestMatching(events, event => {
    if (event.step_name !== nodeId) return false;
    if (
      event.event_type !== 'node_started' &&
      event.event_type !== 'node_completed' &&
      event.event_type !== 'node_failed'
    ) {
      return false;
    }
    const type = eventDataRecord(event).type;
    return type === 'bash' || type === 'script';
  });
  if (stdoutEvent !== null) {
    return resolution(
      'stdout',
      eventDataRecord(stdoutEvent).type === 'bash' ? 'bash' : 'script',
      null
    );
  }

  const workflowEvent = latestMatching(events, event => {
    if (event.step_name !== nodeId) return false;
    if (event.event_type !== 'node_completed' && event.event_type !== 'node_failed') return false;
    return eventDataRecord(event).type === 'workflow';
  });
  if (workflowEvent !== null) {
    return resolution('workflow', 'workflow', null);
  }

  const gateEvent = latestMatching(events, event => {
    if (event.step_name !== nodeId || event.event_type !== 'approval_requested') return false;
    const gateType = eventDataRecord(event).gateType;
    return gateType === 'approval' || gateType === 'plannotator_gate';
  });
  if (gateEvent !== null) {
    return resolution(
      'gate',
      eventDataRecord(gateEvent).gateType === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
      null
    );
  }

  return resolution('agent', 'unknown', null);
}
