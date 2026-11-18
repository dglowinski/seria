// Pick an exercise by hand: one to add to the workout in progress, or one to do
// in place of an exercise whose station is taken. Everything the gym's
// equipment allows is listed by muscle group, with a search box on top. A
// machine that is not on the list can be named here; it is saved with the
// gym's equipment, so it is there the next time too.

import { html, useState, Sheet, toast } from './kit.js';
import * as store from '../store.js';
import { allExercises, canDo, equipmentNames, exerciseById, sketchForExercise, GROUP_OF, PATTERNS, ZONES } from '../domain/catalog.js';
import { fmtLoadShort } from '../domain/planner.js';
import { Sketch } from './sketch.js';

const GROUPS = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings and glutes', 'Calves', 'Biceps', 'Triceps', 'Core'];

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.intro] one line under the title
 * @param {string[]} [props.exclude] exercise ids to leave out: the ones already in the workout
 * @param {string} [props.like] a movement id: its muscle group is listed first, and a new machine trains it unless told otherwise
 * @param {string} props.label the word on each row: "Add" or "Use"
 * @param {(exercise: object) => void} props.onPick called with the catalog exercise
 * @param {() => void} props.onClose
 */
export function ExercisePicker({ title, intro, exclude = [], like = null, label = 'Add', onPick, onClose }) {
  const state = store.getState();
  const eq = state.equipment;
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState(like && PATTERNS[like] ? like : 'push_h');
  const out = new Set(exclude);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (x) => { const hay = `${x.name} ${equipmentNames(eq, x)} ${GROUP_OF[x.pattern] || ''} ${PATTERNS[x.pattern] || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
  const list = allExercises(eq).filter((x) => canDo(eq, x) && !out.has(x.id) && hit(x));
  const first = like ? GROUP_OF[like] : null;
  const order = first ? [first, ...GROUPS.filter((g) => g !== first)] : GROUPS;
  const rank = (x) => (x.pattern === like ? -1 : 0) + x.rank / 100;

  // A machine the list does not have: saved as one of the gym's own, then used at once.
  const addOwn = () => {
    const n = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!n) { toast('Give the machine a name'); document.getElementById('pick-own-name')?.focus(); return; }
    const cur = store.getState().equipment;
    const same = cur.custom.find((c) => c.name.toLowerCase() === n.toLowerCase());
    const id = same?.id || store.newId('cm');
    if (!same) store.set({ equipment: { ...cur, custom: [...cur.custom, { id, name: n, pattern, zone: ZONES.machines }] } });
    else if (cur.items[id] === false) store.set({ equipment: { ...cur, items: { ...cur.items, [id]: true } } });
    const made = exerciseById(store.getState().equipment, `ex_${id}`);
    if (made) onPick(made);
  };

  return html`<${Sheet} title=${title} onClose=${onClose}>
    ${intro && html`<p class="small muted">${intro}</p>`}
    <input id="pick-search" class="input" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Search: name, muscle or equipment" aria-label="Search exercises" autocomplete="off" />
    <div class="stack" data-testid="pick-list">
      ${order.map((g) => {
        const rows = list.filter((x) => GROUP_OF[x.pattern] === g).sort((a, b) => rank(a) - rank(b));
        if (!rows.length) return null;
        return html`<p class="eyebrow">${g}</p>
          ${rows.map((x) => {
            const look = sketchForExercise(eq, x);
            const known = state.weights[x.id];
            return html`<button class="row" data-testid="pick-row" data-id=${x.id} onClick=${() => onPick(x)}>
              ${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}
              <span class="stack tight grow"><b>${x.name}</b><span class="sub">${equipmentNames(eq, x)}${known && x.load !== 'bodyweight' ? ` · last ${fmtLoadShort(x.load, known.value)}` : ''}</span></span>
              <span class="accent">${label}</span>
            </button>`;
          })}`;
      })}
      ${!list.length && html`<p class="note small">${words.length ? 'Nothing on your equipment list matches that.' : 'Everything your equipment allows is already in this workout.'}</p>`}
    </div>
    <div class="rule stack" data-testid="pick-own">
      <div class="stack tight"><h4>Not on the list?</h4>
        <p class="small muted">Name the machine as it is written on it. It is saved with your equipment, so the plan and "Machine busy?" know it from now on.</p></div>
      <label class="field"><span>Name on the machine</span>
        <input id="pick-own-name" class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="For example: Iso-lateral leg extension" maxlength="40" autocomplete="off" /></label>
      <label class="field"><span>What it trains</span>
        <select id="pick-own-pattern" class="input" value=${pattern} onChange=${(e) => setPattern(e.target.value)}>
          ${Object.entries(PATTERNS).map(([id, text]) => html`<option value=${id}>${text}</option>`)}
        </select></label>
      <button class="cta ghost" data-testid="pick-own-add" onClick=${addOwn}>Save it and ${label === 'Use' ? 'use it' : 'add it'}</button>
    </div>
  <//>`;
}
