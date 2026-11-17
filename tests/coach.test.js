import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, mergeProfile, mergeAiProfile, afterWorkout, afterSetSaved, reviewSession, undoChange, redoChange, editChange, recordUpdate, recomputeSession, deleteWorkout, logActivity, activityText, reviewEquipment, retryPending, reviewWaiting, startTraining } from '../js/ai/coach.js';
import { mergeStates } from '../js/cloud.js';
import { tidy, sourceName } from '../js/ai/ai.js';
import { openaiParams } from '../js/ai/openai.js';
import { providerSays, ROOM } from '../js/ai/errors.js';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, LOOKUP_SYSTEM, interviewRequest, newPlanRequest, sessionRequest, equipmentRequest, lookupRequest, parseLookup, trainNowRequest, nextRunRequest, activityRequest } from '../js/ai/prompts.js';
import { recommend, completeDay, queueState } from '../js/domain/schedule.js';
import { askAgain, reviewRunning, setWeight } from '../js/ai/coach.js';
import { emptyProfile, generatePlan, missingFields, units } from '../js/domain/planner.js';
import { emptyEquipment, parseEquipmentText, applyEquipmentRead, applyMachineLookup, machineDetail, machineForExercise, machineLabel, isAvailable, isListed, EQUIPMENT, allExercises, SKETCH_IDS, sketchForExercise, sketchForEquipment, EXERCISES } from '../js/domain/catalog.js';
import { SKETCHES } from '../js/ui/sketch.js';
import { emptyState, hydrate } from '../js/store.js';
import * as store from '../js/store.js';
import { brokenExercises } from '../js/domain/planner.js';
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
  // How far ahead to plan can be said, and is not mistaken for experience.
  assert.deepEqual(parseProfile('make it a 3 week cycle').patch, { cycleWeeks: 3 });
  const both = parseProfile('I have trained for 2 years, 3 times a week, plan 2 weeks ahead? no: a 2-week cycle').patch;
  assert.equal(both.months, 24); assert.equal(both.cycleWeeks, 2); assert.equal(both.daysPerWeek, 3);
  assert.equal(parseProfile('a cycle of nine weeks').patch.cycleWeeks, 4, 'capped');
  assert.equal(parseProfile('just want to stay healthy').patch.goal, 'general');
});

test('reader: skip, keep and limitations', () => {
  const a = parseProfile("No deadlifts please, but I love pull-ups. My left knee hurts on lunges.");
  assert.ok(a.patch.avoid.includes('bb_deadlift'));
  assert.ok(a.patch.include.includes('pull_up'));
  assert.deepEqual(a.patch.avoidTags, ['knee']);
  assert.equal(a.patch.limitations, 'My left knee hurts on lunges', 'kept as typed');
  assert.equal(parseProfile('I think my Left Shoulder is sore. but I can train').patch.limitations, 'I think my Left Shoulder is sore');
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
  assert.deepEqual(tidy(null), { message: '', questions: [], profile: null, ready_for_plan: false, plan: null, changes: [], equipment: null, schedule: null, outlook: '' });
  assert.equal(tidy({ outlook: '  Eight  weeks\nof steady work. ' }).outlook, 'Eight weeks of steady work.');
  assert.equal(tidy({ schedule: { order: [] } }).schedule, null, 'a schedule with no first session is not a schedule');
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
  assert.equal(b.profile.sessions_per_week, 3); assert.equal(b.profile.weeks_ahead, 2); assert.ok(!('weekdays' in b.profile));
  assert.ok(/not a calendar/.test(SYSTEM_PROMPT) && !/weekly resistance-training plan/.test(SYSTEM_PROMPT));
  let s = S.startSession(plan, 'd1', 1000); s = S.beginSet(s, 2000); s = S.finishSet(s, 4000);
  const c = JSON.parse(sessionRequest({ mode: 'in_session', profile, equipment: eq, plan, session: s, past: [] }));
  assert.equal(c.mode, 'in_session'); assert.equal(c.session.exercises[0].sets[0].reps, plan.days[0].exercises[0].reps);
  assert.equal(c.session.exercises[0].exercise_key, 'd1e1');
  // Timing goes with every set, and changes the app already made are named as such.
  assert.equal(c.session.exercises[0].sets[0].seconds_under_load, 2); assert.ok('rest_before_seconds' in c.session.exercises[0].sets[0]);
  assert.ok('already_applied' in c && !('already_proposed' in c));
  assert.ok('outlook' in OUTPUT_SCHEMA.properties);
  assert.ok(/makes your changes at once/.test(SYSTEM_PROMPT) && /"activity"/.test(SYSTEM_PROMPT) && /The long view/.test(SYSTEM_PROMPT));
  const run = S.newActivity({ type: 'run', minutes: 45, effort: 'hard' }, 5000000);
  const d = JSON.parse(activityRequest({ profile, plan, sessions: [s, run], activity: run, now: 5000000 + 3600e3 }));
  assert.equal(d.mode, 'activity'); assert.equal(d.logged_activity.activity, 'Run'); assert.equal(d.logged_activity.minutes, 45);
  assert.deepEqual(d.logged_activity.counts_as_work_for, ['Quads', 'Hamstrings and glutes', 'Calves']);
  assert.equal(d.other_activities.length, 0, 'the logged one is not listed twice');
});

test('openai request: strict schema, nothing stored, reasoning only where the model takes it', () => {
  const p = openaiParams('gpt-6.1-sol', '{"mode":"interview"}', true);
  assert.equal(p.text.format.type, 'json_schema'); assert.equal(p.text.format.strict, true);
  assert.match(p.text.format.name, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(p.text.format.schema, OUTPUT_SCHEMA, 'the same answer format as the Claude path');
  assert.equal(p.store, false); assert.equal(p.input, '{"mode":"interview"}');
  assert.ok(p.instructions.includes('Training rules library, version'));
  assert.deepEqual(p.reasoning, { effort: 'low' });
  assert.equal(openaiParams('gpt-6-astra', 'x', false).reasoning.effort, 'medium');
  assert.ok(!('reasoning' in openaiParams('gpt-4.1', 'x', true)));
  assert.ok(!('reasoning' in openaiParams('gpt-5.3-chat-latest', 'x', true)));
  for (const k of ['temperature', 'top_p', 'tools']) assert.ok(!(k in p));
  // The reserved answer room counts against the per-minute limit, so it is kept small.
  assert.equal(p.max_output_tokens, ROOM.quick); assert.equal(openaiParams('gpt-6.1-sol', 'x', false).max_output_tokens, ROOM.normal);
  assert.ok(ROOM.normal <= 8000 && ROOM.quick <= 4000);
  assert.equal(providerSays({ message: '429 Rate limit reached in organization org-AbC123 on tokens per min: Limit 10000.' }), 'Rate limit reached in organization your account on tokens per min: Limit 10000.');
  assert.ok(providerSays({ message: 'x'.repeat(400) }).length <= 220); assert.equal(providerSays(null), '');
  // OpenAI's strict mode: the root is a plain object and nesting stays shallow.
  assert.equal(OUTPUT_SCHEMA.type, 'object'); assert.ok(!OUTPUT_SCHEMA.anyOf);
  const depth = (s) => (s.anyOf ? Math.max(...s.anyOf.map(depth)) : s.type === 'object' ? 1 + Math.max(0, ...Object.values(s.properties).map(depth)) : s.type === 'array' ? depth(s.items) : 0);
  assert.ok(depth(OUTPUT_SCHEMA) <= 5, `schema nests ${depth(OUTPUT_SCHEMA)} objects deep`);
  assert.equal(sourceName('openai'), 'OpenAI'); assert.equal(sourceName('claude'), 'Claude'); assert.equal(sourceName('rules'), 'the training rules');
});

test('train now and next run: the model gets the list, the history and the app\'s own pick', () => {
  const profile = { ...emptyProfile(), goal: 'strength', months: 12, daysPerWeek: 3, minutes: 50 };
  const eq = emptyEquipment();
  let plan = generatePlan(profile, eq, { db_bench_press: { value: 20, step: 2 } });
  const t0 = new Date(2026, 10, 9, 18).getTime();
  let w = S.startSession(plan, 'd1', t0);
  while (w.status === 'active') { if (S.needsWeight(w)) w = S.setStartingWeight(w, 20, 2, t0); w = S.beginSet(w, t0); w = S.finishSet(w, t0 + 2); if (w.phase === 'optional') w = S.endSession(w, t0 + 3); }
  plan = completeDay(plan, 'd1');
  const now = t0 + 26 * 3600e3; // the next evening: a day early
  const pick = recommend(plan, [w], now);
  const req = JSON.parse(trainNowRequest({ profile, equipment: eq, plan, sessions: [w], now, pick }));
  assert.equal(req.mode, 'train_now'); assert.equal(req.days_off_plan, -1);
  assert.deepEqual(req.current_plan.list, { done: ['d1'], skipped: [], still_to_do_in_order: ['d2', 'd3', 'd4', 'd5', 'd6'] });
  assert.equal(req.current_plan.sessions[0].rest_days_after, 1); assert.ok(!('weekday' in req.current_plan.sessions[0]));
  assert.equal(req.recent_workouts[0].title, 'Upper body A'); assert.equal(req.recent_workouts[0].days_ago, 1); assert.equal(req.recent_workouts[0].planned_rest_days_after, 1);
  assert.ok(req.recent_workouts[0].sets_done_by_muscle_group.Chest >= 3);
  assert.equal(req.hours_since_muscle_group_was_trained.Back, 26); assert.equal(req.workouts_in_last_7_days, 1);
  assert.equal(req.app_pick.session_id, 'd2'); assert.deepEqual(req.app_pick.order_after_today, pick.order.slice(1));
  const nr = JSON.parse(nextRunRequest({ profile, equipment: eq, plan, sessions: [w], weights: { db_bench_press: { value: 20 } }, now }));
  assert.equal(nr.mode, 'next_run'); assert.equal(nr.profile.weeks_ahead, 2); assert.ok(nr.available_exercises.length > 10);
  assert.deepEqual(nr.results_by_exercise.db_bench_press[0].reps, w.exercises[0].sets.map((x) => x.actual.reps));
  assert.equal(nr.known_loads.db_bench_press, 20);
  for (const k of ['first_session_id', 'reason', 'order', 'rest_days', 'ease_percent']) assert.ok(k in OUTPUT_SCHEMA.properties.schedule.anyOf[0].properties, k);
  assert.ok('rest_days_after' in OUTPUT_SCHEMA.properties.plan.anyOf[0].properties.days.items.properties);
});

test('gym text: named machines, things the gym lacks, own machines and the rest', () => {
  const r = parseEquipmentText('We have a lat pulldown, leg press and cables. Also a glute drive machine and a sauna. No barbell.');
  assert.deepEqual(r.add, ['lat_pulldown', 'leg_press', 'cable']);
  assert.deepEqual(r.off, ['barbell']);
  assert.deepEqual(r.custom, [{ name: 'Glute drive', pattern: 'glute' }]);
  assert.deepEqual(r.unknown, ['sauna']);
  assert.deepEqual(r.machines, [], 'no maker named, nothing to identify');
  const list = parseEquipmentText('smith machine\nhack squat\npec deck\nhip abductor\nassisted pull-up machine\ntreadmills\nrowing machine\nseated row');
  assert.deepEqual(list.add.sort(), ['hack_squat', 'pec_deck', 'seated_row', 'smith']);
  assert.deepEqual(list.custom, [{ name: 'Hip abductor', pattern: 'glute' }]);
  assert.ok(list.unknown.some((u) => /assisted/.test(u)) && list.unknown.some((u) => /treadmill/.test(u)) && list.unknown.some((u) => /rowing/.test(u)), 'cardio and assisted machines are not guessed at');
  const neg = parseEquipmentText('squat rack, dumbbell rack up to 40kg, no pull-up bar or dip bars, there is no leg curl but there is a leg extension');
  assert.deepEqual(neg.add.sort(), ['dumbbells', 'leg_extension', 'rack']);
  assert.deepEqual(neg.off.sort(), ['dip_station', 'leg_curl', 'pullup_bar']);
  assert.deepEqual(parseEquipmentText('functional trainer and free weights').add.sort(), ['barbell', 'cable', 'dumbbells']);
  assert.deepEqual(parseEquipmentText(''), { add: [], off: [], custom: [], unknown: [], machines: [] });
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
  assert.deepEqual(eq, { items: { leg_press: true }, custom: [], details: {} }, 'the input is not changed');
  assert.deepEqual(res.summary.described, []);
  const again = applyEquipmentRead(res.equipment, { add: ['lat_pulldown'], custom: [{ name: 'glute drive', pattern: 'glute' }] }, id);
  assert.ok(!again.changed); assert.equal(again.equipment.custom.length, 2);
  const req = JSON.parse(equipmentRequest({ equipment: res.equipment, text: 'cables' }));
  assert.equal(req.mode, 'equipment'); assert.equal(req.equipment_catalog.length, EQUIPMENT.length);
  assert.ok(req.movements.some((m) => m.id === 'glute')); assert.deepEqual(req.own_machines, ['Glute drive', 'Belt squat']);
});

test('machines by maker: the built-in reader notes the maker for the group it was named for', () => {
  const r = parseEquipmentText("It's these machines from Technogym: leg press, chest press and the glute machine. Also a smith machine.");
  assert.deepEqual(r.add, ['leg_press', 'chest_press', 'smith']);
  assert.deepEqual(r.custom, [{ name: 'Glute machine', pattern: 'glute' }]);
  assert.deepEqual(r.machines, [{ ref: 'leg_press', vendor: 'Technogym' }, { ref: 'chest_press', vendor: 'Technogym' }, { ref: 'Glute machine', vendor: 'Technogym' }], 'the maker stops at the end of the sentence');
  const h = parseEquipmentText('by hammer strength: iso-lateral row, incline press\nlat pulldown');
  assert.deepEqual(h.machines.map((m) => m.vendor), ['Hammer Strength', 'Hammer Strength']);
  assert.equal(parseEquipmentText('I get there by the bus: leg press').machines.length, 0, '"by the ..." is not a maker');
  let n = 0;
  const res = applyEquipmentRead(emptyEquipment(), r, () => `cm-${++n}`);
  assert.deepEqual(machineDetail(res.equipment, 'leg_press'), { vendor: 'Technogym', basis: 'stated' });
  assert.equal(machineDetail(res.equipment, 'smith'), null);
  assert.equal(machineDetail(res.equipment, 'cm-1').vendor, 'Technogym');
  assert.deepEqual(res.summary.described.map((d) => `${d.name}:${d.label}:${d.basis}`), ['Leg press:Technogym:stated', 'Chest press machine:Technogym:stated', 'Glute machine:Technogym:stated']);
});

test('machines by maker: what the model knows is saved, and a web result needs a real source', () => {
  let n = 0;
  const read = {
    add: ['leg_press', 'chest_press'], custom: [{ name: 'Belt squat', pattern: 'squat' }],
    machines: [
      { ref: 'leg_press', vendor: ' Technogym ', model: 'Selection 900 Leg Press', how: 'Seated; you push a footplate away.', isolates: 'Quadriceps and glutes', loading: 'selectorized', notes: null, basis: 'memory' },
      { ref: 'Belt squat', vendor: 'Pit Shark', model: null, how: 'Belt around the hips, weight hangs between the legs.', isolates: 'Quadriceps', loading: 'laser', basis: 'memory' },
      { ref: 'not_on_the_list', vendor: 'X', model: 'Y', how: 'z', isolates: 'w', basis: 'memory' },
      { ref: 'chest_press', vendor: '', model: '', how: '', isolates: '', basis: 'memory' },
    ],
  };
  const res = applyEquipmentRead(emptyEquipment(), read, () => `cm-${++n}`);
  const lp = machineDetail(res.equipment, 'leg_press');
  assert.deepEqual(lp, { vendor: 'Technogym', model: 'Selection 900 Leg Press', how: 'Seated; you push a footplate away.', isolates: 'Quadriceps and glutes', loading: 'selectorized', basis: 'memory' });
  assert.equal(machineLabel(lp), 'Technogym Selection 900 Leg Press');
  assert.ok(!('loading' in machineDetail(res.equipment, 'cm-1')), 'an unknown way of loading is dropped');
  assert.equal(machineDetail(res.equipment, 'chest_press'), null, 'an empty description saves nothing');
  assert.equal(Object.keys(res.equipment.details).length, 2, 'a machine that is not on the list gets no details');
  assert.equal(res.summary.described.length, 2);

  // Web lookup: only an https address the search really returned counts.
  const found = [
    { ref: 'leg_press', vendor: 'Technogym', model: 'Selection 900 Leg Press', how_it_works: 'From the page: five backrest positions.', isolates: 'Quadriceps, then glutes', loading: 'selectorized', notes: '', source_url: 'https://maker.example/leg-press/' },
    { ref: 'cm-1', vendor: 'Pit Shark', model: 'Belt Squat', how_it_works: 'Made up.', isolates: 'Everything', loading: 'plate_loaded', source_url: 'https://invented.example/belt' },
    { ref: 'chest_press', vendor: 'T', model: 'M', how_it_works: 'h', isolates: 'i', loading: 'other', source_url: 'http://maker.example/plain-http' },
    { ref: 'smith', vendor: 'T', model: 'M', how_it_works: 'h', isolates: 'i', loading: 'other', source_url: 'https://maker.example/leg-press' },
  ];
  const merged = applyMachineLookup(res.equipment, found, ['https://maker.example/leg-press', 'http://maker.example/plain-http']);
  assert.deepEqual(merged.described.map((d) => `${d.id}:${d.basis}:${d.host}`), ['leg_press:web:maker.example']);
  const web = machineDetail(merged.equipment, 'leg_press');
  assert.equal(web.basis, 'web'); assert.equal(web.source, 'https://maker.example/leg-press/'); assert.match(web.how, /five backrest positions/);
  assert.equal(machineDetail(merged.equipment, 'cm-1').basis, 'memory', 'an invented address changes nothing');
  assert.equal(machineDetail(merged.equipment, 'smith'), null, 'a machine nobody asked about is ignored');
  assert.deepEqual(applyMachineLookup(res.equipment, 'garbage', null).described, []);
  // Reading the same text again changes nothing, still lists the machines, and keeps a checked result.
  const again = applyEquipmentRead(merged.equipment, read, () => 'cm-x');
  assert.ok(!again.changed); assert.equal(again.summary.described.length, 2);
  assert.equal(again.summary.described.find((d) => d.id === 'leg_press').basis, 'web');
  assert.match(machineDetail(again.equipment, 'leg_press').how, /five backrest positions/, 'memory does not overwrite what was found on the web');

  // The coach sees it: in the equipment list and on the exercises done on that machine.
  const profile = { ...emptyProfile(), goal: 'muscle', months: 12, daysPerWeek: 3, minutes: 50 };
  const req = JSON.parse(newPlanRequest({ profile, equipment: merged.equipment, weights: {} }));
  const eqOut = req.equipment.find((x) => x.name === 'Leg press');
  assert.equal(eqOut.maker, 'Technogym'); assert.equal(eqOut.model, 'Selection 900 Leg Press'); assert.match(eqOut.how_it_works, /backrest/);
  assert.equal(eqOut.isolates, 'Quadriceps, then glutes'); assert.equal(eqOut.checked, 'found on the web'); assert.equal(eqOut.loading, 'weight stack with a pin');
  assert.ok(req.equipment.includes('Dumbbells'), 'entries with nothing known stay plain names');
  assert.equal(req.available_exercises.find((x) => x.id === 'leg_press').machine.maker, 'Technogym');
  assert.match(req.available_exercises.find((x) => x.name === 'Belt squat').machine.checked, /not checked/);
  assert.equal(machineForExercise(merged.equipment, allExercises(merged.equipment).find((x) => x.id === 'leg_press')).name, 'Leg press');
  assert.equal(machineForExercise(merged.equipment, allExercises(merged.equipment).find((x) => x.id === 'db_curl')), null);
  assert.ok(SYSTEM_PROMPT.includes('what it isolates'));
});

test('sketches: every kind of equipment has a drawing, and every exercise maps to the right one', () => {
  assert.deepEqual(Object.keys(SKETCHES).sort(), [...SKETCH_IDS].sort());
  for (const [id, sk] of Object.entries(SKETCHES)) { assert.ok(sk.name && sk.parts.length >= 2, id); for (const p of sk.parts) assert.ok(['f', 'p', 'm', 'mp', 'mr', 'c', 's', 'w', 'r'].includes(p[0]), `${id}: ${p[0]}`); }
  for (const x of EQUIPMENT) assert.ok(SKETCHES[x.id], `no drawing for ${x.name}`);
  const eq = emptyEquipment(); Object.assign(eq.items, { leg_press: true, rack: true, cable: true, smith: true });
  const look = (id) => sketchForExercise(eq, EXERCISES.find((x) => x.id === id));
  assert.deepEqual(look('leg_press'), { id: 'leg_press', loading: undefined });
  assert.equal(look('db_bench_press').id, 'dumbbells'); assert.equal(look('bb_back_squat').id, 'rack'); assert.equal(look('bb_deadlift').id, 'barbell');
  assert.equal(look('pull_up').id, 'pullup_bar'); assert.equal(look('cable_pushdown').id, 'cable'); assert.equal(look('smith_bench_press').id, 'smith');
  assert.equal(look('push_up'), null, 'floor work needs no drawing');
  for (const x of EXERCISES.filter((e) => e.equip.length)) assert.ok(SKETCHES[sketchForExercise({ items: Object.fromEntries(EQUIPMENT.map((q) => [q.id, true])), custom: [], details: {} }, x)?.id], x.id);
  // A machine of the gym's own: by what it trains, or by what the model said it looks like; plates when it is plate-loaded.
  let n = 0;
  const res = applyEquipmentRead(eq, {
    custom: [{ name: 'Glute drive', pattern: 'glute' }, { name: 'Iso row', pattern: 'pull_h' }],
    machines: [{ ref: 'Iso row', vendor: 'Hammer Strength', how: 'Two arms move on their own.', isolates: 'Lats', loading: 'plate_loaded', sketch: 'seated_row', basis: 'memory' },
      { ref: 'leg_press', vendor: 'X', how: 'Sled.', isolates: 'Quads', loading: 'plate_loaded', looks_like: 'not_a_drawing', basis: 'memory' }],
  }, () => `cm-${++n}`);
  assert.deepEqual(sketchForEquipment(res.equipment, 'cm-1'), { id: 'glute', loading: undefined });
  assert.deepEqual(sketchForEquipment(res.equipment, 'cm-2'), { id: 'seated_row', loading: 'plate_loaded' });
  assert.deepEqual(sketchForEquipment(res.equipment, 'leg_press'), { id: 'leg_press', loading: 'plate_loaded' });
  assert.ok(!('sketch' in machineDetail(res.equipment, 'leg_press')), 'an unknown drawing name is dropped');
  assert.deepEqual(OUTPUT_SCHEMA.properties.equipment.anyOf[0].properties.machines.items.properties.looks_like.enum, SKETCH_IDS);
  assert.ok(LOOKUP_SYSTEM.includes('looks_like') && LOOKUP_SYSTEM.includes('hack_squat'));
});

test('machine lookup: the request names each machine and the answer is read leniently', () => {
  const req = JSON.parse(lookupRequest([{ ref: 'leg_press', name: 'Leg press', vendor: 'Technogym', model: 'Selection 900' }, { ref: 'cm-1', name: 'Belt squat', vendor: 'Pit Shark' }]));
  assert.equal(req.task, 'machine_lookup');
  assert.deepEqual(req.machines[1], { ref: 'cm-1', kind: 'Belt squat', vendor: 'Pit Shark', model: null });
  assert.ok(/Never invent a model name or a web address/.test(LOOKUP_SYSTEM));
  assert.deepEqual(parseLookup('Sure. [{"ref":"a","x":1}, 5, {"no_ref":true}] Thanks.'), [{ ref: 'a', x: 1 }]);
  assert.deepEqual(parseLookup('nothing found'), []); assert.deepEqual(parseLookup('[oops'), []); assert.deepEqual(parseLookup('{"ref":"a"}'), []);
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

// ---------------------------------------------------------------- updates made at once
// No model is connected in these tests, so the training rules do the work.

const W0 = { db_bench_press: { value: 20, step: 2 } };
function freshApp(over = {}) {
  const profile = { ...emptyProfile(), goal: 'strength', months: 12, daysPerWeek: 3, minutes: 50 };
  const equipment = emptyEquipment();
  const plan = generatePlan(profile, equipment, W0);
  store.replaceState({ ...emptyState(), profile, equipment, plan, weights: { ...W0 }, ...over });
  return store.getState();
}
/** Do a whole session through the store, as the workout screen does. */
function train(dayId, repsFor = () => null, start = Date.now() - 3600e3) {
  let s = startTraining(dayId);
  s = { ...s, id: `s-${start.toString(36)}`, startedAt: start, log: [[0, 'start', dayId]] };
  store.set({ sessions: store.getState().sessions.map((x) => (x.status === 'active' ? s : x)), activeSessionId: s.id });
  let t = start;
  while (s.status === 'active') {
    if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t);
    const { ex, set } = S.current(s);
    s = S.beginSet(s, t += 1000); const r = repsFor(ex, set); if (r != null) s = S.editDraft(s, { reps: r });
    s = S.finishSet(s, t += 1000);
    if (s.phase === 'optional') s = S.endSession(s, t); // no optional extras today
  }
  store.putSession(s);
  afterWorkout(s);
  return s;
}
const benchIn = (plan) => plan.days.flatMap((d) => d.exercises).filter((x) => x.exerciseId === 'db_bench_press');

test('after a workout: the plan is updated at once, with a summary, and every change can be undone, corrected or made again', () => {
  const before = freshApp().plan;
  const reps0 = benchIn(before)[0].reps;
  const s = train('d1');
  let st = store.getState();
  const update = st.proposals.find((p) => p.sessionId === s.id);
  assert.ok(update, 'an update is written down');
  assert.equal(update.mode, 'post_session'); assert.equal(update.source, 'rules'); assert.ok(!update.checking && !update.pending);
  assert.match(update.message, /^All \d+ sets done/);
  assert.ok(update.changes.length > 0 && update.changes.every((c) => c.status === 'applied' && c.undo), 'changes are in, each with what it replaced');
  const c = update.changes.find((x) => x.exerciseId === 'db_bench_press');
  assert.equal(c.field, 'reps');
  assert.ok(benchIn(st.plan).every((x) => x.reps === reps0 + 1), 'already in the plan, nothing to accept');
  assert.equal(st.plan.lastUpdate.text, update.message);
  assert.deepEqual(queueState(st.plan).done, ['d1']);
  assert.equal(reviewSession(s.id).id, update.id, 'asking again does not double it');
  // Undo puts back what was there.
  assert.ok(undoChange(update.id, c.id));
  st = store.getState();
  assert.ok(benchIn(st.plan).every((x) => x.reps === reps0));
  assert.equal(st.proposals[0].changes.find((x) => x.id === c.id).status, 'undone');
  assert.ok(!undoChange(update.id, c.id), 'nothing to undo twice');
  // Made again after all.
  assert.ok(redoChange(update.id, c.id));
  assert.ok(benchIn(store.getState().plan).every((x) => x.reps === reps0 + 1));
  // Corrected by hand: the user's number goes in, and the record says what the update had set.
  assert.ok(editChange(update.id, c.id, reps0 + 2));
  st = store.getState();
  const e = st.proposals[0].changes.find((x) => x.id === c.id);
  assert.equal(e.status, 'edited'); assert.equal(e.value, reps0 + 2); assert.equal(e.suggested, `${reps0 + 1} reps`); assert.equal(e.to, `${reps0 + 2} reps`);
  assert.ok(benchIn(st.plan).every((x) => x.reps === reps0 + 2));
  assert.ok(undoChange(update.id, c.id), 'a corrected change can still be undone');
  assert.ok(benchIn(store.getState().plan).every((x) => x.reps === reps0));
  // After a rebuild the old list no longer reaches into the new plan.
  store.set({ plan: { ...store.getState().plan, id: 'plan_new' } });
  const other = update.changes.find((x) => x.id !== c.id);
  assert.ok(!undoChange(update.id, other.id));
  assert.equal(store.getState().proposals[0].changes.find((x) => x.id === other.id).status, 'stale');
});

test('correcting or deleting the latest workout works the plan out again; an older one leaves it alone', () => {
  const before = freshApp().plan;
  const reps0 = benchIn(before)[0].reps;
  const s1 = train('d1', () => null, Date.now() - 3 * 864e5);
  assert.ok(benchIn(store.getState().plan).every((x) => x.reps === reps0 + 1));
  // The first bench set is corrected to two reps short: the +1 rep no longer holds.
  store.putSession(S.editSet(store.sessionById(s1.id), 0, 0, { reps: reps0 - 2, load: 20, rir: null }));
  assert.equal(recomputeSession(s1.id), 'redone');
  let st = store.getState();
  assert.ok(benchIn(st.plan).every((x) => x.reps === reps0), 'the change built on the old numbers is gone');
  const u = st.proposals.filter((p) => p.sessionId === s1.id);
  assert.equal(u.length, 1); assert.ok(!u[0].changes.some((c) => c.exerciseId === 'db_bench_press'));
  assert.match(u[0].message, /under plan/);
  // A second workout makes the first one history: correcting it now only changes the record.
  const s2 = train('d2', () => null, Date.now() - 864e5);
  const planNow = JSON.stringify(store.getState().plan);
  store.putSession(S.editSet(store.sessionById(s1.id), 0, 0, { reps: reps0, load: 20, rir: null }));
  assert.equal(recomputeSession(s1.id), 'old');
  assert.equal(JSON.stringify(store.getState().plan), planNow);
  // Deleting the latest workout takes its changes back and puts its session on the list again.
  const made = store.getState().proposals.find((p) => p.sessionId === s2.id).changes.filter((c) => c.status === 'applied');
  assert.ok(made.length > 0);
  deleteWorkout(s2.id);
  st = store.getState();
  assert.ok(!st.sessions.some((x) => x.id === s2.id) && !st.proposals.some((p) => p.sessionId === s2.id));
  assert.deepEqual(queueState(st.plan).done, ['d1']);
  for (const c of made) {
    const ex = st.plan.days.flatMap((d) => d.exercises).find((x) => x.exerciseId === c.exerciseId);
    assert.notEqual(c.field === 'reps' ? ex.reps : ex.load?.value, c.value, `${c.exerciseName} is back to what it was`);
  }
  // Deleting an older workout leaves the plan alone.
  train('d2', () => null, Date.now() - 3600e3);
  const keep = JSON.stringify(store.getState().plan);
  deleteWorkout(s1.id);
  assert.equal(JSON.stringify(store.getState().plan), keep);
});

test('during a workout: a missed set changes the sets to come at once, and the change can be undone', () => {
  freshApp();
  let s = startTraining('d1');
  const target = S.current(s).set.target.reps;
  s = S.beginSet(s); s = S.editDraft(s, { reps: target - 1 });
  const done = S.finishSet(s);
  store.putSession(done);
  afterSetSaved(s, s.exercises[0].key, 0);
  let live = store.activeSession();
  assert.ok(live.hint?.applied, 'made without asking');
  assert.equal(live.exercises[0].sets[1].target.load, 18);
  store.putSession(S.undoHint(live));
  assert.equal(store.activeSession().exercises[0].sets[1].target.load, 20);
  // Putting the rep back during the rest: no change is left standing.
  store.putSession(S.adjustLast(store.activeSession(), { reps: target }));
  afterSetSaved(store.activeSession(), s.exercises[0].key, 0);
  live = store.activeSession();
  assert.equal(live.hint, null); assert.equal(live.exercises[0].sets[1].target.load, 20);
});

test('other activity: logged with the workouts, explained in words, and gone again when deleted', () => {
  freshApp();
  const act = logActivity({ type: 'run', minutes: 45, effort: 'hard' });
  let st = store.getState();
  assert.equal(st.sessions.length, 1); assert.equal(st.activeSessionId, null);
  assert.equal(store.doneWorkouts(st).length, 0, 'not counted as a workout');
  const u = st.proposals.find((p) => p.sessionId === act.id);
  assert.equal(u.mode, 'activity'); assert.deepEqual(u.changes, []);
  assert.match(u.message, /45 min run, hard effort\. It counts as work for quads, hamstrings and glutes and calves/);
  assert.equal(st.plan.lastUpdate.text, u.message);
  assert.match(activityText({ title: 'Swim', activity: 'swim', minutes: 10, effort: 'easy' }), /Too light or too short/);
  // The first session of the plan trains legs too? Whatever is next, a leg session is not offered today.
  const pick = recommend(st.plan, st.sessions, Date.now() + 2 * 3600e3);
  const legs = (d) => d.exercises.some((x) => ['squat', 'hinge', 'lunge'].includes(x.pattern) && x.tier === 'main');
  assert.ok(!legs(st.plan.days.find((d) => d.id === pick.dayId)) || pick.flags.clash);
  deleteWorkout(act.id);
  st = store.getState();
  assert.equal(st.sessions.length, 0); assert.ok(!st.proposals.some((p) => p.sessionId === act.id));
});

test('equipment taken away: the plan swaps at once; an undone swap is not forced back in', () => {
  const eq = emptyEquipment(); eq.items.leg_press = true; eq.items.rack = true;
  const profile = { ...emptyProfile(), goal: 'strength', months: 12, daysPerWeek: 3, minutes: 50 };
  store.replaceState({ ...emptyState(), profile, equipment: eq, plan: generatePlan(profile, eq, {}) });
  assert.equal(reviewEquipment(), null, 'nothing to do while everything is there');
  const eq2 = JSON.parse(JSON.stringify(eq)); eq2.items.rack = false;
  store.set({ equipment: eq2 });
  const n = brokenExercises(store.getState().plan, eq2).length;
  assert.ok(n > 0);
  const u = reviewEquipment();
  assert.equal(u.mode, 'equipment'); assert.equal(u.changes.length, n); assert.match(u.message, /equipment list changed/);
  assert.equal(brokenExercises(store.getState().plan, eq2).length, 0);
  assert.ok(undoChange(u.id, u.changes[0].id));
  assert.equal(brokenExercises(store.getState().plan, eq2).length >= 1, true);
  assert.equal(reviewEquipment(), null, 'the user said no to that one');
  assert.ok(reviewEquipment({ force: true }), '"Swap them" still works');
  assert.equal(brokenExercises(store.getState().plan, eq2).length, 0);
});

test('older data: a workout left on the old result step carries on as a set in progress', () => {
  const st = freshApp();
  let s = S.beginSet(S.setStartingWeight(S.startSession(st.plan, 'd1'), 20, 2));
  const old = hydrate({ ...st, sessions: [{ ...s, phase: 'log', log: undefined, last: undefined }], activeSessionId: s.id });
  assert.equal(old.sessions[0].phase, 'active'); assert.equal(old.activeSessionId, s.id);
  const done = S.finishSet(old.sessions[0]);
  assert.equal(done.phase, 'rest'); assert.equal(done.exercises[0].sets[0].status, 'done'); assert.ok(Array.isArray(done.log));
  assert.deepEqual(S.readLog({ ...done, log: undefined }), []);
});

test('offline: a review that waits is shown as waiting, and dropped when no model is connected any more', () => {
  freshApp();
  const s = train('d1');
  const u = store.getState().proposals.find((p) => p.sessionId === s.id);
  store.patchUpdate(u.id, { pending: true });
  assert.ok(reviewWaiting());
  retryPending(); // no model connected: there is nobody to ask
  assert.ok(!reviewWaiting());
  assert.equal(store.getState().proposals[0].changes.length, u.changes.length, 'the rule-based update stands');
  // Data saved by the version before, with changes that were never accepted: they can still be applied.
  const st = store.getState();
  const legacy = { id: 'p-old', createdAt: 1, mode: 'coach', source: 'claude', sessionId: null, changes: [{ id: 'c-old', status: 'open', exerciseKey: st.plan.days[0].exercises[0].key, exerciseName: 'x', field: 'sets', from: '4 sets', to: '2 sets', value: 2, reason: 'r' }] };
  store.set({ proposals: [...st.proposals, legacy] });
  assert.ok(redoChange('p-old', 'c-old'));
  assert.equal(store.getState().plan.days[0].exercises[0].sets, 2);
  const made = recordUpdate({ mode: 'coach', source: 'claude', changes: [{ id: 'c-x', exerciseKey: 'nope', exerciseName: 'gone', field: 'sets', value: 3, from: '', to: '', reason: 'r' }] });
  assert.equal(made.changes[0].status, 'stale', 'a change that points at nothing is written down, not made');
});

test('optional extras: the model is told about them, can pick them, and saved data gains them on load', () => {
  const profile = { ...emptyProfile(), goal: 'strength', months: 12, daysPerWeek: 3, minutes: 50 };
  const eq = emptyEquipment();
  const plan = generatePlan(profile, eq);
  // What the model is sent.
  assert.match(SYSTEM_PROMPT, /Optional extras\n/); assert.match(SYSTEM_PROMPT, /\[OPT-1\]/);
  const dayProps = OUTPUT_SCHEMA.properties.plan.anyOf[0].properties.days.items;
  assert.ok(dayProps.required.includes('optional_exercises'));
  assert.deepEqual(dayProps.properties.optional_exercises.items.required, ['exercise_id', 'sets', 'rep_low', 'rep_high', 'rest_seconds', 'why']);
  const req = JSON.parse(interviewRequest({ profile, equipment: eq, plan, chat: [], message: 'hi' }));
  const sent = req.current_plan.sessions[0].optional_at_the_end;
  assert.deepEqual(sent.map((x) => x.exercise_key), plan.days[0].optional.map((o) => o.key));
  assert.ok(sent.every((x) => x.why && x.sets <= 2));
  // A finished workout says which exercise was an extra and which extras were left.
  let w = S.startSession(plan, 'd1', Date.now() - 3600e3); let t = w.startedAt;
  while (w.phase !== 'optional') { if (S.needsWeight(w)) w = S.setStartingWeight(w, 20, 2, t); w = S.beginSet(w, t += 1000); w = S.finishSet(w, t += 1000); }
  w = S.addOptional(w, w.optional[0].key, t);
  while (w.phase !== 'optional') { if (S.needsWeight(w)) w = S.setStartingWeight(w, 10, 2, t); w = S.beginSet(w, t += 1000); w = S.finishSet(w, t += 1000); }
  w = S.endSession(w, t += 1000);
  const after = JSON.parse(sessionRequest({ mode: 'after_session', profile, equipment: eq, plan, session: w, past: [] }));
  assert.equal(after.session.exercises.filter((x) => x.optional_extra).length, 1);
  assert.deepEqual(after.session.optional_extras_not_taken, [plan.days[0].optional[1].name]);
  // Loading data saved by an older version of the app: the plan gains its extras, nothing else moves.
  const old = { ...emptyState(), profile, equipment: eq, plan: { ...plan, days: plan.days.map(({ optional, ...d }) => d) } };
  const loaded = hydrate(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(loaded.plan.days.map((d) => d.optional.map((o) => o.exerciseId)), plan.days.map((d) => d.optional.map((o) => o.exerciseId)));
  assert.deepEqual(loaded.plan.days.map((d) => d.exercises), plan.days.map((d) => d.exercises));
  assert.equal(loaded.plan.version, plan.version);
});

test('pairs: the switch re-pairs the saved plan, the reader knows the words, and the model is told', () => {
  const st0 = freshApp();
  const paired = (plan) => plan.days.reduce((n, d) => n + units(d.exercises).filter((u) => u.length === 2).length, 0);
  assert.equal(paired(st0.plan), 0);
  const mins = st0.plan.days.map((d) => d.estMinutes);
  // Turning it on is one saved setting; the plan follows by itself.
  store.set({ profile: { ...st0.profile, pairs: true } });
  let st = store.getState();
  assert.ok(paired(st.plan) > 0, 'the saved plan has pairs now');
  assert.ok(st.plan.days.every((d, i) => d.estMinutes <= mins[i]) && st.plan.days.some((d, i) => d.estMinutes < mins[i]), 'and its sessions are shorter');
  // A change to the plan keeps the pairs right: take one of a pair out, and its partner is on its own or re-paired by the rules.
  const day = st.plan.days[0];
  const first = units(day.exercises).find((u) => u.length === 2);
  recordUpdate({ mode: 'coach', source: 'rules', changes: [{ id: 'c-rm', exerciseKey: first[0].key, exerciseName: first[0].name, field: 'remove', value: null, from: '', to: '', reason: 'test' }] });
  st = store.getState();
  const left = st.plan.days[0].exercises;
  assert.ok(!left.some((x) => x.key === first[0].key));
  assert.ok(units(left).every((u) => u.length === 1 || (u[0].pair === u[1].pair)), 'no exercise is left pointing at a partner that is gone');
  assert.ok(left.filter((x) => x.pair).every((x) => left.filter((y) => y.pair === x.pair).length === 2));
  // Saved data from before: a profile that asks for pairs and a plan without the marks gains them on load.
  const bare = JSON.parse(JSON.stringify(st));
  for (const d of bare.plan.days) for (const x of d.exercises) delete x.pair;
  assert.ok(paired(hydrate(bare).plan) > 0);
  store.set({ profile: { ...store.getState().profile, pairs: false } });
  assert.equal(paired(store.getState().plan), 0, 'and off again');

  // The built-in reader, and what a model sends back.
  assert.equal(parseProfile('can you superset my exercises to save time').patch.pairs, true);
  assert.equal(parseProfile('pair the exercises please').patch.pairs, true);
  assert.equal(parseProfile('no supersets, one exercise at a time').patch.pairs, false);
  assert.equal(parseProfile('three times a week').patch.pairs, undefined);
  assert.equal(mergeAiProfile(emptyProfile(), { pair_exercises: true }, emptyEquipment()).pairs, true);
  assert.equal(mergeAiProfile({ ...emptyProfile(), pairs: true }, { pair_exercises: null }, emptyEquipment()).pairs, true, 'left alone when the model says nothing');

  // The model: the rules, the switch, and the pairs of the plan and of a workout.
  assert.match(SYSTEM_PROMPT, /\[PAR-1\]/); assert.match(SYSTEM_PROMPT, /\[PAR-2\]/); assert.match(SYSTEM_PROMPT, /pair_exercises/);
  assert.ok('pair_exercises' in OUTPUT_SCHEMA.properties.profile.anyOf[0].properties);
  store.set({ profile: { ...store.getState().profile, pairs: true } });
  st = store.getState();
  const req = JSON.parse(interviewRequest({ profile: st.profile, equipment: st.equipment, plan: st.plan, chat: [], message: 'hi' }));
  assert.equal(req.profile_so_far.pair_exercises, true);
  const dayWithPair = st.plan.days.find((d) => units(d.exercises).some((u) => u.length === 2));
  const sent = req.current_plan.sessions.find((x) => x.session_id === dayWithPair.id).exercises;
  const withMate = sent.find((x) => x.paired_with);
  assert.ok(withMate && sent.some((x) => x.exercise_key === withMate.paired_with && x.paired_with === withMate.exercise_key) && withMate.rest_seconds_in_the_pair >= 30);
  const s = train(dayWithPair.id);
  const after = JSON.parse(sessionRequest({ mode: 'after_session', profile: st.profile, equipment: st.equipment, plan: st.plan, session: s, past: [] }));
  assert.ok(after.session.exercises.some((x) => x.done_in_turns_with), 'a workout says which exercises were done in turns');
  assert.ok(s.exercises.some((x) => x.pair) && s.exercises.every((x) => x.sets.every((y) => y.status === 'done')), 'and a paired workout runs to the end');
});

test('review after a workout: one the model never answered gets the rule-based update, and waits for a connection only when a model is there', () => {
  freshApp();
  // A workout whose review was cut off while the model was thinking: the page was closed.
  let s = startTraining('d1');
  let t = s.startedAt;
  while (s.status === 'active') {
    if (S.needsWeight(s)) s = S.setStartingWeight(s, 20, 2, t);
    s = S.finishSet(S.beginSet(s, t += 1000), t += 1000);
    if (s.phase === 'optional') s = S.endSession(s, t);
  }
  store.putSession(s);
  store.set({ plan: completeDay(store.getState().plan, 'd1') });
  const reps0 = store.getState().plan.days[0].exercises[0].reps;
  const u = store.addUpdate({ mode: 'post_session', source: 'claude', sessionId: s.id, message: '', changes: [], checking: 'claude', pending: false });
  assert.ok(reviewRunning(), 'shown as thinking');
  assert.equal(store.getState().plan.days[0].exercises[0].reps, reps0, 'nothing changes while the model thinks');
  retryPending(); // on the next start, with no model connected any more
  const got = store.getState().proposals.find((p) => p.id === u.id);
  assert.equal(got.source, 'rules'); assert.ok(!got.checking && !got.pending && !reviewRunning());
  assert.match(got.message, /^All \d+ sets done/);
  assert.ok(got.changes.length > 0 && got.changes.every((c) => c.status === 'applied'));
  assert.equal(store.getState().plan.days[0].exercises[0].reps, reps0 + 1, 'the plan is not left without its update');
  assert.equal(reviewSession(s.id).id, u.id, 'and it is not doubled');
  askAgain(u.id); // nobody to ask: it settles again as it was
  const again = store.getState().proposals.find((p) => p.id === u.id);
  assert.ok(!again.pending && !again.checking && again.changes.length === got.changes.length);
  // Weights set by hand before a workout land in the plan, so the walk-through leaves nothing to ask.
  const blank = store.getState().plan.days[1].exercises.find((x) => x.loadType !== 'bodyweight' && !x.load);
  setWeight(blank.exerciseId, blank.loadType, 30, 1.25);
  const filled = store.getState().plan.days[1].exercises.find((x) => x.exerciseId === blank.exerciseId);
  assert.deepEqual(filled.load, { value: 30, step: 1.25 });
});
