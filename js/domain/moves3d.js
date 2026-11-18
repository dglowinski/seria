// The moves of moves.js in three dimensions, for a jointed figure with a body.
//
// A move there says where the hips, hands and feet are at any point of a rep,
// seen from the side. Here the same answers are given depth: how wide the
// grip is, how far the elbows flare, where the knees track. From that the
// bones of the figure are turned, each with its fixed length, and the
// equipment gets its width. Nothing here draws; ui/stage3d.js does.
//
// Space: the units of the drawings, floor at y = 0, x forward (to the right
// in the side drawing), y up, z toward the viewer of the side drawing, which
// is the figure's right. Turns are quaternions [x, y, z, w]; each bone's turn
// is counted from the figure at rest (figure.js).

import { MOVES, withPlates } from './moves.js';
import { FIGURE } from './figure.js';

// ---------------------------------------------------------------- vectors and turns

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a, or = [0, 0, 1]) => { const l = len(a); return l < 1e-9 ? or : mul(a, 1 / l); };
const mid = (a, b) => mul(add(a, b), 0.5);
const dist = (a, b) => len(sub(a, b));
/** The part of `a` that is square to the unit vector `u`. */
const square = (a, u) => sub(a, mul(u, dot(a, u)));

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qaxis = (axis, d) => { const h = rad(d) / 2; const s = Math.sin(h); const u = unit(axis); return [u[0] * s, u[1] * s, u[2] * s, Math.cos(h)]; };
export const qrot = (q, v) => { const qv = [q[0], q[1], q[2]]; const t = mul(cross(qv, v), 2); return add(add(v, mul(t, q[3])), cross(qv, t)); };
const Q0 = [0, 0, 0, 1];

function qmat(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
/** Three axes square to each other: the first along `u`, the second as near `n` as that allows. */
const basis = (u, n) => { const e1 = unit(u, [1, 0, 0]); const e2 = unit(square(n, e1), unit(cross(e1, [0.3, 0.5, 0.8]))); return [e1, e2, cross(e1, e2)]; };
/** The turn that carries the axes A onto the axes B. */
const turn = (A, B) => {
  const m = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(B[0][i] * A[0][j] + B[1][i] * A[1][j] + B[2][i] * A[2][j]);
  return qmat(m);
};
/** The angle from `a` to `b` around the unit vector `axis`, in degrees. */
const around = (a, b, axis) => deg(Math.atan2(dot(cross(a, b), axis), dot(a, b)));

// ---------------------------------------------------------------- limbs

// A limb of two bones from `root` to `target`; the joint bends toward `pole`.
// A target out of reach is met as far as the limb goes: bones never stretch.
// With `zAt` the joint is also held as near that depth as the limb allows:
// an elbow kept under the hand, so the forearm stands straight under a bar.
function ik3(root, target, l1, l2, pole, zAt) {
  let d = sub(target, root);
  let L = len(d);
  if (L < 1e-6) { d = [0, -1, 0]; L = 1; }
  const u = mul(d, 1 / L);
  const D = Math.min(Math.max(L, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  let n = unit(square(pole, u), unit(cross(u, [0, 0, 1]), [1, 0, 0]));
  const c = add(root, mul(u, a));
  if (zAt !== undefined && h > 0.05) {
    // The joint can sit anywhere on a circle around the line from root to target. Of the points at the depth asked for, the one nearest the pole.
    const m = cross(u, n);
    const A = h * n[2]; const B = h * m[2]; const C = zAt - c[2]; const R = Math.hypot(A, B);
    if (R > 1e-6) {
      const mid = Math.atan2(B, A); const spread = Math.acos(Math.max(-1, Math.min(1, C / R)));
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      const one = wrap(mid + spread); const two = wrap(mid - spread);
      const by = Math.max(-1.75, Math.min(1.75, Math.abs(one) <= Math.abs(two) ? one : two));
      n = add(mul(n, Math.cos(by)), mul(m, Math.sin(by)));
    }
  }
  return { joint: add(c, mul(n, h)), end: add(root, mul(u, D)) };
}

// The line a joint folds around. A limb that is all but straight has no fold
// to read it from, so the side it would bend to (`pole`) decides.
function hinge(root, joint, end, pole) {
  const u = unit(sub(joint, root)); const v = unit(sub(end, joint)); const d = unit(sub(end, root));
  const pd = unit(square(pole, d), [0, 0, 0]);
  return unit(add(cross(u, v), mul(cross(pd, d), 0.04)));
}

// ---------------------------------------------------------------- the figure at rest

const rests = new WeakMap();
function restOf(F) {
  if (rests.has(F)) return rests.get(F);
  const R = F.joints; const out = {};
  for (const [s, k] of [['R', 1], ['L', -1]]) {
    const sh = R[`sh${s}`]; const el = R[`elbow${s}`]; const gr = R[`grip${s}`];
    const hip = R[`hip${s}`]; const kn = R[`knee${s}`]; const an = R[`ankle${s}`]; const tip = R[`tip${s}`];
    const he = F[`hingeArm${s}`] || hinge(sh, el, gr, [-1, 0, 0]);
    const hk = F[`hingeLeg${s}`] || hinge(hip, kn, an, [1, 0, 0]);
    const v = unit(sub(gr, el));
    // How far the hand is turned at rest from the middle of its range, thumb forward on a hanging arm. Less is palm back.
    const neutral = unit(square(mul(he, -k), v));
    out[s] = {
      k, lu: dist(sh, el), lf: dist(el, gr), lw: dist(el, R[`wrist${s}`]), lt: dist(hip, kn), ls: dist(kn, an), ankleH: an[1],
      upper: basis(sub(el, sh), he), fore: basis(v, he),
      thigh: basis(sub(kn, hip), hk), shin: basis(sub(an, kn), hk),
      foot: basis([tip[0] - an[0], 0, tip[2] - an[2]], [0, 1, 0]),
      turned: k * around(neutral, unit(square(F[`palm${s}`], v)), v),
    };
  }
  rests.set(F, out);
  return out;
}

// ---------------------------------------------------------------- one moment of a move

let FLOOR = 84;
/** A point of the side drawing, set `z` toward the viewer. */
const P3 = (p, z = 0) => [p[0] - 60, FLOOR - p[1], (p[2] || 0) + z];
const p2 = (v) => [v[0] + 60, FLOOR - v[1]];
/** A direction in the side plane: 0 up, 90 forward, 180 down. */
const d2 = (a) => [Math.sin(rad(a)), Math.cos(rad(a)), 0];
const a2 = (v) => deg(Math.atan2(v[0], v[1]));
const rz = (d) => qaxis([0, 0, 1], d);
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * The figure in a pose.
 * @param {object} p the pose of a move (moves.js): hip, lean, nod, arm, arm2, leg, leg2
 * @param {object} x what the side view cannot say: grip and stance (full widths), flare (elbows out), knees (out), toes (degrees out), curl (the spine rounding, degrees), handle
 * @returns {{J: object, q: object, hands: object, feet: object}} joints in space, the turn of every bone from rest, and how hands and feet are held
 */
export function rig3(p, x = {}, F = FIGURE) {
  const R = F.joints; const rest = restOf(F);
  const lean = p.lean || 0; const nod = p.nod || 0; const curl = x.curl || 0;
  const J = {}; const q = {};

  // The trunk: the spine rounds by `curl`, spread over its three parts, and the whole leans so that the line from hips to shoulders is at `lean`.
  const c = rz(-curl / 3);
  const b0 = c; const b1 = qmul(b0, c); const b2 = qmul(b1, c);
  const r0 = sub(R.s0, R.hipC);
  const r1 = add(r0, qrot(b0, sub(R.s1, R.s0)));
  const r2 = add(r1, qrot(b1, sub(R.s2, R.s1)));
  const rs = add(r2, qrot(b2, sub(mid(R.shR, R.shL), R.s2)));
  q.pelvis = rz(-(lean - a2(rs)));
  J.hipC = P3(p.hip);
  // A foot planted on the floor stays there: if a leg cannot reach it, as in a wide stance, the hips come down until it can.
  const planted = (s) => !!(s && s.to && s.to[1] >= 82 && s.foot === undefined && !s.toe && !s.toeBy);
  const footZ = (s, sd, k) => k * (s.to && s.to[2] !== undefined ? s.to[2] : s.z ?? (x.stance !== undefined ? x.stance / 2 : Math.abs(R[`ankle${sd}`][2])));
  let drop = 0;
  for (const [sd, s] of [['R', p.leg], ['L', p.leg2 || p.leg]]) {
    if (!planted(s)) continue;
    const r = rest[sd]; const H = add(J.hipC, qrot(q.pelvis, sub(R[`hip${sd}`], R.hipC)));
    const A = [s.to[0] - 60, FLOOR - s.to[1] + r.ankleH - 1, footZ(s, sd, r.k)];
    const L = r.lt + r.ls - 0.05; const flat = (H[0] - A[0]) ** 2 + (H[2] - A[2]) ** 2;
    if (flat < L * L) drop = Math.max(drop, H[1] - A[1] - Math.sqrt(L * L - flat));
  }
  if (drop > 0) J.hipC = [J.hipC[0], J.hipC[1] - drop, J.hipC[2]];
  const fromHip = (v) => add(J.hipC, qrot(q.pelvis, v));
  q.s0 = qmul(q.pelvis, b0); q.s1 = qmul(q.pelvis, b1); q.s2 = qmul(q.pelvis, b2);
  J.s0 = fromHip(r0); J.s1 = fromHip(r1); J.s2 = fromHip(r2);
  const fromChest = (v) => add(J.s2, qrot(q.s2, sub(v, R.s2)));
  J.shR = fromChest(R.shR); J.shL = fromChest(R.shL); J.neck = fromChest(R.neck);
  J.shC = mid(J.shR, J.shL);
  q.neck = qmul(q.s2, rz(-nod / 2));
  J.head = add(J.neck, qrot(q.neck, sub(R.head, R.neck)));
  q.head = qmul(q.neck, rz(-nod / 2));
  J.headC = add(J.head, qrot(q.head, sub(R.headC, R.head)));
  J.hipR = fromHip(sub(R.hipR, R.hipC)); J.hipL = fromHip(sub(R.hipL, R.hipC));
  const t = d2(lean); const front = [t[1], -t[0], 0];

  const hands = {}; const feet = {};

  const arm = (s, sd) => {
    const r = rest[sd]; const k = r.k; const S = J[`sh${sd}`];
    const hint = s.hint || [-0.3, 1];
    const pole = [hint[0], -hint[1], k * (s.flare ?? x.flare ?? 0.15)];
    const wide = s.z ?? (x.grip !== undefined ? x.grip / 2 : undefined);
    // `stack`: the elbow is kept at the depth of the hand (1), or at that share of it, so the forearm stands under the bar.
    const stack = s.stack ?? x.stack;
    const under = (to) => (stack === undefined ? undefined : to[2] * stack);
    let E; let G; let T = null;
    if (s.v) {
      E = add(S, mul(unit([s.v[0][0], s.v[0][1], k * s.v[0][2]]), r.lu));
      G = add(E, mul(unit([s.v[1][0], s.v[1][1], k * s.v[1][2]]), r.lf));
    } else if (s.a) {
      const o = s.out || [0, 0];
      const along = (a, out) => add(mul(d2(a), Math.cos(rad(out))), [0, 0, k * Math.sin(rad(out))]);
      E = add(S, mul(along(s.a[0], o[0]), r.lu));
      G = add(E, mul(along(s.a[1], o[1]), r.lf));
      if (wide !== undefined) { // the hands at a set width: the forearm swings in or out, keeping its length
        const dz = Math.max(-r.lf * 0.9, Math.min(r.lf * 0.9, k * wide - E[2]));
        const flat = unit([G[0] - E[0], G[1] - E[1], 0], [0, -1, 0]);
        G = add(E, add(mul(flat, Math.sqrt(r.lf * r.lf - dz * dz)), [0, 0, dz]));
      }
    } else {
      const at = s.rel ? add(add([S[0], S[1], 0], mul(t, -s.rel[0])), mul(front, s.rel[1])) : P3(s.to);
      const z = (s.rel ? s.rel[2] : s.to[2]) ?? wide ?? Math.abs(R[`sh${sd}`][2]);
      T = [at[0], at[1], k * z];
      ({ joint: E, end: G } = ik3(S, T, r.lu, r.lf, pole, under(T)));
    }
    // The hand: turned around the forearm until the line across the palm lies along the handle,
    // and bent back at the wrist if asked, as when the palm lies flat on the floor.
    const handle = s.handle ?? x.handle ?? 'z';
    const grip = s.grip ?? x.hold;
    const bent = s.wrist ?? x.wrist ?? 0;
    const forearm = sub(R[`wrist${sd}`], R[`elbow${sd}`]); const inHand = sub(R[`grip${sd}`], R[`wrist${sd}`]);
    const held = () => {
      const v = unit(sub(G, E));
      const n = hinge(S, E, G, pole);
      const neutral = unit(square(mul(n, -k), v));
      let want = 0;
      if (handle !== 'n') {
        const h = unit(square(AXES[handle] || handle, v), [0, 0, 0]);
        if (len(h) > 0.3) {
          const a = k * around(neutral, unit(cross(v, h)), v);
          const b = a > 0 ? a - 180 : a + 180;
          const lo = Math.min(a, b); const hi = Math.max(a, b);
          want = grip === 'under' ? (hi <= 135 ? hi : lo) : grip === 'over' ? (lo >= -135 ? lo : hi) : (Math.abs(lo) <= Math.abs(hi) + 1 ? lo : hi);
        }
      }
      const qf = turn(r.fore, basis(v, n));
      let qh = qmul(qaxis(v, k * (want - r.turned)), qf);
      let palm = qrot(qaxis(v, k * want), neutral); let along = v;
      if (bent) { const f = qaxis(cross(palm, v), bent); qh = qmul(f, qh); palm = qrot(f, palm); along = qrot(f, v); }
      const W = add(E, qrot(qf, forearm));
      return { n, want, qf, qh, palm, along, W, at: add(W, qrot(qh, inHand)) };
    };
    let h = held();
    // The middle of the palm is not on the line of the forearm, so the arm is aimed again until the palm is on the spot.
    if (T) {
      let aim = T;
      for (let i = 0; i < 4 && dist(h.at, T) > 0.01; i++) {
        aim = sub(aim, sub(h.at, T));
        ({ joint: E, end: G } = ik3(S, aim, r.lu, r.lf, pole, under(T)));
        h = held();
      }
    }
    q[`upper${sd}`] = turn(r.upper, basis(sub(E, S), h.n));
    q[`fore${sd}`] = h.qf;
    q[`hand${sd}`] = h.qh;
    J[`elbow${sd}`] = E; J[`wrist${sd}`] = h.W; J[`grip${sd}`] = h.at;
    hands[sd] = { at: h.at, along: h.along, palm: h.palm, axis: unit(cross(h.palm, h.along)), turned: h.want, shut: s.shut ?? x.shut ?? 1 };
  };

  const leg = (s, sd) => {
    const r = rest[sd]; const k = r.k; const H = J[`hip${sd}`];
    const hint = s.hint || [1, -0.2];
    const pole = [hint[0], -hint[1], k * (s.knees ?? x.knees ?? 0)];
    const z = footZ(s, sd, k);
    const lift = r.ankleH - 1; // the drawings put the ankle 1 above the sole; the figure's is higher
    let K; let A; let f; let up;
    // The foot's line in the side plane, by the rules of the side drawing, and which way its top faces.
    const footBy = (shin, base) => {
      if (s.toe) f = unit(sub(P3(s.toe), base));
      else if (s.toeBy) f = unit([s.toeBy[0], -s.toeBy[1], 0]);
      else f = d2(s.foot ?? a2(shin) + (s.prone ? 85 : -85));
      f = unit([f[0], f[1], 0]);
      up = [-f[1], f[0], 0];
      if (dot(up, shin) > 0) up = mul(up, -1);
    };
    if (s.a) {
      const o = s.out || [0, 0];
      const along = (a, out) => add(mul(d2(a), Math.cos(rad(out))), [0, 0, k * Math.sin(rad(out))]);
      K = add(H, mul(along(s.a[0], o[0]), r.lt));
      A = add(K, mul(along(s.a[1], o[1]), r.ls));
      footBy(sub(A, K), [A[0], A[1], 0]);
    } else {
      const base = P3(s.to);
      if (planted(s)) { f = [1, 0, 0]; up = [0, 1, 0]; } else {
        const first = ik3(H, [base[0], base[1] + lift, z], r.lt, r.ls, pole);
        footBy(sub(first.end, first.joint), base);
      }
      // The ankle sits above the sole by `lift`. A foot turned over, its top on the floor as when kneeling, has it just above the floor instead.
      const off = up[1] < 0 ? [0, 0.7] : [up[0] * lift, up[1] * lift];
      ({ joint: K, end: A } = ik3(H, [base[0] + off[0], base[1] + off[1], z], r.lt, r.ls, pole));
    }
    // No part of a foot goes under the floor. A foot that is all but flat is laid flat; one on its toes has the ankle lifted until the toes rest on the floor.
    // A foot with its sole down touches the floor where it does at rest; one turned over or on its tip, half a unit above its bones.
    const low = () => { const qf = turn(r.foot, basis(f, up)); return Math.min(...['toe', 'tip'].map((j) => A[1] + qrot(qf, sub(R[`${j}${sd}`], R[`ankle${sd}`]))[1] - (up[1] > 0.3 ? R[`${j}${sd}`][1] : 0.5))); };
    if (low() < -0.02) {
      if (up[1] > 0.3 && Math.abs(f[1]) < 0.3 && f[0] > 0) { f = [1, 0, 0]; up = [0, 1, 0]; }
      for (let i = 0; i < 3 && low() < -0.02; i++) ({ joint: K, end: A } = ik3(H, [A[0], A[1] - low(), A[2]], r.lt, r.ls, pole));
    }
    const toes = s.toes ?? x.toes ?? 0;
    if (toes) f = qrot(qaxis(up, -k * toes), f);
    const n = hinge(H, K, A, pole);
    q[`thigh${sd}`] = turn(r.thigh, basis(sub(K, H), n));
    q[`shin${sd}`] = turn(r.shin, basis(sub(A, K), n));
    const qf = turn(r.foot, basis(f, up));
    q[`foot${sd}`] = qf;
    J[`knee${sd}`] = K; J[`ankle${sd}`] = A;
    J[`toe${sd}`] = add(A, qrot(qf, sub(R[`toe${sd}`], R[`ankle${sd}`])));
    J[`tip${sd}`] = add(A, qrot(qf, sub(R[`tip${sd}`], R[`ankle${sd}`])));
    feet[sd] = { sole: sub(A, mul(up, lift)), along: f, up };
  };

  const hang = { a: [178, 174] };
  arm(p.arm || hang, 'R'); arm(p.arm2 || p.arm || hang, 'L');
  const stood = { to: [p.hip[0] + 1, 83] };
  leg(p.leg || stood, 'R'); leg(p.leg2 || p.leg || stood, 'L');
  return { J, q, hands, feet, lean, t, front };
}

// ---------------------------------------------------------------- equipment in depth

const cyl = (a, b, r, m) => ({ k: 'cyl', a, b, r, m });
const ball = (c, r, m) => ({ k: 'ball', c, r, m });
const box = (c, s, rzDeg, m) => ({ k: 'box', c, s, rz: rzDeg, m });

const dumbbell = (c, axis, m = 'move', half = 3.5, r = 2.5) => {
  const a = unit(axis);
  return [
    cyl(add(c, mul(a, -half)), add(c, mul(a, half)), 0.62, 'steel'),
    cyl(add(c, mul(a, -half - 1.4)), add(c, mul(a, -half + 1.4)), r, m),
    cyl(add(c, mul(a, half - 1.4)), add(c, mul(a, half + 1.4)), r, m),
  ];
};

// One piece of the side drawing, given its depth.
function lift(it, fig) {
  const g = it.g;
  if (!g) return [];
  const zs = g.z === undefined ? [0] : [].concat(g.z);
  const out = [];
  if (g.t === 'tube') {
    for (const z of zs) for (const line of it.l) {
      for (let i = 0; i + 1 < line.length; i++) out.push(cyl(P3(line[i], z), P3(line[i + 1], z), g.r, g.m));
      for (let i = 0; i < line.length; i++) out.push(ball(P3(line[i], z), g.r, g.m));
    }
  } else if (g.t === 'box') {
    for (const z of zs) out.push(box(P3(g.c, z), [g.w, g.h, g.d], -g.deg, g.m));
  } else if (g.t === 'disc') {
    for (const z of zs) out.push(cyl(P3(it.p, z - g.th / 2), P3(it.p, z + g.th / 2), it.r, g.m));
  } else if (g.t === 'plates') {
    for (const s of [1, -1]) {
      out.push(cyl(P3(it.p, s * g.z), P3(it.p, s * (g.z + 2.4)), g.r, 'weight'));
      if (g.r > 7) out.push(cyl(P3(it.p, s * (g.z + 2.4)), P3(it.p, s * (g.z + 4.2)), g.r * 0.72, 'weight'));
    }
  } else if (g.t === 'bar') {
    const p = g.p || it.p; const c = g.c || 0;
    out.push(cyl(P3(p, c - g.half), P3(p, c + g.half), g.r, g.m));
  } else if (g.t === 'dumb') {
    for (const sd of g.hands === 'R' ? ['R'] : g.hands === 'L' ? ['L'] : ['R', 'L']) out.push(...dumbbell(fig.hands[sd].at, fig.hands[sd].axis, 'move', 3.4, g.r * 0.7));
  } else if (g.t === 'db') {
    if (g.hands) for (const sd of ['R', 'L']) out.push(...dumbbell(fig.hands[sd].at, fig.hands[sd].axis));
    else out.push(...dumbbell(P3(g.p, g.z || 0), g.a === 'z' ? [0, 0, 1] : d2(g.a)));
  } else if (g.t === 'slab') {
    // A board seen edge-on in the side drawing, from `a` to `b`, `d` wide.
    const a = P3(g.a); const b = P3(g.b); const v = sub(b, a);
    out.push(box(mid(a, b), [len(v), g.th || 1.6, g.d], deg(Math.atan2(v[1], v[0])), g.m || 'move'));
  } else if (g.t === 'prims') out.push(...g.prims);
  return out;
}

// ---------------------------------------------------------------- a move at one moment

/** The joints of the figure as the side drawing knows them, for the equipment that follows the body. */
function flatJoints(fig) {
  const { J, feet, hands } = fig;
  return {
    hip: p2(J.hipC), sh: p2(J.shC), head: p2(J.headC), t: [fig.t[0], -fig.t[1]], front: [fig.front[0], -fig.front[1]],
    elbow: p2(J.elbowR), hand: p2(J.gripR), elbow2: p2(J.elbowL), hand2: p2(J.gripL),
    knee: p2(J.kneeR), ankle: p2(feet.R.sole), toe: p2(J.tipR), knee2: p2(J.kneeL), ankle2: p2(feet.L.sole), toe2: p2(J.tipL),
    // Depth, for the pieces that sit at a hand, a foot, a shoulder or a knee.
    z: { hand: Math.abs(J.gripR[2]), hand2: Math.abs(J.gripL[2]), foot: Math.abs(J.ankleR[2]), sh: Math.abs(J.shR[2]), knee: Math.abs(J.kneeR[2]), hip: Math.abs(J.hipR[2]) },
    fig, hands,
  };
}

/**
 * A move at the moment `t` (0 the start of a rep, 1 the end of the effort):
 * the figure and the equipment in space.
 * @returns {{fig: object, prims: object[], yaw: number, cam: {az: number, el: number}} | null}
 */
export function scene3(id, t, { plates = false } = {}, F = FIGURE) {
  const mv = MOVES[id];
  if (!mv) return null;
  const x = (typeof mv.d3 === 'function' ? mv.d3(t) : mv.d3) || {};
  FLOOR = x.floor ?? 84;
  try {
    const fig = rig3(mv.pose3 ? mv.pose3(t) : mv.pose(t), x, F);
    const J = flatJoints(fig);
    const g = withPlates(plates, () => (mv.gear3 || mv.gear)(J, t));
    const prims = [...g.back, ...g.front].flatMap((it) => lift(it, fig));
    const front = mv.view === 'front';
    return { fig, prims, yaw: x.yaw ?? (front ? -90 : 0), cam: { az: 38, el: 9, ...(mv.cam || {}) } };
  } finally { FLOOR = 84; }
}

/** The middle and the reach of everything a move shows over a whole rep, for pointing a camera at it. */
export function reach3(id, opts, F = FIGURE) {
  let lo = [1e9, 1e9, 1e9]; let hi = [-1e9, -1e9, -1e9];
  const take = (p, r = 0) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i] - r); hi[i] = Math.max(hi[i], p[i] + r); } };
  for (const t of [0, 0.5, 1]) {
    const s = scene3(id, t, opts, F);
    if (!s) return null;
    for (const p of Object.values(s.fig.J)) take(p, 3);
    take(s.fig.J.headC, F.headR + 1);
    for (const pr of s.prims) {
      if (pr.k === 'cyl') { take(pr.a, pr.r); take(pr.b, pr.r); } else if (pr.k === 'ball') take(pr.c, pr.r);
      else take(pr.c, Math.hypot(pr.s[0], pr.s[1], pr.s[2]) / 2);
    }
  }
  lo = [lo[0], Math.max(lo[1], 0), lo[2]];
  const c = mid(lo, hi);
  return { c, r: dist(lo, hi) / 2, lo, hi };
}

export const MOVE_IDS = Object.keys(MOVES);

/** The moment of a rep that shows a move best as a still picture: partway into the effort unless the move says otherwise. */
export const poster = (id) => MOVES[id]?.still ?? 0.6;
