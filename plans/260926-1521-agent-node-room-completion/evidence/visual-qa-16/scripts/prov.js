// Real-provider matrix helpers (real driver). Loaded once per driver process.
const cp = await import('node:child_process');
G.serverPid = () => +G.fs.readFileSync(G.S + '/../../real.pid', 'utf8').trim();
G.reap = (tag, secs) => {
  const out = `${G.S}/${tag}-reap.json`;
  const ch = cp.spawn('python3', [G.S + '/../reap.py', String(G.serverPid()), String(secs), out], {
    stdio: 'ignore',
  });
  return new Promise(res => ch.on('exit', () => res(out)));
};
G.roomText = s => G.room(s).evaluate(e => e.innerText);
G.toolRunning = async (s, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await G.roomText(s);
    const k = G.parse(await G.key(s));
    if (/Stop/.test(k.btns) && /◐/.test(t)) return Date.now() - t0;
    await G.wait(300);
  }
  throw new Error('no running tool in ' + s + ': ' + (await G.key(s)));
};
// Stop from `s`, then measure when the stopping shell first shows `Send now`.
G.stopTimed = async s => {
  const w = G.postWait(s, /\/interrupt(\?|$)/);
  const clicked = Date.now();
  await G.room(s)
    .locator('button', { hasText: /^Stop$/ })
    .first()
    .click();
  const r = await w;
  const resolved = Date.now();
  const seen = await G.until(s, x => /Send now/.test(x.btns), 30000).then(() => Date.now());
  return { clicked, post: resolved - clicked, sendNowSeen: seen - clicked, http: r.status() };
};
// Blank / typed Send now from `s`; once its POST has resolved, the other shell races a withdraw click after `probeMs`
// (the round-14 probe: the observer may still offer `delete ·` for a few ms after the send resolved).
G.sendWithProbe = async (s, text, probeMs) => {
  const o = s === 'c' ? 'l' : 'c';
  const del = G.pages[o]
    .waitForResponse(r => r.request().method() === 'DELETE' && /\/queue\//.test(r.url()), {
      timeout: 4000,
    })
    .catch(() => null);
  const snd = await G.send(s, text);
  await G.wait(probeMs);
  const btn = G.room(o).locator('button[aria-label^="delete ·"]').first();
  const offered = await btn.count();
  let clicked = null;
  if (offered) {
    try {
      await btn.click({ timeout: 300 });
      clicked = Date.now();
    } catch (e) {}
  }
  const dr = clicked ? await del : null;
  let body = null;
  if (dr) body = await dr.text().catch(() => null);
  return {
    send: snd,
    probeMs,
    offeredAtProbe: offered,
    probeClickedAfterResolve: clicked ? clicked - snd.sendResolved : null,
    del: dr ? { http: dr.status(), body } : null,
  };
};
G.rows = async s =>
  G.room(s).evaluate(e => {
    const t = e.innerText;
    return {
      assistant: (t.match(/^ASSISTANT/gm) || []).length,
      thinking: (t.match(/^THINKING/gm) || []).length,
      operator: (t.match(/^OPERATOR/gm) || []).length,
    };
  });
return 'prov ok';
