// Settings: connect Claude, workout signals, backup, and the training rules.

import { html, useState, useRef, useStore, useSignal, go, toast } from './kit.js';
import * as store from '../store.js';
import { aiStatus, testConnection } from '../ai/claude.js';
import { inViewer, runtime, onRuntime, saveFile, isStandalone } from '../platform.js';
import { cloud, onCloud, syncNow, CLOUD_TEXT } from '../cloud.js';
import { RULES, SOURCES, RULES_VERSION, RULES_UPDATED, PRESCRIPTION, GOALS } from '../domain/rules.js';

export const APP_VERSION = '1.0.0';
let installEvent = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

function Switch({ label, hint, on, onChange, id }) {
  return html`<div class="row">
    <span class="stack tight"><b>${label}</b>${hint && html`<span class="sub">${hint}</span>`}</span>
    <button id=${id} class=${`chip ${on ? 'on' : ''}`} role="switch" aria-checked=${on} aria-label=${label} onClick=${() => onChange(!on)}>${on ? 'On' : 'Off'}</button>
  </div>`;
}

export function PrefsScreen() {
  const state = useStore();
  useSignal(onRuntime);
  useSignal(onCloud);
  const s = store.getSettings();
  const status = aiStatus();
  const [test, setTest] = useState({ state: 'idle', text: '' });
  const [confirmReset, setConfirmReset] = useState(false);
  const file = useRef(null);

  const runTest = async () => {
    setTest({ state: 'busy', text: 'Asking Claude…' });
    try { setTest({ state: 'ok', text: `Claude answered: “${await testConnection()}”` }); } catch (e) { setTest({ state: 'bad', text: e.message || 'No answer.' }); }
  };
  const doExport = async () => {
    const ok = await saveFile(`seria-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportData());
    toast(ok ? 'Backup ready to save' : 'Could not save a file from this view');
  };
  const doImport = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { store.importData(await f.text()); toast('Backup restored'); } catch (err) { toast(err.message || 'That file could not be read'); }
  };
  const install = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
  };

  return html`<main class="main with-tabs">
    <div class="stack tight"><p class="eyebrow">Settings</p><h2>Set up Seria</h2></div>

    <section class="stack">
      <h3>Claude</h3>
      <p class="small muted">Claude reads what you tell the coach, builds the week and reviews your results. Without it the app still works: a built-in coach asks the same questions and the plan comes from the training rules.</p>
      <div class="note" data-testid="claude-status"><b>${status.label}</b>
        ${inViewer && runtime.sample && html`<span class="small muted">No key needed. Requests use your own Claude plan, and Claude asks your permission the first time.</span>`}
        ${inViewer && !runtime.sample && runtime.settled && html`<span class="small muted">This view does not offer Claude. Open the page from claude.ai while signed in.</span>`}
      </div>
      <${Switch} id="ai-on" label="Use Claude" hint="Turn off to stay fully offline" on=${s.aiOn} onChange=${(v) => store.setSettings({ aiOn: v })} />
      ${!inViewer && html`
        <label class="field"><span>Anthropic API key</span>
          <input id="api-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value=${s.apiKey}
            onInput=${(e) => { store.setSettings({ apiKey: e.target.value.trim() }); setTest({ state: 'idle', text: '' }); }} /></label>
        <p class="small muted">Create a key in the Claude Console (platform.claude.com). It is stored only in this browser and sent only to Anthropic. It is never part of a backup. Anyone who can unlock this phone and open this page could use it, so set a spend limit on the key.</p>
        <label class="field"><span>Model</span>
          <select id="model" class="input" value=${s.model} onChange=${(e) => store.setSettings({ model: e.target.value })}>
            ${store.MODELS.map((m) => html`<option value=${m.id}>${m.label} · ${m.note}</option>`)}
          </select></label>
        <details class="note"><summary>Advanced</summary>
          <label class="field" style="margin-top:8px"><span>API address (leave empty for Anthropic). Use this to send requests through your own relay.</span>
            <input id="base-url" class="input" type="url" placeholder="https://api.anthropic.com" value=${s.baseUrl} onInput=${(e) => store.setSettings({ baseUrl: e.target.value.trim() })} /></label>
        </details>`}
      ${(status.kind === 'api' || status.kind === 'viewer') && html`
        <button class="cta ghost" data-testid="test-claude" disabled=${test.state === 'busy'} onClick=${runTest}>Test the connection</button>
        ${test.text && html`<p class=${`small ${test.state === 'bad' ? '' : 'muted'}`} data-testid="test-result" style=${test.state === 'bad' ? 'color:var(--bad)' : ''}>${test.text}</p>`}`}
    </section>

    <section class="stack">
      <h3>During a workout</h3>
      <${Switch} id="pref-sound" label="Sound when rest ends" on=${s.sound} onChange=${(v) => store.setSettings({ sound: v })} />
      <${Switch} id="pref-vibrate" label="Vibrate when rest ends" on=${s.vibrate} onChange=${(v) => store.setSettings({ vibrate: v })} />
      <${Switch} id="pref-awake" label="Keep the screen on" on=${s.keepAwake} onChange=${(v) => store.setSettings({ keepAwake: v })} />
    </section>

    <section class="stack">
      <h3>Your data</h3>
      <div class="note" data-testid="data-status">
        <b>${inViewer ? CLOUD_TEXT[cloud.status] : 'Saved in this browser on this device'}</b>
        <span class="small muted">${inViewer
          ? 'Inside claude.ai your plan and history are kept in your private space for this page, so they follow you to another device.'
          : 'Nothing leaves the phone except what you send to Claude. Clearing site data in the browser removes it, so keep a backup.'}</span>
        ${!store.storageWorks() && html`<span class="small" style="color:var(--bad)">This browser is not letting the page save. Changes may be lost on reload.</span>`}
      </div>
      ${inViewer && cloud.status !== 'off' && html`<button class="cta ghost" onClick=${() => { syncNow(); toast('Syncing…'); }}>Sync now</button>`}
      <p class="small muted">${state.sessions.filter((x) => x.status === 'done').length} workouts · plan ${state.plan ? `v${state.plan.version}` : 'not built yet'}</p>
      <button class="cta ghost" data-testid="export" onClick=${doExport}>Save a backup file</button>
      <button class="cta ghost" onClick=${() => file.current.click()}>Restore from a backup file</button>
      <input ref=${file} id="import-file" type="file" accept="application/json,.json" hidden onChange=${doImport} />
      ${!confirmReset && html`<button class="cta danger" onClick=${() => setConfirmReset(true)}>Erase everything</button>`}
      ${confirmReset && html`<div class="note warn"><b>Erase the plan, history and chat?</b><span class="small muted">This cannot be undone. Your API key stays.</span>
        <div class="chips" style="margin-top:8px">
          <button class="chip danger" data-testid="confirm-reset" onClick=${() => { store.resetAll(); setConfirmReset(false); toast('Everything erased'); go('plan'); }}>Yes, erase</button>
          <button class="chip" onClick=${() => setConfirmReset(false)}>Cancel</button></div></div>`}
    </section>

    ${!inViewer && html`<section class="stack">
      <h3>On your home screen</h3>
      ${isStandalone() ? html`<p class="small muted">Seria is installed and opens like an app.</p>` : html`
        <p class="small muted">In Chrome on Android open the ⋮ menu and choose “Add to Home screen”. Seria then opens full screen like an app and keeps working with no signal.</p>
        ${installEvent && html`<button class="cta ghost" onClick=${install}>Install Seria</button>`}`}
    </section>`}

    <section class="stack">
      <h3>About</h3>
      <button class="row" onClick=${() => go('rules')}><span class="stack tight"><b>Training rules v${RULES_VERSION}</b><span class="sub">What the plan is based on, with sources</span></span><span class="accent">Read</span></button>
      <p class="small muted">Seria ${APP_VERSION}. Not medical advice. Stop if something hurts and see a professional.</p>
    </section>
  </main>`;
}

export function RulesScreen() {
  const areas = [...new Set(RULES.map((r) => r.area))];
  return html`<main class="main with-tabs">
    <div class="stack tight"><p class="eyebrow">Training rules · v${RULES_VERSION} · ${RULES_UPDATED}</p><h2>What the plan is based on</h2>
      <p class="muted">The plan generator, the suggestions during and after a workout, and Claude all work from this one set of rules.</p></div>
    ${areas.map((a) => html`<section class="stack">
      <h3>${a}</h3>
      ${RULES.filter((r) => r.area === a).map((r) => html`<div class="rule stack tight">
        <p><b>${r.id}</b> ${r.text}</p>
        <p class="cite">Source: ${r.sources.map((id) => SOURCES[id].short).join('; ')}</p>
      </div>`)}
    </section>`)}
    <section class="stack">
      <h3>Sets, reps and rest by goal</h3>
      ${Object.entries(PRESCRIPTION).map(([g, tiers]) => html`<div class="rule stack tight">
        <b>${GOALS[g].label}</b>
        ${Object.entries(tiers).map(([t, p]) => html`<p class="small muted">${t}: ${p.sets} × ${p.repLo}-${p.repHi}, rest ${p.rest} s</p>`)}
      </div>`)}
    </section>
    <section class="stack">
      <h3>Sources</h3>
      ${Object.values(SOURCES).map((src) => html`<p class="cite">${src.cite}${src.url ? html` <a class="link" href=${src.url} target="_blank" rel="noopener">${src.url.replace('https://', '')}</a>` : ''}</p>`)}
    </section>
  </main>`;
}
