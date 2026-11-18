// How an exercise has progressed, for the box an exercise is shown in: the last
// few times reps were added or the weight went up, in small print, and the
// rest on request. It stays out of the way: nothing at all is shown for an
// exercise whose target has never changed.

import { html, useState } from './kit.js';
import { progressSteps } from '../domain/progression.js';
import { fmtLoadShort, num } from '../domain/planner.js';

const FEW = 3;
const day = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const sign = (n) => (n > 0 ? '+' : '−');

/** What a step was, in a word or two: "+2 kg", "+1 rep", "−2.5 kg". A change of weight names the step; the reps then follow from it. */
export function stepText(step, loadType) {
  if (step.load) return `${sign(step.load.by)}${num(Math.abs(step.load.by))}${loadType === 'machine' ? '' : ' kg'}`;
  return `${sign(step.reps.by)}${Math.abs(step.reps.by)} rep${Math.abs(step.reps.by) === 1 ? '' : 's'}`;
}

/** From what to what: "20 → 22 kg, reps 10 → 8", or "8 → 9 reps". */
export function stepLine(step, loadType) {
  if (step.load) {
    const unit = fmtLoadShort(loadType, step.load.to);
    return `${num(step.load.from)} → ${loadType === 'bodyweight' ? `${num(step.load.to)} kg added` : loadType === 'machine' ? num(step.load.to) : unit}${step.reps ? `, reps ${step.reps.from} → ${step.reps.to}` : ''}`;
  }
  return `${step.reps.from} → ${step.reps.to} reps`;
}

/** `now`: the target as it stands, { reps, load }. */
export function ProgressSteps({ sessions, exerciseId, loadType, now, skip }) {
  const [all, setAll] = useState(false);
  const list = progressSteps(sessions, exerciseId, now, { skip });
  if (!list.length) return null;
  const rows = all ? list : list.slice(0, FEW);
  const title = all ? `Progress: all ${list.length} steps` : rows.length === 1 ? 'Progress: the last step' : `Progress: the last ${rows.length} steps`;
  return html`<div class="past" data-testid="past">
    <div class="spread"><span class="past-title">${title}</span>
      ${list.length > FEW && html`<button class="past-more" data-testid="past-more" aria-expanded=${all} onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${list.length}`}</button>`}</div>
    ${rows.map((e) => {
      const up = (e.load ? e.load.by : e.reps.by) > 0;
      return html`<div class="past-row" data-testid="past-row"><span>${day(e.at)}</span><span>${stepLine(e, loadType)}</span><span class=${up ? 'up' : ''}>${stepText(e, loadType)}</span></div>`;
    })}
  </div>`;
}
