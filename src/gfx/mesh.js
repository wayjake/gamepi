'use strict';
// Primitives for the 3D side.
//
// The 2D renderer gets by on three shapes -- rect, disc, chain -- and
// everything else reduces to them. This is the same bargain: a handful of
// builders, all of them producing the one thing the rasteriser understands,
// which is a list of flat-shaded triangles with a normal each.
//
//   { vertices: Float32Array (x,y,z per vertex)
//     tris:     Uint32Array  (3 vertex indices per triangle)
//     normals:  Float32Array (x,y,z per *triangle*, not per vertex) }
//
// Per-triangle normals, because the shading is flat on purpose. Smooth normals
// would want a colour per pixel, and the palette has bands, not gradients.
//
// Y is up. Meshes are built around their own origin and placed by the scene.

// Accumulates triangles, then freezes them into typed arrays with the normals
// worked out once. Nothing here runs per frame.
function builder() {
  const vertices = [];
  const tris = [];

  const vertex = (x, y, z) => {
    vertices.push(x, y, z);
    return vertices.length / 3 - 1;
  };

  const triangle = (a, b, c) => { tris.push(a, b, c); };

  // Wound so that a, b, c, d go round the face; split along a-c.
  const quad = (a, b, c, d) => { triangle(a, b, c); triangle(a, c, d); };

  return {
    vertex,
    triangle,
    quad,
    done() {
      const verts = Float32Array.from(vertices);
      const keep = [];
      const normal = [];

      // Zero-area triangles have no normal to compute and nothing to shade --
      // the poles of a lat/long sphere are made of them -- so they are dropped
      // here rather than skipped once a frame forever after.
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
        const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) continue;
        keep.push(tris[t], tris[t + 1], tris[t + 2]);
        normal.push(nx / len, ny / len, nz / len);
      }

      return {
        vertices: verts,
        tris: Uint32Array.from(keep),
        normals: Float32Array.from(normal),
        count: keep.length / 3,
      };
    },
  };
}

// A heightmapped plane on the XZ axes, centred on x, running 0..depth in z.
// `height(x, z)` is sampled at the grid corners, so the mesh is exactly the
// surface the game's own physics reads -- there is no second copy to disagree.
function grid(width, depth, cols, rows, height = () => 0) {
  const b = builder();
  const index = [];
  for (let r = 0; r <= rows; r++) {
    const z = (r / rows) * depth;
    for (let c = 0; c <= cols; c++) {
      const x = -width / 2 + (c / cols) * width;
      index.push(b.vertex(x, height(x, z), z));
    }
  }
  const at = (c, r) => index[r * (cols + 1) + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      b.quad(at(c, r), at(c, r + 1), at(c + 1, r + 1), at(c + 1, r));
    }
  }
  return b.done();
}

function box(w, h, d) {
  const b = builder();
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const v = [
    b.vertex(-x, -y, -z), b.vertex(x, -y, -z), b.vertex(x, y, -z), b.vertex(-x, y, -z),
    b.vertex(-x, -y, z), b.vertex(x, -y, z), b.vertex(x, y, z), b.vertex(-x, y, z),
  ];
  b.quad(v[1], v[0], v[3], v[2]); // -z
  b.quad(v[4], v[5], v[6], v[7]); // +z
  b.quad(v[0], v[4], v[7], v[3]); // -x
  b.quad(v[5], v[1], v[2], v[6]); // +x
  b.quad(v[3], v[7], v[6], v[2]); // +y
  b.quad(v[0], v[1], v[5], v[4]); // -y
  return b.done();
}

// Sits on the origin and grows upward, which is what a pole or a trunk wants.
function cylinder(radius, height, sides = 8, topRadius = radius) {
  const b = builder();
  const bottom = [];
  const top = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    bottom.push(b.vertex(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    top.push(b.vertex(Math.cos(a) * topRadius, height, Math.sin(a) * topRadius));
  }
  // Wound so the normals face outwards. Getting this backwards is easy and
  // quiet: backface culling goes on screen-space winding, so an inside-out
  // convex shape still has the right silhouette -- it is just showing you its
  // far surface, lit by an inverted normal and at the wrong depth.
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    b.quad(bottom[i], top[i], top[j], bottom[j]);
  }
  const cap = b.vertex(0, height, 0);
  for (let i = 0; i < sides; i++) b.triangle(top[(i + 1) % sides], top[i], cap);
  return b.done();
}

const cone = (radius, height, sides = 8) => cylinder(radius, height, sides, 0.0001);

// Latitude/longitude sphere. Cheap to build and easy to reason about; at the
// sizes anything here is drawn, the pole pinch never shows.
function sphere(radius, rings = 6, segments = 8) {
  const b = builder();
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const row = [];
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      row.push(b.vertex(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      ));
    }
    rows.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const t = (s + 1) % segments;
      b.quad(rows[r][s], rows[r][t], rows[r + 1][t], rows[r + 1][s]); // outward
    }
  }
  return b.done();
}

// A flat disc facing +Y. The green, a bunker floor, the hole.
function disc(radius, sides = 12, y = 0) {
  const b = builder();
  const centre = b.vertex(0, y, 0);
  const rim = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    rim.push(b.vertex(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  for (let i = 0; i < sides; i++) b.triangle(centre, rim[(i + 1) % sides], rim[i]);
  return b.done();
}

// A single triangle, for things that are honestly just a triangle -- a flag.
function blade(points) {
  const b = builder();
  const v = points.map((p) => b.vertex(p[0], p[1], p[2]));
  b.triangle(v[0], v[1], v[2]);
  return b.done();
}

module.exports = { builder, grid, box, cylinder, cone, sphere, disc, blade };
