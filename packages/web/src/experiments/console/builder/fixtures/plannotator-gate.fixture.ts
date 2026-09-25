import type { WireWorkflowDefinition } from '../types';

export const plannotatorGateFixture: WireWorkflowDefinition = {
  name: 'plannotator-gate-fixture',
  description: 'Pauses for a live review of an agent-prepared document.',
  interactive: true,
  nodes: [
    {
      id: 'review-gate',
      plannotator_gate: {
        prepare: {
          prompt: 'Create review.html from $draft.output.',
          provider: 'claude',
          model: 'sonnet',
          effort: 'medium',
          allowed_tools: ['Read', 'Edit'],
          denied_tools: ['Bash'],
        },
        message: 'Review the prepared document.',
        capture_response: true,
        rework: {
          prompt: 'Apply $REVIEW_ANNOTATIONS to $REVIEW_DOCUMENT.',
          provider: 'codex',
          model: 'gpt-5.6-terra',
          effort: 'high',
        },
      },
    },
  ],
};
