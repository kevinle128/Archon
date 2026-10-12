// Sample runs for the Runs workspace prototype. Durations, costs, tokens are sample values.
window.ArchonRuns = {
  projects: ['kevinle128/Archon', 'kevinle128/billing-service', 'ops/finance-close'],
  kinds: { command: 'CMD', prompt: 'PRM', bash: 'SH', loop: 'LOOP', approval: 'GATE' },
  runs: [
    { id: 'r-6c02d4', name: 'issue-review', note: 'Issue #266', workflow: 'archon-issue-review-full', project: 'kevinle128/Archon', status: 'running', started: '10:04', elapsed: 362, cost: '$1.18', branch: 'archon/issue-266', input: 'github.com/kevinle128/Archon/issues/266',
      nodes: [
        { id: 'investigate', kind: 'command', state: 'done', dur: '1m 48s', layer: 0, model: 'claude-sonnet-4-5', summary: 'Root cause: the guidance queue is flushed on iteration end before the next turn reads it.' },
        { id: 'implement', kind: 'command', state: 'running', layer: 1, model: 'claude-sonnet-4-5', focus: true,
          todo: [['Persist queue across iterations', 1], ['Drain queue at turn start', 1], ['Add regression test', 0], ['Update steering dock label', 0], ['Run package tests', 0]],
          stream: [
            { t: 'agent', time: '10:06:02', text: 'Picking up from investigate. The fix lives in packages/core/src/steering/queue.ts. I will keep the queue in the run store instead of the iteration scope.' },
            { t: 'tool', time: '10:06:05', name: 'Read', target: 'packages/core/src/steering/queue.ts', meta: '214 lines', body: 'export class GuidanceQueue {\n  private items: Guidance[] = [];\n  flush(): Guidance[] { const out = this.items; this.items = []; return out; }\n  ...' },
            { t: 'think', time: '10:06:11', text: 'Thinking · 6s', body: 'flush() is called from onIterationEnd. If I move the drain to onTurnStart the queue survives the boundary. Need to check the Codex and Grok adapters call onTurnStart too.' },
            { t: 'tool', time: '10:06:19', name: 'Grep', target: 'onTurnStart', meta: '5 matches in 5 files', body: 'packages/providers/src/claude/adapter.ts:88\npackages/providers/src/codex/adapter.ts:141\npackages/providers/src/grok/adapter.ts:97\npackages/providers/src/deepseek/adapter.ts:76\npackages/providers/src/omp/adapter.ts:64' },
            { t: 'tool', time: '10:06:40', name: 'Edit', target: 'packages/core/src/steering/queue.ts', meta: '+48 −12', body: '-  onIterationEnd() { this.flush(); }\n+  onTurnStart(): Guidance[] {\n+    const pending = this.store.takePending(this.runId);\n+    return pending;\n+  }' },
            { t: 'agent', time: '10:07:12', text: 'Queue now lives in the run store and drains at turn start. All five adapters already call onTurnStart, so no adapter changes are needed.' }
          ],
          live: [
            { t: 'tool', name: 'Write', target: 'packages/core/src/steering/queue.test.ts', meta: '+96', body: "test('guidance queued at iteration end is read next turn', async () => {\n  const q = new GuidanceQueue(store, 'r-1');\n  q.push('prefer server fix');\n  q.onIterationEnd();\n  expect(q.onTurnStart()).toHaveLength(1);\n});" },
            { t: 'tool', name: 'Bash', target: 'bun test packages/core/src/steering', meta: 'running' , body: '$ bun test packages/core/src/steering' },
            { t: 'tool', name: 'Bash', target: 'bun test packages/core/src/steering', meta: '12 pass · 0 fail', body: ' 12 pass\n  0 fail\nRan 12 tests across 2 files. [1.84s]' },
            { t: 'agent', text: 'Regression test added and passing. Next I will update the steering dock label so queued items read as "Queued for next turn" instead of "Sent", then run the full web test suite before handing off to review.' }
          ]
        },
        { id: 'review__verify-pr-base', kind: 'bash', state: 'pending', layer: 2 },
        { id: 'review__code-review', kind: 'prompt', state: 'pending', layer: 3 },
        { id: 'review__error-handling', kind: 'prompt', state: 'pending', layer: 3 },
        { id: 'review__test-coverage', kind: 'prompt', state: 'pending', layer: 3 }
      ] },
    { id: 'r-7f3a91', name: 'ak-feature', note: 'Issue #266', workflow: 'speckit-ralph-native-feature', project: 'kevinle128/Archon', status: 'paused', started: '09:51', elapsed: 141, cost: '$0.42', branch: 'archon/issue-266-plan', input: 'github.com/kevinle128/Archon/issues/266',
      nodes: [
        { id: 'setup', kind: 'bash', state: 'done', dur: '6.7s', layer: 0, summary: 'Worktree ready on archon/issue-266-plan, based on dev at 3c9e1f2.' },
        { id: 'plan', kind: 'prompt', state: 'awaiting', dur: '2m 14s', layer: 1, model: 'claude-opus-4-1', focus: true,
          stream: [
            { t: 'agent', time: '09:51:12', text: 'Reading issue #266: "Queued guidance is dropped when the agent finishes an iteration."' },
            { t: 'tool', time: '09:51:20', name: 'Read', target: 'packages/web/src/lib/steering-dock.ts', meta: '214 lines', body: 'export function useSteeringDock(runId: string) { ... }' },
            { t: 'tool', time: '09:51:31', name: 'Grep', target: 'queueGuidance', meta: '7 matches in 4 files', body: 'packages/core/src/steering/queue.ts:12\npackages/core/src/steering/queue.ts:40\npackages/server/src/routes/runs.ts:211\npackages/web/src/lib/steering-dock.ts:58' },
            { t: 'agent', time: '09:52:40', text: 'The queue is flushed on iteration end before the next turn reads it. Two fixes are possible and they change the scope of the PR.' },
            { t: 'ask', time: '09:53:26', q: 'Which scope should the plan cover?', options: ['Server only: persist the queue across iterations', 'Server and web: persist, plus show queued items in the dock', 'Stop and let me write the scope'] }
          ] },
        { id: 'verify-and-fix-plan', kind: 'prompt', state: 'pending', layer: 2 },
        { id: 'build-ralph-prd', kind: 'prompt', state: 'pending', layer: 2 },
        { id: 'ralph-native-preflight', kind: 'bash', state: 'pending', layer: 3 },
        { id: 'ralph-loop-run', kind: 'loop', state: 'pending', layer: 4, cond: "$plan.output.plan_path != '' && $build-ralph-prd.output.prd_dir != ''" },
        { id: 'codex-final-fix', kind: 'prompt', state: 'pending', layer: 5 },
        { id: 'create-pull-request', kind: 'command', state: 'pending', layer: 6 }
      ] },
    { id: 'r-5a1e07', name: 'adversarial', note: 'Invoice rounding', workflow: 'archon-adversarial-dev', project: 'kevinle128/billing-service', status: 'running', started: '09:22', elapsed: 2510, cost: '$3.02', branch: 'archon/invoice-rounding', input: 'Fix rounding drift on multi-currency invoices',
      nodes: [
        { id: 'plan', kind: 'prompt', state: 'done', dur: '2m 03s', layer: 0, summary: 'Plan: 4 tasks. Reproduce drift, introduce Money type, migrate invoice math, property tests.' },
        { id: 'init-workspace', kind: 'bash', state: 'done', dur: '14s', layer: 1, summary: 'Installed deps and seeded fixtures.' },
        { id: 'adversarial-sprint', kind: 'loop', state: 'running', layer: 2, focus: true, model: 'gpt-5-codex',
          iterations: [
            { n: 1, state: 'done', dur: '6m 10s', summary: 'Builder added Money type. Breaker found 3 failing currency pairs.' },
            { n: 2, state: 'done', dur: '7m 42s', summary: 'Builder fixed JPY and KWD. Breaker found negative-zero on refunds.' },
            { n: 3, state: 'failed', dur: '4m 05s', summary: 'Breaker crashed the property runner. Retried automatically.' },
            { n: 4, state: 'running', dur: '', summary: 'Builder handling negative-zero refunds.' }
          ], maxIter: 8,
          todo: [['Reproduce drift', 1], ['Money type', 1], ['Migrate invoice math', 1], ['Negative-zero refunds', 0], ['Property tests green', 0]],
          stream: [
            { t: 'agent', time: '09:58:30', text: 'Iteration 4. Breaker reported that refunding 0.00 EUR yields -0.00 in the PDF total.' },
            { t: 'tool', time: '09:58:41', name: 'Read', target: 'src/money/format.ts', meta: '88 lines', body: 'export function format(m: Money) { return (m.minor / 10 ** m.exp).toFixed(m.exp); }' },
            { t: 'tool', time: '09:59:02', name: 'Edit', target: 'src/money/format.ts', meta: '+6 −1', body: '-  return (m.minor / 10 ** m.exp).toFixed(m.exp);\n+  const v = m.minor === 0 ? 0 : m.minor / 10 ** m.exp;\n+  return v.toFixed(m.exp);' }
          ],
          live: [
            { t: 'tool', name: 'Bash', target: 'bun test --filter money', meta: '41 pass · 0 fail', body: ' 41 pass\n  0 fail' },
            { t: 'agent', text: 'Negative-zero is normalised at format time and in Money.add. Handing the branch back to the breaker for iteration 5.' }
          ] },
        { id: 'report', kind: 'prompt', state: 'pending', layer: 3 }
      ] },
    { id: 'r-6b9e10', name: 'pr-review', note: 'PR #88', workflow: 'archon-comprehensive-pr-review', project: 'kevinle128/billing-service', status: 'running', started: '09:40', elapsed: 1117, cost: '$2.06', branch: 'feat/invoices', input: 'PR #88',
      nodes: [
        { id: 'scope', kind: 'command', state: 'done', dur: '22s', layer: 0, summary: '14 files, 612 lines. Touches invoices and tax.' },
        { id: 'sync', kind: 'command', state: 'done', dur: '9s', layer: 1, summary: 'Rebased on main, no conflicts.' },
        { id: 'code-review', kind: 'command', state: 'done', dur: '3m 12s', layer: 2, summary: '5 findings, 1 blocking: tax rounding uses float.' },
        { id: 'error-handling', kind: 'command', state: 'running', layer: 2, focus: true,
          stream: [
            { t: 'agent', time: '09:58:01', text: 'Checking error paths in the invoice service. Starting with the PDF renderer, which swallows exceptions.' },
            { t: 'tool', time: '09:58:09', name: 'Read', target: 'src/invoices/render.ts', meta: '140 lines', body: 'try { await pdf.render(doc) } catch {}' }
          ],
          live: [
            { t: 'agent', text: 'render.ts catches and drops renderer errors, so a failed PDF still marks the invoice as sent. Flagging as blocking and proposing to rethrow with the invoice id.' }
          ] },
        { id: 'test-coverage', kind: 'command', state: 'done', dur: '2m 40s', layer: 2, summary: 'Coverage 71% to 74%. Missing refund path tests.' },
        { id: 'comment-quality', kind: 'command', state: 'pending', layer: 2 },
        { id: 'docs-impact', kind: 'command', state: 'pending', layer: 2 },
        { id: 'synthesize', kind: 'command', state: 'pending', layer: 3 },
        { id: 'implement-fixes', kind: 'command', state: 'pending', layer: 4 }
      ] },
    { id: 'r-4d0f31', name: 'ak-feature', note: 'Issue #198', workflow: 'speckit-ralph-native-feature', project: 'kevinle128/Archon', status: 'failed', started: 'Fri 11:02', elapsed: 545, cost: '$0.97', branch: 'archon/issue-198', input: 'github.com/kevinle128/Archon/issues/198',
      nodes: [
        { id: 'setup', kind: 'bash', state: 'done', dur: '7.1s', layer: 0, summary: 'Worktree ready.' },
        { id: 'plan', kind: 'prompt', state: 'done', dur: '1m 52s', layer: 1, summary: 'Plan written to plans/issue-198/plan.md.' },
        { id: 'verify-and-fix-plan', kind: 'prompt', state: 'done', dur: '48s', layer: 2, summary: 'Plan verified.' },
        { id: 'build-ralph-prd', kind: 'prompt', state: 'done', dur: '1m 05s', layer: 2, summary: 'PRD with 6 stories.' },
        { id: 'ralph-native-preflight', kind: 'bash', state: 'done', dur: '11s', layer: 3, summary: 'Preflight passed.' },
        { id: 'ralph-loop-run', kind: 'loop', state: 'failed', dur: '5m 12s', layer: 4, focus: true, maxIter: 8, attempts: 2,
          iterations: [
            { n: 1, state: 'done', dur: '1m 40s', summary: 'Story 1 and 2 done.' },
            { n: 2, state: 'done', dur: '1m 58s', summary: 'Story 3 done. Story 4 blocked by a flaky test.' },
            { n: 3, state: 'failed', dur: '1m 34s', summary: 'Typecheck failed: Property "queuedAt" does not exist on type "Guidance".' }
          ],
          stream: [
            { t: 'agent', time: '11:09:20', text: 'Iteration 3. Implementing story 4: show the queued time in the dock.' },
            { t: 'tool', time: '11:09:31', name: 'Edit', target: 'packages/web/src/components/workflows/ComposerDock.tsx', meta: '+9 −2', body: '+  <span>{formatTime(item.queuedAt)}</span>' },
            { t: 'tool', time: '11:10:02', name: 'Bash', target: 'bun run type-check', meta: 'exit 2', err: true, body: 'ComposerDock.tsx(88,31): error TS2339: Property "queuedAt" does not exist on type "Guidance".' },
            { t: 'agent', time: '11:10:40', text: 'Typecheck failed and the loop hit its failure budget for this story. Stopping so you can decide whether to retry or edit the plan.' }
          ] },
        { id: 'codex-final-fix', kind: 'prompt', state: 'skipped', layer: 5 },
        { id: 'create-pull-request', kind: 'command', state: 'skipped', layer: 6 }
      ] },
    { id: 'r-5f1a77', name: 'month-close', note: 'Sept close', workflow: 'archon-interactive-prd', project: 'ops/finance-close', status: 'completed', started: 'Mon 17:12', elapsed: 2470, cost: '$3.40', branch: '', input: 'September close checklist',
      nodes: [
        { id: 'initiate', kind: 'prompt', state: 'done', dur: '1m 10s', layer: 0, summary: 'Collected entities and deadlines.' },
        { id: 'foundation-gate', kind: 'approval', state: 'done', dur: '12m', layer: 1, summary: 'Approved by Kevin Le.' },
        { id: 'research', kind: 'prompt', state: 'done', dur: '6m 30s', layer: 2, summary: 'Reconciled 4 bank feeds.' },
        { id: 'deepdive-gate', kind: 'approval', state: 'done', dur: '8m', layer: 3, summary: 'Approved by Kevin Le.' },
        { id: 'technical', kind: 'prompt', state: 'done', dur: '5m 02s', layer: 4, summary: 'Accrual schedule drafted.' },
        { id: 'scope-gate', kind: 'approval', state: 'done', dur: '3m', layer: 5, summary: 'Approved by Kevin Le.' },
        { id: 'generate', kind: 'prompt', state: 'done', dur: '4m 18s', layer: 6, focus: true, summary: 'Close pack written to close/2026-09/.' }
      ] }
  ]
};
