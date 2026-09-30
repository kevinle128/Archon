// Wraps window.EventSource in a page so every open / error / close is logged with the stream path.
G.esInit = () => {
  window.__es = [];
  const O = window.EventSource;
  window.EventSource = function (url, opts) {
    const es = new O(url, opts); const u = String(url).replace(/^.*\/api\/stream\//, '');
    window.__es.push([Date.now(), 'new', u]);
    es.addEventListener('open', () => window.__es.push([Date.now(), 'open', u, es.readyState]));
    es.addEventListener('error', () => window.__es.push([Date.now(), 'error', u, es.readyState]));
    const c = es.close.bind(es); es.close = () => { window.__es.push([Date.now(), 'close', u]); c(); };
    return es;
  };
  window.EventSource.prototype = O.prototype; window.EventSource.CONNECTING = 0; window.EventSource.OPEN = 1; window.EventSource.CLOSED = 2;
};
G.esArm = async p => p.addInitScript(G.esInit);
G.esGet = async p => p.evaluate(() => window.__es || null);
if (!G.__esArmed) { for (const s of ['c', 'l']) await G.esArm(G.pages[s]); G.__esArmed = true; }
return 'es ok';
