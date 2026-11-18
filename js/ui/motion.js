// How an exercise is done, shown moving.
//
// There are two pictures of every move. The one meant to be seen is a figure
// in 3D: a modelled person doing a rep with the equipment, which can be opened
// large and turned around (ui/stage3d.js draws it). The other is the flat line
// drawing of a stick figure. It stands in while the 3D parts load, and stays
// when they cannot be had: no 3D on the device, the files did not arrive, or
// the 3D figure is switched off in Settings. Both come from the same moves
// (domain/moves.js).
//
// A picture stays out of the way. It plays a few reps when asked to (the
// exercise that is up in a workout does) and then rests. Someone who has asked
// their phone for less motion gets a still picture until they tap.

import { html, useState, useEffect, useRef, Sheet } from './kit.js';
import { motion } from '../domain/moves.js';
import { poster } from '../domain/moves3d.js';
import { openStage, stageNow } from './stage3d.js';
import * as store from '../store.js';

const REP_S = 3.2; // one rep: up, a short hold, down, a short hold
const UP = 0.36; const TOP = 0.44; const DOWN = 0.9;
const TAP_REPS = 3;

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));

/** How far into the effort a rep is, `u` being the share of the rep's time that has passed. */
const phase = (u) => (u < UP ? ease(u / UP) : u < TOP ? 1 : u < DOWN ? 1 - ease((u - TOP) / (DOWN - TOP)) : 0);

// ---------------------------------------------------------------- which picture

/**
 * The 3D stage for a picture to draw on. `undefined` while that is being
 * found out, `null` when the flat drawing is to be used.
 */
function use3d() {
  const want = store.getSettings().figure3d !== false;
  const [stage, setStage] = useState(() => (want ? stageNow() : null));
  useEffect(() => {
    if (!want) { setStage(null); return undefined; }
    let live = true;
    openStage().then((s) => { if (live) setStage(s); });
    return () => { live = false; };
  }, [want]);
  return want ? stage : null;
}

/**
 * @param {object} props
 * @param {string} props.move a key of MOVES (see moveFor)
 * @param {string} props.name the exercise, for the label
 * @param {number} [props.play] reps to play by itself when it comes up; 0 waits for a tap
 * @param {boolean} [props.small]
 * @param {boolean} [props.plates] the machine is loaded with plates, not a weight stack
 */
export function Motion(props) {
  const stage = use3d();
  if (!motion(props.move)) return null;
  return stage ? html`<${Figure} stage=${stage} ...${props} />` : html`<${Drawing} wait=${stage === undefined} ...${props} />`;
}

/** One line for under the picture: what it shows, and that the user's own machine may look different. */
export function MotionNote({ machine = false, plates = false }) {
  const stage = use3d();
  return motionNote({ machine, plates, three: !!stage });
}
export const motionNote = ({ machine = false, plates = false, three = false } = {}) => `How the move goes${plates ? ', on a machine loaded with plates' : ''}. ${machine ? 'Your machine may differ in detail. ' : ''}${three ? 'Tap it to see it large and turn it around.' : 'Tap the drawing to play it again.'}`;

// ---------------------------------------------------------------- the figure in 3D

const fitCanvas = (c) => {
  const box = c.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(Math.round((box.width || 148) * dpr), 2); const h = Math.max(Math.round((box.height || box.width || 148) * dpr), 2);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
};

/**
 * Plays a move on a canvas until told to stop: `reps` reps (Infinity to go
 * on), then it settles on the still picture. `turn()` is how far the viewer
 * has swung the view. Returns the function that stops it.
 */
function playOn(stage, c, move, { plates, reps, turn = () => 0, done = () => {} }) {
  const rest = poster(move);
  let raf = 0; let start = 0;
  const lead = 0.35; // seconds from the still picture down to the start of a rep, and back at the end
  const frame = (now) => {
    if (!start) start = now;
    const s = (now - start) / 1000;
    let t;
    if (s < lead) t = rest * (1 - ease(s / lead));
    else if (s < lead + reps * REP_S) t = phase(((s - lead) / REP_S) % 1);
    else if (s < 2 * lead + reps * REP_S) t = rest * ease((s - lead - reps * REP_S) / lead);
    else { stage.draw(c, move, rest, { plates, turn: turn() }); done(); return; }
    stage.draw(c, move, t, { plates, turn: turn() });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function Figure({ stage, move, name, play = 0, small, plates = false }) {
  const canvas = useRef(null);
  // A picture asked to play does so from its first moment on screen, unless less motion was asked for.
  const [on, setOn] = useState(() => play > 0 && !calm());
  const [run, setRun] = useState(0);
  const [big, setBig] = useState(false);
  // The same picture handed another move starts over.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setRun((n) => n + 1); setOn(play > 0 && !calm());
  }, [move, play]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    fitCanvas(c);
    if (on && !big) return playOn(stage, c, move, { plates, reps: play || TAP_REPS, done: () => setOn(false) });
    stage.draw(c, move, poster(move), { plates });
    return undefined;
  }, [on, run, move, plates, big]);
  return html`<button type="button" class=${`motion three${small ? ' small' : ''}`} data-testid="motion" data-move=${move} data-on=${on && !big ? '1' : '0'} data-three="1"
      aria-label=${`See how ${name} is done, large`} onClick=${(e) => { e.stopPropagation(); setBig(true); }}>
      <canvas ref=${canvas} role="img" aria-label=${`How ${name} is done, in 3D`}></canvas>
      <span class="motion-play" aria-hidden="true">⤢</span>
    </button>
    ${big && html`<${Viewer} stage=${stage} move=${move} name=${name} plates=${plates} onClose=${() => setBig(false)} />`}`;
}

/** The move large, on a loop, to be turned around with a finger. */
function Viewer({ stage, move, name, plates, onClose }) {
  const canvas = useRef(null);
  const turn = useRef(0);
  const drag = useRef(null);
  const [playing, setPlaying] = useState(() => !calm());
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    fitCanvas(c);
    if (playing) return playOn(stage, c, move, { plates, reps: Infinity, turn: () => turn.current });
    stage.draw(c, move, poster(move), { plates, turn: turn.current });
    return undefined;
  }, [playing, move, plates]);
  const down = (e) => { drag.current = { x: e.clientX, from: turn.current, moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* an old browser: the drag still works while the finger stays on the picture */ } };
  const moveTo = (e) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
    turn.current = d.from - (e.clientX - d.x) * 0.6;
    canvas.current.dataset.turn = String(Math.round(turn.current));
    if (!playing) stage.draw(canvas.current, move, poster(move), { plates, turn: turn.current });
  };
  const up = () => { const d = drag.current; drag.current = null; if (d && !d.moved) setPlaying((p) => !p); };
  return html`<${Sheet} title=${name} onClose=${onClose}>
    <canvas ref=${canvas} class="viewer" data-testid="motion-big" data-move=${move} data-on=${playing ? '1' : '0'} data-turn="0" role="img" aria-label=${`How ${name} is done, in 3D`}
      onPointerDown=${down} onPointerMove=${moveTo} onPointerUp=${up} onPointerCancel=${() => { drag.current = null; }}></canvas>
    <p class="small muted" data-testid="motion-hint">Drag sideways to turn it around. Tap to ${playing ? 'pause' : 'play'}.</p>
  </${Sheet}>`;
}

// ---------------------------------------------------------------- the flat drawing

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

// At rest the drawing shows the start of the move with the end of it faint
// behind, so the move can be read from the still picture too. A tap plays it
// again, or stops it. While it is not yet known whether the 3D figure can be
// had (`wait`), it holds still.
function Drawing({ move, name, play = 0, small, plates = false, wait = false }) {
  const m = motion(move, { plates });
  const [on, setOn] = useState(() => play > 0 && !calm() && !wait);
  const [run, setRun] = useState(0);
  const [reps, setReps] = useState(play || TAP_REPS);
  // The same drawing handed another move starts over.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setReps(play || TAP_REPS); setRun((n) => n + 1); setOn(play > 0 && !calm() && !wait);
  }, [move, play, wait]);
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => setOn(false), reps * REP_S * 1000);
    return () => clearTimeout(t);
  }, [on, run, reps]);
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
