import type { DagNode } from '@/lib/api';
import { nodeBodyKind, type NodeBodyKind } from '@/components/workflows/resolve-room-kind';

/** Short code shown beside a node for each body kind. */
export const NODE_KIND_CODE: Readonly<Record<NodeBodyKind, string>> = {
  command: 'CMD',
  prompt: 'PRM',
  bash: 'SH',
  script: 'SCR',
  loop: 'LOOP',
  approval: 'GATE',
  plannotator_gate: 'GATE',
  workflow: 'WF',
  route_loop: 'ROUTE',
  loop_group: 'GROUP',
  unknown: 'NODE',
};

export interface StepNode {
  /** Runtime node id. A loop-group body node is `<groupId>.<bodyId>`, as the executor names it. */
  id: string;
  node: DagNode;
  kind: NodeBodyKind;
  code: string;
  /** Body nodes of a loop group, in declared order. Empty for every other kind. */
  children: StepNode[];
}

export interface NodeStep {
  /** 1-based position of the step. */
  index: number;
  /** Zero-padded label such as "01". */
  number: string;
  nodes: StepNode[];
  /** True when more than one node runs in this step. */
  parallel: boolean;
}

function toStepNode(node: DagNode, groupId?: string): StepNode {
  const kind = nodeBodyKind(node);
  const id = groupId === undefined ? node.id : `${groupId}.${node.id}`;
  return {
    id,
    node,
    kind,
    code: NODE_KIND_CODE[kind],
    children:
      node.loop_group !== undefined
        ? node.loop_group.nodes.map(child => toStepNode(child, id))
        : [],
  };
}

/**
 * Layer of each node: the longest chain of `depends_on` edges above it.
 * A dependency on an unknown id is ignored. A cycle cannot loop forever:
 * a node reached again while it is being resolved counts as layer 0.
 */
function computeLayers(nodes: readonly DagNode[]): Map<string, number> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const layers = new Map<string, number>();
  const resolving = new Set<string>();

  const layerOf = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    if (resolving.has(id)) return 0;
    resolving.add(id);
    let layer = 0;
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (byId.has(dep) && dep !== id) layer = Math.max(layer, layerOf(dep) + 1);
    }
    resolving.delete(id);
    layers.set(id, layer);
    return layer;
  };

  for (const node of nodes) layerOf(node.id);
  return layers;
}

/** Groups workflow nodes into ordered steps using their real `depends_on` edges. */
export function groupNodesIntoSteps(nodes: readonly DagNode[]): NodeStep[] {
  const layers = computeLayers(nodes);
  const byLayer = new Map<number, StepNode[]>();
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(toStepNode(node));
    byLayer.set(layer, bucket);
  }
  return [...byLayer.keys()]
    .sort((a, b) => a - b)
    .map((layer, position) => {
      const stepNodes = byLayer.get(layer) ?? [];
      return {
        index: position + 1,
        number: String(position + 1).padStart(2, '0'),
        nodes: stepNodes,
        parallel: stepNodes.length > 1,
      };
    });
}

/** Counts top-level nodes by kind code, in order of first appearance: "3 CMD · 1 SH · 2 PRM". */
export function summarizeNodeKinds(nodes: readonly DagNode[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const code = NODE_KIND_CODE[nodeBodyKind(node)];
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => `${String(count)} ${code}`).join(' · ');
}
