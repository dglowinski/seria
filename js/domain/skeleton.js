// The bones of the modelled figure, and how a pose bends them.
//
// The figure file (assets/figure.bin, made by scripts/build-figure.mjs) starts
// with 'SFIG', the length of a JSON header, the header, and then the numbers
// the header points into. The header lists the bones: name, parent, and where
// each one is and how it is turned when the figure stands at rest.
//
// A pose comes from moves3d.js as one turn per body part, counted from the
// figure at rest and given in space, not against the parent bone. Here that
// becomes what a bone needs: its turn against its parent. Bones the pose does
// not name (collar bones, toes) keep their place on their parent. Fingers are
// folded here: closed around a handle, or held flat.
//
// Nothing in this file draws, so the tests can check that the bones end up
// where the moves say the joints are.

import { qmul, qaxis, qrot, cross, unit, sub, add } from './moves3d.js';
import { FIGURE } from './figure.js';

const conj = (q) => [-q[0], -q[1], -q[2], q[3]];

/** Opens a figure file: its header, and where in the file the numbers start. */
export function readFigure(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SFIG') throw new Error('figure: not a figure file');
  const jsonLen = dv.getUint32(4, true);
  return { head: JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen))), base: 8 + jsonLen };
}

/**
 * @param {{name: string, parent: number, pos: number[], quat: number[]}[]} B the bones at rest, as the figure file lists them
 * @returns {{order: number[], restLocal: {q: number[], p: number[]}[], root: number, pose: (fig: object) => {local: number[][], world: number[][], rootAt: number[]}, places: (posed: object) => number[][]}}
 */
export function skeleton(B, F = FIGURE) {
  const n = B.length;
  const at = (name) => B.findIndex((b) => b.name === name);
  // Parents before children.
  const order = []; const placed = new Set();
  while (order.length < n) {
    const before = order.length;
    for (let i = 0; i < n; i++) if (!placed.has(i) && (B[i].parent < 0 || placed.has(B[i].parent))) { placed.add(i); order.push(i); }
    if (order.length === before) throw new Error('figure: a bone names a parent that is not there');
  }
  const restLocal = B.map((b) => {
    const p = b.parent;
    return p < 0 ? { q: b.quat, p: b.pos } : { q: qmul(conj(B[p].quat), b.quat), p: qrot(conj(B[p].quat), sub(b.pos, B[p].pos)) };
  });
  const partOf = new Array(n).fill(null);
  for (const [part, name] of Object.entries(F.bones)) if (part !== 'root' && at(name) >= 0) partOf[at(name)] = part;
  const root = at(F.bones.root);

  // Fingers: each of the four folds around the line square to it and the palm; the thumb comes across less.
  const fold = new Array(n).fill(null);
  for (const s of ['R', 'L']) {
    const palm = F[`palm${s}`];
    for (let f = 0; f <= 4; f++) {
      const ids = ['', '1', '2'].map((j) => at(`Bip01_${s}_Finger${f}${j}`));
      if (ids.some((i) => i < 0)) continue;
      const bends = f ? [62, 78, 46] : [18, 30, 30];
      ids.forEach((i, j) => {
        const along = unit(sub(B[ids[Math.min(j + 1, 2)]].pos, B[ids[Math.min(j, 1)]].pos));
        fold[i] = { axis: qrot(conj(B[i].quat), unit(cross(along, palm))), bend: bends[j], side: s };
      });
    }
  }

  /** The turn of every bone for the pose `fig` (see rig3): against its parent (`local`) and in space (`world`). */
  function pose(fig) {
    const world = new Array(n); const local = new Array(n);
    for (const i of order) {
      const p = B[i].parent; const part = partOf[i];
      let w = part && fig.q[part] ? qmul(fig.q[part], B[i].quat) : p < 0 ? B[i].quat : qmul(world[p], restLocal[i].q);
      if (fold[i]) w = qmul(w, qaxis(fold[i].axis, fold[i].bend * (fig.hands[fold[i].side].shut ?? 1)));
      world[i] = w;
      local[i] = p < 0 ? w : qmul(conj(world[p]), w);
    }
    const h = fig.J.hipC;
    return { local, world, rootAt: [h[0] + B[root].pos[0] - F.joints.hipC[0], h[1] + B[root].pos[1] - F.joints.hipC[1], h[2] + B[root].pos[2] - F.joints.hipC[2]] };
  }

  /** Where every bone ends up in space in a pose worked out by `pose`. */
  function places(posed) {
    const out = new Array(n);
    for (const i of order) { const p = B[i].parent; out[i] = i === root ? posed.rootAt : p < 0 ? B[i].pos : add(out[p], qrot(posed.world[p], restLocal[i].p)); }
    return out;
  }

  return { order, restLocal, root, pose, places, at };
}
