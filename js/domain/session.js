// Workout session state machine. Pure functions: each takes a session and
// returns a new one, so the UI can save after every step and a reload picks up
// exactly where the user left off.
//
//   ready -> active -> log -> rest -> active ... -> summary
//
// "rest" stores the time it ends, not a countdown, so coming back to the tab
// shows the right time left.

import { TIME, PROGRESSION } from './rules.js';
import { fmtLoadShort } from './planner.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const touch = (s, now) => { s.updatedAt = now; return s; };

/**
 * @param {object} plan
 * @param {string} dayId the session of the cycle to do
 * @param {number} [now]
 * @param {{easePct?: number, why?: string}} [opts] easePct: lighter loads today, after a long break
 */
export function startSession(plan, dayId, now = Date.now(), opts = {}) {
  const day = plan.days.find((d) => d.id === dayId);
  if (!day) throw new Error('That session is not in the plan.');
  const ease = Math.min(Math.max(Number(opts.easePct) || 0, 0), 30);
  return {
    id: `s-${now.toString(36)}`,
    dayId, title: day.title, run: plan.queue?.run || 1,
    restAfter: Number.isFinite(day.restAfter) ? day.restAfter : null, // the rest planned after this one
    easePct: ease, why: opts.why || '',
    planId: plan.id, planVersion: plan.version, rulesVersion: plan.rulesVersion,
    budgetMin: plan.minutes, estMinutes: day.estMinutes,
    startedAt: now, endedAt: null, updatedAt: now, status: 'active',
    exercises: day.exercises.map((ex) => sessionExercise(ex, ease)),
    cursor: { ex: 0, set: 0 },
    phase: 'ready',
    setStartedAt: null,
    rest: null,
    draft: null,
    hint: null,
  };
}

function sessionExercise(ex, ease = 0) {
  const load = ex.load ? ex.load.value : null;
  const step = ex.load?.step ?? PROGRESSION.defaultStep[ex.loadType] ?? 2.5;
  // Easing back in: the plan keeps its numbers, today's targets are lighter, rounded to what can be loaded.
  const eased = load != null && ease > 0 && ex.loadType !== 'bodyweight'
    ? Math.max(0, Math.round((Math.round((load * (1 - ease / 100)) / step) * step) * 100) / 100) : load;
  return {
    key: ex.key, exerciseId: ex.exerciseId, name: ex.name, pattern: ex.pattern, tier: ex.tier,
    equipment: ex.equipment, zone: ex.zone, loadType: ex.loadType,
    repLo: ex.repLo, repHi: ex.repHi, restSec: ex.restSec,
    step,
    swappedFrom: null,
    sets: Array.from({ length: ex.sets }, () => ({
      planned: { reps: ex.reps, load },
      target: { reps: ex.reps, load: eased },
      actual: null,
      status: 'pending',
      note: eased !== load ? `Eased by ${ease}% after a break` : null,
    })),
  };
}

export function current(s) {
  const ex = s.exercises[s.cursor.ex] || null;
  return { ex, set: ex ? ex.sets[s.cursor.set] : null, exIdx: s.cursor.ex, setIdx: s.cursor.set };
}

export function restLeftMs(s, now = Date.now()) {
  return s.rest ? Math.max(0, s.rest.endsAt - now) : 0;
}

/** True when the next set has no weight yet and the user must pick one. */
export function needsWeight(s) {
  const { ex, set } = current(s);
  return !!ex && !!set && ex.loadType !== 'bodyweight' && set.target.load == null;
}

export function setStartingWeight(session, value, step, now = Date.now()) {
  const s = clone(session);
  const { ex } = current(s);
  ex.step = step || ex.step;
  for (const st of ex.sets) if (st.status === 'pending') st.target.load = value;
  return touch(s, now);
}

export function beginSet(session, now = Date.now()) {
  if (needsWeight(session)) throw new Error('Pick a starting weight first.');
  const s = clone(session);
  s.phase = 'active';
  s.setStartedAt = now;
  s.rest = null;
  s.draft = null;
  return touch(s, now);
}

/** Mis-tap on "Start set": go back without recording anything. */
export function cancelSet(session, now = Date.now()) {
  const s = clone(session);
  s.phase = 'ready';
  s.setStartedAt = null;
  s.draft = null;
  return touch(s, now);
}

/** "Finish set": open the result entry, starting from the planned values. */
export function finishSet(session, now = Date.now()) {
  const s = clone(session);
  const { set } = current(s);
  s.phase = 'log';
  s.draft = { reps: set.target.reps, load: set.target.load, rir: null, endedAt: now };
  return touch(s, now);
}

export function editDraft(session, patch, now = Date.now()) {
  const s = clone(session);
  s.draft = { ...s.draft, ...patch };
  if (s.draft.reps != null) s.draft.reps = Math.min(Math.max(Math.round(s.draft.reps), 0), 99);
  if (s.draft.load != null) s.draft.load = Math.max(Math.round(s.draft.load * 100) / 100, 0);
  return touch(s, now);
}

/** Save the result and start the rest countdown, or finish the session. */
export function saveSet(session, now = Date.now()) {
  const s = clone(session);
  const { ex, set, setIdx } = current(s);
  const d = s.draft || { reps: set.target.reps, load: set.target.load, rir: null, endedAt: now };
  set.actual = {
    reps: d.reps,
    load: d.load,
    rir: d.rir,
    at: now,
    seconds: s.setStartedAt ? Math.max(0, Math.round(((d.endedAt || now) - s.setStartedAt) / 1000)) : null,
  };
  set.status = 'done';
  s.draft = null;
  s.setStartedAt = null;
  s.hint = null;
  // A weight changed by hand carries to the sets still to come.
  if (d.load != null && d.load !== set.target.load) {
    for (const st of ex.sets) if (st.status === 'pending') st.target.load = d.load;
  }
  const lastOfExercise = !ex.sets.slice(setIdx + 1).some((st) => st.status === 'pending');
  if (!advance(s)) return endSession(s, now);
  const restSec = lastOfExercise ? TIME.transitionSec : ex.restSec;
  s.phase = 'rest';
  s.rest = { startedAt: now, endsAt: now + restSec * 1000, betweenExercises: lastOfExercise };
  return touch(s, now);
}

function advance(s) {
  for (let e = s.cursor.ex; e < s.exercises.length; e++) {
    const idx = s.exercises[e].sets.findIndex((st) => st.status === 'pending');
    if (idx >= 0) { s.cursor = { ex: e, set: idx }; return true; }
  }
  for (let e = 0; e < s.cursor.ex; e++) {
    const idx = s.exercises[e].sets.findIndex((st) => st.status === 'pending');
    if (idx >= 0) { s.cursor = { ex: e, set: idx }; return true; }
  }
  return false;
}

export function skipSet(session, now = Date.now()) {
  const s = clone(session);
  const { set } = current(s);
  set.status = 'skipped';
  return afterSkip(s, now);
}

export function skipExercise(session, now = Date.now()) {
  const s = clone(session);
  const { ex } = current(s);
  for (const st of ex.sets) if (st.status === 'pending') st.status = 'skipped';
  return afterSkip(s, now);
}

function afterSkip(s, now) {
  s.draft = null;
  s.setStartedAt = null;
  s.hint = null;
  if (!advance(s)) return endSession(s, now);
  if (s.phase !== 'rest') s.phase = 'ready';
  return touch(s, now);
}

export function addRest(session, seconds, now = Date.now()) {
  const s = clone(session);
  if (!s.rest) return s;
  s.rest.endsAt = Math.max(s.rest.endsAt, now) + seconds * 1000;
  return touch(s, now);
}

export function skipRest(session, now = Date.now()) {
  const s = clone(session);
  s.rest = null;
  s.phase = 'ready';
  return touch(s, now);
}

/**
 * Swap the current exercise for another one, for this session only.
 * `sub` is a plan-style exercise entry for the substitute (name, loadType...).
 */
export function substitute(session, sub, now = Date.now()) {
  const s = clone(session);
  const { ex } = current(s);
  const from = ex.swappedFrom || { exerciseId: ex.exerciseId, name: ex.name };
  Object.assign(ex, {
    exerciseId: sub.exerciseId, name: sub.name, pattern: sub.pattern, equipment: sub.equipment,
    zone: sub.zone, loadType: sub.loadType, step: sub.step, swappedFrom: from,
  });
  for (const st of ex.sets) {
    if (st.status !== 'pending') continue;
    st.target.load = sub.loadType === 'bodyweight' ? (sub.load ?? 0) : (sub.load ?? null);
    st.note = `Swapped in for ${from.name}`;
  }
  s.hint = null;
  if (s.phase === 'active' || s.phase === 'log') { s.phase = 'ready'; s.setStartedAt = null; s.draft = null; }
  return touch(s, now);
}

/** Fix a set that was saved wrongly, during the session or later from History. */
export function editSet(session, exIdx, setIdx, actual, now = Date.now()) {
  const s = clone(session);
  const st = s.exercises[exIdx]?.sets[setIdx];
  if (!st) return s;
  st.actual = {
    ...(st.actual || { at: now, seconds: null }),
    reps: Math.min(Math.max(Math.round(actual.reps), 0), 99),
    load: actual.load == null ? null : Math.max(actual.load, 0),
    rir: actual.rir ?? null,
    edited: true,
  };
  if (st.status !== 'done') {
    st.status = 'done';
    if (s.status === 'active' && !advanceIfCursorDone(s)) return endSession(s, now);
  }
  return touch(s, now);
}

function advanceIfCursorDone(s) {
  const { set } = current(s);
  if (set && set.status === 'pending') return true;
  return advance(s);
}

export function endSession(session, now = Date.now()) {
  const s = session.status === 'active' ? clone(session) : session;
  for (const ex of s.exercises) for (const st of ex.sets) if (st.status === 'pending') st.status = 'skipped';
  s.status = 'done';
  s.endedAt = s.endedAt || now;
  s.phase = 'summary';
  s.rest = null;
  s.draft = null;
  s.setStartedAt = null;
  s.hint = null;
  return touch(s, now);
}

// ---------------------------------------------------------------- hints

/** A suggestion only counts while it still points at sets that are not done. */
export function hintApplies(session, hint) {
  if (!hint || session.status !== 'active') return false;
  return hint.changes.some((c) => pendingTargets(session, c).length > 0);
}

function pendingTargets(session, change) {
  const ex = session.exercises.find((x) => x.key === change.exerciseKey);
  if (!ex) return [];
  const wanted = change.setIndexes;
  return ex.sets.map((st, i) => ({ st, i })).filter(({ st, i }) => st.status === 'pending' && (!wanted || wanted.includes(i)));
}

/** Apply an in-session suggestion to the sets that are still to come. */
export function applyHint(session, hint, now = Date.now()) {
  const s = clone(session);
  for (const c of hint.changes) {
    const ex = s.exercises.find((x) => x.key === c.exerciseKey);
    if (!ex) continue;
    const wanted = c.setIndexes;
    ex.sets.forEach((st, i) => {
      if (st.status !== 'pending' || (wanted && !wanted.includes(i))) return;
      if (c.field === 'load') st.target.load = c.value;
      if (c.field === 'reps') st.target.reps = c.value;
      st.note = c.reason;
    });
    if (c.field === 'rest') ex.restSec = c.value;
  }
  s.hint = null;
  return touch(s, now);
}

export function setHint(session, hint, now = Date.now()) {
  const s = clone(session);
  s.hint = hint;
  return touch(s, now);
}

// ---------------------------------------------------------------- summary

const joinAnd = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

export function counts(s) {
  let total = 0; let done = 0; let skipped = 0;
  for (const ex of s.exercises) for (const st of ex.sets) {
    total++;
    if (st.status === 'done') done++;
    if (st.status === 'skipped') skipped++;
  }
  return { total, done, skipped };
}

export function exerciseSummary(ex) {
  const done = ex.sets.filter((st) => st.status === 'done');
  const skipped = ex.sets.filter((st) => st.status === 'skipped').length;
  const p0 = ex.sets[0].planned;
  const sameReps = ex.sets.every((st) => st.planned.reps === p0.reps);
  const planLoad = p0.load != null || ex.loadType === 'bodyweight' ? ` at ${fmtLoadShort(ex.loadType, p0.load)}` : '';
  const plan = `${ex.sets.length} × ${sameReps ? p0.reps : ex.sets.map((st) => st.planned.reps).join('/')}${planLoad}`;
  const notes = [];
  let short = 0; let over = 0; let lower = 0; let higher = 0;
  for (const st of done) {
    short += Math.max(0, st.planned.reps - st.actual.reps);
    over += Math.max(0, st.actual.reps - st.planned.reps);
    if (st.planned.load != null && st.actual.load != null) {
      if (st.actual.load < st.planned.load) lower++;
      if (st.actual.load > st.planned.load) higher++;
    }
  }
  let doneText = 'not done';
  if (done.length) {
    const loads = [...new Set(done.map((st) => st.actual.load))];
    doneText = `${joinAnd(done.map((st) => String(st.actual.reps)))} reps`;
    if (loads.length === 1 && (p0.load == null || loads[0] !== p0.load) && ex.loadType !== 'bodyweight') doneText += ` at ${fmtLoadShort(ex.loadType, loads[0])}`;
    if (loads.length === 1 && ex.loadType === 'bodyweight' && loads[0]) doneText += ` with ${loads[0]} kg added`;
    if (loads.length > 1) {
      const lastLower = done.length > 1 && done[done.length - 1].actual.load < done[0].actual.load;
      notes.push(lastLower ? 'Last set with a lower load' : `Loads: ${done.map((st) => fmtLoadShort(ex.loadType, st.actual.load)).join(', ')}`);
    }
  }
  if (p0.load == null && ex.loadType !== 'bodyweight' && done.length) notes.push('Starting weight chosen');
  if (skipped) notes.push(`${skipped} set${skipped === 1 ? '' : 's'} skipped`);
  if (ex.swappedFrom) notes.push(`Swapped in for ${ex.swappedFrom.name}`);
  if (done.some((st) => st.actual.edited)) notes.push('Corrected by hand');
  let verdict = 'as planned';
  if (!done.length) verdict = 'skipped';
  else if (short > 0 || lower > 0 || skipped > 0) verdict = 'below plan';
  else if (over > 0 || higher > 0) verdict = 'above plan';
  return { name: ex.name, plan, doneText, notes, verdict, short, over, lower, higher, skipped, doneCount: done.length };
}

export function summarize(s) {
  const c = counts(s);
  const end = s.endedAt || s.updatedAt;
  const lines = s.exercises.map(exerciseSummary);
  const highlights = [];
  for (const l of lines) {
    if (l.verdict === 'skipped') highlights.push(`${l.name}: skipped`);
    else if (l.skipped) highlights.push(`${l.name}: ${l.skipped} set${l.skipped === 1 ? '' : 's'} skipped`);
  }
  for (const l of lines) {
    if (!l.doneCount) continue;
    if (l.lower) highlights.push(`${l.name}: load lowered on ${l.lower} set${l.lower === 1 ? '' : 's'}`);
    else if (l.short) highlights.push(`${l.name}: ${l.short} rep${l.short === 1 ? '' : 's'} under plan`);
    else if (l.higher) highlights.push(`${l.name}: load raised on ${l.higher} set${l.higher === 1 ? '' : 's'}`);
    else if (l.over) highlights.push(`${l.name}: ${l.over} rep${l.over === 1 ? '' : 's'} over plan`);
  }
  return {
    minutes: Math.max(1, Math.round((end - s.startedAt) / 60000)),
    ...c,
    lines,
    highlights,
    onPlan: highlights.length === 0,
  };
}
