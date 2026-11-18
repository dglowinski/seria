// Builds the 3D figure the app shows doing the exercises.
//
// The figure is "Sports_Male_04" from the Microsoft Rocketbox avatar library
// (https://github.com/microsoft/Microsoft-Rocketbox, MIT license, see
// assets/FIGURE-LICENSE.txt). This script takes the library's model file and
// colour pictures, and writes:
//
//   assets/figure.bin       the body: its skin, its bones and two pictures, about 1 MB
//   js/domain/figure.js     where its joints are at rest, which the moves are worked out against
//
// Run: npm run figure            (downloads the source files once, about 25 MB, into node_modules/.cache)
//      npm run figure -- --src=some/dir   (uses files already on disk)
//
// The work is done in a headless Chrome, where three.js can read the model.
// Out of the library's model come: the skin with every point tied to its
// bones, turned to face +x and sized so the hip joint stands 40 units high,
// like the drawings; the face bones folded into the head, which the app never
// moves; and the two pictures shrunk and stored as WebP.

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9';
const BASE = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/Assets/Avatars/Professions/Sports_Male_04`;
const FILES = { 'Sports_Male_04.fbx': 'Export/Sports_Male_04.fbx', 'm026_body_color.tga': 'Textures/m026_body_color.tga', 'm026_head_color.tga': 'Textures/m026_head_color.tga' };

const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; };
const src = arg('src') || `${root}node_modules/.cache/seria-figure/${COMMIT.slice(0, 12)}`;
mkdirSync(src, { recursive: true });
for (const [name, path] of Object.entries(FILES)) {
  if (existsSync(`${src}/${name}`)) continue;
  console.log(`fetching ${name}`);
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  writeFileSync(`${src}/${name}`, Buffer.from(await res.arrayBuffer()));
}

const port = 4597;
const server = await startServer(port);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
let made;
try {
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (!/404|Failed to load resource/.test(t)) console.log(' ', t.slice(0, 300)); });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.route(`http://127.0.0.1:${port}/__src/**`, (r) => {
    const f = decodeURIComponent(new URL(r.request().url()).pathname.replace('/__src/', ''));
    if (existsSync(`${src}/${f}`)) r.fulfill({ body: readFileSync(`${src}/${f}`), contentType: 'application/octet-stream' }); else r.fulfill({ status: 404, body: '' });
  });
  await page.route(`http://127.0.0.1:${port}/__page`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><script type="module">${inPage.toString()}; inPage().then((r) => { window.result = r; }, (e) => { window.result = { error: String(e && e.stack || e) }; });</script>` }));
  await page.goto(`http://127.0.0.1:${port}/__page`);
  await page.waitForFunction('window.result', null, { timeout: 120000 });
  made = await page.evaluate('window.result');
} finally {
  await browser.close();
  server.close();
}
if (made.error) throw new Error(made.error);

// ---------------------------------------------------------------- the file

const parts = []; let at = 0;
const put = (buf) => { const o = { offset: at, length: buf.length }; parts.push(buf); at += buf.length; const pad = (4 - (at % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); at += pad; } return o; };
const b64 = (s) => Buffer.from(s, 'base64');
const head = {
  name: 'Sports_Male_04', source: 'Microsoft Rocketbox avatar library, MIT license', commit: COMMIT,
  verts: made.verts, bones: made.bones,
  position: put(b64(made.position)), normal: put(b64(made.normal)), uv: put(b64(made.uv)),
  skinIndex: put(b64(made.skinIndex)), skinWeight: put(b64(made.skinWeight)), index: put(b64(made.index)),
  groups: made.groups,
  pictures: made.pictures.map((p) => ({ ...put(b64(p.data)), type: p.type, size: p.size })),
};
const json = Buffer.from(JSON.stringify(head));
const pad = Buffer.alloc((4 - ((8 + json.length) % 4)) % 4, 0x20);
const pre = Buffer.alloc(8); pre.write('SFIG', 0, 'latin1'); pre.writeUInt32LE(json.length + pad.length, 4);
const file = Buffer.concat([pre, json, pad, ...parts]);
mkdirSync(`${root}assets`, { recursive: true });
writeFileSync(`${root}assets/figure.bin`, file);

const n = (v) => Math.round(v * 1000) / 1000;
const vec = (v) => `[${v.map(n).join(', ')}]`;
const J = made.rest.joints;
const pairs = ['hip', 'knee', 'ankle', 'toe', 'tip', 'sh', 'elbow', 'wrist', 'grip'];
writeFileSync(`${root}js/domain/figure.js`, `// The figure at rest: where its joints are when it stands in the pose it was
// modelled in. The moves in three dimensions (moves3d.js) are worked out
// against these measures, so that hands and feet land where the bones of the
// model put them.
//
// Written by scripts/build-figure.mjs from the model in assets/figure.bin
// (${head.name}, ${head.source}). Do not edit by hand.
//
// Units are those of the drawings: one is a little over 2 cm, the hip joint
// stands 40 above the floor. x points forward, y up, z to the figure's right.
// R is the right side, L the left.

export const FIGURE = {
  name: '${head.name}',
  unit: ${made.rest.unit.toFixed(5)}, // metres to one unit
  joints: {
    ${['hipC', 's0', 's1', 's2', 'neck', 'head', 'headC'].map((k) => `${k}: ${vec(J[k])}`).join(', ')},
${['R', 'L'].map((s) => `    ${pairs.map((k) => `${k}${s}: ${vec(J[k + s])}`).join(', ')},`).join('\n')}
  },
  // Which way the palm faces at rest, and the line across it from the first finger to the little one.
  palmR: ${vec(made.rest.palmR)}, palmL: ${vec(made.rest.palmL)},
  acrossR: ${vec(made.rest.acrossR)}, acrossL: ${vec(made.rest.acrossL)},
  headR: ${n(made.rest.headR)},
  top: ${n(made.rest.top)},
  // The bones of the model that each part of the figure turns.
  bones: ${JSON.stringify(made.rest.map)},
};
`);
console.log(`assets/figure.bin  ${Math.round(file.length / 1024)} KB  (${made.verts} points, ${made.tris} triangles, ${made.bones.length} bones, pictures ${made.pictures.map((p) => `${p.size}px ${Math.round(p.data.length * 0.75 / 1024)} KB`).join(' + ')})`);
console.log('js/domain/figure.js written');

// ---------------------------------------------------------------- in the browser

async function inPage() {
  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const { TGALoader } = await import('three/addons/loaders/TGALoader.js');
  const obj = await new FBXLoader().loadAsync('/__src/Sports_Male_04.fbx');
  obj.updateMatrixWorld(true);
  let mesh = null;
  obj.traverse((o) => { if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
  const skel = mesh.skeleton;

  // Model space: centimetres, y up, facing +z, its left at +x. Figure space: units, facing +x, its right at +z, hip joint 40 high.
  const bind = skel.bones.map((b, i) => new THREE.Matrix4().copy(skel.boneInverses[i]).invert());
  const at = (name) => { const i = skel.bones.findIndex((b) => b.name === name); return new THREE.Vector3().setFromMatrixPosition(bind[i]); };
  const hipMid = at('Bip01_L_Thigh').add(at('Bip01_R_Thigh')).multiplyScalar(0.5);
  const scale = 40 / hipMid.y;
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const toFig = (v) => v.clone().sub(new THREE.Vector3(hipMid.x, 0, hipMid.z)).applyQuaternion(turn).multiplyScalar(scale);
  const dirFig = (v) => v.clone().applyQuaternion(turn);

  // Bones: the face is folded into the head. Thighs hang from the pelvis and collar bones from the chest, so that bending the spine or the neck leaves hips and shoulders where they belong.
  const headBone = skel.bones.find((b) => b.name === 'Bip01_Head');
  const isFace = (b) => { for (let p = b.parent; p; p = p.parent) if (p === headBone) return true; return false; };
  const keep = skel.bones.filter((b) => !isFace(b));
  const newIndex = skel.bones.map((b) => keep.indexOf(isFace(b) ? headBone : b));
  const parentOf = { Bip01_L_Thigh: 'Bip01_Pelvis', Bip01_R_Thigh: 'Bip01_Pelvis', Bip01_L_Clavicle: 'Bip01_Spine2', Bip01_R_Clavicle: 'Bip01_Spine2' };
  const bones = keep.map((b) => {
    const m = bind[skel.bones.indexOf(b)];
    const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
    m.decompose(p, q, s);
    const parent = parentOf[b.name] || (b.parent && b.parent.isBone ? b.parent.name : null);
    return { name: b.name, parent: parent ? keep.findIndex((k) => k.name === parent) : -1, pos: toFig(p).toArray(), quat: turn.clone().multiply(q).normalize().toArray(), s: s.toArray() };
  });
  const offScale = Math.max(...bones.map((b) => Math.max(...b.s.map((v) => Math.abs(v - 1)))));
  const drift = Math.max(...skel.bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(bind[i]))));
  console.log('bones kept ' + bones.length + ' of ' + skel.bones.length + ', scale off by ' + offScale.toFixed(4) + ', rest against bind off by ' + drift.toFixed(3) + ' cm');
  for (const b of bones) delete b.s;

  // The skin: every point where it is at rest, with the bones that pull it.
  const g = mesh.geometry; const A = g.attributes;
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.bindMatrix);
  const seen = new Map(); const P = []; const N = []; const U = []; const SI = []; const SW = [];
  const groups = (g.groups.length ? g.groups : [{ start: 0, count: A.position.count, materialIndex: 0 }]);
  const mats = [].concat(mesh.material);
  const byPicture = [[], []]; // 0 body, 1 head
  const v = new THREE.Vector3(); const k4 = new THREE.Vector4(); const w4 = new THREE.Vector4();
  let uvOut = 0;
  for (const grp of groups) {
    const pic = /head/i.test(mats[grp.materialIndex].name) ? 1 : 0;
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const p = toFig(v.fromBufferAttribute(A.position, i).applyMatrix4(mesh.bindMatrix));
      const nrm = dirFig(new THREE.Vector3().fromBufferAttribute(A.normal, i).applyMatrix3(nm).normalize());
      const u = [A.uv.getX(i), 1 - A.uv.getY(i)];
      if (u[0] < 0 || u[0] > 1 || u[1] < 0 || u[1] > 1) uvOut++;
      k4.fromBufferAttribute(A.skinIndex, i); w4.fromBufferAttribute(A.skinWeight, i);
      const inf = new Map();
      for (const c of ['x', 'y', 'z', 'w']) if (w4[c] > 0) { const b = newIndex[k4[c]]; inf.set(b, (inf.get(b) || 0) + w4[c]); }
      const list = [...inf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = list.reduce((s, e) => s + e[1], 0) || 1;
      const w = list.map((e) => Math.round((e[1] / sum) * 255));
      w[0] += 255 - w.reduce((s, x) => s + x, 0);
      while (list.length < 4) { list.push([0, 0]); w.push(0); }
      const key = [p.x, p.y, p.z].map((x) => Math.round(x * 500)).join(',') + '|' + [nrm.x, nrm.y, nrm.z].map((x) => Math.round(x * 60)).join(',') + '|' + u.map((x) => Math.round(x * 4096)).join(',') + '|' + list.map((e) => e[0]).join(',') + '|' + w.join(',') + '|' + pic;
      let id = seen.get(key);
      if (id === undefined) {
        id = P.length / 3; seen.set(key, id);
        P.push(p.x, p.y, p.z); N.push(nrm.x, nrm.y, nrm.z); U.push(u[0], u[1]);
        SI.push(...list.map((e) => e[0])); SW.push(...w);
      }
      byPicture[pic].push(id);
    }
  }
  const verts = P.length / 3;
  if (verts > 65535) throw new Error('too many points for a 16-bit index: ' + verts);
  if (uvOut) console.log(uvOut + ' picture coordinates lie outside 0..1');
  const index = [...byPicture[0], ...byPicture[1]];
  const b64 = (typed) => { const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

  // The pictures: read, shrunk, stored as WebP.
  const picture = async (file, size) => {
    const tex = await new TGALoader().loadAsync('/__src/' + file);
    const img = tex.image; // { data, width, height }, rows bottom to top
    const full = new OffscreenCanvas(img.width, img.height);
    const id = new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height);
    full.getContext('2d').putImageData(id, 0, 0);
    const small = new OffscreenCanvas(size, size);
    const ctx = small.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    // Shrunk in halves, which keeps it sharper than one big step. The loader hands the rows over top to bottom already, which is what the flipped picture coordinates above expect.
    let cur = full;
    while (cur.width / 2 >= size) { const half = new OffscreenCanvas(cur.width / 2, cur.height / 2); const hc = half.getContext('2d'); hc.imageSmoothingQuality = 'high'; hc.drawImage(cur, 0, 0, half.width, half.height); cur = half; }
    ctx.drawImage(cur, 0, 0, size, size);
    const blob = await small.convertToBlob({ type: 'image/webp', quality: 0.86 });
    return { data: b64(new Uint8Array(await blob.arrayBuffer())), type: blob.type, size };
  };
  const pictures = [await picture('m026_body_color.tga', 1024), await picture('m026_head_color.tga', 512)];

  // The figure at rest, for working out the moves.
  const B = (name) => new THREE.Vector3().fromArray(bones.find((b) => b.name === name).pos);
  const arr = (vv) => vv.toArray();
  const joints = { hipC: [0, 40, 0], s0: arr(B('Bip01_Spine')), s1: arr(B('Bip01_Spine1')), s2: arr(B('Bip01_Spine2')), neck: arr(B('Bip01_Neck')), head: arr(B('Bip01_Head')) };
  const headI = keep.indexOf(headBone);
  const footOf = (s) => [keep.findIndex((b) => b.name === 'Bip01_' + s + '_Foot'), keep.findIndex((b) => b.name === 'Bip01_' + s + '_Toe0')];
  const lo = new THREE.Vector3(1e9, 1e9, 1e9); const hi = new THREE.Vector3(-1e9, -1e9, -1e9); let top = 0;
  const tipX = { R: -1e9, L: -1e9 };
  for (let i = 0; i < verts; i++) {
    const p = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    top = Math.max(top, p.y);
    if (SI[i * 4] === headI && SW[i * 4] > 200) { lo.min(p); hi.max(p); }
    for (const s of ['R', 'L']) if (footOf(s).includes(SI[i * 4])) tipX[s] = Math.max(tipX[s], p.x);
  }
  joints.headC = arr(lo.clone().add(hi).multiplyScalar(0.5));
  const rest = { unit: 0.01 / scale, joints, headR: Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) / 2, top };
  for (const s of ['R', 'L']) {
    const n = (part) => B('Bip01_' + s + '_' + part);
    const hand = n('Hand'); const first = n('Finger1'); const little = n('Finger4'); const middle = n('Finger2'); const middleTip = n('Finger22');
    const along = middle.clone().sub(hand).normalize();
    // The palm faces the way the fingers curl at rest.
    let palm = first.clone().sub(hand).cross(little.clone().sub(hand)).normalize();
    const curl = middleTip.clone().sub(middle); curl.sub(along.clone().multiplyScalar(curl.dot(along)));
    if (palm.dot(curl) < 0) palm.negate();
    const grip = hand.clone().lerp(middle, 0.72).add(palm.clone().multiplyScalar(1.5 * scale));
    const toe = n('Toe0');
    Object.assign(joints, {
      ['hip' + s]: arr(n('Thigh')), ['knee' + s]: arr(n('Calf')), ['ankle' + s]: arr(n('Foot')), ['toe' + s]: arr(toe), ['tip' + s]: [tipX[s], toe.y, toe.z],
      ['sh' + s]: arr(n('UpperArm')), ['elbow' + s]: arr(n('Forearm')), ['wrist' + s]: arr(hand), ['grip' + s]: arr(grip),
    });
    rest['palm' + s] = arr(palm); rest['across' + s] = arr(little.clone().sub(first).normalize());
  }
  // The two sides are made exact mirrors of each other. The model's own differ by a hair, which would show as a left and right that do not quite match.
  const flip = (v) => [v[0], v[1], -v[2]];
  const even = (a, b) => { const m = a.map((x, i) => (x + flip(b)[i]) / 2); return [m, flip(m)]; };
  for (const k of ['hip', 'knee', 'ankle', 'toe', 'tip', 'sh', 'elbow', 'wrist', 'grip']) [joints[k + 'R'], joints[k + 'L']] = even(joints[k + 'R'], joints[k + 'L']);
  for (const k of ['palm', 'across']) [rest[k + 'R'], rest[k + 'L']] = even(rest[k + 'R'], rest[k + 'L']);
  rest.map = {
    root: 'Bip01_Pelvis', pelvis: 'Bip01_Pelvis', s0: 'Bip01_Spine', s1: 'Bip01_Spine1', s2: 'Bip01_Spine2', neck: 'Bip01_Neck', head: 'Bip01_Head',
    ...Object.fromEntries(['R', 'L'].flatMap((s) => [['upper' + s, 'Bip01_' + s + '_UpperArm'], ['fore' + s, 'Bip01_' + s + '_Forearm'], ['hand' + s, 'Bip01_' + s + '_Hand'], ['thigh' + s, 'Bip01_' + s + '_Thigh'], ['shin' + s, 'Bip01_' + s + '_Calf'], ['foot' + s, 'Bip01_' + s + '_Foot']])),
  };

  const n8 = new Int8Array(N.map((x) => Math.max(-127, Math.min(127, Math.round(x * 127)))));
  return {
    verts, tris: index.length / 3, bones, rest,
    groups: [{ start: 0, count: byPicture[0].length, picture: 0 }, { start: byPicture[0].length, count: byPicture[1].length, picture: 1 }],
    position: b64(new Float32Array(P)), normal: b64(n8), uv: b64(new Float32Array(U)),
    skinIndex: b64(new Uint8Array(SI)), skinWeight: b64(new Uint8Array(SW)), index: b64(new Uint16Array(index)), pictures,
  };
}
