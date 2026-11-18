// End-to-end smoke test. Drives the real app in a phone-sized Chrome.
//
//   node tests/e2e/smoke.mjs          run everything
//   node tests/e2e/smoke.mjs --shots  also save screenshots to report/shots
//   node tests/e2e/smoke.mjs --only=H one part only, by its letter
//
// Four parts:
//   A  no Claude: built-in coach, rule-based plan, a full workout, history
//   B  Claude through the API, against a local stand-in for api.anthropic.com
//   C  inside claude.ai, against a stand-in for the viewer runtime
//   D  home-screen install files and offline start
//   E  the single-file build that is published on claude.ai
//   F  OpenAI through its API, against a local stand-in for api.openai.com
//   G  optional extras    H  pairs and the workout band
//   I  the coach knows the workouts on record, and a rebuild carries on from them
//
// Needs Google Chrome installed. Uses no real API key and no network.

import { chromium, devices } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, setSwVersion } from '../../scripts/serve.mjs';
import { startMockAnthropic } from './mock-anthropic.mjs';
import { startMockOpenAI } from './mock-openai.mjs';
import { canned } from './canned.mjs';
import { RULES_VERSION } from '../../js/domain/rules.js';

const SHOTS = process.argv.includes('--shots');
const ONLY = (process.argv.find((x) => x.startsWith('--only=')) || '').slice(7); // one part by its letter, for a quick run
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
const oai = await startMockOpenAI(4313);
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
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().startsWith(api.url) && !r.url().startsWith(oai.url) && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
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
  if (ONLY && !part.startsWith(ONLY)) return;
  try { await fn(); } catch (e) {
    let where = '';
    try { where = `${lastPage.url()} :: ${(await lastPage.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`; } catch { /* page gone */ }
    check('part ran to the end', false, `${String(e.message).split('\n')[0]} @ ${where}`);
    try { await lastPage.context().close(); } catch { /* already closed */ }
  }
}

/** Open a session from the plan list by its name. */
async function openSession(page, name) {
  await page.getByTestId('plan-session').filter({ hasText: name }).first().click();
  await page.getByTestId('start-day').waitFor(); // the session's own screen, not the plan's card of the same name
  await page.locator('main h2', { hasText: name }).waitFor();
}

/** Pretend the recorded workouts happened this many days earlier, then reload. */
async function daysPass(page, n) {
  await page.evaluate((days) => {
    const st = JSON.parse(localStorage.getItem('seria.state.v1'));
    for (const w of st.sessions) for (const k of ['startedAt', 'endedAt', 'updatedAt']) if (w[k]) w[k] -= days * 864e5;
    localStorage.setItem('seria.state.v1', JSON.stringify(st));
  }, n);
  await page.reload();
  await page.getByTestId('train-now').waitFor();
}

/** Make the running rest end in `ms` from now, then reload: what happens when a rest runs out, without waiting minutes. */
async function restEndsIn(page, ms) {
  await page.evaluate((left) => {
    const st = JSON.parse(localStorage.getItem('seria.state.v1'));
    const s = st.sessions.find((x) => x.id === st.activeSessionId);
    s.rest.endsAt = Date.now() + left;
    localStorage.setItem('seria.state.v1', JSON.stringify(st));
    Storage.prototype.setItem = () => {}; // the page notes "screen off" as it unloads; that write must not undo this one
  }, ms);
  await page.reload();
  await main(page).waitFor();
}

/**
 * Tap a button that starts a workout. When the app offers to enter the missing
 * weights first, carry on without: each is then asked for when it comes up.
 */
async function startWith(page, id) {
  await page.getByTestId(id).click();
  await skipWeights(page, id !== 'today-start');
}
async function skipWeights(page, orPick = false) {
  await until(async () => page.url().includes('#workout') || (await page.getByTestId('weights-first').count()) > 0 || (orPick && (await page.getByTestId('today-pick').count()) > 0), 2500);
  if (await page.getByTestId('weights-first').count()) await page.getByTestId('weights-skip').click();
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
  await page.getByText(/movements you want to skip/).waitFor();
  check('coach asks for what is missing (things to skip), and not for fixed days', !/Which days/.test(await page.locator('.chat').textContent()));
  await shot(page, '02-coach');
  await page.fill('#coach-input', 'No deadlifts please.');
  await page.keyboard.press('Enter');
  await page.getByTestId('assumptions').waitFor();
  const facts = await page.getByTestId('assumptions').textContent();
  check('assumptions shown before the plan is built', /Strength/.test(facts) && /3 a week, on any days you like/.test(facts) && /50 min/.test(facts) && /Leaving out/.test(facts)
    && /The next 6 sessions, with rest days between/.test(facts) && /updated after every workout/.test(facts), facts);
  check('no plan exists until the user confirms', (await state(page)).plan === null);
  await shot(page, '03-assumptions');
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();

  // --- plan
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  let st = await state(page);
  check('the plan is a list of sessions with rest days, not tied to weekdays', st.plan.days.map((d) => d.title).join() === 'Upper body A,Lower body A,Full body A,Upper body B,Lower body B,Full body B'
    && st.plan.days.map((d) => d.restAfter).join('') === '112112' && st.plan.days.every((d) => !('weekday' in d)) && st.plan.queue.order.length === 6, JSON.stringify(st.plan.days.map((d) => [d.title, d.restAfter])));
  check('the coach presents it as a proposal you can discuss', /Here is my proposal/.test(await page.evaluate(() => JSON.parse(localStorage.getItem('seria.state.v1')).chat.slice(-1)[0].text)));
  const tl = page.getByTestId('timeline');
  check('the plan reads as train, rest, train', (await tl.getByTestId('plan-session').count()) === 6 && (await tl.getByTestId('rest-gap').count()) === 5
    && /Up next · today/.test(await tl.getByTestId('plan-session').first().textContent()) && /1 rest day/.test(await tl.getByTestId('rest-gap').first().textContent())
    && /2 rest days/.test(await tl.getByTestId('rest-gap').nth(2).textContent()), await tl.textContent());
  check('no numbered weeks or rounds to manage', !/Week 1|Round 1/i.test(await page.locator('main').textContent()) && (await page.getByTestId('train-now').textContent()).trim() === 'Train now');
  check('every session fits the 50 minute budget', st.plan.days.every((d) => d.estMinutes <= 50), st.plan.days.map((d) => d.estMinutes));
  check('skipped lifts are left out', !JSON.stringify(st.plan).includes('deadlift'));
  check('plan records the rules version', st.plan.rulesVersion === RULES_VERSION);
  check('plan shows weekly sets per muscle group against the target', /Target for your level: 10-16 sets/.test(await page.getByTestId('volume').textContent()) && /Back\s*\d+ sets/.test(await page.getByTestId('volume').textContent()));
  check('each session on the list shows what it is, when it falls and how long it takes', /Lower body A/.test(await tl.getByTestId('plan-session').nth(1).textContent()) && /\d+ min/.test(await tl.getByTestId('plan-session').nth(1).textContent()));
  const view = await page.getByTestId('outlook').textContent();
  check('the plan comes with the long view: how the training develops from here', /This round/.test(view) && /6 sessions over about 2 weeks, 3 a week/.test(view) && /How it gets harder/.test(view)
    && /Round after round/.test(view) && /When it stalls/.test(view) && /Room to add/.test(view), view.slice(0, 300));
  await shot(page, '04-plan');

  // --- the weights you lift, entered up front
  await page.getByTestId('weights-link').click();
  await page.getByRole('heading', { name: 'What you lift now' }).waitFor();
  check('every exercise in the plan can get its weight before the first workout', /have no weight yet/.test(await page.getByTestId('weights-blank').textContent()) && (await page.getByTestId('weight-row').count()) >= 10);
  await page.fill('#w-goblet_squat', '24');
  await until(async () => (await state(page)).weights.goblet_squat?.value === 24);
  st = await state(page);
  check('a weight typed there goes into the plan wherever the exercise is', st.plan.days.flatMap((d) => d.exercises).filter((x) => x.exerciseId === 'goblet_squat').every((x) => x.load && x.load.value === 24));
  await page.getByTestId('weight-row').filter({ hasText: 'Goblet squat' }).getByRole('button', { name: /Step/ }).click();
  await page.getByTestId('weight-step-other').click();
  await page.fill('#weight-step-value', '1.25');
  await page.getByTestId('weight-save').click();
  check('the smallest step can be any number', await until(async () => { const x = await state(page); return x.weights.goblet_squat.step === 1.25 && x.plan.days.flatMap((d) => d.exercises).find((e) => e.exerciseId === 'goblet_squat').load.step === 1.25; }));
  await shot(page, '35-weights');
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();

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
  await page.fill('#gym-text', "It's these machines from Technogym: chest press and the glute machine.");
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-machines').waitFor();
  st = await state(page);
  check('with no model connected, a named maker is noted on its machines', st.equipment.details.chest_press.vendor === 'Technogym' && st.equipment.details.chest_press.basis === 'stated'
    && /Technogym · Chest press machine · maker noted/.test(await page.getByTestId('gym-machines').textContent()) && /Connect Claude or OpenAI/.test(await page.getByTestId('gym-machines').textContent()), await page.getByTestId('gym-machines').textContent());
  await page.getByRole('button', { name: /^Leg curl/ }).click(); // picking from the list still works
  await page.fill('#custom-name', 'Belt squat');
  await page.selectOption('#custom-pattern', 'squat');
  await page.getByRole('button', { name: 'Add my machine' }).click(); // adding your own machine by hand closes the sheet
  await page.getByRole('switch', { name: /Barbell and plates/ }).click(); // back on: the plan built above uses it
  check('added machines are listed as available', (await page.getByTestId('machine').count()) === 7 && (await page.getByTestId('machine').first().textContent()).includes('Available'));
  st = await state(page);
  check('free weights, bench and pull-up bar need no entry (on by default)', !('dumbbells' in st.equipment.items) && !('barbell' in st.equipment.items) && st.equipment.items.lat_pulldown === true);
  check('equipment rows carry a sketch each', (await page.locator('main svg.sketch').count()) === 11 && (await page.locator('[data-testid=machine] svg.sketch').first().getAttribute('data-sketch')) === 'lat_pulldown'
    && (await page.locator('[data-testid=machine]').filter({ hasText: 'Glute drive' }).locator('svg.sketch').getAttribute('data-sketch')) === 'glute');
  await shot(page, '05-equipment');
  const liftsBefore = (await state(page)).plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)).join();
  await page.getByRole('switch', { name: /Pull-up bar/ }).click();
  await tab(page, 'Plan').click();
  await page.getByTestId('last-update').waitFor();
  const pulls = (x) => x.plan.days.flatMap((d) => d.exercises).filter((e) => e.exerciseId === 'pull_up').length;
  const lifts = (x) => x.plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)).join();
  check('lost equipment: the plan swaps what can no longer be done at once, and says so', pulls(await state(page)) === 0 && lifts(await state(page)) !== liftsBefore && /Your equipment list changed\. \d exercises? swapped/.test(await page.getByTestId('last-update').textContent()), await page.getByTestId('last-update').textContent());
  await page.getByTestId('see-changes').click();
  const swap = page.getByTestId('change').first();
  await swap.waitFor();
  check('each change shows the old value, the new value, the reason, and that it is in the plan', /Pull-up → Lat pulldown/.test(await swap.textContent()) && /not available any more/.test(await swap.textContent()) && /In the plan/.test(await swap.textContent()), await swap.textContent());
  await shot(page, '36-what-changed');
  const nSwaps = await page.getByTestId('change').count();
  for (let i = 0; i < nSwaps; i++) { await page.getByTestId('change-undo').first().click(); await until(async () => (await page.getByTestId('change-undo').count()) === nSwaps - i - 1); }
  check('"Undo" puts back what was there', lifts(await state(page)) === liftsBefore && pulls(await state(page)) >= 1 && (await page.locator('[data-testid=change][data-status=undone]').count()) === nSwaps, lifts(await state(page)));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText(/equipment you no longer have/).waitFor();
  check('an undone swap is not forced back in; the plan offers it instead', (await page.getByTestId('swap-broken').count()) === 1 && lifts(await state(page)) === liftsBefore);
  await tab(page, 'Equipment').click();
  await page.getByRole('switch', { name: /Pull-up bar/ }).click();

  // --- day preview
  await tab(page, 'Plan').click();
  await openSession(page, 'Upper body A');
  const dayText = await page.locator('main').textContent();
  check('day preview: order, equipment, sets, reps, rest, how to pick the weight, time parts',
    /1\. Dumbbell bench press/.test(dayText) && /Dumbbells, Bench/.test(dayText) && /\d × \d+ reps/.test(dayText) && /rest 3:00 min/.test(dayText) && /You pick it in the first session/.test(dayText) && /warm-up 8, sets \d+, rests \d+, moving between stations \d+/.test(dayText), dayText.slice(0, 300));
  check('each exercise in the preview has a sketch of its equipment', (await page.locator('main > ol svg.sketch').count()) === 4 && (await page.locator('main svg.sketch').first().getAttribute('data-sketch')) === 'dumbbells'
    && (await page.locator('main svg.sketch').nth(1).getAttribute('data-sketch')) === 'barbell' && (await page.locator('main svg.sketch').first().getAttribute('aria-hidden')) === 'true');
  await shot(page, '06-day');

  // --- workout: starting weight, set, result, rest
  await startWith(page, 'start-day');
  await main(page).waitFor();
  check('workout has its own screen without the tab bar', (await page.getByRole('navigation', { name: 'Main' }).count()) === 0);
  check('a new exercise starts with a sketch of what to look for', (await page.getByTestId('sketch').locator('svg').getAttribute('data-sketch')) === 'dumbbells' && /General look of a dumbbell\. Yours may differ/.test(await page.getByTestId('sketch-note').textContent()));
  check('no history: asks for a starting weight first', (await main(page).textContent()).trim() === 'Save starting weight' && await page.getByText('Choose your starting weight').isVisible());
  await shot(page, '07-starting-weight');
  await page.fill('#start-weight', '20'); await sleep(120);
  await tap(page);
  check('starting weight is saved and shown per dumbbell', (await page.getByTestId('target-load').textContent()).trim() === '20 kg' && (await state(page)).weights.db_bench_press.value === 20);
  const target = Number(await page.getByTestId('target-reps').textContent());
  const v0 = (await state(page)).plan.version;
  check('before the set: what to aim for, in words', new RegExp(`Stop at ${target}`).test(await page.getByTestId('effort').textContent()) && /last set is the one to push/.test(await page.getByTestId('effort').textContent()), await page.getByTestId('effort').textContent());
  await tap(page);
  check('"Start set" shows the active set', (await phase(page)) === 'active' && (await main(page).textContent()).trim() === 'Finish set' && Number(await page.getByTestId('draft-reps').textContent()) === target);
  check('the sketch stays on the training screen during the set', await page.getByTestId('sketch').locator('svg[data-sketch=dumbbells]').isVisible());
  await page.getByRole('button', { name: '1 rep fewer' }).click();
  check('reps can be nudged by one while the set runs', await until(async () => Number(await page.getByTestId('draft-reps').textContent()) === target - 1));
  await shot(page, '08-set-active');
  const t0 = Date.now();
  await tap(page);
  st = await state(page);
  check('one tap on "Finish set" saves the set and starts the rest', (await phase(page)) === 'rest' && Date.now() - t0 < 1500 && st.sessions[0].exercises[0].sets[0].actual.reps === target - 1 && st.sessions[0].exercises[0].sets[0].actual.load === 20);
  check('the sketch stays during the rest too', await page.getByTestId('sketch').locator('svg[data-sketch=dumbbells]').isVisible() && (await page.getByTestId('sketch-note').count()) === 0);
  const restSec = st.sessions[0].exercises[0].restSec;
  const shown = secs(await page.getByTestId('rest-timer').textContent());
  check('countdown starts from the planned rest', shown <= restSec && shown >= restSec - 3, `${shown} vs ${restSec}`);
  const lastSet = page.getByTestId('last-set');
  check('the set just saved stays in reach: reps, weight, reps left, undo', Number(await page.getByTestId('last-reps').textContent()) === target - 1 && (await lastSet.getByTestId('undo').count()) === 1
    && /Change weight/.test(await lastSet.textContent()) && (await main(page).textContent()).trim() === 'Start next set now');
  const hint = page.getByTestId('hint');
  await hint.waitFor();
  check('a missed set changes the sets to come at once, with the reason and an Undo', /Changed for the sets to come/.test(await hint.textContent()) && /Weight: 20 kg → 18 kg/.test(await hint.textContent()) && /close to failure/.test(await hint.textContent())
    && (await page.getByTestId('hint-undo').count()) === 1 && (await page.getByTestId('target-load').textContent()).trim() === '18 kg', await hint.textContent());
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
  await page.getByTestId('hint-undo').click();
  check('"Undo" on the change puts the sets to come back to the plan', await until(async () => (await page.getByTestId('hint').count()) === 0) && (await page.getByTestId('target-load').textContent()).trim() === '20 kg' && (await state(page)).sessions[0].exercises[0].sets[0].actual.load === 20);

  // --- nudging and undoing the set just saved
  await lastSet.getByRole('button', { name: '1 rep more' }).click();
  check('during the rest the set just saved can still be nudged by a rep', await until(async () => (await state(page)).sessions[0].exercises[0].sets[0].actual.reps === target) && Number(await page.getByTestId('last-reps').textContent()) === target && (await page.getByTestId('hint').count()) === 0);
  await lastSet.getByRole('button', { name: '1 rep fewer' }).click();
  await page.getByTestId('hint').waitFor();
  check('and the change for the sets to come is worked out again from the corrected set', (await page.getByTestId('target-load').textContent()).trim() === '18 kg');
  await page.getByTestId('undo').click();
  st = await state(page);
  check('"Undo" opens the set again, as it was when it was finished', (await phase(page)) === 'active' && st.sessions[0].exercises[0].sets[0].status === 'pending' && st.sessions[0].exercises[0].sets[1].target.load === 20
    && Number(await page.getByTestId('draft-reps').textContent()) === target - 1);
  await tap(page);
  await page.getByTestId('hint').waitFor();
  check('the main button during a rest starts the next set early', (await main(page).textContent()).trim() === 'Start next set now');
  await tap(page);
  check('and doing so cuts the rest short', (await phase(page)) === 'active' && (await state(page)).sessions[0].rest === null);
  await page.getByRole('button', { name: 'Not doing it yet' }).click();
  check('a set started too early can be put down again', (await phase(page)) === 'ready' && (await state(page)).sessions[0].exercises[0].sets[1].status === 'pending');

  // --- weight change, reps in reserve, correcting a set
  await tap(page); await tap(page);
  await lastSet.getByRole('button', { name: 'Change weight' }).click();
  await lastSet.getByRole('button', { name: 'More weight' }).click();
  check('weight can be changed after the set', await until(async () => Number(await page.inputValue('#load-done')) === 20));
  await lastSet.getByRole('button', { name: 'Less weight' }).click();
  await until(async () => Number(await page.inputValue('#load-done')) === 18);
  await lastSet.getByRole('button', { name: '2 reps left in the tank' }).click();
  await until(async () => (await state(page)).sessions[0].exercises[0].sets[1].actual.rir === 2);
  st = await state(page);
  check('reps in reserve is optional and saved when given', st.sessions[0].exercises[0].sets[0].actual.rir === null && st.sessions[0].exercises[0].sets[1].actual.rir === 2 && st.sessions[0].exercises[0].sets[1].actual.load === 18);
  await page.getByRole('button', { name: /^Set 1:/ }).click();
  await page.fill('#edit-reps', String(target));
  await page.getByRole('button', { name: 'Save correction' }).click();
  check('a wrong entry can be corrected during the workout', (await state(page)).sessions[0].exercises[0].sets[0].actual.reps === target);

  // --- the rest runs out: the next set starts by itself
  await restEndsIn(page, 1200);
  check('when the rest runs out the next set starts by itself', await until(async () => (await phase(page)) === 'active', 6000) && /started by itself/.test(await page.getByTestId('set-clock').textContent())
    && (await state(page)).sessions[0].exercises[0].sets[2].auto === true, await phase(page));
  await sleep(1100);
  await page.getByTestId('start-now').click();
  st = await state(page);
  check('"Start now" resets the clock of a set that began before you did', st.sessions[0].exercises[0].sets[2].auto === false && st.sessions[0].log.some((e) => e[1] === 'set_restart') && !/started by itself/.test(await page.getByTestId('set-clock').textContent()));
  const logged = [...new Set(st.sessions[0].log.map((e) => e[1]))];
  check('every tap is written to the log with its time', ['start', 'weight', 'set_start', 'adjust', 'set_finish', 'rest_start', 'hint_apply', 'hint_undo', 'undo', 'set_cancel', 'rest_extend', 'edit', 'set_restart'].every((t) => logged.includes(t))
    && st.sessions[0].log.every((e) => typeof e[0] === 'number'), logged.join());

  // --- finish exercise 1, next exercise, busy machine, later, overview, skip, drop
  await runWorkout(page, { stop: async () => (await state(page)).sessions[0].cursor.ex === 1 });
  check('the next exercise comes with its own sketch', (await page.getByTestId('sketch').locator('svg').getAttribute('data-sketch')) === 'barbell' && /General look of a barbell/.test(await page.getByTestId('sketch-note').textContent()));
  check('after the last set the screen shows the next exercise', (await page.locator('.eyebrow').first().textContent()) === 'Next exercise' && (await page.getByTestId('exercise-name').textContent()) !== 'Dumbbell bench press' && (await page.getByTestId('progress').textContent()).includes('Exercise 2 of'));
  const before = await page.getByTestId('exercise-name').textContent();
  await page.getByTestId('busy').click();
  const sheetText = await page.locator('.sheet').textContent();
  check('"Machine busy? Not now" offers to come back later, another exercise, or dropping it', /Come back to it later/.test(sheetText) && /Same movement/.test(sheetText) && /Drop it for today/.test(sheetText), sheetText.slice(0, 300));
  await shot(page, '11-swap');
  await page.locator('.sheet button.row').first().click();
  const swapped = await page.getByTestId('exercise-name').textContent();
  check('a busy station can be swapped for another exercise on available equipment', swapped !== before && (await page.locator('main').textContent()).includes(`swapped in for ${before}`), `${before} -> ${swapped}`);
  await page.getByTestId('busy').click();
  await page.getByTestId('later').click();
  st = await state(page);
  check('"Come back to it later" brings up the next exercise and keeps this one for the end', (await page.getByTestId('exercise-name').textContent()) !== swapped && st.sessions[0].exercises[3].name === swapped && st.sessions[0].exercises[3].postponed === 1
    && (await page.getByTestId('progress').textContent()).includes('Exercise 2 of 4'), st.sessions[0].exercises.map((x) => x.name).join());
  await page.getByTestId('progress').click();
  const rows = page.getByTestId('overview').locator('button.row');
  check('the header opens the whole workout: every exercise and where it stands', (await rows.count()) === 4 && /Done/.test(await rows.nth(0).textContent()) && /Now/.test(await rows.nth(1).textContent())
    && /To do/.test(await rows.nth(2).textContent()) && /Later/.test(await rows.nth(3).textContent()), await page.getByTestId('overview').textContent());
  await shot(page, '37-overview');
  await rows.nth(3).click();
  check('tapping an exercise there goes to it', await until(async () => (await page.getByTestId('exercise-name').textContent()) === swapped) && (await state(page)).sessions[0].cursor.ex === 3);
  await runWorkout(page, { stop: async () => { const w = (await state(page)).sessions[0]; return w.cursor.ex === 3 && w.cursor.set === 1 && w.phase === 'rest'; } });
  await page.getByRole('button', { name: 'Skip set' }).click();
  check('a set can be skipped', (await state(page)).sessions[0].exercises[3].sets[1].status === 'skipped');
  await runWorkout(page, { stop: async () => (await state(page)).sessions[0].cursor.ex !== 3 });
  const dropName = await page.getByTestId('exercise-name').textContent();
  await page.getByTestId('busy').click();
  await page.getByTestId('drop').click();
  st = await state(page);
  check('"Drop it for today" leaves the exercise out', st.sessions[0].exercises[1].name === dropName && st.sessions[0].exercises[1].dropped === true && st.sessions[0].exercises[1].sets.every((x) => x.status === 'skipped')
    && (await page.getByTestId('exercise-name').textContent()) !== dropName);
  await runWorkout(page);

  // --- summary: what happened, and what it changed in the plan
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  st = await state(page);
  const s0 = st.sessions[0];
  const total = s0.exercises.reduce((n, x) => n + x.sets.length, 0);
  const doneSets = s0.exercises.reduce((n, x) => n + x.sets.filter((y) => y.status === 'done').length, 0);
  check('summary: time, sets done of total, skipped sets, biggest differences',
    (await page.getByTestId('sum-sets').textContent()).trim() === `${doneSets} / ${total}` && doneSets < total && /\d+ min/.test(await page.getByTestId('sum-minutes').textContent()) && /Biggest differences/.test(await page.locator('main').textContent()) && /skipped/.test(await page.locator('main').textContent()));
  check('session is stored set by set with plan and result', s0.status === 'done' && s0.exercises[0].sets.every((x) => x.planned && x.actual) && s0.planVersion === v0 && s0.exercises[3].swappedFrom.name === before);
  check('weights chosen in the session are written into the plan', st.plan.days[0].exercises[0].load.value === 20);
  const upd = st.proposals.find((p) => p.sessionId === s0.id);
  check('the summary says in words how it went and what changes', !!upd && /sets done in \d+ min/.test(await page.getByTestId('update-message').textContent()) && /From the training rules/.test(await page.getByTestId('summary-source').textContent()), await page.getByTestId('coach-summary').textContent());
  const cards = page.getByTestId('coach-summary').getByTestId('change');
  check('the plan is already updated: each change is in, with its reason, and nothing waits to be accepted', upd.changes.length >= 1 && upd.changes.every((c) => c.status === 'applied') && st.plan.version > v0
    && (await cards.count()) === upd.changes.length && /→/.test(await cards.first().textContent()) && /In the plan/.test(await cards.first().textContent()) && (await page.getByRole('button', { name: 'Apply', exact: true }).count()) === 0, JSON.stringify(upd.changes.map((c) => [c.exerciseName, c.field, c.status])));
  check('rests are compared with the plan', /Rests between sets: .+ on average, .+ planned/.test(await page.getByTestId('rest-stats').textContent()));
  const logText = await page.getByTestId('session-log').textContent();
  check('every step of the workout is kept, with its time', /Workout started/.test(logText) && /started by itself/.test(logText) && /put off until later/.test(logText) && /dropped for today/.test(logText) && /Workout ended/.test(logText), logText.slice(0, 200));
  await shot(page, '12-summary');
  const c0 = upd.changes[0];
  const planValue = async () => {
    const x = (await state(page)).plan.days.flatMap((d) => d.exercises).find((e) => (c0.exerciseKey ? e.key === c0.exerciseKey : e.exerciseId === c0.exerciseId));
    return c0.field === 'load' ? x.load.value : c0.field === 'reps' ? x.reps : c0.field === 'sets' ? x.sets : x.restSec;
  };
  const planBefore = JSON.stringify(s0.exercises.map((x) => x.sets.map((y) => y.planned)));
  await cards.first().getByTestId('change-undo').click();
  check('"Undo" takes a change back out of the plan', await until(async () => (await planValue()) !== c0.value) && /Undone/.test(await cards.first().textContent()), `${await planValue()} vs ${c0.value}`);
  await cards.first().getByTestId('change-redo').click();
  check('and it can be made again', await until(async () => (await planValue()) === c0.value) && /In the plan/.test(await cards.first().textContent()));
  await cards.first().getByTestId('change-edit').click();
  await page.fill('#change-value', String(c0.value + 1));
  await page.getByTestId('change-save').click();
  check('"Edit" puts in a number typed by hand instead', await until(async () => (await planValue()) === c0.value + 1) && /Corrected by you/.test(await cards.first().textContent()), `${await planValue()} vs ${c0.value + 1}`);
  await shot(page, '13-proposals');
  st = await state(page);
  check('the stored session keeps the plan it was done against', JSON.stringify(st.sessions[0].exercises.map((x) => x.sets.map((y) => y.planned))) === planBefore);
  await page.getByTestId('to-plan').click();
  await page.getByTestId('see-changes').click();
  await page.getByRole('heading', { name: 'Updates to your plan' }).waitFor();
  const listText = await page.locator('main').textContent();
  check('every update to the plan is listed, with where it came from', (await page.getByTestId('update').count()) >= 2 && /After your workout/.test(listText) && /Your equipment changed/.test(listText) && /From the training rules/.test(listText));
  await page.getByRole('button', { name: 'Done' }).click();

  // --- history and correction
  await tab(page, 'History').click();
  await page.getByRole('heading', { name: '1 workout' }).waitFor();
  check('history lists the workout', /1 workout/.test(await page.locator('main').textContent()) && (await page.locator('main button.row').count()) === 1);
  await shot(page, '14-history');
  await page.locator('main button.row').first().click();
  await page.getByTestId('session-exercise').first().getByRole('button', { name: /Set 3/ }).click();
  await page.fill('#edit-reps', '3');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await page.getByText('Corrected by hand').first().waitFor();
  st = await state(page);
  check('a saved set can be corrected later from history', st.sessions[0].exercises[0].sets[2].actual.reps === 3);
  const again = st.proposals.filter((p) => p.sessionId === s0.id);
  check('and for the latest workout the plan is worked out again from the corrected numbers', again.length === 1 && again[0].id !== upd.id && again[0].changes.every((c) => c.status === 'applied') && again[0].message.length > 20
    && (await page.getByTestId('coach-summary').count()) === 1, JSON.stringify(again.map((u) => [u.id, u.message])));
  await shot(page, '15-session-detail');

  // --- the plan moves on: train on any day
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  st = await state(page);
  const onList = page.getByTestId('timeline').getByTestId('plan-session');
  check('a full cycle stays on show: the finished session moves to the end, the next one is planned after the rest day', st.plan.queue.done.join() === 'd1' && (await onList.count()) === 6
    && /Up next · planned for/.test(await onList.first().textContent()) && /Lower body A/.test(await onList.first().textContent())
    && /Upper body A/.test(await onList.last().textContent()) && /done this round/.test(await onList.last().textContent()) && (await page.getByTestId('next-round').count()) === 1, await page.getByTestId('timeline').textContent());
  await shot(page, '29-plan-after-workout');
  await startWith(page, 'train-now');
  await page.getByTestId('today-pick').waitFor();
  let pickText = await page.getByTestId('today-pick').textContent();
  check('"Train now" on an unplanned day shows what makes sense and why, before anything starts', /Lower body A/.test(pickText) && /2 days earlier than planned\. These muscles are rested/.test(pickText)
    && /From the training rules/.test(pickText) && (await state(page)).activeSessionId === null, pickText);
  check('and how the rest of the plan follows', /1 rest day, then Full body A/.test(await page.getByTestId('today-then').textContent()), await page.getByTestId('today-then').textContent());
  await shot(page, '30-train-now');
  await page.getByTestId('today-other').click();
  check('any other session can be picked instead', (await page.locator('.sheet button.row').count()) === 4);
  await page.getByRole('button', { name: 'Not today' }).click();

  await daysPass(page, 2); // now it is the planned day
  check('on the planned day the plan says "today"', /Up next · today/.test(await page.getByTestId('plan-session').first().textContent()));
  await startWith(page, 'train-now');
  await main(page).waitFor();
  check('and "Train now" simply starts the next session', (await page.getByTestId('exercise-name').textContent()) === 'Goblet squat' && (await state(page)).sessions.slice(-1)[0].title === 'Lower body A');
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.getByTestId('train-now').waitFor();
  check('a discarded workout leaves the plan as it was', (await state(page)).plan.queue.done.join() === 'd1' && (await state(page)).sessions.length === 1);

  // --- something else than the gym: a hard run today
  await page.getByTestId('log-activity').click();
  await page.getByTestId('act-run').click();
  await page.fill('#act-minutes', '45');
  await page.getByTestId('effort-hard').click();
  check('another activity is logged by what it was, how long and how hard; the sheet says what it means', /Counts as work for quads, hamstrings and glutes and calves/.test(await page.getByTestId('act-effect').textContent()), await page.getByTestId('act-effect').textContent());
  await shot(page, '34-activity');
  await page.getByTestId('act-save').click();
  await page.getByTestId('recent-activity').waitFor();
  st = await state(page);
  const run = st.sessions.find((x) => x.kind === 'activity');
  check('it is kept with the workouts', !!run && run.minutes === 45 && run.effort === 'hard' && run.status === 'done' && run.exercises.length === 0 && /Run today: 45 min, hard/.test(await page.getByTestId('recent-activity').textContent()));
  check('the plan takes it into account at once: the legs wait, and the plan says why', /Upper body B/.test(await onList.first().textContent()) && /Your run .* worked quads/.test(await page.getByTestId('up-next-reason').textContent())
    && /Logged: 45 min run, hard effort/.test(await page.getByTestId('last-update').textContent()), await page.getByTestId('up-next-reason').textContent());
  await shot(page, '34b-plan-after-run');
  await tab(page, 'History').click();
  await page.getByTestId('history-activity').waitFor();
  check('history shows it next to the workouts, without counting it as one', /1 workout/.test(await page.locator('main h2').textContent()) && /1 other activity/.test(await page.locator('main h2').textContent()));
  await page.getByTestId('history-activity').click();
  await page.getByRole('button', { name: 'Delete this activity' }).click();
  await page.getByRole('button', { name: 'Yes, delete it for good' }).click();
  await until(async () => (await state(page)).sessions.length === 1);
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  check('deleting it puts the plan back in order', (await state(page)).sessions.length === 1 && /Lower body A/.test(await onList.first().textContent()) && (await page.getByTestId('recent-activity').count()) === 0);

  // skip a session, and bring it back
  await openSession(page, 'Full body A');
  await page.getByTestId('skip-session').click();
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  const comeRound = page.getByTestId('timeline').locator('[data-testid=plan-session][data-again="1"]');
  check('a session can be skipped; it waits at the end for the next round', (await comeRound.count()) === 2 && /skipped this round/.test(await comeRound.filter({ hasText: 'Full body A' }).textContent()) && /done this round/.test(await comeRound.filter({ hasText: 'Upper body A' }).textContent())
    && (await onList.count()) === 6, await page.getByTestId('timeline').textContent());
  await comeRound.filter({ hasText: 'Full body A' }).click();
  await page.getByTestId('unskip-session').click();
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  check('and brought back', (await comeRound.count()) === 1 && (await onList.count()) === 6);

  await daysPass(page, 10); // twelve days since the last workout
  await startWith(page, 'train-now');
  await page.getByTestId('today-pick').waitFor();
  pickText = await page.getByTestId('today-pick').textContent();
  check('after a long break the plan says so and offers a lighter session', /12 days since your last workout\. Loads are 10% lighter/.test(pickText) && (await page.getByTestId('ease').getAttribute('aria-checked')) === 'true', pickText);
  await page.getByTestId('today-other').click();
  await page.locator('.sheet button.row').filter({ hasText: 'Upper body B' }).click();
  await skipWeights(page);
  await main(page).waitFor();
  st = await state(page);
  check('a hand-picked session starts, lighter today, and goes to the front of the plan', (await page.getByTestId('exercise-name').textContent()) === 'Dumbbell bench press' && (await page.getByTestId('target-load').textContent()).trim() === '18 kg'
    && /10% lighter today/.test(await page.getByTestId('eased').textContent()) && st.plan.queue.order[0] === 'd4' && st.plan.days[3].exercises[0].load.value === 20, JSON.stringify(st.plan.queue));
  await shot(page, '31-eased');
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.getByTestId('train-now').waitFor();
  await openSession(page, 'Upper body B');
  check('session preview shows the recorded weight', /kg per dumbbell/.test(await page.locator('main').textContent()));
  await page.getByTestId('edit-weight').first().click();
  await page.fill('#weight-value', '21');
  await page.getByTestId('weight-save').click();
  check('a weight in the plan can be set by hand from the session preview', await until(async () => (await state(page)).plan.days[3].exercises[0].load.value === 21) && (await state(page)).weights.db_bench_press.by === 'hand');

  // --- settings for the workout, then backup, erase, restore
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  check('settings: the next set can start by itself, and there is a word on signals with the screen off', (await page.locator('#pref-autostart').getAttribute('aria-checked')) === 'true'
    && ((await page.locator('#pref-notify').count()) + (await page.getByTestId('notify-unavailable').count())) === 1 && /With the screen off a web page is not allowed to vibrate/.test(await page.locator('main').textContent()));
  await page.getByTestId('test-signal').click();
  check('"Test the signal" plays it and says what to expect', /sound and the buzz/.test(await page.getByTestId('signal-result').textContent()));
  await shot(page, '38-settings-workout');
  const vKeep = (await state(page)).plan.version;
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const file = join(tmpdir(), `seria-smoke-${Date.now()}.json`);
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  check('backup file holds plan and history and no API key', backup.app === 'seria' && backup.state.sessions.length === 1 && !/apiKey|sk-ant/.test(JSON.stringify(backup)));
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByTestId('confirm-reset').click();
  check('erase clears plan and history', (await state(page)).plan === null && (await state(page)).sessions.length === 0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.setInputFiles('#import-file', file);
  await page.getByText('Backup restored').waitFor();
  check('restore brings them back', (await state(page)).plan.version === vKeep && (await state(page)).sessions.length === 1 && (await state(page)).proposals.length >= 2);
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
  check('"Test the connection" gets an answer', /Claude answered: “Hello from the model”/.test(await page.getByTestId('test-result').textContent()));
  await shot(page, '17-claude-connected');
  const r = api.state.requests[0];
  check('request: key, browser-access and version headers, as the official SDK sends them', r.headers.authorization === 'Bearer sk-ant-test-key' && r.headers['anthropic-dangerous-direct-browser-access'] === 'true' && !!r.headers['anthropic-version'] && /^1\./.test(r.headers['x-stainless-package-version']), JSON.stringify(r.headers));
  check('request: model, structured output, effort, cached system prompt', r.body.model === 'claude-opus-5-5' && r.body.output_config.format.type === 'json_schema' && r.body.output_config.effort === 'low' && r.body.system[0].cache_control.type === 'ephemeral' && r.body.max_tokens === 4000, JSON.stringify(r.body.output_config).slice(0, 200));
  check('request: refusal fallback is switched on', r.body.fallbacks === 'default' && String(r.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') && r.path === '/v1/messages', `${r.path} ${r.headers['anthropic-beta']}`);
  check('request: no thinking or sampling parameters the model would reject', !('thinking' in r.body) && !('temperature' in r.body) && !('tool_choice' in r.body));
  check('request: system prompt carries the rules library and its version', r.body.system[0].text.includes(`Training rules library, version ${RULES_VERSION}`));
  check('the key is kept apart from the app data', !/sk-ant/.test(await page.evaluate(() => localStorage.getItem('seria.state.v1') || '')));

  let before = api.state.requests.length;
  api.state.cutOffOnce = true;
  await page.getByTestId('test-claude').click();
  await until(() => api.state.requests.length === before + 2);
  check('an answer cut off for lack of room is asked for once more with twice as much', api.state.requests[before].body.max_tokens === 4000 && api.state.requests[before + 1].body.max_tokens === 8000 && await until(async () => /Claude answered/.test(await page.getByTestId('test-result').textContent())));
  api.state.fail = 429;
  await page.getByTestId('test-claude').click();
  await page.getByText(/over a limit/).waitFor();
  check("a 429 from Claude is shown in Claude's own words", /rate limit of 8,000 output tokens per minute/.test(await page.getByTestId('test-result').textContent()));
  api.state.fail = null;

  await tab(page, 'Coach').click();
  await say(page, 'Strength, a year in, three days a week, 50 minutes. Skip deadlifts, I love pull-ups.');
  await page.getByTestId('assumptions').waitFor();
  let st = await state(page);
  check('Claude fills the profile; unknown exercise ids are dropped', st.profile.goal === 'strength' && st.profile.avoid.join() === 'bb_deadlift' && st.profile.include.join() === 'pull_up');
  check('the reply is marked as coming from Claude', (await page.locator('.bubble .via').first().textContent()) === 'Claude');
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  st = await state(page);
  check('plan built by Claude, cleaned against the catalog', st.plan.source === 'claude' && st.plan.days.length === 3 && !JSON.stringify(st.plan).includes('ghost_lift') && st.plan.days.every((d) => d.estMinutes <= 50));
  check('plan screen says who built it', /Built by Claude/.test(await page.locator('main').textContent()));
  check('optional extras: the model\'s pick is kept after a check against the catalog; sessions it left empty are filled by the rules',
    st.plan.days[0].optional.map((o) => o.exerciseId).join() === 'hammer_curl' && /^Test double/.test(st.plan.days[0].optional[0].why) && st.plan.days.slice(1).every((d) => d.optional.length >= 1) && !JSON.stringify(st.plan).includes('ghost_extra'),
    JSON.stringify(st.plan.days.map((d) => d.optional.map((o) => o.exerciseId))));

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

  // naming the maker: the exact machines are identified, then looked up on the web
  await page.fill('#gym-text', 'These are from Technogym: leg press and chest press.');
  await page.getByTestId('read-gym').click();
  await page.getByText(/Looking up 2 machines on the web/).waitFor({ timeout: 5000 }).catch(() => {});
  await page.getByTestId('gym-machines').waitFor();
  st = await state(page);
  const lookups = api.state.requests.filter((x) => (x.body.tools || []).length);
  check('named machines are looked up with Claude\'s web search, and a paused search is carried on', lookups.length === 2 && lookups[0].body.tools[0].type === 'web_search_20260209' && lookups[1].body.messages.length === 2
    && /look up gym machines/.test(lookups[0].body.system) && JSON.parse(lookups[0].body.messages[0].content).machines.map((m) => `${m.ref}:${m.vendor}`).join() === 'leg_press:Technogym,chest_press:Technogym', JSON.stringify(lookups.map((x) => x.body.tools)));
  check('a machine found on the web is saved with how it works, what it isolates and its source', st.equipment.details.leg_press.basis === 'web' && st.equipment.details.leg_press.source === 'https://maker.example/products/leg_press'
    && /push the platform away/.test(st.equipment.details.leg_press.how) && /Quadriceps first/.test(st.equipment.details.leg_press.isolates) && st.equipment.details.leg_press.model === 'Selection 900 Leg Press', JSON.stringify(st.equipment.details.leg_press));
  check('a source address the search never returned is not accepted; that machine stays "from memory"', st.equipment.details.chest_press.basis === 'memory' && !st.equipment.details.chest_press.source && /From memory/.test(st.equipment.details.chest_press.how));
  check('nothing is saved for machines nobody named', Object.keys(st.equipment.details).sort().join() === 'chest_press,leg_press' && !('smith' in st.equipment.items));
  const idd = await page.getByTestId('gym-machines').textContent();
  check('the result says which machines were identified and how sure that is', /Technogym Selection 900 Leg Press · Leg press · found on maker\.example/.test(idd) && /Technogym Selection 900 Chest Press · Chest press machine · from the model's memory, not checked/.test(idd), idd);
  await shot(page, '17c-machines-identified');
  await page.getByRole('button', { name: 'Done' }).click();
  const info = page.getByTestId('machine-info').first();
  await info.locator('summary').click();
  check('the equipment list shows the exact machine and links to its page', /Technogym Selection 900 Leg Press/.test(await info.textContent()) && /Isolates: Quadriceps first/.test(await info.textContent()) && /Found on maker\.example/.test(await info.textContent()) && (await info.locator('a').getAttribute('href')) === 'https://maker.example/products/leg_press');
  await shot(page, '17d-machine-info');
  api.state.failLookup = true;
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'From Technogym: chest press');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor();
  check('if the web search fails the machines are still saved, marked as not checked', /web lookup did not work/.test(await page.getByTestId('gym-result').textContent()) && (await state(page)).equipment.details.chest_press.basis === 'memory');
  api.state.failLookup = false;
  await page.getByRole('button', { name: 'Done' }).click();
  await tab(page, 'Plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();

  // in-session: rules at once, Claude a moment later
  api.state.delayMs = 900;
  await startWith(page, 'train-now'); // the first session of the plan: nothing to review, it starts
  await main(page).waitFor();
  await page.fill('#start-weight', '20'); await sleep(120); await tap(page);
  await tap(page);
  await page.getByRole('button', { name: '1 rep fewer' }).click(); await page.getByRole('button', { name: '1 rep fewer' }).click();
  const tSave = Date.now();
  await tap(page);
  check('saving does not wait for Claude', (await phase(page)) === 'rest' && Date.now() - tSave < 700, `${Date.now() - tSave} ms`);
  check('the rule-based change is made first', /From the training rules/.test(await page.getByTestId('hint').textContent()) && (await page.getByTestId('target-load').textContent()).trim() === '18 kg', await page.getByTestId('hint').textContent());
  await page.getByText('From Claude').waitFor({ timeout: 5000 });
  check("Claude's change takes its place when it arrives in time", /Weight: 20 kg → 16 kg/.test(await page.getByTestId('hint').textContent()) && (await page.getByTestId('target-load').textContent()).trim() === '16 kg', await page.getByTestId('hint').textContent());
  await shot(page, '18-claude-hint');
  await page.getByTestId('hint-undo').click();
  check('"Undo" goes back to the plan, not to the change before', await until(async () => (await page.getByTestId('hint').count()) === 0) && (await page.getByTestId('target-load').textContent()).trim() === '20 kg');

  // late answer: by the time it lands the sets it talks about are done
  api.state.delayMs = 2500;
  await tap(page); // start the next set now
  await page.getByRole('button', { name: '1 rep fewer' }).click(); await page.getByRole('button', { name: '1 rep fewer' }).click();
  await tap(page);
  await tap(page); await tap(page); // last set of exercise 1, on target
  const inSession = () => api.state.requests.filter((x) => JSON.parse(x.body.messages[0].content).mode === 'in_session').length;
  const asked = inSession();
  await sleep(3200);
  st = await state(page);
  check('a late suggestion about finished sets is not shown', st.sessions[0].cursor.ex === 1 && st.sessions[0].hint === null && (await page.getByTestId('hint').count()) === 0);
  check('an on-target set does not call Claude', inSession() === asked && asked === 2, `${asked} -> ${inSession()}`);
  const seen = api.state.requests.map((x) => { try { return JSON.parse(x.body.messages[0].content); } catch { return {}; } }).filter((x) => x.mode === 'in_session').pop();
  const lpSeen = (seen.equipment || []).find((x) => x && x.name === 'Leg press');
  check('the coach is told how each identified machine works and what it isolates', !!lpSeen && lpSeen.maker === 'Technogym' && /push the platform away/.test(lpSeen.how_it_works) && /Quadriceps first/.test(lpSeen.isolates) && lpSeen.checked === 'found on the web', JSON.stringify(lpSeen));

  // Claude down mid-workout: carry on with the last approved plan
  api.state.delayMs = 0; api.state.fail = 529;
  await page.fill('#start-weight', '20'); await sleep(120); await tap(page);
  await tap(page);
  await page.getByRole('button', { name: '1 rep fewer' }).click();
  await tap(page);
  await sleep(600);
  check('with Claude failing, the workout carries on by the rules', (await phase(page)) === 'rest' && /From the training rules/.test(await page.getByTestId('hint').textContent()));
  api.state.fail = null;
  api.state.reviewDelayMs = 1500;
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  st = await state(page);
  const thinking = st.proposals.find((p) => p.mode === 'post_session');
  check('at the end of a workout Claude reviews it: the summary says it is thinking, and the rules stay out of it', /Claude is thinking/.test(await page.getByTestId('checking').textContent())
    && (await page.getByTestId('update-message').count()) === 0 && (await page.getByTestId('coach-summary').getByTestId('change').count()) === 0 && (await page.getByTestId('no-changes').count()) === 0
    && thinking.checking === 'claude' && thinking.source === 'claude' && thinking.changes.length === 0 && st.plan.days[0].exercises[0].load.value === 20, JSON.stringify(thinking));
  await shot(page, '43-thinking');
  await page.getByTestId('summary-source').filter({ hasText: 'From Claude' }).waitFor({ timeout: 5000 });
  api.state.reviewDelayMs = 0;
  const card = page.getByTestId('coach-summary').getByTestId('change').first();
  st = await state(page);
  check("Claude's answer then fills it in: its summary, and its changes with the app's own old value", (await page.getByTestId('update-message').textContent()) === 'Solid session.'
    && /Weight: 20 kg → 22 kg/.test(await card.textContent()) && /Test double/.test(await card.textContent()) && (await page.getByTestId('checking').count()) === 0, await page.getByTestId('coach-summary').textContent());
  check('and the change is already in the plan, with nothing to accept', /In the plan/.test(await card.textContent()) && st.plan.days[0].exercises[0].load.value === 22 && st.proposals.filter((p) => p.mode === 'post_session').length === 1
    && st.proposals.find((p) => p.mode === 'post_session').changes.every((c) => c.status === 'applied'), JSON.stringify(st.proposals.map((p) => p.changes.map((c) => [c.field, c.status]))));
  const after = api.state.requests.map((x) => { try { return JSON.parse(x.body.messages[0].content); } catch { return {}; } }).find((x) => x.mode === 'after_session');
  check('Claude gets the plan as the workout was done against it, with the timing of every set', !!after && after.current_plan.sessions[0].exercises[0].load === 20 && after.session.exercises[0].sets[0].seconds_under_load != null
    && 'rest_before_seconds' in after.session.exercises[0].sets[1], JSON.stringify(after && after.session.exercises[0].sets[1]));
  await shot(page, '19-claude-review');

  // the plan moves after the workout, and "Train now" on an unplanned day asks Claude
  await page.getByTestId('to-plan').click();
  await page.getByTestId('last-update').waitFor();
  st = await state(page);
  check('after a workout the order and rest days of what is left are updated too', st.plan.queue.done.join() === 'd1' && st.plan.queue.order.slice(0, 2).join() === 'd3,d2' && st.plan.days[2].restAfter === 3
    && /Updated .* by Claude/.test(await page.getByTestId('last-update').textContent()) && /Solid session/.test(await page.getByTestId('last-update').textContent())
    && /second session moves up/.test(st.proposals.find((p) => p.mode === 'post_session').schedule), JSON.stringify(st.plan.queue));
  check('a full cycle stays on show after the update', (await page.getByTestId('timeline').getByTestId('plan-session').count()) === 3 && /done this round/.test(await page.getByTestId('timeline').getByTestId('plan-session').last().textContent()));
  await startWith(page, 'train-now');
  await page.getByTestId('today-pick').waitFor();
  check('off the planned day, the rule-based pick shows at once', /From the training rules/.test(await page.getByTestId('today-pick').textContent()) || /From Claude/.test(await page.getByTestId('today-pick').textContent()));
  await page.getByTestId('today-pick').getByText('From Claude').waitFor({ timeout: 5000 });
  const aiPick = await page.getByTestId('today-pick').textContent();
  const tn = api.state.requests.map((x) => { try { return JSON.parse(x.body.messages[0].content); } catch { return {}; } }).find((x) => x.mode === 'train_now');
  // The rules had already moved Lower body ahead: Full body repeats the chest and back trained minutes ago.
  check('Claude reviews what makes sense today, with the history and the app\'s pick in hand', !!tn && tn.days_off_plan < 0 && tn.app_pick.session_id === 'd2' && /time to recover/.test(tn.app_pick.reason)
    && tn.recent_workouts.length === 1 && tn.current_plan.list.done.join() === 'd1' && tn.hours_since_muscle_group_was_trained.Chest === 0, JSON.stringify(tn && [tn.days_off_plan, tn.app_pick, tn.current_plan.list]));
  check("Claude's pick replaces it, with its reason", /Full body/.test(aiPick) && /Test double: -\d+ days off plan/.test(aiPick) && /5% lighter today/.test(aiPick), aiPick);
  check('the rule-based pick stays one tap away', (await page.getByRole('button', { name: /Use the rule-based pick instead: Lower body/ }).count()) === 1);
  await shot(page, '32-train-now-claude');
  await startWith(page, 'today-start');
  await main(page).waitFor();
  st = await state(page);
  check("starting accepts Claude's update: its order and rest days, minus the session it made up", st.plan.queue.order.slice(0, 2).join() === 'd3,d2' && st.plan.days[2].restAfter === 3 && st.plan.days[1].restAfter === 0
    && st.sessions.slice(-1)[0].title === 'Full body' && st.sessions.slice(-1)[0].easePct === 5, JSON.stringify([st.plan.queue, st.plan.days.map((d) => d.restAfter)]));
  check('a change Claude makes further on goes in with the start, and is listed', st.proposals.some((p) => p.mode === 'coach' && p.changes[0].field === 'rest' && p.changes[0].status === 'applied' && /Changed when you started/.test(p.message)));
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.getByTestId('train-now').waitFor();

  // the list runs out: Claude plans the next run from the results
  for (const name of ['Lower body']) { await openSession(page, name); await page.getByTestId('skip-session').click(); await tab(page, 'Plan').click(); await page.getByTestId('timeline').waitFor(); }
  await startWith(page, 'train-now');
  await startWith(page, 'today-start');
  await main(page).waitFor();
  await runWorkout(page, { stop: async () => (await state(page)).sessions.slice(-1)[0].exercises[0].sets[0].status === 'done' });
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  await until(async () => (await state(page)).plan.days[0].title === 'Push', 6000);
  st = await state(page);
  const nr = api.state.requests.map((x) => { try { return JSON.parse(x.body.messages[0].content); } catch { return {}; } }).find((x) => x.mode === 'next_run');
  check('when the last session is done, Claude is asked for the next run with the results so far', !!nr && Object.keys(nr.results_by_exercise).length > 0 && nr.run_just_finished.list.still_to_do_in_order.length === 0);
  check('the next run replaces the list and the plan carries on', st.plan.days.map((d) => d.title).join() === 'Push,Pull,Legs' && st.plan.queue.run === 2 && st.plan.queue.done.length === 0 && st.plan.source === 'claude'
    && /Next run: pressing and rowing stay/.test(st.chat.slice(-1)[0].text), JSON.stringify([st.plan.days.map((d) => d.title), st.plan.queue]));
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  check('and is on the plan screen, ready to browse', /Push/.test(await page.getByTestId('plan-session').first().textContent()) && /Updated .* by Claude/.test(await page.getByTestId('last-update').textContent()));
  check("Claude's own long view comes with the plan", /Test double: the next round keeps the presses/.test(await page.getByTestId('outlook-ai').textContent()) && (await state(page)).plan.outlook.by === 'claude');
  await shot(page, '33-next-run');

  // another activity: the rules answer at once, Claude adds its reading
  await page.getByTestId('log-activity').click();
  await page.fill('#act-minutes', '45');
  await page.getByTestId('effort-hard').click();
  await page.getByTestId('act-save').click();
  check('a logged activity goes to Claude with the plan, and its reading is shown', await until(async () => /Test double: 45 minutes of run noted/.test(await page.getByTestId('last-update').textContent()), 5000)
    && api.state.requests.some((x) => { try { return JSON.parse(x.body.messages[0].content).mode === 'activity'; } catch { return false; } }), await page.getByTestId('last-update').textContent());

  // chat change request -> made at once, shown in the chat with an Undo
  await tab(page, 'Coach').click();
  await say(page, 'Can the first session be shorter?');
  await page.getByTestId('change').first().waitFor();
  check('asking the coach for a change makes it at once and shows it in the chat', /Sets: 3 sets → 2 sets/.test(await page.getByTestId('change').first().textContent()) && /In the plan/.test(await page.getByTestId('change').first().textContent())
    && (await state(page)).plan.days[0].exercises[0].sets === 2);
  await page.getByTestId('change').first().getByTestId('change-undo').click();
  check('and it can be undone right there', await until(async () => (await state(page)).plan.days[0].exercises[0].sets === 3) && /Undone/.test(await page.getByTestId('change').first().textContent()));

  // wrong key: clear message, built-in coach takes over
  api.state.fail = 401;
  await say(page, 'Make it four days a week');
  await page.getByText(/rejected the API key/).waitFor();
  check('a failing key gives a plain message, and the built-in coach answers and rebuilds the plan from the chat alone', await until(async () => { const s = await state(page); return s.profile.daysPerWeek === 4 && s.plan.perWeek === 4 && s.plan.source === 'rules'; }, 6000)
    && (await page.getByText(/rejected the API key/).count()) === 1 && (await page.getByTestId('assumptions').count()) === 0, JSON.stringify([(await state(page)).plan.perWeek, (await state(page)).plan.source]));
  await shot(page, '20-claude-fallback');
  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'smith machine');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor();
  check('gym text still gets saved when Claude fails', (await state(page)).equipment.items.smith === true && /built-in reader instead/.test(await page.getByTestId('gym-result').textContent()));
  api.state.fail = null;

  // no connection at the end of a workout: the rules update the plan, and Claude's review waits
  await page.getByRole('button', { name: 'Done' }).click();
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  await page.getByTestId('plan-session').first().click();
  await startWith(page, 'start-day');
  if (await until(() => page.getByTestId('today-start').isVisible(), 800)) await startWith(page, 'today-start');
  await main(page).waitFor();
  await runWorkout(page, { stop: async () => (await state(page)).sessions.slice(-1)[0].exercises[0].sets[0].status === 'done' });
  await context.setOffline(true);
  const sent = api.state.requests.length;
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  check('with no connection the workout is saved and the rules update the plan', /No connection, so the training rules updated the plan\. Claude reviews this workout/.test(await page.getByTestId('pending').textContent())
    && /From the training rules/.test(await page.getByTestId('summary-source').textContent()) && api.state.requests.length === sent, await page.getByTestId('coach-summary').textContent());
  await page.getByTestId('to-plan').click();
  check('the plan says it will be updated when the phone is online', /The plan will be updated when you are online/.test(await page.getByTestId('plan-pending').textContent()));
  await shot(page, '39-offline');
  await context.setOffline(false);
  check('back online, Claude reviews that workout and the notice goes', await until(async () => (await page.getByTestId('plan-pending').count()) === 0
    && (await state(page)).proposals.some((p) => p.mode === 'post_session' && p.source === 'claude' && !p.pending && p.message === 'Solid session.'), 8000), JSON.stringify((await state(page)).proposals.slice(-1)));

  // Claude cannot be reached for another reason: the rules update the plan, the reason is said, and it can be asked again
  await page.getByTestId('plan-session').first().click();
  await startWith(page, 'start-day');
  if (await until(() => page.getByTestId('today-start').isVisible(), 800)) await startWith(page, 'today-start');
  await main(page).waitFor();
  await runWorkout(page, { stop: async () => (await state(page)).sessions.slice(-1)[0].exercises[0].sets[0].status === 'done' });
  api.state.fail = 401;
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  await page.getByTestId('review-failed').waitFor({ timeout: 8000 });
  st = await state(page);
  const failed = st.proposals.filter((p) => p.mode === 'post_session').slice(-1)[0];
  check('when Claude fails at the end of a workout, the rules update the plan and the screen says why', /could not review this workout/.test(await page.getByTestId('review-failed').textContent()) && /rejected the API key/.test(await page.getByTestId('review-failed').textContent())
    && /From the training rules/.test(await page.getByTestId('summary-source').textContent()) && failed.source === 'rules' && !failed.checking && !failed.pending && /sets done in \d+ min/.test(failed.message), JSON.stringify(failed));
  api.state.fail = null;
  await page.getByTestId('review-retry').click();
  check('"Ask Claude again" gets its review after all', await until(async () => (await state(page)).proposals.some((p) => p.id === failed.id && p.source === 'claude' && !p.failed && p.message === 'Solid session.'), 8000)
    && (await page.getByTestId('review-failed').count()) === 0, JSON.stringify((await state(page)).proposals.slice(-1)));
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
  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'These are from Technogym: leg press.');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-machines').waitFor();
  check('inside claude.ai machines are identified from memory and marked as not checked', (await state(page)).equipment.details.leg_press.basis === 'memory'
    && /from the model's memory, not checked/.test(await page.getByTestId('gym-machines').textContent()) && /cannot search the web/.test(await page.getByTestId('gym-machines').textContent()));
  await page.getByRole('button', { name: 'Done' }).click();
  await tab(page, 'Plan').click();
  await startWith(page, 'train-now');
  await page.fill('#start-weight', '22'); await sleep(120); await tap(page);
  await tap(page); await tap(page);
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('__mockdb') || '{}')).some((k) => k.includes('/sessions/')), null, { timeout: 8000 });
  await sleep(1800);
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
  const keys = Object.keys(db);
  check('cloud copy: one private main record plus one record per workout', keys.includes('data/users/viewer-1/main') && keys.filter((k) => k.startsWith('data/users/viewer-1/main/sessions/')).length === 1, keys.join(', '));
  check('machine details are part of the cloud copy', db['data/users/viewer-1/main'].equipment.details.leg_press.vendor === 'Technogym');
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await say(page, 'My left shoulder hurts on overhead pressing, and I really do not enjoy long warm-ups before training');
  await page.getByTestId('assumptions').waitFor();
  // The table of assumptions: labels on the left stay narrow, values get the room, even with long rows.
  const cols = await page.evaluate(() => {
    const dl = document.querySelector('[data-testid=assumptions] dl');
    const w = (el) => el.getBoundingClientRect().width;
    const dts = [...dl.querySelectorAll('dt')]; const dds = [...dl.querySelectorAll('dd')];
    return { total: w(dl), label: Math.max(...dts.map(w)), value: Math.min(...dds.map(w)), rows: dts.map((d) => d.textContent), overflow: dl.scrollWidth - dl.clientWidth };
  });
  check('assumptions table: the label column stays under 40% of the width', cols.label / cols.total < 0.4 && cols.value / cols.total > 0.55 && cols.overflow <= 0 && cols.rows.includes('Your limitations') && cols.rows.includes('Working around'), JSON.stringify(cols));
  await shot(page, '24b-assumptions-long');
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  check('offline: the app starts and builds a plan with no network', (await state(page)).plan.days.length === 4 && (await state(page)).plan.perWeek === 2);
  await shot(page, '24-offline');

  // A plan saved by the earlier version (one week, tied to weekdays) opens in the new shape with nothing lost.
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('seria.state.v1'));
    const p = st.plan;
    p.days = p.days.slice(0, 2);
    p.days.forEach((d, i) => { d.weekday = ['mon', 'thu'][i]; delete d.week; delete d.slot; delete d.restAfter; });
    delete p.queue; delete p.perWeek; delete p.cycleWeeks;
    localStorage.setItem('seria.state.v1', JSON.stringify(st));
  });
  await page.reload();
  await page.getByTestId('timeline').waitFor({ timeout: 8000 });
  const old = (await state(page)).plan;
  check('a plan saved by the earlier version is carried over: same sessions, now a list with rest days', (await page.getByTestId('plan-session').count()) === 2 && /2 rest days/.test(await page.getByTestId('rest-gap').first().textContent())
    && (await page.getByTestId('train-now').textContent()).trim() === 'Train now' && old.days.length === 2 && old.days.every((d) => d.exercises.length >= 3));
  await startWith(page, 'train-now');
  await main(page).waitFor();
  const up = (await state(page)).plan;
  check('and it trains straight away', up.perWeek === 2 && up.days.map((d) => d.restAfter).join('') === '23' && up.queue.order.join() === 'd1,d2' && !('weekday' in up.days[0]), JSON.stringify(up.queue));
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no sideways scroll at phone width', overflow <= 0, overflow);

  // A new release while the app is open: it loads by itself, but never under a workout.
  await context.setOffline(false);
  await page.reload();
  await page.getByTestId('train-now').waitFor({ timeout: 8000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const release = async (name) => {
    await page.evaluate(() => { window.__same = true; });
    setSwVersion(name);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  };
  const reloaded = (ms) => until(() => page.evaluate(() => window.__same !== true && !!document.querySelector('[data-testid=train-now]')), ms);
  await startWith(page, 'train-now');
  await main(page).waitFor();
  await release('seria-test-2');
  await page.waitForFunction(async () => (await caches.keys()).includes('seria-test-2'), null, { timeout: 8000 });
  await sleep(700);
  check('a new release is fetched in the background and does not reload the app under a workout', (await page.evaluate(() => window.__same === true)) && page.url().includes('#workout'));
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  check('it loads by itself once the workout is over, and says so', (await reloaded(8000)) && await until(async () => /Updated to Seria \d/.test(await page.locator('.toast').textContent().catch(() => '')), 3000));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await release('seria-test-3');
  check('with nothing in progress a new release loads at once: no second refresh needed', (await reloaded(10000)) && await page.evaluate(async () => (await caches.keys()).join() === 'seria-test-3'), await page.evaluate(async () => (await caches.keys()).join()).catch(() => ''));
  check('the plan screen shows which version is running', /^Seria \d+\.\d+\.\d+$/.test((await page.getByTestId('app-version').textContent()).trim()));
  setSwVersion(null);
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
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  check('the single file runs the whole app with Claude and cloud save from the viewer', (await state(page)).plan.source === 'claude'
    && await until(async () => !!(await page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}')['data/users/viewer-1/main']?.plan)), 6000));
  check('no script errors in part E', errors.length === 0, errors.join(' | '));
  await context.close();
});

// =====================================================================  F
part = 'F OpenAI API';
const reqsBeforeF = api.state.requests.length;
await guarded(async () => {
  const { context, page, errors } = await newPage();
  await page.goto(`${BASE}#prefs`);
  check('Claude is the provider until you choose otherwise', (await page.getByTestId('provider-anthropic').getAttribute('aria-checked')) === 'true' && (await page.locator('#api-key').count()) === 1);
  await page.getByTestId('provider-openai').click();
  await page.fill('#openai-key', 'sk-test-openai-key');
  await page.locator('details summary').click();
  await page.fill('#openai-base-url', `${oai.url}/v1`);
  check('status shows OpenAI connected with its default model', /OpenAI API · gpt-6\.1-sol/.test(await page.getByTestId('claude-status').textContent()));
  await page.getByTestId('test-claude').click();
  await page.getByText(/OpenAI answered/).waitFor();
  check('"Test the connection" gets an answer from OpenAI', /OpenAI answered: “Hello from the model”/.test(await page.getByTestId('test-result').textContent()));
  await shot(page, '25-openai-connected');
  const r = oai.state.requests[0];
  check('request: key as a bearer token, sent by the official SDK to the Responses API', r.headers.authorization === 'Bearer sk-test-openai-key' && r.path === '/v1/responses' && /^7\./.test(r.headers['x-stainless-package-version'] || ''), `${r.path} ${JSON.stringify(r.headers).slice(0, 300)}`);
  check('request: model, strict JSON schema, low effort for a quick call, nothing stored', r.body.model === 'gpt-6.1-sol' && r.body.text.format.type === 'json_schema' && r.body.text.format.strict === true && r.body.reasoning.effort === 'low' && r.body.store === false && r.body.max_output_tokens === 4000, JSON.stringify(r.body).slice(0, 200));
  check('request: the same rules library goes to OpenAI as to Claude', r.body.instructions.includes(`Training rules library, version ${RULES_VERSION}`) && JSON.parse(r.body.input).mode === 'interview');
  check('no Anthropic request was made', api.state.requests.length === reqsBeforeF);

  // name the maker first, so the plan and the workout can use the machine
  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'These are from Technogym: leg press and chest press.');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-machines').waitFor();
  const oaiLook = oai.state.requests.find((x) => (x.body.tools || []).length);
  let stF = await state(page);
  check('OpenAI looks the machines up with its web search tool', !!oaiLook && oaiLook.body.tools[0].type === 'web_search' && /look up gym machines/.test(oaiLook.body.instructions) && oaiLook.body.store === false);
  check('and the result is saved the same way: found with a real source, or from memory', stF.equipment.details.leg_press.basis === 'web' && stF.equipment.details.leg_press.source === 'https://maker.example/products/leg_press' && stF.equipment.details.chest_press.basis === 'memory');
  await page.getByRole('button', { name: 'Done' }).click();

  await tab(page, 'Coach').click();
  await say(page, 'Strength, a year in, three days a week, 50 minutes. Skip deadlifts, I love pull-ups.');
  await page.getByTestId('assumptions').waitFor();
  check('the reply is marked as coming from OpenAI', (await page.locator('.bubble .via').first().textContent()) === 'OpenAI');
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  let st = await state(page);
  const planReq = oai.state.requests.map((x) => { try { return JSON.parse(x.body.input); } catch { return {}; } }).find((x) => x.mode === 'new_plan');
  check('the plan request tells the model about the exact machine on the exercise', planReq.available_exercises.find((x) => x.id === 'leg_press').machine.model === 'Selection 900 Leg Press');
  await openSession(page, 'Lower body');
  check('the day preview names the machine and what it isolates', /Technogym Selection 900 Leg Press · isolates quadriceps first, then glutes/.test(await page.getByTestId('day-machine').first().textContent()), await page.getByTestId('day-machine').first().textContent());
  await startWith(page, 'start-day');
  await main(page).waitFor();
  const about = page.getByTestId('machine-info');
  await about.locator('summary').click();
  check('the sketch follows what was found about the machine: this one is loaded with plates', (await page.getByTestId('sketch').locator('svg').getAttribute('data-sketch')) === 'leg_press'
    && /General look of a leg press, loaded with plates/.test(await page.getByTestId('sketch-note').textContent()));
  check('the workout screen explains the machine you are on', (await page.getByTestId('exercise-name').textContent()) === 'Leg press' && /How it works: From the maker's page/.test(await about.textContent()) && /Loaded with: plates you load/.test(await about.textContent()));
  await shot(page, '27-workout-machine');
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  check('plan built by OpenAI, cleaned against the catalog like any other', st.plan.source === 'openai' && st.plan.days.length === 3 && !JSON.stringify(st.plan).includes('ghost_lift') && /Built by OpenAI/.test(await page.locator('main').textContent()));

  await tab(page, 'Equipment').click();
  await page.getByTestId('add-machine').click();
  await page.fill('#gym-text', 'Cables and a hack squat');
  await page.getByTestId('read-gym').click();
  await page.getByTestId('gym-result').waitFor();
  check('gym text is read by OpenAI and saved', /Read by OpenAI/.test(await page.getByTestId('gym-result').textContent()) && (await state(page)).equipment.items.hack_squat === true);
  await page.getByRole('button', { name: 'Done' }).click();

  oai.state.delayMs = 700;
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  await openSession(page, 'Upper body'); // picked by hand, out of turn
  await startWith(page, 'start-day');
  await main(page).waitFor();
  await page.fill('#start-weight', '20'); await sleep(120); await tap(page);
  await tap(page);
  await page.getByRole('button', { name: '1 rep fewer' }).click(); await page.getByRole('button', { name: '1 rep fewer' }).click();
  await tap(page);
  check('mid-workout the rule-based change is made first', /From the training rules/.test(await page.getByTestId('hint').textContent()));
  await page.getByText('From OpenAI').waitFor({ timeout: 5000 });
  check("then OpenAI's change takes its place", /Weight: 20 kg → 16 kg/.test(await page.getByTestId('hint').textContent()) && (await page.getByTestId('target-load').textContent()).trim() === '16 kg');
  await shot(page, '26-openai-hint');
  oai.state.delayMs = 0;
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  await page.getByTestId('summary-source').filter({ hasText: 'From OpenAI' }).waitFor({ timeout: 5000 });
  check("after the workout OpenAI's summary and changes are in", /Weight: 20 kg → 22 kg/.test(await page.getByTestId('coach-summary').getByTestId('change').first().textContent())
    && (await page.getByTestId('update-message').textContent()) === 'Solid session.' && (await state(page)).plan.days[0].exercises[0].load.value === 22);

  // a model that turns down the reasoning setting, and a model id typed by hand
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  oai.state.rejectReasoning = true;
  let n = oai.state.requests.length;
  await page.getByTestId('test-claude').click();
  await page.getByText(/OpenAI answered/).waitFor();
  check('if a model refuses the reasoning setting, the app asks again without it', oai.state.requests.length === n + 2 && !('reasoning' in oai.state.requests[n + 1].body));
  oai.state.rejectReasoning = false;
  await page.selectOption('#openai-model', 'other');
  await page.fill('#openai-model-id', 'gpt-4.1');
  check('any model id can be typed in', await until(async () => /OpenAI API · gpt-4\.1/.test(await page.getByTestId('claude-status').textContent())));
  n = oai.state.requests.length;
  await page.getByTestId('test-claude').click();
  await until(() => oai.state.requests.length === n + 1);
  check('older models get no reasoning setting at all', oai.state.requests[n].body.model === 'gpt-4.1' && !('reasoning' in oai.state.requests[n].body));

  // limits: say what OpenAI said, not a guess
  await page.selectOption('#openai-model', 'gpt-6.1-sol');
  n = oai.state.requests.length;
  oai.state.cutOffOnce = true;
  await page.getByTestId('test-claude').click();
  await until(() => oai.state.requests.length === n + 2);
  check('OpenAI: a cut-off answer is asked for once more with twice the room', oai.state.requests[n].body.max_output_tokens === 4000 && oai.state.requests[n + 1].body.max_output_tokens === 8000 && await until(async () => /OpenAI answered/.test(await page.getByTestId('test-result').textContent())));
  oai.state.fail = 429;
  await page.getByTestId('test-claude').click();
  await page.getByText(/over a limit/).waitFor();
  let limitText = await page.getByTestId('test-result').textContent();
  check("a 429 from OpenAI shows OpenAI's own words and what to check", /tokens per min \(TPM\): Limit 10000, Used 0, Requested 12000/.test(limitText) && /needs bought credit/.test(limitText) && /spend limit/.test(limitText) && !/org-AbC123xyz/.test(limitText), limitText);
  await shot(page, '28-openai-limit');
  oai.state.fail = 'quota';
  await page.getByTestId('test-claude').click();
  await page.getByText(/no credit to spend/).waitFor();
  limitText = await page.getByTestId('test-result').textContent();
  check('an empty OpenAI balance is named as that, not as a rate limit', /exceeded your current quota/.test(limitText) && /Buy credit/.test(limitText) && !/over a limit/.test(limitText), limitText);

  // wrong key: plain message, built-in coach takes over
  oai.state.fail = 401;
  await tab(page, 'Coach').click();
  await say(page, 'Make it four days a week');
  await page.getByText(/OpenAI rejected the API key/).waitFor();
  check('a failing OpenAI key gives a plain message and the built-in coach answers', await until(async () => { const s = await state(page); return s.profile.daysPerWeek === 4 && s.plan.perWeek === 4; }, 6000));
  oai.state.fail = null;

  // switching back: each provider keeps its own key
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('provider-anthropic').click();
  check('switching to Claude with no Claude key falls back to the built-in coach', await until(async () => /Built-in coach/.test(await page.getByTestId('claude-status').textContent())));
  await page.getByTestId('provider-openai').click();
  check('the OpenAI key is still there when you switch back', (await page.inputValue('#openai-key')) === 'sk-test-openai-key');
  check('keys are kept apart from the app data and backups', !/sk-test-openai/.test(await page.evaluate(() => localStorage.getItem('seria.state.v1') || '')));
  check('no script errors in part F', errors.length === 0, errors.join(' | '));
  await context.close();
});

// ---------------------------------------------------------------------------
// G  Optional extras: listed with each session, offered when the planned sets
//    are done, taken or left.
// ---------------------------------------------------------------------------
part = 'G optional extras';
await guarded(async () => {
  const { context, page, errors } = await newPage();
  await page.goto(`${BASE}#coach`);
  await page.getByText('Tell me about your goal').waitFor();
  await say(page, "I want to build strength. I've trained for a year. I can come three times a week for 50 minutes.");
  await page.getByText(/movements you want to skip/).waitFor();
  await page.getByRole('button', { name: 'No, nothing' }).click();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  let st = await state(page);
  const d1 = st.plan.days[0];
  const names = d1.optional.map((o) => o.name);
  check('every session of a new plan lists one or two optional extras, none of them already in the session',
    st.plan.days.every((d) => d.optional.length >= 1 && d.optional.length <= 2 && d.optional.every((o) => o.optional && o.why && !d.exercises.some((x) => x.exerciseId === o.exerciseId))),
    JSON.stringify(st.plan.days.map((d) => d.optional.map((o) => o.name))));
  check('the next session on the plan names its optional extras', (await page.getByTestId('up-next-optional').textContent()) === `Optional at the end: ${names.join(', ')}`, await page.getByTestId('up-next-optional').textContent());

  await openSession(page, d1.title);
  const box = page.getByTestId('day-optional');
  const boxText = await box.textContent();
  check('the session screen shows them apart from the plan, with sets, time and the reason',
    (await box.getByTestId('optional-exercise').count()) === names.length && names.every((n) => boxText.includes(n)) && /Optional extras/.test(boxText) && /not counted in the \d+ min/.test(boxText)
    && /2 × \d+ reps/.test(boxText) && /about \d+ min/.test(boxText) && (await box.getByTestId('optional-why').first().textContent()) === d1.optional[0].why, boxText.slice(0, 400));
  check('they do not change the time of the session', new RegExp(`About ${d1.estMinutes} min`).test(await page.locator('main').textContent()) && d1.estMinutes <= 50);
  await box.scrollIntoViewIfNeeded();
  await shot(page, '40-day-optional');

  // The whole planned session, one tap per set.
  await startWith(page, 'start-day');
  await main(page).waitFor();
  const planned = d1.exercises.reduce((n, x) => n + x.sets, 0);
  let lastLabel = '';
  await runWorkout(page, { stop: async () => { const w = (await state(page)).sessions[0]; if (w.phase === 'active') lastLabel = (await main(page).textContent()).trim(); return w.phase === 'optional'; } });
  st = await state(page);
  check('after the last planned set the workout stays open and offers the extras', st.sessions[0].status === 'active' && st.sessions[0].phase === 'optional' && (await phase(page)) === 'optional'
    && (await page.getByRole('heading', { name: 'Feel like a bit more?' }).isVisible()) && (await page.getByTestId('optional-list').getByTestId('optional-row').count()) === names.length
    && (await main(page).textContent()).trim() === 'Finish workout', `${st.sessions[0].phase} ${(await main(page).textContent()).trim()}`);
  check('the last planned set says "Finish set", not "end workout", while extras are on offer', lastLabel === 'Finish set', lastLabel);
  check('each offer says what it is, how long it takes and why it fits', new RegExp(`${names[0]}.*2 × \\d+ reps · about \\d+ min`).test(await page.getByTestId('optional-row').first().textContent())
    && (await page.getByTestId('optional-row').first().textContent()).includes(d1.optional[0].why), await page.getByTestId('optional-row').first().textContent());
  check('the set just saved can still be nudged from here', (await page.getByTestId('last-set').count()) === 1);
  const repsBefore = Number(await page.getByTestId('last-reps').textContent());
  await page.getByTestId('last-set').getByRole('button', { name: '1 rep more' }).click();
  check('+1 on that card is saved', await until(async () => { const w = (await state(page)).sessions[0]; const x = w.exercises[w.exercises.length - 1]; return x.sets[x.sets.length - 1].actual.reps === repsBefore + 1; }));
  await shot(page, '41-optional-step');
  await page.reload();
  await page.getByRole('heading', { name: 'Feel like a bit more?' }).waitFor();
  check('a reload lands back on the same step', (await page.getByTestId('optional-row').count()) === names.length);

  // Take the first one.
  await page.getByTestId('optional-row').first().click();
  await until(async () => (await page.getByTestId('exercise-name').count()) === 1);
  check('"Do it" brings the extra up as the next exercise, marked optional', (await page.getByTestId('exercise-name').textContent()) === names[0] && /optional extra/.test(await page.locator('main').textContent())
    && (await state(page)).sessions[0].exercises.slice(-1)[0].optional === true);
  await runWorkout(page, { weight: '10', stop: async () => (await state(page)).sessions[0].phase === 'optional' });
  st = await state(page);
  check('when it is done, the one that is left is offered again', (await page.getByTestId('optional-row').count()) === names.length - 1 && st.sessions[0].exercises.slice(-1)[0].sets.every((x) => x.status === 'done'));
  // Add the other one, then finish without doing it.
  if (names.length > 1) {
    await page.getByTestId('progress').click();
    check('the workout overview lists the extra as done and offers the other one', /optional extra/.test(await page.getByTestId('overview').textContent()) && (await page.getByTestId('overview-optional').getByTestId('optional-row').count()) === 1);
    await page.getByTestId('overview-optional').getByTestId('optional-row').first().click();
    await until(async () => (await page.getByTestId('exercise-name').count()) === 1);
    check('an extra can also be added from the overview', (await page.getByTestId('exercise-name').textContent()) === names[1]);
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('button', { name: 'Finish and save' }).click();
  } else {
    await main(page).click();
  }
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  st = await state(page);
  const w = st.sessions[0];
  const extra = w.exercises.filter((x) => x.optional);
  const upd = st.proposals.find((p) => p.sessionId === w.id);
  check('the saved workout holds the extra that was done, and nothing of the one that was not', w.status === 'done' && extra.length === 1 && extra[0].name === names[0] && extra[0].sets.every((x) => x.status === 'done')
    && w.exercises.reduce((n, x) => n + x.sets.length, 0) === planned + extra[0].sets.length && (await page.getByTestId('sum-sets').textContent()).trim() === `${planned + extra[0].sets.length} / ${planned + extra[0].sets.length}`,
    `${extra.map((x) => x.name)} ${await page.getByTestId('sum-sets').textContent()}`);
  check('the summary names it, and the record marks it as an optional extra', new RegExp(`includes the optional ${names[0]}`).test(upd.message) && /Optional extra/.test(await page.getByTestId('session-exercise').last().textContent()), upd.message);
  const entry = st.plan.days[0].optional.find((o) => o.name === names[0]);
  const change = upd.changes.find((c) => c.exerciseName === names[0]);
  check('an extra that was done moves on in the plan like any other exercise, and stays optional', !!change && change.status === 'applied' && entry.optional === true && (entry.reps === d1.optional[0].reps + 1 || entry.load?.value > 10),
    JSON.stringify({ change, reps: entry.reps, load: entry.load }));
  await shot(page, '42-optional-saved');

  // A plan saved before the feature existed gains its extras when the app starts.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('seria.state.v1'));
    for (const d of s.plan.days) delete d.optional;
    localStorage.setItem('seria.state.v1', JSON.stringify(s));
  });
  await page.goto(`${BASE}#plan`);
  await page.reload();
  await page.getByTestId('train-now').waitFor();
  check('a plan saved by an older version shows optional extras after the update, with nothing to rebuild', (await page.getByTestId('up-next-optional').count()) === 1 && /Optional at the end: \w/.test(await page.getByTestId('up-next-optional').textContent()));
  check('no script errors in part G', errors.length === 0, errors.join(' | '));
  await context.close();
});

// ---------------------------------------------------------------------------
// H  Version 1.3: weights offered before the workout, the step field, the band
//    at the top that does not scroll ("Train" / "Push"), and pairs.
// ---------------------------------------------------------------------------
part = 'H pairs and the band';
await guarded(async () => {
  const { context, page, errors } = await newPage();
  await page.goto(`${BASE}#coach`);
  await page.getByText('Tell me about your goal').waitFor();
  await say(page, "I want to build muscle. I've trained for a year. I can come four times a week for 60 minutes.");
  await page.getByText(/movements you want to skip/).waitFor();
  check('the coach asks about supersets along with what to skip', /would rather do supersets/.test(await page.locator('.chat .bubble').last().textContent()) && (await page.getByRole('button', { name: 'I like supersets' }).count()) === 1);
  await page.getByRole('button', { name: 'No, nothing' }).click();
  await page.getByTestId('assumptions').waitFor();
  const sw = page.getByTestId('assume-pairs-switch');
  check('the summary before the first plan has the supersets switch, off', (await sw.getAttribute('aria-checked')) === 'false' && /Turn them on if you would rather do a set of something else/.test(await page.getByTestId('assume-pairs').textContent()));
  await sw.click();
  check('switched on there, the summary says the plan is built for supersets', await until(async () => (await state(page)).profile.pairs === true) && (await sw.getAttribute('aria-checked')) === 'true'
    && /The plan is built for supersets/.test(await page.getByTestId('assume-pairs').textContent()) && /Supersets/.test(await page.getByTestId('assumptions').locator('dl').textContent()));
  await shot(page, '55-supersets-mode');
  await sw.click();
  await until(async () => (await state(page)).profile.pairs === false);
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  let st = await state(page);
  const [A, B, C] = st.plan.days[0].exercises;
  const min0 = st.plan.days[0].estMinutes;

  // --- the step field: a typed 1 stays, also on the way to 1.25
  await page.getByTestId('plan-session').first().click();
  await page.getByTestId('edit-weight').first().click();
  await page.fill('#weight-value', '20');
  await page.getByTestId('weight-step-other').click();
  check('"Other" opens the step field ready to type in', await until(() => page.evaluate(() => document.activeElement && document.activeElement.id === 'weight-step-value')));
  await page.locator('#weight-step-value').pressSequentially('1', { delay: 60 });
  await sleep(300);
  check('a step of 1 can be typed: the 1 stays in the field', (await page.inputValue('#weight-step-value')) === '1', await page.inputValue('#weight-step-value'));
  await page.locator('#weight-step-value').pressSequentially('.25', { delay: 60 });
  await sleep(200);
  check('and so can 1.25, one key at a time', (await page.inputValue('#weight-step-value')) === '1.25', await page.inputValue('#weight-step-value'));
  await page.getByTestId('weight-save').click();
  check('the weight and its step are saved together', await until(async () => { const w = (await state(page)).weights[A.exerciseId]; return w && w.value === 20 && w.step === 1.25; }), JSON.stringify((await state(page)).weights));
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('train-now').waitFor();

  // --- pairs: one switch on the plan
  const toggle = page.getByTestId('pairs-toggle');
  check('the plan offers to pair exercises, and says what it saves', (await toggle.getAttribute('aria-checked')) === 'false' && /about \d+ min less a session/.test(await toggle.textContent()) && /both stations free/.test(await toggle.textContent()), await toggle.textContent());
  await toggle.click();
  st = await state(page);
  const d1 = st.plan.days[0];
  check('switched on, exercises that use different muscles are paired and the sessions get shorter', (await toggle.getAttribute('aria-checked')) === 'true' && st.profile.pairs === true
    && d1.exercises[0].pair && d1.exercises[0].pair === d1.exercises[1].pair && d1.estMinutes <= min0 - 8 && d1.exercises.map((x) => x.exerciseId).join() === [A, B, C].map((x) => x.exerciseId).concat(d1.exercises.slice(3).map((x) => x.exerciseId)).join(),
  `${d1.estMinutes} min against ${min0}`);
  check('the next session shows its pairs', new RegExp(`${A.name} \\+ ${B.name}`).test(await page.getByTestId('plan-session').first().textContent()) && new RegExp(`${d1.estMinutes} min`).test(await page.getByTestId('plan-session').first().textContent()));
  await shot(page, '44-pairs-switch');
  await page.getByTestId('plan-session').first().click();
  await page.getByTestId('day-pairs').waitFor();
  const firstCard = page.getByTestId('day-exercise').first();
  check('the session says which exercises are done in turns, why they fit, and the rest between them', /3 supersets in this session/.test(await page.getByTestId('day-pairs').textContent()) && (await page.getByTestId('pair-with').count()) === 6
    && new RegExp(`In turns with ${B.name}: opposite muscles\\. Rest 1:10 min after each set`).test(await firstCard.textContent()) && (await page.locator('[data-testid=day-exercise][data-pair=""]').count()) === 1, await firstCard.textContent());
  await shot(page, '45-day-pairs');

  // --- before the workout: the exercises with no weight yet, one after another
  await page.getByTestId('start-day').click();
  const sheet = page.getByTestId('weights-first');
  await sheet.waitFor();
  const blank = d1.exercises.filter((x) => x.loadType !== 'bodyweight' && !x.load);
  check('starting a session with weights missing offers to enter them first', new RegExp(`${blank.length} exercises in this session have no weight yet`).test(await sheet.textContent())
    && (await page.getByTestId('weights-first-count').textContent()) === `1 of ${blank.length}` && (await page.getByTestId('weights-first-name').textContent()) === blank[0].name && !page.url().includes('#workout'), await sheet.textContent());
  await shot(page, '46-weights-first');
  await page.getByTestId('weights-first-save').click();
  check('nothing is saved without a number', (await page.getByTestId('weights-first-count').textContent()) === `1 of ${blank.length}` && !(await state(page)).weights[blank[0].exerciseId]);
  await page.fill('#first-weight', '30');
  await page.getByTestId('first-step-other').click();
  await page.locator('#first-step-value').pressSequentially('1', { delay: 60 });
  await sleep(250);
  await page.getByTestId('weights-first-save').click();
  await until(async () => (await page.getByTestId('weights-first-count').textContent()) === `2 of ${blank.length}`);
  st = await state(page);
  check('a weight entered there is saved with its step, and the next exercise comes up with an empty field', st.weights[blank[0].exerciseId]?.value === 30 && st.weights[blank[0].exerciseId]?.step === 1
    && st.plan.days[0].exercises.find((x) => x.exerciseId === blank[0].exerciseId).load.value === 30 && (await page.getByTestId('weights-first-name').textContent()) === blank[1].name && (await page.inputValue('#first-weight')) === '', JSON.stringify(st.weights));
  await page.getByTestId('weights-first-next').click();
  check('one can be skipped: it is asked for when it comes up', await until(async () => (await page.getByTestId('weights-first-count').textContent()) === `3 of ${blank.length}`) && !(await state(page)).weights[blank[1].exerciseId]);
  await page.getByTestId('weights-skip').click();
  await main(page).waitFor();
  st = await state(page);
  check('the workout starts with the weights that were entered', page.url().includes('#workout') && (await main(page).textContent()).trim() === 'Start set' && (await page.getByTestId('target-load').textContent()).trim() === '20 kg'
    && st.sessions[0].exercises[1].sets[0].target.load === 30 && st.sessions[0].exercises[2].sets[0].target.load === null);

  // --- the band at the top: it stays put, and says what to do
  const band = page.getByTestId('now');
  check('before the first set the band says "Ready"', (await page.getByTestId('now-word').textContent()) === 'Ready' && (await band.getAttribute('data-now')) === 'ready');
  check('a paired exercise says who it takes turns with', new RegExp(`In turns with ${B.name}: a set here, 1:10 min rest, a set there`).test(await page.getByTestId('pair-line').textContent()), await page.getByTestId('pair-line').textContent());
  await tap(page);
  check('while a set runs the band says "Train", with the target and the set clock', (await page.getByTestId('now-word').textContent()) === 'Train' && /^Stop at \d+ · 00:0\d$/.test((await page.getByTestId('set-clock').textContent()).trim()), await band.textContent());
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(150);
  const scrolled = await page.evaluate(() => ({ y: window.scrollY, top: document.querySelector('[data-testid=now]').getBoundingClientRect().top, bottom: document.querySelector('[data-testid=now]').getBoundingClientRect().bottom, h: window.innerHeight }));
  check('the band does not scroll away with the page', scrolled.y > 40 && scrolled.top >= 0 && scrolled.bottom < scrolled.h / 2, JSON.stringify(scrolled));
  await shot(page, '47-train');
  await page.evaluate(() => window.scrollTo(0, 0));

  // --- a pair in the workout: a set of one, a short rest, a set of the other
  await tap(page);
  st = await state(page);
  let w = st.sessions[0];
  check('after a set of the first exercise, the second of the pair is up', w.cursor.ex === 1 && w.cursor.set === 0 && w.rest.swap === true && w.rest.plannedSec === 70 && (await page.getByTestId('exercise-name').textContent()) === B.name);
  const left = secs(await page.getByTestId('rest-timer').textContent());
  check('the rest between them is the short one, counted down in the band', left <= 70 && left >= 66 && new RegExp(`Go to ${B.name}\\. It starts when this runs out`).test(await page.getByTestId('now-line').textContent())
    && (await band.getAttribute('data-now')) === 'rest', `${left} ${await page.getByTestId('now-line').textContent()}`);
  await shot(page, '48-pair-rest');
  await restEndsIn(page, 1200);
  check('when the time is up the set of the other exercise starts, and the band says "Train" in place of the clock', await until(async () => (await phase(page)) === 'active', 6000)
    && (await page.getByTestId('now-word').textContent()) === 'Train' && /started by itself/.test(await page.getByTestId('set-clock').textContent()) && (await page.getByTestId('rest-timer').count()) === 0
    && (await page.getByTestId('exercise-name').textContent()) === B.name, await band.textContent());
  await tap(page); // finish B1
  check('then back to the first one', (await state(page)).sessions[0].cursor.ex === 0 && (await state(page)).sessions[0].cursor.set === 1 && (await page.getByTestId('exercise-name').textContent()) === A.name);
  await tap(page); await tap(page); // A2
  await tap(page); await tap(page); // B2
  await tap(page); // start A3, its last set
  check('on a set that goes past its target the band says "Push"', (await page.getByTestId('now-word').textContent()) === 'Push' && /^Last set: \d+ or more · 00:0\d$/.test((await page.getByTestId('set-clock').textContent()).trim()), await band.textContent());
  await shot(page, '49-push');
  await tap(page); // finish A3; B3 is up

  // --- the rest runs out with "start by itself" switched off: the word shows, the set waits for the tap
  await page.evaluate(() => localStorage.setItem('seria.settings.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('seria.settings.v1') || '{}'), autoStart: false })));
  await restEndsIn(page, 800);
  check('with the automatic start off, the band still says what to do when the time comes', await until(async () => (await band.getAttribute('data-now')) === 'go', 5000)
    && (await page.getByTestId('now-word').textContent()) === 'Push' && /Rest is over/.test(await page.getByTestId('now-line').textContent()) && (await phase(page)) === 'rest' && (await page.getByTestId('rest-timer').count()) === 0, await band.textContent());
  await tap(page); await tap(page); // B3: the first pair is done
  st = await state(page);
  w = st.sessions[0];
  check('when the pair is done the workout moves on to the next exercise', w.cursor.ex === 2 && w.rest.betweenExercises === true && !w.rest.swap && /Time to change station/.test(await page.getByTestId('now-line').textContent()), JSON.stringify(w.rest));
  check('the rests inside a pair are saved as the short ones they were planned to be', w.exercises[0].sets[1].restPlannedSec === 70 && w.exercises[1].sets[0].restPlannedSec === 70 && w.log.filter((e) => e[1] === 'rest_start' && e[3] === 'other_of_pair').length === 5);

  // --- a station is taken: split the pair for today
  await page.getByTestId('busy').click();
  check('"Machine busy?" offers to split a pair', /done in turns with/.test(await page.locator('.sheet').textContent()) && (await page.getByTestId('unpair').count()) === 1);
  await page.getByTestId('unpair').click();
  st = await state(page);
  w = st.sessions[0];
  check('split, the two are done one after the other today; the plan keeps the pair', !w.exercises[2].pair && !w.exercises[3].pair && !!w.exercises[4].pair && (await page.getByTestId('pair-line').count()) === 0
    && !!st.plan.days[0].exercises[2].pair && w.log.some((e) => e[1] === 'unpair'), JSON.stringify(w.exercises.map((x) => x.pair || '-')));
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  check('the saved workout says which exercises were done in turns', (await page.getByTestId('session-pair').count()) === 2 && new RegExp(`Done in turns with ${B.name}`).test(await page.getByTestId('session-pair').first().textContent())
    && /1:10 min planned/.test(await page.getByTestId('rest-stats').textContent()), await page.getByTestId('rest-stats').textContent());
  await page.getByTestId('to-plan').click();
  await page.getByTestId('pairs-toggle').click();
  st = await state(page);
  check('pairs can be switched off again: one exercise at a time, as before', st.profile.pairs === false && st.plan.days.every((d) => d.exercises.every((x) => !x.pair)) && (await page.getByTestId('pairs-toggle').getAttribute('aria-checked')) === 'false');

  // --- alternating as a mode: a plan made before it was on is only paired by chance; a new one is built for it
  await page.getByTestId('pairs-toggle').click();
  const offer = page.getByTestId('pairs-rebuild');
  check('with alternating on, the plan says it was not made for it and offers one that is', (await state(page)).profile.pairs === true && /not made for supersets/.test(await offer.textContent()) && /^Supersets/.test(await page.getByTestId('pairs-toggle').textContent()), await page.getByTestId('pairs-toggle').textContent());
  await page.getByTestId('pairs-build').click();
  await page.getByTestId('restore-plan').waitFor({ timeout: 8000 });
  st = await state(page);
  const pairsIn = (d) => new Set(d.exercises.map((x) => x.pair).filter(Boolean)).size;
  check('one tap builds a plan made for supersets, with no second button: every session has them', st.plan.forPairs === true && st.plan.days.every((d) => pairsIn(d) >= 1) && pairsIn(st.plan.days[0]) >= 3
    && (await page.getByTestId('assumptions').count()) === 0, JSON.stringify(st.plan.days.map((d) => [d.title, pairsIn(d)])));
  await page.getByTestId('open-plan').click();
  await page.getByTestId('timeline').waitFor();
  check('and the offer is gone from the plan', (await page.getByTestId('pairs-rebuild').count()) === 0);
  check('no script errors in part H', errors.length === 0, errors.join(' | '));
  await context.close();
});

// =====================================================================  I
part = 'I coach and history';
await guarded(async () => {
  const { context, page, errors } = await newPage();
  const from = api.state.requests.length; // the stand-in keeps the requests of earlier parts too
  const sent = (mode) => api.state.requests.slice(from).map((x) => { try { return JSON.parse(x.body.messages[0].content); } catch { return {}; } }).filter((x) => x.mode === mode);
  await page.goto(`${BASE}#prefs`);
  await page.fill('#api-key', 'sk-ant-test-key');
  await page.locator('details summary').click();
  await page.fill('#base-url', api.url);
  await tab(page, 'Coach').click();
  await say(page, 'Strength, a year in, three days a week, 50 minutes.');
  await page.getByTestId('assumptions').waitFor();
  await page.getByTestId('build-plan').click();
  await page.getByTestId('open-plan').click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  const first = sent('new_plan').slice(-1)[0];
  check('a first plan is asked for with nothing to carry on from', first.plan_being_replaced === null && first.recent_workouts.length === 0 && first.workouts_on_record === 0, JSON.stringify([first.plan_being_replaced, first.workouts_on_record]));

  // one whole workout of the first session, three days ago
  await startWith(page, 'train-now');
  await main(page).waitFor();
  await runWorkout(page);
  if (await until(() => page.getByRole('button', { name: 'Finish and save' }).isVisible(), 1500)) await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.getByRole('heading', { name: 'Workout saved' }).waitFor();
  await until(async () => (await state(page)).proposals.some((p) => p.mode === 'post_session' && !p.checking), 8000);
  await page.getByTestId('to-plan').click();
  await daysPass(page, 3);
  let st = await state(page);
  const old = st.plan;
  const trained = st.sessions[0];
  check('set-up: the first session was trained in full and came off the list', trained.title === 'Upper body' && trained.exercises.every((x) => x.sets.every((y) => y.status === 'done')) && old.queue.done.join() === 'd1', JSON.stringify([trained.title, old.queue]));

  // the chat: the coach is sent the workouts on record
  await tab(page, 'Coach').click();
  await say(page, 'Please regenerate my plan.');
  await page.getByTestId('restore-plan').waitFor({ timeout: 8000 });
  const talk = sent('interview').slice(-1)[0];
  const lastOut = talk.recent_workouts[0];
  check('the coach gets the last workout with the chat: when, what, and every set', talk.workouts_on_record === 1 && lastOut.title === 'Upper body' && lastOut.days_ago === 3
    && lastOut.exercises.length === trained.exercises.length && lastOut.exercises[0].reps.length === trained.exercises[0].sets.length && lastOut.exercises[0].skipped_sets === 0, JSON.stringify(lastOut).slice(0, 300));
  check('and where the plan stands: what is done, what is next, how long each muscle group has rested', talk.current_plan.list.done.join() === 'd1' && !!talk.next_session.session_id && talk.next_session.session_id !== 'd1'
    && talk.hours_since_muscle_group_was_trained.Chest >= 70 && /^\d{4}-\d\d-\d\d$/.test(talk.today.date), JSON.stringify([talk.next_session, talk.hours_since_muscle_group_was_trained]));

  // asked for in words, the new plan is built at once, from the records
  const build = sent('new_plan').slice(-1)[0];
  check('asking for a new plan builds one at once, and Claude gets the records, the old plan and the request', sent('new_plan').length === 2 && build.recent_workouts[0].title === 'Upper body' && build.plan_being_replaced.list.done.join() === 'd1'
    && build.conversation.some((m) => m.from === 'user' && m.text === 'Please regenerate my plan.'), JSON.stringify([sent('new_plan').length, build.conversation]));
  const stands = build.where_the_cycle_stands;
  check('and is told outright where the cycle stands: what was trained last, what follows it, what has waited longest', stands.last_workout.title === 'Upper body' && stands.last_workout.days_ago === 3 && stands.next_in_the_cycle.title === 'Lower body'
    && stands.muscle_groups_rested_longest_first.indexOf('Quads') < stands.muscle_groups_rested_longest_first.indexOf('Chest'), JSON.stringify(stands));
  st = await state(page);
  const texts = st.chat.map((m) => m.text);
  check('the coach says what it is about to do, from the records', texts.includes('I will build a new plan from your results, starting after Upper body.'), texts.slice(-3).join(' | '));
  check('the plan is replaced, and the one before is kept', st.plan.id !== old.id && st.plan.version === (old.version || 1) + 1 && st.plan.source === 'claude' && st.planBefore.plan.id === old.id, JSON.stringify([st.plan.id, old.id, st.plan.version]));
  check('a plan that opens with the session just trained is turned, so the next one comes first', st.plan.days[0].title === 'Upper body' && st.plan.queue.order[0] === 'd2' && st.plan.days[1].title === 'Lower body', JSON.stringify(st.plan.queue));
  const said = st.chat.slice(-1)[0];
  check('the chat names the session that is really next, and why', said.kind === 'plan' && said.replaced === true && /It carries on from your last workout \(Upper body, 3 days ago\): Lower body is next\./.test(said.text), said.text);
  check('weights from the workout stay in the new plan', st.plan.days[0].exercises[0].load.value === old.days[0].exercises[0].load.value && st.plan.days[0].exercises[0].load.value > 0, JSON.stringify(st.plan.days[0].exercises[0].load));
  await shot(page, '50-rebuild-chat');

  await page.getByTestId('open-plan').click();
  await page.getByTestId('timeline').waitFor();
  const note = await page.getByTestId('last-update').textContent();
  check('the plan screen shows the rebuild: who, when, and what is next', /Updated .* by Claude/.test(note) && /Lower body is next/.test(note) && /Lower body/.test(await page.getByTestId('plan-session').first().textContent())
    && new RegExp(`plan v${old.version + 1}\\.`).test(await page.locator('main').textContent()), `${note} :: ${await page.getByTestId('plan-session').first().textContent()}`);
  await shot(page, '51-rebuild-plan');

  // the way back
  await page.getByTestId('plan-restore').click();
  st = await state(page);
  check('"Put the old plan back" brings back the plan as it was, with its list of changes', st.plan.id === old.id && st.planBefore === null && st.proposals.length > 0 && st.plan.queue.done.join() === 'd1'
    && (await page.getByTestId('plan-restore').count()) === 0, JSON.stringify([st.plan.id, st.planBefore && st.planBefore.plan.id]));
  await tab(page, 'Coach').click();
  check('and the chat says so, with no second way back', /The old plan is back/.test((await state(page)).chat.slice(-1)[0].text) && (await page.getByTestId('restore-plan').count()) === 0);

  // a model that answers with the whole plan in the chat: it is used, so the chat and the plan agree
  const asked = sent('new_plan').length;
  await say(page, 'I want a fresh start.');
  await page.getByTestId('restore-plan').waitFor({ timeout: 8000 });
  st = await state(page);
  check('a plan the model sends in the chat itself becomes the plan, with no second request', st.plan.days.map((d) => d.title).join() === 'Push,Pull,Legs' && sent('new_plan').length === asked && st.planBefore.plan.id === old.id
    && st.chat.slice(-2)[0].text === 'Here is a fresh plan: push, pull and legs.' && /^Your new plan is ready\./.test(st.chat.slice(-1)[0].text), JSON.stringify([st.plan.days.map((d) => d.title), st.chat.slice(-2).map((m) => m.text)]));

  // the coach screen shows the conversation in progress, not the whole history
  st = await state(page);
  const total = st.chat.length;
  const onScreen = () => page.locator('.chat .bubble').count();
  check('the coach screen shows only the last few messages; the rest are a tap away', total > 4 && (await onScreen()) === 4 && (await page.getByTestId('chat-earlier').textContent()).trim() === `Show earlier messages (${total - 4})`
    && (await page.getByTestId('open-plan').count()) === 1
    && (await page.getByText('Tell me about your goal').count()) === 0, `${total} messages, ${await onScreen()} on screen`);
  await shot(page, '52-chat-short');
  await page.getByTestId('chat-earlier').click();
  check('"Show earlier messages" brings them back, above the ones on screen', await until(async () => (await onScreen()) === total) && (await page.getByTestId('chat-earlier').count()) === 0);
  await page.getByTestId('chat-clear').click();
  await page.getByTestId('chat-clear-yes').click();
  st = await state(page);
  check('"Clear chat" empties the chat and leaves the plan alone', st.chat.length === 0 && st.plan.days.length === 3 && st.sessions.length === 1 && (await page.getByText('Tell me about your goal').count()) === 1, JSON.stringify([st.chat.length, st.plan.days.length]));

  // progress in the exercise box: the last few steps (reps added, weight put on) in small print, the rest on request
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('seria.state.v1'));
    const base = st.sessions[0];
    for (let k = 1; k <= 4; k++) { // four older workouts of the same session, each 2 kg lighter than the next
      const c = JSON.parse(JSON.stringify(base));
      c.id = `${base.id}-c${k}`;
      for (const key of ['startedAt', 'endedAt', 'updatedAt']) if (c[key]) c[key] -= k * 3 * 864e5;
      for (const ex of c.exercises) {
        const top = (ex.sets.find((x) => x.actual && x.actual.load) || {}).actual?.load;
        if (!top) continue;
        for (const s of ex.sets) { s.planned.load = Math.max(top - 2 * k, 2); if (s.actual && s.actual.load) s.actual.load = s.planned.load; } // the plan asked for 2 kg less each time further back
      }
      st.sessions.push(c);
    }
    localStorage.setItem('seria.state.v1', JSON.stringify(st));
  });
  await page.reload();
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();
  await openSession(page, 'Push');
  const past = page.getByTestId('day-exercise').first().getByTestId('past');
  const rowText = async (i) => (await past.getByTestId('past-row').nth(i).textContent()).replace(/\s+/g, ' ');
  check('a session shows, for each exercise, its last few steps: when the weight went up or reps were added', (await past.getByTestId('past-row').count()) === 3 && /^Progress: the last 3 steps/.test(await past.textContent()) && /^\d+ \w{3}\s*20 → 22 kg\s*\+2 kg$/.test(await rowText(0))
    && /18 → 20 kg/.test(await rowText(1)) && (await past.getByTestId('past-more').textContent()).trim() === 'Show all 5', `${await past.textContent()} :: ${await rowText(0)}`);
  check('an exercise that has not moved shows nothing there', (await page.getByTestId('day-exercise').nth(2).getByTestId('past').count()) === 0 && (await page.getByTestId('day-exercise').count()) === 3);
  await shot(page, '53-past-day');
  await past.getByTestId('past-more').click();
  check('"Show all" opens the whole list, and it closes again', (await past.getByTestId('past-row').count()) === 5 && /^Progress: all 5 steps/.test(await past.textContent()) && /12 → 14 kg/.test(await rowText(4))
    && (await past.getByTestId('past-more').textContent()).trim() === 'Show fewer');
  await startWith(page, 'start-day');
  if (await until(() => page.getByTestId('today-start').isVisible(), 800)) await startWith(page, 'today-start');
  await main(page).waitFor();
  check('the workout shows the same for the exercise in hand, without the workout in progress', (await page.getByTestId('past').count()) === 1 && (await page.getByTestId('past-row').count()) === 3 && /20 → 22 kg/.test((await page.getByTestId('past-row').first().textContent())));
  await shot(page, '54-past-workout');
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.getByTestId('train-now').waitFor();

  // a button for it too: "Rebuild plan" on the Plan tab builds at once and shows it in the chat
  const idBefore = (await state(page)).plan.id;
  const askedSoFar = sent('new_plan').length;
  check('the Plan tab has a "Rebuild plan" button that says what it does', /^Rebuild plan/.test(await page.getByTestId('rebuild-plan').textContent()) && /kept so you can put it back/.test(await page.getByTestId('rebuild-plan').textContent()));
  await page.getByTestId('rebuild-plan').click();
  await page.getByTestId('restore-plan').waitFor({ timeout: 8000 });
  st = await state(page);
  check('one tap rebuilds the plan, with no second question, and lands in the chat with the way back', st.plan.id !== idBefore && st.planBefore.plan.id === idBefore && sent('new_plan').length === askedSoFar + 1 && page.url().includes('#coach')
    && (await page.getByTestId('assumptions').count()) === 0 && (await page.getByTestId('chat-rebuild').count()) === 1, JSON.stringify([st.plan.id, idBefore]));
  await page.getByTestId('restore-plan').click();
  await until(async () => (await state(page)).plan.id === idBefore);
  await tab(page, 'Plan').click();
  await page.getByTestId('timeline').waitFor();

  // the pairs switch is always on the Plan tab, and in Settings too
  check('the pairs switch is on the Plan tab whatever the plan', (await page.getByTestId('pairs-toggle').count()) === 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#pref-pairs').click();
  st = await state(page);
  check('pairs can also be switched on in Settings', st.profile.pairs === true && (await page.locator('#pref-pairs').getAttribute('aria-checked')) === 'true');

  // the chat alone changes what the plan is built on; the settings are preferences, and the model's own choices stand
  await tab(page, 'Coach').click();
  const builds = sent('new_plan').length;
  const planWas = st.plan.id;
  await say(page, 'Make it two days a week.');
  await until(async () => (await state(page)).plan.id !== planWas, 8000);
  await page.getByTestId('restore-plan').waitFor({ timeout: 8000 });
  st = await state(page);
  const req = sent('new_plan').slice(-1)[0];
  check('saying it in the chat is enough: the setting changes and the plan is rebuilt, with no summary card and no button', st.profile.daysPerWeek === 2 && sent('new_plan').length === builds + 1 && req.profile.sessions_per_week === 2 && req.profile.pair_exercises === true
    && st.plan.id !== planWas && (await page.getByTestId('assumptions').count()) === 0 && st.chat.some((m) => m.text === 'Two days a week it is. I will rebuild the plan for that.'), JSON.stringify([st.profile.daysPerWeek, req.profile.sessions_per_week, st.chat.slice(-2).map((m) => m.text)]));
  check('the settings are preferences: the model laid out three sessions a week, and that stands', st.plan.perWeek === 3 && st.plan.days.length === 3, `${st.plan.perWeek} a week`);
  check('the model chose the supersets itself, and they are used as chosen, even one the app\'s own rule would not make', st.plan.days.every((d) => d.exercises[0].pair && d.exercises[0].pair === d.exercises[1].pair && d.exercises.slice(2).every((x) => !x.pair))
    && st.plan.days[1].exercises[0].pattern === 'squat' && st.plan.days[1].exercises[1].pattern === 'hinge', JSON.stringify(st.plan.days.map((d) => d.exercises.map((x) => `${x.pattern}:${x.pair || '-'}`))));
  check('no script errors in part I', errors.length === 0, errors.join(' | '));
  await context.close();
});


await browser.close();
app.close();
api.server.close();
oai.server.close();

const failed = results.filter((r) => !r.ok);
const summary = { ranAt: new Date().toISOString(), browser: 'Google Chrome (headless), Pixel 7 profile', total: results.length, passed: results.length - failed.length, failed: failed.length, results };
writeFileSync(join(ROOT, 'report', 'smoke-results.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${summary.passed} of ${summary.total} checks passed.`);
process.exit(failed.length ? 1 : 0);
