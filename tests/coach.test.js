import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, mergeProfile, mergeAiProfile } from '../js/ai/coach.js';
import { mergeStates } from '../js/cloud.js';
import { tidy } from '../js/ai/claude.js';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, interviewRequest, newPlanRequest, sessionRequest, equipmentRequest } from '../js/ai/prompts.js';
import { emptyProfile, generatePlan, missingFields } from '../js/domain/planner.js';
import { emptyEquipment, parseEquipmentText, applyEquipmentRead, isAvailable, isListed, EQUIPMENT, allExercises } from '../js/domain/catalog.js';
import { emptyState, hydrate } from '../js/store.js';
import * as S from '../js/domain/session.js';

test('reader: the example message from the design gives goal, experience, days and time', () => {
  const { patch, got } = parseProfile("I want to build strength. I've trained for a year. I can come three times a week for 50 minutes.");
  assert.equal(patch.goal, 'strength'); assert.equal(patch.months, 12); assert.equal(patch.daysPerWeek, 3); assert.equal(patch.minutes, 50);
  assert.deepEqual(got.sort(), ['days', 'experience', 'goal', 'minutes']);
  assert.deepEqual(missingFields(mergeProfile(emptyProfile(), patch)), []);
});

test('reader: days, durations and sessions lengths in common wordings', () => {
  assert.deepEqual(parseProfile('Mondays, Wednesdays and Fridays work').patch.days, ['mon', 'wed', 'fri']);
  assert.equal(parseProfile('twice a week').patch.daysPerWeek, 2);
  assert.equal(parseProfile('4x a week, about an hour').patch.daysPerWeek, 4);
  assert.equal(parseProfile('4x a week, about an hour').patch.minutes, 60);
  assert.equal(parseProfile('45-60 minutes').patch.minutes, 60);
  assert.equal(parseProfile('an hour and a half').patch.minutes, 90);
  assert.equal(parseProfile('lifting for 18 months').patch.months, 18);
  assert.equal(parseProfile('2 and a half years').patch.months, 30);
  assert.equal(parseProfile("I'm a beginner").patch.months, 0);
  assert.equal(parseProfile('I had surgery 2 years ago').patch.months, undefined);
  assert.equal(parseProfile('three times a week').patch.months, undefined, '"a week" is not experience');
  assert.equal(parseProfile('3', { asked: 'days' }).patch.daysPerWeek, 3);
  assert.equal(parseProfile('45', { asked: 'minutes' }).patch.minutes, 45);
  assert.equal(parseProfile('2', { asked: 'experience' }).patch.months, 24);
  assert.equal(parseProfile('I want to get bigger').patch.goal, 'muscle');
  assert.equal(parseProfile('just want to stay healthy').patch.goal, 'general');
});

test('reader: skip, keep and limitations', () => {
  const a = parseProfile("No deadlifts please, but I love pull-ups. My left knee hurts on lunges.");
  assert.ok(a.patch.avoid.includes('bb_deadlift'));
  assert.ok(a.patch.include.includes('pull_up'));
  assert.deepEqual(a.patch.avoidTags, ['knee']);
  assert.match(a.patch.limitations, /knee/i);
  const b = parseProfile("I don't like squats and I want bench press");
  assert.ok(b.patch.avoid.includes('bb_back_squat')); assert.ok(b.patch.include.includes('bb_bench_press'));
  const c = parseProfile('bad lower back');
  assert.deepEqual(c.patch.avoidTags, ['spine']);
  assert.ok(parseProfile('No, nothing', { asked: 'extras' }).nothing);
  assert.equal(parseProfile('I prefer machines', { asked: 'extras' }).patch.preferences, 'I prefer machines');
  const merged = mergeProfile({ ...emptyProfile(), include: ['bb_deadlift'] }, a.patch);
  assert.ok(!merged.include.includes('bb_deadlift'), 'a later "no" beats an earlier "yes"');
});

test('claude profile: unknown ids and odd values are dropped', () => {
  const p = mergeAiProfile(emptyProfile(), { goal: 'muscle', months_training: 8, days_per_week: 9, weekdays: [], minutes_per_session: 400, preferences: null, limitations: 'none', avoid_exercise_ids: ['bb_deadlift', 'fake'], include_exercise_ids: ['pull_up', 'bb_deadlift'] }, emptyEquipment());
  assert.equal(p.goal, 'muscle'); assert.equal(p.daysPerWeek, 6); assert.equal(p.minutes, 150);
  assert.deepEqual(p.avoid, ['bb_deadlift']); assert.deepEqual(p.include, ['pull_up']);
});

test('claude answer: missing or wrong fields never break the app', () => {
  assert.deepEqual(tidy(null), { message: '', questions: [], profile: null, ready_for_plan: false, plan: null, changes: [], equipment: null });
  assert.equal(tidy({ equipment: 'lots' }).equipment, null);
  const t = tidy({ message: ' hi ', questions: ['a', 3, ''], plan: { days: 'x' }, changes: [null, { field: 'load' }], ready_for_plan: 'yes' });
  assert.equal(t.message, 'hi'); assert.deepEqual(t.questions, ['a']); assert.equal(t.plan, null); assert.equal(t.changes.length, 1); assert.equal(t.ready_for_plan, false);
});

test('prompt: schema is strict everywhere and requests carry the mode and rules version', () => {
  const walk = (s) => {
    if (s.anyOf) return s.anyOf.forEach(walk);
    if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, Object.keys(s.properties)); Object.values(s.properties).forEach(walk); }
    if (s.type === 'array') walk(s.items);
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf']) assert.ok(!(k in s), `unsupported keyword ${k}`);
  };
  walk(OUTPUT_SCHEMA);
  assert.ok(SYSTEM_PROMPT.includes('Training rules library, version'));
  assert.ok(!/\d{13}/.test(SYSTEM_PROMPT), 'no timestamps in the cached system text');
  const profile = { ...emptyProfile(), goal: 'strength', months: 12, daysPerWeek: 3, minutes: 50 };
  const eq = emptyEquipment();
  const plan = generatePlan(profile, eq, { db_bench_press: { value: 20, step: 2 } });
  const a = JSON.parse(interviewRequest({ profile, equipment: eq, plan: null, chat: [{ role: 'user', text: 'hi' }], message: 'hello' }));
  assert.equal(a.mode, 'interview'); assert.ok(a.rules_version); assert.ok(a.available_exercises.length > 10);
  assert.ok(!a.available_exercises.some((x) => x.id === 'leg_press'), 'only doable exercises are offered');
  const b = JSON.parse(newPlanRequest({ profile, equipment: eq, weights: {} }));
  assert.deepEqual(b.profile.weekdays, ['mon', 'wed', 'fri']);
  let s = S.startSession(plan, 'd1', 1000); s = S.beginSet(s, 2000); s = S.finishSet(s, 3000); s = S.saveSet(s, 4000);
  const c = JSON.parse(sessionRequest({ mode: 'in_session', profile, equipment: eq, plan, session: s, past: [] }));
  assert.equal(c.mode, 'in_session'); assert.equal(c.session.exercises[0].sets[0].reps, plan.days[0].exercises[0].reps);
  assert.equal(c.session.exercises[0].exercise_key, 'd1e1');
});

test('gym text: named machines, things the gym lacks, own machines and the rest', () => {
  const r = parseEquipmentText('We have a lat pulldown, leg press and cables. Also a glute drive machine and a sauna. No barbell.');
  assert.deepEqual(r.add, ['lat_pulldown', 'leg_press', 'cable']);
  assert.deepEqual(r.off, ['barbell']);
  assert.deepEqual(r.custom, [{ name: 'Glute drive', pattern: 'glute' }]);
  assert.deepEqual(r.unknown, ['sauna']);
  const list = parseEquipmentText('smith machine\nhack squat\npec deck\nhip abductor\nassisted pull-up machine\ntreadmills\nrowing machine\nseated row');
  assert.deepEqual(list.add.sort(), ['hack_squat', 'pec_deck', 'seated_row', 'smith']);
  assert.deepEqual(list.custom, [{ name: 'Hip abductor', pattern: 'glute' }]);
  assert.ok(list.unknown.some((u) => /assisted/.test(u)) && list.unknown.some((u) => /treadmill/.test(u)) && list.unknown.some((u) => /rowing/.test(u)), 'cardio and assisted machines are not guessed at');
  const neg = parseEquipmentText('squat rack, dumbbell rack up to 40kg, no pull-up bar or dip bars, there is no leg curl but there is a leg extension');
  assert.deepEqual(neg.add.sort(), ['dumbbells', 'leg_extension', 'rack']);
  assert.deepEqual(neg.off.sort(), ['dip_station', 'leg_curl', 'pullup_bar']);
  assert.deepEqual(parseEquipmentText('functional trainer and free weights').add.sort(), ['barbell', 'cable', 'dumbbells']);
  assert.deepEqual(parseEquipmentText(''), { add: [], off: [], custom: [], unknown: [] });
});

test('gym text: saving is exact about what changed and never invents equipment', () => {
  let n = 0;
  const id = () => `cm-${++n}`;
  const eq = emptyEquipment(); eq.items.leg_press = true;
  const res = applyEquipmentRead(eq, {
    add: ['lat_pulldown', 'leg_press', 'dumbbells', 'not_real'], off: ['barbell', 'smith', 'lat_pulldown'],
    custom: [{ name: '  Glute   drive ', pattern: 'glute' }, { name: 'Leg press', pattern: 'squat' }, { name: 'Odd thing', pattern: 'nope' }, { name: 'Belt squat', pattern: 'squat' }],
    unknown: ['sauna', 'sauna', ''],
  }, id);
  assert.ok(res.changed);
  assert.deepEqual(res.summary.added, ['Lat pulldown']);
  assert.deepEqual(res.summary.already.sort(), ['Dumbbells', 'Leg press']);
  assert.deepEqual(res.summary.off, ['Barbell and plates'], 'a machine that was never listed is not turned off, and add beats off');
  assert.deepEqual(res.summary.custom, ['Glute drive (glutes)', 'Belt squat (squat)']);
  assert.deepEqual(res.summary.unknown, ['sauna', 'Odd thing']);
  assert.ok(isAvailable(res.equipment, 'lat_pulldown') && !isAvailable(res.equipment, 'barbell') && !isListed(res.equipment, 'smith'));
  assert.ok(allExercises(res.equipment).some((x) => x.name === 'Belt squat' && x.pattern === 'squat'), 'own machines become exercises the planner can use');
  assert.deepEqual(eq, { items: { leg_press: true }, custom: [] }, 'the input is not changed');
  const again = applyEquipmentRead(res.equipment, { add: ['lat_pulldown'], custom: [{ name: 'glute drive', pattern: 'glute' }] }, id);
  assert.ok(!again.changed); assert.equal(again.equipment.custom.length, 2);
  const req = JSON.parse(equipmentRequest({ equipment: res.equipment, text: 'cables' }));
  assert.equal(req.mode, 'equipment'); assert.equal(req.equipment_catalog.length, EQUIPMENT.length);
  assert.ok(req.movements.some((m) => m.id === 'glute')); assert.deepEqual(req.own_machines, ['Glute drive', 'Belt squat']);
});

test('cloud merge: newer main record wins, sessions combine, deletions stick', () => {
  const sess = (id, updatedAt, startedAt = updatedAt) => ({ id, updatedAt, startedAt, status: 'done', exercises: [] });
  const local = { ...emptyState(), updatedAt: 200, plan: { id: 'local' }, sessions: [sess('a', 10), sess('b', 50), sess('gone', 5)], deletedSessions: ['gone'] };
  const remote = { ...emptyState(), updatedAt: 100, plan: { id: 'remote' }, deletedSessions: ['x'] };
  const m = mergeStates(local, remote, [sess('a', 20), sess('c', 30), sess('x', 1), sess('gone', 9)]);
  assert.equal(m.state.plan.id, 'local'); assert.ok(m.pushMain);
  assert.deepEqual(m.state.sessions.map((s) => s.id), ['a', 'c', 'b']);
  assert.equal(m.state.sessions[0].updatedAt, 20, 'newer copy of a session wins');
  assert.deepEqual([...m.pushSessions], ['b']); assert.deepEqual([...m.dropSessions].sort(), ['gone', 'x']);
  const m2 = mergeStates({ ...emptyState() }, remote, [sess('c', 30)]);
  assert.equal(m2.state.plan.id, 'remote'); assert.ok(!m2.pushMain, 'a fresh device adopts the cloud copy');
  // An empty device with a newer clock must not wipe a cloud copy that has a plan...
  const early = mergeStates({ ...emptyState(), updatedAt: 999, chat: [{ id: 'm1' }] }, remote, []);
  assert.equal(early.state.plan.id, 'remote'); assert.ok(!early.pushMain);
  // ...unless the user erased everything on purpose after the cloud copy was written.
  const erased = mergeStates({ ...emptyState(), updatedAt: 999, erasedAt: 999 }, remote, []);
  assert.equal(erased.state.plan, null); assert.ok(erased.pushMain);
  const h = hydrate({ ...m.state, activeSessionId: 'missing' });
  assert.equal(h.activeSessionId, null);
});
