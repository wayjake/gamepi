'use strict';

const test = require('node:test');
const assert = require('node:assert');

const mesh = require('../src/gfx/mesh');
const scene3d = require('../src/gfx/scene3d');
const { PALETTE, RAMP, step } = require('../src/gfx/palette');

const W = 160, H = 120;
// A horizontal quad wound so its normal points up, i.e. visible from above.
const quad = (size, y) => {
  const b = mesh.builder();
  const v = [
    b.vertex(-size, y, -size), b.vertex(size, y, -size),
    b.vertex(size, y, size), b.vertex(-size, y, size),
  ];
  b.quad(v[0], v[3], v[2], v[1]);
  return b.done();
};

// A wall in the XY plane facing -Z, i.e. towards a camera at yaw 0 sitting in
// front of it. Wound so the front face is the one you can see.
function wall(size, z, offsetX = 0) {
  const b = mesh.builder();
  const v = [
    b.vertex(offsetX - size, -size, z), b.vertex(offsetX + size, -size, z),
    b.vertex(offsetX + size, size, z), b.vertex(offsetX - size, size, z),
  ];
  b.quad(v[0], v[3], v[2], v[1]);
  return b.done();
}

const looking = (extra = {}) => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 1.0, near: 0.5, ...extra });
const count = (canvas, colour) => canvas.px.reduce((n, c) => n + (c === colour ? 1 : 0), 0);

test('every mesh primitive gives unit normals and no zero-area triangles', () => {
  const shapes = {
    grid: mesh.grid(10, 10, 4, 4),
    box: mesh.box(2, 2, 2),
    cylinder: mesh.cylinder(1, 3, 8),
    cone: mesh.cone(1, 3, 8),
    sphere: mesh.sphere(1, 6, 8),  // its poles are made of degenerate quads
    disc: mesh.disc(2, 10),
    blade: mesh.blade([[0, 0, 0], [1, 0, 0], [0, 1, 0]]),
  };
  for (const [name, m] of Object.entries(shapes)) {
    assert.ok(m.count > 0, `${name} built nothing`);
    assert.strictEqual(m.tris.length, m.count * 3);
    assert.strictEqual(m.normals.length, m.count * 3);
    for (let i = 0; i < m.normals.length; i += 3) {
      const len = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
      assert.ok(Math.abs(len - 1) < 1e-4, `${name}: normal ${i / 3} has length ${len}`);
    }
  }
});

// A closed shape wound inside-out is a quiet bug: culling goes on screen-space
// winding, so the silhouette still looks right -- you are just being shown the
// far surface of the object, lit by an inverted normal and at the wrong depth.
// The sphere, cylinder and cone were all like this and it took a golf ball that
// would not shade like a sphere to notice.
test('closed primitives face outwards', () => {
  const closed = {
    box: { mesh: mesh.box(2, 2, 2), centre: [0, 0, 0] },
    sphere: { mesh: mesh.sphere(2, 7, 10), centre: [0, 0, 0] },
    cylinder: { mesh: mesh.cylinder(1, 4, 8), centre: [0, 2, 0] },
    cone: { mesh: mesh.cone(1, 3, 8), centre: [0, 1, 0] },
  };

  for (const [name, { mesh: m, centre }] of Object.entries(closed)) {
    for (let t = 0; t < m.count; t++) {
      const i = t * 3;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        const v = m.tris[i + k] * 3;
        cx += m.vertices[v]; cy += m.vertices[v + 1]; cz += m.vertices[v + 2];
      }
      const facing = m.normals[i] * (cx / 3 - centre[0])
        + m.normals[i + 1] * (cy / 3 - centre[1])
        + m.normals[i + 2] * (cz / 3 - centre[2]);
      assert.ok(facing > 0, `${name}: triangle ${t} points into the shape`);
    }
  }
});

test('a flat disc faces up', () => {
  const d = mesh.disc(3, 10);
  for (let i = 0; i < d.normals.length; i += 3) {
    assert.ok(d.normals[i + 1] > 0.99, `disc triangle ${i / 3} does not face up`);
  }
});

// The other half of the same bug: a sphere drawn from outside shows its near
// surface, so what the depth buffer holds is the front of it, not the back.
test('a sphere is drawn at its near surface, not its far one', () => {
  const into = scene3d.target(W, H);
  const scene = {
    background: PALETTE.ink, ambient: 1,
    camera: { x: 0, y: 0, z: -20, yaw: 0, pitch: 0, fov: 1.0, near: 0.5 },
    models: [{ mesh: mesh.sphere(4, 8, 12), position: [0, 0, 0], ramp: 'cream' }],
  };
  scene3d.render(scene, into);

  const middle = (H / 2) * W + W / 2;
  assert.notStrictEqual(into.canvas.px[middle], PALETTE.ink, 'the sphere is not on screen');
  // Depth is 1/z: the near face of a radius-4 sphere 20 away is at z = 16.
  assert.ok(Math.abs(1 / into.depth[middle] - 16) < 1.5,
    `centre of the sphere is at z=${(1 / into.depth[middle]).toFixed(1)}, expected about 16`);
});

test('a model can light itself differently from the scene', () => {
  const into = scene3d.target(W, H);
  const shades = (ambient) => {
    scene3d.render({
      background: PALETTE.ink, ambient: 0.42,
      light: { x: -0.45, y: 0.8, z: -0.4 },
      camera: { x: 0, y: 1, z: -14, yaw: 0, pitch: -0.05, fov: 1.0, near: 0.5 },
      models: [{ mesh: mesh.sphere(4, 8, 12), position: [0, 0, 0], ramp: 'cream', ambient }],
    }, into);
    return new Set([...into.canvas.px].filter((c) => c !== PALETTE.ink));
  };

  // At the scene's ambient only the top two steps are reachable, and for a
  // near-white ramp those are the same colour -- so the ball came out flat.
  assert.ok(shades(0.2).size > shades(0.42).size,
    'a lower model ambient did not reach further down the ramp');
  assert.strictEqual(shades(undefined).size, shades(0.42).size, 'the scene ambient is not the default');
});

test('a flat grid samples the height function it was given', () => {
  const h = (x, z) => x * 0.5 + z * 0.25;
  const g = mesh.grid(8, 8, 2, 2, h);
  for (let i = 0; i < g.vertices.length; i += 3) {
    const [x, y, z] = [g.vertices[i], g.vertices[i + 1], g.vertices[i + 2]];
    assert.ok(Math.abs(y - h(x, z)) < 1e-4, `vertex at ${x},${z} is ${y}, expected ${h(x, z)}`);
  }
});

test('a face towards the camera is drawn and the same face turned away is not', () => {
  const into = scene3d.target(W, H);
  const front = scene3d.render({
    background: PALETTE.ink, camera: looking(), ambient: 1,
    models: [{ mesh: wall(4, 10), ramp: 'ember' }],
  }, into);
  assert.ok(front.drawn > 0, 'nothing was drawn');
  assert.ok(count(into.canvas, PALETTE.emberLit) > 100, 'the wall is not on screen');

  // The same wall seen from its other side. The camera has to be turned round
  // as well as moved: at z = 20 still facing +Z the wall is merely behind it,
  // which would pass this test without culling anything.
  const back = scene3d.render({
    background: PALETTE.ink, camera: looking({ z: 20, yaw: Math.PI }), ambient: 1,
    models: [{ mesh: wall(4, 10), ramp: 'ember' }],
  }, into);
  assert.strictEqual(back.drawn, 0, 'a back face was rasterised');
  assert.strictEqual(count(into.canvas, PALETTE.ink), W * H, 'something was painted');
});

test('a two-sided face is drawn from behind', () => {
  const into = scene3d.target(W, H);
  const r = scene3d.render({
    background: PALETTE.ink, camera: looking({ z: 20, yaw: Math.PI }), ambient: 1,
    models: [{ mesh: wall(4, 10), ramp: 'ember', twoSided: true }],
  }, into);
  assert.ok(r.drawn > 0, 'twoSided did not survive the cull');
});

test('the nearer surface wins whatever order it is submitted in', () => {
  const into = scene3d.target(W, H);
  const near = { mesh: wall(3, 8), ramp: 'ember' };
  const far = { mesh: wall(3, 16), ramp: 'sky' };

  for (const models of [[near, far], [far, near]]) {
    scene3d.render({ background: PALETTE.ink, camera: looking(), ambient: 1, models }, into);
    const middle = into.canvas.px[(H / 2) * W + W / 2];
    assert.strictEqual(middle, PALETTE.emberLit, 'the far wall painted over the near one');
  }
});

// Interpolating view-space z linearly across a screen span is not affine under
// perspective; 1/z is. A ground plane running away from the camera is where
// getting that wrong shows up, so it is what the test uses.
test('depth stays correct down a plane running to the horizon', () => {
  const into = scene3d.target(W, H);
  scene3d.render({
    background: PALETTE.sky,
    camera: { x: 0, y: 6, z: -10, yaw: 0, pitch: -0.15, fov: 1.0, near: 0.5 },
    ambient: 1,
    models: [
      { mesh: mesh.grid(200, 200, 8, 8), position: [0, 0, 0], ramp: 'turf' },
      { mesh: mesh.box(4, 8, 4), position: [0, 4, 30], ramp: 'ember' },
    ],
  }, into);
  // The post is in front of the ground behind it and must not be eaten by it.
  assert.ok(count(into.canvas, PALETTE.emberLit) + count(into.canvas, PALETTE.ember) > 40,
    'the post was overwritten by the ground plane');
});

test('geometry crossing the near plane is clipped, not exploded', () => {
  const into = scene3d.target(W, H);
  // A long floor running from behind the camera to well in front of it.
  const r = scene3d.render({
    background: PALETTE.ink,
    camera: { x: 0, y: 3, z: 0, yaw: 0, pitch: -0.2, fov: 1.0, near: 0.5 },
    ambient: 1,
    models: [{ mesh: mesh.grid(80, 200, 6, 6), position: [0, 0, -100], ramp: 'turf' }],
  }, into);

  assert.ok(r.drawn > 0, 'the floor vanished entirely');
  for (const colour of new Set(into.canvas.px)) {
    assert.ok(Object.values(PALETTE).includes(colour),
      `clipping invented #${colour.toString(16).padStart(6, '0')}`);
  }
  assert.ok(Number.isFinite(into.depth[0]), 'the depth buffer went non-finite');
});

test('shading only ever picks a colour that is in the palette', () => {
  const into = scene3d.target(W, H);
  scene3d.render({
    background: PALETTE.sky,
    camera: { x: 0, y: 8, z: -18, yaw: 0, pitch: -0.2, fov: 1.05, near: 0.5 },
    models: [
      { mesh: mesh.grid(120, 160, 12, 12, (x, z) => Math.sin(x * 0.1) * 3 + Math.cos(z * 0.08) * 3), ramp: 'turf' },
      { mesh: mesh.sphere(4, 8, 10), position: [0, 6, 20], ramp: 'ember' },
      { mesh: mesh.cylinder(2, 10, 8), position: [-12, 0, 24], ramp: 'bark' },
      { mesh: mesh.cone(6, 12, 9), position: [-12, 9, 24], ramp: 'leaf' },
    ],
  }, into);

  const allowed = new Set(Object.values(PALETTE));
  const seen = new Set(into.canvas.px);
  for (const colour of seen) {
    assert.ok(allowed.has(colour), `stray colour #${colour.toString(16).padStart(6, '0')}`);
  }
  assert.ok(seen.size >= 4, `only ${seen.size} colours -- is anything being shaded?`);
});

test('a shade bias moves along the ramp and cannot fall off the end', () => {
  const into = scene3d.target(W, H);
  const flat = quad(20, -2);
  const render = (bias) => {
    scene3d.render({
      background: PALETTE.ink,
      camera: { x: 0, y: 6, z: -14, yaw: 0, pitch: -0.3, fov: 1.0, near: 0.5 },
      models: [{ mesh: flat, ramp: 'turf', bias }],
    }, into);
    return new Set(into.canvas.px);
  };

  const plain = render(null);
  const darker = render(Int8Array.from({ length: flat.count }, () => -1));
  assert.notDeepStrictEqual([...plain].sort(), [...darker].sort(), 'the bias did nothing');

  // Way past either end of the ramp: it must clamp, not index off the array.
  for (const amount of [-9, 9]) {
    const colours = render(Int8Array.from({ length: flat.count }, () => amount));
    for (const colour of colours) {
      assert.ok(Object.values(PALETTE).includes(colour), `bias ${amount} produced a non-palette colour`);
    }
  }
});

test('the ramp has a step for every lighting value', () => {
  for (const light of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
    const i = step(light);
    assert.ok(Number.isInteger(i) && i >= 0 && i < RAMP.turf.length, `step(${light}) = ${i}`);
  }
});

test('project agrees with where the rasteriser puts a point', () => {
  const into = scene3d.target(W, H);
  const scene = {
    background: PALETTE.ink, camera: looking(), ambient: 1,
    models: [{ mesh: wall(0.6, 12, 6), ramp: 'ember' }],
  };
  scene3d.render(scene, into);

  const at = scene3d.project(scene, into, 6, 0, 12);
  assert.ok(at, 'a point in front of the camera projected to nothing');
  assert.ok(at.x > W / 2, 'a point to the right of the camera landed left of centre');
  assert.strictEqual(into.canvas.px[Math.round(at.y) * W + Math.round(at.x)], PALETTE.emberLit,
    'project and the rasteriser disagree about where that point is');

  assert.strictEqual(scene3d.project(scene, into, 0, 0, -5), null, 'a point behind the camera projected');
});

test('the target is reused rather than reallocated', () => {
  const into = scene3d.target(W, H);
  const first = into.canvas.px;
  const depth = into.depth;
  for (let i = 0; i < 3; i++) {
    scene3d.render({ background: PALETTE.ink, camera: looking(), models: [{ mesh: wall(3, 9), ramp: 'sky' }] }, into);
  }
  assert.strictEqual(into.canvas.px, first, 'the canvas was replaced between frames');
  assert.strictEqual(into.depth, depth, 'the depth buffer was replaced between frames');
});
