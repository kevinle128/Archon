#!/bin/bash
# cap15.sh : fake loop that reaches its 10-iteration cap; selector options and header in both shells.
cd "$(dirname "$0")"
R=$(./dispatch.sh 3426 vq15-fake-cap "cap run"); echo $R > cap.run
for i in $(seq 1 90); do s=$(curl -s localhost:3426/api/workflows/runs/$R -H 'X-Archon-User: vq15-operator' | python3 -c "import json,sys; print(json.load(sys.stdin)['run']['status'])"); [ "$s" != running ] && break; sleep 1; done; echo "status $s"
cat <<JS | ./dr.sh fake
await G.open('c','$R','cap-loop'); await G.open('l','$R','cap-loop'); await G.wait(1500);
const o = {};
for (const s of ['c','l']) o[s] = await G.room(s).evaluate(e => ({ head: e.innerText.slice(0, 200), options: [...e.querySelectorAll('option,[role=option]')].map(x => x.textContent.trim()), selects: [...e.querySelectorAll('select')].map(x => x.getAttribute('aria-label')) }));
await G.shot('c','cap'); await G.shot('l','cap');
G.fs.writeFileSync(G.S + '/cap.json', JSON.stringify({ R: '$R', o }, null, 2) + '\n');
return JSON.stringify(o);
JS
echo
