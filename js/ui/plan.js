// Plan tab: the plan as a list you can browse (train this, rest, train that),
// one "Train now" button, a session in detail, and the proposed changes.

import { html, useState, useEffect, useStore, Sheet, Dock, go, toast, restText, dateText, plural } from './kit.js';
import * as store from '../store.js';
import { fmtLoad, loadMethod, timeBreakdown, brokenExercises, weeklySets } from '../domain/planner.js';
import { recommend, plannedNext, timeline, queueState, dayStatus, skipDay, unskipDay } from '../domain/schedule.js';
import { describeChange } from '../domain/progression.js';
import { exerciseById, machineForExercise, machineLabel } from '../domain/catalog.js';
import { RULES_VERSION } from '../domain/rules.js';
import { applyChange, keepPlan, reviewEquipment, startTraining, reviewToday } from '../ai/coach.js';
import { sourceName, aiReady, aiName } from '../ai/ai.js';
import { primeAudio } from '../platform.js';

/** Start a session and open the workout screen. */
function begin(dayId, opts) {
  primeAudio();
  if (store.activeSession()) { go('workout'); return; }
  if (startTraining(dayId, opts)) go('workout');
}

const restText1 = (n) => (n === 0 ? 'no rest day' : n === 1 ? '1 rest day' : `${n} rest days`);
const whenText = (inDays, at) => (inDays <= 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : new Date(at).toLocaleDateString('en-GB', { weekday: 'long' }) + (inDays > 6 ? `, ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''));

/**
 * "Train now" on a day the plan did not have for the next session, or when the
 * user picks a session by hand. Shows what makes sense today and why, and how
 * the rest of the plan follows from it. The rules answer at once; the connected
 * model reviews the pick and can replace it. Starting accepts the update.
 */
function TrainNow({ plan, sessions, prefer, onClose }) {
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
    if (ai.pick && pick === ai.pick && ai.pick.changes.length) store.addProposal({ mode: 'coach', source: ai.pick.via, sessionId: null, changes: ai.pick.changes });
    onClose();
    begin(pick.dayId, { order: pick.order, rests: pick.rests, easePct: lighter ? pick.easePct : 0, why: pick.reason });
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
    ${use === ai.pick && ai.pick.changes.length > 0 && html`<p class="small muted">${sourceName(ai.pick.via)} also proposes ${plural(ai.pick.changes.length, 'change')} to later sessions. You will find ${ai.pick.changes.length === 1 ? 'it' : 'them'} under proposed changes; nothing there changes until you apply it.</p>`}
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

export function PlanScreen() {
  const state = useStore();
  const { plan } = state;
  const [sheet, setSheet] = useState(false);
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
        </div>
      </main>`;
  }
  const now = Date.now();
  const rec = recommend(plan, state.sessions, now); // if you trained this minute
  const planned = plannedNext(plan, state.sessions, now); // what the plan has next, and when
  const line = timeline(plan, state.sessions, now);
  const q = queueState(plan);
  const broken = brokenExercises(plan, state.equipment);
  const open = store.openChanges(state);
  const volume = weeklySets(plan);
  const skipped = q.queue.length ? q.skipped.map((id) => plan.days.find((d) => d.id === id)).filter(Boolean) : [];
  const dueIn = line[0]?.inDays ?? 0;

  const trainNow = () => {
    if (active) { go('workout'); return; }
    // On the planned day there is nothing to discuss: start. On any other day, show what makes sense now.
    if (rec.onSchedule) begin(rec.dayId, { order: rec.order, why: rec.reason }); else setSheet(true);
  };

  return html`
    <main class="main with-tabs with-dock">
      <div class="spread">
        <div class="stack tight"><p class="eyebrow">Plan</p><h2>Your plan</h2></div>
        <small class="right" data-testid="plan-shape">${plan.perWeek} a week · any days</small>
      </div>
      ${open.length > 0 && html`<button class="row on" onClick=${() => go('review')}>
        <span class="stack tight"><b>${plural(open.length, 'proposed change')}</b><span class="sub">See what would change and why</span></span><span class="accent">Review</span>
      </button>`}
      ${broken.length > 0 && !open.some(({ p }) => p.mode === 'equipment') && html`<div class="note warn">
        <b>${plural(broken.length, 'exercise')} need${broken.length === 1 ? 's' : ''} equipment you no longer have</b>
        <span class="muted small">${[...new Set(broken.map((b) => b.name))].join(', ')}</span>
        <div class="chips" style="margin-top:8px"><button class="chip accent" onClick=${() => { reviewEquipment(); go('review'); }}>See the swaps</button></div>
      </div>`}
      ${plan.lastUpdate && now - plan.lastUpdate.at < 14 * 864e5 && html`<p class="note small" data-testid="last-update"><b>Updated ${dateText(plan.lastUpdate.at)} by ${sourceName(plan.lastUpdate.by)}</b>${plan.lastUpdate.text}</p>`}

      <ol class="stack" data-testid="timeline">
        ${line.map((item, i) => html`
          ${item.restBefore != null && html`<li class="small muted center" data-testid="rest-gap" aria-label=${restText1(item.restBefore)}>${item.restBefore === 0 ? 'the day after' : `· ${restText1(item.restBefore)} ·`}</li>`}
          <li><button class=${i === 0 ? 'change' : 'row'} style="text-align:left;width:100%" data-testid="plan-session" onClick=${() => go('day', item.day.id)}>
            ${i === 0 ? html`
              <div class="spread"><span class="eyebrow">${dueIn <= 0 ? 'Up next · today' : `Up next · planned for ${whenText(item.inDays, item.at).toLowerCase()}`}</span><span class="small muted">${item.day.estMinutes} min</span></div>
              <h3>${item.day.title}</h3>
              <p class="small muted">${item.day.exercises.map((x) => x.name).join(', ')}</p>
              <p class="small muted" data-testid="up-next-reason">${planned.reason}${planned.notes.length ? ` ${planned.notes.join(' ')}` : ''}</p>` : html`
              <span class="stack tight"><b>${item.day.title}</b><span class="sub">${item.day.exercises.slice(0, 2).map((x) => x.name).join(', ')}${item.day.exercises.length > 2 ? ` +${item.day.exercises.length - 2}` : ''}</span></span>
              <span class="stack tight right"><span class="sub">${whenText(item.inDays, item.at)}</span><span class="sub">${item.day.estMinutes} min</span></span>`}
          </button></li>`)}
      </ol>
      <p class="muted small" data-testid="plan-note">The days are a guide. Train whenever you can: on another day, "Train now" shows what makes sense and moves the rest of the plan. After the last session here, the coach plans the next run from your results.</p>
      ${skipped.length > 0 && html`<div class="stack tight" data-testid="skipped">
        <p class="small muted">Skipped for now. They come back in the next run.</p>
        ${skipped.map((d) => html`<button class="row" onClick=${() => go('day', d.id)}><b>${d.title}</b><span class="sub">Skipped</span></button>`)}
      </div>`}
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
    </main>
    <${Dock} aboveTabs>
      <button class="cta" data-testid="train-now" onClick=${trainNow}>${active ? 'Resume workout' : 'Train now'}</button>
    <//>
    ${sheet && html`<${TrainNow} plan=${plan} sessions=${state.sessions} onClose=${() => setSheet(false)} />`}`;
}

export function DayScreen({ dayId }) {
  const state = useStore();
  const [sheet, setSheet] = useState(false);
  const { plan } = state;
  const day = plan?.days.find((d) => d.id === dayId);
  const active = store.activeSession(state);
  if (!day) return html`<main class="main with-tabs"><p class="muted">That session is not in the plan any more.</p><a class="link" href="#plan">Back to the plan</a></main>`;
  const t = timeBreakdown(day.exercises);
  const status = queueState(plan).queue.length ? dayStatus(plan, day.id) : 'todo';
  const startThis = () => {
    if (active) { go('workout'); return; }
    // A hand-picked session starts at once unless there is something worth saying first.
    const r = recommend(plan, state.sessions, Date.now(), { prefer: day.id });
    if (!r.notes.length && !r.easePct) begin(day.id, { order: r.order, why: r.reason }); else setSheet(true);
  };
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
      <ol class="stack">
        ${day.exercises.map((ex, i) => {
          const m = machineForExercise(state.equipment, exerciseById(state.equipment, ex.exerciseId));
          return html`
          <li class="panel" style="border-radius:16px;padding:14px;gap:6px">
            <div class="spread"><h4>${i + 1}. ${ex.name}</h4><span class="tag">${ex.tier}</span></div>
            <p class="small muted">${ex.equipment} · ${ex.zone}</p>
            ${m && html`<p class="small muted" data-testid="day-machine">${machineLabel(m) || m.name}${m.isolates ? ` · isolates ${m.isolates.replace(/\.$/, '').toLowerCase()}` : ''}</p>`}
            <p><b>${ex.sets} × ${ex.reps} reps</b> <span class="muted small">(range ${ex.repLo}-${ex.repHi}) · rest ${restText(ex.restSec)}</span></p>
            <p class="small">${ex.load ? html`<b>${fmtLoad(ex.loadType, ex.load.value)}</b>` : html`<span class="muted">Weight: ${loadMethod(ex)}</span>`}</p>
          </li>`;
        })}
      </ol>
    </main>
    <${Dock} aboveTabs>
      <button class="cta" data-testid="start-day" onClick=${startThis}>
        ${active ? 'Resume the workout in progress' : 'Start this session'}
      </button>
    <//>
    ${sheet && html`<${TrainNow} plan=${plan} sessions=${state.sessions} prefer=${day.id} onClose=${() => setSheet(false)} />`}`;
}

const MODE_TITLE = { post_session: 'After your workout', equipment: 'Your equipment changed', coach: 'From your chat with the coach' };

export function ChangeCard({ p, c }) {
  const d = describeChange(c);
  const decided = c.status !== 'open';
  return html`<div class=${`change ${decided ? 'done' : ''}`} data-testid="change">
    <div class="spread"><h4>${c.exerciseName}</h4>
      ${decided && html`<span class=${`tag ${c.status === 'applied' ? 'good' : ''}`}>${c.status === 'applied' ? 'Applied' : c.status === 'kept' ? 'Plan kept' : 'No longer fits'}</span>`}</div>
    <div class="delta">${d.what}: ${d.text}</div>
    <p class="small muted">${c.reason}</p>
    ${!decided && html`<div class="pair">
      <button class="cta" onClick=${() => { if (applyChange(p.id, c.id)) toast('Plan updated'); else toast('That exercise is no longer in the plan'); }}>Apply</button>
      <button class="cta ghost" onClick=${() => keepPlan(p.id, c.id)}>Keep plan</button>
    </div>`}
  </div>`;
}

export function ReviewScreen() {
  const state = useStore();
  const list = [...state.proposals].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  return html`
    <main class="main with-tabs with-dock">
      <div class="stack tight"><p class="eyebrow">Proposed changes</p><h2>Next workouts</h2>
        <p class="muted">Each change shows the old and new value and the reason. Nothing changes until you tap Apply.</p></div>
      ${!list.length && html`<p class="note">Nothing to review. Proposals show up here after a workout.</p>`}
      ${list.map((p) => {
        const session = p.sessionId ? store.sessionById(p.sessionId, state) : null;
        return html`<section class="stack">
          <div class="spread"><h3>${MODE_TITLE[p.mode] || 'Proposal'}</h3>
            <span class="tag">From ${sourceName(p.source)}</span></div>
          ${session && html`<p class="small muted">${session.title} · ${dateText(session.startedAt)}</p>`}
          ${p.message && html`<p class="small">${p.message}</p>`}
          ${p.checking && html`<p class="small muted" data-testid="checking">${sourceName(p.checking === true ? 'claude' : p.checking)} is taking a second look. You can decide now or wait.</p>`}
          ${p.changes.length ? p.changes.map((c) => html`<${ChangeCard} p=${p} c=${c} />`)
            : html`<p class="note" data-testid="no-changes">No changes. Your results do not call for any, so the plan stays as it is.</p>`}
        </section>`;
      })}
    </main>
    <${Dock} aboveTabs><button class="cta" onClick=${() => go('plan')}>Done</button><//>`;
}
