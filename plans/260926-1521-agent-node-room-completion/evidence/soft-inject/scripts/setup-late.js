// Installs G.late(...): queue one item, wait until the only tool call has finished, then click its Send now
// while the model writes its final message (the window between the last tool result and `result`).
G.late = async ({ R, s, tag, node = 'cl-node', maxMs = 120000 }) => {
  const o = s === 'c' ? 'l' : 'c';
  const tagTwo = `${tag} LATE`;
  const out = { tag, sender: s, R, node };
  await G.open(s, R, node);
  await G.open(o, R, node);
  await G.until(s, x => x.btns.includes('Stop'), 90000);
  for (const p of [s, o]) {
    await G.pages[p].evaluate(G.siSample, [
      G.sel(p, node),
      'zzz',
      tagTwo,
      maxMs,
      '__si',
      G.siKeySrc,
    ]);
  }
  await G.queue(s, `${tagTwo}: begin your reply with the word LATEOK`);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const done = await G.room(s).evaluate(e => /succeeded|✓/.test(e.innerText));
    if (done) break;
    await G.wait(40);
  }
  const w = G.postWait(s, /\/send(\?|$)/);
  const clicked = Date.now();
  await G.room(s).locator(`button[aria-label^="Send now · ${tagTwo}"]`).first().click();
  const resp = await w;
  out.click = { status: resp.status(), afterToolMs: clicked - t0 };
  const t1 = Date.now();
  let status = '';
  while (Date.now() - t1 < maxMs) {
    const r = await G.api(`/api/workflows/runs/${R}`);
    status = r.run && r.run.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
    await G.wait(1500);
  }
  out.status = status;
  await G.wait(2500);
  out.clickedAt = clicked;
  out.frames = {};
  for (const p of [s, o]) out.frames[p] = await G.pages[p].evaluate(() => window.__si || []);
  const q = await G.api(`/api/workflows/runs/${R}/nodes/${node}/queue`);
  out.queue = (q.queued || []).map(e => [
    e.message.slice(0, 14),
    e.state,
    e.last_error,
    e.dispatch_failure_count,
  ]);
  const m = await G.api(`/api/workflows/runs/${R}/nodes/${node}/messages?limit=500`);
  const rows = m.messages || m.items || [];
  out.operatorRows = rows
    .filter(r => r.metadata && r.metadata.origin === 'operator')
    .map(r => [r.seq, ((r.payload && r.payload.text) || '').slice(0, 20)]);
  out.lastToolSeq = Math.max(0, ...rows.filter(r => r.kind === 'tool').map(r => r.seq));
  out.attempts = [
    ...new Set(
      rows.map(r => r.metadata && r.metadata.execution && r.metadata.execution.attempt_id)
    ),
  ].length;
  return out;
};
return 'late installed';
