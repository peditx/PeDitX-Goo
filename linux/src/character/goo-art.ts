// PeDitX-Goo's art, as Path2D built straight from the SVG source.
//
// Canvas takes SVG path data verbatim — `new Path2D("M126 178 Q…")` — so the
// `d` attributes below are that drawing, unchanged, with no image, no library
// and nothing to load. Everything here is a *part*: the engine positions,
// scales, tints and blinks them a frame at a time, which is how this project
// animates (there are no sprite frames anywhere in it).
//
// Source of truth: assets/goo-character.svg (400 × 440).

export const VB = { w: 400, h: 440 };

/**
 * The body's centre in SVG units, measured from the outline rather than
 * eyeballed: the path runs 102.8–303.0 by 91.0–323.5. Everything else is
 * relative to this, so getting it wrong shifts the whole character inside
 * the island.
 */
export const BODY_ORIGIN = { x: 202.9, y: 207.2 };
/**
 * Half-extents of that outline. `x` is the one that matters: the engine's R is
 * the body's half-width, so a bigger number here draws a smaller character.
 */
export const BODY_HALF = { x: 100.1, y: 116.2 };

export const FUR = {
  inner: "#E6C9FF", // radial gradient, cx 38% cy 28% r 75%
  mid: "#B98BE8",
  outer: "#8051B8",
  tuft: "#A77AD5",
  sparkle: "#D8B9F5",
  leg: "#A77AD5",
  foot: "#9567C5",
  claw: "#C9A2EF",
  eye: "#30233C",
  mouth: "#56365E",
  blush: "#F6A7D5",
  cheek: "#F35AA8",
  heart: "#FFB7DB",
  heartDeep: "#F35AA8",
  heartEdge: "#F18ABD",
  heartShine: "#FFE5F2",
  shadow: "#76509B",
};

// ── Parts ────────────────────────────────────────────────────────────────────

/** The lumpy body. In SVG coordinates; `draw()` maps them onto ±R. */
export const BODY = new Path2D(
  "M126 178 Q103 145 133 120 Q145 91 176 103 Q204 79 227 103 Q260 91 274 121 " +
    "Q307 135 292 172 Q314 199 292 226 Q306 260 278 279 Q266 316 232 313 " +
    "Q203 334 177 313 Q143 323 128 291 Q96 275 111 244 Q89 213 126 178Z",
);

/** The nine fur tufts, drawn under the body so they read as a fringe. */
const TUFT_D = [
  "M130 150 Q94 126 105 102",
  "M153 112 Q127 79 147 63",
  "M196 98 Q178 65 199 48",
  "M237 105 Q267 76 252 56",
  "M278 130 Q315 109 307 87",
  "M112 192 Q80 184 76 160",
  "M291 190 Q324 171 322 151",
  "M117 253 Q87 251 82 231",
  "M288 260 Q319 248 322 226",
];
export const TUFTS: Path2D[] = TUFT_D.map((d) => new Path2D(d));

/** Small light specks scattered over the fur. */
export const SPARKLES: { x: number; y: number; r: number }[] = [
  { x: 145, y: 137, r: 5 },
  { x: 174, y: 116, r: 4 },
  { x: 225, y: 119, r: 5 },
  { x: 267, y: 143, r: 4 },
  { x: 121, y: 188, r: 4 },
  { x: 286, y: 211, r: 5 },
  { x: 137, y: 267, r: 4 },
  { x: 252, y: 292, r: 4 },
];

/** Legs — stroked, so they are drawn with `lineWidth`, not filled. */
const LEG_D = [
  "M150 279 Q129 297 143 328 L165 350",
  "M258 278 Q286 296 277 322 L254 345",
];
export const LEGS: Path2D[] = LEG_D.map((d) => new Path2D(d));
export const FEET: { x: number; y: number; rx: number; ry: number }[] = [
  { x: 165, y: 355, rx: 27, ry: 14 },
  { x: 255, y: 350, rx: 27, ry: 14 },
];

/** The heart it hugs, plus the shine on it. */
export const HEART = new Path2D(
  "M155 241 Q180 222 200 247 Q222 222 247 241 Q272 267 235 299 L201 326 " +
    "L166 299 Q130 267 155 241Z",
);
export const HEART_SHINE = new Path2D("M166 250 Q179 240 190 251");

/** The little claws over the heart. */
const CLAW_D = [
  "M130 159 l-13 -7 5 17Z",
  "M278 164 l14 -8 -5 18Z",
  "M151 286 l-10 13 17 -5Z",
  "M258 285 l13 9 -17 -2Z",
];
export const CLAWS: Path2D[] = CLAW_D.map((d) => new Path2D(d));

/** Ground shadow. Scales opposite to a bounce, so a jump reads as height. */
export const SHADOW = { x: 201, y: 399, rx: 105, ry: 17 };

// ── The face, in the engine's own units ─────────────────────────────────────
//
// The engine owns blinks, the 13 eye shapes and the cursor tracking, so the
// eyes are given as offsets rather than drawn here. They are relative to the
// body origin and expressed in units of the body's half-width, so they follow
// whatever R the island is using.

/** Eye centres, in body-half-width units from the origin. */
export const EYES = { dx: 0.345, dy: -0.192, rx: 0.11, ry: 0.15 };
/** Blush, same units. */
export const BLUSH = { dx: 0.558, dy: 0.038, rx: 0.14, ry: 0.08 };
/** Mouth, same units: an arc `hw` either side of (dx, dy), bowing down `bow`. */
export const MOUTH = { dx: -0.024, dy: 0.058, hw: 0.105, bow: 0.055 };

// ── Mapping SVG units onto the island's R ────────────────────────────────────
//
// The engine works in body-local units centred on (0, 0) with a half-width of
// R. The art is in SVG units centred on BODY_ORIGIN. One matrix does both:
// shrink by k, then shift the origin to the middle.

export function artMatrix(R: number): DOMMatrix {
  const k = R / BODY_HALF.x;
  return new DOMMatrix([k, 0, 0, k, -BODY_ORIGIN.x * k, -BODY_ORIGIN.y * k]);
}

/** Runs `fn` with the context mapped into SVG units, then puts it back. */
export function withArt(x: CanvasRenderingContext2D, R: number, fn: () => void) {
  x.save();
  const m = artMatrix(R);
  x.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  fn();
  x.restore();
}

/** The body silhouette, already mapped into body-local units. */
export function bodyPath(R: number): Path2D {
  const p = new Path2D();
  p.addPath(BODY, artMatrix(R));
  return p;
}
