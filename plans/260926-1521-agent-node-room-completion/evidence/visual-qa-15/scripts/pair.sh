#!/bin/bash
# pair.sh <tag> <companion: legacy-run|console-runs|legacy-dash> <holdMs> : Legacy run tab + one companion
# __dashboard__ subscriber, both EventSource-logged; count errors/closes after both are open.
cd "$(dirname "$0")"; TAG=$1; CP=$2; HOLD=${3:-65000}
R=$(./dispatch.sh 3426 vq15-fake "$TAG pairing run"); sleep 3
( sleep 12; ./dispatch.sh 3426 vq15-fake-short "$TAG side run" > $TAG.side ) &
cat <<JS | ./dr.sh fake
await G.open('l','$R','fake-node');
const x = await G.newShell('x');
const url = { 'legacy-run': G.url('l','$R','fake-node'), 'console-runs': '/console', 'legacy-dash': '/legacy/dashboard' }['$CP'];
await x.goto(url); await G.wait(2500);
const t0 = Date.now();
await G.wait($HOLD);
const t1 = Date.now();
const esL = await G.esGet(G.pages.l), esX = await G.esGet(x);
const msgX = await G.esMsgGet(x), msgL = await G.esMsgGet(G.pages.l);
await x.close();
const dash = a => a.filter(e => e[2] === '__dashboard__');
const win = a => dash(a).filter(e => e[0] >= t0 && e[0] <= t1);
const cnt = (a, k) => win(a).filter(e => e[1] === k).length;
const open = a => { const d = dash(a); let st = null; for (const e of d) { if (e[0] > t0) break; if (e[1]==='open') st='open'; if (e[1]==='error'||e[1]==='close') st=e[1]; } return st; };
const res = { tag: '$TAG', R: '$R', companion: '$CP', url, holdMs: t1 - t0,
  legacyRun: { stateAtStart: open(esL), errors: cnt(esL,'error'), closes: cnt(esL,'close'), opens: cnt(esL,'open') },
  companionStream: { stateAtStart: open(esX), errors: cnt(esX,'error'), closes: cnt(esX,'close'), opens: cnt(esX,'open'), dashMsgs: (msgX||[]).filter(m => m[0] >= t0).length }, legacyRunDashMsgs: (msgL||[]).filter(m => m[0] >= t0).length,
  sideStatus: { x: (msgX||[]).filter(m => m[0] >= t0 && m[1]==='workflow_status').map(m => [m[0]-t0, m[2].slice(0,8), m[3]]), l: (msgL||[]).filter(m => m[0] >= t0 && m[1]==='workflow_status').map(m => [m[0]-t0, m[2].slice(0,8), m[3]]) },
  hosts: [...new Set(esX.filter(e=>e[1]==='new').map(e=>e[2]+'@'+e[3]))],
  esL: dash(esL).map(e => [e[0]-t0, e[1]]), esX: dash(esX).map(e => [e[0]-t0, e[1]]) };
G.fs.writeFileSync(G.S + '/pair-$TAG.json', JSON.stringify(res, null, 2) + '\n');
return JSON.stringify({ tag: res.tag, companion: res.companion, holdMs: res.holdMs, legacyRun: res.legacyRun, companionStream: res.companionStream, legacyRunDashMsgs: res.legacyRunDashMsgs, sideFirst: Object.fromEntries(['x','l'].map(k => [k, [...new Map(res.sideStatus[k].map(m => [m[1]+m[2], m])).values()]])), hosts: res.hosts });
JS
echo
