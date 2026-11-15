// Reads results and turns them into changes to the plan, using the numbers in
// the rules library. Works with no network. Each change carries the old value,
// the new value and a short reason built only from recorded data. Changes are
// made at once; each keeps what it replaced, so it can be undone.

import { PROGRESSION } from './rules.js';
import { fmtLoadShort, refreshPlan } from './planner.js';
import { summarize } from './session.js';
import { allExercises, canDo, equipmentNames, zoneOf, substitutesFor } from './catalog.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const roundToStep = (v, step) => Math.max(0, Math.round(v / step) * step);

/** Lower a load by about pct percent, and by at least one step. */
export function lowerLoad(value, pct, step) {
  const drop = Math.max(step, roundToStep((value * pct) / 100, step));
  return Math.max(0, Math.round((value - drop) * 100) / 100);
}
export const raiseLoad = (value, step) => Math.round((value + step) * 100) / 100;

const pctText = (from, to) => (from > 0 ? ` (${to > from ? '+' : ''}${Math.round(((to - from) / from) * 100)}%)` : '');

// ---------------------------------------------------------------- in session

/**
 * After a set is saved: should the sets still to come change? Returns a hint
 * or null. Only looks at the set just done and the plan for the rest.
 */
export function inSessionHint(session, exIdx, setIdx) {
  const ex = session.exercises[exIdx];
  const st = ex?.sets[setIdx];
  if (!st?.actual) return null;
  const remaining = ex.sets.map((x, i) => ({ x, i })).filter(({ x, i }) => i > setIdx && x.status === 'pending');
  if (!remaining.length) return null;
  const { reps, load, rir } = st.actual;
  const target = st.target.reps;
  const miss = target - reps;
  const setNo = setIdx + 1;
  const next = remaining[0].x.target;
  const base = { scope: 'set', exerciseKey: ex.key, exerciseName: ex.name, setIndexes: remaining.map((r) => r.i) };
  const mk = (change) => ({ id: uid('hint'), source: 'rules', mode: 'in_session', sessionId: session.id, createdAt: Date.now(), changes: [{ id: uid('chg'), ...base, ...change }] });

  if (miss >= 1 && (rir == null || rir <= 1)) {
    const noLoad = ex.loadType === 'bodyweight' && !load;
    const sure = rir != null;
    if (noLoad) {
      const to = Math.max(1, reps);
      if (to >= next.reps) return null;
      return mk({
        field: 'reps', from: `${next.reps} reps`, to: `${to} reps`, value: to,
        reason: sure
          ? `Set ${setNo}: ${reps} of ${target} reps with nothing left. Aim for ${to} on the sets to come.`
          : `Set ${setNo}: ${reps} of ${target} reps. If that was close to failure, aim for ${to} on the sets to come.`,
      });
    }
    const pct = miss >= PROGRESSION.bigMissReps ? PROGRESSION.bigDropPct : PROGRESSION.smallDropPct;
    const to = lowerLoad(load, pct, ex.step);
    if (next.load != null && to >= next.load) return null;
    return mk({
      field: 'load', from: fmtLoadShort(ex.loadType, next.load ?? load), to: fmtLoadShort(ex.loadType, to), value: to,
      reason: sure
        ? `Set ${setNo}: ${reps} of ${target} reps with ${rir === 0 ? 'nothing' : '1 rep'} left. A lighter load keeps the next sets in range.`
        : `Set ${setNo}: ${reps} of ${target} reps. You can lower the weight if that set was close to failure.`,
    });
  }

  if (miss <= 0 && rir != null && rir >= PROGRESSION.lightRir && load != null && !(ex.loadType === 'bodyweight' && !load)) {
    const to = raiseLoad(load, ex.step);
    if (next.load != null && to <= next.load) return null;
    return mk({
      field: 'load', from: fmtLoadShort(ex.loadType, next.load ?? load), to: fmtLoadShort(ex.loadType, to), value: to,
      reason: `Set ${setNo}: ${reps} reps with ${rir}+ left in the tank. The load is light for this target.`,
    });
  }
  return null;
}

// ---------------------------------------------------------------- after session

function facts(ex) {
  const done = ex.sets.filter((st) => st.status === 'done');
  const allDone = done.length === ex.sets.length;
  const short = done.reduce((n, st) => n + Math.max(0, st.planned.reps - st.actual.reps), 0);
  const loads = [...new Set(done.map((st) => st.actual.load))];
  const plannedLoad = ex.sets[0].planned.load;
  const plannedReps = ex.sets[0].planned.reps;
  // With no weight in the plan yet (it was chosen in this session), the first set done is the yardstick.
  const baseLoad = plannedLoad ?? done[0]?.actual.load ?? null;
  const lowered = done.some((st) => baseLoad != null && st.actual.load != null && st.actual.load < baseLoad);
  return {
    done, allDone, short, loads, plannedLoad, plannedReps, lowered,
    oneLoad: loads.length === 1 ? loads[0] : null,
    minReps: done.length ? Math.min(...done.map((st) => st.actual.reps)) : 0,
    repsList: done.map((st) => st.actual.reps).join(', '),
  };
}

/** Most recent finished session before this one that includes the exercise. */
function previousRun(exerciseId, session, past) {
  const earlier = past
    .filter((p) => p.id !== session.id && p.status === 'done' && p.startedAt < session.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);
  for (const p of earlier) {
    const ex = p.exercises.find((x) => x.exerciseId === exerciseId && x.sets.some((st) => st.status === 'done'));
    if (ex) return ex;
  }
  return null;
}

/**
 * Compare a finished session with the plan and with earlier sessions, and
 * work out the updates for the next sessions. Returns [] when nothing is justified.
 */
export function postSessionChanges(session, plan, past = []) {
  const changes = [];
  if (!plan) return changes;
  if (session.easePct > 0) return changes; // a deliberately lighter comeback session says nothing about the plan
  for (const ex of session.exercises) {
    const entries = plan.days.flatMap((d) => d.exercises.filter((p) => p.exerciseId === ex.exerciseId).map((p) => ({ d, p })));
    if (!entries.length) continue;
    const planEx = entries[0].p;
    const f = facts(ex);
    if (!f.done.length) continue;
    const curLoad = planEx.load?.value ?? null;
    const curReps = planEx.reps;
    const step = planEx.load?.step ?? ex.step;
    const base = { scope: 'exercise', exerciseId: ex.exerciseId, exerciseName: ex.name, dayIds: entries.map((x) => x.d.id) };
    const add = (c) => changes.push({ id: uid('chg'), ...base, ...c });
    const bw = ex.loadType === 'bodyweight';
    const loadLabel = (v) => fmtLoadShort(ex.loadType, v);

    // The user settled on a different weight than planned and still hit the reps.
    if (f.allDone && f.oneLoad != null && curLoad != null && f.oneLoad !== curLoad && f.short === 0 && f.minReps < ex.repHi) {
      add({
        field: 'load', from: loadLabel(curLoad), to: loadLabel(f.oneLoad), value: f.oneLoad,
        reason: `You did every set at ${loadLabel(f.oneLoad)} and hit ${f.repsList} reps. The plan said ${loadLabel(curLoad)}.`,
      });
      continue;
    }

    // Top of the range on every set: raise the load, restart the reps.
    if (f.allDone && f.minReps >= ex.repHi && !f.lowered) {
      const used = f.oneLoad ?? curLoad;
      if (bw && !ex.swappedFrom && ['pull_v', 'push_h'].includes(ex.pattern) && ex.exerciseId !== 'push_up') {
        const to = raiseLoad(used || 0, step);
        add({
          field: 'load', from: loadLabel(used || 0), to: loadLabel(to), value: to, reps: ex.repLo,
          reason: `All ${f.done.length} sets reached ${ex.repHi} reps or more (${f.repsList}). Add a little weight and go back to ${ex.repLo} reps.`,
        });
      } else if (!bw && used != null) {
        const to = raiseLoad(used, step);
        add({
          field: 'load', from: loadLabel(used), to: loadLabel(to) + pctText(used, to), value: to, reps: ex.repLo,
          reason: `All ${f.done.length} sets reached the top of the ${ex.repLo}-${ex.repHi} range (${f.repsList} reps at ${loadLabel(used)}). Next step up, back to ${ex.repLo} reps.`,
        });
      }
      continue;
    }

    // Every set hit the target: one more rep next time.
    if (f.allDone && f.short === 0 && !f.lowered && curReps < ex.repHi && f.minReps >= curReps) {
      const to = Math.min(ex.repHi, Math.max(curReps + 1, Math.min(f.minReps, ex.repHi)));
      if (to > curReps) {
        add({
          field: 'reps', from: `${curReps} reps`, to: `${to} reps`, value: to,
          reason: `You hit ${f.repsList} reps against a target of ${curReps}. Same load, aim for ${to}.`,
        });
      }
      continue;
    }

    // Short of the target. One off day changes nothing; twice running does.
    if ((f.short >= PROGRESSION.shortfallReps || f.lowered) && !bw && curLoad != null) {
      const prev = previousRun(ex.exerciseId, session, past);
      if (prev) {
        const pf = facts(prev);
        const sameOrLighter = pf.plannedLoad != null && f.plannedLoad != null && pf.plannedLoad <= f.plannedLoad;
        if ((pf.short >= PROGRESSION.shortfallReps || pf.lowered) && sameOrLighter) {
          const to = lowerLoad(curLoad, PROGRESSION.deloadPct, step);
          if (to < curLoad) {
            add({
              field: 'load', from: loadLabel(curLoad), to: loadLabel(to) + pctText(curLoad, to), value: to,
              reason: `Second session in a row below target at ${loadLabel(curLoad)} (${pf.repsList} reps last time, ${f.repsList} now). Back off and build up again.`,
            });
          }
        }
      }
    }
  }
  return changes;
}

// ---------------------------------------------------------------- equipment

/** Swaps for plan exercises whose equipment is no longer available. */
export function equipmentChanges(plan, equipment, profile = {}) {
  const all = allExercises(equipment);
  const changes = [];
  for (const d of plan?.days || []) {
    const inDay = d.exercises.map((x) => x.exerciseId);
    for (const ex of d.exercises) {
      const cat = all.find((x) => x.id === ex.exerciseId);
      if (cat && canDo(equipment, cat)) continue;
      const subs = cat ? substitutesFor(equipment, cat.id, { exclude: inDay, avoid: profile.avoid, avoidTags: profile.avoidTags }) : [];
      const sub = subs[0];
      changes.push({
        id: uid('chg'), scope: 'exercise', exerciseKey: ex.key, exerciseName: ex.name, dayIds: [d.id],
        field: sub ? 'exercise' : 'remove',
        from: ex.name, to: sub ? sub.name : 'Removed', value: sub ? sub.id : null,
        reason: sub
          ? `${ex.equipment} is not available any more. ${sub.name} trains the same movement.`
          : `${ex.equipment} is not available any more and nothing else on your list does this movement.`,
      });
      if (sub) inDay.push(sub.id);
    }
  }
  return changes;
}

// ---------------------------------------------------------------- applying

const IDENTITY = ['exerciseId', 'name', 'pattern', 'loadType', 'equipment', 'zone', 'load'];
const pickFields = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] == null ? o[k] ?? null : clone(o[k])]));

/**
 * Make one change to the plan. Returns { plan, weights, touched, undo } with the
 * plan version bumped; `undo` holds what was there before, for undoPlanChange.
 * Finished sessions keep their own copy of the old plan.
 */
export function applyPlanChange(plan, change, equipment, weights = {}) {
  const next = clone(plan);
  const w = { ...weights };
  const undo = { planId: plan.id, items: [], weights: {}, days: [] };
  const targets = [];
  for (const d of next.days) {
    for (const ex of d.exercises) {
      const byKey = change.exerciseKey && ex.key === change.exerciseKey;
      const byId = !change.exerciseKey && change.exerciseId && ex.exerciseId === change.exerciseId;
      if (byKey || byId) targets.push({ d, ex });
    }
  }
  // A load belongs to the exercise, wherever it shows up in the week.
  if (change.field === 'load' && change.exerciseKey && targets.length) {
    const id = targets[0].ex.exerciseId;
    for (const d of next.days) for (const ex of d.exercises) if (ex.exerciseId === id && !targets.some((t) => t.ex === ex)) targets.push({ d, ex });
  }
  for (const { d, ex } of targets) {
    const item = { dayId: d.id, key: ex.key, index: d.exercises.indexOf(ex), field: change.field };
    if (change.field === 'load') {
      item.before = { load: ex.load ? { ...ex.load } : null, reps: ex.reps };
      if (!(ex.exerciseId in undo.weights)) undo.weights[ex.exerciseId] = w[ex.exerciseId] ? { ...w[ex.exerciseId] } : null;
      const step = ex.load?.step ?? w[ex.exerciseId]?.step ?? PROGRESSION.defaultStep[ex.loadType] ?? 2.5;
      ex.load = { value: change.value, step };
      w[ex.exerciseId] = { ...(w[ex.exerciseId] || {}), value: change.value, step, type: ex.loadType, at: Date.now() };
      if (change.reps != null) ex.reps = clampInt(change.reps, 1, 30);
    } else if (change.field === 'reps') {
      item.before = { reps: ex.reps, repLo: ex.repLo, repHi: ex.repHi };
      ex.reps = clampInt(change.value, 1, 30);
      ex.repLo = Math.min(ex.repLo, ex.reps);
      ex.repHi = Math.max(ex.repHi, ex.reps);
    } else if (change.field === 'sets') {
      item.before = { sets: ex.sets };
      ex.sets = clampInt(change.value, 1, 6);
    } else if (change.field === 'rest') {
      item.before = { restSec: ex.restSec };
      ex.restSec = clampInt(change.value, 20, 360);
    } else if (change.field === 'remove') {
      item.before = clone(ex);
      d.exercises = d.exercises.filter((x) => x !== ex);
    } else if (change.field === 'exercise') {
      const cat = allExercises(equipment).find((x) => x.id === change.value);
      if (!cat) continue;
      item.before = pickFields(ex, IDENTITY);
      const known = w[cat.id];
      Object.assign(ex, {
        exerciseId: cat.id, name: cat.name, pattern: cat.pattern, loadType: cat.load,
        equipment: equipmentNames(equipment, cat), zone: zoneOf(equipment, cat),
        load: known ? { value: known.value, step: known.step } : (cat.load === 'bodyweight' ? { value: 0, step: PROGRESSION.defaultStep.bodyweight } : null),
      });
    } else continue;
    undo.items.push(item);
  }
  // A session left with nothing in it goes; it is kept whole so undo can bring it back.
  next.days.forEach((d, i) => { if (!d.exercises.length) undo.days.push({ index: i, day: clone(plan.days.find((x) => x.id === d.id)) }); });
  next.days = next.days.filter((d) => d.exercises.length > 0);
  if (!next.days.length) return { plan, weights, touched: 0, undo: null }; // a plan needs at least one exercise
  if (!undo.items.length) return { plan, weights, touched: 0, undo: null };
  next.version = (plan.version || 1) + 1;
  next.updatedAt = Date.now();
  return { plan: refreshPlan(next), weights: w, touched: undo.items.length, undo };
}

/** Can this change still be taken back? Only on the plan it was made to. */
export const canUndo = (plan, change) => !!plan && !!change?.undo && change.undo.planId === plan.id && (change.status === 'applied' || change.status === 'edited');

/**
 * Take one change back. Each value returns only where it still is what the
 * change set it to: anything changed again since is left alone.
 * Returns { plan, weights, touched }; touched 0 means nothing could be undone.
 */
export function undoPlanChange(plan, change, weights = {}) {
  const u = change?.undo;
  if (!u || !plan || plan.id !== u.planId) return { plan, weights, touched: 0 };
  const next = clone(plan);
  const w = { ...weights };
  let touched = 0;
  const back = new Set();
  for (const r of u.days || []) {
    if (next.days.some((d) => d.id === r.day.id)) continue;
    next.days.splice(Math.min(r.index, next.days.length), 0, clone(r.day));
    back.add(r.day.id);
    touched++;
  }
  for (const it of u.items) {
    if (back.has(it.dayId)) continue;
    const d = next.days.find((x) => x.id === it.dayId);
    if (!d) continue;
    if (it.field === 'remove') {
      if (d.exercises.some((x) => x.key === it.key)) continue;
      d.exercises.splice(Math.min(it.index, d.exercises.length), 0, clone(it.before));
      touched++;
      continue;
    }
    const ex = d.exercises.find((x) => x.key === it.key);
    if (!ex) continue;
    if (it.field === 'load') {
      if (ex.load?.value !== change.value) continue;
      ex.load = it.before.load ? { ...it.before.load } : null;
      if (change.reps != null && ex.reps === clampInt(change.reps, 1, 30)) ex.reps = it.before.reps;
    } else if (it.field === 'reps') {
      if (ex.reps !== clampInt(change.value, 1, 30)) continue;
      Object.assign(ex, it.before);
    } else if (it.field === 'sets') {
      if (ex.sets !== clampInt(change.value, 1, 6)) continue;
      ex.sets = it.before.sets;
    } else if (it.field === 'rest') {
      if (ex.restSec !== clampInt(change.value, 20, 360)) continue;
      ex.restSec = it.before.restSec;
    } else if (it.field === 'exercise') {
      if (ex.exerciseId !== change.value) continue;
      Object.assign(ex, clone(it.before));
    }
    touched++;
  }
  if (!touched) return { plan, weights, touched: 0 };
  for (const [id, prev] of Object.entries(u.weights || {})) {
    if (w[id]?.value !== change.value) continue;
    if (prev) w[id] = prev; else delete w[id];
  }
  next.version = (plan.version || 1) + 1;
  next.updatedAt = Date.now();
  return { plan: refreshPlan(next), weights: w, touched };
}

/** Fields the user can correct by hand after a change was made. */
export const EDITABLE = ['load', 'reps', 'sets', 'rest'];

/** The same change with another value, typed by the user. Null when the value makes no sense. */
export function withValue(plan, change, value) {
  const v = Number(value);
  if (!EDITABLE.includes(change.field) || !Number.isFinite(v) || v < 0) return null;
  const ex = plan?.days.flatMap((d) => d.exercises).find((x) => (change.exerciseKey ? x.key === change.exerciseKey : x.exerciseId === change.exerciseId));
  if (!ex) return null;
  const next = { ...change, undo: undefined };
  if (change.field === 'load') {
    next.value = Math.round(v * 100) / 100;
    next.to = fmtLoadShort(ex.loadType, next.value);
  } else {
    const lim = { reps: [1, 30], sets: [1, 6], rest: [20, 360] }[change.field];
    next.value = clampInt(v, lim[0], lim[1]);
    next.to = `${next.value}${{ reps: ' reps', sets: ' sets', rest: ' s rest' }[change.field]}`;
  }
  return next;
}

// ---------------------------------------------------------------- summary in words

const secText = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min` : `${sec} s`);

/**
 * The workout in two or three sentences, from the records alone: what was done
 * against the plan, and what changes for next time. Used when no model is
 * connected, and until the model's own summary arrives.
 */
export function ruleSummary(session, changes = []) {
  const sum = summarize(session);
  const parts = [];
  parts.push(sum.done === sum.total
    ? `All ${sum.total} sets done in ${sum.minutes} min.`
    : `${sum.done} of ${sum.total} sets done in ${sum.minutes} min${sum.skipped ? `, ${sum.skipped} skipped` : ''}.`);
  if (sum.onPlan) parts.push('Everything went to plan.');
  else parts.push(`${sum.highlights.slice(0, 2).join('; ')}${sum.highlights.length > 2 ? `, and ${sum.highlights.length - 2} more` : ''}.`);
  if (sum.rests && sum.rests.actual > sum.rests.planned * 1.3) parts.push(`Rests between sets ran to ${secText(sum.rests.actual)} on average against ${secText(sum.rests.planned)} planned.`);
  if (session.easePct > 0) parts.push('This was a lighter session to ease back in, so the plan keeps its numbers.');
  else if (changes.length) parts.push(`Changed for next time: ${changes.slice(0, 3).map((c) => `${c.exerciseName} ${c.field === 'remove' ? 'removed' : `→ ${c.to}`}`).join('; ')}${changes.length > 3 ? `, and ${changes.length - 3} more` : ''}.`);
  else parts.push('Nothing in the plan needs to change yet.');
  return parts.join(' ');
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Math.min(Math.max(Number.isFinite(n) ? n : lo, lo), hi);
}

/**
 * Turn changes returned by Claude into the app's change shape. Anything that
 * does not point at a real exercise or a sane value is dropped. The "from"
 * value always comes from the app's own records, never from the model.
 */
export function fromAiChanges(raw, { plan, session, equipment, mode }) {
  const out = [];
  const all = allExercises(equipment);
  for (const r of raw || []) {
    const field = String(r.field || '');
    const reason = String(r.reason || '').slice(0, 280);
    if (!reason) continue;
    if (mode === 'in_session') {
      const ex = session?.exercises.find((x) => x.key === r.exercise_key);
      if (!ex || !['load', 'reps', 'rest'].includes(field)) continue;
      const pending = ex.sets.map((st, i) => ({ st, i })).filter(({ st }) => st.status === 'pending');
      if (!pending.length) continue;
      const value = Number(r.new_value);
      if (!Number.isFinite(value) || value < 0) continue;
      const t = pending[0].st.target;
      const from = field === 'load' ? fmtLoadShort(ex.loadType, t.load) : field === 'reps' ? `${t.reps} reps` : `${ex.restSec} s rest`;
      const v = field === 'load' ? Math.round(value * 100) / 100 : clampInt(value, field === 'rest' ? 20 : 1, field === 'rest' ? 360 : 30);
      const to = field === 'load' ? fmtLoadShort(ex.loadType, v) : field === 'reps' ? `${v} reps` : `${v} s rest`;
      if (from === to) continue;
      out.push({ id: uid('chg'), scope: 'set', exerciseKey: ex.key, exerciseName: ex.name, setIndexes: pending.map((p) => p.i), field, from, to, value: v, reason });
      continue;
    }
    const found = plan?.days.flatMap((d) => d.exercises.map((ex) => ({ d, ex }))).find(({ ex }) => ex.key === r.exercise_key);
    if (!found) continue;
    const { d, ex } = found;
    const base = { id: uid('chg'), scope: 'exercise', exerciseKey: ex.key, exerciseName: ex.name, dayIds: [d.id], reason };
    if (field === 'exercise') {
      const cat = all.find((x) => x.id === r.new_exercise_id);
      if (!cat || !canDo(equipment, cat) || cat.id === ex.exerciseId || d.exercises.some((x) => x.exerciseId === cat.id)) continue;
      out.push({ ...base, field, from: ex.name, to: cat.name, value: cat.id });
    } else if (field === 'remove') {
      out.push({ ...base, field, from: ex.name, to: 'Removed', value: null });
    } else if (['load', 'reps', 'sets', 'rest'].includes(field)) {
      const value = Number(r.new_value);
      if (!Number.isFinite(value) || value < 0) continue;
      if (field === 'load') {
        if (ex.loadType === 'bodyweight' && value === 0 && !ex.load?.value) continue;
        const v = Math.round(value * 100) / 100;
        if (ex.load && v === ex.load.value) continue;
        out.push({ ...base, field, from: fmtLoadShort(ex.loadType, ex.load?.value ?? null), to: fmtLoadShort(ex.loadType, v), value: v });
      } else {
        const lim = { reps: [1, 30], sets: [1, 6], rest: [20, 360] }[field];
        const v = clampInt(value, lim[0], lim[1]);
        const cur = { reps: ex.reps, sets: ex.sets, rest: ex.restSec }[field];
        if (v === cur) continue;
        const unit = { reps: ' reps', sets: ' sets', rest: ' s rest' }[field];
        out.push({ ...base, field, from: `${cur}${unit}`, to: `${v}${unit}`, value: v });
      }
    }
  }
  return out;
}

export function describeChange(c) {
  const what = { load: 'Weight', reps: 'Reps', sets: 'Sets', rest: 'Rest', exercise: 'Exercise', remove: 'Exercise' }[c.field] || 'Change';
  const extra = c.field === 'load' && c.reps != null ? `, ${c.reps} reps` : '';
  return { what, text: `${c.from} → ${c.to}${extra}` };
}

/** Is the change in the plan right now? */
export const isApplied = (c) => c.status === 'applied' || c.status === 'edited';
