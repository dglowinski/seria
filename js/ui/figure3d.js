// The modelled figure on the 3D stage: reads assets/figure.bin into a skin on
// bones that three.js can draw, and bends it into a pose. What the file holds
// and how a pose turns the bones is in domain/skeleton.js; this file only
// hands that to three.js.

import { readFigure, skeleton } from '../domain/skeleton.js';

/** The bytes of the figure file. A page that carries the file inside itself (the claude.ai build) hands it over as text. */
async function figureBytes() {
  const packed = globalThis.SERIA_FIGURE;
  if (packed) { const s = atob(packed); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
  const res = await fetch(new URL('../../assets/figure.bin', import.meta.url));
  if (!res.ok) throw new Error(`figure: ${res.status}`);
  return res.arrayBuffer();
}

/**
 * @param {object} T three.js
 * @returns {Promise<{object: object, pose: (fig: object) => void}>}
 */
export async function loadFigure(T) {
  const buf = await figureBytes();
  const { head, base } = readFigure(buf);
  const part = (Type, o) => new Type(buf.slice(base + o.offset, base + o.offset + o.length));

  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(part(Float32Array, head.position), 3));
  geo.setAttribute('normal', new T.BufferAttribute(part(Int8Array, head.normal), 3, true));
  geo.setAttribute('uv', new T.BufferAttribute(part(Float32Array, head.uv), 2));
  geo.setAttribute('skinIndex', new T.BufferAttribute(new Uint16Array(part(Uint8Array, head.skinIndex)), 4));
  geo.setAttribute('skinWeight', new T.BufferAttribute(part(Uint8Array, head.skinWeight), 4, true));
  geo.setIndex(new T.BufferAttribute(part(Uint16Array, head.index), 1));
  head.groups.forEach((g) => geo.addGroup(g.start, g.count, g.picture));

  // The two pictures (body, head) are stored turned the way the picture coordinates expect, so they go in as they are.
  const mats = await Promise.all(head.pictures.map(async (p) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(buf, base + p.offset, p.length)], { type: p.type }));
    const map = new T.Texture(bitmap);
    map.flipY = false; map.colorSpace = T.SRGBColorSpace; map.needsUpdate = true;
    return new T.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 });
  }));

  const B = head.bones;
  const sk = skeleton(B);
  const bones = B.map((b) => { const bone = new T.Bone(); bone.name = b.name; return bone; });
  const top = new T.Group();
  for (const i of sk.order) {
    const { q, p } = sk.restLocal[i];
    bones[i].position.set(p[0], p[1], p[2]);
    bones[i].quaternion.set(q[0], q[1], q[2], q[3]);
    (B[i].parent < 0 ? top : bones[B[i].parent]).add(bones[i]);
  }
  const inverses = B.map((b) => new T.Matrix4().compose(new T.Vector3(...b.pos), new T.Quaternion(...b.quat), new T.Vector3(1, 1, 1)).invert());
  const mesh = new T.SkinnedMesh(geo, mats);
  mesh.add(top);
  mesh.bind(new T.Skeleton(bones, inverses), new T.Matrix4());
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;

  /** Bends the figure into the pose `fig` (see rig3 in domain/moves3d.js). */
  function pose(fig) {
    const { local, rootAt } = sk.pose(fig);
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.set(local[i][0], local[i][1], local[i][2], local[i][3]);
    bones[sk.root].position.set(rootAt[0], rootAt[1], rootAt[2]);
  }

  return { object: mesh, pose, head };
}
