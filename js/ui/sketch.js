// Line sketches of gym equipment: the general look of each kind of machine,
// so you know what to walk towards. Not the exact model. Side view unless the
// thing is clearer from the front. Drawn on a 120 x 90 grid:
//   f  frame            p  pad you sit or lie on     s  weight stack (or plates)
//   m  the part you move (accent)   mp, mr  a moving pad or roller
//   c  cable            w  plate or pulley           r  fixed roller

import { html } from '../../vendor/preact-htm.js';

export const SKETCHES = {
  dumbbells: { name: 'dumbbell', parts: [
    ['p', 22, 52, 9, 26], ['p', 32, 47, 9, 36], ['m', 'M41 65 H79'], ['p', 79, 47, 9, 36], ['p', 89, 52, 9, 26],
  ] },
  barbell: { name: 'barbell', parts: [
    ['f', 'M8 62 H112'], ['m', 'M44 62 H76'],
    ['p', 19, 40, 6, 44], ['p', 26, 46, 5, 32], ['p', 95, 40, 6, 44], ['p', 89, 46, 5, 32],
  ] },
  bench: { name: 'bench', parts: [
    ['f', 'M30 84 L35 62 M90 84 L85 62 M35 62 H85 M22 84 H40 M82 84 H98'],
    ['p', 66, 52, 28, 8], ['p', 18, 40, 50, 8, -18],
  ] },
  pullup_bar: { name: 'pull-up bar', parts: [
    ['f', 'M30 84 V14 M90 84 V14 M20 84 H40 M80 84 H100'], ['m', 'M18 14 H102 M18 14 V21 M102 14 V21'],
  ] },
  rack: { name: 'squat rack', parts: [
    ['f', 'M34 84 V10 M86 84 V10 M34 10 H86 M24 84 H44 M76 84 H96 M34 60 H44 M86 60 H76 M34 38 H40 M86 38 H80'],
    ['f', 'M10 36 H110'], ['m', 'M46 36 H74'],
    ['p', 13, 22, 5, 28], ['p', 19, 26, 4, 20], ['p', 102, 22, 5, 28], ['p', 97, 26, 4, 20],
  ] },
  cable: { name: 'cable station', parts: [
    ['f', 'M36 84 V10 H72 M24 84 H86'], ['s', 16, 40], ['w', 72, 14, 4], ['c', 'M72 18 V42'],
    ['m', 'M62 48 H82 M62 48 L72 42 L82 48'],
  ] },
  lat_pulldown: { name: 'lat pulldown', parts: [
    ['f', 'M46 84 V10 H88 M30 84 H102 M72 84 V69 M88 62 V56'], ['s', 26, 38], ['w', 88, 14, 4], ['c', 'M88 18 V30'],
    ['m', 'M66 30 H110 M66 30 L62 35 M110 30 L114 35'], ['p', 60, 62, 26, 7], ['r', 88, 52, 5],
  ] },
  seated_row: { name: 'seated row', parts: [
    ['f', 'M10 84 H110 M36 84 V30 M36 52 H40 M88 84 V69'], ['s', 16, 36], ['w', 44, 52, 4], ['c', 'M48 52 H70'],
    ['m', 'M70 45 V59'], ['p', 76, 62, 26, 7], ['p', 55, 62, 5, 18, -20],
  ] },
  leg_press: { name: 'leg press', parts: [
    ['f', 'M10 84 H110 M40 80 L104 34 M104 84 V34'], ['p', 8, 58, 34, 8, -52], ['p', 30, 72, 16, 7],
    ['m', 'M75 55 L61 35'], ['w', 88, 38, 9], ['w', 88, 38, 3],
  ] },
  leg_extension: { name: 'leg extension', parts: [
    ['f', 'M32 84 V60 M64 84 V60 M26 60 H70 M22 84 H76'], ['p', 30, 52, 40, 8], ['p', 10, 32, 36, 8, -75],
    ['m', 'M70 58 L75 76'], ['mr', 80, 78, 5], ['s', 96, 40],
  ] },
  leg_curl: { name: 'leg curl', parts: [
    ['f', 'M30 84 V58 M68 84 V58 M24 84 H76'], ['p', 22, 50, 54, 8], ['m', 'M76 56 L93 43'], ['mr', 96, 40, 5], ['s', 4, 40],
  ] },
  chest_press: { name: 'chest press', parts: [
    ['f', 'M38 84 V8 H58 M26 84 H94 M62 84 V69'], ['s', 18, 40], ['p', 50, 62, 24, 7], ['p', 28, 38, 32, 7, -82],
    ['m', 'M58 8 L84 20 V44 M77 44 H91'],
  ] },
  shoulder_press: { name: 'shoulder press', parts: [
    ['f', 'M38 84 V14 M26 84 H94 M62 84 V69'], ['s', 18, 40], ['p', 50, 62, 24, 7], ['p', 28, 36, 32, 7, -86],
    ['m', 'M38 30 L60 17 H80 M80 10 V24'],
  ] },
  pec_deck: { name: 'pec deck', parts: [
    ['f', 'M38 84 V8 H68 M26 84 H94 M62 84 V69'], ['s', 18, 40], ['p', 50, 62, 24, 7], ['p', 28, 38, 32, 7, -82],
    ['m', 'M68 8 V26'], ['mp', 64, 26, 8, 28],
  ] },
  smith: { name: 'Smith machine', parts: [
    ['f', 'M26 84 V8 M94 84 V8 M26 8 H94 M16 84 H36 M84 84 H104 M12 42 H26 M94 42 H108'],
    ['c', 'M32 10 V82 M88 10 V82'], ['m', 'M30 42 H90'], ['p', 10, 30, 5, 24], ['p', 105, 30, 5, 24],
  ] },
  hack_squat: { name: 'hack squat', parts: [
    ['f', 'M10 84 H110 M30 80 L96 26 M96 84 V26'], ['p', 12, 68, 26, 6, 38], ['p', 46, 40, 30, 8, -39],
    ['mp', 70, 22, 12, 6, -39], ['w', 88, 48, 8], ['w', 88, 48, 3],
  ] },
  dip_station: { name: 'dip bars', parts: [
    ['f', 'M38 84 V30 M26 84 H96 M38 62 L62 30'], ['m', 'M38 30 H90'], ['mp', 72, 27, 20, 6],
  ] },
  calf_machine: { name: 'calf raise machine', parts: [
    ['f', 'M34 84 V12 M22 84 H102'], ['s', 14, 40], ['m', 'M34 24 L88 30'], ['mp', 66, 31, 22, 7], ['p', 62, 74, 32, 8],
  ] },
  back_extension: { name: 'back extension bench', parts: [
    ['f', 'M22 84 H100 M36 84 L74 44 M74 84 V44'], ['p', 58, 30, 26, 9, -40], ['p', 20, 72, 20, 6, 50], ['r', 46, 64, 4],
    ['m', 'M82 52 L92 47'],
  ] },
  glute: { name: 'glute machine', parts: [
    ['f', 'M12 84 H108 M24 84 V60 M48 84 V60'], ['p', 16, 52, 38, 8], ['m', 'M20 78 L76 50'], ['mp', 58, 43, 22, 8, -14],
    ['p', 94, 62, 6, 22, 15], ['w', 86, 46, 7],
  ] },
  curl: { name: 'curl machine', parts: [
    ['f', 'M22 84 H104 M40 84 V71 M74 84 V62'], ['p', 28, 64, 24, 7], ['p', 42, 44, 32, 8, 36],
    ['m', 'M76 62 L72 26 M65 26 H79'], ['s', 90, 42],
  ] },
  ab: { name: 'ab crunch machine', parts: [
    ['f', 'M38 84 V10 H56 M26 84 H94 M62 84 V69'], ['s', 18, 40], ['p', 50, 62, 24, 7], ['p', 28, 38, 32, 7, -82],
    ['m', 'M56 10 L72 30'], ['mp', 64, 30, 16, 8], ['r', 82, 76, 4],
  ] },
  machine: { name: 'machine', parts: [
    ['f', 'M38 84 V10 H58 M26 84 H94 M62 84 V69'], ['s', 18, 40], ['p', 50, 62, 24, 7], ['p', 28, 38, 32, 7, -82],
    ['m', 'M58 10 L80 26 V46'],
  ] },
};

const rot = (x, y, w, h, deg) => (deg ? `rotate(${deg} ${x + w / 2} ${y + h / 2})` : undefined);

function part(p, plates) {
  const [kind, a, b, c, d, e] = p;
  switch (kind) {
    case 'f': return html`<path class="sk-f" d=${a} />`;
    case 'm': return html`<path class="sk-m" d=${a} />`;
    case 'c': return html`<path class="sk-c" d=${a} />`;
    case 'p': return html`<rect class="sk-p" x=${a} y=${b} width=${c} height=${d} rx="3" transform=${rot(a, b, c, d, e)} />`;
    case 'mp': return html`<rect class="sk-mp" x=${a} y=${b} width=${c} height=${d} rx="3" transform=${rot(a, b, c, d, e)} />`;
    case 'r': return html`<circle class="sk-p" cx=${a} cy=${b} r=${c} />`;
    case 'mr': return html`<circle class="sk-mp" cx=${a} cy=${b} r=${c} />`;
    case 'w': return html`<circle class="sk-w" cx=${a} cy=${b} r=${c} />`;
    case 's': {
      // The weights: a stack with a pin, or plates on a peg when the machine is plate-loaded.
      const h = c || 40;
      if (plates) return html`<path class="sk-f" d=${`M${a + 7} 84 V${b + h - 26} M${a - 2} ${b + h - 14} H${a + 16}`} /><circle class="sk-w" cx=${a + 7} cy=${b + h - 14} r="11" /><circle class="sk-w" cx=${a + 7} cy=${b + h - 14} r="4" />`;
      return html`<rect class="sk-w" x=${a} y=${b} width="14" height=${h} rx="2" />
        <path class="sk-c" d=${[1, 2, 3, 4, 5].map((i) => `M${a} ${b + (h * i) / 6} h14`).join(' ')} />
        <path class="sk-f" d=${`M${a + 7} ${b + h} V84`} /><circle class="sk-mp" cx=${a + 7} cy=${b + (h * 2.5) / 6} r="1.8" />`;
    }
    default: return null;
  }
}

/**
 * @param {{id: string, loading?: string, small?: boolean, medium?: boolean}} props id: a key of SKETCHES
 */
export function Sketch({ id, loading, small, medium }) {
  const sk = SKETCHES[id];
  if (!sk) return null;
  const plates = loading === 'plate_loaded';
  // A small one sits next to the name it illustrates, so it is decoration there; a big one stands alone and is labelled.
  return html`<svg class=${`sketch${small ? ' small' : medium ? ' medium' : ''}`} viewBox="0 0 120 90" role=${small ? undefined : 'img'} aria-hidden=${small ? 'true' : undefined}
    aria-label=${small ? undefined : `Sketch of a ${sk.name}`} data-sketch=${id}>
    <path class="sk-g" d="M6 86 H114" />
    ${sk.parts.map((p) => part(p, plates))}
  </svg>`;
}

/** One line saying what the sketch shows, and that it is only the general look. */
export function sketchNote(look) {
  const sk = look && SKETCHES[look.id];
  return sk ? `General look of a ${sk.name}${look.loading === 'plate_loaded' ? ', loaded with plates' : ''}. Yours may differ in detail.` : '';
}
