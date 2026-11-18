// The stage for exercises in 3D: one figure, the equipment of the move, a floor
// and lights. domain/moves3d.js says where every joint and every piece is;
// this file only builds the meshes and takes the picture.
//
// There is one stage for the whole app, however many drawings are on screen.
// Each drawing is a plain canvas that asks the stage for a picture of its move
// at a moment of the rep. That keeps the phone to one 3D surface, which is all
// some of them allow.
//
// three.js is loaded when the first picture is asked for, not when the app
// starts. If it cannot load, or the device has no 3D, the stage says so and
// the flat drawing stays (ui/motion.js).

import { scene3, reach3, sub, unit, len } from '../domain/moves3d.js';
import { FIGURE } from '../domain/figure.js';
import { loadFigure } from './figure3d.js';

let T = null; // three.js, once loaded
let st = null; // the stage, once built
let opening = null;
let failed = false;

const LOOK = {
  frame: { color: 0x7c877a, rough: 0.55, metal: 0.5 },
  steel: { color: 0xc4cbc0, rough: 0.35, metal: 0.8 },
  move: { color: 0xd0fa77, rough: 0.5, metal: 0.1 },
  pad: { color: 0x39433a, rough: 0.9, metal: 0 },
  weight: { color: 0x2b312b, rough: 0.6, metal: 0.4 },
  cable: { color: 0x98a394, rough: 0.6, metal: 0.3 },
  body: { color: 0xd9dfd2, rough: 0.75, metal: 0 },
};

/** The stage if it is already open, else null. */
export const stageNow = () => st;

/**
 * The stage, loading it if this is the first call. Resolves to null when 3D cannot be had:
 * no 3D on the device, or the library or the figure did not load.
 * `standIn` (for looking at poses while working on them) shows a figure of rods instead of the modelled one.
 */
export function openStage({ standIn = false } = {}) {
  if (st) return Promise.resolve(st);
  if (failed) return Promise.resolve(null);
  if (!opening) {
    opening = import('../../vendor/three-kit.js').then(async (three) => {
      T = three;
      const made = build();
      if (!standIn) made.setModel(await loadFigure(T));
      st = made;
      return st;
    }).catch((e) => { failed = true; console.warn('3D is off:', e && e.message); return null; });
  }
  return opening;
}

function build() {
  const canvas = document.createElement('canvas');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(26, 1, 5, 2000);
  scene.add(new T.HemisphereLight(0xf4f8ee, 0x3a4438, 1.5));
  const sun = new T.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.4;
  scene.add(sun); scene.add(sun.target);

  // The floor: a faint patch of light to stand on that fades out toward its rim, and the shadow that falls on it.
  const glow = document.createElement('canvas'); glow.width = 128; glow.height = 128;
  const gc = glow.getContext('2d'); const fade = gc.createRadialGradient(64, 64, 0, 64, 64, 64);
  fade.addColorStop(0, 'rgba(52, 62, 51, 1)'); fade.addColorStop(0.55, 'rgba(44, 53, 44, 0.85)'); fade.addColorStop(1, 'rgba(34, 41, 34, 0)');
  gc.fillStyle = fade; gc.fillRect(0, 0, 128, 128);
  const glowMap = new T.CanvasTexture(glow); glowMap.colorSpace = T.SRGBColorSpace;
  const floor = new T.Mesh(new T.CircleGeometry(1, 48), new T.MeshBasicMaterial({ map: glowMap, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.05;
  scene.add(floor);
  const shade = new T.Mesh(new T.CircleGeometry(1, 48), new T.ShadowMaterial({ opacity: 0.45 }));
  shade.rotation.x = -Math.PI / 2; shade.receiveShadow = true;
  scene.add(shade);

  const world = new T.Group(); // the figure and the equipment, turned together to face the way the move asks
  scene.add(world);

  const mats = {};
  const mat = (m) => {
    if (!mats[m]) { const l = LOOK[m] || LOOK.frame; mats[m] = new T.MeshStandardMaterial({ color: l.color, roughness: l.rough, metalness: l.metal }); }
    return mats[m];
  };
  const shapes = { cyl: new T.CylinderGeometry(1, 1, 1, 20), ball: new T.SphereGeometry(1, 20, 14), box: new T.BoxGeometry(1, 1, 1) };
  const UP = new T.Vector3(0, 1, 0);
  const v = new T.Vector3();

  // A set of plain shapes that can be re-set every frame: the equipment, and the stand-in figure.
  const makeSet = () => {
    const group = new T.Group(); const pool = [];
    world.add(group);
    return {
      group,
      put(prims) {
        prims.forEach((p, i) => {
          let m = pool[i];
          if (!m || m.userData.k !== p.k) {
            if (m) group.remove(m);
            m = new T.Mesh(shapes[p.k], mat(p.m));
            m.userData.k = p.k; m.castShadow = true; m.receiveShadow = true;
            group.add(m); pool[i] = m;
          }
          m.visible = true;
          m.material = mat(p.m);
          if (p.k === 'cyl') {
            const d = sub(p.b, p.a); const l = len(d) || 0.001;
            m.position.set((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2);
            m.scale.set(p.r, l, p.r);
            const u = unit(d, [0, 1, 0]);
            m.quaternion.setFromUnitVectors(UP, v.set(u[0], u[1], u[2]));
          } else if (p.k === 'ball') {
            m.position.set(p.c[0], p.c[1], p.c[2]); m.scale.setScalar(p.r); m.quaternion.identity();
          } else {
            m.position.set(p.c[0], p.c[1], p.c[2]); m.scale.set(p.s[0], p.s[1], p.s[2]);
            m.rotation.set(0, 0, (p.rz * Math.PI) / 180);
          }
        });
        for (let i = prims.length; i < pool.length; i++) pool[i].visible = false;
      },
    };
  };
  const gear = makeSet();
  const body = makeSet();
  let model = null; // the modelled figure, when one has been loaded (setModel)

  const reaches = new Map();
  const reachOf = (id, plates) => {
    const key = `${id}${plates ? '+' : ''}`;
    if (!reaches.has(key)) reaches.set(key, reach3(id, { plates }));
    return reaches.get(key);
  };

  /**
   * Takes the picture of a move at the moment `t` and puts it on `target`, a plain canvas.
   * `turn` is how far the viewer has swung the camera around, in degrees.
   */
  function draw(target, id, t, { plates = false, turn = 0 } = {}) {
    const s = scene3(id, t, { plates });
    const reach = s && reachOf(id, plates);
    if (!s || !reach) return false;
    const w = target.width; const h = target.height;
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);

    world.rotation.y = (s.yaw * Math.PI) / 180;
    gear.put(s.prims);
    if (model) { model.pose(s.fig); body.put([]); } else body.put(standIn(s.fig));

    // The camera looks at the middle of everything the move reaches, from just far enough to hold it all.
    const ya = (s.yaw * Math.PI) / 180;
    const turned = (p) => [p[0] * Math.cos(ya) + p[2] * Math.sin(ya), p[1], -p[0] * Math.sin(ya) + p[2] * Math.cos(ya)];
    const c = turned(reach.c);
    camera.aspect = w / h;
    const az = ((s.cam.az + turn) * Math.PI) / 180; const el = (s.cam.el * Math.PI) / 180;
    const back = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]; // from the middle toward the camera
    const right = [Math.cos(az), 0, -Math.sin(az)];
    const up = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
    const tanV = Math.tan((camera.fov * Math.PI) / 360); const tanH = tanV * camera.aspect;
    let d = 1;
    for (let i = 0; i < 8; i++) {
      const p = turned([i & 1 ? reach.hi[0] : reach.lo[0], i & 2 ? reach.hi[1] : reach.lo[1], i & 4 ? reach.hi[2] : reach.lo[2]]);
      const o = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const x = o[0] * right[0] + o[2] * right[2]; const y = o[0] * up[0] + o[1] * up[1] + o[2] * up[2]; const z = o[0] * back[0] + o[1] * back[1] + o[2] * back[2];
      d = Math.max(d, Math.abs(x) / tanH + z, Math.abs(y) / tanV + z);
    }
    d *= 1.06;
    camera.position.set(c[0] + d * back[0], c[1] + d * back[1], c[2] + d * back[2]);
    camera.near = Math.max(d - reach.r * 2.5, 1); camera.far = d + reach.r * 4;
    camera.lookAt(c[0], c[1], c[2]);
    camera.updateProjectionMatrix();

    // The light comes from above the camera's left shoulder, so the side we look at is lit.
    const la = az - 0.75;
    sun.position.set(c[0] + reach.r * 2 * Math.sin(la), reach.r * 3.2, c[2] + reach.r * 2 * Math.cos(la));
    sun.target.position.set(c[0], reach.r * 0.4, c[2]);
    const sc = sun.shadow.camera; const R = reach.r * 1.5;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = reach.r * 8; sc.updateProjectionMatrix();
    floor.position.set(c[0], -0.05, c[2]); floor.scale.setScalar(reach.r * 1.05);
    shade.position.set(c[0], 0, c[2]); shade.scale.setScalar(reach.r * 1.6);

    renderer.render(scene, camera);
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0);
    return true;
  }

  /** Swaps the stand-in figure for a modelled one: `m.object` goes on the stage, `m.pose(fig)` bends it. */
  function setModel(m) { if (model) world.remove(model.object); model = m; if (m) world.add(m.object); }

  return { draw, setModel, T, world, renderer };
}

// A figure of rods and balls on the joints, for when no modelled figure is there.
function standIn(fig) {
  const { J } = fig; const out = [];
  const rod = (a, b, r) => { out.push({ k: 'cyl', a, b, r, m: 'body' }, { k: 'ball', c: a, r, m: 'body' }, { k: 'ball', c: b, r, m: 'body' }); };
  rod(J.hipC, J.s1, 4.6); rod(J.s1, J.shC, 5.0); rod(J.shR, J.shL, 2.6); rod(J.hipR, J.hipL, 3.4);
  rod(J.neck, J.head, 1.9);
  out.push({ k: 'ball', c: J.headC, r: FIGURE.headR, m: 'body' });
  for (const s of ['R', 'L']) {
    rod(J[`sh${s}`], J[`elbow${s}`], 2.0); rod(J[`elbow${s}`], J[`wrist${s}`], 1.6); rod(J[`wrist${s}`], J[`grip${s}`], 1.5);
    rod(J[`hip${s}`], J[`knee${s}`], 3.1); rod(J[`knee${s}`], J[`ankle${s}`], 2.3); rod(J[`ankle${s}`], J[`toe${s}`], 1.6); rod(J[`toe${s}`], J[`tip${s}`], 1.3);
  }
  return out;
}
