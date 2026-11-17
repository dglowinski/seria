// History tab: finished workouts, and one workout down to the single set.
// A session keeps its own copy of the plan it was done against, so later plan
// changes never rewrite the past.

import { html, useState, useEffect, useStore, Dock, go, back, toast, dateText, plural, flags } from './kit.js';
import { sourceName } from '../ai/ai.js';
import * as store from '../store.js';
import { summarize, exerciseSummary, editSet, readLog } from '../domain/session.js';
import { fmtLoadShort } from '../domain/planner.js';
import { EFFORTS, activityGroups } from '../domain/rules.js';
import { reviewSession, recomputeSession, deleteWorkout } from '../ai/coach.js';
import { EditSetSheet } from './workout.js';
import { UpdateBlock } from './plan.js';

export function HistoryScreen() {
  const state = useStore();
  const list = store.doneSessions(state);
  if (!list.length) {
    return html`<main class="main with-tabs"><div class="empty">
      <p class="eyebrow">History</p><h2>Nothing logged yet<span class="accent">.</span></h2>
      <p class="muted">Finished workouts land here with every set: what the plan said and what you did. Runs, rides and other activity you log show up here too.</p>
    </div></main>`;
  }
  const gym = list.filter((s) => s.kind !== 'activity').length;
  return html`<main class="main with-tabs">
    <div class="stack tight"><p class="eyebrow">History</p><h2>${plural(gym, 'workout')}${list.length > gym ? html`<span class="muted small"> · ${plural(list.length - gym, 'other activity').replace('activitys', 'activities')}</span>` : ''}</h2></div>
    <div class="stack">
      ${list.map((s) => {
        if (s.kind === 'activity') {
          return html`<button class="row" data-testid="history-activity" onClick=${() => go('session', s.id)}>
            <span class="stack tight"><b>${s.title}</b><span class="sub">${dateText(s.startedAt)} · ${s.minutes} min · ${(EFFORTS[s.effort]?.label || '').toLowerCase()}</span></span>
            <span class="tag">Activity</span>
          </button>`;
        }
        const sum = summarize(s);
        return html`<button class="row" onClick=${() => go('session', s.id)}>
          <span class="stack tight"><b>${s.title}</b><span class="sub">${dateText(s.startedAt)} · ${sum.minutes} min · ${sum.done} / ${sum.total} sets</span></span>
          <span class=${`tag ${sum.onPlan ? 'good' : 'warn'}`}>${sum.onPlan ? 'On plan' : plural(sum.highlights.length, 'difference')}</span>
        </button>`;
      })}
    </div>
  </main>`;
}

const setText = (ex, v) => (v ? `${v.reps} × ${fmtLoadShort(ex.loadType, v.load)}` : '—');
const secText = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min` : `${sec} s`);
const lowerList = (a) => { const l = a.map((x) => x.toLowerCase()); return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`; };

/** A logged run, ride or game: what it was, and what it meant for the plan. */
function ActivityScreen({ act }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const groups = activityGroups(act);
  const update = store.updateFor(act.id);
  return html`<main class="main with-tabs">
    <div class="stack tight"><p class="eyebrow">${dateText(act.startedAt)} · other activity</p><h2>${act.title}</h2></div>
    <div class="metrics">
      <div><strong>${act.minutes} min</strong><small>time</small></div>
      <div><strong>${EFFORTS[act.effort]?.label || '—'}</strong><small>effort</small></div>
    </div>
    <p class="note small">${groups.length ? `Counted as work for ${lowerList(groups)}. Sessions that train ${groups.length > 1 ? 'them' : 'it'} hard waited about 48 hours after it.` : 'Too light or too short to change the plan.'}</p>
    ${update?.message && html`<p class="small muted">${update.message}</p>`}
    <div class="chips">
      ${!confirmDelete && html`<button class="chip danger" onClick=${() => setConfirmDelete(true)}>Delete this activity</button>`}
      ${confirmDelete && html`<button class="chip danger" onClick=${() => { deleteWorkout(act.id); toast('Activity deleted'); back('history'); }}>Yes, delete it for good</button>
        <button class="chip" onClick=${() => setConfirmDelete(false)}>Cancel</button>`}
    </div>
  </main>`;
}

export function SessionScreen({ sessionId }) {
  const state = useStore();
  const session = store.sessionById(sessionId, state);
  const [edit, setEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Workout saved" shows once, right after finishing. Later visits show the plain record.
  const [fresh] = useState(flags.justFinished === sessionId);
  useEffect(() => () => { if (flags.justFinished === sessionId) flags.justFinished = null; }, [sessionId]);
  // A workout saved before updates were automatic gets its update the first time it is opened.
  const hasUpdate = !!session && state.proposals.some((p) => p.mode === 'post_session' && p.sessionId === session.id);
  useEffect(() => {
    if (session && session.kind !== 'activity' && session.status === 'done' && !hasUpdate && state.plan && store.doneWorkouts()[0]?.id === session.id) reviewSession(session.id);
  }, [sessionId, hasUpdate]);
  if (!session) return html`<main class="main with-tabs"><p class="muted">That workout is not in your history.</p><a class="link" href="#history">Back to history</a></main>`;
  if (session.kind === 'activity') return html`<${ActivityScreen} act=${session} />`;
  const sum = summarize(session);
  const update = state.proposals.find((p) => p.mode === 'post_session' && p.sessionId === session.id);
  const ex = edit ? session.exercises[edit.ex] : null;
  const log = readLog(session);
  // The other exercise of a pair, when sets of both were really done.
  const didSome = (e) => e.sets.some((st) => st.status === 'done');
  const turnsWith = (x) => (x.pair && didSome(x) && session.exercises.find((y) => y !== x && y.pair === x.pair && didSome(y))) || null;

  return html`
    <main class=${`main with-tabs ${state.plan ? 'with-dock' : ''}`}>
      <div class="stack tight">
        <p class="eyebrow">${fresh ? 'Summary' : dateText(session.startedAt)} · ${session.title}${session.easePct ? ` · ${session.easePct}% lighter` : ''}</p>
        <h2>${fresh ? 'Workout saved' : session.title}</h2>
      </div>
      <div class="metrics">
        <div><strong data-testid="sum-minutes">${sum.minutes} min</strong><small>session time</small></div>
        <div><strong data-testid="sum-sets">${sum.done} / ${sum.total}</strong><small>sets done</small></div>
        ${sum.skipped > 0 && html`<div><strong>${sum.skipped}</strong><small>skipped</small></div>`}
      </div>
      ${update && html`<div class="stack" data-testid="coach-summary">
        <div class="stack tight"><h3>${fresh ? 'Summary and what changes' : 'What it changed in the plan'}</h3>
          ${!(update.checking && update.source !== 'rules') && html`<span class="tag" style="align-self:flex-start" data-testid="summary-source">From ${sourceName(update.source)}</span>`}</div>
        <${UpdateBlock} p=${update} bare />
      </div>`}
      <div class="note">
        <b>${sum.onPlan ? 'Everything went to plan' : 'Biggest differences from the plan'}</b>
        ${!sum.onPlan && html`<ul class="stack tight small muted" style="margin-top:6px">${sum.highlights.slice(0, 5).map((h) => html`<li>${h}</li>`)}</ul>`}
        ${sum.rests && html`<span class="small muted" data-testid="rest-stats">Rests between sets: ${secText(sum.rests.actual)} on average, ${secText(sum.rests.planned)} planned.</span>`}
      </div>
      ${session.exercises.map((x, xi) => {
        const l = exerciseSummary(x);
        return html`<section class="stack" data-testid="session-exercise">
          <div class="spread"><h4>${x.name}</h4><span class=${`tag ${l.verdict === 'as planned' || l.verdict === 'above plan' ? 'good' : 'warn'}`}>${l.verdict}</span></div>
          <p class="small muted">Plan ${l.plan} · did ${l.doneText}${l.notes.length ? `. ${l.notes.join('. ')}.` : ''}</p>
          ${turnsWith(x) && html`<p class="small muted" data-testid="session-pair">Done in turns with ${turnsWith(x).name}.</p>`}
          <div class="sets">
            ${x.sets.map((st, si) => html`
              <button class=${`set ${st.status === 'skipped' ? 'skipped' : ''}`} onClick=${() => setEdit({ ex: xi, set: si })}
                aria-label=${`Set ${si + 1}, tap to correct`}>
                <span class="k">Set ${si + 1}</span>
                <span>${st.status === 'done' ? setText(x, st.actual) : 'skipped'}${st.actual?.rir != null ? ` · ${st.actual.rir === 4 ? '4+' : st.actual.rir} left` : ''}
                  <span class="k"> · plan ${st.planned.reps}${st.planned.load != null ? ` × ${fmtLoadShort(x.loadType, st.planned.load)}` : ''}</span></span>
                <span class="k">Edit</span>
              </button>`)}
          </div>
        </section>`;
      })}
      ${log.length > 1 && html`<details class="note" data-testid="session-log"><summary>Every step, with times (${log.length})</summary>
        <ol class="stack tight small muted" style="margin-top:8px;padding:0;list-style:none">${log.map((l) => html`<li><span style="font-variant-numeric:tabular-nums">${l.at}</span> · ${l.text}</li>`)}</ol>
      </details>`}
      <div class="chips">
        ${!confirmDelete && html`<button class="chip danger" onClick=${() => setConfirmDelete(true)}>Delete this workout</button>`}
        ${confirmDelete && html`<button class="chip danger" onClick=${() => { deleteWorkout(session.id); toast('Workout deleted'); back('history'); }}>Yes, delete it for good</button>
          <button class="chip" onClick=${() => setConfirmDelete(false)}>Cancel</button>`}
      </div>
    </main>
    ${state.plan && html`<${Dock} aboveTabs>
      <button class="cta" data-testid="to-plan" onClick=${() => go('plan')}>${fresh ? 'Done. Back to the plan' : 'Back to the plan'}</button>
    <//>`}
    ${edit && ex && html`<${EditSetSheet} ex=${ex} index=${edit.set}
      st=${ex.sets[edit.set].actual ? ex.sets[edit.set] : { ...ex.sets[edit.set], actual: { reps: ex.sets[edit.set].planned.reps, load: ex.sets[edit.set].target.load, rir: null } }}
      onClose=${() => setEdit(null)}
      onSave=${(a) => {
        store.putSession(editSet(session, edit.ex, edit.set, a));
        // The numbers changed. For the latest workout the plan is worked out again from them.
        const res = recomputeSession(session.id);
        setEdit(null);
        toast(res === 'redone' ? 'Set corrected. The plan was worked out again' : 'Set corrected. The plan has moved on since, so it stays as it is');
      }} />`}
  `;
}
