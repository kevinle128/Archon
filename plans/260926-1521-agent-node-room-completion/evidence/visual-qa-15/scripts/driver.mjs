// driver.mjs <ctlPort> <webPort> <apiPort> <codebaseId>
// One long-lived Playwright driver: a Console page (c) and a Legacy page (l) in one context,
// plus an HTTP control endpoint that runs the POSTed body as `async (G) => { ... }`.
import http from 'node:http';
import fs from 'node:fs';
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';

const [ctlPort, webPort, apiPort, codebaseId] = process.argv.slice(2);
const S = new URL('.', import.meta.url).pathname + 'data';
const SH = new URL('.', import.meta.url).pathname + 'shots';
const USER = 'vq15-operator';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const browser = await chromium.launch({ headless: true });
const G = {
  S,
  SH,
  fs,
  browser,
  webPort,
  apiPort,
  codebaseId,
  base: `http://localhost:${webPort}`,
  gets: [],
  posts: [],
};
G.wait = ms => new Promise(r => setTimeout(r, ms));
G.mk = async () =>
  browser.newContext({
    baseURL: G.base,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'X-Archon-User': USER },
  });
G.url = (s, R, N) =>
  s === 'c'
    ? `/console/p/${codebaseId}/r/${R}${N ? `?node=${encodeURIComponent(N)}` : ''}`
    : `/legacy/workflows/runs/${R}${N ? `?node=${encodeURIComponent(N)}` : ''}`;
G.sel = s =>
  s === 'c' ? '[data-testid="console-inspect-room"]' : '[data-testid="legacy-node-room"]';
G.api = async (path, opts = {}) => {
  const r = await fetch(`http://localhost:${apiPort}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Archon-User': USER, ...(opts.headers || {}) },
  });
  const t = await r.text();
  try {
    return Object.assign(JSON.parse(t), { __status: r.status });
  } catch {
    return { __status: r.status, text: t };
  }
};

// Per-frame key: pill|rec|btns|ta|bands|status|al|nc|del|hint|rest|focus
G.keyFn = ([sel, needle]) => {
  const e = document.querySelector(sel);
  const body = document.body ? document.body.innerText : '';
  const hint = /Failed to load — retrying/.test(body) ? 'HINT' : '';
  const err = /Could not load run|Failed to load workflow run/.test(body) ? 'ERRPAGE' : '';
  const fa = document.activeElement;
  let focus = fa ? fa.tagName : 'NONE';
  if (fa && e && e.contains(fa) && fa.tagName !== 'TEXTAREA' && fa.tagName !== 'BUTTON')
    focus += '[room]';
  if (!e || !e.querySelector('[role="region"][aria-label$=" room"]'))
    return ['NOROOM', '', '', '', '', '', '', '-1', '', hint + err, '', focus].join('|');
  const it = e.innerText;
  const pill = (it
    .slice(0, 260)
    .match(/\b(Running|Completed|Failed|Recovery required|Cancelled|Paused|Pending)\b/) || [
    '?',
  ])[0];
  const bs = [...e.querySelectorAll('button')].map(b => (b.innerText || '').trim());
  const btns = bs.filter(x => /^(Stop|Stopping…|Queue|Send now|Resume|Retry)$/.test(x)).join(',');
  const del = e.querySelectorAll('button[aria-label^="delete ·"]').length;
  const ta = e.querySelector('textarea') ? 'TA' : '';
  const bands = (it.match(/^(QUEUED|WILL SEND|SENDING|NEVER SENT)[^\n]*/gm) || []).join(';');
  const stEl = e.querySelector('[role="status"]');
  const fin = (it.match(/node (finished|failed)[^\n]*/) || [''])[0];
  const status = fin || (stEl ? stEl.textContent.trim() : '');
  const al = [...e.querySelectorAll('[role="alert"]')]
    .map(a => a.textContent.trim().slice(0, 90))
    .join(';');
  const nc = needle ? it.split(needle).length - 1 : -1;
  const rest = /restored after server restart/.test(it) ? 'REST' : '';
  return [
    pill,
    pill === 'Recovery required' ? 'REC' : '',
    btns,
    ta,
    bands,
    status,
    al,
    String(nc),
    String(del),
    hint + err,
    rest,
    focus,
  ].join('|');
};
G.frameFn = ([sel, needle, ms, name, keySrc]) => {
  const keyFn = eval(keySrc);
  const L = [];
  window[name] = L;
  const t0 = Date.now();
  const tick = () => {
    let k;
    try {
      k = keyFn([sel, needle]);
    } catch (err) {
      k = 'ERR ' + err.message;
    }
    if (!L.length || L[L.length - 1][1] !== k) L.push([Date.now(), k]);
    if (Date.now() - t0 < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
G.intervalFn = ([sel, needle, ms, name, keySrc]) => {
  const keyFn = eval(keySrc);
  const L = [];
  window[name] = L;
  const t0 = Date.now();
  const iv = setInterval(() => {
    let k;
    try {
      k = keyFn([sel, needle]);
    } catch (err) {
      k = 'ERR ' + err.message;
    }
    if (!L.length || L[L.length - 1][1] !== k) L.push([Date.now(), k]);
    if (Date.now() - t0 > ms) clearInterval(iv);
  }, 40);
};
G.keySrc = '(' + G.keyFn.toString() + ')';

G.pages = {};
G.nodes = {};
G.needle = {};
G.attach = (p, s) => {
  p.on('response', async r => {
    const u = r.url();
    const m = u.match(/\/api\/workflows\/runs\/([^/?]+)(\/nodes\/[^/?]+\/queue)?(\?|$)/);
    const meth = r.request().method();
    if (meth === 'GET' && m) {
      const e = { t: Date.now(), s, k: m[2] ? 'q' : 'r', http: r.status() };
      try {
        const j = await r.json();
        if (m[2]) {
          e.es = j.execution_state;
          e.no = j.node_outcome === null ? null : j.node_outcome || 'ABSENT';
          e.ss = j.sub_state;
          e.nq = (j.queued || []).length;
        } else e.st = j.run && j.run.status;
      } catch {}
      G.gets.push(e);
    } else if (meth === 'POST' && /\/api\/workflows\/runs\//.test(u)) {
      G.posts.push({
        t: Date.now(),
        s,
        path: u.replace(/^.*\/api\/workflows\/runs\/[^/]+/, ''),
        http: r.status(),
      });
    }
  });
};
G.newShell = async (s, ctx) => {
  const p = await (ctx || G.ctx).newPage();
  G.attach(p, s);
  if (G.esInit) await p.addInitScript(G.esInit);
  return p;
};
G.open = async (s, R, N) => {
  const p = G.pages[s];
  G.nodes[s] = N;
  await p.goto(G.url(s, R, N));
  await p.locator(G.sel(s, N)).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(800);
  return 'ok';
};
G.room = s => G.pages[s].locator(G.sel(s, G.nodes[s])).first();
G.key = async s =>
  G.pages[s].evaluate(
    ([sel, needle, src]) => eval(src)([sel, needle]),
    [G.sel(s, G.nodes[s]), G.needle[s] || '', G.keySrc]
  );
G.parse = k => {
  const p = k.split('|');
  return {
    pill: p[0],
    rec: p[1],
    btns: p[2],
    ta: p[3],
    bands: p[4],
    status: p[5],
    al: p[6],
    nc: +p[7],
    del: +p[8],
    hint: p[9],
    rest: p[10],
    focus: p[11],
    raw: k,
  };
};
G.until = async (s, fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const x = G.parse(await G.key(s));
    if (fn(x)) return x;
    await G.wait(100);
  }
  throw new Error(`until timeout ${s}: ${await G.key(s)}`);
};
G.field = s => G.room(s).locator('textarea').first();
G.btn = (s, name) =>
  G.room(s)
    .getByRole('button', { name: new RegExp('^' + name) })
    .first();
G.postWait = (s, re) =>
  G.pages[s].waitForResponse(r => r.request().method() === 'POST' && re.test(r.url()), {
    timeout: 30000,
  });
G.queue = async (s, text) => {
  await G.field(s).fill(text);
  const w = G.postWait(s, /\/(send|queue)(\?|$)/);
  const clicked = Date.now();
  await G.room(s)
    .locator('button', { hasText: /^Queue$/ })
    .first()
    .click();
  const r = await w;
  return { clicked, resolved: Date.now(), st: r.status() };
};
G.stop = async s => {
  const w = G.postWait(s, /\/(interrupt|stop)(\?|$)/);
  const clicked = Date.now();
  await G.room(s)
    .locator('button', { hasText: /^Stop$/ })
    .first()
    .click();
  const r = await w;
  return { clicked, resolved: Date.now(), st: r.status() };
};
G.send = async (s, text) => {
  if (text !== null && text !== undefined) await G.field(s).fill(text);
  const w = G.postWait(s, /\/send(\?|$)/);
  const clicked = Date.now();
  await G.room(s)
    .locator('button', { hasText: /^Send now$/ })
    .first()
    .click();
  const r = await w;
  return { clicked, sendResolved: Date.now(), st: r.status() };
};
G.tStart = async (s, ms, page) =>
  (page || G.pages[s]).evaluate(G.frameFn, [
    G.sel(s, G.nodes[s]),
    G.needle[s] || '',
    ms,
    '__t',
    G.keySrc,
  ]);
G.tGet = async (s, page) => (page || G.pages[s]).evaluate(() => window.__t || []);
G.nsStart = async (s, ms, page) =>
  (page || G.pages[s]).evaluate(G.intervalFn, [
    G.sel(s, G.nodes[s]),
    G.needle[s] || '',
    ms,
    '__ns',
    G.keySrc,
  ]);
G.nsGet = async (s, page) => (page || G.pages[s]).evaluate(() => window.__ns || []);
G.shot = async (s, tag, page) => {
  const p = page || G.pages[s];
  const el = p.locator(G.sel(s, G.nodes[s])).first();
  const path = `${SH}/app-${s === 'c' ? 'console' : 'legacy'}-${tag}.png`;
  try {
    await el.screenshot({ path });
  } catch {
    await p.screenshot({ path });
  }
  return path;
};
G.width = async s => G.room(s).evaluate(e => Math.round(e.getBoundingClientRect().width));

// EventSource logger: every new/open/error/close/message per stream, with its host.
G.esInit = () => {
  window.__es = [];
  window.__esMsg = [];
  const O = window.EventSource;
  window.EventSource = function (url, opts) {
    const es = new O(url, opts);
    const full = new URL(String(url), location.href);
    const u = full.pathname.replace(/^.*\/api\/stream\//, '');
    window.__es.push([Date.now(), 'new', u, full.host]);
    es.addEventListener('open', () => window.__es.push([Date.now(), 'open', u, es.readyState]));
    es.addEventListener('error', () => window.__es.push([Date.now(), 'error', u, es.readyState]));
    es.addEventListener('message', ev => {
      if (u !== '__dashboard__') return;
      try {
        const d = JSON.parse(ev.data);
        if (d.type === 'workflow_status' || d.type === 'dag_node')
          window.__esMsg.push([Date.now(), d.type, d.runId || '', d.status || '', d.nodeId || '']);
      } catch {}
    });
    const c = es.close.bind(es);
    es.close = () => {
      window.__es.push([Date.now(), 'close', u]);
      c();
    };
    return es;
  };
  window.EventSource.prototype = O.prototype;
  window.EventSource.CONNECTING = 0;
  window.EventSource.OPEN = 1;
  window.EventSource.CLOSED = 2;
};
G.esGet = async p => p.evaluate(() => window.__es || null);
G.esMsgGet = async p => p.evaluate(() => window.__esMsg || null);

G.ctx = await G.mk();
G.pages.c = await G.newShell('c');
G.pages.l = await G.newShell('l');
await G.pages.c.goto('/console');
await G.pages.l.goto('/legacy/dashboard');

let busy = false;
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      if (busy) {
        res.writeHead(409);
        return res.end('busy');
      }
      busy = true;
      try {
        const out = await new AsyncFunction('G', body)(G);
        res.writeHead(200);
        res.end(typeof out === 'string' ? out : JSON.stringify(out));
      } catch (err) {
        res.writeHead(500);
        res.end('ERR ' + (err && err.stack ? err.stack : String(err)));
      } finally {
        busy = false;
      }
    });
  })
  .listen(+ctlPort, '127.0.0.1', () => console.log('driver ready', ctlPort));
process.on('SIGTERM', async () => {
  await browser.close().catch(() => {});
  process.exit(0);
});
