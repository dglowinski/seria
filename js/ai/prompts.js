// The one prompt Claude gets, the shape of its answer, and the data sent with
// each request. The system text is the same for every request so it can be
// cached; everything that changes goes in the user message.

import { rulesAsText, RULES_VERSION, GOALS, levelFor, ACTIVITIES, activityGroups } from '../domain/rules.js';
import { allExercises, canDo, equipmentList, isAvailable, isListed, PATTERNS, EQUIPMENT, LOADING, machineDetail, machineForExercise } from '../domain/catalog.js';
import { WEEKDAYS, clampMinutes, sessionsPerWeek, cycleWeeks, dayOptional, pairMate, pairRestSec, weeklySets } from '../domain/planner.js';
import { queueState, recommend, plannedNext, timeline, doneGroups, dayGroups, daysBetween, cycleNext } from '../domain/schedule.js';
import { GROUP_OF, SKETCH_IDS, MAIN_GROUPS } from '../domain/catalog.js';

export const SYSTEM_PROMPT = `You are the training coach inside Seria, a gym training app. You build and update one person's resistance-training plan. The plan is a running list, not a calendar: train this, rest so many days, train that. The user works through it on whatever days they can, and it is updated after every workout from what was recorded. Each request names a mode: "interview", "new_plan", "train_now", "in_session", "after_session", "activity", "next_run" or "equipment".

Each request gives you what the app has on record: goal and experience, training days and time budget, preferences and limitations, the current equipment list, the current plan, today's date, the recent workouts with what was planned and what was done in each, the results of the current session, and the version of the training rules library. Follow the rules library below; the app's own generator uses the same one. Use only the recorded data you are given. Never assume a result that is not there.

Preferences, and who decides
The profile holds the user's settings: goal, sessions per week, minutes per session, weeks ahead, supersets, exercises to skip or to keep. They are the user's preferences, and you are the coach: you decide what the training is. Weigh the settings together with what the user says in the conversation and with what the records show (how often they really train, how long their sessions really take, what moves forward, what gets skipped, how hard the sets were), draw your own conclusions, and build what will work for this person. Stay with a setting unless you have a reason to leave it. When you do leave one, say which and why in "message", in plain words. Two things are not yours to bend: use only exercises from available_exercises, and never plan a movement the user asked to avoid or that a stated limitation rules out.

Modes
- interview: read the conversation and the user's latest message. You also get today's date, the recent workouts exercise by exercise, the hours since each muscle group was trained, other activities, and the session the app has next: use them to answer questions about the training and to judge what the user asks for, and never say you cannot see the history when it is there. Return the full profile as you now understand it, keeping earlier values unless the user changed them. If something a plan needs is missing (goal, experience, sessions per week, minutes per session), ask one or two specific questions in "questions" and set ready_for_plan to false. Ask once about movements to skip, limitations and favourite exercises if the user has not said. When nothing is missing, set ready_for_plan to true; the app then shows the assumptions and the user confirms. If a plan exists and the user asks to change it, return the change in "changes" instead of a new plan; say in "message" what you changed. If a plan exists and the user asks for a new one (regenerate it, rebuild it, plan it again, start over), set rebuild_plan to true and say in "message", in one sentence, what the new plan will take into account; the app then builds it at once in new_plan mode, with this conversation and the records. When the user changes something the plan is built on (the goal, sessions per week, minutes, supersets on or off, exercises to skip), or asks for something single changes cannot do, return it in the profile and set rebuild_plan to true as well. The plan is updated from the chat alone: there is no button for the user to press, and the app keeps the old plan so it can be put back. Nothing else changes the plan, so never say it was changed or rebuilt unless you returned changes or set rebuild_plan. Leave "plan" null in this mode.
- new_plan: build the plan in "plan": the sessions to do, in order, sessions_per_week of them for each of weeks_ahead weeks, each with its week number and rest_days_after, the days of rest before the next one (rests in one week add up to 7 minus the sessions that week). Use only exercise ids from available_exercises. Keep each session within the minutes per session, using the time model in the rules; the app cuts a session back only when it runs more than a tenth over. Give the matching session of every week the same main lifts so they can progress, and let the secondary and accessory exercises take turns, so what did not fit one week is trained the next. Order each session as the rules say. Titles name the body parts, with no weekday and no letter. Give every session its optional_exercises as described under Optional extras. Fill "outlook" as described under The long view. If a plan truly cannot be built because information is missing, return questions and set plan to null.
  When recent_workouts has entries, the user is already training and this plan takes the place of plan_being_replaced: carry on from the records, do not start over. Start the plan where the cycle stands, which where_the_cycle_stands says outright: last_workout is what was trained last, next_in_the_cycle is the session of the old plan that comes next by the records, and muscle_groups_rested_longest_first lists what has waited longest. The first session of the new plan is the counterpart of next_in_the_cycle, a session for the same parts of the body; when the split changes, or next_in_the_cycle is null, it is a session built on the muscle groups that have rested longest. It is never a session like last_workout while another kind of session exists: after an upper-body workout the plan opens with the lower-body session. The other sessions follow in their usual order from there, so the one most like last_workout comes last in its week. Keep the exercises the user is already doing: for each movement use the exercise from plan_being_replaced or recent_workouts when it is still available and still fits, so its weight in known_loads carries over. Bring in a different exercise only for a reason the records or the conversation give (it stalled, it was skipped again and again, its equipment is gone, the user asked); an exercise with no known load starts from nothing, so never swap one for variety alone. The conversation shows why the user asked for a new plan; build what they asked for. When rebuild_reason is given, the review of the last workout asked for this rebuild, in those words: build the plan that reason calls for. Then say in "message", in one or two sentences, what is different from the plan before and why the first session is the one it is.
- next_run: the user has finished the sessions on the list. Plan the next run in "plan", in the same form as new_plan, from what the records show: keep what is progressing, change what has stalled or was skipped again and again, and keep the main lifts unless the results say otherwise. Say in "message", in one or two sentences, what changes and why, and fill "outlook" again for the round ahead.
- train_now: the user wants to train today, and today is not the day the plan had for the next session. You get the list with what is done, skipped and still to do, the recent workouts with dates and sets done per muscle group, the hours since each muscle group was trained, how many days early or late today is, and the pick the app's own rules made. Decide what makes sense today and fill "schedule": first_session_id is the session to do now, from those still to do (stay with the app's pick unless the records give a reason not to); reason is one or two short sentences for the user; order lists the other sessions still to do in the order they should now follow; rest_days gives the days of rest after each of them, starting with today's, in that same order; ease_percent is how much lighter today's loads should be (0 to 20, usually 0; about 10 after ten days or more away). Follow the recovery rules in the library. If the content of later sessions should change because of this, add those as "changes"; otherwise leave changes empty.
- in_session: the user is in the middle of a workout. Compare the sets done so far with their targets and take reps in reserve into account when given. Return changes only for sets and exercises that are not done yet, using fields "load", "reps" or "rest". Changes listed under already_applied were made by the app's own rules a moment ago: return a change for the same exercise and field only when you would set a different value; yours then replaces it.
- after_session: the user has just finished a workout. Do two things, in this order.
  First, this workout. Compare the plan with what was done, take reps in reserve into account when given, and check the earlier sessions for the same result. Each set comes with how long it took and how long the rest before it really was; use that when it explains a result (a missed set after a short rest is not a reason to lower the load).
  Second, the whole plan. After every workout the rest of the plan is thought through again in the light of all the records, not only the exercises just done. Go through every session in current_plan, one by one, and ask whether it is still the right thing to do next. Does each exercise still earn its place: one that was skipped, dropped, put off or swapped out again and again does not, and one the user keeps adding by hand does. Are the sets for each muscle group over a week in range (weekly_sets_in_the_plan, against the sets really done in recent_workouts). Do the sessions fit the time the user really takes. Does a result seen today also say something about other exercises for the same muscles in other sessions. Do the order and the rest days still fit the days the user really trains. Has anything said in the conversation not reached the plan yet. Make every change that follows, in any session, through "changes", using fields "load", "reps", "sets", "rest", "exercise" (swap one for another), "remove", or "add" (a new exercise in a session: exercise_key names the exercise of that session it comes after, new_exercise_id is the exercise to add, new_value its number of sets). When the plan needs more than such changes, a different split or sessions built differently, set rebuild_plan to true and say why in "message": the app then builds a new plan from the records at once, and the user can put the old one back. That is rare. It is just as right when this look changes nothing beyond new weights and reps: a plan that is working is left as it is, and you say so. Never change something only to have changed something.
  If the order of what is left, or the rest days, should change because of this workout, also fill "schedule" as in train_now, with first_session_id as the next session to do; otherwise set schedule to null. "message" is the summary the user reads right after the workout: in three to five short sentences say how it went against the plan, what you changed for next time and why, what the look at the whole plan came to (what else you changed, or that the rest stands as it is), and one thing to focus on.
- activity: the user logged something done outside the gym plan: a run, a ride, a game, with its minutes and effort. You get it with the recent workouts and activities and the list of what is still to do. Decide whether the order of the sessions still to do or the rest days should change because of it, following the recovery rules, and fill "schedule" as in train_now (first_session_id is the next session to do); set schedule to null when nothing should move. Say in "message", in one or two sentences, what it means for the plan. Leave changes empty unless the content of a session must change.

- equipment: the user describes their gym in their own words, as a list or as loose text. Fill "equipment". Put the ids of catalog items the gym has in add_ids, matching by meaning (a "functional trainer" is the cable station). Put catalog items the user says the gym does not have, or that are broken, in unavailable_ids. A strength machine that is not in equipment_catalog goes in "custom" with a short name as written on the machine and the one movement_id from "movements" it trains most. Leave out assisted machines, where a higher setting makes the lift easier. Anything else (cardio machines, things you cannot place) goes in unrecognized, in the user's words. Only list what the user mentioned. Leave profile, plan and changes empty.
  When the user names a maker or a model, as in "these are from Technogym: leg press, chest press", add one entry per such machine to "machines". Its ref is the catalog id you put in add_ids, or the exact name you gave it in custom. Use at most one entry per catalog id; a second branded machine of the same kind goes in custom under its own name. A machine that is a variant of a catalog item, such as an iso-lateral, plate-loaded or incline version, also goes in custom under its own name when the gym has it next to the plain one or when the user names it that way, so both can be used and each keeps its own weights. Give the maker and the model as the maker writes them, then say what you know of that exact product: how it works (path of the movement, seat and pad set-up, one arm or two, how it is loaded) and which muscles it isolates. Pick in looks_like the drawing closest to the machine's general look (the names are kinds of equipment; use "machine" when none fits). Set sure to true only when you know this exact product. If you are describing the general kind of machine, say so plainly in how_it_works and set sure to false. Never invent a model name or number.

Changes
The app makes your changes at once, without asking, and shows each one to the user with its reason; the user can undo or correct any of them. So return only changes the records support, and write each reason so it stands on its own. For each change give the exercise_key exactly as it appears in the plan or session, the field, the new value and a short reason that points at the recorded numbers. new_value is a number: for "load" it is in the exercise's own unit (kg per dumbbell, total kg with the bar, the machine setting, or kg added to bodyweight). For field "exercise" put the replacement's id in new_exercise_id and null in new_value. The app shows the previous value itself. If the results do not justify a change, return an empty list.

Machines
Equipment and exercises can come with the exact machine behind them: maker, model, how it works, what it isolates and how it is loaded. When that is given, use it: pick and order exercises by what the machine really trains, mention the machine by name when it matters, and read loads the way the machine is loaded (plates the user adds, or a weight stack).

Optional extras
Each session can list up to two optional exercises that the user may add at the end on a day with time and energy left (rule OPT-1). In new_plan and next_run fill optional_exercises for every session. Pick what makes sense for that session and for the plan as a whole, from the same part of the body the session trains, so it does not tire what the next session needs fresh: first what you had to leave out of that session for time, then a muscle group that is short of its weekly sets, then a small muscle group with no direct work. Give each 2 sets, do not count them in the session's minutes, never repeat an exercise that is already in that session, and say in "why", in one short sentence for the user, why it fits. In a plan you are given they are listed per session under optional_at_the_end; you can change one through "changes" by its exercise_key, like any other exercise. In a session, an exercise marked optional_extra is one the user chose to add; read its results like any other. An optional exercise that was not done is not a miss and is never a reason for a change. An exercise or a set marked added_by_hand was added by the user during the workout, on top of the plan: it is extra work that counts toward the week's sets and toward recovery, it is never judged against the plan, and a short extra set is not a reason to lower anything. When the user keeps adding the same thing, that tells you what they want more of.

Supersets (pairs)
Some people do not like sitting around between sets: they would rather do a set of something else while a muscle rests. That is the superset mode (rules PAR-1, PAR-2 and PAR-3), on when the profile says pair_exercises. The app calls a pair of exercises done in turns a superset when it talks to the user; use that word in messages. Two neighbouring exercises of a session that use different muscles are then done in turns, with a short rest after each set, which also makes the session shorter for the same sets. When it is on, build the plan for it in new_plan and next_run, do not just leave pairs to chance. Split the week into sessions that hold opposite muscle groups, such as upper-body and lower-body days or full-body days, not push-only and pull-only days where hardly anything has a partner, unless the user asked for such a split. In each session give every exercise a partner that uses different muscles and put the two next to each other, opposite muscles first: a press next to a row, a pulldown next to an overhead press, biceps next to triceps, leg extension next to leg curl, calves next to core work. Choose the exercises with their partners in mind, so that few are left alone. The plan must still make sense as training: the order rules hold, squats and hip hinges stay on their own with their full rest, and so do the main lifts of a strength plan, and two exercises that share a muscle are never neighbours meant as a pair. Count the time by PAR-2, so the time saved can go to exercises that would otherwise be left out. You choose the supersets yourself: in new_plan and next_run set superset_with_next to true on the first exercise of each superset, and the app does the two in turns as you marked them. A superset is two neighbouring exercises, never a chain of three. With supersets off in the profile, leave every superset_with_next false. In a plan you are given, a superset shows as paired_with, and in a session as done_in_turns_with. In a session, the rest before a set of a paired exercise is the short one after the other exercise's set; that is as planned, not a rest cut short. In the interview, set pair_exercises to true when the user asks for supersets, or to alternate or pair exercises, or says they do not like waiting around between sets; to false when they ask to stop; otherwise return the value you were given. If the user has not said either way, ask about it once, together with the question about movements to skip.

The long view
In new_plan and next_run, fill "outlook": four to six plain sentences for the user on how this training develops over the next two to three months. Say what this round focuses on, how the loads and reps are meant to move, how long a round is and what changes from one round to the next, and which exercises or extra sets you would add later or with more time. Base it on the profile and the rules; promise no numbers the records cannot support. In every other mode set outlook to null.

Output
Always fill every field of the output format: use null or an empty list for parts that do not apply to the mode. "message" is for the user: plain English, at most three short sentences (four in after_session), no lists. You are not a doctor: for pain or injury, say to stop and see a professional, and plan around what the user tells you.

${rulesAsText()}`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (items) => ({ type: 'array', items });
const str = (description) => (description ? { type: 'string', description } : { type: 'string' });
const int = { type: 'integer' };

export const OUTPUT_SCHEMA = obj({
  message: str('Short reply for the user. Plain text, at most three short sentences; in after_session the summary of the workout, up to four.'),
  questions: list(str()),
  profile: nullable(obj({
    goal: nullable({ type: 'string', enum: Object.keys(GOALS) }),
    months_training: nullable({ type: 'number' }),
    days_per_week: nullable(int),
    weekdays: list({ type: 'string', enum: WEEKDAYS }),
    minutes_per_session: nullable(int),
    pair_exercises: nullable({ type: 'boolean', description: 'True when the user wants exercises that use different muscles done in turns to save time.' }),
    preferences: nullable(str()),
    limitations: nullable(str()),
    avoid_exercise_ids: list(str()),
    include_exercise_ids: list(str()),
  })),
  ready_for_plan: { type: 'boolean' },
  rebuild_plan: { type: 'boolean', description: 'interview: true when a plan exists and the user asks for a new one. after_session: true when, after thinking the whole plan through, it should be built anew, which is rare. The app then builds it at once. False in every other case.' },
  plan: nullable(obj({
    days: list(obj({
      week: { type: 'integer', description: 'Which week ahead this session belongs to, starting at 1.' },
      rest_days_after: { type: 'integer', description: 'Days of rest before the next session, 0 to 6.' },
      title: str('Body parts trained, for example "Upper body". No weekday, no letter.'),
      exercises: list(obj({
        exercise_id: str(),
        role: { type: 'string', enum: ['main', 'secondary', 'accessory'] },
        sets: int, rep_low: int, rep_high: int, rest_seconds: int,
        superset_with_next: { type: 'boolean', description: 'True when this exercise and the next one in the list are done in turns as a superset. False for the second of the two and for every exercise done on its own.' },
      })),
      optional_exercises: list(obj({
        exercise_id: str(),
        sets: int, rep_low: int, rep_high: int, rest_seconds: int,
        why: str('One short sentence for the user: why this fits the session and the plan.'),
      })),
    })),
    notes: list(str()),
  })),
  outlook: nullable(str('new_plan and next_run only: four to six plain sentences on how the training develops from here. Null in other modes.')),
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
      looks_like: { type: 'string', enum: SKETCH_IDS, description: 'The drawing that is closest to how the machine looks.' },
      notes: nullable(str('Set-up or use notes worth knowing, or null.')),
      sure: { type: 'boolean' },
    })),
  })),
  changes: list(obj({
    exercise_key: str('The exercise in the plan that changes. For "add": the exercise of the session that the new one comes after.'),
    field: { type: 'string', enum: ['load', 'reps', 'sets', 'rest', 'exercise', 'remove', 'add'] },
    new_value: nullable({ type: 'number', description: 'The new number for load, reps, sets or rest. For "add": the number of sets, or null for the usual number.' }),
    new_exercise_id: nullable(str('For "exercise" and "add": the id of the exercise that comes in.')),
    reason: str('One or two short sentences based on the recorded numbers.'),
  })),
});

// ---------------------------------------------------------------- request data

const profileOut = (p) => ({
  goal: p.goal, months_training: p.months, experience_level: p.months == null ? null : levelFor(p.months),
  sessions_per_week: p.daysPerWeek || (p.days?.length || null), usual_weekdays_only_a_note: p.days || [],
  minutes_per_session: p.minutes, pair_exercises: !!p.pairs, preferences: p.preferences || null, limitations: p.limitations || null,
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
        ...(pairMate(d.exercises, ex) ? { paired_with: pairMate(d.exercises, ex).key, rest_seconds_in_the_pair: pairRestSec(ex, pairMate(d.exercises, ex)) } : {}),
      })),
      // Not part of the session's time: the user may add these at the end.
      optional_at_the_end: dayOptional(d).map((ex) => ({
        exercise_key: ex.key, exercise_id: ex.exerciseId, name: ex.name, sets: ex.sets, target_reps: ex.reps, rep_range: [ex.repLo, ex.repHi],
        rest_seconds: ex.restSec, load_unit: ex.loadType, load: ex.load?.value ?? null, why: ex.why || null,
      })),
    })),
  };
};

const setOut = (st) => ({
  status: st.status, ...(st.extra ? { added_by_hand: true } : {}),
  planned_reps: st.planned.reps, planned_load: st.planned.load,
  target_reps: st.target.reps, target_load: st.target.load,
  reps: st.actual?.reps ?? null, load: st.actual?.load ?? null, reps_in_reserve: st.actual?.rir ?? null,
  // Timing, as recorded: how long the set took and how long the rest before it really was.
  seconds_under_load: st.actual?.seconds ?? null, rest_before_seconds: st.restBeforeSec ?? null,
});

const sessionOut = (s) => ({
  date: new Date(s.startedAt).toISOString().slice(0, 10), title: s.title, status: s.status,
  minutes_so_far: Math.round(((s.endedAt || s.updatedAt) - s.startedAt) / 60000), budget_minutes: s.budgetMin,
  exercises: s.exercises.map((ex) => ({
    exercise_key: ex.key, exercise_id: ex.exerciseId, name: ex.name, load_unit: ex.loadType, load_step: ex.step,
    rep_range: [ex.repLo, ex.repHi], rest_seconds: ex.restSec,
    swapped_in_for: ex.swappedFrom?.name || null,
    put_off_until_later: !!ex.postponed, dropped_for_today: !!ex.dropped, optional_extra: !!ex.optional, added_by_hand: !!ex.added,
    done_in_turns_with: (ex.pair && s.exercises.find((x) => x !== ex && x.pair === ex.pair)?.name) || null,
    sets: ex.sets.map(setOut),
  })),
  // Optional extras offered with this session that the user did not take. Not a miss.
  optional_extras_not_taken: (s.optional || []).filter((o) => !s.exercises.some((x) => x.key === o.key)).map((o) => o.name),
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

const conversationOut = (chat, n) => (chat || []).filter((m) => m.kind !== 'notice' && m.text).slice(-n).map((m) => ({ from: m.role === 'user' ? 'user' : 'coach', text: m.text }));
const loadsOut = (weights) => Object.fromEntries(Object.entries(weights || {}).map(([id, w]) => [id, w.value]));

/** One recorded workout, exercise by exercise: what was planned and what was done. */
const workoutOut = (x, now) => ({
  date: new Date(x.startedAt).toISOString().slice(0, 10), days_ago: daysBetween(x.startedAt, now), title: x.title,
  minutes: Math.round(((x.endedAt || x.updatedAt || x.startedAt) - x.startedAt) / 60000),
  sets_done_by_muscle_group: doneGroups(x), planned_rest_days_after: x.restAfter ?? null, eased_percent: x.easePct || 0,
  exercises: x.exercises.map((ex) => {
    const done = ex.sets.filter((st) => st.status === 'done');
    const own = ex.sets.filter((st) => !st.extra); // sets the plan asked for; the rest were added by hand
    const extra = done.filter((st) => st.extra).length;
    return {
      exercise_id: ex.exerciseId, name: ex.name, planned: `${own.length} x ${ex.sets[0]?.planned.reps ?? '?'}`, planned_load: ex.sets[0]?.planned.load ?? null,
      reps: done.map((st) => st.actual.reps), load: done.map((st) => st.actual.load), skipped_sets: own.filter((st) => st.status !== 'done').length,
      ...(extra ? { extra_sets_added_by_hand: extra } : {}), ...(ex.added ? { added_by_hand: true } : {}),
    };
  }),
});

/**
 * Where the training stands today: the last workouts in full, how long each
 * muscle group has rested, and what else was done. It goes with every request
 * that talks about the plan or builds one, so neither starts from nothing.
 */
function trainingOut(sessions, now, n = 8) {
  const done = (sessions || []).filter((x) => gym(x) && x.startedAt <= now).sort((a, b) => b.startedAt - a.startedAt);
  const hours = {};
  for (const x of done) for (const name of Object.keys(doneGroups(x))) if (!(name in hours)) hours[name] = Math.round((now - x.startedAt) / 3600e3);
  const d = new Date(now);
  return {
    today: { date: d.toISOString().slice(0, 10), weekday: WEEKDAYS[(d.getDay() + 6) % 7] },
    workouts_on_record: done.length,
    recent_workouts: done.slice(0, n).map((x) => workoutOut(x, now)), // newest first
    hours_since_muscle_group_was_trained: hours,
    workouts_in_last_7_days: done.filter((x) => now - x.startedAt < 7 * 24 * 3600e3).length,
    other_activities: activitiesOut(sessions || [], now),
  };
}

/**
 * Where the cycle stands, said outright for a plan that is about to be built:
 * what was trained last, which session of the old plan follows it by the
 * records, and which muscle groups have waited longest.
 */
function cycleOut(plan, sessions, now) {
  const done = (sessions || []).filter((x) => gym(x) && x.startedAt <= now && Object.keys(doneGroups(x)).length).sort((a, b) => b.startedAt - a.startedAt);
  if (!done.length) return null;
  const hours = {};
  for (const x of done) for (const name of Object.keys(doneGroups(x))) if (!(name in hours)) hours[name] = (now - x.startedAt) / 3600e3;
  const i = plan ? cycleNext(plan, sessions, now) : -1;
  const next = i >= 0 ? plan.days[i] : null;
  return {
    last_workout: { title: done[0].title, days_ago: daysBetween(done[0].startedAt, now), trained: Object.keys(doneGroups(done[0])) },
    workouts_newest_first: done.slice(0, 6).map((x) => ({ title: x.title, days_ago: daysBetween(x.startedAt, now) })),
    next_in_the_cycle: next ? { title: next.title, trains: Object.keys(dayGroups(next)) } : null,
    // Never trained comes first, then the longest wait.
    muscle_groups_rested_longest_first: [...MAIN_GROUPS].sort((a, b) => (hours[b] ?? Infinity) - (hours[a] ?? Infinity)),
  };
}

/** What the app has next on the list, and when. */
function nextOut(plan, sessions, now) {
  const next = plan ? plannedNext(plan, sessions || [], now) : null;
  if (!next) return null;
  return { session_id: next.dayId, title: next.title, due_in_days: Math.max(daysBetween(now, next.dueAt), 0), why: next.reason };
}

export function interviewRequest({ profile, equipment, plan, chat, message, sessions = [], weights = {}, now = Date.now() }) {
  return body('interview', {
    profile_so_far: profileOut(profile),
    equipment: equipmentOut(equipment),
    available_exercises: exercisesOut(equipment),
    current_plan: planOut(plan),
    next_session: nextOut(plan, sessions, now),
    ...trainingOut(sessions, now, 6),
    known_loads: loadsOut(weights),
    conversation: conversationOut(chat, 14),
    user_message: message,
  });
}

/**
 * A plan from the profile. When the user is already training, the records, the
 * plan it replaces and the conversation go along, so the new plan carries on
 * from them and does what was asked.
 */
export function newPlanRequest({ profile, equipment, weights, plan = null, sessions = [], chat = [], now = Date.now(), why = '' }) {
  return body('new_plan', {
    profile: { ...profileOut(profile), sessions_per_week: sessionsPerWeek(profile), weeks_ahead: cycleWeeks(profile), minutes_per_session: clampMinutes(profile.minutes) },
    equipment: equipmentOut(equipment),
    available_exercises: exercisesOut(equipment),
    known_loads: loadsOut(weights),
    ...trainingOut(sessions, now),
    where_the_cycle_stands: cycleOut(plan, sessions, now),
    plan_being_replaced: planOut(plan),
    conversation: conversationOut(chat, 8),
    ...(why ? { rebuild_reason: why } : {}),
  });
}

/** Sets a week for each muscle group as the plan has them, with the range the rules ask for. */
function weeklySetsOut(plan) {
  if (!plan?.days?.length) return null;
  const w = weeklySets(plan);
  return { target_range_for_main_groups: w.target, by_muscle_group: Object.fromEntries(w.rows.map((r) => [r.group, r.sets])), below_range: w.rows.filter((r) => r.low).map((r) => r.group) };
}

/**
 * A workout, during it or after it. After it, the request carries the whole
 * picture as well: the recent workouts, the sets a week the plan gives each
 * muscle group, and the conversation, because the review looks at the whole
 * plan and not only at the exercises just done.
 */
export function sessionRequest({ mode, profile, equipment, plan, session, past, alreadyApplied = [], chat = [], weights = {} }) {
  const now = session.endedAt || Date.now();
  const whole = mode === 'after_session';
  return body(mode, {
    profile: profileOut(profile),
    equipment: equipmentOut(equipment),
    available_exercises: whole ? exercisesOut(equipment) : undefined,
    current_plan: planOut(plan),
    session: sessionOut(session),
    earlier_sessions: historyOut(session, past || []),
    already_applied: alreadyApplied.map((c) => ({ exercise_key: c.exerciseKey, exercise: c.exerciseName, field: c.field, from: c.from, to: c.to })),
    ...(whole ? {
      ...trainingOut(past || [], now, 6),
      weekly_sets_in_the_plan: weeklySetsOut(plan),
      known_loads: loadsOut(weights),
      conversation: conversationOut(chat, 8),
    } : {}),
    other_activities: activitiesOut(past || [], now),
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
[{"ref": "<ref exactly as given>", "vendor": "<maker>", "model": "<model or product line as the maker writes it>", "how_it_works": "<two or three plain sentences: path of the movement, seat and pad set-up, one arm or two, how it is loaded>", "isolates": "<muscles it trains, main ones first>", "loading": "selectorized" | "plate_loaded" | "cable" | "bodyweight" | "other", "looks_like": "<the closest of: ${SKETCH_IDS.join(', ')}>", "notes": "<set-up or use notes worth knowing, or empty>", "source_url": "<the page you took this from, copied exactly from your search results>"}]

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

const gym = (x) => x.status === 'done' && x.kind !== 'activity';

const recentOut = (sessions, now, n = 10) => sessions.filter((x) => gym(x) && x.startedAt <= now)
  .sort((a, b) => b.startedAt - a.startedAt).slice(0, n).map((x) => ({
    date: new Date(x.startedAt).toISOString().slice(0, 10), days_ago: daysBetween(x.startedAt, now),
    title: x.title, sets_done_by_muscle_group: doneGroups(x), planned_rest_days_after: x.restAfter ?? null, eased_percent: x.easePct || 0,
  }));

/** Runs, rides and the like from the last two weeks, newest first. */
function activitiesOut(sessions, now) {
  return sessions.filter((x) => x.kind === 'activity' && x.startedAt <= now && now - x.startedAt < 14 * 864e5)
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 10).map((x) => ({
      date: new Date(x.startedAt).toISOString().slice(0, 10), days_ago: daysBetween(x.startedAt, now), hours_ago: Math.round((now - (x.endedAt || x.startedAt)) / 3600e3),
      activity: ACTIVITIES[x.activity]?.label || x.title, minutes: x.minutes, effort: x.effort,
      counts_as_work_for: activityGroups(x), note: x.note || undefined,
    }));
}

/** Everything the model needs to judge what to train today. */
export function trainNowRequest({ profile, equipment, plan, sessions, now = Date.now(), pick }) {
  const done = sessions.filter((x) => gym(x) && x.startedAt <= now).sort((a, b) => b.startedAt - a.startedAt);
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
    other_activities: activitiesOut(sessions, now),
    hours_since_muscle_group_was_trained: hours,
    workouts_in_last_7_days: done.filter((x) => now - x.startedAt < 7 * 24 * 3600e3).length,
    app_pick: pick ? { session_id: pick.dayId, reason: pick.reason, notes: pick.notes, order_after_today: pick.order.slice(1), ease_percent: pick.easePct } : null,
  });
}

/** Something done outside the plan was logged: ask what it means for the sessions still to do. */
export function activityRequest({ profile, plan, sessions, activity, now = Date.now() }) {
  return body('activity', {
    today: { date: new Date(now).toISOString().slice(0, 10) },
    profile: profileOut(profile),
    current_plan: planOut(plan),
    logged_activity: activitiesOut([activity], now + 1)[0] || null,
    recent_workouts: recentOut(sessions, now),
    other_activities: activitiesOut(sessions.filter((x) => x.id !== activity.id), now),
  });
}

/** The run is finished: ask for the next one, with the results so far. */
export function nextRunRequest({ profile, equipment, plan, sessions, weights, now = Date.now() }) {
  const results = {};
  for (const x of sessions.filter(gym).sort((a, b) => b.startedAt - a.startedAt).slice(0, 12)) {
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
    other_activities: activitiesOut(sessions, now),
    results_by_exercise: results,
    known_loads: Object.fromEntries(Object.entries(weights || {}).map(([id, w]) => [id, w.value])),
  });
}

export { recommend, timeline };
