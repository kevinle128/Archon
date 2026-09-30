#!/bin/bash
# drv.sh restart <real|fake> : stop that driver by its recorded PID and start it again.
cd "$(dirname "$0")"; W=$1
if [ "$W" = real ]; then P=7851; WEB=5293; API=3425; CB=06eed2c537f42ba8e0f0de5dade247e9; else P=7852; WEB=5294; API=3426; CB=8f897279034a91f8d2c53663174b5d16; fi
OLD=$(cat drv-$W.pid 2>/dev/null); if [ -n "$OLD" ] && kill -0 $OLD 2>/dev/null; then kill -TERM $OLD; for i in $(seq 1 30); do kill -0 $OLD 2>/dev/null || break; sleep 0.2; done; fi
nohup node driver.mjs $P $WEB $API $CB >> drv-$W.log 2>&1 < /dev/null &
echo $! > drv-$W.pid; echo "drv$W $! $(date +%H:%M:%S)" >> pids.txt
for i in $(seq 1 40); do grep -q "driver ready" <(tail -1 drv-$W.log) && break; sleep 0.25; done; tail -1 drv-$W.log
