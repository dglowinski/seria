// What to train, and when. The plan is a running list, not a calendar:
// train this, rest so many days, train that. This module answers, from the
// rules library and the workout history:
//   - when the next session is due,
//   - what makes sense if the user trains on another day instead,
//   - in what order, and with what rests, the rest of the list should follow.
// Pure functions, no network.

import { SCHEDULE, ACTIVITIES, activityGroups } from './rules.js';
import { GROUP_OF, MAIN_GROUPS } from './catalog.js';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const clone = (o) => JSON.parse(JSON.stringify(o));
const joinAnd = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

/** Midnight at the start of the local day a moment falls on. */
export const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Whole calendar days from a to b (0 when on the same day). */
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

/**
 * Rest days after each session of a week, spread as evenly as the week allows,
 * with the longer breaks last. Three a week gives 1, 1, 2.
 */
export function restPattern(perWeek) {
  const n = Math.min(Math.max(Math.round(perWeek) || 1, 1), 7);
  const rest = 7 - n;
  const base = Math.floor(rest / n);
  const extra = rest % n;
  return Array.from({ length: n }, (_, i) => base + (i >= n - extra ? 1 : 0));
}

const usualRest = (plan) => Math.max(0, Math.round(7 / (plan.perWeek || plan.days.length || 3)) - 1);

/** A fresh run through the plan's sessions, in plan order. */
export const newRun = (plan, run = 1) => ({ run, order: plan.days.map((d) => d.id), done: [], skipped: [] });

/** The list as it stands: a valid order, and what is still to do in this run. */
export function queueState(plan) {
  const ids = plan.days.map((d) => d.id);
  const q = plan.queue || newRun(plan);
  const order = [...q.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !q.order.includes(id))];
  const done = q.done.filter((id) => ids.includes(id));
  const skipped = q.skipped.filter((id) => ids.includes(id) && !done.includes(id));
  const queue = order.filter((id) => !done.includes(id) && !skipped.includes(id)).map((id) => plan.days.find((d) => d.id === id));
  return { run: q.run || 1, order, done, skipped, queue };
}

/** Sets per muscle group that a planned session asks for. */
export function dayGroups(day) {
  const g = {};
  for (const ex of day.exercises) {
    const name = GROUP_OF[ex.pattern];
    if (name) g[name] = (g[name] || 0) + ex.sets;
  }
  return g;
}

/** Sets per muscle group really done in a recorded workout. */
export function doneGroups(session) {
  const g = {};
  for (const ex of session.exercises) {
    const name = GROUP_OF[ex.pattern];
    const n = ex.sets.filter((st) => st.status === 'done').length;
    if (name && n) g[name] = (g[name] || 0) + n;
  }
  return g;
}

/**
 * When each muscle group was last worked, and the last gym workout itself.
 * Other activity (a run, a ride) counts for the muscles it loads (rule REC-4)
 * but is not a workout: it does not move the day the next session is due.
 * `by` names the activity when that, not a workout, was the last thing a group did.
 */
export function lastTrained(history, now) {
  const at = {};
  const by = {};
  let last = null;
  let inWeek = 0;
  for (const s of history) {
    if (s.status !== 'done' || s.startedAt > now) continue;
    if (s.kind === 'activity') {
      for (const name of activityGroups(s)) if (!at[name] || s.endedAt > at[name]) { at[name] = Math.min(s.endedAt || s.startedAt, now); by[name] = (ACTIVITIES[s.activity]?.label || 'activity').toLowerCase(); }
      continue;
    }
    const g = doneGroups(s);
    if (!Object.keys(g).length) continue;
    if (!last || s.startedAt > last.startedAt) last = s;
    if (now - s.startedAt < 7 * DAY) inWeek++;
    for (const name of Object.keys(g)) if (!at[name] || s.startedAt > at[name]) { at[name] = s.startedAt; delete by[name]; }
  }
  return { at, last, inWeek, by };
}

// How much a session repeats muscle groups that have not had their rest.
function clash(day, at, now) {
  const g = dayGroups(day);
  let sets = 0;
  const groups = [];
  for (const name of Object.keys(g)) {
    if (at[name] && now - at[name] < SCHEDULE.recoverHours * HOUR && MAIN_GROUPS.includes(name)) { sets += g[name]; groups.push(name); }
  }
  return { sets, groups };
}

function pickFrom(queue, at, now) {
  let best = null;
  queue.forEach((day, i) => {
    const c = clash(day, at, now);
    // A session that clashes never beats one that does not; ties go to the planned order.
    const score = (c.sets > 0 ? 1000 + c.sets * 10 : 0) + i;
    if (!best || score < best.score) best = { day, score, clash: c, index: i };
  });
  return best;
}

/** The order that spaces muscle groups best from here on, at the planned rests. */
function orderRest(queue, at, from) {
  const seen = { ...at };
  const left = [...queue];
  const out = [];
  let t = from;
  while (left.length) {
    const p = pickFrom(left, seen, t);
    out.push(p.day.id);
    left.splice(left.indexOf(p.day), 1);
    for (const name of Object.keys(dayGroups(p.day))) seen[name] = t;
    t += ((p.day.restAfter ?? 1) + 1) * DAY;
  }
  return out;
}

const ago = (ms) => {
  const h = Math.round(ms / HOUR);
  if (h < 20) return h <= 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(ms / DAY);
  return d <= 1 ? 'yesterday' : `${d} days ago`;
};

/**
 * What to train now, or on the day it is due.
 * @param {object} plan the current plan with its queue
 * @param {object[]} history recorded workouts
 * @param {number} now timestamp
 * @param {{prefer?: string}} [opts] prefer: a session the user picked by hand
 * @returns {null | {dayId, title, reason, notes: string[], flags, onSchedule: boolean, offBy: number, dueAt: number, easePct: number, order: string[], headId: string, daysSince: number|null}}
 */
export function recommend(plan, history = [], now = Date.now(), opts = {}) {
  if (!plan?.days?.length) return null;
  const perWeek = plan.perWeek || plan.days.length;
  const state = queueState(plan);
  // Everything done or skipped: the next run starts, in plan order.
  const queue = state.queue.length ? state.queue : plan.days;
  const { at, last, inWeek, by } = lastTrained(history, now);
  const since = last ? now - last.startedAt : null;
  // The day the next session is due: the last workout's day, its planned rest, then one more.
  const plannedRest = last ? (Number.isFinite(last.restAfter) ? last.restAfter : usualRest(plan)) : 0;
  const dueAt = last ? dayStart(last.startedAt) + (plannedRest + 1) * DAY : dayStart(now);
  const offBy = last ? daysBetween(dueAt, now) : 0; // below zero: early; above: late

  const head = queue[0];
  const chosen = opts.prefer ? queue.find((d) => d.id === opts.prefer) || plan.days.find((d) => d.id === opts.prefer) : null;
  const best = chosen ? { day: chosen, clash: clash(chosen, at, now) } : pickFrom(queue, at, now);
  const day = best.day;
  const flags = {
    first: !last,
    early: offBy < 0,
    late: offBy > 0,
    clash: best.clash.sets > 0,
    moved: day.id !== head.id && !chosen,
    extra: !!last && inWeek >= perWeek,
    longBreak: since != null && since >= SCHEDULE.breakDays * DAY,
  };
  const easePct = flags.longBreak ? SCHEDULE.easePct : 0;

  let reason;
  const notes = [];
  const headClash = clash(head, at, now);
  if (flags.first) reason = 'The first session of your plan.';
  else if (chosen) reason = chosen.id === head.id ? 'Next in your plan.' : 'Your pick. The rest of the plan moves around it.';
  else if (flags.clash) {
    // Nothing coming up is fully rested: offer the least overlap, and say that resting is fine.
    const recent = Math.max(...best.clash.groups.map((x) => at[x]));
    const what = best.clash.groups.every((x) => by[x]) ? `Your ${by[best.clash.groups[0]]}` : 'Your last workout';
    reason = `${what} was ${ago(now - recent)}, and every session coming up repeats muscles from it. This one repeats the least. Resting today is also a good choice.`;
  } else if (flags.moved) {
    const g = headClash.groups.map((x) => x.toLowerCase());
    const when = ago(now - Math.max(...headClash.groups.map((x) => at[x])));
    const lead = headClash.groups.every((x) => by[x]) ? `Your ${by[headClash.groups[0]]} ${when} worked ${joinAnd(g)}` : `You trained ${joinAnd(g)} ${when}`;
    reason = `${lead}. ${day.title} gives ${g.length > 1 ? 'them' : 'it'} time to recover, so it goes ahead of ${head.title}.`;
  } else reason = 'Next in your plan.';

  if (flags.early && !flags.clash && !flags.moved) notes.push(`${days(-offBy)} earlier than planned. These muscles are rested, so it is fine if you feel up to it.`);
  else if (flags.early) notes.push(`${days(-offBy)} earlier than planned.`);
  if (flags.longBreak) notes.push(`It has been ${days(Math.round(since / DAY))} since your last workout. Loads are ${easePct}% lighter today to ease back in.`);
  else if (flags.late) notes.push(`${days(offBy)} later than planned. Nothing is lost: the plan moves with you.`);
  if (flags.extra && flags.early) notes.push(`This would be workout ${inWeek + 1} in 7 days. The plan assumes ${perWeek}.`);
  if (chosen && best.clash.sets > 0) notes.push(`It repeats ${joinAnd(best.clash.groups.map((x) => x.toLowerCase()))}, trained less than ${SCHEDULE.recoverHours} hours ago.`);

  // After today, the rest follows in the order that spaces muscle groups best.
  const after = { ...at };
  for (const name of Object.keys(dayGroups(day))) after[name] = now;
  const others = queue.filter((d) => d.id !== day.id);
  const rest = orderRest(others, after, now + ((day.restAfter ?? usualRest(plan)) + 1) * DAY);
  const reordered = rest.join() !== others.map((d) => d.id).join();

  const onSchedule = flags.first || (offBy === 0 && !flags.clash && !flags.moved);
  return {
    dayId: day.id, title: day.title, reason, notes, flags: { ...flags, reordered, newRun: !state.queue.length }, onSchedule, offBy, dueAt, easePct,
    order: [day.id, ...rest], headId: head.id, daysSince: since == null ? null : daysBetween(last.startedAt, now),
  };
}

/**
 * What is next as planned: the pick for the day the next session is due, or for
 * today when that day has come or gone. Used to show the plan; "Train now" on
 * another day asks recommend() about this very moment instead.
 */
export function plannedNext(plan, history = [], now = Date.now()) {
  const today = recommend(plan, history, now);
  if (!today || today.dueAt <= dayStart(now)) return today;
  return recommend(plan, history, today.dueAt + 12 * HOUR);
}

/**
 * The plan as a list to read: each session with the day it falls on and the
 * rest before it, if the user trains when planned from here on.
 *
 * The list always shows one full cycle. Sessions already done in this run come
 * round again at the end, marked `again`, with whatever the plan now says for
 * them, so a finished session does not vanish: it shows when it is next due.
 */
export function timeline(plan, history = [], now = Date.now()) {
  const rec = plannedNext(plan, history, now);
  if (!rec) return [];
  const today = dayStart(now);
  const state = queueState(plan);
  // What comes round again once this run is through: the sessions done, in the order they were done, then the ones skipped.
  const again = rec.flags.newRun ? [] : [...state.done, ...state.skipped].filter((id) => !rec.order.includes(id));
  let at = Math.max(rec.dueAt, today);
  let restBefore = null;
  return [...rec.order, ...again].map((id, i) => {
    const day = plan.days.find((d) => d.id === id);
    if (i > 0) at += (restBefore + 1) * DAY;
    const item = { day, at, restBefore: i === 0 ? null : restBefore, inDays: daysBetween(today, at), again: i >= rec.order.length, skipped: state.skipped.includes(id) && i >= rec.order.length };
    restBefore = day.restAfter ?? usualRest(plan);
    return item;
  });
}

/** Put a decided order into the plan: the first id is next, the rest behind it. */
export function setOrder(plan, order) {
  const next = clone(plan);
  const state = queueState(next);
  const base = state.queue.length ? { run: state.run, order: state.order, done: state.done, skipped: state.skipped } : newRun(next, state.run + 1);
  const valid = order.filter((id, i, a) => a.indexOf(id) === i && next.days.some((d) => d.id === id) && !base.done.includes(id) && !base.skipped.includes(id));
  next.queue = { ...base, order: [...valid, ...base.order.filter((id) => !valid.includes(id))] };
  return next;
}

// How a recorded workout sits against a planned session, by sets per muscle group.
// `repeat`: how much of the session's work the workout already did, 0 to 1.
// `same`: how much the workout was this very session (most of it falls inside the
// session and covers most of it), with shared exercises breaking ties.
function against(day, workout) {
  const want = dayGroups(day);
  const got = doneGroups(workout);
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  let both = 0;
  for (const name of Object.keys(got)) both += Math.min(got[name], want[name] || 0);
  if (!both) return { repeat: 0, same: 0 };
  const done = new Set(workout.exercises.filter((ex) => ex.sets.some((st) => st.status === 'done')).map((ex) => ex.exerciseId));
  const shared = day.exercises.filter((ex) => done.has(ex.exerciseId)).length;
  return { repeat: both / sum(want), same: Math.sqrt((both / sum(want)) * (both / sum(got))) + (0.01 * shared) / done.size };
}

const REPEAT = 0.7; // a session with this much of its work done in the last workout repeats it
const NEAR = 0.15; // sessions this close to the most rested one count as just as rested

/**
 * A new plan carries on from the training so far, so a rebuilt plan does not
 * hand back what was just trained. The list is turned, keeping its order, to
 * start with a session whose muscles the last workout left alone: the first
 * such session after the one the last workout was, or the first in the list
 * when it was none of them. After a long break the list starts from the top.
 * `gentle` is for a plan whose order was already chosen with the history in
 * view: it is left alone unless it opens with a repeat of the last workout.
 */
export function continueFrom(plan, history = [], now = Date.now(), { gentle = false } = {}) {
  const { last } = lastTrained(history, now);
  const n = plan.days.length;
  if (!last || n < 2 || now - last.startedAt >= SCHEDULE.breakDays * DAY) return plan;
  const rows = plan.days.map((d) => against(d, last));
  if (gentle && rows[0].repeat < REPEAT) return plan;
  const least = Math.min(...rows.map((r) => r.repeat));
  const rested = rows.map((r, i) => i).filter((i) => rows[i].repeat <= least + NEAR);
  let was = -1; // the session the last workout was, if it was one of these
  let top = REPEAT;
  rows.forEach((r, i) => { if (r.same > top + 1e-9) { top = r.same; was = i; } });
  let start = rested[0];
  if (was >= 0) for (let k = 1; k <= n; k++) { const i = (was + k) % n; if (rested.includes(i)) { start = i; break; } }
  if (!start) return plan;
  const ids = plan.days.map((d) => d.id);
  return setOrder(plan, [...ids.slice(start), ...ids.slice(0, start)]);
}

/** Set the planned rest after sessions, by session id. Values are days, 0 to 6. */
export function setRests(plan, restById) {
  const next = clone(plan);
  for (const d of next.days) {
    const v = Math.round(Number(restById?.[d.id]));
    if (Number.isFinite(v)) d.restAfter = Math.min(Math.max(v, 0), 6);
  }
  return next;
}

/** Mark a session as done in this run. */
export function completeDay(plan, dayId) {
  if (!plan.days.some((d) => d.id === dayId)) return plan;
  const next = clone(plan);
  const s = queueState(next);
  next.queue = { run: s.run, order: s.order, done: [...new Set([...s.done, dayId])], skipped: s.skipped.filter((id) => id !== dayId) };
  return next;
}

/** A recorded workout was deleted: its session is to do again in this run. */
export function uncompleteDay(plan, dayId) {
  if (!plan.days.some((d) => d.id === dayId)) return plan;
  const next = clone(plan);
  const s = queueState(next);
  next.queue = { run: s.run, order: s.order, done: s.done.filter((id) => id !== dayId), skipped: s.skipped };
  return next;
}

/** Leave a session out of this run. It comes back in the next one. */
export function skipDay(plan, dayId) {
  if (!plan.days.some((d) => d.id === dayId)) return plan;
  const next = clone(plan);
  const s = queueState(next);
  if (s.done.includes(dayId)) return plan;
  next.queue = { run: s.run, order: s.order, done: s.done, skipped: [...new Set([...s.skipped, dayId])] };
  return next;
}

export function unskipDay(plan, dayId) {
  const next = clone(plan);
  const s = queueState(next);
  next.queue = { run: s.run, order: s.order, done: s.done, skipped: s.skipped.filter((id) => id !== dayId) };
  return next;
}

/** Where a session stands in the current run. */
export function dayStatus(plan, dayId) {
  const s = queueState(plan);
  if (s.done.includes(dayId)) return 'done';
  if (s.skipped.includes(dayId)) return 'skipped';
  return 'todo';
}

/** True once every session of the run is done or skipped: time for the next run. */
export const runFinished = (plan) => queueState(plan).queue.length === 0;
