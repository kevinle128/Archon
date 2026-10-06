#!/bin/bash
# rb14.sh <B> <outageSecs> : real server 3405. Four runs (Claude prompt with auto-send + draft, Claude loop at iteration 2, OMP, Codex),
# each Stopped with one queued item; one survivor tab per shell per run (outage frame logger); kill -9; restart after N s;
# then s8 reads, cold loads (rAF + focus) of recovered nodes, and Abandon of each recovered node with rAF in 4 tabs.
cd "$(dirname "$0")"; B=$1; OUT=${2:-30}
declare -a SPEC=("${B}F vq14-claude long-claude Bash" "${B}LF vq14-loop-steer steer-loop Bash" "${B}R vq14-omp long-omp ." "${B}X vq14-codex long-codex .")
for s in "${SPEC[@]}"; do set -- $s; R=$(./dispatch.sh $2 "$1 run"); echo $R > $1.run; echo "$1 $R"; done
echo "await G.svClose(); return 'ok'" | ./d.sh; echo
for s in "${SPEC[@]}"; do set -- $s; K=$1; N=$3; RX=$4; R=$(cat $K.run)
  if [ "$N" = steer-loop ]; then ./waititer.sh $R 2; else ./waitopen.sh $R "$RX" 1; fi
  AS=false; [ "$N" = long-claude ] && AS=true
  cat <<JS | ./d.sh
await G.open('c','$R','$N'); await G.open('l','$R','$N');
if ($AS) await G.api('/api/workflows/runs/$R/nodes/$N/auto-send', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
await G.queue('c', '$K-Q1 queued before the restart'); await G.wait(1200);
await G.stop('c'); await G.until('c', x => /Send now/.test(x.btns), 30000); await G.until('l', x => /Send now/.test(x.btns), 30000); await G.wait(800);
if ($AS) { await G.panel('c').locator('textarea').first().click(); await G.pages.c.keyboard.type('$K draft typed before restart'); await G.wait(2500); }
await G.svOpen('${K}c','c','$R','$N'); await G.svOpen('${K}l','l','$R','$N');
return '$K ready';
JS
  echo
done
cat <<JS | ./d.sh
await G.pages.c.goto('about:blank'); await G.pages.l.goto('about:blank');
const k = await G.svArm(); G.__shots = G.svShots('$B', $((OUT*1000+50000))); return 'armed ' + k;
JS
echo
sleep 2; SP=$(cat server.pid); kill -9 $SP; python3 -c "import time;print(int(time.time()*1000))" > $B-kill9.time; echo "killed $SP"
sleep $OUT
./start-server.sh real; echo "server-real $(cat server.pid) 3405 (restart $B)" >> pids.txt
for j in $(seq 1 240); do curl -s -o /dev/null localhost:3405/api/health && break; sleep 0.25; done; python3 -c "import time;print(int(time.time()*1000))" > $B-up.time; echo "up $(cat server.pid)"
sleep 40
cat <<JS | ./d.sh
await G.__shots; const o = await G.svCollect(); o.kill = +G.fs.readFileSync(G.S + '/$B-kill9.time', 'utf8'); o.up = +G.fs.readFileSync(G.S + '/$B-up.time', 'utf8');
G.fs.writeFileSync(G.S + '/$B-outage.json', JSON.stringify(o)); return 'saved';
JS
echo
python3 outsum.py $B-outage.json
