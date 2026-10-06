#!/bin/bash
# start-vite.sh <apiPort> <webPort>
cd /Users/dale/orca/workspaces/Archon/develop-2/packages/web
nohup env PORT=$1 VITE_API_PORT=$1 npx vite --port $2 --strictPort >> /private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/c3af2ea9-daf2-4dac-a244-7679f5cdbb02/scratchpad/vq16-1790791870/vite-$2.log 2>&1 < /dev/null &
echo "vite$2 $! $(date +%H:%M:%S)" >> /private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/c3af2ea9-daf2-4dac-a244-7679f5cdbb02/scratchpad/vq16-1790791870/pids.txt
