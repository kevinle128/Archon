#!/bin/bash
# run-e2e-repeat.sh <spec> <grep> <n>: repeat one e2e test n times on the reserved port base.
cd /Users/dale/orca/Archon/.claude/worktrees/agent-a4b1bef9c53f33b3c/e2e
export ARCHON_E2E_PORT_BASE=3580
timeout 900 bunx playwright test -c playwright.config.ts "ui/$1" --grep "$2" --repeat-each "$3" 2>&1 | tail -25
