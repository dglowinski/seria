// How each exercise moves: a stick figure and the equipment, drawn from the
// side unless the move is clearer from the front. Nothing here is a picture
// file. Each move is a small function that says where the body is at any point
// of a rep; the limbs are worked out from that with fixed lengths, so elbows
// and knees bend the way they do. The screen (ui/motion.js) plays the frames.
//
// Drawn on the same 120 x 90 grid as the equipment sketches, floor at y = 84.
// Angles are in degrees: 0 points up, 90 to the right, 180 down.

const rad = (d) => (d * Math.PI) / 180;
export const dir = (a) => [Math.sin(rad(a)), -Math.cos(rad(a))];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const len = (p) => Math.hypot(p[0], p[1]);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (p, q, t) => (Array.isArray(p) ? p.map((v, i) => lerp(v, q[i], t)) : lerp(p, q, t));
const angleOf = (v) => (Math.atan2(v[0], -v[1]) * 180) / Math.PI;
const unit = (v) => mul(v, 1 / (len(v) || 1));

/** Body measures, in grid units. One unit is a little over 2 cm: legs 88 cm, arms 61 cm to the grip. */
export const BODY = { torso: 23, neck: 7.5, head: 4.6, upper: 13.5, fore: 13.5, thigh: 19.5, shin: 19.5, foot: 6, shoulder: 8.5, pelvis: 4.8 };
const B = BODY;
const FLOOR = 84;

// A limb of two bones from `root` to `target`. The joint bends toward `hint`.
// A target out of reach is met as far as the limb goes, so bones never stretch.
function ik(root, target, l1, l2, hint) {
  let d = sub(target, root);
  let L = len(d);
  if (L < 1e-6) { d = [0, 1]; L = 1; }
  const u = mul(d, 1 / L);
  const D = Math.min(Math.max(L, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  let n = [-u[1], u[0]];
  if (n[0] * hint[0] + n[1] * hint[1] < 0) n = mul(n, -1);
  return { joint: add(add(root, mul(u, a)), mul(n, h)), end: add(root, mul(u, D)) };
}

// A limb given either as a place to reach ({ to, hint }) or as two angles ({ a: [first bone, second bone] }).
function limb(root, spec, l1, l2, hint) {
  if (spec.a) { const j = add(root, mul(dir(spec.a[0]), l1)); return { joint: j, end: add(j, mul(dir(spec.a[1]), l2)) }; }
  return ik(root, spec.to, l1, l2, spec.hint || hint);
}

// ---------------------------------------------------------------- the two figures

// Seen from the side, facing right. `rel` places a hand against the body:
// [how far down the torso from the shoulder, how far in front].
function sideRig(p) {
  const lean = p.lean || 0;
  const t = dir(lean);
  const hip = p.hip;
  const sh = add(hip, mul(t, B.torso));
  const front = [-t[1], t[0]];
  const J = { hip, sh, t, front, head: add(sh, mul(dir(lean + (p.nod || 0)), B.neck)) };
  const rel = (r) => add(add(sh, mul(t, -r[0])), mul(front, r[1]));
  const arm = (s) => { const r = limb(sh, s.rel ? { ...s, to: rel(s.rel) } : s, B.upper, B.fore, [-0.3, 1]); return [r.joint, r.end]; };
  const leg = (s) => {
    const r = limb(hip, s, B.thigh, B.shin, [1, -0.2]);
    const shin = angleOf(sub(r.end, r.joint));
    // A foot planted on the floor lies flat on it, whatever the shin does.
    const planted = s.to && s.to[1] >= 82 && s.foot === undefined;
    const toe = s.toe || (s.toeBy ? add(r.end, s.toeBy) : planted ? [r.end[0] + B.foot, FLOOR]
      : s.foot === null ? null : add(r.end, mul(dir(s.foot ?? shin + (s.prone ? 85 : -85)), B.foot)));
    return [r.joint, r.end, toe];
  };
  if (p.arm) [J.elbow, J.hand] = arm(p.arm);
  if (p.arm2) [J.elbow2, J.hand2] = arm(p.arm2);
  if (p.leg) [J.knee, J.ankle, J.toe] = leg(p.leg);
  if (p.leg2) [J.knee2, J.ankle2, J.toe2] = leg(p.leg2);
  const body = (c, ...pts) => ({ k: 'path', c, l: [pts.filter(Boolean)] });
  J.draw = {
    far: [
      ...(p.leg2 ? [body('mv-b2', hip, J.knee2, J.ankle2, J.toe2)] : []),
      ...(p.arm2 ? [body('mv-b2', sh, J.elbow2, J.hand2)] : []),
    ],
    near: [
      body('mv-b', hip, sh, J.head),
      ...(p.leg ? [body('mv-b', hip, J.knee, J.ankle, J.toe)] : []),
      { k: 'circle', c: 'mv-h', p: J.head, r: B.head },
    ],
    arm: p.arm ? [body('mv-b', sh, J.elbow, J.hand)] : [],
  };
  return J;
}

// Seen from the front. The left side mirrors the right unless given. An arm
// marked `straight` points partly at the viewer, so it is drawn shorter.
function frontRig(p) {
  const cx = p.sh[0];
  const mirror = (q) => [2 * cx - q[0], q[1]];
  const sh = p.sh;
  const pel = p.pel || [cx, sh[1] + B.torso];
  const shR = [cx + B.shoulder, sh[1]]; const shL = [cx - B.shoulder, sh[1]];
  const pelR = [pel[0] + B.pelvis, pel[1]]; const pelL = [pel[0] - B.pelvis, pel[1]];
  const head = p.head || [cx, sh[1] - B.neck];
  const J = { sh, pel, shR, shL, pelR, pelL, head, cx };
  // `short` is how much of the upper arm shows when it points partly at the viewer, as it does at the top of a pull-up.
  const armOf = (root, s) => {
    if (s.straight) return [mix(root, s.to, 0.5), s.to];
    const r = limb(root, s, B.upper * (s.short ?? 1), B.fore, [0.4, 1]);
    return [r.joint, r.end];
  };
  const flip = (s) => ({ ...s, ...(s.to ? { to: mirror(s.to) } : {}), ...(s.hint ? { hint: [-s.hint[0], s.hint[1]] } : {}), ...(s.a ? { a: s.a.map((x) => -x) } : {}) });
  if (p.arm) {
    [J.elbowR, J.handR] = armOf(shR, p.arm);
    [J.elbowL, J.handL] = armOf(shL, p.armL || flip(p.arm));
  }
  // Legs as offsets from each side of the pelvis: knee, then foot. Seen from the front a bent leg looks short.
  const legs = p.legs === 'seat' ? { knee: [2.5, 6], foot: [3.5, FLOOR - 1 - pel[1]] } : p.legs === 'hang' ? { knee: [0.5, 19], foot: [0.5, 24] }
    : p.legs === 'none' ? null : p.legs || { knee: [1.2, 19.5], foot: [2.2, 39] };
  if (legs) {
    const kneeL = legs.kneeL || [-legs.knee[0], legs.knee[1]]; const footL = legs.footL || [-legs.foot[0], legs.foot[1]];
    J.kneeR = add(pelR, legs.knee); J.footR = add(pelR, legs.foot);
    J.kneeL = add(pelL, kneeL); J.footL = add(pelL, footL);
  }
  const body = (c, ...pts) => ({ k: 'path', c, l: [pts] });
  J.draw = {
    far: [],
    near: [
      ...(p.bare ? [] : [body('mv-b', sh, pel), body('mv-b', pelL, pelR)]),
      body('mv-b', shL, shR),
      ...(legs ? [body('mv-b', pelR, J.kneeR, J.footR), body('mv-b', pelL, J.kneeL, J.footL)] : []),
      { k: 'circle', c: 'mv-h', p: head, r: B.head },
    ],
    arm: p.arm ? [body('mv-b', shR, J.elbowR, J.handR), body('mv-b', shL, J.elbowL, J.handL)] : [],
  };
  return J;
}

// ---------------------------------------------------------------- equipment pieces
// f frame, m the part you move, c cable, p pad, w plate or pulley, d handle or roller you move.

const rect = (c, w, h, deg = 0) => {
  const k = Math.cos(rad(deg)); const s = Math.sin(rad(deg));
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [c[0] + x * k - y * s, c[1] + x * s + y * k]);
};
const F = (...l) => ({ k: 'path', c: 'sk-f', l });
const M = (...l) => ({ k: 'path', c: 'sk-m', l });
const C = (...l) => ({ k: 'path', c: 'sk-c', l });
const P = (c, w, h, deg = 0) => ({ k: 'poly', c: 'mv-p', l: [rect(c, w, h, deg)] });
/** A pad whose long side runs along the angle `a`. */
const PA = (c, long, thick, a) => P(c, long, thick, a - 90);
const MP = (c, w, h, deg = 0) => ({ k: 'poly', c: 'sk-mp', l: [rect(c, w, h, deg)] });
const W = (p, r) => ({ k: 'circle', c: 'sk-w', p, r });
const D = (p, r = 3.2) => ({ k: 'circle', c: 'sk-mp', p, r });
const R = (p, r = 3.5) => ({ k: 'circle', c: 'mv-p', p, r });
/** A dumbbell seen side-on, its handle along the angle `a`. */
const DB = (p, a) => [M([add(p, mul(dir(a), -3.6)), add(p, mul(dir(a), 3.6))]), D(add(p, mul(dir(a), -3.6)), 2.5), D(add(p, mul(dir(a), 3.6)), 2.5)];
// Set while a picture is worked out for a machine that is loaded with plates instead of a weight stack.
let platesNow = false;
/** The weights of a machine: a stack whose top rises as the move is made, or plates on a peg that lift a little. */
const stack = (x, t, lift = 9, y = 44) => (platesNow ? [
  F([[x, FLOOR], [x, y + 16]], [[x - 8, FLOOR], [x + 8, FLOOR]]),
  C([[x - 7, y + 12], [x + 7, y + 12]]),
  W([x, y + 27 - lift * t * 0.5], 10),
  D([x, y + 27 - lift * t * 0.5], 2.6),
] : [
  { k: 'poly', c: 'sk-w', l: [rect([x, y + 20], 14, 40)] },
  C([[x - 7, y + 12], [x + 7, y + 12]], [[x - 7, y + 20], [x + 7, y + 20]], [[x - 7, y + 28], [x + 7, y + 28]]),
  MP([x, y + 3 - lift * t], 14, 6),
]);
/** A barbell seen end-on: the plate behind the body, the bar end in front. */
const plate = (p, r = 8) => W(p, r);
const barEnd = (p) => D(p, 2.2);

// ---------------------------------------------------------------- the moves
// Each move: view ('side' or 'front'), pose(t) for the figure, gear(J, t) for
// the equipment as { back, front } around the body. t runs from 0, the start
// of a rep, to 1, the end of the effort. `fit: [scale, dx, dy]` shrinks a tall
// move into the frame; `flip` mirrors it left to right.

const stand = (x = 56) => ({ to: [x, 83] });

// Squat: hips back and down, feet flat. `hold` says where the hands are.
const squatPose = (t, hold) => {
  const hip = mix([60, 44], [49, 65], t);
  const lean = lerp(4, 38, t);
  return { hip, lean, nod: lerp(0, -22, t), leg: { to: [62, 83], hint: [1, -0.3] }, arm: hold };
};

const lying = (extra) => ({ hip: [70, 55.5], lean: -90, leg: { to: [91, 83], hint: [1, -1] }, ...extra });
const flatBench = () => [P([53, 62], 60, 6), F([[30, 84], [30, 65]], [[76, 84], [76, 65]])];

// Seated on a machine, back against the pad.
const seated = (extra, lean = -6) => ({ hip: [58, 60], lean, leg: { to: [79, 81.5], hint: [0.3, -1] }, ...extra });
const seatGear = (lean = -6) => {
  const mid = add([58, 60], mul(dir(lean), 12));
  return [F([[40, 84], [40, 8]], [[28, 84], [96, 84]], [[62, 84], [62, 70]]), P([62, 67], 22, 6), PA(add(mid, [-4.6, 0.4]), 26, 5, lean)];
};

const standing = (extra, x = 56) => ({ hip: [x - 1, 44], lean: 1, leg: stand(x), ...extra });

export const MOVES = {
  // ---------------------------------------------------------------- legs
  squat_bar: {
    pose: (t) => squatPose(t, { rel: [1, -2], hint: [-0.2, 1] }),
    gear: (J) => ({ back: [F([[88, 84], [88, 12]], [[80, 84], [98, 84]], [[88, 24], [83, 24]]), plate(add(J.sh, [-2, 1.5]), 8)], front: [barEnd(add(J.sh, [-2, 1.5]))] }),
  },
  squat_goblet: {
    pose: (t) => squatPose(t, { rel: [6, 7], hint: [0, 1] }),
    gear: (J) => ({ back: [], front: DB(J.hand, angleOf(J.t)) }),
  },
  squat_smith: {
    pose: (t) => squatPose(t, { rel: [1, -2], hint: [-0.2, 1] }),
    gear: (J) => ({ back: [F([[70, 84], [70, 8], [92, 8]], [[58, 84], [100, 84]]), C([[63, 10], [63, 82]]), plate([63, J.sh[1] + 1.5], 7)], front: [barEnd([63, J.sh[1] + 1.5])] }),
  },
  leg_press: {
    pose: (t) => {
      const foot = mix([57, 56.2], [68.3, 48], t);
      return { hip: [38, 70], lean: -50, nod: 30, leg: { to: foot, hint: [-0.2, -1], foot: -36 }, arm: { to: [43, 75], hint: [-1, 0.5] } };
    },
    gear: (J) => {
      const c = add(J.ankle, [1.2, -3.2]); const n = [0.584, 0.812];
      return {
        back: [F([[10, 84], [110, 84]], [[42, 82], [106, 36]], [[106, 84], [106, 36]]), PA([25.8, 66.2], 30, 5.5, -50), P([39, 76.5], 16, 5, -8), W(add(c, [15, -6]), 8)],
        front: [M([add(c, mul(n, -10)), add(c, mul(n, 9))])],
      };
    },
  },
  hack_squat: {
    pose: (t) => {
      const hip = add([36, 70], mul([0.774, -0.633], lerp(26, 9, t)));
      return { hip, lean: 50.7, nod: -40, leg: { to: [29, 76], hint: [-0.6, -0.8], foot: -39 }, arm: { rel: [-1, -5], hint: [0.4, 1] } };
    },
    gear: (J) => ({
      back: [F([[10, 84], [100, 84]], [[35, 81], [93, 34]], [[93, 84], [93, 34]]), P([24.6, 75.8], 20, 5, 50.7), PA(add(mix(J.hip, J.sh, 0.5), [2.9, 3.5]), 26, 5, 50.7), W(add(J.sh, [9, 10]), 7)],
      front: [MP(add(J.sh, [3.4, -1.2]), 9, 5, -39.3)],
    }),
  },
  split_squat: {
    pose: (t) => ({
      hip: mix([55, 46.5], [52, 62], t), lean: lerp(6, 14, t),
      leg: { to: [68, 83], hint: [1, -0.3] }, leg2: { to: [31, 57], hint: [0, 1], foot: 250 },
      arm: { a: [178, 180] },
    }),
    gear: (J) => ({ back: [P([24, 62], 22, 6), F([[17, 84], [17, 65]], [[31, 84], [31, 65]])], front: [D(J.hand)] }),
  },
  lunge_back: {
    pose: (t) => ({
      hip: mix([57, 44.5], [52, 60], t), lean: lerp(2, 10, t),
      leg: { to: [60, 83], hint: [1, -0.3] },
      leg2: { to: [lerp(56, 28, t), lerp(83, 80, t) - 7 * Math.sin(Math.PI * t)], hint: [0.6, 1], toeBy: [lerp(6, 3.4, t), lerp(1, 4, t)] },
      arm: { a: [178, 180] },
    }),
    gear: (J) => ({ back: [], front: [D(J.hand)] }),
  },
  step_up: {
    fit: [0.8, 0, 0],
    pose: (t) => ({
      hip: mix([51, 45], [67, 30.5], t), lean: lerp(14, 2, t),
      leg: { to: [69, 69], hint: [1, -0.3] },
      leg2: { to: [lerp(46, 64, t), lerp(83, 69, t) - 5 * Math.sin(Math.PI * t)], hint: [1, -0.2] },
      arm: { a: [178, 180] },
    }),
    gear: (J) => ({ back: [P([78, 77], 34, 14)], front: [D(J.hand)] }),
  },
  leg_extension: {
    pose: (t) => ({ hip: [40, 53], lean: -15, leg: { a: [88, lerp(188, 97, t)] }, arm: { to: [45, 60], hint: [-1, 0.2] } }),
    gear: (J, t) => {
      const shin = unit(sub(J.ankle, J.knee)); const roll = add(add(J.ankle, mul(shin, -3)), mul(dir(angleOf(shin) - 90), 4.2));
      return {
        back: [F([[34, 84], [34, 62]], [[58, 84], [58, 62]], [[26, 84], [72, 84]]), P([47, 59.5], 30, 6), PA([33.3, 41.2], 26, 5, -15), ...stack(100, t)],
        front: [M([[59.5, 57.5], roll]), D(roll, 3.6)],
      };
    },
  },
  leg_extension_db: {
    pose: (t) => ({ hip: [40, 56], lean: -4, leg: { a: [88, lerp(186, 99, t)] }, arm: { to: [36, 61], hint: [-1, 0.2] } }),
    gear: (J) => ({ back: [P([38, 63], 46, 6), F([[20, 84], [20, 66]], [[54, 84], [54, 66]])], front: [D(add(J.ankle, mul(sub(J.toe, J.ankle), 0.35)), 3.6)] }),
  },
  leg_curl: {
    pose: (t) => ({ hip: [62, 46.5], lean: -90, nod: 16, leg: { a: [91, lerp(93, -14, t)], prone: true }, arm: { to: [42, 58], hint: [0.4, 1] } }),
    gear: (J, t) => {
      const shin = angleOf(sub(J.ankle, J.knee)); const roll = add(add(J.ankle, mul(dir(shin), -2)), mul(dir(shin - 90), 4.2));
      return {
        back: [F([[30, 84], [30, 58]], [[70, 84], [70, 58]], [[22, 84], [78, 84]]), P([51, 54], 56, 7), ...stack(11, t)],
        front: [M([[80, 52], roll]), D(roll, 3.6)],
      };
    },
  },
  leg_curl_db: {
    pose: (t) => ({ hip: [62, 55], lean: -90, nod: 16, leg: { a: [91, lerp(93, -10, t)], prone: true }, arm: { to: [42, 66], hint: [0.4, 1] } }),
    gear: (J) => ({ back: [P([51, 62], 56, 6), F([[30, 84], [30, 65]], [[72, 84], [72, 65]])], front: [D(add(J.ankle, mul(sub(J.toe, J.ankle), 0.3)), 3.6)] }),
  },
  leg_curl_seated: {
    pose: (t) => ({ hip: [40, 53], lean: -15, leg: { a: [88, lerp(100, 200, t)] }, arm: { to: [45, 60], hint: [-1, 0.2] } }),
    gear: (J, t) => {
      const shin = unit(sub(J.ankle, J.knee)); const roll = add(add(J.ankle, mul(shin, -3)), mul(dir(angleOf(shin) + 90), 4.2));
      return {
        back: [F([[34, 84], [34, 62]], [[58, 84], [58, 62]], [[26, 84], [72, 84]]), P([47, 59.5], 30, 6), PA([33.3, 41.2], 26, 5, -15), ...stack(100, t)],
        front: [R([56, 46], 3.4), M([[59.5, 57.5], roll]), D(roll, 3.6)],
      };
    },
  },
  leg_curl_cable: {
    pose: (t) => ({
      hip: [55, 44], lean: 6, leg: { a: [lerp(180, 176, t), lerp(182, 292, t)] }, leg2: stand(57),
      arm: { to: [80, 34], hint: [0, 1] },
    }),
    gear: (J, t) => ({ back: [F([[86, 84], [86, 12]], [[76, 84], [104, 84]]), ...stack(97, t, 7), W([84, 79], 3)], front: [C([J.ankle, [84, 79]]), D(J.ankle, 2.6)] }),
  },
  nordic: {
    pose: (t) => {
      const a = lerp(2, 52, t); const hip = add([52, 81], mul(dir(a), B.thigh));
      return { hip, lean: a + lerp(0, 6, t), leg: { to: [32.5, 81], hint: [1, 1], foot: 262 }, arm: { rel: [3, 8], hint: [0, 1] } };
    },
    gear: () => ({ back: [F([[22, 84], [22, 70], [36, 70]])], front: [R([32, 75.5], 3.2)] }),
  },
  calf_machine: {
    fit: [0.9, 0, 0],
    pose: (t) => {
      const a = lerp(6, 50, t); const toe = [62, 80]; const ankle = add(toe, [-6.5 * Math.cos(rad(a)), -6.5 * Math.sin(rad(a))]);
      return { hip: add(ankle, [-1, -39]), lean: 1, leg: { to: ankle, toe }, arm: { rel: [-2, 5], hint: [0.3, 1] } };
    },
    gear: (J, t) => ({
      back: [F([[30, 84], [30, 10]], [[20, 84], [86, 84]]), ...stack(18, t, 5, 42), P([63, 82], 16, 4)],
      front: [M([[30, 20], add(J.sh, [3, -3.4])]), MP(add(J.sh, [1, -3.2]), 12, 4.5)],
    }),
  },
  calf_db: {
    fit: [0.9, 0, 0],
    pose: (t) => {
      const a = lerp(6, 50, t); const toe = [62, 80]; const ankle = add(toe, [-6.5 * Math.cos(rad(a)), -6.5 * Math.sin(rad(a))]);
      return { hip: add(ankle, [-1, -39]), lean: 1, leg: { to: ankle, toe }, arm: { a: [179, 180] } };
    },
    gear: (J) => ({ back: [P([63, 82], 16, 4)], front: [D(J.hand)] }),
  },

  // ---------------------------------------------------------------- hinge and glutes
  deadlift: {
    pose: (t) => ({ hip: mix([46, 57], [57, 44], t), lean: lerp(60, 2, t), nod: lerp(-30, 0, t), leg: { to: [58, 83], hint: [1, -0.3] }, arm: { to: mix([64.5, 72], [61.5, 48.5], t), hint: [-1, 0] } }),
    gear: (J) => ({ back: [plate(J.hand, 10.5)], front: [barEnd(J.hand)] }),
  },
  rdl_bar: {
    pose: (t) => ({ hip: mix([49, 46], [57, 44], t), lean: lerp(70, 2, t), nod: lerp(-30, 0, t), leg: { to: [58, 83], hint: [1, -0.3] }, arm: { to: mix([65.5, 64], [61.5, 48.5], t), hint: [-1, 0] } }),
    gear: (J) => ({ back: [plate(J.hand, 8)], front: [barEnd(J.hand)] }),
  },
  rdl_db: {
    pose: (t) => ({ hip: mix([49, 46], [57, 44], t), lean: lerp(70, 2, t), nod: lerp(-30, 0, t), leg: { to: [58, 83], hint: [1, -0.3] }, arm: { to: mix([66, 64], [60, 48.5], t), hint: [-1, 0] } }),
    gear: (J) => ({ back: [], front: [D(J.hand, 3.6)] }),
  },
  back_extension: {
    pose: (t) => ({ hip: [62, 49], lean: lerp(128, 46, t), nod: -10, leg: { to: [34, 76], hint: [1, 1], foot: 135 }, arm: { rel: [5, 5], hint: [-1, 1] } }),
    gear: () => ({ back: [F([[24, 84], [100, 84]], [[40, 84], [68, 56]], [[68, 84], [68, 56]], [[28, 84], [34, 72]]), PA([63.5, 54.5], 16, 6, 46)], front: [R([38, 71], 3.4)] }),
  },
  hip_thrust: {
    pose: (t) => {
      const lean = lerp(-46, -86, t); const hip = sub([38, 55], mul(dir(lean), B.torso));
      return { hip, lean, nod: lerp(40, 80, t), leg: { to: [84, 83], hint: [0.6, -1] }, arm: { to: add(hip, [-1, -4]), hint: [-0.2, -1] } };
    },
    gear: (J) => ({ back: [P([31, 60.5], 16, 6), F([[26, 84], [26, 64]], [[36, 84], [36, 64]]), plate(add(J.hip, [1.5, -3.5]), 8.5)], front: [barEnd(add(J.hip, [1.5, -3.5]))] }),
  },
  glute_bridge: {
    pose: (t) => {
      const lean = lerp(-90, -116, t); const hip = sub([30, 80.5], mul(dir(lean), B.torso));
      return { hip, lean, nod: -(lean + 90), leg: { to: [74, 83], hint: [0.4, -1] }, arm: { to: add(hip, [-2, -5]), hint: [-0.2, -1] } };
    },
    gear: (J) => ({ back: [], front: [D(add(J.hip, [0, -5.5]), 3.8)] }),
  },
  kickback: {
    pose: (t) => ({ hip: [50, 44.5], lean: 34, leg: { a: [lerp(174, 232, t), lerp(180, 226, t)], foot: lerp(95, 150, t) }, leg2: stand(53), arm: { to: [76, 44], hint: [0, 1] } }),
    gear: (J, t) => ({ back: [F([[84, 84], [84, 14]], [[74, 84], [102, 84]], [[84, 44], [74, 44]]), ...stack(96, t, 7), W([82, 79], 3)], front: [C([J.ankle, [82, 79]]), D(J.ankle, 2.6)] }),
  },
  abduction: {
    view: 'front',
    pose: (t) => { const k = lerp(4, 17, t); return { sh: [60, 38], pel: [60, 61], legs: { knee: [k, 5], foot: [k + 1.5, 21] }, arm: { to: [72, 62], hint: [1, 0.3] } }; },
    gear: (J) => ({ back: [P([60, 67], 30, 5), F([[60, 84], [60, 70]], [[44, 84], [76, 84]])], front: [MP(add(J.kneeR, [3.4, 1]), 4, 10), MP(add(J.kneeL, [-3.4, 1]), 4, 10)] }),
  },

  // ---------------------------------------------------------------- pressing
  bench_bar: {
    pose: (t) => lying({ arm: { to: mix([52, 49.5], [49, 29], t), hint: [0.7, 1] } }),
    gear: (J) => ({ back: [...flatBench(), F([[40, 84], [40, 26]], [[40, 30], [44, 30]]), plate(J.hand, 8)], front: [barEnd(J.hand)] }),
  },
  bench_db: {
    pose: (t) => lying({ arm: { to: mix([53, 49], [49, 29], t), hint: [0.7, 1] } }),
    gear: (J) => ({ back: flatBench(), front: [D(J.hand, 3.8)] }),
  },
  bench_smith: {
    pose: (t) => lying({ arm: { to: mix([51, 49.5], [51, 29.2], t), hint: [0.7, 1] } }),
    gear: (J) => ({ back: [...flatBench(), F([[36, 84], [36, 8], [66, 8]]), C([[51, 10], [51, 82]]), plate(J.hand, 7)], front: [barEnd(J.hand)] }),
  },
  bench_incline: {
    pose: (t) => ({ hip: [70, 64], lean: -50, nod: 20, leg: { to: [89, 83], hint: [1, -1] }, arm: { to: mix([57, 43.5], [53, 22.8], t), hint: [0.6, 1] } }),
    gear: (J) => ({ back: [PA([58.6, 59.8], 30, 5.5, -50), P([75, 69.5], 16, 5), F([[52, 84], [58, 64]], [[78, 84], [78, 72]], [[46, 84], [84, 84]])], front: [D(J.hand, 3.8)] }),
  },
  chest_press: {
    pose: (t) => seated({ arm: { to: add([62, 7], mul(dir(lerp(176.7, 147, t)), 35)), hint: [-0.3, 1] } }),
    gear: (J, t) => ({
      back: [...seatGear(), F([[40, 7], [62, 7]]), ...stack(22, t)],
      front: [M([[62, 7], add(J.hand, [0.5, -2])], [add(J.hand, [0.5, -4]), add(J.hand, [0.5, 4])])],
    }),
  },
  shoulder_machine: {
    pose: (t) => seated({ arm: { to: add([40, 27], mul(dir(lerp(106, 42, t)), 21.8)), hint: [0.3, 1] } }),
    gear: (J, t) => ({ back: [...seatGear(), ...stack(22, t), M([[40, 27], J.hand])], front: [M([add(J.hand, [-3.5, 0]), add(J.hand, [3.5, 0])])] }),
  },
  ohp: {
    fit: [0.84, 0, 0],
    pose: (t) => standing({ lean: lerp(-2, 0, t), arm: { to: mix([60, 24], [56.5, -5.6], t), hint: [0.5, 1] } }),
    gear: (J) => ({ back: [plate(J.hand, 7)], front: [barEnd(J.hand)] }),
  },
  db_press: {
    view: 'front',
    pose: (t) => ({ sh: [60, 39], pel: [60, 62], legs: 'seat', arm: { to: mix([77, 35], [71, 12.6], t), hint: [1, 1] } }),
    gear: (J) => ({ back: [P([60, 68], 24, 5), F([[52, 84], [52, 71]], [[68, 84], [68, 71]])], front: [...DB(J.handR, 90), ...DB(J.handL, 90)] }),
  },
  pushup: {
    pose: (t) => {
      const sh = mix([73, 56.5], [78, 75.5], t); const ankle = [16.3, 81.5];
      const u = unit(sub(sh, ankle)); const hip = add(ankle, mul(u, 39));
      const a = angleOf(mul(u, -1));
      return { hip, lean: angleOf(sub(sh, hip)), nod: -24, leg: { a: [a, a], toe: [13.5, 84] }, arm: { to: [74, 83.2], hint: [-1, -0.5] } };
    },
    gear: () => ({ back: [], front: [] }),
  },
  dips: {
    pose: (t) => {
      const sh = mix([57, 18], [61, 33.5], t); const lean = lerp(10, 24, t);
      return { hip: sub(sh, mul(dir(lean), B.torso)), lean, nod: -lean, leg: { a: [lerp(176, 172, t), 250], foot: 215 }, arm: { to: [58, 44.4], hint: [-1, 0.1] } };
    },
    gear: () => ({ back: [F([[76, 84], [76, 44]], [[64, 84], [92, 84]])], front: [M([[44, 44.4], [78, 44.4]])] }),
  },

  // ---------------------------------------------------------------- pulling
  row_bar: {
    pose: (t) => ({ hip: [46, 50], lean: 62, nod: -30, leg: { to: [56, 83], hint: [1, -0.3] }, arm: { to: mix([66, 64], [57.5, 52], t), hint: [-1, -0.5] } }),
    gear: (J) => ({ back: [plate(J.hand, 8)], front: [barEnd(J.hand)] }),
  },
  row_db: {
    pose: (t) => ({
      hip: [46, 50], lean: 70, nod: -34, leg: { to: [52, 83], hint: [1, -0.3] }, leg2: { to: [40, 83], hint: [1, -0.3] },
      arm: { to: mix([68, 66.5], [60, 51], t), hint: [-1, -0.5] }, arm2: { to: [77, 58.5], hint: [-1, -0.6] },
    }),
    gear: (J) => ({ back: [P([86, 62], 32, 6), F([[74, 84], [74, 65]], [[98, 84], [98, 65]])], front: [D(J.hand, 3.8)] }),
  },
  row_seated: {
    flip: true,
    pose: (t) => ({ hip: [38, 59], lean: lerp(12, -6, t), leg: { to: [72, 68], hint: [0, -1], foot: 20 }, arm: { to: mix([68.5, 45], [46, 47], t), hint: [-1, 0.2] } }),
    gear: (J, t) => ({
      back: [F([[10, 84], [112, 84]], [[92, 84], [92, 26]], [[38, 84], [38, 69]], [[74, 84], [76, 60]]), P([37, 66], 24, 6), P([76.5, 68], 5, 18, 14), ...stack(104, t, 8), W([90, 46], 3.4)],
      front: [C([J.hand, [90, 46]]), M([add(J.hand, [0, -3.6]), add(J.hand, [0, 3.6])])],
    }),
  },
  row_chest: {
    pose: (t) => ({ hip: [44, 62], lean: 50, nod: -20, leg: { to: [24, 81], hint: [0.3, 1], toe: [20.5, 84] }, arm: { to: mix([62.5, 72], [56.5, 58.5], t), hint: [-1, -1] } }),
    gear: (J) => ({ back: [PA([55.6, 58], 30, 5.5, 50), F([[66, 84], [61, 55]], [[40, 84], [47, 68]], [[34, 84], [74, 84]])], front: [D(J.hand, 3.8)] }),
  },
  pullup: {
    view: 'front',
    pose: (t) => ({ sh: [60, lerp(36, 18, t)], legs: 'hang', arm: { to: [78, 10.5], hint: [1, 1], short: lerp(1, 0.62, t) } }),
    gear: () => ({ back: [F([[28, 84], [28, 10]], [[92, 84], [92, 10]])], front: [M([[24, 10.5], [96, 10.5]])] }),
  },
  chinup: {
    view: 'front',
    pose: (t) => ({ sh: [60, lerp(37, 18, t)], legs: 'hang', arm: { to: [69.5, 10.5], hint: [1, 1], short: lerp(1, 0.5, t) } }),
    gear: () => ({ back: [F([[28, 84], [28, 10]], [[92, 84], [92, 10]])], front: [M([[24, 10.5], [96, 10.5]])] }),
  },
  pulldown: {
    view: 'front',
    pose: (t) => ({ sh: [60, 43], pel: [60, 66], legs: 'seat', arm: { to: [80, lerp(19, 40.5, t)], hint: [0.5, 1] } }),
    gear: (J) => ({
      back: [F([[40, 6], [80, 6]], [[60, 84], [60, 75]]), P([60, 72], 24, 5), W([60, 8], 3), C([[60, 11], [60, J.handR[1]]])],
      front: [M([[33, J.handR[1]], [87, J.handR[1]]])],
    }),
  },

  // ---------------------------------------------------------------- arms
  curl_db: {
    pose: (t) => standing({ arm: { a: [176, lerp(172, 16, t)] } }),
    gear: (J) => ({ back: [], front: [D(J.hand, 3.8)] }),
  },
  curl_bar: {
    pose: (t) => standing({ arm: { a: [176, lerp(172, 16, t)] } }),
    gear: (J) => ({ back: [plate(J.hand, 6.5)], front: [barEnd(J.hand)] }),
  },
  curl_hammer: {
    pose: (t) => standing({ arm: { a: [176, lerp(172, 16, t)] } }),
    gear: (J) => ({ back: [], front: DB(J.hand, angleOf(sub(J.hand, J.elbow)) + 90) }),
  },
  curl_cable: {
    pose: (t) => standing({ arm: { a: [172, lerp(160, 14, t)] } }),
    gear: (J, t) => ({ back: [F([[90, 84], [90, 12]], [[78, 84], [108, 84]]), ...stack(100, t, 7), W([88, 79], 3)], front: [C([J.hand, [88, 79]]), M([add(J.hand, [-3, 0]), add(J.hand, [3, 0])])] }),
  },
  curl_machine: {
    pose: (t) => seated({ lean: 8, arm: { a: [128, lerp(124, 12, t)] } }, 8),
    gear: (J, t) => ({
      back: [F([[28, 84], [96, 84]], [[62, 84], [62, 70]], [[78, 84], [72, 52]]), P([62, 67], 22, 6), PA(add(mix(J.sh, J.elbow, 0.55), [-2.4, 3]), 18, 5, 128), ...stack(100, t, 7)],
      front: [M([J.elbow, J.hand]), D(J.hand, 3)],
    }),
  },
  pushdown: {
    pose: (t) => standing({ lean: 8, arm: { a: [170, lerp(52, 168, t)] } }),
    gear: (J, t) => ({ back: [F([[90, 84], [90, 8], [78, 8]], [[78, 84], [108, 84]]), ...stack(100, t, 7), W([78, 11], 3)], front: [C([J.hand, [78, 11]]), M([add(J.hand, [-3.4, 0]), add(J.hand, [3.4, 0])])] }),
  },
  triceps_overhead: {
    pose: (t) => ({ hip: [55, 60], lean: 0, leg: { to: [76, 81.5], hint: [0.3, -1] }, arm: { a: [4, lerp(-136, 2, t)] } }),
    gear: (J) => ({ back: [P([57, 67], 28, 6), F([[46, 84], [46, 70]], [[68, 84], [68, 70]])], front: DB(J.hand, angleOf(sub(J.hand, J.elbow))) }),
  },
  triceps_lying: {
    pose: (t) => lying({ arm: { a: [-8, lerp(-112, -6, t)] } }),
    gear: (J) => ({ back: [...flatBench(), plate(J.hand, 6)], front: [barEnd(J.hand)] }),
  },

  // ---------------------------------------------------------------- shoulders and chest, from the front
  raise_db: {
    view: 'front',
    pose: (t) => { const a = lerp(170, 94, t); return { sh: [60, 21], arm: { a: [a, a + 4] } }; },
    gear: (J) => ({ back: [], front: [D(J.handR, 3.6), D(J.handL, 3.6)] }),
  },
  raise_cable: {
    view: 'front',
    pose: (t) => { const a = lerp(168, 94, t); return { sh: [62, 21], arm: { a: [a, a + 4] }, armL: { to: [44, 46], hint: [-1, 0.4] } }; },
    gear: (J, t) => ({ back: [F([[22, 84], [22, 12]], [[12, 84], [34, 84]]), W([24, 79], 3), { k: 'poly', c: 'sk-w', l: [rect([12, 50], 10, 34)] }, MP([12, 36 - 6 * t], 10, 5)], front: [C([J.handR, [24, 79]]), D(J.handR, 2.8)] }),
  },
  reverse_fly_db: {
    view: 'front',
    // Bent over, seen from the front: the head leads, the back runs away from the viewer and so looks short.
    pose: (t) => { const a = lerp(176, 98, t); return { sh: [60, 47], pel: [60, 51], head: [60, 40.5], legs: { knee: [3, 16], foot: [4.4, 32] }, arm: { a: [a, a + 5] } }; },
    gear: (J) => ({ back: [], front: [D(J.handR, 3.6), D(J.handL, 3.6)] }),
  },
  pec_deck: {
    view: 'front',
    pose: (t) => ({ sh: [60, 40], pel: [60, 63], legs: 'seat', arm: { to: mix([92, 41], [63.5, 43], t), straight: true } }),
    gear: (J) => ({ back: [P([60, 69], 24, 5), F([[60, 84], [60, 72]], [[44, 12], [76, 12]], [[60, 12], [60, 6]])], front: [M([[76, 12], J.handR]), M([[44, 12], J.handL]), MP(J.handR, 4, 12), MP(J.handL, 4, 12)] }),
  },
  pec_deck_reverse: {
    view: 'front',
    pose: (t) => ({ sh: [60, 40], pel: [60, 63], legs: 'seat', arm: { to: mix([63.5, 42], [92, 41], t), straight: true } }),
    gear: (J) => ({ back: [P([60, 69], 24, 5), P([60, 52], 12, 16), F([[60, 84], [60, 72]], [[44, 12], [76, 12]], [[60, 12], [60, 6]])], front: [M([[76, 12], J.handR]), M([[44, 12], J.handL]), D(J.handR, 3), D(J.handL, 3)] }),
  },
  cable_fly: {
    view: 'front',
    pose: (t) => ({ sh: [60, 22], arm: { to: mix([92, 27], [63.5, 47], t), straight: true } }),
    gear: (J) => ({ back: [F([[14, 84], [14, 10]], [[106, 84], [106, 10]], [[6, 84], [22, 84]], [[98, 84], [114, 84]]), W([16, 13], 3), W([104, 13], 3)], front: [C([J.handR, [104, 13]]), C([J.handL, [16, 13]]), D(J.handR, 2.8), D(J.handL, 2.8)] }),
  },
  fly_db: {
    view: 'front',
    pose: (t) => { const a = lerp(98, 6, t); return { sh: [60, 62], head: [60, 57], legs: 'none', bare: true, arm: { a: [a, a - 12] } }; },
    gear: (J) => ({ back: [P([60, 69], 22, 6), F([[52, 84], [52, 72]], [[68, 84], [68, 72]])], front: [D(J.handR, 3.6), D(J.handL, 3.6)] }),
  },
  face_pull: {
    pose: (t) => standing({ lean: lerp(2, -6, t), arm: { to: mix([76.5, 24.5], [62, 19], t), hint: [-0.4, -1] } }, 50),
    gear: (J, t) => ({ back: [F([[92, 84], [92, 10]], [[80, 84], [110, 84]]), ...stack(102, t, 7), W([90, 22], 3)], front: [C([J.hand, [90, 22]]), M([add(J.hand, [0, -3]), add(J.hand, [0, 3])])] }),
  },

  // ---------------------------------------------------------------- core
  crunch: {
    pose: (t) => ({ hip: [58, 80.5], lean: lerp(-90, -58, t), nod: lerp(0, 14, t), leg: { to: [86, 83], hint: [0.3, -1] }, arm: { rel: [-5, 4], hint: [0, -1] } }),
    gear: () => ({ back: [], front: [] }),
  },
  crunch_machine: {
    pose: (t) => seated({ lean: lerp(-8, 30, t), nod: lerp(0, 10, t), arm: { rel: [0, 7], hint: [0.3, 1] } }, -8),
    gear: (J, t) => ({
      back: [...seatGear(-8), ...stack(22, t, 8), R([82, 77], 3.2)],
      front: [C([[40, 10], add(J.sh, [4.5, 1.5])]), MP(add(J.sh, [4.6, 3]), 5, 12, angleOf(J.t))],
    }),
  },
  crunch_cable: {
    pose: (t) => {
      const hip = add([56, 82], mul(dir(lerp(-8, -22, t)), B.thigh));
      return { hip, lean: lerp(18, 84, t), nod: lerp(0, 20, t), leg: { to: [36.5, 82], hint: [1, 1], foot: 262 }, arm: { rel: [-6, 4], hint: [1, 0.4] } };
    },
    gear: (J, t) => ({ back: [F([[96, 84], [96, 8], [84, 8]], [[84, 84], [112, 84]]), ...stack(106, t, 7), W([84, 11], 3)], front: [C([J.hand, [84, 11]]), M([add(J.hand, [-1, -2.5]), add(J.hand, [1, 2.5])])] }),
  },
  knee_raise: {
    fit: [0.74, 0, -14],
    pose: (t) => ({ hip: [58, 60], lean: lerp(0, -8, t), leg: { a: [lerp(178, 96, t), lerp(180, 172, t)] }, arm: { to: [60.5, 10], hint: [-1, 0] } }),
    gear: () => ({ back: [F([[82, 102.9], [82, 10], [68, 10]], [[70, 102.9], [96, 102.9]])], front: [D([60.5, 10], 2.8)] }),
  },
};

// ---------------------------------------------------------------- which move for which exercise

const BY_ID = {
  bb_bench_press: 'bench_bar', db_bench_press: 'bench_db', chest_press_machine: 'chest_press', incline_db_press: 'bench_incline',
  smith_bench_press: 'bench_smith', dips: 'dips', push_up: 'pushup',
  bb_overhead_press: 'ohp', db_shoulder_press: 'db_press', shoulder_press_machine: 'shoulder_machine',
  bb_row: 'row_bar', db_row: 'row_db', seated_cable_row: 'row_seated', chest_supported_row: 'row_chest',
  pull_up: 'pullup', lat_pulldown: 'pulldown', chin_up: 'chinup',
  bb_back_squat: 'squat_bar', leg_press: 'leg_press', goblet_squat: 'squat_goblet', hack_squat: 'hack_squat', smith_squat: 'squat_smith',
  bb_deadlift: 'deadlift', bb_rdl: 'rdl_bar', db_rdl: 'rdl_db', back_extension: 'back_extension',
  hip_thrust: 'hip_thrust', db_glute_bridge: 'glute_bridge',
  db_split_squat: 'split_squat', db_reverse_lunge: 'lunge_back', db_step_up: 'step_up',
  leg_extension: 'leg_extension', db_leg_extension: 'leg_extension_db', leg_curl: 'leg_curl', db_leg_curl: 'leg_curl_db',
  cable_leg_curl: 'leg_curl_cable', nordic_curl: 'nordic',
  calf_raise_machine: 'calf_machine', db_calf_raise: 'calf_db',
  db_curl: 'curl_db', bb_curl: 'curl_bar', cable_curl: 'curl_cable', hammer_curl: 'curl_hammer',
  cable_pushdown: 'pushdown', db_overhead_triceps: 'triceps_overhead', lying_triceps_ext: 'triceps_lying', close_grip_push_up: 'pushup',
  db_lateral_raise: 'raise_db', cable_lateral_raise: 'raise_cable',
  face_pull: 'face_pull', db_reverse_fly: 'reverse_fly_db', reverse_pec_deck: 'pec_deck_reverse',
  pec_deck_fly: 'pec_deck', cable_fly: 'cable_fly', db_fly: 'fly_db',
  ab_machine_crunch: 'crunch_machine', hanging_knee_raise: 'knee_raise', cable_crunch: 'crunch_cable', crunch: 'crunch',
};

// A machine of the gym's own is known by the movement it trains, and sometimes its name says more.
const BY_PATTERN = {
  push_h: 'chest_press', push_v: 'shoulder_machine', pull_h: 'row_seated', pull_v: 'pulldown', squat: 'leg_press', hinge: 'back_extension',
  lunge: 'split_squat', glute: 'hip_thrust', knee_ext: 'leg_extension', knee_flex: 'leg_curl', calf: 'calf_machine', biceps: 'curl_machine',
  triceps: 'pushdown', delt_side: 'raise_db', delt_rear: 'pec_deck_reverse', chest_fly: 'pec_deck', core: 'crunch_machine',
};
const BY_NAME = [
  [/hack/, 'hack_squat'], [/smith/, 'squat_smith'], [/abduct|adduct/, 'abduction'], [/kick/, 'kickback'],
  [/seated (leg|ham)|(leg|ham)\w* curl.*seated/, 'leg_curl_seated'], [/dip/, 'dips'], [/pull.?up|chin/, 'pullup'],
];

/**
 * The move to show for an exercise, as a key of MOVES. Every catalog exercise
 * has one; a machine of the gym's own gets the one for the movement it trains.
 * @param {{id: string, name?: string, pattern?: string}} exercise
 */
export function moveFor(exercise) {
  if (!exercise) return null;
  if (BY_ID[exercise.id]) return BY_ID[exercise.id];
  const name = String(exercise.name || '').toLowerCase();
  const named = BY_NAME.find(([re]) => re.test(name));
  return named ? named[1] : BY_PATTERN[exercise.pattern] || null;
}

// ---------------------------------------------------------------- frames

const STEPS = 8;
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const r1 = (v) => Math.round(v * 10) / 10;

/** Every part of the picture at one moment of the rep, back to front. `plates`: the machine is loaded with plates. */
export function frameAt(id, t, { plates = false } = {}) {
  const mv = MOVES[id];
  if (!mv) return null;
  const J = (mv.view === 'front' ? frontRig : sideRig)(mv.pose(t));
  platesNow = plates;
  const g = mv.gear(J, t);
  platesNow = false;
  const items = [
    ...g.back.map((x) => ({ ...x, layer: 'gear' })),
    ...J.draw.far.map((x) => ({ ...x, layer: 'body' })),
    ...J.draw.near.map((x) => ({ ...x, layer: 'body' })),
    ...g.front.map((x) => ({ ...x, layer: 'gear' })),
    ...J.draw.arm.map((x) => ({ ...x, layer: 'body' })),
  ];
  const [s, dx, dy] = mv.fit || [1, 0, 0];
  const at = ([x, y]) => { const px = 60 + (x - 60) * s + dx; return [mv.flip ? 120 - px : px, FLOOR + (y - FLOOR) * s + dy]; };
  return items.map((it) => (it.k === 'circle' ? { ...it, p: at(it.p), r: it.r * s } : { ...it, l: it.l.map((line) => line.map(at)) }));
}

const pathOf = (it) => it.l.map((line) => line.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join('')).join('') + (it.k === 'poly' ? 'Z' : '');

const cache = new Map();

/**
 * A move ready to draw: its parts, each with its shape at every step of the
 * way from the start of a rep to the end. A part that never moves has one shape.
 * @returns {{view: string, parts: {k: string, c: string, layer: string, r?: number, d?: string[], at?: number[][]}[], steps: number} | null}
 */
export function motion(id, { plates = false } = {}) {
  if (!MOVES[id]) return null;
  const key = `${id}${plates ? '+plates' : ''}`;
  if (cache.has(key)) return cache.get(key);
  const frames = [];
  for (let i = 0; i <= STEPS; i++) frames.push(frameAt(id, ease(i / STEPS), { plates }));
  const parts = frames[0].map((it, n) => {
    if (it.k === 'circle') {
      const at = frames.map((f) => [r1(f[n].p[0]), r1(f[n].p[1])]);
      const still = at.every((p) => p[0] === at[0][0] && p[1] === at[0][1]);
      return { k: 'circle', c: it.c, layer: it.layer, r: r1(it.r), at: still ? [at[0]] : at };
    }
    const d = frames.map((f) => pathOf(f[n]));
    return { k: it.k, c: it.c, layer: it.layer, d: d.every((x) => x === d[0]) ? [d[0]] : d };
  });
  const out = { view: MOVES[id].view || 'side', parts, steps: STEPS };
  cache.set(key, out);
  return out;
}
