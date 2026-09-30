// Installs G.cycle(...) on the driver: one soft-inject cycle against a live Claude run.
// Sender shell `s` queues two items and clicks the per-item Send now on item TWO;
// the other shell `o` observes the same node. Both are sampled on every animation frame.
G.siKey = ([sel, tagOne, tagTwo]) => {
  const e = document.querySelector(sel);
  if (!e || !e.querySelector('[role="region"][aria-label$=" room"]')) return 'NOROOM';
  const it = e.innerText;
  const pill = (it
    .slice(0, 260)
    .match(/\b(Running|Completed|Failed|Recovery required|Cancelled|Paused|Pending)\b/) || [
    '?',
  ])[0];
  const bs = [...e.querySelectorAll('button')];
  const btns = bs
    .map(b => (b.innerText || '').trim())
    .filter(x => /^(Stop|Stopping…|Queue)$/.test(x))
    .join(',');
  const sn = bs.filter(b => /^Send now ·/.test(b.getAttribute('aria-label') || '')).length;
  const del = bs.filter(b => /^delete ·/.test(b.getAttribute('aria-label') || '')).length;
  const bandEl = [...e.querySelectorAll('section[aria-label]')].find(x =>
    /^(Queued|Sending|Will send)/i.test(x.getAttribute('aria-label') || '')
  );
  const header = (it.match(/^(QUEUED|SENDING|WILL SEND) · \d+/m) || [''])[0];
  const tag = t => (t.includes(tagTwo) ? 'TWO' : t.includes(tagOne) ? 'ONE' : '?');
  const band = bandEl
    ? [...bandEl.querySelectorAll('li[data-message-id]')]
        .map(li => tag(li.textContent || '') + (/sending…/.test(li.textContent || '') ? '*' : ''))
        .join(',')
    : '';
  const rows = [...e.querySelectorAll('[data-operator-row]')]
    .map(r => {
      const t = r.textContent || '';
      const badge = ((r.querySelector('[data-operator-delivery]') || {}).textContent || '').trim();
      return tag(t) + ':' + (badge || 'none');
    })
    .join(',');
  const never = /NEVER SENT/.test(it) ? 'NEVER' : '';
  const intr = /[Ii]nterrupted/.test(it) ? 'INTR' : '';
  const alert = e.querySelector('[role="alert"]') ? 'ALERT' : '';
  return [pill, btns, sn, del, header, band, rows, never, intr, alert].join('|');
};
G.siSample = ([sel, tagOne, tagTwo, ms, name, keySrc]) => {
  const keyFn = eval(keySrc);
  const L = [];
  window[name] = L;
  const t0 = Date.now();
  const tick = () => {
    let k;
    try {
      k = keyFn([sel, tagOne, tagTwo]);
    } catch (err) {
      k = 'ERR ' + err.message;
    }
    if (!L.length || L[L.length - 1][1] !== k) L.push([Date.now(), k]);
    if (Date.now() - t0 < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
G.siKeySrc = '(' + G.siKey.toString() + ')';

G.cycle = async ({ R, s, tag, node = 'cl-node', maxMs = 150000, shots = false }) => {
  const o = s === 'c' ? 'l' : 'c';
  const tagOne = `${tag} ONE`;
  const tagTwo = `${tag} TWO`;
  const out = { tag, sender: s, observer: o, R, node };
  await G.open(s, R, node);
  await G.open(o, R, node);
  await G.until(s, x => x.btns.includes('Stop'), 90000);
  // Let the first tool call start so the turn is mid-generation.
  await G.wait(2500);
  for (const p of [s, o]) {
    await G.pages[p].evaluate(G.siSample, [
      G.sel(p, node),
      tagOne,
      tagTwo,
      maxMs,
      '__si',
      G.siKeySrc,
    ]);
  }
  await G.queue(s, `${tagOne} keep this queued`);
  await G.queue(s, `${tagTwo}: end your final line with the exact token ACK_${tag}`);
  await G.wait(1200);
  if (shots) out.shotBefore = await G.shot(s, `${tag}-before`);
  const w = G.postWait(s, /\/send(\?|$)/);
  const clicked = Date.now();
  await G.room(s).locator(`button[aria-label^="Send now · ${tagTwo}"]`).first().click();
  const resp = await w;
  out.click = { status: resp.status(), resolvedMs: Date.now() - clicked };
  if (shots) {
    await G.wait(1500);
    out.shotSent = await G.shot(s, `${tag}-sent`);
  }
  // Wait for the run to finish naturally.
  const t0 = Date.now();
  let status = '';
  while (Date.now() - t0 < maxMs) {
    const r = await G.api(`/api/workflows/runs/${R}`);
    status = r.run && r.run.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
    await G.wait(1500);
  }
  out.status = status;
  await G.wait(2500);
  out.frames = {};
  for (const p of [s, o]) out.frames[p] = await G.pages[p].evaluate(() => window.__si || []);
  if (shots) out.shotEnd = await G.shot(s, `${tag}-end`);
  out.clickedAt = clicked;
  out.roomWidth = { [s]: await G.width(s), [o]: await G.width(o) };
  // Server truth.
  const q = await G.api(`/api/workflows/runs/${R}/nodes/${node}/queue`);
  out.queue = (q.queued || []).map(e => [e.message.slice(0, 12), e.state]);
  const m = await G.api(`/api/workflows/runs/${R}/nodes/${node}/messages?limit=500`);
  const rows = m.messages || m.items || [];
  out.rowCount = rows.length;
  out.attempts = [
    ...new Set(
      rows.map(r => r.metadata && r.metadata.execution && r.metadata.execution.attempt_id)
    ),
  ];
  out.promptRows = rows.filter(r => r.metadata && r.metadata.origin === 'prompt').length;
  out.operatorRows = rows
    .filter(r => r.metadata && r.metadata.origin === 'operator')
    .map(r => [r.seq, ((r.payload && r.payload.text) || '').slice(0, 14)]);
  const ackRows = rows.filter(
    r =>
      r.kind === 'text' &&
      !(r.metadata && ['operator', 'prompt'].includes(r.metadata.origin)) &&
      JSON.stringify(r.payload).includes('ACK_' + tag)
  );
  out.ackInAgentText = ackRows.length;
  out.toolRowsAfterInjection = (() => {
    const inj = rows.find(
      r => r.metadata && r.metadata.origin === 'operator' && (r.payload.text || '').includes(tagTwo)
    );
    return inj ? rows.filter(r => r.kind === 'tool' && r.seq > inj.seq).length : -1;
  })();
  return out;
};
return 'cycle installed';
