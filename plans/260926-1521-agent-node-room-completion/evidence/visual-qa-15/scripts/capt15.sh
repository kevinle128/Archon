#!/bin/bash
# capt15.sh <tag> <workflow> <node> : fake-provider captures of s1, s2 (DOM), s3, s4, s5 in both shells, the queue-while-
# pinned gap (VQ4-5) and axe on s3.
cd "$(dirname "$0")"; TAG=$1; WF=$2; N=$3
R=$(./dispatch.sh 3426 $WF "$TAG run"); echo $R > $TAG.run; sleep 3
cat <<JS | ./dr.sh fake
await G.open('c','$R','$N'); await G.open('l','$R','$N');
const gap = async s => G.room(s).evaluate(e => { const sc = e.querySelector('[data-testid$="-scroll"]'); return sc ? Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) : null; });
const h = async s => G.room(s).evaluate(e => { const sc = e.querySelector('[data-testid$="-scroll"]'); return sc ? sc.clientHeight : null; });
const g0 = { c: await gap('c'), l: await gap('l'), hc: await h('c'), hl: await h('l') };
await G.queue('c','$TAG-Q1 first queued guidance'); await G.wait(600); await G.queue('l','$TAG-Q2 second queued guidance'); await G.wait(2500);
const g1 = { c: await gap('c'), l: await gap('l'), hc: await h('c'), hl: await h('l') };
await G.shot('c','$TAG-s1'); await G.shot('l','$TAG-s1');
await G.tStart('c', 3000);
const st = await G.stop('c');
await G.until('c', x => /Send now/.test(x.btns), 20000); await G.until('l', x => /Send now/.test(x.btns), 20000);
const s2 = (await G.tGet('c')).map(x => [x[0] - st.clicked, x[1].split('|')[2]]).filter(x => /Stopping/.test(x[1]))[0] || null;
await G.wait(1500);
await G.shot('c','$TAG-s3'); await G.shot('l','$TAG-s3');
const ax = {};
for (const s of ['c','l']) { await G.pages[s].addScriptTag({ path: '/Users/dale/Desktop/workspace/OceanLabs/video-sentences/node_modules/.bun/axe-core@4.13.0/node_modules/axe-core/axe.min.js' }); ax[s] = await G.pages[s].evaluate(async sel => { const r = await axe.run(document.querySelector(sel)); return r.violations.map(v => ({ id: v.id, n: v.nodes.length, ex: v.nodes.slice(0, 3).map(n => n.failureSummary.slice(0, 160)) })); }, G.sel(s)); }
await G.send('l', '$TAG typed redirect <<E2E_SCENARIO>>{"emitTool":true,"interruptible":true,"delayMs":30000}<</E2E_SCENARIO>>'); await G.wait(3500);
await G.shot('c','$TAG-s4'); await G.shot('l','$TAG-s4');
await G.queue('c','$TAG-Q3 queued before abandon'); await G.wait(2000);
await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); await G.wait(4000);
await G.shot('c','$TAG-s5'); await G.shot('l','$TAG-s5');
const k5 = { c: await G.key('c'), l: await G.key('l') };
G.fs.writeFileSync(G.S + '/capt-$TAG.json', JSON.stringify({ R: '$R', gapBeforeQueue: g0, gapAfterQueue: g1, stoppingFrameMs: s2, axe: ax, k5 }, null, 2) + '\n');
return JSON.stringify({ g0, g1, s2, axe: Object.fromEntries(Object.entries(ax).map(([k, v]) => [k, v.map(x => x.id + ':' + x.n)])), k5 });
JS
echo
