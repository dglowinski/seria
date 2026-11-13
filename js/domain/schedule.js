// What to train, and when. The plan is a running list, not a calendar:
// train this, rest so many days, train that. This module answers, from the
// rules library and the workout history:
//   - when the next session is due,
//   - what makes sense if the user trains on another day instead,
//   - in what order, and with what rests, the rest of the list should follow.
// Pure functions, no network.

import { SCHEDULE } from './rules.js';
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

/** When each muscle group was last trained, and the last workout itself. */
export function lastTrained(history, now) {
  const at = {};
  let last = null;
  let inWeek = 0;
  for (const s of history) {
    if (s.status !== 'done' || s.startedAt > now) continue;
    const g = doneGroups(s);
    if (!Object.keys(g).length) continue;
    if (!last || s.startedAt > last.startedAt) last = s;
    if (now - s.startedAt < 7 * DAY) inWeek++;
    for (const name of Object.keys(g)) at[name] = Math.max(at[name] || 0, s.startedAt);
  }
  return { at, last, inWeek };
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
  const { at, last, inWeek } = lastTrained(history, now);
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
    reason = `Your last workout was ${ago(since)}, and every session coming up repeats muscles from it. This one repeats the least. Resting today is also a good choice.`;
  } else if (flags.moved) {
    const g = headClash.groups.map((x) => x.toLowerCase());
    reason = `You trained ${joinAnd(g)} ${ago(now - Math.max(...headClash.groups.map((x) => at[x])))}. ${day.title} gives ${g.length > 1 ? 'them' : 'it'} time to recover, so it goes ahead of ${head.title}.`;
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
 */
export function timeline(plan, history = [], now = Date.now()) {
  const rec = plannedNext(plan, history, now);
  if (!rec) return [];
  const today = dayStart(now);
  let at = Math.max(rec.dueAt, today);
  let restBefore = null;
  return rec.order.map((id, i) => {
    const day = plan.days.find((d) => d.id === id);
    if (i > 0) at += (restBefore + 1) * DAY;
    const item = { day, at, restBefore: i === 0 ? null : restBefore, inDays: daysBetween(today, at) };
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
