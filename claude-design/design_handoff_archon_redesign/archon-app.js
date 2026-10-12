// Shared data + helpers for Archon screens (Workflows, Chat, Builder, Settings, Login). Sample values.
window.ArchonApp = {
  c: { hdrBg: '#1a2130', hdrFg: '#f1f4f9', hdrMuted: '#9aa5b8', hdrAccent: '#7aa2ff', bg: '#f5f7fa', surface: '#eaeef3', text: '#1a2130', muted: '#5a6478', faint: '#98a1b2', line: '#e2e6ed', strong: '#c9d0db', sel: '#e4ecfb', code: '#1a2130', codeFg: '#e6e9f0', wait: '#d97706', fail: '#dc2626', run: '#2563eb', done: '#16a34a', pend: '#d3d9e3', accent: '#2563eb' },
  kinds: {
    command: { code: 'CMD', label: 'Command', desc: 'Runs a saved command file' },
    prompt: { code: 'PRM', label: 'Prompt', desc: 'Inline prompt to an agent' },
    bash: { code: 'SH', label: 'Bash', desc: 'Shell script, no agent' },
    loop: { code: 'LOOP', label: 'Loop', desc: 'Repeats until a condition holds' },
    approval: { code: 'GATE', label: 'Approval', desc: 'Pauses for a human decision' }
  },
  projects: [
    { name: 'kevinle128/Archon', kind: 'GitHub', branch: 'dev', path: '~/code/Archon', workflows: 4 },
    { name: 'kevinle128/billing-service', kind: 'GitHub', branch: 'main', path: '~/code/billing-service', workflows: 1 },
    { name: 'ops/finance-close', kind: 'Folder', branch: '', path: '~/ops/finance-close', workflows: 0 }
  ],
  workflows: [
    { name: 'archon-issue-review-full', cat: 'Code Review', src: 'bundled', input: 'GitHub issue URL', desc: 'Full fix and review pipeline for a GitHub issue. Investigates, implements, then runs four parallel reviews.', runs: 42,
      nodes: [['investigate', 'command', 0], ['implement', 'command', 1], ['review__verify-pr-base', 'bash', 2], ['review__code-review', 'prompt', 3], ['review__error-handling', 'prompt', 3], ['review__test-coverage', 'prompt', 3]] },
    { name: 'archon-comprehensive-pr-review', cat: 'Code Review', src: 'bundled', input: 'Pull request URL', desc: 'Comprehensive PR review with automatic fixes.', runs: 31,
      nodes: [['scope', 'command', 0], ['sync', 'command', 1], ['code-review', 'command', 2], ['error-handling', 'command', 2], ['test-coverage', 'command', 2], ['comment-quality', 'command', 2], ['docs-impact', 'command', 2], ['synthesize', 'command', 3], ['implement-fixes', 'command', 4]] },
    { name: 'archon-smart-pr-review', cat: 'Code Review', src: 'bundled', input: 'Pull request URL', desc: 'Picks review depth from the size and risk of the diff.', runs: 18,
      nodes: [['classify', 'prompt', 0], ['review', 'command', 1], ['report', 'prompt', 2]] },
    { name: 'archon-ralph-dag-project-aware', cat: 'Development', src: 'project', input: 'PRD or feature description', desc: 'Ralph loop with project-aware validation.', runs: 12,
      nodes: [['detect-input', 'command', 0], ['generate-prd', 'prompt', 1], ['ready-prd', 'command', 2], ['validate-prd', 'bash', 2], ['implement', 'loop', 3], ['report', 'prompt', 4]] },
    { name: 'archon-feature-development', cat: 'Development', src: 'bundled', input: 'Feature request', desc: 'Plan, implement and open a PR for a feature request.', runs: 27,
      nodes: [['plan', 'prompt', 0], ['implement', 'command', 1], ['validate', 'bash', 2], ['create-pr', 'command', 3]] },
    { name: 'archon-plan-to-pr', cat: 'Development', src: 'bundled', input: 'Path to an approved plan', desc: 'Turns an approved plan into a merge-ready pull request.', runs: 9,
      nodes: [['plan-setup', 'command', 0], ['confirm-plan', 'approval', 1], ['implement-tasks', 'command', 2], ['validate', 'command', 3], ['finalize-pr', 'command', 4]] },
    { name: 'archon-adversarial-dev', cat: 'Development', src: 'bundled', input: 'Feature description', desc: 'Builder and breaker agents sprint against each other until the tests hold.', runs: 4,
      nodes: [['plan', 'prompt', 0], ['init-workspace', 'bash', 1], ['adversarial-sprint', 'loop', 2], ['report', 'prompt', 3]] },
    { name: 'speckit-ralph-native-feature', cat: 'Development', src: 'project', input: 'GitHub issue URL', desc: 'Spec Kit spec into a native Ralph loop.', runs: 6,
      nodes: [['setup', 'bash', 0], ['plan', 'prompt', 1], ['verify-and-fix-plan', 'prompt', 2], ['build-ralph-prd', 'prompt', 2], ['ralph-native-preflight', 'bash', 3], ['ralph-loop-run', 'loop', 4], ['codex-final-fix', 'prompt', 5], ['create-pull-request', 'command', 6]] },
    { name: 'archon-architect', cat: 'Automation', src: 'bundled', input: 'Area of the codebase', desc: 'Architectural sweep and complexity reduction.', runs: 7,
      nodes: [['scan-metrics', 'bash', 0], ['analyze', 'prompt', 1], ['plan', 'prompt', 2], ['simplify', 'prompt', 3], ['validate', 'bash', 4], ['create-pr', 'prompt', 5]] },
    { name: 'archon-interactive-prd', cat: 'Automation', src: 'bundled', input: 'Product idea', desc: 'Guided PRD with three human gates.', runs: 15,
      nodes: [['initiate', 'prompt', 0], ['foundation-gate', 'approval', 1], ['research', 'prompt', 2], ['deepdive-gate', 'approval', 3], ['technical', 'prompt', 4], ['scope-gate', 'approval', 5], ['generate', 'prompt', 6]] },
    { name: 'archon-resolve-conflicts', cat: 'Automation', src: 'bundled', input: 'Branch name', desc: 'Resolves merge conflicts on the current branch.', runs: 22,
      nodes: [['resolve', 'command', 0]] },
    { name: 'archon-workflow-builder', cat: 'Automation', src: 'bundled', input: 'What the workflow should do', desc: 'Drafts a new workflow YAML from a description.', runs: 3,
      nodes: [['interview', 'prompt', 0], ['draft', 'prompt', 1], ['validate', 'bash', 2]] },
    { name: 'bmad-readiness-correct-course-loop', cat: 'Automation', src: 'project', input: 'Epic or story path', desc: 'BMAD readiness check with a correct-course loop.', runs: 5,
      nodes: [['readiness', 'prompt', 0], ['correct-course', 'loop', 1], ['report', 'prompt', 2]] }
  ],
  conversations: [
    { id: 'c1', title: 'Fix queued guidance on iteration end', when: '10:03', project: 'kevinle128/Archon', branch: 'archon/issue-266', run: { id: 'r-6c02d4', workflow: 'archon-issue-review-full' },
      msgs: [
        { role: 'user', time: '10:02', text: 'Issue #266 is ready. Run the full issue review on it.' },
        { role: 'assistant', time: '10:03', text: 'Starting archon-issue-review-full on kevinle128/Archon for issue #266. It runs in an isolated worktree on archon/issue-266. I will post here if it needs you.', card: true }
      ] },
    { id: 'c2', title: 'Why did ak-feature fail on #198', when: 'Fri', project: 'kevinle128/Archon', branch: 'archon/issue-198',
      msgs: [
        { role: 'user', time: 'Fri 11:20', text: 'Why did ak-feature fail on #198?' },
        { role: 'assistant', time: 'Fri 11:20', text: 'ralph-loop-run failed on iteration 3. The property test runner ran out of memory after 1,204 cases. The first two iterations passed. Retrying from the failed node with a lower case count should be enough.' },
        { role: 'user', time: 'Fri 11:22', text: 'Lower it to 500 and retry tomorrow.' },
        { role: 'assistant', time: 'Fri 11:22', text: 'Noted. I set PROPERTY_CASES=500 in the project env. The retry is not started yet.' }
      ] },
    { id: 'c3', title: 'Plan the invoices migration', when: 'Thu', project: 'kevinle128/billing-service', branch: 'main',
      msgs: [
        { role: 'user', time: 'Thu 16:05', text: 'Draft a plan for moving invoices to the new ledger tables.' },
        { role: 'assistant', time: 'Thu 16:07', text: 'Draft saved to plans/invoices-ledger.md. It has four phases: dual-write, backfill, read switch, drop old columns. Phase two needs a maintenance window.' }
      ] },
    { id: 'c4', title: 'September close checklist', when: 'Sep 29', project: 'ops/finance-close', branch: '',
      msgs: [
        { role: 'user', time: 'Sep 29 17:10', text: 'Start the month close for September.' },
        { role: 'assistant', time: 'Sep 29 17:52', text: 'month-close completed in 41m. Three gates were approved. The checklist is in close/2026-09.md.' }
      ] }
  ],
  commands: [
    ['/run <workflow> <input>', 'Start a workflow'],
    ['/status', 'Runs in this project'],
    ['/workflows', 'List available workflows'],
    ['/cancel <run>', 'Cancel a run']
  ],
  settings: {
    providers: [
      { name: 'Anthropic', auth: 'API key', value: 'sk-ant-••••4f2a', ok: true },
      { name: 'Claude subscription', auth: 'Login', value: 'kevin@ · Max plan', ok: true },
      { name: 'OpenAI Codex', auth: 'Login', value: 'ChatGPT Pro', ok: true },
      { name: 'xAI Grok', auth: 'API key', value: 'Not set', ok: false },
      { name: 'DeepSeek', auth: 'API key', value: 'Not set', ok: false }
    ],
    tiers: [
      { tier: 'Small', model: 'claude-haiku-4-5', use: 'Classify, summarize, route' },
      { tier: 'Medium', model: 'claude-sonnet-4-5', use: 'Default for prompt nodes' },
      { tier: 'Large', model: 'claude-opus-4-1', use: 'Planning and final fixes' }
    ],
    models: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1', 'gpt-5-codex', 'grok-4', 'deepseek-v3.2'],
    aliases: [
      { name: '@fast', model: 'claude-haiku-4-5' },
      { name: '@deep', model: 'claude-opus-4-1' },
      { name: '@codex', model: 'gpt-5-codex' }
    ],
    usage: {
      '7d': [['Anthropic', 18, '5.1M', '$11.90'], ['OpenAI Codex', 6, '1.8M', 'Subscription'], ['Claude subscription', 11, '3.2M', 'Subscription']],
      '30d': [['Anthropic', 64, '18.2M', '$41.80'], ['OpenAI Codex', 21, '6.4M', 'Subscription'], ['Claude subscription', 38, '11.9M', 'Subscription']],
      all: [['Anthropic', 212, '61.0M', '$139.20'], ['OpenAI Codex', 58, '17.7M', 'Subscription'], ['Claude subscription', 104, '33.4M', 'Subscription']]
    }
  },
  loadProject() { try { return localStorage.getItem('archon.project') || 'all'; } catch (e) { return 'all'; } },
  saveProject(v) { try { localStorage.setItem('archon.project', v); } catch (e) {} },
  projectOpts(runs) {
    return [{ value: 'all', label: 'All projects' }].concat(this.projects.map(p => ({ value: p.name, label: p.name + (runs ? ' (' + runs.filter(r => r.project === p.name).length + ')' : '') })));
  },
  needs(runs) { return runs.filter(r => r.status === 'paused').length; },
  st(k) {
    const c = this.c, M = { running: ['▶', 'Running', c.run], paused: ['!', 'Awaiting you', c.wait], awaiting: ['!', 'Awaiting you', c.wait], done: ['✓', 'Done', c.done], completed: ['✓', 'Completed', c.done], failed: ['✕', 'Failed', c.fail], cancelled: ['–', 'Cancelled', c.faint], pending: ['○', 'Pending', c.faint] };
    const m = M[k] || M.pending; return { glyph: m[0], label: m[1], color: m[2] };
  },
  split(p) { const a = p.split('/'); return { owner: a.slice(0, -1).join('/'), repo: a[a.length - 1] }; }
};
