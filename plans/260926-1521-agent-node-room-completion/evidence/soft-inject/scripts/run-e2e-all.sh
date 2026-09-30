#!/bin/bash
# run-e2e-all.sh: full e2e UI suite on the reserved port base; the summary goes to stdout.
cd /Users/dale/orca/Archon/.claude/worktrees/agent-a4b1bef9c53f33b3c/e2e
export ARCHON_E2E_PORT_BASE=3580
bun run test:ui 2>&1 | tail -80
