import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, SOURCES, PRESCRIPTION, prescribe, levelFor, rulesAsText, RULES_VERSION } from '../js/domain/rules.js';
import { emptyEquipment, isAvailable, substitutesFor, allExercises, EXERCISES, EQUIPMENT, canDo } from '../js/domain/catalog.js';
import { generatePlan, emptyProfile, missingFields, dayMinutes, buildAssumptions, normalizePlan, brokenExercises, nextDay, weeklySets } from '../js/domain/planner.js';
import * as S from '../js/domain/session.js';
import { inSessionHint, postSessionChanges, applyPlanChange, lowerLoad, equipmentChanges, fromAiChanges } from '../js/domain/progression.js';

const profile = (over = {}) => ({ ...emptyProfile(), goal: 'strength', months: 12, daysPerWeek: 3, days: ['mon', 'wed', 'fri'], minutes: 50, ...over });
const T0 = Date.UTC(2026, 10, 9, 17, 0, 0); // a Monday

test('rules: every rule has a known source and the library has a version', () => {
  assert.match(RULES_VERSION, /^\d+\.\d+\.\d+$/);
  for (const r of RULES) for (const s of r.sources) assert.ok(SOURCES[s], `${r.id} cites unknown source ${s}`);
  const areas = new Set(RULES.map((r) => r.area));
  for (const a of ['Exercise selection', 'Volume', 'Intensity', 'Rest', 'Progression', 'Substitutes', 'Reading results']) assert.ok(areas.has(a), `missing area ${a}`);
  assert.ok(rulesAsText().includes(RULES_VERSION));
});

test('rules: prescription follows goal, level and load type', () => {
  assert.deepEqual(prescribe('strength', 'main', 'intermediate', 'total'), { sets: 4, repLo: 4, repHi: 6, rest: 180 });
  const db = prescribe('strength', 'main', 'intermediate', 'per_dumbbell');
  assert.ok(db.repLo >= 6, 'no low-rep dumbbell work');
  const nov = prescribe('strength', 'main', 'novice', 'total');
  assert.ok(nov.sets <= 3 && nov.repLo >= 6);
  assert.equal(levelFor(3), 'novice'); assert.equal(levelFor(12), 'intermediate'); assert.equal(levelFor(40), 'advanced');
});

test('catalog: every exercise uses known equipment', () => {
  const ids = new Set(EQUIPMENT.map((x) => x.id));
  for (const x of EXERCISES) for (const q of x.equip) assert.ok(ids.has(q), `${x.id} needs unknown ${q}`);
  assert.equal(new Set(EXERCISES.map((x) => x.id)).size, EXERCISES.length);
});

test('equipment: basics on by default, machines only when added', () => {
  const eq = emptyEquipment();
  assert.ok(isAvailable(eq, 'dumbbells') && isAvailable(eq, 'pullup_bar') && isAvailable(eq, 'bench') && isAvailable(eq, 'barbell'));
  assert.ok(!isAvailable(eq, 'leg_press'));
  eq.items.leg_press = true; assert.ok(isAvailable(eq, 'leg_press'));
  eq.items.dumbbells = false; assert.ok(!isAvailable(eq, 'dumbbells'));
});

test('planner: 3 days gives upper / lower / full within the time budget', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  assert.deepEqual(plan.days.map((d) => d.title), ['Upper body', 'Lower body', 'Full body']);
  assert.deepEqual(plan.days.map((d) => d.weekday), ['mon', 'wed', 'fri']);
  for (const d of plan.days) {
    assert.ok(d.estMinutes <= 50, `${d.title} is ${d.estMinutes} min`);
    assert.ok(d.exercises.length >= 3);
    assert.equal(d.estMinutes, dayMinutes(d.exercises));
    for (const ex of d.exercises) {
      const cat = EXERCISES.find((x) => x.id === ex.exerciseId);
      assert.ok(canDo(emptyEquipment(), cat), `${ex.name} needs unavailable equipment`);
      assert.ok(ex.sets >= 2 && ex.reps >= ex.repLo && ex.restSec > 0);
    }
  }
  assert.equal(plan.days[0].exercises[0].name, 'Dumbbell bench press');
  assert.equal(plan.days[0].exercises[0].load, null, 'no history means no weight yet');
});

test('planner: every day count from 1 to 6 produces a full week', () => {
  for (let n = 1; n <= 6; n++) {
    const plan = generatePlan(profile({ daysPerWeek: n, days: [] }), emptyEquipment(), {}, T0);
    assert.equal(plan.days.length, n);
    for (const d of plan.days) assert.ok(d.exercises.length >= 3, `${n} days: ${d.title} has ${d.exercises.length}`);
  }
  assert.equal(generatePlan(profile({ daysPerWeek: 7, days: [] }), emptyEquipment(), {}, T0).days.length, 6);
});

test('planner: uses machines once added, honours skip, include and limitations', () => {
  const eq = emptyEquipment(); eq.items.rack = true; eq.items.leg_press = true; eq.items.lat_pulldown = true;
  const plan = generatePlan(profile(), eq, {}, T0);
  const names = plan.days.flatMap((d) => d.exercises.map((x) => x.exerciseId));
  assert.ok(names.includes('bb_bench_press') && names.includes('bb_back_squat'));
  const noDl = generatePlan(profile({ avoid: ['bb_deadlift', 'bb_rdl', 'db_rdl'] }), eq, {}, T0);
  assert.ok(!noDl.days.flatMap((d) => d.exercises.map((x) => x.exerciseId)).some((id) => /deadlift|rdl/.test(id)));
  const knee = generatePlan(profile({ avoidTags: ['knee'] }), eq, {}, T0);
  for (const d of knee.days) for (const ex of d.exercises) assert.ok(!EXERCISES.find((x) => x.id === ex.exerciseId).tags.includes('knee'), ex.name);
  const thrust = generatePlan(profile({ include: ['hip_thrust'] }), eq, {}, T0);
  assert.ok(thrust.days.flatMap((d) => d.exercises.map((x) => x.exerciseId)).includes('hip_thrust'));
});

test('planner: short budget trims, known weights are filled in, assumptions are listed', () => {
  const short = generatePlan(profile({ minutes: 25 }), emptyEquipment(), {}, T0);
  for (const d of short.days) assert.ok(d.exercises.length >= 3 && d.exercises.every((x) => x.sets >= 2));
  const w = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  assert.deepEqual(w.days[0].exercises[0].load, { value: 20, step: 2 });
  const a = buildAssumptions(profile(), emptyEquipment());
  assert.ok(a.find((x) => x.label === 'Goal').value.startsWith('Strength'));
  assert.deepEqual(missingFields(emptyProfile()), ['goal', 'experience', 'days', 'minutes']);
});

function runTo(plan) {
  let s = S.startSession(plan, 'd1', T0);
  return s;
}

test('session: ready -> set -> log -> rest -> next, with starting weight and restore', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  let s = runTo(plan);
  assert.equal(s.phase, 'ready');
  assert.ok(S.needsWeight(s), 'first exercise has no history');
  assert.throws(() => S.beginSet(s, T0));
  s = S.setStartingWeight(s, 20, 2, T0);
  assert.ok(!S.needsWeight(s));
  s = S.beginSet(s, T0 + 1000);
  assert.equal(s.phase, 'active');
  s = S.finishSet(s, T0 + 41000);
  assert.equal(s.phase, 'log');
  const planned = S.current(s).set.target.reps;
  assert.equal(s.draft.reps, planned, 'result starts from the planned value');
  s = S.editDraft(s, { reps: s.draft.reps - 1, rir: 0 });
  s = S.saveSet(s, T0 + 45000);
  assert.equal(s.phase, 'rest');
  assert.equal(s.exercises[0].sets[0].actual.reps, planned - 1);
  assert.equal(s.exercises[0].sets[0].actual.seconds, 40);
  assert.deepEqual(s.cursor, { ex: 0, set: 1 });
  // Reload: the remaining rest comes from the stored end time.
  const restored = JSON.parse(JSON.stringify(s));
  const restSec = s.exercises[0].restSec;
  assert.equal(S.restLeftMs(restored, T0 + 45000 + 30000), (restSec - 30) * 1000);
  assert.equal(S.restLeftMs(restored, T0 + 45000 + 9999999), 0);
  s = S.addRest(s, 15, T0 + 46000);
  assert.equal(S.restLeftMs(s, T0 + 46000), (restSec + 15 - 1) * 1000);
  s = S.skipRest(s, T0 + 47000);
  assert.equal(s.phase, 'ready');
});

test('session: last set of an exercise moves to the next one; finishing gives a summary', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  let s = runTo(plan);
  let t = T0;
  let guard = 0;
  while (s.status === 'active' && guard++ < 200) {
    if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t);
    const before = { ...s.cursor };
    s = S.beginSet(s, t += 1000);
    s = S.finishSet(s, t += 30000);
    s = S.saveSet(s, t += 2000);
    if (s.status === 'active' && s.cursor.ex !== before.ex) assert.ok(s.rest.betweenExercises);
  }
  assert.equal(s.status, 'done'); assert.equal(s.phase, 'summary');
  const sum = S.summarize(s);
  assert.equal(sum.done, sum.total); assert.equal(sum.skipped, 0); assert.ok(sum.minutes >= 1);
  assert.ok(sum.lines[0].notes.includes('Starting weight chosen'));
});

test('session: skip, substitute, edit and end early are recorded', () => {
  const eq = emptyEquipment(); eq.items.leg_press = true;
  const plan = generatePlan(profile(), eq, { db_bench_press: { value: 20, step: 2 } }, T0);
  let s = S.startSession(plan, 'd1', T0);
  s = S.beginSet(s, T0); s = S.finishSet(s, T0 + 30000); s = S.saveSet(s, T0 + 31000);
  s = S.skipSet(s, T0 + 32000);
  assert.equal(s.exercises[0].sets[1].status, 'skipped');
  s = S.editSet(s, 0, 0, { reps: 5, load: 18, rir: 2 }, T0 + 33000);
  assert.equal(s.exercises[0].sets[0].actual.reps, 5); assert.ok(s.exercises[0].sets[0].actual.edited);
  assert.equal(s.exercises[0].sets[0].planned.load, 20, 'the plan copy is untouched');
  s = S.skipExercise(s, T0 + 34000);
  assert.equal(s.cursor.ex, 1);
  const cur = S.current(s).ex;
  const subs = substitutesFor(eq, cur.exerciseId, { exclude: s.exercises.map((x) => x.exerciseId) });
  assert.ok(subs.length > 0, `no substitute for ${cur.name}`);
  s = S.substitute(s, { exerciseId: subs[0].id, name: subs[0].name, pattern: subs[0].pattern, equipment: 'x', zone: 'y', loadType: subs[0].load, step: 2, load: null }, T0 + 35000);
  assert.equal(S.current(s).ex.swappedFrom.name, cur.name);
  s = S.endSession(s, T0 + 600000);
  const sum = S.summarize(s);
  assert.equal(sum.minutes, 10); assert.ok(sum.skipped > 0); assert.equal(sum.done, 1);
  assert.ok(sum.highlights.length > 0);
});

test('history: a later plan change does not alter a stored session', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  let s = S.startSession(plan, 'd1', T0);
  s = S.beginSet(s, T0); s = S.finishSet(s, T0 + 1); s = S.saveSet(s, T0 + 2);
  const frozen = JSON.stringify(s);
  const { plan: p2 } = applyPlanChange(plan, { exerciseId: 'db_bench_press', field: 'load', value: 22 }, emptyEquipment(), {});
  assert.equal(p2.version, plan.version + 1);
  assert.equal(p2.days[0].exercises[0].load.value, 22);
  assert.equal(JSON.stringify(s), frozen);
  assert.equal(s.exercises[0].sets[0].planned.load, 20);
});

test('progression: in-session hints follow the rules and only target sets not done', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  let s = S.startSession(plan, 'd1', T0);
  const target = S.current(s).set.target.reps;
  s = S.beginSet(s, T0); s = S.finishSet(s, T0 + 1); s = S.editDraft(s, { reps: target - 1 }); s = S.saveSet(s, T0 + 2);
  let h = inSessionHint(s, 0, 0);
  assert.ok(h, 'one rep short gives a hint');
  assert.equal(h.changes[0].field, 'load'); assert.equal(h.changes[0].value, 18);
  assert.match(h.changes[0].reason, /if that set was close to failure/);
  assert.ok(S.hintApplies(s, h));
  const applied = S.applyHint(s, h, T0 + 3);
  assert.equal(applied.exercises[0].sets[1].target.load, 18);
  assert.equal(applied.exercises[0].sets[0].actual.load, 20, 'done sets are not touched');
  // Hint that arrives late: all its sets are done by then.
  let late = s;
  while (late.cursor.ex === 0 && late.status === 'active') { late = S.beginSet(late, T0 + 10); late = S.finishSet(late, T0 + 11); late = S.saveSet(late, T0 + 12); }
  assert.ok(!S.hintApplies(late, h), 'a late hint for finished sets is not shown');
  // On target with lots in reserve -> go up. On target with 2 in reserve -> nothing.
  let s2 = S.startSession(plan, 'd1', T0);
  s2 = S.beginSet(s2, T0); s2 = S.finishSet(s2, T0 + 1); s2 = S.editDraft(s2, { rir: 4 }); s2 = S.saveSet(s2, T0 + 2);
  assert.equal(inSessionHint(s2, 0, 0).changes[0].value, 22);
  let s3 = S.startSession(plan, 'd1', T0);
  s3 = S.beginSet(s3, T0); s3 = S.finishSet(s3, T0 + 1); s3 = S.editDraft(s3, { rir: 2 }); s3 = S.saveSet(s3, T0 + 2);
  assert.equal(inSessionHint(s3, 0, 0), null);
  assert.equal(lowerLoad(40, 5, 5), 35); assert.equal(lowerLoad(100, 10, 2.5), 90);
});

function doSession(plan, dayId, start, repsFor) {
  let s = S.startSession(plan, dayId, start); let t = start;
  while (s.status === 'active') {
    if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t);
    const { ex, set, setIdx } = S.current(s);
    s = S.beginSet(s, t += 1000); s = S.finishSet(s, t += 1000);
    const r = repsFor(ex, set, setIdx); if (r != null) s = S.editDraft(s, { reps: r });
    s = S.saveSet(s, t += 1000);
  }
  return s;
}

test('progression: after a session - reps up, load up at top of range, deload only after two short sessions, nothing otherwise', () => {
  const w = { db_bench_press: { value: 20, step: 2 } };
  const plan = generatePlan(profile(), emptyEquipment(), w, T0);
  const first = plan.days[0].exercises[0];
  // Exactly on target: +1 rep.
  const onTarget = doSession(plan, 'd1', T0, () => null);
  let ch = postSessionChanges(onTarget, plan, []).filter((c) => c.exerciseId === 'db_bench_press');
  assert.equal(ch.length, 1); assert.equal(ch[0].field, 'reps'); assert.equal(ch[0].value, first.reps + 1);
  assert.ok(ch[0].from && ch[0].to && ch[0].reason);
  // Top of range on every set: load up, reps back to the bottom.
  const top = doSession(plan, 'd1', T0, (ex) => (ex.exerciseId === 'db_bench_press' ? ex.repHi : null));
  ch = postSessionChanges(top, plan, []).filter((c) => c.exerciseId === 'db_bench_press');
  assert.equal(ch[0].field, 'load'); assert.equal(ch[0].value, 22); assert.equal(ch[0].reps, first.repLo);
  // One short session: no change. Two in a row: back off 10%.
  const shortA = doSession(plan, 'd1', T0, (ex, set) => (ex.exerciseId === 'db_bench_press' ? set.target.reps - 2 : null));
  assert.equal(postSessionChanges(shortA, plan, []).filter((c) => c.exerciseId === 'db_bench_press').length, 0);
  const shortB = doSession(plan, 'd1', T0 + 7 * 864e5, (ex, set) => (ex.exerciseId === 'db_bench_press' ? set.target.reps - 2 : null));
  ch = postSessionChanges(shortB, plan, [shortA]).filter((c) => c.exerciseId === 'db_bench_press');
  assert.equal(ch.length, 1); assert.equal(ch[0].field, 'load'); assert.equal(ch[0].value, 18);
  assert.match(ch[0].reason, /Second session in a row/);
});

test('equipment change: broken exercises get a same-movement swap', () => {
  const eq = emptyEquipment(); eq.items.leg_press = true; eq.items.rack = true;
  const plan = generatePlan(profile(), eq, {}, T0);
  assert.equal(brokenExercises(plan, eq).length, 0);
  const eq2 = JSON.parse(JSON.stringify(eq)); eq2.items.rack = false;
  const broken = brokenExercises(plan, eq2);
  assert.ok(broken.length > 0);
  const changes = equipmentChanges(plan, eq2, profile());
  assert.equal(changes.length, broken.length);
  let p = plan; for (const c of changes) p = applyPlanChange(p, c, eq2, {}).plan;
  assert.equal(brokenExercises(p, eq2).length, 0);
});

test('plan changes: removing exercises drops empty days but never the whole plan', () => {
  let plan = generatePlan(profile({ daysPerWeek: 1, days: ['mon'] }), emptyEquipment(), {}, T0);
  const keys = plan.days[0].exercises.map((x) => x.key);
  for (const key of keys.slice(0, -1)) plan = applyPlanChange(plan, { exerciseKey: key, field: 'remove' }, emptyEquipment(), {}).plan;
  assert.equal(plan.days[0].exercises.length, 1);
  const last = applyPlanChange(plan, { exerciseKey: keys[keys.length - 1], field: 'remove' }, emptyEquipment(), {});
  assert.equal(last.touched, 0); assert.equal(last.plan.days.length, 1, 'the last exercise stays');
});

test('claude output: plans and changes are checked against the catalog and records', () => {
  const eq = emptyEquipment();
  const raw = { days: [
    { weekday: 'Monday', title: 'Push day', exercises: [
      { exercise_id: 'db_bench_press', role: 'main', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 120 },
      { exercise_id: 'leg_press', role: 'main', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 120 },
      { exercise_id: 'made_up_lift', role: 'accessory', sets: 99, rep_low: 8, rep_high: 10, rest_seconds: 5 },
      { exercise_id: 'db_curl', role: 'accessory', sets: 99, rep_low: 12, rep_high: 10, rest_seconds: 5 },
    ] },
    { weekday: 'someday', title: 'x', exercises: [] },
  ], notes: ['hello'] };
  const { plan, dropped } = normalizePlan(raw, profile(), eq, {}, T0);
  assert.equal(plan.days.length, 1); assert.equal(plan.source, 'claude');
  assert.deepEqual(plan.days[0].exercises.map((x) => x.exerciseId), ['db_bench_press', 'db_curl']);
  assert.deepEqual(dropped, ['leg_press', 'made_up_lift']);
  const curl = plan.days[0].exercises[1];
  assert.equal(curl.sets, 6); assert.equal(curl.restSec, 20); assert.ok(curl.repHi >= curl.repLo);
  assert.throws(() => normalizePlan({ days: [] }, profile(), eq));
  const base = generatePlan(profile(), eq, { db_bench_press: { value: 20, step: 2 } }, T0);
  const key = base.days[0].exercises[0].key;
  const ch = fromAiChanges([
    { exercise_key: key, field: 'load', new_value: 22, reason: 'All sets at the top.' },
    { exercise_key: 'nope', field: 'load', new_value: 22, reason: 'x' },
    { exercise_key: key, field: 'exercise', new_exercise_id: 'leg_press', reason: 'not available' },
    { exercise_key: key, field: 'load', new_value: 20, reason: 'no real change' },
  ], { plan: base, equipment: eq, mode: 'post_session' });
  assert.equal(ch.length, 1); assert.equal(ch[0].from, '20 kg'); assert.equal(ch[0].to, '22 kg');
});

test('weekly volume: sets are counted per muscle group against the level target', () => {
  const eq = emptyEquipment(); Object.assign(eq.items, { rack: true, cable: true, lat_pulldown: true, leg_press: true, leg_curl: true });
  const big = weeklySets(generatePlan(profile({ goal: 'muscle', months: 30, daysPerWeek: 4, days: [], minutes: 75 }), eq, {}, T0));
  assert.deepEqual(big.target, [12, 20]);
  assert.ok(big.rows.find((r) => r.group === 'Back').sets >= 10);
  const small = weeklySets(generatePlan(profile({ daysPerWeek: 1, days: ['mon'], minutes: 30 }), emptyEquipment(), {}, T0));
  assert.ok(small.rows.some((r) => r.low), 'a single short day is flagged as below target');
  assert.equal(small.rows.filter((r) => r.judged).length, 5, 'all five big groups are listed, even at zero');
});

test('next day: picks today when it is a training day, the next one otherwise', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  const mon = new Date(2026, 10, 9, 10).getTime();
  assert.equal(nextDay(plan, mon).weekday, 'mon');
  assert.equal(nextDay(plan, mon + 864e5).weekday, 'wed');
  assert.equal(nextDay(plan, mon, [{ status: 'done', startedAt: mon, dayId: 'd1' }]).weekday, 'wed');
});
