// Survivor-tab helpers for the outage checks. Each survivor page logs, per animation frame, a key of
// room|pill|band|TA|Queue(enabled?)|Stop|hint|errorPage|alerts, and every GET/POST on the run with status.
G.svOpen = async (key, s, R, N) => {
  G.sv = G.sv || {};
  const p = await G.ctx.newPage(); const log = [];
  p.on('response', r => { const u = r.url(); if (/\/api\/workflows\/runs\//.test(u)) log.push([Date.now(), r.request().method(), u.replace(/^.*\/api\/workflows\/runs\/[^/?]+/, '').slice(0, 40) || '/run', r.status()]); });
  p.on('requestfailed', r => { const u = r.url(); if (/\/api\//.test(u)) log.push([Date.now(), r.method(), 'FAILED ' + u.replace(/^.*\/api\//, '').slice(0, 60), r.failure() && r.failure().errorText]); });
  await p.goto(G.url(s, R, N)); await p.locator(G.sel(s)).first().waitFor({ timeout: 20000 }); await p.waitForTimeout(1500);
  G.sv[key] = { p, s, log };
};
G.svFrameFn = ([sel]) => {
  window.__sv = { log: [], t0: Date.now() };
  const t = () => {
    const e = document.querySelector(sel); const body = document.body ? document.body.innerText : '';
    const errPage = /Could not load run|Failed to load workflow run/.test(body) ? 'ERRPAGE' : '';
    const hint = /Failed to load — retrying/.test(body) ? 'HINT' : '';
    let x;
    if (!e) x = ['NOROOM', '', '', '', '', '', hint, errPage].join('|');
    else {
      const it = e.innerText;
      const pill = (it.slice(0, 220).match(/\b(Running|Completed|Failed|Recovery required|Cancelled)\b/) || ['?'])[0];
      const band = (it.match(/^(QUEUED|WILL SEND|SENDING|NEVER SENT)[^\n]*/m) || [''])[0];
      const ta = e.querySelector('textarea'); const tas = ta ? (ta.disabled ? 'TAdis' : 'TA') : '';
      const bs = [...e.querySelectorAll('button')];
      const q = bs.find(b => /^Queue/.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
      const st = bs.find(b => /^Stop$|^Send now/.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
      const rows = (it.match(/\n/g) || []).length;
      x = ['ROOM', pill, band, tas, q ? (q.disabled ? 'Qdis' : 'Q') : '', st ? (st.innerText || '').trim().split(' ')[0] + (st.disabled ? 'dis' : '') : '', hint, errPage, rows > 5 ? 'rows' : 'norows', /restored after server restart/.test(it) ? 'REST' : ''].join('|');
    }
    const L = window.__sv.log; if (!L.length || L[L.length - 1][1] !== x) L.push([Date.now(), x]);
    if (Date.now() - window.__sv.t0 < 150000) requestAnimationFrame(t);
  };
  requestAnimationFrame(t);
};
G.svArm = async () => { for (const [k, v] of Object.entries(G.sv)) await v.p.evaluate(G.svFrameFn, [G.sel(v.s)]); return Object.keys(G.sv).join(','); };
G.svShots = (tag, ms) => (async () => { const t0 = Date.now(); let i = 0; while (Date.now() - t0 < ms) { for (const [k, v] of Object.entries(G.sv)) { try { await v.p.screenshot({ path: G.S + '/shots/outage-' + tag + '-' + k + '-' + String(i).padStart(2, '0') + '.png' }); } catch (e) {} } i++; await G.wait(2000); } })();
G.svCollect = async () => { const o = {}; for (const [k, v] of Object.entries(G.sv)) o[k] = { frames: await v.p.evaluate(() => window.__sv.log), net: v.log }; return o; };
G.svClose = async () => { for (const v of Object.values(G.sv || {})) await v.p.close().catch(() => {}); G.sv = {}; return 'closed'; };
// First load while the server is down: fresh context, sample 25 s.
G.downLoad = async (tag, s, R, N, ms = 25000) => { const ctx = await G.mk(); const p = await ctx.newPage();
  await p.addInitScript(G.svFrameFn, [G.sel(s)]);
  await p.goto(G.url(s, R, N)).catch(() => {}); await p.waitForTimeout(ms);
  await p.screenshot({ path: G.S + '/shots/outage-' + tag + '-firstload-' + s + '.png' });
  const f = await p.evaluate(() => window.__sv ? window.__sv.log.map(x => [x[0] - window.__sv.t0, x[1]]) : null); await ctx.close(); return f; };
return 'outage ok';
