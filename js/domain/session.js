// Workout session state machine. Pure functions: each takes a session and
// returns a new one, so the UI can save after every step and a reload picks up
// exactly where the user left off.
//
//   ready -> active -> rest -> active ... -> summary
//
// One tap finishes a set: it is saved as planned and the rest starts. The set
// can be nudged before the tap or during the rest, or undone. "rest" stores the
// time it ends, not a countdown, so coming back to the tab shows the right time
// left, and the next set can start by itself from that moment.

import { TIME, PROGRESSION, TARGET_RIR, ACTIVITIES } from './rules.js';
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
    last: null, // the set finished last, for adjusting or undoing it during the rest
    lastSetEndedAt: null,
    log: [[0, 'start', dayId]],
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

// ---------------------------------------------------------------- the log
// Every tap and every change is written down with its time, in seconds from
// the start of the workout: when a set began and ended, how long rests really
// took, what was adjusted, skipped, swapped or corrected. Nothing reads all of
// it yet; it is kept so the detail is there when it is wanted.

function ev(s, now, type, ...data) {
  (s.log = s.log || []).push([Math.round((now - s.startedAt) / 100) / 10, type, ...data]);
}

/** Note something that happened outside the workout steps, such as the screen going off. */
export function logEvent(session, type, data = [], now = Date.now()) {
  const s = clone(session);
  ev(s, now, type, ...data);
  return touch(s, now);
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
  ev(s, now, 'weight', ex.key, value, ex.step);
  return touch(s, now);
}

/**
 * Start the set. `auto` marks a set that began by itself when the rest ran out.
 * The set remembers when it started and how long the rest before it really was.
 */
export function beginSet(session, now = Date.now(), { auto = false } = {}) {
  if (needsWeight(session)) throw new Error('Pick a starting weight first.');
  const s = clone(session);
  const { set, exIdx, setIdx } = current(s);
  s.phase = 'active';
  s.setStartedAt = now;
  s.rest = null;
  set.startedAt = now;
  set.auto = auto;
  set.restBeforeSec = s.lastSetEndedAt ? Math.max(0, Math.round((now - s.lastSetEndedAt) / 1000)) : null;
  s.draft = { reps: set.target.reps, load: set.target.load, rir: null };
  ev(s, now, 'set_start', exIdx, setIdx, auto ? 'auto' : 'tap', set.restBeforeSec);
  return touch(s, now);
}

/** "Start now": the set began by itself, but the user is only starting it now. */
export function restartSet(session, now = Date.now()) {
  if (session.phase !== 'active') return session;
  const s = clone(session);
  const { set, exIdx, setIdx } = current(s);
  s.setStartedAt = now;
  set.startedAt = now;
  set.auto = false;
  set.restBeforeSec = s.lastSetEndedAt ? Math.max(0, Math.round((now - s.lastSetEndedAt) / 1000)) : null;
  ev(s, now, 'set_restart', exIdx, setIdx, set.restBeforeSec);
  return touch(s, now);
}

/** Not doing the set after all: go back without recording anything. */
export function cancelSet(session, now = Date.now()) {
  const s = clone(session);
  const { exIdx, setIdx } = current(s);
  s.phase = 'ready';
  s.setStartedAt = null;
  s.draft = null;
  ev(s, now, 'set_cancel', exIdx, setIdx);
  return touch(s, now);
}

const cleanReps = (v) => Math.min(Math.max(Math.round(v), 0), 99);
const cleanLoad = (v) => Math.max(Math.round(v * 100) / 100, 0);

/** Change what will be recorded for the set in progress: reps, weight, reps in reserve. */
export function editDraft(session, patch, now = Date.now()) {
  const s = clone(session);
  const before = { ...s.draft };
  s.draft = { ...s.draft, ...patch };
  if (s.draft.reps != null) s.draft.reps = cleanReps(s.draft.reps);
  if (s.draft.load != null) s.draft.load = cleanLoad(s.draft.load);
  for (const k of Object.keys(patch)) if (before[k] !== s.draft[k]) ev(s, now, 'adjust', s.cursor.ex, s.cursor.set, k, before[k] ?? null, s.draft[k] ?? null, 'before_finish');
  return touch(s, now);
}

/**
 * "Finish set": one tap. The set is saved as planned (or as adjusted while it
 * ran) and the rest starts. After the last set of the workout, it ends.
 */
export function finishSet(session, now = Date.now()) {
  const s = clone(session);
  const { ex, set, exIdx, setIdx } = current(s);
  const d = s.draft || { reps: set.target.reps, load: set.target.load, rir: null };
  set.actual = {
    reps: d.reps,
    load: d.load,
    rir: d.rir ?? null,
    at: now,
    seconds: s.setStartedAt ? Math.max(0, Math.round((now - s.setStartedAt) / 1000)) : null,
  };
  set.status = 'done';
  s.last = { key: ex.key, set: setIdx, startedAt: s.setStartedAt, endedBefore: s.lastSetEndedAt ?? null };
  s.lastSetEndedAt = now;
  s.draft = null;
  s.setStartedAt = null;
  s.hint = null; // a change made after the set before stays in the targets; its card goes
  s.hintUndone = false;
  ev(s, now, 'set_finish', exIdx, setIdx, d.reps, d.load, set.actual.seconds);
  // A weight changed by hand carries to the sets still to come.
  if (d.load != null && d.load !== set.target.load) {
    for (const st of ex.sets) if (st.status === 'pending') st.target.load = d.load;
  }
  const lastOfExercise = !ex.sets.some((st) => st.status === 'pending');
  if (!advance(s)) return endSession(s, now);
  const restSec = lastOfExercise ? TIME.transitionSec : ex.restSec;
  s.phase = 'rest';
  s.rest = { startedAt: now, endsAt: now + restSec * 1000, plannedSec: restSec, betweenExercises: lastOfExercise };
  ev(s, now, 'rest_start', restSec, lastOfExercise ? 'next_exercise' : 'next_set');
  return touch(s, now);
}

/** The set finished last, while the workout is still running, or null. */
export function lastSet(s) {
  if (!s.last || s.status !== 'active') return null;
  const exIdx = s.exercises.findIndex((x) => x.key === s.last.key);
  const st = exIdx >= 0 ? s.exercises[exIdx].sets[s.last.set] : null;
  return st && st.status === 'done' ? { ex: s.exercises[exIdx], set: st, exIdx, setIdx: s.last.set } : null;
}

/** During the rest: correct the set just finished. A new weight carries to the sets still to come. */
export function adjustLast(session, patch, now = Date.now()) {
  const s = clone(session);
  const L = lastSet(s);
  if (!L) return session;
  revertHint(s); // a change made from the old numbers no longer holds; it is worked out again
  s.hintUndone = false;
  const a = L.set.actual;
  const before = { reps: a.reps, load: a.load, rir: a.rir };
  if (patch.reps != null) a.reps = cleanReps(patch.reps);
  if (patch.load != null) a.load = cleanLoad(patch.load);
  if ('rir' in patch) a.rir = patch.rir ?? null;
  for (const k of Object.keys(patch)) if (before[k] !== a[k]) ev(s, now, 'adjust', L.exIdx, L.setIdx, k, before[k] ?? null, a[k] ?? null, 'after_finish');
  if (patch.load != null && a.load !== before.load) for (const st of L.ex.sets) if (st.status === 'pending') st.target.load = a.load;
  return touch(s, now);
}

/** Finished by mistake: the set is open again, its clock still running from when it started. */
export function undoFinish(session, now = Date.now()) {
  const s = clone(session);
  const L = lastSet(s);
  if (!L || s.phase !== 'rest') return session;
  revertHint(s);
  s.hintUndone = false;
  const a = L.set.actual;
  L.set.actual = null;
  L.set.status = 'pending';
  s.cursor = { ex: L.exIdx, set: L.setIdx };
  s.phase = 'active';
  s.setStartedAt = s.last.startedAt || now;
  s.lastSetEndedAt = s.last.endedBefore;
  s.rest = null;
  s.draft = { reps: a.reps, load: a.load, rir: a.rir ?? null };
  s.last = null;
  ev(s, now, 'undo', L.exIdx, L.setIdx);
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
  const { set, exIdx, setIdx } = current(s);
  set.status = 'skipped';
  ev(s, now, 'skip_set', exIdx, setIdx);
  return afterSkip(s, now);
}

/** Drop the exercise for today: its remaining sets are saved as skipped. */
export function dropExercise(session, now = Date.now()) {
  const s = clone(session);
  const { ex } = current(s);
  for (const st of ex.sets) if (st.status === 'pending') st.status = 'skipped';
  ex.dropped = true;
  ev(s, now, 'drop', ex.key);
  return afterSkip(s, now);
}
export const skipExercise = dropExercise;

/** Are there other exercises with sets still to do? */
export const hasOthers = (s) => s.exercises.some((x, i) => i !== s.cursor.ex && x.sets.some((st) => st.status === 'pending'));

/**
 * Machine busy, or not now: the exercise goes to the back of the workout and
 * the next one comes up. It returns when the others are done.
 */
export function postponeExercise(session, now = Date.now()) {
  if (!hasOthers(session)) return session;
  const s = clone(session);
  const at = s.cursor.ex;
  const [ex] = s.exercises.splice(at, 1);
  ex.postponed = (ex.postponed || 0) + 1;
  s.exercises.push(ex);
  s.cursor = { ex: Math.min(at, s.exercises.length - 1), set: 0 };
  ev(s, now, 'later', ex.key);
  return afterSkip(s, now);
}

/** Move to another exercise that still has sets to do. A set in progress is put down first. */
export function goToExercise(session, exIdx, now = Date.now()) {
  const target = session.exercises[exIdx];
  const idx = target ? target.sets.findIndex((st) => st.status === 'pending') : -1;
  if (idx < 0) return session;
  const s = clone(session);
  s.cursor = { ex: exIdx, set: idx };
  s.draft = null;
  s.setStartedAt = null;
  s.hint = null;
  if (s.phase !== 'rest') s.phase = 'ready';
  ev(s, now, 'jump', s.exercises[exIdx].key);
  return touch(s, now);
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
  ev(s, now, 'rest_extend', seconds);
  return touch(s, now);
}

export function skipRest(session, now = Date.now()) {
  const s = clone(session);
  s.rest = null;
  s.phase = 'ready';
  ev(s, now, 'rest_skip');
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
  ev(s, now, 'swap', ex.exerciseId, sub.exerciseId);
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
  if (s.phase === 'active') { s.phase = 'ready'; s.setStartedAt = null; s.draft = null; }
  return touch(s, now);
}

/** Fix a set that was saved wrongly, during the session or later from History. */
export function editSet(session, exIdx, setIdx, actual, now = Date.now()) {
  const s = clone(session);
  const st = s.exercises[exIdx]?.sets[setIdx];
  if (!st) return s;
  const before = st.actual ? [st.actual.reps, st.actual.load, st.actual.rir ?? null] : null;
  st.actual = {
    ...(st.actual || { at: now, seconds: null }),
    reps: cleanReps(actual.reps),
    load: actual.load == null ? null : Math.max(actual.load, 0),
    rir: actual.rir ?? null,
    edited: true,
  };
  ev(s, now, 'edit', exIdx, setIdx, before, [st.actual.reps, st.actual.load, st.actual.rir]);
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
  s.last = null;
  ev(s, now, 'end');
  return touch(s, now);
}

// ---------------------------------------------------------------- effort

/**
 * What to aim for on this set, in words: stop at the target, or push on.
 * Sets before the last stop with reps in reserve; the last set of an exercise
 * may go past the target (rule EFF-1).
 */
export function effortCue(ex, setIdx, level = 'intermediate') {
  const target = ex.sets[setIdx]?.target.reps;
  const isLast = !ex.sets.some((st, i) => i > setIdx && st.status === 'pending');
  const [lo, hi] = TARGET_RIR[level] || TARGET_RIR.intermediate;
  if (!isLast) {
    return { push: false, title: `Stop at ${target}`, text: `Do ${target} good reps and stop there, even if more are in you. Leave ${lo}-${hi} in the tank; the last set is the one to push.` };
  }
  const short = ex.tier === 'main' && level === 'novice' ? 2 : 1;
  return {
    push: true,
    title: `Last set: ${target} or more`,
    text: `Keep going past ${target} while the reps stay clean, and stop ${short} short of failure. Add the extra reps with +1: they show when you are ready for more weight.`,
  };
}

/** How long the rests really were, against what was planned (between sets of one exercise). */
export function restStats(s) {
  let planned = 0; let actual = 0; let n = 0;
  for (const ex of s.exercises) {
    ex.sets.forEach((st, i) => {
      if (i === 0 || st.status !== 'done' || !Number.isFinite(st.restBeforeSec) || ex.sets[i - 1].status !== 'done') return;
      planned += ex.restSec; actual += st.restBeforeSec; n++;
    });
  }
  return n ? { count: n, planned: Math.round(planned / n), actual: Math.round(actual / n) } : null;
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

/**
 * Put a change into effect for the sets still to come. It is made at once and
 * stays on screen with its reason and an Undo; a newer one replaces it.
 */
export function applyHint(session, hint, now = Date.now()) {
  const s = clone(session);
  revertHint(s);
  const undo = [];
  for (const c of hint.changes) {
    const ex = s.exercises.find((x) => x.key === c.exerciseKey);
    if (!ex) continue;
    const wanted = c.setIndexes;
    ex.sets.forEach((st, i) => {
      if (st.status !== 'pending' || (wanted && !wanted.includes(i))) return;
      if (c.field !== 'load' && c.field !== 'reps') return;
      undo.push({ key: ex.key, i, load: st.target.load, reps: st.target.reps, note: st.note ?? null });
      if (c.field === 'load') st.target.load = c.value;
      if (c.field === 'reps') st.target.reps = c.value;
      st.note = c.reason;
    });
    if (c.field === 'rest') { undo.push({ key: ex.key, restSec: ex.restSec }); ex.restSec = c.value; }
  }
  if (!undo.length) return session;
  s.hint = { ...hint, applied: true, undo };
  s.hintUndone = false;
  ev(s, now, 'hint_apply', hint.source, hint.changes.map((c) => [c.field, c.value]));
  return touch(s, now);
}

// Put the targets back to what they were before the change on screen was made.
function revertHint(s) {
  const h = s.hint;
  s.hint = null;
  if (!h?.applied) return false;
  for (const u of h.undo || []) {
    const ex = s.exercises.find((x) => x.key === u.key);
    if (!ex) continue;
    if ('restSec' in u) { ex.restSec = u.restSec; continue; }
    const st = ex.sets[u.i];
    if (st && st.status === 'pending') { st.target.load = u.load; st.target.reps = u.reps; st.note = u.note; }
  }
  return true;
}

/** The session as it would be without the change on screen. Nothing is logged. */
export function withoutHint(session) {
  if (!session.hint) return session;
  const s = clone(session);
  revertHint(s);
  return s;
}

/** "Undo" on the change for the sets to come: the targets go back, and it is not made again for this set. */
export function undoHint(session, now = Date.now()) {
  if (!session.hint?.applied) return session;
  const s = clone(session);
  const src = s.hint.source;
  revertHint(s);
  s.hintUndone = true;
  ev(s, now, 'hint_undo', src);
  return touch(s, now);
}

/** Take the change card off the screen. The targets stay as they are. */
export function setHint(session, hint, now = Date.now()) {
  const s = clone(session);
  if (!hint && s.hint) ev(s, now, 'hint_seen', s.hint.source);
  s.hint = hint;
  return touch(s, now);
}

// ---------------------------------------------------------------- other activity

/**
 * A run, a ride, a game: logged by how long it took and how hard it was. It is
 * kept with the workouts, with no exercises, and counts toward recovery.
 * @param {{type: string, minutes: number, effort: string, daysAgo?: number, note?: string}} a
 */
export function newActivity({ type, minutes, effort = 'moderate', daysAgo = 0, note = '' }, now = Date.now()) {
  const kind = ACTIVITIES[type] ? type : 'other';
  const mins = Math.min(Math.max(Math.round(Number(minutes)) || 0, 1), 600);
  let end = now;
  if (daysAgo > 0) { const d = new Date(now); d.setHours(18, 0, 0, 0); end = d.getTime() - daysAgo * 864e5; }
  return {
    id: `a-${now.toString(36)}`, kind: 'activity', activity: kind, title: ACTIVITIES[kind].label,
    minutes: mins, effort, note: String(note || '').slice(0, 200),
    startedAt: end - mins * 60000, endedAt: end, updatedAt: now, status: 'done',
    exercises: [],
  };
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
    rests: restStats(s),
  };
}

// ---------------------------------------------------------------- reading the log

const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** The saved log as lines to read: the time from the start, and what happened. */
export function readLog(s) {
  const name = (ref) => (typeof ref === 'number' ? s.exercises[ref]?.name : s.exercises.find((x) => x.key === ref)?.name) || 'exercise';
  const setOf = (e, i) => `${name(e)}, set ${i + 1}`;
  const out = [];
  for (const [t, type, ...d] of s.log || []) {
    let text = null;
    if (type === 'start') text = 'Workout started';
    else if (type === 'set_start') text = `${setOf(d[0], d[1])} started${d[2] === 'auto' ? ' by itself' : ''}${d[3] != null ? ` after ${mmss(d[3])} of rest` : ''}`;
    else if (type === 'set_restart') text = `${setOf(d[0], d[1])}: "Start now", clock reset`;
    else if (type === 'set_cancel') text = `${setOf(d[0], d[1])}: put down, not started yet`;
    else if (type === 'set_finish') text = `${setOf(d[0], d[1])} finished: ${d[2]} reps${d[3] != null ? ` at ${d[3]}` : ''}${d[4] != null ? `, ${d[4]} s under load` : ''}`;
    else if (type === 'adjust') text = `${setOf(d[0], d[1])}: ${d[2] === 'rir' ? 'reps left in the tank' : d[2] === 'load' ? 'weight' : 'reps'} ${d[3] ?? 'not set'} → ${d[4] ?? 'not set'}${d[5] === 'after_finish' ? ' during the rest' : ''}`;
    else if (type === 'undo') text = `${setOf(d[0], d[1])}: finish undone`;
    else if (type === 'rest_start') text = `Rest of ${mmss(d[0])} started${d[1] === 'next_exercise' ? ', moving to the next exercise' : ''}`;
    else if (type === 'rest_extend') text = `Rest made ${d[0]} s longer`;
    else if (type === 'rest_skip') text = 'Rest cut short';
    else if (type === 'skip_set') text = `${setOf(d[0], d[1])} skipped`;
    else if (type === 'drop') text = `${name(d[0])} dropped for today`;
    else if (type === 'later') text = `${name(d[0])} put off until later`;
    else if (type === 'jump') text = `Moved to ${name(d[0])}`;
    else if (type === 'swap') text = 'Exercise swapped for another';
    else if (type === 'weight') text = `${name(d[0])}: starting weight ${d[1]}, step ${d[2]}`;
    else if (type === 'edit') text = `${setOf(d[0], d[1])} corrected by hand`;
    else if (type === 'hint_apply') text = `Targets changed for the sets to come (${d[0] === 'rules' ? 'training rules' : d[0]})`;
    else if (type === 'hint_undo') text = 'That change was undone';
    else if (type === 'screen_off') text = 'Screen off, or the app left';
    else if (type === 'screen_on') text = 'Back on screen';
    else if (type === 'end') text = 'Workout ended';
    if (text) out.push({ at: mmss(t), text });
  }
  return out;
}
