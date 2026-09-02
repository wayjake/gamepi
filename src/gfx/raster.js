'use strict';
// Drawing primitives for the inked-poster look.
//
// Everything reduces to discs. A limb is a chain of discs stepped along a
// polyline with the radius lerped between control points -- that gives the
// flowing, round-capped shapes of the reference drawing, and it makes the ink
// outline free: draw the same chain with every radius grown by the ink width.
//
// Nothing is anti-aliased, on purpose. Composite video on a CRT does that for
// us, and hard edges are the point of the style.

function disc(canvas, cx, cy, r, color) {
  if (r <= 0) return;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(canvas.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(canvas.height - 1, Math.ceil(cy + r));

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const span = r2 - dy * dy;
    if (span < 0) continue;
    const half = Math.sqrt(span);
    const from = Math.max(0, Math.ceil(cx - half));
    const to = Math.min(canvas.width - 1, Math.floor(cx + half));
    const row = y * canvas.width;
    for (let x = from; x <= to; x++) canvas.px[row + x] = color;
  }
}

// points: [{ x, y, r }]. Steps discs along each segment, lerping the radius,
// so a chain is the union of a tapered capsule per segment.
function chain(canvas, points, color, grow = 0) {
  if (points.length === 1) {
    disc(canvas, points[0].x, points[0].y, points[0].r + grow, color);
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length * 2)); // half-pixel spacing
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(canvas, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.r + (b.r - a.r) * t + grow, color);
    }
  }
}

function rect(canvas, x, y, w, h, color) {
  canvas.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), color);
}

// A hollow rectangle drawn as four bars -- the frame around the picture.
function frame(canvas, x, y, w, h, weight, color) {
  rect(canvas, x, y, w, weight, color);
  rect(canvas, x, y + h - weight, w, weight, color);
  rect(canvas, x, y, weight, h, color);
  rect(canvas, x + w - weight, y, weight, h, color);
}

// Samples a circular arc into chain control points.
function arc(cx, cy, radius, fromDeg, toDeg, weight, segments = 8) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = ((fromDeg + (toDeg - fromDeg) * (i / segments)) * Math.PI) / 180;
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, r: weight });
  }
  return points;
}

// The radiating energy marks: short strokes fanning around a point, bowed
// slightly so they sit with the curved bodies instead of looking mechanical.
// Same ink weight as the outlines -- they're part of the same drawing.
function rays({ cx, cy, inner, outer, count, fromDeg, toDeg, weight, bow = 8 }) {
  const marks = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const deg = fromDeg + (toDeg - fromDeg) * t;
    const a = (deg * Math.PI) / 180;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const [nx, ny] = [-uy, ux]; // perpendicular, for the bow
    const lean = bow * (t - 0.5) * 2; // fan the bow across the spread

    marks.push([
      { x: cx + ux * inner, y: cy + uy * inner, r: weight },
      {
        x: cx + ux * (inner + outer) / 2 + nx * lean,
        y: cy + uy * (inner + outer) / 2 + ny * lean,
        r: weight,
      },
      { x: cx + ux * outer, y: cy + uy * outer, r: weight },
    ]);
  }
  return marks;
}

module.exports = { disc, chain, rect, frame, arc, rays };
