// Plan tab: the plan as a list you can browse (train this, rest, train that),
// one "Train now" button, a session in detail, other activity, the long view,
// and the list of what was changed in the plan and why.

import { html, useState, useEffect, useStore, Sheet, Dock, NumberInput, go, toast, restText, dateText, plural } from './kit.js';
import * as store from '../store.js';
import { fmtLoad, loadMethod, timeBreakdown, brokenExercises, weeklySets, buildOutlook, num, dayOptional, optionalMinutes, blankWeights, pairSavings, pairMate, pairRestSec, oppositePair, units } from '../domain/planner.js';
import { recommend, plannedNext, timeline, queueState, dayStatus, skipDay, unskipDay, daysBetween } from '../domain/schedule.js';
import { describeChange, canUndo, isApplied, EDITABLE } from '../domain/progression.js';
import { exerciseById, machineForExercise, machineLabel, sketchForExercise } from '../domain/catalog.js';
import { Sketch } from './sketch.js';
import { RULES_VERSION, ACTIVITIES, EFFORTS, SCHEDULE, activityGroups } from '../domain/rules.js';
import { undoChange, redoChange, editChange, recordUpdate, reviewEquipment, startTraining, reviewToday, logActivity, reviewWaiting, reviewRunning, askAgain, canRestorePlan, restorePlan } from '../ai/coach.js';
import { sourceName, aiReady, aiName } from '../ai/ai.js';
import { primeAudio } from '../platform.js';
import { APP_VERSION } from './prefs.js';
import { PastResults } from './past.js';
import { WeightSheet, WeightsFirst } from './weights.js';

/**
 * Start a session and open the workout screen. When the session has exercises
 * with no weight yet and `offer` is given, it is called instead, so the screen
 * can offer to enter them first; the start then comes from there.
 */
function begin(dayId, opts, offer) {
  primeAudio();
  if (store.activeSession()) { go('workout'); return; }
  const day = store.getState().plan?.days.find((d) => d.id === dayId);
  if (offer && blankWeights(day).length) { offer({ dayId, opts }); return; }
  if (startTraining(dayId, opts)) go('workout');
}

/** The offer to enter missing weights before a workout, for the screens that start one. */
function WeightsOffer({ first, setFirst }) {
  const day = first ? store.getState().plan?.days.find((d) => d.id === first.dayId) : null;
  if (!day) return null;
  return html`<${WeightsFirst} day=${day} onClose=${() => setFirst(null)}
    onStart=${() => { setFirst(null); begin(first.dayId, first.opts); }} />`;
}

const restText1 = (n) => (n === 0 ? 'no rest day' : n === 1 ? '1 rest day' : `${n} rest days`);
const whenText = (inDays, at) => (inDays <= 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : new Date(at).toLocaleDateString('en-GB', { weekday: 'long' }) + (inDays > 6 ? `, ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''));

/**
 * "Train now" on a day the plan did not have for the next session, or when the
 * user picks a session by hand. Shows what makes sense today and why, and how
 * the rest of the plan follows from it. The rules answer at once; the connected
 * model reviews the pick and can replace it. Starting accepts the update.
 */
function TrainNow({ plan, sessions, prefer, onClose, onStart }) {
  const [rec] = useState(() => recommend(plan, sessions, Date.now(), prefer ? { prefer } : {}));
  const wantAi = aiReady() && !prefer;
  const [ai, setAi] = useState({ state: wantAi ? 'busy' : 'off', pick: null });
  const [plain, setPlain] = useState(false); // stay with the rule-based pick
  const [choosing, setChoosing] = useState(false);
  const [lighter, setLighter] = useState(true);
  useEffect(() => {
    if (!wantAi) return undefined;
    const ctl = new AbortController();
    reviewToday(rec, ctl.signal)
      .then((pick) => setAi({ state: pick ? 'done' : 'none', pick }))
      .catch((e) => { if (e?.code !== 'cancelled') setAi({ state: 'failed', pick: null }); });
    return () => ctl.abort();
  }, []);

  const use = ai.pick && !plain ? ai.pick : rec;
  const byId = (id) => plan.days.find((d) => d.id === id);
  const day = byId(use.dayId);
  const restOf = (id) => use.rests?.[id] ?? byId(id)?.restAfter ?? 1;
  const q = queueState(plan);
  const queue = q.queue.length ? q.queue : plan.days;
  const start = (pick) => {
    // Changes the model made to later sessions go in with the start, and show in the list of changes.
    if (ai.pick && pick === ai.pick && ai.pick.changes.length) recordUpdate({ mode: 'coach', source: ai.pick.via, changes: ai.pick.changes, message: `Changed when you started ${pick.title}.` });
    onClose();
    onStart(pick.dayId, { order: pick.order, rests: pick.rests, easePct: lighter ? pick.easePct : 0, why: pick.reason });
  };

  return html`<${Sheet} title=${prefer ? 'Start this session' : 'Train now'} onClose=${onClose}>
    <div class="change" data-testid="today-pick">
      <div class="spread"><span class="eyebrow">${prefer ? 'Your pick' : 'Makes sense today'}</span><span class="tag">From ${use === ai.pick ? sourceName(ai.pick.via) : 'the training rules'}</span></div>
      <h3>${use.title}</h3>
      <p class="small muted">About ${day.estMinutes} min · ${day.exercises.map((x) => x.name).slice(0, 3).join(', ')}${day.exercises.length > 3 ? ` and ${day.exercises.length - 3} more` : ''}</p>
      <p class="small" data-testid="today-reason">${use.reason}</p>
      ${use.notes.map((n) => html`<p class="small muted">${n}</p>`)}
      ${use.easePct > 0 && html`<div class="chips"><button class=${`chip ${lighter ? 'on' : ''}`} role="switch" aria-checked=${lighter} data-testid="ease" onClick=${() => setLighter(!lighter)}>${use.easePct}% lighter today</button></div>`}
    </div>
    ${ai.state === 'busy' && html`<p class="small muted" data-testid="today-checking">${aiName()} is checking this against your history. You can start now or wait a moment.</p>`}
    ${ai.state === 'done' && ai.pick.same && !plain && html`<p class="small muted">${sourceName(ai.pick.via)} looked at your history and agrees.</p>`}
    ${ai.state === 'done' && !ai.pick.same && html`<div class="chips"><button class="chip" onClick=${() => setPlain(!plain)}>${plain ? `Use ${sourceName(ai.pick.via)}'s pick: ${ai.pick.title}` : `Use the rule-based pick instead: ${rec.title}`}</button></div>`}
    ${use === ai.pick && ai.pick.changes.length > 0 && html`<p class="small muted">${sourceName(ai.pick.via)} also makes ${plural(ai.pick.changes.length, 'change')} to later sessions when you start. You can see and undo ${ai.pick.changes.length === 1 ? 'it' : 'them'} under "What changed".</p>`}
    ${use.order.length > 1 && html`<div class="stack tight" data-testid="today-then">
      <p class="small muted">The plan from here:</p>
      <p class="small">${use.order.slice(1, 6).map((id, i) => `${restText1(restOf(use.order[i]))}, then ${byId(id)?.title}`).join(' · ')}${use.order.length > 6 ? ' …' : ''}</p>
    </div>`}
    <button class="cta" data-testid="today-start" onClick=${() => start(use)}>Start ${use.title}</button>
    ${!choosing && html`<button class="cta ghost" data-testid="today-other" onClick=${() => setChoosing(true)}>Choose another session</button>`}
    ${choosing && html`<div class="stack">
      <p class="small muted">Any session can go first. The rest of the plan moves around it.</p>
      ${queue.filter((d) => d.id !== use.dayId).map((d) => html`<button class="row" onClick=${() => { const r = recommend(plan, sessions, Date.now(), { prefer: d.id }); start({ ...r, easePct: use.easePct }); }}>
        <span class="stack tight"><b>${d.title}</b><span class="sub">${d.estMinutes} min · ${d.exercises.slice(0, 2).map((x) => x.name).join(', ')}</span></span><span class="accent">Start</span></button>`)}
    </div>`}
    <button class="cta ghost" onClick=${onClose}>Not today</button>
  <//>`;
}

const agoText = (ts, now) => { const d = daysBetween(ts, now); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const lowerList = (a) => { const l = a.map((x) => x.toLowerCase()); return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`; };

/** Log a run, a ride or anything else done outside the plan: what, how long, how hard. */
function ActivitySheet({ onClose }) {
  const [type, setType] = useState('run');
  const [minutes, setMinutes] = useState(30);
  const [effort, setEffort] = useState('moderate');
  const [daysAgo, setDaysAgo] = useState(0);
  const groups = activityGroups({ activity: type, minutes, effort });
  const save = () => {
    if (!(minutes > 0)) { toast('Enter how long it took'); return; }
    logActivity({ type, minutes, effort, daysAgo });
    onClose();
    toast('Activity logged');
  };
  return html`<${Sheet} title="Log another activity" onClose=${onClose}>
    <div class="field"><span>What was it</span>
      <div class="chips" role="radiogroup" aria-label="Activity">${Object.entries(ACTIVITIES).map(([id, a]) => html`
        <button class=${`chip ${type === id ? 'on' : ''}`} role="radio" aria-checked=${type === id} data-testid=${`act-${id}`} onClick=${() => setType(id)}>${a.label}</button>`)}</div>
    </div>
    <label class="field"><span>How long, in minutes</span>
      <${NumberInput} id="act-minutes" wide value=${minutes} min=${1} onChange=${(v) => setMinutes(Math.round(v))} label="Minutes" /></label>
    <div class="chips">${[20, 30, 45, 60, 90].map((m) => html`<button class=${`chip ${minutes === m ? 'on' : ''}`} onClick=${() => setMinutes(m)}>${m} min</button>`)}</div>
    <div class="field"><span>How hard</span>
      <div class="chips" role="radiogroup" aria-label="Effort">${Object.entries(EFFORTS).map(([id, e]) => html`
        <button class=${`chip ${effort === id ? 'on' : ''}`} role="radio" aria-checked=${effort === id} data-testid=${`effort-${id}`} onClick=${() => setEffort(id)}>${e.label}</button>`)}</div>
    </div>
    <div class="field"><span>When</span>
      <div class="chips" role="radiogroup" aria-label="When">${['Today', 'Yesterday', '2 days ago'].map((l, i) => html`
        <button class=${`chip ${daysAgo === i ? 'on' : ''}`} role="radio" aria-checked=${daysAgo === i} onClick=${() => setDaysAgo(i)}>${l}</button>`)}</div>
    </div>
    <p class="note small" data-testid="act-effect">${groups.length
      ? `Counts as work for ${lowerList(groups)}. Sessions that train ${groups.length > 1 ? 'them' : 'it'} hard wait about ${SCHEDULE.recoverHours} hours, and the plan order follows.`
      : 'Too light or too short to change the plan. It is still kept in your history.'}</p>
    <button class="cta" data-testid="act-save" onClick=${save}>Save activity</button>
  <//>`;
}

export function PlanScreen() {
  const state = useStore();
  const { plan } = state;
  const [sheet, setSheet] = useState(null);
  const [first, setFirst] = useState(null); // a start held back while missing weights are offered
  const active = store.activeSession(state);
  if (!plan) {
    return html`
      <main class="main with-tabs">
        <div class="empty">
          <p class="eyebrow">Plan</p>
          <h2>No plan yet<span class="accent">.</span></h2>
          <p class="muted">Tell the coach how you want to train. You get a plan built around your goal, your time and the equipment in your gym: train this, rest, train that. Train on any day you like; the app walks you through every set and keeps the plan up to date.</p>
          <button class="cta" onClick=${() => go('coach')}>Talk to the coach</button>
          <button class="cta ghost" onClick=${() => go('equipment')}>Set up my gym first</button>
          <button class="cta ghost" onClick=${() => go('weights')}>Enter the weights I lift</button>
        </div>
      </main>`;
  }
  const now = Date.now();
  const rec = recommend(plan, state.sessions, now); // if you trained this minute
  const planned = plannedNext(plan, state.sessions, now); // what the plan has next, and when
  const line = timeline(plan, state.sessions, now);
  const broken = brokenExercises(plan, state.equipment);
  const volume = weeklySets(plan);
  const dueIn = line[0]?.inDays ?? 0;
  const firstAgain = line.findIndex((x) => x.again);
  const blank = new Set(plan.days.flatMap((d) => d.exercises).filter((ex) => ex.loadType !== 'bodyweight' && !ex.load).map((ex) => ex.exerciseId)).size;
  const recent = state.sessions.filter((x) => x.kind === 'activity' && now - x.startedAt < 3 * 864e5).sort((a, b) => b.startedAt - a.startedAt);
  const waiting = reviewWaiting(state);
  const thinking = reviewRunning(state);
  const outlook = buildOutlook(plan);
  const pairsOn = !!state.profile.pairs;
  const saves = pairSavings(plan);
  const togglePairs = () => {
    store.set({ profile: { ...state.profile, pairs: !pairsOn } });
    toast(pairsOn ? 'Pairs off. One exercise at a time' : saves > 0 ? `Pairs on. Sessions are about ${saves} min shorter` : 'Pairs on');
  };

  const trainNow = () => {
    if (active) { go('workout'); return; }
    // On the planned day there is nothing to discuss: start. On any other day, show what makes sense now.
    if (rec.onSchedule) begin(rec.dayId, { order: rec.order, why: rec.reason }, setFirst); else setSheet('train');
  };

  return html`
    <main class="main with-tabs with-dock">
      <div class="spread">
        <div class="stack tight"><p class="eyebrow">Plan</p><h2>Your plan</h2></div>
        <small class="right" data-testid="plan-shape">${plan.perWeek} a week · any days</small>
      </div>
      ${thinking && html`<div class="note thinking small" data-testid="plan-checking" role="status"><b><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>${sourceName(thinking.checking === true ? 'claude' : thinking.checking)} is updating your plan</b>
        It is going through your last workout. ${thinking.source === 'rules' ? 'The training rules have updated the plan for now; its changes take their place when it answers.' : 'The changes show here when it answers.'}</div>`}
      ${waiting && html`<p class="note warn small" data-testid="plan-pending"><b>The plan will be updated when you are online</b>Your last workout is saved and the training rules have updated the plan. ${aiName()} reviews it as soon as there is a connection.</p>`}
      ${plan.lastUpdate && now - plan.lastUpdate.at < 14 * 864e5 && html`<div class="note small" data-testid="last-update"><b>Updated ${dateText(plan.lastUpdate.at)} by ${sourceName(plan.lastUpdate.by)}</b>${plan.lastUpdate.text}
        ${(state.proposals.length > 0 || canRestorePlan(state)) && html`<div class="chips" style="margin-top:8px">
          ${state.proposals.length > 0 && html`<button class="chip" data-testid="see-changes" onClick=${() => go('review')}>What changed</button>`}
          ${canRestorePlan(state) && html`<button class="chip" data-testid="plan-restore" onClick=${() => { if (restorePlan()) toast('The old plan is back'); }}>Put the old plan back</button>`}</div>`}</div>`}
      ${broken.length > 0 && html`<div class="note warn">
        <b>${plural(broken.length, 'exercise')} need${broken.length === 1 ? 's' : ''} equipment you no longer have</b>
        <span class="muted small">${[...new Set(broken.map((b) => b.name))].join(', ')}</span>
        <div class="chips" style="margin-top:8px"><button class="chip accent" data-testid="swap-broken" onClick=${() => { if (reviewEquipment({ force: true })) { toast('Plan updated'); go('review'); } }}>Swap them</button></div>
      </div>`}

      <ol class="stack" data-testid="timeline">
        ${line.map((item, i) => html`
          ${i === firstAgain && i > 0 && html`<li class="small muted center" data-testid="next-round">Then the cycle comes round again${aiReady() ? `, planned by ${aiName()} from your results` : ''}</li>`}
          ${item.restBefore != null && html`<li class="small muted center" data-testid="rest-gap" aria-label=${restText1(item.restBefore)}>${item.restBefore === 0 ? 'the day after' : `· ${restText1(item.restBefore)} ·`}</li>`}
          <li><button class=${i === 0 ? 'change' : 'row'} style=${`text-align:left;width:100%${item.again ? ';opacity:.72' : ''}`} data-testid="plan-session" data-again=${item.again ? '1' : '0'} onClick=${() => go('day', item.day.id)}>
            ${i === 0 ? html`
              <div class="spread"><span class="eyebrow">${dueIn <= 0 ? 'Up next · today' : `Up next · planned for ${whenText(item.inDays, item.at).toLowerCase()}`}</span><span class="small muted">${item.day.estMinutes} min</span></div>
              <h3>${item.day.title}</h3>
              <p class="small muted">${units(item.day.exercises).map((u) => u.map((x) => x.name).join(' + ')).join(', ')}</p>
              ${dayOptional(item.day).length > 0 && html`<p class="small muted" data-testid="up-next-optional">Optional at the end: ${dayOptional(item.day).map((x) => x.name).join(', ')}</p>`}
              <p class="small muted" data-testid="up-next-reason">${planned.reason}${planned.notes.length ? ` ${planned.notes.join(' ')}` : ''}</p>` : html`
              <span class="stack tight"><b>${item.day.title}</b><span class="sub">${item.day.exercises.slice(0, 2).map((x) => x.name).join(', ')}${item.day.exercises.length > 2 ? ` +${item.day.exercises.length - 2}` : ''}</span></span>
              <span class="stack tight right"><span class="sub">${whenText(item.inDays, item.at)}</span><span class="sub">${item.again ? (item.skipped ? 'skipped this round' : 'done this round') : `${item.day.estMinutes} min`}</span></span>`}
          </button></li>`)}
      </ol>
      <p class="muted small" data-testid="plan-note">The days are a guide. Train whenever you can: on another day, "Train now" shows what makes sense and moves the rest of the plan. The list always shows a full cycle: a session you finish moves to the end, with its numbers updated from your results. Each session also lists optional extras for a day when you have more in you; open a session to see them.</p>

      <div class="stack tight">
        ${recent.map((a) => html`<p class="small muted" data-testid="recent-activity">${a.title} ${agoText(a.startedAt, now)}: ${a.minutes} min, ${(EFFORTS[a.effort]?.label || '').toLowerCase()}${activityGroups(a).length ? '. Counted toward recovery.' : '.'}</p>`)}
        <button class="row" data-testid="log-activity" onClick=${() => setSheet('activity')}>
          <span class="stack tight"><b>Did something else?</b><span class="sub">Log a run, a ride or a game. The plan takes it into account.</span></span><span class="accent">Log</span></button>
        <button class=${`row ${pairsOn ? 'on' : ''}`} role="switch" aria-checked=${pairsOn} data-testid="pairs-toggle" onClick=${togglePairs}>
          <span class="stack tight"><b>Pair exercises to save time</b><span class="sub">${pairsOn
    ? `On${saves > 0 ? `: sessions are about ${saves} min shorter` : ''}. Two exercises that use different muscles are done in turns, so one rests while the other works. The sets feel harder, and you need both stations free.`
    : `Two exercises that use different muscles are done in turns, so one rests while the other works. Same sets, ${saves > 0 ? `about ${saves} min less a session` : 'in less time'}. The sets feel harder, and you need both stations free.`}${saves > 0 ? '' : ' In this plan few exercises sit next to one they can pair with: ask the coach for a new plan with this on, and it is built for pairs.'}</span></span>
          <span class="accent">${pairsOn ? 'On' : 'Off'}</span></button>
        <button class="row" data-testid="weights-link" onClick=${() => go('weights')}>
          <span class="stack tight"><b>Weights</b><span class="sub">${blank ? `${plural(blank, 'exercise')} in the plan ${blank === 1 ? 'has' : 'have'} no weight yet. Enter ${blank === 1 ? 'it' : 'them'} now, or when ${blank === 1 ? 'it comes' : 'they come'} up.` : 'What you lift on every exercise, and the step sizes'}</span></span><span class="accent">Open</span></button>
        ${state.proposals.length > 0 && html`<button class="row" onClick=${() => go('review')}>
          <span class="stack tight"><b>What changed</b><span class="sub">Every update to the plan, with the reason. Undo or correct any of them.</span></span><span class="accent">Open</span></button>`}
      </div>

      <details class="note" data-testid="outlook"><summary>The long view: how this training develops</summary>
        <div class="stack small" style="margin-top:8px">
          ${plan.outlook?.text && html`<p data-testid="outlook-ai">${plan.outlook.text} <span class="muted">(${sourceName(plan.outlook.by)})</span></p>`}
          ${outlook.map((o) => html`<p><b>${o.title}</b><span class="muted">${o.text}</span></p>`)}
        </div>
      </details>
      ${plan.notes?.length > 0 && html`<details class="note"><summary>What did not fit your time</summary>
        <ul class="stack tight small muted" style="margin-top:8px">${plan.notes.map((n) => html`<li>${n}</li>`)}</ul></details>`}
      <details class="note" data-testid="volume"><summary>Weekly sets by muscle group</summary>
        <p class="small muted" style="margin:8px 0">Target for your level: ${volume.target[0]}-${volume.target[1]} sets a week for the big muscle groups, when your time allows.${plan.cycleWeeks > 1 ? ' Shown per week, averaged over the sessions planned.' : ''}</p>
        <div class="stack tight">${volume.rows.map((r) => html`<div class="spread small"><span>${r.group}</span>
          <span>${r.sets} sets ${r.low ? html`<span class="tag warn">below target</span>` : ''}</span></div>`)}</div>
        ${volume.rows.some((r) => r.low) && html`<p class="small muted" style="margin-top:8px">To close the gap, give sessions more time or add a day. The coach can rebuild the plan.</p>`}
      </details>
      <p class="muted small">Built ${plan.source === 'rules' ? 'from the training rules' : `by ${sourceName(plan.source)}`} · rules v${plan.rulesVersion || RULES_VERSION} · plan v${plan.version}.
        ${' '}<a class="link" href="#coach">Change it with the coach</a></p>
      <p class="muted small" data-testid="app-version">Seria ${APP_VERSION}</p>
    </main>
    <${Dock} aboveTabs>
      <button class="cta" data-testid="train-now" onClick=${trainNow}>${active ? 'Resume workout' : 'Train now'}</button>
    <//>
    ${sheet === 'train' && html`<${TrainNow} plan=${plan} sessions=${state.sessions} onClose=${() => setSheet(null)} onStart=${(id, opts) => begin(id, opts, setFirst)} />`}
    ${sheet === 'activity' && html`<${ActivitySheet} onClose=${() => setSheet(null)} />`}
    <${WeightsOffer} first=${first} setFirst=${setFirst} />`;
}

export function DayScreen({ dayId }) {
  const state = useStore();
  const [sheet, setSheet] = useState(false);
  const [weightFor, setWeightFor] = useState(null);
  const [first, setFirst] = useState(null);
  const { plan } = state;
  const day = plan?.days.find((d) => d.id === dayId);
  const active = store.activeSession(state);
  if (!day) return html`<main class="main with-tabs"><p class="muted">That session is not in the plan any more.</p><a class="link" href="#plan">Back to the plan</a></main>`;
  const t = timeBreakdown(day.exercises);
  const optional = dayOptional(day);
  const status = queueState(plan).queue.length ? dayStatus(plan, day.id) : 'todo';
  const startThis = () => {
    if (active) { go('workout'); return; }
    // A hand-picked session starts at once unless there is something worth saying first.
    const r = recommend(plan, state.sessions, Date.now(), { prefer: day.id });
    if (!r.notes.length && !r.easePct) begin(day.id, { order: r.order, why: r.reason }, setFirst); else setSheet(true);
  };
  const pairs = units(day.exercises).filter((u) => u.length === 2);
  return html`
    <main class="main with-tabs with-dock">
      <div class="stack tight">
        <p class="eyebrow">Session${status === 'done' ? ' · done' : status === 'skipped' ? ' · skipped for now' : ''}${Number.isFinite(day.restAfter) ? ` · then ${restText1(day.restAfter)}` : ''}</p>
        <h2>${day.title}</h2>
        <p class="muted">About ${day.estMinutes} min: warm-up ${t.warmup}, sets ${t.sets}, rests ${t.rests}, moving between stations ${t.moving}.</p>
      </div>
      <div class="chips">
        ${status === 'todo' && html`<button class="chip" data-testid="skip-session" onClick=${() => { store.set({ plan: skipDay(plan, day.id) }); toast('Skipped. It comes back in the next run'); }}>Skip this time</button>`}
        ${status === 'skipped' && html`<button class="chip accent" data-testid="unskip-session" onClick=${() => { store.set({ plan: unskipDay(plan, day.id) }); toast('Back in the plan'); }}>Bring it back</button>`}
      </div>
      ${pairs.length > 0 && html`<p class="note small" data-testid="day-pairs"><b>${plural(pairs.length, 'pair')} in this session</b>The two exercises of a pair are done in turns: a set of one, a short rest, a set of the other. One rests while the other works, so the session is shorter for the same sets. If a station is taken, "Machine busy?" in the workout splits the pair for the day.</p>`}
      <ol class="stack">
        ${day.exercises.map((ex, i) => {
          const lift = exerciseById(state.equipment, ex.exerciseId);
          const m = machineForExercise(state.equipment, lift);
          const look = sketchForExercise(state.equipment, lift);
          const mate = pairMate(day.exercises, ex);
          return html`
          <li class=${`panel ${mate ? 'paired' : ''}`} style="border-radius:16px;padding:14px;gap:6px" data-testid="day-exercise" data-pair=${mate ? ex.pair : ''}>
            <div class="spread"><h4>${i + 1}. ${ex.name}</h4><span class="tag">${ex.tier}</span></div>
            ${mate && html`<p class="small" data-testid="pair-with"><span class="tag good">pair</span> In turns with ${mate.name}: ${oppositePair(ex, mate) ? 'opposite muscles' : 'different parts of the body'}. Rest ${restText(pairRestSec(ex, mate))} after each set.</p>`}
            <div class="spread" style="align-items:flex-start"><p class="small muted grow">${ex.equipment} · ${ex.zone}</p>${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}</div>
            ${m && html`<p class="small muted" data-testid="day-machine">${machineLabel(m) || m.name}${m.isolates ? ` · isolates ${m.isolates.replace(/\.$/, '').toLowerCase()}` : ''}</p>`}
            <p><b>${ex.sets} × ${ex.reps} reps</b> <span class="muted small">(range ${ex.repLo}-${ex.repHi}) · ${mate ? `rest alone ${restText(ex.restSec)}` : `rest ${restText(ex.restSec)}`}</span></p>
            <div class="spread"><p class="small grow">${ex.load ? html`<b>${fmtLoad(ex.loadType, ex.load.value)}</b> <span class="muted">· step ${num(ex.load.step)}</span>` : html`<span class="muted">Weight: ${loadMethod(ex)}</span>`}</p>
              <button class="chip" data-testid="edit-weight" aria-label=${`Set the weight for ${ex.name}`} onClick=${() => setWeightFor(ex.exerciseId)}>${ex.load ? 'Change' : 'Set weight'}</button></div>
            <${PastResults} sessions=${state.sessions} exerciseId=${ex.exerciseId} loadType=${ex.loadType} />
          </li>`;
        })}
      </ol>
      ${optional.length > 0 && html`<section class="stack" data-testid="day-optional">
        <div class="stack tight">
          <h3>Optional extras</h3>
          <p class="small muted">For a day when you have more in you. When the planned sets are done, the workout offers these; add one or just finish. They are not counted in the ${day.estMinutes} min, and skipping them changes nothing.</p>
        </div>
        <ol class="stack">
          ${optional.map((ex) => {
            const look = sketchForExercise(state.equipment, exerciseById(state.equipment, ex.exerciseId));
            return html`
            <li class="panel" style="border-radius:16px;padding:14px;gap:6px;border-style:dashed" data-testid="optional-exercise">
              <div class="spread"><h4>${ex.name}</h4><span class="tag">optional</span></div>
              <div class="spread" style="align-items:flex-start"><p class="small muted grow">${ex.equipment} · ${ex.zone}</p>${look && html`<${Sketch} small id=${look.id} loading=${look.loading} />`}</div>
              <p><b>${ex.sets} × ${ex.reps} reps</b> <span class="muted small">(range ${ex.repLo}-${ex.repHi}) · rest ${restText(ex.restSec)} · about ${optionalMinutes(ex)} min</span></p>
              ${ex.why && html`<p class="small" data-testid="optional-why">${ex.why}</p>`}
              <div class="spread"><p class="small grow">${ex.load ? html`<b>${fmtLoad(ex.loadType, ex.load.value)}</b> <span class="muted">· step ${num(ex.load.step)}</span>` : html`<span class="muted">Weight: ${loadMethod(ex)}</span>`}</p>
                <button class="chip" aria-label=${`Set the weight for ${ex.name}`} onClick=${() => setWeightFor(ex.exerciseId)}>${ex.load ? 'Change' : 'Set weight'}</button></div>
            </li>`;
          })}
        </ol>
      </section>`}
    </main>
    <${Dock} aboveTabs>
      <button class="cta" data-testid="start-day" onClick=${startThis}>
        ${active ? 'Resume the workout in progress' : 'Start this session'}
      </button>
    <//>
    ${sheet && html`<${TrainNow} plan=${plan} sessions=${state.sessions} prefer=${day.id} onClose=${() => setSheet(false)} onStart=${(id, opts) => begin(id, opts, setFirst)} />`}
    ${weightFor && html`<${WeightSheet} exerciseId=${weightFor} onClose=${() => setWeightFor(null)} />`}
    <${WeightsOffer} first=${first} setFirst=${setFirst} />`;
}

const MODE_TITLE = { post_session: 'After your workout', equipment: 'Your equipment changed', coach: 'From the coach', activity: 'After another activity' };
const STATUS = { applied: 'In the plan', edited: 'Corrected by you', undone: 'Undone', stale: 'No longer fits', kept: 'Not applied', open: 'Not applied' };
const EDIT_LABEL = { load: 'Weight', reps: 'Reps', sets: 'Sets', rest: 'Rest in seconds' };

/**
 * One change to the plan, already made, with its reason. "Undo" puts back what
 * was there, "Edit" swaps in a value typed by hand. A change that was undone
 * can be made again.
 */
export function ChangeCard({ p, c }) {
  const plan = store.getState().plan;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.value);
  const d = describeChange(c);
  const live = isApplied(c);
  const undoable = canUndo(plan, c);
  const samePlan = !c.undo || c.undo.planId === plan?.id;
  const redoable = !live && c.status !== 'stale' && !!plan && samePlan;
  const editable = EDITABLE.includes(c.field) && (undoable || redoable);
  const save = () => {
    if (value == null) { toast('Enter a number first'); return; }
    if (editChange(p.id, c.id, value)) { toast('Plan corrected'); setEditing(false); } else toast('That exercise is no longer in the plan');
  };
  return html`<div class=${`change ${live ? '' : 'done'}`} data-testid="change" data-status=${c.status}>
    <div class="spread"><h4>${c.exerciseName}</h4><span class=${`tag ${live ? 'good' : ''}`}>${STATUS[c.status] || ''}</span></div>
    <div class="delta">${d.what}: ${d.text}</div>
    ${c.status === 'edited' && c.suggested && html`<p class="small muted">The update set ${c.suggested}.</p>`}
    <p class="small muted">${c.reason}</p>
    ${editing && html`<div class="stack tight">
      <label class="field"><span>${EDIT_LABEL[c.field]}</span><${NumberInput} id="change-value" wide value=${value} onChange=${setValue} label=${EDIT_LABEL[c.field]} /></label>
      <div class="pair"><button class="cta" data-testid="change-save" onClick=${save}>Save</button><button class="cta ghost" onClick=${() => setEditing(false)}>Cancel</button></div>
    </div>`}
    ${!editing && (undoable || redoable) && html`<div class="chips">
      ${undoable && html`<button class="chip" data-testid="change-undo" onClick=${() => toast(undoChange(p.id, c.id) ? 'Undone. The plan is as it was' : 'The plan has moved on; nothing to undo')}>Undo</button>`}
      ${redoable && html`<button class="chip accent" data-testid="change-redo" onClick=${() => toast(redoChange(p.id, c.id) ? 'Plan updated' : 'That exercise is no longer in the plan')}>${c.status === 'undone' ? 'Apply again' : 'Apply'}</button>`}
      ${editable && html`<button class="chip" data-testid="change-edit" onClick=${() => { setValue(c.value); setEditing(true); }}>Edit</button>`}
    </div>`}
    ${live && !undoable && html`<p class="small muted">The plan has been rebuilt since, so this stays as a record.</p>`}
  </div>`;
}

/** One update to the plan: the summary in words, then each change. */
export function UpdateBlock({ p, bare = false }) {
  const session = p.sessionId ? store.sessionById(p.sessionId) : null;
  const who = sourceName(p.checking === true ? 'claude' : p.checking || p.source);
  // Asking again only makes sense for the latest workout: for older ones the plan has moved on.
  const retry = !!p.failed && aiReady() && store.doneWorkouts()[0]?.id === p.sessionId;
  return html`<section class="stack" data-testid="update" data-mode=${p.mode}>
    ${!bare && html`<div class="spread"><h3>${MODE_TITLE[p.mode] || 'Update'}</h3><span class="tag" data-testid="update-source">From ${sourceName(p.source)}</span></div>
      ${session && html`<p class="small muted">${session.title} · ${dateText(session.startedAt)}</p>`}`}
    ${p.message && html`<p class="small" data-testid="update-message">${p.message}</p>`}
    ${p.schedule && p.schedule !== p.message && html`<p class="small muted">${p.schedule}</p>`}
    ${p.checking && html`<div class="note thinking" data-testid="checking" role="status">
      <b><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>${who} is thinking</b>
      <span class="small muted">${p.source === 'rules'
    ? `${who} is going through this workout now. Its summary and changes take the place of the ones below when it answers.`
    : `${who} is comparing what you did with the plan and your earlier workouts, and then updates the plan. This can take a minute. You do not have to wait here: the result is saved and shows on the plan.`}</span>
    </div>`}
    ${p.pending && html`<p class="note warn small" data-testid="pending">No connection, so the training rules updated the plan. ${aiName()} reviews this workout and updates the plan when you are back online.</p>`}
    ${p.failed && html`<div class="note warn small" data-testid="review-failed"><b>The AI coach could not review this workout</b>${p.failed} The training rules updated the plan instead.
      ${retry && html`<div class="chips" style="margin-top:8px"><button class="chip accent" data-testid="review-retry" onClick=${() => askAgain(p.id)}>Ask ${aiName()} again</button></div>`}</div>`}
    ${p.changes.length ? p.changes.map((c) => html`<${ChangeCard} key=${c.id} p=${p} c=${c} />`)
      : p.mode === 'post_session' && !(p.checking && p.source !== 'rules') ? html`<p class="note" data-testid="no-changes">No changes. Your results do not call for any, so the plan stays as it is.</p>` : ''}
  </section>`;
}

export function ReviewScreen() {
  const state = useStore();
  const list = [...state.proposals].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  return html`
    <main class="main with-tabs with-dock">
      <div class="stack tight"><p class="eyebrow">What changed</p><h2>Updates to your plan</h2>
        <p class="muted">The plan is updated for you after every workout. Each change shows the old and new value and the reason. Undo any of them, or correct the number.</p></div>
      ${!list.length && html`<p class="note">Nothing yet. Updates show up here after a workout.</p>`}
      ${list.map((p) => html`<${UpdateBlock} key=${p.id} p=${p} />`)}
    </main>
    <${Dock} aboveTabs><button class="cta" onClick=${() => go('plan')}>Done</button><//>`;
}
