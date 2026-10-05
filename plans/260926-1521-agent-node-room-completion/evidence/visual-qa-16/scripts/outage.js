// Survivor-tab helpers for the outage checks. Each survivor page logs, per animation frame, the full room key
// (pill|rec|btns|ta|bands|status|al|nc|del|hint|rest|focus) and every run request with its status.
G.sv = G.sv || {};
G.svOpen = async (key, s, R, N) => {
  // Own browser context per survivor: Chromium's 6-connections-per-host pool is per context, and every Legacy / Console
  // page holds a long-lived EventSource, so pages sharing one context would starve each other's REST reads.
  const ctx = await G.mk();
  const p = await G.newShell('sv-' + key, ctx);
  const log = [];
  p.on('response', r => {
    const u = r.url();
    if (/\/api\/workflows\/runs\//.test(u))
      log.push([
        Date.now(),
        r.request().method(),
        u.replace(/^.*\/api\/workflows\/runs\/[^/?]+/, '').slice(0, 40) || '/run',
        r.status(),
      ]);
  });
  p.on('requestfailed', r => {
    const u = r.url();
    if (/\/api\//.test(u))
      log.push([
        Date.now(),
        r.method(),
        'FAILED ' + u.replace(/^.*\/api\//, '').slice(0, 60),
        r.failure() && r.failure().errorText,
      ]);
  });
  await p.goto(G.url(s, R, N));
  await p.locator(G.sel(s)).first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(1500);
  G.sv[key] = { p, ctx, s, N, R, log };
  return key;
};
G.svArm = async (ms, needle) => {
  for (const v of Object.values(G.sv))
    await v.p.evaluate(G.frameFn, [G.sel(v.s), needle || '', ms, '__sv', G.keySrc]);
  return Object.keys(G.sv).join(',');
};
G.svKey = async k =>
  G.sv[k].p.evaluate(([sel, src]) => eval(src)([sel, '']), [G.sel(G.sv[k].s), G.keySrc]);
G.svCollect = async () => {
  const o = {};
  for (const [k, v] of Object.entries(G.sv))
    o[k] = { s: v.s, R: v.R, frames: await v.p.evaluate(() => window.__sv || []), net: v.log };
  return o;
};
G.svShot = async (tag, k) => {
  const v = G.sv[k];
  const path = `${G.SH}/outage-${tag}-${k}.png`;
  await v.p.screenshot({ path }).catch(() => {});
  return path;
};
G.svClose = async () => {
  for (const v of Object.values(G.sv)) await v.ctx.close().catch(() => {});
  G.sv = {};
  return 'closed';
};
// Cold load in a fresh context, rAF sampler armed before the first paint.
G.coldLoad = async (s, R, N, ms = 6000) => {
  const ctx = await G.mk();
  const p = await ctx.newPage();
  await p.addInitScript(
    ([sel, src, dur]) => {
      window.__cl = [];
      const f = eval(src);
      const t0 = Date.now();
      const tick = () => {
        let k;
        try {
          k = f([sel, '']);
        } catch (e) {
          k = 'ERR';
        }
        const L = window.__cl;
        if (!L.length || L[L.length - 1][1] !== k) L.push([Date.now() - t0, k]);
        if (Date.now() - t0 < dur) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [G.sel(s), G.keySrc, ms]
  );
  await p.goto(G.url(s, R, N)).catch(() => {});
  await p.waitForTimeout(ms);
  const f = await p.evaluate(() => window.__cl || null);
  await ctx.close();
  return f;
};
return 'outage ok';
