#!/bin/bash
# out14.sh <tag> <outageSecs> : fake server 3406. Two runs (prompt A live with 1 queued item; loop B Stopped with 1 queued item),
# one survivor tab per shell per run, per-frame + per-request logs; kill -9 the fake server by its PID; during a >=20 s outage load
# each run fresh in both shells (first load that never succeeds); restart; observe 40 s; collect.
cd "$(dirname "$0")"; TAG=$1; OUT=$2; H='X-Archon-User: vq14-operator'
A=$(./dispatchf.sh vq14-fake "$TAG A run"); echo $A > ${TAG}A.run
B=$(./dispatchf.sh vq14-fake-loop "$TAG B run"); echo $B > ${TAG}B.run
./waitopenf.sh $A . 1; ./waitopenf.sh $B . 1
q() { curl -s -X POST localhost:3406/api/workflows/runs/$1/nodes/$2/send -H 'Content-Type: application/json' -H "$H" -d "{\"message\":\"$3\",\"message_id\":\"$(uuidgen | tr A-Z a-z)\",\"intent\":\"queue\"}" >/dev/null; }
q $A fake-node "${TAG}A-Q1 queued before the outage"; q $B fake-loop "${TAG}B-Q1 queued before the outage"
curl -s -X POST localhost:3406/api/workflows/runs/$B/nodes/fake-loop/interrupt -H "$H" >/dev/null
cat <<JS | ./df.sh
await G.svClose();
await G.svOpen('${TAG}Ac','c','$A','fake-node'); await G.svOpen('${TAG}Al','l','$A','fake-node');
await G.svOpen('${TAG}Bc','c','$B','fake-loop'); await G.svOpen('${TAG}Bl','l','$B','fake-loop');
await G.wait(1500); const k = await G.svArm(); G.__shots = G.svShots('$TAG', $((OUT*1000+50000)));
return 'armed ' + k;
JS
echo
sleep 2
SP=$(cat serverf.pid); kill -9 $SP; python3 -c "import time;print(int(time.time()*1000))" > $TAG-kill9.time; echo "killed $SP at $(cat $TAG-kill9.time)"
if [ $OUT -ge 20 ]; then
  echo "G.__dl = Promise.all([G.downLoad('$TAG','c','$A','fake-node', $(( (OUT-4)*1000 ))), G.downLoad('$TAG','l','$A','fake-node', $(( (OUT-4)*1000 )))]); return 'dl started'" | ./df.sh; echo
fi
sleep $OUT
./start-server.sh fake; echo "server-fake $(cat serverf.pid) 3406 (restart $TAG)" >> pids.txt
for j in $(seq 1 120); do curl -s -o /dev/null localhost:3406/api/health && break; sleep 0.25; done; python3 -c "import time;print(int(time.time()*1000))" > $TAG-up.time; echo "up $(cat serverf.pid) at $(cat $TAG-up.time)"
sleep 40
cat <<JS | ./df.sh
await G.__shots; const o = await G.svCollect();
o.kill = +G.fs.readFileSync(G.S + '/$TAG-kill9.time', 'utf8'); o.up = +G.fs.readFileSync(G.S + '/$TAG-up.time', 'utf8');
if (G.__dl) { o.firstLoad = await G.__dl; G.__dl = null; }
G.fs.writeFileSync(G.S + '/$TAG-outage.json', JSON.stringify(o));
return 'saved';
JS
echo
python3 outsum.py $TAG-outage.json
