#!/bin/bash
# run-ds-acp.sh <method>: DeepSeek DSH ACP profile, real subscription route.
cd "$(dirname "$0")"
export ACP_CMD='["/Users/dale/.local/bin/node","/Users/dale/orca/Archon/.claude/worktrees/agent-a4b1bef9c53f33b3c/node_modules/.bun/@deepseek-ai+dsh@0.1.2-rc.1+e9d0f46793e1d1cd/node_modules/@deepseek-ai/dsh/lib/bin.js","--profile","acp"]'
export ACP_MODEL='["alibaba","deepseek-v4.1-flash"]'
export ACP_METHOD="${1:-session/prompt}"
timeout 170 node spike-acp.mjs 2>&1 | tail -1
