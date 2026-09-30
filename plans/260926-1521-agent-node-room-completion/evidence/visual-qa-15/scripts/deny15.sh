#!/bin/bash
# deny15.sh : a Claude Bash call the sleep guard denies; the failed row is open by default in both shells.
cd "$(dirname "$0")"; . ./common.sh
R=$(./dispatch.sh 3425 vq15-deny "deny run"); echo $R > deny.run; echo run $R
waitst $R completed 90; echo "wait done"
drv <<JS
$LOAD
await G.open('c','$R','deny-node'); await G.open('l','$R','deny-node'); await G.wait(1500);
await G.shot('c','deny'); await G.shot('l','deny');
const o = {}; for (const s of ['c','l']) o[s] = await G.room(s).evaluate(e => ({ open: e.querySelectorAll('details[open]').length, x: (e.innerText.match(/✕/g) || []).length, running: (e.innerText.match(/◐/g) || []).length, text: e.innerText.slice(0, 600) }));
G.fs.writeFileSync(G.S + '/deny.json', JSON.stringify({ R: '$R', o }, null, 2) + '\n');
return JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { open: v.open, x: v.x, running: v.running }])));
JS
echo
