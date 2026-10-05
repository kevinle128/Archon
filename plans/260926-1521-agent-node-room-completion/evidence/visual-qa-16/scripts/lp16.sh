#!/bin/bash
# lp16.sh : fake loop (14 s iterations). Drafts typed in both shells survive boundary 1 (first render `Iteration 2 · running`,
# focus stays in the field); a pinned `Iteration 1` survives boundary 2 (`Go to iteration 3`); keyboard Go restores the draft.
cd "$(dirname "$0")"
R=$(./dispatch.sh 3456 vq16-fake-loop-fast "LP run"); echo $R > LP.run; sleep 2
cat <<JS | ./dr.sh fake
await G.open('c','$R','fake-loop'); await G.open('l','$R','fake-loop');
const it = async s => G.room(s).evaluate(e => { const sel = e.querySelector('select'); return { sel: sel ? sel.options[sel.selectedIndex].text : null, ta: e.querySelector('textarea') ? e.querySelector('textarea').value : null, go: [...e.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => /Go to/.test(t)), fin: /reading a finished iteration/.test(e.innerText), focus: document.activeElement.tagName }; });
const lab = () => { const s = document.querySelector('[data-testid$="-room"] select'); return (s ? s.options[s.selectedIndex].text : 'nosel') + '|' + (document.querySelector('[data-testid$="-room"] textarea') || {}).value + '|' + document.activeElement.tagName; };
const arm = async s => G.pages[s].evaluate(src => { window.__lp = []; const f = eval(src); const t0 = Date.now(); const tick = () => { const k = f(); const L = window.__lp; if (!L.length || L[L.length-1][1] !== k) L.push([Date.now(), k]); if (Date.now() - t0 < 60000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, '(' + lab.toString() + ')');
await G.field('c').click(); await G.pages.c.keyboard.type('LP draft c'); await G.field('l').click(); await G.pages.l.keyboard.type('LP draft l');
await arm('c'); await arm('l');
const b0 = { c: await it('c'), l: await it('l') };
await G.until('c', () => true); 
const t0 = Date.now(); while (Date.now() - t0 < 30000) { const x = await it('c'); if (/Iteration 2/.test(x.sel || '')) break; await G.wait(100); }
await G.wait(1500);
const b1 = { c: await it('c'), l: await it('l') };
const f1 = { c: await G.pages.c.evaluate(() => window.__lp), l: await G.pages.l.evaluate(() => window.__lp) };
G.lpState = { b0, b1, f1 };
return JSON.stringify({ b0, b1, f1c: f1.c.slice(0, 6), f1l: f1.l.slice(0, 6) });
JS
echo
cat <<JS | ./dr.sh fake
const it = async s => G.room(s).evaluate(e => { const sel = e.querySelector('select'); return { sel: sel ? sel.options[sel.selectedIndex].text : null, ta: e.querySelector('textarea') ? e.querySelector('textarea').value : null, go: [...e.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => /Go to/.test(t)), fin: /reading a finished iteration/.test(e.innerText), focus: document.activeElement.tagName }; });
for (const s of ['c','l']) { const sel = G.room(s).locator('select').first(); const opts = await sel.evaluate(e => [...e.options].map(o => o.text)); await sel.selectOption({ label: opts.find(o => /Iteration 1/.test(o)) }); }
await G.wait(800);
const p1 = { c: await it('c'), l: await it('l') };
const t0 = Date.now(); while (Date.now() - t0 < 30000) { const x = await it('c'); if (x.go.length && /3/.test(x.go[0])) break; await G.wait(100); }
await G.wait(1500);
const b2 = { c: await it('c'), l: await it('l') };
await G.shot('c','LP-pinned'); await G.shot('l','LP-pinned');
for (const s of ['c','l']) { await G.room(s).locator('button', { hasText: /Go to iteration/ }).first().focus(); await G.pages[s].keyboard.press('Enter'); }
await G.wait(1200);
const g = { c: await it('c'), l: await it('l') };
const out = Object.assign({ R: '$R' }, G.lpState, { p1, b2, afterGo: g });
G.fs.writeFileSync(G.S + '/LP.json', JSON.stringify(out, null, 2) + '\n');
await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' });
return JSON.stringify({ p1, b2, g });
JS
echo
