// Checks the published app at its real address, in a phone-sized headless Chrome.
//   node scripts/check-live.mjs [url]
// Writes report/live-check.json. Needs Google Chrome and a network connection.
import { chromium, devices } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_ = (process.argv[2] || 'https://dglowinski.github.io/seria/').replace(/\/?$/, '/');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail) }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });

try {
  const res = await page.goto(URL_, { waitUntil: 'load' });
  check('the address answers over HTTPS', res.ok() && page.url().startsWith('https://'), `${res.status()} ${page.url()}`);
  await page.getByRole('heading', { name: /No plan yet/ }).waitFor({ timeout: 15000 });
  check('the app starts on the plan screen', true);

  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  const dims = await page.evaluate(async (icons) => Promise.all(icons.map((i) => new Promise((done) => { const im = new Image(); im.onload = () => done(`${im.naturalWidth}`); im.onerror = () => done('broken'); im.src = i.src; }))), manifest.icons);
  check('install files: manifest in standalone mode, icons load', manifest.display === 'standalone' && dims.join() === '192,512,512', `${manifest.display} ${dims.join()}`);

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  const real = installabilityErrors.filter((e) => e.errorId !== 'in-incognito'); // the test browser has no profile; a phone does
  check('Chrome finds nothing that blocks "Install app"', real.length === 0, JSON.stringify(real));

  const sw = await page.evaluate(async () => (await fetch('sw.js', { cache: 'no-store' })).text());
  const version = (sw.match(/const VERSION = '([^']+)'/) || [])[1];
  check('the offline cache is stamped with the release it came from', /^seria-[0-9a-f]{8}$/.test(version), version);

  const leaked = await page.evaluate(async () => {
    const out = [];
    for (const f of ['README.md', 'package.json', 'tests/domain.test.js', 'seria-design.html', 'report/report.html', 'scripts/serve.mjs']) {
      const r = await fetch(f, { cache: 'no-store' });
      if (r.ok) out.push(f);
    }
    return out;
  });
  check('only the app is published, not tests, scripts or the report', leaked.length === 0, leaked.join(', '));

  const sdk = await page.evaluate(async () => { const r = await fetch('vendor/anthropic-sdk.js'); return r.ok && Number(r.headers.get('content-length') || 1) > 0; });
  check('the Claude SDK file is there for when a key is added', sdk);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('seria-')), null, { timeout: 20000 });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  check('the offline worker is running', await page.evaluate(() => !!navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: /No plan yet/ }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Talk to the coach' }).click();
  await page.fill('#coach-input', "I want to build strength. I've trained for a year. Mondays, Wednesdays and Fridays, 50 minutes.");
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(/movements you want to skip/).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'No, nothing' }).click();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your week' }).waitFor({ timeout: 8000 });
  const days = await page.evaluate(() => JSON.parse(localStorage.getItem('seria.state.v1')).plan.days.map((d) => d.weekday).join());
  check('with the network off it still starts and builds a plan', days === 'mon,wed,fri', days);

  // One full set, still offline: starting weight, start, finish, save, rest timer.
  await page.getByTestId('start-next').click();
  const main = page.getByTestId('main-action');
  await main.waitFor();
  await page.fill('#start-weight', '20'); await sleep(150);
  for (const label of ['Save starting weight', 'Start set', 'Finish set']) {
    await page.waitForFunction((l) => document.querySelector('[data-testid=main-action]')?.textContent.trim() === l, label, { timeout: 5000 });
    await main.click();
  }
  await page.waitForFunction(() => document.querySelector('[data-testid=main-action]')?.textContent.trim().startsWith('Save set'), null, { timeout: 5000 });
  await main.click();
  await page.getByTestId('rest-timer').waitFor({ timeout: 5000 });
  await page.reload();
  await page.getByTestId('rest-timer').waitFor({ timeout: 15000 });
  check('a set can be logged offline and survives a reload mid-rest', /^\d\d:\d\d$/.test((await page.getByTestId('rest-timer').textContent()).trim()));
  await context.setOffline(false);
  check('no script errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('the check ran to the end', false, String(e.message).split('\n')[0]);
}
await browser.close();

const failed = results.filter((r) => !r.ok).length;
const out = { url: URL_, ranAt: new Date().toISOString(), browser: 'Google Chrome (headless), Pixel 7 profile', total: results.length, passed: results.length - failed, results };
writeFileSync(fileURLToPath(new URL('../report/live-check.json', import.meta.url)), `${JSON.stringify(out, null, 2)}\n`);
console.log(`\n${out.passed} of ${out.total} live checks passed at ${URL_}`);
process.exit(failed ? 1 : 0);
