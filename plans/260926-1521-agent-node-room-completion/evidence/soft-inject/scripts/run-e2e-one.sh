#!/bin/bash
# run-e2e-one.sh <spec-substring>: run one e2e UI spec on the reserved port base.
cd /Users/dale/orca/Archon/.claude/worktrees/agent-a4b1bef9c53f33b3c/e2e
export ARCHON_E2E_PORT_BASE=3580
timeout 900 bunx playwright test -c playwright.config.ts "ui/$1" 2>&1 | tail -60
