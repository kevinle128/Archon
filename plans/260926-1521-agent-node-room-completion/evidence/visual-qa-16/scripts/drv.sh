#!/bin/bash
# drv.sh <real|fake> : stop that driver by its recorded PID and start it again.
cd "$(dirname "$0")"; W=$1
if [ "$W" = real ]; then P=7861; WEB=5323; API=3455; CB=9f8371610941f853d93f8fa035e50fa6; elif [ "$W" = real2 ]; then P=7864; WEB=5323; API=3455; CB=9f8371610941f853d93f8fa035e50fa6; elif [ "$W" = fake2 ]; then P=7863; WEB=5324; API=3456; CB=c1212f7f67bcf8844ef279463bf9b9a5; else P=7862; WEB=5324; API=3456; CB=c1212f7f67bcf8844ef279463bf9b9a5; fi
OLD=$(cat drv-$W.pid 2>/dev/null); if [ -n "$OLD" ] && kill -0 $OLD 2>/dev/null; then kill -TERM $OLD; for i in $(seq 1 30); do kill -0 $OLD 2>/dev/null || break; sleep 0.2; done; fi
nohup node driver.mjs $P $WEB $API $CB >> drv-$W.log 2>&1 < /dev/null &
echo $! > drv-$W.pid; echo "drv$W $! $(date +%H:%M:%S)" >> /private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/c3af2ea9-daf2-4dac-a244-7679f5cdbb02/scratchpad/vq16-1790791870/pids.txt
for i in $(seq 1 40); do grep -q "driver ready" <(tail -1 drv-$W.log) && break; sleep 0.25; done; tail -1 drv-$W.log
