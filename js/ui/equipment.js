// Equipment tab: what the gym has. Free weights, benches and the pull-up bar
// are there by default; machines are added by the user.

import { html, useState, useRef, useEffect, useStore, Sheet, Icon, toast } from './kit.js';
import * as store from '../store.js';
import { EQUIPMENT, PATTERNS, ZONES, LOADING, isAvailable, isListed, machineDetail, machineLabel } from '../domain/catalog.js';
import { readEquipment } from '../ai/coach.js';
import { aiReady, aiName, sourceName } from '../ai/ai.js';
import { useVoiceInput } from './voice.js';

function setItem(id, value, forget = false) {
  const eq = store.getState().equipment;
  const items = { ...eq.items };
  const details = { ...(eq.details || {}) };
  if (value === undefined) delete items[id]; else items[id] = value;
  if (forget) delete details[id]; // taken off the list: what was known about that machine goes too
  store.set({ equipment: { ...eq, items, details } });
}

const BASIS = {
  web: (d) => `Found on ${d.host || hostOf(d.source) || 'the web'}`,
  memory: () => 'From the model\'s memory, not checked',
  stated: () => 'Maker noted',
};
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** What is saved about the exact machine: how it works and what it isolates. */
export function MachineInfo({ d, open = false }) {
  if (!d) return null;
  const facts = d.how || d.isolates || d.notes;
  return html`<details class="note" data-testid="machine-info" open=${open}>
    <summary><b>${machineLabel(d) || 'This machine'}</b></summary>
    <div class="stack tight small" style="margin-top:8px">
      ${d.isolates && html`<p><span class="muted">Isolates:</span> ${d.isolates}</p>`}
      ${d.how && html`<p><span class="muted">How it works:</span> ${d.how}</p>`}
      ${d.loading && html`<p><span class="muted">Loaded with:</span> ${LOADING[d.loading]}</p>`}
      ${d.notes && html`<p><span class="muted">Good to know:</span> ${d.notes}</p>`}
      ${!facts && html`<p class="muted">Only the maker is saved. Connect Claude or OpenAI in Settings and read the text again to find out how it works and what it isolates.</p>`}
      <p class="muted">${BASIS[d.basis] ? BASIS[d.basis](d) : ''}${d.basis === 'web' && d.source ? html`. <a class="link" href=${d.source} target="_blank" rel="noopener">Open the page</a>` : ''}${d.basis === 'memory' ? '. Check it against the machine itself.' : ''}</p>
    </div>
  </details>`;
}

function Toggle({ on, onChange, name }) {
  return html`<button class=${`chip ${on ? 'on' : ''}`} role="switch" aria-checked=${on} aria-label=${`${name}: ${on ? 'available' : 'not available'}`}
    onClick=${() => onChange(!on)}>${on ? 'Available' : 'Not available'}</button>`;
}

const list = (a) => a.join(', ');

/** Type, paste or dictate what the gym has; it is read and saved in one go. */
function DescribeGym({ hasPlan }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const box = useRef(null);
  const { canSpeak, listening, toggle, stop } = useVoiceInput(text, setText);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(Math.max(el.scrollHeight + 2, 92), 220)}px`; } }, [text]);

  const run = async () => {
    if (!text.trim() || busy) return;
    stop();
    setBusy('Reading…');
    setResult(null);
    const res = await readEquipment(text, (stage, n) => { if (stage === 'lookup') setBusy(`Looking up ${n} machine${n === 1 ? '' : 's'} on the web…`); }).catch(() => null);
    setBusy('');
    if (!res) { toast('That could not be read. Try again.'); return; }
    setResult(res);
    if (res.changed) setText('');
  };

  return html`<div class="stack" data-testid="describe-gym">
    <h4>Tell me what your gym has</h4>
    <p class="small muted">Name the machines or paste any text: a list, a sentence, notes from the gym's website. ${aiReady() ? `${aiName()} reads it` : 'It is read'} and the list is saved. Say "no barbell" for things your gym lacks.</p>
    <p class="small muted">Name the maker too, as in "these are from Technogym: leg press, chest press", and ${aiReady() ? 'the exact machines are identified so the coach knows how each works and what it isolates' : 'the maker is noted. With Claude or OpenAI connected, the exact machines are identified as well'}.</p>
    <div class="composer">
      <textarea id="gym-text" ref=${box} rows="3" value=${text} onInput=${(e) => setText(e.target.value)}
        placeholder=${listening ? 'Listening… speak, then fix the text if needed' : 'For example: these are from Technogym: leg press, chest press. Also cables and a glute drive. No barbell.'}></textarea>
      ${canSpeak && html`<button type="button" class=${`round ${listening ? 'live' : ''}`} aria-label=${listening ? 'Stop recording' : 'Record voice'} aria-pressed=${listening} onClick=${toggle}>
        <${Icon} name=${listening ? 'stop' : 'mic'} /></button>`}
    </div>
    <button class="cta" data-testid="read-gym" disabled=${!!busy || !text.trim()} onClick=${run}>${busy || 'Read and save'}</button>
    ${result && html`<div class="note stack tight" data-testid="gym-result" role="status">
      <div class="spread"><b>${result.changed ? 'Saved' : 'Nothing new to save'}</b><span class="tag">Read by ${result.via === 'rules' ? 'the built-in reader' : sourceName(result.via)}</span></div>
      ${result.note && html`<p class="small muted">${result.note}</p>`}
      ${result.added.length > 0 && html`<p class="small"><span class="muted">Added:</span> ${list(result.added)}</p>`}
      ${result.custom.length > 0 && html`<p class="small"><span class="muted">Added as your own machines:</span> ${list(result.custom)}</p>`}
      ${result.off.length > 0 && html`<p class="small"><span class="muted">Marked as not available:</span> ${list(result.off)}</p>`}
      ${result.already.length > 0 && html`<p class="small"><span class="muted">Already on your list:</span> ${list(result.already)}</p>`}
      ${result.described.length > 0 && html`<div class="stack tight" data-testid="gym-machines">
        <p class="small muted">Machines identified:</p>
        ${result.described.map((d) => html`<p class="small"><b>${d.label || d.name}</b> <span class="muted">· ${d.name} · ${BASIS[d.basis] ? BASIS[d.basis](d).toLowerCase() : ''}</span></p>`)}
        ${result.described.some((d) => d.basis === 'stated') && html`<p class="small muted">Connect Claude or OpenAI in Settings to find out how these machines work and what they isolate.</p>`}
        ${result.described.some((d) => d.basis === 'memory') && !result.couldLookUp && html`<p class="small muted">Inside claude.ai the model cannot search the web, so these come from what it remembers.</p>`}
      </div>`}
      ${result.unknown.length > 0 && html`<p class="small"><span class="muted">Could not place:</span> ${list(result.unknown)}. If one of these is a strength machine, add it below and pick what it trains.</p>`}
      ${result.changed && hasPlan && html`<p class="small muted">Your current plan is unchanged. <a class="link" href="#coach">Ask the coach to rebuild it</a> to use the new equipment.</p>`}
    </div>`}
  </div>`;
}

export function EquipmentScreen() {
  const state = useStore();
  const eq = state.equipment;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('push_h');
  const basics = EQUIPMENT.filter((x) => x.kind === 'basic');
  const mine = EQUIPMENT.filter((x) => x.kind === 'machine' && isListed(eq, x.id));
  const rest = EQUIPMENT.filter((x) => x.kind === 'machine' && !isListed(eq, x.id));

  const addCustom = () => {
    const n = name.trim();
    if (!n) { toast('Give the machine a name'); return; }
    const id = store.newId('cm');
    store.set({ equipment: { ...eq, custom: [...eq.custom, { id, name: n.slice(0, 40), pattern, zone: ZONES.machines }] } });
    setName(''); setAdding(false); toast(`${n} added`);
  };
  const removeCustom = (id) => {
    const items = { ...eq.items }; delete items[id];
    const details = { ...(eq.details || {}) }; delete details[id];
    store.set({ equipment: { items, details, custom: eq.custom.filter((c) => c.id !== id) } });
  };

  return html`<main class="main with-tabs">
    <div class="spread"><div class="stack tight"><p class="eyebrow">Equipment</p><h2>What is available?</h2></div><small>My gym</small></div>

    <div class="stack">
      <div class="row">
        <b>Machines</b>
        <button class="chip accent" data-testid="add-machine" onClick=${() => setAdding(true)}>Add to list</button>
      </div>
      ${mine.map((x) => html`<div class="row" data-testid="machine">
        <span class="stack tight"><b>${x.name}</b><button class="sub" style="text-align:left" onClick=${() => setItem(x.id, undefined, true)}>Remove from list</button></span>
        <${Toggle} name=${x.name} on=${isAvailable(eq, x.id)} onChange=${(v) => setItem(x.id, v)} />
      </div>
      <${MachineInfo} d=${machineDetail(eq, x.id)} />`)}
      ${eq.custom.map((c) => html`<div class="row" data-testid="machine">
        <span class="stack tight"><b>${c.name}</b><span class="sub">${PATTERNS[c.pattern]} · <button class="sub" onClick=${() => removeCustom(c.id)}>Remove</button></span></span>
        <${Toggle} name=${c.name} on=${isAvailable(eq, c.id)} onChange=${(v) => setItem(c.id, v)} />
      </div>
      <${MachineInfo} d=${machineDetail(eq, c.id)} />`)}
      ${!mine.length && !eq.custom.length && html`<p class="muted small">No machines yet. Add the ones your gym has and the plan will use them.</p>`}
    </div>

    <div class="stack">
      <h3>Always there</h3>
      ${basics.map((x) => html`<div class="row">
        <b>${x.name}</b>
        <${Toggle} name=${x.name} on=${isAvailable(eq, x.id)} onChange=${(v) => setItem(x.id, v ? undefined : false)} />
      </div>
      <${MachineInfo} d=${machineDetail(eq, x.id)} />`)}
      <p class="muted small">Free weights, benches and the pull-up bar are available by default. Turn one off if your gym does not have it.</p>
    </div>
    ${state.plan && html`<p class="muted small">Changes here apply to new plans and to swaps. If the current plan uses something you turn off, the Plan tab offers replacements.</p>`}

    ${adding && html`<${Sheet} title="Add machines" onClose=${() => setAdding(false)}>
      <${DescribeGym} hasPlan=${!!state.plan} />
      <div class="rule stack">
        <h4>Or pick from the list</h4>
        ${rest.map((x) => html`<button class="row" onClick=${() => { setItem(x.id, true); toast(`${x.name} added`); }}>
          <b>${x.name}</b><span class="accent">Add</span></button>`)}
        ${!rest.length && html`<p class="muted small">Every machine from the list is already added.</p>`}
      </div>
      <div class="rule stack">
        <h4>Something else?</h4>
        <label class="field"><span>Name on the machine</span>
          <input id="custom-name" class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="For example: Glute drive" maxlength="40" /></label>
        <label class="field"><span>What it trains</span>
          <select id="custom-pattern" class="input" value=${pattern} onChange=${(e) => setPattern(e.target.value)}>
            ${Object.entries(PATTERNS).map(([id, label]) => html`<option value=${id}>${label}</option>`)}
          </select></label>
        <button class="cta ghost" onClick=${addCustom}>Add my machine</button>
      </div>
      <button class="cta" onClick=${() => setAdding(false)}>Done</button>
    <//>`}
  </main>`;
}
