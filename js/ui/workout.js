// The workout screen. One main action at the bottom, changing with the step:
// Start set -> Finish set -> Save set and start rest -> Start set ...
// Every tap is saved at once; a reload lands back on the same step.

import { html, useState, useEffect, useRef, useStore, Sheet, Dock, Icon, clock, go, toast, NumberInput, restText, flags } from './kit.js';
import * as store from '../store.js';
import * as S from '../domain/session.js';
import { fmtLoad, fmtLoadShort, num } from '../domain/planner.js';
import { LOAD_TYPES, PROGRESSION } from '../domain/rules.js';
import { substitutesFor, exerciseById, equipmentNames, zoneOf, machineForExercise } from '../domain/catalog.js';
import { MachineInfo } from './equipment.js';
import { describeChange } from '../domain/progression.js';
import { afterSetSaved, afterWorkout, rememberWeight } from '../ai/coach.js';
import { sourceName } from '../ai/ai.js';
import { primeAudio, beep, buzz, keepAwake } from '../platform.js';

const RIR = [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']];
const STEPS = [1, 2, 2.5, 5, 10];

function setLine(ex, st) {
  if (st.status === 'skipped') return 'skipped';
  const v = st.actual || st.target;
  const load = ex.loadType === 'bodyweight' ? (v.load ? ` + ${num(v.load)} kg` : '') : (v.load == null ? '' : ` × ${fmtLoadShort(ex.loadType, v.load)}`);
  const rir = st.actual?.rir != null ? ` · ${st.actual.rir === 4 ? '4+' : st.actual.rir} left` : '';
  return `${v.reps} reps${load}${rir}${st.status === 'pending' ? ' planned' : ''}`;
}

function SetList({ ex, nowIdx, onEdit }) {
  return html`<div class="sets">
    ${ex.sets.map((st, i) => html`
      <button class=${`set ${i === nowIdx ? 'now' : ''} ${st.status === 'skipped' ? 'skipped' : ''}`} disabled=${st.status === 'pending'}
        onClick=${() => onEdit(i)} aria-label=${`Set ${i + 1}: ${setLine(ex, st)}${st.status === 'done' ? '. Tap to correct' : ''}`}>
        <span class="k">Set ${i + 1}</span>
        <span>${setLine(ex, st)}</span>
        <span class="k">${st.status === 'done' ? 'Edit' : ''}</span>
      </button>`)}
  </div>`;
}

function HintCard({ hint, onApply, onKeep }) {
  const c = hint.changes[0];
  const d = describeChange(c);
  return html`<div class="change" data-testid="hint">
    <div class="spread"><b>Check the change</b><span class="tag">From ${sourceName(hint.source)}</span></div>
    <div class="delta">${d.what}: ${d.text}</div>
    <p class="small muted">${c.reason}</p>
    <div class="pair">
      <button class="cta" onClick=${onApply}>Apply</button>
      <button class="cta ghost" onClick=${onKeep}>Keep plan</button>
    </div>
  </div>`;
}

function WeightPicker({ ex, reps, value, step, onValue, onStep, machine }) {
  const plates = ex.loadType === 'machine' && machine?.loading === 'plate_loaded';
  const type = plates ? { pick: 'Weight of the plates you load', unit: 'kg' } : LOAD_TYPES[ex.loadType];
  return html`<div class="note stack">
    <b>Choose your starting weight</b>
    <p class="small muted">There is no history for this exercise yet. Pick a weight you could lift for about ${reps + 2} reps with good form.</p>
    <label class="field"><span>${type.pick}${type.unit ? ` (${type.unit})` : ''}</span>
      <${NumberInput} id="start-weight" wide value=${value} onChange=${onValue} label="Starting weight" placeholder=${ex.loadType === 'machine' ? 'setting' : 'kg'} />
    </label>
    <div class="field"><span>Smallest step you can add${ex.loadType === 'machine' && !plates ? ' (one pin hole)' : ' (kg)'}</span>
      <div class="chips">${STEPS.map((v) => html`<button class=${`chip ${step === v ? 'on' : ''}`} onClick=${() => onStep(v)}>${num(v)}</button>`)}</div>
    </div>
  </div>`;
}

function EditSet({ ex, st, index, onSave, onClose }) {
  const [reps, setReps] = useState(st.actual.reps);
  const [load, setLoad] = useState(st.actual.load);
  const [rir, setRir] = useState(st.actual.rir);
  return html`<${Sheet} title=${`Correct set ${index + 1}`} onClose=${onClose}>
    <p class="small muted">${ex.name}. Plan: ${st.planned.reps} reps${st.planned.load != null ? ` at ${fmtLoadShort(ex.loadType, st.planned.load)}` : ''}.</p>
    <label class="field"><span>Reps done</span><${NumberInput} id="edit-reps" wide value=${reps} onChange=${(v) => setReps(Math.round(v))} label="Reps done" /></label>
    <label class="field"><span>${LOAD_TYPES[ex.loadType].pick}</span><${NumberInput} id="edit-load" wide value=${load ?? 0} onChange=${setLoad} label="Weight" /></label>
    <div class="field"><span>Reps left in the tank (optional)</span>
      <div class="chips">${RIR.map(([v, l]) => html`<button class=${`chip ${rir === v ? 'on' : ''}`} onClick=${() => setRir(rir === v ? null : v)}>${l}</button>`)}</div>
    </div>
    <button class="cta" onClick=${() => onSave({ reps, load: ex.loadType === 'bodyweight' && !load ? 0 : load, rir })}>Save correction</button>
  <//>`;
}

export function EditSetSheet(props) { return html`<${EditSet} ...${props} />`; }

export function Workout() {
  const state = useStore();
  const session = store.activeSession(state);
  const settings = store.getSettings();
  const [now, setNow] = useState(Date.now());
  const [sheet, setSheet] = useState(null);
  const [showWeight, setShowWeight] = useState(false);
  const [pick, setPick] = useState({ key: null, value: null, step: null });
  const rang = useRef(0);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { keepAwake(!!settings.keepAwake); return () => keepAwake(false); }, [settings.keepAwake]);

  // `now` only drives the re-render; the time itself is read fresh so it is never stale.
  const left = session ? S.restLeftMs(session, Math.max(now, Date.now())) : 0;
  const restEnd = session?.rest?.endsAt || 0;
  useEffect(() => {
    if (!restEnd || left > 0 || rang.current === restEnd) return;
    rang.current = restEnd;
    if (Date.now() - restEnd < 2000) { // only when we watched it run out, not after a late reload
      if (settings.sound) beep();
      if (settings.vibrate) buzz();
    }
  }, [left === 0, restEnd]);

  if (!session) return null;

  const { ex, set, exIdx, setIdx } = S.current(session);
  const c = S.counts(session);
  const phase = session.phase;
  const needW = S.needsWeight(session);
  const resting = phase === 'rest';
  const waiting = phase === 'ready' || resting;
  const firstOfExercise = !ex.sets.some((st) => st.status !== 'pending');
  const lastSetOverall = c.total - c.done - c.skipped === 1;
  const picked = pick.key === ex.key ? pick : { key: ex.key, value: null, step: PROGRESSION.defaultStep[ex.loadType] };
  const hint = session.hint && S.hintApplies(session, session.hint) ? session.hint : null;

  const put = (next, extra) => store.putSession(next, extra);
  const done = (s) => { afterWorkout(s); flags.justFinished = s.id; go('session', s.id, { replace: true }); };

  const onMain = () => {
    primeAudio();
    if (waiting && needW) {
      if (picked.value == null) { toast('Enter a weight first'); document.getElementById('start-weight')?.focus(); return; }
      put(S.setStartingWeight(session, picked.value, picked.step), rememberWeight(ex.exerciseId, ex.loadType, picked.value, picked.step));
      return;
    }
    if (waiting) { setShowWeight(false); put(S.beginSet(session)); return; }
    if (phase === 'active') { put(S.finishSet(session)); return; }
    if (phase === 'log') {
      const next = S.saveSet(session);
      const actual = next.exercises[exIdx].sets[setIdx].actual;
      const extra = actual.load != null && ex.loadType !== 'bodyweight' ? rememberWeight(ex.exerciseId, ex.loadType, actual.load, ex.step) : {};
      put(next, extra);
      if (next.status === 'done') done(next); else afterSetSaved(session, exIdx, setIdx);
    }
  };

  const skip = (fn) => { const next = fn(session); put(next); if (next.status === 'done') done(next); };
  const endNow = () => { const next = S.endSession(session); put(next); setSheet(null); done(next); };
  const discard = () => { setSheet(null); store.removeSession(session.id); go('plan', '', { replace: true }); toast('Workout discarded'); };

  const swapTo = (cat) => {
    const known = state.weights[cat.id];
    put(S.substitute(session, {
      exerciseId: cat.id, name: cat.name, pattern: cat.pattern, loadType: cat.load,
      equipment: equipmentNames(state.equipment, cat), zone: zoneOf(state.equipment, cat),
      step: known?.step ?? PROGRESSION.defaultStep[cat.load], load: known ? known.value : null,
    }));
    setSheet(null);
    toast(`Swapped to ${cat.name}`);
  };

  const mainLabel = waiting && needW ? 'Save starting weight'
    : waiting ? 'Start set'
      : phase === 'active' ? 'Finish set'
        : lastSetOverall ? 'Save set and finish workout' : 'Save set and start rest';

  const draft = session.draft;
  const loadStep = ex.step || PROGRESSION.defaultStep[ex.loadType];
  const subs = sheet === 'swap' ? substitutesFor(state.equipment, (ex.swappedFrom || ex).exerciseId, {
    exclude: session.exercises.map((x) => x.exerciseId), avoid: state.profile.avoid, avoidTags: state.profile.avoidTags,
  }) : [];
  const editing = sheet?.edit != null ? ex.sets[sheet.edit] : null;
  const machine = machineForExercise(state.equipment, exerciseById(state.equipment, ex.exerciseId));
  const setElapsed = phase === 'active' && session.setStartedAt ? Math.max(now, Date.now()) - session.setStartedAt : 0;

  return html`
    <header class="top">
      <div class="top-title">
        <button class="icon-btn" aria-label="End workout" onClick=${() => setSheet('end')}><${Icon} name="close" /></button>
        <div class="stack tight"><b>${resting ? 'Rest' : 'Workout'}</b></div>
      </div>
      <small data-testid="progress">${resting && !firstOfExercise ? `Set ${setIdx} saved` : `Exercise ${exIdx + 1} of ${session.exercises.length}`}</small>
    </header>
    <main class="main with-dock" data-phase=${phase}>
      <div class="bar" aria-hidden="true"><i style=${`width:${Math.round(((c.done + c.skipped) / c.total) * 100)}%`}></i></div>

      ${resting && html`
        <div class="stack tight">
          <strong class=${`timer ${left > 0 ? 'accent' : 'over'}`} data-testid="rest-timer" aria-live="off">${clock(left)}</strong>
          <p class="small muted">${left > 0 ? 'Rest' : 'Rest is over. Go when you are ready.'}</p>
        </div>
        <div class="chips">
          <button class="chip" onClick=${() => put(S.addRest(session, 15))}>+15 s</button>
          <button class="chip" onClick=${() => put(S.skipRest(session))}>Skip rest</button>
        </div>`}

      <div class="stack tight">
        ${waiting && html`<p class="eyebrow">${firstOfExercise ? (c.done + c.skipped === 0 ? 'First exercise' : 'Next exercise') : 'Next set'}</p>`}
        ${phase === 'log' && html`<p class="eyebrow">Set result</p>`}
        ${phase === 'active' && html`<p class="eyebrow">Set in progress · ${clock(setElapsed)}</p>`}
        <h3 data-testid="exercise-name">${ex.name}</h3>
        <p class="muted small">${ex.zone} · set ${setIdx + 1} of ${ex.sets.length}${ex.swappedFrom ? ` · swapped in for ${ex.swappedFrom.name}` : ''}</p>
        ${waiting && session.easePct > 0 && c.done + c.skipped === 0 && html`<p class="small muted" data-testid="eased">Loads are ${session.easePct}% lighter today to ease back in. The plan keeps its numbers.</p>`}
        ${waiting && firstOfExercise && html`<p class="muted small">${ex.equipment} · ${ex.sets.length} sets · rest ${restText(ex.restSec)}</p>`}
      </div>

      ${phase !== 'log' && !(waiting && needW) && html`
        <div class="metrics">
          <div><strong data-testid="target-reps">${set.target.reps}</strong><small>reps in the plan</small></div>
          <div><strong data-testid="target-load">${ex.loadType === 'bodyweight' ? (set.target.load ? `+${num(set.target.load)} kg` : 'BW') : ex.loadType === 'machine' ? num(set.target.load) : `${num(set.target.load)} kg`}</strong>
            <small>${ex.loadType === 'bodyweight' ? (set.target.load ? 'added to bodyweight' : 'bodyweight') : LOAD_TYPES[ex.loadType].label}</small></div>
        </div>`}

      ${(waiting || phase === 'active') && machine && (machine.how || machine.isolates) && html`<${MachineInfo} d=${machine} />`}

      ${waiting && needW && html`<${WeightPicker} ex=${ex} reps=${set.target.reps} machine=${machine} value=${picked.value} step=${picked.step}
        onValue=${(v) => setPick({ ...picked, value: v })} onStep=${(v) => setPick({ ...picked, step: v })} />`}

      ${waiting && hint && html`<${HintCard} hint=${hint}
        onApply=${() => { put(S.applyHint(session, hint)); toast('Applied to the sets to come'); }}
        onKeep=${() => put(S.setHint(session, null))} />`}

      ${phase === 'log' && draft && html`
        <div class="stack">
          <p><b>Set result</b> · <span data-testid="result-line">${draft.reps} reps${ex.loadType === 'bodyweight' ? (draft.load ? ` + ${num(draft.load)} kg` : '') : ` × ${fmtLoad(ex.loadType, draft.load)}`}</span></p>
          <div class="reps">
            <button class="step" onClick=${() => put(S.editDraft(session, { reps: draft.reps - 2 }))} aria-label="2 reps fewer">−2</button>
            <button class="step" onClick=${() => put(S.editDraft(session, { reps: draft.reps - 1 }))} aria-label="1 rep fewer">−1</button>
            <${NumberInput} id="reps-done" value=${draft.reps} onChange=${(v) => put(S.editDraft(session, { reps: v }))} label="Reps done" />
            <button class="step" onClick=${() => put(S.editDraft(session, { reps: draft.reps + 1 }))} aria-label="1 rep more">+1</button>
            <button class="step" onClick=${() => put(S.editDraft(session, { reps: draft.reps + 2 }))} aria-label="2 reps more">+2</button>
          </div>
          <div class="chips">
            <button class=${`chip ${showWeight ? 'on' : ''}`} onClick=${() => setShowWeight(!showWeight)}>Change weight</button>
          </div>
          ${showWeight && html`<div class="reps">
            <button class="step" onClick=${() => put(S.editDraft(session, { load: Math.max(0, (draft.load || 0) - loadStep) }))} aria-label="Less weight">−${num(loadStep)}</button>
            <${NumberInput} id="load-done" wide value=${draft.load ?? 0} onChange=${(v) => put(S.editDraft(session, { load: v }))} label="Weight used" />
            <button class="step" onClick=${() => put(S.editDraft(session, { load: (draft.load || 0) + loadStep }))} aria-label="More weight">+${num(loadStep)}</button>
          </div>
          <p class="small muted">${LOAD_TYPES[ex.loadType].pick}. The new weight carries to the sets that follow.</p>`}
          <div class="field"><span>Reps left in the tank (optional)</span>
            <div class="chips">${RIR.map(([v, l]) => html`<button class=${`chip ${draft.rir === v ? 'on' : ''}`} aria-pressed=${draft.rir === v}
              onClick=${() => put(S.editDraft(session, { rir: draft.rir === v ? null : v }))}>${l}</button>`)}</div>
          </div>
        </div>`}

      ${(waiting || phase === 'active') && html`<${SetList} ex=${ex} nowIdx=${setIdx} onEdit=${(i) => setSheet({ edit: i })} />`}

      ${waiting && html`<div class="chips">
        <button class="chip" onClick=${() => setSheet('swap')}>Machine busy? Swap</button>
        <button class="chip" onClick=${() => skip(S.skipSet)}>Skip set</button>
        <button class="chip" onClick=${() => skip(S.skipExercise)}>Skip exercise</button>
      </div>`}
      ${phase === 'active' && html`<div class="chips"><button class="chip" onClick=${() => put(S.cancelSet(session))}>Not started yet</button></div>`}
      ${phase === 'log' && html`<div class="chips"><button class="chip" onClick=${() => put(S.beginSet({ ...session, phase: 'ready' }, session.setStartedAt || Date.now()))}>Back to the set</button></div>`}
    </main>

    <${Dock}>
      <button class="cta" data-testid="main-action" onClick=${onMain}>${mainLabel}</button>
    <//>

    ${sheet === 'end' && html`<${Sheet} title="End this workout?" onClose=${() => setSheet(null)}>
      <p class="muted small">${c.done} of ${c.total} sets done. Sets you have not done are saved as skipped.</p>
      <button class="cta" onClick=${endNow} disabled=${c.done === 0}>Finish and save</button>
      <button class="cta danger" onClick=${discard}>Discard workout</button>
      <button class="cta ghost" onClick=${() => setSheet(null)}>Keep going</button>
    <//>`}

    ${sheet === 'swap' && html`<${Sheet} title="Swap this exercise" onClose=${() => setSheet(null)}>
      <p class="muted small">Same movement, on equipment you marked available. The swap is for today only.</p>
      ${subs.length ? subs.map((cat) => html`
        <button class="row" onClick=${() => swapTo(cat)}>
          <span class="stack tight"><b>${cat.name}</b><span class="sub">${equipmentNames(state.equipment, cat)}</span></span>
          <span class="accent">Use</span>
        </button>`) : html`<p class="note">Nothing else on your equipment list trains this movement. You can skip it, or add machines on the Equipment tab.</p>`}
    <//>`}

    ${editing?.actual && html`<${EditSet} ex=${ex} st=${editing} index=${sheet.edit} onClose=${() => setSheet(null)}
      onSave=${(a) => { put(S.editSet(session, exIdx, sheet.edit, a)); setSheet(null); toast('Set corrected'); }} />`}
  `;
}

export { exerciseById };
