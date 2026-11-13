// Equipment tab: what the gym has. Free weights, benches and the pull-up bar
// are there by default; machines are added by the user.

import { html, useState, useRef, useEffect, useStore, Sheet, Icon, toast } from './kit.js';
import * as store from '../store.js';
import { EQUIPMENT, PATTERNS, ZONES, isAvailable, isListed } from '../domain/catalog.js';
import { readEquipment } from '../ai/coach.js';
import { aiReady } from '../ai/claude.js';
import { useVoiceInput } from './voice.js';

function setItem(id, value) {
  const eq = store.getState().equipment;
  const items = { ...eq.items };
  if (value === undefined) delete items[id]; else items[id] = value;
  store.set({ equipment: { ...eq, items } });
}

function Toggle({ on, onChange, name }) {
  return html`<button class=${`chip ${on ? 'on' : ''}`} role="switch" aria-checked=${on} aria-label=${`${name}: ${on ? 'available' : 'not available'}`}
    onClick=${() => onChange(!on)}>${on ? 'Available' : 'Not available'}</button>`;
}

const list = (a) => a.join(', ');

/** Type, paste or dictate what the gym has; it is read and saved in one go. */
function DescribeGym({ hasPlan }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const box = useRef(null);
  const { canSpeak, listening, toggle, stop } = useVoiceInput(text, setText);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(Math.max(el.scrollHeight + 2, 92), 220)}px`; } }, [text]);

  const run = async () => {
    if (!text.trim() || busy) return;
    stop();
    setBusy(true);
    setResult(null);
    const res = await readEquipment(text).catch(() => null);
    setBusy(false);
    if (!res) { toast('That could not be read. Try again.'); return; }
    setResult(res);
    if (res.changed) setText('');
  };

  return html`<div class="stack" data-testid="describe-gym">
    <h4>Tell me what your gym has</h4>
    <p class="small muted">Name the machines or paste any text: a list, a sentence, notes from the gym's website. ${aiReady() ? 'Claude reads it' : 'It is read'} and the list is saved. Say "no barbell" for things your gym lacks.</p>
    <div class="composer">
      <textarea id="gym-text" ref=${box} rows="3" value=${text} onInput=${(e) => setText(e.target.value)}
        placeholder=${listening ? 'Listening… speak, then fix the text if needed' : 'For example: lat pulldown, leg press, cables, a glute drive. No barbell.'}></textarea>
      ${canSpeak && html`<button type="button" class=${`round ${listening ? 'live' : ''}`} aria-label=${listening ? 'Stop recording' : 'Record voice'} aria-pressed=${listening} onClick=${toggle}>
        <${Icon} name=${listening ? 'stop' : 'mic'} /></button>`}
    </div>
    <button class="cta" data-testid="read-gym" disabled=${busy || !text.trim()} onClick=${run}>${busy ? 'Reading…' : 'Read and save'}</button>
    ${result && html`<div class="note stack tight" data-testid="gym-result" role="status">
      <div class="spread"><b>${result.changed ? 'Saved' : 'Nothing new to save'}</b><span class="tag">${result.via === 'claude' ? 'Read by Claude' : 'Read by the built-in reader'}</span></div>
      ${result.note && html`<p class="small muted">${result.note}</p>`}
      ${result.added.length > 0 && html`<p class="small"><span class="muted">Added:</span> ${list(result.added)}</p>`}
      ${result.custom.length > 0 && html`<p class="small"><span class="muted">Added as your own machines:</span> ${list(result.custom)}</p>`}
      ${result.off.length > 0 && html`<p class="small"><span class="muted">Marked as not available:</span> ${list(result.off)}</p>`}
      ${result.already.length > 0 && html`<p class="small"><span class="muted">Already on your list:</span> ${list(result.already)}</p>`}
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
    store.set({ equipment: { items, custom: eq.custom.filter((c) => c.id !== id) } });
  };

  return html`<main class="main with-tabs">
    <div class="spread"><div class="stack tight"><p class="eyebrow">Equipment</p><h2>What is available?</h2></div><small>My gym</small></div>

    <div class="stack">
      <div class="row">
        <b>Machines</b>
        <button class="chip accent" data-testid="add-machine" onClick=${() => setAdding(true)}>Add to list</button>
      </div>
      ${mine.map((x) => html`<div class="row" data-testid="machine">
        <span class="stack tight"><b>${x.name}</b><button class="sub" style="text-align:left" onClick=${() => setItem(x.id, undefined)}>Remove from list</button></span>
        <${Toggle} name=${x.name} on=${isAvailable(eq, x.id)} onChange=${(v) => setItem(x.id, v)} />
      </div>`)}
      ${eq.custom.map((c) => html`<div class="row" data-testid="machine">
        <span class="stack tight"><b>${c.name}</b><span class="sub">${PATTERNS[c.pattern]} · <button class="sub" onClick=${() => removeCustom(c.id)}>Remove</button></span></span>
        <${Toggle} name=${c.name} on=${isAvailable(eq, c.id)} onChange=${(v) => setItem(c.id, v)} />
      </div>`)}
      ${!mine.length && !eq.custom.length && html`<p class="muted small">No machines yet. Add the ones your gym has and the plan will use them.</p>`}
    </div>

    <div class="stack">
      <h3>Always there</h3>
      ${basics.map((x) => html`<div class="row">
        <b>${x.name}</b>
        <${Toggle} name=${x.name} on=${isAvailable(eq, x.id)} onChange=${(v) => setItem(x.id, v ? undefined : false)} />
      </div>`)}
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
