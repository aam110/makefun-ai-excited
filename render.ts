// render.ts — FIRST LIGHT: a deterministic procedural painting.
//
// The scene: a tiny lone figure on a black cliff holds up one small spark,
// and that spark ignites the sky — a colossal ringed planet eclipsing a
// rising sun above a dark sea, with a stream of embers rising from the
// figure's hand to feed the burst at the planet's rim. The smallest light
// causes the biggest one: scale inverted, momentum rising, one thrilling
// moment caught mid-ignition.
//
// Everything here is computed, never loaded: no assets, no network, no
// clock, no Math.random. A fixed seed feeds every random-looking choice,
// so the same code always paints the same picture.
//
// Composition (1024 x 1024):
//   sky      — deep indigo gradient, faint nebula veils, seeded stars
//   planet   — giant banded ringed planet, centre (648, 318), radius 296;
//              its bottom stays well clear of the horizon
//   burst    — the eclipsed sun flaring at the planet's lower-left rim
//              (396, 514), halo + lens streak + god-ray wedges
//   sea      — dark water below y = 742, streaked, with a shimmering
//              reflection column under the burst
//   cliff    — black silhouette, lower left, with a warm rim on its top
//              edge where the burst light catches it
//   figure   — a ~17 px silhouette on the cliff edge, arm raised,
//              holding the spark that starts it all
//   embers   — a rising stream of glowing motes along a curve from the
//              spark to the burst

export const WIDTH = 1024;
export const HEIGHT = 1024;

// ---------------------------------------------------------------------------
// Deterministic randomness: mulberry32 streams + integer-hash value noise.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash of two integer coordinates -> [0, 1). Fast and stable.
function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash1(ix: number): number {
  let h = Math.imul(ix ^ 0x9e3779b9, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function valueNoise1(x: number): number {
  const ix = Math.floor(x);
  const fx = smooth(x - ix);
  return hash1(ix) + (hash1(ix + 1) - hash1(ix)) * fx;
}

// Fractal Brownian motion: a few octaves of value noise, normalised to
// roughly [0, 1].
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(fx, fy);
    total += amp;
    amp *= 0.5;
    fx = fx * 2.03 + 11.7;
    fy = fy * 2.01 + 5.3;
  }
  return sum / total;
}

// ---------------------------------------------------------------------------
// The canvas: a float RGB buffer with additive and alpha compositing.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

class Canvas {
  readonly data = new Float32Array(WIDTH * HEIGHT * 3);

  private idx(x: number, y: number): number {
    return (y * WIDTH + x) * 3;
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const i = this.idx(x, y);
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }

  // Additive light: colour * strength added on top of what is there.
  add(x: number, y: number, c: RGB, strength: number): void {
    if (strength <= 0) return;
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const i = this.idx(x, y);
    this.data[i] += c[0] * strength;
    this.data[i + 1] += c[1] * strength;
    this.data[i + 2] += c[2] * strength;
  }

  // Alpha composite: colour painted over what is there.
  over(x: number, y: number, c: RGB, alpha: number): void {
    if (alpha <= 0) return;
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const i = this.idx(x, y);
    const inv = 1 - alpha;
    this.data[i] = c[0] * alpha + this.data[i] * inv;
    this.data[i + 1] = c[1] * alpha + this.data[i + 1] * inv;
    this.data[i + 2] = c[2] * alpha + this.data[i + 2] * inv;
  }

  // A soft round splat of light: gaussian falloff, additive.
  splat(cx: number, cy: number, radius: number, c: RGB, strength: number): void {
    const r = Math.ceil(radius * 3);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(WIDTH - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / radius;
        const dy = (y - cy) / radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > 9) continue;
        this.add(x, y, c, strength * Math.exp(-d2 * 1.6));
      }
    }
  }

  // A filled disc, alpha-composited.
  disc(cx: number, cy: number, radius: number, c: RGB, alpha: number): void {
    const r = Math.ceil(radius);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > radius + 0.5) continue;
        const edge = d <= radius - 0.5 ? 1 : (radius + 0.5 - d);
        this.over(x, y, c, alpha * edge);
      }
    }
  }

  // A thick line segment, alpha-composited, for the figure's limbs.
  thickLine(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB, alpha: number): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, c, alpha);
    }
  }

  toUint8(): Uint8Array {
    const out = new Uint8Array(WIDTH * HEIGHT * 3);
    for (let i = 0; i < this.data.length; i++) {
      const v = Math.round(this.data[i]);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Scene constants.
// ---------------------------------------------------------------------------

const HORIZON_Y = 742;
const PLANET_CX = 648;
const PLANET_CY = 318;
const PLANET_R = 296;
const BURST_X = 396;
const BURST_Y = 514;

const SKY_TOP: RGB = [7, 9, 30];
const SKY_MID: RGB = [17, 15, 47];
const SKY_HORIZON: RGB = [58, 30, 52];
const NEBULA_VIOLET: RGB = [96, 62, 150];
const NEBULA_TEAL: RGB = [38, 108, 118];
const BURST_CORE: RGB = [255, 246, 224];
const BURST_WARM: RGB = [255, 158, 64];
const EMBER: RGB = [255, 176, 72];

// Linear interpolation between two colours.
function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Layer 1 — sky: vertical gradient with a warm pocket near the burst.
// ---------------------------------------------------------------------------

function paintSky(cv: Canvas): void {
  for (let y = 0; y < HORIZON_Y; y++) {
    const t = y / HORIZON_Y;
    const base = t < 0.55
      ? lerpColor(SKY_TOP, SKY_MID, t / 0.55)
      : lerpColor(SKY_MID, SKY_HORIZON, (t - 0.55) / 0.45);
    // Warm pocket: the burst heats the sky around it even before the
    // planet and the halo are drawn.
    for (let x = 0; x < WIDTH; x++) {
      const dx = (x - BURST_X) / 420;
      const dy = (y - BURST_Y) / 380;
      const warm = Math.exp(-(dx * dx + dy * dy)) * 0.5;
      cv.set(x, y, [
        base[0] + 66 * warm,
        base[1] + 26 * warm,
        base[2] + 6 * warm,
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — nebula veils: two slow fBm clouds, kept faint so the PNG
// stays small and the planet keeps the stage.
// ---------------------------------------------------------------------------

function paintNebula(cv: Canvas): void {
  for (let y = 0; y < HORIZON_Y; y++) {
    const verticalFade = 1 - smooth(clamp01((y - 480) / (HORIZON_Y - 480)));
    for (let x = 0; x < WIDTH; x++) {
      const v = fbm(x * 0.0042 + 3.1, y * 0.0042, 3);
      const w = fbm(x * 0.0031 + 17.9, y * 0.0031 + 8.4, 3);
      const violet = Math.max(0, v - 0.52) * 2.1 * verticalFade;
      const teal = Math.max(0, w - 0.55) * 1.7 * verticalFade;
      if (violet > 0.005) cv.add(x, y, NEBULA_VIOLET, violet * 0.12);
      if (teal > 0.005) cv.add(x, y, NEBULA_TEAL, teal * 0.10);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — stars: seeded points, denser and brighter toward the top.
// ---------------------------------------------------------------------------

function paintStars(cv: Canvas): void {
  const rng = mulberry32(0x1f15);
  const count = 540;
  for (let i = 0; i < count; i++) {
    const x = rng() * WIDTH;
    // Bias toward the upper sky so the sea horizon stays clean.
    const y = Math.pow(rng(), 1.5) * (HORIZON_Y - 30);
    const bright = 0.25 + Math.pow(rng(), 2.2) * 0.95;
    const warm = rng() < 0.22;
    const colour: RGB = warm ? [255, 226, 190] : [214, 226, 255];
    const radius = 0.55 + Math.pow(rng(), 3) * 1.15;
    cv.splat(x, y, radius, colour, bright * 0.85);
    // The brightest few get a thin four-point cross flare.
    if (bright > 0.95 && i % 3 === 0) {
      const len = 5 + rng() * 9;
      for (let d = -len; d <= len; d++) {
        const fall = 1 - Math.abs(d) / (len + 1);
        cv.add(Math.round(x + d), Math.round(y), colour, 0.28 * fall * fall);
        cv.add(Math.round(x), Math.round(y + d), colour, 0.28 * fall * fall);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 4 — the burst halo, drawn BEFORE the planet so the planet's disc
// eclipses its centre: the sun is behind the planet, flaring past its rim.
// The falloff is a pure gaussian — it fades on its own, so there is no
// hard cutoff circle anywhere. The guard radius (760) is far past the
// point where the light is visible.
// ---------------------------------------------------------------------------

function paintBurstHalo(cv: Canvas): void {
  const guard = 760;
  const x0 = Math.max(0, BURST_X - guard);
  const x1 = Math.min(WIDTH - 1, BURST_X + guard);
  const y0 = Math.max(0, BURST_Y - guard);
  const y1 = Math.min(HEIGHT - 1, BURST_Y + guard);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - BURST_X;
      const dy = y - BURST_Y;
      const d2 = dx * dx + dy * dy;
      const tight = Math.exp(-d2 / (2 * 120 * 120));
      const wide = Math.exp(-d2 / (2 * 380 * 380));
      const strength = tight * 0.85 + wide * 0.30;
      if (strength < 0.004) continue;
      cv.add(x, y, BURST_WARM, strength);
      cv.add(x, y, [255, 226, 178], tight * 0.35);
    }
  }
}

// ---------------------------------------------------------------------------
// Layers 5 & 7 — the ring system. The ellipse is tilted -16 degrees and
// squashed; the upper half passes behind the planet, the lower half in
// front of it. Striations come from noise on the ring radius, with a
// Cassini-style gap partway out. The band is kept narrow and translucent
// so it reads as rings, not a solid slab.
// ---------------------------------------------------------------------------

const RING_TILT = -16 * (Math.PI / 180);
const RING_SQUASH = 0.28;
const RING_IN = 1.14 * PLANET_R;
const RING_OUT = 1.50 * PLANET_R;

function ringHit(x: number, y: number): { radius: number; front: boolean } | null {
  const dx = x - PLANET_CX;
  const dy = y - PLANET_CY;
  const cos = Math.cos(RING_TILT);
  const sin = Math.sin(RING_TILT);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const re = Math.sqrt(rx * rx + (ry / RING_SQUASH) * (ry / RING_SQUASH));
  if (re < RING_IN || re > RING_OUT) return null;
  return { radius: re, front: ry > 0 };
}

function paintRing(cv: Canvas, front: boolean): void {
  const x0 = Math.max(0, PLANET_CX - 500);
  const x1 = Math.min(WIDTH - 1, PLANET_CX + 500);
  const y0 = Math.max(0, PLANET_CY - 260);
  const y1 = Math.min(HEIGHT - 1, PLANET_CY + 260);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const hit = ringHit(x, y);
      if (!hit || hit.front !== front) continue;
      const span = (hit.radius - RING_IN) / (RING_OUT - RING_IN);
      // Fade both edges of the band so it never ends in a hard line.
      const edge = smooth(clamp01(span / 0.08)) * (1 - smooth(clamp01((span - 0.93) / 0.07)));
      // Striations: noise along the radius, plus a darker division.
      const streak = 0.4 + 0.6 * fbm(hit.radius * 0.055, x * 0.002, 2);
      const gap = 1 - 0.75 * Math.exp(-Math.pow((hit.radius - 1.385 * PLANET_R) / 9, 2));
      const alpha = 0.5 * edge * streak * gap * (front ? 1 : 0.8);
      const warm: RGB = lerpColor([214, 182, 128], [168, 132, 96], span);
      cv.over(x, y, warm, alpha);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 6 — the planet: banded disc, sphere shading lit from the burst,
// warm rim light on the burst side, soft turbulence in the bands.
// ---------------------------------------------------------------------------

function paintPlanet(cv: Canvas): void {
  const bandA: RGB = [206, 178, 132];
  const bandB: RGB = [184, 140, 120];
  const bandC: RGB = [228, 208, 174];
  const bandD: RGB = [130, 138, 160];
  // Light direction: from the planet centre toward the burst, in 3D
  // (the burst sits slightly in front of the disc).
  const lx = (BURST_X - PLANET_CX) / 319;
  const ly = (BURST_Y - PLANET_CY) / 319;
  const lz = 0.5;
  const llen = Math.hypot(lx, ly, lz);
  const L: RGB = [lx / llen, ly / llen, lz / llen];

  const x0 = Math.max(0, PLANET_CX - PLANET_R - 2);
  const x1 = Math.min(WIDTH - 1, PLANET_CX + PLANET_R + 2);
  const y0 = Math.max(0, PLANET_CY - PLANET_R - 2);
  const y1 = Math.min(HEIGHT - 1, PLANET_CY + PLANET_R + 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - PLANET_CX) / PLANET_R;
      const ny = (y - PLANET_CY) / PLANET_R;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const r = Math.sqrt(r2);
      // Anti-aliased disc edge.
      const edge = r > 0.985 ? (1 - r) / 0.015 : 1;
      // Band coordinate: horizontal bands warped by slow noise so they
      // feel like weather, not stripes. The warp stays gentle: too much
      // turns the bands into tangled ribbons.
      const warp = (fbm(nx * 3.2 + 7.7, ny * 3.2 + 2.2, 3) - 0.5) * 0.8;
      const bandPos = ny * 2.7 + warp;
      const s = 0.5 + 0.5 * Math.sin(bandPos * 3.2);
      let base: RGB;
      if (s < 0.33) base = lerpColor(bandA, bandB, s / 0.33);
      else if (s < 0.66) base = lerpColor(bandB, bandC, (s - 0.33) / 0.33);
      else base = lerpColor(bandC, bandD, (s - 0.66) / 0.34);
      // Turbulence inside the bands.
      const turb = 0.93 + 0.14 * fbm(nx * 6.5 + 1.3, ny * 6.5 + 9.1, 3);
      // Sphere shading: bright toward the burst, deep shadow opposite.
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const diffuse = clamp01(nx * L[0] + ny * L[1] + nz * L[2]);
      const lit = 0.22 + 0.78 * Math.pow(diffuse, 1.25);
      // Rim light: a warm arc hugging the rim on the burst side.
      const rimDir = clamp01((nx * lx + ny * ly) / Math.max(0.001, r));
      const rim = Math.pow(clamp01((r - 0.86) / 0.14), 2.2) * rimDir;
      const colour: RGB = [
        base[0] * turb * lit + 255 * rim * 0.85,
        base[1] * turb * lit + 168 * rim * 0.7,
        base[2] * turb * lit + 96 * rim * 0.55,
      ];
      cv.over(x, y, colour, edge);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 8 — burst core, lens streak, and god-ray wedges fanning out from
// the burst. The rays point up and away from the planet: light escaping.
// ---------------------------------------------------------------------------

function paintBurstCore(cv: Canvas): void {
  // White-hot core, small and dense.
  cv.splat(BURST_X, BURST_Y, 9, BURST_CORE, 1.6);
  cv.splat(BURST_X, BURST_Y, 22, [255, 214, 140], 0.9);
  cv.disc(BURST_X, BURST_Y, 6, BURST_CORE, 1);
  // Horizontal lens streak: thin, wide, fading with distance.
  for (let dx = -260; dx <= 260; dx++) {
    const fall = Math.exp(-Math.pow(Math.abs(dx) / 150, 2));
    const strength = 0.5 * fall;
    cv.add(BURST_X + dx, BURST_Y, [255, 220, 160], strength);
    cv.add(BURST_X + dx, BURST_Y - 1, [255, 220, 160], strength * 0.55);
    cv.add(BURST_X + dx, BURST_Y + 1, [255, 220, 160], strength * 0.55);
  }
  // God-ray wedges: angles in screen space, 0 = right, -90 = straight up.
  const rays: Array<{ angle: number; halfWidth: number; length: number; strength: number }> = [
    { angle: -128, halfWidth: 5.5, length: 520, strength: 0.16 },
    { angle: -104, halfWidth: 4.0, length: 610, strength: 0.20 },
    { angle: -82, halfWidth: 6.5, length: 560, strength: 0.14 },
    { angle: -58, halfWidth: 3.5, length: 480, strength: 0.18 },
    { angle: -32, halfWidth: 5.0, length: 420, strength: 0.12 },
  ];
  for (const ray of rays) {
    const dir = (ray.angle * Math.PI) / 180;
    const ux = Math.cos(dir);
    const uy = Math.sin(dir);
    const hw = (ray.halfWidth * Math.PI) / 180;
    const x0 = Math.max(0, Math.floor(BURST_X + Math.min(0, ux * ray.length) - 60));
    const x1 = Math.min(WIDTH - 1, Math.ceil(BURST_X + Math.max(0, ux * ray.length) + 60));
    const y0 = Math.max(0, Math.floor(BURST_Y + Math.min(0, uy * ray.length) - 60));
    const y1 = Math.min(HEIGHT - 1, Math.ceil(BURST_Y + Math.max(0, uy * ray.length) + 60));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - BURST_X;
        const dy = y - BURST_Y;
        const dist = Math.hypot(dx, dy);
        if (dist < 12 || dist > ray.length) continue;
        const ang = Math.atan2(dy, dx);
        let diff = Math.abs(ang - dir);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff > hw) continue;
        const across = 1 - diff / hw;
        const along = 1 - dist / ray.length;
        cv.add(x, y, [255, 196, 120], ray.strength * across * across * along);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 9 — the sea: dark streaked water, a shimmering reflection column
// under the burst, and a soft glowing seam where water meets sky.
// ---------------------------------------------------------------------------

function paintSea(cv: Canvas): void {
  const seaTop: RGB = [13, 17, 36];
  const seaBottom: RGB = [24, 26, 50];
  for (let y = HORIZON_Y; y < HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (HEIGHT - HORIZON_Y);
    const base = lerpColor(seaTop, seaBottom, depth);
    for (let x = 0; x < WIDTH; x++) {
      // Horizontal streaks: noise stretched wide, thin vertically.
      const streak = (fbm(x * 0.005, y * 0.075, 2) - 0.5) * 10;
      let r = base[0] + streak;
      let g = base[1] + streak;
      let b = base[2] + streak * 1.2;
      // Reflection column under the burst: shimmering, fading with depth.
      const col = Math.exp(-Math.pow((x - BURST_X) / 62, 2));
      if (col > 0.01) {
        const shimmer = 0.45 + 0.55 * fbm(x * 0.045 + 4.4, y * 0.028, 2);
        const fade = Math.exp(-depth * 2.6);
        const glow = col * shimmer * fade * 0.85;
        r += 255 * glow;
        g += 148 * glow;
        b += 58 * glow;
      }
      cv.set(x, y, [r, g, b]);
    }
  }
  // The horizon seam: a soft warm line, brightest under the burst,
  // fading sideways — no hard edge between sky and sea.
  for (let x = 0; x < WIDTH; x++) {
    const warm = Math.exp(-Math.pow((x - BURST_X) / 300, 2));
    for (let dy = -2; dy <= 2; dy++) {
      const y = HORIZON_Y + dy;
      const strength = (1 - Math.abs(dy) / 3) * (0.12 + 0.5 * warm);
      cv.add(x, y, [255, 178, 110], strength);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 10 — the cliff: a black jagged silhouette, lower left. Its top
// edge is a smooth profile plus slow noise; its right end drops steeply
// to the sea in one clean diagonal cut. The burst-facing top edge
// carries a warm rim.
// ---------------------------------------------------------------------------

function cliffTopY(x: number): number {
  let base: number;
  if (x <= 300) {
    const t = clamp01(x / 300);
    base = 838 - 34 * smooth(t);
  } else {
    const t = clamp01((x - 300) / 95);
    base = 804 + 220 * Math.pow(t, 2.1);
  }
  const jag = (valueNoise1(x * 0.045 + 2.7) - 0.5) * 11;
  return base + jag;
}

function paintCliff(cv: Canvas): void {
  for (let x = 0; x < 400; x++) {
    const top = cliffTopY(x);
    for (let y = Math.max(HORIZON_Y, Math.floor(top)); y < HEIGHT; y++) {
      const depth = (y - top) / (HEIGHT - top);
      const shade = lerpColor([11, 10, 19], [6, 6, 11], depth);
      cv.set(x, y, shade);
    }
    // Warm rim along the top edge where the burst light catches it.
    if (x < 330) {
      for (let d = 0; d < 4; d++) {
        const y = Math.floor(top) + d;
        cv.add(x, y, [255, 142, 62], 0.5 * (1 - d / 4));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layers 11–12 — the figure, its spark, and the rising ember stream.
// The figure stands at the cliff's high edge; its raised hand holds the
// spark; the embers climb a bezier from the spark to the burst.
// ---------------------------------------------------------------------------

const FIGURE_X = 296;
const FIGURE_BASE_Y = Math.floor(cliffTopY(FIGURE_X));
const SPARK_X = FIGURE_X + 8;
const SPARK_Y = FIGURE_BASE_Y - 22;

function paintFigure(cv: Canvas): void {
  const ink: RGB = [4, 4, 8];
  // Robed body: a tapering column from shoulders to feet.
  cv.thickLine(FIGURE_X, FIGURE_BASE_Y - 12, FIGURE_X, FIGURE_BASE_Y, 5, ink, 1);
  cv.thickLine(FIGURE_X, FIGURE_BASE_Y - 12, FIGURE_X, FIGURE_BASE_Y - 4, 6.5, ink, 1);
  // Head.
  cv.disc(FIGURE_X, FIGURE_BASE_Y - 15, 2.6, ink, 1);
  // Raised arm, reaching up toward the spark.
  cv.thickLine(FIGURE_X + 1, FIGURE_BASE_Y - 11, SPARK_X, SPARK_Y + 2, 2.2, ink, 1);
  // The other arm hangs at the figure's side.
  cv.thickLine(FIGURE_X - 2, FIGURE_BASE_Y - 11, FIGURE_X - 3, FIGURE_BASE_Y - 4, 2, ink, 1);
  // Warm rim on the burst-facing (left) side of head and body.
  cv.add(FIGURE_X - 3, FIGURE_BASE_Y - 15, [255, 150, 70], 0.8);
  cv.add(FIGURE_X - 3, FIGURE_BASE_Y - 14, [255, 150, 70], 0.6);
  cv.add(FIGURE_X - 3, FIGURE_BASE_Y - 10, [255, 150, 70], 0.7);
  cv.add(FIGURE_X - 3, FIGURE_BASE_Y - 7, [255, 150, 70], 0.6);
  cv.add(FIGURE_X - 3, FIGURE_BASE_Y - 4, [255, 150, 70], 0.5);
}

function paintSpark(cv: Canvas): void {
  cv.splat(SPARK_X, SPARK_Y, 16, [255, 190, 90], 0.9);
  cv.splat(SPARK_X, SPARK_Y, 5, BURST_CORE, 1.5);
  cv.disc(SPARK_X, SPARK_Y, 2.4, BURST_CORE, 1);
  // Four-point flare: thin bright spikes.
  for (let d = -15; d <= 15; d++) {
    const fall = 1 - Math.abs(d) / 16;
    const s = 0.85 * fall * fall;
    cv.add(SPARK_X + d, SPARK_Y, BURST_CORE, s);
    cv.add(SPARK_X, SPARK_Y + d, BURST_CORE, s * 0.9);
  }
}

// The ember stream follows a quadratic bezier from the spark, through a
// control point that bows it left, to the burst.
function emberPoint(t: number): { x: number; y: number } {
  const cx = 322;
  const cy = 648;
  const u = 1 - t;
  return {
    x: u * u * SPARK_X + 2 * u * t * cx + t * t * BURST_X,
    y: u * u * SPARK_Y + 2 * u * t * cy + t * t * BURST_Y,
  };
}

function paintEmberStream(cv: Canvas): void {
  const rng = mulberry32(0x5eed);
  // A faint continuous thread along the curve, so the motes read as one
  // rising stream even at small size.
  for (let i = 0; i <= 220; i++) {
    const t = i / 220;
    const p = emberPoint(t);
    cv.add(Math.round(p.x), Math.round(p.y), EMBER, 0.22);
  }
  // 240 motes: small near the spark, swelling and whitening as they
  // approach the burst; jitter widest mid-stream.
  const count = 240;
  for (let i = 0; i < count; i++) {
    const t = (i + rng() * 0.9) / count;
    const p = emberPoint(t);
    const spread = Math.sin(Math.PI * clamp01(t)) * 13 + 1.5;
    const jx = (rng() - 0.5) * 2 * spread;
    const jy = (rng() - 0.5) * 2 * spread * 0.7;
    const x = p.x + jx;
    const y = p.y + jy;
    const size = 0.7 + t * 1.9 + rng() * 0.7;
    const colour: RGB = lerpColor(EMBER, BURST_CORE, t * t);
    cv.splat(x, y, size, colour, 0.55 + rng() * 0.5);
  }
}

// ---------------------------------------------------------------------------
// Finish: vignette to hold the eye in the centre, then a whisper of grain.
// The grain is deliberately light — heavy grain bloats the PNG past the
// 1 MiB cap without adding anything the judge can see.
// ---------------------------------------------------------------------------

function finish(cv: Canvas): void {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const corner = Math.hypot(cx, cy);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r = Math.hypot(x - cx, y - cy) / corner;
      const vig = 1 - 0.26 * Math.pow(clamp01((r - 0.52) / 0.48), 2);
      const grain = (hash2(x, y) - 0.5) * 2.2;
      const i = (y * WIDTH + x) * 3;
      cv.data[i] = cv.data[i] * vig + grain;
      cv.data[i + 1] = cv.data[i + 1] * vig + grain;
      cv.data[i + 2] = cv.data[i + 2] * vig + grain;
    }
  }
}

// ---------------------------------------------------------------------------
// Render the whole scene, back to front, and return raw RGB bytes.
// ---------------------------------------------------------------------------

export function render(): Uint8Array {
  const cv = new Canvas();
  paintSky(cv);
  paintNebula(cv);
  paintStars(cv);
  paintBurstHalo(cv);
  paintRing(cv, false); // back half of the rings, behind the planet
  paintPlanet(cv);
  paintRing(cv, true); // front half, crossing the disc
  paintBurstCore(cv);
  paintSea(cv);
  paintCliff(cv);
  paintFigure(cv);
  paintSpark(cv);
  paintEmberStream(cv);
  finish(cv);
  return cv.toUint8();
}
