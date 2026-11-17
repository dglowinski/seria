import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, SOURCES, PRESCRIPTION, prescribe, levelFor, rulesAsText, RULES_VERSION, activityGroups } from '../js/domain/rules.js';
import { emptyEquipment, isAvailable, substitutesFor, allExercises, EXERCISES, EQUIPMENT, canDo } from '../js/domain/catalog.js';
import { generatePlan, emptyProfile, missingFields, dayMinutes, buildAssumptions, normalizePlan, brokenExercises, weeklySets, upgradePlan, buildOutlook, fillOptional, dayOptional, allEntries, optionalMinutes } from '../js/domain/planner.js';
import { GROUP_OF } from '../js/domain/catalog.js';
import { OPTIONAL, TEMPLATES } from '../js/domain/rules.js';
import * as K from '../js/domain/schedule.js';
import * as S from '../js/domain/session.js';
import { inSessionHint, postSessionChanges, applyPlanChange, undoPlanChange, canUndo, withValue, ruleSummary, lowerLoad, equipmentChanges, fromAiChanges } from '../js/domain/progression.js';

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

test('planner: 3 a week gives a list of upper / lower / full with rest days, laid out two weeks ahead', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  assert.deepEqual(plan.days.map((d) => d.title), ['Upper body A', 'Lower body A', 'Full body A', 'Upper body B', 'Lower body B', 'Full body B']);
  assert.deepEqual(plan.days.map((d) => d.restAfter), [1, 1, 2, 1, 1, 2], 'train, a day off, train, a day off, train, two days off');
  assert.ok(plan.days.every((d) => !('weekday' in d)), 'no fixed weekdays');
  assert.equal(plan.perWeek, 3); assert.deepEqual(plan.queue, { run: 1, order: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], done: [], skipped: [] });
  // Main lifts come back every week; the other exercises take turns, so more of them fit in.
  const mains = (d) => d.exercises.filter((x) => x.tier === 'main').map((x) => x.exerciseId).join();
  assert.equal(mains(plan.days[0]), mains(plan.days[3])); assert.equal(mains(plan.days[1]), mains(plan.days[4]));
  const others = (d) => d.exercises.filter((x) => x.tier !== 'main').map((x) => x.exerciseId).sort().join();
  assert.notEqual(others(plan.days[0]), others(plan.days[3]), 'week two brings in what did not fit in week one');
  const oneWeek = generatePlan(profile({ cycleWeeks: 1 }), emptyEquipment(), {}, T0);
  const count = (p) => new Set(p.days.flatMap((d) => d.exercises.map((x) => x.exerciseId))).size;
  assert.ok(count(plan) >= count(oneWeek) + 3, `${count(plan)} exercises against ${count(oneWeek)}`);
  for (const d of plan.days) for (const [i, ex] of d.exercises.entries()) assert.equal(ex.key, `${d.id}e${i + 1}`);
  for (const d of plan.days) assert.deepEqual(d.exercises.map((x) => x.tier), [...d.exercises.map((x) => x.tier)].sort((a, b) => ({ main: 0, secondary: 1, accessory: 2 })[a] - ({ main: 0, secondary: 1, accessory: 2 })[b]), 'compound lifts before single-joint work');
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

test('planner: every count from 1 to 6 sessions a week produces a full list whose rests fill the week', () => {
  for (let n = 1; n <= 6; n++) {
    const plan = generatePlan(profile({ daysPerWeek: n, days: [] }), emptyEquipment(), {}, T0);
    assert.equal(plan.days.length, n * (n >= 5 ? 1 : 2)); assert.equal(plan.perWeek, n);
    for (const d of plan.days) assert.ok(d.exercises.length >= 3, `${n} a week: ${d.title} has ${d.exercises.length}`);
    assert.equal(K.restPattern(n).reduce((a, b) => a + b, 0) + n, 7, `${n} a week`);
    assert.equal(new Set(plan.days.map((d) => d.title)).size, plan.days.length, 'every session has its own name');
  }
  assert.equal(generatePlan(profile({ daysPerWeek: 7, days: [] }), emptyEquipment(), {}, T0).perWeek, 6);
  assert.deepEqual(K.restPattern(3), [1, 1, 2]); assert.deepEqual(K.restPattern(2), [2, 3]); assert.deepEqual(K.restPattern(6), [0, 0, 0, 0, 0, 1]);
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

test('session: ready -> set -> one tap to finish -> rest -> next, with starting weight and restore', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  let s = runTo(plan);
  assert.equal(s.phase, 'ready');
  assert.ok(S.needsWeight(s), 'first exercise has no history');
  assert.throws(() => S.beginSet(s, T0));
  s = S.setStartingWeight(s, 20, 2, T0);
  assert.ok(!S.needsWeight(s));
  s = S.beginSet(s, T0 + 1000);
  assert.equal(s.phase, 'active');
  const planned = S.current(s).set.target.reps;
  assert.equal(s.draft.reps, planned, 'the set will be saved as planned unless changed');
  s = S.finishSet(s, T0 + 41000);
  assert.equal(s.phase, 'rest', 'one tap: saved and resting');
  assert.deepEqual([s.exercises[0].sets[0].actual.reps, s.exercises[0].sets[0].actual.load, s.exercises[0].sets[0].actual.seconds], [planned, 20, 40]);
  assert.deepEqual(s.cursor, { ex: 0, set: 1 });
  // During the rest the set just done can be corrected: one rep fewer, nothing left in the tank.
  s = S.adjustLast(s, { reps: planned - 1, rir: 0 }, T0 + 45000);
  assert.equal(s.exercises[0].sets[0].actual.reps, planned - 1); assert.equal(s.exercises[0].sets[0].actual.rir, 0);
  assert.ok(!s.exercises[0].sets[0].actual.edited, 'adjusting right away is not a later correction');
  // Reload: the remaining rest comes from the stored end time.
  const restored = JSON.parse(JSON.stringify(s));
  const restSec = s.exercises[0].restSec;
  assert.equal(S.restLeftMs(restored, T0 + 41000 + 30000), (restSec - 30) * 1000);
  assert.equal(S.restLeftMs(restored, T0 + 41000 + 9999999), 0);
  s = S.addRest(s, 15, T0 + 46000);
  assert.equal(S.restLeftMs(s, T0 + 46000), (restSec + 15 - 5) * 1000);
  s = S.skipRest(s, T0 + 47000);
  assert.equal(s.phase, 'ready');
});

test('session: adjust before finishing, undo, auto-start and "start now"', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  let s = S.startSession(plan, 'd1', T0);
  const target = S.current(s).set.target.reps;
  s = S.beginSet(s, T0 + 1000);
  s = S.editDraft(s, { reps: target + 1 }, T0 + 20000); // +1 while the set is still running
  s = S.finishSet(s, T0 + 31000);
  assert.equal(s.exercises[0].sets[0].actual.reps, target + 1);
  // Finished by mistake: undo opens the set again, clock still running from its start.
  const undone = S.undoFinish(s, T0 + 33000);
  assert.equal(undone.phase, 'active'); assert.deepEqual(undone.cursor, { ex: 0, set: 0 });
  assert.equal(undone.exercises[0].sets[0].status, 'pending'); assert.equal(undone.exercises[0].sets[0].actual, null);
  assert.equal(undone.setStartedAt, T0 + 1000); assert.equal(undone.draft.reps, target + 1, 'what was entered is kept');
  assert.equal(S.undoFinish(undone, T0 + 34000), undone, 'nothing to undo while a set is running');
  s = S.finishSet(undone, T0 + 40000);
  // The rest runs out and the next set starts by itself at that moment.
  const restEnds = s.rest.endsAt;
  s = S.beginSet(s, restEnds, { auto: true });
  assert.ok(s.exercises[0].sets[1].auto); assert.equal(s.exercises[0].sets[1].restBeforeSec, s.exercises[0].restSec, 'the rest really taken is recorded');
  // The user only starts 20 s later: "Start now" resets the clock and the rest taken.
  s = S.restartSet(s, restEnds + 20000);
  assert.equal(s.setStartedAt, restEnds + 20000); assert.ok(!s.exercises[0].sets[1].auto);
  assert.equal(s.exercises[0].sets[1].restBeforeSec, s.exercises[0].restSec + 20);
  s = S.finishSet(s, restEnds + 50000);
  assert.equal(s.exercises[0].sets[1].actual.seconds, 30);
  // A new weight entered after the set carries to the sets still to come.
  s = S.adjustLast(s, { load: 18 }, restEnds + 52000);
  assert.equal(s.exercises[0].sets[1].actual.load, 18); assert.equal(s.exercises[0].sets[2].target.load, 18);
  assert.deepEqual(S.restStats(s), { count: 1, planned: s.exercises[0].restSec, actual: s.exercises[0].restSec + 20 });
  // Everything is in the log, with its time in seconds from the start.
  const types = s.log.map((e) => e[1]);
  for (const t of ['start', 'set_start', 'adjust', 'set_finish', 'rest_start', 'undo', 'set_restart']) assert.ok(types.includes(t), `log has ${t}`);
  assert.deepEqual(s.log.find((e) => e[1] === 'adjust'), [20, 'adjust', 0, 0, 'reps', target, target + 1, 'before_finish']);
  assert.deepEqual(s.log.filter((e) => e[1] === 'set_start').map((e) => e[4]), ['tap', 'auto']);
  assert.ok(s.log.every((e, i) => i === 0 || e[0] >= s.log[i - 1][0]), 'in order of time');
  assert.ok(s.log.some((e) => e[1] === 'adjust' && e[7] === 'after_finish'));
});

test('session: machine busy - come back later, drop for today, jump between exercises', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  let s = S.startSession(plan, 'd1', T0);
  const order = () => s.exercises.map((x) => x.exerciseId);
  const first = order()[0]; const second = order()[1];
  s = S.postponeExercise(s, T0 + 1000);
  assert.equal(order()[0], second, 'the next exercise comes up'); assert.equal(order()[order().length - 1], first, 'the busy one waits at the end');
  assert.equal(s.exercises[s.exercises.length - 1].postponed, 1); assert.equal(s.phase, 'ready'); assert.deepEqual(s.cursor, { ex: 0, set: 0 });
  assert.ok(s.exercises[s.exercises.length - 1].sets.every((x) => x.status === 'pending'), 'nothing is lost');
  // Jump straight to the last exercise and back.
  s = S.goToExercise(s, s.exercises.length - 1, T0 + 2000);
  assert.equal(S.current(s).ex.exerciseId, first);
  s = S.goToExercise(s, 0, T0 + 3000);
  assert.equal(S.current(s).ex.exerciseId, second);
  // Drop it for today: its sets are saved as skipped and it does not come back.
  s = S.dropExercise(s, T0 + 4000);
  const dropped = s.exercises.find((x) => x.exerciseId === second);
  assert.ok(dropped.dropped && dropped.sets.every((x) => x.status === 'skipped'));
  assert.notEqual(S.current(s).ex.exerciseId, second);
  // When only one exercise is left, there is nothing to put it behind.
  let one = s;
  while (S.hasOthers(one)) one = S.dropExercise(one, T0 + 5000);
  assert.equal(S.postponeExercise(one, T0 + 6000), one);
  assert.equal(S.goToExercise(one, 99, T0), one);
  for (const t of ['later', 'jump', 'drop']) assert.ok(s.log.some((e) => e[1] === t), `log has ${t}`);
});

test('effort: sets before the last stop at the target; the last one may go on', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  const s = S.startSession(plan, 'd1', T0);
  const ex = s.exercises[0];
  const firstCue = S.effortCue(ex, 0, 'intermediate');
  assert.ok(!firstCue.push); assert.match(firstCue.title, /^Stop at \d+$/); assert.match(firstCue.text, /Leave 1-3 in the tank/);
  const lastCue = S.effortCue(ex, ex.sets.length - 1, 'intermediate');
  assert.ok(lastCue.push); assert.match(lastCue.title, /^Last set: \d+ or more$/); assert.match(lastCue.text, /stop 1 short of failure/);
  assert.match(S.effortCue(ex, ex.sets.length - 1, 'novice').text, /stop 2 short of failure/, 'novices keep more in hand on the main lifts');
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
    s = S.finishSet(s, t += 2000);
    if (s.phase === 'optional') { s = S.endSession(s, t); break; } // the planned sets are through; no extras today
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
  s = S.beginSet(s, T0); s = S.finishSet(s, T0 + 31000);
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
  s = S.beginSet(s, T0); s = S.finishSet(s, T0 + 2);
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
  s = S.beginSet(s, T0); s = S.editDraft(s, { reps: target - 1 }); s = S.finishSet(s, T0 + 2);
  let h = inSessionHint(s, 0, 0);
  assert.ok(h, 'one rep short gives a hint');
  assert.equal(h.changes[0].field, 'load'); assert.equal(h.changes[0].value, 18);
  assert.match(h.changes[0].reason, /if that set was close to failure/);
  assert.ok(S.hintApplies(s, h));
  // The change is made at once, stays on screen, and one tap takes it back.
  const applied = S.applyHint(s, h, T0 + 3);
  assert.equal(applied.exercises[0].sets[1].target.load, 18);
  assert.equal(applied.exercises[0].sets[0].actual.load, 20, 'done sets are not touched');
  assert.ok(applied.hint.applied && S.hintApplies(applied, applied.hint));
  const undone = S.undoHint(applied, T0 + 4);
  assert.equal(undone.exercises[0].sets[1].target.load, 20); assert.equal(undone.hint, null); assert.ok(undone.hintUndone, 'not made again for this set');
  assert.equal(S.withoutHint(applied).exercises[0].sets[1].target.load, 20);
  // Correcting the set during the rest takes the change back first: it was built on the old numbers.
  const fixed = S.adjustLast(applied, { reps: target }, T0 + 5);
  assert.equal(fixed.exercises[0].sets[1].target.load, 20); assert.equal(fixed.hint, null);
  assert.equal(inSessionHint(fixed, 0, 0), null, 'on target after the correction: nothing to change');
  // A newer change replaces the one before instead of stacking on it.
  const again = S.applyHint(applied, { ...h, changes: [{ ...h.changes[0], value: 16 }] }, T0 + 6);
  assert.equal(again.exercises[0].sets[1].target.load, 16);
  assert.equal(S.undoHint(again).exercises[0].sets[1].target.load, 20, 'undo goes back to the plan, not to the change before');
  // Finishing the next set keeps the changed targets and clears the card.
  const next = S.finishSet(S.beginSet(applied, T0 + 10), T0 + 12);
  assert.equal(next.hint, null); assert.equal(next.exercises[0].sets[1].actual.load, 18);
  assert.ok(next.log.some((e) => e[1] === 'hint_apply'));
  // Hint that arrives late: all its sets are done by then.
  let late = s;
  while (late.cursor.ex === 0 && late.status === 'active') { late = S.beginSet(late, T0 + 10); late = S.finishSet(late, T0 + 12); }
  assert.ok(!S.hintApplies(late, h), 'a late hint for finished sets is not shown');
  // On target with lots in reserve -> go up. On target with 2 in reserve -> nothing.
  let s2 = S.startSession(plan, 'd1', T0);
  s2 = S.beginSet(s2, T0); s2 = S.editDraft(s2, { rir: 4 }); s2 = S.finishSet(s2, T0 + 2);
  assert.equal(inSessionHint(s2, 0, 0).changes[0].value, 22);
  let s3 = S.startSession(plan, 'd1', T0);
  s3 = S.beginSet(s3, T0); s3 = S.editDraft(s3, { rir: 2 }); s3 = S.finishSet(s3, T0 + 2);
  assert.equal(inSessionHint(s3, 0, 0), null);
  assert.equal(lowerLoad(40, 5, 5), 35); assert.equal(lowerLoad(100, 10, 2.5), 90);
});

function doSession(plan, dayId, start, repsFor) {
  let s = S.startSession(plan, dayId, start); let t = start;
  while (s.status === 'active') {
    if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t);
    const { ex, set, setIdx } = S.current(s);
    s = S.beginSet(s, t += 1000); const r = repsFor(ex, set, setIdx); if (r != null) s = S.editDraft(s, { reps: r });
    s = S.finishSet(s, t += 1000);
    if (s.phase === 'optional') s = S.endSession(s, t); // no optional extras today
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
  // A weight chosen in the session and then lowered part-way is not a reason to add a rep at the heavier one.
  const blank = generatePlan(profile(), emptyEquipment(), {}, T0);
  let s = S.startSession(blank, 'd1', T0);
  s = S.setStartingWeight(s, 20, 2, T0);
  s = S.finishSet(S.beginSet(s, T0 + 1000), T0 + 2000);
  while (s.cursor.ex === 0 && s.status === 'active') { s = S.beginSet(s, T0 + 3000); s = S.editDraft(s, { load: 18 }); s = S.finishSet(s, T0 + 4000); }
  const set = { ...blank, days: blank.days.map((d) => ({ ...d, exercises: d.exercises.map((x) => (x.exerciseId === 'db_bench_press' ? { ...x, load: { value: 20, step: 2 } } : x)) })) };
  assert.equal(postSessionChanges(S.endSession(s, T0 + 5000), set, []).filter((c) => c.exerciseId === 'db_bench_press').length, 0);
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
  let plan = generatePlan(profile({ daysPerWeek: 1, days: [], cycleWeeks: 1 }), emptyEquipment(), {}, T0);
  const keys = plan.days[0].exercises.map((x) => x.key);
  for (const key of keys.slice(0, -1)) plan = applyPlanChange(plan, { exerciseKey: key, field: 'remove' }, emptyEquipment(), {}).plan;
  assert.equal(plan.days[0].exercises.length, 1);
  const last = applyPlanChange(plan, { exerciseKey: keys[keys.length - 1], field: 'remove' }, emptyEquipment(), {});
  assert.equal(last.touched, 0); assert.equal(last.plan.days.length, 1, 'the last exercise stays');
});

test('plan changes: each one can be undone, but only where its value still stands', () => {
  const eq = emptyEquipment();
  const w0 = { db_bench_press: { value: 20, step: 2 } };
  const plan = generatePlan(profile(), eq, w0, T0);
  const bench = plan.days.flatMap((d) => d.exercises).filter((x) => x.exerciseId === 'db_bench_press');
  assert.ok(bench.length >= 2, 'the main lift comes back every week');
  // Load: goes everywhere the exercise is, and comes back everywhere.
  const c1 = { id: 'c1', exerciseId: 'db_bench_press', field: 'load', value: 22, reps: bench[0].repLo, status: 'applied' };
  const r1 = applyPlanChange(plan, c1, eq, w0);
  assert.equal(r1.touched, bench.length); assert.equal(r1.weights.db_bench_press.value, 22);
  c1.undo = r1.undo;
  assert.ok(canUndo(r1.plan, c1)); assert.ok(!canUndo({ ...r1.plan, id: 'another' }, c1), 'not on a rebuilt plan');
  const u1 = undoPlanChange(r1.plan, c1, r1.weights);
  assert.equal(u1.touched, bench.length);
  for (const d of u1.plan.days) for (const ex of d.exercises) if (ex.exerciseId === 'db_bench_press') { assert.equal(ex.load.value, 20); assert.equal(ex.reps, bench[0].reps); }
  assert.equal(u1.weights.db_bench_press.value, 20);
  // Changed again by hand since: the newer value is left alone.
  const moved = JSON.parse(JSON.stringify(r1.plan));
  for (const d of moved.days) for (const ex of d.exercises) if (ex.exerciseId === 'db_bench_press') ex.load.value = 24;
  assert.equal(undoPlanChange(moved, c1, { db_bench_press: { value: 24, step: 2 } }).touched, 0);
  // Reps, sets and rest.
  const key = bench[0].key;
  for (const [field, value, read] of [['reps', bench[0].reps + 1, (x) => x.reps], ['sets', 2, (x) => x.sets], ['rest', 95, (x) => x.restSec]]) {
    const c = { exerciseKey: key, field, value, status: 'applied' };
    const r = applyPlanChange(plan, c, eq, w0); c.undo = r.undo;
    assert.equal(read(r.plan.days[0].exercises[0]), value);
    assert.equal(read(undoPlanChange(r.plan, c, r.weights).plan.days[0].exercises[0]), read(bench[0]), field);
  }
  // A swap and a removal come back whole, in the same place.
  const sub = substitutesFor(eq, 'db_bench_press', {})[0];
  const c2 = { exerciseKey: key, field: 'exercise', value: sub.id, status: 'applied' };
  const r2 = applyPlanChange(plan, c2, eq, w0); c2.undo = r2.undo;
  assert.equal(r2.plan.days[0].exercises[0].exerciseId, sub.id);
  assert.deepEqual(undoPlanChange(r2.plan, c2, r2.weights).plan.days[0].exercises[0], plan.days[0].exercises[0]);
  const c3 = { exerciseKey: plan.days[0].exercises[1].key, field: 'remove', status: 'applied' };
  const r3 = applyPlanChange(plan, c3, eq, w0); c3.undo = r3.undo;
  assert.equal(r3.plan.days[0].exercises.length, plan.days[0].exercises.length - 1);
  assert.deepEqual(undoPlanChange(r3.plan, c3, r3.weights).plan.days[0].exercises.map((x) => x.key), plan.days[0].exercises.map((x) => x.key));
  // A session emptied by a removal comes back with its exercise.
  let one = generatePlan(profile({ daysPerWeek: 2, days: [], cycleWeeks: 1 }), eq, {}, T0);
  for (const k of one.days[1].exercises.map((x) => x.key).slice(1)) one = applyPlanChange(one, { exerciseKey: k, field: 'remove' }, eq, {}).plan;
  const c4 = { exerciseKey: one.days[1].exercises[0].key, field: 'remove', status: 'applied' };
  const r4 = applyPlanChange(one, c4, eq, {}); c4.undo = r4.undo;
  assert.equal(r4.plan.days.length, 1);
  assert.deepEqual(undoPlanChange(r4.plan, c4, {}).plan.days.map((d) => d.id), one.days.map((d) => d.id));
  // Correcting by hand: the same change with the user's number.
  const e = withValue(plan, { ...c1, to: '22 kg' }, 21);
  assert.equal(e.value, 21); assert.match(e.to, /21/);
  assert.equal(withValue(plan, c2, 3), null, 'a swap has no number to correct');
  assert.equal(withValue(plan, { exerciseKey: key, field: 'sets', value: 3 }, 40).value, 6, 'kept within sane limits');
});

test('summary in words: what was done, what stood out, what changes', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  const ok = doSession(plan, 'd1', T0, () => null);
  const changes = postSessionChanges(ok, plan, []);
  const text = ruleSummary(ok, changes);
  assert.match(text, /^All \d+ sets done in \d+ min\. Everything went to plan\./);
  assert.match(text, /Changed for next time: /);
  const short = doSession(plan, 'd1', T0, (ex, set) => (ex.exerciseId === 'db_bench_press' ? set.target.reps - 2 : null));
  assert.match(ruleSummary(short, []), /under plan.*Nothing in the plan needs to change yet\./);
  const eased = S.startSession(plan, 'd1', T0, { easePct: 10 });
  assert.match(ruleSummary(S.endSession(S.finishSet(S.beginSet(eased, T0), T0 + 5), T0 + 9), []), /lighter session to ease back in/);
  // The saved log reads back as plain lines.
  const lines = S.readLog(ok);
  assert.equal(lines[0].text, 'Workout started'); assert.equal(lines[lines.length - 1].text, 'Workout ended');
  assert.ok(lines.some((l) => /set 1 finished: \d+ reps/.test(l.text)) && lines.some((l) => /^Rest of /.test(l.text)));
});

test('claude output: plans and changes are checked against the catalog and records', () => {
  const eq = emptyEquipment();
  const raw = { days: [
    { week: 1, title: 'Push day', rest_days_after: 9, exercises: [
      { exercise_id: 'db_bench_press', role: 'main', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 120 },
      { exercise_id: 'leg_press', role: 'main', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 120 },
      { exercise_id: 'made_up_lift', role: 'accessory', sets: 99, rep_low: 8, rep_high: 10, rest_seconds: 5 },
      { exercise_id: 'db_curl', role: 'accessory', sets: 99, rep_low: 12, rep_high: 10, rest_seconds: 5 },
    ] },
    { week: 2, title: 'x', rest_days_after: 1, exercises: [] },
  ], notes: ['hello'] };
  const { plan, dropped } = normalizePlan(raw, profile(), eq, {}, T0);
  assert.equal(plan.days.length, 1); assert.equal(plan.source, 'claude');
  assert.equal(plan.days[0].restAfter, 6, 'rest days are kept within a week'); assert.deepEqual(plan.queue.order, ['d1']); assert.equal(plan.days[0].title, 'Push day');
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
  const small = weeklySets(generatePlan(profile({ daysPerWeek: 1, days: [], minutes: 30 }), emptyEquipment(), {}, T0));
  assert.ok(small.rows.some((r) => r.low), 'a single short day is flagged as below target');
  assert.equal(small.rows.filter((r) => r.judged).length, 5, 'all five big groups are listed, even at zero');
});

const DAYMS = 864e5;
const at = (dayOffset, hour = 18) => new Date(2026, 10, 9 + dayOffset, hour).getTime(); // 9 Nov 2026 is a Monday

/** A finished workout of a plan session, with every set done as planned. */
function did(plan, dayId, when) {
  let s = S.startSession(plan, dayId, when); let t = when;
  while (s.status === 'active') {
    if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t);
    s = S.beginSet(s, t += 1000); s = S.finishSet(s, t += 1000);
    if (s.phase === 'optional') s = S.endSession(s, t); // no optional extras today
  }
  return s;
}

test('timeline: the plan reads as train, rest, train, starting today', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  const line = K.timeline(plan, [], at(0));
  assert.deepEqual(line.map((x) => x.day.title), ['Upper body A', 'Lower body A', 'Full body A', 'Upper body B', 'Lower body B', 'Full body B']);
  assert.deepEqual(line.map((x) => x.inDays), [0, 2, 4, 7, 9, 11]);
  assert.deepEqual(line.map((x) => x.restBefore), [null, 1, 1, 2, 1, 1]);
  const first = K.recommend(plan, [], at(0));
  assert.ok(first.onSchedule && first.flags.first); assert.equal(first.dayId, 'd1'); assert.equal(first.easePct, 0);
});

test('timeline: a full cycle is always on show; what is done comes round again at the end', () => {
  let plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  const w1 = doSession(plan, 'd1', at(0), () => null);
  plan = K.completeDay(plan, 'd1');
  plan = K.skipDay(plan, 'd3');
  const line = K.timeline(plan, [w1], at(0, 20));
  assert.equal(line.length, plan.days.length, 'nothing drops off the list');
  assert.deepEqual(line.map((x) => x.day.id), ['d2', 'd4', 'd5', 'd6', 'd1', 'd3']);
  assert.deepEqual(line.map((x) => x.again), [false, false, false, false, true, true]);
  assert.ok(line[5].skipped && !line[4].skipped);
  for (let i = 1; i < line.length; i++) assert.ok(line[i].inDays > line[i - 1].inDays, 'dates keep running');
  // The session that comes round again shows what the plan now says for it.
  const up = applyPlanChange(plan, { exerciseId: 'db_bench_press', field: 'load', value: 22 }, emptyEquipment(), {}).plan;
  assert.equal(K.timeline(up, [w1], at(0, 20))[4].day.exercises.find((x) => x.exerciseId === 'db_bench_press').load.value, 22);
  // Everything done: the next round is the whole list, none marked.
  let all = plan; for (const d of plan.days) all = K.completeDay(all, d.id);
  assert.ok(K.timeline(all, [w1], at(1)).every((x) => !x.again)); assert.equal(K.timeline(all, [w1], at(1)).length, plan.days.length);
  // Deleting a workout puts its session back on the list.
  assert.deepEqual(K.queueState(K.uncompleteDay(plan, 'd1')).queue.map((d) => d.id), ['d1', 'd2', 'd4', 'd5', 'd6']);
});

test('other activity: a hard or long run counts as leg work; a short easy one changes nothing', () => {
  assert.deepEqual(activityGroups({ activity: 'run', minutes: 45, effort: 'hard' }), ['Quads', 'Hamstrings and glutes', 'Calves']);
  assert.deepEqual(activityGroups({ activity: 'run', minutes: 20, effort: 'hard' }), ['Quads', 'Hamstrings and glutes', 'Calves'], '20 hard minutes count');
  assert.deepEqual(activityGroups({ activity: 'bike', minutes: 25, effort: 'moderate' }), []);
  assert.deepEqual(activityGroups({ activity: 'hike', minutes: 50, effort: 'easy' }), []);
  assert.deepEqual(activityGroups({ activity: 'swim', minutes: 40, effort: 'moderate' }), ['Back', 'Shoulders']);
  assert.deepEqual(activityGroups({ activity: 'other', minutes: 120, effort: 'hard' }), []);
  let plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  const w1 = doSession(plan, 'd1', at(0), () => null); // upper body, Monday
  plan = K.completeDay(plan, 'd1');
  // Wednesday: lower body is due. A hard run on Tuesday evening moves it back.
  const base = K.recommend(plan, [w1], at(2));
  assert.equal(base.dayId, 'd2'); assert.ok(base.onSchedule);
  const run = S.newActivity({ type: 'run', minutes: 45, effort: 'hard' }, at(1, 19));
  assert.equal(run.kind, 'activity'); assert.equal(run.status, 'done'); assert.deepEqual(run.exercises, []); assert.equal(run.endedAt - run.startedAt, 45 * 60000);
  const after = K.recommend(plan, [w1, run], at(2));
  assert.notEqual(after.dayId, 'd2', 'legs get their rest');
  assert.match(after.reason, /Your run .* worked quads/);
  assert.equal(after.dueAt, base.dueAt, 'an activity is not a workout: the due day does not move');
  assert.equal(K.lastTrained([w1, run], at(2)).last.id, w1.id);
  // Three days later the legs are rested and the plan is back in order.
  assert.equal(K.recommend(plan, [w1, run], at(4)).dayId, 'd2');
  // An easy half hour changes nothing.
  const walk = S.newActivity({ type: 'hike', minutes: 30, effort: 'easy' }, at(1, 19));
  assert.equal(K.recommend(plan, [w1, walk], at(2)).dayId, 'd2');
  // Logged for yesterday: it lands on yesterday.
  const y = S.newActivity({ type: 'bike', minutes: 60, effort: 'moderate', daysAgo: 1 }, at(2));
  assert.equal(K.daysBetween(y.startedAt, at(2)), 1);
});

test('the long view: built from the plan and the rules, in words', () => {
  const plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  const out = buildOutlook(plan);
  assert.deepEqual(out.map((o) => o.title), ['This round', 'How it gets harder', 'Round after round', 'When it stalls', 'Room to add']);
  assert.match(out[0].text, /6 sessions over about 2 weeks, 3 a week/);
  assert.ok(out[0].text.includes(plan.days[0].exercises[0].name), 'names the main lifts');
  assert.match(out[3].text, /10%/);
  for (const o of out) assert.ok(o.text.length > 40 && !/undefined|NaN/.test(o.text), o.title);
  assert.deepEqual(buildOutlook(null), []);
});

const late_notes = (plan, w1) => K.recommend(plan, [w1], at(5)).notes;

test('train now: on the planned day it just starts; early or late it says so and the plan moves', () => {
  let plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 } }, T0);
  const w1 = did(plan, 'd1', at(0));
  assert.equal(w1.restAfter, 1, 'the workout remembers the rest planned after it');
  plan = K.completeDay(plan, 'd1');
  assert.equal(K.dayStatus(plan, 'd1'), 'done');
  // Same evening: two days early. Lower body uses rested muscles, so it is allowed, and said.
  const sameDay = K.recommend(plan, [w1], at(0, 21));
  assert.equal(sameDay.dayId, 'd2'); assert.equal(sameDay.offBy, -2); assert.ok(!sameDay.onSchedule && sameDay.flags.early && !sameDay.flags.clash);
  assert.match(sameDay.notes[0], /2 days earlier than planned\. These muscles are rested/);
  // The planned day: nothing to say.
  const due = K.recommend(plan, [w1], at(2, 7));
  assert.ok(due.onSchedule); assert.equal(due.offBy, 0); assert.deepEqual(due.notes, []); assert.equal(due.reason, 'Next in your plan.');
  assert.equal(K.timeline(plan, [w1], at(0, 21))[0].inDays, 2, 'shown as planned for the day after tomorrow');
  // Browsing the plan shows it as planned, without the "if you trained right now" remarks.
  const planned = K.plannedNext(plan, [w1], at(0, 21));
  assert.equal(planned.dayId, 'd2'); assert.ok(planned.onSchedule); assert.deepEqual(planned.notes, []);
  assert.deepEqual(K.plannedNext(plan, [w1], at(5)).notes, late_notes(plan, w1), 'once the day has passed, being late is part of the picture');
  assert.equal(K.timeline(plan, [w1], at(5))[0].inDays, 0, 'an overdue session is simply due today');
  // Three days late: carry on, nothing lost.
  const late = K.recommend(plan, [w1], at(5));
  assert.ok(!late.onSchedule && late.flags.late); assert.equal(late.offBy, 3); assert.equal(late.easePct, 0);
  assert.match(late.notes[0], /3 days later than planned\. Nothing is lost/);
  // Twelve days away: ease back in.
  const back = K.recommend(plan, [w1], at(12));
  assert.ok(back.flags.longBreak); assert.equal(back.easePct, 10); assert.match(back.notes[0], /12 days since your last workout\. Loads are 10% lighter/);
});

test('train now: a session that would repeat tired muscles gives way to one that lets them rest', () => {
  let plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  const w1 = did(plan, 'd1', at(0)); // upper body: chest, back, shoulders
  plan = K.setOrder(K.completeDay(plan, 'd1'), ['d4']); // the other upper session is put next
  assert.equal(K.queueState(plan).queue[0].id, 'd4');
  const rec = K.recommend(plan, [w1], at(1));
  assert.equal(rec.headId, 'd4'); assert.equal(rec.dayId, 'd2', 'lower body goes first');
  assert.ok(rec.flags.moved && !rec.onSchedule);
  assert.match(rec.reason, /You trained .*yesterday\. Lower body A gives them time to recover, so it goes ahead of Upper body B/);
  assert.equal(rec.order[0], 'd2'); assert.equal(new Set(rec.order).size, 5, 'the rest of the list follows, each session once');
  // A hand-picked session is respected, with a word of warning when it repeats muscles.
  const mine = K.recommend(plan, [w1], at(1), { prefer: 'd4' });
  assert.equal(mine.dayId, 'd4'); assert.match(mine.reason, /Next in your plan|Your pick/); assert.ok(mine.notes.some((n) => /trained less than 48 hours ago/.test(n)));
  // Right after a full-body day everything repeats something: the least overlap is offered, and rest is suggested.
  let p2 = generatePlan(profile({ daysPerWeek: 2, days: [] }), emptyEquipment(), {}, T0);
  const full = did(p2, 'd1', at(0));
  p2 = K.completeDay(p2, 'd1');
  const tight = K.recommend(p2, [full], at(1));
  assert.ok(tight.flags.clash); assert.match(tight.reason, /Resting today is also a good choice/);
});

test('the list: order, skip, done, and the next run', () => {
  let plan = generatePlan(profile(), emptyEquipment(), {}, T0);
  plan = K.setOrder(plan, ['d3', 'nope', 'd3', 'd1']);
  assert.deepEqual(K.queueState(plan).queue.map((d) => d.id), ['d3', 'd1', 'd2', 'd4', 'd5', 'd6'], 'unknown and repeated ids are ignored');
  plan = K.skipDay(plan, 'd5');
  assert.equal(K.dayStatus(plan, 'd5'), 'skipped'); assert.equal(K.queueState(plan).queue.length, 5);
  plan = K.unskipDay(plan, 'd5'); assert.equal(K.dayStatus(plan, 'd5'), 'todo');
  plan = K.setRests(plan, { d3: 4, d1: 99, zz: 2 });
  assert.equal(plan.days[2].restAfter, 4); assert.equal(plan.days[0].restAfter, 6);
  for (const id of ['d1', 'd2', 'd3', 'd4', 'd5']) plan = K.completeDay(plan, id);
  assert.ok(!K.runFinished(plan));
  plan = K.skipDay(plan, 'd6');
  assert.ok(K.runFinished(plan), 'done or skipped, the run is over');
  // With nothing left, the next workout starts the list again, in plan order.
  const again = K.recommend(plan, [], at(20));
  assert.equal(again.dayId, 'd1'); assert.ok(again.flags.newRun); assert.equal(again.order.length, 6);
  const rolled = K.setOrder(plan, again.order);
  assert.deepEqual(rolled.queue, { run: 2, order: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], done: [], skipped: [] });
});

test('easing back in: today is lighter, the plan keeps its numbers, and no conclusions are drawn', () => {
  const plan = generatePlan(profile(), emptyEquipment(), { db_bench_press: { value: 20, step: 2 }, bb_row: { value: 42.5, step: 2.5 } }, T0);
  let s = S.startSession(plan, 'd1', T0, { easePct: 10, why: 'back after a break' });
  assert.equal(s.easePct, 10);
  assert.equal(s.exercises[0].sets[0].planned.load, 20); assert.equal(s.exercises[0].sets[0].target.load, 18, '10% off, rounded to the 2 kg step');
  assert.equal(s.exercises[1].sets[0].target.load, 37.5, '42.5 less 10%, rounded to the 2.5 kg step');
  assert.match(s.exercises[0].sets[0].note, /Eased by 10%/);
  while (s.status === 'active') { if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, T0); s = S.beginSet(s, T0); s = S.finishSet(s, T0 + 2); if (s.phase === 'optional') s = S.endSession(s, T0 + 3); }
  assert.deepEqual(postSessionChanges(s, plan, []), [], 'a lighter comeback session proposes nothing');
  assert.equal(S.startSession(plan, 'd1', T0).exercises[0].sets[0].target.load, 20);
});

test('plans saved in older shapes are brought up to date without losing anything', () => {
  const fresh = generatePlan(profile({ cycleWeeks: 1 }), emptyEquipment(), {}, T0);
  const weekly = JSON.parse(JSON.stringify(fresh));
  delete weekly.queue; delete weekly.perWeek; delete weekly.cycleWeeks;
  weekly.days.forEach((d, i) => { d.weekday = ['mon', 'wed', 'fri'][i]; delete d.week; delete d.slot; delete d.restAfter; });
  const up = upgradePlan(weekly);
  assert.equal(up.perWeek, 3); assert.deepEqual(up.days.map((d) => d.restAfter), [1, 1, 2]); assert.ok(up.days.every((d) => !('weekday' in d)));
  assert.deepEqual(up.queue, { run: 1, order: ['d1', 'd2', 'd3'], done: [], skipped: [] });
  assert.deepEqual(up.days.map((d) => d.exercises), fresh.days.map((d) => d.exercises), 'the sessions themselves are untouched');
  const cyc = JSON.parse(JSON.stringify(fresh)); delete cyc.queue; cyc.cycle = { round: 2, order: ['d2', 'd1', 'd3'], done: ['d2'], skipped: [] };
  assert.deepEqual(upgradePlan(cyc).queue, { run: 2, order: ['d2', 'd1', 'd3'], done: ['d2'], skipped: [] });
  assert.equal(upgradePlan(fresh), fresh, 'a current plan is left alone'); assert.equal(upgradePlan(null), null);
  assert.equal(K.recommend(up, [], at(0)).dayId, 'd1');
});

// ---------------------------------------------------------------- optional extras

const PART = {
  push_h: 'push', push_v: 'push', chest_fly: 'push', triceps: 'push', delt_side: 'push',
  pull_h: 'pull', pull_v: 'pull', biceps: 'pull', delt_rear: 'pull',
  squat: 'legs', hinge: 'legs', lunge: 'legs', glute: 'legs', knee_ext: 'legs', knee_flex: 'legs', calf: 'legs', core: 'core',
};

test('optional extras: every session lists up to two that fit it, outside its time and weekly sets', () => {
  for (let n = 1; n <= 6; n++) {
    for (const [goal, minutes] of [['strength', 50], ['muscle', 45], ['general', 30]]) {
      const eq = emptyEquipment();
      const p = profile({ goal, daysPerWeek: n, days: [], minutes });
      const plan = generatePlan(p, eq, {}, T0);
      const keys = new Set();
      for (const d of plan.days) {
        const opt = dayOptional(d);
        assert.ok(opt.length >= 1 && opt.length <= OPTIONAL.perSession, `${n}/wk ${goal} ${d.title}: ${opt.length} extras`);
        const parts = new Set(d.exercises.map((x) => PART[x.pattern]));
        for (const o of opt) {
          assert.equal(o.optional, true); assert.ok(o.why.length > 10, 'says why it fits');
          assert.ok(o.sets >= 1 && o.sets <= OPTIONAL.sets); assert.ok(o.reps >= o.repLo && o.reps <= o.repHi);
          assert.ok(!d.exercises.some((x) => x.exerciseId === o.exerciseId), 'never repeats an exercise of the session');
          assert.ok(o.pattern === 'core' || parts.has(PART[o.pattern]), `${d.title}: ${o.name} stays in the part of the body the session trains`);
          assert.ok(canDo(eq, allExercises(eq).find((x) => x.id === o.exerciseId)));
          assert.ok(!keys.has(o.key) && /^d\d+x\d+$/.test(o.key)); keys.add(o.key);
          assert.ok(optionalMinutes(o) >= 3 && optionalMinutes(o) <= 12);
        }
        assert.equal(new Set(opt.map((o) => GROUP_OF[o.pattern])).size, opt.length, 'two extras, two muscle groups');
        assert.equal(d.estMinutes, dayMinutes(d.exercises), 'not counted in the session time');
        assert.ok(d.estMinutes <= Math.max(minutes, 33));
      }
      const bare = { ...plan, days: plan.days.map((d) => ({ ...d, optional: [] })) };
      assert.deepEqual(weeklySets(plan), weeklySets(bare), 'not counted in the weekly sets');
    }
  }
});

test('optional extras: what was left out for time comes first, then what the week is short of', () => {
  // 30 minutes: an upper session keeps three lifts; the next ones in its template are the extras.
  const short = generatePlan(profile({ minutes: 30 }), emptyEquipment(), {}, T0);
  const upper = short.days[0];
  const have = new Set(upper.exercises.map((x) => x.pattern));
  const missing = TEMPLATES.upper.map(([p]) => p).filter((p) => !have.has(p));
  assert.deepEqual(upper.optional.map((o) => o.pattern), missing.slice(0, 2));
  for (const o of upper.optional) assert.match(o.why, /Left out of this session to fit 30 min/);
  // Plenty of time, nothing left out: a muscle group short of its weekly sets, or a small one with no direct work.
  const eq = emptyEquipment(); Object.assign(eq.items, { cable: true });
  const long = generatePlan(profile({ goal: 'muscle', daysPerWeek: 4, days: [], minutes: 90 }), eq, {}, T0);
  const up = long.days.find((d) => d.kind === 'upper');
  assert.equal(TEMPLATES.upper.filter(([p]) => !up.exercises.some((x) => x.pattern === p)).length, 0, 'the whole template fits');
  assert.ok(up.optional.every((o) => /under the target|trains the .* directly|Extra sets for/.test(o.why)), up.optional.map((o) => o.why).join(' | '));
  assert.ok(up.optional.some((o) => o.pattern === 'delt_rear'), 'rear delts have no slot in an upper session, so they are offered');
  // Limits and skips are honoured, and novices are not handed hard bodyweight lifts.
  const careful = generatePlan(profile({ months: 2, minutes: 30, avoid: ['db_curl'], avoidTags: ['shoulder'] }), emptyEquipment(), {}, T0);
  for (const d of careful.days) for (const o of d.optional) {
    const cat = EXERCISES.find((x) => x.id === o.exerciseId);
    assert.ok(o.exerciseId !== 'db_curl' && !cat.tags.includes('shoulder') && !cat.hard, `${o.name} should not be offered`);
  }
});

test('optional extras: saved plans gain them, the list follows the equipment, and a shorter list is left alone', () => {
  const eq = emptyEquipment(); Object.assign(eq.items, { cable: true, leg_extension: true });
  const p = profile({ goal: 'muscle', daysPerWeek: 4, days: [], minutes: 60 });
  const plan = generatePlan(p, eq, { db_curl: { value: 12, step: 2 } }, T0);
  assert.equal(fillOptional(plan, p, eq), plan, 'nothing to do the second time');
  // A plan from before the feature: no list at all.
  const old = { ...plan, days: plan.days.map(({ optional, ...d }) => d) };
  const up = fillOptional(old, p, eq, { db_curl: { value: 12, step: 2 } });
  assert.deepEqual(up.days.map((d) => d.optional.map((o) => o.exerciseId)), plan.days.map((d) => d.optional.map((o) => o.exerciseId)));
  assert.equal(up.version, old.version, 'not a change to the plan itself');
  // The cable station goes: extras that needed it give way to others, the rest stay.
  const usedCable = plan.days.flatMap((d) => d.optional).filter((o) => /cable/i.test(o.equipment));
  assert.ok(usedCable.length > 0);
  const noCable = { ...eq, items: { ...eq.items, cable: false } };
  const after = fillOptional(plan, p, noCable);
  for (const d of after.days) {
    assert.ok(d.optional.every((o) => !/cable/i.test(o.equipment)));
    assert.equal(new Set(d.optional.map((o) => o.key)).size, d.optional.length, 'keys stay unique');
  }
  assert.ok(after.days.every((d, i) => d.optional.length === plan.days[i].optional.length), 'each lost extra is replaced');
  // One taken off the list by a change stays off: only a lost entry is filled in again.
  const key = plan.days[0].optional[0].key;
  const cut = applyPlanChange(plan, { id: 'c1', exerciseKey: key, field: 'remove', value: null }, eq, {});
  assert.equal(cut.plan.days[0].optional.length, plan.days[0].optional.length - 1);
  assert.equal(fillOptional(cut.plan, p, eq), cut.plan);
  const back = undoPlanChange(cut.plan, { id: 'c1', exerciseKey: key, field: 'remove', value: null, status: 'applied', undo: cut.undo }, {});
  assert.deepEqual(back.plan.days[0].optional.map((o) => o.key), plan.days[0].optional.map((o) => o.key), 'undo puts it back in its place');
  // An exercise that moves into the session itself is no longer shown as its extra.
  const o = plan.days[0].optional[0];
  const moved = { ...plan, days: plan.days.map((d, i) => (i ? d : { ...d, exercises: [...d.exercises, { ...o, key: 'd1e99', optional: undefined }] })) };
  assert.ok(!dayOptional(moved.days[0]).some((x) => x.exerciseId === o.exerciseId));
  // The same exercise elsewhere in the plan shares its weight.
  const curl = plan.days.flatMap(allEntries).filter((x) => x.exerciseId === 'db_curl');
  assert.ok(curl.every((x) => x.load?.value === 12));
});

test('optional extras in a workout: offered after the last planned set, taken or left, never a miss', () => {
  const plan = generatePlan(profile({ minutes: 30 }), emptyEquipment(), {}, T0);
  const day = plan.days[0];
  let s = S.startSession(plan, 'd1', T0); let t = T0;
  assert.deepEqual(s.optional.map((o) => o.key), day.optional.map((o) => o.key));
  const planned = S.counts(s).total;
  const run = () => { while (s.status === 'active' && s.phase !== 'optional') { if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t); s = S.beginSet(s, t += 1000); s = S.finishSet(s, t += 1000); } };
  run();
  assert.equal(s.status, 'active'); assert.equal(s.phase, 'optional'); assert.equal(s.rest, null);
  assert.equal(S.counts(s).done, planned);
  assert.equal(S.optionalLeft(s).length, 2);
  assert.equal(S.beginSet(s, t), s, 'no set can start on this step'); assert.equal(S.finishSet(s, t), s);
  // The last set can still be nudged or undone from here.
  const lastReps = S.lastSet(s).set.actual.reps;
  assert.equal(S.lastSet(S.adjustLast(s, { reps: lastReps + 2 }, t)).set.actual.reps, lastReps + 2);
  const undone = S.undoFinish(s, t);
  assert.equal(undone.phase, 'active'); assert.equal(S.counts(undone).done, planned - 1);
  assert.equal(S.finishSet(undone, t + 5).phase, 'optional');
  // Leaving them: the workout ends with the planned sets only.
  const plain = S.endSession(s, t + 10);
  assert.equal(plain.status, 'done'); assert.equal(S.counts(plain).total, planned); assert.ok(S.summarize(plain).onPlan);
  assert.deepEqual(S.optionalLeft(plain), []);
  // Taking one: it comes up at once as an exercise of its own.
  const first = s.optional[0];
  s = S.addOptional(s, first.key, t += 1000);
  assert.equal(s.phase, 'ready'); assert.equal(S.current(s).ex.exerciseId, first.exerciseId); assert.equal(S.current(s).ex.optional, true);
  assert.equal(S.current(s).ex.sets.length, first.sets); assert.equal(S.optionalLeft(s).length, 1);
  assert.equal(S.addOptional(s, first.key, t), s, 'not twice');
  run();
  assert.equal(s.phase, 'optional', 'one more is still on offer');
  // The second is added and then not done: it leaves no trace.
  const second = s.optional[1];
  s = S.addOptional(s, second.key, t += 1000);
  const done = S.endSession(s, t += 1000);
  assert.equal(done.status, 'done');
  assert.ok(done.exercises.some((x) => x.exerciseId === first.exerciseId) && !done.exercises.some((x) => x.exerciseId === second.exerciseId));
  const sum = S.summarize(done);
  assert.equal(sum.done, planned + first.sets); assert.equal(sum.skipped, 0); assert.ok(sum.onPlan);
  assert.ok(S.exerciseSummary(done.exercises.find((x) => x.optional)).notes.includes('Optional extra'));
  assert.match(ruleSummary(done, []), new RegExp(`includes the optional ${first.name}`));
  const log = S.readLog(done).map((l) => l.text);
  assert.ok(log.some((l) => /Optional extras on offer/.test(l)) && log.some((l) => l === `${first.name} added as an optional extra`));
  // Taken early from the overview, an extra waits at the end; the workout then ends after it, with one left on offer first.
  let e = S.startSession(plan, 'd1', T0);
  e = S.addOptional(e, first.key, T0 + 5);
  assert.equal(e.cursor.ex, 0); assert.equal(e.exercises[e.exercises.length - 1].exerciseId, first.exerciseId);
  // A session with no extras ends on its last set as before.
  const none = S.startSession({ ...plan, days: plan.days.map((d) => ({ ...d, optional: [] })) }, 'd1', T0);
  s = none; t = T0; run();
  assert.equal(s.status, 'done');
  // Skipping to the end means "done for today": no offer.
  let k = S.startSession(plan, 'd1', T0);
  while (k.status === 'active') k = S.dropExercise(k, T0 + 9);
  assert.equal(k.phase, 'summary');
});

test('optional extras: one that was done moves on like any other exercise', () => {
  const eq = emptyEquipment();
  const plan = generatePlan(profile({ minutes: 30 }), eq, { db_curl: { value: 10, step: 2 } }, T0);
  const o = plan.days[0].optional.find((x) => x.exerciseId === 'db_curl');
  assert.ok(o, 'the dumbbell curl is an extra of the first session');
  let s = S.startSession(plan, 'd1', T0); let t = T0;
  const run = (reps) => { while (s.status === 'active' && s.phase !== 'optional') { if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t); s = S.beginSet(s, t += 1000); if (S.current(s).ex.optional && reps) s = S.editDraft(s, { reps }); s = S.finishSet(s, t += 1000); } };
  run();
  s = S.addOptional(s, o.key, t);
  run(o.repHi); // top of the range on every set
  s = S.endSession(s, t += 1000);
  const changes = postSessionChanges(s, plan, []);
  const c = changes.find((x) => x.exerciseId === 'db_curl');
  assert.ok(c && c.field === 'load' && c.value === 12, JSON.stringify(c));
  const res = applyPlanChange(plan, c, eq, { db_curl: { value: 10, step: 2 } });
  const entry = () => res.plan.days[0].optional.find((x) => x.exerciseId === 'db_curl');
  assert.equal(entry().load.value, 12); assert.equal(entry().reps, o.repLo);
  assert.equal(res.weights.db_curl.value, 12);
  const undone = undoPlanChange(res.plan, { ...c, status: 'applied', undo: res.undo }, res.weights);
  assert.equal(undone.plan.days[0].optional.find((x) => x.exerciseId === 'db_curl').load.value, 10);
  // By hand: the number can be corrected, and a model can change or swap an extra by its key.
  assert.equal(withValue(plan, { exerciseKey: o.key, field: 'reps', value: 9 }, 11).value, 11);
  const ai = fromAiChanges([
    { exercise_key: o.key, field: 'sets', new_value: 3, reason: 'more' },
    { exercise_key: o.key, field: 'exercise', new_exercise_id: plan.days[0].exercises[0].exerciseId, new_value: null, reason: 'dup' },
    { exercise_key: o.key, field: 'exercise', new_exercise_id: 'hammer_curl', new_value: null, reason: 'swap' },
  ], { plan, equipment: eq, mode: 'after_session' });
  assert.deepEqual(ai.map((x) => `${x.field}:${x.value}`), ['sets:3', 'exercise:hammer_curl'], 'an extra never repeats its own session');
  const swapped = applyPlanChange(plan, ai[1], eq, {});
  assert.equal(swapped.plan.days[0].optional.find((x) => x.key === o.key).exerciseId, 'hammer_curl');
});

test('optional extras: a model can pick them per session; where it gives none, the rules do', () => {
  const eq = emptyEquipment();
  const ex = (id) => ({ exercise_id: id, role: 'main', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 90 });
  const raw = {
    days: [
      { week: 1, title: 'Upper body', rest_days_after: 1, exercises: [ex('db_bench_press'), ex('db_row')],
        optional_exercises: [
          { exercise_id: 'db_bench_press', sets: 2, rep_low: 10, rep_high: 12, rest_seconds: 60, why: 'already in the session' },
          { exercise_id: 'no_such_lift', sets: 2, rep_low: 10, rep_high: 12, rest_seconds: 60, why: 'made up' },
          { exercise_id: 'hammer_curl', sets: 9, rep_low: 10, rep_high: 12, rest_seconds: 60, why: 'Your arms get little direct work.' },
          { exercise_id: 'db_lateral_raise', sets: 2, rep_low: 12, rep_high: 15, rest_seconds: 45, why: '' },
          { exercise_id: 'crunch', sets: 2, rep_low: 12, rep_high: 15, rest_seconds: 45, why: 'one too many' },
        ] },
      { week: 1, title: 'Lower body', rest_days_after: 2, exercises: [ex('goblet_squat'), ex('db_rdl')] },
    ],
    notes: [],
  };
  const { plan } = normalizePlan(raw, profile({ daysPerWeek: 2, days: [] }), eq, {}, T0);
  const [up, low] = plan.days;
  assert.deepEqual(up.optional.map((o) => `${o.key}:${o.exerciseId}:${o.sets}`), ['d1x1:hammer_curl:4', 'd1x2:db_lateral_raise:2'], 'checked against the catalog and the session, at most two, numbers clamped');
  assert.equal(up.optional[0].why, 'Your arms get little direct work.'); assert.ok(up.optional[1].why.length > 5, 'a missing reason is filled in');
  assert.ok(up.optional.every((o) => o.optional === true));
  assert.ok(low.optional.length >= 1 && low.optional.every((o) => PART[o.pattern] === 'legs' || o.pattern === 'core'), 'the rules fill the session the model left empty');
  assert.equal(up.estMinutes, dayMinutes(up.exercises));
});
