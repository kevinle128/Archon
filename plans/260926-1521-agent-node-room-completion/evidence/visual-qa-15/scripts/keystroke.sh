#!/bin/bash
# At stop+26 min, type one key into a fresh Legacy tab on I2 and record the draft/keepalive responses.
cd /private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/c3af2ea9-daf2-4dac-a244-7679f5cdbb02/scratchpad/vq15-1790744853
T=$(python3 -c "import datetime;print(int(datetime.datetime(2026,9,30,5,41,26,tzinfo=datetime.timezone.utc).timestamp()))")
while [ $(date +%s) -lt $T ]; do sleep 5; done
for i in $(seq 1 60); do
OUT=$(cat <<'JS' | ./dr.sh real
const p = await G.newShell('k'); const resp = [];
p.on('response', r => { if (/\/(draft|keepalive)(\?|$)/.test(r.url())) resp.push([Date.now(), r.request().method(), r.url().replace(/^.*\/nodes\/[^/]+/, ''), r.status()]); });
await p.goto(G.url('l', 'fbee8b55b013e6ff25d18550f35951e4', 'cl-node')); await p.locator(G.sel('l')).first().waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
await p.locator(G.sel('l')).locator('textarea').first().click(); const t = Date.now(); await p.keyboard.type('k'); await p.waitForTimeout(4000);
await p.close();
return JSON.stringify({ keystroke: t, keystrokeIso: new Date(t).toISOString(), resp });
JS
)
[ "$OUT" != busy ] && break; sleep 2; done
echo "$OUT" > data/I2-keystroke.json; echo "$OUT"
