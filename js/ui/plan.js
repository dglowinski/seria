// Plan tab: the week, a day in detail, and the list of proposed changes.

import { html, useStore, Dock, go, toast, restText, dateText, plural } from './kit.js';
import * as store from '../store.js';
import { WEEKDAY_NAMES, fmtLoad, loadMethod, timeBreakdown, nextDay, brokenExercises, weeklySets } from '../domain/planner.js';
import { startSession } from '../domain/session.js';
import { describeChange } from '../domain/progression.js';
import { exerciseById, machineForExercise, machineLabel } from '../domain/catalog.js';
import { RULES_VERSION } from '../domain/rules.js';
import { applyChange, keepPlan, reviewEquipment } from '../ai/coach.js';
import { sourceName } from '../ai/ai.js';
import { primeAudio } from '../platform.js';

export function startDay(dayId) {
  primeAudio();
  const st = store.getState();
  if (store.activeSession(st)) { go('workout'); return; }
  store.putSession(startSession(st.plan, dayId));
  go('workout');
}

export function PlanScreen() {
  const state = useStore();
  const { plan } = state;
  const active = store.activeSession(state);
  if (!plan) {
    return html`
      <main class="main with-tabs">
        <div class="empty">
          <p class="eyebrow">Plan</p>
          <h2>No plan yet<span class="accent">.</span></h2>
          <p class="muted">Tell the coach how you want to train. You get a week built around your goal, your time and the equipment in your gym, and the app walks you through every set.</p>
          <button class="cta" onClick=${() => go('coach')}>Talk to the coach</button>
          <button class="cta ghost" onClick=${() => go('equipment')}>Set up my gym first</button>
        </div>
      </main>`;
  }
  const next = nextDay(plan, Date.now(), state.sessions);
  const broken = brokenExercises(plan, state.equipment);
  const open = store.openChanges(state);
  const maxMin = Math.max(...plan.days.map((d) => d.estMinutes));
  const volume = weeklySets(plan);
  return html`
    <main class="main with-tabs with-dock">
      <div class="spread">
        <div class="stack tight"><p class="eyebrow">Plan</p><h2>Your week</h2></div>
        <small class="right">${plural(plan.days.length, 'day')} · up to ${Math.max(plan.minutes, maxMin)} min</small>
      </div>
      ${open.length > 0 && html`<button class="row on" onClick=${() => go('review')}>
        <span class="stack tight"><b>${plural(open.length, 'proposed change')}</b><span class="sub">See what would change and why</span></span><span class="accent">Review</span>
      </button>`}
      ${broken.length > 0 && !open.some(({ p }) => p.mode === 'equipment') && html`<div class="note warn">
        <b>${plural(broken.length, 'exercise')} need${broken.length === 1 ? 's' : ''} equipment you no longer have</b>
        <span class="muted small">${broken.map((b) => b.name).join(', ')}</span>
        <div class="chips" style="margin-top:8px"><button class="chip accent" onClick=${() => { reviewEquipment(); go('review'); }}>See the swaps</button></div>
      </div>`}
      <div class="stack">
        ${plan.days.map((d) => html`
          <button class=${`row ${d.id === next.id ? 'on' : ''}`} onClick=${() => go('day', d.id)}>
            <b>${WEEKDAY_NAMES[d.weekday]}</b>
            <span class="sub right">${d.title} · ${d.estMinutes} min</span>
          </button>`)}
      </div>
      <p class="muted small">${WEEKDAY_NAMES[next.weekday]} starts with ${(next.exercises[0]?.name || 'the first exercise').toLowerCase()}. Open a day to see the order of exercises and the time each part takes.</p>
      ${plan.notes?.length > 0 && html`<details class="note"><summary>What was left out to fit your time</summary>
        <ul class="stack tight small muted" style="margin-top:8px">${plan.notes.map((n) => html`<li>${n}</li>`)}</ul></details>`}
      <details class="note" data-testid="volume"><summary>Weekly sets by muscle group</summary>
        <p class="small muted" style="margin:8px 0">Target for your level: ${volume.target[0]}-${volume.target[1]} sets a week for the big muscle groups, when your time allows.</p>
        <div class="stack tight">${volume.rows.map((r) => html`<div class="spread small"><span>${r.group}</span>
          <span>${r.sets} sets ${r.low ? html`<span class="tag warn">below target</span>` : ''}</span></div>`)}</div>
        ${volume.rows.some((r) => r.low) && html`<p class="small muted" style="margin-top:8px">To close the gap, give sessions more time or add a day. The coach can rebuild the week.</p>`}
      </details>
      <p class="muted small">Built ${plan.source === 'rules' ? 'from the training rules' : `by ${sourceName(plan.source)}`} · rules v${plan.rulesVersion || RULES_VERSION} · plan v${plan.version}.
        ${' '}<a class="link" href="#coach">Change it with the coach</a></p>
    </main>
    <${Dock} aboveTabs>
      <button class="cta" data-testid="start-next" onClick=${() => (active ? go('workout') : startDay(next.id))}>
        ${active ? `Resume ${WEEKDAY_NAMES[active.weekday]}'s workout` : `Start ${WEEKDAY_NAMES[next.weekday]}'s workout`}
      </button>
    <//>`;
}

export function DayScreen({ dayId }) {
  const state = useStore();
  const day = state.plan?.days.find((d) => d.id === dayId);
  const active = store.activeSession(state);
  if (!day) return html`<main class="main with-tabs"><p class="muted">That day is not in the plan any more.</p><a class="link" href="#plan">Back to the plan</a></main>`;
  const t = timeBreakdown(day.exercises);
  return html`
    <main class="main with-tabs with-dock">
      <div class="stack tight">
        <p class="eyebrow">${WEEKDAY_NAMES[day.weekday]}</p>
        <h2>${day.title}</h2>
        <p class="muted">About ${day.estMinutes} min: warm-up ${t.warmup}, sets ${t.sets}, rests ${t.rests}, moving between stations ${t.moving}.</p>
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
      <button class="cta" data-testid="start-day" onClick=${() => (active ? go('workout') : startDay(day.id))}>
        ${active ? 'Resume the workout in progress' : `Start ${WEEKDAY_NAMES[day.weekday]}'s workout`}
      </button>
    <//>`;
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
