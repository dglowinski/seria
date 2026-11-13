// The one prompt Claude gets, the shape of its answer, and the data sent with
// each request. The system text is the same for every request so it can be
// cached; everything that changes goes in the user message.

import { rulesAsText, RULES_VERSION, GOALS, levelFor } from '../domain/rules.js';
import { allExercises, canDo, equipmentList, isAvailable, isListed, PATTERNS, EQUIPMENT } from '../domain/catalog.js';
import { WEEKDAYS, trainingDays, clampMinutes } from '../domain/planner.js';

export const SYSTEM_PROMPT = `You are the training coach inside Seria, a gym training app. You build and update one person's weekly resistance-training plan. Each request names a mode: "interview", "new_plan", "in_session", "after_session" or "equipment".

Each request gives you what the app has on record: goal and experience, training days and time budget, preferences and limitations, the current equipment list, the current plan, the results of the current session, earlier sessions, and the version of the training rules library. Follow the rules library below; the app's own generator uses the same one. Use only the recorded data you are given. Never assume a result that is not there.

Modes
- interview: read the conversation and the user's latest message. Return the full profile as you now understand it, keeping earlier values unless the user changed them. If something a plan needs is missing (goal, experience, days per week or named weekdays, minutes per session), ask one or two specific questions in "questions" and set ready_for_plan to false. Ask once about movements to skip, limitations and favourite exercises if the user has not said. When nothing is missing, set ready_for_plan to true; the app then shows the assumptions and the user confirms. If a plan exists and the user asks to change it, return the change in "changes" instead of a new plan.
- new_plan: build the week in "plan". Use only exercise ids from available_exercises. Respect the weekdays and the minutes per session, using the time model in the rules. Order each day as the rules say. If a plan truly cannot be built because information is missing, return questions and set plan to null.
- in_session: the user is in the middle of a workout. Compare the sets done so far with their targets and take reps in reserve into account when given. Propose changes only for sets and exercises that are not done yet, using fields "load", "reps" or "rest".
- after_session: compare the plan with what was done, take reps in reserve into account when given, and check the earlier sessions for the same result. Propose updates for the coming sessions, using fields "load", "reps", "sets", "rest", "exercise" or "remove".

- equipment: the user describes their gym in their own words, as a list or as loose text. Fill "equipment". Put the ids of catalog items the gym has in add_ids, matching by meaning (a "functional trainer" is the cable station). Put catalog items the user says the gym does not have, or that are broken, in unavailable_ids. A strength machine that is not in equipment_catalog goes in "custom" with a short name as written on the machine and the one movement_id from "movements" it trains most. Leave out assisted machines, where a higher setting makes the lift easier. Anything else (cardio machines, things you cannot place) goes in unrecognized, in the user's words. Only list what the user mentioned. Leave profile, plan and changes empty.

Changes
For each change give the exercise_key exactly as it appears in the plan or session, the field, the new value and a short reason that points at the recorded numbers. new_value is a number: for "load" it is in the exercise's own unit (kg per dumbbell, total kg with the bar, the machine setting, or kg added to bodyweight). For field "exercise" put the replacement's id in new_exercise_id and null in new_value. The app shows the previous value itself. If the results do not justify a change, return an empty list. Do not repeat a change that is listed under already_proposed.

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
      weekday: { type: 'string', enum: WEEKDAYS },
      title: str('Body parts trained, for example "Upper body".'),
      exercises: list(obj({
        exercise_id: str(),
        role: { type: 'string', enum: ['main', 'secondary', 'accessory'] },
        sets: int, rep_low: int, rep_high: int, rest_seconds: int,
      })),
    })),
    notes: list(str()),
  })),
  equipment: nullable(obj({
    add_ids: list(str()),
    unavailable_ids: list(str()),
    custom: list(obj({ name: str('Short name of the machine.'), movement_id: str('One id from "movements".') })),
    unrecognized: list(str()),
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
  days_per_week: p.daysPerWeek || (p.days?.length || null), weekdays: p.days || [],
  minutes_per_session: p.minutes, preferences: p.preferences || null, limitations: p.limitations || null,
  avoid_exercise_ids: p.avoid || [], include_exercise_ids: p.include || [], work_around: p.avoidTags || [],
});

const equipmentOut = (eq) => equipmentList(eq).filter((x) => isAvailable(eq, x.id)).map((x) => x.name);

const exercisesOut = (eq) => allExercises(eq).filter((x) => canDo(eq, x)).map((x) => ({
  id: x.id, name: x.name, movement: PATTERNS[x.pattern] || x.pattern, load_unit: x.load, loads: x.tags,
}));

const planOut = (plan) => (!plan ? null : {
  version: plan.version, minutes_per_session: plan.minutes,
  days: plan.days.map((d) => ({
    weekday: d.weekday, title: d.title, estimated_minutes: d.estMinutes,
    exercises: d.exercises.map((ex) => ({
      exercise_key: ex.key, exercise_id: ex.exerciseId, name: ex.name, role: ex.tier,
      sets: ex.sets, target_reps: ex.reps, rep_range: [ex.repLo, ex.repHi], rest_seconds: ex.restSec,
      load_unit: ex.loadType, load: ex.load?.value ?? null, load_step: ex.load?.step ?? null,
    })),
  })),
});

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
    profile: { ...profileOut(profile), weekdays: trainingDays(profile), minutes_per_session: clampMinutes(profile.minutes) },
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
