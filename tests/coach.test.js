import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, mergeProfile, mergeAiProfile } from '../js/ai/coach.js';
import { mergeStates } from '../js/cloud.js';
import { tidy, sourceName } from '../js/ai/ai.js';
import { openaiParams } from '../js/ai/openai.js';
import { providerSays, ROOM } from '../js/ai/errors.js';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, LOOKUP_SYSTEM, interviewRequest, newPlanRequest, sessionRequest, equipmentRequest, lookupRequest, parseLookup } from '../js/ai/prompts.js';
import { emptyProfile, generatePlan, missingFields } from '../js/domain/planner.js';
import { emptyEquipment, parseEquipmentText, applyEquipmentRead, applyMachineLookup, machineDetail, machineForExercise, machineLabel, isAvailable, isListed, EQUIPMENT, allExercises } from '../js/domain/catalog.js';
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
