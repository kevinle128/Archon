#!/bin/bash
# rl15.sh <tag> : with a Legacy run page open (its __dashboard__ subscriber live), dispatch 6 short runs that complete and
# 4 long runs that are Abandoned; the persistent Console runs page must show each status change without reload.
cd "$(dirname "$0")"; TAG=$1
L=$(./dispatch.sh 3426 vq15-fake "$TAG legacy-open run"); sleep 3
cat <<JS | ./dr.sh fake
await G.open('l','$L','fake-node');
const p = G.comp.runs;
await p.evaluate(() => {
  window.__cnt = []; const t0 = Date.now();
  const iv = setInterval(() => { const m = document.body.innerText.match(/RUNNING\n(\d+)\nPAUSED\n(\d+)\nFAILED\n(\d+)\nCOMPLETED\n(\d+)\nALL\n(\d+)/); const k = m ? m.slice(1).join(',') : 'none'; const L = window.__cnt; if (!L.length || L[L.length-1][1] !== k) L.push([Date.now(), k]); if (Date.now() - t0 > 170000) clearInterval(iv); }, 40);
});
G.rlT0 = Date.now();
return JSON.stringify({ start: (await p.evaluate(() => window.__cnt))[0] });
JS
echo
S=""; for i in 1 2 3 4 5 6; do S="$S $(./dispatch.sh 3426 vq15-fake-short "$TAG short $i")"; sleep 1.5; done
A=""; for i in 1 2 3 4; do A="$A $(./dispatch.sh 3426 vq15-fake "$TAG abandon $i")"; sleep 1; done
echo "short:$S abandon:$A" | tee $TAG.rl
sleep 5; for r in $A; do curl -s -X POST localhost:3426/api/workflows/runs/$r/abandon -H 'Content-Type: application/json' -H 'X-Archon-User: vq15-operator' -d '{}' > /dev/null; sleep 0.7; done
sleep 18
cat <<JS | ./dr.sh fake
const p = G.comp.runs;
const cnt = (await p.evaluate(() => window.__cnt)).map(x => [x[0] - G.rlT0, x[1]]);
const msg = (await G.esMsgGet(p)).filter(m => m[0] >= G.rlT0);
const msgL = (await G.esMsgGet(G.pages.l)).filter(m => m[0] >= G.rlT0);
const ids = '$S $A'.trim().split(/\s+/);
const per = {};
for (const id of ids) {
  const r = await G.api('/api/workflows/runs/' + id);
  const st = m => [...new Set(m.filter(x => x[1] === 'workflow_status' && x[2] === id).map(x => x[3]))];
  const firstTerm = m => { const x = m.find(x => x[1] === 'workflow_status' && x[2] === id && /completed|cancelled|failed/.test(x[3])); return x ? x[0] - G.rlT0 : null; };
  per[id.slice(0,8)] = { api: r.run.status, completedAt: r.run.completed_at, runsPage: st(msg), runsPageTerm: firstTerm(msg), legacyRunPage: st(msgL) };
}
const es = (await G.esGet(p)).filter(e => e[0] >= G.rlT0 && e[2] === '__dashboard__');
const esL = (await G.esGet(G.pages.l)).filter(e => e[0] >= G.rlT0 && e[2] === '__dashboard__');
const out = { tag: '$TAG', legacyOpenRun: '$L', per, counts: cnt, runsPageStreamEvents: es, legacyStreamEvents: esL };
G.fs.writeFileSync(G.S + '/rl-$TAG.json', JSON.stringify(out, null, 2) + '\n');
return JSON.stringify({ per, countsFirst: cnt[0], countsLast: cnt[cnt.length-1], nCountChanges: cnt.length, es: es.map(e => e[1]), esL: esL.map(e => e[1]) }, null, 1);
JS
