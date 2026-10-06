#!/bin/bash
# retry15.sh : edit node + flaky loop that fails once (max_iterations 1); Failed with reason in both shells; Resume; Completed;
# Files changed panel and the `Iteration 1 · Run 2` preselection.
cd "$(dirname "$0")"; . ./common.sh
R=$(./dispatch.sh 3425 vq15-retry "retry run"); echo $R > retry.run; echo run $R
waitst $R failed 120; echo "failed wait"
drv <<JS
$LOAD
await G.open('c','$R','flaky-loop'); await G.open('l','$R','flaky-loop'); await G.wait(1500);
await G.shot('c','retry-failed'); await G.shot('l','retry-failed');
const h = { c: (await G.roomText('c')).slice(0, 300), l: (await G.roomText('l')).slice(0, 300) };
const res = await G.api('/api/workflows/runs/$R/resume', { method: 'POST', body: '{}' });
return JSON.stringify({ h, res });
JS
echo
waitst $R completed 120; echo "completed wait"
drv <<JS
$LOAD
await G.open('c','$R','flaky-loop'); await G.open('l','$R','flaky-loop'); await G.wait(2500);
await G.shot('c','retry-completed'); await G.shot('l','retry-completed');
const h = { c: (await G.roomText('c')).slice(0, 260), l: (await G.roomText('l')).slice(0, 260) };
const fc = await G.api('/api/workflows/runs/$R/files-changed').catch(() => null);
const r = await G.api('/api/workflows/runs/$R');
G.fs.writeFileSync(G.S + '/retry.json', JSON.stringify({ R: '$R', status: r.run.status, h, fc }, null, 2) + '\n');
return JSON.stringify({ status: r.run.status, h, fc: fc && fc.__status });
JS
echo
