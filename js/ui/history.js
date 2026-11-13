// History tab: finished workouts, and one workout down to the single set.
// A session keeps its own copy of the plan it was done against, so later plan
// changes never rewrite the past.

import { html, useState, useEffect, useStore, Dock, go, back, toast, dateText, plural, flags } from './kit.js';
import * as store from '../store.js';
import { summarize, exerciseSummary, editSet } from '../domain/session.js';
import { fmtLoadShort } from '../domain/planner.js';
import { reviewSession } from '../ai/coach.js';
import { EditSetSheet } from './workout.js';

export function HistoryScreen() {
  const state = useStore();
  const list = store.doneSessions(state);
  if (!list.length) {
    return html`<main class="main with-tabs"><div class="empty">
      <p class="eyebrow">History</p><h2>Nothing logged yet<span class="accent">.</span></h2>
      <p class="muted">Finished workouts land here with every set: what the plan said and what you did.</p>
    </div></main>`;
  }
  return html`<main class="main with-tabs">
    <div class="stack tight"><p class="eyebrow">History</p><h2>${plural(list.length, 'workout')}</h2></div>
    <div class="stack">
      ${list.map((s) => {
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

export function SessionScreen({ sessionId }) {
  const state = useStore();
  const session = store.sessionById(sessionId, state);
  const [edit, setEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Workout saved" shows once, right after finishing. Later visits show the plain record.
  const [fresh] = useState(flags.justFinished === sessionId);
  useEffect(() => () => { if (flags.justFinished === sessionId) flags.justFinished = null; }, [sessionId]);
  if (!session) return html`<main class="main with-tabs"><p class="muted">That workout is not in your history.</p><a class="link" href="#history">Back to history</a></main>`;
  const sum = summarize(session);
  const proposal = state.proposals.find((p) => p.mode === 'post_session' && p.sessionId === session.id);
  const openCount = proposal ? proposal.changes.filter((c) => c.status === 'open').length : 0;
  const ex = edit ? session.exercises[edit.ex] : null;
  const seeProposal = () => { if (!proposal) reviewSession(session.id); go('review'); };

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
      <div class="note">
        <b>${sum.onPlan ? 'Everything went to plan' : 'Biggest differences from the plan'}</b>
        ${!sum.onPlan && html`<ul class="stack tight small muted" style="margin-top:6px">${sum.highlights.slice(0, 5).map((h) => html`<li>${h}</li>`)}</ul>`}
      </div>
      ${session.exercises.map((x, xi) => {
        const l = exerciseSummary(x);
        return html`<section class="stack" data-testid="session-exercise">
          <div class="spread"><h4>${x.name}</h4><span class=${`tag ${l.verdict === 'as planned' || l.verdict === 'above plan' ? 'good' : 'warn'}`}>${l.verdict}</span></div>
          <p class="small muted">Plan ${l.plan} · did ${l.doneText}${l.notes.length ? `. ${l.notes.join('. ')}.` : ''}</p>
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
      <div class="chips">
        ${!confirmDelete && html`<button class="chip danger" onClick=${() => setConfirmDelete(true)}>Delete this workout</button>`}
        ${confirmDelete && html`<button class="chip danger" onClick=${() => { store.removeSession(session.id); toast('Workout deleted'); back('history'); }}>Yes, delete it for good</button>
          <button class="chip" onClick=${() => setConfirmDelete(false)}>Cancel</button>`}
      </div>
    </main>
    ${state.plan && html`<${Dock} aboveTabs>
      <button class="cta" data-testid="see-proposal" onClick=${seeProposal}>
        ${fresh || !proposal ? 'See the proposal for the next workout' : openCount ? `Review ${plural(openCount, 'proposed change')}` : 'See what was proposed'}
      </button>
    <//>`}
    ${edit && ex && html`<${EditSetSheet} ex=${ex} index=${edit.set}
      st=${ex.sets[edit.set].actual ? ex.sets[edit.set] : { ...ex.sets[edit.set], actual: { reps: ex.sets[edit.set].planned.reps, load: ex.sets[edit.set].target.load, rir: null } }}
      onClose=${() => setEdit(null)}
      onSave=${(a) => {
        const untouched = (p) => p.mode === 'post_session' && p.sessionId === session.id && p.changes.every((c) => c.status === 'open');
        const stale = state.proposals.some(untouched);
        store.putSession(editSet(session, edit.ex, edit.set, a), stale ? { proposals: state.proposals.filter((p) => !untouched(p)) } : {});
        if (stale) reviewSession(session.id); // the numbers changed, so the proposals are worked out again
        setEdit(null); toast('Set corrected');
      }} />`}
  `;
}
