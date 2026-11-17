// The coach: reads what the user says, keeps the profile, asks for what is
// missing, shows its assumptions and builds or updates the plan.
//
// With an AI model connected (Claude or OpenAI), the model does the reading
// and planning. Without one, a
// small built-in reader handles the common answers and the rule-based
// generator builds the plan. Either way the app keeps working.

import { GOALS, MAX_DAYS, CYCLE, SCHEDULE, EFFORTS, levelFor, activityGroups } from '../domain/rules.js';
import { recommend, setOrder, setRests, completeDay, uncompleteDay, queueState, runFinished } from '../domain/schedule.js';
import { KEYWORDS, allExercises, canDo, parseEquipmentText, applyEquipmentRead, applyMachineLookup, machineDetail } from '../domain/catalog.js';
import {
  WEEKDAYS, WEEKDAY_SHORT, WEEKDAY_NAMES, missingFields, generatePlan, normalizePlan, fitToBudget, refreshPlan, fmtMonths,
  trainingDays, clampMinutes, setPlanLoad, fillOptional, allEntries,
} from '../domain/planner.js';
import { inSessionHint, postSessionChanges, equipmentChanges, applyPlanChange, undoPlanChange, withValue, fromAiChanges, ruleSummary, isApplied } from '../domain/progression.js';
import { applyHint, withoutHint, startSession, newActivity } from '../domain/session.js';
import * as store from '../store.js';
import { ask, aiReady, aiSource, aiName, AiError, canLookUp, lookUpMachines } from './ai.js';
import { interviewRequest, newPlanRequest, sessionRequest, equipmentRequest, trainNowRequest, nextRunRequest, activityRequest } from './prompts.js';

// ---------------------------------------------------------------- built-in reader

const WORD_NUM = { a: 1, an: 1, one: 1, once: 1, two: 2, twice: 2, 'couple of': 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const toNum = (s) => (s in WORD_NUM ? WORD_NUM[s] : parseFloat(String(s).replace(',', '.')));
const NUM = '(\\d+(?:[.,]\\d+)?|an|a|one|two|three|four|five|six|seven|eight|nine|ten|couple of|few)';

const DAY_WORDS = [
  ['mon', /\bmon(day)?s?\b/], ['tue', /\btue(s|sday)?s?\b/], ['wed', /\bwed(nesday)?s?\b/], ['thu', /\bthu(r|rs|rsday)?s?\b/],
  ['fri', /\bfri(day)?s?\b/], ['sat', /\bsat(urday)?s?\b/], ['sun', /\bsun(day)?s?\b/],
];

const NEG = /\b(no|not|never|skip|skipping|avoid|without|hate|dislike|can't|cannot|cant|don't|dont|won't|wont|exclude|drop|remove|leave out|stop|instead of)\b/g;
const POS = /\b(want|love|like|keep|include|add|care|focus|prioriti[sz]e|favou?rite|enjoy|more|must|need)\b/g;
const PART = /\b(shoulders?|knees?|lower back|back|spine|disc|hips?|elbows?|wrists?|ankles?|neck)\b/;
const PROBLEM = /\b(pain|painful|hurts?|hurting|injur\w*|bad|sore|surgery|operation|problems?|issues?|aches?|tear|torn|strain\w*|sprain\w*|tendin\w*|arthrit\w*|hernia\w*|sciatica|imping\w*|weak|recovering|careful|sensitive|dodgy|tweaked?)\b/;

const lastIndex = (re, s) => { let i = -1; let m; re.lastIndex = 0; while ((m = re.exec(s))) i = m.index; return i; };

/**
 * Pull profile facts out of free text.
 * @param {string} text what the user wrote or dictated
 * @param {{asked?: string}} [ctx] the field the coach last asked about
 * @returns {{patch: object, got: string[]}}
 */
export function parseProfile(text, ctx = {}) {
  const raw = String(text || '').trim();
  const t = ` ${raw.toLowerCase().replace(/[’`]/g, "'")} `;
  const patch = {};
  const got = [];
  const bare = raw.toLowerCase().match(new RegExp(`^${NUM}$`));

  // Goal
  let goal = null;
  if (/\b(strength|stronger|strong|powerlift\w*|lift heavier|heavier)\b/.test(t)) goal = 'strength';
  else if (/\b(muscles?|hypertrophy|bigger|size|mass|bulk\w*|bodybuild\w*|physique)\b/.test(t)) goal = 'muscle';
  else if (/\b(endurance|stamina|conditioning)\b/.test(t)) goal = 'endurance';
  else if (/\b(fit|fitter|fitness|health|healthy|general|shape|lose weight|weight loss|active)\b/.test(t)) goal = 'general';
  if (goal) { patch.goal = goal; got.push('goal'); }

  // Experience
  let months = null;
  if (/\b(beginner|newbie|new to|never (lifted|trained)|just start\w*|starting out|first time|no experience)\b/.test(t)) months = 0;
  else if (/\bintermediate\b/.test(t)) months = 12;
  else if (/\b(advanced|experienced|veteran)\b/.test(t)) months = 36;
  const durRe = new RegExp(`${NUM}\\s*(?:and a half\\s*)?-?\\s*(years?|yrs?|months?|weeks?)\\b(\\s+ago)?`, 'g');
  let m;
  while ((m = durRe.exec(t))) {
    const [whole, n, unit, ago] = m;
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    if (ago || /\b(every|next|in|within|times|days|sessions|x|per)\s*$/.test(before)) continue;
    if (/^\s*-?\s*(long\s+)?(cycles?|rotation|block|programme?|plan)\b/.test(t.slice(m.index + whole.length))) continue; // "a 3 week cycle"
    if (/\b(cycles?|rotation|block)\s+(of|over|lasting|for)\s*$/.test(t.slice(Math.max(0, m.index - 24), m.index))) continue;
    if ((n === 'a' || n === 'an') && unit.startsWith('week')) continue; // "three times a week"
    let v = toNum(n) + (/and a half/.test(whole) ? 0.5 : 0);
    v = unit.startsWith('y') ? v * 12 : unit.startsWith('w') ? v / 4.345 : v;
    months = Math.round(v * 10) / 10;
    break;
  }
  if (months == null && bare && ctx.asked === 'experience') months = toNum(bare[1]) * 12;
  if (months != null) { patch.months = months; got.push('experience'); }

  // Days
  const named = DAY_WORDS.filter(([, re]) => re.test(t)).map(([d]) => d);
  if (/\bweekends?\b/.test(t)) for (const d of ['sat', 'sun']) if (!named.includes(d)) named.push(d);
  const perWeek = t.match(new RegExp(`\\b${NUM}\\s*(?:x|times|days?|sessions?|workouts?)\\b(?!\\s*ago)`)) || t.match(/\b(once|twice)\b/);
  if (named.length) {
    patch.days = WEEKDAYS.filter((d) => named.includes(d)).slice(0, MAX_DAYS);
    patch.daysPerWeek = patch.days.length;
    got.push('days');
  } else if (/\bevery ?day\b/.test(t)) {
    patch.daysPerWeek = MAX_DAYS; patch.days = []; got.push('days');
  } else if (perWeek && Number.isFinite(toNum(perWeek[1])) && toNum(perWeek[1]) >= 1 && toNum(perWeek[1]) <= 7) {
    patch.daysPerWeek = Math.min(Math.round(toNum(perWeek[1])), MAX_DAYS); patch.days = []; got.push('days');
  } else if (bare && ctx.asked === 'days' && toNum(bare[1]) >= 1 && toNum(bare[1]) <= 7) {
    patch.daysPerWeek = Math.min(Math.round(toNum(bare[1])), MAX_DAYS); patch.days = []; got.push('days');
  }

  // Cycle length: "2 week cycle", "a cycle of three weeks", "weekly cycle"
  const cyc = t.match(new RegExp(`\\b${NUM}\\s*-?\\s*weeks?\\s*-?\\s*(?:long\\s+)?(?:cycles?|rotation|block|programme?|plan)\\b`))
    || t.match(new RegExp(`\\b(?:cycles?|rotation|block)\\s+(?:of|over|lasting|for)\\s+${NUM}\\s*weeks?\\b`))
    || (/\b(weekly cycle|same every week|repeat every week)\b/.test(t) ? [null, '1'] : null);
  if (cyc && Number.isFinite(toNum(cyc[1]))) {
    patch.cycleWeeks = Math.min(Math.max(Math.round(toNum(cyc[1])), CYCLE.minWeeks), CYCLE.maxWeeks);
    got.push('cycle');
  }

  // Session length
  let minutes = null;
  const range = t.match(/\b(\d{2,3})\s*(?:-|to)\s*(\d{2,3})\s*(?:min|mins|minutes)\b/);
  const mins = t.match(/\b(\d{2,3})\s*(?:min|mins|minutes)\b/);
  const hours = t.match(new RegExp(`\\b${NUM}\\s*(?:hours?|hrs?)\\b`));
  if (range) minutes = Math.max(+range[1], +range[2]);
  else if (mins) minutes = +mins[1];
  else if (/\bhalf an hour\b/.test(t)) minutes = 30;
  else if (/\bhour and a half\b/.test(t)) minutes = 90;
  else if (hours) minutes = Math.round(toNum(hours[1]) * 60);
  else if (bare && ctx.asked === 'minutes') minutes = toNum(bare[1]) <= 4 ? toNum(bare[1]) * 60 : toNum(bare[1]);
  if (minutes != null && minutes >= 10) { patch.minutes = clampMinutes(minutes); got.push('minutes'); }

  // Exercises to skip or to keep, and limitations
  const avoid = new Set(); const include = new Set(); const tags = new Set(); const limits = [];
  // The same cuts on the text as typed, so a limitation is kept in the user's own letters.
  const cut = /[.;!?\n]|\bbut\b|\bhowever\b|\bthough\b/i;
  const typed = ` ${raw.replace(/[’`]/g, "'")} `.split(cut);
  for (const [ci, clause] of t.split(cut).entries()) {
    let rest = clause;
    for (const [words, ids] of KEYWORDS) {
      for (const w of words) {
        const at = rest.indexOf(w);
        if (at < 0 || /[a-z]/.test(rest[at - 1] || ' ') || /[a-z]/.test(rest[at + w.length] || ' ')) continue;
        const before = rest.slice(0, at);
        const neg = lastIndex(NEG, before); const pos = lastIndex(POS, before);
        const negative = neg >= 0 && (pos < 0 || neg > pos || pos - neg <= 12);
        ids.forEach((id) => (negative ? avoid : include).add(id));
        rest = `${rest.slice(0, at)}${' '.repeat(w.length)}${rest.slice(at + w.length)}`;
        break;
      }
    }
    const part = clause.match(PART);
    if (part && PROBLEM.test(clause) && !/\bno (pain|injur\w*|problems?|issues?)\b/.test(clause)) {
      limits.push((typed[ci] || clause).trim().replace(/^(and|also|i have|i've got)\s+/i, ''));
      if (/shoulder/.test(part[0])) tags.add('shoulder');
      if (/knee/.test(part[0])) tags.add('knee');
      if (/back|spine|disc/.test(part[0]) || /hernia|sciatica/.test(clause)) tags.add('spine');
    }
  }
  if (avoid.size) { patch.avoid = [...avoid]; got.push('avoid'); }
  if (include.size) { patch.include = [...include].filter((id) => !avoid.has(id)); if (patch.include.length) got.push('include'); }
  if (tags.size) patch.avoidTags = [...tags];
  if (limits.length) { patch.limitations = limits.map((l) => l[0].toUpperCase() + l.slice(1)).join('. '); got.push('limitations'); }

  // A free answer to "anything to skip or care about?" is kept as written.
  const nothing = /^\s*(no|nope|none|nothing|no thanks|n\/a|nah|all good|no limitations|no,? nothing)\b[\s.!]*$/.test(raw.toLowerCase());
  if (ctx.asked === 'extras' && !nothing && !got.length && raw.length > 3) { patch.preferences = raw; got.push('preferences'); }
  return { patch, got, nothing };
}

const union = (a = [], b = []) => [...new Set([...a, ...b])];

export function mergeProfile(profile, patch) {
  const p = { ...profile, ...patch };
  p.avoid = union(profile.avoid, patch.avoid).filter((id) => !(patch.include || []).includes(id));
  p.include = union(profile.include, patch.include).filter((id) => !(patch.avoid || []).includes(id));
  p.avoidTags = union(profile.avoidTags, patch.avoidTags);
  if (patch.limitations && profile.limitations && !profile.limitations.includes(patch.limitations)) p.limitations = `${profile.limitations}. ${patch.limitations}`;
  if (patch.preferences && profile.preferences && !profile.preferences.includes(patch.preferences)) p.preferences = `${profile.preferences}. ${patch.preferences}`;
  if (patch.days && !patch.days.length && profile.days?.length && patch.daysPerWeek === profile.days.length) p.days = profile.days;
  return p;
}

/** Fold the model's reading of the profile into ours, checking ids against the catalog. */
export function mergeAiProfile(profile, ai, equipment) {
  if (!ai) return profile;
  const ids = new Set(allExercises(equipment).map((x) => x.id));
  const p = { ...profile };
  if (GOALS[ai.goal]) p.goal = ai.goal;
  if (Number.isFinite(ai.months_training) && ai.months_training >= 0) p.months = Math.round(ai.months_training * 10) / 10;
  const days = WEEKDAYS.filter((d) => (ai.weekdays || []).includes(d)).slice(0, MAX_DAYS);
  if (days.length) { p.days = days; p.daysPerWeek = days.length; } else if (Number.isFinite(ai.days_per_week) && ai.days_per_week >= 1) {
    const n = Math.min(Math.round(ai.days_per_week), MAX_DAYS);
    if (n !== p.daysPerWeek) p.days = [];
    p.daysPerWeek = n;
  }
  if (Number.isFinite(ai.minutes_per_session) && ai.minutes_per_session >= 10) p.minutes = clampMinutes(ai.minutes_per_session);
  if (typeof ai.preferences === 'string') p.preferences = ai.preferences.slice(0, 400);
  if (typeof ai.limitations === 'string') p.limitations = ai.limitations.slice(0, 400);
  if (Array.isArray(ai.avoid_exercise_ids)) p.avoid = ai.avoid_exercise_ids.filter((id) => ids.has(id));
  if (Array.isArray(ai.include_exercise_ids)) p.include = ai.include_exercise_ids.filter((id) => ids.has(id) && !p.avoid.includes(id));
  p.askedExtras = true;
  return p;
}

const QUESTIONS = {
  goal: { text: 'What is your main goal?', chips: ['Build strength', 'Build muscle', 'General fitness', 'Muscular endurance'] },
  experience: { text: 'How long have you been lifting regularly?', chips: ['Just starting', 'About 6 months', 'About a year', '3 years'] },
  days: { text: 'How many days a week can you train? They do not have to be the same days each week.', chips: ['2 days', '3 days', '4 days', '5 days'] },
  minutes: { text: 'How long can one session take, warm-up included?', chips: ['30 minutes', '45 minutes', '60 minutes', '75 minutes'] },
};

export const GREETING = 'Tell me about your goal, your experience and how much time you have for training.';

function ackText(patch, got) {
  const bits = [];
  if (got.includes('goal')) bits.push(GOALS[patch.goal].label.toLowerCase());
  if (got.includes('experience')) bits.push(patch.months < 1 ? 'new to lifting' : `${fmtMonths(patch.months)} of training`);
  if (got.includes('days')) bits.push(patch.days?.length ? patch.days.map((d) => WEEKDAY_SHORT[d]).join(', ') : `${patch.daysPerWeek} day${patch.daysPerWeek === 1 ? '' : 's'} a week`);
  if (got.includes('minutes')) bits.push(`${patch.minutes} min sessions`);
  if (got.includes('cycle')) bits.push(`planned ${patch.cycleWeeks} week${patch.cycleWeeks === 1 ? '' : 's'} ahead`);
  if (got.includes('avoid')) bits.push('some lifts left out');
  if (got.includes('include')) bits.push('your favourites kept in');
  if (got.includes('limitations')) bits.push('a limitation to work around');
  if (got.includes('preferences')) bits.push('your note saved');
  return bits.length ? `Got it: ${bits.join(', ')}.` : '';
}

// ---------------------------------------------------------------- conversation

let busy = false;
const busyListeners = new Set();
export const isBusy = () => busy;
export const onBusy = (fn) => { busyListeners.add(fn); return () => busyListeners.delete(fn); };
const setBusy = (v) => { busy = v; for (const fn of busyListeners) fn(v); };

const lastAsked = (chat) => [...chat].reverse().find((m) => m.role === 'coach' && m.kind !== 'notice')?.asks || null;

function localTurn(text) {
  const st = store.getState();
  const asked = lastAsked(st.chat.slice(0, -1));
  const { patch, got, nothing } = parseProfile(text, { asked });
  let profile = mergeProfile(st.profile, patch);
  if (asked === 'extras') profile = { ...profile, askedExtras: true };
  store.set({ profile });
  const ack = ackText(patch, got);
  const missing = missingFields(profile);
  if (missing.length) {
    const q = QUESTIONS[missing[0]];
    const lead = ack || (asked && !nothing ? 'I did not catch that.' : '');
    store.say('coach', [lead, q.text].filter(Boolean).join(' '), { asks: missing[0], chips: q.chips });
    return;
  }
  if (!profile.askedExtras) {
    const q = 'Are there movements you want to skip, injuries to work around, or exercises you care about?';
    store.say('coach', [ack, q].filter(Boolean).join(' '), { asks: 'extras', chips: ['No, nothing'] });
    return;
  }
  if (got.length || !st.plan) {
    store.say('coach', [ack, st.plan ? 'Here is what I would rebuild the plan on.' : 'Here is what I will build the plan on. Tell me if anything is off.'].filter(Boolean).join(' '), { kind: 'assumptions' });
    return;
  }
  store.say('coach', 'With the built-in coach I can change your goal, sessions a week, session length, and which exercises to skip or include. For anything else, connect Claude or OpenAI in Settings, or swap an exercise during a workout.', { chips: ['Rebuild my plan'] });
}

/** Handle one message from the user. */
export async function userSays(text) {
  const message = text.trim();
  if (!message || busy) return;
  store.say('user', message);
  if (/^rebuild my plan$/i.test(message) && !missingFields(store.getState().profile).length) {
    store.say('coach', 'Here is what I would rebuild the plan on.', { kind: 'assumptions' });
    return;
  }
  if (!aiReady()) { localTurn(message); return; }
  const src = aiSource();
  const name = aiName();
  setBusy(true);
  try {
    const st = store.getState();
    const out = await ask(interviewRequest({ profile: st.profile, equipment: st.equipment, plan: st.plan, chat: st.chat.slice(0, -1), message }));
    const now = store.getState();
    const profile = mergeAiProfile(now.profile, out.profile, now.equipment);
    const before = JSON.stringify(now.profile);
    store.set({ profile });
    const changes = now.plan ? fromAiChanges(out.changes, { plan: now.plan, equipment: now.equipment, mode: 'after_session' }) : [];
    const textOut = [out.message, ...out.questions].filter(Boolean).join('\n') || 'Okay.';
    if (changes.length) {
      // What the user asked for is done at once; the chat shows each change with its Undo.
      const update = recordUpdate({ mode: 'coach', source: src, changes });
      store.say('coach', textOut, { via: src, kind: 'proposal', proposalId: update.id });
    } else if (out.ready_for_plan && !missingFields(profile).length && (!now.plan || JSON.stringify(profile) !== before)) {
      store.say('coach', textOut, { via: src, kind: 'assumptions' });
    } else {
      store.say('coach', textOut, { via: src });
    }
  } catch (e) {
    if (e?.code !== 'cancelled') {
      store.say('coach', `${e instanceof AiError ? e.message : `${name} did not answer.`} I carried on with the built-in coach.`, { kind: 'notice' });
      localTurn(message);
    }
  } finally {
    setBusy(false);
  }
}

function planLine(plan) {
  const first = plan.days[0];
  const n = plan.days.length;
  return `Here is my proposal: the next ${n} session${n === 1 ? '' : 's'}, about ${Math.max(...plan.days.map((d) => d.estMinutes))} min each, with rest days between. It starts with ${first.title}: ${first.exercises[0].name.toLowerCase()} first. Tell me what to change, or just train: the plan is updated after every workout.`;
}

/** Build the plan from the confirmed assumptions. */
export async function buildPlan() {
  if (busy) return;
  const st = store.getState();
  if (missingFields(st.profile).length) return;
  let plan = null;
  let via;
  if (aiReady()) {
    const src = aiSource();
    const name = aiName();
    setBusy(true);
    try {
      const out = await ask(newPlanRequest({ profile: st.profile, equipment: st.equipment, weights: st.weights }));
      if (out.plan) {
        const res = normalizePlan(out.plan, st.profile, st.equipment, st.weights);
        for (const d of res.plan.days) fitToBudget(d.exercises, res.plan.minutes);
        plan = fillOptional(refreshPlan({ ...res.plan, source: src, outlook: out.outlook ? { text: out.outlook, by: src } : null }), st.profile, st.equipment, st.weights);
        via = src;
      } else if (out.questions.length) {
        store.say('coach', [out.message, ...out.questions].filter(Boolean).join('\n'), { via: src });
        return;
      }
    } catch (e) {
      if (e?.code === 'cancelled') return;
      store.say('coach', `${e instanceof AiError ? e.message : `${name} could not build the plan.`} I built it with the training rules instead.`, { kind: 'notice' });
    } finally {
      setBusy(false);
    }
  }
  if (!plan) plan = generatePlan(st.profile, st.equipment, st.weights);
  // The list of updates belongs to the old plan, so it goes.
  store.set({ plan, proposals: [], profile: { ...store.getState().profile, askedExtras: true } });
  store.say('coach', planLine(plan), { kind: 'plan', via });
}

// ---------------------------------------------------------------- train now

/**
 * Start a session right now. It goes to the front of the list; the rest follow
 * in the order given, or in the order the rules space them best.
 */
export function startTraining(dayId, { order, rests, easePct = 0, why = '' } = {}) {
  const st = store.getState();
  if (!st.plan || store.activeSession(st) || !st.plan.days.some((d) => d.id === dayId)) return null;
  const now = Date.now();
  const rec = recommend(st.plan, st.sessions, now, { prefer: dayId });
  const rest = (order && order[0] === dayId ? order : rec?.order || [dayId]).filter((id) => id !== dayId);
  const plan = setRests(setOrder(st.plan, [dayId, ...rest]), rests || {});
  const session = startSession(plan, dayId, now, { easePct, why });
  store.putSession(session, { plan });
  return session;
}

/**
 * Check a schedule a model sent against the list, and put it into the plan.
 * Unknown sessions are dropped; sessions it forgot keep their place behind.
 * Returns null when there is nothing usable.
 */
function withSchedule(plan, sched, sessions) {
  if (!sched) return null;
  const state = queueState(plan);
  const open = (state.queue.length ? state.queue : plan.days).map((d) => d.id);
  const first = open.includes(sched.first_session_id) ? sched.first_session_id : null;
  if (!first) return null;
  const asked = (Array.isArray(sched.order) ? sched.order : []).filter((id, i, a) => open.includes(id) && id !== first && a.indexOf(id) === i);
  const fallback = recommend(plan, sessions, Date.now(), { prefer: first })?.order.slice(1) || [];
  const order = [first, ...asked, ...fallback.filter((id) => !asked.includes(id))];
  const rests = {};
  (Array.isArray(sched.rest_days) ? sched.rest_days : []).forEach((v, i) => { if (order[i] && Number.isFinite(Number(v))) rests[order[i]] = v; });
  const ease = Number(sched.ease_percent);
  return {
    order, rests,
    plan: setRests(setOrder(plan, order), rests),
    reason: String(sched.reason || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    easePct: Number.isFinite(ease) ? Math.min(Math.max(Math.round(ease), 0), 20) : 0,
  };
}

/** A finished workout comes off the list, gets its review, and may end the run. */
export function afterWorkout(session) {
  const st = store.getState();
  if (st.plan && session.planId === st.plan.id && session.exercises.some((ex) => ex.sets.some((x) => x.status === 'done'))) {
    store.set({ plan: completeDay(st.plan, session.dayId) });
  }
  const proposal = reviewSession(session.id);
  const plan = store.getState().plan;
  if (plan && runFinished(plan)) planNextRun();
  return proposal;
}

let nextRunCtl = null;

/**
 * The list is done. With a model connected it plans the next run from the
 * results so far; without one, or if it fails, the same run starts again with
 * its exercises taking turns. The model's answer is only used if the user has
 * not already started on the repeat.
 */
export function planNextRun() {
  if (!aiReady()) return;
  const src = aiSource();
  const st = store.getState();
  const planId = st.plan.id;
  nextRunCtl?.abort();
  const ctl = new AbortController();
  nextRunCtl = ctl;
  ask(nextRunRequest({ profile: st.profile, equipment: st.equipment, plan: st.plan, sessions: st.sessions, weights: st.weights }), { signal: ctl.signal })
    .then((out) => {
      const now = store.getState();
      if (!out.plan || !now.plan || now.plan.id !== planId || !runFinished(now.plan) || store.activeSession(now)) return;
      const res = normalizePlan(out.plan, now.profile, now.equipment, now.weights);
      for (const d of res.plan.days) fitToBudget(d.exercises, res.plan.minutes);
      // Rep targets already earned carry over to the same exercise in the new run.
      const reps = {};
      for (const d of now.plan.days) for (const ex of allEntries(d)) reps[ex.exerciseId] = ex.reps;
      for (const d of res.plan.days) for (const ex of allEntries(d)) if (reps[ex.exerciseId]) ex.reps = Math.min(Math.max(reps[ex.exerciseId], ex.repLo), ex.repHi);
      const next = refreshPlan({ ...res.plan, source: src, version: (now.plan.version || 1) + 1, outlook: out.outlook ? { text: out.outlook, by: src } : now.plan.outlook || null });
      next.queue = { ...next.queue, run: queueState(now.plan).run + 1 };
      next.lastUpdate = { at: Date.now(), by: src, text: out.message || 'The next run is planned from your results.' };
      store.set({ plan: next });
      store.say('coach', `${out.message || 'I planned your next run from your results.'} Open the plan to see it, or tell me what to change.`, { via: src, kind: 'plan' });
    })
    .catch(() => { /* the same run simply starts again */ });
}

/**
 * Ask the connected model what makes sense today, given the app's own pick.
 * Returns null when it has nothing usable to add. Everything it says is checked
 * against the list: an unknown session or a made-up order is dropped.
 */
export async function reviewToday(pick, signal) {
  if (!aiReady() || !pick) return null;
  const src = aiSource();
  const st = store.getState();
  const out = await ask(trainNowRequest({ profile: st.profile, equipment: st.equipment, plan: st.plan, sessions: st.sessions, pick }), { signal });
  const now = store.getState();
  if (!now.plan) return null;
  const sched = withSchedule(now.plan, out.schedule, now.sessions);
  if (!sched) return null;
  const day = now.plan.days.find((d) => d.id === sched.order[0]);
  return {
    dayId: day.id, title: day.title,
    reason: sched.reason || out.message || 'This is the session that fits best today.',
    notes: [], order: sched.order, rests: sched.rests, easePct: sched.easePct,
    changes: fromAiChanges(out.changes, { plan: now.plan, equipment: now.equipment, mode: 'after_session' }),
    via: src, same: day.id === pick.dayId,
  };
}

// ---------------------------------------------------------------- plan updates
// Changes to the plan are made at once and written down in a list. Each entry
// says what changed, why, and where it came from, and each change keeps what
// it replaced, so the user can undo it or correct it by hand.

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Make the changes one after another. Ones that no longer point at anything are marked, not made. */
function applyAll(changes, plan, weights, equipment) {
  const out = [];
  for (const c of changes) {
    const res = applyPlanChange(plan, c, equipment, weights);
    if (!res.touched) { out.push({ ...c, status: 'stale' }); continue; }
    plan = res.plan; weights = res.weights;
    out.push({ ...c, status: 'applied', undo: res.undo });
  }
  return { plan, weights, changes: out };
}

/** Take back every change of an update that is still in the plan, newest first. */
function undoAll(update, plan, weights) {
  for (const c of [...update.changes].reverse()) {
    if (!isApplied(c)) continue;
    const res = undoPlanChange(plan, c, weights);
    if (res.touched) { plan = res.plan; weights = res.weights; }
  }
  return { plan, weights };
}

const noted = (plan, by, text) => ({ ...plan, lastUpdate: { at: Date.now(), by, text } });

/** Make a set of changes and write them down as one update. Returns the update. */
export function recordUpdate({ mode, source, sessionId = null, changes, message = '' }) {
  const st = store.getState();
  if (!st.plan) return null;
  const done = applyAll(changes, st.plan, st.weights, st.equipment);
  const made = done.changes.some(isApplied);
  return store.addUpdate({ mode, source, sessionId, message, changes: done.changes },
    made ? { plan: message ? noted(done.plan, source, message) : done.plan, weights: done.weights } : {});
}

const findChange = (updateId, changeId) => store.getState().proposals.find((p) => p.id === updateId)?.changes.find((c) => c.id === changeId) || null;

/** "Undo" on one change. False when the plan has moved on and there is nothing left to take back. */
export function undoChange(updateId, changeId) {
  const st = store.getState();
  const c = findChange(updateId, changeId);
  if (!c || !isApplied(c) || !st.plan) return false;
  const res = undoPlanChange(st.plan, c, st.weights);
  store.patchChange(updateId, changeId, { status: res.touched ? 'undone' : 'stale' }, res.touched ? { plan: res.plan, weights: res.weights } : {});
  return !!res.touched;
}

/** Make a change that was undone (or, in older data, never accepted) after all. */
export function redoChange(updateId, changeId) {
  const st = store.getState();
  const c = findChange(updateId, changeId);
  if (!c || isApplied(c) || !st.plan) return false;
  const res = applyPlanChange(st.plan, c, st.equipment, st.weights);
  store.patchChange(updateId, changeId, res.touched ? { status: 'applied', undo: res.undo } : { status: 'stale' }, res.touched ? { plan: res.plan, weights: res.weights } : {});
  return !!res.touched;
}

/** Correct a change by hand: the plan gets the value the user typed instead. */
export function editChange(updateId, changeId, value) {
  const st = store.getState();
  const c = findChange(updateId, changeId);
  if (!c || !st.plan) return false;
  let { plan, weights } = st;
  if (isApplied(c)) {
    const back = undoPlanChange(plan, c, weights);
    if (!back.touched) { store.patchChange(updateId, changeId, { status: 'stale' }); return false; }
    plan = back.plan; weights = back.weights;
  }
  const edited = withValue(plan, c, value);
  const res = edited ? applyPlanChange(plan, edited, st.equipment, weights) : null;
  if (!res?.touched) return false;
  store.patchChange(updateId, changeId, { value: edited.value, to: edited.to, status: 'edited', undo: res.undo, suggested: c.suggested ?? c.to },
    { plan: res.plan, weights: res.weights });
  return true;
}

// ---------------------------------------------------------------- after a session

const reviews = new Map();

/**
 * A finished workout is compared with the plan and history, and the plan is
 * updated at once. The training rules answer straight away; a connected model
 * then reviews the same workout, and its changes and summary take the place of
 * the rule-based ones unless the user has already undone or corrected any.
 * With no connection the model's review waits and is asked for when the phone
 * is back online.
 */
export function reviewSession(sessionId) {
  const st = store.getState();
  const session = store.sessionById(sessionId);
  if (!session || session.status !== 'done' || session.kind === 'activity' || !st.plan) return null;
  const existing = st.proposals.find((p) => p.mode === 'post_session' && p.sessionId === sessionId);
  if (existing) return existing;
  const rules = postSessionChanges(session, st.plan, st.sessions);
  const done = applyAll(rules, st.plan, st.weights, st.equipment);
  const message = ruleSummary(session, done.changes.filter(isApplied));
  const wantAi = aiReady();
  const offline = wantAi && isOffline();
  const update = store.addUpdate({
    mode: 'post_session', source: 'rules', sessionId, message, changes: done.changes,
    checking: wantAi && !offline ? aiSource() : false, pending: offline,
  }, { plan: noted(done.plan, 'rules', message), weights: done.weights });
  if (wantAi && !offline) askReview(update.id, session, st.plan);
  return update;
}

// `planBefore` is the plan as the workout was done against it, before the rule-based changes.
function askReview(updateId, session, planBefore) {
  const st = store.getState();
  const src = aiSource();
  const ctl = new AbortController();
  reviews.set(updateId, ctl);
  ask(sessionRequest({ mode: 'after_session', profile: st.profile, equipment: st.equipment, plan: planBefore, session, past: st.sessions }), { signal: ctl.signal })
    .then((out) => {
      const now = store.getState();
      const cur = now.proposals.find((p) => p.id === updateId);
      if (!cur || !now.plan) return;
      let { plan, weights } = now;
      let { changes, source } = cur;
      // The model's changes replace the rule-based ones only while the user has left those alone.
      const untouched = now.plan.id === planBefore.id && cur.changes.every((c) => c.status === 'applied' || c.status === 'stale');
      if (untouched) {
        const back = undoAll(cur, plan, weights);
        const ai = fromAiChanges(out.changes, { plan: back.plan, equipment: now.equipment, mode: 'after_session' });
        const made = applyAll(ai, back.plan, back.weights, now.equipment);
        plan = made.plan; weights = made.weights; changes = made.changes; source = src;
      }
      // The order of what is left and the rest days follow the results too.
      const sched = now.plan.id === planBefore.id && !store.activeSession(now) && !runFinished(plan) ? withSchedule(plan, out.schedule, now.sessions) : null;
      if (sched) plan = sched.plan;
      const message = out.message || cur.message;
      store.patchUpdate(updateId, { source, changes, message, schedule: sched?.reason || '', checking: false, pending: false },
        { plan: now.plan.id === planBefore.id ? noted(plan, src, message) : plan, weights });
    })
    .catch((e) => {
      if (e?.code === 'cancelled') return;
      // No connection: the rule-based update stands, and the review is asked for again later.
      store.patchUpdate(updateId, { checking: false, pending: e?.code === 'offline' || isOffline() });
    })
    .finally(() => { if (reviews.get(updateId) === ctl) reviews.delete(updateId); });
}

/**
 * Ask again for reviews that could not be had: the phone was offline, or the
 * page was closed while waiting. Only the newest workout is sent; for older
 * ones the plan has moved on, so their rule-based update stands.
 */
export function retryPending() {
  const st = store.getState();
  const waiting = st.proposals.filter((p) => p.mode === 'post_session' && (p.pending || (p.checking && !reviews.has(p.id))));
  if (!waiting.length) return;
  if (!aiReady()) { // nothing to ask any more
    store.set({ proposals: st.proposals.map((p) => (waiting.includes(p) ? { ...p, pending: false, checking: false } : p)) });
    return;
  }
  if (isOffline()) {
    if (waiting.some((p) => p.checking)) store.set({ proposals: st.proposals.map((p) => (waiting.includes(p) && p.checking ? { ...p, pending: true, checking: false } : p)) });
    return;
  }
  const newest = waiting.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  const session = store.sessionById(newest.sessionId);
  const last = store.doneWorkouts(st)[0];
  const usable = session && last?.id === session.id && st.plan && session.planId === st.plan.id;
  store.set({ proposals: st.proposals.map((p) => (!waiting.includes(p) ? p : { ...p, pending: false, checking: p === newest && usable ? aiSource() : false })) });
  if (!usable) return;
  // The plan as it was before the rule-based changes, when those are all still in place.
  const intact = newest.changes.every((c) => c.status === 'applied' || c.status === 'stale');
  askReview(newest.id, session, intact ? undoAll(newest, st.plan, st.weights).plan : st.plan);
}

/** True while a model's review of the last workout is waiting for a connection. */
export const reviewWaiting = (st = store.getState()) => st.proposals.some((p) => p.pending);

/**
 * A set in a finished workout was corrected by hand. If it is the latest
 * workout, its update is taken back and worked out again from the new numbers.
 * For an older one the plan has moved on, so only the record changes.
 * Returns 'redone', or 'old' when the plan was left alone.
 */
export function recomputeSession(sessionId) {
  const st = store.getState();
  const session = store.sessionById(sessionId);
  if (!session || session.kind === 'activity' || !st.plan) return 'old';
  const latest = store.doneWorkouts(st)[0];
  if (latest?.id !== sessionId || session.planId !== st.plan.id) return 'old';
  const update = st.proposals.find((p) => p.mode === 'post_session' && p.sessionId === sessionId);
  if (update) {
    reviews.get(update.id)?.abort();
    reviews.delete(update.id);
    const back = undoAll(update, st.plan, st.weights);
    store.set({ plan: back.plan, weights: back.weights, proposals: st.proposals.filter((p) => p.id !== update.id) });
  }
  reviewSession(sessionId);
  return 'redone';
}

/**
 * Delete a workout or an activity from history. For the latest workout the
 * changes it led to are taken back and its session is to do again.
 */
export function deleteWorkout(sessionId) {
  const st = store.getState();
  const session = store.sessionById(sessionId);
  if (!session) return;
  const latest = store.doneWorkouts(st)[0];
  const update = st.proposals.find((p) => p.sessionId === sessionId);
  if (update) { reviews.get(update.id)?.abort(); reviews.delete(update.id); }
  if (session.kind !== 'activity' && st.plan && latest?.id === sessionId && session.planId === st.plan.id) {
    const back = update ? undoAll(update, st.plan, st.weights) : { plan: st.plan, weights: st.weights };
    const sameRun = (session.run || 1) === queueState(back.plan).run;
    store.set({ plan: sameRun ? uncompleteDay(back.plan, session.dayId) : back.plan, weights: back.weights });
  }
  // A note on the plan that spoke of this entry goes with it.
  const now = store.getState();
  if (update?.message && now.plan?.lastUpdate?.text === update.message) store.set({ plan: { ...now.plan, lastUpdate: null } });
  store.removeSession(sessionId);
}

// ---------------------------------------------------------------- during a session

let hintCtl = null;

/**
 * After a set is saved, or corrected during the rest: if the result calls for
 * it, the sets still to come are changed at once, with the reason and an Undo
 * on screen. The training rules answer straight away; a connected model's
 * answer, if it arrives while those sets are still to come, replaces theirs.
 * Saving the set never waits for either.
 * @param {object} sessionBefore the session the set belongs to
 * @param {string|number} exRef the exercise, by key or by position
 * @param {number} setIdx
 */
export function afterSetSaved(sessionBefore, exRef, setIdx) {
  let session = store.activeSession();
  if (!session || session.id !== sessionBefore.id) return;
  const exIdx = typeof exRef === 'string' ? session.exercises.findIndex((x) => x.key === exRef) : exRef;
  const ex = session.exercises[exIdx];
  if (!ex) return;
  const hint = inSessionHint(session, exIdx, setIdx);
  if (hint) { session = applyHint(session, hint); store.putSession(session); }
  hintCtl?.abort();
  hintCtl = null;
  if (!aiReady() || isOffline()) return;
  if (!session.exercises.some((x) => x.sets.some((y) => y.status === 'pending'))) return; // no sets left to change
  const st = ex.sets[setIdx];
  if (!st?.actual) return;
  const off = st.actual.reps !== st.target.reps || st.actual.load !== st.target.load || (st.actual.rir != null && (st.actual.rir <= 0 || st.actual.rir >= 3));
  if (!off) return; // on target: nothing for the model to judge
  const src = aiSource();
  const ctl = new AbortController();
  hintCtl = ctl;
  const s0 = store.getState();
  ask(sessionRequest({
    mode: 'in_session', profile: s0.profile, equipment: s0.equipment, plan: s0.plan, session: withoutHint(session), past: s0.sessions,
    alreadyApplied: hint ? hint.changes : [],
  }), { quick: true, signal: ctl.signal })
    .then((out) => {
      const live = store.activeSession();
      // Late answers are dropped: the workout moved on, or the user undid the change for this set.
      if (!live || live.id !== session.id || live.hintUndone) return;
      if (!live.last || live.last.key !== ex.key || live.last.set !== setIdx) return;
      const changes = fromAiChanges(out.changes, { session: withoutHint(live), mode: 'in_session' });
      if (!changes.length) return;
      store.putSession(applyHint(live, { id: store.newId('hint'), source: src, mode: 'in_session', sessionId: live.id, createdAt: Date.now(), changes }));
    })
    .catch(() => { /* the rule-based change, if any, stands */ });
}

// ---------------------------------------------------------------- other activity

const lowerList = (a) => { const l = a.map((x) => x.toLowerCase()); return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`; };

/** What a logged activity means for the plan, in words, from the rules alone. */
export function activityText(act) {
  const groups = activityGroups(act);
  const what = `${act.minutes} min ${act.title.toLowerCase()}, ${(EFFORTS[act.effort]?.label || 'moderate').toLowerCase()} effort`;
  if (!groups.length) return `Logged: ${what}. Too light or too short to change the plan.`;
  return `Logged: ${what}. It counts as work for ${lowerList(groups)}, so sessions that train ${groups.length > 1 ? 'them' : 'it'} hard wait about ${SCHEDULE.recoverHours} hours. The order of your plan follows.`;
}

/**
 * Log a run, a ride or another activity done outside the plan. It is saved
 * with the workouts and counts toward recovery at once (rule REC-4); a
 * connected model then looks at the order and rests of what is left.
 * @param {{type: string, minutes: number, effort: string, daysAgo?: number, note?: string}} input
 */
export function logActivity(input) {
  const act = newActivity(input);
  store.putSession(act);
  const st = store.getState();
  if (!st.plan) return act;
  const message = activityText(act);
  const wantAi = aiReady() && !isOffline() && !store.activeSession(st);
  const update = store.addUpdate({ mode: 'activity', source: 'rules', sessionId: act.id, message, changes: [], checking: wantAi ? aiSource() : false },
    { plan: noted(st.plan, 'rules', message) });
  if (!wantAi) return act;
  const src = aiSource();
  const planId = st.plan.id;
  ask(activityRequest({ profile: st.profile, plan: st.plan, sessions: st.sessions, activity: act }))
    .then((out) => {
      const now = store.getState();
      if (!now.plan || now.plan.id !== planId || !now.proposals.some((p) => p.id === update.id)) return;
      const sched = !store.activeSession(now) && !runFinished(now.plan) ? withSchedule(now.plan, out.schedule, now.sessions) : null;
      const text = out.message || sched?.reason || message;
      store.patchUpdate(update.id, { source: src, message: text, schedule: sched?.reason || '', checking: false }, { plan: noted(sched ? sched.plan : now.plan, src, text) });
    })
    .catch(() => store.patchUpdate(update.id, { checking: false }));
  return act;
}

// ---------------------------------------------------------------- equipment and weights

/**
 * Swap plan exercises that lost their equipment for ones that can be done, at
 * once. A swap the user has undone is not made again by itself; `force` (the
 * "Swap them" button) makes it anyway.
 */
export function reviewEquipment({ force = false } = {}) {
  let st = store.getState();
  if (!st.plan || store.activeSession(st)) return null;
  // Optional extras follow the equipment list quietly: one that can no longer be done gives way to another.
  const filled = fillOptional(st.plan, st.profile, st.equipment, st.weights);
  if (filled !== st.plan) { store.set({ plan: filled }); st = store.getState(); }
  const undone = new Set(st.proposals.filter((p) => p.mode === 'equipment').flatMap((p) => p.changes.filter((c) => c.status === 'undone').map((c) => c.exerciseKey)));
  const changes = equipmentChanges(st.plan, st.equipment, st.profile).filter((c) => force || !undone.has(c.exerciseKey));
  if (!changes.length) return null;
  const swaps = changes.filter((c) => c.field === 'exercise').length;
  const gone = changes.length - swaps;
  const message = `Your equipment list changed. ${[swaps ? `${swaps} exercise${swaps === 1 ? '' : 's'} swapped for one${swaps === 1 ? '' : 's'} you can do` : '', gone ? `${gone} removed because nothing else trains that movement` : ''].filter(Boolean).join(', ')}.`;
  return recordUpdate({ mode: 'equipment', source: 'rules', changes, message });
}

const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

/**
 * Read a free-text description of the gym and save the equipment it names.
 * The connected model reads it; the built-in reader otherwise, or if the model fails.
 *
 * When the text names a maker or a model ("these are from Technogym: ..."), the
 * exact machines are identified and what is known about them is saved with the
 * equipment: how each works and what it isolates. Where the connection can
 * search the web, each one is then looked up, and only details with a source
 * address the search really returned are marked as found on the web.
 *
 * Returns what changed, in display names, for the screen to show.
 * @param {string} text
 * @param {(stage: string, count?: number) => void} [onStage] progress for the screen
 */
export async function readEquipment(text, onStage = () => {}) {
  const input = String(text || '').trim();
  if (!input) return null;
  let read = null;
  let via = 'rules';
  let note = '';
  if (aiReady()) {
    const src = aiSource();
    const name = aiName();
    try {
      const out = await ask(equipmentRequest({ equipment: store.getState().equipment, text: input }));
      if (out.equipment) {
        const e = out.equipment;
        read = {
          add: strings(e.add_ids),
          off: strings(e.unavailable_ids),
          custom: (Array.isArray(e.custom) ? e.custom : []).filter((c) => c && typeof c.name === 'string').map((c) => ({ name: c.name, pattern: c.movement_id })),
          unknown: strings(e.unrecognized),
          machines: (Array.isArray(e.machines) ? e.machines : []).filter((m) => m && typeof m.ref === 'string')
            .map((m) => ({ ref: m.ref, vendor: m.vendor, model: m.model, how: m.how_it_works, isolates: m.isolates, loading: m.loading, sketch: m.looks_like, notes: m.notes, basis: 'memory' })),
        };
        via = src;
      }
    } catch (e) {
      if (e?.code === 'cancelled') return null;
      note = `${e instanceof AiError ? e.message : `${name} did not answer.`} I read it with the built-in reader instead.`;
    }
  }
  if (!read) read = parseEquipmentText(input);
  const res = applyEquipmentRead(store.getState().equipment, read, () => store.newId('cm'));
  if (res.changed) store.set({ equipment: res.equipment });
  let { described } = res.summary;
  let changed = res.changed;
  let lookedUp = false;

  // Named machines: find each on the web when this connection can search.
  const named = described.filter((d) => d.label && d.basis !== 'web');
  if (named.length && canLookUp()) {
    onStage('lookup', named.length);
    try {
      const now = store.getState().equipment;
      const { found, urls } = await lookUpMachines(named.map((d) => {
        const det = machineDetail(now, d.id) || {};
        return { ref: d.id, name: d.name, vendor: det.vendor, model: det.model };
      }));
      const merged = applyMachineLookup(store.getState().equipment, found, urls);
      if (merged.described.length) {
        store.set({ equipment: merged.equipment });
        described = described.map((d) => merged.described.find((x) => x.id === d.id) || d);
        changed = true;
      }
      lookedUp = true;
    } catch (e) {
      if (e?.code === 'cancelled') return null;
      note = `${note ? `${note} ` : ''}The web lookup did not work (${e instanceof AiError ? e.message : 'no answer'}), so the machine details are not checked.`;
    }
  }
  return { ...res.summary, described, via, note, changed, lookedUp, couldLookUp: canLookUp() };
}

/**
 * Set by hand what the user lifts on an exercise: baseline before the first
 * workout, or a correction later. Goes into the plan wherever the exercise is.
 */
export function setWeight(exerciseId, loadType, value, step) {
  const st = store.getState();
  const v = Math.max(0, Math.round(Number(value) * 100) / 100);
  const stp = Number(step) > 0 ? Number(step) : 2.5;
  const weights = { ...st.weights, [exerciseId]: { value: v, step: stp, type: loadType, at: Date.now(), by: 'hand' } };
  const inPlan = st.plan?.days.some((d) => allEntries(d).some((ex) => ex.exerciseId === exerciseId));
  store.set({ weights, ...(inPlan ? { plan: setPlanLoad(st.plan, exerciseId, { value: v, step: stp }) } : {}) });
}

/** Remember a weight for an exercise and write it into the plan. */
export function rememberWeight(exerciseId, loadType, value, step) {
  const st = store.getState();
  const weights = { ...st.weights, [exerciseId]: { value, step, type: loadType, at: Date.now() } };
  const hasBlank = st.plan?.days.some((d) => allEntries(d).some((ex) => ex.exerciseId === exerciseId && !ex.load));
  return { weights, ...(hasBlank ? { plan: setPlanLoad(st.plan, exerciseId, { value, step }) } : {}) };
}

export { levelFor, canDo, trainingDays };
