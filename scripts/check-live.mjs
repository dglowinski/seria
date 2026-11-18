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
  // Asked for while still online: the SDK files are fetched on first use, not kept for offline.
  check('the OpenAI SDK file is there too', await page.evaluate(async () => (await fetch('vendor/openai-sdk.js')).ok));

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('seria-')), null, { timeout: 20000 });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  check('the offline worker is running', await page.evaluate(() => !!navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: /No plan yet/ }).waitFor({ timeout: 15000 });
  // Still offline: describe the gym in free text; the built-in reader saves it.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Equipment' }).click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'These are from Technogym: lat pulldown and leg press. Also a hip abductor. No barbell.');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor({ timeout: 8000 });
  const eq = await page.evaluate(() => JSON.parse(localStorage.getItem('seria.state.v1')).equipment);
  check('offline, a typed description of the gym is read and saved', eq.items.lat_pulldown === true && eq.items.leg_press === true && eq.items.barbell === false && eq.custom.length === 1 && eq.custom[0].pattern === 'glute', JSON.stringify(eq));
  check('offline, a named maker is noted on its machines', eq.details?.leg_press?.vendor === 'Technogym' && eq.details?.lat_pulldown?.basis === 'stated' && Object.keys(eq.details).length === 2, JSON.stringify(eq.details));

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Talk to the coach' }).click();
  await page.fill('#coach-input', "I want to build strength. I've trained for a year. Mondays, Wednesdays and Fridays, 50 minutes.");
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(/movements you want to skip/).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'No, nothing' }).click();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor({ timeout: 8000 });
  const made = await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('seria.state.v1')).plan; return `${p.perWeek}/${p.days.length}/${p.days.map((d) => d.restAfter).join('')}`; });
  check('with the network off it still starts and builds a plan: sessions with rest days, no fixed weekdays', made === '3/6/112112', made);
  const extras = await page.evaluate(() => JSON.parse(localStorage.getItem('seria.state.v1')).plan.days.map((d) => (d.optional || []).length));
  check('every session lists optional extras for the end, and the next one names them', extras.length === 6 && extras.every((n) => n >= 1 && n <= 2) && /^Optional at the end: \w/.test(await page.getByTestId('up-next-optional').textContent().catch(() => '')), extras.join());
  check('the plan reads as a list with one "Train now" button', (await page.getByTestId('rest-gap').count()) === 5 && (await page.getByTestId('train-now').textContent()).trim() === 'Train now');

  // Pairs: one switch on the plan; the saved plan follows.
  await page.getByTestId('pairs-toggle').click();
  const paired = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('seria.state.v1')); return [s.profile.pairs, s.plan.days.filter((d) => d.exercises.some((x) => x.pair)).length]; });
  check('exercises can be paired to save time with one switch on the plan', paired[0] === true && paired[1] >= 4 && (await page.getByTestId('pairs-toggle').getAttribute('aria-checked')) === 'true', paired.join());

  // One full set, still offline. First the offer to enter the missing weights, with a step of 1 typed by hand.
  await page.getByTestId('train-now').click();
  await page.getByTestId('weights-first').waitFor({ timeout: 5000 });
  const offered = (await page.getByTestId('weights-first-count').textContent()).trim();
  await page.fill('#first-weight', '20');
  await page.getByTestId('first-step-other').click();
  await page.locator('#first-step-value').pressSequentially('1', { delay: 60 });
  await sleep(250);
  const stepKept = (await page.inputValue('#first-step-value')) === '1';
  await page.getByTestId('weights-first-save').click();
  await page.waitForFunction(() => /^2 of/.test(document.querySelector('[data-testid=weights-first-count]')?.textContent || ''), null, { timeout: 5000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('seria.state.v1')).weights.db_bench_press);
  check('starting a session offers to enter the missing weights first, and a step of 1 can be typed', /^1 of \d+$/.test(offered) && stepKept && saved?.value === 20 && saved?.step === 1, `${offered} ${JSON.stringify(saved)}`);
  await page.getByTestId('weights-skip').click();
  const main = page.getByTestId('main-action');
  await main.waitFor();
  const sketchSeen = (await page.getByTestId('sketch').locator('svg').getAttribute('data-sketch').catch(() => '')) === 'dumbbells';
  const words = [(await page.getByTestId('now-word').textContent()).trim()];
  for (const label of ['Start set', 'Finish set']) {
    await page.waitForFunction((l) => document.querySelector('[data-testid=main-action]')?.textContent.trim() === l, label, { timeout: 5000 });
    if (label === 'Finish set') words.push((await page.getByTestId('now-word').textContent()).trim());
    await main.click();
  }
  check('the band at the top of the workout says what to do: "Ready", then "Train" while the set runs', words.join() === 'Ready,Train', words.join());
  check('the workout shows a sketch of the equipment for the first exercise', false || sketchSeen);
  await page.getByTestId('rest-timer').waitFor({ timeout: 5000 });
  await page.reload();
  await page.getByTestId('rest-timer').waitFor({ timeout: 15000 });
  check('a set can be logged offline with one tap and survives a reload mid-rest', /^\d\d:\d\d$/.test((await page.getByTestId('rest-timer').textContent()).trim()) && (await page.getByTestId('last-set').count()) === 1);
  check('the new screens are in the release: weights, activities, the long view, optional extras, pairs, the model thinking', await page.evaluate(async () => {
    const [w, p] = await Promise.all([fetch('js/ui/weights.js').then((r) => r.text()), fetch('js/ui/plan.js').then((r) => r.text())]);
    const k = await fetch('js/ui/workout.js').then((r) => r.text());
    return w.includes('What you lift now') && p.includes('Log another activity') && p.includes('The long view') && k.includes('Feel like a bit more?')
      && p.includes('Build a plan made for supersets') && p.includes('is thinking') && w.includes('Weights for this session');
  }));

  // A rebuild, still offline: asked for in words, built from what is on record, and it can be put back.
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor({ timeout: 8000 });
  const read = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('seria.state.v1')); return { id: s.plan.id, before: s.planBefore?.plan?.id || null, version: s.plan.version, said: s.chat[s.chat.length - 1], note: s.plan.lastUpdate?.text || '' }; });
  const was = await read();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Coach' }).click();
  await page.fill('#coach-input', 'Please regenerate my plan');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByTestId('build-plan').last().click();
  await page.getByTestId('restore-plan').waitFor({ timeout: 8000 });
  const now = await read();
  check('asking the coach for a new plan builds one, says which session is next, and keeps the old plan', now.id !== was.id && now.before === was.id && now.version === was.version + 1
    && now.said.kind === 'plan' && now.said.replaced === true && / is next\.| starts with /.test(now.said.text) && now.note.length > 20, JSON.stringify(now));
  await page.getByTestId('restore-plan').click();
  const back = await read();
  check('"Put the old plan back" undoes the rebuild', back.id === was.id && back.before === null && (await page.getByTestId('restore-plan').count()) === 0, JSON.stringify(back));
  check('the release is version 1.7.0, and the coach is sent the workouts on record and where the cycle stands', await page.evaluate(async () => {
    const [v, p, s] = await Promise.all(['js/ui/prefs.js', 'js/ai/prompts.js', 'js/domain/schedule.js'].map((f) => fetch(f).then((r) => r.text())));
    return v.includes("APP_VERSION = '1.7.0'") && p.includes('plan_being_replaced') && p.includes('recent_workouts: done.slice') && p.includes('rebuild_plan')
      && p.includes('where_the_cycle_stands') && p.includes('never swap one for variety alone') && s.includes('export function cycleNext');
  }));
  await context.setOffline(false);
  // Back online: the offline worker's own file is not kept in the offline copy, so it is read from the network.
  check('a new release loads by itself, and is fetched past the browser cache', await page.evaluate(async () => {
    const [a, w] = await Promise.all(['js/app.js', 'sw.js'].map((f) => fetch(f).then((r) => r.text())));
    return a.includes("addEventListener('controllerchange'") && w.includes("cache: 'reload'") && w.includes("cache: 'no-cache'");
  }));
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Plan' }).click();
  check('the plan screen shows the version that is running', (await page.getByTestId('app-version').textContent().catch(() => '')).trim() === 'Seria 1.7.0');
  // The one set logged above shows as the exercise's earlier result in the session's preview.
  await page.getByTestId('plan-session').filter({ hasText: 'Upper body A' }).first().click();
  await page.getByTestId('start-day').waitFor({ timeout: 8000 });
  const past = page.getByTestId('day-exercise').first().getByTestId('past');
  check('an exercise box shows how the last times went', (await past.getByTestId('past-row').count()) === 1 && /^Last time/.test(await past.textContent()) && /20 kg × \d+/.test(await past.getByTestId('past-row').first().textContent()), await past.textContent().catch(() => 'no list'));
  await page.getByRole('button', { name: 'Settings' }).click();
  check('supersets can be switched in Settings too, and the plan built since is made for them', (await page.locator('#pref-pairs').getAttribute('aria-checked').catch(() => null)) === 'true'
    && /Supersets/.test(await page.locator('main').textContent()));
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
