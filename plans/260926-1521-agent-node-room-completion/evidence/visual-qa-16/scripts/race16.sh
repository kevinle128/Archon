#!/bin/bash
# race16.sh <tag> <delayMs> : concurrent blank Send now (Console) and withdraw of the only queued item (Legacy), the withdraw
# click fired <delayMs> after the Send now click, i.e. before the Send now POST resolves. rAF keys in both shells for 6 s.
cd "$(dirname "$0")"; TAG=$1; DL=$2
R=$(./dispatch.sh 3456 vq16-fake "$TAG run"); echo $R > $TAG.run; sleep 3
cat <<JS | ./dr.sh fake
await G.open('c','$R','fake-node'); await G.open('l','$R','fake-node');
G.needle.c = G.needle.l = '$TAG-Q1';
await G.queue('l', '$TAG-Q1 queued item'); await G.wait(1200);
await G.stop('l'); await G.until('c', x => /Send now/.test(x.btns), 20000); await G.until('l', x => /delete/.test('delete') && x.del > 0, 20000); await G.wait(800);
await G.tStart('c', 7000); await G.tStart('l', 7000);
const del = G.pages.l.waitForResponse(r => r.request().method() === 'DELETE', { timeout: 5000 }).catch(() => null);
let sp, tc0;
if ($DL >= 0) { sp = G.send('c', null); await G.wait($DL); tc0 = Date.now(); await G.room('l').locator('button[aria-label^="delete ·"]').first().click({ timeout: 500 }).catch(() => {}); }
else { tc0 = Date.now(); G.room('l').locator('button[aria-label^="delete ·"]').first().click({ timeout: 500 }).catch(() => {}); await G.wait(-($DL)); sp = G.send('c', null); }
const s = await sp; const d = await del;
await G.wait(6000);
const T = s.clicked; const rel = a => a.map(x => [x[0] - T, x[1]]);
const tc = rel(await G.tGet('c')), tl = rel(await G.tGet('l'));
const q = await G.api('/api/workflows/runs/$R/nodes/fake-node/queue');
const out = { R: '$R', delay: $DL, send: s, delClick: tc0 - T, del: d ? { http: d.status(), body: await d.text() } : null, q: { sub: q.sub_state, items: q.queued.map(x => [x.message.slice(0, 14), x.state]) }, tc, tl };
G.fs.writeFileSync(G.S + '/race-$TAG.json', JSON.stringify(out) + '\n');
return JSON.stringify({ send: [s.st, s.sendResolved - s.clicked], delClick: out.delClick, del: out.del, q: out.q, tc: tc.map(x => [x[0], x[1].split('|').slice(0, 7).join('|')]), tl: tl.map(x => [x[0], x[1].split('|').slice(0, 7).join('|')]) }, null, 1);
JS
echo
