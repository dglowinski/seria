// The animated drawing of an exercise: a stick figure doing one rep, with the
// equipment, in the same line style as the equipment sketches. The shapes come
// from domain/moves.js; this file only plays them.
//
// It stays out of the way. A drawing plays a few reps when asked to (the
// exercise that is up in a workout does) and then rests. At rest it shows the
// start of the move with the end of it faint behind, so the move can be read
// from the still picture too. A tap plays it again, or stops it. Someone who
// has asked their phone for less motion gets the still picture until they tap.

import { html, useState, useEffect, useRef } from './kit.js';
import { motion } from '../domain/moves.js';

const REP_S = 3.2; // one rep: up, a short hold, down, a short hold
const UP = 0.36; const TOP = 0.44; const DOWN = 0.9;
const TAP_REPS = 3;

const round = (v) => Math.round(v * 1000) / 1000;
/** The moments, as shares of a rep, at which each shape on the way up and back down is reached. */
function keyTimes(steps) {
  const k = [];
  for (let i = 0; i <= steps; i++) k.push(round((UP * i) / steps));
  for (let i = 0; i <= steps; i++) k.push(round(TOP + ((DOWN - TOP) * i) / steps));
  k.push(1);
  return k.join(';');
}
const thereAndBack = (a) => [...a, ...[...a].reverse(), a[0]].join(';');

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function Part({ p, on, times }) {
  const anim = (name, values) => html`<animate attributeName=${name} dur=${`${REP_S}s`} repeatCount="indefinite" calcMode="linear" keyTimes=${times} values=${values} />`;
  if (p.k === 'circle') {
    const moving = on && p.at.length > 1;
    return html`<circle class=${p.c} r=${p.r} cx=${p.at[0][0]} cy=${p.at[0][1]}>
      ${moving && anim('cx', thereAndBack(p.at.map((a) => a[0])))}${moving && anim('cy', thereAndBack(p.at.map((a) => a[1])))}
    </circle>`;
  }
  return html`<path class=${p.c} d=${p.d[0]}>${on && p.d.length > 1 && anim('d', thereAndBack(p.d))}</path>`;
}

/** Where a moving part ends up, drawn faint behind the still picture. */
function Ghost({ p }) {
  if (p.k === 'circle') return p.at.length > 1 ? html`<circle class=${`${p.c} ghost`} r=${p.r} cx=${p.at[p.at.length - 1][0]} cy=${p.at[p.at.length - 1][1]} />` : null;
  return p.d.length > 1 ? html`<path class=${`${p.c} ghost`} d=${p.d[p.d.length - 1]} />` : null;
}

/**
 * @param {object} props
 * @param {string} props.move a key of MOVES (see moveFor)
 * @param {string} props.name the exercise, for the label
 * @param {number} [props.play] reps to play by itself when it comes up; 0 waits for a tap
 * @param {boolean} [props.small]
 * @param {boolean} [props.plates] the machine is loaded with plates, not a weight stack
 */
export function Motion({ move, name, play = 0, small, plates = false }) {
  const m = motion(move, { plates });
  // A drawing asked to play does so from its first moment on screen, unless less motion was asked for.
  const [on, setOn] = useState(() => play > 0 && !calm());
  const [run, setRun] = useState(0);
  const [reps, setReps] = useState(play || TAP_REPS);
  // The same drawing handed another move starts over.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setReps(play || TAP_REPS); setRun((n) => n + 1); setOn(play > 0 && !calm());
  }, [move, play]);
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => setOn(false), reps * REP_S * 1000);
    return () => clearTimeout(t);
  }, [on, run, reps]);
  if (!m) return null;
  const tap = (e) => {
    e.stopPropagation();
    if (on) { setOn(false); return; }
    setReps(TAP_REPS); setRun((n) => n + 1); setOn(true);
  };
  const times = keyTimes(m.steps);
  return html`<button type="button" class=${`motion${small ? ' small' : ''}`} data-testid="motion" data-move=${move} data-on=${on ? '1' : '0'}
    aria-label=${on ? `Stop the animation of ${name}` : `Play how ${name} is done`} onClick=${tap}>
    <svg key=${`${move}-${on ? run : 'still'}`} viewBox="0 0 120 90" role="img" aria-label=${`How ${name} is done, seen from the ${m.view}`}>
      <path class="sk-g" d="M6 86 H114" />
      ${!on && m.parts.map((p) => html`<${Ghost} p=${p} />`)}
      ${m.parts.map((p) => html`<${Part} p=${p} on=${on} times=${times} />`)}
    </svg>
    ${!on && html`<span class="motion-play" aria-hidden="true">▶</span>`}
  </button>`;
}

/** One line for under the drawing: what it shows, and that the user's own machine may look different. */
export const motionNote = ({ machine = false, plates = false } = {}) => `How the move goes${plates ? ', on a machine loaded with plates' : ''}. ${machine ? 'Your machine may differ in detail. ' : ''}Tap the drawing to play it again.`;
