// End-to-end smoke test. Drives the real app in a phone-sized Chrome.
//
//   node tests/e2e/smoke.mjs          run everything
//   node tests/e2e/smoke.mjs --shots  also save screenshots to report/shots
//
// Four parts:
//   A  no Claude: built-in coach, rule-based plan, a full workout, history
//   B  Claude through the API, against a local stand-in for api.anthropic.com
//   C  inside claude.ai, against a stand-in for the viewer runtime
//   D  home-screen install files and offline start
//
// Needs Google Chrome installed. Uses no real API key and no network.

import { chromium, devices } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';
import { startMockAnthropic } from './mock-anthropic.mjs';
import { canned } from './canned.mjs';

const SHOTS = process.argv.includes('--shots');
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const shotDir = join(ROOT, 'report', 'shots');
if (SHOTS) mkdirSync(shotDir, { recursive: true });

const results = [];
let part = '';
function check(name, ok, detail = '') {
  results.push({ part, name, ok: !!ok, detail: ok ? '' : String(detail) });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${part} · ${name}${ok || !detail ? '' : `  (${detail})`}`);
}
// Captured straight from the screen surface: the usual page screenshot misplaces
// fixed bars on a scrolled page under phone emulation.
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  await sleep(150);
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(data, 'base64'));
  await cdp.detach();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until fn() is truthy (the UI re-renders a moment after a tap). */
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await fn(); } catch { v = false; }
    if (v || Date.now() > end) return v;
    await sleep(40);
  }
}
const secs = (t) => { const [m, s] = t.trim().split(':').map(Number); return m * 60 + s; };

const app = await startServer(4311);
const api = await startMockAnthropic(4312);
const BASE = 'http://127.0.0.1:4311/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const phone = { ...devices['Pixel 7'] };

async function newPage(opts = {}) {
  const context = await browser.newContext({ ...phone, acceptDownloads: true, ...opts.context });
  const page = await context.newPage();
  lastPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  // Failed requests are listed by address. The test doubles answer 401 and 529 on purpose; a browser asking for a favicon is not the app's doing.
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().startsWith(api.url) && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
  if (opts.init) await context.addInitScript(opts.init);
  return { context, page, errors };
}

const main = (page) => page.getByTestId('main-action');
const tab = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name });
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('seria.state.v1')));
const phase = (page) => page.locator('main').getAttribute('data-phase');
async function say(page, text) {
  await page.fill('#coach-input', text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/** Run one part; if a step throws, record where the app was and move on to the next part. */
let lastPage = null;
async function guarded(fn) {
  try { await fn(); } catch (e) {
    let where = '';
    try { where = `${lastPage.url()} :: ${(await lastPage.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`; } catch { /* page gone */ }
    check('part ran to the end', false, `${String(e.message).split('\n')[0]} @ ${where}`);
    try { await lastPage.context().close(); } catch { /* already closed */ }
  }
}

/** Tap the main action and wait for the screen to move on. */
async function tap(page) {
  const label = (await main(page).textContent()).trim();
  await main(page).click();
  await until(async () => !page.url().includes('#workout') || (await main(page).textContent()).trim() !== label, 2500);
}

/** Tap the main action until the workout ends or `stop` says so. */
async function runWorkout(page, { weight = '20', stop = () => false } = {}) {
  for (let i = 0; i < 120; i++) {
    if (!page.url().includes('#workout')) return;
    if (await stop()) return;
    const label = (await main(page).textContent()).trim();
    if (label === 'Save starting weight') {
      await page.fill('#start-weight', weight);
      await until(async () => Number(await page.inputValue('#start-weight')) === Number(weight));
      await sleep(60);
    }
    await main(page).click();
    await until(async () => !page.url().includes('#workout') || (await main(page).textContent()).trim() !== label, 2000);
  }
}

// A stand-in for the runtime claude.ai gives an Artifact page: private cloud
// records, Claude, dictation, the viewer's id and a save dialog.
const viewerInit = `
    window.__canned = ${canned.toString()};
    (() => {
      const load = () => JSON.parse(localStorage.getItem('__mockdb') || '{}');
      const save = (d) => localStorage.setItem('__mockdb', JSON.stringify(d));
      const snap = (path, d) => ({ id: path.split('/').pop(), exists: !!d, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } });
      const doc = (path) => {
        if (path.split('/').length % 2) throw new TypeError('document path needs an even number of segments: ' + path);
        return {
          id: path.split('/').pop(), path,
          get: async () => snap(path, load()[path]),
          set: async (data) => { if (JSON.stringify(data).length > 262144) throw { code: 'invalid_argument' }; const all = load(); all[path] = JSON.parse(JSON.stringify(data)); save(all); },
          delete: async () => { const all = load(); delete all[path]; save(all); },
          collection: (name) => col(path + '/' + name),
        };
      };
      const col = (path) => {
        if (path.split('/').length % 2 === 0) throw new TypeError('collection path needs an odd number of segments: ' + path);
        const q = {
          path, doc: (id) => doc(path + '/' + id), limit: () => q,
          get: async () => { const all = load(); const docs = Object.keys(all).filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map((k) => snap(k, all[k])); return { docs, size: docs.length, empty: !docs.length }; },
        };
        return q;
      };
      const sample = async () => { throw { code: 'invalid_request' }; };
      window.__sample = [];
      sample.json = async (input, opts) => {
        window.__sample.push({ tier: opts && opts.modelTier, cache: opts && opts.cache });
        const m = input.match(/Request data \\(JSON\\):\\n([\\s\\S]*?)\\n\\n---\\nReply/);
        return window.__canned(JSON.parse(m[1]));
      };
      const on = { partial: [], final: [], state: [] };
      const sub = (list) => (fn) => { list.push(fn); return () => list.splice(list.indexOf(fn), 1); };
      const dictation = {
        onPartial: sub(on.partial), onFinal: sub(on.final), onState: sub(on.state), active: () => false,
        start: async () => {
          on.state.forEach((f) => f({ state: 'listening' }));
          setTimeout(() => on.partial.forEach((f) => f({ text: 'I want to get' })), 60);
          setTimeout(() => { on.partial.forEach((f) => f({ text: '' })); on.final.forEach((f) => f({ text: ' I want to get stronger, three days a week' })); }, 160);
        },
        stop: async () => { on.state.forEach((f) => f({ state: 'idle', reason: 'stopped' })); },
      };
      const caps = { db: { doc, collection: col }, sample, dictation, user: { id: async () => 'viewer-1' }, downloads: { save: async (req) => { window.__saved = req.filename; return {}; } } };
      window.claude = { use: (name) => new Promise((r) => setTimeout(() => r(caps[name] || null), 30)) };
    })();`;

// =====================================================================  A
part = 'A built-in';
await guarded(async () => {
  const { context, page, errors } = await newPage();
  await page.goto(BASE);
  check('opens on the empty plan', await page.getByRole('heading', { name: /No plan yet/ }).isVisible());
  check('main navigation is Plan, Coach, History, Equipment',
    (await page.getByRole('navigation', { name: 'Main' }).getByRole('button').allTextContents()).join(',') === 'Plan,Coach,History,Equipment');
  await shot(page, '01-empty-plan');

  // --- coach conversation and profile
  await page.getByRole('button', { name: 'Talk to the coach' }).click();
  await page.getByText('Tell me about your goal').waitFor();
  check('opening the coach saves nothing by itself', (await state(page)) === null || (await state(page)).chat.length === 0);
  check('coach status says Claude is not connected', (await page.getByTestId('ai-status').textContent()).includes('Built-in coach'));
  await say(page, "I want to build strength. I've trained for a year. I can come three times a week for 50 minutes.");
  await page.getByText(/Which days suit you\?/).waitFor();
  check('coach asks for what is missing (days, things to skip)', true);
  await shot(page, '02-coach');
  await page.fill('#coach-input', 'Mondays, Wednesdays and Fridays. No deadlifts please.');
  await page.keyboard.press('Enter');
  await page.getByTestId('assumptions').waitFor();
  const facts = await page.getByTestId('assumptions').textContent();
  check('assumptions shown before the plan is built', /Strength/.test(facts) && /Mon, Wed, Fri/.test(facts) && /50 min/.test(facts) && /Leaving out/.test(facts), facts);
  check('no plan exists until the user confirms', (await state(page)).plan === null);
  await shot(page, '03-assumptions');
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();

  // --- plan
  await page.getByRole('heading', { name: 'Your week' }).waitFor();
  let st = await state(page);
  check('plan has the three chosen days', st.plan.days.map((d) => d.weekday).join() === 'mon,wed,fri');
  check('every day fits the 50 minute budget', st.plan.days.every((d) => d.estMinutes <= 50), st.plan.days.map((d) => d.estMinutes));
  check('skipped lifts are left out', !JSON.stringify(st.plan).includes('deadlift'));
  check('plan records the rules version', st.plan.rulesVersion === '1.0.0');
  check('plan shows weekly sets per muscle group against the target', /Target for your level: 10-16 sets/.test(await page.getByTestId('volume').textContent()) && /Back\s*\d+ sets/.test(await page.getByTestId('volume').textContent()));
  check('plan list shows day, body part and time', /Monday/.test(await page.locator('button.row').first().textContent()) && /Upper body · \d+ min/.test(await page.locator('button.row').first().textContent()));
  await shot(page, '04-plan');

  // --- equipment
  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'We have a lat pulldown and a leg press. Also a glute drive machine and a sauna. No barbell.');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor();
  const gym = await page.getByTestId('gym-result').textContent();
  st = await state(page);
  check('free text about the gym is read and saved in one go', st.equipment.items.lat_pulldown === true && st.equipment.items.leg_press === true
    && st.equipment.custom.some((c) => c.name === 'Glute drive' && c.pattern === 'glute') && st.equipment.items.barbell === false, JSON.stringify(st.equipment));
  check('the result says what was added, turned off and not placed', /Added: Lat pulldown, Leg press/.test(gym) && /Glute drive \(glutes\)/.test(gym)
    && /not available: Barbell and plates/.test(gym) && /Could not place: sauna/.test(gym) && /built-in reader/.test(gym), gym);
  check('the text box is cleared once saved', (await page.inputValue('#gym-text')) === '');
  await shot(page, '05-gym-text');
  await page.getByRole('button', { name: /^Leg curl/ }).click(); // picking from the list still works
  await page.fill('#custom-name', 'Belt squat');
  await page.selectOption('#custom-pattern', 'squat');
  await page.getByRole('button', { name: 'Add my machine' }).click(); // adding your own machine by hand closes the sheet
  await page.getByRole('switch', { name: /Barbell and plates/ }).click(); // back on: the plan built above uses it
  check('added machines are listed as available', (await page.getByTestId('machine').count()) === 5 && (await page.getByTestId('machine').first().textContent()).includes('Available'));
  st = await state(page);
  check('free weights, bench and pull-up bar need no entry (on by default)', !('dumbbells' in st.equipment.items) && !('barbell' in st.equipment.items) && st.equipment.items.lat_pulldown === true);
  await shot(page, '05-equipment');
  await page.getByRole('switch', { name: /Pull-up bar/ }).click();
  await tab(page, 'Plan').click();
  await page.getByText(/equipment you no longer have/).waitFor();
  await page.getByRole('button', { name: 'See the swaps' }).click();
  const swap = page.getByTestId('change').first();
  await swap.waitFor();
  check('lost equipment gives a swap with old value, new value and reason', /Pull-up → Lat pulldown/.test(await swap.textContent()) && /not available any more/.test(await swap.textContent()), await swap.textContent());
  await swap.getByRole('button', { name: 'Keep plan' }).click();
  check('"Keep plan" leaves the plan alone', (await state(page)).plan.version === 1 && /Plan kept/.test(await swap.textContent()));
  await tab(page, 'Equipment').click();
  await page.getByRole('switch', { name: /Pull-up bar/ }).click();

  // --- day preview
  await tab(page, 'Plan').click();
  await page.getByRole('button', { name: /^Monday/ }).click();
  await page.getByRole('heading', { name: 'Upper body' }).waitFor();
  const dayText = await page.locator('main').textContent();
  check('day preview: order, equipment, sets, reps, rest, how to pick the weight, time parts',
    /1\. Dumbbell bench press/.test(dayText) && /Dumbbells, Bench/.test(dayText) && /\d × \d+ reps/.test(dayText) && /rest 3:00 min/.test(dayText) && /You pick it in the first session/.test(dayText) && /warm-up 8, sets \d+, rests \d+, moving between stations \d+/.test(dayText), dayText.slice(0, 300));
  await shot(page, '06-day');

  // --- workout: starting weight, set, result, rest
  await page.getByTestId('start-day').click();
  await main(page).waitFor();
  check('workout has its own screen without the tab bar', (await page.getByRole('navigation', { name: 'Main' }).count()) === 0);
  check('no history: asks for a starting weight first', (await main(page).textContent()).trim() === 'Save starting weight' && await page.getByText('Choose your starting weight').isVisible());
  await shot(page, '07-starting-weight');
  await page.fill('#start-weight', '20'); await sleep(120);
  await tap(page);
  check('starting weight is saved and shown per dumbbell', (await page.getByTestId('target-load').textContent()).trim() === '20 kg' && (await state(page)).weights.db_bench_press.value === 20);
  const target = Number(await page.getByTestId('target-reps').textContent());
  await tap(page);
  check('"Start set" shows the active set', (await phase(page)) === 'active' && (await main(page).textContent()).trim() === 'Finish set');
  await shot(page, '08-set-active');
  await tap(page);
  check('"Finish set" opens the result with the planned value', (await phase(page)) === 'log' && Number(await page.inputValue('#reps-done')) === target);
  await page.getByRole('button', { name: '1 rep fewer' }).click();
  check('reps correct by ±1 and ±2', await until(async () => Number(await page.inputValue('#reps-done')) === target - 1));
  await page.getByRole('button', { name: '2 reps more' }).click();
  await until(async () => Number(await page.inputValue('#reps-done')) === target + 1);
  await page.fill('#reps-done', String(target - 1));
  check('reps can be typed directly', await until(async () => (await page.getByTestId('result-line').textContent()).startsWith(`${target - 1} reps`)));
  await shot(page, '09-set-result');
  const t0 = Date.now();
  await tap(page);
  check('saving starts the rest countdown at once', (await phase(page)) === 'rest' && Date.now() - t0 < 1500);
  const restSec = (await state(page)).sessions[0].exercises[0].restSec;
  const shown = secs(await page.getByTestId('rest-timer').textContent());
  check('countdown starts from the planned rest', shown <= restSec && shown >= restSec - 3, `${shown} vs ${restSec}`);
  const hint = page.getByTestId('hint');
  check('rule-based suggestion: change, reason, Apply / Keep plan', await hint.isVisible() && /Weight: 20 kg → 18 kg/.test(await hint.textContent()) && /close to failure/.test(await hint.textContent()) && /Apply/.test(await hint.textContent()) && /Keep plan/.test(await hint.textContent()));
  await shot(page, '10-rest');

  // --- reload mid-rest
  await sleep(2100);
  await page.reload();
  await page.getByTestId('rest-timer').waitFor();
  const after = secs(await page.getByTestId('rest-timer').textContent());
  check('reload restores the workout, the saved set and the time left', page.url().includes('#workout') && (await phase(page)) === 'rest' && after <= shown - 2 && after >= shown - 8 && (await page.getByText(`${target - 1} reps × 20 kg`).count()) === 1, `${after} after ${shown}`);
  await page.getByRole('button', { name: '+15 s' }).click();
  const plus = secs(await page.getByTestId('rest-timer').textContent());
  check('+15 s extends the rest', plus >= after + 13 && plus <= after + 15, `${plus} after ${after}`);
  await page.getByTestId('hint').getByRole('button', { name: 'Apply' }).click();
  check('applying the suggestion changes only the sets still to come', (await page.getByTestId('target-load').textContent()).trim() === '18 kg' && (await state(page)).sessions[0].exercises[0].sets[0].actual.load === 20);
  await page.getByRole('button', { name: 'Skip rest' }).click();
  check('"Skip rest" goes straight to the next set', (await phase(page)) === 'ready');

  // --- weight change, reps in reserve, correcting a set
  await tap(page); await tap(page);
  await page.getByRole('button', { name: 'Change weight' }).click();
  await page.getByRole('button', { name: 'More weight' }).click();
  check('weight can be changed in the result', await until(async () => Number(await page.inputValue('#load-done')) === 20));
  await page.getByRole('button', { name: 'Less weight' }).click();
  await until(async () => Number(await page.inputValue('#load-done')) === 18);
  await page.getByRole('button', { name: '2', exact: true }).click();
  await until(async () => (await state(page)).sessions[0].draft.rir === 2);
  await tap(page);
  st = await state(page);
  check('reps in reserve is optional and saved when given', st.sessions[0].exercises[0].sets[0].actual.rir === null && st.sessions[0].exercises[0].sets[1].actual.rir === 2);
  await page.getByRole('button', { name: /^Set 1:/ }).click();
  await page.fill('#edit-reps', String(target));
  await page.getByRole('button', { name: 'Save correction' }).click();
  check('a wrong entry can be corrected during the workout', (await state(page)).sessions[0].exercises[0].sets[0].actual.reps === target);

  // --- finish exercise 1, next exercise, swap, skip
  await runWorkout(page, { stop: async () => (await state(page)).sessions[0].cursor.ex === 1 });
  check('after the last set the screen shows the next exercise', (await page.locator('.eyebrow').first().textContent()) === 'Next exercise' && (await page.getByTestId('exercise-name').textContent()) !== 'Dumbbell bench press' && (await page.getByTestId('progress').textContent()).includes('Exercise 2 of'));
  const before = await page.getByTestId('exercise-name').textContent();
  await page.getByRole('button', { name: 'Machine busy? Swap' }).click();
  await shot(page, '11-swap');
  await page.locator('.sheet button.row').first().click();
  const swapped = await page.getByTestId('exercise-name').textContent();
  check('a busy station can be swapped for another exercise on available equipment', swapped !== before && (await page.locator('main').textContent()).includes(`swapped in for ${before}`), `${before} -> ${swapped}`);
  await runWorkout(page, { stop: async () => (await state(page)).sessions[0].cursor.set === 1 && (await phase(page)) !== 'log' && (await phase(page)) !== 'active' });
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await page.getByRole('button', { name: 'Skip set' }).click();
  check('a set can be skipped', (await state(page)).sessions[0].exercises[1].sets[1].status === 'skipped');
  await runWorkout(page);

  // --- summary
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  st = await state(page);
  const s0 = st.sessions[0];
  const total = s0.exercises.reduce((n, x) => n + x.sets.length, 0);
  check('summary: time, sets done of total, skipped sets, biggest differences',
    (await page.getByTestId('sum-sets').textContent()).trim() === `${total - 1} / ${total}` && /\d+ min/.test(await page.getByTestId('sum-minutes').textContent()) && /Biggest differences/.test(await page.locator('main').textContent()) && /1 set skipped/.test(await page.locator('main').textContent()));
  check('session is stored set by set with plan and result', s0.status === 'done' && s0.exercises[0].sets.every((x) => x.planned && x.actual) && s0.planVersion === 1 && s0.exercises[1].swappedFrom.name === before);
  check('weights chosen in the session are written into the plan', st.plan.days[0].exercises[0].load.value === 20);
  await shot(page, '12-summary');
  await page.getByTestId('see-proposal').click();
  await page.getByRole('heading', { name: 'Next workouts' }).waitFor();
  const cards = page.getByTestId('change');
  check('after the session: proposals with change, reason and a choice', (await cards.count()) >= 1 && /→/.test(await cards.first().textContent()), await page.locator('main').textContent());
  await shot(page, '13-proposals');
  const planBefore = JSON.stringify(s0.exercises.map((x) => x.sets.map((y) => y.planned)));
  await cards.first().getByRole('button', { name: 'Apply' }).click();
  st = await state(page);
  check('"Apply" updates the plan and bumps its version', st.plan.version === 2 && /Applied/.test(await cards.first().textContent()));
  check('the stored session keeps the plan it was done against', JSON.stringify(st.sessions[0].exercises.map((x) => x.sets.map((y) => y.planned))) === planBefore);

  // --- history and correction
  await page.getByRole('button', { name: 'Done' }).click();
  await tab(page, 'History').click();
  await page.getByRole('heading', { name: '1 workout' }).waitFor();
  check('history lists the workout', /1 workout/.test(await page.locator('main').textContent()) && (await page.locator('main button.row').count()) === 1);
  await shot(page, '14-history');
  await page.locator('main button.row').first().click();
  await page.getByTestId('session-exercise').first().getByRole('button', { name: /Set 3/ }).click();
  await page.fill('#edit-reps', '3');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await page.getByText('Corrected by hand').first().waitFor();
  check('a saved set can be corrected later from history', (await state(page)).sessions[0].exercises[0].sets[2].actual.reps === 3);
  await shot(page, '15-session-detail');

  // --- second session: history feeds the next plan
  await tab(page, 'Plan').click();
  await page.getByRole('button', { name: /^Monday/ }).click();
  await page.getByRole('heading', { name: 'Upper body' }).waitFor();
  check('day preview now shows the recorded weight', /kg per dumbbell/.test(await page.locator('main').textContent()));

  // --- backup, erase, restore
  await page.getByRole('button', { name: 'Settings' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const file = join(tmpdir(), `seria-smoke-${Date.now()}.json`);
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  check('backup file holds plan and history and no API key', backup.app === 'seria' && backup.state.sessions.length === 1 && !/apiKey|sk-ant/.test(JSON.stringify(backup)));
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByTestId('confirm-reset').click();
  check('erase clears plan and history', (await state(page)).plan === null && (await state(page)).sessions.length === 0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.setInputFiles('#import-file', file);
  await page.getByText('Backup restored').waitFor();
  check('restore brings them back', (await state(page)).plan.version === 2 && (await state(page)).sessions.length === 1);
  await page.getByRole('button', { name: /Training rules/ }).click();
  await page.getByRole('heading', { name: 'What the plan is based on' }).waitFor();
  check('rules library is readable in the app, with sources', /What the plan is based on/.test(await page.locator('main').textContent()) && (await page.locator('.cite a').count()) >= 10);
  await shot(page, '16-rules');
  check('no script errors in part A', errors.length === 0, errors.join(' | '));
  await context.close();
});

// =====================================================================  B
part = 'B Claude API';
await guarded(async () => {
  const { context, page, errors } = await newPage();
  await page.goto(`${BASE}#prefs`);
  await page.fill('#api-key', 'sk-ant-test-key');
  await page.locator('details summary').click();
  await page.fill('#base-url', api.url);
  check('status shows Claude connected with the default model', /Claude API · claude-opus-5-5/.test(await page.getByTestId('claude-status').textContent()));
  await page.getByTestId('test-claude').click();
  await page.getByText(/Claude answered/).waitFor();
  check('"Test the connection" gets an answer', /Hello from Claude/.test(await page.getByTestId('test-result').textContent()));
  await shot(page, '17-claude-connected');
  const r = api.state.requests[0];
  check('request: key, browser-access and version headers, as the official SDK sends them', r.headers.authorization === 'Bearer sk-ant-test-key' && r.headers['anthropic-dangerous-direct-browser-access'] === 'true' && !!r.headers['anthropic-version'] && /^1\./.test(r.headers['x-stainless-package-version']), JSON.stringify(r.headers));
  check('request: model, structured output, effort, cached system prompt', r.body.model === 'claude-opus-5-5' && r.body.output_config.format.type === 'json_schema' && r.body.output_config.effort === 'low' && r.body.system[0].cache_control.type === 'ephemeral' && r.body.max_tokens === 16000, JSON.stringify(r.body.output_config).slice(0, 200));
  check('request: refusal fallback is switched on', r.body.fallbacks === 'default' && String(r.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') && r.path === '/v1/messages', `${r.path} ${r.headers['anthropic-beta']}`);
  check('request: no thinking or sampling parameters the model would reject', !('thinking' in r.body) && !('temperature' in r.body) && !('tool_choice' in r.body));
  check('request: system prompt carries the rules library and its version', /Training rules library, version 1\.0\.0/.test(r.body.system[0].text));
  check('the key is kept apart from the app data', !/sk-ant/.test(await page.evaluate(() => localStorage.getItem('seria.state.v1') || '')));

  await tab(page, 'Coach').click();
  await say(page, 'Strength, a year in, three days a week, 50 minutes. Skip deadlifts, I love pull-ups.');
  await page.getByTestId('assumptions').waitFor();
  let st = await state(page);
  check('Claude fills the profile; unknown exercise ids are dropped', st.profile.goal === 'strength' && st.profile.avoid.join() === 'bb_deadlift' && st.profile.include.join() === 'pull_up');
  check('the reply is marked as coming from Claude', (await page.locator('.bubble .via').first().textContent()) === 'Claude');
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your week' }).waitFor();
  st = await state(page);
  check('plan built by Claude, cleaned against the catalog', st.plan.source === 'claude' && st.plan.days.length === 3 && !JSON.stringify(st.plan).includes('ghost_lift') && st.plan.days.every((d) => d.estMinutes <= 50));
  check('plan screen says who built it', /Built by Claude/.test(await page.locator('main').textContent()));

  // describing the gym: Claude reads it, the app checks it
  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'Cables, a hack squat, a belt squat and some treadmills. No leg press.');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor();
  st = await state(page);
  const gymReq = api.state.requests.map((x) => JSON.parse(x.body.messages[0].content)).find((x) => x.mode === 'equipment');
  check('gym text goes to Claude with the equipment catalog', !!gymReq && gymReq.equipment_catalog.length >= 19 && /belt squat/.test(gymReq.user_text));
  check("Claude's reading is saved; made-up ids and movements are dropped", st.equipment.items.cable === true && st.equipment.items.hack_squat === true
    && st.equipment.custom.map((c) => `${c.name}:${c.pattern}`).join() === 'Belt squat:squat' && !('made_up_machine' in st.equipment.items) && !('leg_press' in st.equipment.items), JSON.stringify(st.equipment));
  check('the result is marked as read by Claude and lists what it could not place', /Read by Claude/.test(await page.getByTestId('gym-result').textContent()) && /Could not place: treadmills, Mystery box/.test(await page.getByTestId('gym-result').textContent()), await page.getByTestId('gym-result').textContent());
  await shot(page, '17b-gym-text-claude');
  await page.getByRole('button', { name: 'Done' }).click();
  await tab(page, 'Plan').click();
  await page.getByRole('heading', { name: 'Your week' }).waitFor();

  // in-session: rules at once, Claude a moment later
  api.state.delayMs = 900;
  await page.getByRole('button', { name: /^Monday/ }).click(); // a fixed day, so the run does not depend on today's date
  await page.getByTestId('start-day').click();
  await main(page).waitFor();
  await page.fill('#start-weight', '20'); await sleep(120); await tap(page);
  await tap(page); await tap(page);
  await page.getByRole('button', { name: '2 reps fewer' }).click();
  const tSave = Date.now();
  await tap(page);
  check('saving does not wait for Claude', (await phase(page)) === 'rest' && Date.now() - tSave < 700, `${Date.now() - tSave} ms`);
  check('the rule-based suggestion is there first', /From the training rules/.test(await page.getByTestId('hint').textContent()));
  await page.getByText('From Claude').waitFor({ timeout: 5000 });
  check("Claude's suggestion replaces it when it arrives in time", /Weight: 20 kg → 16 kg/.test(await page.getByTestId('hint').textContent()), await page.getByTestId('hint').textContent());
  await shot(page, '18-claude-hint');
  await page.getByTestId('hint').getByRole('button', { name: 'Keep plan' }).click();
  check('"Keep plan" drops the suggestion', (await page.getByTestId('hint').count()) === 0 && (await page.getByTestId('target-load').textContent()).trim() === '20 kg');

  // late answer: by the time it lands the sets it talks about are done
  api.state.delayMs = 2500;
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await tap(page); await tap(page);
  await page.getByRole('button', { name: '2 reps fewer' }).click();
  await tap(page);
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await tap(page); await tap(page); await tap(page); // last set of exercise 1, on target
  const inSession = () => api.state.requests.filter((x) => JSON.parse(x.body.messages[0].content).mode === 'in_session').length;
  const asked = inSession();
  await sleep(3200);
  st = await state(page);
  check('a late suggestion about finished sets is not shown', st.sessions[0].cursor.ex === 1 && st.sessions[0].hint === null && (await page.getByTestId('hint').count()) === 0);
  check('an on-target set does not call Claude', inSession() === asked && asked === 2, `${asked} -> ${inSession()}`);

  // Claude down mid-workout: carry on with the last approved plan
  api.state.delayMs = 0; api.state.fail = 529;
  await page.fill('#start-weight', '20'); await sleep(120); await tap(page);
  await tap(page); await tap(page);
  await page.getByRole('button', { name: '1 rep fewer' }).click();
  await tap(page);
  await sleep(600);
  check('with Claude failing, the workout carries on by the rules', (await phase(page)) === 'rest' && /From the training rules/.test(await page.getByTestId('hint').textContent()));
  api.state.fail = null;
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  await page.getByTestId('see-proposal').click();
  await page.getByText('From Claude').waitFor({ timeout: 5000 });
  const card = page.getByTestId('change').first();
  check("after the session Claude's review is shown with the app's own old value", /Weight: 20 kg → 22 kg/.test(await card.textContent()) && /Claude double/.test(await card.textContent()), await card.textContent());
  await shot(page, '19-claude-review');

  // chat change request -> proposal in the chat
  await tab(page, 'Coach').click();
  await say(page, 'Can Monday be shorter?');
  await page.getByTestId('change').first().waitFor();
  check('asking the coach for a change gives a proposal to apply or keep', /Sets: 3 sets → 2 sets/.test(await page.getByTestId('change').first().textContent()));
  await page.getByTestId('change').first().getByRole('button', { name: 'Apply' }).click();
  check('applied from the chat', (await state(page)).plan.days[0].exercises[0].sets === 2);

  // wrong key: clear message, built-in coach takes over
  api.state.fail = 401;
  await say(page, 'Make it four days a week');
  await page.getByText(/rejected the API key/).waitFor();
  await page.getByTestId('assumptions').last().waitFor();
  check('a failing key gives a plain message and the built-in coach answers', (await state(page)).profile.daysPerWeek === 4);
  await shot(page, '20-claude-fallback');
  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'smith machine');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor();
  check('gym text still gets saved when Claude fails', (await state(page)).equipment.items.smith === true && /built-in reader instead/.test(await page.getByTestId('gym-result').textContent()));
  api.state.fail = null;
  check('no script errors in part B', errors.length === 0, errors.join(' | '));
  await context.close();
});

// =====================================================================  C
part = 'C in claude.ai';
await guarded(async () => {
  const { context, page, errors } = await newPage({ init: viewerInit });
  await page.goto(`${BASE}#prefs`);
  await page.getByText('Claude, through your claude.ai account').waitFor();
  check('inside claude.ai: Claude is connected with no key', (await page.locator('#api-key').count()) === 0);
  await page.getByText('Saved to the cloud').waitFor();
  check('inside claude.ai: data status says cloud', true);
  await shot(page, '21-viewer-settings');
  await tab(page, 'Coach').click();
  await page.fill('#coach-input', 'Hi.');
  await page.getByRole('button', { name: 'Record voice' }).click();
  await page.waitForFunction(() => document.querySelector('#coach-input').value.includes('three days a week'));
  check('voice lands in the text field, after what was typed', (await page.inputValue('#coach-input')) === 'Hi. I want to get stronger, three days a week');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.fill('#coach-input', `${await page.inputValue('#coach-input')}, 50 minutes each.`);
  check('the transcript can be edited before sending', (await page.inputValue('#coach-input')).endsWith('50 minutes each.'));
  await shot(page, '22-viewer-voice');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByTestId('assumptions').waitFor();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  check("the viewer's Claude was used, uncached", await page.evaluate(() => window.__sample.length === 2 && window.__sample.every((c) => c.cache === false && c.tier === 'default')));
  await page.getByTestId('start-next').click();
  await page.fill('#start-weight', '22'); await sleep(120); await tap(page);
  await tap(page); await tap(page); await tap(page);
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('__mockdb') || '{}')).some((k) => k.includes('/sessions/')), null, { timeout: 8000 });
  await sleep(1800);
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
  const keys = Object.keys(db);
  check('cloud copy: one private main record plus one record per workout', keys.includes('data/users/viewer-1/main') && keys.filter((k) => k.startsWith('data/users/viewer-1/main/sessions/')).length === 1, keys.join(', '));
  check('cloud copy holds the plan and the saved set', db['data/users/viewer-1/main'].plan.source === 'claude' && Object.values(db).some((d) => d.exercises && d.exercises[0].sets[0].actual && d.exercises[0].sets[0].actual.load === 22));
  // a new device: nothing in the browser, everything in the cloud
  await page.evaluate(() => { localStorage.removeItem('seria.state.v1'); });
  await page.goto(`${BASE}#coach`);
  await page.reload();
  check('a fresh browser waits for the cloud copy before showing the app', (await page.getByTestId('loading').count()) === 1 || (await page.getByTestId('resume').count()) === 1);
  await page.getByTestId('main-action').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Keep going' }).click();
  await page.goBack().catch(() => {});
  await page.goto(`${BASE}#plan`);
  await page.getByTestId('resume').waitFor({ timeout: 8000 });
  const st = await state(page);
  check('a fresh browser gets plan and workout back from the cloud', st.plan.source === 'claude' && st.sessions.length === 1 && st.activeSessionId === st.sessions[0].id);
  await page.getByTestId('resume').click();
  check('and can carry on the same workout', await until(async () => (await phase(page)) === 'rest' && (await page.getByRole('button', { name: /^Set 1: \d+ reps × 22 kg\./ }).count()) === 1));
  await shot(page, '23-viewer-restored');
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('export').click();
  await page.waitForFunction(() => !!window.__saved);
  check('backup goes through the viewer save dialog', /seria-backup-.*\.json/.test(await page.evaluate(() => window.__saved)));
  check('no script errors in part C', errors.length === 0, errors.join(' | '));
  await context.close();
});

// =====================================================================  D
part = 'D install and offline';
await guarded(async () => {
  const { context, page, errors } = await newPage();
  await page.goto(`${BASE}?sw=1`);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  check('manifest: standalone display, name, start URL', manifest.display === 'standalone' && manifest.name === 'Seria' && manifest.start_url === './');
  const sizes = manifest.icons.map((i) => `${i.sizes}${i.purpose === 'maskable' ? 'm' : ''}`).join();
  check('manifest: 192 and 512 icons plus a maskable one', sizes === '192x192,512x512,512x512m', sizes);
  const dims = await page.evaluate(async (icons) => Promise.all(icons.map((i) => new Promise((res) => { const im = new Image(); im.onload = () => res(`${im.naturalWidth}x${im.naturalHeight}`); im.onerror = () => res('broken'); im.src = i.src; }))), manifest.icons);
  check('icons load at the declared sizes', dims.join() === '192x192,512x512,512x512', dims.join());
  check('viewport and theme colour set for phones', await page.evaluate(() => document.querySelector('meta[name=viewport]').content.includes('viewport-fit=cover') && document.querySelector('meta[name=theme-color]').content === '#111411'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).length > 0);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: /No plan yet/ }).waitFor({ timeout: 8000 });
  await tab(page, 'Coach').click();
  await say(page, 'Build muscle, beginner, 2 days a week, 40 minutes');
  await page.getByText(/movements you want to skip/).waitFor();
  await page.getByRole('button', { name: 'No, nothing' }).click();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  check('offline: the app starts and builds a plan with no network', (await state(page)).plan.days.length === 2);
  await shot(page, '24-offline');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no sideways scroll at phone width', overflow <= 0, overflow);
  check('no script errors in part D', errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)).length === 0, errors.join(' | '));
  await context.close();
});

// =====================================================================  E
part = 'E single file';
await guarded(async () => {
  const { context, page, errors } = await newPage({ init: viewerInit });
  const html = readFileSync(join(ROOT, 'dist', 'seria-artifact.html'), 'utf8');
  check('single-file build exists, is small, and pulls in nothing from outside', html.length < 400000 && !/<script[^>]+src=|<link[^>]+href=|@import|url\(/.test(html), `${html.length} bytes`);
  check('it follows the Artifact page rules (title first, no document tags of its own)', html.startsWith('<title>Seria</title>') && !/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(html));
  await page.goto(`${BASE}dist/preview.html`);
  await page.getByRole('heading', { name: /No plan yet/ }).waitFor();
  await tab(page, 'Coach').click();
  await say(page, 'Strength, a year in, three days, 50 minutes');
  await page.getByTestId('assumptions').waitFor();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your week' }).waitFor();
  check('the single file runs the whole app with Claude and cloud save from the viewer', (await state(page)).plan.source === 'claude'
    && await until(async () => !!(await page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}')['data/users/viewer-1/main']?.plan)), 6000));
  check('no script errors in part E', errors.length === 0, errors.join(' | '));
  await context.close();
});

await browser.close();
app.close();
api.server.close();

const failed = results.filter((r) => !r.ok);
const summary = { ranAt: new Date().toISOString(), browser: 'Google Chrome (headless), Pixel 7 profile', total: results.length, passed: results.length - failed.length, failed: failed.length, results };
writeFileSync(join(ROOT, 'report', 'smoke-results.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${summary.passed} of ${summary.total} checks passed.`);
process.exit(failed.length ? 1 : 0);
