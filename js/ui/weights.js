// Weights: enter what you lift on every exercise up front, or correct one by
// hand, and set the smallest step each machine allows (any number).

import { html, useState, useEffect, useStore, Sheet, NumberInput, toast } from './kit.js';
import * as store from '../store.js';
import { LOAD_TYPES, PROGRESSION } from '../domain/rules.js';
import { allExercises, canDo, machineForExercise, sketchForExercise } from '../domain/catalog.js';
import { num, blankWeights } from '../domain/planner.js';
import { setWeight } from '../ai/coach.js';
import { Sketch } from './sketch.js';

export const STEPS = [1, 2, 2.5, 5, 10];

/** What the number means for this exercise, in words. */
export function loadLabel(loadType, machine) {
  if (loadType === 'machine' && machine?.loading === 'plate_loaded') return { pick: 'Weight of the plates you load', unit: 'kg', hint: 'kg' };
  const t = LOAD_TYPES[loadType];
  return { pick: t.pick, unit: t.unit, hint: loadType === 'machine' ? 'setting' : 'kg' };
}

/** The smallest change the equipment allows: the usual sizes, or any number. */
export function StepPicker({ value, onChange, id = 'step' }) {
  const usual = STEPS.includes(value);
  const [other, setOther] = useState(!usual && value != null);
  // Once something is typed, the box shows it even when it equals one of the usual sizes:
  // "1" on the way to "1.25" must stay put, not be wiped because 1 is also a chip.
  const [typed, setTyped] = useState(!usual && value != null);
  useEffect(() => { if (other && !typed) document.getElementById(`${id}-value`)?.focus(); }, [other]);
  return html`<div class="stack tight">
    <div class="chips" role="radiogroup" aria-label="Smallest step">
      ${STEPS.map((v) => html`<button class=${`chip ${!other && value === v ? 'on' : ''}`} role="radio" aria-checked=${!other && value === v} onClick=${() => { setOther(false); setTyped(false); onChange(v); }}>${num(v)}</button>`)}
      <button class=${`chip ${other ? 'on' : ''}`} role="radio" aria-checked=${other} data-testid=${`${id}-other`} onClick=${() => { if (!other) { setTyped(false); setOther(true); } }}>Other</button>
    </div>
    ${other && html`<${NumberInput} id=${`${id}-value`} wide value=${typed ? value : null} min=${0.01} onChange=${(v) => { setTyped(true); onChange(Math.round(v * 100) / 100); }} label="Step size" placeholder="for example 1.25 or 7.5" />`}
  </div>`;
}

/** Edit one exercise's weight and step. */
export function WeightSheet({ exerciseId, onClose }) {
  const state = useStore();
  const lift = allExercises(state.equipment).find((x) => x.id === exerciseId);
  const known = state.weights[exerciseId];
  const [value, setValue] = useState(known?.value ?? null);
  const [step, setStep] = useState(known?.step ?? PROGRESSION.defaultStep[lift?.load] ?? 2.5);
  if (!lift) return null;
  const label = loadLabel(lift.load, machineForExercise(state.equipment, lift));
  const save = () => {
    if (value == null) { toast('Enter a number first'); return; }
    setWeight(exerciseId, lift.load, value, step);
    toast('Weight saved');
    onClose();
  };
  return html`<${Sheet} title=${lift.name} onClose=${onClose}>
    <label class="field"><span>${label.pick}${label.unit ? ` (${label.unit})` : ''}</span>
      <${NumberInput} id="weight-value" wide value=${value} onChange=${setValue} label="Weight" placeholder=${label.hint} /></label>
    <div class="field"><span>Smallest step you can add</span><${StepPicker} value=${step} onChange=${setStep} id="weight-step" /></div>
    <p class="small muted">This is the weight the plan uses from now on. It still moves up and down with your results.</p>
    <button class="cta" data-testid="weight-save" onClick=${save}>Save</button>
  <//>`;
}

/**
 * Before a workout: the session's exercises that have no weight yet, one after
 * another. Each can be filled in or skipped; skipped ones are asked for when
 * they come up in the workout, as before.
 */
export function WeightsFirst({ day, onStart, onClose }) {
  const state = useStore();
  const [list] = useState(() => blankWeights(day)); // fixed when it opens, so saving one does not shift the rest
  const [at, setAt] = useState(0);
  const [value, setValue] = useState(null);
  const [step, setStep] = useState(null);
  const ex = list[at];
  if (!ex) return null;
  const lift = allExercises(state.equipment).find((x) => x.id === ex.exerciseId);
  const stepNow = step ?? PROGRESSION.defaultStep[ex.loadType] ?? 2.5;
  const label = loadLabel(ex.loadType, machineForExercise(state.equipment, lift));
  const look = sketchForExercise(state.equipment, lift);
  const isLast = at === list.length - 1;
  const next = () => {
    if (isLast) { onStart(); return; }
    setAt(at + 1); setValue(null); setStep(null);
  };
  const save = () => {
    if (value == null) { toast('Enter a number, or skip this one'); document.getElementById('first-weight')?.focus(); return; }
    setWeight(ex.exerciseId, ex.loadType, value, stepNow);
    next();
  };
  return html`<${Sheet} title="Weights for this session" onClose=${onClose}>
    <div data-testid="weights-first" class="stack">
      <p class="small muted">${list.length === 1 ? 'One exercise in this session has' : `${list.length} exercises in this session have`} no weight yet. Enter ${list.length === 1 ? 'it' : 'them'} now and the workout will not stop to ask. Or skip, and choose each one when it comes up.</p>
      <div class="spread" style="align-items:flex-start">
        <div class="stack tight grow"><p class="eyebrow" data-testid="weights-first-count">${at + 1} of ${list.length}</p><h3 data-testid="weights-first-name">${ex.name}</h3>
          <p class="small muted">${ex.equipment} · ${ex.sets} × ${ex.reps} reps</p></div>
        ${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}
      </div>
      <p class="small muted">Pick a weight you could lift for about ${ex.reps + 2} reps with good form.</p>
      <div class="stack" key=${ex.exerciseId}>
        <label class="field"><span>${label.pick}${label.unit ? ` (${label.unit})` : ''}</span>
          <${NumberInput} key=${`w-${ex.exerciseId}`} id="first-weight" wide value=${value} onChange=${setValue} label=${`Weight for ${ex.name}`} placeholder=${label.hint} /></label>
        <div class="field"><span>Smallest step you can add</span><${StepPicker} key=${`s-${ex.exerciseId}`} value=${stepNow} onChange=${setStep} id="first-step" /></div>
      </div>
      <button class="cta" data-testid="weights-first-save" onClick=${save}>${isLast ? 'Save and start the workout' : 'Save and go to the next'}</button>
      ${!isLast && html`<button class="cta ghost" data-testid="weights-first-next" onClick=${next}>Skip this one</button>`}
      <button class="cta ghost" data-testid="weights-skip" onClick=${onStart}>${isLast ? 'Start without it' : 'Start now, ask me at each exercise'}</button>
    </div>
  <//>`;
}

function Row({ lift, state, onEdit }) {
  const known = state.weights[lift.id];
  const label = loadLabel(lift.load, machineForExercise(state.equipment, lift));
  const look = sketchForExercise(state.equipment, lift);
  return html`<div class="row" data-testid="weight-row">
    ${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}
    <span class="stack tight grow"><b>${lift.name}</b><span class="sub">${lift.load === 'bodyweight' ? 'Extra weight, 0 for none' : label.pick}${label.unit ? ` (${label.unit})` : ''}</span>
      <button class="sub" style="text-align:left" onClick=${onEdit}>Step ${num(known?.step ?? PROGRESSION.defaultStep[lift.load])} · change</button></span>
    <${NumberInput} id=${`w-${lift.id}`} value=${known?.value ?? null} label=${`Weight for ${lift.name}`} placeholder=${label.hint}
      onChange=${(v) => setWeight(lift.id, lift.load, v, known?.step ?? PROGRESSION.defaultStep[lift.load])} />
  </div>`;
}

/** Every exercise at once: baseline weights before the first workout, or a tidy-up later. */
export function WeightsScreen() {
  const state = useStore();
  const [edit, setEdit] = useState(null);
  const all = allExercises(state.equipment).filter((x) => canDo(state.equipment, x));
  const inPlan = [];
  for (const d of state.plan?.days || []) for (const ex of d.exercises) {
    const lift = all.find((x) => x.id === ex.exerciseId);
    if (lift && !inPlan.includes(lift)) inPlan.push(lift);
  }
  const rest = all.filter((x) => !inPlan.includes(x));
  const blank = inPlan.filter((x) => x.load !== 'bodyweight' && !state.weights[x.id]).length;
  return html`<main class="main with-tabs">
    <div class="stack tight"><p class="eyebrow">Weights</p><h2>What you lift now</h2>
      <p class="muted">Enter your working weight on each exercise: one you can lift for the planned reps with a couple left in the tank. Anything left blank is asked for when the exercise first comes up.</p></div>
    ${state.plan && html`<p class="small muted" data-testid="weights-blank">${blank ? `${blank} of ${inPlan.length} exercises in your plan have no weight yet.` : 'Every exercise in your plan has a weight.'}</p>`}
    <div class="stack">${inPlan.map((lift) => html`<${Row} lift=${lift} state=${state} onEdit=${() => setEdit(lift.id)} />`)}</div>
    ${rest.length > 0 && html`<details class="note"><summary>${state.plan ? 'Other exercises your equipment allows' : 'Exercises your equipment allows'}</summary>
      <div class="stack" style="margin-top:10px">${rest.map((lift) => html`<${Row} lift=${lift} state=${state} onEdit=${() => setEdit(lift.id)} />`)}</div></details>`}
    ${edit && html`<${WeightSheet} exerciseId=${edit} onClose=${() => setEdit(null)} />`}
  </main>`;
}
