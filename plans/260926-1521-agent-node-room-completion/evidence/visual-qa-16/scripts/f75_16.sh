#!/bin/bash
# f75_16.sh <tag> <workflow> <node> : Story 7.5. Auto-send on; queue a bad item (unclosed <<E2E_USAGE>>) and a good one while the
# first turn runs; the natural reply triggers the automatic dispatch, which fails; then a blank Send now fails again; park 12 s;
# withdraw the bad item; typed Send now completes the node.
cd "$(dirname "$0")"; TAG=$1; WF=$2; N=$3
R=$(./dispatch.sh 3456 $WF "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh fake2
await G.open('c','$R','$N'); await G.open('l','$R','$N');
const au = await G.api('/api/workflows/runs/$R/nodes/$N/auto-send', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
await G.queue('c', '$TAG-Q1 bad <<E2E_USAGE>>{"input":1'); await G.wait(500); await G.queue('l', '$TAG-Q2 good item');
const q0 = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
await G.until('c', x => /automatic dispatch failed/.test(x.al), 60000); await G.wait(1500);
const q1 = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const k1 = { c: await G.key('c'), l: await G.key('l') };
await G.shot('c', '$TAG-autofail'); await G.shot('l', '$TAG-autofail');
const alerts1 = { c: await G.room('c').locator('[role=alert]').count(), l: await G.room('l').locator('[role=alert]').count() };
const sn = await G.send('l', null); await G.until('l', x => /Send now failed/.test(x.al), 20000); await G.wait(1500);
const q2 = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const k2 = { c: await G.key('c'), l: await G.key('l') };
const alerts2 = { c: await G.room('c').locator('[role=alert]').count(), l: await G.room('l').locator('[role=alert]').count() };
await G.shot('c', '$TAG-sendnowfail'); await G.shot('l', '$TAG-sendnowfail');
await G.wait(12000);
const q3 = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const qs = q => q.queued.map(x => ({ m: x.message.slice(0, 14), state: x.state, fails: x.dispatch_failure_count, kind: x.last_failure_kind, err: (x.last_failure_message || x.last_error || '').slice(0, 60) }));
G.fs.writeFileSync(G.S + '/f75-$TAG.json', JSON.stringify({ R: '$R', autoSend: au, q0: qs(q0), q1: qs(q1), sub1: q1.sub_state, k1, alerts1, sendNow: sn, q2: qs(q2), k2, alerts2, q3parked: qs(q3), sub3: q3.sub_state }, null, 2) + '\n');
return JSON.stringify({ q1: qs(q1), sub1: q1.sub_state, k1, alerts1, q2: qs(q2), k2, alerts2, q3: qs(q3) });
JS
echo
cat <<JS | ./dr.sh fake2
const del = G.pages.c.waitForResponse(r => r.request().method() === 'DELETE', { timeout: 10000 });
await G.room('c').locator('button[aria-label^="delete · $TAG-Q1"]').first().click(); const d = await del;
await G.wait(1500);
const s = await G.send('c', '$TAG typed recovery <<E2E_SCENARIO>>{"delayMs":500}<</E2E_SCENARIO>>');
await G.wait(5000);
const q = await G.api('/api/workflows/runs/$R/nodes/$N/queue'); const r = await G.api('/api/workflows/runs/$R');
const k = { c: await G.key('c'), l: await G.key('l') };
const out = JSON.parse(G.fs.readFileSync(G.S + '/f75-$TAG.json', 'utf8'));
Object.assign(out, { withdraw: d.status(), send: s, qEnd: q.queued.map(x => [x.message.slice(0, 14), x.state]), runStatus: r.run.status, kEnd: k });
G.fs.writeFileSync(G.S + '/f75-$TAG.json', JSON.stringify(out, null, 2) + '\n');
return JSON.stringify({ withdraw: d.status(), qEnd: out.qEnd, runStatus: out.runStatus, kEnd: k });
JS
echo
