#!/bin/bash
# o716.sh : s8 captures. Fake prompt run A (live, 1 queued) and loop run B (Stopped, 1 queued); kill -9 the fake server, restart
# after 8 s; room crops of both runs in both shells once `Recovery required` shows.
cd "$(dirname "$0")"
A=$(./dispatch.sh 3456 vq16-fake "O7 A run"); B=$(./dispatch.sh 3456 vq16-fake-loop "O7 B run"); echo "$A $B" > O7.runs; sleep 3
cat <<JS | ./dr.sh fake
await G.open('c','$A','fake-node'); await G.queue('c','O7-A1 queued before the outage');
await G.open('l','$B','fake-loop'); await G.queue('l','O7-B1 queued before the outage'); await G.wait(800); await G.stop('l'); await G.until('l', x => /Send now/.test(x.btns), 20000);
return 'ok';
JS
echo
PID=$(cat ../fake.pid); kill -9 $PID; echo "o716 killed fake $PID" >> outages.log; sleep 8; ./start-fake.sh; until curl -sf localhost:3456/api/health > /dev/null; do sleep 0.1; done; sleep 3
cat <<JS | ./dr.sh fake
for (const [r, R, N] of [['A','$A','fake-node'],['B','$B','fake-loop']]) for (const s of ['c','l']) { await G.open(s, R, N); await G.until(s, x => /Recovery required/.test(x.pill), 20000); await G.wait(800); await G.shot(s, 'O7' + r + '-s8'); }
for (const R of ['$A','$B']) await G.api('/api/workflows/runs/' + R + '/abandon', { method: 'POST', body: '{}' });
return 'shots';
JS
echo
