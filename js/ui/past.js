// Earlier results for one exercise, for the box an exercise is shown in: the
// last few times in small print, and the rest on request. It shows how the
// exercise has moved on, and stays out of the way: nothing at all is shown for
// an exercise never done.

import { html, useState } from './kit.js';
import { exerciseHistory } from '../domain/progression.js';
import { fmtLoadShort, num } from '../domain/planner.js';

const FEW = 3;
const day = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "20 kg × 8, 8, 7", or set by set when the load changed on the way. */
export function resultLine(entry, loadType) {
  const loads = [...new Set(entry.sets.map((s) => s.load))];
  if (loads.length === 1) return `${fmtLoadShort(loadType, loads[0])} × ${entry.sets.map((s) => s.reps).join(', ')}`;
  const unit = loadType === 'machine' ? '' : ' kg';
  return `${entry.sets.map((s) => `${num(s.load)}×${s.reps}`).join(', ')}${unit}`;
}

/** How a time moved on from the one before: "+2.5 kg", "+1 rep", "same", or nothing for the first time. */
export function stepText(step, loadType) {
  if (!step) return '';
  const sign = (n) => (n > 0 ? '+' : '−');
  if (step.load) return `${sign(step.load)}${num(Math.abs(step.load))}${loadType === 'machine' ? '' : ' kg'}`;
  if (step.reps) return `${sign(step.reps)}${Math.abs(step.reps)} rep${Math.abs(step.reps) === 1 ? '' : 's'}`;
  return 'same';
}

export function PastResults({ sessions, exerciseId, loadType, skip }) {
  const [all, setAll] = useState(false);
  const list = exerciseHistory(sessions, exerciseId, { skip });
  if (!list.length) return null;
  const rows = all ? list : list.slice(0, FEW);
  const title = all ? `All ${list.length} times` : rows.length === 1 ? 'Last time' : `Last ${rows.length} times`;
  return html`<div class="past" data-testid="past">
    <div class="spread"><span class="past-title">${title}</span>
      ${list.length > FEW && html`<button class="past-more" data-testid="past-more" aria-expanded=${all} onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${list.length}`}</button>`}</div>
    ${rows.map((e) => {
      const up = (e.step?.load || e.step?.reps || 0) > 0;
      return html`<div class="past-row" data-testid="past-row"><span>${day(e.at)}</span><span>${resultLine(e, loadType)}</span><span class=${up ? 'up' : ''}>${stepText(e.step, loadType)}</span></div>`;
    })}
  </div>`;
}
