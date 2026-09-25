import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { dagNodesToReactFlow, reactFlowToDagNodes } from './WorkflowCanvas';
import type { DagNode } from '@/lib/api';
import type { DagFlowNode } from './DagNodeComponent';
import { serializeWorkflowToYaml } from '@/lib/workflow-yaml';

describe('reactFlowToDagNodes route_loop serialization', () => {
  test('uses route_loop node data instead of stale route edges', () => {
    const nodes = [
      {
        id: 'review-router',
        type: 'dagNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'review-router',
          label: 'Route',
          nodeType: 'route_loop',
          depends_on: ['new-review'],
          route_loop: {
            condition: "$new-review.output.result == 'positive'",
            max_iterations: 3,
            routes: {
              positive: 'done-from-inspector',
              negative: 'fix',
              exhausted: 'escalate',
            },
          },
        },
      },
    ] as DagFlowNode[];
    const edges = [
      {
        id: 'old-review->review-router',
        source: 'old-review',
        target: 'review-router',
      },
      {
        id: 'review-router->stale-done:positive',
        source: 'review-router',
        sourceHandle: 'positive',
        target: 'stale-done',
      },
    ] satisfies Edge[];

    const [routeNode] = reactFlowToDagNodes(nodes, edges);

    expect(routeNode.depends_on).toEqual(['old-review']);
    expect('route_loop' in routeNode).toBe(true);
    if (!('route_loop' in routeNode)) throw new Error('expected route_loop node');
    expect(routeNode.route_loop).toMatchObject({
      routes: {
        positive: 'done-from-inspector',
        negative: 'fix',
        exhausted: 'escalate',
      },
    });
  });
});

describe('reactFlowToDagNodes read-only node passthrough', () => {
  test('preserves nested plannotator gate and cancel payloads', () => {
    const original: DagNode[] = [
      { id: 'prepare', prompt: 'Prepare the review.' },
      {
        id: 'review-gate',
        depends_on: ['prepare'],
        plannotator_gate: {
          prepare: {
            prompt: 'Build $prepare.output into review.html.',
            provider: 'claude',
            model: 'sonnet',
            effort: 'medium',
            allowed_tools: ['Read', 'Edit'],
          },
          message: 'Review the generated document.',
          capture_response: true,
          rework: {
            prompt: 'Apply $REVIEW_ANNOTATIONS to $REVIEW_DOCUMENT.',
            provider: 'codex',
            model: 'gpt-5.6-terra',
            effort: 'high',
          },
        },
      },
      {
        id: 'abort',
        depends_on: ['review-gate'],
        cancel: 'Reviewer rejected the workflow.',
      },
    ];

    const flow = dagNodesToReactFlow(original);
    const roundTripped = reactFlowToDagNodes(flow.nodes, flow.edges);

    expect(JSON.parse(JSON.stringify(roundTripped))).toEqual(original);
  });
});

describe('reactFlowToDagNodes unsupported-node round trip', () => {
  const preflight: DagNode = { id: 'preflight', bash: 'echo hi' };

  const readOnlyCases: Array<{ name: string; node: DagNode }> = [
    {
      name: 'loop (with provider/model/effort)',
      node: {
        id: 'ralph-loop-run',
        provider: 'omp',
        model: 'cursor/cursor-grok-4.5',
        effort: 'xhigh',
        depends_on: ['preflight'],
        when: "$preflight.output.hasPending == 'true'",
        loop: {
          command: 'archon-speckit-ralph-iteration',
          fresh_context: true,
          max_iterations: 100,
          until_bash: 'exit 0',
        },
      } as unknown as DagNode,
    },
    {
      name: 'loop_group',
      node: {
        id: 'lg',
        depends_on: ['preflight'],
        loop_group: { max_iterations: 5, until: 'DONE', nodes: [{ id: 'body', prompt: 'work' }] },
      } as unknown as DagNode,
    },
    {
      name: 'script',
      node: {
        id: 'sc',
        depends_on: ['preflight'],
        runtime: 'bun',
        script: 'console.log(1)',
        timeout: 1000,
      } as unknown as DagNode,
    },
    {
      name: 'include',
      node: {
        id: 'inc',
        depends_on: ['preflight'],
        include: 'other-workflow',
        with: { foo: 'bar' },
      } as unknown as DagNode,
    },
    {
      name: 'workflow',
      node: {
        id: 'wf',
        depends_on: ['preflight'],
        workflow: 'child-wf',
        input: 'data',
        isolation: 'worktree',
      } as unknown as DagNode,
    },
    {
      name: 'approval',
      node: {
        id: 'appr',
        depends_on: ['preflight'],
        approval: { message: 'ok?', capture_response: true },
      } as unknown as DagNode,
    },
  ];

  for (const { name, node } of readOnlyCases) {
    test(`preserves ${name} payload verbatim`, () => {
      const original = [preflight, node];
      const flow = dagNodesToReactFlow(original);
      const roundTripped = reactFlowToDagNodes(flow.nodes, flow.edges);
      expect(JSON.parse(JSON.stringify(roundTripped))).toEqual(original);
    });
  }

  test('loop node keeps loop/effort and gains no fabricated prompt', () => {
    const loopCase = readOnlyCases[0];
    const flow = dagNodesToReactFlow([preflight, loopCase.node]);
    const [, roundTripped] = reactFlowToDagNodes(flow.nodes, flow.edges) as Record<
      string,
      unknown
    >[];
    expect('loop' in roundTripped).toBe(true);
    expect(roundTripped.effort).toBe('xhigh');
    expect('prompt' in roundTripped).toBe(false);
  });

  test('serialized preview YAML retains the loop block', () => {
    const loopCase = readOnlyCases[0].node;
    const flow = dagNodesToReactFlow([preflight, loopCase]);
    const nodes = reactFlowToDagNodes(flow.nodes, flow.edges);
    const yaml = serializeWorkflowToYaml({
      name: 'speckit-ralph-test',
      description: '',
      nodes,
    } as never);
    expect(yaml).toContain('loop:');
    expect(yaml).toContain('until_bash:');
    expect(yaml).toContain('effort: xhigh');
  });
});
