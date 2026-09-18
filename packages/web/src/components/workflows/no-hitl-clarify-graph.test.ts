import { describe, expect, test } from 'bun:test';
import type { DagNode } from '@/lib/api';
import { BACK_EDGE_GUTTER, NODE_WIDTH } from '@/lib/run-graph/constants';
import type { DagNodeState } from '@/lib/types';
import { layoutRunGraph } from './build-run-graph-input';
import { buildWorkflowDagViewModel } from './build-workflow-dag-view-model';

interface YamlNode {
  id: string;
  depends_on?: string[] | string;
  when?: string;
  route_loop?: DagNode['route_loop'];
}

// The speckit-ralph-native-no-hitl-feature workflow this describes was removed
// from .archon/workflows/defaults; keep its node topology here so the clarify
// branch layout stays covered.
const NODES: readonly YamlNode[] = [
  { id: 'setup' },
  { id: 'specify', depends_on: ['setup'] },
  { id: 'clarify', depends_on: ['specify'] },
  { id: 'clarify-file-check', depends_on: ['clarify'] },
  {
    id: 'clarify-respond',
    depends_on: ['clarify-file-check'],
    when: "$clarify-file-check.output == 'HAS_QUESTIONS'",
  },
  { id: 'clarify-apply', depends_on: ['clarify-respond'] },
  { id: 'red-team', depends_on: ['clarify-file-check', 'clarify-respond', 'clarify-apply'] },
  { id: 'red-team-respond', depends_on: ['red-team'] },
  { id: 'red-team-apply', depends_on: ['red-team-respond'] },
  { id: 'plan', depends_on: ['red-team-apply'] },
  { id: 'tasks', depends_on: ['plan'] },
  { id: 'analyze', depends_on: ['tasks'] },
  { id: 'analyze-respond', depends_on: ['analyze'] },
  { id: 'analyze-apply', depends_on: ['analyze-respond'] },
  { id: 'ralph-tasks-to-ralph', depends_on: ['analyze-apply', 'speckit-converge-review-gate'] },
  { id: 'ralph-native-preflight', depends_on: ['ralph-tasks-to-ralph'] },
  { id: 'ralph-loop-run', depends_on: ['ralph-native-preflight'] },
  { id: 'ralph-sync-back', depends_on: ['ralph-loop-run'] },
  { id: 'speckit-converge', depends_on: ['ralph-sync-back'] },
  {
    id: 'speckit-converge-gate',
    depends_on: ['speckit-converge'],
    route_loop: {
      condition: "$speckit-converge.output.gate == 'PASS'",
      max_iterations: 3,
      routes: {
        positive: 'cargo-clean-before-pr',
        negative: 'speckit-converge-review-gate',
        exhausted: 'speckit-final-ralph-tasks-to-ralph',
      },
    },
  },
  { id: 'speckit-converge-review-gate' },
  { id: 'speckit-final-ralph-tasks-to-ralph', depends_on: ['speckit-converge-gate'] },
  {
    id: 'speckit-final-ralph-native-preflight',
    depends_on: ['speckit-final-ralph-tasks-to-ralph'],
  },
  { id: 'speckit-final-ralph-loop-run', depends_on: ['speckit-final-ralph-native-preflight'] },
  { id: 'speckit-final-ralph-sync-back', depends_on: ['speckit-final-ralph-loop-run'] },
  { id: 'cargo-clean-before-pr', depends_on: ['speckit-converge-gate'] },
  { id: 'speckit-final-cargo-clean-before-pr', depends_on: ['speckit-final-ralph-sync-back'] },
  {
    id: 'update-bmad-sprint-status',
    depends_on: ['cargo-clean-before-pr', 'speckit-final-cargo-clean-before-pr'],
  },
  { id: 'create-pull-request', depends_on: ['update-bmad-sprint-status'] },
];

function toDagNodes(raw: { nodes: readonly YamlNode[] }): DagNode[] {
  return raw.nodes.map(node => {
    const dag: DagNode = { id: node.id, prompt: node.id };
    if (node.depends_on !== undefined) {
      dag.depends_on = Array.isArray(node.depends_on) ? node.depends_on : [node.depends_on];
    }
    if (typeof node.when === 'string') {
      dag.when = node.when;
    }
    if (node.route_loop) {
      dag.route_loop = node.route_loop;
    }
    return dag;
  });
}

function live(nodeId: string, status: DagNodeState['status']): DagNodeState {
  return { nodeId, name: nodeId, status };
}

function clarifyBranchLiveStatus(dagNodes: readonly DagNode[]): DagNodeState[] {
  const statusById: Record<string, DagNodeState['status']> = {
    setup: 'completed',
    specify: 'completed',
    clarify: 'completed',
    'clarify-file-check': 'completed',
    'clarify-respond': 'skipped',
    'clarify-apply': 'skipped',
    'red-team': 'running',
  };
  return dagNodes.map(node => live(node.id, statusById[node.id] ?? 'pending'));
}

describe('speckit-ralph-native-no-hitl-feature clarify branch', () => {
  test('then stays on the spine and skip detours to the right of respond/apply', () => {
    const dagNodes = toDagNodes({ nodes: NODES });
    expect(dagNodes.map(node => node.id)).toContain('clarify-file-check');

    const liveStatus = clarifyBranchLiveStatus(dagNodes);
    const layout = layoutRunGraph(dagNodes, liveStatus);
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus,
      selectedNodeId: 'clarify-file-check',
    });

    const thenRoute = layout.routes.find(
      route => route.source === 'clarify-file-check' && route.target === 'clarify-respond'
    );
    const skipRoute = layout.routes.find(
      route => route.source === 'clarify-file-check' && route.target === 'red-team'
    );
    expect(thenRoute).toBeDefined();
    expect(skipRoute).toBeDefined();
    if (thenRoute === undefined || skipRoute === undefined) return;

    expect(thenRoute.kind).toBe('conditional');
    expect(thenRoute.targetPort).toBe('top');
    expect(skipRoute.kind).toBe('dependency');
    expect(skipRoute.label).toBe('else');
    expect(skipRoute.outcome).toBe('negative');
    expect(skipRoute.targetPort).toBe('right');
    expect(skipRoute.path).not.toBe(thenRoute.path);
    expect(skipRoute.labelPosition).not.toEqual(thenRoute.labelPosition);

    const check = layout.positions['clarify-file-check'];
    const respond = layout.positions['clarify-respond'];
    const apply = layout.positions['clarify-apply'];
    expect(check).toBeDefined();
    expect(respond).toBeDefined();
    expect(apply).toBeDefined();
    const spineX = check.x + NODE_WIDTH / 2;
    const flankX = check.x + NODE_WIDTH + BACK_EDGE_GUTTER;
    expect(thenRoute.path.startsWith(`M ${spineX} `)).toBe(true);
    expect(skipRoute.path).toContain(`C ${flankX} `);
    expect(Math.abs(respond.x - check.x)).toBeLessThan(1);
    expect(Math.abs(apply.x - check.x)).toBeLessThan(1);

    const skipEdge = model.edges.find(edge => edge.id === skipRoute.edgeId);
    expect(skipEdge?.type).toBe('runGraphRoute');
    expect(skipEdge?.data?.route.path).toBe(skipRoute.path);
  });
});
