#!/bin/bash
# b15.sh : Claude sonnet B run (thinking, advisor, todo, five Bash steps). Two queued items + Stop + typed Send now deliver
# in one continuation turn; then natural completion (s6 clean) captured in both shells.
cd "$(dirname "$0")"; . ./common.sh
R=$(./dispatch.sh 3425 vq15-claude "B run"); echo $R > B.run; echo run $R
drv <<JS
$LOAD
await G.open('c','$R','claude-node'); await G.open('l','$R','claude-node');
await G.toolRunning('c', 170000);
await G.shot('c','B-s1-early'); await G.shot('l','B-s1-early');
return 'tool running';
JS
echo
drv <<JS
$LOAD
await G.queue('c', 'BQ1: reply with the token BQ1ACK.'); await G.wait(600); await G.queue('l', 'BQ2: reply with the token BQ2ACK.'); await G.wait(1500);
await G.shot('c','B-s1'); await G.shot('l','B-s1');
const st = await G.stopTimed('l'); await G.until('c', x => /Send now/.test(x.btns), 30000); await G.wait(1500);
await G.shot('c','B-s3'); await G.shot('l','B-s3');
const s = await G.send('c', 'BTYPED: reply with the token BTYPEDACK, then continue with the remaining steps.');
await G.wait(6000); await G.shot('c','B-s4'); await G.shot('l','B-s4');
return JSON.stringify({ st, s });
JS
echo
waitst $R completed 150 || waitst $R completed 150; echo "done wait"
drv <<JS
$LOAD
await G.open('c','$R','claude-node'); await G.open('l','$R','claude-node'); await G.wait(2000);
await G.shot('c','B-s6'); await G.shot('l','B-s6');
const t = { c: await G.roomText('c'), l: await G.roomText('l') };
const msgs = (await G.api('/api/workflows/runs/$R/nodes/claude-node/messages')).messages;
const texts = msgs.filter(m => m.kind === 'text').map(m => [m.seq, (m.metadata || {}).origin || (m.metadata || {}).text_mode || '', String(m.payload.text).slice(0, 80)]);
const pick = x => ({ advisor: (x.match(/ADVISOR · [A-Z]+/) || [null])[0], prompt: (x.match(/PROMPT · [A-Z0-9-]+/) || [null])[0], todo: (x.match(/TODO[^\n]*\n[^\n]*\n[^\n]*/) || [null])[0], acks: (x.match(/B(Q1|Q2|TYPED)ACK/g) || []), operatorRows: (x.match(/^OPERATOR/gm) || []).length, dock: /Send now|Queue|Stop/.test(x.slice(-300)) });
const r = await G.api('/api/workflows/runs/$R');
G.fs.writeFileSync(G.S + '/B.json', JSON.stringify({ R: '$R', status: r.run.status, c: pick(t.c), l: pick(t.l), texts }, null, 2) + '\n');
return JSON.stringify({ status: r.run.status, c: pick(t.c), l: pick(t.l) });
JS
echo
