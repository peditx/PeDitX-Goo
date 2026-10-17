// Dev harness: draws the character on its own, with no island, no FSM and
// nothing that can auto-hide. Open /dev/goo-preview.html?state=error in the
// browser to look at one state without launching the app.
//
// Not bundled — dev/upload-preview.html is the same deal.

import { BotEngine } from "../src/character/engine";
import type { BotStateName } from "../src/core/layout";

const q = new URLSearchParams(location.search);
const state = (q.get("state") ?? "idle") as BotStateName;

/**
 * `?icon=N` — render the character alone, fitted to a square, on transparent
 * ground. This is what scripts/gen-icons.mjs screenshots, so the tray icon is
 * the character itself rather than a second drawing that can drift from it.
 */
const iconSize = Number(q.get("icon") ?? 0);
if (iconSize > 0) {
  document.body.style.background = "transparent";
  for (const el of document.querySelectorAll("#label, nav")) el.remove();
  renderIcon(iconSize);
} else {
  renderLoop();
}

function renderIcon(S: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  canvas.width = Math.round(S * dpr);
  canvas.height = Math.round(S * dpr);
  canvas.style.width = `${S}px`;
  canvas.style.height = `${S}px`;
  const ctx = canvas.getContext("2d")!;

  // Draw big and off-centre-safe into an offscreen canvas, then fit whatever
  // ink there is into the square — fluff, feet and antenna included, without
  // hand-tuned numbers that go stale whenever the drawing changes.
  const OS = S * 4;
  const off = document.createElement("canvas");
  off.width = off.height = OS;
  const octx = off.getContext("2d")!;
  const eng = new BotEngine();
  eng.setState(state, true);
  eng.particleOverhang = 0;
  for (let i = 0; i < 90; i++) eng.update(1 / 60); // settle the springs
  octx.translate(OS * 0.1, OS * 0.1);
  eng.draw(octx, OS * 0.8, OS * 0.8);

  const data = octx.getImageData(0, 0, OS, OS).data;
  let minX = OS, minY = OS, maxX = -1, maxY = -1;
  for (let y = 0; y < OS; y++) {
    for (let x = 0; x < OS; x++) {
      if (data[(y * OS + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const pad = Math.round(S * 0.03);
  const box = S - pad * 2;
  const k = Math.min(box / w, box / h);
  const dw = w * k;
  const dh = h * k;
  ctx.drawImage(
    off,
    minX, minY, w, h,
    (S - dw) / 2, (S - dh) / 2, dw, dh,
  );
}

function renderLoop() {
const W = 560;
const H = 560;
const dpr = Math.min(2, window.devicePixelRatio || 1);

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const label = document.getElementById("label");
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
const ctx = canvas.getContext("2d")!;

const eng = new BotEngine();
eng.setState(state, true);
if (label) label.textContent = `state: ${state}`;

// The eyes follow the pointer, which is the thing most worth checking.
canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  eng.lookX = ((e.clientX - r.left) / r.width) * 2 - 1;
  eng.lookY = ((e.clientY - r.top) / r.height) * 2 - 1;
});

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  eng.update(dt);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  eng.draw(ctx, W, H);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
}
