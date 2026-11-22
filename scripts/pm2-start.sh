#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# PM2 injects NODE_APP_INSTANCE into managed processes. A manual invocation
# must not deploy: the Mac mini install is the GUI launch agent.
if [ -z "${NODE_APP_INSTANCE:-}" ]; then
  echo "Archon on the Mac mini is launch agent com.archon.server." >&2
  echo "Restart it with: launchctl kickstart -k gui/\$(id -u)/com.archon.server" >&2
  exit 1
fi

BUN_BIN="${ARCHON_BUN_BIN:-}"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun || true)"
fi
if [ -z "$BUN_BIN" ]; then
  for candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then
      BUN_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$BUN_BIN" ]; then
  echo "bun not found. Install Bun or set ARCHON_BUN_BIN=/absolute/path/to/bun." >&2
  exit 127
fi
export ARCHON_BUN_BIN="$BUN_BIN"
export PATH="$(dirname "$BUN_BIN"):$PATH"

exec "$BUN_BIN" run start
