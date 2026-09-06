'use strict';
// The 3D rasteriser: a scene description in, a Canvas out.
//
// Same bargain as gfx/scene.js -- the description is data, rendering it has no
// side effects, and every colour painted is a palette entry. What is different
// is that this one owns a depth buffer, so the target is made once and reused
// rather than allocated per frame (see target()).
//
// Why it can afford to be software: measured at ~107 Mpx/s extrapolated to the
// Pi 4, and a scene like the golf hole covers the screen two or three times
// over, so about 10 ms of a 33 ms frame. Fill rate is the whole budget here,
// exactly as it is on the GPU -- triangle count barely registers. That is why
// there is backface culling and a near clip and no texturing at all.
//
// Depth is kept as 1/z. Interpolating z linearly across a screen-space span is
// wrong -- it isn't affine under perspective, and on a ground plane running to
// the horizon the error is large enough to see. 1/z is affine, so it can be
// stepped along a scanline with an add.

const { Canvas } = require('../canvas');
const { PALETTE, RAMP, step } = require('./palette');

// Room for the two triangles a near-plane clip can produce, plus the working
// polygon. Allocated once; nothing in the frame loop allocates.
const MAX_CLIP = 4;

function target(width, height) {
  return {
    width,
    height,
    canvas: new Canvas(width, height),
    depth: new Float32Array(width * height), // 1/z, so 0 is infinitely far
    // Scratch for the vertex pipeline, sized for the largest mesh seen so far.
    view: new Float32Array(3 * 64),
    screen: new Float32Array(3 * 64),
  };
}

function fit(into, vertexCount) {
  if (into.view.length >= vertexCount * 3) return into;
  const size = Math.max(vertexCount * 3, into.view.length * 2);
  into.view = new Float32Array(size);
  into.screen = new Float32Array(size);
  return into;
}

// Camera basis. yaw 0 looks down +Z, which is the direction mesh.grid() runs
// and the direction a golf hole goes; positive pitch looks up. +Y is up, +X is
// right at yaw 0.
function basis(camera) {
  const cy = Math.cos(camera.yaw ?? 0), sy = Math.sin(camera.yaw ?? 0);
  const cp = Math.cos(camera.pitch ?? 0), sp = Math.sin(camera.pitch ?? 0);
  return {
    fx: sy * cp, fy: sp, fz: cy * cp,     // forward
    rx: cy, ry: 0, rz: -sy,               // right
    ux: -sy * sp, uy: cp, uz: -cy * sp,   // up = forward x right
  };
}

function render(scene, into) {
  const width = into.width;
  const height = into.height;
  const canvas = into.canvas;
  const depth = into.depth;
  const px = canvas.px;

  canvas.clear(scene.background ?? PALETTE.sky);
  depth.fill(0);

  const camera = scene.camera;
  const near = camera.near ?? 0.5;
  const b = basis(camera);
  const scale = (height / 2) / Math.tan((camera.fov ?? 1.0) / 2);
  const halfW = width / 2;
  const halfH = height / 2;

  // Light comes from a direction, not a position: it is a sun.
  const light = scene.light ?? { x: -0.4, y: 0.86, z: 0.3 };
  const ll = Math.hypot(light.x, light.y, light.z) || 1;
  const lx = light.x / ll, ly = light.y / ll, lz = light.z / ll;
  const sceneAmbient = scene.ambient ?? 0.35;

  let drawn = 0;
  let culled = 0;

  for (const model of scene.models ?? []) {
    const mesh = model.mesh;
    const verts = mesh.vertices;
    const count = verts.length / 3;
    fit(into, count);

    const ramp = typeof model.ramp === 'string' ? RAMP[model.ramp] : model.ramp;
    if (!ramp) throw new Error(`model has no ramp: ${model.ramp}`);

    // An optional per-triangle nudge along the ramp, worked out when the mesh
    // was built. Lighting alone can't tell you much about ground this flat --
    // three steps means a gentle slope is one colour -- and this is how a
    // fairway gets its mowing stripes without a texture unit.
    const bias = model.bias ?? null;

    // A model may light itself differently from the scene. Terrain wants a high
    // ambient so the shaded side of a hill doesn't go black; a small object
    // wants a low one, because with three steps a high ambient can only reach
    // the top two -- and for a near-white ramp those two are the same colour,
    // so the object comes out as a flat silhouette.
    const ambient = model.ambient ?? sceneAmbient;

    const [ox, oy, oz] = model.position ?? [0, 0, 0];
    const s = model.scale ?? 1;
    const yaw = model.yaw ?? 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    // Vertices to view space, once per model.
    const view = into.view;
    const screen = into.screen;
    for (let i = 0, o = 0; i < count; i++, o += 3) {
      const mx = verts[o] * s, my = verts[o + 1] * s, mz = verts[o + 2] * s;
      const wx = mx * cy + mz * sy + ox;
      const wy = my + oy;
      const wz = -mx * sy + mz * cy + oz;

      const dx = wx - camera.x, dy = wy - camera.y, dz = wz - camera.z;
      const vx = dx * b.rx + dy * b.ry + dz * b.rz;
      const vy = dx * b.ux + dy * b.uy + dz * b.uz;
      const vz = dx * b.fx + dy * b.fy + dz * b.fz;
      view[o] = vx; view[o + 1] = vy; view[o + 2] = vz;

      if (vz > 1e-6) {
        const k = scale / vz;
        screen[o] = halfW + vx * k;
        screen[o + 1] = halfH - vy * k;
        screen[o + 2] = 1 / vz;
      }
    }

    const tris = mesh.tris;
    const normals = mesh.normals;

    for (let t = 0, n = 0; t < tris.length; t += 3, n += 3) {
      // Lighting uses the world normal, so a model's yaw turns its shading too.
      const nx0 = normals[n], ny0 = normals[n + 1], nz0 = normals[n + 2];
      const nx = nx0 * cy + nz0 * sy;
      const nz = -nx0 * sy + nz0 * cy;
      const lambert = nx * lx + ny0 * ly + nz * lz;
      let shade = step(ambient + (1 - ambient) * Math.max(0, lambert));
      if (bias !== null) {
        shade += bias[t / 3];
        shade = shade < 0 ? 0 : shade > 2 ? 2 : shade;
      }
      const colour = ramp[shade];

      const a = tris[t] * 3, bb = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const az = view[a + 2], bz = view[bb + 2], cz = view[c + 2];

      if (az >= near && bz >= near && cz >= near) {
        if (!face(px, depth, width, height,
          screen[a], screen[a + 1], screen[a + 2],
          screen[bb], screen[bb + 1], screen[bb + 2],
          screen[c], screen[c + 1], screen[c + 2],
          colour, model.twoSided === true)) culled++;
        else drawn++;
        continue;
      }
      if (az < near && bz < near && cz < near) { culled++; continue; }

      // Straddles the near plane: clip in view space and project the pieces.
      drawn += clipped(px, depth, width, height, view, a, bb, c, near, scale, halfW, halfH, colour, model.twoSided === true);
    }
  }

  return { canvas, drawn, culled };
}

// Clips one triangle against z = near and rasterises what survives.
function clipped(px, depth, width, height, view, a, b, c, near, scale, halfW, halfH, colour, twoSided) {
  const poly = new Float32Array(MAX_CLIP * 3);
  let n = 0;

  const idx = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const cur = idx[i], next = idx[(i + 1) % 3];
    const cz = view[cur + 2], nz = view[next + 2];
    const inside = cz >= near;

    if (inside) {
      poly[n * 3] = view[cur]; poly[n * 3 + 1] = view[cur + 1]; poly[n * 3 + 2] = cz;
      n++;
    }
    if (inside !== (nz >= near)) {
      const k = (near - cz) / (nz - cz);
      poly[n * 3] = view[cur] + (view[next] - view[cur]) * k;
      poly[n * 3 + 1] = view[cur + 1] + (view[next + 1] - view[cur + 1]) * k;
      poly[n * 3 + 2] = near;
      n++;
    }
  }
  if (n < 3) return 0;

  const sx = new Float32Array(n), sy = new Float32Array(n), sw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = poly[i * 3 + 2];
    const k = scale / z;
    sx[i] = halfW + poly[i * 3] * k;
    sy[i] = halfH - poly[i * 3 + 1] * k;
    sw[i] = 1 / z;
  }

  let drawn = 0;
  for (let i = 1; i < n - 1; i++) {
    if (face(px, depth, width, height,
      sx[0], sy[0], sw[0], sx[i], sy[i], sw[i], sx[i + 1], sy[i + 1], sw[i + 1],
      colour, twoSided)) drawn++;
  }
  return drawn;
}

// One screen-space triangle, depth-tested on 1/z. Returns false if it was
// culled or off screen. Kept in its own function with nothing polymorphic in
// it, for the reason framebuffer.js keeps packRGB565 in its own function.
function face(px, depth, width, height, ax, ay, aw, bx, by, bw, cx, cy, cw, colour, twoSided) {
  // Backface cull on the signed area, which gives the winding a meaning that
  // doesn't depend on the normal surviving the transform. Front faces come out
  // positive under this basis and this projection's flipped screen Y.
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0 || (!twoSided && area <= 0)) return false;

  if (ay > by) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = aw; aw = bw; bw = t; }
  if (by > cy) { let t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; t = bw; bw = cw; cw = t; }
  if (ay > by) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = aw; aw = bw; bw = t; }

  const total = cy - ay;
  if (total <= 0) return false;

  const first = Math.max(0, Math.ceil(ay));
  const last = Math.min(height - 1, Math.ceil(cy) - 1);

  for (let y = first; y <= last; y++) {
    const second = y >= by;
    const segH = second ? cy - by : by - ay;
    if (segH <= 0) continue;

    const alpha = (y - ay) / total;
    const beta = second ? (y - by) / segH : (y - ay) / segH;

    let xl = ax + (cx - ax) * alpha;
    let wl = aw + (cw - aw) * alpha;
    let xr = second ? bx + (cx - bx) * beta : ax + (bx - ax) * beta;
    let wr = second ? bw + (cw - bw) * beta : aw + (bw - aw) * beta;
    if (xl > xr) { let t = xl; xl = xr; xr = t; t = wl; wl = wr; wr = t; }

    const x0 = Math.max(0, Math.ceil(xl));
    const x1 = Math.min(width - 1, Math.ceil(xr) - 1);
    if (x1 < x0) continue;

    const span = xr - xl;
    const dw = span > 0 ? (wr - wl) / span : 0;
    let w = wl + (x0 - xl) * dw;
    const row = y * width;

    for (let x = x0; x <= x1; x++, w += dw) {
      const i = row + x;
      if (w > depth[i]) { depth[i] = w; px[i] = colour; }
    }
  }
  return true;
}

// Where a world point lands on screen, for putting 2D over the top of 3D --
// a marker on the hole, the ball's position for a camera to follow. Returns
// null for anything behind the near plane.
function project(scene, into, x, y, z) {
  const camera = scene.camera;
  const b = basis(camera);
  const near = camera.near ?? 0.5;
  const scale = (into.height / 2) / Math.tan((camera.fov ?? 1.0) / 2);
  const dx = x - camera.x, dy = y - camera.y, dz = z - camera.z;
  const vz = dx * b.fx + dy * b.fy + dz * b.fz;
  if (vz < near) return null;
  const vx = dx * b.rx + dy * b.ry + dz * b.rz;
  const vy = dx * b.ux + dy * b.uy + dz * b.uz;
  const k = scale / vz;
  return { x: into.width / 2 + vx * k, y: into.height / 2 - vy * k, distance: vz };
}

module.exports = { render, target, project, basis };
