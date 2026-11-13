// Builds report/report.html from the real smoke-test results, so the numbers
// in the report are the numbers the tests produced. Run after npm run smoke:shots.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, SOURCES, RULES_VERSION } from '../js/domain/rules.js';
import { EXERCISES, EQUIPMENT } from '../js/domain/catalog.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const smoke = JSON.parse(readFileSync(`${root}report/smoke-results.json`, 'utf8'));
const APP_URL = 'https://claude.ai/artifact/BGZFQ5nHaNbfV9Qvgw13Ui';
const LIVE_URL = 'https://dglowinski.github.io/seria/';
const REPO_URL = 'https://github.com/dglowinski/seria';
const livePath = `${root}report/live-check.json`;
const live = existsSync(livePath) ? JSON.parse(readFileSync(livePath, 'utf8')) : null;

// Unit tests: run them here and count, rather than typing a number.
let unit = { pass: 0, fail: 0 };
try {
  const out = execFileSync('node', ['--test', ...['domain', 'coach'].map((n) => `${root}tests/${n}.test.js`)], { encoding: 'utf8' });
  unit = { pass: Number(out.match(/pass (\d+)/)[1]), fail: Number(out.match(/fail (\d+)/)[1]) };
} catch (e) {
  const out = String(e.stdout || '');
  unit = { pass: Number((out.match(/pass (\d+)/) || [0, 0])[1]), fail: Number((out.match(/fail (\d+)/) || [0, 1])[1]) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parts = [...new Set(smoke.results.map((r) => r.part))];
const PART_TEXT = {
  'A built-in': ['No Claude', 'The built-in coach, the rule-based plan, a full workout with a reload in the middle, history, backup and restore.'],
  'B Claude API': ['Claude through the API', 'The real Anthropic SDK in the browser, talking to a local stand-in for api.anthropic.com. Checks the request the app sends, late and failed answers, and a wrong key.'],
  'C in claude.ai': ['Inside claude.ai', 'A stand-in for the runtime claude.ai gives the page: cloud records, Claude, dictation. Includes moving to a fresh browser and getting everything back.'],
  'D install and offline': ['Home screen and offline', 'The install files, the icons, and starting the app with the network switched off.'],
  'E single file': ['The published file', 'The one-file build that is published on claude.ai, run end to end.'],
};
const shots = [
  ['02-coach', 'Coach', 'You type or speak. The coach asks only for what is missing.'],
  ['03-assumptions', 'Assumptions', 'Before any plan is built you see what it will be based on.'],
  ['04-plan', 'Plan', 'The week: day, body part, estimated time.'],
  ['06-day', 'Day preview', 'Order, equipment, sets, reps, rest, and how the time adds up.'],
  ['05-equipment', 'Equipment', 'Machines you add. Free weights, bench and bar are on by default.'],
  ['05-gym-text', 'Describe your gym', 'Name the machines or paste any text. It is read and saved, and you see what was added.'],
  ['07-starting-weight', 'Starting weight', 'No history yet, so you pick the first weight.'],
  ['08-set-active', 'Set in progress', 'One button: Finish set.'],
  ['09-set-result', 'Set result', 'Starts from the plan. Correct by 1 or 2, or type the number.'],
  ['10-rest', 'Rest', 'Countdown, next set, and a suggestion with Apply or Keep plan.'],
  ['11-swap', 'Swap', 'Station busy: same movement on other equipment you have.'],
  ['12-summary', 'Summary', 'Time, sets done, skipped sets, biggest differences.'],
  ['13-proposals', 'Proposals', 'Old value, new value, reason. Nothing changes until you tap Apply.'],
  ['15-session-detail', 'History, one workout', 'Every set: plan and result. Tap a set to correct it.'],
  ['18-claude-hint', 'Claude mid-workout', 'Claude\'s suggestion replaces the rule-based one if it arrives in time.'],
  ['21-viewer-settings', 'Inside claude.ai', 'Claude connected with no key.'],
  ['16-rules', 'Training rules', 'The rules and their sources, readable in the app.'],
].filter(([f]) => existsSync(`${root}report/shots/${f}.png`));

const spec = [
  ['Navigation: Plan, Coach, History, Equipment. The workout has its own screen with one main action in thumb reach.', 'done', 'Four tabs at the bottom. The workout screen hides them and keeps one big button at the bottom whose label follows the step.'],
  ['Say or type your goal, experience, days and time per session. Voice goes into a text field you can edit.', 'done', 'Coach chat with a microphone button. Speech lands in the text box; you fix it, then send.'],
  ['The coach asks for missing details and shows its assumptions before building the plan.', 'done', 'Works with Claude and without. No plan is created until you tap "Build my plan" under the assumptions.'],
  ['Preferences and movement limitations.', 'done', 'Reads things like "no deadlifts", "I love pull-ups", "my knee hurts". Limitations are handled on the careful side and the app says what it left out.'],
  ['You enter machines. Free weights, benches and the pull-up bar are available by default.', 'done', `${EQUIPMENT.filter((x) => x.kind === 'machine').length} machines to pick from, plus your own machine with what it trains. Or describe the gym in your own words, typed, pasted or spoken: it is read (by Claude when connected, by a built-in reader otherwise) and the list is saved in one go. Each item has an Available switch.`],
  ['The plan shows days, body parts, time, exercise order, equipment, sets, reps, weight or how to choose it, and rests. Day time includes warm-up, rests and moving between stations.', 'done', `Plan list and day preview. ${EXERCISES.length} exercises in the catalog. The day preview splits the time into warm-up, sets, rests and moving.`],
  ['"Start set" shows the active set. "Finish set" opens the result, starting from the planned value. Correct reps by 1 or 2 or type them. Change weight, add reps in reserve.', 'done', 'As described. Reps in reserve is optional.'],
  ['Saving starts the countdown. After the last set the screen shows the next exercise.', 'done', 'Saving takes effect at once and never waits for Claude.'],
  ['For a busy machine, pick a substitute from available equipment.', 'done', '"Machine busy? Swap" lists exercises with the same movement on equipment you marked available. The swap is for that workout only.'],
  ['Coming back to the tab restores the saved sets and the rest time left, from the time the rest ends.', 'done', 'Every tap is saved. The rest is stored as an end time. Tested by reloading in the middle of a rest.'],
  ['With no history, the screen asks for a starting weight. Loads are kept as weight per dumbbell, total weight, machine setting, or bodyweight.', 'done', 'Four load types, each with its own label and step size.'],
  ['A session keeps plan and result for every set, also after the plan changes. The summary shows done and skipped sets, time and the biggest differences. A wrong entry can be corrected.', 'done', 'Each workout stores its own copy of the plan. Sets can be corrected during the workout and later from History.'],
  ['During a session, AI may propose a change to a set or exercise not done yet. After it, AI compares with earlier results and proposes updates. Each proposal shows the change, a short reason, and Apply or Keep plan.', 'mostly', 'Both work, from the training rules at once and from Claude when connected. One gap: mid-workout, Claude can change weight, reps or rest of sets still to come, but it does not swap an exercise by itself. You do that with the Swap button.'],
  ['AI stays off the main path. With no answer, carry on with the last approved plan. A late suggestion shows only if it is about a part not done yet.', 'done', 'Tested with a slow answer, a late answer and a failing server.'],
  ['A versioned library of training rules with sources, used by the plan generator and by the updates. A source document plus a rule set the app uses.', 'done', `Version ${RULES_VERSION}: ${RULES.length} rules, ${Object.values(SOURCES).filter((s) => s.url).length} published sources. One file drives the generator, the suggestions, the Claude prompt and the generated document.`],
  ['The AI prompt: modes for a new plan, during a session and after a session; asks when information is missing; uses only recorded data; returns questions, a plan or a list of changes with reasons; returns an empty list when nothing is justified.', 'done', 'One prompt and one answer format for all modes, plus an interview mode for the chat. The app fills in the "previous value" itself and drops anything that does not match its records.'],
];

const bugs = [
  ['Finishing a workout opened the plan, not the summary.', 'Two redirects ran at once and the wrong one won. Now only one place decides.'],
  ['The rest timer could show one second too many right after saving.', 'The screen used a slightly old clock reading. It now reads the time fresh.'],
  ['The page could stay on "Loading" inside claude.ai.', 'If the cloud answered before the screen was listening, the signal was missed. The screen now checks again right after it starts listening.'],
  ['A new phone could overwrite the cloud copy with an empty plan.', 'Found while reading the sync code, not by a test. The app now waits for the cloud copy before letting you change anything, and an empty device never replaces a cloud copy that has a plan. Tests added.'],
  ['The newest chat message hid behind the text box.', 'The chat now scrolls the whole page so the last message clears the box.'],
];

const limits = [
  ['No real call to Claude was made.', 'There is no API key on this machine. The API path was run with the official SDK against a local stand-in, and the request was checked field by field. The first real call could still be turned down by the API for a reason a stand-in cannot show.'],
  ['The live claude.ai page was not opened by me.', 'It is published, and I wrote, read back and deleted a test record in its cloud storage. But I could not open it in a signed-in browser from here, so the real permission prompts for Claude and for dictation are untested. The page logic was tested against a stand-in written from the runtime\'s published type definitions.'],
  ['No real Android phone.', 'Everything, the live site included, ran in desktop Chrome with a Pixel 7 screen profile. Chrome reports nothing that blocks installing, but the actual "Add to Home screen" tap, vibration, the screen staying on, and Chrome\'s own speech recognition can only be tried on a phone.'],
];

const page = `<title>Seria build report</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: one reading column; screenshots in a scrolling strip of phones. */
:root {
  --bg: #f5f6f1; --panel: #ffffff; --ink: #171b16; --muted: #586355; --line: #d6dccf;
  --accent: #3f5e00; --accent-bg: #d0fa77; --on-accent: #18200e; --warn: #8a5a00; --warn-bg: #fff2cf;
  --font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111411; --panel: #1a1f1a; --ink: #f3f6ed; --muted: #b0bbab; --line: #343d33;
  --accent: #d0fa77; --accent-bg: #d0fa77; --on-accent: #18200e; --warn: #f2c66d; --warn-bg: #2b2616; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #111411; --panel: #1a1f1a; --ink: #f3f6ed; --muted: #b0bbab; --line: #343d33;
  --accent: #d0fa77; --accent-bg: #d0fa77; --on-accent: #18200e; --warn: #f2c66d; --warn-bg: #2b2616; color-scheme: dark }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 var(--font); }
.wrap { max-width: 860px; margin: 0 auto; padding-block: 44px 72px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 44px; }
h1, h2, h3, p, ul, ol, figure { margin: 0; }
h1 { font-size: clamp(38px, 8vw, 64px); line-height: 1; letter-spacing: -.06em; text-wrap: balance; }
h1 i { color: var(--accent); font-style: normal; }
h2 { font-size: 26px; line-height: 1.15; letter-spacing: -.035em; text-wrap: balance; }
h3 { font-size: 17px; letter-spacing: -.01em; }
.eyebrow { color: var(--accent); font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.lead { font-size: 19px; max-width: 62ch; }
p, li { max-width: 68ch; }
.muted { color: var(--muted); }
section { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
a { color: var(--accent); font-weight: 650; overflow-wrap: anywhere; }
code { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }
.nums { display: flex; flex-wrap: wrap; gap: 14px 34px; }
.nums div { min-width: 0; }
.nums strong { display: block; font-size: 40px; line-height: 1.1; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
.nums span { color: var(--muted); font-size: 14px; }
.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.card ul { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.pill { display: inline-block; font-size: 12px; font-weight: 750; letter-spacing: .04em; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.pill.done { background: var(--accent-bg); color: var(--on-accent); }
.pill.mostly { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn); }
.rows { display: flex; flex-direction: column; }
.rowx { display: grid; grid-template-columns: minmax(0, 5fr) 74px minmax(0, 6fr); gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
.rowx.head { border-top: 0; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; padding-bottom: 6px; }
.strip { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 10px; scroll-snap-type: x proximity; }
.strip figure { flex: 0 0 232px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; }
.strip img { width: 232px; height: auto; display: block; border-radius: 18px; border: 1px solid var(--line); background: #111411; }
.strip figcaption { font-size: 13px; color: var(--muted); }
.strip figcaption b { display: block; color: var(--ink); font-size: 14px; }
.pair { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
.pair b { font-weight: 650; }
details { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; background: var(--panel); }
summary { cursor: pointer; font-weight: 650; }
details ul { padding-left: 18px; margin-top: 8px; font-size: 14px; color: var(--muted); display: flex; flex-direction: column; gap: 2px; }
.tick { color: var(--accent); font-weight: 800; }
.bar { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
ol.steps { padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
@media (max-width: 640px) {
  .two { grid-template-columns: 1fr; }
  .rowx { grid-template-columns: 1fr; gap: 6px; } .rowx.head { display: none; }
  .pair { grid-template-columns: 1fr; gap: 4px; }
}
</style>
<div class="wrap">
  <header style="display:flex;flex-direction:column;gap:14px">
    <p class="eyebrow">Build report · ${new Date(smoke.ranAt).toISOString().slice(0, 10)}</p>
    <h1>Seria<i>.</i> is built and tested</h1>
    <p class="lead">The design file is now a working app in English. It builds a training week from a conversation, guides each set with a rest timer, keeps a history, and proposes changes. It runs in the phone's browser and goes on the home screen. No developer mode, no app to install by hand. Both ways of running it are live.</p>
    <div class="nums">
      <div><strong>${smoke.passed} / ${smoke.total}</strong><span>end-to-end checks passed</span></div>
      <div><strong>${unit.pass} / ${unit.pass + unit.fail}</strong><span>unit tests passed</span></div>
      ${live ? `<div><strong>${live.passed} / ${live.total}</strong><span>checks passed on the live site</span></div>` : ''}
      <div><strong>${spec.filter((s) => s[1] === 'done').length} / ${spec.length}</strong><span>spec items fully done</span></div>
    </div>
  </header>

  <section>
    <p class="eyebrow">Start here</p>
    <h2>Two ways to put it on your Android phone</h2>
    <div class="two">
      <div class="card">
        <h3>1. The claude.ai page. Works now.</h3>
        <p>Open <a href="${APP_URL}">${APP_URL.replace('https://', '')}</a> in Chrome on the phone, signed in to claude.ai. Then the ⋮ menu, "Add to Home screen".</p>
        <ul>
          <li>Plan and history are saved to your private cloud space.</li>
          <li>Claude is built in. No API key. It asks your permission once and uses your Claude plan.</li>
          <li>Voice input through claude.ai dictation.</li>
          <li>Needs a connection to open. Only you can open the link.</li>
        </ul>
      </div>
      <div class="card">
        <h3>2. The stand-alone app. Live.</h3>
        <p>Open <a href="${LIVE_URL}">${LIVE_URL.replace('https://', '')}</a> in Chrome on the phone. Then the ⋮ menu, "Add to Home screen" or "Install app".</p>
        <ul>
          <li>Opens full screen and starts with no signal.</li>
          <li>Data stays in the phone's browser. Backup file in Settings.</li>
          <li>For Claude, paste your own API key in Settings. Without one, the built-in coach and the rules do the job.</li>
          <li>Served by GitHub Pages from <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>. The repository is public, because the free plan only hosts Pages from public repositories.</li>
        </ul>
      </div>
    </div>
  </section>

  <section>
    <p class="eyebrow">Screens</p>
    <h2>What it looks like</h2>
    <p class="muted">Taken by the smoke test in headless Chrome with a Pixel 7 screen profile. Colours and type come from the design file. Scroll sideways.</p>
    <div class="strip">
      ${shots.map(([f, t, c]) => `<figure><img src="shots/${f}.png" alt="${esc(t)} screen" loading="lazy" width="412" height="839"><figcaption><b>${esc(t)}</b>${esc(c)}</figcaption></figure>`).join('\n      ')}
    </div>
  </section>

  <section>
    <p class="eyebrow">Against the spec</p>
    <h2>What the design asked for and what the app does</h2>
    <div class="rows">
      <div class="rowx head"><span>The design says</span><span>Status</span><span>The app does</span></div>
      ${spec.map(([a, s, b]) => `<div class="rowx"><span>${esc(a)}</span><span><span class="pill ${s}">${s === 'done' ? 'Done' : 'Mostly'}</span></span><span class="muted">${esc(b)}</span></div>`).join('\n      ')}
    </div>
  </section>

  <section>
    <p class="eyebrow">Claude</p>
    <h2>How Claude is hooked up</h2>
    <p>Claude reads what you tell the coach, builds the week, and reviews results during and after a workout. It is connected in whichever way works where the page runs.</p>
    <div class="two">
      <div class="card"><h3>Inside claude.ai</h3><p class="muted">The page asks the viewer's own Claude. Nothing to set up. A quick model tier is used for mid-workout checks and the default tier for plans.</p></div>
      <div class="card"><h3>On your own address</h3><p class="muted">The official Anthropic SDK, called straight from the browser with your key. Default model <code>claude-opus-5-5</code>; Sonnet 5.5, Haiku 5.5 and Fable 5.2 can be picked in Settings.</p></div>
    </div>
    <ul style="padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>One prompt for every job. It carries the whole rules library, so Claude and the built-in generator work from the same rules.</li>
      <li>Answers come back in a fixed JSON shape. The app then checks them against its own records: unknown exercises are dropped, numbers are clamped, and the "previous value" shown to you always comes from the app.</li>
      <li>Refusal fallback is switched on. If Claude's safety filters decline a request, the API retries it on another model by itself. This is the recommended default; tell me if you want it off.</li>
      <li>Claude is never in the way. Saving a set does not wait for it. If it is off, slow or failing, you carry on with the last approved plan and the rule-based suggestions.</li>
      <li>Your key stays in that browser, goes only to Anthropic, and is left out of backups. Set a spend limit on it.</li>
    </ul>
  </section>

  <section>
    <p class="eyebrow">Smoke test</p>
    <h2>${smoke.passed} of ${smoke.total} end-to-end checks pass</h2>
    <p class="muted">Run with <code>npm run smoke</code>. Real app, real Chrome (headless), phone-sized screen, no network and no real API key. Last run ${new Date(smoke.ranAt).toISOString().replace('T', ' ').slice(0, 16)} UTC.</p>
    <div class="bar" role="img" aria-label="${smoke.passed} of ${smoke.total} checks passed"><i style="width:${(smoke.passed / smoke.total) * 100}%"></i></div>
    ${parts.map((p) => {
    const rs = smoke.results.filter((r) => r.part === p);
    const ok = rs.filter((r) => r.ok).length;
    const [title, text] = PART_TEXT[p] || [p, ''];
    return `<details><summary>${esc(title)}: ${ok} of ${rs.length}</summary><p class="muted" style="margin-top:8px;font-size:14px">${esc(text)}</p><ul>${rs.map((r) => `<li><span class="tick">${r.ok ? '✓' : '✗'}</span> ${esc(r.name)}${r.ok ? '' : ` <b>(${esc(r.detail)})</b>`}</li>`).join('')}</ul></details>`;
  }).join('\n    ')}
    ${live ? `<details><summary>The live site: ${live.passed} of ${live.total}</summary><p class="muted" style="margin-top:8px;font-size:14px">Run against ${esc(live.url)} with <code>npm run check:live</code>, ${new Date(live.ranAt).toISOString().replace('T', ' ').slice(0, 16)} UTC. Real network, then the network switched off.</p><ul>${live.results.map((r) => `<li><span class="tick">${r.ok ? '✓' : '✗'}</span> ${esc(r.name)}${r.ok ? '' : ` <b>(${esc(r.detail)})</b>`}</li>`).join('')}</ul></details>` : ''}
    <p class="muted">Plus ${unit.pass} unit tests (<code>npm test</code>) for the rules, the plan generator, the workout steps, the suggestions, the text reader, the request format and the cloud merge.</p>
  </section>

  <section>
    <p class="eyebrow">Found and fixed</p>
    <h2>Bugs caught along the way</h2>
    <div>${bugs.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">Read this part</p>
    <h2>What I could not test</h2>
    <div>${limits.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">Choices</p>
    <h2>Decisions I made where the design was silent</h2>
    <ul style="padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li><b>It works without Claude.</b> A built-in coach asks the same questions and the plan comes from the rules. Claude makes it better; it is not required.</li>
      <li><b>The phone's copy is the working copy.</b> The cloud copy inside claude.ai is a mirror that is written a moment later, so the gym's bad signal never blocks a tap.</li>
      <li><b>Kilograms only.</b></li>
      <li><b>Limitations are handled carefully.</b> "My knee hurts" leaves out squats, lunges, leg press and leg extensions, and the app tells you so you can add things back. It is not medical advice and says so.</li>
      <li><b>Research and app choices are labelled apart.</b> All ${Object.values(SOURCES).filter((s) => s.url).length} journal references were checked against their DOI records. Numbers that are my own practical choices, such as the 5% and 10% load drops, are marked "App convention" in the rules.</li>
      <li><b>One day off is not a trend.</b> A single short session changes nothing. Two in a row at the same weight proposes a 10% step back.</li>
    </ul>
  </section>

  <section>
    <p class="eyebrow">Next</p>
    <h2>What to do now</h2>
    <ol class="steps">
      <li>Open the claude.ai page on your phone and add it to the home screen. Tell the coach how you want to train.</li>
      <li>Do one real workout. That is the test I could not run: a real phone, real Claude, a real gym.</li>
      <li>Or use the stand-alone app at <a href="${LIVE_URL}">${LIVE_URL.replace('https://', '')}</a> if you want it to work with no signal. The two copies do not share data; a backup file moves it across.</li>
      <li>For Claude on the stand-alone app, create an API key with a spend limit and paste it in Settings, then tap "Test the connection". That will be the first real call to the API.</li>
    </ol>
    <p class="muted">Code: <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>, also in <code>~/seria</code>. Start with <code>README.md</code>. The rules are in <code>docs/training-rules.md</code>. A push to <code>main</code> runs the unit tests and republishes the app.</p>
  </section>
</div>
`;

writeFileSync(`${root}report/report.html`, page);
console.log(`report/report.html  ${Math.round(page.length / 1024)} KB, ${shots.length} screenshots, unit ${unit.pass}/${unit.pass + unit.fail}, smoke ${smoke.passed}/${smoke.total}`);
