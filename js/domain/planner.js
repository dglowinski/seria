// Builds a weekly plan from the profile, the equipment list and the rules
// library. Works with no network. Claude, when connected, produces plans in the
// same shape and they pass through normalizePlan() below.

import {
  SPLITS, TEMPLATES, DAY_TITLES, PATTERN_FALLBACK, TIME, MAX_DAYS, GOALS, TARGET_RIR, CYCLE,
  RULES_VERSION, PROGRESSION, WEEKLY_SETS, prescribe, levelFor, setSeconds, defaultCycleWeeks,
} from './rules.js';
import { newRun, restPattern } from './schedule.js';
import { allExercises, canDo, zoneOf, equipmentNames, isLowerPattern, equipmentList, isAvailable, GROUP_OF, MAIN_GROUPS } from './catalog.js';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const WEEKDAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DEFAULT_DAYS = {
  1: ['wed'], 2: ['mon', 'thu'], 3: ['mon', 'wed', 'fri'], 4: ['mon', 'tue', 'thu', 'fri'],
  5: ['mon', 'tue', 'wed', 'fri', 'sat'], 6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
};

// `days` are the user's usual weekdays, kept only as a note: the plan itself is
// a running list of sessions that can be done on any day.
export const emptyProfile = () => ({
  goal: null, months: null, daysPerWeek: null, days: [], minutes: null, cycleWeeks: null,
  preferences: '', limitations: '', avoid: [], include: [], avoidTags: [], askedExtras: false,
});

/** Which profile fields still need an answer before a plan can be made. */
export function missingFields(p) {
  const out = [];
  if (!p.goal) out.push('goal');
  if (p.months == null) out.push('experience');
  if (!p.daysPerWeek && !(p.days || []).length) out.push('days');
  if (!p.minutes) out.push('minutes');
  return out;
}

/** How many sessions a week the plan is built for. */
export const sessionsPerWeek = (p) => Math.min(Math.max(Math.round(p.daysPerWeek || (p.days || []).length || 3), 1), MAX_DAYS);

/** How many weeks ahead the plan is laid out. Not something the user has to think about. */
export function cycleWeeks(p) {
  const n = Math.round(Number(p.cycleWeeks));
  return Number.isFinite(n) && n >= CYCLE.minWeeks ? Math.min(n, CYCLE.maxWeeks) : defaultCycleWeeks(sessionsPerWeek(p));
}

export function trainingDays(p) {
  const picked = WEEKDAYS.filter((d) => (p.days || []).includes(d)).slice(0, MAX_DAYS);
  if (picked.length) return picked;
  const n = Math.min(Math.max(p.daysPerWeek || 3, 1), MAX_DAYS);
  return DEFAULT_DAYS[n];
}

export function fmtLoad(loadType, value) {
  if (loadType === 'bodyweight') return value ? `Bodyweight + ${num(value)} kg` : 'Bodyweight';
  if (value == null) return 'Not set';
  if (loadType === 'per_dumbbell') return `${num(value)} kg per dumbbell`;
  if (loadType === 'machine') return `Setting ${num(value)}`;
  return `${num(value)} kg total`;
}
export function fmtLoadShort(loadType, value) {
  if (loadType === 'bodyweight') return value ? `BW + ${num(value)} kg` : 'Bodyweight';
  if (value == null) return '—';
  if (loadType === 'machine') return `setting ${num(value)}`;
  return `${num(value)} kg`;
}
export const num = (v) => (Math.round(v * 100) / 100).toString();

export function loadMethod(ex) {
  if (ex.loadType === 'bodyweight') return 'Bodyweight. Stop with 1-2 good reps left.';
  return `You pick it in the first session: a weight you could lift for about ${ex.reps + 2} reps.`;
}

// ---------------------------------------------------------------- time

export function exerciseSeconds(ex) {
  return ex.sets * setSeconds(ex.reps) + Math.max(ex.sets - 1, 0) * ex.restSec;
}

export function daySeconds(exercises) {
  if (!exercises.length) return 0;
  const work = exercises.reduce((s, ex) => s + exerciseSeconds(ex), 0);
  return TIME.warmupGeneralSec + TIME.warmupRampSec + work + (exercises.length - 1) * TIME.transitionSec;
}

export const dayMinutes = (exercises) => Math.round(daySeconds(exercises) / 60);

/** Minute-by-minute parts of a day estimate, for the day preview. */
export function timeBreakdown(exercises) {
  const sets = exercises.reduce((s, ex) => s + ex.sets * setSeconds(ex.reps), 0);
  const rests = exercises.reduce((s, ex) => s + Math.max(ex.sets - 1, 0) * ex.restSec, 0);
  return {
    warmup: Math.round((TIME.warmupGeneralSec + TIME.warmupRampSec) / 60),
    sets: Math.round(sets / 60),
    rests: Math.round(rests / 60),
    moving: Math.round((Math.max(exercises.length - 1, 0) * TIME.transitionSec) / 60),
  };
}

/**
 * Direct sets per muscle group across the week, against the target for the
 * lifter's level (rule VOL-1). Only the big groups are judged against it.
 */
export function weeklySets(plan) {
  const sets = {};
  const weeks = Math.max(plan.cycleWeeks || 1, 1);
  for (const d of plan.days) for (const ex of d.exercises) {
    const g = GROUP_OF[ex.pattern];
    if (g) sets[g] = (sets[g] || 0) + ex.sets;
  }
  for (const g of Object.keys(sets)) sets[g] = Math.round((sets[g] / weeks) * 2) / 2; // per week, averaged over the cycle
  const [lo, hi] = WEEKLY_SETS[plan.level] || WEEKLY_SETS.intermediate;
  const rows = Object.keys(sets).sort((a, b) => sets[b] - sets[a]).map((group) => ({ group, sets: sets[group], judged: MAIN_GROUPS.includes(group), low: MAIN_GROUPS.includes(group) && sets[group] < lo }));
  for (const g of MAIN_GROUPS) if (!sets[g]) rows.push({ group: g, sets: 0, judged: true, low: true });
  return { rows, target: [lo, hi] };
}

// ---------------------------------------------------------------- selection

function pick(pattern, ctx) {
  const tried = new Set();
  let hardOnly = null;
  const queue = [pattern, ...(PATTERN_FALLBACK[pattern] || [])];
  for (const pat of queue) {
    if (tried.has(pat)) continue;
    tried.add(pat);
    const pool = ctx.all.filter((x) => x.pattern === pat
      && canDo(ctx.equipment, x)
      && !ctx.usedToday.has(x.id)
      && !ctx.avoid.has(x.id)
      && !x.tags.some((t) => ctx.avoidTags.has(t)));
    if (!pool.length) continue;
    // Novices are not handed pull-ups or dips while another movement can stand in.
    if (ctx.level === 'novice' && pat === pattern && pool.every((x) => x.hard) && !pool.some((x) => ctx.include.has(x.id))) {
      hardOnly = hardOnly || pool;
      continue;
    }
    const score = (x) => x.rank
      + (ctx.goal === 'strength' && x.load === 'total' ? -1.5 : 0)
      + (ctx.level === 'novice' && x.hard ? 3 : 0)
      + (ctx.usedWeek.has(x.id) ? 10 : 0)
      + (ctx.usedCycle?.has(x.id) ? 4 : 0) // later weeks rotate to exercises the cycle has not used yet
      - (ctx.include.has(x.id) ? 100 : 0);
    pool.sort((a, b) => score(a) - score(b));
    return pool[0];
  }
  return hardOnly ? hardOnly.sort((a, b) => a.rank - b.rank)[0] : null;
}

function toPlanExercise(x, tier, ctx, key) {
  const p = prescribe(ctx.goal, tier, ctx.level, x.load);
  const known = ctx.weights[x.id];
  return {
    key,
    exerciseId: x.id,
    name: x.name,
    pattern: x.pattern,
    tier,
    equipment: equipmentNames(ctx.equipment, x),
    zone: zoneOf(ctx.equipment, x),
    loadType: x.load,
    sets: p.sets,
    repLo: p.repLo,
    repHi: p.repHi,
    reps: p.repLo,
    restSec: p.rest,
    load: known ? { value: known.value, step: known.step } : (x.load === 'bodyweight' ? { value: 0, step: PROGRESSION.defaultStep.bodyweight } : null),
  };
}

const TIER_ORDER = ['accessory', 'secondary', 'main'];

/** Trim a day to the time budget. Returns notes on what was cut. */
export function fitToBudget(exercises, budgetMin) {
  const budget = budgetMin * 60;
  const notes = [];
  const left = [];
  let guard = 0;
  while (daySeconds(exercises) > budget && guard++ < 60) {
    const last = exercises[exercises.length - 1];
    if (exercises.length > TIME.minExercises && last.tier !== 'main') {
      exercises.pop();
      left.unshift(last.name);
      continue;
    }
    let cut = null;
    for (const tier of TIER_ORDER) {
      for (let i = exercises.length - 1; i >= 0; i--) {
        if (exercises[i].tier === tier && exercises[i].sets > TIME.minSets) { cut = exercises[i]; break; }
      }
      if (cut) break;
    }
    if (!cut) break;
    cut.sets -= 1;
  }
  if (left.length) notes.push(`left out ${left.join(', ')} to fit ${budgetMin} min.`);
  if (daySeconds(exercises) > budget) notes.push(`about ${dayMinutes(exercises)} min is the shortest sensible session.`);
  return notes;
}

/**
 * Build the cycle: sessions per week times the number of weeks.
 * Week 1 is laid out from the rules. Later weeks keep the main lifts of the
 * matching session, so they come back every week and can progress, and rotate
 * the other exercises to fit in more movements (rule CYC-1).
 * @param {object} profile see emptyProfile()
 * @param {object} equipment equipment state
 * @param {object} [weights] last known load per exercise id
 * @param {number} [now] timestamp
 */
export function generatePlan(profile, equipment, weights = {}, now = Date.now()) {
  const perWeek = sessionsPerWeek(profile);
  const weeks = cycleWeeks(profile);
  const split = SPLITS[perWeek];
  const level = levelFor(profile.months);
  const goal = GOALS[profile.goal] ? profile.goal : 'general';
  const minutes = clampMinutes(profile.minutes);
  const all = allExercises(equipment);
  const include = new Set(profile.include || []);
  const ctx = {
    all, equipment, goal, level, weights,
    avoid: new Set(profile.avoid || []),
    avoidTags: new Set(profile.avoidTags || []),
    include,
    usedWeek: new Set(),
    usedCycle: new Set(),
    usedToday: new Set(),
  };

  // Asked-for exercises whose movement is in no session of this split get a slot of their own.
  const weekPatterns = new Set(split.flatMap((k) => TEMPLATES[k].map(([p]) => p)));
  const extras = [...include].map((id) => all.find((x) => x.id === id))
    .filter((x) => x && canDo(equipment, x) && !weekPatterns.has(x.pattern));

  const notes = [];
  const rests = restPattern(perWeek); // rest days after each session of a week
  const planDays = [];
  const week1 = []; // week 1's main lifts, by session, so they repeat every week
  const turn = []; // per session: where in the list of other slots this week starts
  const TIER_RANK = { main: 0, secondary: 1, accessory: 2 };
  let anyCut = false;
  for (let w = 1; w <= weeks; w++) {
    ctx.usedWeek = new Set();
    const placed = new Set();
    split.forEach((kind, si) => {
      ctx.usedToday = new Set();
      const slots = TEMPLATES[kind].map(([pattern, tier]) => ({ pattern, tier }));
      const asked = [];
      for (const x of extras) {
        const lowerDay = ['lower', 'legs'].includes(kind);
        const upperDay = ['upper', 'push', 'pull'].includes(kind);
        const fits = isLowerPattern(x.pattern) ? !upperDay : !lowerDay;
        if (fits && !placed.has(x.id)) { asked.push({ pattern: x.pattern, tier: 'secondary' }); placed.add(x.id); }
      }
      // Main lifts first, then what the user asked for, then the rest. When time is
      // short the rest take turns: what was left out last week goes first this week.
      const mains = slots.filter((x) => x.tier === 'main');
      const others = slots.filter((x) => x.tier !== 'main');
      const off = others.length ? (turn[si] || 0) % others.length : 0;
      const ordered = [...mains, ...asked, ...others.slice(off), ...others.slice(0, off)];
      const di = planDays.length;
      const exercises = [];
      for (const slot of ordered) {
        const repeat = w > 1 && slot.tier === 'main' ? week1[si]?.[slot.pattern] : null;
        const x = (repeat && !ctx.usedToday.has(repeat.id) ? repeat : null) || pick(slot.pattern, ctx);
        if (!x) continue;
        if (w === 1 && slot.tier === 'main') { week1[si] = week1[si] || {}; week1[si][slot.pattern] = week1[si][slot.pattern] || x; }
        ctx.usedToday.add(x.id);
        exercises.push(toPlanExercise(x, slot.tier, ctx, ''));
      }
      const before = exercises.length;
      const cut = fitToBudget(exercises, minutes);
      const keptOthers = exercises.length - mains.length - asked.length;
      if (exercises.length < before) { anyCut = true; turn[si] = off + Math.max(keptOthers, 1); }
      // Done in the order the rules ask for: compound lifts before single-joint work.
      exercises.sort((p, q) => TIER_RANK[p.tier] - TIER_RANK[q.tier]);
      exercises.forEach((ex, j) => { ex.key = `d${di + 1}e${j + 1}`; });
      for (const ex of exercises) { ctx.usedWeek.add(ex.exerciseId); ctx.usedCycle.add(ex.exerciseId); }
      planDays.push({ id: `d${di + 1}`, week: w, slot: si + 1, kind, title: DAY_TITLES[kind], restAfter: rests[si], exercises, estMinutes: dayMinutes(exercises), cut: weeks === 1 ? cut : cut.filter((n) => !n.startsWith('left out')) });
    });
  }
  if (anyCut && weeks > 1) notes.push(`Not everything fits in ${minutes} min, so the smaller exercises take turns from one week to the next.`);
  nameSessions(planDays);
  for (const d of planDays) { for (const n of d.cut) notes.push(`${d.title}: ${n}`); delete d.cut; }

  const plan = {
    id: `plan_${now.toString(36)}`,
    version: 1,
    createdAt: now,
    rulesVersion: RULES_VERSION,
    source: 'rules',
    goal,
    level,
    minutes,
    perWeek,
    cycleWeeks: weeks,
    days: planDays,
    notes,
  };
  plan.queue = newRun(plan);
  return plan;
}

/** "Upper body A", "Upper body B"...: a letter when a kind of session comes up more than once in the cycle. */
export function nameSessions(days) {
  const count = {};
  for (const d of days) { d.base = d.base || d.title; count[d.base] = (count[d.base] || 0) + 1; }
  const seen = {};
  for (const d of days) {
    seen[d.base] = (seen[d.base] || 0) + 1;
    d.title = count[d.base] > 1 ? `${d.base} ${String.fromCharCode(64 + seen[d.base])}` : d.base;
    delete d.base;
  }
  return days;
}

export const clampMinutes = (m) => Math.min(Math.max(Math.round(m || 50), 20), 150);

/** What the coach shows before a plan is made, so the user can correct it first. */
export function buildAssumptions(profile, equipment) {
  const perWeek = sessionsPerWeek(profile);
  const weeks = cycleWeeks(profile);
  const usual = WEEKDAYS.filter((d) => (profile.days || []).includes(d));
  const level = levelFor(profile.months);
  const goal = GOALS[profile.goal] ? profile.goal : 'general';
  const list = equipmentList(equipment);
  const avail = list.filter((x) => isAvailable(equipment, x.id)).map((x) => x.name);
  const all = allExercises(equipment);
  const nameOf = (id) => all.find((x) => x.id === id)?.name || id;
  const rir = TARGET_RIR[level];
  const total = perWeek * weeks;
  const out = [
    ['Goal', GOALS[goal].label + (profile.goal ? '' : ' (you did not say, so I picked the safe default)')],
    ['Experience', `${fmtMonths(profile.months)} of training, treated as ${level}`],
    ['Sessions', `${perWeek} a week, on any days you like${usual.length ? ` (you mentioned ${usual.map((d) => WEEKDAY_SHORT[d]).join(', ')})` : ''}`],
    ['Session length', `Up to ${clampMinutes(profile.minutes)} min, warm-up included`],
    ['The plan', `The next ${total} session${total === 1 ? '' : 's'}, with rest days between: ${SPLITS[perWeek].map((k, i) => `${DAY_TITLES[k].toLowerCase()}, ${restPattern(perWeek)[i]} off`).join(', ')}${weeks > 1 ? ', then again with other exercises taking their turn' : ''}`],
    ['After that', 'It is updated after every workout from your results, and the next run is planned when this one is done'],
    ['Equipment', avail.join(', ') || 'Bodyweight only'],
    ['Effort', `Finish sets with ${rir[0]}-${rir[1]} reps left in the tank`],
    ['Starting weights', 'You choose them in your first session; I track them from there'],
  ];
  if ((profile.avoid || []).length) out.push(['Leaving out', uniq((profile.avoid || []).map(nameOf)).join(', ')]);
  if ((profile.avoidTags || []).length) out.push(['Working around', profile.avoidTags.map((t) => TAG_TEXT[t] || t).join('; ')]);
  if ((profile.include || []).length) out.push(['Making room for', uniq((profile.include || []).map(nameOf)).join(', ')]);
  if (profile.limitations) out.push(['Your limitations', `“${profile.limitations}”`]);
  if (profile.preferences) out.push(['Your preferences', `“${profile.preferences}”`]);
  return out.map(([label, value]) => ({ label, value }));
}

export const TAG_TEXT = {
  shoulder: 'Shoulder: no overhead pressing or dips',
  spine: 'Lower back: no deadlifts, bent-over rows, back squats or back extensions',
  knee: 'Knee: no squats, lunges, leg press or leg extensions',
};

const uniq = (a) => [...new Set(a)];

export function fmtMonths(m) {
  if (m == null) return 'Unknown length';
  if (m < 1) return 'Under a month';
  if (m < 24) return `${Math.round(m)} month${Math.round(m) === 1 ? '' : 's'}`;
  const y = Math.round((m / 12) * 10) / 10;
  return `${y} years`;
}

// ---------------------------------------------------------------- plan upkeep

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Recompute the derived parts of a plan after any edit. */
export function refreshPlan(plan) {
  for (const d of plan.days) d.estMinutes = dayMinutes(d.exercises);
  return plan;
}

/** Put a newly chosen or changed weight on every plan entry for that exercise. */
export function setPlanLoad(plan, exerciseId, load) {
  const next = clone(plan);
  for (const d of next.days) for (const ex of d.exercises) if (ex.exerciseId === exerciseId) ex.load = { value: load.value, step: load.step };
  return next;
}

/** Exercises in the plan whose equipment is no longer available. */
export function brokenExercises(plan, equipment) {
  const all = allExercises(equipment);
  const out = [];
  for (const d of plan?.days || []) {
    for (const ex of d.exercises) {
      const x = all.find((y) => y.id === ex.exerciseId);
      if (!x || !canDo(equipment, x)) out.push({ dayId: d.id, key: ex.key, exerciseId: ex.exerciseId, name: ex.name });
    }
  }
  return out;
}

/**
 * Clean up a plan that came from Claude: keep only known, doable exercises,
 * clamp the numbers and fill in everything the app derives itself.
 * Returns { plan, dropped } or throws if nothing usable is left.
 */
export function normalizePlan(raw, profile, equipment, weights = {}, now = Date.now()) {
  const all = allExercises(equipment);
  const level = levelFor(profile.months);
  const goal = GOALS[profile.goal] ? profile.goal : 'general';
  const dropped = [];
  const perWeek = sessionsPerWeek(profile);
  const weeks = cycleWeeks(profile);
  const days = [];
  for (const rd of raw?.days || []) {
    if (days.length >= perWeek * CYCLE.maxWeeks) break;
    const di = days.length + 1;
    const exercises = [];
    const used = new Set();
    for (const re of rd.exercises || []) {
      const x = all.find((y) => y.id === re.exercise_id);
      if (!x || !canDo(equipment, x) || used.has(x.id)) { dropped.push(re.exercise_id); continue; }
      used.add(x.id);
      const tier = ['main', 'secondary', 'accessory'].includes(re.role) ? re.role : 'accessory';
      const base = prescribe(goal, tier, level, x.load);
      const sets = clampInt(re.sets, 1, 6, base.sets);
      const repLo = clampInt(re.rep_low, 1, 30, base.repLo);
      const repHi = Math.max(clampInt(re.rep_high, 1, 30, base.repHi), repLo);
      const known = weights[x.id];
      exercises.push({
        key: `d${di}e${exercises.length + 1}`,
        exerciseId: x.id, name: x.name, pattern: x.pattern, tier,
        equipment: equipmentNames(equipment, x), zone: zoneOf(equipment, x), loadType: x.load,
        sets, repLo, repHi, reps: repLo,
        restSec: clampInt(re.rest_seconds, 20, 360, base.rest),
        load: known ? { value: known.value, step: known.step } : (x.load === 'bodyweight' ? { value: 0, step: PROGRESSION.defaultStep.bodyweight } : null),
      });
    }
    if (!exercises.length) continue;
    days.push({
      id: `d${di}`, week: clampInt(rd.week, 1, CYCLE.maxWeeks, Math.ceil(di / perWeek)), kind: 'custom',
      restAfter: clampInt(rd.rest_days_after, 0, 6, restPattern(perWeek)[(di - 1) % perWeek]),
      title: String(rd.title || 'Session').replace(/\s+[A-D]$/, '').slice(0, 40),
      exercises, estMinutes: dayMinutes(exercises),
    });
  }
  // Keep the model's order within a week, weeks in order, ids and keys in sequence.
  days.sort((a, b) => a.week - b.week);
  let lastWeek = 0; let slot = 0;
  days.forEach((d, i) => {
    slot = d.week === lastWeek ? slot + 1 : 1; lastWeek = d.week;
    d.slot = slot;
    d.id = `d${i + 1}`;
    d.exercises.forEach((ex, j) => { ex.key = `d${i + 1}e${j + 1}`; });
  });
  if (!days.length) throw new Error('The plan had no usable training sessions.');
  nameSessions(days);
  const plan = {
    id: `plan_${now.toString(36)}`, version: 1, createdAt: now, rulesVersion: RULES_VERSION, source: 'claude',
    goal, level, minutes: clampMinutes(profile.minutes), perWeek, cycleWeeks: Math.max(lastWeek, 1), days,
    notes: (raw.notes || []).map((n) => String(n).slice(0, 200)).slice(0, 6),
  };
  plan.queue = newRun(plan);
  return { plan, dropped };
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Bring a plan saved in an older shape (tied to weekdays, or with an explicit
 * cycle) into the current one. The sessions and their order are kept.
 */
export function upgradePlan(plan) {
  if (!plan || !Array.isArray(plan.days) || (plan.queue && plan.perWeek && plan.days.every((d) => Number.isFinite(d.restAfter)))) return plan;
  const next = clone(plan);
  next.perWeek = next.perWeek || Math.min(Math.max(next.days.length, 1), MAX_DAYS);
  next.cycleWeeks = next.cycleWeeks || Math.max(1, Math.round(next.days.length / next.perWeek));
  const rests = restPattern(next.perWeek);
  next.days.forEach((d, i) => {
    d.week = d.week || Math.floor(i / next.perWeek) + 1;
    d.slot = d.slot || (i % next.perWeek) + 1;
    if (!Number.isFinite(d.restAfter)) d.restAfter = rests[i % next.perWeek];
    delete d.weekday;
  });
  if (!next.queue) {
    const c = next.cycle;
    next.queue = c ? { run: c.round || 1, order: c.order || [], done: c.done || [], skipped: c.skipped || [] } : newRun(next);
  }
  delete next.cycle;
  return next;
}
