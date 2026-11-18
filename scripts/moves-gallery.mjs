// Draws every exercise move at the start, the middle and the end of a rep, in
// pages of pictures, so the drawings can be checked by eye.
// Run: node scripts/moves-gallery.mjs [out-dir] [--only=id,id]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'report/moves';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const PORT = 4391;
mkdirSync(out, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1.5 });
await page.goto(`http://127.0.0.1:${PORT}/index.html`);
const pages = await page.evaluate(async (wanted) => {
  const m = await import('/js/domain/moves.js');
  const ids = Object.keys(m.MOVES).filter((id) => !wanted.length || wanted.includes(id));
  const NS = 'http://www.w3.org/2000/svg';
  const draw = (id, t) => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 90');
    svg.style.cssText = 'width:176px;height:132px;background:#1a1f1a;border-radius:8px;display:block';
    const g = document.createElementNS(NS, 'path'); g.setAttribute('class', 'sk-g'); g.setAttribute('d', 'M6 86 H114'); svg.append(g);
    for (const it of m.frameAt(id, t)) {
      const el = document.createElementNS(NS, it.k === 'circle' ? 'circle' : 'path');
      el.setAttribute('class', it.c);
      if (it.k === 'circle') { el.setAttribute('cx', it.p[0]); el.setAttribute('cy', it.p[1]); el.setAttribute('r', it.r); } else {
        el.setAttribute('d', it.l.map((line) => line.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')).join('') + (it.k === 'poly' ? 'Z' : ''));
      }
      svg.append(el);
    }
    return svg;
  };
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;padding:12px;background:#111411;display:block';
  const per = 15;
  const n = Math.ceil(ids.length / per);
  for (let k = 0; k < n; k++) {
    const sec = document.createElement('section');
    sec.id = `pg${k}`;
    sec.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px;width:1150px;margin-bottom:30px';
    for (const id of ids.slice(k * per, k * per + per)) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:grid;grid-template-columns:repeat(2,176px);gap:4px;font:12px/1.2 system-ui;color:#b0bbab';
      const cap = document.createElement('div'); cap.textContent = id; cap.style.cssText = 'grid-column:1/-1;font-weight:700';
      cell.append(cap, draw(id, 0), draw(id, 1));
      sec.append(cell);
    }
    document.body.append(sec);
  }
  return n;
}, only);
for (let k = 0; k < pages; k++) await page.locator(`#pg${k}`).screenshot({ path: `${out}/moves-${k + 1}.png` });
console.log(`${pages} page(s) in ${out}`);
await browser.close();
server.close();
