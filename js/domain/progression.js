// Reads results and turns them into proposed changes, using the numbers in the
// rules library. Works with no network. Each change carries the old value, the
// new value and a short reason built only from recorded data.

import { PROGRESSION } from './rules.js';
import { fmtLoadShort, refreshPlan } from './planner.js';
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
  const lowered = done.some((st) => plannedLoad != null && st.actual.load != null && st.actual.load < plannedLoad);
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
 * propose updates for the next sessions. Returns [] when nothing is justified.
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

/**
 * Apply one accepted change to the plan. Returns { plan, weights } with the
 * plan version bumped. Finished sessions keep their own copy of the old plan.
 */
export function applyPlanChange(plan, change, equipment, weights = {}) {
  const next = clone(plan);
  const w = { ...weights };
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
    if (change.field === 'load') {
      const step = ex.load?.step ?? PROGRESSION.defaultStep[ex.loadType] ?? 2.5;
      ex.load = { value: change.value, step };
      w[ex.exerciseId] = { ...(w[ex.exerciseId] || {}), value: change.value, step, type: ex.loadType, at: Date.now() };
      if (change.reps != null) ex.reps = clampInt(change.reps, 1, 30);
    } else if (change.field === 'reps') {
      ex.reps = clampInt(change.value, 1, 30);
      ex.repLo = Math.min(ex.repLo, ex.reps);
      ex.repHi = Math.max(ex.repHi, ex.reps);
    } else if (change.field === 'sets') {
      ex.sets = clampInt(change.value, 1, 6);
    } else if (change.field === 'rest') {
      ex.restSec = clampInt(change.value, 20, 360);
    } else if (change.field === 'remove') {
      d.exercises = d.exercises.filter((x) => x !== ex);
    } else if (change.field === 'exercise') {
      const cat = allExercises(equipment).find((x) => x.id === change.value);
      if (!cat) continue;
      const known = w[cat.id];
      Object.assign(ex, {
        exerciseId: cat.id, name: cat.name, pattern: cat.pattern, loadType: cat.load,
        equipment: equipmentNames(equipment, cat), zone: zoneOf(equipment, cat),
        load: known ? { value: known.value, step: known.step } : (cat.load === 'bodyweight' ? { value: 0, step: PROGRESSION.defaultStep.bodyweight } : null),
      });
    }
  }
  next.days = next.days.filter((d) => d.exercises.length > 0);
  if (!next.days.length) return { plan, weights, touched: 0 }; // a plan needs at least one exercise
  next.version = (plan.version || 1) + 1;
  next.updatedAt = Date.now();
  return { plan: refreshPlan(next), weights: w, touched: targets.length };
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
