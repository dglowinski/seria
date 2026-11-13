// The one prompt Claude gets, the shape of its answer, and the data sent with
// each request. The system text is the same for every request so it can be
// cached; everything that changes goes in the user message.

import { rulesAsText, RULES_VERSION, GOALS, levelFor } from '../domain/rules.js';
import { allExercises, canDo, equipmentList, isAvailable, isListed, PATTERNS, EQUIPMENT, LOADING, machineDetail, machineForExercise } from '../domain/catalog.js';
import { WEEKDAYS, clampMinutes, sessionsPerWeek, cycleWeeks } from '../domain/planner.js';
import { queueState, recommend, timeline, doneGroups, daysBetween } from '../domain/schedule.js';
import { GROUP_OF } from '../domain/catalog.js';

export const SYSTEM_PROMPT = `You are the training coach inside Seria, a gym training app. You build and update one person's resistance-training plan. The plan is a running list, not a calendar: train this, rest so many days, train that. The user works through it on whatever days they can, and it is updated after every workout from what was recorded. Each request names a mode: "interview", "new_plan", "train_now", "in_session", "after_session", "next_run" or "equipment".

Each request gives you what the app has on record: goal and experience, training days and time budget, preferences and limitations, the current equipment list, the current plan, the results of the current session, earlier sessions, and the version of the training rules library. Follow the rules library below; the app's own generator uses the same one. Use only the recorded data you are given. Never assume a result that is not there.

Modes
- interview: read the conversation and the user's latest message. Return the full profile as you now understand it, keeping earlier values unless the user changed them. If something a plan needs is missing (goal, experience, sessions per week, minutes per session), ask one or two specific questions in "questions" and set ready_for_plan to false. Ask once about movements to skip, limitations and favourite exercises if the user has not said. When nothing is missing, set ready_for_plan to true; the app then shows the assumptions and the user confirms. If a plan exists and the user asks to change it, return the change in "changes" instead of a new plan.
- new_plan: build the plan in "plan": the sessions to do, in order, sessions_per_week of them for each of weeks_ahead weeks, each with its week number and rest_days_after, the days of rest before the next one (rests in one week add up to 7 minus the sessions that week). Use only exercise ids from available_exercises. Keep each session within the minutes per session, using the time model in the rules. Give the matching session of every week the same main lifts so they can progress, and let the secondary and accessory exercises take turns, so what did not fit one week is trained the next. Order each session as the rules say. Titles name the body parts, with no weekday and no letter. If a plan truly cannot be built because information is missing, return questions and set plan to null.
- next_run: the user has finished the sessions on the list. Plan the next run in "plan", in the same form as new_plan, from what the records show: keep what is progressing, change what has stalled or was skipped again and again, and keep the main lifts unless the results say otherwise. Say in "message", in one or two sentences, what changes and why.
- train_now: the user wants to train today, and today is not the day the plan had for the next session. You get the list with what is done, skipped and still to do, the recent workouts with dates and sets done per muscle group, the hours since each muscle group was trained, how many days early or late today is, and the pick the app's own rules made. Decide what makes sense today and fill "schedule": first_session_id is the session to do now, from those still to do (stay with the app's pick unless the records give a reason not to); reason is one or two short sentences for the user; order lists the other sessions still to do in the order they should now follow; rest_days gives the days of rest after each of them, starting with today's, in that same order; ease_percent is how much lighter today's loads should be (0 to 20, usually 0; about 10 after ten days or more away). Follow the recovery rules in the library. If the content of later sessions should change because of this, add those as "changes"; otherwise leave changes empty.
- in_session: the user is in the middle of a workout. Compare the sets done so far with their targets and take reps in reserve into account when given. Propose changes only for sets and exercises that are not done yet, using fields "load", "reps" or "rest".
- after_session: compare the plan with what was done, take reps in reserve into account when given, and check the earlier sessions for the same result. Propose updates for the coming sessions in "changes", using fields "load", "reps", "sets", "rest", "exercise" or "remove". If the order of what is left, or the rest days, should change because of this workout, also fill "schedule" as in train_now, with first_session_id as the next session to do; otherwise set schedule to null.

- equipment: the user describes their gym in their own words, as a list or as loose text. Fill "equipment". Put the ids of catalog items the gym has in add_ids, matching by meaning (a "functional trainer" is the cable station). Put catalog items the user says the gym does not have, or that are broken, in unavailable_ids. A strength machine that is not in equipment_catalog goes in "custom" with a short name as written on the machine and the one movement_id from "movements" it trains most. Leave out assisted machines, where a higher setting makes the lift easier. Anything else (cardio machines, things you cannot place) goes in unrecognized, in the user's words. Only list what the user mentioned. Leave profile, plan and changes empty.
  When the user names a maker or a model, as in "these are from Technogym: leg press, chest press", add one entry per such machine to "machines". Its ref is the catalog id you put in add_ids, or the exact name you gave it in custom. Use at most one entry per catalog id; a second branded machine of the same kind goes in custom under its own name. Give the maker and the model as the maker writes them, then say what you know of that exact product: how it works (path of the movement, seat and pad set-up, one arm or two, how it is loaded) and which muscles it isolates. Set sure to true only when you know this exact product. If you are describing the general kind of machine, say so plainly in how_it_works and set sure to false. Never invent a model name or number.

Changes
For each change give the exercise_key exactly as it appears in the plan or session, the field, the new value and a short reason that points at the recorded numbers. new_value is a number: for "load" it is in the exercise's own unit (kg per dumbbell, total kg with the bar, the machine setting, or kg added to bodyweight). For field "exercise" put the replacement's id in new_exercise_id and null in new_value. The app shows the previous value itself. If the results do not justify a change, return an empty list. Do not repeat a change that is listed under already_proposed.

Machines
Equipment and exercises can come with the exact machine behind them: maker, model, how it works, what it isolates and how it is loaded. When that is given, use it: pick and order exercises by what the machine really trains, mention the machine by name when it matters, and read loads the way the machine is loaded (plates the user adds, or a weight stack).

Output
Always fill every field of the output format: use null or an empty list for parts that do not apply to the mode. "message" is for the user: plain English, at most three short sentences, no lists. You are not a doctor: for pain or injury, say to stop and see a professional, and plan around what the user tells you.

${rulesAsText()}`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (items) => ({ type: 'array', items });
const str = (description) => (description ? { type: 'string', description } : { type: 'string' });
const int = { type: 'integer' };

export const OUTPUT_SCHEMA = obj({
  message: str('Short reply for the user. Plain text, at most three short sentences.'),
  questions: list(str()),
  profile: nullable(obj({
    goal: nullable({ type: 'string', enum: Object.keys(GOALS) }),
    months_training: nullable({ type: 'number' }),
    days_per_week: nullable(int),
    weekdays: list({ type: 'string', enum: WEEKDAYS }),
    minutes_per_session: nullable(int),
    preferences: nullable(str()),
    limitations: nullable(str()),
    avoid_exercise_ids: list(str()),
    include_exercise_ids: list(str()),
  })),
  ready_for_plan: { type: 'boolean' },
  plan: nullable(obj({
    days: list(obj({
      week: { type: 'integer', description: 'Which week ahead this session belongs to, starting at 1.' },
      rest_days_after: { type: 'integer', description: 'Days of rest before the next session, 0 to 6.' },
      title: str('Body parts trained, for example "Upper body". No weekday, no letter.'),
      exercises: list(obj({
        exercise_id: str(),
        role: { type: 'string', enum: ['main', 'secondary', 'accessory'] },
        sets: int, rep_low: int, rep_high: int, rest_seconds: int,
      })),
    })),
    notes: list(str()),
  })),
  schedule: nullable(obj({
    first_session_id: str('Id of the session to do next (now, in train_now), from the sessions still to do.'),
    reason: str('One or two short sentences for the user.'),
    order: list(str()),
    rest_days: list(int),
    ease_percent: nullable({ type: 'number' }),
  })),
  equipment: nullable(obj({
    add_ids: list(str()),
    unavailable_ids: list(str()),
    custom: list(obj({ name: str('Short name of the machine.'), movement_id: str('One id from "movements".') })),
    unrecognized: list(str()),
    machines: list(obj({
      ref: str('The catalog id from add_ids, or the exact name of an entry in custom.'),
      vendor: nullable(str('The maker, as the maker writes it.')),
      model: nullable(str('The product line or model name. Null when the user gave none and you do not know it.')),
      how_it_works: str('Two or three plain sentences.'),
      isolates: str('The muscles it trains, main ones first.'),
      loading: { type: 'string', enum: Object.keys(LOADING) },
      notes: nullable(str('Set-up or use notes worth knowing, or null.')),
      sure: { type: 'boolean' },
    })),
  })),
  changes: list(obj({
    exercise_key: str(),
    field: { type: 'string', enum: ['load', 'reps', 'sets', 'rest', 'exercise', 'remove'] },
    new_value: nullable({ type: 'number' }),
    new_exercise_id: nullable(str()),
    reason: str('One or two short sentences based on the recorded numbers.'),
  })),
});

// ---------------------------------------------------------------- request data

const profileOut = (p) => ({
  goal: p.goal, months_training: p.months, experience_level: p.months == null ? null : levelFor(p.months),
  sessions_per_week: p.daysPerWeek || (p.days?.length || null), usual_weekdays_only_a_note: p.days || [],
  minutes_per_session: p.minutes, preferences: p.preferences || null, limitations: p.limitations || null,
  avoid_exercise_ids: p.avoid || [], include_exercise_ids: p.include || [], work_around: p.avoidTags || [],
});

const detailOut = (d) => (!d ? {} : {
  maker: d.vendor || undefined, model: d.model || undefined, how_it_works: d.how || undefined, isolates: d.isolates || undefined,
  loading: d.loading ? LOADING[d.loading] : undefined, notes: d.notes || undefined,
  checked: d.basis === 'web' ? 'found on the web' : d.basis === 'memory' ? 'from the model\'s memory, not checked' : 'maker named by the user only',
});

const equipmentOut = (eq) => equipmentList(eq).filter((x) => isAvailable(eq, x.id)).map((x) => {
  const d = machineDetail(eq, x.id);
  return d ? { name: x.name, ...detailOut(d) } : x.name;
});

const exercisesOut = (eq) => allExercises(eq).filter((x) => canDo(eq, x)).map((x) => {
  const m = machineForExercise(eq, x);
  return {
    id: x.id, name: x.name, movement: PATTERNS[x.pattern] || x.pattern, load_unit: x.load, loads: x.tags,
    ...(m ? { machine: { equipment: m.name, ...detailOut(m) } } : {}),
  };
});

const planOut = (plan) => {
  if (!plan) return null;
  const q = queueState(plan);
  return {
    version: plan.version, minutes_per_session: plan.minutes, sessions_per_week: plan.perWeek,
    list: { done: q.done, skipped: q.skipped, still_to_do_in_order: q.queue.map((d) => d.id) },
    sessions: plan.days.map((d) => ({
      session_id: d.id, title: d.title, estimated_minutes: d.estMinutes, rest_days_after: d.restAfter,
      exercises: d.exercises.map((ex) => ({
        exercise_key: ex.key, exercise_id: ex.exerciseId, name: ex.name, role: ex.tier,
        sets: ex.sets, target_reps: ex.reps, rep_range: [ex.repLo, ex.repHi], rest_seconds: ex.restSec,
        load_unit: ex.loadType, load: ex.load?.value ?? null, load_step: ex.load?.step ?? null,
      })),
    })),
  };
};

const setOut = (st) => ({
  status: st.status,
  planned_reps: st.planned.reps, planned_load: st.planned.load,
  target_reps: st.target.reps, target_load: st.target.load,
  reps: st.actual?.reps ?? null, load: st.actual?.load ?? null, reps_in_reserve: st.actual?.rir ?? null,
});

const sessionOut = (s) => ({
  date: new Date(s.startedAt).toISOString().slice(0, 10), title: s.title, status: s.status,
  minutes_so_far: Math.round(((s.endedAt || s.updatedAt) - s.startedAt) / 60000), budget_minutes: s.budgetMin,
  exercises: s.exercises.map((ex) => ({
    exercise_key: ex.key, exercise_id: ex.exerciseId, name: ex.name, load_unit: ex.loadType, load_step: ex.step,
    rep_range: [ex.repLo, ex.repHi], rest_seconds: ex.restSec,
    swapped_in_for: ex.swappedFrom?.name || null,
    sets: ex.sets.map(setOut),
  })),
});

/** Earlier results for the exercises in this session, newest first, at most 3 each. */
function historyOut(session, past) {
  const ids = new Set(session.exercises.map((x) => x.exerciseId));
  const earlier = past.filter((p) => p.id !== session.id && p.status === 'done' && p.startedAt < session.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);
  const out = {};
  for (const p of earlier) {
    for (const ex of p.exercises) {
      if (!ids.has(ex.exerciseId)) continue;
      const done = ex.sets.filter((st) => st.status === 'done');
      if (!done.length) continue;
      out[ex.exerciseId] = out[ex.exerciseId] || [];
      if (out[ex.exerciseId].length >= 3) continue;
      out[ex.exerciseId].push({
        date: new Date(p.startedAt).toISOString().slice(0, 10),
        sets: ex.sets.map((st) => ({ planned_reps: st.planned.reps, planned_load: st.planned.load, reps: st.actual?.reps ?? null, load: st.actual?.load ?? null, reps_in_reserve: st.actual?.rir ?? null, status: st.status })),
      });
    }
  }
  return out;
}

const body = (mode, data) => JSON.stringify({ mode, rules_version: RULES_VERSION, ...data });

export function interviewRequest({ profile, equipment, plan, chat, message }) {
  const conversation = chat.filter((m) => m.kind !== 'notice' && m.text).slice(-14).map((m) => ({ from: m.role === 'user' ? 'user' : 'coach', text: m.text }));
  return body('interview', {
    profile_so_far: profileOut(profile),
    equipment: equipmentOut(equipment),
    available_exercises: exercisesOut(equipment),
    current_plan: planOut(plan),
    conversation,
    user_message: message,
  });
}

export function newPlanRequest({ profile, equipment, weights }) {
  return body('new_plan', {
    profile: { ...profileOut(profile), sessions_per_week: sessionsPerWeek(profile), weeks_ahead: cycleWeeks(profile), minutes_per_session: clampMinutes(profile.minutes) },
    equipment: equipmentOut(equipment),
    available_exercises: exercisesOut(equipment),
    known_loads: Object.fromEntries(Object.entries(weights || {}).map(([id, w]) => [id, w.value])),
  });
}

export function sessionRequest({ mode, profile, equipment, plan, session, past, alreadyProposed = [] }) {
  return body(mode, {
    profile: profileOut(profile),
    equipment: equipmentOut(equipment),
    available_exercises: mode === 'after_session' ? exercisesOut(equipment) : undefined,
    current_plan: planOut(plan),
    session: sessionOut(session),
    earlier_sessions: historyOut(session, past || []),
    already_proposed: alreadyProposed.map((c) => ({ exercise: c.exerciseName, field: c.field, from: c.from, to: c.to })),
  });
}

export function equipmentRequest({ equipment, text }) {
  return body('equipment', {
    equipment_catalog: EQUIPMENT.map((x) => ({
      id: x.id, name: x.name, always_there_by_default: x.kind === 'basic',
      on_the_list: isListed(equipment, x.id), available: isAvailable(equipment, x.id),
    })),
    own_machines: (equipment.custom || []).map((c) => c.name),
    movements: Object.entries(PATTERNS).map(([id, label]) => ({ id, label })),
    user_text: String(text).slice(0, 4000),
  });
}

// ---------------------------------------------------------------- machine lookup
// A separate, small request that may search the web. Its answer is plain text
// holding a JSON list, read leniently and then checked field by field.

export const LOOKUP_SYSTEM = `You look up gym machines for a training app. You get a list of machines a user's gym has, each with a maker and, when known, a model. For each one, search the web for the maker's own product page, or failing that a retailer or manual for that exact product, and read how the machine works and which muscles it trains.

Reply with only a JSON array, one object per machine you could find, no other text:
[{"ref": "<ref exactly as given>", "vendor": "<maker>", "model": "<model or product line as the maker writes it>", "how_it_works": "<two or three plain sentences: path of the movement, seat and pad set-up, one arm or two, how it is loaded>", "isolates": "<muscles it trains, main ones first>", "loading": "selectorized" | "plate_loaded" | "cable" | "bodyweight" | "other", "notes": "<set-up or use notes worth knowing, or empty>", "source_url": "<the page you took this from, copied exactly from your search results>"}]

Rules: use only what the pages say. Leave a machine out if you cannot find that exact product; do not describe a different one. Never invent a model name or a web address. If you find nothing, reply [].`;

export function lookupRequest(machines) {
  return JSON.stringify({
    task: 'machine_lookup',
    machines: machines.map((m) => ({ ref: m.ref, kind: m.name, vendor: m.vendor || null, model: m.model || null })),
  });
}

/** Pull the JSON list out of a lookup answer. Returns [] when there is none. */
export function parseLookup(text) {
  const t = String(text || '');
  const from = t.indexOf('[');
  const to = t.lastIndexOf(']');
  if (from < 0 || to <= from) return [];
  try {
    const list = JSON.parse(t.slice(from, to + 1));
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object' && typeof x.ref === 'string') : [];
  } catch { return []; }
}

// ---------------------------------------------------------------- train now, and the next run

const recentOut = (sessions, now, n = 10) => sessions.filter((x) => x.status === 'done' && x.startedAt <= now)
  .sort((a, b) => b.startedAt - a.startedAt).slice(0, n).map((x) => ({
    date: new Date(x.startedAt).toISOString().slice(0, 10), days_ago: daysBetween(x.startedAt, now),
    title: x.title, sets_done_by_muscle_group: doneGroups(x), planned_rest_days_after: x.restAfter ?? null, eased_percent: x.easePct || 0,
  }));

/** Everything the model needs to judge what to train today. */
export function trainNowRequest({ profile, equipment, plan, sessions, now = Date.now(), pick }) {
  const done = sessions.filter((x) => x.status === 'done' && x.startedAt <= now).sort((a, b) => b.startedAt - a.startedAt);
  const hours = {};
  for (const x of done) for (const name of Object.keys(doneGroups(x))) if (!(name in hours)) hours[name] = Math.round((now - x.startedAt) / 3600e3);
  const d = new Date(now);
  return body('train_now', {
    today: { date: d.toISOString().slice(0, 10), weekday: WEEKDAYS[(d.getDay() + 6) % 7] },
    days_off_plan: pick ? pick.offBy : 0, // below zero: earlier than planned; above: later
    profile: profileOut(profile),
    equipment: equipmentOut(equipment),
    current_plan: planOut(plan),
    recent_workouts: recentOut(sessions, now),
    hours_since_muscle_group_was_trained: hours,
    workouts_in_last_7_days: done.filter((x) => now - x.startedAt < 7 * 24 * 3600e3).length,
    app_pick: pick ? { session_id: pick.dayId, reason: pick.reason, notes: pick.notes, order_after_today: pick.order.slice(1), ease_percent: pick.easePct } : null,
  });
}

/** The run is finished: ask for the next one, with the results so far. */
export function nextRunRequest({ profile, equipment, plan, sessions, weights, now = Date.now() }) {
  const results = {};
  for (const x of sessions.filter((y) => y.status === 'done').sort((a, b) => b.startedAt - a.startedAt).slice(0, 12)) {
    for (const ex of x.exercises) {
      const done = ex.sets.filter((st) => st.status === 'done');
      const list = (results[ex.exerciseId] = results[ex.exerciseId] || []);
      if (list.length >= 3) continue;
      list.push({ date: new Date(x.startedAt).toISOString().slice(0, 10), planned: `${ex.sets.length} x ${ex.sets[0].planned.reps}`, planned_load: ex.sets[0].planned.load, reps: done.map((st) => st.actual.reps), load: done.map((st) => st.actual.load), skipped_sets: ex.sets.length - done.length });
    }
  }
  return body('next_run', {
    profile: { ...profileOut(profile), sessions_per_week: sessionsPerWeek(profile), weeks_ahead: cycleWeeks(profile), minutes_per_session: clampMinutes(profile.minutes) },
    equipment: equipmentOut(equipment),
    available_exercises: exercisesOut(equipment),
    run_just_finished: planOut(plan),
    recent_workouts: recentOut(sessions, now, 12),
    results_by_exercise: results,
    known_loads: Object.fromEntries(Object.entries(weights || {}).map(([id, w]) => [id, w.value])),
  });
}

export { recommend, timeline };
