#!/bin/bash
cd "$(dirname "$0")"
export ACP_CMD='["/Users/dale/.grok/bin/grok","agent","--always-approve","--no-leader","-m","grok-4.7-build-fast","--reasoning-effort","low","stdio"]'
export ACP_METHOD='_x.ai/interject'
export ACP_PARAMS_KEY=text
timeout 170 node spike-acp.mjs 2>&1 | tail -1
