// The workout screen. One main action at the bottom, one tap per set:
//   Start set -> Finish set -> (rest, then the next set starts by itself) -> Finish set ...
// When the planned sets are done and the session has optional extras, one more
// step offers them: add one, or finish.
// A finished set is saved as planned; it can be nudged by a rep before the tap
// or during the rest, or undone. Every tap is saved at once and written to the
// workout's log; a reload lands back on the same step.

import { html, useState, useEffect, useRef, useStore, Sheet, Dock, Icon, clock, go, toast, NumberInput, restText, flags } from './kit.js';
import * as store from '../store.js';
import * as S from '../domain/session.js';
import { fmtLoad, fmtLoadShort, num, optionalMinutes } from '../domain/planner.js';
import { LOAD_TYPES, PROGRESSION } from '../domain/rules.js';
import { substitutesFor, exerciseById, equipmentNames, zoneOf, machineForExercise, sketchForExercise } from '../domain/catalog.js';
import { MachineInfo } from './equipment.js';
import { Sketch, sketchNote } from './sketch.js';
import { StepPicker, loadLabel } from './weights.js';
import { describeChange } from '../domain/progression.js';
import { afterSetSaved, afterWorkout, rememberWeight } from '../ai/coach.js';
import { sourceName } from '../ai/ai.js';
import { primeAudio, buzz, keepAwake, keepAlive, scheduleBeep, cancelBeep, notify, clearNotifications } from '../platform.js';

const RIR = [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']];
const AUTO_START_WINDOW_MS = 120000;

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

/** A change already made to the sets still to come, with its reason. One tap takes it back. */
function HintCard({ hint, onUndo, onOk }) {
  const c = hint.changes[0];
  const d = describeChange(c);
  return html`<div class="change" data-testid="hint">
    <div class="spread"><b>Changed for the sets to come</b><span class="tag">From ${sourceName(hint.source)}</span></div>
    <div class="delta">${d.what}: ${d.text}</div>
    <p class="small muted">${c.reason}</p>
    <div class="chips">
      <button class="chip" data-testid="hint-undo" onClick=${onUndo}>Undo</button>
      <button class="chip" onClick=${onOk}>OK</button>
    </div>
  </div>`;
}

function WeightPicker({ ex, reps, value, step, onValue, onStep, machine }) {
  const label = loadLabel(ex.loadType, machine);
  return html`<div class="note stack">
    <b>Choose your starting weight</b>
    <p class="small muted">There is no history for this exercise yet. Pick a weight you could lift for about ${reps + 2} reps with good form.</p>
    <label class="field"><span>${label.pick}${label.unit ? ` (${label.unit})` : ''}</span>
      <${NumberInput} id="start-weight" wide value=${value} onChange=${onValue} label="Starting weight" placeholder=${label.hint} />
    </label>
    <div class="field"><span>Smallest step you can add</span><${StepPicker} value=${step} onChange=${onStep} id="start-step" /></div>
  </div>`;
}

/** What to aim for on this set: stop at the target, or push on. */
function EffortCue({ cue }) {
  return html`<div class=${`note ${cue.push ? 'push' : ''}`} data-testid="effort"><b>${cue.title}</b><span class="small muted">${cue.text}</span></div>`;
}

/** The set just finished, during the rest: nudge the reps, change the weight, say how hard it was, or undo it. */
function LastSet({ last, onAdjust, onUndo }) {
  const [showWeight, setShowWeight] = useState(false);
  const { ex, set, setIdx } = last;
  const a = set.actual;
  const step = ex.step || PROGRESSION.defaultStep[ex.loadType];
  return html`<div class="note stack" data-testid="last-set">
    <div class="spread"><b>Set ${setIdx + 1} saved</b><button class="chip" data-testid="undo" onClick=${onUndo}>Undo</button></div>
    <div class="reps">
      <button class="step" onClick=${() => onAdjust({ reps: a.reps - 1 })} aria-label="1 rep fewer">−1</button>
      <span class="stack tight center grow"><strong class="big" data-testid="last-reps">${a.reps}</strong><small>reps${ex.loadType === 'bodyweight' ? (a.load ? ` + ${num(a.load)} kg` : '') : ` × ${fmtLoadShort(ex.loadType, a.load)}`}</small></span>
      <button class="step" onClick=${() => onAdjust({ reps: a.reps + 1 })} aria-label="1 rep more">+1</button>
    </div>
    <div class="chips" style="align-items:center">
      <span class="small muted">Reps left in the tank</span>
      ${RIR.map(([v, l]) => html`<button class=${`chip ${a.rir === v ? 'on' : ''}`} aria-pressed=${a.rir === v} aria-label=${`${l} reps left in the tank`}
        onClick=${() => onAdjust({ rir: a.rir === v ? null : v })}>${l}</button>`)}
    </div>
    <div class="chips">
      <button class=${`chip ${showWeight ? 'on' : ''}`} onClick=${() => setShowWeight(!showWeight)}>Change weight</button>
    </div>
    ${showWeight && html`<div class="reps">
      <button class="step" onClick=${() => onAdjust({ load: Math.max(0, (a.load || 0) - step) })} aria-label="Less weight">−${num(step)}</button>
      <${NumberInput} id="load-done" wide value=${a.load ?? 0} onChange=${(v) => onAdjust({ load: v })} label="Weight used" />
      <button class="step" onClick=${() => onAdjust({ load: (a.load || 0) + step })} aria-label="More weight">+${num(step)}</button>
    </div>
    <p class="small muted">${LOAD_TYPES[ex.loadType].pick}. The new weight carries to the sets that follow.</p>`}
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
  const [pick, setPick] = useState({ key: null, value: null, step: null });
  const rang = useRef(0);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { keepAwake(!!settings.keepAwake); return () => keepAwake(false); }, [settings.keepAwake]);
  // While a rest runs, a tone too quiet to hear keeps the page going behind a dark screen, so the signal comes on time.
  const restOn = !!session?.rest;
  useEffect(() => { keepAlive(restOn && (settings.notify || settings.sound)); return () => keepAlive(false); }, [restOn, settings.notify, settings.sound]);
  // Screen going off and on is part of the log: it explains long gaps.
  useEffect(() => {
    const on = () => { const s = store.activeSession(); if (s) store.putSession(S.logEvent(s, document.visibilityState === 'hidden' ? 'screen_off' : 'screen_on')); if (document.visibilityState === 'visible') clearNotifications(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // `now` only drives the re-render; the time itself is read fresh so it is never stale.
  const left = session ? S.restLeftMs(session, Math.max(now, Date.now())) : 0;
  const restEnd = session?.rest?.endsAt || 0;
  // The "rest over" sound is put on the audio clock when the rest starts, so it comes on time even behind a dark screen.
  useEffect(() => {
    if (!restEnd || !settings.sound) return undefined;
    const secs = (restEnd - Date.now()) / 1000;
    if (secs <= 0) return undefined;
    return scheduleBeep(secs);
  }, [restEnd, settings.sound]);
  // The rest ran out. Called from a timer set when the rest starts, and again from the
  // screen clock in case the timer was held back; it only ever acts once per rest.
  const restOver = () => {
    const live = store.activeSession();
    const end = live?.rest?.endsAt;
    if (!end || Date.now() < end || rang.current === end) return;
    rang.current = end;
    const prefs = store.getSettings();
    // Coming back long after the rest ended (the app was closed), nothing starts by itself: that set is clearly not under way.
    const auto = prefs.autoStart && !live.rest.betweenExercises && !S.needsWeight(live) && Date.now() - end < AUTO_START_WINDOW_MS;
    if (Date.now() - end < 3000) { // we saw it run out: signal it
      if (prefs.vibrate) buzz();
      if (prefs.notify && document.visibilityState === 'hidden') notify('Rest over', live.rest.betweenExercises ? 'Time for the next exercise.' : auto ? 'Your next set has started.' : 'Time for your next set.');
    }
    // The next set of the same exercise starts by itself, from the moment the rest ended.
    if (auto) store.putSession(S.beginSet(live, end, { auto: true }));
  };
  useEffect(() => {
    if (!restEnd) return undefined;
    const t = setTimeout(restOver, Math.max(0, restEnd - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [restEnd]);
  useEffect(() => { if (restEnd && left === 0) restOver(); }, [left === 0, restEnd]);

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
  const hint = session.hint?.applied && S.hintApplies(session, session.hint) ? session.hint : null;
  const offer = S.optionalLeft(session); // optional extras not taken yet
  const last = waiting || phase === 'optional' ? S.lastSet(session) : null;
  const cue = S.effortCue(ex, setIdx, state.plan?.level);

  const put = (next, extra) => store.putSession(next, extra);
  const done = (s) => { cancelBeep(); afterWorkout(s); flags.justFinished = s.id; go('session', s.id, { replace: true }); };

  const onMain = () => {
    primeAudio();
    if (waiting && needW) {
      if (picked.value == null) { toast('Enter a weight first'); document.getElementById('start-weight')?.focus(); return; }
      put(S.setStartingWeight(session, picked.value, picked.step), rememberWeight(ex.exerciseId, ex.loadType, picked.value, picked.step));
      return;
    }
    if (waiting) { cancelBeep(); put(S.beginSet(session)); return; }
    // One tap: the set is saved as planned, or as nudged while it ran, and the rest starts.
    const next = S.finishSet(session);
    const actual = next.exercises.find((x) => x.key === ex.key).sets[setIdx].actual;
    const extra = actual.load != null && ex.loadType !== 'bodyweight' ? rememberWeight(ex.exerciseId, ex.loadType, actual.load, ex.step) : {};
    put(next, extra);
    if (next.status === 'done') done(next); else afterSetSaved(session, ex.key, setIdx);
  };

  // During the rest: correct the set just done. The suggestion for the next sets is worked out again.
  const adjust = (patch) => {
    const next = S.adjustLast(session, patch);
    const L = S.lastSet(next);
    const extra = patch.load != null && L && L.ex.loadType !== 'bodyweight' ? rememberWeight(L.ex.exerciseId, L.ex.loadType, L.set.actual.load, L.ex.step) : {};
    put(next, extra);
    if (L) afterSetSaved(next, L.ex.key, L.setIdx);
  };

  const move = (next) => { cancelBeep(); put(next); if (next.status === 'done') done(next); };
  const endNow = () => { const next = S.endSession(session); put(next); setSheet(null); done(next); };
  const discard = () => { cancelBeep(); setSheet(null); store.removeSession(session.id); go('plan', '', { replace: true }); toast('Workout discarded'); };

  // Take an optional extra: after the planned sets it comes up at once, earlier it waits at the end.
  const takeOptional = (o) => {
    cancelBeep();
    put(S.addOptional(session, o.key));
    setSheet(null);
    toast(phase === 'optional' ? `${o.name}: optional extra` : `${o.name} added at the end`);
  };

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
    : phase === 'active' ? (lastSetOverall && !offer.length ? 'Finish set and end workout' : 'Finish set')
      : resting && !session.rest.betweenExercises && left > 0 ? 'Start next set now' : 'Start set';

  const draft = session.draft;
  const subs = sheet === 'busy' ? substitutesFor(state.equipment, (ex.swappedFrom || ex).exerciseId, {
    exclude: session.exercises.map((x) => x.exerciseId), avoid: state.profile.avoid, avoidTags: state.profile.avoidTags,
  }) : [];
  const editing = sheet?.edit != null ? ex.sets[sheet.edit] : null;
  const thisLift = exerciseById(state.equipment, ex.exerciseId);
  const machine = machineForExercise(state.equipment, thisLift);
  const look = sketchForExercise(state.equipment, thisLift); // what the equipment looks like, for finding it
  const setElapsed = phase === 'active' && session.setStartedAt ? Math.max(now, Date.now()) - session.setStartedAt : 0;
  const others = S.hasOthers(session);

  const endSheet = sheet === 'end' && html`<${Sheet} title="End this workout?" onClose=${() => setSheet(null)}>
      <p class="muted small">${c.done} of ${c.total} sets done. Sets you have not done are saved as skipped.</p>
      <button class="cta" onClick=${endNow} disabled=${c.done === 0}>Finish and save</button>
      <button class="cta danger" onClick=${discard}>Discard workout</button>
      <button class="cta ghost" onClick=${() => setSheet(null)}>Keep going</button>
    <//>`;

  const allSheet = sheet === 'all' && html`<${Sheet} title="This workout" onClose=${() => setSheet(null)}>
      <p class="small muted">${c.done} of ${c.total} sets done. Tap an exercise to go to it.</p>
      <div class="stack" data-testid="overview">
        ${session.exercises.map((x, i) => {
          const d = x.sets.filter((st) => st.status === 'done').length;
          const pending = x.sets.some((st) => st.status === 'pending');
          const here = i === exIdx && phase !== 'optional';
          const status = here ? 'Now' : x.dropped ? 'Dropped' : !pending ? 'Done' : x.postponed ? 'Later' : 'To do';
          return html`<button class=${`row ${here ? 'on' : ''}`} disabled=${!pending || here}
            onClick=${() => { cancelBeep(); put(S.goToExercise(session, i)); setSheet(null); }}>
            <span class="stack tight grow"><b>${i + 1}. ${x.name}</b><span class="sub">${d} of ${x.sets.length} sets done${x.optional ? ' · optional extra' : ''}${x.swappedFrom ? ` · swapped in for ${x.swappedFrom.name}` : ''}</span></span>
            <span class=${`tag ${status === 'Now' || status === 'Done' ? 'good' : ''}`}>${status}</span>
          </button>`;
        })}
      </div>
      ${offer.length > 0 && html`<div class="stack" data-testid="overview-optional">
        <div class="stack tight"><p class="eyebrow">Optional extras</p>
          <p class="small muted">If you feel like more today, add one. It goes to the end of the workout.</p></div>
        ${offer.map((o) => html`<${OptionalRow} o=${o} eq=${state.equipment} label="Add" onUse=${() => takeOptional(o)} />`)}
      </div>`}
    <//>`;

  // Every planned set is done and the session has optional extras: offer them, or finish.
  if (phase === 'optional') {
    return html`
      <header class="top">
        <div class="top-title">
          <button class="icon-btn" aria-label="End workout" onClick=${() => setSheet('end')}><${Icon} name="close" /></button>
          <div class="stack tight"><b>Workout</b></div>
        </div>
        <button class="chip" data-testid="progress" aria-label="See the whole workout" onClick=${() => setSheet('all')}>All sets done ▾</button>
      </header>
      <main class="main with-dock" data-phase="optional">
        <div class="bar" aria-hidden="true"><i style="width:100%"></i></div>
        ${last && html`<${LastSet} key=${`${last.ex.key}-${last.setIdx}`} last=${last} onAdjust=${adjust}
          onUndo=${() => { put(S.undoFinish(session)); toast('Set is open again'); }} />`}
        <div class="stack tight">
          <p class="eyebrow">Planned sets done</p>
          <h3>Feel like a bit more?</h3>
          <p class="small muted">These are optional. They fit today's session and your plan, and skipping them changes nothing.</p>
        </div>
        <div class="stack" data-testid="optional-list">
          ${offer.map((o) => html`<${OptionalRow} o=${o} eq=${state.equipment} label="Do it" onUse=${() => takeOptional(o)} />`)}
        </div>
      </main>
      <${Dock}>
        <button class="cta" data-testid="main-action" onClick=${endNow}>Finish workout</button>
      <//>
      ${endSheet}
      ${allSheet}`;
  }

  return html`
    <header class="top">
      <div class="top-title">
        <button class="icon-btn" aria-label="End workout" onClick=${() => setSheet('end')}><${Icon} name="close" /></button>
        <div class="stack tight"><b>${resting ? 'Rest' : 'Workout'}</b></div>
      </div>
      <button class="chip" data-testid="progress" aria-label="See the whole workout" onClick=${() => setSheet('all')}>Exercise ${exIdx + 1} of ${session.exercises.length} ▾</button>
    </header>
    <main class="main with-dock" data-phase=${phase}>
      <div class="bar" aria-hidden="true"><i style=${`width:${Math.round(((c.done + c.skipped) / c.total) * 100)}%`}></i></div>

      ${resting && html`
        <div class="stack tight">
          <strong class=${`timer ${left > 0 ? 'accent' : 'over'}`} data-testid="rest-timer" aria-live="off">${clock(left)}</strong>
          <p class="small muted">${left > 0 ? (session.rest.betweenExercises ? 'Time to change station' : settings.autoStart ? 'Rest. The next set starts when it runs out.' : 'Rest') : 'Rest is over. Go when you are ready.'}</p>
        </div>
        <div class="chips">
          <button class="chip" onClick=${() => put(S.addRest(session, 15))}>+15 s</button>
          <button class="chip" onClick=${() => put(S.addRest(session, 60))}>+1 min</button>
        </div>`}

      ${last && html`<${LastSet} key=${`${last.ex.key}-${last.setIdx}`} last=${last} onAdjust=${adjust}
        onUndo=${() => { cancelBeep(); put(S.undoFinish(session)); toast('Set is open again'); }} />`}

      <div class="spread" style="align-items:flex-start">
        <div class="stack tight grow">
          ${waiting && html`<p class="eyebrow">${firstOfExercise ? (c.done + c.skipped === 0 ? 'First exercise' : 'Next exercise') : 'Next set'}</p>`}
          ${phase === 'active' && html`<p class="eyebrow" data-testid="set-clock">Set in progress · ${clock(setElapsed)}${set.auto ? ' · started by itself' : ''}</p>`}
          <h3 data-testid="exercise-name">${ex.name}</h3>
          <p class="muted small">${ex.zone} · set ${setIdx + 1} of ${ex.sets.length}${ex.optional ? ' · optional extra' : ''}${ex.swappedFrom ? ` · swapped in for ${ex.swappedFrom.name}` : ''}${ex.postponed ? ' · put off earlier' : ''}</p>
          ${waiting && session.easePct > 0 && c.done + c.skipped === 0 && html`<p class="small muted" data-testid="eased">Loads are ${session.easePct}% lighter today to ease back in. The plan keeps its numbers.</p>`}
          ${waiting && firstOfExercise && html`<p class="muted small">${ex.equipment} · ${ex.sets.length} sets · rest ${restText(ex.restSec)}</p>`}
        </div>
        ${look && html`<div data-testid="sketch"><${Sketch} medium id=${look.id} loading=${look.loading} /></div>`}
      </div>
      ${waiting && firstOfExercise && look && html`<p class="small muted" data-testid="sketch-note">${sketchNote(look)}</p>`}

      ${waiting && !needW && html`
        <div class="metrics">
          <div><strong data-testid="target-reps">${set.target.reps}</strong><small>reps in the plan</small></div>
          <div><strong data-testid="target-load">${ex.loadType === 'bodyweight' ? (set.target.load ? `+${num(set.target.load)} kg` : 'BW') : ex.loadType === 'machine' ? num(set.target.load) : `${num(set.target.load)} kg`}</strong>
            <small>${ex.loadType === 'bodyweight' ? (set.target.load ? 'added to bodyweight' : 'bodyweight') : LOAD_TYPES[ex.loadType].label}</small></div>
        </div>`}

      ${phase === 'active' && draft && html`
        <div class="stack">
          <div class="reps" data-testid="reps-now">
            <button class="step" onClick=${() => put(S.editDraft(session, { reps: draft.reps - 1 }))} aria-label="1 rep fewer">−1</button>
            <span class="stack tight center grow"><strong class="big" data-testid="draft-reps">${draft.reps}</strong>
              <small>reps to record${ex.loadType === 'bodyweight' ? (draft.load ? ` + ${num(draft.load)} kg` : '') : ` × ${fmtLoad(ex.loadType, draft.load)}`}</small></span>
            <button class="step" onClick=${() => put(S.editDraft(session, { reps: draft.reps + 1 }))} aria-label="1 rep more">+1</button>
          </div>
          <p class="small muted">"Finish set" saves this number. You can still nudge it by a rep during the rest.</p>
        </div>`}

      ${waiting && needW && html`<${WeightPicker} ex=${ex} reps=${set.target.reps} machine=${machine} value=${picked.value} step=${picked.step}
        onValue=${(v) => setPick({ ...picked, value: v })} onStep=${(v) => setPick({ ...picked, step: v })} />`}

      ${!(waiting && needW) && html`<${EffortCue} cue=${cue} />`}

      ${waiting && hint && html`<${HintCard} hint=${hint}
        onUndo=${() => { put(S.undoHint(session)); toast('Back to the plan for these sets'); }}
        onOk=${() => put(S.setHint(session, null))} />`}

      ${(waiting || phase === 'active') && machine && (machine.how || machine.isolates) && html`<${MachineInfo} d=${machine} />`}

      <${SetList} ex=${ex} nowIdx=${setIdx} onEdit=${(i) => setSheet({ edit: i })} />

      ${waiting && html`<div class="chips">
        <button class="chip" data-testid="busy" onClick=${() => setSheet('busy')}>Machine busy? Not now</button>
        <button class="chip" onClick=${() => move(S.skipSet(session))}>Skip set</button>
      </div>`}
      ${phase === 'active' && html`<div class="chips">
        <button class="chip accent" data-testid="start-now" onClick=${() => { put(S.restartSet(session)); toast('Clock reset: the set starts now'); }}>Start now</button>
        <button class="chip" onClick=${() => put(S.cancelSet(session))}>Not doing it yet</button>
      </div>`}
    </main>

    <${Dock}>
      <button class="cta" data-testid="main-action" onClick=${onMain}>${mainLabel}</button>
    <//>

    ${endSheet}

    ${sheet === 'busy' && html`<${Sheet} title="Machine busy, or not now?" onClose=${() => setSheet(null)}>
      <button class="cta" data-testid="later" disabled=${!others} onClick=${() => { move(S.postponeExercise(session)); setSheet(null); toast(`${ex.name} comes back at the end`); }}>Come back to it later</button>
      ${!others && html`<p class="small muted">This is the last exercise left, so there is nothing to do first.</p>`}
      <div class="stack">
        <p class="small muted">Or do something else instead, for today only:</p>
        ${subs.filter((x) => x.close).length > 0 && html`<p class="eyebrow">Same movement</p>`}
        ${subs.filter((x) => x.close).map((cat) => html`<${SubRow} cat=${cat} eq=${state.equipment} onUse=${() => swapTo(cat)} />`)}
        ${subs.filter((x) => !x.close).length > 0 && html`<p class="eyebrow">Same muscles, another movement</p>`}
        ${subs.filter((x) => !x.close).slice(0, 6).map((cat) => html`<${SubRow} cat=${cat} eq=${state.equipment} onUse=${() => swapTo(cat)} />`)}
        ${!subs.length && html`<p class="note">Nothing else on your equipment list trains these muscles. Add machines on the Equipment tab, or come back to it later.</p>`}
      </div>
      <button class="cta danger" data-testid="drop" onClick=${() => { setSheet(null); move(S.dropExercise(session)); toast(`${ex.name} dropped for today`); }}>Drop it for today</button>
    <//>`}

    ${allSheet}

    ${editing?.actual && html`<${EditSet} ex=${ex} st=${editing} index=${sheet.edit} onClose=${() => setSheet(null)}
      onSave=${(a) => { put(S.editSet(session, exIdx, sheet.edit, a)); setSheet(null); toast('Set corrected'); }} />`}
  `;
}

/** One optional extra: what it is, how long it takes and why it fits. */
function OptionalRow({ o, eq, label, onUse }) {
  const look = sketchForExercise(eq, exerciseById(eq, o.exerciseId));
  return html`<button class="row" data-testid="optional-row" onClick=${onUse}>
    ${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}
    <span class="stack tight grow"><b>${o.name}</b>
      <span class="sub">${o.sets} × ${o.reps} reps · about ${optionalMinutes(o)} min</span>
      ${o.why && html`<span class="sub">${o.why}</span>`}</span>
    <span class="accent">${label}</span>
  </button>`;
}

function SubRow({ cat, eq, onUse }) {
  const look = sketchForExercise(eq, cat);
  return html`<button class="row" onClick=${onUse}>
    ${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}
    <span class="stack tight grow"><b>${cat.name}</b><span class="sub">${equipmentNames(eq, cat)}</span></span>
    <span class="accent">Use</span>
  </button>`;
}

export { exerciseById };
