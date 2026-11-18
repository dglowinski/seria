// The exercises in 3D: the moves worked out in depth (domain/moves3d.js), the
// figure at rest (domain/figure.js) and the bones that a pose bends
// (domain/skeleton.js, assets/figure.bin). No picture is drawn here; the
// browser checks do that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { MOVES, moveFor, motion } from '../js/domain/moves.js';
import { scene3, reach3, rig3, poster, MOVE_IDS, sub, len, dot, cross, unit } from '../js/domain/moves3d.js';
import { FIGURE } from '../js/domain/figure.js';
import { readFigure, skeleton } from '../js/domain/skeleton.js';
import { EXERCISES } from '../js/domain/catalog.js';

const MOMENTS = [0, 0.25, 0.5, 0.75, 1];
const dist = (a, b) => len(sub(a, b));
const R = FIGURE.joints;
const each = (fn) => { for (const id of MOVE_IDS) for (const t of MOMENTS) fn(id, t, scene3(id, t)); };
const fileBuf = () => { const b = readFileSync(new URL('../assets/figure.bin', import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('3D: every move, and so every catalog exercise, has a figure and equipment in depth at every moment', () => {
  assert.equal(MOVE_IDS.length, Object.keys(MOVES).length);
  for (const ex of EXERCISES) assert.ok(scene3(moveFor(ex), 0.5), `${ex.id} has no move in 3D`);
  each((id, t, s) => {
    assert.ok(s, `${id} at ${t}`);
    for (const [name, p] of Object.entries(s.fig.J)) assert.ok(p.every(Number.isFinite), `${id} at ${t}: ${name} is not a place`);
    for (const [name, q] of Object.entries(s.fig.q)) assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-6, `${id} at ${t}: the turn of ${name} is not a turn`);
    for (const p of s.prims) {
      const nums = p.k === 'cyl' ? [...p.a, ...p.b, p.r] : p.k === 'ball' ? [...p.c, p.r] : [...p.c, ...p.s, p.rz];
      assert.ok(nums.every(Number.isFinite), `${id} at ${t}: a piece of equipment has no place`);
    }
    assert.ok(Number.isFinite(s.yaw) && Number.isFinite(s.cam.az));
  });
  assert.equal(scene3('no_such_move', 0), null);
});

test('3D: bones never stretch: upper arms, forearms, thighs and shins keep the length the figure has at rest', () => {
  each((id, t, s) => {
    const { J } = s.fig;
    for (const sd of ['R', 'L']) {
      const pairs = [['sh', 'elbow'], ['elbow', 'wrist'], ['wrist', 'grip'], ['hip', 'knee'], ['knee', 'ankle']];
      for (const [a, b] of pairs) {
        const now = dist(J[`${a}${sd}`], J[`${b}${sd}`]); const rest = dist(R[`${a}${sd}`], R[`${b}${sd}`]);
        assert.ok(Math.abs(now - rest) < 0.02, `${id} at ${t}: ${a}-${b} ${sd} is ${now.toFixed(2)}, at rest ${rest.toFixed(2)}`);
      }
    }
    assert.ok(Math.abs(dist(J.shR, J.shL) - dist(R.shR, R.shL)) < 0.02 && Math.abs(dist(J.hipR, J.hipL) - dist(R.hipR, R.hipL)) < 0.02, `${id}: shoulders or hips changed width`);
  });
});

test('3D: nothing of the figure goes through the floor, and a foot that stands on it lies flat', () => {
  each((id, t, s) => {
    const { J, feet } = s.fig;
    for (const [name, p] of Object.entries(J)) assert.ok(p[1] > -0.6, `${id} at ${t}: ${name} is ${p[1].toFixed(1)} under the floor`);
    assert.ok(J.headC[1] - FIGURE.headR > -1.5, `${id} at ${t}: the head is in the floor`);
    for (const sd of ['R', 'L']) if (feet[sd].up[1] > 0.999) assert.ok(Math.abs(J[`toe${sd}`][1] - R[`toe${sd}`][1]) < 0.05 || J[`ankle${sd}`][1] > R[`ankle${sd}`][1] + 0.5, `${id} at ${t}: a flat foot's toes are off the ground it stands on`);
  });
  // Standing moves: both feet on the floor through the whole rep.
  for (const id of ['squat_bar', 'squat_goblet', 'deadlift', 'rdl_bar', 'ohp', 'row_bar', 'curl_db', 'curl_bar', 'pushdown', 'raise_db', 'face_pull', 'cable_fly']) {
    for (const t of MOMENTS) { const { J } = scene3(id, t).fig; for (const sd of ['R', 'L']) assert.ok(Math.abs(J[`ankle${sd}`][1] - R[`ankle${sd}`][1]) < 0.05, `${id} at ${t}: the ${sd} foot left the floor`); }
  }
});

test('3D: both hands stay on the bar, the bar is level, and a mirrored move is mirrored', () => {
  const steel = (s) => s.prims.find((p) => p.k === 'cyl' && p.m === 'steel' && Math.abs(p.a[2] - p.b[2]) > 30);
  for (const id of ['squat_bar', 'squat_smith', 'deadlift', 'rdl_bar', 'hip_thrust', 'bench_bar', 'bench_smith', 'ohp', 'row_bar', 'curl_bar', 'triceps_lying']) {
    for (const t of MOMENTS) {
      const s = scene3(id, t); const bar = steel(s);
      assert.ok(bar, `${id}: no bar`);
      assert.ok(Math.abs(bar.a[1] - bar.b[1]) < 1e-6 && Math.abs(bar.a[0] - bar.b[0]) < 1e-6, `${id}: the bar is not level`);
      const axis = unit(sub(bar.b, bar.a));
      for (const sd of ['R', 'L']) {
        const off = len(cross(sub(s.fig.J[`grip${sd}`], bar.a), axis));
        assert.ok(off < 0.6, `${id} at ${t}: the ${sd} hand is ${off.toFixed(2)} off the bar`);
        // The line across the palm lies along the bar: the hand is turned to hold it.
        assert.ok(Math.abs(dot(s.fig.hands[sd].axis, axis)) > 0.9, `${id} at ${t}: the ${sd} hand is not turned to the bar`);
      }
    }
  }
  // Hanging from a bar, and pulling one down.
  for (const id of ['pullup', 'chinup', 'pulldown', 'knee_raise']) {
    for (const t of MOMENTS) { const s = scene3(id, t); const bar = s.prims.find((p) => p.k === 'cyl' && p.m === 'move' && Math.abs(p.a[2] - p.b[2]) > 30); assert.ok(bar, `${id}: no bar`); for (const sd of ['R', 'L']) assert.ok(len(cross(sub(s.fig.J[`grip${sd}`], bar.a), unit(sub(bar.b, bar.a)))) < 0.6, `${id} at ${t}: a hand is off the bar`); }
  }
  const lopsided = new Set(['split_squat', 'lunge_back', 'step_up', 'leg_curl_cable', 'kickback', 'row_db', 'raise_cable', 'cable_fly']);
  each((id, t, s) => {
    if (lopsided.has(id)) return;
    const { J } = s.fig;
    for (const k of ['sh', 'elbow', 'grip', 'hip', 'knee', 'ankle']) { const a = J[`${k}R`]; const b = J[`${k}L`]; assert.ok(Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05 && Math.abs(a[2] + b[2]) < 0.05, `${id} at ${t}: ${k} is not mirrored`); }
  });
});

test('3D: grips are the right way round, and the hands of a push-up lie flat', () => {
  // Under the bar for a curl or a chin-up, over it for a pull-up, a push-down and a press.
  for (const [id, sign] of [['curl_bar', 1], ['curl_db', 1], ['chinup', 1], ['curl_cable', 1], ['pullup', -1], ['pushdown', -1], ['bench_bar', -1], ['deadlift', -1]]) {
    for (const t of [0.3, 0.7]) for (const sd of ['R', 'L']) { const turned = scene3(id, t).fig.hands[sd].turned; assert.ok(sign > 0 ? turned > 20 : turned < 20, `${id} at ${t}: the ${sd} hand is turned ${turned.toFixed(0)}`); }
  }
  for (const t of MOMENTS) {
    const { hands, J } = scene3('pushup', t).fig;
    for (const sd of ['R', 'L']) { assert.ok(hands[sd].palm[1] < -0.9, `push-up at ${t}: the palm does not face the floor`); assert.ok(J[`grip${sd}`][1] < 2 && hands[sd].shut === 0); }
  }
  assert.ok(scene3('crunch', 1).fig.hands.R.shut < 1 && scene3('bench_bar', 0).fig.hands.R.shut === 1);
});

test('3D: the figure file opens, holds every bone a pose turns, and stays small', () => {
  const size = statSync(new URL('../assets/figure.bin', import.meta.url)).size;
  assert.ok(size > 100_000 && size < 500_000, `figure.bin is ${size} bytes`);
  const { head, base } = readFigure(fileBuf());
  assert.equal(head.name, FIGURE.name);
  assert.ok(head.verts > 2000 && head.verts < 65536 && head.pictures.length === 2 && head.groups.length === 2);
  assert.equal(head.position.length, head.verts * 12); assert.equal(head.normal.length, head.verts * 3); assert.equal(head.skinIndex.length, head.verts * 4); assert.equal(head.skinWeight.length, head.verts * 4);
  assert.equal(head.groups[0].count + head.groups[1].count, head.index.length / 2);
  const names = new Set(head.bones.map((b) => b.name));
  for (const [part, name] of Object.entries(FIGURE.bones)) assert.ok(names.has(name), `the figure has no bone for ${part}`);
  assert.ok(head.bones.every((b) => b.parent < head.bones.length && b.pos.length === 3 && Math.abs(Math.hypot(...b.quat) - 1) < 1e-4));
  // Every point is held by bones that exist, with weights that add up.
  const idx = new Uint8Array(fileBuf(), base + head.skinIndex.offset, head.skinIndex.length); const w = new Uint8Array(fileBuf(), base + head.skinWeight.offset, head.skinWeight.length);
  for (let i = 0; i < head.verts; i++) { assert.ok(idx[i * 4] < head.bones.length); assert.equal(w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3], 255); }
  assert.throws(() => readFigure(new ArrayBuffer(16)), /not a figure file/);
});

test('3D: the bones of the figure end up where the move says the joints are', () => {
  const { head } = readFigure(fileBuf());
  const sk = skeleton(head.bones);
  // At rest the bones are where the file has them.
  const still = rig3({ hip: [60, 44], lean: Math.atan2(R.shR[0], R.shR[1] - 40) * 180 / Math.PI }, {});
  assert.ok(still.J.hipC[1] === 40);
  const joints = { Forearm: 'elbow', Hand: 'wrist', Calf: 'knee', Foot: 'ankle', UpperArm: 'sh', Thigh: 'hip' };
  for (const id of MOVE_IDS) for (const t of [0, 0.5, 1]) {
    const { fig } = scene3(id, t);
    const posed = sk.pose(fig); const where = sk.places(posed);
    for (const sd of ['R', 'L']) for (const [bone, joint] of Object.entries(joints)) {
      const off = dist(where[sk.at(`Bip01_${sd}_${bone}`)], fig.J[`${joint}${sd}`]);
      assert.ok(off < 0.05, `${id} at ${t}: the ${sd} ${bone} bone is ${off.toFixed(2)} from the ${joint}`);
    }
    assert.ok(dist(where[sk.at('Bip01_Head')], fig.J.head) < 0.05 && dist(where[sk.at('Bip01_Neck')], fig.J.neck) < 0.05, `${id} at ${t}: the head is not where the move has it`);
    for (const q of posed.local) assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-6);
  }
});

test('3D: a camera can find every move, and each has a still picture that is part of the rep', () => {
  for (const id of MOVE_IDS) {
    const reach = reach3(id);
    assert.ok(reach && reach.r > 20 && reach.r < 140 && reach.lo[1] >= 0 && reach.hi[1] > 15, `${id}: reach ${reach && reach.r}`);
    assert.ok(poster(id) >= 0 && poster(id) <= 1);
    // The flat drawing of the same move is still there to fall back on.
    assert.ok(motion(id).parts.length > 0);
  }
  assert.ok(reach3('bench_bar').hi[2] - reach3('bench_bar').lo[2] > 60, 'a barbell is wide');
  // A machine loaded with plates is drawn with plates in 3D too.
  const round = (s) => s.prims.filter((p) => p.k === 'cyl' && p.m === 'weight' && p.r >= 9).length;
  assert.ok(round(scene3('leg_extension', 0, { plates: true })) > round(scene3('leg_extension', 0)));
});
