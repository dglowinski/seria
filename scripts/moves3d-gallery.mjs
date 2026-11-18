// Every exercise in 3D, at the start and at the end of a rep, as sheets of
// pictures to look over: node scripts/moves3d-gallery.mjs [out-dir]
//   --only=squat_bar,bench_bar   just these moves
//   --turn=60                    swing the camera this many degrees further round
//   --t=0,0.5,1                  the moments of the rep to show
//   --per=8                      moves to a sheet
//   --name=moves3d               what the sheets are called: moves3d-01.png and so on
//   --rods                       a figure of rods instead of the modelled one
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (name, or) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : or; };
const out = args.find((a) => !a.startsWith('--')) || 'dist/moves3d';
const only = opt('only', '');
const turn = Number(opt('turn', 0));
const ts = opt('t', '0,1').split(',').map(Number);
const per = Number(opt('per', 8));
const name = opt('name', 'sheet');
const size = opt('size', '330x280').split('x').map(Number);
const port = 4599;

const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111411;color:#b0bbab;font:12px system-ui,sans-serif}
#g{display:grid;grid-template-columns:repeat(${Math.max(2, Math.floor(4 / ts.length) * ts.length)},${size[0]}px);gap:6px;padding:6px}
figure{margin:0;background:#1a1f1a;border-radius:8px;position:relative}
figcaption{position:absolute;left:8px;top:6px}
canvas{display:block}
</style><div id="g"></div><script type="module">
import { openStage } from '/js/ui/stage3d.js';
import { MOVE_IDS } from '/js/domain/moves3d.js';
window.show = async (ids, ts, turn) => {
  const st = await openStage({ standIn: ${args.includes('--rods')} });
  if (!st) throw new Error('no 3D here');
  const g = document.getElementById('g'); g.textContent = '';
  for (const id of ids) for (const t of ts) {
    const f = document.createElement('figure');
    const c = document.createElement('canvas'); c.width = ${size[0]} * 2; c.height = ${size[1]} * 2; c.style.width = '${size[0]}px'; c.style.height = '${size[1]}px';
    st.draw(c, id, t, { turn });
    const cap = document.createElement('figcaption'); cap.textContent = id + '  t=' + t;
    f.append(c, cap); g.append(f);
  }
};
window.ids = MOVE_IDS;
window.ready = true;
</script>`;

const server = await startServer(port);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  tab.on('console', (m) => { if (m.type() === 'error') console.log('page:', m.text()); });
  tab.on('pageerror', (e) => console.log('page error:', e.message));
  await tab.route(`http://127.0.0.1:${port}/__gallery`, (r) => r.fulfill({ contentType: 'text/html', body: page }));
  await tab.goto(`http://127.0.0.1:${port}/__gallery`);
  await tab.waitForFunction('window.ready === true');
  const all = await tab.evaluate('window.ids');
  const ids = only ? only.split(',').filter((id) => all.includes(id)) : all;
  mkdirSync(out, { recursive: true });
  for (let i = 0, n = 1; i < ids.length; i += per, n++) {
    await tab.evaluate(([list, moments, by]) => window.show(list, moments, by), [ids.slice(i, i + per), ts, turn]);
    const file = `${out}/${name}-${String(n).padStart(2, '0')}.png`;
    await tab.locator('#g').screenshot({ path: file });
    console.log(file, ids.slice(i, i + per).join(' '));
  }
} finally {
  await browser.close();
  server.close();
}
