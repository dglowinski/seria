// The coach: reads what the user says, keeps the profile, asks for what is
// missing, shows its assumptions and builds or updates the plan.
//
// With Claude connected, Claude does the reading and planning. Without it, a
// small built-in reader handles the common answers and the rule-based
// generator builds the plan. Either way the app keeps working.

import { GOALS, MAX_DAYS, levelFor } from '../domain/rules.js';
import { KEYWORDS, allExercises, canDo, parseEquipmentText, applyEquipmentRead } from '../domain/catalog.js';
import {
  WEEKDAYS, WEEKDAY_SHORT, WEEKDAY_NAMES, missingFields, generatePlan, normalizePlan, fitToBudget, refreshPlan, fmtMonths,
  trainingDays, clampMinutes, setPlanLoad,
} from '../domain/planner.js';
import { inSessionHint, postSessionChanges, equipmentChanges, applyPlanChange, fromAiChanges } from '../domain/progression.js';
import { hintApplies, setHint } from '../domain/session.js';
import * as store from '../store.js';
import { ask, aiReady, AiError } from './claude.js';
import { interviewRequest, newPlanRequest, sessionRequest, equipmentRequest } from './prompts.js';

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
  for (const clause of t.split(/[.;!?\n]|\bbut\b|\bhowever\b|\bthough\b/)) {
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
      limits.push(clause.trim().replace(/^(and|also|i have|i've got)\s+/, ''));
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

/** Fold Claude's reading of the profile into ours, checking ids against the catalog. */
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
  days: { text: 'How many days a week can you train, and which days suit you?', chips: ['2 days', '3 days', 'Mon, Wed, Fri', '4 days'] },
  minutes: { text: 'How long can one session take, warm-up included?', chips: ['30 minutes', '45 minutes', '60 minutes', '75 minutes'] },
};

export const GREETING = 'Tell me about your goal, your experience and how much time you have for training.';

function ackText(patch, got) {
  const bits = [];
  if (got.includes('goal')) bits.push(GOALS[patch.goal].label.toLowerCase());
  if (got.includes('experience')) bits.push(patch.months < 1 ? 'new to lifting' : `${fmtMonths(patch.months)} of training`);
  if (got.includes('days')) bits.push(patch.days?.length ? patch.days.map((d) => WEEKDAY_SHORT[d]).join(', ') : `${patch.daysPerWeek} day${patch.daysPerWeek === 1 ? '' : 's'} a week`);
  if (got.includes('minutes')) bits.push(`${patch.minutes} min sessions`);
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
    const needDays = !(profile.days || []).length;
    const q = `${needDays ? 'Which days suit you? ' : ''}Are there movements you want to skip, injuries to work around, or exercises you care about?`;
    store.say('coach', [ack, q].filter(Boolean).join(' '), { asks: 'extras', chips: needDays ? ['Mon, Wed, Fri', 'No, nothing'] : ['No, nothing'] });
    return;
  }
  if (got.length || !st.plan) {
    store.say('coach', [ack, st.plan ? 'Here is what I would rebuild the plan on.' : 'Here is what I will build the plan on. Tell me if anything is off.'].filter(Boolean).join(' '), { kind: 'assumptions' });
    return;
  }
  store.say('coach', 'With the built-in coach I can change your goal, days, session length, and which exercises to skip or include. For anything else, connect Claude in Settings, or swap an exercise during a workout.', { chips: ['Rebuild my plan'] });
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
      const p = store.addProposal({ mode: 'coach', source: 'claude', changes });
      store.say('coach', textOut, { via: 'claude', kind: 'proposal', proposalId: p.id });
    } else if (out.ready_for_plan && !missingFields(profile).length && (!now.plan || JSON.stringify(profile) !== before)) {
      store.say('coach', textOut, { via: 'claude', kind: 'assumptions' });
    } else {
      store.say('coach', textOut, { via: 'claude' });
    }
  } catch (e) {
    if (e?.code !== 'cancelled') {
      store.say('coach', `${e instanceof AiError ? e.message : 'Claude did not answer.'} I carried on with the built-in coach.`, { kind: 'notice' });
      localTurn(message);
    }
  } finally {
    setBusy(false);
  }
}

function planLine(plan) {
  const first = plan.days[0];
  return `Your week is ready: ${plan.days.map((d) => `${WEEKDAY_SHORT[d.weekday]} ${d.title.toLowerCase()} (${d.estMinutes} min)`).join(', ')}. ${WEEKDAY_NAMES[first.weekday]} starts with ${first.exercises[0].name.toLowerCase()}.`;
}

/** Build the week from the confirmed assumptions. */
export async function buildPlan() {
  if (busy) return;
  const st = store.getState();
  if (missingFields(st.profile).length) return;
  let plan = null;
  let via;
  if (aiReady()) {
    setBusy(true);
    try {
      const out = await ask(newPlanRequest({ profile: st.profile, equipment: st.equipment, weights: st.weights }));
      if (out.plan) {
        const res = normalizePlan(out.plan, st.profile, st.equipment, st.weights);
        for (const d of res.plan.days) fitToBudget(d.exercises, res.plan.minutes);
        plan = refreshPlan(res.plan);
        via = 'claude';
      } else if (out.questions.length) {
        store.say('coach', [out.message, ...out.questions].filter(Boolean).join('\n'), { via: 'claude' });
        return;
      }
    } catch (e) {
      if (e?.code === 'cancelled') return;
      store.say('coach', `${e instanceof AiError ? e.message : 'Claude could not build the plan.'} I built it with the training rules instead.`, { kind: 'notice' });
    } finally {
      setBusy(false);
    }
  }
  if (!plan) plan = generatePlan(st.profile, st.equipment, st.weights);
  // Old proposals point at the old plan, so they go.
  store.set({ plan, proposals: [], profile: { ...store.getState().profile, askedExtras: true } });
  store.say('coach', planLine(plan), { kind: 'plan', via });
}

// ---------------------------------------------------------------- applying changes

export function applyChange(proposalId, changeId) {
  const st = store.getState();
  const p = st.proposals.find((x) => x.id === proposalId);
  const c = p?.changes.find((x) => x.id === changeId);
  if (!c || c.status !== 'open' || !st.plan) return false;
  const res = applyPlanChange(st.plan, c, st.equipment, st.weights);
  store.markChange(proposalId, changeId, res.touched ? 'applied' : 'stale', res.touched ? { plan: res.plan, weights: res.weights } : {});
  return !!res.touched;
}

export function keepPlan(proposalId, changeId) {
  store.markChange(proposalId, changeId, 'kept');
}

// ---------------------------------------------------------------- after a session

const reviews = new Map();

/** Compare a finished session with the plan and history; file the proposals. */
export function reviewSession(sessionId) {
  const st = store.getState();
  const session = store.sessionById(sessionId);
  if (!session || session.status !== 'done' || !st.plan) return null;
  const existing = st.proposals.find((p) => p.mode === 'post_session' && p.sessionId === sessionId);
  if (existing) return existing;
  const rules = postSessionChanges(session, st.plan, st.sessions);
  const wantAi = aiReady();
  const proposal = store.addProposal({ mode: 'post_session', source: 'rules', sessionId, changes: rules, checking: wantAi });
  if (wantAi) {
    const ctl = new AbortController();
    reviews.set(proposal.id, ctl);
    ask(sessionRequest({ mode: 'after_session', profile: st.profile, equipment: st.equipment, plan: st.plan, session, past: st.sessions }), { signal: ctl.signal })
      .then((out) => {
        const now = store.getState();
        const cur = now.proposals.find((p) => p.id === proposal.id);
        if (!cur) return;
        // Claude's review replaces the rule-based one only while the user has not acted on it.
        const untouched = cur.changes.every((c) => c.status === 'open');
        const ai = fromAiChanges(out.changes, { plan: now.plan, equipment: now.equipment, mode: 'after_session' }).map((c) => ({ status: 'open', ...c }));
        store.set({
          proposals: now.proposals.map((p) => (p.id !== proposal.id ? p : untouched
            ? { ...p, source: 'claude', changes: ai, message: out.message, checking: false }
            : { ...p, checking: false })),
        });
      })
      .catch(() => {
        const now = store.getState();
        store.set({ proposals: now.proposals.map((p) => (p.id === proposal.id ? { ...p, checking: false } : p)) });
      })
      .finally(() => reviews.delete(proposal.id));
  }
  return proposal;
}

// ---------------------------------------------------------------- during a session

let hintCtl = null;

/**
 * After a set is saved: the rule-based hint shows at once; Claude's, if it
 * arrives while the sets it talks about are still to come, replaces it.
 * Saving the set never waits for either.
 */
export function afterSetSaved(sessionBefore, exIdx, setIdx) {
  let session = store.activeSession();
  if (!session || session.id !== sessionBefore.id) return;
  const hint = inSessionHint(session, exIdx, setIdx);
  if (hint) { session = setHint(session, hint); store.putSession(session); }
  hintCtl?.abort();
  hintCtl = null;
  if (!aiReady()) return;
  const st = session.exercises[exIdx]?.sets[setIdx];
  if (!st?.actual) return;
  const off = st.actual.reps !== st.target.reps || st.actual.load !== st.target.load || (st.actual.rir != null && (st.actual.rir <= 0 || st.actual.rir >= 3));
  if (!off) return; // on target: nothing for Claude to judge
  const ctl = new AbortController();
  hintCtl = ctl;
  const s0 = store.getState();
  ask(sessionRequest({
    mode: 'in_session', profile: s0.profile, equipment: s0.equipment, plan: s0.plan, session, past: s0.sessions,
    alreadyProposed: hint ? hint.changes : [],
  }), { quick: true, signal: ctl.signal })
    .then((out) => {
      const live = store.activeSession();
      if (!live || live.id !== session.id) return;
      const changes = fromAiChanges(out.changes, { session: live, mode: 'in_session' });
      if (!changes.length) return;
      const aiHint = { id: store.newId('hint'), source: 'claude', mode: 'in_session', sessionId: live.id, createdAt: Date.now(), changes };
      // A late answer only shows if it is about sets that are still to come.
      if (hintApplies(live, aiHint)) store.putSession(setHint(live, aiHint));
    })
    .catch(() => { /* keep going on the last approved plan */ });
}

// ---------------------------------------------------------------- equipment and weights

/** File swaps for plan exercises that lost their equipment. */
export function reviewEquipment() {
  const st = store.getState();
  if (!st.plan) return null;
  const changes = equipmentChanges(st.plan, st.equipment, st.profile);
  if (!changes.length) return null;
  return store.addProposal({ mode: 'equipment', source: 'rules', sessionId: null, changes });
}

const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

/**
 * Read a free-text description of the gym and save the equipment it names.
 * Claude reads it when connected; the built-in reader otherwise, or if Claude fails.
 * Returns what changed, in display names, for the screen to show.
 */
export async function readEquipment(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  let read = null;
  let via = 'rules';
  let note = '';
  if (aiReady()) {
    try {
      const out = await ask(equipmentRequest({ equipment: store.getState().equipment, text: input }));
      if (out.equipment) {
        const e = out.equipment;
        read = {
          add: strings(e.add_ids),
          off: strings(e.unavailable_ids),
          custom: (Array.isArray(e.custom) ? e.custom : []).filter((c) => c && typeof c.name === 'string').map((c) => ({ name: c.name, pattern: c.movement_id })),
          unknown: strings(e.unrecognized),
        };
        via = 'claude';
      }
    } catch (e) {
      if (e?.code === 'cancelled') return null;
      note = `${e instanceof AiError ? e.message : 'Claude did not answer.'} I read it with the built-in reader instead.`;
    }
  }
  if (!read) read = parseEquipmentText(input);
  const res = applyEquipmentRead(store.getState().equipment, read, () => store.newId('cm'));
  if (res.changed) store.set({ equipment: res.equipment });
  return { ...res.summary, via, note, changed: res.changed };
}

/** Remember a weight for an exercise and write it into the plan. */
export function rememberWeight(exerciseId, loadType, value, step) {
  const st = store.getState();
  const weights = { ...st.weights, [exerciseId]: { value, step, type: loadType, at: Date.now() } };
  const hasBlank = st.plan?.days.some((d) => d.exercises.some((ex) => ex.exerciseId === exerciseId && !ex.load));
  return { weights, ...(hasBlank ? { plan: setPlanLoad(st.plan, exerciseId, { value, step }) } : {}) };
}

export { levelFor, canDo, trainingDays };
